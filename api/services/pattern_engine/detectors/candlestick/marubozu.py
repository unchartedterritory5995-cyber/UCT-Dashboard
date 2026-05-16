"""Marubozu detector — full-body conviction candle. Steve Nison (1991).

A Marubozu is a single Japanese candlestick where the body spans nearly
the entire bar range — minimal or zero wicks in both directions. The name
translates to "close-cropped" or "bald" in Japanese, describing a candle
that has been shaved of its wicks. Steve Nison introduced the pattern
to Western traders in "Japanese Candlestick Charting Techniques" (New York
Institute of Finance, 1991), and Greg Morris provided extensive empirical
analysis in "Candlestick Charting Explained" (McGraw-Hill, 2006).

A bullish Marubozu (white/green) means buyers controlled the entire bar
from open to close without sellers having a meaningful pushback at any
point — no upper wick = sellers couldn't push price back at the high,
no lower wick = buyers never let price retreat from the open. A bearish
Marubozu (black/red) means sellers controlled the entire bar.

The DCR (Daily Closing Range) filter is the mechanistic key:
  Bullish Marubozu: DCR >= 0.95 (closed in top 5% of bar's range)
  Bearish Marubozu: DCR <= 0.05 (closed in bottom 5% of bar's range)

Conditions:
  - |close - open| >= 90% of (high - low)  [body >= 90% of range]
  - Upper wick <= 5% of range              [sellers couldn't push back]
  - Lower wick <= 5% of range              [buyers never retreated]
  - Range >= 1.2x 20-bar avg range         [above-average expansion]
  - Volume >= 1.3x 20-bar avg volume       [above-average participation]
  - Bullish: up bar + DCR >= 0.95
  - Bearish: down bar + DCR <= 0.05
  - Direction determined by up/down bar

Levels (bullish):
  - entry = high * 1.001
  - stop = low
  - target = entry + bar_range * 2

Geometry: candle_mark. Extras: body_pct_of_range, upper_wick_pct,
  lower_wick_pct, range_vs_avg, volume_ratio, dcr, is_bullish.

Attribution: Steve Nison, "Japanese Candlestick Charting Techniques"
(1991). Greg Morris, "Candlestick Charting Explained" (2006).
"""
from __future__ import annotations

import uuid
import time
from typing import List

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import (
    dcr_phrase, dcr_interpretation, ma_alignment_phrase, regime_phrase,
    rs_trend_phrase, trend_stage_description, volume_signature_phrase,
)
from api.services.pattern_engine.primitives.dcr import compute_dcr
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "marubozu"

_MIN_BODY_PCT = 0.90         # body >= 90% of range (Nison's "pure" marubozu threshold)
_MAX_WICK_PCT = 0.05         # each wick <= 5% of range
_MIN_RANGE_RATIO = 1.20      # range >= 1.2x 20-bar avg (above-average expansion)
_MIN_VOLUME_RATIO = 1.30     # volume >= 1.3x 20-bar avg
_AVG_LOOKBACK = 20
_BULL_DCR_MIN = 0.95         # bullish marubozu: closed at top of range
_BEAR_DCR_MAX = 0.05         # bearish marubozu: closed at bottom of range
_CONFIDENCE_FLOOR = 50.0
# Small epsilon for floating-point-safe boundary comparisons.  Rounded OHLC values
# (2-4 dp) can produce tiny floating-point residuals that cause exact-threshold bars
# to fail strict > / < tests.  1e-9 is well below any real price-data granularity.
_EPS = 1e-9


def detect_marubozu(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Marubozu (bullish or bearish). Returns 0 or 1 detection."""
    n = len(bars)
    if n < _AVG_LOOKBACK + 2:
        return []

    last = bars[-1]
    bar_range = last["h"] - last["l"]
    if bar_range <= 0:
        return []

    body = abs(last["c"] - last["o"])
    body_pct = body / bar_range

    # Body must be >= 90% of range (epsilon-tolerant for floating-point boundaries)
    if body_pct < _MIN_BODY_PCT - _EPS:
        return []

    # Compute wick percentages
    if last["c"] >= last["o"]:  # bullish (up bar)
        upper_wick = last["h"] - last["c"]
        lower_wick = last["o"] - last["l"]
        is_bullish = True
    else:                        # bearish (down bar)
        upper_wick = last["h"] - last["o"]
        lower_wick = last["c"] - last["l"]
        is_bullish = False

    upper_wick_pct = upper_wick / bar_range
    lower_wick_pct = lower_wick / bar_range

    if upper_wick_pct > _MAX_WICK_PCT + _EPS or lower_wick_pct > _MAX_WICK_PCT + _EPS:
        return []

    # Average range and volume
    lookback = bars[-_AVG_LOOKBACK - 1:-1]
    avg_range = sum(b["h"] - b["l"] for b in lookback) / len(lookback) if lookback else bar_range
    avg_vol = sum(b["v"] for b in lookback) / len(lookback) if lookback else last["v"]
    range_ratio = bar_range / avg_range if avg_range > 0 else 1.0
    vol_ratio = last["v"] / avg_vol if avg_vol > 0 else 1.0

    if range_ratio < _MIN_RANGE_RATIO - _EPS:
        return []
    if vol_ratio < _MIN_VOLUME_RATIO - _EPS:
        return []

    # DCR filter (epsilon-tolerant for floating-point boundary values)
    dcr_val = compute_dcr(last)
    if is_bullish and dcr_val < _BULL_DCR_MIN - _EPS:
        return []
    if not is_bullish and dcr_val > _BEAR_DCR_MAX + _EPS:
        return []

    direction = "bullish" if is_bullish else "bearish"

    candidate = {
        "last": last,
        "bar_range": bar_range,
        "body": body,
        "body_pct": body_pct,
        "upper_wick_pct": upper_wick_pct,
        "lower_wick_pct": lower_wick_pct,
        "range_ratio": range_ratio,
        "vol_ratio": vol_ratio,
        "dcr": dcr_val,
        "is_bullish": is_bullish,
        "avg_range": avg_range,
        "avg_vol": avg_vol,
    }

    geom_score = _score_geometry(candidate)
    vol_score = _score_volume(candidate)
    ctx_score = _score_context(context, is_bullish)
    hist_score = 50.0

    confidence = round(
        0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
    )
    if confidence < _CONFIDENCE_FLOOR:
        return []

    return [_build_detection(bars, candidate, confidence, context,
                             geom_score, vol_score, ctx_score, hist_score, direction)]


def _score_geometry(c: dict) -> float:
    body_pct = c["body_pct"]
    if body_pct >= 0.98:
        body_score = 100.0
    elif body_pct >= 0.95:
        body_score = 85.0
    elif body_pct >= _MIN_BODY_PCT:
        body_score = 65.0
    else:
        body_score = 0.0

    range_ratio = c["range_ratio"]
    if range_ratio >= 2.0:
        range_score = 100.0
    elif range_ratio >= 1.5:
        range_score = 80.0
    elif range_ratio >= _MIN_RANGE_RATIO:
        range_score = 60.0
    else:
        range_score = 0.0

    # DCR: closer to 1.0 (bull) or 0.0 (bear) = more conviction
    dcr = c["dcr"]
    if c["is_bullish"]:
        dcr_score = 100.0 if dcr >= 0.99 else (85.0 if dcr >= 0.97 else 65.0)
    else:
        dcr_score = 100.0 if dcr <= 0.01 else (85.0 if dcr <= 0.03 else 65.0)

    return round(min(100.0, 0.35 * body_score + 0.35 * range_score + 0.30 * dcr_score), 2)


def _score_volume(c: dict) -> float:
    vr = c["vol_ratio"]
    if vr >= 3.0:
        return 100.0
    if vr >= 2.0:
        return 85.0
    if vr >= 1.5:
        return 70.0
    return 55.0


def _score_context(context: dict, is_bullish: bool) -> float:
    score = 50.0
    stage = context.get("trend_stage")
    if is_bullish:
        if stage == 2:
            score += 20.0
        elif stage == 1:
            score += 10.0
        elif stage == 4:
            score -= 10.0
        dcr_sig = context.get("dcr_signature")
        if dcr_sig == "accumulation":
            score += 10.0
        elif dcr_sig == "distribution":
            score -= 8.0
    else:
        if stage == 4:
            score += 20.0
        elif stage == 3:
            score += 10.0
        elif stage == 2:
            score -= 10.0
        dcr_sig = context.get("dcr_signature")
        if dcr_sig == "distribution":
            score += 10.0
        elif dcr_sig == "accumulation":
            score -= 8.0
    align = context.get("ma_alignment")
    if is_bullish and align == "stacked_bullish":
        score += 8.0
    elif not is_bullish and align == "stacked_bearish":
        score += 8.0
    return min(100.0, max(0.0, score))


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score, direction) -> Detection:
    last = c["last"]
    last_bar = bars[-1]
    bar_range = c["bar_range"]
    is_bullish = c["is_bullish"]

    if is_bullish:
        entry = round(last["h"] * 1.001, 2)
        stop = round(last["l"], 2)
        target = round(entry + bar_range * 2.0, 2)
        rr = (target - entry) / (entry - stop) if entry > stop else 0.0
    else:
        entry = round(last["l"] * 0.999, 2)
        stop = round(last["h"], 2)
        target = round(entry - bar_range * 2.0, 2)
        rr = (entry - target) / (stop - entry) if stop > entry else 0.0

    stop_pct = abs(entry - stop) / entry * 100 if entry > 0 else 0.0

    anchors = [{"t": int(last["t"]), "price": float(last["c"])}]
    extras = {
        "body_pct_of_range": round(c["body_pct"], 4),
        "upper_wick_pct": round(c["upper_wick_pct"], 4),
        "lower_wick_pct": round(c["lower_wick_pct"], 4),
        "range_vs_avg": round(c["range_ratio"], 3),
        "volume_ratio": round(c["vol_ratio"], 3),
        "dcr": round(c["dcr"], 4),
        "is_bullish": bool(is_bullish),
        "bar_range": round(bar_range, 4),
        "avg_range": round(c["avg_range"], 4),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr, stop_pct, direction)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Marubozu",
        "category": "candlestick",
        "direction": direction,
        "start_t": int(last["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(last["t"])],
        "geometry": {"shape": "candle_mark", "anchors": anchors, "extras": extras},
        "levels": {
            "entry": entry,
            "entry_condition": (
                f"{'Buy above ' + str(entry) + ' (bar high + 0.1%)' if is_bullish else 'Sell below ' + str(entry) + ' (bar low - 0.1%). Confirm borrow.'}"
            ),
            "stop": stop,
            "stop_basis": "nr7_bar_opposite_extreme",
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


def _compose_narrative(c, context, entry, stop, target, rr, stop_pct, direction) -> dict:
    last = c["last"]
    bar_range = c["bar_range"]
    body_pct = c["body_pct"]
    upper_wick_pct = c["upper_wick_pct"]
    lower_wick_pct = c["lower_wick_pct"]
    range_ratio = c["range_ratio"]
    vol_ratio = c["vol_ratio"]
    dcr = c["dcr"]
    is_bullish = c["is_bullish"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))
    dcr_read = dcr_interpretation(context, direction)

    bar_type = "bullish (white/green)" if is_bullish else "bearish (black/red)"
    borrow_note = "" if is_bullish else " Confirm borrow availability before entering short."

    headline = (
        f"{'Bullish' if is_bullish else 'Bearish'} Marubozu — body {body_pct * 100:.1f}% of range, "
        f"upper wick {upper_wick_pct * 100:.1f}%, lower wick {lower_wick_pct * 100:.1f}%. "
        f"Range {range_ratio:.1f}x avg, volume {vol_ratio:.1f}x avg. DCR {dcr:.3f}. "
        f"Entry ${entry:.2f}, stop ${stop:.2f}, target ${target:.2f}, R:R {rr:.1f}.{borrow_note}"
    )

    what_it_is = (
        f"The Marubozu (Japanese: 'close-cropped' or 'bald') is the single-bar "
        f"Japanese candlestick representing PURE CONVICTION in one direction — "
        f"a bar whose entire range is consumed by the body with minimal or zero "
        f"wicks. Steve Nison introduced the pattern to Western markets in "
        f"'Japanese Candlestick Charting Techniques' (New York Institute of "
        f"Finance, 1991), and Greg Morris provided extensive empirical analysis "
        f"in 'Candlestick Charting Explained' (McGraw-Hill, 2006). The anatomy "
        f"communicates a precise message: (1) no lower wick (or < 5% of range) "
        f"= {'buyers supported price from the open, sellers never got a moment of control' if is_bullish else 'sellers maintained control from the open, buyers never got traction'}; "
        f"(2) no upper wick (or < 5% of range) = {'price moved steadily higher through the session without any meaningful rejection at the high — the close IS near the high' if is_bullish else 'price fell to the close with no meaningful recovery attempt — bears maintained control to the final tick'}; "
        f"(3) body >= 90% of range = {'open-to-close move consumed essentially the entire bar range, leaving almost nothing for intra-bar volatility' if is_bullish else 'the decline from open to close was relentless'}. "
        f"This specific fixture shows a {bar_type} Marubozu with body at "
        f"{body_pct * 100:.1f}% of range (threshold: 90%), upper wick "
        f"{upper_wick_pct * 100:.2f}% of range, lower wick {lower_wick_pct * 100:.2f}% "
        f"of range — both well within Nison's 5% wick threshold. The DCR of "
        f"{dcr:.3f} is the mechanistic confirmation: {'DCR >= 0.95 means the close landed in the top 5% of the bar' + chr(39) + 's range — the maximum bullish session close quality' if is_bullish else 'DCR <= 0.05 means the close landed in the bottom 5% of the bar' + chr(39) + 's range — the maximum bearish session close quality'}. "
        f"The range of {range_ratio:.1f}x the 20-bar average is the FORCE "
        f"multiplier: a Marubozu on below-average range is a quiet conviction "
        f"bar; one on {range_ratio:.1f}x average range signals a session where "
        f"the directional commitment was both pure AND powerful. Volume at "
        f"{vol_ratio:.1f}x average confirms institutional participation behind "
        f"the conviction bar, not retail noise."
    )

    why_it_matters = (
        f"This Marubozu is printing in {stage_phrase} with {ma_phrase} MA "
        f"alignment and {rs_phrase}, in {regime_p}. The structural read: "
        f"(1) A Marubozu bar is the candlestick equivalent of a 'clean sweep' "
        f"session where one side had no opposition. The body-to-range ratio "
        f"of {body_pct * 100:.1f}% means the difference between the open and "
        f"close consumed {body_pct * 100:.1f}% of the total high-low range — "
        f"the remaining {(1 - body_pct) * 100:.1f}% was split between upper "
        f"and lower wicks that total only {(upper_wick_pct + lower_wick_pct) * 100:.2f}% "
        f"of range combined. (2) The above-average range ({range_ratio:.1f}x) "
        f"means this conviction bar expanded the price action BEYOND typical "
        f"session volatility — Nison's teaching: a Marubozu on average range "
        f"is 'everyday conviction'; one on 1.5x+ average range is 'institutional "
        f"statement.' (3) Volume at {vol_ratio:.1f}x average: the institutional "
        f"participation amplifies the signal — high-volume Marubozu bars are "
        f"Morris's 'reliable continuation signal'; low-volume Marubozus are "
        f"suspect (news-driven without follow-through). {dcr_read} {dcr_p}."
    )

    what_to_watch_for = (
        f"Entry is ${entry:.2f} ({'bar high ' + str(last['h']) + ' + 0.1% buffer' if is_bullish else 'bar low ' + str(last['l']) + ' - 0.1% buffer'}).{borrow_note} "
        f"Nison's execution principle: take the trade on the {'FIRST close above the Marubozu high' if is_bullish else 'FIRST close below the Marubozu low'} — "
        f"the Marubozu bar itself is the setup bar, the next bar's "
        f"{'close above the high' if is_bullish else 'close below the low'} is the trigger. "
        f"Stop at ${stop:.2f} ({'Marubozu bar low' if is_bullish else 'Marubozu bar high'}): "
        f"Nison's framework: the entire bar IS the pattern — if price revisits "
        f"the {'low' if is_bullish else 'high'} of a Marubozu bar after the trigger, "
        f"the pattern has failed and the 'pure conviction' reading is wrong. "
        f"Target: ${target:.2f} (entry + {'2x' if is_bullish else '2x'} bar range of "
        f"${bar_range:.4f} = ${bar_range * 2:.4f} measured move). Morris's "
        f"empirical finding from 'Candlestick Charting Explained': full-body "
        f"Marubozus with above-average volume produce 2x-range continuation "
        f"moves in roughly 60-65% of cases when the context trend is supportive. "
        f"Position sizing: {stop_pct:.1f}% stop distance from entry. R:R "
        f"{rr:.1f} provides adequate expectancy at a 60% continuation rate."
    )

    failure_signal = (
        f"The Marubozu fails in two specific ways. Failure Mode 1 — the "
        f"'Marubozu reversal': the session AFTER the Marubozu prints an "
        f"outside bar in the opposite direction, completely engulfing the "
        f"Marubozu bar. This is the 'conviction collapse' signature — the "
        f"institutional buyers (or sellers) who drove the Marubozu have "
        f"already exhausted their order book and the opposing side is now "
        f"dominant. Nison specifically names this pattern 'engulfing reversal' "
        f"and classifies it as a high-confidence reversal signal when it "
        f"immediately follows a Marubozu. Exit immediately on the close "
        f"that engulfs the Marubozu bar — do not wait for the structural "
        f"stop at ${stop:.2f}. Failure Mode 2 — the 'gap-and-stall': price "
        f"gaps in the Marubozu's direction on the next open but immediately "
        f"stalls and reverses. The gap amplifies the paper gain momentarily "
        f"but the stall signals the conviction bar had no follow-through. "
        f"If the bar following the gap closes within the Marubozu's range, "
        f"exit at the close — the setup is failing. Structural stop: "
        f"${stop:.2f}. {borrow_note} {dcr_p}. Morris's caveat from "
        f"'Candlestick Charting Explained': Marubozus in choppy, range-"
        f"bound markets have much lower continuation rates (~45%) than in "
        f"trending markets (~65%) — the trend context is the primary "
        f"modifier of expected edge on this pattern."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_marubozu)
