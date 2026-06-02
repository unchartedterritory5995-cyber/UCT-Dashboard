"""SEC Filings router — wraps sec_filings.recent_filings.

GET /api/filings/{ticker}?count=10
Returns: {ticker, company, cik, form_filter, count, filings: [{form, filed, period, accession, url}]}

Empty-safe; never raises.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Query

from api.services.sec_filings import recent_filings

_log = logging.getLogger(__name__)
router = APIRouter()


@router.get("/api/filings/{ticker}")
def get_filings(ticker: str, count: int = Query(default=10, ge=1, le=50)):
    """Recent SEC filings for a ticker.

    Returns at most `count` filings (newest-first). Empty-safe: returns
    {ticker, filings: []} on any failure, never raises.
    """
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"ticker": sym, "filings": []}
    try:
        return recent_filings(sym, count=count)
    except Exception as e:
        _log.warning("recent_filings failed for %s: %s", sym, e)
        return {"ticker": sym, "filings": []}
