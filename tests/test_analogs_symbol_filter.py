"""GET /api/analogs?symbol= -- one ticker's past trades of a setup (CHK's this-ticker view).

The engine's `get_historical_analogs(setup_type, regime, sector, limit)` has no symbol filter
and the two-repo contract forbids adding one there, so the ROUTE reads a wide window and keeps
the ticker's rows. These tests pin: the filter is exact (no prefix match), `limit` is applied
after the filter, `complete` says whether an empty answer means "none on record", the route
never fabricates a row, and the old (no-symbol) call is unchanged.

A small app mounts only this router, and `_get_api` is replaced, so nothing here can reach a
real engine checkout or the shared data root.
"""
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.intelligence as intel
from api.middleware.auth_middleware import get_current_user_with_plan

PAID = {"id": "an-paid-1", "email": "anpaid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": "an-free-1", "email": "anfree@example.test", "role": "member", "plan": "free"}


def _row(sym, day, pct=5.0):
    return {"symbol": sym, "date_flagged": day, "setup_type": "VCP", "thesis": "", "status": "CLOSED",
            "entry_price": 100.0, "pct_change": pct, "days_held": 4}


WINDOW = [
    _row("NVDA", "2026-09-01", 8.0),
    _row("NVDAX", "2026-08-28"),   # a prefix of no interest: must NOT match NVDA
    _row("AMD", "2026-08-20"),
    _row("nvda", "2026-07-15", -3.0),  # engine casing is not trusted
    _row("NVDA", "2026-06-02", 12.0),
    _row("NVDA", "2026-05-01", 1.0),
]


@pytest.fixture
def engine(monkeypatch):
    calls = []

    def get_historical_analogs(setup_type, regime, sector="", limit=5):
        calls.append({"setup_type": setup_type, "regime": regime, "sector": sector, "limit": limit})
        return [dict(r) for r in engine.rows][:limit]

    engine.rows = list(WINDOW)
    fake = types.SimpleNamespace(get_historical_analogs=get_historical_analogs)
    monkeypatch.setattr(intel, "_get_api", lambda: fake)
    engine.calls = calls
    return engine


def _client(user=PAID):
    app = FastAPI()
    app.include_router(intel.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app, raise_server_exceptions=False)


def test_symbol_keeps_only_that_tickers_rows_exactly(engine):
    r = _client().get("/api/analogs", params={"setup_type": "VCP", "regime": "Uptrend", "symbol": "nvda", "limit": 5})
    assert r.status_code == 200
    body = r.json()
    syms = [a["symbol"].upper() for a in body["analogs"]]
    assert syms == ["NVDA", "NVDA", "NVDA", "NVDA"]
    assert "NVDAX" not in [a["symbol"] for a in body["analogs"]]
    assert body["symbol"] == "NVDA"
    assert body["count"] == 4
    # newest first, the engine's order is kept
    assert [a["date_flagged"] for a in body["analogs"]] == ["2026-09-01", "2026-07-15", "2026-06-02", "2026-05-01"]


def test_symbol_reads_a_wide_window_then_applies_limit(engine):
    r = _client().get("/api/analogs", params={"setup_type": "VCP", "regime": "Uptrend", "symbol": "NVDA", "limit": 2})
    body = r.json()
    assert engine.calls[-1]["limit"] == intel.ANALOG_SYMBOL_SCAN
    assert engine.calls[-1]["setup_type"] == "VCP" and engine.calls[-1]["regime"] == "Uptrend"
    assert body["count"] == 2
    assert [a["date_flagged"] for a in body["analogs"]] == ["2026-09-01", "2026-07-15"]
    assert body["scanned"] == len(WINDOW)
    assert body["complete"] is True


def test_no_rows_for_the_ticker_is_an_empty_list_never_a_made_up_row(engine):
    r = _client().get("/api/analogs", params={"setup_type": "VCP", "regime": "Uptrend", "symbol": "TSLA"})
    body = r.json()
    assert body["analogs"] == [] and body["count"] == 0
    assert body["symbol"] == "TSLA"
    assert body["complete"] is True  # the whole record was read, so none on record is true


def test_a_full_window_is_reported_as_incomplete(engine):
    engine.rows = [_row("AMD", "2026-01-01")] * intel.ANALOG_SYMBOL_SCAN
    body = _client().get("/api/analogs", params={"setup_type": "VCP", "regime": "Uptrend", "symbol": "NVDA"}).json()
    assert body["analogs"] == []
    assert body["scanned"] == intel.ANALOG_SYMBOL_SCAN
    assert body["complete"] is False


def test_without_symbol_the_old_call_is_unchanged(engine):
    body = _client().get("/api/analogs", params={"setup_type": "VCP", "regime": "Uptrend", "limit": 3}).json()
    assert engine.calls[-1]["limit"] == 3
    assert set(body) == {"analogs", "count"}
    assert body["count"] == 3
    assert [a["symbol"] for a in body["analogs"]] == ["NVDA", "NVDAX", "AMD"]


def test_engine_missing_with_symbol_says_so_and_is_not_complete(monkeypatch):
    monkeypatch.setattr(intel, "_get_api", lambda: None)
    body = _client().get("/api/analogs", params={"setup_type": "VCP", "regime": "Uptrend", "symbol": "NVDA"}).json()
    assert body == {"analogs": [], "count": 0, "symbol": "NVDA", "scanned": 0, "complete": False}


def test_junk_symbol_is_refused(engine):
    r = _client().get("/api/analogs", params={"setup_type": "VCP", "regime": "Uptrend", "symbol": "<script>"})
    assert r.status_code in (400, 422)
    assert engine.calls == []


def test_free_member_is_refused(engine):
    r = _client(FREE).get("/api/analogs", params={"setup_type": "VCP", "regime": "Uptrend", "symbol": "NVDA"})
    assert r.status_code == 402
    assert engine.calls == []
