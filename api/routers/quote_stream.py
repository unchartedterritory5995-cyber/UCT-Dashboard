"""`/api/stream/quotes`: PUSHED real-time list prices (SSE), one connection for a member's whole list.

Served by stream-edge (api/stream_edge_main.py, the member's `uct_chart_edge` cookie) and by web (session
auth) with the SAME function, exactly as `/api/stream/bars`. The data is the ingest feed's per-trade last
price, already on both pods (RemoteBroadcaster's mirror); api/services/quote_hub.py turns it into one
conflated price channel per symbol and fans the same frame bytes out to every member.

Wire (text/event-stream):
    event: hello      data: {"symbols": n, "max_hz": 4.0}             first frame
    event: status     data: {"live": true|false}                       at the start and on every change
                      (false = ingest's vendor socket is down or no batch for 5 s: the client polls REST)
    data: [1732550000180,["AAPL",231.45,12345678,1732550000123],...]   one per write: the server write ms,
                      then every pending quote [sym, price, day volume, trade ms] (quote_hub)
    event: heartbeat  data: {}                                         every 15 s of silence

⛔ BEHIND A FLAG, DEFAULT OFF: `QUOTE_STREAM_ENABLED=1` on the pod, plus the client's own key
(`localStorage['uct.quotePush']='1'` or the `uct_quote_push=1` cookie, app/src/lib/quotePush.js). Off, the
route answers 503 `disabled` and the client keeps polling. KILL SWITCH: unset the env var (then redeploy:
`railway variable delete` stages without restarting) or `localStorage['uct.quotePush.disabled']='1'`.

ADMISSION is the bars stream's: the same `MAX_SUBSCRIBERS` per stream (`STREAM_MAX_SUBSCRIBERS`, its own
"quotes" registry so a wall of quote lists never locks out charts and vice versa), 503 `at_capacity` when
full (the client keeps polling and retries with backoff), at most MAX_QUOTE_SYMBOLS symbols a connection
(the REST /api/live-prices cap, so one request's list is one connection). Admission comes BEFORE any upstream
interest, and everything taken is released when the stream ends.

Per-connection cost is bounded by construction (quote_hub.QuoteConn): at most one pending quote per symbol;
one socket write per wake (at most one per ingest batch, ~20/s), all pending quotes in ONE message. The
generator awaits its event with no per-wake timeout (the hub wakes every member once a second for the
heartbeat, status and disconnect checks). Everything the stream took is released ONCE, from the generator
AND from the response itself (api/sse_response.py: a body torn down before its first step).
`QUOTE_STREAM_WRITE_FLOOR_S` (default 0) spaces a connection's writes further at very large scale.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import time

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from api.bars_auth import require_bars_access
from api.sse_response import ReleasingStreamingResponse, release_once
from api.routers import stream as stream_router
from api.services import quote_hub

_logger = logging.getLogger(__name__)

router = APIRouter()

STREAM = "quotes"
#: One connection carries a member's whole list: the REST cap (api/routers/live_prices.py _MAX_TICKERS).
MAX_QUOTE_SYMBOLS = 250
#: A ticker the ingest feed protocol can carry (feed_protocol.SYM_PATTERN); anything else is dropped here.
_SYM_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
HEARTBEAT_S = 15.0
WAIT_S = 1.0
DISCONNECT_CHECK_S = 1.0


def enabled() -> bool:
    return os.environ.get("QUOTE_STREAM_ENABLED") == "1"


def _write_floor_s() -> float:
    try:
        return max(0.0, float(os.environ.get("QUOTE_STREAM_WRITE_FLOOR_S", "0") or 0))
    except ValueError:
        return 0.0


def _parse(tickers: str) -> list:
    out, seen = [], set()
    for raw in (tickers or "").split(","):
        s = raw.strip().upper()
        if s and s not in seen and _SYM_RE.fullmatch(s):
            seen.add(s)
            out.append(s)
    return out[:MAX_QUOTE_SYMBOLS]


def _event(name: str, obj) -> bytes:
    return f"event: {name}\ndata: {json.dumps(obj)}\n\n".encode()


@router.get("/api/stream/quotes")
async def stream_quotes(
    request: Request,
    tickers: str = Query(..., description="Comma-separated ticker symbols (at most 250)"),
    _access: dict = Depends(require_bars_access),
):
    """SSE: pushed last price per symbol, conflated (latest wins, at most QUOTE_STREAM_MAX_HZ a symbol)."""
    if not enabled():
        return JSONResponse({"error": "quote stream disabled", "reason": "disabled", "stream": STREAM},
                            status_code=503)
    syms = _parse(tickers)
    if not syms:
        return JSONResponse({"error": "No valid tickers"}, status_code=400)
    try:
        from api.services.bar_broadcaster import get_broadcaster
        bb = get_broadcaster()
    except Exception:  # noqa: BLE001 - no broadcaster on this pod
        bb = None
    hub = quote_hub.hub_for(bb)
    if hub is None:
        # local mode (web's own socket) has no per-batch price sink: the client keeps polling
        return JSONResponse({"error": "quote stream unavailable", "reason": "unavailable", "stream": STREAM},
                            status_code=503)

    token = stream_router.subscribe(STREAM)
    if token is None:
        return stream_router._at_capacity(STREAM)
    held = {"conn": None, "interest": False}

    def _release() -> None:
        # Everything this stream took, released ONCE: from the generator's `finally` AND from the
        # response's own close (a body torn down before its first step never runs the `finally`).
        if held["conn"] is not None:
            hub.close(held["conn"])
        if held["interest"]:
            try:
                bb.remove_interest(syms)
            except Exception:  # noqa: BLE001
                pass
        stream_router.unsubscribe(STREAM, token)

    release = release_once(_release)
    try:
        bb.add_interest(syms)
        held["interest"] = True
        held["conn"] = conn = hub.open(syms, snapshot=bb.get_last_price)
    except BaseException:
        release()
        raise

    feed_live = getattr(bb, "feed_fresh", None)
    floor = _write_floor_s()

    async def event_generator():
        last_beat = time.monotonic()
        last_disc = time.monotonic()
        last_live = None
        try:
            yield _event("hello", {"symbols": len(syms), "max_hz": hub.max_hz})
            while True:
                if feed_live is not None:
                    try:
                        live = bool(feed_live())
                    except Exception:  # noqa: BLE001 - a status read never ends the stream
                        live = None
                    if live is not None and live != last_live:
                        last_live = live
                        yield _event("status", {"live": live})
                if not conn.pending:
                    if hub.ticking:
                        await conn.event.wait()         # the hub wakes every member once a second
                    else:
                        try:
                            await asyncio.wait_for(conn.event.wait(), WAIT_S)
                        except asyncio.TimeoutError:
                            pass
                chunk = conn.take()
                now = time.monotonic()
                if chunk:
                    yield chunk
                    last_beat = now
                    if floor:
                        await asyncio.sleep(floor)
                elif now - last_beat >= HEARTBEAT_S:
                    yield _event("heartbeat", {})
                    last_beat = now
                if now - last_disc >= DISCONNECT_CHECK_S:
                    last_disc = now
                    if await request.is_disconnected():
                        break
        finally:
            release()

    return ReleasingStreamingResponse(
        event_generator(),
        on_close=release,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def status() -> dict:
    """Counters only (no symbols, no prices): stream-edge's /internal/status reads it. Deliberately no
    route of its own on web: a new open read would be a finding (api/auth_surface_read_baseline.json)."""
    return {"enabled": enabled(), "subscribers": stream_router.subscriber_count(STREAM),
            "max_subscribers": stream_router.MAX_SUBSCRIBERS, "hub": quote_hub.get_hub().stats()}
