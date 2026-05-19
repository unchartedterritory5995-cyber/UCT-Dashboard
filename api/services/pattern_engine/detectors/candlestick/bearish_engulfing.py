"""Bearish Engulfing candlestick detector.

The Bearish Engulfing is the bearish-reversal mirror of the Bullish Engulfing
and one of the most powerful two-bar topping patterns in the Japanese-candlestick
lexicon. Described by Steve Nison in 'Japanese Candlestick Charting Techniques'
(1991), rooted in Munehisa Homma's 18th-century Sakata trading rules, and
reinforced by Robert Edwards & John Magee in 'Technical Analysis of Stock Trends'
(1948), the pattern captures the cleanest possible reversal of session control
from buyer to seller across two consecutive bars: bar N-1 extends the prevailing
uptrend with a green body, and bar N opens at or above that close and closes at
or below the prior bar's open - completely engulfing the prior body to the
downside. The visual signature is a small green candle wholly contained inside
a larger red candle that overwhelms it.

Definition (geometry):
  - Bar N-1: green body (close > open)
  - Bar N: red body (close < open)
  - Bar N opens at or above bar N-1's close (open >= prev_close)
  - Bar N closes at or below bar N-1's open (close <= prev_open)
  - Bar N's body is meaningfully larger than bar N-1's body (body_curr >= 1.2 * body_prev)

Context (critical — bearish reversal gate):
  - Bearish Engulfing is a REVERSAL pattern and is meaningless without a
    topping/distribution context. A hard reversal-context GATE precedes all
    scoring: a candidate pair is only emitted when at least one of the
    following is true (anchor = bar N, the engulfing bar):
      (a) at_swing_high  — bar N is within 5% of the 10-bar range ceiling
      (b) above_50sma    — bar N close is above the 50-bar SMA
      (c) recent_advance_pct >= _MIN_ADVANCE_FOR_REVERSAL (0.05, i.e. 5%)
          over the 15-bar lookback window
    If NONE hold the pair is unconditionally discarded (continue) — no
    confidence is computed, no Detection is built.
  - Context SCORING (swing high / above-50SMA / advance tiers / DCR) still
    runs for all candidates that PASS the gate.
  - Context's DCR signature == "accumulation" + the current bar's DCR <= 0.30
    indicates that buying has exhausted at the top - the cleanest possible
    distribution transition.

Direction: bearish.
Confirmation: the NEXT bar must close lower (below bar N's low).
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.dcr import compute_dcr, dcr_strength
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "bearish_engulfing"
_MIN_BARS = 6
_MIN_ENGULF_BODY_RATIO = 1.2
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_MIN_ADVANCE_FOR_REVERSAL = 0.05      # 5% recent run-up required for reversal gate
_CONFIDENCE_FLOOR = 50.0


def detect_bearish_engulfing(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect bearish-engulfing 2-bar patterns. Emits 0 or 1 Detection (most recent)."""
    if len(bars) < _MIN_BARS:
        return []

    detections: List[Detection] = []
    start = max(1, len(bars) - _SCAN_LOOKBACK)
    for i in range(start, len(bars)):
        candidate = _try_extract(bars, i)
        if candidate is None:
            continue

        # Compute context helpers once per candidate — used by gate, scoring,
        # and detection builder. Anchor = bar N (the engulfing bar at index i).
        sh = _is_swing_high(bars, i)
        a50 = _above_sma50(bars, i)
        ap = _recent_advance_pct(bars, i)

        # Hard reversal-context gate (precondition — see docstring).
        # Bearish Engulfing is a REVERSAL pattern: it is meaningless without
        # a topping/distribution context. No matter how perfect the geometry,
        # if the price is NOT in a reversal-friendly location this pair is
        # discarded unconditionally.
        has_reversal_context = (
            sh
            or a50
            or ap >= _MIN_ADVANCE_FOR_REVERSAL
        )
        if not has_reversal_context:
            continue  # anti-pattern: bearish engulfing in non-topping location

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, i)
        ctx_score = _score_context(context, bars, i, candidate, sh=sh, a50=a50, ap=ap)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(
            bars, candidate, i, confidence, context, geom_score, vol_score, ctx_score, hist_score,
            sh=sh, a50=a50, ap=ap,
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

    # Bar N-1 must be GREEN
    if prev_c <= prev_o:
        return None
    # Bar N must be RED
    if curr_c >= curr_o:
        return None

    prev_body = prev_c - prev_o
    curr_body = curr_o - curr_c

    if prev_body <= 0 or curr_body <= 0:
        return None

    # Engulfment: opens at/above prev close AND closes at/below prev open
    if curr_o < prev_c:
        return None
    if curr_c > prev_o:
        return None

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


def _is_swing_high(bars: List[Bar], i: int) -> bool:
    lookback = bars[max(0, i - _SWING_LOOKBACK):i + 1]
    if len(lookback) < 4:
        return False
    high_max = max(b["h"] for b in lookback)
    low_min = min(b["l"] for b in lookback)
    rng = high_max - low_min
    if rng <= 0:
        return False
    bar_high = max(bars[i]["h"], bars[i - 1]["h"])
    return (high_max - bar_high) / rng <= 0.05


def _above_sma50(bars: List[Bar], i: int) -> bool:
    if i < 49:
        return False
    closes = [b["c"] for b in bars[i - 49:i + 1]]
    if not closes:
        return False
    sma = sum(closes) / len(closes)
    return bars[i]["c"] > sma


def _recent_advance_pct(bars: List[Bar], i: int) -> float:
    start = max(0, i - 14)
    window = bars[start:i + 1]
    if not window:
        return 0.0
    low = min(b["l"] for b in window)
    high_now = bars[i]["h"]
    if low <= 0:
        return 0.0
    return (high_now - low) / low


def _score_geometry(c: dict) -> float:
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

    cbp = c["curr_body_pct"]
    if cbp >= 0.70:
        body_score = 100.0
    elif cbp >= 0.55:
        body_score = 70.0 + (cbp - 0.55) / 0.15 * 30.0
    elif cbp >= 0.40:
        body_score = 40.0 + (cbp - 0.40) / 0.15 * 30.0
    else:
        body_score = max(0.0, cbp / 0.40 * 40.0)

    # Reversal completeness: curr_close below prev_open by more than 0.5% is "fully through"
    close_excess = (c["prev_open"] - c["curr_close"]) / max(c["prev_open"], 0.0001)
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
    sh: bool,
    a50: bool,
    ap: float,
) -> float:
    """Score topping context at bar N index.

    Accepts precomputed helper values (sh, a50, ap) so the detect loop can
    compute each helper exactly once per candidate.
    """
    score = 25.0
    swing_high = sh
    above_50 = a50
    advance = ap

    if swing_high:
        score += 25
    if above_50:
        score += 10
    if advance >= 0.10:
        score += 15
    elif advance >= 0.05:
        score += 8

    # DCR alignment: weak close on bar N is the institutional distribution fingerprint
    curr_dcr = c["curr_dcr"]
    if curr_dcr <= 0.15:
        score += 15
    elif curr_dcr <= 0.30:
        score += 10
    elif curr_dcr <= 0.45:
        score += 5

    # Context DCR signature: accumulation -> distribution transition at top
    dcr_sig = context.get("dcr_signature")
    if dcr_sig == "accumulation" and curr_dcr <= 0.30:
        score += 10
    elif dcr_sig == "neutral" and curr_dcr <= 0.30:
        score += 5

    res = context.get("nearest_resistance")
    if res and res > 0 and abs(c["curr_high"] - res) / res <= 0.015:
        score += 5

    stage = context.get("trend_stage")
    if stage in (2, 3):
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
    sh: bool,
    a50: bool,
    ap: float,
) -> Detection:
    prev_bar = c["prev_bar"]
    curr_bar = c["curr_bar"]

    prev_body_pct_disp = round(c["prev_body_pct"] * 100, 2)
    curr_body_pct_disp = round(c["curr_body_pct"] * 100, 2)
    ratio_disp = round(c["engulfment_ratio"], 2)
    curr_dcr_pct = round(c["curr_dcr"] * 100, 1)
    prev_dcr_pct = round(c["prev_dcr"] * 100, 1)

    is_swing_high = sh
    above_50 = a50
    advance_pct = ap * 100

    prev_v = prev_bar["v"]
    curr_v = curr_bar["v"]
    vol_ratio = (curr_v / prev_v) if prev_v > 0 else 0.0
    vol_ratio_disp = f"{vol_ratio:.2f}x"

    # Levels — bearish trade
    pattern_high = max(curr_bar["h"], prev_bar["h"])
    pattern_low = min(curr_bar["l"], prev_bar["l"])
    entry = round(pattern_low * 0.999, 2)
    stop = round(pattern_high * 1.015, 2)
    measured = entry - 2 * (stop - entry)
    near_sup = context.get("nearest_support")
    if near_sup and near_sup < entry:
        target = round(max(near_sup, measured), 2)
        target_basis = "nearest_support_or_2R_measured_move_down"
    else:
        target = round(measured, 2)
        target_basis = "2R_measured_move_down"
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0
    stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

    if is_swing_high:
        position_phrase = "at a near-term swing high"
    elif above_50:
        position_phrase = "above the 50-bar SMA after recent advance"
    elif advance_pct >= 5.0:
        position_phrase = f"following a {advance_pct:.1f}% recent rally"
    else:
        position_phrase = "without a clear preceding advance"

    stage_phrase = _trend_phrase(context)
    ma_phrase = _ma_phrase(context)
    rs_phrase = _rs_phrase(context)
    regime = context.get("regime", "current")
    dcr_sig = context.get("dcr_signature", "neutral")
    recent_dcr_avg = context.get("recent_dcr_avg", 0.5)
    recent_dcr_pct = round(recent_dcr_avg * 100, 1)

    if c["curr_dcr"] <= 0.15:
        dcr_position = "the very bottom"
    elif c["curr_dcr"] <= 0.30:
        dcr_position = "the lower third"
    elif c["curr_dcr"] <= 0.45:
        dcr_position = "the lower half"
    else:
        dcr_position = "the middle"

    anchors = [
        {"t": int(prev_bar["t"]), "price": float(prev_bar["c"])},
        {"t": int(curr_bar["t"]), "price": float(curr_bar["c"])},
    ]
    now = int(time.time())

    headline = (
        f"Bearish Engulfing {position_phrase} - bar N's {curr_body_pct_disp}% red body "
        f"({ratio_disp}x the prior {prev_body_pct_disp}% green body) closes at "
        f"${c['curr_close']:.2f}, DCR {curr_dcr_pct}%, volume {vol_ratio_disp} prior bar."
    )

    what_it_is = (
        f"The Bearish Engulfing is the bearish mirror of the Bullish Engulfing and one of "
        f"the most powerful two-bar topping patterns in the Japanese-candlestick lexicon. "
        f"Codified by Steve Nison in 'Japanese Candlestick Charting Techniques' (1991), "
        f"rooted in Munehisa Homma's 18th-century Sakata rice trading rules, and validated "
        f"by Robert Edwards & John Magee in 'Technical Analysis of Stock Trends' (1948), "
        f"this pattern captures the cleanest possible reversal of session control across "
        f"two consecutive bars. Anatomically, bar N-1 was a green candle - open "
        f"${c['prev_open']:.2f}, close ${c['prev_close']:.2f}, body of {prev_body_pct_disp}% "
        f"of its range - that extended the prevailing uptrend into a new high. Bar N then "
        f"opened at ${c['curr_open']:.2f} (at or above the prior close of "
        f"${c['prev_close']:.2f}), drove the entire session LOWER, and closed at "
        f"${c['curr_close']:.2f} - at or below the prior bar's OPEN. The current bar's body "
        f"of {curr_body_pct_disp}% of range is {ratio_disp}x the size of bar N-1's body, "
        f"clearing the 1.2x minimum that distinguishes a true engulfment from a mere outside "
        f"bar. The current bar's DCR of {curr_dcr_pct}% places its close in {dcr_position} "
        f"of the session range - "
        f"{'a textbook institutional-distribution fingerprint where sellers held into the bell' if c['curr_dcr'] <= 0.30 else 'a moderate close that warrants confirmation'}. "
        f"Volume on bar N was {vol_ratio_disp} the prior bar - "
        f"{'strong reversal volume that corroborates the body geometry as professional distribution' if vol_ratio >= 1.5 else 'modest volume that softens the conviction of the print'}. "
        f"Greg Morris's 'Candlestick Charting Explained' frames the bearish engulfing as one "
        f"of the cleanest two-bar topping signals when accompanied by volume expansion, and "
        f"Tom Bulkowski's mirror statistics put follow-through reliability near ~73% when "
        f"the second bar's body fully overwhelms the prior session on expanding volume. "
        f"Peter Brandt teaches the bearish engulfing as a discretionary short trigger with "
        f"explicit rules: clearly defined prior uptrend, full body engulfment, and next-bar "
        f"confirmation below the engulfing bar's midpoint."
    )

    why_it_matters = (
        f"This bearish engulfing appears {position_phrase}, inside {stage_phrase} with "
        f"{ma_phrase} moving-average alignment and {rs_phrase} relative strength against "
        f"the broader tape. The signal's edge comes from what it reveals about the "
        f"supply/demand transition at the top: on bar N-1 the bulls extended gains to "
        f"${c['prev_close']:.2f} (DCR {prev_dcr_pct}%, a strong close into the session), "
        f"but on bar N the bears opened at or above that high (${c['curr_open']:.2f}), "
        f"drove price ALL the way through the prior body, and closed at or below the prior "
        f"open (${c['curr_close']:.2f}). That is a complete reversal of session control in "
        f"two days - the kind of price action that only happens when real supply materializes "
        f"into late-cycle demand. The current bar's DCR of {curr_dcr_pct}% confirms that "
        f"institutional distribution held into the bell rather than fading - buyers tried to "
        f"defend the prior session high but were overwhelmed, leaving the close in "
        f"{dcr_position} of the bar's range. Context's recent DCR average of {recent_dcr_pct}% "
        f"over the trailing 10 bars classifies the broader chart as '{dcr_sig}' - "
        f"{'a textbook buyer-exhaustion signature where every recent bar closed strongly into the bell and the current bearish engulfing is the breakpoint where that accumulation flipped to distribution' if dcr_sig == 'accumulation' else 'an indecisive base where bar N is the first decisive bearish print in days' if dcr_sig == 'neutral' else 'a distribution context where the bearish engulfing is corroborating continuation rather than a clean reversal'}. "
        f"Recent 15-bar advance of {advance_pct:.1f}% places this pattern at a level where "
        f"sellers had structural reason to distribute. Current regime is {regime}, which "
        f"calibrates how aggressive short-side position sizing should be on a 2-bar reversal."
    )

    what_to_watch_for = (
        f"Bearish engulfing patterns REQUIRE next-bar confirmation - Nison's repeated "
        f"warning, and it applies even more strictly to 2-bar reversals than to single-bar "
        f"shooting stars. The trigger is a close BELOW ${entry:.2f} (the lower of bar N or "
        f"bar N-1 low, minus a 0.1% buffer) on the next bar, ideally on volume of at least "
        f"1.3x the 20-bar average AND with that bar's own DCR <= 0.35 (close in the lower "
        f"third of the confirmation bar's range). Watch for: "
        f"(1) the confirmation bar's high staying below bar N's CLOSE (${c['curr_close']:.2f}) - "
        f"if the next bar lifts back into the engulfing body, the bearish read is incomplete "
        f"and the short is suspect; "
        f"(2) volume on the confirmation bar should be EQUAL TO OR GREATER THAN bar N's "
        f"already-elevated {vol_ratio_disp}-vs-prior reading - shrinking volume into the "
        f"trigger means the sellers who showed up on the engulfing bar didn't follow through "
        f"with conviction, and the move tends to fade within 3-5 bars; "
        f"(3) if 1-2 bars after the engulfing print trade entirely within bar N's range "
        f"(${pattern_low:.2f} to ${pattern_high:.2f}), the signal is in suspended animation - "
        f"don't preempt by shorting early; the engulfing tells you bearish intent has "
        f"arrived, but the FOLLOW-THROUGH tells you it's real; "
        f"(4) DCR on the confirmation bar matters - a follow-through bar that closes strongly "
        f"(DCR > 0.60) into a lower low should be covered, because that print signals that "
        f"buyers are immediately accumulating into bar N's selling. Levels: entry "
        f"${entry:.2f}, stop ${stop:.2f} (basis: pattern high plus 1.5%, {stop_distance_pct:.1f}% "
        f"adverse move from entry), target ${target:.2f} (basis: {target_basis}), R:R "
        f"{rr:.2f}. The 2R measured-move target uses twice the stop distance as a minimum "
        f"downside projection - if a nearby support level "
        f"({'$' + format(near_sup, '.2f') if near_sup else 'none mapped'}) caps the move "
        f"sooner, cover partials there and trail the remaining position to a lower swing "
        f"high. For non-shorting accounts, the bearish engulfing is also a defensive exit "
        f"signal on long positions - sell into the next bar's open or tighten the stop "
        f"aggressively under bar N's low."
    )

    failure_signal = (
        f"Bearish engulfing patterns fail roughly 40% of the time when traded alone without "
        f"confirmation - the failure rate is what separates retail-tier 'I saw an engulfing!' "
        f"shorts from professional execution. The pattern is invalidated if the next bar "
        f"closes back above bar N's high at ${c['curr_high']:.2f} (stop set at ${stop:.2f}, "
        f"1.5% above the pattern high) - that signals the distribution was a one-day "
        f"liquidity event, not the start of a reversal, and buyers have already reclaimed "
        f"control; cover the short immediately, no second-guessing. More insidious failure "
        f"modes: "
        f"(1) the confirmation bar closes below entry but on weak/declining volume AND its "
        f"own DCR > 0.50 - this is the 'fake-out engulfing' where long-liquidation creates "
        f"the illusion of a reversal but the institutional offer never materializes; the "
        f"next 1-3 bars often retrace and break the engulfing high; "
        f"(2) the engulfing prints inside a strong Stage 2 uptrend (here stage is "
        f"{context.get('trend_stage', 'undefined')}) with stacked-bullish MA where every "
        f"counter-trend dip has been bought - in that regime the engulfing is a pause, not "
        f"a reversal, and the burden of proof on the confirmation bar's volume + DCR should "
        f"rise to 1.8x and 0.25 respectively; "
        f"(3) the engulfing's low tags a known support level - if pattern_low "
        f"${pattern_low:.2f} sits at or just above a major prior pivot, demand below will "
        f"absorb the next 1-2 bars and break the structure; check the chart for prior pivots "
        f"within 1-2% of pattern_low before shorting; "
        f"(4) context DCR signature was already 'distribution' (avg DCR {recent_dcr_pct}%) - "
        f"in that case the engulfing is corroborating an EXISTING downtrend, not initiating "
        f"a new top, and the asymmetric edge of catching a reversal is reduced because price "
        f"is already mid-cycle. Position sizing must reflect the {stop_distance_pct:.1f}% "
        f"stop distance: risking 0.5% of account on this short implies a position size of "
        f"roughly {(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat the "
        f"bearish engulfing as a WARNING and a SETUP, never as a trigger - the next bar "
        f"fires the trigger, the stop saves the account when the rally resumes, and the "
        f"position size reflects the reality that 2-bar bearish patterns in strong uptrends "
        f"fail more often than they succeed."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Bearish Engulfing",
        "category": "candlestick",
        "direction": "bearish",
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
                "at_swing_high": bool(is_swing_high),
                "above_50sma": bool(above_50),
                "recent_advance_pct": float(round(advance_pct, 2)),
                "dcr_strength": dcr_strength(c["curr_dcr"]),
            },
        },
        "levels": {
            "entry": float(entry),
            "entry_condition": f"close < {entry:.2f} on next bar with volume >= 1.3x 20-bar avg + DCR <= 0.35",
            "stop": float(stop),
            "stop_basis": "pattern_high_plus_1.5pct",
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


register(_PATTERN_ID, detect_bearish_engulfing)
