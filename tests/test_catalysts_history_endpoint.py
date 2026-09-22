"""Packet G CP1 -- GET /api/catalysts/history/{sym}, the per-ticker research
page's Catalysts tab backend. Signed by the owner 2026-09-22 (fingerprint
5331c90c2), scoped to: one new read-only store function, one new read-only
endpoint, one new tab. This file covers the endpoint; tests/test_catalyst_
store.py covers history_for_ticker() directly.

⚠️ CATALYST_DB_PATH IS ISOLATED to a temp file, per test_catalysts_internal.py's
own documented lesson: a test that does not isolate this reads the owner's
live `C:\\data\\catalysts.db` instead of measuring the route at all.
"""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services.catalyst import store as catalyst_store

FREE_USER = {"id": "hist-free-1", "email": "histfree@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "hist-paid-1", "email": "histpaid@example.test", "role": "member", "plan": "pro"}


@pytest.fixture(autouse=True)
def _isolated_catalyst_db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(catalyst_store, "_DB_PATH", os.path.join(d, "catalysts.db"))
        catalyst_store._init_db()
        yield


@pytest.fixture
def client_as(request):
    """Same override convention as test_paywall_gate_free_tier.py's _client:
    override get_current_user/get_current_user_with_plan, never require_paid
    itself, so the gate actually runs."""
    def _make(user):
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_user_with_plan, None)
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
        return TestClient(app, raise_server_exceptions=False)
    yield _make
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)


def _seed(ticker, market_date, thesis, rank=1):
    catalyst_store.upsert_catalyst({
        "market_date": market_date, "ticker": ticker, "rank": rank, "score": 10.0,
        "tag": "Catalyst", "price": 100.0, "gap_pct": 5.0, "vol_x": 2.0,
        "market_cap": 1_000_000_000, "sector": "Tech", "thesis_text": thesis,
        "thesis_model": "claude-opus-4-7", "thesis_at": 1, "thesis_sources": "[]",
        "signals_hash": "h", "catalyst_at": None, "raw_signals": "{}",
    })


def test_free_user_is_refused_with_402(client_as):
    resp = client_as(FREE_USER).get("/api/catalysts/history/NVDA")
    assert resp.status_code == 402


def test_anonymous_caller_is_refused(client_as):
    resp = TestClient(app, raise_server_exceptions=False).get("/api/catalysts/history/NVDA")
    assert resp.status_code in (401, 403)


def test_paid_user_gets_real_history(client_as):
    _seed("NVDA", "2026-05-26", "newest thesis")
    _seed("NVDA", "2026-05-20", "older thesis")
    resp = client_as(PAID_USER).get("/api/catalysts/history/NVDA")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ticker"] == "NVDA"
    assert [e["thesis_text"] for e in body["entries"]] == ["newest thesis", "older thesis"]


def test_paid_user_never_flagged_ticker_gets_honest_empty_list(client_as):
    """An empty list is the correct, honest answer -- never a 404."""
    resp = client_as(PAID_USER).get("/api/catalysts/history/ZZZZ")
    assert resp.status_code == 200
    assert resp.json() == {"ticker": "ZZZZ", "entries": []}


def test_lowercase_ticker_is_normalized(client_as):
    _seed("AAPL", "2026-05-26", "t")
    resp = client_as(PAID_USER).get("/api/catalysts/history/aapl")
    assert resp.status_code == 200
    assert resp.json()["ticker"] == "AAPL"
    assert len(resp.json()["entries"]) == 1


def test_invalid_ticker_shape_is_refused_with_400(client_as):
    resp = client_as(PAID_USER).get("/api/catalysts/history/NOT-A-TICKER")
    assert resp.status_code == 400
