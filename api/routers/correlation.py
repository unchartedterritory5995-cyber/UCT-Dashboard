"""Correlation matrix endpoint for UCT20 leadership stocks."""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from api.services.correlation import compute_correlation_matrix

router = APIRouter()


@router.get("/api/correlation")
def correlation(tickers: Optional[str] = Query(None), period: int = Query(60)):
    """Return NxN Pearson correlation matrix.

    Query params:
        tickers: Comma-separated ticker list (e.g. "AAPL,MSFT,NVDA").
                 Defaults to UCT20 leadership stocks.
        period:  Calendar days of history (default 60).
    """
    try:
        ticker_list = None
        if tickers:
            ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
        return compute_correlation_matrix(tickers=ticker_list, period=period)
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))
