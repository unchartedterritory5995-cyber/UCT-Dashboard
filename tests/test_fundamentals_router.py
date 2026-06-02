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
    "10DayAverageTradingVolume": 55_000_000.0,
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
