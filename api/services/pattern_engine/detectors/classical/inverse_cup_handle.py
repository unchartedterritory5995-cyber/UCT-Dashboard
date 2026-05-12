"""Inverse Cup with Handle detector.

The mirror of the classic O'Neil cup-and-handle: a smooth inverted-U dome
(rounded distribution top) followed by a small failing rally (the handle).
A breakdown below the right trough (or handle low) on expanding volume
projects a measured move equal to the dome depth.

Geometric definition:
  - Dome window: 30-120 bars
  - Left trough: swing-low at the start of the pattern
  - Right trough: swing-low near the end of the dome, before handle starts
  - Trough similarity: |left_trough - right_trough| / left_trough < 0.05
  - Dome peak: highest HIGH between the troughs
  - Dome depth: (dome_peak - left_trough) / left_trough in [0.12, 0.50]
  - Convexity test: degree-2 polynomial fit to closes between troughs must have
    NEGATIVE x^2 coefficient (concave down = ∩ shape). Rejects sharp spikes.
  - Smoothness: stdev of residuals / dome_depth used as soft factor
  - Top-width: count bars whose HIGH sits within the highest 25% of dome depth.
    A rounded top has many bars near the apex; a sharp spike has very few.
  - Handle window: 5-25 bars after the right trough
  - Handle depth (upward): (handle_high - right_trough) / right_trough
                           in [0.02, 0.50 * dome_depth]
  - Handle drift: must NOT pierce above dome_peak
  - Pattern not yet broken: closes haven't punched below right_trough

Scoring (composite 0-100):
  geometry_score:   trough similarity, convexity (residual ratio), depth ideality,
                    handle depth ratio
  volume_score:     contracting bias through dome + handle (softer than cup_handle)
  context_score:    trend_stage 3 (topping/distribution) or 4 (downtrend confirmed),
                    stacked_bullish (overbought-to-reverse context)
  historical_score: 50.0 (neutral prior, Phase 7 wires actual stats)
"""
from __future__ import annotations

import math
import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.geometry import polynomial_fit
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "inverse_cup_handle"
_MIN_PATTERN_BARS = 30          # dome alone must be >= 30 bars
_MAX_PATTERN_BARS = 120         # dome window cap
_MAX_TROUGH_DIFF = 0.05         # |L_trough - R_trough| / L_trough < 5%
_MIN_DOME_DEPTH = 0.12          # 12% min
_MAX_DOME_DEPTH = 0.50          # 50% max
_MIN_HANDLE_BARS = 5
_MAX_HANDLE_BARS = 25
_MIN_HANDLE_DEPTH = 0.02        # 2% min handle rally
_MAX_HANDLE_DEPTH_RATIO = 0.50  # handle depth <= 50% of dome depth
_MAX_RIGHT_TROUGH_AGE = 35      # right trough + handle should be recent
_MIN_TOP_WIDTH_PCT = 0.30       # >= 30% of dome bars within highest 25% of dome depth
_CONFIDENCE_FLOOR = 50.0


def detect_inverse_cup_handle(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect inverse cup-and-handle patterns in the bars. May emit 0-N detections."""
    if len(bars) < _MIN_PATTERN_BARS:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 2:
        return []

    low_pivots_raw = [p for p in pivots if p["type"] == "low"]
    if len(low_pivots_raw) < 2:
        return []

    # Re-key swing-lows with bar_index as `t` (engine convention).
    low_pivots = [{"t": p["bar_index"], "price": p["price"],
                   "type": "low", "strength": p["strength"],
                   "bar_index": p["bar_index"]} for p in low_pivots_raw]

    # Consider the most-recent 12 swing-low pivots. Enumerate pairs
    # (L_trough, R_trough) chronologically. Prefer the highest-confidence
    # valid pattern.
    recent_lows = low_pivots[-12:]
    n = len(recent_lows)
    last_bar_idx = len(bars) - 1

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for i in range(n):
        for j in range(i + 1, n):
            L = recent_lows[i]
            R = recent_lows[j]

            if not (L["bar_index"] < R["bar_index"]):
                continue

            # Right trough must be recent (handle forms after it)
            if last_bar_idx - R["bar_index"] > _MAX_RIGHT_TROUGH_AGE + _MAX_HANDLE_BARS:
                continue

            # Dome span sanity
            dome_span = R["bar_index"] - L["bar_index"]
            if dome_span < _MIN_PATTERN_BARS:
                continue
            if dome_span > _MAX_PATTERN_BARS:
                continue

            candidate = _try_extract_pattern(bars, L, R)
            if candidate is None:
                continue

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


def _try_extract_pattern(bars: List[Bar], L: dict, R: dict) -> Optional[dict]:
    """Validate L (left trough) and R (right trough) as an inverse cup-and-handle.

    Returns candidate dict or None if any geometric check fails.
    """
    l_idx, r_idx = L["bar_index"], R["bar_index"]
    l_price, r_price = L["price"], R["price"]

    if l_price <= 0:
        return None

    # Trough similarity: |left - right| / left < 5%
    trough_diff = abs(l_price - r_price) / l_price
    if trough_diff >= _MAX_TROUGH_DIFF:
        return None

    # Find dome peak: highest HIGH between the troughs (inclusive)
    dome_peak_idx, dome_peak_price = _segment_highest_high(bars, l_idx, r_idx)
    if dome_peak_idx is None:
        return None

    # Dome peak should be sandwiched between the troughs (not on a trough bar)
    if dome_peak_idx == l_idx or dome_peak_idx == r_idx:
        return None

    # Dome depth (anchor on left trough)
    dome_depth_pct = (dome_peak_price - l_price) / l_price
    if dome_depth_pct < _MIN_DOME_DEPTH or dome_depth_pct > _MAX_DOME_DEPTH:
        return None

    # Convexity test: fit degree-2 poly to closes in dome section.
    # coeffs returned highest-degree first: [c_2, c_1, c_0]
    # c_2 (the x^2 coefficient) must be NEGATIVE (concave down = ∩).
    xs = list(range(l_idx, r_idx + 1))
    ys = [bars[i]["c"] for i in xs]
    if len(xs) < 4:
        return None
    coeffs = polynomial_fit(xs, ys, degree=2)
    quad_coef = coeffs[0]
    if quad_coef >= 0:
        return None

    # Smoothness: stdev of residuals / dome_depth (in price terms).
    # Lower is better (rounder).
    residuals = []
    for xi, yi in zip(xs, ys):
        y_fit = quad_coef * xi * xi + coeffs[1] * xi + coeffs[2]
        residuals.append(yi - y_fit)
    if len(residuals) >= 2:
        mean_r = sum(residuals) / len(residuals)
        var_r = sum((r - mean_r) ** 2 for r in residuals) / len(residuals)
        residual_stdev = math.sqrt(var_r)
    else:
        residual_stdev = 0.0
    dome_depth_dollars = dome_peak_price - l_price
    if dome_depth_dollars <= 0:
        return None
    roundness_residual = residual_stdev / dome_depth_dollars

    # Spike vs Dome discriminator: count bars whose HIGH sits within the highest
    # 25% of dome depth. A round dome has many bars near the apex; a sharp
    # inverted-V spike has very few. The polynomial fit alone is not enough —
    # a clean spike fits a parabola well in least-squares terms.
    top_threshold = dome_peak_price - dome_depth_dollars * 0.25
    dome_bars_slice = bars[l_idx:r_idx + 1]
    bars_in_top = sum(1 for b in dome_bars_slice if b["h"] >= top_threshold)
    top_width_pct = bars_in_top / max(1, len(dome_bars_slice))
    if top_width_pct < _MIN_TOP_WIDTH_PCT:
        return None

    # ----- Handle ------------------------------------------------------------
    last_bar_idx = len(bars) - 1
    handle_start_idx = r_idx + 1
    if handle_start_idx > last_bar_idx:
        return None

    handle_end_idx = min(handle_start_idx + _MAX_HANDLE_BARS - 1, last_bar_idx)
    handle_bars_count = handle_end_idx - handle_start_idx + 1
    if handle_bars_count < _MIN_HANDLE_BARS:
        return None

    # Handle low & high within handle window
    handle_low_idx, handle_low_price = _segment_lowest_low(
        bars, handle_start_idx, handle_end_idx
    )
    handle_high_idx, handle_high_price = _segment_highest_high(
        bars, handle_start_idx, handle_end_idx
    )
    if handle_low_idx is None or handle_high_idx is None:
        return None

    # Handle must not breach above the dome peak
    if handle_high_price >= dome_peak_price:
        return None

    # Handle depth = upward rally from right trough
    handle_depth_pct = (handle_high_price - r_price) / r_price
    if handle_depth_pct < _MIN_HANDLE_DEPTH:
        return None
    # Handle depth must be at most 50% of dome depth
    if handle_depth_pct > _MAX_HANDLE_DEPTH_RATIO * dome_depth_pct:
        return None

    # Handle must show fading rally (not still pushing up): handle high should
    # NOT be at the very last bar of the window — rally would be ongoing.
    # Allow the high in the first ~70% of the window; the tail should drift
    # back toward the trough.
    handle_high_position = (handle_high_idx - handle_start_idx) / max(1, handle_bars_count - 1)
    if handle_high_position > 0.70:
        return None

    return {
        "left_trough_idx": l_idx,
        "left_trough_price": l_price,
        "right_trough_idx": r_idx,
        "right_trough_price": r_price,
        "dome_peak_idx": dome_peak_idx,
        "dome_peak_price": dome_peak_price,
        "handle_low_idx": handle_low_idx,
        "handle_low_price": handle_low_price,
        "handle_high_idx": handle_high_idx,
        "handle_high_price": handle_high_price,
        "handle_start_idx": handle_start_idx,
        "handle_end_idx": handle_end_idx,
        "trough_diff": trough_diff,
        "dome_depth_pct": dome_depth_pct,
        "handle_depth_pct": handle_depth_pct,
        "roundness_residual": roundness_residual,
        "top_width_pct": top_width_pct,
        "quad_coef": quad_coef,
        "dome_bars": r_idx - l_idx,
        "handle_bars": handle_bars_count,
        "pattern_bars": handle_end_idx - l_idx,
        "start_idx": l_idx,
        "end_idx": handle_end_idx,
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
    """Return True if recent closes have CLOSED below the right trough.

    Two or more consecutive closes below the right trough = breakdown already
    happened — don't fire as 'forming/ready'. We use the right trough itself
    (the structural pattern low) rather than the handle low, because a handle
    low below the trough means the breakdown has already started.
    """
    breakdown_level = c["right_trough_price"]
    r_idx = c["right_trough_idx"]
    last_idx = len(bars) - 1

    max_consec = 0
    consec = 0
    for i in range(r_idx + 1, last_idx + 1):
        if bars[i]["c"] < breakdown_level:
            consec += 1
            if consec > max_consec:
                max_consec = consec
        else:
            consec = 0
    return max_consec >= 2


def _score_geometry(c: dict) -> float:
    # Trough similarity: 100 at perfect match, 0 at the 5% threshold
    trough_diff = c["trough_diff"]
    trough_score = max(0.0, (1.0 - trough_diff / _MAX_TROUGH_DIFF) * 100)

    # Dome depth: textbook is ~20-35%, full points there, tapers at extremes
    depth = c["dome_depth_pct"]
    if 0.20 <= depth <= 0.35:
        depth_score = 100.0
    elif depth < 0.20:
        # 12% (floor) -> 0, 20% -> 100
        depth_score = max(0.0, (depth - _MIN_DOME_DEPTH) / (0.20 - _MIN_DOME_DEPTH) * 100)
    else:
        # 35% -> 100, 50% (cap) -> 0
        depth_score = max(0.0, (_MAX_DOME_DEPTH - depth) / (_MAX_DOME_DEPTH - 0.35) * 100)

    # Roundness residual: lower is rounder. Residual ratio ~0.05 = very round,
    # ~0.30 = lumpy. Score 100 at <=0.05, 0 at >=0.30.
    rr = c["roundness_residual"]
    if rr <= 0.05:
        round_score = 100.0
    elif rr >= 0.30:
        round_score = 0.0
    else:
        round_score = max(0.0, (0.30 - rr) / 0.25 * 100)

    # Handle depth ratio: ideal ~25-40% of dome depth, full points there.
    dome_depth = c["dome_depth_pct"]
    handle_depth = c["handle_depth_pct"]
    if dome_depth > 0:
        ratio = handle_depth / dome_depth
    else:
        ratio = 0
    if 0.20 <= ratio <= 0.40:
        handle_score = 100.0
    elif ratio < 0.20:
        # 0 -> 0, 0.20 -> 100
        handle_score = max(0.0, ratio / 0.20 * 100)
    else:
        # 0.40 -> 100, 0.50 (cap) -> 0
        handle_score = max(0.0, (0.50 - ratio) / 0.10 * 100)

    return round(
        0.30 * trough_score
        + 0.25 * round_score
        + 0.25 * depth_score
        + 0.20 * handle_score, 2
    )


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score contracting volume through the dome and handle.

    Distribution patterns are softer than cup-and-handle on volume signatures,
    but a contracting bias still helps. Compare avg volume in handle vs avg
    volume in dome. Lower = better.
    """
    l_idx = c["left_trough_idx"]
    r_idx = c["right_trough_idx"]
    h_start = c["handle_start_idx"]
    h_end = c["handle_end_idx"]

    dome_slice = bars[l_idx:r_idx + 1]
    handle_slice = bars[h_start:h_end + 1]

    if not dome_slice or not handle_slice:
        return 50.0

    dome_vol = sum(b["v"] for b in dome_slice) / len(dome_slice)
    handle_vol = sum(b["v"] for b in handle_slice) / len(handle_slice)

    if dome_vol <= 0:
        return 50.0

    # Handle/dome ratio: lower = more contraction = better
    ratio = handle_vol / dome_vol
    if ratio <= 0.5:
        handle_score = 100.0
    elif ratio >= 1.2:
        handle_score = 0.0
    else:
        handle_score = (1.2 - ratio) / 0.7 * 100

    # Right side of dome should also be contracting vs left side.
    # Split dome in half, compare averages.
    dome_len = len(dome_slice)
    if dome_len >= 4:
        left_half = dome_slice[: dome_len // 2]
        right_half = dome_slice[dome_len // 2:]
        lv = sum(b["v"] for b in left_half) / max(1, len(left_half))
        rv = sum(b["v"] for b in right_half) / max(1, len(right_half))
        if lv > 0:
            dome_ratio = rv / lv
            if dome_ratio <= 0.7:
                dome_contract_score = 100.0
            elif dome_ratio >= 1.2:
                dome_contract_score = 0.0
            else:
                dome_contract_score = (1.2 - dome_ratio) / 0.5 * 100
        else:
            dome_contract_score = 50.0
    else:
        dome_contract_score = 50.0

    return round(0.60 * handle_score + 0.40 * dome_contract_score, 2)


def _score_context(context: dict) -> float:
    score = 50.0
    # Inverse cup-and-handle is a topping/distribution pattern.
    if context.get("trend_stage") == 3:
        score += 25  # topping / distribution — classic inverse cup-and-handle
    elif context.get("trend_stage") == 4:
        score += 15  # downtrend confirmed — continuation of distribution
    if context.get("ma_alignment") == "stacked_bullish":
        score += 15  # overbought, ripe to roll over
    if context.get("volume_signature") == "contracting":
        score += 10
    return min(100.0, score)


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    l_idx = c["left_trough_idx"]
    r_idx = c["right_trough_idx"]
    dp_idx = c["dome_peak_idx"]
    hl_idx = c["handle_low_idx"]
    hh_idx = c["handle_high_idx"]

    left_trough_price = c["left_trough_price"]
    right_trough_price = c["right_trough_price"]
    dome_peak_price = c["dome_peak_price"]
    handle_low_price = c["handle_low_price"]
    handle_high_price = c["handle_high_price"]

    breakdown_level = min(right_trough_price, handle_low_price)
    dome_depth_dollars = dome_peak_price - right_trough_price

    # Levels (mirror of cup_handle)
    entry = round(breakdown_level * 0.999, 2)
    stop = round(handle_high_price * 1.01, 2)
    # Measured move: project dome depth below the right trough
    target = round(right_trough_price - dome_depth_dollars, 2)
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Inverse Cup with Handle",
        "category": "classical",
        "direction": "bearish",
        "start_t": int(bars[l_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[l_idx]["t"]),
                     int(bars[dp_idx]["t"]),
                     int(bars[r_idx]["t"]),
                     int(bars[hh_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "cup_curve",
            "anchors": [
                {"t": int(bars[l_idx]["t"]), "price": float(left_trough_price)},
                {"t": int(bars[dp_idx]["t"]), "price": float(dome_peak_price)},
                {"t": int(bars[r_idx]["t"]), "price": float(right_trough_price)},
                {"t": int(bars[hl_idx]["t"]), "price": float(handle_low_price)},
                {"t": int(bars[hh_idx]["t"]), "price": float(handle_high_price)},
            ],
            "extras": {
                "dome_depth_pct": round(c["dome_depth_pct"] * 100, 2),
                "handle_depth_pct": round(c["handle_depth_pct"] * 100, 2),
                "trough_similarity_pct": round((1.0 - c["trough_diff"]) * 100, 2),
                "top_width_pct": round(c["top_width_pct"] * 100, 2),
                "roundness_residual": round(float(c["roundness_residual"]), 4),
                "dome_bars": int(c["dome_bars"]),
                "handle_bars": int(c["handle_bars"]),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close < {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "handle_high_plus_1pct",
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
            "headline": (f"Inverse cup with handle forming - {c['dome_depth_pct']*100:.1f}% dome "
                         f"over {c['dome_bars']} bars, {c['handle_depth_pct']*100:.1f}% "
                         f"handle over {c['handle_bars']} bars, breakdown at "
                         f"{breakdown_level:.2f}"),
            "what_it_is": ("Bearish reversal pattern (distribution top): a smooth inverted-U "
                           "dome followed by a small failing rally on the right side (the "
                           "handle). Sellers absorb demand gradually through the dome, and "
                           "the handle is the final upthrust before breakdown."),
            "why_it_matters": ("The rounded top signals patient, sustained distribution - "
                               "not a panic spike top. The failing handle rally on weaker "
                               "volume confirms supply pressure. A breakdown below the right "
                               "trough on expanding volume projects a measured move equal to "
                               "the depth of the dome."),
            "what_to_watch_for": (f"Breakdown below {breakdown_level:.2f} on volume >= 1.5x "
                                  f"the 20-bar average. Short entry triggers below {entry:.2f}; "
                                  f"measured-move target {target:.2f}; stop {stop:.2f}."),
            "failure_signal": (f"Close above the handle high ({handle_high_price:.2f}). "
                               f"Pattern invalidates and the prior consolidation may "
                               f"resolve to the upside."),
        },
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


register(_PATTERN_ID, detect_inverse_cup_handle)
