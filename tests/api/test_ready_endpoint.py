"""`/api/ready` — the readiness healthcheck Railway gates traffic on.

See tests/api/test_readiness.py for the why. These cover the HTTP surface and,
critically, the fact that railway.json is SHARED by web + worker + flow-worker:
if healthcheckPath moves to /api/ready, all three services must serve it or
their deploys fail the healthcheck.
"""
import asyncio
import json
import os
import time

import pytest
from httpx import AsyncClient, ASGITransport

from api.main import app
from api.services import readiness
from api.services.readiness import Readiness


@pytest.fixture
def fresh_gate(monkeypatch):
    """Swap the process-wide gate for an isolated one per test."""
    r = Readiness(deadline_seconds=240.0)
    monkeypatch.setattr(readiness, "default", r)
    return r


@pytest.mark.asyncio
async def test_ready_returns_503_while_caches_are_still_warming(fresh_gate):
    fresh_gate.register("hot_tier")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/ready")
    assert r.status_code == 503, "Railway must NOT cut traffic to a cold pod"
    body = r.json()
    assert body["ready"] is False
    assert "hot_tier" in body["pending"]


@pytest.mark.asyncio
async def test_ready_returns_200_once_warm(fresh_gate):
    fresh_gate.register("hot_tier")
    fresh_gate.mark_done("hot_tier")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/ready")
    assert r.status_code == 200
    assert r.json()["ready"] is True


@pytest.mark.asyncio
async def test_health_stays_200_while_warming(fresh_gate):
    """REGRESSION GUARD: /api/health is liveness and is polled by worker_main's
    down-alert monitor, which posts a red 'site down' alert to Discord. It must
    NOT start failing during the warm window or every deploy cries wolf."""
    fresh_gate.register("hot_tier")  # deliberately left pending
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_railway_healthcheck_points_at_the_readiness_route():
    """The gate only does anything if railway.json actually uses it."""
    root = os.path.join(os.path.dirname(__file__), "..", "..")
    with open(os.path.join(root, "railway.json")) as f:
        cfg = json.load(f)
    assert cfg["deploy"]["healthcheckPath"] == "/api/ready"


@pytest.mark.asyncio
async def test_real_hot_tier_warmer_flips_ready_from_503_to_200(fresh_gate):
    """END-TO-END PROOF, no mocks: drive the REAL production warmer
    (`_start_hot_tier_warm_background`) and watch /api/ready actually transition.

    A gate is only real if something FAILS on it -- this asserts the 503 first,
    so the test would catch a wiring change that made /api/ready always-200.
    """
    from api.main import _start_hot_tier_warm_background

    fresh_gate.register("hot_tier")

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        before = await ac.get("/api/ready")
        assert before.status_code == 503, "cold pod must be held out of rotation"
        assert before.json()["pending"] == ["hot_tier"]

        # The real warmer, real thread, zero delay.
        _start_hot_tier_warm_background(delay_seconds=0)

        deadline = time.time() + 30
        while time.time() < deadline and not fresh_gate.is_ready():
            await asyncio.sleep(0.05)

        after = await ac.get("/api/ready")

    assert after.status_code == 200, "warmer finished but readiness never released"
    assert after.json()["pending"] == []


@pytest.mark.asyncio
async def test_worker_serves_ready_because_railway_json_is_shared():
    from api.worker_main import _build_app
    worker_app = _build_app()
    async with AsyncClient(transport=ASGITransport(app=worker_app), base_url="http://test") as ac:
        r = await ac.get("/api/ready")
    assert r.status_code == 200, "worker deploy would fail its healthcheck"


@pytest.mark.asyncio
async def test_flow_worker_serves_ready_because_railway_json_is_shared():
    from api.flow_worker_main import _build_app
    fw_app = _build_app()
    async with AsyncClient(transport=ASGITransport(app=fw_app), base_url="http://test") as ac:
        r = await ac.get("/api/ready")
    assert r.status_code == 200, "flow-worker deploy would fail its healthcheck"
