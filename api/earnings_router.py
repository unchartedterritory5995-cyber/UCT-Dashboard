"""
UCT Intelligence — Earnings Date Router
Fetches next earnings dates from Finviz quote pages.
Mount in main.py: app.include_router(earnings_router, prefix="/api/schwab")
Requires: requests (already in most FastAPI projects)
"""

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime, date
import asyncio
import re
import logging

logger = logging.getLogger("earnings")

earnings_router = APIRouter()

# In-memory cache: sym -> { date, daysUntil, confirmed, timing, fetchedAt }
_cache: Dict[str, dict] = {}
CACHE_TTL_HOURS = 12


class EarningsRequest(BaseModel):
    symbols: List[str]


def _fetch_earnings_finviz(symbol: str) -> Optional[dict]:
    """Fetch next earnings date for a symbol from Finviz."""
    import requests

    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        url = f"https://finviz.com/quote.ashx?t={symbol}&p=d"
        resp = requests.get(url, headers=headers, timeout=8)
        if resp.status_code != 200:
            logger.debug(f"Finviz returned {resp.status_code} for {symbol}")
            return None

        html = resp.text

        # Finviz shows earnings in the fundamentals table as "Earnings"
        # Format: "May 28 AMC" or "May 28 BMO" or "May 28"
        match = re.search(
            r'<td[^>]*class="snapshot-td2-cp"[^>]*>Earnings</td>\s*<td[^>]*class="snapshot-td2"[^>]*>([^<]+)</td>',
            html
        )
        if not match:
            match = re.search(r'>Earnings<.*?<b>([^<]+)</b>', html, re.DOTALL)
        if not match:
            match = re.search(
                r'Earnings.*?<td[^>]*>([A-Z][a-z]{2}\s+\d{1,2}(?:\s+[AB]M[CO])?)',
                html, re.DOTALL
            )

        if not match:
            logger.debug(f"No earnings date found for {symbol}")
            return None

        raw = match.group(1).strip()
        if raw == "-" or not raw:
            return None

        # Parse AMC/BMO timing
        timing = ""
        if "AMC" in raw:
            timing = "AMC"
        elif "BMO" in raw:
            timing = "BMO"

        date_part = re.sub(r'\s*(AMC|BMO)\s*', '', raw).strip()

        months = {
            "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
            "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12
        }

        parts = date_part.split()
        if len(parts) < 2:
            return None

        month_str = parts[0]
        day_str = parts[1]

        if month_str not in months:
            return None

        m = months[month_str]
        d = int(day_str)

        today = date.today()
        year = today.year
        try:
            ed = date(year, m, d)
        except ValueError:
            return None

        # If date is >30 days past, assume next year
        if (today - ed).days > 30:
            year += 1
            try:
                ed = date(year, m, d)
            except ValueError:
                return None

        days_until = (ed - today).days
        cy = today.year
        date_str = f"{m}/{d}" if year == cy else f"{m}/{d}/{str(year)[-2:]}"

        return {
            "date": date_str,
            "daysUntil": days_until,
            "confirmed": True,
            "timing": timing,
        }

    except Exception as e:
        logger.debug(f"Error fetching {symbol}: {e}")

    return None


@earnings_router.post("/earnings")
async def get_earnings(req: EarningsRequest):
    """Batch fetch next earnings dates for given symbols."""
    results: Dict[str, Optional[dict]] = {}
    now = datetime.now()
    to_fetch = []

    for sym in req.symbols[:50]:
        sym = sym.upper().strip()
        if not sym:
            continue

        cached = _cache.get(sym)
        if cached:
            age_hours = (now - cached["fetchedAt"]).total_seconds() / 3600
            if age_hours < CACHE_TTL_HOURS:
                results[sym] = {
                    "date": cached.get("date"),
                    "daysUntil": cached.get("daysUntil"),
                    "confirmed": cached.get("confirmed", False),
                    "timing": cached.get("timing", ""),
                }
                continue

        to_fetch.append(sym)

    if to_fetch:
        loop = asyncio.get_event_loop()
        for i, sym in enumerate(to_fetch):
            try:
                if i > 0:
                    await asyncio.sleep(0.15)  # stagger to avoid rate limits
                info = await loop.run_in_executor(None, _fetch_earnings_finviz, sym)
                if info:
                    _cache[sym] = {**info, "fetchedAt": now}
                    results[sym] = {
                        "date": info["date"],
                        "daysUntil": info["daysUntil"],
                        "confirmed": info["confirmed"],
                        "timing": info.get("timing", ""),
                    }
                else:
                    _cache[sym] = {"date": None, "daysUntil": None, "confirmed": False, "timing": "", "fetchedAt": now}
                    results[sym] = None
            except Exception as e:
                logger.debug(f"Error fetching {sym}: {e}")
                results[sym] = None

    return {"earnings": results}
