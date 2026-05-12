"""Bull flag detector.

A bull flag is a sharp upward move ("pole") followed by a tight pullback
consolidation ("flag") that retraces a fraction of the pole. Continuation pattern.

Geometric definition:
  - Pole: >=8% advance from a swing low to a swing high, over <=20 bars
  - Flag: 3-20 bars of consolidation after the pole top
  - Flag retrace: between 15% and 50% of the pole's height
  - Flag channel: upper and lower trendlines roughly parallel (parallel_score > 0.55)
  - Volume: contracting in the flag relative to the pole

Scoring (composite 0-100):
  geometry_score: how clean the parallel channel + retrace + duration are
  volume_score:  how contracted flag volume is vs pole volume
  context_score: trend stage, MA alignment, RS trend
  historical_score: 50.0 (neutral prior, Phase 7 wires actual stats)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.geometry import channel_width_parallel_score
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.trendlines import fit_pair_parallel
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "bull_flag"
_MIN_POLE_PCT = 0.08
_MAX_POLE_BARS = 20
_MIN_FLAG_BARS = 3
_MAX_FLAG_BARS = 20
_MIN_FLAG_RETRACE = 0.15
_MAX_FLAG_RETRACE = 0.50
_MIN_PARALLEL_SCORE = 0.55
_CONFIDENCE_FLOOR = 50.0


def detect_bull_flag(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect bull flag patterns in the bars. May emit 0-N detections."""
    if len(bars) < 30:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 3:
        return []

    for pole_top_idx, pole_top in _candidate_pole_tops(bars, pivots):
        candidate = _try_extract_pattern(bars, pivots, pole_top_idx, pole_top)
        if candidate is None:
            continue

        # Hard volume gate: a bull flag REQUIRES flag volume contracted vs pole.
        # If flag avg volume >= pole avg volume, this is not a bull flag — it's
        # likely distribution/topping. Reject before scoring.
        if not _flag_volume_contracted(bars, candidate):
            continue

        geom_score = _score_geometry(candidate)
        vol_score  = _score_volume(bars, candidate)
        ctx_score  = _score_context(context)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(bars, candidate, confidence, context,
                             geom_score, vol_score, ctx_score, hist_score)
        detections.append(d)

    return detections


def _candidate_pole_tops(bars: List[Bar], pivots) -> list[tuple[int, dict]]:
    """Yield (bar_index, pivot) for each swing-high pivot in the recent window."""
    high_pivots = [p for p in pivots if p["type"] == "high"]
    candidates = []
    for p in high_pivots[-6:]:
        if p["bar_index"] < 10 or p["bar_index"] > len(bars) - _MIN_FLAG_BARS:
            continue
        candidates.append((p["bar_index"], p))
    return candidates


def _try_extract_pattern(bars, pivots, pole_top_idx: int, pole_top) -> Optional[dict]:
    """Try to extract a pole+flag pattern with pole_top_idx as the pole apex."""
    # Look for a low pivot in the pole window; if none, fall back to the
    # absolute lowest bar low in that window. Tight base consolidations may
    # produce no qualifying pivot but still have a clean structural low.
    window_start = max(0, pole_top_idx - _MAX_POLE_BARS)
    low_pivots_before = [p for p in pivots
                         if p["type"] == "low" and window_start <= p["bar_index"] < pole_top_idx]
    if low_pivots_before:
        pole_base_pivot = min(low_pivots_before, key=lambda p: p["price"])
        pole_base = {"bar_index": pole_base_pivot["bar_index"],
                     "price": pole_base_pivot["price"],
                     "t": pole_base_pivot["t"]}
    else:
        # Fallback: scan bar lows directly in the window
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

    flag_bars_count = len(bars) - 1 - pole_top_idx
    if flag_bars_count < _MIN_FLAG_BARS or flag_bars_count > _MAX_FLAG_BARS:
        return None

    flag_bars = bars[pole_top_idx + 1:]
    if not flag_bars:
        return None

    flag_low = min(b["l"] for b in flag_bars)
    flag_high = max(b["h"] for b in flag_bars)
    retrace = (pole_top["price"] - flag_low) / pole_height
    if retrace < _MIN_FLAG_RETRACE or retrace > _MAX_FLAG_RETRACE:
        return None

    upper_pivots = [{"t": pole_top_idx + 1 + i, "price": b["h"],
                     "type": "high", "strength": 50, "bar_index": pole_top_idx + 1 + i}
                    for i, b in enumerate(flag_bars)]
    lower_pivots = [{"t": pole_top_idx + 1 + i, "price": b["l"],
                     "type": "low", "strength": 50, "bar_index": pole_top_idx + 1 + i}
                    for i, b in enumerate(flag_bars)]
    upper_line, lower_line = fit_pair_parallel(upper_pivots, lower_pivots)

    par_score = channel_width_parallel_score(upper_line, lower_line, flag_high, flag_low)
    if par_score < _MIN_PARALLEL_SCORE:
        return None

    return {
        "pole_base_idx": pole_base["bar_index"],
        "pole_base_price": pole_base["price"],
        "pole_top_idx": pole_top_idx,
        "pole_top_price": pole_top["price"],
        "pole_height": pole_height,
        "pole_pct": pole_pct,
        "pole_bars": pole_bars,
        "flag_count": len(flag_bars),
        "flag_low": flag_low,
        "flag_high": flag_high,
        "retrace_pct": retrace,
        "upper_line": upper_line,
        "lower_line": lower_line,
        "parallel_score": par_score,
        "flag_bars": flag_bars,
    }


def _score_geometry(c: dict) -> float:
    pole_score = min(100, c["pole_pct"] / 0.20 * 100)
    retrace_score = 100 - abs(c["retrace_pct"] - 0.30) * 200
    retrace_score = max(0, retrace_score)
    parallel_pts = c["parallel_score"] * 100
    duration_score = 100 - abs(c["flag_count"] - 8) * 5
    duration_score = max(0, duration_score)
    return round(0.30 * pole_score + 0.30 * retrace_score
                 + 0.25 * parallel_pts + 0.15 * duration_score, 2)


def _flag_volume_contracted(bars: List[Bar], c: dict) -> bool:
    """Hard gate: flag avg volume must be strictly less than pole avg volume.

    A bull flag is defined by volume drying up into the consolidation. If volume
    is expanding (or even flat) into the flag, the pattern is not valid —
    sellers are still active.
    """
    pole = bars[c["pole_base_idx"]: c["pole_top_idx"] + 1]
    flag = c["flag_bars"]
    if not pole or not flag:
        return False
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    flag_avg = sum(b["v"] for b in flag) / len(flag)
    if pole_avg <= 0:
        return True  # can't measure; don't gate
    return flag_avg < pole_avg


def _score_volume(bars: List[Bar], c: dict) -> float:
    pole = bars[c["pole_base_idx"]: c["pole_top_idx"] + 1]
    flag = c["flag_bars"]
    if not pole or not flag:
        return 0.0
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    flag_avg = sum(b["v"] for b in flag) / len(flag)
    if pole_avg <= 0:
        return 50.0
    ratio = flag_avg / pole_avg
    if ratio >= 1.0:
        return 0.0
    return round(max(0, min(100, (1.0 - ratio) * 125)), 2)


def _score_context(context: dict) -> float:
    score = 50.0
    if context.get("trend_stage") == 2: score += 25
    if context.get("ma_alignment") == "stacked_bullish": score += 15
    if context.get("rs_trend") == "up": score += 10
    return min(100.0, score)


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    pole_top = bars[c["pole_top_idx"]]
    last_bar = bars[-1]

    flag_high = c["flag_high"]
    flag_low = c["flag_low"]
    entry = round(flag_high * 1.001, 2)
    stop  = round(flag_low * 0.99, 2)
    target = round(pole_top["c"] + c["pole_height"], 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Bull Flag",
        "category": "classical",
        "direction": "bullish",
        "start_t": int(bars[c["pole_base_idx"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[c["pole_base_idx"]]["t"]),
                     int(pole_top["t"]),
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
                "retrace_pct": round(c["retrace_pct"] * 100, 2),
                "flag_bars": c["flag_count"],
                "parallel_score": round(c["parallel_score"], 3),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "flag_low_minus_1pct",
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
            "headline": f"Bull flag forming - {c['pole_pct']*100:.1f}% pole, {c['retrace_pct']*100:.0f}% retrace, {c['flag_count']}-bar consolidation",
            "what_it_is": "A sharp advance (pole) followed by a tight pullback (flag) into a parallel channel. Classic continuation pattern.",
            "why_it_matters": f"Buyers absorbed the pullback at {c['retrace_pct']*100:.0f}% retrace. Volume contracted into the consolidation, suggesting the prior advance is intact and the next leg up is likely once supply is exhausted.",
            "what_to_watch_for": f"Breakout above the flag high ({flag_high:.2f}) on volume >= 1.5x the 20-bar average. Entry triggers above {entry:.2f}.",
            "failure_signal": f"Close below the flag low ({flag_low:.2f}). Pattern invalidates and the broader trend may be in jeopardy.",
        },
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


register(_PATTERN_ID, detect_bull_flag)
