"""Backfill j2_broker_equity_snapshots from the daily mark-to-market replay.

Disconnecting a broker DESTROYS the derived ledgers for the whole user
(`connections.delete_broker_user` — snapshots + cash flows are keyed on
broker_account_id, which a reconnect re-mints), so after a reconnect the hero's
1W/1M/3M/YTD/ALL ranges have a single point. The activity ledger, however, is
re-imported in FULL — and `historical_equity.reconstruct_daily_equity` already
turns it into a daily net-liq series anchored to current broker truth (the
same replay `performance-debug` serves; ~1,500 points for a 2020-era account).

This module writes that series into the snapshot table so the range tabs work
again. Strictly ADDITIVE and never authoritative:

- `INSERT OR IGNORE` — a real sync-written snapshot for a date always wins,
  today and forever (the nightly sync keeps writing real rows on top going
  forward; they land first and the backfill can never replace them).
- Today's date is never backfilled (the live sync owns it).
- Non-finite / non-positive replay values are skipped — the replay is
  documented as fragile per-user (delisting/split gaps → spikes/negatives);
  an estimated history with a hole beats a confident wrong point.
"""
from __future__ import annotations

import math
import sqlite3
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two.broker import historical_equity as _he


def backfill_equity_snapshots(user_id: str, account_id: str,
                              conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Fill missing snapshot dates for one j2 account from the replay.
    Returns {computed, written, skipped_existing, skipped_insane}."""
    bkid = _he._resolve_broker_account_id(user_id, account_id, conn=conn)
    if not bkid:
        return {"computed": 0, "written": 0, "error": "no broker account mapped"}

    series = _he.reconstruct_daily_equity(user_id, account_id, conn=conn)
    if not series:
        return {"computed": 0, "written": 0, "error": "empty replay"}

    today = _he._et_today()
    owned = conn is None
    conn = conn or get_connection()
    written = skipped_existing = skipped_insane = 0
    try:
        conn.execute("BEGIN")
        for point in series:
            d = str(point.get("date") or "")[:10]
            eq = point.get("equity")
            if not d or d >= today:
                continue
            if not isinstance(eq, (int, float)) or not math.isfinite(eq) or eq <= 0:
                skipped_insane += 1
                continue
            cur = conn.execute(
                "INSERT OR IGNORE INTO j2_broker_equity_snapshots "
                "(user_id, broker_account_id, snapshot_date, total_equity, "
                " cash, market_value, synced_at) "
                "VALUES (?, ?, ?, ?, NULL, NULL, ?)",
                (user_id, bkid, d, round(float(eq), 2),
                 f"backfill:{today}"),
            )
            if cur.rowcount:
                written += 1
            else:
                skipped_existing += 1
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
    return {
        "computed": len(series),
        "written": written,
        "skippedExisting": skipped_existing,
        "skippedInsane": skipped_insane,
    }


def backfill_all_accounts(user_id: str) -> dict[str, Any]:
    """Backfill every broker-linked account for a user."""
    conn = get_connection()
    try:
        rows = conn.execute(
            "SELECT DISTINCT j2_account_id FROM j2_broker_accounts "
            "WHERE user_id = ? AND j2_account_id IS NOT NULL",
            (user_id,),
        ).fetchall()
    finally:
        conn.close()
    out: dict[str, Any] = {}
    for r in rows:
        acct = r["j2_account_id"]
        try:
            out[acct] = backfill_equity_snapshots(user_id, acct)
        except Exception as e:  # per-account isolation — one bad replay
            out[acct] = {"error": str(e)}   # must not block the rest
    return out
