"""MNA, the Terminal's mergers and acquisitions: one read-only member route (`api/services/mergers.py`).

    GET /api/research/mergers            the latest announced deals across the market
    GET /api/research/mergers?sym=NVDA   the deals that name one company

Paid, like the other research reads: 401 signed out, 402 not on a paid plan; a `sym` that is not a ticker is
400; none of them reaches the service. No feature flag and no new environment variable. THE ROUTE NEVER ASKS
THE PROVIDER ON THE REQUEST: the service answers from what it holds and, when nothing is held or a refresh is
due, starts its one background build (with nothing held it waits a few seconds, then says `computing` and the
panel asks again). A provider that refuses the site's plan is a 200 whose status is `unavailable`: an answer
about the source.

Plain `def`: the service reads memory, a lock and (once per process) one local file, so it runs on the
threadpool. The paid gate is defined here, never imported from another router (the note in
`api/routers/cot.py`). `/api/research` is the prefix the `research` rate-limit family already covers.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.ticker_resolver import require_route_symbol

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Mergers and acquisitions require a paid plan")
    return user


@router.get("/api/research/mergers")
def get_mergers(sym: Optional[str] = None, user: dict = Depends(require_paid)):
    """The latest deals, or (`sym`) the deals that name one company."""
    from api.services import mergers
    if sym is None or not sym.strip():
        return mergers.get_latest()
    return mergers.get_company(require_route_symbol(sym))
