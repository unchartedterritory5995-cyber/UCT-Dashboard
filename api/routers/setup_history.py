"""SETH, the Terminal's "how setups acted": two read-only member routes (`api/services/setup_history.py`).

    GET /api/research/setup-history             a fixed library of seven chart setups and how each did
                                                in every S&P 500 correction, in the first 3 months after
                                                each low, later in each uptrend and on all days: signals,
                                                hit rate, average, median, worst and best return 5, 20 and
                                                60 sessions on, and the excess over the same day's stocks
    GET /api/research/setup-history/{ticker}    every time each setup fired on one stock over its held
                                                history, newest first, with how that setup did across the
                                                whole universe in the same phase

Paid, like the other research reads: 401 signed out, 402 not on a paid plan, 400 for a ticker that is not
a ticker. No feature flag and no new environment variable. THE ROUTES NEVER BUILD ON THE REQUEST: the
universe study is built once a week on a background thread (inside the quiet span) and held in memory
and on disk; the one-stock read is worked out on a background thread and held for the session. Until
then they answer `computing` (or `waiting`, outside the hours a build may start) and the panel asks again.

Plain `def`: memory, a lock and (once per process) one local file, so they run on the threadpool and
never on the event loop.

The paid gate is defined here, never imported from another router (the note in `api/routers/cot.py`).
`/api/research` is the prefix the `research` rate-limit family already covers (`api/rate_limit_policy.py`),
so the routes need no new family.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.ticker_resolver import require_route_symbol

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="How setups acted requires a paid plan")
    return user


@router.get("/api/research/setup-history")
def get_setup_history(user: dict = Depends(require_paid)):
    """How each setup of the library acted in every market phase (see `api/services/setup_history.py`)."""
    from api.services import setup_history
    return setup_history.get_study()


@router.get("/api/research/setup-history/{ticker}")
def get_setup_history_stock(ticker: str, user: dict = Depends(require_paid)):
    """Every signal of each setup on one stock, newest first, with the universe line for its phase."""
    from api.services import setup_history
    return setup_history.get_stock(require_route_symbol(ticker))
