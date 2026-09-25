"""Scheduler ownership for the fundamentals jobs (see jobs.py): THE WORKER.

⛔⛔ OWNERSHIP, MEASURED 2026-09-25. These jobs used to be registered from
api/main.py's APScheduler -- which runs on the WEB pod (uvicorn api.main:app),
where the store does not exist, so registration returned nothing. The WORKER
(python -m api.worker_main) holds the store and never imports api.main (it
builds the whole web app at import), so the hook never ran there either. The
scheduler ran NOWHERE, silently, whatever the flag said.

Now: `start_worker_scheduler()` is called from api/worker_main.py only. It builds
the worker's OWN BackgroundScheduler and registers the jobs on it, and nothing
else in the codebase registers them.

Registers NOTHING unless FUNDAMENTALS_PIT_INCREMENTAL_ENABLED=1 AND the store file
exists. Rollback = unset the variable (the jobs stop at the next deploy/restart;
the store and every published artifact are left exactly as they are).

SINGLE INSTANCE, TWO LOCKS:
  * an OS file lock beside the store (the volume) -- a second process on the same
    volume (a second replica, or an overlapping deploy) starts no scheduler;
  * one in-process run lock -- the three jobs never run concurrently, so `tick`
    and `daily_beta` (both at 18:40 ET) never contend for the store's write lock.
"""
from __future__ import annotations

import os
import threading

FLAG = "FUNDAMENTALS_PIT_INCREMENTAL_ENABLED"
JOB_IDS = ("fundamentals_pit_tick", "fundamentals_pit_daily_beta", "fundamentals_pit_weekly_reconcile")

_RUN_LOCK = threading.Lock()
_owner = {"fd": None, "scheduler": None}


def register_fundamentals_pit_jobs(scheduler) -> list[str]:
    if os.environ.get(FLAG) != "1":
        return []
    from . import store as S
    if not os.path.exists(S.default_path()):
        print("[fundamentals_pit] incremental enabled but no store at "
              f"{S.default_path()} -- nothing registered")
        return []
    from apscheduler.triggers.cron import CronTrigger
    from . import jobs as J
    et = "America/New_York"

    def safe(fn):
        def run():
            # one fundamentals job at a time, whatever the scheduler's thread pool does
            with _RUN_LOCK:
                try:
                    fn()
                except Exception as e:                 # recorded in jobs_status.json by the job itself
                    print(f"[fundamentals_pit] {fn.__name__} failed: {e}")
        run.__name__ = f"fundamentals_pit_{fn.__name__}"
        return run

    scheduler.add_job(safe(J.tick), trigger=CronTrigger(day_of_week="mon-fri", hour="6-22", minute="*/10", timezone=et),
                      id=JOB_IDS[0], max_instances=1, coalesce=True, replace_existing=True)
    scheduler.add_job(safe(J.daily_beta), trigger=CronTrigger(day_of_week="mon-fri", hour=18, minute=40, timezone=et),
                      id=JOB_IDS[1], max_instances=1, coalesce=True, replace_existing=True)
    scheduler.add_job(safe(J.weekly_reconcile), trigger=CronTrigger(day_of_week="sun", hour=6, minute=10, timezone=et),
                      id=JOB_IDS[2], max_instances=1, coalesce=True, replace_existing=True)
    return list(JOB_IDS)


def _try_lock(path: str):
    """Non-blocking exclusive lock on `path`; the open file object, or None if held."""
    fd = open(path, "a+")
    try:
        try:
            import fcntl
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except ImportError:                            # Windows dev: msvcrt byte-range lock
            import msvcrt
            fd.seek(0)
            msvcrt.locking(fd.fileno(), msvcrt.LK_NBLCK, 1)
        return fd
    except OSError:
        fd.close()
        return None


def start_worker_scheduler(scheduler_factory=None, lock_path: str | None = None) -> list[str]:
    """The ONE place the fundamentals jobs are scheduled. Called by api/worker_main.py.

    Returns the registered job ids ([] = not started, and the reason is printed)."""
    if os.environ.get(FLAG) != "1":
        return []
    from . import store as S
    if not os.path.exists(S.default_path()):
        print(f"[fundamentals_pit] {FLAG}=1 but no store at {S.default_path()} -- scheduler not started")
        return []
    if _owner["scheduler"] is not None:                # idempotent within this process
        return list(JOB_IDS)
    lock_path = lock_path or os.path.join(os.path.dirname(S.default_path()) or ".", "fundamentals_pit.scheduler.lock")
    fd = _try_lock(lock_path)
    if fd is None:
        print(f"[fundamentals_pit] scheduler lock {lock_path} is held by another process -- not starting a second one")
        return []
    if scheduler_factory is None:
        from zoneinfo import ZoneInfo
        from apscheduler.schedulers.background import BackgroundScheduler
        scheduler_factory = lambda: BackgroundScheduler(timezone=ZoneInfo("America/New_York"))
    sched = scheduler_factory()
    ids = register_fundamentals_pit_jobs(sched)
    if not ids:
        fd.close()
        return []
    sched.start()
    _owner.update(fd=fd, scheduler=sched)                 # the lock lives as long as the process
    print(f"[fundamentals_pit] worker scheduler started: {', '.join(ids)}")
    return ids


def _reset_for_tests() -> None:
    sched, fd = _owner["scheduler"], _owner["fd"]
    if sched is not None:
        try:
            sched.shutdown(wait=False)
        except Exception:
            pass
    if fd is not None:
        fd.close()
    _owner.update(fd=None, scheduler=None)
