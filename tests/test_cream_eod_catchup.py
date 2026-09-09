"""⚰️ THE EOD TOP FLOW (cream) CARD SILENTLY DID NOT POST — 2026-09-08.

`cream_card` was registered on APScheduler's IN-MEMORY job store as a bare 16:10
ET cron with no ``misfire_grace_time`` and no catch-up. A pod that restarts
across the slot never SCHEDULES that fire, so nothing runs and nothing records
it. On 2026-09-08 a flow-worker redeploy burst held the worker unstable until
17:53 ET (103m past the slot); the card never appeared despite 15 qualifying
builds on the tape, and the only trace was its absence.

⭐ THE SHAPE IS `oi_morning`'s / `/buzz`'s, REUSED — a per-day record on the
volume, a catch-up on the 60s poll that posts a late card while it is still
honest, and a CRITICAL alert once it is not. catch_up only ever examines the
CURRENT ET day, so a prior slot handled out-of-band (e.g. a manual recovery
post) is never re-examined — there is no "pre-feature" day to special-case.
"""

from __future__ import annotations

import datetime as dt
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from api import cream_card as cc  # noqa: E402

ET = dt.timezone(dt.timedelta(hours=-4))          # a fixed offset is enough here
ROOT = pathlib.Path(__file__).resolve().parents[1]


def _at(hh, mm, *, day=8, month=9, year=2026):
    """2026-09-08 is a Tuesday, so these are weekday times unless said otherwise."""
    return dt.datetime(year, month, day, hh, mm, tzinfo=ET)


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """⛔ THE STATE FILE GOES TO A TMP PATH, NEVER `/data`. On this machine that
    directory is the owner's live volume; the repo-root conftest has a tripwire
    for exactly this, and a test that writes a real slot record could suppress a
    real EOD card."""
    monkeypatch.setenv("CREAM_EOD_STATE_PATH", str(tmp_path / "cream_state.json"))
    monkeypatch.setenv("CREAM_EOD_ENABLED", "1")
    yield


@pytest.fixture
def ran(monkeypatch):
    """Records calls instead of computing or posting anything."""
    calls = []

    def fake(**kw):
        calls.append(kw)
        return {"ok": True, "posted": True, "bull": 3, "bear": 1}

    monkeypatch.setattr(cc, "run_cream_eod", fake)
    return calls


@pytest.fixture
def alerts(monkeypatch):
    seen = []
    import api.services.chart_health_alerts as cha
    monkeypatch.setattr(cha, "emit",
                        lambda key, sev, msg, meta=None: seen.append((key, sev, msg)))
    return seen


# ── the window ───────────────────────────────────────────────────────────────

def test_before_the_slot_nothing_happens(ran):
    assert cc.catch_up(now=_at(15, 0))["reason"] == "not due yet"
    assert ran == []


def test_inside_the_window_the_card_is_caught_up(ran):
    out = cc.catch_up(now=_at(16, 40))               # 30m late, inside 120m grace
    assert out.get("ok") is True, out
    assert len(ran) == 1, "the card was not run"
    # …and the day is now recorded, so the 60s poll does not run it again.
    assert cc.slot_done("2026-09-08")
    cc.catch_up(now=_at(16, 45))
    assert len(ran) == 1, "the catch-up ran a second time on the same day"


def test_past_the_window_it_is_RECORDED_AND_PAGED__not_posted(ran, alerts):
    """⛔⛔ THE HALF THAT MATTERS. Past the honesty limit the run is refused, the
    day is marked, and a HUMAN is told."""
    out = cc.catch_up(now=_at(19, 0))                # 170m late
    assert out["reason"] == "past the catch-up window"
    assert ran == [], "a stale card was posted anyway"
    assert cc.slot_done("2026-09-08")
    assert len(alerts) == 1, "nobody was told"
    key, sev, msg = alerts[0]
    # ⛔ `critical` IS THE ONLY SEVERITY THAT PAGES.
    assert sev == "critical", sev
    assert "2026-09-08" in key
    assert "never posted" in msg


def test_the_grace_boundary_is_the_declared_one(ran):
    """The limit is read from the module, not retyped, so moving it moves this."""
    cc.catch_up(now=_at(16, 10) + dt.timedelta(minutes=cc._grace_min()))
    assert len(ran) == 1, "the last minute inside the window did not post"


def test_the_weekend_is_not_caught_up(ran):
    # 2026-09-12 is a Saturday; the cron is mon-fri, so a Saturday catch-up
    # would post a board no schedule would ever have produced.
    assert cc.catch_up(now=_at(17, 0, day=12))["reason"] == "weekend"
    assert ran == []


def test_disarmed_does_nothing(ran, monkeypatch):
    monkeypatch.setenv("CREAM_EOD_ENABLED", "0")
    assert cc.catch_up(now=_at(17, 0))["reason"] == "disarmed"
    assert ran == []


# ── what counts as "handled" ────────────────────────────────────────────────

def test_a_QUIET_DAY_still_closes_the_day(monkeypatch):
    """⛔ "COMPLETED", NOT "POSTED". `run_cream_eod` answers
    `posted=False, reason='empty'` when nothing qualifies — a real answer.
    Marking the day done on COMPLETION stops the 60s poll retrying all evening."""
    monkeypatch.setattr(cc, "run_cream_eod",
                        lambda **kw: {"ok": True, "posted": False, "reason": "empty"})
    cc.run_scheduled(now=_at(16, 10))
    assert cc.slot_done("2026-09-08")


def test_a_FAILED_run_does_NOT_close_the_day(monkeypatch, ran):
    """⛔ THE OTHER DIRECTION. A run that errored must stay eligible for the
    catch-up, so `ok` is the test rather than 'we called it'."""
    monkeypatch.setattr(cc, "run_cream_eod",
                        lambda **kw: {"ok": False, "error": "boom"})
    cc.run_scheduled(now=_at(16, 10))
    assert not cc.slot_done("2026-09-08"), "a failed run was recorded as handled"


def test_a_MANUAL_preview_never_closes_the_day(ran):
    """⛔⛔ THE TRAP THIS SPLIT EXISTS FOR. `run_cream_eod` is the manual/preview
    entry point (the admin /cream/post uses force=True). If it marked the slot, a
    preview at 15:00 would SUPPRESS the real 16:10 card."""
    cc.run_cream_eod(force=True, post=False)
    assert not cc.slot_done("2026-09-08")


# ── the wiring ───────────────────────────────────────────────────────────────

def _add_job_calls(src: str):
    """Every `sched.add_job(...)`, as (callable-dotted-name, id=) pairs.

    ⚰️ AN AST, NOT A `grep`. Asserting the source CONTAINS "_cream.catch_up"
    passes for a file that merely MENTIONS it while registering something else —
    exactly the state this test forbids."""
    import ast

    out = []
    for node in ast.walk(ast.parse(src)):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        if not (isinstance(fn, ast.Attribute) and fn.attr == "add_job"):
            continue
        target = node.args[0] if node.args else None
        dotted = None
        if isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name):
            dotted = f"{target.value.id}.{target.attr}"
        job_id = next((kw.value.value for kw in node.keywords
                       if kw.arg == "id" and isinstance(kw.value, ast.Constant)), None)
        out.append((dotted, job_id))
    return out


def test_the_scheduler_REGISTERS_both_jobs_and_reads_the_slot():
    """⚰️ A CATCH-UP NOBODY SCHEDULES IS THE DEFECT IT EXISTS TO FIX."""
    src = (ROOT / "api" / "flow_worker_main.py").read_text(encoding="utf-8")
    calls = _add_job_calls(src)

    assert ("_cream.run_scheduled", "cream_eod") in calls, calls
    assert ("_cream.catch_up", "cream_eod_catchup") in calls, (
        "the catch-up is REGISTERED nowhere — mentioning it is not scheduling it")

    # ⛔ NON-VACUITY: the walker sees the file's many other jobs.
    assert len(calls) > 3, calls
    # ⛔ THE SLOT IS READ, NOT RETYPED — one authority for when this fires.
    assert "_cream.SLOT_ET" in src


def test_the_state_file_survives_a_torn_write(tmp_path, monkeypatch):
    """⛔ `open(path, 'w')` TRUNCATES BEFORE THE WRITE CAN FAIL. An empty file
    reads as 'nothing posted' and re-posts, so the save is tmp -> replace. A
    corrupt file must degrade to 'nothing recorded', never raise."""
    p = tmp_path / "torn.json"
    monkeypatch.setenv("CREAM_EOD_STATE_PATH", str(p))
    p.write_text("{not json at all", encoding="utf-8")
    assert cc.slot_done("2026-09-08") is False
    cc.mark_slot_done("2026-09-08", "posted")
    assert cc.slot_done("2026-09-08") is True
