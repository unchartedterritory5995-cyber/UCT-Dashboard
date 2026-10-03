"""Market Cap V1 refresh -- scheduler ownership: THE WORKER, exactly one owner.

Why the worker: every production source of a build lives on its volume or in its environment -- the Fundamentals V5
live store (universe), bars.db (daily closes, split-adjusted), the Massive key (reference) and the data_sync bucket
credentials (publication) -- and it already owns the Fundamentals V5 pipeline the same way (fundamentals_pit/schedule.py,
production since 2026-09-29). Nothing here runs on the web pod, a laptop or a shell.

Registers NOTHING unless MCAP_PIT_REFRESH=1 AND the refresh root (MCAP_PIT_ROOT, default /data/marketcap_v1) holds a
refresh.json. One job: a full refresh at MCAP_PIT_REFRESH_CRON_ET (default 01:15 ET, Tue-Sat -- after SEC's nightly bulk
files, ~00:30 ET measured 2026-10-03, and after the last session's close). The run executes in a CHILD PROCESS
(`python -m api.services.marketcap.refresh run`) so its memory is returned to the OS and a crash cannot take the worker.

SINGLE OWNER, THREE GUARDS
  * an OS lock on ROOT/scheduler.lock for the process lifetime -- a second worker (replica, overlapping deploy) starts
    no scheduler;
  * max_instances=1 + coalesce -- one run at a time in this process;
  * the run's own lock (ROOT/refresh.lock) -- a manual ops run and a scheduled run never overlap (the second is BUSY).
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


def register(scheduler) -> list[str]:
    from apscheduler.triggers.cron import CronTrigger
    hh, mm = os.environ.get("MCAP_PIT_REFRESH_CRON_ET", "01:15").split(":")
    scheduler.add_job(_job, trigger=CronTrigger(day_of_week="tue-sat", hour=int(hh), minute=int(mm), timezone="America/New_York"),
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
