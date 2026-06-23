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


def _ensure_renderable_series(series: list[dict], *, current_total, today: str) -> list[dict]:
    """Guarantee a >=2-point curve when a live balance exists, without writing
    synthetic snapshots. If <2 real points and we know the current net-liq,
    append a live 'now' anchor (flagged estimated). No-op when already >=2 or
    when there's genuinely no balance to anchor on."""
    if len(series) >= 2 or current_total is None:
        return series
    out = list(series)
    if not out:
        # No history at all — seed a starting endpoint from the live total so the
        # hero shows a flat baseline rather than nothing.
        out.append({"date": today, "value": float(current_total), "estimated": True})
    # Append a live "now" anchor so a single real snapshot still yields a
    # 2-point renderable series.
    out.append({"date": today, "value": float(current_total), "estimated": True})
    return out


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
                series = [{"date": d, "value": v, "estimated": False} for d, v in equity]
                try:
                    from api.services.journal_two.broker.historical_equity import _et_today
                    series = _ensure_renderable_series(
                        series, current_total=live_eq, today=_et_today())
                except Exception:
                    pass
                result["equitySeries"] = series
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
        live_total = None
        today = None
        try:
            from api.services.journal_two import accounts as _accounts
            from api.services.journal_two.broker.historical_equity import _et_today
            today = _et_today()
            acct = _accounts.get_account(user_id, account_id, conn=conn)
            if acct and acct.get("brokerTotalEquity") is not None:
                live = round(float(acct["brokerTotalEquity"]), 2)
                live_total = live
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
        series = [{"date": d, "value": v, "estimated": False} for d, v in equity]
        if today is not None:
            series = _ensure_renderable_series(series, current_total=live_total, today=today)
        result["equitySeries"] = series
        result["flows"] = cashflow_store.list_flows(user_id, account_id, start=start, conn=conn)
        result["estimated"] = False
        result["period"] = (period or "ALL").upper()
        return result
    finally:
        if owned:
            conn.close()


def portfolio_performance(user_id: str, period: str = "ALL",
                          conn: sqlite3.Connection | None = None) -> dict:
    """Accurate equity curve across ALL of the user's connected brokers: the
    SUM of each broker's OWN reported daily net-liq (j2_broker_equity_snapshots),
    per day, + a live right-edge = sum of current broker totals. Exact, no
    reconstruction, builds forward from first connect."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        start = _period_start(period)
        rows = conn.execute(
            "SELECT id, j2_account_id FROM j2_broker_accounts WHERE user_id = ?",
            (user_id,)).fetchall()
        bk_ids = [r["id"] for r in rows]
        j2_ids = [r["j2_account_id"] for r in rows]

        equity: list[tuple[str, float]] = []
        if bk_ids:
            ph = ",".join("?" * len(bk_ids))
            snaps = conn.execute(
                f"SELECT snapshot_date AS d, SUM(total_equity) AS eq "
                f"FROM j2_broker_equity_snapshots "
                f"WHERE user_id = ? AND broker_account_id IN ({ph}) "
                f"GROUP BY snapshot_date ORDER BY snapshot_date ASC",
                (user_id, *bk_ids)).fetchall()
            equity = [(r["d"], round(float(r["eq"]), 2)) for r in snaps
                      if (start is None or r["d"] >= start)]

        # Live right-edge: sum of current broker totals across all broker accounts.
        live_edge_total = None
        today = None
        try:
            from api.services.journal_two import accounts as _accounts
            from api.services.journal_two.broker.historical_equity import _et_today
            today = _et_today()
            live_total = 0.0
            have_live = False
            for j2 in j2_ids:
                a = _accounts.get_account(user_id, j2, conn=conn)
                if a and a.get("brokerTotalEquity") is not None:
                    live_total += float(a["brokerTotalEquity"])
                    have_live = True
            if have_live:
                live = round(live_total, 2)
                live_edge_total = live
                if start is None or today >= start:
                    if equity and equity[-1][0] >= today:
                        equity[-1] = (equity[-1][0], live)
                    else:
                        equity.append((today, live))
        except Exception:
            pass

        # External flows + income aggregated across all broker accounts.
        external: list[tuple[str, float]] = []
        div = interest = fees = 0.0
        flows: list[dict] = []
        for j2 in j2_ids:
            external += cashflow_store.external_flow_series(user_id, j2, start=start, conn=conn)
            bt = cashflow_store.sum_by_type(user_id, j2, start=start, conn=conn)
            div += bt.get("dividend", 0.0)
            interest += bt.get("interest", 0.0)
            fees += bt.get("fee", 0.0)
            flows += cashflow_store.list_flows(user_id, j2, start=start, conn=conn)

        result = performance.compute_performance(
            equity, external, {"dividends": div, "interest": interest, "fees": fees})
        series = [{"date": d, "value": v, "estimated": False} for d, v in equity]
        if today is not None:
            series = _ensure_renderable_series(series, current_total=live_edge_total, today=today)
        result["equitySeries"] = series
        result["flows"] = sorted(flows, key=lambda f: f["date"])
        result["estimated"] = False
        result["period"] = (period or "ALL").upper()
        result["brokerCount"] = len(bk_ids)
        return result
    finally:
        if owned:
            conn.close()
