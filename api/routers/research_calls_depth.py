"""Research depth, calls (Lane R): D-5 tape + transcript replay.

  CALL_REPLAY_ENABLED   GET /api/research/call-replay/{sym}   D-5

Dark per surface: unset, the route answers FastAPI's 404 before identity is
read (the research_depth pattern). The handler is a plain `def`: it reads
cached vendor payloads through clients that carry their own timeouts, which is
blocking I/O, and an `async def` would run it ON the event loop
(tests/test_async_routes_do_not_block.py).

D-4 (transcript chapters + the recap's review label) adds no route: it rides
the existing transcript and call-recap payloads, see
api/services/transcript_chapters.py.
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()
_SYM_RE = re.compile(r"^[A-Z0-9.\-]{1,12}$")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate, defined HERE (each router owns its own 402 sentence)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Call replay requires a paid plan")
    return user


def _call_replay_armed() -> None:
    from api.services import call_replay
    if not call_replay.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/research/call-replay/{sym}", dependencies=[Depends(_call_replay_armed)])
def call_replay_route(sym: str,
                      year: Optional[int] = Query(default=None, ge=2000, le=2100),
                      quarter: Optional[int] = Query(default=None, ge=1, le=4),
                      _user: dict = Depends(require_paid)):
    s = (sym or "").upper().strip()
    if not _SYM_RE.match(s):
        raise HTTPException(status_code=400, detail="Not a ticker")
    if (year is None) != (quarter is None):
        raise HTTPException(status_code=400, detail="Give both year and quarter, or neither")
    from api.services import call_replay as svc
    return svc.replay(s, year=year, quarter=quarter)
