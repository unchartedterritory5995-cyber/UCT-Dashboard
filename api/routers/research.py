"""Research page endpoints (`/api/research/*`)."""
from __future__ import annotations

import logging

from fastapi import APIRouter

from api.services.research.financials import get_financials
from api.services.research.estimates import get_estimates
from api.services.research.ownership import get_ownership

_logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/research/financials/{sym}")
def research_financials(sym: str):
    try:
        return get_financials(sym)
    except Exception as exc:
        _logger.warning("research financials failed for %s: %s", sym, exc)
        return {"sym": (sym or "").upper(), "annual": [], "quarterly": [], "balance": {}, "metrics": {}}


@router.get("/api/research/estimates/{sym}")
def research_estimates(sym: str):
    try:
        return get_estimates(sym)
    except Exception as exc:
        _logger.warning("research estimates failed for %s: %s", sym, exc)
        return {"sym": (sym or "").upper(), "forward": [], "revisions": [], "rating_changes": []}


@router.get("/api/research/ownership/{sym}")
def research_ownership(sym: str):
    try:
        return get_ownership(sym)
    except Exception as exc:
        _logger.warning("research ownership failed for %s: %s", sym, exc)
        return {"sym": (sym or "").upper(), "institutional": {"pct_held": None, "holders": []}, "short": {}, "insider": []}
