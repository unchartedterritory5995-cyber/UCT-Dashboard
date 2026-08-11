"""Phase 2 — survivorship-free point-in-time breadth universe (core selection).

Phase 1 reconstructed deep breadth over TODAY's ~2,657 names → survivorship bias
(names that later went to zero are absent, so old-year breadth reads too strong).
Phase 2 selects, for each past day, the universe that ACTUALLY existed then —
delisted names included — from the survivorship-free grouped-daily market frame,
filtered to common stock + a price/liquidity proxy for "investable."

This file is the PURE selection + the calibration metric. The grouped-daily /
reference-ticker fetch, the whole-market frame, the worker sweep, and the R2 bridge
are the surrounding plumbing (extend the Phase-1 shape); those need live Massive
data and run on the worker. The selection logic and the go/no-go calibration math
live here so they are unit-provable offline.

⭐ The price/liquidity thresholds are an APPROXIMATION of the cap filter we can't
reproduce historically (no clean shares-outstanding). They MUST be calibrated so the
proxy reproduces the collector's KNOWN recent `universe_list` before any backfill —
`compare_universe()` is that gate. See
docs/superpowers/specs/2026-08-11-breadth-survivorship-free-universe-phase2-design.md
"""
from __future__ import annotations

from typing import Optional

# Defaults; the sweep/calibration layer overrides after a threshold sweep (§5).
DEFAULT_PRICE_MIN = 5.0
DEFAULT_DOLLARVOL_MIN = 1_000_000.0    # trailing median close·volume


def is_common_stock(ref: Optional[dict]) -> bool:
    """Breadth is US common stock — not ETF/ADR/warrant/unit/right. `type == 'CS'`
    from /v3/reference/tickers. Unknown/absent ref → not eligible (conservative)."""
    return bool(ref) and ref.get("type") == "CS"


def _date10(v) -> Optional[str]:
    """YYYY-MM-DD prefix of a date/datetime string, else None."""
    if not v:
        return None
    s = str(v)
    return s[:10] if len(s) >= 10 else None


def active_on(ref: Optional[dict], date: str) -> bool:
    """Was this security listed and not-yet-delisted on `date`?
    `list_date ≤ date ≤ delisted_utc` (delisted_utc None = still active). Missing
    list_date is treated as 'listed before our data' (don't exclude on absence)."""
    if not ref:
        return False
    ld = _date10(ref.get("list_date"))
    if ld and date < ld:
        return False
    du = _date10(ref.get("delisted_utc"))
    if du and date > du:
        return False
    return True


def eligible(date: str, day_rows: dict, ref_map: dict,
             price_min: float = DEFAULT_PRICE_MIN,
             dollarvol_min: float = DEFAULT_DOLLARVOL_MIN) -> set:
    """The point-in-time investable universe for `date`.

    `day_rows`: {ticker: {"c": close, "dv": trailing-median dollar-volume}} from the
                survivorship-free grouped-daily frame (delisted names included).
    `ref_map` : {ticker: reference dict with type/list_date/delisted_utc}.
    Returns the set of eligible tickers: common stock, active on `date`, above the
    price floor, above the liquidity floor. Never raises on a malformed row."""
    out: set = set()
    for t, m in (day_rows or {}).items():
        ref = ref_map.get(t)
        if not is_common_stock(ref) or not active_on(ref, date):
            continue
        try:
            c = m.get("c")
            dv = m.get("dv")
        except AttributeError:
            continue
        if c is None or c < price_min:
            continue
        if dv is None or dv < dollarvol_min:
            continue
        out.add(t)
    return out


def compare_universe(proxy: set, actual: set) -> dict:
    """The go/no-go calibration metric: how well does the proxy universe reproduce
    the collector's KNOWN `universe_list`? precision/recall/Jaccard + sizes. The
    threshold sweep maximizes Jaccard; the phase proceeds only if the BEST
    achievable overlap is high (target Jaccard ≥ ~0.9). Empty `actual` → jaccard 1.0
    only when proxy is also empty (avoids a false pass)."""
    proxy, actual = set(proxy or ()), set(actual or ())
    tp = len(proxy & actual)
    union = len(proxy | actual)
    return {
        "precision": round(tp / len(proxy), 4) if proxy else 0.0,
        "recall": round(tp / len(actual), 4) if actual else 0.0,
        "jaccard": round(tp / union, 4) if union else 1.0,
        "proxy_size": len(proxy),
        "actual_size": len(actual),
        "size_delta": len(proxy) - len(actual),
        "only_in_proxy": sorted(proxy - actual)[:25],
        "only_in_actual": sorted(actual - proxy)[:25],
    }
