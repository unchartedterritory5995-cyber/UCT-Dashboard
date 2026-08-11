"""ETF holdings for the chart's "View Holdings" floating watchlist.

- GET /api/etf/symbols        → the ETF-symbol universe (the button's is-ETF gate)
- GET /api/etf/holdings/{sym} → {symbol, holdings:[{sym,name,weight}]} for one ETF

Any logged-in user (ETF holdings are public data, unlike the curated single-stock
ETF family map which is paid).
"""
from fastapi import APIRouter, Depends

from api.middleware.auth_middleware import get_current_user
from api.services import etf_holdings

router = APIRouter()


@router.get("/api/etf/symbols")
def etf_symbols(user: dict = Depends(get_current_user)):
    return {"symbols": sorted(etf_holdings.etf_symbol_set())}


@router.get("/api/etf/holdings/{symbol}")
def etf_holdings_route(symbol: str, user: dict = Depends(get_current_user)):
    return {"symbol": symbol.upper(), "holdings": etf_holdings.get_holdings(symbol)}
