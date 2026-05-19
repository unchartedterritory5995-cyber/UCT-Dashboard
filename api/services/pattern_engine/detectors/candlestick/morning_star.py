"""Morning Star candlestick detector.

The Morning Star is one of the most powerful 3-bar bullish reversal patterns
in the Japanese-candlestick lexicon. The name comes from the morning star
(Venus appearing before dawn = end of darkness, return of light), capturing
the metaphor perfectly: after a session of selling (the dark), a small middle
candle (the star) pauses the momentum, and the third candle drives price back
up (the dawn). Munehisa Homma's 18th-century Sakata rice trading rules
catalogued this as one of the canonical reversal sequences, and Steve Nison
codified it in 'Japanese Candlestick Charting Techniques' (1991).

Definition (geometry):
  - Bar N-2: RED, LONG body (body_pct >= 0.40 of range) - confirms downtrend
  - Bar N-1: small body (<= 30% of bar N-2 body), positioned at or near bar
    N-2's close. The "star" - sellers couldn't push further. Color irrelevant.
  - Bar N: GREEN, LONG body (body_pct >= 0.40 of range), closes ABOVE the
    MIDPOINT of bar N-2's body. The completion - buyers reclaim control.

Context (critical — reversal-context HARD GATE):
  - Morning Star is a bullish REVERSAL pattern. A hard reversal-context gate
    precedes all scoring: a candidate 3-bar sequence is only emitted when at
    least one of the following is true (anchor = bar N / bar3, the completion
    bar):
      (a) at_swing_low  — bar3 (or its 3-bar window) is within 5% of the
          10-bar range floor
      (b) below_50sma   — bar3 close is below the 50-bar SMA
      (c) recent_decline_pct >= _MIN_DECLINE_FOR_REVERSAL (0.05, i.e. 5%)
          over the 15-bar lookback window ending at bar3
          (decline window: bars[i-14:i+1], low = min of bars i, i-1, i-2)
    If NONE of these hold the 3-bar sequence is unconditionally discarded
    (continue) — no confidence is computed, no Detection is built.
  - The context SCORING (swing low / DCR / support / below-50SMA / decline
    tiers) still runs for all candidates that PASS the gate, differentiating
    strong from weak reversal setups among those that qualify.
  - Stars require 3 bars to complete - pattern is invalidated if any bar
    deviates from the structure (e.g., bar N-2 not red, bar N-1 too large,
    bar N not green or not closing above midpoint)
  - DCR distribution -> neutral -> accumulation transition over the 3 bars
    is the ideal institutional fingerprint

Direction: bullish.
Confirmation: NEXT bar (bar N+1) close above bar N's high.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.dcr import compute_dcr, dcr_strength
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "morning_star"
_MIN_BARS = 7
_MIN_LONG_BODY_PCT = 0.40
_MAX_STAR_BODY_RATIO = 0.30        # middle bar body <= 30% of bar N-2's body
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_MIN_DECLINE_FOR_REVERSAL = 0.05  # 5% recent drawdown required for reversal gate
_CONFIDENCE_FLOOR = 50.0


def detect_morning_star(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect morning-star 3-bar patterns. Emits 0 or 1 Detection (most recent)."""
    if len(bars) < _MIN_BARS:
        return []

    detections: List[Detection] = []
    start = max(2, len(bars) - _SCAN_LOOKBACK)
    for i in range(start, len(bars)):
        candidate = _try_extract(bars, i)
        if candidate is None:
            continue

        # Compute context helpers once per candidate — used by gate, scoring,
        # and detection builder.  Anchor = bar3 = bars[i] (completion bar).
        sw = _is_swing_low(bars, i)
        b50 = _below_sma50(bars, i)
        dp = _recent_decline_pct(bars, i)

        # Hard reversal-context gate (precondition — see docstring).
        # A morning star is a REVERSAL pattern: it is meaningless without
        # reversal context. No matter how perfect the geometry or volume, if
        # the price is NOT in a reversal-friendly location this 3-bar sequence
        # is discarded unconditionally.
        has_reversal_context = (
            sw
            or b50
            or dp >= _MIN_DECLINE_FOR_REVERSAL
        )
        if not has_reversal_context:
            continue  # anti-pattern: morning star in non-reversal location

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, i)
        ctx_score = _score_context(context, bars, i, candidate, sw=sw, b50=b50, dp=dp)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(
            bars, candidate, i, confidence, context,
            geom_score, vol_score, ctx_score, hist_score,
            sw=sw, b50=b50, dp=dp,
        )
        detections.append(d)

    if not detections:
        return []
    return detections[-1:]


def _try_extract(bars: List[Bar], i: int) -> Optional[dict]:
    if i < 2:
        return None
    bar1 = bars[i - 2]  # bar N-2 (red long)
    bar2 = bars[i - 1]  # bar N-1 (star, small body)
    bar3 = bars[i]      # bar N (green long)

    # --- BAR 1 (N-2): must be RED LONG ---
    b1_o, b1_c = bar1["o"], bar1["c"]
    if b1_c >= b1_o:
        return None
    b1_body = b1_o - b1_c
    b1_range = bar1["h"] - bar1["l"]
    if b1_range <= 0:
        return None
    b1_body_pct = b1_body / b1_range
    if b1_body_pct < _MIN_LONG_BODY_PCT:
        return None

    # --- BAR 3 (N): must be GREEN LONG ---
    b3_o, b3_c = bar3["o"], bar3["c"]
    if b3_c <= b3_o:
        return None
    b3_body = b3_c - b3_o
    b3_range = bar3["h"] - bar3["l"]
    if b3_range <= 0:
        return None
    b3_body_pct = b3_body / b3_range
    if b3_body_pct < _MIN_LONG_BODY_PCT:
        return None

    # --- BAR 2 (N-1): the star - small body ---
    b2_o, b2_c = bar2["o"], bar2["c"]
    b2_body = abs(b2_c - b2_o)
    b2_range = bar2["h"] - bar2["l"]
    if b2_range <= 0:
        # Allow zero-range only if it's a doji, but require some range for a "bar"
        return None
    b2_body_pct = b2_body / b2_range if b2_range > 0 else 0.0
    if b1_body > 0:
        star_ratio = b2_body / b1_body
    else:
        star_ratio = 0.0
    if star_ratio > _MAX_STAR_BODY_RATIO:
        return None

    # --- BAR 3 close must be ABOVE bar 1's midpoint ---
    b1_midpoint = (b1_o + b1_c) / 2.0
    if b3_c <= b1_midpoint:
        return None
    midpoint_penetration = (b3_c - b1_midpoint) / b1_body if b1_body > 0 else 0.0

    # Gap from bar 1 to bar 2 (ideal: gap-down or near b1_close)
    # We measure: bar 2's body top (max o, c) relative to bar 1's close (b1_c)
    b2_body_top = max(b2_o, b2_c)
    gap_pct = (b1_c - b2_body_top) / b1_c if b1_c > 0 else 0.0  # positive = gap down

    b1_dcr = compute_dcr(bar1)
    b2_dcr = compute_dcr(bar2)
    b3_dcr = compute_dcr(bar3)
    b2_is_doji = b2_body_pct < 0.10  # tiny body = doji star variant

    return {
        "bar1": bar1, "bar2": bar2, "bar3": bar3,
        "b1_open": b1_o, "b1_close": b1_c,
        "b2_open": b2_o, "b2_close": b2_c,
        "b3_open": b3_o, "b3_close": b3_c,
        "b1_body": b1_body, "b2_body": b2_body, "b3_body": b3_body,
        "b1_body_pct": b1_body_pct, "b2_body_pct": b2_body_pct, "b3_body_pct": b3_body_pct,
        "b1_range": b1_range, "b2_range": b2_range, "b3_range": b3_range,
        "star_ratio": star_ratio,
        "b1_midpoint": b1_midpoint,
        "midpoint_penetration": midpoint_penetration,
        "gap_pct": gap_pct,
        "b1_dcr": b1_dcr, "b2_dcr": b2_dcr, "b3_dcr": b3_dcr,
        "b3_high": bar3["h"],
        "b3_low": bar3["l"],
        "b1_low": bar1["l"],
        "b2_low": bar2["l"],
        "pattern_low": min(bar1["l"], bar2["l"], bar3["l"]),
        "pattern_high": max(bar1["h"], bar2["h"], bar3["h"]),
        "b2_is_doji": b2_is_doji,
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
    return (bar_low - low_min) / rng <= 0.05


def _below_sma50(bars: List[Bar], i: int) -> bool:
    if i < 49:
        return False
    closes = [b["c"] for b in bars[i - 49:i + 1]]
    if not closes:
        return False
    sma = sum(closes) / len(closes)
    return bars[i]["c"] < sma


def _recent_decline_pct(bars: List[Bar], i: int) -> float:
    start = max(0, i - 14)
    window = bars[start:i + 1]
    if not window:
        return 0.0
    high = max(b["h"] for b in window)
    low_now = min(bars[i]["l"], bars[i - 1]["l"], bars[i - 2]["l"])
    if high <= 0:
        return 0.0
    return (high - low_now) / high


def _score_geometry(c: dict) -> float:
    """Score the 3-bar morning-star anatomy."""
    # Bar 1 length: longer bar 1 = stronger downtrend confirmation
    b1bp = c["b1_body_pct"]
    if b1bp >= 0.75:
        b1_score = 100.0
    elif b1bp >= 0.55:
        b1_score = 70.0 + (b1bp - 0.55) / 0.20 * 30.0
    else:
        b1_score = max(0.0, (b1bp - 0.40) / 0.15 * 70.0)

    # Star size: smaller star = stronger indecision signature
    sr = c["star_ratio"]
    if sr <= 0.10:
        star_score = 100.0
    elif sr <= 0.20:
        star_score = 75.0 + (0.20 - sr) / 0.10 * 25.0
    else:
        star_score = max(0.0, (0.30 - sr) / 0.10 * 75.0)

    # Bar 3 length & midpoint penetration
    b3bp = c["b3_body_pct"]
    if b3bp >= 0.75:
        b3_score = 100.0
    elif b3bp >= 0.55:
        b3_score = 70.0 + (b3bp - 0.55) / 0.20 * 30.0
    else:
        b3_score = max(0.0, (b3bp - 0.40) / 0.15 * 70.0)

    # Midpoint penetration: 0.5+ = bar 3 closed near/above bar 1's open (full reversal)
    mp = c["midpoint_penetration"]
    if mp >= 0.80:
        mp_score = 100.0
    elif mp >= 0.40:
        mp_score = 60.0 + (mp - 0.40) / 0.40 * 40.0
    elif mp >= 0.10:
        mp_score = 30.0 + (mp - 0.10) / 0.30 * 30.0
    else:
        mp_score = max(0.0, mp / 0.10 * 30.0)

    # Doji bonus on middle bar
    doji_bonus = 5.0 if c["b2_is_doji"] else 0.0

    return round(min(100.0, 0.25 * b1_score + 0.25 * star_score + 0.25 * b3_score + 0.25 * mp_score + doji_bonus), 2)


def _score_volume(bars: List[Bar], i: int) -> float:
    """Volume: ideal is contraction on bar 2 (star), expansion on bar 3 (confirmation)."""
    if i < 2:
        return 50.0
    b1_v = bars[i - 2]["v"]
    b2_v = bars[i - 1]["v"]
    b3_v = bars[i]["v"]
    if b1_v <= 0 or b2_v <= 0:
        return 50.0

    # Star volume should contract vs bar 1
    star_vol_ratio = b2_v / b1_v
    if star_vol_ratio <= 0.50:
        star_score = 100.0
    elif star_vol_ratio <= 0.80:
        star_score = 60.0 + (0.80 - star_vol_ratio) / 0.30 * 40.0
    elif star_vol_ratio <= 1.20:
        star_score = 30.0 + (1.20 - star_vol_ratio) / 0.40 * 30.0
    else:
        star_score = max(0.0, (1.50 - star_vol_ratio) / 0.30 * 30.0)

    # Bar 3 volume should expand vs bar 2 (and ideally bar 1) - shows real buying
    avg_prior = (b1_v + b2_v) / 2.0
    confirm_ratio = b3_v / avg_prior if avg_prior > 0 else 0.0
    if confirm_ratio >= 1.50:
        confirm_score = 100.0
    elif confirm_ratio >= 1.10:
        confirm_score = 70.0 + (confirm_ratio - 1.10) / 0.40 * 30.0
    elif confirm_ratio >= 0.80:
        confirm_score = 40.0 + (confirm_ratio - 0.80) / 0.30 * 30.0
    else:
        confirm_score = max(0.0, confirm_ratio / 0.80 * 40.0)

    return round(0.40 * star_score + 0.60 * confirm_score, 2)


def _score_context(
    context: dict,
    bars: List[Bar],
    i: int,
    c: dict,
    *,
    sw: bool,
    b50: bool,
    dp: float,
) -> float:
    """Score reversal context at bar3 (completion bar, index i).

    Accepts precomputed helper values (sw, b50, dp) so the detect loop can
    compute each helper exactly once per candidate.
    """
    score = 25.0
    swing_low = sw
    below_50 = b50
    decline = dp

    if swing_low:
        score += 25
    if below_50:
        score += 10
    if decline >= 0.10:
        score += 15
    elif decline >= 0.05:
        score += 8

    # Bar 3 DCR: strong close = institutional buying signature
    b3_dcr = c["b3_dcr"]
    if b3_dcr >= 0.80:
        score += 10
    elif b3_dcr >= 0.65:
        score += 5

    # Context DCR signature: distribution + bar 3 DCR >= 0.6 = textbook reversal
    dcr_sig = context.get("dcr_signature")
    if dcr_sig == "distribution" and b3_dcr >= 0.60:
        score += 10
    elif dcr_sig == "neutral" and b3_dcr >= 0.60:
        score += 5

    sup = context.get("nearest_support")
    if sup and sup > 0 and abs(c["pattern_low"] - sup) / sup <= 0.015:
        score += 5

    stage = context.get("trend_stage")
    if stage in (1, 4):
        score += 5

    return min(100.0, score)


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
    sw: bool,
    b50: bool,
    dp: float,
) -> Detection:
    bar1, bar2, bar3 = c["bar1"], c["bar2"], c["bar3"]

    b1_body_pct_disp = round(c["b1_body_pct"] * 100, 2)
    b2_body_pct_disp = round(c["b2_body_pct"] * 100, 2)
    b3_body_pct_disp = round(c["b3_body_pct"] * 100, 2)
    star_ratio_disp = round(c["star_ratio"], 3)
    mp_disp = round(c["midpoint_penetration"] * 100, 1)
    gap_disp = round(c["gap_pct"] * 100, 2)
    b1_dcr_pct = round(c["b1_dcr"] * 100, 1)
    b2_dcr_pct = round(c["b2_dcr"] * 100, 1)
    b3_dcr_pct = round(c["b3_dcr"] * 100, 1)

    is_swing_low = sw
    below_50 = b50
    decline_pct = dp * 100

    b1_v = bar1["v"]
    b2_v = bar2["v"]
    b3_v = bar3["v"]
    star_vol_ratio = (b2_v / b1_v) if b1_v > 0 else 0.0
    confirm_vol_ratio = (b3_v / ((b1_v + b2_v) / 2.0)) if (b1_v + b2_v) > 0 else 0.0
    star_vol_disp = f"{star_vol_ratio:.2f}x"
    confirm_vol_disp = f"{confirm_vol_ratio:.2f}x"

    # Levels - confirmation breakout above bar 3 high
    entry = round(c["b3_high"] * 1.001, 2)
    stop = round(c["pattern_low"] * 0.985, 2)
    measured = entry + 2 * (entry - stop)
    near_res = context.get("nearest_resistance")
    if near_res and near_res > entry:
        target = round(min(near_res, measured), 2)
        target_basis = "nearest_resistance_or_2R_measured_move"
    else:
        target = round(measured, 2)
        target_basis = "2R_measured_move"
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    if is_swing_low:
        position_phrase = "at a near-term swing low"
    elif below_50:
        position_phrase = "below the 50-bar SMA after recent decline"
    elif decline_pct >= 5.0:
        position_phrase = f"following a {decline_pct:.1f}% recent pullback"
    else:
        position_phrase = "without a clearly preceding downmove"

    stage_phrase = _trend_phrase(context)
    ma_phrase = _ma_phrase(context)
    rs_phrase = _rs_phrase(context)
    regime = context.get("regime", "current")
    dcr_sig = context.get("dcr_signature", "neutral")
    recent_dcr_avg = context.get("recent_dcr_avg", 0.5)
    recent_dcr_pct = round(recent_dcr_avg * 100, 1)
    doji_word = "true doji star" if c["b2_is_doji"] else "small-bodied star"
    gap_word = (
        f"gapped down {gap_disp}%" if c["gap_pct"] > 0.005
        else "opened near the prior close" if abs(c["gap_pct"]) <= 0.005
        else f"opened {abs(gap_disp)}% above the prior close"
    )

    anchors = [
        {"t": int(bar1["t"]), "price": float(bar1["c"])},
        {"t": int(bar2["t"]), "price": float(bar2["c"])},
        {"t": int(bar3["t"]), "price": float(bar3["c"])},
    ]
    now = int(time.time())

    headline = (
        f"Morning Star ({doji_word}) {position_phrase} - bar 1 red {b1_body_pct_disp}% body, "
        f"star {star_ratio_disp}x bar 1, bar 3 green {b3_body_pct_disp}% body closing "
        f"{mp_disp}% past bar 1 midpoint, B3 DCR {b3_dcr_pct}%."
    )

    what_it_is = (
        f"The Morning Star is one of the most powerful 3-bar bullish reversal patterns in the "
        f"Japanese-candlestick lexicon. The name comes from the morning star (Venus appearing "
        f"before dawn = end of darkness, return of light), capturing the metaphor perfectly: "
        f"after a session of selling (the dark), a small middle candle (the star) pauses the "
        f"momentum, and the third candle drives price back up (the dawn). Munehisa Homma's "
        f"18th-century Sakata rice trading rules catalogued this as one of the canonical "
        f"reversal sequences, and Steve Nison codified it for the Western audience in "
        f"'Japanese Candlestick Charting Techniques' (1991). Anatomically, this 3-bar sequence "
        f"unfolds as a complete supply-to-demand transition: Bar 1 (N-2) was a LONG red candle - "
        f"open ${c['b1_open']:.2f}, close ${c['b1_close']:.2f}, body of {b1_body_pct_disp}% of "
        f"its range, DCR {b1_dcr_pct}% - confirming the downtrend on real selling. Bar 2 (N-1, "
        f"the 'star') was a {doji_word} with body of {b2_body_pct_disp}% of its own tiny range "
        f"(only {star_ratio_disp}x the size of bar 1's body), and it {gap_word} relative to "
        f"bar 1's close. Sellers couldn't push price further; the prior momentum vanished. Bar "
        f"3 (N) then opened, drove higher, and closed at ${c['b3_close']:.2f} - a LONG green "
        f"body of {b3_body_pct_disp}% of its range that closed {mp_disp}% above bar 1's "
        f"midpoint of ${c['b1_midpoint']:.2f}. The pattern is complete: down-bar, indecision, "
        f"up-bar, with bar 3's close penetrating well into bar 1's body. Bar 3's DCR of "
        f"{b3_dcr_pct}% places its close in the "
        f"{'very top' if c['b3_dcr'] >= 0.85 else 'upper third' if c['b3_dcr'] >= 0.70 else 'upper half' if c['b3_dcr'] >= 0.55 else 'middle'} "
        f"of its range - "
        f"{'a textbook institutional-buying fingerprint' if c['b3_dcr'] >= 0.70 else 'a moderate close that warrants confirmation'}. "
        f"Star volume was {star_vol_disp} bar 1's, and bar 3 volume was {confirm_vol_disp} the "
        f"average of bars 1-2 - "
        f"{'textbook volume profile: contraction on the star, expansion on the confirmation' if star_vol_ratio <= 0.80 and confirm_vol_ratio >= 1.20 else 'mixed volume profile - not the ideal Homma signature but the geometry holds'}. "
        f"Greg Morris's 'Candlestick Charting Explained' frames the morning star as one of "
        f"the highest-conviction reversal sequences in the entire candlestick library, "
        f"requiring a clear downtrend, a gap-down or doji star, and a strong confirming "
        f"third bar that closes deep into the first bar's body. Tom Bulkowski's empirical "
        f"sample puts morning-star follow-through reliability near ~78% — among the highest "
        f"of any candlestick reversal — when all three bars meet his geometric criteria. "
        f"Linda Raschke uses the morning star plus oversold RSI as a high-conviction "
        f"reversal combo in her swing playbook, treating the 3-bar sequence as the timing "
        f"trigger inside a broader bullish confluence read."
    )

    why_it_matters = (
        f"This morning star appears {position_phrase}, inside {stage_phrase} with {ma_phrase} "
        f"moving-average alignment and {rs_phrase} relative strength against the broader tape. "
        f"The signal's edge comes from what the 3-bar sequence reveals about institutional "
        f"behavior over time: on bar 1 the bears were in complete control - DCR {b1_dcr_pct}% "
        f"meant they held into the bell on volume. On bar 2 the momentum vanished - the range "
        f"collapsed, volume contracted to {star_vol_disp} bar 1's, and the close held in the "
        f"middle of a small range (DCR {b2_dcr_pct}%). That is exhaustion. On bar 3 the bulls "
        f"materialized in size - a long green body, volume of {confirm_vol_disp} the prior 2-bar "
        f"average, close at ${c['b3_close']:.2f} ({mp_disp}% past bar 1's midpoint), DCR "
        f"{b3_dcr_pct}%. The pattern is NOT just an indecision signal like a harami - it is a "
        f"COMPLETE reversal of session control across 3 days, with the third bar's close "
        f"already negating more than half of bar 1's loss. Context's recent DCR average of "
        f"{recent_dcr_pct}% over the trailing 10 bars classifies the broader chart as "
        f"'{dcr_sig}' - "
        f"{'a textbook seller-exhaustion signature where every recent bar closed weakly, and the morning star is the climactic 3-bar transition from distribution to re-emerging accumulation' if dcr_sig == 'distribution' else 'an indecisive base where the morning star is the most decisive directional sequence in weeks' if dcr_sig == 'neutral' else 'an accumulation context where the morning star is corroborating continuation rather than a clean turn'}. "
        f"Recent 15-bar drawdown of {decline_pct:.1f}% places this pattern at a level where "
        f"buyers had structural reason to defend. Current regime is {regime}, which calibrates "
        f"how aggressive position sizing should be on a multi-bar reversal sequence."
    )

    what_to_watch_for = (
        f"Morning Stars are stronger than 2-bar reversals like engulfing or harami because the "
        f"3rd bar's close already incorporates significant confirmation. However, Nison still "
        f"recommends an additional confirmation bar - a CLOSE ABOVE ${entry:.2f} (bar 3's high "
        f"of ${c['b3_high']:.2f} plus a 0.1% buffer) on the bar N+1 close, ideally on volume "
        f"of at least 1.3x the 20-bar average AND with that bar's own DCR >= 0.65. Watch for: "
        f"(1) the confirmation bar's low staying above bar 3's CLOSE (${c['b3_close']:.2f}) - "
        f"if the next bar undercuts bar 3's body, the rejection is incomplete; "
        f"(2) volume on the confirmation bar should EQUAL OR EXCEED bar 3's already-elevated "
        f"{confirm_vol_disp} reading - shrinking volume into the trigger means the buyers who "
        f"showed up on bar 3 didn't follow through; "
        f"(3) if 2-3 bars after the morning-star sequence trade entirely within bar 3's range "
        f"(${bar3['l']:.2f} to ${c['b3_high']:.2f}), the breakout is in suspended animation - "
        f"the structure is intact but the directional resolution is pending; "
        f"(4) DCR on the confirmation bar matters - a follow-through bar that closes weakly "
        f"(DCR < 0.50) into a higher high should be faded, because that print signals supply "
        f"is distributing into the breakout; "
        f"(5) the pattern is INVALIDATED if bar N+1 closes back below the pattern low at "
        f"${c['pattern_low']:.2f} - that signals the 3-bar reversal was a head-fake and "
        f"sellers have reclaimed control. Levels: entry ${entry:.2f}, stop ${stop:.2f} "
        f"(basis: 3-bar pattern low minus 1.5%, {stop_distance_pct:.1f}% adverse move from "
        f"entry), target ${target:.2f} (basis: {target_basis}), R:R {rr:.2f}. The 2R "
        f"measured-move target uses twice the stop distance as a minimum projection - if a "
        f"nearby resistance level "
        f"({'$' + format(near_res, '.2f') if near_res else 'none mapped'}) caps the move "
        f"sooner, take partials there. The clean follow-through is the next 2-3 bars closing "
        f"higher (each DCR >= 0.60) and never re-entering the pattern's lower half."
    )

    failure_signal = (
        f"Morning Star patterns fail roughly 30-35% of the time when traded alone without "
        f"confirmation - a lower failure rate than 2-bar engulfing or harami signals, because "
        f"the 3-bar structure already requires significant follow-through to complete. The "
        f"pattern is invalidated if the next bar (N+1) closes back below the pattern low at "
        f"${c['pattern_low']:.2f} (stop set at ${stop:.2f}, 1.5% below) - that signals the "
        f"3-bar reversal was a liquidity event, not a real turn, and sellers have already "
        f"reclaimed control; exit immediately, no second-guessing. More insidious failure "
        f"modes: "
        f"(1) the confirmation bar closes above entry but on weak/declining volume AND its "
        f"own DCR < 0.50 - this is the 'fake-out morning-star' where short-cover buying "
        f"creates the illusion of a turn but the institutional bid never materializes; the "
        f"next 1-3 bars often retrace and break bar 3's low; "
        f"(2) the pattern prints inside a strong Stage 4 downtrend (here stage is "
        f"{context.get('trend_stage', 'undefined')}) with stacked-bearish MA where every "
        f"counter-trend rally has been sold - in that regime even a complete 3-bar reversal "
        f"can be absorbed by overhead supply, and the burden of proof on the confirmation "
        f"bar's volume + DCR should rise to 1.8x and 0.75 respectively; "
        f"(3) the morning star's high (${c['pattern_high']:.2f}) tags a known resistance "
        f"level - if it sits at or just below a major prior pivot, supply overhead will "
        f"absorb the next 1-2 bars and break the structure; check the chart for prior pivots "
        f"within 1-2% of the pattern high; "
        f"(4) bar 3 closed only marginally above bar 1's midpoint (midpoint penetration "
        f"{mp_disp}%) - the lower this number, the weaker the reversal; if it's under 30%, "
        f"the morning star is more 'rumored' than 'confirmed' and should be treated as a "
        f"setup-only signal; "
        f"(5) context DCR signature was already 'accumulation' (avg DCR {recent_dcr_pct}%) - "
        f"in that case the morning star is corroborating an EXISTING base, not initiating a "
        f"reversal, and the asymmetric edge of catching a turn is reduced because price is "
        f"already mid-cycle. Position sizing must reflect the {stop_distance_pct:.1f}% stop "
        f"distance: risking 0.5% of account on this trade implies a position size of roughly "
        f"{(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat the morning star "
        f"as a high-quality SETUP, never as a guaranteed trigger - the next bar fires the "
        f"trigger, the stop saves the account when the probability misses, and the position "
        f"size reflects the reality that even multi-bar reversal sequences fail in hostile "
        f"regimes."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Morning Star",
        "category": "candlestick",
        "direction": "bullish",
        "start_t": int(bar1["t"]),
        "end_t": int(bar3["t"]),
        "pivot_ts": [int(bar1["t"]), int(bar2["t"]), int(bar3["t"])],
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": {
                "b1_body_pct": float(round(c["b1_body_pct"], 4)),
                "b2_body_pct": float(round(c["b2_body_pct"], 4)),
                "b3_body_pct": float(round(c["b3_body_pct"], 4)),
                "star_ratio": float(round(c["star_ratio"], 4)),
                "midpoint_penetration": float(round(c["midpoint_penetration"], 4)),
                "gap_pct": float(round(c["gap_pct"], 4)),
                "b1_dcr": float(round(c["b1_dcr"], 4)),
                "b2_dcr": float(round(c["b2_dcr"], 4)),
                "b3_dcr": float(round(c["b3_dcr"], 4)),
                "star_vol_ratio": float(round(star_vol_ratio, 4)),
                "confirm_vol_ratio": float(round(confirm_vol_ratio, 4)),
                "pattern_low": float(round(c["pattern_low"], 4)),
                "pattern_high": float(round(c["pattern_high"], 4)),
                "is_doji_star": bool(c["b2_is_doji"]),
                "at_swing_low": bool(is_swing_low),
                "below_50sma": bool(below_50),
                "recent_decline_pct": float(round(decline_pct, 2)),
                "dcr_strength": dcr_strength(c["b3_dcr"]),
            },
        },
        "levels": {
            "entry": float(entry),
            "entry_condition": f"close > {entry:.2f} on next bar with volume >= 1.3x 20-bar avg + DCR >= 0.65",
            "stop": float(stop),
            "stop_basis": "3bar_pattern_low_minus_1.5pct",
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


register(_PATTERN_ID, detect_morning_star)
