"""Research depth (lane gaps-research): the Research > Depth panels.

One router, one dark flag PER SURFACE. Each surface's flag is read per request
by its own service module's `is_enabled()`; unset, that surface's routes answer
FastAPI's 404 before identity is read, exactly like seasonality and COV-04.

  FILING_SEARCH_ENABLED            GET /api/research/filing-search            FT-058/059/060
  EARNINGS_REACTION_PANEL_ENABLED  GET /api/research/earnings-reaction/{sym}  FT-005

Every handler is a plain `def`: each one reads local SQLite stores, which is
blocking I/O, and an `async def` that awaits nothing would run it ON the event
loop (tests/test_async_routes_do_not_block.py). No handler calls a vendor; a
miss is queued on the owning service's own worker and answered as pending.
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user

router = APIRouter()
_SYM_RE = re.compile(r"^[A-Z0-9.\-]{1,12}$")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for the Depth panels. Defined HERE (each router owns its own 402 sentence)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="Research depth panels require a paid plan")
    return user


def _sym(sym: Optional[str]) -> Optional[str]:
    if sym is None:
        return None
    s = sym.upper().strip()
    if not s:
        return None
    if not _SYM_RE.match(s):
        raise HTTPException(status_code=400, detail="Not a ticker")
    return s


# ── FT-058/059/060 filing search ────────────────────────────────────────────

def _filing_search_armed() -> None:
    from api.services import filing_search
    if not filing_search.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/research/filing-search", dependencies=[Depends(_filing_search_armed)])
def filing_search_route(q: str = Query(..., min_length=1, max_length=400),
                        sym: Optional[str] = Query(default=None),
                        form: Optional[str] = Query(default=None),
                        section: Optional[str] = Query(default=None),
                        limit: int = Query(default=40, ge=1, le=200),
                        _user: dict = Depends(require_paid)):
    from api.services import filing_search as svc
    try:
        return svc.search(q, sym=_sym(sym), form=form, section=section, limit=limit)
    except svc.QueryError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# ── FT-005 earnings-reaction panel ──────────────────────────────────────────

def _earnings_reaction_armed() -> None:
    from api.services import earnings_reaction_panel
    if not earnings_reaction_panel.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


@router.get("/api/research/earnings-reaction/{sym}", dependencies=[Depends(_earnings_reaction_armed)])
def earnings_reaction_route(sym: str, _user: dict = Depends(require_paid)):
    from api.services import earnings_reaction_panel as svc
    return svc.panel(_sym(sym))
