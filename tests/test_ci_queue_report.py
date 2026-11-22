"""Rails for tools/ci_queue_report.py (2026-11-16): the arithmetic behind "where the CI queue goes".

Run ONLY this file:  python -m pytest tests/test_ci_queue_report.py -q

Offline: the pure functions only (no `gh`, no network). What must stay true: a job still waiting counts as
waiting up to now and adds no runner minutes; a skipped job is not a job; minutes in a run a newer push
cancelled are counted as cancelled; a sampled workflow is scaled, never dropped; the timeline can tell a
saturated minute from an idle one.
"""
from __future__ import annotations

import datetime as dt
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

import ci_queue_report as Q  # noqa: E402

T0 = Q.ts("2026-01-01T00:00:00Z")


def _at(minute: float) -> str:
    return (T0 + dt.timedelta(minutes=minute)).strftime(Q.F)


def _job(created, started=None, completed=None, status="completed", conclusion="success"):
    return {"created_at": _at(created), "started_at": None if started is None else _at(started),
            "completed_at": None if completed is None else _at(completed), "status": status, "conclusion": conclusion}


def test_the_tools_own_self_check_passes():
    assert Q.self_check() == 0


def test_a_workflow_is_named_without_what_follows_its_colon():
    assert Q.family("remote tests: strat-funds3 refs/remote-tests/x") == "remote tests"
    assert Q.family("pine heavy (PR, parallel)") == "pine heavy (PR, parallel)"


def test_a_waiting_job_waits_until_now_and_a_skipped_job_is_not_a_job():
    now = T0 + dt.timedelta(minutes=60)
    run = {"name": "w", "conclusion": None}
    recs = Q.job_records(run, [_job(0, 10, 25), _job(0, status="queued", conclusion=None),
                               _job(0, 0, 0, conclusion="skipped"),
                               _job(5, 20, None, status="in_progress", conclusion=None)], 1.0, now)
    assert len(recs) == 3                                             # the skipped job is gone
    row = Q.summarize(recs, now)[0]
    assert row["jobs"] == 3 and abs(row["minutes"] - (15 + 40)) < 1e-9   # the running job counts up to now
    assert row["wait_max"] == 60                                      # the queued one has waited the whole hour
    assert row["cancelled"] == 0


def test_minutes_in_a_cancelled_run_are_counted_as_cancelled_and_a_sample_is_scaled():
    now = T0 + dt.timedelta(minutes=60)
    recs = Q.job_records({"name": "a", "conclusion": "cancelled"}, [_job(0, 0, 30)], 1.0, now)
    recs += Q.job_records({"name": "b", "conclusion": "success"}, [_job(0, 0, 2)], 5.0, now)
    rows = {r["family"]: r for r in Q.summarize(recs, now)}
    assert rows["a"]["cancelled"] == 30 and rows["b"]["cancelled"] == 0
    assert rows["b"]["jobs"] == 5 and rows["b"]["minutes"] == 10       # one sampled run standing for five
    assert abs(rows["a"]["share"] - 0.75) < 1e-9


def test_the_timeline_tells_a_saturated_stretch_from_an_idle_one():
    now = T0 + dt.timedelta(minutes=60)
    recs = Q.job_records({"name": "a", "conclusion": "success"}, [_job(0, 0, 10)] * 40 + [_job(0, 10, 12)] * 5, 1.0, now)
    tl = Q.timeline(recs, T0, T0 + dt.timedelta(minutes=30))
    assert tl[0][1] == 40 and tl[0][2] == 5        # 40 running, 5 waiting behind them
    assert tl[1][1] == 1 and tl[1][2] == 0         # then the 5 run for two of ten minutes
    assert tl[2][1] == 0 and tl[2][2] == 0
