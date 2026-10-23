"""auth.db backup schedule is RESTART-PROOF (2026-10-22).

Observed in R2 on 2026-10-22: on a day with many redeploys only the nightly
backup landed. The 6-hourly job was an ``IntervalTrigger(hours=6)``, whose
countdown restarts at every process start -- with a restart more often than
every 6h it never fires. The fix: fixed UTC cron slots (05:26/11:26/17:26/23:26,
the times history shows on quiet days) plus a delayed startup catch-up that runs
one backup only when the newest R2 object is older than the threshold.
"""
from __future__ import annotations

import datetime as dt
from pathlib import Path

import pytest
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger

from api.services import authdb_backup as ab

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 22, 12, 0, 0, tzinfo=UTC)


def _key(when: dt.datetime, enc: bool = True) -> str:
    return f"{ab.KEY_PREFIX}{when.strftime('%Y%m%dT%H%M%SZ')}.db.gz{'.enc' if enc else ''}"


class _Client:
    def __init__(self, keys=(), fail=False):
        self.keys, self.fail = list(keys), fail

    def list_objects_v2(self, Bucket, Prefix):
        if self.fail:
            raise RuntimeError("R2 unreachable")
        return {"Contents": [{"Key": k} for k in self.keys]}


# -- registration ----------------------------------------------------------------

def _registered(now=NOW):
    sched = BackgroundScheduler(timezone="America/New_York")
    ids = ab.register_jobs(sched, now=now)
    return sched, ids


def test_six_hourly_job_is_a_utc_cron_not_an_interval():
    sched, ids = _registered()
    job = sched.get_job("authdb_backup_6h")
    assert job is not None and "authdb_backup_6h" in ids
    assert isinstance(job.trigger, CronTrigger), "an interval trigger resets on every restart"
    assert str(job.trigger.timezone) == "UTC"
    fires = []
    t = dt.datetime(2026, 10, 22, 0, 0, tzinfo=UTC)
    prev = None
    for _ in range(4):
        t = job.trigger.get_next_fire_time(prev, t)
        fires.append(t.astimezone(UTC).strftime("%H:%M"))
        prev = t
        t = t + dt.timedelta(seconds=1)
    assert fires == ["05:26", "11:26", "17:26", "23:26"]


def test_nightly_job_kept_at_0255_et():
    sched, _ = _registered()
    job = sched.get_job("authdb_backup_nightly")
    assert isinstance(job.trigger, CronTrigger)
    nxt = job.trigger.get_next_fire_time(None, dt.datetime(2026, 10, 22, 0, 0, tzinfo=UTC))
    et = nxt.astimezone(dt.timezone(dt.timedelta(hours=-4)))
    assert (et.hour, et.minute) == (2, 55)


def test_cron_jobs_tolerate_a_late_executor():
    sched, _ = _registered()
    for jid in ("authdb_backup_6h", "authdb_backup_nightly"):
        job = sched.get_job(jid)
        assert job.max_instances == 1
        assert job.coalesce is True
        assert job.misfire_grace_time >= 600, f"{jid}: default 1s grace drops a busy-slot run"


def test_catch_up_is_a_single_delayed_one_shot():
    sched, ids = _registered()
    job = sched.get_job("authdb_backup_catchup")
    assert job is not None and "authdb_backup_catchup" in ids
    assert isinstance(job.trigger, DateTrigger)
    assert job.func is ab.run_catch_up
    delay = (job.trigger.run_date - NOW).total_seconds()
    assert delay == ab.CATCH_UP_DELAY_S and delay >= 300, "must not fire the instant a pod boots"


def test_main_registers_through_the_helper_and_no_interval_remains():
    src = (Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    assert "_authdb_backup.register_jobs(_scheduler)" in src
    assert "id=\"authdb_backup_6h\"" not in src, "a second registration site would shadow the helper"


# -- catch-up decision -------------------------------------------------------------

def test_stale_newest_backup_means_run():
    keys = [_key(NOW - dt.timedelta(hours=7)), _key(NOW - dt.timedelta(hours=30))]
    run, reason = ab.catch_up_decision(_Client(keys), "b", now=NOW)
    assert run is True, reason


def test_fresh_newest_backup_means_skip():
    keys = [_key(NOW - dt.timedelta(hours=30)), _key(NOW - dt.timedelta(hours=5, minutes=50))]
    run, reason = ab.catch_up_decision(_Client(keys), "b", now=NOW)
    assert run is False, reason


def test_threshold_boundary():
    just_under = [_key(NOW - dt.timedelta(seconds=ab.CATCH_UP_MAX_AGE_S - 60))]
    just_over = [_key(NOW - dt.timedelta(seconds=ab.CATCH_UP_MAX_AGE_S + 60))]
    assert ab.catch_up_decision(_Client(just_under), "b", now=NOW)[0] is False
    assert ab.catch_up_decision(_Client(just_over), "b", now=NOW)[0] is True
    assert ab.CATCH_UP_MAX_AGE_S == 6 * 3600


def test_legacy_plaintext_key_counts_as_newest():
    keys = [_key(NOW - dt.timedelta(hours=1), enc=False), _key(NOW - dt.timedelta(hours=9))]
    assert ab.catch_up_decision(_Client(keys), "b", now=NOW)[0] is False


def test_non_backup_objects_are_ignored():
    keys = [f"{ab.KEY_PREFIX}notes.txt", _key(NOW - dt.timedelta(hours=8))]
    assert ab.catch_up_decision(_Client(keys), "b", now=NOW)[0] is True


def test_no_backups_at_all_means_run():
    assert ab.catch_up_decision(_Client([]), "b", now=NOW)[0] is True


def test_list_failure_means_skip_without_raising():
    run, reason = ab.catch_up_decision(_Client(fail=True), "b", now=NOW)
    assert run is False and "list" in reason


# -- run_catch_up wiring -------------------------------------------------------------

@pytest.fixture
def armed(monkeypatch):
    monkeypatch.setenv(ab.ENABLED_ENV, "1")
    calls = []
    monkeypatch.setattr(ab, "run_backup", lambda: calls.append(1) or "TS")
    from api.services import data_sync
    holder = {"client": _Client()}
    monkeypatch.setattr(data_sync, "_client", lambda: holder["client"])
    monkeypatch.setattr(data_sync, "_bucket", lambda: "b")
    return calls, holder


def test_run_catch_up_runs_backup_when_stale(armed):
    calls, holder = armed
    holder["client"] = _Client([_key(dt.datetime.now(UTC) - dt.timedelta(hours=8))])
    assert ab.run_catch_up() == "TS" and calls == [1]


def test_run_catch_up_skips_when_fresh(armed):
    calls, holder = armed
    holder["client"] = _Client([_key(dt.datetime.now(UTC) - dt.timedelta(minutes=30))])
    assert ab.run_catch_up() is None and calls == []


def test_run_catch_up_skips_on_list_failure(armed):
    calls, holder = armed
    holder["client"] = _Client(fail=True)
    assert ab.run_catch_up() is None and calls == []


def test_run_catch_up_never_raises(armed, monkeypatch):
    calls, _ = armed
    from api.services import data_sync

    def boom():
        raise RuntimeError("client exploded")
    monkeypatch.setattr(data_sync, "_client", boom)
    assert ab.run_catch_up() is None and calls == []


def test_run_catch_up_inert_when_disabled(armed, monkeypatch):
    calls, holder = armed
    monkeypatch.setenv(ab.ENABLED_ENV, "0")
    holder["client"] = _Client([])
    assert ab.run_catch_up() is None and calls == []
