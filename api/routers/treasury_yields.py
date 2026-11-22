"""The member read behind the Terminal's Treasury yields screen (`api/services/treasury_yields.py`).

  GET /api/research/treasury-yields     RATES: the daily Treasury yield at each maturity with its
                                        changes in basis points, the 10-year minus 2-year and
                                        10-year minus 3-month spreads, and five years of daily
                                        history for the small pictures; plus the real yield
                                        curve (TIPS) and the breakevens, as their own block

Paid, like the other research reads: 401 signed out, 402 not on a paid plan. No feature flag and
no new environment variable.
THE ROUTE NEVER BUILDS ON THE REQUEST: the service answers what it holds, else waits a few seconds
on its one background build, else says `{"status": "computing"}` and the panel asks again. The
figures come from the US Treasury's own published daily par yield curve (no vendor, no key). A
Treasury website that refuses the server's request is `{"status": "unavailable"}` with a 200,
never an error status: it is an answer about the source, not a failure of this server.
Plain `def`: the service only reads memory, a lock and (once per process) one local file.

Why `/api/research`: the route is a cached read of an outside source with its own paid gate,
which is what the `research` rate-limit family (`api/rate_limit_policy.py`) already covers at
that prefix, so it needs no new family and no edit to the policy table. `/api/econ` is the
owner-held economic data feature's own prefix (dark behind `ECON_ENABLED`) and this route is not
part of it.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Treasury yields require a paid plan")
    return user


@router.get("/api/research/treasury-yields")
def get_treasury_yields(user: dict = Depends(require_paid)):
    """US Treasury yields at each maturity from 1 month to 30 years: the newest end-of-day figure,
    its change over 1 day, 1 week, 1 month, 3 months and 1 year in basis points, the 10-year
    minus 2-year and 10-year minus 3-month spreads (with whether each is inverted and for how many
    trading days), and five years of daily history for the 2-year, 10-year, 30-year and both
    spreads. Every `ok` answer carries the date of the newest figure and when the site read it.

    An `ok` answer also carries `real`: the Treasury's daily par REAL yield curve (TIPS, 5 to 30
    years) and the breakeven at each of those maturities (nominal minus real, computed by the
    server), as its own block with its own status, dates and source
    (`api/services/treasury_real_yields.py`). That block is never waited for and is only asked for
    once the nominal answer is held, so it cannot delay or replace the yields above.
    """
    from api.services import treasury_real_yields, treasury_yields
    answer = treasury_yields.get_yields()
    if isinstance(answer, dict) and answer.get("status") == "ok":
        answer = {**answer, "real": treasury_real_yields.get_real(wait_s=0)}
    return answer
