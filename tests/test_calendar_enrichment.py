from datetime import date, timedelta
from unittest import mock
from fastapi.testclient import TestClient
from api.main import app
from api.routers import calendar as cal_mod

client = TestClient(app)


def _current_week_day() -> str:
    """A NON-PAST day inside the router's current-week window (weekend-aware).
    Monday alone would be in the past by Tuesday and trip the past-date
    implied-move skip these tests aren't about."""
    return max(cal_mod._today_et(), cal_mod._week_dates()[0]).isoformat()


def test_enrichment_returns_per_sym_move_and_history():
    ds = _current_week_day()
    cal = {"days": {ds: {"bmo": [{"sym": "CRWD"}], "amc": [{"sym": "HPE"}]}}}

    # Key-aware mock: enrichment cache is cold (None) so the compute path runs;
    # only the calendar_weekly key returns the calendar payload.
    def _cache_get(key):
        return cal if key == "calendar_weekly" else None

    with mock.patch("api.routers.calendar.cache.get", side_effect=_cache_get), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch("api.services.earnings_enrichment.get_implied_move",
                    side_effect=lambda s, earnings_date=None: {"pct": 9.1} if s == "CRWD" else None), \
         mock.patch("api.services.earnings_estimates.get_earnings_intel",
                    side_effect=lambda s: {"beat_history": [{"beat": True}]} if s == "CRWD" else None):
        r = client.get(f"/api/calendar/enrichment?date={ds}")
    assert r.status_code == 200
    body = r.json()
    assert body["CRWD"]["expected_move"]["pct"] == 9.1
    assert body["CRWD"]["beat_history"] == [{"beat": True}]
    assert body["HPE"]["expected_move"] is None


def test_enrichment_includes_tbd_bucket():
    ds = _current_week_day()
    cal = {"days": {ds: {"bmo": [], "amc": [], "tbd": [{"sym": "ACU"}]}}}

    def _cache_get(key):
        return cal if key == "calendar_weekly" else None

    with mock.patch("api.routers.calendar.cache.get", side_effect=_cache_get), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch("api.services.earnings_enrichment.get_implied_move",
                    return_value={"pct": 4.2}), \
         mock.patch("api.services.earnings_estimates.get_earnings_intel",
                    return_value=None):
        r = client.get(f"/api/calendar/enrichment?date={ds}")
    assert r.status_code == 200
    assert r.json()["ACU"]["expected_move"] == {"pct": 4.2}


def test_enrichment_skips_implied_move_for_past_dates():
    """A past date must NEVER call get_implied_move — yfinance only lists
    future expiries, so a past-date expected move is confident garbage."""
    past = (cal_mod._today_et() - timedelta(days=3))
    while past.weekday() >= 5:                       # land on a weekday
        past -= timedelta(days=1)
    ds = past.isoformat()

    # Build the payload the day resolver will return for that date
    day = {"bmo": [{"sym": "CRWD", "eps_act": 1.0}], "amc": [], "tbd": []}

    called = {"em": 0}

    def _em(*a, **k):
        called["em"] += 1
        return {"pct": 1.0}

    with mock.patch.object(cal_mod, "_days_for_date", return_value=day), \
         mock.patch("api.routers.calendar.cache.get", return_value=None), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch("api.services.earnings_enrichment.get_implied_move", side_effect=_em), \
         mock.patch("api.services.earnings_estimates.get_earnings_intel", return_value=None):
        r = client.get(f"/api/calendar/enrichment?date={ds}")
    assert r.status_code == 200
    assert called["em"] == 0
    assert r.json()["CRWD"]["expected_move"] is None


def test_enrichment_window_gate_returns_empty_far_out():
    """Dates beyond current week ±2 weeks are never enriched (compute gate)."""
    far = (cal_mod._today_et() + timedelta(days=40)).isoformat()
    with mock.patch("api.routers.calendar.cache.get", return_value=None), \
         mock.patch("api.routers.calendar.cache.set"), \
         mock.patch.object(cal_mod, "_days_for_date") as days_mock:
        r = client.get(f"/api/calendar/enrichment?date={far}")
    assert r.status_code == 200
    assert r.json() == {}
    days_mock.assert_not_called()   # gated BEFORE any week build


def test_enrichment_empty_when_no_calendar_cache():
    ds = _current_week_day()
    with mock.patch("api.routers.calendar.cache.get", return_value=None):
        r = client.get(f"/api/calendar/enrichment?date={ds}")
    assert r.status_code == 200
    assert r.json() == {}
