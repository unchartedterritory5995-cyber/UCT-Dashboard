"""Wave 4 lane C: the Calendar WIDGET's request (`?week=<Monday of the last session
day>&full_impact=1`) had two cold paths the current-week warm never covered.

1. On a weekend the calendar anchor rolls forward to next week while the widget keeps
   showing the week just finished -- a range-week key nothing warmed.
2. The full-impact econ (`econ_full::{week}`, 300 s TTL) was fetched on the request
   path whenever the TTL lapsed, and the widget polls every 300 s."""
from __future__ import annotations

import ast
import inspect
import textwrap
import time
from datetime import date

import pytest

from api.routers import calendar as cal
from api.services import econ_calendar_fmp
from api.services.cache import cache


@pytest.fixture
def calls(monkeypatch):
    seen = {"range": [], "econ": []}
    monkeypatch.setattr(cal, "_get_or_build_range_week", lambda m: seen["range"].append(m))
    monkeypatch.setattr(cal, "_full_econ_cached", lambda ws, we: seen["econ"].append((ws, we)))
    return seen


def test_on_a_saturday_the_widget_week_just_finished_is_warmed(calls):
    cal.rewarm_widget_week_once(today=date(2026, 10, 10))          # Saturday
    assert calls["range"] == [date(2026, 10, 5)]
    assert calls["econ"] == [("2026-10-05", "2026-10-09")]


def test_on_a_sunday_too(calls):
    cal.rewarm_widget_week_once(today=date(2026, 10, 11))          # Sunday
    assert calls["range"] == [date(2026, 10, 5)]


def test_on_a_weekday_the_widget_week_is_the_current_week(calls):
    cal.rewarm_widget_week_once(today=date(2026, 10, 7))           # Wednesday
    assert calls["range"] == []                    # the current-week warm already owns it
    assert calls["econ"] == [("2026-10-05", "2026-10-09")]


def test_the_rewarm_loop_runs_the_widget_warm():
    src = textwrap.dedent(inspect.getsource(cal.start_weekly_rewarm))
    called = {n.func.id for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "rewarm_widget_week_once" in called
    assert "rewarm_current_week_once" in called    # control: the probe sees the sibling


def test_a_lapsed_full_econ_ttl_is_served_from_the_slot_not_fetched_inline(monkeypatch):
    ws, we = "2031-01-06", "2031-01-10"
    fetched = []

    def slow_fmp(a, b):
        time.sleep(0.6)
        fetched.append((a, b))
        return {"2031-01-07": {"econ": [{"title": "CPI"}], "fed": []}}

    monkeypatch.setattr(econ_calendar_fmp, "fetch_us_econ_week_full", slow_fmp)
    old = {"2031-01-07": {"econ": [{"title": "old"}], "fed": []}}
    cal._ECON_FULL_STALE.remember(ws, old, at=time.time() - 10 * 60)   # 10 min old
    cache.invalidate(f"econ_full::{ws}")                                  # TTL lapsed
    try:
        t0 = time.time()
        got = cal._full_econ_cached(ws, we)
        assert time.time() - t0 < 0.3              # no provider round trip on the request
        assert got == old
        for _ in range(40):                        # ...and exactly one refresh behind it
            if fetched:
                break
            time.sleep(0.05)
        assert fetched == [(ws, we)]
    finally:
        for _ in range(40):
            v, _age = cal._ECON_FULL_STALE.peek(ws)
            if v != old:
                break
            time.sleep(0.05)
        cal._ECON_FULL_STALE.forget(ws)
        cache.invalidate(f"econ_full::{ws}")


def test_the_slot_bound_outlives_the_rewarm_interval():
    assert cal.WEEKLY_REWARM_INTERVAL_S + 120 <= cal._ECON_FULL_STALE_MAX_AGE
