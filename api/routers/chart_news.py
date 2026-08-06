"""Per-ticker news for chart markers.

Returns recent news entries with timestamps so the frontend can place
markers on the chart at the moment each headline was published.

Upstream data shape (from `engine.get_news()`):
    [
        {
            "headline": str,
            "source":   str,
            "url":      str,
            "time":     "YYYY-MM-DD HH:MM:SS"  (ET wall-clock string),
            "category": str,
            "sentiment": str,
            "tickers": [str, ...],
            ...
        },
        ...
    ]

We filter by ticker membership in `tickers`, parse the ET time string to
epoch seconds, and return a sorted-newest-first list.
"""
import logging
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query

from api.services.cache import cache
from api.services.cache_policy import set_by_completeness

_logger = logging.getLogger(__name__)
router = APIRouter()

_CACHE_TTL = 1800        # 30 min — matches upstream FMP/AV cache window
_CACHE_TTL_EMPTY = 300   # 5 min — an EMPTY result (2026-08-05, data-
                         # dependability migration Task 14) used to get the
                         # same 30-min TTL as a real hit — indistinguishable
                         # from "this ticker genuinely has no news" for half
                         # an hour even when it was actually a transient
                         # upstream blip (engine.get_news() itself degraded,
                         # or a filter matched nothing this cycle). Self-heals
                         # in 5 min instead.
_MAX_DAYS = 365

# Engine's get_news() emits ET wall-clock strings; convert via UTC-5 (matches
# the formatter in engine.py). DST drift is acceptable for chart marker
# placement — markers are date-anchored, not minute-anchored.
_ET_OFFSET = timezone(timedelta(hours=-5))


def _parse_et_string(ts: str) -> int | None:
    """Parse the engine's ET wall-clock string into epoch seconds.

    Returns None when the timestamp is missing or malformed.
    """
    if not ts or not isinstance(ts, str):
        return None
    try:
        # AlphaVantage path: "YYYYMMDDTHHMMSS" (pre-normalization, defensive)
        if len(ts) == 15 and "T" in ts:
            dt = datetime.strptime(ts, "%Y%m%dT%H%M%S").replace(tzinfo=timezone.utc)
            return int(dt.timestamp())
        # Engine-normalized path: "YYYY-MM-DD HH:MM:SS" anchored to ET
        if " " in ts and "-" in ts:
            dt = datetime.strptime(ts[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=_ET_OFFSET)
            return int(dt.timestamp())
        # ISO-8601 fallback
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return int(dt.timestamp())
    except Exception:
        return None


def get_ticker_news(ticker: str, days: int = 30) -> list[dict]:
    """Fetch news entries for a ticker over the past N days.

    Returns a list of dicts with shape:
        {ticker, headline, source, url, time_published (epoch s), sentiment, category}

    Sorted newest first. Empty list when no matches or upstream failure.
    """
    ticker_u = (ticker or "").upper().strip()
    if not ticker_u:
        return []

    cache_key = f"chart_news:{ticker_u}:{days}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        from api.services import engine
        all_news = engine.get_news() or []
    except Exception:
        _logger.exception("[chart_news] engine.get_news failed")
        return []

    cutoff_ts = int(time.time()) - days * 86400
    result: list[dict] = []

    for item in all_news:
        if not isinstance(item, dict):
            continue

        # Ticker membership — engine.get_news() normalizes to `tickers: [...]`.
        # Defensive fallbacks cover raw AV (`ticker_sentiment`) and singular
        # `ticker` keys in case upstream shape ever drifts.
        item_tickers: list[str] = []
        raw_tickers = item.get("tickers")
        if isinstance(raw_tickers, list):
            item_tickers = [str(t).upper() for t in raw_tickers if t]
        elif isinstance(item.get("ticker_sentiment"), list):
            item_tickers = [
                (t.get("ticker") or "").upper()
                for t in item["ticker_sentiment"]
                if isinstance(t, dict)
            ]
        elif item.get("ticker"):
            item_tickers = [str(item["ticker"]).upper()]

        if ticker_u not in item_tickers:
            continue

        ts = _parse_et_string(item.get("time") or item.get("time_published") or "")
        if ts is None or ts < cutoff_ts:
            continue

        result.append({
            "ticker": ticker_u,
            "headline": item.get("headline") or item.get("title") or "",
            "source": item.get("source") or item.get("publisher") or "",
            "url": item.get("url") or item.get("link") or "",
            "time_published": ts,
            "sentiment": item.get("sentiment") or item.get("overall_sentiment_label") or "",
            "category": item.get("category") or "",
        })

    result.sort(key=lambda x: x["time_published"], reverse=True)
    # A non-empty result is a real hit — cache it at the full TTL. An empty
    # result gets the SHORT ttl_partial (never a persistent store here, so
    # `persist` is omitted) — see `_CACHE_TTL_EMPTY` above.
    set_by_completeness(cache_key, result, complete=bool(result),
                        ttl_ok=_CACHE_TTL, ttl_partial=_CACHE_TTL_EMPTY)
    return result


@router.get("/api/chart-news/{ticker}")
def chart_news(ticker: str, days: int = Query(default=30, ge=1, le=_MAX_DAYS)):
    """Return per-ticker news for chart markers.

    `days` is clamped to [1, 365] by FastAPI validation. Returns
    ``{"news": [...]}`` always — empty array when nothing matches.
    """
    return {"news": get_ticker_news(ticker, days=days)}
