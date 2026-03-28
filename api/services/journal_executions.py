"""
Trade execution service — scale-in/out tracking with VWAP computation.
"""

import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection


def list_executions(user_id: str, trade_id: str) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM trade_executions
               WHERE user_id = ? AND trade_id = ?
               ORDER BY sort_order, exec_date, exec_time""",
            (user_id, trade_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def create_execution(user_id: str, trade_id: str, data: dict) -> dict:
    exec_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    conn = get_connection()
    try:
        # Verify trade belongs to user
        trade = conn.execute(
            "SELECT id FROM journal_entries WHERE id = ? AND user_id = ?",
            (trade_id, user_id),
        ).fetchone()
        if not trade:
            return None

        # Validate price and shares
        price = float(data.get("price", 0))
        shares = float(data.get("shares", 0))
        if price <= 0 or shares == 0:
            return None

        conn.execute(
            """INSERT INTO trade_executions
               (id, user_id, trade_id, exec_type, exec_date, exec_time, price, shares, fees, notes, sort_order, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                exec_id, user_id, trade_id,
                data.get("exec_type", "entry"),
                data.get("exec_date", ""),
                data.get("exec_time"),
                float(data.get("price", 0)),
                float(data.get("shares", 0)),
                float(data.get("fees", 0)),
                (data.get("notes") or "")[:1000],
                int(data.get("sort_order", 0)),
                now,
            ),
        )
        conn.commit()

        # Recompute parent trade VWAP
        _recompute_trade_from_executions(conn, user_id, trade_id)

        row = conn.execute("SELECT * FROM trade_executions WHERE id = ?", (exec_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def delete_execution(user_id: str, trade_id: str, exec_id: str) -> bool:
    conn = get_connection()
    try:
        result = conn.execute(
            "DELETE FROM trade_executions WHERE id = ? AND user_id = ? AND trade_id = ?",
            (exec_id, user_id, trade_id),
        )
        conn.commit()
        if result.rowcount > 0:
            _recompute_trade_from_executions(conn, user_id, trade_id)
            return True
        return False
    finally:
        conn.close()


def _recompute_trade_from_executions(conn, user_id: str, trade_id: str):
    """Recompute parent trade entry_price, exit_price, shares, fees from execution legs."""
    rows = conn.execute(
        "SELECT * FROM trade_executions WHERE trade_id = ? AND user_id = ?",
        (trade_id, user_id),
    ).fetchall()
    executions = [dict(r) for r in rows]

    if not executions:
        return  # No executions, leave parent as-is (simple mode)

    entry_types = {"entry", "add"}
    exit_types = {"trim", "exit", "stop"}

    entries = [e for e in executions if e["exec_type"] in entry_types]
    exits = [e for e in executions if e["exec_type"] in exit_types]

    # VWAP entry
    entry_shares = sum(abs(e["shares"]) for e in entries)
    entry_vwap = (
        sum(e["price"] * abs(e["shares"]) for e in entries) / entry_shares
        if entry_shares > 0 else None
    )

    # VWAP exit
    exit_shares = sum(abs(e["shares"]) for e in exits)
    exit_vwap = (
        sum(e["price"] * abs(e["shares"]) for e in exits) / exit_shares
        if exit_shares > 0 else None
    )

    total_fees = sum(e.get("fees", 0) or 0 for e in executions)
    total_shares = entry_shares  # gross shares bought

    updates = {"fees": round(total_fees, 2), "shares": round(total_shares, 4)}
    if entry_vwap:
        updates["entry_price"] = round(entry_vwap, 4)
    if exit_vwap:
        updates["exit_price"] = round(exit_vwap, 4)

    # Earliest entry date/time
    if entries:
        sorted_entries = sorted(entries, key=lambda e: (e["exec_date"], e.get("exec_time") or ""))
        updates["entry_date"] = sorted_entries[0]["exec_date"]
        if sorted_entries[0].get("exec_time"):
            updates["entry_time"] = sorted_entries[0]["exec_time"]

    # Latest exit date/time
    if exits:
        sorted_exits = sorted(exits, key=lambda e: (e["exec_date"], e.get("exec_time") or ""))
        updates["exit_date"] = sorted_exits[-1]["exec_date"]
        if sorted_exits[-1].get("exec_time"):
            updates["exit_time"] = sorted_exits[-1]["exec_time"]

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [trade_id, user_id]
    conn.execute(
        f"UPDATE journal_entries SET {set_clause} WHERE id = ? AND user_id = ?",
        values,
    )
    conn.commit()
