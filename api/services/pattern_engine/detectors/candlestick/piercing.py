"""Piercing Pattern (Piercing Line) candlestick detector.

The Piercing Pattern is a 2-bar bullish reversal less aggressive than the
Bullish Engulfing. Documented by Steve Nison in 'Japanese Candlestick Charting
Techniques' (1991), rooted in Munehisa Homma's 18th-century Sakata trading
rules, the piercing line captures the moment a sustained decline meets
unexpected demand that pierces - but does not fully engulf - the prior loss.
Where engulfing demands the green bar overrun the entire prior body, piercing
asks only that the green bar pierce more than 50% of the way into it. The
implication is that buyers showed up with conviction but not yet with the kind
of force that completely flips a chart.

Definition (geometry):
  - Bar N-1: long red bar (body_pct >= 0.40 of its range)
  - Bar N: green bar
  - Bar N opens BELOW bar N-1's low (gap-down open)
  - Bar N closes ABOVE bar N-1's midpoint ((prev_open + prev_close) / 2)
  - Bar N closes BELOW bar N-1's open (does NOT fully engulf - that'd be engulfing)

Context (critical):
  - Piercing is meaningful at a swing low OR after a recent decline
  - Bar N's DCR >= 0.6 indicates buyers held into the bell rather than fading
  - Context's DCR signature in ("distribution", "neutral") is the bullish setup

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


_PATTERN_ID = "piercing"
_MIN_BARS = 6
_MIN_PREV_BODY_PCT = 0.40         # bar N-1 must be a long-body candle
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_CONFIDENCE_FLOOR = 50.0


def detect_piercing(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect piercing-pattern 2-bar reversals. Emits 0 or 1 Detection (most recent)."""
    if len(bars) < _MIN_BARS:
        return []

    detections: List[Detection] = []
    start = max(1, len(bars) - _SCAN_LOOKBACK)
    for i in range(start, len(bars)):
        candidate = _try_extract(bars, i)
        if candidate is None:
            continue

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, i)
        ctx_score = _score_context(context, bars, i, candidate)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(
            bars, candidate, i, confidence, context, geom_score, vol_score, ctx_score, hist_score
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

    prev_o, prev_c, prev_h, prev_l = prev_bar["o"], prev_bar["c"], prev_bar["h"], prev_bar["l"]
    curr_o, curr_c = curr_bar["o"], curr_bar["c"]

    # Bar N-1: RED
    if prev_c >= prev_o:
        return None
    # Bar N: GREEN
    if curr_c <= curr_o:
        return None

    prev_body = prev_o - prev_c
    curr_body = curr_c - curr_o
    if prev_body <= 0 or curr_body <= 0:
        return None

    # Bar N-1 must be a LONG bar (body >= 40% of its range)
    prev_range = prev_h - prev_l
    if prev_range <= 0:
        return None
    prev_body_pct = prev_body / prev_range
    if prev_body_pct < _MIN_PREV_BODY_PCT:
        return None

    # Bar N must GAP DOWN on open (open below prev low)
    if curr_o >= prev_l:
        return None

    # Bar N must close ABOVE the midpoint of bar N-1's body
    midpoint = (prev_o + prev_c) / 2.0
    if curr_c <= midpoint:
        return None

    # Bar N must close BELOW bar N-1's open (NOT fully engulfing — that's a different pattern)
    if curr_c >= prev_o:
        return None

    # Penetration: how far through the prior body did curr_close get?
    # 0% = at midpoint, 100% = at prev_open (full close-the-gap)
    penetration_pct = (curr_c - midpoint) / max(prev_o - midpoint, 0.0001)

    curr_range = curr_bar["h"] - curr_bar["l"]
    curr_body_pct = curr_body / curr_range if curr_range > 0 else 0.0

    gap_down_pct = (prev_l - curr_o) / max(prev_l, 0.0001)

    curr_dcr = compute_dcr(curr_bar)
    prev_dcr = compute_dcr(prev_bar)

    return {
        "prev_bar": prev_bar,
        "curr_bar": curr_bar,
        "prev_idx": i - 1,
        "curr_idx": i,
        "prev_open": prev_o,
        "prev_close": prev_c,
        "prev_high": prev_h,
        "prev_low": prev_l,
        "curr_open": curr_o,
        "curr_close": curr_c,
        "curr_high": curr_bar["h"],
        "curr_low": curr_bar["l"],
        "prev_body": prev_body,
        "curr_body": curr_body,
        "prev_body_pct": prev_body_pct,
        "curr_body_pct": curr_body_pct,
        "midpoint": midpoint,
        "penetration_pct": penetration_pct,
        "gap_down_pct": gap_down_pct,
        "curr_dcr": curr_dcr,
        "prev_dcr": prev_dcr,
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
    """Deeper penetration into prior body + larger gap-down + clean curr body = stronger."""
    pen = c["penetration_pct"]
    if pen >= 0.85:
        pen_score = 100.0
    elif pen >= 0.65:
        pen_score = 70.0 + (pen - 0.65) / 0.20 * 30.0
    elif pen >= 0.35:
        pen_score = 40.0 + (pen - 0.35) / 0.30 * 30.0
    elif pen >= 0.0:
        pen_score = pen / 0.35 * 40.0
    else:
        pen_score = 0.0

    cbp = c["curr_body_pct"]
    if cbp >= 0.65:
        body_score = 100.0
    elif cbp >= 0.45:
        body_score = 60.0 + (cbp - 0.45) / 0.20 * 40.0
    elif cbp >= 0.30:
        body_score = 30.0 + (cbp - 0.30) / 0.15 * 30.0
    else:
        body_score = max(0.0, cbp / 0.30 * 30.0)

    # Larger gap-down = more dramatic reversal
    gap = c["gap_down_pct"]
    if gap >= 0.020:
        gap_score = 100.0
    elif gap >= 0.010:
        gap_score = 60.0 + (gap - 0.010) / 0.010 * 40.0
    elif gap >= 0.0:
        gap_score = 30.0 + gap / 0.010 * 30.0
    else:
        gap_score = 0.0

    return round(min(100.0, 0.50 * pen_score + 0.30 * body_score + 0.20 * gap_score), 2)


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


def _score_context(context: dict, bars: List[Bar], i: int, c: dict) -> float:
    score = 25.0
    swing_low = _is_swing_low(bars, i)
    below_50 = _below_sma50(bars, i)
    decline = _recent_decline_pct(bars, i)

    if swing_low:
        score += 25
    if below_50:
        score += 10
    if decline >= 0.10:
        score += 15
    elif decline >= 0.05:
        score += 8

    curr_dcr = c["curr_dcr"]
    if curr_dcr >= 0.80:
        score += 15
    elif curr_dcr >= 0.60:
        score += 10
    elif curr_dcr >= 0.45:
        score += 5

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
) -> Detection:
    prev_bar = c["prev_bar"]
    curr_bar = c["curr_bar"]

    prev_body_pct_disp = round(c["prev_body_pct"] * 100, 2)
    curr_body_pct_disp = round(c["curr_body_pct"] * 100, 2)
    penetration_disp = round(c["penetration_pct"] * 100, 1)
    gap_disp = round(c["gap_down_pct"] * 100, 2)
    curr_dcr_pct = round(c["curr_dcr"] * 100, 1)
    prev_dcr_pct = round(c["prev_dcr"] * 100, 1)

    is_swing_low = _is_swing_low(bars, i)
    below_50 = _below_sma50(bars, i)
    decline_pct = _recent_decline_pct(bars, i) * 100

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
        f"Piercing Pattern {position_phrase} - bar N gapped down {gap_disp}% then closed "
        f"{penetration_disp}% through the prior {prev_body_pct_disp}% red body, DCR "
        f"{curr_dcr_pct}%, volume {vol_ratio_disp} prior bar."
    )

    what_it_is = (
        f"The Piercing Pattern, also called the Piercing Line, is a two-bar bullish reversal "
        f"less aggressive than the full Bullish Engulfing. Steve Nison documented it in "
        f"'Japanese Candlestick Charting Techniques' (1991), tracing its lineage back to "
        f"Munehisa Homma's 18th-century Sakata rice trading rules. The pattern captures the "
        f"moment a sustained decline meets unexpected demand that pierces - but does not "
        f"fully engulf - the prior loss. Here, bar N-1 was a LONG red candle (body "
        f"{prev_body_pct_disp}% of its range, well above the 40% threshold for a 'long bar'), "
        f"opening at ${c['prev_open']:.2f} and closing at ${c['prev_close']:.2f}, extending "
        f"the downtrend with conviction. Bar N then GAPPED DOWN on the open to "
        f"${c['curr_open']:.2f} - {gap_disp}% below the prior bar's low of ${c['prev_low']:.2f} - "
        f"signaling continued bearish momentum, then REVERSED through the session and closed "
        f"at ${c['curr_close']:.2f}: {penetration_disp}% of the way through bar N-1's body "
        f"(measured from the midpoint ${c['midpoint']:.2f} toward the prior open "
        f"${c['prev_open']:.2f}). Crucially, the close is ABOVE the prior midpoint (qualifying "
        f"as a piercing) but BELOW the prior open (if it had cleared that, this would be a "
        f"full bullish engulfing - a stronger signal but more demanding to set up). The "
        f"current bar's body of {curr_body_pct_disp}% of range with a DCR of {curr_dcr_pct}% "
        f"(close in {dcr_position} of the session) indicates "
        f"{'institutional buyers held into the bell against late-session supply' if c['curr_dcr'] >= 0.60 else 'moderate buying that warrants confirmation'}. "
        f"Volume on bar N was {vol_ratio_disp} the prior bar. Greg Morris's 'Candlestick "
        f"Charting Explained' frames the piercing pattern as a meaningful but not as decisive "
        f"reversal as the bullish engulfing — the close above the midpoint communicates "
        f"intent, but the failure to clear the prior open leaves room for further "
        f"distribution. Adam Grimes's empirical probability research on piercing patterns "
        f"emphasizes that follow-through edge is meaningfully higher when the second bar's "
        f"close pushes deep into the upper third of the prior bar's range rather than "
        f"barely scraping above the midpoint."
    )

    why_it_matters = (
        f"This piercing pattern appears {position_phrase}, inside {stage_phrase} with "
        f"{ma_phrase} moving-average alignment and {rs_phrase} relative strength. The "
        f"signal's edge comes from the psychology of the gap-down failure: on bar N-1 the "
        f"bears extended losses on a long-body candle (DCR {prev_dcr_pct}%, a weak close "
        f"into the session) - the kind of print that screams 'sell more tomorrow'. Bar N "
        f"opened with that expectation - the {gap_disp}% gap down to ${c['curr_open']:.2f} "
        f"is the bears' best chance to confirm continuation. Instead, buyers showed up "
        f"intraday with enough force to rally price BACK through the gap and well into bar "
        f"N-1's body, closing at ${c['curr_close']:.2f} - {penetration_disp}% of the way "
        f"through. That is a structural change in the demand profile: real buyers absorbed "
        f"the morning panic and then continued to lift offers all session long. The current "
        f"bar's DCR of {curr_dcr_pct}% confirms that buyers held into the bell rather than "
        f"fading - a critical detail because pure morning-spike reversals that fade into the "
        f"close are NOT piercing patterns in spirit. Context's recent DCR average of "
        f"{recent_dcr_pct}% over the trailing 10 bars classifies the broader chart as "
        f"'{dcr_sig}' - "
        f"{'a textbook seller-exhaustion setup where buyers are first appearing in size after a string of weak closes' if dcr_sig == 'distribution' else 'an indecisive base where bar N is the first decisive buy print after consolidation' if dcr_sig == 'neutral' else 'an accumulation context where the piercing is corroborating continuation'}. "
        f"The piercing is the less aggressive sibling of the bullish engulfing - the close "
        f"didn't fully reverse the prior session, just pierced more than 50% of it - which "
        f"means the failure rate is higher and confirmation is even more critical. Recent "
        f"15-bar drawdown of {decline_pct:.1f}% places this pattern at a level where buyers "
        f"had structural reason to defend. Current regime is {regime}."
    )

    what_to_watch_for = (
        f"Piercing patterns REQUIRE next-bar confirmation - more so than engulfing, because "
        f"the current bar's close didn't fully reverse the prior session. The trigger is a "
        f"close above ${entry:.2f} (the higher of bar N or bar N-1 high, plus a 0.1% buffer) "
        f"on the next bar, ideally on volume of at least 1.3x the 20-bar average AND with "
        f"that bar's own DCR >= 0.65. Watch for: "
        f"(1) the confirmation bar's low staying above bar N's CLOSE (${c['curr_close']:.2f}) - "
        f"if the next bar undercuts the piercing body, the rejection is incomplete and the "
        f"setup likely fails; "
        f"(2) volume on the confirmation bar should be EQUAL TO OR GREATER THAN bar N's "
        f"{vol_ratio_disp}-vs-prior reading - shrinking volume means buyers from bar N "
        f"didn't follow through, and piercing patterns with fading volume have one of the "
        f"highest failure rates in the candlestick taxonomy; "
        f"(3) ideally the confirmation bar's close exceeds bar N-1's OPEN (${c['prev_open']:.2f}) - "
        f"this is the 'belated engulfing' completion that turns a marginal piercing into a "
        f"high-conviction reversal; "
        f"(4) if 1-2 bars after the piercing print trade entirely within bar N's range "
        f"(${c['curr_low']:.2f} to ${c['curr_high']:.2f}), the signal is suspended - don't "
        f"preempt the confirmation; "
        f"(5) DCR on the confirmation bar - a follow-through bar that prints a higher high "
        f"but DCR < 0.40 should be faded, because that signals selling into the rally. "
        f"Levels: entry ${entry:.2f}, stop ${stop:.2f} (basis: pattern low minus 1.5%, "
        f"{stop_distance_pct:.1f}% adverse move from entry), target ${target:.2f} (basis: "
        f"{target_basis}), R:R {rr:.2f}. The 2R measured-move target uses twice the stop "
        f"distance as a minimum projection - if a nearby resistance level "
        f"({'$' + format(near_res, '.2f') if near_res else 'none mapped'}) caps the move "
        f"sooner, take partials there. The clean follow-through is the next 2-3 bars closing "
        f"higher (each DCR >= 0.55) and never re-entering bar N's lower wick range."
    )

    failure_signal = (
        f"Piercing patterns fail roughly 40-45% of the time when traded alone without "
        f"confirmation - a higher failure rate than the bullish engulfing because the "
        f"reversal is INCOMPLETE by definition: the close didn't fully reverse the prior "
        f"session, it just pierced more than halfway. The pattern is invalidated if the "
        f"next bar closes back below bar N's low at ${c['curr_low']:.2f} (stop set at "
        f"${stop:.2f}, 1.5% below the pattern low) - that signals the morning panic "
        f"reversal was a one-day liquidity event, not a true demand transition. More "
        f"insidious failure modes: "
        f"(1) the confirmation bar closes above entry but on weak volume AND DCR < 0.50 - "
        f"this is the 'fake piercing' where short-cover buying creates the illusion of a "
        f"reversal but supply re-emerges within 2-3 bars; "
        f"(2) the piercing prints inside a strong Stage 4 downtrend (here stage is "
        f"{context.get('trend_stage', 'undefined')}) with stacked-bearish MA where every "
        f"counter-trend bounce has been sold - the burden of proof should rise to a "
        f"confirmation bar DCR >= 0.75 and volume >= 1.8x; "
        f"(3) the piercing's high tags a known resistance shelf - if pattern_high "
        f"${pattern_high:.2f} sits at or just below a prior pivot, supply overhead will "
        f"absorb the next 1-2 bars; check the chart for prior pivots within 1-2% before "
        f"entering; "
        f"(4) context DCR signature was already 'accumulation' (avg DCR {recent_dcr_pct}%) - "
        f"in that case the piercing is corroborating an existing trend, not initiating a "
        f"reversal, and the asymmetric edge is reduced; "
        f"(5) bar N's DCR was below 0.55 even though the close pierced - this is the "
        f"'piercing on a fade' which has the worst statistical follow-through of any "
        f"piercing variant, because buyers didn't hold into the bell. Position sizing must "
        f"reflect the {stop_distance_pct:.1f}% stop distance: risking 0.5% of account "
        f"implies a position size of roughly {(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% "
        f"of equity. Treat the piercing as a SETUP, never as a trigger - the next bar fires "
        f"the trigger, the stop saves the account, and the position size reflects the "
        f"reality that 2-bar incomplete reversals are probability shifters, not crystal balls."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Piercing Pattern",
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
                "penetration_pct": float(round(c["penetration_pct"], 4)),
                "gap_down_pct": float(round(c["gap_down_pct"], 4)),
                "curr_bar_dcr": float(round(c["curr_dcr"], 4)),
                "prev_bar_dcr": float(round(c["prev_dcr"], 4)),
                "volume_ratio": float(round(vol_ratio, 4)),
                "pattern_high": float(round(pattern_high, 4)),
                "pattern_low": float(round(pattern_low, 4)),
                "midpoint": float(round(c["midpoint"], 4)),
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


register(_PATTERN_ID, detect_piercing)
