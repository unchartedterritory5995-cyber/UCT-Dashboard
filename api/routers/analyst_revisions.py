"""TERM-073 -- `GET /api/research/analyst-revisions/{ticker}`.

The member door onto the nightly analyst pass's retained timeline
(`api/services/research/analyst_revisions.py`).

⛔ DARK behind `ANALYST_REVISIONS_ENABLED` (read per request, unset = OFF).
Unset, the route answers the FastAPI 404 body to every caller before any
identity is read. `_armed` is the first dependency on purpose.

⛔ PAID. `require_paid` is defined HERE with its own 402 sentence
(`tests/test_user_definitions_auth.py` fails on a shared import).

Rails: `tests/test_analyst_revisions_member.py`.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Path

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.ticker_resolver import ticker_shape
from api.services.research import analyst_revisions

router = APIRouter(prefix="/api/research", tags=["analyst-revisions"])


def _armed() -> None:
    if not analyst_revisions.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the analyst revision history."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402,
                            detail="The analyst revision history requires a paid plan")
    return user


@router.get("/analyst-revisions/{ticker}", dependencies=[Depends(_armed)])
def analyst_revision_history(
    ticker: str = Depends(ticker_shape),
    _user: dict = Depends(require_paid),
):
    """`{ticker, status, window, observations, revisions, fields, source,
    contributors, contributors_note}` -- `status` is `no_history` |
    `no_revision` | `revised`."""
    if not analyst_revisions.normalize_ticker(ticker):
        raise HTTPException(status_code=422, detail="ticker is blank")
    return analyst_revisions.revision_history(ticker)
