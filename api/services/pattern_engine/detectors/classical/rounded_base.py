"""Rounded Base detector.

A rounded base is a slow, methodical U-shaped consolidation pattern - the
classical Wyckoff Phase A through C accumulation schematic, or O'Neil's
"Saucer with Platform" variant. It differs from the Cup with Handle in
ONE critical structural feature: there is NO handle. The right side
rallies cleanly back to the prior high without a small pullback consolidation.

Geometric definition:
  - Window: 30-120 bars (longer than cup - slower rounding)
  - U-shape: degree-2 polynomial fit through closes; coefficient[0] > 0 (concave up)
  - No clear handle: the right side of the rounding rallies cleanly without
    a small pullback consolidation
  - Bottom width: >=40% of bars in the lowest 25% of cup depth - slow
    rounding, not V-shape
  - Depth: 12-40% from rim down to bottom
  - Rim similarity: left rim approximately equal to right rim within 5%
  - Volume: dries through middle 50%, expands on right side
  - Pattern not yet broken (closes haven't punched above right rim
    consecutively)

Levels:
  entry = right_rim * 1.001 (close above right rim with buffer)
  stop  = below lowest point * 0.985
  target = right_rim + base_depth (measured move)

Attribution: Richard Wyckoff (1908) - Phase A/B/C accumulation schematic;
William O'Neil - "Saucer with Platform" / saucer base variants in CAN SLIM.
Bulkowski's empirical research shows rounded-base breakouts produce
25-40% follow-through with high frequency.
"""
from __future__ import annotations

import math
import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.geometry import polynomial_fit
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "rounded_base"
_MIN_PATTERN_BARS = 30
_MAX_PATTERN_BARS = 120
_MAX_RIM_DIFF = 0.05
_MIN_DEPTH = 0.12
_MAX_DEPTH = 0.40
_MIN_BOTTOM_WIDTH_PCT = 0.40
_MAX_HANDLE_RANGE = 0.06  # right-side closes must NOT pull back more than 6% off rim
_MAX_RIGHT_RIM_AGE = 25
_CONFIDENCE_FLOOR = 50.0


def detect_rounded_base(bars: List[Bar], context: dict) -> List[Detection]:
    if len(bars) < _MIN_PATTERN_BARS:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 2:
        return []

    high_pivots_raw = [p for p in pivots if p["type"] == "high"]
    if len(high_pivots_raw) < 2:
        return []

    high_pivots = [{"t": p["bar_index"], "price": p["price"],
                    "type": "high", "strength": p["strength"],
                    "bar_index": p["bar_index"]} for p in high_pivots_raw]

    recent_highs = high_pivots[-14:]
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
            if last_bar_idx - R["bar_index"] > _MAX_RIGHT_RIM_AGE:
                continue
            cup_span = R["bar_index"] - L["bar_index"]
            if cup_span < _MIN_PATTERN_BARS or cup_span > _MAX_PATTERN_BARS:
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
    l_idx, r_idx = L["bar_index"], R["bar_index"]
    l_price, r_price = L["price"], R["price"]
    if l_price <= 0:
        return None

    rim_diff = abs(l_price - r_price) / l_price
    if rim_diff >= _MAX_RIM_DIFF:
        return None

    cup_bottom_idx, cup_bottom_price = _segment_lowest_low(bars, l_idx, r_idx)
    if cup_bottom_idx is None or cup_bottom_idx == l_idx or cup_bottom_idx == r_idx:
        return None

    base_depth_pct = (l_price - cup_bottom_price) / l_price
    if base_depth_pct < _MIN_DEPTH or base_depth_pct > _MAX_DEPTH:
        return None

    xs = list(range(l_idx, r_idx + 1))
    ys = [bars[i]["c"] for i in xs]
    if len(xs) < 4:
        return None
    coeffs = polynomial_fit(xs, ys, degree=2)
    quad_coef = coeffs[0]
    if quad_coef <= 0:
        return None

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
    base_depth_dollars = l_price - cup_bottom_price
    if base_depth_dollars <= 0:
        return None
    roundness_residual = residual_stdev / base_depth_dollars

    bottom_threshold = cup_bottom_price + base_depth_dollars * 0.25
    cup_bars_slice = bars[l_idx:r_idx + 1]
    bars_in_bottom = sum(1 for b in cup_bars_slice if b["l"] <= bottom_threshold)
    bottom_width_pct = bars_in_bottom / max(1, len(cup_bars_slice))
    if bottom_width_pct < _MIN_BOTTOM_WIDTH_PCT:
        return None

    # NO-HANDLE CHECK: detect a handle-style "small dip just before the rim"
    # by examining the last ~8 bars before the right rim. A cup-with-handle
    # has the closes pull back, find a local low, then rally back to the
    # rim. A clean rounded base has the closes rallying steadily into the
    # rim with no such local low.
    handle_window_size = min(10, max(5, (r_idx - l_idx) // 6))
    handle_window = bars[max(l_idx, r_idx - handle_window_size):r_idx + 1]
    if len(handle_window) >= 5:
        # Find the local min within the handle window. If it sits clearly in
        # the middle of the window (not at the start or end) and the rally
        # back to the rim from that low exceeds the no-handle tolerance, this
        # is a cup-with-handle.
        min_idx_in_window = 0
        min_close = handle_window[0]["c"]
        for k, b in enumerate(handle_window):
            if b["c"] < min_close:
                min_close = b["c"]
                min_idx_in_window = k
        pullback_off_rim = (r_price - min_close) / r_price
        # Only reject if the local minimum is INSIDE the window (not at the
        # very start, which would just be the natural arc of the curve) AND
        # the pullback exceeds tolerance.
        if (min_idx_in_window >= 2
                and min_idx_in_window <= len(handle_window) - 2
                and pullback_off_rim > _MAX_HANDLE_RANGE):
            return None

    # Also explicitly reject if there's a "handle" forming AFTER the right rim
    # (between right rim and the current bar).
    last_bar_idx = len(bars) - 1
    if last_bar_idx > r_idx:
        post_rim_bars = bars[r_idx + 1:last_bar_idx + 1]
        if len(post_rim_bars) >= 5:
            min_idx = 0
            min_close = post_rim_bars[0]["c"]
            for k, b in enumerate(post_rim_bars):
                if b["c"] < min_close:
                    min_close = b["c"]
                    min_idx = k
            pullback_off_rim = (r_price - min_close) / r_price
            if (min_idx >= 2
                    and min_idx <= len(post_rim_bars) - 2
                    and pullback_off_rim > _MAX_HANDLE_RANGE):
                return None

    return {
        "left_rim_idx": l_idx,
        "left_rim_price": l_price,
        "right_rim_idx": r_idx,
        "right_rim_price": r_price,
        "cup_bottom_idx": cup_bottom_idx,
        "cup_bottom_price": cup_bottom_price,
        "rim_diff": rim_diff,
        "base_depth_pct": base_depth_pct,
        "roundness_residual": roundness_residual,
        "bottom_width_pct": bottom_width_pct,
        "quad_coef": quad_coef,
        "base_bars": r_idx - l_idx,
        "start_idx": l_idx,
        "end_idx": r_idx,
    }


def _segment_lowest_low(bars: List[Bar], a: int, b: int) -> tuple:
    if a > b or a < 0 or b >= len(bars):
        return (None, None)
    best_idx = a
    best_low = bars[a]["l"]
    for i in range(a + 1, b + 1):
        if bars[i]["l"] < best_low:
            best_low = bars[i]["l"]
            best_idx = i
    return (best_idx, best_low)


def _pattern_already_broken(bars: List[Bar], c: dict) -> bool:
    """True if recent closes have already breached above right rim consecutively."""
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
    rim_diff = c["rim_diff"]
    rim_score = max(0.0, (1.0 - rim_diff / _MAX_RIM_DIFF) * 100)

    depth = c["base_depth_pct"]
    if 0.18 <= depth <= 0.30:
        depth_score = 100.0
    elif depth < 0.18:
        depth_score = max(0.0, (depth - _MIN_DEPTH) / (0.18 - _MIN_DEPTH) * 100)
    else:
        depth_score = max(0.0, (_MAX_DEPTH - depth) / (_MAX_DEPTH - 0.30) * 100)

    rr = c["roundness_residual"]
    if rr <= 0.05:
        round_score = 100.0
    elif rr >= 0.30:
        round_score = 0.0
    else:
        round_score = max(0.0, (0.30 - rr) / 0.25 * 100)

    bw = c["bottom_width_pct"]
    if bw >= 0.55:
        bottom_score = 100.0
    else:
        bottom_score = max(0.0, (bw - _MIN_BOTTOM_WIDTH_PCT) / (0.55 - _MIN_BOTTOM_WIDTH_PCT) * 100)

    return round(0.25 * rim_score + 0.25 * depth_score
                 + 0.25 * round_score + 0.25 * bottom_score, 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score volume drying through middle and expanding on right.

    Wyckoff/O'Neil's signature for accumulation: volume contracts through the
    basing (Phase B) and expands as the right side rallies (Phase C/D).
    """
    l_idx = c["left_rim_idx"]
    r_idx = c["right_rim_idx"]
    span = r_idx - l_idx
    if span < 6:
        return 50.0

    # Define thirds: left third (decline), middle third (basing), right third (recovery)
    third = span // 3
    if third < 1:
        return 50.0
    left_slice = bars[l_idx:l_idx + third]
    middle_slice = bars[l_idx + third:l_idx + 2 * third]
    right_slice = bars[l_idx + 2 * third:r_idx + 1]

    if not (left_slice and middle_slice and right_slice):
        return 50.0

    left_avg = sum(b["v"] for b in left_slice) / len(left_slice)
    middle_avg = sum(b["v"] for b in middle_slice) / len(middle_slice)
    right_avg = sum(b["v"] for b in right_slice) / len(right_slice)

    if left_avg <= 0:
        return 50.0

    # Middle should be < left (drying), right should be > middle (expanding)
    middle_dry_ratio = middle_avg / left_avg  # < 1 = drying
    right_expand_ratio = right_avg / max(middle_avg, 1e-6)  # > 1 = expanding

    if middle_dry_ratio <= 0.6:
        dry_score = 100.0
    elif middle_dry_ratio >= 1.1:
        dry_score = 0.0
    else:
        dry_score = (1.1 - middle_dry_ratio) / 0.5 * 100

    if right_expand_ratio >= 1.4:
        expand_score = 100.0
    elif right_expand_ratio <= 0.9:
        expand_score = 0.0
    else:
        expand_score = (right_expand_ratio - 0.9) / 0.5 * 100

    return round(0.55 * dry_score + 0.45 * expand_score, 2)


def _score_context(context: dict) -> float:
    score = 50.0
    if context.get("trend_stage") == 1:
        score += 25  # Stage 1 base - textbook rounded-base accumulation
    elif context.get("trend_stage") == 2:
        score += 12  # ascending - rounded base as deep pullback
    elif context.get("trend_stage") == 4:
        score += 8  # Stage 4 exhaustion - rounded base as reversal
    if context.get("ma_alignment") == "stacked_bullish":
        score += 12
    if context.get("volume_signature") == "contracting":
        score += 10
    # DCR integration (Phase 7.5) — bullish reversal/base: accumulation = tailwind.
    score += _dcr_score_adjustment(context)
    return min(100.0, max(0.0, score))


def _dcr_score_adjustment(context: dict) -> float:
    """Return the DCR-derived score adjustment for a bullish reversal/continuation pattern."""
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "accumulation" and recent_dcr >= 0.65:
        return 12.0   # institutional buying into close
    if dcr_sig == "distribution":
        return -8.0   # sellers active — bullish pattern faces headwind
    return 0.0


# Custom variant - does not match shared narrative_helpers
def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (early-stage accumulation environment)"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average (deep-base reversal environment)"
    return "mixed moving-average (transitional)"


# Custom variant - does not match shared narrative_helpers
def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 1:
        return "a Stage 1 base/accumulation environment (textbook Wyckoff Phase A-C rounded-base setup)"
    if stage == 2:
        return "a Stage 2 uptrend (rounded base as deep continuation pullback)"
    if stage == 4:
        return "a Stage 4 downtrend exhausting (rounded base as deep reversal setup)"
    if stage == 3:
        return "a Stage 3 distribution environment (caution - rounded bases in Stage 3 fail more often)"
    return "an undefined trend stage"


# Custom variant - does not match shared narrative_helpers
def _dcr_phrase(context: dict) -> str:
    sig = context.get("dcr_signature", "neutral")
    avg = context.get("recent_dcr_avg", 0.5)
    if sig == "accumulation":
        return f"accumulation-signature daily close ratio (recent avg {avg:.2f} - closes near highs)"
    if sig == "distribution":
        return f"distribution-signature daily close ratio (recent avg {avg:.2f} - closes near lows)"
    return f"neutral daily close ratio (avg {avg:.2f})"


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    l_idx = c["left_rim_idx"]
    r_idx = c["right_rim_idx"]
    cb_idx = c["cup_bottom_idx"]

    left_rim = c["left_rim_price"]
    right_rim = c["right_rim_price"]
    base_bottom = c["cup_bottom_price"]

    base_depth_dollars = right_rim - base_bottom
    entry = round(right_rim * 1.001, 2)
    stop = round(base_bottom * 0.985, 2)
    target = round(right_rim + base_depth_dollars, 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    base_bars = c["base_bars"]
    base_depth_pct = c["base_depth_pct"] * 100.0
    rim_similarity_pct = (1.0 - c["rim_diff"]) * 100.0
    rim_diff_pct = c["rim_diff"] * 100.0
    roundness_residual = c["roundness_residual"]
    bottom_width_pct = c["bottom_width_pct"] * 100.0

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    dcr_phrase = _dcr_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    headline = (
        f"Rounded Base forming on {sym_token} - {base_bars}-bar U-shape of "
        f"{base_depth_pct:.1f}% depth, rim match {rim_similarity_pct:.1f}% "
        f"(${left_rim:.2f}/${right_rim:.2f}), bottom width "
        f"{bottom_width_pct:.0f}% (slow rounding, no handle). Pivot "
        f"${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Rounded Base - also called the Saucer Base, Bowl Bottom, or "
        f"Wyckoff Accumulation Schematic - is one of the slowest and most "
        f"reliable bullish accumulation structures in classical technical "
        f"analysis. Richard Wyckoff first codified the Phase A through C "
        f"accumulation cycle in 1908 (the slow rounding base is Phase B, "
        f"the right-side rally is Phase C). William O'Neil's CAN SLIM "
        f"system identified the 'Saucer with Platform' as a higher-"
        f"reliability variant of the cup-and-handle. Structurally, the "
        f"pattern is a smooth U-shaped consolidation: price declines from "
        f"a left rim at ${left_rim:.2f}, methodically carves out a "
        f"basing curve to a low at ${base_bottom:.2f} ("
        f"{base_depth_pct:.1f}% depth), then patiently recovers to a "
        f"right rim at ${right_rim:.2f} within {rim_diff_pct:.2f}% of the "
        f"left rim ({rim_similarity_pct:.1f}% rim match). The base spans "
        f"{base_bars} bars - distinctly longer than a cup-with-handle - "
        f"and the roundness residual ratio of {roundness_residual:.3f} "
        f"(lower = rounder; positive quadratic fit ensures concave-up "
        f"shape) combined with {bottom_width_pct:.0f}% of bars sitting in "
        f"the lower 25% of base depth confirms the slow-rounding "
        f"signature. CRITICALLY, this pattern has no handle: the right "
        f"side of the rounding rallies cleanly back to the prior high "
        f"without the small pullback consolidation that distinguishes the "
        f"cup-with-handle. That single feature is the chart language of "
        f"patient accumulation that completed before any final shakeout - "
        f"smart money fully built their position during the basing and is "
        f"now ready to drive the markup leg. The market mechanic is the "
        f"Wyckoff archetype: selling climax leads to automatic rally, "
        f"prolonged basing absorbs all the patient supply (Phase B), and "
        f"the slow turn higher is the 'sign of strength' that signals "
        f"accumulation has completed. Bulkowski's research shows rounded "
        f"bases produce 25-40% follow-through with high frequency once "
        f"the right rim is broken on volume. Mark Ritchie II — whose modern "
        f"momentum playbook leans heavily on post-IPO and post-correction "
        f"structures — uses the rounded base as a core component of his post-"
        f"IPO setup, treating a slow saucer in a recently-public liquid leader "
        f"as one of the highest-edge accumulation patterns in the entire "
        f"growth-stock universe."
    )

    why_it_matters = (
        f"This Rounded Base is forming in {stage_phrase} with {ma_phrase} "
        f"alignment against a {regime} regime backdrop and a "
        f"{dcr_phrase}. Volume signature reads {vol_signature}. The "
        f"{rim_similarity_pct:.1f}% rim symmetry and {base_depth_pct:.1f}% "
        f"base depth sit in the high-reliability zone for accumulation "
        f"patterns: rim matches within 5% indicate that supply at the "
        f"prior-high price level has been fully absorbed during the basing "
        f"period, and 18-30% base depth falls in the textbook range where "
        f"institutional accumulation has time to complete without leaving "
        f"the underlying business or technical structure damaged. The "
        f"roundness residual of {roundness_residual:.3f} verifies the "
        f"U-shape against a V-shape (a V-bottom often fits a parabola in "
        f"least-squares terms but lacks the time-at-the-bottom signature) "
        f"and the {bottom_width_pct:.0f}% bottom-width fraction confirms "
        f"genuine basing rather than panic-and-snap dynamics. The "
        f"{base_bars}-bar duration is the rounded base's defining feature - "
        f"it is intentionally longer than a cup-and-handle because the "
        f"absence of a handle means the entire absorption-and-readiness "
        f"sequence occurred inside the rounding itself. Patterns shorter "
        f"than 30 bars typically lack the institutional-accumulation time "
        f"signature; patterns over 120 bars approach 'stalled stock' "
        f"territory and may resolve sideways rather than break out. The "
        f"absence of a handle is statistically significant: O'Neil's "
        f"research showed that 'plain saucer' bases without a handle "
        f"break out with similar frequency to cup-with-handle setups but "
        f"often produce LARGER follow-through moves because the latent "
        f"buying that would have been triggered by a handle shakeout is "
        f"already concentrated at the breakout pivot. Volume drying "
        f"through the middle 50% of the base and expanding into the right "
        f"side (encoded in this detection's volume_score component) is "
        f"the textbook Wyckoff signature confirming that absorption has "
        f"completed and demand is returning at the prior-high pivot. "
        f"Trapped sellers near the rim become the next leg's resistance, "
        f"and breakouts above ${right_rim:.2f} on volume engage that "
        f"trapped supply as fresh buying."
    )

    what_to_watch_for = (
        f"The trigger is a daily close above ${entry:.2f} (the right rim "
        f"at ${right_rim:.2f} plus a small confirmation buffer) on volume "
        f"of at least 1.5x the 20-bar average - that volume expansion on "
        f"the breakout is non-negotiable because a rounded-base break on "
        f"light tape frequently fades back into the base as a bull trap. "
        f"The ideal trigger bar closes in the upper third of its range "
        f"with a wide real body, and the next 1-3 bars should hold above "
        f"${right_rim:.2f} without re-entering the base. A single "
        f"throwback retest of the rim is normal and often the highest-"
        f"quality secondary entry, but two-plus closes back below "
        f"${right_rim:.2f} weakens the thesis materially. Measured target "
        f"is ${target:.2f}, derived by adding the base depth "
        f"(${base_depth_dollars:.2f}) to the right rim - this is the "
        f"conservative measured move; strong rounded bases in Stage 1-to-2 "
        f"transitions frequently extend 1.5-2x this measured move over "
        f"the 12-26 weeks following the trigger because the prior "
        f"accumulation has compressed substantial latent buying. Initial "
        f"stop sits at ${stop:.2f} (1.5% below the base bottom at "
        f"${base_bottom:.2f}) representing a {stop_distance_pct:.1f}% risk "
        f"from entry - risking 1% of account on this long implies a "
        f"position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity, and risking 0.5% halves that. Note that rounded "
        f"bases tend to give wide stops because the structural low is "
        f"deep below the pivot - this is a feature, not a bug; the trade "
        f"is designed for patient swing-or-position holding, not "
        f"intraday-tight risk. Trail stops behind each new swing low or "
        f"under the rising 21-EMA after the breakout. Consider taking "
        f"partial profit at 1R to lock in a free trade. O'Neil's CAN "
        f"SLIM research emphasizes that rounded-base stocks with strong "
        f"fundamentals (rising earnings, leadership in a strong group) "
        f"produce the highest-magnitude moves; weak-fundamental rounded "
        f"bases more often fail or produce muted breakouts."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close below the base "
        f"bottom at ${base_bottom:.2f} (stop at ${stop:.2f}, 1.5% below "
        f"to absorb the standard shake-out wick) - that close signals "
        f"the absorption thesis is wrong, institutional sponsorship has "
        f"stepped away, and the base may resolve as a distribution "
        f"structure rather than an accumulation setup. Failed rounded "
        f"bases often produce surprisingly aggressive downside follow-"
        f"through because the entire structural support has been "
        f"systematically tested over {base_bars} bars and its failure "
        f"signals a regime change. A subtler failure mode that often "
        f"precedes the hard stop: the breakout above ${entry:.2f} occurs "
        f"on weak or merely-average volume, the next 1-3 bars fade back "
        f"into the base, and price spends 3-5 bars churning between "
        f"${right_rim:.2f} and the upper third of the base without "
        f"sustained advance. That sequence is the textbook 'failed "
        f"breakout' or Wyckoff upthrust - it often precedes a deeper "
        f"decline because what looked like accumulation may have actually "
        f"been a distribution rotation in disguise. The "
        f"{stop_distance_pct:.1f}% stop must be honored without "
        f"negotiation - widening or removing a stop on a failing rounded "
        f"base is one of the most expensive habits in swing trading "
        f"because the natural human tendency is to defend the thesis "
        f"('this is a textbook pattern, it has to work') rather than "
        f"accept the market's verdict. Failed rounded bases in Stage 3 "
        f"contexts (distribution environments) are particularly "
        f"dangerous because the failure often transitions directly into "
        f"a Stage 4 markdown leg, so size accordingly to the trend stage "
        f"and never average down on a failing breakout. Additionally, "
        f"the absence of a handle in this pattern is statistically a "
        f"plus, but it also means there is no built-in 'pre-breakout "
        f"shakeout' to flush weak hands - so the trigger bar's quality "
        f"matters more here than for a cup-with-handle, where the handle "
        f"low already pre-validated demand. A weak trigger bar in a "
        f"rounded base is a yellow flag to wait for the throwback retest "
        f"rather than chase the initial break."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Rounded Base",
        "category": "classical",
        "direction": "bullish",
        "start_t": int(bars[l_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[l_idx]["t"]),
                     int(bars[cb_idx]["t"]),
                     int(bars[r_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "cup_curve",
            "anchors": [
                {"t": int(bars[l_idx]["t"]), "price": float(left_rim)},
                {"t": int(bars[cb_idx]["t"]), "price": float(base_bottom)},
                {"t": int(bars[r_idx]["t"]), "price": float(right_rim)},
            ],
            "extras": {
                "base_depth_pct": round(c["base_depth_pct"] * 100, 2),
                "rim_similarity_pct": round((1.0 - c["rim_diff"]) * 100, 2),
                "roundness_residual": round(float(c["roundness_residual"]), 4),
                "bottom_width_pct": round(c["bottom_width_pct"] * 100, 2),
                "base_bars": int(c["base_bars"]),
                "no_handle": True,
                "dcr_score_adj": round(_dcr_score_adjustment(context), 2),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "base_bottom_minus_1.5pct",
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


register(_PATTERN_ID, detect_rounded_base)
