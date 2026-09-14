"""publish jobs (stream S-F): the daily chain, the weekly chain, the monthly packet.

Slots are CONTRACTS §5 (ET). Every job is registered unconditionally and killed
by the Wisdom master switch, read on each run (CONTRACTS §0 ruling 8). The
packages a chain calls check their own kill switches inside their functions.
"""
from __future__ import annotations

from datetime import datetime

from api.services.wisdom import registry
from api.services.wisdom.core import flags, timeutil
from api.services.wisdom.publish import chain


def session_key(now: datetime) -> str:
    """due_key 'session': the trading session a run at `now` belongs to."""
    return timeutil.session_for(now).isoformat()


def iso_week_key(now: datetime) -> str:
    year, week, _ = timeutil.to_et(now).isocalendar()
    return f"{year}-W{week:02d}"


def month_key(now: datetime) -> str:
    return timeutil.to_et(now).strftime("%Y-%m")


JOBS = [
    registry.JobSpec(
        job_id="wisdom_daily_chain",
        fn=chain.daily_job,
        trigger={"kind": "cron", "day_of_week": "mon-fri", "hour": 18, "minute": 47},
        enabled=flags.ingest_enabled,
        expected_every_s=86400,
        trading_days_only=True,
        due_key=session_key,
        catch_up_grace_s=4 * 3600,
    ),
    registry.JobSpec(
        job_id="wisdom_weekly_chain",
        fn=chain.weekly_job,
        trigger={"kind": "cron", "day_of_week": "sun", "hour": 19, "minute": 52},
        enabled=flags.ingest_enabled,
        expected_every_s=7 * 86400,
        due_key=iso_week_key,
        catch_up_grace_s=24 * 3600,
    ),
    registry.JobSpec(
        job_id="wisdom_monthly_packet",
        fn=chain.monthly_job,
        # APScheduler ANDs day and day_of_week: a Sunday that is also day 1-7 = the first Sunday.
        trigger={"kind": "cron", "day": "1-7", "day_of_week": "sun", "hour": 20, "minute": 22},
        enabled=flags.ingest_enabled,
        expected_every_s=35 * 86400,
        due_key=month_key,
        catch_up_grace_s=24 * 3600,
    ),
]
