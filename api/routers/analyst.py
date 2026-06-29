"""Analyst intel + institutional ownership endpoints (FMP Ultimate)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from api.middleware.auth_middleware import get_current_user
from api.services.analyst_intel import get_analyst_intel
from api.services.institutional_holdings import get_ownership

_log = logging.getLogger(__name__)
router = APIRouter()

_OWNERSHIP_EMPTY = {"ticker": "", "inst_pct": None, "inst_holders_count": None,
                    "as_of": None, "top_holders": [], "biggest_buyers": [], "biggest_sellers": []}


@router.get("/api/analyst/{sym}")
def analyst_endpoint(sym: str, debug: int = 0, user: dict = Depends(get_current_user)):
    s = (sym or "").upper().strip()
    if not s:
        return {"ticker": "", "consensus": None, "price_target": None, "recent_actions": []}
    try:
        return get_analyst_intel(s, debug=bool(debug))
    except Exception as e:
        _log.warning("analyst endpoint failed for %s: %s", s, e)
        return {"ticker": s, "consensus": None, "price_target": None, "recent_actions": []}


@router.get("/api/ownership/{sym}")
def ownership_endpoint(sym: str, debug: int = 0, user: dict = Depends(get_current_user)):
    s = (sym or "").upper().strip()
    if not s:
        return dict(_OWNERSHIP_EMPTY)
    try:
        return get_ownership(s, debug=bool(debug))
    except Exception as e:
        _log.warning("ownership endpoint failed for %s: %s", s, e)
        return dict(_OWNERSHIP_EMPTY, ticker=s)
