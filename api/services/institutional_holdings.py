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


# ── 13F ownership with position-change deltas (FMP Ultimate first) ──────────
_OWN_TTL = 21_600  # 6h


def _classify_change(cur, prior):
    """new / added / reduced / sold_out / flat from current vs prior shares."""
    c = cur or 0
    p = prior
    if p is None or p == 0:
        return "new" if c > 0 else "flat"
    if c == 0:
        return "sold_out"
    if c > p:
        return "added"
    if c < p:
        return "reduced"
    return "flat"


_Q_END_MONTH_DAY = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}


def _recent_13f_quarters(now=None, tries=3, filing_buffer_days=50):
    """(year, quarter) pairs to try, most-likely-COMPLETE quarter first.

    13F filings are due 45 calendar days after quarter-end, and filers
    trickle in right up to that deadline — a quarter whose deadline hasn't
    passed yet has data from early filers only (small/foreign funds), NOT
    the real top-holders list (BlackRock/Vanguard-scale filers file late).
    Skip any quarter whose deadline + buffer hasn't passed."""
    from datetime import UTC, datetime, timedelta
    now = now or datetime.now(UTC)
    q = (now.month - 1) // 3 + 1
    y = now.year
    candidates = []
    for _ in range(tries + 3):
        m, d = _Q_END_MONTH_DAY[q]
        candidates.append((y, q, datetime(y, m, d, tzinfo=UTC)))
        q -= 1
        if q == 0:
            q, y = 4, y - 1
    filed = [(yy, qq) for yy, qq, end in candidates if now >= end + timedelta(days=filing_buffer_days)]
    return filed[:tries] if filed else [(candidates[-1][0], candidates[-1][1])]


def _fmp_ownership(ticker):
    """FMP Ultimate per-holder 13F ownership + deltas.
    /stable/institutional-ownership/symbol-ownership 404s (not a real FMP
    path) — the real per-holder endpoint is
    /stable/institutional-ownership/extract-analytics/holder, which requires
    year+quarter (see _recent_13f_quarters). Field is `ownership`, NOT
    `ownershipPercent`. Returns [] on any failure."""
    from api.services import earnings_estimates as ee
    for year, quarter in _recent_13f_quarters():
        try:
            data = ee._fmp_get("/stable/institutional-ownership/extract-analytics/holder",
                               {"symbol": ticker, "year": year, "quarter": quarter, "limit": 20})
        except Exception:
            continue
        rows = data if isinstance(data, list) else []
        out = []
        for r in rows:
            out.append({
                "holder": r.get("investorName") or r.get("holder"),
                "shares": r.get("sharesNumber") or r.get("shares"),
                "prior_shares": r.get("lastSharesNumber") or r.get("prior_shares"),
                "pct_out": r.get("ownership") if r.get("ownership") is not None else r.get("pct_out"),
                "value": r.get("marketValue") or r.get("value"),
                "date": str(r.get("date") or "")[:10] or None,
            })
        out = [r for r in out if r.get("holder")]
        if out:
            return out
    return []


def get_ownership(ticker, debug=False):
    """Top institutional holders + position-change deltas (new/added/reduced/
    sold_out) + biggest buyers/sellers. FMP first, yfinance fallback (no deltas)."""
    ticker = (ticker or "").upper().strip()
    empty = {"ticker": ticker, "inst_pct": None, "inst_holders_count": None, "as_of": None,
             "top_holders": [], "biggest_buyers": [], "biggest_sellers": []}
    if not ticker:
        return empty
    ckey = f"ownership::{ticker}"
    if not debug:
        hit = _CACHE.get(ckey)
        if hit is not None:
            return dict(hit)

    rows = _fmp_ownership(ticker)
    if rows:
        holders = []
        for r in rows:
            shares = r.get("shares")
            prior = r.get("prior_shares")
            ch = _classify_change(shares, prior)
            holders.append({"holder": r["holder"], "shares": shares, "pct_out": r.get("pct_out"),
                            "value": r.get("value"), "change": ch,
                            "change_shares": (None if shares is None or prior is None else shares - prior)})
        holders.sort(key=lambda h: (h.get("shares") or 0), reverse=True)
        deltas = [h for h in holders if h.get("change_shares") is not None]
        buyers = sorted([h for h in deltas if h["change_shares"] > 0], key=lambda h: h["change_shares"], reverse=True)[:5]
        sellers = sorted([h for h in deltas if h["change_shares"] < 0], key=lambda h: h["change_shares"])[:5]
        as_of = next((r.get("date") for r in rows if r.get("date")), None)
        result = {"ticker": ticker, "inst_pct": None, "inst_holders_count": len(holders),
                  "as_of": as_of, "top_holders": holders[:15],
                  "biggest_buyers": buyers, "biggest_sellers": sellers, "_source": "fmp"}
    else:
        yf_data = get_institutional_holders(ticker, top_n=15) or {}
        raw = yf_data.get("top_holders") or []
        if ("error" in yf_data) and not raw:
            result = dict(empty, **{"_source": "yfinance"})
        else:
            holders = [{"holder": h.get("holder"), "shares": h.get("shares"), "pct_out": h.get("pct_out"),
                        "value": h.get("value_usd") if h.get("value_usd") is not None else h.get("value"),
                        "change": None, "change_shares": None} for h in raw]
            as_of = next((h.get("date_reported") for h in raw if h.get("date_reported")), None)
            result = {"ticker": ticker, "inst_pct": yf_data.get("held_by_institutions_pct"),
                      "inst_holders_count": yf_data.get("top_holders_count") or len(holders),
                      "as_of": as_of, "top_holders": holders,
                      "biggest_buyers": [], "biggest_sellers": [], "_source": "yfinance"}

    if debug:
        return result
    out = {k: v for k, v in result.items() if k != "_source"}
    _CACHE.set(ckey, dict(out), _OWN_TTL)
    return out
