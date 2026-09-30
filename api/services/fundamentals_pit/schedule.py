"""Scheduler ownership for fundamentals: THE WORKER, V5 PIPELINE ONLY.

⛔⛔ OWNERSHIP, MEASURED 2026-09-25. The jobs used to be registered from api/main.py's APScheduler -- the WEB pod,
which has no store -- and the worker never registered them, so the scheduler ran NOWHERE, silently. And the jobs it
would have run (jobs.tick / daily_beta / weekly_reconcile) write the V4 store and OVERWRITE the V4 artifacts in place.

Now (2026-09-29 cutover): `start_worker_scheduler()` is called from api/worker_main.py ONLY and registers ONLY the
V5 pipeline (v5_pipeline.run_batch), which never writes V4 and publishes only immutable V5 versions. The legacy V4
jobs are no longer schedulable (jobs.py remains a manual CLI).

Registers NOTHING unless FUNDAMENTALS_PIT_V5_PIPELINE=1 AND the V5 live store exists. Stop without a deploy: create
<root>/HOLD (every batch parks). Rollback of the scheduler = unset the variable.

SINGLE OWNER, THREE GUARDS:
  * an OS file lock on the volume held for the process lifetime (scheduler.lock) -- a second process on the
    volume (a second replica, an overlapping deploy) starts no scheduler;
  * an in-process run lock -- two jobs never run at once;
  * the pipeline's own write lease (pipeline.lock) around every batch -- a manual ops batch and a scheduled batch
    never overlap either.
"""
from __future__ import annotations

import os
import threading

FLAG = "FUNDAMENTALS_PIT_V5_PIPELINE"
JOB_IDS = ("fundamentals_v5_cycle", "fundamentals_v5_daily", "fundamentals_v5_sweep")

_RUN_LOCK = threading.Lock()
_owner = {"fd": None, "scheduler": None}


def _run(kind: str):
    def job():
        with _RUN_LOCK:
            try:
                from . import v5_pipeline as PL, v5_publish as PUB
                rec = PL.run_batch(kind, target=PUB.R2Target())
                print(f"[fundamentals_v5] {kind}: {rec.get('state')} {rec.get('version') or ''} "
                      f"{(rec.get('validation') or {}).get('changed', '')}", flush=True)
            except Exception as e:                      # the batch records its own failure; never kill the worker
                print(f"[fundamentals_v5] {kind} failed: {e}", flush=True)
    job.__name__ = f"fundamentals_v5_{kind}"
    return job


def register_v5_jobs(scheduler) -> list[str]:
    from apscheduler.triggers.cron import CronTrigger
    et = "America/New_York"
    scheduler.add_job(_run("cycle"), trigger=CronTrigger(day_of_week="mon-fri", hour="6-22", minute="*/10", timezone=et),
                      id=JOB_IDS[0], max_instances=1, coalesce=True, replace_existing=True)
    scheduler.add_job(_run("daily"), trigger=CronTrigger(day_of_week="mon-sat", hour=5, minute=40, timezone=et),
                      id=JOB_IDS[1], max_instances=1, coalesce=True, replace_existing=True)
    scheduler.add_job(_run("sweep"), trigger=CronTrigger(day_of_week="sun", hour=4, minute=10, timezone=et),
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
    """The ONE place fundamentals jobs are scheduled. Called by api/worker_main.py. [] = not started (reason printed)."""
    if os.environ.get(FLAG) != "1":
        return []
    from . import v5_prod as VP
    p = VP.paths()
    if not os.path.exists(p["live_db"]):
        print(f"[fundamentals_v5] {FLAG}=1 but no live store at {p['live_db']} -- scheduler not started")
        return []
    if _owner["scheduler"] is not None:                # idempotent within this process
        return list(JOB_IDS)
    lock_path = lock_path or os.path.join(p["root"], "scheduler.lock")
    fd = _try_lock(lock_path)
    if fd is None:
        print(f"[fundamentals_v5] scheduler lock {lock_path} is held by another process -- not starting a second one")
        return []
    if scheduler_factory is None:
        from zoneinfo import ZoneInfo
        from apscheduler.schedulers.background import BackgroundScheduler
        scheduler_factory = lambda: BackgroundScheduler(timezone=ZoneInfo("America/New_York"))
    sched = scheduler_factory()
    ids = register_v5_jobs(sched)
    sched.start()
    _owner.update(fd=fd, scheduler=sched)                 # the lock lives as long as the process
    print(f"[fundamentals_v5] worker scheduler started: {', '.join(ids)}")
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
