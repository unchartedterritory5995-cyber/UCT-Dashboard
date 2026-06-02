from unittest import mock
from fastapi.testclient import TestClient
from api.main import app

client = TestClient(app)


def test_enrichment_returns_per_sym_move_and_history():
    cal = {"days": {"2026-06-02": {
        "bmo": [{"sym": "CRWD"}], "amc": [{"sym": "HPE"}]}}}

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
        r = client.get("/api/calendar/enrichment?date=2026-06-02")
    assert r.status_code == 200
    body = r.json()
    assert body["CRWD"]["expected_move"]["pct"] == 9.1
    assert body["CRWD"]["beat_history"] == [{"beat": True}]
    assert body["HPE"]["expected_move"] is None


def test_enrichment_empty_when_no_calendar_cache():
    with mock.patch("api.routers.calendar.cache.get", return_value=None):
        r = client.get("/api/calendar/enrichment?date=2026-06-02")
    assert r.status_code == 200
    assert r.json() == {}
