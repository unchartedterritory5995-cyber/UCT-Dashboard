"""The READ ONLY forms added for the UCT Agent's `stock.eventsTimeline` data kind (MD-1 §4.16):
`earnings_reaction_panel.held_earnings(sym)` and `events_timeline.timeline(sym, held_only=True)`.

No network and no real store: the earnings cache and snapshot store are stand-ins and the three event stores are
stubbed. Every number is invented. Pinned: the held reader returns the cache, then the snapshot store, then None, and
never schedules the earnings rebuild; `_cached_earnings` is the same read plus the rebuild on a miss (unchanged);
`timeline(held_only=True)` reports an earnings history that is not held as the source state `not_held` with its own
reason and schedules nothing, while the default call schedules the rebuild in the same state and still says
`pending` (so the rail can fail).
"""
from __future__ import annotations

import pytest

from api.services import earnings_intel as ei
from api.services import earnings_reaction_panel as erp
from api.services import events_timeline as ev

PAYLOAD = {"quarters": [
    {"label": "Q2", "report_date": "2026-04-28", "reported": True, "eps_actual": 1.1, "eps_estimate": 1.0},
    {"label": "Q1", "report_date": "2026-01-27", "reported": True, "eps_actual": 0.9, "eps_estimate": 1.0},
], "summary": {"next_report_date": "2026-07-28", "next_report_label": "Q3"}}


class Snap:
    """Stands where the fundamentals snapshot store stands."""

    def __init__(self):
        self.held, self.asked = {}, []

    def get(self, kind, sym):
        self.asked.append((kind, sym))
        hit = self.held.get(sym)
        return (hit, 0) if hit is not None else None

    def put(self, *a, **kw):
        raise AssertionError("a held read wrote to the snapshot store")


@pytest.fixture
def world(monkeypatch):
    snap, scheduled = Snap(), []
    monkeypatch.setattr(ei, "snap_store", snap)
    monkeypatch.setattr(ei, "_schedule_refresh", lambda s: scheduled.append(s))
    for sym in ("AAA", "BBB"):
        ei.cache.invalidate(f"{ei._KIND}::{sym}")
    monkeypatch.setitem(ev.SOURCES, "uct_catalyst", lambda s: [
        {"date": "2026-04-24", "kind": "uct_catalyst", "title": "UCT catalyst engine: Earnings", "detail": None,
         "source": "UCT catalyst engine (catalysts.db)"}])
    monkeypatch.setitem(ev.SOURCES, "filing", lambda s: [])
    monkeypatch.setitem(ev.SOURCES, "room_spike", lambda s: [])
    yield snap, scheduled
    for sym in ("AAA", "BBB"):
        ei.cache.invalidate(f"{ei._KIND}::{sym}")


def test_the_held_reader_reads_the_cache_then_the_snapshot_store_and_never_schedules(world):
    snap, scheduled = world
    assert erp.held_earnings.__doc__.startswith("READ ONLY")
    assert erp.held_earnings("AAA") is None and scheduled == []                 # nothing held: None, no rebuild
    snap.held["AAA"] = PAYLOAD
    assert erp.held_earnings("AAA") is PAYLOAD                                  # the snapshot store
    snap.held["AAA"] = {"quarters": []}
    assert erp.held_earnings("AAA") is None                                     # a stored payload with no quarter
    cached = {"quarters": [PAYLOAD["quarters"][0]]}
    ei.cache.set(f"{ei._KIND}::AAA", cached, 60)
    assert erp.held_earnings("AAA") is cached                                   # the cache wins
    assert scheduled == []


def test_cached_earnings_is_the_held_read_plus_the_rebuild_on_a_miss(world):
    snap, scheduled = world
    assert erp._cached_earnings("AAA") is None and scheduled == ["AAA"]         # a miss schedules, as before
    snap.held["BBB"] = PAYLOAD
    assert erp._cached_earnings("BBB") is PAYLOAD and scheduled == ["AAA"]      # a hit does not


def test_held_only_says_not_held_and_schedules_nothing_the_default_call_schedules(world):
    snap, scheduled = world
    out = ev.timeline("aaa", held_only=True)
    assert scheduled == []
    assert out["sources"]["earnings"] == {"state": "not_held", "events": 0}
    assert out["state"] == "unstaged" and out["reason"] == ev.NOT_HELD_REASON
    assert "being read" not in out["reason"]                                    # nothing is being read: say so
    assert [e["kind"] for e in out["events"]] == ["uct_catalyst"] and "stage" not in out["events"][0]
    # the default call, same state: the rebuild is scheduled and the panel's own words are unchanged
    default = ev.timeline("AAA")
    assert scheduled == ["AAA"]
    assert default["sources"]["earnings"]["state"] == "pending" and "being read" in default["reason"]


def test_held_only_with_a_held_history_is_the_same_timeline_as_the_default_call(world):
    snap, scheduled = world
    snap.held["AAA"] = PAYLOAD
    held, default = ev.timeline("AAA", held_only=True), ev.timeline("AAA")
    assert held == default and scheduled == []
    assert held["state"] == "ok" and held["sources"]["earnings"] == {"state": "ok", "events": 3}
    cat = [e for e in held["events"] if e["kind"] == "uct_catalyst"][0]
    assert (cat["print_date"], cat["stage"]) == ("2026-04-28", "T-2")


def test_held_only_with_a_history_that_has_no_print_is_empty_not_not_held(world):
    snap, scheduled = world
    ei.cache.set(f"{ei._KIND}::AAA", {"quarters": [{"reported": False}]}, 60)
    out = ev.timeline("AAA", held_only=True)
    assert out["sources"]["earnings"]["state"] == "empty" and out["reason"] != ev.NOT_HELD_REASON
    assert scheduled == []
