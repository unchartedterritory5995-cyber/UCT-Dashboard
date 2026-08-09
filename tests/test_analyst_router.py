"""`/api/analyst/{sym}` + `/api/ownership/{sym}`.

⚠️ REPAIRED 2026-08-09, AND THE REPAIR IS THE POINT. Both routes became
`require_paid` (they relay the firm's FMP Ultimate subscription). Two tests here
overrode `get_current_user` and asserted **200** — which encoded the hole the
auth sweep found: they proved a caller with *a session* got the data, and signup
is open and free, so that was never the same claim as "a member who paid".

⛔ The fix is NOT to override `require_paid`. Overriding a gate means the test
never runs the gate (`lesson_injected_dependency_hides_the_fetch`). The override
stays on `get_current_user_with_plan`, which is the gate's INPUT, so the real
`require_paid` still decides — and a free member is asserted to be refused,
which is the assertion the old file could not make.
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient
import api.routers.analyst as ar
from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
)

PAID = {"id": 1, "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": 2, "email": "free@example.test", "role": "member", "plan": "free"}


def _app():
    app = FastAPI()
    app.include_router(ar.router)
    return app


def _client(user):
    """`require_paid` itself is NEVER overridden — only what it reads."""
    app = _app()
    app.dependency_overrides[get_current_user] = lambda: dict(user)
    app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def test_requires_auth():
    r = TestClient(_app()).get("/api/analyst/AAPL")
    assert r.status_code in (401, 403)


def test_a_logged_in_FREE_member_is_refused():
    """🔴 THE ASSERTION THAT WAS MISSING. This is the whole finding: a session is
    not a plan, and this route was reachable by a free registration."""
    for path in ("/api/analyst/AAPL", "/api/ownership/AAPL"):
        r = _client(FREE).get(path)
        assert r.status_code == 402, (path, r.status_code, r.text[:200])


def test_happy(monkeypatch):
    monkeypatch.setattr(ar, "get_analyst_intel", lambda sym, current_price=None, debug=False: {"ticker": sym.upper(), "consensus": {"rating": "Buy"}, "price_target": None, "recent_actions": []})
    r = _client(PAID).get("/api/analyst/aapl")
    assert r.status_code == 200 and r.json()["ticker"] == "AAPL"


def test_unknown_returns_shape_not_500(monkeypatch):
    monkeypatch.setattr(ar, "get_analyst_intel", lambda sym, current_price=None, debug=False: {"ticker": sym.upper(), "consensus": None, "price_target": None, "recent_actions": []})
    r = _client(PAID).get("/api/analyst/ZZNOPE")
    assert r.status_code == 200 and r.json()["consensus"] is None
