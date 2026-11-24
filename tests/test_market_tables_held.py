"""The held-only readers terminal data wave 11 added beside three services (MD-1 §4.20): `sector_earnings_held.held_season`,
`estimate_revisions_held.held_breadth`, `ipo_lockups_held.held_lockups`.

Each service's route read answers through `held_build.HeldBuild.get()`, which starts the one background build when the
held answer is due and, with nothing held, waits on it. Each reader here answers from `peek()` only. Pinned: with an
answer held BY the service (over the invented reads its own test file stands in for), the reader gives exactly the
route's own answer, for every season / estimate and window; with nothing held it says so and starts no thread; and the
route's read, in that same empty state, does start one (so the rail can fail). Every figure is invented.
"""
from __future__ import annotations

import threading

import pytest

from api.services import estimate_history as EH, estimate_revisions as ER, estimate_revisions_held
from api.services import group_stats as GS, held_reads, local_bars, scan_ipo
from api.services import ipo_lockups as LK, ipo_lockups_held
from api.services import sector_earnings as SE, sector_earnings_calc as SEC, sector_earnings_held
from tests import test_estimate_revisions as T_ER
from tests import test_ipo_lockups as T_IL
from tests import test_sector_earnings as T_SE


@pytest.fixture(autouse=True)
def fresh(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv(EH.ENABLED_ENV, "1")
    monkeypatch.setenv("ESTIMATE_HISTORY_DB_PATH", str(tmp_path / "eh.db"))
    monkeypatch.setattr(SE, "_today", lambda: T_SE.TODAY)
    monkeypatch.setattr(LK, "now_et", lambda: T_IL.NOW)
    for svc in (SE, ER, LK):
        svc.reset_for_tests()
    yield
    SE.drain_for_tests()
    ER.drain_for_tests()
    LK._HELD.drain()
    for svc in (SE, ER, LK):
        svc.reset_for_tests()


@pytest.fixture
def threads(monkeypatch):
    seen = []
    real = threading.Thread.start
    monkeypatch.setattr(threading.Thread, "start", lambda self: seen.append(self.name) or real(self))
    return seen


def _season_world(mp):
    read, reads = T_SE._reader(T_SE._copies())
    real = SE.build
    mp.setattr(SE, "build", lambda previous=None, **k: real(previous, symbols=T_SE.SYMS, groups=T_SE.GROUPS, read=read,
                                                            today=T_SE.TODAY, trading_day=T_SE._trading, yield_s=0))
    return reads


def _lockup_world(mp, live=T_IL.LIVE):
    mp.setattr(scan_ipo, "held_listings", lambda: {"live": live, "sources": dict(T_IL.SOURCES), "date": "2026-11-20"})
    mp.setattr(held_reads, "held_name", lambda s: None)
    reads = []
    mp.setattr(local_bars, "read_bars", lambda sym, tf, want: reads.append(sym) or [])
    return reads


def test_held_season_is_the_routes_own_table_for_every_season_and_never_reads(monkeypatch, threads):
    reads = _season_world(monkeypatch)
    assert sector_earnings_held.held_season("current") == (None, "not_held")
    assert threads == [] and reads == []                               # nothing held: said, nothing started
    SE.get_season()                                                    # the route's read starts the one read, in the same state
    SE.drain_for_tests()
    assert threads == ["sector-earnings-build"] and reads
    threads.clear()
    asked = len(reads)
    for season in SEC.SEASON_IDS:
        got, how = sector_earnings_held.held_season(season)
        assert how == "held" and got == SE.get_season(season), season
    assert sector_earnings_held.held_season("next") == (None, "not_held")
    assert threads == [] and len(reads) == asked
    assert "READ ONLY" in sector_earnings_held.held_season.__doc__


def test_held_breadth_is_the_routes_own_answer_for_every_estimate_and_window_and_never_reads(monkeypatch, threads):
    T_ER._fill()
    monkeypatch.setattr(GS, "_group_map", lambda: dict(T_ER.GROUPS))
    assert estimate_revisions_held.held_breadth("eps", 30) == (None, "not_held") and threads == []
    ER.get_breadth()
    ER.drain_for_tests()
    assert threads == ["estimate-revisions-build"]
    threads.clear()
    for metric in ER.METRICS:
        for window in ER.WINDOWS:
            got, how = estimate_revisions_held.held_breadth(metric, window)
            assert how == "held" and got == ER.get_breadth(metric, window), (metric, window)
    assert estimate_revisions_held.held_breadth("ebitda", 30) == (None, "not_held")
    assert estimate_revisions_held.held_breadth("eps", 14) == (None, "not_held")
    assert threads == []


def test_held_lockups_is_the_routes_own_answer_and_never_builds(monkeypatch, threads):
    reads = _lockup_world(monkeypatch)
    assert ipo_lockups_held.held_lockups() == (None, "not_held") and threads == [] and reads == []
    LK.get_lockups()
    LK._HELD.drain()
    assert threads == ["ipo-lockups-build"] and reads
    threads.clear()
    asked = len(reads)
    got, how = ipo_lockups_held.held_lockups()
    assert how == "held" and got == LK.get_lockups() and "v" not in got
    assert {r["basis"] for r in got["rows"]} == {"estimated"}
    assert threads == [] and len(reads) == asked


def test_held_lockups_from_before_the_listings_scan_answered_is_held_as_warming(monkeypatch, threads):
    _lockup_world(monkeypatch, live=None)
    LK.get_lockups()
    LK._HELD.drain()
    threads.clear()
    got, how = ipo_lockups_held.held_lockups()
    assert how == "held" and got["status"] == "warming" and got["rows"] == [] and threads == []
