"""Market Cap V1 refresh -- scheduler ownership: THE WORKER, exactly one owner.

Why the worker: every production source of a build is on its volume or in its environment -- bars.db (daily closes,
split-adjusted), the Massive key (reference), the data_sync bucket credentials (publication, and the universe: Fundamentals
V5's PUBLISHED manifest in that bucket, source kind `v5_published` -- V5's own pipeline now runs on fundamentals-v5-runner,
so its live.db is not on this volume). Nothing here runs on the web pod, a laptop or a shell.

Registers NOTHING unless MCAP_PIT_REFRESH=1 AND the refresh root (MCAP_PIT_ROOT, default /data/marketcap_v1) holds a
refresh.json. One job: a full refresh at MCAP_PIT_REFRESH_CRON_ET (default 06:15 ET, Tue-Sat -- after the D+1 06:00 ET due boundary and SEC's nightly bulk
files, ~00:30 ET measured 2026-10-03, and after the last session's close). The run executes in a CHILD PROCESS
(`python -m api.services.marketcap.refresh run`) so its memory is returned to the OS and a crash cannot take the worker.

SINGLE OWNER, THREE GUARDS
  * an OS lock on ROOT/scheduler.lock for the process lifetime -- a second worker (replica, overlapping deploy) starts
    no scheduler;
  * max_instances=1 + coalesce -- one run at a time in this process;
  * the run's own lock (ROOT/refresh.lock) -- a manual ops run and a scheduled run never overlap (the second is BUSY).
RESTARTS (measured 2026-10-05: two worker deploys inside 25 minutes, each replacing the container): a deploy kills the
child run, and APScheduler's in-memory job store forgets a fire that happened while the worker was down. So at start the
scheduler adds ONE catch-up run (CATCHUP_DELAY_S later) when the ledger shows an interrupted run (refresh.py resumes it
from its checkpoints) or when the last cron fire is under CATCHUP_HOURS old and no run started after it.
Stop without a deploy: `python -m api.services.marketcap.refresh hold --root ROOT --reason ...`. Rollback of the
scheduler = unset the variable. The authority pointer is never moved by this module (refresh.py's policy decides).
"""
from __future__ import annotations

import os
import subprocess
import sys
import threading

MCAP_PIT_MODE_FLAGS = {"MCAP_PIT_REFRESH": ("0", ("0", "1"))}
(FLAG,) = MCAP_PIT_MODE_FLAGS
JOB_ID = "marketcap_v1_refresh"
_owner = {"fd": None, "scheduler": None}
_RUN_LOCK = threading.Lock()


def root() -> str:
    return os.environ.get("MCAP_PIT_ROOT", "/data/marketcap_v1")


def _job():
    with _RUN_LOCK:
        try:
            r = subprocess.run([sys.executable, "-m", "api.services.marketcap.refresh", "run", "--root", root()],
                               capture_output=True, text=True, timeout=6 * 3600)
            tail = (r.stdout or "")[-600:].replace("\n", " ")
            print(f"[marketcap_v1] refresh exit={r.returncode} {tail}", flush=True)
        except Exception as e:  # noqa: BLE001 -- the run records its own failure; never kill the worker
            print(f"[marketcap_v1] refresh failed to run: {e}", flush=True)


CATCHUP_HOURS = 6.0
CATCHUP_DELAY_S = 120


def _cron():
    # 06:15 ET (owner approval 2026-10-06): a session D is not DUE until D+1 06:00 ET (currentness.DUE_ET, the
    # finality boundary, unchanged); a run before that can only append D-1 -- the old 01:15 always trailed a session
    hh, mm = os.environ.get("MCAP_PIT_REFRESH_CRON_ET", "06:15").split(":")
    return int(hh), int(mm)


def cron_after_due() -> bool:
    """The configured run time is at or after the due boundary (a run then always sees the just-closed session due)."""
    from .currentness import DUE_ET
    dh, dm = (int(x) for x in DUE_ET.split(":"))
    return _cron() >= (dh, dm)


def last_fire(now_et):
    """The most recent scheduled fire at or before `now_et` (Tue-Sat at the cron time, America/New_York)."""
    from datetime import timedelta
    hh, mm = _cron()
    d = now_et.replace(hour=hh, minute=mm, second=0, microsecond=0)
    if d > now_et:
        d -= timedelta(days=1)
    while d.weekday() not in (1, 2, 3, 4, 5):          # Tue..Sat
        d -= timedelta(days=1)
    return d


def catch_up_reason(root_dir: str, now_et=None) -> str | None:
    """Why a run is owed right now, or None. Reads the ledger read-only; a missing ledger owes nothing (provisioning)."""
    import sqlite3
    from datetime import datetime
    from zoneinfo import ZoneInfo
    p = os.path.join(root_dir, "ledger.db")
    if not os.path.exists(p):
        return None
    now_et = now_et or datetime.now(ZoneInfo("America/New_York"))
    c = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    try:
        if c.execute("SELECT 1 FROM run WHERE state='RUNNING' LIMIT 1").fetchone():
            return "interrupted run"
        f = last_fire(now_et)
        if (now_et - f).total_seconds() / 3600 > CATCHUP_HOURS:
            return None
        since = f.astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%SZ")
        if c.execute("SELECT 1 FROM run WHERE started_at >= ? LIMIT 1", (since,)).fetchone():
            return None
        return f"missed fire {f.isoformat()}"
    finally:
        c.close()


def register(scheduler) -> list[str]:
    from apscheduler.triggers.cron import CronTrigger
    if not cron_after_due():
        print(f"[marketcap_v1] MCAP_PIT_REFRESH_CRON_ET {_cron()} is before the due boundary -- NOT registering", flush=True)
        return []
    hh, mm = _cron()
    scheduler.add_job(_job, trigger=CronTrigger(day_of_week="tue-sat", hour=hh, minute=mm, timezone="America/New_York"),
                      id=JOB_ID, max_instances=1, coalesce=True, replace_existing=True, misfire_grace_time=4 * 3600)
    return [JOB_ID]


def start_worker_scheduler(scheduler_factory=None, lock_path: str | None = None) -> list[str]:
    """The ONE place the Market Cap refresh is scheduled. Called by api/worker_main.py. [] = not started."""
    if os.environ.get(FLAG) != "1":
        return []
    r = root()
    if not os.path.exists(os.path.join(r, "refresh.json")):
        print(f"[marketcap_v1] {FLAG}=1 but {r}/refresh.json is missing -- scheduler not started")
        return []
    if _owner["scheduler"] is not None:
        return [JOB_ID]
    from api.services.fundamentals_pit.schedule import _try_lock
    lock_path = lock_path or os.path.join(r, "scheduler.lock")
    fd = _try_lock(lock_path)
    if fd is None:
        print(f"[marketcap_v1] scheduler lock {lock_path} is held by another process -- not starting a second one")
        return []
    if scheduler_factory is None:
        from zoneinfo import ZoneInfo
        from apscheduler.schedulers.background import BackgroundScheduler
        scheduler_factory = lambda: BackgroundScheduler(timezone=ZoneInfo("America/New_York"))
    sched = scheduler_factory()
    ids = register(sched)
    why = catch_up_reason(r)
    if why:
        from datetime import datetime, timedelta, timezone
        sched.add_job(_job, trigger="date", run_date=datetime.now(timezone.utc) + timedelta(seconds=CATCHUP_DELAY_S),
                      id=JOB_ID + "_catchup", max_instances=1, replace_existing=True)
        ids = ids + [JOB_ID + "_catchup"]
        print(f"[marketcap_v1] catch-up run in {CATCHUP_DELAY_S}s: {why}")
    sched.start()
    _owner.update(fd=fd, scheduler=sched)
    print(f"[marketcap_v1] worker scheduler started: {', '.join(ids)}")
    return ids


def _reset_for_tests() -> None:
    sched, fd = _owner["scheduler"], _owner["fd"]
    if sched is not None:
        try:
            sched.shutdown(wait=False)
        except Exception:  # noqa: BLE001
            pass
    if fd is not None:
        fd.close()
    _owner.update(fd=None, scheduler=None)
