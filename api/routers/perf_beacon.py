"""Real-user speed doors (desktop speed plan Step 10.1).

  POST /api/perf/beacon   — one page-load report, sent with navigator.sendBeacon.
                            No session needed and none is read: the report is
                            anonymous by construction (api/services/perf_beacon.py).
  GET  /api/admin/perf    — admin: per page, per API route, per country percentiles.

⚠️ MOUNT: `app.include_router(perf_beacon_router.router)` in api/main.py, before
the SPA catch-all like every /api route.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from starlette.concurrency import run_in_threadpool

from api.middleware.auth_middleware import require_admin
from api.services import perf_beacon
from api.services.request_ip import client_ip

router = APIRouter(tags=["perf-beacon"])


@router.post("/api/perf/beacon")
async def post_perf_beacon(request: Request) -> dict[str, Any]:
    """Always 200 for a readable body (an over-quota or malformed report is counted, not retried)."""
    if not perf_beacon.enabled():
        return {"ok": True, "enabled": False}
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > perf_beacon.MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Report too large")
    raw = bytearray()
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > perf_beacon.MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Report too large")
    try:
        body = json.loads(bytes(raw).decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError, RecursionError):
        raise HTTPException(status_code=400, detail="Body must be JSON")
    result = await run_in_threadpool(
        perf_beacon.record, body, ip=client_ip(request), country_header=request.headers.get("cf-ipcountry"))
    return {"ok": True, "enabled": True, **result}


@router.get("/api/admin/perf")
def admin_perf(
    hours: int = Query(default=24, ge=1, le=perf_beacon.RETENTION_DAYS * 24),
    _admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    return perf_beacon.summary(hours)
