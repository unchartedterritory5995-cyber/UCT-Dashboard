"""Discord relay — post messages from voice Compass to a Discord channel.

Wraps the existing DISCORD_WEBHOOK_URL env var (already used by the
morning-wire pipeline). Voice tool: post_to_discord(message, embed_title).

Rate-limit at 5 posts/min/user to prevent accidental spam.
"""

import logging
import os
import time
from typing import Any

import requests

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)
_TIMEOUT = 8
_PER_USER_LIMIT = 5  # max posts per user per minute

# {user_id: [unix_ts, unix_ts, ...]} — module-level rate limit ledger
_RATE_LEDGER: TTLCache = TTLCache()
_RATE_WINDOW = 60


def _check_rate_limit(user_id: str) -> tuple[bool, int]:
    """Return (allowed, remaining)."""
    key = f"discord::{user_id}"
    now = int(time.time())
    history = _RATE_LEDGER.get(key) or []
    history = [t for t in history if now - t < _RATE_WINDOW]
    if len(history) >= _PER_USER_LIMIT:
        return False, 0
    history.append(now)
    _RATE_LEDGER.set(key, history, _RATE_WINDOW)
    return True, _PER_USER_LIMIT - len(history)


def post_message(
    *,
    user_id: str,
    message: str,
    embed_title: str | None = None,
    color: int = 0xC9A84C,  # UCT gold
) -> dict[str, Any]:
    """Post to Discord. Returns {ok, status_code, ...} or {error}.
    Rate-limited 5/min/user."""
    webhook = os.environ.get("DISCORD_WEBHOOK_URL", "").strip()
    if not webhook:
        return {"error": "DISCORD_WEBHOOK_URL not configured"}

    message = (message or "").strip()
    if not message:
        return {"error": "empty message"}
    if len(message) > 1800:
        message = message[:1797] + "..."

    allowed, remaining = _check_rate_limit(user_id)
    if not allowed:
        return {"error": "rate limit exceeded (5 posts/min)", "remaining": 0}

    if embed_title:
        payload = {
            "embeds": [{
                "title": embed_title[:200],
                "description": message,
                "color": color,
                "footer": {"text": "via Compass voice"},
            }]
        }
    else:
        payload = {"content": message}

    try:
        r = requests.post(webhook, json=payload, timeout=_TIMEOUT)
        return {
            "ok": r.ok,
            "status_code": r.status_code,
            "remaining_this_minute": remaining,
        }
    except requests.RequestException as e:
        _log.warning("discord relay failed: %s", e)
        return {"error": f"discord post failed: {e}"}
