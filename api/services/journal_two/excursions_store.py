"""Per-closed-trade excursion metrics — persistence for the j2_trade_excursions
side table (Journal A+ Phase 2, Task 2).

Excursions (MFE/MAE, exit efficiency, missed R) are computed by
`excursion_calc.compute_excursion` and persisted here keyed on the STABLE
`trade_ref` (`ext:<external_id>` for broker rows, `id:<row id>` for manual — see
trade_refs.py), NOT the raw external_id (NULL for every manual trade). This
mirrors P1b's j2_trade_attachments keying so a stored excursion survives the
broker purge+reinsert cycle that reissues j2_trades uuids on every full resync.

CRUD idiom mirrors trade_attachments.py: the module owns its connection via
`auth_db.get_connection`; the optional `conn` param lets callers (the analytics
join, the backfill, tests) pass a live connection — we open/close only when
`conn is None`. Composite PK (user_id, trade_ref) makes INSERT OR REPLACE
naturally idempotent.
"""
from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    """camelCase view of an excursions row for the frontend + analytics join."""
    return {
        "symbol": row["symbol"],
        "mfePrice": row["mfe_price"],
        "maePrice": row["mae_price"],
        "mfeR": row["mfe_r"],
        "maeR": row["mae_r"],
        "mfeTs": row["mfe_ts"],
        "maeTs": row["mae_ts"],
        "exitEfficiency": row["exit_efficiency"],
        "missedR": row["missed_r"],
        "trueR": row["true_r"] if "true_r" in row.keys() else None,
        "barResolution": row["bar_resolution"],
        "dataQuality": row["data_quality"],
        "computedAt": row["computed_at"],
    }


def upsert_excursion(
    user_id: str, trade_ref: str, data: dict, conn: sqlite3.Connection | None = None,
) -> None:
    """INSERT OR REPLACE one excursion row. Pulls metrics from `data` via
    `.get(...)` so an insufficient-tier record (mostly-None metrics,
    data_quality='insufficient') stores cleanly. Stamps computed_at."""
    own = conn is None
    if own:
        conn = get_connection()
    try:
        conn.execute(
            "INSERT OR REPLACE INTO j2_trade_excursions "
            "(user_id, trade_ref, symbol, mfe_price, mae_price, mfe_r, mae_r, "
            "mfe_ts, mae_ts, exit_efficiency, missed_r, true_r, bar_resolution, "
            "data_quality, computed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                user_id,
                trade_ref,
                data.get("symbol"),
                data.get("mfe_price"),
                data.get("mae_price"),
                data.get("mfe_r"),
                data.get("mae_r"),
                data.get("mfe_ts"),
                data.get("mae_ts"),
                data.get("exit_efficiency"),
                data.get("missed_r"),
                data.get("true_r"),
                data.get("bar_resolution"),
                data.get("data_quality"),
                _now_iso(),
            ),
        )
        conn.commit()
    finally:
        if own:
            conn.close()


def get_excursion(
    user_id: str, trade_ref: str, conn: sqlite3.Connection | None = None,
) -> dict | None:
    """Return the camelCase excursion dict for one (user, trade_ref), or None."""
    own = conn is None
    if own:
        conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_trade_excursions WHERE user_id = ? AND trade_ref = ?",
            (user_id, trade_ref),
        ).fetchone()
        return _row_to_dict(row) if row is not None else None
    finally:
        if own:
            conn.close()


def list_excursions_for_user(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> dict[str, dict]:
    """trade_ref → camelCase excursion dict, for the analytics join."""
    own = conn is None
    if own:
        conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT * FROM j2_trade_excursions WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {r["trade_ref"]: _row_to_dict(r) for r in rows}
    finally:
        if own:
            conn.close()


def existing_refs(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> set[str]:
    """Set of trade_refs already computed — the backfill's idempotency skip."""
    own = conn is None
    if own:
        conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT trade_ref FROM j2_trade_excursions WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {r["trade_ref"] for r in rows}
    finally:
        if own:
            conn.close()


def backfill_true_r(conn: sqlite3.Connection | None = None) -> int:
    """One-shot (idempotent) True-R backfill for rows computed before the
    column existed. true_r is DERIVABLE from the stored mae_price plus the
    trade row's side/entry/exit — pure SQL, no bars refetch. Rows with no
    matching trade (option-strategy 'underlying' records, purged trades) or
    a zero adverse move stay NULL by design. Returns rows updated."""
    own = conn is None
    if own:
        conn = get_connection()
    try:
        cur = conn.execute(
            """
            UPDATE j2_trade_excursions
               SET true_r = (
                   SELECT CASE
                       WHEN t.side = 'Long'
                            AND (t.entry_price - j2_trade_excursions.mae_price) > 1e-9
                       THEN (t.exit_price - t.entry_price)
                            / (t.entry_price - j2_trade_excursions.mae_price)
                       WHEN t.side = 'Short'
                            AND (j2_trade_excursions.mae_price - t.entry_price) > 1e-9
                       THEN (t.entry_price - t.exit_price)
                            / (j2_trade_excursions.mae_price - t.entry_price)
                       ELSE NULL
                   END
                     FROM j2_trades t
                    WHERE t.user_id = j2_trade_excursions.user_id
                      AND (('ext:' || COALESCE(t.external_id, '')) = j2_trade_excursions.trade_ref
                           OR ('id:' || t.id) = j2_trade_excursions.trade_ref)
                    LIMIT 1
               )
             WHERE true_r IS NULL AND mae_price IS NOT NULL
            """
        )
        conn.commit()
        return cur.rowcount
    finally:
        if own:
            conn.close()
