"""Task 7 — admin ops endpoints (router-level, minimal app).

Mounts ONLY api.routers.theme_engine on a bare FastAPI app (api.main is far too
heavy to import in tests) against the scratch-auth.db `store` fixture from
conftest. Auth is mocked the house way: app.dependency_overrides on the
router's require_admin (same approach as tests/test_admin_chart_health.py).
"""
import threading
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture()
def ops(store):
    """Minimal app mounting just the theme-engine router. Depends on `store`
    (conftest) so the router's module-level store reference — reload happens
    in place, same module object — hits the scratch auth.db."""
    from api.routers import theme_engine as te
    app = FastAPI()
    app.include_router(te.router)
    yield SimpleNamespace(te=te, app=app)
    app.dependency_overrides.clear()


@pytest.fixture()
def client_noauth(ops):
    return TestClient(ops.app)


@pytest.fixture()
def admin_client(ops):
    ops.app.dependency_overrides[ops.te.require_admin] = (
        lambda: {"id": "u-admin", "role": "admin", "email": "admin@test"})
    return TestClient(ops.app)


# ---------------------------------------------------------------- auth gating

@pytest.mark.parametrize("method,path", [
    ("get", "/api/theme-engine/status"),
    ("get", "/api/theme-engine/report"),
    ("post", "/api/theme-engine/rollback/abc123def456"),
    ("post", "/api/theme-engine/suppress/ai/SMCI/dismiss"),
    ("post", "/api/theme-engine/dry-run"),
    ("post", "/api/theme-engine/clear-decisions"),
])
def test_endpoints_require_admin(client_noauth, method, path):
    assert getattr(client_noauth, method)(path).status_code in (401, 403)


# ---------------------------------------------------------------- rollback

def test_rollback_endpoint_replays_and_reports(admin_client, store):
    r = store.start_run("orphan")
    store.upsert_add("ai", "SMCI", "peripheral", None, .9, "x", r)
    resp = admin_client.post(f"/api/theme-engine/rollback/{r}")
    assert resp.status_code == 200 and resp.json()["undone"]["add"] == 1
    assert store.engine_rows("ai") == []


# ---------------------------------------------------------------- clear-decisions

def test_clear_decisions_deletes_and_counts(admin_client, store):
    r = store.start_run("orphan_dry")
    store.record_decision("RKLB", "none", None, 0.0, r)
    store.record_decision("SMCI", "below_gate", "ai", 0.5, r)
    assert store.decided_recent_syms(35) == {"RKLB", "SMCI"}
    resp = admin_client.post("/api/theme-engine/clear-decisions")
    assert resp.status_code == 200 and resp.json()["deleted"] == 2
    # The REEVAL_DAYS skip-set is empty again — the first LIVE run examines a
    # full batch instead of 0 syms (the validation-dry-run ops trap).
    assert store.decided_recent_syms(35) == set()
    assert admin_client.post("/api/theme-engine/clear-decisions").json()["deleted"] == 0


# ---------------------------------------------------------------- status

def test_status_shape(admin_client, store):
    r = store.start_run("orphan")
    store.upsert_add("ai", "SMCI", "peripheral", None, .9, "x", r)
    store.suppress_propose("ai", "NVDA", "off-theme?", r)
    store.finish_run(r, examined=3, added=1)
    body = admin_client.get("/api/theme-engine/status").json()
    assert body["pending_suppressions"] == 1
    assert body["overlay_adds"] == 1
    assert isinstance(body["day_cost_usd"], float)
    runs = body["runs"]
    assert len(runs) == 1
    assert runs[0]["run_id"] == r and runs[0]["examined"] == 3 and runs[0]["added"] == 1


def test_status_caps_recent_runs_at_20(admin_client, store):
    for _ in range(25):
        store.start_run("orphan")
    body = admin_client.get("/api/theme-engine/status").json()
    assert len(body["runs"]) == 20


# ---------------------------------------------------------------- report

def test_report_returns_weekly_text(admin_client, store):
    body = admin_client.get("/api/theme-engine/report").json()
    assert "THEME ENGINE" in body["text"]


# ---------------------------------------------------------------- suppress dismiss

def test_suppress_dismiss_clears_pending(admin_client, store):
    r = store.start_run("improve")
    store.suppress_propose("ai", "NVDA", "concern", r)
    assert len(store.pending_suppressions()) == 1
    resp = admin_client.post("/api/theme-engine/suppress/ai/NVDA/dismiss")
    assert resp.status_code == 200
    assert store.pending_suppressions() == []


# ---------------------------------------------------------------- dry-run

def test_dry_run_starts_background_thread(admin_client, ops, monkeypatch):
    done = threading.Event()
    calls = {}

    def fake(batch=None, dry_run=None):
        calls.update(batch=batch, dry_run=dry_run)
        done.set()
        return {"run_id": "x"}

    monkeypatch.setattr(ops.te.orphans, "run_orphan_batch", fake)
    resp = admin_client.post("/api/theme-engine/dry-run?batch=7")
    assert resp.status_code == 200
    assert resp.json() == {"started": True, "run_id": None}
    assert done.wait(5), "background dry-run thread never ran"
    assert calls == {"batch": 7, "dry_run": True}
