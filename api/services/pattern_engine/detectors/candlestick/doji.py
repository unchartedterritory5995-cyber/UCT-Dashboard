"""Doji candlestick detector.

The Doji is the foundational indecision candle of Japanese candlestick analysis.
First codified in writing by Steve Nison's 1991 work "Japanese Candlestick Charting
Techniques" but tracing its lineage back to Munehisa Homma's 18th-century Sakata rice
trading, the Doji marks the moment in a session where the opening and closing prices
converged to essentially the same level - the bulls and bears finished the bar dead
even. The body shrinks to a sliver and what's left are the wicks, which encode the
intra-bar struggle.

Definition (geometry):
  - body / total_range < 0.05  (body is <5% of the bar's range)
  - Four variants identified by wick anatomy:
      * standard:     both wicks >=10% of range, neither dominates
      * long_legged:  both upper + lower wicks >=30% of range - major indecision
      * dragonfly:    upper wick <5% of range, lower wick >=60% of range (bullish bias)
      * gravestone:   lower wick <5% of range, upper wick >=60% of range (bearish bias)

Context matters more than anatomy:
  - A doji at a swing high (especially gravestone) = potential bearish reversal
  - A doji at a swing low (especially dragonfly)   = potential bullish reversal
  - A doji near a nearest_resistance / support level = the level is being tested
  - A doji deep inside a chop range = noise, not a signal

Direction is "neutral" at the detector level - the dominant variant determines
directional bias and the entry/stop/target levels.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional, Tuple

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "doji"
_MIN_BARS = 6                       # need a few bars for swing-context detection
_BODY_RATIO_MAX = 0.05              # doji = body < 5% of range
_LONG_LEGGED_MIN_WICK = 0.30        # both wicks >=30% = long-legged
_STANDARD_MIN_WICK = 0.10           # both wicks >=10% = standard
_DRAGONFLY_UPPER_MAX = 0.05         # dragonfly: upper wick <5%
_DRAGONFLY_LOWER_MIN = 0.60         # dragonfly: lower wick >=60%
_GRAVESTONE_LOWER_MAX = 0.05        # gravestone: lower wick <5%
_GRAVESTONE_UPPER_MIN = 0.60        # gravestone: upper wick >=60%
_SCAN_LOOKBACK = 5                  # scan last 5 bars for the most recent doji
_SWING_LOOKBACK = 10                # how many bars to look back for swing context
_CONFIDENCE_FLOOR = 50.0


def detect_doji(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect doji candles. Emits 0 or 1 Detection (the most recent firing)."""
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
    # Most recent firing wins
    return detections[-1:]


def _try_extract(bars: List[Bar], i: int) -> Optional[dict]:
    """Extract doji candidate at bar index i if anatomy qualifies."""
    bar = bars[i]
    o, h, l, c = bar["o"], bar["h"], bar["l"], bar["c"]
    total_range = h - l
    if total_range <= 0:
        return None

    body = abs(c - o)
    body_to_range = body / total_range
    if body_to_range >= _BODY_RATIO_MAX:
        return None

    body_top = max(o, c)
    body_bot = min(o, c)
    upper_wick = h - body_top
    lower_wick = body_bot - l
    upper_wick_pct = upper_wick / total_range
    lower_wick_pct = lower_wick / total_range

    variant = _classify_variant(upper_wick_pct, lower_wick_pct)
    if variant is None:
        return None

    body_pct = body / max(c, 0.0001)  # body as % of close price (sanity)

    return {
        "bar": bar,
        "bar_idx": i,
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "total_range": total_range,
        "body": body,
        "body_to_range": body_to_range,
        "body_pct_of_price": body_pct,
        "upper_wick": upper_wick,
        "lower_wick": lower_wick,
        "upper_wick_pct": upper_wick_pct,
        "lower_wick_pct": lower_wick_pct,
        "variant": variant,
    }


def _classify_variant(upper_pct: float, lower_pct: float) -> Optional[str]:
    """Classify the doji variant by wick anatomy.

    Order of checks is deliberate - more specific (dragonfly/gravestone) before
    more general (long_legged, standard).
    """
    if upper_pct < _DRAGONFLY_UPPER_MAX and lower_pct >= _DRAGONFLY_LOWER_MIN:
        return "dragonfly"
    if lower_pct < _GRAVESTONE_LOWER_MAX and upper_pct >= _GRAVESTONE_UPPER_MIN:
        return "gravestone"
    if upper_pct >= _LONG_LEGGED_MIN_WICK and lower_pct >= _LONG_LEGGED_MIN_WICK:
        return "long_legged"
    if upper_pct >= _STANDARD_MIN_WICK and lower_pct >= _STANDARD_MIN_WICK:
        return "standard"
    return None


def _is_swing_high(bars: List[Bar], i: int) -> bool:
    """Return True if bars[i] is near a 20-bar high (top 5% of recent range)."""
    lookback = bars[max(0, i - _SWING_LOOKBACK):i + 1]
    if len(lookback) < 4:
        return False
    high_max = max(b["h"] for b in lookback)
    low_min = min(b["l"] for b in lookback)
    rng = high_max - low_min
    if rng <= 0:
        return False
    bar_high = bars[i]["h"]
    # Within top 5% of the window's range
    return (high_max - bar_high) / rng <= 0.05


def _is_swing_low(bars: List[Bar], i: int) -> bool:
    """Return True if bars[i] is near a 20-bar low (bottom 5% of recent range)."""
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


def _near_resistance(context: dict, bar: Bar) -> bool:
    res = context.get("nearest_resistance")
    if res is None or res <= 0:
        return False
    return abs(bar["h"] - res) / res <= 0.015


def _near_support(context: dict, bar: Bar) -> bool:
    sup = context.get("nearest_support")
    if sup is None or sup <= 0:
        return False
    return abs(bar["l"] - sup) / sup <= 0.015


def _score_geometry(c: dict) -> float:
    """Tighter body and more extreme variant = higher geometry score."""
    # Body tightness: 0% = 100, 5% = 0
    body_ratio = c["body_to_range"]
    body_score = max(0.0, (0.05 - body_ratio) / 0.05 * 100)

    # Variant strength: dragonfly/gravestone are more directional
    variant = c["variant"]
    if variant in ("dragonfly", "gravestone"):
        variant_score = 100.0
    elif variant == "long_legged":
        variant_score = 80.0
    else:
        variant_score = 55.0

    # Wick magnitude — bigger wicks = more rejection signal
    max_wick_pct = max(c["upper_wick_pct"], c["lower_wick_pct"])
    if max_wick_pct >= 0.45:
        wick_score = 100.0
    elif max_wick_pct >= 0.30:
        wick_score = 75.0
    elif max_wick_pct >= 0.15:
        wick_score = 50.0
    else:
        wick_score = 25.0

    return round(0.40 * body_score + 0.30 * variant_score + 0.30 * wick_score, 2)


def _score_volume(bars: List[Bar], i: int) -> float:
    """Volume signature on the doji bar.

    Higher volume than the 20-bar average = institutional participation in the
    indecision = more meaningful. Very low volume = noise/illiquidity.
    """
    if i < 1:
        return 50.0
    lookback_start = max(0, i - 20)
    lookback = bars[lookback_start:i]
    if not lookback:
        return 50.0
    avg_vol = sum(b["v"] for b in lookback) / len(lookback)
    if avg_vol <= 0:
        return 50.0
    bar_vol = bars[i]["v"]
    ratio = bar_vol / avg_vol
    # 1.5x+ = 100, 1.0x = 60, 0.5x = 20
    if ratio >= 1.5:
        return 100.0
    if ratio >= 1.0:
        return 60.0 + (ratio - 1.0) / 0.5 * 40.0
    if ratio >= 0.5:
        return 20.0 + (ratio - 0.5) / 0.5 * 40.0
    return 20.0 * (ratio / 0.5)


def _score_context(context: dict, bars: List[Bar], i: int, candidate: dict) -> float:
    """Context score - reflects where the doji prints relative to S/R and swings.

    The doji is meaningful at extremes (highs/lows/S/R levels) - in the middle
    of a chop range it's noise.
    """
    score = 30.0
    variant = candidate["variant"]
    at_high = _is_swing_high(bars, i)
    at_low = _is_swing_low(bars, i)
    near_res = _near_resistance(context, candidate["bar"])
    near_sup = _near_support(context, candidate["bar"])

    # Variant + position alignment matters most
    if variant == "dragonfly" and (at_low or near_sup):
        score += 50
    elif variant == "gravestone" and (at_high or near_res):
        score += 50
    elif variant in ("standard", "long_legged") and (at_high or at_low):
        score += 30
    elif at_high or at_low:
        score += 20
    elif near_res or near_sup:
        score += 15

    # Trend stage alignment
    if variant == "dragonfly" and context.get("trend_stage") in (1, 4):
        score += 10  # bullish reversal context — basing or downtrend
    if variant == "gravestone" and context.get("trend_stage") in (2, 3):
        score += 10  # bearish reversal context — uptrend or distribution

    return min(100.0, score)


def _dominant_direction(variant: str) -> str:
    """Doji is neutral, but variants carry directional bias for level computation."""
    if variant == "dragonfly":
        return "bullish"
    if variant == "gravestone":
        return "bearish"
    return "neutral"


def _compute_levels(c: dict, context: dict) -> dict:
    """Compute entry/stop/target based on dominant variant."""
    variant = c["variant"]
    h, l = c["high"], c["low"]
    near_res = context.get("nearest_resistance")
    near_sup = context.get("nearest_support")

    if variant == "dragonfly":
        entry = round(h * 1.001, 2)
        stop = round(l * 0.99, 2)
        if near_res and near_res > entry:
            target = round(near_res, 2)
            target_basis = "nearest_resistance"
        else:
            target = round(h * 1.05, 2)
            target_basis = "5pct_measured_move"
        rr = (target - entry) / (entry - stop) if entry > stop else 0.0
        return {
            "direction_bias": "bullish",
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} (confirmation: next bar closes above doji high)",
            "stop": stop,
            "stop_basis": "doji_low_minus_1pct",
            "target_primary": target,
            "target_basis": target_basis,
            "risk_reward": round(rr, 2),
        }
    if variant == "gravestone":
        entry = round(l * 0.999, 2)
        stop = round(h * 1.01, 2)
        if near_sup and near_sup < entry:
            target = round(near_sup, 2)
            target_basis = "nearest_support"
        else:
            target = round(l * 0.95, 2)
            target_basis = "5pct_measured_move_down"
        rr = (entry - target) / (stop - entry) if stop > entry else 0.0
        return {
            "direction_bias": "bearish",
            "entry": entry,
            "entry_condition": f"close < {entry:.2f} (confirmation: next bar closes below doji low)",
            "stop": stop,
            "stop_basis": "doji_high_plus_1pct",
            "target_primary": target,
            "target_basis": target_basis,
            "risk_reward": round(rr, 2),
        }
    # standard / long_legged — reference levels, NOT a trade trigger
    entry = round(h * 1.001, 2)
    stop = round(l * 0.99, 2)
    target = round(h * 1.05, 2)
    return {
        "direction_bias": "neutral",
        "entry": entry,
        "entry_condition": (
            f"close > {entry:.2f} for bullish read OR close < {l * 0.999:.2f} for bearish read "
            f"(doji alone is NOT a trade trigger — wait for the next bar to choose a side)"
        ),
        "stop": stop,
        "stop_basis": "doji_low_minus_1pct_reference_only",
        "target_primary": target,
        "target_basis": "5pct_measured_move_reference_only",
        "risk_reward": round((target - entry) / (entry - stop), 2) if entry > stop else 0.0,
    }


def _trend_phrase(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 2: return "a confirmed Stage 2 uptrend"
    if stage == 1: return "a Stage 1 base/accumulation environment"
    if stage == 3: return "a Stage 3 distribution environment"
    if stage == 4: return "a Stage 4 downtrend environment"
    return "an undefined trend stage"


def _ma_phrase(context: dict) -> str:
    a = context.get("ma_alignment", "mixed")
    return {
        "stacked_bullish": "stacked-bullish",
        "stacked_bearish": "stacked-bearish",
        "mixed": "mixed",
    }.get(a, "mixed")


def _rs_phrase(context: dict) -> str:
    return {"up": "improving", "down": "deteriorating", "flat": "neutral"}.get(
        context.get("rs_trend", "flat"), "neutral"
    )


def _variant_description(variant: str) -> str:
    return {
        "dragonfly": (
            "a Dragonfly Doji - the open, high and close cluster at the very top of the "
            "bar's range while a long lower shadow plunges to the session low. The buyers "
            "absorbed every drop and pushed price right back to the open"
        ),
        "gravestone": (
            "a Gravestone Doji - the open, low and close cluster at the very bottom of the "
            "bar's range while a long upper shadow spikes to the session high. The sellers "
            "absorbed every push and forced price right back to the open"
        ),
        "long_legged": (
            "a Long-Legged Doji - both upper and lower wicks extend far from a near-zero "
            "body, evidence of an enormous intraday swing that ultimately resolved with "
            "buyers and sellers in perfect equilibrium"
        ),
        "standard": (
            "a Standard Doji - balanced upper and lower shadows around a near-zero body, "
            "marking a session where buyers and sellers fought to a draw with no clear "
            "edge to either side"
        ),
    }[variant]


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
    variant = c["variant"]
    body_pct_disp = round(c["body_to_range"] * 100, 2)
    upper_pct_disp = round(c["upper_wick_pct"] * 100, 1)
    lower_pct_disp = round(c["lower_wick_pct"] * 100, 1)
    at_swing_high = _is_swing_high(bars, i)
    at_swing_low = _is_swing_low(bars, i)
    near_res = _near_resistance(context, bar)
    near_sup = _near_support(context, bar)

    levels = _compute_levels(c, context)
    direction_bias = levels["direction_bias"]
    entry = levels["entry"]
    stop = levels["stop"]
    target = levels["target_primary"]
    rr = levels["risk_reward"]
    stop_distance_pct = abs(entry - stop) / entry * 100 if entry > 0 else 0.0

    # Volume signature
    vol_ratio_disp = "unavailable"
    if i >= 1:
        lookback = bars[max(0, i - 20):i]
        if lookback:
            avg_vol = sum(b["v"] for b in lookback) / len(lookback)
            if avg_vol > 0:
                vol_ratio_disp = f"{bar['v'] / avg_vol:.2f}x"

    # Position context phrase
    if at_swing_high:
        position_phrase = "at a near-term swing high"
    elif at_swing_low:
        position_phrase = "at a near-term swing low"
    elif near_res:
        position_phrase = "right at known resistance"
    elif near_sup:
        position_phrase = "right at known support"
    else:
        position_phrase = "inside the current trading range with no immediate S/R confluence"

    variant_desc = _variant_description(variant)
    stage_phrase = _trend_phrase(context)
    ma_phrase = _ma_phrase(context)
    rs_phrase = _rs_phrase(context)
    regime = context.get("regime", "current")

    anchors = [{"t": int(bar["t"]), "price": float(bar["c"])}]
    now = int(time.time())

    headline = (
        f"{variant.replace('_', ' ').title()} Doji {position_phrase} - body {body_pct_disp}% "
        f"of range, upper wick {upper_pct_disp}%, lower wick {lower_pct_disp}% "
        f"(bias {direction_bias})."
    )

    what_it_is = (
        f"This bar is {variant_desc}. The Doji - first systematically described by Steve "
        f"Nison in 'Japanese Candlestick Charting Techniques' (1991) but traceable to "
        f"Munehisa Homma's 18th-century Sakata rice trading rules - is the candlestick "
        f"family's purest expression of indecision: open and close converge so tightly "
        f"that the body collapses to a sliver. Here the body measures just "
        f"{body_pct_disp}% of the {c['total_range']:.2f}-point range, well inside the "
        f"5% threshold that defines a true doji. The wick anatomy tells the story of the "
        f"session: an upper wick of {upper_pct_disp}% of range and a lower wick of "
        f"{lower_pct_disp}%, printed on volume of {vol_ratio_disp} the 20-bar average. "
        f"For the {variant} variant specifically, this signature represents a particular "
        f"intraday narrative: price probed a level (either up or down), the dominant side "
        f"could not hold the move, and by close the entire effort was retraced. That single-"
        f"bar reversal of conviction is the doji's signal value - the bar where one side's "
        f"effort visibly fails. Greg Morris's 'Candlestick Charting Explained' — the modern "
        f"interpretive guide that translated Sakata-era reading rules into a probability "
        f"framework — flags doji at structural levels as one of the highest-edge single-bar "
        f"signals in the entire candlestick library, particularly when the bar arrives on "
        f"above-average volume. Steve Bigalow's body of work fusing candlesticks with "
        f"western technical analysis treats the doji-plus-confluence read (oversold/"
        f"overbought oscillator + support/resistance + doji print) as a near-mechanical "
        f"trigger pattern rather than a passive observation."
    )

    why_it_matters = (
        f"This {variant} doji has printed {position_phrase}, inside {stage_phrase} with "
        f"{ma_phrase} moving-average alignment and {rs_phrase} relative strength versus "
        f"the broader tape. Context is what separates a meaningful doji from chart noise: "
        f"a doji buried inside a chop range or in the middle of a strong trending move is "
        f"information-poor, but a doji printed AT a structural level or after a sustained "
        f"directional move is information-rich. Here the {direction_bias} bias is reinforced "
        f"because the dominant wick direction "
        f"({'down (rejection of lower prices)' if variant == 'dragonfly' else 'up (rejection of higher prices)' if variant == 'gravestone' else 'two-sided (no rejection winner)'}) "
        f"and the location ({position_phrase}) align "
        f"{'with' if (variant == 'dragonfly' and (at_swing_low or near_sup)) or (variant == 'gravestone' and (at_swing_high or near_res)) else 'partially with'} the textbook "
        f"reversal-signal template. Volume of {vol_ratio_disp} the 20-bar average is the "
        f"final ingredient: heavy-volume dojis at extremes carry institutional fingerprints "
        f"and are statistically more likely to mark short-term turns than light-volume "
        f"versions printed in thin tape. Current regime is {regime}, which sets the broader "
        f"backdrop for how aggressively to act on a single-bar reversal signal."
    )

    what_to_watch_for = (
        f"Doji signals require CONFIRMATION on the next bar to be tradable - that is the "
        f"single most important rule Nison emphasized, and the most-ignored rule by amateur "
        f"chart readers. For this {variant} doji the watch list is: "
        f"(1) the next bar's close must confirm the bias - for the {direction_bias} read, "
        f"a close {'above' if direction_bias != 'bearish' else 'below'} ${entry:.2f} is the "
        f"go signal; (2) volume on the confirmation bar should expand to >=1.3x the 20-bar "
        f"average - confirmation on shrinking volume is weak; "
        f"(3) the confirmation bar's range should be at LEAST as wide as the doji's "
        f"({c['total_range']:.2f}-point range) - a tiny inside bar after the doji means "
        f"the indecision is still in force and the trade is premature; "
        f"(4) if the next 1-2 bars trade entirely INSIDE the doji's range, the signal is "
        f"in suspended animation - wait for resolution before acting. The measured target "
        f"is ${target:.2f} (basis: {levels['target_basis']}); the stop is ${stop:.2f} "
        f"({stop_distance_pct:.1f}% from entry, basis: {levels['stop_basis']}); R:R is "
        f"{rr:.2f}. {('Note: standard/long-legged dojis are NOT trade triggers in isolation - they are AWAITING-DIRECTION markers. The levels above are reference points pending the next bar to choose a side.' if variant in ('standard', 'long_legged') else 'The trade is on once the next bar confirms with close and volume; the doji itself is the SETUP, the confirmation bar is the TRIGGER.')}"
    )

    failure_signal = (
        f"Single-candle reversal patterns - including all four doji variants - have a "
        f"well-documented failure rate that experienced practitioners account for in their "
        f"risk sizing. The most common failure mode is the doji-as-pause inside a strong "
        f"trend: a runaway uptrend prints a gravestone doji that looks like a top, traders "
        f"short it, and the trend simply absorbs the rejection bar and continues higher on "
        f"the next session - this is why context (where in the trend is this doji?) matters "
        f"more than anatomy. A second failure mode is the false-confirmation breakout: the "
        f"next bar pierces ${entry:.2f} but on weak volume and closes back inside the doji "
        f"range - that's a fake-out and the doji's signal value has been spent. A third "
        f"failure mode unique to dojis at S/R: if price closes through ${stop:.2f} "
        f"({stop_distance_pct:.1f}% adverse move), the structural level the doji was "
        f"defending has fallen and the reversal thesis is invalid - exit immediately, no "
        f"hope-and-hold. Position sizing must reflect the {stop_distance_pct:.1f}% stop "
        f"distance: risking 0.5% of account on this trade implies a position size of roughly "
        f"{(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Candlestick patterns "
        f"are CONTEXTUAL probability shifters, not deterministic triggers - the doji shifts "
        f"the odds, the confirmation bar fires the trigger, the stop saves the account when "
        f"the probability inevitably misses."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Doji",
        "category": "candlestick",
        "direction": "neutral",
        "start_t": int(bar["t"]),
        "end_t": int(bar["t"]),
        "pivot_ts": [int(bar["t"])],
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": {
                "variant": variant,
                "body_pct": float(round(c["body_pct_of_price"], 4)),
                "body_to_range_ratio": float(round(c["body_to_range"], 4)),
                "upper_wick_pct": float(round(c["upper_wick_pct"], 4)),
                "lower_wick_pct": float(round(c["lower_wick_pct"], 4)),
                "total_range": float(round(c["total_range"], 4)),
                "direction_bias": direction_bias,
                "at_swing_high": bool(at_swing_high),
                "at_swing_low": bool(at_swing_low),
                "near_resistance": bool(near_res),
                "near_support": bool(near_sup),
            },
        },
        "levels": {
            "entry": float(entry),
            "entry_condition": levels["entry_condition"],
            "stop": float(stop),
            "stop_basis": levels["stop_basis"],
            "target_primary": float(target),
            "target_secondary": None,
            "risk_reward": float(rr),
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


register(_PATTERN_ID, detect_doji)
