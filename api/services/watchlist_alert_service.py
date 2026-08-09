"""
Watchlist alert service — per-symbol price alerts with multi-channel delivery.
Alerts are checked against live prices on each polling cycle.
"""

import uuid
import time
import logging
import threading
from datetime import datetime, timezone

from api.services.auth_db import get_connection
from api.services.alerts import (
    add_alert,
    CHANNEL_OK, CHANNEL_FAILED, CHANNEL_SKIPPED,
    CHANNEL_IN_APP, CHANNEL_DISCORD, CHANNEL_EMAIL,
)
from api.services.email_service import send_email, _wrap_html

_logger = logging.getLogger(__name__)
_check_lock = threading.Lock()

# Every channel this hook is responsible for, in delivery order. Named once so
# the report and the code that fills it cannot disagree about what "every
# channel" is — a channel missing from this tuple would simply never be reported
# on, which is the silence this whole change exists to remove.
DELIVERY_CHANNELS = (CHANNEL_IN_APP, CHANNEL_DISCORD, CHANNEL_EMAIL)


def _delivery_report(claimed: bool, channels: dict, errors: dict) -> dict:
    """One channel map → the outcome its caller reads. **The counts are DERIVED.**

    ⛔ `channels_ok` IS NOT A SECOND AUTHORITY OVER `channels` — it is computed
    from it, here, at the single place a report is built. A counter incremented
    beside the map is this repo's most-repeated defect: the two drift, and the
    one that lies is whichever the reader happened to trust.

    `claimed` is NOT a channel. It says whether this call owned a delivery at
    all: the compare-and-set on the fired log refuses a duplicate, a snoozed
    alert and a fire another frame already took, and in every one of those cases
    ZERO channels ran and zero SHOULD have. A caller that read that as "nothing
    reached the member" would release a lease it never held and re-send.
    """
    return {
        "claimed": bool(claimed),
        "channels": dict(channels),
        "channels_ok": sum(1 for v in channels.values() if v == CHANNEL_OK),
        "channels_failed": sum(1 for v in channels.values() if v == CHANNEL_FAILED),
        "errors": dict(errors),
    }


def create_alert(user_id: str, sym: str, target_price: float, direction: str,
                 alert_type: str = "price", anchors: tuple | None = None) -> dict:
    """Create a price/line/trendline alert.

    anchors (trendline only) = (t1, p1, t2, p2) — two chart-line anchor points as
    (unix-seconds, price). The server-side checker interpolates the line's level at
    check time from these; for 'price'/'line' they stay NULL and target_price is the
    fixed level.
    """
    at1 = ap1 = at2 = ap2 = None
    if alert_type == "trendline" and anchors and len(anchors) == 4:
        at1, ap1, at2, ap2 = anchors
    conn = get_connection()
    try:
        alert_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO watchlist_alerts (id, user_id, sym, target_price, direction, is_active, created_at, "
            "alert_type, anchor_t1, anchor_p1, anchor_t2, anchor_p2) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (alert_id, user_id, sym.upper(), target_price, direction, 1, now,
             alert_type, at1, ap1, at2, ap2),
        )
        conn.commit()
        return {"id": alert_id, "user_id": user_id, "sym": sym.upper(),
                "target_price": target_price, "direction": direction,
                "is_active": 1, "created_at": now, "alert_type": alert_type,
                "anchor_t1": at1, "anchor_p1": ap1, "anchor_t2": at2, "anchor_p2": ap2}
    finally:
        conn.close()


def _alert_level_now(alert: dict, now_sec: float) -> float:
    """The alert's level at `now_sec`. For a trendline, linearly interpolate/extrapolate
    from the two anchors; otherwise the fixed target_price."""
    if (alert.get("alert_type") == "trendline"):
        t1, p1 = alert.get("anchor_t1"), alert.get("anchor_p1")
        t2, p2 = alert.get("anchor_t2"), alert.get("anchor_p2")
        if None not in (t1, p1, t2, p2) and t2 != t1:
            return p1 + (p2 - p1) * ((now_sec - t1) / (t2 - t1))
    return alert["target_price"]


def list_user_alerts(user_id: str, active_only: bool = True) -> list[dict]:
    conn = get_connection()
    try:
        q = "SELECT * FROM watchlist_alerts WHERE user_id = ?"
        params = [user_id]
        if active_only:
            q += " AND is_active = 1"
        q += " ORDER BY created_at DESC"
        return [dict(r) for r in conn.execute(q, params).fetchall()]
    finally:
        conn.close()


def delete_alert(user_id: str, alert_id: str) -> bool:
    conn = get_connection()
    try:
        result = conn.execute(
            "DELETE FROM watchlist_alerts WHERE id = ? AND user_id = ?", (alert_id, user_id)
        )
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()


def _trigger_alert(alert_id: str) -> dict | None:
    conn = get_connection()
    try:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "UPDATE watchlist_alerts SET is_active = 0, triggered_at = ? WHERE id = ?",
            (now, alert_id),
        )
        conn.commit()
        row = conn.execute("SELECT * FROM watchlist_alerts WHERE id = ?", (alert_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def _get_user_email(user_id: str) -> str | None:
    conn = get_connection()
    try:
        row = conn.execute("SELECT email FROM users WHERE id = ?", (user_id,)).fetchone()
        return row["email"] if row else None
    finally:
        conn.close()


def check_alerts_against_prices(price_data: dict,
                                reports: list | None = None) -> list[dict]:
    """Check all active alerts against current prices. Returns triggered alerts.

    ⭐ ``reports`` IS AN OUT-LIST, and it exists because "triggered" and
    "delivered" are different facts. The returned list says the price crossed —
    which is true whether or not a single channel landed. Handed a list, this
    appends one `_delivery_report` per fire so the caller can say which members
    were actually told; handed nothing, it behaves exactly as before.

    ⛔ NOT ON THE RETURNED ALERT DICTS. Those rows are the `watchlist_alerts`
    records; a delivery-status key on them would be a second authority over the
    same fact, in the artifact rather than beside it. Same shape as
    `add_alert`'s `channels` out-dict, for the same reason.
    """
    conn = get_connection()
    try:
        active = conn.execute(
            "SELECT * FROM watchlist_alerts WHERE is_active = 1"
        ).fetchall()
    finally:
        conn.close()

    now_sec = time.time()
    triggered = []
    for row in active:
        alert = dict(row)
        sym = alert["sym"]
        if sym not in price_data:
            continue
        current_price = price_data[sym]
        # For a trendline alert the level moves over time; interpolate it at "now".
        target = _alert_level_now(alert, now_sec)
        direction = alert["direction"]

        fire = False
        if direction == "above" and current_price >= target:
            fire = True
        elif direction == "below" and current_price <= target:
            fire = True

        if fire:
            triggered_alert = _trigger_alert(alert["id"])
            if triggered_alert:
                triggered.append(triggered_alert)
                report = _deliver_alert(triggered_alert, current_price)
                if reports is not None:
                    reports.append(report)

    return triggered


def _deliver_alert(alert: dict, current_price: float) -> dict:
    """Multi-channel delivery: AlertBell + Email + Discord. **Reports per channel.**

    🔴 THE OTHER LANE OF THE SAME DEFECT `deliver_alert_payload` CLOSED IN
    `c5e1bb2c`, left deliberately then and closed now. Every channel was wrapped
    in its own `try/except` and this returned ``None`` whether all three landed
    or all three raised, so a member whose email bounced and whose webhook 403'd
    was byte-indistinguishable from one told on every channel. The alert is
    deactivated BEFORE delivery (`_trigger_alert`), so the silence was terminal:
    there is no second attempt in this lane and nothing anywhere said a member
    missed the alert they had asked for.

    ⛔ THE DEDUP IS UNTOUCHED, AND IT IS NOT A CAS HERE. This lane fires once
    because `_trigger_alert` sets `is_active = 0` before any channel runs, so
    the next poll cycle no longer selects the row. That ordering is deliberate —
    an alert that fired must never re-fire because a channel was slow — and
    nothing below moves it. ⚠️ It also means a failed delivery is NOT retried,
    which is exactly why the report has to exist: the failure is permanent and
    must at least be visible.

    ⭐ THREE STATES, AND PARTIAL SUCCESS IS REPRESENTABLE — the same vocabulary
    `alerts.py` owns (`ok` / `failed` / `skipped`). A member with no address on
    file is SKIPPED, not failed: read as a failure it sends somebody hunting a
    Resend outage that does not exist. The counts are DERIVED from the channel
    map by `_delivery_report`; there is no counter beside it to drift.

    :returns: ``{"claimed", "channels", "channels_ok", "channels_failed",
        "errors"}``. ``claimed`` is always True — reaching this function IS the
        claim in this lane, because the row was already deactivated.
    """
    sym = alert["sym"]
    direction = alert["direction"]
    target = alert["target_price"]
    msg = f"{sym} {'crossed above' if direction == 'above' else 'dropped below'} ${target:.2f} (now ${current_price:.2f})"

    channels: dict[str, str] = {}
    errors: dict[str, str] = {}

    # 1. AlertBell (in-app) — PRIVATE to the member who set the alert.
    # `user_id` is what keeps this out of the broadcast feed every other member
    # reads. Without it a price alert is visible to the whole membership.
    #
    # ⭐ …and 3. Discord, which `add_alert` fires itself and therefore reports on
    # itself (see the note at the foot of this function). `channels` is its
    # out-dict; this layer never restates what that function said.
    in_app_raised = False
    try:
        add_alert(
            "price_alert",
            f"Alert: {sym} ${current_price:.2f}",
            msg,
            severity="warning",
            data={"symbol": sym, "target_price": target, "current_price": current_price, "direction": direction},
            user_id=alert["user_id"],
            channels=channels,
        )
    except Exception as e:
        in_app_raised = True
        _logger.warning("AlertBell delivery failed: %s", e)
        errors[CHANNEL_IN_APP] = f"{type(e).__name__}: {e}"
    # ⚠️ `setdefault`, NEVER AN ASSIGNMENT — `add_alert` is the authority on the
    # two channels it owns. 🔴 And the in-app default is keyed on whether it
    # RAISED, not on whether it reported: a silent-but-successful call defaulted
    # to `failed` is a false negative, and this repo has already measured that
    # one turning a quiet alert into three deliveries in the indicator lane.
    channels.setdefault(CHANNEL_IN_APP,
                        CHANNEL_FAILED if in_app_raised else CHANNEL_OK)
    channels.setdefault(CHANNEL_DISCORD, CHANNEL_SKIPPED)

    # 2. Email
    try:
        email = _get_user_email(alert["user_id"])
        if not email:
            # No address on file. Nothing was attempted and nothing failed.
            channels[CHANNEL_EMAIL] = CHANNEL_SKIPPED
        if email:
            html = _wrap_html(f"""
                <h2 style="color:#c9a84c;font-size:16px;margin:0 0 16px;">Price Alert Triggered</h2>
                <p style="color:#e8e0d0;font-size:14px;margin:0 0 8px;">
                    <strong>{sym}</strong> {'crossed above' if direction == 'above' else 'dropped below'}
                    <strong>${target:.2f}</strong>
                </p>
                <p style="color:#e8e0d0;font-size:14px;margin:0 0 16px;">
                    Current price: <strong>${current_price:.2f}</strong>
                </p>
                <p style="color:#6b6a60;font-size:12px;margin:0;">
                    This alert has been deactivated. Set a new one in your Watchlists.
                </p>
            """)
            # ⭐ `send_email` HAS RETURNED A BOOL SINCE IT WAS WRITTEN, and this
            # call site threw it away. Resend unconfigured, a 10s timeout and a
            # 429 all return False there and all read as a sent email here — the
            # production failure mode is a False RETURN, not a raise.
            ok = send_email(email, f"UCT Alert: {sym} hit ${target:.2f}", html)
            channels[CHANNEL_EMAIL] = CHANNEL_OK if ok else CHANNEL_FAILED
            if not ok:
                errors[CHANNEL_EMAIL] = "send_email reported failure (see email log)"
    except Exception as e:
        _logger.warning("Email delivery failed: %s", e)
        channels[CHANNEL_EMAIL] = CHANNEL_FAILED
        errors[CHANNEL_EMAIL] = f"{type(e).__name__}: {e}"

    # 3. Discord — ALREADY FIRED, by `add_alert` in step 1, WHICH IS ALSO WHERE
    #    ITS OUTCOME COMES FROM (`channels["discord"]`, filled by that function).
    #
    # ⛔ DO NOT RE-ADD AN EXPLICIT `_fire_discord` HERE. `add_alert` posts to the
    # webhook itself for severity warning/critical, and step 1 passes
    # severity="warning" — so the explicit second call that used to sit here put
    # every single triggered alert into the admin channel TWICE (verified on
    # production 2026-08-06). `add_alert` is the single owner of the webhook;
    # `tests/test_alerts_privacy.py` counts real `requests.post` calls and fails
    # at two.
    #
    # ⛔ AND DO NOT "FIX" THE REPORTING BY POSTING ONE HERE TO SEE THE RESULT.
    # That is the double-post again, wearing the words of this task.
    return _delivery_report(True, channels, errors)


def deliver_alert_payload(
    user_id: str,
    sym: str,
    title: str,
    message: str,
    source: str = "indicator_alert",
    extra_data: dict | None = None,
) -> dict:
    """Public delivery hook reusable by other alert systems (e.g. indicator alerts).

    Mirrors the multi-channel delivery in ``_deliver_alert`` but accepts a
    generic title/message instead of price-alert specifics. Each channel is
    isolated in its own try/except so a single failure does not block the
    others. Safe to call from a background thread (no Flask/FastAPI context
    is required).

    🔴 **IT NOW REPORTS WHAT ACTUALLY HAPPENED, PER CHANNEL.** This returned
    ``None`` whether every channel landed or every one raised, and the caller
    stamped `delivered_at` either way — so an alert whose email bounced, whose
    Discord webhook 403'd and whose in-app write failed was recorded, forever,
    as delivered. Measured in-tree: **20 fires → 20/20 rows stamped delivered,
    zero retry, one warning line.** A trader believed they had been told and
    they had not.

    ⭐ PARTIAL SUCCESS IS THE COMMON CASE AND IS REPRESENTABLE. "in-app ok,
    email failed" is the truth most of the time — Resend is unset in dev, the
    Discord webhook is one global admin hook, a member may have no address —
    and collapsing it EITHER way is a lie. `channels` names each one; the
    counts are derived from it.

    ⛔ A FAILING CHANNEL STILL DOES NOT ABORT THE OTHERS. Each stays in its own
    `try/except`, exactly as before. The change is that the exception is now
    also RECORDED instead of only logged.

    ⛔ AND THE FIRE-ONCE GATE IS UNTOUCHED. The `claim_delivery` compare-and-set
    below still runs BEFORE any channel, still exactly once per recorded fire.
    A refused claim returns ``claimed: False`` with an empty channel map — NOT a
    failure, because nothing was owed. `_delivery_failed` reads that flag first
    for precisely that reason.

    :returns: ``{"claimed", "channels", "channels_ok", "channels_failed",
        "errors"}`` — see `_delivery_report`.
    """
    # ⭐ FIRE-ONCE FOR THE CHART INDICATOR LANE (Phase C Task 11) — the ONE gate
    # every channel below is downstream of.
    #
    # `indicator_alert_evaluator._run_one_cycle` calls this on EVERY cycle the
    # condition is true, and `above`/`below` are LEVEL conditions with no
    # reference to `prev`, so before this line an armed alert re-delivered bell +
    # email + Discord every 60 seconds for as long as it stayed true. The claim
    # is an atomic compare-and-set on the fired log: it succeeds exactly once per
    # RECORDED fire and refuses for a duplicate, a snoozed alert, or a fire
    # already delivered.
    #
    # ⚠️ MATCHED ON THE EXACT SOURCE. Every other caller of this function passes
    # its own (`awareness_engine`, `calendar_alert`, `catalyst_alert`,
    # `catalyst_mustknow`, `catalyst_digest`, `indicator_alert_migration`), and
    # `indicator_alert` is both the parameter default and the only value the
    # indicator evaluator sends. A prefix match would have swallowed the
    # migration notice, which is a DIFFERENT event ("the maths changed") that
    # must not be deduped against a fire.
    if source == "indicator_alert":
        from api.services import indicator_alert_service as _ias
        if not _ias.claim_delivery((extra_data or {}).get("alert_id")):
            return _delivery_report(False, {}, {})

    data = {"symbol": sym, "source": source}
    if extra_data:
        data.update(extra_data)

    # The two maps the report is built from. `channels` is handed straight to
    # `add_alert`, which owns two of the three channels and fills its own two
    # entries; nothing here restates what that function reports about them.
    channels: dict[str, str] = {}
    errors: dict[str, str] = {}

    # 1. AlertBell (in-app) — PRIVATE to `user_id`.
    #    …and 3. Discord, which `add_alert` fires itself (see the note below).
    #
    # ⭐ EVERY CALLER OF THIS FUNCTION ALREADY HAS A REAL MEMBER ID — it is the
    # first parameter, and the indicator evaluator, catalyst alerts + must-know,
    # calendar alerts and the awareness engine all pass one. Passing it through
    # is what makes this alert the member's instead of the whole membership's.
    in_app_raised = False
    try:
        add_alert(
            source,
            title,
            message,
            severity="warning",
            data=data,
            user_id=user_id,
            channels=channels,
        )
    except Exception as e:
        in_app_raised = True
        _logger.warning("AlertBell delivery failed: %s", e)
        errors[CHANNEL_IN_APP] = f"{type(e).__name__}: {e}"
    # ⚠️ `setdefault`, NEVER AN ASSIGNMENT. `add_alert` is the authority on the
    # two channels it owns; overwriting its answer here would be a second
    # opinion about a send this layer cannot see. These fill in only what it did
    # not get to.
    #
    # 🔴 AND THE IN-APP DEFAULT IS KEYED ON WHETHER IT **RAISED**, NOT ON
    # WHETHER IT REPORTED. Defaulting a silent-but-successful call to `failed`
    # is a false negative, and it is not a harmless one: with the other two
    # channels skipped it makes `channels_ok` zero, which releases the lease and
    # re-sends on the next cycle. Measured against the existing suites the
    # moment it was written — `test_the_alert_stays_quiet_across_TWELVE_TRUE_
    # cycles` went from one delivery to three. A call that returned normally
    # did not fail; a call that raised did.
    channels.setdefault(CHANNEL_IN_APP,
                        CHANNEL_FAILED if in_app_raised else CHANNEL_OK)
    channels.setdefault(CHANNEL_DISCORD, CHANNEL_SKIPPED)

    # 2. Email
    try:
        email = _get_user_email(user_id)
        if not email:
            # No address on file. Nothing was attempted and nothing failed.
            channels[CHANNEL_EMAIL] = CHANNEL_SKIPPED
        else:
            html = _wrap_html(f"""
                <h2 style="color:#c9a84c;font-size:16px;margin:0 0 16px;">{title}</h2>
                <p style="color:#e8e0d0;font-size:14px;margin:0 0 16px;">{message}</p>
                <p style="color:#6b6a60;font-size:12px;margin:0;">
                    Manage your alerts from the chart toolbar.
                </p>
            """)
            # ⭐ `send_email` HAS RETURNED A BOOL SINCE IT WAS WRITTEN, and this
            # call site threw it away. Resend not configured, a 10s timeout and
            # a 429 all return False there and all read as a sent email here.
            ok = send_email(email, f"UCT Alert: {title}", html)
            channels[CHANNEL_EMAIL] = CHANNEL_OK if ok else CHANNEL_FAILED
            if not ok:
                errors[CHANNEL_EMAIL] = "send_email reported failure (see email log)"
    except Exception as e:
        _logger.warning("Email delivery failed: %s", e)
        channels[CHANNEL_EMAIL] = CHANNEL_FAILED
        errors[CHANNEL_EMAIL] = f"{type(e).__name__}: {e}"

    # 3. Discord — ALREADY FIRED, by `add_alert` in step 1, WHICH IS ALSO WHERE
    #    ITS OUTCOME COMES FROM (`channels["discord"]`, filled by that function).
    #
    # ⛔ DO NOT RE-ADD AN EXPLICIT `_fire_discord` HERE. Step 1 passes
    # severity="warning", which is exactly the severity `add_alert` fires the
    # webhook on, so the explicit call that used to sit here posted a SECOND,
    # near-identical embed for every delivered alert (same title, same message,
    # same footer — only the footer timestamp's timezone differed). Removing it
    # loses no information from the admin channel and halves its volume.
    #
    # ⛔ AND DO NOT "FIX" THE REPORTING BY POSTING ONE HERE TO SEE THE RESULT.
    # That is the double-post again, wearing the words of this task.
    return _delivery_report(True, channels, errors)


def run_alert_check(price_data: dict):
    """Run the alert check + delivery OFF the caller's thread. Skips if already checking.

    This is called from the /api/live-prices poll (an anyio threadpool worker). The
    work — an auth.db scan, then per-fire email (Resend) + Discord + DB writes — used
    to run INLINE despite this docstring, so a slow delivery pinned the poll worker
    (and, under load, starved the shared pool). Now the worker returns immediately and
    a daemon thread does the delivery; the non-blocking lock still prevents pileup.
    """
    if not price_data:
        return
    if not _check_lock.acquire(blocking=False):
        return

    def _work():
        try:
            prices_flat = {sym: info["price"] if isinstance(info, dict) else info for sym, info in price_data.items()}
            reports: list[dict] = []
            triggered = check_alerts_against_prices(prices_flat, reports=reports)
            if triggered:
                # 🔴 THE ONLY PLACE THIS LANE EVER SAYS ANYTHING, so it may not
                # say "triggered" and mean "delivered". A fire that reached
                # nobody is not retried here — the row is already deactivated —
                # so this line is the whole audit trail and it names the
                # channels that failed instead of counting to N and stopping.
                _logger.info("Triggered %d price alert(s)", len(triggered))
                bad = [r for r in reports if r["channels_failed"]]
                if bad:
                    _logger.warning(
                        "PRICE ALERT DELIVERY INCOMPLETE: %d of %d fire(s) missed "
                        "a channel and will NOT be retried — %s",
                        len(bad), len(reports),
                        [r["errors"] or r["channels"] for r in bad],
                    )
        except Exception as e:
            _logger.warning("Alert check failed: %s", e)
        finally:
            _check_lock.release()

    threading.Thread(target=_work, daemon=True, name="alert-check").start()
