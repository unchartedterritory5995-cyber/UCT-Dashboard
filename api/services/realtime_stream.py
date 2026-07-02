"""
Real-time price streaming via Finnhub WebSocket (primary) + Massive REST (fallback).

Connects to wss://ws.finnhub.io for tick-by-tick trade data and maintains
an in-memory price dict that the SSE endpoint fans out to frontend clients.

Falls back to Massive REST polling (2s interval) if WebSocket unavailable.
"""

import asyncio
import json
import logging
import os
import threading
import time

_logger = logging.getLogger(__name__)

# Finnhub WebSocket (free tier, real-time US equity trades)
_FINNHUB_KEY = os.environ.get("FINNHUB_API_KEY", "")
_WS_URL = f"wss://ws.finnhub.io?token={_FINNHUB_KEY}" if _FINNHUB_KEY else ""

# In-memory price store: {SYM: {price, change_pct, volume, prev_close, timestamp, updated_at}}
_prices = {}
_lock = threading.Lock()

# Subscribed tickers
_subscribed = set()
_ws_connection = None
_ws_loop = None
_running = False

# Per-ticker last-tick timestamp (epoch seconds) — feeds liveness probe + stale SSE event
_last_seen: dict[str, int] = {}


_STREAM_FIELDS = {"price", "change_pct", "change", "timestamp", "updated_at"}


def get_realtime_prices(tickers=None):
    """Get latest prices from the stream.
    Returns dict of {SYM: {price, change_pct, change, timestamp, updated_at}}.

    prev_close is stripped — it starts seeded to trade_price on first tick, which
    would overwrite REST polling's correct prev_close value in the browser merge.
    REST polling owns prev_close; stream owns only the live tick fields.
    """
    with _lock:
        if tickers:
            raw = {s: _prices[s] for s in tickers if s in _prices}
        else:
            raw = dict(_prices)
    return {s: {k: v for k, v in d.items() if k in _STREAM_FIELDS} for s, d in raw.items()}


def get_stream_status():
    """Return WebSocket connection status."""
    return {
        "connected": _running,
        "provider": "finnhub" if _FINNHUB_KEY else "none",
        "subscribed_count": len(_subscribed),
        "prices_cached": len(_prices),
        "subscribed_tickers": sorted(_subscribed)[:50],
        "last_seen_ages": get_last_seen_ages(),
    }


def _record_tick(sym: str, price: float, ts: int) -> None:
    """Record a tick. Updates _last_seen and the existing _prices dict.

    Called from the WS message handler when a trade tick arrives, and exposed
    for tests and any future synthetic tick injection. Complements (does not
    replace) the richer prev_close-aware update in _process_finnhub_trade.

    Also feeds realtime_candle.apply_tick for every intraday timeframe — the
    candle state machine owns the developing-bar OHLCV that the SSE layer
    streams to chart clients. Wrapped in try/except so observability failures
    never break tick handling.
    """
    sym = sym.upper()
    with _lock:
        _last_seen[sym] = int(ts)
        # Also update _prices so existing /api/stream/prices behavior is preserved
        if sym in _prices:
            _prices[sym]["price"] = price
            _prices[sym]["timestamp"] = int(ts)
            _prices[sym]["updated_at"] = int(time.time())
        else:
            _prices[sym] = {
                "price": price,
                "timestamp": int(ts),
                "updated_at": int(time.time()),
            }

    # Feed realtime_candle (separate lock — no contention with _lock above).
    # Lazy import avoids any future circular-dep risk if realtime_candle ever
    # needs to reach back into realtime_stream. size=1 is a placeholder; when
    # _process_finnhub_trade gains a size-aware path it can call apply_tick
    # directly with the real trade volume.
    try:
        from api.services import realtime_candle
        for tf in ("1", "5", "15", "30", "60"):
            realtime_candle.apply_tick(sym, price=price, ts=int(ts), size=1, tf=tf)
    except Exception:
        pass  # observability layer; never break tick handling


def get_last_seen(sym: str) -> int | None:
    """Return the most recent tick timestamp (epoch seconds) for sym, or None."""
    with _lock:
        return _last_seen.get(sym.upper())


def get_last_seen_ages(now: int | None = None) -> dict[str, int]:
    """Return {ticker: seconds_since_last_tick} for all tracked tickers."""
    if now is None:
        now = int(time.time())
    with _lock:
        return {sym: now - ts for sym, ts in _last_seen.items()}


def subscribe_tickers(tickers):
    """Add tickers to the subscription set. Thread-safe."""
    up = set(t.upper() for t in tickers)
    # Mutate under _lock so the WS reconnect thread never iterates _subscribed
    # mid-mutation ("set changed size during iteration").
    with _lock:
        new = up - _subscribed
        if not new:
            return
        _subscribed.update(new)
        total = len(_subscribed)
    # If WebSocket is running, send subscribe messages
    if _ws_loop and _running:
        asyncio.run_coroutine_threadsafe(_async_subscribe(new), _ws_loop)
    _logger.info("[stream] Subscribed %d new tickers (total: %d)", len(new), total)


def unsubscribe_tickers(tickers):
    """Remove tickers from the subscription set and send unsubscribe messages."""
    down = set(t.upper() for t in tickers)
    with _lock:
        to_remove = down & _subscribed
        if not to_remove:
            return
        _subscribed.difference_update(to_remove)
    if _ws_loop and _running:
        asyncio.run_coroutine_threadsafe(_async_unsubscribe(to_remove), _ws_loop)
    _logger.debug("[stream] Unsubscribed %d tickers (total: %d)", len(to_remove), len(_subscribed))


async def _async_unsubscribe(tickers):
    """Send unsubscribe messages on the existing Finnhub WebSocket."""
    global _ws_connection
    if not _ws_connection:
        return
    for sym in tickers:
        try:
            await _ws_connection.send(json.dumps({"type": "unsubscribe", "symbol": sym}))
        except Exception as e:
            _logger.warning("[stream] Unsubscribe %s failed: %s", sym, e)


async def _async_subscribe(tickers):
    """Send subscribe messages on the existing Finnhub WebSocket."""
    global _ws_connection
    if not _ws_connection:
        return
    for sym in tickers:
        try:
            await _ws_connection.send(json.dumps({"type": "subscribe", "symbol": sym}))
        except Exception as e:
            _logger.warning("[stream] Subscribe %s failed: %s", sym, e)


def _load_full_universe():
    """Load all tickers from cap_universe.json for full WebSocket subscription."""
    import json as _json
    try:
        path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "cap_universe.json")
        with open(path) as f:
            tickers = _json.load(f)
        return set(t.upper() for t in tickers if t)
    except Exception:
        return set()


async def _run_websocket():
    """Main WebSocket loop — connect, subscribe, process Finnhub trade messages."""
    global _ws_connection, _running
    import websockets

    if not _FINNHUB_KEY:
        _logger.warning("[stream] FINNHUB_API_KEY not set — WebSocket disabled")
        return

    backoff = 1
    while True:
        try:
            _logger.info("[stream] Connecting to Finnhub WebSocket...")
            async with websockets.connect(_WS_URL, ping_interval=30, ping_timeout=10) as ws:
                _ws_connection = ws
                _running = True
                backoff = 1
                _logger.info("[stream] Finnhub WebSocket connected")

                # Re-subscribe only already-requested tickers (lazy subscription model).
                # Bulk-subscribing the full 3,685-ticker universe on every connect
                # saturates Finnhub free-tier limits and wastes bandwidth.
                with _lock:  # snapshot under lock (mutated from the event-loop thread)
                    all_tickers = sorted(_subscribed)
                for sym in all_tickers:
                    await ws.send(json.dumps({"type": "subscribe", "symbol": sym}))
                if all_tickers:
                    _logger.info("[stream] Re-subscribed %d active tickers on reconnect", len(all_tickers))

                # Process messages
                async for raw_msg in ws:
                    try:
                        data = json.loads(raw_msg)
                        msg_type = data.get("type", "")
                        if msg_type == "trade":
                            for trade in (data.get("data") or []):
                                _process_finnhub_trade(trade)
                        elif msg_type == "ping":
                            await ws.send(json.dumps({"type": "pong"}))
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


def _process_finnhub_trade(trade):
    """Process a single Finnhub trade event.

    trade = {"p": 150.25, "s": "AAPL", "t": 1713200000000, "v": 100, "c": [...]}
      p = price, s = symbol, t = timestamp (ms), v = volume, c = conditions
    """
    sym = trade.get("s", "")
    if not sym:
        return
    trade_price = trade.get("p", 0)
    trade_vol = trade.get("v", 0)
    timestamp = trade.get("t", 0)  # milliseconds

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
            # volume intentionally omitted: REST polling owns accurate day volume.
            # Accumulating tick volumes here produced unbounded runaway totals.
            "prev_close": prev_close,
            "timestamp": timestamp,
            "updated_at": time.time(),
        }
        # Record liveness — Finnhub timestamps are ms, _last_seen tracks epoch seconds
        ts_seconds = int(timestamp / 1000) if timestamp else int(time.time())
        _last_seen[sym] = ts_seconds

    # Feed realtime_candle (separate lock — no contention with _lock above).
    # _record_tick is NOT called from this production path, so we hook the
    # candle state machine directly here. Wrapped in try/except so observability
    # failures never break tick handling.
    try:
        from api.services import realtime_candle
        actual_size = int(trade_vol) if trade_vol else 1
        for tf in ("1", "5", "15", "30", "60"):
            realtime_candle.apply_tick(sym, price=trade_price, ts=ts_seconds, size=actual_size, tf=tf)
    except Exception:
        pass  # observability layer; never break tick handling


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
    _logger.info("[stream] Finnhub WebSocket stream thread started")


def stop_stream():
    """Stop the WebSocket stream."""
    global _running, _ws_connection
    _running = False
    if _ws_connection and _ws_loop:
        asyncio.run_coroutine_threadsafe(_ws_connection.close(), _ws_loop)
    _logger.info("[stream] WebSocket stream stopped")
