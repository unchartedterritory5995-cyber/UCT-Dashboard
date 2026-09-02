"""Trendline fitting from a set of pivots.

Uses least-squares regression. Returns a `Trendline` typed dict with:
  - p1, p2: endpoint anchors (the first and last pivots, projected onto the fitted line)
  - slope: price-per-unit-t in price space; log-units-per-t in log space
  - space: "price" | "log" — which of those two the line above is
  - r_squared: 0-1 fit quality
  - touches: number of input pivots within a small distance of the line
  - validity: composite 0-1 score (r² weighted with touches count)
"""
from __future__ import annotations

import math
from typing import List, Tuple

from api.services.pattern_engine.types import Pivot, Trendline


def _empty_trendline() -> Trendline:
    """An unusable line.

    Returned ONLY when log-space is requested on data that has no logarithm.
    It is NOT a general error path: `fit_trendline` still raises on fewer
    than 2 pivots and existing callers depend on that. `validity: 0.0` is the
    caller's signal to discard; every numeric field is zeroed rather than
    left absent so the TypedDict stays total.
    """
    return {
        "p1": {"t": 0, "price": 0.0},
        "p2": {"t": 0, "price": 0.0},
        "slope": 0.0,
        "r_squared": 0.0,
        "touches": 0,
        "validity": 0.0,
        # It records the space it was ASKED for, so a reader inspecting units
        # gets a consistent answer. `geometry.price_at` reads 0.0 off it
        # (there is no logarithm of a non-positive price), which every
        # caller's `<= 0` guard already rejects.
        "space": "log",
    }


def fit_trendline(pivots: List[Pivot], touch_tolerance_pct: float = 0.5,
                  log_space: bool = False) -> Trendline:
    """Fit a least-squares line to the pivots' (t, price) points.

    ⛔ PASS `log_space=True` FOR ANY CONVERGENCE OR DIVERGENCE JUDGEMENT.
    Edwards & Magee: a constant-percentage decline converges in POINTS by
    construction (a 5% drop from 100 is 5 points, from 50 it is 2.5), so an
    arithmetic fit reports a falling wedge on essentially any sustained
    uniform downtrend. They prescribe log-space fitting; Murphy gives no
    scaling caveat at all, which is why the arithmetic version is the one
    that propagated into every implementation including this one.
    Source: docs/superpowers/research/bases/06-edwards-magee-murphy-canon.md

    The default stays `False` so every existing caller is byte-for-byte
    unchanged; wedge, triangle and channel detectors must opt in.

    ⚠️ With `log_space=True` the returned `slope` stays in LOG UNITS per unit
    `t` — a fractional-growth rate, which is exactly the quantity a
    convergence test needs. Only `p1`/`p2` are exponentiated back into price
    space, for drawing.

    ⛔ THE RETURNED LINE CARRIES `space` ("price" or "log"), and reading it is
    not optional. Take prices off the line with `geometry.price_at`, crossings
    with `geometry.intersect_at`, and compare a slope against a threshold only
    after `geometry.fractional_slope` has put both in the same unit.
    `geometry.line_at` is unconditionally linear and reads a CHORD off a
    log-fitted line — exact at the two endpoints, wrong everywhere between
    them, which is precisely where a width or depth is measured.

    Args:
      pivots: ≥2 pivots
      touch_tolerance_pct: percentage of fitted PRICE within which a pivot counts
        as a "touch" - and it stays a percentage of price under `log_space`,
        which took a deliberate branch in `_fit_arithmetic` to be true
      log_space: fit on log(price) instead of price

    Returns:
      Trendline dict tagged with `space`; validity is min(r², touches/4) for a
      soft cap on weak lines.
      An all-zero Trendline with `validity == 0.0` when `log_space` is requested
      on a series containing a non-positive price.

    Raises:
      ValueError: if fewer than 2 pivots.
    """
    if len(pivots) < 2:
        raise ValueError("need at least 2 pivots to fit a trendline")

    if log_space:
        if any((p.get("price") or 0) <= 0 for p in pivots):
            # log(x <= 0) is undefined. A fabricated slope here would be a
            # confident wrong answer; an unusable line is the honest one.
            return _empty_trendline()
        pivots = [{**p, "price": math.log(float(p["price"]))} for p in pivots]

    line = _fit_arithmetic(pivots, touch_tolerance_pct,
                           values_are_logs=log_space)

    if log_space:
        line = {
            **line,
            "p1": {**line["p1"], "price": float(math.exp(line["p1"]["price"]))},
            "p2": {**line["p2"], "price": float(math.exp(line["p2"]["price"]))},
            # ⛔ THE TAG IS THE CONTRACT. `slope` is now log-units per bar and
            # the curve between p1 and p2 is exponential; every downstream
            # reader needs to know that, and asking it to remember is how the
            # four unit defects below got shipped in the first place.
            "space": "log",
        }
    else:
        line = {**line, "space": "price"}
    return line


def _fit_arithmetic(pivots: List[Pivot], touch_tolerance_pct: float = 0.5,
                    *, values_are_logs: bool = False) -> Trendline:
    """The least-squares fit itself, in whatever space the caller hands it.

    Extracted from `fit_trendline` verbatim — do not change its arithmetic
    here; that would silently move every existing caller's answer. The one
    addition since is `values_are_logs`, which is OFF by default and touches
    nothing but the touch test, so the default path is still that verbatim
    arithmetic.

    ⛔⛔ WHY `values_are_logs` EXISTS, MEASURED 2026-09-01. `touch_tolerance_pct`
    is documented as "within tolerance% of the fitted PRICE", and the price
    branch computes exactly that. Handed logarithms, the SAME formula computes
    `|dlog| / log(price) * 100` — a percentage of a LOGARITHM. The fractional
    price deviation it then admits is `tol% x log(price)`, so the gate:

      - is ~4.6x too loose on a $100 stock and ~6.9x on a $1000 one
        (measured: a pivot 3% off the fitted line counts as a "touch" at $1000
        under a 0.5% tolerance), and
      - SCALES WITH PRICE, which a tolerance must never do, and
      - refuses every touch outright below $1, where `log(price) <= 0` trips
        the `expected <= 0` guard and `continue`s past the check.

    `touches` is not cosmetic: detectors gate on it directly (`_MIN_TOUCHES`)
    and `validity` is `min(r_squared, touches / 4)`, so an inflated count walks
    straight through two gates. On 744 tickers this alone was the FIRST refusal
    that log space lifted for 114 of the 117 channels it newly admitted — the
    bulk of a 14x move that would otherwise read as a geometry finding.
    """
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
        if values_are_logs:
            # `p` and `expected` are LOGARITHMS of prices, and
            # expm1(p - expected) IS `price / fitted_price - 1` exactly. So
            # this is the same "within tolerance% of the fitted price" test as
            # the branch below, computed without leaving log space - not a
            # log-space approximation of it.
            if abs(math.expm1(p - expected)) * 100 <= touch_tolerance_pct:
                touches += 1
            continue
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
