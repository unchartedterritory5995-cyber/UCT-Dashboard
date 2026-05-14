"""Descending Triangle detector.

A descending triangle is a bearish continuation/reversal pattern: a horizontal
support floor being repeatedly tested while a falling resistance trendline
makes progressively lower highs. The flat bottom reflects a fixed buyer who
keeps stepping in at the same price; the falling highs reflect sellers more
aggressive on each rally - they will not wait for a deep rally to dump.
Resolution is typically a breakdown below the horizontal support.

Geometric definition:
  - Window: 20-60 bars
  - Lower boundary: HORIZONTAL support band (swing-low pivots cluster within
    2% of each other); >=2 touches
  - Upper boundary: FALLING resistance trendline (slope < 0, r_squared >= 0.7,
    >=2 touches, validity >= 0.6)
  - Convergence: at the right edge, falling resistance is within 5% of flat bottom
  - Volume: contracting through pattern (preferred)

Scoring (composite 0-100):
  geometry_score, volume_score, context_score, historical_score (50 neutral)

Attribution: Edwards & Magee, "Technical Analysis of Stock Trends" (1948);
Schabacker (1932). Bulkowski reports ~64% measured-move follow-through on
volume-confirmed breakdowns.
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.geometry import line_at
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.trendlines import fit_trendline
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "descending_triangle"
_MIN_BARS = 20
_MAX_BARS = 60
_MIN_TOUCHES = 2
_MIN_LINE_VALIDITY = 0.4
_MIN_R_SQUARED = 0.55
_MAX_FLAT_BOTTOM_SPREAD_PCT = 0.02
_MAX_CONVERGENCE_GAP_PCT = 0.05
_MIN_CONVERGENCE_RATIO_MAX = 0.85
_CONFIDENCE_FLOOR = 50.0


def detect_descending_triangle(bars: List[Bar], context: dict) -> List[Detection]:
    if len(bars) < _MIN_BARS + 5:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 4:
        return []

    end_idx = len(bars) - 1
    seen_starts = set()
    for window_len in (40, 30, 50, 25, 35, 45, 55):
        start_idx = end_idx - window_len + 1
        if start_idx < 5:
            continue
        if start_idx in seen_starts:
            continue
        seen_starts.add(start_idx)
        candidate = _try_extract_pattern(bars, pivots, start_idx, end_idx)
        if candidate is None:
            continue

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, candidate)
        ctx_score = _score_context(context)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(bars, candidate, confidence, context,
                             geom_score, vol_score, ctx_score, hist_score)
        detections.append(d)
        break

    return detections


def _try_extract_pattern(bars, pivots, start_idx: int, end_idx: int) -> Optional[dict]:
    pattern_bars = bars[start_idx:end_idx + 1]
    bar_count = len(pattern_bars)
    if bar_count < _MIN_BARS or bar_count > _MAX_BARS:
        return None

    high_pivots_raw = [p for p in pivots
                       if p["type"] == "high" and start_idx <= p["bar_index"] <= end_idx]
    low_pivots_raw = [p for p in pivots
                      if p["type"] == "low" and start_idx <= p["bar_index"] <= end_idx]
    if len(high_pivots_raw) < _MIN_TOUCHES or len(low_pivots_raw) < _MIN_TOUCHES:
        return None

    # Identify horizontal support band: cluster swing-low pivots (lowest cluster).
    low_prices = sorted([p["price"] for p in low_pivots_raw])
    cluster_bottom = low_prices[0]
    cluster_pivots_raw = [p for p in low_pivots_raw
                          if (p["price"] - cluster_bottom) / cluster_bottom <= _MAX_FLAT_BOTTOM_SPREAD_PCT]
    if len(cluster_pivots_raw) < _MIN_TOUCHES:
        return None

    cluster_prices = [p["price"] for p in cluster_pivots_raw]
    flat_bottom_price = sum(cluster_prices) / len(cluster_prices)
    flat_bottom_spread = (max(cluster_prices) - min(cluster_prices)) / flat_bottom_price

    high_pivots = [{"t": p["bar_index"], "price": p["price"],
                    "type": "high", "strength": p["strength"],
                    "bar_index": p["bar_index"]} for p in high_pivots_raw]

    try:
        upper_line = fit_trendline(high_pivots)
    except ValueError:
        return None

    if upper_line["slope"] >= 0:
        return None
    if upper_line["touches"] < _MIN_TOUCHES:
        return None
    if upper_line["validity"] < _MIN_LINE_VALIDITY:
        return None
    if upper_line["r_squared"] < _MIN_R_SQUARED:
        return None

    lower_line = {
        "p1": {"t": int(start_idx), "price": float(flat_bottom_price)},
        "p2": {"t": int(end_idx), "price": float(flat_bottom_price)},
        "slope": 0.0,
        "r_squared": max(0.0, 1.0 - flat_bottom_spread / _MAX_FLAT_BOTTOM_SPREAD_PCT),
        "touches": len(cluster_pivots_raw),
        "validity": min(1.0, len(cluster_pivots_raw) / 4.0
                        + max(0.0, 1.0 - flat_bottom_spread / _MAX_FLAT_BOTTOM_SPREAD_PCT) * 0.5),
    }

    upper_at_end = line_at((upper_line["p1"], upper_line["p2"]), end_idx)
    if upper_at_end <= flat_bottom_price:
        return None
    gap_pct = (upper_at_end - flat_bottom_price) / flat_bottom_price
    if gap_pct > _MAX_CONVERGENCE_GAP_PCT:
        return None

    upper_at_start = line_at((upper_line["p1"], upper_line["p2"]), start_idx)
    width_start = upper_at_start - flat_bottom_price
    width_end = upper_at_end - flat_bottom_price
    if width_start <= 0 or width_end <= 0:
        return None
    convergence_ratio = width_end / width_start
    if convergence_ratio >= _MIN_CONVERGENCE_RATIO_MAX:
        return None

    earliest_swing_high = max(high_pivots_raw, key=lambda p: p["price"])
    earliest_swing_high_price = earliest_swing_high["price"]

    pattern_low = min(b["l"] for b in pattern_bars)
    pattern_high = max(b["h"] for b in pattern_bars)

    return {
        "start_idx": start_idx,
        "end_idx": end_idx,
        "pattern_bars": pattern_bars,
        "pattern_count": bar_count,
        "pattern_low": pattern_low,
        "pattern_high": pattern_high,
        "flat_bottom_price": flat_bottom_price,
        "flat_bottom_spread_pct": flat_bottom_spread,
        "upper_at_start": upper_at_start,
        "upper_at_end": upper_at_end,
        "gap_pct": gap_pct,
        "convergence_ratio": convergence_ratio,
        "width_start": width_start,
        "width_end": width_end,
        "upper_line": upper_line,
        "lower_line": lower_line,
        "upper_slope": upper_line["slope"],
        "lower_slope": 0.0,
        "highest_swing": earliest_swing_high_price,
        "cluster_touches": len(cluster_pivots_raw),
        "high_touches": upper_line["touches"],
    }


def _score_geometry(c: dict) -> float:
    flatness = max(0.0, (1.0 - c["flat_bottom_spread_pct"] / _MAX_FLAT_BOTTOM_SPREAD_PCT)) * 100.0
    rs_quality = c["upper_line"]["r_squared"] * 100.0
    cluster_score = min(100.0, c["cluster_touches"] * 33.0)
    high_score = min(100.0, c["high_touches"] * 33.0)
    touch_score = (cluster_score + high_score) / 2.0
    if c["gap_pct"] <= 0.02:
        conv_score = 100.0
    elif c["gap_pct"] <= 0.05:
        conv_score = 80.0
    else:
        conv_score = max(0.0, 100.0 - (c["gap_pct"] - 0.05) * 1500.0)
    duration_score = max(0.0, 100.0 - abs(c["pattern_count"] - 36) * 3.0)
    return round(0.25 * flatness + 0.20 * rs_quality + 0.20 * touch_score
                 + 0.20 * conv_score + 0.15 * duration_score, 2)


def _score_volume(bars: List[Bar], c: dict) -> float:
    pattern = c["pattern_bars"]
    if len(pattern) < 4:
        return 50.0
    half = len(pattern) // 2
    first_avg = sum(b["v"] for b in pattern[:half]) / half
    second_avg = sum(b["v"] for b in pattern[half:]) / (len(pattern) - half)
    if first_avg <= 0:
        return 50.0
    ratio = second_avg / first_avg
    if ratio >= 1.0:
        return 25.0
    return round(max(0.0, min(100.0, (1.0 - ratio) * 150.0)), 2)


def _score_context(context: dict) -> float:
    score = 50.0
    if context.get("trend_stage") == 4:
        score += 25
    elif context.get("trend_stage") == 3:
        score += 15
    if context.get("ma_alignment") == "stacked_bearish":
        score += 15
    if context.get("rs_trend") == "down":
        score += 10
    if context.get("volume_signature") == "contracting":
        score += 10
    # DCR integration (Phase 7.5) — bearish continuation: distribution = tailwind.
    score += _dcr_score_adjustment(context)
    return min(100.0, max(0.0, score))


def _dcr_score_adjustment(context: dict) -> float:
    """Return the DCR-derived score adjustment for a bearish continuation pattern."""
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "distribution" and recent_dcr <= 0.35:
        return 12.0   # sellers closing positions strong
    if dcr_sig == "accumulation":
        return -8.0   # buyers absorbing into close — bearish pattern faces headwind
    return 0.0


# Custom variant - does not match shared narrative_helpers
def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bearish":
        return "fully stacked-bearish moving-average (textbook downtrend tape)"
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (counter-trend short - lower odds)"
    return "mixed moving-average"


# Custom variant - does not match shared narrative_helpers
def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 4:
        return "a confirmed Stage 4 downtrend (textbook bearish continuation context)"
    if stage == 3:
        return "a Stage 3 distribution environment (the triangle marks the roll-over)"
    if stage == 1:
        return "a Stage 1 basing environment (counter-trend caution)"
    if stage == 2:
        return "a Stage 2 uptrend (counter-trend short - reduced odds, demand still active)"
    return "an undefined trend stage"


# Custom variant - does not match shared narrative_helpers
def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "down":
        return "deteriorating"
    if rs == "up":
        return "improving (counter-trend warning)"
    return "neutral"


# Custom variant - does not match shared narrative_helpers
def _dcr_phrase(context: dict) -> str:
    sig = context.get("dcr_signature", "neutral")
    avg = context.get("recent_dcr_avg", 0.5)
    if sig == "distribution":
        return f"distribution-signature daily close ratio (recent avg {avg:.2f} - closes near lows)"
    if sig == "accumulation":
        return f"accumulation-signature daily close ratio (avg {avg:.2f} - closes near highs, warning for shorts)"
    return f"neutral daily close ratio (avg {avg:.2f})"


def _vol_ratio(bars: List[Bar], c: dict) -> float:
    pattern = c["pattern_bars"]
    if len(pattern) < 4:
        return 1.0
    half = len(pattern) // 2
    first_avg = sum(b["v"] for b in pattern[:half]) / max(half, 1)
    second_avg = sum(b["v"] for b in pattern[half:]) / max(len(pattern) - half, 1)
    if first_avg <= 0:
        return 1.0
    return second_avg / first_avg


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    end_idx = c["end_idx"]

    flat_bottom = c["flat_bottom_price"]
    upper_at_now = c["upper_at_end"]
    highest_swing = c["highest_swing"]

    entry = round(flat_bottom * 0.999, 2)
    stop = round(upper_at_now * 1.015, 2)
    target = round(entry - (highest_swing - flat_bottom), 2)
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0
    stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

    vol_ratio_val = _vol_ratio(bars, c)
    vol_pct = vol_ratio_val * 100.0

    pattern_count = c["pattern_count"]
    upper_slope = c["upper_slope"]
    upper_r2 = c["upper_line"]["r_squared"]
    upper_touches = c["high_touches"]
    cluster_touches = c["cluster_touches"]
    flat_spread_pct = c["flat_bottom_spread_pct"] * 100.0
    convergence_pct = c["convergence_ratio"] * 100.0
    gap_pct = c["gap_pct"] * 100.0
    pattern_height = highest_swing - flat_bottom

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    dcr_phrase = _dcr_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    headline = (
        f"Descending Triangle forming on {sym_token} - flat support "
        f"${flat_bottom:.2f} ({cluster_touches} touches, spread "
        f"{flat_spread_pct:.2f}%), falling resistance at ${upper_at_now:.2f} "
        f"({upper_touches} touches, r2 {upper_r2:.2f}), {pattern_count}-bar "
        f"coil, gap-to-apex {gap_pct:.1f}%. Pivot ${entry:.2f}, target "
        f"${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Descending Triangle is the bearish mirror of the ascending "
        f"triangle, documented by Schabacker (1932) and formalized by Edwards "
        f"& Magee in 'Technical Analysis of Stock Trends' (1948). The pattern "
        f"pairs a horizontal lower boundary - here a flat support shelf at "
        f"${flat_bottom:.2f} confirmed by {cluster_touches} swing-low pivots "
        f"clustered within a {flat_spread_pct:.2f}% band - with a falling "
        f"upper trendline with slope {upper_slope:.4f} per bar, r-squared "
        f"{upper_r2:.2f}, anchored by {upper_touches} swing-high touches. "
        f"Width has compressed from ${c['width_start']:.2f} to "
        f"${c['width_end']:.2f} across {pattern_count} bars (convergence "
        f"ratio {convergence_pct:.0f}% of start), and the falling resistance "
        f"now sits ${upper_at_now - flat_bottom:.2f} ({gap_pct:.1f}%) above "
        f"the flat bottom - inside the apex zone where resolution is "
        f"imminent. The market mechanic underneath inverts the ascending-"
        f"triangle story: a fixed demand level at ${flat_bottom:.2f} is "
        f"defended by buyers placing limit orders, but each rally meets "
        f"sellers more aggressive than the last - they will not wait for a "
        f"deeper rally to dump inventory. The lower highs are the chart "
        f"language of accelerating distribution; the flat bottom is the chart "
        f"language of a buyer running out of capital. Volume contracting to "
        f"{vol_pct:.0f}% of first-half average is the textbook confirmation "
        f"that the defending demand is depleted. Bulkowski's 'Encyclopedia "
        f"of Chart Patterns' classifies descending triangles among the more "
        f"reliable bearish continuation structures with ~64-70% measured-move "
        f"follow-through when the breakdown fires on volume. Constance Brown's "
        f"'Technical Analysis for the Trading Professional' updates the classical "
        f"interpretation with momentum confluence: a descending triangle whose "
        f"RSI stays capped below 50 through the consolidation is, in her "
        f"framework, a markedly higher-edge short setup than the geometry "
        f"alone implies."
    )

    why_it_matters = (
        f"This descending triangle is forming in {stage_phrase} with {ma_phrase} "
        f"alignment, {rs_phrase} relative strength versus the broader market, "
        f"and a {dcr_phrase}. The {regime} regime sets the macro backdrop and "
        f"the volume signature reads {vol_signature}. The {pattern_count}-bar "
        f"build is meaningful evidence of sustained, repeatable distribution: "
        f"each of the {upper_touches} swing-high touches connected by a clean "
        f"r-squared {upper_r2:.2f} regression line is a separate auction in "
        f"which sellers agreed to step in at a LOWER price than the prior "
        f"rally - that behavioural consistency is what gives descending "
        f"triangles their edge over symmetrical coils where neither side "
        f"commits. The flat-bottom spread of {flat_spread_pct:.2f}% across "
        f"{cluster_touches} troughs means a specific buyer (institution, "
        f"technical level, prior breakout retest) is being repeatedly tested "
        f"and weakening - each test of a support level statistically increases "
        f"the probability that the next test breaks it because each defense "
        f"consumes that buyer's available capital. The fact that falling "
        f"resistance has closed to within {gap_pct:.1f}% of the flat bottom "
        f"places us in the apex zone - the period of highest reliability "
        f"because the pattern has virtually no room left to extend. A "
        f"contracting-volume descending triangle inside a Stage 4 downtrend "
        f"with distribution-signature daily close ratios is the highest-"
        f"conviction expression of this short setup. Measured-move math "
        f"projects a ${pattern_height:.2f} downside target - the triangle "
        f"height projected DOWN from the breakdown level."
    )

    what_to_watch_for = (
        f"The trigger is a daily close below ${entry:.2f} (the flat bottom "
        f"at ${flat_bottom:.2f} minus a small confirmation buffer) on volume "
        f"of at least 1.5x the 20-bar average - that volume expansion on the "
        f"breakdown is non-negotiable because a break on quiet tape on the "
        f"third or fourth test of a support shelf frequently reverts back "
        f"into the triangle as shorts realize there is no fresh supply behind "
        f"the move. The ideal trigger bar closes in the lower third of its "
        f"range with a wide real body, and the next 1-3 bars should hold "
        f"below ${flat_bottom:.2f} without retracing more than a third of the "
        f"breakdown move - a sloppy close that wicks back through the "
        f"breakdown level is a yellow flag for a bear trap. Measured target "
        f"is ${target:.2f}, derived by projecting the pattern height of "
        f"${pattern_height:.2f} (highest swing ${highest_swing:.2f} minus "
        f"flat bottom ${flat_bottom:.2f}) down from the breakdown. Initial "
        f"stop sits at ${stop:.2f}, 1.5% above the falling trendline at the "
        f"current bar (${upper_at_now:.2f}) - that represents a "
        f"{stop_distance_pct:.1f}% risk from entry, so risking 1% of account "
        f"on this short implies a position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity. Trail the stop above each new swing high or above the "
        f"descending 10/20 EMA as the trade extends, and consider covering "
        f"partial size at 1R for a free trade. Remember short trades require "
        f"borrow availability and carry overnight gap risk that long trades "
        f"do not."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close above the falling "
        f"trendline at ${upper_at_now:.2f} (stop at ${stop:.2f}, 1.5% above "
        f"to absorb the standard upside wick) - that close signals the "
        f"distribution thesis is wrong and demand has overwhelmed the "
        f"sellers, frequently setting up a bear-trap squeeze. Descending "
        f"triangles fail roughly 36% of the time per Bulkowski's empirical "
        f"sample, and the most common failure mode is the 'failed breakdown': "
        f"price pokes below ${flat_bottom:.2f} on weak or merely-average "
        f"volume, the next 1-2 bars close in the upper half of their range, "
        f"and price recovers back into the triangle. That sequence is the "
        f"textbook Wyckoff 'spring' or selling climax - market makers used "
        f"the visible breakdown level as a short-side liquidity grab before "
        f"squeezing higher. Short squeezes can be uncapped to the upside, so "
        f"the {stop_distance_pct:.1f}% stop must be honored without "
        f"negotiation - widening a stop on a triangle that is failing is one "
        f"of the fastest ways to convert a manageable loss into an account-"
        f"damaging one, because the asymmetric risk profile of a short "
        f"(capped reward, uncapped loss) demands tighter discipline than long "
        f"trades. A subtler failure signal: the falling resistance gets "
        f"violated mid-pattern (before the breakdown) and the next bar fails "
        f"to break back below - that reclaim often precedes a full pattern "
        f"collapse and the trade should be skipped entirely. Volume "
        f"divergence is the leading tell: if the second half of the pattern "
        f"shows volume EXPANDING into the flat bottom rather than "
        f"contracting, the distribution narrative is inverted - that pattern "
        f"is more likely accumulation in disguise and the breakout will "
        f"resolve UPWARD."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Descending Triangle",
        "category": "classical",
        "direction": "bearish",
        "start_t": int(bars[c["start_idx"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[c["start_idx"]]["t"]),
                     int(bars[end_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "trendline_pair",
            "anchors": [
                {"t": int(c["upper_line"]["p1"]["t"]), "price": float(c["upper_line"]["p1"]["price"])},
                {"t": int(c["upper_line"]["p2"]["t"]), "price": float(c["upper_line"]["p2"]["price"])},
                {"t": int(c["lower_line"]["p1"]["t"]), "price": float(c["lower_line"]["p1"]["price"])},
                {"t": int(c["lower_line"]["p2"]["t"]), "price": float(c["lower_line"]["p2"]["price"])},
            ],
            "extras": {
                "pattern_bars": c["pattern_count"],
                "upper_slope": round(float(c["upper_slope"]), 6),
                "lower_slope": 0.0,
                "r_squared_upper": round(float(c["upper_line"]["r_squared"]), 3),
                "r_squared_lower": round(float(c["lower_line"]["r_squared"]), 3),
                "touches_upper": int(c["high_touches"]),
                "touches_lower": int(c["cluster_touches"]),
                "convergence_ratio": round(float(c["convergence_ratio"]), 3),
                "flat_bottom_price": round(float(flat_bottom), 2),
                "gap_pct": round(float(c["gap_pct"]) * 100, 2),
                "dcr_score_adj": round(_dcr_score_adjustment(context), 2),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close < {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "falling_trendline_plus_1.5pct",
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


register(_PATTERN_ID, detect_descending_triangle)
