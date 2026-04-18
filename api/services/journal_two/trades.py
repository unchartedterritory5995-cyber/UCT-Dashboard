"""
Journal 2.0 — trades service.

Closing a Position (fully or partially) is the primary write path into
j2_trades. Manual add-trade and CSV import arrive in Phases 5/7.

CRITICAL INVARIANT (spec §10, §18):
  Trade.originalStop is copied from Position.stopPrice — NEVER from
  Position.breakevenStop. R-multiples must reflect original risk even
  when the user has raised the stop to breakeven mid-trade.

Transaction semantics (spec §4, §10):
  close_position writes the Trade row AND decrements/archives the
  Position inside a single SQLite transaction. If either write fails,
  both roll back.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import calculations as calc
from api.services.journal_two.positions import _row_to_position


class CloseValidationError(ValueError):
    """Raised when close payload fails §10 validation."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _validate_close_payload(position: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    """Validate + normalize a close payload against the live Position.
    Returns (shares, exit_price, exit_date, notes) tuple as a dict."""
    shares_to_close = payload.get("shares")
    exit_price = payload.get("exitPrice")
    exit_date = payload.get("exitDate")
    notes = payload.get("notes")

    if not isinstance(shares_to_close, (int, float)) or shares_to_close <= 0:
        raise CloseValidationError("shares must be > 0")
    if shares_to_close > position["shares"] + 1e-9:
        raise CloseValidationError(
            f"shares to close ({shares_to_close}) exceeds remaining ({position['shares']})"
        )
    if not isinstance(exit_price, (int, float)) or exit_price <= 0:
        raise CloseValidationError("exitPrice must be > 0")
    if not isinstance(exit_date, str) or not exit_date:
        raise CloseValidationError("exitDate is required")

    # Accept both 'YYYY-MM-DD' and full ISO; normalize to ISO-UTC midnight
    # when only a date was provided.
    try:
        if "T" in exit_date:
            exit_dt = datetime.fromisoformat(exit_date.replace("Z", "+00:00"))
        else:
            exit_dt = datetime.fromisoformat(exit_date + "T00:00:00+00:00")
    except ValueError as e:
        raise CloseValidationError(f"exitDate invalid: {e}")

    try:
        entry_dt = datetime.fromisoformat(position["entryDate"].replace("Z", "+00:00"))
    except ValueError as e:
        raise CloseValidationError(f"entryDate on position is invalid: {e}")

    if exit_dt.astimezone(timezone.utc) < entry_dt.astimezone(timezone.utc):
        raise CloseValidationError("exitDate cannot be before entryDate")

    return {
        "shares": float(shares_to_close),
        "exit_price": float(exit_price),
        "exit_date": exit_dt.astimezone(timezone.utc).isoformat(),
        "notes": notes if isinstance(notes, str) else None,
    }


def close_position(
    user_id: str,
    position_id: str,
    payload: dict[str, Any],
    settings: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Atomically: write Trade row, decrement Position.shares, archive
    when shares reach 0. Returns {trade, position}.

    `settings` is the user's current settings at close time — used for
    `breakevenRange` to classify the Trade's result.
    """
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        # Fetch Position (with user scoping)
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
        if row is None:
            raise LookupError(f"position {position_id} not found for user")
        position = _row_to_position(row)
        if position["closedAt"] is not None:
            raise CloseValidationError("position already closed")

        normalized = _validate_close_payload(position, payload)

        # Compute derived Trade fields via the shared calc mirror.
        # §10/§18: originalStop MUST come from stopPrice, not breakevenStop.
        derived = calc.compute_trade_derived(
            side=position["side"],
            shares=normalized["shares"],
            entry_price=position["entryPrice"],
            entry_date=position["entryDate"],
            exit_price=normalized["exit_price"],
            exit_date=normalized["exit_date"],
            original_stop=position["stopPrice"],  # ← NEVER breakevenStop
            breakeven_range=settings["breakevenRange"],
        )

        now = _now_iso()
        trade_id = str(uuid.uuid4())

        # Begin explicit transaction — both writes succeed or both roll back.
        conn.execute("BEGIN")
        try:
            conn.execute(
                """
                INSERT INTO j2_trades (
                    id, user_id, position_id, symbol, side, shares,
                    entry_price, entry_date, exit_price, exit_date,
                    original_stop, setup, notes, pnl_dollar, pnl_percent,
                    r_multiple, hold_days, result, context_at_entry, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    trade_id,
                    user_id,
                    position["id"],
                    position["symbol"],
                    position["side"],
                    normalized["shares"],
                    position["entryPrice"],
                    position["entryDate"],
                    normalized["exit_price"],
                    normalized["exit_date"],
                    position["stopPrice"],  # originalStop
                    position["setup"],
                    normalized["notes"],
                    derived["pnl_dollar"],
                    derived["pnl_percent"],
                    derived["r_multiple"],
                    derived["hold_days"],
                    derived["result"],
                    json.dumps(position["contextAtEntry"]),
                    now,
                ),
            )

            new_shares = float(position["shares"]) - normalized["shares"]
            # 4dp precision — match storage convention
            new_shares = round(new_shares * 10000) / 10000
            closed_at = now if abs(new_shares) < 1e-9 else None

            conn.execute(
                """
                UPDATE j2_positions
                   SET shares = ?, updated_at = ?, closed_at = ?
                 WHERE id = ? AND user_id = ?
                """,
                (
                    0.0 if closed_at else new_shares,
                    now,
                    closed_at,
                    position["id"],
                    user_id,
                ),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

        # Read back the updated Position for the response
        updated_row = conn.execute(
            """
            SELECT id, user_id, symbol, side, entry_date, shares, original_shares,
                   entry_price, stop_price, breakeven_stop, raise_to_breakeven,
                   setup, notes, context_at_entry, created_at, updated_at, closed_at
              FROM j2_positions
             WHERE id = ? AND user_id = ?
            """,
            (position["id"], user_id),
        ).fetchone()

        return {
            "trade": {
                "id": trade_id,
                "userId": user_id,
                "positionId": position["id"],
                "symbol": position["symbol"],
                "side": position["side"],
                "shares": normalized["shares"],
                "entryPrice": position["entryPrice"],
                "entryDate": position["entryDate"],
                "exitPrice": normalized["exit_price"],
                "exitDate": normalized["exit_date"],
                "originalStop": position["stopPrice"],
                "setup": position["setup"],
                "notes": normalized["notes"],
                "pnlDollar": derived["pnl_dollar"],
                "pnlPercent": derived["pnl_percent"],
                "rMultiple": derived["r_multiple"],
                "holdDays": derived["hold_days"],
                "result": derived["result"],
                "contextAtEntry": position["contextAtEntry"],
                "createdAt": now,
            },
            "position": _row_to_position(updated_row),
        }
    finally:
        if owned_conn:
            conn.close()


def _row_to_trade(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "positionId": row["position_id"],
        "symbol": row["symbol"],
        "side": row["side"],
        "shares": float(row["shares"]),
        "entryPrice": float(row["entry_price"]),
        "entryDate": row["entry_date"],
        "exitPrice": float(row["exit_price"]),
        "exitDate": row["exit_date"],
        "originalStop": float(row["original_stop"]),
        "setup": row["setup"],
        "notes": row["notes"],
        "pnlDollar": float(row["pnl_dollar"]),
        "pnlPercent": float(row["pnl_percent"]),
        "rMultiple": None if row["r_multiple"] is None else float(row["r_multiple"]),
        "holdDays": int(row["hold_days"]),
        "result": row["result"],
        "contextAtEntry": json.loads(row["context_at_entry"]),
        "createdAt": row["created_at"],
    }


def list_trades_for_user(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """All trades for a user, newest-entry first. Filtering comes in Phase 6."""
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT id, user_id, position_id, symbol, side, shares,
                   entry_price, entry_date, exit_price, exit_date,
                   original_stop, setup, notes, pnl_dollar, pnl_percent,
                   r_multiple, hold_days, result, context_at_entry, created_at
              FROM j2_trades
             WHERE user_id = ?
             ORDER BY entry_date DESC, created_at DESC
            """,
            (user_id,),
        ).fetchall()
        return [_row_to_trade(r) for r in rows]
    finally:
        if owned_conn:
            conn.close()
