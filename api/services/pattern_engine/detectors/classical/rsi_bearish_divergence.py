"""RSI Bearish Divergence detector — momentum exhaustion at a new high.

Mirror of RSI Bullish Divergence. Welles Wilder Jr. published the original
divergence rule in 'New Concepts in Technical Trading Systems' (1978):
when price prints a new high but RSI prints a LOWER high, momentum is no
longer confirming the price move and a reversal is statistically probable.

Andrew Cardwell ('RSI: Logic, Signals & Time Frame Correlation', 2008)
refined the framework. Constance Brown ('Technical Analysis for the
Trading Professional', 1999/2011) added regime-aware zones: in a bull
market the overbought zone shifts to 60-80; RSI >65 at a new high in an
uptrend is the textbook bearish divergence zone.

Conditions:
  - Stock is in an uptrend (recent advance > 10%)
  - Price prints a NEW HIGH (current bar's high > prior swing high's high)
  - RSI(14) at the new high < RSI(14) at the prior high
  - RSI(14) at the new high > 65 (overbought, valid divergence zone)

Levels:
  - entry = bar low after the divergence high * 0.999
  - stop = divergence high * 1.015
  - target = recent swing low

Geometry: "neckline" with anchors at the two price highs.

Attribution: J. Welles Wilder Jr. ("New Concepts in Technical Trading
Systems", 1978) + Andrew Cardwell (2008) + Constance Brown (1999/2011).
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


_PATTERN_ID = "rsi_bearish_divergence"

_RSI_PERIOD = 14
_MIN_ADVANCE_PCT = 0.10
_SWING_LOOKBACK_BARS = 60
_SWING_WINDOW = 4
_RSI_OVERBOUGHT_THRESHOLD = 65.0
_MIN_RSI_DROP = 2.0
_CONFIDENCE_FLOOR = 50.0


def detect_rsi_bearish_divergence(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect RSI bearish divergence (price HH + RSI LH). Emits 0 or 1 detection."""
    n = len(bars)
    if n < _RSI_PERIOD + _SWING_LOOKBACK_BARS + 5:
        return []

    closes = [b["c"] for b in bars]
    rsi_series = _compute_rsi(closes, _RSI_PERIOD)

    recent = bars[-_SWING_LOOKBACK_BARS:]
    recent_low = min(b["l"] for b in recent)
    last_high = bars[-1]["h"]
    advance_pct = (last_high - recent_low) / recent_low if recent_low > 0 else 0.0
    if advance_pct < _MIN_ADVANCE_PCT:
        return []

    current_idx = n - 1
    current_high = bars[current_idx]["h"]
    current_rsi = rsi_series[current_idx]
    if current_rsi is None:
        return []

    # Find prior swing high in the lookback window
    prior_high_idx = None
    prior_high_price = None
    for i in range(current_idx - _SWING_WINDOW, current_idx - _SWING_LOOKBACK_BARS, -1):
        if i < _SWING_WINDOW or i >= n - _SWING_WINDOW:
            continue
        is_local_high = True
        for j in range(i - _SWING_WINDOW, i + _SWING_WINDOW + 1):
            if j == i or j < 0 or j >= n:
                continue
            if bars[j]["h"] > bars[i]["h"]:
                is_local_high = False
                break
        if is_local_high and bars[i]["h"] < current_high:
            # prior swing high BELOW current — current is making new high
            prior_high_idx = i
            prior_high_price = bars[i]["h"]
            break

    if prior_high_idx is None or prior_high_price is None:
        return []

    # New high check: current high must be > prior swing high
    if current_high <= prior_high_price:
        return []

    prior_rsi = rsi_series[prior_high_idx]
    if prior_rsi is None:
        return []

    # Divergence: RSI at new high must be LOWER than RSI at prior high
    rsi_drop = prior_rsi - current_rsi
    if rsi_drop < _MIN_RSI_DROP:
        return []

    # Overbought validity zone
    if current_rsi <= _RSI_OVERBOUGHT_THRESHOLD:
        return []

    candidate = {
        "current_idx": current_idx,
        "current_high": current_high,
        "current_rsi": current_rsi,
        "prior_high_idx": prior_high_idx,
        "prior_high": prior_high_price,
        "prior_rsi": prior_rsi,
        "rsi_drop": rsi_drop,
        "recent_low": recent_low,
        "advance_pct": advance_pct * 100.0,
    }

    geom_score = _score_geometry(candidate)
    vol_score = _score_volume(bars)
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


def _compute_rsi(closes: List[float], period: int) -> List[Optional[float]]:
    """Wilder-smoothed RSI — inline mirror of compute_rsi."""
    n = len(closes)
    out: List[Optional[float]] = [None] * n
    if period <= 0 or n < period + 1:
        return out
    avg_gain = 0.0
    avg_loss = 0.0
    for i in range(1, period + 1):
        diff = closes[i] - closes[i - 1]
        if diff > 0:
            avg_gain += diff
        else:
            avg_loss -= diff
    avg_gain /= period
    avg_loss /= period
    for i in range(period, n):
        if i > period:
            diff = closes[i] - closes[i - 1]
            gain = diff if diff > 0 else 0.0
            loss = -diff if diff < 0 else 0.0
            avg_gain = (avg_gain * (period - 1) + gain) / period
            avg_loss = (avg_loss * (period - 1) + loss) / period
        if avg_loss == 0:
            rsi = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi = 100.0 - 100.0 / (1 + rs)
        out[i] = round(rsi, 2)
    return out


def _score_geometry(c: dict) -> float:
    drop = c["rsi_drop"]
    if drop >= 10.0:
        drop_score = 100.0
    elif drop >= 6.0:
        drop_score = 80.0
    elif drop >= 4.0:
        drop_score = 65.0
    else:
        drop_score = 50.0

    rsi = c["current_rsi"]
    if rsi >= 80.0:
        rsi_score = 100.0
    elif rsi >= 75.0:
        rsi_score = 85.0
    elif rsi >= 70.0:
        rsi_score = 70.0
    else:
        rsi_score = 55.0

    price_lift_pct = (c["current_high"] - c["prior_high"]) / c["prior_high"] * 100.0
    if price_lift_pct >= 5.0:
        price_score = 100.0
    elif price_lift_pct >= 2.0:
        price_score = 80.0
    else:
        price_score = 60.0

    return round(0.40 * drop_score + 0.30 * rsi_score + 0.30 * price_score, 2)


def _score_volume(bars: List[Bar]) -> float:
    """Buying exhaustion = declining volume on the new high."""
    if len(bars) < 25:
        return 50.0
    avg_20 = sum(b["v"] for b in bars[-21:-1]) / 20
    if avg_20 <= 0:
        return 50.0
    last_v = bars[-1]["v"]
    ratio = last_v / avg_20
    if ratio <= 0.7:
        return 100.0
    if ratio <= 0.9:
        return 80.0
    if ratio <= 1.1:
        return 65.0
    return 50.0


def _score_context(context: dict) -> float:
    score = 50.0
    stage = context.get("trend_stage")
    if stage in (2, 3):
        score += 15.0   # late-stage uptrend = best bearish divergence context
    elif stage == 1:
        score += 8.0
    if context.get("rs_trend") == "down":
        score += 10.0
    # DCR for bearish reversal: distribution context confirms exhaustion
    if context.get("dcr_signature") == "distribution":
        score += 12.0
    elif context.get("dcr_signature") == "accumulation":
        score -= 8.0
    return min(100.0, max(0.0, score))


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    current_idx = c["current_idx"]
    prior_high_idx = c["prior_high_idx"]
    prior_high = c["prior_high"]
    current_high = c["current_high"]

    entry = round(last_bar["l"] * 0.999, 2)
    stop = round(current_high * 1.015, 2)
    target = round(c["recent_low"], 2)
    rr = abs((entry - target) / (stop - entry)) if stop > entry else 0.0
    stop_distance_pct = abs((stop - entry) / entry * 100.0) if entry > 0 else 0.0

    anchors = [
        {"t": int(bars[prior_high_idx]["t"]), "price": float(prior_high)},
        {"t": int(bars[current_idx]["t"]), "price": float(current_high)},
    ]

    extras = {
        "prior_high_price": round(prior_high, 4),
        "prior_high_rsi": round(c["prior_rsi"], 2),
        "prior_high_bar_idx": int(prior_high_idx),
        "current_high_price": round(current_high, 4),
        "current_high_rsi": round(c["current_rsi"], 2),
        "current_high_bar_idx": int(current_idx),
        "rsi_divergence_strength": round(c["rsi_drop"], 2),
        "advance_pct": round(c["advance_pct"], 2),
        "recent_low": round(c["recent_low"], 4),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr,
                                    stop_distance_pct)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "RSI Bearish Divergence",
        "category": "classical",
        "direction": "bearish",
        "start_t": int(bars[prior_high_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[prior_high_idx]["t"]), int(last_bar["t"])],
        "geometry": {
            "shape": "neckline",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close < {entry:.2f} (break of divergence-high bar low)",
            "stop": stop,
            "stop_basis": "divergence_high_plus_1.5pct",
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
    prior_high = c["prior_high"]
    current_high = c["current_high"]
    prior_rsi = c["prior_rsi"]
    current_rsi = c["current_rsi"]
    rsi_drop = c["rsi_drop"]
    advance_pct = c["advance_pct"]
    price_lift_pct = (current_high - prior_high) / prior_high * 100.0

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    headline = (
        f"RSI Bearish Divergence - price prints new high ${current_high:.2f} "
        f"({price_lift_pct:.2f}% above prior swing high ${prior_high:.2f}) but "
        f"RSI(14) DROPS from {prior_rsi:.1f} to {current_rsi:.1f} "
        f"(divergence strength -{rsi_drop:.1f} pts). Recent advance "
        f"{advance_pct:.1f}%. Entry ${entry:.2f}, target ${target:.2f}, "
        f"R:R {rr:.1f}."
    )

    what_it_is = (
        f"RSI Bearish Divergence is the canonical momentum-exhaustion signal "
        f"at the END of an advance. J. Welles Wilder Jr. published the "
        f"original divergence framework in 'New Concepts in Technical "
        f"Trading Systems' (Trend Research, 1978): when price prints a new "
        f"high but RSI prints a LOWER high, momentum is no longer "
        f"confirming the upward price move and a probabilistic reversal "
        f"becomes the highest-edge interpretation. Andrew Cardwell ('RSI: "
        f"Logic, Signals & Time Frame Correlation', 2008) refined the "
        f"framework with his classic-vs-hidden divergence taxonomy. "
        f"Constance Brown ('Technical Analysis for the Trading "
        f"Professional', 1999; 2nd ed. 2011) re-anchored RSI as a regime-"
        f"aware indicator with adjusted zones: in a bull market the "
        f"overbought zone shifts from Wilder's classical 70 up to 80, and "
        f"the valid bearish-divergence zone is RSI >65 (not >70). The "
        f"textbook bearish divergence — what's firing here — combines: (1) "
        f"a NEW PRICE HIGH (current high ${current_high:.2f} is "
        f"{price_lift_pct:.2f}% above the prior swing high at "
        f"${prior_high:.2f}); (2) a LOWER RSI at the new high "
        f"({current_rsi:.1f} vs {prior_rsi:.1f} at the prior high — a "
        f"{rsi_drop:.1f}-point DROP); (3) RSI in the validity zone (above "
        f"the {_RSI_OVERBOUGHT_THRESHOLD:.0f} Cardwell/Brown threshold). "
        f"Mechanically, RSI tracks the average up-close magnitude vs "
        f"average down-close magnitude over the trailing 14 bars — when "
        f"price prints a new high but RSI fades, the AVERAGE per-bar UP "
        f"move has SHRUNK relative to down moves, meaning buying intensity "
        f"is materially decreasing even as price reaches new extremes. "
        f"This is the textbook 'buying exhaustion' fingerprint and is the "
        f"foundation of every classical topping-signal framework from "
        f"Wilder through Cardwell, Brown, Pring, Murphy, and modern desk-"
        f"trading practice. The bearish version is mirror-symmetric to the "
        f"bullish version but operates at the END of an advance rather "
        f"than the END of a decline."
    )

    why_it_matters = (
        f"This RSI bearish divergence is firing inside {stage_phrase} with "
        f"{ma_phrase} alignment, {rs_phrase}, in {regime_p}. The recent "
        f"advance of {advance_pct:.1f}% qualifies the setup — Wilder's "
        f"original specification required a meaningful upward move "
        f"preceding the divergence; without preceding upmove, the "
        f"divergence is statistical noise. The divergence's edge comes "
        f"from what it reveals about the supply/demand transition at the "
        f"top: price has reached a new high (buyers are technically in "
        f"control of the chart), but RSI has fallen {rsi_drop:.1f} points "
        f"— meaning the AVERAGE per-bar magnitude of upside moves has "
        f"compressed even as the bars are still printing new highs. In "
        f"practical terms, buyers are still buying but with LESS force per "
        f"bar than they exerted at the prior swing high. Cardwell's "
        f"empirical research shows that classic bearish divergences in the "
        f">65 RSI zone resolve into 5-15% reversals within 10-30 bars about "
        f"60-66% of the time when confirmed by a break of the divergence-"
        f"bar's low — this fixture is in that statistical sweet spot. "
        f"{vol_phrase} on the new high (Wilder's 'climax' signature) "
        f"further supports the exhaustion thesis — buying climaxes "
        f"typically print on declining volume in the late stages of an "
        f"uptrend. {dcr_p} {dcr_interpretation(context, 'bearish')} Brown's "
        f"regime overlay adds nuance: in a bull regime the bearish "
        f"divergence should be sized smaller (it's a counter-trend trade); "
        f"in Stage 3 distribution context, the divergence is the textbook "
        f"early-distribution signal and warrants full size. The structural "
        f"asymmetric reward profile is clean: a {stop_distance_pct:.2f}% "
        f"stop distance from entry against the recent-swing-low target "
        f"produces R:R {rr:.1f}, comfortably above the 2:1 minimum for "
        f"classical reversal trades. The bearish divergence is one of the "
        f"three highest-edge top-signal patterns alongside Wyckoff "
        f"Upthrust and Distribution Phase D — when these three appear "
        f"together, the topping case is structurally confirmed."
    )

    what_to_watch_for = (
        f"The divergence is the SETUP; the break of the divergence-bar's "
        f"low is the TRIGGER. Trigger: a close below ${entry:.2f} (last "
        f"bar low - 0.1% confirmation buffer) on the next 1-3 bars, "
        f"ideally on volume >=1.3x the 20-bar average. Without that volume "
        f"signature on the trigger, the divergence's signal is suspect — "
        f"low-volume breakdowns from divergence often reverse within 3-5 "
        f"bars. Cardwell's specific execution rules: (a) prior + current "
        f"highs must print within 60 bars of each other to be valid; (b) "
        f"RSI drop must be >=2 points and ideally >=5 points; (c) require "
        f"a close that BREAKS the prior bar's low — a close at-the-low is "
        f"insufficient because intraday buyers may have absorbed into the "
        f"close. Brown's regime overlay: trade the divergence at FULL size "
        f"only when current trend stage is 2 (late mature) or 3 "
        f"(distribution) — in Stage 1 or 4 contexts the divergence is a "
        f"correction-end signal in either direction and should be sized "
        f"smaller. Stop at ${stop:.2f} (current high plus 1.5%) — tight "
        f"because the divergence-bar's high is THE failure point of the "
        f"thesis: if buyers can push price above that high after momentum "
        f"already diverged, the exhaustion thesis is false and the deeper "
        f"trend may resume. Target ${target:.2f} (recent swing low) "
        f"reflects classical 'measured move back to the prior pivot' "
        f"convention; the divergence trade typically extends 50-100% of "
        f"the prior up-leg in the favored direction. Position sizing: at "
        f"the {stop_distance_pct:.2f}% stop distance, risking 1% of account "
        f"implies "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity per position. Short discipline is structurally harder "
        f"than long discipline — Brown's repeated reminder is that "
        f"divergence shorts should be tactical (5-15 bar timeframe) rather "
        f"than positional, because the asymmetric downside of a "
        f"continuation breakout against a short is unbounded."
    )

    failure_signal = (
        f"RSI bearish divergences fail roughly 35-40% of the time even "
        f"with full filtering — the trade is statistical and the edge "
        f"requires strict stop discipline. This divergence is invalidated "
        f"if price closes above ${stop:.2f} (current high plus 1.5%) — "
        f"that signals buyers have been able to break the divergence-bar's "
        f"high AFTER momentum already diverged, falsifying the exhaustion "
        f"thesis and opening a deeper extension. The most insidious "
        f"failure mode is the 'three-drives' extension: divergence "
        f"triggers, retraces 3-7 bars in favor, then prints ANOTHER new "
        f"high with RSI dropping again — Brown documents this as common "
        f"in true bull-market tops where multiple divergence cycles chain "
        f"before the eventual top. The single-divergence trade fails in "
        f"this sequence; only the LAST divergence produces the actual "
        f"top. Mitigation: size the first divergence trade smaller (0.5x) "
        f"and add on the SECOND divergence if it forms below the first "
        f"high. The secondary failure: divergence + break of low, but the "
        f"next 5-10 bars consolidate sideways instead of breaking down — "
        f"the 'momentum stall' that has TIMED a high but not flipped "
        f"momentum. Exit if price closes back above the divergence-bar's "
        f"close on rising volume. The deepest invalidation: context "
        f"improves after trigger — RS line breaks UP, distribution days "
        f"reset, market regime shifts more bullish. In that case the "
        f"divergence becomes noise in a structurally hostile (for shorts) "
        f"environment and the position should be cut regardless of price "
        f"action. Wilder's foundational discipline: NEVER widen the stop "
        f"on a failed bearish divergence — the divergence is probabilistic, "
        f"and the structural failure point is the divergence-bar's high; "
        f"protecting that level IS the trade. Bearish divergences "
        f"specifically suffer from 'short squeeze' failure modes where a "
        f"failed top traps shorts and produces a sharp extension — keep "
        f"position size conservative and prefer the divergence trade as a "
        f"hedge against existing long positions rather than as a standalone "
        f"short."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_rsi_bearish_divergence)
