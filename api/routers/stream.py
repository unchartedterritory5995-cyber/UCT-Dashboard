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

from api.services import bars_liveness, realtime_candle, realtime_stream
from api.services.realtime_stream import (
    get_realtime_prices, subscribe_tickers, unsubscribe_tickers, get_stream_status
)

_logger = logging.getLogger(__name__)

router = APIRouter()

MAX_SSE_TICKERS = 50  # Finnhub free tier cap; prevents unbounded subscription growth


def _build_candle_events(tickers, last_state: dict) -> list[dict]:
    """Detect candle state changes and produce event dicts.

    Args:
      tickers: iterable of ticker symbols to check
      last_state: dict {sym: (t, c, v)} mutated in-place to track current state

    Returns:
      List of event dicts: {"type": "tick", "sym", "price", "ts", "vol"} or
                            {"type": "bar_close", "sym", "tf", "bar"}
    """
    events: list[dict] = []
    for sym in tickers:
        sym_u = sym.upper()
        cur = realtime_candle.get_current(sym_u, "1")
        if not cur:
            continue
        cur_key = (cur["t"], cur["c"], cur["v"])
        prev = last_state.get(sym_u)
        if prev == cur_key:
            continue
        # Detect bar boundary close: prev existed and prev_t != cur_t
        if prev and prev[0] != cur["t"]:
            # Emit bar_close for the prior bar
            events.append({
                "type": "bar_close",
                "sym": sym_u,
                "tf": "1",
                "bar": {"t": prev[0], "c": prev[1], "v": prev[2]},
            })
        # Always emit tick on any change
        events.append({
            "type": "tick",
            "sym": sym_u,
            "price": cur["c"],
            "ts": cur.get("last_tick_ts"),
            "vol": cur["v"],
        })
        last_state[sym_u] = cur_key
    return events


def _build_stale_events(tickers, now=None):
    """Return list of stale event dicts for tickers whose last tick is too old.

    Args:
      tickers: iterable of ticker symbols
      now: epoch seconds; defaults to time.time()

    Returns:
      List of {"type": "stale", "sym": SYM, "last_seen": ts} dicts.
    """
    if now is None:
        now = int(time.time())
    events = []
    for sym in tickers:
        last_seen = realtime_stream.get_last_seen(sym)
        if last_seen is None:
            continue
        if bars_liveness.is_stale(last_seen, tf="1", market_open=None):
            events.append({"type": "stale", "sym": sym.upper(), "last_seen": last_seen})
    return events


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

    # Subscribe these tickers to the Finnhub WebSocket stream (fallback source).
    subscribe_tickers(ticker_list)

    # ALSO register interest on the MASSIVE feed (the same sub-second feed that
    # drives the candle). Finnhub's free tier trickles trades out (a given ticker
    # can go minutes between updates), so watchlist/theme/header quotes looked
    # frozen; Massive delivers tick-by-tick. We read its developing bar directly
    # (get_last_price) below — interest keeps the symbol subscribed upstream
    # WITHOUT a per-tick queue on the request loop. Best-effort: if the bars feed
    # is disabled/uninitialized we silently fall back to Finnhub-only.
    _bb = None
    try:
        from api.services.bar_broadcaster import get_broadcaster
        _bb = get_broadcaster()
        _bb.add_interest(ticker_list)
    except Exception:
        _bb = None

    async def event_generator():
        last_prices = {}  # {sym: price} — only compare price field to avoid unnecessary pushes
        heartbeat_interval = 15  # seconds
        last_heartbeat = time.time()

        # Liveness tracking: emit stale/fresh events on transitions only (not steady-state)
        already_stale: set[str] = set()
        last_stale_check = 0  # epoch seconds

        # Candle event tracking: {sym: (t, c, v)} — last seen state per ticker
        last_candle_state: dict = {}

        # Correction queue handle (drain once per loop)
        correction_queue = realtime_candle.get_correction_queue()

        try:
            while True:
                # Exit immediately when browser disconnects — prevents zombie coroutines
                if await request.is_disconnected():
                    break

                # Get latest prices for requested tickers (Finnhub store — fallback).
                current = get_realtime_prices(ticker_list)

                # Overlay the MASSIVE live price where we have a fresh tick — it's
                # the same sub-second feed powering the candle, vs Finnhub's
                # throttled trickle. Only the `price` is overlaid; the client
                # recomputes the day % from this price + the REST prev close.
                if _bb is not None:
                    for sym in ticker_list:
                        mp = _bb.get_last_price(sym)
                        if mp and mp.get("price") is not None:
                            entry = current.get(sym)
                            if entry is None:
                                entry = {}
                                current[sym] = entry
                            entry["price"] = mp["price"]
                            # Live cumulative day volume (Massive `av`) overlays the
                            # 15s REST value so the Volume column ticks too.
                            if mp.get("volume") is not None:
                                entry["volume"] = mp["volume"]
                            entry["updated_at"] = int(time.time())

                # Only send if any ticker's price OR live volume actually changed
                # (volume is included so the Volume column still ticks on a trade
                # that prints at the same price).
                prices_now = (
                    {s: (d.get("price"), d.get("volume")) for s, d in current.items()}
                    if current else {}
                )
                if prices_now != last_prices and current:
                    last_prices = prices_now
                    yield f"data: {json.dumps(current)}\n\n"

                # Candle events: tick + bar_close emissions (per-iteration, cheap)
                candle_events = _build_candle_events(ticker_list, last_candle_state)
                for ev in candle_events:
                    if ev["type"] == "tick":
                        yield f"event: tick\ndata: {json.dumps(ev)}\n\n"
                    elif ev["type"] == "bar_close":
                        yield f"event: bar_close\ndata: {json.dumps(ev)}\n\n"

                # Drain bar_correction events from reconciliation worker (non-blocking)
                try:
                    while True:
                        ev = correction_queue.get_nowait()
                        yield f"event: bar_correction\ndata: {json.dumps(ev)}\n\n"
                except asyncio.QueueEmpty:
                    pass
                except Exception:
                    pass

                # Liveness probe: at most once per second, detect stale/fresh transitions
                now_int = int(time.time())
                if now_int > last_stale_check:
                    last_stale_check = now_int
                    stale_events = _build_stale_events(ticker_list, now=now_int)
                    currently_stale = {e["sym"] for e in stale_events}
                    # Emit stale for newly-stale tickers
                    for e in stale_events:
                        if e["sym"] not in already_stale:
                            yield f"event: stale\ndata: {json.dumps(e)}\n\n"
                            already_stale.add(e["sym"])
                    # Emit fresh for recovered tickers
                    for sym in list(already_stale - currently_stale):
                        yield f"event: fresh\ndata: {json.dumps({'type': 'fresh', 'sym': sym})}\n\n"
                        already_stale.discard(sym)

                # Heartbeat to keep connection alive through proxies. Sent as a
                # NAMED event (not an SSE comment) so the client's watchdog can
                # reset on it and tell a quiet-but-healthy stream from a dead one.
                if time.time() - last_heartbeat > heartbeat_interval:
                    yield "event: heartbeat\ndata: {}\n\n"
                    last_heartbeat = time.time()

                # 250ms cadence (was 100ms). Every open tab holds one of these
                # loops on the SINGLE event loop; at launch scale the 10Hz tick
                # (snapshot + diff per connection) was measurable pure overhead.
                # 4Hz is still far below human perception for price updates.
                await asyncio.sleep(0.25)
        finally:
            # Clean up subscriptions when client disconnects so _subscribed
            # doesn't grow unbounded as users navigate between pages.
            unsubscribe_tickers(ticker_list)
            if _bb is not None:
                try:
                    _bb.remove_interest(ticker_list)
                except Exception:
                    pass

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
        if sym and tf in ("1", "5", "15", "30", "60"):  # 60-min uses canonical ET-anchored bucket
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
                    # 250ms idle floor — MATCH stream_prices (deliberately slowed
                    # 100ms→250ms because every open tab holds one of these loops on the
                    # single shared event loop; 20Hz here was 2x that tuned budget). The
                    # broadcaster's 10Hz upstream throttle already caps freshness, so the
                    # extra ≤250ms drain latency is imperceptible.
                    await asyncio.sleep(0.25)

                if time.time() - last_heartbeat > 15:
                    # NAMED event (not a `:` comment): a bare comment keeps the
                    # connection alive through proxies but is NOT surfaced to
                    # EventSource as a JS event, so the pooled client's liveness
                    # watchdog could never see it and would false-reconnect a
                    # healthy-but-idle stream. A named heartbeat both keeps the
                    # pipe warm AND lets the client touch its last-seen timer.
                    yield "event: heartbeat\ndata: {}\n\n"
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
