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


def polynomial_fit(xs: list[float], ys: list[float], degree: int) -> list[float]:
    """Fit a polynomial of given degree; returns coefficients [c_n, ..., c_1, c_0].

    Uses numpy.polyfit internally. Same convention as numpy: highest-degree first.
    """
    import numpy as np
    coeffs = np.polyfit(xs, ys, degree)
    return [float(c) for c in coeffs]
