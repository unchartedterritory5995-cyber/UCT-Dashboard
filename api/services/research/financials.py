"""Financials for the research page.

Annual (5yr) + quarterly (8q) revenue/EPS/margin growth grids come from
yfinance statement frames (known shape, free, reliable) run through the
bounded yfinance pool. Summary balance-sheet + profitability metrics reuse
the existing ``get_fundamentals`` service. No dependency on the untested FMP
``stable/*-statement`` endpoints — those can layer in later as an enhancement.

Cached 48h via the shared in-memory cache singleton -- but ONLY when every leg
(annual statement, quarterly statement, fundamentals summary) actually
resolved. A leg that failed (yfinance pool timeout/exception) gets the whole
payload cached at the short `_FAIL_TTL` instead, so a transient yfinance blip
self-heals in minutes rather than leaving the Financials tab blank for two
days (the original bug: a single 12s pool timeout poisoned the 48h cache with
an all-empty payload -- see `test_research_financials.py`). A ticker that
genuinely has, say, no quarterly statement is NOT the same as a failure: the
completeness check below distinguishes "the fetch raised" from "the fetch
succeeded and returned nothing," and only the former is a failure.
"""
from __future__ import annotations

import logging
import math

from api.services.cache import cache
from api.services.cache_policy import set_by_completeness
from api.services.fundamentals import get_fundamentals
from api.services.yfinance_pool import run_in_pool

_logger = logging.getLogger(__name__)

_CACHE_TTL = 172_800  # 48h -- only for a COMPLETE fetch (every leg resolved)
_FAIL_TTL = 300        # 5 min -- a partial/failed fetch self-heals fast

# yfinance income-statement row labels vary; try each in order.
_REVENUE = ["Total Revenue", "TotalRevenue", "Operating Revenue", "OperatingRevenue"]
_GROSS = ["Gross Profit", "GrossProfit"]
_OPINC = ["Operating Income", "OperatingIncome", "Total Operating Income As Reported"]
_NETINC = ["Net Income", "NetIncome", "Net Income Common Stockholders", "Net Income Continuous Operations"]
_EPS = ["Diluted EPS", "DilutedEPS", "Basic EPS", "BasicEPS"]


def _num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _series(df, names):
    for n in names:
        if n in df.index:
            return df.loc[n]
    return None


def _period_label(ts, quarterly):
    try:
        year, month = ts.year, ts.month
    except AttributeError:
        return str(ts)
    if quarterly:
        return f"Q{(month - 1) // 3 + 1} {year}"
    return str(year)


def _income_grid(df, n, quarterly):
    """Pure: turn a yfinance income-statement DataFrame into the grid rows.

    Columns are period-end dates; we order them newest-first and compute
    per-period margins + YoY growth (1 column back for annual, 4 for
    quarterly).
    """
    if df is None or getattr(df, "empty", True):
        return []

    cols = list(df.columns)
    try:
        cols = sorted(cols, reverse=True)
    except TypeError:
        pass

    rev = _series(df, _REVENUE)
    gross = _series(df, _GROSS)
    opinc = _series(df, _OPINC)
    netinc = _series(df, _NETINC)
    eps = _series(df, _EPS)

    yoy_back = 4 if quarterly else 1
    rows = []
    for i, c in enumerate(cols[:n]):
        r = _num(rev[c]) if rev is not None else None
        g = _num(gross[c]) if gross is not None else None
        o = _num(opinc[c]) if opinc is not None else None
        ni = _num(netinc[c]) if netinc is not None else None
        e = _num(eps[c]) if eps is not None else None

        def margin(x):
            return round(x / r * 100, 1) if (r and x is not None and r != 0) else None

        rev_yoy = eps_yoy = None
        j = i + yoy_back
        if j < len(cols):
            cb = cols[j]
            rp = _num(rev[cb]) if rev is not None else None
            ep = _num(eps[cb]) if eps is not None else None
            if rp and r is not None and rp != 0:
                rev_yoy = round((r - rp) / abs(rp) * 100, 1)
            if ep and e is not None and ep != 0:
                eps_yoy = round((e - ep) / abs(ep) * 100, 1)

        rows.append({
            "period": _period_label(c, quarterly),
            "revenue": r,
            "net_income": ni,
            "eps": e,
            "gross_margin": margin(g),
            "operating_margin": margin(o),
            "net_margin": margin(ni),
            "revenue_yoy": rev_yoy,
            "eps_yoy": eps_yoy,
        })
    return rows


def _fetch_income(sym, quarterly):
    """Return (df_or_None, ok). ``ok`` is False ONLY when the pool call itself
    raised (timeout or any yfinance error) -- a genuine provider failure. A
    successful call that returns an empty/short DataFrame (a young company
    with fewer than 5 years of statements, say) is `ok=True` -- that is real
    data, not a failure, and must not shorten the cache TTL."""
    def _do():
        import yfinance as yf
        t = yf.Ticker(sym)
        return t.quarterly_income_stmt if quarterly else t.income_stmt
    try:
        return run_in_pool(_do, timeout=12), True
    except Exception as exc:  # TimeoutError or any yfinance error → no data
        _logger.warning("yf income stmt failed for %s (q=%s): %s", sym, quarterly, exc)
        return None, False


def get_financials(sym):
    sym = (sym or "").upper().strip()
    if not sym:
        return {}

    ck = f"research_fin::{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    annual_df, annual_ok = _fetch_income(sym, False)
    quarterly_df, quarterly_ok = _fetch_income(sym, True)
    annual = _income_grid(annual_df, 5, False)
    quarterly = _income_grid(quarterly_df, 8, True)

    fund = {}
    fund_ok = True
    try:
        fund = get_fundamentals(sym) or {}
        if isinstance(fund, dict) and "error" in fund:
            # get_fundamentals never raises -- it negative-caches its own
            # failures into an {"error": ...} dict instead. That IS a failed
            # leg from this module's point of view.
            fund_ok = False
            fund = {}
    except Exception as exc:
        fund_ok = False
        _logger.warning("get_fundamentals failed for %s: %s", sym, exc)

    out = {
        "sym": sym,
        "annual": annual,
        "quarterly": quarterly,
        "balance": {
            "cash": fund.get("total_cash"),
            "total_debt": fund.get("total_debt"),
            "debt_to_equity": fund.get("debt_to_equity"),
            "current_ratio": fund.get("current_ratio"),
            "fcf": fund.get("free_cash_flow"),
        },
        "metrics": {
            "roe": fund.get("roe_pct"),
            "roa": fund.get("roa_pct"),
            "gross_margin": fund.get("gross_margin_pct"),
            "operating_margin": fund.get("operating_margin_pct"),
            "net_margin": fund.get("profit_margin_pct"),
        },
    }
    complete = annual_ok and quarterly_ok and fund_ok
    set_by_completeness(ck, out, complete=complete, ttl_ok=_CACHE_TTL, ttl_partial=_FAIL_TTL)
    return out
