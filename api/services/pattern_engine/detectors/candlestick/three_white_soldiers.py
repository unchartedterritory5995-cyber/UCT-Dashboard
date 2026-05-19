"""Three White Soldiers candlestick detector.

The Three White Soldiers is one of the most powerful 3-bar bullish continuation/
reversal sequences in the Japanese-candlestick lexicon. Codified by Steve Nison
in 'Japanese Candlestick Charting Techniques' (1991), rooted in Munehisa Homma's
18th-century Sakata rules, the pattern captures three consecutive sessions where
the bulls controlled price action from open to close - each session opened
inside the prior body (no exhaustion gap-up) and closed near its own high (no
late-day weakness from sellers). The visual signature: three marching green
candles, each higher than the last, each with a long body and trivial upper
wick. This is institutional accumulation playing out in real-time.

Definition (geometry):
  - 3 consecutive bars, all GREEN (close > open)
  - Each bar has a long body (body_pct >= 0.60 of range)
  - Each subsequent bar opens within the PREVIOUS bar's body
    (open >= prior_open AND open <= prior_close)
  - Each subsequent bar closes near its OWN high (DCR >= 0.70)
  - Each bar's close is HIGHER than the previous bar's close
  - No long upper wicks (upper_wick <= 0.15 of range on each bar)

Context (critical — DUAL gate, NOT a pure reversal gate):
  Three White Soldiers is legitimately BOTH a continuation AND a reversal
  pattern. A strict "must have reversal context" gate (like tweezer/hammer)
  would WRONGLY suppress a valid TWS firing at a Stage-1 base breakout —
  which by design has ~0% prior decline, no swing low, and stacked-bullish
  MAs that AWARD a ctx bonus rather than deny entry. Therefore this detector
  uses a RELAXED dual predicate: a candidate is blocked ONLY when it is
  unambiguously mid-Stage-2 uptrend with no prior context whatsoever.

  The dual gate (evaluated at bar i, the 3rd soldier):
    in_reversal_context   = at_swing_low
                            OR below_50sma
                            OR recent_decline_pct >= _MIN_DECLINE_FOR_REVERSAL (5%)
    in_continuation_context = (trend_stage == 1)
                               OR (recent_decline_pct >= _CONT_MOVE_RELAX) (3%)
    if not (in_reversal_context or in_continuation_context): continue

  This blocks only the "mid-Stage-2, no pullback, no base context" false-fire
  that inflates confidence (stacked MA ctx bonus + no swing-low penalty = 82.5
  on raw geometry alone). It preserves:
    - Stage-1 base breakout continuation (trend_stage=1, ~0% decline → passes)
    - Any 3%+ pullback before the soldiers (relaxed continuation threshold)
    - Genuine reversal off swing lows / below-50SMA / >=5% decline

  The CLIMAX penalty (advance >= 40% → −10 ctx) remains intact; it addresses
  overextension at the TOP, which is a different concern from mid-trend noise.

  - DCR signature accumulation + all three bars DCR >= 0.7 = institutional
    fingerprint of stacked buying days.

Direction: bullish.
Confirmation: NEXT bar (bar N+1) close above bar N's high on rising volume.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.dcr import compute_dcr, dcr_strength
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "three_white_soldiers"
_MIN_BARS = 7
_MIN_LONG_BODY_PCT = 0.60
_MIN_DCR = 0.70
_MAX_UPPER_WICK_PCT = 0.15
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_CONFIDENCE_FLOOR = 50.0
# Dual-gate thresholds (see docstring)
_MIN_DECLINE_FOR_REVERSAL = 0.05   # 5%: qualifies as reversal context
_MIN_ADVANCE_FOR_REVERSAL = 0.05   # reserved for TBC mirror; unused here
_CONT_MOVE_RELAX = 0.03            # 3%: relaxed threshold to qualify as continuation context


def detect_three_white_soldiers(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect three-white-soldiers 3-bar patterns. Emits 0 or 1 Detection (most recent)."""
    if len(bars) < _MIN_BARS:
        return []

    detections: List[Detection] = []
    start = max(2, len(bars) - _SCAN_LOOKBACK)
    for i in range(start, len(bars)):
        candidate = _try_extract(bars, i)
        if candidate is None:
            continue

        # Compute context helpers once — used by the dual gate, scorer, and builder.
        at_swing_low = _is_swing_low(bars, i)
        above_50 = _above_sma50(bars, i)
        below_50 = not above_50
        decline = _recent_decline_pct(bars, i)
        trend_stage = context.get("trend_stage")

        # ------------------------------------------------------------------ #
        # Dual continuation+reversal gate (see module docstring).             #
        # Blocks only mid-Stage-2 uptrend with no prior context at all.       #
        # ------------------------------------------------------------------ #
        in_reversal_context = (
            at_swing_low
            or below_50
            or decline >= _MIN_DECLINE_FOR_REVERSAL
        )
        in_continuation_context = (
            trend_stage == 1
            or decline >= _CONT_MOVE_RELAX
        )
        if not (in_reversal_context or in_continuation_context):
            continue  # mid-trend, no-prior-context false-fire: suppress

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, i)
        ctx_score = _score_context(
            context, bars, i, candidate,
            at_swing_low=at_swing_low, above_50=above_50, decline=decline,
        )
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(
            bars, candidate, i, confidence, context, geom_score, vol_score, ctx_score, hist_score,
            at_swing_low=at_swing_low, above_50=above_50, decline=decline,
        )
        detections.append(d)

    if not detections:
        return []
    return detections[-1:]


def _try_extract(bars: List[Bar], i: int) -> Optional[dict]:
    if i < 2:
        return None
    bar1 = bars[i - 2]  # bar N-2
    bar2 = bars[i - 1]  # bar N-1
    bar3 = bars[i]      # bar N

    # --- All 3 bars must be GREEN ---
    b1_o, b1_c = bar1["o"], bar1["c"]
    b2_o, b2_c = bar2["o"], bar2["c"]
    b3_o, b3_c = bar3["o"], bar3["c"]
    if b1_c <= b1_o or b2_c <= b2_o or b3_c <= b3_o:
        return None

    b1_body = b1_c - b1_o
    b2_body = b2_c - b2_o
    b3_body = b3_c - b3_o
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
    # bar2.open >= bar1.open AND bar2.open <= bar1.close
    if b2_o < b1_o or b2_o > b1_c:
        return None
    # bar3.open >= bar2.open AND bar3.open <= bar2.close
    if b3_o < b2_o or b3_o > b2_c:
        return None

    # --- Closes must progress higher ---
    if not (b3_c > b2_c > b1_c):
        return None

    # --- Each bar's DCR (close near own high) >= 0.70 ---
    b1_dcr = compute_dcr(bar1)
    b2_dcr = compute_dcr(bar2)
    b3_dcr = compute_dcr(bar3)
    if b1_dcr < _MIN_DCR or b2_dcr < _MIN_DCR or b3_dcr < _MIN_DCR:
        return None

    # --- Upper wicks must be small (no late-day reversals) ---
    b1_upper_wick = (bar1["h"] - b1_c) / b1_range
    b2_upper_wick = (bar2["h"] - b2_c) / b2_range
    b3_upper_wick = (bar3["h"] - b3_c) / b3_range
    if b1_upper_wick > _MAX_UPPER_WICK_PCT:
        return None
    if b2_upper_wick > _MAX_UPPER_WICK_PCT:
        return None
    if b3_upper_wick > _MAX_UPPER_WICK_PCT:
        return None

    # --- Open-in-prior-body normalized (1.0 = at prior open, 0.0 = at prior close) ---
    # Higher = opened deeper inside prior body (closer to prior open = more conservative)
    b2_open_pos = (b2_o - b1_o) / b1_body if b1_body > 0 else 0.5
    b3_open_pos = (b3_o - b2_o) / b2_body if b2_body > 0 else 0.5

    # --- Total 3-bar move % ---
    total_move_pct = (b3_c - b1_o) / b1_o if b1_o > 0 else 0.0

    # --- Per-bar advance %s ---
    b1_advance_pct = b1_body / b1_o if b1_o > 0 else 0.0
    b2_advance_pct = b2_body / b2_o if b2_o > 0 else 0.0
    b3_advance_pct = b3_body / b3_o if b3_o > 0 else 0.0

    # --- Body consistency (similar bodies = institutional rhythm) ---
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
        "b1_upper_wick": b1_upper_wick,
        "b2_upper_wick": b2_upper_wick,
        "b3_upper_wick": b3_upper_wick,
        "b2_open_pos": b2_open_pos,
        "b3_open_pos": b3_open_pos,
        "b1_advance_pct": b1_advance_pct,
        "b2_advance_pct": b2_advance_pct,
        "b3_advance_pct": b3_advance_pct,
        "total_move_pct": total_move_pct,
        "body_pct_avg": body_pct_avg,
        "body_pct_min": body_pct_min,
        "b3_high": bar3["h"],
        "b3_low": bar3["l"],
        "b1_low": bar1["l"],
        "b2_low": bar2["l"],
        "pattern_low": min(bar1["l"], bar2["l"], bar3["l"]),
        "pattern_high": max(bar1["h"], bar2["h"], bar3["h"]),
    }


def _is_swing_low(bars: List[Bar], i: int) -> bool:
    lookback = bars[max(0, i - _SWING_LOOKBACK):i + 1]
    if len(lookback) < 4:
        return False
    high_max = max(b["h"] for b in lookback)
    low_min = min(b["l"] for b in lookback)
    rng = high_max - low_min
    if rng <= 0:
        return False
    bar_low = min(bars[i]["l"], bars[i - 1]["l"], bars[i - 2]["l"])
    return (bar_low - low_min) / rng <= 0.20


def _above_sma50(bars: List[Bar], i: int) -> bool:
    if i < 49:
        return False
    closes = [b["c"] for b in bars[i - 49:i + 1]]
    if not closes:
        return False
    sma = sum(closes) / len(closes)
    return bars[i]["c"] > sma


def _recent_decline_pct(bars: List[Bar], i: int) -> float:
    """Drawdown from the recent 15-bar high to the 3-bar pattern low."""
    start = max(0, i - 14)
    window = bars[start:i + 1]
    if not window:
        return 0.0
    high = max(b["h"] for b in window)
    low_now = min(bars[i]["l"], bars[i - 1]["l"], bars[i - 2]["l"])
    if high <= 0:
        return 0.0
    return (high - low_now) / high


def _recent_advance_pct(bars: List[Bar], i: int) -> float:
    """Advance from recent 30-bar low to current high (used for climax detection)."""
    start = max(0, i - 29)
    window = bars[start:i + 1]
    if not window:
        return 0.0
    low = min(b["l"] for b in window)
    high_now = max(bars[i]["h"], bars[i - 1]["h"], bars[i - 2]["h"])
    if low <= 0:
        return 0.0
    return (high_now - low) / low


def _score_geometry(c: dict) -> float:
    """Score the 3-bar three-white-soldiers anatomy."""
    # Body consistency: all 3 bodies should be similar AND large
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

    # Open-in-prior-body cleanliness (closer to midpoint of prior body = ideal)
    # b2_open_pos / b3_open_pos: 0 = at prior close (gap-up risk), 1 = at prior open (conservative)
    # Ideal: between 0.3 and 0.7 (mid-body opens)
    def _open_quality(pos: float) -> float:
        # Penalize either extreme; reward middle
        dist_from_mid = abs(pos - 0.5)
        if dist_from_mid <= 0.2:
            return 100.0
        if dist_from_mid <= 0.35:
            return 70.0 + (0.35 - dist_from_mid) / 0.15 * 30.0
        return max(40.0, 70.0 - (dist_from_mid - 0.35) / 0.15 * 30.0)
    open_score = (_open_quality(c["b2_open_pos"]) + _open_quality(c["b3_open_pos"])) / 2.0

    # DCR strength: all 3 bars closing near own high
    dcr_avg = (c["b1_dcr"] + c["b2_dcr"] + c["b3_dcr"]) / 3.0
    if dcr_avg >= 0.90:
        dcr_score = 100.0
    elif dcr_avg >= 0.80:
        dcr_score = 75.0 + (dcr_avg - 0.80) / 0.10 * 25.0
    elif dcr_avg >= 0.70:
        dcr_score = 50.0 + (dcr_avg - 0.70) / 0.10 * 25.0
    else:
        dcr_score = max(0.0, dcr_avg / 0.70 * 50.0)

    # DCR-aware boost: all 3 bars >= 0.70 + at least 2 >= 0.85 = +10
    dcr_bonus = 0.0
    strong_dcrs = sum(1 for d in (c["b1_dcr"], c["b2_dcr"], c["b3_dcr"]) if d >= 0.85)
    if strong_dcrs >= 2:
        dcr_bonus = 10.0

    return round(min(100.0, 0.40 * body_score + 0.25 * open_score + 0.35 * dcr_score + dcr_bonus), 2)


def _score_volume(bars: List[Bar], i: int) -> float:
    """Volume: ideal is steady or rising across the 3 bars; volume vs 10-bar prior avg."""
    if i < 12:
        # Without enough lookback, score by intra-pattern progression alone
        v1 = bars[i - 2]["v"]
        v2 = bars[i - 1]["v"]
        v3 = bars[i]["v"]
        if min(v1, v2, v3) <= 0:
            return 50.0
        # Progression: rising = good, flat = neutral, falling = penalty
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

    # Component 1: average vs prior (institutional commitment)
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

    # Component 2: progression (rising = institutions stacking)
    if v3 >= v2 >= v1:
        prog_score = 100.0
    elif v3 >= v1:
        prog_score = 75.0
    elif v3 >= 0.85 * v1:
        prog_score = 50.0
    else:
        # Falling volume across 3 bars = institutional commitment fading
        prog_score = 20.0

    return round(0.60 * commit_score + 0.40 * prog_score, 2)


def _score_context(
    context: dict,
    bars: List[Bar],
    i: int,
    c: dict,
    *,
    at_swing_low: Optional[bool] = None,
    above_50: Optional[bool] = None,
    decline: Optional[float] = None,
) -> float:
    score = 25.0
    swing_low = at_swing_low if at_swing_low is not None else _is_swing_low(bars, i)
    above_50 = above_50 if above_50 is not None else _above_sma50(bars, i)
    decline = decline if decline is not None else _recent_decline_pct(bars, i)
    advance = _recent_advance_pct(bars, i)

    # Swing low / recent decline = ideal context (reversal off lows)
    if swing_low:
        score += 20
    if decline >= 0.10:
        score += 15
    elif decline >= 0.05:
        score += 8

    # MA alignment: stacked_bullish + above 50 = base breakout context
    ma_align = context.get("ma_alignment")
    if ma_align == "stacked_bullish":
        score += 10
    if above_50:
        score += 5

    # All 3 bars DCR >= 0.70 (already enforced by detector), reward exceptionally strong (avg >= 0.85)
    dcr_avg = (c["b1_dcr"] + c["b2_dcr"] + c["b3_dcr"]) / 3.0
    if dcr_avg >= 0.90:
        score += 10
    elif dcr_avg >= 0.80:
        score += 5

    # Context DCR signature alignment
    dcr_sig = context.get("dcr_signature")
    if dcr_sig == "accumulation":
        score += 5  # corroborates ongoing accumulation
    elif dcr_sig == "distribution":
        score += 8  # transition signal - 3 bars flipped the chart

    # Trend stage: stage 1 (base) or 2 (uptrend) ideal; 3-4 means climax risk
    stage = context.get("trend_stage")
    if stage in (1, 2):
        score += 5
    elif stage == 3:
        score -= 5  # in late-cycle territory
    # Don't penalize stage 4 as harshly - reversal off downtrend is part of the playbook

    # Climax-top warning: if recent advance is >40% from low, pattern may be exhaustion
    if advance >= 0.40:
        score -= 10

    sup = context.get("nearest_support")
    if sup and sup > 0 and abs(c["pattern_low"] - sup) / sup <= 0.015:
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
    at_swing_low: Optional[bool] = None,
    above_50: Optional[bool] = None,
    decline: Optional[float] = None,
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
    b1_adv_disp = round(c["b1_advance_pct"] * 100, 2)
    b2_adv_disp = round(c["b2_advance_pct"] * 100, 2)
    b3_adv_disp = round(c["b3_advance_pct"] * 100, 2)
    b2_open_pos_pct = round(c["b2_open_pos"] * 100, 1)
    b3_open_pos_pct = round(c["b3_open_pos"] * 100, 1)
    b1_uw_disp = round(c["b1_upper_wick"] * 100, 2)
    b2_uw_disp = round(c["b2_upper_wick"] * 100, 2)
    b3_uw_disp = round(c["b3_upper_wick"] * 100, 2)

    # Reuse precomputed helpers if available; fall back to recompute if called standalone.
    is_swing_low = at_swing_low if at_swing_low is not None else _is_swing_low(bars, i)
    above_50 = above_50 if above_50 is not None else _above_sma50(bars, i)
    decline_raw = decline if decline is not None else _recent_decline_pct(bars, i)
    decline_pct = decline_raw * 100
    advance_pct = _recent_advance_pct(bars, i) * 100
    climax_warning = advance_pct >= 40.0

    # Volume
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
        vol_progression_word = "rising (institutions stacking commitment)"
    elif vol_falling:
        vol_progression_word = "falling (institutional commitment fading - red flag)"
    elif v3 >= v1:
        vol_progression_word = "mixed but net positive"
    else:
        vol_progression_word = "softening into bar 3"

    # Levels - continuation breakout above bar 3's high
    entry = round(c["b3_high"] * 1.001, 2)
    # Stop below the body lows of bars 1-2 (more conservative than pattern low)
    body_basis_low = min(c["b1_low"], c["b2_low"])
    stop = round(body_basis_low * 0.985, 2)
    # Measured move: 3-bar height projected up from entry
    measured_move = c["b3_close"] - c["b1_open"]
    measured = entry + measured_move
    near_res = context.get("nearest_resistance")
    if near_res and near_res > entry:
        target = round(min(near_res, measured), 2)
        target_basis = "nearest_resistance_or_3bar_measured_move"
    else:
        target = round(measured, 2)
        target_basis = "3bar_measured_move"
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    if is_swing_low:
        position_phrase = "emerging from a near-term swing low"
    elif decline_pct >= 5.0:
        position_phrase = f"reversing after a {decline_pct:.1f}% pullback"
    elif above_50:
        position_phrase = "above the 50-bar SMA inside a constructive base structure"
    else:
        position_phrase = "without a clearly preceding pullback"

    stage_phrase = _trend_phrase(context)
    ma_phrase = _ma_phrase(context)
    rs_phrase = _rs_phrase(context)
    regime = context.get("regime", "current")
    dcr_sig = context.get("dcr_signature", "neutral")
    recent_dcr_avg = context.get("recent_dcr_avg", 0.5)
    recent_dcr_pct = round(recent_dcr_avg * 100, 1)

    if dcr_avg >= 0.90:
        dcr_grade = "textbook (every close stamped in the very top of its range)"
    elif dcr_avg >= 0.80:
        dcr_grade = "strong (every close in the upper third)"
    else:
        dcr_grade = "above-floor (each close in the upper half)"

    anchors = [
        {"t": int(bar1["t"]), "price": float(bar1["c"])},
        {"t": int(bar2["t"]), "price": float(bar2["c"])},
        {"t": int(bar3["t"]), "price": float(bar3["c"])},
    ]
    now = int(time.time())

    headline = (
        f"Three White Soldiers {position_phrase} - bodies {b1_body_pct_disp}%/{b2_body_pct_disp}%/"
        f"{b3_body_pct_disp}% (avg {body_avg_disp}%), DCRs {b1_dcr_pct}%/{b2_dcr_pct}%/{b3_dcr_pct}% "
        f"(avg {dcr_avg_pct}%), 3-bar move {total_move_disp}%, volume {vol_vs_prior_disp} 10-bar avg."
    )

    what_it_is = (
        f"Three White Soldiers is one of the most powerful 3-bar bullish continuation/reversal "
        f"sequences in the Japanese-candlestick lexicon. Codified by Steve Nison in 'Japanese "
        f"Candlestick Charting Techniques' (1991), traced back to Munehisa Homma's 18th-century "
        f"Sakata rice trading rules, this pattern captures three consecutive sessions where the "
        f"bulls controlled price action from open to close - each session opened INSIDE the prior "
        f"body (no exhaustion gap-up that bleeds in late-day distribution), and each closed NEAR "
        f"its own high (no late-session selling). Anatomically, all three bars are GREEN with long "
        f"bodies: bar N-2 opened at ${c['b1_open']:.2f} and closed at ${c['b1_close']:.2f} (body "
        f"{b1_body_pct_disp}% of range, advance {b1_adv_disp}%); bar N-1 opened at ${c['b2_open']:.2f} "
        f"({b2_open_pos_pct:.1f}% into bar 1's body, between prior open ${c['b1_open']:.2f} and prior "
        f"close ${c['b1_close']:.2f}) and closed at ${c['b2_close']:.2f} (body {b2_body_pct_disp}%, "
        f"advance {b2_adv_disp}%); bar N opened at ${c['b3_open']:.2f} ({b3_open_pos_pct:.1f}% into "
        f"bar 2's body) and closed at ${c['b3_close']:.2f} (body {b3_body_pct_disp}%, advance "
        f"{b3_adv_disp}%). The 3-bar total move is {total_move_disp}% from bar 1 open to bar 3 close. "
        f"Each bar's upper wick is trivial - {b1_uw_disp}% / {b2_uw_disp}% / {b3_uw_disp}% of "
        f"respective ranges - meaning sellers were never able to push price back from the highs at "
        f"any point in any of the three sessions. The DCR profile is the institutional fingerprint: "
        f"{b1_dcr_pct}% / {b2_dcr_pct}% / {b3_dcr_pct}%, averaging {dcr_avg_pct}% - {dcr_grade}. "
        f"Volume across the three bars averaged {vol_vs_prior_disp} the trailing 10-bar baseline, "
        f"and within the pattern volume was {vol_progression_word}. Greg Morris's 'Candlestick "
        f"Charting Explained' frames Three White Soldiers as one of the most decisive bullish "
        f"continuation/reversal sequences when each bar opens inside the prior body and closes "
        f"near its own high — but he stresses the critical caveat that Tom Bulkowski's empirical "
        f"climax-warning research confirms: when this pattern appears late in an already-"
        f"extended uptrend, it frequently marks the EXHAUSTION top rather than continuation, "
        f"as three back-to-back power-bars often represent the final FOMO chase that absorbs "
        f"the last sidelined buyers and leaves no incremental demand."
    )

    why_it_matters = (
        f"This Three White Soldiers print appears {position_phrase}, inside {stage_phrase} with "
        f"{ma_phrase} moving-average alignment and {rs_phrase} relative strength against the "
        f"broader tape. The signal's edge comes from what three stacked accumulation sessions "
        f"reveal about institutional behavior: each day the bulls woke up, opened price INSIDE "
        f"the prior body (a controlled, non-exhausted open), drove the session HIGHER on a long "
        f"green body, and CLOSED the session in the upper third of the bar's range - that is the "
        f"signature of an institutional bid systematically lifting offers, absorbing supply, and "
        f"refusing to let late-day sellers reclaim the highs. Over three days, that adds up to a "
        f"{total_move_disp}% directional move with virtually no give-back at any session close. "
        f"Bar 1's DCR of {b1_dcr_pct}%, bar 2's {b2_dcr_pct}%, bar 3's {b3_dcr_pct}% (averaging "
        f"{dcr_avg_pct}%) all sit well above the 70% threshold that classifies a 'strong close' - "
        f"three in a row is the rarest of all candle sequences and the cleanest possible "
        f"institutional-accumulation print. Context's recent DCR average of {recent_dcr_pct}% over "
        f"the trailing 10 bars classifies the broader chart as '{dcr_sig}' - "
        f"{'a textbook seller-exhaustion baseline where three consecutive accumulation bars are the climactic transition from distribution to demand' if dcr_sig == 'distribution' else 'an indecisive base where three soldiers are the most decisive directional sequence in weeks' if dcr_sig == 'neutral' else 'an accumulation context where the soldiers are corroborating continuation, not initiating a turn'}. "
        f"Recent 15-bar drawdown of {decline_pct:.1f}% places this pattern at a level where buyers "
        f"had structural reason to defend, and recent 30-bar advance of {advance_pct:.1f}% gives "
        f"the climax-top context: "
        f"{'WARNING - the prior advance is extended, and Nison specifically flags Three White Soldiers after long runs as a CLIMAX TOP signal where the pattern inverts; size accordingly' if climax_warning else 'the prior advance is moderate, leaving room for continuation without immediate climax-top risk'}. "
        f"Current regime is {regime}, which calibrates how aggressive position sizing should be on "
        f"a multi-bar continuation print."
    )

    what_to_watch_for = (
        f"Three White Soldiers is one of the few 3-bar candle sequences strong enough to be "
        f"treated as a near-confirmed trigger by itself - three consecutive accumulation closes "
        f"already incorporate substantial follow-through. However, Nison still recommends a "
        f"confirmation bar: a CLOSE ABOVE ${entry:.2f} (bar 3's high of ${c['b3_high']:.2f} plus a "
        f"0.1% buffer) on the next bar (N+1), ideally on volume of at least 1.3x the 20-bar "
        f"average AND with that bar's own DCR >= 0.65. Watch for: "
        f"(1) the confirmation bar's low staying above bar 3's CLOSE (${c['b3_close']:.2f}) - if "
        f"the next bar undercuts bar 3's body, the sellers reclaimed the momentum and the trade "
        f"is suspect; "
        f"(2) volume on the confirmation bar should EQUAL OR EXCEED the recent average of "
        f"{vol_vs_prior_disp} - shrinking volume into the breakout means the institutions that "
        f"showed up across the 3-bar move didn't follow through; "
        f"(3) the next bar's upper wick should remain small - if bar N+1 prints a long upper wick "
        f"(>30% of its range), sellers are starting to reload at the highs and the soldiers' "
        f"momentum is being absorbed; "
        f"(4) if 2-3 bars after the sequence trade entirely within bar 3's range "
        f"(${bar3['l']:.2f} to ${c['b3_high']:.2f}), the breakout is in suspended animation - the "
        f"structure is intact but the directional resolution is pending; "
        f"(5) DCR on the confirmation bar matters - a follow-through bar that closes weakly (DCR "
        f"< 0.50) into a higher high should be faded, because that print signals supply is "
        f"distributing into the breakout; "
        f"(6) the pattern is INVALIDATED if bar N+1 closes back below the body-basis low of "
        f"${body_basis_low:.2f} - that signals the 3-bar accumulation was a liquidity-grab "
        f"sequence rather than a real continuation. Levels: entry ${entry:.2f}, stop ${stop:.2f} "
        f"(basis: min of bars 1-2 lows minus 1.5%, {stop_distance_pct:.1f}% adverse move from "
        f"entry), target ${target:.2f} (basis: {target_basis}; 3-bar measured-move height of "
        f"${measured_move:.2f} projected up from entry), R:R {rr:.2f}. The measured-move target "
        f"uses the 3-bar height as a minimum projection - if a nearby resistance level "
        f"({'$' + format(near_res, '.2f') if near_res else 'none mapped'}) caps the move sooner, "
        f"take partials there and trail the remainder to a higher swing low. The clean "
        f"follow-through is the next 2-3 bars closing higher (each DCR >= 0.60) and never "
        f"re-entering the body lows of bars 1-2."
    )

    failure_signal = (
        f"Three White Soldiers fails roughly 25-35% of the time when traded alone without "
        f"confirmation - a lower failure rate than 2-bar engulfings or 1-bar hammers, because the "
        f"3-bar structure already incorporates substantial follow-through. The pattern is "
        f"invalidated if the next bar (N+1) closes back below the body-basis low at "
        f"${body_basis_low:.2f} (stop set at ${stop:.2f}, 1.5% below) - that signals the 3-bar "
        f"accumulation sequence was a liquidity event, not a real continuation, and supply has "
        f"reclaimed control; exit immediately. More insidious failure modes: "
        f"(1) **CLIMAX-TOP INVERSION** - Three White Soldiers prints after an extended advance, "
        f"and Nison's seminal warning is that this pattern's edge INVERTS at climax tops. Recent "
        f"30-bar advance was {advance_pct:.1f}% - "
        f"{'this is past the 40% climax-warning threshold; the soldiers are more likely exhaustion than continuation, and a single bearish reversal bar (engulfing, shooting star, dark cloud) on bar N+1 should trigger an immediate exit even before the stop triggers' if climax_warning else 'this is below the 40% climax-warning threshold, leaving room for normal continuation'}; "
        f"(2) the confirmation bar closes above entry but on weak/declining volume AND its own "
        f"DCR < 0.50 - this is the 'fake-out soldiers' where short-cover buying creates the "
        f"illusion of continuation but the institutional bid never re-materializes after the "
        f"3-bar move; the next 1-3 bars often retrace and break bar 1's low; "
        f"(3) volume across the 3 bars was FALLING ({vol_progression_word}) - if institutions "
        f"weren't progressively stacking commitment, the pattern is structurally weaker even if "
        f"the geometry holds; this is the most under-appreciated failure mode in retail trading; "
        f"(4) the soldiers' high (${c['pattern_high']:.2f}) tags a known resistance level - if it "
        f"sits at or just below a major prior pivot, supply overhead will absorb the next 1-2 "
        f"bars and break the structure; check the chart for prior pivots within 1-2% of pattern "
        f"high before entering; "
        f"(5) context DCR signature was already 'accumulation' (avg DCR {recent_dcr_pct}%) - in "
        f"that case the soldiers are corroborating an EXISTING uptrend, not initiating a new "
        f"phase, and the asymmetric edge of catching a turn is reduced because price is already "
        f"mid-cycle; trim position size accordingly; "
        f"(6) any of bars 1-3 prints upper wick > 15% of range - this would have failed the "
        f"detector geometry, but on real data noisy fills can flag a borderline pattern; if you "
        f"see a soldier with a 10-15% upper wick, the buyers were starting to lose grip on the "
        f"close. Position sizing must reflect the {stop_distance_pct:.1f}% stop distance: risking "
        f"0.5% of account on this trade implies a position size of roughly "
        f"{(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat Three White Soldiers "
        f"as a high-quality SETUP that already incorporates much of its own confirmation - the "
        f"next bar fires the trigger, the stop saves the account if the sequence was actually "
        f"climactic distribution disguised as continuation, and the position size reflects the "
        f"asymmetric reality that even three stacked accumulation closes can fail when they print "
        f"into overhead supply."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Three White Soldiers",
        "category": "candlestick",
        "direction": "bullish",
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
                "upper_wicks_pct": [
                    float(round(c["b1_upper_wick"], 4)),
                    float(round(c["b2_upper_wick"], 4)),
                    float(round(c["b3_upper_wick"], 4)),
                ],
                "advance_pcts": [
                    float(round(c["b1_advance_pct"], 4)),
                    float(round(c["b2_advance_pct"], 4)),
                    float(round(c["b3_advance_pct"], 4)),
                ],
                "volume_progression": [float(v1), float(v2), float(v3)],
                "vol_vs_prior_ratio": float(round(vol_vs_prior_ratio, 4)),
                "total_move_pct": float(round(c["total_move_pct"], 4)),
                "body_pct_avg": float(round(c["body_pct_avg"], 4)),
                "pattern_low": float(round(c["pattern_low"], 4)),
                "pattern_high": float(round(c["pattern_high"], 4)),
                "at_swing_low": bool(is_swing_low),
                "above_50sma": bool(above_50),
                "recent_decline_pct": float(round(decline_pct, 2)),
                "recent_advance_pct": float(round(advance_pct, 2)),
                "climax_warning": bool(climax_warning),
                "dcr_strength": dcr_strength(dcr_avg),
            },
        },
        "levels": {
            "entry": float(entry),
            "entry_condition": f"close > {entry:.2f} on next bar with volume >= 1.3x 20-bar avg + DCR >= 0.65",
            "stop": float(stop),
            "stop_basis": "min_of_bar1_bar2_lows_minus_1.5pct",
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


register(_PATTERN_ID, detect_three_white_soldiers)
