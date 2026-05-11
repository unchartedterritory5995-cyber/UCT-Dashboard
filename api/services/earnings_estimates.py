"""Earnings Intelligence — Finnhub analyst consensus, EPS beat history, price targets.

Cached 6 hours per ticker via the shared TTLCache singleton.
"""

import os
import logging
import requests

from api.services.cache import cache

_logger = logging.getLogger(__name__)

_CACHE_TTL = 21_600  # 6 hours (used by get_earnings_intel)
_MARKERS_CACHE_TTL = 43_200  # 12 hours (used by get_chart_markers)
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


def get_chart_markers(ticker: str) -> dict:
    """Return earnings, stock splits, and dividends for chart annotation.

    Returns:
        {
          "earnings":  [{"date": "2024-11-01", "beat": true, "surprise": 3.2,
                         "eps_actual": 1.5, "eps_estimate": 1.4}, ...],
          "splits":    [{"date": "2020-08-28", "ratio": "4:1",
                         "from_factor": 1, "to_factor": 4}, ...],
          "dividends": [{"date": "2026-03-15", "amount": 0.85}, ...]
        }
    Each section is independently wrapped in try/except — a failing source
    returns an empty list for that section but doesn't fail the whole call.
    Cached 12 h per ticker. Never raises.
    """
    ticker = ticker.upper()
    cache_key = f"chart_markers_{ticker}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    result = {"earnings": [], "splits": [], "dividends": []}

    from datetime import date, timedelta
    today = date.today()
    # 5-year lookback covers the 2-year default request comfortably and lets a
    # single cache entry serve longer-range chart views too.
    from_date = (today - timedelta(days=365 * 5)).strftime("%Y-%m-%d")
    to_date   = today.strftime("%Y-%m-%d")

    # ── Earnings history (last 16 quarters ≈ 4 years) ─────────────────────────
    try:
        eps_raw = _fh_get("/stock/earnings", {"symbol": ticker, "limit": 16})
        if isinstance(eps_raw, list):
            for q in eps_raw:
                date_str = q.get("period") or q.get("date") or q.get("reportDate")
                if not date_str:
                    continue
                actual   = q.get("actual")
                estimate = q.get("estimate")
                beat = bool(actual >= estimate) if (actual is not None and estimate is not None) else None
                result["earnings"].append({
                    "date": str(date_str)[:10],
                    "beat": beat,
                    "surprise": q.get("surprisePercent"),
                    "eps_actual": actual,
                    "eps_estimate": estimate,
                })
    except Exception as exc:
        _logger.warning("get_chart_markers earnings failed for %s: %s", ticker, exc)

    # ── Stock splits (last 5 years) ──────────────────────────────────────────
    try:
        splits_raw = _fh_get("/stock/split", {"symbol": ticker, "from": from_date, "to": to_date})
        if isinstance(splits_raw, list):
            for s in splits_raw:
                date_str = s.get("date")
                from_f   = s.get("fromFactor", 1)
                to_f     = s.get("toFactor", 1)
                if date_str:
                    result["splits"].append({
                        "date": str(date_str)[:10],
                        "ratio": f"{from_f}:{to_f}",
                        "from_factor": from_f,
                        "to_factor": to_f,
                    })
    except Exception as exc:
        _logger.warning("get_chart_markers splits failed for %s: %s", ticker, exc)

    # ── Dividends (last 5 years) ─────────────────────────────────────────────
    try:
        div_raw = _fh_get(
            "/stock/dividend",
            {"symbol": ticker, "from": from_date, "to": to_date},
        )
        if isinstance(div_raw, list):
            for d in div_raw:
                # Finnhub returns ex-date in "date" and amount in "amount".
                date_str = d.get("date") or d.get("payDate") or d.get("recordDate")
                amount   = d.get("amount") or d.get("dividend")
                if date_str is None or amount is None:
                    continue
                try:
                    amount_f = float(amount)
                except (TypeError, ValueError):
                    continue
                result["dividends"].append({
                    "date": str(date_str)[:10],
                    "amount": amount_f,
                })
    except Exception as exc:
        _logger.warning("get_chart_markers dividends failed for %s: %s", ticker, exc)

    cache.set(cache_key, result, ttl=_MARKERS_CACHE_TTL)
    return result
