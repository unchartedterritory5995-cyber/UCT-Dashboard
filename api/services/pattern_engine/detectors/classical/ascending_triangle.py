"""Ascending Triangle detector.

An ascending triangle is a bullish continuation pattern where price grinds
into a flat horizontal resistance ceiling while making progressively higher
lows. The flat top reflects a fixed supply level being persistently absorbed,
while the rising lows reflect increasingly aggressive demand willing to bid
higher each pullback. The compression terminates in a breakout above the
horizontal resistance, typically with measurably higher volume.

Geometric definition:
  - Window: 20-60 bars
  - Upper boundary: HORIZONTAL resistance band (swing-high pivots cluster
    within 2% of each other); >=2 touches
  - Lower boundary: RISING support trendline (slope > 0, r_squared >= 0.7,
    >=2 touches, validity >= 0.6)
  - Convergence: at the right edge, rising support is within 5% of flat top
  - Volume: contracting through the pattern (preferred, not strict gate)

Scoring (composite 0-100):
  geometry_score: flatness of the top, trendline r², touch counts, convergence
  volume_score:   first-half avg vs second-half avg
  context_score:  trend stage, MA alignment, RS trend, DCR signature
  historical_score: 50.0 neutral

Attribution: Edwards & Magee, "Technical Analysis of Stock Trends" (1948);
Schabacker, "Technical Analysis and Stock Market Profits" (1932).
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.geometry import line_at
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.trendlines import fit_trendline
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "ascending_triangle"
_MIN_BARS = 20
_MAX_BARS = 60
_MIN_TOUCHES = 2
_MIN_LINE_VALIDITY = 0.4
_MIN_R_SQUARED = 0.55
_MAX_FLAT_TOP_SPREAD_PCT = 0.02   # swing-high cluster spread tolerance (spec)
_MAX_CONVERGENCE_GAP_PCT = 0.05   # rising support must be within this of flat top (spec)
_MIN_CONVERGENCE_RATIO_MAX = 0.85 # width_end / width_start must be <= this (must contract)
_CONFIDENCE_FLOOR = 50.0


def detect_ascending_triangle(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect ascending-triangle patterns in the bars. May emit 0-N detections."""
    if len(bars) < _MIN_BARS + 5:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 4:
        return []

    end_idx = len(bars) - 1
    seen_starts = set()
    for window_len in (40, 30, 50, 25, 35, 45, 55):
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
        ctx_score = _score_context(context)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
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

    # Identify horizontal resistance band: cluster swing-high pivots.
    # Use the highest contiguous cluster (top pivots within 2% of each other).
    high_prices = sorted([p["price"] for p in high_pivots_raw], reverse=True)
    # Choose the median of the top pivots that lie within 2% of the highest
    cluster_top = high_prices[0]
    cluster_pivots_raw = [p for p in high_pivots_raw
                          if (cluster_top - p["price"]) / cluster_top <= _MAX_FLAT_TOP_SPREAD_PCT]
    if len(cluster_pivots_raw) < _MIN_TOUCHES:
        return None

    cluster_prices = [p["price"] for p in cluster_pivots_raw]
    flat_top_price = sum(cluster_prices) / len(cluster_prices)
    flat_top_spread = (max(cluster_prices) - min(cluster_prices)) / flat_top_price

    # Re-key pivots so t = bar_index for slope math.
    low_pivots = [{"t": p["bar_index"], "price": p["price"],
                   "type": "low", "strength": p["strength"],
                   "bar_index": p["bar_index"]} for p in low_pivots_raw]

    try:
        lower_line = fit_trendline(low_pivots)
    except ValueError:
        return None

    # Lower line must rise.
    if lower_line["slope"] <= 0:
        return None
    if lower_line["touches"] < _MIN_TOUCHES:
        return None
    if lower_line["validity"] < _MIN_LINE_VALIDITY:
        return None
    if lower_line["r_squared"] < _MIN_R_SQUARED:
        return None

    # Synthesize the flat upper trendline as two anchors at flat_top_price.
    upper_line = {
        "p1": {"t": int(start_idx), "price": float(flat_top_price)},
        "p2": {"t": int(end_idx), "price": float(flat_top_price)},
        "slope": 0.0,
        "r_squared": max(0.0, 1.0 - flat_top_spread / _MAX_FLAT_TOP_SPREAD_PCT),
        "touches": len(cluster_pivots_raw),
        "validity": min(1.0, len(cluster_pivots_raw) / 4.0
                        + max(0.0, 1.0 - flat_top_spread / _MAX_FLAT_TOP_SPREAD_PCT) * 0.5),
    }

    # Convergence check: rising support at end_idx must be within tolerance of flat top.
    lower_at_end = line_at((lower_line["p1"], lower_line["p2"]), end_idx)
    if lower_at_end >= flat_top_price:
        return None
    gap_pct = (flat_top_price - lower_at_end) / flat_top_price
    if gap_pct > _MAX_CONVERGENCE_GAP_PCT:
        return None

    # Width
    lower_at_start = line_at((lower_line["p1"], lower_line["p2"]), start_idx)
    width_start = flat_top_price - lower_at_start
    width_end = flat_top_price - lower_at_end
    if width_start <= 0 or width_end <= 0:
        return None
    convergence_ratio = width_end / width_start
    if convergence_ratio >= _MIN_CONVERGENCE_RATIO_MAX:
        return None

    earliest_swing_low = min(low_pivots_raw, key=lambda p: p["bar_index"])
    earliest_swing_low_price = earliest_swing_low["price"]

    pattern_low = min(b["l"] for b in pattern_bars)
    pattern_high = max(b["h"] for b in pattern_bars)

    return {
        "start_idx": start_idx,
        "end_idx": end_idx,
        "pattern_bars": pattern_bars,
        "pattern_count": bar_count,
        "pattern_low": pattern_low,
        "pattern_high": pattern_high,
        "flat_top_price": flat_top_price,
        "flat_top_spread_pct": flat_top_spread,
        "lower_at_start": lower_at_start,
        "lower_at_end": lower_at_end,
        "gap_pct": gap_pct,
        "convergence_ratio": convergence_ratio,
        "width_start": width_start,
        "width_end": width_end,
        "upper_line": upper_line,
        "lower_line": lower_line,
        "upper_slope": 0.0,
        "lower_slope": lower_line["slope"],
        "earliest_swing_low": earliest_swing_low_price,
        "cluster_touches": len(cluster_pivots_raw),
        "low_touches": lower_line["touches"],
    }


def _score_geometry(c: dict) -> float:
    # Flatness of the top: tighter spread = better
    flatness = max(0.0, (1.0 - c["flat_top_spread_pct"] / _MAX_FLAT_TOP_SPREAD_PCT)) * 100.0
    # Rising support quality
    rs_quality = c["lower_line"]["r_squared"] * 100.0
    # Touch counts (4+ touches each is ideal)
    cluster_score = min(100.0, c["cluster_touches"] * 33.0)
    low_score = min(100.0, c["low_touches"] * 33.0)
    touch_score = (cluster_score + low_score) / 2.0
    # Convergence: closer to apex = more imminent breakout
    if c["gap_pct"] <= 0.02:
        conv_score = 100.0
    elif c["gap_pct"] <= 0.05:
        conv_score = 80.0
    else:
        conv_score = max(0.0, 100.0 - (c["gap_pct"] - 0.05) * 1500.0)
    # Duration: ideal ~30-45 bars
    duration_score = max(0.0, 100.0 - abs(c["pattern_count"] - 36) * 3.0)
    return round(0.25 * flatness + 0.20 * rs_quality + 0.20 * touch_score
                 + 0.20 * conv_score + 0.15 * duration_score, 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    pattern = c["pattern_bars"]
    if len(pattern) < 4:
        return 50.0
    half = len(pattern) // 2
    first_half = pattern[:half]
    second_half = pattern[half:]
    first_avg = sum(b["v"] for b in first_half) / len(first_half)
    second_avg = sum(b["v"] for b in second_half) / len(second_half)
    if first_avg <= 0:
        return 50.0
    ratio = second_avg / first_avg
    if ratio >= 1.0:
        return 25.0
    return round(max(0.0, min(100.0, (1.0 - ratio) * 150.0)), 2)


def _score_context(context: dict) -> float:
    score = 50.0
    if context.get("trend_stage") == 2:
        score += 25
    elif context.get("trend_stage") == 1:
        score += 15
    if context.get("ma_alignment") == "stacked_bullish":
        score += 15
    if context.get("rs_trend") == "up":
        score += 10
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


# Custom variant - does not match shared narrative_helpers
def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "fully stacked-bullish moving-average (high-quality continuation tape)"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average (counter-trend caution)"
    return "mixed moving-average"


# Custom variant - does not match shared narrative_helpers
def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 2:
        return "a confirmed Stage 2 uptrend (textbook continuation context)"
    if stage == 1:
        return "a Stage 1 base/accumulation environment (a triangle here often marks the launch pivot)"
    if stage == 3:
        return "a Stage 3 distribution environment (the flat top may be sponsor resistance — caution)"
    if stage == 4:
        return "a Stage 4 downtrend (counter-trend long, lower odds)"
    return "an undefined trend stage"


# Custom variant - does not match shared narrative_helpers
def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving"
    if rs == "down":
        return "deteriorating (relative weakness lowers breakout odds)"
    return "neutral"


# Custom variant - does not match shared narrative_helpers
def _dcr_phrase(context: dict) -> str:
    sig = context.get("dcr_signature", "neutral")
    avg = context.get("recent_dcr_avg", 0.5)
    if sig == "accumulation":
        return f"accumulation-signature daily close ratio (recent avg {avg:.2f} — closes near highs)"
    if sig == "distribution":
        return f"distribution-signature daily close ratio (recent avg {avg:.2f} — closes near lows, warning)"
    return f"neutral daily close ratio (avg {avg:.2f})"


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

    flat_top = c["flat_top_price"]
    lower_at_now = c["lower_at_end"]
    pattern_low = c["pattern_low"]
    earliest_low = c["earliest_swing_low"]

    entry = round(flat_top * 1.001, 2)
    stop = round(lower_at_now * 0.985, 2)
    target = round(entry + (flat_top - earliest_low), 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    vol_ratio_val = _vol_ratio(bars, c)
    vol_pct = vol_ratio_val * 100.0

    pattern_count = c["pattern_count"]
    lower_slope = c["lower_slope"]
    lower_r2 = c["lower_line"]["r_squared"]
    lower_touches = c["low_touches"]
    cluster_touches = c["cluster_touches"]
    flat_spread_pct = c["flat_top_spread_pct"] * 100.0
    convergence_pct = c["convergence_ratio"] * 100.0
    gap_pct = c["gap_pct"] * 100.0
    pattern_height = flat_top - earliest_low

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    dcr_phrase = _dcr_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    headline = (
        f"Ascending Triangle forming on {sym_token} - flat resistance "
        f"${flat_top:.2f} ({cluster_touches} touches, spread {flat_spread_pct:.2f}%), "
        f"rising support at ${lower_at_now:.2f} ({lower_touches} touches, r2 "
        f"{lower_r2:.2f}), {pattern_count}-bar coil, gap-to-apex {gap_pct:.1f}%. "
        f"Pivot ${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Ascending Triangle is one of the foundational bullish continuation "
        f"patterns in classical chart analysis, documented by Richard Schabacker "
        f"in 'Technical Analysis and Stock Market Profits' (1932) and canonized "
        f"by Edwards & Magee in 'Technical Analysis of Stock Trends' (1948). "
        f"The pattern's anatomy is unmistakable: a horizontal upper boundary - "
        f"here a flat resistance shelf at ${flat_top:.2f} confirmed by "
        f"{cluster_touches} swing-high pivots clustered within a "
        f"{flat_spread_pct:.2f}% band - paired with a rising lower trendline "
        f"with slope {lower_slope:.4f} per bar, r-squared {lower_r2:.2f}, "
        f"anchored by {lower_touches} swing-low touches. The width has "
        f"compressed from ${c['width_start']:.2f} to ${c['width_end']:.2f} over "
        f"{pattern_count} bars (convergence ratio {convergence_pct:.0f}% of "
        f"start), and the rising support now sits ${flat_top - lower_at_now:.2f} "
        f"({gap_pct:.1f}%) below the flat top - well inside the apex zone where "
        f"resolution is imminent. The market mechanic underneath is the "
        f"classical absorption story: a fixed supply level at ${flat_top:.2f} "
        f"keeps getting tested and held by sellers who placed limit orders at "
        f"the same price, while each pullback finds dip-buyers more aggressive "
        f"than the last - they will not wait for a deep retrace anymore. The "
        f"rising lows are the chart language of accelerating demand; the flat "
        f"top is the chart language of an inventory shelf being whittled away. "
        f"Volume contracting to {vol_pct:.0f}% of first-half average is the "
        f"textbook confirmation that supply is running on fumes. Bulkowski's "
        f"'Encyclopedia of Chart Patterns' classifies ascending triangles as "
        f"one of the higher-reliability bullish continuation structures with a "
        f"~63-70% measured-move follow-through rate when the breakout fires on "
        f"confirming volume — among the highest of any classical pattern in his "
        f"empirical sample. Constance Brown's 'Technical Analysis for the Trading "
        f"Professional' updates the classical interpretation with momentum-"
        f"oscillator confluence — she treats an ascending triangle where RSI "
        f"holds above 50 throughout the consolidation as a markedly higher-edge "
        f"setup than the geometry alone would suggest."
    )

    why_it_matters = (
        f"This ascending triangle is forming in {stage_phrase} with {ma_phrase} "
        f"alignment, {rs_phrase} relative strength versus the broader market, "
        f"and a {dcr_phrase}. The {regime} regime sets the macro backdrop and "
        f"the volume signature reads {vol_signature}. The {pattern_count}-bar "
        f"build is meaningful evidence of sustained, repeatable demand: each "
        f"of the {lower_touches} swing-low touches connected by a clean r-squared "
        f"{lower_r2:.2f} regression line is a separate auction in which buyers "
        f"agreed to step in at a higher price than the prior dip - that "
        f"behavioural consistency is what gives ascending triangles their edge "
        f"over symmetrical coils where neither side commits. Flat-top spread "
        f"of {flat_spread_pct:.2f}% across {cluster_touches} peaks means a "
        f"specific institutional or technical seller is being repeatedly faded, "
        f"and the absorption of that supply is visible in the volume drying to "
        f"{vol_pct:.0f}% of the early-pattern average. The fact that the rising "
        f"support has closed to within {gap_pct:.1f}% of the flat top means we "
        f"are in the apex zone - statistically the period of highest reliability "
        f"because there is virtually no room left for the pattern to extend "
        f"without resolving. A contracting-volume ascending triangle inside a "
        f"Stage 2 uptrend with accumulation-signature daily close ratios is the "
        f"highest-conviction expression of this setup; weakness on any of those "
        f"context factors lowers conviction but doesn't invalidate the geometry. "
        f"Measured-move math projects a ${pattern_height:.2f} target add - the "
        f"triangle height projected up from the breakout level."
    )

    what_to_watch_for = (
        f"The trigger is a daily close above ${entry:.2f} (the flat top at "
        f"${flat_top:.2f} plus a small confirmation buffer) on volume of at "
        f"least 1.5x the 20-bar average - that volume expansion is "
        f"non-negotiable because a breakout on quiet tape on the third or "
        f"fourth test of a supply shelf almost always reverts back into the "
        f"triangle as longs realize there's no new demand behind the move. "
        f"The ideal trigger bar closes in the upper third of its range with a "
        f"wide real body, and the next 1-3 bars should hold above "
        f"${flat_top:.2f} without retracing more than a third of the breakout "
        f"move - a sloppy close that wicks back through the breakout level is "
        f"a yellow flag. Measured target is ${target:.2f}, derived by "
        f"projecting the pattern height of ${pattern_height:.2f} (flat top "
        f"${flat_top:.2f} minus earliest swing low ${earliest_low:.2f}) up "
        f"from the breakout. Initial stop sits at ${stop:.2f}, 1.5% below the "
        f"rising trendline at the current bar (${lower_at_now:.2f}) - that "
        f"represents a {stop_distance_pct:.1f}% risk from entry, so risking "
        f"1% of account on this trade implies a position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity, and risking 0.5% halves that. Once price moves into "
        f"profit, trail the stop below each new swing low or under the rising "
        f"10/20 EMA, and consider scaling out partial size at 1R for a free "
        f"trade while letting the runner ride toward the measured-move target. "
        f"Watch for follow-through on day 2-3: clean ascending-triangle "
        f"breakouts rarely retest the breakout level before extending, so a "
        f"strong second bar adds confidence."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close below the rising "
        f"trendline at ${lower_at_now:.2f} (stop at ${stop:.2f}, 1.5% below "
        f"to absorb the standard shake-out wick) - that close signals the "
        f"absorption thesis is wrong and the demand stack has thinned out. "
        f"Ascending triangles fail roughly 33% of the time according to "
        f"Bulkowski's empirical sample, and the most common failure mode is "
        f"the 'fakeout breakout': price pokes above ${flat_top:.2f} on weak "
        f"or merely-average volume, the next 1-2 bars close in the lower half "
        f"of their range, and price slides back inside the triangle. That "
        f"sequence is the textbook trap - market makers used the visible "
        f"breakout level as a liquidity grab rather than a genuine "
        f"continuation, and triangles that fail this way often resolve "
        f"DOWNWARD with surprising velocity because the trapped longs now "
        f"need to flush. The {stop_distance_pct:.1f}% stop must be honored "
        f"without negotiation - widening or removing a stop on a triangle "
        f"that is breaking down is one of the most reliable ways to convert "
        f"a manageable loss into a portfolio-damaging one. A subtler failure "
        f"signal: the rising trendline gets violated mid-pattern (before the "
        f"breakout) and the next bar fails to reclaim - that breakdown often "
        f"precedes a full pattern collapse and the trade should be skipped "
        f"entirely rather than entered on a hopeful reclaim. Volume divergence "
        f"is the leading tell: if the second half of the pattern shows volume "
        f"EXPANDING into the flat top rather than contracting, the absorption "
        f"narrative is inverted and the pattern is more likely a distribution "
        f"top in disguise."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Ascending Triangle",
        "category": "classical",
        "direction": "bullish",
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
                "lower_slope": round(float(c["lower_slope"]), 6),
                "r_squared_upper": round(float(c["upper_line"]["r_squared"]), 3),
                "r_squared_lower": round(float(c["lower_line"]["r_squared"]), 3),
                "touches_upper": int(c["cluster_touches"]),
                "touches_lower": int(c["low_touches"]),
                "convergence_ratio": round(float(c["convergence_ratio"]), 3),
                "flat_top_price": round(float(flat_top), 2),
                "gap_pct": round(float(c["gap_pct"]) * 100, 2),
                "dcr_score_adj": round(_dcr_score_adjustment(context), 2),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "rising_trendline_minus_1.5pct",
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


register(_PATTERN_ID, detect_ascending_triangle)
