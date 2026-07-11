"""
Journal 2.0 — streak & stale-position nudges (Phase F).

Three ambient (non-blocking) signals rendered in the J2 header:

  - lossStreakCount: consecutive 'Loss' trades whose exit_date is today (ET).
                     Resets across day boundaries. Used to recommend a break.

  - winStreakCount:  consecutive 'Win' trades across the entire history
                     (no day restriction). Used to caution against euphoria.

  - staleCount:      open positions whose entry_date is older than
                     `staleHoldDaysThreshold` days AND have no notes.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from api.services.auth_db import get_connection
from api.services.journal_two import accounts as accounts_service


ET = ZoneInfo("America/New_York")

DEFAULT_LOSS_STREAK = 3
DEFAULT_WIN_STREAK = 5
DEFAULT_STALE_DAYS = 30


def get_nudges_state(
    user_id: str,
    account_id: str,
    *,
    conn: sqlite3.Connection | None = None,
    now: datetime | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    """Return streak counts + stale-position count + resolved thresholds.

    `limit` caps the newest-first closed-trade scan (ORDER BY exit_date DESC).
    Default None = unbounded (the header nudge / router behavior). A bounded read
    (e.g. 60) is used by the celebration hot-path in `overview.get_overview`,
    where only the newest rows until a streak breaks are needed — a win/loss
    streak longer than the cap is implausible, so it simply caps there.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        settings = accounts_service.get_account_settings(user_id, account_id, conn=conn)
        loss_threshold = (settings or {}).get("lossStreakThreshold") or DEFAULT_LOSS_STREAK
        win_threshold = (settings or {}).get("winStreakThreshold") or DEFAULT_WIN_STREAK
        stale_days = (settings or {}).get("staleHoldDaysThreshold") or DEFAULT_STALE_DAYS

        now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        now_et = now_utc.astimezone(ET)
        today_et_date = now_et.date()

        streak_sql = (
            "SELECT result, exit_date FROM j2_trades "
            " WHERE user_id = ? AND account_id = ? "
            " ORDER BY exit_date DESC"
        )
        streak_params: list[Any] = [user_id, account_id]
        if limit is not None:
            streak_sql += " LIMIT ?"
            streak_params.append(int(limit))
        rows = conn.execute(streak_sql, streak_params).fetchall()

        loss_streak = 0
        win_streak = 0

        # Walk from latest backward. Loss streak only counts today's losses
        # contiguous with the most recent trade; stops at first non-Loss.
        for r in rows:
            if r["result"] != "Loss":
                break
            exit_date_et = _parse_et_date(r["exit_date"])
            if exit_date_et != today_et_date:
                break
            loss_streak += 1

        # Win streak counts consecutive Wins from latest backward, any date.
        for r in rows:
            if r["result"] != "Win":
                break
            win_streak += 1

        # Stale positions: open + entry_date older than stale_days + no notes.
        cutoff_utc = (now_utc - timedelta(days=int(stale_days))).isoformat()
        stale_row = conn.execute(
            """
            SELECT COUNT(*) AS n FROM j2_positions
             WHERE user_id = ? AND account_id = ? AND closed_at IS NULL
               AND entry_date < ?
               AND (notes IS NULL OR notes = '')
            """,
            (user_id, account_id, cutoff_utc),
        ).fetchone()
        stale_count = int((stale_row or {"n": 0})["n"])

        return {
            "lossStreakCount": loss_streak,
            "winStreakCount": win_streak,
            "staleCount": stale_count,
            "thresholds": {
                "loss": int(loss_threshold),
                "win": int(win_threshold),
                "staleDays": int(stale_days),
            },
        }
    finally:
        if owned:
            conn.close()


def _parse_et_date(iso_str):
    """Parse an ISO timestamp string and return its ET calendar date.
    Returns None on parse failure."""
    if not iso_str:
        return None
    try:
        dt = datetime.fromisoformat(str(iso_str).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(ET).date()
