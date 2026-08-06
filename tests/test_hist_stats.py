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

    def test_hist_stats_survives_a_null_in_moves_pct_without_losing_the_whole_object(self):
        """P2 T9 review round 2, finding #1's downstream consumer: a `None`
        in `moves_pct` (get_historical_earnings_moves' print-night gap) must
        not crash `_compute_hist_stats` and lose the ENTIRE hist_stats object
        for that symbol. `_one()` wraps the call in a broad
        `try/except Exception: pass`, so an unguarded `None > 0` doesn't 500
        the endpoint — it silently downgrades `hist_stats` to `None`, which
        is a worse outcome than a partial-but-correct object (it also throws
        away the perfectly good avg_abs_move/up_count/total/last_n for the
        quarters that DID resolve). `up_count`/`total` must skip the gap."""
        with_a_gap = {
            "avg_abs_move_pct": 15.0,
            "moves_pct": [None, 8.2, -4.1],   # newest quarter unresolved yet (print night)
            "n_quarters": 2,
        }
        r = TestHistStats()._run_enrichment(hist_moves=with_a_gap)
        assert r.status_code == 200
        stats = r.json()["AAPL"]["hist_stats"]
        assert stats is not None                 # NOT swallowed into a total null
        assert stats["last_n"] == [None, 8.2, -4.1]
        assert stats["up_count"] == 1             # only 8.2 is positive; the gap never crashes the count
        assert stats["total"] == 2


class TestHistStatsComputation:
    """Unit tests for the _compute_hist_stats logic in isolation."""

    def test_up_count_logic(self):
        """Pure computation check — no need for endpoint."""
        moves = [-5.3, 8.1, 12.4, -3.2, 6.0]
        up = sum(1 for m in moves if m > 0)
        assert up == 3


class TestLastNOrderIsNotReversed:
    """P2 T9 review (CRITICAL): `_compute_hist_stats` previously reversed
    `moves_pct` before emitting `last_n`, silently flipping an already
    newest-first list to oldest-first — the opposite of its own inline
    comment and of every downstream consumer's assumption
    (`earningsHistoryModel.js`, `cardBits.jsx`'s `ReactionSpark`,
    `_generate_earnings_analysis`'s own YoY/beat-streak indexing).

    The previous regression test (`test_last_n_reversal`, removed) was
    tautological: it reimplemented `list(reversed(...))` inline and asserted
    its own arithmetic, so it could never fail regardless of what the real
    code did. This exercises the REAL endpoint path with a fixture whose
    values are pairwise distinguishable (no palindrome, no repeats), so a
    reintroduced `reversed()` — or any other reordering — changes the
    asserted list and fails.
    """

    def test_last_n_preserves_moves_pct_order_verbatim(self):
        distinguishable = {
            "avg_abs_move_pct": 9.9,
            "moves_pct": [10.0, -20.0, 30.0, -40.0],   # newest → oldest, by construction
            "n_quarters": 4,
        }
        r = TestHistStats()._run_enrichment(hist_moves=distinguishable)
        assert r.status_code == 200
        stats = r.json()["AAPL"]["hist_stats"]
        # Exact order, exact values — a reversed(), a sort, a truncation
        # change, or an off-by-one would all fail this assertion.
        assert stats["last_n"] == [10.0, -20.0, 30.0, -40.0]

    def test_last_n_first_entry_is_the_newest_quarters_move(self):
        """Same fixture, asserting the SEMANTIC claim (not just list equality):
        index 0 is the move the field's own docstring/comment promises —
        the MOST RECENT quarter's reaction — which is what
        `earningsHistoryModel.js` zips onto its newest-first `sortedHist[0]`."""
        distinguishable = {
            "avg_abs_move_pct": 9.9,
            "moves_pct": [10.0, -20.0, 30.0, -40.0],
            "n_quarters": 4,
        }
        r = TestHistStats()._run_enrichment(hist_moves=distinguishable)
        stats = r.json()["AAPL"]["hist_stats"]
        assert stats["last_n"][0] == 10.0
        assert stats["last_n"][0] != stats["last_n"][-1]   # guards a would-be palindrome fixture


class TestFetchQuarterlyHistoryOrderGuarantee:
    """P2 T9 review (CRITICAL, root-cause layer): `_fetch_quarterly_history`
    must GUARANTEE newest-first regardless of what order the upstream
    provider hands back — it is the single shared source every consumer
    (this module's own YoY/beat-streak indexing in
    `_generate_earnings_analysis`, `setup_grade.py`'s realized-move average,
    and `get_historical_earnings_moves` -> `calendar.py`'s `hist_stats.last_n`)
    trusts to have index 0 = "most recent quarter". Before this fix that was
    an ASSUMPTION (true for FMP today, unverified for the AV fallback) —
    these tests prove it's now true even when the provider hands back a
    shuffled/non-monotonic order, by mocking the HTTP layer directly rather
    than mocking `_fetch_quarterly_history` itself (every other test in this
    repo mocks the function as a black box, which cannot exercise this sort)."""

    def test_fmp_response_is_sorted_newest_first_even_when_provider_order_is_shuffled(self, monkeypatch):
        from api.services import engine
        monkeypatch.setenv("FMP_API_KEY", "test-key")
        # Deliberately NON-monotonic — the same failure shape already proven
        # live for a real provider on this branch (Finnhub /stock/earnings,
        # per earningsHistoryModel.js DECISION 1's non-monotonic-period find).
        # A naive pass-through would return this exact (wrong) order.
        shuffled = [
            {"date": "2026-01-29", "epsActual": 1.0, "epsEstimated": 0.9},
            {"date": "2026-07-30", "epsActual": 4.0, "epsEstimated": 3.9},
            {"date": "2025-10-30", "epsActual": 0.5, "epsEstimated": 0.4},
            {"date": "2026-04-30", "epsActual": 2.0, "epsEstimated": 1.9},
        ]

        class _FakeResp:
            def json(self):
                return shuffled

        monkeypatch.setattr("requests.get", lambda *a, **k: _FakeResp())

        out = engine._fetch_quarterly_history("AAPL")
        dates = [row["reportedDate"] for row in out]
        assert dates == ["2026-07-30", "2026-04-30", "2026-01-29", "2025-10-30"]

    def test_av_fallback_response_is_also_sorted_newest_first(self, monkeypatch):
        from api.services import engine
        monkeypatch.delenv("FMP_API_KEY", raising=False)
        monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "test-key")
        shuffled_av = {
            "quarterlyEarnings": [
                {"fiscalDateEnding": "2025-09-30", "reportedDate": "2025-10-28",
                 "reportedEPS": "1", "estimatedEPS": "1"},
                {"fiscalDateEnding": "2026-06-30", "reportedDate": "2026-07-29",
                 "reportedEPS": "2", "estimatedEPS": "2"},
                {"fiscalDateEnding": "2025-12-31", "reportedDate": "2026-01-27",
                 "reportedEPS": "3", "estimatedEPS": "3"},
            ]
        }
        monkeypatch.setattr("api.services.engine._av_get", lambda *a, **k: shuffled_av)
        out = engine._fetch_quarterly_history("AAPL")
        dates = [row["reportedDate"] for row in out]
        assert dates == ["2026-07-29", "2026-01-27", "2025-10-28"]

    def test_an_unparseable_date_sorts_last_not_first(self, monkeypatch):
        """A row with no date must never masquerade as 'most recent' — it
        should sort to the END, not silently corrupt index-0. Exercised via
        the AV-fallback branch, which (unlike FMP's) does not pre-filter
        blank dates before handing rows to the sort — the only path that
        actually reaches `_newest_first` with a blank-date row."""
        from api.services import engine
        monkeypatch.delenv("FMP_API_KEY", raising=False)
        monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "test-key")
        mixed_av = {
            "quarterlyEarnings": [
                {"fiscalDateEnding": "", "reportedDate": "",
                 "reportedEPS": "9", "estimatedEPS": "9"},
                {"fiscalDateEnding": "2026-04-30", "reportedDate": "2026-04-30",
                 "reportedEPS": "2", "estimatedEPS": "1.9"},
            ]
        }
        monkeypatch.setattr("api.services.engine._av_get", lambda *a, **k: mixed_av)
        out = engine._fetch_quarterly_history("AAPL")
        dates = [row.get("reportedDate") for row in out]
        assert dates == ["2026-04-30", ""]   # the dated row wins index 0, not the blank one


class TestFetchQuarterlyHistoryCapAfterSort:
    """P2 T9 review round 2, IMPORTANT #2: the FMP branch capped `out` at 12
    rows DURING the per-item loop — in whatever order FMP's response happened
    to be in — BEFORE `_newest_first` sorted. The ORDER guarantee held (the
    12 rows kept came out sorted correctly), but the SET guarantee didn't:
    which 12 rows survived the cap depended on the provider's raw order.
    Reviewer-probed live: 20 oldest-first rows (2010->2029) returned
    2021-01-01 as index 0 and never reached the true newest quarter at all."""

    def test_cap_keeps_the_12_newest_quarters_even_when_provider_order_is_reversed(self, monkeypatch):
        from api.services import engine
        monkeypatch.setenv("FMP_API_KEY", "test-key")
        # 20 quarters, OLDEST-first (the reverse of FMP's real live order) --
        # the exact shape that broke the mid-loop `break`.
        years = list(range(2010, 2030))   # 20 entries
        oldest_first = [
            {"date": f"{y}-01-01", "epsActual": 1.0, "epsEstimated": 0.9}
            for y in years
        ]

        class _FakeResp:
            def json(self):
                return oldest_first

        monkeypatch.setattr("requests.get", lambda *a, **k: _FakeResp())

        out = engine._fetch_quarterly_history("AAPL")
        dates = [row["reportedDate"] for row in out]
        assert len(dates) == 12
        # The 12 MOST RECENT years, newest-first -- not an arbitrary
        # provider-order-dependent window that merely LOOKS sorted.
        assert dates[0] == "2029-01-01"
        assert dates[-1] == "2018-01-01"


class TestHistoricalMovesPositionalAlignment:
    """P2 T9 review round 2, CRITICAL (finding #1) + IMPORTANT #3 (finding
    #3): `get_historical_earnings_moves` is the middle leg of the chain —
    every other new order-guarantee test class mocks ACROSS this function
    (either mocking its return value directly, or mocking
    `_fetch_quarterly_history` upstream of it), so inserting the identical
    reversed()-class bug INSIDE it (e.g. `[round(m,1) for m in reversed(moves)]`)
    survived undetected across 70+ tests. These stub `yfinance.Ticker().history()`
    with a small real OHLC frame so the function's actual date-matching and
    gap-computation logic runs for real, not its mocked output."""

    @staticmethod
    def _make_frame(start, end, overrides):
        """Daily bars `start`..`end` inclusive, Open=Close=100.0 flat, except
        the (date, field) pairs in `overrides` -- e.g.
        {('2026-01-15', 'close'): 100.0, ('2026-01-16', 'open'): 80.0}."""
        import pandas as pd
        idx = pd.date_range(start, end, freq="D")
        opens = [100.0] * len(idx)
        closes = [100.0] * len(idx)
        pos = {d: i for i, d in enumerate(idx)}
        for (d, field), val in overrides.items():
            i = pos[pd.Timestamp(d)]
            (opens if field == "open" else closes)[i] = val
        return pd.DataFrame({"Open": opens, "Close": closes}, index=idx)

    def _patch_ticker(self, monkeypatch, df):
        class _FakeTicker:
            def __init__(self, *a, **k):
                pass

            def history(self, *a, **k):
                return df

        monkeypatch.setattr("yfinance.Ticker", _FakeTicker)

    def test_moves_pct_index_0_belongs_to_the_newest_reported_date(self, monkeypatch):
        """Finding #3: end-to-end, no mocking across get_historical_earnings_moves
        itself. Two quarters with clearly-distinguishable, opposite-sign
        reactions -- if the function reversed or misaligned anywhere, index 0
        would read the OLDER quarter's move instead."""
        from api.services.earnings_enrichment import get_historical_earnings_moves
        df = self._make_frame(
            "2026-01-01", "2026-06-20",
            overrides={
                ("2026-01-15", "close"): 100.0,
                ("2026-01-16", "open"):  80.0,    # older quarter's real move: -20%
                ("2026-06-15", "close"): 100.0,
                ("2026-06-16", "open"):  150.0,   # newest quarter's real move: +50%
            },
        )
        self._patch_ticker(monkeypatch, df)

        av_quarters = [
            {"reportedDate": "2026-06-15", "reportTime": "post-market"},  # newest, index 0
            {"reportedDate": "2026-01-15", "reportTime": "post-market"},  # older, index 1
        ]
        result = get_historical_earnings_moves("TEST", av_quarters)
        assert result is not None
        assert result["moves_pct"][0] == 50.0     # the newest quarter's OWN move
        assert result["moves_pct"][1] == -20.0
        assert result["n_quarters"] == 2

    def test_unresolvable_newest_quarter_emits_null_not_the_older_quarters_move(self, monkeypatch):
        """Finding #1 (CRITICAL): print night. The newest quarter's report
        date IS the last bar in the price frame -- no next-day close exists
        yet. Before this fix that quarter's slot was silently DROPPED and the
        older quarter's real move slid up into index 0: a confidently-WRONG
        number attached to tonight's print, on the one night this modal is
        most likely open. After the fix: index 0 is an honest `None`
        (unknown, not wrong), and the older quarter's real move stays at
        index 1 -- it is NOT shifted."""
        from api.services.earnings_enrichment import get_historical_earnings_moves
        df = self._make_frame(
            "2026-01-01", "2026-06-15",   # frame ENDS exactly on the newest report date
            overrides={
                ("2026-01-15", "close"): 100.0,
                ("2026-01-16", "open"):  80.0,    # older quarter: fully resolvable, -20%
            },
        )
        self._patch_ticker(monkeypatch, df)

        av_quarters = [
            {"reportedDate": "2026-06-15", "reportTime": "post-market"},  # newest -- print night
            {"reportedDate": "2026-01-15", "reportTime": "post-market"},  # older -- resolved
        ]
        result = get_historical_earnings_moves("TEST", av_quarters)
        assert result is not None
        assert result["moves_pct"][0] is None     # unresolvable -- stays a gap, not a guess
        assert result["moves_pct"][1] == -20.0    # NOT shifted up into index 0
        assert result["n_quarters"] == 1          # only the resolvable quarter counts
        assert result["avg_abs_move_pct"] == 20.0  # averaged over the ONE real value, not 0.5x it

    def test_a_missing_date_in_the_middle_of_the_list_does_not_shift_later_quarters(self, monkeypatch):
        """The FIRST loop's `continue` (missing/unparseable date) is the same
        encoding class -- a quarter with no date at all must still occupy its
        slot, not compact the list and shift the older quarters after it."""
        from api.services.earnings_enrichment import get_historical_earnings_moves
        df = self._make_frame(
            "2026-01-01", "2026-06-20",
            overrides={
                ("2026-01-15", "close"): 100.0,
                ("2026-01-16", "open"):  80.0,   # oldest quarter: -20%
                ("2026-06-15", "close"): 100.0,
                ("2026-06-16", "open"):  150.0,  # newest quarter: +50%
            },
        )
        self._patch_ticker(monkeypatch, df)

        av_quarters = [
            {"reportedDate": "2026-06-15", "reportTime": "post-market"},  # newest, index 0
            {"reportedDate": None, "reportTime": "post-market"},         # no date at all, index 1
            {"reportedDate": "2026-01-15", "reportTime": "post-market"},  # oldest, index 2
        ]
        result = get_historical_earnings_moves("TEST", av_quarters)
        assert result is not None
        assert result["moves_pct"][0] == 50.0
        assert result["moves_pct"][1] is None      # the dateless quarter's own gap
        assert result["moves_pct"][2] == -20.0     # NOT shifted up into index 1
