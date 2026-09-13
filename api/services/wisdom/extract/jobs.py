"""extract jobs (stream S-D), CONTRACTS §5.

wisdom_extract_reap runs at :16 and :46 every hour: a short tick that advances open
batches and persists their state. Submission is not a job of its own: extract.run_daily
is a step of wisdom_daily_chain (S-F) and extract.run_audit a step of the weekly chain.
Registered unconditionally; the kill switch is read on every run (CONTRACTS §0 #8).
"""
from __future__ import annotations

from api.services.wisdom import registry
from api.services.wisdom.core import flags


def _reap(ctx: registry.JobContext) -> dict:
    from api.services.wisdom.extract import batch

    return batch.reap(ctx)


JOBS = [
    registry.JobSpec(
        job_id="wisdom_extract_reap",
        fn=_reap,
        trigger={"kind": "cron", "minute": "16,46"},
        enabled=flags.extract_enabled,
        expected_every_s=1800,
    ),
]
