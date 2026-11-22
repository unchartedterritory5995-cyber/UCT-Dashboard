"""U4 (2026-11-14): the runtime lane's RUN COUNT and perf beacon, SERVER half
(`api/routers/pine_runtime_telemetry.py`, `POST /runs`, `GET /runs`).

What it must hold:
* a batch is integers under CLOSED keys: an unknown stop code, an unknown histogram bucket,
  an unknown field, a bool for a number, a count over the bound, a batch over the per-batch
  ceiling: refused, nothing stored;
* NO source, NO hash, NO member id reach storage (the tab is a random nonce);
* ONLY a member whose pane runs the runtime lane may post (review M3), and one member can
  neither flood a batch nor exhaust the global day;
* AGGREGATION is a SUM per (ET day, metric, key); p50/p95 come off the SUMMED histogram;
* THE GATE (review M1/M2): stop_rate = stops / (ok + stops), declines reported apart; the
  criterion needs a minimum sample, a 95% upper bound under 2%, enough tabs, no dominant tab,
  no worker-failed / load-failed, nothing dropped;
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
from api.services import runtime_definitions as rd

ROOT = Path(__file__).resolve().parents[1]
CLIENT = ROOT / "app" / "src" / "components" / "chart" / "engine" / "runtimeRunTelemetry.js"
URL = "/api/pine-runtime-telemetry/runs"
MEMBER_ID = "u-member-run-91c2"
TAB = "0123456789abcdef"
GOOD = {"tab": TAB, "started": 10, "ok": 8, "declined": 1,
        "stops": {"runtime:limit:INSTRUCTIONS_PER_BAR": 1}, "ms": {"100": 6, "300": 3}}


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth_test.db"))
    monkeypatch.delenv(tel.RUN_TELEMETRY_ENV, raising=False)
    monkeypatch.setenv(rd.STAGE_ENV, rd.STAGE_ALL)        # every member's pane runs the lane
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


def _tab_rows() -> list:
    conn = auth_db.get_connection()
    try:
        conn.execute(tel._RUNS_TAB_DDL)
        return [tuple(r) for r in conn.execute(f"SELECT day, tab, runs, stops FROM {tel.RUNS_TAB_TABLE}").fetchall()]
    finally:
        conn.close()


def _batch(tab: str = TAB, **kw) -> tel.RunsBody:
    return tel.RunsBody(tab=tab, **kw)


# ─── the pins: closed sets derived from the client, not restated ────────────

def _client_array(name: str) -> list:
    src = CLIENT.read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = Object\.freeze\(\[(.*?)\]\)", src, re.S)
    assert m, f"runtimeRunTelemetry.js no longer declares {name} where this rail reads it"
    return re.findall(r"'([^']+)'|(\d+)", m.group(1))


def _client_int(name: str) -> int:
    m = re.search(rf"export const {name} = (\d+)", CLIENT.read_text(encoding="utf-8"))
    assert m, name
    return int(m.group(1))


def test_RUN_MS_BUCKETS_is_exactly_the_clients():
    got = [int(b) for _s, b in _client_array("RUN_MS_BUCKETS") if b]
    assert tuple(got) == tel.RUN_MS_BUCKETS
    assert list(tel.RUN_MS_BUCKETS) == sorted(set(tel.RUN_MS_BUCKETS)), "edges must ascend"


def test_RUN_STOP_GUARDS_is_exactly_the_servers_stop_set():
    got = {s for s, _b in _client_array("RUN_STOP_GUARDS") if s}
    assert got == tel.STOP_GUARDS


def test_the_clients_batch_ceiling_is_the_servers():
    assert _client_int("RUNS_MAX_PER_BATCH") == tel.RUNS_MAX_PER_BATCH
    assert _client_int("RUNS_MAX_DROPPED") == tel.RUNS_MAX_DROPPED


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
    assert _tab_rows() == [(day, TAB, 9, 1)]          # completed runs only: ok + stops


@pytest.mark.parametrize("bad", [
    {**GOOD, "stops": {"runtime:limit:NOT_A_LIMIT": 1}},
    {**GOOD, "stops": {"runtime:killed": 1}},                  # a refusal is not a stop
    {**GOOD, "stops": {"my secret line 3": 1}},
    {**GOOD, "ms": {"99": 1}},
    {**GOOD, "ms": {"100": 50}},                                # more timed than answered
    {**GOOD, "ok": 400, "declined": 201},                       # over the per-batch ceiling
    {"tab": TAB, "started": 0, "ok": 0},                        # empty
])
def test_a_batch_with_any_undeclared_key_or_over_the_ceiling_is_refused_whole(db, bad):
    r = _client().post(URL, json=bad)
    assert r.status_code == 200 and r.json()["logged"] is False
    assert _rows() == [] and _tab_rows() == []


@pytest.mark.parametrize("bad", [
    {**GOOD, "source": "//@version=5\nindicator('x')"},          # no field carries a script
    {**GOOD, "hash": "0123456789ab"},
    {**GOOD, "member": MEMBER_ID},
    {**GOOD, "tab": MEMBER_ID},                                  # the tab is a nonce, never an id
    {**GOOD, "tab": "0123456789ABCDEF"},
    {k: v for k, v in GOOD.items() if k != "tab"},
    {**GOOD, "ok": True},                                        # a bool is not a count
    {**GOOD, "ok": "8"},
    {**GOOD, "ok": tel.RUNS_MAX_PER_FIELD + 1},
    {**GOOD, "dropped": tel.RUNS_MAX_DROPPED + 1},
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
        tab_cols = [r[1] for r in conn.execute(f"PRAGMA table_info({tel.RUNS_TAB_TABLE})").fetchall()]
        dump = "\n".join(conn.iterdump())
    finally:
        conn.close()
    assert cols == ["day", "metric", "key", "n"]
    assert tab_cols == ["day", "tab", "runs", "stops"]
    assert MEMBER_ID not in dump, "the raw member id reached the database"


# ─── who may post (review M3) ────────────────────────────────────────────────

@pytest.mark.parametrize("stage,role,logged", [
    ("off", "admin", False), ("admins", "member", False), ("admins", "admin", True),
    ("cohort", "member", False), ("all", "member", True),
])
def test_only_a_member_whose_pane_runs_the_lane_may_post(db, monkeypatch, stage, role, logged):
    monkeypatch.setenv(rd.STAGE_ENV, stage)
    r = _client(role=role).post(URL, json=GOOD)
    assert r.status_code == 200 and r.json()["logged"] is logged
    assert bool(_rows()) is logged


def test_a_cohort_member_may_post(db, monkeypatch):
    from api.services import rollout_gate
    monkeypatch.setenv(rd.STAGE_ENV, "cohort")
    monkeypatch.setattr(rollout_gate, "pine_runtime_cohort_enabled_for", lambda uid: uid == MEMBER_ID)
    assert _client().post(URL, json=GOOD).json()["logged"] is True
    assert _client(member="u-not-in-cohort").post(URL, json=GOOD).json()["logged"] is False


# ─── aggregation ─────────────────────────────────────────────────────────────

def test_two_batches_SUM_and_percentiles_read_off_the_summed_histogram(db):
    c = _client()
    c.post(URL, json={"tab": TAB, "ok": 9, "ms": {"10": 9}})
    c.post(URL, json={"tab": TAB, "ok": 1, "stops": {"runtime:worker-failed": 1}, "ms": {"2000": 2}})
    rep = tel.runs_report(7)
    t = rep["total"]
    assert (t["runs"], t["ok"], t["stops"], t["worker_failed"]) == (11, 10, 1, 1)
    # 11 timed runs: 9 at <=10 ms, 2 at <=2000 ms. p50 sits in the first bucket, p95 in the
    # last; an AVERAGE of the two batches' own p95s (10 and 2000) would say 1005.
    assert t["ms_p50_le"] == 10 and t["ms_p95_le"] == 2000
    assert t["stop_rate"] == round(1 / 11, 6)
    assert rep["cohort_criterion"]["no_worker_failed"] is False
    assert rep["cohort_criterion"]["passes"] is False


def test_retention_prunes_days_older_than_each_window(db):
    tel.record_runs(_batch(ok=1), None, day="2025-01-01")
    tel.record_runs(_batch(ok=1), None, day="2026-10-01")
    tel._runs_pruned_day[0] = ""
    tel.record_runs(_batch(ok=1), None, day="2026-11-14")
    assert {r[0] for r in _rows()} == {"2026-10-01", "2026-11-14"}
    assert {r[0] for r in _tab_rows()} == {"2026-11-14"}           # tab rows keep 30 days


# ─── the gate (review M1, M2) ────────────────────────────────────────────────

def test_M1_declines_never_dilute_the_stop_rate(db):
    """The reviewer's case: 10 stops in 400 completed runs is 2.5%, a FAIL, however many
    times a refused script is re-declined beside it."""
    tel.record_runs(_batch(ok=390, stops={"runtime:time-budget": 10}), MEMBER_ID, day="2026-11-12")
    tel.record_runs(_batch(declined=210), MEMBER_ID, day="2026-11-12")
    rep = tel.runs_report(3, today="2026-11-14")
    t = rep["total"]
    assert t["runs"] == 400 and t["declined"] == 210
    assert t["stop_rate"] == 0.025
    assert rep["cohort_criterion"]["stop_rate_under_threshold"] is False


def test_M2_a_small_clean_sample_does_not_pass(db):
    for i in range(3):
        tel.record_runs(_batch(tab=f"{i:016x}", ok=40), MEMBER_ID, day="2026-11-13")
    crit = tel.runs_report(3, today="2026-11-14")["cohort_criterion"]
    assert crit["stop_rate_under_threshold"] is True
    assert crit["enough_runs"] is False and crit["upper_bound_under_threshold"] is False
    assert crit["passes"] is False


def test_M2_enough_clean_runs_across_tabs_passes_and_each_part_can_fail(db):
    for i in range(4):
        tel.record_runs(_batch(tab=f"{i:016x}", ok=60), MEMBER_ID, day="2026-11-13")
    crit = tel.runs_report(3, today="2026-11-14")["cohort_criterion"]
    assert crit["passes"] is True, crit
    # one heavy tab now holds most of the runs: refused even though the rate is clean
    for _ in range(2):
        tel.record_runs(_batch(tab="ffffffffffffffff", ok=600), MEMBER_ID, day="2026-11-13")
    crit = tel.runs_report(3, today="2026-11-14")["cohort_criterion"]
    assert crit["no_tab_dominates"] is False and crit["passes"] is False


def test_M2_too_few_tabs_or_a_drop_fails_the_gate(db):
    for i in range(2):
        tel.record_runs(_batch(tab=f"{i:016x}", ok=200), MEMBER_ID, day="2026-11-13")
    crit = tel.runs_report(3, today="2026-11-14")["cohort_criterion"]
    assert crit["enough_tabs"] is False and crit["passes"] is False
    tel.record_runs(_batch(tab=f"{9:016x}", ok=200, dropped=1), MEMBER_ID, day="2026-11-13")
    crit = tel.runs_report(3, today="2026-11-14")["cohort_criterion"]
    assert crit["enough_tabs"] is True and crit["nothing_dropped"] is False and crit["passes"] is False


def test_the_wilson_upper_bound_is_right_and_rule_of_three_shaped():
    assert tel.wilson_upper(0, 0) is None
    assert tel.wilson_upper(0, 150) < 0.02 < tel.wilson_upper(0, 120)
    assert abs(tel.wilson_upper(10, 400) - 0.04138) < 1e-4
    assert tel.wilson_upper(400, 400) == pytest.approx(1.0)


def test_the_report_is_per_day_with_tab_dispersion(db):
    tel.record_runs(_batch(tab="a" * 16, ok=500, ms={"50": 500}), MEMBER_ID, day="2026-11-10")
    tel.record_runs(_batch(tab="b" * 16, ok=480, stops={"runtime:time-budget": 5}), MEMBER_ID, day="2026-11-11")
    rep = tel.runs_report(14, today="2026-11-14")
    assert [d["day"] for d in rep["by_day"]] == ["2026-11-11", "2026-11-10"]
    assert rep["by_day"][0]["stop_rate"] == round(5 / 485, 6)
    t = rep["total"]
    assert t["runs"] == 985 and t["tabs"] == 2
    assert t["top_tab_share"] == round(500 / 985, 6)
    assert t["tab_stop_rate_max"] == round(5 / 485, 6)
    assert tel.runs_report(1, today="2026-11-09")["total"]["runs"] == 0, "the window bounds the read"
    assert tel._hist_quantile({"inf": 3}, 0.95) == ">20000"
    assert tel._hist_quantile({}, 0.5) is None


# ─── caps ────────────────────────────────────────────────────────────────────

def test_the_per_member_cap_bounds_one_member_and_not_another(db, monkeypatch):
    monkeypatch.setattr(tel, "RUNS_MEMBER_DAILY_CAP", 3)
    a, b = _client(member="m-a"), _client(member="m-b")
    got = [a.post(URL, json={"tab": TAB, "ok": 1}).json()["logged"] for _ in range(5)]
    assert got == [True, True, True, False, False]
    assert b.post(URL, json={"tab": TAB, "ok": 1}).json()["logged"] is True
    assert tel.runs_report(1)["total"]["ok"] == 4


def test_one_member_cannot_exhaust_the_global_day():
    """The daily caps' own arithmetic: one member's whole day is a sliver of the global cap,
    and one member's day of full batches is bounded."""
    assert tel.RUNS_MEMBER_DAILY_CAP * 100 <= tel.RUNS_DAILY_CAP
    assert tel.RUNS_MEMBER_DAILY_CAP * tel.RUNS_MAX_PER_BATCH <= 360_000


def test_the_global_cap_bounds_everyone(db, monkeypatch):
    monkeypatch.setattr(tel, "RUNS_DAILY_CAP", 2)
    got = [_client(member=f"m-{i}").post(URL, json={"tab": TAB, "ok": 1}).json()["logged"] for i in range(4)]
    assert got == [True, True, False, False]


def test_the_kill_switch_stores_nothing(db, monkeypatch):
    monkeypatch.setenv(tel.RUN_TELEMETRY_ENV, "off")
    assert _client().post(URL, json=GOOD).json() == {"ok": True, "logged": False}
    assert _rows() == []


# ─── the read is admin only ──────────────────────────────────────────────────

def test_the_read_is_admin_only(db):
    app = FastAPI()
    app.include_router(tel.router)
    app.dependency_overrides[get_current_user] = lambda: {"id": MEMBER_ID, "role": "member"}
    assert TestClient(app).get(URL).status_code in (401, 403)
    r = _admin().get(URL + "?days=7")
    assert r.status_code == 200 and r.json()["days"] == 7 and "passes" in r.json()["cohort_criterion"]


# ─── follow-up review: refused batches counted, the criterion's own window, prune on read ───────

def test_FL1_a_batch_the_caps_refuse_is_counted_and_fails_nothing_dropped(db, monkeypatch):
    monkeypatch.setattr(tel, "RUNS_MEMBER_DAILY_CAP", 1)
    c = _client(member="m-cap")
    assert c.post(URL, json={"tab": TAB, "ok": 1}).json()["logged"] is True
    assert c.post(URL, json={"tab": TAB, "ok": 1}).json()["logged"] is False     # refused by the cap
    assert c.post(URL, json={"tab": TAB, "ok": 1}).json()["logged"] is False
    day = tel._et_day()
    assert (day, "count", "refused", 2) in _rows()
    rep = tel.runs_report(1)
    assert rep["total"]["refused"] == 2 and rep["total"]["ok"] == 1
    assert rep["cohort_criterion"]["nothing_dropped"] is False
    conn = auth_db.get_connection()
    try:
        dump = "\n".join(conn.iterdump())
    finally:
        conn.close()
    assert "m-cap" not in dump                                    # a count, never a member


def test_FL1_a_refusal_that_is_not_a_cap_is_not_counted(db, monkeypatch):
    monkeypatch.setenv(rd.STAGE_ENV, "off")                       # not permitted: not a cap refusal
    _client().post(URL, json=GOOD)
    _client().post(URL, json={**GOOD, "ms": {"99": 1}})          # malformed: not a cap refusal
    assert tel.runs_report(1)["total"]["refused"] == 0


def test_FL2_the_criterion_window_is_capped_at_the_tab_retention(db):
    # a clean, big sample 45 days ago (its tabs pruned away) and a small one this week
    for i in range(4):
        tel.record_runs(_batch(tab=f"{i:016x}", ok=200), MEMBER_ID, day="2026-10-01")
    tel.record_runs(_batch(tab="e" * 16, ok=10), MEMBER_ID, day="2026-11-12")
    rep = tel.runs_report(60, today="2026-11-14")
    assert rep["total"]["runs"] == 810                             # the 60-day view still shows it
    crit = rep["cohort_criterion"]
    assert crit["window_days"] == tel.RUNS_TAB_RETAIN_DAYS
    assert rep["criterion_window"]["total"]["runs"] == 10          # graded on the last 30 days only
    assert crit["enough_runs"] is False and crit["passes"] is False
    short = tel.runs_report(7, today="2026-11-14")
    assert short["cohort_criterion"]["window_days"] == 7


def test_FL3_the_read_prunes_old_rows_even_on_a_day_with_no_batch(db):
    for d in ("2025-01-01", "2026-09-01"):
        tel._runs_pruned_day[0] = d                               # the write path prunes nothing here
        tel.record_runs(_batch(ok=1), None, day=d)
    assert {r[0] for r in _rows()} == {"2025-01-01", "2026-09-01"}
    tel.runs_report(7, today="2026-11-14")
    assert {r[0] for r in _rows()} == {"2026-09-01"}               # daily sums keep 400 days
    assert _tab_rows() == []                                       # tab rows keep 30 days
