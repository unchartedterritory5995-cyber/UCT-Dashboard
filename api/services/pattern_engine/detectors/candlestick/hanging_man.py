"""Hanging Man candlestick detector.

The Hanging Man is anatomically identical to the Hammer but appears in the
OPPOSITE context: at a swing high after a sustained advance, rather than at a
swing low after a decline. Same long lower wick, same small body, same suppressed
upper wick - but the location flips the meaning from bullish reversal (hammer)
to bearish reversal warning (hanging man).

Steve Nison emphasizes this is the most commonly mis-classified candlestick
pattern: traders see the silhouette and call it a hammer without checking the
trend context. The hanging man tells a chilling story: even at the highs of a
rally, sellers were able to push price meaningfully lower intraday, and only
late-session buying pulled it back to the open. That late-session bid is often
short-covering, not new accumulation - and the next bar can fail dramatically.

Definition (geometry - same as hammer):
  - lower_wick >= 2 x body
  - upper_wick <= 0.5 x body
  - body_to_range <= 0.35

Context (the qualifying filter):
  - Hanging man must appear at a swing high OR after a recent advance:
      * close > 50-bar SMA AND
      * recent action made a 20-bar high within the last 5 bars

Direction: bearish.
Confirmation: the NEXT bar must close LOWER (below the hanging man's low).
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "hanging_man"
_MIN_BARS = 6
_LOWER_WICK_BODY_MULT = 2.0
_UPPER_WICK_BODY_MULT = 0.5
_BODY_TO_RANGE_MAX = 0.35
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_CONFIDENCE_FLOOR = 50.0


def detect_hanging_man(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect hanging man candles. Emits 0 or 1 Detection (most recent firing)."""
    if len(bars) < _MIN_BARS:
        return []

    detections: List[Detection] = []
    start = max(0, len(bars) - _SCAN_LOOKBACK)
    for i in range(start, len(bars)):
        candidate = _try_extract(bars, i)
        if candidate is None:
            continue

        # HARD CONTEXT GATE: hanging man requires swing-high OR recent-advance context.
        # Without that, it's just a hammer and the hammer detector handles it.
        if not _is_in_advance_context(bars, i, context):
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


def _is_swing_high(bars: List[Bar], i: int) -> bool:
    lookback = bars[max(0, i - _SWING_LOOKBACK):i + 1]
    if len(lookback) < 4:
        return False
    high_max = max(b["h"] for b in lookback)
    low_min = min(b["l"] for b in lookback)
    rng = high_max - low_min
    if rng <= 0:
        return False
    bar_high = bars[i]["h"]
    return (high_max - bar_high) / rng <= 0.05


def _above_sma50(bars: List[Bar], i: int) -> bool:
    if i < 49:
        return False
    closes = [b["c"] for b in bars[i - 49:i + 1]]
    if not closes:
        return False
    sma = sum(closes) / len(closes)
    return bars[i]["c"] > sma


def _recent_20bar_high(bars: List[Bar], i: int, recency_bars: int = 5) -> bool:
    """Was a 20-bar high made within the last `recency_bars` bars (inclusive of i)?"""
    if i < 19:
        return False
    window = bars[max(0, i - 19):i + 1]
    window_high = max(b["h"] for b in window)
    # Find which bar made the high
    recent = bars[max(0, i - recency_bars + 1):i + 1]
    return any(b["h"] >= window_high * 0.999 for b in recent)


def _recent_advance_pct(bars: List[Bar], i: int) -> float:
    """% advance from recent 15-bar low to current high (positive = rally)."""
    start = max(0, i - 14)
    window = bars[start:i + 1]
    if not window:
        return 0.0
    low = min(b["l"] for b in window)
    high_now = bars[i]["h"]
    if low <= 0:
        return 0.0
    return (high_now - low) / low


def _is_in_advance_context(bars: List[Bar], i: int, context: dict) -> bool:
    """Hanging man requires swing-high OR (above 50sma AND recent 20-bar high)."""
    if _is_swing_high(bars, i):
        return True
    if _above_sma50(bars, i) and _recent_20bar_high(bars, i):
        return True
    if _recent_advance_pct(bars, i) >= 0.10 and context.get("trend_stage") in (2, 3):
        return True
    return False


def _score_geometry(c: dict) -> float:
    ratio = c["lower_wick_body_ratio"]
    if ratio >= 4.0:
        wick_score = 100.0
    elif ratio >= 3.0:
        wick_score = 75.0 + (ratio - 3.0) / 1.0 * 25.0
    elif ratio >= 2.0:
        wick_score = 30.0 + (ratio - 2.0) / 1.0 * 45.0
    else:
        wick_score = 0.0

    btr = c["body_to_range"]
    if btr <= 0.15:
        body_score = 100.0
    elif btr <= 0.25:
        body_score = 70.0 + (0.25 - btr) / 0.10 * 30.0
    else:
        body_score = max(0.0, (0.35 - btr) / 0.10 * 70.0)

    uwp = c["upper_wick_pct"]
    if uwp <= 0.03:
        upper_score = 100.0
    elif uwp <= 0.08:
        upper_score = 60.0 + (0.08 - uwp) / 0.05 * 40.0
    else:
        upper_score = max(0.0, (0.15 - uwp) / 0.07 * 60.0)

    # RED hanging man is more bearish than green (opposite of hammer)
    color_bonus = 5.0 if not c["is_green"] else 0.0

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
    # High volume on the hanging man = potential distribution signature
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
    if _is_swing_high(bars, i):
        score += 35
    if _above_sma50(bars, i):
        score += 15
    if _recent_20bar_high(bars, i):
        score += 10
    advance = _recent_advance_pct(bars, i)
    if advance >= 0.15:
        score += 15
    elif advance >= 0.08:
        score += 8

    res = context.get("nearest_resistance")
    if res and res > 0 and abs(bars[i]["h"] - res) / res <= 0.015:
        score += 10

    stage = context.get("trend_stage")
    if stage in (2, 3):
        score += 5  # uptrend/distribution — reversal-friendly context

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
    is_swing_high = _is_swing_high(bars, i)
    above_50 = _above_sma50(bars, i)
    recent_high = _recent_20bar_high(bars, i)
    advance_pct = _recent_advance_pct(bars, i) * 100

    # Levels — bearish trade
    entry = round(c["low"] * 0.999, 2)
    stop = round(c["high"] * 1.015, 2)
    measured = c["low"] - 2 * c["body"]
    near_sup = context.get("nearest_support")
    if near_sup and near_sup < entry:
        target = round(max(near_sup, measured), 2)
        target_basis = "nearest_support_or_2x_body_measured_move_down"
    else:
        target = round(measured, 2)
        target_basis = "2x_body_measured_move_down"
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0
    stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

    vol_ratio_disp = "unavailable"
    if i >= 1:
        lookback = bars[max(0, i - 20):i]
        if lookback:
            avg_vol = sum(b["v"] for b in lookback) / len(lookback)
            if avg_vol > 0:
                vol_ratio_disp = f"{bar['v'] / avg_vol:.2f}x"

    if is_swing_high:
        position_phrase = "at a near-term swing high"
    elif above_50 and recent_high:
        position_phrase = "above the 50-bar SMA with a fresh 20-bar high in the rear-view"
    elif advance_pct >= 8.0:
        position_phrase = f"following a {advance_pct:.1f}% recent advance"
    else:
        position_phrase = "in an extended posture after recent strength"

    stage_phrase = _trend_phrase(context)
    ma_phrase = _ma_phrase(context)
    rs_phrase = _rs_phrase(context)
    color_word = "red" if not c["is_green"] else "green"
    regime = context.get("regime", "current")

    anchors = [{"t": int(bar["t"]), "price": float(bar["c"])}]
    now = int(time.time())

    headline = (
        f"Hanging Man ({color_word}) {position_phrase} - body {body_disp}% of range, "
        f"lower wick {lower_disp}% ({ratio_disp}x body), upper wick {upper_disp}%."
    )

    what_it_is = (
        f"The Hanging Man is anatomically identical to the Hammer but appears in the "
        f"OPPOSITE context - and that difference completely reverses its meaning. Steve "
        f"Nison, in 'Japanese Candlestick Charting Techniques' (1991), pulled this pattern "
        f"directly from Munehisa Homma's 18th-century Sakata rules and stressed repeatedly "
        f"that the hammer/hanging-man distinction is the most common rookie misclassification "
        f"in candlestick analysis: same silhouette, opposite context, opposite implication. "
        f"Here the bar prints a long lower wick of {lower_disp}% of its {c['total_range']:.2f}-"
        f"point range ({ratio_disp}x the body), a small body of just {body_disp}% near the "
        f"top of the range, and a suppressed upper wick of {upper_disp}% - the textbook "
        f"hammer silhouette. But unlike a hammer at a swing low, this candle appears "
        f"{position_phrase}, and that location flips the interpretation. The story the bar "
        f"tells is unsettling: even at the highs of the recent advance, sellers were able "
        f"to push price significantly lower intraday (low ${c['low']:.2f}, "
        f"{((c['high'] - c['low']) / c['high'] * 100):.1f}% below the high), and only "
        f"late-session buying retraced the move back near the open. That late buying is "
        f"often weak-handed short-covering or stop-runs, not the kind of new institutional "
        f"accumulation that powers the next leg up. The pattern is {color_word} "
        f"({'close < open, the stronger bearish read' if not c['is_green'] else 'close > open, valid but weaker than a red hanging man'}), "
        f"printed on volume of {vol_ratio_disp} the 20-bar average."
    )

    why_it_matters = (
        f"This hanging man appears inside {stage_phrase} with {ma_phrase} moving-average "
        f"alignment and {rs_phrase} relative strength. The context score reflects all of "
        f"the bearish-reversal qualifiers - swing-high proximity, above-50SMA posture, "
        f"recent 20-bar high freshness, and recent advance magnitude of {advance_pct:.1f}%. "
        f"What the pattern reveals about supply and demand is the critical content: even "
        f"buyers who were eager enough to chase price to the recent highs were unable to "
        f"prevent intraday sellers from gunning the stock {((c['high'] - c['low']) / c['high'] * 100):.1f}% "
        f"off the high. The {((c['close'] - c['low']) / c['low'] * 100):.1f}% recovery from "
        f"the intraday low looks bullish in isolation but, in this context, often masks "
        f"distribution - large holders are using the late-session bid to offload size to "
        f"newly-arriving longs. Volume of {vol_ratio_disp} the 20-bar average is the "
        f"corroborating evidence: a heavy-volume hanging man at the highs carries the "
        f"distributive fingerprint, while a light-volume version may just be a pause in the "
        f"trend. Nison emphasized that the hanging man is a WARNING, not an automatic sell - "
        f"it raises the burden of proof on the next bar to confirm or deny the bearish read. "
        f"Current regime is {regime}, which calibrates how aggressively to act on a "
        f"single-bar warning."
    )

    what_to_watch_for = (
        f"Hanging man signals require next-bar bearish confirmation - a close BELOW "
        f"${entry:.2f} (the hanging man's low minus a 0.1% buffer) on the next bar, "
        f"ideally on volume of 1.3x+ the 20-bar average. Watch for: "
        f"(1) confirmation-bar close in the lower third of its range (weak close = weak "
        f"confirmation, even if entry is pierced intraday); "
        f"(2) the confirmation bar's high staying below the hanging man's CLOSE "
        f"(${c['close']:.2f}) - if the next bar lifts back into the hanging man's body, "
        f"the bearish read is incomplete and the short is suspect; "
        f"(3) volume on the confirmation bar should EXPAND - distribution bars carry "
        f"heavier volume than light buying; "
        f"(4) if 1-2 bars after the hanging man trade entirely within its range, the signal "
        f"is in suspended animation - don't preempt the confirmation. Levels: entry "
        f"${entry:.2f}, stop ${stop:.2f} (basis: hanging man high plus 1.5%, "
        f"{stop_distance_pct:.1f}% adverse move from entry), target ${target:.2f} "
        f"(basis: {target_basis}), R:R {rr:.2f}. Nison's clean follow-through is the next "
        f"2-3 bars closing lower and never re-entering the hanging man body range "
        f"(${c['close']:.2f} to ${c['open']:.2f}). If the trade is in an account that doesn't "
        f"short, the hanging man can be used as a defensive exit signal on long positions - "
        f"sell into the next bar's open, take partial profits, or tighten the stop."
    )

    failure_signal = (
        f"The hanging man is invalidated if the next bar closes BACK ABOVE the hanging "
        f"man's high at ${c['high']:.2f} (stop set at ${stop:.2f}, 1.5% above) - that "
        f"signals the late-session buying was real demand, not distribution, and the "
        f"uptrend has reasserted control; cover the short immediately, no second-guessing. "
        f"More insidious failure modes specific to hanging man: "
        f"(1) the pattern appears in a runaway uptrend where every minor weakness has been "
        f"absorbed - in that regime the hanging man is a pause, not a top, and trying to "
        f"short the high is statistically a losing trade until the broader trend rolls; "
        f"(2) confirmation comes on a tiny inside bar - the signal is in suspended animation "
        f"and the trade is premature; "
        f"(3) the hanging man at a structural BASE (not resistance) - if the long lower "
        f"wick tagged a known support level, the bullish read of that level often dominates "
        f"the bearish read of the candle pattern, and the next bar can break upward instead "
        f"of down. Position sizing must reflect the {stop_distance_pct:.1f}% stop distance: "
        f"risking 0.5% of account on this short implies a position size of roughly "
        f"{(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat the hanging man "
        f"as a WARNING and a SETUP, never as a trigger - the next bar fires the trigger, "
        f"the stop saves the account when the rally resumes, and the position size reflects "
        f"the reality that single-candle bearish patterns in strong uptrends fail more often "
        f"than they succeed. Discipline on the stop is the difference between a small loss "
        f"on a hanging man fade and a disastrous one fighting an uptrend that hasn't ended."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Hanging Man",
        "category": "candlestick",
        "direction": "bearish",
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
                "at_swing_high": bool(is_swing_high),
                "above_50sma": bool(above_50),
                "recent_20bar_high": bool(recent_high),
                "recent_advance_pct": float(round(advance_pct, 2)),
            },
        },
        "levels": {
            "entry": float(entry),
            "entry_condition": f"close < {entry:.2f} on next bar with volume >= 1.3x 20-bar avg",
            "stop": float(stop),
            "stop_basis": "hanging_man_high_plus_1.5pct",
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


register(_PATTERN_ID, detect_hanging_man)
