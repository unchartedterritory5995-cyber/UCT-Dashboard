"""Three Black Crows candlestick detector.

The Three Black Crows is one of the most powerful 3-bar bearish reversal /
continuation sequences in the Japanese-candlestick lexicon. Codified by Steve
Nison in 'Japanese Candlestick Charting Techniques' (1991), rooted in Munehisa
Homma's 18th-century Sakata rules, the pattern captures three consecutive
sessions where the bears controlled price action from open to close - each
session opened INSIDE the prior body (no exhaustion gap-down that bleeds in
late-day short-covering), and each closed NEAR its own LOW (no late-day bid
rescuing price). The visual signature: three marching red candles, each lower
than the last, each with a long body and trivial lower wick. This is
institutional distribution playing out in real-time.

Definition (geometry):
  - 3 consecutive bars, all RED (close < open)
  - Each bar has a long body (body_pct >= 0.60 of range)
  - Each subsequent bar opens within the PREVIOUS bar's body
    (open <= prior_open AND open >= prior_close)
  - Each subsequent bar closes near its OWN low (DCR <= 0.30)
  - Each bar's close is LOWER than the previous bar's close
  - No long lower wicks (lower_wick <= 0.15 of range on each bar)

Context (critical — DUAL gate, NOT a pure reversal gate):
  Three Black Crows is legitimately BOTH a continuation AND a reversal
  pattern. A strict "must have reversal context" gate (like tweezer/shooting
  star) would WRONGLY suppress a valid TBC firing at a Stage-3 distribution
  breakdown — which by design has a recent advance but may not have all three
  reversal flags set, and stacked-bearish MAs that AWARD a ctx bonus. Therefore
  this detector uses a RELAXED dual predicate: a candidate is blocked ONLY when
  it is unambiguously mid-Stage-4 downtrend with no prior advance whatsoever.

  The dual gate (evaluated at bar i, the 3rd crow):
    in_reversal_context   = at_swing_high
                            OR above_50sma
                            OR recent_advance_pct >= _MIN_ADVANCE_FOR_REVERSAL (5%)
    in_continuation_context = (trend_stage == 3)
                               OR (recent_advance_pct >= _CONT_MOVE_RELAX) (3%)
    if not (in_reversal_context or in_continuation_context): continue

  This blocks only the "mid-Stage-4, no prior rally, no distribution context"
  false-fire. It preserves:
    - Stage-3 distribution top continuation (trend_stage=3, recent advance →
      passes)
    - Any 3%+ rally before the crows (relaxed continuation threshold)
    - Genuine reversal off swing highs / above-50SMA / >=5% advance

  The CLIMAX penalty (decline >= 40% → −10 ctx) remains intact; it addresses
  overextension at the BOTTOM, which is a different concern from mid-trend
  noise.

  - DCR signature distribution + all three bars DCR <= 0.30 = institutional
    fingerprint of stacked selling days.

Direction: bearish.
Confirmation: NEXT bar (bar N+1) close BELOW bar N's low on rising volume.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.dcr import compute_dcr, dcr_strength
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "three_black_crows"
_MIN_BARS = 7
_MIN_LONG_BODY_PCT = 0.60
_MAX_DCR = 0.30
_MAX_LOWER_WICK_PCT = 0.15
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_CONFIDENCE_FLOOR = 50.0
# Dual-gate thresholds (see docstring)
_MIN_DECLINE_FOR_REVERSAL = 0.05   # reserved for TWS mirror; unused here
_MIN_ADVANCE_FOR_REVERSAL = 0.05   # 5%: qualifies as reversal context
_CONT_MOVE_RELAX = 0.03            # 3%: relaxed threshold to qualify as continuation context


def detect_three_black_crows(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect three-black-crows 3-bar patterns. Emits 0 or 1 Detection (most recent)."""
    if len(bars) < _MIN_BARS:
        return []

    detections: List[Detection] = []
    start = max(2, len(bars) - _SCAN_LOOKBACK)
    for i in range(start, len(bars)):
        candidate = _try_extract(bars, i)
        if candidate is None:
            continue

        # Compute context helpers once — used by the dual gate, scorer, and builder.
        at_swing_high = _is_swing_high(bars, i)
        above_50 = not _below_sma50(bars, i)
        advance = _recent_advance_pct(bars, i)
        trend_stage = context.get("trend_stage")

        # ------------------------------------------------------------------ #
        # Dual continuation+reversal gate (see module docstring).             #
        # Blocks only mid-Stage-4 downtrend with no prior context at all.     #
        # ------------------------------------------------------------------ #
        in_reversal_context = (
            at_swing_high
            or above_50
            or advance >= _MIN_ADVANCE_FOR_REVERSAL
        )
        in_continuation_context = (
            trend_stage == 3
            or advance >= _CONT_MOVE_RELAX
        )
        if not (in_reversal_context or in_continuation_context):
            continue  # mid-trend, no-prior-context false-fire: suppress

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, i)
        ctx_score = _score_context(
            context, bars, i, candidate,
            at_swing_high=at_swing_high, above_50=above_50, advance=advance,
        )
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(
            bars, candidate, i, confidence, context, geom_score, vol_score, ctx_score, hist_score,
            at_swing_high=at_swing_high, above_50=above_50, advance=advance,
        )
        detections.append(d)

    if not detections:
        return []
    return detections[-1:]


def _try_extract(bars: List[Bar], i: int) -> Optional[dict]:
    if i < 2:
        return None
    bar1 = bars[i - 2]
    bar2 = bars[i - 1]
    bar3 = bars[i]

    # --- All 3 bars must be RED ---
    b1_o, b1_c = bar1["o"], bar1["c"]
    b2_o, b2_c = bar2["o"], bar2["c"]
    b3_o, b3_c = bar3["o"], bar3["c"]
    if b1_c >= b1_o or b2_c >= b2_o or b3_c >= b3_o:
        return None

    b1_body = b1_o - b1_c
    b2_body = b2_o - b2_c
    b3_body = b3_o - b3_c
    b1_range = bar1["h"] - bar1["l"]
    b2_range = bar2["h"] - bar2["l"]
    b3_range = bar3["h"] - bar3["l"]
    if b1_range <= 0 or b2_range <= 0 or b3_range <= 0:
        return None
    if b1_body <= 0 or b2_body <= 0 or b3_body <= 0:
        return None

    # --- All 3 bars must have LONG bodies ---
    b1_body_pct = b1_body / b1_range
    b2_body_pct = b2_body / b2_range
    b3_body_pct = b3_body / b3_range
    if b1_body_pct < _MIN_LONG_BODY_PCT:
        return None
    if b2_body_pct < _MIN_LONG_BODY_PCT:
        return None
    if b3_body_pct < _MIN_LONG_BODY_PCT:
        return None

    # --- Each subsequent bar opens WITHIN the prior bar's body ---
    # For red bars: body runs from open (top) DOWN to close (bottom).
    # bar2.open <= bar1.open AND bar2.open >= bar1.close
    if b2_o > b1_o or b2_o < b1_c:
        return None
    if b3_o > b2_o or b3_o < b2_c:
        return None

    # --- Closes must progress LOWER ---
    if not (b3_c < b2_c < b1_c):
        return None

    # --- Each bar's DCR (close near own low) <= 0.30 ---
    b1_dcr = compute_dcr(bar1)
    b2_dcr = compute_dcr(bar2)
    b3_dcr = compute_dcr(bar3)
    if b1_dcr > _MAX_DCR or b2_dcr > _MAX_DCR or b3_dcr > _MAX_DCR:
        return None

    # --- Lower wicks must be small (no late-day reversals to upside) ---
    b1_lower_wick = (b1_c - bar1["l"]) / b1_range
    b2_lower_wick = (b2_c - bar2["l"]) / b2_range
    b3_lower_wick = (b3_c - bar3["l"]) / b3_range
    if b1_lower_wick > _MAX_LOWER_WICK_PCT:
        return None
    if b2_lower_wick > _MAX_LOWER_WICK_PCT:
        return None
    if b3_lower_wick > _MAX_LOWER_WICK_PCT:
        return None

    # --- Open-in-prior-body normalized (1.0 = at prior open, 0.0 = at prior close) ---
    # For red bar: body runs from open (top) to close (bottom).
    # Position 1.0 = at prior open (top), 0.0 = at prior close (bottom).
    b2_open_pos = (b2_o - b1_c) / b1_body if b1_body > 0 else 0.5
    b3_open_pos = (b3_o - b2_c) / b2_body if b2_body > 0 else 0.5

    # --- Total 3-bar move % (negative for crows) ---
    total_move_pct = (b3_c - b1_o) / b1_o if b1_o > 0 else 0.0

    # --- Per-bar decline %s ---
    b1_decline_pct = b1_body / b1_o if b1_o > 0 else 0.0
    b2_decline_pct = b2_body / b2_o if b2_o > 0 else 0.0
    b3_decline_pct = b3_body / b3_o if b3_o > 0 else 0.0

    # --- Body consistency ---
    bodies_pct = [b1_body_pct, b2_body_pct, b3_body_pct]
    body_pct_avg = sum(bodies_pct) / 3.0
    body_pct_min = min(bodies_pct)

    return {
        "bar1": bar1, "bar2": bar2, "bar3": bar3,
        "b1_open": b1_o, "b1_close": b1_c,
        "b2_open": b2_o, "b2_close": b2_c,
        "b3_open": b3_o, "b3_close": b3_c,
        "b1_body": b1_body, "b2_body": b2_body, "b3_body": b3_body,
        "b1_body_pct": b1_body_pct, "b2_body_pct": b2_body_pct, "b3_body_pct": b3_body_pct,
        "b1_range": b1_range, "b2_range": b2_range, "b3_range": b3_range,
        "b1_dcr": b1_dcr, "b2_dcr": b2_dcr, "b3_dcr": b3_dcr,
        "b1_lower_wick": b1_lower_wick,
        "b2_lower_wick": b2_lower_wick,
        "b3_lower_wick": b3_lower_wick,
        "b2_open_pos": b2_open_pos,
        "b3_open_pos": b3_open_pos,
        "b1_decline_pct": b1_decline_pct,
        "b2_decline_pct": b2_decline_pct,
        "b3_decline_pct": b3_decline_pct,
        "total_move_pct": total_move_pct,
        "body_pct_avg": body_pct_avg,
        "body_pct_min": body_pct_min,
        "b3_high": bar3["h"],
        "b3_low": bar3["l"],
        "b1_high": bar1["h"],
        "b2_high": bar2["h"],
        "pattern_low": min(bar1["l"], bar2["l"], bar3["l"]),
        "pattern_high": max(bar1["h"], bar2["h"], bar3["h"]),
    }


def _is_swing_high(bars: List[Bar], i: int) -> bool:
    lookback = bars[max(0, i - _SWING_LOOKBACK):i + 1]
    if len(lookback) < 4:
        return False
    high_max = max(b["h"] for b in lookback)
    low_min = min(b["l"] for b in lookback)
    rng = high_max - low_min
    if rng <= 0:
        return False
    bar_high = max(bars[i]["h"], bars[i - 1]["h"], bars[i - 2]["h"])
    return (high_max - bar_high) / rng <= 0.20


def _below_sma50(bars: List[Bar], i: int) -> bool:
    if i < 49:
        return False
    closes = [b["c"] for b in bars[i - 49:i + 1]]
    if not closes:
        return False
    sma = sum(closes) / len(closes)
    return bars[i]["c"] < sma


def _recent_advance_pct(bars: List[Bar], i: int) -> float:
    """Advance from recent 15-bar low to the 3-bar pattern high."""
    start = max(0, i - 14)
    window = bars[start:i + 1]
    if not window:
        return 0.0
    low = min(b["l"] for b in window)
    high_now = max(bars[i]["h"], bars[i - 1]["h"], bars[i - 2]["h"])
    if low <= 0:
        return 0.0
    return (high_now - low) / low


def _recent_decline_pct(bars: List[Bar], i: int) -> float:
    """Decline from recent 30-bar high to current low (used for climax detection)."""
    start = max(0, i - 29)
    window = bars[start:i + 1]
    if not window:
        return 0.0
    high = max(b["h"] for b in window)
    low_now = min(bars[i]["l"], bars[i - 1]["l"], bars[i - 2]["l"])
    if high <= 0:
        return 0.0
    return (high - low_now) / high


def _score_geometry(c: dict) -> float:
    """Score the 3-bar three-black-crows anatomy."""
    body_avg = c["body_pct_avg"]
    body_min = c["body_pct_min"]
    if body_avg >= 0.80 and body_min >= 0.70:
        body_score = 100.0
    elif body_avg >= 0.70:
        body_score = 75.0 + (body_avg - 0.70) / 0.10 * 25.0
    elif body_avg >= 0.60:
        body_score = 50.0 + (body_avg - 0.60) / 0.10 * 25.0
    else:
        body_score = max(0.0, body_avg / 0.60 * 50.0)

    # Open-in-prior-body cleanliness
    def _open_quality(pos: float) -> float:
        dist_from_mid = abs(pos - 0.5)
        if dist_from_mid <= 0.2:
            return 100.0
        if dist_from_mid <= 0.35:
            return 70.0 + (0.35 - dist_from_mid) / 0.15 * 30.0
        return max(40.0, 70.0 - (dist_from_mid - 0.35) / 0.15 * 30.0)
    open_score = (_open_quality(c["b2_open_pos"]) + _open_quality(c["b3_open_pos"])) / 2.0

    # DCR strength: all 3 bars closing near own low (DCR <= 0.30)
    # Lower = stronger bearish
    dcr_avg = (c["b1_dcr"] + c["b2_dcr"] + c["b3_dcr"]) / 3.0
    inverted = 1.0 - dcr_avg  # higher = more bearish
    if inverted >= 0.90:  # avg DCR <= 0.10
        dcr_score = 100.0
    elif inverted >= 0.80:  # avg DCR <= 0.20
        dcr_score = 75.0 + (inverted - 0.80) / 0.10 * 25.0
    elif inverted >= 0.70:  # avg DCR <= 0.30
        dcr_score = 50.0 + (inverted - 0.70) / 0.10 * 25.0
    else:
        dcr_score = max(0.0, inverted / 0.70 * 50.0)

    # DCR-aware boost: all 3 bars <= 0.30 + at least 2 <= 0.15 = +10
    dcr_bonus = 0.0
    strong_dcrs = sum(1 for d in (c["b1_dcr"], c["b2_dcr"], c["b3_dcr"]) if d <= 0.15)
    if strong_dcrs >= 2:
        dcr_bonus = 10.0

    return round(min(100.0, 0.40 * body_score + 0.25 * open_score + 0.35 * dcr_score + dcr_bonus), 2)


def _score_volume(bars: List[Bar], i: int) -> float:
    """Volume: ideal is steady or rising across the 3 bars; vs 10-bar prior avg."""
    if i < 12:
        v1 = bars[i - 2]["v"]
        v2 = bars[i - 1]["v"]
        v3 = bars[i]["v"]
        if min(v1, v2, v3) <= 0:
            return 50.0
        if v3 >= v2 >= v1:
            return 80.0
        if v3 >= v1:
            return 60.0
        return 35.0

    v1 = bars[i - 2]["v"]
    v2 = bars[i - 1]["v"]
    v3 = bars[i]["v"]
    if min(v1, v2, v3) <= 0:
        return 50.0

    prior_window = bars[max(0, i - 12):i - 2]
    if not prior_window:
        return 50.0
    prior_avg = sum(b["v"] for b in prior_window) / len(prior_window)
    if prior_avg <= 0:
        return 50.0

    avg3 = (v1 + v2 + v3) / 3.0
    ratio = avg3 / prior_avg

    if ratio >= 1.50:
        commit_score = 100.0
    elif ratio >= 1.20:
        commit_score = 70.0 + (ratio - 1.20) / 0.30 * 30.0
    elif ratio >= 1.00:
        commit_score = 50.0 + (ratio - 1.00) / 0.20 * 20.0
    elif ratio >= 0.80:
        commit_score = 30.0 + (ratio - 0.80) / 0.20 * 20.0
    else:
        commit_score = max(0.0, ratio / 0.80 * 30.0)

    if v3 >= v2 >= v1:
        prog_score = 100.0
    elif v3 >= v1:
        prog_score = 75.0
    elif v3 >= 0.85 * v1:
        prog_score = 50.0
    else:
        prog_score = 20.0

    return round(0.60 * commit_score + 0.40 * prog_score, 2)


def _score_context(
    context: dict,
    bars: List[Bar],
    i: int,
    c: dict,
    *,
    at_swing_high: Optional[bool] = None,
    above_50: Optional[bool] = None,
    advance: Optional[float] = None,
) -> float:
    score = 25.0
    swing_high = at_swing_high if at_swing_high is not None else _is_swing_high(bars, i)
    below_50 = not above_50 if above_50 is not None else _below_sma50(bars, i)
    advance = advance if advance is not None else _recent_advance_pct(bars, i)
    decline = _recent_decline_pct(bars, i)

    if swing_high:
        score += 20
    if advance >= 0.10:
        score += 15
    elif advance >= 0.05:
        score += 8

    ma_align = context.get("ma_alignment")
    if ma_align == "stacked_bearish":
        score += 10
    if below_50:
        score += 5

    # DCR strength
    dcr_avg = (c["b1_dcr"] + c["b2_dcr"] + c["b3_dcr"]) / 3.0
    if dcr_avg <= 0.10:
        score += 10
    elif dcr_avg <= 0.20:
        score += 5

    # Context DCR signature
    dcr_sig = context.get("dcr_signature")
    if dcr_sig == "distribution":
        score += 5  # corroborates ongoing distribution
    elif dcr_sig == "accumulation":
        score += 8  # transition signal - flipped the chart

    # Trend stage: 3 (distribution) or 4 (downtrend) ideal; 1-2 means climax-bottom risk
    stage = context.get("trend_stage")
    if stage in (3, 4):
        score += 5
    elif stage == 2:
        score -= 5

    # Climax-bottom warning: if recent decline >40%, pattern may be exhaustion
    if decline >= 0.40:
        score -= 10

    res = context.get("nearest_resistance")
    if res and res > 0 and abs(c["pattern_high"] - res) / res <= 0.015:
        score += 5

    return min(100.0, max(0.0, score))


def _trend_phrase(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 2: return "a Stage 2 uptrend"
    if stage == 1: return "a Stage 1 base/accumulation environment"
    if stage == 3: return "a Stage 3 distribution environment"
    if stage == 4: return "a Stage 4 downtrend environment"
    return "an undefined trend stage"


def _ma_phrase(context: dict) -> str:
    return {
        "stacked_bullish": "stacked-bullish",
        "stacked_bearish": "stacked-bearish",
        "mixed": "mixed",
    }.get(context.get("ma_alignment", "mixed"), "mixed")


def _rs_phrase(context: dict) -> str:
    return {"up": "improving", "down": "deteriorating", "flat": "neutral"}.get(
        context.get("rs_trend", "flat"), "neutral"
    )


def _build_detection(
    bars: List[Bar],
    c: dict,
    i: int,
    confidence: float,
    context: dict,
    geom_score: float,
    vol_score: float,
    ctx_score: float,
    hist_score: float,
    *,
    at_swing_high: Optional[bool] = None,
    above_50: Optional[bool] = None,
    advance: Optional[float] = None,
) -> Detection:
    bar1, bar2, bar3 = c["bar1"], c["bar2"], c["bar3"]

    b1_body_pct_disp = round(c["b1_body_pct"] * 100, 2)
    b2_body_pct_disp = round(c["b2_body_pct"] * 100, 2)
    b3_body_pct_disp = round(c["b3_body_pct"] * 100, 2)
    body_avg_disp = round(c["body_pct_avg"] * 100, 2)
    b1_dcr_pct = round(c["b1_dcr"] * 100, 1)
    b2_dcr_pct = round(c["b2_dcr"] * 100, 1)
    b3_dcr_pct = round(c["b3_dcr"] * 100, 1)
    dcr_avg = (c["b1_dcr"] + c["b2_dcr"] + c["b3_dcr"]) / 3.0
    dcr_avg_pct = round(dcr_avg * 100, 1)
    total_move_disp = round(c["total_move_pct"] * 100, 2)
    b1_dec_disp = round(c["b1_decline_pct"] * 100, 2)
    b2_dec_disp = round(c["b2_decline_pct"] * 100, 2)
    b3_dec_disp = round(c["b3_decline_pct"] * 100, 2)
    b2_open_pos_pct = round(c["b2_open_pos"] * 100, 1)
    b3_open_pos_pct = round(c["b3_open_pos"] * 100, 1)
    b1_lw_disp = round(c["b1_lower_wick"] * 100, 2)
    b2_lw_disp = round(c["b2_lower_wick"] * 100, 2)
    b3_lw_disp = round(c["b3_lower_wick"] * 100, 2)

    # Reuse precomputed helpers if available; fall back to recompute if called standalone.
    is_swing_high = at_swing_high if at_swing_high is not None else _is_swing_high(bars, i)
    below_50 = not above_50 if above_50 is not None else _below_sma50(bars, i)
    advance_raw = advance if advance is not None else _recent_advance_pct(bars, i)
    advance_pct = advance_raw * 100
    decline_pct = _recent_decline_pct(bars, i) * 100
    climax_warning = decline_pct >= 40.0

    v1 = bar1["v"]
    v2 = bar2["v"]
    v3 = bar3["v"]
    avg3 = (v1 + v2 + v3) / 3.0 if min(v1, v2, v3) > 0 else 0.0
    if i >= 12:
        prior_window = bars[max(0, i - 12):i - 2]
        prior_avg = (sum(b["v"] for b in prior_window) / len(prior_window)) if prior_window else 0.0
    else:
        prior_avg = 0.0
    vol_vs_prior_ratio = (avg3 / prior_avg) if prior_avg > 0 else 0.0
    vol_vs_prior_disp = f"{vol_vs_prior_ratio:.2f}x" if vol_vs_prior_ratio > 0 else "n/a"
    vol_rising = v3 >= v2 >= v1
    vol_falling = v3 < v1 and v2 < v1
    if vol_rising:
        vol_progression_word = "rising (institutions stacking distribution)"
    elif vol_falling:
        vol_progression_word = "falling (institutional selling fading - red flag for the trade)"
    elif v3 >= v1:
        vol_progression_word = "mixed but net positive"
    else:
        vol_progression_word = "softening into bar 3"

    # Levels - continuation breakdown below bar 3's low
    entry = round(c["b3_low"] * 0.999, 2)
    body_basis_high = max(c["b1_high"], c["b2_high"])
    stop = round(body_basis_high * 1.015, 2)
    measured_move = c["b1_open"] - c["b3_close"]
    measured = entry - measured_move
    near_sup = context.get("nearest_support")
    if near_sup and near_sup < entry:
        target = round(max(near_sup, measured), 2)
        target_basis = "nearest_support_or_3bar_measured_move"
    else:
        target = round(measured, 2)
        target_basis = "3bar_measured_move"
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0
    stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

    if is_swing_high:
        position_phrase = "rolling over from a near-term swing high"
    elif advance_pct >= 5.0:
        position_phrase = f"reversing after a {advance_pct:.1f}% rally"
    elif below_50:
        position_phrase = "below the 50-bar SMA inside a deteriorating structure"
    else:
        position_phrase = "without a clearly preceding rally"

    stage_phrase = _trend_phrase(context)
    ma_phrase = _ma_phrase(context)
    rs_phrase = _rs_phrase(context)
    regime = context.get("regime", "current")
    dcr_sig = context.get("dcr_signature", "neutral")
    recent_dcr_avg = context.get("recent_dcr_avg", 0.5)
    recent_dcr_pct = round(recent_dcr_avg * 100, 1)

    if dcr_avg <= 0.10:
        dcr_grade = "textbook (every close stamped in the very bottom of its range)"
    elif dcr_avg <= 0.20:
        dcr_grade = "strong (every close in the lower third)"
    else:
        dcr_grade = "above-floor (each close in the lower half)"

    anchors = [
        {"t": int(bar1["t"]), "price": float(bar1["c"])},
        {"t": int(bar2["t"]), "price": float(bar2["c"])},
        {"t": int(bar3["t"]), "price": float(bar3["c"])},
    ]
    now = int(time.time())

    headline = (
        f"Three Black Crows {position_phrase} - bodies {b1_body_pct_disp}%/{b2_body_pct_disp}%/"
        f"{b3_body_pct_disp}% (avg {body_avg_disp}%), DCRs {b1_dcr_pct}%/{b2_dcr_pct}%/{b3_dcr_pct}% "
        f"(avg {dcr_avg_pct}%), 3-bar move {total_move_disp}%, volume {vol_vs_prior_disp} 10-bar avg."
    )

    what_it_is = (
        f"Three Black Crows is one of the most powerful 3-bar bearish reversal / continuation "
        f"sequences in the Japanese-candlestick lexicon. Codified by Steve Nison in 'Japanese "
        f"Candlestick Charting Techniques' (1991), traced back to Munehisa Homma's 18th-century "
        f"Sakata rice trading rules, this pattern captures three consecutive sessions where the "
        f"bears controlled price action from open to close - each session opened INSIDE the prior "
        f"body (no exhaustion gap-down that bleeds in late-day short-covering), and each closed "
        f"NEAR its own LOW (no late-session bid rescuing price). Anatomically, all three bars are "
        f"RED with long bodies: bar N-2 opened at ${c['b1_open']:.2f} and closed at "
        f"${c['b1_close']:.2f} (body {b1_body_pct_disp}% of range, decline {b1_dec_disp}%); bar "
        f"N-1 opened at ${c['b2_open']:.2f} ({b2_open_pos_pct:.1f}% from bar 1's close into bar 1's "
        f"body, between prior close ${c['b1_close']:.2f} and prior open ${c['b1_open']:.2f}) and "
        f"closed at ${c['b2_close']:.2f} (body {b2_body_pct_disp}%, decline {b2_dec_disp}%); bar N "
        f"opened at ${c['b3_open']:.2f} ({b3_open_pos_pct:.1f}% from bar 2's close into bar 2's "
        f"body) and closed at ${c['b3_close']:.2f} (body {b3_body_pct_disp}%, decline {b3_dec_disp}%). "
        f"The 3-bar total move is {total_move_disp}% from bar 1 open to bar 3 close. Each bar's "
        f"lower wick is trivial - {b1_lw_disp}% / {b2_lw_disp}% / {b3_lw_disp}% of respective ranges - "
        f"meaning buyers were never able to push price back up from the lows at any point in any "
        f"of the three sessions. The DCR profile is the institutional fingerprint: {b1_dcr_pct}% / "
        f"{b2_dcr_pct}% / {b3_dcr_pct}%, averaging {dcr_avg_pct}% - {dcr_grade}. Volume across the "
        f"three bars averaged {vol_vs_prior_disp} the trailing 10-bar baseline, and within the "
        f"pattern volume was {vol_progression_word}. Greg Morris's 'Candlestick Charting "
        f"Explained' frames Three Black Crows as one of the most decisive bearish "
        f"continuation/reversal sequences when each bar opens inside the prior body and "
        f"closes near its own low. Tom Bulkowski's empirical climax-warning research adds the "
        f"critical caveat that mirrors his Three White Soldiers note: when this pattern "
        f"appears late in an already-extended downtrend, it frequently marks the EXHAUSTION "
        f"bottom rather than continuation. Charlie Bilello's modern bear-pattern statistics — "
        f"distilled across thousands of post-2000 declines — further document this climax-"
        f"bottom warning, with stocks frequently bottoming within 1-3 weeks of a Three Black "
        f"Crows print on accelerating volume."
    )

    why_it_matters = (
        f"This Three Black Crows print appears {position_phrase}, inside {stage_phrase} with "
        f"{ma_phrase} moving-average alignment and {rs_phrase} relative strength against the "
        f"broader tape. The signal's edge comes from what three stacked distribution sessions "
        f"reveal about institutional behavior: each day the bears woke up, opened price INSIDE "
        f"the prior body (a controlled, non-exhausted gap-down would be ideal but a contained "
        f"open avoids climax exhaustion), drove the session LOWER on a long red body, and CLOSED "
        f"the session in the lower third of the bar's range - that is the signature of an "
        f"institutional offer systematically hitting bids, distributing supply, and refusing to "
        f"let late-day buyers reclaim the lows. Over three days, that adds up to a "
        f"{total_move_disp}% directional move with virtually no give-back at any session close. "
        f"Bar 1's DCR of {b1_dcr_pct}%, bar 2's {b2_dcr_pct}%, bar 3's {b3_dcr_pct}% (averaging "
        f"{dcr_avg_pct}%) all sit well BELOW the 30% threshold that classifies a 'weak close' - "
        f"three in a row is the rarest of all bearish candle sequences and the cleanest possible "
        f"institutional-distribution print. Context's recent DCR average of {recent_dcr_pct}% over "
        f"the trailing 10 bars classifies the broader chart as '{dcr_sig}' - "
        f"{'a textbook accumulation baseline where three consecutive distribution bars are the climactic transition from demand to supply, the cleanest possible top-formation print' if dcr_sig == 'accumulation' else 'an indecisive top where three crows are the most decisive directional sequence in weeks' if dcr_sig == 'neutral' else 'a distribution context where the crows are corroborating an existing downtrend rather than initiating a turn'}. "
        f"Recent 15-bar advance of {advance_pct:.1f}% places this pattern at a level where sellers "
        f"had structural reason to distribute, and recent 30-bar decline of {decline_pct:.1f}% "
        f"gives the climax-bottom context: "
        f"{'WARNING - the prior decline is extended, and Nison specifically flags Three Black Crows after long drops as a CLIMAX BOTTOM signal where the pattern inverts; this is most likely capitulation, not continuation, and short trades face severe reversal risk; size accordingly' if climax_warning else 'the prior decline is moderate, leaving room for continuation without immediate climax-bottom risk'}. "
        f"Current regime is {regime}, which calibrates how aggressive position sizing should be on "
        f"a multi-bar continuation print."
    )

    what_to_watch_for = (
        f"Three Black Crows is one of the few 3-bar candle sequences strong enough to be treated "
        f"as a near-confirmed trigger by itself - three consecutive distribution closes already "
        f"incorporate substantial follow-through. However, Nison still recommends a confirmation "
        f"bar: a CLOSE BELOW ${entry:.2f} (bar 3's low of ${c['b3_low']:.2f} minus a 0.1% buffer) "
        f"on the next bar (N+1), ideally on volume of at least 1.3x the 20-bar average AND with "
        f"that bar's own DCR <= 0.35 (close in the lower third of the confirmation bar's range). "
        f"Watch for: "
        f"(1) the confirmation bar's high staying below bar 3's CLOSE (${c['b3_close']:.2f}) - if "
        f"the next bar prints above bar 3's body, the buyers reclaimed momentum and the short is "
        f"suspect; "
        f"(2) volume on the confirmation bar should EQUAL OR EXCEED the recent 3-bar average of "
        f"{vol_vs_prior_disp} - shrinking volume into the breakdown means the institutions that "
        f"distributed across the 3-bar move didn't follow through; "
        f"(3) the next bar's lower wick should remain small - if bar N+1 prints a long lower wick "
        f"(>30% of its range), buyers are starting to defend at the lows and the crows' momentum "
        f"is being absorbed; "
        f"(4) if 2-3 bars after the sequence trade entirely within bar 3's range "
        f"(${c['b3_low']:.2f} to ${c['b3_high']:.2f}), the breakdown is in suspended animation - "
        f"the structure is intact but the directional resolution is pending; "
        f"(5) DCR on the confirmation bar matters - a follow-through bar that closes strongly "
        f"(DCR > 0.50) into a lower low should be faded, because that print signals demand is "
        f"absorbing supply at the breakdown level; "
        f"(6) the pattern is INVALIDATED if bar N+1 closes back above the body-basis high of "
        f"${body_basis_high:.2f} - that signals the 3-bar distribution was a liquidity-grab "
        f"sequence rather than a real continuation. Levels (SHORT trade): entry ${entry:.2f} "
        f"(short below bar 3 low), stop ${stop:.2f} (basis: max of bars 1-2 highs plus 1.5%, "
        f"{stop_distance_pct:.1f}% adverse move from entry), target ${target:.2f} (basis: "
        f"{target_basis}; 3-bar measured-move height of ${measured_move:.2f} projected down from "
        f"entry), R:R {rr:.2f}. The measured-move target uses the 3-bar height as a minimum "
        f"projection - if a nearby support level "
        f"({'$' + format(near_sup, '.2f') if near_sup else 'none mapped'}) catches the move "
        f"sooner, cover partials there and trail the remainder to a lower swing high. The clean "
        f"follow-through is the next 2-3 bars closing lower (each DCR <= 0.40) and never "
        f"re-entering the body highs of bars 1-2."
    )

    failure_signal = (
        f"Three Black Crows fails roughly 25-35% of the time when traded alone without "
        f"confirmation - a lower failure rate than 2-bar engulfings or 1-bar shooting stars, "
        f"because the 3-bar structure already incorporates substantial follow-through. The "
        f"pattern is invalidated if the next bar (N+1) closes back above the body-basis high at "
        f"${body_basis_high:.2f} (stop set at ${stop:.2f}, 1.5% above) - that signals the 3-bar "
        f"distribution sequence was a liquidity event, not a real continuation, and demand has "
        f"reclaimed control; cover immediately. More insidious failure modes: "
        f"(1) **CLIMAX-BOTTOM INVERSION** - Three Black Crows prints after an extended decline, "
        f"and Nison's seminal warning is that this pattern's edge INVERTS at climax bottoms. "
        f"Recent 30-bar decline was {decline_pct:.1f}% - "
        f"{'this is past the 40% climax-warning threshold; the crows are more likely capitulation than continuation, and a single bullish reversal bar (engulfing, hammer, piercing) on bar N+1 should trigger an immediate cover even before the stop triggers' if climax_warning else 'this is below the 40% climax-warning threshold, leaving room for normal continuation'}; "
        f"(2) the confirmation bar closes below entry but on weak/declining volume AND its own "
        f"DCR > 0.50 - this is the 'fake-out crows' where stop-runs and forced liquidation create "
        f"the illusion of continuation but the institutional offer never re-materializes after "
        f"the 3-bar move; the next 1-3 bars often retrace and break bar 1's high; "
        f"(3) volume across the 3 bars was FALLING ({vol_progression_word}) - if institutions "
        f"weren't progressively stacking distribution, the pattern is structurally weaker even if "
        f"the geometry holds; this is the most under-appreciated failure mode in retail trading; "
        f"(4) the crows' low (${c['pattern_low']:.2f}) tags a known support level - if it sits at "
        f"or just above a major prior pivot, demand at that level will absorb the next 1-2 bars "
        f"and reverse the structure; check the chart for prior pivots within 1-2% of pattern low "
        f"before entering; "
        f"(5) context DCR signature was already 'distribution' (avg DCR {recent_dcr_pct}%) - in "
        f"that case the crows are corroborating an EXISTING downtrend, not initiating a new "
        f"phase, and the asymmetric edge of catching a turn is reduced because price is already "
        f"mid-cycle; trim position size accordingly; "
        f"(6) any of bars 1-3 prints lower wick > 15% of range - this would have failed the "
        f"detector geometry, but on real data noisy fills can flag a borderline pattern; if you "
        f"see a crow with a 10-15% lower wick, buyers were starting to defend the close. Position "
        f"sizing must reflect the {stop_distance_pct:.1f}% stop distance: risking 0.5% of account "
        f"on this trade implies a position size of roughly "
        f"{(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat Three Black Crows as "
        f"a high-quality SETUP that already incorporates much of its own confirmation - the next "
        f"bar fires the trigger, the stop saves the account if the sequence was actually climactic "
        f"capitulation disguised as continuation, and the position size reflects the asymmetric "
        f"reality that even three stacked distribution closes can fail when they print into "
        f"underlying support."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Three Black Crows",
        "category": "candlestick",
        "direction": "bearish",
        "start_t": int(bar1["t"]),
        "end_t": int(bar3["t"]),
        "pivot_ts": [int(bar1["t"]), int(bar2["t"]), int(bar3["t"])],
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": {
                "body_pcts": [
                    float(round(c["b1_body_pct"], 4)),
                    float(round(c["b2_body_pct"], 4)),
                    float(round(c["b3_body_pct"], 4)),
                ],
                "dcrs": [
                    float(round(c["b1_dcr"], 4)),
                    float(round(c["b2_dcr"], 4)),
                    float(round(c["b3_dcr"], 4)),
                ],
                "open_in_prior_body": [True, True],
                "b2_open_pos": float(round(c["b2_open_pos"], 4)),
                "b3_open_pos": float(round(c["b3_open_pos"], 4)),
                "lower_wicks_pct": [
                    float(round(c["b1_lower_wick"], 4)),
                    float(round(c["b2_lower_wick"], 4)),
                    float(round(c["b3_lower_wick"], 4)),
                ],
                "decline_pcts": [
                    float(round(c["b1_decline_pct"], 4)),
                    float(round(c["b2_decline_pct"], 4)),
                    float(round(c["b3_decline_pct"], 4)),
                ],
                "volume_progression": [float(v1), float(v2), float(v3)],
                "vol_vs_prior_ratio": float(round(vol_vs_prior_ratio, 4)),
                "total_move_pct": float(round(c["total_move_pct"], 4)),
                "body_pct_avg": float(round(c["body_pct_avg"], 4)),
                "pattern_low": float(round(c["pattern_low"], 4)),
                "pattern_high": float(round(c["pattern_high"], 4)),
                "at_swing_high": bool(is_swing_high),
                "below_50sma": bool(below_50),
                "recent_advance_pct": float(round(advance_pct, 2)),
                "recent_decline_pct": float(round(decline_pct, 2)),
                "climax_warning": bool(climax_warning),
                "dcr_strength": dcr_strength(dcr_avg),
            },
        },
        "levels": {
            "entry": float(entry),
            "entry_condition": f"close < {entry:.2f} on next bar with volume >= 1.3x 20-bar avg + DCR <= 0.35",
            "stop": float(stop),
            "stop_basis": "max_of_bar1_bar2_highs_plus_1.5pct",
            "target_primary": float(target),
            "target_secondary": None,
            "risk_reward": float(round(rr, 2)),
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


register(_PATTERN_ID, detect_three_black_crows)
