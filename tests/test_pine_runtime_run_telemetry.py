"""U4 (2026-11-14): the runtime lane's RUN COUNT and perf beacon, SERVER half
(`api/routers/pine_runtime_telemetry.py`, `POST /runs`, `GET /runs`).

What it must hold:
* a batch is integers under CLOSED keys: an unknown stop code, an unknown histogram bucket,
  an unknown field, a bool for a number, a count over the bound: refused, nothing stored;
* NO source, NO hash, NO member id reach storage: the aggregate table has no column that
  could hold one, and the per-member cap is a keyed hash;
* AGGREGATION is a SUM per (ET day, metric, key), and p50/p95 are read off the SUMMED
  histogram (two batches merge exactly; a percentile is never averaged);
* the durable per-member and global daily caps bound how many batches land;
* the admin read gives the stop rate per day and states the cohort criterion;
* the closed sets are pinned to the CLIENT file (`engine/runtimeRunTelemetry.js`), parsed.

The client half is `app/src/components/chart/engine/__tests__/runtimeRunTelemetry.test.js`.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.middleware.auth_middleware import get_current_user
from api.routers import pine_runtime_telemetry as tel
from api.services import auth_db

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / "app" / "src" / "components" / "chart" / "engine" / "runtimeRunTelemetry.js"
URL = "/api/pine-runtime-telemetry/runs"
MEMBER_ID = "u-member-run-91c2"
GOOD = {"started": 10, "ok": 8, "declined": 1,
        "stops": {"runtime:limit:INSTRUCTIONS_PER_BAR": 1}, "ms": {"100": 6, "300": 3}}


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    monkeypatch.delenv(tel.RUN_TELEMETRY_ENV, raising=False)
    tel._runs_pruned_day[0] = ""
    auth_db.init_db()
    return tmp_path


def _client(role: str = "member", member: str = MEMBER_ID) -> TestClient:
    app = FastAPI()
    app.include_router(tel.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": member, "role": role}
    return TestClient(app)


def _admin() -> TestClient:
    from api.middleware.auth_middleware import require_admin
    app = FastAPI()
    app.include_router(tel.router)
    app.dependency_overrides[require_admin] = lambda: {"id": "u-admin", "role": "admin"}
    app.dependency_overrides[get_current_user] = lambda: {"id": "u-admin", "role": "admin"}
    return TestClient(app)


def _rows() -> list:
    conn = auth_db.get_connection()
    try:
        conn.execute(tel._RUNS_DDL)
        return [tuple(r) for r in conn.execute(
            f"SELECT day, metric, key, n FROM {tel.RUNS_TABLE} ORDER BY metric, key").fetchall()]
    finally:
        conn.close()


# ─── the pins: closed sets derived from the client, not restated ────────────

def _client_array(name: str) -> list[str]:
    src = CLIENT.read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = Object\.freeze\(\[(.*?)\]\)", src, re.S)
    assert m, f"runtimeRunTelemetry.js no longer declares {name} where this rail reads it"
    return re.findall(r"'([^']+)'|(\d+)", m.group(1))


def test_RUN_MS_BUCKETS_is_exactly_the_clients():
    got = [int(b) for _s, b in _client_array("RUN_MS_BUCKETS") if b]
    assert tuple(got) == tel.RUN_MS_BUCKETS
    assert list(tel.RUN_MS_BUCKETS) == sorted(set(tel.RUN_MS_BUCKETS)), "edges must ascend"


def test_RUN_STOP_GUARDS_is_exactly_the_servers_stop_set():
    got = {s for s, _b in _client_array("RUN_STOP_GUARDS") if s}
    assert got == tel.STOP_GUARDS


# ─── closed keys ─────────────────────────────────────────────────────────────

def test_a_good_batch_is_stored_as_sums_under_its_keys(db):
    r = _client().post(URL, json=GOOD)
    assert r.status_code == 200 and r.json() == {"ok": True, "logged": True}
    day = tel._et_day()
    assert _rows() == [
        (day, "count", "declined", 1), (day, "count", "ok", 8), (day, "count", "started", 10),
        (day, "ms", "100", 6), (day, "ms", "300", 3),
        (day, "stop", "runtime:limit:INSTRUCTIONS_PER_BAR", 1),
    ]


@pytest.mark.parametrize("bad", [
    {**GOOD, "stops": {"runtime:limit:NOT_A_LIMIT": 1}},
    {**GOOD, "stops": {"runtime:killed": 1}},                  # a refusal is not a stop
    {**GOOD, "stops": {"my secret line 3": 1}},
    {**GOOD, "ms": {"99": 1}},
    {**GOOD, "ms": {"100": 50}},                                # more timed than answered
    {"started": 0, "ok": 0},                                     # empty
])
def test_a_batch_with_any_undeclared_key_is_refused_whole(db, bad):
    r = _client().post(URL, json=bad)
    assert r.status_code == 200 and r.json()["logged"] is False
    assert _rows() == []


@pytest.mark.parametrize("bad", [
    {**GOOD, "source": "//@version=5\nindicator('x')"},          # no field carries a script
    {**GOOD, "hash": "0123456789ab"},
    {**GOOD, "member": MEMBER_ID},
    {**GOOD, "ok": True},                                        # a bool is not a count
    {**GOOD, "ok": "8"},
    {**GOOD, "ok": tel.RUNS_MAX_PER_FIELD + 1},
    {**GOOD, "stops": {"runtime:failed": 0}},
    {**GOOD, "stops": {"runtime:failed": True}},
])
def test_an_unknown_field_or_a_non_count_is_a_422(db, bad):
    assert _client().post(URL, json=bad).status_code == 422
    assert _rows() == []


def test_storage_holds_no_member_id_and_no_script(db):
    _client().post(URL, json=GOOD)
    conn = auth_db.get_connection()
    try:
        cols = [r[1] for r in conn.execute(f"PRAGMA table_info({tel.RUNS_TABLE})").fetchall()]
        dump = "\n".join(conn.iterdump())
    finally:
        conn.close()
    assert cols == ["day", "metric", "key", "n"]
    assert MEMBER_ID not in dump, "the raw member id reached the database"


# ─── aggregation ─────────────────────────────────────────────────────────────

def test_two_batches_SUM_and_percentiles_read_off_the_summed_histogram(db):
    c = _client()
    c.post(URL, json={"ok": 9, "ms": {"10": 9}})
    c.post(URL, json={"ok": 1, "stops": {"runtime:worker-failed": 1}, "ms": {"2000": 2}})
    rep = tel.runs_report(7)
    t = rep["total"]
    assert (t["runs"], t["ok"], t["stops"], t["worker_failed"]) == (11, 10, 1, 1)
    # 11 timed runs: 9 at <=10 ms, 2 at <=2000 ms. p50 sits in the first bucket, p95 in the
    # last; an AVERAGE of the two batches' own p95s (10 and 2000) would say 1005.
    assert t["ms_p50_le"] == 10 and t["ms_p95_le"] == 2000
    assert t["stop_rate"] == round(1 / 11, 6)
    assert rep["cohort_criterion"]["no_worker_failed"] is False
    assert rep["cohort_criterion"]["stop_rate_under_threshold"] is False


def test_the_report_is_per_day_and_the_criterion_passes_when_it_should(db):
    tel.record_runs(tel.RunsBody(ok=500, ms={"50": 500}), MEMBER_ID, day="2026-11-10")
    tel.record_runs(tel.RunsBody(ok=480, stops={"runtime:time-budget": 5}), MEMBER_ID, day="2026-11-11")
    rep = tel.runs_report(14, today="2026-11-14")
    assert [d["day"] for d in rep["by_day"]] == ["2026-11-11", "2026-11-10"]
    assert rep["by_day"][0]["stop_rate"] == round(5 / 485, 6)
    assert rep["total"]["runs"] == 985
    crit = rep["cohort_criterion"]
    assert crit == {"stop_rate_threshold": 0.02, "has_runs": True, "stop_rate_under_threshold": True,
                    "no_worker_failed": True, "no_load_failed": True}
    assert tel.runs_report(1, today="2026-11-09")["total"]["runs"] == 0, "the window bounds the read"
    assert tel._hist_quantile({"inf": 3}, 0.95) == ">20000"
    assert tel._hist_quantile({}, 0.5) is None


def test_retention_prunes_days_older_than_the_window(db):
    tel.record_runs(tel.RunsBody(ok=1), None, day="2025-01-01")
    tel._runs_pruned_day[0] = ""
    tel.record_runs(tel.RunsBody(ok=1), None, day="2026-11-14")
    assert {r[0] for r in _rows()} == {"2026-11-14"}


# ─── caps ────────────────────────────────────────────────────────────────────

def test_the_per_member_cap_bounds_one_member_and_not_another(db, monkeypatch):
    monkeypatch.setattr(tel, "RUNS_MEMBER_DAILY_CAP", 3)
    a, b = _client(member="m-a"), _client(member="m-b")
    got = [a.post(URL, json={"ok": 1}).json()["logged"] for _ in range(5)]
    assert got == [True, True, True, False, False]
    assert b.post(URL, json={"ok": 1}).json()["logged"] is True
    assert tel.runs_report(1)["total"]["ok"] == 4


def test_the_global_cap_bounds_everyone(db, monkeypatch):
    monkeypatch.setattr(tel, "RUNS_DAILY_CAP", 2)
    got = [_client(member=f"m-{i}").post(URL, json={"ok": 1}).json()["logged"] for i in range(4)]
    assert got == [True, True, False, False]


def test_the_kill_switch_stores_nothing(db, monkeypatch):
    monkeypatch.setenv(tel.RUN_TELEMETRY_ENV, "off")
    assert _client().post(URL, json=GOOD).json() == {"ok": True, "logged": False}
    assert _rows() == []


# ─── the read is admin only ──────────────────────────────────────────────────

def test_the_read_is_admin_only(db):
    from api.middleware.auth_middleware import require_admin  # noqa: F401
    app = FastAPI()
    app.include_router(tel.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": MEMBER_ID, "role": "member"}
    assert TestClient(app).get(URL).status_code in (401, 403)
    r = _admin().get(URL + "?days=7")
    assert r.status_code == 200 and r.json()["days"] == 7 and "cohort_criterion" in r.json()
