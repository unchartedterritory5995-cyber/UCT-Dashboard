"""Desktop app telemetry doors (desktop plan 5.1, v2 Task 30).

  POST /api/desktop/event                — the shell's report door. Session
                                           OPTIONAL: launch and crash events
                                           happen before sign-in.
  GET  /api/admin/desktop-events         — admin: counts, machines, halt triggers.

The store, validation, limits and alerts are `api/services/desktop_events.py`.
This file is the HTTP shape: the kill switch and the body cap come first,
before a byte of the body is parsed.

⚠️ MOUNT: `app.include_router(desktop_events_router.router)` in api/main.py,
before the SPA catch-all like every /api route.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool

from api.middleware.auth_middleware import get_current_user_optional, require_admin
from api.services import desktop_events
from api.services.request_ip import client_ip

router = APIRouter(tags=["desktop-events"])


async def _read_capped(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            size = int(declared)
        except ValueError:
            raise HTTPException(status_code=400, detail="Bad Content-Length")
        if size > desktop_events.MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Report too large")
    raw = bytearray()
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > desktop_events.MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Report too large")
    return bytes(raw)


@router.post("/api/desktop/event")
async def post_desktop_event(
    request: Request,
    user: Optional[dict] = Depends(get_current_user_optional),
) -> dict[str, Any]:
    """Body: `{"events": [event, ...]}` or a single event object.

    Always 200 for a well-formed body, including when the kill switch is off
    (`enabled: false`, nothing written), so the shell stops sending instead of
    retrying. Over-quota events are counted in `dropped`, never a 429."""
    if not desktop_events.enabled():
        return {"ok": True, "enabled": False, "stored": 0, "dropped": 0, "invalid": 0}
    raw = await _read_capped(request)
    try:
        body = json.loads(raw.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise HTTPException(status_code=400, detail="Body must be JSON")
    if isinstance(body, dict) and isinstance(body.get("events"), list):
        events = body["events"]
    elif isinstance(body, dict):
        events = [body]
    else:
        raise HTTPException(status_code=400, detail="Body must be an object")
    result = await run_in_threadpool(
        desktop_events.record_events, events,
        user_id=(user or {}).get("id"), ip=client_ip(request))
    return {"ok": True, "enabled": True, **result}


@router.get("/api/admin/desktop-events")
def admin_desktop_events(
    hours: int = Query(default=24, ge=1, le=desktop_events.RETENTION_DAYS * 24),
    _admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    return desktop_events.summary(hours=hours)
