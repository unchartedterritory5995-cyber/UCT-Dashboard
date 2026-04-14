"""
Watchlist alert service — per-symbol price alerts with multi-channel delivery.
Alerts are checked against live prices on each polling cycle.
"""

import uuid
import logging
import threading
from datetime import datetime, timezone

from api.services.auth_db import get_connection
from api.services.alerts import add_alert
from api.services.email_service import send_email, _wrap_html

_logger = logging.getLogger(__name__)
_check_lock = threading.Lock()


def create_alert(user_id: str, sym: str, target_price: float, direction: str) -> dict:
    conn = get_connection()
    try:
        alert_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO watchlist_alerts (id, user_id, sym, target_price, direction, is_active, created_at) VALUES (?,?,?,?,?,?,?)",
            (alert_id, user_id, sym.upper(), target_price, direction, 1, now),
        )
        conn.commit()
        return {"id": alert_id, "user_id": user_id, "sym": sym.upper(),
                "target_price": target_price, "direction": direction,
                "is_active": 1, "created_at": now}
    finally:
        conn.close()


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

    triggered = []
    for row in active:
        alert = dict(row)
        sym = alert["sym"]
        if sym not in price_data:
            continue
        current_price = price_data[sym]
        target = alert["target_price"]
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

    # 1. AlertBell (in-app)
    try:
        add_alert(
            "price_alert",
            f"Alert: {sym} ${current_price:.2f}",
            msg,
            severity="warning",
            data={"symbol": sym, "target_price": target, "current_price": current_price, "direction": direction},
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

    # 3. Discord
    try:
        from api.services.alerts import _fire_discord
        _fire_discord({
            "type": "price_alert",
            "severity": "warning",
            "title": f"Price Alert: {sym}",
            "message": msg,
            "timestamp": datetime.now(timezone.utc).isoformat()[:16],
        })
    except Exception as e:
        _logger.warning("Discord delivery failed: %s", e)


def run_alert_check(price_data: dict):
    """Run alert check in background thread. Skips if already checking."""
    if not price_data:
        return
    if not _check_lock.acquire(blocking=False):
        return
    try:
        prices_flat = {sym: info["price"] if isinstance(info, dict) else info for sym, info in price_data.items()}
        triggered = check_alerts_against_prices(prices_flat)
        if triggered:
            _logger.info("Triggered %d price alert(s)", len(triggered))
    except Exception as e:
        _logger.warning("Alert check failed: %s", e)
    finally:
        _check_lock.release()
