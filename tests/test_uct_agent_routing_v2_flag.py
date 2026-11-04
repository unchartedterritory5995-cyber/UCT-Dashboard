"""NLM-1 D1: UCT_AGENT_ROUTING_V2 (default off) is reported by /api/agent/config as `routing_v2`.

The browser routes with v2 only when this AND its own switch (localStorage uct.agent.routingV2) are on; the
server validates every op against the manifest it was sent either way.
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


def test_routing_v2_off_by_default(monkeypatch, client):
    monkeypatch.delenv("UCT_AGENT_ROUTING_V2", raising=False)
    assert rx.routing_v2_enabled() is False
    assert client(ME).get("/api/agent/config").json()["routing_v2"] is False


@pytest.mark.parametrize("value,on", [("1", True), ("true", True), ("ON", True), ("0", False), ("", False), ("no", False)])
def test_routing_v2_env_values(monkeypatch, client, value, on):
    monkeypatch.setenv("UCT_AGENT_ROUTING_V2", value)
    assert rx.routing_v2_enabled() is on
    assert client(ME).get("/api/agent/config").json()["routing_v2"] is on
