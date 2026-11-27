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


# -- the rushes follow the NYSE calendar (2026-11-26) --------------------------------------------------------------
# RUSH_WINDOWS_ET is the REGULAR day. Per day: none on a holiday; on a half-day the closing rush is close-30..close+15
# (12:30-13:15 ET for 13:00), mirroring 15:30-16:15 around 16:00; a calendar that cannot answer => the weekday rule.

THANKSGIVING = dt.date(2026, 11, 26)
HALF_DAY = dt.date(2026, 11, 27)
REGULAR = dt.date(2026, 12, 3)


def test_half_day_1245_is_inside_the_closing_rush():
    assert mr.should_wait(at(12, 45, HALF_DAY), 0) == "closing"
    assert mr.should_wait(at(12, 25, HALF_DAY), 8) == "closing"      # runs into it
    assert mr.should_wait(at(13, 15, HALF_DAY), 8) is None           # half-open end
    assert mr.day_rush_windows(HALF_DAY) == (("opening", (9, 20), (9, 45)), ("closing", (12, 30), (13, 15)))


def test_half_day_1545_is_not_a_rush():
    assert mr.should_wait(at(15, 45, HALF_DAY), 8) is None
    assert mr.should_wait(at(9, 38, HALF_DAY), 8) == "opening"       # the open is unchanged


def test_thanksgiving_has_no_rush():
    assert mr.day_rush_windows(THANKSGIVING) == ()
    assert mr.should_wait(at(9, 38, THANKSGIVING), 8) is None
    assert mr.should_wait(at(15, 45, THANKSGIVING), 8) is None


def test_a_regular_day_is_unchanged():
    assert mr.day_rush_windows(REGULAR) == mr.RUSH_WINDOWS_ET
    assert mr.should_wait(at(15, 45, REGULAR), 8) == "closing"
    assert mr.should_wait(at(12, 45, REGULAR), 8) is None


def test_a_calendar_failure_falls_back_to_the_weekday_rule(monkeypatch):
    def broken():
        raise RuntimeError("calendar unreadable")
    monkeypatch.setattr(mr, "_calendar", broken)
    assert mr.day_rush_windows(THANKSGIVING) == mr.RUSH_WINDOWS_ET
    assert mr.should_wait(at(15, 45, THANKSGIVING), 8) == "closing"
    assert mr.should_wait(at(15, 45, HALF_DAY), 8) == "closing"


def test_a_date_past_the_calendar_horizon_uses_the_weekday_rule():
    from api.services import session_calendar as sc
    day = sc.horizon() + dt.timedelta(days=1)
    while day.weekday() >= 5:
        day += dt.timedelta(days=1)
    assert mr.day_rush_windows(day) == mr.RUSH_WINDOWS_ET


def test_the_per_day_rushes_match_the_deploy_freeze_every_day():
    """api/ cannot import tools/: deploy_freeze's per-day rushes are derived twice; this keeps them one fact."""
    path = pathlib.Path(__file__).resolve().parents[1] / "tools" / "deploy_freeze.py"
    spec = importlib.util.spec_from_file_location("_freeze_for_rush_days", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    day, seen_half, seen_holiday = dt.date(2026, 1, 1), 0, 0
    while day <= dt.date(2028, 12, 31):
        theirs = tuple(w for w in mod.day_hold_windows(day) if w[0] in ("opening", "closing"))
        ours = mr.day_rush_windows(day)
        assert ours == theirs, day
        seen_half += ours[-1:] != (mr.RUSH_WINDOWS_ET[1],) and len(ours) == 2
        seen_holiday += day.weekday() < 5 and ours == ()
        day += dt.timedelta(days=1)
    assert seen_half >= 3 and seen_holiday >= 20, (seen_half, seen_holiday)   # not vacuous: real half-days and holidays were compared
