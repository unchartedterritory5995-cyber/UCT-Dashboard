"""/api/bars-history — the edge-cacheable SEALED-history endpoint (instant-charts Phase 5).

The endpoint is ADDITIVE: it reuses /api/bars's full serve path (mocked here as `get_bars`),
then strips the still-developing period and re-stamps a PUBLIC cache header so a CDN + the
browser can cache the frozen past. These pin the safety-critical behavior: it must never
present a developing bar as sealed, and must fall back to `no-store` for anything it can't
safely cut (intraday, unix-ts index series).
"""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.responses import ORJSONResponse
from fastapi.testclient import TestClient

from api.routers.bars import router


def _client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _mock_serve(payload, status=200):
    """Patch the underlying /api/bars serve so the history endpoint's OWN logic (sealed
    strip + cache headers + version) is what's under test, isolated from fetch routing."""
    return patch("api.routers.bars.get_bars",
                 return_value=ORJSONResponse(status_code=status, content=payload))


def _today_iso():
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def test_daily_history_strips_developing_bar_and_is_cacheable():
    today = _today_iso()
    payload = {"ticker": "AAPL", "tf": "D", "bars": [
        {"t": "2020-01-02", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10},
        {"t": "2020-01-03", "o": 1, "h": 2, "l": 0.5, "c": 1.6, "v": 10},
        {"t": today, "o": 1, "h": 2, "l": 0.5, "c": 1.7, "v": 10},   # developing today candle
    ]}
    with _mock_serve(payload):
        r = _client().get("/api/bars-history/AAPL?tf=D&bars=200")

    assert r.status_code == 200
    body = r.json()
    assert body["sealed"] is True
    ts = [b["t"] for b in body["bars"]]
    assert today not in ts, "the developing today candle must be stripped from sealed history"
    assert ts == ["2020-01-02", "2020-01-03"]
    assert body["last_sealed"] == "2020-01-03"
    assert body["version"] == "1.2020-01-03"
    assert body["count"] == 2
    cc = r.headers.get("Cache-Control", "")
    assert "public" in cc and "max-age=3600" in cc and "stale-while-revalidate" in cc


def test_matching_d_yields_immutable_one_year_cache():
    # The pre-warm sweep + client send d=<current last-sealed>; a match = permanent URL.
    payload = {"ticker": "AAPL", "tf": "D", "bars": [
        {"t": "2020-01-02", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10},
        {"t": "2020-01-03", "o": 1, "h": 2, "l": 0.5, "c": 1.6, "v": 10},
        {"t": _today_iso(), "o": 1, "h": 2, "l": 0.5, "c": 1.7, "v": 10},
    ]}
    with _mock_serve(payload):
        r = _client().get("/api/bars-history/AAPL?tf=D&d=2020-01-03")
    assert r.status_code == 200
    cc = r.headers.get("Cache-Control", "")
    assert "immutable" in cc and "max-age=31536000" in cc


def test_missing_d_stays_backward_compatible_short_cache():
    payload = {"ticker": "AAPL", "tf": "D", "bars": [
        {"t": "2020-01-02", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10},
        {"t": "2020-01-03", "o": 1, "h": 2, "l": 0.5, "c": 1.6, "v": 10},
    ]}
    with _mock_serve(payload):
        r = _client().get("/api/bars-history/AAPL?tf=D")   # no d — older clients
    cc = r.headers.get("Cache-Control", "")
    assert "immutable" not in cc and "max-age=3600" in cc


def test_mismatched_d_is_not_frozen_immutable():
    # A stale d (client's boundary moved) must NOT freeze current data for a year.
    payload = {"ticker": "AAPL", "tf": "D", "bars": [
        {"t": "2020-01-02", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10},
        {"t": "2020-01-03", "o": 1, "h": 2, "l": 0.5, "c": 1.6, "v": 10},
    ]}
    with _mock_serve(payload):
        r = _client().get("/api/bars-history/AAPL?tf=D&d=1999-12-31")
    cc = r.headers.get("Cache-Control", "")
    assert "immutable" not in cc and "max-age=3600" in cc


def test_intraday_falls_back_to_no_store():
    # v1 serves D/W/M only; intraday must never be edge-cached. (Short-circuits before serve.)
    r = _client().get("/api/bars-history/AAPL?tf=5")
    assert "no-store" in r.headers.get("Cache-Control", "")
    assert r.json()["sealed"] is False


def test_unix_ts_series_is_not_sliced_and_is_no_store():
    # Cash-settled index series carry unix-second timestamps; the date-based sealed cut
    # would mis-slice them, so they must serve uncacheable rather than wrong.
    payload = {"ticker": "SPX", "tf": "D", "bars": [
        {"t": 1704200000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 0},
    ]}
    with _mock_serve(payload):
        r = _client().get("/api/bars-history/SPX?tf=D")
    assert "no-store" in r.headers.get("Cache-Control", "")


def test_upstream_error_is_never_cached():
    payload = {"ticker": "ZZZ", "tf": "D", "bars": [], "error": "transient"}
    with _mock_serve(payload, status=503):
        r = _client().get("/api/bars-history/ZZZ?tf=D")
    assert r.status_code == 503
    assert "no-store" in r.headers.get("Cache-Control", "")


def test_weekly_current_week_is_excluded():
    today = datetime.now(ZoneInfo("America/New_York")).date()
    this_monday = today - timedelta(days=today.weekday())
    past_friday = (this_monday - timedelta(days=3)).isoformat()   # last week's Friday
    this_week_key = this_monday.isoformat()
    payload = {"ticker": "AAPL", "tf": "W", "bars": [
        {"t": "2019-12-27", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 0},
        {"t": past_friday, "o": 1, "h": 2, "l": 0.5, "c": 1.6, "v": 0},
        {"t": this_week_key, "o": 1, "h": 2, "l": 0.5, "c": 1.7, "v": 0},   # developing week
    ]}
    with _mock_serve(payload):
        r = _client().get("/api/bars-history/AAPL?tf=W")
    ts = [b["t"] for b in r.json()["bars"]]
    assert this_week_key not in ts, "the current (developing) week must be excluded"
    assert past_friday in ts
    assert "2019-12-27" in ts
