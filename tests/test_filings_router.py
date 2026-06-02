"""Tests for GET /api/filings/{ticker}."""
from __future__ import annotations

from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    from fastapi import FastAPI
    from api.routers.filings import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


_SAMPLE_RESULT = {
    "ticker": "AAPL",
    "company": "Apple Inc.",
    "cik": "0000320193",
    "form_filter": "ANY",
    "count": 3,
    "filings": [
        {
            "form": "10-Q",
            "filed": "2026-05-01",
            "period": "2026-03-31",
            "accession": "0000320193-26-000078",
            "url": "https://www.sec.gov/Archives/edgar/data/320193/.../filing.htm",
        },
        {
            "form": "8-K",
            "filed": "2026-04-15",
            "period": "",
            "accession": "0000320193-26-000055",
            "url": "https://www.sec.gov/Archives/edgar/data/320193/.../8k.htm",
        },
        {
            "form": "10-K",
            "filed": "2025-11-01",
            "period": "2025-09-30",
            "accession": "0000320193-25-000123",
            "url": "https://www.sec.gov/Archives/edgar/data/320193/.../10k.htm",
        },
    ],
}


class TestFilingsEndpoint:
    def test_returns_expected_shape(self, client):
        with patch("api.routers.filings.recent_filings", return_value=dict(_SAMPLE_RESULT)):
            r = client.get("/api/filings/AAPL")
        assert r.status_code == 200
        data = r.json()
        assert data["ticker"] == "AAPL"
        assert data["count"] == 3
        assert isinstance(data["filings"], list)
        assert len(data["filings"]) == 3

    def test_filings_have_required_keys(self, client):
        with patch("api.routers.filings.recent_filings", return_value=dict(_SAMPLE_RESULT)):
            r = client.get("/api/filings/AAPL")
        f = r.json()["filings"][0]
        assert "form" in f
        assert "filed" in f
        assert "url" in f

    def test_count_param_passed_through(self, client):
        with patch("api.routers.filings.recent_filings", return_value={
            "ticker": "MSFT", "filings": [], "count": 0
        }) as mock_rf:
            r = client.get("/api/filings/MSFT?count=5")
        assert r.status_code == 200
        mock_rf.assert_called_once_with("MSFT", count=5)

    def test_empty_safe_on_error(self, client):
        """recent_filings raises → endpoint returns safe empty shape."""
        with patch("api.routers.filings.recent_filings", side_effect=RuntimeError("network error")):
            r = client.get("/api/filings/ERR")
        assert r.status_code == 200
        data = r.json()
        assert data["ticker"] == "ERR"
        assert data["filings"] == []

    def test_error_dict_passthrough(self, client):
        """If recent_filings returns an error dict it still passes through."""
        err = {"error": "ticker 'XXX' not found in SEC CIK map"}
        with patch("api.routers.filings.recent_filings", return_value=err):
            r = client.get("/api/filings/XXX")
        assert r.status_code == 200

    def test_count_default_is_10(self, client):
        with patch("api.routers.filings.recent_filings", return_value={
            "ticker": "TSLA", "filings": []
        }) as mock_rf:
            client.get("/api/filings/TSLA")
        mock_rf.assert_called_once_with("TSLA", count=10)

    def test_count_capped_at_50(self, client):
        """count > 50 should be rejected by FastAPI Query validation."""
        with patch("api.routers.filings.recent_filings", return_value={"ticker": "X", "filings": []}):
            r = client.get("/api/filings/X?count=999")
        assert r.status_code == 422  # FastAPI validation error

    def test_ticker_normalised_uppercase(self, client):
        with patch("api.routers.filings.recent_filings", return_value={
            "ticker": "NVDA", "filings": []
        }) as mock_rf:
            client.get("/api/filings/nvda")
        mock_rf.assert_called_once_with("NVDA", count=10)
