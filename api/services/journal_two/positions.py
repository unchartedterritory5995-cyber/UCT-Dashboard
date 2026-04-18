"""
Journal 2.0 — positions service.

Read-only helpers for Phase 3. Write helpers (create, update, close,
delete) arrive in Phase 4.

Spec §4 (Position shape), §7 (Open Positions tab display rules).
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from api.services.auth_db import get_connection


def _row_to_position(row: sqlite3.Row) -> dict[str, Any]:
    """Map a j2_positions row → the camelCase Position shape from spec §4."""
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "symbol": row["symbol"],
        "side": row["side"],
        "entryDate": row["entry_date"],
        "shares": float(row["shares"]),
        "originalShares": float(row["original_shares"]),
        "entryPrice": float(row["entry_price"]),
        "stopPrice": float(row["stop_price"]),
        "breakevenStop": None if row["breakeven_stop"] is None else float(row["breakeven_stop"]),
        "raiseToBreakeven": bool(row["raise_to_breakeven"]),
        "setup": row["setup"],
        "notes": row["notes"],
        "contextAtEntry": json.loads(row["context_at_entry"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "closedAt": row["closed_at"],
    }


def list_open_positions(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Open positions for a user, sorted by symbol ASC (default sort per §7.2)."""
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, user_id, symbol, side, entry_date, shares, original_shares,
                   entry_price, stop_price, breakeven_stop, raise_to_breakeven,
                   setup, notes, context_at_entry, created_at, updated_at, closed_at
              FROM j2_positions
             WHERE user_id = ? AND closed_at IS NULL
             ORDER BY symbol ASC, entry_date DESC
            """,
            (user_id,),
        ).fetchall()
        return [_row_to_position(r) for r in rows]
    finally:
        if owned_conn:
            conn.close()


def get_position(
    user_id: str,
    position_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Single position by id, scoped to user. None if not found or owned by someone else."""
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            """
            SELECT id, user_id, symbol, side, entry_date, shares, original_shares,
                   entry_price, stop_price, breakeven_stop, raise_to_breakeven,
                   setup, notes, context_at_entry, created_at, updated_at, closed_at
              FROM j2_positions
             WHERE id = ? AND user_id = ?
            """,
            (position_id, user_id),
        ).fetchone()
        return _row_to_position(row) if row else None
    finally:
        if owned_conn:
            conn.close()


def count_open_positions_for_user(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> int:
    """Number of open positions the user currently holds.

    Used by the market-context snapshot (§4 `navCount`): at position-
    creation time, this value is captured BEFORE the new position is
    inserted — so the new position itself is never in its own navCount.
    """
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM j2_positions WHERE user_id = ? AND closed_at IS NULL",
            (user_id,),
        ).fetchone()
        return int(row["n"])
    finally:
        if owned_conn:
            conn.close()
