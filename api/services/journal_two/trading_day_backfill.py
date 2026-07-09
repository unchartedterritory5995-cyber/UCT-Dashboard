"""One-shot, idempotent, batched backfill of trading_day_et/hour_et.

Runs ONLY via the admin endpoint — never at import or boot (auth.db also
serves logins). Batched commits keep writer locks short under WAL.
"""
from __future__ import annotations

import sqlite3

from api.services.auth_db import get_connection
from api.services.journal_two.calendar import to_et_date
from api.services.journal_two.timeutil import compute_hour_et, compute_trading_day_et


def run_backfill(conn: sqlite3.Connection | None = None, *,
                 batch_size: int = 500, force: bool = False) -> dict:
    own = conn is None
    if own:
        conn = get_connection()
    try:
        null_only = "" if force else " AND trading_day_et IS NULL"
        rows = conn.execute(
            "SELECT id, user_id, symbol, exit_date FROM j2_trades"
            f" WHERE exit_date IS NOT NULL{null_only}"
        ).fetchall()

        moved: list[dict] = []
        trades_updated = batches = 0
        for start in range(0, len(rows), batch_size):
            for r in rows[start:start + batch_size]:
                new_day = compute_trading_day_et(r["exit_date"])
                new_hour = compute_hour_et(r["exit_date"])
                try:
                    old_day = to_et_date(r["exit_date"])
                except ValueError:
                    old_day = None
                if new_day and old_day and new_day != old_day:
                    moved.append({"user_id": r["user_id"], "trade_id": r["id"],
                                  "symbol": r["symbol"], "old_day": old_day,
                                  "new_day": new_day})
                conn.execute(
                    "UPDATE j2_trades SET trading_day_et = ?, hour_et = ? WHERE id = ?",
                    (new_day, new_hour, r["id"]),
                )
                trades_updated += 1
            batches += 1
            conn.commit()  # short writer locks — auth.db also serves logins

        opt_rows = conn.execute(
            "SELECT id, closed_at FROM j2_option_strategies"
            f" WHERE closed_at IS NOT NULL{null_only}"
        ).fetchall()
        for r in opt_rows:
            conn.execute(
                "UPDATE j2_option_strategies SET trading_day_et = ? WHERE id = ?",
                (compute_trading_day_et(r["closed_at"]), r["id"]),
            )
        conn.commit()
        return {"trades_updated": trades_updated, "options_updated": len(opt_rows),
                "moved_days": moved[:2000], "batches": batches}
    finally:
        if own:
            conn.close()
