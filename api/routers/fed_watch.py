"""FED, the Terminal's Fed watch: one read-only member route (`api/services/fed_watch.py`).

    GET /api/research/fed-watch     the latest FOMC statement and what changed since the one
                                    before, Fed speeches and testimony, live Fed headlines, the next
                                    meeting and the policy rate, the officials' own rate projections,
                                    and the New York Fed's survey of market professionals

Paid, like the other research reads: 401 signed out, 402 not on a paid plan. No feature flag and no
new environment variable. THE ROUTE NEVER FETCHES ON THE REQUEST: the service answers from what it
holds and, when something is due, starts its one background build (with nothing held yet it waits
a few seconds for it; a block still being read says `computing` and the panel asks again). A Board
or New York Fed website that refuses the server is a block whose state is `unavailable`, with a 200:
it is an answer about the source, not a failure of this server.

Plain `def`: the service reads memory, a lock, (once per process) one local file, the headline
store and the economics store, so it runs on the threadpool and never on the event loop.

The paid gate is defined here, never imported from another router (the note in
`api/routers/cot.py`). `/api/research` is the prefix the `research` rate-limit family already
covers (`api/rate_limit_policy.py`), so the route needs no new family.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Fed watch requires a paid plan")
    return user


@router.get("/api/research/fed-watch")
def get_fed_watch(user: dict = Depends(require_paid)):
    """The Fed watch: seven blocks (statement, speeches, headlines, calendar, rates, projections,
    survey), each with its own `state`, its source in words and its own as-of."""
    from api.services import fed_watch
    return fed_watch.get_fed_watch()
