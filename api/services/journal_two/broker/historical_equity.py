"""Accurate daily portfolio-value reconstruction for broker accounts.

Pure core (API-free, deterministic): normalize activities → events → replay a
daily holdings+cash timeline → value each day against an injected price-lookup.
A thin Massive-backed fetcher + orchestrator wire it to real data.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Callable

from api.services.journal_two.broker import snaptrade_adapter as _adapter

logger = logging.getLogger(__name__)


def occ_symbol(underlying: str, expiration: str, contract_type: str, strike: float) -> str:
    """Build an OCC option ticker, e.g. O:AAPL260116C00200000."""
    yymmdd = str(expiration)[2:10].replace("-", "")           # YYYY-MM-DD → YYMMDD
    cp = "C" if str(contract_type).lower().startswith("c") else "P"
    strike_int = int(round(float(strike) * 1000))
    return f"O:{underlying.upper()}{yymmdd}{cp}{strike_int:08d}"


def replay_timeline(events: list[dict]) -> list[dict]:
    """Fold dated events into a daily timeline of cumulative holdings + cash.
    One row per distinct event date (ascending), reflecting state as of end of
    that date. Event kinds: stock / option / option_close / cash / split."""
    stocks: dict[str, float] = {}
    options: dict[str, float] = {}
    cash = 0.0
    by_date: dict[str, list[dict]] = {}
    for e in events:
        by_date.setdefault(e["date"][:10], []).append(e)

    out: list[dict] = []
    for d in sorted(by_date):
        for e in by_date[d]:
            k = e["kind"]
            if k == "stock":
                stocks[e["ticker"]] = stocks.get(e["ticker"], 0.0) + e["shares_delta"]
                cash += e.get("cash_delta", 0.0)
            elif k == "option":
                options[e["occ"]] = options.get(e["occ"], 0.0) + e["contracts_delta"]
                cash += e.get("cash_delta", 0.0)
            elif k == "option_close":
                options[e["occ"]] = 0.0
            elif k == "cash":
                cash += e["amount"]
            elif k == "split":
                if e["ticker"] in stocks:
                    stocks[e["ticker"]] *= e["factor"]
        out.append({
            "date": d,
            "stocks": {t: s for t, s in stocks.items() if abs(s) > 1e-9},
            "options": {o: c for o, c in options.items() if abs(c) > 1e-9},
            "cash": round(cash, 2),
        })
    return out


def value_timeline(timeline: list[dict], calendar_dates: list[str],
                   price_fn: Callable[[str, str, str], float | None]) -> list[dict]:
    """Mark each calendar date's holdings to market. price_fn(kind, symbol, date)
    returns a close or None; a missing price carries the last-known close forward,
    and a symbol that never prices flags the row partial (contributes 0). Holdings
    state is carried forward between event dates."""
    states = {r["date"]: r for r in timeline}
    last_close: dict[tuple[str, str], float] = {}
    cur = {"stocks": {}, "options": {}, "cash": 0.0}
    out: list[dict] = []
    for d in calendar_dates:
        if d in states:
            cur = states[d]
        partial = False
        equity = cur["cash"]
        for ticker, shares in cur["stocks"].items():
            c = price_fn("stock", ticker, d)
            if c is None:
                c = last_close.get(("stock", ticker))
            else:
                last_close[("stock", ticker)] = c
            if c is None:
                partial = True
            else:
                equity += shares * c
        for occ, contracts in cur["options"].items():
            c = price_fn("option", occ, d)
            if c is None:
                c = last_close.get(("option", occ))
            else:
                last_close[("option", occ)] = c
            if c is None:
                partial = True
            else:
                equity += contracts * c * 100
        out.append({"date": d, "equity": round(equity, 2), "estimated": False, "partial": partial})
    return out


def _partition(activities):
    return _adapter.partition(activities)


_OPT_LIFECYCLE = {"option_expiration", "option_assignment", "option_exercise"}


def events_from_account(user_id, account_id, broker_account_id, activities, cash_flows) -> list[dict]:
    """Normalize raw broker activities + the persisted cash-flow ledger into the
    event stream replay_timeline consumes."""
    part = _partition(activities)
    events: list[dict] = []

    for f in part.get("equity_fills", []):
        d = f.date[:10]
        gross = f.shares * f.price
        if f.action == "Buy":
            events.append({"kind": "stock", "date": d, "ticker": f.symbol,
                           "shares_delta": f.shares, "cash_delta": -(gross + f.fee)})
        else:
            events.append({"kind": "stock", "date": d, "ticker": f.symbol,
                           "shares_delta": -f.shares, "cash_delta": (gross - f.fee)})

    for ev in part.get("option_events", []):
        d = (ev.get("date") or "")[:10]
        occ = occ_symbol(ev["underlying"], ev["expiration"], ev["contractType"], ev["strike"])
        if ev.get("eventKind") in _OPT_LIFECYCLE:
            events.append({"kind": "option_close", "date": d, "occ": occ})
            continue
        contracts = ev.get("contracts") or 0
        price = ev.get("price") or 0.0
        fee = ev.get("fee") or 0.0
        gross = contracts * price * 100
        if ev.get("side") == "buy":
            events.append({"kind": "option", "date": d, "occ": occ,
                           "contracts_delta": contracts, "cash_delta": -(gross + fee)})
        elif ev.get("side") == "sell":
            events.append({"kind": "option", "date": d, "occ": occ,
                           "contracts_delta": -contracts, "cash_delta": (gross - fee)})

    for cf in (cash_flows or []):
        events.append({"kind": "cash", "date": cf["date"][:10], "amount": cf["amount"]})

    return events


# ── Data loaders (indirections so the orchestrator stays unit-testable) ───────

def _resolve_broker_account_id(user_id, account_id, conn=None):
    from api.services.auth_db import get_connection
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT id FROM j2_broker_accounts WHERE user_id=? AND j2_account_id=? "
            "ORDER BY created_at ASC LIMIT 1", (user_id, account_id)).fetchone()
        return row["id"] if row else None
    finally:
        if owned:
            conn.close()


def _load_activities(user_id, broker_account_id):
    from api.services.journal_two.broker import activities_store
    return activities_store.get_activities(user_id, broker_account_id)


def _load_cash_flows(user_id, account_id):
    from api.services.journal_two.broker import cashflow_store
    return cashflow_store.list_flows(user_id, account_id)


def _default_price_fn():
    """Memoized Massive-backed daily-close lookup. One fetch per symbol, indexed
    by ISO date. `_bounds[symbol] = (start, end)` should be set before use."""
    from api.services import massive
    cache: dict[str, dict[str, float]] = {}
    bounds: dict[str, tuple[str, str]] = {}

    def price_fn(kind, symbol, d):
        if symbol not in cache:
            start, end = bounds.get(symbol, (d, d))
            bars = massive.get_daily_agg(symbol, start, end,
                                         adjusted=False, map_symbol=(kind == "stock"))
            series: dict[str, float] = {}
            for b in bars:
                iso = date.fromtimestamp(b["t"] / 1000).isoformat()
                series[iso] = b.get("c")
            cache[symbol] = series
        return cache[symbol].get(d)

    price_fn._cache = cache
    price_fn._bounds = bounds
    return price_fn


def reconstruct_daily_equity(user_id, account_id, *, price_fn=None, live_equity=None,
                             today=None, conn=None) -> list[dict]:
    """True daily mark-to-market net-liq series for a broker account. Returns
    [{date, equity, estimated:False, partial}]; [] if no broker account / events."""
    bkid = _resolve_broker_account_id(user_id, account_id, conn=conn)
    if not bkid:
        return []
    activities = _load_activities(user_id, bkid)
    cash_flows = _load_cash_flows(user_id, account_id)
    events = events_from_account(user_id, account_id, bkid, activities, cash_flows)
    if not events:
        return []
    timeline = replay_timeline(events)

    dates = sorted({r["date"] for r in timeline})
    if today and today > dates[-1]:
        dates.append(today)

    if price_fn is None:
        price_fn = _default_price_fn()
        syms = {t for r in timeline for t in r["stocks"]} | {o for r in timeline for o in r["options"]}
        for s in syms:
            price_fn._bounds[s] = (dates[0], dates[-1])

    valued = value_timeline(timeline, dates, price_fn)
    if live_equity is not None and valued:
        valued[-1] = {**valued[-1], "equity": round(float(live_equity), 2)}
    return valued
