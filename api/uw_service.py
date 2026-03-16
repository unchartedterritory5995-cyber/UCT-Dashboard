"""
uw_service.py — Unusual Whales API service for options contract data.

Replaces Schwab for:
  - Historical OI/Vol/Price per contract (popup charts)
  - Live contract quotes (current price, OI, volume)
  - Intraday data

Endpoints used:
  GET /api/option-contract/{occ_id}/historic   — daily OI, vol, price history
  GET /api/option-contract/{occ_id}/intraday   — real-time intraday data
  GET /api/stock/{ticker}/option-contracts      — find OCC symbols for a ticker

Auth: Authorization: Bearer {UW_API_KEY}
      UW-CLIENT-API-ID: 100001
"""

import logging
import os
from datetime import date, datetime

import httpx

logger = logging.getLogger(__name__)

BASE = "https://api.unusualwhales.com"
_TIMEOUT = 12.0


def _headers() -> dict:
    key = os.environ.get("UW_API_KEY", "")
    if not key:
        raise RuntimeError("UW_API_KEY environment variable not set")
    return {
        "Authorization": f"Bearer {key}",
        "UW-CLIENT-API-ID": "100001",
        "Accept": "application/json",
    }


# ─── OCC Symbol Builder ──────────────────────────────────────────────────────

def build_occ(sym: str, cp: str, strike: float, exp_str: str) -> str:
    """
    Build OCC option symbol from components.
    Format: TICKER (padded to 6) + YYMMDD + C/P + strike*1000 (padded to 8)
    Example: AAPL  260320C00200000
    
    exp_str can be 'M/D', 'M/D/YY', or 'M/D/YYYY'
    """
    ticker = sym.upper().ljust(6)
    
    parts = exp_str.strip().split("/")
    m = int(parts[0])
    d = int(parts[1])
    if len(parts) >= 3:
        y = int(parts[2])
        if y < 100:
            y += 2000
    else:
        y = datetime.now().year
        if date(y, m, d) < date.today():
            y += 1
    
    date_str = f"{y % 100:02d}{m:02d}{d:02d}"
    cp_char = "C" if cp.upper().startswith("C") else "P"
    strike_int = int(round(strike * 1000))
    strike_str = f"{strike_int:08d}"
    
    return f"{ticker}{date_str}{cp_char}{strike_str}"


# ─── Contract History (daily OI/Vol/Price) ────────────────────────────────────

async def get_contract_history(sym: str, cp: str, strike: float, exp: str) -> list[dict]:
    """
    Fetch historical daily data for a single option contract.
    Returns list of: {date, oi, volume, price, spot} sorted oldest→newest.
    """
    occ = build_occ(sym, cp, strike, exp)
    url = f"{BASE}/api/option-contract/{occ}/historic"
    
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers())
            if resp.status_code == 404:
                logger.warning("[UW] Contract not found: %s", occ)
                return []
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.error("[UW] historic fetch failed for %s: %s", occ, e)
        return []
    
    rows = data.get("data", [])
    history = []
    for r in rows:
        try:
            history.append({
                "date": r.get("date", ""),
                "oi": int(r.get("open_interest", 0) or 0),
                "volume": int(r.get("volume", 0) or 0),
                "price": float(r.get("close", 0) or r.get("last_price", 0) or 0),
                "spot": float(r.get("underlying_price", 0) or 0),
                "high": float(r.get("high", 0) or 0),
                "low": float(r.get("low", 0) or 0),
                "open": float(r.get("open", 0) or 0),
            })
        except (ValueError, TypeError):
            continue
    
    # Sort oldest first
    history.sort(key=lambda x: x["date"])
    return history


# ─── Contract Intraday ────────────────────────────────────────────────────────

async def get_contract_intraday(sym: str, cp: str, strike: float, exp: str) -> dict:
    """
    Fetch intraday data for a contract. Returns latest quote-like data.
    """
    occ = build_occ(sym, cp, strike, exp)
    url = f"{BASE}/api/option-contract/{occ}/intraday"
    
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers())
            if resp.status_code == 404:
                return {"error": "not_found"}
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.error("[UW] intraday fetch failed for %s: %s", occ, e)
        return {"error": str(e)}
    
    rows = data.get("data", [])
    if not rows:
        return {"error": "no_data"}
    
    # Return latest entry
    latest = rows[-1] if isinstance(rows, list) else rows
    return {
        "mark": float(latest.get("close", 0) or latest.get("last_price", 0) or 0),
        "last": float(latest.get("last_price", 0) or latest.get("close", 0) or 0),
        "bid": float(latest.get("bid", 0) or 0),
        "ask": float(latest.get("ask", 0) or 0),
        "openInterest": int(latest.get("open_interest", 0) or 0),
        "volume": int(latest.get("volume", 0) or 0),
        "underlyingPrice": float(latest.get("underlying_price", 0) or 0),
        "iv": float(latest.get("implied_volatility", 0) or 0),
        "delta": float(latest.get("delta", 0) or 0),
        "theta": float(latest.get("theta", 0) or 0),
    }


# ─── Batch Quotes (for performance tracker / price fetching) ─────────────────

async def get_batch_quotes(contracts: list[dict]) -> list[dict]:
    """
    Fetch live quotes for multiple contracts.
    Each item: {symbol, cp, strike, expDate (ISO)}
    Returns list of quote dicts matching input order.
    
    Uses individual /historic calls (last entry) since UW doesn't have batch.
    Runs concurrently for speed.
    """
    import asyncio
    
    async def _fetch_one(c: dict) -> dict:
        occ = build_occ(c["symbol"], c["cp"], c["strike"], c.get("exp", c.get("expDate", "")))
        url = f"{BASE}/api/option-contract/{occ}/historic"
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                resp = await client.get(url, headers=_headers())
                if resp.status_code != 200:
                    return {"error": f"HTTP {resp.status_code}"}
                data = resp.json()
                rows = data.get("data", [])
                if not rows:
                    return {"error": "no_data"}
                latest = rows[-1]
                return {
                    "mark": float(latest.get("close", 0) or 0),
                    "last": float(latest.get("last_price", 0) or latest.get("close", 0) or 0),
                    "bid": float(latest.get("bid", 0) or 0),
                    "ask": float(latest.get("ask", 0) or 0),
                    "openInterest": int(latest.get("open_interest", 0) or 0),
                    "volume": int(latest.get("volume", 0) or 0),
                    "underlyingPrice": float(latest.get("underlying_price", 0) or 0),
                }
        except Exception as e:
            return {"error": str(e)}
    
    results = await asyncio.gather(*[_fetch_one(c) for c in contracts])
    return list(results)


# ─── Option Contracts List (find OCC for a ticker) ───────────────────────────

async def get_option_contracts(ticker: str) -> list[dict]:
    """
    List all option contracts for a ticker. Useful for finding OCC symbols.
    """
    url = f"{BASE}/api/stock/{ticker.upper()}/option-contracts"
    
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers())
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.error("[UW] option-contracts fetch failed for %s: %s", ticker, e)
        return []
    
    return data.get("data", [])


# ─── OI Change for a ticker ──────────────────────────────────────────────────

async def get_oi_change(ticker: str) -> list[dict]:
    """
    Get OI changes for a ticker's option contracts.
    """
    url = f"{BASE}/api/stock/{ticker.upper()}/oi-change"
    
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=_headers())
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.error("[UW] oi-change fetch failed for %s: %s", ticker, e)
        return []
    
    return data.get("data", [])
