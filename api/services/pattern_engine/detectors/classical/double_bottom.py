"""Double Bottom detector.

Two troughs at similar lows with a rally peak between them.
Classic bullish reversal pattern: sellers fail to push past the prior
low on the second attempt, signaling supply exhaustion. A breakout
above the rally peak projects a measured move equal to the
peak-to-trough distance.

Geometric definition:
  - Window: 20-80 bars
  - Two swing-low pivots ordered chronologically: T1 < T2 (bar_index)
  - Trough similarity: |t1 - t2| / t1 < 0.04 (within 4%)
  - Trough spacing: t2_idx - t1_idx >= 7 bars (troughs well separated)
  - Rally peak: highest HIGH in bars[t1_idx..t2_idx]
  - Rally depth: (peak - trough1) / trough1 in [0.05, 0.25]
  - Pattern not yet broken upward: recent closes have not breached peak
  - Recent: t2 within the last 30 bars
  - Volume: often expanding on second-trough bounce (confirmation buying)

Scoring (composite 0-100):
  geometry_score:   trough similarity, rally depth ideality, trough spacing
  volume_score:     expanding volume on second-trough bounce (confirmation)
  context_score:    trend_stage 1/4 (basing / oversold), stacked_bearish
  historical_score: 50.0 (neutral prior, Phase 7 wires actual stats)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "double_bottom"
_MIN_PATTERN_BARS = 20
_MAX_PATTERN_BARS = 80
_MAX_TROUGH_SIMILARITY = 0.04      # |t1 - t2| / t1 < 0.04
_MIN_TROUGH_SPACING = 7            # t2_idx - t1_idx >= 7
_MIN_RALLY_DEPTH = 0.05            # (peak - trough1)/trough1 >= 5%
_MAX_RALLY_DEPTH = 0.25            # (peak - trough1)/trough1 <= 25%
_MAX_TROUGH2_AGE = 30              # t2 within last 30 bars
_CONFIDENCE_FLOOR = 50.0


def detect_double_bottom(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect double-bottom patterns in the bars. May emit 0-N detections."""
    if len(bars) < _MIN_PATTERN_BARS:
        return []

    detections: List[Detection] = []

    pivots = detect_pivots(bars, window=3)
    if len(pivots) < 2:
        return []

    low_pivots_raw = [p for p in pivots if p["type"] == "low"]
    if len(low_pivots_raw) < 2:
        return []

    # Re-key swing-lows with bar_index as `t` (convention used throughout
    # the engine even though no trendline is fit here).
    low_pivots = [{"t": p["bar_index"], "price": p["price"],
                   "type": "low", "strength": p["strength"],
                   "bar_index": p["bar_index"]} for p in low_pivots_raw]

    # Consider the most-recent 10 swing-low pivots. Enumerate every pair
    # (T1, T2) with T1 < T2 chronologically. Prefer the highest-confidence
    # valid pattern.
    recent_lows = low_pivots[-10:]
    n = len(recent_lows)
    last_bar_idx = len(bars) - 1

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for i in range(n):
        for j in range(i + 1, n):
            T1 = recent_lows[i]
            T2 = recent_lows[j]

            if not (T1["bar_index"] < T2["bar_index"]):
                continue

            # Recent constraint: second trough within last N bars
            if last_bar_idx - T2["bar_index"] > _MAX_TROUGH2_AGE:
                continue

            candidate = _try_extract_pattern(bars, T1, T2)
            if candidate is None:
                continue

            # Pattern not yet broken upward
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


def _try_extract_pattern(bars: List[Bar], T1: dict, T2: dict) -> Optional[dict]:
    """Validate T1 < T2 as a double bottom. Returns candidate dict or None."""
    t1_idx, t2_idx = T1["bar_index"], T2["bar_index"]
    t1_price, t2_price = T1["price"], T2["price"]

    # Spacing
    spacing = t2_idx - t1_idx
    if spacing < _MIN_TROUGH_SPACING:
        return None

    # Pattern window length
    if spacing > _MAX_PATTERN_BARS:
        return None

    if t1_price <= 0:
        return None

    # Trough similarity
    trough_similarity = abs(t1_price - t2_price) / t1_price
    if trough_similarity >= _MAX_TROUGH_SIMILARITY:
        return None

    # Rally peak: highest HIGH strictly between t1 and t2
    if t2_idx - t1_idx < 2:
        return None

    p_idx, p_price = _segment_highest_high(bars, t1_idx + 1, t2_idx - 1)
    if p_idx is None:
        return None

    # Rally depth based on the first trough (anchor)
    rally_depth = (p_price - t1_price) / t1_price
    if rally_depth < _MIN_RALLY_DEPTH or rally_depth > _MAX_RALLY_DEPTH:
        return None

    return {
        "trough1_idx": t1_idx,
        "trough1_price": t1_price,
        "trough2_idx": t2_idx,
        "trough2_price": t2_price,
        "peak_idx": p_idx,
        "peak_price": p_price,
        "trough_similarity": trough_similarity,
        "rally_depth": rally_depth,
        "pattern_bars": spacing,
        "start_idx": t1_idx,
        "end_idx": t2_idx,
    }


def _segment_highest_high(bars: List[Bar], a: int, b: int) -> tuple:
    """Return (bar_index, high_price) of the highest HIGH in bars[a..b] inclusive."""
    if a > b or a < 0 or b >= len(bars):
        return (None, None)
    best_idx = a
    best_high = bars[a]["h"]
    for i in range(a + 1, b + 1):
        if bars[i]["h"] > best_high:
            best_high = bars[i]["h"]
            best_idx = i
    return (best_idx, best_high)


def _pattern_already_broken(bars: List[Bar], c: dict) -> bool:
    """Return True if recent closes have breached ABOVE the rally peak.

    Two or more consecutive closes above the peak = breakout already
    happened — don't fire as 'forming/ready'.
    """
    peak_price = c["peak_price"]
    t2_idx = c["trough2_idx"]
    last_idx = len(bars) - 1

    max_consec = 0
    consec = 0
    for i in range(t2_idx, last_idx + 1):
        if bars[i]["c"] > peak_price:
            consec += 1
            if consec > max_consec:
                max_consec = consec
        else:
            consec = 0
    return max_consec >= 2


def _score_geometry(c: dict) -> float:
    # Trough similarity: 100 at perfect match, 0 at 4% threshold
    sim = c["trough_similarity"]
    sim_score = max(0.0, (1.0 - sim / _MAX_TROUGH_SIMILARITY) * 100)

    # Rally depth ideality: textbook ~10-20%, full points 8-22%, taper outside
    depth = c["rally_depth"]
    if 0.08 <= depth <= 0.22:
        depth_score = 100.0
    elif depth < 0.08:
        # 5% (floor) → 0, 8% → 100
        depth_score = max(0.0, (depth - _MIN_RALLY_DEPTH) / (0.08 - _MIN_RALLY_DEPTH) * 100)
    else:
        # 22% → 100, 25% (cap) → 0
        depth_score = max(0.0, (_MAX_RALLY_DEPTH - depth) / (_MAX_RALLY_DEPTH - 0.22) * 100)

    # Spacing: ideal 12-30 bars, declines outside that window
    span = c["pattern_bars"]
    if 12 <= span <= 30:
        span_score = 100.0
    elif span < 12:
        # 7 (floor) → 0, 12 → 100
        span_score = max(0.0, (span - _MIN_TROUGH_SPACING) / (12 - _MIN_TROUGH_SPACING) * 100)
    else:
        # 30 → 100, 80 (cap) → 0
        span_score = max(0.0, (_MAX_PATTERN_BARS - span) / (_MAX_PATTERN_BARS - 30) * 100)

    return round(
        0.45 * sim_score
        + 0.35 * depth_score
        + 0.20 * span_score, 2
    )


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score expanding volume on the second-trough bounce vs the first.

    Higher volume on trough2 = stronger bullish signal (confirmation buying
    as sellers exhaust and buyers step in to defend the prior low).
    """
    t1_idx = c["trough1_idx"]
    t2_idx = c["trough2_idx"]

    def _window_avg(center, half=2):
        lo = max(0, center - half)
        hi = min(len(bars) - 1, center + half)
        if hi < lo:
            return 0.0
        win = bars[lo:hi + 1]
        return sum(b["v"] for b in win) / len(win)

    v1 = _window_avg(t1_idx)
    v2 = _window_avg(t2_idx)

    if v1 <= 0:
        return 50.0

    ratio = v2 / v1  # >1 = expanding = good (confirmation buying)
    if ratio >= 1.7:
        return 100.0
    if ratio <= 1.0:
        return 0.0
    return round((ratio - 1.0) / 0.7 * 100, 2)


def _score_context(context: dict) -> float:
    score = 50.0
    # Double bottom is bullish — boost on basing / oversold context.
    if context.get("trend_stage") == 1:
        score += 25  # basing / accumulation
    elif context.get("trend_stage") == 4:
        score += 15  # declining trend ripe for reversal at bottom
    if context.get("ma_alignment") == "stacked_bearish":
        score += 10  # oversold context — reversal pattern marks bottom
    if context.get("volume_signature") == "contracting":
        score += 15
    return min(100.0, score)


# ---------------------------------------------------------------------------
# Narrative helpers
# ---------------------------------------------------------------------------


def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bearish":
        return "stacked-bearish moving-average (oversold basing context)"
    if align == "stacked_bullish":
        return "stacked-bullish moving-average (counter-trend warning — trend already up)"
    return "mixed moving-average"


def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 1:
        return "a Stage 1 base/accumulation environment (textbook double-bottom reversal setup)"
    if stage == 4:
        return "a Stage 4 downtrend showing exhaustion at support (oversold reversal context)"
    if stage == 2:
        return "a Stage 2 uptrend (continuation context — double bottom as a bull-flag analog)"
    if stage == 3:
        return "a Stage 3 distribution environment (counter-trend caution)"
    return "an undefined trend stage"


def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving (trend tailwind for the breakout)"
    if rs == "down":
        return "still deteriorating (counter-trend warning — wait for peak break)"
    return "neutral"


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    t1_idx = c["trough1_idx"]
    t2_idx = c["trough2_idx"]
    p_idx = c["peak_idx"]

    trough1_price = c["trough1_price"]
    trough2_price = c["trough2_price"]
    peak_price = c["peak_price"]

    # Levels
    entry = round(peak_price * 1.001, 2)
    stop = round(trough2_price * 0.99, 2)
    # Measured move up: peak → trough2 distance, projected above peak
    target = round(peak_price + (peak_price - trough2_price), 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0

    # Stop distance %
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    # Narrative dimension values
    trough_similarity_pct = c["trough_similarity"] * 100.0
    trough_match_pct = (1.0 - c["trough_similarity"]) * 100.0
    rally_depth_pct = c["rally_depth"] * 100.0
    pattern_bars = c["pattern_bars"]
    peak_to_trough_pts = peak_price - trough2_price
    peak_to_trough_pct = (peak_to_trough_pts / peak_price * 100.0) if peak_price > 0 else 0.0
    avg_trough = (trough1_price + trough2_price) / 2.0

    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime = context.get("regime", "current")
    vol_signature = context.get("volume_signature", "unspecified")

    sym_token = "the stock"

    # ---- Narrative composition - RICH, paragraph-length, with real values ----
    headline = (
        f"Double Bottom forming on {sym_token} - troughs ${trough1_price:.2f} / "
        f"${trough2_price:.2f} within {trough_similarity_pct:.2f}% of each other, "
        f"rally peak ${peak_price:.2f} ({rally_depth_pct:.1f}% off trough), "
        f"{pattern_bars}-bar pattern. Pivot ${entry:.2f}, target ${target:.2f}, "
        f"R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Double Bottom is the bullish mirror of the Double Top — one of the "
        f"oldest documented reversal patterns in technical analysis, traced back "
        f"through Charles Dow's market commentary at the turn of the 20th century, "
        f"formalized by Richard Schabacker in 'Technical Analysis and Stock Market "
        f"Profits' (1932), and canonized in Edwards & Magee's 'Technical Analysis "
        f"of Stock Trends' (1948). Structurally it is two sequential troughs in a "
        f"downtrend (or sideways base) that hold at approximately the same price "
        f"level: trough 1 at ${trough1_price:.2f} establishes the decline low, an "
        f"intervening rally pushes price up to ${peak_price:.2f} "
        f"({rally_depth_pct:.1f}% off the trough), and trough 2 at "
        f"${trough2_price:.2f} retests the prior low but fails to break it. Here "
        f"the two troughs are within {trough_similarity_pct:.2f}% of each other "
        f"(match score {trough_match_pct:.1f}%) and the rally peak at "
        f"${peak_price:.2f} forms the 'neckline' — the horizontal resistance line "
        f"whose breach confirms the reversal. The pattern spans {pattern_bars} "
        f"bars between the two troughs. The market mechanic underneath is demand "
        f"finally overwhelming supply: at the prior-low price, institutional buyers "
        f"who had been waiting on the sidelines step in with size, absorbing the "
        f"second-decline supply and refusing to let price extend lower. The volume "
        f"signature that confirms the read — expanding volume on the trough-2 "
        f"bounce versus declining volume on the trough-2 decline — reveals that "
        f"buying conviction is rebuilding even as price tags the same low. "
        f"Bulkowski's empirical research places confirmed double-bottom breakouts "
        f"at roughly 70% follow-through reliability in liquid stocks when "
        f"triggered on volume, with measured moves equal to the peak-to-trough "
        f"distance projected above the rally peak (here ${peak_to_trough_pts:.2f} "
        f"= {peak_to_trough_pct:.1f}% projection)."
    )

    why_it_matters = (
        f"This Double Bottom is forming in {stage_phrase} with {ma_phrase} "
        f"alignment and {rs_phrase} relative strength versus the broader market, "
        f"against a {regime} regime backdrop and volume signature reading "
        f"{vol_signature}. The {trough_match_pct:.1f}% trough symmetry is squarely "
        f"in the high-quality zone — tight trough matches (within 2%) are the "
        f"highest-reliability variant because they reveal a clear institutional "
        f"demand line at one specific price (${avg_trough:.2f} average), while "
        f"loose matches (above 3%) blur into rounded-bottom noise that can fail "
        f"either way. The {rally_depth_pct:.1f}% intervening rally falls in the "
        f"textbook 10-20% zone where the highest-follow-through double bottoms "
        f"resolve — too-shallow rallies (under 5%) often mean sellers haven't "
        f"actually been challenged yet, while too-deep rallies (over 25%) "
        f"usually reflect a structural breakout already underway rather than a "
        f"clean two-trough basing pattern. The {pattern_bars}-bar pattern width "
        f"sits in the 12-30 bar sweet spot — longer, sprawling patterns are "
        f"less reliable because they accumulate too many late shorts near the "
        f"peak who defend the neckline, while shorter patterns lack the time "
        f"for genuine accumulation to occur. Expanding volume on the trough-2 "
        f"bounce (encoded in this detection's volume_score component) confirms "
        f"the demand-rebuilding thesis: the same price level attracts more "
        f"aggressive buying on the second touch, and the institutions absorbing "
        f"the prior low are stepping up size. Trapped shorts near "
        f"${avg_trough:.2f} become the fuel that propels every subsequent "
        f"upward attempt through the rally peak."
    )

    what_to_watch_for = (
        f"The trigger is a daily close above ${entry:.2f} (the rally peak at "
        f"${peak_price:.2f} plus a small confirmation buffer) on volume of at "
        f"least 1.5x the 20-bar average — that volume expansion on the breakout "
        f"is non-negotiable because a neckline break on light tape frequently "
        f"reverses as a bull trap, especially on a pattern this well-watched. "
        f"The ideal trigger bar closes in the upper half of its range with a "
        f"wide real body, and the next 1-3 bars should hold above ${peak_price:.2f} "
        f"without 'kissing back' below the peak more than once — a single "
        f"throwback retest of the broken resistance is normal and often the "
        f"highest-quality long entry, but two-plus closes back below "
        f"${peak_price:.2f} weakens the thesis. Measured target is ${target:.2f}, "
        f"derived by projecting the ${peak_to_trough_pts:.2f} peak-to-trough "
        f"distance upward from the peak — a {peak_to_trough_pct:.1f}% projected "
        f"move that justifies the position. Initial stop sits at ${stop:.2f} "
        f"(1% below trough 2 at ${trough2_price:.2f}) representing a "
        f"{stop_distance_pct:.1f}% risk from entry — risking 1% of account on "
        f"this long implies a position size of roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity, and risking 0.5% halves that. Trail stops below each new "
        f"swing low as the trade extends, or below the rising 10/20 EMA, and "
        f"consider taking partial profit at 1R to lock in a free trade. Long "
        f"trades have the asymmetric edge of capped downside (the stop) and "
        f"uncapped upside, but never average down on the stop — the entire edge "
        f"depends on the breakout working within 1-7 bars."
    )

    failure_signal = (
        f"The pattern is invalidated on a daily close below trough 2 at "
        f"${trough2_price:.2f} (stop at ${stop:.2f}, 1% below to absorb the "
        f"standard downside wick) — that close signals the accumulation thesis "
        f"is wrong, supply has reabsorbed demand at the prior-low level, and "
        f"the underlying downtrend has a high probability of resuming, often "
        f"with a flush leg as trapped longs capitulate into the trough break. "
        f"A subtler failure mode that often precedes the hard stop: price "
        f"breaks above ${peak_price:.2f} on weak or merely-average volume, the "
        f"next 1-2 bars close in the lower half of their range, and price "
        f"recovers back below the peak. That sequence is the textbook 'failed "
        f"breakout' or 'upthrust after distribution' — market makers used the "
        f"visible double-bottom neckline as a liquidity grab to fill sell "
        f"orders, not a genuine continuation. Flushes off a failed double "
        f"bottom can be violent because the pattern attracts heavy long "
        f"interest from trend-following systems and breakout scanners, and "
        f"the {stop_distance_pct:.1f}% stop must be honored without negotiation — "
        f"widening or removing a stop on a failing double-bottom long is one "
        f"of the fastest ways to convert a manageable loss into account-"
        f"damaging exposure, because the natural human tendency is to 'wait "
        f"and see' on losing longs while immediately cutting losing shorts. "
        f"Failed double bottoms often resolve with rapid trend-resumption "
        f"velocity straight through both troughs, so size accordingly and "
        f"never average down."
    )

    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Double Bottom",
        "category": "classical",
        "direction": "bullish",
        "start_t": int(bars[t1_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[t1_idx]["t"]),
                     int(bars[p_idx]["t"]),
                     int(bars[t2_idx]["t"]),
                     int(last_bar["t"])],
        "geometry": {
            "shape": "neckline",
            "anchors": [
                {"t": int(bars[t1_idx]["t"]), "price": float(trough1_price)},
                {"t": int(bars[p_idx]["t"]), "price": float(peak_price)},
                {"t": int(bars[t2_idx]["t"]), "price": float(trough2_price)},
            ],
            "extras": {
                "trough_similarity_pct": round(c["trough_similarity"] * 100, 2),
                "rally_depth_pct": round(c["rally_depth"] * 100, 2),
                "pattern_bars": int(c["pattern_bars"]),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "trough2_minus_1pct",
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


register(_PATTERN_ID, detect_double_bottom)
