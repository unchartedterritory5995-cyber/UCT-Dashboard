"""Pennant detector (bullish + bearish, single detector).

A pennant is a sharp move ("pole") followed by a small symmetrical-triangle
consolidation whose upper and lower trendlines CONVERGE (not parallel — that's
a flag). The convergence forms an apex pointing forward in time, which is the
geometric distinction from a flag.

Geometric definition:
  - Pole: >=8% advance OR decline over <=20 bars
      - UP  pole -> bullish pennant candidate (direction = "bullish")
      - DOWN pole -> bearish pennant candidate (direction = "bearish")
  - Pennant: 3-20 bars of consolidation after the pole apex
  - Geometry:
      - Upper trendline slopes DOWN (toward apex)
      - Lower trendline slopes UP (toward apex)
      - Lines CONVERGE — width at end < 60% of width at start
  - Apex constraint: intersection projected 1-30 bars ahead of last bar
  - Volume: contracting in the pennant relative to the pole

Scoring (composite 0-100):
  geometry_score: how clean the converging triangle is (pole size, convergence,
                   apex distance, duration)
  volume_score:  how contracted pennant volume is vs pole volume
  context_score: trend stage, MA alignment, RS trend (direction-aware)
  historical_score: 50.0 (neutral prior, Phase 7 wires actual stats)

Single detector — `pattern_id = "pennant"`. `direction` field on the Detection
tags each emission as bullish or bearish based on pole direction.
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


_PATTERN_ID = "pennant"
_MIN_POLE_PCT = 0.08
_MAX_POLE_BARS = 20
_MIN_PENNANT_BARS = 3
_MAX_PENNANT_BARS = 20
_MAX_WIDTH_RATIO = 0.60   # width_end / width_start must be < this
_MIN_APEX_AHEAD = 1
_MAX_APEX_AHEAD = 30
_CONFIDENCE_FLOOR = 50.0


def detect_pennant(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect bullish OR bearish pennant patterns. May emit 0-N detections."""
    if len(bars) < 30:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 3:
        return []

    # Bullish pennants (up poles, swing-high apexes)
    for pole_top_idx, pole_top in _candidate_pole_tops(bars, pivots):
        candidate = _try_extract_bullish_pennant(bars, pivots, pole_top_idx, pole_top)
        if candidate is None:
            continue
        if not _pennant_volume_contracted(bars, candidate):
            continue
        det = _maybe_build(bars, candidate, context, direction="bullish")
        if det is not None:
            detections.append(det)

    # Bearish pennants (down poles, swing-low apexes)
    for pole_bottom_idx, pole_bottom in _candidate_pole_bottoms(bars, pivots):
        candidate = _try_extract_bearish_pennant(bars, pivots, pole_bottom_idx, pole_bottom)
        if candidate is None:
            continue
        if not _pennant_volume_contracted(bars, candidate):
            continue
        det = _maybe_build(bars, candidate, context, direction="bearish")
        if det is not None:
            detections.append(det)

    return detections


def _maybe_build(bars, candidate, context, direction: str) -> Optional[Detection]:
    geom_score = _score_geometry(candidate)
    vol_score = _score_volume(bars, candidate)
    ctx_score = _score_context(context, direction)
    hist_score = 50.0

    confidence = round(
        0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
    )
    if confidence < _CONFIDENCE_FLOOR:
        return None

    return _build_detection(bars, candidate, confidence, context, direction,
                            geom_score, vol_score, ctx_score, hist_score)


def _candidate_pole_tops(bars: List[Bar], pivots) -> list[tuple[int, dict]]:
    """Yield (bar_index, pivot) for each swing-high pivot in the recent window."""
    high_pivots = [p for p in pivots if p["type"] == "high"]
    candidates = []
    for p in high_pivots[-6:]:
        if p["bar_index"] < 10 or p["bar_index"] > len(bars) - _MIN_PENNANT_BARS:
            continue
        candidates.append((p["bar_index"], p))
    return candidates


def _candidate_pole_bottoms(bars: List[Bar], pivots) -> list[tuple[int, dict]]:
    """Yield (bar_index, pivot) for each swing-low pivot in the recent window."""
    low_pivots = [p for p in pivots if p["type"] == "low"]
    candidates = []
    for p in low_pivots[-6:]:
        if p["bar_index"] < 10 or p["bar_index"] > len(bars) - _MIN_PENNANT_BARS:
            continue
        candidates.append((p["bar_index"], p))
    return candidates


def _try_extract_bullish_pennant(bars, pivots, pole_top_idx: int, pole_top) -> Optional[dict]:
    """Try to extract an up-pole + converging-pennant pattern."""
    window_start = max(0, pole_top_idx - _MAX_POLE_BARS)
    low_pivots_before = [p for p in pivots
                         if p["type"] == "low" and window_start <= p["bar_index"] < pole_top_idx]
    if low_pivots_before:
        pole_base_pivot = min(low_pivots_before, key=lambda p: p["price"])
        pole_base = {"bar_index": pole_base_pivot["bar_index"],
                     "price": pole_base_pivot["price"],
                     "t": pole_base_pivot["t"]}
    else:
        if window_start >= pole_top_idx:
            return None
        best_idx = window_start
        best_low = bars[window_start]["l"]
        for j in range(window_start, pole_top_idx):
            if bars[j]["l"] < best_low:
                best_low = bars[j]["l"]
                best_idx = j
        pole_base = {"bar_index": best_idx,
                     "price": best_low,
                     "t": bars[best_idx]["t"]}

    pole_height = pole_top["price"] - pole_base["price"]
    if pole_height <= 0:
        return None
    pole_pct = pole_height / pole_base["price"]
    if pole_pct < _MIN_POLE_PCT:
        return None

    pole_bars = pole_top_idx - pole_base["bar_index"]
    if pole_bars <= 0 or pole_bars > _MAX_POLE_BARS:
        return None

    pennant_count = len(bars) - 1 - pole_top_idx
    if pennant_count < _MIN_PENNANT_BARS or pennant_count > _MAX_PENNANT_BARS:
        return None

    pennant_bars = bars[pole_top_idx + 1:]
    if not pennant_bars:
        return None

    start_idx = pole_top_idx + 1
    end_idx = len(bars) - 1

    upper_line, lower_line = _fit_pennant_lines(pennant_bars, start_idx)
    if upper_line is None or lower_line is None:
        return None

    # Convergence: upper must slope DOWN, lower must slope UP.
    if upper_line["slope"] >= 0:
        return None
    if lower_line["slope"] <= 0:
        return None

    width_start = line_at((upper_line["p1"], upper_line["p2"]), start_idx) - \
                  line_at((lower_line["p1"], lower_line["p2"]), start_idx)
    width_end = line_at((upper_line["p1"], upper_line["p2"]), end_idx) - \
                line_at((lower_line["p1"], lower_line["p2"]), end_idx)
    if width_start <= 0 or width_end <= 0:
        return None
    width_ratio = width_end / width_start
    if width_ratio >= _MAX_WIDTH_RATIO:
        return None

    intersect = line_intersect((upper_line["p1"], upper_line["p2"]),
                               (lower_line["p1"], lower_line["p2"]))
    if intersect is None:
        return None
    apex_bars_ahead = intersect["t"] - end_idx
    if apex_bars_ahead < _MIN_APEX_AHEAD or apex_bars_ahead > _MAX_APEX_AHEAD:
        return None

    pennant_low = min(b["l"] for b in pennant_bars)
    pennant_high = max(b["h"] for b in pennant_bars)

    return {
        "direction": "bullish",
        "pole_base_idx": pole_base["bar_index"],
        "pole_base_price": pole_base["price"],
        "pole_apex_idx": pole_top_idx,
        "pole_apex_price": pole_top["price"],
        "pole_height": pole_height,
        "pole_pct": pole_pct,
        "pole_bars": pole_bars,
        "pennant_count": len(pennant_bars),
        "pennant_low": pennant_low,
        "pennant_high": pennant_high,
        "pennant_start_idx": start_idx,
        "pennant_end_idx": end_idx,
        "upper_line": upper_line,
        "lower_line": lower_line,
        "width_start": width_start,
        "width_end": width_end,
        "width_ratio": width_ratio,
        "apex_bars_ahead": apex_bars_ahead,
        "pennant_bars": pennant_bars,
    }


def _try_extract_bearish_pennant(bars, pivots, pole_bottom_idx: int, pole_bottom) -> Optional[dict]:
    """Try to extract a down-pole + converging-pennant pattern."""
    window_start = max(0, pole_bottom_idx - _MAX_POLE_BARS)
    high_pivots_before = [p for p in pivots
                          if p["type"] == "high" and window_start <= p["bar_index"] < pole_bottom_idx]
    if high_pivots_before:
        pole_base_pivot = max(high_pivots_before, key=lambda p: p["price"])
        pole_base = {"bar_index": pole_base_pivot["bar_index"],
                     "price": pole_base_pivot["price"],
                     "t": pole_base_pivot["t"]}
    else:
        if window_start >= pole_bottom_idx:
            return None
        best_idx = window_start
        best_high = bars[window_start]["h"]
        for j in range(window_start, pole_bottom_idx):
            if bars[j]["h"] > best_high:
                best_high = bars[j]["h"]
                best_idx = j
        pole_base = {"bar_index": best_idx,
                     "price": best_high,
                     "t": bars[best_idx]["t"]}

    pole_height = pole_base["price"] - pole_bottom["price"]
    if pole_height <= 0:
        return None
    pole_pct = pole_height / pole_base["price"]
    if pole_pct < _MIN_POLE_PCT:
        return None

    pole_bars = pole_bottom_idx - pole_base["bar_index"]
    if pole_bars <= 0 or pole_bars > _MAX_POLE_BARS:
        return None

    pennant_count = len(bars) - 1 - pole_bottom_idx
    if pennant_count < _MIN_PENNANT_BARS or pennant_count > _MAX_PENNANT_BARS:
        return None

    pennant_bars = bars[pole_bottom_idx + 1:]
    if not pennant_bars:
        return None

    start_idx = pole_bottom_idx + 1
    end_idx = len(bars) - 1

    upper_line, lower_line = _fit_pennant_lines(pennant_bars, start_idx)
    if upper_line is None or lower_line is None:
        return None

    if upper_line["slope"] >= 0:
        return None
    if lower_line["slope"] <= 0:
        return None

    width_start = line_at((upper_line["p1"], upper_line["p2"]), start_idx) - \
                  line_at((lower_line["p1"], lower_line["p2"]), start_idx)
    width_end = line_at((upper_line["p1"], upper_line["p2"]), end_idx) - \
                line_at((lower_line["p1"], lower_line["p2"]), end_idx)
    if width_start <= 0 or width_end <= 0:
        return None
    width_ratio = width_end / width_start
    if width_ratio >= _MAX_WIDTH_RATIO:
        return None

    intersect = line_intersect((upper_line["p1"], upper_line["p2"]),
                               (lower_line["p1"], lower_line["p2"]))
    if intersect is None:
        return None
    apex_bars_ahead = intersect["t"] - end_idx
    if apex_bars_ahead < _MIN_APEX_AHEAD or apex_bars_ahead > _MAX_APEX_AHEAD:
        return None

    pennant_low = min(b["l"] for b in pennant_bars)
    pennant_high = max(b["h"] for b in pennant_bars)

    return {
        "direction": "bearish",
        "pole_base_idx": pole_base["bar_index"],
        "pole_base_price": pole_base["price"],
        "pole_apex_idx": pole_bottom_idx,
        "pole_apex_price": pole_bottom["price"],
        "pole_height": pole_height,
        "pole_pct": pole_pct,
        "pole_bars": pole_bars,
        "pennant_count": len(pennant_bars),
        "pennant_low": pennant_low,
        "pennant_high": pennant_high,
        "pennant_start_idx": start_idx,
        "pennant_end_idx": end_idx,
        "upper_line": upper_line,
        "lower_line": lower_line,
        "width_start": width_start,
        "width_end": width_end,
        "width_ratio": width_ratio,
        "apex_bars_ahead": apex_bars_ahead,
        "pennant_bars": pennant_bars,
    }


def _fit_pennant_lines(pennant_bars, start_idx):
    """Fit upper line through bar highs and lower line through bar lows."""
    upper_pivots = [{"t": start_idx + i, "price": b["h"],
                     "type": "high", "strength": 50, "bar_index": start_idx + i}
                    for i, b in enumerate(pennant_bars)]
    lower_pivots = [{"t": start_idx + i, "price": b["l"],
                     "type": "low", "strength": 50, "bar_index": start_idx + i}
                    for i, b in enumerate(pennant_bars)]
    try:
        upper_line = fit_trendline(upper_pivots)
        lower_line = fit_trendline(lower_pivots)
    except ValueError:
        return None, None
    return upper_line, lower_line


def _score_geometry(c: dict) -> float:
    pole_score = min(100, c["pole_pct"] / 0.20 * 100)
    # Convergence: lower width_ratio = tighter triangle. Score peaks at ratio ~ 0.2.
    # Linear: ratio 0.0 -> 100, ratio 0.6 -> 0
    convergence_score = max(0, (1.0 - c["width_ratio"] / _MAX_WIDTH_RATIO) * 100)
    duration_score = 100 - abs(c["pennant_count"] - 8) * 5
    duration_score = max(0, duration_score)
    # Apex closeness: ideal is ~ 5-15 bars ahead. 1 bar = pattern about to resolve;
    # 30 bars = still very early.
    apex = c["apex_bars_ahead"]
    if 5 <= apex <= 15:
        apex_score = 100.0
    elif apex < 5:
        apex_score = max(0.0, 50.0 + apex * 10.0)
    else:
        apex_score = max(0.0, 100.0 - (apex - 15) * 6.0)
    return round(0.30 * pole_score + 0.30 * convergence_score
                 + 0.20 * apex_score + 0.20 * duration_score, 2)


def _pennant_volume_contracted(bars: List[Bar], c: dict) -> bool:
    """Hard gate: pennant avg volume must be strictly less than pole avg volume."""
    pole = bars[c["pole_base_idx"]: c["pole_apex_idx"] + 1]
    pennant = c["pennant_bars"]
    if not pole or not pennant:
        return False
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    pennant_avg = sum(b["v"] for b in pennant) / len(pennant)
    if pole_avg <= 0:
        return True
    return pennant_avg < pole_avg


def _score_volume(bars: List[Bar], c: dict) -> float:
    pole = bars[c["pole_base_idx"]: c["pole_apex_idx"] + 1]
    pennant = c["pennant_bars"]
    if not pole or not pennant:
        return 0.0
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    pennant_avg = sum(b["v"] for b in pennant) / len(pennant)
    if pole_avg <= 0:
        return 50.0
    ratio = pennant_avg / pole_avg
    if ratio >= 1.0:
        return 0.0
    return round(max(0, min(100, (1.0 - ratio) * 125)), 2)


def _score_context(context: dict, direction: str) -> float:
    score = 50.0
    if direction == "bullish":
        if context.get("trend_stage") == 2: score += 25
        if context.get("ma_alignment") == "stacked_bullish": score += 15
        if context.get("rs_trend") == "up": score += 10
    else:
        if context.get("trend_stage") == 4: score += 25
        if context.get("ma_alignment") == "stacked_bearish": score += 15
        if context.get("rs_trend") == "down": score += 10
    return min(100.0, score)


def _ma_alignment_phrase(context: dict, direction: str) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return ("fully stacked-bullish moving-average" if direction == "bullish"
                else "stacked-bullish moving-average (counter-trend caution)")
    if align == "stacked_bearish":
        return ("fully stacked-bearish moving-average" if direction == "bearish"
                else "stacked-bearish moving-average (counter-trend caution)")
    return "mixed moving-average"


def _trend_stage_description(context: dict, direction: str) -> str:
    stage = context.get("trend_stage", 0)
    if direction == "bullish":
        if stage == 2:
            return "a confirmed Stage 2 uptrend"
        if stage == 1:
            return "a Stage 1 base/accumulation environment"
        if stage == 3:
            return "a Stage 3 distribution environment (caution against longs)"
        if stage == 4:
            return "a Stage 4 downtrend environment (counter-trend long, lower odds)"
    else:
        if stage == 4:
            return "a confirmed Stage 4 downtrend"
        if stage == 3:
            return "a Stage 3 distribution top (roll-over forming)"
        if stage == 2:
            return "a Stage 2 uptrend environment (counter-trend short, lower odds)"
        if stage == 1:
            return "a Stage 1 base environment (counter-trend caution)"
    return "an undefined trend stage"


def _rs_trend_phrase(context: dict, direction: str) -> str:
    rs = context.get("rs_trend", "flat")
    if direction == "bullish":
        if rs == "up":
            return "improving"
        if rs == "down":
            return "deteriorating (counter-trend warning)"
    else:
        if rs == "up":
            return "improving (counter-trend warning)"
        if rs == "down":
            return "deteriorating"
    return "neutral"


def _pennant_volume_ratio(bars: List[Bar], c: dict) -> float:
    """Return pennant avg volume / pole avg volume."""
    pole = bars[c["pole_base_idx"]: c["pole_apex_idx"] + 1]
    pennant = c["pennant_bars"]
    if not pole or not pennant:
        return 1.0
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    pennant_avg = sum(b["v"] for b in pennant) / len(pennant)
    if pole_avg <= 0:
        return 1.0
    return pennant_avg / pole_avg


def _build_detection(bars, c, confidence, context, direction,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    pole_apex_bar = bars[c["pole_apex_idx"]]
    end_idx = c["pennant_end_idx"]

    upper_at_now = line_at((c["upper_line"]["p1"], c["upper_line"]["p2"]), end_idx)
    lower_at_now = line_at((c["lower_line"]["p1"], c["lower_line"]["p2"]), end_idx)

    pennant_high = c["pennant_high"]
    pennant_low = c["pennant_low"]

    # Narrative-shared values
    pole_pct_pct = c["pole_pct"] * 100.0
    pole_bars = c["pole_bars"]
    pennant_count = c["pennant_count"]
    apex_bars_ahead = float(c["apex_bars_ahead"])
    width_ratio = c["width_ratio"]
    pole_height = c["pole_height"]
    pole_base_price = c["pole_base_price"]
    pole_apex_price = c["pole_apex_price"]
    pennant_vol_ratio = _pennant_volume_ratio(bars, c)
    pennant_vol_pct = pennant_vol_ratio * 100.0
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")
    ma_phrase = _ma_alignment_phrase(context, direction)
    stage_phrase = _trend_stage_description(context, direction)
    rs_phrase = _rs_trend_phrase(context, direction)

    sym_token = "the stock"

    if direction == "bullish":
        entry = round(upper_at_now * 1.001, 2)
        stop = round(pennant_low * 0.99, 2)
        target = round(pole_apex_bar["c"] + c["pole_height"], 2)
        rr = (target - entry) / (entry - stop) if entry > stop else 0.0
        stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0
        entry_condition = f"close > {entry:.2f} on volume > 1.5x 20-bar avg"
        stop_basis = "pennant_low_minus_1pct"
        pattern_name = "Bullish Pennant"

        headline = (
            f"Bullish Pennant forming on {sym_token} - {pole_pct_pct:.1f}% pole "
            f"over {pole_bars} bars, {pennant_count}-bar converging triangle "
            f"(width ratio {width_ratio:.2f}), apex {apex_bars_ahead:.0f} bars "
            f"ahead. Pivot ${upper_at_now:.2f}, target ${target:.2f}, R:R {rr:.1f}."
        )

        what_it_is = (
            f"The Bullish Pennant is a continuation pattern documented by Schabacker "
            f"in 1932 and formalized by Edwards & Magee in 'Technical Analysis of "
            f"Stock Trends' (1948). Structurally it pairs a sharp advance (the pole - "
            f"here a {pole_pct_pct:.1f}% surge from ${pole_base_price:.2f} to "
            f"${pole_apex_price:.2f} over {pole_bars} bars) with a small symmetrical "
            f"triangle consolidation whose upper and lower trendlines CONVERGE - "
            f"this is the geometric distinction from a bull flag, where the channel "
            f"is parallel. Here the channel width has contracted to "
            f"{width_ratio:.2f} of its start value across {pennant_count} bars, "
            f"with the apex projecting {apex_bars_ahead:.0f} bars into the future "
            f"and pennant volume drying to {pennant_vol_pct:.0f}% of pole average. "
            f"The mechanic: supply and demand approach equilibrium inside the "
            f"triangle as range compresses, both sides 'agreeing' on price within "
            f"an ever-tightening band. That equilibrium is unstable by definition - "
            f"the moment one side overpowers the other, the resolution is sudden "
            f"and frequently violent because there is no overhead supply or "
            f"underhead demand to absorb it. Pennants are the chart language of "
            f"coiled springs, and the closer to apex without breakout, the more "
            f"imminent the resolution becomes. Tom Bulkowski's Encyclopedia of "
            f"Chart Patterns pegs pennant follow-through at ~63% reliability when "
            f"the convergence is clean and volume confirms the breakout, slightly "
            f"below flags because pennants often resolve too close to apex. Peter "
            f"Brandt's classical-pattern work treats pennants as one of the most "
            f"tradeable continuation structures specifically because the symmetrical "
            f"compression produces a clean, mechanical breakout level."
        )

        why_it_matters = (
            f"This pennant is forming in {stage_phrase} with {ma_phrase} alignment "
            f"and {rs_phrase} relative strength versus the broader market. The "
            f"{regime} regime sets the macro backdrop and volume reads as "
            f"{vol_signature}. The {pole_pct_pct:.1f}% pole over {pole_bars} bars "
            f"is a meaningful demand impulse that does not appear randomly - "
            f"institutional sponsorship arrived with intent, and the resulting "
            f"{pennant_count}-bar coil is not stagnation but pause. Width ratio of "
            f"{width_ratio:.2f} indicates substantial convergence; pennants where "
            f"the triangle squeezes below 0.40 of starting width typically resolve "
            f"with the highest follow-through because the energy compression is "
            f"greatest. The apex {apex_bars_ahead:.0f} bars ahead is a critical "
            f"timing variable - 5-15 bars ahead is the textbook sweet spot where "
            f"resolution is imminent but not desperate, while 1-2 bars from apex "
            f"often produces apex-breakout failures (the move dies at the point "
            f"of compression) and >20 bars suggests the pattern is still too early. "
            f"Volume contracting to {pennant_vol_pct:.0f}% of pole average is the "
            f"key confirmation that supply is exhausting itself. Historically, "
            f"clean bullish pennants produce measured-move follow-through 55-65% "
            f"of the time when they break on volume within the apex window."
        )

        what_to_watch_for = (
            f"The trigger is a daily close above ${entry:.2f} (current upper "
            f"trendline at ${upper_at_now:.2f} plus a small confirmation buffer) "
            f"on volume of at least 1.5x the 20-bar average - the volume surge "
            f"is non-negotiable, because breakouts on average or weak volume "
            f"frequently die at the apex or fade back into the triangle. The "
            f"ideal trigger bar fires BEFORE the apex (with at least 2-3 bars of "
            f"runway remaining), closes in the upper half of its range, and is "
            f"followed by 1-3 bars that hold above ${upper_at_now:.2f} without "
            f"re-entering the triangle. Measured target is ${target:.2f}, derived "
            f"by projecting the pole height of ${pole_height:.2f} up from the "
            f"pole-apex close at ${pole_apex_bar['c']:.2f}. Initial stop at "
            f"${stop:.2f} sits 1% below the pennant low at ${pennant_low:.2f}, "
            f"representing a {stop_distance_pct:.1f}% risk distance - so risking "
            f"1% of account on this trade implies roughly "
            f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
            f"of equity, and risking 0.5% halves that. Trail stops below each new "
            f"swing low or under the 10/20 EMA as the trade extends, and consider "
            f"scaling out partial size at 1R for a free trade."
        )

        failure_signal = (
            f"The pattern is invalidated on a daily close below the pennant low "
            f"at ${pennant_low:.2f} (stop set at ${stop:.2f}, ~1% below the "
            f"structural low to absorb the standard shake-out wick). Critically, "
            f"the riskiest failure mode for pennants is the 'apex failure' - "
            f"price drifts to within 1-2 bars of the apex without resolving "
            f"either direction, then breaks down on light volume as the energy "
            f"dissipates. A subtler failure: the breakout fires above "
            f"${upper_at_now:.2f} on weak volume, the next 1-2 bars close in the "
            f"lower half of their range, and price slips back into the triangle. "
            f"This is the textbook Wyckoff 'upthrust' or false breakout where "
            f"market makers used the visible level for liquidity rather than as "
            f"a genuine continuation. The {stop_distance_pct:.1f}% stop distance "
            f"must be honored without negotiation - widening a stop on a pennant "
            f"that's failing is one of the fastest ways to convert a small loss "
            f"into a damaging one, because failed coils often resolve with as "
            f"much velocity downward as the pole had upward. A failed bullish "
            f"pennant often retests the pole base near ${pole_base_price:.2f} "
            f"or breaks deeper into prior support, so sizing discipline matters "
            f"more than entry timing on this setup."
        )
    else:
        entry = round(lower_at_now * 0.999, 2)
        stop = round(pennant_high * 1.01, 2)
        target = round(pole_apex_bar["c"] - c["pole_height"], 2)
        rr = (entry - target) / (stop - entry) if stop > entry else 0.0
        stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0
        entry_condition = f"close < {entry:.2f} on volume > 1.5x 20-bar avg"
        stop_basis = "pennant_high_plus_1pct"
        pattern_name = "Bearish Pennant"

        headline = (
            f"Bearish Pennant forming on {sym_token} - {pole_pct_pct:.1f}% "
            f"decline pole over {pole_bars} bars, {pennant_count}-bar converging "
            f"triangle (width ratio {width_ratio:.2f}), apex {apex_bars_ahead:.0f} "
            f"bars ahead. Pivot ${lower_at_now:.2f}, target ${target:.2f}, R:R {rr:.1f}."
        )

        what_it_is = (
            f"The Bearish Pennant is the inverse of its bullish cousin and a "
            f"continuation pattern documented since Schabacker (1932) and "
            f"canonized by Edwards & Magee in 'Technical Analysis of Stock Trends' "
            f"(1948). It pairs a sharp downward pole - here a {pole_pct_pct:.1f}% "
            f"decline from ${pole_base_price:.2f} to ${pole_apex_price:.2f} over "
            f"{pole_bars} bars - with a small symmetrical triangle consolidation "
            f"whose upper and lower trendlines CONVERGE (geometric distinction "
            f"from a bear flag, where the channel runs parallel). The triangle "
            f"width has contracted to {width_ratio:.2f} of its starting value "
            f"across {pennant_count} bars, with the apex projecting "
            f"{apex_bars_ahead:.0f} bars into the future and pennant volume "
            f"drying to {pennant_vol_pct:.0f}% of pole average. The mechanic: "
            f"supply and demand approach equilibrium inside the triangle as range "
            f"compresses - short-covering bounces inside the upper trendline meet "
            f"continuing distribution that defends each lower-high, while patient "
            f"sellers add into rallies and dip-buyers cover into weakness. That "
            f"equilibrium is unstable by definition, and the closer to apex "
            f"without breakdown, the more imminent the resolution becomes. "
            f"Pennants in downtrends are coiled-spring continuations: the moment "
            f"demand fails to defend the lower line, the slide resumes with the "
            f"same velocity that produced the pole. Tom Bulkowski's pattern "
            f"statistics put bearish pennant follow-through near ~63% when the "
            f"convergence is clean, and Peter Brandt's classical-pattern work "
            f"highlights bearish pennants as one of the cleanest short-side "
            f"continuation setups when the breakdown carries a fresh volume "
            f"expansion against contracting pennant-phase volume."
        )

        why_it_matters = (
            f"This pennant is forming in {stage_phrase} with {ma_phrase} alignment "
            f"and {rs_phrase} relative strength versus the broader market, against "
            f"a {regime} regime backdrop and volume reading {vol_signature}. The "
            f"{pole_pct_pct:.1f}% pole over {pole_bars} bars is a meaningful "
            f"supply impulse, frequently tied to a fundamental catalyst that "
            f"flipped the narrative (earnings miss, guidance cut, sector rotation, "
            f"regulatory setback) - distribution arrived with intent and the "
            f"resulting {pennant_count}-bar coil is not stabilization but pause. "
            f"Width ratio of {width_ratio:.2f} indicates substantial convergence; "
            f"bearish pennants where the triangle squeezes below 0.40 of starting "
            f"width tend to break with the cleanest follow-through because the "
            f"energy compression is highest. The apex {apex_bars_ahead:.0f} bars "
            f"ahead is a critical timing variable - 5-15 bars ahead is the "
            f"textbook sweet spot where resolution is imminent but not desperate, "
            f"while 1-2 bars from apex frequently produces apex-failure outcomes "
            f"(the move dies at the point of compression). Volume contracting to "
            f"{pennant_vol_pct:.0f}% of pole average is the key tell that demand "
            f"is anemic; rallies inside the triangle on dying volume are the "
            f"chart language of trapped longs hoping for an exit, not new buyers "
            f"arriving. Historically, clean bearish pennants produce measured-move "
            f"follow-through 55-65% of the time when they break on volume within "
            f"the apex window."
        )

        what_to_watch_for = (
            f"The trigger is a daily close below ${entry:.2f} (current lower "
            f"trendline at ${lower_at_now:.2f} minus a small confirmation buffer) "
            f"on volume of at least 1.5x the 20-bar average - the volume "
            f"expansion on the breakdown is non-negotiable, because breaks on "
            f"light volume frequently reverse back into the triangle as a bear "
            f"trap. The ideal trigger bar fires BEFORE the apex (with at least "
            f"2-3 bars of runway remaining), closes in the lower half of its "
            f"range, and is followed by 1-3 bars that hold below "
            f"${lower_at_now:.2f} without re-entering the triangle. Measured "
            f"target is ${target:.2f}, derived by projecting the pole height of "
            f"${pole_height:.2f} down from the pole-apex close at "
            f"${pole_apex_bar['c']:.2f}. Initial stop at ${stop:.2f} sits 1% "
            f"above the pennant high at ${pennant_high:.2f}, representing a "
            f"{stop_distance_pct:.1f}% risk distance - so risking 1% of account "
            f"on this short implies roughly "
            f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
            f"of equity. Trail stops above each new swing high or above the "
            f"descending 10/20 EMA, and consider covering partial size at 1R for "
            f"a free trade. Remember short trades require borrow availability "
            f"and carry overnight gap risk that long trades do not."
        )

        failure_signal = (
            f"The pattern is invalidated on a daily close above the pennant "
            f"high at ${pennant_high:.2f} (stop set at ${stop:.2f}, ~1% above "
            f"the structural high to absorb the standard upside wick) - that "
            f"close signals the distribution thesis is wrong and demand has "
            f"overwhelmed sellers, frequently setting up a bear-trap squeeze "
            f"toward the pole base near ${pole_base_price:.2f}. The riskiest "
            f"failure mode for pennants is the 'apex failure' - price drifts to "
            f"within 1-2 bars of the apex without resolving either direction, "
            f"then breaks up on light short-covering volume as the compressed "
            f"energy dissipates. A subtler failure: the breakdown fires below "
            f"${lower_at_now:.2f} on weak volume, the next 1-2 bars close in "
            f"the upper half of their range, and price recovers back into the "
            f"triangle - the Wyckoff 'spring' that market makers use to grab "
            f"short-side liquidity before squeezing higher. Short squeezes can "
            f"be violent and uncapped to the upside, so the {stop_distance_pct:.1f}% "
            f"stop must be honored without negotiation - widening or removing a "
            f"stop on a bear pennant that's failing is one of the fastest ways "
            f"to take a manageable loss and turn it into an account-damaging "
            f"one, because the asymmetric risk profile of a short (capped "
            f"reward, uncapped loss) demands tighter discipline than long "
            f"trades. Failed bear pennants often resolve with V-shape reversal "
            f"velocity, so size accordingly."
        )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": pattern_name,
        "category": "classical",
        "direction": direction,
        "start_t": int(bars[c["pole_base_idx"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[c["pole_base_idx"]]["t"]),
                     int(pole_apex_bar["t"]),
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
                "pole_pct": round(c["pole_pct"] * 100, 2),
                "pennant_bars": c["pennant_count"],
                "apex_bars_ahead": round(float(c["apex_bars_ahead"]), 2),
                "width_ratio": round(float(c["width_ratio"]), 3),
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


register(_PATTERN_ID, detect_pennant)
