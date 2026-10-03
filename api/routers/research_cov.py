"""COV-05 / COV-07 / COV-09 -- three Research tabs (roadmap RM-L19), each DARK
behind its own flag: unset, its routes answer FastAPI's 404 before identity is read.

  RESEARCH_PEOPLE_ENABLED   GET /api/research/people/{sym}            api.services.research_people
  ESTIMATE_HISTORY_ENABLED  GET /api/research/estimate-history/{sym}  api.services.estimate_history
  FILINGS_FEED_ENABLED      GET /api/research/filings-feed/{sym}      api.services.filings_feed
                            GET /api/research/filings-feed            (market-wide)

Every handler is a plain `def`: People reads FMP (cached) and estimate history
reads SQLite, both blocking, and an `async def` that awaits nothing would run
that ON the event loop (tests/test_async_routes_do_not_block.py). Estimate
history and the filings feed make no vendor call on a request at all.
"""
from __future__ import annotations

import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import get_current_user_with_plan, is_paid_user
from api.services import estimate_history, filings_feed, research_people

router = APIRouter()
_SYM_RE = re.compile(r"^[A-Z0-9.\-]{1,12}$")
_FORM_RE = re.compile(r"^[A-Z0-9 \-/]{1,16}$")


def _people_armed() -> None:
    if not research_people.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _estimates_armed() -> None:
    if not estimate_history.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def _feed_armed() -> None:
    if not filings_feed.is_enabled():
        raise HTTPException(status_code=404, detail="Not Found")


def require_paid(user: dict = Depends(get_current_user_with_plan)) -> dict:
    """Paid gate for these three tabs. Defined HERE (each router owns its own 402 sentence)."""
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="This Research tab requires a paid plan")
    return user


def _sym(sym: str) -> str:
    s = (sym or "").upper().strip()
    if not _SYM_RE.match(s):
        raise HTTPException(status_code=400, detail="Not a ticker")
    return s


def _form(form: Optional[str]) -> Optional[str]:
    if not form:
        return None
    f = form.upper().strip()
    if not _FORM_RE.match(f) or not filings_feed.in_scope(f):
        raise HTTPException(status_code=400, detail="Not a form this feed carries")
    return f


@router.get("/api/research/people/{sym}", dependencies=[Depends(_people_armed)])
def research_people_route(sym: str, _user: dict = Depends(require_paid)):
    return research_people.people(_sym(sym))


@router.get("/api/research/estimate-history/{sym}", dependencies=[Depends(_estimates_armed)])
def estimate_history_route(sym: str, _user: dict = Depends(require_paid)):
    return estimate_history.history(_sym(sym))


@router.get("/api/research/filings-feed/{sym}", dependencies=[Depends(_feed_armed)])
def filings_feed_ticker_route(sym: str, form: Optional[str] = Query(default=None),
                              _user: dict = Depends(require_paid)):
    return filings_feed.ticker_feed(_sym(sym), form=_form(form))


@router.get("/api/research/filings-feed", dependencies=[Depends(_feed_armed)])
def filings_feed_market_route(form: Optional[str] = Query(default=None),
                              _user: dict = Depends(require_paid)):
    return filings_feed.market_feed(form=_form(form))
