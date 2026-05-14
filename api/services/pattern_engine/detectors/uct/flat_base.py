"""Flat Base Breakout detector.

Codified by William O'Neil at Investor's Business Daily and refined for
swing trading by Pradeep Bonde and Bauer at Stockbee, the Flat Base is
one of the highest-success continuation patterns. After a stock has
demonstrated institutional sponsorship via a strong prior advance
(>=25%), price enters a tight horizontal consolidation (<=12% depth)
for 15+ bars on contracting volume. The breakout from a flat base
above the pivot (=base high) frequently produces 18-30% follow-through.

Geometric definition:
  - Prior advance: >=25% gain in the 60 bars preceding the base
  - Base window: 15-35 bars of consolidation
  - Base flatness: (base_high - base_low) / base_mid <= 12% (horizontal)
  - Sideways drift: |slope| < 0.5% * base_mid per bar (no clear trend)
  - Volume: latter half avg < 75% of first half (supply dries up)
  - Pivot: high of the base = breakout level
  - Direction: bullish

Scoring (composite 0-100):
  geometry_score:   base flatness, base duration, sideways drift
  volume_score:     latter/first half volume contraction
  context_score:    Stage 2, stacked_bullish, rs_trend up
  historical_score: 50.0 (neutral prior)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import dcr_interpretation, dcr_phrase
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "flat_base"
_MIN_BASE_BARS = 15
_MAX_BASE_BARS = 35
_MAX_BASE_DEPTH = 0.12              # 12% maximum depth (flat = horizontal)
_MAX_SLOPE_PCT_PER_BAR = 0.005      # 0.5% of base_mid per bar — near-horizontal
_MIN_PRIOR_ADVANCE = 0.25           # 25% advance in prior 60 bars
_PRIOR_ADVANCE_LOOKBACK = 60        # bars before base_start to scan for prior advance
_MAX_VOL_LATTER_RATIO = 0.75        # latter half avg < 75% of first half
_CONFIDENCE_FLOOR = 50.0


def detect_flat_base(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Flat Base patterns. May emit 0-N detections (best one)."""
    # Need enough bars for prior advance + base + a final unbroken edge
    if len(bars) < (_PRIOR_ADVANCE_LOOKBACK // 2 + _MIN_BASE_BARS + 1):
        return []

    last_idx = len(bars) - 1

    # Enumerate candidate base windows: end at last_idx, vary length from
    # MAX down to MIN. Within each length, also try ending a few bars earlier
    # (the "not yet broken" base might have ended 1-3 bars ago and price is
    # currently testing the pivot).
    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    candidates = _enumerate_base_windows(bars)
    for candidate in candidates:
        # Already-broken gate
        if _already_broken(bars, candidate):
            continue

        # Hard context gate: flat bases need an uptrend backdrop. Stage 4
        # + stacked bearish MA + rs down = no buy signal worth flagging.
        if _hostile_context(context):
            continue

        # Hard volume gate: flat bases require supply to dry up.
        if not _volume_contracts(bars, candidate):
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


def _enumerate_base_windows(bars: List[Bar]) -> List[dict]:
    """Yield candidate base windows ending near the most recent bar.

    For each candidate, validate:
      - depth <= MAX_BASE_DEPTH
      - sideways drift (|slope| < threshold)
      - prior_advance >= 25% in the 60 bars before base_start
      - base length in [MIN, MAX]

    Enumerates EVERY valid (end_offset, length) combination. The detector
    body picks the best scoring one. This ensures a tight 20-bar base
    inside a longer drifting window is preferred over the noisy long window.
    """
    last_idx = len(bars) - 1
    out: List[dict] = []

    # Try different end positions: from last bar back up to 4 bars ago,
    # because a base may have "ended" a couple bars ago with price now
    # testing the pivot.
    for end_offset in range(0, 5):
        base_end = last_idx - end_offset
        if base_end < _MIN_BASE_BARS:
            continue

        # Try every length in [MIN, MAX]
        for length in range(_MIN_BASE_BARS, _MAX_BASE_BARS + 1):
            base_start = base_end - length + 1
            if base_start < 0:
                continue

            window = bars[base_start:base_end + 1]
            base_high = max(b["h"] for b in window)
            base_low = min(b["l"] for b in window)
            base_mid = (base_high + base_low) / 2.0
            if base_mid <= 0:
                continue

            depth = (base_high - base_low) / base_mid
            if depth > _MAX_BASE_DEPTH:
                continue

            # Linear regression slope on closes
            slope = _ols_slope([b["c"] for b in window])
            slope_threshold = _MAX_SLOPE_PCT_PER_BAR * base_mid
            if abs(slope) > slope_threshold:
                continue

            # Prior advance gate
            advance_info = _compute_prior_advance(bars, base_start)
            if advance_info is None:
                continue

            candidate = {
                "base_start": base_start,
                "base_end": base_end,
                "base_high": base_high,
                "base_low": base_low,
                "base_mid": base_mid,
                "base_depth": depth,
                "base_bars": length,
                "base_slope": slope,
                "base_slope_pct_per_bar": (slope / base_mid) if base_mid > 0 else 0.0,
                "prior_advance_pct": advance_info["advance_pct"],
                "prior_advance_bars": advance_info["advance_bars"],
                "prior_advance_low_idx": advance_info["low_idx"],
                "prior_advance_low_price": advance_info["low_price"],
                "prior_advance_high_idx": advance_info["high_idx"],
                "prior_advance_high_price": advance_info["high_price"],
                "prior_advance_height": advance_info["high_price"] - advance_info["low_price"],
            }
            out.append(candidate)

    return out


def _ols_slope(values: List[float]) -> float:
    """Return ordinary least-squares slope of values vs index (price per bar)."""
    n = len(values)
    if n < 2:
        return 0.0
    mean_x = (n - 1) / 2.0
    mean_y = sum(values) / n
    num = 0.0
    den = 0.0
    for i, v in enumerate(values):
        dx = i - mean_x
        num += dx * (v - mean_y)
        den += dx * dx
    if den <= 0:
        return 0.0
    return num / den


def _compute_prior_advance(bars: List[Bar], base_start: int) -> Optional[dict]:
    """Verify there was a >=25% advance in the 60 bars before base_start.

    Finds the lowest low in the lookback window and the highest high AFTER
    that low (still inside the lookback window, up to base_start - 1).
    Returns advance info or None if no qualifying advance.
    """
    if base_start < 5:
        return None

    lookback_start = max(0, base_start - _PRIOR_ADVANCE_LOOKBACK)
    window = bars[lookback_start:base_start]
    if len(window) < 5:
        return None

    # Find the LOW first (earliest), then find HIGH after that low.
    low_idx_rel = 0
    low_price = window[0]["l"]
    for i, b in enumerate(window):
        if b["l"] < low_price:
            low_price = b["l"]
            low_idx_rel = i

    # Find the highest high AFTER the low within the lookback window
    high_idx_rel = low_idx_rel
    high_price = window[low_idx_rel]["h"]
    for i in range(low_idx_rel, len(window)):
        if window[i]["h"] > high_price:
            high_price = window[i]["h"]
            high_idx_rel = i

    if low_price <= 0:
        return None

    advance_pct = (high_price - low_price) / low_price
    if advance_pct < _MIN_PRIOR_ADVANCE:
        return None

    advance_bars = high_idx_rel - low_idx_rel
    if advance_bars < 3:
        return None

    return {
        "low_idx": lookback_start + low_idx_rel,
        "low_price": low_price,
        "high_idx": lookback_start + high_idx_rel,
        "high_price": high_price,
        "advance_pct": advance_pct,
        "advance_bars": advance_bars,
    }


def _already_broken(bars: List[Bar], c: dict) -> bool:
    """True if price has decisively broken above base_high after base_end."""
    base_high = c["base_high"]
    last_idx = len(bars) - 1
    if last_idx <= c["base_end"]:
        return False
    sustained_above = sum(
        1 for i in range(c["base_end"] + 1, last_idx + 1)
        if bars[i]["c"] > base_high * 1.01
    )
    return sustained_above >= 3


def _hostile_context(context: dict) -> bool:
    """Reject only if Stage 4 + stacked_bearish + rs_trend down all coincide."""
    stage_bad = context.get("trend_stage") == 4
    ma_bad = context.get("ma_alignment") == "stacked_bearish"
    rs_bad = context.get("rs_trend") == "down"
    return stage_bad and ma_bad and rs_bad


def _volume_contracts(bars: List[Bar], c: dict) -> bool:
    """Hard gate: latter half of base avg vol < 75% of first half avg vol."""
    info = _volume_halves(bars, c)
    first_v = info["first_half_avg"]
    last_v = info["second_half_avg"]
    if first_v <= 0:
        return True  # can't measure, don't gate
    return (last_v / first_v) <= _MAX_VOL_LATTER_RATIO


def _volume_halves(bars: List[Bar], c: dict) -> dict:
    """Return first-half and second-half avg volume for the base window."""
    a = c["base_start"]
    b = c["base_end"]
    n = b - a + 1
    if n < 2:
        return {"first_half_avg": 0.0, "second_half_avg": 0.0}
    mid = a + n // 2
    first = bars[a:mid]
    second = bars[mid:b + 1]
    first_avg = sum(x["v"] for x in first) / len(first) if first else 0.0
    second_avg = sum(x["v"] for x in second) / len(second) if second else 0.0
    return {"first_half_avg": first_avg, "second_half_avg": second_avg}


def _score_geometry(c: dict) -> float:
    """Components: base flatness (depth), duration, sideways drift."""
    depth = c["base_depth"]
    # 0% depth = 100, 12% = 0
    if depth <= 0:
        depth_score = 100.0
    elif depth >= _MAX_BASE_DEPTH:
        depth_score = 0.0
    else:
        depth_score = (1.0 - depth / _MAX_BASE_DEPTH) * 100.0

    # Duration: 15 bars = 70, 20-25 bars sweet spot = 100, 35 bars = 70
    bars_count = c["base_bars"]
    if 20 <= bars_count <= 25:
        duration_score = 100.0
    elif bars_count < 20:
        duration_score = 70.0 + (bars_count - _MIN_BASE_BARS) / (20 - _MIN_BASE_BARS) * 30.0
    else:
        duration_score = max(
            70.0,
            100.0 - (bars_count - 25) / (_MAX_BASE_BARS - 25) * 30.0,
        )

    # Sideways drift: 0% slope per bar = 100, +/-0.5% = 0
    slope_pct = abs(c["base_slope_pct_per_bar"])
    if slope_pct <= 0:
        drift_score = 100.0
    elif slope_pct >= _MAX_SLOPE_PCT_PER_BAR:
        drift_score = 0.0
    else:
        drift_score = (1.0 - slope_pct / _MAX_SLOPE_PCT_PER_BAR) * 100.0

    return round(
        0.45 * depth_score + 0.25 * duration_score + 0.30 * drift_score,
        2,
    )


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score based on how dramatically volume contracts first-half -> second-half."""
    info = _volume_halves(bars, c)
    first_v = info["first_half_avg"]
    last_v = info["second_half_avg"]
    if first_v <= 0:
        return 50.0
    ratio = last_v / first_v
    # 1.0 = 0, 0.75 = 0, 0.50 = 50, 0.30 = 100
    if ratio >= _MAX_VOL_LATTER_RATIO:
        return 0.0
    if ratio <= 0.30:
        return 100.0
    # Linear between 0.30 (100) and 0.75 (0)
    return round((_MAX_VOL_LATTER_RATIO - ratio) / (_MAX_VOL_LATTER_RATIO - 0.30) * 100.0, 2)


def _score_context(context: dict) -> float:
    score = 30.0
    if context.get("trend_stage") == 2:
        score += 25
    if context.get("ma_alignment") == "stacked_bullish":
        score += 20
    if context.get("rs_trend") == "up":
        score += 15
    if context.get("volume_signature") == "contracting":
        score += 10
    # DCR integration (Phase 7.5) — bullish: accumulation = tailwind.
    score += _dcr_score_adjustment(context)
    return min(100.0, max(0.0, score))
# Custom variant - does not match shared narrative_helpers


def _dcr_score_adjustment(context: dict) -> float:
    """Return the DCR-derived score adjustment for a bullish pattern."""
    dcr_sig = context.get("dcr_signature")
    recent_dcr = context.get("recent_dcr_avg", 0.5) or 0.5
    if dcr_sig == "accumulation" and recent_dcr >= 0.65:
        return 12.0   # institutional buying into close
    if dcr_sig == "distribution":
        return -8.0   # sellers active — bullish pattern faces headwind
    return 0.0

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


def _base_quality_zone(bars_count: int) -> str:
    if 20 <= bars_count <= 25:
        return "textbook sweet-spot"
    if bars_count < 20:
        return "lower end of the acceptable"
    return "longer end of the acceptable"


def _regime_context_sentence(context: dict, c: dict) -> str:
    """One-sentence regime/context connector for the narrative."""
    regime = context.get("regime", "current")
    stage = context.get("trend_stage", 0)
    advance_pct = c["prior_advance_pct"] * 100.0
    if stage == 2 and advance_pct >= 40.0:
        return (f"Within the {regime} regime, a Stage 2 flat base after a {advance_pct:.1f}% "
                f"advance is exactly the structural profile O'Neil's CAN SLIM data shows "
                f"produces the strongest follow-through")
    if stage == 2:
        return (f"Within the {regime} regime, the Stage 2 backdrop is the most favorable "
                f"possible context for a flat base to convert — uptrending stocks digesting "
                f"gains are where this pattern compounds best")
    return (f"The {regime} regime context is mixed and position sizing should reflect "
            f"the higher dispersion of outcomes for flat bases outside Stage 2 conditions")


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    base_start_bar = bars[c["base_start"]]
    base_end_bar = bars[c["base_end"]]
    last_bar = bars[-1]

    base_high = c["base_high"]
    base_low = c["base_low"]
    base_mid = c["base_mid"]
    base_depth = c["base_depth"]
    base_depth_pct = base_depth * 100.0
    base_bars = c["base_bars"]
    base_slope_pct_per_bar = c["base_slope_pct_per_bar"]

    prior_advance_pct = c["prior_advance_pct"]
    prior_advance_pct_pct = prior_advance_pct * 100.0
    prior_advance_bars = c["prior_advance_bars"]
    prior_advance_height = c["prior_advance_height"]

    # Volume halves
    vol_info = _volume_halves(bars, c)
    first_half_vol_avg = vol_info["first_half_avg"]
    second_half_vol_avg = vol_info["second_half_avg"]
    if first_half_vol_avg > 0:
        vol_contraction_ratio = second_half_vol_avg / first_half_vol_avg
        vol_contraction_pct = (1.0 - vol_contraction_ratio) * 100.0
    else:
        vol_contraction_ratio = 1.0
        vol_contraction_pct = 0.0

    # Levels
    entry = round(base_high * 1.001, 2)
    stop = round(base_low * 0.985, 2)
    # Target: 50% of prior advance height projected from pivot, capped at +20% from pivot
    half_advance_projection = prior_advance_height * 0.5
    cap_projection = base_high * 0.20
    projection = min(half_advance_projection, cap_projection)
    target = round(base_high + projection, 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0

    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    # Geometry anchors: prior_advance_start (low), base_start_high, base_end_high, base_end_low
    anchors = [
        {"t": int(bars[c["prior_advance_low_idx"]]["t"]),
         "price": float(c["prior_advance_low_price"])},
        {"t": int(base_start_bar["t"]), "price": float(base_high)},
        {"t": int(base_end_bar["t"]), "price": float(base_high)},
        {"t": int(base_end_bar["t"]), "price": float(base_low)},
    ]

    now = int(time.time())

    pivot_ts = [
        int(bars[c["prior_advance_low_idx"]]["t"]),
        int(bars[c["prior_advance_high_idx"]]["t"]),
        int(base_start_bar["t"]),
        int(base_end_bar["t"]),
        int(last_bar["t"]),
    ]

    # ---- Narrative composition — RICH, paragraph-length, real values woven in ----
    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime_sentence = _regime_context_sentence(context, c)
    regime = context.get("regime", "current")
    quality_zone = _base_quality_zone(base_bars)

    sym_token = "the stock"

    headline = (
        f"Flat Base — {base_bars}-bar consolidation of {base_depth_pct:.1f}% depth on "
        f"contracting volume, following {prior_advance_pct_pct:.1f}% prior advance. "
        f"Pivot ${base_high:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Flat Base, codified by William O'Neil at Investor's Business Daily and "
        f"refined for swing trading by Pradeep Bonde and Bauer at Stockbee, is the chart "
        f"pattern that says 'pause to digest, not reverse.' After a stock has demonstrated "
        f"institutional sponsorship via a strong prior advance — here {prior_advance_pct_pct:.1f}% "
        f"over the {prior_advance_bars} bars before the base — price enters a tight horizontal "
        f"consolidation where supply and demand reach temporary equilibrium. The {base_bars}-bar "
        f"base of {base_depth_pct:.1f}% depth here (high ${base_high:.2f}, low ${base_low:.2f}) "
        f"is precisely the structure O'Neil's research found preceded the great winners — "
        f"CAN SLIM data shows flat bases with depths inside the 12% threshold produce "
        f"materially higher follow-through than deeper, looser bases. What distinguishes a "
        f"flat base from a stage-3 distribution top is the prior advance trajectory: stocks "
        f"pull back, not roll over, and the moving-average stack stays bullishly aligned. "
        f"Volume contraction through the base is the supply-absorbed signal — first half of "
        f"the base averaged {first_half_vol_avg:,.0f} shares per bar, the second half "
        f"averaged {second_half_vol_avg:,.0f}, a {vol_contraction_pct:.1f}% decline that tells "
        f"you patient buyers are mopping up shares while overhead supply quietly exhausts itself. "
        f"Kristjan Kullamägi has built a substantial portion of his playbook around what he "
        f"calls 'the 4-week-tight base' — a refinement of O'Neil's flat-base read where the "
        f"final 4 weeks of consolidation show closes inside a 3-4% range — and treats this "
        f"as his core trigger structure for momentum entries. The 4-week-tight is functionally "
        f"the late-cycle tight phase of a longer flat base, and identifying it inside a "
        f"longer O'Neil-style base is one of the highest-edge structural reads in modern "
        f"growth-stock trading."
    )

    why_it_matters = (
        f"This flat base is forming in {stage_phrase} with {ma_phrase} alignment and "
        f"{rs_phrase} relative strength versus the broader market — the textbook context "
        f"O'Neil's CAN SLIM framework demands before a flat-base trigger is worth acting on. "
        f"The {prior_advance_pct_pct:.1f}% advance over {prior_advance_bars} bars qualifies "
        f"this as an institutional-sponsorship name; flat bases on stocks that gained 25%+ "
        f"before basing produce 18-30% follow-through with high frequency in O'Neil's "
        f"historical studies. The base's {base_depth_pct:.1f}% depth is comfortably inside "
        f"the 12% maximum, and the {base_bars}-bar duration sits in the {quality_zone} "
        f"range (15-35 bars is optimal; shorter is whipsaw-prone, longer is fatigue-prone "
        f"and frequently breaks down rather than out). Volume contraction of "
        f"{vol_contraction_pct:.1f}% from base first-half ({first_half_vol_avg:,.0f}) to "
        f"second-half ({second_half_vol_avg:,.0f}) is the institutional-absorption tell — "
        f"supply is being mopped up near the base low at ${base_low:.2f}, and the next "
        f"round of demand will trigger above the pivot at ${base_high:.2f}. {regime_sentence}. "
        f"The combined picture — prior trend, base flatness, drying volume, supportive "
        f"context — is the four-factor confirmation O'Neil teaches as the precondition for "
        f"a high-edge flat-base trade. "
        f"{dcr_phrase(context.get('dcr_signature'), context.get('recent_dcr_avg'))}. "
        f"{dcr_interpretation(context, 'bullish')}"
    )

    what_to_watch_for = (
        f"The trigger is a daily close above ${entry:.2f} (the {base_bars}-bar base high "
        f"of ${base_high:.2f} plus a small confirmation buffer) on volume of at least 1.5x "
        f"the 20-bar average — flat-base breakouts demand institutional volume confirmation, "
        f"not retail momentum, to be worth entering. The ideal trigger bar closes in the "
        f"upper half of its range, with the next 1-3 bars holding the breakout without "
        f"re-entering the base range between ${base_low:.2f} and ${base_high:.2f}. Measured "
        f"target is ${target:.2f}, derived from 50% of the prior advance height "
        f"(${prior_advance_height:.2f}) projected from the pivot, with a hard cap at +20% "
        f"above the pivot for risk discipline — O'Neil's research shows the first 20% of a "
        f"flat-base breakout is statistically the highest-probability segment. Trail stops "
        f"below each new swing low as price advances; flat-base breakouts frequently retest "
        f"the pivot once before extending, so the initial stop should be wide enough to "
        f"survive that retest without being shaken. Position size should reflect the "
        f"{stop_distance_pct:.1f}% stop distance — risking 1% of account on the trade "
        f"implies roughly {(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% "
        f"of equity allocated to the position, which is comfortably sized for a "
        f"medium-volatility continuation setup."
    )

    failure_signal = (
        f"The flat base is invalidated when price closes below the base low at "
        f"${base_low:.2f} (stop set at ${stop:.2f}, 1.5% below the structural low) — that "
        f"signals the base has failed to hold institutional support and likely re-tests the "
        f"prior swing low near ${c['prior_advance_low_price']:.2f}, which would represent a "
        f"deeper structural breakdown rather than a routine base failure. A subtler failure "
        f"mode: the breakout above ${base_high:.2f} occurs on weak or declining volume and "
        f"the next 2-3 bars fade back into the base range without further advance. This "
        f"'failed breakout' is one of O'Neil's clearest sell signals; the breakout's "
        f"inability to hold means the prior accumulation may have actually been distribution "
        f"in disguise, and the stock is likely to break the base low within 5-10 bars. "
        f"Position sizing must reflect the {stop_distance_pct:.1f}% stop distance — a 1% "
        f"account risk implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% of equity, "
        f"and stop discipline is non-negotiable on flat-base trades because the pattern's "
        f"edge depends on the breakout working within 1-5 bars. If the trade hasn't started "
        f"working in that window, the institutional buying that the flat base supposedly "
        f"signaled was not there, and the right move is to exit at the stop and reassess "
        f"rather than rationalize a wider tolerance."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Flat Base Breakout",
        "category": "uct",
        "direction": "bullish",
        "start_t": int(bars[c["prior_advance_low_idx"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "rectangle",
            "anchors": anchors,
            "extras": {
                "base_bars": int(base_bars),
                "base_depth_pct": round(base_depth_pct, 2),
                "base_high": round(base_high, 2),
                "base_low": round(base_low, 2),
                "base_mid": round(base_mid, 2),
                "prior_advance_pct": round(prior_advance_pct_pct, 2),
                "prior_advance_bars": int(prior_advance_bars),
                "prior_advance_height": round(prior_advance_height, 2),
                "volume_contraction_pct": round(vol_contraction_pct, 2),
                "first_half_vol_avg": round(first_half_vol_avg, 0),
                "second_half_vol_avg": round(second_half_vol_avg, 0),
                "base_slope_pct_per_bar": round(base_slope_pct_per_bar * 100.0, 4),
                "dcr_score_adj": round(_dcr_score_adjustment(context), 2),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "base_low_minus_1.5pct",
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


register(_PATTERN_ID, detect_flat_base)
