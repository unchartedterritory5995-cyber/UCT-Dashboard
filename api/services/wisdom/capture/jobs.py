"""capture jobs (stream S-A) — the six D12 slots of docs/wisdom/CONTRACTS.md §5, and nothing else.

Every job is killed by ``flags.capture_enabled`` (and the registry's master
switch), claims its slot durably through ``due_key``, and may be caught up for
6 h after a deploy swallows its minute. The session-shaped slots run on trading
days only. Which datasets a slot captures is ``families.DATASETS``' ``job_id``.
"""
from __future__ import annotations

from datetime import datetime

from api.services.wisdom import registry
from api.services.wisdom.capture import families, runner
from api.services.wisdom.core import flags, timeutil

CATCH_UP_GRACE_S = 6 * 3600
DAY_S = 86400


def date_key(now: datetime) -> str:
    return timeutil.to_et(now).date().isoformat()


def hour_key(now: datetime) -> str:
    return timeutil.to_et(now).strftime("%Y-%m-%dT%H")


def session_key(now: datetime) -> str:
    """The slots keyed on a session run after the close on trading days, so the ET date IS the session."""
    return timeutil.to_et(now).date().isoformat()


def _slot(job_id: str):
    def run(ctx: registry.JobContext) -> dict:
        return runner.run_job(job_id, ctx)

    run.__name__ = f"run_{job_id}"
    return run


def _cron(job_id: str, trigger: dict, *, due_key, expected_every_s: int, trading_days_only: bool = False):
    return registry.JobSpec(
        job_id=job_id,
        fn=_slot(job_id),
        trigger={"kind": "cron", **trigger},
        enabled=flags.capture_enabled,
        expected_every_s=expected_every_s,
        trading_days_only=trading_days_only,
        due_key=due_key,
        catch_up_grace_s=CATCH_UP_GRACE_S,
    )


JOBS = [
    _cron(families.JOB_DETECTIONS, {"hour": 0, "minute": 17}, due_key=date_key, expected_every_s=DAY_S),
    _cron(families.JOB_MORNING, {"hour": 5, "minute": 43}, due_key=date_key, expected_every_s=DAY_S),
    _cron(families.JOB_THEMES, {"hour": 6, "minute": 13}, due_key=date_key, expected_every_s=DAY_S),
    _cron(families.JOB_TWEETS, {"minute": 29}, due_key=hour_key, expected_every_s=3600),
    _cron(families.JOB_EOD, {"day_of_week": "mon-fri", "hour": 16, "minute": 52}, due_key=session_key,
          expected_every_s=DAY_S, trading_days_only=True),
    _cron(families.JOB_LATE, {"day_of_week": "mon-fri", "hour": 17, "minute": 34}, due_key=session_key,
          expected_every_s=DAY_S, trading_days_only=True),
]
