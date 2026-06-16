"""Research page endpoints (`/api/research/*`)."""
from __future__ import annotations

import logging

from fastapi import APIRouter

from api.services.research.financials import get_financials

_logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/research/financials/{sym}")
def research_financials(sym: str):
    try:
        return get_financials(sym)
    except Exception as exc:
        _logger.warning("research financials failed for %s: %s", sym, exc)
        return {"sym": (sym or "").upper(), "annual": [], "quarterly": [], "balance": {}, "metrics": {}}
