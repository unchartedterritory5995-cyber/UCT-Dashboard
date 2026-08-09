from fastapi.testclient import TestClient
import api.routers.fundamentals as fr
from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
)

# ⚠️ REPAIRED 2026-08-09 — `/api/fundamentals/earnings-table` became `require_paid`.
# These tests overrode `get_current_user` and asserted 200, which ENCODED THE
# HOLE the auth sweep found: they proved a caller with A SESSION got the data,
# and signup is open and free, so that was never the same claim as "a member who
# paid". The override moved to `get_current_user_with_plan` (the gate's INPUT) —
# ⛔ NOT to `require_paid` itself, because overriding a gate means never running
# it (`lesson_injected_dependency_hides_the_fetch`).
PAID = {"id": 1, "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": 2, "email": "free@example.test", "role": "member", "plan": "free"}
from fastapi import FastAPI


def _client(monkeypatch):
    app = FastAPI()
    app.include_router(fr.router)
    app.dependency_overrides[get_current_user] = lambda: dict(PAID)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(PAID)
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
