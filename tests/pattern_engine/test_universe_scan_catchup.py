"""The nightly universe scan survives a deploy (incident 2026-10-19).

The 01:00 ET `_run_patterns_universe_scan` died ~11 min in when a master
deploy replaced the pod; the in-memory job store forgot it had ever run, and
~80% of the universe kept the previous run's rows. These rails pin the fix:

  * an interrupted run is RESUMED from its checkpoint on the next boot;
  * a completed run is NOT re-run;
  * the cron and the catch-up can never run at once (in-process AND via the
    durable lease another process would see);
  * clock / weekend / holiday edges of "which slot is owed";
  * the whole thing is a no-op when the scan or the catch-up is switched off.

Everything here drives the REAL job functions in api.main against a real
SQLite patterns.db (one per test). Only the detector loop
(`_scan_patterns_daily`) and the universe loader are stubbed: they are what
costs an hour, and they are not what is under test.
"""
from __future__ import annotations

import ast
import threading
from datetime import date, datetime

import pytest

import api.main as m
from api.services.pattern_engine import universe_scan_runs as usr

ET = usr.ET
UNIVERSE = [f"S{i:03d}" for i in range(100)]


def et(y, mo, d, h=10, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=ET)


# Monday 2026-10-19, 10:00 ET -- the morning after the incident.
MON_MORNING = et(2026, 10, 19, 10, 0)


@pytest.fixture(autouse=True)
def _isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("PATTERN_DB_PATH", str(tmp_path / "patterns.db"))
    monkeypatch.delenv("PATTERNS_UNIVERSE_SCAN_ENABLED", raising=False)
    monkeypatch.delenv("PATTERNS_UNIVERSE_CATCHUP_ENABLED", raising=False)
    monkeypatch.setattr(m, "_load_patterns_universe_ordered",
                        lambda _plog: (list(UNIVERSE), {"S000"}, 1))
    # Never leak a held in-process lock into the next test.
    yield
    if usr._inproc_lock.locked():
        usr._inproc_lock.release()


class FakeScan:
    """Stands in for `_scan_patterns_daily`: records exactly which symbols it
    was handed and drives the progress callback the way the real loop does."""

    def __init__(self, stop_after=None, gate=None, started=None):
        self.calls: list[list[str]] = []
        self.stop_after = stop_after
        self.gate = gate
        self.started = started

    def __call__(self, symbols, leader_set, _plog, on_progress=None):
        self.calls.append(list(symbols))
        if self.started is not None:
            self.started.set()
        if self.gate is not None:
            assert self.gate.wait(10), "test gate never opened"
        for i, _ in enumerate(symbols):
            if on_progress:
                on_progress(i, symbols[i - 1] if i else None)
            if self.stop_after is not None and i == self.stop_after:
                raise RuntimeError("simulated crash mid-loop")
        return len(symbols), 0


def _kill_mid_run(slot, done, heartbeat_ts):
    """What a deploy leaves behind: a `running` row whose process died after
    checkpointing `done` symbols. No end_run -- that is the point."""
    h = usr.begin_run("scheduled", slot, list(UNIVERSE), now=heartbeat_ts)
    assert h is not None
    h._write(done, UNIVERSE[done - 1], heartbeat_ts)
    usr._inproc_lock.release()      # the dying process's lock dies with it
    return h


# -- 1. an interrupted run resumes on the next boot ---------------------------

def test_an_interrupted_run_resumes_from_its_checkpoint_on_the_next_boot(monkeypatch):
    killed_at = et(2026, 10, 19, 1, 11).timestamp()
    _kill_mid_run(date(2026, 10, 19), 50, killed_at)

    scan = FakeScan()
    monkeypatch.setattr(m, "_scan_patterns_daily", scan)
    out = m._run_patterns_universe_catchup(now=MON_MORNING)

    assert out["ran"] and out["status"] == "completed"
    assert out["offset"] == 50
    assert scan.calls == [UNIVERSE[50:]], "resume must continue AFTER the checkpoint, not restart"
    runs = {r["run_id"]: r for r in usr.list_runs()}
    statuses = sorted(r["status"] for r in runs.values())
    assert statuses == ["abandoned", "completed"]
    done = next(r for r in runs.values() if r["status"] == "completed")
    assert done["kind"] == "catchup" and done["slot"] == "2026-10-19"
    assert done["done_count"] == len(UNIVERSE) and done["resumed_from"]


def test_a_resume_is_refused_when_the_universe_changed_and_the_run_restarts_whole(monkeypatch):
    _kill_mid_run(date(2026, 10, 19), 50, et(2026, 10, 19, 1, 11).timestamp())
    # A symbol was appended overnight: every checkpointed position still lines
    # up, so ONLY the stored universe hash can tell the list moved.
    changed = UNIVERSE + ["NEW"]
    monkeypatch.setattr(m, "_load_patterns_universe_ordered",
                        lambda _plog: (list(changed), set(), 0))
    scan = FakeScan()
    monkeypatch.setattr(m, "_scan_patterns_daily", scan)

    out = m._run_patterns_universe_catchup(now=MON_MORNING)
    assert out["offset"] == 0
    assert scan.calls == [changed]


def test_a_crash_inside_the_loop_is_recorded_and_resumed(monkeypatch):
    """A Python exception (not a SIGKILL): end_run records `failed` with the
    checkpoint; the next catch-up continues from it."""
    monkeypatch.setattr(m, "_scan_patterns_daily", FakeScan(stop_after=60))
    m._run_patterns_universe_scan(now=et(2026, 10, 19, 1, 0))
    (row,) = usr.list_runs()
    assert row["status"] == "failed" and row["done_count"] == 50  # last checkpoint (every 25)

    scan = FakeScan()
    monkeypatch.setattr(m, "_scan_patterns_daily", scan)
    m._run_patterns_universe_catchup(now=MON_MORNING)
    assert scan.calls == [UNIVERSE[50:]]


# -- 2. a completed run does NOT re-run ---------------------------------------

def test_a_completed_run_is_not_rerun(monkeypatch):
    scan = FakeScan()
    monkeypatch.setattr(m, "_scan_patterns_daily", scan)
    m._run_patterns_universe_scan(now=et(2026, 10, 19, 1, 0))
    assert len(scan.calls) == 1

    for minute in (6, 21, 36):          # boot check, then the watchdog ticks
        out = m._run_patterns_universe_catchup(now=et(2026, 10, 19, 10, minute))
        assert out["ran"] is False, out
    assert len(scan.calls) == 1, "a completed slot must never be scanned again"


def test_first_boot_with_no_record_runs_the_missing_slot(monkeypatch):
    """The deploy that ships this fix: the killed 10/19 run left NO record, so
    the catch-up must treat the latest data-bearing slot as owed."""
    scan = FakeScan()
    monkeypatch.setattr(m, "_scan_patterns_daily", scan)
    out = m._run_patterns_universe_catchup(now=MON_MORNING)
    assert out["ran"] and out["offset"] == 0
    assert scan.calls == [UNIVERSE]
    (row,) = usr.list_runs()
    assert row["slot"] == "2026-10-19" and row["status"] == "completed"


# -- 3. never a double run ------------------------------------------------------

def test_the_cron_cannot_start_while_a_catchup_is_running(monkeypatch):
    gate, started = threading.Event(), threading.Event()
    slow = FakeScan(gate=gate, started=started)
    monkeypatch.setattr(m, "_scan_patterns_daily", slow)

    t = threading.Thread(target=m._run_patterns_universe_catchup,
                         kwargs={"now": et(2026, 10, 18, 23, 30)})
    t.start()
    assert started.wait(10)
    # The 01:00 cron fires while the catch-up is still inside its loop.
    m._run_patterns_universe_scan(now=et(2026, 10, 19, 1, 0))
    # ...and a catch-up tick at the same moment.
    out = m._run_patterns_universe_catchup(now=et(2026, 10, 19, 1, 0))
    gate.set()
    t.join(10)

    assert len(slow.calls) == 1, f"two universe runs overlapped: {len(slow.calls)}"
    assert out["ran"] is False


def test_the_db_lease_refuses_a_second_runner_in_another_process():
    """Another worker/replica on the same patterns.db: its in-process lock is
    not ours, so only the table can stop us."""
    h = usr.begin_run("scheduled", date(2026, 10, 19), list(UNIVERSE))
    assert h is not None
    usr._inproc_lock.release()          # pretend the holder is a different process
    try:
        assert usr.begin_run("catchup", date(2026, 10, 19), list(UNIVERSE)) is None
        plan = usr.plan_catch_up(datetime.now(ET), usr.list_runs())
        assert plan.action == "none" and "live" in plan.reason
    finally:
        usr._inproc_lock.acquire(blocking=False)
        usr.end_run(h, "completed")


def test_a_dead_runners_lease_expires_after_the_stale_window():
    t0 = et(2026, 10, 19, 1, 11).timestamp()
    _kill_mid_run(date(2026, 10, 19), 50, t0)
    runs = usr.list_runs()
    fresh = datetime.fromtimestamp(t0 + usr.STALE_SECONDS - 5, ET)
    stale = datetime.fromtimestamp(t0 + usr.STALE_SECONDS + 5, ET)
    assert usr.plan_catch_up(fresh, runs).action == "none"
    assert usr.plan_catch_up(stale, runs).action == "resume"
    # The boot check is scheduled past the stale window on purpose: a run this
    # pod's own deploy killed is already stale at the first look.
    assert usr.BOOT_DELAY_SECONDS > usr.STALE_SECONDS


# -- 4. clock and weekend edges -------------------------------------------------

@pytest.mark.parametrize("now, slot", [
    (et(2026, 10, 19, 0, 59), date(2026, 10, 18)),
    (et(2026, 10, 19, 1, 0), date(2026, 10, 19)),
    (et(2026, 10, 19, 23, 59), date(2026, 10, 19)),
    # DST end: 2026-11-01 01:00 ET happens twice; both are that day's slot.
    (datetime(2026, 11, 1, 5, 30, tzinfo=usr.ZoneInfo("UTC")), date(2026, 11, 1)),
    (datetime(2026, 11, 1, 6, 30, tzinfo=usr.ZoneInfo("UTC")), date(2026, 11, 1)),
])
def test_slot_for_clock_edges(now, slot):
    assert usr.slot_for(now) == slot


@pytest.mark.parametrize("now, required", [
    (et(2026, 10, 17, 10), date(2026, 10, 17)),   # Sat: carries Friday's session
    (et(2026, 10, 18, 10), date(2026, 10, 17)),   # Sun: nothing new since Sat
    (et(2026, 10, 19, 10), date(2026, 10, 17)),   # Mon: still Friday's bars
    (et(2026, 10, 20, 10), date(2026, 10, 20)),   # Tue: Monday's session
    (et(2026, 9, 8, 10), date(2026, 9, 5)),       # Tue after Labor Day: Fri's session
])
def test_required_slot_follows_the_trading_calendar(now, required):
    assert usr.required_slot(now) == required


def test_weekend_a_saturday_completion_covers_sunday_and_monday(monkeypatch):
    scan = FakeScan()
    monkeypatch.setattr(m, "_scan_patterns_daily", scan)
    m._run_patterns_universe_scan(now=et(2026, 10, 17, 1, 0))      # Sat run completes
    # Pod down across Sun 01:00 and Mon 01:00 (no rows at all for those slots).
    for now in (et(2026, 10, 18, 9), MON_MORNING):
        out = m._run_patterns_universe_catchup(now=now)
        assert out["ran"] is False and "covered" in out["reason"], out
    assert len(scan.calls) == 1
    # Tuesday morning: Monday's session is new data and nothing has scanned it.
    out = m._run_patterns_universe_catchup(now=et(2026, 10, 20, 9))
    assert out["ran"] and len(scan.calls) == 2


def test_no_catchup_when_the_next_cron_is_imminent(monkeypatch):
    scan = FakeScan()
    monkeypatch.setattr(m, "_scan_patterns_daily", scan)
    out = m._run_patterns_universe_catchup(now=et(2026, 10, 20, 0, 30))
    assert out["ran"] is False and "imminent" in out["reason"]
    out = m._run_patterns_universe_catchup(now=et(2026, 10, 20, 0, 5))     # 55 min out
    assert out["ran"] is False
    assert scan.calls == []
    out = m._run_patterns_universe_catchup(now=et(2026, 10, 19, 23, 50))   # 70 min out
    assert out["ran"] is True and len(scan.calls) == 1


def test_attempts_per_slot_are_capped(monkeypatch):
    monkeypatch.setattr(m, "_scan_patterns_daily", FakeScan(stop_after=0))
    for minute in range(usr.MAX_ATTEMPTS_PER_SLOT + 2):
        m._run_patterns_universe_catchup(now=et(2026, 10, 19, 10, minute))
    rows = usr.list_runs()
    assert len(rows) == usr.MAX_ATTEMPTS_PER_SLOT
    plan = usr.plan_catch_up(et(2026, 10, 19, 11), rows)
    assert plan.action == "none" and "gave up" in plan.reason


# -- 5. disabled = no-op --------------------------------------------------------

def test_catchup_is_a_noop_when_the_scan_is_disabled(monkeypatch):
    monkeypatch.setenv("PATTERNS_UNIVERSE_SCAN_ENABLED", "0")
    scan = FakeScan()
    monkeypatch.setattr(m, "_scan_patterns_daily", scan)
    assert m._run_patterns_universe_catchup(now=MON_MORNING) == {"ran": False, "reason": "disabled"}
    m._run_patterns_universe_scan(now=et(2026, 10, 19, 1, 0))
    assert scan.calls == [] and usr.list_runs() == []


def test_catchup_switch_off_leaves_the_cron_running(monkeypatch):
    monkeypatch.setenv("PATTERNS_UNIVERSE_CATCHUP_ENABLED", "0")
    scan = FakeScan()
    monkeypatch.setattr(m, "_scan_patterns_daily", scan)
    assert m._run_patterns_universe_catchup(now=MON_MORNING)["ran"] is False
    assert scan.calls == []
    m._run_patterns_universe_scan(now=et(2026, 10, 19, 1, 0))
    assert len(scan.calls) == 1


# -- 6. the real loop drives the checkpoint -------------------------------------

def test_the_real_scan_loop_reports_progress_before_each_symbol(monkeypatch):
    from api.services import bars_sqlite
    monkeypatch.setattr(bars_sqlite, "get_bars", lambda *a, **k: [])
    seen = []

    class _Log:
        def debug(self, *a, **k): pass
        def info(self, *a, **k): pass
        def warning(self, *a, **k): pass

    m._scan_patterns_daily(["A", "B", "C"], set(), _Log(),
                           on_progress=lambda i, last: seen.append((i, last)))
    assert seen == [(0, None), (1, "A"), (2, "B")]


# -- 7. the scheduler wiring ------------------------------------------------------

def _add_job_calls():
    tree = ast.parse(open(m.__file__, encoding="utf-8").read())
    out = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", "") == "add_job":
            kw = {k.arg: k.value for k in node.keywords}
            if isinstance(kw.get("id"), ast.Constant):
                out[kw["id"].value] = kw
    return out


def test_the_cron_has_coalesce_and_a_misfire_grace_and_the_catchup_is_wired():
    jobs = _add_job_calls()
    cron = jobs["patterns_universe_scan"]
    assert isinstance(cron.get("coalesce"), ast.Constant) and cron["coalesce"].value is True
    grace = cron.get("misfire_grace_time")
    assert isinstance(grace, ast.Constant) and grace.value >= 600
    catch = jobs["patterns_universe_catchup"]
    assert isinstance(catch["max_instances"], ast.Constant) and catch["max_instances"].value == 1
    assert "next_run_time" in catch, "the catch-up must first fire a few minutes after boot"
    assert len(jobs) > 10            # non-vacuity: the walk sees the other jobs too
