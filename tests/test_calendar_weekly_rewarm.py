"""Perf wave 2: /api/calendar was 7.2 s cold because the current-week serve-stale slot aged out
of its 30-min bound between the wire detector's windows. A re-warm loop now runs under that
bound, through the ordinary serve path."""
from __future__ import annotations

import ast
import pathlib
import time

from api.routers import calendar as cal

ROOT = pathlib.Path(__file__).resolve().parents[1]


def test_the_interval_is_under_the_stale_bound_with_margin_for_a_build():
    assert cal.WEEKLY_REWARM_INTERVAL_S + 120 <= cal._WEEKLY_STALE_MAX_AGE


def test_a_lapsed_ttl_is_refreshed_behind_the_tick_not_dropped(monkeypatch):
    built = []
    good = {"source": "live", "days": {"2026-10-08": {"bmo": [{"sym": "X"}]}}}
    monkeypatch.setattr(cal, "_build_current_week", lambda: built.append(1) or good)
    monkeypatch.setattr(cal.cache, "get", lambda k, *a, **kw: None)    # TTL lapsed
    cal._WEEKLY_STALE.remember("current", good, at=time.time() - 25 * 60)   # 25 min old
    try:
        cal.rewarm_current_week_once()
        for _ in range(40):
            if built:
                break
            time.sleep(0.05)
        assert built == [1]                                  # one background rebuild
        _v, age = cal._WEEKLY_STALE.peek("current")
        assert age is not None and age < 60                  # the slot is young again
    finally:
        cal._WEEKLY_STALE.forget("current")


def test_main_starts_the_rewarm_loop():
    src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    calls = {n.func.id for n in ast.walk(ast.parse(src))
             if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    assert "_start_weekly_rewarm" in calls
    assert "_start_calendar_enrichment_warm_background" in calls   # control: the probe sees siblings
