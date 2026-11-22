"""MKTH, the Terminal's market history: one read-only member route (`api/services/market_history.py`).

    GET /api/research/market-history    every correction (10% to 20%) and bear market (20% or more)
                                        of the S&P 500 and the Nasdaq-100 on closing prices, the
                                        index return 1, 3, 6 and 12 months after each low, and the
                                        25 stocks that rose most in the 63 sessions after each low,
                                        with each sector's median

Paid, like the other research reads: 401 signed out, 402 not on a paid plan. No feature flag and no
new environment variable. THE ROUTE NEVER BUILDS ON THE REQUEST: the service answers from what it
holds (in memory and on disk) and, when a rebuild is due (once each evening), starts its one
background build; with nothing held yet it waits a few seconds for the build's first stage and
otherwise says `computing`, and the panel asks again.

Plain `def`: the service reads memory, a lock and (once per process) one local file, so it runs on
the threadpool and never on the event loop.

The paid gate is defined here, never imported from another router (the note in
`api/routers/cot.py`). `/api/research` is the prefix the `research` rate-limit family already
covers (`api/rate_limit_policy.py`), so the route needs no new family.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Market history requires a paid plan")
    return user


@router.get("/api/research/market-history")
def get_market_history(user: dict = Depends(require_paid)):
    """Market history: per index, every decline of 10% or more with its peak, trough, depth, sessions
    down, regain date and sessions to recover, the rally after the low, and the rally's leaders."""
    from api.services import market_history
    return market_history.get_market_history()
