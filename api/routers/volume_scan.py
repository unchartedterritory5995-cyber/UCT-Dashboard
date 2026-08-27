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
        raise HTTPException(status_code=402,
                            detail="The Volume Surge scanner requires a paid plan")
    return user


@router.get("/api/volume-scan/live")
def volume_scan_live(
    _user: dict = Depends(require_paid),
    limit: int = Query(100, ge=1, le=300),
    min_price: float = Query(1.0, ge=0.0),
    max_price: float = Query(20000.0, ge=0.0),
    min_liq: float = Query(100000.0, ge=0.0),
    min_rvol: float = Query(2.0, ge=0.0),
    min_move: float = Query(0.25, ge=0.0),
    min_dollar: float | None = Query(None, ge=0.0),
    min_burst: float = Query(3.0, ge=0.0),
    syms: str | None = Query(None, description="CSV of a user's own list — scan ONLY these"),
    show_all: bool = Query(False),
):
    """Relative-volume leaderboard.

    Two surge signals per row: cumulative time-of-day RVOL (heavy all day) and BURST
    RVOL (igniting now — recent volume rate vs the rate typically traded at this time
    of day). A name lights when EITHER clears its gate, so a fast mover surfaces before
    cumulative RVOL catches up. `min_rvol` is the cumulative surge gate, `min_burst`
    the ignition gate, `min_move` the dark-pool / drift gate, `min_liq` the liquidity
    floor (prev-day volume), `min_price`/`max_price` the tradable band, and `min_dollar`
    the now-window dollar-volume floor that drops illiquid "50× of nothing" prints
    (session-aware default). The colour tier is the hotter of the two signals.

    `show_all=true` returns the WHOLE tradable top-N universe ranked by surge, each
    row flagged `lit` when it meets the criteria (the UI colours only the lit ones);
    `show_all=false` returns only the names meeting the criteria, ranked by surge.
    """
    from api.services import volume_live
    sym_list = [s for s in (syms or "").split(",") if s.strip()][:500] or None
    return JSONResponse(content=volume_live.get_live(
        limit=limit, min_price=min_price, max_price=max_price,
        min_liq=min_liq, min_rvol=min_rvol, min_move=min_move,
        min_dollar=min_dollar, min_burst=min_burst, syms=sym_list, show_all=show_all))


@router.get("/api/volume-scan/status")
def volume_scan_status(_user: dict = Depends(require_paid)):
    """Accumulator health (paid, like the feed it describes)."""
    from api.services import volume_live
    return volume_live.status()
