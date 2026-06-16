"""Ownership for the research page: institutional holders, short interest /
float, and insider activity.

Institutional + short/float come from yfinance (info + institutional_holders)
via the bounded pool; insider activity reuses the existing Finnhub-backed
``get_insider_activity`` service. Cached 12h.
"""
from __future__ import annotations

import logging
import math

from api.services.cache import cache
from api.services.insider import get_insider_activity
from api.services.yfinance_pool import run_in_pool

_logger = logging.getLogger(__name__)

_CACHE_TTL = 43_200  # 12h


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

    out = {
        "sym": sym,
        "institutional": _institutional(raw.get("inst"), info),
        "short": _short(info),
        "insider": insider,
    }
    cache.set(ck, out, _CACHE_TTL)
    return out
