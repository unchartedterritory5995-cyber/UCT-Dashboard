"""The catch-ups of the 03:40 filing search re-read and the 06:10 fails-to-deliver ingest (2026-11-23): a fire lost to
a pod restart is run again when no run has finished since the last slot, only inside scan_period's quiet span, one
run at a time with the nightly job.

Both modules have the same shape, so most tests run once for each. Nothing reaches the SEC: the per-symbol index and
the per-file ingest are stubs. Times are built in New York time; every figure is invented.
"""
from __future__ import annotations

import ast
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from api.services import filing_search as fs
from api.services import ftd_dataset as ftd

NY = ZoneInfo("America/New_York")
TUESDAY = datetime(2027, 11, 16, tzinfo=NY)


class _Job:
    """One module's catch-up as the tests drive it."""

    def __init__(self, mod, enabled_env, db_env, lock, stub_name):
        self.mod, self.enabled_env, self.db_env, self.lock, self.stub_name = mod, enabled_env, db_env, lock, stub_name

    def slot(self, day=TUESDAY):
        return day.replace(hour=self.mod.RUN_AT_ET[0], minute=self.mod.RUN_AT_ET[1])

    def run(self):
        return self.mod.run_reindex() if self.mod is fs else self.mod.run_ingest()


JOBS = {
    "filing_search": _Job(fs, "FILING_SEARCH_ENABLED", "FILING_SEARCH_DB_PATH", "_reindex_lock", "index_symbol"),
    "ftd": _Job(ftd, "FTD_DATASET_ENABLED", "FTD_DB_PATH", "_ingest_lock", "ingest_file"),
}


@pytest.fixture(params=sorted(JOBS))
def job(request, monkeypatch, tmp_path):
    j = JOBS[request.param]
    monkeypatch.setenv(j.db_env, str(tmp_path / f"{request.param}.db"))
    monkeypatch.setenv(j.enabled_env, "1")
    j.calls = []
    if j.mod is fs:
        monkeypatch.setattr(fs, "_sec_get", lambda url: pytest.fail(f"an SEC read: {url}"))
        monkeypatch.setattr(fs, "index_symbol", lambda sym: j.calls.append(sym) or {"state": "ok"})
        with fs._write_lock, fs._conn() as c:                     # one tracked symbol due for its weekly re-read
            c.execute("INSERT INTO fs_tracked (sym, added_at, last_try) VALUES ('ZQAA', 1, 1)")
            c.commit()
    else:
        monkeypatch.setattr(ftd, "_sec_get", lambda url: pytest.fail(f"an SEC read: {url}"))
        monkeypatch.setattr(ftd, "ingest_file", lambda name, get=None: j.calls.append(name) or
                            {"name": name, "state": "not_published"})
    return j


def _receipt_at(moment: datetime) -> dict:
    return {"finished_at": int(moment.timestamp()), "summary": {}}


def test_the_last_slot_at_the_slot_minute_the_minute_before_and_on_a_weekend(job):
    slot = job.slot()
    assert job.mod.last_slot(slot) == slot
    assert job.mod.last_slot(slot - timedelta(seconds=1)) == slot - timedelta(days=1)
    saturday = job.slot(datetime(2027, 11, 20, tzinfo=NY))
    assert job.mod.last_slot(saturday + timedelta(hours=1)) == saturday                # a daily job: weekends too
    assert job.mod.last_slot((slot + timedelta(minutes=5)).astimezone(timezone.utc)) == slot


def test_behind_at_the_edges(job):
    slot = job.slot()
    assert job.mod.behind(None, slot) is True
    assert job.mod.behind(_receipt_at(slot - timedelta(seconds=1)), slot) is True        # yesterday's run, at the slot
    assert job.mod.behind(_receipt_at(slot - timedelta(seconds=1)), slot - timedelta(seconds=1)) is False
    assert job.mod.behind(_receipt_at(slot), slot + timedelta(minutes=1)) is False
    assert job.mod.behind({"finished_at": "this morning"}, slot) is True


def test_a_finished_run_writes_the_receipt_behind_reads(job):
    out = job.run()
    assert not out.get("skipped")
    rec = job.mod.receipt()
    assert isinstance(rec["finished_at"], int)
    moment = datetime.fromtimestamp(rec["finished_at"], NY)
    assert job.mod.behind(rec, moment) is False


def test_the_catch_up_runs_the_job_when_behind_in_the_quiet_span_and_nothing_once_current(job):
    quiet = job.slot() + timedelta(minutes=20)
    out = job.mod.catch_up(quiet)
    assert out["started"] is True and job.calls
    asked = len(job.calls)
    later = datetime.fromtimestamp(job.mod.receipt()["finished_at"], NY)
    assert job.mod.catch_up(later) == {"started": False, "reason": "current"} and len(job.calls) == asked


@pytest.mark.parametrize("busy", [datetime(2027, 11, 16, 7, 0, tzinfo=NY), datetime(2027, 11, 16, 13, 0, tzinfo=NY),
                                  datetime(2027, 11, 16, 20, 14, tzinfo=NY)])
def test_a_boot_in_the_busy_span_while_behind_starts_nothing(job, busy):
    assert job.mod.behind(job.mod.receipt(), busy) is True
    assert job.mod.catch_up(busy) == {"started": False, "reason": "not_quiet"} and job.calls == []


def test_the_quiet_span_is_scan_periods_read_in_new_york_time(job, monkeypatch):
    from api.services import scan_period
    seen = []
    monkeypatch.setattr(scan_period, "_reuse_quiet_now", lambda now=None: seen.append(now) or False)
    night = (job.slot() + timedelta(minutes=30)).astimezone(timezone.utc)
    assert job.mod.catch_up(night)["reason"] == "not_quiet" and job.calls == []
    assert seen == [night.astimezone(NY)] and seen[0].tzinfo == NY


def test_the_catch_up_never_runs_beside_the_nightly_job(job):
    lock = getattr(job.mod, job.lock)
    assert lock.acquire(blocking=False)
    try:
        assert job.mod.catch_up(job.slot() + timedelta(minutes=20)) == {"started": False, "reason": "running"}
        assert job.run() == {"skipped": "running"}
    finally:
        lock.release()
    assert job.calls == []


def test_off_the_catch_up_does_nothing(job, monkeypatch):
    monkeypatch.delenv(job.enabled_env)
    assert job.mod.catch_up(job.slot() + timedelta(minutes=20)) == {"started": False, "reason": "off"}
    assert job.calls == []


def test_a_failed_catch_up_writes_no_receipt_and_stays_behind(job, monkeypatch):
    monkeypatch.setattr(job.mod, job.stub_name, lambda *a, **k: (_ for _ in ()).throw(RuntimeError("invented")))
    when = job.slot() + timedelta(minutes=20)
    out = job.mod.catch_up(when)
    assert out["started"] is True and out["error"] == "RuntimeError"
    assert job.mod.receipt() is None and job.mod.behind(job.mod.receipt(), when) is True
    assert not getattr(job.mod, job.lock).locked()


def test_the_retry_slot_is_inside_the_quiet_span_every_day_and_after_the_nightly(job):
    from api.services import catchup_slots
    for day in range(15, 22):                                                       # a whole week
        assert catchup_slots.quiet(datetime(2027, 11, day, *job.mod.CATCHUP_AT_ET, tzinfo=NY)), day
    assert job.mod.CATCHUP_AT_ET > job.mod.RUN_AT_ET


# ── the registrations (api/main.py, by AST) ─────────────────────────────────────────────────────

REG = {
    "filing_search": ("filing_search_reindex", "_fs_mod", "filing_search_reindex_catchup_boot",
                      "filing_search_reindex_catchup", "_fs_cu", "FSR-catch-up"),
    "ftd": ("ftd_ingest", "_ftd_mod", "ftd_ingest_catchup_boot", "ftd_ingest_catchup", "_ftd_cu", "FTD-catch-up"),
}


@pytest.mark.parametrize("name", sorted(REG))
def test_the_nightly_cron_reads_the_modules_slot(name):
    from tests.test_insider_clusters_sec import _add_jobs, _kw, _lifespan
    jid, alias, *_ = REG[name]
    job = _add_jobs(_lifespan()[1])[jid]
    assert ast.unparse(_kw(job, "trigger")) == (
        f"CronTrigger(hour={alias}.RUN_AT_ET[0], minute={alias}.RUN_AT_ET[1], timezone=_ET)")


@pytest.mark.parametrize("name", sorted(REG))
def test_the_catch_up_is_a_date_job_after_boot_and_a_daily_retry_under_its_boot_mark(name):
    from tests.test_fund_holders_nport import _boot_level_calls
    from tests.test_insider_clusters_sec import _add_jobs, _kw, _lifespan, _lit
    _jid, _alias, boot_id, retry_id, cu, mark = REG[name]
    src, life = _lifespan()
    jobs = _add_jobs(life)
    boot, retry = jobs[boot_id], jobs[retry_id]
    defs = {n.name: n for n in ast.walk(life) if isinstance(n, ast.FunctionDef)}
    for call in (boot, retry):
        assert ".catch_up()" in ast.get_source_segment(src, defs[call.args[0].id])
    assert _lit(boot, "trigger") == "date" and _lit(boot, "kwargs") == {"source": "boot"}
    assert f"seconds={cu}.CATCHUP_BOOT_DELAY_S" in ast.unparse(_kw(boot, "run_date"))
    assert ast.unparse(_kw(retry, "trigger")) == (
        f"CronTrigger(hour={cu}.CATCHUP_AT_ET[0], minute={cu}.CATCHUP_AT_ET[1], timezone=_ET)")
    assert (_lit(retry, "coalesce"), _lit(retry, "max_instances")) == (True, 1)
    assert not {"catch_up"} & set(_boot_level_calls(life))
    marks = sorted((c.lineno, c.args[0].value) for c in ast.walk(life)
                   if isinstance(c, ast.Call) and getattr(c.func, "id", "") == "_boot_mark")
    names = [n for _, n in marks]
    assert names.count(mark) == 1
    i = names.index(mark)
    for call in (boot, retry):
        assert marks[i][0] < call.lineno < marks[i + 1][0]
