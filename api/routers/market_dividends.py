"""DVD MARKET, the Terminal's market-wide dividend and split calendar: one read-only member route
(`api/services/dividends_market.py`).

    GET /api/research/market-dividends   every ex-dividend date in this week and next, and every split
                                         taking effect in the same days, for the stocks the site follows

Paid, like the other research reads: 401 signed out, 402 not on a paid plan. No feature flag and no
new environment variable. THE ROUTE NEVER ASKS THE VENDOR ON THE REQUEST: the service answers from
what it holds and, when a refresh is due, starts its one background build (with nothing held yet it
waits a few seconds for it, then says `computing` and the panel asks again).

Plain `def`: the service reads memory, a lock and (once per process) one local file, so it runs on the
threadpool and never on the event loop.

The paid gate is defined here, never imported from another router (the note in `api/routers/cot.py`).
`/api/research` is the prefix the `research` rate-limit family already covers
(`api/rate_limit_policy.py`), so the route needs no new family.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The market dividend calendar requires a paid plan")
    return user


@router.get("/api/research/market-dividends")
def get_market_dividends(user: dict = Depends(require_paid)):
    """This week's and next week's ex-dividend dates and splits for the stocks the site follows."""
    from api.services import dividends_market
    return dividends_market.get_market_dividends()
