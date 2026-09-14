"""Wisdom Loop sources: Discord, Zoom/Desk transcripts, Sunday Scans (stream S-C). Contract: docs/wisdom/CONTRACTS.md §6.3.

PUBLIC STEP FUNCTIONS (other streams call exactly these names):
  run_daily(ctx)                 Discord catch-up + new/changed transcripts
  run_weekly_sunday_scans(ctx)   ingest published issues + verify the newest two by public-URL diff
  discord_status(conn)           per-channel cursors, back-off, counts
  transcript_coverage(conn)      coverage by stream + the incomplete (< 0.98) list

Each step re-reads its own gate (core.flags) so the chain that calls it cannot
run a switched-off part; ctx.force bypasses the gate the same way registry.run_job
does; ctx.dry_run writes nothing (no wisdom.db rows, no R2 objects, no cursor moves).

Imports are deferred so the registry's discovery import of this package stays cheap.
"""
from __future__ import annotations


def _gate(ctx, reader, env: str):
    if getattr(ctx, "force", False) or reader():
        return None
    return {"skipped": f"{env} is off"}


def _log(ctx):
    return getattr(ctx, "log", None)


def run_daily(ctx) -> dict:
    from api.services.wisdom.core import flags
    from api.services.wisdom.sources import discord, transcripts

    dry = bool(getattr(ctx, "dry_run", False))
    out: dict = {}
    failures: list[str] = []

    skipped = _gate(ctx, flags.discord_listener_enabled, "WISDOM_DISCORD_LISTENER_ENABLED")
    if skipped:
        out["discord"] = skipped
    else:
        try:
            out["discord"] = discord.tick(dry_run=dry, log=_log(ctx))
            if out["discord"].get("outcome") == "no_token":
                failures.append("discord: DISCORD_BOT_TOKEN is not set")
        except Exception as exc:  # noqa: BLE001 — the other part still runs
            out["discord"] = {"error": f"{type(exc).__name__}: {exc}"}
            failures.append(f"discord: {type(exc).__name__}")

    skipped = _gate(ctx, flags.sources_ingest_enabled, "WISDOM_SOURCES_INGEST_ENABLED")
    if skipped:
        out["transcripts"] = skipped
    else:
        try:
            res = transcripts.ingest_new(dry_run=dry, log=_log(ctx))
            out["transcripts"] = res
            if res["errors"] and not res["written"]:
                failures.append(f"transcripts: {len(res['errors'])} errors, nothing written")
        except Exception as exc:  # noqa: BLE001
            out["transcripts"] = {"error": f"{type(exc).__name__}: {exc}"}
            failures.append(f"transcripts: {type(exc).__name__}")

    if failures:
        # Raise AFTER both parts ran, so the run row records a failure (and pages)
        # without one part's outage hiding the other's result.
        raise RuntimeError("sources.run_daily: " + "; ".join(failures) + f" | {out}")
    return out


def run_weekly_sunday_scans(ctx) -> dict:
    from api.services.wisdom.core import flags
    from api.services.wisdom.sources import sunday_scans

    skipped = _gate(ctx, flags.sources_ingest_enabled, "WISDOM_SOURCES_INGEST_ENABLED")
    if skipped:
        return {"sunday_scans": skipped}
    dry = bool(getattr(ctx, "dry_run", False))
    ingest = sunday_scans.ingest_all(dry_run=dry, log=_log(ctx))
    verify = sunday_scans.verify_recent(limit=2, dry_run=dry)
    if ingest["errors"] and not ingest["written"] and ingest["issues"]:
        raise RuntimeError(f"sources.run_weekly_sunday_scans: ingest failed | {ingest}")
    return {"ingest": ingest, "verify": verify}


def discord_status(conn) -> dict:
    from api.services.wisdom.sources import discord

    return discord.discord_status(conn)


def transcript_coverage(conn) -> dict:
    from api.services.wisdom.sources import transcripts

    return transcripts.transcript_coverage(conn)
