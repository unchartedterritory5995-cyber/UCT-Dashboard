"""Tweezer Bottom candlestick detector.

The Tweezer Bottom is a bullish two-bar reversal signal documented by Steve Nison in
"Japanese Candlestick Charting Techniques" (1991), with empirical context from Thomas
Bulkowski's "Encyclopedia of Candlestick Charts" and interpretive framework from Greg
Morris's "Candlestick Charting Explained." It forms when two consecutive candles share
virtually identical lows, signalling that the market tested the same support level on
back-to-back sessions and was rejected both times — a double-floor defence.

Definition (geometry):
  - Two consecutive candles (bar A then bar B) whose lows match within a tight
    tolerance: abs(low_a - low_b) <= _MATCH_TOL + _EPS, where
    _MATCH_TOL = _MATCH_TOL_PCT * matched_low (_MATCH_TOL_PCT = 0.0015, i.e. 0.15%).
    The 0.15% rule is price-scaled (correct for both $5 and $500 stocks) and
    precisely named. This tolerance is the detector's defining boundary.
  - _EPS = 1e-9: LOAD-BEARING for the canonical boundary pair (low_a=50.00,
    low_b=50.075). The IEEE 754 nearest double for 50.075 is
    50.07500000000000284... (stores ABOVE nominal), giving:
      diff = abs(50.075 - 50.00) ≈ 0.07500000000000284  (above 0.075 by ~2.84e-15)
      tol  = 0.0015 * 50.00     ≈ 0.075                  (exact for this price)
    diff > tol by ~2.84e-15 → WITHOUT _EPS the exact-tolerance pair is WRONGLY
    REJECTED. _EPS = 1e-9 >> 2.84e-15 makes the gate pass correctly. _EPS is
    necessary and load-bearing for this class of boundary values.

Context (critical — mirrors hammer):
  - A tweezer bottom is a bullish REVERSAL. A "great trader's eye" would never
    take a tweezer that is NOT at a reversal point. Therefore a hard reversal-
    context GATE precedes all scoring: a candidate pair is only emitted when
    at least one of the following is true:
      (a) at_swing_low  — bar B is within 5% of the 10-bar range floor
      (b) below_50sma   — bar B close is below the 50-bar SMA
      (c) recent_decline_pct >= _MIN_DECLINE_FOR_REVERSAL (0.05, i.e. 5%)
          over the 15-bar lookback window
    If NONE of these hold the pair is unconditionally discarded (continue) —
    no confidence is computed, no Detection is built. This gate is the bullish-
    tweezer analogue of "a hammer mid-uptrend is noise." Even a geometrically
    perfect pair with full reversal handoff and 2× volume CANNOT fire without
    reversal context (e.g. clean Stage-2 uptrend, no swing low, not below 50SMA,
    decline < 5% → 0 detections).
  - The context SCORING (swing low / support / below-50SMA / decline tiers) still
    runs for all candidates that PASS the gate, differentiating strong from weak
    reversal setups among those that qualify.

Strength scoring:
  - Strongest: bar A bearish + bar B bullish (reversal handoff) — scores a bonus.
  - Both bars same direction at a low: valid but weaker (no handoff bonus).

Direction: bullish.
Confirmation: next bar must close above pattern_high (max(high_a, high_b)).

Levels:
  - entry = pattern_high * 1.001
  - stop = matched_low * 0.985  (1.5% below matched low)
  - target = entry + 2 * (pattern_high - matched_low), capped at
    context["nearest_resistance"] if present and lower
  - risk_reward computed from above

Geometry:
  - shape = "candle_mark"
  - anchors = [bar A anchor, bar B anchor] (2 anchors, timestamps of the pair)
  - pivot_ts = [bar_a_t, bar_b_t]
  - start_t = bar A t, end_t = bar B t

Extras (ALL keys emitted — downstream API contract):
  - low_match_pct (float): abs(low_a - low_b) / matched_low * 100 (tightness of match)
  - bar_a_color ("green"/"red"): color of bar A
  - bar_b_color ("green"/"red"): color of bar B
  - reversal_handoff (bool): True when bar A is bearish AND bar B is bullish
  - at_swing_low (bool): bar B is at a 10-bar swing low
  - below_50sma (bool): bar B close is below the 50-bar SMA
  - recent_decline_pct (float): % drawdown from recent 15-bar high to bar B low
  - matched_low (float): the representative matched low (min(low_a, low_b))
  - pattern_high (float): max(high_a, high_b)

Confidence: round(0.40*geom + 0.25*vol + 0.20*ctx + 0.15*hist, 2)
  - hist = 50.0 (structural constant, no per-bar historical data)
  - _CONFIDENCE_FLOOR = 50.0: detections below this are not emitted

Scan: last _SCAN_LOOKBACK bars for qualifying consecutive pairs; emit 0 or 1
Detection (the most recent qualifying pair).
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "tweezer_bottom"
_MIN_BARS = 7                         # need enough history for context helpers
_MATCH_TOL_PCT = 0.0015               # 0.15% of matched_low — defining boundary constant
_EPS = 1e-9                           # load-bearing IEEE 754 headroom; see docstring
_SCAN_LOOKBACK = 6                    # scan last N bars for the second bar of a pair
_SWING_LOOKBACK = 10                  # bars to look back when testing for swing low
_MIN_DECLINE_FOR_REVERSAL = 0.05      # 5% recent drawdown required for reversal gate
_CONFIDENCE_FLOOR = 50.0


def detect_tweezer_bottom(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect tweezer bottom candle pairs. Emits 0 or 1 Detection (most recent)."""
    if len(bars) < _MIN_BARS:
        return []

    detections: List[Detection] = []
    # Scan: consider bar B at index i; bar A is at i-1
    # i must be >= 1 and within the last _SCAN_LOOKBACK bars
    start = max(1, len(bars) - _SCAN_LOOKBACK)
    for i in range(start, len(bars)):
        pair = _try_extract_pair(bars, i)
        if pair is None:
            continue

        # Compute context helpers once per candidate — used by gate, scoring,
        # and detection builder.  Each helper is O(lookback) so calling it
        # three times per accepted candidate was redundant.
        sw = _is_swing_low(bars, i)
        b50 = _below_sma50(bars, i)
        dp = _recent_decline_pct(bars, i)

        # Hard reversal-context gate (precondition — see docstring).
        # A tweezer is a REVERSAL pattern: it is meaningless without a
        # reversal context. No matter how perfect the geometry or volume,
        # if the price is NOT in a reversal-friendly location this pair is
        # discarded unconditionally.
        has_reversal_context = (
            sw
            or b50
            or dp >= _MIN_DECLINE_FOR_REVERSAL
        )
        if not has_reversal_context:
            continue  # anti-pattern: tweezer in non-reversal location

        geom_score = _score_geometry(pair)
        vol_score = _score_volume(bars, i)
        ctx_score = _score_context(context, sw=sw, b50=b50, dp=dp, bars=bars, i=i)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(
            bars, pair, i, confidence, context,
            geom_score, vol_score, ctx_score, hist_score,
            sw=sw, b50=b50, dp=dp,
        )
        detections.append(d)

    if not detections:
        return []
    return detections[-1:]


def _try_extract_pair(bars: List[Bar], i: int) -> Optional[dict]:
    """Try to extract a valid tweezer pair where bar B is at index i."""
    bar_b = bars[i]
    bar_a = bars[i - 1]

    o_a, h_a, l_a, c_a = bar_a["o"], bar_a["h"], bar_a["l"], bar_a["c"]
    o_b, h_b, l_b, c_b = bar_b["o"], bar_b["h"], bar_b["l"], bar_b["c"]

    # Gate: lows must match within tolerance
    matched_low = min(l_a, l_b)
    if matched_low <= 0:
        return None
    _match_tol = _MATCH_TOL_PCT * matched_low
    diff = abs(l_a - l_b)
    if diff > _match_tol + _EPS:
        return None

    # Gate: both bars must have non-zero range and non-zero body
    if (h_a - l_a) <= 0 or (h_b - l_b) <= 0:
        return None
    if abs(c_a - o_a) <= 0 or abs(c_b - o_b) <= 0:
        # Pure doji in either slot — skip (doji detector handles those)
        return None

    pattern_high = max(h_a, h_b)
    bar_a_color = "red" if c_a < o_a else "green"
    bar_b_color = "red" if c_b < o_b else "green"
    reversal_handoff = (c_a < o_a) and (c_b > o_b)  # A bearish, B bullish
    low_match_pct = diff / matched_low * 100

    return {
        "bar_a": bar_a,
        "bar_b": bar_b,
        "bar_a_idx": i - 1,
        "bar_b_idx": i,
        "o_a": o_a, "h_a": h_a, "l_a": l_a, "c_a": c_a,
        "o_b": o_b, "h_b": h_b, "l_b": l_b, "c_b": c_b,
        "matched_low": matched_low,
        "pattern_high": pattern_high,
        "bar_a_color": bar_a_color,
        "bar_b_color": bar_b_color,
        "reversal_handoff": reversal_handoff,
        "low_match_pct": low_match_pct,
        "match_tol": _match_tol,
        "diff": diff,
    }


# ---------------------------------------------------------------------------
# Context helpers (mirrors hammer.py exactly — same lookbacks/thresholds)
# ---------------------------------------------------------------------------

def _is_swing_low(bars: List[Bar], i: int) -> bool:
    """Return True if bars[i] is near the low of a _SWING_LOOKBACK window."""
    lookback = bars[max(0, i - _SWING_LOOKBACK):i + 1]
    if len(lookback) < 4:
        return False
    high_max = max(b["h"] for b in lookback)
    low_min = min(b["l"] for b in lookback)
    rng = high_max - low_min
    if rng <= 0:
        return False
    bar_low = bars[i]["l"]
    return (bar_low - low_min) / rng <= 0.05


def _below_sma50(bars: List[Bar], i: int) -> bool:
    """Return True if bars[i].close is below the 50-bar SMA."""
    if i < 49:
        return False
    closes = [b["c"] for b in bars[i - 49:i + 1]]
    if not closes:
        return False
    sma = sum(closes) / len(closes)
    return bars[i]["c"] < sma


def _recent_decline_pct(bars: List[Bar], i: int) -> float:
    """Return % drawdown from recent 15-bar high to current bar low (positive = decline)."""
    start = max(0, i - 14)
    window = bars[start:i + 1]
    if not window:
        return 0.0
    high = max(b["h"] for b in window)
    low_now = bars[i]["l"]
    if high <= 0:
        return 0.0
    return (high - low_now) / high


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _score_geometry(p: dict) -> float:
    """Score the tweezer pair anatomy.

    Two components:
    1. Tightness of low match (tighter = higher score).
    2. Reversal color handoff bonus (bearish A + bullish B).
    """
    # Tightness: how close are the lows as a fraction of tolerance?
    # diff=0 → 100; diff=tol → 30 (still passes); linear interpolation
    tol = p["match_tol"]
    diff = p["diff"]
    if tol > 0:
        tightness_ratio = diff / tol  # 0=perfect, 1=at boundary
    else:
        tightness_ratio = 0.0

    if tightness_ratio <= 0.1:
        tightness_score = 100.0
    elif tightness_ratio <= 0.5:
        tightness_score = 70.0 + (0.5 - tightness_ratio) / 0.4 * 30.0
    elif tightness_ratio <= 1.0:
        tightness_score = 30.0 + (1.0 - tightness_ratio) / 0.5 * 40.0
    else:
        tightness_score = 0.0

    # Reversal handoff bonus: bearish A + bullish B is the canonical form
    handoff_bonus = 15.0 if p["reversal_handoff"] else 0.0

    return round(min(100.0, tightness_score + handoff_bonus), 2)


def _score_volume(bars: List[Bar], i: int) -> float:
    """Score volume on bar B (the second tweezer bar) vs 20-bar average.

    Mirrors hammer's _score_volume — volume expansion on bar B signals
    institutional absorption at the floor.
    """
    if i < 1:
        return 50.0
    lookback = bars[max(0, i - 20):i]
    if not lookback:
        return 50.0
    avg_vol = sum(b["v"] for b in lookback) / len(lookback)
    if avg_vol <= 0:
        return 50.0
    ratio = bars[i]["v"] / avg_vol
    if ratio >= 1.8:
        return 100.0
    if ratio >= 1.3:
        return 75.0 + (ratio - 1.3) / 0.5 * 25.0
    if ratio >= 1.0:
        return 55.0 + (ratio - 1.0) / 0.3 * 20.0
    if ratio >= 0.7:
        return 30.0 + (ratio - 0.7) / 0.3 * 25.0
    return 30.0 * ratio / 0.7


def _score_context(
    context: dict,
    sw: bool,
    b50: bool,
    dp: float,
    bars: List[Bar],
    i: int,
) -> float:
    """Score reversal context at bar B index — mirrors hammer's _score_context.

    Accepts precomputed helper values (sw, b50, dp) so the detect loop can
    compute each helper exactly once per candidate.
    """
    score = 30.0

    if sw:
        score += 35
    if b50:
        score += 15
    if dp >= 0.10:
        score += 15
    elif dp >= 0.05:
        score += 8

    # Tweezer at a known support level
    sup = context.get("nearest_support")
    if sup and sup > 0 and abs(bars[i]["l"] - sup) / sup <= 0.015:
        score += 10

    stage = context.get("trend_stage")
    if stage in (1, 4):
        score += 5   # basing or downtrend — reversal-friendly context

    return min(100.0, score)


# ---------------------------------------------------------------------------
# Narrative helpers (mirrors hammer.py)
# ---------------------------------------------------------------------------

def _trend_phrase(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 2:
        return "a Stage 2 uptrend"
    if stage == 1:
        return "a Stage 1 base/accumulation environment"
    if stage == 3:
        return "a Stage 3 distribution environment"
    if stage == 4:
        return "a Stage 4 downtrend environment"
    return "an undefined trend stage"


def _ma_phrase(context: dict) -> str:
    return {
        "stacked_bullish": "stacked-bullish",
        "stacked_bearish": "stacked-bearish",
        "mixed": "mixed",
    }.get(context.get("ma_alignment", "mixed"), "mixed")


def _rs_phrase(context: dict) -> str:
    return {"up": "improving", "down": "deteriorating", "flat": "neutral"}.get(
        context.get("rs_trend", "flat"), "neutral"
    )


# ---------------------------------------------------------------------------
# Detection builder
# ---------------------------------------------------------------------------

def _build_detection(
    bars: List[Bar],
    p: dict,
    i: int,
    confidence: float,
    context: dict,
    geom_score: float,
    vol_score: float,
    ctx_score: float,
    hist_score: float,
    *,
    sw: bool,
    b50: bool,
    dp: float,
) -> Detection:
    bar_a = p["bar_a"]
    bar_b = p["bar_b"]
    matched_low = p["matched_low"]
    pattern_high = p["pattern_high"]

    is_swing_low = sw
    below_50 = b50
    decline_pct = dp * 100

    # Levels
    entry = round(pattern_high * 1.001, 2)
    stop = round(matched_low * 0.985, 2)
    # Target: entry + 2 * (pattern_high - matched_low), capped at nearest_resistance
    measured = entry + 2.0 * (pattern_high - matched_low)
    near_res = context.get("nearest_resistance")
    if near_res and near_res > entry:
        target = round(min(near_res, measured), 2)
        target_basis = "nearest_resistance_or_2x_measured_move"
    else:
        target = round(measured, 2)
        target_basis = "2x_pattern_range_measured_move"
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    # Volume display for bar B
    vol_ratio_disp = "unavailable"
    if i >= 1:
        lookback = bars[max(0, i - 20):i]
        if lookback:
            avg_vol = sum(b["v"] for b in lookback) / len(lookback)
            if avg_vol > 0:
                vol_ratio_disp = f"{bar_b['v'] / avg_vol:.2f}x"

    # Position phrase
    if is_swing_low:
        position_phrase = "at a near-term swing low"
    elif below_50:
        position_phrase = "below the 50-bar SMA after recent decline"
    elif decline_pct >= 5.0:
        position_phrase = f"following a {decline_pct:.1f}% recent pullback"
    else:
        position_phrase = "without a clear preceding downmove"

    stage_phrase = _trend_phrase(context)
    ma_phrase = _ma_phrase(context)
    rs_phrase = _rs_phrase(context)
    regime = context.get("regime", "current")

    handoff_word = (
        "bearish bar A followed by a bullish bar B (the ideal reversal handoff)"
        if p["reversal_handoff"]
        else f"two {p['bar_a_color']} bars (same direction, no classic handoff)"
    )
    low_match_disp = round(p["low_match_pct"], 4)
    pattern_range = pattern_high - matched_low

    now = int(time.time())

    anchors = [
        {"t": int(bar_a["t"]), "price": float(bar_a["c"])},
        {"t": int(bar_b["t"]), "price": float(bar_b["c"])},
    ]

    headline = (
        f"Tweezer Bottom ({handoff_word.split('(')[0].strip()}) {position_phrase} — "
        f"matched lows at ${matched_low:.2f} ({low_match_disp:.4f}% apart), "
        f"pattern high ${pattern_high:.2f}."
    )

    what_it_is = (
        f"The Tweezer Bottom is a bullish two-bar reversal pattern from the Japanese "
        f"candlestick tradition, first systematically described by Steve Nison in "
        f"'Japanese Candlestick Charting Techniques' (1991). The defining feature is "
        f"deceptively simple: two consecutive candles whose lows are virtually "
        f"identical, meaning the market tested the SAME floor price on back-to-back "
        f"sessions and was rejected both times. Here the matched low is ${matched_low:.2f} "
        f"with bar A low = ${p['l_a']:.4f} and bar B low = ${p['l_b']:.4f} — a gap of "
        f"{p['diff']:.4f} points ({low_match_disp:.4f}% of price), well within the "
        f"0.15% tolerance that defines a true tweezer pair. The pattern prints as "
        f"{handoff_word}. Greg Morris, in 'Candlestick Charting Explained', frames "
        f"the tweezer as a 'double dip defence': sellers pushed to the low on bar A, "
        f"were absorbed; they tried again on bar B and were absorbed again. The double "
        f"rejection at the same price prints the floor visually and empirically. Thomas "
        f"Bulkowski's backtesting in 'Encyclopedia of Candlestick Charts' confirms the "
        f"highest-conviction tweezers are those where bar B closes back in the upper "
        f"half of its range — meaning buyers didn't just hold the low, they recovered "
        f"aggressively. Pattern high is ${pattern_high:.2f}, giving a ${pattern_range:.2f} "
        f"pattern range. Volume on bar B is {vol_ratio_disp} the 20-bar average, which "
        f"{'amplifies the signal (institutional absorption)' if 'x' in vol_ratio_disp and float(vol_ratio_disp.replace('x','')) >= 1.2 else 'is in-line with recent sessions'}."
    )

    why_it_matters = (
        f"Context transforms this tweezer from an interesting anatomy into a tradeable "
        f"setup. It appears {position_phrase}, inside {stage_phrase} with {ma_phrase} "
        f"moving-average alignment and {rs_phrase} relative strength against the broader "
        f"tape. The current market regime is {regime}. The tweezer bottom's edge comes "
        f"from what the double-floor rejection reveals about supply and demand dynamics: "
        f"sellers drove to ${matched_low:.2f} on bar A, but sufficient buying demand "
        f"appeared to close bar A off the low. Sellers then returned on bar B, drove to "
        f"the same price, and were absorbed once more — bar B closed at ${p['c_b']:.2f}, "
        f"a {((p['c_b'] - matched_low) / matched_low * 100):.1f}% recovery from the "
        f"matched low. That repeated-absorption fingerprint is categorically different "
        f"from a random double-tap: it implies the same pool of buyers (likely "
        f"institutional size) was defending the ${matched_low:.2f} level on both sessions. "
        f"The recent 15-bar drawdown to this low is {decline_pct:.1f}%, "
        f"{'a meaningful decline that gives the reversal statistical credibility (Bulkowski: reversals at the end of trends outperform mid-trend tweezers)' if decline_pct >= 5.0 else 'a modest pullback that provides some directional context'}. "
        f"Nison's commentary on two-bar patterns emphasises that the location is "
        f"paramount — a tweezer at horizontal support, at a round-number price, or "
        f"after a prolonged slide carries structural weight that a mid-range tweezer "
        f"simply does not."
    )

    what_to_watch_for = (
        f"Like all Japanese reversal patterns, the Tweezer Bottom REQUIRES next-bar "
        f"confirmation — Nison's repeated directive. Confirmation is a close above the "
        f"pattern high of ${pattern_high:.2f} (entry trigger: ${entry:.2f}, 0.1% above "
        f"the high). Specific things to watch: "
        f"(1) Bar C (the confirmation bar) should close in the UPPER third of its own "
        f"range — a close in the lower half after briefly piercing ${pattern_high:.2f} is "
        f"a weak confirmation and reduces the probability of follow-through; "
        f"(2) Volume on bar C should EXPAND vs bar B ({vol_ratio_disp} the 20-bar avg) — "
        f"if buyers absorbed the floor on bar B but couldn't build momentum on bar C, "
        f"the reversal may be a short-covering bounce rather than genuine accumulation; "
        f"(3) The matched low at ${matched_low:.2f} is the critical level — any subsequent "
        f"bar that CLOSES below ${matched_low:.2f} invalidates the reversal entirely; "
        f"(4) Watch for bar C to close above the MIDPOINT of the tweezer pair "
        f"(${(matched_low + pattern_high) / 2:.2f}) — a close above midpoint on expanding "
        f"volume is the strongest confirmation signal. Trade levels: entry ${entry:.2f} "
        f"(above pattern high), stop ${stop:.2f} (basis: matched_low_minus_1.5pct, "
        f"{stop_distance_pct:.1f}% adverse from entry), target ${target:.2f} "
        f"(basis: {target_basis}), R:R {rr:.2f}. Nearest mapped resistance "
        f"{'at $' + format(near_res, '.2f') + ' — take partials there if the measured move exceeds it' if near_res else 'not mapped — use measured move as primary target'}."
    )

    failure_signal = (
        f"The Tweezer Bottom fails when the double-floor defence collapses. The hard "
        f"invalidation: any bar that CLOSES below the matched low at ${matched_low:.2f} "
        f"(stop set at ${stop:.2f}, 1.5% below) — that signals the buyers who defended "
        f"the floor on both sessions have been overwhelmed; exit the position immediately. "
        f"Greg Morris warns that tweezers in downtrends fail more often than retail "
        f"traders expect, precisely because the downtrend is the dominant context and "
        f"the reversal must overcome that inertia with decisive confirmation. More "
        f"subtle failure modes: "
        f"(1) Confirmation bar (bar C) triggers an entry above ${entry:.2f} but on "
        f"DECLINING volume — this is the most common false-start; the pattern needs "
        f"buyers to step in, and shrinking volume means they are not; "
        f"(2) Bar C closes above ${entry:.2f} intraday but reverses to close IN the "
        f"tweezer range by end of session — this 'wick rejection' of the breakout is a "
        f"significant warning signal and suggests supply is waiting at the pattern high; "
        f"(3) The tweezer appears in a strong Stage 4 downtrend with stacked-bearish "
        f"moving averages and falling RS — in that regime EVERY minor rally has been "
        f"sold and the burden of confirmation must rise accordingly; in the current "
        f"context ({ma_phrase} MA alignment, {rs_phrase} RS) this risk is "
        f"{'elevated — be more demanding of confirmation quality' if ma_phrase == 'stacked-bearish' else 'moderate'}. "
        f"Bulkowski's research shows tweezers without reversal handoff (bar A and bar B "
        f"same color) have lower follow-through rates"
        f"{'; this pattern has no handoff, so additional confirmation is warranted before entry' if not p['reversal_handoff'] else ''}. Position "
        f"sizing must reflect the {stop_distance_pct:.1f}% stop: risking 0.5% of account "
        f"implies a position size of roughly "
        f"{(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat the "
        f"Tweezer Bottom as a context-and-confirmation setup, never as a standalone "
        f"trigger — the matched floor is the tell, the next bar fires the entry."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Tweezer Bottom",
        "category": "candlestick",
        "direction": "bullish",
        "start_t": int(bar_a["t"]),
        "end_t": int(bar_b["t"]),
        "pivot_ts": [int(bar_a["t"]), int(bar_b["t"])],
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": {
                "low_match_pct": float(round(p["low_match_pct"], 6)),
                "bar_a_color": p["bar_a_color"],
                "bar_b_color": p["bar_b_color"],
                "reversal_handoff": bool(p["reversal_handoff"]),
                "at_swing_low": bool(is_swing_low),
                "below_50sma": bool(below_50),
                "recent_decline_pct": float(round(decline_pct, 2)),
                "matched_low": float(round(matched_low, 4)),
                "pattern_high": float(round(pattern_high, 4)),
            },
        },
        "levels": {
            "entry": float(entry),
            "entry_condition": (
                f"close > {entry:.2f} on next bar with volume >= 1.3x 20-bar avg"
            ),
            "stop": float(stop),
            "stop_basis": "matched_low_minus_1.5pct",
            "target_primary": float(target),
            "target_secondary": None,
            "risk_reward": float(round(rr, 2)),
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


register(_PATTERN_ID, detect_tweezer_bottom)
