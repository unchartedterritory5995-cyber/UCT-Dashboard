"""
Journal 2.0 — community feed.

Returns CLOSED trades from users who have opted in to sharing
(settings.shareJournalData === true), stripped of account-size-
revealing fields (shares, pnlDollar). Joined with the users table
for trader attribution.

Privacy stance:
  • OPT-IN ONLY — default off in default_settings_data.
  • Stripped fields: shares, pnlDollar. Kept: everything else including
    pnlPercent, rMultiple, holdDays, result, contextAtEntry, setup,
    notes, entry/exit prices and dates. The stripped fields would
    reveal absolute portfolio size; the kept fields are scale-
    independent analytical signal.
  • Attribution: display_name → full_name → email local part. Never
    the raw email.
  • Viewing community trades does NOT require sharing your own —
    encourages lurk-first UX.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from api.services.auth_db import get_connection


def _display_name(row: sqlite3.Row) -> str:
    """Best-available display name without leaking the raw email."""
    for key in ("display_name", "full_name"):
        v = row[key] if key in row.keys() else None
        if v and isinstance(v, str) and v.strip():
            return v.strip()
    # Fall back to email-local-part
    email = row["email"] if "email" in row.keys() else None
    if email and "@" in email:
        return email.split("@", 1)[0]
    return "trader"


def list_shared_trades(
    limit: int = 500,
    current_user_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """All CLOSED trades from users with shareJournalData=true,
    stripped of portfolio-size-revealing fields, newest first.

    Includes `traderId` (stable per-trader identifier for client-side
    grouping into trader profiles) and `isMe` (true when the row belongs
    to the authenticated user) so the Community tab can highlight the
    current user's own card and filter trades by trader in the detail
    view.
    """
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT
                t.id, t.user_id, t.symbol, t.side,
                t.entry_price, t.entry_date, t.exit_price, t.exit_date,
                t.original_stop, t.setup, t.notes,
                t.pnl_percent, t.r_multiple, t.hold_days, t.result,
                t.context_at_entry, t.created_at,
                u.display_name, u.full_name, u.email
              FROM j2_trades t
              JOIN j2_settings s ON s.user_id = t.user_id
              JOIN users u        ON u.id      = t.user_id
             WHERE json_extract(s.data, '$.shareJournalData') = 1
             ORDER BY t.entry_date DESC, t.created_at DESC
             LIMIT ?
            """,
            (limit,),
        ).fetchall()

        out = []
        for r in rows:
            out.append({
                "id": r["id"],
                "traderId": r["user_id"],
                "trader": _display_name(r),
                "isMe": current_user_id is not None and r["user_id"] == current_user_id,
                "symbol": r["symbol"],
                "side": r["side"],
                # shares + pnlDollar INTENTIONALLY OMITTED (reveals portfolio size)
                "entryPrice": float(r["entry_price"]),
                "entryDate": r["entry_date"],
                "exitPrice": float(r["exit_price"]),
                "exitDate": r["exit_date"],
                "originalStop": float(r["original_stop"]),
                "setup": r["setup"],
                "notes": r["notes"],
                "pnlPercent": float(r["pnl_percent"]),
                "rMultiple": None if r["r_multiple"] is None else float(r["r_multiple"]),
                "holdDays": int(r["hold_days"]),
                "result": r["result"],
                "contextAtEntry": json.loads(r["context_at_entry"]),
                "createdAt": r["created_at"],
            })
        return out
    finally:
        if owned_conn:
            conn.close()


def list_trader_summaries(
    current_user_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Aggregated per-trader stats across all opted-in users. Powers the
    Community tab's trader-card grid (scannable overview).

    Privacy: only scale-independent stats (win rate, avg R, PF, %
    returns, hold). No $ amounts. Same principle as list_shared_trades.
    """
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        base_rows = conn.execute(
            """
            SELECT
                u.id          AS user_id,
                u.display_name, u.full_name, u.email,
                COUNT(*)      AS trade_count,
                SUM(CASE WHEN t.result = 'Win'  THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN t.result = 'Loss' THEN 1 ELSE 0 END) AS losses,
                SUM(CASE WHEN t.result = 'BE'   THEN 1 ELSE 0 END) AS bes,
                AVG(t.r_multiple) AS avg_r,
                AVG(t.pnl_percent) AS avg_pnl_pct,
                AVG(t.hold_days)   AS avg_hold,
                MIN(t.entry_date)  AS first_trade,
                MAX(t.entry_date)  AS last_trade,
                SUM(CASE WHEN t.result = 'Win'  THEN t.pnl_percent ELSE 0 END) AS win_sum,
                SUM(CASE WHEN t.result = 'Loss' THEN t.pnl_percent ELSE 0 END) AS loss_sum
              FROM j2_trades t
              JOIN j2_settings s ON s.user_id = t.user_id
              JOIN users u        ON u.id      = t.user_id
             WHERE json_extract(s.data, '$.shareJournalData') = 1
             GROUP BY u.id
            """
        ).fetchall()

        out = []
        for r in base_rows:
            wins = int(r["wins"] or 0)
            losses = int(r["losses"] or 0)
            bes = int(r["bes"] or 0)
            trade_count = int(r["trade_count"] or 0)

            # Win rate: BE excluded from denom (matches spec §14.6)
            win_rate = (
                wins / (wins + losses) * 100 if wins + losses > 0 else None
            )

            # Profit factor on pnl_percent (scale-independent). Null denom
            # with wins > 0 → infinity; null wins → 0.
            win_sum = float(r["win_sum"] or 0)
            loss_sum = float(r["loss_sum"] or 0)
            if abs(loss_sum) < 1e-9:
                profit_factor = None if wins > 0 else 0.0  # None encodes ∞ in JSON
            else:
                profit_factor = abs(win_sum) / abs(loss_sum)

            out.append({
                "traderId": r["user_id"],
                "trader": _display_name(r),
                "isMe": current_user_id is not None and r["user_id"] == current_user_id,
                "tradeCount": trade_count,
                "wins": wins,
                "losses": losses,
                "bes": bes,
                "winRate": win_rate,
                "avgRMultiple": None if r["avg_r"] is None else float(r["avg_r"]),
                "avgPnlPercent": None if r["avg_pnl_pct"] is None else float(r["avg_pnl_pct"]),
                "avgHoldDays": None if r["avg_hold"] is None else float(r["avg_hold"]),
                "profitFactor": profit_factor,
                "firstTradeDate": r["first_trade"],
                "lastTradeDate": r["last_trade"],
            })

        # Default sort: most active (trade count desc)
        out.sort(key=lambda x: x["tradeCount"], reverse=True)
        return out
    finally:
        if owned_conn:
            conn.close()
