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


# ── OI-47: the durable record must survive the no-jobs-database early return ──────────────
#
# ⛔⛔ THE THIRD INSTANCE OF ONE CLASS IN ONE PROGRAMME. `render_health` has an early return for
# `store is None` — taken on EVERY production pod, because V2 is dark and no jobs database
# exists — which hand-builds its dict and never reaches `observe.health_payload`. OI-42 was this
# hole swallowing `loop`; OI-47 is the same hole swallowing `stall_record` and `token_slots` one
# wave later, and it shipped the day they were wired.
#
# ⭐ A test that only exercises the WITH-database branch is structurally blind to it: that branch
# was correct both times. The two tests below are deliberately a pair — one per branch — because
# the defect lives in the difference between them.


def _both_branches(tc, tmp):
    """The payload on BOTH branches: no jobs database (production today), and with one."""
    without = _get(tc).json()
    s = JobsStore(str(tmp / "jobs.db"))
    s.insert({"corr_id": "00000002", "command": "chart", "state": "queued", "token": "T", "app_id": "A"})
    s.close()
    return without, _get(tc).json()


def test_the_durable_record_survives_the_no_jobs_database_early_return(client):
    """⛔ THE LOAD-BEARING ONE. Reverting the early-return dict makes this red and nothing else."""
    tc, tmp, _ = client
    without, with_db = _both_branches(tc, tmp)
    assert without.get("note"), "expected the no-jobs-database branch; the fixture stopped exercising it"
    for key in ("loop", "stall_record", "token_slots"):
        assert key in without, f"{key} was dropped by the store-is-None early return (OI-47's shape)"
        assert key in with_db, f"{key} is missing from observe.health_payload"


def test_the_two_branches_agree_on_the_observability_keys(client):
    """⛔ NON-VACUITY: presence is not enough — a branch could answer `{}` for every key and pass
    the test above. The record and the counter must carry their OWN shape, so a reader can tell
    'nothing has stalled yet' (a real reading) from 'this route cannot see the record' (OI-47)."""
    tc, tmp, _ = client
    without, with_db = _both_branches(tc, tmp)
    for body, where in ((without, "no-jobs-database"), (with_db, "with-database")):
        assert "path" in body["stall_record"], f"{where}: stall_record carries no record path"
        assert "slots" in body["token_slots"], f"{where}: token_slots carries no slot names"
        assert set(body["token_slots"]["slots"]) == {"current", "previous"}, \
            f"{where}: the slot set is not the two the rotation has"


# ── D-15 / OI-47: the schema diff of the two branches, DERIVED rather than typed ───────────
#
# ⛔⛔ THE PAIR ABOVE NAMES THREE KEYS BY HAND, AND THAT IS THE DEFECT CLASS THIS PROGRAMME
# KEEPS PAYING FOR — the writer-index `FOUR`, the COT router's "4 routes", SMOKE-3.5's "three"
# over a list of four, and the flip-gate's `says="only 1/15"` needle. A hand-typed key list
# covers the keys that existed the day it was written; the FOURTH observability key added to
# `health_payload` would be swallowed by the early return exactly as `loop` (OI-42) and
# `stall_record`/`token_slots` (OI-47) were, and no rail would go red.
#
# ⭐ So the key set is READ OUT OF `observe.py`: `health_payload` DEFINES the observability set
# by assigning `snap["<key>"] = _live_<x>()`. Derive from that and a fourth key is covered the
# day it lands.


def _mirrored_observability_keys() -> set[str]:
    """The observability keys `health_payload` mirrors, read from its own AST."""
    import ast
    import pathlib

    from api.services.discord_render import observe

    tree = ast.parse(pathlib.Path(observe.__file__).read_text(encoding="utf-8"))
    fn = next(n for n in ast.walk(tree)
              if isinstance(n, ast.FunctionDef) and n.name == "health_payload")
    keys: set[str] = set()
    for node in ast.walk(fn):
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1):
            continue
        tgt = node.targets[0]
        if not (isinstance(tgt, ast.Subscript) and isinstance(tgt.value, ast.Name)
                and tgt.value.id == "snap" and isinstance(tgt.slice, ast.Constant)
                and isinstance(node.value, ast.Call)):
            continue
        func = node.value.func
        called = func.id if isinstance(func, ast.Name) else getattr(func, "attr", "")
        if called.startswith("_live_"):
            keys.add(tgt.slice.value)
    return keys


def test_the_schema_diff_of_the_two_branches_is_empty_for_every_observability_key(client):
    """⛔ THE DERIVED RAIL. Every key `health_payload` mirrors must be readable at the TOP LEVEL
    on BOTH branches — the no-jobs-database early return (every production pod today) and the
    with-database one (every pod the day V2 is enabled). A key present on one and not the other
    is OI-47's exact shape: a reader goes quietly blind on the deploy nobody wants surprises on.
    """
    tc, tmp, _ = client
    expected = _mirrored_observability_keys()

    # ⛔ NON-VACUITY, TWICE. An empty derivation would make every assertion below pass over
    # nothing, and "the instrument stopped matching its source" must never read as "clean".
    assert expected, "derivation found NO observability keys — it stopped matching observe.py"
    assert {"loop", "stall_record", "token_slots"} <= expected, (
        f"derivation lost a key it must find; got {sorted(expected)}")

    without, with_db = _both_branches(tc, tmp)
    assert without.get("note"), "expected the no-jobs-database branch; the fixture stopped exercising it"

    missing_without = expected - set(without)
    missing_with = expected - set(with_db)
    assert not missing_without, (
        f"the store-is-None early return drops {sorted(missing_without)} — OI-47's shape, "
        f"on every production pod")
    assert not missing_with, (
        f"health_payload does not mirror {sorted(missing_with)} at the top level")
