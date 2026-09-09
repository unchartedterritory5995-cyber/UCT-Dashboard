"""Phase 2a — `/api/hub/planned-trades`.

The joystick hub's plan-a-trade backend. Same auth dependency and the same per-user scoping
as the Journal 2.0 routers: every query is scoped by `user["id"]`, never by a client-supplied
id.

⭐ `r_value` GOES THROUGH `calculations.trade_pnl_dollar`, WITH THE STOP AS THE MODELLED
EXIT — not `abs(entry - stop) * size`. The arithmetic is not the point; the second authority
is. There is exactly one place in this app that knows how a trade's money is computed, and a
private copy here would drift the first time either moved. A planned trade has no exit, so the
stop IS the exit being modelled: P&L at the stop is exactly -1R, and 1R is its magnitude.

⛔ NO CLIENT IS WIRED TO THIS YET. Phase 2a ships the backend and its rails; the hub still
writes nothing (the preview is navigation-only plus Voice).
"""

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from api.middleware.auth_middleware import get_current_user
from api.services import hub_planned_trades as store

router = APIRouter(prefix="/api/hub/planned-trades", tags=["hub"])


class PlannedTradeCreate(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20)
    entry: float
    stop: float
    size: float = Field(..., ge=0)
    source_mode: Optional[str] = Field(None, max_length=40)


@router.post("")
def create_planned_trade(
    req: PlannedTradeCreate,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Create one planned trade for the signed-in user.

    ⛔ `stop != entry` IS A HARD ERROR, NOT A WARNING. At `stop == entry` the risk is zero,
    the side is undefined, and `r_value` would be null — a "plan" that cannot say what it
    risks is not a plan, and storing one would put a row in the table that every later
    consumer has to special-case.
    """
    symbol = req.symbol.strip().upper()
    if not symbol:
        raise HTTPException(status_code=422, detail="symbol must not be empty")
    if req.stop == req.entry:
        raise HTTPException(
            status_code=422,
            detail="stop must differ from entry (risk is undefined when they are equal)",
        )
    return store.create(
        user_id=user["id"],
        symbol=symbol,
        entry=req.entry,
        stop=req.stop,
        size=req.size,
        source_mode=req.source_mode,
    )


@router.get("")
def list_planned_trades(
    limit: int = Query(store.LIST_LIMIT, ge=1, le=store.LIST_LIMIT),
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """This user's planned trades, newest first. Discarded rows are included."""
    return {"planned_trades": store.list_for_user(user["id"], limit=limit)}


@router.post("/{trade_id}/discard")
def discard_planned_trade(
    trade_id: str,
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    """Mark one of this user's planned trades discarded.

    ⛔ 404 FOR SOMEBODY ELSE'S ROW, NOT 403. The scoping lives in the UPDATE's WHERE clause,
    so a row that belongs to another user and a row that does not exist are indistinguishable
    from outside — a 403 would confirm the id is real, which is an existence leak.
    """
    row = store.discard(user["id"], trade_id)
    if row is None:
        raise HTTPException(status_code=404, detail="planned trade not found")
    return row
