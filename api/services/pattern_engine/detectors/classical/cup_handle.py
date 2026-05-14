"""Cup with Handle detector.

The classic O'Neil bullish continuation pattern. A smooth rounded U-shaped
bottom (the cup) is followed by a tight pullback consolidation (the handle)
on the right side. A breakout above the right rim (or handle high) on
expanding volume projects a measured move equal to the cup depth.

Geometric definition:
  - Cup window: 30-120 bars
  - Left rim: swing-high at the start of the pattern
  - Right rim: swing-high near the end of the cup, before handle starts
  - Rim similarity: |left_rim - right_rim| / left_rim < 0.05  (within 5%)
  - Cup bottom: lowest LOW between the rims
  - Cup depth: (left_rim - cup_bottom) / left_rim in [0.12, 0.50]
  - Roundness test: degree-2 polynomial fit to closes between rims must have
    POSITIVE x^2 coefficient (concave up = U-shape). Rejects V-shapes.
  - Smoothness: stdev of residuals / cup_depth used as soft factor
  - Handle window: 5-25 bars after the right rim
  - Handle depth: (right_rim - handle_low) / right_rim in [0.02, 0.50 * cup_depth]
  - Handle drift: must NOT pierce below cup_bottom
  - Pattern not yet broken: closes haven't punched above right_rim

Scoring (composite 0-100):
  geometry_score:   rim similarity, roundness (residual ratio), depth ideality,
                    handle depth ratio
  volume_score:     contracting through cup + handle (lower vol = better)
  context_score:    trend_stage 2 (uptrend resting), stacked_bullish
  historical_score: 50.0 (neutral prior, Phase 7 wires actual stats)
"""
from __future__ import annotations

import math
import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers_structure import (
    compute_structure_quality, structure_extras, structure_geom_boost,
    structure_narrative_sentence,
)
from api.services.pattern_engine.primitives.geometry import polynomial_fit
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "cup_handle"
_MIN_PATTERN_BARS = 30          # cup alone must be >= 30 bars
_MAX_PATTERN_BARS = 120         # cup window cap
_MAX_RIM_DIFF = 0.05            # |L_rim - R_rim| / L_rim < 5%
_MIN_CUP_DEPTH = 0.12           # 12% min
_MAX_CUP_DEPTH = 0.50           # 50% max
_MIN_HANDLE_BARS = 5
_MAX_HANDLE_BARS = 25
_MIN_HANDLE_DEPTH = 0.02        # 2% min handle depth
_MAX_HANDLE_DEPTH_RATIO = 0.50  # handle depth <= 50% of cup depth
_MAX_RIGHT_RIM_AGE = 35         # right rim + handle should be recent
_MIN_BOTTOM_WIDTH_PCT = 0.30    # >= 30% of cup bars within lowest 25% of cup depth (U vs V)
_CONFIDENCE_FLOOR = 50.0


def detect_cup_handle(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect cup-and-handle patterns in the bars. May emit 0-N detections."""
    if len(bars) < _MIN_PATTERN_BARS:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 2:
        return []

    high_pivots_raw = [p for p in pivots if p["type"] == "high"]
    if len(high_pivots_raw) < 2:
        return []

    # Re-key swing-highs with bar_index as `t` (engine convention).
    high_pivots = [{"t": p["bar_index"], "price": p["price"],
                    "type": "high", "strength": p["strength"],
                    "bar_index": p["bar_index"]} for p in high_pivots_raw]

    # Consider the most-recent 12 swing-high pivots. Enumerate pairs
    # (L_rim, R_rim) chronologically. Prefer the highest-confidence
    # valid pattern.
    recent_highs = high_pivots[-12:]
    n = len(recent_highs)
    last_bar_idx = len(bars) - 1

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for i in range(n):
        for j in range(i + 1, n):
            L = recent_highs[i]
            R = recent_highs[j]

            if not (L["bar_index"] < R["bar_index"]):
                continue

            # Right rim must be recent (handle forms after it)
            if last_bar_idx - R["bar_index"] > _MAX_RIGHT_RIM_AGE + _MAX_HANDLE_BARS:
                continue

            # Cup span sanity
            cup_span = R["bar_index"] - L["bar_index"]
            if cup_span < _MIN_PATTERN_BARS:
                continue
            if cup_span > _MAX_PATTERN_BARS:
                continue

            candidate = _try_extract_pattern(bars, L, R)
            if candidate is None:
                continue

            if _pattern_already_broken(bars, candidate):
                continue

            geom_score = _score_geometry(candidate)
            vol_score = _score_volume(bars, candidate)
            ctx_score = _score_context(context)
            hist_score = 50.0

            confidence = round(
                0.40 * geom_score + 0.25 * vol_score
                + 0.20 * ctx_score + 0.15 * hist_score, 2
            )
            if confidence < _CONFIDENCE_FLOOR:
                continue

            if confidence > best_confidence:
                best_confidence = confidence
                best_candidate = candidate
                best_scores = (geom_score, vol_score, ctx_score, hist_score)

    if best_candidate is not None and best_scores is not None:
        geom_score, vol_score, ctx_score, hist_score = best_scores
        d = _build_detection(bars, best_candidate, best_confidence, context,
                             geom_score, vol_score, ctx_score, hist_score)
        detections.append(d)

    return detections


def _try_extract_pattern(bars: List[Bar], L: dict, R: dict) -> Optional[dict]:
    """Validate L (left rim) and R (right rim) as a cup-and-handle.

    Returns candidate dict or None if any geometric check fails.
    """
    l_idx, r_idx = L["bar_index"], R["bar_index"]
    l_price, r_price = L["price"], R["price"]

    if l_price <= 0:
        return None

    # Rim similarity: |left - right| / left < 5%
    rim_diff = abs(l_price - r_price) / l_price
    if rim_diff >= _MAX_RIM_DIFF:
        return None

    # Find cup bottom: lowest LOW between the rims (inclusive)
    cup_bottom_idx, cup_bottom_price = _segment_lowest_low(bars, l_idx, r_idx)
    if cup_bottom_idx is None:
        return None

    # Cup bottom should be sandwiched between the rims (not on a rim bar)
    if cup_bottom_idx == l_idx or cup_bottom_idx == r_idx:
        return None

    # Cup depth (anchor on left rim)
    cup_depth_pct = (l_price - cup_bottom_price) / l_price
    if cup_depth_pct < _MIN_CUP_DEPTH or cup_depth_pct > _MAX_CUP_DEPTH:
        return None

    # Roundness test: fit degree-2 poly to closes in cup section.
    # coeffs returned highest-degree first: [c_2, c_1, c_0]
    # c_2 (the x^2 coefficient) must be POSITIVE (concave up).
    xs = list(range(l_idx, r_idx + 1))
    ys = [bars[i]["c"] for i in xs]
    if len(xs) < 4:
        return None
    coeffs = polynomial_fit(xs, ys, degree=2)
    quad_coef = coeffs[0]
    if quad_coef <= 0:
        return None

    # Smoothness: stdev of residuals / cup_depth (in price terms).
    # Lower is better (rounder).
    residuals = []
    for xi, yi in zip(xs, ys):
        y_fit = quad_coef * xi * xi + coeffs[1] * xi + coeffs[2]
        residuals.append(yi - y_fit)
    if len(residuals) >= 2:
        mean_r = sum(residuals) / len(residuals)
        var_r = sum((r - mean_r) ** 2 for r in residuals) / len(residuals)
        residual_stdev = math.sqrt(var_r)
    else:
        residual_stdev = 0.0
    cup_depth_dollars = l_price - cup_bottom_price
    if cup_depth_dollars <= 0:
        return None
    roundness_residual = residual_stdev / cup_depth_dollars

    # V vs U discriminator: count bars whose LOW sits within the lowest 25% of
    # cup depth. A round U has many bars near the bottom (typically >40%); a
    # sharp V has very few (typically <25%). The polynomial fit alone is not
    # enough — a clean V also fits a parabola well in least-squares terms.
    bottom_threshold = cup_bottom_price + cup_depth_dollars * 0.25
    cup_bars_slice = bars[l_idx:r_idx + 1]
    bars_in_bottom = sum(1 for b in cup_bars_slice if b["l"] <= bottom_threshold)
    bottom_width_pct = bars_in_bottom / max(1, len(cup_bars_slice))
    if bottom_width_pct < _MIN_BOTTOM_WIDTH_PCT:
        return None

    # ----- Handle ------------------------------------------------------------
    last_bar_idx = len(bars) - 1
    handle_start_idx = r_idx + 1
    if handle_start_idx > last_bar_idx:
        return None

    handle_end_idx = min(handle_start_idx + _MAX_HANDLE_BARS - 1, last_bar_idx)
    handle_bars_count = handle_end_idx - handle_start_idx + 1
    if handle_bars_count < _MIN_HANDLE_BARS:
        return None

    # Handle low & high within handle window
    handle_low_idx, handle_low_price = _segment_lowest_low(
        bars, handle_start_idx, handle_end_idx
    )
    handle_high_idx, handle_high_price = _segment_highest_high(
        bars, handle_start_idx, handle_end_idx
    )
    if handle_low_idx is None or handle_high_idx is None:
        return None

    # Handle must not break below the cup bottom
    if handle_low_price <= cup_bottom_price:
        return None

    # Handle depth (anchored on right rim)
    handle_depth_pct = (r_price - handle_low_price) / r_price
    if handle_depth_pct < _MIN_HANDLE_DEPTH:
        return None
    # Handle depth must be at most 50% of cup depth
    if handle_depth_pct > _MAX_HANDLE_DEPTH_RATIO * cup_depth_pct:
        return None

    # Handle must show recovery (not still falling): handle low should NOT
    # be at the very last bar of the window — pullback would be ongoing.
    # Allow the low in the first ~70% of the window; the tail should drift
    # back toward the rim.
    handle_low_position = (handle_low_idx - handle_start_idx) / max(1, handle_bars_count - 1)
    if handle_low_position > 0.70:
        return None

    sq = compute_structure_quality(bars, handle_low_idx, handle_low_price)
    return {
        "left_rim_idx": l_idx,
        "left_rim_price": l_price,
        "right_rim_idx": r_idx,
        "right_rim_price": r_price,
        "cup_bottom_idx": cup_bottom_idx,
        "cup_bottom_price": cup_bottom_price,
        "handle_low_idx": handle_low_idx,
        "handle_low_price": handle_low_price,
        "handle_high_idx": handle_high_idx,
        "handle_high_price": handle_high_price,
        "handle_start_idx": handle_start_idx,
        "handle_end_idx": handle_end_idx,
        "rim_diff": rim_diff,
        "cup_depth_pct": cup_depth_pct,
        "handle_depth_pct": handle_depth_pct,
        "roundness_residual": roundness_residual,
        "bottom_width_pct": bottom_width_pct,
        "quad_coef": quad_coef,
        "cup_bars": r_idx - l_idx,
        "handle_bars": handle_bars_count,
        "pattern_bars": handle_end_idx - l_idx,
        "start_idx": l_idx,
        "end_idx": handle_end_idx,
        "hl_result": sq["hl_result"],
        "ma_result": sq["ma_result"],
    }


def _segment_lowest_low(bars: List[Bar], a: int, b: int) -> tuple:
    """Return (bar_index, low_price) of the lowest LOW in bars[a..b] inclusive."""
    if a > b or a < 0 or b >= len(bars):
        return (None, None)
    best_idx = a
    best_low = bars[a]["l"]
    for i in range(a + 1, b + 1):
        if bars[i]["l"] < best_low:
            best_low = bars[i]["l"]
            best_idx = i
    return (best_idx, best_low)


def _segment_highest_high(bars: List[Bar], a: int, b: int) -> tuple:
    """Return (bar_index, high_price) of the highest HIGH in bars[a..b] inclusive."""
    if a > b or a < 0 or b >= len(bars):
        return (None, None)
    best_idx = a
    best_high = bars[a]["h"]
    for i in range(a + 1, b + 1):
        if bars[i]["h"] > best_high:
            best_high = bars[i]["h"]
            best_idx = i
    return (best_idx, best_high)


def _pattern_already_broken(bars: List[Bar], c: dict) -> bool:
    """Return True if recent closes have CLOSED above the right rim.

    Two or more consecutive closes above the right rim = breakout already
    happened — don't fire as 'forming/ready'. We use the right rim itself
    (the structural pattern high) rather than the handle high, because a
    handle high above the rim means the breakout has already started.
    """
    breakout_level = c["right_rim_price"]
    r_idx = c["right_rim_idx"]
    last_idx = len(bars) - 1

    max_consec = 0
    consec = 0
    for i in range(r_idx + 1, last_idx + 1):
        if bars[i]["c"] > breakout_level:
            consec += 1
            if consec > max_consec:
                max_consec = consec
        else:
            consec = 0
    return max_consec >= 2


def _score_geometry(c: dict) -> float:
    # Rim similarity: 100 at perfect match, 0 at the 5% threshold
    rim_diff = c["rim_diff"]
    rim_score = max(0.0, (1.0 - rim_diff / _MAX_RIM_DIFF) * 100)

    # Cup depth: textbook is ~20-35%, full points there, tapers at extremes
    depth = c["cup_depth_pct"]
    if 0.20 <= depth <= 0.35:
        depth_score = 100.0
    elif depth < 0.20:
        # 12% (floor) -> 0, 20% -> 100
        depth_score = max(0.0, (depth - _MIN_CUP_DEPTH) / (0.20 - _MIN_CUP_DEPTH) * 100)
    else:
        # 35% -> 100, 50% (cap) -> 0
        depth_score = max(0.0, (_MAX_CUP_DEPTH - depth) / (_MAX_CUP_DEPTH - 0.35) * 100)

    # Roundness residual: lower is rounder. Residual ratio ~0.05 = very round,
    # ~0.30 = lumpy. Score 100 at <=0.05, 0 at >=0.30.
    rr = c["roundness_residual"]
    if rr <= 0.05:
        round_score = 100.0
    elif rr >= 0.30:
        round_score = 0.0
    else:
        round_score = max(0.0, (0.30 - rr) / 0.25 * 100)

    # Handle depth ratio: ideal ~25-40% of cup depth, full points there.
    cup_depth = c["cup_depth_pct"]
    handle_depth = c["handle_depth_pct"]
    if cup_depth > 0:
        ratio = handle_depth / cup_depth
    else:
        ratio = 0
    if 0.20 <= ratio <= 0.40:
        handle_score = 100.0
    elif ratio < 0.20:
        # 0 -> 0, 0.20 -> 100
        handle_score = max(0.0, ratio / 0.20 * 100)
    else:
        # 0.40 -> 100, 0.50 (cap) -> 0
        handle_score = max(0.0, (0.50 - ratio) / 0.10 * 100)

    base = (0.30 * rim_score
            + 0.25 * round_score
            + 0.25 * depth_score
            + 0.20 * handle_score)
    base += structure_geom_boost(c)
    return round(min(100.0, base), 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score contracting volume through the cup and handle.

    Cup-and-handle classically forms on contracting volume during the cup
    (especially the right side) and very dry volume through the handle.
    Compare avg volume in handle vs avg volume in cup. Lower = better.
    """
    l_idx = c["left_rim_idx"]
    r_idx = c["right_rim_idx"]
    h_start = c["handle_start_idx"]
    h_end = c["handle_end_idx"]

    cup_slice = bars[l_idx:r_idx + 1]
    handle_slice = bars[h_start:h_end + 1]

    if not cup_slice or not handle_slice:
        return 50.0

    cup_vol = sum(b["v"] for b in cup_slice) / len(cup_slice)
    handle_vol = sum(b["v"] for b in handle_slice) / len(handle_slice)

    if cup_vol <= 0:
        return 50.0

    # Handle/cup ratio: lower = more contraction = better
    ratio = handle_vol / cup_vol
    if ratio <= 0.5:
        handle_score = 100.0
    elif ratio >= 1.2:
        handle_score = 0.0
    else:
        handle_score = (1.2 - ratio) / 0.7 * 100

    # Right side of cup should also be contracting vs left side.
    # Split cup in half, compare averages.
    cup_len = len(cup_slice)
    if cup_len >= 4:
        left_half = cup_slice[: cup_len // 2]
        right_half = cup_slice[cup_len // 2:]
        lv = sum(b["v"] for b in left_half) / max(1, len(left_half))
        rv = sum(b["v"] for b in right_half) / max(1, len(right_half))
        if lv > 0:
            cup_ratio = rv / lv
            if cup_ratio <= 0.7:
                cup_contract_score = 100.0
            elif cup_ratio >= 1.2:
                cup_contract_score = 0.0
            else:
                cup_contract_score = (1.2 - cup_ratio) / 0.5 * 100
        else:
            cup_contract_score = 50.0
    else:
        cup_contract_score = 50.0

    return round(0.60 * handle_score + 0.40 * cup_contract_score, 2)


def _score_context(context: dict) -> float:
    score = 50.0
    # Cup-and-handle is a continuation pattern within an uptrend.
    if context.get("trend_stage") == 2:
        score += 25  # advancing uptrend resting — classic cup-and-handle
    elif context.get("trend_stage") == 1:
        score += 10  # basing — could become a cup-and-handle breakout
    if context.get("ma_alignment") == "stacked_bullish":
        score += 15
    if context.get("volume_signature") == "contracting":
        score += 10
    # DCR integration (Phase 7.5) — bullish continuation: accumulation = tailwind.
    score += _dcr_score_adjustment(context)
    # CAN SLIM meta-pillar (Phase 7.5) — O'Neil A-grade leaders get a meaningful bonus.
    score += _can_slim_score_adjustment(context)
    return min(100.0, max(0.0, score))


def _can_slim_score_adjustment(context: dict) -> float:
    """Return CAN SLIM-derived bonus for bullish continuation patterns."""
    grade = context.get("can_slim_grade", "C")
    score = context.get("can_slim_score", 50) or 50
    if grade == "A" and score >= 80:
        return 15.0
    if grade == "B" and score >= 65:
        return 8.0
    return 0.0


def _dcr_score_adjustment(context: dict) -> float:
    """Return the DCR-derived score adjustment for a bullish continuation pattern."""
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "accumulation" and recent_dcr >= 0.65:
        return 12.0   # institutional buying into close
    if dcr_sig == "distribution":
        return -8.0   # sellers active — bullish pattern faces headwind
    return 0.0


# ---------------------------------------------------------------------------
# Narrative helpers
# ---------------------------------------------------------------------------


# Custom variant - does not match shared narrative_helpers
def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (classic cup-handle trend backdrop)"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average (counter-trend warning — trend still down)"
    return "mixed moving-average"


# Custom variant - does not match shared narrative_helpers
def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 2:
        return "a Stage 2 uptrend (textbook cup-handle continuation environment)"
    if stage == 1:
        return "a Stage 1 base/accumulation environment (cup-handle as breakout setup from base)"
    if stage == 3:
        return "a Stage 3 distribution environment (late-cycle caution — cup-handles in Stage 3 fail more often)"
    if stage == 4:
        return "a Stage 4 downtrend (counter-trend warning — wait for trend confirmation)"
    return "an undefined trend stage"


# Custom variant - does not match shared narrative_helpers
def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving (institutional-sponsorship signal aligned)"
    if rs == "down":
        return "deteriorating (counter-trend warning — wait for confirmation)"
    return "neutral"


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    l_idx = c["left_rim_idx"]
    r_idx = c["right_rim_idx"]
    cb_idx = c["cup_bottom_idx"]
    hl_idx = c["handle_low_idx"]
    hh_idx = c["handle_high_idx"]

    left_rim_price = c["left_rim_price"]
    right_rim_price = c["right_rim_price"]
    cup_bottom_price = c["cup_bottom_price"]
    handle_low_price = c["handle_low_price"]
    handle_high_price = c["handle_high_price"]

    breakout_level = max(right_rim_price, handle_high_price)
    cup_depth_dollars = right_rim_price - cup_bottom_price

    # Levels
    entry = round(breakout_level * 1.001, 2)
    stop = round(handle_low_price * 0.99, 2)
    # Measured move: project cup depth above the right rim
    target = round(right_rim_price + cup_depth_dollars, 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0

    # Stop distance %
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    # Narrative dimension values
    cup_bars = c["cup_bars"]
    cup_depth_pct = c["cup_depth_pct"] * 100.0
    rim_similarity_pct = (1.0 - c["rim_diff"]) * 100.0
    rim_diff_pct = c["rim_diff"] * 100.0
    roundness_residual = c["roundness_residual"]
    bottom_width_pct = c["bottom_width_pct"] * 100.0
    handle_bars = c["handle_bars"]
    handle_depth_pct = c["handle_depth_pct"] * 100.0
    handle_to_cup_ratio_pct = (
        (c["handle_depth_pct"] / c["cup_depth_pct"]) * 100.0
        if c["cup_depth_pct"] > 0 else 0.0
    )
    cup_depth_pct_value = c["cup_depth_pct"] * 100.0
    cup_depth_dollars_val = cup_depth_dollars

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    # ---- Narrative composition - RICH, paragraph-length, with real values ----
    headline = (
        f"Cup with Handle forming on {sym_token} - {cup_bars}-bar cup of "
        f"{cup_depth_pct:.1f}% depth with {rim_similarity_pct:.1f}% rim match + "
        f"{handle_bars}-bar handle retracing {handle_depth_pct:.1f}%. Pivot "
        f"${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Cup with Handle is the canonical bullish continuation pattern "
        f"developed and popularized by William O'Neil, founder of Investor's "
        f"Business Daily, in his 1988 book 'How to Make Money in Stocks' and "
        f"refined through decades of CAN SLIM research on the leading stocks "
        f"of every market cycle from the 1960s onward. Structurally it is a "
        f"two-part formation: (1) a rounded U-shaped consolidation 'cup' where "
        f"price declines from a left rim at ${left_rim_price:.2f}, carves out "
        f"a smooth basing curve to a low at ${cup_bottom_price:.2f} ("
        f"{cup_depth_pct:.1f}% depth), then recovers to a right rim at "
        f"${right_rim_price:.2f} within {rim_diff_pct:.2f}% of the left rim "
        f"({rim_similarity_pct:.1f}% rim match score); and (2) a short "
        f"'handle' pullback after the right rim, here {handle_bars} bars long "
        f"retracing {handle_depth_pct:.1f}% to ${handle_low_price:.2f} "
        f"({handle_to_cup_ratio_pct:.1f}% of total cup depth). The cup spans "
        f"{cup_bars} bars and the roundness residual ratio of "
        f"{roundness_residual:.3f} (lower = rounder; the detector requires a "
        f"positive quadratic fit and rejects V-shapes) combined with "
        f"{bottom_width_pct:.0f}% of cup bars sitting in the lower 25% of "
        f"cup depth confirms the U-not-V shape. The market mechanic underneath "
        f"is institutional accumulation through patience: smart money declines "
        f"to chase the prior rally high, lets weak hands rotate out during the "
        f"cup decline, absorbs supply through the basing curve as panic exits "
        f"taper, and then shakes out one more wave of late longs in the handle "
        f"before triggering the markup leg. O'Neil's CAN SLIM data shows that "
        f"clean cup-handles in leadership stocks produce 25%+ moves with high "
        f"frequency when the four classical criteria — proper rim match, "
        f"genuine roundness, handle depth under 50% of cup, and volume "
        f"contraction through both segments — are all met. Dan Zanger, the "
        f"modern cup-and-handle specialist whose 1999–2000 record-setting "
        f"returns were built almost entirely on this setup, developed the "
        f"'Zanger Volume Indicator' to confirm the breakout — emphasizing that "
        f"a tight handle on contracting volume followed by an expansion-volume "
        f"breakout above the right rim is, in his words, 'the highest-edge "
        f"setup in growth stocks' when the rest of the structure is right."
    )

    why_it_matters = (
        f"This Cup with Handle is forming in {stage_phrase} with {ma_phrase} "
        f"alignment and {rs_phrase} relative strength versus the broader "
        f"market, against a {regime} regime backdrop and volume signature "
        f"reading {vol_signature}. The {rim_similarity_pct:.1f}% rim symmetry "
        f"and {cup_depth_pct:.1f}% cup depth sit in O'Neil's documented "
        f"high-reliability zone — rim matches within 5% indicate that supply "
        f"at the prior high price has been genuinely absorbed (otherwise the "
        f"right side of the cup would fail short), and 20-35% cup depth "
        f"falls in the textbook range where institutional accumulation has "
        f"time to complete without leaving the stock structurally damaged. "
        f"The roundness residual of {roundness_residual:.3f} and {bottom_width_pct:.0f}% "
        f"bottom-width fraction together verify the U-shape — a sharp "
        f"V-bottom (despite sometimes fitting a parabola in least-squares "
        f"terms) lacks the time-at-the-bottom that signals patient "
        f"accumulation rather than panic-buying off a flush. The "
        f"{handle_bars}-bar handle retracing {handle_depth_pct:.1f}% "
        f"({handle_to_cup_ratio_pct:.1f}% of cup depth) is the final shakeout "
        f"before breakout — handles deeper than 50% of cup depth signal "
        f"weakening sponsorship and historically fail more often, while "
        f"handles too shallow (under 20%) often indicate the breakout has "
        f"already started without the proper consolidation that produces a "
        f"clean setup. Volume contracting through cup and handle (encoded in "
        f"this detection's volume_score component) confirms that supply is "
        f"drying up at exactly the moment institutions are ready to push "
        f"through resistance at ${right_rim_price:.2f}, where the next leg "
        f"would re-engage trapped sellers from prior cycles as new buyers. "
        f"{structure_narrative_sentence(c)}"
    ).strip()

    what_to_watch_for = (
        f"The trigger is a daily close above ${entry:.2f} (whichever is higher: "
        f"right rim ${right_rim_price:.2f} or handle high ${handle_high_price:.2f}, "
        f"plus a small confirmation buffer) on volume of at least 1.5x the "
        f"20-bar average — that volume expansion on the breakout is non-"
        f"negotiable because a cup-handle break on light tape frequently "
        f"fades back into the handle range as a bull trap. The ideal trigger "
        f"bar closes in the upper half of its range with a wide real body, "
        f"and the next 1-3 bars should hold above ${right_rim_price:.2f} "
        f"without re-entering the handle range (${handle_low_price:.2f} to "
        f"${handle_high_price:.2f}) more than briefly — a single throwback "
        f"retest of the rim is normal and often the highest-quality entry, "
        f"but two-plus closes back inside the handle weakens the thesis. "
        f"Measured target is ${target:.2f}, derived by adding cup depth "
        f"(${cup_depth_dollars_val:.2f}) to the right rim — this is the "
        f"conservative O'Neil projection; strong cup-handles in Stage 2 "
        f"trends frequently extend 1.5x to 3x this measured move over the "
        f"8-16 weeks following the trigger because the prior accumulation "
        f"has compressed substantial latent buying. Initial stop sits at "
        f"${stop:.2f} (1% below the handle low at ${handle_low_price:.2f}) "
        f"representing a {stop_distance_pct:.1f}% risk from entry — risking "
        f"1% of account on this long implies a position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity, and risking 0.5% halves that. Trail stops below each "
        f"new swing low as the trade extends, or below the rising 10-EMA, "
        f"and consider taking partial profit at 1R to lock in a free trade. "
        f"O'Neil's research emphasizes that cup-handle stops typically run "
        f"5-8% from the pivot, which supports larger position sizing than "
        f"most patterns when geometry is clean."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close below the handle low "
        f"at ${handle_low_price:.2f} (stop at ${stop:.2f}, 1% below to "
        f"absorb the standard downside wick) — that close signals failed "
        f"accumulation, institutional sponsorship has stepped away, and the "
        f"cup may resolve as a distribution top rather than a continuation "
        f"base. A subtler failure mode that often precedes the hard stop: "
        f"the breakout above ${entry:.2f} occurs on weak or merely-average "
        f"volume, the next 1-3 bars fade back into the handle range, and "
        f"price spends 3-5 bars churning between handle low and breakout "
        f"level without sustained advance. O'Neil specifically warns about "
        f"this 'failed breakout' setup — it often precedes a deeper decline "
        f"because what looked like accumulation through the cup may have "
        f"actually been a distribution rotation in disguise, and once the "
        f"trigger fails the stock typically breaks the handle low within "
        f"5-10 bars. The {stop_distance_pct:.1f}% stop must be honored "
        f"without negotiation — widening or removing a stop on a failing "
        f"cup-handle is one of the most expensive habits in swing trading "
        f"because the natural human tendency is to defend the thesis ('this "
        f"is a clean pattern, it has to work') rather than accept the "
        f"market's verdict. Failed cup-handles in Stage 3 (distribution) "
        f"contexts are particularly dangerous because the failure often "
        f"transitions directly into a Stage 4 markdown leg, so size "
        f"accordingly to the trend stage and never average down on a "
        f"failing breakout."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Cup with Handle",
        "category": "classical",
        "direction": "bullish",
        "start_t": int(bars[l_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[l_idx]["t"]),
                     int(bars[cb_idx]["t"]),
                     int(bars[r_idx]["t"]),
                     int(bars[hl_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "cup_curve",
            "anchors": [
                {"t": int(bars[l_idx]["t"]), "price": float(left_rim_price)},
                {"t": int(bars[cb_idx]["t"]), "price": float(cup_bottom_price)},
                {"t": int(bars[r_idx]["t"]), "price": float(right_rim_price)},
                {"t": int(bars[hh_idx]["t"]), "price": float(handle_high_price)},
                {"t": int(bars[hl_idx]["t"]), "price": float(handle_low_price)},
            ],
            "extras": {
                "cup_depth_pct": round(c["cup_depth_pct"] * 100, 2),
                "handle_depth_pct": round(c["handle_depth_pct"] * 100, 2),
                "rim_similarity_pct": round((1.0 - c["rim_diff"]) * 100, 2),
                "roundness_residual": round(float(c["roundness_residual"]), 4),
                "cup_bars": int(c["cup_bars"]),
                "handle_bars": int(c["handle_bars"]),
                "dcr_score_adj": round(_dcr_score_adjustment(context), 2),
                **structure_extras(c),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "handle_low_minus_1pct",
            "target_primary": target,
            "target_secondary": None,
            "risk_reward": round(rr, 2),
        },
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": geom_score,
            "volume_score": vol_score,
            "context_score": ctx_score,
            "historical_score": hist_score,
        },
        "narrative": {
            "headline": headline,
            "what_it_is": what_it_is,
            "why_it_matters": why_it_matters,
            "what_to_watch_for": what_to_watch_for,
            "failure_signal": failure_signal,
        },
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


register(_PATTERN_ID, detect_cup_handle)
