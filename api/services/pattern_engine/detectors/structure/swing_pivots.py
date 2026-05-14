"""Swing Pivot Map - structure detector.

Unlike the trade-setup detectors that fire only when a specific geometry
materializes, the swing_pivots detector surfaces the invisible scaffolding
of the chart - the swing-high and swing-low pivots that experienced traders
use as support/resistance reference levels. It emits a SINGLE Detection
containing every significant pivot in the recent 60-bar window, marked as
anchor points so the chart overlay can render them.

Geometric definition:
  - Window: the most recent 60 bars (or all bars if series < 60)
  - Pivot extraction: detect_pivots(bars, window=3)
  - Filter: keep only pivots within the recent window
  - Minimum count: >=3 pivots required (else empty)
  - Direction: "neutral"
  - Confidence: 100 when >=3 pivots emit (structure detectors don't filter)

Levels (structural - NOT a trade trigger):
  - entry: most recent pivot's price (so a user can see the latest pivot level)
  - stop / target / risk_reward: None / None / 0.0
  - entry_condition: "Structural reference levels - not a trade trigger"
"""
from __future__ import annotations

import uuid
import time
from typing import List

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "swing_pivots"
_WINDOW_BARS = 60
_PIVOT_WINDOW = 3
_MIN_PIVOTS = 3


def detect_swing_pivots(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect swing pivots in the recent window. Emits 0 or 1 Detection.

    Returns [] if fewer than _MIN_PIVOTS swing pivots exist in the
    most-recent _WINDOW_BARS bars.
    """
    if len(bars) < 2 * _PIVOT_WINDOW + 1:
        return []

    all_pivots = detect_pivots(bars, window=_PIVOT_WINDOW)
    if not all_pivots:
        return []

    last_bar_idx = len(bars) - 1
    # Compute the window start index: most recent 60 bars
    window_start = max(0, last_bar_idx - _WINDOW_BARS + 1)
    window_bars = min(_WINDOW_BARS, len(bars))

    # Filter to pivots within the recent window
    recent_pivots = [p for p in all_pivots if p["bar_index"] >= window_start]
    if len(recent_pivots) < _MIN_PIVOTS:
        return []

    # Sort ascending by bar_index (detect_pivots already does, but be defensive)
    recent_pivots = sorted(recent_pivots, key=lambda p: p["bar_index"])

    return [_build_detection(bars, recent_pivots, context, window_bars, last_bar_idx)]


def _density_descriptor(density_per_10: float) -> str:
    if density_per_10 < 1.0:
        return "very low density - the recent action is dominantly trending with few reversals"
    if density_per_10 < 1.8:
        return "moderate density - a healthy balance of trend and reaction"
    if density_per_10 < 2.6:
        return "elevated density - frequent reversals suggesting consolidation or range-bound action"
    return "very high density - choppy two-sided action with reversals on nearly every leg"


def _age_descriptor(recent_count: int, older_count: int) -> str:
    if recent_count > older_count:
        return "recent activity is pivot-heavy versus the prior 40 bars"
    if recent_count < older_count:
        return "recent activity has fewer pivots than the prior 40 bars (smoother action)"
    return "recent vs older pivot counts are balanced"


def _recent_action_descriptor(recent_count: int, older_count: int) -> str:
    if recent_count > older_count:
        return "consolidating or chopping after the earlier trend"
    if recent_count < older_count:
        return "trending cleanly versus the choppier prior section"
    return "rotating between trend and consolidation"


def _stage_phrase(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    rs = context.get("rs_trend", "flat")
    align = context.get("ma_alignment", "mixed")
    if stage == 2:
        stage_str = "a Stage 2 uptrend"
    elif stage == 4:
        stage_str = "a Stage 4 downtrend"
    elif stage == 1:
        stage_str = "a Stage 1 base/accumulation environment"
    elif stage == 3:
        stage_str = "a Stage 3 distribution environment"
    else:
        stage_str = "an undefined trend stage"
    align_str = {
        "stacked_bullish": "stacked-bullish moving-average alignment",
        "stacked_bearish": "stacked-bearish moving-average alignment",
        "mixed": "mixed moving-average alignment",
    }.get(align, "mixed moving-average alignment")
    rs_str = {"up": "improving", "down": "deteriorating", "flat": "flat"}.get(rs, "flat")
    return (
        f"This pivot map is forming inside {stage_str} with {align_str} and "
        f"{rs_str} relative strength - the pivot levels carry the most weight "
        f"when read in that contextual frame"
    )


def _build_detection(
    bars: List[Bar],
    pivots: List[dict],
    context: dict,
    window_bars: int,
    last_bar_idx: int,
) -> Detection:
    pivot_count = len(pivots)
    pivot_high_count = sum(1 for p in pivots if p["type"] == "high")
    pivot_low_count = pivot_count - pivot_high_count

    # Most recent pivot
    most_recent = pivots[-1]
    most_recent_price = most_recent["price"]
    most_recent_type = most_recent["type"]
    most_recent_age_bars = last_bar_idx - most_recent["bar_index"]

    # Strongest pivot by strength score
    strongest = max(pivots, key=lambda p: p["strength"])
    strongest_pivot_price = strongest["price"]
    strongest_pivot_strength = strongest["strength"]
    strongest_pivot_type = strongest["type"]

    # Density: pivots per 10 bars of window
    pivot_density_per_10_bars = round(pivot_count / max(1, window_bars) * 10, 2)

    # Recent vs older split (last 20 bars vs prior 40)
    twenty_ago_idx = last_bar_idx - 20 + 1
    recent_pivots_count = sum(1 for p in pivots if p["bar_index"] >= twenty_ago_idx)
    older_pivots_count = pivot_count - recent_pivots_count

    # Average pivot strength
    avg_strength = sum(p["strength"] for p in pivots) / pivot_count

    # ---------- Scoring (structure detector - confidence always 100 when emitting) ----------
    geometry_score = round(min(100.0, pivot_count * avg_strength / 10.0), 2)
    volume_score = 50.0
    context_score = 50.0
    historical_score = 50.0
    confidence = 100.0

    # ---------- Levels (structural reference only - NOT a trade trigger) ----------
    entry = round(float(most_recent_price), 2)
    entry_condition = "Structural reference levels - not a trade trigger"
    stop = None
    stop_basis = ""
    target = None
    risk_reward = 0.0

    # ---------- Anchors: one per pivot ----------
    anchors = [{"t": int(p["t"]), "price": float(p["price"])} for p in pivots]
    pivot_ts = [int(p["t"]) for p in pivots]

    last_bar = bars[-1]
    now = int(time.time())

    # ---------- Narrative composition (rich, paragraph-length, real values) ----------
    density_desc = _density_descriptor(pivot_density_per_10_bars)
    age_desc = _age_descriptor(recent_pivots_count, older_pivots_count)
    recent_action_desc = _recent_action_descriptor(recent_pivots_count, older_pivots_count)
    stage_context = _stage_phrase(context)
    if pivot_density_per_10_bars >= 2.0:
        density_phrase = "rich (consolidation-style)"
    elif pivot_density_per_10_bars >= 1.2:
        density_phrase = "balanced"
    else:
        density_phrase = "sparse (trend-style)"

    headline = (
        f"Swing Pivot Map - {pivot_count} significant pivots over the last "
        f"{window_bars} bars. Most recent: {most_recent_type} at "
        f"${most_recent_price:.2f} ({most_recent_age_bars} bars ago)."
    )

    what_it_is = (
        f"Swing pivots are the reference levels where price has historically reversed - "
        f"each swing-high marked by a bar whose high strictly dominated its neighbors "
        f"over a 3-bar window on each side, each swing-low marked by a bar whose low "
        f"was the lowest in that same window. The fractal pivot method used here was "
        f"formalized by Welles Wilder in 'New Concepts in Technical Trading Systems' "
        f"(1978) — the same volume that introduced RSI, ATR, ADX, and Parabolic SAR — "
        f"and later refined by Bill Williams into the canonical Fractal indicator in "
        f"'Trading Chaos' (1995), defining a swing pivot as the centre bar of a five-bar "
        f"sequence whose high or low dominates both flanks. Richard Wyckoff used the "
        f"same structural read decades earlier when teaching point-and-figure tape "
        f"reading. The method detects these reversal points without any lag, and assigns "
        f"each pivot a strength score (0-100) reflecting how dominantly it stood out "
        f"from its neighbors and by what margin (a wider, larger-margin pivot scores "
        f"higher). Here {pivot_count} significant pivots have formed over the last "
        f"{window_bars} bars: {pivot_high_count} swing-highs and {pivot_low_count} "
        f"swing-lows. The pivot density of {pivot_density_per_10_bars} pivots per 10 "
        f"bars indicates {density_desc} (low density = trending price action; high "
        f"density = chop or consolidation). The strongest pivot in the window - at "
        f"${strongest_pivot_price:.2f} on the {strongest_pivot_type} side with strength "
        f"{strongest_pivot_strength}/100 - is the highest-conviction reversal level "
        f"visible on the chart and the natural anchor for any structural analysis."
    )

    why_it_matters = (
        f"Swing pivots are the foundation of every other pattern detector and every "
        f"traditional technical analysis approach - support/resistance levels, "
        f"trendlines, head-and-shoulders patterns, double tops/bottoms and the entire "
        f"VCP/cup-with-handle family all derive their geometry from swing pivots. In "
        f"the current {window_bars}-bar window, the {pivot_count} pivots provide a "
        f"{density_phrase} structural lattice to anchor entries, stops and analysis: "
        f"each pivot represents a price level where buyers (at the lows) or sellers "
        f"(at the highs) showed up with enough conviction to reverse the immediate "
        f"trend. The split of {recent_pivots_count} pivots in the last 20 bars versus "
        f"{older_pivots_count} in the prior 40 reveals that {age_desc}, which in turn "
        f"means the recent action is {recent_action_desc}. {stage_context}. These "
        f"pivots are not signals to trade in isolation - they are the reference grid "
        f"against which every entry, stop and exit decision is evaluated."
    )

    what_to_watch_for = (
        f"Watch how price interacts with each pivot as it approaches: rejection - "
        f"price stalling and immediately reversing - confirms the pivot's continued "
        f"validity, while a clean penetration (a daily close beyond the pivot's price "
        f"by 1% or more) often signals a regime change and a flip from resistance to "
        f"support or vice versa. The strongest pivot in this window - at "
        f"${strongest_pivot_price:.2f} ({strongest_pivot_type}, strength "
        f"{strongest_pivot_strength}/100) - is the most likely level to attract "
        f"institutional defense or selling and deserves the most attention on any "
        f"approach. Cluster zones - groups of pivots within roughly 2% of each other - "
        f"act as higher-conviction support/resistance because multiple historical "
        f"reversals reinforce the same level; scan the pivot list for clusters to "
        f"identify the strongest reference zones. As new bars print, watch for shifts "
        f"in pivot density: a sudden spike in pivot count (more reversals per N bars) "
        f"signals chop and consolidation, while pivot scarcity signals a strong "
        f"directional trend taking hold. Use these {pivot_count} levels as the basis "
        f"for stop placement on any trade entered in this name."
    )

    failure_signal = (
        f"Swing pivots themselves do not 'fail' - they are observed structure rather "
        f"than predictive setups, and the map is descriptive, not prescriptive. "
        f"However, individual pivots LOSE technical significance when price closes "
        f"meaningfully through them on volume (>1.5x the 20-bar average) without "
        f"immediate rejection over the next 1-3 bars. A swing-high pivot that is "
        f"exceeded by a strong close stops acting as resistance and starts acting as "
        f"support; a swing-low pivot that is broken stops acting as support and "
        f"starts acting as resistance - this is polarity inversion and it is one of "
        f"the most reliable phenomena in technical analysis. The age of each pivot "
        f"affects its reliability: pivots within the last 10-20 bars carry more "
        f"weight than pivots 50+ bars old, because the most recent reversals reflect "
        f"current institutional positioning and the older ones may be stale. Here "
        f"the most recent pivot is only {most_recent_age_bars} bars old and the "
        f"current split is {recent_pivots_count} recent vs {older_pivots_count} older, "
        f"so the freshness profile is informative. If price breaks through 50%+ of "
        f"the visible pivots in the current window over a 5-10 bar period, that is a "
        f"signal the prior structural framework has decisively changed - reset the "
        f"analysis on the new structure and rebuild the pivot map from scratch."
    )

    detection: Detection = {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Swing Pivot Map",
        "category": "structure",
        "direction": "neutral",
        "start_t": int(bars[pivots[0]["bar_index"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": {
                "pivot_count": int(pivot_count),
                "pivot_high_count": int(pivot_high_count),
                "pivot_low_count": int(pivot_low_count),
                "pivot_density_per_10_bars": float(pivot_density_per_10_bars),
                "strongest_pivot_price": round(float(strongest_pivot_price), 2),
                "strongest_pivot_strength": int(strongest_pivot_strength),
                "strongest_pivot_type": str(strongest_pivot_type),
                "window_bars": int(window_bars),
                "recent_pivots_count": int(recent_pivots_count),
                "older_pivots_count": int(older_pivots_count),
                "most_recent_pivot_price": round(float(most_recent_price), 2),
                "most_recent_pivot_type": str(most_recent_type),
                "most_recent_pivot_age_bars": int(most_recent_age_bars),
                "avg_pivot_strength": round(float(avg_strength), 2),
                "dcr_score_adj": 0.0,
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": entry_condition,
            "stop": stop,
            "stop_basis": stop_basis,
            "target_primary": target,
            "target_secondary": None,
            "risk_reward": risk_reward,
        },
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": geometry_score,
            "volume_score": volume_score,
            "context_score": context_score,
            "historical_score": historical_score,
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
    return detection


register(_PATTERN_ID, detect_swing_pivots)
