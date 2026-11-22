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


async def test_a_long_title_adopts_through_the_file_importers_own_truncation(tmp_db, monkeypatch):
    """Task 8 concern 1: the file importer stored the title cut to MAX_TITLE_CHARS; the live title
    goes through the SAME rule before comparing, so the note adopts instead of duplicating."""
    long_title = "  " + "Quarterly plan " * 30 + "  "  # 450+ chars, padded
    assert len(long_title.strip()) > notes_svc.MAX_TITLE_CHARS
    _enex(title=long_title, key="evernote:Notebook/long/x")
    stored = _rows()[0]["title"]
    assert len(stored) == notes_svc.MAX_TITLE_CHARS
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(title=long_title)]))
    assert result["adopted"] == 1 and result["created"] == 0
    assert [r["import_key"] for r in _rows()] == [LIVE]


async def test_two_live_notes_matching_one_file_row_name_the_second(tmp_db, monkeypatch):
    """Task 8 concern 4: one file row, two live notes of its title and minute. The one whose body
    is the row's adopts it (I1: by body, never by order); the other imports as new and is NAMED as
    ambiguous, never silently."""
    key = _enex()
    file_id = _rows()[0]["id"]
    result, src = await _sync(tmp_db, monkeypatch, LiveEvernote([
        _rn(guid="G"), _rn(guid="H", text="something else")]))
    rows = _rows()
    assert {r["import_key"] for r in rows} == {LIVE, enml.live_import_key("H")}
    assert next(r for r in rows if r["import_key"] == LIVE)["id"] == file_id and key not in {
        r["import_key"] for r in rows}
    assert result["adopted"] == 1 and result["created"] == 1
    assert 'adoption ambiguous: "Plan"' in result["failures"]
    assert json.loads(_log_rows(src["id"])[-1]["failures_json"]) == [
        {"noteTitle": "Plan", "reason": 'adoption ambiguous: "Plan"', "name": None}]


async def test_one_file_row_two_live_notes_the_body_twin_adopts_not_the_first_listed(tmp_db, monkeypatch):
    """Task 8 review I1, the reviewer's reproduction: one `.enex` row "Plan" with body "alpha";
    live X ("beta") is listed BEFORE live Y ("alpha"). Y is the row's twin and must hold it; X
    imports as new, and X's text never overwrites the row."""
    _enex(text="alpha")
    file_id = _rows()[0]["id"]
    x_key, y_key = enml.live_import_key("X"), enml.live_import_key("Y")
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([
        _rn(guid="X", text="beta"), _rn(guid="Y", text="alpha")]))
    rows = {r["import_key"]: r for r in _rows()}
    assert set(rows) == {x_key, y_key}
    assert rows[y_key]["id"] == file_id and rows[y_key]["body_plain"].strip() == "alpha"
    assert rows[x_key]["id"] != file_id and rows[x_key]["body_plain"].strip() == "beta"
    assert result["adopted"] == 1 and result["created"] == 1
    assert 'adoption ambiguous: "Plan"' in result["failures"]


async def test_two_live_notes_and_no_body_match_adopt_nothing_and_name_the_title(tmp_db, monkeypatch):
    key = _enex(text="alpha")
    file_id = _rows()[0]["id"]
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([
        _rn(guid="X", text="beta"), _rn(guid="Y", text="gamma")]))
    rows = {r["import_key"]: r for r in _rows()}
    assert set(rows) == {key, enml.live_import_key("X"), enml.live_import_key("Y")}
    assert rows[key]["id"] == file_id and rows[key]["body_plain"].strip() == "alpha"
    assert result["adopted"] == 0 and result["created"] == 2
    assert result["failures"].count('adoption ambiguous: "Plan"') == 1


async def test_two_live_notes_with_the_same_body_as_the_row_adopt_nothing(tmp_db, monkeypatch):
    """Both live notes are body twins of the one row: no unique pair, so neither adopts it."""
    key = _enex()
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(guid="G"), _rn(guid="H")]))
    assert {r["import_key"] for r in _rows()} == {key, LIVE, enml.live_import_key("H")}
    assert result["adopted"] == 0 and result["created"] == 2
    assert 'adoption ambiguous: "Plan"' in result["failures"]


async def test_two_rows_two_live_notes_pair_by_body_regardless_of_order(tmp_db, monkeypatch):
    k1 = _enex(text="alpha", key="evernote:A/Plan/x")
    k2 = _enex(text="beta", key="evernote:B/Plan/x")
    ids = {r["import_key"]: r["id"] for r in _rows()}
    x_key, y_key = enml.live_import_key("X"), enml.live_import_key("Y")
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([
        _rn(guid="X", text="beta"), _rn(guid="Y", text="alpha")]))
    rows = {r["import_key"]: r for r in _rows()}
    assert set(rows) == {x_key, y_key}
    assert rows[x_key]["id"] == ids[k2] and rows[y_key]["id"] == ids[k1]
    assert result["adopted"] == 2 and result["created"] == 0
    assert not any("adoption ambiguous" in f for f in result["failures"])


def _legacy_finalize(note_id: str, *, media: bool = True) -> None:
    """The old file importer's image-finalize write, from before LEGACY_FINALIZE_CUTOFF: a media
    file landed after the import and `updated_at` followed it 5 s later. Nothing else changed."""
    import os
    from datetime import datetime, timedelta
    imported = "2026-10-01T12:00:00+00:00"
    assert import_provenance.predates_finalize_stamp(imported)
    updated = (datetime.fromisoformat(imported) + timedelta(seconds=600)).isoformat()
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE j2_notes SET imported_at = ?, updated_at = ? WHERE id = ?",
                     (imported, updated, note_id))
        conn.commit()
    finally:
        conn.close()
    if media:
        f = notes_svc._ATTACHMENT_ROOT / USER / "notes" / note_id / "inline" / "x.png"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"png")
        mtime = datetime.fromisoformat(updated).timestamp() - 5
        os.utime(f, (mtime, mtime))


async def test_a_pre_cutoff_image_note_whose_only_change_is_the_finalize_reads_unedited(tmp_db, monkeypatch):
    """Task 8 review M1: the adopting pass judges the row with the file importer's own predicate,
    which forgives the old importer's image-finalize write. The note updates in place: no
    "(synced copy)" sibling, no `sync-conflict` tag."""
    _enex(text="old body")
    note_id = _rows()[0]["id"]
    _legacy_finalize(note_id)
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(text="new body", updated=LATER)]))
    rows = _rows()
    assert [r["import_key"] for r in rows] == [LIVE]
    assert rows[0]["id"] == note_id and rows[0]["body_plain"].strip() == "new body"
    assert result["adopted"] == 1 and result["conflicts"] == 0 and result["updated"] == 1


async def test_the_same_shape_without_the_media_file_still_reads_edited(tmp_db, monkeypatch):
    """Control for the test above: without the finalize's media file the write is a member's,
    and the edited-note rule stands (a sibling, the original kept)."""
    _enex(text="old body")
    note_id = _rows()[0]["id"]
    _legacy_finalize(note_id, media=False)
    result, _src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(text="new body", updated=LATER)]))
    rows = {r["import_key"]: r for r in _rows()}
    assert set(rows) == {LIVE, f"{LIVE}#remote"}
    assert rows[LIVE]["id"] == note_id and rows[LIVE]["body_plain"].strip() == "old body"
    assert result["adopted"] == 1 and result["conflicts"] == 1


@pytest.mark.parametrize("stamp", [None, "", "not a date"])
async def test_a_row_without_a_readable_import_date_is_never_adopted(tmp_db, monkeypatch, stamp):
    """Task 8 review nit 2: as recover does, a row whose `imported_at` is missing or unreadable is
    hands off. The live note imports as new, the row is untouched, and the title is named."""
    key = _enex(text="old body")
    note_id = _rows()[0]["id"]
    conn = auth_db.get_connection()
    try:
        conn.execute("UPDATE j2_notes SET imported_at = ? WHERE id = ?", (stamp, note_id))
        conn.commit()
    finally:
        conn.close()
    result, src = await _sync(tmp_db, monkeypatch, LiveEvernote([_rn(text="new body", updated=LATER)]))
    rows = {r["import_key"]: r for r in _rows()}
    assert set(rows) == {key, LIVE}
    assert rows[key]["id"] == note_id and rows[key]["body_plain"].strip() == "old body"
    assert result["adopted"] == 0 and result["created"] == 1
    reason = 'adoption refused, import date unreadable: "Plan"'
    assert reason in result["failures"]
    assert json.loads(_log_rows(src["id"])[-1]["failures_json"]) == [
        {"noteTitle": "Plan", "reason": reason, "name": None}]


async def test_the_second_live_match_is_named_across_import_chunks_too(tmp_db, monkeypatch):
    """Concern 4 across the chunk boundary: the first adopter is in chunk 1, the second in chunk 2,
    where the file row already holds a live key. Still named, once."""
    _enex()
    fillers = [_rn(guid=f"F{i}", title=f"Filler {i}") for i in range(engine.IMPORT_CHUNK_NOTES - 1)]
    notes = [_rn(guid="G"), *fillers, _rn(guid="H")]
    assert len(notes) == engine.IMPORT_CHUNK_NOTES + 1  # H is alone in the second chunk
    result, src = await _sync(tmp_db, monkeypatch, LiveEvernote(notes))
    assert result["adopted"] == 1
    assert result["failures"].count('adoption ambiguous: "Plan"') == 1
    assert enml.live_import_key("H") in {r["import_key"] for r in _rows()}


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
    assert adopted == [{"fromKey": key, "toKey": LIVE, "noteId": before["id"],
                        "editedSinceImport": False}] and failures == []
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
