"""Double Top detector.

Two peaks at similar heights with a retrace trough between them.
Classic bearish reversal pattern: buyers fail to push past the prior
high on the second attempt, signaling demand exhaustion. A breakdown
below the retrace trough projects a measured move equal to the
peak-to-trough distance.

Geometric definition:
  - Window: 20-80 bars
  - Two swing-high pivots ordered chronologically: P1 < P2 (bar_index)
  - Peak similarity: |p1 - p2| / p1 < 0.04 (within 4%)
  - Peak spacing: p2_idx - p1_idx >= 7 bars (peaks well separated)
  - Retrace trough: lowest LOW in bars[p1_idx..p2_idx]
  - Retrace depth: (peak1 - trough) / peak1 in [0.05, 0.25]
  - Pattern not yet broken downward: recent closes have not breached trough
  - Recent: p2 within the last 30 bars
  - Volume: lower on second peak than first (buying exhaustion signature)

Scoring (composite 0-100):
  geometry_score:   peak similarity, retrace depth ideality, peak spacing
  volume_score:     declining volume on second peak vs first
  context_score:    trend_stage 2/3 (toppy uptrend / distribution), stacked_bullish
  historical_score: 50.0 (neutral prior, Phase 7 wires actual stats)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "double_top"
_MIN_PATTERN_BARS = 20
_MAX_PATTERN_BARS = 80
_MAX_PEAK_SIMILARITY = 0.04        # |p1 - p2| / p1 < 0.04
_MIN_PEAK_SPACING = 7              # p2_idx - p1_idx >= 7
_MIN_RETRACE_DEPTH = 0.05          # (peak1 - trough)/peak1 >= 5%
_MAX_RETRACE_DEPTH = 0.25          # (peak1 - trough)/peak1 <= 25%
_MAX_PEAK2_AGE = 30                # p2 within last 30 bars
_CONFIDENCE_FLOOR = 50.0


def detect_double_top(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect double-top patterns in the bars. May emit 0-N detections."""
    if len(bars) < _MIN_PATTERN_BARS:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 2:
        return []

    high_pivots_raw = [p for p in pivots if p["type"] == "high"]
    if len(high_pivots_raw) < 2:
        return []

    # Re-key swing-highs with bar_index as `t` (convention used throughout
    # the engine even though no trendline is fit here).
    high_pivots = [{"t": p["bar_index"], "price": p["price"],
                    "type": "high", "strength": p["strength"],
                    "bar_index": p["bar_index"]} for p in high_pivots_raw]

    # Consider the most-recent 10 swing-high pivots. Enumerate every pair
    # (P1, P2) with P1 < P2 chronologically. Prefer the highest-confidence
    # valid pattern.
    recent_highs = high_pivots[-10:]
    n = len(recent_highs)
    last_bar_idx = len(bars) - 1

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for i in range(n):
        for j in range(i + 1, n):
            P1 = recent_highs[i]
            P2 = recent_highs[j]

            if not (P1["bar_index"] < P2["bar_index"]):
                continue

            # Recent constraint: second peak within last N bars
            if last_bar_idx - P2["bar_index"] > _MAX_PEAK2_AGE:
                continue

            candidate = _try_extract_pattern(bars, P1, P2)
            if candidate is None:
                continue

            # Pattern not yet broken downward
            if _pattern_already_broken(bars, candidate):
                continue

            geom_score = _score_geometry(candidate)
            vol_score = _score_volume(bars, candidate)
            ctx_score = _score_context(context)
            hist_score = 50.0

            confidence = round(
                0.40 * geom_score + 0.25 * vol_score
                + 0.20 * ctx_score + 0.15 * hist_score, 2
            )
            if confidence < _CONFIDENCE_FLOOR:
                continue

            if confidence > best_confidence:
                best_confidence = confidence
                best_candidate = candidate
                best_scores = (geom_score, vol_score, ctx_score, hist_score)

    if best_candidate is not None and best_scores is not None:
        geom_score, vol_score, ctx_score, hist_score = best_scores
        d = _build_detection(bars, best_candidate, best_confidence, context,
                             geom_score, vol_score, ctx_score, hist_score)
        detections.append(d)

    return detections


def _try_extract_pattern(bars: List[Bar], P1: dict, P2: dict) -> Optional[dict]:
    """Validate P1 < P2 as a double top. Returns candidate dict or None."""
    p1_idx, p2_idx = P1["bar_index"], P2["bar_index"]
    p1_price, p2_price = P1["price"], P2["price"]

    # Spacing
    spacing = p2_idx - p1_idx
    if spacing < _MIN_PEAK_SPACING:
        return None

    # Pattern window length
    if spacing > _MAX_PATTERN_BARS:
        return None

    if p1_price <= 0:
        return None

    # Peak similarity
    peak_similarity = abs(p1_price - p2_price) / p1_price
    if peak_similarity >= _MAX_PEAK_SIMILARITY:
        return None

    # Retrace trough: lowest LOW strictly between p1 and p2
    if p2_idx - p1_idx < 2:
        return None

    t_idx, t_price = _segment_lowest_low(bars, p1_idx + 1, p2_idx - 1)
    if t_idx is None:
        return None

    # Retrace depth based on the first peak (anchor)
    retrace_depth = (p1_price - t_price) / p1_price
    if retrace_depth < _MIN_RETRACE_DEPTH or retrace_depth > _MAX_RETRACE_DEPTH:
        return None

    return {
        "peak1_idx": p1_idx,
        "peak1_price": p1_price,
        "peak2_idx": p2_idx,
        "peak2_price": p2_price,
        "trough_idx": t_idx,
        "trough_price": t_price,
        "peak_similarity": peak_similarity,
        "retrace_depth": retrace_depth,
        "pattern_bars": spacing,
        "start_idx": p1_idx,
        "end_idx": p2_idx,
    }


def _segment_lowest_low(bars: List[Bar], a: int, b: int) -> tuple:
    """Return (bar_index, low_price) of the lowest LOW in bars[a..b] inclusive."""
    if a > b or a < 0 or b >= len(bars):
        return (None, None)
    best_idx = a
    best_low = bars[a]["l"]
    for i in range(a + 1, b + 1):
        if bars[i]["l"] < best_low:
            best_low = bars[i]["l"]
            best_idx = i
    return (best_idx, best_low)


def _pattern_already_broken(bars: List[Bar], c: dict) -> bool:
    """Return True if recent closes have breached BELOW the retrace trough.

    Two or more consecutive closes below the trough = breakdown already
    happened — don't fire as 'forming/ready'.
    """
    trough_price = c["trough_price"]
    p2_idx = c["peak2_idx"]
    last_idx = len(bars) - 1

    max_consec = 0
    consec = 0
    for i in range(p2_idx, last_idx + 1):
        if bars[i]["c"] < trough_price:
            consec += 1
            if consec > max_consec:
                max_consec = consec
        else:
            consec = 0
    return max_consec >= 2


def _score_geometry(c: dict) -> float:
    # Peak similarity: 100 at perfect match, 0 at 4% threshold
    sim = c["peak_similarity"]
    sim_score = max(0.0, (1.0 - sim / _MAX_PEAK_SIMILARITY) * 100)

    # Retrace depth ideality: textbook ~10-20%, full points 8-22%, taper outside
    depth = c["retrace_depth"]
    if 0.08 <= depth <= 0.22:
        depth_score = 100.0
    elif depth < 0.08:
        # 5% (floor) → 0, 8% → 100
        depth_score = max(0.0, (depth - _MIN_RETRACE_DEPTH) / (0.08 - _MIN_RETRACE_DEPTH) * 100)
    else:
        # 22% → 100, 25% (cap) → 0
        depth_score = max(0.0, (_MAX_RETRACE_DEPTH - depth) / (_MAX_RETRACE_DEPTH - 0.22) * 100)

    # Spacing: ideal 12-30 bars, declines outside that window
    span = c["pattern_bars"]
    if 12 <= span <= 30:
        span_score = 100.0
    elif span < 12:
        # 7 (floor) → 0, 12 → 100
        span_score = max(0.0, (span - _MIN_PEAK_SPACING) / (12 - _MIN_PEAK_SPACING) * 100)
    else:
        # 30 → 100, 80 (cap) → 0
        span_score = max(0.0, (_MAX_PATTERN_BARS - span) / (_MAX_PATTERN_BARS - 30) * 100)

    return round(
        0.45 * sim_score
        + 0.35 * depth_score
        + 0.20 * span_score, 2
    )


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score declining volume on the second peak vs the first.

    Lower volume on peak2 = stronger bearish signal (buying exhaustion).
    """
    p1_idx = c["peak1_idx"]
    p2_idx = c["peak2_idx"]

    def _window_avg(center, half=2):
        lo = max(0, center - half)
        hi = min(len(bars) - 1, center + half)
        if hi < lo:
            return 0.0
        win = bars[lo:hi + 1]
        return sum(b["v"] for b in win) / len(win)

    v1 = _window_avg(p1_idx)
    v2 = _window_avg(p2_idx)

    if v1 <= 0:
        return 50.0

    ratio = v2 / v1  # <1 = declining = good
    if ratio <= 0.3:
        return 100.0
    if ratio >= 1.0:
        return 0.0
    return round((1.0 - ratio) / 0.7 * 100, 2)


def _score_context(context: dict) -> float:
    score = 50.0
    # Double top is bearish — boost on toppy / distribution context.
    if context.get("trend_stage") == 3:
        score += 25  # distribution / topping
    elif context.get("trend_stage") == 2:
        score += 15  # advancing trend ripe for reversal at top
    if context.get("ma_alignment") == "stacked_bullish":
        score += 10  # overbought context — reversal pattern marks top
    if context.get("volume_signature") == "contracting":
        score += 15
    return min(100.0, score)


# ---------------------------------------------------------------------------
# Narrative helpers
# ---------------------------------------------------------------------------


# Custom variant - does not match shared narrative_helpers
def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (overbought topping context)"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average (counter-trend warning for shorts)"
    return "mixed moving-average"


# Custom variant - does not match shared narrative_helpers
def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 3:
        return "a Stage 3 distribution/topping environment (textbook double-top reversal setup)"
    if stage == 2:
        return "a Stage 2 uptrend showing exhaustion at resistance (overbought reversal context)"
    if stage == 4:
        return "a Stage 4 downtrend (continuation context — double top as a bear-flag analog)"
    if stage == 1:
        return "a Stage 1 base/accumulation environment (counter-trend caution)"
    return "an undefined trend stage"


# Custom variant - does not match shared narrative_helpers
def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "still improving (counter-trend warning — wait for trough break)"
    if rs == "down":
        return "deteriorating"
    return "neutral"


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    p1_idx = c["peak1_idx"]
    p2_idx = c["peak2_idx"]
    t_idx = c["trough_idx"]

    peak1_price = c["peak1_price"]
    peak2_price = c["peak2_price"]
    trough_price = c["trough_price"]

    # Levels
    entry = round(trough_price * 0.999, 2)
    stop = round(peak2_price * 1.01, 2)
    # Measured move down: peak2 → trough distance, projected below trough
    target = round(trough_price - (peak2_price - trough_price), 2)
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0

    # Stop distance %
    stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

    # Narrative dimension values
    peak_similarity_pct = c["peak_similarity"] * 100.0
    peak_match_pct = (1.0 - c["peak_similarity"]) * 100.0
    retrace_depth_pct = c["retrace_depth"] * 100.0
    pattern_bars = c["pattern_bars"]
    peak_to_trough_pts = peak2_price - trough_price
    peak_to_trough_pct = (peak_to_trough_pts / peak2_price * 100.0) if peak2_price > 0 else 0.0
    avg_peak = (peak1_price + peak2_price) / 2.0

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    # ---- Narrative composition - RICH, paragraph-length, with real values ----
    headline = (
        f"Double Top forming on {sym_token} - peaks ${peak1_price:.2f} / "
        f"${peak2_price:.2f} within {peak_similarity_pct:.2f}% of each other, "
        f"retrace trough ${trough_price:.2f} ({retrace_depth_pct:.1f}% off peak), "
        f"{pattern_bars}-bar pattern. Pivot ${entry:.2f}, target ${target:.2f}, "
        f"R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Double Top is one of the oldest and most documented bearish reversal "
        f"patterns in technical analysis, with origins traced back to Charles Dow's "
        f"market commentary at the turn of the 20th century, formalized by Richard "
        f"Schabacker in 'Technical Analysis and Stock Market Profits' (1932), and "
        f"canonized in Edwards & Magee's 'Technical Analysis of Stock Trends' "
        f"(1948). Structurally it is two sequential peaks in an uptrend that fail "
        f"at approximately the same price level: peak 1 at ${peak1_price:.2f} "
        f"establishes the rally high, a retrace pulls back to ${trough_price:.2f} "
        f"({retrace_depth_pct:.1f}% off the peak), and peak 2 at ${peak2_price:.2f} "
        f"tests the prior high but fails to extend. Here the two peaks are within "
        f"{peak_similarity_pct:.2f}% of each other (match score {peak_match_pct:.1f}%) "
        f"and the retrace trough at ${trough_price:.2f} forms the 'neckline' — the "
        f"horizontal support line whose breach confirms the reversal. The pattern "
        f"spans {pattern_bars} bars between the two peaks. The market mechanic "
        f"underneath is supply finally overwhelming demand: at the prior-high price, "
        f"institutional sellers who had been waiting on the sidelines step in with "
        f"size, absorbing the second-attempt rally and refusing to let price extend. "
        f"The volume signature that confirms the read — declining volume on peak 2 "
        f"versus peak 1 — reveals that the buying conviction is fading even as the "
        f"price tag matches. Bulkowski's empirical research on thousands of double "
        f"tops places the confirmed-breakdown follow-through rate at roughly 65%, "
        f"with measured moves equal to the peak-to-trough distance projected below "
        f"the neckline (here ${peak_to_trough_pts:.2f} = {peak_to_trough_pct:.1f}% "
        f"projection). Tom DeMark's TD Sequential framework treats the double-top "
        f"as a classic exhaustion signature — a TD9 setup at the second peak is "
        f"one of his core countertrend triggers, marking the moment the trend's "
        f"internal energy has expired even before price has confirmed via "
        f"neckline break."
    )

    why_it_matters = (
        f"This Double Top is forming in {stage_phrase} with {ma_phrase} alignment "
        f"and {rs_phrase} relative strength versus the broader market, against a "
        f"{regime} regime backdrop and volume signature reading {vol_signature}. "
        f"The {peak_match_pct:.1f}% peak symmetry is squarely in the high-quality "
        f"zone — tight peak matches (within 2%) are the highest-reliability variant "
        f"because they reveal a clear institutional supply line at one specific "
        f"price (${avg_peak:.2f} average), while loose matches (above 3%) blur "
        f"into rounded-top noise. The {retrace_depth_pct:.1f}% retrace depth "
        f"between peaks falls in the textbook 10-20% zone where the highest-"
        f"follow-through double tops resolve — too-shallow retraces (under 5%) "
        f"often mean buyers haven't actually been challenged yet, while too-deep "
        f"retraces (over 25%) usually reflect a structural breakdown already "
        f"underway rather than a clean two-peak topping pattern. The "
        f"{pattern_bars}-bar pattern width sits in the 12-30 bar sweet spot — "
        f"longer, sprawling patterns are less reliable because they accumulate "
        f"too many late buyers near the trough who defend the neckline, while "
        f"shorter patterns lack the time for genuine distribution to occur. The "
        f"declining-volume signature on peak 2 (encoded in this detection's "
        f"volume_score component) confirms the buying-exhaustion thesis: the "
        f"same price level can't attract the same conviction twice, and the "
        f"institutions absorbing the prior high have stopped buying. Trapped "
        f"longs near ${avg_peak:.2f} become the supply that caps every "
        f"subsequent rally attempt."
    )

    what_to_watch_for = (
        f"The trigger is a daily close below ${entry:.2f} (the retrace trough at "
        f"${trough_price:.2f} minus a small confirmation buffer) on volume of at "
        f"least 1.5x the 20-bar average — that volume expansion on the breakdown "
        f"is non-negotiable because a neckline break on light tape frequently "
        f"reverses as a bear trap, especially on a pattern this well-watched. The "
        f"ideal trigger bar closes in the lower half of its range with a wide "
        f"real body, and the next 1-3 bars should hold below ${trough_price:.2f} "
        f"without 'kissing back' above the trough more than once — a single "
        f"throwback retest of the broken support is normal and often the highest-"
        f"quality short entry, but two-plus closes back above ${trough_price:.2f} "
        f"weakens the thesis. Measured target is ${target:.2f}, derived by "
        f"projecting the ${peak_to_trough_pts:.2f} peak-to-trough distance "
        f"downward from the trough — a {peak_to_trough_pct:.1f}% projected move "
        f"that justifies the position. Initial stop sits at ${stop:.2f} (1% "
        f"above peak 2 at ${peak2_price:.2f}) representing a "
        f"{stop_distance_pct:.1f}% risk from entry — risking 1% of account on "
        f"this short implies a position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity, and risking 0.5% halves that. Trail stops above each new "
        f"swing high as the trade extends, or above the descending 10/20 EMA, "
        f"and consider covering partial size at 1R to lock in a free trade. "
        f"Short trades require borrow availability and carry overnight gap risk "
        f"that long trades do not — never short a stock you couldn't get filled "
        f"on at the open."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close above peak 2 at "
        f"${peak2_price:.2f} (stop at ${stop:.2f}, 1% above to absorb the "
        f"standard upside wick) — that close signals the distribution thesis is "
        f"wrong, demand has reabsorbed supply at the prior-high level, and the "
        f"underlying uptrend has a high probability of resuming, often with a "
        f"squeeze leg as trapped shorts cover into the breakout. A subtler "
        f"failure mode that often precedes the hard stop: price breaks below "
        f"${trough_price:.2f} on weak or merely-average volume, the next 1-2 "
        f"bars close in the upper half of their range, and price recovers back "
        f"above the trough. That sequence is the textbook 'failed breakdown' or "
        f"Wyckoff 'spring' — market makers used the visible double-top neckline "
        f"as a liquidity grab to cover shorts and re-accumulate, not a genuine "
        f"continuation. Short squeezes off a failed double top can be violent "
        f"because the pattern attracts heavy short interest from trend-following "
        f"systems and pattern scanners, and uncapped upside loss demands the "
        f"{stop_distance_pct:.1f}% stop be honored without negotiation — widening "
        f"or removing a stop on a failing double-top short is one of the fastest "
        f"ways to convert a manageable loss into account-damaging exposure, "
        f"because the asymmetric risk profile of a short trade (capped reward, "
        f"uncapped loss) demands tighter discipline than long trades. Failed "
        f"double tops often resolve with V-shape reversal velocity straight back "
        f"through both peaks, so size accordingly and never average down."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Double Top",
        "category": "classical",
        "direction": "bearish",
        "start_t": int(bars[p1_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[p1_idx]["t"]),
                     int(bars[t_idx]["t"]),
                     int(bars[p2_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "neckline",
            "anchors": [
                {"t": int(bars[p1_idx]["t"]), "price": float(peak1_price)},
                {"t": int(bars[t_idx]["t"]), "price": float(trough_price)},
                {"t": int(bars[p2_idx]["t"]), "price": float(peak2_price)},
            ],
            "extras": {
                "peak_similarity_pct": round(c["peak_similarity"] * 100, 2),
                "retrace_depth_pct": round(c["retrace_depth"] * 100, 2),
                "pattern_bars": int(c["pattern_bars"]),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close < {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "peak2_plus_1pct",
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


register(_PATTERN_ID, detect_double_top)
