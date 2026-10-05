"""Calendar depth (Lane R): the calendar's dark read surfaces, one flag each.

  EARNINGS_DATE_STATUS_ENABLED    GET /api/calendar/date-status?syms=A,B   D-1 / D-2
  INDEX_REBALANCE_EVENTS_ENABLED  GET /api/calendar/index-events           D-3

(D-10's flag, CALENDAR_ORDER_EXPLAIN_ENABLED, is client-only and has no route.)

Each flag is read per request by its service's ``is_enabled()``; unset, the route
answers FastAPI's 404 before identity is read, like the Research > Depth panels.
Both handlers are plain ``def``: one reads a local SQLite store (blocking I/O) and
the other is pure computation, and neither calls a vendor.
"""
from __future__ import annotations

import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()
_SYM_RE = re.compile(r"^[A-Z0-9.\-]{1,12}$")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the calendar depth surfaces (each router owns its own 402 sentence)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Calendar depth requires a paid plan")
    return user


# ── D-1 / D-2 earnings-date status ──────────────────────────────────────────

def _date_status_armed() -> None:
    from api.services import earnings_date_status
    if not earnings_date_status.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/calendar/date-status", dependencies=[Depends(_date_status_armed)])
def date_status_route(syms: str = Query(..., min_length=1, max_length=4000),
                      _user: dict = Depends(require_paid)):
    from api.services import earnings_date_status as svc
    want = [s.strip().upper() for s in syms.split(",") if s.strip()]
    if not want:
        raise HTTPException(status_code=400, detail="No symbols")
    if len(want) > svc.MAX_SYMS:
        raise HTTPException(status_code=400, detail=f"At most {svc.MAX_SYMS} symbols per request")
    bad = [s for s in want if not _SYM_RE.match(s)]
    if bad:
        raise HTTPException(status_code=400, detail=f"Not a ticker: {bad[0]}")
    try:
        return svc.status_for(want)
    except Exception as exc:  # noqa: BLE001 -- an unreadable store is a stated outage, never "none"
        raise HTTPException(status_code=503,
                            detail=f"The date-status store could not be read ({type(exc).__name__})") from exc


# ── D-3 index-rebalance dates ───────────────────────────────────────────────

def _index_events_armed() -> None:
    from api.services import index_rebalance_calendar
    if not index_rebalance_calendar.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _iso(v: str, name: str) -> date:
    try:
        return date.fromisoformat(v)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{name} must be YYYY-MM-DD") from exc


@router.get("/api/calendar/index-events", dependencies=[Depends(_index_events_armed)])
def index_events_route(start: str = Query(..., min_length=10, max_length=10),
                       end: str = Query(..., min_length=10, max_length=10),
                       _user: dict = Depends(require_paid)):
    from api.services import index_rebalance_calendar as svc
    try:
        return svc.events(_iso(start, "start"), _iso(end, "end"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
