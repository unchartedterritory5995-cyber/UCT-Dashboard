"""
Journal 2.0 — session-discipline state computation (Phase B).

Computes whether a single account is currently locked from new trades,
and the human-readable reasons. Pure read; never mutates DB rows.

Three guard types:
  - daily_loss:        today's realized P&L (sum of j2_trades closed today, ET)
                       breached -X% of accountSize.
  - cooling_off:       most-recent losing trade's exit was within N minutes of `now`.
  - no_trade_window:   `now` (in ET) falls within any user-defined HH:MM window.

Caller passes `now` for testability; defaults to `datetime.now(timezone.utc)`.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from api.services.auth_db import get_connection
from api.services.journal_two import accounts as accounts_service


ET = ZoneInfo("America/New_York")


def compute_discipline_state(
    user_id: str,
    account_id: str,
    *,
    conn: sqlite3.Connection | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return locked/reasons/today's-pnl state for one account.

    `now` may be a UTC or ET-aware datetime; both are normalized internally.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        settings = accounts_service.get_account_settings(user_id, account_id, conn=conn)
        if settings is None:
            return _empty_state(now or datetime.now(timezone.utc))

        now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        now_et = now_utc.astimezone(ET)

        today_pnl = _todays_pnl(conn, user_id, account_id, now_et)
        account_size = float(settings.get("accountSize") or 0)
        today_pnl_pct = (today_pnl / account_size * 100.0) if account_size > 0 else 0.0

        reasons: list[dict[str, Any]] = []

        # 1) Daily loss limit
        cap = settings.get("dailyLossLimitPct")
        if cap is not None and account_size > 0 and today_pnl_pct <= -float(cap):
            reasons.append({
                "type": "daily_loss",
                "message": f"Down {today_pnl_pct:.2f}% today (limit: -{cap}%)",
                "severity": "block",
            })

        # 2) Cooling off
        cool_min = settings.get("coolingOffMinutesAfterLoss")
        if cool_min is not None and cool_min > 0:
            last_loss_at = _last_loss_exit(conn, user_id, account_id)
            if last_loss_at is not None:
                unlock_at = last_loss_at + timedelta(minutes=int(cool_min))
                if now_utc < unlock_at:
                    reasons.append({
                        "type": "cooling_off",
                        "message": f"Cooling off after loss ({cool_min} min)",
                        "unlockAt": unlock_at.isoformat(),
                        "severity": "block",
                    })

        # 3) No-trade windows (ET, no overnight in v1)
        windows = settings.get("noTradeWindowsET") or []
        for w in windows:
            try:
                start_dt, end_dt = _window_bounds_today(now_et, w["start"], w["end"])
            except (KeyError, ValueError):
                continue  # malformed window — skip silently rather than crash state
            if start_dt <= now_et < end_dt:
                reasons.append({
                    "type": "no_trade_window",
                    "message": w.get("label") or f"No-trade window {w['start']}-{w['end']} ET",
                    "unlockAt": end_dt.astimezone(timezone.utc).isoformat(),
                    "severity": "block",
                })

        return {
            "locked": len(reasons) > 0,
            "reasons": reasons,
            "todaysPnlDollar": round(today_pnl, 2),
            "todaysPnlPct": round(today_pnl_pct, 2),
            "computedAt": now_utc.isoformat(),
        }
    finally:
        if owned:
            conn.close()


def _empty_state(now: datetime) -> dict[str, Any]:
    now_utc = now.astimezone(timezone.utc) if now.tzinfo else now.replace(tzinfo=timezone.utc)
    return {
        "locked": False,
        "reasons": [],
        "todaysPnlDollar": 0,
        "todaysPnlPct": 0,
        "computedAt": now_utc.isoformat(),
    }


def _todays_pnl(
    conn: sqlite3.Connection,
    user_id: str,
    account_id: str,
    now_et: datetime,
) -> float:
    """Sum pnl_dollar for trades whose exit_date (ISO timestamp) falls on the
    current ET calendar day. We can't filter in SQL by ET date directly,
    so we widen by ±1 day in UTC ISO strings and bucket precisely in Python."""
    today_et_date = now_et.date()
    day_start_et = datetime.combine(today_et_date, datetime.min.time(), tzinfo=ET)
    day_end_et = day_start_et + timedelta(days=1)
    day_start_utc = day_start_et.astimezone(timezone.utc).isoformat()
    day_end_utc = day_end_et.astimezone(timezone.utc).isoformat()

    rows = conn.execute(
        """
        SELECT pnl_dollar FROM j2_trades
         WHERE user_id = ? AND account_id = ?
           AND exit_date >= ? AND exit_date < ?
        """,
        (user_id, account_id, day_start_utc, day_end_utc),
    ).fetchall()
    return sum(float(r["pnl_dollar"] or 0) for r in rows)


def _last_loss_exit(
    conn: sqlite3.Connection,
    user_id: str,
    account_id: str,
) -> datetime | None:
    """Return the most-recent losing trade's exit timestamp as a UTC datetime,
    or None if no losing trades exist."""
    row = conn.execute(
        """
        SELECT exit_date FROM j2_trades
         WHERE user_id = ? AND account_id = ? AND result = 'Loss'
         ORDER BY exit_date DESC LIMIT 1
        """,
        (user_id, account_id),
    ).fetchone()
    if row is None or not row["exit_date"]:
        return None
    try:
        dt = datetime.fromisoformat(str(row["exit_date"]).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _window_bounds_today(
    now_et: datetime,
    start_hhmm: str,
    end_hhmm: str,
) -> tuple[datetime, datetime]:
    """Build today's start/end datetimes in ET for an HH:MM window."""
    sh, sm = (int(x) for x in start_hhmm.split(":"))
    eh, em = (int(x) for x in end_hhmm.split(":"))
    today = now_et.date()
    start = datetime(today.year, today.month, today.day, sh, sm, tzinfo=ET)
    end = datetime(today.year, today.month, today.day, eh, em, tzinfo=ET)
    return start, end
