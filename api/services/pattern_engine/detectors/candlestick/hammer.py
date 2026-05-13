"""Hammer candlestick detector.

The Hammer is the canonical bullish single-bar reversal signal. Described in
Steve Nison's "Japanese Candlestick Charting Techniques" (1991) and rooted in
Munehisa Homma's 18th-century Sakata trading rules, the hammer is the candle
that prints when sellers drive price hard lower during a session but buyers
overwhelm them on the close, leaving a long lower wick, a small body near the
top of the range, and almost no upper wick. The visual: a "hammer" forging a
floor under price.

Definition (geometry):
  - lower_wick >= 2 x body
  - upper_wick <= 0.5 x body
  - body_to_range <= 0.35  (small-body candle)
  - Color of the body is not strict - both green and red hammers count, but a
    green (close > open) hammer is moderately stronger.

Context (critical):
  - Hammer is meaningful at a swing low OR after recent decline (close < 50-bar SMA)
  - Hammer in the middle of an uptrend is NOT a reversal signal - it's noise
  - Hammer + volume expansion = institutional buying signature

Direction: bullish.
Confirmation: the NEXT bar must close higher (above the hammer's high).
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "hammer"
_MIN_BARS = 6
_LOWER_WICK_BODY_MULT = 2.0       # lower_wick >= 2 x body
_UPPER_WICK_BODY_MULT = 0.5       # upper_wick <= 0.5 x body
_BODY_TO_RANGE_MAX = 0.35
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_CONFIDENCE_FLOOR = 50.0


def detect_hammer(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect hammer candles. Emits 0 or 1 Detection (the most recent firing)."""
    if len(bars) < _MIN_BARS:
        return []

    detections: List[Detection] = []
    start = max(0, len(bars) - _SCAN_LOOKBACK)
    for i in range(start, len(bars)):
        candidate = _try_extract(bars, i)
        if candidate is None:
            continue

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, i)
        ctx_score = _score_context(context, bars, i)
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
    bar = bars[i]
    o, h, l, c = bar["o"], bar["h"], bar["l"], bar["c"]
    total_range = h - l
    if total_range <= 0:
        return None

    body = abs(c - o)
    if body <= 0:
        # Pure doji - hammer detector skips; doji detector handles
        return None

    body_top = max(o, c)
    body_bot = min(o, c)
    upper_wick = h - body_top
    lower_wick = body_bot - l

    body_to_range = body / total_range
    if body_to_range > _BODY_TO_RANGE_MAX:
        return None
    if lower_wick < _LOWER_WICK_BODY_MULT * body:
        return None
    if upper_wick > _UPPER_WICK_BODY_MULT * body:
        return None

    return {
        "bar": bar,
        "bar_idx": i,
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "body": body,
        "total_range": total_range,
        "body_to_range": body_to_range,
        "upper_wick": upper_wick,
        "lower_wick": lower_wick,
        "upper_wick_pct": upper_wick / total_range,
        "lower_wick_pct": lower_wick / total_range,
        "lower_wick_body_ratio": lower_wick / body if body > 0 else 0.0,
        "is_green": c > o,
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
    bar_low = bars[i]["l"]
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
    """Return % drawdown from recent 15-bar high to current low (positive = decline)."""
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
    """Score the hammer's anatomy - stronger wick ratio + smaller body = higher."""
    # Lower wick to body ratio: 4x+ = 100, 2x = 30, 2.5x = 50
    ratio = c["lower_wick_body_ratio"]
    if ratio >= 4.0:
        wick_score = 100.0
    elif ratio >= 3.0:
        wick_score = 75.0 + (ratio - 3.0) / 1.0 * 25.0
    elif ratio >= 2.0:
        wick_score = 30.0 + (ratio - 2.0) / 1.0 * 45.0
    else:
        wick_score = 0.0

    # Body compactness: tighter body = stronger signal
    btr = c["body_to_range"]
    if btr <= 0.15:
        body_score = 100.0
    elif btr <= 0.25:
        body_score = 70.0 + (0.25 - btr) / 0.10 * 30.0
    else:
        body_score = max(0.0, (0.35 - btr) / 0.10 * 70.0)

    # Upper wick suppression: smaller upper wick = better
    uwp = c["upper_wick_pct"]
    if uwp <= 0.03:
        upper_score = 100.0
    elif uwp <= 0.08:
        upper_score = 60.0 + (0.08 - uwp) / 0.05 * 40.0
    else:
        upper_score = max(0.0, (0.15 - uwp) / 0.07 * 60.0)

    # Green hammer is moderately stronger than red
    color_bonus = 5.0 if c["is_green"] else 0.0

    return round(min(100.0, 0.45 * wick_score + 0.30 * body_score + 0.25 * upper_score + color_bonus), 2)


def _score_volume(bars: List[Bar], i: int) -> float:
    if i < 1:
        return 50.0
    lookback = bars[max(0, i - 20):i]
    if not lookback:
        return 50.0
    avg_vol = sum(b["v"] for b in lookback) / len(lookback)
    if avg_vol <= 0:
        return 50.0
    ratio = bars[i]["v"] / avg_vol
    # Higher volume on the hammer = stronger reversal signature
    if ratio >= 1.8:
        return 100.0
    if ratio >= 1.3:
        return 75.0 + (ratio - 1.3) / 0.5 * 25.0
    if ratio >= 1.0:
        return 55.0 + (ratio - 1.0) / 0.3 * 20.0
    if ratio >= 0.7:
        return 30.0 + (ratio - 0.7) / 0.3 * 25.0
    return 30.0 * ratio / 0.7


def _score_context(context: dict, bars: List[Bar], i: int) -> float:
    score = 30.0
    swing_low = _is_swing_low(bars, i)
    below_50 = _below_sma50(bars, i)
    decline = _recent_decline_pct(bars, i)

    if swing_low:
        score += 35
    if below_50:
        score += 15
    if decline >= 0.10:
        score += 15
    elif decline >= 0.05:
        score += 8

    # Hammer at a known support
    sup = context.get("nearest_support")
    if sup and sup > 0 and abs(bars[i]["l"] - sup) / sup <= 0.015:
        score += 10

    stage = context.get("trend_stage")
    if stage in (1, 4):
        score += 5  # basing or downtrend — reversal-friendly context

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
    bar = c["bar"]
    body_disp = round(c["body_to_range"] * 100, 2)
    upper_disp = round(c["upper_wick_pct"] * 100, 2)
    lower_disp = round(c["lower_wick_pct"] * 100, 2)
    ratio_disp = round(c["lower_wick_body_ratio"], 2)
    is_swing_low = _is_swing_low(bars, i)
    below_50 = _below_sma50(bars, i)
    decline_pct = _recent_decline_pct(bars, i) * 100

    # Levels
    entry = round(c["high"] * 1.001, 2)
    stop = round(c["low"] * 0.985, 2)
    measured = c["high"] + 2 * c["body"]
    near_res = context.get("nearest_resistance")
    if near_res and near_res > entry:
        target = round(min(near_res, measured), 2)
        target_basis = "nearest_resistance_or_2x_body_measured_move"
    else:
        target = round(measured, 2)
        target_basis = "2x_body_measured_move"
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    # Volume context
    vol_ratio_disp = "unavailable"
    if i >= 1:
        lookback = bars[max(0, i - 20):i]
        if lookback:
            avg_vol = sum(b["v"] for b in lookback) / len(lookback)
            if avg_vol > 0:
                vol_ratio_disp = f"{bar['v'] / avg_vol:.2f}x"

    # Position phrase
    if is_swing_low:
        position_phrase = "at a near-term swing low"
    elif below_50:
        position_phrase = "below the 50-bar SMA after recent decline"
    elif decline_pct >= 5.0:
        position_phrase = f"following a {decline_pct:.1f}% recent pullback"
    else:
        position_phrase = "without a clear preceding downmove"

    stage_phrase = _trend_phrase(context)
    ma_phrase = _ma_phrase(context)
    rs_phrase = _rs_phrase(context)
    color_word = "green" if c["is_green"] else "red"
    regime = context.get("regime", "current")

    anchors = [{"t": int(bar["t"]), "price": float(bar["c"])}]
    now = int(time.time())

    headline = (
        f"Hammer ({color_word}) {position_phrase} - body {body_disp}% of range, "
        f"lower wick {lower_disp}% ({ratio_disp}x body), upper wick {upper_disp}%."
    )

    what_it_is = (
        f"The Hammer is the most recognizable bullish single-candle reversal in the "
        f"Japanese-candlestick lexicon, first systematically described by Steve Nison in "
        f"'Japanese Candlestick Charting Techniques' (1991) but rooted in Munehisa Homma's "
        f"18th-century Sakata rice trading rules. Anatomically it is a candle where price "
        f"opened, was driven significantly lower during the session, and then closed back "
        f"near the open - leaving a long lower wick, a small body at the top of the range, "
        f"and almost no upper wick. Here the lower wick measures {lower_disp}% of the bar's "
        f"{c['total_range']:.2f}-point range (versus the body's {body_disp}%, a "
        f"{ratio_disp}x ratio that easily clears the 2x minimum), and the upper wick is "
        f"compressed to just {upper_disp}% - the textbook silhouette. The candle is "
        f"{color_word} ({'close > open, modestly stronger' if c['is_green'] else 'close < open, valid but weaker than a green hammer'}). "
        f"Visually the bar forges a 'hammer' under price: sellers drove the session lower, "
        f"buyers absorbed the drop, and by the bell the rejection was complete. The pattern "
        f"prints on volume of {vol_ratio_disp} the 20-bar average. Greg Morris's "
        f"'Candlestick Charting Explained' — the modern interpretive guide that translated "
        f"Sakata-era reading rules into a probability framework — frames the hammer as one "
        f"of the highest-edge single-bar reversal signals when the lower wick is at least "
        f"twice the body and prior trend is clearly down. Linda Raschke uses the hammer-at-"
        f"swing-low plus positive RSI divergence as her signature reversal combo, treating "
        f"the candle as the timing trigger inside a broader confluence read."
    )

    why_it_matters = (
        f"Context elevates this hammer from random anatomy to a tradeable signal. It "
        f"appears {position_phrase}, inside {stage_phrase} with {ma_phrase} moving-average "
        f"alignment and {rs_phrase} relative strength against the broader tape. The "
        f"hammer's edge comes from what it reveals about supply and demand: somewhere "
        f"inside the session the lower wick (low at ${c['low']:.2f}) was the prevailing "
        f"sentiment, but by close ({c['close']:.2f}) buyers had completely retraced that "
        f"effort - a {((c['close'] - c['low']) / c['low'] * 100):.1f}% recovery from the "
        f"intraday low. That is a fingerprint of accumulation: real buyers (institutional "
        f"or otherwise) showed up at the low, defended it, and ran price back to the open. "
        f"Volume of {vol_ratio_disp} the 20-bar average is the corroborating evidence - "
        f"heavy-volume hammers carry institutional weight, while light-volume hammers may "
        f"be technical buying in thin tape. Hammers printed after a recent decline (here "
        f"the recent 15-bar drawdown is {decline_pct:.1f}%) or at a structural support are "
        f"statistically the highest-conviction setups, because the reversal candle aligns "
        f"with a level at which buyers had reason to defend. Current regime is {regime}, "
        f"which calibrates how aggressive position sizing should be on a single-bar signal."
    )

    what_to_watch_for = (
        f"Hammers REQUIRE next-bar confirmation - Nison's repeated warning. The trigger is "
        f"a close above ${entry:.2f} (the hammer's high plus a 0.1% buffer) on the next "
        f"bar, ideally on volume of 1.3x+ the 20-bar average. Watch for: "
        f"(1) confirmation-bar close in the upper third of its range (weak close = weak "
        f"confirmation); "
        f"(2) the confirmation bar's low staying above the hammer's CLOSE (${c['close']:.2f}) - "
        f"if the next bar undercuts the hammer's body, the rejection is incomplete and the "
        f"trade is suspect; "
        f"(3) volume on the confirmation bar should EXPAND, not contract - shrinking volume "
        f"into the trigger means the buyers who showed up on the hammer didn't follow "
        f"through with conviction; "
        f"(4) if 1-2 bars after the hammer trade entirely within the hammer's range, the "
        f"signal is in suspended animation - don't preempt the confirmation. Levels: entry "
        f"${entry:.2f}, stop ${stop:.2f} (basis: hammer low minus 1.5%, "
        f"{stop_distance_pct:.1f}% adverse move from entry), target ${target:.2f} "
        f"(basis: {target_basis}), R:R {rr:.2f}. The measured target uses 2x the body as "
        f"a minimum projection - if a nearby resistance level "
        f"({'$' + format(near_res, '.2f') if near_res else 'none mapped'}) "
        f"caps the move sooner, take partials there. The clean follow-through is the next "
        f"2-3 bars closing higher and never re-entering the lower wick range "
        f"(${c['low']:.2f} to ${c['close']:.2f})."
    )

    failure_signal = (
        f"Single-candle reversals fail more often than retail chart readers admit. The "
        f"hammer is invalidated if the next bar closes BACK BELOW the hammer's low at "
        f"${c['low']:.2f} (stop set at ${stop:.2f}, 1.5% below) - that signals the rejection "
        f"was false and sellers have reclaimed control; exit immediately, no second-guessing. "
        f"More insidious failure modes: "
        f"(1) the confirmation bar closes above entry but on weak/declining volume - this is "
        f"the 'fake-out' hammer and the next 1-3 bars often retrace the trigger and break "
        f"the hammer low; "
        f"(2) the hammer prints inside a strong downtrend (Stage 4 + stacked-bearish MA + "
        f"falling RS) where every minor rally has been sold - in that regime the hammer is "
        f"a pause, not a reversal, and the burden of proof on confirmation should rise; "
        f"(3) the hammer at resistance (not support) - if the hammer's high tags a known "
        f"resistance level, the bullish read is materially weakened because the next bar "
        f"has supply overhead to clear before any meaningful continuation. Position sizing "
        f"must reflect the {stop_distance_pct:.1f}% stop distance: risking 0.5% of account "
        f"on this trade implies a position size of roughly "
        f"{(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat the hammer as "
        f"a SETUP, never as a trigger - the next bar fires the trigger, the stop saves the "
        f"account when the probability inevitably misses, and the position size reflects the "
        f"reality that single-candle patterns are probability shifters, not crystal balls."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Hammer",
        "category": "candlestick",
        "direction": "bullish",
        "start_t": int(bar["t"]),
        "end_t": int(bar["t"]),
        "pivot_ts": [int(bar["t"])],
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": {
                "body_pct": float(round(c["body"] / max(c["close"], 0.0001), 4)),
                "body_to_range_ratio": float(round(c["body_to_range"], 4)),
                "upper_wick_pct": float(round(c["upper_wick_pct"], 4)),
                "lower_wick_pct": float(round(c["lower_wick_pct"], 4)),
                "lower_wick_body_ratio": float(round(c["lower_wick_body_ratio"], 4)),
                "total_range": float(round(c["total_range"], 4)),
                "is_green": bool(c["is_green"]),
                "at_swing_low": bool(is_swing_low),
                "below_50sma": bool(below_50),
                "recent_decline_pct": float(round(decline_pct, 2)),
            },
        },
        "levels": {
            "entry": float(entry),
            "entry_condition": f"close > {entry:.2f} on next bar with volume >= 1.3x 20-bar avg",
            "stop": float(stop),
            "stop_basis": "hammer_low_minus_1.5pct",
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


register(_PATTERN_ID, detect_hammer)
