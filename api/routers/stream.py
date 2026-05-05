"""
Server-Sent Events (SSE) endpoint for real-time price streaming.
Fans out WebSocket price data from Massive/Polygon to browser clients.
"""

import asyncio
import json
import logging
import os
import time

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, StreamingResponse

from api.services.realtime_stream import (
    get_realtime_prices, subscribe_tickers, unsubscribe_tickers, get_stream_status
)

_logger = logging.getLogger(__name__)

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


@router.get("/api/stream/bars")
async def stream_bars(
    request: Request,
    bars: str = Query(..., description="Comma-separated SYM:TF pairs, e.g. AAPL:5,MSFT:1"),
):
    """SSE — streams real-time bar updates per (symbol, timeframe).

    Connect via EventSource:
      const es = new EventSource('/api/stream/bars?bars=AAPL:5,MSFT:1')
      es.addEventListener('bar', e => { const {sym, tf, bar} = JSON.parse(e.data) })

    Each `event: bar` message contains the latest in-progress (or just-closed) bar
    for the (sym, tf) pair. Frontend should call series.update(bar) to apply.
    """
    if os.environ.get("STREAM_BARS_ENABLED") != "1":
        return JSONResponse({"error": "Bar streaming disabled"}, status_code=503)

    pairs: list[tuple[str, str]] = []
    for raw in bars.split(","):
        s = raw.strip()
        if not s or ":" not in s:
            continue
        sym, tf = s.split(":", 1)
        sym = sym.strip().upper()
        tf = tf.strip()
        if sym and tf in ("1", "5", "15", "30"):  # 60-min excluded in v1 (ET-anchor needed)
            pairs.append((sym, tf))

    if not pairs:
        return JSONResponse({"error": "No valid sym:tf pairs"}, status_code=400)
    pairs = pairs[:50]  # cap to prevent runaway subscriptions per connection

    from api.services.bar_broadcaster import get_broadcaster
    bb = get_broadcaster()
    queues = [(sym, tf, bb.subscribe(sym, tf)) for (sym, tf) in pairs]
    _logger.info("[stream_bars] subscribed %d pairs: %s", len(pairs), pairs[:10])

    async def event_generator():
        last_heartbeat = time.time()
        try:
            while True:
                if await request.is_disconnected():
                    break
                # Drain whatever is ready from any queue without blocking forever.
                # We round-robin one wait at a time so no queue starves.
                got_one = False
                for (sym, tf, q) in queues:
                    try:
                        msg = q.get_nowait()
                    except asyncio.QueueEmpty:
                        continue
                    got_one = True
                    yield f"event: bar\ndata: {json.dumps(msg)}\n\n"

                if not got_one:
                    await asyncio.sleep(0.05)

                if time.time() - last_heartbeat > 15:
                    yield ": heartbeat\n\n"
                    last_heartbeat = time.time()
        finally:
            for (sym, tf, q) in queues:
                bb.unsubscribe(sym, tf, q)
            _logger.info("[stream_bars] disconnected, unsubscribed %d pairs", len(queues))

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/api/stream/status")
def stream_status():
    """Return WebSocket stream connection status."""
    return get_stream_status()
