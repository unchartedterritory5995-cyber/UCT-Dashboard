"""Bullish Harami candlestick detector.

The Bullish Harami is one of the OLDEST documented two-bar reversal patterns in
technical analysis. The name "harami" is Japanese for "pregnant" - the visual
analogy is unmistakable: a small candle body nestled entirely inside a larger
prior candle body, like a child inside the womb. Munehisa Homma's 18th-century
Sakata rice trading rules described this pattern, and Steve Nison codified it
for the Western audience in 'Japanese Candlestick Charting Techniques' (1991).
Robert Edwards & John Magee's 'Technical Analysis of Stock Trends' (1948)
described conceptually similar inside-bar reversals in classical chart analysis.

Definition (geometry):
  - Bar N-1: RED, LONG body (body_pct >= 0.5 of range)
  - Bar N: small body, ENTIRELY INSIDE bar N-1's body:
      bar_N.open > bar_N-1.close  (above the prior red close)
      bar_N.close < bar_N-1.open  (below the prior red open)
  - Bar N's body must be SMALL: <= 50% of bar_N-1's body
  - Bar N can be green OR red - both qualify as harami

Context (critical — reversal-context HARD GATE):
  - Harami signals are weaker than engulfing - they signal INDECISION, not
    full reversal. They require follow-through.
  - A hard reversal-context gate precedes all scoring: a candidate pair is
    only emitted when at least one of the following is true (anchor = bar N,
    the inside/harami bar):
      (a) at_swing_low  — bar N is within 5% of the 10-bar range floor
      (b) below_50sma   — bar N close is below the 50-bar SMA
      (c) recent_decline_pct >= _MIN_DECLINE_FOR_REVERSAL (0.05, i.e. 5%)
          over the 15-bar lookback window
    If NONE of these hold the pair is unconditionally discarded (continue) —
    no confidence is computed, no Detection is built.
  - The context SCORING (swing low / DCR / support / below-50SMA / decline
    tiers) still runs for all candidates that PASS the gate, differentiating
    strong from weak reversal setups among those that qualify.
  - Best at swing low or after recent decline. DCR distribution -> neutral
    transition is the institutional tell (selling exhaustion, buying re-emerging).
  - Harami in mid-trend is just an inside bar - not a reversal signal.

Direction: bullish.
Confirmation: the NEXT bar must close ABOVE bar N-1's open (the long red bar's
top of body) - the level at which the prior downmove was negated.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.dcr import compute_dcr, dcr_strength
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "bullish_harami"
_MIN_BARS = 6
_MIN_PREV_BODY_PCT = 0.50          # bar N-1 body must be >= 50% of its range (long bar)
_MAX_INSIDE_BODY_RATIO = 0.50      # bar N body <= 50% of bar N-1 body
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_MIN_DECLINE_FOR_REVERSAL = 0.05  # 5% recent drawdown required for reversal gate
_CONFIDENCE_FLOOR = 50.0


def detect_bullish_harami(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect bullish-harami 2-bar patterns. Emits 0 or 1 Detection (most recent)."""
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
        # A bullish harami is a REVERSAL pattern: it is meaningless without
        # reversal context. No matter how perfect the geometry or volume, if
        # the price is NOT in a reversal-friendly location this pair is
        # discarded unconditionally.
        has_reversal_context = (
            sw
            or b50
            or dp >= _MIN_DECLINE_FOR_REVERSAL
        )
        if not has_reversal_context:
            continue  # anti-pattern: harami in non-reversal location

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

    prev_body = prev_o - prev_c  # positive (red bar)
    curr_body = abs(curr_c - curr_o)

    if prev_body <= 0:
        return None

    prev_range = prev_bar["h"] - prev_bar["l"]
    curr_range = curr_bar["h"] - curr_bar["l"]
    if prev_range <= 0:
        return None

    prev_body_pct = prev_body / prev_range
    curr_body_pct = curr_body / curr_range if curr_range > 0 else 0.0

    # Bar N-1 must be a LONG bar (body dominates its range)
    if prev_body_pct < _MIN_PREV_BODY_PCT:
        return None

    # Bar N body must be entirely INSIDE bar N-1's body (above prev_close AND below prev_open)
    if curr_o <= prev_c or curr_o >= prev_o:
        return None
    if curr_c <= prev_c or curr_c >= prev_o:
        return None

    # Bar N body must be SMALL relative to bar N-1
    if prev_body > 0:
        body_ratio = curr_body / prev_body
    else:
        body_ratio = 0.0
    if body_ratio > _MAX_INSIDE_BODY_RATIO:
        return None

    # Inside percentage: how much of bar N-1's body does bar N's body occupy?
    body_top_curr = max(curr_o, curr_c)
    body_bot_curr = min(curr_o, curr_c)
    inside_pct = (body_top_curr - body_bot_curr) / prev_body if prev_body > 0 else 0.0

    curr_dcr = compute_dcr(curr_bar)
    prev_dcr = compute_dcr(prev_bar)
    is_green = curr_c > curr_o

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
        "body_ratio": body_ratio,
        "inside_pct": inside_pct,
        "curr_dcr": curr_dcr,
        "prev_dcr": prev_dcr,
        "curr_high": curr_bar["h"],
        "curr_low": curr_bar["l"],
        "prev_high": prev_bar["h"],
        "prev_low": prev_bar["l"],
        "is_green": is_green,
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
    """Stronger geometry = longer prior bar + smaller inside bar + clean containment."""
    # Long prior bar: prev_body_pct >= 0.70 is textbook
    pbp = c["prev_body_pct"]
    if pbp >= 0.85:
        long_score = 100.0
    elif pbp >= 0.70:
        long_score = 75.0 + (pbp - 0.70) / 0.15 * 25.0
    elif pbp >= 0.55:
        long_score = 50.0 + (pbp - 0.55) / 0.15 * 25.0
    else:
        long_score = max(0.0, (pbp - 0.50) / 0.05 * 50.0)

    # Small inside bar: body_ratio <= 0.25 is textbook
    br = c["body_ratio"]
    if br <= 0.15:
        small_score = 100.0
    elif br <= 0.30:
        small_score = 75.0 + (0.30 - br) / 0.15 * 25.0
    elif br <= 0.40:
        small_score = 50.0 + (0.40 - br) / 0.10 * 25.0
    else:
        small_score = max(0.0, (0.50 - br) / 0.10 * 50.0)

    # Containment: how centered is the inside bar within the prior body?
    prev_body_mid = (c["prev_open"] + c["prev_close"]) / 2.0
    curr_body_mid = (c["curr_open"] + c["curr_close"]) / 2.0
    # Distance from center as fraction of prev_body
    center_off = abs(curr_body_mid - prev_body_mid) / max(c["prev_body"], 0.0001)
    if center_off <= 0.15:
        center_score = 100.0
    elif center_off <= 0.30:
        center_score = 60.0 + (0.30 - center_off) / 0.15 * 40.0
    else:
        center_score = max(0.0, (0.50 - center_off) / 0.20 * 60.0)

    # Green inner bar bonus (slightly stronger reversal signature)
    color_bonus = 5.0 if c["is_green"] else 0.0

    return round(min(100.0, 0.45 * long_score + 0.35 * small_score + 0.20 * center_score + color_bonus), 2)


def _score_volume(bars: List[Bar], i: int) -> float:
    """Volume contraction on bar N is the textbook harami signature - selling pressure dries up."""
    if i < 1:
        return 50.0
    prev_v = bars[i - 1]["v"]
    curr_v = bars[i]["v"]
    if prev_v <= 0:
        return 50.0
    ratio = curr_v / prev_v
    # For harami, we WANT contraction: <= 0.7x prior is ideal (sellers exhausted)
    if ratio <= 0.50:
        return 100.0
    if ratio <= 0.70:
        return 75.0 + (0.70 - ratio) / 0.20 * 25.0
    if ratio <= 1.00:
        return 50.0 + (1.00 - ratio) / 0.30 * 25.0
    if ratio <= 1.50:
        return 25.0 + (1.50 - ratio) / 0.50 * 25.0
    return 25.0


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
    """Score reversal context at bar N (inside/harami bar).

    Accepts precomputed helper values (sw, b50, dp) so the detect loop can
    compute each helper exactly once per candidate.
    """
    score = 15.0
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

    # DCR alignment: harami's edge is the close MOVING toward neutral after distribution
    curr_dcr = c["curr_dcr"]
    if curr_dcr >= 0.60:
        score += 10
    elif curr_dcr >= 0.45:
        score += 5

    # Context DCR signature: distribution + bar_N DCR >= 0.6 = textbook re-emerging demand
    dcr_sig = context.get("dcr_signature")
    if dcr_sig == "distribution" and curr_dcr >= 0.60:
        score += 10
    elif dcr_sig == "neutral" and curr_dcr >= 0.60:
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
    ratio_disp = round(c["body_ratio"], 3)
    inside_pct_disp = round(c["inside_pct"] * 100, 2)
    curr_dcr_pct = round(c["curr_dcr"] * 100, 1)
    prev_dcr_pct = round(c["prev_dcr"] * 100, 1)
    color_word = "green" if c["is_green"] else "red"

    is_swing_low = sw
    below_50 = b50
    decline_pct = dp * 100

    prev_v = prev_bar["v"]
    curr_v = curr_bar["v"]
    vol_ratio = (curr_v / prev_v) if prev_v > 0 else 0.0
    vol_ratio_disp = f"{vol_ratio:.2f}x"

    # Levels - bullish trade. Entry = close above prev red bar's open (negation level).
    entry = round(c["prev_open"] * 1.001, 2)
    stop = round(c["prev_low"] * 0.99, 2)
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

    if c["curr_dcr"] >= 0.70:
        dcr_position = "the upper third"
    elif c["curr_dcr"] >= 0.55:
        dcr_position = "the upper half"
    elif c["curr_dcr"] >= 0.40:
        dcr_position = "the middle"
    else:
        dcr_position = "the lower half"

    anchors = [
        {"t": int(prev_bar["t"]), "price": float(prev_bar["c"])},
        {"t": int(curr_bar["t"]), "price": float(curr_bar["c"])},
    ]
    now = int(time.time())

    headline = (
        f"Bullish Harami ({color_word} inside bar) {position_phrase} - "
        f"prior {prev_body_pct_disp}% red body ${c['prev_open']:.2f}->${c['prev_close']:.2f}, "
        f"inside body {ratio_disp}x prior ({inside_pct_disp}% of prior body), "
        f"DCR {curr_dcr_pct}%, volume {vol_ratio_disp}."
    )

    what_it_is = (
        f"The Bullish Harami is one of the oldest documented two-bar reversal patterns in the "
        f"Japanese-candlestick lexicon. The name 'harami' is Japanese for 'pregnant' - the "
        f"visual analogy is unmistakable: a small candle body nestled entirely inside a larger "
        f"prior candle body, like a child inside the womb. Munehisa Homma's 18th-century "
        f"Sakata rice trading rules described this pattern as one of the foundational reversal "
        f"signatures, and Steve Nison codified it for the Western audience in 'Japanese "
        f"Candlestick Charting Techniques' (1991). Robert Edwards & John Magee's 'Technical "
        f"Analysis of Stock Trends' (1948) described conceptually similar inside-bar reversals "
        f"in classical chart analysis. Anatomically, bar N-1 was a LONG red candle - open "
        f"${c['prev_open']:.2f}, close ${c['prev_close']:.2f}, body of {prev_body_pct_disp}% "
        f"of its range - that extended the prevailing downtrend on conviction. Bar N then "
        f"opened at ${c['curr_open']:.2f} (ABOVE the prior close of ${c['prev_close']:.2f}), "
        f"traded in a tight range, and closed at ${c['curr_close']:.2f} (BELOW the prior open "
        f"of ${c['prev_open']:.2f}) - meaning bar N's body is ENTIRELY INSIDE bar N-1's body. "
        f"The inside body of {curr_body_pct_disp}% of its own range is only {ratio_disp}x the "
        f"size of bar N-1's body ({inside_pct_disp}% of the prior body's vertical extent), "
        f"clearing the 50% maximum that distinguishes a harami from a mere consolidation bar. "
        f"The inside bar is {color_word} - "
        f"{'a green inside bar is the textbook bullish harami (moderately stronger reversal signature)' if c['is_green'] else 'a red inside bar is the looser variant - still valid but slightly weaker conviction than the green-bodied form'}. "
        f"The inside bar's DCR of {curr_dcr_pct}% places its close in {dcr_position} of its "
        f"session range. Volume on bar N was {vol_ratio_disp} the prior bar - "
        f"{'textbook volume contraction that signals selling pressure has dried up and the down-trend has lost momentum' if vol_ratio <= 0.80 else 'volume that did NOT contract sharply - the harami signal is weaker without the volume-drying confirmation that Homma originally required'}. "
        f"The harami specifically — Japanese for 'pregnant' — is among the oldest documented "
        f"reversal patterns of any kind, codified in the Honma Sakata rules of the early "
        f"1700s and predating Western chart analysis by more than two centuries; the "
        f"inside-bar-after-a-long-red read is the original Sakata reversal trigger and the "
        f"ancestor of every modern inside-bar setup. Greg Morris's 'Candlestick Charting "
        f"Explained' treats the harami as a context-dependent signal that requires "
        f"confirmation: the inside print is the pause, the next bar's break above the "
        f"inside-bar high is the trigger."
    )

    why_it_matters = (
        f"This bullish harami appears {position_phrase}, inside {stage_phrase} with "
        f"{ma_phrase} moving-average alignment and {rs_phrase} relative strength against the "
        f"broader tape. The signal's edge comes from the abrupt change in volatility character "
        f"that the inside bar represents: on bar N-1 the bears extended losses to "
        f"${c['prev_close']:.2f} (DCR {prev_dcr_pct}%, a weak close) on a long-bodied candle "
        f"covering {c['prev_body']:.2f} points of price. On bar N, that momentum vanished - "
        f"the range collapsed inside the prior body, the close held in {dcr_position} of the "
        f"new range, and the trend has stalled. Harami is NOT a full reversal signal like an "
        f"engulfing pattern; it is a signal of INDECISION - the trend has been absorbed, the "
        f"prior momentum has been neutralized, and the next bar's direction is being decided. "
        f"That is precisely why the harami's edge is statistical, not aggressive: when this "
        f"signature appears after extended selling, the probability that the next 3-5 bars "
        f"reverse rises materially - because the sellers who drove price down on bar N-1 "
        f"failed to push it further on bar N. Context's recent DCR average of {recent_dcr_pct}% "
        f"over the trailing 10 bars classifies the broader chart as '{dcr_sig}' - "
        f"{'a textbook seller-exhaustion signature where every recent bar closed weakly, and the current bullish harami is the volatility-collapse moment where that distribution stalled' if dcr_sig == 'distribution' else 'an indecisive base where bar N is one of several recent neutral prints - corroborating but not climactic' if dcr_sig == 'neutral' else 'an accumulation context where the harami is corroborating consolidation rather than a clean reversal'}. "
        f"Recent 15-bar drawdown of {decline_pct:.1f}% places this pattern at a level where "
        f"buyers had structural reason to defend. Current regime is {regime}, which calibrates "
        f"how aggressive position sizing should be on a 2-bar inside-bar signal that is, by "
        f"its nature, more about indecision than conviction."
    )

    what_to_watch_for = (
        f"Bullish harami patterns ABSOLUTELY REQUIRE next-bar confirmation - more strictly "
        f"than engulfing patterns, because harami is an indecision signal, not a full session "
        f"reversal. Nison repeatedly warned that harami is a weaker reversal than engulfing - "
        f"the bullish read is unconfirmed until the NEXT bar negates the prior downtrend. "
        f"The trigger is a close above ${entry:.2f} (the long red bar's open at "
        f"${c['prev_open']:.2f} plus a 0.1% buffer) on the confirmation bar, ideally on "
        f"volume of at least 1.3x the 20-bar average AND with that bar's own DCR >= 0.65. "
        f"Watch for: "
        f"(1) the confirmation bar's body should be LARGER than the inside bar's body - a "
        f"second tiny inside bar means the consolidation is extending and the directional "
        f"resolution is still pending; "
        f"(2) volume on the confirmation bar should EXPAND vs the harami's contracted volume "
        f"({vol_ratio_disp}) - rising volume into the trigger confirms that buyers are "
        f"stepping in with conviction, not just covering shorts; "
        f"(3) the confirmation bar's low should NOT undercut bar N's low at ${c['curr_low']:.2f} - "
        f"if the next bar pierces the harami's low before closing higher, the bullish read "
        f"is materially weakened (whipsaw); "
        f"(4) DCR on the confirmation bar matters - a follow-through bar that closes weakly "
        f"(DCR < 0.50) into a higher high should be faded, because that print signals supply "
        f"is immediately distributing into the breakout; "
        f"(5) if 2-3 bars after the harami print trade entirely within bar N's range "
        f"(${c['curr_low']:.2f} to ${c['curr_high']:.2f}), the signal is in indefinite "
        f"suspended animation - the indecision continues, the trade is NOT a buy. Levels: "
        f"entry ${entry:.2f}, stop ${stop:.2f} (basis: prior red bar's low minus 1%, "
        f"{stop_distance_pct:.1f}% adverse move from entry), target ${target:.2f} "
        f"(basis: {target_basis}), R:R {rr:.2f}. The 2R measured-move target uses twice the "
        f"stop distance as a minimum projection - if a nearby resistance level "
        f"({'$' + format(near_res, '.2f') if near_res else 'none mapped'}) caps the move "
        f"sooner, take partials there and trail to a higher swing low. The clean follow-through "
        f"is the next 2-3 bars closing higher (each DCR >= 0.60) and never re-entering the "
        f"harami's inner range."
    )

    failure_signal = (
        f"Harami patterns fail MORE OFTEN than engulfing patterns - perhaps 45-50% of the time "
        f"when traded alone without confirmation. This is a foundational limitation of "
        f"inside-bar signals: they confirm indecision, not direction, so the burden of proof "
        f"on the next bar is significantly higher. The pattern is invalidated if the next bar "
        f"closes back below bar N-1's low at ${c['prev_low']:.2f} (stop set at ${stop:.2f}, "
        f"1% below the long red bar's low) - that signals the indecision was just a pause and "
        f"sellers have already resumed control; exit immediately, no second-guessing. More "
        f"insidious failure modes: "
        f"(1) the confirmation bar closes above entry but on weak/declining volume AND its "
        f"own DCR < 0.50 - this is the 'fake-out harami' where short-cover buying creates the "
        f"illusion of a reversal but the institutional bid never materializes; the next 2-4 "
        f"bars often retrace and break the harami low; "
        f"(2) the harami prints inside a strong Stage 4 downtrend (here stage is "
        f"{context.get('trend_stage', 'undefined')}) with stacked-bearish MA where every "
        f"counter-trend bounce has been sold - in that regime the harami is a pause, not a "
        f"reversal, and the burden of proof on the confirmation bar's volume + DCR should "
        f"rise to 1.8x and 0.75 respectively; "
        f"(3) the harami's range tags a known resistance level - if pattern levels sit at or "
        f"just below a major prior pivot, supply overhead will absorb the next 1-2 bars and "
        f"break the structure; "
        f"(4) context DCR signature was already 'accumulation' (avg DCR {recent_dcr_pct}%) - "
        f"in that case the harami is corroborating an EXISTING base or trend, not initiating "
        f"a reversal, and the asymmetric edge of catching a turn is reduced because price is "
        f"already mid-cycle; "
        f"(5) the inside bar is a doji (extremely small body, DCR near 0.5 with no directional "
        f"close) - that variant signals deeper indecision and the directional resolution is "
        f"less predictable than with a normal-bodied harami. Position sizing must reflect the "
        f"{stop_distance_pct:.1f}% stop distance: risking 0.5% of account on this trade "
        f"implies a position size of roughly "
        f"{(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat the bullish "
        f"harami as a probability shifter and a SETUP, never as a trigger - the next bar fires "
        f"the trigger, the stop saves the account when the probability inevitably misses, and "
        f"the position size reflects the reality that inside-bar reversal patterns are softer "
        f"signals than engulfing reversals."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Bullish Harami",
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
                "body_ratio": float(round(c["body_ratio"], 4)),
                "inside_pct": float(round(c["inside_pct"], 4)),
                "curr_bar_dcr": float(round(c["curr_dcr"], 4)),
                "prev_bar_dcr": float(round(c["prev_dcr"], 4)),
                "volume_ratio": float(round(vol_ratio, 4)),
                "is_green_inside_bar": bool(c["is_green"]),
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
            "stop_basis": "prior_red_bar_low_minus_1pct",
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


register(_PATTERN_ID, detect_bullish_harami)
