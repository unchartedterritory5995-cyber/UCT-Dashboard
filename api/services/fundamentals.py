"""Fundamentals service for voice Compass — financial metrics + ratios + peer comp.

Wraps yfinance (free). Returns a compact, voice-friendly summary instead
of yfinance's huge raw dicts. Cached so repeated lookups in a session are
sub-millisecond.
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any

import yfinance as yf

from api.services.cache import TTLCache

_log = logging.getLogger(__name__)

_CACHE = TTLCache()
_CACHE_TTL = 1800  # 30 min


def _fmt_billions(v) -> str | None:
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if abs(n) >= 1e12:
        return f"${n / 1e12:.2f}T"
    if abs(n) >= 1e9:
        return f"${n / 1e9:.2f}B"
    if abs(n) >= 1e6:
        return f"${n / 1e6:.0f}M"
    return f"${n:,.0f}"


def _round_pct(v, digits: int = 1) -> float | None:
    try:
        return round(float(v) * 100.0, digits)
    except (TypeError, ValueError):
        return None


def _round(v, digits: int = 2) -> float | None:
    try:
        return round(float(v), digits)
    except (TypeError, ValueError):
        return None


def _next_earnings_iso(info: dict) -> str | None:
    """Earliest FUTURE earnings date (ISO YYYY-MM-DD) from yfinance .info unix
    timestamps. Returns None if no upcoming date is known."""
    now = time.time()
    cands = []
    for k in ("earningsTimestampStart", "earningsTimestamp", "earningsTimestampEnd"):
        ts = info.get(k)
        try:
            ts = float(ts)
        except (TypeError, ValueError):
            continue
        # allow a small past window (today) so same-day reporters still show
        if ts >= now - 86400:
            cands.append(ts)
    if not cands:
        return None
    try:
        return datetime.fromtimestamp(min(cands), tz=timezone.utc).strftime("%Y-%m-%d")
    except (OverflowError, OSError, ValueError):
        return None


def get_fundamentals(ticker: str) -> dict[str, Any]:
    """Compact fundamentals summary for a ticker."""
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"error": "ticker required"}
    cache_key = f"fund::{sym}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return dict(cached)

    # yfinance `.info` is its slowest / most hang-prone call and has no timeout;
    # bound it so a stalled Yahoo response can't pin a worker thread forever.
    try:
        from api.services.yf_util import bounded_call
        info = bounded_call(lambda: yf.Ticker(sym).info, None) or {}
    except Exception as e:
        _log.warning("yfinance fundamentals failed for %s: %s", sym, e)
        err = {"error": f"yfinance failed: {e}", "ticker": sym}
        # Negative-cache briefly: a dead/renamed ticker in someone's journal
        # would otherwise re-submit to the bounded yfinance pool (12s wall)
        # on EVERY request, crowding out good tickers.
        _CACHE.set(cache_key, err, ttl=300)
        return err

    if not info or not info.get("symbol"):
        err = {"error": "no fundamentals available", "ticker": sym}
        _CACHE.set(cache_key, err, ttl=300)
        return err

    result = {
        "ticker": sym,
        "name": info.get("longName") or info.get("shortName") or sym,
        "sector": info.get("sector"),
        "industry": info.get("industry"),
        "about": info.get("longBusinessSummary"),
        # Valuation
        "market_cap": _fmt_billions(info.get("marketCap")),
        "enterprise_value": _fmt_billions(info.get("enterpriseValue")),
        "pe_trailing": _round(info.get("trailingPE")),
        "pe_forward": _round(info.get("forwardPE")),
        "peg": _round(info.get("trailingPegRatio")),
        "ps": _round(info.get("priceToSalesTrailing12Months")),
        "pb": _round(info.get("priceToBook")),
        "ev_to_revenue": _round(info.get("enterpriseToRevenue")),
        "ev_to_ebitda": _round(info.get("enterpriseToEbitda")),
        # Profitability
        "gross_margin_pct": _round_pct(info.get("grossMargins")),
        "operating_margin_pct": _round_pct(info.get("operatingMargins")),
        "profit_margin_pct": _round_pct(info.get("profitMargins")),
        "roe_pct": _round_pct(info.get("returnOnEquity")),
        "roa_pct": _round_pct(info.get("returnOnAssets")),
        # Growth
        "revenue_growth_pct": _round_pct(info.get("revenueGrowth")),
        "earnings_growth_pct": _round_pct(info.get("earningsGrowth")),
        # Balance sheet
        "total_revenue": _fmt_billions(info.get("totalRevenue")),
        "ebitda": _fmt_billions(info.get("ebitda")),
        "free_cash_flow": _fmt_billions(info.get("freeCashflow")),
        "total_cash": _fmt_billions(info.get("totalCash")),
        "total_debt": _fmt_billions(info.get("totalDebt")),
        "debt_to_equity": _round(info.get("debtToEquity")),
        "current_ratio": _round(info.get("currentRatio")),
        # Yield / shareholder return
        # yfinance changed `dividendYield` semantics: it is now ALREADY a
        # percent (AAPL → 0.37 meaning 0.37%), so no ×100. The old ×100 path
        # displayed "37%" product-wide. `trailingAnnualDividendYield` is still
        # a ratio → keep _round_pct for the fallback.
        "dividend_yield_pct": (
            _round(info.get("dividendYield"), 2)
            if info.get("dividendYield") is not None
            else _round_pct(info.get("trailingAnnualDividendYield"))
        ),
        "payout_ratio_pct": _round_pct(info.get("payoutRatio")),
        # Ownership (free from the same .info call — feeds ratings sponsorship percentile)
        "held_pct_institutions": _round_pct(info.get("heldPercentInstitutions")),
        # Price action context
        "fifty_two_week_high": _round(info.get("fiftyTwoWeekHigh")),
        "fifty_two_week_low": _round(info.get("fiftyTwoWeekLow")),
        "fifty_day_avg": _round(info.get("fiftyDayAverage")),
        "two_hundred_day_avg": _round(info.get("twoHundredDayAverage")),
        "beta": _round(info.get("beta")),
        # Analyst
        "analyst_target_mean": _round(info.get("targetMeanPrice")),
        "analyst_recommendation": info.get("recommendationKey"),
        "analyst_count": info.get("numberOfAnalystOpinions"),
        # Next earnings (free from .info) — surfaced in the snapshot header
        "next_earnings": _next_earnings_iso(info),
    }
    _CACHE.set(cache_key, dict(result), _CACHE_TTL)
    return result


def compare_fundamentals(tickers: list[str]) -> dict[str, Any]:
    """Side-by-side fundamentals for 2-6 tickers (peer comp). Returns
    each ticker's compact summary plus the metric ranges across the set."""
    if not tickers:
        return {"error": "no tickers provided"}
    tickers = [t.upper().strip() for t in tickers if t and t.strip()][:6]
    if len(tickers) < 2:
        return {"error": "need at least 2 tickers for peer comp"}

    # Parallelize the peer set — each get_fundamentals is now internally bounded,
    # so up to 6 tickers resolve concurrently instead of sequentially.
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(len(tickers), 6)) as ex:
        rows = list(ex.map(get_fundamentals, tickers))
    rows = [r for r in rows if "error" not in r]
    if not rows:
        return {"error": "no fundamentals available for any ticker"}

    # Compute simple cross-ticker ranges on the most useful comparison metrics
    keys = ["pe_trailing", "pe_forward", "ps", "pb", "profit_margin_pct",
            "roe_pct", "revenue_growth_pct", "debt_to_equity"]
    ranges: dict[str, dict[str, Any]] = {}
    for k in keys:
        vals = [(r["ticker"], r.get(k)) for r in rows if isinstance(r.get(k), (int, float))]
        if len(vals) < 2:
            continue
        vals.sort(key=lambda v: v[1])
        ranges[k] = {
            "min": {"ticker": vals[0][0], "value": vals[0][1]},
            "max": {"ticker": vals[-1][0], "value": vals[-1][1]},
        }
    return {"tickers": [r["ticker"] for r in rows], "rows": rows, "ranges": ranges}
