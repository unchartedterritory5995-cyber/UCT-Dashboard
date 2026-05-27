"""Institutional ownership for a ticker via yfinance.

yfinance exposes Yahoo Finance's quarterly institutional holders table
(top holders from 13F filings) — much simpler than parsing SEC 13F XML
directly. Returns top N holders + total institutional ownership %.

For deeper 13F deltas across all filers (who's adding / cutting), see
the SEC EDGAR full-text search tool (`search_sec_filings`).
"""

import logging
from typing import Any

import yfinance as yf

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)
_CACHE = TTLCache()
_CACHE_TTL = 21600  # 6 hours — 13F data updates quarterly


def get_institutional_holders(ticker: str, top_n: int = 10) -> dict[str, Any]:
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}
    top_n = max(1, min(25, int(top_n or 10)))

    cache_key = f"inst::{sym}::{top_n}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    try:
        t = yf.Ticker(sym)
        info = t.info or {}
        held_by_inst = info.get("heldPercentInstitutions")
        held_by_insiders = info.get("heldPercentInsiders")
        float_shares = info.get("floatShares")
        # institutional_holders is a DataFrame with cols: Holder, Shares, Date Reported, % Out, Value
        try:
            df = t.institutional_holders
        except Exception:
            df = None
    except Exception as e:
        _log.warning("yfinance institutional holders failed for %s: %s", sym, e)
        return {"error": f"yfinance failed: {e}", "ticker": sym}

    holders: list[dict] = []
    if df is not None and not df.empty:
        for _, row in df.head(top_n).iterrows():
            try:
                holders.append({
                    "holder": str(row.get("Holder") or ""),
                    "shares": int(row.get("Shares") or 0),
                    "date_reported": str(row.get("Date Reported") or ""),
                    "pct_out": round(float(row.get("% Out") or 0) * 100.0, 2)
                                if row.get("% Out") is not None else None,
                    "value_usd": float(row.get("Value") or 0),
                })
            except Exception:
                continue

    def _pct(v):
        try:
            return round(float(v) * 100.0, 2)
        except (TypeError, ValueError):
            return None

    result = {
        "ticker": sym,
        "held_by_institutions_pct": _pct(held_by_inst),
        "held_by_insiders_pct": _pct(held_by_insiders),
        "float_shares": float_shares,
        "top_holders_count": len(holders),
        "top_holders": holders,
        "source": "yfinance (Yahoo Finance 13F aggregate)",
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result
