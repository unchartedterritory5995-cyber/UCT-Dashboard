"""Connector note lifecycle (live Obsidian probe, 2026-11-03), engine half.

L1: in a small source the <50% enumeration guard refused every removal check
("full enumeration returned 1 of 3 previously-known items (<50%)"), so one
rename plus one delete in a 2- or 3-note vault left ghost notes live forever.

Fix round 1 ruling: the floor (`engine.DELETE_GUARD_MIN_KNOWN`) applies ONLY to
a provider whose complete listing is authoritative
(`NoteProvider.enumeration_is_authoritative`, Obsidian's manifest). Below the
floor the 2-strike rule and its 10-minute gap still hold. Every API-listed
provider keeps the <50% guard at any size: its listing can come back short.
The real Obsidian half is in test_obsidian_rename_fr1.py.
"""

from __future__ import annotations

import pytest

from api.services.journal_two import notes as notes_svc
from api.services.journal_two.note_connectors import engine
from api.services.journal_two.note_connectors.providers.base import NoteProvider, RemoteRef
from api.services.journal_two.note_connectors.providers.obsidian import ObsidianProvider
from api.services.journal_two.test_note_connectors_engine import (  # noqa: F401 -- fixtures
    FakeProvider, _a_night_later, _remote_index_rows, _rn, db, provider, source,
)


def _refs(*ids, updated_at="2026-08-01T00:00:00+00:00"):
    return [RemoteRef(remote_id=i, updated_at=updated_at) for i in ids]


def _by_title(title):
    return next(n for n in notes_svc.list_notes("u1") if n["title"] == title)


@pytest.fixture
def vault(provider):
    """The fake provider declaring an authoritative listing, as Obsidian's manifest is."""
    provider.enumeration_is_authoritative = True
    return provider


def test_the_floor_is_ten_and_only_obsidian_is_authoritative():
    assert engine.DELETE_GUARD_MIN_KNOWN == 10
    assert NoteProvider.enumeration_is_authoritative is False
    assert ObsidianProvider.enumeration_is_authoritative is True


async def test_a_two_note_authoritative_vault_confirms_a_rename_plus_a_delete(source, vault):
    vault.refs = _refs("a.md", "b.md")
    vault.notes_by_id = {"a.md": _rn("a.md", "Alpha"), "b.md": _rn("b.md", "Beta")}
    await engine.sync_source(source["id"], full=True)

    vault.refs = _refs("a2.md", updated_at="2026-08-02T00:00:00+00:00")
    vault.notes_by_id = {"a2.md": _rn("a2.md", "Alpha moved", updated_at="2026-08-02T00:00:00+00:00")}
    _a_night_later(source["id"])
    r1 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r1["deleteDetectionWarning"] is None
    streaks = {r["remote_id"]: r["miss_streak"] for r in _remote_index_rows(source["id"])}
    assert streaks["a.md"] == 1 and streaks["b.md"] == 1

    _a_night_later(source["id"])
    r2 = await engine.sync_source(source["id"], full=True, manual=True)
    assert r2["sourceDeleted"] == 2
    assert "source-deleted" in _by_title("Alpha")["tags"]
    assert "source-deleted" in _by_title("Beta")["tags"]
    assert "source-deleted" not in _by_title("Alpha moved")["tags"]


async def test_below_the_floor_the_strike_gap_still_holds(source, vault):
    vault.refs = _refs("a.md", "b.md")
    vault.notes_by_id = {"a.md": _rn("a.md", "Alpha"), "b.md": _rn("b.md", "Beta")}
    await engine.sync_source(source["id"], full=True)
    vault.refs, vault.notes_by_id = [], {}
    _a_night_later(source["id"])
    await engine.sync_source(source["id"], full=True, manual=True)
    r = await engine.sync_source(source["id"], full=True, manual=True)  # inside the gap
    assert r["sourceDeleted"] == 0
    assert "source-deleted" not in _by_title("Alpha")["tags"]


async def test_an_api_listed_six_page_source_returning_one_is_still_refused(source, provider):
    """A Notion-like provider (no authoritative listing): small or not, 1 of 6 is refused."""
    ids = [f"page{i}" for i in range(6)]
    provider.refs = _refs(*ids)
    provider.notes_by_id = {i: _rn(i, f"Page {i}") for i in ids}
    await engine.sync_source(source["id"], full=True)
    before = {r["remote_id"]: r["miss_streak"] for r in _remote_index_rows(source["id"])}
    provider.refs = _refs(ids[0])
    _a_night_later(source["id"])
    r = await engine.sync_source(source["id"], full=True, manual=True)
    assert r["status"] == "warning" and "1 of 6" in r["deleteDetectionWarning"]
    assert {r["remote_id"]: r["miss_streak"] for r in _remote_index_rows(source["id"])} == before


async def test_an_authoritative_twenty_note_vault_returning_three_is_still_refused(source, vault):
    ids = [f"n{i}" for i in range(20)]
    vault.refs = _refs(*ids)
    vault.notes_by_id = {i: _rn(i, f"Note {i}") for i in ids}
    await engine.sync_source(source["id"], full=True)
    before = {r["remote_id"]: r["miss_streak"] for r in _remote_index_rows(source["id"])}
    vault.refs = _refs(*ids[:3])
    _a_night_later(source["id"])
    r = await engine.sync_source(source["id"], full=True, manual=True)
    assert r["status"] == "warning" and "3 of 20" in r["deleteDetectionWarning"]
    assert {r["remote_id"]: r["miss_streak"] for r in _remote_index_rows(source["id"])} == before


async def test_exactly_the_floor_is_guarded(source, vault):
    ids = [f"n{i}" for i in range(engine.DELETE_GUARD_MIN_KNOWN)]
    vault.refs = _refs(*ids)
    vault.notes_by_id = {i: _rn(i, f"Note {i}") for i in ids}
    await engine.sync_source(source["id"], full=True)
    vault.refs = _refs(*ids[:4])
    _a_night_later(source["id"])
    r = await engine.sync_source(source["id"], full=True, manual=True)
    assert r["status"] == "warning" and r["deleteDetectionWarning"]
