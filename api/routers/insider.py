"""Insider activity endpoints.

GET /api/insider/feed         — notable insider buys across the market (last 7 days)
GET /api/insider/{ticker}     — insider transactions for a single stock
GET /api/insider/{ticker}/has-buy — quick boolean check for recent insider buy
"""

from __future__ import annotations

from fastapi import APIRouter
from api.services.insider import get_insider_activity, get_recent_insider_buys, has_recent_insider_buy

router = APIRouter(prefix="/api/insider", tags=["insider"])


@router.get("/feed")
def insider_feed():
    """Notable insider buys across the market (last 7 days)."""
    return get_recent_insider_buys()


@router.get("/{ticker}")
def insider_for_ticker(ticker: str):
    """All insider transactions for a single stock."""
    return get_insider_activity(ticker.upper())


@router.get("/{ticker}/has-buy")
def insider_has_buy(ticker: str, days: int = 30):
    """Quick check: any insider buy in the last N days?"""
    return {"symbol": ticker.upper(), "has_buy": has_recent_insider_buy(ticker.upper(), days)}
