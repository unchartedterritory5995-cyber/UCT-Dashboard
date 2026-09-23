"""Scheduler registration for the fundamentals jobs (see jobs.py).

Registers NOTHING unless FUNDAMENTALS_PIT_INCREMENTAL_ENABLED=1 AND the store file
exists -- so web pods, and a worker that has no store, are untouched. Rollback =
unset the variable (the jobs stop at the next deploy/restart; the store and every
published artifact are left exactly as they are).
"""
from __future__ import annotations

import os


def register_fundamentals_pit_jobs(scheduler) -> list[str]:
    if os.environ.get("FUNDAMENTALS_PIT_INCREMENTAL_ENABLED") != "1":
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
            try:
                fn()
            except Exception as e:                     # recorded in jobs_status.json by the job itself
                print(f"[fundamentals_pit] {fn.__name__} failed: {e}")
        run.__name__ = f"fundamentals_pit_{fn.__name__}"
        return run

    scheduler.add_job(safe(J.tick), trigger=CronTrigger(day_of_week="mon-fri", hour="6-22", minute="*/10", timezone=et),
                      id="fundamentals_pit_tick", max_instances=1, coalesce=True, replace_existing=True)
    scheduler.add_job(safe(J.daily_beta), trigger=CronTrigger(day_of_week="mon-fri", hour=18, minute=40, timezone=et),
                      id="fundamentals_pit_daily_beta", max_instances=1, coalesce=True, replace_existing=True)
    scheduler.add_job(safe(J.weekly_reconcile), trigger=CronTrigger(day_of_week="sun", hour=6, minute=10, timezone=et),
                      id="fundamentals_pit_weekly_reconcile", max_instances=1, coalesce=True, replace_existing=True)
    return ["fundamentals_pit_tick", "fundamentals_pit_daily_beta", "fundamentals_pit_weekly_reconcile"]
