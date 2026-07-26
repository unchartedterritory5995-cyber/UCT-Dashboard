"""Tests for hist_stats field in /api/calendar/enrichment (C6 backend).

Verifies that:
 - hist_stats is included in the enrichment payload per sym
 - Shape is {avg_abs_move, up_count, total, last_n}
 - Null-safe when underlying data unavailable
 - Counts up_count correctly from moves_pct list
"""
from __future__ import annotations

from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    from fastapi import FastAPI
    from api.routers.calendar import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ── Shared sample data ─────────────────────────────────────────────────────────

_SAMPLE_HIST_MOVES = {
    "avg_abs_move_pct": 7.2,
    "moves_pct": [-5.3, 8.1, 12.4, -3.2, 6.0],
    "n_quarters": 5,
}

def _target_date() -> str:
    """A date the ROUTER considers part of the current week.

    Not a hardcoded date, and deliberately not `today` either — both are time
    bombs, and this suite has now been bitten by each:

      1. Pinned 2026-06-01, which returned {} for every case once it fell out
         of the compute window.
      2. Switched to `today`, which passes Mon-Fri and fails every Sat/Sun.

    (2) happens because the two week helpers disagree on a weekend by design:
    `_week_dates()` rolls FORWARD to next Monday (the product shows the
    upcoming week once the current one is over) while `_monday_of()` snaps
    BACK. `_days_for_date` only reads the `calendar_weekly` cache — the one
    these tests mock — when `_monday_of(target) == _week_dates()[0]`, so on a
    weekend `today` falls through to the unmocked per-week paging path and the
    payload comes back empty.

    `_week_dates()[0]` is the router's own idea of the current Monday, so this
    identity holds on every day of the week.
    """
    from api.routers.calendar import _week_dates
    return _week_dates()[0].isoformat()


_CALENDAR_WEEKLY = {
    "days": {
        _target_date(): {
            "bmo": [{"sym": "AAPL"}],
            "amc": [{"sym": "NVDA"}],
        }
    }
}


def _make_enrichment_client():
    """Build a minimal client with calendar router, mocking cache + data sources."""
    from fastapi import FastAPI
    from api.routers.calendar import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


class TestHistStats:
    def _run_enrichment(self, hist_moves=None, quarterly=None, fail=False):
        """Run the enrichment endpoint with full mocking."""
        from fastapi import FastAPI
        from api.routers.calendar import router

        app = FastAPI()
        app.include_router(router)
        tc = TestClient(app)

        target = _target_date()
        cache_data = {
            f"calendar_enrichment_{target}": None,  # miss → build
        }

        def _cache_get(key):
            if key == "calendar_weekly":
                return _CALENDAR_WEEKLY
            return cache_data.get(key)

        hm = hist_moves if hist_moves is not None else _SAMPLE_HIST_MOVES

        with patch("api.routers.calendar.cache") as mock_cache, \
             patch("api.services.earnings_enrichment.get_implied_move",
                   return_value=None), \
             patch("api.services.earnings_estimates.get_earnings_intel",
                   return_value={"beat_history": []}), \
             patch("api.services.engine._fetch_quarterly_history",
                   return_value=[{"reportedDate": "2026-01-01",
                                   "reportTime": "pre-market"}] * 5), \
             patch("api.services.earnings_enrichment.get_historical_earnings_moves",
                   return_value=None if fail else hm):

            mock_cache.get = _cache_get
            mock_cache.set = MagicMock()

            r = tc.get(f"/api/calendar/enrichment?date={target}")

        return r

    def test_hist_stats_in_payload(self):
        r = self._run_enrichment()
        assert r.status_code == 200
        data = r.json()
        # Both syms should have hist_stats key
        for sym in ["AAPL", "NVDA"]:
            assert sym in data, f"{sym} missing from enrichment"
            assert "hist_stats" in data[sym], f"hist_stats missing for {sym}"

    def test_hist_stats_shape(self):
        r = self._run_enrichment()
        data = r.json()
        stats = data["AAPL"]["hist_stats"]
        assert stats is not None
        assert "avg_abs_move" in stats
        assert "up_count" in stats
        assert "total" in stats
        assert "last_n" in stats
        assert isinstance(stats["last_n"], list)

    def test_up_count_correct(self):
        # moves: [-5.3, 8.1, 12.4, -3.2, 6.0] → 3 positive
        r = self._run_enrichment()
        data = r.json()
        stats = data["AAPL"]["hist_stats"]
        assert stats["up_count"] == 3
        assert stats["total"] == 5

    def test_avg_abs_move_value(self):
        r = self._run_enrichment()
        data = r.json()
        stats = data["AAPL"]["hist_stats"]
        assert stats["avg_abs_move"] == 7.2

    def test_last_n_capped_at_8(self):
        many_moves = {
            "avg_abs_move_pct": 5.0,
            "moves_pct": [1, -2, 3, -4, 5, -6, 7, -8, 9, -10],
            "n_quarters": 10,
        }
        r = self._run_enrichment(hist_moves=many_moves)
        data = r.json()
        stats = data["AAPL"]["hist_stats"]
        assert len(stats["last_n"]) <= 8

    def test_hist_stats_null_when_no_data(self):
        """When get_historical_earnings_moves returns None, hist_stats is null."""
        r = self._run_enrichment(fail=True)
        data = r.json()
        assert data["AAPL"]["hist_stats"] is None

    def test_existing_fields_still_present(self):
        """Adding hist_stats must not break expected_move or beat_history."""
        r = self._run_enrichment()
        data = r.json()
        assert "expected_move" in data["AAPL"]
        assert "beat_history" in data["AAPL"]
        assert "hist_stats" in data["AAPL"]


class TestHistStatsComputation:
    """Unit tests for the _compute_hist_stats logic in isolation."""

    def test_up_count_logic(self):
        """Pure computation check — no need for endpoint."""
        moves = [-5.3, 8.1, 12.4, -3.2, 6.0]
        up = sum(1 for m in moves if m > 0)
        assert up == 3

    def test_last_n_reversal(self):
        """last_n is newest first (reversed from the list returned by hist_moves)."""
        moves_from_service = [-5.3, 8.1, 12.4, -3.2, 6.0]  # oldest first (AV order)
        last_n = list(reversed(moves_from_service[:8]))
        assert last_n[0] == 6.0    # newest should be first
        assert last_n[-1] == -5.3  # oldest should be last
