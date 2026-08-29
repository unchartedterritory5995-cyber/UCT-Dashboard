"""`/api/ready` — OBSERVABILITY. ⛔ Railway does NOT gate traffic on it.

⚰️ This docstring used to open "the readiness healthcheck Railway gates traffic
on" — inside the very file whose `test_railway_healthcheck_must_not_gate_on_readiness`
forbids exactly that. It was the FIFTH copy of a claim that was false everywhere
(`api/main.py`, `api/services/readiness.py`, `api/worker_main.py`,
`api/flow_worker_main.py`, here). Gating the healthcheck on readiness caused a
~3 min outage on 2026-07-26; see that test's docstring for the incident.

⭐ Five files asserting one unverified sentence is not five confirmations — it is
one guess with five copies, and it reads as consensus. That is why
`test_no_source_file_claims_the_healthcheck_gates_on_readiness` below pins the
PROSE as well as the value: the config guard alone did not stop an engineer from
"fixing" the config to match the comments and reproducing the outage.

These cover the HTTP surface and, critically, the fact that railway.json is
SHARED by web + worker + flow-worker: all three serve /api/ready anyway, so a
future healthcheckPath change can never fail a service for a missing route.
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


# RAIL-SELF-EXEMPT-BELOW  (the matcher below quotes the forbidden sentence)
def test_no_source_file_claims_the_healthcheck_gates_on_readiness():
    """The PROSE guard, beside the value guard above.

    `test_railway_healthcheck_must_not_gate_on_readiness` pins the config. It did
    NOT stop the config from being changed, because five files said the wiring
    already existed and an engineer trusted the majority over the JSON. A stale
    claim here is not cosmetic: acting on it reproduces a multi-minute outage.

    So: no source file may assert that healthcheckPath points at the readiness
    route. Saying it does NOT (as every one of those files now does) is fine —
    the check is scoped to affirmative claims.
    """
    import pathlib
    import re

    root = pathlib.Path(__file__).resolve().parents[2]
    targets = [
        root / "api" / "main.py",
        root / "api" / "services" / "readiness.py",
        root / "api" / "worker_main.py",
        root / "api" / "flow_worker_main.py",
        pathlib.Path(__file__).resolve(),
    ]
    # "points healthcheckPath at /api/ready", "healthcheckPath ... /api/ready",
    # "/api/ready (the new healthcheckPath)", "railway.json healthcheckPath) stays"
    claim = re.compile(
        r"(healthcheckPath[^\n]{0,60}/api/ready)"
        r"|(/api/ready[^\n]{0,40}healthcheckPath)"
        r"|(railway\.json[^\n]{0,40}points here)",
        re.IGNORECASE,
    )
    # Sentences that explicitly DENY the wiring are the correction, not the defect.
    denial = re.compile(r"do(es)? NOT|must not|never|⚰️|used to (read|say|open)", re.IGNORECASE)

    # This file states the forbidden sentence on purpose (the patterns above), so
    # it scans only itself UP TO the sentinel — its docstring stays covered, which
    # is what actually drifted, while the matcher does not flag its own source.
    sentinel = "RAIL" + "-SELF-EXEMPT-BELOW"

    offenders = []
    for path in targets:
        lines = path.read_text(encoding="utf-8").splitlines()
        if path == pathlib.Path(__file__).resolve():
            cut = next((i for i, l in enumerate(lines) if sentinel in l), len(lines))
            lines = lines[:cut]
        # ⚠️ MATCH OVER A SLIDING WINDOW, NOT SINGLE LINES. The real historical
        # sentence WRAPPED: "…points healthcheckPath" ended one comment line and
        # "at /api/ready." began the next, so a line-at-a-time regex never saw
        # both halves and read green against the very defect it exists to catch.
        # (Caught by mutation-testing this rail — the line-based version survived
        # having the original comment pasted back in.)
        WINDOW = 3
        for i in range(len(lines)):
            window = " ".join(l.lstrip(" #").rstrip() for l in lines[i:i + WINDOW])
            if claim.search(window) and not denial.search(window):
                offenders.append(f"{path.relative_to(root)}:{i + 1}: {lines[i].strip()[:100]}")

    assert not offenders, (
        "a source file asserts the Railway healthcheck points at /api/ready. It "
        "does not, and pointing it there caused a ~3 min outage on 2026-07-26. "
        "Correct the sentence (or phrase it as a denial):\n  " + "\n  ".join(offenders)
    )
