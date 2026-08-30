"""
Journal 2.0 — Options (multi-leg strategies).

Pattern C schema: one strategy row + N leg rows. Per research §0 of spec,
this is what every mature options journal uses (TradesViz, Trademetria,
TradingDiary Pro, tastytrade Order Chains).

Core rules:
  - net_entry = Σ (sideSign × qty × entry_price × 100), sideSign = +1 buy, -1 sell
    Positive = net debit (paid to enter); negative = net credit (received).
  - pnl_dollar = net_exit - net_entry - fees - exit_fees
    Uniform formula for debit AND credit structures.
  - Legs are IMMUTABLE after creation. Close flow updates exit_price only.
  - Greeks, live quotes, IV rank: out of scope v1.

Spec: docs/superpowers/specs/2026-04-19-options-multi-leg-design.md
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import date as Date, datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.filters import FilterSpec
from api.services.journal_two.timeutil import compute_trading_day_et


# ── Allowed strategy types (matches frontend StrategyTemplates.js keys) ──────

VALID_STRATEGY_TYPES = {
    # single-leg
    "long_call", "long_put", "short_call", "short_put",
    # two-leg
    "vertical_debit_call", "vertical_credit_call",
    "vertical_debit_put", "vertical_credit_put",
    "calendar", "diagonal", "straddle", "strangle",
    # four-leg
    "iron_condor", "iron_butterfly",
    "call_butterfly", "put_butterfly",
    # user-defined
    "custom",
}

VALID_DIRECTIONS = {"bullish", "bearish", "neutral"}
VALID_STATUSES = {"open", "closed", "expired", "assigned", "rolled"}


class OptionValidationError(ValueError):
    """Raised on malformed strategy / leg payload."""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Calc helpers (mirrored in lib/optionCalcs.js — keep in sync) ────────────


def _side_sign(side: str) -> int:
    return 1 if side == "buy" else -1


#: Shares per contract for a standard equity option. The manual options UI
#: only ever creates standard contracts, so this stays the default. Broker
#: imports pass the contract size the BROKER reported — a mini option is 10 —
#: via the `multiplier` argument. This module owns the FORMULA; it never
#: decides which multiplier a given contract has (that authority is
#: `broker.balances._opt_contract_multiplier`, reading `is_mini_option`).
STANDARD_CONTRACT_MULTIPLIER = 100.0


def compute_net_entry(
    legs: list[dict[str, Any]], *, multiplier: float = STANDARD_CONTRACT_MULTIPLIER,
) -> float:
    """Σ (sideSign × qty × entry_price × multiplier), multiplier default 100."""
    total = 0.0
    for leg in legs:
        total += (
            _side_sign(leg["side"])
            * float(leg["qty"])
            * float(leg["entry_price"])
            * float(multiplier)
        )
    return round(total, 2)


def compute_net_exit(
    legs: list[dict[str, Any]], *, multiplier: float = STANDARD_CONTRACT_MULTIPLIER,
) -> float | None:
    """Σ (sideSign × qty × exit_price × multiplier). None if any leg has null exit."""
    total = 0.0
    for leg in legs:
        ep = leg.get("exit_price")
        if ep is None:
            return None
        total += (
            _side_sign(leg["side"])
            * float(leg["qty"])
            * float(ep)
            * float(multiplier)
        )
    return round(total, 2)


def compute_pnl(
    net_entry: float,
    net_exit: float,
    fees: float,
    exit_fees: float,
) -> float:
    """net_exit - net_entry - fees - exit_fees (see spec §2.3 note on sign handling)."""
    return round(net_exit - net_entry - fees - exit_fees, 2)


def compute_max_risk(
    strategy_type: str,
    legs: list[dict[str, Any]],
    net_entry: float,
) -> float | None:
    """Per-strategy-type max-loss formula.

    Long (debit) strategies: max_risk = net_entry.
    Credit spreads: spread_width × 100 × qty − |net_credit|.
    Naked short options: undefined (None).
    """
    # Long single-leg debit
    if strategy_type in ("long_call", "long_put"):
        return max(net_entry, 0.0)

    # Naked short — undefined max risk
    if strategy_type in ("short_call", "short_put"):
        return None

    # Vertical debit spreads (debit structures)
    if strategy_type in ("vertical_debit_call", "vertical_debit_put"):
        return max(net_entry, 0.0)

    # Vertical credit spreads
    if strategy_type in ("vertical_credit_call", "vertical_credit_put"):
        # Spread width × 100 × qty + net_entry (net_entry is negative credit)
        if len(legs) < 2:
            return None
        width = abs(float(legs[0]["strike"]) - float(legs[1]["strike"]))
        qty = float(legs[0]["qty"])
        return round(width * 100 * qty + net_entry, 2)

    # Iron Condor / Iron Butterfly
    if strategy_type in ("iron_condor", "iron_butterfly"):
        if len(legs) < 4:
            return None
        strikes = sorted(float(l["strike"]) for l in legs)
        # Two wings: put wing (strike[1]-strike[0]) + call wing (strike[3]-strike[2])
        max_wing_width = max(strikes[1] - strikes[0], strikes[3] - strikes[2])
        # qty across the structure (user should size uniformly but take min as safe)
        qty = min(float(l["qty"]) for l in legs)
        return round(max_wing_width * 100 * qty + net_entry, 2)

    # Butterflies (debit)
    if strategy_type in ("call_butterfly", "put_butterfly"):
        return max(net_entry, 0.0)

    # Long straddle/strangle (debit both legs)
    if strategy_type in ("straddle", "strangle"):
        return max(net_entry, 0.0)

    # Calendar/Diagonal: typically debit; use net_entry
    if strategy_type in ("calendar", "diagonal"):
        return max(net_entry, 0.0) if net_entry > 0 else None

    # Custom: can't determine automatically
    return None


def compute_days_to_expiration(
    legs: list[dict[str, Any]],
    as_of: Date | None = None,
) -> int | None:
    """Minimum days across legs (nearest expiry). None if any invalid."""
    as_of = as_of or Date.today()
    try:
        return min(
            (Date.fromisoformat(l["expiration"]) - as_of).days
            for l in legs
        )
    except (ValueError, TypeError, KeyError):
        return None


def classify_debit_credit(net_entry: float) -> str:
    """Classify by entry direction. Used in Credit-vs-Debit analytics."""
    if net_entry > 0:
        return "debit"
    if net_entry < 0:
        return "credit"
    return "even"


# ── Validation ───────────────────────────────────────────────────────────────


def _validate_leg(raw: dict[str, Any], idx: int) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise OptionValidationError(f"leg[{idx}] must be an object")
    side = raw.get("side")
    if side not in ("buy", "sell"):
        raise OptionValidationError(f"leg[{idx}].side must be 'buy' or 'sell'")
    contract_type = raw.get("contract_type") or raw.get("contractType")
    if contract_type not in ("call", "put"):
        raise OptionValidationError(
            f"leg[{idx}].contract_type must be 'call' or 'put'"
        )
    strike = raw.get("strike")
    if not isinstance(strike, (int, float)) or strike <= 0:
        raise OptionValidationError(f"leg[{idx}].strike must be > 0")
    expiration = raw.get("expiration")
    if not isinstance(expiration, str):
        raise OptionValidationError(
            f"leg[{idx}].expiration must be YYYY-MM-DD string"
        )
    try:
        exp_date = Date.fromisoformat(expiration)
    except ValueError:
        raise OptionValidationError(
            f"leg[{idx}].expiration must be YYYY-MM-DD"
        )
    # Reject past expirations at create time. A user opening a strategy
    # on a leg that expired yesterday is almost certainly a typo.
    if exp_date < Date.today():
        raise OptionValidationError(
            f"leg[{idx}].expiration {expiration} is in the past"
        )
    qty = raw.get("qty")
    if not isinstance(qty, int) or qty <= 0:
        raise OptionValidationError(
            f"leg[{idx}].qty must be a positive integer"
        )
    entry_price = raw.get("entry_price") if "entry_price" in raw else raw.get("entryPrice")
    if not isinstance(entry_price, (int, float)) or entry_price < 0:
        raise OptionValidationError(
            f"leg[{idx}].entry_price must be >= 0"
        )
    return {
        "side": side,
        "contract_type": contract_type,
        "strike": float(strike),
        "expiration": expiration,
        "qty": int(qty),
        "entry_price": float(entry_price),
    }


def _validate_create_payload(payload: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise OptionValidationError("payload must be an object")

    underlying = payload.get("underlying")
    if not isinstance(underlying, str) or not underlying.strip():
        raise OptionValidationError("underlying is required")
    if len(underlying.strip()) > 16:
        raise OptionValidationError("underlying too long")

    strategy_type = payload.get("strategy_type") or payload.get("strategyType")
    if strategy_type not in VALID_STRATEGY_TYPES:
        raise OptionValidationError(
            f"strategy_type must be one of {sorted(VALID_STRATEGY_TYPES)}"
        )

    direction = payload.get("direction")
    if direction not in VALID_DIRECTIONS:
        raise OptionValidationError(
            f"direction must be one of {sorted(VALID_DIRECTIONS)}"
        )

    entry_date = payload.get("entry_date") or payload.get("entryDate")
    if not isinstance(entry_date, str):
        raise OptionValidationError("entry_date is required")
    try:
        if "T" in entry_date:
            entry_dt = datetime.fromisoformat(entry_date.replace("Z", "+00:00"))
        else:
            entry_dt = datetime.fromisoformat(entry_date + "T00:00:00+00:00")
    except ValueError as e:
        raise OptionValidationError(f"entry_date invalid: {e}")

    raw_legs = payload.get("legs")
    if not isinstance(raw_legs, list) or not raw_legs:
        raise OptionValidationError("at least one leg is required")
    if len(raw_legs) > 8:
        raise OptionValidationError("max 8 legs per strategy")

    legs = [_validate_leg(leg, i) for i, leg in enumerate(raw_legs)]

    # Single-underlying rule: nothing to check (we store underlying once
    # on the strategy row; legs don't have an underlying column).

    # Fees
    fees_raw = payload.get("fees", 0)
    if fees_raw is None or fees_raw == "":
        fees = 0.0
    elif isinstance(fees_raw, (int, float)) and fees_raw >= 0:
        fees = float(fees_raw)
    else:
        raise OptionValidationError("fees must be >= 0")

    setup = payload.get("setup")
    if setup is not None and not isinstance(setup, str):
        raise OptionValidationError("setup must be a string or null")
    if isinstance(setup, str):
        setup = setup.strip() or None

    notes = payload.get("notes")
    if notes is not None and not isinstance(notes, str):
        raise OptionValidationError("notes must be a string or null")

    linked_playbook_id = payload.get("linked_playbook_id") or payload.get("linkedPlaybookId")
    if isinstance(linked_playbook_id, str) and not linked_playbook_id.strip():
        linked_playbook_id = None

    return {
        "underlying": underlying.strip().upper(),
        "strategy_type": strategy_type,
        "direction": direction,
        "entry_date": entry_dt.astimezone(timezone.utc).isoformat(),
        "legs": legs,
        "fees": fees,
        "setup": setup,
        "notes": notes,
        "linked_playbook_id": linked_playbook_id,
    }


# ── Row-to-dict ──────────────────────────────────────────────────────────────


def _row_to_strategy(row: sqlite3.Row, legs: list[dict[str, Any]]) -> dict[str, Any]:
    keys = row.keys() if hasattr(row, "keys") else []
    bcv = row["broker_current_value"] if "broker_current_value" in keys else None
    # The broker's PRIOR-session mark. Stored + served as EVIDENCE for the
    # disputed LEAP move (our feed 675->665 vs the broker's 655->665 on
    # 2026-08-29); deliberately NOT consumed by Today — see
    # option_reconstruct._roll_option_marks for why moving one end alone is wrong.
    bcv_prev = (row["broker_current_value_prev"]
                if "broker_current_value_prev" in keys else None)
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "accountId": row["account_id"],
        "underlying": row["underlying"],
        "strategyType": row["strategy_type"],
        "direction": row["direction"],
        "netEntry": float(row["net_entry"]),
        "fees": float(row["fees"]),
        "entryDate": row["entry_date"],
        "setup": row["setup"],
        "notes": row["notes"],
        "contextAtEntry": json.loads(row["context_at_entry"]),
        "status": row["status"],
        "closedAt": row["closed_at"],
        "netExit": None if row["net_exit"] is None else float(row["net_exit"]),
        "exitFees": float(row["exit_fees"]),
        "pnlDollar": None if row["pnl_dollar"] is None else float(row["pnl_dollar"]),
        "pnlPercent": None if row["pnl_percent"] is None else float(row["pnl_percent"]),
        "rMultiple": None if row["r_multiple"] is None else float(row["r_multiple"]),
        "result": row["result"],
        "linkedPlaybookId": row["linked_playbook_id"],
        "parentStrategyId": row["parent_strategy_id"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        # Broker-sync: current market value (mark x qty x 100, signed) so open
        # broker option strategies can show Current + P&L like equity positions.
        "source": row["source"] if "source" in keys else None,
        "brokerCurrentValue": None if bcv is None else float(bcv),
        "brokerCurrentValuePrev": None if bcv_prev is None else float(bcv_prev),
        "brokerCurrentValuePrevSession": (
            row["broker_current_value_prev_session"]
            if "broker_current_value_prev_session" in keys else None
        ),
        "legs": legs,
    }


def _row_to_leg(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "legIndex": int(row["leg_index"]),
        "side": row["side"],
        "contractType": row["contract_type"],
        "strike": float(row["strike"]),
        "expiration": row["expiration"],
        "qty": int(row["qty"]),
        "entryPrice": float(row["entry_price"]),
        "exitPrice": None if row["exit_price"] is None else float(row["exit_price"]),
    }


def _fetch_legs(
    conn: sqlite3.Connection, strategy_id: str,
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM j2_option_legs WHERE strategy_id = ? "
        "ORDER BY leg_index ASC",
        (strategy_id,),
    ).fetchall()
    return [_row_to_leg(r) for r in rows]


# ── CRUD ────────────────────────────────────────────────────────────────────


def list_strategies(
    user_id: str,
    *,
    account_id: str | None = None,
    status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    spec: FilterSpec | None = None,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """All strategies for a user. Optional filters.

    Scope (Task A4): a passed ``spec`` filters strategies by SYMBOL only, matched
    against the ``underlying`` column (case-insensitive prefix) via the A3
    calendar precedent (``_strategy_scope_where``). Side/setups/tags have no
    option-strategy analog and are deliberately ignored. Unlike the calendar,
    /options is a date-ranged list, so the Scope DATE facet DOES apply: when
    ``spec`` supplies date_from/date_to they act as the existing entry_date range
    filter (NOT stripped); an explicit date_from/date_to kwarg still wins for a
    non-Scope caller. Absent ``spec`` → behavior identical to before.
    """
    if status is not None and status not in VALID_STATUSES:
        raise OptionValidationError(f"invalid status filter: {status}")
    if spec is not None:
        # Scope date facet applies to /options (date-ranged list). Synthesize the
        # entry_date range from the spec unless the caller passed explicit dates.
        if date_from is None:
            date_from = spec.date_from
        if date_to is None:
            date_to = spec.date_to
    owned = conn is None
    conn = conn or get_connection()
    try:
        sql = "SELECT * FROM j2_option_strategies WHERE user_id = ?"
        params: list[Any] = [user_id]
        if account_id:
            sql += " AND account_id = ?"
            params.append(account_id)
        if status:
            sql += " AND status = ?"
            params.append(status)
        if date_from:
            sql += " AND entry_date >= ?"
            params.append(date_from)
        if date_to:
            sql += " AND entry_date <= ?"
            params.append(date_to + "T23:59:59Z")
        if spec is not None:
            # Symbol-only Scope facet on the underlying (mirrors A3's
            # _strategy_scope_where). Imported lazily to avoid any import cycle
            # (calendar imports options lazily in get_day_detail).
            from api.services.journal_two.calendar import _strategy_scope_where
            scope_frag, scope_params = _strategy_scope_where(spec)
            if scope_frag:
                sql += " " + scope_frag
                params.extend(scope_params)
        sql += " ORDER BY entry_date DESC, created_at DESC"
        rows = conn.execute(sql, params).fetchall()
        out = []
        for r in rows:
            legs = _fetch_legs(conn, r["id"])
            out.append(_row_to_strategy(r, legs))
        return out
    finally:
        if owned:
            conn.close()


def get_strategy(
    user_id: str,
    strategy_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_option_strategies WHERE id = ? AND user_id = ?",
            (strategy_id, user_id),
        ).fetchone()
        if row is None:
            return None
        legs = _fetch_legs(conn, strategy_id)
        return _row_to_strategy(row, legs)
    finally:
        if owned:
            conn.close()


def create_strategy(
    user_id: str,
    payload: dict[str, Any],
    *,
    account_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Insert a new open strategy + its legs atomically."""
    validated = _validate_create_payload(payload)
    acc_id = account_id or payload.get("accountId") or payload.get("account_id")
    net_entry = compute_net_entry(validated["legs"])

    owned = conn is None
    conn = conn or get_connection()
    try:
        conn.execute("BEGIN")
        try:
            now = _now_iso()
            strategy_id = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO j2_option_strategies (
                    id, user_id, account_id, underlying, strategy_type,
                    direction, net_entry, fees, entry_date, setup, notes,
                    context_at_entry, status, linked_playbook_id,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
                """,
                (
                    strategy_id, user_id, acc_id, validated["underlying"],
                    validated["strategy_type"], validated["direction"],
                    net_entry, validated["fees"], validated["entry_date"],
                    validated["setup"], validated["notes"],
                    "{}", validated["linked_playbook_id"],
                    now, now,
                ),
            )
            for idx, leg in enumerate(validated["legs"]):
                conn.execute(
                    """
                    INSERT INTO j2_option_legs (
                        id, strategy_id, leg_index, side, contract_type,
                        strike, expiration, qty, entry_price
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()), strategy_id, idx,
                        leg["side"], leg["contract_type"],
                        leg["strike"], leg["expiration"],
                        leg["qty"], leg["entry_price"],
                    ),
                )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        return get_strategy(user_id, strategy_id, conn=conn)
    finally:
        if owned:
            conn.close()


def update_strategy(
    user_id: str,
    strategy_id: str,
    patch: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Update metadata — notes, setup, direction, linked_playbook_id.
    Legs are IMMUTABLE; must be replaced via delete + re-create."""
    if not isinstance(patch, dict):
        raise OptionValidationError("patch must be an object")

    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = conn.execute(
            "SELECT id FROM j2_option_strategies WHERE id = ? AND user_id = ?",
            (strategy_id, user_id),
        ).fetchone()
        if existing is None:
            return None

        sets: list[str] = []
        params: list[Any] = []
        if "notes" in patch:
            v = patch["notes"]
            if v is not None and not isinstance(v, str):
                raise OptionValidationError("notes must be string or null")
            sets.append("notes = ?"); params.append(v)
        if "setup" in patch:
            v = patch["setup"]
            if v is not None and not isinstance(v, str):
                raise OptionValidationError("setup must be string or null")
            sets.append("setup = ?"); params.append(v)
        if "direction" in patch:
            v = patch["direction"]
            if v not in VALID_DIRECTIONS:
                raise OptionValidationError(f"invalid direction: {v}")
            sets.append("direction = ?"); params.append(v)
        if "linkedPlaybookId" in patch or "linked_playbook_id" in patch:
            v = patch.get("linkedPlaybookId", patch.get("linked_playbook_id"))
            if isinstance(v, str) and not v.strip():
                v = None
            sets.append("linked_playbook_id = ?"); params.append(v)

        if not sets:
            return get_strategy(user_id, strategy_id, conn=conn)

        sets.append("updated_at = ?"); params.append(_now_iso())
        params.extend([strategy_id, user_id])
        conn.execute(
            f"UPDATE j2_option_strategies SET {', '.join(sets)} "
            f"WHERE id = ? AND user_id = ?",
            params,
        )
        conn.commit()
        return get_strategy(user_id, strategy_id, conn=conn)
    finally:
        if owned:
            conn.close()


def delete_strategy(
    user_id: str,
    strategy_id: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Delete only when status='open'. Closed strategies are historical record.

    Atomic: conditional DELETE on status='open' prevents the read-then-delete
    race where a concurrent close would otherwise let us delete closed rows.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        # First check existence + status — we want to distinguish
        # "not found" (404) from "exists but closed" (400).
        row = conn.execute(
            "SELECT status FROM j2_option_strategies "
            "WHERE id = ? AND user_id = ?",
            (strategy_id, user_id),
        ).fetchone()
        if row is None:
            return False
        if row["status"] != "open":
            raise OptionValidationError(
                "can only delete open strategies; closed ones are historical"
            )
        # Conditional delete re-checks status at write time; if a concurrent
        # close flipped it to 'closed' between our read and this write,
        # rowcount will be 0 and we return False.
        cur = conn.execute(
            "DELETE FROM j2_option_strategies "
            "WHERE id = ? AND user_id = ? AND status = 'open'",
            (strategy_id, user_id),
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()


# ── Close / expire ──────────────────────────────────────────────────────────


def close_strategy(
    user_id: str,
    strategy_id: str,
    payload: dict[str, Any],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Close with per-leg exit prices. Computes P&L + R, sets status."""
    if not isinstance(payload, dict):
        raise OptionValidationError("payload must be an object")

    # Support both camelCase + snake_case. Use explicit None check so
    # an empty dict (legitimate for mark_expired with status='expired')
    # doesn't fall through the `or` chain.
    exit_prices = payload.get("exitPrices")
    if exit_prices is None:
        exit_prices = payload.get("exit_prices")
    if not isinstance(exit_prices, dict):
        raise OptionValidationError("exitPrices must be an object keyed by leg_index")

    exit_date = payload.get("exitDate") or payload.get("exit_date")
    if not isinstance(exit_date, str):
        raise OptionValidationError("exitDate is required")
    try:
        if "T" in exit_date:
            exit_dt = datetime.fromisoformat(exit_date.replace("Z", "+00:00"))
        else:
            # Date-only: anchor at noon ET so `to_et_date` (for calendar
            # bucketing) reliably places the strategy on the user-typed
            # day regardless of DST. Midnight UTC would bucket to the
            # prior day in ET (UTC-4/-5).
            from api.services.journal_two.calendar import ET as _ET
            local = datetime.fromisoformat(exit_date + "T12:00:00").replace(tzinfo=_ET)
            exit_dt = local.astimezone(timezone.utc)
    except ValueError as e:
        raise OptionValidationError(f"exitDate invalid: {e}")

    status = payload.get("status", "closed")
    if status not in ("closed", "expired", "assigned", "rolled"):
        raise OptionValidationError(
            "status must be closed|expired|assigned|rolled"
        )

    exit_fees_raw = payload.get("exitFees") or payload.get("exit_fees", 0)
    if exit_fees_raw is None or exit_fees_raw == "":
        exit_fees = 0.0
    elif isinstance(exit_fees_raw, (int, float)) and exit_fees_raw >= 0:
        exit_fees = float(exit_fees_raw)
    else:
        raise OptionValidationError("exitFees must be >= 0")

    notes_append = payload.get("notes")

    owned = conn is None
    conn = conn or get_connection()
    try:
        strategy_row = conn.execute(
            "SELECT * FROM j2_option_strategies WHERE id = ? AND user_id = ?",
            (strategy_id, user_id),
        ).fetchone()
        if strategy_row is None:
            return None
        if strategy_row["status"] != "open":
            raise OptionValidationError("strategy is not open")

        legs = conn.execute(
            "SELECT * FROM j2_option_legs WHERE strategy_id = ? "
            "ORDER BY leg_index ASC",
            (strategy_id,),
        ).fetchall()

        # Validate each leg has an exit_price (keyed by leg_index as string)
        leg_updates = []
        for leg in legs:
            idx_key = str(leg["leg_index"])
            if idx_key in exit_prices:
                raw = exit_prices[idx_key]
            elif leg["leg_index"] in exit_prices:
                raw = exit_prices[leg["leg_index"]]
            else:
                if status == "expired":
                    raw = 0  # expired legs default to worthless
                else:
                    raise OptionValidationError(
                        f"missing exitPrice for leg {leg['leg_index']}"
                    )
            if not isinstance(raw, (int, float)) or raw < 0:
                raise OptionValidationError(
                    f"exitPrice for leg {leg['leg_index']} must be >= 0"
                )
            leg_updates.append((float(raw), leg["id"]))

        # Compute aggregates
        legs_w_exit = [
            {**_row_to_leg(leg), "exit_price": ex}
            for leg, (ex, _) in zip(legs, leg_updates)
        ]
        # _row_to_leg uses camelCase; normalize for compute functions.
        # Include strike + contract_type + expiration because max_risk
        # formulas for spreads/condors read them.
        legs_calc = [
            {
                "side": l["side"],
                "contract_type": l["contractType"],
                "strike": l["strike"],
                "expiration": l["expiration"],
                "qty": l["qty"],
                "entry_price": l["entryPrice"],
                "exit_price": l["exit_price"],
            }
            for l in legs_w_exit
        ]
        net_entry = float(strategy_row["net_entry"])
        net_exit = compute_net_exit(legs_calc)
        fees = float(strategy_row["fees"])
        pnl = compute_pnl(net_entry, net_exit, fees, exit_fees)

        # P&L percent vs. net_entry (absolute) as risk denom — fallback to 1 for divide-safety
        pnl_pct = pnl / abs(net_entry) if abs(net_entry) > 1e-9 else 0.0

        # R-multiple vs max_risk
        max_risk = compute_max_risk(
            strategy_row["strategy_type"], legs_calc, net_entry,
        )
        if max_risk is not None and max_risk > 0:
            r_multiple = pnl / max_risk
        else:
            r_multiple = None

        # Result classification — Win if net positive pnl; Loss if negative; BE if ≈0
        if pnl > 0.01:
            result = "Win"
        elif pnl < -0.01:
            result = "Loss"
        else:
            result = "BE"

        # Merge notes if provided
        existing_notes = strategy_row["notes"] or ""
        new_notes = existing_notes
        if isinstance(notes_append, str) and notes_append.strip():
            sep = "\n\n---\n" if existing_notes else ""
            new_notes = f"{existing_notes}{sep}Close: {notes_append.strip()}"

        conn.execute("BEGIN")
        try:
            for exit_price, leg_id in leg_updates:
                conn.execute(
                    "UPDATE j2_option_legs SET exit_price = ? WHERE id = ?",
                    (exit_price, leg_id),
                )
            now = _now_iso()
            closed_at_iso = exit_dt.astimezone(timezone.utc).isoformat()
            conn.execute(
                """
                UPDATE j2_option_strategies
                   SET status = ?, closed_at = ?, net_exit = ?,
                       exit_fees = ?, pnl_dollar = ?, pnl_percent = ?,
                       r_multiple = ?, result = ?, notes = ?,
                       updated_at = ?, trading_day_et = ?
                 WHERE id = ? AND user_id = ?
                """,
                (
                    status, closed_at_iso,
                    net_exit, exit_fees, pnl, pnl_pct,
                    r_multiple, result, new_notes, now,
                    compute_trading_day_et(closed_at_iso),
                    strategy_id, user_id,
                ),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise

        return get_strategy(user_id, strategy_id, conn=conn)
    finally:
        if owned:
            conn.close()


def mark_expired(
    user_id: str,
    strategy_id: str,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """One-click expire: all legs' exit_price = 0, status='expired'.

    Uses the last leg expiration as `closed_at` so calendar bucketing
    reflects when the strategy actually expired, not when the user
    remembered to mark it.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        legs_rows = conn.execute(
            "SELECT l.expiration FROM j2_option_legs l "
            "JOIN j2_option_strategies s ON s.id = l.strategy_id "
            "WHERE l.strategy_id = ? AND s.user_id = ?",
            (strategy_id, user_id),
        ).fetchall()
        if not legs_rows:
            # No legs or strategy not owned: defer to close_strategy to
            # produce the right not-found / validation error.
            exit_date = _now_iso()
        else:
            # Max expiration across legs — for a single expiry all legs
            # share it; for calendars/diagonals this is the later leg.
            # Pass just the date string; close_strategy anchors at ET noon
            # so calendar bucketing lands on the correct day.
            exit_date = max(r["expiration"] for r in legs_rows)

        return close_strategy(
            user_id,
            strategy_id,
            {
                "exitPrices": {},          # zero defaults when status='expired'
                "exitDate": exit_date,
                "status": "expired",
                "exitFees": 0,
            },
            conn=conn,
        )
    finally:
        if owned:
            conn.close()


def mark_expired_batch(
    user_id: str,
    strategy_ids: list[str],
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Batch expire — used by the banner one-click flow."""
    if not isinstance(strategy_ids, list):
        raise OptionValidationError("strategy_ids must be a list")
    owned = conn is None
    conn = conn or get_connection()
    try:
        marked = 0
        skipped = []
        for sid in strategy_ids:
            try:
                result = mark_expired(user_id, sid, conn=conn)
                if result is None:
                    skipped.append({"id": sid, "reason": "not found"})
                else:
                    marked += 1
            except OptionValidationError as e:
                skipped.append({"id": sid, "reason": str(e)})
        return {"marked": marked, "skipped": skipped}
    finally:
        if owned:
            conn.close()
