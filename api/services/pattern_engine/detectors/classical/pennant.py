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


def _build_detection(bars, c, confidence, context, direction,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    pole_apex_bar = bars[c["pole_apex_idx"]]
    end_idx = c["pennant_end_idx"]

    upper_at_now = line_at((c["upper_line"]["p1"], c["upper_line"]["p2"]), end_idx)
    lower_at_now = line_at((c["lower_line"]["p1"], c["lower_line"]["p2"]), end_idx)

    pennant_high = c["pennant_high"]
    pennant_low = c["pennant_low"]

    if direction == "bullish":
        entry = round(upper_at_now * 1.001, 2)
        stop = round(pennant_low * 0.99, 2)
        target = round(pole_apex_bar["c"] + c["pole_height"], 2)
        rr = (target - entry) / (entry - stop) if entry > stop else 0.0
        entry_condition = f"close > {entry:.2f} on volume > 1.5x 20-bar avg"
        stop_basis = "pennant_low_minus_1pct"
        pattern_name = "Bullish Pennant"
        headline = (f"Bullish pennant forming - {c['pole_pct']*100:.1f}% pole, "
                    f"{c['pennant_count']}-bar converging consolidation, "
                    f"apex {c['apex_bars_ahead']:.0f} bars ahead")
        what_it_is = ("A sharp advance (pole) followed by a small, converging triangle "
                      "consolidation. Classic continuation pattern.")
        why_it_matters = (f"Buyers and sellers tighten into the apex. Volume contracted into "
                          f"the consolidation, suggesting accumulation. A breakout above the "
                          f"upper line projects a measured move equal to the pole height.")
        what_to_watch_for = (f"Breakout above the upper trendline ({upper_at_now:.2f}) on volume "
                             f">= 1.5x the 20-bar average. Entry triggers above {entry:.2f}.")
        failure_signal = (f"Close below the pennant low ({pennant_low:.2f}). Pattern invalidates "
                          f"and the prior advance is at risk.")
    else:
        entry = round(lower_at_now * 0.999, 2)
        stop = round(pennant_high * 1.01, 2)
        target = round(pole_apex_bar["c"] - c["pole_height"], 2)
        rr = (entry - target) / (stop - entry) if stop > entry else 0.0
        entry_condition = f"close < {entry:.2f} on volume > 1.5x 20-bar avg"
        stop_basis = "pennant_high_plus_1pct"
        pattern_name = "Bearish Pennant"
        headline = (f"Bearish pennant forming - {c['pole_pct']*100:.1f}% pole, "
                    f"{c['pennant_count']}-bar converging consolidation, "
                    f"apex {c['apex_bars_ahead']:.0f} bars ahead")
        what_it_is = ("A sharp decline (pole) followed by a small, converging triangle "
                      "consolidation. Classic continuation pattern in a downtrend.")
        why_it_matters = (f"Buyers and sellers tighten into the apex. Volume contracted into "
                          f"the consolidation, suggesting distribution. A breakdown below the "
                          f"lower line projects a measured move equal to the pole height.")
        what_to_watch_for = (f"Breakdown below the lower trendline ({lower_at_now:.2f}) on "
                             f"volume >= 1.5x the 20-bar average. Entry triggers below {entry:.2f}.")
        failure_signal = (f"Close above the pennant high ({pennant_high:.2f}). Pattern "
                          f"invalidates and the prior decline may be reversing.")

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
