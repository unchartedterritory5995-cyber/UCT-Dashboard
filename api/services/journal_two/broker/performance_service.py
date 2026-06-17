"""Assemble a broker account's equity series + external-flow series and run the
pure performance engine over them.

Equity series = real daily net-liq snapshots (accurate) going forward; for the
pre-snapshot past, an *estimated* curve walked back from the earliest snapshot
using external flows + realized trade P&L (each such point flagged estimated).
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from api.services.auth_db import get_connection
from api.services.journal_two.broker import performance, cashflow_store


def _period_start(period: str | None) -> str | None:
    """ISO date the window starts at, or None for ALL."""
    period = (period or "ALL").upper()
    if period == "ALL":
        return None
    today = datetime.now(timezone.utc).date()
    if period == "YTD":
        return f"{today.year}-01-01"
    days = {"1W": 7, "1M": 30, "3M": 91, "1Y": 365}.get(period)
    if days is None:
        return None
    return (today - timedelta(days=days)).isoformat()


def account_performance(user_id: str, account_id: str, period: str = "ALL",
                        conn: sqlite3.Connection | None = None) -> dict:
    owned = conn is None
    conn = conn or get_connection()
    try:
        ba = conn.execute(
            "SELECT id FROM j2_broker_accounts WHERE user_id = ? AND j2_account_id = ? "
            "ORDER BY created_at ASC LIMIT 1",
            (user_id, account_id),
        ).fetchone()
        broker_account_id = ba["id"] if ba else None
        start = _period_start(period)

        snaps = []
        if broker_account_id:
            snaps = conn.execute(
                "SELECT snapshot_date, total_equity FROM j2_broker_equity_snapshots "
                "WHERE user_id = ? AND broker_account_id = ? ORDER BY snapshot_date ASC",
                (user_id, broker_account_id),
            ).fetchall()
        earliest_snap = snaps[0]["snapshot_date"] if snaps else None
        first_snap_val = float(snaps[0]["total_equity"]) if snaps else None

        # Forward (accurate) points within the window.
        fwd = [(r["snapshot_date"], float(r["total_equity"])) for r in snaps
               if (start is None or r["snapshot_date"] >= start)]

        # Estimated prefix: dates before the earliest snapshot (within the window)
        # carrying a flow or a realized trade. equity_est(t) = first_snap
        # − externalFlows(date >= t) − realizedPnl(date >= t). Approximate (no
        # historical marks) → each point flagged estimated.
        est: list[tuple[str, float]] = []
        if earliest_snap is not None:
            all_ext = cashflow_store.external_flow_series(user_id, account_id, conn=conn)
            pnl_rows = conn.execute(
                "SELECT exit_date AS d, COALESCE(SUM(pnl_dollar), 0) AS p FROM j2_trades "
                "WHERE user_id = ? AND account_id = ? AND exit_date IS NOT NULL "
                "GROUP BY exit_date",
                (user_id, account_id),
            ).fetchall()
            pnl_by_date = {r["d"][:10]: float(r["p"]) for r in pnl_rows if r["d"]}

            def _in_window(d: str) -> bool:
                return d < earliest_snap and (start is None or d >= start)

            cand = sorted({d for d, _ in all_ext if _in_window(d)}
                          | {d for d in pnl_by_date if _in_window(d)})
            for t in cand:
                ext_after = sum(a for d, a in all_ext if d >= t)
                pnl_after = sum(p for d, p in pnl_by_date.items() if d >= t)
                est.append((t, round(first_snap_val - ext_after - pnl_after, 2)))

        equity = est + fwd
        external = cashflow_store.external_flow_series(user_id, account_id, start=start, conn=conn)
        by_type = cashflow_store.sum_by_type(user_id, account_id, start=start, conn=conn)
        internal = {
            "dividends": by_type.get("dividend", 0.0),
            "interest": by_type.get("interest", 0.0),
            "fees": by_type.get("fee", 0.0),
        }
        result = performance.compute_performance(equity, external, internal)
        result["equitySeries"] = [
            {"date": d, "value": v,
             "estimated": (earliest_snap is not None and d < earliest_snap)}
            for d, v in equity
        ]
        result["flows"] = cashflow_store.list_flows(user_id, account_id, start=start, conn=conn)
        result["estimated"] = any(p["estimated"] for p in result["equitySeries"])
        result["period"] = (period or "ALL").upper()
        return result
    finally:
        if owned:
            conn.close()
