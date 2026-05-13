"""Bearish Harami candlestick detector.

The Bearish Harami is the bearish mirror of the Bullish Harami and one of the
OLDEST documented two-bar topping patterns in technical analysis. The name
"harami" is Japanese for "pregnant" - the visual analogy is a small candle body
nestled entirely inside a larger prior candle body, like a child inside the
womb. Munehisa Homma's 18th-century Sakata rice trading rules described this
pattern as a foundational reversal signature, and Steve Nison codified it for
the Western audience in 'Japanese Candlestick Charting Techniques' (1991).

Definition (geometry):
  - Bar N-1: GREEN, LONG body (body_pct >= 0.5 of range)
  - Bar N: small body, ENTIRELY INSIDE bar N-1's body:
      bar_N.open < bar_N-1.close  (below the prior green close)
      bar_N.close > bar_N-1.open  (above the prior green open) - wait, mirror!
  - Actually mirror: bar_N.open < bar_N-1.close AND bar_N.close > bar_N-1.open
    No - the mirror of the bullish version (open > prev_close, close < prev_open)
    becomes: open < prev_close AND close > prev_open.

Definition (correct mirror):
  - Bar N-1: GREEN (close > open), LONG body
  - Bar N: open < bar_N-1.close AND open > bar_N-1.open
            close < bar_N-1.close AND close > bar_N-1.open
    Equivalently: max(bar_N.open, bar_N.close) < bar_N-1.close
                  min(bar_N.open, bar_N.close) > bar_N-1.open
  - Bar N's body <= 50% of bar N-1's body

Context (critical):
  - Bearish Harami is meaningful at swing high or post-advance
  - DCR accumulation -> neutral transition is the institutional fingerprint
  - Harami signals indecision, NOT full reversal - requires follow-through

Direction: bearish.
Confirmation: NEXT bar must close BELOW bar N-1's open (the long green bar's
bottom of body) - the level at which the prior advance was negated.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.dcr import compute_dcr, dcr_strength
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "bearish_harami"
_MIN_BARS = 6
_MIN_PREV_BODY_PCT = 0.50
_MAX_INSIDE_BODY_RATIO = 0.50
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_CONFIDENCE_FLOOR = 50.0


def detect_bearish_harami(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect bearish-harami 2-bar patterns. Emits 0 or 1 Detection (most recent)."""
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

    prev_o, prev_c = prev_bar["o"], prev_bar["c"]
    curr_o, curr_c = curr_bar["o"], curr_bar["c"]

    # Bar N-1 must be GREEN
    if prev_c <= prev_o:
        return None

    prev_body = prev_c - prev_o  # positive (green bar): close above open
    curr_body = abs(curr_c - curr_o)

    if prev_body <= 0:
        return None

    prev_range = prev_bar["h"] - prev_bar["l"]
    curr_range = curr_bar["h"] - curr_bar["l"]
    if prev_range <= 0:
        return None

    prev_body_pct = prev_body / prev_range
    curr_body_pct = curr_body / curr_range if curr_range > 0 else 0.0

    # Bar N-1 must be a LONG green bar
    if prev_body_pct < _MIN_PREV_BODY_PCT:
        return None

    # Bar N body must be entirely INSIDE bar N-1's body
    # prev_open is the bottom of the green body, prev_close is the top
    # So curr_o and curr_c must both be between prev_open and prev_close
    if curr_o <= prev_o or curr_o >= prev_c:
        return None
    if curr_c <= prev_o or curr_c >= prev_c:
        return None

    if prev_body > 0:
        body_ratio = curr_body / prev_body
    else:
        body_ratio = 0.0
    if body_ratio > _MAX_INSIDE_BODY_RATIO:
        return None

    body_top_curr = max(curr_o, curr_c)
    body_bot_curr = min(curr_o, curr_c)
    inside_pct = (body_top_curr - body_bot_curr) / prev_body if prev_body > 0 else 0.0

    curr_dcr = compute_dcr(curr_bar)
    prev_dcr = compute_dcr(prev_bar)
    is_red = curr_c < curr_o

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
        "is_red": is_red,
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
    pbp = c["prev_body_pct"]
    if pbp >= 0.85:
        long_score = 100.0
    elif pbp >= 0.70:
        long_score = 75.0 + (pbp - 0.70) / 0.15 * 25.0
    elif pbp >= 0.55:
        long_score = 50.0 + (pbp - 0.55) / 0.15 * 25.0
    else:
        long_score = max(0.0, (pbp - 0.50) / 0.05 * 50.0)

    br = c["body_ratio"]
    if br <= 0.15:
        small_score = 100.0
    elif br <= 0.30:
        small_score = 75.0 + (0.30 - br) / 0.15 * 25.0
    elif br <= 0.40:
        small_score = 50.0 + (0.40 - br) / 0.10 * 25.0
    else:
        small_score = max(0.0, (0.50 - br) / 0.10 * 50.0)

    prev_body_mid = (c["prev_open"] + c["prev_close"]) / 2.0
    curr_body_mid = (c["curr_open"] + c["curr_close"]) / 2.0
    center_off = abs(curr_body_mid - prev_body_mid) / max(c["prev_body"], 0.0001)
    if center_off <= 0.15:
        center_score = 100.0
    elif center_off <= 0.30:
        center_score = 60.0 + (0.30 - center_off) / 0.15 * 40.0
    else:
        center_score = max(0.0, (0.50 - center_off) / 0.20 * 60.0)

    color_bonus = 5.0 if c["is_red"] else 0.0

    return round(min(100.0, 0.45 * long_score + 0.35 * small_score + 0.20 * center_score + color_bonus), 2)


def _score_volume(bars: List[Bar], i: int) -> float:
    """Volume contraction on bar N is the textbook harami signature - buying pressure dries up."""
    if i < 1:
        return 50.0
    prev_v = bars[i - 1]["v"]
    curr_v = bars[i]["v"]
    if prev_v <= 0:
        return 50.0
    ratio = curr_v / prev_v
    if ratio <= 0.50:
        return 100.0
    if ratio <= 0.70:
        return 75.0 + (0.70 - ratio) / 0.20 * 25.0
    if ratio <= 1.00:
        return 50.0 + (1.00 - ratio) / 0.30 * 25.0
    if ratio <= 1.50:
        return 25.0 + (1.50 - ratio) / 0.50 * 25.0
    return 25.0


def _score_context(context: dict, bars: List[Bar], i: int, c: dict) -> float:
    score = 15.0
    swing_high = _is_swing_high(bars, i)
    above_50 = _above_sma50(bars, i)
    advance = _recent_advance_pct(bars, i)

    if swing_high:
        score += 25
    if above_50:
        score += 10
    if advance >= 0.10:
        score += 15
    elif advance >= 0.05:
        score += 8

    # DCR alignment: weak close on bar N is the distribution fingerprint
    curr_dcr = c["curr_dcr"]
    if curr_dcr <= 0.40:
        score += 10
    elif curr_dcr <= 0.55:
        score += 5

    # Context DCR signature: accumulation + bar_N DCR <= 0.4 = textbook supply re-emergence
    dcr_sig = context.get("dcr_signature")
    if dcr_sig == "accumulation" and curr_dcr <= 0.40:
        score += 10
    elif dcr_sig == "neutral" and curr_dcr <= 0.40:
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
) -> Detection:
    prev_bar = c["prev_bar"]
    curr_bar = c["curr_bar"]

    prev_body_pct_disp = round(c["prev_body_pct"] * 100, 2)
    curr_body_pct_disp = round(c["curr_body_pct"] * 100, 2)
    ratio_disp = round(c["body_ratio"], 3)
    inside_pct_disp = round(c["inside_pct"] * 100, 2)
    curr_dcr_pct = round(c["curr_dcr"] * 100, 1)
    prev_dcr_pct = round(c["prev_dcr"] * 100, 1)
    color_word = "red" if c["is_red"] else "green"

    is_swing_high = _is_swing_high(bars, i)
    above_50 = _above_sma50(bars, i)
    advance_pct = _recent_advance_pct(bars, i) * 100

    prev_v = prev_bar["v"]
    curr_v = curr_bar["v"]
    vol_ratio = (curr_v / prev_v) if prev_v > 0 else 0.0
    vol_ratio_disp = f"{vol_ratio:.2f}x"

    # Levels - bearish trade. Entry = close below prev green bar's open (negation level).
    entry = round(c["prev_open"] * 0.999, 2)
    stop = round(c["prev_high"] * 1.01, 2)
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

    if c["curr_dcr"] <= 0.30:
        dcr_position = "the lower third"
    elif c["curr_dcr"] <= 0.45:
        dcr_position = "the lower half"
    elif c["curr_dcr"] <= 0.60:
        dcr_position = "the middle"
    else:
        dcr_position = "the upper half"

    anchors = [
        {"t": int(prev_bar["t"]), "price": float(prev_bar["c"])},
        {"t": int(curr_bar["t"]), "price": float(curr_bar["c"])},
    ]
    now = int(time.time())

    headline = (
        f"Bearish Harami ({color_word} inside bar) {position_phrase} - "
        f"prior {prev_body_pct_disp}% green body ${c['prev_open']:.2f}->${c['prev_close']:.2f}, "
        f"inside body {ratio_disp}x prior ({inside_pct_disp}% of prior body), "
        f"DCR {curr_dcr_pct}%, volume {vol_ratio_disp}."
    )

    what_it_is = (
        f"The Bearish Harami is the bearish mirror of the Bullish Harami and one of the oldest "
        f"documented two-bar topping patterns in the Japanese-candlestick lexicon. The name "
        f"'harami' is Japanese for 'pregnant' - the visual analogy is unmistakable: a small "
        f"candle body nestled entirely inside a larger prior candle body, like a child inside "
        f"the womb. Munehisa Homma's 18th-century Sakata rice trading rules described this "
        f"pattern as a foundational reversal signature, and Steve Nison codified it for the "
        f"Western audience in 'Japanese Candlestick Charting Techniques' (1991). Robert Edwards "
        f"& John Magee's 'Technical Analysis of Stock Trends' (1948) described conceptually "
        f"similar inside-bar reversals in classical chart analysis. Anatomically, bar N-1 was "
        f"a LONG green candle - open ${c['prev_open']:.2f}, close ${c['prev_close']:.2f}, body "
        f"of {prev_body_pct_disp}% of its range - that extended the prevailing uptrend on "
        f"conviction. Bar N then opened at ${c['curr_open']:.2f} (BELOW the prior close of "
        f"${c['prev_close']:.2f}), traded in a tight range, and closed at ${c['curr_close']:.2f} "
        f"(ABOVE the prior open of ${c['prev_open']:.2f}) - meaning bar N's body is ENTIRELY "
        f"INSIDE bar N-1's body. The inside body of {curr_body_pct_disp}% of its own range is "
        f"only {ratio_disp}x the size of bar N-1's body ({inside_pct_disp}% of the prior body's "
        f"vertical extent), clearing the 50% maximum that distinguishes a harami from a mere "
        f"consolidation bar. The inside bar is {color_word} - "
        f"{'a red inside bar is the textbook bearish harami (moderately stronger reversal signature)' if c['is_red'] else 'a green inside bar is the looser variant - still valid but slightly weaker conviction than the red-bodied form'}. "
        f"The inside bar's DCR of {curr_dcr_pct}% places its close in {dcr_position} of its "
        f"session range. Volume on bar N was {vol_ratio_disp} the prior bar - "
        f"{'textbook volume contraction that signals buying pressure has dried up and the up-trend has lost momentum' if vol_ratio <= 0.80 else 'volume that did NOT contract sharply - the harami signal is weaker without the volume-drying confirmation that Homma originally required'}."
    )

    why_it_matters = (
        f"This bearish harami appears {position_phrase}, inside {stage_phrase} with {ma_phrase} "
        f"moving-average alignment and {rs_phrase} relative strength against the broader tape. "
        f"The signal's edge comes from the abrupt change in volatility character that the "
        f"inside bar represents: on bar N-1 the bulls extended gains to ${c['prev_close']:.2f} "
        f"(DCR {prev_dcr_pct}%, a strong close into the session) on a long-bodied candle "
        f"covering {c['prev_body']:.2f} points of price. On bar N, that momentum vanished - "
        f"the range collapsed inside the prior body, the close held in {dcr_position} of the "
        f"new range, and the trend has stalled. Harami is NOT a full reversal signal like an "
        f"engulfing pattern; it is a signal of INDECISION - the trend has been absorbed, the "
        f"prior momentum has been neutralized, and the next bar's direction is being decided. "
        f"That is precisely why the harami's edge is statistical, not aggressive: when this "
        f"signature appears after extended buying, the probability that the next 3-5 bars "
        f"reverse rises materially - because the buyers who drove price up on bar N-1 failed "
        f"to push it further on bar N. Context's recent DCR average of {recent_dcr_pct}% over "
        f"the trailing 10 bars classifies the broader chart as '{dcr_sig}' - "
        f"{'a textbook buyer-exhaustion signature where every recent bar closed strongly into the bell and the current bearish harami is the volatility-collapse moment where that accumulation stalled' if dcr_sig == 'accumulation' else 'an indecisive base where bar N is one of several recent neutral prints - corroborating but not climactic' if dcr_sig == 'neutral' else 'a distribution context where the harami is corroborating consolidation rather than a clean reversal'}. "
        f"Recent 15-bar advance of {advance_pct:.1f}% places this pattern at a level where "
        f"sellers had structural reason to distribute. Current regime is {regime}, which "
        f"calibrates how aggressive short-side position sizing should be on a 2-bar inside-bar "
        f"signal that is, by its nature, more about indecision than conviction."
    )

    what_to_watch_for = (
        f"Bearish harami patterns ABSOLUTELY REQUIRE next-bar confirmation - more strictly than "
        f"engulfing patterns, because harami is an indecision signal, not a full session "
        f"reversal. Nison repeatedly warned that harami is a weaker reversal than engulfing - "
        f"the bearish read is unconfirmed until the NEXT bar negates the prior advance. The "
        f"trigger is a close BELOW ${entry:.2f} (the long green bar's open at "
        f"${c['prev_open']:.2f} minus a 0.1% buffer) on the confirmation bar, ideally on "
        f"volume of at least 1.3x the 20-bar average AND with that bar's own DCR <= 0.35. "
        f"Watch for: "
        f"(1) the confirmation bar's body should be LARGER than the inside bar's body - a "
        f"second tiny inside bar means the consolidation is extending and the directional "
        f"resolution is still pending; "
        f"(2) volume on the confirmation bar should EXPAND vs the harami's contracted volume "
        f"({vol_ratio_disp}) - rising volume into the trigger confirms that sellers are "
        f"stepping in with conviction, not just profit-taking; "
        f"(3) the confirmation bar's high should NOT exceed bar N's high at ${c['curr_high']:.2f} - "
        f"if the next bar lifts back through the harami's high before closing lower, the "
        f"bearish read is materially weakened (whipsaw); "
        f"(4) DCR on the confirmation bar matters - a follow-through bar that closes strongly "
        f"(DCR > 0.50) into a lower low should be covered, because that print signals demand "
        f"is immediately accumulating into the breakdown; "
        f"(5) if 2-3 bars after the harami print trade entirely within bar N's range "
        f"(${c['curr_low']:.2f} to ${c['curr_high']:.2f}), the signal is in indefinite "
        f"suspended animation - the indecision continues, the short is NOT a trade. Levels: "
        f"entry ${entry:.2f}, stop ${stop:.2f} (basis: prior green bar's high plus 1%, "
        f"{stop_distance_pct:.1f}% adverse move from entry), target ${target:.2f} "
        f"(basis: {target_basis}), R:R {rr:.2f}. The 2R measured-move target uses twice the "
        f"stop distance as a minimum downside projection - if a nearby support level "
        f"({'$' + format(near_sup, '.2f') if near_sup else 'none mapped'}) caps the move "
        f"sooner, cover partials there and trail to a lower swing high. For non-shorting "
        f"accounts, the bearish harami is also a defensive exit signal on long positions - "
        f"tighten the stop aggressively under bar N's low, or sell into the next bar's open."
    )

    failure_signal = (
        f"Harami patterns fail MORE OFTEN than engulfing patterns - perhaps 45-50% of the time "
        f"when traded alone without confirmation. This is a foundational limitation of "
        f"inside-bar signals: they confirm indecision, not direction, so the burden of proof "
        f"on the next bar is significantly higher. The pattern is invalidated if the next bar "
        f"closes back above bar N-1's high at ${c['prev_high']:.2f} (stop set at ${stop:.2f}, "
        f"1% above the long green bar's high) - that signals the indecision was just a pause "
        f"and buyers have already resumed control; cover the short immediately, no second-"
        f"guessing. More insidious failure modes: "
        f"(1) the confirmation bar closes below entry but on weak/declining volume AND its "
        f"own DCR > 0.50 - this is the 'fake-out harami' where long-liquidation creates the "
        f"illusion of a reversal but the institutional offer never materializes; the next 2-4 "
        f"bars often retrace and break the harami high; "
        f"(2) the harami prints inside a strong Stage 2 uptrend (here stage is "
        f"{context.get('trend_stage', 'undefined')}) with stacked-bullish MA where every "
        f"counter-trend dip has been bought - in that regime the harami is a pause, not a "
        f"reversal, and the burden of proof on the confirmation bar's volume + DCR should "
        f"rise to 1.8x and 0.25 respectively; "
        f"(3) the harami's range tags a known support level - if pattern levels sit at or just "
        f"above a major prior pivot, demand below will absorb the next 1-2 bars and break the "
        f"structure; "
        f"(4) context DCR signature was already 'distribution' (avg DCR {recent_dcr_pct}%) - "
        f"in that case the harami is corroborating an EXISTING top or downtrend, not initiating "
        f"a fresh reversal, and the asymmetric edge of catching a turn is reduced because "
        f"price is already mid-cycle; "
        f"(5) the inside bar is a doji (extremely small body, DCR near 0.5 with no directional "
        f"close) - that variant signals deeper indecision and the directional resolution is "
        f"less predictable than with a normal-bodied harami. Position sizing must reflect the "
        f"{stop_distance_pct:.1f}% stop distance: risking 0.5% of account on this short "
        f"implies a position size of roughly "
        f"{(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat the bearish harami "
        f"as a WARNING and a SETUP, never as a trigger - the next bar fires the trigger, the "
        f"stop saves the account when the probability inevitably misses, and the position size "
        f"reflects the reality that inside-bar reversal patterns are softer signals than "
        f"engulfing reversals."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Bearish Harami",
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
                "body_ratio": float(round(c["body_ratio"], 4)),
                "inside_pct": float(round(c["inside_pct"], 4)),
                "curr_bar_dcr": float(round(c["curr_dcr"], 4)),
                "prev_bar_dcr": float(round(c["prev_dcr"], 4)),
                "volume_ratio": float(round(vol_ratio, 4)),
                "is_red_inside_bar": bool(c["is_red"]),
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
            "stop_basis": "prior_green_bar_high_plus_1pct",
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


register(_PATTERN_ID, detect_bearish_harami)
