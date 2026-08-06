"""Insider transaction feed via Finnhub API.

Per-ticker: GET /stock/insider-transactions?symbol={ticker}
Feed: aggregate notable insider buys across UCT20 + broad market watchlist.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from api.services.cache import cache
from api.services.finnhub_client import fh_get

_logger = logging.getLogger(__name__)

_PER_TICKER_TTL = 4 * 3600  # 4 hours
_FEED_TTL = 3600             # 1 hour


def get_insider_activity(ticker: str) -> list[dict]:
    """Return recent insider transactions for a single ticker (cached 4h).

    Routed through the shared api.services.finnhub_client.fh_get (2026-08-05)
    so this call shares the process-wide token bucket / 429 cooldown with
    every other Finnhub caller instead of spending the same account budget
    uncoordinated.
    """
    cache_key = f"insider_{ticker}"
    hit = cache.get(cache_key)
    if hit is not None:
        return hit

    data = fh_get("/stock/insider-transactions", {"symbol": ticker.upper()}, timeout=15)
    if not isinstance(data, dict):
        return []
    raw = data.get("data", [])

    # Normalize to a clean shape, most recent first
    txns = []
    for r in raw:
        txn_type = _classify_txn(r)
        if txn_type is None:
            continue
        shares = r.get("share") or 0
        price = r.get("transactionPrice") or 0
        txns.append({
            "name": r.get("name", "Unknown"),
            "title": _clean_title(r),
            "type": txn_type,        # "buy" or "sell"
            "shares": abs(int(shares)),
            "price": round(float(price), 2),
            "amount": round(abs(shares * price), 2),
            "date": r.get("transactionDate", ""),
            "filing_date": r.get("filingDate", ""),
        })

    # Sort by transaction date descending
    txns.sort(key=lambda t: t["date"], reverse=True)
    cache.set(cache_key, txns, _PER_TICKER_TTL)
    return txns


def get_recent_insider_buys() -> list[dict]:
    """Return notable insider buys across the market in the last 7 days.

    Pulls from a broad watchlist of UCT20 + large-cap tickers.
    """
    cache_key = "insider_feed"
    hit = cache.get(cache_key)
    if hit is not None:
        return hit

    # Pull current UCT20 tickers from wire data if available
    tickers = _get_feed_tickers()
    cutoff = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d")

    # Parallelize the per-ticker Finnhub fetches. Each get_insider_activity is
    # independently cached (4h) and has a 15s per-call timeout, so a 10-wide
    # pool turns ~55 SEQUENTIAL fetches (~16s cold) into a few concurrent waves.
    def _fetch(tk: str):
        try:
            return tk, get_insider_activity(tk)
        except Exception:
            return tk, []

    buys: list[dict] = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        for tk, txns in ex.map(_fetch, tickers):
            for t in txns:
                if t["type"] != "buy":
                    continue
                if t["date"] < cutoff:
                    continue
                buys.append({**t, "symbol": tk})

    # Sort by dollar amount descending — most notable first
    buys.sort(key=lambda b: b["amount"], reverse=True)
    result = buys[:50]  # cap at 50
    cache.set(cache_key, result, _FEED_TTL)
    return result


def has_recent_insider_buy(ticker: str, days: int = 30) -> bool:
    """Quick check: did any insider buy this ticker in the last N days?"""
    cutoff = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    txns = get_insider_activity(ticker)
    return any(t["type"] == "buy" and t["date"] >= cutoff for t in txns)


# ── Helpers ──────────────────────────────────────────────────────────────────


def _classify_txn(r: dict) -> str | None:
    """Classify a Finnhub insider transaction as buy/sell or skip."""
    code = r.get("transactionCode", "")
    # P = open-market purchase, S = open-market sale
    # Also accept A (grant/award) as informational but skip for now
    if code == "P":
        return "buy"
    if code == "S":
        return "sell"
    # Skip grants, exercises, gifts, etc.
    return None


def _clean_title(r: dict) -> str:
    """Extract a human-readable title from Finnhub insider data."""
    # Finnhub doesn't provide title directly in insider-transactions;
    # use the 'name' field which sometimes includes title info.
    # The transactionType field has codes, not readable titles.
    # We fall back to a generic label.
    change = r.get("change", 0)
    if change and abs(change) > 100_000:
        return "Officer/Director"
    return "Officer/Director"


def _get_feed_tickers() -> list[str]:
    """Get tickers to scan for the feed — UCT20 + broad watchlist."""
    tickers = set()

    # Try to get UCT20 from cache
    wire = cache.get("wire_data")
    if wire and isinstance(wire, dict):
        leadership = wire.get("leadership", [])
        for item in leadership[:20]:
            sym = item.get("ticker") or item.get("sym") or item.get("symbol")
            if sym:
                tickers.add(sym.upper())

    # Add a broad watchlist of commonly-followed large caps
    _WATCHLIST = [
        "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA",
        "JPM", "BAC", "GS", "WFC", "V", "MA",
        "UNH", "JNJ", "PFE", "ABBV", "LLY",
        "XOM", "CVX", "COP",
        "HD", "WMT", "COST", "TGT",
        "CRM", "ORCL", "ADBE", "NOW",
        "AMD", "INTC", "AVGO", "QCOM",
        "DIS", "NFLX", "CMCSA",
        "BA", "CAT", "GE", "RTX",
    ]
    tickers.update(_WATCHLIST)
    return list(tickers)
