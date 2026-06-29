from fastapi import FastAPI
from fastapi.testclient import TestClient
import api.routers.analyst as ar
from api.middleware.auth_middleware import get_current_user


def _client(monkeypatch):
    app = FastAPI()
    app.include_router(ar.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": 1}
    return TestClient(app)


def test_requires_auth():
    app = FastAPI()
    app.include_router(ar.router)
    r = TestClient(app).get("/api/analyst/AAPL")
    assert r.status_code in (401, 403)


def test_happy(monkeypatch):
    monkeypatch.setattr(ar, "get_analyst_intel", lambda sym, current_price=None, debug=False: {"ticker": sym.upper(), "consensus": {"rating": "Buy"}, "price_target": None, "recent_actions": []})
    r = _client(monkeypatch).get("/api/analyst/aapl")
    assert r.status_code == 200 and r.json()["ticker"] == "AAPL"


def test_unknown_returns_shape_not_500(monkeypatch):
    monkeypatch.setattr(ar, "get_analyst_intel", lambda sym, current_price=None, debug=False: {"ticker": sym.upper(), "consensus": None, "price_target": None, "recent_actions": []})
    r = _client(monkeypatch).get("/api/analyst/ZZNOPE")
    assert r.status_code == 200 and r.json()["consensus"] is None
