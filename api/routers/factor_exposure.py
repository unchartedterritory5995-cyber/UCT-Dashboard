"""FCTX, the Terminal's factor exposure: one read-only member route (`api/services/factor_exposure.py`).

    GET /api/research/factor-exposure/{ticker}    how one stock trades: its loadings (with t-statistics)
                                                  on the market, size, growth vs value, momentum,
                                                  quality and low volatility, over the last 252 common
                                                  sessions and the 252 before them, the change, each
                                                  factor's correlation, R-squared and the idiosyncratic
                                                  share, the largest variance inflation factor, a plain
                                                  one-line reading built only from loadings with a
                                                  t-statistic above 2, and the funds used

Paid, like the other research reads: 401 signed out, 402 not on a paid plan, 400 for anything that
is not a ticker. No feature flag and no new environment variable. It answers ONLY from prices the
server already stores (never a vendor call), holds each stock's answer for the session, reads the
factor funds once a session for every member, and bounds how many stocks are worked out at once; a
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
        raise HTTPException(status_code=402, detail="Factor exposure requires a paid plan")
    return user


@router.get("/api/research/factor-exposure/{ticker}")
def get_factor_exposure(ticker: str, user: dict = Depends(require_paid)):
    """The factor exposure of one ticker (see `api/services/factor_exposure.py`)."""
    from api.services import factor_exposure
    return factor_exposure.get_factor_exposure(require_route_symbol(ticker))
