"""Assemble a broker account's equity series + external-flow series and run the
pure performance engine over them.

Equity series = real daily net-liq snapshots (accurate) going forward; for the
pre-snapshot past, an *estimated* curve walked back from the earliest snapshot
using external flows + realized trade P&L (each such point flagged estimated).
"""

from __future__ import annotations

import logging
import os
import sqlite3
from datetime import datetime, timedelta, timezone

from api.services.auth_db import get_connection
from api.services.journal_two.broker import performance, cashflow_store

logger = logging.getLogger(__name__)


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

        # OPTIONAL exact daily mark-to-market reconstruction (stocks+options+cash
        # marked to historical prices). OFF by default: historical pricing is
        # fragile per-user (delistings, splits, fetch gaps → spikes / negatives).
        # The trustworthy default below is the broker's OWN reported daily total.
        if os.environ.get("BROKER_RECON_HISTORY") == "1":
            try:
                from api.services.journal_two import accounts as _accounts
                from api.services.journal_two.broker import historical_equity
                acct = _accounts.get_account(user_id, account_id, conn=conn)
                live_eq = (float(acct["brokerTotalEquity"])
                           if acct and acct.get("brokerTotalEquity") is not None else None)
                recon = historical_equity.reconstruct_daily_equity(
                    user_id, account_id, live_equity=live_eq, conn=conn) or []
            except Exception:
                logger.exception("[broker] reconstruction failed; using snapshots")
                recon = []
            if recon:
                equity = [(p["date"], p["equity"]) for p in recon
                          if (start is None or p["date"] >= start)]
                external = cashflow_store.external_flow_series(user_id, account_id, start=start, conn=conn)
                by_type = cashflow_store.sum_by_type(user_id, account_id, start=start, conn=conn)
                internal = {"dividends": by_type.get("dividend", 0.0),
                            "interest": by_type.get("interest", 0.0),
                            "fees": by_type.get("fee", 0.0)}
                result = performance.compute_performance(equity, external, internal)
                result["equitySeries"] = [{"date": d, "value": v, "estimated": False} for d, v in equity]
                result["flows"] = cashflow_store.list_flows(user_id, account_id, start=start, conn=conn)
                result["estimated"] = False
                result["period"] = (period or "ALL").upper()
                return result

        # DEFAULT: the broker's OWN reported daily net-liq, snapshotted each sync.
        # Exact (it's the broker's number), automatic for every user, no historical
        # price/reconstruction dependency. Builds forward from connection.
        snaps = []
        if broker_account_id:
            snaps = conn.execute(
                "SELECT snapshot_date, total_equity FROM j2_broker_equity_snapshots "
                "WHERE user_id = ? AND broker_account_id = ? ORDER BY snapshot_date ASC",
                (user_id, broker_account_id),
            ).fetchall()
        equity = [(r["snapshot_date"], float(r["total_equity"])) for r in snaps
                  if (start is None or r["snapshot_date"] >= start)]

        # Live right-edge: today's broker total if newer than the last snapshot.
        try:
            from api.services.journal_two import accounts as _accounts
            from api.services.journal_two.broker.historical_equity import _et_today
            acct = _accounts.get_account(user_id, account_id, conn=conn)
            if acct and acct.get("brokerTotalEquity") is not None:
                today = _et_today()
                live = round(float(acct["brokerTotalEquity"]), 2)
                if start is None or today >= start:
                    if equity and equity[-1][0] >= today:
                        equity[-1] = (equity[-1][0], live)
                    else:
                        equity.append((today, live))
        except Exception:
            pass

        external = cashflow_store.external_flow_series(user_id, account_id, start=start, conn=conn)
        by_type = cashflow_store.sum_by_type(user_id, account_id, start=start, conn=conn)
        internal = {
            "dividends": by_type.get("dividend", 0.0),
            "interest": by_type.get("interest", 0.0),
            "fees": by_type.get("fee", 0.0),
        }
        result = performance.compute_performance(equity, external, internal)
        result["equitySeries"] = [{"date": d, "value": v, "estimated": False} for d, v in equity]
        result["flows"] = cashflow_store.list_flows(user_id, account_id, start=start, conn=conn)
        result["estimated"] = False
        result["period"] = (period or "ALL").upper()
        return result
    finally:
        if owned:
            conn.close()
