"""Relative-volume "Volume Surge" scanner — the Charts live volume feed.

Thin HTTP layer; the stateful accumulation lives in `api/services/volume_live.py`.

⛔ EVERY ROUTE HERE IS PAID, AND `require_paid` IS DECLARED PER HANDLER — same
contract as `api/routers/nhnl.py`/`scans.py`. `/charts` is a paid surface and
`main.py` mounts routers with no router-level dependency, so a route that omits its
own gate is reachable by anyone. `tests/test_volume_scan_router.py` derives the
route set from `router.routes` and asserts every one is gated.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import ORJSONResponse as JSONResponse

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The scanner requires a paid plan")
    return user


@router.get("/api/volume-scan/live")
def volume_scan_live(
    _user: dict = Depends(require_paid),
    limit: int = Query(100, ge=1, le=300),
    min_price: float = Query(1.0, ge=0.0),
    max_price: float = Query(250.0, ge=0.0),
    min_liq: float = Query(100000.0, ge=0.0),
    min_rvol: float = Query(2.0, ge=0.0),
    min_move: float = Query(0.25, ge=0.0),
):
    """Ranked relative-volume surge leaderboard (highest sustained RVOL first).

    Each row is a stock whose CURRENT (last-minute) volume rate is elevated vs its
    own recent baseline AND which is actually moving in price. `min_rvol` is the
    surge gate, `min_move` the dark-pool / drift gate, `min_liq` the liquidity floor
    (prev-day volume), and `min_price`/`max_price` the tradable band.
    """
    from api.services import volume_live
    return JSONResponse(content=volume_live.get_live(
        limit=limit, min_price=min_price, max_price=max_price,
        min_liq=min_liq, min_rvol=min_rvol, min_move=min_move))


@router.get("/api/volume-scan/status")
def volume_scan_status(_user: dict = Depends(require_paid)):
    """Accumulator health (paid, like the feed it describes)."""
    from api.services import volume_live
    return volume_live.status()
