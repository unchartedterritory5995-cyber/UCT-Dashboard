"""The estimate history snapshot's catch-up (2026-11-23): an 18:20 fire lost to a pod restart is taken while it still
stands for its session, labelled by that session, and past the next open it is a recorded hole, never filled.

Every figure is invented; no vendor is called (the fetch is a stub, the S&P 500 seed is off, and `_fetch_fmp` fails
the test if anything reaches it). Times are built in New York time: 2027-11 holds a weekend and Thanksgiving
(Thursday 2027-11-25), both in session_calendar.
"""
from __future__ import annotations

import ast
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from api.services import estimate_history as eh

NY = ZoneInfo("America/New_York")
TUE = datetime(2027, 11, 16, 18, 20, tzinfo=NY)            # a Tuesday's slot
WED_OPEN = datetime(2027, 11, 17, 9, 30, tzinfo=NY)        # the next session's open
FRI = datetime(2027, 11, 19, 18, 20, tzinfo=NY)            # a Friday's slot
MON_OPEN = datetime(2027, 11, 22, 9, 30, tzinfo=NY)
WED_BEFORE_HOLIDAY = datetime(2027, 11, 24, 18, 20, tzinfo=NY)
THANKSGIVING = datetime(2027, 11, 25, 12, 0, tzinfo=NY)
FRI_AFTER_OPEN = datetime(2027, 11, 26, 9, 30, tzinfo=NY)


@pytest.fixture(autouse=True)
def _store(monkeypatch, tmp_path):
    monkeypatch.setenv("ESTIMATE_HISTORY_DB_PATH", str(tmp_path / "eh.db"))
    monkeypatch.setenv(eh.ENABLED_ENV, "1")
    monkeypatch.setenv("ESTIMATE_HISTORY_SEED_SP500", "0")
    monkeypatch.setattr(eh, "_fetch_fmp", lambda sym: pytest.fail(f"a vendor read for {sym}"))
    yield tmp_path


def _rows(period="2028-03-31", eps=1.25):
    return [{"date": period, "epsAvg": eps, "epsLow": eps - 0.1, "epsHigh": eps + 0.1,
             "revenueAvg": 900.0, "revenueLow": 880.0, "revenueHigh": 920.0,
             "numAnalystsEps": 7, "numAnalystsRevenue": 6}]


def _fetch(calls: list):
    def fetch(sym):
        calls.append(sym)
        return "ok", _rows(), None
    return fetch


def _track(*syms):
    for s in syms:
        assert eh.track(s, "test")


def _snap_dates() -> set:
    with sqlite3.connect(eh.db_path()) as c:
        return {r[0] for r in c.execute("SELECT DISTINCT snap_date FROM estimate_snapshot")}


# ── the schedule and the session a snapshot stands for ──────────────────────────────────────────

def test_the_last_slot_is_the_weekday_1820_at_the_slot_minute_and_over_the_weekend():
    assert eh.last_slot(TUE) == TUE                                                 # at 18:20 the slot has come
    assert eh.last_slot(TUE - timedelta(seconds=1)) == TUE - timedelta(days=1)       # Monday's
    assert eh.last_slot(datetime(2027, 11, 20, 12, 0, tzinfo=NY)) == FRI             # Saturday: Friday's
    assert eh.last_slot(datetime(2027, 11, 22, 18, 19, tzinfo=NY)) == FRI            # Monday before its slot
    assert eh.last_slot(datetime(2027, 11, 16, 23, 30, tzinfo=timezone.utc)) == TUE  # a UTC moment, read in New York


def test_the_session_window_runs_from_the_slot_to_the_next_open():
    assert eh.target_session(TUE) == "2027-11-16"
    assert eh.target_session(TUE - timedelta(seconds=1)) is None                     # Monday's closed at Tuesday's open
    assert eh.target_session(WED_OPEN - timedelta(seconds=1)) == "2027-11-16"
    assert eh.target_session(WED_OPEN) is None                                       # the next session has opened


def test_over_the_weekend_fridays_snapshot_stands_until_mondays_open():
    for now in (FRI, datetime(2027, 11, 20, 10, 0, tzinfo=NY), MON_OPEN - timedelta(seconds=1)):
        assert eh.target_session(now) == "2027-11-19", now
    assert eh.target_session(MON_OPEN) is None


def test_a_holiday_has_no_open_so_the_window_runs_on_and_its_own_evening_is_a_slot():
    assert eh.target_session(THANKSGIVING) == "2027-11-24"                           # no open on Thanksgiving
    assert eh.target_session(datetime(2027, 11, 25, 18, 20, tzinfo=NY)) == "2027-11-25"  # the cron knows no holidays
    assert eh.target_session(FRI_AFTER_OPEN) is None


def test_monday_before_its_slot_is_past_its_own_open_so_no_window():
    # Monday 18:00: the last slot is Friday's and Monday has opened, so a snapshot taken now stands for nothing
    assert eh.target_session(datetime(2027, 11, 22, 18, 0, tzinfo=NY)) is None


# ── behind (pure) ───────────────────────────────────────────────────────────────────────────────

def test_behind_inside_the_window_when_the_sessions_run_never_finished():
    now = TUE + timedelta(hours=2)
    assert eh.behind(None, 0, 3, now) is True                                        # the fire was lost: nothing read
    assert eh.behind({"state": "running"}, 1, 2, now) is True                        # a restart killed the run
    assert eh.behind({"state": "running"}, 3, 0, now) is False                       # killed after its last read
    assert eh.behind({"state": "done"}, 0, 3, now) is False                          # the run finished (budget cut too)
    assert eh.behind(None, 2, 1, now) is False                                       # it ran before receipts existed
    assert eh.behind(None, 0, 0, now) is False                                       # nothing tracked


def test_behind_is_false_outside_every_window():
    assert eh.behind(None, 0, 3, WED_OPEN) is False
    assert eh.behind(None, 0, 3, MON_OPEN + timedelta(hours=3)) is False


def test_the_read_counts_are_the_tracked_symbols_read_and_not_read_for_the_session():
    _track("ZQAA", "ZQAB", "ZQAC")
    eh.snapshot_symbol("ZQAA", "2027-11-16", fetch=_fetch([]))
    eh.snapshot_symbol("ZQAB", "2027-11-16", fetch=lambda s: ("error", None, "invented: refused"))
    eh.snapshot_symbol("ZQAC", "2027-11-15", fetch=_fetch([]))                       # another session's read
    assert eh.read_counts("2027-11-16") == (2, 1) and eh.read_counts("2027-11-17") == (0, 3)


# ── the catch-up ────────────────────────────────────────────────────────────────────────────────

def test_a_lost_fire_is_taken_inside_the_window_and_labelled_by_its_session():
    _track("ZQAA", "ZQAB")
    calls: list = []
    now = datetime(2027, 11, 17, 8, 0, tzinfo=NY)            # Wednesday before the open (Wednesday in UTC too)
    out = eh.catch_up(now, fetch=_fetch(calls), sleep=lambda s: None)
    assert out["started"] is True and out["session"] == "2027-11-16"
    assert calls == ["ZQAA", "ZQAB"]
    assert _snap_dates() == {"2027-11-16"}                                            # never Wednesday's date
    assert eh.job_receipt("2027-11-16")["state"] == "done"
    assert eh.catch_up(now, fetch=_fetch(calls), sleep=lambda s: None)["reason"] == "current"
    assert calls == ["ZQAA", "ZQAB"]                                                   # nothing read twice


def test_a_weekend_catch_up_takes_fridays_snapshot_under_fridays_date():
    _track("ZQAA")
    calls: list = []
    out = eh.catch_up(datetime(2027, 11, 20, 11, 0, tzinfo=NY), fetch=_fetch(calls), sleep=lambda s: None)
    assert out["started"] is True and out["session"] == "2027-11-19" and _snap_dates() == {"2027-11-19"}


def test_a_catch_up_after_the_next_open_takes_nothing_and_records_the_hole():
    _track("ZQAA", "ZQAB")
    calls: list = []
    out = eh.catch_up(WED_OPEN + timedelta(minutes=1), fetch=_fetch(calls), sleep=lambda s: None)
    assert out["started"] is False and out["reason"] == "missed" and out["session"] == "2027-11-16"
    assert calls == [] and _snap_dates() == set()
    assert eh.job_receipt("2027-11-16")["state"] == "missed"
    said = eh.history("ZQAA", register=False)["missed_days"]
    assert [d["snap_date"] for d in said] == ["2027-11-16"] and "did not finish before the next session" in said[0]["detail"]
    again = eh.catch_up(WED_OPEN + timedelta(hours=2), fetch=_fetch(calls), sleep=lambda s: None)
    assert again["reason"] == "missed" and calls == [] and len(eh.missed_days()) == 1


def test_a_catch_up_that_reaches_the_next_open_stops_reading_there_and_records_the_hole(monkeypatch):
    # Review 2026-11-24: the window was checked once, when the catch-up started. A catch-up that starts at Monday
    # 09:29:55 for Friday's unfinished run read on through 09:30 (600 symbols at a 1 s pace take minutes) and stored
    # Monday's estimates under Friday's date. A read due at or after the open is not made, and the hole is recorded.
    import time
    import types
    _track("ZQAA", "ZQAB", "ZQAC", "ZQAD")
    clock = {"t": 1000.0}
    monkeypatch.setattr(eh, "time", types.SimpleNamespace(time=time.time, monotonic=lambda: clock["t"],
                                                          sleep=time.sleep))

    def pace(_s):                                             # each pace between two reads: 2 s on the run's clock
        clock["t"] += 2.0
    calls: list = []
    out = eh.catch_up(MON_OPEN - timedelta(seconds=5), fetch=_fetch(calls), sleep=pace)
    assert out["started"] is True and out["session"] == "2027-11-19"
    assert calls == ["ZQAA", "ZQAB", "ZQAC"]                  # read 0, 2 and 4 s in; the next would be 1 s past the open
    assert _snap_dates() == {"2027-11-19"}
    assert eh.job_receipt("2027-11-19")["state"] == "missed"
    assert [d["snap_date"] for d in eh.missed_days()] == ["2027-11-19"]


def test_a_run_a_restart_killed_is_resumed_and_a_failed_read_is_not_repeated():
    _track("ZQAA", "ZQAB", "ZQAC")
    eh.snapshot_symbol("ZQAA", "2027-11-16", fetch=_fetch([]))
    eh.snapshot_symbol("ZQAB", "2027-11-16", fetch=lambda s: ("error", None, "invented: refused"))
    eh._mark("2027-11-16", "running", "nightly")                                      # killed half way
    calls: list = []
    out = eh.catch_up(TUE + timedelta(hours=3), fetch=_fetch(calls), sleep=lambda s: None)
    assert out["started"] is True and calls == ["ZQAC"]                               # neither the read nor the error


def test_a_session_read_before_receipts_existed_is_not_taken_again_nor_called_a_hole():
    _track("ZQAA", "ZQAB")
    eh.snapshot_symbol("ZQAA", "2027-11-16", fetch=_fetch([]))                      # read by a run with no receipt
    calls: list = []
    assert eh.catch_up(TUE + timedelta(hours=1), fetch=_fetch(calls), sleep=lambda s: None)["reason"] == "current"
    assert eh.catch_up(WED_OPEN + timedelta(hours=1), fetch=_fetch(calls), sleep=lambda s: None)["reason"] == "current"
    assert calls == [] and eh.missed_days() == []


def test_the_catch_up_starts_nothing_when_the_run_finished():
    _track("ZQAA")
    eh._mark("2027-11-16", "running", "nightly")
    eh._mark("2027-11-16", "done", "nightly")
    calls: list = []
    out = eh.catch_up(TUE + timedelta(hours=1), fetch=_fetch(calls), sleep=lambda s: None)
    assert out == {"started": False, "reason": "current", "session": "2027-11-16"} and calls == []


def test_the_catch_up_keeps_the_jobs_own_window_not_the_quiet_span(monkeypatch):
    # 18:45 on a weekday is inside scan_period's busy span; the snapshot runs there by design, and so does its catch-up
    from api.services import catchup_slots
    assert catchup_slots.quiet(TUE + timedelta(minutes=25)) is False
    _track("ZQAA")
    calls: list = []
    assert eh.catch_up(TUE + timedelta(minutes=25), fetch=_fetch(calls), sleep=lambda s: None)["started"] is True
    assert calls == ["ZQAA"]


def test_off_the_catch_up_reads_and_writes_nothing(monkeypatch, _store):
    monkeypatch.delenv(eh.ENABLED_ENV)
    assert eh.catch_up(TUE + timedelta(hours=1)) == {"started": False, "reason": "off"}
    assert not (_store / "eh.db").exists()


def test_the_catch_up_never_runs_beside_the_1820_run():
    _track("ZQAA")
    calls: list = []
    assert eh._RUN_LOCK.acquire(blocking=False)
    try:
        out = eh.catch_up(TUE + timedelta(hours=1), fetch=_fetch(calls), sleep=lambda s: None)
        assert eh.run_scheduled(TUE, fetch=_fetch(calls), sleep=lambda s: None) == {"skipped": "running"}
    finally:
        eh._RUN_LOCK.release()
    assert out["reason"] == "running" and calls == []


def test_a_failed_catch_up_never_marks_the_session_done():
    _track("ZQAA")
    out = eh.catch_up(TUE + timedelta(hours=1), fetch=lambda s: (_ for _ in ()).throw(RuntimeError("invented")),
                      sleep=lambda s: None)
    assert out["started"] is True and out["error"] == "RuntimeError"
    assert eh.job_receipt("2027-11-16")["state"] == "running"
    assert eh.behind(eh.job_receipt("2027-11-16"), *eh.read_counts("2027-11-16"), TUE + timedelta(hours=2)) is True
    assert not eh._RUN_LOCK.locked()


def test_the_scheduled_run_labels_by_the_new_york_session_and_marks_done():
    _track("ZQAA")
    calls: list = []
    out = eh.run_scheduled(TUE, fetch=_fetch(calls), sleep=lambda s: None)
    assert out["ok"] == 1 and _snap_dates() == {"2027-11-16"} and eh.job_receipt("2027-11-16")["state"] == "done"


def test_the_retry_comes_after_the_runs_budget_and_inside_a_weekday_window():
    run_ends = TUE + timedelta(seconds=eh.RUN_BUDGET_S)
    assert (run_ends.hour, run_ends.minute) <= eh.CATCHUP_AT_ET
    retry = TUE.replace(hour=eh.CATCHUP_AT_ET[0], minute=eh.CATCHUP_AT_ET[1])
    assert eh.target_session(retry) == "2027-11-16"


# ── the registration (api/main.py, by AST) ──────────────────────────────────────────────────────

def test_the_evening_job_reads_the_modules_schedule_and_the_run_scheduled_entry():
    from tests.test_insider_clusters_sec import _add_jobs, _kw, _lifespan
    src, life = _lifespan()
    job = _add_jobs(life)["estimate_history_daily"]
    assert ast.unparse(_kw(job, "trigger")) == (
        "CronTrigger(day_of_week=_eh_mod.RUN_DAYS, hour=_eh_mod.RUN_AT_ET[0], minute=_eh_mod.RUN_AT_ET[1], "
        "timezone=_ET)")
    defs = {n.name: n for n in ast.walk(life) if isinstance(n, ast.FunctionDef)}
    assert "_eh.run_scheduled()" in ast.get_source_segment(src, defs["_estimate_history_job"])


def test_the_catch_up_is_a_date_job_after_boot_and_a_daily_retry_under_its_own_boot_mark():
    from tests.test_fund_holders_nport import _boot_level_calls
    from tests.test_insider_clusters_sec import _add_jobs, _kw, _lifespan, _lit
    src, life = _lifespan()
    jobs = _add_jobs(life)
    boot, retry = jobs["estimate_history_catchup_boot"], jobs["estimate_history_catchup"]
    defs = {n.name: n for n in ast.walk(life) if isinstance(n, ast.FunctionDef)}
    for call in (boot, retry):
        body = ast.get_source_segment(src, defs[call.args[0].id])
        assert ".catch_up()" in body and "run_scheduled" not in body
    assert _lit(boot, "trigger") == "date" and _lit(boot, "kwargs") == {"source": "boot"}
    assert "seconds=_eh_cu.CATCHUP_BOOT_DELAY_S" in ast.unparse(_kw(boot, "run_date"))
    assert ast.unparse(_kw(retry, "trigger")) == (
        "CronTrigger(hour=_eh_cu.CATCHUP_AT_ET[0], minute=_eh_cu.CATCHUP_AT_ET[1], timezone=_ET)")
    assert (_lit(retry, "coalesce"), _lit(retry, "max_instances")) == (True, 1)
    at_boot = _boot_level_calls(life)
    assert "_boot_mark" in at_boot and not {"catch_up", "_estimate_history_catch_up_job"} & set(at_boot)
    marks = sorted((c.lineno, c.args[0].value) for c in ast.walk(life)
                   if isinstance(c, ast.Call) and getattr(c.func, "id", "") == "_boot_mark")
    names = [n for _, n in marks]
    assert names.count("EEH-catch-up") == 1
    i = names.index("EEH-catch-up")
    for call in (boot, retry):
        assert marks[i][0] < call.lineno < marks[i + 1][0]


def test_every_boot_catch_up_starts_apart_from_the_others():
    from api.services import filing_search, ftd_dataset, fund_holders_nport, insider_clusters_sec
    from api.services.research import iv_rank_leaders
    import api.main as m
    delays = [insider_clusters_sec.CATCHUP_BOOT_DELAY_S, iv_rank_leaders.CATCHUP_BOOT_DELAY_S,
              fund_holders_nport.CATCHUP_BOOT_DELAY_S, eh.CATCHUP_BOOT_DELAY_S, m.RS_LISTS_CATCHUP_BOOT_DELAY_S,
              filing_search.CATCHUP_BOOT_DELAY_S, ftd_dataset.CATCHUP_BOOT_DELAY_S]
    assert delays == sorted(delays) and all(b - a >= 300 for a, b in zip(delays, delays[1:])), delays
