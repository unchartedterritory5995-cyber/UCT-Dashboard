"""Tests for GET /api/fundamentals/{ticker}."""
from __future__ import annotations

from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    from fastapi import FastAPI
    from api.routers.fundamentals import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


# ── Helpers ────────────────────────────────────────────────────────────────────

_SAMPLE_FUND = {
    "ticker": "AAPL",
    "name": "Apple Inc.",
    "market_cap": "$3.00T",
    "pe_forward": 28.5,
    "beta": 1.24,
    "fifty_two_week_high": 199.62,
    "fifty_two_week_low": 124.17,
    "dividend_yield_pct": 0.5,
}

_SAMPLE_FH = {
    # ⚠️ Finnhub returns volume metrics in MILLIONS of shares. This fixture used
    # to say 55_000_000.0 — i.e. it encoded the same wrong provider contract the
    # router did, which is exactly why "0K avg volume" shipped: the test agreed
    # with the bug. Verified live 2026-08-04 against /stock/metric: AMD 29.65728,
    # AAPL 60.83381, F 64.44564 — those names' real ~30M/~61M/~64M daily volumes.
    # 55.0 here means 55 million shares.
    "10DayAverageTradingVolume": 55.0,
    "52WeekHigh": 199.62,
    "52WeekLow": 124.17,
}


def _patch_services(fund=None, fh=None):
    """Return context managers that patch both underlying data sources."""
    fund = fund if fund is not None else dict(_SAMPLE_FUND)
    fh_data = fh if fh is not None else dict(_SAMPLE_FH)

    p1 = patch("api.routers.fundamentals.get_fundamentals", return_value=fund)
    p2 = patch("api.routers.fundamentals._fh_metric_get", return_value=fh_data)
    p3 = patch("api.routers.fundamentals.cache.get", return_value=None)
    p4 = patch("api.routers.fundamentals.cache.set")
    return p1, p2, p3, p4


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestFundamentalsEndpoint:
    def test_returns_expected_shape(self, client):
        p1, p2, p3, p4 = _patch_services()
        with p1, p2, p3, p4:
            r = client.get("/api/fundamentals/AAPL")
        assert r.status_code == 200
        data = r.json()
        assert data["ticker"] == "AAPL"
        assert data["market_cap"] == "$3.00T"
        assert data["forward_pe"] == 28.5
        assert data["beta"] == 1.24
        assert data["week52_high"] == 199.62
        assert data["week52_low"] == 124.17
        # The endpoint's documented contract is SHARES, so Finnhub's 55.0
        # (millions) must surface as 55,000,000. Without the normalization the
        # research modal's compactVol renders "0K" for every ticker.
        assert data["avg_vol"] == 55_000_000.0
        assert data["div_yield"] == 0.5

    def test_null_safe_missing_fields(self, client):
        """All fields nullable — should not error when yfinance returns partial data."""
        sparse = {"ticker": "XYZ"}
        p1, p2, p3, p4 = _patch_services(fund=sparse, fh={})
        with p1, p2, p3, p4:
            r = client.get("/api/fundamentals/XYZ")
        assert r.status_code == 200
        data = r.json()
        assert data["ticker"] == "XYZ"
        assert data["forward_pe"] is None
        assert data["beta"] is None
        assert data["avg_vol"] is None

    def test_fundamentals_error_returns_nulls(self, client):
        """If get_fundamentals returns an error dict, endpoint still returns valid shape."""
        p1, p2, p3, p4 = _patch_services(fund={"error": "yfinance failed", "ticker": "BAD"})
        with p1, p2, p3, p4:
            r = client.get("/api/fundamentals/BAD")
        assert r.status_code == 200
        data = r.json()
        # All fields should be None, not raise
        assert data["forward_pe"] is None
        assert data["market_cap"] is None

    def test_exception_does_not_raise(self, client):
        """If get_fundamentals raises, endpoint returns empty-safe dict."""
        p1 = patch("api.routers.fundamentals.get_fundamentals", side_effect=RuntimeError("timeout"))
        p2, p3, p4 = (
            patch("api.routers.fundamentals._fh_metric_get", return_value={}),
            patch("api.routers.fundamentals.cache.get", return_value=None),
            patch("api.routers.fundamentals.cache.set"),
        )
        with p1, p2, p3, p4:
            r = client.get("/api/fundamentals/ERR")
        assert r.status_code == 200

    def test_cache_hit_returns_immediately(self, client):
        """Cache hit bypasses both data sources."""
        cached_val = {
            "ticker": "CACHED",
            "market_cap": "$1.00B",
            "forward_pe": 15.0,
            "beta": 0.9,
            "week52_high": 55.0,
            "week52_low": 30.0,
            "avg_vol": 1_000_000.0,
            "div_yield": 2.0,
        }
        with patch("api.routers.fundamentals.cache.get", return_value=cached_val) as mock_get, \
             patch("api.routers.fundamentals.get_fundamentals") as mock_fund:
            r = client.get("/api/fundamentals/CACHED")
        assert r.status_code == 200
        assert r.json()["ticker"] == "CACHED"
        mock_fund.assert_not_called()

    def test_finnhub_fallback_to_yfinance_52w(self, client):
        """When Finnhub has no 52-week data, falls back to yfinance values."""
        fund = dict(_SAMPLE_FUND)
        fund["fifty_two_week_high"] = 200.0
        fund["fifty_two_week_low"] = 125.0
        p1, p2, p3, p4 = _patch_services(fund=fund, fh={})  # empty fh
        with p1, p2, p3, p4:
            r = client.get("/api/fundamentals/AAPL")
        data = r.json()
        assert data["week52_high"] == 200.0
        assert data["week52_low"] == 125.0

    def test_empty_ticker_returns_empty(self, client):
        """Empty or whitespace-only ticker returns empty dict safely."""
        with patch("api.routers.fundamentals.cache.get", return_value=None):
            r = client.get("/api/fundamentals/%20")
        assert r.status_code == 200
        assert r.json() == {}

    def test_market_cap_falls_back_to_finnhub_when_yfinance_omits_it(self, client):
        """Real gap observed live 2026-08-05: yfinance's `.info` sometimes lacks
        `marketCap` entirely for a mega-cap (confirmed for AMD and JPM against
        the live provider) while Finnhub's /stock/metric — ALREADY fetched by
        this same function for avg_vol/52-week range — carries
        `marketCapitalization` (in millions) for the same ticker. The endpoint
        must fall back to it instead of surfacing a blank market_cap for a
        stock that unambiguously has one."""
        fund = dict(_SAMPLE_FUND)
        del fund["market_cap"]  # yfinance omitted the field entirely
        fh = dict(_SAMPLE_FH)
        fh["marketCapitalization"] = 860_125.5  # millions -> $860.13B
        p1, p2, p3, p4 = _patch_services(fund=fund, fh=fh)
        with p1, p2, p3, p4:
            r = client.get("/api/fundamentals/AMD")
        data = r.json()
        assert data["market_cap"] == "$860.13B"

    def test_market_cap_prefers_yfinance_when_present(self, client):
        """yfinance stays primary — Finnhub is a fallback only, never overrides
        a value yfinance already resolved."""
        fund = dict(_SAMPLE_FUND)  # market_cap = "$3.00T"
        fh = dict(_SAMPLE_FH)
        fh["marketCapitalization"] = 1.0  # would format very differently
        p1, p2, p3, p4 = _patch_services(fund=fund, fh=fh)
        with p1, p2, p3, p4:
            r = client.get("/api/fundamentals/AAPL")
        data = r.json()
        assert data["market_cap"] == "$3.00T"

    def test_market_cap_stays_null_when_both_sources_lack_it(self, client):
        """No fabricated fallback when neither source has a market cap — stays
        an honest null rather than inventing a number."""
        fund = dict(_SAMPLE_FUND)
        del fund["market_cap"]
        p1, p2, p3, p4 = _patch_services(fund=fund, fh={})  # no marketCapitalization key
        with p1, p2, p3, p4:
            r = client.get("/api/fundamentals/AMD")
        data = r.json()
        assert data["market_cap"] is None
