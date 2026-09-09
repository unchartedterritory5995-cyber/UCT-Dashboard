"""Phase 2a — the joystick hub's planned-trades store.

A planned trade is what the hub records when a member plans an entry from a section: a
symbol, an entry, a stop, a size. It is **not** a journal entry and not a position — it may
become a `j2_positions` row in Phase 3, and keeping it in its own table is what lets
"planned" and "actually journalled" stay separable.

⛔ NOTHING IN THE CLIENT WRITES HERE YET. Phase 2a is the backend and its rails only.

⭐ `r_value` IS DERIVED FROM THE JOURNAL'S OWN CALC MODULE, NOT REIMPLEMENTED. There is
exactly one place in this app that knows how a trade's risk is computed, and a second copy
would drift the first time either moved — the defect class this codebase keeps re-finding.
See `_one_r_dollars` for how a *planned* trade (which has no exit price) is expressed in
terms of `calculations.trade_pnl_dollar`.
"""

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.auth_db import get_connection
from api.services.journal_two.calculations import trade_pnl_dollar

#: Newest-first read cap. A hub surface shows a handful; 200 is generous and bounded.
LIST_LIMIT = 200


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def side_of(entry: float, stop: float) -> str:
    """`'Long'` when the stop sits below the entry, else `'Short'`.

    ⭐ DERIVED, NOT STORED. A planned trade with a stop below its entry is long by
    definition; storing a side as well would let the two disagree, and then a row would
    exist that says "Long" with a stop above the entry and nothing could say which field
    was wrong. It is also why `stop != entry` is a validation error rather than a warning:
    at `stop == entry` the side is genuinely undefined, and so is the risk.
    """
    return "Long" if stop < entry else "Short"


def _one_r_dollars(entry: float, stop: float, size: float) -> Optional[float]:
    """The dollar value of 1R for this plan — the risk taken if the stop fills.

    ⛔ EXPRESSED THROUGH `calculations.trade_pnl_dollar`, DELIBERATELY. The obvious
    implementation is `abs(entry - stop) * size`, and that would be a second authority over
    how this app computes trade money. A planned trade has no exit, so the stop IS the exit
    being modelled: P&L at the stop is exactly −1R, and the magnitude of that is 1R.

    Returns None when entry == stop (risk undefined), matching `trade_r_multiple`'s own
    contract for the same degenerate case.
    """
    if entry == stop:
        return None
    return abs(trade_pnl_dollar(side_of(entry, stop), entry, stop, size))


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "symbol": row["symbol"],
        "entry": row["entry"],
        "stop": row["stop"],
        "size": row["size"],
        "r_value": row["r_value"],
        "source_mode": row["source_mode"],
        "status": row["status"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def create(
    user_id: str,
    symbol: str,
    entry: float,
    stop: float,
    size: float,
    source_mode: Optional[str] = None,
    conn: Optional[sqlite3.Connection] = None,
) -> dict[str, Any]:
    """Insert one planned trade and return it. Caller validates; this stores."""
    close = False
    if conn is None:
        conn = get_connection()
        close = True
    try:
        now = _now()
        row_id = str(uuid.uuid4())
        conn.execute(
            "INSERT INTO hub_planned_trades "
            "(id, user_id, symbol, entry, stop, size, r_value, source_mode, status, "
            " created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?, ?)",
            (row_id, user_id, symbol, entry, stop, size,
             _one_r_dollars(entry, stop, size), source_mode, now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM hub_planned_trades WHERE id = ?", (row_id,)
        ).fetchone()
        return _row_to_dict(row)
    finally:
        if close:
            conn.close()


def list_for_user(
    user_id: str,
    limit: int = LIST_LIMIT,
    conn: Optional[sqlite3.Connection] = None,
) -> list[dict[str, Any]]:
    """This user's planned trades, newest first.

    ⭐ Discarded rows are STILL LISTED. Discarding is a state, not a delete — a member who
    plans five trades and takes one has learned something from the four they did not take,
    and hiding them would throw that away.
    """
    close = False
    if conn is None:
        conn = get_connection()
        close = True
    try:
        rows = conn.execute(
            "SELECT * FROM hub_planned_trades WHERE user_id = ? "
            "ORDER BY created_at DESC, id DESC LIMIT ?",
            (user_id, min(int(limit), LIST_LIMIT)),
        ).fetchall()
        return [_row_to_dict(r) for r in rows]
    finally:
        if close:
            conn.close()


def discard(
    user_id: str,
    trade_id: str,
    conn: Optional[sqlite3.Connection] = None,
) -> Optional[dict[str, Any]]:
    """Flip one of THIS user's rows to `discarded`. None when it is not theirs.

    ⛔ THE `user_id` IS IN THE WHERE CLAUSE, not checked after the fact. A row belonging to
    someone else and a row that does not exist must be indistinguishable to the caller —
    returning 403 for one and 404 for the other tells an attacker which ids are real.
    """
    close = False
    if conn is None:
        conn = get_connection()
        close = True
    try:
        cur = conn.execute(
            "UPDATE hub_planned_trades SET status = 'discarded', updated_at = ? "
            "WHERE id = ? AND user_id = ?",
            (_now(), trade_id, user_id),
        )
        conn.commit()
        if cur.rowcount == 0:
            return None
        row = conn.execute(
            "SELECT * FROM hub_planned_trades WHERE id = ?", (trade_id,)
        ).fetchone()
        return _row_to_dict(row)
    finally:
        if close:
            conn.close()
