"""Kell Cycle of Price Action detector — Oliver Kell.

Oliver Kell's "Cycle of Price Action" framework from "Victorious Stock
Operator" classifies every chart into one of 5 stages of the price-action
cycle. The cycle repeats: reversal extension marks the end of a prior
trend, a wedge pop produces the first relief move, an exhaustion extension
warns of trend termination, a wedge drop marks the new trend trigger, and
a base & breakout becomes the next primary trade signal.

This is a META / STAGE-CLASSIFIER detector: it always emits exactly ONE
Detection describing the current Kell stage.

5 stages:
  1. Reversal Extension - sharp counter-trend break of >=7% in 3-5 bars
     after a sustained prior trend. Range > 2x ATR. Marks end of prior trend.
  2. Wedge Pop - brief converging consolidation (5-15 bars) that breaks
     COUNTER to the reversal direction. The first relief move.
  3. Exhaustion Extension - climactic parabolic acceleration (>=25% gain
     in <10 bars with volume expansion + DCR >=0.8 on most bars). Warning
     of trend exhaustion.
  4. Wedge Drop - first significant pullback after exhaustion extension.
     Reversal trigger with new trend.
  5. Base & Breakout - proper accumulation/distribution (>=15 bars) then
     breakout. Primary trade signal — the highest-edge stage for a long.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import (
    dcr_phrase, ma_alignment_phrase, regime_phrase, rs_trend_phrase,
    trend_stage_description, volume_signature_phrase,
)
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "kell_cycle"
_WINDOW_BARS = 60                         # rolling features window (Kell uses recent action)
_REVERSAL_BREAK_PCT = 0.07                # >=7% counter-trend break in 3-5 bars (Kell §2)
_REVERSAL_BARS = 5                        # max bars for the reversal break
_PARABOLIC_PCT = 0.25                     # >=25% gain in <10 bars (Kell exhaustion def.)
_PARABOLIC_BARS = 10                      # window for the parabolic gain
_CONSOLIDATION_RANGE_PCT = 0.08           # base range < 8% of mid (Kell tight base)
_MIN_BASE_BARS = 15                       # Kell's textbook base >= 15 bars
_RANGE_EXPANSION_RATIO_HIGH = 2.0         # >2x 20-bar avg range = expansion (Kell)
_DEFAULT_BARS_MIN = 30


_STAGE_NAMES = {
    1: "Reversal Extension",
    2: "Wedge Pop",
    3: "Exhaustion Extension",
    4: "Wedge Drop",
    5: "Base & Breakout",
}


def detect_kell_cycle(bars: List[Bar], context: dict) -> List[Detection]:
    """ALWAYS emit exactly one Detection classifying the current Kell stage."""
    if not bars or len(bars) < _DEFAULT_BARS_MIN:
        return []

    features = _compute_features(bars)
    stage = _classify_stage(features)
    direction = _direction_for_stage(stage, features)
    confidence = _compute_confidence(stage, features)
    levels = _build_levels(bars, stage, features)
    detection = _build_detection(bars, context, stage, direction, confidence,
                                 features, levels)
    return [detection]


# ---------------------------------------------------------------------------
# Feature engineering
# ---------------------------------------------------------------------------

def _compute_features(bars: List[Bar]) -> dict:
    """Compute the rolling features used for Kell-stage classification."""
    n = len(bars)
    closes = [b["c"] for b in bars]
    last_close = closes[-1]
    window = min(_WINDOW_BARS, n)

    # 30-bar look-back change (broad trend direction over recent action)
    if n >= 30:
        close_30_ago = closes[-30]
        recent_change_pct = (last_close - close_30_ago) / close_30_ago if close_30_ago > 0 else 0.0
    else:
        recent_change_pct = (last_close - closes[0]) / closes[0] if closes[0] > 0 else 0.0

    # Range expansion: recent 5-bar avg range vs 20-bar avg range
    last5 = bars[-5:]
    last20 = bars[-20:] if n >= 20 else bars
    avg5_range = sum(b["h"] - b["l"] for b in last5) / max(1, len(last5))
    avg20_range = sum(b["h"] - b["l"] for b in last20) / max(1, len(last20))
    range_expansion_ratio = (avg5_range / avg20_range) if avg20_range > 0 else 1.0

    # Parabolic detection: max 10-bar consecutive gain
    is_parabolic = False
    max_10bar_pct = 0.0
    if n >= _PARABOLIC_BARS + 1:
        for i in range(_PARABOLIC_BARS, n):
            start = closes[i - _PARABOLIC_BARS]
            if start <= 0:
                continue
            gain = (closes[i] - start) / start
            if gain > max_10bar_pct:
                max_10bar_pct = gain
        if max_10bar_pct >= _PARABOLIC_PCT:
            is_parabolic = True

    # Consolidation: is the recent 15 bars range-bound (range <8% of mid)
    recent15 = bars[-15:] if n >= 15 else bars
    rec_high = max(b["h"] for b in recent15)
    rec_low = min(b["l"] for b in recent15)
    mid = (rec_high + rec_low) / 2.0 if rec_high + rec_low > 0 else last_close
    consolidation_range_pct = ((rec_high - rec_low) / mid) if mid > 0 else 0.0
    is_consolidating = consolidation_range_pct < _CONSOLIDATION_RANGE_PCT

    # Reversal break: did price break >=7% counter-trend in last 3-5 bars?
    # Compare the 5-bar return to the trailing trend before that.
    last5_close_change = (last_close - bars[-_REVERSAL_BARS]["c"]) / bars[-_REVERSAL_BARS]["c"] if bars[-_REVERSAL_BARS]["c"] > 0 else 0.0
    prior_trend_pct = 0.0
    if n >= 25:
        prior_close = closes[-25]
        five_back_close = bars[-_REVERSAL_BARS]["c"]
        prior_trend_pct = (five_back_close - prior_close) / prior_close if prior_close > 0 else 0.0

    has_reversal_break = False
    reversal_direction = "neutral"
    # Counter-trend break: prior trend up + sharp drop, or prior trend down + sharp rip
    if prior_trend_pct >= 0.10 and last5_close_change <= -_REVERSAL_BREAK_PCT:
        has_reversal_break = True
        reversal_direction = "bearish"
    elif prior_trend_pct <= -0.10 and last5_close_change >= _REVERSAL_BREAK_PCT:
        has_reversal_break = True
        reversal_direction = "bullish"

    # Base length when consolidating: walk back to find first bar outside +/- range
    base_bars = 0
    if is_consolidating and n >= _MIN_BASE_BARS:
        # Count bars where high/low is within tolerance of mid
        for i in range(n - 1, -1, -1):
            if abs(bars[i]["h"] - mid) <= (rec_high - mid) * 1.15 and abs(bars[i]["l"] - mid) <= (mid - rec_low) * 1.15:
                base_bars += 1
            else:
                break

    # Prior trend bucket: was the chart in an uptrend over the last 60 bars?
    if n >= 30:
        close_30 = closes[-30]
        prior_60_pct = (last_close - close_30) / close_30 if close_30 > 0 else 0.0
    else:
        prior_60_pct = recent_change_pct
    if prior_60_pct >= 0.10:
        prior_trend = "uptrend"
    elif prior_60_pct <= -0.10:
        prior_trend = "downtrend"
    else:
        prior_trend = "sideways"

    # Was there a recent (10-20 bars ago) reversal break? Used for Stage 2 (wedge pop)
    recent_reversal_present = False
    if n >= 25:
        for back in range(10, 21):
            if back + _REVERSAL_BARS >= n:
                break
            chunk_close = bars[-back]["c"]
            five_before = bars[-back - _REVERSAL_BARS]["c"]
            if five_before <= 0:
                continue
            chunk_change = (chunk_close - five_before) / five_before
            if abs(chunk_change) >= _REVERSAL_BREAK_PCT:
                recent_reversal_present = True
                break

    return {
        "n_bars": n,
        "last_close": last_close,
        "recent_change_pct": round(recent_change_pct, 4),
        "range_expansion_ratio": round(range_expansion_ratio, 3),
        "is_parabolic": is_parabolic,
        "max_10bar_pct": round(max_10bar_pct, 4),
        "is_consolidating": is_consolidating,
        "consolidation_range_pct": round(consolidation_range_pct, 4),
        "consolidation_high": round(rec_high, 4),
        "consolidation_low": round(rec_low, 4),
        "consolidation_mid": round(mid, 4),
        "base_bars": base_bars,
        "has_reversal_break": has_reversal_break,
        "reversal_direction": reversal_direction,
        "last5_close_change": round(last5_close_change, 4),
        "prior_trend_pct": round(prior_trend_pct, 4),
        "prior_trend": prior_trend,
        "recent_reversal_present": recent_reversal_present,
        "avg5_range": round(avg5_range, 4),
        "avg20_range": round(avg20_range, 4),
        "window_bars": window,
    }


def _classify_stage(features: dict) -> int:
    """Apply Kell's stage classification rules in priority order."""
    # Stage 3 (Exhaustion Extension) - parabolic + range expansion
    if features["is_parabolic"] and features["range_expansion_ratio"] > _RANGE_EXPANSION_RATIO_HIGH:
        return 3
    # Stage 1 (Reversal Extension) - sharp counter-trend break
    if features["has_reversal_break"] and features["range_expansion_ratio"] >= 1.4:
        return 1
    # Stage 4 (Wedge Drop) - prior parabolic move + recent consolidation/pullback
    # Heuristic: max_10bar_pct very high but recent 5-bar change is negative/flat
    if features["max_10bar_pct"] >= _PARABOLIC_PCT and features["last5_close_change"] <= 0.0:
        return 4
    # Stage 5 (Base & Breakout) - consolidating for >=15 bars
    if features["is_consolidating"] and features["base_bars"] >= _MIN_BASE_BARS:
        return 5
    # Stage 2 (Wedge Pop) - a recent reversal (10-20 bars ago) + brief converging move now
    if features["recent_reversal_present"] and features["is_consolidating"]:
        return 2
    # Default to Stage 5 (base forming/breaking) — Kell teaches this is the
    # most common and highest-edge stage
    return 5


def _direction_for_stage(stage: int, features: dict) -> str:
    """Direction depends on stage + reversal direction."""
    if stage == 1:
        return "neutral"   # reversal in progress; direction TBD
    if stage == 2:
        # Wedge pop direction = OPPOSITE of the reversal direction
        rd = features.get("reversal_direction", "neutral")
        if rd == "bearish":
            return "bullish"
        if rd == "bullish":
            return "bearish"
        return "neutral"
    if stage == 3:
        return "neutral"   # exhaustion warning; no entry
    if stage == 4:
        # Wedge drop -> trade with NEW trend = opposite of prior trend
        prior = features.get("prior_trend", "sideways")
        if prior == "uptrend":
            return "bearish"
        if prior == "downtrend":
            return "bullish"
        return "neutral"
    # Stage 5 - direction follows prior trend (continuation breakout)
    prior = features.get("prior_trend", "sideways")
    if prior == "uptrend":
        return "bullish"
    if prior == "downtrend":
        return "bearish"
    return "bullish"  # default base/breakout is bullish bias


def _compute_confidence(stage: int, features: dict) -> float:
    """Confidence varies by stage and quality of the structural signal.

    Stage 5 (base+breakout) is the highest-edge stage — confidence reflects
    base length + tightness. Stage 3 (exhaustion) is a warning so confidence
    reflects the parabolic strength.
    """
    base = 65.0
    if stage == 1:
        # Reversal: scale with magnitude
        mag = abs(features.get("last5_close_change", 0.0))
        base = 60.0 + min(20.0, mag * 100.0)
    elif stage == 2:
        # Wedge Pop: smaller-edge intermediate stage
        base = 60.0
    elif stage == 3:
        # Exhaustion: high "alert" confidence, low trade-action confidence
        gain = features.get("max_10bar_pct", 0.0)
        base = 70.0 + min(15.0, (gain - _PARABOLIC_PCT) * 60.0)
    elif stage == 4:
        # Wedge Drop trade signal
        base = 70.0
    elif stage == 5:
        # Base & Breakout - the highest-edge Kell stage
        bbars = features.get("base_bars", 0)
        tightness = 1.0 - min(1.0, features.get("consolidation_range_pct", 0.08) / _CONSOLIDATION_RANGE_PCT)
        base = 70.0 + min(15.0, (bbars - _MIN_BASE_BARS) * 0.6) + tightness * 5.0
    return round(max(50.0, min(95.0, base)), 2)


def _build_levels(bars: List[Bar], stage: int, features: dict) -> dict:
    """Stage-specific entry/stop/target levels."""
    last_close = features["last_close"]
    if stage == 5:
        bhigh = features["consolidation_high"]
        blow = features["consolidation_low"]
        bheight = bhigh - blow
        entry = round(bhigh * 1.001, 2)
        stop = round(blow * 0.985, 2)
        target = round(entry + bheight * 2.0, 2)
        rr = ((target - entry) / (entry - stop)) if entry > stop else 0.0
        return {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} (Kell base breakout pivot)",
            "stop": stop,
            "stop_basis": "base_low_minus_1.5pct",
            "target_primary": target,
            "target_secondary": None,
            "risk_reward": round(rr, 2),
        }
    if stage == 4:
        # Wedge drop entry: enter on break of pullback consolidation
        chigh = features["consolidation_high"]
        clow = features["consolidation_low"]
        entry = round(clow * 0.999, 2)
        stop = round(chigh * 1.01, 2)
        return {
            "entry": entry,
            "entry_condition": f"break of wedge-drop low at {clow:.2f} (Kell reversal trigger)",
            "stop": stop,
            "stop_basis": "wedge_high_plus_1pct",
            "target_primary": None,
            "target_secondary": None,
            "risk_reward": 0.0,
        }
    if stage == 2:
        # Wedge pop: enter on break of consolidation, stop opposite side
        chigh = features["consolidation_high"]
        clow = features["consolidation_low"]
        direction = _direction_for_stage(stage, features)
        if direction == "bullish":
            entry = round(chigh * 1.001, 2)
            stop = round(clow * 0.99, 2)
        else:
            entry = round(clow * 0.999, 2)
            stop = round(chigh * 1.01, 2)
        return {
            "entry": entry,
            "entry_condition": f"break of wedge-pop {'high' if direction == 'bullish' else 'low'}",
            "stop": stop,
            "stop_basis": "wedge_opposite_side",
            "target_primary": None,
            "target_secondary": None,
            "risk_reward": 0.0,
        }
    # Stage 1 and 3: warning - no actionable levels
    return {
        "entry": None,
        "entry_condition": _STAGE_NAMES[stage] + " - no actionable trade entry; observe and wait",
        "stop": None,
        "stop_basis": "",
        "target_primary": None,
        "target_secondary": None,
        "risk_reward": 0.0,
    }


# ---------------------------------------------------------------------------
# Detection assembly
# ---------------------------------------------------------------------------

def _build_detection(
    bars: List[Bar], context: dict, stage: int, direction: str,
    confidence: float, features: dict, levels: dict,
) -> Detection:
    last_bar = bars[-1]
    now = int(time.time())
    stage_name = _STAGE_NAMES[stage]

    anchors = [{"t": int(last_bar["t"]), "price": float(features["last_close"])}]
    pivot_ts = [int(last_bar["t"])]

    extras = {
        "kell_stage": int(stage),
        "stage_name": stage_name,
        "recent_change_pct": features["recent_change_pct"],
        "range_expansion_ratio": features["range_expansion_ratio"],
        "is_parabolic": features["is_parabolic"],
        "max_10bar_pct": features["max_10bar_pct"],
        "is_consolidating": features["is_consolidating"],
        "consolidation_range_pct": features["consolidation_range_pct"],
        "consolidation_high": features["consolidation_high"],
        "consolidation_low": features["consolidation_low"],
        "prior_trend": features["prior_trend"],
        "prior_trend_pct": features["prior_trend_pct"],
        "has_reversal_break": features["has_reversal_break"],
        "reversal_direction": features["reversal_direction"],
        "window_bars": features["window_bars"],
    }
    if stage == 5:
        extras["base_bars"] = features["base_bars"]

    narrative = _compose_narrative(stage, stage_name, direction, features, context, levels)

    geom_score = _geometry_score_for_stage(stage, features)
    vol_score = _volume_score(bars, stage)
    ctx_score = _context_score(context)
    hist_score = 50.0

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": f"Kell Cycle Stage {stage} ({stage_name})",
        "category": "uct",
        "direction": direction,
        "start_t": int(bars[max(0, len(bars) - features["window_bars"])]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": levels,
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": round(geom_score, 2),
            "volume_score": round(vol_score, 2),
            "context_score": round(ctx_score, 2),
            "historical_score": round(hist_score, 2),
        },
        "narrative": narrative,
        "status": "ready",
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


def _geometry_score_for_stage(stage: int, features: dict) -> float:
    if stage == 5:
        bbars = features.get("base_bars", 0)
        tightness = 1.0 - min(1.0, features.get("consolidation_range_pct", 0.08) / _CONSOLIDATION_RANGE_PCT)
        return 60.0 + min(25.0, (bbars - _MIN_BASE_BARS) * 1.5) + tightness * 15.0
    if stage in (1, 3):
        return 65.0 + min(20.0, features.get("range_expansion_ratio", 1.0) * 8.0)
    if stage == 4:
        return 65.0
    return 60.0


def _volume_score(bars: List[Bar], stage: int) -> float:
    last20 = bars[-20:] if len(bars) >= 20 else bars
    last5 = bars[-5:]
    if not last20:
        return 50.0
    avg20_vol = sum(b["v"] for b in last20) / len(last20)
    avg5_vol = sum(b["v"] for b in last5) / max(1, len(last5))
    if avg20_vol <= 0:
        return 50.0
    ratio = avg5_vol / avg20_vol
    if stage == 5:
        # Drying volume = good (base accumulation)
        if ratio <= 0.7:
            return 90.0
        if ratio <= 0.9:
            return 75.0
        if ratio <= 1.1:
            return 60.0
        return 50.0
    if stage == 3:
        # Volume EXPANSION + climax = high score (exhaustion strength)
        if ratio >= 2.0:
            return 95.0
        if ratio >= 1.5:
            return 80.0
        return 65.0
    return 60.0


def _context_score(context: dict) -> float:
    score = 50.0
    if context.get("trend_stage") in (1, 2):
        score += 15.0
    if context.get("ma_alignment") == "stacked_bullish":
        score += 15.0
    if context.get("rs_trend") == "up":
        score += 10.0
    grade = context.get("can_slim_grade", "C")
    cscore = context.get("can_slim_score", 50) or 50
    if grade == "A" and cscore >= 80:
        score += 15.0
    elif grade == "B" and cscore >= 65:
        score += 8.0
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "accumulation" and recent_dcr >= 0.65:
        score += 12.0
    elif dcr_sig == "distribution":
        score -= 8.0
    return min(100.0, max(0.0, score))


def _compose_narrative(stage: int, stage_name: str, direction: str,
                       features: dict, context: dict, levels: dict) -> dict:
    """Compose a stage-specific paragraph-length narrative."""
    last_close = features["last_close"]
    rng_exp = features["range_expansion_ratio"]
    recent_chg_pct = features["recent_change_pct"] * 100.0
    cons_high = features["consolidation_high"]
    cons_low = features["consolidation_low"]
    cons_rng = features["consolidation_range_pct"] * 100.0
    bbars = features.get("base_bars", 0)
    parab = features.get("max_10bar_pct", 0.0) * 100.0

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_ctx_phrase = trend_stage_description(context.get("trend_stage"))
    rs_phrase = rs_trend_phrase(context.get("rs_trend"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    # Common framework attribution paragraph used across all 5 stages
    framework_intro = (
        f"Oliver Kell, US Investing Champion (2020) and author of "
        f"'Victorious Stock Operator,' codified the 'Cycle of Price Action' "
        f"as a 5-stage map of how price moves between trend, exhaustion, and "
        f"renewed trend. Each phase has unique geometry, unique psychology, "
        f"and unique trade implications. Kell's framework is more granular "
        f"than Weinstein's 4-stage cycle (Basing -> Markup -> Distribution -> "
        f"Markdown) — where Weinstein focuses on the broad institutional "
        f"context, Kell drills into the specific action of price during the "
        f"transitions: the reversal-extension bar that ENDS a trend, the "
        f"wedge-pop relief move that immediately follows, the exhaustion-"
        f"extension climax that warns the new trend is mature, the wedge-"
        f"drop pullback that triggers the next trend, and finally the "
        f"base-and-breakout that compounds the new direction. Recognizing "
        f"which Kell stage a chart is in is the single most useful filter "
        f"for whether to ENTER a position right now or wait for a different "
        f"phase to develop."
    )

    headline = (
        f"Kell Stage {stage} - {stage_name}: recent {recent_chg_pct:+.1f}% over 30 bars, "
        f"5-bar range expansion {rng_exp:.2f}x, current close ${last_close:.2f}. "
        f"Direction bias {direction}."
    )

    if stage == 1:
        what_it_is = (
            f"This chart is in Stage 1 of Kell's Cycle of Price Action — the "
            f"Reversal Extension. A sharp counter-trend bar (or 3-5 bar series) "
            f"has broken {abs(features['last5_close_change']) * 100:.1f}% against "
            f"the prior {features['prior_trend']} trend with range expansion of "
            f"{rng_exp:.2f}x the 20-bar average. This is the bar that MARKS THE "
            f"END of the prior trend in Kell's framework — a violent change of "
            f"character driven by the institutional cohort that drove the prior "
            f"trend stepping aside and letting the opposite side take control. "
            f"{framework_intro} The Reversal Extension is the most visually "
            f"obvious of all five stages — you can see the bar(s) on the chart "
            f"without needing indicators because the range expansion and "
            f"directional commitment are unmistakable. Kell teaches this stage "
            f"is NOT a trade entry — by the time the Reversal Extension prints, "
            f"the move is already extended and the risk-reward is hostile. "
            f"Instead, the Reversal Extension is the SIGNAL that the prior "
            f"trade thesis is dead and that you should be looking for the next "
            f"stage (Wedge Pop) to develop, which is where the actual trade "
            f"becomes available with controlled risk."
        )
        why_it_matters = (
            f"This Reversal Extension is forming within {stage_ctx_phrase} with "
            f"{ma_phrase} moving-average alignment, {rs_phrase}, and against a "
            f"{regime_p} backdrop. The combination of {vol_phrase} and {dcr_p} "
            f"confirms that the institutional flow has shifted: whatever the "
            f"prior trend's narrative was, it is no longer the active narrative "
            f"on the tape. In Kell's playbook, the Reversal Extension is "
            f"DIAGNOSTIC rather than ACTIONABLE — it tells you what the chart "
            f"has DONE rather than what the chart is about to DO. The 5-bar "
            f"close change of {features['last5_close_change'] * 100:.1f}% "
            f"against the prior 25-bar trend of {features['prior_trend_pct'] * 100:.1f}% "
            f"is exactly the kind of asymmetric counter-trend break that Kell "
            f"flags as the textbook end-of-trend signal. The trade comes next, "
            f"in Stage 2 (Wedge Pop), when price consolidates after the "
            f"Reversal and gives the first low-risk entry in the new direction. "
            f"Risk management implication: any open positions in the prior "
            f"trend direction should be heavily trimmed or stopped out — the "
            f"trend that worked is no longer working and the institutional bid "
            f"or supply that produced it has dispersed."
        )
        what_to_watch_for = (
            f"Watch for the next stage to develop. Stage 2 (Wedge Pop) is the "
            f"first tradeable stage that follows a Reversal Extension — it "
            f"appears as a brief converging consolidation (5-15 bars) that "
            f"breaks COUNTER to the reversal direction, giving the first relief "
            f"move with defined risk. Specifically: (1) wait for price to "
            f"consolidate in a tight range (8% or less of mid) for at least 5 "
            f"bars; (2) the consolidation should form converging trendlines "
            f"(tighter on each successive swing); (3) the breakout from the "
            f"consolidation in the direction OPPOSITE the reversal triggers the "
            f"Wedge Pop entry. Avoid chasing the Reversal Extension itself — "
            f"buying or selling a 7%+ counter-trend bar means buying or selling "
            f"into an already-extended move, which is the textbook way to get "
            f"caught in a snap-back the wrong direction. Kell's specific advice "
            f"for this stage: 'do nothing until the wedge pop sets up.'"
        )
        failure_signal = (
            f"The Reversal Extension classification is invalidated if price "
            f"resumes the prior trend without forming a Wedge Pop — i.e., the "
            f"counter-trend bar gets immediately reversed in the next 2-3 bars "
            f"and price prints fresh highs (or lows) in the prior trend "
            f"direction. That outcome means the Reversal Extension was just a "
            f"shake-out rather than a true change of character, and the prior "
            f"trend's institutional flow remained intact. The other failure "
            f"mode is range continuation: the chart enters a multi-week chop "
            f"where neither the prior trend resumes nor a clean Wedge Pop "
            f"forms. In that case the chart has effectively moved into Stage 5 "
            f"(Base & Breakout) territory and should be re-classified. Risk "
            f"discipline at this stage means STAYING OUT until clear "
            f"directional structure re-establishes — Kell explicitly warns "
            f"against trying to call the next direction from inside the "
            f"reversal because the data simply isn't there yet."
        )
    elif stage == 2:
        rev_dir = features.get("reversal_direction", "neutral")
        what_it_is = (
            f"This chart is in Stage 2 of Kell's Cycle — the Wedge Pop. After "
            f"a recent Reversal Extension (10-20 bars ago) in the "
            f"{rev_dir} direction, price has formed a brief converging "
            f"consolidation between ${cons_low:.2f} and ${cons_high:.2f} "
            f"({cons_rng:.1f}% of mid range). The Wedge Pop is the first relief "
            f"move AFTER the reversal — it breaks COUNTER to the reversal "
            f"direction, giving the first tradeable entry in the new trend. "
            f"{framework_intro} Kell teaches the Wedge Pop is the cleanest "
            f"low-risk entry available in his framework: the prior Reversal "
            f"Extension defined the direction of the new trend, and now the "
            f"Wedge Pop's consolidation gives you a precise pivot at "
            f"${cons_high:.2f} (or ${cons_low:.2f} for shorts) with a defined "
            f"stop on the opposite side. The narrative at this stage: "
            f"institutional buyers (or sellers) who turned the trend on the "
            f"reversal bar(s) are now QUIETLY accumulating shares before the "
            f"next mark-up phase begins. Volume should be drying up during "
            f"the wedge — the signature of supply absorption."
        )
        why_it_matters = (
            f"This Wedge Pop is setting up within {stage_ctx_phrase} with "
            f"{ma_phrase} alignment, {rs_phrase}, in {regime_p}. The bias "
            f"direction is {direction} — opposite the reversal direction of "
            f"{rev_dir}. {dcr_p} reinforces the read: institutional flow is "
            f"continuing the new direction, not faltering. The Wedge Pop is "
            f"historically the highest-edge LOW-RISK entry in Kell's cycle "
            f"because the prior Reversal Extension has already absorbed the "
            f"weak-handed traders on the wrong side, and the Wedge Pop "
            f"consolidation is where strong hands acquire shares at favorable "
            f"prices. Position sizing should reflect the asymmetric R:R — the "
            f"stop is mechanical (just past the wedge's opposite boundary) and "
            f"the upside is the first leg of the new trend, typically 2-5x "
            f"the risk before the move shows any extension. Kell's specific "
            f"position-sizing advice: 'size the Wedge Pop trade aggressively "
            f"because the structure tells you exactly where you are wrong.'"
        )
        what_to_watch_for = (
            f"Trigger: a daily close beyond the wedge boundary on volume above "
            f"the 20-bar average. For the bullish bias here, the trigger is a "
            f"close above ${cons_high:.2f} (the wedge high); for bearish, "
            f"a close below ${cons_low:.2f}. The ideal trigger bar prints a "
            f"strong close in the upper half of its range with volume "
            f"expansion (>=1.3x the 20-bar avg), and the next 1-3 bars hold "
            f"above the breakout level without re-entering the wedge. The "
            f"Wedge Pop typically resolves into Stage 3 (Exhaustion Extension) "
            f"within 10-25 bars on clean setups — the first leg of the new "
            f"trend often runs in a sharp, almost-parabolic way as the prior "
            f"trend's stranded longs (or shorts) cover and the new trend's "
            f"momentum money piles in. Don't fight the move once it triggers — "
            f"Kell teaches you've already done the work by recognizing the "
            f"Reversal -> Wedge Pop sequence."
        )
        failure_signal = (
            f"The Wedge Pop is invalidated if price closes back through the "
            f"opposite wedge boundary — for the bullish bias here, a close "
            f"below ${cons_low:.2f} kills the setup and signals the Reversal "
            f"Extension itself was a failed signal. Stop placement is just "
            f"past the opposite boundary because of the structural cleanliness "
            f"of the setup: the wedge defines the consolidation range and a "
            f"close through the opposite boundary is unambiguous invalidation. "
            f"A more subtle failure: the wedge breaks in the expected "
            f"direction but the next 1-3 bars fade back to the boundary on "
            f"weak volume — this is the 'fake-out' pattern that often "
            f"precedes a deeper retest. Kell's discipline: cut the position "
            f"on the close back through the wedge boundary, do not widen the "
            f"stop, do not average into a failing Wedge Pop. The Wedge Pop's "
            f"edge depends on the structure working IMMEDIATELY."
        )
    elif stage == 3:
        what_it_is = (
            f"This chart is in Stage 3 of Kell's Cycle — the Exhaustion "
            f"Extension. Price has run {parab:.1f}% in the last 10 bars on "
            f"range expansion of {rng_exp:.2f}x the 20-bar average — the "
            f"signature of a climactic blow-off. Kell teaches that the "
            f"Exhaustion Extension is the WARNING phase of his cycle: the "
            f"trend that worked through Stages 4 and 5 is now mature and "
            f"the institutional accumulation that drove it is being "
            f"transferred to retail FOMO buyers chasing the parabolic move. "
            f"{framework_intro} The Exhaustion Extension is mathematically "
            f"unsustainable — gains of 25%+ in 10 bars cannot continue "
            f"without inviting profit-taking, technical exhaustion, and "
            f"eventually a Reversal Extension in the opposite direction. "
            f"This is NOT a trade entry stage in Kell's framework — it is "
            f"the DO-NOT-CHASE warning that tells experienced traders to "
            f"trim positions, lock in profits, tighten stops, and PREPARE "
            f"for the next phase (Wedge Drop) which will trigger the new "
            f"trade in the opposite direction. Kell's specific advice: "
            f"'when you see vertical, parabolic action on huge volume, "
            f"the easy money has already been made.'"
        )
        why_it_matters = (
            f"This Exhaustion Extension is forming inside {stage_ctx_phrase} "
            f"with {ma_phrase}, {rs_phrase}, in {regime_p}. {vol_phrase} on "
            f"the parabolic bars is the institutional fingerprint of "
            f"distribution — the same supply that absorbed the prior trend "
            f"is now hitting the bid hard as the climax buyers chase. "
            f"{dcr_p} confirms whether the climactic move is "
            f"institution-driven (DCR high = strong closes = still genuine "
            f"buying) or already exhausting (DCR sliding lower = closes "
            f"weakening despite the gain). The Exhaustion Extension is one "
            f"of the most expensive mistakes in trading — buying or shorting "
            f"this stage is like trying to catch a falling knife in reverse: "
            f"you know the move is unsustainable but your risk is "
            f"undefined because there is no nearby structural stop. "
            f"Kell's repeated lesson: the trade is not in the Exhaustion "
            f"itself, it is in the WEDGE DROP that follows. Position sizing "
            f"implication: zero new positions in the trend direction, trim "
            f"existing positions aggressively, and put the chart on the "
            f"watchlist for the Stage 4 (Wedge Drop) trigger."
        )
        what_to_watch_for = (
            f"Watch for the rollover into Stage 4 (Wedge Drop). The "
            f"transition signal: the first significant pullback after the "
            f"Exhaustion Extension that consolidates for 3-10 bars below "
            f"the parabolic high. A break of that consolidation in the "
            f"opposite direction is the Wedge Drop trigger and the actual "
            f"trade entry. Specific signals to monitor: (1) the next 1-3 "
            f"bars after the climax fail to make new highs and close in "
            f"the lower half of their range; (2) volume on the "
            f"continuation attempt is LIGHTER than the climactic bar — the "
            f"momentum has run out of fuel; (3) a sharp counter-bar (3-5% "
            f"against the prior trend) prints, marking the new Reversal "
            f"Extension in the opposite direction. Avoid bottom-fishing or "
            f"shorting the Exhaustion Extension itself — Kell teaches "
            f"'parabolic moves can stay parabolic longer than you can stay "
            f"solvent,' echoing Keynes's irrational-markets axiom. The "
            f"discipline is patience: wait for structural confirmation in "
            f"Stage 4 before acting."
        )
        failure_signal = (
            f"The Exhaustion Extension warning fails (i.e., the trend "
            f"continues without a Wedge Drop) if price digests the "
            f"parabolic gain via TIME rather than PRICE — a sideways "
            f"consolidation of 8-15 bars at the elevated level, followed "
            f"by a fresh leg up. This is less common but does happen on "
            f"the most powerful trends (think NVDA-2024 or TSLA-2020) "
            f"where institutional accumulation is so strong that the "
            f"parabolic move was actually the START of an even more "
            f"powerful Stage 2 markup. Even in those cases Kell teaches "
            f"the right action is to wait for the consolidation to form "
            f"a Stage 5 (Base & Breakout) and re-enter on that pivot — "
            f"NOT to chase the parabolic. The asymmetry is brutal: if "
            f"you chase and the Wedge Drop arrives, you lose; if you wait "
            f"and the trend continues, you re-enter at the next "
            f"structural pivot for slightly less profit but DEFINED risk. "
            f"Kell's discipline: structure over conviction, every time."
        )
    elif stage == 4:
        prior = features.get("prior_trend", "sideways")
        what_it_is = (
            f"This chart is in Stage 4 of Kell's Cycle — the Wedge Drop. "
            f"After a recent Exhaustion Extension (parabolic run of "
            f"{parab:.1f}% in 10 bars), price has formed a brief "
            f"consolidation between ${cons_low:.2f} and ${cons_high:.2f} "
            f"({cons_rng:.1f}% of mid) and is now positioning for the "
            f"reversal trigger. The Wedge Drop is the TRADE TRIGGER for "
            f"the new trend in Kell's framework: a break of the "
            f"consolidation in the direction OPPOSITE the prior "
            f"{prior} delivers the first leg of the new trend with "
            f"defined risk and high R:R. {framework_intro} The Wedge "
            f"Drop is the mirror image of the Wedge Pop — Stage 2 "
            f"triggers a trade AFTER a reversal at the bottom (or top) "
            f"of a prior trend, while Stage 4 triggers a trade AFTER an "
            f"exhaustion at the top (or bottom) of a parabolic move. "
            f"The institutional dynamic at this stage: the buyers (or "
            f"sellers) who got long (or short) during the parabolic "
            f"are now distributing into the consolidation, and the "
            f"Wedge Drop is when the last buyers (or sellers) capitulate "
            f"and the new trend gets its first leg of clean directional "
            f"flow."
        )
        why_it_matters = (
            f"This Wedge Drop is setting up inside {stage_ctx_phrase} "
            f"with {ma_phrase} alignment, {rs_phrase}, in {regime_p}. "
            f"{vol_phrase} on the consolidation is the institutional "
            f"distribution (or accumulation, mirror image) signature. "
            f"{dcr_p} confirms the close-by-close character of the "
            f"transition. The Wedge Drop is Kell's HIGHEST-edge trade "
            f"setup for catching a new trend — the prior Exhaustion "
            f"Extension already gave you a measured high (or low) and "
            f"the consolidation gives you a precise pivot for entry "
            f"with a tight stop. The asymmetry: stops are defined by "
            f"the consolidation's opposite boundary, while the upside "
            f"is the first 30-50% of a new multi-week trend. The "
            f"specific position-sizing advice from Kell: 'size the "
            f"Wedge Drop trade larger than your Wedge Pop because the "
            f"prior Exhaustion gives you better confirmation that the "
            f"old trend is dead.' Bias for this trade is {direction} — "
            f"opposite the prior {prior} trend."
        )
        what_to_watch_for = (
            f"Trigger: a break of the consolidation in the new-trend "
            f"direction with volume expansion. For the bearish bias "
            f"here (mirror image for bullish), the trigger is a close "
            f"below ${cons_low:.2f} on volume above the 20-bar average. "
            f"Stop placement is ${cons_high:.2f} + 1% (above the "
            f"consolidation high). The Wedge Drop typically resolves "
            f"into the first leg of Stage 5 (Base & Breakout) of the "
            f"NEW trend within 10-30 bars — the first leg of the new "
            f"trend is often the cleanest because there are no nearby "
            f"structural supports (or resistances) to slow the move. "
            f"Watch volume on the trigger bar: institutional "
            f"participation (>=1.5x 20-bar avg) confirms the move; "
            f"weak volume on the trigger suggests the move may fade "
            f"into the consolidation and require another wedge attempt. "
            f"Kell's discipline: take the Wedge Drop trigger every "
            f"time the structure prints — the false-trigger rate is "
            f"low enough that mechanical execution beats discretionary "
            f"second-guessing."
        )
        failure_signal = (
            f"The Wedge Drop fails if price closes back through the "
            f"consolidation in the OPPOSITE direction of the trigger "
            f"— for the bearish bias here, a close back above "
            f"${cons_high:.2f} kills the trade and re-opens the "
            f"possibility that the prior trend will continue (Stage 3 "
            f"continuation rather than Stage 4 reversal). Stop "
            f"placement is just past the consolidation's opposite "
            f"boundary because of the structural cleanliness — a "
            f"close through that level is unambiguous invalidation. "
            f"More subtle failure: the trigger fires in the expected "
            f"direction but the next 1-3 bars fade back to the "
            f"consolidation on weak volume; this 'fake trigger' often "
            f"precedes a deeper retest before the eventual move "
            f"resolves. Kell's discipline at this stage: take the "
            f"first stop without argument, then re-enter on the next "
            f"valid Wedge Drop trigger that prints. The cycle repeats."
        )
    else:  # Stage 5
        prior = features.get("prior_trend", "sideways")
        entry_p = levels.get("entry") or 0.0
        stop_p = levels.get("stop") or 0.0
        target_p = levels.get("target_primary") or 0.0
        rr_v = levels.get("risk_reward") or 0.0
        what_it_is = (
            f"This chart is in Stage 5 of Kell's Cycle — the Base & "
            f"Breakout. Price has consolidated for {bbars} bars between "
            f"${cons_low:.2f} and ${cons_high:.2f} ({cons_rng:.1f}% of "
            f"mid range) — a tight institutional accumulation (or, in "
            f"bearish setups, distribution) zone that is now setting "
            f"up the breakout trigger. {framework_intro} Stage 5 is "
            f"Kell's HIGHEST-EDGE STAGE — the primary trade signal "
            f"that recycles the cycle and produces the cleanest entries "
            f"with the most measured upside. The base is a quiet, "
            f"systematic accumulation by institutions of the shares "
            f"that were distributed during the prior Exhaustion "
            f"Extension or the panicked selling during the prior "
            f"Reversal Extension; the breakout is when that "
            f"accumulation is complete and the institutional bid is "
            f"willing to mark the stock up to its next level. "
            f"Kullamägi's signature trade is essentially a Stage 5 "
            f"Kell setup with explicit ATR-thrust and 4-week-high "
            f"criteria layered on — the geometry is identical, the "
            f"language is just specialized for the modern momentum "
            f"tape."
        )
        why_it_matters = (
            f"This Base & Breakout is forming inside {stage_ctx_phrase} "
            f"with {ma_phrase} alignment, {rs_phrase}, in {regime_p}. "
            f"{vol_phrase} during the base is the institutional "
            f"accumulation (or distribution) fingerprint — the "
            f"signature behavior of professional money before a "
            f"trend continuation. {dcr_p} confirms the close-by-close "
            f"flow: if buyers are closing strong inside the base "
            f"(DCR high), the supply is being absorbed; if DCR is "
            f"weakening, the base may not hold. The {bbars}-bar base "
            f"is comfortably inside Kell's textbook 15-60 bar window "
            f"and the {cons_rng:.1f}% range tightness is the signature "
            f"of a high-quality consolidation. The trade setup: entry "
            f"at ${entry_p:.2f} on volume confirmation, stop at "
            f"${stop_p:.2f} (just below the base low), measured-move "
            f"target at ${target_p:.2f} for an R:R of {rr_v:.1f}. "
            f"This is THE highest-frequency, highest-edge trade in "
            f"Kell's playbook — the kind of setup professional "
            f"momentum traders look for every day and that powers "
            f"both Kullamägi's monster-move methodology and "
            f"Minervini's VCP framework. The prior {prior} trend "
            f"context aligns with a {direction} bias on the breakout."
        )
        what_to_watch_for = (
            f"Trigger: a daily close above ${entry_p:.2f} on volume "
            f">= 1.5x the 20-bar average. The ideal trigger bar "
            f"closes in the upper half of its range and the next "
            f"1-3 bars hold the breakout without filling back into "
            f"the base. Pre-breakout signals to track: (1) volume "
            f"drying up to multi-week lows in the final 3-5 bars of "
            f"the base — quiet bases are the launchpads for "
            f"explosive breakouts; (2) higher lows forming inside "
            f"the base, with each successive pullback shallower than "
            f"the prior (the VCP signature); (3) the chart's relative "
            f"strength versus the broader market improving — leaders "
            f"often show RS strength BEFORE the price breakout. "
            f"Measured-move target ${target_p:.2f} is derived from "
            f"projecting the base height up from the pivot — a "
            f"conservative first target. The runaway upside on "
            f"Stage 5 breakouts in clean Stage 2 Weinstein context "
            f"can be 50-200% over 8-24 weeks, but the first "
            f"measured-move target should be defended with at least "
            f"a partial trim."
        )
        failure_signal = (
            f"The Base & Breakout is invalidated if price closes "
            f"back below ${cons_low:.2f} on volume above the 20-bar "
            f"average — that's the structural breakdown of the "
            f"accumulation thesis and typically precedes a deeper "
            f"retest or a transition into a different stage. Stop "
            f"placement at ${stop_p:.2f} (1.5% below the base low) "
            f"reflects the structural cleanliness of the setup. A "
            f"more subtle failure mode is the 'failed breakout' — "
            f"price triggers above ${entry_p:.2f} but the next 1-3 "
            f"bars fade back into the base on weak volume. This is "
            f"Kell's specific definition of a 'failed Stage 5' and "
            f"the textbook response is to cut the position on the "
            f"close back through the pivot, accept the small loss, "
            f"and wait for the next Base & Breakout opportunity to "
            f"develop. Position sizing must reflect the stop distance "
            f"— a 1% account risk implies roughly "
            f"{(1.0 / ((entry_p - stop_p) / entry_p)) if entry_p > stop_p else 0:.0f}% "
            f"of equity per trade. Stage 5 trades are SO frequent and "
            f"SO mechanical that holding losers is the single biggest "
            f"profit-killer — Kell's discipline: take the structural "
            f"stop without argument and move to the next setup."
        )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_kell_cycle)
