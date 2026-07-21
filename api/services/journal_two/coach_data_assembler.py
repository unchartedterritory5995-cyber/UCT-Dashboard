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
from api.services.journal_two.coach_scope import is_unified, resolve_account_scope


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

        # Phase G v2: pull EOD summaries from this week for the Weekly prompt.
        weekly_eod_context = _eod_summaries_in_week(
            conn, user_id, account_id, week_start, week_end_str,
        )

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
            "weekly_eod_context": weekly_eod_context,
        }
    finally:
        if owned:
            conn.close()


def _read_trader_profile(conn, user_id: str, account_id: str) -> str:
    if is_unified(account_id):
        from api.services.journal_two import unified_coach
        return unified_coach.get_or_create(conn, user_id)["traderProfile"]
    row = conn.execute(
        "SELECT trader_profile FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    if not row:
        return ""
    keys = row.keys() if hasattr(row, "keys") else []
    return row["trader_profile"] if "trader_profile" in keys else ""


def _recent_coach_memory(conn, user_id: str, account_id: str, limit: int) -> list[dict]:
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"""
        SELECT summary, metadata FROM j2_coach_outputs
         WHERE user_id = ? AND account_id IN ({placeholders})
           AND output_type = 'weekly_review' AND forgotten = 0
         ORDER BY created_at DESC LIMIT ?
        """,
        [user_id, *ids, limit],
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
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    start_iso = start.isoformat()
    end_iso = end.isoformat()
    rows = conn.execute(
        f"""
        SELECT t.symbol, t.side, t.shares, t.entry_price, t.exit_price,
               t.entry_date, t.exit_date,
               t.original_stop, t.setup, t.notes, t.pnl_dollar, t.pnl_percent,
               t.r_multiple, t.hold_days, t.result,
               t.mistake_tags, t.emotion_tags, t.regime, t.source,
               t.account_id, a.name AS account_name
          FROM j2_trades t
          LEFT JOIN j2_accounts a ON a.id = t.account_id
         WHERE t.user_id = ? AND t.account_id IN ({placeholders})
           AND t.exit_date >= ? AND t.exit_date < ?
           -- FIX-C: coaching aggregates must not be fed unvouched trades
           -- (phantom short / user opt-out). The trade list still shows them.
           AND (t.analytics_excluded IS NULL OR t.analytics_excluded = 0)
         ORDER BY t.exit_date ASC
        """,
        [user_id, *ids, start_iso, end_iso],
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
            "account_id": r["account_id"],
            "account_name": r["account_name"],
            # 'broker' = auto-imported (no pre-trade plan was recorded), so the
            # coach should not fault a missing setup/stop on these rows.
            "source": r["source"] if "source" in r.keys() else None,
            "imported": (r["source"] == "broker") if "source" in r.keys() else False,
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

    Unified mode (account_id == '_all_'): sum counters across each
    enabled account using that account's own risk caps / daily-loss limit.
    """
    if is_unified(account_id):
        ids = resolve_account_scope(conn, user_id, account_id)
        if not ids:
            return {
                "risk_cap_breaches": 0, "risk_cap_overrides": 0,
                "daily_loss_lockouts": 0, "cooling_off_fires": 0,
                "no_trade_window_blocks": 0, "a_plus_taken": 0,
            }
        agg = {
            "risk_cap_breaches": 0, "risk_cap_overrides": 0,
            "daily_loss_lockouts": 0, "cooling_off_fires": 0,
            "no_trade_window_blocks": 0, "a_plus_taken": 0,
        }
        for aid in ids:
            part = _discipline_events(conn, user_id, aid, start, end)
            for k in agg:
                agg[k] += part.get(k, 0)
        return agg

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
           -- FIX-C: sizing stats exclude unvouched trades.
           AND (analytics_excluded IS NULL OR analytics_excluded = 0)
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
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"""
        SELECT summary, metadata FROM j2_coach_outputs
         WHERE user_id = ? AND account_id IN ({placeholders})
           AND feedback = 'unhelpful' AND forgotten = 0
         ORDER BY created_at DESC LIMIT 5
        """,
        [user_id, *ids],
    ).fetchall()
    out = []
    for r in rows:
        try:
            meta = json.loads(r["metadata"]) if r["metadata"] else {}
        except (TypeError, json.JSONDecodeError):
            meta = {}
        out.append({"week_start": meta.get("week_start"), "summary": r["summary"]})
    return out


def _eod_summaries_in_week(
    conn: sqlite3.Connection, user_id: str, account_id: str,
    week_start: str, week_end: str,
) -> list[dict]:
    """Return EOD recap summaries from this week (used by Weekly Review prompt)."""
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"""
        SELECT summary, metadata FROM j2_coach_outputs
         WHERE user_id = ? AND account_id IN ({placeholders})
           AND output_type = 'eod_recap' AND forgotten = 0
           AND json_extract(metadata, '$.day') BETWEEN ? AND ?
         ORDER BY json_extract(metadata, '$.day') ASC
        """,
        [user_id, *ids, week_start, week_end],
    ).fetchall()
    out = []
    for r in rows:
        try:
            meta = json.loads(r["metadata"]) if r["metadata"] else {}
        except (TypeError, json.JSONDecodeError):
            meta = {}
        out.append({"day": meta.get("day"), "summary": r["summary"] or ""})
    return out


# ── Phase G v2: assemble_day + multi-day arc detection ──────────────────────


def assemble_day(
    *,
    user_id: str,
    account_id: str,
    day_iso: str,           # "YYYY-MM-DD" — the trader's calendar day in ET
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Build the structured payload for an EOD Recap prompt.

    Mirrors `assemble_week` but scoped to a single ET calendar day plus
    week-to-date + multi-day arc detection.
    """
    owned = conn is None
    conn = conn or get_connection()
    try:
        from datetime import time
        from zoneinfo import ZoneInfo

        et = ZoneInfo("America/New_York")
        day_date = datetime.fromisoformat(day_iso).date()
        day_start_et = datetime.combine(day_date, time(0, 0), tzinfo=et)
        day_end_et = day_start_et + timedelta(days=1)
        day_start_utc = day_start_et.astimezone(timezone.utc)
        day_end_utc = day_end_et.astimezone(timezone.utc)

        # Trader profile
        trader_profile = _read_trader_profile(conn, user_id, account_id)

        # Memory — last 2 EOD summaries + last weekly summary + this_weeks_focus
        eod_summaries = _recent_eod_summaries(conn, user_id, account_id, limit=2, before_day=day_iso)
        last_weekly = _last_weekly_summary_and_focus(conn, user_id, account_id)

        # Today's trades + aggregates
        trades = _trades_in_range(conn, user_id, account_id, day_start_utc, day_end_utc)
        aggregates = _aggregate_trades(trades)

        # Today's discipline events
        discipline_events = _discipline_events(
            conn, user_id, account_id, day_start_utc, day_end_utc,
        )

        # Open positions
        open_positions = _open_positions(conn, user_id, account_id)

        # Week-to-date
        wtd_start = day_start_et - timedelta(days=day_start_et.weekday())
        wtd_trades = _trades_in_range(
            conn, user_id, account_id,
            wtd_start.astimezone(timezone.utc),
            day_end_utc,
        )
        wtd_agg = _aggregate_trades(wtd_trades)

        # Vs yesterday
        yesterday_et = day_start_et - timedelta(days=1)
        y_trades = _trades_in_range(
            conn, user_id, account_id,
            yesterday_et.astimezone(timezone.utc),
            day_start_utc,
        )
        prior_day_net = _aggregate_trades(y_trades).get("net_pnl_dollar", 0.0)

        # Multi-day arcs
        rolling_window = _trades_in_range(
            conn, user_id, account_id,
            (day_start_et - timedelta(days=10)).astimezone(timezone.utc),
            day_end_utc,
        )
        recent_arcs = _detect_recent_arcs(rolling_window, today_date=day_date)

        feedback_signals = _eod_feedback_signals(conn, user_id, account_id)

        return {
            "trader_profile": trader_profile,
            "memory": {
                "recent_eod_summaries": eod_summaries,
                "last_weekly_summary": last_weekly.get("summary", ""),
                "this_weeks_focus": last_weekly.get("this_weeks_focus"),
            },
            "today": {
                "date": day_iso,
                "trades": trades,
                "aggregates": aggregates,
                "discipline_events": discipline_events,
                "open_positions": open_positions,
            },
            "week_to_date": {
                "range": f"{wtd_start.date().isoformat()} to {day_iso}",
                "trade_count": wtd_agg.get("trade_count", 0),
                "net_pnl_dollar": wtd_agg.get("net_pnl_dollar", 0.0),
                "wins": wtd_agg.get("wins", 0),
                "losses": wtd_agg.get("losses", 0),
            },
            "vs_yesterday": {
                "prior_day_net_pnl_dollar": prior_day_net,
            },
            "recent_arcs": recent_arcs,
            "feedback_signals": feedback_signals,
        }
    finally:
        if owned:
            conn.close()


def _recent_eod_summaries(
    conn: sqlite3.Connection, user_id: str, account_id: str, *,
    limit: int, before_day: str,
) -> list[dict]:
    """Return the last N EOD recap summaries for this account, excluding the
    recap for `before_day` itself."""
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"""
        SELECT summary, metadata FROM j2_coach_outputs
         WHERE user_id = ? AND account_id IN ({placeholders})
           AND output_type = 'eod_recap' AND forgotten = 0
           AND json_extract(metadata, '$.day') < ?
         ORDER BY created_at DESC LIMIT ?
        """,
        [user_id, *ids, before_day, limit],
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        try:
            meta = json.loads(r["metadata"]) if r["metadata"] else {}
        except (TypeError, json.JSONDecodeError):
            meta = {}
        out.append({"day": meta.get("day"), "summary": r["summary"] or ""})
    return out


def _last_weekly_summary_and_focus(
    conn: sqlite3.Connection, user_id: str, account_id: str,
) -> dict:
    """Return {summary, this_weeks_focus} from the most recent weekly_review."""
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return {"summary": "", "this_weeks_focus": None}
    placeholders = ",".join("?" * len(ids))
    row = conn.execute(
        f"""
        SELECT summary, metadata FROM j2_coach_outputs
         WHERE user_id = ? AND account_id IN ({placeholders})
           AND output_type = 'weekly_review' AND forgotten = 0
         ORDER BY created_at DESC LIMIT 1
        """,
        [user_id, *ids],
    ).fetchone()
    if row is None:
        return {"summary": "", "this_weeks_focus": None}
    try:
        meta = json.loads(row["metadata"]) if row["metadata"] else {}
    except (TypeError, json.JSONDecodeError):
        meta = {}
    return {
        "summary": row["summary"] or "",
        "this_weeks_focus": meta.get("this_weeks_focus"),
    }


def _open_positions(conn: sqlite3.Connection, user_id: str, account_id: str) -> list[dict]:
    """Open positions (closed_at IS NULL) for this account.

    In unified mode (account_id == '_all_'), unions positions across every
    enabled account and tags each with account_id + account_name so the
    coach prompt can attribute statements.
    """
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"""
        SELECT p.symbol, p.side, p.shares, p.entry_price, p.stop_price, p.entry_date,
               p.account_id, a.name AS account_name
          FROM j2_positions p
          LEFT JOIN j2_accounts a ON a.id = p.account_id
         WHERE p.user_id = ? AND p.account_id IN ({placeholders}) AND p.closed_at IS NULL
         ORDER BY p.entry_date ASC
        """,
        [user_id, *ids],
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        try:
            entry_dt = datetime.fromisoformat(str(r["entry_date"]).replace("Z", "+00:00"))
            days_held = (datetime.now(timezone.utc) - entry_dt).days
        except Exception:
            days_held = None
        out.append({
            "symbol": r["symbol"],
            "side": r["side"],
            "shares": float(r["shares"]) if r["shares"] is not None else None,
            "entry_price": float(r["entry_price"]) if r["entry_price"] is not None else None,
            "stop_price": float(r["stop_price"]) if r["stop_price"] is not None else None,
            "entry_date": r["entry_date"],
            "days_held": days_held,
            "unrealized_r": None,        # v2: live price integration deferred
            "current_price": None,
            "account_id": r["account_id"],
            "account_name": r["account_name"],
        })
    return out


def _eod_feedback_signals(conn, user_id, account_id) -> list[dict]:
    """Recent EOD recaps the user marked unhelpful."""
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    rows = conn.execute(
        f"""
        SELECT summary, metadata FROM j2_coach_outputs
         WHERE user_id = ? AND account_id IN ({placeholders})
           AND output_type = 'eod_recap'
           AND feedback = 'unhelpful' AND forgotten = 0
         ORDER BY created_at DESC LIMIT 3
        """,
        [user_id, *ids],
    ).fetchall()
    out = []
    for r in rows:
        try:
            meta = json.loads(r["metadata"]) if r["metadata"] else {}
        except (TypeError, json.JSONDecodeError):
            meta = {}
        out.append({"day": meta.get("day"), "summary": r["summary"]})
    return out


# ── Arc detectors ──────────────────────────────────────────────────────────


def _detect_recent_arcs(rolling_window_trades: list[dict], *, today_date) -> list[str]:
    """Run all arc detectors, cap at 3, sort by significance."""
    arcs: list[tuple[int, str]] = []   # (priority, text)

    # ── Detector A: consecutive setup losses ──
    if rolling_window_trades:
        recent = rolling_window_trades[-10:]
        if recent and recent[-1]["result"] == "Loss":
            setup = recent[-1].get("setup")
            streak_syms: list[str] = []
            for t in reversed(recent):
                if t.get("setup") == setup and t.get("result") == "Loss":
                    streak_syms.append(t.get("symbol") or "?")
                else:
                    break
            if len(streak_syms) >= 3 and setup:
                streak_syms_quote = ", ".join(streak_syms[::-1])
                arcs.append((10, f"{len(streak_syms)} consecutive losses on {setup} ({streak_syms_quote})"))

    # ── Detector B: repeated mistake tag (rolling 7 days) ──
    from collections import Counter
    tag_count: Counter[str] = Counter()
    for t in rolling_window_trades[-15:]:
        for tag in t.get("mistake_tags") or []:
            tag_count[tag] += 1
    for tag, n in tag_count.most_common(2):
        if n >= 3:
            arcs.append((8, f"the `{tag}` mistake tag has appeared on {n} trades in the last 7 days"))

    # ── Detector C: days since last winner ──
    days_back = 0
    seen_winner = False
    for t in reversed(rolling_window_trades):
        if t.get("result") == "Win":
            seen_winner = True
            break
        days_back += 1
    if not seen_winner and days_back >= 3:
        arcs.append((6, f"{days_back} most-recent trades with no closing winner"))

    # ── Detector D: cumulative drawdown approach ──
    last_5 = rolling_window_trades[-15:]
    five_day_pnl = sum(t.get("pnl_dollar") or 0 for t in last_5 if t.get("exit_date"))
    if five_day_pnl <= -1000:
        arcs.append((5, f"net P&L over the last several days is {_signed_money_str(five_day_pnl)}"))

    # ── Detector E: regime-mismatch streak ──
    hostile_regimes = [t for t in rolling_window_trades[-10:] if t.get("regime") in ("ORANGE", "RED")]
    if len(hostile_regimes) >= 3:
        arcs.append((4, f"{len(hostile_regimes)} of your recent trades were taken in ORANGE/RED regime"))

    # (Detector F: consecutive discipline-cap breaches — deferred; needs accountSize injection.)

    arcs.sort(key=lambda x: -x[0])
    return [text for _, text in arcs[:3]]


def _signed_money_str(v: float) -> str:
    if v >= 0:
        return f"+${v:.0f}"
    return f"-${abs(v):.0f}"
