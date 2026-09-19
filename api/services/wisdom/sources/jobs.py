"""sources jobs (stream S-C): the Discord and Twitter listeners, CONTRACTS.md §5.

wisdom_sources_discord_listener — cron minute 13,28,43,58 ET, one durable claim per
quarter-hour, expected every 900 s, so the core watchdog pages after two missed
beats. The daily chain and the weekly chain call the public step functions in
api/services/wisdom/sources/__init__.py; they are not jobs here.

wisdom_sources_twitter_listener (2026-09-19) — interval every 6 hours, comfortably
inside the tweets.db 7-day retention window (tweet_cleanup.py) without needing
Discord's minute-level tightness: it reads an existing local cache rather than an
external, rate-limited API, so there is no "missed page" class of failure to guard
against, only "did it copy what's there before tonight's cleanup deletes it."

A tick that polled/copied NOTHING is a failure, not a quiet success: no token (or
in the twitter listener's case, no official accounts resolved), raises so the run
row is 'failed', the registry pages wisdom_job_failed, and the heartbeat stops
counting it healthy.
"""
from __future__ import annotations

from datetime import datetime

from api.services.wisdom import registry
from api.services.wisdom.core import flags


def quarter_hour_key(now: datetime) -> str:
    return now.strftime("%Y-%m-%dT%H:") + f"{(now.minute // 15) * 15:02d}"


def six_hour_key(now: datetime) -> str:
    return now.strftime("%Y-%m-%dT") + f"{(now.hour // 6) * 6:02d}"


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


def _twitter_listener(ctx: registry.JobContext) -> dict:
    from api.services.wisdom.sources import twitter

    out = twitter.ingest_all(dry_run=ctx.dry_run, log=ctx.log)
    if not out.get("dry_run") and out["errors"] and not out["written"] and out["seen"]:
        raise RuntimeError(f"Twitter listener: every candidate tweet errored | {out}")
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
    registry.JobSpec(
        job_id="wisdom_sources_twitter_listener",
        fn=_twitter_listener,
        trigger={"kind": "interval", "hours": 6},
        enabled=flags.twitter_listener_enabled,
        expected_every_s=6 * 3600,
        catch_up_grace_s=24 * 3600,
        due_key=six_hour_key,
    ),
]
