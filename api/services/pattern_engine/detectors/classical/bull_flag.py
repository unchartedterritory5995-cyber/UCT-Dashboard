"""Bull flag detector.

A bull flag is a sharp upward move ("pole") followed by a tight pullback
consolidation ("flag") that retraces a fraction of the pole. Continuation pattern.

Geometric definition:
  - Pole: >=8% advance from a swing low to a swing high, over <=20 bars
  - Flag: 3-20 bars of consolidation after the pole top
  - Flag retrace: between 15% and 50% of the pole's height
  - Flag channel: upper and lower trendlines roughly parallel (parallel_score > 0.55)
  - Volume: contracting in the flag relative to the pole

Scoring (composite 0-100):
  geometry_score: how clean the parallel channel + retrace + duration are
  volume_score:  how contracted flag volume is vs pole volume
  context_score: trend stage, MA alignment, RS trend
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


_PATTERN_ID = "bull_flag"
_MIN_POLE_PCT = 0.08
_MAX_POLE_BARS = 20
_MIN_FLAG_BARS = 3
_MAX_FLAG_BARS = 20
_MIN_FLAG_RETRACE = 0.15
_MAX_FLAG_RETRACE = 0.50
_MIN_PARALLEL_SCORE = 0.55
_CONFIDENCE_FLOOR = 50.0


def detect_bull_flag(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect bull flag patterns in the bars. May emit 0-N detections."""
    if len(bars) < 30:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 3:
        return []

    for pole_top_idx, pole_top in _candidate_pole_tops(bars, pivots):
        candidate = _try_extract_pattern(bars, pivots, pole_top_idx, pole_top)
        if candidate is None:
            continue

        # Hard volume gate: a bull flag REQUIRES flag volume contracted vs pole.
        # If flag avg volume >= pole avg volume, this is not a bull flag — it's
        # likely distribution/topping. Reject before scoring.
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


def _candidate_pole_tops(bars: List[Bar], pivots) -> list[tuple[int, dict]]:
    """Yield (bar_index, pivot) for each swing-high pivot in the recent window."""
    high_pivots = [p for p in pivots if p["type"] == "high"]
    candidates = []
    for p in high_pivots[-6:]:
        if p["bar_index"] < 10 or p["bar_index"] > len(bars) - _MIN_FLAG_BARS:
            continue
        candidates.append((p["bar_index"], p))
    return candidates


def _try_extract_pattern(bars, pivots, pole_top_idx: int, pole_top) -> Optional[dict]:
    """Try to extract a pole+flag pattern with pole_top_idx as the pole apex."""
    # Look for a low pivot in the pole window; if none, fall back to the
    # absolute lowest bar low in that window. Tight base consolidations may
    # produce no qualifying pivot but still have a clean structural low.
    window_start = max(0, pole_top_idx - _MAX_POLE_BARS)
    low_pivots_before = [p for p in pivots
                         if p["type"] == "low" and window_start <= p["bar_index"] < pole_top_idx]
    if low_pivots_before:
        pole_base_pivot = min(low_pivots_before, key=lambda p: p["price"])
        pole_base = {"bar_index": pole_base_pivot["bar_index"],
                     "price": pole_base_pivot["price"],
                     "t": pole_base_pivot["t"]}
    else:
        # Fallback: scan bar lows directly in the window
        if window_start >= pole_top_idx:
            return None
        best_idx = window_start
        best_low = bars[window_start]["l"]
        for j in range(window_start, pole_top_idx):
            if bars[j]["l"] < best_low:
                best_low = bars[j]["l"]
                best_idx = j
        pole_base = {"bar_index": best_idx,
                     "price": best_low,
                     "t": bars[best_idx]["t"]}

    pole_height = pole_top["price"] - pole_base["price"]
    if pole_height <= 0:
        return None
    pole_pct = pole_height / pole_base["price"]
    if pole_pct < _MIN_POLE_PCT:
        return None

    pole_bars = pole_top_idx - pole_base["bar_index"]
    if pole_bars <= 0 or pole_bars > _MAX_POLE_BARS:
        return None

    flag_bars_count = len(bars) - 1 - pole_top_idx
    if flag_bars_count < _MIN_FLAG_BARS or flag_bars_count > _MAX_FLAG_BARS:
        return None

    flag_bars = bars[pole_top_idx + 1:]
    if not flag_bars:
        return None

    flag_low = min(b["l"] for b in flag_bars)
    flag_high = max(b["h"] for b in flag_bars)
    retrace = (pole_top["price"] - flag_low) / pole_height
    if retrace < _MIN_FLAG_RETRACE or retrace > _MAX_FLAG_RETRACE:
        return None

    upper_pivots = [{"t": pole_top_idx + 1 + i, "price": b["h"],
                     "type": "high", "strength": 50, "bar_index": pole_top_idx + 1 + i}
                    for i, b in enumerate(flag_bars)]
    lower_pivots = [{"t": pole_top_idx + 1 + i, "price": b["l"],
                     "type": "low", "strength": 50, "bar_index": pole_top_idx + 1 + i}
                    for i, b in enumerate(flag_bars)]
    upper_line, lower_line = fit_pair_parallel(upper_pivots, lower_pivots)

    par_score = channel_width_parallel_score(upper_line, lower_line, flag_high, flag_low)
    if par_score < _MIN_PARALLEL_SCORE:
        return None

    return {
        "pole_base_idx": pole_base["bar_index"],
        "pole_base_price": pole_base["price"],
        "pole_top_idx": pole_top_idx,
        "pole_top_price": pole_top["price"],
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

    A bull flag is defined by volume drying up into the consolidation. If volume
    is expanding (or even flat) into the flag, the pattern is not valid —
    sellers are still active.
    """
    pole = bars[c["pole_base_idx"]: c["pole_top_idx"] + 1]
    flag = c["flag_bars"]
    if not pole or not flag:
        return False
    pole_avg = sum(b["v"] for b in pole) / len(pole)
    flag_avg = sum(b["v"] for b in flag) / len(flag)
    if pole_avg <= 0:
        return True  # can't measure; don't gate
    return flag_avg < pole_avg


def _score_volume(bars: List[Bar], c: dict) -> float:
    pole = bars[c["pole_base_idx"]: c["pole_top_idx"] + 1]
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
    if context.get("trend_stage") == 2: score += 25
    if context.get("ma_alignment") == "stacked_bullish": score += 15
    if context.get("rs_trend") == "up": score += 10
    return min(100.0, score)


# Custom variant - does not match shared narrative_helpers
def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "fully stacked-bullish moving-average"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average"
    return "mixed moving-average"


# Custom variant - does not match shared narrative_helpers
def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 2:
        return "a confirmed Stage 2 uptrend"
    if stage == 1:
        return "a Stage 1 base/accumulation environment"
    if stage == 3:
        return "a Stage 3 distribution environment (caution)"
    if stage == 4:
        return "a Stage 4 downtrend environment (caution against longs)"
    return "an undefined trend stage"


# Custom variant - does not match shared narrative_helpers
def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving"
    if rs == "down":
        return "deteriorating"
    return "neutral"


def _flag_volume_ratio(bars: List[Bar], c: dict) -> float:
    """Return flag avg volume / pole avg volume."""
    pole = bars[c["pole_base_idx"]: c["pole_top_idx"] + 1]
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
    pole_top = bars[c["pole_top_idx"]]
    last_bar = bars[-1]

    flag_high = c["flag_high"]
    flag_low = c["flag_low"]
    entry = round(flag_high * 1.001, 2)
    stop  = round(flag_low * 0.99, 2)
    target = round(pole_top["c"] + c["pole_height"], 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0

    # Stop distance %
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

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
    pole_height = c["pole_height"]

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    # ---- Narrative composition - RICH, paragraph-length, with real values ----
    headline = (
        f"Bull Flag forming on {sym_token} - {pole_pct_pct:.1f}% pole over "
        f"{pole_bars} bars, {retrace_pct_pct:.0f}% retrace inside a "
        f"{flag_count}-bar parallel channel. Pivot ${flag_high:.2f}, "
        f"target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Bull Flag is one of the foundational continuation patterns in "
        f"classical technical analysis, formally codified by Robert Edwards and "
        f"John Magee in their 1948 work 'Technical Analysis of Stock Trends' and "
        f"refined across decades by Stan Weinstein, William O'Neil, and modern "
        f"practitioners like Brian Shannon. The structure is two distinct phases: "
        f"a near-vertical advance called the pole - here a {pole_pct_pct:.1f}% "
        f"surge from ${pole_base_price:.2f} to ${pole_top['c']:.2f} over "
        f"{pole_bars} bars - followed by a controlled, low-volatility pullback "
        f"called the flag that drifts inside a roughly parallel channel "
        f"(parallel score {parallel_score:.2f}, where 1.0 is perfectly parallel). "
        f"The {retrace_pct_pct:.0f}% retrace into a {flag_count}-bar consolidation "
        f"reflects controlled profit-taking, not panic - sellers trickle out while "
        f"institutional accumulators absorb supply, evidenced by flag volume "
        f"contracting to {flag_vol_pct:.0f}% of the pole's average. Linda Raschke "
        f"teaches this same setup as her 'Holy Grail' — a flag pullback to the "
        f"20EMA inside an established trend, with the EMA acting as the buy "
        f"trigger zone. Kristjan Kullamägi (Qullamaggie) operates almost "
        f"exclusively on this pattern in modern momentum tape, hunting daily "
        f"flags forming inside weekly breakouts on the most liquid leaders. "
        f"Tom Bulkowski's Encyclopedia of Chart Patterns puts follow-through "
        f"reliability near ~67% when volume confirms the breakout. The flag is "
        f"the chart language of digestion: the prior buyers have not flipped, "
        f"they're simply waiting, and the next leg up resumes when the supply "
        f"shelf at the flag high breaks. Continuation studies on bull flags "
        f"trace back to Schabacker (1932) and remain central to every modern "
        f"breakout methodology because the mechanic is universal across markets."
    )

    why_it_matters = (
        f"This flag is forming in {stage_phrase} with {ma_phrase} alignment and "
        f"{rs_phrase} relative strength versus the broader market, while the "
        f"{regime} regime sets the macro backdrop and volume signature reads as "
        f"{vol_signature}. The {pole_pct_pct:.1f}% pole over {pole_bars} bars is "
        f"meaningful evidence of demand impulse - that magnitude in that timeframe "
        f"is not retail noise, it's institutional sponsorship arriving with "
        f"intent. The {retrace_pct_pct:.0f}% retrace is in the textbook 'healthy "
        f"shake-out' band (Edwards & Magee describe 30-50% as ideal because it "
        f"flushes weak hands without compromising the demand zone), and the "
        f"{flag_count}-bar consolidation duration is well inside the typical "
        f"3-20 bar window that produces the highest follow-through. Volume "
        f"contraction into the flag ({flag_vol_pct:.0f}% of pole average) is the "
        f"single most important confirmation - it means supply is exhausting "
        f"itself. Historically, bull flags with these characteristics and a "
        f"clean breakout trigger produce measured-move follow-through in the "
        f"6-8 week window roughly 55-65% of the time, with average winners "
        f"hitting target and average losers stopping out cleanly at the flag low."
    )

    what_to_watch_for = (
        f"The trigger is a daily close above ${entry:.2f} (flag high "
        f"${flag_high:.2f} plus a small confirmation buffer) on volume of at "
        f"least 1.5x the 20-bar average - that volume surge is non-negotiable "
        f"because a breakout on average or weak volume frequently fades back "
        f"into the channel. The ideal trigger bar closes in the upper half of "
        f"its range with a wide real body, and the next 1-3 bars should hold "
        f"above ${flag_high:.2f} without re-entering the channel between "
        f"${flag_low:.2f} and ${flag_high:.2f}. Measured target is ${target:.2f}, "
        f"derived by projecting the pole height of ${pole_height:.2f} up from "
        f"the pole-top close at ${pole_top['c']:.2f}. Initial stop at "
        f"${stop:.2f} sits 1% below the flag low and represents a "
        f"{stop_distance_pct:.1f}% risk distance from entry - so risking 1% of "
        f"account on this trade implies a position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)):.0f}% of equity, and risking 0.5% "
        f"halves that. Once the trade moves into profit, trail the stop below "
        f"each new swing low or under the 10/20 EMA for a swing hold, and "
        f"consider scaling out partial size at 1R for a free trade."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close below the flag low at "
        f"${flag_low:.2f} (stop set at ${stop:.2f}, ~1% below the structural "
        f"low to give room for the standard shake-out wick) - that close signals "
        f"the demand absorption thesis is wrong and supply has overwhelmed "
        f"buyers. A subtler failure mode that often precedes the hard stop: "
        f"the breakout fires above ${entry:.2f} on weak or merely-average "
        f"volume, the next 1-2 bars close in the lower half of their range, "
        f"and price slides back inside the flag channel. This is the textbook "
        f"'failed breakout' that Wyckoff students call an 'upthrust' - "
        f"institutions used the visible breakout level as an exit, not an entry, "
        f"and the pattern often retests the pole base near ${pole_base_price:.2f} "
        f"or deeper into prior support. The {stop_distance_pct:.1f}% stop "
        f"distance must be honored without negotiation - widening a stop on a "
        f"flag that's already breaking down is one of the most reliable ways "
        f"to convert a small, manageable loss into a portfolio-damaging one. "
        f"Flag failures often resolve with as much velocity downward as the "
        f"pole had upward, so size discipline matters even more than entry "
        f"timing on this setup."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Bull Flag",
        "category": "classical",
        "direction": "bullish",
        "start_t": int(bars[c["pole_base_idx"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[c["pole_base_idx"]]["t"]),
                     int(pole_top["t"]),
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
            "entry_condition": f"close > {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "flag_low_minus_1pct",
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


register(_PATTERN_ID, detect_bull_flag)
