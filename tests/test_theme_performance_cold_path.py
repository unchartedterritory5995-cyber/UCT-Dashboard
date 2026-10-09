"""Perf wave 2: /api/theme-performance was 7.5 s cold. The two live snapshot maps are fetched
concurrently, and while no US session can print the live windows are long (quiet hours)."""
from __future__ import annotations

import time
from datetime import datetime, timezone

from api.services import theme_performance as tp
from api.routers import theme_performance as tpr


def test_quiet_hours_are_weekends_and_overnight_ET():
    assert tp.prices_moving(datetime(2026, 10, 8, 14, 0, tzinfo=timezone.utc)) is True    # Thu 10:00 ET
    assert tp.prices_moving(datetime(2026, 10, 8, 23, 30, tzinfo=timezone.utc)) is True   # Thu 19:30 ET
    assert tp.prices_moving(datetime(2026, 10, 9, 2, 0, tzinfo=timezone.utc)) is False    # Thu 22:00 ET
    assert tp.prices_moving(datetime(2026, 10, 10, 16, 0, tzinfo=timezone.utc)) is False  # Saturday
    assert tp.live_ttl(datetime(2026, 10, 10, 16, 0, tzinfo=timezone.utc)) == tp.QUIET_LIVE_TTL
    assert tp.live_ttl(datetime(2026, 10, 8, 14, 0, tzinfo=timezone.utc)) == tp._LIVE_1D_TTL


def test_the_two_live_maps_are_fetched_concurrently(monkeypatch):
    def slow_1d(syms):
        time.sleep(0.4)
        return {"AAA": 1.0}

    def slow_open(syms):
        time.sleep(0.4)
        return {"AAA": 0.5}
    monkeypatch.setattr(tp, "_fetch_live_1d_map", slow_1d)
    monkeypatch.setattr(tp, "_fetch_live_open_map", slow_open)
    base = {"themes": [{"name": "T", "holdings": [{"sym": "AAA", "returns": {"1d": 0.0}, "ref_prices": {}}]}]}
    t0 = time.time()
    tp._apply_live_returns(base)
    assert time.time() - t0 < 0.7          # one round, not two (0.8 s sequential)


def test_a_failed_open_leg_in_the_worker_still_marks_the_overlay_partial(monkeypatch):
    monkeypatch.setattr(tp, "_fetch_live_1d_map", lambda syms: {"AAA": 1.0})

    def bad_open(syms):
        tp._note_live_leg("open", tp._LIVE_OPEN_KEY, ["chunk 3"])
        return {}
    monkeypatch.setattr(tp, "_fetch_live_open_map", bad_open)
    failed = set()
    tp._live_legs.failed = failed
    try:
        tp._fetch_live_maps(["AAA"])
    finally:
        tp._live_legs.failed = None
    assert "open" in failed


def test_the_route_stale_bound_is_long_only_while_prices_cannot_move(monkeypatch):
    monkeypatch.setattr(tpr, "serve_with_tier", lambda *a, **k: (({}, True), "fresh", None))
    monkeypatch.setattr(tp, "prices_moving", lambda now=None: False)
    tpr.serve_theme_performance()
    assert tpr._THEME_STALE.max_age == tpr.THEME_STALE_QUIET_MAX_AGE
    monkeypatch.setattr(tp, "prices_moving", lambda now=None: True)
    tpr.serve_theme_performance()
    assert tpr._THEME_STALE.max_age == tpr.THEME_STALE_MAX_AGE
