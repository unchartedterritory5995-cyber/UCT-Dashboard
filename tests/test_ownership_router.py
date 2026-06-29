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
    r = TestClient(app).get("/api/ownership/AAPL")
    assert r.status_code in (401, 403)


def test_happy(monkeypatch):
    monkeypatch.setattr(ar, "get_ownership", lambda sym, debug=False: {"ticker": sym.upper(), "inst_pct": 61.4, "inst_holders_count": 1, "as_of": "2026-03-31", "top_holders": [{"holder": "Vanguard"}], "biggest_buyers": [], "biggest_sellers": []})
    r = _client(monkeypatch).get("/api/ownership/aapl")
    assert r.status_code == 200 and r.json()["ticker"] == "AAPL" and r.json()["top_holders"]


def test_unknown_returns_shape_not_500(monkeypatch):
    monkeypatch.setattr(ar, "get_ownership", lambda sym, debug=False: {"ticker": sym.upper(), "inst_pct": None, "inst_holders_count": None, "as_of": None, "top_holders": [], "biggest_buyers": [], "biggest_sellers": []})
    r = _client(monkeypatch).get("/api/ownership/ZZNOPE")
    assert r.status_code == 200 and r.json()["top_holders"] == []
