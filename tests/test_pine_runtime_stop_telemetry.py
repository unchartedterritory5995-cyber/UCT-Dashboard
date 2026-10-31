"""Phase 3 WS-H, arming item S8 (2026-10-31): the runtime lane's stop beacon,
SERVER half (`api/routers/pine_runtime_telemetry.py`).

What it must hold:
* a stop is counted with exactly {guard, limit?, hash, bars, ms, lane};
* NO member source and NO member id reach storage (the row's visitor is a
  constant), and no field is free-form: unknown keys, a long or upper-case hash,
  a `bool` for a number, a guard that is not a stop and an undeclared limit name
  are all refused;
* the closed sets are pinned to the CLIENT files they mirror, parsed, not
  restated, so a new limit or stop guard cannot be silently refused;
* one durable global daily cap; an admin-only aggregate read.

The client half is `app/src/components/chart/engine/runtime/__tests__/runtimeStopBeacon.test.js`.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import pine_runtime_telemetry as tel
from api.services import auth_db

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "app" / "src" / "components" / "chart" / "engine" / "runtime"
URL = "/api/pine-runtime-telemetry/stop"
MEMBER_ID = "u-member-7f3a"
GOOD = {"guard": "runtime:limit", "limit": "MEMORY", "hash": "0123456789ab",
        "bars": 5000, "ms": 812, "lane": "worker"}


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    auth_db.init_db()
    return tmp_path


def _client(role: str = "member", signed_in: bool = True) -> TestClient:
    app = FastAPI()
    app.include_router(tel.router)
    if signed_in:
        app.dependency_overrides[get_current_user] = lambda: {"id": MEMBER_ID, "role": role}
    return TestClient(app)


def _rows() -> list:
    conn = auth_db.get_connection()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM landing_events WHERE event = ?", (tel.EVENT,)).fetchall()]
    finally:
        conn.close()


# ─── the pins: closed sets derived from the client, not restated ────────────

def test_LIMIT_NAMES_is_exactly_limits_js():
    src = (RUNTIME / "limits.js").read_text(encoding="utf-8")
    block = re.search(r"export const LIMIT_NAMES = Object\.freeze\(\[(.*?)\]\)", src, re.S)
    assert block, "limits.js no longer declares LIMIT_NAMES where this rail reads it"
    names = set(re.findall(r"'([A-Z_]+)'", block.group(1)))
    assert len(names) > 10
    assert tel.LIMIT_NAMES == names


def test_every_client_stop_guard_is_accepted_and_no_refusal_is():
    cols = (RUNTIME / "runtimeColumns.js").read_text(encoding="utf-8")
    asy = (RUNTIME / "runtimeAsync.js").read_text(encoding="utf-8")
    reg = (RUNTIME.parent / "nativeRegistry.js").read_text(encoding="utf-8")
    const = lambda text, name: re.search(rf"export const {name} = '([^']+)'", text).group(1)  # noqa: E731
    client = {
        const(cols, "RUNTIME_TIME_BUDGET_GUARD"), const(cols, "RUNTIME_LIMIT_GUARD"),
        const(cols, "RUNTIME_FAILED_GUARD"), const(asy, "RUNTIME_WORKER_UNRESPONSIVE_GUARD"),
        const(asy, "RUNTIME_WORKER_FAILED_GUARD"), const(reg, "RUNTIME_LOAD_FAILED_GUARD"),
    }
    assert tel.STOP_GUARDS == client
    for refusal in ("runtime:killed", "runtime:not-yet-graded", "runtime:version", "runtime.error"):
        assert refusal not in tel.STOP_GUARDS


# ─── storage: shape only, no member ─────────────────────────────────────────

def test_a_stop_is_stored_with_exactly_its_six_fields_and_NO_member_id(db):
    got = _client().post(URL, json=GOOD)
    assert got.status_code == 200 and got.json() == {"ok": True, "logged": True}
    rows = _rows()
    assert len(rows) == 1
    row = rows[0]
    assert row["visitor_id"] == tel.VISITOR
    assert json.loads(row["props"]) == GOOD
    assert MEMBER_ID not in json.dumps(row, default=str)
    assert row["referrer"] is None and row["path"] is None and row["user_agent"] is None


def test_a_stop_without_a_limit_is_stored_without_one(db):
    body = {**GOOD, "guard": "runtime:time-budget"}
    del body["limit"]
    assert _client().post(URL, json=body).json()["logged"] is True
    assert "limit" not in json.loads(_rows()[0]["props"])


@pytest.mark.parametrize("change", [
    {"source": "//@version=5\nindicator('x')"},          # an unknown field: the obvious one
    {"message": "this script passed one of the limits"},  # a stop's sentence can quote the script
    {"member": "u1"},
    {"hash": "0123456789abc"},                            # 13
    {"hash": "0123456789AB"},                             # upper case
    {"hash": "0123456789ag"},                             # not hex
    {"bars": True},                                       # a bool is not a count
    {"ms": "812"},
    {"ms": 812.5},
    {"bars": -1},
    {"ms": 600_001},
    {"lane": "server"},
    {"guard": "x" * 41},
])
def test_anything_outside_the_shape_is_REJECTED_and_nothing_stored(db, change):
    got = _client().post(URL, json={**GOOD, **change})
    assert got.status_code == 422, got.text
    assert _rows() == []


@pytest.mark.parametrize("change", [
    {"guard": "runtime:killed", "limit": None},     # a refusal, not a stop (and no limit to
    {"guard": "free text from a member", "limit": None},  # trip on: each case fails ONE rule)
    {"limit": "NOT_A_LIMIT"},
    {"guard": "runtime:failed", "limit": "MEMORY"},  # a limit rides only on runtime:limit
])
def test_a_value_outside_the_closed_sets_is_answered_and_NOT_stored(db, change):
    body = {k: v for k, v in {**GOOD, **change}.items() if v is not None}
    got = _client().post(URL, json=body)
    assert got.status_code == 200
    assert got.json()["logged"] is False
    assert _rows() == []


def test_signed_out_is_refused(db):
    assert _client(signed_in=False).post(URL, json=GOOD).status_code == 401
    assert _rows() == []


def test_the_global_daily_cap_bounds_storage(db, monkeypatch):
    monkeypatch.setattr(tel, "DAILY_CAP", 2)
    c = _client()
    assert [c.post(URL, json=GOOD).json()["logged"] for _ in range(4)] == [True, True, False, False]
    assert len(_rows()) == 2


# ─── the operator's read ────────────────────────────────────────────────────

def test_the_admin_read_aggregates_by_guard_and_by_script(db):
    c = _client()
    other = {**GOOD, "hash": "fedcba987654", "guard": "runtime:time-budget", "ms": 1200}
    del other["limit"]
    for body in (GOOD, GOOD, other):
        c.post(URL, json=body)
    rep = _client("admin").get("/api/pine-runtime-telemetry/stops").json()
    assert rep["stops"] == 3
    assert rep["by_guard"] == {"runtime:limit:MEMORY": 2, "runtime:time-budget": 1}
    top = rep["by_script"][0]
    assert top["hash"] == GOOD["hash"] and top["stops"] == 2 and top["ms_p95"] == 812
    assert rep["by_script"][1]["guards"] == {"runtime:time-budget": 1}


def test_the_read_is_admin_only(db):
    assert _client("member").get("/api/pine-runtime-telemetry/stops").status_code == 403
