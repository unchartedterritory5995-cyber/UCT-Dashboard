"""NLM-1: UCT_AGENT_ROUTING_V2 (default ON, owner policy 11-04; 0/false/off/no = kill switch) is reported by
/api/agent/config as `routing_v2`.

The browser has its own kill switch (localStorage uct.agent.routingV2 = '0'); the server validates every op against
the manifest it was sent either way. The config endpoint stays admin-only (require_admin_dark).
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import uct_agent as rx

ME = {"id": "u-me", "plan": "pro", "role": "admin"}


@pytest.fixture
def client():
    def build(user):
        from api.middleware.auth_middleware import get_current_user_with_plan
        app = FastAPI()
        app.include_router(rx.router)
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
        return TestClient(app)
    return build


def test_routing_v2_on_by_default(monkeypatch, client):
    monkeypatch.delenv("UCT_AGENT_ROUTING_V2", raising=False)
    assert rx.routing_v2_enabled() is True
    assert client(ME).get("/api/agent/config").json()["routing_v2"] is True


@pytest.mark.parametrize("value,on", [("1", True), ("true", True), ("ON", True), ("", True), ("0", False), ("false", False), (" OFF ", False), ("no", False)])
def test_routing_v2_env_values(monkeypatch, client, value, on):
    monkeypatch.setenv("UCT_AGENT_ROUTING_V2", value)
    assert rx.routing_v2_enabled() is on
    assert client(ME).get("/api/agent/config").json()["routing_v2"] is on
