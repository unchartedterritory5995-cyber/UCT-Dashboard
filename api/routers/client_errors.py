"""Client error beacon + Notebook telemetry counts (wave 6, D14).

  POST /api/client-errors            — the beacon's door. Session OPTIONAL: a
                                       crash on the sign-in page matters too.
  GET  /api/admin/client-errors      — admin: grouped counts + recent rows.
  GET  /api/admin/notebook-telemetry — admin: count per allow-listed telemetry
                                       event over 7 and 30 days.

The store, the scrub and the rate limit are `api/services/client_errors.py`;
this file is the HTTP shape only.

⚠️ MOUNT: `app.include_router(client_errors_router.router)` in api/main.py —
the controller wires it. No path here collides with another router's.
"""
from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from api.middleware.auth_middleware import get_current_user_optional, require_admin
from api.services import client_errors
from api.services.request_ip import client_ip

router = APIRouter(tags=["client-errors"])


@router.post("/api/client-errors")
async def post_client_errors(
    request: Request,
    user: Optional[dict] = Depends(get_current_user_optional),
) -> dict[str, Any]:
    """Body: `{"reports": [report, …]}` or a single report object.

    Always 200 for a well-formed body — including when the kill switch is off
    (`enabled: false`, nothing written), so the page can stop sending for the
    rest of its life instead of retrying into a closed door. A rate-limited
    report is counted in `dropped`, never an error: the beacon is best-effort
    by contract and a 429 would only teach it to retry."""
    if not client_errors.enabled():
        return {"ok": True, "enabled": False, "stored": 0, "dropped": 0}
    raw = await request.body()
    if len(raw) > client_errors.MAX_BODY_BYTES:
        raise HTTPException(status_code=413, detail="Report too large")
    try:
        body = json.loads(raw.decode("utf-8") or "{}")
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Body must be JSON")
    if isinstance(body, dict) and isinstance(body.get("reports"), list):
        reports = body["reports"]
    elif isinstance(body, dict):
        reports = [body]
    else:
        raise HTTPException(status_code=400, detail="Body must be an object")
    result = client_errors.record_reports(
        reports,
        user_id=(user or {}).get("id"),
        ip=client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )
    return {"ok": True, "enabled": True, **result}


@router.get("/api/admin/client-errors")
def admin_client_errors(
    days: int = Query(default=1, ge=1, le=client_errors.RETENTION_DAYS),
    limit: int = Query(default=50, ge=1, le=200),
    _admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    return client_errors.summary(days=days, limit=limit)


@router.get("/api/admin/notebook-telemetry")
def admin_notebook_telemetry(_admin: dict = Depends(require_admin)) -> dict[str, Any]:
    """Counts per event for the 7- and 30-day windows, every allow-listed
    event present (zero when it never fired). The event set is the server's
    own allow-list, read here — never a second list."""
    from api.routers.journal_two import _J2_TELEMETRY_EVENTS
    from api.services.journal_two import notebook_telemetry
    return notebook_telemetry.event_counts(_J2_TELEMETRY_EVENTS)
