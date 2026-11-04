"""Slot scheduling, review fix round 2 (final, of ddcad9c107).

  NEW-1  a member-edited trashed note is never overwritten by a remote change (only its
         revision is stamped); an unedited one is overwritten after its old body is kept in
         version history.
  NEW-2  Evernote's cursor overlap is 30 minutes, and the nightly full pass fetches up to
         NIGHTLY_REVISION_SWEEP_MAX listed notes whose listed revision differs from the stored
         one, oldest import first: an edit the incremental listing missed is at most a day late.
  NEW-3  the member's media budget is read before the import write lock, never under it.
  NEW-4  an unchanged trashed note is not rewritten.
  NEW-5  the conflict sibling's confirm goes through the import write lock, off the loop.
  Also   an ImportLockOrderError is logged as an error; a member-slot pass during the member's
         own first import fetches at most MEMBER_SLOT_FIRST_IMPORT_CAP notes.
"""

from __future__ import annotations

import asyncio
import json
import logging
import threading

import pytest

from api.services import auth_db
from api.services.journal_two import media_policy
from api.services.journal_two import notes as notes_svc
from api.services.journal_two.note_connectors import engine
from api.services.journal_two.note_connectors.providers import evernote as ev
from api.services.journal_two.note_connectors.providers.base import RemoteRef
from api.services.journal_two.test_note_connectors_engine import (  # noqa: F401  (fixtures)
    _rn, db,
)
from api.services.journal_two.test_note_connectors_engine_rate_limit_round1 import (
    PerRefProvider, _row, _seed,
)
from api.services.journal_two.test_note_connectors_engine_slot_scheduling import (  # noqa: F401
    _fresh_slots, _hold_all_slots, _release, _trash,
)
from api.services.journal_two.test_note_connectors_engine_slot_scheduling_r1 import (  # noqa: F401
    _fresh_member_slot, _note_rows, _relisting,
)


def _versions(note_id):
    conn = auth_db.get_connection()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM j2_note_versions WHERE note_id = ? ORDER BY created_at", (note_id,))]
    finally:
        conn.close()


async def _imported_then_trashed(db, monkeypatch, *, edit_after_trash=False):
    p = PerRefProvider()
    _seed(p, 2)
    p.limited = {"p1"}  # keep the cursor None so the first import is still catching up
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    await engine.sync_source(sid, manual=True)
    key = p.import_key("g", "p0")
    if edit_after_trash:
        conn = auth_db.get_connection()
        conn.execute("UPDATE j2_notes SET body_json = ?, body_plain = 'my own words', "
                     "updated_at = '2099-01-01T00:00:00+00:00' WHERE import_key = ?",
                     (json.dumps({"type": "doc", "content": [{"type": "paragraph", "content": [
                         {"type": "text", "text": "my own words"}]}]}), key))
        conn.commit()
        conn.close()
    _trash(key)
    p.limited = set()
    p.refs[0] = RemoteRef(remote_id="p0", updated_at="2026-09-09T00:00:00+00:00")
    p.notes_by_id["p0"] = _rn("p0", "Note 0 remote", text="the remote words",
                              updated_at="2026-09-09T00:00:00+00:00")
    return p, sid, key


# ── NEW-1 ─────────────────────────────────────────────────────────────────────

async def test_a_member_edited_trashed_note_is_never_overwritten(db, monkeypatch):
    p, sid, key = await _imported_then_trashed(db, monkeypatch, edit_after_trash=True)
    result = await engine.sync_source(sid, manual=True)
    assert not result["failures"]
    row = {r["import_key"]: r for r in _note_rows()}[key]
    assert row["deleted_at"] is not None and "my own words" in row["body_plain"]
    assert row["import_remote_rev"] == "2026-09-09T00:00:00+00:00"  # stamped: no refetch loop
    before = len(p.fetch_calls)
    await engine.sync_source(sid, manual=True)
    assert "p0" not in p.fetch_calls[before:]
    restored = notes_svc.restore_note("u1", row["id"])
    assert "my own words" in json.dumps(restored["bodyJson"])
    assert "the remote words" not in json.dumps(restored["bodyJson"])


async def test_an_unedited_trashed_note_is_overwritten_with_its_old_body_kept(db, monkeypatch):
    p, sid, key = await _imported_then_trashed(db, monkeypatch)
    await engine.sync_source(sid, manual=True)
    row = {r["import_key"]: r for r in _note_rows()}[key]
    assert row["deleted_at"] is not None and "the remote words" in row["body_plain"]
    versions = _versions(row["id"])
    assert versions and "Note 0" in json.dumps(versions[-1])  # the old body, in history


# ── NEW-4 ─────────────────────────────────────────────────────────────────────

async def test_an_unchanged_trashed_note_is_not_rewritten(db, monkeypatch):
    p, sid, key = await _imported_then_trashed(db, monkeypatch)
    await engine.sync_source(sid, manual=True)  # kept in the trash, revision stamped
    row = {r["import_key"]: r for r in _note_rows()}[key]
    versions = len(_versions(row["id"]))
    writes = []
    real = engine._write_into_trashed_row

    def spy(*a, **kw):
        writes.append(1)
        return real(*a, **kw)

    monkeypatch.setattr(engine, "_write_into_trashed_row", spy)
    # The cursor is set now: an incremental pass refetches the listed note (the D1 rule); the
    # payload is the one already in the trashed row, so nothing is written.
    monkeypatch.setattr(p, "list_changed", _relisting(p))
    await engine.sync_source(sid, member=True)
    assert writes == [] and len(_versions(row["id"])) == versions


# ── NEW-2 ─────────────────────────────────────────────────────────────────────

def test_evernotes_cursor_overlap_is_thirty_minutes():
    assert ev.EvernoteProvider.CURSOR_OVERLAP_S == 1800


class Present(PerRefProvider):
    """A provider with a complete listing (Evernote's `list_present_refs`), fetch independent of
    the listing, and an incremental listing that can be told to miss notes (a lagging index)."""
    fetch_is_listing_independent = True

    def __init__(self):
        super().__init__()
        self.hidden: set[str] = set()

    async def list_changed(self, credentials, cursor=None):
        self.list_changed_calls.append(cursor)
        self._enumerated = True
        return [r for r in self.refs if r.remote_id not in self.hidden
                and (cursor is None or r.updated_at > cursor)]

    async def list_present_refs(self, credentials):
        self._enumerated = True
        return list(self.refs)


async def test_the_nightly_pass_picks_up_an_edit_the_incremental_listing_missed(db, monkeypatch):
    p = Present()
    _seed(p, 3)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    await engine.sync_source(sid, manual=True)
    assert _row(db, sid)["cursor"] is not None
    # p0 edited remotely, but its new revision is older than the cursor and the incremental
    # listing never returns it (the index lagged past the overlap).
    p.refs[0] = RemoteRef(remote_id="p0", updated_at="2026-08-01T12:00:00+00:00")
    p.notes_by_id["p0"] = _rn("p0", "Note 0", text="edited late", updated_at="2026-08-01T12:00:00+00:00")
    p.hidden = {"p0"}
    await engine.sync_source(sid, member=True)
    assert "edited late" not in [r for r in _note_rows() if r["title"] == "Note 0"][0]["body_plain"]
    before = len(p.fetch_calls)
    await engine.sync_source(sid, full=True, manual=True)  # the nightly pass
    assert p.fetch_calls[before:].count("p0") == 1
    assert "edited late" in [r for r in _note_rows() if r["title"] == "Note 0"][0]["body_plain"]
    before = len(p.fetch_calls)
    await engine.sync_source(sid, full=True, manual=True)
    assert "p0" not in p.fetch_calls[before:]  # in step again: not fetched every night


async def test_the_nightly_revision_sweep_is_bounded_oldest_import_first(db, monkeypatch):
    monkeypatch.setattr(engine, "NIGHTLY_REVISION_SWEEP_MAX", 2)
    p = Present()
    _seed(p, 4)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    await engine.sync_source(sid, manual=True)
    conn = auth_db.get_connection()
    for i, when in enumerate(["2026-10-04", "2026-10-01", "2026-10-03", "2026-10-02"]):
        conn.execute("UPDATE j2_notes SET imported_at = ?, import_remote_rev = 'stale' "
                     "WHERE import_key = ?", (when + "T00:00:00+00:00", p.import_key("g", f"p{i}")))
    conn.commit()
    conn.close()
    p.hidden = {f"p{i}" for i in range(4)}
    before = len(p.fetch_calls)
    await engine.sync_source(sid, full=True, manual=True)
    assert sorted(p.fetch_calls[before:]) == ["p1", "p3"]  # the two oldest imports
    before = len(p.fetch_calls)
    await engine.sync_source(sid, full=True, manual=True)
    assert sorted(p.fetch_calls[before:]) == ["p0", "p2"]  # the rest carry over


# ── NEW-3 ─────────────────────────────────────────────────────────────────────

async def test_the_media_budget_is_read_outside_the_import_lock(db, monkeypatch):
    seen = []
    real = media_policy.MediaBudget.for_member

    def spy(user_id):
        seen.append(engine._IMPORT_WRITE_LOCK.locked())
        return real(user_id)

    monkeypatch.setattr(media_policy.MediaBudget, "for_member", staticmethod(spy))
    p = PerRefProvider()
    _seed(p, 1)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    await engine.sync_source(sid, manual=True)
    assert seen and not any(seen)


# ── NEW-5 ─────────────────────────────────────────────────────────────────────

def test_the_sibling_reroute_confirms_through_the_import_lock(db, monkeypatch):
    calls = []
    real = engine._import_confirm_serialized

    def spy(*a, **kw):
        calls.append(threading.get_ident())
        return real(*a, **kw)

    monkeypatch.setattr(engine, "_import_confirm_serialized", spy)
    conn = auth_db.get_connection()
    try:
        rn = _rn("x", "Racing note")
        sib, failures = engine._reroute_resolved_body_to_sibling(
            conn, "u1", {"provider": "fake"}, rn, "fake:g/x", rn.doc, pooled=True)
    finally:
        conn.close()
    assert sib and not failures and len(calls) == 1


# ── Also ──────────────────────────────────────────────────────────────────────

def test_an_import_lock_order_error_is_logged_as_an_error(db, caplog):
    conn = auth_db.get_connection()
    try:
        conn.execute("INSERT INTO j2_note_sync_log (source_id, user_id, started_at) VALUES ('x', 'u1', 'y')")
        with caplog.at_level(logging.ERROR, logger=engine.log.name):
            with pytest.raises(engine.ImportLockOrderError):
                engine._import_confirm_serialized("u1", {"source": "fake", "notes": []}, conn)
        assert any(r.levelno == logging.ERROR and "import write lock" in r.getMessage()
                   for r in caplog.records)
    finally:
        conn.rollback()
        conn.close()


async def test_a_member_slot_pass_during_a_first_import_fetches_at_most_its_cap(db, monkeypatch):
    monkeypatch.setattr(engine, "MEMBER_SLOT_FIRST_IMPORT_CAP", 4)
    p = PerRefProvider()
    _seed(p, 10)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    held = _hold_all_slots()  # the press takes the reserved member slot
    try:
        result = await engine.sync_source(sid, member=True)
    finally:
        _release(held)
    assert len(p.fetch_calls) == 4 and result["created"] == 4
    # NEW-C (final review): in a pool slot the same press is capped the same way; a background
    # pass is the normal pass (FETCH_CAP_PER_PASS).
    before = len(p.fetch_calls)
    await engine.sync_source(sid, member=True)
    assert len(p.fetch_calls) - before == 4
    before = len(p.fetch_calls)
    await engine.sync_source(sid, manual=True)
    assert len(p.fetch_calls) - before == 2
