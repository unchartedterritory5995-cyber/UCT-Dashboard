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
from api.uw_live_flow import fetch_live_flow, fetch_live_flow_csv_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/uw", tags=["unusual-whales"])


# ─── Live Flow (replaces CSV upload) ─────────────────────────────────────────

@router.get("/live-flow")
async def live_flow(
    limit: int = Query(200, ge=10, le=500),
    min_premium: int = Query(50000, ge=0),
):
    """
    Fetch live flow alerts from UW, transformed into CSV-equivalent rows.
    The frontend can feed these directly into processFlowData().
    Returns: { rows: [...], count: N, source: "unusual_whales" }
    """
    rows = await get_live_flow(limit=limit, min_premium=min_premium)
    return {"rows": rows, "count": len(rows), "source": "unusual_whales"}


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


# ─── Live Flow (replaces CSV upload) ─────────────────────────────────────────

@router.get("/live-flow")
async def live_flow(
    limit: int = Query(200),
    min_premium: int = Query(50000),
    ticker: str = Query(None),
):
    """
    Fetch live flow alerts from UW, transformed to BBS-compatible rows.
    Returns JSON array of rows that processFlowData can consume.
    """
    rows = await fetch_live_flow(limit=limit, min_premium=min_premium, ticker=ticker)
    return {"rows": rows, "count": len(rows)}


@router.get("/live-flow.csv")
async def live_flow_csv(
    limit: int = Query(200),
    min_premium: int = Query(50000),
    ticker: str = Query(None),
):
    """
    Fetch live flow as CSV text — drop-in replacement for flow-data.csv.
    Frontend can fetch this URL the same way it fetches the static CSV.
    """
    from fastapi.responses import PlainTextResponse
    csv_text = await fetch_live_flow_csv_text(limit=limit, min_premium=min_premium, ticker=ticker)
    return PlainTextResponse(csv_text, media_type="text/csv")


# ─── OI Change ────────────────────────────────────────────────────────────────

@router.get("/oi-change/{ticker}")
async def oi_change(ticker: str):
    """Get OI changes for a ticker's options."""
    data = await get_oi_change(ticker)
    return {"data": data}


# ─── Debug: Raw UW Response ───────────────────────────────────────────────────

@router.get("/debug-raw")
async def debug_raw(
    sym: str = Query(...),
    cp: str = Query(...),
    strike: float = Query(...),
    exp: str = Query(...),
):
    """
    Debug endpoint: returns raw UW API response + computed OCC symbol.
    Hit this in the browser to see actual field names.
    """
    import httpx
    from api.uw_service import build_occ, _headers, BASE
    
    occ = build_occ(sym, cp, strike, exp)
    url = f"{BASE}/api/option-contract/{occ}/historic"
    
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, headers=_headers())
            raw = resp.json()
    except Exception as e:
        raw = {"error": str(e)}
    
    return {
        "occ_symbol": occ,
        "url": url,
        "status": resp.status_code if 'resp' in dir() else "error",
        "raw_response_keys": list(raw.keys()) if isinstance(raw, dict) else "not_dict",
        "first_row": raw.get("data", [{}])[0] if isinstance(raw.get("data"), list) and len(raw.get("data",[])) > 0 else "no_data",
        "row_count": len(raw.get("data", [])) if isinstance(raw.get("data"), list) else 0,
        "full_data": raw,
    }


# ─── Debug: Raw Flow Alerts ──────────────────────────────────────────────────

@router.get("/debug-flow-alerts")
async def debug_flow_alerts(
    ticker: str = Query(None),
    limit: int = Query(5),
):
    """
    Debug endpoint: returns raw UW flow-alerts response to see field names.
    /api/uw/debug-flow-alerts?limit=3
    /api/uw/debug-flow-alerts?ticker=NVDA&limit=3
    """
    import httpx, os
    
    headers = {
        "Authorization": f"Bearer {os.environ.get('UW_API_KEY', '')}",
        "UW-CLIENT-API-ID": "100001",
        "Accept": "application/json",
    }
    url = "https://api.unusualwhales.com/api/option-trades/flow-alerts"
    params = {"limit": limit, "min_premium": 100000}
    if ticker:
        params["ticker_symbol"] = ticker.upper()
    
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            raw = resp.json()
    except Exception as e:
        return {"error": str(e)}
    
    data = raw.get("data", [])
    return {
        "status": resp.status_code,
        "count": len(data),
        "first_row_keys": list(data[0].keys()) if data else [],
        "first_row": data[0] if data else "no_data",
        "second_row": data[1] if len(data) > 1 else "no_data",
    }


# ─── Debug: Hottest Chains (Screener) ────────────────────────────────────────

@router.get("/debug-screener")
async def debug_screener(limit: int = Query(5)):
    """
    Debug: raw UW screener/option-contracts response.
    /api/uw/debug-screener?limit=3
    """
    import httpx, os
    
    headers = {
        "Authorization": f"Bearer {os.environ.get('UW_API_KEY', '')}",
        "UW-CLIENT-API-ID": "100001",
        "Accept": "application/json",
    }
    url = "https://api.unusualwhales.com/api/screener/option-contracts"
    params = {"limit": limit, "min_premium": 200000, "min_volume": 500}
    
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            raw = resp.json()
    except Exception as e:
        return {"error": str(e)}
    
    data = raw.get("data", [])
    return {
        "status": resp.status_code,
        "count": len(data),
        "first_row_keys": list(data[0].keys()) if data else [],
        "first_row": data[0] if data else "no_data",
        "second_row": data[1] if len(data) > 1 else "no_data",
    }


# ─── Debug: Recent Ticker Flow ───────────────────────────────────────────────

@router.get("/debug-ticker-flow/{ticker}")
async def debug_ticker_flow(ticker: str, limit: int = Query(5)):
    """
    Debug: raw UW stock/{ticker}/flow-recent response.
    /api/uw/debug-ticker-flow/NVDA?limit=3
    """
    import httpx, os
    
    headers = {
        "Authorization": f"Bearer {os.environ.get('UW_API_KEY', '')}",
        "UW-CLIENT-API-ID": "100001",
        "Accept": "application/json",
    }
    url = f"https://api.unusualwhales.com/api/stock/{ticker.upper()}/flow-recent"
    
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, headers=headers)
            raw = resp.json()
    except Exception as e:
        return {"error": str(e)}
    
    # Handle any response shape
    top_keys = list(raw.keys()) if isinstance(raw, dict) else ["not_dict"]
    data = raw.get("data", raw.get("flows", raw.get("trades", [])))
    if isinstance(data, list) and len(data) > 0:
        return {
            "status": resp.status_code,
            "top_keys": top_keys,
            "count": len(data),
            "first_row_keys": list(data[0].keys()) if isinstance(data[0], dict) else [],
            "first_row": data[0],
            "second_row": data[1] if len(data) > 1 else "no_data",
        }
    return {
        "status": resp.status_code,
        "top_keys": top_keys,
        "raw_truncated": str(raw)[:2000],
    }


# ─── Debug: Flow Alerts for specific ticker ───────────────────────────────────

@router.get("/debug-ticker-alerts/{ticker}")
async def debug_ticker_alerts(ticker: str, limit: int = Query(5)):
    """
    Debug: flow-alerts filtered to a specific ticker.
    /api/uw/debug-ticker-alerts/NVDA?limit=3
    """
    import httpx, os
    
    headers = {
        "Authorization": f"Bearer {os.environ.get('UW_API_KEY', '')}",
        "UW-CLIENT-API-ID": "100001",
        "Accept": "application/json",
    }
    url = "https://api.unusualwhales.com/api/option-trades/flow-alerts"
    params = {"ticker_symbol": ticker.upper(), "limit": limit}
    
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(url, headers=headers, params=params)
            raw = resp.json()
    except Exception as e:
        return {"error": str(e)}
    
    data = raw.get("data", [])
    return {
        "status": resp.status_code,
        "count": len(data),
        "first_row": data[0] if data else "no_data",
        "second_row": data[1] if len(data) > 1 else "no_data",
    }
