"""
Server-Sent Events (SSE) endpoint for real-time price streaming.
Fans out WebSocket price data from Massive/Polygon to browser clients.
"""

import asyncio
import json
import time

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from api.services.realtime_stream import (
    get_realtime_prices, subscribe_tickers, unsubscribe_tickers, get_stream_status
)

router = APIRouter()

MAX_SSE_TICKERS = 50  # Finnhub free tier cap; prevents unbounded subscription growth


@router.get("/api/stream/prices")
async def stream_prices(
    request: Request,
    tickers: str = Query(..., description="Comma-separated ticker symbols"),
):
    """SSE endpoint — streams real-time price updates to the browser.

    Connect via EventSource:
      const es = new EventSource('/api/stream/prices?tickers=AAPL,MSFT,NVDA')
      es.onmessage = (e) => { const prices = JSON.parse(e.data) }
    """
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        return JSONResponse({"error": "No tickers provided"}, status_code=400)

    # Cap to MAX_SSE_TICKERS to prevent subscription bloat
    ticker_list = ticker_list[:MAX_SSE_TICKERS]

    # Subscribe these tickers to the WebSocket stream
    subscribe_tickers(ticker_list)

    async def event_generator():
        last_prices = {}  # {sym: price} — only compare price field to avoid unnecessary pushes
        heartbeat_interval = 15  # seconds
        last_heartbeat = time.time()

        try:
            while True:
                # Exit immediately when browser disconnects — prevents zombie coroutines
                if await request.is_disconnected():
                    break

                # Get latest prices for requested tickers
                current = get_realtime_prices(ticker_list)

                # Only send if any ticker's price actually changed
                prices_now = {s: d.get("price") for s, d in current.items()} if current else {}
                if prices_now != last_prices and current:
                    last_prices = prices_now
                    yield f"data: {json.dumps(current)}\n\n"

                # Heartbeat to keep connection alive through proxies
                if time.time() - last_heartbeat > heartbeat_interval:
                    yield f": heartbeat\n\n"
                    last_heartbeat = time.time()

                await asyncio.sleep(0.1)
        finally:
            # Clean up subscriptions when client disconnects so _subscribed
            # doesn't grow unbounded as users navigate between pages.
            unsubscribe_tickers(ticker_list)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable Nginx/proxy buffering
        },
    )


@router.get("/api/stream/status")
def stream_status():
    """Return WebSocket stream connection status."""
    return get_stream_status()
