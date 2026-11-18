"""The member reads behind the Terminal's short interest screens (`api/services/short_data.py`).

  GET /api/research/short-data/{ticker}        SHINT: one stock's short interest history, its
                                               daily short volume and its percent of float
  GET /api/research/short-interest-list        SHRTS: the newest report's short interest across
                                               the site's universe, ranked (`rank`, `limit`)

Paid, like the other research reads: 401 signed out, 402 not on a paid plan. No feature flag.
NEITHER ROUTE BUILDS ON THE REQUEST: the service answers what it holds, else waits a few seconds
on its one background build, else says `{"status": "computing"}` and the panel asks again. A
vendor that refuses the key is `{"status": "unavailable"}` with a 200, never an error status: it
is an answer about the data plan, not a failure of this server.
Plain `def`: the service only reads memory, a lock and (once per process) one local file.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Short interest requires a paid plan")
    return user


@router.get("/api/research/short-interest-list")
def get_short_interest_list(rank: str | None = Query(None), limit: int | None = Query(None, ge=1, le=250),
                            user: dict = Depends(require_paid)):
    """The newest FINRA short interest report across the site's stock universe, ranked.

    `rank`: `dtc` (days to cover, the default), `up` (biggest percent increase since the previous
    report), `down` (biggest percent decrease) or `float` (percent of float). `limit`: rows
    returned, 100 unless asked, 250 at most; `ranked` is how many stocks the rank covers and `cut`
    says the answer is only the first `limit` of them. Every `ok` answer carries the settlement
    date, the previous one, when the site read the report and how many stocks it holds.
    """
    from api.services import short_data
    return short_data.get_market(rank, limit)


@router.get("/api/research/short-data/{ticker}")
def get_short_data(ticker: str, user: dict = Depends(require_paid)):
    """One stock's FINRA short interest history (each report with its change from the one before)
    and its daily off-exchange short volume for the last 60 trading days. Each of the two carries
    its own state, so one can be shown when the other is unavailable."""
    from api.services import short_data
    return short_data.get_stock(ticker)
