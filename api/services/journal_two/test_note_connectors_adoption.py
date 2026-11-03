"""Plan E Task 8: notes imported earlier from `.enex` are adopted into live Evernote sync.

Real schema, a real `.enex`-shaped `import_confirm` for the file rows, and the real engine pass
(`engine.sync_source`) for the live side. The provider is a stand-in returning recorded-shape
`RemoteNote`s; no network.
"""

from __future__ import annotations

import json

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services import auth_db
from api.services.journal_two import import_provenance
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.note_connectors import engine
from api.services.journal_two.note_connectors.convert import enml
from api.services.journal_two.note_connectors.providers.base import (
    AccountInfo, NoteProvider, RemoteNote, RemoteRef,
)

USER = "u1"
CREATED = "2026-03-04T10:15:00.000+00:00"
UPDATED = "2026-03-05T08:00:00.000+00:00"
LATER = "2026-06-01T09:00:00.000+00:00"


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    monkeypatch.setenv("NOTE_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")

    async def creds(user_id, provider_name):
        return {"accessToken": "t"}

    monkeypatch.setattr(engine, "_resolve_credentials", creds)
    import api.services.journal_two.note_connectors.connections as conns
    return conns


def _doc(text: str) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}]}


class LiveEvernote(NoteProvider):
    """Recorded-shape stand-in for EvernoteProvider: the live key space and the adoption flag."""
    name = "evernote"
    adopt_import_source = "evernote"

    def __init__(self, notes: list[RemoteNote], item_failures: list[dict] | None = None):
        self.notes = {n.remote_id: n for n in notes}
        self._failures = list(item_failures or [])

    def import_key(self, source_remote_id, remote_id):
        return enml.live_import_key(remote_id)

    async def validate(self, credentials):
        return AccountInfo(label="Evernote")

    async def list_changed(self, credentials, cursor=None):
        return [RemoteRef(remote_id=r, updated_at=n.updated_at) for r, n in self.notes.items()]

    async def fetch(self, credentials, ref):
        return self.notes[ref.remote_id]

    async def fetch_media(self, credentials, ref):
        raise AssertionError("no media")

    def drain_item_failures(self):
        out, self._failures = self._failures, []
        return out


class PlainProvider(LiveEvernote):
    """Same notes, no `adopt_import_source`: every other provider."""
    adopt_import_source = None


def _rn(guid="G", title="Plan", text="body text", created=CREATED, updated=UPDATED) -> RemoteNote:
    return RemoteNote(remote_id=guid, title=title, doc=_doc(text), created_at=created, updated_at=updated)


def _enex(title="Plan", text="body text", created=CREATED, updated=UPDATED, key=None) -> str:
    key = key or f"evernote:Notebook/{title}/{created}"
    notes_svc.import_confirm(USER, {"source": "evernote", "destFolderId": None, "notes": [{
        "importKey": key, "title": title, "bodyJson": _doc(text), "tags": [],
        "folderPath": ["Notebook"], "createdAt": created, "updatedAt": updated}]})
    return key


def _rows() -> list[dict]:
    conn = auth_db.get_connection()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT id, title, import_key, updated_at, imported_at, body_plain, import_remote_rev, "
            "deleted_at FROM j2_notes WHERE user_id = ? ORDER BY created_at, id", (USER,))]
    finally:
        conn.close()


def _edit(key: str, text: str = "member edit") -> None:
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE j2_notes SET body_json = ?, body_plain = ?, updated_at = ? "
                     "WHERE import_key = ?", (json.dumps(_doc(text)), text, "2099-01-01T00:00:00+00:00", key))
        conn.commit()
    finally:
        conn.close()


async def _sync(tmp_db, monkeypatch, provider) -> tuple[dict, dict]:
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: provider)
    if tmp_db.get_connector(USER, "evernote") is None:
        tmp_db.upsert_connector(USER, "evernote", {"accessToken": "t"}, account_label="Evernote")
    src = next((s for s in tmp_db.list_sources(USER) if s["provider"] == "evernote"), None) \
        or tmp_db.create_source(USER, "evernote", "account", display_name="Evernote")
    result = await engine.sync_source(src["id"], manual=True)
    return result, src


def _log_rows(source_id: str) -> list[dict]:
    conn = auth_db.get_connection()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM j2_note_sync_log WHERE source_id = ? ORDER BY id", (source_id,))]
    finally:
        conn.close()


LIVE = enml.live_import_key("G")


async def test_unedited_enex_note_is_adopted_and_updated_in_place_no_duplicate(tmp_db, monkeypatch):
    _enex(text="old body")
    before = _rows()
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(text="new body")]))
    after = _rows()
    assert len(before) == len(after) == 1
    assert after[0]["id"] == before[0]["id"]
    assert after[0]["import_key"] == LIVE
    assert after[0]["body_plain"].strip() == "new body"
    assert result["adopted"] == 1 and result["created"] == 0 and result["updated"] == 1


async def test_edited_enex_note_remote_unchanged_is_left_alone(tmp_db, monkeypatch):
    key = _enex()
    _edit(key)
    edited = _rows()[0]
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(updated=UPDATED)]))
    rows = _rows()
    assert len(rows) == 1
    assert rows[0]["import_key"] == LIVE
    assert rows[0]["body_plain"] == "member edit"
    assert rows[0]["updated_at"] == edited["updated_at"]
    assert result["adopted"] == 1 and result["conflicts"] == 0


async def test_edited_enex_note_remote_changed_gets_synced_copy_sibling(tmp_db, monkeypatch):
    key = _enex()
    _edit(key)
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(text="remote moved", updated=LATER)]))
    rows = _rows()
    assert len(rows) == 2
    original = next(r for r in rows if r["import_key"] == LIVE)
    sibling = next(r for r in rows if r["import_key"] == f"{LIVE}#remote")
    assert original["body_plain"] == "member edit"
    assert sibling["title"] == "Plan (synced copy)" and "remote moved" in sibling["body_plain"]
    assert result["adopted"] == 1 and result["conflicts"] == 1


async def test_two_file_notes_same_title_and_minute_are_not_adopted(tmp_db, monkeypatch):
    k1 = _enex(text="first", key="evernote:A/Plan/x")
    k2 = _enex(text="second", key="evernote:B/Plan/x")
    result, src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(text="third")]))
    rows = _rows()
    assert {r["import_key"] for r in rows} == {k1, k2, LIVE}
    assert {r["body_plain"].strip() for r in rows if r["import_key"] in (k1, k2)} == {"first", "second"}
    assert result["adopted"] == 0 and result["created"] == 1
    assert 'adoption ambiguous: "Plan"' in result["failures"]


async def test_plain_text_tie_break_adopts_the_single_match(tmp_db, monkeypatch):
    k1 = _enex(text="first", key="evernote:A/Plan/x")
    _enex(text="the   same\nbody", key="evernote:B/Plan/x")
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(text="the same body")]))
    rows = _rows()
    assert {r["import_key"] for r in rows} == {k1, LIVE}
    assert result["adopted"] == 1 and result["created"] == 0
    assert not any("adoption ambiguous" in f for f in result["failures"])


async def test_trashed_file_note_is_never_adopted(tmp_db, monkeypatch):
    key = _enex()
    note_id = _rows()[0]["id"]
    notes_svc.delete_note(USER, note_id)
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn()]))
    rows = _rows()
    trashed = next(r for r in rows if r["id"] == note_id)
    assert trashed["import_key"] == key and trashed["deleted_at"]
    assert any(r["import_key"] == LIVE and not r["deleted_at"] for r in rows)
    assert result["adopted"] == 0 and result["created"] == 1


async def test_adoption_matches_stripped_title_and_zone_spellings(tmp_db, monkeypatch):
    # The file row: "Plan" at 10:15:42Z. The live note: "  Plan  " at 05:15:07.123-05:00, same minute.
    _enex(title="Plan", created="2026-03-04T10:15:42Z")
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([
        _rn(title="  Plan  ", created="2026-03-04T05:15:07.123-05:00")]))
    assert result["adopted"] == 1 and result["created"] == 0
    assert [r["import_key"] for r in _rows()] == [LIVE]


async def test_a_different_minute_is_not_adopted(tmp_db, monkeypatch):
    _enex(created="2026-03-04T10:15:59Z")
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(created="2026-03-04T10:16:00Z")]))
    assert result["adopted"] == 0 and result["created"] == 1


async def test_a_live_row_is_never_adopted_by_another_live_note(tmp_db, monkeypatch):
    """Live rows share `import_source` with `.enex` rows; only the key prefix tells them apart. A
    second live note of the same title and minute is created, never moved onto the first's row."""
    await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(guid="G")]))
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(guid="G"), _rn(guid="H")]))
    assert {r["import_key"] for r in _rows()} == {LIVE, enml.live_import_key("H")}
    assert result["adopted"] == 0 and result["created"] == 1


async def test_adoption_does_not_touch_updated_at_or_imported_at(tmp_db, monkeypatch):
    from api.services.journal_two.note_connectors import adoption
    key = _enex()
    before = _rows()[0]
    conn = auth_db.get_connection()
    try:
        adopted, failures = adoption.adopt_file_imports(conn, USER, "evernote", [(LIVE, _rn())])
        conn.commit()
    finally:
        conn.close()
    after = _rows()[0]
    assert adopted == [{"fromKey": key, "toKey": LIVE, "noteId": before["id"]}] and failures == []
    assert after["updated_at"] == before["updated_at"]
    assert after["imported_at"] == before["imported_at"]
    assert after["import_key"] == LIVE


async def test_adoption_sets_remote_rev_only_when_same_instant(tmp_db, monkeypatch):
    from api.services.journal_two.note_connectors import adoption
    _enex(title="Same", updated="2026-03-05T08:00:00Z")
    _enex(title="Moved", updated="2026-03-05T08:00:00Z")
    live_same = "2026-03-05T03:00:00.000-05:00"   # the same second, spelled differently
    live_moved = "2026-03-05T08:00:01.000+00:00"  # one second later
    conn = auth_db.get_connection()
    try:
        adoption.adopt_file_imports(conn, USER, "evernote", [
            (enml.live_import_key("S"), _rn(guid="S", title="Same", updated=live_same)),
            (enml.live_import_key("M"), _rn(guid="M", title="Moved", updated=live_moved))])
        conn.commit()
    finally:
        conn.close()
    revs = {r["title"]: r["import_remote_rev"] for r in _rows()}
    assert revs == {"Same": live_same, "Moved": "2026-03-05T08:00:00Z"}


async def test_providers_without_the_attribute_are_unaffected(tmp_db, monkeypatch):
    from api.services.journal_two.note_connectors import adoption
    calls: list = []
    monkeypatch.setattr(adoption, "adopt_file_imports", lambda *a, **k: calls.append(a) or ([], []))
    key = _enex()
    result, _src = await _sync(tmp_db, monkeypatch, PlainProvider([_rn()]))
    assert calls == []
    assert {r["import_key"] for r in _rows()} == {key, LIVE}
    assert result["created"] == 1 and result["adopted"] == 0


async def test_second_pass_adopts_nothing_and_changes_nothing(tmp_db, monkeypatch):
    _enex(text="old body")
    provider_notes = [_rn(text="new body")]
    first, _src = await _sync(tmp_db, monkeypatch, LiveEvernote(provider_notes))
    snapshot = _rows()
    second, _src = await _sync(tmp_db, monkeypatch, LiveEvernote(provider_notes))
    assert first["adopted"] == 1
    assert second["adopted"] == 0 and second["created"] == 0 and second["updated"] == 0
    assert _rows() == snapshot


async def test_adopted_count_is_written_to_the_sync_log_row(tmp_db, monkeypatch):
    _enex()
    _first, src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(text="new")]))
    await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(text="new")]))
    assert [r["adopted"] for r in _log_rows(src["id"])] == [1, 0]


def _router_client(monkeypatch) -> TestClient:
    from api.middleware import auth_middleware as authmw
    from api.routers import note_sync as ns
    monkeypatch.setenv("PUSH_SECRET", "test-push-secret")
    app = FastAPI()
    app.include_router(ns.router)
    app.dependency_overrides[authmw.get_current_user] = lambda: {"id": USER, "role": "member"}
    return TestClient(app)


async def test_source_log_rows_carry_adopted(tmp_db, monkeypatch):
    _enex()
    _result, src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(text="new")]))
    rows = _router_client(monkeypatch).get(
        f"/api/j2/notes/connectors/sources/{src['id']}/log").json()["rows"]
    assert rows[0]["adopted"] == 1


async def test_status_counts_shape_is_unchanged(tmp_db, monkeypatch):
    from api.routers import note_sync as ns
    _enex()
    await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(text="new")]))
    status = _router_client(monkeypatch).get("/api/j2/notes/connectors/status").json()
    counts = status["providers"]["evernote"]["sources"][0]["counts"]
    assert set(counts) == set(ns._ZERO_COUNTS) and "adopted" not in counts


async def test_ambiguous_adoption_reaches_failures_json_in_plan_d_shape(tmp_db, monkeypatch):
    _enex(text="first", key="evernote:A/Plan/x")
    _enex(text="second", key="evernote:B/Plan/x")
    _result, src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(text="third")]))
    row = _log_rows(src["id"])[-1]
    assert json.loads(row["failures_json"]) == [
        {"noteTitle": "Plan", "reason": 'adoption ambiguous: "Plan"', "name": None}]
    assert 'adoption ambiguous: "Plan"' in row["error"]


async def test_provider_item_failures_reach_failures_json_and_error(tmp_db, monkeypatch):
    shape = {"noteTitle": "Odd note", "reason": "evernote note shape: missing created", "name": None}
    result, src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn()], item_failures=[shape]))
    row = _log_rows(src["id"])[-1]
    assert json.loads(row["failures_json"]) == [shape]
    assert "evernote note shape: missing created" in row["error"]
    assert "evernote note shape: missing created" in result["failures"]


async def test_adoption_uses_the_shared_instant_parser(tmp_db, monkeypatch):
    from api.services.journal_two.note_connectors import adoption
    seen: list = []
    real = import_provenance.instant

    def spy(value):
        seen.append(value)
        return real(value)

    monkeypatch.setattr(import_provenance, "instant", spy)
    _enex(created="2026-03-04T10:15:42Z")
    conn = auth_db.get_connection()
    try:
        adoption.adopt_file_imports(conn, USER, "evernote", [(LIVE, _rn(created=CREATED))])
    finally:
        conn.close()
    assert CREATED in seen and "2026-03-04T10:15:42Z" in seen
