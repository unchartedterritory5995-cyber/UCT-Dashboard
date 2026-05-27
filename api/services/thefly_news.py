"""TheFly Squawk feed wrapper for voice Compass.

TheFly.com is the institutional analyst news + Squawk wire many trading
desks use for analyst calls, syndicate pricings, M&A flashes, hot-mover
alerts. The API surface varies by subscription tier — this wrapper hits
a generic REST shape and gracefully no-ops if the key isn't configured.

Env:
  THEFLY_API_KEY   — required for live calls; absent → returns empty.
  THEFLY_BASE_URL  — optional override; defaults to api.thefly.com/v1.

If the response shape doesn't match what's expected, the wrapper returns
{"error": ..., "items": []} so the voice tool degrades cleanly to an
"I don't have data on this" answer rather than failing the session.
"""

import logging
import os
import time
from typing import Any

import requests

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_BASE = os.environ.get("THEFLY_BASE_URL", "https://api.thefly.com/v1").rstrip("/")
_TIMEOUT = 10
_CACHE = TTLCache()
_CACHE_TTL = 300  # 5 min — Squawks are time-sensitive but not tick-by-tick

# Common Squawk categories. Voice can pass any of these or leave blank for all.
CATEGORIES = (
    "analyst",     # upgrades / downgrades / initiations / PT changes
    "syndicate",   # IPO + secondary offering pricings
    "m_and_a",     # M&A announcements + rumors
    "earnings",    # beats / misses / pre-announcements
    "general",     # everything else
)


def _normalize_item(raw: dict) -> dict:
    """Coerce a Squawk item into a flat shape voice can speak. Different
    tiers of TheFly return different schemas — we accept several aliases."""
    return {
        "headline": str(raw.get("headline") or raw.get("title") or "").strip(),
        "symbol": str(raw.get("symbol") or raw.get("ticker") or "").upper(),
        "category": str(raw.get("category") or raw.get("topic") or "").lower(),
        "published": str(raw.get("published_at") or raw.get("date") or raw.get("time") or ""),
        "url": str(raw.get("url") or raw.get("link") or ""),
        "summary": str(raw.get("summary") or raw.get("body") or "")[:300],
    }


def get_squawks(symbol: str = "", category: str = "", count: int = 10) -> dict[str, Any]:
    """Recent Squawks, optionally filtered by symbol or category."""
    api_key = os.environ.get("THEFLY_API_KEY", "").strip()
    if not api_key:
        return {
            "error": "THEFLY_API_KEY not configured",
            "items": [],
            "count": 0,
            "hint": "Add THEFLY_API_KEY to Railway env if you have a TheFly subscription.",
        }

    symbol = (symbol or "").upper().strip()
    category = (category or "").lower().strip()
    count = max(1, min(50, int(count or 10)))

    cache_key = f"thefly::{symbol}::{category}::{count}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    params: dict[str, Any] = {"limit": count}
    if symbol:
        params["symbol"] = symbol
    if category:
        params["category"] = category

    try:
        t0 = time.time()
        r = requests.get(
            f"{_BASE}/news/squawks",
            params=params,
            headers={"Authorization": f"Bearer {api_key}", "Accept": "application/json"},
            timeout=_TIMEOUT,
        )
        r.raise_for_status()
        data = r.json()
        elapsed_ms = int((time.time() - t0) * 1000)
    except requests.Timeout:
        return {"error": f"thefly timeout after {_TIMEOUT}s", "items": [], "count": 0}
    except requests.RequestException as e:
        _log.warning("thefly request failed: %s", e)
        return {"error": f"thefly request failed: {e}", "items": [], "count": 0}

    # Accept multiple response shapes
    raw_items = data
    if isinstance(data, dict):
        raw_items = data.get("items") or data.get("squawks") or data.get("results") or []
    if not isinstance(raw_items, list):
        return {"error": "unexpected response shape", "items": [], "count": 0}

    items = [_normalize_item(x) for x in raw_items[:count] if isinstance(x, dict)]
    items = [x for x in items if x["headline"]]  # drop empties

    result = {
        "count": len(items),
        "items": items,
        "symbol_filter": symbol or None,
        "category_filter": category or None,
        "elapsed_ms": elapsed_ms,
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result
