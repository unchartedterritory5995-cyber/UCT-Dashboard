"""Wyckoff Upthrust detector — Phase C distribution false breakout (mirror of Spring).

Mirror of wyckoff_spring. Upthrust is the climactic Phase C event in a
multi-week DISTRIBUTION: a false breakout ABOVE the trading range's
resistance that traps longs and weak-handed shorts-covering, immediately
reversed on a "Sign of Weakness" volume rejection. The Upthrust marks
the END of the distribution phase and the START of the markdown phase.

Conditions: mirror of spring (false breakout above resistance, reclaim
inside range with expanding volume, distribution-volume signature
through the range — increasing or stable late-stage volume).

Levels:
  - entry = trading_range_low * 0.999 (Wyckoff "Sign of Weakness" breakdown)
  - stop = upthrust_high * 1.015
  - target = trading_range_low - (trading_range_height * 2)

Geometry: "horizontal_line" at resistance level.
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


_PATTERN_ID = "wyckoff_upthrust"

_MIN_RANGE_BARS = 15
_MAX_RANGE_BARS = 60
_MAX_RANGE_DEPTH = 0.18
_MIN_RANGE_DEPTH = 0.03
_MIN_UPTHRUST_DEPTH = 0.005
_MAX_UPTHRUST_DEPTH = 0.05
_MAX_UPTHRUST_BARS = 3
_MAX_RECLAIM_LAG = 3
_RECLAIM_VOL_MIN = 1.2
_CONFIDENCE_FLOOR = 50.0


def detect_wyckoff_upthrust(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Wyckoff Upthrust patterns. Emits 0 or 1 detection."""
    n = len(bars)
    if n < _MIN_RANGE_BARS + _MAX_UPTHRUST_BARS + _MAX_RECLAIM_LAG + 5:
        return []

    # Hostile-context gate — Stage 2 + stacked bullish + RS up = reject
    if _hostile_context(context):
        return []

    candidates = _enumerate_candidates(bars)
    if not candidates:
        return []

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for c in candidates:
        geom_score = _score_geometry(c)
        vol_score = _score_volume(c)
        ctx_score = _score_context(context)
        hist_score = 50.0
        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue
        if confidence > best_confidence:
            best_confidence = confidence
            best_candidate = c
            best_scores = (geom_score, vol_score, ctx_score, hist_score)

    if best_candidate is None:
        return []

    geom_score, vol_score, ctx_score, hist_score = best_scores
    d = _build_detection(bars, best_candidate, best_confidence, context,
                        geom_score, vol_score, ctx_score, hist_score)
    return [d]


def _enumerate_candidates(bars: List[Bar]) -> List[dict]:
    """Find (range, upthrust_high, reclaim_bar) triples."""
    n = len(bars)
    last_idx = n - 1
    out: List[dict] = []

    for upthrust_back in range(8):
        upthrust_high_idx = last_idx - upthrust_back
        if upthrust_high_idx < _MIN_RANGE_BARS:
            continue

        for range_len in range(_MAX_RANGE_BARS, _MIN_RANGE_BARS - 1, -1):
            range_end = upthrust_high_idx - 1
            range_start = range_end - range_len + 1
            if range_start < 0:
                continue

            range_window = bars[range_start:range_end + 1]
            range_high = max(b["h"] for b in range_window)
            range_low = min(b["l"] for b in range_window)
            mid = (range_high + range_low) / 2.0
            if mid <= 0:
                continue
            depth = (range_high - range_low) / mid
            if depth >= _MAX_RANGE_DEPTH or depth < _MIN_RANGE_DEPTH:
                continue

            # Upthrust: bar's HIGH above range_high
            upthrust_high = bars[upthrust_high_idx]["h"]
            if upthrust_high <= range_high:
                continue
            upthrust_depth = (upthrust_high - range_high) / range_high if range_high > 0 else 0.0
            if upthrust_depth < _MIN_UPTHRUST_DEPTH:
                continue
            if upthrust_depth > _MAX_UPTHRUST_DEPTH:
                continue

            upthrust_bars = 1
            for back in range(1, _MAX_UPTHRUST_BARS):
                prev_idx = upthrust_high_idx - back
                if prev_idx < 0 or prev_idx <= range_end:
                    break
                if bars[prev_idx]["h"] > range_high:
                    upthrust_bars += 1
                else:
                    break
            upthrust_start_idx = upthrust_high_idx - (upthrust_bars - 1)

            # Reclaim BELOW range high (rejection back into range)
            reclaim_idx = None
            for j in range(upthrust_high_idx, min(upthrust_high_idx + 1 + _MAX_RECLAIM_LAG, n)):
                if bars[j]["c"] < range_high:
                    reclaim_idx = j
                    break
            if reclaim_idx is None:
                continue

            upthrust_vol = sum(bars[i]["v"] for i in range(upthrust_start_idx, upthrust_high_idx + 1)) / upthrust_bars
            reclaim_vol = bars[reclaim_idx]["v"]
            if upthrust_vol <= 0:
                continue
            reclaim_vol_ratio = reclaim_vol / upthrust_vol
            if reclaim_vol_ratio < _RECLAIM_VOL_MIN:
                continue

            # Distribution signature: stable-or-rising volume through the range
            half = len(range_window) // 2
            first_half_vol = sum(b["v"] for b in range_window[:half]) / max(1, half)
            second_half_vol = sum(b["v"] for b in range_window[half:]) / max(1, len(range_window) - half)
            distribution_vol_ratio = second_half_vol / first_half_vol if first_half_vol > 0 else 1.0
            # Distribution: late-stage volume should be stable or expanding
            # (NOT declining hard, which would suggest accumulation).
            if distribution_vol_ratio < 0.75:
                continue

            range_height = range_high - range_low
            range_height_pct = range_height / range_low * 100 if range_low > 0 else 0.0

            out.append({
                "range_start_idx": range_start,
                "range_end_idx": range_end,
                "range_high": float(range_high),
                "range_low": float(range_low),
                "range_height": float(range_height),
                "range_height_pct": float(range_height_pct),
                "range_bars": int(range_len),
                "range_depth": float(depth),
                "upthrust_start_idx": upthrust_start_idx,
                "upthrust_high_idx": upthrust_high_idx,
                "upthrust_high": float(upthrust_high),
                "upthrust_depth": float(upthrust_depth),
                "upthrust_bars_above": int(upthrust_bars),
                "upthrust_vol": float(upthrust_vol),
                "reclaim_bar_idx": int(reclaim_idx),
                "reclaim_close": float(bars[reclaim_idx]["c"]),
                "reclaim_vol": float(reclaim_vol),
                "reclaim_volume_ratio": float(reclaim_vol_ratio),
                "distribution_volume_signature": float(distribution_vol_ratio),
            })
            break

    return out


def _hostile_context(context: dict) -> bool:
    """Reject only if Stage 2 + stacked_bullish + rs_trend up all coincide."""
    stage_bad = context.get("trend_stage") == 2
    ma_bad = context.get("ma_alignment") == "stacked_bullish"
    rs_bad = context.get("rs_trend") == "up"
    return stage_bad and ma_bad and rs_bad


def _score_geometry(c: dict) -> float:
    """Mirror of spring geometry scoring."""
    depth = c["upthrust_depth"]
    if 0.005 <= depth <= 0.025:
        depth_score = 100.0
    elif depth < 0.005:
        depth_score = max(0.0, depth / 0.005 * 100.0)
    else:
        depth_score = max(0.0, (_MAX_UPTHRUST_DEPTH - depth) / (_MAX_UPTHRUST_DEPTH - 0.025) * 100.0)

    ubars = c["upthrust_bars_above"]
    if ubars == 1:
        bars_score = 100.0
    elif ubars == 2:
        bars_score = 75.0
    else:
        bars_score = 55.0

    n = c["range_bars"]
    if 20 <= n <= 40:
        length_score = 100.0
    elif n < 20:
        length_score = 60.0 + (n - _MIN_RANGE_BARS) / 5.0 * 40.0
    else:
        length_score = max(40.0, 100.0 - (n - 40) / 20.0 * 30.0)

    rd = c["range_depth"]
    if 0.05 <= rd <= 0.15:
        range_depth_score = 100.0
    elif rd < 0.05:
        range_depth_score = 60.0 + rd / 0.05 * 40.0
    else:
        range_depth_score = max(50.0, 100.0 - (rd - 0.15) / 0.05 * 30.0)

    return round(
        0.35 * depth_score + 0.20 * bars_score + 0.25 * length_score + 0.20 * range_depth_score, 2
    )


def _score_volume(c: dict) -> float:
    """Mirror of spring volume scoring — Sign of Weakness + distribution signature."""
    ratio = c["reclaim_volume_ratio"]
    if ratio >= 2.5:
        sow_score = 100.0
    elif ratio >= 1.8:
        sow_score = 85.0
    elif ratio >= 1.4:
        sow_score = 70.0
    elif ratio >= _RECLAIM_VOL_MIN:
        sow_score = 55.0
    else:
        sow_score = 30.0

    dist = c["distribution_volume_signature"]
    if dist >= 1.2:
        dist_score = 100.0
    elif dist >= 1.05:
        dist_score = 85.0
    elif dist >= 0.9:
        dist_score = 70.0
    elif dist >= 0.75:
        dist_score = 50.0
    else:
        dist_score = 30.0

    return round(0.60 * sow_score + 0.40 * dist_score, 2)


def _score_context(context: dict) -> float:
    """Wyckoff Upthrust is a bearish reversal — Stage 3 distribution ideal."""
    score = 40.0
    stage = context.get("trend_stage")
    if stage == 3:
        score += 25.0
    elif stage == 4:
        score += 15.0
    elif stage == 2:
        score += 5.0

    align = context.get("ma_alignment")
    if align == "stacked_bearish":
        score += 12.0
    elif align == "mixed":
        score += 8.0

    rs = context.get("rs_trend")
    if rs == "down":
        score += 10.0
    elif rs == "flat":
        score += 5.0

    score += _dcr_score_adjustment(context)
    return min(100.0, max(0.0, score))


def _dcr_score_adjustment(context: dict) -> float:
    """DCR-derived score adjustment for a bearish pattern (mirror)."""
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "distribution" and recent_dcr <= 0.35:
        return 12.0
    if dcr_sig == "accumulation":
        return -8.0
    return 0.0


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    range_high = c["range_high"]
    range_low = c["range_low"]
    range_height = c["range_height"]
    upthrust_high = c["upthrust_high"]
    upthrust_high_idx = c["upthrust_high_idx"]
    reclaim_idx = c["reclaim_bar_idx"]

    entry = round(range_low * 0.999, 2)
    stop = round(upthrust_high * 1.015, 2)
    target = round(range_low - range_height * 2.0, 2)
    rr = ((entry - target) / (stop - entry)) if stop > entry else 0.0
    stop_distance_pct = ((stop - entry) / entry * 100.0) if entry > 0 else 0.0

    anchors = [
        {"t": int(bars[c["range_start_idx"]]["t"]), "price": float(range_high)},
        {"t": int(bars[c["range_end_idx"]]["t"]), "price": float(range_high)},
        {"t": int(bars[upthrust_high_idx]["t"]), "price": float(upthrust_high)},
        {"t": int(bars[reclaim_idx]["t"]), "price": float(c["reclaim_close"])},
    ]
    pivot_ts = [
        int(bars[c["range_start_idx"]]["t"]),
        int(bars[c["range_end_idx"]]["t"]),
        int(bars[upthrust_high_idx]["t"]),
        int(bars[reclaim_idx]["t"]),
        int(last_bar["t"]),
    ]

    extras = {
        "range_bars": int(c["range_bars"]),
        "range_high": round(range_high, 2),
        "range_low": round(range_low, 2),
        "range_height_pct": round(c["range_height_pct"], 2),
        "upthrust_high": round(upthrust_high, 2),
        "upthrust_bars_above": int(c["upthrust_bars_above"]),
        "upthrust_depth_pct": round(c["upthrust_depth"] * 100.0, 2),
        "reclaim_bar_idx": int(reclaim_idx),
        "reclaim_volume_ratio": round(c["reclaim_volume_ratio"], 2),
        "distribution_volume_signature": round(c["distribution_volume_signature"], 3),
        "dcr_score_adj": round(_dcr_score_adjustment(context), 2),
    }

    narrative = _compose_narrative(c, context, entry, stop, target, rr, stop_distance_pct)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Wyckoff Upthrust",
        "category": "uct",
        "direction": "bearish",
        "start_t": int(bars[c["range_start_idx"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "horizontal_line",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close < {entry:.2f} (trading range low - 0.1%)",
            "stop": stop,
            "stop_basis": "upthrust_high_plus_1.5pct",
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
    range_high = c["range_high"]
    range_low = c["range_low"]
    range_bars = c["range_bars"]
    range_height_pct = c["range_height_pct"]
    upthrust_high = c["upthrust_high"]
    upthrust_depth_pct = c["upthrust_depth"] * 100.0
    upthrust_bars_above = c["upthrust_bars_above"]
    reclaim_vol_ratio = c["reclaim_volume_ratio"]
    dist_sig = c["distribution_volume_signature"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    headline = (
        f"Wyckoff Upthrust - {range_bars}-bar distribution range "
        f"(${range_low:.2f}-${range_high:.2f}) with {upthrust_depth_pct:.2f}% "
        f"false breakout to ${upthrust_high:.2f}, rejected on "
        f"{reclaim_vol_ratio:.2f}x Sign of Weakness volume. Pivot ${entry:.2f}, "
        f"target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Wyckoff Upthrust is the climactic Phase C event in a multi-week "
        f"DISTRIBUTION structure, codified by Richard D. Wyckoff (founder of "
        f"the Wyckoff Method, c. 1908-1934) and modernized in Hank Pruden's "
        f"'The Three Skills of Top Trading' (2007, Wiley). The Upthrust is "
        f"the mirror of the Spring: a FALSE BREAKOUT above the trading "
        f"range's resistance followed by an immediate rejection back into "
        f"the range on a Sign of Weakness (SOW) volume expansion. Here the "
        f"stock spent {range_bars} bars trading in a "
        f"{range_height_pct:.1f}%-deep range between ${range_low:.2f} "
        f"(support) and ${range_high:.2f} (resistance) — the textbook "
        f"Wyckoff distribution structure where composite-operator sellers "
        f"unload supply to weak-handed buyers chasing the prior uptrend. "
        f"The Upthrust penetrated ${range_high:.2f} resistance by "
        f"{upthrust_depth_pct:.2f}% (high: ${upthrust_high:.2f}) over "
        f"{upthrust_bars_above} bar(s) — the false breakout that triggers "
        f"buy-stops and FOMO long positioning — before being rejected back "
        f"into the range on {reclaim_vol_ratio:.2f}x of the upthrust-bar "
        f"volume. That rejection volume IS the Sign of Weakness: the "
        f"moment institutional sellers reveal themselves, having used the "
        f"brief breakout to fill their final distribution orders at the "
        f"trapped-longs price. The distribution-volume signature through "
        f"the range ({dist_sig:.2f}x late-vs-early-range volume) shows the "
        f"stable-or-expanding volume Wyckoff identified as the footprint "
        f"of demand exhaustion at the top of an uptrend. Wyckoff Upthrust "
        f"is the strict institutional cousin of generic 'failed breakout' "
        f"setups — it requires a pre-existing multi-week range with "
        f"distribution-volume characteristics, not just any resistance "
        f"level. Pruden teaches the Upthrust as the highest-conviction "
        f"short entry in the Wyckoff framework."
    )

    why_it_matters = (
        f"This Upthrust is forming in {stage_phrase} with {ma_phrase} "
        f"moving-average alignment, {rs_phrase}, in {regime_p}. Wyckoff "
        f"teaches that a distribution phase always precedes a markdown "
        f"phase, and that the Upthrust is the bar-level signature of the "
        f"transition. The combination of (a) a defined {range_bars}-bar "
        f"trading range with bounded amplitude ({range_height_pct:.1f}% "
        f"range height), (b) a false breakout of {upthrust_depth_pct:.2f}% "
        f"— deep enough to trigger buy-stops but shallow enough that the "
        f"structural resistance is recoverable, and (c) a Sign of Weakness "
        f"rejection on {reclaim_vol_ratio:.2f}x volume, IS the textbook "
        f"3-element composite that Wyckoff's composite-operator framework "
        f"identifies as the bar-level transfer-of-ownership moment from "
        f"weak hands to strong hands (with strong hands now selling). "
        f"{dcr_p} {dcr_interpretation(context, 'bearish')} Pruden's "
        f"published Wyckoff-method backtests on US equities show Upthrust "
        f"setups deliver positive expectancy at hit rates in the 60-70% "
        f"range when the full structural criteria are met — range + false "
        f"breakout + SOW volume + stable-or-rising distribution volume "
        f"signature. The distribution-volume signature ({dist_sig:.2f}x) "
        f"is critical: stable-or-rising volume through the range = "
        f"composite-operator distribution in progress; sharply declining "
        f"volume through the range = accumulation (which would invalidate "
        f"the Upthrust interpretation). Here the distribution signature "
        f"confirms the Wyckoff read. The measured-move target at "
        f"${target:.2f} reflects Wyckoff's range-projection convention: "
        f"the trading-range height (${c['range_height']:.2f}) projected "
        f"2x BELOW the range low. Liquid leaders showing Wyckoff Upthrust "
        f"signatures in Stage 3 distribution or Stage 4 confirmation are "
        f"some of the highest-edge short entries in the technical-analysis "
        f"literature."
    )

    what_to_watch_for = (
        f"Trigger: a daily close below ${entry:.2f} — the trading range "
        f"low (${range_low:.2f}) minus a 0.1% confirmation buffer. "
        f"Wyckoff's framework calls this 'Sign of Weakness' (SOW): the "
        f"first clean breakdown below range support is the official end "
        f"of the distribution phase and start of markdown. The ideal "
        f"trigger bar prints on volume at or above 1.5x the 20-bar "
        f"average and closes in the lower half of its range. Position "
        f"sizing should reflect the {stop_distance_pct:.1f}% stop "
        f"distance — risking 1% of account implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity per position. Wyckoff/Pruden specific execution: "
        f"(a) avoid entering BEFORE the trigger close — the markdown "
        f"phase is what generates the asymmetric reward; (b) use the "
        f"upthrust high ${upthrust_high:.2f} as the structural stop "
        f"reference; the running stop at ${stop:.2f} sits 1.5% above to "
        f"account for normal volatility; (c) Wyckoff's targets are "
        f"conservative — the 2x measured-move at ${target:.2f} often "
        f"UNDERSHOOTS what clean Upthrusts ultimately deliver in the "
        f"markdown phase; trail stops down and let the position run; "
        f"(d) Upthrusts that fire from Stage 3 transitioning to Stage 4 "
        f"commonly precede multi-month declines — Pruden's longest "
        f"documented winners ran 30-60% from the Upthrust entry. Watch "
        f"for the post-trigger 'Last Point of Supply' (LPSY) rally: it's "
        f"normal for price to retest the prior range low once after the "
        f"SOW breakdown — that's the highest-edge add-on or initial "
        f"entry for traders who missed the first SOW bar."
    )

    failure_signal = (
        f"The Upthrust is invalidated if price closes above ${stop:.2f} "
        f"(upthrust high ${upthrust_high:.2f} plus 1.5%) — that signals "
        f"the composite operator was not in fact distributing, and the "
        f"trading range was an accumulation pattern that resolves bullish. "
        f"A subtler failure: the rejection happens but the next 5-10 "
        f"bars fail to break below range support — instead drift "
        f"sideways inside the range. Wyckoff calls this 'No Supply' (NS): "
        f"the Sign of Weakness volume failed to translate into sustained "
        f"selling pressure, and the range may need additional time before "
        f"the breakdown matures. The prudent response to NS is to wait — "
        f"a fresh Upthrust or 'Secondary Test' (a lower-volume retest of "
        f"the upthrust high) may set up over the next 5-15 bars. Pruden's "
        f"discipline: the Upthrust's edge depends on the FULL structural "
        f"confirmation; trading on the upthrust-bar high without waiting "
        f"for the Sign-of-Weakness volume rejection is statistically "
        f"inferior to waiting for the trigger. The distribution-volume "
        f"signature ({dist_sig:.2f}x late-vs-early) should hold; if "
        f"volume begins contracting sharply AFTER the upthrust fails to "
        f"trigger, that's accumulation emerging and the structural read "
        f"flips bullish. Wyckoff Upthrust's edge over generic failed-"
        f"breakout setups is the strict pre-condition discipline: only "
        f"trade Upthrusts with all four structural elements (range + "
        f"false breakout + SOW volume + distribution signature) intact. "
        f"The trader who relaxes the criteria to capture more trades "
        f"will degrade the pattern's win rate below break-even."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_wyckoff_upthrust)
