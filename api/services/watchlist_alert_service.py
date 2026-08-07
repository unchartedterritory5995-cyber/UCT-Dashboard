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
from api.services.alerts import add_alert
from api.services.email_service import send_email, _wrap_html

_logger = logging.getLogger(__name__)
_check_lock = threading.Lock()


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


def check_alerts_against_prices(price_data: dict) -> list[dict]:
    """Check all active alerts against current prices. Returns triggered alerts."""
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
                _deliver_alert(triggered_alert, current_price)

    return triggered


def _deliver_alert(alert: dict, current_price: float):
    """Multi-channel delivery: AlertBell + Email + Discord."""
    sym = alert["sym"]
    direction = alert["direction"]
    target = alert["target_price"]
    msg = f"{sym} {'crossed above' if direction == 'above' else 'dropped below'} ${target:.2f} (now ${current_price:.2f})"

    # 1. AlertBell (in-app) — PRIVATE to the member who set the alert.
    # `user_id` is what keeps this out of the broadcast feed every other member
    # reads. Without it a price alert is visible to the whole membership.
    try:
        add_alert(
            "price_alert",
            f"Alert: {sym} ${current_price:.2f}",
            msg,
            severity="warning",
            data={"symbol": sym, "target_price": target, "current_price": current_price, "direction": direction},
            user_id=alert["user_id"],
        )
    except Exception as e:
        _logger.warning("AlertBell delivery failed: %s", e)

    # 2. Email
    try:
        email = _get_user_email(alert["user_id"])
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
            send_email(email, f"UCT Alert: {sym} hit ${target:.2f}", html)
    except Exception as e:
        _logger.warning("Email delivery failed: %s", e)

    # 3. Discord — ALREADY FIRED, by `add_alert` in step 1.
    #
    # ⛔ DO NOT RE-ADD AN EXPLICIT `_fire_discord` HERE. `add_alert` posts to the
    # webhook itself for severity warning/critical, and step 1 passes
    # severity="warning" — so the explicit second call that used to sit here put
    # every single triggered alert into the admin channel TWICE (verified on
    # production 2026-08-06). `add_alert` is the single owner of the webhook;
    # `tests/test_alerts_privacy.py` counts real `requests.post` calls and fails
    # at two.


def deliver_alert_payload(
    user_id: str,
    sym: str,
    title: str,
    message: str,
    source: str = "indicator_alert",
    extra_data: dict | None = None,
) -> None:
    """Public delivery hook reusable by other alert systems (e.g. indicator alerts).

    Mirrors the multi-channel delivery in ``_deliver_alert`` but accepts a
    generic title/message instead of price-alert specifics. Each channel is
    isolated in its own try/except so a single failure does not block the
    others. Safe to call from a background thread (no Flask/FastAPI context
    is required).
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
            return

    data = {"symbol": sym, "source": source}
    if extra_data:
        data.update(extra_data)

    # 1. AlertBell (in-app) — PRIVATE to `user_id`.
    #
    # ⭐ EVERY CALLER OF THIS FUNCTION ALREADY HAS A REAL MEMBER ID — it is the
    # first parameter, and the indicator evaluator, catalyst alerts + must-know,
    # calendar alerts and the awareness engine all pass one. Passing it through
    # is what makes this alert the member's instead of the whole membership's.
    try:
        add_alert(
            source,
            title,
            message,
            severity="warning",
            data=data,
            user_id=user_id,
        )
    except Exception as e:
        _logger.warning("AlertBell delivery failed: %s", e)

    # 2. Email
    try:
        email = _get_user_email(user_id)
        if email:
            html = _wrap_html(f"""
                <h2 style="color:#c9a84c;font-size:16px;margin:0 0 16px;">{title}</h2>
                <p style="color:#e8e0d0;font-size:14px;margin:0 0 16px;">{message}</p>
                <p style="color:#6b6a60;font-size:12px;margin:0;">
                    Manage your alerts from the chart toolbar.
                </p>
            """)
            send_email(email, f"UCT Alert: {title}", html)
    except Exception as e:
        _logger.warning("Email delivery failed: %s", e)

    # 3. Discord — ALREADY FIRED, by `add_alert` in step 1.
    #
    # ⛔ DO NOT RE-ADD AN EXPLICIT `_fire_discord` HERE. Step 1 passes
    # severity="warning", which is exactly the severity `add_alert` fires the
    # webhook on, so the explicit call that used to sit here posted a SECOND,
    # near-identical embed for every delivered alert (same title, same message,
    # same footer — only the footer timestamp's timezone differed). Removing it
    # loses no information from the admin channel and halves its volume.


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
            triggered = check_alerts_against_prices(prices_flat)
            if triggered:
                _logger.info("Triggered %d price alert(s)", len(triggered))
        except Exception as e:
            _logger.warning("Alert check failed: %s", e)
        finally:
            _check_lock.release()

    threading.Thread(target=_work, daemon=True, name="alert-check").start()
