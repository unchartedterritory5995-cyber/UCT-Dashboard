"""Tests for chart markers — earnings + splits + dividends.

Mocks Finnhub upstream. Verifies:
- Combined dict structure
- Per-section try/except resilience (one failure doesn't kill the others)
- Cache hit path (second call skips upstream)
- `days` query param filtering on the API route
"""
from datetime import date, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient

from api.services import earnings_estimates
from api.services.cache import cache


def _fresh_cache(ticker: str = "TEST"):
    cache.invalidate(f"chart_markers_{ticker}")


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
        splits_payload = [
            {"date": (today - timedelta(days=400)).isoformat(),
             "fromFactor": 1, "toFactor": 4},
        ]
        div_payload = [
            {"date": (today - timedelta(days=30)).isoformat(), "amount": 0.85},
            {"date": (today - timedelta(days=120)).isoformat(), "amount": 0.82},
        ]

        def fake_fh_get(path, params):
            if path == "/stock/earnings":
                return eps_payload
            if path == "/stock/split":
                return splits_payload
            if path == "/stock/dividend":
                return div_payload
            return None

        with patch.object(earnings_estimates, "_fh_get", side_effect=fake_fh_get):
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
        assert s0["ratio"] == "1:4"
        assert s0["from_factor"] == 1
        assert s0["to_factor"] == 4

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


class TestGetChartMarkersResilience:
    def setup_method(self):
        _fresh_cache("FAILMIX")

    def test_one_source_failure_still_returns_other_sections(self):
        # Earnings raises; splits returns data; dividends returns None
        def fake_fh_get(path, params):
            if path == "/stock/earnings":
                raise RuntimeError("Finnhub earnings 500")
            if path == "/stock/split":
                return [{"date": "2024-06-10", "fromFactor": 1, "toFactor": 10}]
            return None

        with patch.object(earnings_estimates, "_fh_get", side_effect=fake_fh_get):
            result = earnings_estimates.get_chart_markers("FAILMIX")

        assert result["earnings"] == []
        assert len(result["splits"]) == 1
        assert result["dividends"] == []

    def test_all_sources_fail_returns_empty_arrays(self):
        with patch.object(earnings_estimates, "_fh_get", side_effect=RuntimeError("boom")):
            result = earnings_estimates.get_chart_markers("ALLFAIL")

        assert result == {"earnings": [], "splits": [], "dividends": []}

    def test_unparseable_dividend_amount_skipped(self):
        def fake_fh_get(path, params):
            if path == "/stock/dividend":
                return [
                    {"date": "2026-03-15", "amount": "not-a-number"},
                    {"date": "2026-03-15", "amount": 0.85},
                    {"date": None,         "amount": 0.50},
                ]
            return None

        _fresh_cache("DIVPARSE")
        with patch.object(earnings_estimates, "_fh_get", side_effect=fake_fh_get):
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
            if path == "/stock/dividend":
                return [{"date": recent, "amount": 0.50}]
            return None

        with patch.object(earnings_estimates, "_fh_get", side_effect=fake_fh_get):
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
