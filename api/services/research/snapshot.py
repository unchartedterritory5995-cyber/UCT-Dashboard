"""Fundamental snapshot — one consolidated, card-optimized payload.

Composes the existing UCT Ratings (``get_ratings``) with the curated set of
MarketSmith-style "data box" fundamentals (``get_fundamentals``) into a single
response so a glanceable snapshot card (TickerPopup Fundamentals tab + research
Overview) makes ONE request instead of three.

Pure composition over services that are already cached (ratings 12h, fundamentals
30min); this adds a thin 30min envelope cache keyed by symbol. Never raises —
returns a null-safe skeleton on any failure so the card degrades gracefully.

Serve path is stale-while-revalidate over a persistent disk snapshot
(fundamentals_snapshot_store): the yfinance/ratings composition never blocks a
repeat view — an expired snapshot (≤2 days) returns instantly while a
background thread rebuilds it.
"""
from __future__ import annotations

import logging
import threading

from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services import fundamentals_snapshot_store as snap_store
from api.services.fundamentals import get_fundamentals
from api.services.research.ratings import get_ratings

_logger = logging.getLogger(__name__)

_CACHE_TTL = 1800  # 30 min — matches the fundamentals envelope
_FAIL_TTL = 300    # 5 min — an all-null composition self-heals fast instead of
                   # hiding a lower-level service's own (much shorter) recovery
_SNAP_KIND = "research_snapshot"
_STALE_SERVE_MAX = 2 * 86400   # serve an expired snapshot up to 2 days old while refreshing


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


_refresh_inflight: set[str] = set()
_refresh_lock = threading.Lock()


def _schedule_refresh(sym: str) -> None:
    """Background rebuild after a stale-serve (deduped per symbol)."""
    with _refresh_lock:
        if sym in _refresh_inflight:
            return
        _refresh_inflight.add(sym)

    def _run():
        try:
            _build_snapshot(sym)
        except Exception as exc:
            _logger.warning("snapshot bg refresh failed for %s: %s", sym, exc)
        finally:
            with _refresh_lock:
                _refresh_inflight.discard(sym)

    threading.Thread(target=_run, daemon=True, name=f"research-snap-refresh-{sym}").start()


def get_snapshot(sym: str) -> dict:
    """Consolidated ratings + key fundamentals for the snapshot card."""
    sym = (sym or "").upper().strip()
    if not sym:
        return _skeleton("")

    ck = f"research_snapshot::{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    snap = snap_store.get(_SNAP_KIND, sym)
    if snap is not None:
        payload, age, ttl = snap
        if age <= ttl:
            cache.set(ck, payload, max(60, int(ttl - age)))
            return payload
        if age <= _STALE_SERVE_MAX:
            cache.set(ck, payload, 60)
            _schedule_refresh(sym)
            return payload

    return _build_snapshot(sym)


def _build_snapshot(sym: str) -> dict:
    """Live composition; populates memory + disk."""
    ck = f"research_snapshot::{sym}"
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
    # How much of the intended composite the score measured — NOT `basis`,
    # which is the scoring method. Must be carried here or the snapshot
    # surface (TickerPopup + research Overview) shows a partial composite with
    # no disclosure while the Ratings tab discloses it. See ratings._coverage.
    out["coverage"] = rat.get("coverage")
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

    # `complete` gates BOTH the memory cache write and the disk persist — a
    # transient all-null composition (both `get_fundamentals`/`get_ratings`
    # failed) used to still get the full 30-min memory TTL even though the
    # persist below was already correctly guarded against it, which meant a
    # request landing seconds after the blip would see a needlessly stale
    # blank instead of retrying quickly.
    complete = out["composite"] is not None or out["name"] != sym or any(
        v is not None for v in out["metrics"].values()
    )
    set_by_completeness(
        ck, out, complete=complete, ttl_ok=_CACHE_TTL, ttl_partial=_FAIL_TTL,
        persist=lambda v: snap_store.put(_SNAP_KIND, sym, v, _CACHE_TTL),
    )
    return out
