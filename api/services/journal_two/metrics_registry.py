"""Journal 2.0 — metrics registry: every popular metric as a composable card.

One truth, many cards: every compute here reads rows fetched with the SAME
predicate builders the audited analytics pipeline uses (`filters.trades_where`
+ `ANALYTICS_INCLUDED_SQL` + the `COALESCE(trading_day_et, exit_date)` spine)
and the SAME effective-R resolution (`analytics._effective_r_map`: stop-R wins,
True R fills stop-less broker trades). The books_audit cross-foot therefore
covers everything served from here by construction — customization can never
fork the truth.

SAMPLE-SIZE HONESTY (non-negotiable): every ratio gates on its own minimum and
returns null WITH counts below it (the CoverageLine idiom) — no metric ever
fabricates a number from a thin sample.

Cards: consistency · risk_ratios · payoff_kelly · time_intel · risk_per_trade
· period_compare, plus user CUSTOM KPIs — formulas over a whitelisted
vocabulary, evaluated by an AST-allowlist evaluator (numbers, + - * /, parens,
unary; no calls / attributes / subscripts / unknown names; division by zero →
null). Plan: docs/superpowers/plans/2026-08-21-custom-metrics-dashboard.md
"""

from __future__ import annotations

import ast
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable
from zoneinfo import ZoneInfo

from api.services.auth_db import get_connection
from api.services.journal_two import excursions_store
from api.services.journal_two.analytics import (
    _effective_r_map, _starting_balance,
)
from api.services.journal_two.filters import (
    ANALYTICS_INCLUDED_SQL, FilterSpec, trades_where,
)

_ET = ZoneInfo("America/New_York")

_MIN_TRADING_DAYS = 20      # risk_ratios gate
_MIN_DECISIVE = 20          # payoff_kelly gate
_TRADING_DAYS_PER_YEAR = 252
_EXPR_MAX_LEN = 200
_KPI_MAX = 12               # custom formulas per request

_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
_HOLD_BUCKETS = [
    ("same day", 0, 0), ("1-3d", 1, 3), ("4-10d", 4, 10),
    ("11-30d", 11, 30), (">30d", 31, 10 ** 9),
]


# ── Shared fetch (the one-truth spine) ───────────────────────────────────────

def _fetch_rows(
    conn: sqlite3.Connection, user_id: str, *,
    account_id: str | None, spec: FilterSpec,
) -> list[sqlite3.Row]:
    sql = (
        "SELECT id, symbol, side, shares, entry_price, entry_date, exit_price, "
        "       exit_date, original_stop, pnl_dollar, fees, r_multiple, "
        "       hold_days, result, trading_day_et, hour_et, external_id, source "
        "  FROM j2_trades WHERE user_id = ? "
        + ANALYTICS_INCLUDED_SQL
    )
    params: list[Any] = [user_id]
    if account_id:
        sql += " AND account_id = ?"
        params.append(account_id)
    frag, fparams = trades_where(spec)
    if frag:
        sql += " " + frag
        params.extend(fparams)
    sql += " ORDER BY COALESCE(trading_day_et, substr(exit_date,1,10)) ASC"
    return conn.execute(sql, params).fetchall()


def _day(r) -> str | None:
    d = r["trading_day_et"]
    if d:
        return str(d)[:10]
    e = r["exit_date"]
    return str(e)[:10] if e else None


def _net(r) -> float:
    return float(r["pnl_dollar"] or 0) - float(r["fees"] or 0)


def _daily_net(rows) -> list[tuple[str, float]]:
    by: dict[str, float] = {}
    for r in rows:
        d = _day(r)
        if d:
            by[d] = by.get(d, 0.0) + _net(r)
    return sorted(by.items())


# ── Context handed to every compute ─────────────────────────────────────────

@dataclass
class Ctx:
    conn: sqlite3.Connection
    user_id: str
    account_id: str | None
    spec: FilterSpec
    rows: list[sqlite3.Row]
    r_map: dict[Any, float]
    r_sources: dict[str, int]
    starting_balance: float


def _build_ctx(conn, user_id, account_id, spec) -> Ctx:
    rows = _fetch_rows(conn, user_id, account_id=account_id, spec=spec)
    exc_map = excursions_store.list_excursions_for_user(user_id, conn=conn)
    r_map, r_sources = _effective_r_map(rows, exc_map)
    start = _starting_balance(conn, user_id, account_id)
    return Ctx(conn, user_id, account_id, spec, rows, r_map, r_sources, start)


# ── Card computes ────────────────────────────────────────────────────────────

def _consistency(ctx: Ctx) -> dict[str, Any]:
    daily = _daily_net(ctx.rows)
    n = len(daily)
    if n == 0:
        return {"tradingDays": 0, "profitableDayPct": None, "dailyStdev": None,
                "largestDayShare": None, "top3DayShare": None,
                "bestDay": None, "worstDay": None}
    pnls = [p for _d, p in daily]
    prof = sum(1 for p in pnls if p > 0)
    mean = sum(pnls) / n
    stdev = (sum((p - mean) ** 2 for p in pnls) / n) ** 0.5 if n > 1 else None
    gross_profit = sum(p for p in pnls if p > 0)
    top = sorted(pnls, reverse=True)
    largest_share = (top[0] / gross_profit) if gross_profit > 0 else None
    top3_share = (sum(top[:3]) / gross_profit) if gross_profit > 0 else None
    best = max(daily, key=lambda t: t[1])
    worst = min(daily, key=lambda t: t[1])
    return {
        "tradingDays": n,
        "profitableDayPct": round(prof / n, 4),
        "dailyStdev": round(stdev, 2) if stdev is not None else None,
        # share of GROSS winning-day profit contributed by the single best /
        # best-3 days — the prop-firm dependency number. None when there is
        # no winning day (nothing to depend on), never fabricated.
        "largestDayShare": round(largest_share, 4) if largest_share is not None else None,
        "top3DayShare": round(min(top3_share, 1.0), 4) if top3_share is not None else None,
        "bestDay": {"date": best[0], "pnl": round(best[1], 2)},
        "worstDay": {"date": worst[0], "pnl": round(worst[1], 2)},
    }


def _risk_ratios(ctx: Ctx) -> dict[str, Any]:
    daily = _daily_net(ctx.rows)
    n = len(daily)
    base = {"tradingDays": n, "minTradingDays": _MIN_TRADING_DAYS,
            "sharpe": None, "sortino": None, "calmar": None,
            "annualizedReturn": None, "maxDrawdownPct": None}
    if n < _MIN_TRADING_DAYS or ctx.starting_balance <= 0:
        return base
    eq = ctx.starting_balance
    rets: list[float] = []
    peak = eq
    max_dd_pct = 0.0
    for _d, p in daily:
        rets.append(p / eq if eq > 0 else 0.0)
        eq += p
        peak = max(peak, eq)
        if peak > 0:
            max_dd_pct = min(max_dd_pct, (eq - peak) / peak)
    mean = sum(rets) / n
    var = sum((x - mean) ** 2 for x in rets) / n
    std = var ** 0.5
    downside = [x for x in rets if x < 0]
    dvar = sum(x ** 2 for x in downside) / n if downside else 0.0
    dstd = dvar ** 0.5
    ann_factor = _TRADING_DAYS_PER_YEAR ** 0.5
    sharpe = (mean / std * ann_factor) if std > 1e-12 else None
    sortino = (mean / dstd * ann_factor) if dstd > 1e-12 else None
    if ctx.starting_balance > 0 and eq > 0:
        ann_return = (eq / ctx.starting_balance) ** (_TRADING_DAYS_PER_YEAR / n) - 1
    else:
        ann_return = None
    calmar = (ann_return / abs(max_dd_pct)) if (
        ann_return is not None and max_dd_pct < -1e-9) else None
    base.update({
        "sharpe": round(sharpe, 3) if sharpe is not None else None,
        "sortino": round(sortino, 3) if sortino is not None else None,
        "calmar": round(calmar, 3) if calmar is not None else None,
        "annualizedReturn": round(ann_return, 4) if ann_return is not None else None,
        "maxDrawdownPct": round(max_dd_pct, 4),
    })
    return base


def _payoff_kelly(ctx: Ctx) -> dict[str, Any]:
    wins = [_net(r) for r in ctx.rows if r["result"] == "Win"]
    losses = [_net(r) for r in ctx.rows if r["result"] == "Loss"]
    decisive = len(wins) + len(losses)
    base = {"decisive": decisive, "minDecisive": _MIN_DECISIVE,
            "avgWin": None, "avgLoss": None, "payoff": None,
            "winRate": None, "kelly": None, "halfKelly": None}
    if decisive == 0:
        return base
    win_rate = len(wins) / decisive
    avg_win = (sum(wins) / len(wins)) if wins else None
    avg_loss = (abs(sum(losses)) / len(losses)) if losses else None
    payoff = (avg_win / avg_loss) if (avg_win and avg_loss and avg_loss > 1e-9) else None
    base.update({
        "winRate": round(win_rate, 4),
        "avgWin": round(avg_win, 2) if avg_win is not None else None,
        "avgLoss": round(avg_loss, 2) if avg_loss is not None else None,
        "payoff": round(payoff, 3) if payoff is not None else None,
    })
    if decisive >= _MIN_DECISIVE and payoff is not None and payoff > 0:
        kelly = win_rate - (1 - win_rate) / payoff
        base["kelly"] = round(kelly, 4)
        base["halfKelly"] = round(kelly / 2, 4)
    return base


def _time_intel(ctx: Ctx) -> dict[str, Any]:
    by_hour: dict[int, dict[str, Any]] = {}
    by_wd: dict[int, dict[str, Any]] = {}
    hour_unknown = 0
    for r in ctx.rows:
        net = _net(r)
        h = r["hour_et"]
        if h is None:
            hour_unknown += 1
        else:
            b = by_hour.setdefault(int(h), {"pnl": 0.0, "n": 0, "w": 0, "l": 0})
            b["pnl"] += net
            b["n"] += 1
            if r["result"] == "Win":
                b["w"] += 1
            elif r["result"] == "Loss":
                b["l"] += 1
        d = _day(r)
        if d:
            try:
                wd = datetime.strptime(d, "%Y-%m-%d").weekday()
            except ValueError:
                continue
            b = by_wd.setdefault(wd, {"pnl": 0.0, "n": 0, "w": 0, "l": 0})
            b["pnl"] += net
            b["n"] += 1
            if r["result"] == "Win":
                b["w"] += 1
            elif r["result"] == "Loss":
                b["l"] += 1

    def _fmt(b):
        wl = b["w"] + b["l"]
        return {"pnl": round(b["pnl"], 2), "trades": b["n"],
                "winRate": round(b["w"] / wl, 4) if wl else None}

    holds: list[dict[str, Any]] = []
    for label, lo, hi in _HOLD_BUCKETS:
        rs, pnl, cnt = [], 0.0, 0
        for r in ctx.rows:
            hd = r["hold_days"]
            if hd is None or not (lo <= hd <= hi):
                continue
            cnt += 1
            pnl += _net(r)
            rv = ctx.r_map.get(r["id"])
            if rv is not None:
                rs.append(rv)
        holds.append({
            "bucket": label, "trades": cnt, "pnl": round(pnl, 2),
            "avgR": round(sum(rs) / len(rs), 3) if rs else None,
        })
    return {
        "byHour": [{"hour": h, **_fmt(b)} for h, b in sorted(by_hour.items())],
        "hourUnknown": hour_unknown,
        "byWeekday": [{"weekday": _WEEKDAYS[wd], **_fmt(b)}
                      for wd, b in sorted(by_wd.items())],
        "holdBuckets": holds,
    }


def _risk_per_trade(ctx: Ctx) -> dict[str, Any]:
    risks: list[float] = []
    sources = {"stop": 0, "trueR": 0, "unknown": 0}
    for r in ctx.rows:
        stop, entry = r["original_stop"], r["entry_price"]
        shares = float(r["shares"] or 0)
        # A broker placeholder stop (stop == entry) is NOT a real stop.
        if (stop is not None and entry is not None
                and abs(float(stop) - float(entry)) > 1e-9 and shares > 0):
            risks.append(abs(float(entry) - float(stop)) * shares)
            sources["stop"] += 1
            continue
        rv = ctx.r_map.get(r["id"])
        net = _net(r)
        if rv is not None and abs(rv) > 1e-9:
            risks.append(abs(net / rv))
            sources["trueR"] += 1
        else:
            sources["unknown"] += 1
    if not risks:
        return {"sources": sources, "mean": None, "median": None,
                "p90": None, "max": None, "histogram": []}
    risks.sort()
    n = len(risks)
    median = risks[n // 2] if n % 2 else (risks[n // 2 - 1] + risks[n // 2]) / 2
    hist: list[dict[str, Any]] = []
    lo, hi = risks[0], risks[-1]
    if hi > lo:
        buckets = 8
        step = (hi - lo) / buckets
        counts = [0] * buckets
        for x in risks:
            counts[min(int((x - lo) / step), buckets - 1)] += 1
        hist = [{"bucket": f"${lo + i * step:.0f}-${lo + (i + 1) * step:.0f}",
                 "count": c} for i, c in enumerate(counts)]
    else:
        hist = [{"bucket": f"${lo:.0f}", "count": n}]
    return {
        "sources": sources,
        "mean": round(sum(risks) / n, 2),
        "median": round(median, 2),
        "p90": round(risks[min(n - 1, int(n * 0.9))], 2),
        "max": round(hi, 2),
        "histogram": hist,
    }


def _period_bounds(now_et: datetime) -> dict[str, tuple[str, str]]:
    y, m = now_et.year, now_et.month
    q = (m - 1) // 3
    qm = q * 3 + 1
    pq_y, pq_m = (y, qm - 3) if qm > 3 else (y - 1, 10)

    def _month_end(yy, mm):
        nxt_y, nxt_m = (yy, mm + 1) if mm < 12 else (yy + 1, 1)
        return f"{nxt_y:04d}-{nxt_m:02d}-01"

    return {
        "thisMonth": (f"{y:04d}-{m:02d}-01", _month_end(y, m)),
        "lastMonth": ((f"{y:04d}-{m - 1:02d}-01" if m > 1 else f"{y - 1:04d}-12-01"),
                      f"{y:04d}-{m:02d}-01"),
        "thisQuarter": (f"{y:04d}-{qm:02d}-01", _month_end(y, qm + 2)),
        "lastQuarter": (f"{pq_y:04d}-{pq_m:02d}-01", _month_end(pq_y, pq_m + 2)),
        "ytd": (f"{y:04d}-01-01", f"{y + 1:04d}-01-01"),
        "priorYtd": (f"{y - 1:04d}-01-01",
                     f"{y - 1:04d}-{m:02d}-{min(now_et.day, 28):02d}"),
    }


def _period_compare(ctx: Ctx) -> dict[str, Any]:
    # Comparison cards read the FULL book by design — the Scope date facet
    # does not re-scope "this month vs last" (documented in the plan). Non-
    # date facets (symbol/setup/side/tag) still apply.
    spec = ctx.spec.model_copy(update={"date_from": None, "date_to": None})
    rows = _fetch_rows(ctx.conn, ctx.user_id,
                       account_id=ctx.account_id, spec=spec)
    exc_map = excursions_store.list_excursions_for_user(ctx.user_id, conn=ctx.conn)
    r_map, _src = _effective_r_map(rows, exc_map)
    bounds = _period_bounds(datetime.now(_ET))

    def _slice(lo, hi):
        sl = [r for r in rows if (d := _day(r)) and lo <= d < hi]
        wins = sum(1 for r in sl if r["result"] == "Win")
        losses = sum(1 for r in sl if r["result"] == "Loss")
        wl = wins + losses
        rs = [rv for r in sl if (rv := r_map.get(r["id"])) is not None]
        return {
            "netPnl": round(sum(_net(r) for r in sl), 2),
            "trades": len(sl),
            "winRate": round(wins / wl, 4) if wl else None,
            "avgR": round(sum(rs) / len(rs), 3) if rs else None,
        }

    return {name: _slice(lo, hi) for name, (lo, hi) in bounds.items()}


def _fees_drag(ctx: Ctx) -> dict[str, Any]:
    gross = sum(float(r["pnl_dollar"] or 0) for r in ctx.rows)
    fees = sum(float(r["fees"] or 0) for r in ctx.rows)
    n = len(ctx.rows)
    gross_profit = sum(float(r["pnl_dollar"] or 0) for r in ctx.rows
                       if float(r["pnl_dollar"] or 0) > 0)
    return {
        "totalFees": round(fees, 2),
        "feesPerTrade": round(fees / n, 2) if n else None,
        # fees as a share of the profit the winners produced — the honest
        # "how much of my edge do costs eat" number (None with no winners)
        "feesVsGrossProfit": round(fees / gross_profit, 4) if gross_profit > 1e-9 else None,
        "netPnl": round(gross - fees, 2),
        "feeFreePnl": round(gross, 2),
        "trades": n,
    }


def _size_buckets(ctx: Ctx) -> dict[str, Any]:
    """Win rate + P&L by position size (entry notional) quartile — 'are my
    big bets better or worse than my small ones'."""
    sized = [(float(r["entry_price"]) * float(r["shares"]), r)
             for r in ctx.rows
             if r["entry_price"] is not None and r["shares"] is not None
             and float(r["shares"] or 0) > 0]
    if len(sized) < 4:
        return {"trades": len(sized), "buckets": []}
    notionals = sorted(v for v, _r in sized)
    n = len(notionals)
    qs = [notionals[n // 4], notionals[n // 2], notionals[(3 * n) // 4]]
    labels = [f"< ${qs[0]:,.0f}", f"${qs[0]:,.0f}-${qs[1]:,.0f}",
              f"${qs[1]:,.0f}-${qs[2]:,.0f}", f"> ${qs[2]:,.0f}"]
    buckets = [{"label": lab, "pnl": 0.0, "n": 0, "w": 0, "l": 0} for lab in labels]
    for v, r in sized:
        i = 0 if v < qs[0] else 1 if v < qs[1] else 2 if v < qs[2] else 3
        b = buckets[i]
        b["pnl"] += _net(r)
        b["n"] += 1
        if r["result"] == "Win":
            b["w"] += 1
        elif r["result"] == "Loss":
            b["l"] += 1
    out = []
    for b in buckets:
        wl = b["w"] + b["l"]
        out.append({"label": b["label"], "trades": b["n"],
                    "pnl": round(b["pnl"], 2),
                    "winRate": round(b["w"] / wl, 4) if wl else None})
    return {"trades": len(sized), "buckets": out}


_MC_PATHS = 1000
_MC_HORIZON = 100
_MC_MIN_TRADES = 30


def _monte_carlo(ctx: Ctx) -> dict[str, Any]:
    """Bootstrap simulation: resample the book's own per-trade net P&L with
    replacement to project the next _MC_HORIZON trades over _MC_PATHS paths.
    DETERMINISTIC (fixed seed) — the same book always projects the same
    distribution, so the card never flickers. Gated n>=30 trades: a thin
    sample resampled is still a thin sample, and pretending otherwise is
    exactly the fabrication this registry forbids."""
    import random as _random
    pnls = [_net(r) for r in ctx.rows]
    n = len(pnls)
    base = {"trades": n, "minTrades": _MC_MIN_TRADES, "horizon": _MC_HORIZON,
            "paths": _MC_PATHS, "terminal": None, "maxDrawdown": None,
            "probDown10": None, "probDown20": None}
    if n < _MC_MIN_TRADES:
        return base
    start = ctx.starting_balance if ctx.starting_balance > 0 else None
    rng = _random.Random(42)
    terminals: list[float] = []
    dds: list[float] = []
    down10 = down20 = 0
    for _p in range(_MC_PATHS):
        run = peak = 0.0
        max_dd = 0.0
        for _t in range(_MC_HORIZON):
            run += pnls[rng.randrange(n)]
            peak = max(peak, run)
            max_dd = min(max_dd, run - peak)
        terminals.append(run)
        dds.append(max_dd)
        if start:
            if max_dd <= -0.10 * start:
                down10 += 1
            if max_dd <= -0.20 * start:
                down20 += 1
    terminals.sort()
    dds.sort()

    def _pct(sorted_xs, q):
        return round(sorted_xs[min(len(sorted_xs) - 1, int(q * len(sorted_xs)))], 2)

    base.update({
        "terminal": {"p5": _pct(terminals, 0.05), "p50": _pct(terminals, 0.50),
                     "p95": _pct(terminals, 0.95)},
        "maxDrawdown": {"p50": _pct(dds, 0.50), "p95": _pct(dds, 0.05)},
        "probDown10": round(down10 / _MC_PATHS, 4) if start else None,
        "probDown20": round(down20 / _MC_PATHS, 4) if start else None,
    })
    return base


_DIV_TYPES = {"DIVIDEND", "STOCK_DIVIDEND"}
_INT_TYPES = {"INTEREST"}


def _dividends(ctx: Ctx) -> dict[str, Any]:
    """Dividend + interest income from the raw broker activities ledger
    (the portfolio-tracker staple). Cash rows are few, so raw_json is parsed
    Python-side; a row with no parsable amount is COUNTED as unparsed, never
    guessed. Manual-only accounts return zeros with count 0 (honest empty)."""
    import json as _json
    base = "user_id = ? AND activity_type = 'cash'"
    params: list[Any] = [ctx.user_id]
    if ctx.account_id:
        base += (" AND broker_account_id IN (SELECT id FROM j2_broker_accounts "
                 "WHERE user_id = ? AND j2_account_id = ?)")
        params += [ctx.user_id, ctx.account_id]
    rows = ctx.conn.execute(
        f"SELECT symbol, occurred_at, raw_json FROM j2_broker_activities "
        f" WHERE {base}", params,
    ).fetchall()

    div_total = int_total = 0.0
    count = unparsed = 0
    by_month: dict[str, float] = {}
    by_symbol: dict[str, float] = {}
    for r in rows:
        try:
            raw = _json.loads(r["raw_json"])
        except (ValueError, TypeError):
            unparsed += 1
            continue
        typ = str(raw.get("type") or "").strip().upper()
        if typ not in _DIV_TYPES and typ not in _INT_TYPES:
            continue
        try:
            amt = float(raw.get("amount"))
        except (TypeError, ValueError):
            unparsed += 1
            continue
        count += 1
        if typ in _INT_TYPES:
            int_total += amt
            continue
        div_total += amt
        ym = str(r["occurred_at"] or "")[:7]
        if ym:
            by_month[ym] = by_month.get(ym, 0.0) + amt
        sym = r["symbol"]
        if sym:
            by_symbol[sym] = by_symbol.get(sym, 0.0) + amt

    months = sorted(by_month.items())[-12:]
    top = sorted(by_symbol.items(), key=lambda kv: -kv[1])[:5]
    return {
        "dividendsTotal": round(div_total, 2),
        "interestTotal": round(int_total, 2),
        "count": count,
        "unparsed": unparsed,
        "byMonth": [{"month": m, "amount": round(v, 2)} for m, v in months],
        "topSymbols": [{"symbol": sym, "amount": round(v, 2)} for sym, v in top],
    }


# ── Custom-KPI vocabulary + AST-safe evaluator ──────────────────────────────

def build_vocabulary(ctx: Ctx) -> dict[str, float | None]:
    rows = ctx.rows
    gross = sum(float(r["pnl_dollar"] or 0) for r in rows)
    fees = sum(float(r["fees"] or 0) for r in rows)
    net = gross - fees
    wins = [_net(r) for r in rows if r["result"] == "Win"]
    losses = [_net(r) for r in rows if r["result"] == "Loss"]
    decisive = len(wins) + len(losses)
    daily = _daily_net(rows)
    sum_w = sum(p for p in wins if p > 0)
    sum_l = abs(sum(p for p in losses if p < 0))
    trs = [v for v in ctx.r_map.values()]
    # max drawdown on the cumulative net curve from 0
    run = peak = 0.0
    max_dd = 0.0
    for _d, p in daily:
        run += p
        peak = max(peak, run)
        max_dd = min(max_dd, run - peak)
    return {
        "net_pnl": round(net, 2),
        "gross_pnl": round(gross, 2),
        "fees": round(fees, 2),
        "trades": float(len(rows)),
        "wins": float(len(wins)),
        "losses": float(len(losses)),
        "win_rate": (len(wins) / decisive) if decisive else None,
        "avg_win": (sum(wins) / len(wins)) if wins else None,
        "avg_loss": (abs(sum(losses)) / len(losses)) if losses else None,
        "payoff": ((sum(wins) / len(wins)) / (abs(sum(losses)) / len(losses)))
                  if (wins and losses and abs(sum(losses)) > 1e-9) else None,
        "profit_factor": (sum_w / sum_l) if sum_l > 1e-9 else None,
        "expectancy": (net / len(rows)) if rows else None,
        "days_traded": float(len(daily)),
        "profitable_days": float(sum(1 for _d, p in daily if p > 0)),
        "avg_true_r": (sum(trs) / len(trs)) if trs else None,
        "max_drawdown": round(max_dd, 2),
    }


class _NullResult(Exception):
    """A variable was null / division by zero — the KPI is null, not an error."""


def eval_kpi_expr(expr: str, variables: dict[str, float | None]) -> dict[str, Any]:
    """Evaluate one custom-KPI formula. Allowed: numbers, the vocabulary
    names, + - * /, parentheses, unary +/-. Anything else (calls, attributes,
    subscripts, unknown names, comparisons) is rejected BY NAME. A null
    variable or division by zero yields value null, never an error page."""
    if not isinstance(expr, str) or not expr.strip():
        return {"value": None, "error": "empty expression"}
    if len(expr) > _EXPR_MAX_LEN:
        return {"value": None, "error": f"expression longer than {_EXPR_MAX_LEN} chars"}
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as e:
        return {"value": None, "error": f"syntax: {e.msg}"}

    def ev(node) -> float:
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant):
            if isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
                return float(node.value)
            raise ValueError("only numeric constants are allowed")
        if isinstance(node, ast.Name):
            if node.id not in variables:
                raise ValueError(f"unknown variable '{node.id}'")
            v = variables[node.id]
            if v is None:
                raise _NullResult()
            return float(v)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)):
            v = ev(node.operand)
            return -v if isinstance(node.op, ast.USub) else v
        if isinstance(node, ast.BinOp) and isinstance(
                node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            left, right = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.Mult):
                return left * right
            if abs(right) < 1e-12:
                raise _NullResult()
            return left / right
        raise ValueError(f"disallowed syntax: {type(node).__name__}")

    try:
        return {"value": round(ev(tree), 4), "error": None}
    except _NullResult:
        return {"value": None, "error": None}
    except ValueError as e:
        return {"value": None, "error": str(e)}


# ── Registry + entry point ──────────────────────────────────────────────────

@dataclass(frozen=True)
class MetricDef:
    key: str
    title: str
    description: str
    category: str
    compute: Callable[[Ctx], dict[str, Any]]


METRICS: dict[str, MetricDef] = {m.key: m for m in [
    MetricDef("consistency", "Consistency",
              "Profitable-day %, daily P&L volatility, and how much of your "
              "profit depends on your best day(s).", "discipline", _consistency),
    MetricDef("risk_ratios", "Sharpe / Sortino / Calmar",
              "Institutional risk-adjusted return ratios on your daily equity "
              "returns (annualized).", "risk", _risk_ratios),
    MetricDef("payoff_kelly", "Payoff & Kelly",
              "Average win vs average loss, and the position-sizing fraction "
              "your actual edge implies.", "risk", _payoff_kelly),
    MetricDef("time_intel", "Time Intelligence",
              "Performance by hour of day, weekday, and hold-time bucket.",
              "timing", _time_intel),
    MetricDef("risk_per_trade", "Risk per Trade",
              "Distribution of dollars actually risked per trade (stop "
              "distance, or True-R-implied for stop-less broker trades).",
              "risk", _risk_per_trade),
    MetricDef("period_compare", "Period Comparison",
              "This month/quarter/YTD vs the previous — net P&L, win rate, "
              "trades, avg R.", "progress", _period_compare),
    MetricDef("fees_drag", "Fees Drag",
              "What commissions and fees actually cost your edge.",
              "costs", _fees_drag),
    MetricDef("size_buckets", "Performance by Size",
              "Win rate and P&L by position-size quartile — are your big "
              "bets better or worse than your small ones?", "risk",
              _size_buckets),
    MetricDef("monte_carlo", "Monte Carlo Projection",
              "1,000 bootstrap paths of your next 100 trades from your own "
              "P&L distribution — terminal range, drawdown odds.",
              "risk", _monte_carlo),
    MetricDef("dividends", "Dividends & Interest",
              "Income the broker paid you — dividends by month and symbol, "
              "plus interest.", "income", _dividends),
]}

VOCABULARY_KEYS = [
    "net_pnl", "gross_pnl", "fees", "trades", "wins", "losses", "win_rate",
    "avg_win", "avg_loss", "payoff", "profit_factor", "expectancy",
    "days_traded", "profitable_days", "avg_true_r", "max_drawdown",
]


def registry_listing() -> list[dict[str, Any]]:
    return [{"key": m.key, "title": m.title, "description": m.description,
             "category": m.category} for m in METRICS.values()] + [{
        "key": "custom", "title": "Custom KPI",
        "description": "Your own formula over: " + ", ".join(VOCABULARY_KEYS),
        "category": "custom", "vocabulary": VOCABULARY_KEYS,
    }]


def compute_metrics(
    user_id: str,
    keys: list[str],
    *,
    kpis: list[tuple[str, str]] | None = None,
    account_id: str | None = None,
    spec: FilterSpec | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Batched card compute: {metrics: {key: payload}, custom: [{name, value,
    error}], unknownKeys: [...]} — unknown keys are REPORTED, never silently
    dropped."""
    spec = spec or FilterSpec()
    own = conn is None
    conn = conn or get_connection()
    try:
        ctx = _build_ctx(conn, user_id, account_id, spec)
        out: dict[str, Any] = {}
        unknown: list[str] = []
        for k in keys:
            m = METRICS.get(k)
            if m is None:
                unknown.append(k)
            else:
                out[k] = m.compute(ctx)
        custom: list[dict[str, Any]] = []
        if kpis:
            vocab = build_vocabulary(ctx)
            for name, expr in kpis[:_KPI_MAX]:
                res = eval_kpi_expr(expr, vocab)
                custom.append({"name": name, "expr": expr, **res})
        return {"metrics": out, "custom": custom, "unknownKeys": unknown,
                "tradeCount": len(ctx.rows), "rSources": ctx.r_sources}
    finally:
        if own:
            conn.close()
