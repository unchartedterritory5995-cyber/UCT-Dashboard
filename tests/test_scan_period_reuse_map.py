"""The ticker-reuse map is never evicted and never recomputed on a boot or a reader's thread
when a file exists (`scan_period._reuse_map`).

2026-11-15: the map sat in the shared 1,000-entry LRU (evicted within the hour), and a file older
than seven days was ignored, so the first boot after it aged out ran the whole-universe window scan
during the reconnect burst (boot-probe: `reuse-map-warm` 60-110% of a core for 5+ minutes; starter
screens 6-80 s). The next boot, with a fresh file, never showed it.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime

import pytest

from api.services import scan_period as sp


@pytest.fixture(autouse=True)
def _iso(tmp_path, monkeypatch):
    monkeypatch.setattr(sp, "_REUSE_FILE", str(tmp_path / "period_reuse_map.json"))
    monkeypatch.setitem(sp._REUSE_MEM, "map", None)
    monkeypatch.setitem(sp._REUSE_MEM, "failed_at", 0.0)
    sp._reuse_refreshing.clear()
    computes = []

    def scan(floor):
        computes.append(floor)
        return {"NEW": 20250101}
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "current_listing_starts", scan)
    spawned = []
    monkeypatch.setattr(sp, "_spawn_reuse_refresh", lambda: spawned.append(1))
    yield computes, spawned
    sp._reuse_refreshing.clear()


def _write(m, age_s):
    with open(sp._REUSE_FILE, "w") as fh:
        json.dump(m, fh)
    t = time.time() - age_s
    os.utime(sp._REUSE_FILE, (t, t))


def test_a_fresh_file_is_served_without_a_compute_or_a_refresh(_iso):
    computes, spawned = _iso
    _write({"OLD": 20200101}, 3600)
    assert sp._reuse_map() == {"OLD": 20200101}
    assert computes == [] and spawned == []


def test_a_STALE_file_is_served_at_once_and_refreshed_later_never_on_the_reader(_iso):
    computes, spawned = _iso
    _write({"OLD": 20200101}, sp._REUSE_FILE_TTL + 86400)
    assert sp._reuse_map() == {"OLD": 20200101}
    assert computes == [] and spawned == [1]


def test_the_map_survives_shared_cache_churn(_iso):
    computes, _ = _iso
    _write({"OLD": 20200101}, 3600)
    sp._reuse_map()
    os.remove(sp._REUSE_FILE)
    for i in range(sp.cache.max_size + 50):          # churn the shared LRU past its bound
        sp.cache.set(f"churn-{i}", i, ttl=60)
    assert sp._reuse_map() == {"OLD": 20200101}       # from memory: no file, no compute
    assert computes == []


def test_no_file_computes_once_and_saves_it(_iso):
    computes, _ = _iso
    assert sp._reuse_map() == {"NEW": 20250101}
    assert sp._reuse_map() == {"NEW": 20250101}
    assert computes == [sp._REUSE_FLOOR]
    with open(sp._REUSE_FILE) as fh:
        assert json.load(fh) == {"NEW": 20250101}


def test_a_failed_compute_is_not_saved_and_not_retried_by_every_reader(_iso, monkeypatch):
    from api.services import bars_sqlite
    calls = []

    def boom(floor):
        calls.append(1)
        raise RuntimeError("database is locked")
    monkeypatch.setattr(bars_sqlite, "current_listing_starts", boom)
    assert sp._reuse_map() == {}
    assert sp._reuse_map() == {}
    assert len(calls) == 1
    assert not os.path.exists(sp._REUSE_FILE)          # an empty map never becomes the file


def test_the_deferred_refresh_waits_for_the_quiet_span_then_saves(_iso, monkeypatch):
    computes, _ = _iso
    clock = iter([False, False, True])
    monkeypatch.setattr(sp, "_reuse_quiet_now", lambda now=None: next(clock))
    slept = []
    monkeypatch.setattr(sp._time, "sleep", lambda s: slept.append(s))
    sp._reuse_refreshing.set()
    sp._refresh_reuse_map_when_quiet()
    assert len(slept) == 2 and computes == [sp._REUSE_FLOOR]
    assert sp._REUSE_MEM["map"] == {"NEW": 20250101}
    assert not sp._reuse_refreshing.is_set()


@pytest.mark.parametrize("when,quiet", [
    (datetime(2026, 11, 16, 10, 0), False),   # Monday mid-session
    (datetime(2026, 11, 16, 6, 30), True),    # before the pre-market crowd
    (datetime(2026, 11, 16, 20, 30), True),   # after the evening jobs
    (datetime(2026, 11, 16, 19, 0), False),
    (datetime(2026, 11, 15, 13, 0), True),    # Sunday
])
def test_the_quiet_span(when, quiet):
    assert sp._reuse_quiet_now(when) is quiet
