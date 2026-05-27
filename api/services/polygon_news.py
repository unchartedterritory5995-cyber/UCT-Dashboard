"""Polygon news service — institutional-grade news feed via Massive Advanced.

Polygon's news endpoint (/v2/reference/news) returns articles with publisher,
title, description, tickers, keywords, AND sentiment_classification +
sentiment_reasoning per ticker mention. Much richer than RSS or AlphaVantage.

Free with the $200/mo Polygon Advanced tier we already have via MASSIVE_API_KEY.
"""

import logging
import os
from typing import Any

import httpx

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_BASE = "https://api.massive.com"
_TIMEOUT = 12
_CACHE = TTLCache()
_CACHE_TTL = 300  # 5 min

_http = httpx.Client(
    timeout=httpx.Timeout(connect=3.0, read=10.0, write=5.0, pool=8.0),
    headers={"Accept": "application/json"},
)


def _api_key() -> str:
    return os.environ.get("MASSIVE_API_KEY", "").strip()


def get_news(ticker: str = "", limit: int = 10,
             sentiment: str = "") -> dict[str, Any]:
    """News articles, optionally filtered by ticker and/or sentiment.
    sentiment: 'positive' | 'negative' | 'neutral' | '' (any).
    Returns publisher + title + description + tickers + sentiment per article."""
    ticker = (ticker or "").upper().strip()
    sentiment = (sentiment or "").lower().strip()
    limit = max(1, min(50, int(limit or 10)))

    cache_key = f"pgxnews::{ticker}::{sentiment}::{limit}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    key = _api_key()
    if not key:
        return {"error": "MASSIVE_API_KEY not set", "items": []}

    params: dict[str, Any] = {"apiKey": key, "limit": limit, "order": "desc",
                              "sort": "published_utc"}
    if ticker:
        params["ticker"] = ticker

    try:
        r = _http.get(f"{_BASE}/v2/reference/news", params=params, timeout=_TIMEOUT)
        r.raise_for_status()
        data = r.json()
    except httpx.HTTPError as e:
        _log.warning("polygon news fetch failed: %s", e)
        return {"error": f"polygon news failed: {e}", "items": []}

    raw_items = data.get("results") or []
    items = []
    for it in raw_items[:limit]:
        # Per-ticker insights (Polygon includes sentiment_classification +
        # sentiment_reasoning per ticker the article mentions)
        insights = it.get("insights") or []
        ticker_sentiment = None
        sentiment_reasoning = None
        if ticker:
            for ins in insights:
                if (ins.get("ticker") or "").upper() == ticker:
                    ticker_sentiment = ins.get("sentiment")
                    sentiment_reasoning = ins.get("sentiment_reasoning")
                    break

        # If sentiment filter specified, drop non-matches
        if sentiment and ticker_sentiment and sentiment != ticker_sentiment.lower():
            continue

        items.append({
            "title": it.get("title"),
            "description": (it.get("description") or "")[:400],
            "publisher": (it.get("publisher") or {}).get("name"),
            "published_utc": it.get("published_utc"),
            "article_url": it.get("article_url"),
            "tickers": it.get("tickers") or [],
            "keywords": it.get("keywords") or [],
            "ticker_sentiment": ticker_sentiment,
            "sentiment_reasoning": (sentiment_reasoning or "")[:200],
        })

    result = {
        "ticker": ticker or None,
        "sentiment_filter": sentiment or None,
        "count": len(items),
        "items": items,
        "source": "polygon (Massive Advanced)",
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result
