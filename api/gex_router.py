"""
FastAPI router for Gamma Exposure (GEX) endpoints.
"""

from fastapi import APIRouter, Query
from api.gex_service import get_gex_data

router = APIRouter(prefix="/api/gex", tags=["gex"])


@router.get("/data")
async def gex_data(
    ticker: str = Query(..., description="Ticker symbol (e.g. SPY, QQQ, SPX)"),
    dte: str = Query("all", description="DTE filter: 0dte, week, month, all"),
    adjusted: bool = Query(False, description="If true, use trade-aware dealer positioning estimates"),
):
    """Get gamma exposure data for a ticker.

    When adjusted=true, scales each contract's GEX contribution by
    est_customer_net / OI from the dealer_positioning table. Falls back
    to naive (customer_factor = 1.0) for contracts without DP coverage.

    Response includes:
      - adjusted (bool): whether trade-aware mode was used
      - attributionDays (int): how many days of flow attribution exist for this ticker
      - avgConfidence (float 0-1): OI-weighted avg flow_confidence
      - coveragePct (float 0-1): fraction of chain contracts with DP data
    """
    result = await get_gex_data(ticker, dte, adjusted=adjusted)
    return result
