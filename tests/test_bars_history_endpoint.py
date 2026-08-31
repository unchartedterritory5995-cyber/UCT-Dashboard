"""/api/bars-history — the edge-cacheable SEALED-history endpoint (instant-charts Phase 5).

READ-ONLY: it serves only what is ALREADY STORED in SQLite (a pure read — never a provider
fetch/write), strips the still-developing period, and stamps a cache header. The dated `d`
makes a matching request IMMUTABLE (~1y, self-refreshing per trading day). These pin the
safety-critical behavior: never present a developing bar as sealed, never fetch (so a global
pre-warm can't storm the pod), and fall back to no-store for anything it can't safely slice.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers.bars import router
from api.services import bars_fetch


def _client():
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


@contextmanager
def _stored(bars):
    """Simulate `bars` already stored in SQLite for a normal symbol — the pure read path.
    `_sqlite.get_bars` returns truthy raw rows; `_fmt_sqlite_bars` formats them into `bars`."""
    raw = [("row",)] if bars else []
    with patch.object(bars_fetch._sqlite, "get_bars", return_value=raw), \
         patch("api.routers.bars._fmt_sqlite_bars", return_value=list(bars)):
        yield


def _today_iso():
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def test_daily_history_strips_developing_bar_and_is_cacheable():
    today = _today_iso()
    bars = [
        {"t": "2020-01-02", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10},
        {"t": "2020-01-03", "o": 1, "h": 2, "l": 0.5, "c": 1.6, "v": 10},
        {"t": today, "o": 1, "h": 2, "l": 0.5, "c": 1.7, "v": 10},   # developing today candle
    ]
    with _stored(bars):
        r = _client().get("/api/bars-history/AAPL?tf=D&bars=200")
    assert r.status_code == 200
    body = r.json()
    assert body["sealed"] is True
    ts = [b["t"] for b in body["bars"]]
    assert today not in ts, "the developing today candle must be stripped from sealed history"
    assert ts == ["2020-01-02", "2020-01-03"]
    assert body["last_sealed"] == "2020-01-03"
    assert body["count"] == 2
    cc = r.headers.get("Cache-Control", "")
    assert "public" in cc and "max-age=3600" in cc


def test_matching_d_yields_immutable_one_year_cache():
    bars = [
        {"t": "2020-01-02", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10},
        {"t": "2020-01-03", "o": 1, "h": 2, "l": 0.5, "c": 1.6, "v": 10},
        {"t": _today_iso(), "o": 1, "h": 2, "l": 0.5, "c": 1.7, "v": 10},
    ]
    with _stored(bars):
        r = _client().get("/api/bars-history/AAPL?tf=D&d=2020-01-03")
    assert r.status_code == 200
    cc = r.headers.get("Cache-Control", "")
    assert "immutable" in cc and "max-age=31536000" in cc


def test_missing_d_stays_backward_compatible_short_cache():
    bars = [
        {"t": "2020-01-02", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10},
        {"t": "2020-01-03", "o": 1, "h": 2, "l": 0.5, "c": 1.6, "v": 10},
    ]
    with _stored(bars):
        r = _client().get("/api/bars-history/AAPL?tf=D")
    cc = r.headers.get("Cache-Control", "")
    assert "immutable" not in cc and "max-age=3600" in cc


def test_mismatched_d_is_not_frozen_immutable():
    bars = [
        {"t": "2020-01-02", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10},
        {"t": "2020-01-03", "o": 1, "h": 2, "l": 0.5, "c": 1.6, "v": 10},
    ]
    with _stored(bars):
        r = _client().get("/api/bars-history/AAPL?tf=D&d=1999-12-31")
    cc = r.headers.get("Cache-Control", "")
    assert "immutable" not in cc and "max-age=3600" in cc


def test_intraday_falls_back_to_no_store():
    r = _client().get("/api/bars-history/AAPL?tf=5")
    assert "no-store" in r.headers.get("Cache-Control", "")
    assert r.json()["sealed"] is False


def test_unix_ts_series_is_not_sliced_and_is_no_store():
    bars = [{"t": 1704200000, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 0}]
    with _stored(bars):
        r = _client().get("/api/bars-history/AMDX?tf=D")   # a normal symbol, but unix-ts rows
    assert "no-store" in r.headers.get("Cache-Control", "")


def test_no_stored_rows_serves_empty_sealed():
    # An un-warmed symbol: nothing stored → empty sealed history, NEVER a fetch.
    with _stored([]):
        r = _client().get("/api/bars-history/ZQZQ?tf=D&d=2020-01-03")
    body = r.json()
    assert body["sealed"] is True and body["bars"] == [] and body["count"] == 0
    # empty last_sealed != d → not frozen immutable
    assert "immutable" not in r.headers.get("Cache-Control", "")


def test_the_endpoint_never_calls_the_fetching_serve_path():
    # THE incident guard: /api/bars-history must NEVER call get_bars (which triggers deep
    # backfill writes) — it reads SQLite directly. A spy on get_bars must see ZERO calls.
    bars = [{"t": "2020-01-02", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 10}]
    with _stored(bars), patch("api.routers.bars.get_bars") as spy:
        _client().get("/api/bars-history/AAPL?tf=D")
    assert spy.call_count == 0, "history endpoint must be READ-ONLY — it must not invoke the fetching serve path"


def test_weekly_current_week_is_excluded():
    today = datetime.now(ZoneInfo("America/New_York")).date()
    this_monday = today - timedelta(days=today.weekday())
    past_friday = (this_monday - timedelta(days=3)).isoformat()
    this_week_key = this_monday.isoformat()
    bars = [
        {"t": "2019-12-27", "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 0},
        {"t": past_friday, "o": 1, "h": 2, "l": 0.5, "c": 1.6, "v": 0},
        {"t": this_week_key, "o": 1, "h": 2, "l": 0.5, "c": 1.7, "v": 0},
    ]
    with _stored(bars):
        r = _client().get("/api/bars-history/AAPL?tf=W")
    ts = [b["t"] for b in r.json()["bars"]]
    assert this_week_key not in ts
    assert past_friday in ts and "2019-12-27" in ts
