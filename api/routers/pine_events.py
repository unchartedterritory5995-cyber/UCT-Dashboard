"""Track 4, unit E1 -- `GET /api/pine/events/{ticker}`: the chart's own symbol's earnings, dividends and splits,
as `api/services/pine_events.py` holds them, for the Pine event supply (E2).

* A plain `def`: it reads a file at most, so it runs on the threadpool, never on the event loop, and it never
  calls a vendor (a symbol with no copy answers 202 `pending` and a background refresh is kicked).
* Paid, like every member data read; and DARK by stage (`PINE_EVENTS_SUPPLY_ENABLED`): unset or `admins` answers
  admins only, `all` every paid member, `off` nobody. Any other caller gets 404, so a dark route is not an oracle.
* The paid gate is defined here, never imported from another router (the note in `api/routers/cot.py`).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import pine_events
from api.services.ticker_resolver import require_route_symbol

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Pine data requires a paid plan")
    return user


def _admitted(user: dict) -> bool:
    st = pine_events.stage()
    if st == "all":
        return True
    if st == "admins":
        return (user or {}).get("role") == "admin"
    return False


@router.get("/api/pine/events/{ticker}")
def get_pine_events(ticker: str, user: dict = Depends(require_paid)):
    if not _admitted(user):
        raise HTTPException(status_code=404, detail="Not Found")
    doc = pine_events.read(require_route_symbol(ticker))
    if doc.get("state") == "pending":
        return JSONResponse(status_code=202, content=doc, headers={"Retry-After": "5"})
    return doc
