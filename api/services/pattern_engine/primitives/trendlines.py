"""Trendline fitting from a set of pivots.

Uses least-squares regression. Returns a `Trendline` typed dict with:
  - p1, p2: endpoint anchors (the first and last pivots, projected onto the fitted line)
  - slope: price-per-unit-t
  - r_squared: 0-1 fit quality
  - touches: number of input pivots within a small distance of the line
  - validity: composite 0-1 score (r² weighted with touches count)
"""
from __future__ import annotations

from typing import List, Tuple

from api.services.pattern_engine.types import Pivot, Trendline


def fit_trendline(pivots: List[Pivot], touch_tolerance_pct: float = 0.5) -> Trendline:
    """Fit a least-squares line to the pivots' (t, price) points.

    Args:
      pivots: ≥2 pivots
      touch_tolerance_pct: percentage of fitted price within which a pivot counts as a "touch"

    Returns:
      Trendline dict; validity is min(r², touches/4) for a soft cap on weak lines.

    Raises:
      ValueError: if fewer than 2 pivots.
    """
    if len(pivots) < 2:
        raise ValueError("need at least 2 pivots to fit a trendline")

    ts     = [float(p["t"]) for p in pivots]
    prices = [float(p["price"]) for p in pivots]
    n = len(pivots)

    mean_t  = sum(ts) / n
    mean_p  = sum(prices) / n

    num = sum((t - mean_t) * (p - mean_p) for t, p in zip(ts, prices))
    den = sum((t - mean_t) ** 2 for t in ts)
    slope = (num / den) if den != 0 else 0.0
    intercept = mean_p - slope * mean_t

    # R² (coefficient of determination)
    ss_total = sum((p - mean_p) ** 2 for p in prices)
    ss_res   = sum((p - (slope * t + intercept)) ** 2 for t, p in zip(ts, prices))
    r_squared = (1.0 - ss_res / ss_total) if ss_total > 0 else 1.0
    r_squared = max(0.0, min(1.0, r_squared))

    # Count touches: pivots within tolerance% of fitted price
    touches = 0
    for t, p in zip(ts, prices):
        expected = slope * t + intercept
        if expected <= 0:
            continue
        if abs(p - expected) / expected * 100 <= touch_tolerance_pct:
            touches += 1

    # Endpoints projected onto fitted line
    t_start, t_end = ts[0], ts[-1]
    p_start = slope * t_start + intercept
    p_end   = slope * t_end   + intercept

    # Validity: r² weighted with touch count (4+ touches uncaps)
    validity = min(r_squared, touches / 4.0) if touches < 4 else r_squared

    return {
        "p1": {"t": int(t_start), "price": float(p_start)},
        "p2": {"t": int(t_end),   "price": float(p_end)},
        "slope": float(slope),
        "r_squared": float(r_squared),
        "touches": int(touches),
        "validity": float(validity),
    }


def fit_pair_parallel(upper_pivots: List[Pivot], lower_pivots: List[Pivot]) -> Tuple[Trendline, Trendline]:
    """Fit two trendlines from upper and lower pivot sets (no parallelism enforcement).

    Caller decides whether the resulting pair is parallel-enough for their
    pattern (use `geometry.parallel_score`). This function just fits each
    independently — that's why it's "fit_pair" not "fit_parallel_pair".
    """
    upper = fit_trendline(upper_pivots)
    lower = fit_trendline(lower_pivots)
    return upper, lower
