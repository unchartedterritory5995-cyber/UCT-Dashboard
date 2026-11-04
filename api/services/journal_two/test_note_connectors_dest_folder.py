"""A connector source whose destination folder was deleted (live audit 2026-11-03, H1/M2).

Found in production: a Notion source pointed at a folder the member had deleted. Every pass,
`import_confirm` refused the whole batch ("destination folder not found"), the member was told the
notes "will be tried again on the next sync", the cursor stayed pinned, and 20 of 20 log rows read
"warning" with nothing stored. Nothing could ever succeed.

  * Self-heal: a pass whose source points at a missing folder repairs it the way prevention
    would have: a source with imported notes goes to the root (where the old delete put its
    folders; review I1), one with none gets its default folder back (the connect flow's own
    "<Provider> — <account>" name, `dest_folder`). Never for a disabled, paused or disconnected
    source; idempotent; nothing already imported is moved; a failure leaves the row for retry.
  * A folder move is not a content edit: `delete_folder` keeps an unedited import unedited
    (review I2), and never hides a member's edit.
  * Prevention: `notes.delete_folder` re-points every source whose folder it removes at the
    folder the notes climb to (the parent, or the root as None, which import_confirm accepts).
  * Honest message: a failure a retry cannot fix never says "tried again", and the source row's
    error never carries batch jargon or a raw note id.
"""
from __future__ import annotations

import json
from typing import Any

import pytest
from cryptography.fernet import Fernet

from api.services import auth_db
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import connections, dest_folder, engine, errors
from api.services.journal_two.note_connectors.providers.base import (
    AccountInfo, NoteProvider, RemoteNote, RemoteRef,
)

USER = "u1"
OTHER = "u2"


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")

    async def creds(_u, _p):
        return {"accessToken": "t"}

    monkeypatch.setattr(engine, "_resolve_credentials", creds)


def _doc(text: str, image: str | None = None) -> dict:
    content: list[dict] = [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]
    if image:
        content.append({"type": "image", "attrs": {"src": f"import-ref://{image}"}})
    return {"type": "doc", "content": content}


class Fake(NoteProvider):
    """Lists `notes` (`{remote_id: (day, folder_path)}`). `bad_media`: ids whose one image is
    refused for good (a final notice, like production's favicon.ico)."""
    name = "fake"

    def __init__(self, notes: dict[str, tuple[int, list[str]]], *, bad_media=()):
        self.notes = dict(notes)
        self.bad_media = set(bad_media)

    def import_key(self, source_remote_id, remote_id):
        return f"fake:{source_remote_id}:{remote_id}"

    async def validate(self, credentials):
        return AccountInfo(label="Fake")

    async def list_changed(self, credentials, cursor=None):
        return [RemoteRef(remote_id=r, updated_at=f"2026-01-{d:02d}T00:00:00.000+00:00")
                for r, (d, _p) in self.notes.items()]

    async def fetch(self, credentials, r):
        rid = r.remote_id
        _day, path = self.notes[rid]
        if rid in self.bad_media:
            return RemoteNote(remote_id=rid, title=f"Note {rid}", doc=_doc(f"body {rid}", f"res-{rid}"),
                              media=[{"ref": f"res-{rid}", "kind": "image", "name": "favicon.ico"}],
                              folder_path=list(path), updated_at=r.updated_at)
        return RemoteNote(remote_id=rid, title=f"Note {rid}", doc=_doc(f"body {rid}"),
                          folder_path=list(path), updated_at=r.updated_at)

    async def fetch_media(self, credentials, media_ref):
        raise errors.NoteConnUnsupported("favicon.ico can't be shown here",
                                         reason="favicon.ico can't be shown here")


def _q(sql: str, params=()) -> list[dict[str, Any]]:
    conn = auth_db.get_connection()
    try:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]
    finally:
        conn.close()


def _x(sql: str, params=()) -> None:
    conn = auth_db.get_connection()
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def _source(provider="notion", remote_id="ws1", display_name="Acme", user=USER) -> dict:
    connections.upsert_connector(user, provider, {"accessToken": "t"}, account_label=display_name)
    name = dest_folder.default_folder_name(provider, display_name, remote_id)
    folder_id = dest_folder.default_folder_id(user, name)
    return connections.create_source(user, provider, remote_id, display_name=display_name,
                                     dest_folder_id=folder_id)


def _drop_folder_raw(folder_id: str) -> None:
    """The production state: the folder is gone and the source still names it (deleted before
    this fix, so `delete_folder` never re-pointed it)."""
    _x("DELETE FROM j2_note_folders WHERE id = ?", (folder_id,))


async def _pass(monkeypatch, src, provider, **kw) -> dict:
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: provider)
    return await engine.sync_source(src["id"], manual=True, **kw)


def _folders_named(name: str, user=USER) -> list[dict]:
    return _q("SELECT id, parent_id FROM j2_note_folders WHERE user_id = ? AND name = ?", (user, name))


def _note(rid: str, src_remote="ws1") -> dict:
    rows = _q("SELECT id, folder_id FROM j2_notes WHERE import_key = ?", (f"fake:{src_remote}:{rid}",))
    return rows[0] if rows else {}


def _log_failures(src) -> list[dict]:
    row = _q("SELECT failures_json FROM j2_note_sync_log WHERE source_id = ? ORDER BY id DESC LIMIT 1",
             (src["id"],))[0]
    return json.loads(row["failures_json"] or "[]")


# ── the name: ONE authority, shared with the connect flow ────────────────────

def test_default_folder_name_is_the_connect_flows_name():
    assert dest_folder.default_folder_name("notion", "Acme", "ws1") == "Notion — Acme"
    assert dest_folder.default_folder_name("roam", None, "graph-x") == "Roam Research — graph-x"
    # Task 7 review m1: "Evernote", never "Evernote — Evernote"
    assert dest_folder.default_folder_name("evernote", "Evernote", "acct") == "Evernote"
    # Obsidian: one folder per vault, the device label, else the vault id
    assert dest_folder.default_folder_name("obsidian", "Laptop", "v1") == "Obsidian — Laptop"
    assert dest_folder.default_folder_name("obsidian", None, "v1") == "Obsidian — Vault (v1)"


def test_the_router_names_folders_through_the_shared_helper():
    """The connect flow and the self-heal must never type the name twice."""
    import inspect
    from api.routers import note_sync
    src = inspect.getsource(note_sync)
    assert "dest_folder.default_folder_name(" in src
    assert '— {' not in src, "the router composes a folder name by hand again"


# ── behaviour 1: self-heal ───────────────────────────────────────────────────

async def test_a_pass_recreates_the_missing_folder_and_imports(db, monkeypatch):
    src = _source()
    old = src["destFolderId"]
    _drop_folder_raw(old)
    result = await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    assert result["status"] == "ok" and result["created"] == 1
    healed = connections.get_source_by_id(src["id"])
    assert healed["destFolderId"] and healed["destFolderId"] != old
    assert [f["id"] for f in _folders_named("Notion — Acme")] == [healed["destFolderId"]]
    assert _note("a")["folder_id"] == healed["destFolderId"]
    assert healed["lastSyncStatus"] == "ok" and not healed["lastSyncError"]
    assert healed["cursor"] == "2026-01-01T00:00:00.000+00:00"  # the pinned cursor moved on


async def test_a_stuck_source_with_a_pinned_cursor_heals_on_its_next_pass(db, monkeypatch):
    """The production state: earlier passes failed (warning, cursor pinned). The next one stores."""
    src = _source()
    real_heal = dest_folder.heal_missing_dest_folder
    _drop_folder_raw(src["destFolderId"])
    # A stuck pass as it ran before this fix: no heal.
    monkeypatch.setattr(dest_folder, "heal_missing_dest_folder",
                        lambda *a, **k: dest_folder.HealResult("failed", None))
    first = await _pass(monkeypatch, src, Fake({"a": (3, [])}))
    assert first["status"] == "warning" and first["created"] == 0
    assert connections.get_source_by_id(src["id"])["cursor"] is None
    monkeypatch.setattr(dest_folder, "heal_missing_dest_folder", real_heal)  # the deploy
    second = await _pass(monkeypatch, src, Fake({"a": (3, [])}))
    assert second["status"] == "ok" and second["created"] == 1
    row = connections.get_source_by_id(src["id"])
    assert row["cursor"] == "2026-01-03T00:00:00.000+00:00" and not row["lastSyncError"]


async def test_two_passes_make_one_folder(db, monkeypatch):
    src = _source()
    _drop_folder_raw(src["destFolderId"])
    await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    await _pass(monkeypatch, src, Fake({"a": (1, []), "b": (2, [])}))
    assert len(_folders_named("Notion — Acme")) == 1


def test_heal_is_idempotent_called_twice(db):
    src = _source()
    _drop_folder_raw(src["destFolderId"])
    first = dest_folder.heal_missing_dest_folder(USER, src["id"])
    second = dest_folder.heal_missing_dest_folder(USER, src["id"])
    assert first.outcome == "remade" and second.outcome == "present"
    assert first.dest_folder_id == second.dest_folder_id
    assert len(_folders_named("Notion — Acme")) == 1


def test_heal_reuses_a_root_folder_that_already_has_the_name(db):
    """Two sources of one account, or a member who made the folder by hand: the connect flow
    reuses the root folder of that name, and so does the heal. Never a second one."""
    src = _source()
    _drop_folder_raw(src["destFolderId"])
    mine = notes_svc.create_folder(USER, "Notion — Acme")
    heal = dest_folder.heal_missing_dest_folder(USER, src["id"])
    assert heal.dest_folder_id == mine["id"] and heal.folder_name == "Notion — Acme"
    assert len(_folders_named("Notion — Acme")) == 1


def test_a_present_folder_never_takes_the_write_lock(db, monkeypatch):
    """Review M2: every healthy pass runs this check, so it is a plain read."""
    src = _source()

    def no_lock(*_a, **_k):
        raise AssertionError("BEGIN IMMEDIATE taken for a source whose folder exists")

    monkeypatch.setattr(notes_svc, "_begin_immediate", no_lock)
    assert dest_folder.heal_missing_dest_folder(USER, src["id"]).outcome == "present"
    notes_svc.delete_folder(USER, src["destFolderId"])  # the source now points at the root
    assert dest_folder.heal_missing_dest_folder(USER, src["id"]).outcome == "root"


async def test_a_heal_that_raises_never_aborts_the_pass(db, monkeypatch):
    src = _source()

    def boom(*_a, **_k):
        raise RuntimeError("heal exploded")

    monkeypatch.setattr(dest_folder, "heal_missing_dest_folder", boom)
    result = await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    assert result["status"] == "ok" and result["created"] == 1


async def test_the_pass_imports_where_the_row_points_now(db, monkeypatch):
    """Review M1: the source dict was read before the check; the row (re-pointed since) wins."""
    src = _source()
    elsewhere = notes_svc.create_folder(USER, "Elsewhere")
    real = dest_folder.heal_missing_dest_folder

    def repointed(user_id, source_id):
        _x("UPDATE j2_note_sources SET dest_folder_id = ? WHERE id = ?", (elsewhere["id"], source_id))
        return real(user_id, source_id)

    monkeypatch.setattr(dest_folder, "heal_missing_dest_folder", repointed)
    await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    assert _note("a")["folder_id"] == elsewhere["id"]


@pytest.mark.parametrize("state", ["disabled", "paused"])
async def test_a_disabled_or_paused_source_is_never_repaired(db, monkeypatch, state):
    src = _source()
    _drop_folder_raw(src["destFolderId"])
    if state == "disabled":
        connections.set_source_status(USER, src["id"], "disabled")
        expected = dest_folder.dest_folder_disabled_sentence("Notion")
    else:
        connections.set_sync_enabled(USER, src["id"], False)
        expected = dest_folder.dest_folder_gone_sentence("Notion")
    result = await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    assert _folders_named("Notion — Acme") == []
    assert connections.get_source_by_id(src["id"])["destFolderId"] == src["destFolderId"]
    assert result["created"] == 0 and result["status"] == "warning"
    row = connections.get_source_by_id(src["id"])
    # M2: a failure a retry cannot fix never promises a retry, and says what to do.
    assert "tried again" not in row["lastSyncError"]
    assert row["lastSyncError"] == expected
    if state == "disabled":  # review M3: a member cannot clear 'disabled'; never "turn sync on"
        assert "Turn sync back on" not in expected
    assert _log_failures(src) == []  # N2: the pass stored nothing and named no note; the row says it once


def test_a_broken_source_is_repaired(db):
    """Review M3: 'broken' is cleared by the very pass that runs the heal (auth worked)."""
    src = _source()
    _drop_folder_raw(src["destFolderId"])
    connections.set_source_status(USER, src["id"], "broken")
    assert dest_folder.heal_missing_dest_folder(USER, src["id"]).outcome == "remade"


def test_a_disconnected_source_is_never_given_a_folder(db):
    src = _source()
    _drop_folder_raw(src["destFolderId"])
    connections.delete_connector(USER, "notion")
    assert dest_folder.heal_missing_dest_folder(USER, src["id"]).outcome == "gone"
    assert _folders_named("Notion — Acme") == []


async def test_a_folder_that_cannot_be_made_leaves_the_source_for_the_next_pass(db, monkeypatch):
    """Review M5: never a silent None. The row keeps its id, the member is told it is retried,
    and the next pass repairs it."""
    src = _source()
    _drop_folder_raw(src["destFolderId"])
    real = dest_folder.default_folder_id
    monkeypatch.setattr(dest_folder, "default_folder_id", lambda *a, **k: None)
    first = await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    row = connections.get_source_by_id(src["id"])
    assert first["created"] == 0 and row["destFolderId"] == src["destFolderId"]
    assert row["lastSyncError"] == dest_folder.DEST_FOLDER_RETRY_SENTENCE
    monkeypatch.setattr(dest_folder, "default_folder_id", real)
    second = await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    assert second["created"] == 1 and _folders_named("Notion — Acme")


# ── review I1: a source that already imported goes to the ROOT ──────────────

async def test_a_source_with_imports_is_pointed_at_the_root_not_a_new_folder(db, monkeypatch):
    src = _source()
    await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    _drop_folder_raw(src["destFolderId"])
    _x("UPDATE j2_notes SET folder_id = NULL WHERE import_key = ?", ("fake:ws1:a",))  # where it climbed to
    await _pass(monkeypatch, src, Fake({"a": (1, []), "b": (2, [])}))
    assert connections.get_source_by_id(src["id"])["destFolderId"] is None
    assert _folders_named("Notion — Acme") == []
    assert _note("a")["folder_id"] is None  # unchanged remote: left exactly where it is
    assert _note("b")["folder_id"] is None


async def test_a_path_bearing_source_keeps_one_folder_tree_after_the_old_delete(db, monkeypatch):
    """`probe_path.py`: the pre-fix delete moved "Notion — Acme"/Trading to the root and left the
    source on the dead id. A remote edit must land in that SAME Trading, never a second tree
    under a recreated "Notion — Acme"; and, the move not being an edit, never a conflict copy."""
    src = _source()
    await _pass(monkeypatch, src, Fake({"a": (1, ["Trading"]), "b": (1, ["Trading"])}))
    old = src["destFolderId"]
    notes_svc.delete_folder(USER, old)
    _x("UPDATE j2_note_sources SET dest_folder_id = ? WHERE id = ?", (old, src["id"]))  # pre-fix state
    r = await _pass(monkeypatch, src, Fake({"a": (5, ["Trading"]), "b": (1, ["Trading"])}))
    assert r["status"] == "ok" and r["conflicts"] == 0 and r["updated"] == 1
    trading = _q("SELECT id, parent_id FROM j2_note_folders WHERE name = 'Trading'")
    assert len(trading) == 1 and trading[0]["parent_id"] == ""
    assert _note("a")["folder_id"] == trading[0]["id"] == _note("b")["folder_id"]
    assert _folders_named("Notion — Acme") == []
    assert not _q("SELECT 1 FROM j2_notes WHERE title LIKE '%(synced copy)%'")


async def test_obsidian_vault_subfolders_land_under_the_recreated_vault_folder(db, monkeypatch):
    """A source that has imported nothing yet gets its default folder back."""
    src = _source(provider="obsidian", remote_id="v1", display_name=None)
    assert _folders_named("Obsidian — Vault (v1)")
    _drop_folder_raw(src["destFolderId"])
    await _pass(monkeypatch, src, Fake({"a": (1, ["Trading", "Setups"])}), )
    healed = connections.get_source_by_id(src["id"])["destFolderId"]
    assert [f["id"] for f in _folders_named("Obsidian — Vault (v1)")] == [healed]
    setups = _q("SELECT id, parent_id FROM j2_note_folders WHERE name = 'Setups'")[0]
    trading = _q("SELECT id, parent_id FROM j2_note_folders WHERE name = 'Trading'")[0]
    assert trading["parent_id"] == healed and setups["parent_id"] == trading["id"]
    assert _note("a", "v1")["folder_id"] == setups["id"]


async def test_a_folder_deleted_mid_pass_heals_in_that_pass(db, monkeypatch):
    """The check at the start of the pass found the folder; it vanished before the confirm. The
    failing batch repairs it, so "will be saved there on the next sync" is true."""
    src = _source()
    real_confirm = notes_svc.import_confirm
    calls = {"n": 0}

    def vanishing(user_id, payload, **kw):
        if calls["n"] == 0:
            _drop_folder_raw(payload["destFolderId"])
        calls["n"] += 1
        return real_confirm(user_id, payload, **kw)

    monkeypatch.setattr(notes_svc, "import_confirm", vanishing)
    first = await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    assert first["created"] == 0
    row = connections.get_source_by_id(src["id"])
    assert row["destFolderId"] != src["destFolderId"] and _folders_named("Notion — Acme")
    assert row["lastSyncError"] == dest_folder.dest_folder_remade_sentence("Notion — Acme")
    second = await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    assert second["created"] == 1 and _note("a")["folder_id"] == row["destFolderId"]


def test_every_folder_sentence_carries_the_prefix_the_engine_reads():
    for s in (dest_folder.dest_folder_remade_sentence("X"), dest_folder.DEST_FOLDER_MOVED_SENTENCE,
              dest_folder.DEST_FOLDER_RETRY_SENTENCE, dest_folder.dest_folder_gone_sentence("Notion"),
              dest_folder.dest_folder_disabled_sentence("Notion")):
        assert dest_folder.is_dest_folder_sentence(s), s


# ── behaviour 2: delete_folder re-points ─────────────────────────────────────

def test_deleting_a_root_dest_folder_points_the_source_at_the_root(db):
    src = _source()
    other = _source(user=OTHER)
    assert notes_svc.delete_folder(USER, src["destFolderId"])
    assert connections.get_source_by_id(src["id"])["destFolderId"] is None
    assert connections.get_source_by_id(other["id"])["destFolderId"] == other["destFolderId"]


def test_deleting_a_nested_dest_folder_points_the_source_at_its_parent(db):
    parent = notes_svc.create_folder(USER, "Imports")
    child = notes_svc.create_folder(USER, "Notion", parent_id=parent["id"])
    connections.upsert_connector(USER, "notion", {"accessToken": "t"}, account_label="Acme")
    src = connections.create_source(USER, "notion", "ws1", display_name="Acme", dest_folder_id=child["id"])
    assert notes_svc.delete_folder(USER, child["id"])
    assert connections.get_source_by_id(src["id"])["destFolderId"] == parent["id"]


def test_deleting_a_parent_keeps_a_source_on_its_child(db):
    """A parent's delete re-parents its children; the child survives, so the source stays on it."""
    parent = notes_svc.create_folder(USER, "Imports")
    child = notes_svc.create_folder(USER, "Notion", parent_id=parent["id"])
    connections.upsert_connector(USER, "notion", {"accessToken": "t"}, account_label="Acme")
    src = connections.create_source(USER, "notion", "ws1", display_name="Acme", dest_folder_id=child["id"])
    assert notes_svc.delete_folder(USER, parent["id"])
    assert connections.get_source_by_id(src["id"])["destFolderId"] == child["id"]


async def test_a_source_pointed_at_the_root_imports_there_with_no_heal(db, monkeypatch):
    src = _source()
    notes_svc.delete_folder(USER, src["destFolderId"])
    result = await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    assert result["status"] == "ok" and result["created"] == 1
    assert _note("a")["folder_id"] is None
    assert connections.get_source_by_id(src["id"])["destFolderId"] is None
    assert _folders_named("Notion — Acme") == []  # root is a real destination, not a missing one


# ── review I2: a folder move is not a content edit ───────────────────────────

def _stamps(rid: str) -> dict:
    return _q("SELECT updated_at, imported_at FROM j2_notes WHERE import_key = ?", (f"fake:ws1:{rid}",))[0]


async def test_deleting_the_folder_keeps_an_unedited_import_unedited(db, monkeypatch):
    """`probe_conflict.py`: the move bumped `updated_at` alone, so the next remote edit read as a
    member edit and made a "(synced copy)". It now moves `imported_at` with it."""
    src = _source()
    await _pass(monkeypatch, src, Fake({"a": (1, []), "b": (1, [])}))
    notes_svc.delete_folder(USER, src["destFolderId"])
    st = _stamps("a")
    assert st["updated_at"] == st["imported_at"]
    r = await _pass(monkeypatch, src, Fake({"a": (5, []), "b": (1, [])}))
    assert r["conflicts"] == 0 and r["updated"] == 1
    assert not _q("SELECT 1 FROM j2_notes WHERE title LIKE '%(synced copy)%'")


async def test_deleting_the_folder_never_hides_a_member_edit(db, monkeypatch):
    """The negative case: a note the member edited stays edited, so a remote change still makes a
    copy instead of overwriting their work."""
    src = _source()
    await _pass(monkeypatch, src, Fake({"a": (1, []), "b": (1, [])}))
    _x("UPDATE j2_notes SET updated_at = '2099-01-01T00:00:00+00:00', body_plain = 'mine' "
       "WHERE import_key = ?", ("fake:ws1:b",))
    before = _stamps("b")["imported_at"]
    notes_svc.delete_folder(USER, src["destFolderId"])
    assert _stamps("b")["imported_at"] == before
    r = await _pass(monkeypatch, src, Fake({"a": (1, []), "b": (5, [])}))
    assert r["conflicts"] == 1
    assert _q("SELECT 1 FROM j2_notes WHERE title LIKE '%(synced copy)%'")


def test_deleting_the_folder_leaves_a_hand_written_note_alone(db):
    folder = notes_svc.create_folder(USER, "Mine")
    note = notes_svc.create_note(USER, {"title": "hand", "folderId": folder["id"]})
    imported = _q("SELECT imported_at FROM j2_notes WHERE id = ?", (note["id"],))[0]["imported_at"]
    notes_svc.delete_folder(USER, folder["id"])
    assert _q("SELECT imported_at FROM j2_notes WHERE id = ?", (note["id"],))[0]["imported_at"] == imported


# ── behaviour 3: the member's words ──────────────────────────────────────────

async def test_the_source_error_has_no_batch_jargon_and_no_raw_note_id(db, monkeypatch):
    src = _source()
    await _pass(monkeypatch, src, Fake({"a": (1, []), "b": (2, [])}, bad_media={"b"}))
    row = connections.get_source_by_id(src["id"])
    text = row["lastSyncError"] or ""
    note_b = _note("b")["id"]
    assert text, "an image that didn't come over must still be reported"
    for leak in ("batch", "confirm failed", note_b, "media '", "fake:ws1"):
        assert leak not in text, f"developer text reached the member: {text!r}"
    assert text == engine.NOTES_INCOMPLETE_REASON
    assert "didn't come over" not in text  # review M6: the Recent syncs toggle already says it
    assert any(f["noteTitle"] == "Note b" for f in _log_failures(src))


async def test_a_fetch_failure_is_counted_not_pointed_at_the_log(db, monkeypatch):
    """Review M6: the log rows never name a note whose fetch failed, so the row says how many and
    that they are retried, beside the per-note pointer."""
    src = _source()

    class FailsC(Fake):
        async def fetch(self, credentials, r):
            if r.remote_id == "c":
                raise errors.NoteConnTransient("timeout talking to api.notion.com for page c")
            return await super().fetch(credentials, r)

    await _pass(monkeypatch, src, FailsC({"a": (1, []), "b": (2, []), "c": (3, [])}, bad_media={"b"}))
    text = connections.get_source_by_id(src["id"])["lastSyncError"]
    assert text == ("1 note couldn't be read from Notion this time. It will be tried again on the "
                    "next sync. " + engine.NOTES_INCOMPLETE_REASON)
    assert "api.notion.com" not in text


@pytest.mark.parametrize("auth", [False, True])
async def test_a_pass_that_stops_shows_a_sentence_and_logs_the_raw_text(db, monkeypatch, caplog, auth):
    """Review M7: the hard-error path never puts `str(e)` on the source row."""
    import logging
    caplog.set_level(logging.WARNING)
    src = _source()
    raw = "sqlite3.OperationalError: secret_internal_column"

    class Stops(Fake):
        async def list_changed(self, credentials, cursor=None):
            raise errors.NoteConnAuthError(raw) if auth else RuntimeError(raw)

    with pytest.raises(Exception):
        await _pass(monkeypatch, src, Stops({}))
    row = connections.get_source_by_id(src["id"])
    expected = (engine.RECONNECT_REASON if auth else engine.SYNC_STOPPED_REASON).format(label="Notion")
    assert row["lastSyncError"] == expected and raw not in row["lastSyncError"]
    assert raw in caplog.text


# ── fix round 2 (re-review N1-N4) ────────────────────────────────────────────

async def test_a_pass_that_cannot_repair_lists_and_stores_nothing_and_keeps_the_cursor(db, monkeypatch):
    """N2: a paused source's missing folder refuses every batch, so the pass does not list, fetch
    or confirm at all (nor take the write lock per batch), and the cursor stays where it was so
    nothing is skipped once the folder is repaired."""
    src = _source()
    connections.update_cursor(USER, src["id"], "2026-01-02T00:00:00.000+00:00")
    _drop_folder_raw(src["destFolderId"])
    connections.set_sync_enabled(USER, src["id"], False)
    calls = {"list": 0, "confirm": 0}

    class Counting(Fake):
        async def list_changed(self, credentials, cursor=None):
            calls["list"] += 1
            return await super().list_changed(credentials, cursor)

    def no_confirm(*_a, **_k):
        calls["confirm"] += 1
        raise AssertionError("confirm ran on a pass that cannot store")

    monkeypatch.setattr(notes_svc, "import_confirm", no_confirm)
    result = await _pass(monkeypatch, src, Counting({"a": (5, [])}))
    assert calls == {"list": 0, "confirm": 0}
    assert result["status"] == "warning" and result["created"] == 0
    row = connections.get_source_by_id(src["id"])
    assert row["cursor"] == "2026-01-02T00:00:00.000+00:00"
    assert row["lastSyncError"] == dest_folder.dest_folder_gone_sentence("Notion")


class Versioned(Fake):
    """The body carries the revision, so a remote edit changes the payload hash."""

    async def fetch(self, credentials, r):
        rn = await super().fetch(credentials, r)
        rn.doc = _doc(f"body {r.remote_id} {r.updated_at}")
        return rn


async def test_a_legacy_row_keeps_its_imported_at_through_a_folder_delete(db, monkeypatch):
    """N1: a legacy row (no stored remote revision) is judged by `remote revision > imported_at`.
    A remote edit R1 made before the delete and not yet synced, then a member edit: advancing
    `imported_at` past R1 would make the engine read the remote as unchanged and miss R1 for
    good. The row keeps its stamp, so the pass keeps both versions."""
    src = _source()
    await _pass(monkeypatch, src, Versioned({"a": (1, [])}))
    _x("UPDATE j2_notes SET import_remote_rev = NULL, updated_at = '2026-01-01T00:00:00+00:00', "
       "imported_at = '2026-01-02T00:00:00+00:00' WHERE import_key = ?", ("fake:ws1:a",))
    notes_svc.delete_folder(USER, src["destFolderId"])  # T (now) > R1 (Jan 5) > imported_at
    assert _stamps("a")["imported_at"] == "2026-01-02T00:00:00+00:00"
    _x("UPDATE j2_notes SET updated_at = '2099-01-01T00:00:00+00:00' WHERE import_key = ?",
       ("fake:ws1:a",))  # the member's edit
    r = await _pass(monkeypatch, src, Versioned({"a": (5, [])}))
    assert r["conflicts"] == 1, "remote edit R1 was missed"


@pytest.mark.parametrize("stamp", [None, "not a date"])
def test_an_unreadable_imported_at_survives_a_folder_delete(db, stamp):
    """N3: an import-keyed note whose `imported_at` is NULL or unreadable is left as it is."""
    folder = notes_svc.create_folder(USER, "Mine")
    note = notes_svc.create_note(USER, {"title": "n", "folderId": folder["id"]})
    _x("UPDATE j2_notes SET import_key = 'fake:ws1:z', import_remote_rev = 'r1', imported_at = ? "
       "WHERE id = ?", (stamp, note["id"]))
    notes_svc.delete_folder(USER, folder["id"])
    assert _q("SELECT imported_at FROM j2_notes WHERE id = ?", (note["id"],))[0]["imported_at"] == stamp


def test_a_cut_name_ending_on_a_space_reuses_the_folder_it_names(db):
    """N4: `create_folder` stores the name stripped; the reuse must compare the same string."""
    name = "x" * 79 + " tail"  # the 80-char cut ends on the space
    existing = notes_svc.create_folder(USER, "x" * 79)
    assert dest_folder.default_folder_id(USER, name) == existing["id"]
    assert len(_folders_named("x" * 79)) == 1
