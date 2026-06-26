"""Premarket health check for the Stock Catalysts board.

A scheduled morning check that distinguishes a *broken* pipeline from a
*genuinely quiet* morning, pings the operator when it's broken, and force-
refreshes to self-correct. Pairs with the read-triggered self-heal (which only
fires on a tile load) so a broken morning is loud + self-correcting even before
anyone looks.

Three failure modes it catches:
  • empty        — 0 ranked rows on a trading morning
  • stale        — last refresh older than the cron cadence (a missed run)
  • sources_down — the raw candidate universe collapsed (Massive/Perplexity/etc.
                   down) → thin list with no other signal
"""
from __future__ import annotations

import datetime as dt
import logging
import os
import threading
import time
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

# Crons run every 30 min premarket; >45 min stale means a run was missed.
_STALE_MIN = int(os.environ.get("CATALYST_HEALTH_STALE_MIN", "45"))
# A healthy morning unions hundreds of raw candidates; <10 = a source is dead.
_MIN_UNIVERSE = int(os.environ.get("CATALYST_HEALTH_MIN_UNIVERSE", "10"))

# One alert per market_date (a check that runs twice shouldn't double-ping).
_ALERTED_DATES: set[str] = set()


def evaluate_health(ranked_count: int, refreshed_at, source_stats: dict,
                    now_ts: float) -> dict:
    """Pure decision — no I/O, unit-testable. Returns
    {healthy: bool, issues: [str], age_min: float|None, universe: int|None}."""
    issues: list[str] = []

    age_min = None
    if refreshed_at:
        age_min = (now_ts - refreshed_at) / 60.0

    if ranked_count <= 0:
        issues.append("empty")
    if refreshed_at is None or (age_min is not None and age_min > _STALE_MIN):
        issues.append("stale")

    universe = (source_stats or {}).get("universe")
    # Only treat a collapsed universe as a fault when we actually have stats
    # from a recent pull (avoid false-positives before the first run of the day).
    if universe is not None and universe < _MIN_UNIVERSE:
        issues.append("sources_down")

    return {
        "healthy": not issues,
        "issues": issues,
        "age_min": round(age_min, 1) if age_min is not None else None,
        "universe": universe,
        "ranked": ranked_count,
    }


def _dead_sources(source_stats: dict) -> list[str]:
    """Named source pulls that returned zero on the last collect_all()."""
    skip = {"universe", "at"}
    return sorted(k for k, v in (source_stats or {}).items()
                  if k not in skip and not v)


def _alert(md: str, status: dict, source_stats: dict) -> None:
    """Discord + email ping to the operator. Best-effort, deduped per day."""
    if md in _ALERTED_DATES:
        return
    _ALERTED_DATES.add(md)

    issues = ", ".join(status.get("issues") or []) or "unknown"
    dead = _dead_sources(source_stats)
    dead_line = f"Dead sources: {', '.join(dead)}." if dead else "All sources returned data."
    age = status.get("age_min")
    age_line = f"{age:.0f} min old" if isinstance(age, (int, float)) else "no refresh recorded"
    body = (f"Premarket catalyst board looks unhealthy ({issues}).\n"
            f"Ranked rows: {status.get('ranked')} · last refresh: {age_line} · "
            f"raw universe: {status.get('universe')}.\n{dead_line}\n"
            f"A force-refresh was kicked automatically.")

    try:
        from api.services import discord_notify
        discord_notify._send_webhook({
            "title": "⚠️ Stock Catalysts — premarket health alert",
            "description": body,
            "color": 0xF87171,
        })
    except Exception:
        logger.exception("[catalyst-health] discord alert failed")

    try:
        from api.services import email_service
        recips = (os.environ.get("CATALYST_ALERT_EMAILS")
                  or os.environ.get("DESK_DAILY_SESSION_ALERT_EMAILS")
                  or os.environ.get("ADMIN_EMAILS", ""))
        html = "<p style='font-size:15px'>" + body.replace("\n", "<br>") + "</p>"
        for to in [e.strip() for e in recips.split(",") if e.strip()]:
            email_service.send_email(to, "⚠️ Stock Catalysts premarket health alert", html)
    except Exception:
        logger.exception("[catalyst-health] email alert failed")


def run_premarket_health_check(*, alert: bool = True, force_refresh: bool = True) -> dict:
    """Gather today's board state, evaluate health, and on a fault ping the
    operator + kick a force-refresh. Returns the status dict. Never raises."""
    if os.environ.get("CATALYST_HEALTH_ALERTS_ENABLED", "1").lower() not in ("1", "true", "yes"):
        return {"healthy": True, "issues": [], "skipped": "disabled"}

    from api.services.catalyst import store, sources, engine

    md = dt.datetime.now(_ET).date().isoformat()
    try:
        rows = store.get_for_date(md, ranked_only=True)
        refreshed_at = store.last_refresh_for_date(md)
    except Exception:
        logger.exception("[catalyst-health] could not read board state")
        return {"healthy": True, "issues": [], "error": "read_failed"}

    source_stats = sources.get_last_source_stats()
    status = evaluate_health(len(rows), refreshed_at, source_stats, time.time())
    status["market_date"] = md

    if status["healthy"]:
        logger.info("[catalyst-health] OK: %s", status)
        return status

    logger.warning("[catalyst-health] UNHEALTHY: %s | sources=%s", status, source_stats)
    if force_refresh:
        try:
            threading.Thread(target=engine.run_refresh, daemon=True,
                             name="catalyst-health-refresh").start()
        except Exception:
            logger.exception("[catalyst-health] force refresh failed to start")
    if alert:
        _alert(md, status, source_stats)
    return status
