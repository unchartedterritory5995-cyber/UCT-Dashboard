"""Comparisons BETWEEN pivots — roundness, rim equality, symmetry.

⭐ THIS IS THE PRIMITIVE THAT WAS ACTUALLY MISSING. `INDEX_bulkowski_patterns.md`
recorded a correction on 2026-08-10: pivot detection was wrongly blamed as
"the missing primitive" when it was already expressible. What genuinely is
not expressible with pivots alone is cup-with-handle's "U-shaped, not
V-shaped" and "rims near the same price level" — both are comparisons of
SHAPE between pivots, not detections of pivots.

⛔ EVERY FUNCTION HERE RETURNS `None` RATHER THAN A DEFAULT. A shape score
of 0.0 means "measured, and it is a V"; `None` means "not measurable" — a
window too short, a flat series, an out-of-order index. Collapsing those two
is the honest-None rule this repo keeps relearning, most recently as a
synthetic 0.0 expectancy shipping to members as a measurement.

⛔ NO HOUSE PUBLISHES A NUMERIC ROUNDNESS CUTOFF. Bulkowski, O'Neil and
Minervini all describe cup shape in words only ("U-shaped, not V-shaped";
the right side should return "near" the left-side high). So every constant
below is `origin: uct` and every CALLER's threshold must be too. These
functions return continuous scores precisely so the editorial choice lives
at the call site where it can be labelled, rather than being buried here.
"""
from __future__ import annotations

import math
from typing import List, Optional

from api.services.pattern_engine.types import Bar

MIN_SHAPE_BARS = 8

#: Depth (as a fraction of the window's span) at which a bar counts as
#: "near the low". origin: uct.
DEEP_FRACTION = 0.75

#: ⭐ THE TWO CALIBRATION POINTS, AND WHY THEY ARE NOT MEAN DEPTH.
#: The obvious roundness measure — mean depth over the window, normalized by
#: span — CANNOT distinguish the two shapes it exists to separate: a linear V
#: and a raised cosine BOTH have a mean depth of exactly half the span, so
#: both score identically. Verified analytically before this module was
#: written. What actually differs is TIME SPENT NEAR THE LOW, which is also
#: what "U-shaped, not V-shaped" is describing in plain words.
#: A linear V has exactly 25% of its bars at or below `DEEP_FRACTION`; a
#: semicircular cup has ~66%. Those are the 0.0 and 1.0 anchors. origin: uct.
_V_DEEP_FRAC = 0.25
_U_DEEP_FRAC = 0.65

#: Rim gap (in percent) at which equality has decayed to ~1/e. origin: uct.
RIM_DECAY_PCT = 10.0


def roundness(bars: List[Bar], start_idx: int, end_idx: int) -> Optional[float]:
    """How U-shaped is `bars[start_idx:end_idx+1]`? 0.0 = V, 1.0 = rounded cup.

    Measures the fraction of bars sitting at or below `DEEP_FRACTION` of the
    window's span, rescaled so a linear V lands at 0.0 and a semicircular cup
    at 1.0. See `_V_DEEP_FRAC` for why this is not mean depth.

    ⚠️ Shape only. It says nothing about whether the structure is tradeable,
    and no measured performance is attached to it.
    """
    if start_idx < 0 or end_idx < 0 or start_idx >= end_idx:
        return None
    if end_idx >= len(bars):
        return None
    if end_idx - start_idx + 1 < MIN_SHAPE_BARS:
        return None

    window = bars[start_idx:end_idx + 1]
    closes = [b["c"] for b in window if (b.get("c") or 0) > 0]
    if len(closes) < MIN_SHAPE_BARS:
        return None

    rim = max(closes[0], closes[-1])
    low = min(closes)
    span = rim - low
    if span <= 0:
        return None

    threshold = rim - DEEP_FRACTION * span
    deep = sum(1 for c in closes if c <= threshold)
    frac = deep / len(closes)

    scaled = (frac - _V_DEEP_FRAC) / (_U_DEEP_FRAC - _V_DEEP_FRAC)
    return max(0.0, min(1.0, scaled))


def rim_equality(left_price, right_price) -> Optional[float]:
    """1.0 when the two rims match, decaying smoothly as they diverge.

    Symmetric in its arguments: the gap is normalized by the larger price, so
    `rim_equality(a, b) == rim_equality(b, a)`.

    ⚠️ The corpus publishes NO numeric rim tolerance. O'Neil says the right
    side should return "near" the left-side high; Bulkowski's identification
    guidelines say the rims should be "near the same price". Neither
    quantifies it, so this returns a continuous score and lets each caller
    state its own cutoff as `origin: uct`.
    """
    try:
        left = float(left_price)
        right = float(right_price)
    except (TypeError, ValueError):
        return None
    if left <= 0 or right <= 0:
        return None
    gap_pct = abs(left - right) / max(left, right) * 100.0
    return math.exp(-gap_pct / RIM_DECAY_PCT)


def symmetry(bars: List[Bar], start_idx: int, low_idx: int,
             end_idx: int) -> Optional[float]:
    """1.0 when the low sits exactly midway between the two rims.

    Edwards & Magee require rough symmetry for a head-and-shoulders; O'Neil
    prefers a cup whose low is not jammed against one rim. Both describe it
    in words, so this is a continuous score, not a gate.
    """
    if not (start_idx < low_idx < end_idx):
        return None
    if start_idx < 0 or end_idx >= len(bars):
        return None
    left = low_idx - start_idx
    right = end_idx - low_idx
    total = left + right
    if total <= 0:
        return None
    return 1.0 - abs(left - right) / total
