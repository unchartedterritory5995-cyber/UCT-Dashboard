"""
Compass — week-data assembler.

Takes a (user_id, account_id, week_start) and returns the full structured
dict the Coach prompt needs. Reads from the DB + delegates to existing
Phase A–F services. NEVER calls the LLM.

Output shape:
{
    "trader_profile": str,
    "memory": [{"week_start": str, "summary": str, "key_observations": [str]}],
    "week": {
        "range": "2026-05-04 to 2026-05-08",
        "trades": [trade dict, ...],
        "aggregates": {wins, losses, bes, trade_count, win_rate, avg_r,
                       profit_factor, net_pnl_dollar, net_pnl_pct, process_score_avg},
        "discipline_events": {risk_cap_breaches, daily_loss_lockouts, cooling_off_fires,
                              no_trade_window_blocks, a_plus_taken, risk_cap_overrides},
        "setup_performance": [{setup, trade_count, win_rate, avg_r, total_r}, ...],
        "psychology": {emotion_breakdown: [...], mistake_breakdown: [...]},
        "regime_by_day": [{date, regime}],
        "vs_last_week": {net_pnl_dollar_delta, prior_net_pnl_dollar,
                         trade_count_delta, prior_trade_count, win_rate_delta,
                         process_score_delta},
    },
    "feedback_signals": [{week_start, summary}],
}
"""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from api.services.auth_db import get_connection
from api.services.journal_two import accounts as accounts_service


def assemble_week(
    *,
    user_id: str,
    account_id: str,
    week_start: str,        # ISO date "YYYY-MM-DD" for the Monday
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Build the full structured payload for the Weekly Review prompt."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        week_start_dt = datetime.fromisoformat(week_start).replace(tzinfo=timezone.utc)
        week_end_dt = week_start_dt + timedelta(days=5)   # exclusive: Mon..Fri = [start, start+5)
        week_end_str = (week_end_dt - timedelta(days=1)).date().isoformat()

        trader_profile = _read_trader_profile(conn, user_id, account_id)
        memory = _recent_coach_memory(conn, user_id, account_id, limit=3)
        trades = _trades_in_range(conn, user_id, account_id, week_start_dt, week_end_dt)
        aggregates = _aggregate_trades(trades)
        setup_perf = _setup_performance(trades)
        psychology = _psychology_breakdown(trades)
        regime_by_day = _regime_by_day(trades)
        discipline_events = _discipline_events(conn, user_id, account_id, week_start_dt, week_end_dt)
        prior_trades = _trades_in_range(
            conn, user_id, account_id,
            week_start_dt - timedelta(days=7), week_start_dt,
        )
        vs_last = _vs_last_week(aggregates, _aggregate_trades(prior_trades))
        feedback_signals = _feedback_signals(conn, user_id, account_id)

        return {
            "trader_profile": trader_profile,
            "memory": memory,
            "week": {
                "range": f"{week_start} to {week_end_str}",
                "trades": trades,
                "aggregates": aggregates,
                "discipline_events": discipline_events,
                "setup_performance": setup_perf,
                "psychology": psychology,
                "regime_by_day": regime_by_day,
                "vs_last_week": vs_last,
            },
            "feedback_signals": feedback_signals,
        }
    finally:
        if owned:
            conn.close()


def _read_trader_profile(conn, user_id: str, account_id: str) -> str:
    row = conn.execute(
        "SELECT trader_profile FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    if not row:
        return ""
    keys = row.keys() if hasattr(row, "keys") else []
    return row["trader_profile"] if "trader_profile" in keys else ""


def _recent_coach_memory(conn, user_id: str, account_id: str, limit: int) -> list[dict]:
    rows = conn.execute(
        """
        SELECT summary, metadata FROM j2_coach_outputs
         WHERE user_id = ? AND account_id = ?
           AND output_type = 'weekly_review' AND forgotten = 0
         ORDER BY created_at DESC LIMIT ?
        """,
        (user_id, account_id, limit),
    ).fetchall()
    out = []
    for r in rows:
        try:
            meta = json.loads(r["metadata"]) if r["metadata"] else {}
        except (TypeError, json.JSONDecodeError):
            meta = {}
        out.append({
            "week_start": meta.get("week_start"),
            "summary": r["summary"] or "",
            "key_observations": meta.get("key_observations") or [],
        })
    return out


def _trades_in_range(
    conn, user_id: str, account_id: str,
    start: datetime, end: datetime,
) -> list[dict]:
    start_iso = start.isoformat()
    end_iso = end.isoformat()
    rows = conn.execute(
        """
        SELECT symbol, side, shares, entry_price, exit_price, entry_date, exit_date,
               original_stop, setup, notes, pnl_dollar, pnl_percent, r_multiple,
               hold_days, result, mistake_tags, emotion_tags, regime
          FROM j2_trades
         WHERE user_id = ? AND account_id = ?
           AND exit_date >= ? AND exit_date < ?
         ORDER BY exit_date ASC
        """,
        (user_id, account_id, start_iso, end_iso),
    ).fetchall()
    out = []
    for r in rows:
        out.append({
            "symbol": r["symbol"],
            "side": r["side"],
            "shares": float(r["shares"]) if r["shares"] is not None else None,
            "entry_price": float(r["entry_price"]) if r["entry_price"] is not None else None,
            "exit_price": float(r["exit_price"]) if r["exit_price"] is not None else None,
            "entry_date": r["entry_date"],
            "exit_date": r["exit_date"],
            "original_stop": float(r["original_stop"]) if r["original_stop"] is not None else None,
            "setup": r["setup"],
            "notes": r["notes"],
            "pnl_dollar": float(r["pnl_dollar"]) if r["pnl_dollar"] is not None else None,
            "pnl_percent": float(r["pnl_percent"]) if r["pnl_percent"] is not None else None,
            "r_multiple": float(r["r_multiple"]) if r["r_multiple"] is not None else None,
            "hold_days": r["hold_days"],
            "result": r["result"],
            "mistake_tags": _parse_json_list(r["mistake_tags"]),
            "emotion_tags": _parse_json_list(r["emotion_tags"]),
            "regime": r["regime"],
            "process_score": None,    # j2 doesn't yet store process_score per trade
        })
    return out


def _parse_json_list(raw) -> list[str]:
    if not raw:
        return []
    try:
        v = json.loads(raw)
        return v if isinstance(v, list) else []
    except (TypeError, json.JSONDecodeError):
        return []


def _aggregate_trades(trades: list[dict]) -> dict:
    if not trades:
        return {
            "trade_count": 0, "wins": 0, "losses": 0, "bes": 0,
            "win_rate": None, "avg_r": None, "profit_factor": None,
            "net_pnl_dollar": 0.0, "net_pnl_pct": 0.0, "process_score_avg": None,
        }
    wins = sum(1 for t in trades if t["result"] == "Win")
    losses = sum(1 for t in trades if t["result"] == "Loss")
    bes = sum(1 for t in trades if t["result"] == "BE")
    decisive = wins + losses
    win_rate = (wins / decisive) if decisive > 0 else None
    rs = [t["r_multiple"] for t in trades if t["r_multiple"] is not None]
    avg_r = (sum(rs) / len(rs)) if rs else None
    pnls = [t["pnl_dollar"] for t in trades if t["pnl_dollar"] is not None]
    net_pnl = sum(pnls) if pnls else 0.0
    pcts = [t["pnl_percent"] for t in trades if t["pnl_percent"] is not None]
    net_pct = sum(pcts) if pcts else 0.0
    gross_wins = sum(p for p in pnls if p > 0)
    gross_losses = abs(sum(p for p in pnls if p < 0))
    profit_factor = (gross_wins / gross_losses) if gross_losses > 0 else None
    return {
        "trade_count": len(trades),
        "wins": wins, "losses": losses, "bes": bes,
        "win_rate": win_rate, "avg_r": avg_r, "profit_factor": profit_factor,
        "net_pnl_dollar": round(net_pnl, 2),
        "net_pnl_pct": round(net_pct, 4),
        "process_score_avg": None,
    }


def _setup_performance(trades: list[dict]) -> list[dict]:
    bucket: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        setup = t.get("setup") or "(no setup)"
        bucket[setup].append(t)
    out = []
    for setup, items in bucket.items():
        agg = _aggregate_trades(items)
        rs = [t["r_multiple"] for t in items if t["r_multiple"] is not None]
        out.append({
            "setup": setup,
            "trade_count": agg["trade_count"],
            "win_rate": agg["win_rate"],
            "avg_r": agg["avg_r"],
            "total_r": round(sum(rs), 4) if rs else 0.0,
        })
    # Sort by total_r descending so "best" comes first
    out.sort(key=lambda x: x["total_r"], reverse=True)
    return out


def _psychology_breakdown(trades: list[dict]) -> dict:
    emo_bucket: dict[str, list[dict]] = defaultdict(list)
    mis_bucket: dict[str, list[dict]] = defaultdict(list)
    for t in trades:
        for tag in t.get("emotion_tags") or []:
            emo_bucket[tag].append(t)
        for tag in t.get("mistake_tags") or []:
            mis_bucket[tag].append(t)
    def _summary(items):
        agg = _aggregate_trades(items)
        rs = [t["r_multiple"] for t in items if t["r_multiple"] is not None]
        return {
            "trade_count": agg["trade_count"],
            "win_rate": agg["win_rate"],
            "total_r": round(sum(rs), 4) if rs else 0.0,
        }
    return {
        "emotion_breakdown": [
            {"tag": tag, **_summary(items)} for tag, items in emo_bucket.items()
        ],
        "mistake_breakdown": [
            {"tag": tag, **_summary(items)} for tag, items in mis_bucket.items()
        ],
    }


def _regime_by_day(trades: list[dict]) -> list[dict]:
    by_date: dict[str, str] = {}
    for t in trades:
        if not t.get("exit_date"):
            continue
        try:
            d = datetime.fromisoformat(str(t["exit_date"]).replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            continue
        if d not in by_date and t.get("regime"):
            by_date[d] = t["regime"]
    return [{"date": d, "regime": r} for d, r in sorted(by_date.items())]


def _discipline_events(conn, user_id, account_id, start, end) -> dict:
    """Phase B events aren't independently logged in v1; we infer some from
    settings + trade volume. For v1 we expose zeros and a count of trades
    closed within daily-loss-lockout windows is left for a later polish.
    """
    return {
        "risk_cap_breaches": 0,
        "risk_cap_overrides": 0,
        "daily_loss_lockouts": 0,
        "cooling_off_fires": 0,
        "no_trade_window_blocks": 0,
        "a_plus_taken": 0,
    }


def _vs_last_week(curr: dict, prior: dict) -> dict:
    return {
        "prior_net_pnl_dollar": prior.get("net_pnl_dollar", 0.0),
        "net_pnl_dollar_delta": round(
            (curr.get("net_pnl_dollar") or 0) - (prior.get("net_pnl_dollar") or 0), 2,
        ),
        "prior_trade_count": prior.get("trade_count", 0),
        "trade_count_delta": (curr.get("trade_count", 0) - prior.get("trade_count", 0)),
        "win_rate_delta": (
            round(((curr.get("win_rate") or 0) - (prior.get("win_rate") or 0)) * 100, 1)
            if curr.get("win_rate") is not None and prior.get("win_rate") is not None
            else None
        ),
        "process_score_delta": None,
    }


def _feedback_signals(conn, user_id, account_id) -> list[dict]:
    rows = conn.execute(
        """
        SELECT summary, metadata FROM j2_coach_outputs
         WHERE user_id = ? AND account_id = ?
           AND feedback = 'unhelpful' AND forgotten = 0
         ORDER BY created_at DESC LIMIT 5
        """,
        (user_id, account_id),
    ).fetchall()
    out = []
    for r in rows:
        try:
            meta = json.loads(r["metadata"]) if r["metadata"] else {}
        except (TypeError, json.JSONDecodeError):
            meta = {}
        out.append({"week_start": meta.get("week_start"), "summary": r["summary"]})
    return out
