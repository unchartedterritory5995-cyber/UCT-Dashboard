"""POST /api/auth/admin/maintenance flips the RUNNING app's `_MAINTENANCE_MODE` (review M-3).

Since 2026-10-23 the toggle reads `sys.modules["api.main"]` instead of importing it (so auth no
longer puts every router on its import graph). These rails pin both halves: with the app loaded
the flag flips and the maintenance middleware answers 503 on a member path; with no app loaded in
the process the toggle answers 503 instead of silently flipping a flag no middleware reads."""
from __future__ import annotations

import sys

import pytest
from fastapi.testclient import TestClient

import api.main as main_module
from api.middleware.auth_middleware import get_current_user
from api.routers import auth as auth_router

ADMIN = {"id": "admin-1", "role": "admin", "email": "a@example.test"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main_module, "_MAINTENANCE_MODE", False)
    monkeypatch.setattr(auth_router, "log_activity", lambda *a, **k: None)
    main_module.app.dependency_overrides[get_current_user] = lambda: dict(ADMIN)
    try:
        yield TestClient(main_module.app)       # no `with`: the lifespan (schedulers) never runs
    finally:
        main_module.app.dependency_overrides.pop(get_current_user, None)


def test_the_toggle_flips_the_running_apps_flag_and_the_middleware_obeys(client):
    r = client.post("/api/auth/admin/maintenance", json={"enabled": True})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "maintenance": True}
    assert main_module._MAINTENANCE_MODE is True
    gated = client.get("/api/no-such-member-path")
    assert gated.status_code == 503 and gated.json()["maintenance"] is True
    r = client.post("/api/auth/admin/maintenance", json={"enabled": False})
    assert r.status_code == 200 and main_module._MAINTENANCE_MODE is False
    assert client.get("/api/no-such-member-path").status_code != 503   # control: the gate lifts


def test_without_a_loaded_app_the_toggle_answers_503_and_builds_nothing(client, monkeypatch):
    monkeypatch.delitem(sys.modules, "api.main")
    r = client.post("/api/auth/admin/maintenance", json={"enabled": True})
    assert r.status_code == 503, r.text
    assert "not available" in r.json()["detail"]
    assert "api.main" not in sys.modules              # asking never imported (built) the app
    assert main_module._MAINTENANCE_MODE is False


def test_a_member_cannot_toggle(client):
    main_module.app.dependency_overrides[get_current_user] = lambda: {"id": "m1", "role": "member"}
    r = client.post("/api/auth/admin/maintenance", json={"enabled": True})
    assert r.status_code == 403 and main_module._MAINTENANCE_MODE is False
