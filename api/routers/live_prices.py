"""Live batch pricing endpoint — returns real-time price data for up to 50 tickers.

Uses Massive.com batch snapshot API (Polygon-compatible).
Cache: 15s TTL keyed by sorted ticker hash.
"""
import hashlib
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from api.services.cache import cache
from api.services.massive import _get_client

router = APIRouter()

_MAX_TICKERS = 50
_CACHE_TTL = 15  # seconds


@router.get("/api/live-prices")
def get_live_prices(
    tickers: str = Query(..., description="Comma-separated ticker symbols (max 50)"),
):
    """Return real-time price snapshot for a batch of tickers.

    Response: {AAPL: {price, change_pct, change, volume}, ...}
    """
    raw_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not raw_list:
        return JSONResponse(status_code=400, content={"error": "No tickers provided"})
    if len(raw_list) > _MAX_TICKERS:
        return JSONResponse(
            status_code=400,
            content={"error": f"Maximum {_MAX_TICKERS} tickers per request"},
        )

    # Deterministic cache key from sorted tickers
    sorted_key = ",".join(sorted(set(raw_list)))
    cache_key = f"live_prices_{hashlib.md5(sorted_key.encode()).hexdigest()}"

    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    try:
        client = _get_client()
    except Exception:
        return JSONResponse(status_code=503, content={"error": "Pricing service unavailable"})

    # Use the batch snapshot endpoint (same as get_batch_rich_snapshots but we
    # need the full ticker blob to extract change as well)
    unique_tickers = list(dict.fromkeys(raw_list))  # dedupe, preserve order
    tickers_param = ",".join(unique_tickers)
    url = (
        f"https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers"
        f"?tickers={tickers_param}&apiKey={client._api_key}"
    )
    try:
        data = client._get(url)
    except Exception:
        return JSONResponse(status_code=503, content={"error": "Pricing service unavailable"})

    result = {}
    for t in data.get("tickers", []):
        ticker = t.get("ticker", "")
        if not ticker:
            continue
        day = t.get("day", {})
        prev_day = t.get("prevDay", {})
        last_trade = t.get("lastTrade", {})

        # Price: day close → last trade → prev day close
        price = day.get("c") or last_trade.get("p") or prev_day.get("c") or 0.0
        volume = int(day.get("v") or 0)

        result[ticker] = {
            "price": round(float(price), 2),
            "change_pct": round(float(t.get("todaysChangePerc", 0.0)), 4),
            "change": round(float(t.get("todaysChange", 0.0)), 4),
            "volume": volume,
        }

    cache.set(cache_key, result, ttl=_CACHE_TTL)
    return result
