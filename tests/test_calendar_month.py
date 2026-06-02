"""Tests for GET /api/calendar/month?year=&month= — full-month earnings range."""
from unittest import mock
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)

# Realistic Finnhub earningsCalendar response rows
_FH_ROWS = [
    # BMO ticker in cap_universe
    {"symbol": "AAPL", "date": "2026-06-02", "hour": "bmo",
     "epsEstimate": 1.50, "epsActual": None, "revenueEstimate": 90000000000, "revenueActual": None},
    # AMC ticker in cap_universe
    {"symbol": "NVDA", "date": "2026-06-10", "hour": "amc",
     "epsEstimate": 0.68, "epsActual": 0.72, "revenueEstimate": 24000000000, "revenueActual": 25000000000},
    # ticker NOT in cap_universe → should be filtered out
    {"symbol": "TINY", "date": "2026-06-05", "hour": "bmo",
     "epsEstimate": 0.10, "epsActual": None, "revenueEstimate": None, "revenueActual": None},
    # bmo via dmh (during market hours → treat as amc per spec)
    {"symbol": "MSFT", "date": "2026-06-15", "hour": "dmh",
     "epsEstimate": 3.10, "epsActual": None, "revenueEstimate": 64000000000, "revenueActual": None},
]

_FH_RESPONSE = {"earningsCalendar": _FH_ROWS}
_CAP_UNIVERSE = {"AAPL", "NVDA", "MSFT", "GOOGL"}


def _make_cache(month_key: str):
    """Return a cache.get side_effect that is cold for the month key."""
    def _get(key):
        return None  # always cold — compute path runs
    return _get


def test_month_returns_correct_structure():
    with mock.patch("api.routers.calendar.cache.get", side_effect=_make_cache("calendar_month_2026_6")), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch("api.routers.calendar._load_cap_universe", return_value=_CAP_UNIVERSE), \
         mock.patch("api.routers.calendar._fh_get_month",
                    return_value=_FH_RESPONSE):
        r = client.get("/api/calendar/month?year=2026&month=6")
    assert r.status_code == 200
    body = r.json()
    assert body["month"] == "2026-06"
    assert "days" in body


def test_month_filters_to_cap_universe():
    with mock.patch("api.routers.calendar.cache.get", side_effect=_make_cache("calendar_month_2026_6")), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch("api.routers.calendar._load_cap_universe", return_value=_CAP_UNIVERSE), \
         mock.patch("api.routers.calendar._fh_get_month",
                    return_value=_FH_RESPONSE):
        r = client.get("/api/calendar/month?year=2026&month=6")
    body = r.json()
    days = body["days"]
    # TINY should be absent everywhere
    all_syms = [e["sym"] for d in days.values() for bucket in ("bmo", "amc") for e in d.get(bucket, [])]
    assert "TINY" not in all_syms


def test_month_bmo_amc_bucketing():
    with mock.patch("api.routers.calendar.cache.get", side_effect=_make_cache("calendar_month_2026_6")), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch("api.routers.calendar._load_cap_universe", return_value=_CAP_UNIVERSE), \
         mock.patch("api.routers.calendar._fh_get_month",
                    return_value=_FH_RESPONSE):
        r = client.get("/api/calendar/month?year=2026&month=6")
    body = r.json()
    days = body["days"]
    # AAPL on Jun 2 bmo
    assert any(e["sym"] == "AAPL" for e in days.get("2026-06-02", {}).get("bmo", []))
    # NVDA on Jun 10 amc
    assert any(e["sym"] == "NVDA" for e in days.get("2026-06-10", {}).get("amc", []))
    # MSFT dmh → amc
    assert any(e["sym"] == "MSFT" for e in days.get("2026-06-15", {}).get("amc", []))


def test_month_entry_fields():
    with mock.patch("api.routers.calendar.cache.get", side_effect=_make_cache("calendar_month_2026_6")), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch("api.routers.calendar._load_cap_universe", return_value=_CAP_UNIVERSE), \
         mock.patch("api.routers.calendar._fh_get_month",
                    return_value=_FH_RESPONSE):
        r = client.get("/api/calendar/month?year=2026&month=6")
    body = r.json()
    aapl = next(e for e in body["days"]["2026-06-02"]["bmo"] if e["sym"] == "AAPL")
    assert aapl["timing"] == "bmo"
    assert aapl["eps_est"] == 1.50
    assert aapl["eps_act"] is None
    # rev_est converts from raw dollars to millions
    assert aapl["rev_est"] == pytest.approx(90000.0, rel=1e-3)


def test_month_cache_hit_returns_cached():
    cached_val = {"month": "2026-06", "days": {"2026-06-01": {"bmo": [], "amc": []}}}
    with mock.patch("api.routers.calendar.cache.get", return_value=cached_val) as mock_get:
        r = client.get("/api/calendar/month?year=2026&month=6")
    assert r.status_code == 200
    assert r.json()["month"] == "2026-06"


def test_month_empty_safe_on_fh_failure():
    with mock.patch("api.routers.calendar.cache.get", return_value=None), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch("api.routers.calendar._load_cap_universe", return_value=_CAP_UNIVERSE), \
         mock.patch("api.routers.calendar._fh_get_month", return_value=None):
        r = client.get("/api/calendar/month?year=2026&month=6")
    assert r.status_code == 200
    body = r.json()
    assert body["days"] == {}


import pytest  # noqa: E402 — placed after test fns to keep pep8 style consistent with existing tests
