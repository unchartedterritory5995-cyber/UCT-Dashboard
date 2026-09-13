"""core jobs: catch-up for slots a deploy swallowed, and the missed-heartbeat watchdog."""
from __future__ import annotations

from api.services.wisdom import registry
from api.services.wisdom.core import flags


def _catch_up(ctx: registry.JobContext) -> dict:
    return registry.catch_up(ctx.now_et)


def _watchdog(ctx: registry.JobContext) -> dict:
    return registry.watchdog(ctx.now_et)


JOBS = [
    registry.JobSpec(
        job_id="wisdom_core_catchup",
        fn=_catch_up,
        trigger={"kind": "interval", "seconds": 300},
        enabled=flags.ingest_enabled,
        expected_every_s=900,
    ),
    registry.JobSpec(
        job_id="wisdom_core_watchdog",
        fn=_watchdog,
        trigger={"kind": "interval", "seconds": 300},
        enabled=flags.ingest_enabled,
        expected_every_s=900,
    ),
]
