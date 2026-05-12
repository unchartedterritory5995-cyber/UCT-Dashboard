"""Inverse Head and Shoulders detector.

The classic three-trough bullish reversal — the mirror of head_shoulders.
The middle trough (head) is the lowest of the three; the two flanking
troughs (shoulders) are roughly symmetric in depth. A "neckline" connects
the two peaks between the troughs. A breakout above the neckline projects
a measured move equal to the head-to-neckline distance.

Geometric definition:
  - Window: 30-100 bars
  - Three swing-low pivots ordered chronologically: L < H < R (bar_index)
  - Head dominance: head < left_shoulder AND head < right_shoulder
  - Shoulder symmetry: |left - right| / head < 0.15  (within 15% of head)
  - Neckline: line connecting the two peaks (highest highs between troughs)
  - Neckline horizontality: |slope| < 0.005 * head_price (roughly horizontal)
  - Spacing: head_idx - left_idx >= 5 bars, right_idx - head_idx >= 5 bars
  - Pattern not yet broken: recent closes have not closed above neckline projection
  - Recent: right shoulder within the last 30 bars
  - Volume: declining through the pattern (especially right shoulder vs left shoulder)

Scoring (composite 0-100):
  geometry_score:   symmetry, neckline horizontality, trough spacing, head dominance
  volume_score:     declining volume through the pattern (right vs left vs head)
  context_score:    trend_stage 1/4 (basing / oversold), stacked_bearish
  historical_score: 50.0 (neutral prior, Phase 7 wires actual stats)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.geometry import line_at
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "inverse_head_shoulders"
_MIN_PATTERN_BARS = 30
_MAX_PATTERN_BARS = 100
_MAX_SHOULDER_ASYMMETRY = 0.15      # |left - right| / head < 0.15
_MAX_NECKLINE_SLOPE_PCT = 0.005     # |slope| < 0.005 * head_price (per-bar)
_MIN_PEAK_SPACING = 5               # head-left >= 5 bars, right-head >= 5 bars
_MAX_RIGHT_SHOULDER_AGE = 30        # right shoulder within last 30 bars
_CONFIDENCE_FLOOR = 50.0


def detect_inverse_head_shoulders(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect inverse head-and-shoulders patterns in the bars. May emit 0-N detections."""
    if len(bars) < _MIN_PATTERN_BARS:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 3:
        return []

    # Re-key swing-lows with bar_index as `t` so any line math is bar-based.
    low_pivots_raw = [p for p in pivots if p["type"] == "low"]
    if len(low_pivots_raw) < 3:
        return []

    low_pivots = [{"t": p["bar_index"], "price": p["price"],
                   "type": "low", "strength": p["strength"],
                   "bar_index": p["bar_index"]} for p in low_pivots_raw]

    # Consider the most-recent 8 swing-low pivots. Enumerate triples (L, H, R)
    # with L < H < R chronologically. Prefer the most recent valid pattern.
    recent_lows = low_pivots[-8:]
    n = len(recent_lows)
    last_bar_idx = len(bars) - 1

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for i in range(n):
        for j in range(i + 1, n):
            for k in range(j + 1, n):
                L = recent_lows[i]
                H = recent_lows[j]
                R = recent_lows[k]

                # Chronological ordering by bar_index
                if not (L["bar_index"] < H["bar_index"] < R["bar_index"]):
                    continue

                # Recent constraint: right shoulder within last N bars
                if last_bar_idx - R["bar_index"] > _MAX_RIGHT_SHOULDER_AGE:
                    continue

                candidate = _try_extract_pattern(bars, L, H, R)
                if candidate is None:
                    continue

                # Pattern not yet broken: recent closes have not breached neckline upward
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


def _try_extract_pattern(bars: List[Bar], L: dict, H: dict, R: dict) -> Optional[dict]:
    """Validate L < H < R as an inverse head-and-shoulders. Returns candidate dict or None."""
    l_idx, h_idx, r_idx = L["bar_index"], H["bar_index"], R["bar_index"]

    # Spacing sanity
    if h_idx - l_idx < _MIN_PEAK_SPACING:
        return None
    if r_idx - h_idx < _MIN_PEAK_SPACING:
        return None

    # Pattern window length (L->R)
    pattern_bars = r_idx - l_idx
    # Floor: spacing already guarantees >=10 bars (5 each side).
    # Cap: prevent ancient sprawling patterns.
    if pattern_bars > _MAX_PATTERN_BARS:
        return None

    l_price = L["price"]
    h_price = H["price"]
    r_price = R["price"]

    # Head dominance: head must be strictly LOWEST
    if h_price >= l_price:
        return None
    if h_price >= r_price:
        return None

    # Shoulder symmetry: |left - right| / head < 15%
    asymmetry = abs(l_price - r_price) / h_price
    if asymmetry >= _MAX_SHOULDER_ASYMMETRY:
        return None

    # Find peaks between troughs (highest HIGH in each segment)
    # Peak 1: between L and H (indices l_idx+1 .. h_idx-1)
    # Peak 2: between H and R (indices h_idx+1 .. r_idx-1)
    if h_idx - l_idx < 2 or r_idx - h_idx < 2:
        return None

    p1_idx, p1_price = _segment_highest_high(bars, l_idx + 1, h_idx - 1)
    p2_idx, p2_price = _segment_highest_high(bars, h_idx + 1, r_idx - 1)

    if p1_idx is None or p2_idx is None:
        return None

    # Neckline: line from (p1_idx, p1_price) to (p2_idx, p2_price)
    if p2_idx == p1_idx:
        return None
    neckline_slope = (p2_price - p1_price) / (p2_idx - p1_idx)
    neckline_intercept = p1_price - neckline_slope * p1_idx

    # Neckline horizontality: |slope| < 0.005 * head_price (per bar)
    max_slope_abs = _MAX_NECKLINE_SLOPE_PCT * h_price
    if abs(neckline_slope) >= max_slope_abs:
        return None

    # Neckline values at key bar indices
    neckline_at_h = neckline_slope * h_idx + neckline_intercept
    last_bar_idx = len(bars) - 1
    neckline_at_now = neckline_slope * last_bar_idx + neckline_intercept

    # Head must be meaningfully below neckline (otherwise it's not a head)
    if h_price >= neckline_at_h:
        return None

    # Shoulders should also be below neckline
    neckline_at_l = neckline_slope * l_idx + neckline_intercept
    neckline_at_r = neckline_slope * r_idx + neckline_intercept
    if l_price >= neckline_at_l or r_price >= neckline_at_r:
        return None

    head_pct_below_shoulders = ((l_price + r_price) / 2 - h_price) / h_price

    return {
        "left_shoulder_idx": l_idx,
        "left_shoulder_price": l_price,
        "head_idx": h_idx,
        "head_price": h_price,
        "right_shoulder_idx": r_idx,
        "right_shoulder_price": r_price,
        "peak1_idx": p1_idx,
        "peak1_price": p1_price,
        "peak2_idx": p2_idx,
        "peak2_price": p2_price,
        "neckline_slope": neckline_slope,
        "neckline_intercept": neckline_intercept,
        "neckline_at_head_t": neckline_at_h,
        "neckline_at_now": neckline_at_now,
        "asymmetry": asymmetry,
        "head_pct_below_shoulders": head_pct_below_shoulders,
        "pattern_bars": r_idx - l_idx,
        "start_idx": l_idx,
        "end_idx": r_idx,
    }


def _segment_highest_high(bars: List[Bar], a: int, b: int) -> tuple:
    """Return (bar_index, high_price) of the highest HIGH in bars[a..b] inclusive."""
    if a > b or a < 0 or b >= len(bars):
        return (None, None)
    best_idx = a
    best_high = bars[a]["h"]
    for i in range(a + 1, b + 1):
        if bars[i]["h"] > best_high:
            best_high = bars[i]["h"]
            best_idx = i
    return (best_idx, best_high)


def _pattern_already_broken(bars: List[Bar], c: dict) -> bool:
    """Return True if recent bars have CLOSED above the neckline projection.

    "Pattern not yet broken" means we're still in the right-shoulder formation
    or early breakout — but if multiple recent closes are above the projected
    neckline, the breakout has already happened and we shouldn't fire as
    'forming'.
    """
    slope = c["neckline_slope"]
    intercept = c["neckline_intercept"]
    r_idx = c["right_shoulder_idx"]
    last_idx = len(bars) - 1

    # Check closes from right shoulder onwards; allow occasional pops but
    # 2+ consecutive closes above neckline = already broken.
    closes_above = 0
    max_consec = 0
    consec = 0
    for i in range(r_idx, last_idx + 1):
        nl = slope * i + intercept
        if bars[i]["c"] > nl:
            closes_above += 1
            consec += 1
            if consec > max_consec:
                max_consec = consec
        else:
            consec = 0
    # If we have 2+ consecutive closes above, treat as already broken.
    return max_consec >= 2


def _score_geometry(c: dict) -> float:
    # Symmetry score: 100 at perfect symmetry, 0 at threshold
    sym_score = max(0.0, (1.0 - c["asymmetry"] / _MAX_SHOULDER_ASYMMETRY) * 100)

    # Neckline horizontality: lower |slope| = better
    head_price = c["head_price"]
    max_slope = _MAX_NECKLINE_SLOPE_PCT * head_price
    neckline_score = max(0.0, (1.0 - abs(c["neckline_slope"]) / max_slope) * 100)

    # Head dominance: 100 = head 10%+ below avg shoulder, scales down to 0
    head_dom = c["head_pct_below_shoulders"]
    if head_dom >= 0.10:
        head_dom_score = 100.0
    elif head_dom <= 0.0:
        head_dom_score = 0.0
    else:
        head_dom_score = head_dom / 0.10 * 100

    # Spacing: ideal ~10-15 bars between each trough; declines below 5 or above 25
    left_span = c["head_idx"] - c["left_shoulder_idx"]
    right_span = c["right_shoulder_idx"] - c["head_idx"]
    avg_span = (left_span + right_span) / 2.0
    if 8 <= avg_span <= 18:
        span_score = 100.0
    elif avg_span < 8:
        span_score = max(0.0, (avg_span - 5) / 3 * 100)
    else:
        span_score = max(0.0, 100 - (avg_span - 18) * 5)

    # Span balance: penalize wildly mismatched left/right spans
    if max(left_span, right_span) > 0:
        balance = min(left_span, right_span) / max(left_span, right_span)
    else:
        balance = 0.0
    balance_score = balance * 100

    return round(
        0.30 * sym_score
        + 0.25 * neckline_score
        + 0.20 * head_dom_score
        + 0.15 * span_score
        + 0.10 * balance_score, 2
    )


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score declining volume through the pattern.

    Compares avg volume around right shoulder vs left shoulder. Lower right
    shoulder volume = stronger reversal signal (capitulation faded). Also
    rewards lower volume on head relative to left shoulder.
    """
    l_idx = c["left_shoulder_idx"]
    h_idx = c["head_idx"]
    r_idx = c["right_shoulder_idx"]

    # Window of ~3 bars centered on each trough
    def _window_avg(center, half=2):
        lo = max(0, center - half)
        hi = min(len(bars) - 1, center + half)
        if hi < lo:
            return 0.0
        win = bars[lo:hi + 1]
        return sum(b["v"] for b in win) / len(win)

    left_vol = _window_avg(l_idx)
    head_vol = _window_avg(h_idx)
    right_vol = _window_avg(r_idx)

    if left_vol <= 0:
        return 50.0

    # Right shoulder volume ratio vs left shoulder. Lower = better.
    r_ratio = right_vol / left_vol
    # Head volume ratio vs left. Should be similar or lower in classic inverse H&S
    h_ratio = head_vol / left_vol

    # Right shoulder declining: 100 if right_vol = 30% of left, 0 if >= 100%
    if r_ratio >= 1.0:
        r_score = 0.0
    elif r_ratio <= 0.3:
        r_score = 100.0
    else:
        r_score = (1.0 - r_ratio) / 0.7 * 100

    # Head not expanding: lower or equal head vol = good
    if h_ratio <= 1.0:
        h_score = 100.0 - (h_ratio - 0.5) * 50 if h_ratio >= 0.5 else 100.0
        h_score = max(0.0, min(100.0, h_score))
    elif h_ratio >= 1.5:
        h_score = 0.0
    else:
        h_score = (1.5 - h_ratio) / 0.5 * 50

    return round(0.65 * r_score + 0.35 * h_score, 2)


def _score_context(context: dict) -> float:
    score = 50.0
    # Inverse H&S is bullish — boost on basing/oversold context.
    if context.get("trend_stage") == 1:
        score += 25  # accumulation / basing
    elif context.get("trend_stage") == 4:
        score += 15  # declining trend ripe for reversal at bottom
    if context.get("ma_alignment") == "stacked_bearish":
        score += 10  # oversold context — reversal pattern marks bottom
    if context.get("volume_signature") == "contracting":
        score += 15
    return min(100.0, score)


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    l_idx = c["left_shoulder_idx"]
    h_idx = c["head_idx"]
    r_idx = c["right_shoulder_idx"]
    p1_idx = c["peak1_idx"]
    p2_idx = c["peak2_idx"]

    head_price = c["head_price"]
    right_shoulder_price = c["right_shoulder_price"]
    neckline_at_now = c["neckline_at_now"]
    neckline_at_head_t = c["neckline_at_head_t"]

    # Levels
    entry = round(neckline_at_now * 1.001, 2)
    stop = round(right_shoulder_price * 0.99, 2)
    # Measured move: neckline_to_head distance projected above neckline
    neckline_to_head = neckline_at_head_t - head_price
    target = round(neckline_at_now + neckline_to_head, 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Inverse Head and Shoulders",
        "category": "classical",
        "direction": "bullish",
        "start_t": int(bars[l_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[l_idx]["t"]),
                     int(bars[h_idx]["t"]),
                     int(bars[r_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "neckline",
            "anchors": [
                {"t": int(bars[l_idx]["t"]), "price": float(c["left_shoulder_price"])},
                {"t": int(bars[p1_idx]["t"]), "price": float(c["peak1_price"])},
                {"t": int(bars[h_idx]["t"]), "price": float(head_price)},
                {"t": int(bars[p2_idx]["t"]), "price": float(c["peak2_price"])},
                {"t": int(bars[r_idx]["t"]), "price": float(right_shoulder_price)},
            ],
            "extras": {
                "head_pct_below_shoulders": round(c["head_pct_below_shoulders"] * 100, 2),
                "shoulder_symmetry": round((1.0 - c["asymmetry"]) * 100, 2),
                "neckline_slope": round(float(c["neckline_slope"]), 6),
                "pattern_bars": int(c["pattern_bars"]),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "right_shoulder_minus_1pct",
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
            "headline": (f"Inverse head and shoulders forming - head {c['head_pct_below_shoulders']*100:.1f}% "
                         f"below shoulders, neckline ~{neckline_at_now:.2f}, "
                         f"{c['pattern_bars']}-bar pattern"),
            "what_it_is": ("Three-trough basing pattern: middle trough (head) is lowest, flanked by "
                           "two roughly symmetric shoulders. The neckline connects the two peaks "
                           "between the troughs. Classic bullish reversal."),
            "why_it_matters": ("Sellers tried to push to a new low (head) but the next decline "
                               "(right shoulder) failed to match. Declining volume confirms supply "
                               "exhaustion. A breakout above the neckline projects a measured move "
                               "equal to the neckline-to-head distance."),
            "what_to_watch_for": (f"Breakout above the neckline ({neckline_at_now:.2f}) on "
                                  f"volume >= 1.5x the 20-bar average. Entry triggers above "
                                  f"{entry:.2f}; measured-move target {target:.2f}."),
            "failure_signal": (f"Close below the right shoulder ({right_shoulder_price:.2f}). "
                               f"Pattern invalidates and the prior downtrend may resume."),
        },
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


register(_PATTERN_ID, detect_inverse_head_shoulders)
