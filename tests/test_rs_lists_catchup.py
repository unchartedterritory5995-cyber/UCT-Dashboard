"""The RS lists' own catch-up (2026-11-23): a lone missed 04:40 no longer leaves the ready-made RS lists a session old.

The receipt readers (`rs_lists.last_run`, `rs_lists._last_written_session`) and the job (`rs_lists.nightly_job`) are
stubs here; the session clock is the real one (`rs_history.settled_session`, session_calendar), so the dates are in
2027, inside the calendar: a weekend and Thanksgiving (Thursday 2027-11-25). Times are built in New York time.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

import api.main as m
from api.services import rs_lists as rl

NY = ZoneInfo("America/New_York")
TUE_SLOT = datetime(2027, 11, 16, 4, 40, tzinfo=NY)
SUN_SLOT = datetime(2027, 11, 21, 4, 40, tzinfo=NY)
FRI_AFTER_HOLIDAY = datetime(2027, 11, 26, 4, 40, tzinfo=NY)


@pytest.fixture
def lists(monkeypatch):
    """The lists' receipts as the catch-up reads them, and the job's calls."""
    state = {"last_run": None, "wrote": None, "calls": []}
    monkeypatch.setenv(rl.FLAG, "1")
    monkeypatch.delenv("RS_SCREENS_ENABLED", raising=False)
    monkeypatch.setattr(rl, "last_run", lambda: state["last_run"])
    monkeypatch.setattr(rl, "_last_written_session", lambda: state["wrote"])
    monkeypatch.setattr(rl, "nightly_job", lambda: state["calls"].append(1) or {"enabled": True, "lists": {}})
    return state


def test_the_last_slot_is_0440_at_the_slot_minute_and_every_day():
    assert m._rs_lists_last_slot(TUE_SLOT) == TUE_SLOT
    assert m._rs_lists_last_slot(TUE_SLOT - timedelta(seconds=1)) == TUE_SLOT - timedelta(days=1)
    assert m._rs_lists_last_slot(SUN_SLOT + timedelta(hours=3)) == SUN_SLOT                 # the cron runs every day
    assert m._rs_lists_last_slot((TUE_SLOT + timedelta(minutes=1)).astimezone(timezone.utc)) == TUE_SLOT


def test_the_target_is_the_settled_session_at_the_slot_holidays_and_weekends_known():
    assert m._rs_lists_target_session(TUE_SLOT + timedelta(minutes=30)) == "2027-11-15"
    assert m._rs_lists_target_session(SUN_SLOT + timedelta(minutes=30)) == "2027-11-19"     # Friday's
    assert m._rs_lists_target_session(FRI_AFTER_HOLIDAY + timedelta(minutes=5)) == "2027-11-24"  # not Thanksgiving


def test_behind_at_the_edges():
    now = TUE_SLOT + timedelta(minutes=30)
    before, since = (TUE_SLOT - timedelta(seconds=1)).timestamp(), TUE_SLOT.timestamp()
    assert m._rs_lists_behind(None, None, now) is True                                     # never written
    assert m._rs_lists_behind({"ran_at": before}, "2027-11-12", now) is True                # the 04:40 fire was lost
    assert m._rs_lists_behind({"ran_at": before}, "2027-11-15", now) is False               # written for the session
    assert m._rs_lists_behind({"ran_at": since, "skipped": "the rating history's newest session (2027-11-12) "
                               "is older than the screener session (2027-11-15)"}, "2027-11-12", now) is False
    assert m._rs_lists_behind({"ran_at": since, "skipped": "error: OperationalError: locked"},
                              "2027-11-12", now) is True                                    # an error did not run it
    assert m._rs_lists_behind({"ran_at": before}, "2027-11-12", TUE_SLOT - timedelta(seconds=1)) is False  # Monday's


def test_over_the_weekend_fridays_lists_are_current_until_monday_has_settled():
    sat_written = {"ran_at": datetime(2027, 11, 20, 4, 41, tzinfo=NY).timestamp()}
    assert m._rs_lists_behind(sat_written, "2027-11-19", SUN_SLOT + timedelta(hours=8)) is False
    tue = TUE_SLOT + timedelta(days=7)
    assert m._rs_lists_behind(sat_written, "2027-11-19", tue + timedelta(minutes=5)) is True   # Monday's session due


def test_the_catch_up_runs_the_lists_when_behind_in_the_quiet_span(lists):
    lists["last_run"], lists["wrote"] = {"ran_at": (TUE_SLOT - timedelta(days=1)).timestamp()}, "2027-11-12"
    out = m._run_rs_lists_catchup("boot", now=TUE_SLOT + timedelta(minutes=30))
    assert out == {"started": True, "reason": "behind"} and lists["calls"] == [1]


def test_the_catch_up_starts_nothing_when_current(lists):
    lists["last_run"], lists["wrote"] = {"ran_at": TUE_SLOT.timestamp()}, "2027-11-15"
    assert m._run_rs_lists_catchup("boot", now=TUE_SLOT + timedelta(minutes=30)) == {"started": False,
                                                                                        "reason": "current"}
    assert lists["calls"] == []


@pytest.mark.parametrize("busy", [datetime(2027, 11, 16, 7, 0, tzinfo=NY), datetime(2027, 11, 16, 12, 0, tzinfo=NY),
                                  datetime(2027, 11, 16, 20, 14, tzinfo=NY)])
def test_a_boot_in_the_busy_span_while_behind_starts_nothing(lists, busy):
    assert m._rs_lists_behind(None, None, busy) is True
    assert m._run_rs_lists_catchup("boot", now=busy) == {"started": False, "reason": "not_quiet"}
    assert lists["calls"] == []


def test_the_evening_retry_runs_it_in_the_quiet_span(lists):
    evening = TUE_SLOT.replace(hour=m.RS_LISTS_CATCHUP_AT_ET[0], minute=m.RS_LISTS_CATCHUP_AT_ET[1])
    assert m._run_rs_lists_catchup("retry", now=evening)["started"] is True and lists["calls"] == [1]


def test_off_the_catch_up_reads_nothing(lists, monkeypatch):
    monkeypatch.delenv(rl.FLAG)
    monkeypatch.setattr(rl, "last_run", lambda: pytest.fail("read while off"))
    assert m._run_rs_lists_catchup("boot", now=TUE_SLOT + timedelta(minutes=30)) == {"started": False,
                                                                                        "reason": "off"}


def test_the_catch_up_never_runs_beside_the_0440_run(lists, capsys):
    assert m._RS_LISTS_RUN_LOCK.acquire(blocking=False)
    try:
        out = m._run_rs_lists_catchup("boot", now=TUE_SLOT + timedelta(minutes=30))
        m._run_rs_lists()                                                # the cron's door, while one runs
    finally:
        m._RS_LISTS_RUN_LOCK.release()
    assert out == {"started": False, "reason": "running"} and lists["calls"] == []
    assert "a run is already going" in capsys.readouterr().out


def test_the_catch_up_never_raises(lists, monkeypatch):
    monkeypatch.setattr(rl, "last_run", lambda: (_ for _ in ()).throw(RuntimeError("invented")))
    assert m._run_rs_lists_catchup("boot", now=TUE_SLOT)["reason"] == "error: RuntimeError"


# ── the registration ────────────────────────────────────────────────────────────────────────────

class _Sched:
    def __init__(self):
        self.jobs = {}

    def add_job(self, fn, **k):
        self.jobs[k.get("id")] = (fn, k)


def _field(trigger, name) -> str:
    return next(str(f) for f in trigger.fields if f.name == name)


def test_the_catch_up_is_a_boot_date_job_and_an_evening_retry_beside_the_0440_job(monkeypatch):
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setattr(m, "start_screener_snapshot_warm", lambda: None)
    sched = _Sched()
    before = datetime.now(NY)
    assert m.register_screener_jobs(sched) is True
    fn, kw = sched.jobs["rs_lists_nightly"]
    assert (_field(kw["trigger"], "hour"), _field(kw["trigger"], "minute")) == tuple(map(str, m.RS_LISTS_NIGHTLY_ET))
    fn, kw = sched.jobs["rs_lists_catchup_boot"]
    assert fn is m._run_rs_lists_catchup and kw["trigger"] == "date" and kw["kwargs"] == {"source": "boot"}
    delay = (kw["run_date"] - before).total_seconds()
    assert m.RS_LISTS_CATCHUP_BOOT_DELAY_S - 5 <= delay <= m.RS_LISTS_CATCHUP_BOOT_DELAY_S + 60
    assert kw["max_instances"] == 1 and kw["misfire_grace_time"] >= 60
    fn, kw = sched.jobs["rs_lists_catchup"]
    assert fn is m._run_rs_lists_catchup and kw["kwargs"] == {"source": "retry"}
    assert (_field(kw["trigger"], "hour"), _field(kw["trigger"], "minute")) == tuple(map(str, m.RS_LISTS_CATCHUP_AT_ET))
    assert kw["coalesce"] is True and kw["max_instances"] == 1


def test_the_catch_up_add_jobs_sit_under_no_flag():
    import ast
    import pathlib
    src = pathlib.Path(m.__file__).read_text(encoding="utf-8")
    fn = next(n for n in ast.walk(ast.parse(src))
              if isinstance(n, ast.FunctionDef) and n.name == "register_screener_jobs")
    depth = {}

    def _walk(body, d):
        for stmt in body:
            if isinstance(stmt, ast.If):
                _walk(stmt.body, d + 1)
                _walk(stmt.orelse, d + 1)
                continue
            for node in ast.walk(stmt):
                if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "add_job":
                    for k in node.keywords:
                        if k.arg == "id" and isinstance(k.value, ast.Constant):
                            depth[k.value.value] = d

    _walk(fn.body, 0)
    assert depth.get("rs_lists_catchup_boot") == 0 and depth.get("rs_lists_catchup") == 0
    assert depth.get("screener_scan_sweep", 0) >= 1                    # control: the probe sees gating
