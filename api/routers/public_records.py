"""PUBR, the Terminal's public records for one company: one read-only member route
(`api/services/public_records.py`).

    GET /api/research/public-records/{ticker}
        the company's federal contract awards (USAspending.gov), its clinical trials (ClinicalTrials.gov),
        its FDA drug approvals (openFDA, Drugs@FDA) and its lobbying (LDA.gov), each with its source, its
        as-of and the names in the agency's records that were matched to the ticker

Paid, like the other research reads: 401 signed out, 402 not on a paid plan, a string that is not a
ticker 400, and none of them reaches the service. No feature flag and no new environment variable. THE
ROUTE NEVER ASKS AN AGENCY ON THE REQUEST: the service answers from what it holds and, for a company it
does not hold yet (or a day after it last read it), starts its background builds; with nothing held it
waits a few seconds, then says `computing` per section and the panel asks again.

Plain `def`: the service reads memory and locks, so it runs on the threadpool and never on the event loop.
The paid gate is defined here, never imported from another router (the note in `api/routers/cot.py`).
`/api/research` is the prefix the `research` rate-limit family already covers, so no new family.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.ticker_resolver import require_route_symbol

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Public records require a paid plan")
    return user


@router.get("/api/research/public-records/{ticker}")
def get_public_records(ticker: str, user: dict = Depends(require_paid)):
    """One company's government contracts, clinical trials, FDA approvals and lobbying."""
    from api.services import public_records
    return public_records.get_public_records(require_route_symbol(ticker))
