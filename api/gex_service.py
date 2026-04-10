"""
Gamma Exposure (GEX) computation service.
Uses Schwab /chains endpoint to fetch full options chain with greeks,
then calculates GEX per strike and identifies key dealer positioning levels.
"""

import logging
import httpx
from typing import Optional

from api import schwab_service as schwab

logger = logging.getLogger("gex")

CHAINS_URL = "https://api.schwabapi.com/marketdata/v1/chains"


async def get_gex_data(ticker: str, dte_filter: str = "all") -> dict:
    """
    Fetch full options chain and compute GEX per strike.

    dte_filter options:
      - "0dte"   → expirations today only
      - "week"   → next 7 days
      - "month"  → next 45 days
      - "all"    → next 180 days
    """
    ticker = ticker.upper().strip()
    # Index options on Schwab use $-prefix format (e.g. $SPX, $NDX, $VIX, $RUT)
    INDEX_TICKERS = {"SPX", "NDX", "VIX", "RUT", "DJX", "XSP", "XND"}
    schwab_symbol = "$" + ticker if ticker in INDEX_TICKERS else ticker
    token = await schwab.get_valid_token()
    if not token:
        return {"error": "Schwab not authenticated"}

    # Map dte filter to params
    dte_map = {
        "0dte": 1,
        "week": 7,
        "month": 45,
        "all": 180,
    }
    days = dte_map.get(dte_filter, 180)

    from datetime import datetime, timedelta
    from_date = datetime.now().strftime("%Y-%m-%d")
    to_date = (datetime.now() + timedelta(days=days)).strftime("%Y-%m-%d")

    params = {
        "symbol": schwab_symbol,
        "contractType": "ALL",
        "strikeCount": 60,  # 30 above, 30 below ATM
        "includeUnderlyingQuote": "true",
        "fromDate": from_date,
        "toDate": to_date,
    }
    headers = {"Authorization": f"Bearer {token}"}

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(CHAINS_URL, headers=headers, params=params)
            if r.status_code != 200:
                logger.error(f"[gex] Schwab chains failed: {r.status_code} {r.text[:200]}")
                return {"error": f"Schwab API error: {r.status_code}"}
            data = r.json()
    except Exception as e:
        logger.error(f"[gex] fetch failed: {e}")
        return {"error": str(e)}

    spot = float(data.get("underlyingPrice") or 0)
    if spot <= 0:
        return {"error": f"No spot price for {ticker}"}

    # Aggregate GEX by strike
    # GEX formula per contract: gamma × OI × 100 × spot² × 0.01
    # Calls contribute positive gamma to dealers (when dealers are short calls)
    # Puts contribute negative gamma
    strikes_map = {}

    def process_chain(chain_map: dict, is_call: bool):
        if not chain_map:
            return
        for exp_key, strikes in chain_map.items():
            for strike_str, contracts in strikes.items():
                try:
                    strike = float(strike_str)
                except (ValueError, TypeError):
                    continue
                for c in contracts:
                    oi = c.get("openInterest") or 0
                    gamma = c.get("gamma") or 0
                    if oi <= 0 or gamma == 0:
                        continue
                    # GEX contribution
                    gex_contrib = gamma * oi * 100 * (spot ** 2) * 0.01
                    if not is_call:
                        gex_contrib = -gex_contrib  # puts subtract
                    if strike not in strikes_map:
                        strikes_map[strike] = {
                            "strike": strike,
                            "callGex": 0,
                            "putGex": 0,
                            "callOI": 0,
                            "putOI": 0,
                        }
                    s = strikes_map[strike]
                    if is_call:
                        s["callGex"] += gex_contrib
                        s["callOI"] += oi
                    else:
                        s["putGex"] += gex_contrib  # already negative
                        s["putOI"] += oi

    process_chain(data.get("callExpDateMap", {}), is_call=True)
    process_chain(data.get("putExpDateMap", {}), is_call=False)

    if not strikes_map:
        return {"error": f"No options data with greeks for {ticker}"}

    # Build sorted list + totals
    strikes_list = sorted(strikes_map.values(), key=lambda x: x["strike"])
    for s in strikes_list:
        s["gex"] = s["callGex"] + s["putGex"]
        s["totalOI"] = s["callOI"] + s["putOI"]

    total_gex = sum(s["gex"] for s in strikes_list)
    total_call_gex = sum(s["callGex"] for s in strikes_list)
    total_put_gex = sum(s["putGex"] for s in strikes_list)

    # Call wall = strike with highest positive GEX (largest resistance)
    call_wall = max(strikes_list, key=lambda x: x["callGex"]) if strikes_list else None
    # Put wall = strike with highest absolute negative GEX (largest support)
    put_wall = min(strikes_list, key=lambda x: x["putGex"]) if strikes_list else None

    # Zero gamma: strike where cumulative GEX crosses zero (from negative below to positive above)
    # We compute it by walking strikes in order and finding the flip point
    zero_gamma = None
    cumulative = 0.0
    prev_strike = None
    prev_cum = 0.0
    for s in strikes_list:
        cumulative += s["gex"]
        if prev_strike is not None and prev_cum < 0 and cumulative >= 0:
            # Linear interpolation between prev_strike and s["strike"]
            if cumulative - prev_cum != 0:
                t = -prev_cum / (cumulative - prev_cum)
                zero_gamma = prev_strike + t * (s["strike"] - prev_strike)
            else:
                zero_gamma = s["strike"]
            break
        prev_strike = s["strike"]
        prev_cum = cumulative

    return {
        "ticker": ticker,
        "spot": spot,
        "totalGex": total_gex,
        "callGex": total_call_gex,
        "putGex": total_put_gex,
        "zeroGamma": zero_gamma,
        "callWall": {"strike": call_wall["strike"], "gex": call_wall["callGex"]} if call_wall else None,
        "putWall": {"strike": put_wall["strike"], "gex": put_wall["putGex"]} if put_wall else None,
        "strikes": strikes_list,
        "dteFilter": dte_filter,
    }
