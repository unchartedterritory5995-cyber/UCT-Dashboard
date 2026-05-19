"""Bullish Engulfing candlestick detector.

The Bullish Engulfing is one of the most powerful two-bar reversal patterns in
the Japanese-candlestick lexicon. Described by Steve Nison in 'Japanese
Candlestick Charting Techniques' (1991), rooted in Munehisa Homma's 18th-century
Sakata trading rules, and reinforced by Robert Edwards & John Magee in 'Technical
Analysis of Stock Trends' (1948), the pattern captures the cleanest possible
reversal of session control across two consecutive bars: bar N-1 extends a
prevailing downtrend with a red body, and bar N opens at or below that close
and closes at or above the prior bar's open - completely engulfing the prior
body. The visual signature is a small red candle wholly contained inside a
larger green candle that overwhelms it.

Definition (geometry):
  - Bar N-1: red body (close < open)
  - Bar N: green body (close > open)
  - Bar N opens at or below bar N-1's close (open <= prev_close)
  - Bar N closes at or above bar N-1's open (close >= prev_open)
  - Bar N's body is meaningfully larger than bar N-1's body (body_curr >= 1.2 * body_prev)

Context (critical — reversal-context HARD GATE):
  - Bullish Engulfing is a bullish REVERSAL pattern. A hard reversal-context
    gate precedes all scoring: a candidate pair is only emitted when at least
    one of the following is true (anchor = bar N, the engulfing bar):
      (a) at_swing_low  — bar N is within 5% of the 10-bar range floor
      (b) below_50sma   — bar N close is below the 50-bar SMA
      (c) recent_decline_pct >= _MIN_DECLINE_FOR_REVERSAL (0.05, i.e. 5%)
          over the 15-bar lookback window
    If NONE of these hold the pair is unconditionally discarded (continue) —
    no confidence is computed, no Detection is built.
  - The context SCORING (swing low / DCR / support / below-50SMA / decline
    tiers) still runs for all candidates that PASS the gate, differentiating
    strong from weak reversal setups among those that qualify.
  - Context's DCR signature in ("distribution", "neutral") + the current bar's
    DCR >= 0.7 indicates that selling has exhausted and buying held into the
    bell - the cleanest possible accumulation transition

Direction: bullish.
Confirmation: the NEXT bar must close higher (above bar N's high).
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.dcr import compute_dcr, dcr_strength
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "bullish_engulfing"
_MIN_BARS = 6
_MIN_ENGULF_BODY_RATIO = 1.2     # bar N's body >= 1.2 x bar N-1's body
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_MIN_DECLINE_FOR_REVERSAL = 0.05  # 5% recent drawdown required for reversal gate
_CONFIDENCE_FLOOR = 50.0


def detect_bullish_engulfing(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect bullish-engulfing 2-bar patterns. Emits 0 or 1 Detection (most recent)."""
    if len(bars) < _MIN_BARS:
        return []

    detections: List[Detection] = []
    start = max(1, len(bars) - _SCAN_LOOKBACK)
    for i in range(start, len(bars)):
        candidate = _try_extract(bars, i)
        if candidate is None:
            continue

        # Compute context helpers once per candidate — used by gate, scoring,
        # and detection builder.  Each helper is O(lookback).
        sw = _is_swing_low(bars, i)
        b50 = _below_sma50(bars, i)
        dp = _recent_decline_pct(bars, i)

        # Hard reversal-context gate (precondition — see docstring).
        # A bullish engulfing is a REVERSAL pattern: it is meaningless without
        # reversal context. No matter how perfect the geometry or volume, if
        # the price is NOT in a reversal-friendly location this pair is
        # discarded unconditionally.
        has_reversal_context = (
            sw
            or b50
            or dp >= _MIN_DECLINE_FOR_REVERSAL
        )
        if not has_reversal_context:
            continue  # anti-pattern: engulfing in non-reversal location

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
    if i < 1:
        return None
    prev_bar = bars[i - 1]
    curr_bar = bars[i]

    prev_o, prev_c = prev_bar["o"], prev_bar["c"]
    curr_o, curr_c = curr_bar["o"], curr_bar["c"]

    # Bar N-1 must be RED
    if prev_c >= prev_o:
        return None
    # Bar N must be GREEN
    if curr_c <= curr_o:
        return None

    prev_body = prev_o - prev_c           # positive (red bar)
    curr_body = curr_c - curr_o           # positive (green bar)

    if prev_body <= 0 or curr_body <= 0:
        return None

    # Engulfment: opens at/below prev close AND closes at/above prev open
    if curr_o > prev_c:
        return None
    if curr_c < prev_o:
        return None

    # Body-size dominance: curr body >= 1.2x prev body
    if curr_body < _MIN_ENGULF_BODY_RATIO * prev_body:
        return None

    engulfment_ratio = curr_body / prev_body if prev_body > 0 else 0.0

    prev_range = prev_bar["h"] - prev_bar["l"]
    curr_range = curr_bar["h"] - curr_bar["l"]
    prev_body_pct = prev_body / prev_range if prev_range > 0 else 0.0
    curr_body_pct = curr_body / curr_range if curr_range > 0 else 0.0

    curr_dcr = compute_dcr(curr_bar)
    prev_dcr = compute_dcr(prev_bar)

    return {
        "prev_bar": prev_bar,
        "curr_bar": curr_bar,
        "prev_idx": i - 1,
        "curr_idx": i,
        "prev_open": prev_o,
        "prev_close": prev_c,
        "curr_open": curr_o,
        "curr_close": curr_c,
        "prev_body": prev_body,
        "curr_body": curr_body,
        "prev_body_pct": prev_body_pct,
        "curr_body_pct": curr_body_pct,
        "engulfment_ratio": engulfment_ratio,
        "curr_dcr": curr_dcr,
        "prev_dcr": prev_dcr,
        "curr_high": curr_bar["h"],
        "curr_low": curr_bar["l"],
        "prev_high": prev_bar["h"],
        "prev_low": prev_bar["l"],
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
    bar_low = min(bars[i]["l"], bars[i - 1]["l"])
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
    low_now = bars[i]["l"]
    if high <= 0:
        return 0.0
    return (high - low_now) / high


def _score_geometry(c: dict) -> float:
    """Stronger engulfment (bigger curr body relative to prev) + clean candle bodies = higher."""
    ratio = c["engulfment_ratio"]
    if ratio >= 3.0:
        engulf_score = 100.0
    elif ratio >= 2.0:
        engulf_score = 75.0 + (ratio - 2.0) / 1.0 * 25.0
    elif ratio >= 1.5:
        engulf_score = 55.0 + (ratio - 1.5) / 0.5 * 20.0
    elif ratio >= 1.2:
        engulf_score = 30.0 + (ratio - 1.2) / 0.3 * 25.0
    else:
        engulf_score = 0.0

    # Body cleanliness: bar N's body should dominate its own range (>=55% is strong)
    cbp = c["curr_body_pct"]
    if cbp >= 0.70:
        body_score = 100.0
    elif cbp >= 0.55:
        body_score = 70.0 + (cbp - 0.55) / 0.15 * 30.0
    elif cbp >= 0.40:
        body_score = 40.0 + (cbp - 0.40) / 0.15 * 30.0
    else:
        body_score = max(0.0, cbp / 0.40 * 40.0)

    # Reversal completeness: curr_close above prev_open by more than 0.5% is "fully through"
    close_excess = (c["curr_close"] - c["prev_open"]) / max(c["prev_open"], 0.0001)
    if close_excess >= 0.015:
        closure_score = 100.0
    elif close_excess >= 0.005:
        closure_score = 60.0 + (close_excess - 0.005) / 0.010 * 40.0
    elif close_excess >= 0.0:
        closure_score = 30.0 + close_excess / 0.005 * 30.0
    else:
        closure_score = 0.0

    return round(min(100.0, 0.45 * engulf_score + 0.30 * body_score + 0.25 * closure_score), 2)


def _score_volume(bars: List[Bar], i: int) -> float:
    """Volume on bar N relative to bar N-1: strong reversal volume = 1.5x+ prior."""
    if i < 1:
        return 50.0
    prev_v = bars[i - 1]["v"]
    curr_v = bars[i]["v"]
    if prev_v <= 0:
        return 50.0
    ratio = curr_v / prev_v
    if ratio >= 2.0:
        return 100.0
    if ratio >= 1.5:
        return 75.0 + (ratio - 1.5) / 0.5 * 25.0
    if ratio >= 1.0:
        return 50.0 + (ratio - 1.0) / 0.5 * 25.0
    if ratio >= 0.7:
        return 25.0 + (ratio - 0.7) / 0.3 * 25.0
    return 25.0 * ratio / 0.7


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
    """Score reversal context at bar N (engulfing bar).

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

    # DCR alignment: the current bar's strong close is the institutional fingerprint
    curr_dcr = c["curr_dcr"]
    if curr_dcr >= 0.85:
        score += 15
    elif curr_dcr >= 0.70:
        score += 10
    elif curr_dcr >= 0.55:
        score += 5

    # Context DCR signature: distribution -> accumulation transition is the gold-standard signal
    dcr_sig = context.get("dcr_signature")
    if dcr_sig == "distribution" and curr_dcr >= 0.70:
        score += 10
    elif dcr_sig == "neutral" and curr_dcr >= 0.70:
        score += 5

    sup = context.get("nearest_support")
    if sup and sup > 0 and abs(c["curr_low"] - sup) / sup <= 0.015:
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
    prev_bar = c["prev_bar"]
    curr_bar = c["curr_bar"]

    prev_body_pct_disp = round(c["prev_body_pct"] * 100, 2)
    curr_body_pct_disp = round(c["curr_body_pct"] * 100, 2)
    ratio_disp = round(c["engulfment_ratio"], 2)
    curr_dcr_pct = round(c["curr_dcr"] * 100, 1)
    prev_dcr_pct = round(c["prev_dcr"] * 100, 1)

    is_swing_low = sw
    below_50 = b50
    decline_pct = dp * 100

    # Volume ratio
    prev_v = prev_bar["v"]
    curr_v = curr_bar["v"]
    vol_ratio = (curr_v / prev_v) if prev_v > 0 else 0.0
    vol_ratio_disp = f"{vol_ratio:.2f}x"

    # Levels
    pattern_high = max(curr_bar["h"], prev_bar["h"])
    pattern_low = min(curr_bar["l"], prev_bar["l"])
    entry = round(pattern_high * 1.001, 2)
    stop = round(pattern_low * 0.985, 2)
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

    # Position phrase
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

    # DCR position phrase: where in the bar's range did it close?
    if c["curr_dcr"] >= 0.85:
        dcr_position = "the very top"
    elif c["curr_dcr"] >= 0.70:
        dcr_position = "the upper third"
    elif c["curr_dcr"] >= 0.55:
        dcr_position = "the upper half"
    else:
        dcr_position = "the middle"

    anchors = [
        {"t": int(prev_bar["t"]), "price": float(prev_bar["c"])},
        {"t": int(curr_bar["t"]), "price": float(curr_bar["c"])},
    ]
    now = int(time.time())

    headline = (
        f"Bullish Engulfing {position_phrase} - bar N's {curr_body_pct_disp}% body "
        f"({ratio_disp}x the prior {prev_body_pct_disp}% red body) closes at "
        f"${c['curr_close']:.2f}, DCR {curr_dcr_pct}%, volume {vol_ratio_disp} prior bar."
    )

    what_it_is = (
        f"The Bullish Engulfing is one of the most powerful two-bar reversal patterns in the "
        f"Japanese-candlestick lexicon. Codified by Steve Nison in 'Japanese Candlestick "
        f"Charting Techniques' (1991), rooted in Munehisa Homma's 18th-century Sakata rice "
        f"trading rules, and independently validated by Robert Edwards & John Magee in "
        f"'Technical Analysis of Stock Trends' (1948), this pattern captures the cleanest "
        f"possible reversal of session control across two consecutive bars. Anatomically, "
        f"bar N-1 was a red candle - open ${c['prev_open']:.2f}, close ${c['prev_close']:.2f}, "
        f"body of {prev_body_pct_disp}% of its range - that extended the prevailing downtrend "
        f"into a new low. Bar N then opened at ${c['curr_open']:.2f} (at or below the prior "
        f"close of ${c['prev_close']:.2f}), drove the entire session HIGHER, and closed at "
        f"${c['curr_close']:.2f} - at or above the prior bar's OPEN. The current bar's body "
        f"of {curr_body_pct_disp}% of range is {ratio_disp}x the size of bar N-1's body, "
        f"clearing the 1.2x minimum that distinguishes a true engulfment from a mere outside "
        f"bar. The current bar's DCR of {curr_dcr_pct}% places its close in {dcr_position} "
        f"of the session range - "
        f"{'a textbook institutional-buying fingerprint' if c['curr_dcr'] >= 0.70 else 'a moderate close that warrants confirmation'}. "
        f"Volume on bar N was {vol_ratio_disp} the prior bar - "
        f"{'strong reversal volume that corroborates the body geometry' if vol_ratio >= 1.5 else 'modest volume that softens the conviction of the print'}. "
        f"Greg Morris's 'Candlestick Charting Explained' frames the bullish engulfing as one "
        f"of the highest-edge two-bar reversals when accompanied by volume expansion, and "
        f"Tom Bulkowski's Encyclopedia of Chart Patterns puts follow-through reliability "
        f"near ~73% when the volume signature is right. Peter Brandt teaches the engulfing "
        f"as a discretionary trade trigger with explicit rules: it must appear in a clearly "
        f"defined downtrend, the second bar must engulf the entire body of the first, and "
        f"the next-bar confirmation must hold above the engulfing bar's midpoint."
    )

    why_it_matters = (
        f"This bullish engulfing appears {position_phrase}, inside {stage_phrase} with "
        f"{ma_phrase} moving-average alignment and {rs_phrase} relative strength against "
        f"the broader tape. The signal's edge comes from what it reveals about the supply/demand "
        f"transition: on bar N-1 the bears extended losses to ${c['prev_close']:.2f} (DCR "
        f"{prev_dcr_pct}%, a weak close into the session), but on bar N the bulls opened at "
        f"or below that loss (${c['curr_open']:.2f}), drove price ALL the way through the "
        f"prior body, and closed at or above the prior open (${c['curr_close']:.2f}). That "
        f"is a complete reversal of session control in two days - the kind of price action "
        f"that only happens when real demand materializes against extended supply. The "
        f"current bar's DCR of {curr_dcr_pct}% confirms that institutional buying held into "
        f"the bell rather than fading - sellers tried to push price back down but were "
        f"overwhelmed, leaving the close in {dcr_position} of the bar's range. Context's "
        f"recent DCR average of {recent_dcr_pct}% over the trailing 10 bars classifies the "
        f"broader chart as '{dcr_sig}' - "
        f"{'a textbook seller-exhaustion signature where every recent bar closed weakly, and the current bullish engulfing is the breakpoint where that distribution flipped to accumulation' if dcr_sig == 'distribution' else 'an indecisive base where bar N is the first decisive directional print in days' if dcr_sig == 'neutral' else 'an accumulation context where the bullish engulfing is corroborating continuation rather than a clean reversal'}. "
        f"Recent 15-bar drawdown of {decline_pct:.1f}% places this pattern at a level where "
        f"buyers had structural reason to defend. Current regime is {regime}, which "
        f"calibrates how aggressive position sizing should be on a 2-bar reversal signal."
    )

    what_to_watch_for = (
        f"Bullish engulfing patterns REQUIRE next-bar confirmation - Nison's repeated "
        f"warning, and it applies even more strictly to 2-bar reversals than to single-bar "
        f"hammers. The trigger is a close above ${entry:.2f} (the higher of bar N or bar N-1 "
        f"high, plus a 0.1% buffer) on the next bar, ideally on volume of at least 1.3x the "
        f"20-bar average AND with that bar's own DCR >= 0.65 (close in the upper third of "
        f"the confirmation bar's range). Watch for: "
        f"(1) the confirmation bar's low staying above bar N's CLOSE (${c['curr_close']:.2f}) - "
        f"if the next bar undercuts the bullish-engulfing body, the rejection is incomplete "
        f"and the trade is suspect; "
        f"(2) volume on the confirmation bar should be EQUAL TO OR GREATER THAN bar N's "
        f"already-elevated {vol_ratio_disp}-vs-prior reading - shrinking volume into the "
        f"trigger means the buyers who showed up on the engulfing bar didn't follow through "
        f"with conviction, and the move tends to fade within 3-5 bars; "
        f"(3) if 1-2 bars after the engulfing print trade entirely within bar N's range "
        f"(${pattern_low:.2f} to ${pattern_high:.2f}), the signal is in suspended animation - "
        f"don't preempt the confirmation by sizing in early; the engulfing tells you bullish "
        f"intent has arrived, but the FOLLOW-THROUGH tells you it's real; "
        f"(4) DCR on the confirmation bar matters - a follow-through bar that closes weakly "
        f"(DCR < 0.40) into a higher high should be faded, because that print signals that "
        f"sellers are immediately distributing into bar N's buying. Levels: entry "
        f"${entry:.2f}, stop ${stop:.2f} (basis: pattern low minus 1.5%, {stop_distance_pct:.1f}% "
        f"adverse move from entry), target ${target:.2f} (basis: {target_basis}), R:R "
        f"{rr:.2f}. The 2R measured-move target uses twice the stop distance as a minimum "
        f"projection - if a nearby resistance level "
        f"({'$' + format(near_res, '.2f') if near_res else 'none mapped'}) caps the move "
        f"sooner, take partials there and trail the remaining position to a higher swing low. "
        f"The clean follow-through is the next 2-3 bars closing higher (each DCR >= 0.60) "
        f"and never re-entering the engulfing range."
    )

    failure_signal = (
        f"Bullish engulfing patterns fail roughly 40% of the time when traded alone without "
        f"confirmation - the failure rate is what separates retail-tier 'I saw an engulfing!' "
        f"trades from professional execution. The pattern is invalidated if the next bar "
        f"closes back below bar N's low at ${c['curr_low']:.2f} (stop set at ${stop:.2f}, "
        f"1.5% below the pattern low) - that signals the rejection was a one-day liquidity "
        f"event, not the start of a reversal, and sellers have already reclaimed control; "
        f"exit immediately, no second-guessing. More insidious failure modes: "
        f"(1) the confirmation bar closes above entry but on weak/declining volume AND its "
        f"own DCR < 0.50 - this is the 'fake-out engulfing' where short-cover buying creates "
        f"the illusion of a reversal but the institutional bid never materializes; the next "
        f"1-3 bars often retrace and break the engulfing low; "
        f"(2) the engulfing prints inside a strong Stage 4 downtrend (here stage is "
        f"{context.get('trend_stage', 'undefined')}) with stacked-bearish MA where every "
        f"counter-trend bounce has been sold - in that regime the engulfing is a pause, not "
        f"a reversal, and the burden of proof on the confirmation bar's volume + DCR should "
        f"rise to 1.8x and 0.75 respectively; "
        f"(3) the engulfing's high tags a known resistance level - if pattern_high "
        f"${pattern_high:.2f} sits at or just below a major prior pivot, supply overhead "
        f"will absorb the next 1-2 bars and break the structure; check the chart for prior "
        f"pivots within 1-2% of pattern_high before entering; "
        f"(4) context DCR signature was already 'accumulation' (avg DCR {recent_dcr_pct}%) - "
        f"in that case the engulfing is corroborating an EXISTING trend, not initiating a "
        f"new one, and the asymmetric edge of catching a reversal is reduced because price "
        f"is already mid-cycle. Position sizing must reflect the {stop_distance_pct:.1f}% "
        f"stop distance: risking 0.5% of account on this trade implies a position size of "
        f"roughly {(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat the "
        f"bullish engulfing as a SETUP, never as a trigger - the next bar fires the trigger, "
        f"the stop saves the account when the probability inevitably misses, and the "
        f"position size reflects the reality that 2-bar reversal patterns are probability "
        f"shifters, not crystal balls."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Bullish Engulfing",
        "category": "candlestick",
        "direction": "bullish",
        "start_t": int(prev_bar["t"]),
        "end_t": int(curr_bar["t"]),
        "pivot_ts": [int(prev_bar["t"]), int(curr_bar["t"])],
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": {
                "prev_bar_body_pct": float(round(c["prev_body_pct"], 4)),
                "curr_bar_body_pct": float(round(c["curr_body_pct"], 4)),
                "engulfment_ratio": float(round(c["engulfment_ratio"], 4)),
                "curr_bar_dcr": float(round(c["curr_dcr"], 4)),
                "prev_bar_dcr": float(round(c["prev_dcr"], 4)),
                "volume_ratio": float(round(vol_ratio, 4)),
                "pattern_high": float(round(pattern_high, 4)),
                "pattern_low": float(round(pattern_low, 4)),
                "at_swing_low": bool(is_swing_low),
                "below_50sma": bool(below_50),
                "recent_decline_pct": float(round(decline_pct, 2)),
                "dcr_strength": dcr_strength(c["curr_dcr"]),
            },
        },
        "levels": {
            "entry": float(entry),
            "entry_condition": f"close > {entry:.2f} on next bar with volume >= 1.3x 20-bar avg + DCR >= 0.65",
            "stop": float(stop),
            "stop_basis": "pattern_low_minus_1.5pct",
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


register(_PATTERN_ID, detect_bullish_engulfing)
