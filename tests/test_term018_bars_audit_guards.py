"""TERM-018: the four bars-freshness pages in `_run_5min_check`, observed (G-05..G-08).

`bars_continuous_audit._run_5min_check` holds four guards on the chart-health channel:

* G-05 `bars_store_unhealthy` critical: the store cannot serve at all.
* G-06 `bars_daily_store_stale` critical: the DAILY store is behind its session.
* G-07 `intraday_hotset_stale` critical: >= 20% of actively viewed intraday charts
  are a whole session behind.
* G-08 `intraday_hotset_stale` warning: >= 8% (and under 20%).

Every test runs the REAL check with only its inputs (the store, the hot set, the
freshness reads) and the sink replaced. The two hot-set thresholds are driven AT
their boundaries, so moving either threshold, or swapping a severity, goes red; the
CONTROLS prove each guard says NO just under its line.
"""
from __future__ import annotations

import pytest

from api.services import bars_continuous_audit, bars_fetch, bars_prewarm, bars_sqlite
from api.services import cadence_heartbeat, chart_health_alerts


@pytest.fixture
def check(monkeypatch):
    """Drive `_run_5min_check` with a healthy store and nothing stale by default."""
    seen: list[tuple[str, str]] = []
    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda key, sev, msg, meta=None, **k: seen.append((key, sev)) or True)
    monkeypatch.setattr(cadence_heartbeat, "mark", lambda *a, **k: None)
    monkeypatch.setattr(bars_sqlite, "store_health", lambda: {"ok": True, "kind": "ok"})
    monkeypatch.setattr(bars_sqlite, "get_all_tickers", lambda: [])
    monkeypatch.setattr(bars_prewarm, "daily_freshness_report", lambda *a, **k: {"stale": False})
    state = {"hot": [], "cold": set(), "current": None}
    monkeypatch.setattr(bars_fetch, "get_hot_intraday_tickers", lambda n=500: list(state["hot"]))

    def last_ts(t, tf):
        # One intraday timeframe (60) carries a bar for every hot ticker; the rest never do.
        if tf != "60":
            return None
        state["current"] = t
        return 1_000
    monkeypatch.setattr(bars_sqlite, "get_last_ts", last_ts)
    monkeypatch.setattr(bars_fetch, "_is_cold_stale_intraday",
                        lambda tf, last, now=None: state["current"] in state["cold"])

    def run(*, hot_n: int = 0, cold_n: int = 0):
        state["hot"] = [f"T{i:03d}" for i in range(hot_n)]
        state["cold"] = set(state["hot"][:cold_n])
        seen.clear()
        bars_continuous_audit._run_5min_check()
        return list(seen)

    run.seen = seen
    return run


# ── G-05 ────────────────────────────────────────────────────────────────────

def test_an_unhealthy_store_pages_critical_and_stops(check, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "store_health",
                        lambda: {"ok": False, "kind": "missing_table", "detail": "no ohlcv"})
    assert check(hot_n=10, cold_n=10) == [("bars_store_unhealthy", "critical")]


def test_CONTROL_a_healthy_quiet_store_raises_nothing(check):
    assert check(hot_n=10, cold_n=0) == []


# ── G-06 ────────────────────────────────────────────────────────────────────

def test_a_stale_daily_store_pages_critical(check, monkeypatch):
    monkeypatch.setattr(bars_prewarm, "daily_freshness_report",
                        lambda *a, **k: {"stale": True, "days_behind": 3,
                                         "newest_session": "2026-10-06",
                                         "expected_session": "2026-10-09"})
    assert check() == [("bars_daily_store_stale", "critical")]


# ── G-07 / G-08: the hot-set thresholds, at their boundaries ────────────────

def test_a_fifth_of_the_hot_set_stale_pages_critical(check):
    assert check(hot_n=100, cold_n=20) == [("intraday_hotset_stale", "critical")]


def test_just_under_a_fifth_is_a_warning_not_a_page(check):
    assert check(hot_n=100, cold_n=19) == [("intraday_hotset_stale", "warning")]


def test_eight_percent_of_the_hot_set_stale_is_a_warning(check):
    assert check(hot_n=100, cold_n=8) == [("intraday_hotset_stale", "warning")]


def test_CONTROL_just_under_eight_percent_raises_nothing(check):
    assert check(hot_n=100, cold_n=7) == []
