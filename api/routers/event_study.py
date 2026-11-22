"""EVST, "What happened next": a member's own historical event study (`api/services/event_study_member.py`).

    GET /api/research/event-study/series    the series a member can pick, grouped by category, from the
                                            study adapters' own static metadata (labels, units, period
                                            bounds; never a data value), the windows, the defaults, the
                                            ready-made examples and the kinds not offered with why
    GET /api/research/event-study           one study: every time the condition held on the series,
                                            what the symbol did over each window, against every session

Paid, like the other research reads: 401 signed out, 402 not on a paid plan. A spec the study cannot
take answers 422 with ONE plain sentence in `detail` (never a validation dump). No feature flag and
no new environment variable.

THE ROUTE NEVER COMPUTES ON THE REQUEST: the service answers the study held for that spec and evening,
else waits a few seconds on the one background build it started, else says `computing` (or `busy`
when the study queue is full) and the panel asks again. Answers come from stored data only (UCT's
daily closes, the finalized breadth series, the local COT store); never a vendor call.

⛔ LOCAL ONLY: the answer is the member's, shown in their panel; never sent to a model.

GET, not POST: a study reads and changes nothing, so its spec rides in the query string, the panel's
shared read (`useMarketRead`) keys on the URL, and the answer is held server-side per spec.

Plain `def`: the service reads memory and a lock (the study itself runs on its own background thread),
so the handler runs on the threadpool and never on the event loop.

The paid gate is defined here, never imported from another router (the note in `api/routers/cot.py`).
The rate-limit family is `research-studies` (`api/rate_limit_policy.py`), tighter than the `research`
reads it sits under, because a study is heavier than a read.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Historical studies require a paid plan")
    return user


@router.get("/api/research/event-study/series")
def get_event_study_series(user: dict = Depends(require_paid)):
    """The study menu: categories of series, the windows, the defaults and the ready-made examples."""
    from api.services import event_study_member
    return event_study_member.catalog()


@router.get("/api/research/event-study")
def get_event_study(kind: str = "", universe: str = "", metric: str = "", series: str = "", indicator: str = "",
                    period: str = "", market: str = "", group: str = "", op: str = "", threshold: str = "",
                    symbol: str = "", horizons: str = "", episodes: str = "first", entry: str = "event_close",
                    user: dict = Depends(require_paid)):
    """One study (see `api/services/event_study_member.py`). Every parameter is read as text and judged by
    the service, so a bad one is a plain 422 sentence."""
    from api.services import event_study_member
    study, why = event_study_member.parse({
        "kind": kind, "universe": universe, "metric": metric, "series": series, "indicator": indicator,
        "period": period, "market": market, "group": group, "op": op, "threshold": threshold, "symbol": symbol,
        "horizons": horizons, "episodes": episodes, "entry": entry,
    })
    if why:
        raise HTTPException(status_code=422, detail=why)
    return event_study_member.get_study(study)
