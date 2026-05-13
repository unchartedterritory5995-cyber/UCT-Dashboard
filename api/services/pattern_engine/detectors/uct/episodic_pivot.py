"""Episodic Pivot (EP) detector — Pradeep Bonde / Stockbee.

The Episodic Pivot is a SINGLE BAR that announces a regime change. After a
stock spends several weeks in a sideways base (supply/demand equilibrium),
ONE bar appears that violently breaks the equilibrium with simultaneous
range expansion and volume expansion, closing near the high of the day and
above the entire base range. Bonde teaches the EP as the cleanest signal
of institutional commitment to a position — the day big money decides the
stock's narrative has changed.

Geometric definition:
  - Pre-base: 15-60 bar sideways consolidation, depth <=25%
  - EP bar (within last 5 bars):
      * range >= 2x avg 20-bar range
      * volume >= 2x avg 20-bar volume
      * close in top 30% of bar's range (close_strength > 0.70)
      * close > base_high (breakout above entire base)
  - Direction: bullish (Phase 2 ships only bullish EPs)

Scoring (composite 0-100):
  geometry_score:   base flatness + range expansion + close strength
  volume_score:     EP volume / 20-bar avg, capped at 4x = 100
  context_score:    trend_stage 1 or 2 (basing or early uptrend), MA stack
  historical_score: 50.0 (neutral prior)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "episodic_pivot"

_MIN_BASE_BARS = 15
_MAX_BASE_BARS = 60
_MAX_BASE_DEPTH = 0.25         # base flatness gate (high-low)/high <= 25%
_AVG_LOOKBACK = 20             # for range + volume averages
_MIN_RANGE_RATIO = 2.0         # EP range >= 2x 20-bar avg range
_MIN_VOLUME_RATIO = 2.0        # EP volume >= 2x 20-bar avg volume
_MIN_CLOSE_STRENGTH = 0.70     # close in top 30% of bar's range
_MAX_EP_AGE = 5                # EP bar must be in most recent 5 bars
_CONFIDENCE_FLOOR = 50.0


def detect_episodic_pivot(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Episodic Pivot patterns. May emit 0-N detections (best one)."""
    # Need enough history for averages (20 bars) + base (15+) + EP window (5).
    if len(bars) < _AVG_LOOKBACK + _MIN_BASE_BARS + 1:
        return []

    last_bar_idx = len(bars) - 1

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    # Walk every candidate EP bar in the last _MAX_EP_AGE bars
    for offset in range(_MAX_EP_AGE):
        ep_idx = last_bar_idx - offset
        if ep_idx < _AVG_LOOKBACK + _MIN_BASE_BARS:
            continue

        candidate = _try_extract(bars, ep_idx)
        if candidate is None:
            continue

        # Hostile context gate — Stage 4 + stacked bearish + RS down = reject
        if _hostile_context(context):
            continue

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(candidate)
        ctx_score = _score_context(context)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        if confidence > best_confidence:
            best_confidence = confidence
            best_candidate = candidate
            best_scores = (geom_score, vol_score, ctx_score, hist_score)

    if best_candidate is None:
        return []

    geom_score, vol_score, ctx_score, hist_score = best_scores
    d = _build_detection(bars, best_candidate, best_confidence, context,
                         geom_score, vol_score, ctx_score, hist_score)
    return [d]


def _try_extract(bars: List[Bar], ep_idx: int) -> Optional[dict]:
    """Try to extract an EP pattern with `ep_idx` as the EP bar.

    Returns candidate dict or None if any gate fails.
    """
    ep_bar = bars[ep_idx]
    ep_high = ep_bar["h"]
    ep_low = ep_bar["l"]
    ep_close = ep_bar["c"]
    ep_open = ep_bar["o"]
    ep_volume = ep_bar["v"]

    ep_range = ep_high - ep_low
    if ep_range <= 0:
        return None

    # Close strength: where in the bar's range did close land?
    close_strength = (ep_close - ep_low) / ep_range
    if close_strength < _MIN_CLOSE_STRENGTH:
        return None

    # 20-bar lookback (excluding the EP bar itself) for averages
    lookback_start = max(0, ep_idx - _AVG_LOOKBACK)
    lookback = bars[lookback_start:ep_idx]
    if len(lookback) < _AVG_LOOKBACK // 2:
        return None

    avg_range = sum(b["h"] - b["l"] for b in lookback) / len(lookback)
    avg_volume = sum(b["v"] for b in lookback) / len(lookback)
    if avg_range <= 0 or avg_volume <= 0:
        return None

    range_ratio = ep_range / avg_range
    volume_ratio = ep_volume / avg_volume

    if range_ratio < _MIN_RANGE_RATIO:
        return None
    if volume_ratio < _MIN_VOLUME_RATIO:
        return None

    # Identify the base: walk backward from ep_idx looking for a 15-60 bar
    # window with depth <=25% where the EP bar's close is above base_high.
    # We try the longest viable base (helps the rich narrative).
    best_base = None
    for n in range(_MAX_BASE_BARS, _MIN_BASE_BARS - 1, -1):
        base_start = ep_idx - n
        if base_start < 0:
            continue
        base_segment = bars[base_start:ep_idx]
        base_high = max(b["h"] for b in base_segment)
        base_low = min(b["l"] for b in base_segment)
        if base_high <= 0:
            continue
        depth = (base_high - base_low) / base_high
        if depth > _MAX_BASE_DEPTH:
            continue
        # EP close must break above the entire base range
        if ep_close <= base_high:
            continue
        best_base = {
            "base_start_idx": base_start,
            "base_end_idx": ep_idx - 1,
            "base_high": base_high,
            "base_low": base_low,
            "base_depth_pct": depth,
            "base_bars": n,
        }
        break

    if best_base is None:
        return None

    return {
        "ep_idx": ep_idx,
        "ep_high": ep_high,
        "ep_low": ep_low,
        "ep_close": ep_close,
        "ep_open": ep_open,
        "ep_volume": ep_volume,
        "ep_range": ep_range,
        "range_ratio": range_ratio,
        "volume_ratio": volume_ratio,
        "close_strength": close_strength,
        "avg_range": avg_range,
        "avg_volume": avg_volume,
        **best_base,
    }


def _hostile_context(context: dict) -> bool:
    """Reject EPs in clearly hostile market context (Stage 4 + bearish stack + RS down)."""
    stage_bad = context.get("trend_stage") == 4
    ma_bad = context.get("ma_alignment") == "stacked_bearish"
    rs_bad = context.get("rs_trend") == "down"
    return stage_bad and ma_bad and rs_bad


def _score_geometry(c: dict) -> float:
    """Geometry score components:
       - flatness_score: tighter base = better (depth 5-15% = 100, 25% = 0)
       - range_score: bigger EP range expansion = better (3x = 80, 4x+ = 100)
       - close_strength_score: closer to bar high = better (>=0.90 = 100)
    """
    # Base flatness: 5-15% = ideal, 25% = floor
    depth = c["base_depth_pct"]
    if depth <= 0.05:
        flatness_score = 90.0   # very tight, but slightly penalized as suspect
    elif depth <= 0.15:
        flatness_score = 100.0
    elif depth <= _MAX_BASE_DEPTH:
        flatness_score = max(0.0, 100.0 - (depth - 0.15) / 0.10 * 100.0)
    else:
        flatness_score = 0.0

    # Range expansion: 2x = 50, 3x = 80, 4x+ = 100
    rr = c["range_ratio"]
    if rr >= 4.0:
        range_score = 100.0
    elif rr >= 3.0:
        range_score = 80.0 + (rr - 3.0) / 1.0 * 20.0
    elif rr >= 2.0:
        range_score = 50.0 + (rr - 2.0) / 1.0 * 30.0
    else:
        range_score = 0.0

    # Close strength: 0.70 = 50, 0.85 = 80, 0.95+ = 100
    cs = c["close_strength"]
    if cs >= 0.95:
        close_score = 100.0
    elif cs >= 0.85:
        close_score = 80.0 + (cs - 0.85) / 0.10 * 20.0
    elif cs >= _MIN_CLOSE_STRENGTH:
        close_score = 50.0 + (cs - _MIN_CLOSE_STRENGTH) / 0.15 * 30.0
    else:
        close_score = 0.0

    # Base length: 20-40 bars is textbook accumulation window
    n = c["base_bars"]
    if 20 <= n <= 40:
        length_score = 100.0
    elif n < 20:
        length_score = 60.0 + (n - _MIN_BASE_BARS) / 5.0 * 40.0
    else:
        length_score = max(0.0, 100.0 - (n - 40) / 20.0 * 40.0)

    return round(
        0.30 * flatness_score
        + 0.30 * range_score
        + 0.25 * close_score
        + 0.15 * length_score,
        2,
    )


def _score_volume(c: dict) -> float:
    """Score volume ratio. 2x = 50, 3x = 75, 4x+ = 100."""
    vr = c["volume_ratio"]
    if vr >= 4.0:
        return 100.0
    if vr >= 3.0:
        return 75.0 + (vr - 3.0) / 1.0 * 25.0
    if vr >= _MIN_VOLUME_RATIO:
        return 50.0 + (vr - _MIN_VOLUME_RATIO) / 1.0 * 25.0
    return 0.0


def _score_context(context: dict) -> float:
    """EP wants Stage 1 (basing) or Stage 2 (early uptrend), neutral/bullish MA."""
    score = 40.0
    stage = context.get("trend_stage")
    if stage in (1, 2):
        score += 25.0
    elif stage == 3:
        score += 5.0    # late-cycle, some risk
    # else Stage 4 or unknown: no bonus

    align = context.get("ma_alignment")
    if align == "stacked_bullish":
        score += 20.0
    elif align == "mixed":
        score += 10.0

    rs = context.get("rs_trend")
    if rs == "up":
        score += 15.0
    elif rs == "flat":
        score += 5.0

    return min(100.0, score)


# Custom variant - does not match shared narrative_helpers
def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "fully stacked-bullish"
    if align == "stacked_bearish":
        return "stacked-bearish"
    return "mixed"


# Custom variant - does not match shared narrative_helpers
def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 1:
        return "a Stage 1 base/accumulation environment"
    if stage == 2:
        return "a confirmed Stage 2 uptrend"
    if stage == 3:
        return "a Stage 3 distribution environment (caution)"
    if stage == 4:
        return "a Stage 4 downtrend environment (caution)"
    return "an undefined trend stage"


# Custom variant - does not match shared narrative_helpers
def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving"
    if rs == "down":
        return "deteriorating"
    return "neutral"


def _regime_context_sentence(context: dict, c: dict) -> str:
    """Sentence connecting regime/context to the EP's trade-readiness."""
    regime = context.get("regime", "current")
    stage = context.get("trend_stage", 0)
    vr = c["volume_ratio"]
    if stage in (1, 2) and vr >= 3.0:
        return (f"Within the {regime} regime, an EP at {vr:.1f}x volume in "
                f"a Stage {stage} structure is exactly the profile Bonde teaches "
                f"as institutional capitulation to the upside")
    if stage in (1, 2):
        return (f"Within the {regime} regime, the Stage {stage} backdrop gives "
                f"this EP a constructive runway — basing or early-uptrend stocks "
                f"are where EPs convert at the highest rate")
    return (f"The {regime} regime context is mixed and operators should size "
            f"accordingly")


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    ep_idx = c["ep_idx"]
    ep_bar = bars[ep_idx]
    base_start_bar = bars[c["base_start_idx"]]
    base_end_bar = bars[c["base_end_idx"]]
    last_bar = bars[-1]

    ep_high = c["ep_high"]
    ep_low = c["ep_low"]
    ep_close = c["ep_close"]
    base_high = c["base_high"]
    base_low = c["base_low"]
    base_depth_pct = c["base_depth_pct"]
    base_bars = c["base_bars"]
    range_ratio = c["range_ratio"]
    volume_ratio = c["volume_ratio"]
    close_strength = c["close_strength"]

    base_height = base_high - base_low

    # Levels
    entry = round(ep_high * 1.001, 2)
    stop = round(ep_low * 0.985, 2)
    target_primary = round(ep_close + base_height * 1.5, 2)
    target_secondary = round(ep_close + base_height * 2.5, 2)
    rr = (target_primary - entry) / (entry - stop) if entry > stop else 0.0

    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    # Geometry anchors: base_left, base_right, ep_bar
    anchors = [
        {"t": int(base_start_bar["t"]), "price": float(base_high)},
        {"t": int(base_end_bar["t"]), "price": float(base_high)},
        {"t": int(ep_bar["t"]), "price": float(ep_close)},
    ]

    now = int(time.time())

    pivot_ts = [
        int(base_start_bar["t"]),
        int(base_end_bar["t"]),
        int(ep_bar["t"]),
        int(last_bar["t"]),
    ]

    # ---- Narrative composition — RICH, paragraph-length, real values woven in ----
    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime_sentence = _regime_context_sentence(context, c)
    close_strength_pct = close_strength * 100.0
    base_depth_pct_pct = base_depth_pct * 100.0

    sym_token = "the stock"

    headline = (
        f"Episodic Pivot - {range_ratio:.1f}x range expansion on "
        f"{volume_ratio:.1f}x volume, closed in top {(1.0 - close_strength) * 100:.0f}% "
        f"of range. Pivot ${ep_high:.2f}, target ${target_primary:.2f}, "
        f"R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Episodic Pivot, codified by Pradeep Bonde of Stockbee from "
        f"decades of pattern study on liquid US equities, is the chart's "
        f"announcement that a stock's character has fundamentally changed. "
        f"After {sym_token} spent {base_bars} bars in a sideways base of only "
        f"{base_depth_pct_pct:.1f}% depth - where supply and demand were in "
        f"equilibrium and price oscillated between ${base_low:.2f} and "
        f"${base_high:.2f} - a SINGLE bar appeared that violently broke that "
        f"equilibrium. The signature is unmistakable: range expansion of "
        f"{range_ratio:.1f}x the 20-bar average, volume of {volume_ratio:.1f}x "
        f"the 20-bar average, and a close at ${ep_close:.2f} in the top "
        f"{(1.0 - close_strength) * 100:.0f}% of the bar's range - decisively "
        f"above the entire base. That three-fer (range + volume + close "
        f"strength) is the textbook EP signature, and Bonde teaches that this "
        f"is the day institutional buyers stop accumulating quietly and "
        f"aggressively acquire shares. The {base_bars}-bar base preceding the "
        f"EP was the slow accumulation phase; the EP bar is when that "
        f"accumulation becomes urgent, public, and unmistakable on the tape. "
        f"Kristjan Kullamägi has refined Bonde's original EP read for the "
        f"modern momentum tape with explicit criteria: an ATR-relative thrust "
        f"bar (the EP bar's range expressed in multiples of the trailing ATR) "
        f"plus a clean 3-5 week base immediately preceding the print — his "
        f"playbook entry triggers on the high of the EP day with stop under "
        f"the EP-day low. Lance Breitstein's intraday opening-drive EP read "
        f"applies the same framework to the 9:30 AM bar — the first 30-minute "
        f"opening drive that breaks a prior multi-week base on volume — and "
        f"Burnt Toast's small-cap variant focuses on the EP as a catalyst-"
        f"driven character-change signal in lower-float names."
    )

    why_it_matters = (
        f"This EP is forming in {stage_phrase} with {ma_phrase} moving-average "
        f"alignment and {rs_phrase} relative strength, which is the ideal "
        f"context - bases at the start of Stage 2 or the back end of Stage 1 "
        f"produce the cleanest follow-through on EPs. The {volume_ratio:.1f}x "
        f"volume on the EP bar is the critical metric: anything below 2x is "
        f"suspect, above 3x is gold, and what we have here at {volume_ratio:.1f}x "
        f"signals a high-conviction institutional decision to take a position "
        f"size that the tape can't hide. The fact that price closed at "
        f"${ep_close:.2f} in the top {(1.0 - close_strength) * 100:.0f}% of the "
        f"bar's range - not in the middle, not faded back into the body - "
        f"confirms that buyers were in control through the entire session, "
        f"not just on a morning spike that got sold. {regime_sentence}. "
        f"Bonde's published track record on EPs against liquid stocks shows "
        f"the pattern has a 70%+ continuation rate when bought near the close "
        f"of the EP bar or on a tight 1-2 day pullback that holds the EP "
        f"bar's mid-range, with average follow-through measured in weeks, "
        f"not days."
    )

    what_to_watch_for = (
        f"The trigger is a daily close above ${entry:.2f} (EP bar high "
        f"${ep_high:.2f} plus a small confirmation buffer) - this confirms "
        f"the EP didn't just spike and fade but is the start of a sustained "
        f"move. The ideal entry is one of three paths: (a) buy near the close "
        f"of the EP bar itself if you recognized it in real time, (b) buy on "
        f"a tight 1-3 bar pullback that holds above the EP bar's mid-range "
        f"around ${(ep_high + ep_low) / 2:.2f}, or (c) buy on the first close "
        f"above ${entry:.2f} with volume that stays at or above the prior "
        f"20-bar average. Avoid chasing more than 5% above the EP bar high - "
        f"Bonde explicitly teaches that EPs which extend too quickly often "
        f"fade as fast-money traders take profits and the institutional bid "
        f"runs out of inventory to buy. Volume on the follow-through bars "
        f"should remain at least 1.0x the prior 20-bar average; if volume "
        f"dries up to half-average immediately after the EP, the institutional "
        f"buying may be exhausting rather than continuing. Primary target is "
        f"${target_primary:.2f} (base height of ${base_height:.2f} projected "
        f"1.5x from the EP close) and secondary at ${target_secondary:.2f} "
        f"(2.5x projection) - both targets typically hit within 4-12 weeks on "
        f"clean EPs that hold their initial breakout."
    )

    failure_signal = (
        f"The EP is invalidated if price closes BELOW the EP bar low at "
        f"${ep_low:.2f} (stop set at ${stop:.2f}, 1.5% below) - this is "
        f"'filling the EP bar' in Bonde's terminology, and it's the precise "
        f"invalidation because it signals the dramatic move was emotional or "
        f"news-driven rather than institutional. When the EP bar gets filled, "
        f"the prior base equilibrium between ${base_low:.2f} and ${base_high:.2f} "
        f"reasserts itself, and the prior accumulation thesis collapses. A "
        f"more subtle failure: the 2-3 bars after the EP fade back into the "
        f"lower half of the EP bar on declining volume - even if they don't "
        f"break the EP low, this fade pattern often precedes a failed move "
        f"and an EP-low test is highly probable within a week. Position "
        f"sizing on EP trades MUST reflect the {stop_distance_pct:.1f}% stop "
        f"distance - the very range expansion that defines a good EP also "
        f"means your stop is naturally further than on tighter setups, and "
        f"sizing for a 1% account risk implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)):.0f}% of equity per trade. "
        f"Discipline is what makes EP trading profitable: the pattern wins "
        f"70%+ of the time, but the losing 30% must be cut immediately at "
        f"${stop:.2f} - never widen the stop, never average down, never "
        f"argue with a filled EP bar."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Episodic Pivot",
        "category": "uct",
        "direction": "bullish",
        "start_t": int(base_start_bar["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": {
                "base_bars": int(base_bars),
                "base_depth_pct": round(base_depth_pct * 100.0, 2),
                "base_high": round(base_high, 2),
                "base_low": round(base_low, 2),
                "base_height": round(base_height, 2),
                "ep_range_ratio": round(range_ratio, 2),
                "ep_volume_ratio": round(volume_ratio, 2),
                "close_strength": round(close_strength, 3),
                "ep_high": round(ep_high, 2),
                "ep_low": round(ep_low, 2),
                "ep_close": round(ep_close, 2),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume >= 1x 20-bar avg",
            "stop": stop,
            "stop_basis": "ep_bar_low_minus_1.5pct",
            "target_primary": target_primary,
            "target_secondary": target_secondary,
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


register(_PATTERN_ID, detect_episodic_pivot)
