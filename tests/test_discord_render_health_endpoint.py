"""GET /api/discord/render-health — the read path for V2 health until /renderhealth is registered.

The properties that matter: it is gated; with V2 off it neither starts the runtime nor creates the
jobs database (a health check with side effects is not read-only); and an unreachable renderer is
reported as not ready, never as healthy."""
from __future__ import annotations

import os

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.services.discord_render import commands
from api.services.discord_render.jobs_store import JobsStore


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    monkeypatch.setenv("DISCORD_RENDER_DB_PATH", str(tmp_path / "jobs.db"))
    monkeypatch.delenv("DISCORD_RENDER_V2_ENABLED", raising=False)
    monkeypatch.delenv("CHART_RENDERER_URL", raising=False)
    monkeypatch.setattr(commands, "_runtime", None)
    from api.routers import discord_interactions as rt
    app = FastAPI()
    app.include_router(rt.router)
    return TestClient(app), tmp_path, rt


def _get(tc, token="s3cret"):
    headers = {"authorization": f"Bearer {token}"} if token else {}
    return tc.get("/api/discord/render-health", headers=headers)


def test_it_refuses_without_the_bearer(client):
    tc, _, _ = client
    assert _get(tc, token=None).status_code == 401
    assert _get(tc, token="wrong").status_code == 401


def test_with_v2_off_it_reports_so_and_creates_no_database(client, monkeypatch):
    tc, tmp, _ = client
    monkeypatch.setattr(commands, "get_runtime", lambda: (_ for _ in ()).throw(AssertionError("health must not start V2")))
    body = _get(tc).json()
    assert body["v2_enabled"] is False and body["runtime_started"] is False and body["slo"] is None
    assert not os.path.exists(tmp / "jobs.db"), "a read-only health check created the jobs database"


def test_with_a_database_it_returns_slo_queue_and_alerts(client):
    tc, tmp, _ = client
    s = JobsStore(str(tmp / "jobs.db"))
    s.insert({"corr_id": "00000001", "command": "chart", "state": "queued", "token": "T", "app_id": "A"})
    s.claim("00000001", "pod", 60)
    s.finish("00000001", "delivered", owner="pod", ack_ms=40.0, final_ms=2100.0, quality="image")
    s.close()
    body = _get(tc).json()
    assert body["slo"]["windows"]["1h"]["all"]["delivered"] == 1
    assert body["queue"] is None and body["alerts"] == []


def test_an_unreachable_renderer_is_not_ready(client, monkeypatch):
    tc, _, rt = client
    monkeypatch.setenv("CHART_RENDERER_URL", "http://chart-renderer.invalid:8080")

    def boom(*a, **k):
        raise httpx.ConnectError("no route")
    monkeypatch.setattr(httpx, "get", boom)
    assert rt._renderer_health() == {"reachable": False, "ready": False, "error": "ConnectError"}


def test_a_healthy_renderer_answer_is_passed_through(client, monkeypatch):
    _, _, rt = client
    monkeypatch.setenv("CHART_RENDERER_URL", "http://chart-renderer.test:8080")
    monkeypatch.setattr(httpx, "get", lambda *a, **k: httpx.Response(200, json={"ok": True, "browser": True}))
    h = rt._renderer_health()
    assert h["reachable"] is True and h["ready"] is True and h["status"] == 200
