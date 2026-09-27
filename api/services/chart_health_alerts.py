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

⭐⭐ TERM-011 / RM-N09 STEP 4 — A CRITICAL ALSO EMAILS, AND THAT LEG IS DECIDED
INDEPENDENTLY OF DISCORD. Spec §6 step 4 wires a SECOND transport for
`(OPS, critical)` only, because it is the one acceptance criterion a single channel
cannot satisfy (`backlog.md:586-587`): *"With the primary channel's variable
blanked, a CRITICAL still reaches the second channel."* So `_should_email_second_transport`
does NOT take `webhook_present` — a second leg the first leg's absence can suppress
is not a second leg. The shape is the shipped one, `api/services/catalyst/health.py:90-108`
(post to Discord AND email a delivery-only recipients variable, best-effort).
⛔ It is INERT until `OPS_ALERT_EMAIL_TO` is set, which is nowhere today: with it
blank, `emit` resolves no recipients, sends nothing, and this file behaves exactly
as it did at step 3. ⛔ Blanking that variable is its off switch; it is never
removed (`feedback_kill_switch_never_a_delete`). ⚠️ THIS SINK IS THE ONLY PRODUCER
STEP 4 WIRES, because it is the only one whose severity is real data — the direct
ops posters pass no severity at all, and inventing one for them is a per-producer
decision the spec leaves to the owner.

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
from api.services.alert_destination import ops_email_recipients as _ops_email_recipients
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
#: ⛔⛔ TERM-011 step 4 — THE SECOND TRANSPORT'S COOLDOWN, IN ITS OWN STORE. It is
#: deliberately NOT `_discord_last`: this module's header records what one store
#: answering two questions already cost — a warning swallowed the CRITICAL page for
#: the same condition for ten minutes. A page and an email are two statements about
#: one condition, and either one being spent must not spend the other.
_email_last: dict[str, int] = {}  # alert_key -> last second-transport send ts


def _cooldown_ok(store, alert_key, now, cooldown):
    """Has `alert_key` been quiet in `store` for `cooldown`? Advances it on a True.

    ⭐ ONE AUTHORITY over the cooldown arithmetic, asked by both legs with their OWN
    store. The alternative is these four lines twice, which is
    `lesson_a_guard_repeated_is_a_guard_unproved`: a mutation of one copy leaves the
    other green, so neither copy is proved.
    """
    last = store.get(alert_key)          # None = never fired for this key → fire now
    if last is not None and now - last < cooldown:
        return False
    store[alert_key] = now
    return True


def _should_page_discord(alert_key, severity, now, *, webhook_present, enabled, cooldown=_DISCORD_COOLDOWN_SEC):
    """Pure gate: page Discord only for a CRITICAL alert, when configured, and not
    within the per-key cooldown. Mutates _discord_last on a True so the cooldown
    advances. Testable without network."""
    if severity != "critical" or not webhook_present or not enabled:
        return False
    return _cooldown_ok(_discord_last, alert_key, now, cooldown)


def _should_email_second_transport(alert_key, now, *, recipients_present,
                                   cooldown=_DISCORD_COOLDOWN_SEC):
    """Pure gate for TERM-011 step 4's SECOND transport. Testable without network.

    ⛔⛔ THERE IS NO `webhook_present` PARAMETER, AND THAT ABSENCE IS THE FEATURE.
    Spec §6 step 4 exists for the one criterion a single channel cannot satisfy —
    *"With the primary channel's variable blanked, a CRITICAL still reaches the
    second channel."* `_should_page_discord` returns False when the webhook is
    blank, so a second leg that consulted the same fact would go silent in exactly
    the case it was built for.

    ⛔ SEVERITY IS NOT CHECKED HERE, DELIBERATELY. `recipients_present` is
    `alert_destination.ops_email_recipients(severity)`'s answer, and that is empty
    unless the RESOLVER named a second transport — which it does for
    `(OPS, critical)` and nothing else (`alert_routing.SECOND_TRANSPORT_ENV_BY_CLASS`
    and `SECOND_TRANSPORT_MIN_PRIORITY`). A `severity != "critical"` test here would
    be a second authority over "only critical pages", and two copies of one rule
    disagree the day either moves.

    ⛔ NOT GATED ON `CHART_HEALTH_DISCORD_ENABLED` EITHER. That flag turns off door
    B's DISCORD page (spec §5.2: *"`0` ⇒ no page, deque still fills"*), and a second
    transport the first channel's kill switch can silence is not a second transport.
    This leg's own off switch is blanking `OPS_ALERT_EMAIL_TO`, which is where it
    stands today and why this whole path is inert.
    """
    if not recipients_present:
        return False
    return _cooldown_ok(_email_last, alert_key, now, cooldown)


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


def _email_second_transport(alert_key, message, recipients):
    """TERM-011 step 4 — the second transport. Fire-and-forget, never raises.

    ⭐ THE SHIPPED SHAPE, NOT A NEW ONE. `api/services/catalyst/health.py:99-108`
    already posts to Discord and then emails a delivery-only recipients variable
    through `email_service.send_email`, with the whole leg wrapped so a mail failure
    cannot break the alert path. This is that, for the OPS pager. ⛔ The PER-ADDRESS
    try/except is `compass_health.py:220-225`'s and it is load-bearing: one
    unroutable address must not silence the rest of the list.

    ⛔ ON ITS OWN THREAD, exactly like `_page_discord` and for the same reason —
    `send_email` blocks on Resend behind a pool and a timeout, and `emit` is called
    from watchdogs, schedulers and request paths. ⛔ The import is inside the thread:
    `email_service` reaches Resend at import, and this module is imported by the
    pager's whole call graph.

    ⚠️ It composes its own subject and body, like every other converted producer
    owns its own payload. Nothing here can carry a webhook value: it never sees one.
    """
    def _send():
        try:
            from api.services import email_service
            subject = f"🔴 UCT ops CRITICAL — {alert_key}"[:180]
            body = f"Chart health — {alert_key}\n\n{message}"[:1900]
            html = "<p style='font-size:15px'>" + body.replace("\n", "<br>") + "</p>"
            for to in recipients:
                try:
                    email_service.send_email(to, subject, html)
                except Exception:
                    pass
        except Exception:
            pass

    try:
        threading.Thread(target=_send, daemon=True, name="chart-health-ops-email").start()
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
        # ⭐⭐ TERM-011 step 4 — the SECOND transport, resolved through the SAME
        # reader and decided INDEPENDENTLY of the line above. ⛔ `recipients` carries
        # the resolver's (OPS, critical)-only answer, so this call site states no
        # severity rule of its own; `()` is the resolver's "no". With
        # `OPS_ALERT_EMAIL_TO` blank — everywhere, today — it is always `()` and
        # nothing below this line happens.
        recipients = _ops_email_recipients(severity)
        email = _should_email_second_transport(
            alert_key, now, recipients_present=bool(recipients))
    if page:
        _page_discord(alert_key, message)  # outside the lock — never block on network
    if email:
        _email_second_transport(alert_key, message, recipients)  # ditto
    return True


def list_recent(limit: int = 50) -> list[dict]:
    with _lock:
        return list(_alerts)[:limit]


def clear():
    with _lock:
        _alerts.clear()
        _throttle.clear()
        _discord_last.clear()
        # ⛔ TERM-011 step 4 — the second transport's cooldown store is cleared here
        # too, or a test that emitted a critical leaves the next one's email leg
        # suppressed and the rail reads green for the wrong reason.
        _email_last.clear()
