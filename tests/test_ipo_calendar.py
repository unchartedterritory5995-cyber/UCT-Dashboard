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

# ── Sample FMP stable/ipos-calendar rows (live shape verified 2026-08-05) ──────
# FMP supplies BREADTH (extra symbols Finnhub never returns) but is often
# missing numeric detail -- most rows have null shares/priceRange/marketCap.

_FMP_ROWS = [
    {  # overlaps ACME (Finnhub already covers this one with richer detail)
        "symbol": "ACME", "company": "Acme Corp", "date": "2026-06-10",
        "exchange": "NASDAQ", "actions": "Expected",
        "shares": None, "priceRange": None, "marketCap": None,
    },
    {  # FMP-only symbol -- Finnhub never returned this one (the breadth case)
        "symbol": "FMPONLY", "company": "FMP Only Corp", "date": "2026-06-20",
        "exchange": "NYSE", "actions": "Priced",
        "shares": 2000000, "priceRange": "12.00 - 14.00", "marketCap": 26000000,
    },
]


# ── Service-level tests ────────────────────────────────────────────────────────

class TestGetIposService:
    def test_returns_normalized_list(self):
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get",
                        return_value=_RAW_ROWS), \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get", return_value=None):
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
                        return_value=_RAW_ROWS), \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get", return_value=None):
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
                        return_value=_RAW_ROWS), \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get", return_value=None):
            result = get_ipos("2026-06-01", "2026-06-30")
        bigco = next(r for r in result if r["sym"] == "BIGCO")
        assert bigco["shares"] == 10_000_000

    def test_cached_result_returned_without_http(self):
        from api.services.ipo_calendar import get_ipos
        cached = [{"sym": "CACHED", "name": "Cached Corp", "date": "2026-06-01",
                   "exchange": "NYSE", "price_range": "$10.00",
                   "shares": 1000000, "value": 10000000.0, "status": "priced"}]
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=cached), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get") as mock_fh, \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get") as mock_fmp:
            result = get_ipos("2026-06-01", "2026-06-30")
        mock_fh.assert_not_called()
        mock_fmp.assert_not_called()
        assert result == cached

    def test_empty_safe_on_fh_failure(self):
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get", return_value=None), \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get", return_value=None):
            result = get_ipos("2026-06-01", "2026-06-30")
        assert result == []

    def test_empty_safe_on_empty_list(self):
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get", return_value=[]), \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get", return_value=[]):
            result = get_ipos("2026-06-01", "2026-06-30")
        assert result == []

    def test_no_api_key_returns_empty(self):
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch.dict("os.environ", {"FINNHUB_API_KEY": "", "FMP_API_KEY": ""}):
            result = get_ipos("2026-06-01", "2026-06-30")
        assert result == []


# ── FMP breadth leg + merge (Task 5, T11 of the data-dependability plan) ───────

class TestFmpBreadthMerge:
    def test_fmp_only_symbol_is_included(self):
        """A symbol FMP alone knows about (Finnhub never returned it) must
        still surface -- this is the whole point of the breadth merge."""
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get",
                        return_value=_RAW_ROWS), \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get",
                        return_value=_FMP_ROWS):
            result = get_ipos("2026-06-01", "2026-06-30")
        row = next(r for r in result if r["sym"] == "FMPONLY")
        assert row["name"] == "FMP Only Corp"
        assert row["shares"] == 2_000_000
        assert row["price_range"] == "12.00 - 14.00"
        assert row["value"] == 26_000_000
        assert row["status"] == "priced"   # actions "Priced" lowercased

    def test_overlapping_symbol_prefers_finnhub_numeric_detail(self):
        """ACME appears in BOTH sources -- Finnhub's fuller numeric detail
        (shares/price_range/value) must win over FMP's nulls for that row,
        not silently overwrite it with blanks."""
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get",
                        return_value=_RAW_ROWS), \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get",
                        return_value=_FMP_ROWS):
            result = get_ipos("2026-06-01", "2026-06-30")
        acme_rows = [r for r in result if r["sym"] == "ACME"]
        assert len(acme_rows) == 1   # merged into ONE row, not duplicated
        acme = acme_rows[0]
        assert acme["shares"] == 5_000_000        # Finnhub's, not FMP's None
        assert acme["price_range"] == "$18.00-$20.00"
        assert acme["value"] == 95_000_000.0

    def test_precedence_discriminates_when_BOTH_sides_have_a_real_value(self):
        """Stronger than the ACME case above (where FMP's competing field was
        None, so a 'prefer FMP, fall back to Finnhub' bug would coincidentally
        still resolve to Finnhub's value). Here BOTH sources carry a real,
        DIFFERENT shares count for the same (sym, date) -- only a genuine
        Finnhub-wins precedence produces the right answer."""
        from api.services.ipo_calendar import get_ipos
        fh_row = [{"symbol": "BOTH", "name": "Both Corp", "date": "2026-06-08",
                   "exchange": "NASDAQ", "price": "$20.00", "numberOfShares": 4000000,
                   "totalSharesValue": 80000000, "status": "expected"}]
        fmp_row = [{"symbol": "BOTH", "company": "Both Corp", "date": "2026-06-08",
                    "exchange": "NASDAQ", "actions": "Expected",
                    "shares": 999999, "priceRange": "1.00 - 2.00", "marketCap": 1999998}]
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get", return_value=fh_row), \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get", return_value=fmp_row):
            result = get_ipos("2026-06-01", "2026-06-30")
        row = next(r for r in result if r["sym"] == "BOTH")
        assert row["shares"] == 4_000_000          # Finnhub's, NOT FMP's 999999
        assert row["price_range"] == "$20.00"
        assert row["value"] == 80_000_000.0

    def test_fmp_fills_a_null_field_finnhub_lacks(self):
        """The inverse case: FMP has a numeric value on an overlapping
        symbol that Finnhub's row happens to lack -- FMP must fill it rather
        than leaving it None just because Finnhub 'owns' the row."""
        from api.services.ipo_calendar import get_ipos
        fh_thin = [{"symbol": "THIN", "name": "Thin Corp", "date": "2026-06-11",
                    "exchange": "NASDAQ", "price": None, "numberOfShares": None,
                    "totalSharesValue": None, "status": "expected"}]
        fmp_rich = [{"symbol": "THIN", "company": "Thin Corp", "date": "2026-06-11",
                     "exchange": "NASDAQ", "actions": "Expected",
                     "shares": 3000000, "priceRange": "9.00 - 11.00", "marketCap": 30000000}]
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get", return_value=fh_thin), \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get", return_value=fmp_rich):
            result = get_ipos("2026-06-01", "2026-06-30")
        thin = next(r for r in result if r["sym"] == "THIN")
        assert thin["shares"] == 3_000_000
        assert thin["price_range"] == "9.00 - 11.00"
        assert thin["value"] == 30_000_000

    def test_fmp_failure_still_serves_finnhub_rows(self):
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get",
                        return_value=_RAW_ROWS), \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get", return_value=None):
            result = get_ipos("2026-06-01", "2026-06-30")
        assert any(r["sym"] == "ACME" for r in result)

    def test_finnhub_failure_still_serves_fmp_rows(self):
        """The mirror case -- Finnhub down/budget-shed must not blank the
        whole calendar when FMP alone still has rows."""
        from api.services.ipo_calendar import get_ipos
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get", return_value=None), \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get",
                        return_value=_FMP_ROWS):
            result = get_ipos("2026-06-01", "2026-06-30")
        syms = [r["sym"] for r in result]
        assert "ACME" in syms
        assert "FMPONLY" in syms

    def test_fmp_shares_absent_stays_none_not_zero(self):
        """Number(null) === 0 family: an FMP row with a null shares field
        must stay None, never coerce to 0."""
        from api.services.ipo_calendar import _normalize_fmp_row
        row = _normalize_fmp_row({"symbol": "X", "company": "X Corp",
                                   "date": "2026-06-01", "exchange": "NYSE",
                                   "actions": "Expected", "shares": None,
                                   "priceRange": None, "marketCap": None})
        assert row["shares"] is None
        assert row["shares"] != 0
        assert row["value"] is None
        assert row["price_range"] is None

    def test_fmp_status_case_normalized(self):
        from api.services.ipo_calendar import _normalize_fmp_row
        row = _normalize_fmp_row({"symbol": "X", "company": "X Corp",
                                   "date": "2026-06-01", "exchange": "NYSE",
                                   "actions": "Priced"})
        assert row["status"] == "priced"

    def test_same_symbol_different_dates_not_collapsed(self):
        """A company appearing twice under two different dates within one
        window (e.g. a postponed IPO) must survive as two rows -- merge is
        keyed on (sym, date), never sym alone."""
        from api.services.ipo_calendar import get_ipos
        fh_two = [
            {"symbol": "DUP", "name": "Dup Corp", "date": "2026-06-05",
             "exchange": "NASDAQ", "price": "$10.00", "numberOfShares": 1000000,
             "totalSharesValue": 10000000, "status": "expected"},
            {"symbol": "DUP", "name": "Dup Corp", "date": "2026-06-19",
             "exchange": "NASDAQ", "price": "$11.00", "numberOfShares": 1000000,
             "totalSharesValue": 11000000, "status": "expected"},
        ]
        with mock.patch("api.services.ipo_calendar.cache.get", return_value=None), \
             mock.patch("api.services.ipo_calendar.cache.set"), \
             mock.patch("api.services.ipo_calendar._fh_ipo_get", return_value=fh_two), \
             mock.patch("api.services.ipo_calendar._fmp_ipo_get", return_value=None):
            result = get_ipos("2026-06-01", "2026-06-30")
        dup_rows = [r for r in result if r["sym"] == "DUP"]
        assert len(dup_rows) == 2
        assert {r["date"] for r in dup_rows} == {"2026-06-05", "2026-06-19"}


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
