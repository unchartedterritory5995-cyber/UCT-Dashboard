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
    """Infer Phase A-F discipline events for the week. These are derived
    from existing trade data + account settings — there is no separate
    event-log table in v1.

    - risk_cap_breaches: trades where actual $-risk-as-%-of-account exceeded
      the configured cap (per the trade's setup, accounting for A+ elevation).
    - risk_cap_overrides: same count (every breach IS an override).
    - a_plus_taken: trades whose setup is in the user's aPlusSetups list.
    - daily_loss_lockouts: # days where realized P&L within the week
      breached the user's dailyLossLimitPct.
    - cooling_off_fires: # losing trades in the week (proxy: each loss
      is a candidate to trigger cooling-off when the setting is enabled).
    - no_trade_window_blocks: not directly observable from trade data;
      reported as 0 until a future polish introduces a discipline-events
      log table.
    """
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    account_size = float(settings.get("accountSize") or 0)
    cap_pct = settings.get("maxRiskPerTradePct")
    a_plus_setups = set(settings.get("aPlusSetups") or [])
    a_plus_mult = float(settings.get("aPlusRiskMultiplier") or 1.0)
    daily_loss_pct = settings.get("dailyLossLimitPct")
    cooling_off_min = settings.get("coolingOffMinutesAfterLoss")

    start_iso = start.isoformat()
    end_iso = end.isoformat()
    rows = conn.execute(
        """
        SELECT shares, entry_price, original_stop, side, setup, result,
               pnl_dollar, exit_date
          FROM j2_trades
         WHERE user_id = ? AND account_id = ?
           AND exit_date >= ? AND exit_date < ?
        """,
        (user_id, account_id, start_iso, end_iso),
    ).fetchall()

    a_plus_taken = 0
    risk_cap_breaches = 0
    cooling_off_fires = 0
    # Day → cumulative pnl
    daily_pnl: dict[str, float] = {}

    for r in rows:
        setup = r["setup"] or ""
        if setup in a_plus_setups:
            a_plus_taken += 1
        # Risk cap check (only when both cap configured and we can compute)
        if cap_pct is not None and account_size > 0:
            shares = float(r["shares"] or 0)
            entry = float(r["entry_price"] or 0)
            stop = r["original_stop"]
            if shares > 0 and entry > 0 and stop is not None:
                stop_f = float(stop)
                per_share_risk = (entry - stop_f) if (r["side"] or "Long") == "Long" else (stop_f - entry)
                if per_share_risk > 0:
                    dollar_risk = shares * per_share_risk
                    risk_pct = (dollar_risk / account_size) * 100.0
                    effective_cap = float(cap_pct) * (a_plus_mult if setup in a_plus_setups else 1.0)
                    if risk_pct > effective_cap:
                        risk_cap_breaches += 1
        # Cooling-off candidate
        if cooling_off_min is not None and (r["result"] or "") == "Loss":
            cooling_off_fires += 1
        # Day P&L bucket
        try:
            d = r["exit_date"][:10]   # ISO date prefix
        except Exception:
            d = None
        if d:
            daily_pnl[d] = daily_pnl.get(d, 0.0) + float(r["pnl_dollar"] or 0)

    daily_loss_lockouts = 0
    if daily_loss_pct is not None and account_size > 0:
        threshold = -float(daily_loss_pct) * account_size / 100.0
        daily_loss_lockouts = sum(1 for v in daily_pnl.values() if v <= threshold)

    return {
        "risk_cap_breaches": risk_cap_breaches,
        "risk_cap_overrides": risk_cap_breaches,
        "daily_loss_lockouts": daily_loss_lockouts,
        "cooling_off_fires": cooling_off_fires,
        "no_trade_window_blocks": 0,
        "a_plus_taken": a_plus_taken,
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
