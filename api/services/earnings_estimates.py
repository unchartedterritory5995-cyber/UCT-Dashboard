"""Earnings Intelligence — Finnhub analyst consensus, EPS beat history, price targets.

Cached 6 hours per ticker via the shared TTLCache singleton.
"""

import os
import logging
import requests

from api.services.cache import cache

_logger = logging.getLogger(__name__)

_CACHE_TTL = 21_600  # 6 hours
_TIMEOUT = 6  # seconds per Finnhub request


def _fh_get(path: str, params: dict) -> dict | list | None:
    """Fire a Finnhub GET request. Returns parsed JSON or None on failure."""
    api_key = os.environ.get("FINNHUB_API_KEY", "")
    if not api_key:
        _logger.warning("FINNHUB_API_KEY not set — earnings intel unavailable")
        return None
    params["token"] = api_key
    try:
        resp = requests.get(
            f"https://finnhub.io/api/v1{path}",
            params=params,
            timeout=_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        _logger.warning("Finnhub %s failed for %s: %s", path, params.get("symbol", "?"), exc)
        return None


def get_earnings_intel(ticker: str) -> dict | None:
    """Return earnings intelligence dict for *ticker*, or None on total failure.

    Keys returned:
        beat_history  – list of last 4 quarters [{period, actual, estimate, beat}]
        consensus     – {buy, hold, sell, strongBuy, strongSell, period}
        price_target  – {targetHigh, targetLow, targetMean, targetMedian, lastUpdated}
    """
    ticker = ticker.upper()
    cache_key = f"earnings_intel_{ticker}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    # ── 1. Historical EPS (last 4 quarters) ─────────────────────────────────
    beat_history = []
    eps_raw = _fh_get("/stock/earnings", {"symbol": ticker, "limit": 4})
    if isinstance(eps_raw, list):
        for q in eps_raw:
            actual = q.get("actual")
            estimate = q.get("estimate")
            beat = None
            if actual is not None and estimate is not None:
                beat = actual >= estimate
            beat_history.append({
                "period": q.get("period", ""),
                "actual": actual,
                "estimate": estimate,
                "beat": beat,
                "surprise": q.get("surprisePercent"),
            })

    # ── 2. Analyst recommendation consensus ──────────────────────────────────
    consensus = None
    rec_raw = _fh_get("/stock/recommendation", {"symbol": ticker})
    if isinstance(rec_raw, list) and rec_raw:
        latest = rec_raw[0]  # most recent month
        consensus = {
            "buy": latest.get("buy", 0),
            "hold": latest.get("hold", 0),
            "sell": latest.get("sell", 0),
            "strongBuy": latest.get("strongBuy", 0),
            "strongSell": latest.get("strongSell", 0),
            "period": latest.get("period", ""),
        }

    # ── 3. Price target ──────────────────────────────────────────────────────
    price_target = None
    pt_raw = _fh_get("/stock/price-target", {"symbol": ticker})
    if isinstance(pt_raw, dict) and pt_raw.get("targetMean") is not None:
        price_target = {
            "targetHigh": pt_raw.get("targetHigh"),
            "targetLow": pt_raw.get("targetLow"),
            "targetMean": pt_raw.get("targetMean"),
            "targetMedian": pt_raw.get("targetMedian"),
            "lastUpdated": pt_raw.get("lastUpdated", ""),
        }

    # If all three failed, return None (don't cache failures long)
    if not beat_history and consensus is None and price_target is None:
        return None

    result = {
        "beat_history": beat_history,
        "consensus": consensus,
        "price_target": price_target,
    }
    cache.set(cache_key, result, ttl=_CACHE_TTL)
    return result
