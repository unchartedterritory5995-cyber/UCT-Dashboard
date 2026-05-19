"""Tweezer Top candlestick detector.

The Tweezer Top is a bearish two-bar reversal signal documented by Steve Nison in
"Japanese Candlestick Charting Techniques" (1991), with empirical context from Thomas
Bulkowski's "Encyclopedia of Candlestick Charts" and interpretive framework from Greg
Morris's "Candlestick Charting Explained." It forms when two consecutive candles share
virtually identical highs, signalling that the market tested the same resistance level
on back-to-back sessions and was rejected both times — a double-ceiling defence by
sellers.

Definition (geometry):
  - Two consecutive candles (bar A then bar B) whose highs match within a tight
    tolerance: abs(high_a - high_b) <= _MATCH_TOL + _EPS, where
    _MATCH_TOL = _MATCH_TOL_PCT * matched_high (_MATCH_TOL_PCT = 0.0015, i.e. 0.15%).
    The 0.15% rule is price-scaled (correct for both $5 and $500 stocks) and
    precisely named. This tolerance is the detector's defining boundary.
  - _EPS = 1e-9: LOAD-BEARING for the canonical boundary pair (high_a=100.00,
    high_b=99.85). The matched_high = max(100.00, 99.85) = 100.00. The tolerance
    is computed at 100.00, which stores below nominal; abs(100.00 - 99.85) stores
    above nominal, giving:
      diff = abs(100.00 - 99.85) ≈ 0.15000000000000568  (above 0.15 by ~5.69e-15)
      tol  = 0.0015 * 100.00     ≈ 0.14999999999999999  (below 0.15 by ~4.5e-18)
    diff > tol by ~5.69e-15 → WITHOUT _EPS the exact-tolerance pair is WRONGLY
    REJECTED. _EPS = 1e-9 >> 5.69e-15 makes the gate pass correctly. _EPS is
    necessary and load-bearing for this class of boundary values.

Context (critical — bearish mirror of tweezer_bottom):
  - A tweezer top is a bearish REVERSAL. A "great trader's eye" would never
    take a tweezer that is NOT at a distribution/topping point. Therefore a hard
    reversal-context GATE precedes all scoring: a candidate pair is only emitted
    when at least one of the following is true:
      (a) at_swing_high  — bar B is within 5% of the 10-bar range ceiling
      (b) above_50sma    — bar B close is above the 50-bar SMA
      (c) recent_advance_pct >= _MIN_ADVANCE_FOR_REVERSAL (0.05, i.e. 5%)
          over the 15-bar lookback window
    If NONE of these hold the pair is unconditionally discarded (continue) —
    no confidence is computed, no Detection is built. This gate is the bearish-
    tweezer analogue of "a tweezer mid-downtrend is noise." Even a geometrically
    perfect pair with full reversal handoff and 2× volume CANNOT fire without
    topping context (e.g. clean Stage-1/4 basing/downtrend, no swing high, not
    above 50SMA, advance < 5% → 0 detections).
  - The context SCORING (swing high / resistance / above-50SMA / advance tiers)
    still runs for all candidates that PASS the gate, differentiating strong from
    weak distribution setups among those that qualify.

Strength scoring:
  - Strongest: bar A bullish + bar B bearish (reversal handoff) — scores a bonus.
  - Both bars same direction at a high: valid but weaker (no handoff bonus).

Direction: bearish.
Confirmation: next bar must close below pattern_low (min(low_a, low_b)).

Levels:
  - pattern_low = min(low_a, low_b)
  - matched_high = the representative matched highs' level (max(high_a, high_b))
  - entry = pattern_low * 0.999  (just below the pattern low)
  - stop = matched_high * 1.015  (1.5% above matched high)
  - target = entry − 2 * (matched_high − pattern_low), FLOORED at
    context["nearest_support"] if present and higher than raw measured target
    (mirror of tweezer_bottom's resistance-cap idiom, inverted for shorts)
  - risk_reward computed from above

Geometry:
  - shape = "candle_mark"
  - anchors = [bar A anchor, bar B anchor] (2 anchors, timestamps of the pair)
  - pivot_ts = [bar_a_t, bar_b_t]
  - start_t = bar A t, end_t = bar B t

Extras (ALL keys emitted — downstream API contract):
  - high_match_pct (float): abs(high_a - high_b) / matched_high * 100 (tightness)
  - bar_a_color ("green"/"red"): color of bar A
  - bar_b_color ("green"/"red"): color of bar B
  - reversal_handoff (bool): True when bar A is bullish AND bar B is bearish
  - at_swing_high (bool): bar B is at a 10-bar swing high
  - above_50sma (bool): bar B close is above the 50-bar SMA
  - recent_advance_pct (float): % run-up from recent 15-bar low to bar B high
  - matched_high (float): the representative matched high (max(high_a, high_b))
  - pattern_low (float): min(low_a, low_b)

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


_PATTERN_ID = "tweezer_top"
_MIN_BARS = 7                         # need enough history for context helpers
_MATCH_TOL_PCT = 0.0015               # 0.15% of matched_high — defining boundary constant
_EPS = 1e-9                           # load-bearing IEEE 754 headroom; see docstring
_SCAN_LOOKBACK = 6                    # scan last N bars for the second bar of a pair
_SWING_LOOKBACK = 10                  # bars to look back when testing for swing high
_MIN_ADVANCE_FOR_REVERSAL = 0.05      # 5% recent run-up required for reversal gate
_CONFIDENCE_FLOOR = 50.0


def detect_tweezer_top(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect tweezer top candle pairs. Emits 0 or 1 Detection (most recent)."""
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
        sh = _is_swing_high(bars, i)
        a50 = _above_sma50(bars, i)
        ap = _recent_advance_pct(bars, i)

        # Hard reversal-context gate (precondition — see docstring).
        # A tweezer top is a REVERSAL pattern: it is meaningless without a
        # topping/distribution context. No matter how perfect the geometry or
        # volume, if the price is NOT in a reversal-friendly location this pair
        # is discarded unconditionally.
        has_reversal_context = (
            sh
            or a50
            or ap >= _MIN_ADVANCE_FOR_REVERSAL
        )
        if not has_reversal_context:
            continue  # anti-pattern: tweezer top in non-topping location

        geom_score = _score_geometry(pair)
        vol_score = _score_volume(bars, i)
        ctx_score = _score_context(context, sh=sh, a50=a50, ap=ap, bars=bars, i=i)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        d = _build_detection(
            bars, pair, i, confidence, context,
            geom_score, vol_score, ctx_score, hist_score,
            sh=sh, a50=a50, ap=ap,
        )
        detections.append(d)

    if not detections:
        return []
    return detections[-1:]


def _try_extract_pair(bars: List[Bar], i: int) -> Optional[dict]:
    """Try to extract a valid tweezer top pair where bar B is at index i."""
    bar_b = bars[i]
    bar_a = bars[i - 1]

    o_a, h_a, l_a, c_a = bar_a["o"], bar_a["h"], bar_a["l"], bar_a["c"]
    o_b, h_b, l_b, c_b = bar_b["o"], bar_b["h"], bar_b["l"], bar_b["c"]

    # Gate: highs must match within tolerance
    matched_high = max(h_a, h_b)
    if matched_high <= 0:
        return None
    _match_tol = _MATCH_TOL_PCT * matched_high
    diff = abs(h_a - h_b)
    if diff > _match_tol + _EPS:
        return None

    # Gate: both bars must have non-zero range and non-zero body
    if (h_a - l_a) <= 0 or (h_b - l_b) <= 0:
        return None
    if abs(c_a - o_a) <= 0 or abs(c_b - o_b) <= 0:
        # Pure doji in either slot — skip (doji detector handles those)
        return None

    pattern_low = min(l_a, l_b)
    bar_a_color = "green" if c_a > o_a else "red"
    bar_b_color = "green" if c_b > o_b else "red"
    reversal_handoff = (c_a > o_a) and (c_b < o_b)  # A bullish, B bearish
    high_match_pct = diff / matched_high * 100

    return {
        "bar_a": bar_a,
        "bar_b": bar_b,
        "bar_a_idx": i - 1,
        "bar_b_idx": i,
        "o_a": o_a, "h_a": h_a, "l_a": l_a, "c_a": c_a,
        "o_b": o_b, "h_b": h_b, "l_b": l_b, "c_b": c_b,
        "matched_high": matched_high,
        "pattern_low": pattern_low,
        "bar_a_color": bar_a_color,
        "bar_b_color": bar_b_color,
        "reversal_handoff": reversal_handoff,
        "high_match_pct": high_match_pct,
        "match_tol": _match_tol,
        "diff": diff,
    }


# ---------------------------------------------------------------------------
# Context helpers (bearish mirrors of tweezer_bottom's helpers)
# ---------------------------------------------------------------------------

def _is_swing_high(bars: List[Bar], i: int) -> bool:
    """Return True if bars[i] is near the high of a _SWING_LOOKBACK window."""
    lookback = bars[max(0, i - _SWING_LOOKBACK):i + 1]
    if len(lookback) < 4:
        return False
    high_max = max(b["h"] for b in lookback)
    low_min = min(b["l"] for b in lookback)
    rng = high_max - low_min
    if rng <= 0:
        return False
    bar_high = bars[i]["h"]
    return (high_max - bar_high) / rng <= 0.05


def _above_sma50(bars: List[Bar], i: int) -> bool:
    """Return True if bars[i].close is above the 50-bar SMA."""
    if i < 49:
        return False
    closes = [b["c"] for b in bars[i - 49:i + 1]]
    if not closes:
        return False
    sma = sum(closes) / len(closes)
    return bars[i]["c"] > sma


def _recent_advance_pct(bars: List[Bar], i: int) -> float:
    """Return % run-up from recent 15-bar low to current bar high (positive = advance)."""
    start = max(0, i - 14)
    window = bars[start:i + 1]
    if not window:
        return 0.0
    low = min(b["l"] for b in window)
    high_now = bars[i]["h"]
    if low <= 0:
        return 0.0
    return (high_now - low) / low


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _score_geometry(p: dict) -> float:
    """Score the tweezer pair anatomy.

    Two components:
    1. Tightness of high match (tighter = higher score).
    2. Reversal color handoff bonus (bullish A + bearish B).
    """
    # Tightness: how close are the highs as a fraction of tolerance?
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

    # Reversal handoff bonus: bullish A + bearish B is the canonical form
    handoff_bonus = 15.0 if p["reversal_handoff"] else 0.0

    return round(min(100.0, tightness_score + handoff_bonus), 2)


def _score_volume(bars: List[Bar], i: int) -> float:
    """Score volume on bar B (the second tweezer bar) vs 20-bar average.

    Mirrors tweezer_bottom's _score_volume — volume expansion on bar B signals
    institutional distribution at the ceiling.
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
    sh: bool,
    a50: bool,
    ap: float,
    bars: List[Bar],
    i: int,
) -> float:
    """Score topping context at bar B index — bearish mirror of tweezer_bottom's scorer.

    Accepts precomputed helper values (sh, a50, ap) so the detect loop can
    compute each helper exactly once per candidate.
    """
    score = 30.0

    if sh:
        score += 35
    if a50:
        score += 15
    if ap >= 0.10:
        score += 15
    elif ap >= 0.05:
        score += 8

    # Tweezer top at a known resistance level
    res = context.get("nearest_resistance")
    if res and res > 0 and abs(bars[i]["h"] - res) / res <= 0.015:
        score += 10

    stage = context.get("trend_stage")
    if stage in (2, 3):
        score += 5   # uptrend or distribution — topping-reversal-friendly context

    return min(100.0, score)


# ---------------------------------------------------------------------------
# Narrative helpers (mirrors tweezer_bottom's helpers, bearish framing)
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
    sh: bool,
    a50: bool,
    ap: float,
) -> Detection:
    bar_a = p["bar_a"]
    bar_b = p["bar_b"]
    matched_high = p["matched_high"]
    pattern_low = p["pattern_low"]

    is_swing_high = sh
    above_50 = a50
    advance_pct = ap * 100

    # Levels (bearish mirror of tweezer_bottom)
    entry = round(pattern_low * 0.999, 2)
    stop = round(matched_high * 1.015, 2)
    # Target: entry - 2 * (matched_high - pattern_low), floored at nearest_support
    measured = entry - 2.0 * (matched_high - pattern_low)
    near_sup = context.get("nearest_support")
    if near_sup and near_sup > 0 and near_sup > measured:
        target = round(max(near_sup, measured), 2)
        target_basis = "nearest_support_or_2x_measured_move"
    else:
        target = round(measured, 2)
        target_basis = "2x_pattern_range_measured_move"
    rr = (entry - target) / (stop - entry) if stop > entry else 0.0
    stop_distance_pct = (stop - entry) / entry * 100 if entry > 0 else 0.0

    # Volume display for bar B
    vol_ratio_disp = "unavailable"
    if i >= 1:
        lookback = bars[max(0, i - 20):i]
        if lookback:
            avg_vol = sum(b["v"] for b in lookback) / len(lookback)
            if avg_vol > 0:
                vol_ratio_disp = f"{bar_b['v'] / avg_vol:.2f}x"

    # Position phrase
    if is_swing_high:
        position_phrase = "at a near-term swing high"
    elif above_50:
        position_phrase = "above the 50-bar SMA after recent advance"
    elif advance_pct >= 5.0:
        position_phrase = f"following a {advance_pct:.1f}% recent run-up"
    else:
        position_phrase = "without a clear preceding up-move"

    stage_phrase = _trend_phrase(context)
    ma_phrase = _ma_phrase(context)
    rs_phrase = _rs_phrase(context)
    regime = context.get("regime", "current")

    handoff_word = (
        "bullish bar A followed by a bearish bar B (the ideal reversal handoff)"
        if p["reversal_handoff"]
        else f"two {p['bar_a_color']} bars (same direction, no classic handoff)"
    )
    high_match_disp = round(p["high_match_pct"], 4)
    pattern_range = matched_high - pattern_low

    now = int(time.time())

    anchors = [
        {"t": int(bar_a["t"]), "price": float(bar_a["c"])},
        {"t": int(bar_b["t"]), "price": float(bar_b["c"])},
    ]

    headline = (
        f"Tweezer Top ({handoff_word.split('(')[0].strip()}) {position_phrase} — "
        f"matched highs at ${matched_high:.2f} ({high_match_disp:.4f}% apart), "
        f"pattern low ${pattern_low:.2f}."
    )

    what_it_is = (
        f"The Tweezer Top is a bearish two-bar reversal pattern from the Japanese "
        f"candlestick tradition, first systematically described by Steve Nison in "
        f"'Japanese Candlestick Charting Techniques' (1991). The defining feature is "
        f"deceptively simple: two consecutive candles whose highs are virtually "
        f"identical, meaning the market tested the SAME ceiling price on back-to-back "
        f"sessions and was rejected both times. Here the matched high is "
        f"${matched_high:.2f} with bar A high = ${p['h_a']:.4f} and bar B high = "
        f"${p['h_b']:.4f} — a gap of {p['diff']:.4f} points "
        f"({high_match_disp:.4f}% of price), well within the 0.15% tolerance that "
        f"defines a true tweezer pair. The pattern prints as {handoff_word}. Greg "
        f"Morris, in 'Candlestick Charting Explained', frames the tweezer top as a "
        f"'double ceiling rejection': buyers pushed to the high on bar A, were turned "
        f"away; they tried again on bar B and were turned away again. The double "
        f"rejection at the same price prints the ceiling visually and empirically. "
        f"Thomas Bulkowski's backtesting in 'Encyclopedia of Candlestick Charts' "
        f"confirms the highest-conviction tweezer tops are those where bar B closes "
        f"back in the lower half of its range — meaning sellers didn't just hold the "
        f"high, they recovered downward aggressively. Matched high is "
        f"${matched_high:.2f}, pattern low is ${pattern_low:.2f}, giving a "
        f"${pattern_range:.2f} pattern range. Volume on bar B is {vol_ratio_disp} "
        f"the 20-bar average, which "
        f"{'amplifies the signal (institutional distribution at the ceiling)' if 'x' in vol_ratio_disp and float(vol_ratio_disp.replace('x','')) >= 1.2 else 'is in-line with recent sessions'}."
    )

    why_it_matters = (
        f"Context transforms this tweezer from an interesting anatomy into a tradeable "
        f"setup. It appears {position_phrase}, inside {stage_phrase} with {ma_phrase} "
        f"moving-average alignment and {rs_phrase} relative strength against the broader "
        f"tape. The current market regime is {regime}. The tweezer top's edge comes "
        f"from what the double-ceiling rejection reveals about supply and demand "
        f"dynamics: buyers pushed to ${matched_high:.2f} on bar A, but sufficient "
        f"selling supply appeared to close bar A off the high. Buyers then returned "
        f"on bar B, pushed to the same price, and were absorbed once more — bar B "
        f"closed at ${p['c_b']:.2f}, a "
        f"{((matched_high - p['c_b']) / matched_high * 100):.1f}% rejection from the "
        f"matched high. That repeated-rejection fingerprint is categorically different "
        f"from a random double-tap: it implies the same pool of sellers (likely "
        f"institutional size) was defending the ${matched_high:.2f} level on both "
        f"sessions. The recent 15-bar advance to this high is {advance_pct:.1f}%, "
        f"{'a meaningful advance that gives the reversal statistical credibility (Bulkowski: reversals at the end of advances outperform mid-trend tweezer tops)' if advance_pct >= 5.0 else 'a modest move that provides some directional context'}. "
        f"Nison's commentary on two-bar patterns emphasises that the location is "
        f"paramount — a tweezer top at horizontal resistance, at a round-number price, "
        f"or after a prolonged advance carries structural weight that a mid-range "
        f"tweezer top simply does not."
    )

    what_to_watch_for = (
        f"Like all Japanese reversal patterns, the Tweezer Top REQUIRES next-bar "
        f"confirmation — Nison's repeated directive. Confirmation is a close below the "
        f"pattern low of ${pattern_low:.2f} (entry trigger: ${entry:.2f}, 0.1% below "
        f"the low). Specific things to watch: "
        f"(1) Bar C (the confirmation bar) should close in the LOWER third of its own "
        f"range — a close in the upper half after briefly breaching ${pattern_low:.2f} "
        f"is a weak confirmation and reduces the probability of follow-through; "
        f"(2) Volume on bar C should EXPAND vs bar B ({vol_ratio_disp} the 20-bar avg) — "
        f"if sellers rejected the ceiling on bar B but couldn't build downward momentum "
        f"on bar C, the reversal may be a short-covering bounce rather than genuine "
        f"distribution; "
        f"(3) The matched high at ${matched_high:.2f} is the critical level — any "
        f"subsequent bar that CLOSES above ${matched_high:.2f} invalidates the reversal "
        f"entirely; "
        f"(4) Watch for bar C to close below the MIDPOINT of the tweezer pair "
        f"(${(pattern_low + matched_high) / 2:.2f}) — a close below midpoint on "
        f"expanding volume is the strongest bearish confirmation signal. Trade levels: "
        f"entry ${entry:.2f} (below pattern low), stop ${stop:.2f} (basis: "
        f"matched_high_plus_1.5pct, {stop_distance_pct:.1f}% adverse from entry), "
        f"target ${target:.2f} (basis: {target_basis}), R:R {rr:.2f}. Nearest mapped "
        f"support "
        f"{'at $' + format(near_sup, '.2f') + ' — cover partials there if the measured move exceeds it' if near_sup else 'not mapped — use measured move as primary target'}."
    )

    failure_signal = (
        f"The Tweezer Top fails when the double-ceiling resistance collapses upward. "
        f"The hard invalidation: any bar that CLOSES above the matched high at "
        f"${matched_high:.2f} (stop set at ${stop:.2f}, 1.5% above) — that signals "
        f"the sellers who defended the ceiling on both sessions have been overwhelmed; "
        f"cover the short position immediately. Greg Morris warns that tweezer tops "
        f"in uptrends fail more often than retail traders expect, precisely because "
        f"the uptrend is the dominant context and the reversal must overcome that "
        f"inertia with decisive confirmation. More subtle failure modes: "
        f"(1) Confirmation bar (bar C) triggers a short entry below ${entry:.2f} but "
        f"on DECLINING volume — this is the most common false-start; the pattern needs "
        f"sellers to step in, and shrinking volume means they are not; "
        f"(2) Bar C closes below ${entry:.2f} intraday but reverses to close IN the "
        f"tweezer range by end of session — this 'wick rejection' of the breakdown is "
        f"a significant warning signal and suggests demand is waiting at the pattern "
        f"low; "
        f"(3) The tweezer top appears in a strong Stage 2 uptrend with stacked-bullish "
        f"moving averages and rising RS — in that regime EVERY minor pullback has been "
        f"bought and the burden of confirmation must rise accordingly; in the current "
        f"context ({ma_phrase} MA alignment, {rs_phrase} RS) this risk is "
        f"{'elevated — be more demanding of confirmation quality' if ma_phrase == 'stacked-bullish' else 'moderate'}. "
        f"Bulkowski's research shows tweezer tops without reversal handoff (bar A and "
        f"bar B same color) have lower follow-through rates"
        f"{'; this pattern has no handoff, so additional confirmation is warranted before entry' if not p['reversal_handoff'] else ''}. "
        f"Position sizing must reflect the {stop_distance_pct:.1f}% stop: risking "
        f"0.5% of account implies a position size of roughly "
        f"{(0.5 / max(stop_distance_pct, 0.5)) * 100:.1f}% of equity. Treat the "
        f"Tweezer Top as a context-and-confirmation setup, never as a standalone "
        f"trigger — the matched ceiling is the tell, the next bar fires the entry."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Tweezer Top",
        "category": "candlestick",
        "direction": "bearish",
        "start_t": int(bar_a["t"]),
        "end_t": int(bar_b["t"]),
        "pivot_ts": [int(bar_a["t"]), int(bar_b["t"])],
        "geometry": {
            "shape": "candle_mark",
            "anchors": anchors,
            "extras": {
                "high_match_pct": float(round(p["high_match_pct"], 6)),
                "bar_a_color": p["bar_a_color"],
                "bar_b_color": p["bar_b_color"],
                "reversal_handoff": bool(p["reversal_handoff"]),
                "at_swing_high": bool(is_swing_high),
                "above_50sma": bool(above_50),
                "recent_advance_pct": float(round(advance_pct, 2)),
                "matched_high": float(round(matched_high, 4)),
                "pattern_low": float(round(pattern_low, 4)),
            },
        },
        "levels": {
            "entry": float(entry),
            "entry_condition": (
                f"close < {entry:.2f} on next bar with volume >= 1.3x 20-bar avg"
            ),
            "stop": float(stop),
            "stop_basis": "matched_high_plus_1.5pct",
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


register(_PATTERN_ID, detect_tweezer_top)
