"""FRED (Federal Reserve Economic Data) — live economic series for voice Compass.

Public REST API at api.stlouisfed.org/fred/series/observations. Requires a
free FRED_API_KEY env var (register at fred.stlouisfed.org/docs/api/api_key.html).

Includes a friendly catalog of common series so voice can call by name
("CPI" / "unemployment" / "10Y yield") instead of memorizing series IDs.
"""

import logging
import os
import time
from typing import Any

import requests

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_BASE = "https://api.stlouisfed.org/fred/series/observations"
_TIMEOUT = 10
_CACHE = TTLCache()
_CACHE_TTL = 1800  # 30 min

# Friendly aliases → FRED series IDs. Voice can call by either.
_SERIES_CATALOG: dict[str, dict[str, str]] = {
    # Yields
    "10y_yield":    {"id": "DGS10",      "label": "10-Year Treasury Yield",   "unit": "%"},
    "2y_yield":     {"id": "DGS2",       "label": "2-Year Treasury Yield",    "unit": "%"},
    "30y_yield":    {"id": "DGS30",      "label": "30-Year Treasury Yield",   "unit": "%"},
    "3m_yield":     {"id": "DGS3MO",     "label": "3-Month Treasury Yield",   "unit": "%"},
    "10y2y_spread": {"id": "T10Y2Y",     "label": "10Y-2Y Yield Spread",      "unit": "%"},
    "10y3m_spread": {"id": "T10Y3M",     "label": "10Y-3M Yield Spread",      "unit": "%"},
    # Fed policy
    "fed_funds":    {"id": "DFEDTARU",   "label": "Fed Funds Upper Bound",    "unit": "%"},
    "fed_funds_eff":{"id": "DFF",        "label": "Effective Fed Funds Rate", "unit": "%"},
    # Inflation
    "cpi":          {"id": "CPIAUCSL",   "label": "CPI (All Items, SA)",      "unit": "index"},
    "core_cpi":     {"id": "CPILFESL",   "label": "Core CPI",                 "unit": "index"},
    "pce":          {"id": "PCEPI",      "label": "PCE Price Index",          "unit": "index"},
    "core_pce":     {"id": "PCEPILFE",   "label": "Core PCE",                 "unit": "index"},
    # Growth
    "gdp":          {"id": "GDP",        "label": "Real GDP (SAAR)",          "unit": "$B"},
    "gdp_growth":   {"id": "A191RL1Q225SBEA", "label": "Real GDP Growth (Q/Q, SAAR)", "unit": "%"},
    # Labor
    "unemployment": {"id": "UNRATE",     "label": "Unemployment Rate",        "unit": "%"},
    "nonfarm":      {"id": "PAYEMS",     "label": "Nonfarm Payrolls",         "unit": "thousands"},
    "labor_force":  {"id": "CIVPART",    "label": "Labor Force Participation","unit": "%"},
    "jobless_claims": {"id": "ICSA",     "label": "Initial Jobless Claims",   "unit": "count"},
    # Money/liquidity
    "m2":           {"id": "M2SL",       "label": "M2 Money Supply (SA)",     "unit": "$B"},
    "fed_balance":  {"id": "WALCL",      "label": "Fed Balance Sheet Total",  "unit": "$M"},
    "rrp":          {"id": "RRPONTSYD",  "label": "Overnight Reverse Repo",   "unit": "$B"},
    # Vol / risk
    "vix":          {"id": "VIXCLS",     "label": "VIX Close",                "unit": "index"},
    "high_yield_spread": {"id": "BAMLH0A0HYM2", "label": "High Yield OAS",    "unit": "%"},
    # Commodities
    "wti":          {"id": "DCOILWTICO", "label": "WTI Crude Oil",            "unit": "$/bbl"},
    "brent":        {"id": "DCOILBRENTEU", "label": "Brent Crude Oil",        "unit": "$/bbl"},
    "gold":         {"id": "GOLDAMGBD228NLBM", "label": "Gold (London PM)",   "unit": "$/oz"},
    # FX
    "dxy":          {"id": "DTWEXBGS",   "label": "Trade-Weighted USD Index", "unit": "index"},
    # Sentiment
    "consumer_sentiment": {"id": "UMCSENT", "label": "U Mich Consumer Sentiment", "unit": "index"},
}


def list_series_catalog() -> list[dict[str, str]]:
    """Return the friendly catalog so the voice agent can introspect what's
    available. Keeps callable names + descriptions in one place."""
    return [
        {"alias": k, "id": v["id"], "label": v["label"], "unit": v["unit"]}
        for k, v in _SERIES_CATALOG.items()
    ]


def _resolve_series_id(name_or_id: str) -> tuple[str, str, str]:
    """Map a friendly alias to (series_id, label, unit). If the input
    already looks like a FRED ID (uppercase, 4-12 chars), pass through."""
    s = (name_or_id or "").strip()
    if not s:
        return "", "", ""
    low = s.lower()
    if low in _SERIES_CATALOG:
        meta = _SERIES_CATALOG[low]
        return meta["id"], meta["label"], meta["unit"]
    # Treat as raw FRED ID
    return s.upper(), s.upper(), ""


def get_series(name_or_id: str, periods: int = 6) -> dict[str, Any]:
    """Fetch recent observations for a series. Returns {label, unit, latest,
    points: [{date, value}], error?}. Cached 30 min."""
    series_id, label, unit = _resolve_series_id(name_or_id)
    if not series_id:
        return {"error": "no series name provided"}

    periods = max(1, min(60, int(periods or 6)))
    cache_key = f"fred::{series_id}::{periods}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    api_key = os.environ.get("FRED_API_KEY", "").strip()
    if not api_key:
        return {
            "error": "FRED_API_KEY not configured",
            "hint": "Free key at fred.stlouisfed.org/docs/api/api_key.html",
            "series_id": series_id,
        }

    try:
        t0 = time.time()
        r = requests.get(
            _BASE,
            params={
                "series_id": series_id,
                "api_key": api_key,
                "file_type": "json",
                "sort_order": "desc",
                "limit": periods,
            },
            timeout=_TIMEOUT,
        )
        r.raise_for_status()
        data = r.json()
        elapsed_ms = int((time.time() - t0) * 1000)
    except requests.Timeout:
        return {"error": f"FRED timeout after {_TIMEOUT}s", "series_id": series_id}
    except requests.RequestException as e:
        _log.warning("FRED request failed for %s: %s", series_id, e)
        return {"error": f"FRED request failed: {e}", "series_id": series_id}

    obs = data.get("observations") or []
    points = []
    for o in obs:
        v = o.get("value")
        try:
            v = float(v) if v not in (None, ".") else None
        except (TypeError, ValueError):
            v = None
        if v is not None:
            points.append({"date": o.get("date"), "value": v})

    # Reverse to chronological so the trader/voice can read "from oldest to latest"
    points.reverse()
    latest = points[-1] if points else None

    result = {
        "series_id": series_id,
        "label": label,
        "unit": unit,
        "latest": latest,
        "points": points,
        "elapsed_ms": elapsed_ms,
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result
