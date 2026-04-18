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
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """All CLOSED trades from users with shareJournalData=true,
    stripped of portfolio-size-revealing fields, newest first."""
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        # Pull users, settings (to filter by opt-in), and trades in one query.
        # SQLite's json_extract lets us check the boolean inside the settings
        # JSON blob without reading every settings row into Python.
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
                "trader": _display_name(r),
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
