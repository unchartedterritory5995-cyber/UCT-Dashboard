"""Packet H CP1 -- GET /api/modelbook/appearances/{symbol}, the per-ticker
research page's Model Book tab backend. Signed by the owner 2026-09-22
(fingerprint f119617df), scoped to: one new read-only store function, one
new read-only endpoint, one new tab. This file covers the endpoint;
tests/test_modelbook_service.py covers get_stock_appearances() directly.

⚠️ MODELBOOK_DB_PATH IS ISOLATED to a temp file -- same lesson as
test_catalysts_internal.py: an un-isolated test measures the owner's live
`C:\\data\\modelbook.db` instead of the route.
"""
import os
import tempfile

import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
from api.services import modelbook_service as svc

FREE_USER = {"id": "mb-free-1", "email": "mbfree@example.test", "role": "member", "plan": "free"}
PAID_USER = {"id": "mb-paid-1", "email": "mbpaid@example.test", "role": "member", "plan": "pro"}


@pytest.fixture(autouse=True)
def _isolated_modelbook_db(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(svc, "_DB_PATH", os.path.join(d, "modelbook.db"))
        svc._init_db()
        yield


@pytest.fixture
def client_as():
    def _make(user):
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_current_user_with_plan, None)
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
        return TestClient(app, raise_server_exceptions=False)
    yield _make
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_with_plan, None)


def _stock(year, symbol, thesis="t"):
    return {
        "year": year, "symbol": symbol, "company": "Co", "sector": None, "industry": None,
        "sort_order": 1, "thesis": thesis, "gain_pct": 10.0,
    }


def test_free_user_is_refused_with_402(client_as):
    resp = client_as(FREE_USER).get("/api/modelbook/appearances/NVDA")
    assert resp.status_code == 402


def test_anonymous_caller_is_refused(client_as):
    resp = TestClient(app, raise_server_exceptions=False).get("/api/modelbook/appearances/NVDA")
    assert resp.status_code in (401, 403)


def test_paid_user_gets_real_appearances_newest_first(client_as):
    svc.create_stock(_stock(2023, "NVDA", thesis="early leg"))
    svc.create_stock(_stock(2025, "NVDA", thesis="AI leader"))
    resp = client_as(PAID_USER).get("/api/modelbook/appearances/NVDA")
    assert resp.status_code == 200
    body = resp.json()
    assert body["symbol"] == "NVDA"
    assert [a["year"] for a in body["appearances"]] == [2025, 2023]
    assert body["appearances"][0]["thesis"] == "AI leader"


def test_paid_user_never_curated_symbol_gets_honest_empty_list(client_as):
    resp = client_as(PAID_USER).get("/api/modelbook/appearances/ZZZZ")
    assert resp.status_code == 200
    assert resp.json() == {"symbol": "ZZZZ", "appearances": []}


def test_lowercase_symbol_is_normalized(client_as):
    svc.create_stock(_stock(2025, "AAPL"))
    resp = client_as(PAID_USER).get("/api/modelbook/appearances/aapl")
    assert resp.status_code == 200
    assert resp.json()["symbol"] == "AAPL"
    assert len(resp.json()["appearances"]) == 1
