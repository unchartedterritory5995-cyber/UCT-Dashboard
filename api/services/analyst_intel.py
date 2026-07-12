"""Analyst intelligence — consensus, price target (+upside%), recent
upgrades/downgrades. FMP Ultimate first, Finnhub (get_earnings_intel) fallback.
Cached ~6h. Never raises."""
from __future__ import annotations

import logging

from api.services import earnings_estimates as ee
from api.services.cache import cache

_log = logging.getLogger(__name__)
_TTL = 21_600  # 6h


def _round(v, n=1):
    try:
        return round(float(v), n)
    except (TypeError, ValueError):
        return None


# ── FMP slices (mockable; exact paths verified live, fall back to None) ──────
def _fmp_consensus(ticker):
    data = ee._fmp_get("/stable/grades-consensus", {"symbol": ticker})
    row = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
    if not row:
        return None
    buy = int(row.get("buy") or 0)
    hold = int(row.get("hold") or 0)
    sell = int(row.get("sell") or 0)
    sb = int(row.get("strongBuy") or 0)
    ss = int(row.get("strongSell") or 0)
    return {"rating": row.get("consensus") or _derive_rating(buy + sb, hold, sell + ss),
            "buy": buy, "hold": hold, "sell": sell, "strong_buy": sb, "strong_sell": ss}


def _fmp_price_target(ticker):
    # /stable/price-target-summary only has monthly AVERAGE aggregates (no
    # low/high) — /stable/price-target-consensus is the range endpoint
    # (targetLow/targetHigh/targetConsensus/targetMedian).
    data = ee._fmp_get("/stable/price-target-consensus", {"symbol": ticker})
    row = data[0] if isinstance(data, list) and data else (data if isinstance(data, dict) else None)
    if not row:
        return None
    return {"low": _round(row.get("targetLow"), 2),
            "avg": _round(row.get("targetConsensus") or row.get("targetMedian"), 2),
            "high": _round(row.get("targetHigh"), 2),
            "count": None,
            "updated": None}


def _fmp_recent_actions(ticker):
    # /stable/grades-historical is aggregate buy/hold/sell COUNTS per date
    # (no firm) — /stable/grades-news carries the per-firm action fields
    # (gradingCompany/action/previousGrade/newGrade) this function reads.
    data = ee._fmp_get("/stable/grades-news", {"symbol": ticker, "limit": 20})
    if not isinstance(data, list):
        return []
    out = []
    for r in data[:15]:
        out.append({"date": str(r.get("publishedDate") or "")[:10],
                    "firm": r.get("gradingCompany") or r.get("analystCompany"),
                    "action": (r.get("action") or "").lower() or None,
                    "from_grade": r.get("previousGrade"),
                    "to_grade": r.get("newGrade"),
                    "price_target": _round(r.get("priceTarget"), 2)})
    return out


def _derive_rating(buy, hold, sell):
    if buy == hold == sell == 0:
        return None
    if buy >= max(hold, sell) and buy > sell:
        return "Buy"
    if sell > buy:
        return "Sell"
    return "Hold"


def _finnhub_consensus(intel):
    c = (intel or {}).get("consensus")
    if not c:
        return None
    buy = int(c.get("buy") or 0)
    hold = int(c.get("hold") or 0)
    sell = int(c.get("sell") or 0)
    sb = int(c.get("strongBuy") or 0)
    ss = int(c.get("strongSell") or 0)
    return {"rating": _derive_rating(buy + sb, hold, sell + ss),
            "buy": buy, "hold": hold, "sell": sell, "strong_buy": sb, "strong_sell": ss}


def _finnhub_pt(intel):
    p = (intel or {}).get("price_target")
    if not p:
        return None
    return {"low": _round(p.get("targetLow"), 2), "avg": _round(p.get("targetMean"), 2),
            "high": _round(p.get("targetHigh"), 2), "count": None,
            "updated": str(p.get("lastUpdated") or "")[:10] or None}


def get_analyst_intel(ticker, current_price=None, debug=False):
    ticker = (ticker or "").upper().strip()
    if not ticker:
        return {"ticker": "", "consensus": None, "price_target": None, "recent_actions": []}
    ckey = f"analyst_intel::{ticker}"
    if not debug:
        hit = cache.get(ckey)
        if hit is not None:
            return hit

    src = "fmp"
    consensus = _fmp_consensus(ticker)
    pt = _fmp_price_target(ticker)
    actions = _fmp_recent_actions(ticker)
    if consensus is None or pt is None:
        intel = ee.get_earnings_intel(ticker)
        if consensus is None:
            consensus = _finnhub_consensus(intel)
            src = "finnhub" if consensus else src
        if pt is None:
            pt = _finnhub_pt(intel)
            src = "finnhub" if pt else src

    if pt and pt.get("avg") and current_price:
        try:
            pt["current"] = _round(current_price, 2)
            pt["upside_pct"] = _round((pt["avg"] - current_price) / current_price * 100)
        except Exception:
            pass

    result = {"ticker": ticker, "consensus": consensus, "price_target": pt, "recent_actions": actions or []}
    if debug:
        result["_source"] = src
        return result
    cache.set(ckey, result, _TTL)
    return result
