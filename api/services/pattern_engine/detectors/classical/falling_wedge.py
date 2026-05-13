"""Falling wedge detector.

A falling wedge is a bullish reversal/continuation pattern where BOTH trendlines
slope DOWN but the lower trendline declines LESS STEEPLY than the upper, so the
lines converge downward toward an apex. Buyers are gradually overpowering sellers
as the range contracts.

Geometric definition:
  - Window: 20-60 bars of consolidation
  - Upper trendline: slope < 0 (declining, drawn through swing highs)
  - Lower trendline: slope < 0 (declining, drawn through swing lows)
  - Slope relationship: upper.slope < lower.slope  (upper steeper / more negative)
  - At least 2 swing-high touches AND 2 swing-low touches
  - Depth: 10-40% of start-high value (meaningful range, not just noise)
  - Convergence: width_end < 70% of width_start, width_end > 0 (no crossing yet)
  - Volume: contracting through the wedge (first-half avg vs second-half avg)

Scoring (composite 0-100):
  geometry_score: convergence ratio, depth, duration, slope sanity
  volume_score:  how contracted second-half is vs first-half of wedge bars
  context_score: trend_stage 1 (basing) or 4 (oversold reversal), stacked_bearish
                 (oversold context), or volume_signature contracting
  historical_score: 50.0 (neutral prior, Phase 7 wires actual stats)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.geometry import line_at
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.trendlines import fit_trendline
from api.services.pattern_engine.primitives.volume import volume_signature
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "falling_wedge"
_MIN_WEDGE_BARS = 20
_MAX_WEDGE_BARS = 60
_MIN_DEPTH_PCT = 0.10
_MAX_DEPTH_PCT = 0.40
_MAX_CONVERGENCE_RATIO = 0.70   # width_end / width_start must be < this
_MIN_TOUCHES = 2
_MIN_LINE_VALIDITY = 0.4
_CONFIDENCE_FLOOR = 50.0


def detect_falling_wedge(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect falling-wedge patterns in the bars. May emit 0-N detections."""
    if len(bars) < _MIN_WEDGE_BARS + 5:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 4:
        return []

    # Try multiple window lengths anchored at the last bar.
    end_idx = len(bars) - 1
    seen_starts = set()
    for wedge_len in (40, 30, 50, 25, 35, 45, 55):
        start_idx = end_idx - wedge_len + 1
        if start_idx < 5:
            continue
        if start_idx in seen_starts:
            continue
        seen_starts.add(start_idx)
        candidate = _try_extract_pattern(bars, pivots, start_idx, end_idx)
        if candidate is None:
            continue

        if not _wedge_volume_contracted(bars, candidate):
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
        break  # first valid window is enough; no need to enumerate the rest

    return detections


def _try_extract_pattern(bars, pivots, start_idx: int, end_idx: int) -> Optional[dict]:
    """Try to extract a falling-wedge pattern from bars[start_idx:end_idx+1]."""
    wedge_bars = bars[start_idx:end_idx + 1]
    wedge_bar_count = len(wedge_bars)
    if wedge_bar_count < _MIN_WEDGE_BARS or wedge_bar_count > _MAX_WEDGE_BARS:
        return None

    high_pivots_raw = [p for p in pivots
                       if p["type"] == "high" and start_idx <= p["bar_index"] <= end_idx]
    low_pivots_raw = [p for p in pivots
                      if p["type"] == "low" and start_idx <= p["bar_index"] <= end_idx]
    if len(high_pivots_raw) < _MIN_TOUCHES or len(low_pivots_raw) < _MIN_TOUCHES:
        return None

    # Re-key pivots with bar_index as `t` so the fitted trendlines have
    # slope = price-per-bar (not price-per-second). All downstream geometry
    # math (line_at, anchors) is bar-index based.
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

    # Both slopes must be negative (declining).
    if upper_line["slope"] >= 0:
        return None
    if lower_line["slope"] >= 0:
        return None

    # Upper must be steeper (more negative) than lower for a falling wedge.
    # i.e. upper.slope < lower.slope (both negative; smaller = steeper down).
    if upper_line["slope"] - lower_line["slope"] >= 0:
        return None

    # Touch + validity quality gate on each line.
    if upper_line["touches"] < _MIN_TOUCHES or lower_line["touches"] < _MIN_TOUCHES:
        return None
    if upper_line["validity"] < _MIN_LINE_VALIDITY or lower_line["validity"] < _MIN_LINE_VALIDITY:
        return None

    # Depth: start_high vs end_low.
    upper_at_start = line_at((upper_line["p1"], upper_line["p2"]), start_idx)
    upper_at_end = line_at((upper_line["p1"], upper_line["p2"]), end_idx)
    lower_at_start = line_at((lower_line["p1"], lower_line["p2"]), start_idx)
    lower_at_end = line_at((lower_line["p1"], lower_line["p2"]), end_idx)

    start_high = upper_at_start
    end_low = lower_at_end
    if start_high <= 0:
        return None
    depth_pct = (start_high - end_low) / start_high
    if depth_pct < _MIN_DEPTH_PCT or depth_pct > _MAX_DEPTH_PCT:
        return None

    # Convergence: width contracting, lines not yet crossed.
    width_start = upper_at_start - lower_at_start
    width_end = upper_at_end - lower_at_end
    if width_start <= 0 or width_end <= 0:
        return None
    convergence_ratio = width_end / width_start
    if convergence_ratio >= _MAX_CONVERGENCE_RATIO:
        return None

    wedge_low = min(b["l"] for b in wedge_bars)
    wedge_high = max(b["h"] for b in wedge_bars)

    return {
        "start_idx": start_idx,
        "end_idx": end_idx,
        "wedge_bars": wedge_bars,
        "wedge_count": wedge_bar_count,
        "wedge_low": wedge_low,
        "wedge_high": wedge_high,
        "start_high": start_high,
        "end_low": end_low,
        "depth_pct": depth_pct,
        "upper_line": upper_line,
        "lower_line": lower_line,
        "upper_slope": upper_line["slope"],
        "lower_slope": lower_line["slope"],
        "width_start": width_start,
        "width_end": width_end,
        "convergence_ratio": convergence_ratio,
        "upper_at_now": upper_at_end,
    }


def _wedge_volume_contracted(bars: List[Bar], c: dict) -> bool:
    """Hard gate: average second-half volume must be less than first-half.

    A falling wedge implies seller exhaustion — volume drying up through the
    pattern is a critical confirmation.
    """
    wedge = c["wedge_bars"]
    if len(wedge) < 4:
        return False
    half = len(wedge) // 2
    first_half = wedge[:half]
    second_half = wedge[half:]
    first_avg = sum(b["v"] for b in first_half) / len(first_half)
    second_avg = sum(b["v"] for b in second_half) / len(second_half)
    if first_avg <= 0:
        return True  # can't measure; don't gate
    return second_avg < first_avg


def _score_geometry(c: dict) -> float:
    # Convergence: lower ratio = tighter wedge. Peaks at ratio ~0.2.
    convergence_score = max(0, (1.0 - c["convergence_ratio"] / _MAX_CONVERGENCE_RATIO) * 100)
    # Depth: ideal ~25%, scores fall off at extremes.
    depth = c["depth_pct"]
    if 0.20 <= depth <= 0.30:
        depth_score = 100.0
    elif depth < 0.20:
        depth_score = max(0.0, 50.0 + (depth - 0.10) * 500.0)
    else:
        depth_score = max(0.0, 100.0 - (depth - 0.30) * 400.0)
    # Duration: ideal ~35-45 bars.
    duration_score = 100 - abs(c["wedge_count"] - 40) * 3
    duration_score = max(0, duration_score)
    # Slope sanity: how steep upper is vs lower (more negative upper is "cleaner")
    slope_gap = c["lower_slope"] - c["upper_slope"]  # positive when upper steeper
    if slope_gap <= 0:
        slope_score = 0.0
    else:
        # Normalize against start_high to make scale-independent.
        normalized = slope_gap / max(c["start_high"], 1e-6) * 1000.0
        slope_score = min(100.0, normalized * 50.0)
    return round(0.30 * convergence_score + 0.30 * depth_score
                 + 0.20 * duration_score + 0.20 * slope_score, 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    wedge = c["wedge_bars"]
    if len(wedge) < 4:
        return 0.0
    half = len(wedge) // 2
    first_half = wedge[:half]
    second_half = wedge[half:]
    first_avg = sum(b["v"] for b in first_half) / len(first_half)
    second_avg = sum(b["v"] for b in second_half) / len(second_half)
    if first_avg <= 0:
        return 50.0
    ratio = second_avg / first_avg
    if ratio >= 1.0:
        return 0.0
    return round(max(0, min(100, (1.0 - ratio) * 125)), 2)


def _score_context(context: dict) -> float:
    score = 50.0
    # Falling wedge is bullish — boost on basing/reversal context.
    if context.get("trend_stage") == 1:
        score += 25  # basing/early accumulation
    elif context.get("trend_stage") == 4:
        score += 15  # oversold downtrend ripe for reversal
    if context.get("ma_alignment") == "stacked_bearish":
        score += 10  # oversold context — wedge marks the exhaustion
    if context.get("volume_signature") == "contracting":
        score += 15
    return min(100.0, score)


# Custom variant - does not match shared narrative_helpers
def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (early-stage continuation context)"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average (oversold reversal context)"
    return "mixed moving-average"


# Custom variant - does not match shared narrative_helpers
def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 1:
        return "a Stage 1 base/accumulation environment (textbook falling-wedge reversal setup)"
    if stage == 4:
        return "a Stage 4 downtrend showing exhaustion (oversold reversal context)"
    if stage == 2:
        return "a Stage 2 uptrend (continuation context — wedge as a deep pullback)"
    if stage == 3:
        return "a Stage 3 distribution environment (counter-trend caution)"
    return "an undefined trend stage"


# Custom variant - does not match shared narrative_helpers
def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving"
    if rs == "down":
        return "deteriorating (selling pressure still active until breakout)"
    return "neutral"


def _wedge_volume_ratio(bars: List[Bar], c: dict) -> float:
    """Return second-half avg volume / first-half avg volume across the wedge."""
    wedge = c["wedge_bars"]
    if len(wedge) < 4:
        return 1.0
    half = len(wedge) // 2
    first_half = wedge[:half]
    second_half = wedge[half:]
    first_avg = sum(b["v"] for b in first_half) / len(first_half)
    second_avg = sum(b["v"] for b in second_half) / len(second_half)
    if first_avg <= 0:
        return 1.0
    return second_avg / first_avg


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    end_idx = c["end_idx"]

    upper_at_now = c["upper_at_now"]
    wedge_low = c["wedge_low"]
    start_high = c["start_high"]

    entry = round(upper_at_now * 1.001, 2)
    stop = round(wedge_low * 0.99, 2)
    target = round(start_high + (start_high - wedge_low), 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0

    # Stop distance %
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    # Volume signature
    vol_ratio = _wedge_volume_ratio(bars, c)
    vol_pct = vol_ratio * 100.0

    # Narrative dimension values
    depth_pct_pct = c["depth_pct"] * 100.0
    convergence_pct = c["convergence_ratio"] * 100.0
    wedge_count = c["wedge_count"]
    upper_slope = c["upper_slope"]
    lower_slope = c["lower_slope"]
    upper_validity = c["upper_line"].get("validity", 0.0)
    lower_validity = c["lower_line"].get("validity", 0.0)
    upper_touches = c["upper_line"].get("touches", 0)
    lower_touches = c["lower_line"].get("touches", 0)
    width_start = c["width_start"]
    width_end = c["width_end"]
    end_low = c["end_low"]

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    # ---- Narrative composition - RICH, paragraph-length, with real values ----
    headline = (
        f"Falling Wedge forming on {sym_token} - {depth_pct_pct:.1f}% depth over "
        f"{wedge_count} bars, channel width contracted to {convergence_pct:.0f}% "
        f"of start, upper line at ${upper_at_now:.2f}. Pivot ${entry:.2f}, "
        f"target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Falling Wedge is one of the oldest documented bullish reversal/"
        f"continuation patterns in classical technical analysis, first formalized "
        f"by Richard Schabacker in 'Technical Analysis and Stock Market Profits' "
        f"(1932) and carried forward into the Edwards & Magee canon. Structurally, "
        f"both trendlines slope DOWN but the lower line declines less steeply "
        f"than the upper - here upper_slope={upper_slope:.4f}/bar versus lower_slope="
        f"{lower_slope:.4f}/bar - so the two lines converge downward toward an "
        f"apex while price action grinds lower in an increasingly tight range "
        f"({width_start:.2f} starting width compressing to {width_end:.2f}, a "
        f"convergence ratio of {convergence_pct:.0f}%). The pattern measures "
        f"{depth_pct_pct:.1f}% from the upper-line start at ${start_high:.2f} "
        f"down to the lower-line end at ${end_low:.2f}, spans {wedge_count} bars, "
        f"and is anchored by {upper_touches} upper-line touches (validity "
        f"{upper_validity:.2f}) and {lower_touches} lower-line touches "
        f"(validity {lower_validity:.2f}). The market mechanic underneath is "
        f"seller exhaustion: each successive lower-low arrives with less downside "
        f"velocity, sellers are running out of supply to dump, and the contracting "
        f"range reflects buyers quietly absorbing offers. Volume contracting from "
        f"first half to second half (now at {vol_pct:.0f}% of the first-half "
        f"average) is the textbook confirmation that distribution pressure is "
        f"running on fumes, and Bulkowski's 'Encyclopedia of Chart Patterns' "
        f"ranks the falling wedge among the higher-reliability bullish structures "
        f"when the breakout fires on volume - cited follow-through rates near "
        f"~70% in his empirical sample. Peter Brandt — whose career has been "
        f"built on classical chart patterns — calls wedges 'the most under-utilized "
        f"reversal pattern in technical analysis' and considers the falling wedge "
        f"his personal specialty, emphasizing that the apex compression plus a "
        f"third trendline touch produces the cleanest mechanical breakout signal "
        f"in the entire classical playbook."
    )

    why_it_matters = (
        f"This falling wedge is forming in {stage_phrase} with {ma_phrase} "
        f"alignment and {rs_phrase} relative strength versus the broader market, "
        f"with the {regime} regime as the macro backdrop and the volume signature "
        f"reading {vol_signature}. The {depth_pct_pct:.1f}% depth over "
        f"{wedge_count} bars is meaningful evidence of a controlled, multi-week "
        f"basing process rather than a vertical capitulation - that combination "
        f"of duration and shallow descent is the chart language of supply "
        f"absorption, not panic. The convergence to {convergence_pct:.0f}% of "
        f"the starting width is well inside the 'tight wedge' band where "
        f"follow-through rates climb sharply, because by the time the lines "
        f"have narrowed this much the trade has become an asymmetric coiled "
        f"spring (limited downside left inside the pattern, large potential "
        f"upside on the break). The slope differential (upper steeper than "
        f"lower) is the most important geometric tell: it means downside "
        f"velocity is decaying faster than upside resistance, the textbook "
        f"signature of demand quietly winning the war of attrition. Volume "
        f"shrinking to {vol_pct:.0f}% of the early-wedge average confirms the "
        f"thesis that sellers have run their inventory and the next leg is "
        f"determined by who flinches first - usually the shorts who covered "
        f"too tightly against the descending upper line."
    )

    what_to_watch_for = (
        f"The trigger is a daily close above ${entry:.2f} (the upper trendline "
        f"projection at ${upper_at_now:.2f} plus a small confirmation buffer) "
        f"on volume of at least 1.5x the 20-bar average - that volume expansion "
        f"is non-negotiable because a breakout on quiet tape almost always "
        f"reverts back inside the wedge as longs realize there's no new demand "
        f"behind the move. The ideal trigger bar closes in the upper half of "
        f"its range with a wide real body, and the next 1-3 bars should hold "
        f"above ${upper_at_now:.2f} without retracing more than a third of the "
        f"breakout move. Measured target is ${target:.2f}, calculated by "
        f"projecting the starting wedge height of ${start_high - wedge_low:.2f} "
        f"up from the breakout level. Initial stop sits at ${stop:.2f} (1% "
        f"below the wedge low at ${wedge_low:.2f}) representing a "
        f"{stop_distance_pct:.1f}% risk from entry - risking 1% of account on "
        f"this trade implies a position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity, and risking 0.5% halves that. Once price moves into "
        f"profit, trail the stop below each new swing low or under the rising "
        f"10/20 EMA, and consider scaling out partial size at 1R to lock in a "
        f"free trade while letting the runner ride toward the measured-move "
        f"target."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close below the wedge low at "
        f"${wedge_low:.2f} (stop at ${stop:.2f}, 1% below the structural low to "
        f"absorb the standard shake-out wick) - that close signals the "
        f"absorption thesis is wrong and the downtrend has another leg to go. "
        f"A subtler failure mode that often precedes the hard stop: price "
        f"pushes above ${upper_at_now:.2f} on weak or merely-average volume, "
        f"the next 1-2 bars close in the lower half of their range, and price "
        f"slides back inside the wedge. That sequence is the textbook 'failed "
        f"breakout' - bulls used the visible breakout level as an exit rather "
        f"than an entry, and the wedge often resolves the opposite direction "
        f"(downward break) with surprising velocity once the trapped longs "
        f"flush. The {stop_distance_pct:.1f}% stop must be honored without "
        f"negotiation - widening or removing a stop on a wedge that is "
        f"breaking down is one of the most reliable ways to convert a "
        f"manageable loss into a portfolio-damaging one. Falling wedges that "
        f"fail to the downside frequently produce measured moves equal to the "
        f"pattern depth in the opposite direction, so size discipline matters "
        f"as much as entry timing on this setup, and recall that Bulkowski's "
        f"reliability statistics are conditioned on a clean volume-backed "
        f"breakout - not every wedge resolves bullishly."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Falling Wedge",
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
                "depth_pct": round(c["depth_pct"] * 100, 2),
                "wedge_bars": c["wedge_count"],
                "convergence_ratio": round(float(c["convergence_ratio"]), 3),
                "upper_slope": round(float(c["upper_slope"]), 6),
                "lower_slope": round(float(c["lower_slope"]), 6),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "wedge_low_minus_1pct",
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


register(_PATTERN_ID, detect_falling_wedge)
