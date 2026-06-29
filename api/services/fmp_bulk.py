"""FMP Ultimate BULK fundamentals — one pull for the whole market, mapped to the
same keys api.services.fundamentals.get_fundamentals returns, so the nightly
ratings gather can read it in place of a per-ticker yfinance call. Optimization
layer only: returns {} on any failure so callers fall back to per-ticker."""
from __future__ import annotations

import logging
import time

from api.services import earnings_estimates as ee

_log = logging.getLogger(__name__)
_CACHE: dict = {}
_CACHE_DAY: str | None = None


def _pct(v):
    try:
        return round(float(v) * 100.0, 1)
    except (TypeError, ValueError):
        return None


def _num(v):
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return None


def _fmp_bulk_rows() -> list[dict]:
    """Raw bulk rows merged by symbol (ratios + key-metrics + profile bulk).
    Exact endpoint path/format verified live; returns [] on failure."""
    try:
        rows = ee._fmp_get("/stable/ratios-bulk", {})
    except Exception as e:
        _log.warning("fmp ratios-bulk failed: %s", e)
        return []
    return rows if isinstance(rows, list) else []


def fetch_fundamentals_bulk(force=False) -> dict:
    """{SYM: {earnings_growth_pct, revenue_growth_pct, peg, pe_forward,
    operating_margin_pct, roe_pct, held_pct_institutions, sector}} — the exact
    keys ratings_universe._compute_one reads from get_fundamentals. {} on failure."""
    global _CACHE, _CACHE_DAY
    day = time.strftime("%Y-%m-%d", time.gmtime())
    if not force and _CACHE_DAY == day and _CACHE:
        return _CACHE
    try:
        rows = _fmp_bulk_rows()
    except Exception as e:
        _log.warning("fmp bulk fetch failed: %s", e)
        rows = []
    out: dict[str, dict] = {}
    for r in rows:
        sym = str(r.get("symbol") or "").upper()
        if not sym:
            continue
        out[sym] = {
            "earnings_growth_pct": _pct(r.get("growthNetIncome") or r.get("netIncomeGrowth")),
            "revenue_growth_pct": _pct(r.get("growthRevenue") or r.get("revenueGrowth")),
            "peg": _num(r.get("priceEarningsToGrowthRatio") or r.get("pegRatio")),
            "pe_forward": _num(r.get("forwardPE")),
            "operating_margin_pct": _pct(r.get("operatingProfitMargin")),
            "roe_pct": _pct(r.get("returnOnEquity")),
            "held_pct_institutions": _pct(r.get("heldPercentInstitutions")),
            "sector": r.get("sector"),
        }
    if out:
        _CACHE, _CACHE_DAY = out, day
    return out
