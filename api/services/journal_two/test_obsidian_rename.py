"""L2 (live Obsidian probe, 2026-11-03): an Obsidian rename keeps the note.

`import_key` is derived from the vault path, so a rename used to be a NEW note: the old one
stayed live and untagged until two full passes, and the member's UCT-side edits, links and
favourites stayed on the old copy while two notes carried the same title.

Now, when ONE final push drops a path from the manifest and adds a path whose staged body is
byte-identical to the dropped one (and that pairing is unique both ways), staging records the
rename (`obsidian_staging.ingest_batch`), and the next sync re-keys the EXISTING note onto the
new path before it reads existing rows (`engine._apply_source_renames`): same id, history,
links, favourites and member edits; its folder and title follow the new path.

Drives the REAL plugin doors (`/obsidian/redeem`, `/obsidian/ingest`) and the REAL engine, as
`test_obsidian_attachments_e2e.py` does.
"""

from __future__ import annotations

import hashlib
import json

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import note_sync as note_sync_router
from api.services import auth_db
from api.services.journal_two import media_policy, notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import engine as sync_engine, obsidian_link

_REDEEM = "/api/j2/notes/connectors/obsidian/redeem"
_INGEST = "/api/j2/notes/connectors/obsidian/ingest"
_VAULT = "vault-rename"
USER = "user-a"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    auth_db.init_db()
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.execute("INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, 'pw', ?)",
                 (USER, f"{USER}@example.test", USER))
    conn.execute("INSERT INTO subscriptions (id, user_id, plan, status) VALUES (?, ?, 'pro', 'active')",
                 (f"sub-{USER}", USER))
    conn.commit()
    conn.close()
    monkeypatch.setenv("PUSH_SECRET", "test-push-secret")
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("NOTE_SYNC_OBSIDIAN_ENABLED", "1")
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    media_policy._USAGE_MEMO.clear()
    monkeypatch.setattr(note_sync_router, "_start_initial_sync", lambda *_a, **_k: None)
    app = FastAPI()
    app.include_router(note_sync_router.router)
    yield TestClient(app)
    media_policy._USAGE_MEMO.clear()


def _connect(client) -> tuple[str, str]:
    code = obsidian_link.mint_connect_code(USER)
    r = client.post(_REDEEM, json={"code": code, "vaultId": _VAULT, "label": "Trading"})
    assert r.status_code == 200, r.text
    return r.json()["token"], r.json()["source"]["id"]


def _push(client, token: str, notes: dict[str, str], manifest: list[str],
          updated_at: str = "2026-11-01T00:00:00Z") -> None:
    payload = [{"vault_path": p, "content_hash": hashlib.sha256(b.encode()).hexdigest(),
                "body_md": b, "updated_at": updated_at} for p, b in notes.items()]
    r = client.post(_INGEST, headers={"Authorization": f"Bearer {token}"},
                    json={"consent": True, "notes": payload, "manifest": manifest, "final": True})
    assert r.status_code == 200, r.text


async def _sync(source_id: str, *, full: bool = False) -> dict:
    r = await sync_engine.sync_source(source_id, full=full, manual=True)
    assert r["status"] in ("ok", "warning"), r
    return r


def _key(path: str) -> str:
    return f"obsidian:{_VAULT}/{path}"


def _live_rows() -> dict[str, dict]:
    conn = auth_db.get_connection()
    try:
        rows = conn.execute(
            "SELECT id, import_key, title, folder_id, body_json, tags, updated_at, imported_at"
            " FROM j2_notes WHERE user_id = ? AND deleted_at IS NULL", (USER,)).fetchall()
    finally:
        conn.close()
    return {r["import_key"]: dict(r) for r in rows}


def _folder_name(folder_id: str | None) -> str | None:
    if not folder_id:
        return None
    conn = auth_db.get_connection()
    try:
        row = conn.execute("SELECT name FROM j2_note_folders WHERE id = ?", (folder_id,)).fetchone()
    finally:
        conn.close()
    return row["name"] if row else None


def _renames() -> list[dict]:
    conn = auth_db.get_connection()
    try:
        return [dict(r) for r in conn.execute("SELECT * FROM j2_obsidian_renames").fetchall()]
    finally:
        conn.close()


BODY = "Some plain words about the trade.\n\nAnd a second line."


async def test_a_rename_keeps_the_note_and_makes_no_duplicate(client):
    token, src = _connect(client)
    _push(client, token, {"Probe.md": BODY}, ["Probe.md"])
    await _sync(src)
    before = _live_rows()
    assert list(before) == [_key("Probe.md")]
    note_id = before[_key("Probe.md")]["id"]
    assert before[_key("Probe.md")]["title"] == "Probe"
    notes_svc.add_favorite(USER, note_id)

    _push(client, token, {"Probe renamed.md": BODY}, ["Probe renamed.md"])
    r = await _sync(src)
    after = _live_rows()
    assert list(after) == [_key("Probe renamed.md")]          # no duplicate, old key gone
    row = after[_key("Probe renamed.md")]
    assert row["id"] == note_id                                # same note
    assert row["title"] == "Probe renamed"                     # title follows the new path
    assert r["created"] == 0
    assert notes_svc.get_note(USER, note_id)["isFavorite"] is True
    assert _renames() == []                                    # the record is consumed


async def test_the_remote_index_follows_and_full_passes_never_tag_the_moved_note(client):
    token, src = _connect(client)
    _push(client, token, {"a.md": BODY, "other.md": "Other words."}, ["a.md", "other.md"])
    await _sync(src)
    note_id = _live_rows()[_key("a.md")]["id"]
    _push(client, token, {"b.md": BODY}, ["b.md", "other.md"])
    await _sync(src)
    conn = auth_db.get_connection()
    try:
        ids = {r["remote_id"] for r in conn.execute(
            "SELECT remote_id FROM j2_note_remote_index WHERE source_id = ?", (src,))}
        for _ in range(2):  # two full passes a night apart: two strikes for any missing path
            conn.execute("UPDATE j2_note_sources SET last_full_sync_at = '2026-01-01T00:00:00+00:00'"
                         " WHERE id = ?", (src,))
            conn.commit()
            await _sync(src, full=True)
    finally:
        conn.close()
    assert "a.md" not in ids and "b.md" in ids
    row = _live_rows()[_key("b.md")]
    assert row["id"] == note_id
    assert "source-deleted" not in json.loads(row["tags"])


async def test_a_rename_into_a_subfolder_moves_the_note(client):
    token, src = _connect(client)
    _push(client, token, {"Probe.md": BODY}, ["Probe.md"])
    await _sync(src)
    note_id = _live_rows()[_key("Probe.md")]["id"]

    _push(client, token, {"Probe Sub/Probe.md": BODY}, ["Probe Sub/Probe.md"])
    await _sync(src)
    after = _live_rows()
    assert list(after) == [_key("Probe Sub/Probe.md")]
    row = after[_key("Probe Sub/Probe.md")]
    assert row["id"] == note_id
    assert _folder_name(row["folder_id"]) == "Probe Sub"


async def test_rename_plus_edit_in_one_push_falls_back_to_a_new_note(client):
    token, src = _connect(client)
    _push(client, token, {"a.md": BODY}, ["a.md"])
    await _sync(src)
    old_id = _live_rows()[_key("a.md")]["id"]

    _push(client, token, {"b.md": BODY + "\n\nEdited too."}, ["b.md"])
    await _sync(src)
    after = _live_rows()
    assert set(after) == {_key("a.md"), _key("b.md")}            # today's behaviour
    assert after[_key("a.md")]["id"] == old_id
    assert after[_key("b.md")]["id"] != old_id
    assert _renames() == []


async def test_two_removed_paths_matching_one_new_path_fall_back(client):
    token, src = _connect(client)
    _push(client, token, {"a.md": BODY, "c.md": BODY}, ["a.md", "c.md"])
    await _sync(src)
    _push(client, token, {"b.md": BODY}, ["b.md"])
    await _sync(src)
    assert set(_live_rows()) == {_key("a.md"), _key("c.md"), _key("b.md")}
    assert _renames() == []


async def test_one_removed_path_matching_two_new_paths_falls_back(client):
    token, src = _connect(client)
    _push(client, token, {"a.md": BODY}, ["a.md"])
    await _sync(src)
    old_id = _live_rows()[_key("a.md")]["id"]
    _push(client, token, {"b.md": BODY, "c.md": BODY}, ["b.md", "c.md"])
    await _sync(src)
    rows = _live_rows()
    assert set(rows) == {_key("a.md"), _key("b.md"), _key("c.md")}
    assert rows[_key("a.md")]["id"] == old_id


async def test_a_member_edit_on_the_old_note_survives_the_rekey(client):
    token, src = _connect(client)
    _push(client, token, {"Probe.md": BODY}, ["Probe.md"])
    await _sync(src)
    note_id = _live_rows()[_key("Probe.md")]["id"]
    edited_doc = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "My own UCT words."}]}]}
    notes_svc.update_note(USER, note_id, {"bodyJson": edited_doc})

    # Obsidian's own rename keeps the file's mtime (a moved mtime is a remote change: see
    # test_obsidian_rename_fr1.py, which expects the "(synced copy)" then).
    _push(client, token, {"Sub/Probe moved.md": BODY}, ["Sub/Probe moved.md"])
    r = await _sync(src)
    rows = _live_rows()
    assert list(rows) == [_key("Sub/Probe moved.md")]                 # no "(synced copy)" sibling
    row = rows[_key("Sub/Probe moved.md")]
    assert row["id"] == note_id
    assert "My own UCT words." in row["body_json"]              # the member's words kept
    assert "sync-conflict" not in json.loads(row["tags"])
    assert r["conflicts"] == 0
    assert _folder_name(row["folder_id"]) == "Sub"               # it still moved
    assert row["title"] == "Probe moved"                         # still the file name: follows

    # and the next pass is quiet: no conflict on an unchanged remote
    r2 = await _sync(src, full=True)
    assert r2["conflicts"] == 0
    assert list(_live_rows()) == [_key("Sub/Probe moved.md")]

    # ... even after a converter change moves the payload hash (the revision is the gate).
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE j2_notes SET import_hash = 'converter-changed' WHERE id = ?", (note_id,))
        conn.commit()
    finally:
        conn.close()
    r3 = await _sync(src, full=True)
    assert r3["conflicts"] == 0
    assert list(_live_rows()) == [_key("Sub/Probe moved.md")]


async def test_a_rename_back_before_the_sync_runs_does_not_rekey(client):
    """A recorded rename is re-checked against the manifest when it is applied: once the old
    path is back (and the new one gone) nothing moves."""
    token, src = _connect(client)
    _push(client, token, {"a.md": BODY}, ["a.md"])
    await _sync(src)
    old_id = _live_rows()[_key("a.md")]["id"]
    _push(client, token, {"b.md": BODY}, ["b.md"])
    _push(client, token, {"a.md": BODY}, ["a.md"])               # renamed back, no sync between
    await _sync(src)
    # The record for a -> b went with b's manifest entry; the push that renamed it back
    # recorded b -> a instead (applied only if b.md's note is ever the one listed).
    assert [(r["old_path"], r["new_path"]) for r in _renames()] == [("b.md", "a.md")]
    rows = _live_rows()
    # The note stays on a.md. (b.md's staged row is still listed and imported once, as before
    # this change: staging is never pruned. That ghost is the 2-strike removal's to tag.)
    assert rows[_key("a.md")]["id"] == old_id


async def test_the_old_path_back_in_the_manifest_does_not_rekey(client):
    """Renamed, then the old file came back too (copied, or recreated) before the sync ran: the
    old note keeps its path. Moving it to b.md would leave a.md's file with no note, and a.md's
    staged row is not listed again (unchanged since)."""
    token, src = _connect(client)
    _push(client, token, {"a.md": BODY}, ["a.md"])
    await _sync(src)
    old_id = _live_rows()[_key("a.md")]["id"]
    _push(client, token, {"b.md": BODY}, ["b.md"])
    _push(client, token, {"a.md": BODY}, ["a.md", "b.md"])
    await _sync(src)
    rows = _live_rows()
    assert rows[_key("a.md")]["id"] == old_id
    assert _key("b.md") in rows and rows[_key("b.md")]["id"] != old_id


async def test_a_new_path_whose_key_is_taken_by_a_trashed_note_is_not_rekeyed(client):
    """The unique index on (user_id, import_key) covers trashed rows: a note the member trashed
    still holds b.md's key, so a.md's note cannot take it. Nothing is re-keyed and the pass does
    not fail on the constraint."""
    token, src = _connect(client)
    _push(client, token, {"a.md": BODY, "b.md": "An older b."}, ["a.md", "b.md"])
    await _sync(src)
    rows = _live_rows()
    a_id, b_id = rows[_key("a.md")]["id"], rows[_key("b.md")]["id"]
    notes_svc.delete_note(USER, b_id)
    _push(client, token, {}, ["a.md"])
    _push(client, token, {"b.md": BODY}, ["b.md"])
    r = await _sync(src)
    assert r["status"] == "ok", r
    assert _live_rows()[_key("a.md")]["id"] == a_id
    assert _renames() == []


async def test_a_rekey_takes_the_source_deleted_tag_off(client):
    """On a member-edited note (an unedited one gets the remote's tags from `import_confirm`
    anyway): the re-key is what tracks it again, so the tag comes off there."""
    token, src = _connect(client)
    _push(client, token, {"a.md": BODY}, ["a.md"])
    await _sync(src)
    note_id = _live_rows()[_key("a.md")]["id"]
    notes_svc.update_note(USER, note_id, {"title": "My title"})
    conn = auth_db.get_connection()
    try:  # an earlier sever (a false positive, say) left the tag on
        conn.execute("UPDATE j2_notes SET tags = ? WHERE id = ?", (json.dumps(["source-deleted"]), note_id))
        conn.commit()
    finally:
        conn.close()
    _push(client, token, {"b.md": BODY}, ["b.md"])
    await _sync(src)
    row = _live_rows()[_key("b.md")]
    assert row["id"] == note_id
    assert row["title"] == "My title"                           # the member's title kept
    assert "source-deleted" not in json.loads(row["tags"])


async def test_a_note_the_member_refiled_in_uct_stays_where_they_put_it(client):
    token, src = _connect(client)
    _push(client, token, {"a.md": BODY}, ["a.md"])
    await _sync(src)
    note_id = _live_rows()[_key("a.md")]["id"]
    mine = notes_svc.create_folder(USER, "Mine")["id"]
    notes_svc.update_note(USER, note_id, {"folderId": mine})
    _push(client, token, {"Sub/a.md": BODY}, ["Sub/a.md"])
    await _sync(src)
    row = _live_rows()[_key("Sub/a.md")]
    assert row["id"] == note_id
    assert row["folder_id"] == mine


def test_disconnect_purges_the_recorded_renames(client):
    token, _src = _connect(client)
    _push(client, token, {"a.md": BODY}, ["a.md"])
    _push(client, token, {"b.md": BODY}, ["b.md"])
    assert [(r["old_path"], r["new_path"]) for r in _renames()] == [("a.md", "b.md")]
    obsidian_link.revoke_devices(USER)
    assert _renames() == []


async def test_a_synced_note_says_which_app_it_came_from(client):
    """L3: the note view names the app in its "removed from <app>" notice from `importSource`."""
    token, src = _connect(client)
    _push(client, token, {"a.md": BODY}, ["a.md"])
    await _sync(src)
    note_id = _live_rows()[_key("a.md")]["id"]
    assert notes_svc.get_note(USER, note_id)["importSource"] == "obsidian"
    made_here = notes_svc.create_note(USER, {"title": "Mine"})
    assert notes_svc.get_note(USER, made_here["id"])["importSource"] is None
