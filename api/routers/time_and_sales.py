"""Time & Sales -- the live trade tape stream (COV-08 / FT-077, the T&S half).

GET /api/stream/time-and-sales/{sym}   paid; SSE (under /api/stream, so the GZip skip covers it)
GET /api/time-and-sales/status         admin; counters for verifying the feed after arming

The state and the load rules live in `api/services/time_and_sales.py`. This file owns only the
push cadence: each client stream wakes every PUSH_INTERVAL_S (<= 4 pushes a second) and sends,
in ONE batched event, whatever printed since its last push -- never one event per trade.

Event contract (the panel, app/src/pages/terminal/panels/TimeSalesPanel.jsx, reads exactly this):
  event: unavailable  {reason}               then the stream ends (off / feed_off / *_cap)
  event: snapshot     {sym, session, prints, method, cap, seq}
  (default message)   {prints, session, seq} new prints since the previous push, oldest first
  event: heartbeat    {session}              every HEARTBEAT_S while quiet

⛔ The unwatch is in a `finally`, so a client that disconnects can never leak its watch (the
leak class that OOM'd the pod on 2026-07-08, see massive_stream_router.py).
⛔ The flag is re-read while a stream is open: switching it off ends every open stream within
FLAG_RECHECK_S, with no redeploy.
"""
from __future__ import annotations

import asyncio
import json
import re
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user, require_admin
from api.services import time_and_sales as tas

router = APIRouter()

PUSH_INTERVAL_S = 0.25
HEARTBEAT_S = 15.0
FLAG_RECHECK_S = 5.0
_SYM_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")
_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Time and Sales requires a paid plan")
    return user


def _event(name: str | None, payload: dict) -> str:
    body = json.dumps(payload, separators=(",", ":"))
    return f"event: {name}\ndata: {body}\n\n" if name else f"data: {body}\n\n"


def _one_shot(reason: str):
    async def gen():
        yield _event("unavailable", {"reason": reason})
    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/api/stream/time-and-sales/{sym}")
async def time_and_sales_stream(sym: str, request: Request, user: dict = Depends(require_paid)):
    s = tas.normalize_symbol(sym)
    if not _SYM_RE.match(s):
        raise HTTPException(status_code=400, detail="Not a ticker")
    if not tas.enabled():
        # Dark: one event, no watch, no listener, no loop.
        return _one_shot("off")
    uid = str(user.get("id") or user.get("user_id") or "")

    async def gen():
        # The watch is taken INSIDE the generator, so a response that is never iterated can
        # never hold one; once taken, only the `finally` below releases it.
        ok, reason = tas.watch(s, uid)
        if not ok:
            yield _event("unavailable", {"reason": reason})
            return
        try:
            prints, seq = tas.prints_since(s, 0)
            yield _event("snapshot", {
                "sym": s, "session": tas.session_state(), "prints": prints, "seq": seq,
                "method": "tick", "cap": tas.BUFFER_PRINTS,
            })
            last_send = time.monotonic()
            last_flag = last_send
            while True:
                await asyncio.sleep(PUSH_INTERVAL_S)
                if await request.is_disconnected():
                    break
                now = time.monotonic()
                if now - last_flag >= FLAG_RECHECK_S:
                    last_flag = now
                    if not tas.enabled():
                        yield _event("unavailable", {"reason": "off"})
                        break
                new, seq2 = tas.prints_since(s, seq)
                if new:
                    seq = seq2
                    tas.note_push()
                    yield _event(None, {"prints": new, "seq": seq, "session": tas.session_state()})
                    last_send = now
                elif now - last_send >= HEARTBEAT_S:
                    yield _event("heartbeat", {"session": tas.session_state()})
                    last_send = now
        except asyncio.CancelledError:
            raise
        finally:
            tas.unwatch(s, uid)

    return StreamingResponse(gen(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/api/time-and-sales/status")
def time_and_sales_status(_admin: dict = Depends(require_admin)):
    """Counters for arming and verifying the tape: enabled? feed running? how many symbols and
    streams are open, and are prints arriving (prints_total) and being pushed (pushes_total)."""
    return tas.status()
