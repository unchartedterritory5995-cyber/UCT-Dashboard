"""SSE endpoint for the live options-flow stream (2026-07-08).

GET /api/live/massive/stream — pushes newly-classified OPRA prints to the browser
the instant the tailer sees them (see api/massive_stream.py). Mirrors the proven
/api/stream/bars pattern: StreamingResponse, text/event-stream, named heartbeat,
and — critically — unsubscribe in a finally block so a disconnect can never leak
the subscriber (the leak class that OOM'd the pod on 7/8).

Additive + decoupled: this router is separate from live_massive_router.py so it
never collides with the ingest/read-path work there. Inert unless
MASSIVE_STREAM_ENABLED=1 (the tailer only broadcasts when enabled).
"""
import asyncio
import json
import logging
import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse

from api import massive_stream

log = logging.getLogger(__name__)
router = APIRouter()

_HEARTBEAT_SEC = 15
_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",  # disable proxy buffering so events flush immediately
}


@router.get("/api/live/massive/stream")
async def massive_stream_sse(request: Request):
    """Live push of new flow prints. Client reconnects (EventSource) on drop."""
    if not massive_stream.ENABLED:
        # dark: tell the client to fall back to polling rather than hold a dead stream
        return JSONResponse({"enabled": False}, status_code=503)

    q = massive_stream.subscribe()
    if q is None:  # subscriber cap reached — client should poll
        return JSONResponse({"enabled": True, "reason": "at_capacity"}, status_code=503)

    async def gen():
        try:
            # initial hello so the client flips to "connected" immediately
            yield "event: connected\ndata: {}\n\n"
            last_hb = time.time()
            while True:
                if await request.is_disconnected():
                    break
                try:
                    alerts = await asyncio.wait_for(q.get(), timeout=5.0)
                    yield f"data: {json.dumps({'alerts': alerts}, default=str)}\n\n"
                except asyncio.TimeoutError:
                    pass  # fall through to heartbeat / disconnect check
                if time.time() - last_hb > _HEARTBEAT_SEC:
                    # named heartbeat keeps proxies open + signals healthy-idle
                    yield "event: heartbeat\ndata: {}\n\n"
                    last_hb = time.time()
        except asyncio.CancelledError:
            raise
        finally:
            massive_stream.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.post("/api/live/massive/stream-test")
def massive_stream_test(request: Request):
    """Push a synthetic 'ZZTEST' print through the live stream — proves the
    tailer→broadcast→SSE→browser path without needing live market flow. Gated by
    PUSH_SECRET (Bearer header or ?token=). Harmless: fake ticker, huge synthetic
    id so it never collides with a real row."""
    import os
    import time as _t

    secret = os.environ.get("PUSH_SECRET", "")
    auth = request.headers.get("authorization", "")
    token = request.query_params.get("token", "")
    if not secret or (auth != f"Bearer {secret}" and token != secret):
        return JSONResponse({"error": "unauthorized"}, status_code=403)

    now = _t.time()
    fake = {
        "id": 9_999_999_999,
        "alertType": "massive", "alertName": "TEST PRINT (stream check)",
        "symbol": "ZZTEST", "ticker": "ZZTEST",
        "cp": "C", "strike": 100.0, "exp": "1/16/2026", "dte": 30,
        "alertPremium": 123456.0, "averageFillPrice": 1.23, "tradeSize": 100,
        "timestamp": now, "receivedAt": now,
        "spot": 99.0, "moneynessPct": 1.0, "moneynessLabel": "OTM",
        "grade": "A", "convictionScore": 99, "_tierKey": "size",
        "priorOI": 50, "volumeOIRatio": 2.0, "oiExceeded": True,
        "_isTest": True,
    }
    massive_stream._broadcast([fake])
    return {"broadcast_to": massive_stream.subscriber_count(), "sent_id": fake["id"]}


@router.get("/api/live/massive/stream-status")
def massive_stream_status():
    """Observability: is the stream armed + how many browsers are attached."""
    return {
        "enabled": massive_stream.ENABLED,
        "subscribers": massive_stream.subscriber_count(),
        "tail_sec": massive_stream.TAIL_SEC,
        "last_id": massive_stream._last_id,
    }
