"""
Journal 2.0 — positions service.

Read-only helpers for Phase 3. Write helpers (create, update, close,
delete) arrive in Phase 4.

Spec §4 (Position shape), §7 (Open Positions tab display rules).
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any

from api.services.auth_db import get_connection


class PositionValidationError(ValueError):
    """Raised when a create/update payload violates spec §8.4 / §9."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def _validate_create_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Validate + normalize a new position's payload (spec §8.4)."""
    symbol = payload.get("symbol")
    side = payload.get("side")
    entry_date = payload.get("entryDate")
    shares = payload.get("shares")
    entry_price = payload.get("entryPrice")
    stop_price = payload.get("stopPrice")
    setup = payload.get("setup")
    notes = payload.get("notes")

    if not isinstance(symbol, str) or not symbol.strip():
        raise PositionValidationError("symbol is required")
    if side not in {"Long", "Short"}:
        raise PositionValidationError("side must be 'Long' or 'Short'")
    if not isinstance(shares, (int, float)) or shares <= 0:
        raise PositionValidationError("shares must be > 0")
    if not isinstance(entry_price, (int, float)) or entry_price <= 0:
        raise PositionValidationError("entryPrice must be > 0")
    if not isinstance(entry_date, str) or not entry_date:
        raise PositionValidationError("entryDate is required")

    # Entry date must not be more than 1 day in the future (timezone buffer)
    try:
        if "T" in entry_date:
            entry_dt = datetime.fromisoformat(entry_date.replace("Z", "+00:00"))
        else:
            entry_dt = datetime.fromisoformat(entry_date + "T00:00:00+00:00")
    except ValueError as e:
        raise PositionValidationError(f"entryDate invalid: {e}")
    now = datetime.now(timezone.utc)
    if entry_dt.astimezone(timezone.utc) > now + timedelta(days=1):
        raise PositionValidationError("entryDate cannot be in the future")

    # Stop-side validation (§8.4): Long → stop < entry; Short → stop > entry
    if stop_price is not None:
        if not isinstance(stop_price, (int, float)) or stop_price < 0:
            raise PositionValidationError("stopPrice must be a non-negative number")
        if side == "Long" and stop_price >= entry_price:
            raise PositionValidationError(
                "stopPrice must be below entryPrice for a Long position"
            )
        if side == "Short" and stop_price <= entry_price:
            raise PositionValidationError(
                "stopPrice must be above entryPrice for a Short position"
            )

    return {
        "symbol": symbol.strip().upper(),
        "side": side,
        "entryDate": entry_dt.astimezone(timezone.utc).isoformat(),
        "shares": float(shares),
        "entryPrice": float(entry_price),
        "stopPrice": float(stop_price) if stop_price is not None else 0.0,
        "setup": setup.strip() if isinstance(setup, str) and setup.strip() else None,
        "notes": notes if isinstance(notes, str) else None,
    }


def create_position(
    user_id: str,
    payload: dict[str, Any],
    context_at_entry: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Insert a new open Position for a user (spec §8.4)."""
    validated = _validate_create_payload(payload)
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        now = _now_iso()
        pid = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO j2_positions (
                id, user_id, symbol, side, entry_date, shares, original_shares,
                entry_price, stop_price, breakeven_stop, raise_to_breakeven,
                setup, notes, context_at_entry, created_at, updated_at, closed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                pid,
                user_id,
                validated["symbol"],
                validated["side"],
                validated["entryDate"],
                validated["shares"],
                validated["shares"],  # originalShares = shares at creation
                validated["entryPrice"],
                validated["stopPrice"],
                None,  # breakevenStop
                0,     # raiseToBreakeven
                validated["setup"],
                validated["notes"],
                json.dumps(context_at_entry),
                now,
                now,
                None,
            ),
        )
        conn.commit()
        got = get_position(user_id, pid, conn=conn)
        assert got is not None
        return got
    finally:
        if owned_conn:
            conn.close()


# Fields a client is allowed to modify via PUT (§9).
# `stopPrice` IS here — users can edit the original stop deliberately.
# `originalShares`, `closedAt`, `contextAtEntry`, timestamps are NOT — they
# are server-owned history.
_UPDATABLE_FIELDS = {
    "symbol": str,
    "side": str,
    "entryDate": str,
    "shares": (int, float),
    "entryPrice": (int, float),
    "stopPrice": (int, float),
    "breakevenStop": (int, float, type(None)),
    "raiseToBreakeven": bool,
    "setup": (str, type(None)),
    "notes": (str, type(None)),
}


def update_position(
    user_id: str,
    position_id: str,
    patch: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Partial update. Only fields in _UPDATABLE_FIELDS are accepted; others
    are silently ignored. Returns the updated position, or None if not found.

    Invariant (spec §9 / §18): when `raiseToBreakeven` or `breakevenStop`
    appear in the patch without `stopPrice`, the caller gets the
    intuitive behavior — original stop is preserved. This function does
    NOT force-preserve stopPrice when the client explicitly sends it;
    users can intentionally edit their original stop if they want to.
    """
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        existing = get_position(user_id, position_id, conn=conn)
        if existing is None:
            return None

        # Normalize + validate the patch subset.
        updates: dict[str, Any] = {}
        for key, value in patch.items():
            if key not in _UPDATABLE_FIELDS:
                continue
            expected = _UPDATABLE_FIELDS[key]
            if not isinstance(value, expected):
                raise PositionValidationError(f"{key} type invalid")
            updates[key] = value

        # Derive final values (merge patch onto existing for cross-field checks)
        merged = {**existing, **updates}
        if merged["side"] not in {"Long", "Short"}:
            raise PositionValidationError("side must be 'Long' or 'Short'")
        if merged["shares"] is not None and merged["shares"] <= 0:
            raise PositionValidationError("shares must be > 0")
        if merged["entryPrice"] is not None and merged["entryPrice"] <= 0:
            raise PositionValidationError("entryPrice must be > 0")
        if merged["stopPrice"] is not None and merged["stopPrice"] < 0:
            raise PositionValidationError("stopPrice must be >= 0")

        # Stop-side validation if stopPrice changed or side changed
        if "stopPrice" in updates or "side" in updates:
            sp = merged["stopPrice"]
            ep = merged["entryPrice"]
            if sp is not None and sp > 0:
                if merged["side"] == "Long" and sp >= ep:
                    raise PositionValidationError(
                        "stopPrice must be below entryPrice for Long"
                    )
                if merged["side"] == "Short" and sp <= ep:
                    raise PositionValidationError(
                        "stopPrice must be above entryPrice for Short"
                    )

        # Coerce raiseToBreakeven → INTEGER for SQLite; clear breakevenStop
        # to null when raise-to-BE is turned off.
        if "raiseToBreakeven" in updates:
            if updates["raiseToBreakeven"] is False and "breakevenStop" not in updates:
                updates["breakevenStop"] = None

        if not updates:
            return existing

        # Build SQL update
        field_map = {
            "symbol": "symbol",
            "side": "side",
            "entryDate": "entry_date",
            "shares": "shares",
            "entryPrice": "entry_price",
            "stopPrice": "stop_price",
            "breakevenStop": "breakeven_stop",
            "raiseToBreakeven": "raise_to_breakeven",
            "setup": "setup",
            "notes": "notes",
        }
        sets = []
        params = []
        for k, v in updates.items():
            col = field_map[k]
            if k == "raiseToBreakeven":
                v = 1 if v else 0
            elif k == "symbol" and isinstance(v, str):
                v = v.strip().upper()
            elif k == "setup" and isinstance(v, str):
                v = v.strip() or None
            sets.append(f"{col} = ?")
            params.append(v)
        sets.append("updated_at = ?")
        params.append(_now_iso())
        params.extend([position_id, user_id])

        conn.execute(
            f"UPDATE j2_positions SET {', '.join(sets)} WHERE id = ? AND user_id = ?",
            tuple(params),
        )
        conn.commit()
        return get_position(user_id, position_id, conn=conn)
    finally:
        if owned_conn:
            conn.close()


def delete_position(
    user_id: str,
    position_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Hard-delete a Position. Trades belonging to this position are NOT
    deleted — they retain position_id as traceability to a now-missing
    parent, which is a deliberate design decision (§4 `positionId` is
    'for traceability', not a referential constraint). Returns True if
    a row was deleted."""
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        cursor = conn.execute(
            "DELETE FROM j2_positions WHERE id = ? AND user_id = ?",
            (position_id, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0
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
