"""
Daily Journal service — CRUD for per-day structured journal entries.
Get-or-create pattern: auto-creates on first access for a date.
"""

import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection


def get_or_create_daily(user_id: str, date: str) -> dict:
    """Get daily journal for date, creating if it doesn't exist."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM daily_journals WHERE user_id = ? AND date = ?",
            (user_id, date),
        ).fetchone()
        if row:
            result = dict(row)
            result["trades"] = _get_trades_for_date(conn, user_id, date)
            return result

        # Auto-create
        dj_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """INSERT INTO daily_journals (id, user_id, date, created_at, updated_at)
               VALUES (?,?,?,?,?)""",
            (dj_id, user_id, date, now, now),
        )
        conn.commit()
        result = dict(conn.execute(
            "SELECT * FROM daily_journals WHERE id = ?", (dj_id,)
        ).fetchone())
        result["trades"] = _get_trades_for_date(conn, user_id, date)
        return result
    finally:
        conn.close()


def update_daily(user_id: str, date: str, data: dict) -> dict | None:
    """Update daily journal fields. Returns updated record."""
    _DAILY_FIELDS = {
        "premarket_thesis", "focus_list", "a_plus_setups", "risk_plan",
        "market_regime", "emotional_state", "midday_notes", "eod_recap",
        "did_well", "did_poorly", "learned", "tomorrow_focus",
        "energy_rating", "discipline_score", "review_complete",
    }
    updates = {k: v for k, v in data.items() if k in _DAILY_FIELDS}
    if not updates:
        return get_or_create_daily(user_id, date)

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Auto-compute review_complete if not explicitly set
    if "review_complete" not in updates:
        merged = {**get_or_create_daily(user_id, date), **updates}
        has_premarket = bool(merged.get("premarket_thesis"))
        has_eod = bool(merged.get("eod_recap"))
        has_learned = bool(merged.get("learned"))
        updates["review_complete"] = 1 if (has_premarket and has_eod and has_learned) else 0

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [user_id, date]

    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE daily_journals SET {set_clause} WHERE user_id = ? AND date = ?",
            values,
        )
        conn.commit()
        return get_or_create_daily(user_id, date)
    finally:
        conn.close()


def list_daily_journals(user_id: str, date_from: str = None, date_to: str = None) -> list[dict]:
    """List daily journals with completion status (for the left sidebar date list)."""
    conn = get_connection()
    try:
        where = "user_id = ?"
        params = [user_id]
        if date_from:
            where += " AND date >= ?"
            params.append(date_from)
        if date_to:
            where += " AND date <= ?"
            params.append(date_to)

        rows = conn.execute(
            f"""SELECT id, date, review_complete,
                       CASE WHEN premarket_thesis != '' OR eod_recap != '' THEN 1 ELSE 0 END as has_content
                FROM daily_journals WHERE {where} ORDER BY date DESC""",
            params,
        ).fetchall()

        # Also find dates with trades but no journal
        trade_params = [user_id]
        trade_where = "user_id = ? AND entry_date IS NOT NULL AND entry_date != ''"
        if date_from:
            trade_where += " AND entry_date >= ?"
            trade_params.append(date_from)
        if date_to:
            trade_where += " AND entry_date <= ?"
            trade_params.append(date_to)

        trade_dates = conn.execute(
            f"SELECT DISTINCT entry_date FROM journal_entries WHERE {trade_where} ORDER BY entry_date DESC",
            trade_params,
        ).fetchall()

        journal_dates = {r["date"] for r in rows}
        result = [dict(r) for r in rows]
        for td in trade_dates:
            if td["entry_date"] not in journal_dates:
                result.append({
                    "date": td["entry_date"],
                    "review_complete": 0,
                    "has_content": 0,
                    "has_journal": False,
                })

        result.sort(key=lambda x: x["date"], reverse=True)
        return result
    finally:
        conn.close()


def _get_trades_for_date(conn, user_id: str, date: str) -> list[dict]:
    """Get mini trade list for a date (used in daily journal view)."""
    rows = conn.execute(
        """SELECT id, sym, direction, pnl_pct, pnl_dollar, review_status, setup, status
           FROM journal_entries WHERE user_id = ? AND entry_date = ?
           ORDER BY entry_time, created_at""",
        (user_id, date),
    ).fetchall()
    return [dict(r) for r in rows]
