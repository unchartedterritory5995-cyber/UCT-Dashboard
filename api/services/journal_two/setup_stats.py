"""
Journal 2.0 — per-setup performance stats (Phase C).

Pure read against j2_trades. Returns a flat record showing the user's
historical performance on a given setup name within a single account.
Used by the SetupStatsPanel at trade-entry time as live coaching.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from api.services.auth_db import get_connection


_RESULT_LETTER = {"Win": "W", "Loss": "L", "BE": "B"}


def get_setup_stats(
    user_id: str,
    account_id: str,
    setup: str,
    *,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Aggregate stats for one (account, setup) pair."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT result, pnl_dollar, r_multiple, exit_date FROM j2_trades
             WHERE user_id = ? AND account_id = ? AND setup = ?
             ORDER BY exit_date ASC
            """,
            (user_id, account_id, setup),
        ).fetchall()

        if not rows:
            return _empty(setup)

        wins = sum(1 for r in rows if r["result"] == "Win")
        losses = sum(1 for r in rows if r["result"] == "Loss")
        bes = sum(1 for r in rows if r["result"] == "BE")
        decisive = wins + losses
        win_rate = (wins / decisive) if decisive > 0 else None

        rs = [float(r["r_multiple"]) for r in rows if r["r_multiple"] is not None]
        avg_r = (sum(rs) / len(rs)) if rs else None
        total_r = sum(rs) if rs else 0.0

        total_pnl = sum(float(r["pnl_dollar"] or 0) for r in rows)

        last_five = [_RESULT_LETTER.get(r["result"], "?") for r in rows[-5:]]

        return {
            "setup": setup,
            "tradeCount": len(rows),
            "winCount": wins,
            "lossCount": losses,
            "beCount": bes,
            "winRate": win_rate,
            "avgR": avg_r,
            "totalR": round(total_r, 4),
            "totalPnlDollar": round(total_pnl, 2),
            "lastFive": last_five,
        }
    finally:
        if owned:
            conn.close()


def _empty(setup: str) -> dict[str, Any]:
    return {
        "setup": setup,
        "tradeCount": 0,
        "winCount": 0,
        "lossCount": 0,
        "beCount": 0,
        "winRate": None,
        "avgR": None,
        "totalR": 0,
        "totalPnlDollar": 0,
        "lastFive": [],
    }
