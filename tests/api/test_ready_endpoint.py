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


@pytest.mark.asyncio
async def test_ready_answers_with_json_not_the_spa_catch_all(fresh_gate):
    """GUARD against a gate that cannot fail.

    Observed in production 2026-07-26: on an image WITHOUT this route, GET
    /api/ready returns `200 text/html` -- the SPA catch-all serves index.html
    for the unknown path (same class as
    lesson_dashboard_root_public_files_need_explicit_route). Railway's
    healthcheck would read that as a healthy pod, so if the readiness route ever
    stopped being registered the gate would silently become inert while
    APPEARING to pass. Assert we get real JSON from the real handler.
    """
    fresh_gate.register("hot_tier")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        r = await ac.get("/api/ready")
    assert "application/json" in r.headers.get("content-type", ""), (
        "readiness answered with non-JSON — the SPA catch-all is shadowing the route"
    )
    assert set(r.json()) >= {"ready", "pending", "deadline_exceeded"}


def test_railway_healthcheck_must_not_gate_on_readiness():
    """REGRESSION GUARD -- do NOT point healthcheckPath at /api/ready.

    Tried in production 2026-07-26 (deploy 650865d5) and it caused a ~3 MINUTE
    OUTAGE. The premise was that Railway keeps the OLD pod serving while the new
    one healthchecks. It does not -- the old pod is already gone, so a
    503-until-warm readiness probe does not "hold traffic on the warm pod", it
    takes the site DOWN until the gate releases:

        Path: /api/ready
        Attempt #1..#8 failed with service unavailable
        -> https://uctintelligence.com/ returned 502 for ~3 min

    That is strictly worse than the cold-cache slowness it was meant to fix
    (slow-but-serving beats hard-down). /api/ready remains mounted as
    OBSERVABILITY -- it is genuinely useful for "is this pod warm yet" -- but
    nothing may gate a deploy on it.
    """
    root = os.path.join(os.path.dirname(__file__), "..", "..")
    with open(os.path.join(root, "railway.json")) as f:
        cfg = json.load(f)
    assert cfg["deploy"]["healthcheckPath"] == "/api/health", (
        "gating the Railway healthcheck on readiness causes a multi-minute "
        "outage on every deploy — see this test's docstring"
    )


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
