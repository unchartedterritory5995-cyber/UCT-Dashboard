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


# ─── space-aware accessors ───────────────────────────────────────────────────
#
# ⛔⛔ WHY THESE EXIST BESIDE `line_at` RATHER THAN REPLACING IT.
# `fit_trendline(log_space=True)` fits log(price) and exponentiates only the
# ENDPOINTS back into price. The fitted curve between them is exponential, so
# `line_at` — which interpolates linearly between p1 and p2 — reads a CHORD off
# it, exact at the endpoints and wrong everywhere in between. That is invisible:
# the two agree at exactly the two points a spot-check would test.
#
# `line_at`'s semantics are NOT changed in place because ten detector modules
# call it, including ones that never asked for log space (head_shoulders,
# inverse_head_shoulders, major_trendlines). Changing it would silently move
# detectors that made no such request. Instead these accessors take the whole
# `Trendline` — which carries its own `space` — and dispatch on it. For a
# price-space line they are bit-for-bit `line_at` / `line_intersect`, by
# delegation, not by re-derivation.


def _space_of(line: dict) -> str:
    """The space a Trendline was fitted in; absent means "price".

    A hand-built line (a synthesized flat boundary, say) has always been in
    price space and stays that way without needing to be edited.
    """
    return line.get("space") or "price"


def price_at(line: dict, t: float) -> float:
    """Price ON the fitted line at time `t`, respecting the line's space.

    ⛔ USE THIS, NOT `line_at`, FOR ANY LINE THAT MIGHT BE LOG-FITTED. For a
    price-space line this delegates to `line_at` and is identical to it. For a
    log-fitted line it reads the EXPONENTIAL through the endpoints:

        price(t) = p1 * (p2 / p1) ** ((t - t1) / (t2 - t1))

    which is the curve that was actually fitted, not the chord across it.

    A log-space line whose endpoints are non-positive is the unusable line
    `fit_trendline` returns when asked for log space on a series containing a
    non-positive price (`validity == 0.0`, every field zeroed). It has no
    logarithm and therefore no price anywhere; this returns 0.0, which every
    caller's existing `<= 0` guard already rejects. Reaching that value means a
    caller skipped the validity check, not that the line has a price of zero.
    """
    p1, p2 = line["p1"], line["p2"]
    if _space_of(line) != "log":
        return line_at((p1, p2), t)

    dt = p2["t"] - p1["t"]
    if dt == 0:
        return p1["price"]
    if p1["price"] <= 0 or p2["price"] <= 0:
        return 0.0
    log_slope = (math.log(p2["price"]) - math.log(p1["price"])) / dt
    return math.exp(math.log(p1["price"]) + log_slope * (t - p1["t"]))


def fractional_slope(line: dict, reference_price: float) -> float:
    """The line's slope as a FRACTION OF PRICE PER BAR — the same unit in both
    spaces, so a threshold expressed in that unit is scale-correct.

    A log-space slope IS d(log price)/dt, i.e. already a fractional growth rate
    per bar (0.01 == +1%/bar), so it is returned unchanged. A price-space slope
    is dollars per bar and is divided by `reference_price` to reach the same
    unit. `reference_price <= 0` yields 0.0 rather than a division blow-up; a
    caller with no positive reference price has no scale to normalise against.

    ⛔ THE POINT IS THE UNIT, NOT THE CONVENIENCE. `abs(slope) < k * price` and
    `abs(slope) / price < k` are the same test only while `slope` is in dollars.
    Against a log slope the first is ~1/price times too permissive — for a $100
    stock, ~100x — which is how a threshold meant to catch flat lines came to
    call every line flat.
    """
    if _space_of(line) == "log":
        return float(line["slope"])
    if reference_price <= 0:
        return 0.0
    return float(line["slope"]) / reference_price


def intersect_at(line_a: dict, line_b: dict) -> Optional[Point]:
    """Where two fitted lines cross, respecting the space they were fitted in.

    For two price-space lines this delegates to `line_intersect` and is
    identical to it. For two log-fitted lines the crossing is solved where the
    lines are actually STRAIGHT — in log space — and the returned `price` is
    exponentiated back. Solving it on the price-space chords instead answers a
    different question and puts the apex at the wrong bar.

    Raises:
      ValueError: if the two lines were fitted in different spaces. There is no
        meaningful crossing of a straight line and an exponential drawn from
        the same endpoints without deciding which curve is real, and no call
        site does that: every caller passes two lines produced by one fitting
        step. A silent None here would report "no pattern" for a programming
        error, which is the failure mode this engine keeps paying for.
    """
    space_a, space_b = _space_of(line_a), _space_of(line_b)
    if space_a != space_b:
        raise ValueError(
            f"cannot intersect a {space_a}-space line with a {space_b}-space "
            f"one: the two describe different curves through their endpoints")

    if space_a != "log":
        return line_intersect((line_a["p1"], line_a["p2"]),
                              (line_b["p1"], line_b["p2"]))

    for line in (line_a, line_b):
        if line["p1"]["price"] <= 0 or line["p2"]["price"] <= 0:
            return None      # the unusable all-zero line; nothing to cross

    def _to_log(line: dict) -> Line:
        return ({"t": line["p1"]["t"], "price": math.log(line["p1"]["price"])},
                {"t": line["p2"]["t"], "price": math.log(line["p2"]["price"])})

    hit = line_intersect(_to_log(line_a), _to_log(line_b))
    if hit is None:
        return None
    return {"t": hit["t"], "price": math.exp(hit["price"])}


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
