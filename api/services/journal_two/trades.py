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


# ── Manual Add Trade (spec §11.4 non-close write path) ──────────────────────

class ManualTradeValidationError(ValueError):
    """Raised when a manual Add Trade payload fails validation."""


def _validate_manual_trade_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Spec §11.4 manual Add Trade. Server computes derived via
    compute_trade_derived (A3)."""
    if not isinstance(payload, dict):
        raise ManualTradeValidationError("payload must be an object")

    symbol = payload.get("symbol")
    if not isinstance(symbol, str) or not symbol.strip():
        raise ManualTradeValidationError("symbol is required")

    side = payload.get("side")
    if side not in {"Long", "Short"}:
        raise ManualTradeValidationError("side must be 'Long' or 'Short'")

    shares = payload.get("shares")
    if not isinstance(shares, (int, float)) or shares <= 0:
        raise ManualTradeValidationError("shares must be > 0")

    entry_price = payload.get("entryPrice")
    if not isinstance(entry_price, (int, float)) or entry_price <= 0:
        raise ManualTradeValidationError("entryPrice must be > 0")

    exit_price = payload.get("exitPrice")
    if not isinstance(exit_price, (int, float)) or exit_price <= 0:
        raise ManualTradeValidationError("exitPrice must be > 0")

    entry_date_raw = payload.get("entryDate")
    if not isinstance(entry_date_raw, str) or not entry_date_raw:
        raise ManualTradeValidationError("entryDate is required")
    try:
        entry_dt = (
            datetime.fromisoformat(entry_date_raw.replace("Z", "+00:00"))
            if "T" in entry_date_raw
            else datetime.fromisoformat(entry_date_raw + "T00:00:00+00:00")
        )
    except ValueError as e:
        raise ManualTradeValidationError(f"entryDate invalid: {e}")

    exit_date_raw = payload.get("exitDate")
    if not isinstance(exit_date_raw, str) or not exit_date_raw:
        raise ManualTradeValidationError("exitDate is required")
    try:
        exit_dt = (
            datetime.fromisoformat(exit_date_raw.replace("Z", "+00:00"))
            if "T" in exit_date_raw
            else datetime.fromisoformat(exit_date_raw + "T00:00:00+00:00")
        )
    except ValueError as e:
        raise ManualTradeValidationError(f"exitDate invalid: {e}")

    if exit_dt.astimezone(timezone.utc) < entry_dt.astimezone(timezone.utc):
        raise ManualTradeValidationError("exitDate cannot be before entryDate")

    original_stop = payload.get("originalStop")
    if original_stop is None or original_stop == "":
        # Blank → default to entryPrice, which makes R-multiple null per
        # §14.5 edge case #3. Honest "unknown R" rather than a fake one.
        original_stop = float(entry_price)
    elif not isinstance(original_stop, (int, float)) or original_stop < 0:
        raise ManualTradeValidationError("originalStop must be a non-negative number")
    else:
        original_stop = float(original_stop)
        # Stop-side check only when non-zero (0 means "no stop recorded")
        if original_stop > 0:
            if side == "Long" and original_stop >= entry_price:
                raise ManualTradeValidationError(
                    "originalStop must be below entryPrice for a Long trade"
                )
            if side == "Short" and original_stop <= entry_price:
                raise ManualTradeValidationError(
                    "originalStop must be above entryPrice for a Short trade"
                )

    setup = payload.get("setup")
    notes = payload.get("notes")

    return {
        "symbol": symbol.strip().upper(),
        "side": side,
        "shares": float(shares),
        "entryPrice": float(entry_price),
        "entryDate": entry_dt.astimezone(timezone.utc).isoformat(),
        "exitPrice": float(exit_price),
        "exitDate": exit_dt.astimezone(timezone.utc).isoformat(),
        "originalStop": original_stop,
        "setup": setup.strip() if isinstance(setup, str) and setup.strip() else None,
        "notes": notes if isinstance(notes, str) else None,
    }


def create_trade_manual(
    user_id: str,
    payload: dict[str, Any],
    settings: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Manual Add Trade (spec §11.4). Server computes derived fields via
    compute_trade_derived using the user's current breakevenRange. The
    resulting Trade has positionId = 'manual-{uuid}' since there is no
    parent Position."""
    validated = _validate_manual_trade_payload(payload)

    derived = calc.compute_trade_derived(
        side=validated["side"],
        shares=validated["shares"],
        entry_price=validated["entryPrice"],
        entry_date=validated["entryDate"],
        exit_price=validated["exitPrice"],
        exit_date=validated["exitDate"],
        original_stop=validated["originalStop"],
        breakeven_range=settings["breakevenRange"],
    )

    context: dict[str, Any] = {}

    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        now = _now_iso()
        trade_id = str(uuid.uuid4())
        # A1: sentinel positionId for manual trades. Never matches a real
        # Position row (all real positions are plain UUIDs).
        position_id = f"manual-{uuid.uuid4()}"

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
                position_id,
                validated["symbol"],
                validated["side"],
                validated["shares"],
                validated["entryPrice"],
                validated["entryDate"],
                validated["exitPrice"],
                validated["exitDate"],
                validated["originalStop"],
                validated["setup"],
                validated["notes"],
                derived["pnl_dollar"],
                derived["pnl_percent"],
                derived["r_multiple"],
                derived["hold_days"],
                derived["result"],
                json.dumps(context),
                now,
            ),
        )
        conn.commit()

        return {
            "id": trade_id,
            "userId": user_id,
            "positionId": position_id,
            "symbol": validated["symbol"],
            "side": validated["side"],
            "shares": validated["shares"],
            "entryPrice": validated["entryPrice"],
            "entryDate": validated["entryDate"],
            "exitPrice": validated["exitPrice"],
            "exitDate": validated["exitDate"],
            "originalStop": validated["originalStop"],
            "setup": validated["setup"],
            "notes": validated["notes"],
            "pnlDollar": derived["pnl_dollar"],
            "pnlPercent": derived["pnl_percent"],
            "rMultiple": derived["r_multiple"],
            "holdDays": derived["hold_days"],
            "result": derived["result"],
            "contextAtEntry": context,
            "createdAt": now,
        }
    finally:
        if owned_conn:
            conn.close()


def delete_trade(
    user_id: str,
    trade_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Hard-delete a single Trade. Returns True if deleted."""
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        cursor = conn.execute(
            "DELETE FROM j2_trades WHERE id = ? AND user_id = ?",
            (trade_id, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        if owned_conn:
            conn.close()


def bulk_insert_trades(
    user_id: str,
    parsed_trades: list[dict[str, Any]],
    settings: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Bulk-insert pre-parsed trade dicts (as produced by csv_import).
    All-or-nothing: wraps every insert in a single transaction, rolls
    back on any error.

    Derived fields (pnl_dollar, pnl_percent, r_multiple, hold_days,
    result) computed via compute_trade_derived using the user's current
    breakevenRange at import time (same rule as Close / manual Add).

    Each trade gets a fresh `manual-{uuid}` positionId sentinel — imports
    are trades without a parent Position in j2_positions.
    """
    if not parsed_trades:
        return {"imported": 0, "errors": []}

    owned_conn = conn is None
    conn = conn or get_connection()

    try:
        conn.execute("BEGIN")
        inserted = 0
        try:
            for pt in parsed_trades:
                original_stop = pt.get("originalStop")
                if original_stop is None:
                    # §14.5 edge case #3: entry == originalStop → R null
                    original_stop = pt["entryPrice"]

                derived = calc.compute_trade_derived(
                    side=pt["side"],
                    shares=pt["shares"],
                    entry_price=pt["entryPrice"],
                    entry_date=pt["entryDate"],
                    exit_price=pt["exitPrice"],
                    exit_date=pt["exitDate"],
                    original_stop=original_stop,
                    breakeven_range=settings["breakevenRange"],
                )

                context: dict[str, Any] = {}

                now = _now_iso()
                trade_id = str(uuid.uuid4())
                position_id = f"manual-{uuid.uuid4()}"
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
                        position_id,
                        pt["symbol"],
                        pt["side"],
                        pt["shares"],
                        pt["entryPrice"],
                        pt["entryDate"],
                        pt["exitPrice"],
                        pt["exitDate"],
                        original_stop,
                        pt.get("setup"),
                        pt.get("notes"),
                        derived["pnl_dollar"],
                        derived["pnl_percent"],
                        derived["r_multiple"],
                        derived["hold_days"],
                        derived["result"],
                        json.dumps(context),
                        now,
                    ),
                )
                inserted += 1
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return {"imported": inserted}
    finally:
        if owned_conn:
            conn.close()


def delete_all_trades(
    user_id: str,
    conn: sqlite3.Connection | None = None,
) -> int:
    """Hard-delete every trade for the user. Returns count deleted.
    The double-confirmation (type 'DELETE') is enforced at the router
    layer; this function unconditionally deletes if called."""
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        cursor = conn.execute(
            "DELETE FROM j2_trades WHERE user_id = ?", (user_id,)
        )
        conn.commit()
        return cursor.rowcount
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
