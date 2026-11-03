"""Connector note lifecycle (live Obsidian probe, 2026-11-03), engine half.

L1: in a small source the <50% enumeration guard refused every removal check
("full enumeration returned 1 of 3 previously-known items (<50%)"), so one
rename plus one delete in a 2- or 3-note vault left ghost notes live forever.
The ratio guard now applies only from `engine.DELETE_GUARD_MIN_KNOWN` known
items up; below it the 2-strike rule and its 10-minute gap still hold.

L4 lives here too: an unchanged media ref of a content-addressed provider is
reused on an update (same URL, no fetch, no copy).
"""

from __future__ import annotations

from api.services.journal_two import notes as notes_svc
from api.services.journal_two.note_connectors import engine
from api.services.journal_two.test_note_connectors_engine import (  # noqa: F401 -- fixtures
    FakeProvider, _a_night_later, _remote_index_rows, _rn, db, provider, source,
)
from api.services.journal_two.note_connectors.providers.base import RemoteRef


def _refs(*ids, updated_at="2026-08-01T00:00:00+00:00"):
    return [RemoteRef(remote_id=i, updated_at=updated_at) for i in ids]


def _by_title(title):
    return next(n for n in notes_svc.list_notes("u1") if n["title"] == title)


def test_the_floor_is_ten():
    assert engine.DELETE_GUARD_MIN_KNOWN == 10


async def test_a_two_note_vault_confirms_a_rename_plus_a_delete_after_two_strikes(source, provider):
    """The probe's shape: two tracked notes; one renamed (a new id), one deleted. The listing
    holds 1 of the 2 known ids. Strike 1, then strike 2 a night later: both old notes are tagged
    `source-deleted` (tagged, never erased)."""
    provider.refs = _refs("a.md", "b.md")
    provider.notes_by_id = {"a.md": _rn("a.md", "Alpha"), "b.md": _rn("b.md", "Beta")}
    await engine.sync_source(source["id"], full=True)

    provider.refs = _refs("a2.md", updated_at="2026-08-02T00:00:00+00:00")
    provider.notes_by_id = {"a2.md": _rn("a2.md", "Alpha moved", updated_at="2026-08-02T00:00:00+00:00")}
    _a_night_later(source["id"])
    r1 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r1["deleteDetectionWarning"] is None
    streaks = {r["remote_id"]: r["miss_streak"] for r in _remote_index_rows(source["id"])}
    assert streaks["a.md"] == 1 and streaks["b.md"] == 1

    _a_night_later(source["id"])
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["deleteDetectionWarning"] is None
    assert r2["sourceDeleted"] == 2
    assert "source-deleted" in _by_title("Alpha")["tags"]
    assert "source-deleted" in _by_title("Beta")["tags"]
    assert "source-deleted" not in _by_title("Alpha moved")["tags"]


async def test_below_the_floor_the_strike_gap_still_holds(source, provider):
    """Below the floor the ratio guard is off, so the 10-minute gap is what stands between a bad
    listing and a tag: two back-to-back full passes are ONE strike."""
    provider.refs = _refs("a.md", "b.md")
    provider.notes_by_id = {"a.md": _rn("a.md", "Alpha"), "b.md": _rn("b.md", "Beta")}
    await engine.sync_source(source["id"], full=True)

    provider.refs = []
    provider.notes_by_id = {}
    _a_night_later(source["id"])
    await engine.sync_source(source["id"], full=True, manual=True)
    r = await engine.sync_source(source["id"], full=True, manual=True)  # inside the gap
    assert r["sourceDeleted"] == 0
    assert "source-deleted" not in _by_title("Alpha")["tags"]


async def test_a_twenty_note_source_returning_three_is_still_refused(source, provider):
    ids = [f"n{i}" for i in range(20)]
    provider.refs = _refs(*ids)
    provider.notes_by_id = {i: _rn(i, f"Note {i}") for i in ids}
    await engine.sync_source(source["id"], full=True)
    before = {r["remote_id"]: r["miss_streak"] for r in _remote_index_rows(source["id"])}
    assert len(before) == 20

    provider.refs = _refs(*ids[:3])
    _a_night_later(source["id"])
    r = await engine.sync_source(source["id"], full=True, manual=True)
    assert r["status"] == "warning"
    assert "3 of 20" in r["deleteDetectionWarning"]
    after = {r["remote_id"]: r["miss_streak"] for r in _remote_index_rows(source["id"])}
    assert after == before


async def test_exactly_the_floor_is_guarded(source, provider):
    """The boundary: 10 known, 4 returned (<50%) is refused; the floor is inclusive."""
    ids = [f"n{i}" for i in range(engine.DELETE_GUARD_MIN_KNOWN)]
    provider.refs = _refs(*ids)
    provider.notes_by_id = {i: _rn(i, f"Note {i}") for i in ids}
    await engine.sync_source(source["id"], full=True)

    provider.refs = _refs(*ids[:4])
    _a_night_later(source["id"])
    r = await engine.sync_source(source["id"], full=True, manual=True)
    assert r["status"] == "warning" and r["deleteDetectionWarning"]
