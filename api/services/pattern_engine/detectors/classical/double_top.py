"""Double Top detector.

Two peaks at similar heights with a retrace trough between them.
Classic bearish reversal pattern: buyers fail to push past the prior
high on the second attempt, signaling demand exhaustion. A breakdown
below the retrace trough projects a measured move equal to the
peak-to-trough distance.

Geometric definition:
  - Window: 20-80 bars
  - Two swing-high pivots ordered chronologically: P1 < P2 (bar_index)
  - Peak similarity: |p1 - p2| / p1 < 0.04 (within 4%)
  - Peak spacing: p2_idx - p1_idx >= 7 bars (peaks well separated)
  - Retrace trough: lowest LOW in bars[p1_idx..p2_idx]
  - Retrace depth: (peak1 - trough) / peak1 in [0.05, 0.25]
  - Pattern not yet broken downward: recent closes have not breached trough
  - Recent: p2 within the last 30 bars
  - Volume: lower on second peak than first (buying exhaustion signature)

Scoring (composite 0-100):
  geometry_score:   peak similarity, retrace depth ideality, peak spacing
  volume_score:     declining volume on second peak vs first
  context_score:    trend_stage 2/3 (toppy uptrend / distribution), stacked_bullish
  historical_score: 50.0 (neutral prior, Phase 7 wires actual stats)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "double_top"
_MIN_PATTERN_BARS = 20
_MAX_PATTERN_BARS = 80
_MAX_PEAK_SIMILARITY = 0.04        # |p1 - p2| / p1 < 0.04
_MIN_PEAK_SPACING = 7              # p2_idx - p1_idx >= 7
_MIN_RETRACE_DEPTH = 0.05          # (peak1 - trough)/peak1 >= 5%
_MAX_RETRACE_DEPTH = 0.25          # (peak1 - trough)/peak1 <= 25%
_MAX_PEAK2_AGE = 30                # p2 within last 30 bars
_CONFIDENCE_FLOOR = 50.0


def detect_double_top(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect double-top patterns in the bars. May emit 0-N detections."""
    if len(bars) < _MIN_PATTERN_BARS:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 2:
        return []

    high_pivots_raw = [p for p in pivots if p["type"] == "high"]
    if len(high_pivots_raw) < 2:
        return []

    # Re-key swing-highs with bar_index as `t` (convention used throughout
    # the engine even though no trendline is fit here).
    high_pivots = [{"t": p["bar_index"], "price": p["price"],
                    "type": "high", "strength": p["strength"],
                    "bar_index": p["bar_index"]} for p in high_pivots_raw]

    # Consider the most-recent 10 swing-high pivots. Enumerate every pair
    # (P1, P2) with P1 < P2 chronologically. Prefer the highest-confidence
    # valid pattern.
    recent_highs = high_pivots[-10:]
    n = len(recent_highs)
    last_bar_idx = len(bars) - 1

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for i in range(n):
        for j in range(i + 1, n):
            P1 = recent_highs[i]
            P2 = recent_highs[j]

            if not (P1["bar_index"] < P2["bar_index"]):
                continue

            # Recent constraint: second peak within last N bars
            if last_bar_idx - P2["bar_index"] > _MAX_PEAK2_AGE:
                continue

            candidate = _try_extract_pattern(bars, P1, P2)
            if candidate is None:
                continue

            # Pattern not yet broken downward
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


def _try_extract_pattern(bars: List[Bar], P1: dict, P2: dict) -> Optional[dict]:
    """Validate P1 < P2 as a double top. Returns candidate dict or None."""
    p1_idx, p2_idx = P1["bar_index"], P2["bar_index"]
    p1_price, p2_price = P1["price"], P2["price"]

    # Spacing
    spacing = p2_idx - p1_idx
    if spacing < _MIN_PEAK_SPACING:
        return None

    # Pattern window length
    if spacing > _MAX_PATTERN_BARS:
        return None

    if p1_price <= 0:
        return None

    # Peak similarity
    peak_similarity = abs(p1_price - p2_price) / p1_price
    if peak_similarity >= _MAX_PEAK_SIMILARITY:
        return None

    # Retrace trough: lowest LOW strictly between p1 and p2
    if p2_idx - p1_idx < 2:
        return None

    t_idx, t_price = _segment_lowest_low(bars, p1_idx + 1, p2_idx - 1)
    if t_idx is None:
        return None

    # Retrace depth based on the first peak (anchor)
    retrace_depth = (p1_price - t_price) / p1_price
    if retrace_depth < _MIN_RETRACE_DEPTH or retrace_depth > _MAX_RETRACE_DEPTH:
        return None

    return {
        "peak1_idx": p1_idx,
        "peak1_price": p1_price,
        "peak2_idx": p2_idx,
        "peak2_price": p2_price,
        "trough_idx": t_idx,
        "trough_price": t_price,
        "peak_similarity": peak_similarity,
        "retrace_depth": retrace_depth,
        "pattern_bars": spacing,
        "start_idx": p1_idx,
        "end_idx": p2_idx,
    }


def _segment_lowest_low(bars: List[Bar], a: int, b: int) -> tuple:
    """Return (bar_index, low_price) of the lowest LOW in bars[a..b] inclusive."""
    if a > b or a < 0 or b >= len(bars):
        return (None, None)
    best_idx = a
    best_low = bars[a]["l"]
    for i in range(a + 1, b + 1):
        if bars[i]["l"] < best_low:
            best_low = bars[i]["l"]
            best_idx = i
    return (best_idx, best_low)


def _pattern_already_broken(bars: List[Bar], c: dict) -> bool:
    """Return True if recent closes have breached BELOW the retrace trough.

    Two or more consecutive closes below the trough = breakdown already
    happened — don't fire as 'forming/ready'.
    """
    trough_price = c["trough_price"]
    p2_idx = c["peak2_idx"]
    last_idx = len(bars) - 1

    max_consec = 0
    consec = 0
    for i in range(p2_idx, last_idx + 1):
        if bars[i]["c"] < trough_price:
            consec += 1
            if consec > max_consec:
                max_consec = consec
        else:
            consec = 0
    return max_consec >= 2


def _score_geometry(c: dict) -> float:
    # Peak similarity: 100 at perfect match, 0 at 4% threshold
    sim = c["peak_similarity"]
    sim_score = max(0.0, (1.0 - sim / _MAX_PEAK_SIMILARITY) * 100)

    # Retrace depth ideality: textbook ~10-20%, full points 8-22%, taper outside
    depth = c["retrace_depth"]
    if 0.08 <= depth <= 0.22:
        depth_score = 100.0
    elif depth < 0.08:
        # 5% (floor) → 0, 8% → 100
        depth_score = max(0.0, (depth - _MIN_RETRACE_DEPTH) / (0.08 - _MIN_RETRACE_DEPTH) * 100)
    else:
        # 22% → 100, 25% (cap) → 0
        depth_score = max(0.0, (_MAX_RETRACE_DEPTH - depth) / (_MAX_RETRACE_DEPTH - 0.22) * 100)

    # Spacing: ideal 12-30 bars, declines outside that window
    span = c["pattern_bars"]
    if 12 <= span <= 30:
        span_score = 100.0
    elif span < 12:
        # 7 (floor) → 0, 12 → 100
        span_score = max(0.0, (span - _MIN_PEAK_SPACING) / (12 - _MIN_PEAK_SPACING) * 100)
    else:
        # 30 → 100, 80 (cap) → 0
        span_score = max(0.0, (_MAX_PATTERN_BARS - span) / (_MAX_PATTERN_BARS - 30) * 100)

    return round(
        0.45 * sim_score
        + 0.35 * depth_score
        + 0.20 * span_score, 2
    )


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score declining volume on the second peak vs the first.

    Lower volume on peak2 = stronger bearish signal (buying exhaustion).
    """
    p1_idx = c["peak1_idx"]
    p2_idx = c["peak2_idx"]

    def _window_avg(center, half=2):
        lo = max(0, center - half)
        hi = min(len(bars) - 1, center + half)
        if hi < lo:
            return 0.0
        win = bars[lo:hi + 1]
        return sum(b["v"] for b in win) / len(win)

    v1 = _window_avg(p1_idx)
    v2 = _window_avg(p2_idx)

    if v1 <= 0:
        return 50.0

    ratio = v2 / v1  # <1 = declining = good
    if ratio <= 0.3:
        return 100.0
    if ratio >= 1.0:
        return 0.0
    return round((1.0 - ratio) / 0.7 * 100, 2)


def _score_context(context: dict) -> float:
    score = 50.0
    # Double top is bearish — boost on toppy / distribution context.
    if context.get("trend_stage") == 3:
        score += 25  # distribution / topping
    elif context.get("trend_stage") == 2:
        score += 15  # advancing trend ripe for reversal at top
    if context.get("ma_alignment") == "stacked_bullish":
        score += 10  # overbought context — reversal pattern marks top
    if context.get("volume_signature") == "contracting":
        score += 15
    return min(100.0, score)


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    p1_idx = c["peak1_idx"]
    p2_idx = c["peak2_idx"]
    t_idx = c["trough_idx"]

    peak1_price = c["peak1_price"]
    peak2_price = c["peak2_price"]
    trough_price = c["trough_price"]

    # Levels
    entry = round(trough_price * 0.999, 2)
    stop = round(peak2_price * 1.01, 2)
    # Measured move down: peak2 → trough distance, projected below trough
    target = round(trough_price - (peak2_price - trough_price), 2)
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Double Top",
        "category": "classical",
        "direction": "bearish",
        "start_t": int(bars[p1_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[p1_idx]["t"]),
                     int(bars[t_idx]["t"]),
                     int(bars[p2_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "neckline",
            "anchors": [
                {"t": int(bars[p1_idx]["t"]), "price": float(peak1_price)},
                {"t": int(bars[t_idx]["t"]), "price": float(trough_price)},
                {"t": int(bars[p2_idx]["t"]), "price": float(peak2_price)},
            ],
            "extras": {
                "peak_similarity_pct": round(c["peak_similarity"] * 100, 2),
                "retrace_depth_pct": round(c["retrace_depth"] * 100, 2),
                "pattern_bars": int(c["pattern_bars"]),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close < {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "peak2_plus_1pct",
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
            "headline": (f"Double top forming - peaks within {c['peak_similarity']*100:.1f}%, "
                         f"retrace trough {trough_price:.2f} ({c['retrace_depth']*100:.1f}% off peak), "
                         f"{c['pattern_bars']}-bar pattern"),
            "what_it_is": ("Two-peak topping pattern: the rally to a new high (peak 1) is followed "
                           "by a retrace, then a second rally that fails at approximately the same "
                           "level (peak 2). Classic bearish reversal."),
            "why_it_matters": ("Buyers failed to push past the prior high on the second attempt - "
                               "demand has been exhausted at this level. Declining volume on the "
                               "second peak confirms the failed thrust. A breakdown below the "
                               "retrace trough projects a measured move equal to the peak-to-trough "
                               "distance."),
            "what_to_watch_for": (f"Breakdown below the retrace trough ({trough_price:.2f}) on "
                                  f"volume >= 1.5x the 20-bar average. Entry triggers below "
                                  f"{entry:.2f}; measured-move target {target:.2f}."),
            "failure_signal": (f"Close above peak 2 ({peak2_price:.2f}). Pattern invalidates "
                               f"and the prior uptrend may resume."),
        },
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


register(_PATTERN_ID, detect_double_top)
