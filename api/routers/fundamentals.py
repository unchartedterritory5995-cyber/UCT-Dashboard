"""Fundamentals router — wraps fundamentals.get_fundamentals + Finnhub /stock/metric.

GET /api/fundamentals/{ticker}
Returns: {market_cap, forward_pe, beta, week52_high, week52_low, avg_vol, div_yield}

All fields are null-safe; never raises on missing data.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import requests
from fastapi import APIRouter

from api.services.fundamentals import get_fundamentals
from api.services.cache import cache

_log = logging.getLogger(__name__)
router = APIRouter()

_FH_METRIC_TTL = 3600  # 1 hour
_TIMEOUT = 10


def _fh_metric_get(ticker: str) -> dict[str, Any]:
    """Fetch Finnhub /stock/metric?metric=all for avg volume + extras."""
    fh_key = os.environ.get("FINNHUB_API_KEY", "")
    if not fh_key:
        return {}
    ck = f"fh_metric::{ticker.upper()}"
    hit = cache.get(ck)
    if hit is not None:
        return hit
    try:
        r = requests.get(
            "https://finnhub.io/api/v1/stock/metric",
            params={"symbol": ticker.upper(), "metric": "all", "token": fh_key},
            timeout=_TIMEOUT,
        )
        r.raise_for_status()
        data = r.json()
        result = data.get("metric") or {}
        cache.set(ck, result, _FH_METRIC_TTL)
        return result
    except Exception as e:
        _log.debug("Finnhub /stock/metric failed for %s: %s", ticker, e)
        return {}


@router.get("/api/fundamentals/{ticker}")
def get_fundamentals_endpoint(ticker: str):
    """Compact fundamentals for a ticker.

    Returns {market_cap, forward_pe, beta, week52_high, week52_low, avg_vol, div_yield}.
    All fields are null-safe; returns empty dict (not error) on any failure.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return {}

    ck = f"api_fund::{sym}"
    hit = cache.get(ck)
    if hit is not None:
        return hit

    try:
        base = get_fundamentals(sym)
    except Exception as e:
        _log.warning("get_fundamentals failed for %s: %s", sym, e)
        base = {}

    if "error" in base:
        _log.debug("fundamentals error for %s: %s", sym, base.get("error"))
        base = {}

    # Finnhub /stock/metric for avg vol and 52-week range (more reliable than yfinance)
    fh = {}
    try:
        fh = _fh_metric_get(sym)
    except Exception as e:
        _log.debug("Finnhub metric failed for %s: %s", sym, e)

    def _safe_float(v) -> float | None:
        try:
            return float(v) if v is not None else None
        except (TypeError, ValueError):
            return None

    # avg_vol: prefer Finnhub 10-week avg daily volume, fall back to yfinance averageVolume
    avg_vol_fh = _safe_float(fh.get("10DayAverageTradingVolume") or fh.get("averageDailyVolume10Day"))
    if avg_vol_fh is None:
        avg_vol_fh = _safe_float(fh.get("52WeekAverageDailyVolume"))

    # 52-week range: prefer Finnhub annual highs
    w52_high_fh = _safe_float(fh.get("52WeekHigh"))
    w52_low_fh = _safe_float(fh.get("52WeekLow"))

    result: dict[str, Any] = {
        "ticker": sym,
        "market_cap": base.get("market_cap"),          # formatted string e.g. "$1.23T"
        "forward_pe": base.get("pe_forward"),           # float or None
        "beta": base.get("beta"),                       # float or None
        "week52_high": w52_high_fh or base.get("fifty_two_week_high"),
        "week52_low": w52_low_fh or base.get("fifty_two_week_low"),
        "avg_vol": avg_vol_fh,                          # 10-day avg daily vol (shares)
        "div_yield": base.get("dividend_yield_pct"),    # pct e.g. 1.5
    }

    cache.set(ck, result, _FH_METRIC_TTL)
    return result
