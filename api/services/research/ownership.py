"""Ownership for the research page: institutional holders, short interest /
float, and insider activity.

Institutional + short/float come from yfinance (info + institutional_holders)
via the bounded pool; insider activity reuses the existing Finnhub-backed
``get_insider_activity`` service. Cached 12h.
"""
from __future__ import annotations

import datetime
import logging
import math

from api.services import earnings_estimates as ee
from api.services.cache import cache
from api.services.insider import get_insider_activity
from api.services.yfinance_pool import run_in_pool

_logger = logging.getLogger(__name__)

_CACHE_TTL = 43_200  # 12h
_TF_MAX_HOLDERS = 12   # top institutional holders to surface


def _num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _pct(frac):
    """fraction (0.0073) -> percent (0.73), rounded."""
    f = _num(frac)
    return round(f * 100, 2) if f is not None else None


def _institutional(holders_df, info):
    info = info or {}
    out = {"pct_held": _pct(info.get("heldPercentInstitutions")), "holders": []}
    if holders_df is None or getattr(holders_df, "empty", True):
        return out

    def col(row, *names):
        for n in names:
            if n in row.index:
                return row[n]
        return None

    try:
        rows = list(holders_df.head(8).iterrows())
    except Exception:
        rows = []
    for _, r in rows:
        date = col(r, "Date Reported", "dateReported")
        try:
            date = date.strftime("%Y-%m-%d")
        except Exception:
            date = str(date)[:10] if date is not None else None
        out["holders"].append({
            "holder": col(r, "Holder", "holder"),
            "shares": _num(col(r, "Shares", "shares")),
            "pct_out": _pct(col(r, "pctHeld", "% Out")),
            "value": _num(col(r, "Value", "value")),
            "date": date,
        })
    return out


def _short(info):
    info = info or {}
    return {
        "shares_short": _num(info.get("sharesShort")),
        "short_pct_float": _pct(info.get("shortPercentOfFloat")),
        "days_to_cover": _num(info.get("shortRatio")),
        "float_shares": _num(info.get("floatShares")),
        "shares_outstanding": _num(info.get("sharesOutstanding")),
        "prior_month_short": _num(info.get("sharesShortPriorMonth")),
    }


def _recent_quarters(today=None):
    """Candidate (year, quarter) pairs newest-first, covering the current quarter
    plus the prior three. 13F filings lag ~45 days, so the newest one WITH data
    is whatever's been filed — we try newest-first and take the first that hits."""
    today = today or datetime.date.today()
    q = (today.month - 1) // 3 + 1
    out = []
    y = today.year
    for _ in range(4):
        out.append((y, q))
        q -= 1
        if q == 0:
            q = 4
            y -= 1
    return out


def _thirteen_f(symbol):
    """Form 13F institutional ownership (FMP Ultimate): a position-flow summary +
    the top institutional holders for the most recent filed quarter. Returns
    {quarter, summary, holders} or None. Best-effort; never raises."""
    quarter = None
    summ = None
    for year, q in _recent_quarters():
        try:
            data = ee._fmp_get("/stable/institutional-ownership/symbol-positions-summary",
                               {"symbol": symbol, "year": year, "quarter": q})
        except Exception:
            data = None
        if isinstance(data, list) and data and isinstance(data[0], dict):
            quarter, summ = (year, q), data[0]
            break
    if not summ:
        return None

    year, q = quarter
    try:
        hraw = ee._fmp_get("/stable/institutional-ownership/extract-analytics/holder",
                           {"symbol": symbol, "year": year, "quarter": q,
                            "page": 0, "limit": _TF_MAX_HOLDERS})
    except Exception:
        hraw = None
    holders = []
    if isinstance(hraw, list):
        for h in hraw[:_TF_MAX_HOLDERS]:
            if not isinstance(h, dict):
                continue
            holders.append({
                "name":         h.get("investorName"),
                "shares":       _num(h.get("sharesNumber")),
                "change_shares": _num(h.get("changeInSharesNumber")),
                "change_pct":   _num(h.get("changeInSharesNumberPercentage")),
                "ownership":    _num(h.get("ownership")),
                "market_value": _num(h.get("marketValue")),
                "is_new":       bool(h.get("isNew")),
                "is_sold_out":  bool(h.get("isSoldOut")),
            })

    return {
        "quarter": f"{year}Q{q}",
        "summary": {
            "investors_holding":   _num(summ.get("investorsHolding")),
            "investors_change":    _num(summ.get("investorsHoldingChange")),
            "ownership_pct":       _num(summ.get("ownershipPercent")),
            "ownership_change":    _num(summ.get("ownershipPercentChange")),
            "total_invested":      _num(summ.get("totalInvested")),
            "total_invested_change": _num(summ.get("totalInvestedChange")),
            "new_positions":       _num(summ.get("newPositions")),
            "increased_positions": _num(summ.get("increasedPositions")),
            "reduced_positions":   _num(summ.get("reducedPositions")),
            "closed_positions":    _num(summ.get("closedPositions")),
            "put_call_ratio":      _num(summ.get("putCallRatio")),
        },
        "holders": holders,
    }


def _fetch_yf(sym):
    def _do():
        import yfinance as yf
        t = yf.Ticker(sym)
        return {"info": t.get_info(), "inst": getattr(t, "institutional_holders", None)}
    try:
        return run_in_pool(_do, timeout=15)
    except Exception as exc:
        _logger.warning("yf ownership fetch failed for %s: %s", sym, exc)
        return {}


def get_ownership(sym):
    sym = (sym or "").upper().strip()
    if not sym:
        return {}

    ck = f"research_own::{sym}"
    cached = cache.get(ck)
    if cached is not None:
        return cached

    raw = _fetch_yf(sym) or {}
    info = raw.get("info") or {}

    insider = []
    try:
        insider = (get_insider_activity(sym) or [])[:10]
    except Exception as exc:
        _logger.warning("insider activity failed for %s: %s", sym, exc)

    try:
        thirteen_f = _thirteen_f(sym)
    except Exception as exc:
        _logger.warning("13F ownership failed for %s: %s", sym, exc)
        thirteen_f = None

    out = {
        "sym": sym,
        "institutional": _institutional(raw.get("inst"), info),
        "short": _short(info),
        "insider": insider,
        "thirteen_f": thirteen_f,
    }
    cache.set(ck, out, _CACHE_TTL)
    return out
