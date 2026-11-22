"""VFP, the Terminal's volume footprint and gaps: one read-only member route
(`api/services/volume_footprint.py`).

    GET /api/research/volume-footprint/{ticker}    one stock's accumulation and distribution days and
                                                   up/down volume (25 and 50 sessions), its 10 biggest
                                                   volume days of the last year, its pocket pivots of
                                                   the last year, and every gap of 3% or more in the
                                                   history held with whether and when it filled

Paid, like the other research reads: 401 signed out, 402 not on a paid plan, 400 for anything that
is not a ticker. No feature flag and no new environment variable. It answers ONLY from prices and
volumes the server already stores and the earnings dates it already holds (never a vendor call),
holds each stock's answer for the session, and bounds how many stocks are worked out at once; a
stock with no stored prices answers 200 with `status: "not_held"` and a sentence.

Plain `def`: one local read of one stock, so it runs on the threadpool and never on the event loop.

The paid gate is defined here, never imported from another router (the note in
`api/routers/cot.py`). `/api/research` is the prefix the `research` rate-limit family already
covers (`api/rate_limit_policy.py`), so the route needs no new family.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.ticker_resolver import require_route_symbol

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The volume footprint requires a paid plan")
    return user


@router.get("/api/research/volume-footprint/{ticker}")
def get_volume_footprint(ticker: str, user: dict = Depends(require_paid)):
    """The volume footprint and gaps for one ticker (see `api/services/volume_footprint.py`)."""
    from api.services import volume_footprint
    return volume_footprint.get_volume_footprint(require_route_symbol(ticker))
