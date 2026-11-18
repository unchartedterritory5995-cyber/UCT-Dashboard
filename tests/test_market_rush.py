"""Heavy jobs stay out of the opening and closing rush (desktop speed plan 10.5)."""
from __future__ import annotations

import datetime as dt
import importlib.util
import pathlib
from zoneinfo import ZoneInfo

import pytest

from api.services import market_rush as mr

ET = ZoneInfo("America/New_York")
WED = dt.date(2026, 11, 11)


def at(h, m, day=WED):
    return dt.datetime(day.year, day.month, day.day, h, m, tzinfo=ET)


@pytest.mark.parametrize("h,m,expected,want", [
    (9, 38, 8, "opening"),     # the measured 2026-11-11 run: inside the rush
    (9, 18, 8, "opening"),     # starts before, runs into it
    (9, 11, 8, None),          # finishes 09:19, before the rush
    (9, 45, 8, None),          # the rush is over (half-open end)
    (9, 44, 0, "opening"),
    (15, 25, 8, "closing"),
    (16, 15, 8, None),
    (12, 0, 8, None),
])
def test_should_wait(h, m, expected, want):
    assert mr.should_wait(at(h, m), expected) == want


def test_weekends_never_wait():
    sat = WED + dt.timedelta(days=3)
    assert mr.should_wait(at(9, 38, sat), 8) is None


def test_a_utc_time_is_read_in_et():
    utc = at(9, 38).astimezone(dt.timezone.utc)
    assert mr.should_wait(utc, 8) == "opening"


def test_the_rush_windows_match_the_deploy_freeze():
    """api/ cannot import tools/, so the windows are restated; this keeps them one fact."""
    path = pathlib.Path(__file__).resolve().parents[1] / "tools" / "deploy_freeze.py"
    spec = importlib.util.spec_from_file_location("_freeze_for_rush_test", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.BURST_WINDOWS_ET == mr.RUSH_WINDOWS_ET


def test_the_per_company_news_sweep_skips_a_rush_run(monkeypatch):
    """Behaviour, not text: run the REAL registered job during a rush and outside one."""
    import api.main as main
    from api.services.news import ingest

    jobs = {}

    class FakeScheduler:
        def add_job(self, func, *a, **kw):
            jobs[kw.get("id")] = func

    monkeypatch.setenv("COMPANY_NEWS_INGEST_ENABLED", "1")
    assert main.register_company_news_jobs(FakeScheduler()) is True
    calls = []
    monkeypatch.setattr(ingest, "_active_universe", lambda *a, **kw: calls.append(1) or [])

    monkeypatch.setattr(mr, "should_wait", lambda now, minutes: "opening")
    jobs["company_news_percompany"]()
    assert calls == []          # skipped: no fetching started during the rush

    monkeypatch.setattr(mr, "should_wait", lambda now, minutes: None)
    jobs["company_news_percompany"]()
    assert calls == [1]         # outside the rush it runs as before
