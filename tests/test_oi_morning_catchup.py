"""⚰️ A MISSED MORNING CARD LEFT NO TRACE AT ALL.

`oi_morning` is registered on APScheduler's IN-MEMORY job store, so a pod that
restarts across 08:00 ET never SCHEDULES that fire -- ``misfire_grace_time``
cannot see a job that was never scheduled. Flow-worker redeploys on a narrow
watch path and its tape is bounced deliberately after hours, so crossing the slot
is routine rather than hypothetical. The card simply did not appear: no log line
said so, nothing recorded it, and the only way to find out was to go looking for
a board that was never built.

⭐ THE SHAPE IS `/buzz`'s, REUSED RATHER THAN REINVENTED -- a per-day record on
the volume, a catch-up riding the 60s poll that posts a late card while it is
still honest, and a CRITICAL alert once it is not.

⛔ THE HONESTY LIMIT IS THE POINT. This card says "the biggest OVERNIGHT OI
builds"; one posted at noon is a different claim wearing the morning's label. So
past the window it is NOT posted -- it is recorded and it pages.
"""

from __future__ import annotations

import datetime as dt
import os
import pathlib
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest  # noqa: E402

from api import oi_morning as oim  # noqa: E402

ET = dt.timezone(dt.timedelta(hours=-4))          # a fixed offset is enough here
ROOT = pathlib.Path(__file__).resolve().parents[1]


def _at(hh, mm, *, day=3, month=9, year=2026):
    """2026-09-03 is a Thursday, so these are weekday times unless said otherwise."""
    return dt.datetime(year, month, day, hh, mm, tzinfo=ET)


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """⛔ THE STATE FILE GOES TO A TMP PATH, NEVER `/data`. On this machine that
    directory is the owner's live volume; the repo-root conftest has a tripwire
    for exactly this, and a test that writes a real slot record could suppress a
    real morning card."""
    monkeypatch.setenv("OI_MORNING_STATE_PATH", str(tmp_path / "oi_state.json"))
    monkeypatch.setenv("OI_MORNING_ENABLED", "1")
    yield


@pytest.fixture
def ran(monkeypatch):
    """Records calls instead of building or posting anything."""
    calls = []

    def fake(**kw):
        calls.append(kw)
        return {"ok": True, "rows": 3, "posted": True}

    monkeypatch.setattr(oim, "run_oi_morning", fake)
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
    assert oim.catch_up(now=_at(7, 30))["reason"] == "not due yet"
    assert ran == []


def test_inside_the_window_the_card_is_caught_up(ran):
    out = oim.catch_up(now=_at(8, 20))
    assert out.get("ok") is True, out
    assert len(ran) == 1, "the card was not run"
    # …and the day is now recorded, so the 60s poll does not run it again.
    assert oim.slot_done("2026-09-03")
    oim.catch_up(now=_at(8, 25))
    assert len(ran) == 1, "the catch-up ran a second time on the same day"


def test_past_the_window_it_is_RECORDED_AND_PAGED__not_posted(ran, alerts):
    """⛔⛔ THE HALF THAT MATTERS. A late board is not a free win: it says
    'overnight' and would be read as this morning's. So past the limit the run is
    refused, the day is marked, and a HUMAN is told."""
    out = oim.catch_up(now=_at(12, 0))               # 240m late
    assert out["reason"] == "past the catch-up window"
    assert ran == [], "a stale card was posted anyway"
    assert oim.slot_done("2026-09-03")
    assert len(alerts) == 1, "nobody was told"
    key, sev, msg = alerts[0]
    # ⛔ `critical` IS THE ONLY SEVERITY THAT PAGES. Anything less lands in an
    # in-memory deque that dies with the pod — a miss-detector nobody reads.
    assert sev == "critical", sev
    assert "2026-09-03" in key
    assert "never posted" in msg


def test_the_grace_boundary_is_the_declared_one(ran):
    """The limit is read from the module, not retyped, so moving it moves this."""
    oim.catch_up(now=_at(8, 0) + dt.timedelta(minutes=oim.CATCHUP_GRACE_MIN))
    assert len(ran) == 1, "the last minute inside the window did not post"


def test_the_weekend_is_not_caught_up(ran):
    # 2026-09-05 is a Saturday; the cron is mon-fri, so a Saturday catch-up
    # would post a board no schedule would ever have produced.
    assert oim.catch_up(now=_at(9, 0, day=5))["reason"] == "weekend"
    assert ran == []


def test_disarmed_does_nothing(ran, monkeypatch):
    monkeypatch.setenv("OI_MORNING_ENABLED", "0")
    assert oim.catch_up(now=_at(9, 0))["reason"] == "disarmed"
    assert ran == []


# ── what counts as "handled" ────────────────────────────────────────────────

def test_a_QUIET_MORNING_still_closes_the_day(monkeypatch):
    """⛔ "COMPLETED", NOT "POSTED". `run_oi_morning` answers
    `posted=False, reason='no qualifying OI builds'` when nothing qualifies, and
    that is a real answer — re-running builds the same empty board. Marking the
    day done on COMPLETION is what stops the 60s poll retrying all session."""
    monkeypatch.setattr(oim, "run_oi_morning",
                        lambda **kw: {"ok": True, "rows": 0, "posted": False,
                                      "reason": "no qualifying OI builds"})
    oim.run_scheduled(now=_at(8, 0))
    assert oim.slot_done("2026-09-03")


def test_a_FAILED_run_does_NOT_close_the_day(monkeypatch, ran):
    """⛔ THE OTHER DIRECTION, and it is why `ok` is the test rather than
    'we called it'. A build that errored must stay eligible for the catch-up."""
    monkeypatch.setattr(oim, "run_oi_morning",
                        lambda **kw: {"ok": False, "reason": "error: boom"})
    oim.run_scheduled(now=_at(8, 0))
    assert not oim.slot_done("2026-09-03"), "a failed run was recorded as handled"


def test_a_MANUAL_preview_never_closes_the_day(ran):
    """⛔⛔ THE TRAP THIS SPLIT EXISTS FOR. `run_oi_morning` is the manual and
    preview entry point (`force=True`, `post=False`). If it marked the slot, a
    member previewing the card at 07:55 would SUPPRESS the real one — the exact
    opposite of what previewing is for."""
    oim.run_oi_morning(force=True, post=False)
    assert not oim.slot_done("2026-09-03")


# ── the wiring ───────────────────────────────────────────────────────────────

def _add_job_calls(src: str):
    """Every `sched.add_job(...)`, as (callable-dotted-name, id=) pairs.

    ⚰️ THIS WAS A `grep` AND MUTATION TESTING CAUGHT IT. Asserting the source
    CONTAINS "_oim.catch_up" passes for a file that merely MENTIONS the function
    while registering something else -- which is precisely the state this test
    exists to forbid. A string cannot tell a registration from a reference; the
    parser can. (Same shape as a `<Component />` sitting in a comment.)
    """
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
    """⚰️ A CATCH-UP NOBODY SCHEDULES IS THE DEFECT IT EXISTS TO FIX. This repo
    has shipped that exact shape before: `desk_session_insights` was written,
    documented as scheduled, and wired into no scheduler for weeks."""
    src = (ROOT / "api" / "flow_worker_main.py").read_text(encoding="utf-8")
    calls = _add_job_calls(src)

    assert ("_oim.run_scheduled", "oi_morning_push") in calls, calls
    assert ("_oim.catch_up", "oi_morning_catchup") in calls, (
        "the catch-up is REGISTERED nowhere — mentioning it is not scheduling it")

    # ⛔ NON-VACUITY: the walker can see other jobs, so "found it" is not an
    # artefact of a parser that returns everything or nothing.
    assert len(calls) > 3, calls
    # ⛔ THE SLOT IS READ, NOT RETYPED — one authority for when this fires.
    assert "_oim.SLOT_ET" in src
    assert "hour=8" not in src, "the slot time is hardcoded again beside SLOT_ET"


def test_the_state_file_survives_a_torn_write(tmp_path, monkeypatch):
    """⛔ `open(path, 'w')` TRUNCATES BEFORE THE WRITE CAN FAIL. An empty file
    reads as 'nothing posted today' and re-posts, so the save is tmp -> replace.
    A corrupt file must degrade to 'nothing recorded', never raise."""
    p = tmp_path / "torn.json"
    monkeypatch.setenv("OI_MORNING_STATE_PATH", str(p))
    p.write_text("{not json at all", encoding="utf-8")
    assert oim.slot_done("2026-09-03") is False
    oim.mark_slot_done("2026-09-03", "posted")
    assert oim.slot_done("2026-09-03") is True
