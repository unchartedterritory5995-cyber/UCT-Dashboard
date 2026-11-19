"""The member read behind the Terminal's dilution watch (`api/services/dilution_watch.py`).

  GET /api/research/dilution-watch/{ticker}    DILU: one company's share-issuance filings of the
                                               last three years, from its public SEC EDGAR filing
                                               index: shelf registrations and when they took
                                               effect, prospectus supplements, new registrations,
                                               unregistered sales, each with its link to sec.gov

Paid, like the other research reads: 401 signed out, 402 not on a paid plan. No feature flag.
THE ROUTE NEVER BUILDS ON THE REQUEST: the service answers what it holds, else waits a few seconds
on its one background build, else says `{"status": "computing"}` and the panel asks again. A
company the SEC lists no filer for is `{"status": "none"}`; an SEC that refuses the server is
`{"status": "unavailable"}`. Both are answers with a 200, never an error status.
Plain `def`: the service only reads memory and a lock.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The dilution watch requires a paid plan")
    return user


@router.get("/api/research/dilution-watch/{ticker}")
def get_dilution_watch(ticker: str, user: dict = Depends(require_paid)):
    """One company's filings that bear on selling new shares, for the last three years, classified
    from the SEC's filing index alone: which shelf registrations appear to be in force (an estimate
    from their dates), how many prospectus filings in the last 12 months and 3 years, and the
    timeline with a link to each filing. No filing document is read, so the answer carries no
    share counts and no dollar amounts."""
    from api.services import dilution_watch
    return dilution_watch.get_watch(ticker)
