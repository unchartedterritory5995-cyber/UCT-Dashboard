"""Track 4, unit B1 -- `GET /api/pine/breadth/{spelling}`: UCT breadth under a TradingView `USI:` spelling, as
`api/services/pine_breadth.py` holds it, for the breadth supply (B2). Labelled UCT breadth on every answer.

* A plain `def`: it reads a file at most, never the breadth database (a spelling with no copy answers 202 `pending`
  and a background refresh is kicked).
* Paid; DARK by stage (`PINE_BREADTH_SUPPLY_ENABLED`): unset or `admins` answers admins only, `all` paid members,
  `off` nobody. Any other caller gets 404.
* A member is refused by the Pine data catalog's own licence sentence while `uct_breadth` is not servable (ESC-03);
  an admin reads the values to grade them against the capture.
* The paid gate is defined here, never imported from another router (the note in `api/routers/cot.py`).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import pine_breadth

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Pine breadth data requires a paid plan")
    return user


@router.get("/api/pine/breadth/{spelling}")
def get_pine_breadth(spelling: str, user: dict = Depends(require_paid)):
    st = pine_breadth.stage()
    admin = (user or {}).get("role") == "admin"
    if not (st == "all" or (st == "admins" and admin)):
        raise HTTPException(status_code=404, detail="Not Found")
    if len(spelling or "") > 24:
        raise HTTPException(status_code=400, detail="Not a breadth spelling")
    if not admin:
        refused = pine_breadth.licence_refusal()
        if refused:
            return {"schema": pine_breadth.SCHEMA, "spelling": spelling.upper(), "state": "refused",
                    "refusal": refused}
    doc = pine_breadth.read(spelling)
    if doc.get("state") == "pending":
        return JSONResponse(status_code=202, content=doc, headers={"Retry-After": "5"})
    return doc
