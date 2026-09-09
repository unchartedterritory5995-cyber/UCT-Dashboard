"""Forward estimates and revision trends for the research page.

All from yfinance analysis data (earnings_estimate / revenue_estimate /
eps_trend / eps_revisions) — free and available on yfinance 1.x. Run through
the bounded yfinance pool, cached 12h. A ticker with no estimate coverage at
all is a legitimately empty (not failed) result and still gets the full TTL.

2026-09-03 (dedicated Analyst Ratings slice, owner-authorized product-home
split): this module is narrowed to its honest scope -- EPS/revenue forward
estimates and revisions ONLY. Analyst consensus, price targets, and recent
rating-change actions (previously enriched here from FMP via
`analyst_grades.get_analyst_grades`, overriding yfinance's own thinner
`upgrades_downgrades` feed) now live in their own dedicated home:
`api/services/research/analyst_ratings.py`, rendered by
`AnalystRatingsTab.jsx`. Do not re-add analyst-grade content here -- that is
exactly the fragmentation this split exists to resolve.
"""
from __future__ import annotations

import logging
import math

from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services.yfinance_pool import run_in_pool
from api.services.research.entity_resolution import resolve_entity

_logger = logging.getLogger(__name__)

_CACHE_TTL = 43_200  # 12h -- only when both legs resolved
_FAIL_TTL = 300        # 5 min -- a partial/failed fetch self-heals fast

_PERIOD_LABEL = {"0q": "Current Qtr", "+1q": "Next Qtr", "0y": "Current Yr", "+1y": "Next Yr"}
_PERIOD_ORDER = ["0q", "+1q", "0y", "+1y"]


def _num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _cell(df, idx, col):
    if df is None or getattr(df, "empty", True):
        return None
    try:
        if idx in df.index and col in df.columns:
            return _num(df.loc[idx, col])
    except Exception:
        return None
    return None


def _forward(eps_df, rev_df):
    rows = []
    for p in _PERIOD_ORDER:
        eps_avg = _cell(eps_df, p, "avg")
        rev_avg = _cell(rev_df, p, "avg")
        if eps_avg is None and rev_avg is None:
            continue
        growth = _cell(eps_df, p, "growth")
        rows.append({
            "period": _PERIOD_LABEL.get(p, p),
            "eps_avg": eps_avg,
            "eps_low": _cell(eps_df, p, "low"),
            "eps_high": _cell(eps_df, p, "high"),
            "num_analysts": _cell(eps_df, p, "numberOfAnalysts"),
            "eps_growth": round(growth * 100, 1) if growth is not None else None,
            "rev_avg": rev_avg,
        })
    return rows


def _revisions(trend_df, rev_df):
    rows = []
    for p in _PERIOD_ORDER:
        cur = _cell(trend_df, p, "current")
        if cur is None:
            continue
        up = _cell(rev_df, p, "upLast30days")
        down = _cell(rev_df, p, "downLast30days")
        rows.append({
            "period": _PERIOD_LABEL.get(p, p),
            "current": cur,
            "ago30": _cell(trend_df, p, "30daysAgo"),
            "ago90": _cell(trend_df, p, "90daysAgo"),
            "up30": int(up) if up is not None else None,
            "down30": int(down) if down is not None else None,
        })
    return rows


def _fetch(sym):
    """Returns {} ONLY on a genuine pool-call exception -- see
    research/ownership.py's `_fetch_yf` docstring for the same contract."""
    def _do():
        import yfinance as yf
        t = yf.Ticker(sym)
        return {
            "eps_est": getattr(t, "earnings_estimate", None),
            "rev_est": getattr(t, "revenue_estimate", None),
            "eps_trend": getattr(t, "eps_trend", None),
            "eps_rev": getattr(t, "eps_revisions", None),
        }
    try:
        return run_in_pool(_do, timeout=15)
    except Exception as exc:
        _logger.warning("yf estimates fetch failed for %s: %s", sym, exc)
        return {}


def get_estimates(sym):
    sym = (sym or "").upper().strip()
    if not sym:
        return {}

    ck = f"research_est::{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    # No vendor= -- nothing here is FMP-routed since the 2026-09-03 narrowing
    # (analyst-grade content, the one FMP-backed leg this module used to
    # carry, now lives in analyst_ratings.py).
    entity, _ = resolve_entity(sym)

    raw = _fetch(sym)
    fetch_ok = bool(raw)   # {} means _fetch's exception path fired
    raw = raw or {}
    out = {
        "sym": sym,
        "entity": entity,
        "forward": _forward(raw.get("eps_est"), raw.get("rev_est")),
        "revisions": _revisions(raw.get("eps_trend"), raw.get("eps_rev")),
    }

    set_by_completeness(ck, out, complete=fetch_ok, ttl_ok=_CACHE_TTL, ttl_partial=_FAIL_TTL)
    return out
