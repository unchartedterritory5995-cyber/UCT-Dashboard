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
            "headline": (f"Rising wedge forming - {c['depth_pct']*100:.1f}% depth, "
                         f"{c['wedge_count']}-bar converging consolidation, "
                         f"width contracted to {c['convergence_ratio']*100:.0f}% of start"),
            "what_it_is": ("A consolidation where both highs and lows rise, but the highs "
                           "rise less steeply, producing an upward-converging wedge. "
                           "Classic bearish reversal/continuation pattern."),
            "why_it_matters": ("Buyers are losing momentum — each leg up is shallower than "
                               "the last on the upper line, while buyers force each pullback "
                               "higher. Volume contracting through the wedge confirms demand "
                               "exhaustion. A breakdown below the lower trendline projects a "
                               "measured move equal to the wedge's starting range."),
            "what_to_watch_for": (f"Breakdown below the lower trendline ({lower_at_now:.2f}) on "
                                  f"volume >= 1.5x the 20-bar average. Entry triggers below "
                                  f"{entry:.2f}."),
            "failure_signal": (f"Close above the wedge high ({wedge_high:.2f}). Pattern invalidates "
                               f"and the uptrend may extend further."),
        },
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


register(_PATTERN_ID, detect_rising_wedge)
