"""The five 02:xx Screener side pulls' catch-up (2026-11-23): a pull whose fire was lost to a pod restart is repeated
once that night, inside the quiet span, one pull after another and never across the 03:00 build's start; a pull that
ran and was refused is never repeated; the build's receipt names any side file it read stale.

No vendor, R2 or scrape is reached: the runners are stubs (`side_pulls._runner`). Times are built in New York time;
every figure is invented.
"""
from __future__ import annotations

import inspect
import os
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from api.services.screener import side_pulls as sp

NY = ZoneInfo("America/New_York")
BUILD = (3, 0)
DAY = datetime(2027, 11, 16, tzinfo=NY)                     # a Tuesday


def _slot(name, day=DAY):
    return day.replace(hour=sp.PULLS[name].run_at[0], minute=sp.PULLS[name].run_at[1])


def _at(h, m, day=DAY):
    return day.replace(hour=h, minute=m)


@pytest.fixture
def pulls(monkeypatch, tmp_path):
    """Receipts on a temporary data directory, every file's moment set by the test, every runner a stub."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    sp.reset_for_tests()
    state = {"moments": {n: (_slot(n) - timedelta(days=1)).timestamp() for n in sp.PULLS},   # yesterday's files
             "calls": [], "active": 0, "max_active": 0, "fail": set(), "writes": True, "clock": _at(2, 47)}

    def runner(name):
        def run():
            state["active"] += 1
            state["max_active"] = max(state["max_active"], state["active"])
            state["calls"].append(name)
            try:
                if name in state["fail"]:
                    raise RuntimeError("invented failure")
                if state["writes"]:
                    state["moments"][name] = state["clock"].timestamp()
                return {"wrote": state["writes"], "rows": 1200, "kept": 1100}
            finally:
                state["active"] -= 1
        return run

    monkeypatch.setattr(sp, "_runner", runner)
    monkeypatch.setattr(sp, "_now_ts", lambda: state["clock"].timestamp())
    monkeypatch.setattr(sp, "file_moment", lambda name: state["moments"].get(name))
    yield state
    sp.reset_for_tests()


# ── the clock, behind and missed ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("name", sorted(sp.PULLS))
def test_the_last_slot_at_the_slot_minute_the_second_before_and_on_a_weekend(name):
    slot = _slot(name)
    assert sp.last_slot(name, slot) == slot
    assert sp.last_slot(name, slot - timedelta(seconds=1)) == slot - timedelta(days=1)
    saturday = _slot(name, datetime(2027, 11, 20, tzinfo=NY))
    assert sp.last_slot(name, saturday + timedelta(hours=5)) == saturday            # every day, weekends too
    assert sp.last_slot(name, slot.astimezone(timezone.utc)) == slot


@pytest.mark.parametrize("name", sorted(sp.PULLS))
def test_behind_is_a_file_older_than_the_nights_slot(name):
    slot = _slot(name)
    yesterday = (slot - timedelta(seconds=1)).timestamp()
    assert sp.behind(name, None, slot) is True                                      # no file at all
    assert sp.behind(name, yesterday, slot) is True                                 # at the slot minute
    assert sp.behind(name, yesterday, slot - timedelta(seconds=1)) is False         # the second before
    assert sp.behind(name, slot.timestamp(), slot + timedelta(minutes=3)) is False


def test_missed_only_when_no_nightly_finished_since_the_slot():
    slot, name = _slot("finviz_universe"), "finviz_universe"
    old = (slot - timedelta(days=1)).timestamp()
    now = slot + timedelta(minutes=3)
    ran = {"nightly": {"finished_at": (slot + timedelta(seconds=40)).astimezone(timezone.utc).isoformat()}}
    killed = {"nightly": {"started_at": slot.isoformat(), "finished_at": None}}
    yesterdays = {"nightly": {"finished_at": (slot - timedelta(hours=23)).isoformat()}}
    assert sp.missed(name, old, {}, now) is True                                    # the fire was lost
    assert sp.missed(name, old, killed, now) is True                                # a restart killed it
    assert sp.missed(name, old, yesterdays, now) is True
    assert sp.missed(name, old, ran, now) is False                                  # it ran and was refused
    assert sp.missed(name, slot.timestamp(), {}, now) is False                      # the file is tonight's


# ── each pull's file is read where its module writes it ─────────────────────────────────────────

def test_file_moment_reads_each_modules_own_artifact_and_store(monkeypatch, tmp_path):
    for env, fname in (("SCREENER_FINVIZ_ARTIFACT", "fv.json"), ("SCREENER_EDATES_ARTIFACT", "ed.json"),
                       ("SCREENER_OPTFLOW_ARTIFACT", "of.json")):
        p = tmp_path / fname
        p.write_text("{}", encoding="utf-8")
        os.utime(p, (1_900_000_000, 1_900_000_000))
        monkeypatch.setenv(env, str(p))
    monkeypatch.setenv("SCREENER_INSIDER_DB_PATH", str(tmp_path / "ins.db"))
    monkeypatch.setenv("SCREENER_ANALYST_DB_PATH", str(tmp_path / "an.db"))
    assert sp.file_moment("insider_capture") is None and sp.file_moment("analyst_pass") is None   # no store yet
    assert not (tmp_path / "ins.db").exists()                                        # and none created by the read
    with sqlite3.connect(tmp_path / "ins.db") as c:
        c.execute("CREATE TABLE cluster_latest (ticker TEXT, captured_at INTEGER)")
        c.executemany("INSERT INTO cluster_latest VALUES (?, ?)", [("ZQAA", 1_900_000_100), ("ZQAB", 1_900_000_050)])
    with sqlite3.connect(tmp_path / "an.db") as c:
        c.execute("CREATE TABLE analyst_rows (ticker TEXT, fetched_at INTEGER)")
        c.executemany("INSERT INTO analyst_rows VALUES (?, ?)", [("ZQAA", 1_900_000_200), ("ZQAB", 1_900_000_150)])
        c.execute("CREATE TABLE analyst_runs (started_at INTEGER)")              # a run row is NOT the file's day
        c.execute("INSERT INTO analyst_runs VALUES (1900000900)")
    assert [sp.file_moment(n) for n in ("finviz_universe", "earnings_dates", "opt_flow")] == [1_900_000_000.0] * 3
    assert sp.file_moment("insider_capture") == 1_900_000_100.0
    assert sp.file_moment("analyst_pass") == 1_900_000_200.0


# ── one pull's catch-up ─────────────────────────────────────────────────────────────────────────

def test_a_lost_fire_is_repeated_before_the_build_and_recorded(pulls):
    now = _at(2, 47)                                         # the pod came back after the 02:45 fire
    pulls["clock"] = now
    out = sp.catch_up("finviz_universe", build_at=BUILD, now=now)
    assert out == {"started": True, "reason": "behind", "outcome": "wrote"}
    assert pulls["calls"] == ["finviz_universe"]
    rec = sp.receipts("finviz_universe")["catch_up"]
    assert rec["slot"] == _slot("finviz_universe").isoformat() and rec["outcome"] == "wrote" and rec["finished_at"]
    assert sp.catch_up("finviz_universe", build_at=BUILD, now=now + timedelta(minutes=1))["reason"] == "current"


def test_a_pull_that_ran_and_was_refused_is_never_repeated(pulls):
    pulls["writes"] = False
    pulls["clock"] = _slot("earnings_dates") + timedelta(seconds=30)
    sp.run_nightly("earnings_dates", now=_slot("earnings_dates"))                   # the 02:50 fire ran, wrote nothing
    assert sp.receipts("earnings_dates")["nightly"]["outcome"] == "refused"
    out = sp.catch_up("earnings_dates", build_at=BUILD, now=_at(2, 52))
    assert out == {"started": False, "reason": "nightly_ran"} and pulls["calls"] == ["earnings_dates"]


def test_one_catch_up_a_night_and_a_failed_one_never_makes_the_file_current(pulls):
    pulls["fail"].add("insider_capture")
    now = pulls["clock"] = _at(2, 42)
    assert sp.catch_up("insider_capture", build_at=BUILD, now=now)["outcome"] == "failed: RuntimeError"
    assert sp.behind("insider_capture", pulls["moments"]["insider_capture"], now) is True
    assert sp.catch_up("insider_capture", build_at=BUILD, now=now + timedelta(minutes=5))["reason"] == "tried"
    assert pulls["calls"] == ["insider_capture"]                                    # no second read that night
    tomorrow = pulls["clock"] = now + timedelta(days=1)
    pulls["fail"].clear()
    assert sp.catch_up("insider_capture", build_at=BUILD, now=tomorrow)["started"] is True   # the next night's own


def test_after_a_restart_the_receipts_are_read_from_disk(pulls):
    now = _at(2, 47)
    pulls["writes"] = False
    sp.catch_up("finviz_universe", build_at=BUILD, now=now)
    sp.reset_for_tests()                                                            # a new process
    assert sp.catch_up("finviz_universe", build_at=BUILD, now=now + timedelta(minutes=2))["reason"] == "tried"
    assert pulls["calls"] == ["finviz_universe"]


@pytest.mark.parametrize("busy", [_at(7, 0), _at(12, 0), _at(20, 14)])
def test_a_boot_in_the_busy_span_starts_nothing(pulls, busy):
    assert sp.catch_up("finviz_universe", build_at=BUILD, now=busy) == {"started": False, "reason": "not_quiet"}
    assert pulls["calls"] == []


def test_the_quiet_span_is_scan_periods_read_in_new_york_time(pulls, monkeypatch):
    from api.services import scan_period
    seen = []
    monkeypatch.setattr(scan_period, "_reuse_quiet_now", lambda now=None: seen.append(now) or False)
    night = _at(2, 47).astimezone(timezone.utc)
    assert sp.catch_up("finviz_universe", build_at=BUILD, now=night)["reason"] == "not_quiet"
    assert seen == [night.astimezone(NY)] and pulls["calls"] == []


@pytest.mark.parametrize("now", [_at(2, 56), _at(3, 0), _at(3, 14)])
def test_no_catch_up_runs_across_the_builds_start_or_inside_its_first_minutes(pulls, now):
    # 02:56 + the pull's 300 s would still run at 03:00; from 03:00 the build is reading the side files
    assert sp.catch_up("finviz_universe", build_at=BUILD, now=now) == {"started": False, "reason": "build_window"}
    assert pulls["calls"] == []


def test_after_the_build_has_read_its_files_the_catch_up_runs(pulls):
    assert sp.catch_up("finviz_universe", build_at=BUILD, now=_at(3, 16))["started"] is True


def test_the_analyst_pass_runs_to_its_deadline_so_it_waits_for_the_build_and_its_deadline_bounds_it(pulls):
    assert sp.catch_up("analyst_pass", build_at=BUILD, now=_at(2, 10))["reason"] == "build_window"
    assert sp.catch_up("analyst_pass", build_at=BUILD, now=_at(4, 40))["reason"] == "past_deadline"
    assert sp.catch_up("analyst_pass", build_at=BUILD, now=_at(23, 0))["reason"] == "past_deadline"
    assert pulls["calls"] == []
    assert sp.catch_up("analyst_pass", build_at=BUILD, now=_at(3, 20))["started"] is True


def test_the_catch_up_never_runs_beside_its_own_nightly(pulls):
    lock = sp._locks["opt_flow"]
    assert lock.acquire(blocking=False)
    try:
        assert sp.catch_up("opt_flow", build_at=BUILD, now=_at(2, 56))["reason"] == "running"
        assert sp.run_nightly("opt_flow") == {"skipped": "running"}
    finally:
        lock.release()
    assert pulls["calls"] == []


# ── the one boot catch-up: one pull after another ───────────────────────────────────────────────

def test_the_boot_catch_up_takes_the_pulls_one_after_another_and_only_the_registered_ones(pulls):
    ticks = iter([_at(2, 41), _at(2, 43), _at(2, 46), _at(2, 51), _at(3, 20)])

    def tick():
        pulls["clock"] = next(ticks)
        return pulls["clock"]

    out = sp.catch_up_all(("finviz_universe", "insider_capture", "earnings_dates", "opt_flow", "analyst_pass"),
                          build_at=BUILD, clock=tick)
    assert pulls["max_active"] == 1                                                  # never two at once
    assert list(out) == list(sp.CATCHUP_ORDER) and sp.CATCHUP_ORDER[-1] == "analyst_pass"
    # 02:41: the insider fire (02:40) was lost; 02:43 is before finviz's 02:45 slot, so yesterday's file is current
    assert out["insider_capture"]["started"] is True and out["finviz_universe"]["reason"] == "current"
    assert out["analyst_pass"]["started"] is True
    assert pulls["calls"] == ["insider_capture", "analyst_pass"]
    assert sp.catch_up_all(("opt_flow",), build_at=BUILD, now=_at(2, 50)) == {
        "opt_flow": {"started": False, "reason": "current"}}                     # before its slot: yesterday's is due


def test_one_pulls_error_never_costs_the_others(pulls, monkeypatch):
    real = sp.catch_up
    monkeypatch.setattr(sp, "catch_up", lambda name, **k: (_ for _ in ()).throw(RuntimeError("x"))
                        if name == "insider_capture" else real(name, **k))
    out = sp.catch_up_all(("insider_capture", "finviz_universe"), build_at=BUILD, now=_at(2, 47))
    assert out["insider_capture"]["reason"] == "error: RuntimeError" and out["finviz_universe"]["started"] is True


def test_the_nightly_entry_records_its_start_and_end(pulls):
    receipt = sp.run_nightly("insider_capture", now=_slot("insider_capture"))
    rec = sp.receipts("insider_capture")["nightly"]
    assert receipt["wrote"] is True and rec["outcome"] == "wrote" and rec["finished_at"] and rec["summary"]["rows"] == 1200


# ── the build's receipt ─────────────────────────────────────────────────────────────────────────

def test_the_build_read_names_every_stale_side_file(pulls):
    now = _at(3, 1)
    pulls["moments"]["finviz_universe"] = _at(2, 45, DAY).timestamp() + 30           # tonight's
    pulls["moments"]["opt_flow"] = None                                              # never written
    got = sp.build_read(now)
    assert got["stale"] == ["analyst_pass", "insider_capture", "earnings_dates", "opt_flow"]
    assert got["files"]["finviz_universe"]["stale"] is False and got["files"]["opt_flow"]["file_at"] is None
    assert sp.last_build_read()["stale"] == got["stale"]


def test_the_build_read_never_raises(pulls, monkeypatch):
    monkeypatch.setattr(sp, "file_moment", lambda name: (_ for _ in ()).throw(OSError("invented")))
    assert "error" in sp.build_read(_at(3, 1))


def test_the_builder_reads_it_beside_the_side_files_and_puts_it_in_its_receipt():
    from api.services.screener import snapshot_builder
    src = inspect.getsource(snapshot_builder._run_build_locked)
    assert src.index("side_pulls.build_read()") < src.index('"finviz_universe", finviz_universe.read_finviz_fields')
    assert '"side_files": side_files' in src


# ── the registrations ───────────────────────────────────────────────────────────────────────────

class _Sched:
    def __init__(self):
        self.jobs = {}

    def add_job(self, fn, **k):
        self.jobs[k.get("id")] = (fn, k)


def _field(trigger, name) -> str:
    return next(str(f) for f in trigger.fields if f.name == name)


def test_each_cron_reads_its_pulls_slot_and_the_boot_catch_up_covers_the_registered_pulls(monkeypatch):
    import api.main as m
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setenv("SCREENER_OPTFLOW_PULL_ENABLED", "0")
    monkeypatch.setenv("SCREENER_ANALYST_PASS_ENABLED", "1")
    monkeypatch.setattr(m, "start_screener_snapshot_warm", lambda: None)
    sched = _Sched()
    before = datetime.now(NY)
    assert m.register_screener_jobs(sched) is True
    for name, pull in sp.PULLS.items():
        if name == "opt_flow":
            assert pull.job_id not in sched.jobs
            continue
        trig = sched.jobs[pull.job_id][1]["trigger"]
        assert (_field(trig, "hour"), _field(trig, "minute")) == tuple(map(str, pull.run_at)), name
    build = sched.jobs["screener_snapshot_nightly"][1]["trigger"]
    assert (_field(build, "hour"), _field(build, "minute")) == tuple(map(str, m.SCREENER_NIGHTLY_ET))
    fn, kw = sched.jobs["screener_side_pulls_catchup_boot"]
    assert kw["trigger"] == "date" and kw["max_instances"] == 1 and kw["misfire_grace_time"] >= 60
    assert set(kw["kwargs"]["names"]) == set(sp.PULLS) - {"opt_flow"}
    delay = (kw["run_date"] - before).total_seconds()
    assert sp.CATCHUP_BOOT_DELAY_S - 5 <= delay <= sp.CATCHUP_BOOT_DELAY_S + 60
    seen, warmed = {}, []
    monkeypatch.setattr(sp, "catch_up_all", lambda names, **k: seen.update(names=names, **k) or {})
    monkeypatch.setattr(m, "_run_dividends_market_warm", lambda source="nightly", now=None: warmed.append(source))
    fn(**kw["kwargs"])
    assert seen == {"names": kw["kwargs"]["names"], "build_at": m.SCREENER_NIGHTLY_ET}
    assert warmed == ["boot"]                                                     # DVD MARKET's warm, after the pulls


def test_each_nightly_wrapper_runs_its_pull_through_run_nightly(monkeypatch):
    import api.main as m
    monkeypatch.setenv("SCREENER_SNAPSHOT_ENABLED", "1")
    monkeypatch.setenv("SCREENER_ANALYST_PASS_ENABLED", "1")
    monkeypatch.setattr(m, "start_screener_snapshot_warm", lambda: None)
    sched = _Sched()
    m.register_screener_jobs(sched)
    ran = []
    monkeypatch.setattr(sp, "run_nightly", lambda name, now=None: ran.append(name) or {"wrote": True})
    for name, pull in sp.PULLS.items():
        sched.jobs[pull.job_id][0]()
    assert sorted(ran) == sorted(sp.PULLS)


def test_the_boot_catch_up_starts_apart_from_every_other_boot_job_and_before_ins_cluster():
    from api.services import insider_clusters_sec
    import api.main as m
    others = {120, 180, 240, 300, 360, 600, 720, 900, 1200, m.DISCORD_RENDER_SMOKE_DELAY_S,
              m.RS_HISTORY_BOOT_CATCHUP_DELAY_S}
    assert sp.CATCHUP_BOOT_DELAY_S not in others
    assert m.RS_HISTORY_BOOT_CATCHUP_DELAY_S < sp.CATCHUP_BOOT_DELAY_S < insider_clusters_sec.CATCHUP_BOOT_DELAY_S
