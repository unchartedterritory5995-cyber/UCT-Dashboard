"""New-High / New-Low intraday scanner — the Charts "Situational Awareness" feed.

Thin HTTP layer; the stateful accumulation lives in `api/services/nhnl_live.py`.

⛔ EVERY ROUTE HERE IS PAID, AND `require_paid` IS DECLARED PER HANDLER — the same
contract as `api/routers/scans.py`. This serves the firm's live whole-market
new-HOD/new-LOD stream; `/charts` is a paid surface (`FREE_PAGES = ['/morning-wire']`)
and `main.py` mounts routers with no router-level dependency, so a route that omits
its own gate is reachable by anyone. `tests/test_nhnl_router.py` derives the route
set from `router.routes` and asserts every one is gated — a hand-listed test would
leave the next route uncovered the day someone adds it.
"""
from fastapi import APIRouter, Depends, Query
from fastapi.responses import ORJSONResponse as JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from fastapi import HTTPException

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The scanner requires a paid plan")
    return user


@router.get("/api/nhnl/live")
def nhnl_live(
    _user: dict = Depends(require_paid),
    limit: int = Query(100, ge=1, le=600),
    min_price: float = Query(0.0, ge=0.0),
    min_count: int = Query(1, ge=1),
):
    """Live New-Highs / New-Lows event streams (newest first).

    Each side is a rolling log of fresh high-of-day (or low-of-day) prints; the
    same symbol repeats as its running `count` climbs. `min_count` raises the bar
    to only persistent, one-directional names; `min_price` hides cheap stock.
    """
    from api.services import nhnl_live
    return JSONResponse(content=nhnl_live.get_live(
        limit=limit, min_price=min_price, min_count=min_count))


@router.get("/api/nhnl/status")
def nhnl_status(_user: dict = Depends(require_paid)):
    """Accumulator health (paid, like the feed it describes)."""
    from api.services import nhnl_live
    return nhnl_live.status()
