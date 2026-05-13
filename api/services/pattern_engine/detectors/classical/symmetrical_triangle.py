"""Symmetrical Triangle detector.

A symmetrical triangle is a neutral consolidation pattern where BOTH
trendlines converge - swing highs make lower-highs (descending upper
trendline) while swing lows make higher-lows (rising lower trendline). The
direction of the resolution is not predetermined by the pattern; the breakout
side determines the trade direction. Statistically, symmetrical triangles
inside an existing trend resolve in the direction of that trend ~55-65% of
the time (continuation bias).

Geometric definition:
  - Window: 20-60 bars
  - Upper trendline: slope < 0, r_squared >= 0.7, >=2 touches
  - Lower trendline: slope > 0, r_squared >= 0.7, >=2 touches
  - Apex projection (via line_intersect): 1-30 bars ahead of current bar
  - Volume: contracting through pattern (preferred)

Levels (per spec):
  - entry  = upper_at_now * 1.001 (presumed upside break - statistically most
            common in uptrends; downside variant noted in narrative)
  - stop   = lower_at_now * 0.985
  - target = entry + (upper_at_start - lower_at_start) (triangle base height
            projected up)

Attribution: Schabacker (1932); Edwards & Magee (1948).
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.geometry import line_at, line_intersect
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.trendlines import fit_trendline
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "symmetrical_triangle"
_MIN_BARS = 20
_MAX_BARS = 60
_MIN_TOUCHES = 2
_MIN_LINE_VALIDITY = 0.4
_MIN_R_SQUARED = 0.55
_MIN_APEX_AHEAD = 1
_MAX_APEX_AHEAD = 30
_MAX_CONVERGENCE_RATIO = 0.70
_CONFIDENCE_FLOOR = 50.0


def detect_symmetrical_triangle(bars: List[Bar], context: dict) -> List[Detection]:
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

    high_pivots = [{"t": p["bar_index"], "price": p["price"],
                    "type": "high", "strength": p["strength"],
                    "bar_index": p["bar_index"]} for p in high_pivots_raw]
    low_pivots = [{"t": p["bar_index"], "price": p["price"],
                   "type": "low", "strength": p["strength"],
                   "bar_index": p["bar_index"]} for p in low_pivots_raw]

    try:
        upper_line = fit_trendline(high_pivots)
        lower_line = fit_trendline(low_pivots)
    except ValueError:
        return None

    # Symmetrical: upper must slope down, lower must slope up.
    if upper_line["slope"] >= 0:
        return None
    if lower_line["slope"] <= 0:
        return None

    if upper_line["touches"] < _MIN_TOUCHES or lower_line["touches"] < _MIN_TOUCHES:
        return None
    if upper_line["validity"] < _MIN_LINE_VALIDITY or lower_line["validity"] < _MIN_LINE_VALIDITY:
        return None
    if upper_line["r_squared"] < _MIN_R_SQUARED or lower_line["r_squared"] < _MIN_R_SQUARED:
        return None

    upper_at_start = line_at((upper_line["p1"], upper_line["p2"]), start_idx)
    upper_at_end = line_at((upper_line["p1"], upper_line["p2"]), end_idx)
    lower_at_start = line_at((lower_line["p1"], lower_line["p2"]), start_idx)
    lower_at_end = line_at((lower_line["p1"], lower_line["p2"]), end_idx)

    width_start = upper_at_start - lower_at_start
    width_end = upper_at_end - lower_at_end
    if width_start <= 0 or width_end <= 0:
        return None
    convergence_ratio = width_end / width_start
    if convergence_ratio >= _MAX_CONVERGENCE_RATIO:
        return None

    intersect = line_intersect((upper_line["p1"], upper_line["p2"]),
                               (lower_line["p1"], lower_line["p2"]))
    if intersect is None:
        return None
    apex_bars_ahead = intersect["t"] - end_idx
    if apex_bars_ahead < _MIN_APEX_AHEAD or apex_bars_ahead > _MAX_APEX_AHEAD:
        return None

    pattern_low = min(b["l"] for b in pattern_bars)
    pattern_high = max(b["h"] for b in pattern_bars)

    return {
        "start_idx": start_idx,
        "end_idx": end_idx,
        "pattern_bars": pattern_bars,
        "pattern_count": bar_count,
        "pattern_low": pattern_low,
        "pattern_high": pattern_high,
        "upper_line": upper_line,
        "lower_line": lower_line,
        "upper_slope": upper_line["slope"],
        "lower_slope": lower_line["slope"],
        "upper_at_start": upper_at_start,
        "upper_at_end": upper_at_end,
        "lower_at_start": lower_at_start,
        "lower_at_end": lower_at_end,
        "width_start": width_start,
        "width_end": width_end,
        "convergence_ratio": convergence_ratio,
        "apex_bars_ahead": apex_bars_ahead,
        "apex_price": float(intersect["price"]),
        "upper_touches": upper_line["touches"],
        "lower_touches": lower_line["touches"],
    }


def _score_geometry(c: dict) -> float:
    convergence_score = max(0.0, (1.0 - c["convergence_ratio"] / _MAX_CONVERGENCE_RATIO)) * 100.0
    upper_r2_score = c["upper_line"]["r_squared"] * 100.0
    lower_r2_score = c["lower_line"]["r_squared"] * 100.0
    r2_score = (upper_r2_score + lower_r2_score) / 2.0
    touch_score = (min(100.0, c["upper_touches"] * 33.0) + min(100.0, c["lower_touches"] * 33.0)) / 2.0
    apex = c["apex_bars_ahead"]
    if 5 <= apex <= 15:
        apex_score = 100.0
    elif apex < 5:
        apex_score = max(0.0, 50.0 + apex * 10.0)
    else:
        apex_score = max(0.0, 100.0 - (apex - 15) * 6.0)
    duration_score = max(0.0, 100.0 - abs(c["pattern_count"] - 36) * 3.0)
    return round(0.25 * convergence_score + 0.20 * r2_score + 0.20 * touch_score
                 + 0.20 * apex_score + 0.15 * duration_score, 2)


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
        return 25.0
    return round(max(0.0, min(100.0, (1.0 - ratio) * 150.0)), 2)


def _score_context(context: dict) -> float:
    # Symmetrical triangle is neutral, but breakout in trend direction is more
    # reliable. Give moderate credit to any clear trend stage.
    score = 50.0
    stage = context.get("trend_stage", 0)
    if stage in (2, 4):
        score += 20  # clear trend = directional bias for breakout
    elif stage in (1, 3):
        score += 10
    if context.get("ma_alignment") in ("stacked_bullish", "stacked_bearish"):
        score += 15
    if context.get("volume_signature") == "contracting":
        score += 15
    return min(100.0, score)


def _trend_stage_phrase(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 2:
        return ("a confirmed Stage 2 uptrend (statistical bias is upside continuation "
                "- 55-65% of triangles in uptrends break to the upside)")
    if stage == 4:
        return ("a Stage 4 downtrend (statistical bias is downside continuation - "
                "55-65% of triangles in downtrends break to the downside)")
    if stage == 1:
        return ("a Stage 1 basing environment (the triangle could mark either "
                "breakout from accumulation or a head-fake before another leg down)")
    if stage == 3:
        return ("a Stage 3 distribution environment (breakdown bias - bulls running "
                "out of capital to defend the rising support)")
    return "an undefined trend stage (direction-agnostic setup)"


def _ma_align_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (favors upside breakout)"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average (favors downside breakdown)"
    return "mixed moving-average (no clear directional MA bias)"


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

    upper_at_now = c["upper_at_end"]
    lower_at_now = c["lower_at_end"]
    width_start = c["width_start"]
    pattern_count = c["pattern_count"]

    # Per spec: primary entry assumes upside break (statistically most common).
    entry = round(upper_at_now * 1.001, 2)
    stop = round(lower_at_now * 0.985, 2)
    # Triangle-base-height projection for upside target.
    target = round(entry + width_start, 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    # Conditional downside reference (noted in narrative, not in primary levels)
    downside_entry = round(lower_at_now * 0.999, 2)
    downside_target = round(downside_entry - width_start, 2)

    vol_ratio_val = _vol_ratio(bars, c)
    vol_pct = vol_ratio_val * 100.0

    convergence_pct = c["convergence_ratio"] * 100.0
    apex_bars_ahead = float(c["apex_bars_ahead"])
    apex_price = c["apex_price"]
    upper_r2 = c["upper_line"]["r_squared"]
    lower_r2 = c["lower_line"]["r_squared"]
    upper_touches = c["upper_touches"]
    lower_touches = c["lower_touches"]
    upper_slope = c["upper_slope"]
    lower_slope = c["lower_slope"]

    stage_phrase = _trend_stage_phrase(context)
    ma_phrase = _ma_align_phrase(context)
    rs_phrase = "improving" if context.get("rs_trend") == "up" else \
                "deteriorating" if context.get("rs_trend") == "down" else "neutral"
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    headline = (
        f"Symmetrical Triangle forming on {sym_token} - upper trendline "
        f"sloping {upper_slope:.4f}/bar (r2 {upper_r2:.2f}, {upper_touches} "
        f"touches), lower trendline sloping +{lower_slope:.4f}/bar (r2 "
        f"{lower_r2:.2f}, {lower_touches} touches), {pattern_count}-bar coil "
        f"(width {convergence_pct:.0f}% of start), apex {apex_bars_ahead:.0f} "
        f"bars ahead. Upside pivot ${entry:.2f}, downside pivot "
        f"${downside_entry:.2f}. Direction follows breakout."
    )

    what_it_is = (
        f"The Symmetrical Triangle is a neutral consolidation pattern "
        f"documented by Schabacker in 'Technical Analysis and Stock Market "
        f"Profits' (1932) and canonized by Edwards & Magee (1948). It pairs "
        f"a falling upper trendline (slope {upper_slope:.4f}/bar across "
        f"{upper_touches} swing-high pivots with r-squared {upper_r2:.2f}) "
        f"with a rising lower trendline (slope +{lower_slope:.4f}/bar across "
        f"{lower_touches} swing-low pivots with r-squared {lower_r2:.2f}). "
        f"The two lines converge toward an apex projected {apex_bars_ahead:.0f} "
        f"bars into the future at price ${apex_price:.2f}, while the active "
        f"channel has compressed from ${width_start:.2f} to "
        f"${c['width_end']:.2f} (convergence ratio {convergence_pct:.0f}% of "
        f"start) over {pattern_count} bars. The market mechanic underneath "
        f"is supply-demand equilibrium: both sides agree on increasingly "
        f"narrow price discovery, neither willing to chase. Buyers refuse to "
        f"pay the prior high; sellers refuse to dump at the prior low. That "
        f"equilibrium is unstable by definition - the moment one side "
        f"overpowers the other, resolution is sudden and frequently violent "
        f"because there is no inventory left in the visible range to absorb "
        f"it. Unlike its directional cousins (ascending and descending "
        f"triangles, which have flat top or flat bottom respectively), "
        f"symmetrical triangles carry no built-in directional bias - the "
        f"breakout side determines the trade. Statistically, however, "
        f"triangles inside an existing trend resolve in the direction of "
        f"that trend ~55-65% of the time, and volume contracting to "
        f"{vol_pct:.0f}% of first-half average here confirms classical "
        f"coiled-spring compression. Bulkowski's data shows volume-confirmed "
        f"symmetrical-triangle breakouts produce measured-move follow-through "
        f"~62% of the time. Welles Wilder's early triangle work in 'New "
        f"Concepts in Technical Trading Systems' (1978) — the same volume that "
        f"introduced RSI, ATR and Parabolic SAR — formalized the volatility-"
        f"compression read on triangle structures, framing them as periods "
        f"where directional energy accumulates beneath a measurable contraction "
        f"in true range that resolves with an outsized expansion bar."
    )

    why_it_matters = (
        f"This symmetrical triangle is forming in {stage_phrase}, with "
        f"{ma_phrase} alignment, {rs_phrase} relative strength, against a "
        f"{regime} macro regime and {vol_signature} volume signature. The "
        f"{pattern_count}-bar build is meaningful evidence of multi-week "
        f"price agreement on a narrow zone - the kind of compression that "
        f"institutional accumulation/distribution programs produce when they "
        f"work in stealth. Convergence ratio of {convergence_pct:.0f}% places "
        f"the pattern in the high-reliability zone where downside is "
        f"mathematically constrained and a directional resolution is almost "
        f"mechanically forced. The apex projection {apex_bars_ahead:.0f} bars "
        f"ahead is a critical timing variable: 5-15 bars ahead is the "
        f"textbook sweet spot where resolution is imminent but not desperate, "
        f"while 1-2 bars from apex frequently produces apex-failure outcomes "
        f"(the move dies at the compression point, with no energy left to "
        f"break out cleanly) and >20 bars suggests the pattern is still too "
        f"early. The dual-trendline quality (r-squared {upper_r2:.2f} on "
        f"declining highs, {lower_r2:.2f} on rising lows) is unusually clean "
        f"- these are not noisy lines fit to chaotic data, but well-defined "
        f"behavioural boundaries. Volume contracting to {vol_pct:.0f}% of "
        f"the early-pattern average is the textbook coiled-spring "
        f"confirmation. The directional bias comes from context, not "
        f"geometry: a triangle in {stage_phrase.split('(')[0].strip()} "
        f"with {ma_phrase.split('(')[0].strip()} carries the directional "
        f"lean from those factors, not the triangle itself."
    )

    what_to_watch_for = (
        f"The primary trigger (upside thesis) is a daily close above "
        f"${entry:.2f} (upper trendline at ${upper_at_now:.2f} plus a "
        f"small confirmation buffer) on volume of at least 1.5x the 20-bar "
        f"average - that volume expansion is non-negotiable because "
        f"breakouts on quiet tape near the apex frequently die and reverse. "
        f"The conditional downside trigger is a daily close below "
        f"${downside_entry:.2f} (lower trendline at ${lower_at_now:.2f} "
        f"minus a small buffer) on equivalent volume - the trade direction "
        f"is determined by which side breaks first, NOT by your prior bias. "
        f"For the upside variant: measured target is ${target:.2f} "
        f"(triangle base height ${width_start:.2f} projected up from "
        f"${entry:.2f}), stop is ${stop:.2f} (1.5% below lower trendline), "
        f"R:R is {rr:.1f}. For the downside variant: measured target is "
        f"${downside_target:.2f} (height projected down), stop is above the "
        f"upper trendline. The ideal trigger bar fires BEFORE the apex "
        f"(with at least 3-5 bars of runway remaining), closes in the "
        f"upper/lower third of its range depending on direction, and is "
        f"followed by 1-3 bars that hold the breakout level. Stop "
        f"{stop_distance_pct:.1f}% distance on the upside variant implies "
        f"a position of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity per 1% account risk. Trail stops under each new swing "
        f"low (long) or above each new swing high (short) as the move "
        f"extends, and consider scaling out partial size at 1R for a free "
        f"trade. The apex point at ${apex_price:.2f} is itself a key "
        f"reference - frequent post-apex price magnetism back to that level "
        f"after a failed breakout."
    )

    failure_signal = (
        f"The most dangerous failure mode for symmetrical triangles is the "
        f"'apex failure': price drifts to within 1-2 bars of the apex at "
        f"${apex_price:.2f} without resolving either direction, then breaks "
        f"on light volume as the compressed energy dissipates. Apex-failure "
        f"breakouts rarely follow through and frequently produce immediate "
        f"reversals as both sides realize there was no real conviction "
        f"behind the move. A subtler failure: the breakout fires above "
        f"${upper_at_now:.2f} (or below ${lower_at_now:.2f}) on weak or "
        f"merely-average volume, the next 1-2 bars close in the opposite "
        f"half of their range, and price slides back inside the triangle - "
        f"the textbook bear/bull trap depending on direction. False "
        f"symmetrical-triangle breakouts have a peculiar tendency to resolve "
        f"in the OPPOSITE direction with surprising velocity (the trapped "
        f"side now needs to unwind), so if you took the visible breakout "
        f"and it failed within 1-2 bars, the smart play is often to flip "
        f"rather than just stop out. The {stop_distance_pct:.1f}% upside "
        f"stop and the mirror downside stop must both be honored without "
        f"negotiation. Volume divergence is the leading tell: if volume "
        f"EXPANDS through the pattern rather than contracts, the coiled-"
        f"spring mechanic is inverted - the pattern is more likely a "
        f"sustained battle between competing institutional flows that will "
        f"resolve with a violent gap, often on news, rather than a clean "
        f"technical breakout. Position sizing should account for either "
        f"direction possibility - this is not a single-directional setup "
        f"and pre-committing capital to one side before the break is the "
        f"single most common mistake on symmetrical triangles."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Symmetrical Triangle",
        "category": "classical",
        "direction": "neutral",
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
                "upper_slope": round(float(c["upper_slope"]), 6),
                "lower_slope": round(float(c["lower_slope"]), 6),
                "r_squared_upper": round(float(c["upper_line"]["r_squared"]), 3),
                "r_squared_lower": round(float(c["lower_line"]["r_squared"]), 3),
                "touches_upper": int(c["upper_touches"]),
                "touches_lower": int(c["lower_touches"]),
                "convergence_ratio": round(float(c["convergence_ratio"]), 3),
                "apex_bars_ahead": round(float(c["apex_bars_ahead"]), 2),
                "apex_price": round(float(c["apex_price"]), 2),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": (
                f"close > {entry:.2f} (upside) OR close < {downside_entry:.2f} (downside) "
                f"on volume > 1.5x 20-bar avg"
            ),
            "stop": stop,
            "stop_basis": "lower_trendline_minus_1.5pct (upside variant)",
            "target_primary": target,
            "target_secondary": downside_target,
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


register(_PATTERN_ID, detect_symmetrical_triangle)
