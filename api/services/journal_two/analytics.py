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
from api.services.journal_two import excursions_store
from api.services.journal_two.calendar import _row_et_day, to_et_date
from api.services.journal_two.trade_refs import trade_ref_for_row


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

        # trade_ref → excursion dict (all of the user's persisted excursions;
        # keyed by the stable trade_ref so it survives broker resync). The
        # Exit Quality aggregate joins the fetched rows against this map.
        excursions_map = excursions_store.list_excursions_for_user(user_id, conn=conn)

        return {
            "tradeCount": len(rows),
            "strategyCount": len(strategies),
            "dateRange": {"from": date_from, "to": date_to},
            "equity": _equity_section(rows, starting_balance),
            "performance": _performance_section(rows),
            "distribution": _distribution_section(rows),
            "attribution": _attribution_section(rows),
            "edgeScore": _edge_score(rows),
            "exitQuality": _exit_quality_section(rows, excursions_map, strategies),
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
        "       account_id, trading_day_et, hour_et, "
        "       id, external_id, source "  # for trade_ref → excursion join (Task 7)
        "  FROM j2_trades "
        " WHERE user_id = ?"
    )
    params: list[Any] = [user_id]
    if account_id:
        sql += " AND account_id = ?"
        params.append(account_id)
    # Rows with a stamped trading_day_et are range-filtered directly on the
    # spine column; legacy NULL rows keep the old ±1-day UTC buffer (the
    # Python re-filter below applies to_et_date to exactly those rows).
    if date_from:
        sql += (" AND (COALESCE(trading_day_et, '') >= ?"
                " OR (trading_day_et IS NULL AND exit_date >= ?))")
        params.append(date_from)
        params.append((Date.fromisoformat(date_from) - timedelta(days=1)).isoformat() + "T00:00:00Z")
    if date_to:
        sql += (" AND (COALESCE(trading_day_et, '~') <= ?"
                " OR (trading_day_et IS NULL AND exit_date <= ?))")
        params.append(date_to)
        params.append((Date.fromisoformat(date_to) + timedelta(days=1)).isoformat() + "T23:59:59Z")
    sql += " ORDER BY exit_date ASC"

    rows = conn.execute(sql, params).fetchall()

    # Re-filter on the ET trading day if a range was given. Spine rows use
    # the column (a no-op re-check of the SQL filter); legacy NULL rows get
    # exactly the pre-spine to_et_date behavior.
    if date_from or date_to:
        out = []
        for r in rows:
            d = (
                r["trading_day_et"]
                if "trading_day_et" in r.keys() and r["trading_day_et"]
                else to_et_date(r["exit_date"])
            )
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

    # Aggregate per ET trading day (spine column, legacy to_et_date fallback)
    by_day: dict[str, float] = defaultdict(float)
    for r in rows:
        d = _row_et_day(r, "exit_date")
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
        d_str = _row_et_day(r, "exit_date")
        d = Date.fromisoformat(d_str)

        by_day[d_str] += pnl

        # ISO week start Monday
        monday = d - timedelta(days=d.weekday())
        by_week[monday.isoformat()] += pnl

        by_month[d.strftime("%Y-%m")] += pnl
        by_year[d.year] += pnl

        # Hour in ET — read the stamped hour_et column ONLY. Rows with a
        # NULL hour_et (date-only trades) are EXCLUDED from the hour
        # histogram by design (spec §3: they were fake midnight/8PM ET
        # clusters, not real execution times). No timestamp fallback.
        h = r["hour_et"] if "hour_et" in r.keys() else None
        if h is not None:
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


# ── Section 5: Exit Quality (Journal A+ Phase 2, Task 7) ─────────────────────


# Efficiency histogram bins: [0-0.25), [0.25-0.5), [0.5-0.75), [0.75-1.0].
# The top bin is inclusive of 1.0 (exit_efficiency is clamped to [0,1] upstream).
_EFFICIENCY_BINS = [
    ("0-25%",   lambda e: e < 0.25),
    ("25-50%",  lambda e: e < 0.5),
    ("50-75%",  lambda e: e < 0.75),
    ("75-100%", lambda e: True),
]

_COVERAGE_READY_RATIO = 0.9
_EXIT_QUALITY_MIN_COMPUTED = 10

# "Potential" equity curve assumption: you'd have captured 80% of each trade's
# favorable excursion (MFE) with better exits. A bounded, HONEST what-if — you
# never nail the exact top, and per-trade potential is floored at what you
# actually realized (max(realized, 0.8*mfeR)), so the potential curve can never
# dip below the actual curve or invent an R you couldn't have made. R is the
# unit; no fabricated dollars.
_AVP_MFE_CAPTURE_FRACTION = 0.8


def _exit_moment_key(row) -> tuple:
    """Ascending sort key = the trade's exit moment. Parse exit_date (ISO);
    fall back to the trading_day_et spine, then a stable empty key. The leading
    tier int keeps heterogeneous fallbacks from comparing float-vs-str, and a
    STABLE sort over it means same-moment ties keep input (SQL exit_date ASC)
    order."""
    keys = row.keys()
    ed = row["exit_date"] if "exit_date" in keys else None
    if ed:
        try:
            dt = datetime.fromisoformat(str(ed).replace("Z", "+00:00"))
            # A date-only exit_date parses NAIVE; interpret it as UTC (matching
            # the full-ISO path) so .timestamp() doesn't apply the host's local
            # offset — which would reorder same-day curve points on a non-UTC host.
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return (0, dt.timestamp())
        except (ValueError, TypeError):
            return (1, str(ed))
    tde = row["trading_day_et"] if "trading_day_et" in keys else None
    return (2, str(tde) if tde else "")


def _exit_quality_section(
    rows: list[sqlite3.Row], excursions_map: dict[str, dict],
    strategies: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Exit-quality aggregate over the closed EQUITY trades, joined to their
    persisted excursions (MFE/MAE/exit-efficiency).

    Coverage-gated + n<10 shaded, mirroring `_edge_score`'s None-with-counts
    pattern so the FE can explain *why* a number is missing:

      - `coverage` = {eligible (all equity rows), computed (rows with a REAL —
        non-insufficient, non-underlying — excursion)}.
      - `coverageReady` = computed/eligible >= 0.9 (and eligible > 0).
      - When NOT coverageReady OR computed < 10 → the aggregate fields are None
        (the counts stay populated so the UI shows "computed from N of M").
      - When ready AND computed >= 10 → real `avgExitEfficiency` (mean over rows
        with a non-null efficiency; a null efficiency = no-favorable move, EXCLUDED
        from the mean but still counted as computed), `efficiencyBuckets` histogram,
        `missedRTotal`/`avgMissedR`, and `actualVsPotential` — cumulative realized-R
        vs cumulative-potential-R curves (the equity you'd have with better exits),
        ordered by exit date. `actualVsPotential` is None when NOT ready / n<10,
        and `[]` when fewer than 2 rows are computable (a curve needs >= 2 points).

    `missedDollars` is deliberately OMITTED: R is the only honest unit here. A
    per-trade "missed $" would need risk-$-per-trade, which isn't among the
    fetched columns; deriving it as pnl_dollar / r_multiple is fee-contaminated
    and undefined at r_multiple None/0, so we report the excursions' native R
    rather than fabricate a dollar figure.

    Options-derived excursions (data_quality='underlying') are equity-only
    excluded from every aggregate; `optionsExcluded` counts the user's closed
    option strategies that DO have a computed underlying excursion (they key on
    id:<strategy_id> in `excursions_map`, distinct from equity id:<trade_id> /
    ext: refs — so an equity row can never resolve to one).
    """
    eligible = len(rows)

    computed_pairs: list[tuple] = []  # (row, exc) for the REAL excursions
    for r in rows:
        exc = excursions_map.get(trade_ref_for_row(r))
        if exc is None:
            continue
        dq = exc.get("dataQuality")
        # 'insufficient' = no bars; 'underlying' = an options excursion mis-keyed
        # onto an equity ref (shouldn't happen — options key id:<strategy_id>).
        # Either way it isn't a real equity excursion → not counted as computed.
        if dq in ("underlying", "insufficient"):
            continue
        computed_pairs.append((r, exc))

    # Honest options-excluded count: closed option strategies (already scoped to
    # this account/date range by the caller's fetch) that have a computed
    # underlying-move excursion. This surfaces the deliberate equity-only omission
    # truthfully — the old equity-loop count was structurally always 0 because
    # equity refs never match an option strategy's id:<strategy_id> excursion.
    options_excluded = sum(
        1 for s in (strategies or [])
        if (excursions_map.get(f"id:{s['id']}") or {}).get("dataQuality") == "underlying"
    )

    computed = [exc for _row, exc in computed_pairs]
    computed_n = len(computed)
    coverage = {
        "eligible": eligible,
        "computed": computed_n,
        "optionsExcluded": options_excluded,
    }
    coverage_ready = eligible > 0 and (computed_n / eligible) >= _COVERAGE_READY_RATIO

    # Gate: not enough coverage OR too few computed → suppress the aggregates
    # but hand back the counts (imitates _edge_score's None-with-counts shape).
    if not coverage_ready or computed_n < _EXIT_QUALITY_MIN_COMPUTED:
        return {
            "coverage": coverage,
            "coverageReady": coverage_ready,
            "avgExitEfficiency": None,
            "efficiencySampleSize": None,
            "efficiencyExcludedNoFavorable": None,
            "missedRTotal": None,
            "avgMissedR": None,
            "missedRSampleSize": None,
            "efficiencyBuckets": [],
            "actualVsPotential": None,
        }

    # ── Exit efficiency (null = no-favorable, excluded from the mean) ────────
    effs = [
        float(e["exitEfficiency"])
        for e in computed
        if e.get("exitEfficiency") is not None
    ]
    excluded_no_favorable = computed_n - len(effs)
    avg_efficiency = round(sum(effs) / len(effs), 4) if effs else None

    bin_counts = [0] * len(_EFFICIENCY_BINS)
    for e in effs:
        for i, (_label, fn) in enumerate(_EFFICIENCY_BINS):
            if fn(e):
                bin_counts[i] += 1
                break
    efficiency_buckets = [
        {"bucket": label, "count": bin_counts[i]}
        for i, (label, _fn) in enumerate(_EFFICIENCY_BINS)
    ]

    # ── Missed R (favorable R left on the table) — the honest unit ───────────
    missed = [
        float(e["missedR"]) for e in computed if e.get("missedR") is not None
    ]
    missed_r_total = round(sum(missed), 4) if missed else None
    avg_missed_r = round(sum(missed) / len(missed), 4) if missed else None

    # ── Actual vs Potential cumulative-R curves ──────────────────────────────
    # Two equity curves in R, ordered by exit date: what you actually banked
    # (cumulative realized r_multiple) vs what you'd have with better exits
    # (cumulative per-trade potential = max(realized, 0.8*mfeR) — capture 80% of
    # the favorable move, never below realized). Only rows with a real excursion
    # AND a non-null r_multiple are plotted; a curve needs >= 2 points, else [].
    avp_pairs = [
        (r, exc) for (r, exc) in computed_pairs if r["r_multiple"] is not None
    ]
    avp_pairs.sort(key=lambda pair: _exit_moment_key(pair[0]))  # stable → exit-date ASC, ties keep input order
    actual_vs_potential: list[dict[str, Any]] = []
    if len(avp_pairs) >= 2:
        cum_actual = 0.0
        cum_potential = 0.0
        for i, (r, exc) in enumerate(avp_pairs, start=1):
            realized = float(r["r_multiple"])
            mfe_r = exc.get("mfeR")
            per_trade_potential = (
                max(realized, _AVP_MFE_CAPTURE_FRACTION * float(mfe_r))
                if mfe_r is not None else realized
            )
            cum_actual += realized
            cum_potential += per_trade_potential
            actual_vs_potential.append({
                "i": i,
                "actual": round(cum_actual, 4),
                "potential": round(cum_potential, 4),
            })

    return {
        "coverage": coverage,
        "coverageReady": True,
        "avgExitEfficiency": avg_efficiency,
        "efficiencySampleSize": len(effs),
        "efficiencyExcludedNoFavorable": excluded_no_favorable,
        "missedRTotal": missed_r_total,
        "avgMissedR": avg_missed_r,
        "missedRSampleSize": len(missed),
        "efficiencyBuckets": efficiency_buckets,
        "actualVsPotential": actual_vs_potential,
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
        "       pnl_percent, r_multiple, result, status, account_id, "
        "       trading_day_et "
        "  FROM j2_option_strategies "
        " WHERE user_id = ? AND status != 'open'"
    )
    params: list[Any] = [user_id]
    if account_id:
        sql += " AND account_id = ?"
        params.append(account_id)
    # Spine rows filter on trading_day_et; legacy NULL rows keep the old
    # ±1-day UTC buffer + Python to_et_date re-filter.
    if date_from:
        sql += (" AND (COALESCE(trading_day_et, '') >= ?"
                " OR (trading_day_et IS NULL AND closed_at >= ?))")
        params.append(date_from)
        params.append((Date.fromisoformat(date_from) - timedelta(days=1)).isoformat() + "T00:00:00Z")
    if date_to:
        sql += (" AND (COALESCE(trading_day_et, '~') <= ?"
                " OR (trading_day_et IS NULL AND closed_at <= ?))")
        params.append(date_to)
        params.append((Date.fromisoformat(date_to) + timedelta(days=1)).isoformat() + "T23:59:59Z")
    sql += " ORDER BY closed_at ASC"

    rows = conn.execute(sql, params).fetchall()
    # Re-filter on the ET trading day if a range was given (spine wins;
    # legacy NULL rows get exactly the pre-spine behavior).
    if date_from or date_to:
        out = []
        for r in rows:
            if "trading_day_et" in r.keys() and r["trading_day_et"]:
                d = r["trading_day_et"]
            else:
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
