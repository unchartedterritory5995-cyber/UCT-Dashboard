"""Evals routes and migrations on the app the product serves (stream S-E).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. an evals migration the registry does not apply, or applies before the base contract.
2. an evals route unmounted, or reachable by an anonymous caller or a non-admin member.
3. an on-demand run executed on the request path, or not a dry run by default.
"""
from __future__ import annotations

import json
import time

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import store


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    path = tmp_path / "wisdom.db"
    monkeypatch.setenv("WISDOM_DB_PATH", str(path))
    store.init_db()
    return path


def test_the_evals_migrations_apply_after_the_base_contract(wisdom_db):
    names = [name for name, _sql in registry.schema_migrations()]
    assert names.index("core_001_base_v0") < names.index("evals_001_replay_hits") \
        < names.index("evals_002_replay_checks") < names.index("evals_003_outcome_horizons")
    with store.read() as conn:
        tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        outcome_cols = {r[1] for r in conn.execute("PRAGMA table_info(wisdom_outcomes)")}
    assert {"wisdom_replay_hits", "wisdom_replay_checks"} <= tables
    assert "horizons_json" in outcome_cols
    assert store.init_db() == []


@pytest.fixture(scope="module")
def real_app():
    from api.main import app

    return app


ROUTES = ("/api/admin/wisdom/evals/metrics", "/api/admin/wisdom/evals/outcomes/{record_id}",
          "/api/admin/wisdom/evals/run", "/api/admin/wisdom/evals/run/last")


def test_the_evals_routes_are_mounted_and_admin_gated_on_the_real_app(real_app, wisdom_db, monkeypatch):
    from fastapi.testclient import TestClient

    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from api.services.wisdom.evals import pipeline
    from tests.authclients import ADMIN, FREE_MEMBER, signed_in_as

    ran: list = []
    monkeypatch.setattr(pipeline, "run_daily", lambda ctx: ran.append((ctx.dry_run, ctx.force)) or {"stub": True})
    assert set(ROUTES) <= {getattr(r, "path", "") for r in real_app.routes}
    for dep in (get_current_user, get_current_user_with_plan):
        real_app.dependency_overrides.pop(dep, None)
    client = TestClient(real_app, raise_server_exceptions=False)

    assert client.get("/api/admin/wisdom/evals/metrics").status_code == 401
    assert client.post("/api/admin/wisdom/evals/run").status_code == 401
    with signed_in_as(FREE_MEMBER, real_app):
        assert client.get("/api/admin/wisdom/evals/metrics").status_code == 403
        assert client.get("/api/admin/wisdom/evals/outcomes/r1").status_code == 403
        assert client.post("/api/admin/wisdom/evals/run").status_code == 403
        assert client.get("/api/admin/wisdom/evals/run/last").status_code == 403
    assert ran == []

    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_metrics (metric_run_id, metric, slice_json, numerator, denominator, value, "
                     "method_version, computed_at, notes) VALUES ('m1', 'uct_see_rate_any', '{\"status\": "
                     "\"combined\"}', 0, 0, NULL, 'metrics-v1', '2026-09-14T19:00:00-04:00', '{}')")
        conn.execute("INSERT INTO wisdom_outcomes (record_id, methodology_version, computed_at, horizons_json) "
                     "VALUES ('r1', 'outcomes-v1', 't', ?)", (json.dumps({"first_hit": "target"}),))
    with signed_in_as(ADMIN, real_app):
        body = client.get("/api/admin/wisdom/evals/metrics").json()
        assert body["count"] == 1 and body["metrics"][0]["display"] == "0/0"
        assert client.get("/api/admin/wisdom/evals/outcomes/nope").status_code == 404
        outcome = client.get("/api/admin/wisdom/evals/outcomes/r1").json()
        assert outcome["outcomes"][0]["horizons"] == {"first_hit": "target"}
        started = client.post("/api/admin/wisdom/evals/run").json()
        assert started["started"] is True and started["dry_run"] is True and started["force"] is False
        deadline = time.time() + 10
        last = None
        while time.time() < deadline:
            last = client.get("/api/admin/wisdom/evals/run/last").json()
            if last["last"] is not None:
                break
            time.sleep(0.05)
        assert last["last"]["status"] == "ok" and last["last"]["result"] == {"stub": True}
    assert ran == [(True, False)]


def _job_runs():
    with store.read() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM wisdom_job_runs ORDER BY started_at")]


def _await_last(client, run_id, deadline_s=10):
    """Wait for THIS run's result. `_STATE['last']` is module-level and survives between
    tests, so polling for "not None" reads the PREVIOUS run's verdict and passes for the
    wrong reason — which is exactly how the first draft of this rail reported 'ok' for a
    run that raised."""
    deadline = time.time() + deadline_s
    while time.time() < deadline:
        last = client.get("/api/admin/wisdom/evals/run/last").json()["last"]
        if last is not None and last.get("run_id") == run_id:
            return last
        time.sleep(0.05)
    raise AssertionError(f"the on-demand run {run_id} never finished")


def test_an_on_demand_run_that_writes_records_a_job_run_row_and_a_dry_run_records_none(
        real_app, wisdom_db, monkeypatch):
    """🔴 The route calls pipeline.run_daily DIRECTLY, so registry._run_job's ledger row —
    which every SCHEDULED wisdom job gets — was never written. An admin-triggered WRITE that
    leaves no durable trace is unauditable: _STATE['last'] is per-process and dies with the pod.
    """
    from fastapi.testclient import TestClient

    from api.services.wisdom.evals import pipeline
    from tests.authclients import ADMIN, signed_in_as

    monkeypatch.setattr(pipeline, "run_daily", lambda ctx: {"stub": True})
    client = TestClient(real_app, raise_server_exceptions=False)

    with signed_in_as(ADMIN, real_app):
        # CONTROL FIRST: a dry run computes and must leave the ledger untouched.
        started = client.post("/api/admin/wisdom/evals/run?dry_run=true").json()
        assert _await_last(client, started["run_id"])["status"] == "ok"
        assert _job_runs() == []

        started = client.post("/api/admin/wisdom/evals/run?dry_run=false&force=true").json()
        last = _await_last(client, started["run_id"])
    assert last["dry_run"] is False and last["ledgered"] is True
    rows = _job_runs()
    assert len(rows) == 1, rows
    row = rows[0]
    assert (row["job_id"], row["status"], row["forced"], row["dry_run"]) == \
        ("wisdom_evals_on_demand", "ok", 1, 0)
    assert row["run_id"] == last["run_id"] and row["started_at"] and row["finished_at"]
    with store.read() as conn:
        beats = [dict(r) for r in conn.execute("SELECT * FROM wisdom_job_heartbeats")]
    assert [b["job_id"] for b in beats] == ["wisdom_evals_on_demand"]


def test_a_failed_on_demand_run_is_recorded_as_failed_not_left_running(real_app, wisdom_db, monkeypatch):
    """A ledger row stuck at 'running' forever is worse than none — it reads as in-flight."""
    from fastapi.testclient import TestClient

    from api.services.wisdom.evals import pipeline
    from tests.authclients import ADMIN, signed_in_as

    def boom(ctx):
        raise RuntimeError("step exploded")

    monkeypatch.setattr(pipeline, "run_daily", boom)
    client = TestClient(real_app, raise_server_exceptions=False)
    with signed_in_as(ADMIN, real_app):
        started = client.post("/api/admin/wisdom/evals/run?dry_run=false").json()
        last = _await_last(client, started["run_id"])
    assert last["status"] == "failed"
    rows = _job_runs()
    assert len(rows) == 1 and rows[0]["status"] == "failed"
    assert "step exploded" in (rows[0]["error"] or "")
