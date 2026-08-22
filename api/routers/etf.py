"""ETF holdings for the chart's "View Holdings" floating watchlist.

- GET /api/etf/symbols        → the ETF-symbol universe (the button's is-ETF gate)
- GET /api/etf/holdings/{sym} → {symbol, holdings:[{sym,name,weight,sector,industry}]} for one ETF

Any logged-in user (ETF holdings are public data, unlike the curated single-stock
ETF family map which is paid).

Sector/industry are attached here from the universe-wide `industry_map` (the same
~100%-coverage Finviz-seeded map Groups/Breadth use), NOT from the generic
watchlist meta-batch path (`/api/research/snapshot-batch`) — that path sorts its
symbols alphabetically before applying a 100-ticker cap, so a >100-holding ETF
would only ever get industries for its alphabetically-first names regardless of
weight, and its per-ticker source is a live yfinance call rather than the
prebuilt map. A single bulk `get_groups()` call covers every holding instantly.
"""
from fastapi import APIRouter, Depends

from api.middleware.auth_middleware import get_current_user
from api.services import etf_holdings, industry_map

router = APIRouter()


@router.get("/api/etf/symbols")
def etf_symbols(user: dict = Depends(get_current_user)):
    return {"symbols": sorted(etf_holdings.etf_symbol_set())}


@router.get("/api/etf/holdings/{symbol}")
def etf_holdings_route(symbol: str, user: dict = Depends(get_current_user)):
    holdings = etf_holdings.get_holdings(symbol)
    groups = industry_map.get_groups([h["sym"] for h in holdings])
    for h in holdings:
        g = groups.get(h["sym"]) or {}
        h["sector"] = g.get("sector")
        h["industry"] = g.get("industry")
    return {"symbol": symbol.upper(), "holdings": holdings}
