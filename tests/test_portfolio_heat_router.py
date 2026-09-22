"""A14 CP1 (GATE-A14-PORTFOLIO-HEAT-CP1, signed 2026-09-21, fingerprint
417b6b853) -- `GET /api/portfolio/heat`. §5 acceptance plan.

⛔ `require_paid` is NEVER overridden in these tests -- only what it reads
(`get_current_user`/`get_current_user_with_plan`), so the real gate still
decides and a free member's refusal is an actual assertion, not an assumed
one (`tests/test_analyst_router.py`'s own documented lesson,
`lesson_injected_dependency_hides_the_fetch`).
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.portfolio_heat as phr
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan

PAID = {"id": "u-paid", "email": "paid@example.test", "role": "member", "plan": "pro"}
FREE = {"id": "u-free", "email": "free@example.test", "role": "member", "plan": "free"}


def _app():
    app = FastAPI()
    app.include_router(phr.router)
    return app


def _client(user=None):
    app = _app()
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: dict(user)
        app.dependency_overrides[get_current_user_with_plan] = lambda: dict(user)
    return TestClient(app)


def test_portfolio_heat_route_requires_paid():
    """An unauthenticated request is rejected."""
    r = _client().get("/api/portfolio/heat")
    assert r.status_code in (401, 403)


def test_a_logged_in_free_member_is_refused():
    """A session is not a plan -- matches `ai_search.py`'s own `require_paid`
    test pattern (§5: 'matching ai_search.py's own require_paid test
    pattern')."""
    r = _client(FREE).get("/api/portfolio/heat")
    assert r.status_code == 402
    assert r.json()["detail"] == "Portfolio risk requires a paid plan"


def test_portfolio_heat_route_matches_the_function_output(monkeypatch):
    """The route's JSON response is a pass-through of `portfolio_heat()`'s own
    return dict — no field renamed, added, or dropped in transit."""
    fake_result = {
        "ok": True, "risk_heat_pct": 4.5, "notional_exposure_pct": 22.0,
        "per_position": [{"symbol": "AAPL", "side": "long", "dist_to_stop_pct": 3.2,
                          "r_multiple": None, "risk_pct": 1.1, "placeholder_stop": False}],
        "by_symbol": [{"symbol": "AAPL", "risk_pct": 1.1}],
        "by_sector": [{"sector": "Technology", "risk_pct": 1.1}],
        "concentration_flags": [],
        "placeholder_stops": [],
        "caps": {"per_trade_pct": 2.0, "aggregate_pct": 10.0, "regime_ceiling_pct": 80.0},
        "aggregate_cap_pct": 10.0,
        "account_size_is_default": False,
        "room_to_add_pct": 5.5,
        "regime": "bull_trend",
        "sources": ["open positions (1)", "risk-heat vs 10% Desjardins cap", "regime bull_trend"],
    }
    captured = {}

    def fake_portfolio_heat(user_id, account_id=None, account_size=None):
        captured["args"] = (user_id, account_id, account_size)
        return fake_result

    monkeypatch.setattr(phr._ph, "portfolio_heat", fake_portfolio_heat)
    r = _client(PAID).get("/api/portfolio/heat")
    assert r.status_code == 200
    assert r.json() == fake_result, "the route must not rename, add, or drop a field"
    assert captured["args"] == ("u-paid", None, None), (
        "the route must call portfolio_heat() with exactly user_id/account_id/account_size "
        "-- no new parameters invented")


def test_portfolio_heat_route_forwards_query_params(monkeypatch):
    """§2: 'no new parameters invented' — the route's OWN optional query
    params (account_id, account_size) are the exact ones portfolio_heat()
    already takes, forwarded verbatim."""
    captured = {}

    def fake_portfolio_heat(user_id, account_id=None, account_size=None):
        captured["args"] = (user_id, account_id, account_size)
        return {"ok": True}

    monkeypatch.setattr(phr._ph, "portfolio_heat", fake_portfolio_heat)
    r = _client(PAID).get("/api/portfolio/heat?account_id=acc-1&account_size=75000")
    assert r.status_code == 200
    assert captured["args"] == ("u-paid", "acc-1", 75000.0)


def test_placeholder_stop_positions_render_flagged_not_hidden(monkeypatch):
    """A seeded placeholder-stop position appears in the response with
    `placeholder_stop: true` and a null `risk_pct`, matching the function's
    own documented behavior (§4 risk row 1: 'this checkpoint must render that
    flag, not hide it')."""
    fake_result = {
        "ok": True, "risk_heat_pct": 0.0, "notional_exposure_pct": 5.0,
        "per_position": [{"symbol": "TSLA", "side": "long", "dist_to_stop_pct": 0.0,
                          "r_multiple": None, "risk_pct": None, "placeholder_stop": True}],
        "by_symbol": [], "by_sector": [], "concentration_flags": [],
        "placeholder_stops": ["TSLA"],
        "caps": {"per_trade_pct": 2.0, "aggregate_pct": 10.0, "regime_ceiling_pct": 80.0},
        "aggregate_cap_pct": 10.0, "account_size_is_default": True,
        "room_to_add_pct": 10.0, "regime": None,
        "sources": ["open positions (1)", "risk-heat vs 10% Desjardins cap", "regime None"],
    }
    monkeypatch.setattr(phr._ph, "portfolio_heat", lambda user_id, account_id=None, account_size=None: fake_result)
    r = _client(PAID).get("/api/portfolio/heat")
    assert r.status_code == 200
    body = r.json()
    assert body["per_position"][0]["placeholder_stop"] is True, (
        "a placeholder-stop position must be surfaced, never dropped from per_position")
    assert body["per_position"][0]["risk_pct"] is None
    assert "TSLA" in body["placeholder_stops"]
