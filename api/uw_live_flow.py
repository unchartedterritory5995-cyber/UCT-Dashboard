"""
uw_live_flow.py — Fetches live flow alerts from Unusual Whales API
and transforms them into BBS-CSV-compatible row format so the existing
processFlowData pipeline works unchanged.

UW flow-alerts → BBS CSV row mapping:
  ticker         → Symbol
  strike         → Strike Price
  expiry         → Exp Date (M/D)
  type           → Call/Put
  has_sweep      → Type (SWP/BLK)
  ask/bid prem   → Side (A/AA/B/BB)
  total_size     → Volume
  open_interest  → Open Interest
  total_premium  → Premium ($)
  vol_oi_ratio   → Color (WHITE/YELLOW/MAGENTA)
  underlying_price → Spot
  created_at     → Time
  sector         → Sector
  issue_type     → StockEtf
"""

import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx

logger = logging.getLogger(__name__)

BASE = "https://api.unusualwhales.com"
ET = ZoneInfo("America/New_York")
_TIMEOUT = 15.0


def _headers() -> dict:
    key = os.environ.get("UW_API_KEY", "")
    if not key:
        raise RuntimeError("UW_API_KEY not set")
    return {
        "Authorization": f"Bearer {key}",
        "UW-CLIENT-API-ID": "100001",
        "Accept": "application/json",
    }


def _exp_to_short(iso_exp: str) -> str:
    """Convert '2026-03-20' → '3/20'"""
    try:
        parts = iso_exp.split("-")
        return f"{int(parts[1])}/{int(parts[2])}"
    except (IndexError, ValueError):
        return iso_exp


def _iso_to_time(iso_str: str) -> str:
    """Convert '2026-03-16T17:49:56.287076Z' → '12:49:56 PM' (ET)"""
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        et = dt.astimezone(ET)
        return et.strftime("%-I:%M:%S %p")
    except (ValueError, AttributeError):
        return ""


def _iso_to_date(iso_str: str) -> str:
    """Convert '2026-03-16T...' → '3/16'"""
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        et = dt.astimezone(ET)
        return f"{et.month}/{et.day}"
    except (ValueError, AttributeError):
        return ""


def _derive_side(ask_prem: float, bid_prem: float, has_sweep: bool, total_size: int) -> str:
    """
    Derive BBS-style side from UW premium split.
    A = Ask side, AA = Above Ask (aggressive), B = Bid side, BB = Below Bid
    We approximate AA from sweep + all-ask, BB from sweep + all-bid.
    """
    if ask_prem > 0 and bid_prem == 0:
        return "AA" if has_sweep else "A"
    elif bid_prem > 0 and ask_prem == 0:
        return "BB" if has_sweep else "B"
    elif ask_prem > bid_prem:
        return "A"
    elif bid_prem > ask_prem:
        return "B"
    return "A"  # default to ask side


def _derive_color(vol_oi_ratio: float, total_size: int, open_interest: int) -> str:
    """
    Derive BBS-style color from volume/OI ratio.
    WHITE = OI not exceeded, YELLOW = exceeded in this alert, MAGENTA = heavily exceeded
    """
    if vol_oi_ratio <= 0:
        return "WHITE"
    if total_size > 0 and open_interest > 0 and total_size >= open_interest:
        return "MAGENTA"  # single alert exceeds entire OI
    if vol_oi_ratio >= 1.0:
        return "YELLOW"
    return "WHITE"


def transform_alert_to_bbs_row(alert: dict) -> dict:
    """
    Transform a single UW flow-alert into a BBS-CSV-compatible row dict.
    Keys match what parseCSV produces for processFlowData.
    """
    ask_prem = float(alert.get("total_ask_side_prem") or 0)
    bid_prem = float(alert.get("total_bid_side_prem") or 0)
    has_sweep = bool(alert.get("has_sweep"))
    total_size = int(alert.get("total_size") or 0)
    oi = int(alert.get("open_interest") or 0)
    vol_oi_str = alert.get("volume_oi_ratio") or "0"
    vol_oi = float(vol_oi_str)
    premium = float(alert.get("total_premium") or 0)
    strike = float(alert.get("strike") or 0)
    spot = float(alert.get("underlying_price") or 0)
    cp = "C" if alert.get("type", "").lower() == "call" else "P"
    exp = _exp_to_short(alert.get("expiry", ""))
    
    side = _derive_side(ask_prem, bid_prem, has_sweep, total_size)
    color = _derive_color(vol_oi, total_size, oi)
    trade_type = "SWP" if has_sweep else "BLK"
    
    # Issue type mapping
    issue = (alert.get("issue_type") or "").upper()
    if "ETF" in issue:
        stocketf = "ETF"
    elif "INDEX" in issue:
        stocketf = "INDEX"
    else:
        stocketf = "STOCK"
    
    return {
        "symbol": alert.get("ticker", ""),
        "strike": str(strike),
        "exp": exp,
        "callput": cp,
        "type": trade_type,
        "side": side,
        "volume": str(total_size),
        "oi": str(oi),
        "premium": str(premium),
        "color": color,
        "spot": str(spot),
        "time": _iso_to_time(alert.get("created_at", "")),
        "date": _iso_to_date(alert.get("created_at", "")),
        "sector": alert.get("sector") or "",
        "stocketf": stocketf,
        "iv": alert.get("iv_end") or alert.get("iv_start") or "",
        "alert_rule": alert.get("alert_rule", ""),
        "has_floor": alert.get("has_floor", False),
        "has_multileg": alert.get("has_multileg", False),
        "option_chain": alert.get("option_chain", ""),
        "trade_count": int(alert.get("trade_count") or 0),
        "marketcap": alert.get("marketcap") or "",
    }


async def fetch_live_flow(
    limit: int = 200,
    min_premium: int = 50000,
    ticker: str = None,
    is_call: bool = None,
    is_put: bool = None,
) -> list[dict]:
    """
    Fetch live flow alerts from UW and transform to BBS-compatible rows.
    UW caps at 200 per request, so we paginate if limit > 200.
    Returns list of row dicts ready for processFlowData.
    """
    url = f"{BASE}/api/option-trades/flow-alerts"
    
    all_alerts = []
    seen_ids = set()
    pages = max(1, (limit + 199) // 200)  # ceil division
    page_size = min(limit, 200)
    
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            for page in range(pages):
                params = {"limit": page_size, "min_premium": min_premium}
                if ticker:
                    params["ticker_symbol"] = ticker.upper()
                if is_call is True:
                    params["is_call"] = True
                if is_put is True:
                    params["is_put"] = True
                
                # Use the oldest alert's ID as cursor for next page
                if all_alerts:
                    last_id = all_alerts[-1].get("id")
                    if last_id:
                        params["before_id"] = last_id
                
                resp = await client.get(url, headers=_headers(), params=params)
                resp.raise_for_status()
                data = resp.json()
                alerts = data.get("data", [])
                
                if not alerts:
                    break
                
                new_count = 0
                for a in alerts:
                    aid = a.get("id", "")
                    if aid and aid not in seen_ids:
                        seen_ids.add(aid)
                        all_alerts.append(a)
                        new_count += 1
                
                logger.info("[UW-live] Page %d: %d alerts (%d new)", page + 1, len(alerts), new_count)
                
                # If we got fewer than page_size or no new alerts, we've exhausted the feed
                if len(alerts) < page_size or new_count == 0:
                    break
                
                if len(all_alerts) >= limit:
                    break
    
    except Exception as e:
        logger.error("[UW-live] flow-alerts fetch failed: %s", e)
        return []
    
    all_alerts = all_alerts[:limit]
    logger.info("[UW-live] Total: %d flow alerts (limit=%d, min_prem=%d, pages=%d)", len(all_alerts), limit, min_premium, pages)
    
    rows = []
    for alert in all_alerts:
        try:
            row = transform_alert_to_bbs_row(alert)
            rows.append(row)
        except Exception as e:
            logger.warning("[UW-live] Skipped alert: %s", e)
            continue
    
    return rows


async def fetch_live_flow_csv_text(
    limit: int = 200,
    min_premium: int = 50000,
    ticker: str = None,
) -> str:
    """
    Fetch live flow and return as CSV text that parseCSV can consume directly.
    This is the simplest integration — frontend fetches this as if it were a CSV file.
    """
    rows = await fetch_live_flow(limit=limit, min_premium=min_premium, ticker=ticker)
    if not rows:
        return ""
    
    # BBS CSV headers (matching what parseCSV expects)
    headers = [
        "Date", "Time", "Ticker", "Exp Date", "Strike Price", "Call/Put",
        "Type", "Side", "Volume", "Open Interest", "Premium ($)",
        "Color", "Spot", "Sector", "StockEtf", "IV"
    ]
    
    lines = [",".join(headers)]
    for r in rows:
        line = ",".join([
            r["date"],
            r["time"],
            r["symbol"],
            r["exp"],
            r["strike"],
            r["callput"],
            r["type"],
            r["side"],
            r["volume"],
            r["oi"],
            r["premium"],
            r["color"],
            r["spot"],
            r["sector"],
            r["stocketf"],
            r["iv"],
        ])
        lines.append(line)
    
    return "\n".join(lines)
