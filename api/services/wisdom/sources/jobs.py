"""sources jobs (stream S-C): the Discord listener, CONTRACTS.md §5.

wisdom_sources_discord_listener — cron minute 13,28,43,58 ET, one durable claim per
quarter-hour, expected every 900 s, so the core watchdog pages after two missed
beats. The daily chain and the weekly chain call the public step functions in
api/services/wisdom/sources/__init__.py; they are not jobs here.

A tick that polled NOTHING is a failure, not a quiet success: no token, or every
channel failing/forbidden, raises so the run row is 'failed', the registry pages
wisdom_job_failed, and the heartbeat stops counting it healthy.
"""
from __future__ import annotations

from datetime import datetime

from api.services.wisdom import registry
from api.services.wisdom.core import flags


def quarter_hour_key(now: datetime) -> str:
    return now.strftime("%Y-%m-%dT%H:") + f"{(now.minute // 15) * 15:02d}"


def _listener(ctx: registry.JobContext) -> dict:
    from api.services.wisdom.sources import discord

    out = discord.tick(dry_run=ctx.dry_run, log=ctx.log, now=ctx.now_et)
    if out.get("outcome") == "no_token":
        raise RuntimeError("Discord listener: DISCORD_BOT_TOKEN is not set")
    channels = out.get("channels") or []
    if channels and all(c.get("outcome") in ("failed", "blocked") for c in channels):
        raise RuntimeError("Discord listener: every in-scope channel failed or is blocked: "
                           + ", ".join(f"{c['channel_id']}={c['outcome']}" for c in channels))
    return out


JOBS = [
    registry.JobSpec(
        job_id="wisdom_sources_discord_listener",
        fn=_listener,
        trigger={"kind": "cron", "minute": "13,28,43,58"},
        enabled=flags.discord_listener_enabled,
        expected_every_s=900,
        due_key=quarter_hour_key,
    ),
]
