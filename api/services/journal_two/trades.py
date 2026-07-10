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
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from datetime import timedelta

from api.services.auth_db import get_connection
from api.services.journal_two import calculations as calc
from api.services.journal_two.filters import FilterSpec, trades_where
from api.services.journal_two import regime as regime_service
from api.services.journal_two.positions import _row_to_position
from api.services.journal_two.timeutil import (
    ET,
    UTC,
    compute_trading_day_et,
    compute_hour_et,
)
from api.services.journal_two.trade_refs import trade_ref_for_row

# Strict 24-hour HH:MM (e.g. '09:45', '14:30'). Rejects '9:5', '25:00', '10:60'.
_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class CloseValidationError(ValueError):
    """Raised when close payload fails §10 validation."""


def _normalize_string_list(value, field_name: str) -> list[str]:
    """Coerce a payload tag list to list[str]. None/missing → []."""
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field_name} must be a list")
    out: list[str] = []
    for s in value:
        if isinstance(s, str) and s.strip():
            stripped = s.strip()
            if stripped not in out:
                out.append(stripped)
    return out


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

    fees_raw = payload.get("fees", 0)
    if fees_raw is None or fees_raw == "":
        fees = 0.0
    elif isinstance(fees_raw, (int, float)) and fees_raw >= 0:
        fees = float(fees_raw)
    else:
        raise CloseValidationError("fees must be a non-negative number")

    return {
        "shares": float(shares_to_close),
        "exit_price": float(exit_price),
        "exit_date": exit_dt.astimezone(timezone.utc).isoformat(),
        "notes": notes if isinstance(notes, str) else None,
        "fees": fees,
        "mistake_tags": _normalize_string_list(payload.get("mistakeTags"), "mistakeTags"),
        "emotion_tags": _normalize_string_list(payload.get("emotionTags"), "emotionTags"),
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
                   setup, notes, context_at_entry, account_id,
                   created_at, updated_at, closed_at
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
                    r_multiple, hold_days, result, context_at_entry,
                    account_id, fees, created_at, regime,
                    mistake_tags, emotion_tags, trading_day_et, hour_et
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    position.get("accountId"),  # inherit from parent position
                    normalized.get("fees", 0.0),
                    now,
                    regime_service.get_current_regime().get("regime"),
                    json.dumps(normalized["mistake_tags"]),
                    json.dumps(normalized["emotion_tags"]),
                    compute_trading_day_et(normalized["exit_date"]),
                    compute_hour_et(normalized["exit_date"]),
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
                "mistakeTags": normalized["mistake_tags"],
                "emotionTags": normalized["emotion_tags"],
            },
            "position": _row_to_position(updated_row),
        }
    finally:
        if owned_conn:
            conn.close()


# ── Manual Add Trade (spec §11.4 non-close write path) ──────────────────────

class ManualTradeValidationError(ValueError):
    """Raised when a manual Add Trade payload fails validation."""


def _combine_manual_datetime(
    date_raw: Any, time_raw: Any, date_field: str, time_field: str
) -> datetime:
    """Normalize a required 'YYYY-MM-DD' date + OPTIONAL 'HH:MM' ET time.

    - time present + valid HH:MM → interpret `date + time` as an ET-LOCAL
      datetime and convert to the DST-correct UTC instant (so P1a's stamping
      computes the real hour_et). e.g. exitDate '2026-04-19' + exitTimeEt
      '10:30' → 2026-04-19T14:30:00+00:00 (EDT).
    - time absent (None or '') → the EXISTING date-only convention UNCHANGED:
      bare date → UTC midnight; a full ISO passes through parsed as-is.
    - malformed time → ManualTradeValidationError (400).

    Returns a tz-aware datetime (callers normalize to UTC ISO for storage).
    """
    if not isinstance(date_raw, str) or not date_raw:
        raise ManualTradeValidationError(f"{date_field} is required")

    if time_raw is not None and time_raw != "":
        if not isinstance(time_raw, str) or not _HHMM_RE.match(time_raw):
            raise ManualTradeValidationError(
                f"{time_field} must be 'HH:MM' (24-hour)"
            )
        # A time is only meaningful against a bare calendar day; if a full ISO
        # slipped in, combine with its date part.
        date_part = date_raw.split("T", 1)[0]
        try:
            local = datetime.fromisoformat(f"{date_part}T{time_raw}:00").replace(
                tzinfo=ET
            )
        except ValueError as e:
            raise ManualTradeValidationError(f"{date_field} invalid: {e}")
        return local.astimezone(UTC)

    try:
        return (
            datetime.fromisoformat(date_raw.replace("Z", "+00:00"))
            if "T" in date_raw
            else datetime.fromisoformat(date_raw + "T00:00:00+00:00")
        )
    except ValueError as e:
        raise ManualTradeValidationError(f"{date_field} invalid: {e}")


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

    # Optional ET time-of-day: when present, date+time combine as an ET-local
    # instant (DST-correct UTC); when absent, the date-only UTC-midnight
    # convention is preserved. See _combine_manual_datetime.
    entry_dt = _combine_manual_datetime(
        payload.get("entryDate"), payload.get("entryTimeEt"),
        "entryDate", "entryTimeEt",
    )
    exit_dt = _combine_manual_datetime(
        payload.get("exitDate"), payload.get("exitTimeEt"),
        "exitDate", "exitTimeEt",
    )

    # Ordering guard. When BOTH sides carry a time, compare the precise instants
    # (catches a genuine same-day exit-before-entry reversal). Otherwise a time
    # can't be meaningfully compared against an untimed (midnight) day, so fall
    # back to comparing ET trading days — a same-day round trip stays valid.
    # (Both-untimed reduces to the original midnight-vs-midnight date compare.)
    entry_iso = entry_dt.astimezone(timezone.utc).isoformat()
    exit_iso = exit_dt.astimezone(timezone.utc).isoformat()
    both_timed = bool(payload.get("entryTimeEt")) and bool(payload.get("exitTimeEt"))
    if both_timed:
        out_of_order = exit_dt.astimezone(timezone.utc) < entry_dt.astimezone(timezone.utc)
    else:
        out_of_order = compute_trading_day_et(exit_iso) < compute_trading_day_et(entry_iso)
    if out_of_order:
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
    fees_raw = payload.get("fees", 0)
    if fees_raw is None or fees_raw == "":
        fees = 0.0
    elif isinstance(fees_raw, (int, float)) and fees_raw >= 0:
        fees = float(fees_raw)
    else:
        raise ManualTradeValidationError("fees must be a non-negative number")

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
        "fees": fees,
        "mistake_tags": _normalize_string_list(payload.get("mistakeTags"), "mistakeTags"),
        "emotion_tags": _normalize_string_list(payload.get("emotionTags"), "emotionTags"),
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
    parent Position. account_id stamped from payload.accountId."""
    validated = _validate_manual_trade_payload(payload)
    account_id = payload.get("accountId")

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
                r_multiple, hold_days, result, context_at_entry,
                account_id, fees, created_at, regime,
                mistake_tags, emotion_tags, trading_day_et, hour_et
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                account_id,
                validated.get("fees", 0.0),
                now,
                regime_service.get_current_regime().get("regime"),
                json.dumps(validated["mistake_tags"]),
                json.dumps(validated["emotion_tags"]),
                compute_trading_day_et(validated["exitDate"]),
                compute_hour_et(validated["exitDate"]),
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
            "mistakeTags": validated["mistake_tags"],
            "emotionTags": validated["emotion_tags"],
        }
    finally:
        if owned_conn:
            conn.close()


def update_trade(
    user_id: str,
    trade_id: str,
    patch: dict[str, Any],
    settings: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Enrich an existing trade: set originalStop / setup / notes / mistakeTags /
    emotionTags after the fact (the primary path for adding a stop to a broker-
    imported trade so its R-multiple computes). Recomputes r_multiple/result via
    compute_trade_derived. Returns the updated trade, or None if not found.

    Entry/exit price/shares/dates are immutable here (a trade is a closed
    record) — only intent/risk metadata is editable."""
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_trades WHERE id = ? AND user_id = ?",
            (trade_id, user_id),
        ).fetchone()
        if row is None:
            return None

        side = row["side"]
        entry_price = float(row["entry_price"])

        original_stop = float(row["original_stop"])
        if "originalStop" in patch:
            os_raw = patch["originalStop"]
            if os_raw is None or os_raw == "":
                original_stop = entry_price  # blank → R null (honest unknown)
            elif not isinstance(os_raw, (int, float)) or os_raw < 0:
                raise ManualTradeValidationError("originalStop must be a non-negative number")
            else:
                original_stop = float(os_raw)
                if original_stop > 0:
                    if side == "Long" and original_stop >= entry_price:
                        raise ManualTradeValidationError("originalStop must be below entryPrice for a Long")
                    if side == "Short" and original_stop <= entry_price:
                        raise ManualTradeValidationError("originalStop must be above entryPrice for a Short")

        setup = patch.get("setup", row["setup"])
        if isinstance(setup, str):
            setup = setup.strip() or None
        notes = patch.get("notes", row["notes"])
        keys = row.keys()
        mistake_tags = (_normalize_string_list(patch["mistakeTags"], "mistakeTags")
                        if "mistakeTags" in patch
                        else (json.loads(row["mistake_tags"]) if "mistake_tags" in keys and row["mistake_tags"] else []))
        emotion_tags = (_normalize_string_list(patch["emotionTags"], "emotionTags")
                        if "emotionTags" in patch
                        else (json.loads(row["emotion_tags"]) if "emotion_tags" in keys and row["emotion_tags"] else []))

        derived = calc.compute_trade_derived(
            side=side, shares=float(row["shares"]), entry_price=entry_price,
            entry_date=row["entry_date"], exit_price=float(row["exit_price"]),
            exit_date=row["exit_date"], original_stop=original_stop,
            breakeven_range=settings["breakevenRange"],
        )
        conn.execute(
            """
            UPDATE j2_trades
               SET original_stop = ?, setup = ?, notes = ?,
                   pnl_dollar = ?, pnl_percent = ?, r_multiple = ?, result = ?,
                   mistake_tags = ?, emotion_tags = ?
             WHERE id = ? AND user_id = ?
            """,
            (original_stop, setup, notes, derived["pnl_dollar"], derived["pnl_percent"],
             derived["r_multiple"], derived["result"], json.dumps(mistake_tags),
             json.dumps(emotion_tags), trade_id, user_id),
        )
        conn.commit()
        new_row = conn.execute(
            "SELECT id, user_id, position_id, symbol, side, shares, entry_price, "
            "entry_date, exit_price, exit_date, original_stop, setup, notes, "
            "pnl_dollar, pnl_percent, r_multiple, hold_days, result, context_at_entry, "
            "account_id, fees, created_at, mistake_tags, emotion_tags, source "
            "FROM j2_trades WHERE id = ?", (trade_id,),
        ).fetchone()
        return _row_to_trade(new_row)
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
    *,
    account_id: str | None = None,
    source: str | None = None,
) -> dict[str, Any]:
    """Bulk-insert pre-parsed trade dicts. account_id stamped on every
    inserted row (defaults to None if caller doesn't supply one — the
    router resolves the user's Default account before calling).

    Origin tagging (broker sync):
      - `source` (e.g. 'broker') is stamped on every inserted row.
      - If a trade dict carries an `externalId`, it's stored on the row and
        used for idempotency: a trade whose (user_id, externalId) already
        exists is SKIPPED (re-running reconstruction over the same broker
        activities produces no duplicates). Trades without an externalId
        (the CSV path) are always inserted — behavior is unchanged.
    Returns {"imported": n, "skipped": m}."""
    if not parsed_trades:
        return {"imported": 0, "skipped": 0}

    owned_conn = conn is None
    conn = conn or get_connection()

    # Regime is computed ONCE per batch (not per trade). For broker-imported
    # trades it's left NULL: these are historical round-trips, so stamping
    # today's regime would be wrong and would pollute regime-aware analytics.
    # The current regime only makes sense for trades being recorded now
    # (manual add / CSV of recent trades).
    batch_regime = (
        None if source == "broker"
        else regime_service.get_current_regime().get("regime")
    )

    try:
        conn.execute("BEGIN")
        inserted = 0
        skipped = 0
        try:
            for pt in parsed_trades:
                external_id = pt.get("externalId")
                if external_id is not None:
                    dup = conn.execute(
                        "SELECT 1 FROM j2_trades WHERE user_id = ? AND external_id = ?",
                        (user_id, external_id),
                    ).fetchone()
                    if dup is not None:
                        skipped += 1
                        continue

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
                        r_multiple, hold_days, result, context_at_entry,
                        account_id, fees, created_at, regime,
                        mistake_tags, emotion_tags, source, external_id,
                        trading_day_et, hour_et
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        account_id,
                        float(pt.get("fees") or 0),
                        now,
                        batch_regime,
                        '[]',
                        '[]',
                        source,
                        external_id,
                        compute_trading_day_et(pt["exitDate"]),
                        compute_hour_et(pt["exitDate"]),
                    ),
                )
                inserted += 1
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return {"imported": inserted, "skipped": skipped}
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
    keys = row.keys() if hasattr(row, "keys") else []
    account_id = row["account_id"] if "account_id" in keys else None
    fees = float(row["fees"]) if "fees" in keys and row["fees"] is not None else 0.0
    gross_pnl = float(row["pnl_dollar"])
    # pnl_dollar is stored GROSS (pre-fees). Expose both so the UI can
    # show Net P&L where appropriate.
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "accountId": account_id,
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
        "pnlDollar": gross_pnl,                  # gross (legacy field name retained)
        "pnlDollarGross": gross_pnl,             # explicit alias
        "pnlDollarNet": round(gross_pnl - fees, 2),  # net-of-fees
        "fees": round(fees, 2),
        "pnlPercent": float(row["pnl_percent"]),
        "rMultiple": None if row["r_multiple"] is None else float(row["r_multiple"]),
        "holdDays": int(row["hold_days"]),
        "result": row["result"],
        "contextAtEntry": json.loads(row["context_at_entry"]),
        "createdAt": row["created_at"],
        "mistakeTags": json.loads(row["mistake_tags"]) if "mistake_tags" in keys and row["mistake_tags"] else [],
        "emotionTags": json.loads(row["emotion_tags"]) if "emotion_tags" in keys and row["emotion_tags"] else [],
        # Origin tag: 'broker' for auto-imported trades (badge in UI; lets
        # Compass treat them as imports without manual pre-trade intent).
        "source": row["source"] if "source" in keys else None,
    }


_TRADE_COLS = """id, user_id, position_id, symbol, side, shares,
                       entry_price, entry_date, exit_price, exit_date,
                       original_stop, setup, notes, pnl_dollar, pnl_percent,
                       r_multiple, hold_days, result, context_at_entry,
                       account_id, fees, created_at, mistake_tags, emotion_tags,
                       source"""


def list_trades_for_user(
    user_id: str,
    conn: sqlite3.Connection | None = None,
    *,
    account_id: str | None = None,
    spec: "FilterSpec | None" = None,
) -> list[dict[str, Any]] | tuple[list[dict[str, Any]], int]:
    """Trades for a user, newest-entry first. Optional account_id filter.

    Dual-shape by design (every existing internal caller passes no spec and
    relies on the plain-list shape):

      * ``spec=None`` (default) → returns the FULL unbounded ``list[dict]``,
        identical to the pre-Phase-6 behavior.
      * ``spec`` given (the GET /trades route) → applies the FilterSpec's
        WHERE fragment and returns a ``(trades, total)`` tuple, where ``total``
        is the full match count (ignoring the page window). Paging is OPT-IN:
        when ``spec.limit is None`` NO ``LIMIT``/``OFFSET`` is emitted (fully
        unbounded — identical to the ``spec=None`` contract); only a concrete
        ``spec.limit`` applies ``LIMIT ? OFFSET ?`` (offset None → 0). Order is
        preserved on both paths.
    """
    owned_conn = conn is None
    conn = conn or get_connection()
    try:
        where = ["user_id = ?"]
        params: list[Any] = [user_id]
        if account_id:
            where.append("account_id = ?")
            params.append(account_id)
        where_sql = " AND ".join(where)

        if spec is None:
            rows = conn.execute(
                f"SELECT {_TRADE_COLS} FROM j2_trades WHERE {where_sql}"
                " ORDER BY entry_date DESC, created_at DESC",
                params,
            ).fetchall()
            return [_row_to_trade(r) for r in rows]

        frag, filter_params = trades_where(spec)
        frag_sql = f" {frag}" if frag else ""
        total = conn.execute(
            f"SELECT COUNT(*) FROM j2_trades WHERE {where_sql}{frag_sql}",
            [*params, *filter_params],
        ).fetchone()[0]
        base_sql = (
            f"SELECT {_TRADE_COLS} FROM j2_trades WHERE {where_sql}{frag_sql}"
            " ORDER BY entry_date DESC, created_at DESC"
        )
        if spec.limit is None:
            # No paging requested → fully unbounded (no LIMIT), same as spec=None.
            rows = conn.execute(base_sql, [*params, *filter_params]).fetchall()
        else:
            rows = conn.execute(
                base_sql + " LIMIT ? OFFSET ?",
                [*params, *filter_params, spec.limit, spec.offset or 0],
            ).fetchall()
        return [_row_to_trade(r) for r in rows], int(total)
    finally:
        if owned_conn:
            conn.close()


# ── Single-trade detail + best-effort broker provenance (P1b) ────────────────

def _provenance_window(entry_date: Any, exit_date: Any) -> tuple[str, str] | None:
    """Lexical [lo, hi] bounds for the ± 1-day holding window, comparable
    against a stored ISO `occurred_at` string. Returns None when either date
    can't be parsed. `hi` is suffixed with '~' (sorts after any ISO char) so an
    activity at ANY time-of-day on the exit+1d day is still included."""
    def _parse(value):
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None

    lo_dt = _parse(entry_date)
    hi_dt = _parse(exit_date)
    if lo_dt is None or hi_dt is None:
        return None
    lo = (lo_dt - timedelta(days=1)).date().isoformat()
    hi = (hi_dt + timedelta(days=1)).date().isoformat() + "~"
    return lo, hi


def _activity_num(raw_json: Any, key: str) -> float | None:
    """Best-effort float pull from a stored raw_json activity payload."""
    try:
        data = json.loads(raw_json) if raw_json else {}
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    val = data.get(key)
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def get_trade_detail(
    user_id: str,
    trade_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """One trade (user-scoped) + its stable tradeRef + best-effort broker
    provenance. Returns None when the trade doesn't exist or belongs to another
    user (option-strategy ids simply aren't in j2_trades → natural None → 404).

    `brokerActivities` is populated ONLY for broker-source trades: rows from the
    raw j2_broker_activities ledger whose symbol matches and whose `occurred_at`
    falls inside the ± 1-day holding window. It is labeled best-effort
    (`matchBasis: "symbol+window"`) — a heuristic association, NOT a claim of
    exact fill lineage. The query is wrapped so older DBs / column drift
    (sqlite3.OperationalError) degrade to an empty list rather than 500.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_trades WHERE user_id = ? AND id = ?",
            (user_id, trade_id),
        ).fetchone()
        if row is None:
            return None

        trade = _row_to_trade(row)
        activities: list[dict[str, Any]] = []

        keys = row.keys()
        is_broker = "source" in keys and row["source"] == "broker"
        if is_broker and trade.get("entryDate") and trade.get("exitDate"):
            bounds = _provenance_window(trade["entryDate"], trade["exitDate"])
            if bounds is not None:
                lo, hi = bounds
                try:
                    acts = conn.execute(
                        "SELECT id, activity_type, symbol, occurred_at, raw_json"
                        "  FROM j2_broker_activities"
                        " WHERE user_id = ? AND symbol = ?"
                        "   AND occurred_at >= ? AND occurred_at <= ?"
                        " ORDER BY occurred_at ASC LIMIT 50",
                        (user_id, row["symbol"], lo, hi),
                    ).fetchall()
                    activities = [
                        {
                            "id": a["id"],
                            "activityType": a["activity_type"],
                            "symbol": a["symbol"],
                            "occurredAt": a["occurred_at"],
                            "units": _activity_num(a["raw_json"], "units"),
                            "price": _activity_num(a["raw_json"], "price"),
                            "matchBasis": "symbol+window",
                        }
                        for a in acts
                    ]
                except sqlite3.OperationalError:
                    # Older DBs / column drift — provenance is best-effort.
                    activities = []

        return {
            "trade": trade,
            "tradeRef": trade_ref_for_row(row),
            "brokerActivities": activities,
        }
    finally:
        if owned:
            conn.close()
