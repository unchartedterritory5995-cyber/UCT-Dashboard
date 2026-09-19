"""Wisdom Loop Wave 1 skeleton rails (docs/wisdom/CONTRACTS.md §2).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a package whose jobs, migrations or routes the registry cannot import. The
   registry logs and continues at boot, so only this file makes that loud.
2. a job registered without Eastern time, coalesce, misfire grace or a single instance.
3. a job that runs while a switch is off, runs twice for one slot, or raises into
   the scheduler thread.
4. a swallowed cron slot that catch-up does not run, runs twice, or steals from
   the scheduler.
5. a watchdog that stays silent on an overdue job, or pages every tick.
6. an R2 write that overwrites, or leaves the wisdom/ prefix.
7. a gate that is not read by its literal name or not declared dark.
8. a second admin passing the owner gate.
9. the registry unplugged from api/main.py, or its routes unmounted or ungated
   on the app the product serves.
"""
from __future__ import annotations

import ast
import importlib
import inspect
import json
import pathlib
import re
import time
from datetime import datetime, timedelta

import pytest

from api.services.wisdom import registry
from api.services.wisdom.core import authors, flags, heartbeat, r2, store, timeutil

REPO = pathlib.Path(__file__).resolve().parents[1]
ET = timeutil.ET


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    path = tmp_path / "wisdom.db"
    monkeypatch.setenv("WISDOM_DB_PATH", str(path))
    store.init_db()
    return path


@pytest.fixture
def pages(monkeypatch):
    sent: list = []
    from api.services import chart_health_alerts

    def _emit(key, severity, message, metadata=None):
        sent.append((key, severity, message))
        return True

    monkeypatch.setattr(chart_health_alerts, "emit", _emit)
    return sent


def _only(monkeypatch, *specs):
    monkeypatch.setattr(registry, "job_specs", lambda: list(specs))


def _spec(fn, **overrides):
    fields = dict(job_id="wisdom_test_job", fn=fn, trigger={"kind": "interval", "seconds": 300},
                  enabled=lambda: True, expected_every_s=300)
    fields.update(overrides)
    return registry.JobSpec(**fields)


class _FakeScheduler:
    def __init__(self):
        self.calls: list = []

    def add_job(self, fn, **kwargs):
        self.calls.append((fn, kwargs))


# ── 1-2. discovery and registration ─────────────────────────────────────────

def test_every_package_contributes_through_the_registry():
    for pkg in registry.PACKAGES:
        jobs = importlib.import_module(f"api.services.wisdom.{pkg}.jobs")
        schema = importlib.import_module(f"api.services.wisdom.{pkg}.schema")
        router_mod = importlib.import_module(f"api.routers.wisdom_{pkg}")
        assert isinstance(jobs.JOBS, list), pkg
        assert all(name.startswith(f"{pkg}_") for name, _ in schema.MIGRATIONS), pkg
        assert router_mod.router.prefix == f"/api/admin/wisdom/{pkg}", pkg
    # non-vacuity: core contributes real jobs, the base migration and real routes
    assert {"wisdom_core_catchup", "wisdom_core_watchdog"} <= {s.job_id for s in registry.job_specs()}
    assert registry.schema_migrations()[0][0] == "core_001_base_v0"
    assert any(r.prefix == "/api/admin/wisdom/core" and r.routes for r in registry.routers())


def test_job_specs_are_unique_prefixed_and_killed_by_a_declared_gate():
    readers = {reader for _, reader, _ in flags.GATES}
    specs = registry.job_specs()
    assert len({s.job_id for s in specs}) == len(specs)
    for spec in specs:
        assert spec.job_id.startswith("wisdom_"), spec.job_id
        assert spec.enabled in readers, spec.job_id
        assert spec.trigger.get("kind") in ("cron", "interval"), spec.job_id
        assert spec.expected_every_s > 0, spec.job_id


def test_register_jobs_pins_eastern_time_grace_coalesce_and_single_instance():
    sched = _FakeScheduler()
    ids = registry.register_jobs(sched)
    assert ids and len(ids) == len(sched.calls)
    for fn, kw in sched.calls:
        assert fn is registry.run_job
        assert kw["args"] == [kw["id"]]
        assert str(kw["trigger"].timezone) == "America/New_York", kw["id"]
        assert kw["max_instances"] == 1 and kw["coalesce"] is True and kw["replace_existing"] is True
        assert kw["misfire_grace_time"] in (60, 3600)


def test_a_cron_job_fires_at_its_eastern_minute(monkeypatch):
    _only(monkeypatch, _spec(lambda ctx: {}, job_id="wisdom_test_cron",
                             trigger={"kind": "cron", "day_of_week": "mon-fri", "hour": 16, "minute": 52},
                             expected_every_s=86400))
    sched = _FakeScheduler()
    assert registry.register_jobs(sched) == ["wisdom_test_cron"]
    kw = sched.calls[0][1]
    assert kw["misfire_grace_time"] == 3600
    fire = kw["trigger"].get_next_fire_time(None, datetime(2026, 9, 14, 12, 0, tzinfo=ET))
    assert (fire.hour, fire.minute, str(fire.tzinfo)) == (16, 52, "America/New_York")


def test_init_db_creates_every_contract_table_and_is_idempotent(tmp_path, monkeypatch):
    sql = (REPO / "docs" / "wisdom" / "contracts" / "wisdom-db-v0.sql").read_text(encoding="utf-8")
    code = "\n".join(line.split("--", 1)[0] for line in sql.splitlines())
    expected = set(re.findall(r"CREATE TABLE IF NOT EXISTS (\w+)", code))
    # non-vacuity: the parse sees real tables and skips the commented private store
    assert {"wisdom_records", "wisdom_job_claims"} <= expected
    assert "wisdom_private_positions" not in expected
    monkeypatch.setenv("WISDOM_DB_PATH", str(tmp_path / "w.db"))
    assert "core_001_base_v0" in store.init_db()
    with store.read() as conn:
        have = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert not expected - have
    assert store.init_db() == []


# ── 3. running ───────────────────────────────────────────────────────────────

def test_a_job_does_not_run_while_the_master_switch_is_off(wisdom_db, monkeypatch):
    monkeypatch.delenv("WISDOM_INGEST_ENABLED", raising=False)
    calls: list = []
    _only(monkeypatch, _spec(lambda ctx: calls.append(ctx) or {}))
    out = registry.run_job("wisdom_test_job")
    assert out["status"] == "skipped" and calls == []
    with store.read() as conn:
        hb = conn.execute("SELECT last_status, last_ok_at FROM wisdom_job_heartbeats").fetchone()
    assert hb["last_status"] == "skipped" and hb["last_ok_at"] is None


def test_the_job_kill_switch_holds_with_the_master_switch_on(wisdom_db, monkeypatch):
    monkeypatch.setenv("WISDOM_INGEST_ENABLED", "1")
    calls: list = []
    _only(monkeypatch, _spec(lambda ctx: calls.append(1) or {}, enabled=lambda: False))
    assert registry.run_job("wisdom_test_job")["status"] == "skipped"
    assert calls == []
    # control: the same job with its switch on does run
    _only(monkeypatch, _spec(lambda ctx: calls.append(1) or {}))
    assert registry.run_job("wisdom_test_job")["status"] == "ok" and calls == [1]


def test_one_due_key_runs_once_even_when_forced_twice(wisdom_db, monkeypatch):
    calls: list = []
    _only(monkeypatch, _spec(lambda ctx: calls.append(ctx.due_key) or {"n": 1}, due_key=lambda now: "2026-09-14"))
    first = registry.run_job("wisdom_test_job", force=True)
    second = registry.run_job("wisdom_test_job", force=True)
    assert first["status"] == "ok" and second["status"] == "skipped"
    assert calls == ["2026-09-14"]
    with store.read() as conn:
        claim = conn.execute("SELECT status FROM wisdom_job_claims").fetchone()
        runs = conn.execute("SELECT COUNT(*) FROM wisdom_job_runs").fetchone()[0]
    assert claim["status"] == "ok" and runs == 1


def test_a_failing_job_is_recorded_paged_and_never_raises(wisdom_db, monkeypatch, pages):
    def boom(ctx):
        raise RuntimeError("kaboom")

    _only(monkeypatch, _spec(boom))
    out = registry.run_job("wisdom_test_job", force=True)
    assert out["status"] == "failed" and "kaboom" in out["error"]
    with store.read() as conn:
        run = conn.execute("SELECT status, error FROM wisdom_job_runs").fetchone()
        hb = conn.execute("SELECT consecutive_failures, last_ok_at FROM wisdom_job_heartbeats").fetchone()
    assert run["status"] == "failed" and "kaboom" in run["error"]
    assert hb["consecutive_failures"] == 1 and hb["last_ok_at"] is None
    assert [(k, s) for k, s, _ in pages] == [("wisdom_job_failed:wisdom_test_job", "critical")]


def test_a_dry_run_neither_claims_the_slot_nor_counts_as_healthy(wisdom_db, monkeypatch):
    _only(monkeypatch, _spec(lambda ctx: {"dry": ctx.dry_run}, due_key=lambda now: "k"))
    out = registry.run_job("wisdom_test_job", force=True, dry_run=True)
    assert out["status"] == "ok" and out["result"]["dry"] is True
    with store.read() as conn:
        assert conn.execute("SELECT COUNT(*) FROM wisdom_job_claims").fetchone()[0] == 0
        assert conn.execute("SELECT COUNT(*) FROM wisdom_job_heartbeats").fetchone()[0] == 0
    assert registry.run_job("wisdom_test_job", force=True)["status"] == "ok"


# ── 4. catch-up ──────────────────────────────────────────────────────────────

def _cron_spec(calls):
    return _spec(lambda ctx: calls.append(ctx.due_key) or {},
                 trigger={"kind": "cron", "day_of_week": "mon-fri", "hour": 16, "minute": 52},
                 due_key=lambda now: now.date().isoformat(), catch_up_grace_s=6 * 3600,
                 expected_every_s=86400)


def test_catch_up_runs_a_swallowed_cron_slot_exactly_once(wisdom_db, monkeypatch):
    monkeypatch.setenv("WISDOM_INGEST_ENABLED", "1")
    calls: list = []
    _only(monkeypatch, _cron_spec(calls))
    now = datetime(2026, 9, 14, 17, 30, tzinfo=ET)
    first = registry.catch_up(now)
    second = registry.catch_up(now + timedelta(minutes=5))
    assert calls == ["2026-09-14"]
    assert [r["status"] for r in first["ran"]] == ["ok"] and second["ran"] == []


def test_catch_up_leaves_a_fresh_slot_to_the_scheduler(wisdom_db, monkeypatch):
    monkeypatch.setenv("WISDOM_INGEST_ENABLED", "1")
    calls: list = []
    _only(monkeypatch, _cron_spec(calls))
    assert registry.catch_up(datetime(2026, 9, 14, 16, 53, tzinfo=ET))["ran"] == []
    assert registry.catch_up(datetime(2026, 9, 14, 23, 30, tzinfo=ET))["ran"] == []  # past its grace
    assert calls == []


# ── 5. watchdog ──────────────────────────────────────────────────────────────

def test_the_watchdog_pages_an_overdue_job_once_per_episode(wisdom_db, monkeypatch, pages):
    monkeypatch.setenv("WISDOM_INGEST_ENABLED", "1")
    monkeypatch.setattr(registry, "_BOOT_WALL", time.time() - 10 * 86400)
    _only(monkeypatch, _spec(lambda ctx: {}, expected_every_s=300))
    now = timeutil.now_et()
    with store.write() as conn:
        heartbeat.beat(conn, "wisdom_test_job", "ok", now_iso=timeutil.iso_et(now - timedelta(hours=1)))
    assert registry.watchdog(now)["paged"] == ["wisdom_test_job"]
    assert registry.watchdog(now)["paged"] == []
    assert [k for k, _, _ in pages] == ["wisdom_job_missed:wisdom_test_job"]
    with store.write() as conn:
        heartbeat.beat(conn, "wisdom_test_job", "ok", now_iso=timeutil.iso_et(now))
    assert registry.watchdog(now)["overdue"] == []


# ── 6. R2 ────────────────────────────────────────────────────────────────────

class _FakeR2:
    def __init__(self):
        self.objects: dict = {}

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"Metadata": {"sha256": self.objects[Key][1]}}

    def put_object(self, Bucket, Key, Body, ContentType, Metadata):
        assert Key not in self.objects, "overwrite attempted"
        self.objects[Key] = (Body, Metadata["sha256"])


def test_r2_writes_are_immutable_and_confined_to_the_wisdom_prefix(monkeypatch):
    fake = _FakeR2()
    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (fake, "bucket"))
    key = "wisdom/context/2026-09-14/wire.json.gz"
    assert r2.put_immutable(key, b"abc", "application/gzip")["created"] is True
    assert r2.put_immutable(key, b"abc", "application/gzip")["created"] is False
    with pytest.raises(r2.R2ImmutableConflict):
        r2.put_immutable(key, b"different", "application/gzip")
    for bad in ("brain/latest.txt", "wisdom/../brain/x.tar.gz", "snapshots/1.tar.gz"):
        with pytest.raises(ValueError):
            r2.put_immutable(bad, b"x", "text/plain")
    assert not [n for n in dir(r2) if "delete" in n.lower() or "remove" in n.lower()]


# ── 7. authors and gates ─────────────────────────────────────────────────────

def test_exactly_six_call_authors_and_exact_alias_matching():
    # Was four; Jersace and AtTheAsk were added by owner ruling 2026-09-19 (session 28).
    assert authors.call_authors() == frozenset(
        {"tsdr", "bracco", "chartmaster", "manrav", "jersace", "attheask"})
    assert authors.author_for_alias("patrick (tsdr)") == "tsdr"
    assert authors.author_for_alias("Braczyy") == "bracco"
    assert authors.author_for_alias("Ravi") is None
    assert authors.author_for_alias("tsdr trading desk") is None
    assert authors.author_for_discord_user("1527044971553620088") is None
    assert authors.author_for_discord_user("339816805805588480") == "tsdr"
    assert {c["key"] for c in authors.in_scope_channels()} >= {"tsdr", "bracco", "chartmaster", "manrav"}


def test_every_gate_defaults_off_is_read_by_name_and_is_declared_dark(monkeypatch):
    ledger = json.loads((REPO / "docs" / "feature_flags.json").read_text(encoding="utf-8"))["flags"]
    envs = [env for env, _, _ in flags.GATES]
    assert len(envs) == len(set(envs))
    for env, reader, _visible in flags.GATES:
        assert f'"{env}"' in inspect.getsource(reader), env
        monkeypatch.delenv(env, raising=False)
        assert reader() is False, env
        monkeypatch.setenv(env, "1")
        assert reader() is True, env
        monkeypatch.delenv(env)
        entry = ledger.get(env)
        assert entry and entry["status"] == "dark" and len(entry["note"].strip()) >= 20, env
    readers = sorted(n for n, v in vars(flags).items() if callable(v) and n.endswith("_enabled"))
    assert readers == sorted(r.__name__ for _, r, _ in flags.GATES)


# ── 8. owner gate ────────────────────────────────────────────────────────────

def test_a_second_admin_is_not_the_owner(monkeypatch):
    from fastapi import HTTPException

    from api.services.wisdom.core import owner

    monkeypatch.setenv("ADMIN_EMAILS", "Owner@Example.test, second@example.test")
    assert owner.require_owner({"email": "owner@example.test", "role": "admin"})["role"] == "admin"
    with pytest.raises(HTTPException) as refused:
        owner.require_owner({"email": "second@example.test", "role": "admin"})
    assert refused.value.status_code == 403
    monkeypatch.setenv("ADMIN_EMAILS", "")
    with pytest.raises(HTTPException):
        owner.require_owner({"email": "owner@example.test", "role": "admin"})


# ── 9. wiring on the real app ────────────────────────────────────────────────

def test_main_py_wires_the_registry_at_boot_under_the_lock_and_at_mount():
    tree = ast.parse((REPO / "api" / "main.py").read_text(encoding="utf-8"))

    def attr_calls(node, name):
        return [n for n in ast.walk(node)
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == name]

    lifespan = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan")
    assert attr_calls(lifespan, "init_stores"), "wisdom.db is not initialised at boot"
    lock_blocks = [n for n in ast.walk(lifespan)
                   if isinstance(n, ast.If) and isinstance(n.test, ast.Call)
                   and getattr(n.test.func, "id", "") == "acquire_scheduler_lock"]
    assert lock_blocks
    registered = [c for block in lock_blocks for c in attr_calls(block, "register_jobs")]
    assert registered and getattr(registered[0].args[0], "id", "") == "_scheduler"
    # non-vacuity: the same walk sees the neighbour the call sits beside
    assert any(isinstance(c, ast.Call) and getattr(c.func, "id", "") == "register_screener_jobs"
               for block in lock_blocks for c in ast.walk(block))
    assert any(attr_calls(n.iter, "routers") for n in tree.body if isinstance(n, ast.For)), \
        "Wisdom routers are not mounted"


@pytest.fixture(scope="module")
def real_app():
    from api.main import app

    return app


def test_the_core_routes_are_mounted_on_the_real_app_and_gated(real_app, wisdom_db, monkeypatch):
    from fastapi.testclient import TestClient

    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan
    from tests.authclients import ADMIN, FREE_MEMBER, signed_in_as

    monkeypatch.setattr(registry, "run_job", lambda *a, **k: {"status": "stubbed"})
    paths = {getattr(r, "path", "") for r in real_app.routes}
    assert {"/api/admin/wisdom/core/status", "/api/admin/wisdom/core/runs",
            "/api/admin/wisdom/core/jobs/{job_id}/run"} <= paths
    for dep in (get_current_user, get_current_user_with_plan):
        real_app.dependency_overrides.pop(dep, None)
    client = TestClient(real_app, raise_server_exceptions=False)
    assert client.get("/api/admin/wisdom/core/status").status_code == 401
    with signed_in_as(FREE_MEMBER, real_app):
        assert client.get("/api/admin/wisdom/core/status").status_code == 403
        assert client.post("/api/admin/wisdom/core/jobs/wisdom_core_watchdog/run").status_code == 403
    with signed_in_as(ADMIN, real_app):
        body = client.get("/api/admin/wisdom/core/status").json()
        assert {"wisdom_core_catchup", "wisdom_core_watchdog"} <= {j["job_id"] for j in body["jobs"]}
        assert any(m["name"] == "core_001_base_v0" for m in body["migrations"])
        assert client.get("/api/admin/wisdom/core/runs").status_code == 200
        assert client.post("/api/admin/wisdom/core/jobs/not_a_job/run").status_code == 404
