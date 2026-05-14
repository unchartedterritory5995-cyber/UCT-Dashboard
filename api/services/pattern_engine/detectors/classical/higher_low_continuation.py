"""Higher Low Continuation detector — classical Dow Theory + modern momentum.

Dow Theory (Charles Dow, 1900-1902 editorials in the Wall Street Journal,
later codified by William Hamilton and Robert Rhea) defined an uptrend
as a sequence of higher highs AND higher lows. The "Higher Low
Continuation" is not a specific named pattern but rather the STRUCTURAL
CONFIRMATION that every modern momentum framework (Minervini, Kullamägi,
O'Neil, Weinstein) treats as the foundational continuation signal:
when a stock pulls back, the swing-low pivot prints meaningfully HIGHER
than the prior swing-low pivot, and price then reclaims the higher-low's
pivot high on volume — the uptrend structure is confirmed and a fresh
continuation entry becomes available.

Conditions:
  - Stage 2 uptrend confirmed
  - Most recent swing-low pivot is meaningfully higher than the prior
    swing-low pivot (lift >=3%)
  - Price has reclaimed back above the higher-low's pivot high on volume
  - Stacked_bullish MA alignment

Levels:
  - entry = current_close + 0.1% (entry at market on reclaim confirmation)
  - stop = the higher-low pivot price - 1 ATR
  - target = prior swing high (next obvious resistance) + ATR

Geometry: "neckline" with 3 anchors: [prior_swing_low, prior_swing_high,
current_higher_low].
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import (
    dcr_phrase, dcr_interpretation, ma_alignment_phrase, regime_phrase,
    rs_trend_phrase, trend_stage_description, volume_signature_phrase,
)
from api.services.pattern_engine.narrative_helpers_structure import (
    compute_structure_quality, structure_extras, structure_geom_boost,
    structure_narrative_sentence,
)
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "higher_low_continuation"

# Thresholds - sourced from classical Dow Theory + modern momentum literature
_MIN_LIFT_PCT = 3.0                        # higher low must be >=3% above prior
_PIVOT_WINDOW = 3                          # fractal swing-low detection window
_RECLAIM_VOLUME_RATIO_MIN = 1.0            # reclaim should print on >= avg vol
_CONFIDENCE_FLOOR = 50.0


def detect_higher_low_continuation(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect higher-low continuation. Emits 0 or 1 detection."""
    if not bars or len(bars) < 50:
        return []

    # Gate 1: Stage 2 uptrend required (structural continuation only valid in uptrend)
    if context.get("trend_stage") != 2:
        return []
    # Gate 2: stacked_bullish MA alignment
    if context.get("ma_alignment") != "stacked_bullish":
        return []

    # Find swing-low pivots
    pivots = detect_pivots(bars, window=_PIVOT_WINDOW)
    lows = [p for p in pivots if p["type"] == "low"]
    if len(lows) < 2:
        return []

    # Get the two most recent swing lows
    most_recent = lows[-1]
    prior = lows[-2]

    current_low = most_recent["price"]
    prior_low = prior["price"]
    if prior_low <= 0:
        return []

    lift_pct = (current_low - prior_low) / prior_low * 100.0
    if lift_pct < _MIN_LIFT_PCT:
        return []  # not a meaningful higher low

    # Find the prior swing HIGH between prior_low and most_recent_low (intervening peak)
    highs = [p for p in pivots if p["type"] == "high"]
    intervening_highs = [
        h for h in highs
        if prior["bar_index"] < h["bar_index"] < most_recent["bar_index"]
    ]
    if not intervening_highs:
        return []
    intervening_high = max(intervening_highs, key=lambda h: h["price"])

    # Price reclaim check: has price reclaimed above the higher-low's most recent
    # neighbor swing-high (intervening_high) on volume?
    n = len(bars)
    last_bar = bars[-1]
    current_close = last_bar["c"]
    reclaim_level = intervening_high["price"]
    if current_close < reclaim_level * 0.995:
        return []

    # Volume on the reclaim: avg vol over the last 5 bars vs prior 15
    last5 = bars[-5:]
    prior15 = bars[-20:-5] if n >= 20 else bars[:-5]
    avg5_vol = sum(b["v"] for b in last5) / max(1, len(last5))
    avg_prior_vol = sum(b["v"] for b in prior15) / max(1, len(prior15))
    if avg_prior_vol <= 0:
        return []
    reclaim_vol_ratio = avg5_vol / avg_prior_vol
    if reclaim_vol_ratio < _RECLAIM_VOLUME_RATIO_MIN:
        return []

    # Compute ATR(14) for stop and target
    atr14 = _atr(bars[-15:])
    if atr14 <= 0:
        return []

    # Prior swing high (the LEFT side of the structure) - this is the next obvious
    # resistance and the natural target. Walk back from the prior low to find it.
    prior_left_highs = [h for h in highs if h["bar_index"] < prior["bar_index"]]
    if prior_left_highs:
        prior_swing_high_price = prior_left_highs[-1]["price"]
    else:
        prior_swing_high_price = intervening_high["price"]

    # Structure-quality boosts
    sq = compute_structure_quality(bars, most_recent["bar_index"], current_low)

    candidate = {
        "current_higher_low_idx": most_recent["bar_index"],
        "current_higher_low_price": current_low,
        "prior_low_idx": prior["bar_index"],
        "prior_low_price": prior_low,
        "intervening_high_idx": intervening_high["bar_index"],
        "intervening_high_price": intervening_high["price"],
        "prior_swing_high_price": prior_swing_high_price,
        "lift_pct": lift_pct,
        "current_close": current_close,
        "reclaim_volume_ratio": reclaim_vol_ratio,
        "atr14": atr14,
        "hl_result": sq["hl_result"],
        "ma_result": sq["ma_result"],
    }

    geom_score = _score_geometry(candidate)
    vol_score = _score_volume(candidate)
    ctx_score = _score_context(context)
    hist_score = 50.0
    confidence = round(
        0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
    )
    if confidence < _CONFIDENCE_FLOOR:
        return []

    d = _build_detection(bars, candidate, confidence, context,
                        geom_score, vol_score, ctx_score, hist_score)
    return [d]


# ---------------------------------------------------------------------------
# Math helpers
# ---------------------------------------------------------------------------

def _atr(bars: List[Bar]) -> float:
    if not bars:
        return 0.0
    if len(bars) == 1:
        return bars[0]["h"] - bars[0]["l"]
    trs = []
    for i in range(1, len(bars)):
        b = bars[i]
        pc = bars[i - 1]["c"]
        tr = max(b["h"] - b["l"], abs(b["h"] - pc), abs(b["l"] - pc))
        trs.append(tr)
    return sum(trs) / len(trs) if trs else 0.0


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _score_geometry(c: dict) -> float:
    lift = c["lift_pct"]
    if lift >= 10.0:
        lift_score = 100.0
    elif lift >= 5.0:
        lift_score = 85.0
    elif lift >= _MIN_LIFT_PCT:
        lift_score = 65.0
    else:
        lift_score = 30.0

    # Distance from reclaim level: not too extended above the prior high
    # is good (entries near the breakout level are higher edge)
    close = c["current_close"]
    reclaim = c["intervening_high_price"]
    if reclaim > 0:
        ext_pct = (close - reclaim) / reclaim * 100.0
    else:
        ext_pct = 0.0
    if 0 <= ext_pct <= 2.0:
        ext_score = 100.0
    elif ext_pct <= 5.0:
        ext_score = 80.0
    elif ext_pct <= 10.0:
        ext_score = 60.0
    else:
        ext_score = 30.0

    base = 0.55 * lift_score + 0.45 * ext_score
    base += structure_geom_boost(c)
    return round(min(100.0, base), 2)


def _score_volume(c: dict) -> float:
    ratio = c["reclaim_volume_ratio"]
    if ratio >= 1.5:
        return 100.0
    if ratio >= 1.2:
        return 85.0
    if ratio >= 1.0:
        return 65.0
    return 40.0


def _score_context(context: dict) -> float:
    score = 50.0
    if context.get("trend_stage") == 2:
        score += 20.0
    if context.get("ma_alignment") == "stacked_bullish":
        score += 15.0
    if context.get("rs_trend") == "up":
        score += 10.0
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "accumulation" and recent_dcr >= 0.65:
        score += 12.0
    elif dcr_sig == "distribution":
        score -= 8.0
    grade = context.get("can_slim_grade", "C")
    cscore = context.get("can_slim_score", 50) or 50
    if grade == "A" and cscore >= 80:
        score += 15.0
    elif grade == "B" and cscore >= 65:
        score += 8.0
    return min(100.0, max(0.0, score))


# ---------------------------------------------------------------------------
# Detection assembly
# ---------------------------------------------------------------------------

def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    current_close = c["current_close"]
    atr14 = c["atr14"]
    higher_low_price = c["current_higher_low_price"]
    prior_swing_high = c["prior_swing_high_price"]

    entry = round(current_close * 1.001, 2)
    stop = round(higher_low_price - atr14, 2)
    target = round(prior_swing_high + atr14, 2)
    rr = ((target - entry) / (entry - stop)) if entry > stop else 0.0
    stop_distance_pct = ((entry - stop) / entry * 100.0) if entry > 0 else 0.0

    prior_low_bar = bars[c["prior_low_idx"]]
    intervening_bar = bars[c["intervening_high_idx"]]
    current_low_bar = bars[c["current_higher_low_idx"]]
    anchors = [
        {"t": int(prior_low_bar["t"]), "price": float(c["prior_low_price"])},
        {"t": int(intervening_bar["t"]), "price": float(c["intervening_high_price"])},
        {"t": int(current_low_bar["t"]), "price": float(higher_low_price)},
    ]
    pivot_ts = [
        int(prior_low_bar["t"]),
        int(intervening_bar["t"]),
        int(current_low_bar["t"]),
        int(last_bar["t"]),
    ]

    extras = {
        "higher_low_price": round(higher_low_price, 2),
        "prior_low_price": round(c["prior_low_price"], 2),
        "lift_pct": round(c["lift_pct"], 2),
        "current_close": round(current_close, 2),
        "reclaim_volume_ratio": round(c["reclaim_volume_ratio"], 2),
        "intervening_high_price": round(c["intervening_high_price"], 2),
        "prior_swing_high_price": round(prior_swing_high, 2),
        "atr14": round(atr14, 4),
        **structure_extras(c),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr, stop_distance_pct, atr14)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Higher Low Continuation",
        "category": "classical",
        "direction": "bullish",
        "start_t": int(prior_low_bar["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "neckline",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume >= 1.0x prior 15-bar avg",
            "stop": stop,
            "stop_basis": "higher_low_minus_1_ATR",
            "target_primary": target,
            "target_secondary": None,
            "risk_reward": round(rr, 2),
        },
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": geom_score,
            "volume_score": vol_score,
            "context_score": ctx_score,
            "historical_score": hist_score,
        },
        "narrative": narrative,
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


def _compose_narrative(c: dict, context: dict, entry: float, stop: float,
                       target: float, rr: float, stop_distance_pct: float,
                       atr14: float) -> dict:
    lift = c["lift_pct"]
    higher_low = c["current_higher_low_price"]
    prior_low = c["prior_low_price"]
    reclaim = c["intervening_high_price"]
    vol_ratio = c["reclaim_volume_ratio"]
    current_close = c["current_close"]
    prior_high = c["prior_swing_high_price"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    headline = (
        f"Higher Low Continuation - new swing low at ${higher_low:.2f} sits "
        f"{lift:.1f}% above prior low ${prior_low:.2f}, reclaim above ${reclaim:.2f} "
        f"on {vol_ratio:.2f}x volume. Entry ${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Higher Low Continuation is the structural confirmation of an "
        f"uptrend in classical Dow Theory — first codified by Charles Dow "
        f"in his Wall Street Journal editorials between 1900 and 1902, then "
        f"systematized by William Peter Hamilton and Robert Rhea in the "
        f"1920s and 1930s. Dow taught that an uptrend is DEFINED by a "
        f"sequence of higher highs AND higher lows — both halves of that "
        f"definition matter. The Higher Low Continuation is not a specific "
        f"named pattern but rather the STRUCTURAL fingerprint that the "
        f"uptrend remains intact and that a fresh continuation entry has "
        f"become available. Every modern momentum framework — Mark "
        f"Minervini's SEPA, Kristjan Kullamägi's monster-move methodology, "
        f"William O'Neil's CAN SLIM, Stan Weinstein's Stage 2 — treats "
        f"this exact structural read as the foundational continuation "
        f"signal. Here the most recent swing low at ${higher_low:.2f} "
        f"sits {lift:.1f}% above the prior swing low at ${prior_low:.2f}, "
        f"comfortably above the 3% lift threshold that distinguishes a "
        f"meaningful structural higher low from noise. Price has now "
        f"reclaimed back above the intervening swing high at "
        f"${reclaim:.2f} on volume {vol_ratio:.2f}x the prior 15-bar "
        f"average, confirming that the uptrend structure is intact and "
        f"the institutional bid has reasserted itself. The trade setup "
        f"is the cleanest available in classical TA: long on the reclaim, "
        f"stop below the higher-low pivot, target the prior structural "
        f"swing high."
    )

    why_it_matters = (
        f"This Higher Low Continuation is forming inside {stage_phrase} "
        f"with {ma_phrase} alignment, {rs_phrase}, in {regime_p}. "
        f"{vol_phrase} during the recent reclaim confirms institutional "
        f"participation. {dcr_p} reinforces the read: institutional "
        f"buyers are closing strong, not getting faded into the close. "
        f"{dcr_interpretation(context, 'bullish')} The mechanical edge "
        f"of the Higher Low Continuation comes from the asymmetry of the "
        f"structural read: when a stock pulls back and prints a higher "
        f"low, the prior trend's institutional buyers have stepped in "
        f"earlier than they did at the prior low — that's the textbook "
        f"sign of demand expanding, not contracting. The {lift:.1f}% "
        f"lift between the two swing lows is the quantitative footprint "
        f"of that demand expansion: shallow pullbacks in an uptrend "
        f"signal aggressive institutional accumulation, while deep "
        f"pullbacks signal hesitation. Minervini and Kullamägi both "
        f"emphasize that the SHALLOWEST pullbacks produce the strongest "
        f"subsequent legs because the institutional cohort never gave "
        f"weak hands a chance to exit the position. {structure_narrative_sentence(c)} "
        f"The trade is structurally clean: entry at ${entry:.2f} (the "
        f"reclaim close +0.1%), stop at ${stop:.2f} (the higher-low "
        f"pivot minus 1 ATR), target at ${target:.2f} (the prior swing "
        f"high plus 1 ATR for the next resistance retest), R:R {rr:.1f}."
    ).strip()

    what_to_watch_for = (
        f"Trigger: price has already reclaimed above the intervening "
        f"swing high at ${reclaim:.2f} on volume confirmation, so entry "
        f"is at market at ${entry:.2f} (or on a 1-2 bar tight pullback "
        f"that holds above the reclaim level). The ideal follow-through "
        f"has price extending toward the prior swing high at "
        f"${prior_high:.2f} within 5-15 bars, with each subsequent bar "
        f"holding above the prior bar's low (the textbook 'staircase' "
        f"continuation pattern). Volume on the advance should remain at "
        f"or above the prior 15-bar average — drying volume on the "
        f"continuation attempt would suggest the reclaim was a short-"
        f"covering bounce rather than fresh institutional buying. The "
        f"ATR(14) of {atr14:.4f} is the unit for stop sizing and "
        f"continuation projection: each successive bar that closes "
        f"above the prior bar's close by at least 0.5 ATR is a "
        f"high-quality continuation bar. Position sizing should reflect "
        f"the {stop_distance_pct:.1f}% stop distance — a 1% account-"
        f"risk position implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity per trade. Higher Low Continuations typically resolve "
        f"into the next leg of the trend within 5-20 bars; if price "
        f"stalls and consolidates for more than 15 bars, the setup is "
        f"reverting to a Stage 5 base which requires a different "
        f"breakout trigger."
    )

    failure_signal = (
        f"The Higher Low Continuation is invalidated if price closes "
        f"back below the higher-low pivot at ${higher_low:.2f} (stop "
        f"set at ${stop:.2f}, one ATR below) — that's the structural "
        f"breakdown of the uptrend, and it transforms the higher-low "
        f"read into a potential lower-high formation (the textbook "
        f"definition of trend change in Dow Theory). A more subtle "
        f"failure mode: price advances toward the prior swing high but "
        f"FAILS to print a new high above ${prior_high:.2f} — instead "
        f"reversing into a third pullback that prints a LOWER low. "
        f"That sequence — higher low followed by failed retest followed "
        f"by lower low — is the structural definition of Stage 2 "
        f"transitioning to Stage 3, and the entire continuation thesis "
        f"is dead. The mechanical response: cut the trade at the "
        f"${stop:.2f} stop without argument, accept the loss as the "
        f"cost of mechanical execution, and wait for fresh structure to "
        f"develop. Risk discipline on this setup is forgiving because "
        f"the stop is structurally defined (the higher-low pivot is a "
        f"natural support level and the ATR-buffer accounts for normal "
        f"volatility); the only way to lose money on this setup at "
        f"scale is to widen stops or hold through failures. Classical "
        f"Dow Theory discipline: the trend is your friend until it "
        f"isn't, and the precise definition of 'isn't' is a close "
        f"below the most recent higher low."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_higher_low_continuation)
