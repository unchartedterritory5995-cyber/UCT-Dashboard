"""The Wednesday measurement window reader (TERM-007 / TERM-017 / X-15).

The property under test is that the reader CANNOT report a valid window it did not
get: a second pod identity, a missing heavy job, a stopped reader or a gate that
refused each make the matching row INVALID with a reason, and a fully valid
fixture is VALID (the control, so a reader that refuses everything is caught too).
No network: the gate runner and the ops post are injected.
"""
from __future__ import annotations

import ast
import datetime as _dt
import json
import pathlib
import subprocess
import sys

import pytest

from api.services import measurement_window as mw

ROOT = pathlib.Path(__file__).resolve().parents[1]
ET = mw._et()
DAY = _dt.date(2026, 10, 14)
WD = DAY.isoformat()
BOUNDS = list(range(14))  # 13 bounds + overflow = 14 buckets


@pytest.fixture(autouse=True)
def _store(tmp_path, monkeypatch):
    monkeypatch.setenv("MEASUREMENT_WINDOW_DB_PATH", str(tmp_path / "mw.db"))
    monkeypatch.delenv(mw.FLAG, raising=False)
    mw._LAST_SAMPLE_TS.clear()
    yield


def _at(h, m, s=5):
    return _dt.datetime(DAY.year, DAY.month, DAY.day, h, m, s, tzinfo=ET)


def _wd(checks, started_at=1000.0, running=True):
    counts = [0] * 14
    counts[0] = int(checks * 0.9)
    counts[2] = checks - counts[0]
    return {"lag_histogram": {"bounds_ms": [], "counts": counts}, "running": running,
            "started_at": started_at, "check_sec": 5.0, "wedge_sec": 30.0,
            "max_lag_ms": 14.0, "enabled": False}


def _rows(*, pods=1, heavy=True, own_only=False, minutes=None, gate=0):
    rows = []
    mins = minutes if minutes is not None else list(range(0, 121))
    for i, m in enumerate(mins):
        t = _at(9 + m // 60, m % 60)
        ident = {"deployment": "d1" if (pods == 1 or i < len(mins) // 2) else "d2",
                 "replica": "", "pid": 1, "boot_ts": 1.0}
        jobs = []
        if i == 40 and heavy:
            jobs.append({"job": "screener_scan_sweep", "seconds": 45.0, "rss_delta_mb": 5.0})
        if i == 75 and own_only:
            jobs.append({"job": "measurement_window_bars_gate", "seconds": 300.0,
                         "rss_delta_mb": 400.0})
        rows.append({"ts": t.timestamp(), "kind": "sample",
                     "payload": {"identity": ident, "watchdog": _wd(12 * (i + 1)),
                                 "rss_mb": 900.0 + i, "jobs": jobs}})
    if gate is not None:
        res = [{"tf": "D", "p95_ms": 120.0, "nowait_n": 25, "n": 40, "tier_alarm": None,
                "not_computable": None, "server_p95_ms": 40.0},
               {"tf": "5", "p95_ms": 90.0, "nowait_n": 30, "n": 40, "tier_alarm": None,
                "not_computable": None, "server_p95_ms": 30.0}]
        if gate == 2:
            res[0].update(p95_ms=None, nowait_n=3,
                          not_computable="NOT COMPUTABLE on tf=D — only 3 of 40")
        rows.append({"ts": _at(10, 15).timestamp(), "kind": "bars_gate",
                     "payload": {"exit": gate, "results": res, "min_nowait_n": 20,
                                 "bar_ms": 250.0, "health": {"status": 200}}})
    return rows


# ── the window ──────────────────────────────────────────────────────────────

def test_the_window_is_wednesday_09_to_11_ET_half_open_in_both_seasons():
    utc = _dt.timezone.utc
    assert mw.in_window(_dt.datetime(2026, 10, 14, 13, 0, tzinfo=utc))       # 09:00 EDT
    assert not mw.in_window(_dt.datetime(2026, 10, 14, 12, 59, tzinfo=utc))
    assert not mw.in_window(_dt.datetime(2026, 10, 14, 15, 0, tzinfo=utc))   # 11:00 EDT
    assert mw.in_window(_dt.datetime(2026, 12, 2, 14, 30, tzinfo=utc))       # 09:30 EST
    assert not mw.in_window(_dt.datetime(2026, 10, 20, 14, 0, tzinfo=utc))   # a plain Tuesday


def test_the_first_window_is_2026_10_14_and_then_every_wednesday():
    assert mw.is_window_day(DAY)
    assert not mw.is_window_day(_dt.date(2026, 10, 7))
    assert mw.is_window_day(_dt.date(2026, 10, 21))
    assert not mw.is_window_day(_dt.date(2026, 10, 15))
    assert mw.latest_window_day(_at(12, 0) + _dt.timedelta(days=3)) == DAY


# ── the verdicts ────────────────────────────────────────────────────────────

def test_CONTROL_a_fully_valid_window_is_valid_on_all_three_rows():
    rec = mw.compute_verdicts(WD, _rows(), is_trading_day=True)
    r = rec["rows"]
    assert r["TERM-007"]["valid"], r["TERM-007"]["reason"]
    assert r["TERM-017"]["valid"], r["TERM-017"]["reason"]
    assert r["X-15"]["valid"] and r["X-15"]["passed"] is True
    n = r["TERM-017"]["numbers"]
    assert n["checks"] == 12 * 121 - 12 and n["p99_le_ms"] is not None
    assert r["TERM-007"]["numbers"]["span_min"] >= mw.MIN_SPAN_MIN


def test_a_deploy_inside_the_window_voids_007_and_017():
    r = mw.compute_verdicts(WD, _rows(pods=2), is_trading_day=True)["rows"]
    assert not r["TERM-007"]["valid"] and "2 pod identities" in r["TERM-007"]["reason"]
    assert not r["TERM-017"]["valid"]


def test_no_heavy_job_is_invalid_and_the_readers_own_gate_run_never_counts():
    r = mw.compute_verdicts(WD, _rows(heavy=False, own_only=True), is_trading_day=True)["rows"]
    assert not r["TERM-007"]["valid"] and "no heavy job" in r["TERM-007"]["reason"]


def test_a_reader_that_stopped_mid_window_is_invalid():
    mins = list(range(0, 50)) + list(range(70, 121))
    r = mw.compute_verdicts(WD, _rows(minutes=mins), is_trading_day=True)["rows"]
    assert not r["TERM-007"]["valid"] and "gap" in r["TERM-007"]["reason"]


def test_a_window_that_started_after_the_open_is_invalid():
    r = mw.compute_verdicts(WD, _rows(minutes=list(range(35, 121))),
                            is_trading_day=True)["rows"]
    assert not r["TERM-007"]["valid"]
    assert "09:30 open" in r["TERM-007"]["reason"]


def test_a_holiday_is_not_a_window():
    r = mw.compute_verdicts(WD, _rows(), is_trading_day=False)["rows"]
    assert not r["TERM-007"]["valid"] and "not a trading day" in r["TERM-007"]["reason"]


def test_an_inconclusive_gate_is_NOT_a_valid_X15_and_names_the_timeframe():
    x = mw.compute_verdicts(WD, _rows(gate=2), is_trading_day=True)["rows"]["X-15"]
    assert x["valid"] is False and x["passed"] is None
    assert "INCONCLUSIVE" in x["reason"] and "tf=D no-wait n=3" in x["reason"]


def test_an_over_bar_gate_is_valid_but_not_passed():
    x = mw.compute_verdicts(WD, _rows(gate=1), is_trading_day=True)["rows"]["X-15"]
    assert x["valid"] is True and x["passed"] is False


def test_no_gate_run_is_invalid():
    x = mw.compute_verdicts(WD, _rows(gate=None), is_trading_day=True)["rows"]["X-15"]
    assert x["valid"] is False and "did not run" in x["reason"]


def test_a_stopped_watchdog_voids_017_only():
    rows = _rows()
    for r in rows:
        if r["kind"] == "sample":
            r["payload"]["watchdog"]["running"] = False
    v = mw.compute_verdicts(WD, rows, is_trading_day=True)["rows"]
    assert v["TERM-007"]["valid"] and not v["TERM-017"]["valid"]


# ── the jobs, end to end against a real store ───────────────────────────────

def test_samples_are_taken_only_inside_the_window():
    assert mw.take_sample(_at(8, 59)) is None
    assert mw.take_sample(_at(11, 5)) is None
    assert mw.take_sample(_at(9, 0)) is not None
    assert [r["kind"] for r in mw.read_rows(WD)] == ["sample"]


def test_the_kill_switch_stops_every_job(monkeypatch):
    monkeypatch.setenv(mw.FLAG, "0")
    assert mw.take_sample(_at(9, 30)) is None
    assert mw.run_bars_gate(_at(10, 15), runner=lambda b, n: {"exit": 0}) is None
    assert mw.finalize(_at(11, 1)) is None
    assert mw.read_rows(WD) == []


def test_the_bars_gate_runs_ONCE_per_window():
    calls = []

    def runner(base, n):
        calls.append((base, n))
        return {"exit": 0, "results": []}
    assert mw.run_bars_gate(_at(10, 15), runner=runner) is not None
    assert mw.run_bars_gate(_at(10, 40), runner=runner) is None
    assert len(calls) == 1


def test_finalize_writes_ONE_record_and_posts_once(monkeypatch):
    posts = []
    monkeypatch.setattr(mw, "_post_ops", lambda text: posts.append(text) or True)
    for m in range(0, 121):
        mw.take_sample(_at(9 + m // 60, m % 60))
    assert mw.finalize(_at(10, 59)) is None, "never before 11:00 ET"
    rec = mw.finalize(_at(11, 1))
    again = mw.finalize(_at(11, 10))
    assert rec is not None and again["window_date"] == WD
    assert len(posts) == 1 and "TERM-007" in posts[0]
    assert mw.latest_result()["window_date"] == WD
    assert set(rec["rows"]) == {"TERM-007", "TERM-017", "X-15"}


def test_the_job_run_ring_records_each_execution():
    from api.services import memory_probe
    before = len(memory_probe.recent_job_runs(0))
    memory_probe.record_job("mw_probe_job", 10.0, 12.0, 31.0)
    runs = memory_probe.recent_job_runs(0)
    assert len(runs) == before + 1 and runs[-1]["job"] == "mw_probe_job"
    assert runs[-1]["seconds"] == 31.0 and runs[-1]["rss_delta_mb"] == 2.0


# ── the wiring ──────────────────────────────────────────────────────────────

def test_register_adds_exactly_the_four_jobs():
    class FakeScheduler:
        def __init__(self):
            self.ids = []

        def add_job(self, fn, **kw):
            self.ids.append(kw["id"])
    s = FakeScheduler()
    mw.register(s)
    assert tuple(s.ids) == mw.JOB_IDS


def test_api_main_registers_the_jobs_and_mounts_the_router():
    tree = ast.parse((ROOT / "api" / "main.py").read_text(encoding="utf-8"))
    calls = {ast.unparse(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call)}
    assert "_mwin.register" in calls
    assert "app.include_router" in calls  # control: the probe sees calls at all
    src = (ROOT / "api" / "main.py").read_text(encoding="utf-8")
    assert "app.include_router(_measurement_window_router.router)" in src


def test_the_admin_route_is_admin_only_and_serves_the_record():
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from api.middleware import auth_middleware
    from api.routers import measurement_window as router_mod
    app = FastAPI()
    app.include_router(router_mod.router)
    client = TestClient(app)
    assert client.get("/api/admin/measurement-window/latest").status_code in (401, 403)
    app.dependency_overrides[auth_middleware.require_admin] = lambda: {"role": "admin"}
    r = client.get("/api/admin/measurement-window/latest")
    assert r.status_code == 200 and r.json()["result"] is None
    assert "next_window" in r.json()["status"]
    assert client.get("/api/admin/measurement-window/nope").status_code == 400


def test_importing_the_reader_in_a_fresh_server_like_process_never_loads_conftest():
    probe = ("import sys; sys.path.insert(0, %r); import api.services.measurement_window; "
             "print('conftest' in sys.modules)" % str(ROOT))
    out = subprocess.run([sys.executable, "-c", probe], cwd=str(ROOT), capture_output=True,
                         text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-1000:]
    assert out.stdout.strip().splitlines()[-1] == "False"


def test_the_gate_runs_in_a_CHILD_process_never_in_process():
    src = (ROOT / "api" / "services" / "measurement_window.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    imported = {a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names}
    imported |= {n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
    assert "conftest" not in imported and not any("bars_warmth_gate" in m for m in imported)
    assert "subprocess.run" in src and "tools\", \"bars_warmth_gate.py\"" in src


# ── the deploy freeze ───────────────────────────────────────────────────────

def test_the_deploy_freeze_self_check_passes_and_reads_the_same_window():
    out = subprocess.run([sys.executable, str(ROOT / "tools" / "deploy_freeze.py"),
                          "--self-check"], capture_output=True, text=True, timeout=120)
    assert out.returncode == 0 and "self-check: PASS" in out.stdout, out.stdout + out.stderr
    frozen = subprocess.run([sys.executable, str(ROOT / "tools" / "deploy_freeze.py"),
                             "--now", "2026-10-14T14:00:00Z"], capture_output=True, text=True,
                            timeout=120)
    assert frozen.returncode == 3 and "FROZEN" in frozen.stdout


def test_the_promotion_workflow_skips_the_fast_forward_when_frozen():
    wf = (ROOT / ".github" / "workflows" / "promote-production.yml").read_text(encoding="utf-8")
    assert "python tools/deploy_freeze.py" in wf
    assert "steps.freeze.outputs.frozen != 'yes'" in wf
    assert "cron: '5 15 * * 3'" in wf


def test_the_one_off_extra_window_2026_10_13_is_a_full_window():
    # owner ruling 2026-10-12: a second attempt on Tue 2026-10-13, same bounds and bar
    utc = _dt.timezone.utc
    extra = _dt.date(2026, 10, 13)
    assert mw.is_window_day(extra)
    assert not mw.is_window_day(_dt.date(2026, 10, 20))             # only that Tuesday
    assert mw.in_window(_dt.datetime(2026, 10, 13, 13, 0, tzinfo=utc))       # 09:00 EDT
    assert not mw.in_window(_dt.datetime(2026, 10, 13, 15, 0, tzinfo=utc))   # 11:00 EDT
    assert not mw.in_window(_dt.datetime(2026, 10, 20, 13, 30, tzinfo=utc))
    tue_noon = _dt.datetime(2026, 10, 13, 12, 0, tzinfo=ET)
    assert mw.latest_window_day(tue_noon) == extra                   # finalize keys on it
    assert mw.latest_window_day(tue_noon + _dt.timedelta(days=1)) == DAY
    assert mw.latest_window_day(tue_noon + _dt.timedelta(days=7)) == DAY  # Tue 10/20: back to the weekly rule
    assert "tue" in mw._CRON_DAYS and "wed" in mw._CRON_DAYS


def test_status_finds_the_next_window_from_the_extra_day_and_never_spins(monkeypatch):
    monkeypatch.setattr(mw, "read_rows", lambda d: [])
    monkeypatch.setattr(mw, "pod_identity", lambda: {})
    after_tue = _dt.datetime(2026, 10, 13, 12, 0, tzinfo=ET)          # past Tuesday's window
    assert mw.status(after_tue)["next_window"] == DAY.isoformat()
    before_tue = _dt.datetime(2026, 10, 13, 8, 0, tzinfo=ET)
    assert mw.status(before_tue)["next_window"] == "2026-10-13"
