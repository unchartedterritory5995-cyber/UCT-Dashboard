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
    ticker = sym.upper()
    
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
    
    rows = data.get("chains", data.get("data", []))
    history = []
    for r in rows:
        try:
            price = float(r.get("last_price") or r.get("avg_price") or 0)
            history.append({
                "date": r.get("date", ""),
                "oi": int(r.get("open_interest", 0) or 0),
                "volume": int(r.get("volume", 0) or 0),
                "price": price,
                "spot": 0,  # UW doesn't provide underlying_price in historic
                "high": float(r.get("high_price") or 0),
                "low": float(r.get("low_price") or 0),
                "open": float(r.get("open_price") or 0),
                "premium": float(r.get("total_premium") or 0),
                "iv": float(r.get("implied_volatility") or 0),
                "ask_vol": int(r.get("ask_volume") or 0),
                "bid_vol": int(r.get("bid_volume") or 0),
                "sweep_vol": int(r.get("sweep_volume") or 0),
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
    
    rows = data.get("chains", data.get("data", []))
    if not rows:
        return {"error": "no_data"}
    
    # Return latest entry (first = newest from UW)
    latest = rows[0] if isinstance(rows, list) else rows
    return {
        "mark": float(latest.get("last_price") or latest.get("avg_price") or 0),
        "last": float(latest.get("last_price") or 0),
        "bid": float(latest.get("nbbo_bid") or 0),
        "ask": float(latest.get("nbbo_ask") or 0),
        "openInterest": int(latest.get("open_interest") or 0),
        "volume": int(latest.get("volume") or 0),
        "underlyingPrice": 0,
        "iv": float(latest.get("implied_volatility") or 0),
        "delta": 0,
        "theta": 0,
    }


# ─── Batch Quotes (for performance tracker / price fetching) ─────────────────

async def get_batch_quotes(contracts: list[dict]) -> list[dict]:
    """
    Fetch live quotes for multiple contracts.
    Each item: {symbol, cp, strike, expDate (ISO)}
    Returns list of quote dicts matching input order.
    
    Uses individual /historic calls (last entry) since UW doesn't have batch.
    Rate-limited: 8 concurrent, 0.6s spacing to stay under 120 req/min.
    """
    import asyncio
    
    semaphore = asyncio.Semaphore(8)  # max 8 concurrent
    
    async def _fetch_one(client: httpx.AsyncClient, c: dict) -> dict:
        async with semaphore:
            occ = build_occ(c["symbol"], c["cp"], c["strike"], c.get("exp", c.get("expDate", "")))
            url = f"{BASE}/api/option-contract/{occ}/historic"
            try:
                resp = await client.get(url, headers=_headers())
                if resp.status_code == 429:
                    # Rate limited — wait and retry once
                    logger.warning("[UW] Rate limited on %s, waiting 5s…", occ)
                    await asyncio.sleep(5)
                    resp = await client.get(url, headers=_headers())
                if resp.status_code != 200:
                    return {"error": f"HTTP {resp.status_code}"}
                data = resp.json()
                rows = data.get("chains", data.get("data", []))
                if not rows:
                    return {"error": "no_data"}
                latest = rows[0]  # newest first from UW
                return {
                    "mark": float(latest.get("last_price") or latest.get("avg_price") or 0),
                    "last": float(latest.get("last_price") or 0),
                    "bid": float(latest.get("nbbo_bid") or 0),
                    "ask": float(latest.get("nbbo_ask") or 0),
                    "openInterest": int(latest.get("open_interest") or 0),
                    "volume": int(latest.get("volume") or 0),
                    "underlyingPrice": 0,
                    "iv": float(latest.get("implied_volatility") or 0),
                }
            except Exception as e:
                return {"error": str(e)}
            finally:
                await asyncio.sleep(0.6)  # space requests ~0.6s apart
    
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        results = await asyncio.gather(*[_fetch_one(client, c) for c in contracts])
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


# ─── Live Flow (transforms UW alerts → CSV-equivalent rows) ──────────────────

async def get_live_flow(limit: int = 200, min_premium: int = 50000) -> list[dict]:
    """
    Fetch flow alerts from UW and transform each into the same dict format
    that the frontend's parseCSV produces. This lets processFlowData run
    on live data with zero changes.
    """
    url = f"{BASE}/api/option-trades/flow-alerts"
    params = {"limit": limit, "min_premium": min_premium}
    
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(url, headers=_headers())
            resp.raise_for_status()
            raw = resp.json()
    except Exception as e:
        logger.error("[UW] flow-alerts fetch failed: %s", e)
        return []
    
    alerts = raw.get("data", [])
    rows = []
    today = date.today()
    
    for a in alerts:
        try:
            ticker = (a.get("ticker") or "").upper()
            strike = float(a.get("strike") or 0)
            cp_raw = (a.get("type") or "").lower()
            cp = "CALL" if cp_raw == "call" else "PUT" if cp_raw == "put" else ""
            spot = float(a.get("underlying_price") or 0)
            volume = int(a.get("total_size") or 0)
            oi = int(a.get("open_interest") or 0)
            premium = float(a.get("total_premium") or 0)
            price = float(a.get("price") or 0)
            iv = float(a.get("iv_start") or 0)
            mktcap = float(a.get("marketcap") or 0)
            sector = a.get("sector") or ""
            
            # Expiry
            exp_raw = a.get("expiry") or ""
            if "-" in exp_raw:
                ep = exp_raw.split("-")
                expiry_str = f"{int(ep[1])}/{int(ep[2])}/{ep[0]}"
                try:
                    exp_date = date(int(ep[0]), int(ep[1]), int(ep[2]))
                    dte = (exp_date - today).days
                except ValueError:
                    dte = -1
            else:
                expiry_str = exp_raw
                dte = -1
            
            # Type
            has_sweep = a.get("has_sweep", False)
            order_type = "SWEEP" if has_sweep else "BLOCK"
            
            # Side
            ask_prem = float(a.get("total_ask_side_prem") or 0)
            bid_prem = float(a.get("total_bid_side_prem") or 0)
            if ask_prem > 0 and bid_prem == 0:
                side = "ABOVE ASK" if has_sweep else "ASK"
            elif bid_prem > 0 and ask_prem == 0:
                side = "BELOW BID" if has_sweep else "BID"
            elif ask_prem > bid_prem:
                side = "ASK"
            elif bid_prem > ask_prem:
                side = "BID"
            else:
                side = "ASK"
            
            # Color
            vol_oi = float(a.get("volume_oi_ratio") or 0)
            if vol_oi > 1.0:
                trades = int(a.get("trade_count") or 1)
                color = "MAGENTA" if trades >= 3 and vol_oi > 1.5 else "YELLOW"
            else:
                color = "WHITE"
            
            # Time & Date
            created = a.get("created_at") or ""
            time_str = ""
            date_str = ""
            if created:
                try:
                    from zoneinfo import ZoneInfo
                    dt_obj = datetime.fromisoformat(created.replace("Z", "+00:00"))
                    et = dt_obj.astimezone(ZoneInfo("America/New_York"))
                    time_str = et.strftime("%-I:%M:%S %p")
                    date_str = f"{et.month}/{et.day}/{et.year}"
                except Exception:
                    pass
            
            # Stock/ETF
            issue = (a.get("issue_type") or "").upper()
            stocketf = "ETF" if "ETF" in issue else "STOCK"
            
            # UOA
            alert_rule = a.get("alert_rule") or ""
            uoa = "T" if vol_oi > 1.0 or "Golden" in alert_rule else ""
            
            rows.append({
                "ticker": ticker, "type": order_type, "cp": cp,
                "strike": str(strike), "spot": str(spot), "side": side,
                "volume": str(volume), "oi": str(oi), "iv": str(iv),
                "premium": str(premium), "price": str(price), "color": color,
                "dte": str(dte), "mktcap": str(mktcap), "sector": sector,
                "stocketf": stocketf, "expiry": expiry_str,
                "date": date_str, "time": time_str, "uoa": uoa,
                "_alert_rule": alert_rule,
                "_trade_count": str(a.get("trade_count") or 1),
                "_has_multileg": str(a.get("has_multileg", False)),
                "_vol_oi_ratio": str(vol_oi),
            })
        except Exception as e:
            logger.warning("[UW] Skipping alert: %s", e)
            continue
    
    logger.info("[UW] Live flow: %d alerts -> %d rows", len(alerts), len(rows))
    return rows
