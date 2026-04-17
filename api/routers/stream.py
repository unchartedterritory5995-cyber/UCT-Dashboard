"""
Server-Sent Events (SSE) endpoint for real-time price streaming.
Fans out WebSocket price data from Massive/Polygon to browser clients.
"""

import asyncio
import json
import time

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from api.services.realtime_stream import get_realtime_prices, subscribe_tickers, get_stream_status

router = APIRouter()


@router.get("/api/stream/prices")
async def stream_prices(
    tickers: str = Query(..., description="Comma-separated ticker symbols"),
):
    """SSE endpoint — streams real-time price updates to the browser.

    Connect via EventSource:
      const es = new EventSource('/api/stream/prices?tickers=AAPL,MSFT,NVDA')
      es.onmessage = (e) => { const prices = JSON.parse(e.data) }
    """
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not ticker_list:
        return {"error": "No tickers provided"}

    # Subscribe these tickers to the WebSocket stream
    subscribe_tickers(ticker_list)

    async def event_generator():
        last_prices = {}  # {sym: price} — only compare price field to avoid unnecessary pushes
        heartbeat_interval = 15  # seconds
        last_heartbeat = time.time()

        while True:
            # Get latest prices for requested tickers
            current = get_realtime_prices(ticker_list)

            # Only send if any ticker's price actually changed (not just updated_at)
            prices_now = {s: d.get("price") for s, d in current.items()} if current else {}
            if prices_now != last_prices and current:
                last_prices = prices_now
                yield f"data: {json.dumps(current)}\n\n"

            # Heartbeat to keep connection alive
            if time.time() - last_heartbeat > heartbeat_interval:
                yield f": heartbeat\n\n"
                last_heartbeat = time.time()

            await asyncio.sleep(0.1)  # Check every 100ms for near-instant updates

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable Nginx/proxy buffering
        },
    )


@router.get("/api/stream/status")
def stream_status():
    """Return WebSocket stream connection status."""
    return get_stream_status()
