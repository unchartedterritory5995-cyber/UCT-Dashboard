"""
Batch contract quote endpoint using Unusual Whales API.

SETUP:
  1. Save as api/batch_quotes.py
  2. In api/main.py, add:
       from api.batch_quotes import router as batch_quotes_router
       app.include_router(batch_quotes_router)
  3. Ensure UW_API_KEY is set in Railway env vars (already done)
"""

import os
import asyncio
from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx

router = APIRouter(tags=["batch-quotes"])

UW_API_KEY = os.environ.get("UW_API_KEY", "")
UW_BASE = "https://api.unusualwhales.com/api"


# ─── Models ─────────────────────────────────────────────────────────────────

class ContractReq(BaseModel):
    sym: str
    cp: str        # "C" or "P"
    strike: float
    exp: str       # "M/D/YYYY" or "YYYY-MM-DD"

class BatchReq(BaseModel):
    contracts: list[ContractReq]

class ContractQuote(BaseModel):
    sym: str
    cp: str
    strike: float
    price: float
    bid: float = 0
    ask: float = 0
    mid: float = 0
    iv: float = 0
    error: str | None = None


# ─── OCC format conversion ─────────────────────────────────────────────────

def parse_exp(exp_str: str) -> datetime:
    """Parse expiration string in various formats."""
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%m-%d-%Y"):
        try:
            return datetime.strptime(exp_str.strip(), fmt)
        except ValueError:
            continue
    raise ValueError(f"Cannot parse expiration: {exp_str}")


def to_occ(sym: str, cp: str, strike: float, exp: str) -> str:
    """
    Build OCC option symbol.
    Format: TICKER (6 chars padded) + YYMMDD + C/P + strike*1000 (8 digits)
    Example: AAPL  250417C00220000
    """
    dt = parse_exp(exp)
    ticker = sym.upper().ljust(6)
    date_part = dt.strftime("%y%m%d")
    cp_char = cp.upper()[0]
    strike_part = str(int(round(strike * 1000))).zfill(8)
    return f"{ticker}{date_part}{cp_char}{strike_part}"


def exp_to_ymd(exp: str) -> str:
    """Convert exp string to YYYY-MM-DD for UW API query params."""
    dt = parse_exp(exp)
    return dt.strftime("%Y-%m-%d")


# ─── Single quote fetch ────────────────────────────────────────────────────

async def fetch_quote(
    client: httpx.AsyncClient,
    c: ContractReq,
) -> ContractQuote:
    """Fetch a single contract price from UW options chain endpoint."""
    base = ContractQuote(sym=c.sym, cp=c.cp, strike=c.strike, price=0)
    try:
        exp_date = exp_to_ymd(c.exp)
        resp = await client.get(
            f"{UW_BASE}/stock/{c.sym.upper()}/option-chain",
            params={"expiration": exp_date},
            headers={
                "Authorization": f"Bearer {UW_API_KEY}",
                "UW-CLIENT-API-ID": "100001",
                "Accept": "application/json",
            },
            timeout=12.0,
        )
        if resp.status_code != 200:
            base.error = f"UW HTTP {resp.status_code}"
            return base

        data = resp.json()
        # UW returns chains in "chains" or "data" array
        chains = data.get("chains") or data.get("data") or []

        for ch in chains:
            # Match by strike + call/put
            ch_strike = float(ch.get("strike") or ch.get("strike_price") or 0)
            ch_type = (ch.get("option_type") or "").upper()
            if not ch_type:
                # Try to infer from option_symbol
                sym_str = ch.get("option_symbol", "")
                if len(sym_str) > 12:
                    ch_type = sym_str[12]

            if abs(ch_strike - c.strike) < 0.01 and ch_type and ch_type[0] == c.cp[0].upper():
                last = float(ch.get("last_price") or ch.get("close") or 0)
                bid = float(ch.get("nbbo_bid") or ch.get("bid") or 0)
                ask = float(ch.get("nbbo_ask") or ch.get("ask") or 0)
                mid = round((bid + ask) / 2, 2) if (bid + ask) > 0 else 0
                iv = float(ch.get("implied_volatility") or 0)
                price = last if last > 0 else (mid if mid > 0 else 0)

                return ContractQuote(
                    sym=c.sym, cp=c.cp, strike=c.strike,
                    price=round(price, 2),
                    bid=round(bid, 2),
                    ask=round(ask, 2),
                    mid=round(mid, 2),
                    iv=round(iv, 4),
                )

        base.error = "no match in chain"
        return base

    except httpx.TimeoutException:
        base.error = "timeout"
        return base
    except Exception as e:
        base.error = str(e)[:80]
        return base


# ─── Batch endpoint ─────────────────────────────────────────────────────────

@router.post("/api/uw/batch-quotes")
async def batch_quotes(req: BatchReq):
    """
    Fetch live prices for multiple option contracts.
    Uses concurrency with rate limiting (4 concurrent, 150ms spacing).
    """
    if not UW_API_KEY:
        raise HTTPException(500, "UW_API_KEY not configured")

    if len(req.contracts) == 0:
        return {"quotes": []}

    # Deduplicate by ticker+exp to minimize API calls
    # UW returns full chain per ticker+exp, so group and reuse
    seen_chains: dict[str, list[dict]] = {}
    results: list[ContractQuote] = []

    sem = asyncio.Semaphore(4)

    async with httpx.AsyncClient() as client:

        async def fetch_with_limit(c: ContractReq) -> ContractQuote:
            async with sem:
                q = await fetch_quote(client, c)
                await asyncio.sleep(0.15)
                return q

        tasks = [fetch_with_limit(c) for c in req.contracts]
        results = await asyncio.gather(*tasks)

    return {"quotes": [r.model_dump() for r in results]}
