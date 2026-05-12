"""Rising wedge detector.

A rising wedge is a bearish reversal/continuation pattern where BOTH trendlines
slope UP but the upper trendline rises LESS STEEPLY than the lower, so the
lines converge upward toward an apex. Buyers are exhausting themselves while
sellers cap each new high; the range contracts as momentum fades.

Geometric definition:
  - Window: 20-60 bars of consolidation
  - Upper trendline: slope > 0 (rising, drawn through swing highs)
  - Lower trendline: slope > 0 (rising, drawn through swing lows)
  - Slope relationship: upper.slope < lower.slope  (lower steeper / more positive)
  - At least 2 swing-high touches AND 2 swing-low touches
  - Depth: 10-40% of start-low value (meaningful range, not just noise)
  - Convergence: width_end < 70% of width_start, width_end > 0 (no crossing yet)
  - Volume: contracting through the wedge (first-half avg vs second-half avg)

Scoring (composite 0-100):
  geometry_score: convergence ratio, depth, duration, slope sanity
  volume_score:  how contracted second-half is vs first-half of wedge bars
  context_score: trend_stage 2 (advancing) or 3 (topping), stacked_bullish
                 (overbought context), or volume_signature contracting
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


_PATTERN_ID = "rising_wedge"
_MIN_WEDGE_BARS = 20
_MAX_WEDGE_BARS = 60
_MIN_DEPTH_PCT = 0.10
_MAX_DEPTH_PCT = 0.40
_MAX_CONVERGENCE_RATIO = 0.70   # width_end / width_start must be < this
_MIN_TOUCHES = 2
_MIN_LINE_VALIDITY = 0.4
_CONFIDENCE_FLOOR = 50.0


def detect_rising_wedge(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect rising-wedge patterns in the bars. May emit 0-N detections."""
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
    """Try to extract a rising-wedge pattern from bars[start_idx:end_idx+1]."""
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

    # Both slopes must be positive (rising).
    if upper_line["slope"] <= 0:
        return None
    if lower_line["slope"] <= 0:
        return None

    # Lower must be steeper (more positive) than upper for a rising wedge.
    # i.e. upper.slope < lower.slope (both positive; smaller = less steep up).
    if upper_line["slope"] - lower_line["slope"] >= 0:
        return None

    # Touch + validity quality gate on each line.
    if upper_line["touches"] < _MIN_TOUCHES or lower_line["touches"] < _MIN_TOUCHES:
        return None
    if upper_line["validity"] < _MIN_LINE_VALIDITY or lower_line["validity"] < _MIN_LINE_VALIDITY:
        return None

    # Depth: start_low vs end_high.
    upper_at_start = line_at((upper_line["p1"], upper_line["p2"]), start_idx)
    upper_at_end = line_at((upper_line["p1"], upper_line["p2"]), end_idx)
    lower_at_start = line_at((lower_line["p1"], lower_line["p2"]), start_idx)
    lower_at_end = line_at((lower_line["p1"], lower_line["p2"]), end_idx)

    start_low = lower_at_start
    end_high = upper_at_end
    if start_low <= 0:
        return None
    depth_pct = (end_high - start_low) / start_low
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
        "start_low": start_low,
        "end_high": end_high,
        "depth_pct": depth_pct,
        "upper_line": upper_line,
        "lower_line": lower_line,
        "upper_slope": upper_line["slope"],
        "lower_slope": lower_line["slope"],
        "width_start": width_start,
        "width_end": width_end,
        "convergence_ratio": convergence_ratio,
        "lower_at_now": lower_at_end,
    }


def _wedge_volume_contracted(bars: List[Bar], c: dict) -> bool:
    """Hard gate: average second-half volume must be less than first-half.

    A rising wedge implies buyer exhaustion — volume drying up through the
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
    # Slope sanity: how steep lower is vs upper (more positive lower is "cleaner")
    slope_gap = c["lower_slope"] - c["upper_slope"]  # positive when lower steeper
    if slope_gap <= 0:
        slope_score = 0.0
    else:
        # Normalize against start_low to make scale-independent.
        normalized = slope_gap / max(c["start_low"], 1e-6) * 1000.0
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
    # Rising wedge is bearish — boost on topping/distribution context.
    if context.get("trend_stage") == 3:
        score += 25  # topping/distribution
    elif context.get("trend_stage") == 2:
        score += 15  # overextended uptrend ripe for reversal
    if context.get("ma_alignment") == "stacked_bullish":
        score += 10  # overbought context — wedge marks the exhaustion
    if context.get("volume_signature") == "contracting":
        score += 15
    return min(100.0, score)


def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (overbought topping context)"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average (counter-trend warning for shorts)"
    return "mixed moving-average"


def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 3:
        return "a Stage 3 distribution/topping environment (textbook rising-wedge reversal setup)"
    if stage == 2:
        return "a Stage 2 uptrend showing exhaustion (overbought reversal context)"
    if stage == 4:
        return "a Stage 4 downtrend (continuation context — wedge as a relief bounce)"
    if stage == 1:
        return "a Stage 1 base/accumulation environment (counter-trend caution)"
    return "an undefined trend stage"


def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "still improving (counter-trend warning — wait for confirmation)"
    if rs == "down":
        return "deteriorating"
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

    lower_at_now = c["lower_at_now"]
    wedge_high = c["wedge_high"]
    start_low = c["start_low"]

    entry = round(lower_at_now * 0.999, 2)
    stop = round(wedge_high * 1.01, 2)
    target = round(start_low - (wedge_high - start_low), 2)
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0

    # Stop distance %
    stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

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
    end_high = c["end_high"]

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    # ---- Narrative composition - RICH, paragraph-length, with real values ----
    headline = (
        f"Rising Wedge forming on {sym_token} - {depth_pct_pct:.1f}% depth over "
        f"{wedge_count} bars, channel width contracted to {convergence_pct:.0f}% "
        f"of start, lower line at ${lower_at_now:.2f}. Pivot ${entry:.2f}, "
        f"target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Rising Wedge is one of the most reliable bearish reversal/"
        f"continuation patterns in classical technical analysis, codified by "
        f"Richard Schabacker (1932) and elevated to canonical status in Edwards "
        f"& Magee's 'Technical Analysis of Stock Trends' (1948). Structurally, "
        f"both trendlines slope UP but the upper line rises less steeply than "
        f"the lower - here upper_slope={upper_slope:.4f}/bar versus lower_slope="
        f"{lower_slope:.4f}/bar - so the two lines converge upward toward an "
        f"apex while price grinds higher inside an increasingly tight range "
        f"({width_start:.2f} starting width compressing to {width_end:.2f}, a "
        f"convergence ratio of {convergence_pct:.0f}%). The pattern measures "
        f"{depth_pct_pct:.1f}% from the lower-line start at ${start_low:.2f} "
        f"up to the upper-line end at ${end_high:.2f}, spans {wedge_count} bars, "
        f"and is anchored by {upper_touches} upper-line touches (validity "
        f"{upper_validity:.2f}) and {lower_touches} lower-line touches "
        f"(validity {lower_validity:.2f}). The market mechanic underneath is "
        f"buyer exhaustion: each new high arrives with less and less upside "
        f"velocity, buyers are running out of conviction to chase, while "
        f"sellers patiently distribute into the strength. Volume contracting "
        f"from first half to second half (now at {vol_pct:.0f}% of the "
        f"first-half average) is the textbook confirmation that demand is "
        f"running on fumes. Bulkowski's 'Encyclopedia of Chart Patterns' "
        f"ranks the rising wedge in uptrends among the highest-reliability "
        f"bearish reversal structures - cited follow-through rates near ~70% "
        f"in his empirical sample once the lower trendline breaks on volume."
    )

    why_it_matters = (
        f"This rising wedge is forming in {stage_phrase} with {ma_phrase} "
        f"alignment and {rs_phrase} relative strength versus the broader market, "
        f"against a {regime} regime backdrop and volume signature reading "
        f"{vol_signature}. The {depth_pct_pct:.1f}% depth over {wedge_count} "
        f"bars is a meaningful body of evidence that the trend is fatiguing - "
        f"that combination of duration and shallow ascent is the chart language "
        f"of buyers desperately defending each pullback while underlying demand "
        f"erodes. The convergence to {convergence_pct:.0f}% of the starting "
        f"width is well inside the 'tight wedge' band where follow-through "
        f"rates climb sharply, because by the time the lines have narrowed "
        f"this much the trade has become an asymmetric coiled spring (limited "
        f"upside left inside the pattern, large potential downside on the "
        f"break). The slope differential (lower steeper than upper) is the "
        f"most important geometric tell: it means buyers are working harder "
        f"and harder to maintain higher-lows while sellers cap each high with "
        f"increasing ease - the textbook signature of distribution quietly "
        f"winning the war of attrition. Volume shrinking to {vol_pct:.0f}% of "
        f"the early-wedge average confirms demand is exhausting itself, and "
        f"when the lower trendline cracks on volume the trapped late longs "
        f"frequently accelerate the move."
    )

    what_to_watch_for = (
        f"The trigger is a daily close below ${entry:.2f} (the lower trendline "
        f"projection at ${lower_at_now:.2f} minus a small confirmation buffer) "
        f"on volume of at least 1.5x the 20-bar average - that volume expansion "
        f"on the breakdown is non-negotiable, because a break on light tape "
        f"frequently reverses as a bear trap. The ideal trigger bar closes in "
        f"the lower half of its range with a wide real body, and the next 1-3 "
        f"bars should hold below ${lower_at_now:.2f} without retracing more "
        f"than a third of the breakdown move. Measured target is ${target:.2f}, "
        f"calculated by projecting the starting wedge height of "
        f"${wedge_high - start_low:.2f} down from the breakdown level. Initial "
        f"stop sits at ${stop:.2f} (1% above the wedge high at ${wedge_high:.2f}) "
        f"representing a {stop_distance_pct:.1f}% risk from entry - risking 1% "
        f"of account on this short implies a position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity, and risking 0.5% halves that. Trail stops above each new "
        f"swing high as the trade extends, or above the descending 10/20 EMA. "
        f"Consider covering partial size at 1R for a free trade. Remember "
        f"short trades require borrow availability, carry overnight gap risk, "
        f"and have asymmetric loss exposure that long trades do not."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close above the wedge high at "
        f"${wedge_high:.2f} (stop at ${stop:.2f}, 1% above the structural high "
        f"to absorb the standard upside wick) - that close signals the "
        f"distribution thesis is wrong and demand has overwhelmed sellers, "
        f"often unleashing a short-squeeze leg as trapped bears cover. A "
        f"subtler failure mode that often precedes the hard stop: price breaks "
        f"below ${lower_at_now:.2f} on weak or merely-average volume, the next "
        f"1-2 bars close in the upper half of their range, and price recovers "
        f"back inside the wedge. That sequence is the textbook 'failed "
        f"breakdown' - market makers used the visible breakdown level as a "
        f"liquidity grab rather than a genuine continuation, and the wedge "
        f"often resolves the opposite direction (upward break) with surprising "
        f"velocity once trapped shorts cover. Short squeezes can be violent "
        f"and uncapped to the upside, so the {stop_distance_pct:.1f}% stop "
        f"must be honored without negotiation - widening or removing a stop "
        f"on a rising wedge that is failing upward is one of the fastest "
        f"ways to convert a manageable loss into account-damaging exposure, "
        f"because the asymmetric risk profile of a short (capped reward, "
        f"uncapped loss) demands tighter discipline than long trades. Failed "
        f"rising wedges often resolve with V-shape reversal velocity, so "
        f"size accordingly."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Rising Wedge",
        "category": "classical",
        "direction": "bearish",
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
            "entry_condition": f"close < {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "wedge_high_plus_1pct",
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


register(_PATTERN_ID, detect_rising_wedge)
