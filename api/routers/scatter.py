"""Scatter / bubble widget — the Charts "Market Map" surface.

Thin HTTP layer over `api/services/scatter.py`. One point per stock; the client
picks a universe + an X / Y / Size metric and plots the returned per-ticker bundle.

⛔ EVERY ROUTE IS PAID, `require_paid` DECLARED PER HANDLER — same contract as the
NH-NL / Volume scanners. `/charts` is a paid surface and `main.py` mounts routers
with no router-level dependency, so a route that omits its own gate is reachable by
anyone. `tests/test_scatter_router.py` derives the route set from `router.routes`
and asserts every one is gated.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import ORJSONResponse as JSONResponse
from pydantic import BaseModel

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The Market Map requires a paid plan")
    return user


def _uid(user: dict):
    return (user or {}).get("id") or (user or {}).get("user_id")


@router.get("/api/scatter/metrics")
def scatter_metrics(_user: dict = Depends(require_paid)):
    """The axis-metric catalog (key, label, group, unit, live) for the X / Y / Size
    menus. Static, so the client can cache it."""
    from api.services import scatter
    return JSONResponse(content={"metrics": scatter.metric_catalog()})


@router.get("/api/scatter/universes")
def scatter_universes(user: dict = Depends(require_paid)):
    """The grouped universe menu — indices, the caller's own lists/tags, scanners,
    breadth sets, themes, whole market."""
    from api.services import scatter
    return JSONResponse(content={"groups": scatter.list_universes(_uid(user))})


@router.get("/api/scatter/data")
def scatter_data(
    user: dict = Depends(require_paid),
    source: str = Query("market", max_length=32),
    value: str | None = Query(None, max_length=120),
):
    """Resolve a universe → the full per-ticker metric bundle (daily metrics +
    a first live snapshot). The client polls `/live` for fast updates and re-calls
    this every ~minute to refresh membership + the slow metrics."""
    from api.services import scatter
    uid = _uid(user)
    tickers = scatter.resolve_universe(source, value, uid)
    payload = scatter.bundle(tickers)
    payload["source"] = source
    payload["value"] = value
    payload["label"] = scatter.label_for(source, value, uid)
    return JSONResponse(content=payload)


class _LiveReq(BaseModel):
    tickers: list[str] = []


@router.post("/api/scatter/live")
def scatter_live(req: _LiveReq, _user: dict = Depends(require_paid)):
    """Fast-poll live overlay for a known ticker set: `{sym: {chg_today, gap,
    from_open, price, range_pos, vol_today, dvol_today, dir}}`. The client recomputes
    RVOL from `vol_today` ÷ the avg volume it already holds from `/data`."""
    from api.services import scatter
    tickers = [t for t in (req.tickers or []) if t][: scatter._MAX_TICKERS]
    points = scatter.live_overlay(tickers)
    return JSONResponse(content={"asof": scatter._snap_cache.get("at") or None,
                                 "points": points})
