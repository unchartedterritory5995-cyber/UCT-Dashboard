"""Analyst intel + institutional ownership endpoints (FMP Ultimate)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends

from api.middleware.auth_middleware import get_current_user
from api.services.analyst_intel import get_analyst_intel

_log = logging.getLogger(__name__)
router = APIRouter()


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
