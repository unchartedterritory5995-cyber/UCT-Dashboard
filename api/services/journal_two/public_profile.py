"""Journal 2.0 — public track record (opt-in share link).

One row per user in `j2_public_profiles`; the unguessable token IS the
credential (the screener/notebook share posture). The public payload is
assembled from the SAME audited pipeline as everything else — get_analytics
for the curve/totals, the metrics registry for the ratios — so a shared
track record can never disagree with what the owner sees.

Owner decision 2026-08-22: the page shows ALL OF IT — stats, real dollars,
and recent trades. What it NEVER carries: email, account ids, broker names.
Kill switch: J2_TRACK_RECORD_ENABLED=0 disables the PUBLIC read (existing
links 404) without touching the owner-side controls.
"""

from __future__ import annotations

import os
import secrets
import sqlite3
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import analytics as analytics_service
from api.services.journal_two.filters import FilterSpec
from api.services.journal_two.metrics_registry import compute_metrics

_RECENT_TRADES = 20


def enabled() -> bool:
    return os.environ.get("J2_TRACK_RECORD_ENABLED", "1") != "0"


# ── Owner-side controls ─────────────────────────────────────────────────────

def get_state(user_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    own = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT token, created_at FROM j2_public_profiles WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            return {"enabled": False, "token": None, "createdAt": None}
        return {"enabled": True, "token": row["token"], "createdAt": row["created_at"]}
    finally:
        if own:
            conn.close()


def create_or_rotate(user_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Mint (or replace) the user's token. Rotating kills the old link."""
    own = conn is None
    conn = conn or get_connection()
    try:
        token = secrets.token_urlsafe(16)
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO j2_public_profiles (user_id, token, created_at) "
            "VALUES (?, ?, ?) "
            "ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, "
            "created_at = excluded.created_at",
            (user_id, token, now),
        )
        conn.commit()
        return {"enabled": True, "token": token, "createdAt": now}
    finally:
        if own:
            conn.close()


def revoke(user_id: str, conn: sqlite3.Connection | None = None) -> None:
    own = conn is None
    conn = conn or get_connection()
    try:
        conn.execute("DELETE FROM j2_public_profiles WHERE user_id = ?", (user_id,))
        conn.commit()
    finally:
        if own:
            conn.close()


# ── The public payload ──────────────────────────────────────────────────────

def track_record(token: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """Resolve a token → the public payload, or None (unknown/revoked token,
    or the kill switch is off — indistinguishable by design)."""
    if not enabled() or not token:
        return None
    own = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT p.user_id, u.display_name FROM j2_public_profiles p "
            "JOIN users u ON u.id = p.user_id WHERE p.token = ?",
            (token,),
        ).fetchone()
        if not row:
            return None
        uid = row["user_id"]
        name = (row["display_name"] or "").strip() or "UCT Trader"

        a = analytics_service.get_analytics(uid, conn=conn)
        m = compute_metrics(
            uid, ["payoff_kelly", "risk_ratios", "consistency"],
            spec=FilterSpec(), conn=conn,
        )["metrics"]

        curve = [
            {"date": p["date"], "equity": p["equity"]}
            for p in (a.get("equity") or {}).get("curve", [])
        ]

        trades = conn.execute(
            "SELECT symbol, side, substr(COALESCE(trading_day_et, exit_date),1,10) AS day, "
            "       pnl_dollar, COALESCE(fees, 0) AS fees, result, r_multiple "
            "  FROM j2_trades WHERE user_id = ? "
            " ORDER BY COALESCE(trading_day_et, substr(exit_date,1,10)) DESC "
            " LIMIT ?",
            (uid, _RECENT_TRADES),
        ).fetchall()
        recent = [{
            "symbol": t["symbol"], "side": t["side"], "date": t["day"],
            "netPnl": round(float(t["pnl_dollar"] or 0) - float(t["fees"]), 2),
            "result": t["result"],
            "rMultiple": t["r_multiple"],
        } for t in trades]

        pk = m.get("payoff_kelly") or {}
        rr = m.get("risk_ratios") or {}
        cons = m.get("consistency") or {}
        dist = (a.get("distribution") or {}).get("longVsShort") or {}
        total_pnl = round(
            float((dist.get("long") or {}).get("totalPnl") or 0)
            + float((dist.get("short") or {}).get("totalPnl") or 0), 2)

        return {
            "displayName": name,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "stats": {
                "tradeCount": a.get("tradeCount", 0),
                "totalPnl": total_pnl,
                "winRate": pk.get("winRate"),
                "payoff": pk.get("payoff"),
                "avgWin": pk.get("avgWin"),
                "avgLoss": pk.get("avgLoss"),
                "sharpe": rr.get("sharpe"),
                "annualizedReturn": rr.get("annualizedReturn"),
                "maxDrawdownPct": rr.get("maxDrawdownPct"),
                "profitableDayPct": cons.get("profitableDayPct"),
                "tradingDays": cons.get("tradingDays"),
            },
            "curve": curve,
            "recentTrades": recent,
        }
    finally:
        if own:
            conn.close()
