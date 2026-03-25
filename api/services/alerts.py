# api/services/alerts.py — Alert management service
"""
Stores alerts in memory (TTLCache) and optionally fires Discord webhooks.

Alert types:
    regime_change  — market phase transition (e.g. Markup → Distribution)
    stop_hit       — UCT20 position hit -6% hard stop
    scanner_match  — new high-conviction scanner candidate (score >= 80)
    ep_resolved    — entry point candidate stopped or hit target
    exposure_shift — exposure rating moved 20+ points
"""

import os
import time
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from api.services.cache import cache

_logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

# Discord webhook (optional — only fires if env var is set)
_DISCORD_WEBHOOK = os.environ.get("DISCORD_ALERT_WEBHOOK", "")

# Alert severity levels
SEVERITY_INFO = "info"
SEVERITY_WARNING = "warning"
SEVERITY_CRITICAL = "critical"

# Type → default severity
_TYPE_SEVERITY = {
    "regime_change": SEVERITY_CRITICAL,
    "stop_hit": SEVERITY_WARNING,
    "scanner_match": SEVERITY_INFO,
    "ep_resolved": SEVERITY_INFO,
    "exposure_shift": SEVERITY_WARNING,
}


def _now_et() -> str:
    return datetime.now(_ET).isoformat()


def get_alerts(limit: int = 50) -> list:
    """Return recent alerts, newest first."""
    alerts = cache.get("alerts") or []
    return alerts[:limit]


def add_alert(
    alert_type: str,
    title: str,
    message: str,
    severity: str | None = None,
    data: dict | None = None,
) -> dict:
    """Add an alert and optionally fire Discord webhook."""
    alert = {
        "id": f"{alert_type}_{int(time.time() * 1000)}",
        "type": alert_type,
        "severity": severity or _TYPE_SEVERITY.get(alert_type, SEVERITY_INFO),
        "title": title,
        "message": message,
        "timestamp": _now_et(),
        "read": False,
        "data": data or {},
    }

    # Prepend to list (newest first), cap at 100
    alerts = cache.get("alerts") or []
    alerts.insert(0, alert)
    alerts = alerts[:100]
    cache.set("alerts", alerts, ttl=86400)  # 24hr

    # Fire Discord webhook for warning/critical
    if _DISCORD_WEBHOOK and alert["severity"] in (SEVERITY_WARNING, SEVERITY_CRITICAL):
        _fire_discord(alert)

    return alert


def mark_read(alert_id: str) -> bool:
    """Mark a single alert as read."""
    alerts = cache.get("alerts") or []
    for a in alerts:
        if a["id"] == alert_id:
            a["read"] = True
            cache.set("alerts", alerts, ttl=86400)
            return True
    return False


def mark_all_read() -> int:
    """Mark all alerts as read. Returns count marked."""
    alerts = cache.get("alerts") or []
    count = 0
    for a in alerts:
        if not a["read"]:
            a["read"] = True
            count += 1
    cache.set("alerts", alerts, ttl=86400)
    return count


def clear_alerts() -> int:
    """Remove all alerts. Returns count removed."""
    alerts = cache.get("alerts") or []
    count = len(alerts)
    cache.set("alerts", [], ttl=86400)
    return count


def _fire_discord(alert: dict) -> None:
    """Send alert to Discord webhook. Non-fatal."""
    try:
        import requests

        color = 0xE74C3C if alert["severity"] == SEVERITY_CRITICAL else 0xF0AD4E
        embed = {
            "title": f"{'🚨' if alert['severity'] == SEVERITY_CRITICAL else '⚠️'} {alert['title']}",
            "description": alert["message"],
            "color": color,
            "footer": {"text": f"UCT Alert · {alert['type']} · {alert['timestamp'][:16]}"},
        }
        requests.post(
            _DISCORD_WEBHOOK,
            json={"embeds": [embed]},
            timeout=5,
        )
    except Exception as e:
        _logger.warning("Discord alert webhook failed: %s", e)


# ── Convenience functions for common alert patterns ───────────────────────

def alert_regime_change(old_phase: str, new_phase: str, exposure: int | None = None) -> dict:
    msg = f"Market regime shifted from **{old_phase}** to **{new_phase}**"
    if exposure is not None:
        msg += f". Recommended exposure: {exposure}%"
    return add_alert("regime_change", f"Regime: {new_phase}", msg,
                     data={"old_phase": old_phase, "new_phase": new_phase, "exposure": exposure})


def alert_stop_hit(symbol: str, entry_price: float, stop_price: float) -> dict:
    return add_alert("stop_hit", f"Stop Hit: {symbol}",
                     f"{symbol} hit -6% hard stop at ${stop_price:.2f} (entry ${entry_price:.2f})",
                     data={"symbol": symbol, "entry_price": entry_price, "stop_price": stop_price})


def alert_scanner_match(symbol: str, score: int, setup: str) -> dict:
    return add_alert("scanner_match", f"Scanner: {symbol} ({score}pts)",
                     f"{symbol} scored {score}/110 — {setup}",
                     data={"symbol": symbol, "score": score, "setup": setup})


def alert_exposure_shift(old_exp: int, new_exp: int, direction: str) -> dict:
    return add_alert("exposure_shift", f"Exposure {direction}: {new_exp}%",
                     f"Recommended exposure moved from {old_exp}% to {new_exp}%",
                     data={"old_exposure": old_exp, "new_exposure": new_exp})
