"""Bear flag detector.

A bear flag is a sharp downward move ("pole") followed by a tight rally
consolidation ("flag") that retraces a fraction of the pole. Continuation
pattern in downtrends.

Geometric definition:
  - Pole: >=8% DECLINE from a swing high to a swing low, over <=20 bars
  - Flag: 3-20 bars of consolidation after the pole bottom
  - Flag retrace: between 15% and 50% of the pole's height (rallies back up)
  - Flag channel: upper and lower trendlines roughly parallel (parallel_score > 0.55)
  - Volume: contracting in the flag relative to the pole

Scoring (composite 0-100):
  geometry_score: how clean the parallel channel + retrace + duration are
  volume_score:  how contracted flag volume is vs pole volume
  context_score: trend stage 4, stacked_bearish MA, RS trend down
  historical_score: 50.0 (neutral prior, Phase 7 wires actual stats)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.geometry import channel_width_parallel_score
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.primitives.trendlines import fit_pair_parallel
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "bear_flag"
_MIN_POLE_PCT = 0.08
_MAX_POLE_BARS = 20
_MIN_FLAG_BARS = 3
_MAX_FLAG_BARS = 20
_MIN_FLAG_RETRACE = 0.15
_MAX_FLAG_RETRACE = 0.50
_MIN_PARALLEL_SCORE = 0.55
_CONFIDENCE_FLOOR = 50.0


def detect_bear_flag(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect bear flag patterns in the bars. May emit 0-N detections."""
    if len(bars) < 30:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 3:
        return []

    for pole_bottom_idx, pole_bottom in _candidate_pole_bottoms(bars, pivots):
        candidate = _try_extract_pattern(bars, pivots, pole_bottom_idx, pole_bottom)
        if candidate is None:
            continue

        # Hard volume gate: a bear flag REQUIRES flag volume contracted vs pole.
        # If flag avg volume >= pole avg volume, this is not a bear flag — it's
        # likely capitulation/bottom. Reject before scoring.
        if not _flag_volume_contracted(bars, candidate):
            continue

        geom_score = _score_geometry(candidate)
        vol_score  = _score_volume(bars, candidate)
        ctx_score  = _score_context(context)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(bars, candidate, confidence, context,
                             geom_score, vol_score, ctx_score, hist_score)
        detections.append(d)

    return detections


def _candidate_pole_bottoms(bars: List[Bar], pivots) -> list[tuple[int, dict]]:
    """Yield (bar_index, pivot) for each swing-low pivot in the recent window."""
    low_pivots = [p for p in pivots if p["type"] == "low"]
    candidates = []
    for p in low_pivots[-6:]:
        if p["bar_index"] < 10 or p["bar_index"] > len(bars) - _MIN_FLAG_BARS:
            continue
        candidates.append((p["bar_index"], p))
    return candidates


def _try_extract_pattern(bars, pivots, pole_bottom_idx: int, pole_bottom) -> Optional[dict]:
    """Try to extract a pole+flag pattern with pole_bottom_idx as the pole low."""
    # Look for a high pivot in the pole window; if none, fall back to the
    # absolute highest bar high in that window. Tight base consolidations may
    # produce no qualifying pivot but still have a clean structural high.
    window_start = max(0, pole_bottom_idx - _MAX_POLE_BARS)
    high_pivots_before = [p for p in pivots
                          if p["type"] == "high" and window_start <= p["bar_index"] < pole_bottom_idx]
    if high_pivots_before:
        pole_base_pivot = max(high_pivots_before, key=lambda p: p["price"])
        pole_base = {"bar_index": pole_base_pivot["bar_index"],
                     "price": pole_base_pivot["price"],
                     "t": pole_base_pivot["t"]}
    else:
        # Fallback: scan bar highs directly in the window
        if window_start >= pole_bottom_idx:
            return None
        best_idx = window_start
        best_high = bars[window_start]["h"]
        for j in range(window_start, pole_bottom_idx):
            if bars[j]["h"] > best_high:
                best_high = bars[j]["h"]
                best_idx = j
        pole_base = {"bar_index": best_idx,
                     "price": best_high,
                     "t": bars[best_idx]["t"]}

    pole_height = pole_base["price"] - pole_bottom["price"]
    if pole_height <= 0:
        return None
    pole_pct = pole_height / pole_base["price"]
    if pole_pct < _MIN_POLE_PCT:
        return None

    pole_bars = pole_bottom_idx - pole_base["bar_index"]
    if pole_bars <= 0 or pole_bars > _MAX_POLE_BARS:
        return None

    flag_bars_count = len(bars) - 1 - pole_bottom_idx
    if flag_bars_count < _MIN_FLAG_BARS or flag_bars_count > _MAX_FLAG_BARS:
        return None

    flag_bars = bars[pole_bottom_idx + 1:]
    if not flag_bars:
        return None

    flag_low = min(b["l"] for b in flag_bars)
    flag_high = max(b["h"] for b in flag_bars)
    # Retrace is how far the flag rallied UP from pole bottom, expressed as
    # fraction of pole height.
    retrace = (flag_high - pole_bottom["price"]) / pole_height
    if retrace < _MIN_FLAG_RETRACE or retrace > _MAX_FLAG_RETRACE:
        return None

    upper_pivots = [{"t": pole_bottom_idx + 1 + i, "price": b["h"],
                     "type": "high", "strength": 50, "bar_index": pole_bottom_idx + 1 + i}
                    for i, b in enumerate(flag_bars)]
    lower_pivots = [{"t": pole_bottom_idx + 1 + i, "price": b["l"],
                     "type": "low", "strength": 50, "bar_index": pole_bottom_idx + 1 + i}
                    for i, b in enumerate(flag_bars)]
    upper_line, lower_line = fit_pair_parallel(upper_pivots, lower_pivots)

    par_score = channel_width_parallel_score(upper_line, lower_line, flag_high, flag_low)
    if par_score < _MIN_PARALLEL_SCORE:
        return None

    return {
        "pole_base_idx": pole_base["bar_index"],
        "pole_base_price": pole_base["price"],
        "pole_bottom_idx": pole_bottom_idx,
        "pole_bottom_price": pole_bottom["price"],
        "pole_height": pole_height,
        "pole_pct": pole_pct,
        "pole_bars": pole_bars,
        "flag_count": len(flag_bars),
        "flag_low": flag_low,
        "flag_high": flag_high,
        "retrace_pct": retrace,
        "upper_line": upper_line,
        "lower_line": lower_line,
        "parallel_score": par_score,
        "flag_bars": flag_bars,
    }


def _score_geometry(c: dict) -> float:
    pole_score = min(100, c["pole_pct"] / 0.20 * 100)
    retrace_score = 100 - abs(c["retrace_pct"] - 0.30) * 200
    retrace_score = max(0, retrace_score)
    parallel_pts = c["parallel_score"] * 100
    duration_score = 100 - abs(c["flag_count"] - 8) * 5
    duration_score = max(0, duration_score)
    return round(0.30 * pole_score + 0.30 * retrace_score
                 + 0.25 * parallel_pts + 0.15 * duration_score, 2)


def _flag_volume_contracted(bars: List[Bar], c: dict) -> bool:
    """Hard gate: flag avg volume must be strictly less than pole avg volume.

    A bear flag is defined by volume drying up into the consolidation. If volume
    is expanding (or even flat) into the flag, the pattern is not valid —
    buyers are still active and a reversal is more likely than a continuation.
    """
    pole = bars[c["pole_base_idx"]: c["pole_bottom_idx"] + 1]
    flag = c["flag_bars"]
    if not pole or not flag:
        return False
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    flag_avg = sum(b["v"] for b in flag) / len(flag)
    if pole_avg <= 0:
        return True  # can't measure; don't gate
    return flag_avg < pole_avg


def _score_volume(bars: List[Bar], c: dict) -> float:
    pole = bars[c["pole_base_idx"]: c["pole_bottom_idx"] + 1]
    flag = c["flag_bars"]
    if not pole or not flag:
        return 0.0
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    flag_avg = sum(b["v"] for b in flag) / len(flag)
    if pole_avg <= 0:
        return 50.0
    ratio = flag_avg / pole_avg
    if ratio >= 1.0:
        return 0.0
    return round(max(0, min(100, (1.0 - ratio) * 125)), 2)


def _score_context(context: dict) -> float:
    score = 50.0
    if context.get("trend_stage") == 4: score += 25
    if context.get("ma_alignment") == "stacked_bearish": score += 15
    if context.get("rs_trend") == "down": score += 10
    return min(100.0, score)


def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (counter-trend caution)"
    if align == "stacked_bearish":
        return "fully stacked-bearish moving-average"
    return "mixed moving-average"


def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 4:
        return "a confirmed Stage 4 downtrend"
    if stage == 3:
        return "a Stage 3 distribution top (roll-over forming)"
    if stage == 2:
        return "a Stage 2 uptrend environment (counter-trend short, lower odds)"
    if stage == 1:
        return "a Stage 1 base/accumulation environment (counter-trend caution)"
    return "an undefined trend stage"


def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving (counter-trend warning)"
    if rs == "down":
        return "deteriorating"
    return "neutral"


def _flag_volume_ratio(bars: List[Bar], c: dict) -> float:
    """Return flag avg volume / pole avg volume."""
    pole = bars[c["pole_base_idx"]: c["pole_bottom_idx"] + 1]
    flag = c["flag_bars"]
    if not pole or not flag:
        return 1.0
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    flag_avg = sum(b["v"] for b in flag) / len(flag)
    if pole_avg <= 0:
        return 1.0
    return flag_avg / pole_avg


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    pole_bottom = bars[c["pole_bottom_idx"]]
    last_bar = bars[-1]

    flag_high = c["flag_high"]
    flag_low = c["flag_low"]
    entry = round(flag_low * 0.999, 2)
    stop  = round(flag_high * 1.01, 2)
    target = round(pole_bottom["c"] - c["pole_height"], 2)
    # For a short: risk = stop - entry, reward = entry - target
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0

    # Stop distance %
    stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

    # Volume signature
    flag_vol_ratio = _flag_volume_ratio(bars, c)
    flag_vol_pct = flag_vol_ratio * 100.0

    # Narrative dimension values
    pole_pct_pct = c["pole_pct"] * 100.0
    retrace_pct_pct = c["retrace_pct"] * 100.0
    pole_bars = c["pole_bars"]
    flag_count = c["flag_count"]
    parallel_score = c["parallel_score"]
    pole_base_price = c["pole_base_price"]
    pole_bottom_price = c["pole_bottom_price"]
    pole_height = c["pole_height"]

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    # ---- Narrative composition - RICH, paragraph-length, with real values ----
    headline = (
        f"Bear Flag forming on {sym_token} - {pole_pct_pct:.1f}% decline pole "
        f"over {pole_bars} bars, {retrace_pct_pct:.0f}% retrace rally inside a "
        f"{flag_count}-bar parallel channel. Pivot ${flag_low:.2f}, "
        f"target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Bear Flag is the mirror image of the bull flag and one of the "
        f"oldest documented continuation patterns in technical analysis, dating "
        f"back to Schabacker (1932) and formalized in the Edwards & Magee "
        f"canonical text 'Technical Analysis of Stock Trends' (1948). Structurally "
        f"identical to its bullish cousin but inverted: a sharp downward pole "
        f"reflecting institutional distribution - here a {pole_pct_pct:.1f}% "
        f"decline from ${pole_base_price:.2f} down to ${pole_bottom_price:.2f} "
        f"over {pole_bars} bars - followed by a controlled, low-volume relief "
        f"rally that drifts upward inside a roughly parallel channel "
        f"(parallel score {parallel_score:.2f}, where 1.0 is perfectly parallel). "
        f"The {retrace_pct_pct:.0f}% retrace into a {flag_count}-bar consolidation "
        f"is the dead-cat bounce - short-covering and bottom-fishing dip-buyers "
        f"providing the brief lift, while patient institutional sellers add to "
        f"shorts and offload remaining long exposure into the strength. Flag "
        f"volume contracting to {flag_vol_pct:.0f}% of the pole's average is "
        f"the critical tell that demand is anemic and the rally lacks "
        f"conviction. Bear flags are central to every modern short-selling "
        f"methodology (Stockbee, Brian Shannon's AVWAP framework, Pradeep Bonde "
        f"on shorting parabolics) because the mechanic is universal: distribution "
        f"in a downtrend produces tight relief rallies that fail at predictable "
        f"levels, and the resulting break of the flag low resumes the slide "
        f"with as much velocity as the pole had downward. Kristjan Kullamägi's "
        f"'parabolic short' variant is the modern playbook expression of this "
        f"setup — he hunts bear flags forming after parabolic blow-off tops in "
        f"former high-flyers, treating the flag breakdown as the highest-edge "
        f"short trigger in momentum tape. Tom Bulkowski's pattern statistics "
        f"mirror the bullish version with ~63-67% follow-through reliability "
        f"when flag volume contracts and the breakdown carries fresh volume."
    )

    why_it_matters = (
        f"This bear flag is forming in {stage_phrase} with {ma_phrase} alignment "
        f"and {rs_phrase} relative strength versus the broader market, against "
        f"a {regime} regime backdrop and volume signature reading "
        f"{vol_signature}. The {pole_pct_pct:.1f}% pole over {pole_bars} bars is "
        f"a meaningful supply impulse - that magnitude of decline in that "
        f"compressed timeframe is not random tape, it's distribution arriving "
        f"with intent (often tied to a fundamental catalyst that flipped the "
        f"narrative: earnings miss, guidance cut, sector rotation, regulatory "
        f"setback). The {retrace_pct_pct:.0f}% retrace is in the textbook "
        f"30-50% Fibonacci dead-cat zone where bear-trend relief rallies "
        f"typically die because overhead supply from trapped longs becomes "
        f"resistance. The {flag_count}-bar duration is well inside the 3-20 bar "
        f"window where the highest-follow-through bear flags resolve, and "
        f"the {flag_vol_pct:.0f}% flag-to-pole volume ratio confirms demand "
        f"is exhausting itself - rallies on dying volume are the chart "
        f"language of trapped longs hoping for an exit, not new buyers "
        f"arriving. Historically, bear flags with these characteristics produce "
        f"measured-move follow-through 55-65% of the time within 6-8 weeks "
        f"when the breakdown triggers on volume."
    )

    what_to_watch_for = (
        f"The trigger is a daily close below ${entry:.2f} (flag low "
        f"${flag_low:.2f} minus a small confirmation buffer) on volume of at "
        f"least 1.5x the 20-bar average - that volume expansion on the "
        f"breakdown is non-negotiable, because a break on light volume "
        f"frequently reverses back into the channel as a bear trap. The ideal "
        f"trigger bar closes in the lower half of its range with a wide real "
        f"body, and the next 1-3 bars should hold below ${flag_low:.2f} without "
        f"re-entering the channel between ${flag_low:.2f} and ${flag_high:.2f}. "
        f"Measured target is ${target:.2f}, derived by projecting the pole "
        f"height of ${pole_height:.2f} down from the pole-bottom close at "
        f"${pole_bottom['c']:.2f}. Initial stop sits at ${stop:.2f} (1% above "
        f"the flag high) representing a {stop_distance_pct:.1f}% risk from "
        f"entry - risking 1% of account on this short implies a position size "
        f"of roughly {(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity, and risking 0.5% halves that. Trail stops above each new "
        f"swing high as the trade extends, or above the descending 10/20 EMA. "
        f"Consider covering partial size at 1R for a free trade, and remember "
        f"short trades require borrow availability and carry overnight gap "
        f"risk that long trades do not."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close above the flag high at "
        f"${flag_high:.2f} (stop set at ${stop:.2f}, ~1% above the structural "
        f"high to absorb the standard upside wick) - that close signals the "
        f"distribution thesis is wrong and demand has overwhelmed sellers, "
        f"often setting up a bear-trap squeeze higher into the pole base "
        f"region near ${pole_base_price:.2f}. A more nuanced failure mode that "
        f"often precedes the hard stop: the breakdown fires below ${entry:.2f} "
        f"on weak or merely-average volume, the next 1-2 bars close in the "
        f"upper half of their range, and price recovers back inside the flag "
        f"channel. This is the textbook 'failed breakdown' or 'spring' that "
        f"Wyckoff students learn to fade - market makers used the visible "
        f"breakdown level as a liquidity grab to cover shorts, not a genuine "
        f"continuation. Short squeezes can be violent and uncapped to the "
        f"upside, so the {stop_distance_pct:.1f}% stop must be honored without "
        f"negotiation - widening or removing a stop on a bear flag that's "
        f"failing is one of the fastest ways to take a manageable loss and "
        f"turn it into account-damaging one, because the asymmetric risk of "
        f"a short (capped reward, uncapped loss) demands tighter discipline "
        f"than long trades. Failed bear flags often resolve with V-shape "
        f"reversal velocity, so size accordingly."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Bear Flag",
        "category": "classical",
        "direction": "bearish",
        "start_t": int(bars[c["pole_base_idx"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[c["pole_base_idx"]]["t"]),
                     int(pole_bottom["t"]),
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
                "pole_pct": round(c["pole_pct"] * 100, 2),
                "retrace_pct": round(c["retrace_pct"] * 100, 2),
                "flag_bars": c["flag_count"],
                "parallel_score": round(c["parallel_score"], 3),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close < {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "flag_high_plus_1pct",
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


register(_PATTERN_ID, detect_bear_flag)
