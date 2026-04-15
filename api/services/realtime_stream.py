"""
Real-time price streaming via Massive/Polygon WebSocket.

Connects to wss://socket.polygon.io/stocks, subscribes to per-minute
aggregates (AM.*), and maintains an in-memory price dict that SSE
endpoint fans out to frontend clients.

Falls back gracefully if WebSocket unavailable — existing REST polling
continues to work independently.
"""

import asyncio
import json
import logging
import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

_logger = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")

# WebSocket URL (Polygon.io / Massive.com)
_WS_URL = "wss://socket.polygon.io/stocks"

# In-memory price store: {SYM: {price, change_pct, volume, prev_close, timestamp}}
_prices = {}
_lock = threading.Lock()

# Subscribed tickers
_subscribed = set()
_ws_connection = None
_ws_loop = None
_running = False


def get_realtime_prices(tickers=None):
    """Get latest prices from the WebSocket stream.
    Returns dict of {SYM: {price, change_pct, volume, timestamp}}.
    If tickers provided, filters to only those.
    """
    with _lock:
        if tickers:
            return {s: _prices[s] for s in tickers if s in _prices}
        return dict(_prices)


def get_stream_status():
    """Return WebSocket connection status."""
    return {
        "connected": _running,
        "subscribed_count": len(_subscribed),
        "prices_cached": len(_prices),
        "subscribed_tickers": sorted(_subscribed)[:50],
    }


def subscribe_tickers(tickers):
    """Add tickers to the subscription set. Thread-safe."""
    new = set(t.upper() for t in tickers) - _subscribed
    if not new:
        return
    _subscribed.update(new)
    # If WebSocket is running, send subscribe message
    if _ws_loop and _running:
        asyncio.run_coroutine_threadsafe(_async_subscribe(new), _ws_loop)
    _logger.info("[stream] Subscribed %d new tickers (total: %d)", len(new), len(_subscribed))


async def _async_subscribe(tickers):
    """Send subscribe message on the existing WebSocket connection."""
    global _ws_connection
    if _ws_connection:
        params = ",".join(f"T.{t},AM.{t}" for t in tickers)
        try:
            await _ws_connection.send(json.dumps({"action": "subscribe", "params": params}))
        except Exception as e:
            _logger.warning("[stream] Subscribe failed: %s", e)


async def _run_websocket():
    """Main WebSocket loop — connect, auth, subscribe, process messages."""
    global _ws_connection, _running
    import websockets

    api_key = os.environ.get("MASSIVE_API_KEY", "")
    if not api_key:
        _logger.warning("[stream] MASSIVE_API_KEY not set — WebSocket disabled")
        return

    backoff = 1
    while True:
        try:
            _logger.info("[stream] Connecting to %s...", _WS_URL)
            async with websockets.connect(_WS_URL, ping_interval=30, ping_timeout=10) as ws:
                _ws_connection = ws
                _running = True
                backoff = 1  # Reset on successful connect

                # Authenticate
                await ws.send(json.dumps({"action": "auth", "params": api_key}))
                auth_resp = await asyncio.wait_for(ws.recv(), timeout=10)
                auth_data = json.loads(auth_resp)
                if isinstance(auth_data, list):
                    auth_data = auth_data[0]
                status = auth_data.get("status", "")
                if status != "auth_success":
                    _logger.error("[stream] Auth failed: %s", auth_data)
                    _running = False
                    return
                _logger.info("[stream] Authenticated successfully")

                # Subscribe to trades (tick-by-tick) + per-minute aggregates (backup)
                if _subscribed:
                    params = ",".join(f"T.{t},AM.{t}" for t in _subscribed)
                    await ws.send(json.dumps({"action": "subscribe", "params": params}))
                    _logger.info("[stream] Subscribed to %d tickers (trades + aggregates)", len(_subscribed))

                # Process messages
                async for raw_msg in ws:
                    try:
                        messages = json.loads(raw_msg)
                        if not isinstance(messages, list):
                            messages = [messages]
                        for msg in messages:
                            _process_message(msg)
                    except json.JSONDecodeError:
                        pass
                    except Exception as e:
                        _logger.warning("[stream] Message processing error: %s", e)

        except Exception as e:
            _logger.warning("[stream] WebSocket disconnected: %s — reconnecting in %ds", e, backoff)
            _running = False
            _ws_connection = None
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


def _process_message(msg):
    """Process a single WebSocket message (trade or per-minute aggregate)."""
    ev = msg.get("ev")
    if ev == "status":
        return  # Status messages (connected, auth, subscribed)

    if ev == "T":  # Individual trade — tick-by-tick
        sym = msg.get("sym", "")
        if not sym:
            return
        trade_price = msg.get("p", 0)  # Trade price
        trade_size = msg.get("s", 0)   # Trade size (shares)
        timestamp = msg.get("t", 0)    # Timestamp (nanoseconds)

        with _lock:
            prev = _prices.get(sym, {})
            prev_close = prev.get("prev_close", trade_price)
            if prev_close and prev_close > 0:
                change_pct = round((trade_price - prev_close) / prev_close * 100, 4)
            else:
                change_pct = 0.0
            _prices[sym] = {
                "price": round(trade_price, 2),
                "change_pct": change_pct,
                "change": round(trade_price - prev_close, 4) if prev_close else 0,
                "volume": prev.get("volume", 0) + trade_size,
                "prev_close": prev_close,
                "timestamp": timestamp,
                "updated_at": time.time(),
            }
        return

    if ev == "AM":  # Per-minute aggregate
        sym = msg.get("sym", "")
        if not sym:
            return
        close_price = msg.get("c", 0)  # Close of this minute bar
        open_price = msg.get("o", 0)   # Open of this minute bar
        volume = msg.get("v", 0)       # Volume this minute
        vwap = msg.get("vw", 0)        # VWAP this minute
        day_open = msg.get("op", 0)    # Day's opening price (if available)
        timestamp = msg.get("e", 0)    # End timestamp (ms)

        with _lock:
            prev = _prices.get(sym, {})
            prev_close = prev.get("prev_close", day_open or close_price)

            # Calculate change %
            if prev_close and prev_close > 0:
                change_pct = round((close_price - prev_close) / prev_close * 100, 4)
            else:
                change_pct = 0.0

            _prices[sym] = {
                "price": round(close_price, 2),
                "change_pct": change_pct,
                "change": round(close_price - prev_close, 4) if prev_close else 0,
                "volume": volume + prev.get("volume", 0),  # Accumulate daily volume
                "prev_close": prev_close,
                "timestamp": timestamp,
                "updated_at": time.time(),
            }


def start_stream():
    """Start the WebSocket stream in a background thread."""
    global _ws_loop

    def _thread_target():
        global _ws_loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        _ws_loop = loop
        loop.run_until_complete(_run_websocket())

    t = threading.Thread(target=_thread_target, daemon=True, name="realtime-stream")
    t.start()
    _logger.info("[stream] WebSocket stream thread started")


def stop_stream():
    """Stop the WebSocket stream."""
    global _running, _ws_connection
    _running = False
    if _ws_connection:
        asyncio.run_coroutine_threadsafe(_ws_connection.close(), _ws_loop)
    _logger.info("[stream] WebSocket stream stopped")
