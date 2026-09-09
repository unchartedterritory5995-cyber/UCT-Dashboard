"""Typed Notebook trade/strategy references (Wave 3, P1-4).

Links a note/capture to the authoritative `j2_trades` or `j2_option_strategies`
row it came from. `j2_trades.id` and `j2_option_strategies.id` are independent
uuid4 namespaces -- a bare `trade_ref` string is NOT globally unique, so every
new reference is written with an explicit `trade_ref_type` alongside it. The
normal resolver never "tries both tables" for a typed reference; it queries
exactly the one table the type names.

⛔ NOT the same thing as the unrelated "stable trade reference" system in
`trade_refs.py` (screenshots / rule-adherence / broker-orphan-reattachment,
keyed on `ext:<external_id>`/`id:<row id>` strings). That system already
disambiguates by construction via its string prefix and is untouched here.
This module is Notebook-side only: linking a note to the trade/strategy it
documents.
"""
from __future__ import annotations

import sqlite3
from typing import Any, Literal

TradeRefType = Literal["equity_trade", "option_strategy", "position"]

# The only three supported types. Do not add another without also extending
# every function below -- an unrecognized type must never silently resolve
# against one of these tables.
#
# "position" (j2_positions) exists ONLY for the pre-trade thesis flow
# (AddPositionModal): a position has no j2_trades row until it closes, so a
# note authored before/at position-creation must reference the OPEN position
# by its own real id -- never a fabricated future trade id. See
# resolve_trade_ref's "position" branch below for how that reference
# automatically graduates to the resulting closed trade once one exists.
TRADE_REF_TYPES: tuple[str, ...] = ("equity_trade", "option_strategy", "position")

_TABLE_BY_TYPE = {
    "equity_trade": "j2_trades",
    "option_strategy": "j2_option_strategies",
    "position": "j2_positions",
}


def is_valid_trade_ref_type(value: Any) -> bool:
    return value in TRADE_REF_TYPES


_SYMBOL_COL_BY_TYPE = {"equity_trade": "symbol", "option_strategy": "underlying", "position": "symbol"}


def _exists(conn: sqlite3.Connection, table: str, user_id: str, trade_ref: str) -> bool:
    row = conn.execute(
        f"SELECT 1 FROM {table} WHERE id = ? AND user_id = ?", (trade_ref, user_id)
    ).fetchone()
    return row is not None


def _symbol_for(conn: sqlite3.Connection, trade_ref_type: str, user_id: str, trade_ref: str) -> str | None:
    """Best-effort display label (the ticker) for a resolved reference —
    purely cosmetic, never used for resolution/authorization itself."""
    table = _TABLE_BY_TYPE[trade_ref_type]
    col = _SYMBOL_COL_BY_TYPE[trade_ref_type]
    row = conn.execute(
        f"SELECT {col} FROM {table} WHERE id = ? AND user_id = ?", (trade_ref, user_id)
    ).fetchone()
    return row[0] if row else None


def resolve_trade_ref(
    conn: sqlite3.Connection, user_id: str, trade_ref: str | None,
    trade_ref_type: str | None,
) -> dict[str, Any]:
    """Resolve one (trade_ref, trade_ref_type) to its authoritative row,
    re-verifying tenant ownership (`user_id`) on every path -- the reference
    itself is never treated as authorization.

    Returns exactly one of:
      {"kind": "equity_trade" | "option_strategy" | "position", "id": trade_ref,
       "legacyInferred": bool, "symbol": str | None}
      {"kind": "unresolved"}   -- no such row for this user
      {"kind": "ambiguous_legacy"}  -- untyped row whose id exists in BOTH
                                       tables for this user; never guessed
      {"kind": "invalid_type"}  -- trade_ref_type is neither a supported type
                                    nor None
      {"kind": "empty"}  -- no trade_ref at all

    `symbol` is a best-effort display label only, never used for resolution
    or authorization -- those are decided entirely by the (trade_ref,
    trade_ref_type, user_id) lookup above it.

    A "position" reference GRADUATES automatically: j2_positions rows are
    never deleted on close (only closed_at/shares change), and closing writes
    the resulting j2_trades row's position_id back to the original position
    -- so once that position has closed into EXACTLY ONE trade, resolution
    returns that trade instead (kind "equity_trade") rather than the now-
    historical position. Multiple partial closes (>1 resulting trade) never
    guess which one the note "is about" -- same never-guess rule as the
    legacy-ambiguous case above -- and stay resolved as "position".
    """
    if not trade_ref:
        return {"kind": "empty"}

    if trade_ref_type is not None and not is_valid_trade_ref_type(trade_ref_type):
        return {"kind": "invalid_type"}

    if trade_ref_type == "position":
        if not _exists(conn, "j2_positions", user_id, trade_ref):
            return {"kind": "unresolved"}
        graduated = conn.execute(
            "SELECT id FROM j2_trades WHERE position_id = ? AND user_id = ?",
            (trade_ref, user_id),
        ).fetchall()
        if len(graduated) == 1:
            gid = graduated[0]["id"]
            return {
                "kind": "equity_trade", "id": gid, "legacyInferred": False,
                "symbol": _symbol_for(conn, "equity_trade", user_id, gid),
                "graduatedFromPosition": trade_ref,
            }
        return {
            "kind": "position", "id": trade_ref, "legacyInferred": False,
            "symbol": _symbol_for(conn, "position", user_id, trade_ref),
        }

    if trade_ref_type is not None:
        # Typed reference: query ONLY the named table. Never fall back to
        # the other one -- that is exactly the ambiguity this design exists
        # to prevent.
        table = _TABLE_BY_TYPE[trade_ref_type]
        if _exists(conn, table, user_id, trade_ref):
            return {
                "kind": trade_ref_type, "id": trade_ref, "legacyInferred": False,
                "symbol": _symbol_for(conn, trade_ref_type, user_id, trade_ref),
            }
        return {"kind": "unresolved"}

    # Legacy path: trade_ref_type is None (a Wave-1 row written before this
    # column existed). Infer ONLY when the id is unique to one table for
    # THIS user -- never pick a winner by query order.
    in_trades = _exists(conn, "j2_trades", user_id, trade_ref)
    in_strategies = _exists(conn, "j2_option_strategies", user_id, trade_ref)
    if in_trades and in_strategies:
        return {"kind": "ambiguous_legacy"}
    if in_trades:
        return {
            "kind": "equity_trade", "id": trade_ref, "legacyInferred": True,
            "symbol": _symbol_for(conn, "equity_trade", user_id, trade_ref),
        }
    if in_strategies:
        return {
            "kind": "option_strategy", "id": trade_ref, "legacyInferred": True,
            "symbol": _symbol_for(conn, "option_strategy", user_id, trade_ref),
        }
    return {"kind": "unresolved"}


def notes_linked_to_trade(
    conn: sqlite3.Connection, user_id: str, trade_ref: str, trade_ref_type: str,
) -> list[str]:
    """Reverse lookup: distinct note_ids whose embed(s) reference this exact
    (trade_ref, trade_ref_type), for this user only. Typed rows match
    directly. A legacy (untyped) row is included ONLY when it uniquely
    resolves to this same (trade_ref, trade_ref_type) for this user via
    `resolve_trade_ref` -- an ambiguous legacy row is excluded rather than
    guessed onto either side's list.

    `trade_ref_type` must be one of TRADE_REF_TYPES -- the caller always
    knows it (it's viewing a specific trade or a specific strategy)."""
    if not is_valid_trade_ref_type(trade_ref_type):
        raise ValueError(f"invalid trade_ref_type: {trade_ref_type!r}")

    typed_rows = conn.execute(
        "SELECT DISTINCT note_id FROM j2_note_embeds"
        " WHERE user_id = ? AND trade_ref = ? AND trade_ref_type = ?",
        (user_id, trade_ref, trade_ref_type),
    ).fetchall()
    note_ids = {r["note_id"] for r in typed_rows}

    legacy_rows = conn.execute(
        "SELECT DISTINCT note_id FROM j2_note_embeds"
        " WHERE user_id = ? AND trade_ref = ? AND trade_ref_type IS NULL",
        (user_id, trade_ref),
    ).fetchall()
    for r in legacy_rows:
        resolved = resolve_trade_ref(conn, user_id, trade_ref, None)
        if resolved.get("kind") == trade_ref_type:
            note_ids.add(r["note_id"])
        # ambiguous_legacy / unresolved / a different type: never included.

    # Wave 3 position-graduation: a note linked to the OPEN POSITION that
    # later closed into exactly this trade also counts as linked to the
    # trade (mirrors resolve_trade_ref's own graduation branch). Positions
    # graduate into equity trades only.
    if trade_ref_type == "equity_trade":
        trade_row = conn.execute(
            "SELECT position_id FROM j2_trades WHERE id = ? AND user_id = ?",
            (trade_ref, user_id),
        ).fetchone()
        position_id = trade_row["position_id"] if trade_row else None
        if position_id:
            # Only when this position graduated UNIQUELY to this trade --
            # never guess across multiple partial closes.
            siblings = conn.execute(
                "SELECT id FROM j2_trades WHERE position_id = ? AND user_id = ?",
                (position_id, user_id),
            ).fetchall()
            if len(siblings) == 1:
                pos_rows = conn.execute(
                    "SELECT DISTINCT note_id FROM j2_note_embeds"
                    " WHERE user_id = ? AND trade_ref = ? AND trade_ref_type = 'position'",
                    (user_id, position_id),
                ).fetchall()
                note_ids.update(r["note_id"] for r in pos_rows)

    return sorted(note_ids)
