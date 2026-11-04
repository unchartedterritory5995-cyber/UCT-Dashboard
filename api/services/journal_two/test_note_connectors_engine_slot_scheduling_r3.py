"""Slot scheduling, final review fix (of b4bdce0440).

  NEW-A  an incremental pass with a cursor set never livelocks when more than
         FETCH_CAP_PER_PASS notes are listed (a bulk tag or move inside the cursor overlap):
         listed notes whose stored copy carries the listing's own revision are fetched LAST
         (the cap reaches new and changed notes first), and one the cap or the clock left
         unfetched counts as stored for the cursor. A changed, new or media-pending note left
         unfetched still holds the cursor. The same on the nightly full pass, whose revision
         sweep is no longer starved behind a large delta.
  NEW-B  the nightly sweep's listing stamp never moves `import_remote_rev` backwards.
  NEW-C  a member's press during their own first import is capped at
         MEMBER_SLOT_FIRST_IMPORT_CAP in whichever slot it runs.
  Also   a trashed row whose `imported_at` is missing or unreadable is hands off (stamp only),
         as recover treats it.
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.note_connectors import engine
from api.services.journal_two.note_connectors.providers.base import NoteProvider, RemoteRef
from api.services.journal_two.test_note_connectors_engine import (  # noqa: F401  (fixtures)
    FakeProvider, _rn, db,
)
from api.services.journal_two.test_note_connectors_engine_rate_limit_round1 import (
    PerRefProvider, _row, _seed,
)
from api.services.journal_two.test_note_connectors_engine_slot_scheduling import (  # noqa: F401
    _fresh_slots, _trash,
)
from api.services.journal_two.test_note_connectors_engine_slot_scheduling_r1 import (  # noqa: F401
    _fresh_member_slot, _note_rows, _relisting,
)
from api.services.journal_two.test_note_connectors_engine_slot_scheduling_r2 import (
    Present, _imported_then_trashed,
)


def _stamp(i: int) -> str:
    return f"2026-08-01T00:{i // 60:02d}:{i % 60:02d}+00:00"


def _bodies() -> dict[str, str]:
    return {r["title"]: r["body_plain"] for r in _note_rows()}


async def _stored_library(db, monkeypatch, n: int, provider=None):
    """`n` notes imported and the cursor set; every later listing returns all of them (the
    cursor overlap holds the whole library, as after a bulk tag in Evernote)."""
    p = provider or PerRefProvider()
    p.refs = [RemoteRef(remote_id=f"p{i}", updated_at=_stamp(i)) for i in range(n)]
    p.notes_by_id = {r.remote_id: _rn(r.remote_id, f"Note {r.remote_id}", updated_at=r.updated_at)
                     for r in p.refs}
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    monkeypatch.setattr(engine, "FETCH_CAP_PER_PASS", n + 10)  # the first import, uncapped
    first = await engine.sync_source(sid, manual=True)
    assert first["created"] == n and _row(db, sid)["cursor"] is not None
    return p, sid


def _cap(monkeypatch, n: int) -> None:
    monkeypatch.setattr(engine, "FETCH_CAP_PER_PASS", n)


# ── NEW-A: the reviewer's repro ───────────────────────────────────────────────

class OverlapProvider(FakeProvider):
    follow_up_on_rate_limit = False

    async def list_changed(self, credentials, cursor=None):
        await super().list_changed(credentials, cursor=None)
        return list(self.refs)  # the overlap window holds every note (a bulk-touched library)

    fetch_many = NoteProvider.fetch_many  # the base per-ref loop, like EvernoteProvider (the cap applies)

    def listing_revision(self, ref):
        return ref.updated_at


async def test_incremental_pass_over_the_cap_converges(db, monkeypatch):
    """The reviewer's repro (NEW-A), kept verbatim in shape: 350 listed, all stored and
    unchanged, cursor set, the real FETCH_CAP_PER_PASS of 300. It used to read "importing" pass
    after pass and then "stalled"."""
    p = OverlapProvider()
    n = 350
    p.refs = [RemoteRef(remote_id=f"p{i}", updated_at=_stamp(i)) for i in range(n)]
    p.notes_by_id = {r.remote_id: _rn(r.remote_id, f"Note {r.remote_id}", updated_at=r.updated_at)
                     for r in p.refs}
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    src = db.create_source("u1", "fake", "fake-graph")
    await engine.sync_source(src["id"], manual=True)       # uncapped: stores all, sets cursor
    c0 = db.get_source_by_id(src["id"])["cursor"]
    assert c0 is not None
    monkeypatch.setattr(OverlapProvider, "follow_up_on_rate_limit", True)  # the capped path
    for _ in range(3):
        before = len(p.fetch_calls)
        r = await engine.sync_source(src["id"], manual=True)
        row = db.get_source_by_id(src["id"])
        assert len(p.fetch_calls) - before == engine.FETCH_CAP_PER_PASS
        assert r["status"] == "ok" and row["lastSyncStatus"] == "ok", row["lastSyncError"]
        assert row["cursor"] == c0


# ── NEW-A: changed notes mixed into a large listing ───────────────────────────

def _change(p, ids, when="2026-08-02T00:00:00+00:00"):
    """Edit `ids` remotely: a NEW listing revision (genuinely changed, not index lag)."""
    for k, rid in enumerate(sorted(ids, key=lambda r: int(r[1:]))):
        stamp = f"2026-08-02T00:{k // 60:02d}:{k % 60:02d}+00:00"
        i = int(rid[1:])
        p.refs[i] = RemoteRef(remote_id=rid, updated_at=stamp)
        p.notes_by_id[rid] = _rn(rid, f"Note {rid}", text=f"changed {rid}", updated_at=stamp)


async def test_changed_notes_mixed_into_350_listed_are_all_imported_in_one_capped_pass(db, monkeypatch):
    p, sid = await _stored_library(db, monkeypatch, 350)
    _cap(monkeypatch, 300)
    changed = {f"p{i}" for i in range(0, 350, 7)} | {f"p{i}" for i in range(3, 350, 6)}
    changed = set(sorted(changed, key=lambda r: int(r[1:]))[:100])
    assert len(changed) == 100
    _change(p, changed)
    monkeypatch.setattr(p, "list_changed", _relisting(p))
    before = len(p.fetch_calls)
    result = await engine.sync_source(sid, member=True)
    fetched = p.fetch_calls[before:]
    assert set(fetched[:100]) == changed  # the cap reaches every changed note first
    assert result["updated"] == 100 and result["status"] == "ok"
    bodies = _bodies()
    assert all(f"changed {rid}" in bodies[f"Note {rid}"] for rid in changed)
    newest = max(r.updated_at for r in p.refs)
    assert _row(db, sid)["cursor"] == newest


async def test_changed_notes_past_the_cap_hold_the_cursor_until_stored(db, monkeypatch):
    """Rule 3: a genuinely changed note the cap left unfetched still holds the cursor; the
    passes the cap allows bring every one in, and only then does the cursor move."""
    p, sid = await _stored_library(db, monkeypatch, 350)
    c0 = _row(db, sid)["cursor"]
    _cap(monkeypatch, 40)
    changed = {f"p{i}" for i in range(1, 350, 3)}
    changed = set(sorted(changed, key=lambda r: int(r[1:]))[:100])
    _change(p, changed)
    monkeypatch.setattr(p, "list_changed", _relisting(p))
    seen: set[str] = set()
    for k in range(3):
        before = len(p.fetch_calls)
        await engine.sync_source(sid, member=True)
        fetched = p.fetch_calls[before:]
        new = [rid for rid in fetched if rid in changed and rid not in seen]
        assert len(new) == min(40, 100 - len(seen))
        seen.update(new)
        if k < 2:
            assert _row(db, sid)["cursor"] == c0  # held: changed notes still unfetched
    assert seen == changed
    bodies = _bodies()
    assert all(f"changed {rid}" in bodies[f"Note {rid}"] for rid in changed)
    assert _row(db, sid)["cursor"] == max(r.updated_at for r in p.refs)
    assert _row(db, sid)["lastSyncStatus"] == "ok"


async def test_a_new_note_past_the_cap_still_holds_the_cursor(db, monkeypatch):
    p, sid = await _stored_library(db, monkeypatch, 6)
    c0 = _row(db, sid)["cursor"]
    _cap(monkeypatch, 2)
    for i in range(6, 9):  # three new notes, no stored row
        p.refs.append(RemoteRef(remote_id=f"p{i}", updated_at=f"2026-08-03T00:00:0{i}+00:00"))
        p.notes_by_id[f"p{i}"] = _rn(f"p{i}", f"Note p{i}", updated_at=p.refs[-1].updated_at)
    monkeypatch.setattr(p, "list_changed", _relisting(p))
    before = len(p.fetch_calls)
    await engine.sync_source(sid, member=True)
    assert p.fetch_calls[before:] == ["p6", "p7"]  # no-row notes first
    assert _row(db, sid)["cursor"] == c0
    await engine.sync_source(sid, member=True)
    assert _row(db, sid)["cursor"] == p.refs[-1].updated_at


# ── NEW-A: the r1 guarantee is unchanged ──────────────────────────────────────

async def test_a_stale_listed_edit_ranked_within_the_cap_is_still_fetched(db, monkeypatch):
    p, sid = await _stored_library(db, monkeypatch, 8)
    _cap(monkeypatch, 5)
    # p2 edited in Evernote; the listing still carries its OLD updatedAt (the index lags), so it
    # is a revision match and ranks with the others, in listing order, inside the cap.
    p.notes_by_id["p2"] = _rn("p2", "Note p2", text="edited behind a stale index",
                              updated_at="2026-09-09T00:00:00+00:00")
    monkeypatch.setattr(p, "list_changed", _relisting(p))
    before = len(p.fetch_calls)
    result = await engine.sync_source(sid, member=True)
    assert p.fetch_calls[before:] == ["p0", "p1", "p2", "p3", "p4"]
    assert result["updated"] == 1 and result["status"] == "ok"
    assert "edited behind a stale index" in _bodies()["Note p2"]


async def test_a_revision_match_the_clock_left_unfetched_does_not_hold_the_cursor(db, monkeypatch):
    p, sid = await _stored_library(db, monkeypatch, 3)
    p.refs.append(RemoteRef(remote_id="p3", updated_at="2026-08-05T00:00:00+00:00"))
    p.notes_by_id["p3"] = _rn("p3", "Note p3", updated_at="2026-08-05T00:00:00+00:00")
    p.limited = {"p1"}  # rate limited mid-pass (the session clock), a revision match
    monkeypatch.setattr(p, "list_changed", _relisting(p))
    result = await engine.sync_source(sid, member=True)
    assert result["status"] == "ok" and not result["failures"]
    assert _row(db, sid)["cursor"] == "2026-08-05T00:00:00+00:00"


async def test_a_changed_note_the_clock_left_unfetched_still_holds_the_cursor(db, monkeypatch):
    p, sid = await _stored_library(db, monkeypatch, 3)
    c0 = _row(db, sid)["cursor"]
    _change(p, {"p1"})
    p.limited = {"p1"}
    monkeypatch.setattr(p, "list_changed", _relisting(p))
    await engine.sync_source(sid, member=True)
    assert _row(db, sid)["cursor"] == c0
    p.limited = set()
    await engine.sync_source(sid, member=True)
    assert _row(db, sid)["cursor"] == max(r.updated_at for r in p.refs)


async def test_trashed_revision_matches_past_the_cap_do_not_hold_the_cursor(db, monkeypatch):
    """A trashed note at the listing's revision is a revision match too: it ranks last and
    never holds the cursor (a bulk move that also touched notes the member trashed)."""
    p, sid = await _stored_library(db, monkeypatch, 6)
    for i in range(3):
        _trash(p.import_key("g", f"p{i}"))
    _cap(monkeypatch, 2)
    monkeypatch.setattr(p, "list_changed", _relisting(p))
    c0 = _row(db, sid)["cursor"]
    result = await engine.sync_source(sid, member=True)
    assert result["status"] == "ok" and _row(db, sid)["cursor"] == c0
    assert _row(db, sid)["lastSyncStatus"] == "ok"


# ── NEW-A on the nightly full pass ────────────────────────────────────────────

async def test_the_nightly_sweep_is_not_starved_behind_a_large_unchanged_delta(db, monkeypatch):
    p, sid = await _stored_library(db, monkeypatch, 8, provider=Present())
    _cap(monkeypatch, 3)
    # p0 edited, and the incremental listing never returns it (the index lagged past the
    # overlap); the other seven are relisted unchanged, more than the cap. Without NEW-A the
    # sweep ref is appended after them and the cap never reaches it.
    p.refs[0] = RemoteRef(remote_id="p0", updated_at="2026-08-01T00:00:03+00:00")
    p.notes_by_id["p0"] = _rn("p0", "Note p0", text="edited late",
                              updated_at="2026-08-01T00:00:03+00:00")
    p.hidden = {"p0"}

    async def relist(credentials, cursor=None):
        p.list_changed_calls.append(cursor)
        p._enumerated = True
        return [r for r in p.refs if r.remote_id not in p.hidden]

    monkeypatch.setattr(p, "list_changed", relist)
    c0 = _row(db, sid)["cursor"]
    before = len(p.fetch_calls)
    result = await engine.sync_source(sid, full=True, manual=True)
    assert p.fetch_calls[before:] == ["p0", "p1", "p2"]  # the sweep ref ahead of the matches
    assert "edited late" in _bodies()["Note p0"]
    assert result["status"] == "ok"
    assert _row(db, sid)["cursor"] == c0  # unchanged listing: the same newest stamp, not held


# ── NEW-B ─────────────────────────────────────────────────────────────────────

def _rev(key):
    conn = auth_db.get_connection()
    try:
        return conn.execute("SELECT import_remote_rev FROM j2_notes WHERE import_key = ?",
                            (key,)).fetchone()[0]
    finally:
        conn.close()


def _set_rev(key, rev):
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_notes SET import_remote_rev = ? WHERE import_key = ?", (rev, key))
    conn.commit()
    conn.close()


@pytest.mark.parametrize("stored, listed, expected", [
    # the index lags: the stored get_note revision is NEWER, it stays
    ("2026-09-02T00:00:00+00:00", "2026-09-01T00:00:00+00:00", "2026-09-02T00:00:00+00:00"),
    ("2026-09-02T00:00:00Z", "2026-09-01T23:00:00-00:30", "2026-09-02T00:00:00Z"),
    # the stored revision is older, or missing: the listing's is stamped
    ("2026-09-01T00:00:00+00:00", "2026-09-02T00:00:00+00:00", "2026-09-02T00:00:00+00:00"),
    (None, "2026-09-02T00:00:00+00:00", "2026-09-02T00:00:00+00:00"),
    # an unreadable stored revision cannot be ordered and never matches: stamped (convergence)
    ("stale", "2026-09-02T00:00:00+00:00", "2026-09-02T00:00:00+00:00"),
    # the same instant: nothing to write
    ("2026-09-02T00:00:00+00:00", "2026-09-02T00:00:00Z", "2026-09-02T00:00:00+00:00"),
])
async def test_the_listing_stamp_never_moves_the_revision_backwards(db, monkeypatch, stored, listed,
                                                                    expected):
    p = PerRefProvider()
    _seed(p, 1)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    await engine.sync_source(sid, manual=True)
    key = p.import_key("g", "p0")
    _set_rev(key, stored)
    engine._stamp_listed_revisions("u1", db.get_source_by_id(sid), p,
                                   [RemoteRef(remote_id="p0", updated_at=listed)])
    assert _rev(key) == expected


async def test_the_nightly_sweep_keeps_the_newer_revision_get_note_stored(db, monkeypatch):
    p, sid = await _stored_library(db, monkeypatch, 3, provider=Present())
    # The complete listing lags: it lists p1 at a revision newer than the stored one but older
    # than what get_note returns now. The sweep fetches it; import_confirm stores get_note's.
    p.refs[1] = RemoteRef(remote_id="p1", updated_at="2026-08-01T05:00:00+00:00")
    p.notes_by_id["p1"] = _rn("p1", "Note p1", text="newer still",
                              updated_at="2026-08-01T06:00:00+00:00")
    p.hidden = {"p1"}
    await engine.sync_source(sid, full=True, manual=True)
    assert "newer still" in _bodies()["Note p1"]
    assert _rev(p.import_key("g", "p1")) == "2026-08-01T06:00:00+00:00"


# ── NEW-C ─────────────────────────────────────────────────────────────────────

async def test_a_members_press_during_a_first_import_is_capped_in_a_pool_slot_too(db, monkeypatch):
    monkeypatch.setattr(engine, "MEMBER_SLOT_FIRST_IMPORT_CAP", 4)
    p = PerRefProvider()
    _seed(p, 12)
    monkeypatch.setattr(engine, "_provider_factory", lambda name, source=None: p)
    db.upsert_connector("u1", "fake", {"token": "abc"})
    sid = db.create_source("u1", "fake", "g")["id"]
    result = await engine.sync_source(sid, member=True)  # a free pool slot: no slot held
    assert len(p.fetch_calls) == 4 and result["created"] == 4
    assert _row(db, sid)["cursor"] is None
    # A background pass (a follow-up, the hourly tick) is the normal pass.
    before = len(p.fetch_calls)
    await engine.sync_source(sid, manual=True)
    assert len(p.fetch_calls) - before == 8
    assert _row(db, sid)["cursor"] is not None
    # Once the cursor is set, a press is not capped by the first-import cap.
    monkeypatch.setattr(p, "list_changed", _relisting(p))
    before = len(p.fetch_calls)
    await engine.sync_source(sid, member=True)
    assert len(p.fetch_calls) - before == 12


# ── Also: an unreadable imported_at on a trashed row is hands off ─────────────

@pytest.mark.parametrize("imported_at", [None, "not a date"])
async def test_a_trashed_row_with_an_unreadable_imported_at_is_only_stamped(db, monkeypatch,
                                                                            imported_at):
    p, sid, key = await _imported_then_trashed(db, monkeypatch)
    conn = auth_db.get_connection()
    conn.execute("UPDATE j2_notes SET imported_at = ? WHERE import_key = ?", (imported_at, key))
    conn.commit()
    conn.close()
    writes = []
    real = engine._write_into_trashed_row
    monkeypatch.setattr(engine, "_write_into_trashed_row",
                        lambda *a, **kw: (writes.append(1), real(*a, **kw)))
    result = await engine.sync_source(sid, manual=True)
    assert not result["failures"] and writes == []
    row = {r["import_key"]: r for r in _note_rows()}[key]
    assert row["deleted_at"] is not None and "the remote words" not in row["body_plain"]
    assert row["import_remote_rev"] == "2026-09-09T00:00:00+00:00"
