"""Chart-health alerts. In-memory queue of operator alerts.

Triggers (set by other modules):
  - Source pass-rate < 95% (from source_circuit_breaker)
  - WS disconnect > 60s
  - New corruption pattern detected

Alerts surface via /api/admin/bars/alerts (Plan 5 Task 7). Throttled (no
duplicate alerts with the same key within 10 min).

CRITICAL alerts also PAGE Discord (2026-08-18, instant-origin Phase 0/2): the
in-memory deque was admin-pull-only, so a bars-store problem paged no one — the
gap that let the 2026-08-11 daily freeze run for a week. Discord delivery is
fire-and-forget, gated on DISCORD_WEBHOOK_URL, and has its OWN longer cooldown so
a persistent critical doesn't spam the channel.
"""
import os
import time
import json as _json
import threading
import urllib.request as _urllib
from collections import deque
from typing import Optional

_lock = threading.RLock()
_alerts: deque = deque(maxlen=200)
_throttle: dict[str, int] = {}  # alert_key -> last_emitted_ts
_THROTTLE_SEC = 600  # 10 min
_discord_last: dict[str, int] = {}  # alert_key -> last Discord page ts
_DISCORD_COOLDOWN_SEC = 1800  # 30 min per key for the page (deque throttle is separate)


def _should_page_discord(alert_key, severity, now, *, webhook_present, enabled, cooldown=_DISCORD_COOLDOWN_SEC):
    """Pure gate: page Discord only for a CRITICAL alert, when configured, and not
    within the per-key cooldown. Mutates _discord_last on a True so the cooldown
    advances. Testable without network."""
    if severity != "critical" or not webhook_present or not enabled:
        return False
    last = _discord_last.get(alert_key)   # None = never paged this key → page now
    if last is not None and now - last < cooldown:
        return False
    _discord_last[alert_key] = now
    return True


def _page_discord(alert_key, message):
    """Fire-and-forget Discord post (never blocks the caller, never raises)."""
    webhook = os.environ.get("DISCORD_WEBHOOK_URL")
    if not webhook:
        return

    def _post():
        try:
            body = f"🔴 **Chart health — {alert_key}**: {message}"[:1900]
            data = _json.dumps({"content": body}).encode()
            req = _urllib.Request(webhook, data=data,
                                  headers={"Content-Type": "application/json",
                                           "User-Agent": "uct-chart-health/1"})
            with _urllib.urlopen(req, timeout=10) as r:
                r.read(64)
        except Exception:
            pass

    try:
        threading.Thread(target=_post, daemon=True, name="chart-health-discord").start()
    except Exception:
        pass


def emit(alert_key: str, severity: str, message: str, metadata: Optional[dict] = None) -> bool:
    """Emit an alert if not throttled. Returns True if emitted. A CRITICAL alert
    also pages Discord (fire-and-forget, own cooldown)."""
    now = int(time.time())
    with _lock:
        last = _throttle.get(alert_key, 0)
        if now - last < _THROTTLE_SEC:
            return False
        _throttle[alert_key] = now
        _alerts.appendleft({
            "alert_key": alert_key,
            "severity": severity,
            "message": message,
            "metadata": metadata or {},
            "emitted_at": now,
        })
        page = _should_page_discord(
            alert_key, severity, now,
            webhook_present=bool(os.environ.get("DISCORD_WEBHOOK_URL")),
            enabled=os.environ.get("CHART_HEALTH_DISCORD_ENABLED", "1") == "1",
        )
    if page:
        _page_discord(alert_key, message)  # outside the lock — never block on network
    return True


def list_recent(limit: int = 50) -> list[dict]:
    with _lock:
        return list(_alerts)[:limit]


def clear():
    with _lock:
        _alerts.clear()
        _throttle.clear()
        _discord_last.clear()
