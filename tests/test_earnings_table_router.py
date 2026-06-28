from fastapi.testclient import TestClient
import api.routers.fundamentals as fr
from api.middleware.auth_middleware import get_current_user
from fastapi import FastAPI


def _client(monkeypatch):
    app = FastAPI()
    app.include_router(fr.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "t@t.dev"}
    return TestClient(app)


def test_requires_auth():
    app = FastAPI()
    app.include_router(fr.router)
    c = TestClient(app)
    # No override → dependency runs for real; unauthenticated should be 401/403.
    r = c.get("/api/fundamentals/earnings-table?sym=AAPL")
    assert r.status_code in (401, 403)


def test_happy_path(monkeypatch):
    monkeypatch.setattr(fr, "get_earnings_table",
                        lambda sym, debug=False: {"ticker": sym.upper(), "annual": [{"year": 2025}], "quarterly": [{"label": "2025 Q4"}]})
    c = _client(monkeypatch)
    r = c.get("/api/fundamentals/earnings-table?sym=aapl")
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == "AAPL"
    assert body["annual"] and body["quarterly"]


def test_unknown_ticker_returns_empty_not_500(monkeypatch):
    monkeypatch.setattr(fr, "get_earnings_table",
                        lambda sym, debug=False: {"ticker": sym.upper(), "annual": [], "quarterly": []})
    c = _client(monkeypatch)
    r = c.get("/api/fundamentals/earnings-table?sym=ZZNOPE")
    assert r.status_code == 200
    assert r.json()["annual"] == []


def test_debug_flag_passes_through(monkeypatch):
    seen = {}
    def fake(sym, debug=False):
        seen["debug"] = debug
        return {"ticker": sym, "annual": [], "quarterly": [], "_sources": {}}
    monkeypatch.setattr(fr, "get_earnings_table", fake)
    c = _client(monkeypatch)
    r = c.get("/api/fundamentals/earnings-table?sym=AAPL&debug=1")
    assert r.status_code == 200
    assert seen["debug"] is True
