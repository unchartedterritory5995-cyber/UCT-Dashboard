"""Tests for api/services/ipo_calendar.py + GET /api/calendar/ipos endpoint."""
from unittest import mock

import pytest
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)

# ── Sample Finnhub ipoCalendar rows (verified shape on our tier) ───────────────

_RAW_ROWS = [
    {
        "symbol": "ACME",
        "name": "Acme Corp",
        "date": "2026-06-10",
        "exchange": "NASDAQ",
        "price": "$18.00-$20.00",
        "numberOfShares": 5000000,
        "totalSharesValue": 95000000,
        "status": "expected",
    },
    {
        "symbol": "BIGCO",
        "name": "BigCo Inc",
        "date": "2026-06-15",
        "exchange": "NYSE",
        "price": "$25.00",
        "numberOfShares": "10000000",  # sometimes a string
        "totalSharesValue": 250000000,
        "status": "priced",
    },
    # Row with no symbol — should be dropped
    {
        "symbol": "",
        "name": "",
        "date": "2026-06-12",
        "exchange": "NASDAQ",
        "price": "$10.00",
        "numberOfShares": 1000000,
        "totalSharesValue": 10000000,
        "status": "expected",
    },
    # Row with no date — should be dropped
    {
        "symbol": "NODDATE",
        "name": "No Date Corp",
        "date": "",
        "exchange": "NYSE",
        "price": "$5.00",
        "numberOfShares": 500000,
        "totalSharesValue": 2500000,
        "status": "expected",
    },
]

_FH_RESPONSE = {"ipoCalendar": _RAW_ROWS}


# ── Service-level tests ────────────────────────────────────────────────────────

class TestGetIposService:
    def test_returns_normalized_list(self):
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get",
                        return_value=_RAW_ROWS):
            result = get_ipos("2026-06-01", "2026-06-30")
        assert isinstance(result, list)
        # Only valid rows survive (ACME + BIGCO; blank-sym and no-date dropped)
        syms = [r["sym"] for r in result]
        assert "ACME" in syms
        assert "BIGCO" in syms
        assert "" not in syms
        assert "NODDATE" not in syms

    def test_normalized_fields_present(self):
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get",
                        return_value=_RAW_ROWS):
            result = get_ipos("2026-06-01", "2026-06-30")
        acme = next(r for r in result if r["sym"] == "ACME")
        assert acme["name"] == "Acme Corp"
        assert acme["date"] == "2026-06-10"
        assert acme["exchange"] == "NASDAQ"
        assert acme["price_range"] == "$18.00-$20.00"
        assert acme["shares"] == 5_000_000
        assert acme["value"] == 95_000_000.0
        assert acme["status"] == "expected"

    def test_shares_as_string_parsed(self):
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get",
                        return_value=_RAW_ROWS):
            result = get_ipos("2026-06-01", "2026-06-30")
        bigco = next(r for r in result if r["sym"] == "BIGCO")
        assert bigco["shares"] == 10_000_000

    def test_cached_result_returned_without_http(self):
        from api.services.ipo_calendar import get_ipos
        cached = [{"sym": "CACHED", "name": "Cached Corp", "date": "2026-06-01",
                   "exchange": "NYSE", "price_range": "$10.00",
                   "shares": 1000000, "value": 10000000.0, "status": "priced"}]
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=cached), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get") as mock_http:
            result = get_ipos("2026-06-01", "2026-06-30")
        mock_http.assert_not_called()
        assert result == cached

    def test_empty_safe_on_fh_failure(self):
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get", return_value=None):
            result = get_ipos("2026-06-01", "2026-06-30")
        assert result == []

    def test_empty_safe_on_empty_list(self):
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get", return_value=[]):
            result = get_ipos("2026-06-01", "2026-06-30")
        assert result == []

    def test_no_api_key_returns_empty(self):
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch.dict("os.environ", {"FINNHUB_API_KEY": ""}):
            result = get_ipos("2026-06-01", "2026-06-30")
        assert result == []


# ── Endpoint tests ─────────────────────────────────────────────────────────────

class TestIposEndpoint:
    def test_endpoint_returns_200_and_list(self):
        # The router imports the service as _get_ipos at module level.
        # Mock at the router's imported name so the patch intercepts correctly.
        with mock.patch("api.routers.calendar._get_ipos",
                        return_value=[{"sym": "ACME", "name": "Acme Corp",
                                       "date": "2026-06-10", "exchange": "NASDAQ",
                                       "price_range": "$18.00-$20.00",
                                       "shares": 5000000, "value": 95000000.0,
                                       "status": "expected"}]):
            r = client.get("/api/calendar/ipos?from=2026-06-01&to=2026-06-30")
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body, list)
        assert body[0]["sym"] == "ACME"

    def test_endpoint_default_range_uses_current_week(self):
        """Calling without from/to params should not raise."""
        with mock.patch("api.routers.calendar._get_ipos", return_value=[]):
            r = client.get("/api/calendar/ipos")
        assert r.status_code == 200
        assert r.json() == []

    def test_endpoint_empty_safe(self):
        with mock.patch("api.routers.calendar._get_ipos", return_value=[]):
            r = client.get("/api/calendar/ipos?from=2026-06-01&to=2026-06-30")
        assert r.status_code == 200
        assert r.json() == []
