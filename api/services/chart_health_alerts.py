"""Chart-health alerts. In-memory queue of operator alerts.

Triggers (set by other modules):
  - Source pass-rate < 95% (from source_circuit_breaker)
  - WS disconnect > 60s
  - New corruption pattern detected

Alerts surface via /api/admin/bars/alerts (Plan 5 Task 7). Throttled (no
duplicate alerts with the same key AND SEVERITY within 10 min).

⛔⛔ THE THROTTLE IS PER (KEY, SEVERITY), AND THE SEVERITY HALF IS THE FIX.
It was per KEY alone, and `emit` returns on the throttle BEFORE
`_should_page_discord` ever runs — so a WARNING emitted at t=0 swallowed the
CRITICAL page for the same condition for the next 10 minutes. `bars_continuous_audit`
emits `intraday_hotset_stale` at warning (>=0.08 of actively-viewed charts stale)
and critical (>=0.20) under one key on a 5-minute cycle, so a freshness pipeline
degrading past 8% and then past 20% inside one window paged NOBODY: the warning
row went into the deque, the critical never reached the gate, and the operator
learned about a broken pipeline from a warning in an admin feed they were not
looking at. Escalation is precisely the event a page exists for.

⭐ AND THE FLOOD BOUND IS UNCHANGED, WHICH IS WHY THIS IS SAFE. The throttle is
not removed or widened: it still admits at most one emit per (key, severity) per
`_THROTTLE_SEC`, so the deque is bounded by 3x (the number of severities) instead
of 1x, and Discord is bounded by `_discord_last`, which remains keyed on the
ALERT KEY ALONE — only criticals page, so a flapping metric oscillating across
the 0.20 boundary still gets at most one page per key per `_DISCORD_COOLDOWN_SEC`.
Trading a swallowed page for a flood would not have been a fix.

CRITICAL alerts also PAGE Discord (2026-08-18, instant-origin Phase 0/2): the
in-memory deque was admin-pull-only, so a bars-store problem paged no one — the
gap that let the 2026-08-11 daily freeze run for a week. Discord delivery is
fire-and-forget, gated on an OPS-class destination, and has its OWN longer
cooldown so a persistent critical doesn't spam the channel.

⭐ TERM-011 / RM-N09 STEP 3 — THIS SINK'S 22 EMIT SITES ARE CONVERTED AS ONE
CLASS, AND NOT ONE OF THEM MOVED. The destination is resolved here, once, by
`alert_destination.ops_webhook()` instead of by a literal `DISCORD_WEBHOOK_URL`
read. `emit`'s signature, its free-string severity, both throttles, the page
gate and all 22 call sites are untouched — the only thing that changed is where
the SINK sends things. ⛔ With `DISCORD_OPS_WEBHOOK_URL` unset or blank, which is
how it ships, that call returns exactly what the literal read returned, so every
page lands where it landed before, byte for byte.
"""
import os
import time
import json as _json
import threading
import urllib.request as _urllib
from collections import deque
from typing import Optional

# ⭐ TERM-011 / RM-N09 step 3 — the OPS-class destination reader. Imported at MODULE
# level rather than inside `emit`: `emit` resolves the destination while holding
# `_lock`, and a lazy import under a lock is a worse trade than a four-module,
# stdlib-only import chain at boot (alert_destination -> alert_routing -> alerts ->
# cache). ⛔ It is a reader, never a transport — the POST below is unchanged.
from api.services.alert_destination import ops_webhook as _ops_webhook

_lock = threading.RLock()
_alerts: deque = deque(maxlen=200)
#: ⛔ (alert_key, severity), NOT alert_key. See the module docstring: keyed on
#: the alert_key alone, a warning silenced the critical page for the same
#: condition. A severity is a DIFFERENT statement about the same condition and
#: gets its own window.
_throttle: dict[tuple[str, str], int] = {}  # (alert_key, severity) -> last_emitted_ts
_THROTTLE_SEC = 600  # 10 min
#: ⛔ KEYED ON alert_key ALONE, DELIBERATELY — this is the anti-flood bound, and
#: only a CRITICAL ever reaches it, so a severity dimension here would be dead
#: state that also tripled how often Discord can be paged for one condition.
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
    # ⭐ TERM-011 / RM-N09 step 3 — the OPS-class destination, resolved at CALL time.
    # ⛔ With DISCORD_OPS_WEBHOOK_URL unset or blank (how it ships, and what production
    # holds) this returns DISCORD_WEBHOOK_URL's value — exactly what the literal read
    # that stood here returned. Same channel, same bytes; proved at the wire in
    # tests/test_alert_destination.py.
    webhook = _ops_webhook()
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
    also pages Discord (fire-and-forget, own cooldown).

    ⛔ THE THROTTLE IS PER (KEY, SEVERITY) AND THE ORDER BELOW IS WHY THAT MATTERS:
    this returns on the throttle BEFORE `_should_page_discord` runs, so anything
    the throttle swallows is also un-pageable. Per key alone, a warning at 0.09
    silenced the critical page at 0.21 for the rest of the window.
    """
    now = int(time.time())
    with _lock:
        throttle_key = (alert_key, severity)
        last = _throttle.get(throttle_key, 0)
        if now - last < _THROTTLE_SEC:
            return False
        _throttle[throttle_key] = now
        _alerts.appendleft({
            "alert_key": alert_key,
            "severity": severity,
            "message": message,
            "metadata": metadata or {},
            "emitted_at": now,
        })
        page = _should_page_discord(
            alert_key, severity, now,
            # TERM-011 step 3: the same OPS-class resolution the POST uses, so the
            # gate and the transport can never disagree about which channel exists.
            webhook_present=bool(_ops_webhook()),
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
