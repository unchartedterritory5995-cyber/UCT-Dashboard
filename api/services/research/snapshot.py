"""Fundamental snapshot — one consolidated, card-optimized payload.

Composes the existing UCT Ratings (``get_ratings``) with the curated set of
MarketSmith-style "data box" fundamentals (``get_fundamentals``) into a single
response so a glanceable snapshot card (TickerPopup Fundamentals tab + research
Overview) makes ONE request instead of three.

Pure composition over services that are already cached (ratings 12h, fundamentals
30min); this adds a thin 30min envelope cache keyed by symbol. Never raises —
returns a null-safe skeleton on any failure so the card degrades gracefully.
"""
from __future__ import annotations

import logging

from api.services.cache import cache
from api.services.fundamentals import get_fundamentals
from api.services.research.ratings import get_ratings

_logger = logging.getLogger(__name__)

_CACHE_TTL = 1800  # 30 min — matches the fundamentals envelope


def _skeleton(sym: str) -> dict:
    return {
        "sym": sym,
        "name": None,
        "sector": None,
        "industry": None,
        "about": None,
        "composite": None,
        "components": {},
        "checkup": [],
        "method": None,
        "metrics": {},
    }


def get_snapshot(sym: str) -> dict:
    """Consolidated ratings + key fundamentals for the snapshot card."""
    sym = (sym or "").upper().strip()
    if not sym:
        return _skeleton("")

    ck = f"research_snapshot::{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    out = _skeleton(sym)

    fund: dict = {}
    try:
        fund = get_fundamentals(sym) or {}
    except Exception as exc:  # never raise to the router
        _logger.warning("snapshot: fundamentals failed for %s: %s", sym, exc)
    if "error" in fund:
        fund = {}

    rat: dict = {}
    try:
        rat = get_ratings(sym) or {}
    except Exception as exc:
        _logger.warning("snapshot: ratings failed for %s: %s", sym, exc)

    out["name"] = fund.get("name") or sym
    out["sector"] = fund.get("sector")
    out["industry"] = fund.get("industry")
    out["about"] = fund.get("about")  # longBusinessSummary — RH-style About section
    out["next_earnings"] = fund.get("next_earnings")  # ISO date or None (header chip)

    out["composite"] = rat.get("composite")
    out["components"] = rat.get("components") or {}
    out["checkup"] = rat.get("checkup") or []
    out["method"] = rat.get("method")
    out["basis"] = rat.get("basis")            # 'percentile' | 'absolute'
    out["universe_n"] = rat.get("universe_n")
    out["group_rs"] = rat.get("group_rs")            # RS percentile within sector
    out["group_sector_n"] = rat.get("group_sector_n")  # # names in sector pool

    # MarketSmith-style "data boxes" — curated, grouped on the frontend.
    out["metrics"] = {
        # Valuation
        "market_cap": fund.get("market_cap"),
        "pe_forward": fund.get("pe_forward"),
        "pe_trailing": fund.get("pe_trailing"),
        "peg": fund.get("peg"),
        "ps": fund.get("ps"),
        "pb": fund.get("pb"),
        # Growth (qtr vs year-ago, yfinance)
        "revenue_growth_pct": fund.get("revenue_growth_pct"),
        "earnings_growth_pct": fund.get("earnings_growth_pct"),
        # Profitability
        "roe_pct": fund.get("roe_pct"),
        "gross_margin_pct": fund.get("gross_margin_pct"),
        "operating_margin_pct": fund.get("operating_margin_pct"),
        "profit_margin_pct": fund.get("profit_margin_pct"),
        # Balance sheet / cash
        "debt_to_equity": fund.get("debt_to_equity"),
        "current_ratio": fund.get("current_ratio"),
        "free_cash_flow": fund.get("free_cash_flow"),
        # Price context
        "beta": fund.get("beta"),
        "avg_volume": fund.get("avg_volume"),   # 30-day avg daily volume — powers header RVOL
        "week52_high": fund.get("fifty_two_week_high"),
        "week52_low": fund.get("fifty_two_week_low"),
        "div_yield_pct": fund.get("dividend_yield_pct"),
        # Analyst
        "analyst_target_mean": fund.get("analyst_target_mean"),
        "analyst_recommendation": fund.get("analyst_recommendation"),
        "analyst_count": fund.get("analyst_count"),
    }

    cache.set(ck, out, _CACHE_TTL)
    return out
