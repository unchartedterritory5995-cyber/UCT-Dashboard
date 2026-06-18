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
