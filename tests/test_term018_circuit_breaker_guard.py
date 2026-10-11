"""TERM-018 / G-10: the per-source circuit breaker's degraded alert, fired THROUGH A
ROUTE.

`source_circuit_breaker.state` decides, on a source's FIRST transition into
`degraded` (at least `_MIN_ATTEMPTS` attempts in the rolling window and a pass rate
under `_PASS_RATE_THRESHOLD`), to raise ONE `warning` keyed by the source. It is
reached from many callers (bars_fetch's validation chain calls `is_ok` per source per
fetch); the wire recorded for TERM-018 is the one a single call carries:
`GET /api/admin/bars/source-health` -> `source_circuit_breaker.all_states()` ->
`state()`. These tests mount the same `admin_chart_health.router` object
`api/main.py` includes and GET it as an admin. Only the admin dependency, the page's
unrelated bar-provenance count and the sink are replaced; the attempt window, the threshold and the transition memo are real.

CONTROLS: a window below the attempt floor, a healthy window, and a source already
degraded (the transition fired once) each raise nothing.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import api.routers.admin_chart_health as admin_chart_health
from api.middleware.auth_middleware import require_admin
from api.services import chart_health_alerts, source_circuit_breaker

SRC = "term018_probe_source"


@pytest.fixture(autouse=True)
def _clean_breaker():
    source_circuit_breaker._reset()
    yield
    source_circuit_breaker._reset()


@pytest.fixture
def alerts(monkeypatch):
    seen: list[tuple[str, str]] = []

    def emit(key, severity, message=None, metadata=None, **kw):
        seen.append((key, severity))
        return True

    monkeypatch.setattr(chart_health_alerts, "emit", emit)
    return seen


@pytest.fixture
def client(monkeypatch):
    # the page's OTHER half (per-source bar counts) reads a provenance DB the sandbox
    # does not create; it does not touch the breaker, so it is the one thing replaced
    monkeypatch.setattr(admin_chart_health.bar_provenance, "count_by_source", lambda: {})
    app = FastAPI()
    app.include_router(admin_chart_health.router)
    app.dependency_overrides[require_admin] = lambda: {"id": 1, "role": "admin"}
    return TestClient(app)


def _attempts(n_fail: int, n_ok: int = 0) -> None:
    for _ in range(n_ok):
        source_circuit_breaker.record_attempt(SRC, True)
    for _ in range(n_fail):
        source_circuit_breaker.record_attempt(SRC, False)


def _health(client) -> dict:
    r = client.get("/api/admin/bars/source-health")
    assert r.status_code == 200, r.text
    return r.json()["sources"][SRC]


def test_a_source_that_falls_below_the_pass_rate_raises_one_warning(client, alerts):
    _attempts(n_fail=source_circuit_breaker._MIN_ATTEMPTS)
    assert _health(client)["state"] == "degraded"
    assert alerts == [(f"source_degraded:{SRC}", "warning")]


def test_CONTROL_a_window_below_the_attempt_floor_raises_nothing(client, alerts):
    _attempts(n_fail=source_circuit_breaker._MIN_ATTEMPTS - 1)
    assert _health(client)["state"] == "ok"
    assert alerts == []


def test_CONTROL_a_healthy_window_raises_nothing(client, alerts):
    _attempts(n_fail=0, n_ok=source_circuit_breaker._MIN_ATTEMPTS)
    assert _health(client)["state"] == "ok"
    assert alerts == []


def test_CONTROL_a_source_already_degraded_does_not_raise_again(client, alerts):
    _attempts(n_fail=source_circuit_breaker._MIN_ATTEMPTS)
    _health(client)
    _health(client)
    assert alerts == [(f"source_degraded:{SRC}", "warning")]
