"""
uw_router.py — API routes for Unusual Whales data.

These routes provide the same interface the frontend expects from Schwab,
but source data from the Unusual Whales API instead.

Routes:
  GET  /api/uw/contract-history  — daily OI/Vol/Price for popup charts
  POST /api/uw/options-quotes    — live quotes for one or more contracts
  GET  /api/uw/contract-intraday — real-time intraday for a contract
  GET  /api/uw/oi-change         — OI changes for a ticker
"""

import logging
from fastapi import APIRouter, Query
from pydantic import BaseModel

from api.uw_service import (
    get_contract_history,
    get_contract_intraday,
    get_batch_quotes,
    get_oi_change,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/uw", tags=["unusual-whales"])


# ─── Contract History (for popup OI/Vol/Price chart) ─────────────────────────

@router.get("/contract-history")
async def contract_history(
    sym: str = Query(...),
    cp: str = Query(...),
    strike: float = Query(...),
    exp: str = Query(...),
):
    """
    Returns daily OI/Vol/Price history for a single contract.
    Response format matches what the frontend chart expects:
    { history: [{date, oi, volume, price, spot}, ...] }
    """
    history = await get_contract_history(sym, cp, strike, exp)
    
    # Convert date format to match frontend expectations (M/D/YYYY)
    for row in history:
        d = row.get("date", "")
        if d and "-" in d:
            try:
                parts = d.split("-")
                y, m, day = int(parts[0]), int(parts[1]), int(parts[2])
                row["date"] = f"{m}/{day}/{y}"
            except (ValueError, IndexError):
                pass
    
    return {"history": history}


# ─── Live Quotes ─────────────────────────────────────────────────────────────

class QuoteRequest(BaseModel):
    symbol: str
    cp: str
    strike: float
    expDate: str  # ISO format YYYY-MM-DD or M/D or M/D/YYYY


@router.post("/options-quotes")
async def options_quotes(contracts: list[QuoteRequest]):
    """
    Fetch live quotes for one or more contracts.
    Response format matches Schwab: { quotes: [{mark, last, bid, ask, openInterest, volume, ...}] }
    """
    batch = []
    for c in contracts:
        # Convert ISO expDate to M/D format if needed
        exp = c.expDate
        if "-" in exp:
            try:
                parts = exp.split("-")
                exp = f"{int(parts[1])}/{int(parts[2])}"
                if int(parts[0]) != 2026:  # include year if not current
                    exp += f"/{parts[0]}"
            except (ValueError, IndexError):
                pass
        batch.append({"symbol": c.symbol, "cp": c.cp, "strike": c.strike, "exp": exp})
    
    quotes = await get_batch_quotes(batch)
    return {"quotes": quotes}


# ─── Contract Intraday ────────────────────────────────────────────────────────

@router.get("/contract-intraday")
async def contract_intraday(
    sym: str = Query(...),
    cp: str = Query(...),
    strike: float = Query(...),
    exp: str = Query(...),
):
    """Real-time intraday data for a contract."""
    data = await get_contract_intraday(sym, cp, strike, exp)
    return data


# ─── OI Change ────────────────────────────────────────────────────────────────

@router.get("/oi-change/{ticker}")
async def oi_change(ticker: str):
    """Get OI changes for a ticker's options."""
    data = await get_oi_change(ticker)
    return {"data": data}
