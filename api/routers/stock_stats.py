"""STAT, the Terminal's stock statistics: one read-only member route (`api/services/stock_stats.py`).

    GET /api/research/stock-stats/{ticker}    one stock's volatility and range, beta and correlation
                                              (SPY and its sector fund), returns, its own drawdowns
                                              of 20% or more, and how it acted in every S&P 500
                                              correction and bear market

Paid, like the other research reads: 401 signed out, 402 not on a paid plan, 400 for anything that
is not a ticker. No feature flag and no new environment variable. It answers ONLY from prices the
server already stores (never a vendor call), holds each stock's answer for the session, and bounds
how many stocks are worked out at once; a stock with no stored prices answers 200 with
`status: "not_held"` and a sentence.

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
        raise HTTPException(status_code=402, detail="Stock statistics require a paid plan")
    return user


@router.get("/api/research/stock-stats/{ticker}")
def get_stock_stats(ticker: str, user: dict = Depends(require_paid)):
    """Stock statistics for one ticker (see `api/services/stock_stats.py`). A held answer is sent as the bytes made for
    it on its build thread (`held_bytes`, speed pass 3): the same bytes, never re-made on the event loop."""
    from api.services import held_bytes, stock_stats
    return held_bytes.response(stock_stats.get_stock_stats(require_route_symbol(ticker)))
