# api/services/alerts.py — Alert management service
"""
Stores alerts in memory (TTLCache) and optionally fires Discord webhooks.

Alert types:
    regime_change  — market phase transition (e.g. Markup → Distribution)
    stop_hit       — UCT20 position hit -6% hard stop
    scanner_match  — new high-conviction scanner candidate (score >= 80)
    ep_resolved    — entry point candidate stopped or hit target
    exposure_shift — exposure rating moved 20+ points

⭐ TWO AUDIENCES, ONE FUNCTION — the scoping contract (2026-08-06)
──────────────────────────────────────────────────────────────────
Until 2026-08-06 every alert — system broadcast AND per-member — went into ONE
cache list under the key ``"alerts"``, and ``GET /api/alerts`` served it with no
auth. An unauthenticated request from the public internet returned HTTP 200 and
the feed. Both halves are fixed; **neither half is sufficient alone** — on one
global list, requiring auth just means every logged-in member reads every other
member's alerts.

``user_id`` is what distinguishes the two audiences, and it is OPTIONAL on
purpose:

  • ``user_id=None`` → **BROADCAST**. Visible to every logged-in member. This is
    the honest shape for the callers that genuinely have no user:
    ``regime_change``, ``scanner_match``, ``exposure_shift``, ``ep_resolved``,
    ``stop_hit`` and the wire watchdog in ``api/main.py``. Forcing a user id on
    them would either break them or silently attribute a market-wide event to
    one arbitrary account.

  • ``user_id="…"`` → **PRIVATE**. Visible only to that member. Every caller on
    the member delivery path already HAS the id — ``watchlist_alert_service``
    takes ``user_id`` as its first parameter and every one of its callers
    (indicator alerts, catalyst alerts + must-know, calendar alerts, awareness
    engine, price alerts) passes a real one.

Read state follows the same split: a private alert carries its own ``read``
flag, while a broadcast row is SHARED, so its read mark is recorded per member
in a separate set. Flipping ``read`` on the shared dict is what let the first
member to open the bell mark it read for everyone.

⚠️ DURABILITY — ``cache`` is an in-process TTLCache on a single uvicorn pod. It
resets on every redeploy and expires at 24 h, and its LRU is capped at 1000
keys total (shared with bars/news/snapshot). Per-member alerts therefore do NOT
survive a deploy, and at a few hundred active members the per-user keys start
competing with the hot data keys. This is acceptable for a 24 h notification
bell and is NOT durable storage: if per-member alerts must survive a redeploy
they belong in ``auth.db`` (the web-local SQLite on the Railway volume), as a
``user_alerts`` table alongside ``watchlist_alerts`` / ``indicator_alerts``,
which is where the rest of the per-member alert state already lives.
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


# ── the store's three key shapes ────────────────────────────────────────────
# Kept as functions, not f-strings at each call site, so the scoping is one
# place a reviewer can read and one place a mutation can be aimed at.
_BROADCAST_KEY = "alerts"          # audience: everyone
_TTL = 86400                       # 24 h
_MAX_PER_LIST = 100
_MAX_READ_MARKS = 500              # bounds the per-member broadcast read set


def _user_key(user_id: str) -> str:
    """The private feed of ONE member."""
    return f"alerts:u:{user_id}"


def _read_key(user_id: str) -> str:
    """One member's read marks on the SHARED broadcast rows."""
    return f"alerts:read:{user_id}"


def get_alerts(limit: int = 50, user_id: str | None = None) -> list:
    """Return the alerts this caller is entitled to, newest first.

    ``user_id=None`` returns BROADCAST ONLY. That is the safe default and the
    reason it is the default: a caller that forgot to say who it is gets the
    market-wide feed, never somebody's private one.

    A member gets broadcast + their own, merged newest-first, with the
    broadcast rows' ``read`` resolved against THEIR OWN read marks. Copies are
    returned so a caller can never mutate the cached rows other members share.
    """
    broadcast = cache.get(_BROADCAST_KEY) or []
    if not user_id:
        return [dict(a) for a in broadcast][:limit]

    read_ids = set(cache.get(_read_key(user_id)) or ())
    mine = cache.get(_user_key(user_id)) or []
    merged = [dict(a, read=(a["id"] in read_ids)) for a in broadcast]
    merged += [dict(a) for a in mine]
    merged.sort(key=lambda a: a.get("timestamp") or "", reverse=True)
    return merged[:limit]


def add_alert(
    alert_type: str,
    title: str,
    message: str,
    severity: str | None = None,
    data: dict | None = None,
    user_id: str | None = None,
) -> dict:
    """Add an alert and optionally fire the Discord webhook.

    ``user_id=None`` → broadcast to every member (the system subsystems).
    ``user_id="…"``  → private to that member (the delivery path).

    ⭐ THIS FUNCTION IS THE SINGLE OWNER OF THE ALERT DISCORD WEBHOOK. Callers
    must NOT call ``_fire_discord`` themselves after calling this — that was
    the double-fire that put every delivered alert into the admin channel
    twice (`watchlist_alert_service`, fixed 2026-08-06).
    """
    alert = {
        "id": f"{alert_type}_{int(time.time() * 1000)}",
        "type": alert_type,
        "severity": severity or _TYPE_SEVERITY.get(alert_type, SEVERITY_INFO),
        "title": title,
        "message": message,
        "timestamp": _now_et(),
        "read": False,
        "user_id": user_id,          # None = broadcast; the audience, recorded
        "data": data or {},
    }

    # Prepend to the owning list (newest first), cap at 100
    key = _BROADCAST_KEY if user_id is None else _user_key(user_id)
    alerts = cache.get(key) or []
    alerts.insert(0, alert)
    cache.set(key, alerts[:_MAX_PER_LIST], ttl=_TTL)

    # Fire Discord webhook for warning/critical
    if _DISCORD_WEBHOOK and alert["severity"] in (SEVERITY_WARNING, SEVERITY_CRITICAL):
        _fire_discord(alert)

    return alert


def mark_read(alert_id: str, user_id: str) -> bool:
    """Mark ONE alert read FOR THIS MEMBER. False if it isn't theirs to mark.

    Only two places are searched: the member's own private list, and the
    broadcast list. An id belonging to another member is in neither, so it
    simply is not found — there is no path from here to another member's row.
    """
    if not user_id:
        return False

    mine = cache.get(_user_key(user_id)) or []
    for a in mine:
        if a["id"] == alert_id:
            if not a["read"]:
                a["read"] = True
                cache.set(_user_key(user_id), mine, ttl=_TTL)
            return True

    # A broadcast row is SHARED — record the read mark against the member, not
    # against the row (flipping the row marked it read for everyone).
    if any(a["id"] == alert_id for a in (cache.get(_BROADCAST_KEY) or [])):
        marks = list(cache.get(_read_key(user_id)) or [])
        if alert_id not in marks:
            marks.append(alert_id)
            cache.set(_read_key(user_id), marks[-_MAX_READ_MARKS:], ttl=_TTL)
        return True

    return False


def mark_all_read(user_id: str) -> int:
    """Mark this member's whole feed read. Returns count newly marked."""
    if not user_id:
        return 0

    count = 0
    mine = cache.get(_user_key(user_id)) or []
    for a in mine:
        if not a["read"]:
            a["read"] = True
            count += 1
    if mine:
        cache.set(_user_key(user_id), mine, ttl=_TTL)

    marks = list(cache.get(_read_key(user_id)) or [])
    seen = set(marks)
    for a in cache.get(_BROADCAST_KEY) or []:
        if a["id"] not in seen:
            marks.append(a["id"])
            seen.add(a["id"])
            count += 1
    cache.set(_read_key(user_id), marks[-_MAX_READ_MARKS:], ttl=_TTL)
    return count


def clear_alerts(user_id: str | None = None) -> int:
    """Remove alerts. ``user_id=None`` clears the BROADCAST feed only."""
    key = _BROADCAST_KEY if user_id is None else _user_key(user_id)
    count = len(cache.get(key) or [])
    cache.set(key, [], ttl=_TTL)
    if user_id is not None:
        cache.invalidate(_read_key(user_id))
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
