"""DVD MARKET's scheduled warm before the 03:00 Screener build (2026-11-23): the Screener's ex-dividend columns read
DVD MARKET's held list once per build, and only a member's open used to build it.

The two Massive date-range reads are stubs (`reference_corp_actions`'s strict fetchers), so nothing reaches a vendor;
the build itself is DVD MARKET's own (`dividends_market.build` through its `HeldBuild`). Times are built in New York
time; every figure is invented.
"""
from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

import pytest

import api.main as m
from api.services import dividends_market as dm
from api.services import reference_corp_actions as rca
from api.services.screener import side_pulls as sp

NY = ZoneInfo("America/New_York")
WARM = datetime(2031, 3, 12, *m.DVD_MARKET_WARM_ET, tzinfo=NY)       # a Wednesday's warm


@pytest.fixture
def reads(monkeypatch, tmp_path):
    asked: list = []
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(dm, "today_et", lambda: date(2031, 3, 12))
    monkeypatch.setattr(dm, "universe", lambda: frozenset({"QQZA"}))
    monkeypatch.setattr(dm, "held_name", lambda s: None)
    monkeypatch.setattr(rca, "fetch_market_dividends_strict", lambda a, b: asked.append(("dividends", a, b)) or [
        {"ticker": "QQZA", "ex_dividend_date": "2031-03-13", "cash_amount": 0.42}])
    monkeypatch.setattr(rca, "fetch_confirmed_splits_strict", lambda a, b: asked.append(("splits", a, b)) or [])
    dm._held.reset()
    yield asked
    dm._held.drain(10)
    dm._held.reset()


class _Sched:
    def __init__(self):
        self.jobs = {}

    def add_job(self, fn, **k):
        self.jobs[k.get("id")] = (fn, k)


def _field(trigger, name) -> str:
    return next(str(f) for f in trigger.fields if f.name == name)


def _registered(monkeypatch) -> _Sched:
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setattr(m, "start_screener_snapshot_warm", lambda: None)
    sched = _Sched()
    assert m.register_screener_jobs(sched) is True
    return sched


def test_the_warm_is_registered_daily_at_its_time_and_runs_the_warm(monkeypatch):
    fn, kw = _registered(monkeypatch).jobs["dividends_market_warm"]
    assert fn is m._run_dividends_market_warm
    trig = kw["trigger"]
    assert (_field(trig, "hour"), _field(trig, "minute")) == tuple(map(str, m.DVD_MARKET_WARM_ET))
    assert _field(trig, "day_of_week") == "*" and str(trig.timezone) == "America/New_York"
    assert kw["max_instances"] == 1 and kw["coalesce"] is True
    # its grace ends before the build: a late fire still lands before 03:00 reads the list
    assert m.DVD_MARKET_WARM_ET[0] * 3600 + m.DVD_MARKET_WARM_ET[1] * 60 + kw["misfire_grace_time"] \
        < m.SCREENER_NIGHTLY_ET[0] * 3600 + m.SCREENER_NIGHTLY_ET[1] * 60


def test_the_warm_time_is_quiet_every_day_before_the_build_and_shared_with_no_other_screener_job(monkeypatch):
    from api.services import catchup_slots
    for day in range(10, 17):                                                       # a whole week
        assert catchup_slots.quiet(datetime(2031, 3, day, *m.DVD_MARKET_WARM_ET, tzinfo=NY)), day
    assert m.DVD_MARKET_WARM_ET < m.SCREENER_NIGHTLY_ET
    assert m.DVD_MARKET_WARM_ET not in {p.run_at for p in sp.PULLS.values()}
    sched = _registered(monkeypatch)
    at_minute = []
    for jid, (_fn, kw) in sched.jobs.items():
        trig = kw.get("trigger")
        if hasattr(trig, "fields"):
            hours, minute = _field(trig, "hour"), _field(trig, "minute")
            if minute == str(m.DVD_MARKET_WARM_ET[1]) and hours in ("*", str(m.DVD_MARKET_WARM_ET[0])):
                at_minute.append(jid)
    assert at_minute == ["dividends_market_warm"], at_minute
    src = open(m.__file__, encoding="utf-8").read()
    h, mi = m.DVD_MARKET_WARM_ET
    assert f"hour={h}, minute={mi}," not in src                                     # no lifespan job at that minute


def test_the_warm_starts_dvd_markets_own_build_and_costs_nothing_once_it_is_current(reads):
    out = m._run_dividends_market_warm("nightly", now=WARM)
    dm._held.drain(10)
    assert out["started"] is True
    assert sorted(a[0] for a in reads) == ["dividends", "splits"]                   # the build's two reads, once
    held = dm._held.peek()
    assert held["status"] == "ok" and [d["sym"] for d in held["dividends"]] == ["QQZA"]
    m._run_dividends_market_warm("nightly", now=WARM)
    dm._held.drain(10)
    assert len(reads) == 2                                                          # held and not due: no read


def test_the_warm_returns_at_once_and_never_builds_on_its_own_thread(reads, monkeypatch):
    import threading
    seen = []
    real = dm.build
    monkeypatch.setattr(dm._held, "_build", lambda prev: seen.append(threading.current_thread().name) or real(prev))
    m._run_dividends_market_warm("nightly", now=WARM)
    dm._held.drain(10)
    assert seen and seen[0] != threading.current_thread().name


@pytest.mark.parametrize("busy", [datetime(2031, 3, 12, 7, 0, tzinfo=NY), datetime(2031, 3, 12, 13, 0, tzinfo=NY)])
def test_outside_the_quiet_span_the_warm_reads_nothing(reads, busy):
    assert m._run_dividends_market_warm("boot", now=busy) == {"started": False, "reason": "not_quiet"}
    dm._held.drain(10)
    assert reads == [] and dm._held.peek() is None


def test_the_warm_never_raises(monkeypatch):
    monkeypatch.setattr(dm, "get_market_dividends", lambda **k: (_ for _ in ()).throw(RuntimeError("invented")))
    assert m._run_dividends_market_warm("nightly", now=WARM)["reason"] == "error: RuntimeError"
