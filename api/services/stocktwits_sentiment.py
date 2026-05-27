"""Stocktwits sentiment + recent messages for voice Compass.

Free public API (no auth) at api.stocktwits.com/api/2/streams/symbol/{TICKER}.json.
Each message can be tagged 'Bullish' or 'Bearish' by the user. We aggregate
those tags into a bull/bear ratio + sample messages.

Rate limit: 200 req/hr per IP without auth. We cache 5 min so a single
user can hammer the same ticker without burning the quota.
"""

import logging
import time
from typing import Any

import requests

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)
_BASE = "https://api.stocktwits.com/api/2"
_TIMEOUT = 10
_CACHE = TTLCache()
_CACHE_TTL = 300  # 5 min

# Stocktwits 403s on default Python User-Agent. Use a browser-realistic one.
_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


def sentiment_for_ticker(ticker: str, limit: int = 30) -> dict[str, Any]:
    """Aggregate sentiment for a ticker over the last `limit` messages."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}

    cache_key = f"stocktwits::{sym}::{limit}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    try:
        t0 = time.time()
        r = requests.get(
            f"{_BASE}/streams/symbol/{sym}.json",
            headers={"User-Agent": _UA, "Accept": "application/json"},
            timeout=_TIMEOUT,
        )
        r.raise_for_status()
        data = r.json()
        elapsed_ms = int((time.time() - t0) * 1000)
    except requests.HTTPError as e:
        # 404 = symbol not in Stocktwits universe (small/foreign tickers)
        if e.response is not None and e.response.status_code == 404:
            return {"ticker": sym, "error": f"{sym} not in Stocktwits universe", "count": 0}
        _log.warning("stocktwits http error for %s: %s", sym, e)
        return {"error": f"stocktwits request failed: {e}", "ticker": sym}
    except requests.RequestException as e:
        _log.warning("stocktwits request failed: %s", e)
        return {"error": f"stocktwits request failed: {e}", "ticker": sym}

    messages = (data.get("messages") or [])[:max(1, min(50, int(limit or 30)))]
    bull = bear = neutral = 0
    samples = []
    for m in messages:
        body = (m.get("body") or "").strip()
        ent = m.get("entities") or {}
        sent = (ent.get("sentiment") or {}).get("basic", "").lower()
        if sent == "bullish":
            bull += 1
        elif sent == "bearish":
            bear += 1
        else:
            neutral += 1
        if len(samples) < 5 and body:
            samples.append({
                "body": body[:240],
                "sentiment": sent or "neutral",
                "user": (m.get("user") or {}).get("username", ""),
                "likes": m.get("likes", {}).get("total", 0),
                "created_at": m.get("created_at", ""),
            })

    total_tagged = bull + bear
    score = (bull - bear) / total_tagged if total_tagged else 0.0
    verdict = (
        "bullish" if score > 0.25 else
        "bearish" if score < -0.25 else
        "mixed"
    )

    result = {
        "ticker": sym,
        "count": len(messages),
        "bullish_tagged": bull,
        "bearish_tagged": bear,
        "untagged": neutral,
        "net_score": round(score, 3),
        "verdict": verdict,
        "samples": samples,
        "elapsed_ms": elapsed_ms,
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result
