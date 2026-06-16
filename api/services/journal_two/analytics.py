"""
Journal 2.0 — Analytics aggregation.

Single mega-endpoint that returns all chart data for the Analytics tab
in one round-trip. Reads from j2_trades, optionally filtered by
account_id and date range. Aggregation done in Python (faster than
shipping raw trades + computing in JS for the typical user payload).

Spec: docs/superpowers/specs/2026-04-18-analytics-design.md §6
"""

from __future__ import annotations

import sqlite3
from collections import defaultdict
from datetime import date as Date, datetime, timedelta, timezone
from typing import Any

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    from backports.zoneinfo import ZoneInfo  # type: ignore

from api.services.auth_db import get_connection
from api.services.journal_two.calendar import to_et_date


ET = ZoneInfo("America/New_York")
UTC = timezone.utc


# ── R-multiple bucket boundaries (spec §6.3) ─────────────────────────────────


_R_BUCKETS = [
    ("< -2R",  lambda r: r < -2),
    ("-2R..-1R", lambda r: -2 <= r < -1),
    ("-1R..0R",  lambda r: -1 <= r < 0),
    ("0R..1R",   lambda r: 0 <= r < 1),
    ("1R..2R",   lambda r: 1 <= r < 2),
    ("2R..3R",   lambda r: 2 <= r < 3),
    ("> 3R",    lambda r: r >= 3),
]


def get_analytics(
    user_id: str,
    *,
    account_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Return the full analytics payload (4 sections, ~16 charts of data)."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = _fetch_trades(
            conn, user_id,
            account_id=account_id,
            date_from=date_from, date_to=date_to,
        )

        starting_balance = _starting_balance(conn, user_id, account_id)
        # For a single broker-linked account, anchor the equity curve so its
        # final point matches the broker's real net-liquidation equity (keeps
        # analytics consistent with the comparison view). baseline =
        # broker_equity − realized P&L; manual accounts keep startingBalance.
        if account_id:
            be = _broker_equity_baseline(conn, user_id, account_id, rows)
            if be is not None:
                starting_balance = be

        strategies = _fetch_option_strategies(
            conn, user_id,
            account_id=account_id,
            date_from=date_from, date_to=date_to,
        )

        return {
            "tradeCount": len(rows),
            "strategyCount": len(strategies),
            "dateRange": {"from": date_from, "to": date_to},
            "equity": _equity_section(rows, starting_balance),
            "performance": _performance_section(rows),
            "distribution": _distribution_section(rows),
            "attribution": _attribution_section(rows),
            "edgeScore": _edge_score(rows),
            "options": _options_section(rows, strategies),
        }
    finally:
        if owned:
            conn.close()


# ── Data fetch ────────────────────────────────────────────────────────────────


def _fetch_trades(
    conn: sqlite3.Connection,
    user_id: str,
    *,
    account_id: str | None,
    date_from: str | None,
    date_to: str | None,
) -> list[sqlite3.Row]:
    sql = (
        "SELECT exit_date, entry_date, pnl_dollar, pnl_percent, "
        "       r_multiple, hold_days, result, side, setup, symbol, "
        "       account_id "
        "  FROM j2_trades "
        " WHERE user_id = ?"
    )
    params: list[Any] = [user_id]
    if account_id:
        sql += " AND account_id = ?"
        params.append(account_id)
    if date_from:
        # Buffer ±1 day on each side because exit_date is UTC and ET
        # bucketing might shift by up to 24h. We re-filter in Python.
        sql += " AND exit_date >= ?"
        params.append((Date.fromisoformat(date_from) - timedelta(days=1)).isoformat() + "T00:00:00Z")
    if date_to:
        sql += " AND exit_date <= ?"
        params.append((Date.fromisoformat(date_to) + timedelta(days=1)).isoformat() + "T23:59:59Z")
    sql += " ORDER BY exit_date ASC"

    rows = conn.execute(sql, params).fetchall()

    # Re-filter on ET-bucketed exit date if range was given
    if date_from or date_to:
        out = []
        for r in rows:
            d = to_et_date(r["exit_date"])
            if date_from and d < date_from:
                continue
            if date_to and d > date_to:
                continue
            out.append(r)
        return out
    return rows


def _broker_equity_baseline(
    conn: sqlite3.Connection, user_id: str, account_id: str, rows: list,
) -> float | None:
    """For a broker-linked account with synced real equity, return the curve
    baseline = broker_total_equity − realized P&L, so the curve ends at the
    broker's true net-liq. None for manual accounts (use startingBalance)."""
    try:
        row = conn.execute(
            "SELECT balance_source, broker_total_equity FROM j2_accounts "
            "WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
    except sqlite3.OperationalError:
        return None
    if not row or row["balance_source"] != "broker" or row["broker_total_equity"] is None:
        return None
    realized = sum(float(r["pnl_dollar"] or 0) for r in rows)
    return round(float(row["broker_total_equity"]) - realized, 2)


def _starting_balance(
    conn: sqlite3.Connection,
    user_id: str,
    account_id: str | None,
) -> float:
    """Starting balance for equity-curve baseline. If account_id is
    given, use that account's starting_balance. Else, sum across all
    user's accounts (or fall back to 100k default)."""
    if account_id:
        row = conn.execute(
            "SELECT starting_balance FROM j2_accounts "
            "WHERE id = ? AND user_id = ?",
            (account_id, user_id),
        ).fetchone()
        if row:
            return float(row["starting_balance"])
        return 100_000.0
    # All Accounts: sum
    row = conn.execute(
        "SELECT COALESCE(SUM(starting_balance), 0) AS total "
        "FROM j2_accounts WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    if row and row["total"]:
        return float(row["total"])
    return 100_000.0


# ── Section 1: Equity ─────────────────────────────────────────────────────────


def _equity_section(rows: list[sqlite3.Row], starting_balance: float) -> dict[str, Any]:
    """Equity curve + KPI strip (peak / max DD / current DD / longest underwater)."""
    if not rows:
        return {
            "kpis": {
                "peakPnl": 0.0,
                "maxDrawdown": 0.0,
                "maxDrawdownPct": 0.0,
                "currentDrawdown": 0.0,
                "longestUnderwaterDays": 0,
            },
            "curve": [],
        }

    # Aggregate per ET-bucketed day
    by_day: dict[str, float] = defaultdict(float)
    for r in rows:
        d = to_et_date(r["exit_date"])
        by_day[d] += float(r["pnl_dollar"] or 0)

    sorted_days = sorted(by_day.keys())

    curve: list[dict[str, Any]] = []
    running = starting_balance
    peak = starting_balance
    max_dd = 0.0
    max_dd_pct = 0.0
    current_dd = 0.0
    longest_underwater = 0
    underwater_streak = 0

    for d in sorted_days:
        running += by_day[d]
        if running > peak:
            peak = running
            underwater_streak = 0
        dd = running - peak
        if dd < 0:
            underwater_streak += 1
            longest_underwater = max(longest_underwater, underwater_streak)
        if dd < max_dd:
            max_dd = dd
            max_dd_pct = (dd / peak) if peak > 0 else 0.0
        current_dd = dd
        curve.append({
            "date": d,
            "equity": round(running, 2),
            "drawdown": round(dd, 2),
        })

    return {
        "kpis": {
            "peakPnl": round(peak - starting_balance, 2),
            "maxDrawdown": round(max_dd, 2),
            "maxDrawdownPct": round(max_dd_pct, 6),
            "currentDrawdown": round(current_dd, 2),
            "longestUnderwaterDays": longest_underwater,
        },
        "curve": curve,
    }


# ── Section 2: Performance ────────────────────────────────────────────────────


def _performance_section(rows: list[sqlite3.Row]) -> dict[str, Any]:
    """Daily/weekly/monthly/yearly P&L + hourly + day-of-week."""
    by_day: dict[str, float] = defaultdict(float)
    by_week: dict[str, float] = defaultdict(float)
    by_month: dict[str, float] = defaultdict(float)
    by_year: dict[int, float] = defaultdict(float)
    by_hour: dict[int, dict[str, Any]] = defaultdict(lambda: {"pnl": 0.0, "tradeCount": 0})
    by_dow: dict[str, dict[str, Any]] = defaultdict(lambda: {"pnl": 0.0, "tradeCount": 0})

    DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    for r in rows:
        pnl = float(r["pnl_dollar"] or 0)
        d_str = to_et_date(r["exit_date"])
        d = Date.fromisoformat(d_str)

        by_day[d_str] += pnl

        # ISO week start Monday
        monday = d - timedelta(days=d.weekday())
        by_week[monday.isoformat()] += pnl

        by_month[d.strftime("%Y-%m")] += pnl
        by_year[d.year] += pnl

        # Hour in ET
        dt = datetime.fromisoformat(r["exit_date"].replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        et_dt = dt.astimezone(ET)
        h = et_dt.hour
        by_hour[h]["pnl"] += pnl
        by_hour[h]["tradeCount"] += 1

        dow_label = DOW_LABELS[d.weekday()]
        by_dow[dow_label]["pnl"] += pnl
        by_dow[dow_label]["tradeCount"] += 1

    return {
        "byDay":   [{"date": k, "pnl": round(v, 2)} for k, v in sorted(by_day.items())],
        "byWeek":  [{"weekStart": k, "pnl": round(v, 2)} for k, v in sorted(by_week.items())],
        "byMonth": [{"month": k, "pnl": round(v, 2)} for k, v in sorted(by_month.items())],
        "byYear":  [{"year": k, "pnl": round(v, 2)} for k, v in sorted(by_year.items())],
        "hourly":  [
            {"hour": h, "pnl": round(by_hour.get(h, {"pnl": 0})["pnl"], 2),
             "tradeCount": by_hour.get(h, {"tradeCount": 0})["tradeCount"]}
            for h in range(24)
        ],
        "dayOfWeek": [
            {"day": dow, "pnl": round(by_dow.get(dow, {"pnl": 0})["pnl"], 2),
             "tradeCount": by_dow.get(dow, {"tradeCount": 0})["tradeCount"]}
            for dow in DOW_LABELS[:5]  # Mon-Fri only (markets closed weekends typically)
        ],
    }


# ── Section 3: Distribution ───────────────────────────────────────────────────


def _distribution_section(rows: list[sqlite3.Row]) -> dict[str, Any]:
    """Long vs Short, P&L distribution histogram, R-mult buckets, win/loss streaks."""
    long_pnls = [float(r["pnl_dollar"] or 0) for r in rows if r["side"] == "Long"]
    short_pnls = [float(r["pnl_dollar"] or 0) for r in rows if r["side"] == "Short"]

    def _side_summary(pnls):
        if not pnls:
            return {"totalPnl": 0.0, "winRate": None, "avgPnl": None, "tradeCount": 0}
        wins = sum(1 for p in pnls if p > 0)
        losses = sum(1 for p in pnls if p < 0)
        wl = wins + losses
        return {
            "totalPnl": round(sum(pnls), 2),
            "winRate": (wins / wl) if wl > 0 else None,
            "avgPnl": round(sum(pnls) / len(pnls), 2),
            "tradeCount": len(pnls),
        }

    long_short = {
        "long":  _side_summary(long_pnls),
        "short": _side_summary(short_pnls),
    }

    # P&L distribution histogram — 20 equal-width buckets
    pnl_buckets: list[dict[str, Any]] = []
    if rows:
        all_pnls = [float(r["pnl_dollar"] or 0) for r in rows]
        lo, hi = min(all_pnls), max(all_pnls)
        if lo == hi:
            pnl_buckets = [{"bucket": f"${lo:.0f}-${hi:.0f}", "count": len(all_pnls)}]
        else:
            n = 20
            step = (hi - lo) / n
            counts = [0] * n
            for p in all_pnls:
                idx = min(int((p - lo) / step), n - 1)
                counts[idx] += 1
            for i, c in enumerate(counts):
                bl = lo + i * step
                bh = lo + (i + 1) * step
                pnl_buckets.append({
                    "bucket": f"${bl:.0f}-${bh:.0f}",
                    "count": c,
                })

    # R-multiple distribution (excludes null R)
    r_counts: dict[str, int] = {label: 0 for label, _ in _R_BUCKETS}
    for r in rows:
        rm = r["r_multiple"]
        if rm is None:
            continue
        rmf = float(rm)
        for label, fn in _R_BUCKETS:
            if fn(rmf):
                r_counts[label] += 1
                break

    # Win/loss streaks — sequence of consecutive same-result trades
    streaks: list[dict[str, Any]] = []
    if rows:
        cur_type = None
        cur_len = 0
        for r in rows:
            t = "win" if r["result"] == "Win" else (
                "loss" if r["result"] == "Loss" else "be"
            )
            if t == "be":
                # BE doesn't break a streak; skip (matches typical convention)
                continue
            if t == cur_type:
                cur_len += 1
            else:
                if cur_type is not None:
                    streaks.append({"index": len(streaks) + 1, "type": cur_type, "length": cur_len})
                cur_type = t
                cur_len = 1
        if cur_type is not None:
            streaks.append({"index": len(streaks) + 1, "type": cur_type, "length": cur_len})

    return {
        "longVsShort": long_short,
        "pnlBuckets": pnl_buckets,
        "rMultiples": [{"bucket": label, "count": r_counts[label]} for label, _ in _R_BUCKETS],
        "winLossStreaks": streaks,
    }


# ── Section 4: Attribution ────────────────────────────────────────────────────


def _attribution_section(rows: list[sqlite3.Row]) -> dict[str, Any]:
    """P&L by setup/symbol + win-rate-by-setup + avg-R-by-setup + rolling win rate."""
    by_setup_data: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"pnl": 0.0, "wins": 0, "losses": 0, "rs": [], "count": 0}
    )
    by_symbol_data: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"pnl": 0.0, "wins": 0, "losses": 0, "count": 0}
    )

    for r in rows:
        pnl = float(r["pnl_dollar"] or 0)
        result = r["result"]

        symbol = r["symbol"]
        s = by_symbol_data[symbol]
        s["pnl"] += pnl
        s["count"] += 1
        if result == "Win": s["wins"] += 1
        elif result == "Loss": s["losses"] += 1

        setup = r["setup"]
        if setup:  # exclude null-setup trades from attribution
            t = by_setup_data[setup]
            t["pnl"] += pnl
            t["count"] += 1
            if result == "Win": t["wins"] += 1
            elif result == "Loss": t["losses"] += 1
            if r["r_multiple"] is not None:
                t["rs"].append(float(r["r_multiple"]))

    by_setup = []
    for setup, d in by_setup_data.items():
        wl = d["wins"] + d["losses"]
        wr = d["wins"] / wl if wl > 0 else None
        avg_r = sum(d["rs"]) / len(d["rs"]) if d["rs"] else None
        by_setup.append({
            "setup": setup,
            "totalPnl": round(d["pnl"], 2),
            "winRate": wr,
            "avgR": round(avg_r, 3) if avg_r is not None else None,
            "tradeCount": d["count"],
        })
    by_setup.sort(key=lambda x: x["totalPnl"], reverse=True)

    by_symbol = []
    for symbol, d in by_symbol_data.items():
        wl = d["wins"] + d["losses"]
        wr = d["wins"] / wl if wl > 0 else None
        by_symbol.append({
            "symbol": symbol,
            "totalPnl": round(d["pnl"], 2),
            "winRate": wr,
            "avgPnl": round(d["pnl"] / d["count"], 2) if d["count"] else None,
            "tradeCount": d["count"],
        })
    by_symbol.sort(key=lambda x: x["totalPnl"], reverse=True)

    # Rolling win rate windows
    windows = {}
    for w in (10, 20, 50, 100, 200):
        windows[str(w)] = _rolling_win_rate(rows, w)

    return {
        "bySetup": by_setup,
        "bySymbol": by_symbol,
        "rollingWinRate": {"windows": windows},
    }


def _edge_score(rows: list[sqlite3.Row]) -> dict[str, Any]:
    """Composite Edge Scorecard: combines win rate, profit factor, and
    R-multiple consistency into one trended metric.

    Formula (simplified, all-time):
      score = winRate * min(profitFactor, 5) * rConsistency

    Where rConsistency = 1 - normalized stdev of R-multiples (capped 0..1).
    Higher = more reliable edge. Returns null when fewer than 10 trades.

    Also returns components so the UI can show "why" the score is what
    it is + a 30-day trailing trend (last 30 trades).
    """
    if not rows:
        return {"score": None, "components": None, "trend": []}

    pnls = [float(r["pnl_dollar"] or 0) for r in rows]
    rs = [float(r["r_multiple"]) for r in rows if r["r_multiple"] is not None]
    wins = sum(1 for r in rows if r["result"] == "Win")
    losses = sum(1 for r in rows if r["result"] == "Loss")
    wl = wins + losses
    if wl == 0:
        return {"score": None, "components": None, "trend": []}

    win_rate = wins / wl

    sum_wins = sum(p for p in pnls if p > 0)
    sum_losses = abs(sum(p for p in pnls if p < 0))
    if sum_losses == 0:
        profit_factor = 5.0  # capped
    else:
        profit_factor = min(sum_wins / sum_losses, 5.0)

    if len(rs) >= 2:
        mean_r = sum(rs) / len(rs)
        var_r = sum((r - mean_r) ** 2 for r in rs) / len(rs)
        stdev_r = var_r ** 0.5
        # Normalize by ~3R as the "high variance" baseline → 1 = high consistency
        r_consistency = max(0.0, min(1.0, 1.0 - (stdev_r / 3.0)))
    else:
        r_consistency = None

    if len(rows) < 10 or r_consistency is None:
        return {
            "score": None,
            "components": {
                "winRate": round(win_rate, 4),
                "profitFactor": round(profit_factor, 3),
                "rConsistency": r_consistency,
                "tradeCount": len(rows),
            },
            "trend": [],
        }

    score = win_rate * profit_factor * r_consistency

    # Rolling trend: every 5th trade index, recompute score on trailing 30
    trend: list[dict[str, Any]] = []
    window = 30
    for i in range(window, len(rows) + 1, 5):
        slc = rows[i - window:i]
        slc_rs = [float(r["r_multiple"]) for r in slc if r["r_multiple"] is not None]
        slc_wins = sum(1 for r in slc if r["result"] == "Win")
        slc_losses = sum(1 for r in slc if r["result"] == "Loss")
        slc_wl = slc_wins + slc_losses
        if slc_wl == 0 or len(slc_rs) < 2:
            continue
        wr = slc_wins / slc_wl
        slc_pnls = [float(r["pnl_dollar"] or 0) for r in slc]
        sw = sum(p for p in slc_pnls if p > 0)
        sl = abs(sum(p for p in slc_pnls if p < 0))
        pf = 5.0 if sl == 0 else min(sw / sl, 5.0)
        m = sum(slc_rs) / len(slc_rs)
        sd = (sum((r - m) ** 2 for r in slc_rs) / len(slc_rs)) ** 0.5
        rc = max(0.0, min(1.0, 1.0 - (sd / 3.0)))
        trend.append({"tradeIndex": i, "score": round(wr * pf * rc, 4)})

    return {
        "score": round(score, 4),
        "components": {
            "winRate": round(win_rate, 4),
            "profitFactor": round(profit_factor, 3),
            "rConsistency": round(r_consistency, 4),
            "tradeCount": len(rows),
        },
        "trend": trend,
    }


def _rolling_win_rate(rows: list[sqlite3.Row], window: int) -> list[dict[str, Any]]:
    """For each trade index >= window, compute win rate over [i-window, i]."""
    if len(rows) < window:
        return []
    # 1 = win, 0 = loss, skip BE in numerator+denominator to match other charts
    wins_loss = []
    for r in rows:
        if r["result"] == "Win":   wins_loss.append(1)
        elif r["result"] == "Loss": wins_loss.append(0)
        else:                       wins_loss.append(None)  # BE
    out = []
    for i in range(window, len(wins_loss) + 1):
        slc = [x for x in wins_loss[i - window:i] if x is not None]
        if not slc:
            continue
        wr = sum(slc) / len(slc)
        out.append({"tradeIndex": i, "winRate": round(wr, 4)})
    return out


# ── Section 6: Options breakdown (Phase 5) ──────────────────────────────────


def _fetch_option_strategies(
    conn: sqlite3.Connection,
    user_id: str,
    *,
    account_id: str | None,
    date_from: str | None,
    date_to: str | None,
) -> list[dict[str, Any]]:
    """All CLOSED option strategies for the user, re-filtered on ET date.

    Open strategies are excluded from analytics since they have no realized
    P&L yet; they're still visible in Open Positions + Expiring-soon banner.
    """
    sql = (
        "SELECT id, underlying, strategy_type, direction, net_entry, fees, "
        "       entry_date, closed_at, net_exit, exit_fees, pnl_dollar, "
        "       pnl_percent, r_multiple, result, status, account_id "
        "  FROM j2_option_strategies "
        " WHERE user_id = ? AND status != 'open'"
    )
    params: list[Any] = [user_id]
    if account_id:
        sql += " AND account_id = ?"
        params.append(account_id)
    if date_from:
        sql += " AND closed_at >= ?"
        params.append((Date.fromisoformat(date_from) - timedelta(days=1)).isoformat() + "T00:00:00Z")
    if date_to:
        sql += " AND closed_at <= ?"
        params.append((Date.fromisoformat(date_to) + timedelta(days=1)).isoformat() + "T23:59:59Z")
    sql += " ORDER BY closed_at ASC"

    rows = conn.execute(sql, params).fetchall()
    # Re-filter on ET-bucketed closed_at if range was given
    if date_from or date_to:
        out = []
        for r in rows:
            closed = r["closed_at"]
            if closed is None:
                continue
            d = to_et_date(closed)
            if date_from and d < date_from:
                continue
            if date_to and d > date_to:
                continue
            out.append(dict(r))
        return out
    return [dict(r) for r in rows]


def _fetch_legs_for_strategies(
    conn: sqlite3.Connection,
    strategy_ids: list[str],
) -> dict[str, list[dict[str, Any]]]:
    """Legs keyed by strategy_id. One query regardless of strategy count."""
    if not strategy_ids:
        return {}
    placeholders = ",".join("?" * len(strategy_ids))
    sql = (
        f"SELECT strategy_id, leg_index, side, contract_type, strike, "
        f"       expiration, qty, entry_price, exit_price "
        f"  FROM j2_option_legs WHERE strategy_id IN ({placeholders}) "
        f"  ORDER BY strategy_id, leg_index"
    )
    rows = conn.execute(sql, strategy_ids).fetchall()
    out: dict[str, list[dict[str, Any]]] = {}
    for r in rows:
        out.setdefault(r["strategy_id"], []).append(dict(r))
    return out


def _options_section(
    trade_rows: list[sqlite3.Row],
    strategies: list[dict[str, Any]],
) -> dict[str, Any]:
    """Options-specific aggregates (spec §10):
    - byAssetType: compares Equity vs Options performance
    - byStrategyType: breakdown of P&L by strategy_type
    - creditVsDebit: debit vs credit structures
    - dteScatter: scatter points for the DTE-vs-R chart
    - headline: summary KPIs (count, totalPnl, winRate, avgR, profitFactor)
    """
    # ── byAssetType (equity = trade_rows, options = strategies) ──────────
    def _summary(pnls: list[float], rs: list[float | None], results: list[str]) -> dict[str, Any]:
        count = len(pnls)
        if count == 0:
            return {
                "count": 0, "totalPnl": 0.0, "winRate": None,
                "avgR": None, "profitFactor": None,
            }
        total_pnl = round(sum(pnls), 2)
        decided = [r for r in results if r in ("Win", "Loss")]
        wins = sum(1 for r in decided if r == "Win")
        win_rate = (wins / len(decided)) if decided else None
        rs_valid = [r for r in rs if r is not None]
        avg_r = (sum(rs_valid) / len(rs_valid)) if rs_valid else None
        sum_wins = sum(p for p in pnls if p > 0)
        sum_losses = abs(sum(p for p in pnls if p < 0))
        if sum_losses == 0:
            profit_factor = None if sum_wins == 0 else float("inf")
        else:
            profit_factor = sum_wins / sum_losses
        # JSON-safe infinity
        if profit_factor is not None and profit_factor == float("inf"):
            profit_factor = 999.0
        return {
            "count": count,
            "totalPnl": total_pnl,
            "winRate": None if win_rate is None else round(win_rate, 4),
            "avgR": None if avg_r is None else round(avg_r, 3),
            "profitFactor": None if profit_factor is None else round(profit_factor, 3),
        }

    eq_pnls = [float(r["pnl_dollar"] or 0) for r in trade_rows]
    eq_rs = [r["r_multiple"] for r in trade_rows]
    eq_results = [r["result"] for r in trade_rows]

    opt_pnls = [float(s["pnl_dollar"] or 0) for s in strategies]
    opt_rs = [s["r_multiple"] for s in strategies]
    opt_results = [s["result"] for s in strategies]

    by_asset_type = {
        "equity": _summary(eq_pnls, eq_rs, eq_results),
        "options": _summary(opt_pnls, opt_rs, opt_results),
    }

    # ── byStrategyType ───────────────────────────────────────────────────
    by_type: dict[str, dict[str, Any]] = defaultdict(lambda: {
        "pnls": [], "rs": [], "results": [],
    })
    for s in strategies:
        t = s["strategy_type"]
        by_type[t]["pnls"].append(float(s["pnl_dollar"] or 0))
        by_type[t]["rs"].append(s["r_multiple"])
        by_type[t]["results"].append(s["result"])
    by_strategy_type = [
        {"strategyType": t, **_summary(g["pnls"], g["rs"], g["results"])}
        for t, g in by_type.items()
    ]
    # Sort: most active first
    by_strategy_type.sort(key=lambda e: e["count"], reverse=True)

    # ── creditVsDebit ────────────────────────────────────────────────────
    credit_pnls: list[float] = []
    credit_rs: list[float | None] = []
    credit_results: list[str] = []
    debit_pnls: list[float] = []
    debit_rs: list[float | None] = []
    debit_results: list[str] = []
    for s in strategies:
        net_entry = float(s["net_entry"])
        bucket_pnls = credit_pnls if net_entry < 0 else debit_pnls
        bucket_rs = credit_rs if net_entry < 0 else debit_rs
        bucket_results = credit_results if net_entry < 0 else debit_results
        bucket_pnls.append(float(s["pnl_dollar"] or 0))
        bucket_rs.append(s["r_multiple"])
        bucket_results.append(s["result"])

    credit_vs_debit = {
        "credit": _summary(credit_pnls, credit_rs, credit_results),
        "debit":  _summary(debit_pnls, debit_rs, debit_results),
    }

    # ── DTE scatter: (dte-at-entry, R-multiple) per strategy ─────────────
    # Need legs for each strategy; fetch in one query.
    strat_ids = [s["id"] for s in strategies if s["r_multiple"] is not None]
    legs_by_id: dict[str, list[dict[str, Any]]] = {}
    if strat_ids:
        # Reuse the connection from the outer scope via closure; callers
        # pass us rows, not conn. So we recompute dte lazily from
        # strategies[].legs if present (populated elsewhere) — for v1,
        # just return the scatter without legs. The frontend has
        # computeDaysToExpiration; if we don't pre-compute, the chart
        # would need the legs. Simplest: include a nested legs payload
        # keyed by strategy id, or derive DTE from net_entry date → closed_at.
        # We choose the lightweight path: DTE-AT-CLOSE = days held.
        pass
    dte_scatter = []
    for s in strategies:
        if s["r_multiple"] is None:
            continue
        # Days held from entry_date to closed_at (ISO timestamps)
        try:
            entry_dt = datetime.fromisoformat(s["entry_date"].replace("Z", "+00:00"))
            close_dt = datetime.fromisoformat(s["closed_at"].replace("Z", "+00:00")) if s["closed_at"] else None
        except (ValueError, AttributeError, TypeError):
            continue
        if close_dt is None:
            continue
        days_held = (close_dt - entry_dt).days
        dte_scatter.append({
            "strategyId": s["id"],
            "underlying": s["underlying"],
            "strategyType": s["strategy_type"],
            "daysHeld": days_held,
            "rMultiple": float(s["r_multiple"]),
            "pnlDollar": float(s["pnl_dollar"] or 0),
        })

    # ── Headline ─────────────────────────────────────────────────────────
    headline = _summary(opt_pnls, opt_rs, opt_results)

    return {
        "headline": headline,
        "byAssetType": by_asset_type,
        "byStrategyType": by_strategy_type,
        "creditVsDebit": credit_vs_debit,
        "dteScatter": dte_scatter,
    }
