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


def test_reporting_currency_is_stamped_on_a_copy(monkeypatch):
    """Accuracy follow-up 7: the Fundamentals widget printed TSM's TWD sales as "$".
    The endpoint carries the SAME reporting currency EE/FA use, on a copy, so the
    cached payload's shape is untouched; unknown stays None (renders "$" as before)."""
    from api.services.research import reporting_currency
    cached = {"ticker": "TSM", "annual": [], "quarterly": [{"label": "2026 Q2"}]}
    monkeypatch.setattr(fr, "get_earnings_table", lambda sym, debug=False: cached)
    monkeypatch.setattr(reporting_currency, "read", lambda sym, timeout=10: ("ok", "TWD"))
    c = _client(monkeypatch)
    assert c.get("/api/fundamentals/earnings-table?sym=TSM").json()["currency"] == "TWD"
    assert "currency" not in cached, "the cached payload must not be mutated"
    monkeypatch.setattr(reporting_currency, "read", lambda sym, timeout=10: ("error", None))
    assert c.get("/api/fundamentals/earnings-table?sym=TSM").json()["currency"] is None
