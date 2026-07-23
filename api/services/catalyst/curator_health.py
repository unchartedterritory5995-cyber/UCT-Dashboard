"""Curator guardrail — make a silent fallback LOUD.

Born from 2026-07-23: the swing-trader Curator shipped looking "live" (flag on,
healthcheck green) but was silently falling back to the mechanical 10/5/3/2
quota on the real pool (first a truncated JSON contract, then Sonnet-5 thinking
starving the output). Nothing surfaced it — the list was still populated, just
NOT curated. This module ensures that can never happen unnoticed again: after
every refresh, if the curator is ENABLED but did NOT actually run, it logs an
error and fires a deduped Discord alert to the admin channel.

Never raises — a guardrail must not be able to break the refresh it guards.
"""
from __future__ import annotations

import logging
import os

from api.services.catalyst import curator

logger = logging.getLogger(__name__)

# Dedup: at most one Discord alert per market_date (a fallback is a persistent
# condition — one "hey, the curator isn't running today" ping is enough).
_ALERTED_DATES: set[str] = set()


def _flag_on() -> bool:
    return os.environ.get("CATALYST_CURATOR_ENABLED", "0").lower() in ("1", "true", "yes")


def _alert_enabled() -> bool:
    return os.environ.get("CATALYST_CURATOR_ALERT_ENABLED", "1").lower() in ("1", "true", "yes")


def check_and_alert(market_date: str) -> None:
    """Call right after curator.curate(). If the curator is enabled but fell
    back to the mechanical quota, log an error and fire a deduped Discord alert.
    No-op when the flag is off or the curator actually ran. Never raises."""
    try:
        if not _flag_on() or curator.curator_ran(market_date):
            return
        reason = curator.last_fallback_reason(market_date) or "unknown"
        logger.error(
            "[catalyst-curator] GUARDRAIL: curator ENABLED but FELL BACK to the "
            "mechanical quota on %s — %s", market_date, reason)
        if not _alert_enabled() or market_date in _ALERTED_DATES:
            return
        _ALERTED_DATES.add(market_date)
        _send_discord(market_date, reason)
    except Exception:
        logger.debug("[catalyst-curator] guardrail check failed", exc_info=True)


def _send_discord(market_date: str, reason: str) -> None:
    try:
        from api.services import discord_notify
        discord_notify._send_webhook({
            "title": "⚠️ Catalyst Curator fell back to mechanical quota",
            "description": (
                "The swing-trader Curator did **NOT** drive today's catalyst "
                "list — it fell back to the old 10/5/3/2 quota. The list is "
                "still populated (safe fallback) but is **not curated**, so "
                "sleepy names can flood it. Check `/api/admin/catalyst-stats`."
            ),
            "fields": [
                {"name": "Date", "value": market_date, "inline": True},
                {"name": "Reason", "value": (reason[:1000] or "unknown"), "inline": False},
            ],
            "color": 0xE0A020,  # amber
        })
    except Exception:
        logger.debug("[catalyst-curator] guardrail discord send failed", exc_info=True)
