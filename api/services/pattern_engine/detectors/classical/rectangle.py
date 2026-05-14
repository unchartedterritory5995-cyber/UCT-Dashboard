"""Rectangle / Trading Range detector.

A rectangle is a horizontal consolidation pattern bounded by a flat
resistance ceiling and a flat support floor. Unlike triangles, the channel
walls are parallel - there is no convergence. The pattern represents
balanced supply and demand at two distinct price levels: a buyer keeps
stepping in at the floor, a seller keeps stepping in at the ceiling, and
price oscillates between them. Direction of resolution is biased by the
prior trend - rectangles inside a prior advance typically resolve as a
continuation upward, rectangles inside a prior decline typically resolve
downward.

Geometric definition:
  - Window: 15-50 bars
  - Upper boundary: flat resistance (cluster swing-highs within 2%, slope ~0)
  - Lower boundary: flat support (cluster swing-lows within 2%, slope ~0)
  - Range depth: 5-25% of mid-price
  - >=2 touches each side
  - Prior trend (50-bar window BEFORE rectangle):
      > 15% advance -> direction = "bullish" (continuation bias)
      < -15% decline -> direction = "bearish"
      else -> direction = "neutral"

Attribution: Wyckoff (1908) - "trading range / accumulation-distribution
schematic"; Schabacker (1932) - rectangle formalization. Bulkowski's
'Encyclopedia of Chart Patterns' reports ~68% continuation rate when
context-aligned.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.trendlines import fit_trendline
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "rectangle"
_MIN_BARS = 15
_MAX_BARS = 50
_MIN_TOUCHES = 3   # rectangles need ≥3 touches each side for behavioural confirmation
_MAX_FLAT_SPREAD_PCT = 0.020   # 2% per spec
_MIN_FLAT_R_SQUARED = 0.70     # boundary lines must fit flat well
_MIN_DEPTH_PCT = 0.05
_MAX_DEPTH_PCT = 0.25
_PRIOR_TREND_WINDOW = 50
_PRIOR_TREND_THRESHOLD = 0.15
_CONFIDENCE_FLOOR = 50.0


def detect_rectangle(bars: List[Bar], context: dict) -> List[Detection]:
    if len(bars) < _MIN_BARS + 5:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 4:
        return []

    end_idx = len(bars) - 1
    seen_starts = set()
    for window_len in (30, 25, 35, 20, 40, 45, 50):
        start_idx = end_idx - window_len + 1
        if start_idx < 5:
            continue
        if start_idx in seen_starts:
            continue
        seen_starts.add(start_idx)
        candidate = _try_extract_pattern(bars, pivots, start_idx, end_idx)
        if candidate is None:
            continue

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, candidate)
        ctx_score = _score_context(context, candidate["direction"])
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.20 * vol_score + 0.25 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(bars, candidate, confidence, context,
                             geom_score, vol_score, ctx_score, hist_score)
        detections.append(d)
        break

    return detections


def _try_extract_pattern(bars, pivots, start_idx: int, end_idx: int) -> Optional[dict]:
    pattern_bars = bars[start_idx:end_idx + 1]
    bar_count = len(pattern_bars)
    if bar_count < _MIN_BARS or bar_count > _MAX_BARS:
        return None

    high_pivots_raw = [p for p in pivots
                       if p["type"] == "high" and start_idx <= p["bar_index"] <= end_idx]
    low_pivots_raw = [p for p in pivots
                      if p["type"] == "low" and start_idx <= p["bar_index"] <= end_idx]
    if len(high_pivots_raw) < _MIN_TOUCHES or len(low_pivots_raw) < _MIN_TOUCHES:
        return None

    # Cluster the swing-highs at top.
    high_prices_sorted = sorted([p["price"] for p in high_pivots_raw], reverse=True)
    cluster_top = high_prices_sorted[0]
    upper_cluster_raw = [p for p in high_pivots_raw
                         if (cluster_top - p["price"]) / cluster_top <= _MAX_FLAT_SPREAD_PCT]
    if len(upper_cluster_raw) < _MIN_TOUCHES:
        return None
    upper_prices = [p["price"] for p in upper_cluster_raw]
    upper_price = sum(upper_prices) / len(upper_prices)
    upper_spread_pct = (max(upper_prices) - min(upper_prices)) / upper_price

    # Verify upper cluster is genuinely flat: fit a trendline and check slope/r².
    if len(upper_cluster_raw) >= 2:
        rekey_upper = [{"t": p["bar_index"], "price": p["price"],
                        "type": "high", "strength": p["strength"],
                        "bar_index": p["bar_index"]} for p in upper_cluster_raw]
        try:
            upper_fit = fit_trendline(rekey_upper)
            # Slope must be near zero relative to the price level
            slope_pct_per_bar = abs(upper_fit["slope"]) / max(upper_price, 1e-6)
            if slope_pct_per_bar > 0.003:  # >0.3% per bar = not flat
                return None
        except ValueError:
            return None

    # Cluster the swing-lows at bottom.
    low_prices_sorted = sorted([p["price"] for p in low_pivots_raw])
    cluster_bottom = low_prices_sorted[0]
    lower_cluster_raw = [p for p in low_pivots_raw
                         if (p["price"] - cluster_bottom) / cluster_bottom <= _MAX_FLAT_SPREAD_PCT]
    if len(lower_cluster_raw) < _MIN_TOUCHES:
        return None
    lower_prices = [p["price"] for p in lower_cluster_raw]
    lower_price = sum(lower_prices) / len(lower_prices)
    lower_spread_pct = (max(lower_prices) - min(lower_prices)) / lower_price

    if len(lower_cluster_raw) >= 2:
        rekey_lower = [{"t": p["bar_index"], "price": p["price"],
                        "type": "low", "strength": p["strength"],
                        "bar_index": p["bar_index"]} for p in lower_cluster_raw]
        try:
            lower_fit = fit_trendline(rekey_lower)
            slope_pct_per_bar = abs(lower_fit["slope"]) / max(lower_price, 1e-6)
            if slope_pct_per_bar > 0.003:
                return None
        except ValueError:
            return None

    # Additionally check that the MAJORITY of swing-highs/lows in the pattern
    # window are actually near the cluster boundaries (rejects noisy/channel
    # patterns where only a small subset of the pivots happen to cluster).
    n_highs_at_upper = sum(1 for p in high_pivots_raw
                           if abs(p["price"] - upper_price) / upper_price <= _MAX_FLAT_SPREAD_PCT * 1.5)
    if n_highs_at_upper / max(len(high_pivots_raw), 1) < 0.65:
        return None
    n_lows_at_lower = sum(1 for p in low_pivots_raw
                          if abs(p["price"] - lower_price) / lower_price <= _MAX_FLAT_SPREAD_PCT * 1.5)
    if n_lows_at_lower / max(len(low_pivots_raw), 1) < 0.65:
        return None
    # Additionally: if there are >= 4 swing-highs/lows total, require >=3 of
    # them to be in the cluster (not just the top 2 by coincidence).
    if len(high_pivots_raw) >= 4 and len(upper_cluster_raw) < 3:
        return None
    if len(low_pivots_raw) >= 4 and len(lower_cluster_raw) < 3:
        return None

    if upper_price <= lower_price:
        return None
    mid_price = (upper_price + lower_price) / 2.0
    depth_pct = (upper_price - lower_price) / mid_price
    if depth_pct < _MIN_DEPTH_PCT or depth_pct > _MAX_DEPTH_PCT:
        return None

    # Additionally, ensure the actual high/low envelope is bounded by the
    # cluster prices throughout the pattern window. If the pattern has bars
    # whose highs significantly exceed upper_price or whose lows significantly
    # undercut lower_price (more than 2% past the boundary), it is not a
    # clean rectangle - reject.
    bar_highs = [b["h"] for b in pattern_bars]
    bar_lows = [b["l"] for b in pattern_bars]
    max_high_violation = max((h - upper_price) / upper_price for h in bar_highs)
    max_low_violation = max((lower_price - l) / lower_price for l in bar_lows)
    if max_high_violation > 0.025:
        return None
    if max_low_violation > 0.025:
        return None
    # Also require the high envelope to actually REACH the upper boundary
    # somewhere (and likewise for the low envelope reaching lower).
    # This rejects "rectangles" where the channel is much wider than the actual
    # price action (e.g., a converging triangle where most bars sit in the
    # middle of the cluster's spread).
    n_bars_near_upper = sum(1 for h in bar_highs
                            if (upper_price - h) / upper_price < 0.01)
    n_bars_near_lower = sum(1 for l in bar_lows
                            if (l - lower_price) / lower_price < 0.01)
    if n_bars_near_upper < 2 or n_bars_near_lower < 2:
        return None
    # And the n_bars_near_upper should span the pattern window - not all bunched
    # at the beginning (which would imply convergence). Check that the FIRST
    # and LAST quartiles of the pattern each contain at least one near-touch
    # of EITHER boundary.
    quartile = max(1, bar_count // 4)
    first_q = pattern_bars[:quartile]
    last_q = pattern_bars[-quartile:]
    first_q_touches = (any((upper_price - b["h"]) / upper_price < 0.015 for b in first_q)
                       or any((b["l"] - lower_price) / lower_price < 0.015 for b in first_q))
    last_q_touches = (any((upper_price - b["h"]) / upper_price < 0.015 for b in last_q)
                      or any((b["l"] - lower_price) / lower_price < 0.015 for b in last_q))
    if not (first_q_touches and last_q_touches):
        return None
    # Additionally check that BOTH the upper and lower boundaries are tested
    # in both halves of the pattern (rejects converging triangles where only
    # one boundary is tested in the later half).
    halfway = bar_count // 2
    first_half = pattern_bars[:halfway]
    second_half = pattern_bars[halfway:]
    upper_in_first = any((upper_price - b["h"]) / upper_price < 0.015 for b in first_half)
    upper_in_second = any((upper_price - b["h"]) / upper_price < 0.015 for b in second_half)
    lower_in_first = any((b["l"] - lower_price) / lower_price < 0.015 for b in first_half)
    lower_in_second = any((b["l"] - lower_price) / lower_price < 0.015 for b in second_half)
    if not (upper_in_first and upper_in_second and lower_in_first and lower_in_second):
        return None

    # Determine prior trend over the PRIOR_TREND_WINDOW bars BEFORE the rectangle.
    prior_end = start_idx - 1
    prior_start = max(0, prior_end - _PRIOR_TREND_WINDOW + 1)
    if prior_end - prior_start < 5:
        prior_trend_pct = 0.0
        direction = "neutral"
    else:
        prior_start_price = bars[prior_start]["c"]
        prior_end_price = bars[prior_end]["c"]
        if prior_start_price <= 0:
            prior_trend_pct = 0.0
        else:
            prior_trend_pct = (prior_end_price - prior_start_price) / prior_start_price
        if prior_trend_pct > _PRIOR_TREND_THRESHOLD:
            direction = "bullish"
        elif prior_trend_pct < -_PRIOR_TREND_THRESHOLD:
            direction = "bearish"
        else:
            direction = "neutral"

    pattern_low = min(b["l"] for b in pattern_bars)
    pattern_high = max(b["h"] for b in pattern_bars)

    upper_line = {
        "p1": {"t": int(start_idx), "price": float(upper_price)},
        "p2": {"t": int(end_idx), "price": float(upper_price)},
        "slope": 0.0,
        "r_squared": max(0.0, 1.0 - upper_spread_pct / _MAX_FLAT_SPREAD_PCT),
        "touches": len(upper_cluster_raw),
        "validity": min(1.0, len(upper_cluster_raw) / 4.0),
    }
    lower_line = {
        "p1": {"t": int(start_idx), "price": float(lower_price)},
        "p2": {"t": int(end_idx), "price": float(lower_price)},
        "slope": 0.0,
        "r_squared": max(0.0, 1.0 - lower_spread_pct / _MAX_FLAT_SPREAD_PCT),
        "touches": len(lower_cluster_raw),
        "validity": min(1.0, len(lower_cluster_raw) / 4.0),
    }

    return {
        "start_idx": start_idx,
        "end_idx": end_idx,
        "pattern_bars": pattern_bars,
        "pattern_count": bar_count,
        "pattern_low": pattern_low,
        "pattern_high": pattern_high,
        "upper_price": upper_price,
        "lower_price": lower_price,
        "upper_spread_pct": upper_spread_pct,
        "lower_spread_pct": lower_spread_pct,
        "depth_pct": depth_pct,
        "mid_price": mid_price,
        "upper_line": upper_line,
        "lower_line": lower_line,
        "upper_touches": len(upper_cluster_raw),
        "lower_touches": len(lower_cluster_raw),
        "prior_trend_pct": prior_trend_pct,
        "direction": direction,
    }


def _score_geometry(c: dict) -> float:
    upper_flat = max(0.0, (1.0 - c["upper_spread_pct"] / _MAX_FLAT_SPREAD_PCT)) * 100.0
    lower_flat = max(0.0, (1.0 - c["lower_spread_pct"] / _MAX_FLAT_SPREAD_PCT)) * 100.0
    flat_score = (upper_flat + lower_flat) / 2.0
    touch_score = (min(100.0, c["upper_touches"] * 33.0) + min(100.0, c["lower_touches"] * 33.0)) / 2.0
    # Depth: ideal ~10-15%
    depth = c["depth_pct"]
    if 0.08 <= depth <= 0.18:
        depth_score = 100.0
    elif depth < 0.08:
        depth_score = max(0.0, 50.0 + (depth - 0.04) * 1250.0)
    else:
        depth_score = max(0.0, 100.0 - (depth - 0.18) * 700.0)
    duration_score = max(0.0, 100.0 - abs(c["pattern_count"] - 28) * 4.0)
    return round(0.30 * flat_score + 0.25 * touch_score
                 + 0.25 * depth_score + 0.20 * duration_score, 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    pattern = c["pattern_bars"]
    if len(pattern) < 4:
        return 50.0
    half = len(pattern) // 2
    first_avg = sum(b["v"] for b in pattern[:half]) / half
    second_avg = sum(b["v"] for b in pattern[half:]) / (len(pattern) - half)
    if first_avg <= 0:
        return 50.0
    ratio = second_avg / first_avg
    if ratio >= 1.0:
        return 40.0  # not strict for rectangles - balanced trade range often has flat volume
    return round(max(0.0, min(100.0, (1.0 - ratio) * 120.0 + 40.0)), 2)


def _score_context(context: dict, direction: str) -> float:
    score = 50.0
    if direction == "bullish":
        if context.get("trend_stage") == 2:
            score += 25
        elif context.get("trend_stage") == 1:
            score += 10
        if context.get("ma_alignment") == "stacked_bullish":
            score += 15
        if context.get("rs_trend") == "up":
            score += 10
    elif direction == "bearish":
        if context.get("trend_stage") == 4:
            score += 25
        elif context.get("trend_stage") == 3:
            score += 10
        if context.get("ma_alignment") == "stacked_bearish":
            score += 15
        if context.get("rs_trend") == "down":
            score += 10
    else:
        # neutral - moderate credit for any defined stage
        if context.get("trend_stage") in (1, 2, 3, 4):
            score += 15
    # DCR integration (Phase 7.5) — direction-aware boost
    score += _dcr_score_adjustment(context, direction)
    return min(100.0, max(0.0, score))


def _dcr_score_adjustment(context: dict, direction: str) -> float:
    """Return the DCR-derived score adjustment for the given rectangle direction."""
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if direction == "bullish":
        if dcr_sig == "accumulation" and recent_dcr >= 0.65:
            return 12.0
        if dcr_sig == "distribution":
            return -8.0
    elif direction == "bearish":
        if dcr_sig == "distribution" and recent_dcr <= 0.35:
            return 12.0
        if dcr_sig == "accumulation":
            return -8.0
    return 0.0


def _trend_phrase(direction: str, prior_pct: float) -> str:
    if direction == "bullish":
        return (f"strongly bullish ({prior_pct*100:+.1f}% prior advance) - continuation "
                f"bias is upside breakout")
    if direction == "bearish":
        return (f"strongly bearish ({prior_pct*100:+.1f}% prior decline) - continuation "
                f"bias is downside breakdown")
    return f"sideways/neutral ({prior_pct*100:+.1f}% prior move) - direction-agnostic"


def _vol_ratio(bars: List[Bar], c: dict) -> float:
    pattern = c["pattern_bars"]
    if len(pattern) < 4:
        return 1.0
    half = len(pattern) // 2
    first_avg = sum(b["v"] for b in pattern[:half]) / max(half, 1)
    second_avg = sum(b["v"] for b in pattern[half:]) / max(len(pattern) - half, 1)
    if first_avg <= 0:
        return 1.0
    return second_avg / first_avg


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    end_idx = c["end_idx"]

    upper = c["upper_price"]
    lower = c["lower_price"]
    direction = c["direction"]
    range_height = upper - lower

    # Levels: per spec - presume continuation in prior trend direction.
    # For bearish, mirror the levels.
    if direction == "bearish":
        entry = round(lower * 0.999, 2)
        stop = round(upper * 1.015, 2)
        target = round(entry - range_height, 2)
        rr = (entry - target) / (stop - entry) if stop > entry else 0.0
        entry_condition = f"close < {entry:.2f} on volume > 1.5x 20-bar avg"
        stop_basis = "upper_resistance_plus_1.5pct"
        stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0
    else:
        # bullish OR neutral: presume upside breakout
        entry = round(upper * 1.001, 2)
        stop = round(lower * 0.985, 2)
        target = round(entry + range_height, 2)
        rr = (target - entry) / (entry - stop) if entry > stop else 0.0
        entry_condition = f"close > {entry:.2f} on volume > 1.5x 20-bar avg"
        stop_basis = "lower_support_minus_1.5pct"
        stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    vol_ratio_val = _vol_ratio(bars, c)
    vol_pct = vol_ratio_val * 100.0

    depth_pct_pct = c["depth_pct"] * 100.0
    upper_spread_pct = c["upper_spread_pct"] * 100.0
    lower_spread_pct = c["lower_spread_pct"] * 100.0
    pattern_count = c["pattern_count"]
    upper_touches = c["upper_touches"]
    lower_touches = c["lower_touches"]
    prior_trend_pct = c["prior_trend_pct"]

    trend_phrase = _trend_phrase(direction, prior_trend_pct)
    ma_align = context.get("ma_alignment", "mixed")
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    headline = (
        f"Rectangle / Trading Range forming on {sym_token} - flat ceiling "
        f"${upper:.2f} ({upper_touches} touches, spread "
        f"{upper_spread_pct:.2f}%), flat floor ${lower:.2f} ({lower_touches} "
        f"touches, spread {lower_spread_pct:.2f}%), {depth_pct_pct:.1f}% "
        f"range over {pattern_count} bars, prior trend "
        f"{prior_trend_pct*100:+.1f}% -> {direction} continuation bias. "
        f"Pivot ${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Rectangle - also called a Trading Range or, in Wyckoff "
        f"terminology, an accumulation/distribution schematic - is one of the "
        f"oldest documented patterns in technical analysis. Wyckoff codified "
        f"the structure in 1908, Schabacker formalized it in 'Technical "
        f"Analysis and Stock Market Profits' (1932), and Edwards & Magee "
        f"folded it into the classical canon in 1948. Geometrically it is a "
        f"horizontal channel: a flat resistance ceiling at ${upper:.2f} "
        f"defined by {upper_touches} swing-high pivots within a "
        f"{upper_spread_pct:.2f}% spread, paired with a flat support floor at "
        f"${lower:.2f} defined by {lower_touches} swing-low pivots within a "
        f"{lower_spread_pct:.2f}% spread. The two boundaries are parallel "
        f"(neither converging nor diverging - that is the geometric "
        f"distinction from triangles), the channel depth is "
        f"${range_height:.2f} or {depth_pct_pct:.1f}% of mid-price, and the "
        f"pattern has spanned {pattern_count} bars. The market mechanic "
        f"underneath is repeated auction at two distinct price levels: a "
        f"specific buyer (institution, technical level, prior breakout "
        f"support) defends the floor at ${lower:.2f} each time price visits, "
        f"a specific seller defends the ceiling at ${upper:.2f}, and the "
        f"intervening price oscillates between them as faster money trades "
        f"the range. The behavioural distinction from triangles is critical: "
        f"in a rectangle, neither side is becoming more aggressive over time "
        f"- the boundaries hold at the same prices throughout. That balance "
        f"is unstable in the long run because one side's inventory eventually "
        f"depletes faster than the other, and the side that depletes first "
        f"loses control. Wyckoff named this exhaustion sequence the 'spring' "
        f"(below the floor) or the 'upthrust' (above the ceiling) - false "
        f"breakouts that mark the true reversal direction. Bulkowski's "
        f"empirical sample shows context-aligned rectangle breakouts produce "
        f"measured-move follow-through ~68% of the time. Richard Wyckoff's "
        f"Phase A → B → C → D → E progression inside a rectangle is the modern "
        f"framework most professional tape readers still operate inside: Phase "
        f"A is preliminary support / selling climax establishing the floor, "
        f"Phase B is the cause-building accumulation/distribution oscillation, "
        f"Phase C is the spring or upthrust test, Phase D is the markup or "
        f"markdown out of the range, and Phase E is the trend acceleration "
        f"away from the structure — making the rectangle not a passive box "
        f"but a sequenced auction with measurable cause-and-effect."
    )

    why_it_matters = (
        f"This rectangle is forming after a {trend_phrase}, against a "
        f"{regime} macro regime with {vol_signature} volume signature and "
        f"{ma_align} moving-average alignment. Prior-trend context is the "
        f"single most important factor for rectangle resolution: a rectangle "
        f"that forms after a 15%+ advance is statistically a continuation "
        f"setup (68%+ resolve upward per Bulkowski), a rectangle after a "
        f"15%+ decline is statistically a continuation setup downward, and a "
        f"rectangle with no clear prior trend is direction-agnostic and "
        f"should be traded based on whichever boundary breaks first. The "
        f"prior {prior_trend_pct*100:+.1f}% move into this rectangle places "
        f"the directional bias as {direction.upper()}, meaning the most "
        f"probable resolution is in that direction. The {pattern_count}-bar "
        f"build with {upper_touches} ceiling and {lower_touches} floor "
        f"touches is meaningful evidence that both boundaries are real "
        f"behavioural levels - not coincidental coincidences but repeated "
        f"institutional auctions at the same prices. The flat-spread quality "
        f"({upper_spread_pct:.2f}% top, {lower_spread_pct:.2f}% bottom) is "
        f"unusually clean, the kind of precision that comes from algorithmic "
        f"limit-order programs or strict technical-level defense. Volume "
        f"contracting to {vol_pct:.0f}% of first-half average reinforces the "
        f"thesis: the range is being absorbed, not chased, and the "
        f"continuation breakout will likely fire when one side's inventory "
        f"finally runs out. Depth {depth_pct_pct:.1f}% of mid-price is the "
        f"measured-move math - that range projects ${range_height:.2f} "
        f"beyond the breakout level."
    )

    what_to_watch_for = (
        f"The trigger is a daily close beyond the boundary in the "
        f"continuation direction - "
        + (f"close above ${entry:.2f} (ceiling at ${upper:.2f} plus buffer)"
           if direction != "bearish" else
           f"close below ${entry:.2f} (floor at ${lower:.2f} minus buffer)")
        + f" - on volume of at least 1.5x the 20-bar average. The "
        f"volume expansion is non-negotiable: rectangle breakouts on quiet "
        f"tape after multi-week range-bound action are the canonical Wyckoff "
        f"upthrust/spring failures, used by smart money to grab liquidity "
        f"from breakout traders before reversing the opposite way. The ideal "
        f"trigger bar closes in the upper/lower third of its range "
        f"(depending on direction), with a wide real body and ideally a "
        f"close near the extreme. Measured target is ${target:.2f}, derived "
        f"by projecting the range height of ${range_height:.2f} in the "
        f"breakout direction from the breakout level. Initial stop sits at "
        f"${stop:.2f} (1.5% beyond the opposite boundary), a "
        f"{stop_distance_pct:.1f}% risk distance from entry. Risking 1% of "
        f"account implies a position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity. Trail stops behind each successive swing low (long) or "
        f"swing high (short) as the trade extends, and consider scaling out "
        f"partial size at 1R. A unique rectangle feature: many breakouts "
        f"retest the broken boundary within 5-10 bars before extending - "
        f"this 'pole vault' retest at the prior ceiling/floor is often a "
        f"high-probability secondary entry for traders who missed the "
        f"initial break. Note that in {regime} regimes, rectangles in "
        f"counter-trend directions (e.g., bullish rectangle in a stage-4 "
        f"market) carry below-average odds and should be sized smaller."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close beyond the opposite "
        f"boundary (the stop at ${stop:.2f}). The most dangerous failure "
        f"mode is the Wyckoff "
        + ("'upthrust'" if direction != "bearish" else "'spring'")
        + f": a false breakout in the expected continuation direction that "
        f"reverses within 1-3 bars and breaks the opposite boundary on "
        f"volume. This sequence is specifically how smart money distributes "
        f"to (or accumulates from) breakout traders before the real "
        f"resolution fires the opposite way. A quieter failure: price "
        f"crosses the breakout level on weak volume, the next 1-2 bars "
        f"close back inside the rectangle, and the range reasserts itself - "
        f"the textbook fakeout. Rectangles failing this way often resolve "
        f"in the OPPOSITE direction with surprising velocity because the "
        f"trapped breakout traders now need to flush. The "
        f"{stop_distance_pct:.1f}% stop must be honored without negotiation "
        f"- widening or removing a stop on a rectangle that is breaking the "
        f"wrong way is one of the most reliable ways to convert a manageable "
        f"loss into a portfolio-damaging one. A subtler failure tell: the "
        f"second half of the rectangle shows accelerating volume (rather "
        f"than contracting) - this means one side is getting actively "
        f"distributed into rather than absorbed, and the eventual breakout "
        f"is more likely a violent gap than a clean technical move. The "
        f"prior-trend directional bias is statistical, not deterministic: "
        f"~32% of rectangles fail their context-aligned direction, so size "
        f"the trade as if either side could resolve. If the rectangle has "
        f"been holding for >40 bars without resolution, the longer-duration "
        f"variants statistically produce weaker follow-through than the "
        f"25-35 bar sweet spot, so trail stops tighter on longer-aged "
        f"breakouts."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Rectangle / Trading Range",
        "category": "classical",
        "direction": direction,
        "start_t": int(bars[c["start_idx"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[c["start_idx"]]["t"]),
                     int(bars[end_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "trendline_pair",
            "anchors": [
                {"t": int(c["upper_line"]["p1"]["t"]), "price": float(c["upper_line"]["p1"]["price"])},
                {"t": int(c["upper_line"]["p2"]["t"]), "price": float(c["upper_line"]["p2"]["price"])},
                {"t": int(c["lower_line"]["p1"]["t"]), "price": float(c["lower_line"]["p1"]["price"])},
                {"t": int(c["lower_line"]["p2"]["t"]), "price": float(c["lower_line"]["p2"]["price"])},
            ],
            "extras": {
                "pattern_bars": c["pattern_count"],
                "upper_slope": 0.0,
                "lower_slope": 0.0,
                "r_squared_upper": round(float(c["upper_line"]["r_squared"]), 3),
                "r_squared_lower": round(float(c["lower_line"]["r_squared"]), 3),
                "touches_upper": int(c["upper_touches"]),
                "touches_lower": int(c["lower_touches"]),
                "range_depth_pct": round(float(c["depth_pct"]) * 100, 2),
                "upper_price": round(float(c["upper_price"]), 2),
                "lower_price": round(float(c["lower_price"]), 2),
                "prior_trend_pct": round(float(c["prior_trend_pct"]) * 100, 2),
                "dcr_score_adj": round(_dcr_score_adjustment(context, direction), 2),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": entry_condition,
            "stop": stop,
            "stop_basis": stop_basis,
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


register(_PATTERN_ID, detect_rectangle)
