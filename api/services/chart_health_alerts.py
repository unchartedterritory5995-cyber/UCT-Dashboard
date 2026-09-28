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

⭐⭐ TERM-016 / FB-OBS-05 — THE PAGE COOLDOWNS SURVIVE A DEPLOY. Both "we already
told you" stamps (Discord and the second transport) were module dicts, so every
redeploy re-paged a standing critical and a second instance doubled each bound.
They now live in `alert_cooldown` (one row per channel+key, claimed by ONE atomic
upsert) under `DATA_DIR`. ⛔ A store that cannot answer FAILS OPEN to the old
per-process cooldown: a broken cooldown must never silence a critical.

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
import logging
import sqlite3
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

_logger = logging.getLogger(__name__)

# ⭐⭐ TERM-016 / FB-OBS-05 — THE PAGE COOLDOWNS ARE DURABLE. `_discord_last` and
# `_email_last` above were the ONLY record of "we already told you", and a module
# dict dies with the process: every redeploy re-paged a STANDING critical on its
# first cycle (fourteen deploys in a day = fourteen pages for one fault), and a
# second instance doubled every bound (STATE-7). The authority is now one row per
# (channel, alert_key) in `alert_cooldown`, the `fundamentals_monitor.monitor_meta`
# shape. The two dicts stay as the per-process FALLBACK and mirror — see
# `_cooldown_ok` for why a broken store must page.
#
# ⛔ `_throttle` and the deque are deliberately NOT moved: they bound THIS process's
# admin feed, which is itself per-process. A durable deque throttle would leave a
# freshly booted pod's feed empty for a standing condition, and would buy nothing,
# because the PAGE is decided by the durable store below regardless.
#
# ⛔ The path is read at CALL time (like `ai_search_member._db_path`), so the test
# sandbox's `DATA_DIR` redirect reaches it and nothing is captured at import.
COOLDOWN_DB_ENV = "CHART_HEALTH_COOLDOWN_DB_PATH"
#: Short on purpose: the claim runs under `_lock`, inside `emit`, which watchdogs and
#: request paths call. A store that cannot answer in this long is a broken store,
#: and a broken store FAILS OPEN rather than holding the pager hostage.
_COOLDOWN_DB_TIMEOUT_SEC = 2.0
_COOLDOWN_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS alert_cooldown ("
    " channel      TEXT    NOT NULL,"   # 'discord' | 'email' — two legs, two budgets
    " alert_key    TEXT    NOT NULL,"
    " last_sent_at INTEGER NOT NULL,"   # epoch seconds of the last page ACTUALLY sent
    " PRIMARY KEY (channel, alert_key))"
)
#: ⛔ ONE STATEMENT, SO THE CHECK AND THE WRITE CANNOT BE SPLIT BY A SECOND POD.
#: Insert the stamp, or on conflict overwrite it ONLY when the old one is at least
#: `cooldown` old. `rowcount == 1` means this caller claimed the page; 0 means a
#: stamp inside the window already exists. A read-then-write would let two pods both
#: read "quiet" and both page.
_COOLDOWN_CLAIM_SQL = (
    "INSERT INTO alert_cooldown (channel, alert_key, last_sent_at) VALUES (?, ?, ?) "
    "ON CONFLICT(channel, alert_key) DO UPDATE SET last_sent_at = excluded.last_sent_at "
    "WHERE excluded.last_sent_at - alert_cooldown.last_sent_at >= ?"
)


def _cooldown_db_path() -> str:
    return os.environ.get(
        COOLDOWN_DB_ENV,
        os.path.join(os.environ.get("DATA_DIR", "/data"), "chart_health_alerts.db"),
    )


def _cooldown_connect() -> sqlite3.Connection:
    path = _cooldown_db_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    conn = sqlite3.connect(path, timeout=_COOLDOWN_DB_TIMEOUT_SEC)
    conn.execute(_COOLDOWN_SCHEMA)
    return conn


def _durable_claim(channel, alert_key, now, cooldown) -> bool:
    """Atomically claim a page for (channel, alert_key) in the shared store.
    RAISES on any store fault — the caller owns the fail-open decision."""
    conn = _cooldown_connect()
    try:
        cur = conn.execute(_COOLDOWN_CLAIM_SQL, (channel, alert_key, int(now), int(cooldown)))
        conn.commit()
        return cur.rowcount == 1
    finally:
        conn.close()


def _cooldown_ok(channel, store, alert_key, now, cooldown):
    """Has `alert_key` been quiet on `channel` for `cooldown`? Advances it on a True.

    ⭐ ONE AUTHORITY over the cooldown arithmetic, asked by both legs with their OWN
    channel and store. The alternative is this body twice, which is
    `lesson_a_guard_repeated_is_a_guard_unproved`: a mutation of one copy leaves the
    other green, so neither copy is proved.

    ⭐ TERM-016: the durable row is the authority, so a restart or a second pod does
    not re-page. `store` (the old module dict) is mirrored on a claim and is the
    fallback when the durable store cannot answer.

    ⛔⛔ A BROKEN STORE FAILS OPEN. Unreadable, corrupt, locked past the timeout or
    unopenable: the durable answer is UNKNOWN, and an unknown "already told you" is
    not permission to stay silent about a critical. It degrades to exactly the
    pre-TERM-016 per-process cooldown — the first critical in this process pages,
    and a repeat inside the window in THIS process is still bounded.
    """
    try:
        fire = _durable_claim(channel, alert_key, now, cooldown)
    except Exception as exc:  # noqa: BLE001 — any store fault fails OPEN
        _logger.warning("[chart-health] durable cooldown store unavailable (%s: %s); "
                        "falling back to the per-process cooldown for %s/%s",
                        type(exc).__name__, exc, channel, alert_key)
        last = store.get(alert_key)      # None = never fired for this key → fire now
        if last is not None and now - last < cooldown:
            return False
        store[alert_key] = now
        return True
    if fire:
        store[alert_key] = now           # mirror, so a later store fault stays bounded
    return fire


def _should_page_discord(alert_key, severity, now, *, webhook_present, enabled, cooldown=_DISCORD_COOLDOWN_SEC):
    """Pure gate: page Discord only for a CRITICAL alert, when configured, and not
    within the per-key cooldown. Mutates _discord_last on a True so the cooldown
    advances. Testable without network."""
    if severity != "critical" or not webhook_present or not enabled:
        return False
    return _cooldown_ok("discord", _discord_last, alert_key, now, cooldown)


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
    return _cooldown_ok("email", _email_last, alert_key, now, cooldown)


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
        # ⛔ TERM-016 — and the durable cooldown table, for the same reason: a stamp
        # left behind makes the next test's critical read as already-paged. Test-only
        # helper (no product caller); best-effort, a missing store is already empty.
        try:
            conn = _cooldown_connect()
            try:
                conn.execute("DELETE FROM alert_cooldown")
                conn.commit()
            finally:
                conn.close()
        except Exception:  # noqa: BLE001
            pass
