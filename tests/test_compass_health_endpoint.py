"""Packet M CP1 -- GET /api/j2/compass-health's first router-level test
coverage. Signed by the owner 2026-09-22 (fingerprint 3f28cd944).

tests/test_compass_health.py already covers compute_health() directly at the
service layer -- these tests cover the route itself: the admin gate, the
full response shape including cost_today, and the days param clamping.
"""
import pytest
from fastapi.testclient import TestClient

from api.main import app
from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan

MEMBER = {"id": "ch-member-1", "email": "chmember@example.test", "role": "member", "plan": "pro"}
ADMIN = {"id": "ch-admin-1", "email": "chadmin@example.test", "role": "admin", "plan": "pro"}


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


def test_a_non_admin_member_is_refused_with_403(client_as):
    resp = client_as(MEMBER).get("/api/j2/compass-health")
    assert resp.status_code == 403


def test_an_anonymous_caller_is_refused(client_as):
    app.dependency_overrides.pop(get_current_user, None)
    resp = TestClient(app, raise_server_exceptions=False).get("/api/j2/compass-health")
    assert resp.status_code in (401, 403)


def test_an_admin_gets_the_full_shape_including_cost_today(client_as, monkeypatch):
    from api.services import compass_health
    from api.services.journal_two import compass_cost_guard

    fake_metrics = {
        "chat_turns": 12, "active_users": 3, "tool_calls": 40, "tool_failures": 2,
        "tool_failure_rate": 0.05, "avg_latency_ms": 210,
        "top_failing_tools": [{"tool": "get_regime", "failures": 2}],
    }
    monkeypatch.setattr(compass_health, "compute_health", lambda conn, days=7: dict(fake_metrics))
    monkeypatch.setattr(compass_cost_guard, "snapshot",
                         lambda: {"spend_usd": 1.23, "circuit_open": False})

    resp = client_as(ADMIN).get("/api/j2/compass-health")
    assert resp.status_code == 200
    body = resp.json()
    for key, val in fake_metrics.items():
        assert body[key] == val
    assert body["cost_today"] == {"spend_usd": 1.23, "circuit_open": False}


def test_days_param_is_clamped_between_1_and_90(client_as, monkeypatch):
    from api.services import compass_health
    from api.services.journal_two import compass_cost_guard

    seen = {}

    def _fake_compute(conn, days=7):
        seen["days"] = days
        return {"chat_turns": 0, "active_users": 0, "tool_calls": 0,
                "tool_failures": 0, "tool_failure_rate": 0.0,
                "avg_latency_ms": 0, "top_failing_tools": []}

    monkeypatch.setattr(compass_health, "compute_health", _fake_compute)
    monkeypatch.setattr(compass_cost_guard, "snapshot", lambda: {})

    client_as(ADMIN).get("/api/j2/compass-health", params={"days": 9999})
    assert seen["days"] == 90

    client_as(ADMIN).get("/api/j2/compass-health", params={"days": -5})
    assert seen["days"] == 1
