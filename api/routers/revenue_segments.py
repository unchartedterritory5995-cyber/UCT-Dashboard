"""SEG, the Terminal's revenue by segment: one read-only member route (`api/services/revenue_segments.py`).

    GET /api/research/revenue-segments/{ticker}?period=annual|quarter
        one stock's revenue by product and by region, period by period, each segment's share worked
        out by the server

Paid, like the other research reads: 401 signed out, 402 not on a paid plan; a string that is not a
ticker is 400 and a period other than `annual` or `quarter` is 400, and neither reaches the service. No
feature flag and no new environment variable. THE ROUTE NEVER ASKS THE VENDOR ON THE REQUEST: the service
answers from what it holds and, when nothing is held or a refresh is due, starts its one background build
(with nothing held it waits a few seconds, then says `computing` and the panel asks again). A plan that
does not include an endpoint is a 200 whose leg says `not_in_plan`: an answer about the source.

Plain `def`: the service reads memory and a lock, so it runs on the threadpool and never on the event loop.
The paid gate is defined here, never imported from another router (the note in `api/routers/cot.py`).
`/api/research` is the prefix the `research` rate-limit family already covers, so no new family.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.ticker_resolver import require_route_symbol

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Revenue by segment requires a paid plan")
    return user


@router.get("/api/research/revenue-segments/{ticker}")
def get_revenue_segments(ticker: str, period: str = "annual", user: dict = Depends(require_paid)):
    """One stock's revenue by product and by region (`period`: annual or quarter)."""
    from api.services import revenue_segments
    p = (period or "").strip().lower()
    if p not in revenue_segments.PERIODS:
        raise HTTPException(status_code=400, detail="period must be annual or quarter")
    return revenue_segments.get_segments(require_route_symbol(ticker), p)
