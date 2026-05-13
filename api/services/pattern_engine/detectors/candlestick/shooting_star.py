"""Shooting Star candlestick detector.

The Shooting Star is the bearish-reversal mirror of the Hammer: long upper wick,
small body near the bottom of the range, suppressed lower wick - and crucially,
appearing at a swing high or after a sustained advance. The visual is a falling
star, igniting briefly at the highs before plunging back. Where the hammer
forges a floor under price after a decline, the shooting star slams a ceiling
on top of an advance.

Steve Nison codified the shooting star in 'Japanese Candlestick Charting
Techniques' (1991), tracing its lineage back to Munehisa Homma's 18th-century
Sakata rice trading rules. The pattern's psychology is sharp and visual: buyers
chased price up to the session high (long upper wick), but sellers ambushed
them and forced the close back down near the open. That dramatic intraday
rejection at the highs is the bearish signal.

Definition (geometry):
  - upper_wick >= 2 x body
  - lower_wick <= 0.5 x body
  - body_to_range <= 0.35

Context (qualifying filter):
  - Shooting star must appear at a swing high OR after a recent advance
    (close > 50-bar SMA and recent 20-bar high made within last 5 bars)

Direction: bearish.
Confirmation: the NEXT bar must close LOWER (below the shooting star's low).
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "shooting_star"
_MIN_BARS = 6
_UPPER_WICK_BODY_MULT = 2.0
_LOWER_WICK_BODY_MULT = 0.5
_BODY_TO_RANGE_MAX = 0.35
_SCAN_LOOKBACK = 5
_SWING_LOOKBACK = 10
_CONFIDENCE_FLOOR = 50.0


def detect_shooting_star(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect shooting star candles. Emits 0 or 1 Detection (most recent firing)."""
    if len(bars) < _MIN_BARS:
        return []

    detections: List[Detection] = []
    start = max(0, len(bars) - _SCAN_LOOKBACK)
    for i in range(start, len(bars)):
        candidate = _try_extract(bars, i)
        if candidate is None:
            continue

        # HARD CONTEXT GATE: shooting star must be at a swing high or after advance
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
    if upper_wick < _UPPER_WICK_BODY_MULT * body:
        return None
    if lower_wick > _LOWER_WICK_BODY_MULT * body:
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
        "upper_wick_body_ratio": upper_wick / body if body > 0 else 0.0,
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
    if i < 19:
        return False
    window = bars[max(0, i - 19):i + 1]
    window_high = max(b["h"] for b in window)
    recent = bars[max(0, i - recency_bars + 1):i + 1]
    return any(b["h"] >= window_high * 0.999 for b in recent)


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


def _is_in_advance_context(bars: List[Bar], i: int, context: dict) -> bool:
    if _is_swing_high(bars, i):
        return True
    if _above_sma50(bars, i) and _recent_20bar_high(bars, i):
        return True
    if _recent_advance_pct(bars, i) >= 0.10 and context.get("trend_stage") in (2, 3):
        return True
    return False


def _score_geometry(c: dict) -> float:
    ratio = c["upper_wick_body_ratio"]
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

    lwp = c["lower_wick_pct"]
    if lwp <= 0.03:
        lower_score = 100.0
    elif lwp <= 0.08:
        lower_score = 60.0 + (0.08 - lwp) / 0.05 * 40.0
    else:
        lower_score = max(0.0, (0.15 - lwp) / 0.07 * 60.0)

    # Red shooting star (close < open) is more bearish than green
    color_bonus = 5.0 if not c["is_green"] else 0.0

    return round(min(100.0, 0.45 * wick_score + 0.30 * body_score + 0.25 * lower_score + color_bonus), 2)


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
    bar = c["bar"]
    body_disp = round(c["body_to_range"] * 100, 2)
    upper_disp = round(c["upper_wick_pct"] * 100, 2)
    lower_disp = round(c["lower_wick_pct"] * 100, 2)
    ratio_disp = round(c["upper_wick_body_ratio"], 2)
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
        f"Shooting Star ({color_word}) {position_phrase} - body {body_disp}% of range, "
        f"upper wick {upper_disp}% ({ratio_disp}x body), lower wick {lower_disp}%."
    )

    what_it_is = (
        f"The Shooting Star is the bearish-reversal mirror of the Hammer in Steve Nison's "
        f"'Japanese Candlestick Charting Techniques' (1991), traceable to Munehisa Homma's "
        f"18th-century Sakata rules. Anatomically it is a candle where price opened, was "
        f"driven aggressively HIGHER during the session (long upper wick to ${c['high']:.2f}, "
        f"{((c['high'] - c['low']) / c['low'] * 100):.1f}% above the session low), and "
        f"then closed near the open - leaving a long upper wick of {upper_disp}% of the "
        f"{c['total_range']:.2f}-point range ({ratio_disp}x the body, easily clearing the "
        f"2x minimum), a small body of just {body_disp}% near the bottom of the range, and "
        f"a compressed lower wick of {lower_disp}%. The candle is {color_word} "
        f"({'close < open, the stronger bearish read' if not c['is_green'] else 'close > open, valid but weaker than a red shooting star'}). "
        f"Visually the bar looks like a falling star: buyers fired the rocket up to the "
        f"session high, sellers ambushed them, and the close came right back down to where "
        f"the bar opened. That dramatic intraday rejection at the highs - especially when "
        f"printed {position_phrase} - is the bearish signature. The pattern prints on "
        f"volume of {vol_ratio_disp} the 20-bar average, which is the corroborating evidence "
        f"for whether the rejection was institutional supply or just light-volume air. "
        f"Greg Morris's 'Candlestick Charting Explained' frames the shooting star as one of "
        f"the cleanest single-bar bearish reversal signals when it prints at established "
        f"resistance, requiring an upper-wick-to-body ratio of at least 2x and a confirming "
        f"red close the next session. Linda Raschke uses shooting star at resistance + "
        f"volume divergence (price tagging a new high while volume fades) as her signature "
        f"short-side reversal combo, treating the candle as the timing trigger inside a "
        f"broader bearish confluence read."
    )

    why_it_matters = (
        f"This shooting star appears inside {stage_phrase} with {ma_phrase} moving-average "
        f"alignment and {rs_phrase} relative strength. The context score weighs every "
        f"bearish-reversal qualifier - swing-high proximity, above-50SMA posture, recent "
        f"20-bar high freshness, and recent advance magnitude of {advance_pct:.1f}%. The "
        f"supply/demand reveal is the critical content: somewhere intraday, buyers were "
        f"motivated enough to chase price to ${c['high']:.2f}, but sellers met that chase "
        f"with overwhelming supply and forced the close back down to ${c['close']:.2f} - a "
        f"{((c['high'] - c['close']) / c['high'] * 100):.1f}% retracement of the intraday "
        f"high. That is a textbook distribution fingerprint: large holders use the "
        f"buyer-driven spike to offload size into the strength, and by close the entire "
        f"effort is retraced. Volume of {vol_ratio_disp} the 20-bar average corroborates - "
        f"heavy-volume shooting stars at the highs carry the distributive fingerprint, "
        f"light-volume versions are more equivocal. Nison stressed that the shooting star "
        f"derives its edge from CONTEXT - the same anatomy in the middle of a chop range "
        f"or after a clean Stage 4 base would be uninteresting. Here the location elevates "
        f"the signal from anatomical curiosity to actionable warning. Current regime is "
        f"{regime}, which calibrates how aggressively to size a short on a single-bar signal."
    )

    what_to_watch_for = (
        f"Shooting star signals require next-bar bearish confirmation - the trigger is a "
        f"close BELOW ${entry:.2f} (the shooting star's low minus a 0.1% buffer) on the "
        f"next bar, ideally on volume of 1.3x+ the 20-bar average. Watch for: "
        f"(1) confirmation-bar close in the lower third of its range - a weak close above "
        f"that level is a weak confirmation even if entry is pierced intraday; "
        f"(2) the confirmation bar's high staying below the shooting star's CLOSE "
        f"(${c['close']:.2f}) - if the next bar lifts back into the shooting star's body, "
        f"the bearish read is incomplete; "
        f"(3) volume on the confirmation bar should EXPAND - distribution bars carry "
        f"heavier volume than residual buying; "
        f"(4) if 1-2 bars after the shooting star trade entirely within its range, the "
        f"signal is in suspended animation - don't preempt the confirmation. Levels: entry "
        f"${entry:.2f}, stop ${stop:.2f} (basis: shooting star high plus 1.5%, "
        f"{stop_distance_pct:.1f}% adverse move from entry), target ${target:.2f} "
        f"(basis: {target_basis}), R:R {rr:.2f}. The measured target uses 2x the body as a "
        f"minimum downside projection - if a nearby support level caps the move sooner, "
        f"take partials there. Nison's clean follow-through is the next 2-3 bars closing "
        f"lower and never re-entering the upper wick range (${c['close']:.2f} to "
        f"${c['high']:.2f}). For non-shorting accounts, the shooting star is also a "
        f"defensive exit signal on long positions - sell into the next bar's open or "
        f"tighten the stop aggressively."
    )

    failure_signal = (
        f"The shooting star is invalidated if the next bar closes BACK ABOVE the shooting "
        f"star's high at ${c['high']:.2f} (stop set at ${stop:.2f}, 1.5% above) - that "
        f"signals the intraday rejection was a temporary supply event, not the start of "
        f"a top, and the uptrend has reasserted control; cover the short immediately, no "
        f"second-guessing. Common failure modes: "
        f"(1) the shooting star prints in a runaway uptrend where every wick has been "
        f"bought - the next bar simply absorbs the rejection and the trend continues "
        f"higher, leaving the bear with a losing short into strength; "
        f"(2) the confirmation comes on a tiny inside bar - the signal is in suspended "
        f"animation and the short is premature; "
        f"(3) the shooting star at a structural BREAKOUT level - if the upper wick tagged "
        f"a known resistance and then RECLAIMED it on the next bar's close, the pattern "
        f"flips from bearish reversal to bullish-breakout retest; "
        f"(4) the next bar gaps lower BELOW entry on news but immediately reverses and "
        f"closes above the shooting star's high - this is the 'fake breakdown' trap that "
        f"stops out bears at the worst possible price. Position sizing must reflect the "
        f"{stop_distance_pct:.1f}% stop distance: risking 0.5% of account on this short "
        f"implies a position size of roughly "
        f"{(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat the shooting "
        f"star as a WARNING and a SETUP, never as a trigger - the next bar fires the "
        f"trigger, the stop saves the account when the rally resumes, and the position "
        f"size reflects the reality that single-candle bearish patterns in strong uptrends "
        f"fail more often than they succeed. Discipline on the stop is the difference "
        f"between a small loss on a shooting star fade and a disastrous one fighting a "
        f"trend that hasn't actually ended."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Shooting Star",
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
                "upper_wick_body_ratio": float(round(c["upper_wick_body_ratio"], 4)),
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
            "stop_basis": "shooting_star_high_plus_1.5pct",
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


register(_PATTERN_ID, detect_shooting_star)
