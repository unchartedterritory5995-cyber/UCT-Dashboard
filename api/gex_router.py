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
):
    """Get gamma exposure data for a ticker."""
    result = await get_gex_data(ticker, dte)
    return result
