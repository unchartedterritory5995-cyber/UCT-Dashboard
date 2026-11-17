"""Admin read of the request-timing record (api/services/request_timing.py).

  GET /api/admin/request-timing?hours=24  per hour and per route class: time to first byte, the
                                           thread pool's hop time, and whether slow seconds were
                                           token starvation or the interpreter lock.

MOUNT: `app.include_router(request_timing_router.router)` in api/main.py, before the SPA catch-all.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query

from api.middleware.auth_middleware import require_admin
from api.services import request_timing, snapshot_hl

router = APIRouter(tags=["request-timing"])


@router.get("/api/admin/request-timing")
def admin_request_timing(
    hours: int = Query(default=24, ge=1, le=request_timing.RETENTION_DAYS * 24),
    _admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    out = request_timing.summary(hours)
    # The whole-market snapshot helper process (api/services/snapshot_hl.py): counters only.
    out["snapshot_child"] = snapshot_hl.stats()
    return out
