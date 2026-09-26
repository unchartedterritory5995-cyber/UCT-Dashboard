"""`GET /api/admin/notebook-soak` — the 30-day soak's one server read (wave 9, 9C).

    GET /api/admin/notebook-soak?since=<ISO 8601>&until=<ISO 8601, optional>

Admin only (`require_admin`, the same dependency `api/routers/client_errors.py`
uses), read only, aggregates only. The figures and every rule behind them are
`api/services/journal_two/notebook_soak.py`; this file is the HTTP shape.

Ruling D-9C2: this endpoint is the ONLY server-side addition the soak makes —
no scheduled job, no table, no flag. The local observer (`tools/nb_observe.py`)
calls it once per two-hour run through the rig's signed-in page.

⛔ A timestamp that cannot be read, or a window over 45 days, is a 400 WITH A
SENTENCE — never a silent clamp. An instrument that quietly shortened the window
it was asked for would report a figure for a period nobody chose.

⚠️ MOUNT (the controller's step, not this lane's): `api/main.py` gains
`from api.routers import notebook_soak` and
`app.include_router(notebook_soak.router)` BEFORE the SPA catch-all, beside the
`client_errors` router. No path here collides with another router's.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from api.middleware.auth_middleware import require_admin
from api.services.journal_two import notebook_soak

router = APIRouter(tags=["notebook-soak"])


def parse_instant(raw: Optional[str], name: str) -> Optional[datetime]:
    """An ISO 8601 instant, or a 400 that says which parameter and why.
    A value with no offset is read as UTC — the soak's windows are UTC."""
    if raw is None or raw == "":
        return None
    try:
        dt = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"`{name}` is not an ISO 8601 timestamp (for example 2026-10-01T14:00:00Z).",
        )
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


@router.get("/api/admin/notebook-soak")
async def admin_notebook_soak(
    since: str = Query(..., description="window start, ISO 8601"),
    until: Optional[str] = Query(default=None, description="window end, ISO 8601; default now"),
    _admin: dict = Depends(require_admin),
) -> dict[str, Any]:
    start = parse_instant(since, "since")
    if start is None:
        raise HTTPException(status_code=400, detail="`since` is required.")
    end = parse_instant(until, "until")
    try:
        notebook_soak.validate_window(start, end)
    except notebook_soak.SoakWindowError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # ⛔ The reads are SQLite and a JSON parse per row: the threadpool, never the
    # one event loop every member shares (the same split as the client-errors
    # door, `api/routers/client_errors.py`).
    return await run_in_threadpool(notebook_soak.soak_summary, start, end)
