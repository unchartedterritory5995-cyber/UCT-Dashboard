"""The day's deal sets are built once, then never rebuilt on a reader's thread (`deal_status._SETS`).

Before 2026-11-15 every consumer that picks names rebuilt `pending_deal_symbols()` on its own
thread whenever the snapshot expired (every 4 h, every 5 min while names are cold after a boot,
after a PC push), and two readers at once each did the whole build. A route census found 27
member routes that reach it.
"""
from __future__ import annotations

import threading
from datetime import date

import pytest

from api.services import deal_status as ds

DAY = date(2026, 11, 16)


@pytest.fixture(autouse=True)
def _world(monkeypatch):
    clock = {"t": 1_000_000.0, "day": DAY}
    builds = []

    def build():
        builds.append(clock["t"])
        return {"pending": frozenset({f"P{len(builds)}"}), "completed": frozenset({f"C{len(builds)}"}),
                "day": clock["day"], "at": clock["t"], "ttl": 100.0}
    monkeypatch.setattr(ds, "_build_sets", build)
    monkeypatch.setattr(ds, "_today", lambda: clock["day"])
    monkeypatch.setattr(ds.time, "time", lambda: clock["t"])
    ds.reset_cache()
    yield clock, builds
    ds.reset_cache()


def test_the_first_read_builds_and_later_reads_reuse_it(_world):
    clock, builds = _world
    assert ds.pending_deal_symbols() == {"P1"}
    assert ds.completed_deal_symbols() == {"C1"}
    clock["t"] += 50
    assert ds.pending_deal_symbols() == {"P1"}
    assert len(builds) == 1


def test_an_expired_set_is_served_at_once_and_ONE_refresh_replaces_it(_world, monkeypatch):
    clock, builds = _world
    spawned = []
    monkeypatch.setattr(ds, "_spawn_sets_refresh", lambda: spawned.append(1))
    ds.pending_deal_symbols()
    clock["t"] += 150                                   # past the 100 s ttl
    for _ in range(5):
        assert ds.pending_deal_symbols() == {"P1"}      # the reader never waits
    assert len(spawned) == 1 and len(builds) == 1       # one refresh, not five
    ds._refresh_sets()                                  # the refresh lands
    assert ds.pending_deal_symbols() == {"P2"}
    assert ds._SETS["busy"] is False


def test_the_day_s_first_build_runs_once_for_readers_that_arrive_together(_world, monkeypatch):
    clock, builds = _world
    gate = threading.Event()
    real = ds._build_sets

    def slow():
        gate.wait(5)
        return real()
    monkeypatch.setattr(ds, "_build_sets", slow)
    out = []
    readers = [threading.Thread(target=lambda: out.append(ds.pending_deal_symbols())) for _ in range(4)]
    for r in readers:
        r.start()
    gate.set()
    for r in readers:
        r.join(5)
    assert out == [{"P1"}] * 4 and len(builds) == 1


def test_a_new_day_is_never_served_from_yesterday(_world, monkeypatch):
    clock, builds = _world
    monkeypatch.setattr(ds, "_spawn_sets_refresh", lambda: pytest.fail("a new day was stale-served"))
    ds.pending_deal_symbols()
    clock["day"] = date(2026, 11, 17)
    assert ds.pending_deal_symbols() == {"P2"} and len(builds) == 2


def test_a_reset_during_a_refresh_discards_that_refresh(_world, monkeypatch):
    """A PC push resets the cache: a refresh that began before it read the old lists."""
    clock, builds = _world
    ds.pending_deal_symbols()
    real = ds._build_sets

    def build_then_reset():
        got = real()
        ds.reset_cache()                                # the push lands mid-build
        return got
    monkeypatch.setattr(ds, "_build_sets", build_then_reset)
    ds._refresh_sets()
    assert ds._SETS["v"] is None


def test_a_failed_refresh_keeps_the_last_sets(_world, monkeypatch):
    clock, builds = _world
    ds.pending_deal_symbols()

    def boom():
        raise RuntimeError("store unreadable")
    monkeypatch.setattr(ds, "_build_sets", boom)
    ds._SETS["busy"] = True
    ds._refresh_sets()
    assert ds.pending_deal_symbols() == {"P1"} and ds._SETS["busy"] is False


def test_a_first_build_fault_yields_the_hand_lists(_world, monkeypatch):
    def boom():
        raise RuntimeError("store unreadable")
    monkeypatch.setattr(ds, "_build_sets", boom)
    monkeypatch.setattr(ds, "hand_deals", lambda: frozenset({"HAND"}))
    monkeypatch.setattr(ds, "mirror_list", lambda: frozenset({"PC"}))
    assert ds.pending_deal_symbols() == {"HAND", "PC"}
    assert ds.completed_deal_symbols() == frozenset()
