"""Pure geometric helpers — line math, intersection, parallelism, polynomial fit.

All inputs use Anchor-like dicts {"t": int|float, "price": float}.
Time axis treated as a real number (could be a bar index or unix seconds);
all helpers work identically because we never assume a unit.
"""
from __future__ import annotations

import math
from typing import Optional


Point = dict   # Anchor-shaped: {"t": number, "price": number}
Line = tuple[Point, Point]


def slope_angle_deg(p1: Point, p2: Point) -> float:
    """Angle of the line through p1->p2 in degrees, relative to time axis."""
    dt = p2["t"] - p1["t"]
    dp = p2["price"] - p1["price"]
    return math.degrees(math.atan2(dp, dt))


def _slope(line: Line) -> float:
    """Price-per-unit-t slope; returns float('inf') for vertical lines."""
    p1, p2 = line
    dt = p2["t"] - p1["t"]
    if dt == 0:
        return float("inf")
    return (p2["price"] - p1["price"]) / dt


def line_at(line: Line, t: float) -> float:
    """Price on `line` at time `t` (linear extrapolation OK)."""
    p1, p2 = line
    dt = p2["t"] - p1["t"]
    if dt == 0:
        return p1["price"]
    slope = (p2["price"] - p1["price"]) / dt
    return p1["price"] + slope * (t - p1["t"])


def line_intersect(line_a: Line, line_b: Line) -> Optional[Point]:
    """Return intersection point of two lines, or None if parallel.

    Lines are infinite (intersection may lie outside the line segments).
    """
    a1, a2 = line_a
    b1, b2 = line_b
    s_a = _slope(line_a)
    s_b = _slope(line_b)

    if s_a == float("inf") and s_b == float("inf"):
        return None  # both vertical
    if s_a == float("inf"):
        t = a1["t"]
        price = line_at(line_b, t)
        return {"t": t, "price": price}
    if s_b == float("inf"):
        t = b1["t"]
        price = line_at(line_a, t)
        return {"t": t, "price": price}

    if abs(s_a - s_b) < 1e-9:
        return None  # parallel

    t = (s_a * a1["t"] - s_b * b1["t"] + b1["price"] - a1["price"]) / (s_a - s_b)
    price = line_at(line_a, t)
    return {"t": t, "price": price}


def parallel_score(line_a: Line, line_b: Line) -> float:
    """Score 0-1 measuring how parallel the two lines are.

    1.0 = identical slope. 0.0 = opposite directions or one vertical/one not.
    Uses min/max absolute-slope ratio so that, e.g., slope 1 vs slope 3 returns
    1/3 ≈ 0.33 (clearly non-parallel), while identical slopes return 1.0.
    Opposite-sign slopes (one rising, one falling) return 0.0.
    """
    s_a = _slope(line_a)
    s_b = _slope(line_b)
    if s_a == float("inf") and s_b == float("inf"):
        return 1.0
    if s_a == float("inf") or s_b == float("inf"):
        return 0.0
    # Opposite directions are not parallel
    if s_a * s_b < 0:
        return 0.0
    abs_a, abs_b = abs(s_a), abs(s_b)
    if abs_a == 0 and abs_b == 0:
        return 1.0
    if abs_a == 0 or abs_b == 0:
        return 0.0
    return min(abs_a, abs_b) / max(abs_a, abs_b)


def channel_width_parallel_score(
    upper_line: Line,
    lower_line: Line,
    high: float,
    low: float,
) -> float:
    """Channel parallelism via width-preservation ratio.

    Computes channel width at both endpoints and returns
    min(width_left, width_right) / max(width_left, width_right) — score in [0,1].
    A pair of trendlines that maintain constant separation are parallel.

    Robust for near-flat channels where regression slopes can flip sign on noise,
    which makes `parallel_score` unreliable. Use this for channel/flag/wedge
    parallelism checks; use `parallel_score` for general line comparisons.

    Args:
      upper_line, lower_line: Trendline dicts (must have `p1`, `p2` Anchor keys).
      high, low: the actual data envelope (e.g. highest/lowest price in the
                 region) — used as a sanity check to reject lines that drift
                 beyond the data they're supposed to bound.
    """
    u_left  = upper_line["p1"]["price"]
    u_right = upper_line["p2"]["price"]
    l_left  = lower_line["p1"]["price"]
    l_right = lower_line["p2"]["price"]

    width_left  = u_left  - l_left
    width_right = u_right - l_right

    if width_left <= 0 or width_right <= 0:
        return 0.0

    data_range = max(high - low, 1e-9)
    if max(width_left, width_right) > data_range * 2.0:
        return 0.0

    return min(width_left, width_right) / max(width_left, width_right)


def polynomial_fit(xs: list[float], ys: list[float], degree: int) -> list[float]:
    """Fit a polynomial of given degree; returns coefficients [c_n, ..., c_1, c_0].

    Uses numpy.polyfit internally. Same convention as numpy: highest-degree first.
    """
    import numpy as np
    coeffs = np.polyfit(xs, ys, degree)
    return [float(c) for c in coeffs]
