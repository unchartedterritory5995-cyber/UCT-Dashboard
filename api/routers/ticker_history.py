"""TERM-049 — GET /api/research/history/{sym}: one ticker's timeline (see api/services/ticker_history.py).

DARK behind TICKER_HISTORY_ENABLED: unset, the route answers FastAPI's 404 body before any
identity is read — the same answer as a route that does not exist (the TERM-088 pattern).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import ticker_history

router = APIRouter()


def _armed() -> None:
    if not ticker_history.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the ticker history. Defined HERE, never imported from a sibling —
    each router owns its own 402 sentence (tests/test_user_definitions_auth.py)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Ticker history requires a paid plan")
    return user


@router.get("/api/research/history/{sym}", dependencies=[Depends(_armed)])
def research_history(sym: str, days: int = Query(ticker_history.DEFAULT_DAYS, ge=1, le=ticker_history.MAX_DAYS),
                     _user: dict = Depends(require_paid)):
    return ticker_history.history(sym, days=days)
