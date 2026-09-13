"""Wisdom capture admin routes on the REAL app — mounted, gated, admin-only, off the request path.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a capture route that is not mounted on api.main:app (the registry logs and
   continues when a router fails to import);
2. a capture route answering an anonymous caller or a free member;
3. an on-demand capture that runs on the request thread, runs twice at once, or
   defaults to a real (non-dry) write;
4. the health table not listing every registered dataset with its ``n``.
"""
from __future__ import annotations

import time

import pytest

from api.services.wisdom.capture import families, runner
from api.services.wisdom.core import store


@pytest.fixture(scope="module")
def real_app():
    from api.main import app

    return app


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "wisdom.db"))
    store.init_db()


def test_the_capture_routes_are_mounted_gated_and_dry_by_default(real_app, wisdom_db, monkeypatch):
    import threading

    from fastapi.testclient import TestClient

    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.routers import wisdom_capture
    from tests.authclients import ADMIN, FREE_MEMBER, signed_in_as

    started: list = []
    monkeypatch.setattr(runner, "run_family",
                        lambda name, **kw: started.append((name, kw, threading.current_thread().name)) or {})
    paths = {getattr(r, "path", "") for r in real_app.routes}
    assert {"/api/admin/wisdom/capture/health", "/api/admin/wisdom/capture/runs",
            "/api/admin/wisdom/capture/run-family/{family}"} <= paths
    for dep in (get_current_user, get_current_user_with_plan):
        real_app.dependency_overrides.pop(dep, None)
    client = TestClient(real_app, raise_server_exceptions=False)

    assert client.get("/api/admin/wisdom/capture/health").status_code == 401
    assert client.post("/api/admin/wisdom/capture/run-family/wire").status_code == 401
    with signed_in_as(FREE_MEMBER, real_app):
        assert client.get("/api/admin/wisdom/capture/health").status_code == 403
        assert client.get("/api/admin/wisdom/capture/runs").status_code == 403
        assert client.post("/api/admin/wisdom/capture/run-family/wire").status_code == 403
    assert started == []

    with signed_in_as(ADMIN, real_app):
        body = client.get("/api/admin/wisdom/capture/health").json()
        assert [d["dataset"] for d in body["datasets"]] == [ds.name for ds in families.DATASETS]
        assert all("n" in d for d in body["datasets"])
        assert client.get("/api/admin/wisdom/capture/runs?dataset=wire").json() == {"runs": [], "count": 0}
        assert client.post("/api/admin/wisdom/capture/run-family/not_a_dataset").status_code == 404
        assert client.post("/api/admin/wisdom/capture/run-family/wire?as_of=14-09-2026").status_code == 422
        ok = client.post("/api/admin/wisdom/capture/run-family/wire")
        assert ok.status_code == 200 and ok.json() == {"started": True, "family": "wire", "dry_run": True, "as_of": None}
        deadline = time.time() + 5
        while not started and time.time() < deadline:
            time.sleep(0.02)
        assert started and started[0][:2] == ("wire", {"as_of": None, "dry_run": True})
        assert started[0][2] == "wisdom-capture-wire", "the capture must run on its own daemon thread"

        with wisdom_capture._RUNNING_LOCK:
            wisdom_capture._RUNNING.add("rs")
        try:
            assert client.post("/api/admin/wisdom/capture/run-family/rs").status_code == 409
        finally:
            with wisdom_capture._RUNNING_LOCK:
                wisdom_capture._RUNNING.discard("rs")
