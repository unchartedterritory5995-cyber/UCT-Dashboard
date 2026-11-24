"""The clock the boot catch-ups share: a job's last scheduled fire at or before a moment, and scan_period's quiet span.

WHY. The job store is in memory: a pod restart (a deploy) at a job's fire time loses that fire, and
`misfire_grace_time` covers only a scheduler that was ALIVE at the fire time. A catch-up asks "has the run for the
last slot happened?", which needs the last slot. INS CLUSTER, IV rank and N-PORT each step their own `next_run`;
the catch-ups added after them (estimate history, the 02:xx Screener side pulls, the RS lists, the filing search
reindex, the fails-to-deliver ingest) read it here instead.

ONE SCHEDULE, STATED ONCE. A job keeps its time as constants in its own module, `api/main.py` registers its
CronTrigger from those constants, and `trigger(...)` builds the SAME CronTrigger from them, so "the last fire" is
APScheduler's own reading of the schedule (weekdays, clock changes), never a second copy of it. New York time.

THE QUIET SPAN is scan_period's (`scan_period._reuse_quiet_now`: weekends, and weekdays before 07:00 or from 20:15),
read from scan_period itself in New York time, never retyped here.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional
from zoneinfo import ZoneInfo

NY = ZoneInfo("America/New_York")
#: How far back `last_fire` looks: more than a week, so a daily, weekday or weekly schedule always fired inside it.
LOOKBACK = timedelta(days=8)


def now_ny() -> datetime:
    return datetime.now(NY)


def as_ny(moment: Optional[datetime] = None) -> datetime:
    """`moment` (now when None) as an aware New York time. A naive moment is refused: it names no instant."""
    moment = moment or now_ny()
    if moment.tzinfo is None:
        raise ValueError("a catch-up reads an aware moment, never a naive one")
    return moment.astimezone(NY)


def trigger(run_at: tuple, day_of_week: Optional[str] = None):
    """The CronTrigger `api/main.py` registers for a job whose module keeps `run_at` = (hour, minute) and, when the
    job does not run every day, `day_of_week` (APScheduler's spelling, e.g. "mon-fri")."""
    from apscheduler.triggers.cron import CronTrigger
    kw = {"hour": run_at[0], "minute": run_at[1], "timezone": NY}
    if day_of_week:
        kw["day_of_week"] = day_of_week
    return CronTrigger(**kw)


def next_fire(trig, now: Optional[datetime] = None) -> Optional[datetime]:
    """The schedule's next fire strictly after `now`."""
    return trig.get_next_fire_time(None, as_ny(now) + timedelta(microseconds=1))


def last_fire(trig, now: Optional[datetime] = None) -> Optional[datetime]:
    """The schedule's most recent fire at or before `now` (a fire AT `now` counts: at the slot minute the slot has
    come). None only for a schedule that did not fire inside `LOOKBACK`."""
    now = as_ny(now)
    last = None
    t = trig.get_next_fire_time(None, now - LOOKBACK)
    while t is not None and t <= now:
        last = t
        t = trig.get_next_fire_time(t, t + timedelta(seconds=1))
    return last.astimezone(NY) if last is not None else None


def quiet(now: Optional[datetime] = None) -> bool:
    """scan_period's quiet span at `now`, read from scan_period in New York time."""
    from api.services import scan_period
    return bool(scan_period._reuse_quiet_now(as_ny(now)))
