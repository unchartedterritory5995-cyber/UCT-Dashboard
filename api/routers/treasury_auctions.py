"""The member read behind the Terminal's Treasury auctions screen (`api/services/treasury_auctions.py`).

  GET /api/research/treasury-auctions   AUCT: the Treasury auctions coming up (security, auction
                                        day, issue day, amount offered) and the results of the
                                        recent ones (high yield or rate, bid-to-cover, the award
                                        by bidder class)

Paid, like the other research reads: 401 signed out, 402 not on a paid plan. No feature flag and
no new environment variable.
THE ROUTE NEVER BUILDS ON THE REQUEST: the service answers what it holds, else waits a few seconds
on its one background build, else says `{"status": "computing"}` and the panel asks again. The
figures are the US Treasury's own, from its Fiscal Data service (no vendor, no key). A publisher
that refuses the server's request is `{"status": "unavailable"}` with a 200, never an error status:
it is an answer about the source, not a failure of this server.
Plain `def`: the service only reads memory, a lock and (once per process) one local file.

`/api/research` is the prefix the `research` rate-limit family (`api/rate_limit_policy.py`) already
covers, so the route needs no new family and no edit to the policy table.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Treasury auctions require a paid plan")
    return user


@router.get("/api/research/treasury-auctions")
def get_treasury_auctions(user: dict = Depends(require_paid)):
    """US Treasury auctions: the ones coming up (security type and term, auction date, issue date,
    amount offered) and the results of the last six weeks (the high yield, rate or discount
    margin, the bid-to-cover ratio, and the competitive award split between primary dealers,
    direct bidders and indirect bidders, with each one's share). Every `ok` answer carries the
    date of the newest record read and when the site read it.
    """
    from api.services import treasury_auctions
    return treasury_auctions.get_auctions()
