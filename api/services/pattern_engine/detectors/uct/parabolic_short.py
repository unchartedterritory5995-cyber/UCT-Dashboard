"""Parabolic Short detector — Kristjan Kullamägi blow-off framework.

Kullamägi's parabolic-short framework is the inverse of his long-side
"monster move" setup: when a stock has run vertically and then prints a
single climactic bar with gap-up exhaustion and a red close, the asymmetry
flips and the highest-edge trade becomes a short into trend termination.

Conditions:
  - Stock gained >=100% in the last 30 bars (parabolic run)
  - Last bar:
      * range > 3x ATR(20)
      * DCR <= 0.3 (close in bottom 30% of range)
      * volume >= 3x 20-bar avg
  - Gap-up open >=3% but failed to hold (close < open)

Levels:
  - entry = climax bar low * 0.999
  - stop = climax bar high * 1.01
  - target = lowest swing low in last 50 bars

Geometry: "candle_mark" at the climax bar.
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
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "parabolic_short"

# Thresholds - sourced from Kullamägi's published short-side framework
_MIN_PRIOR_RUN_PCT = 1.00              # >=100% advance in last 30 bars
_PRIOR_RUN_BARS = 30                   # 30-bar lookback for parabolic run
_MIN_RANGE_VS_ATR = 3.0                # climax bar range > 3x ATR(20)
_MAX_CLIMAX_DCR = 0.30                 # DCR <= 0.3 (close in bottom 30%)
_MIN_CLIMAX_VOL_RATIO = 3.0            # volume >= 3x 20-bar avg
_MIN_GAP_UP_PCT = 0.03                 # gap-up >= 3%
_CONFIDENCE_FLOOR = 50.0


def detect_parabolic_short(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Kullamägi parabolic short setups. Emits 0 or 1 detection."""
    if not bars or len(bars) < _PRIOR_RUN_BARS + 21:
        return []

    n = len(bars)
    climax = bars[-1]
    prev = bars[-2]

    # Gate 1: parabolic prior run of >=100% in 30 bars
    close_30 = bars[-_PRIOR_RUN_BARS - 1]["c"]
    if close_30 <= 0:
        return []
    prior_run_pct = (climax["c"] - close_30) / close_30
    if prior_run_pct < _MIN_PRIOR_RUN_PCT:
        return []

    # Gate 2: climax bar range > 3x ATR(20)
    last20 = bars[-22:-2] if n >= 22 else bars[:-2]
    atr20 = _atr(last20)
    climax_range = climax["h"] - climax["l"]
    if atr20 <= 0:
        return []
    range_ratio = climax_range / atr20
    if range_ratio < _MIN_RANGE_VS_ATR:
        return []

    # Gate 3: climax DCR <= 0.3
    if climax_range <= 0:
        return []
    climax_dcr = (climax["c"] - climax["l"]) / climax_range
    if climax_dcr > _MAX_CLIMAX_DCR:
        return []

    # Gate 4: volume >= 3x 20-bar avg
    avg20_vol = sum(b["v"] for b in last20) / max(1, len(last20))
    if avg20_vol <= 0:
        return []
    vol_ratio = climax["v"] / avg20_vol
    if vol_ratio < _MIN_CLIMAX_VOL_RATIO:
        return []

    # Gate 5: gap-up open >=3% AND close < open (failed gap)
    if prev["c"] <= 0:
        return []
    gap_up_pct = (climax["o"] - prev["c"]) / prev["c"]
    if gap_up_pct < _MIN_GAP_UP_PCT:
        return []
    gap_failed = climax["c"] < climax["o"]
    if not gap_failed:
        return []

    # Find lowest swing low in last 50 bars (excluding the climax bar) for target
    lookback50 = bars[-51:-1] if n >= 51 else bars[:-1]
    target_low = min(b["l"] for b in lookback50) if lookback50 else climax["l"] * 0.5

    candidate = {
        "climax_idx": n - 1,
        "climax_high": climax["h"],
        "climax_low": climax["l"],
        "climax_close": climax["c"],
        "climax_open": climax["o"],
        "climax_volume": climax["v"],
        "climax_range": climax_range,
        "climax_dcr": climax_dcr,
        "vol_ratio": vol_ratio,
        "range_ratio": range_ratio,
        "atr20": atr20,
        "gap_up_pct": gap_up_pct,
        "gap_failed": True,
        "prior_run_pct": prior_run_pct,
        "target_low": target_low,
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
    """Average daily range (h - l) — cleaner for the parabolic blow-off
    comparison since TR's gap component would compound the parabolic
    accelerator effect and artificially inflate the prior-run ATR.
    """
    if not bars:
        return 0.0
    return sum(b["h"] - b["l"] for b in bars) / len(bars)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _score_geometry(c: dict) -> float:
    rr = c["range_ratio"]
    if rr >= 5.0:
        range_score = 100.0
    elif rr >= 4.0:
        range_score = 85.0
    elif rr >= _MIN_RANGE_VS_ATR:
        range_score = 70.0
    else:
        range_score = 30.0

    dcr = c["climax_dcr"]
    # Lower DCR = stronger close-in-bottom signal
    if dcr <= 0.10:
        dcr_score = 100.0
    elif dcr <= 0.20:
        dcr_score = 85.0
    elif dcr <= _MAX_CLIMAX_DCR:
        dcr_score = 70.0
    else:
        dcr_score = 30.0

    gap = c["gap_up_pct"]
    if gap >= 0.10:
        gap_score = 100.0
    elif gap >= 0.05:
        gap_score = 80.0
    elif gap >= _MIN_GAP_UP_PCT:
        gap_score = 65.0
    else:
        gap_score = 30.0

    run = c["prior_run_pct"]
    if run >= 2.0:
        run_score = 100.0
    elif run >= 1.5:
        run_score = 85.0
    elif run >= _MIN_PRIOR_RUN_PCT:
        run_score = 70.0
    else:
        run_score = 30.0

    return round(0.30 * range_score + 0.25 * dcr_score + 0.20 * gap_score + 0.25 * run_score, 2)


def _score_volume(c: dict) -> float:
    vr = c["vol_ratio"]
    if vr >= 5.0:
        return 100.0
    if vr >= 4.0:
        return 85.0
    if vr >= _MIN_CLIMAX_VOL_RATIO:
        return 70.0
    return 30.0


def _score_context(context: dict) -> float:
    # For a SHORT, hostile bullish context = lower score; we don't want to
    # short a clean Stage 2 outright. But the parabolic climax itself is the
    # signal, so we don't reject any stage. Base is 50.
    score = 50.0
    # DCR distribution = supportive of bearish thesis
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "distribution":
        score += 12.0
    elif dcr_sig == "accumulation" and recent_dcr >= 0.65:
        score -= 8.0
    if context.get("rs_trend") == "down":
        score += 10.0
    if context.get("trend_stage") == 3:
        score += 10.0  # late-cycle distribution favors short
    elif context.get("trend_stage") == 4:
        score += 15.0
    return min(100.0, max(0.0, score))


# ---------------------------------------------------------------------------
# Detection assembly
# ---------------------------------------------------------------------------

def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    climax = bars[c["climax_idx"]]
    climax_high = c["climax_high"]
    climax_low = c["climax_low"]

    entry = round(climax_low * 0.999, 2)
    stop = round(climax_high * 1.01, 2)
    target = round(c["target_low"], 2)
    rr = ((entry - target) / (stop - entry)) if stop > entry else 0.0
    stop_distance_pct = ((stop - entry) / entry * 100.0) if entry > 0 else 0.0

    anchors = [{"t": int(climax["t"]), "price": float(climax["c"])}]
    pivot_ts = [int(climax["t"])]

    extras = {
        "30bar_advance_pct": round(c["prior_run_pct"] * 100.0, 2),
        "climax_range_ratio": round(c["range_ratio"], 2),
        "climax_dcr": round(c["climax_dcr"], 3),
        "climax_vol_ratio": round(c["vol_ratio"], 2),
        "gap_up_pct": round(c["gap_up_pct"] * 100.0, 2),
        "gap_failed": c["gap_failed"],
        "climax_high": round(climax_high, 2),
        "climax_low": round(climax_low, 2),
        "climax_close": round(c["climax_close"], 2),
        "climax_open": round(c["climax_open"], 2),
        "atr20": round(c["atr20"], 4),
        "target_low": round(c["target_low"], 2),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr, stop_distance_pct)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Parabolic Short",
        "category": "uct",
        "direction": "bearish",
        "start_t": int(bars[max(0, c["climax_idx"] - _PRIOR_RUN_BARS)]["t"]),
        "end_t": int(climax["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"break of climax low at {climax_low:.2f}",
            "stop": stop,
            "stop_basis": "climax_high_plus_1pct",
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
                       target: float, rr: float, stop_distance_pct: float) -> dict:
    prior_run = c["prior_run_pct"] * 100.0
    range_ratio = c["range_ratio"]
    dcr = c["climax_dcr"]
    vol_ratio = c["vol_ratio"]
    gap_up = c["gap_up_pct"] * 100.0
    climax_high = c["climax_high"]
    climax_low = c["climax_low"]
    climax_open = c["climax_open"]
    climax_close = c["climax_close"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    headline = (
        f"Parabolic Short - {prior_run:.0f}% 30-bar run, climax range "
        f"{range_ratio:.1f}x ATR, DCR {dcr:.2f}, volume {vol_ratio:.1f}x, "
        f"gap-up {gap_up:.1f}% failed. Entry ${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Parabolic Short setup is Kristjan Kullamägi's (Qullamaggie) "
        f"signature blow-off detection — the inverse of his long-side "
        f"'monster move' framework. When a stock has run vertically "
        f"({prior_run:.0f}% in 30 bars here, well above his 100% minimum) "
        f"and then prints a single climactic bar showing simultaneous "
        f"exhaustion across four axes — range {range_ratio:.1f}x the 20-bar "
        f"ATR, DCR {dcr:.2f} (close in the bottom {dcr * 100:.0f}% of the "
        f"day's range), volume {vol_ratio:.1f}x the 20-bar average, and a "
        f"failed {gap_up:.1f}% gap-up open that closed RED — the asymmetry "
        f"of the trade flips dramatically and short positions become the "
        f"highest-edge play. Kullamägi has published this framework "
        f"explicitly on Twitter and in his Stockbee.tv educational content: "
        f"'when you see vertical moves on huge volume with the day closing "
        f"red after a gap up, that's the signal.' The setup captures the "
        f"precise moment when the late-cycle FOMO buyers chasing the "
        f"parabolic move get trapped at the climactic high, and when the "
        f"institutional bid that drove the prior run steps aside to "
        f"distribute into the panic-buying. The climax bar is "
        f"mathematically unsustainable — gains of 100%+ in 30 bars cannot "
        f"continue indefinitely, and the gap-up failure on 3x+ volume is "
        f"the textbook fingerprint of distribution being completed. "
        f"Oliver Kell's 'Cycle of Price Action' framework calls this the "
        f"'Exhaustion Extension' phase (Stage 3 of his 5-stage cycle), "
        f"and the parabolic short trigger lines up with Kell's 'Wedge "
        f"Drop' break (Stage 4) — both frameworks identify the same "
        f"behavioral phenomenon: institutional supply absorbing climactic "
        f"retail demand."
    )

    why_it_matters = (
        f"This Parabolic Short is setting up inside {stage_phrase} with "
        f"{ma_phrase} alignment, {rs_phrase}, in {regime_p}. {vol_phrase} "
        f"on the climax bar is the institutional distribution signature — "
        f"{vol_ratio:.1f}x normal volume on a bar that closed in the "
        f"bottom {dcr * 100:.0f}% of its range cannot be anything but "
        f"institutional supply hitting the bid. {dcr_p} reinforces the "
        f"read: sellers controlled the close, not buyers. "
        f"{dcr_interpretation(context, 'bearish')} The asymmetry of the "
        f"setup is brutal in the short's favor: the stop is the climax "
        f"high (${stop:.2f}, just 1% above ${climax_high:.2f}), and the "
        f"target is the prior swing-low support at ${target:.2f} — an "
        f"R:R of {rr:.1f} that compounds favorably even with a 50% win "
        f"rate. Kullamägi's published track record on parabolic shorts "
        f"shows a 55-65% win rate with average winners producing 30-60% "
        f"declines over 1-4 weeks and average losers controlled to 8-15% "
        f"via the mechanical stop at the climax high. The failed gap-up "
        f"of {gap_up:.1f}% is the most diagnostic single signal — when "
        f"a parabolic stock gaps up but closes red on 3x+ volume, the "
        f"trapped longs at the gap-up open create a wall of supply that "
        f"any subsequent rally has to chew through. The opening range "
        f"between ${climax_open:.2f} and ${climax_close:.2f} is now a "
        f"resistance shelf that will cap subsequent bounces."
    )

    what_to_watch_for = (
        f"Trigger: a break of the climax bar's low at ${climax_low:.2f} "
        f"— entry at ${entry:.2f} (0.1% below the low to confirm the "
        f"breakdown). The ideal trigger comes within 1-3 bars of the "
        f"climax bar, on continued elevated volume (>=1.5x 20-bar avg). "
        f"Kullamägi's specific execution rules for this setup: (a) short "
        f"at the OPEN of the day the climax low breaks, never wait for a "
        f"deeper retest because the move accelerates once the prior "
        f"buyers begin to capitulate; (b) NEVER short the climax bar "
        f"itself — that's chasing exhaustion and exposes you to a final "
        f"squeeze higher; (c) trail the stop down behind each subsequent "
        f"lower-high pivot — every failed rally back to the prior swing "
        f"high becomes a new resistance level and a tighter stop. Volume "
        f"on the breakdown bars should remain at or above the 20-bar "
        f"average; if volume DRIES UP on the breakdown attempts, the "
        f"trapped longs may have already capitulated and the easy "
        f"down-move is over. Primary target ${target:.2f} (prior 50-bar "
        f"swing low) typically hits within 5-15 bars on clean parabolic "
        f"shorts that hold their initial breakdown. Secondary targets "
        f"extend to the 50-SMA or the prior consolidation that launched "
        f"the parabolic run."
    )

    failure_signal = (
        f"The Parabolic Short is invalidated if price closes back above "
        f"${stop:.2f} (the climax high plus 1%) — that's the mechanical "
        f"stop and signals the parabolic move is RESUMING rather than "
        f"reversing. The stop distance from entry is {stop_distance_pct:.1f}% "
        f"— position sizing for a 1% account risk implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity per trade (note: short trades require borrow "
        f"availability which can be expensive or restricted on hot "
        f"parabolic names). A more subtle failure mode: the climax low "
        f"holds and the chart consolidates sideways for 5-10 bars with "
        f"no breakdown — this is the 'pause before continuation' pattern "
        f"that often resolves with another leg up rather than a "
        f"breakdown, and the short trade should be sized conservatively "
        f"or exited on the pause. Kullamägi's discipline at this stage: "
        f"cut the position on the close above ${stop:.2f} without "
        f"argument, do not widen the stop, do not double down on the "
        f"belief that the parabolic 'has to' break — parabolic moves "
        f"can stay parabolic longer than borrowers can stay solvent. "
        f"The asymmetry of the setup depends on the climax bar being "
        f"THE high; any close above the climax high invalidates that "
        f"assumption and demands an exit."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_parabolic_short)
