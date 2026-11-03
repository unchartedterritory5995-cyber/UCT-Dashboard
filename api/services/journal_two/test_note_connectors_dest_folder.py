"""A connector source whose destination folder was deleted (live audit 2026-11-03, H1/M2).

Found in production: a Notion source pointed at a folder the member had deleted. Every pass,
`import_confirm` refused the whole batch ("destination folder not found"), the member was told the
notes "will be tried again on the next sync", the cursor stayed pinned, and 20 of 20 log rows read
"warning" with nothing stored. Nothing could ever succeed.

  * Self-heal: a pass whose source points at a missing folder recreates the source's default
    folder (the connect flow's own "<Provider> — <account>" name, `dest_folder`) and re-points
    the source, then imports normally. Never for a disabled, paused or disconnected source;
    idempotent; nothing already imported is moved.
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
                        lambda *a, **k: dest_folder.HealResult("refused", None))
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
    assert first.outcome == "healed" and second.outcome == "present"
    assert first.dest_folder_id == second.dest_folder_id
    assert len(_folders_named("Notion — Acme")) == 1


def test_heal_reuses_a_root_folder_that_already_has_the_name(db):
    """Two sources of one account, or a member who made the folder by hand: the connect flow
    reuses the root folder of that name, and so does the heal. Never a second one."""
    src = _source()
    _drop_folder_raw(src["destFolderId"])
    mine = notes_svc.create_folder(USER, "Notion — Acme")
    assert dest_folder.heal_missing_dest_folder(USER, src["id"]).dest_folder_id == mine["id"]
    assert len(_folders_named("Notion — Acme")) == 1


@pytest.mark.parametrize("state", ["disabled", "paused"])
async def test_a_disabled_or_paused_source_is_never_given_a_folder(db, monkeypatch, state):
    src = _source()
    _drop_folder_raw(src["destFolderId"])
    if state == "disabled":
        connections.set_source_status(USER, src["id"], "disabled")
    else:
        connections.set_sync_enabled(USER, src["id"], False)
    result = await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    assert _folders_named("Notion — Acme") == []
    assert result["created"] == 0 and result["status"] == "warning"
    row = connections.get_source_by_id(src["id"])
    # M2: a failure a retry cannot fix never promises a retry, and says what to do.
    assert "tried again" not in row["lastSyncError"]
    assert row["lastSyncError"] == dest_folder.dest_folder_gone_sentence("Notion")
    reasons = {f["reason"] for f in _log_failures(src)}
    assert reasons == {dest_folder.dest_folder_gone_sentence("Notion")}


def test_a_disconnected_source_is_never_given_a_folder(db):
    src = _source()
    _drop_folder_raw(src["destFolderId"])
    connections.delete_connector(USER, "notion")
    assert dest_folder.heal_missing_dest_folder(USER, src["id"]).outcome == "gone"
    assert _folders_named("Notion — Acme") == []


async def test_the_heal_moves_no_note_already_imported(db, monkeypatch):
    src = _source()
    await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    _drop_folder_raw(src["destFolderId"])
    _x("UPDATE j2_notes SET folder_id = NULL WHERE import_key = ?", ("fake:ws1:a",))  # where it climbed to
    await _pass(monkeypatch, src, Fake({"a": (1, []), "b": (2, [])}))
    healed = connections.get_source_by_id(src["id"])["destFolderId"]
    assert _note("a")["folder_id"] is None  # unchanged remote: left exactly where it is
    assert _note("b")["folder_id"] == healed


async def test_obsidian_vault_subfolders_land_under_the_recreated_vault_folder(db, monkeypatch):
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


async def test_a_folder_deleted_mid_pass_heals_at_the_end_of_that_pass(db, monkeypatch):
    """The heal at the start of the pass found the folder; it vanished before the confirm. The
    pass heals again before it finishes, so "will be saved on the next sync" is true."""
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
    assert row["lastSyncError"] == dest_folder.DEST_FOLDER_REMADE_SENTENCE
    second = await _pass(monkeypatch, src, Fake({"a": (1, [])}))
    assert second["created"] == 1 and _note("a")["folder_id"] == row["destFolderId"]


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
    assert text == "1 item didn't come over. Open Recent syncs to see which."
    # the log row names the note by its title
    assert any(f["noteTitle"] == "Note b" for f in _log_failures(src))
