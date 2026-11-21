"""CACT, the Terminal's corporate actions panel: one read-only route.

    GET /api/research/corporate-actions/{ticker}

It answers only from what this server already holds for the stock
(`api/services/corporate_actions_held.py`): no vendor call on the request, no build started,
bounded rows. A stock nothing is held for answers 200 with `status: "not_held"` and a sentence.
A handler that reads a file is a plain `def`, so it runs on the threadpool and never on the
event loop.

The paid gate is defined here, never imported from another router (the note in
`api/routers/cot.py`): a gate borrowed from a router that later changes its own rule would
change this one silently.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import corporate_actions_held
from api.services.ticker_resolver import require_route_symbol

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Corporate actions require a paid plan")
    return user


@router.get("/api/research/corporate-actions/{ticker}")
def get_corporate_actions(ticker: str, user: dict = Depends(require_paid)):
    return corporate_actions_held.held_actions(require_route_symbol(ticker))
