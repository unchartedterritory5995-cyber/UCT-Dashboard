"""IDXC, the Terminal's index changes: one read-only member route (`api/services/index_changes.py`).

    GET /api/research/index-changes?index=all|sp500|nasdaq100|dow   additions and removals, newest first
    GET /api/research/index-changes?sym=NVDA                        one stock's own index history

Paid, like the other research reads: 401 signed out, 402 not on a paid plan; an `index` that is not one of
the four is 400 and a `sym` that is not a ticker is 400; none of them reaches the service. No feature flag
and no new environment variable. THE ROUTE NEVER ASKS THE PROVIDER ON THE REQUEST: the service answers from
the three lists it holds and, when nothing is held or a refresh is due, starts its one background build
(with nothing held it waits a few seconds, then says `computing` and the panel asks again). One stock's
history is read out of the held lists.

Plain `def`: the service reads memory and a lock, so it runs on the threadpool. The paid gate is defined
here, never imported from another router (the note in `api/routers/cot.py`). `/api/research` is the prefix
the `research` rate-limit family already covers.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services.ticker_resolver import require_route_symbol

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Index changes require a paid plan")
    return user


@router.get("/api/research/index-changes")
def get_index_changes(index: str = "all", sym: Optional[str] = None, user: dict = Depends(require_paid)):
    """Index additions and removals (`index`), or one stock's own (`sym`)."""
    from api.services import index_changes
    idx = (index or "").strip().lower()
    if idx != "all" and idx not in index_changes.INDEXES:
        raise HTTPException(status_code=400, detail="index must be all, sp500, nasdaq100 or dow")
    s = require_route_symbol(sym) if sym is not None and sym.strip() else None
    return index_changes.get_changes(idx, s)
