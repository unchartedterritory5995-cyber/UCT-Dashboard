"""Tests for chart markers — earnings + splits + dividends.

Mocks the upstreams (FMP/Finnhub for earnings, yfinance corporate actions for
splits/dividends). Verifies:
- Combined dict structure
- Per-section try/except resilience (one failure doesn't kill the others)
- Cache hit path (second call skips upstream)
- `days` query param filtering on the API route
"""
from datetime import date, timedelta
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from api.services import earnings_estimates
from api.services.cache import cache


@pytest.fixture(autouse=True)
def _stub_yf_actions():
    """Splits/dividends now come from yfinance's `_yf_corporate_actions`. Stub it
    to empty by default so tests never hit the real network; cases that assert
    split/dividend data override this with their own patch."""
    with patch.object(earnings_estimates, "_yf_corporate_actions", return_value=([], [])):
        yield


def _fresh_cache(ticker: str = "TEST"):
    cache.invalidate(f"chart_markers_{ticker}")
    # Deep-history markers are ALSO persisted to disk (survives redeploys) — clear
    # that too so each test builds fresh from its mocked provider instead of a
    # prior test's leftover disk copy.
    import os as _os
    try:
        _os.remove(earnings_estimates._markers_disk_path(ticker))
    except OSError:
        pass


def _today():
    return date.today()


# ─── Service-level tests ──────────────────────────────────────────────────────

class TestGetChartMarkersSuccess:
    def setup_method(self):
        _fresh_cache("AAPL")

    def test_combines_all_three_sections(self):
        today = _today()
        eps_payload = [
            {"period": (today - timedelta(days=10)).isoformat(),
             "actual": 1.5, "estimate": 1.4, "surprisePercent": 7.1},
            {"period": (today - timedelta(days=100)).isoformat(),
             "actual": 1.2, "estimate": 1.3, "surprisePercent": -7.7},
        ]
        # yfinance actions: splits = (date, ratio float); dividends = (date, amount).
        yf_splits = [((today - timedelta(days=400)).isoformat(), 4.0)]
        yf_divs = [
            ((today - timedelta(days=30)).isoformat(), 0.85),
            ((today - timedelta(days=120)).isoformat(), 0.82),
        ]

        def fake_fh_get(path, params):
            if path == "/stock/earnings":
                return eps_payload
            return None

        with patch.object(earnings_estimates, "_fh_get", side_effect=fake_fh_get), \
             patch.object(earnings_estimates, "_yf_corporate_actions", return_value=(yf_splits, yf_divs)):
            result = earnings_estimates.get_chart_markers("AAPL")

        assert set(result.keys()) == {"earnings", "splits", "dividends"}
        assert len(result["earnings"]) == 2
        assert len(result["splits"]) == 1
        assert len(result["dividends"]) == 2

        e0 = result["earnings"][0]
        assert e0["beat"] is True
        assert e0["eps_actual"] == 1.5
        assert e0["eps_estimate"] == 1.4
        assert e0["surprise"] == 7.1

        s0 = result["splits"][0]
        assert s0["ratio"] == "4:1"          # 4-for-1 (yfinance ratio 4.0)
        assert s0["from_factor"] == 1
        assert s0["to_factor"] == 4.0

        d0 = result["dividends"][0]
        assert d0["amount"] == 0.85
        assert "date" in d0


class TestGetChartMarkersRevenue:
    """FMP stable/earnings is primary: each marker carries EPS + revenue so the
    click-popup can show both. Finnhub is the EPS-only fallback."""
    def setup_method(self):
        _fresh_cache("MU")

    def test_fmp_primary_attaches_revenue_and_dedups_by_date(self):
        today = _today()
        d_recent = (today - timedelta(days=20)).isoformat()
        fmp_rows = [
            {"date": d_recent, "epsActual": 12.20, "epsEstimated": 9.186,
             "revenueActual": 23_860_000_000, "revenueEstimated": 19_970_000_000},
            # duplicate report date, no estimate → the estimate-bearing row wins
            {"date": d_recent, "epsActual": 12.20, "epsEstimated": None,
             "revenueActual": 23_860_000_000, "revenueEstimated": None},
            # an upcoming quarter (nothing reported) → skipped
            {"date": (today + timedelta(days=40)).isoformat(),
             "epsActual": None, "epsEstimated": 1.0, "revenueActual": None, "revenueEstimated": None},
        ]

        def fake_fmp_get(path, params, timeout=10):
            return fmp_rows if path == "/stable/earnings" else None

        with patch.object(earnings_estimates, "_fmp_get", side_effect=fake_fmp_get), \
             patch.object(earnings_estimates, "_fh_get", return_value=None):
            result = earnings_estimates.get_chart_markers("MU")

        assert len(result["earnings"]) == 1              # deduped, upcoming dropped
        e = result["earnings"][0]
        assert e["beat"] is True
        assert e["eps_actual"] == 12.20 and e["eps_estimate"] == 9.186
        assert e["eps_surprise_pct"] == 32.8             # (12.20-9.186)/9.186*100
        assert e["revenue_actual"] == 23_860_000_000
        assert e["revenue_estimate"] == 19_970_000_000
        assert e["revenue_surprise_pct"] == 19.5         # (23.86-19.97)/19.97*100

    def test_finnhub_fallback_when_fmp_empty_has_null_revenue(self):
        today = _today()
        eps_payload = [{"period": (today - timedelta(days=10)).isoformat(),
                        "actual": 2.0, "estimate": 1.8, "surprisePercent": 11.1}]

        def fake_fh_get(path, params):
            return eps_payload if path == "/stock/earnings" else None

        with patch.object(earnings_estimates, "_fmp_get", return_value=None), \
             patch.object(earnings_estimates, "_fh_get", side_effect=fake_fh_get):
            result = earnings_estimates.get_chart_markers("MU")

        assert len(result["earnings"]) == 1
        e = result["earnings"][0]
        assert e["eps_actual"] == 2.0
        assert e["revenue_actual"] is None               # Finnhub has no revenue
        assert e["revenue_surprise_pct"] is None


class TestGetChartMarkersQuarter:
    """Fiscal quarter/year is joined from FMP earning-call-transcript-dates by
    report date — the accurate source. A calendar mapping is WRONG for off-cycle
    fiscal years (MU's Aug year-end makes its Sep print fiscal Q4, not Q2)."""
    def setup_method(self):
        _fresh_cache("MU")

    def test_quarter_joined_exact_and_nearest(self):
        today = _today()
        d1 = (today - timedelta(days=20)).isoformat()
        d2 = (today - timedelta(days=110)).isoformat()
        d2_call = (today - timedelta(days=108)).isoformat()  # call date 2d off report
        fmp_earnings = [
            {"date": d1, "epsActual": 1.18, "epsEstimated": 1.12,
             "revenueActual": 7.75e9, "revenueEstimated": 7.65e9},
            {"date": d2, "epsActual": 0.62, "epsEstimated": 0.48,
             "revenueActual": 6.8e9, "revenueEstimated": 6.6e9},
        ]
        transcript_dates = [
            # off-cycle: a Sep-ish print is fiscal Q4 (datetime string → sliced)
            {"quarter": 4, "fiscalYear": 2024, "date": d1 + " 16:30:00"},
            # 2 days off the report date → nearest-within-5-days still matches
            {"quarter": 3, "fiscalYear": 2024, "date": d2_call},
        ]

        def fake_fmp_get(path, params, timeout=10):
            if path == "/stable/earnings":
                return fmp_earnings
            if path == "/stable/earning-call-transcript-dates":
                return transcript_dates
            return None

        with patch.object(earnings_estimates, "_fmp_get", side_effect=fake_fmp_get), \
             patch.object(earnings_estimates, "_fh_get", return_value=None):
            result = earnings_estimates.get_chart_markers("MU")

        by_date = {e["date"]: e for e in result["earnings"]}
        assert by_date[d1]["fiscal_quarter"] == 4 and by_date[d1]["fiscal_year"] == 2024
        assert by_date[d2]["fiscal_quarter"] == 3 and by_date[d2]["fiscal_year"] == 2024

    def test_quarter_omitted_when_no_transcript_match(self):
        today = _today()
        d1 = (today - timedelta(days=20)).isoformat()
        fmp_earnings = [{"date": d1, "epsActual": 1.0, "epsEstimated": 0.9,
                         "revenueActual": 1e9, "revenueEstimated": 1e9}]

        def fake_fmp_get(path, params, timeout=10):
            if path == "/stable/earnings":
                return fmp_earnings
            return []  # transcript-dates empty → no quarter, but marker still shows

        with patch.object(earnings_estimates, "_fmp_get", side_effect=fake_fmp_get), \
             patch.object(earnings_estimates, "_fh_get", return_value=None):
            result = earnings_estimates.get_chart_markers("MU")

        e = result["earnings"][0]
        assert "fiscal_quarter" not in e and e["eps_actual"] == 1.0


class TestGetChartMarkersResilience:
    def setup_method(self):
        _fresh_cache("FAILMIX")

    def test_one_source_failure_still_returns_other_sections(self):
        # Earnings raises; splits return data; dividends empty.
        def fake_fh_get(path, params):
            if path == "/stock/earnings":
                raise RuntimeError("Finnhub earnings 500")
            return None

        with patch.object(earnings_estimates, "_fh_get", side_effect=fake_fh_get), \
             patch.object(earnings_estimates, "_fmp_get", return_value=None), \
             patch.object(earnings_estimates, "_yf_corporate_actions",
                          return_value=([("2024-06-10", 10.0)], [])):
            result = earnings_estimates.get_chart_markers("FAILMIX")

        assert result["earnings"] == []
        assert len(result["splits"]) == 1
        assert result["splits"][0]["ratio"] == "10:1"
        assert result["dividends"] == []

    def test_all_sources_fail_returns_empty_arrays(self):
        with patch.object(earnings_estimates, "_fh_get", side_effect=RuntimeError("boom")):
            result = earnings_estimates.get_chart_markers("ALLFAIL")

        assert result == {"earnings": [], "splits": [], "dividends": []}

    def test_unparseable_dividend_amount_skipped(self):
        yf_divs = [
            ("2026-03-15", "not-a-number"),   # unparseable → skipped
            ("2026-03-15", 0.85),             # kept
            (None,         0.50),             # no date → skipped
        ]
        _fresh_cache("DIVPARSE")
        with patch.object(earnings_estimates, "_fh_get", return_value=None), \
             patch.object(earnings_estimates, "_fmp_get", return_value=None), \
             patch.object(earnings_estimates, "_yf_corporate_actions", return_value=([], yf_divs)):
            result = earnings_estimates.get_chart_markers("DIVPARSE")

        assert len(result["dividends"]) == 1
        assert result["dividends"][0]["amount"] == 0.85


class TestGetChartMarkersCache:
    def setup_method(self):
        _fresh_cache("CACHEME")

    def test_second_call_does_not_refetch(self):
        eps_payload = [{"period": "2026-04-01", "actual": 1.0, "estimate": 0.9}]

        call_count = {"n": 0}

        def fake_fh_get(path, params):
            call_count["n"] += 1
            if path == "/stock/earnings":
                return eps_payload
            return []

        with patch.object(earnings_estimates, "_fh_get", side_effect=fake_fh_get):
            r1 = earnings_estimates.get_chart_markers("CACHEME")
            calls_after_first = call_count["n"]
            r2 = earnings_estimates.get_chart_markers("CACHEME")
            calls_after_second = call_count["n"]

        assert r1 == r2
        assert calls_after_first > 0
        # No additional upstream calls on the second invocation
        assert calls_after_second == calls_after_first


class TestGetChartMarkersDiskPersistence:
    """Deep history is immutable → persisted to disk and served WITHOUT a rebuild
    even after the in-memory cache is cleared (e.g. a redeploy)."""

    def test_serves_from_disk_after_memory_cleared(self, tmp_path, monkeypatch):
        monkeypatch.setattr(earnings_estimates, "_MARKERS_DISK_DIR", str(tmp_path))
        _fresh_cache("DISKME")

        calls = {"n": 0}

        def fake_fh_get(path, params):
            calls["n"] += 1
            return [{"period": "2026-04-01", "actual": 1.0, "estimate": 0.9}] if path == "/stock/earnings" else []

        with patch.object(earnings_estimates, "_fh_get", side_effect=fake_fh_get), \
             patch.object(earnings_estimates, "_fmp_get", return_value=None):
            r1 = earnings_estimates.get_chart_markers("DISKME")
            after_build = calls["n"]
            # Clear ONLY memory (simulates a redeploy) — the disk copy must serve
            # the next call with NO provider refetch.
            cache.invalidate("chart_markers_DISKME")
            r2 = earnings_estimates.get_chart_markers("DISKME")
            after_disk = calls["n"]

        assert r1 == r2
        assert after_build > 0
        assert after_disk == after_build   # disk-served: zero extra provider calls
        assert len(r2["earnings"]) == 1


class TestGetChartMarkersCachePolicy:
    """The disk write (persisted, served effectively forever) and the memory
    cache TTL must both be gated on completeness -- mirrors the ALREADY
    correct pattern at `_schedule_markers_refresh` (:88), which the initial
    build below did not follow before this fix."""

    def setup_method(self):
        _fresh_cache("EMPTYMKT")

    def _disk_exists(self, ticker):
        import os
        return os.path.exists(earnings_estimates._markers_disk_path(ticker))

    def test_all_sources_failing_does_not_write_the_disk_copy(self):
        """THE regression: every source empty used to still call
        `_markers_disk_write` unconditionally, so a transient outage
        overwrote a good persisted copy (or, on a cold cache, planted a
        blank that would be served effectively forever on every future
        redeploy)."""
        with patch.object(earnings_estimates, "_fh_get", side_effect=RuntimeError("boom")), \
             patch.object(earnings_estimates, "_fmp_get", return_value=None):
            result = earnings_estimates.get_chart_markers("EMPTYMKT")

        assert result == {"earnings": [], "splits": [], "dividends": []}
        assert not self._disk_exists("EMPTYMKT")

    def test_all_sources_failing_gets_the_short_retry_ttl_not_12h(self):
        seen = {}
        real_set = cache.set

        def spy(key, value, ttl=None):
            if key == "chart_markers_EMPTYMKT":
                seen["ttl"] = ttl
            return real_set(key, value, ttl)

        with patch.object(earnings_estimates, "_fh_get", side_effect=RuntimeError("boom")), \
             patch.object(earnings_estimates, "_fmp_get", return_value=None), \
             patch.object(cache, "set", spy):
            earnings_estimates.get_chart_markers("EMPTYMKT")

        assert seen.get("ttl") == earnings_estimates._MARKERS_EMPTY_TTL
        assert seen.get("ttl") < earnings_estimates._MARKERS_CACHE_TTL

    def test_a_complete_build_still_writes_disk_and_gets_the_full_ttl(self):
        """Control direction: a real result must NOT be caught by the same
        guard -- it still persists and still gets the long TTL."""
        eps_payload = [{"period": "2026-04-01", "actual": 1.0, "estimate": 0.9}]
        seen = {}
        real_set = cache.set

        def spy(key, value, ttl=None):
            if key == "chart_markers_EMPTYMKT":
                seen["ttl"] = ttl
            return real_set(key, value, ttl)

        with patch.object(earnings_estimates, "_fh_get",
                          side_effect=lambda path, params: eps_payload if path == "/stock/earnings" else []), \
             patch.object(earnings_estimates, "_fmp_get", return_value=None), \
             patch.object(cache, "set", spy):
            result = earnings_estimates.get_chart_markers("EMPTYMKT")

        assert len(result["earnings"]) == 1
        assert self._disk_exists("EMPTYMKT")
        assert seen.get("ttl") == earnings_estimates._MARKERS_CACHE_TTL


# ─── Route-level tests ────────────────────────────────────────────────────────

class TestChartMarkersRoute:
    def setup_method(self):
        _fresh_cache("RT")

    def _client(self):
        # Import lazily — api.main triggers expensive startup (cache seeding,
        # scheduler, etc.). Only spin it up when a route test runs.
        from api.main import app
        return TestClient(app)

    def test_route_returns_combined_payload(self):
        today = _today()
        recent = (today - timedelta(days=30)).isoformat()
        old    = (today - timedelta(days=1000)).isoformat()  # > default 730 days

        def fake_fh_get(path, params):
            if path == "/stock/earnings":
                return [
                    {"period": recent, "actual": 1.5, "estimate": 1.4, "surprisePercent": 7.1},
                    {"period": old,    "actual": 1.0, "estimate": 1.0, "surprisePercent": 0.0},
                ]
            return None

        with patch.object(earnings_estimates, "_fh_get", side_effect=fake_fh_get), \
             patch.object(earnings_estimates, "_fmp_get", return_value=None), \
             patch.object(earnings_estimates, "_yf_corporate_actions", return_value=([], [(recent, 0.50)])):
            client = self._client()
            r = client.get("/api/chart/markers/RT")

        assert r.status_code == 200
        body = r.json()
        assert set(body.keys()) == {"earnings", "splits", "dividends"}
        # Default days=730 filters out the 1000-day-old earnings entry
        assert len(body["earnings"]) == 1
        assert body["earnings"][0]["date"] == recent
        assert len(body["dividends"]) == 1

    def test_route_alias_chart_markers_path(self):
        with patch.object(earnings_estimates, "_fh_get", return_value=[]):
            _fresh_cache("ALIAS")
            client = self._client()
            r = client.get("/api/chart-markers/ALIAS")
        assert r.status_code == 200
        assert r.json() == {"earnings": [], "splits": [], "dividends": []}

    def test_route_respects_days_param(self):
        today = _today()
        in_range  = (today - timedelta(days=10)).isoformat()
        out_range = (today - timedelta(days=400)).isoformat()

        def fake_fh_get(path, params):
            if path == "/stock/earnings":
                return [
                    {"period": in_range,  "actual": 1.5, "estimate": 1.4},
                    {"period": out_range, "actual": 1.2, "estimate": 1.1},
                ]
            return None

        _fresh_cache("DAYS")
        with patch.object(earnings_estimates, "_fh_get", side_effect=fake_fh_get):
            client = self._client()
            r = client.get("/api/chart/markers/DAYS?days=90")

        assert r.status_code == 200
        body = r.json()
        assert len(body["earnings"]) == 1
        assert body["earnings"][0]["date"] == in_range
