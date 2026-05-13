"""Rounded Top detector.

A rounded top is the mirror of the rounded base - a slow inverted-U
distribution structure that signals a methodical, multi-week topping
process. Classical Wyckoff Phase A through C distribution; the bearish
equivalent of O'Neil's saucer base.

Geometric definition:
  - Window: 30-120 bars (longer than inverse cup - slower rollover)
  - Inverted-U: degree-2 polynomial fit through closes; coefficient[0] < 0
    (concave down)
  - No handle: the right-side decline drops cleanly without a small
    rally consolidation
  - Top width: >=40% of bars in the HIGHEST 25% of dome depth - slow
    rollover, not spike
  - Depth: 12-40% from peak down to rim
  - Rim similarity: left rim approximately equal to right rim within 5%
  - Volume: dries through the dome, expands on right-side decline
  - Pattern not yet broken (closes haven't punched below right rim
    consecutively)

Levels:
  entry = right_rim * 0.999 (close below right rim with buffer)
  stop  = above peak * 1.015
  target = right_rim - dome_depth (measured move down)

Attribution: Richard Wyckoff (1908) - Phase A/B/C distribution schematic;
classical Edwards & Magee saucer top. Bulkowski's research shows rounded
tops produce 20-30% downside follow-through with high frequency.
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


_PATTERN_ID = "rounded_top"
_MIN_PATTERN_BARS = 30
_MAX_PATTERN_BARS = 120
_MAX_RIM_DIFF = 0.05
_MIN_DEPTH = 0.12
_MAX_DEPTH = 0.40
_MIN_TOP_WIDTH_PCT = 0.40
_MAX_HANDLE_RANGE = 0.06  # right-side closes must NOT rally back more than 6% off rim
_MAX_RIGHT_RIM_AGE = 25
_CONFIDENCE_FLOOR = 50.0


def detect_rounded_top(bars: List[Bar], context: dict) -> List[Detection]:
    if len(bars) < _MIN_PATTERN_BARS:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 2:
        return []

    low_pivots_raw = [p for p in pivots if p["type"] == "low"]
    if len(low_pivots_raw) < 2:
        return []

    low_pivots = [{"t": p["bar_index"], "price": p["price"],
                   "type": "low", "strength": p["strength"],
                   "bar_index": p["bar_index"]} for p in low_pivots_raw]

    recent_lows = low_pivots[-14:]
    n = len(recent_lows)
    last_bar_idx = len(bars) - 1

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for i in range(n):
        for j in range(i + 1, n):
            L = recent_lows[i]
            R = recent_lows[j]
            if not (L["bar_index"] < R["bar_index"]):
                continue
            if last_bar_idx - R["bar_index"] > _MAX_RIGHT_RIM_AGE:
                continue
            dome_span = R["bar_index"] - L["bar_index"]
            if dome_span < _MIN_PATTERN_BARS or dome_span > _MAX_PATTERN_BARS:
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

    dome_peak_idx, dome_peak_price = _segment_highest_high(bars, l_idx, r_idx)
    if dome_peak_idx is None or dome_peak_idx == l_idx or dome_peak_idx == r_idx:
        return None

    dome_depth_pct = (dome_peak_price - l_price) / dome_peak_price
    if dome_depth_pct < _MIN_DEPTH or dome_depth_pct > _MAX_DEPTH:
        return None

    xs = list(range(l_idx, r_idx + 1))
    ys = [bars[i]["c"] for i in xs]
    if len(xs) < 4:
        return None
    coeffs = polynomial_fit(xs, ys, degree=2)
    quad_coef = coeffs[0]
    if quad_coef >= 0:
        # Inverted-U requires NEGATIVE quadratic coefficient (concave down)
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
    dome_depth_dollars = dome_peak_price - l_price
    if dome_depth_dollars <= 0:
        return None
    roundness_residual = residual_stdev / dome_depth_dollars

    # Top-width: >=40% of bars whose HIGH sits in upper 25% of dome depth
    top_threshold = dome_peak_price - dome_depth_dollars * 0.25
    dome_bars_slice = bars[l_idx:r_idx + 1]
    bars_in_top = sum(1 for b in dome_bars_slice if b["h"] >= top_threshold)
    top_width_pct = bars_in_top / max(1, len(dome_bars_slice))
    if top_width_pct < _MIN_TOP_WIDTH_PCT:
        return None

    # NO-HANDLE CHECK: detect a rally-handle "small bump just before the right
    # rim" by examining the last ~8 bars. A rounded top with a rally handle
    # has the closes spike up to a local high mid-window then come back down
    # to the rim. A clean rounded top has the closes declining steadily.
    handle_window_size = min(10, max(5, (r_idx - l_idx) // 6))
    handle_window = bars[max(l_idx, r_idx - handle_window_size):r_idx + 1]
    if len(handle_window) >= 5:
        max_idx_in_window = 0
        max_close = handle_window[0]["c"]
        for k, b in enumerate(handle_window):
            if b["c"] > max_close:
                max_close = b["c"]
                max_idx_in_window = k
        rally_off_rim = (max_close - r_price) / r_price
        if (max_idx_in_window >= 2
                and max_idx_in_window <= len(handle_window) - 2
                and rally_off_rim > _MAX_HANDLE_RANGE):
            return None

    last_bar_idx = len(bars) - 1
    if last_bar_idx > r_idx:
        post_rim_bars = bars[r_idx + 1:last_bar_idx + 1]
        if len(post_rim_bars) >= 5:
            max_idx = 0
            max_close = post_rim_bars[0]["c"]
            for k, b in enumerate(post_rim_bars):
                if b["c"] > max_close:
                    max_close = b["c"]
                    max_idx = k
            rally_off_rim = (max_close - r_price) / r_price
            if (max_idx >= 2
                    and max_idx <= len(post_rim_bars) - 2
                    and rally_off_rim > _MAX_HANDLE_RANGE):
                return None

    return {
        "left_rim_idx": l_idx,
        "left_rim_price": l_price,
        "right_rim_idx": r_idx,
        "right_rim_price": r_price,
        "dome_peak_idx": dome_peak_idx,
        "dome_peak_price": dome_peak_price,
        "rim_diff": rim_diff,
        "dome_depth_pct": dome_depth_pct,
        "roundness_residual": roundness_residual,
        "top_width_pct": top_width_pct,
        "quad_coef": quad_coef,
        "dome_bars": r_idx - l_idx,
        "start_idx": l_idx,
        "end_idx": r_idx,
    }


def _segment_highest_high(bars: List[Bar], a: int, b: int) -> tuple:
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
    """True if recent closes have already breached below right rim consecutively."""
    breakout_level = c["right_rim_price"]
    r_idx = c["right_rim_idx"]
    last_idx = len(bars) - 1
    max_consec = 0
    consec = 0
    for i in range(r_idx + 1, last_idx + 1):
        if bars[i]["c"] < breakout_level:
            consec += 1
            if consec > max_consec:
                max_consec = consec
        else:
            consec = 0
    return max_consec >= 2


def _score_geometry(c: dict) -> float:
    rim_diff = c["rim_diff"]
    rim_score = max(0.0, (1.0 - rim_diff / _MAX_RIM_DIFF) * 100)

    depth = c["dome_depth_pct"]
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

    tw = c["top_width_pct"]
    if tw >= 0.55:
        top_score = 100.0
    else:
        top_score = max(0.0, (tw - _MIN_TOP_WIDTH_PCT) / (0.55 - _MIN_TOP_WIDTH_PCT) * 100)

    return round(0.25 * rim_score + 0.25 * depth_score
                 + 0.25 * round_score + 0.25 * top_score, 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score volume drying through the dome and expanding on right-side decline."""
    l_idx = c["left_rim_idx"]
    r_idx = c["right_rim_idx"]
    span = r_idx - l_idx
    if span < 6:
        return 50.0

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

    middle_dry_ratio = middle_avg / left_avg
    right_expand_ratio = right_avg / max(middle_avg, 1e-6)

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
    if context.get("trend_stage") == 3:
        score += 25  # Stage 3 distribution - textbook rounded-top setup
    elif context.get("trend_stage") == 2:
        score += 12  # late Stage 2 - rounded top as topping structure
    elif context.get("trend_stage") == 4:
        score += 8  # Stage 4 - continuation top
    if context.get("ma_alignment") == "stacked_bullish":
        score += 8  # late-cycle overbought
    if context.get("dcr_signature") == "distribution":
        score += 12
    if context.get("volume_signature") == "contracting":
        score += 10
    return min(100.0, score)


def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (late-cycle distribution environment)"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average (downtrend continuation environment)"
    return "mixed moving-average (transitional)"


def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 3:
        return "a Stage 3 distribution/topping environment (textbook Wyckoff Phase A-C rounded-top setup)"
    if stage == 2:
        return "a late Stage 2 uptrend showing exhaustion (rounded top as topping structure)"
    if stage == 4:
        return "a Stage 4 downtrend (rounded top as continuation distribution)"
    if stage == 1:
        return "a Stage 1 base environment (counter-trend caution for rounded-top shorts)"
    return "an undefined trend stage"


def _dcr_phrase(context: dict) -> str:
    sig = context.get("dcr_signature", "neutral")
    avg = context.get("recent_dcr_avg", 0.5)
    if sig == "distribution":
        return f"distribution-signature daily close ratio (recent avg {avg:.2f} - closes near lows)"
    if sig == "accumulation":
        return f"accumulation-signature daily close ratio (recent avg {avg:.2f} - closes near highs)"
    return f"neutral daily close ratio (avg {avg:.2f})"


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    l_idx = c["left_rim_idx"]
    r_idx = c["right_rim_idx"]
    dp_idx = c["dome_peak_idx"]

    left_rim = c["left_rim_price"]
    right_rim = c["right_rim_price"]
    dome_peak = c["dome_peak_price"]

    dome_depth_dollars = dome_peak - right_rim
    entry = round(right_rim * 0.999, 2)
    stop = round(dome_peak * 1.015, 2)
    target = round(right_rim - dome_depth_dollars, 2)
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0
    stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

    dome_bars = c["dome_bars"]
    dome_depth_pct = c["dome_depth_pct"] * 100.0
    rim_similarity_pct = (1.0 - c["rim_diff"]) * 100.0
    rim_diff_pct = c["rim_diff"] * 100.0
    roundness_residual = c["roundness_residual"]
    top_width_pct = c["top_width_pct"] * 100.0

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    dcr_phrase = _dcr_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    headline = (
        f"Rounded Top forming on {sym_token} - {dome_bars}-bar inverted-U of "
        f"{dome_depth_pct:.1f}% depth, rim match {rim_similarity_pct:.1f}% "
        f"(${left_rim:.2f}/${right_rim:.2f}), top width "
        f"{top_width_pct:.0f}% (slow rollover, no rally handle). Pivot "
        f"${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Rounded Top - also called the Saucer Top, Dome Top, or "
        f"Wyckoff Distribution Schematic - is one of the slowest and most "
        f"reliable bearish reversal structures in classical technical "
        f"analysis. Richard Wyckoff first codified the Phase A through C "
        f"distribution cycle in 1908 (the slow rolling dome is Phase B, "
        f"the right-side decline is Phase C). It is the bearish mirror of "
        f"the rounded-base accumulation pattern and the cousin of O'Neil's "
        f"saucer top. Structurally, the pattern is a smooth inverted-U "
        f"dome: price rallies from a left rim at ${left_rim:.2f}, "
        f"methodically carves out an arching distribution curve to a high "
        f"at ${dome_peak:.2f} ({dome_depth_pct:.1f}% above the rims), "
        f"then patiently rolls over to a right rim at ${right_rim:.2f} "
        f"within {rim_diff_pct:.2f}% of the left rim "
        f"({rim_similarity_pct:.1f}% rim match). The dome spans "
        f"{dome_bars} bars - distinctly longer than an inverse cup-with-"
        f"handle - and the roundness residual ratio of "
        f"{roundness_residual:.3f} (lower = rounder; negative quadratic "
        f"fit ensures concave-down shape) combined with "
        f"{top_width_pct:.0f}% of bars sitting in the upper 25% of dome "
        f"depth confirms the slow-rollover signature. CRITICALLY, this "
        f"pattern has no handle: the right side of the dome declines "
        f"cleanly through the prior support without the small rally "
        f"consolidation that distinguishes the inverse-cup-with-handle. "
        f"That single feature is the chart language of patient "
        f"distribution that completed before any final squeeze - smart "
        f"money fully unloaded their position during the doming and is "
        f"now ready to let the markdown leg develop. The market mechanic "
        f"is the Wyckoff archetype in reverse: buying climax leads to "
        f"automatic reaction, prolonged doming distributes all the "
        f"available demand (Phase B), and the slow turn lower is the "
        f"'sign of weakness' that signals distribution has completed. "
        f"Bulkowski's research shows rounded tops produce 20-30% "
        f"downside follow-through with high frequency once the right rim "
        f"is broken on volume. Richard Schabacker (1932) was the first to "
        f"formally distinguish the 'saucer top' from sharper reversal "
        f"structures, framing it as the visible footprint of patient "
        f"institutional distribution. Adam Grimes — whose modern empirical "
        f"work in 'The Art and Science of Technical Analysis' updates the "
        f"classical interpretation — emphasizes that the rounded top's "
        f"diagnostic edge comes from the volume signature: persistently "
        f"declining volume across the dome paired with an expansion bar on "
        f"the right-rim break is the highest-probability confirmation, "
        f"echoing the same volume-divergence read on the bullish side."
    )

    why_it_matters = (
        f"This Rounded Top is forming in {stage_phrase} with {ma_phrase} "
        f"alignment against a {regime} regime backdrop and a "
        f"{dcr_phrase}. Volume signature reads {vol_signature}. The "
        f"{rim_similarity_pct:.1f}% rim symmetry and {dome_depth_pct:.1f}% "
        f"dome depth sit in the high-reliability zone for distribution "
        f"patterns: rim matches within 5% indicate that demand at the "
        f"rim-price level has been fully distributed during the topping "
        f"period, and 18-30% dome depth falls in the textbook range where "
        f"institutional distribution has time to complete without "
        f"creating a panic-spike top that often retraces. The roundness "
        f"residual of {roundness_residual:.3f} verifies the inverted-U "
        f"against an inverted-V (a sharp peak often fits a parabola in "
        f"least-squares terms but lacks the time-at-the-top signature) "
        f"and the {top_width_pct:.0f}% top-width fraction confirms "
        f"genuine doming rather than spike-and-collapse dynamics. The "
        f"{dome_bars}-bar duration is the rounded top's defining feature - "
        f"it is intentionally longer than an inverse-cup-and-handle "
        f"because the absence of a rally handle means the entire "
        f"distribution-and-readiness sequence occurred inside the dome "
        f"itself. Patterns shorter than 30 bars typically lack the "
        f"institutional-distribution time signature; patterns over 120 "
        f"bars approach 'rangebound stock' territory and may resolve "
        f"sideways rather than break down. The absence of a handle is "
        f"statistically significant: rounded tops without a handle "
        f"break down with similar frequency to inverse-cup-with-handle "
        f"setups but often produce LARGER follow-through declines "
        f"because the latent selling that would have been triggered by "
        f"a handle squeeze is already concentrated at the breakdown "
        f"pivot. Volume drying through the middle 50% of the dome and "
        f"expanding into the right-side decline (encoded in this "
        f"detection's volume_score component) is the textbook Wyckoff "
        f"signature confirming that distribution has completed and "
        f"supply is returning at the rim-price pivot. Trapped longs near "
        f"${right_rim:.2f} become the next leg's downside fuel, and "
        f"breakdowns below the rim on volume force their liquidation as "
        f"the markdown leg accelerates."
    )

    what_to_watch_for = (
        f"The trigger is a daily close below ${entry:.2f} (the right rim "
        f"at ${right_rim:.2f} minus a small confirmation buffer) on "
        f"volume of at least 1.5x the 20-bar average - that volume "
        f"expansion on the breakdown is non-negotiable because a rounded-"
        f"top break on light tape frequently reverses as a bear trap. "
        f"The ideal trigger bar closes in the lower third of its range "
        f"with a wide red real body, and the next 1-3 bars should hold "
        f"below ${right_rim:.2f} without re-entering the dome. A single "
        f"throwback retest of the rim is normal and often the highest-"
        f"quality short entry, but two-plus closes back above "
        f"${right_rim:.2f} weakens the thesis materially. Measured "
        f"target is ${target:.2f}, derived by subtracting the dome depth "
        f"(${dome_depth_dollars:.2f}) from the right rim - this is the "
        f"conservative measured move; aggressive rounded tops in Stage "
        f"3-to-4 transitions frequently extend 1.5-2x this measured "
        f"move over the 12-26 weeks following the trigger because the "
        f"prior distribution has compressed substantial latent selling "
        f"plus forced liquidation of trapped late-cycle longs. Initial "
        f"stop sits at ${stop:.2f} (1.5% above the dome peak at "
        f"${dome_peak:.2f}) representing a {stop_distance_pct:.1f}% risk "
        f"from entry - risking 1% of account on this short implies a "
        f"position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity, and risking 0.5% halves that. Note that rounded "
        f"tops tend to give wide stops because the structural high is "
        f"deep above the pivot - this is a feature, not a bug; the "
        f"trade is designed for patient swing-or-position holding, not "
        f"intraday-tight risk. Trail stops above each new swing high or "
        f"above the falling 21-EMA after the breakdown. Consider "
        f"covering partial size at 1R to lock in a free trade. Short "
        f"trades require borrow availability and carry overnight gap "
        f"risk that long trades do not - never short a stock you "
        f"couldn't get filled on at the open."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close above the dome "
        f"peak at ${dome_peak:.2f} (stop at ${stop:.2f}, 1.5% above to "
        f"absorb the standard squeeze wick) - that close signals the "
        f"distribution thesis is wrong, demand has reabsorbed supply at "
        f"the dome-peak level, and the underlying uptrend has a high "
        f"probability of resuming, often with a squeeze leg as trapped "
        f"shorts cover into the breakout. Failed rounded tops often "
        f"produce surprisingly aggressive upside follow-through because "
        f"the entire structural resistance has been systematically "
        f"tested over {dome_bars} bars and its failure signals a regime "
        f"change. A subtler failure mode that often precedes the hard "
        f"stop: the breakdown below ${entry:.2f} occurs on weak or "
        f"merely-average volume, the next 1-3 bars fade back into the "
        f"dome, and price spends 3-5 bars churning between "
        f"${right_rim:.2f} and the lower third of the dome without "
        f"sustained decline. That sequence is the textbook 'failed "
        f"breakdown' or Wyckoff spring - it often precedes a sharp "
        f"rally because what looked like distribution may have actually "
        f"been an accumulation rotation in disguise, with market makers "
        f"using the visible neckline as a liquidity grab to cover "
        f"shorts and re-accumulate. Short squeezes off a failed rounded "
        f"top can be violent because the pattern attracts heavy short "
        f"interest from trend-following systems and pattern scanners, "
        f"and uncapped upside loss demands the {stop_distance_pct:.1f}% "
        f"stop be honored without negotiation - widening or removing a "
        f"stop on a failing rounded-top short is one of the fastest "
        f"ways to convert a manageable loss into account-damaging "
        f"exposure because the asymmetric risk profile of a short trade "
        f"(capped reward, uncapped loss) demands tighter discipline "
        f"than long trades. Failed rounded tops in Stage 2 contexts "
        f"(continuing uptrends) are particularly dangerous because the "
        f"failure often transitions directly into a fresh Stage 2 "
        f"markup leg, so size accordingly to the trend stage and never "
        f"average up on a failing breakdown."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Rounded Top",
        "category": "classical",
        "direction": "bearish",
        "start_t": int(bars[l_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[l_idx]["t"]),
                     int(bars[dp_idx]["t"]),
                     int(bars[r_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "cup_curve",
            "anchors": [
                {"t": int(bars[l_idx]["t"]), "price": float(left_rim)},
                {"t": int(bars[dp_idx]["t"]), "price": float(dome_peak)},
                {"t": int(bars[r_idx]["t"]), "price": float(right_rim)},
            ],
            "extras": {
                "dome_depth_pct": round(c["dome_depth_pct"] * 100, 2),
                "rim_similarity_pct": round((1.0 - c["rim_diff"]) * 100, 2),
                "roundness_residual": round(float(c["roundness_residual"]), 4),
                "top_width_pct": round(c["top_width_pct"] * 100, 2),
                "dome_bars": int(c["dome_bars"]),
                "no_handle": True,
                "inverted": True,
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close < {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "dome_peak_plus_1.5pct",
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


register(_PATTERN_ID, detect_rounded_top)
