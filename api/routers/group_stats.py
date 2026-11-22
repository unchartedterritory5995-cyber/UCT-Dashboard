"""Group fundamentals and breadth: one read-only member route (`api/services/group_stats.py`).

    GET /api/research/group-stats?kind=sector|industry            every sector (or industry): its median
                                                                  growth, margins and valuation from SEC
                                                                  filings, and its breadth from stored closes
    GET /api/research/group-stats?kind=sector|industry&name=...   one group in full: each median with its
                                                                  middle half, a year and three years ago, its
                                                                  rank among its peers, and its breadth now, a
                                                                  week and a month ago, with a year's line
    GET /api/research/group-stats?kind=...&part=positioning        (GRPS CROWDING, 2026-11-22) every group's
                                                                  short interest, insider buying and fund
                                                                  holdings, each part with its own as-of and
                                                                  coverage; with &name=... that group's members
                                                                  with their own figures

Paid, like the other research reads: 401 signed out, 402 not on a paid plan. No new feature flag and no new
environment variable; the fundamentals part answers `off` while FUNDAMENTALS_PIT_ENABLED is off, as the
point-in-time routes do. THE ROUTE NEVER BUILDS: the service answers from what it holds (memory, then disk);
the one build runs each evening from the scheduler, never on a request. Before the first build it says
`not_built`.

Plain `def`: the service reads memory, a lock and (once per process) one local file, so it runs on the
threadpool and never on the event loop.

The paid gate is defined here, never imported from another router (the note in `api/routers/cot.py`).
`/api/research` is the prefix the `research` rate-limit family already covers (`api/rate_limit_policy.py`),
so the route needs no new family.
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Group figures require a paid plan")
    return user


@router.get("/api/research/group-stats")
def get_group_stats(kind: str = Query("sector", pattern="^(sector|industry)$"),
                    name: Optional[str] = Query(None, min_length=1, max_length=80),
                    part: Optional[str] = Query(None, pattern="^positioning$"),
                    user: dict = Depends(require_paid)):
    """Every sector or industry (no `name`), or one in full: medians from SEC filings point in time, and
    breadth from stored daily closes. With `part=positioning` (GRPS CROWDING): each group's short interest,
    insider buying and fund holdings instead, and with `name` that group's members with their own figures."""
    from api.services import group_stats
    if part == "positioning":
        return group_stats.get_group_positioning(kind, name)
    return group_stats.get_group_stats(kind, name)
