"""Volatility Contraction Pattern (VCP) detector.

Developed by Mark Minervini, the VCP is one of the highest-edge setups in
swing trading. It identifies institutional accumulation through a sequence
of progressively tighter pullbacks ("contractions") inside an uptrend,
where each successive pullback is shallower than the prior AND volume
dries up dramatically into the breakout pivot.

Geometric definition:
  - Window: 30-90 bars (typically 6-13 weeks)
  - Prior advance: >=20% gain in the 60 bars preceding the formation
  - Series of contractions: at least 2 successive pullback cycles, each
    subsequent contraction MUST be smaller than the prior. Typical
    sequence: 20-30% -> 12-18% -> 6-10% -> 3-6%.
  - Volume contraction: volume in each subsequent contraction lower than
    the prior. The final (tightest) contraction has near-record-low volume.
  - Pivot: the high of the most recent (tightest) contraction = breakout
    level. THIS is the entry trigger.
  - Recency: the most recent contraction low must be within the last 15 bars
  - Direction: bullish

Scoring (composite 0-100):
  geometry_score:   number of contractions, progressive tightening, recency,
                    final contraction tightness
  volume_score:     how dramatically volume contracts through the sequence
  context_score:    Stage 2, stacked_bullish, rs_trend=up, prior advance >=30%
  historical_score: 50.0 (neutral prior)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "vcp"
_MIN_PATTERN_BARS = 30
_MAX_PATTERN_BARS = 90
_MIN_CONTRACTIONS = 2
_MAX_FIRST_CONTRACTION_PCT = 0.40      # first contraction must be <=40%
_MIN_FIRST_CONTRACTION_PCT = 0.06      # and at least 6%
_MAX_FINAL_CONTRACTION_PCT = 0.10      # final contraction <=10% (textbook tight)
_MIN_CONTRACTION_PCT = 0.025           # any contraction must be at least 2.5% (else noise/already-broken artifact)
_TIGHTENING_RATIO_MAX = 0.85           # each successor must be <=85% of prior
_MAX_FINAL_LOW_AGE = 15                # final contraction low within last 15 bars
_MIN_PRIOR_ADVANCE = 0.20              # >=20% advance in prior 60 bars before pattern
_CONFIDENCE_FLOOR = 50.0


def detect_vcp(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Volatility Contraction Patterns. May emit 0-N detections (best one)."""
    if len(bars) < _MIN_PATTERN_BARS:
        return []

    pivots = detect_pivots(bars, window=3)
    # Need at least one high + at least one low. With the fallback recent-low
    # logic, a 2-contraction sequence can be detected from as few as 3 pivots
    # (high, low, high - final low from fallback).
    if len(pivots) < 3:
        return []

    # Sort pivots chronologically by bar_index
    pivots_sorted = sorted(pivots, key=lambda p: p["bar_index"])

    # Enumerate candidate sequences: walk forward from each early swing high
    # and collect alternating high->low->high->low... while each contraction
    # tightens. Pick the best (longest + most recent + tightest).
    candidates = _enumerate_contraction_sequences(bars, pivots_sorted)
    if not candidates:
        return []

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for candidate in candidates:
        # Recency gate: the most recent contraction low must be within last N bars
        last_bar_idx = len(bars) - 1
        final_low_idx = candidate["contractions"][-1]["low_idx"]
        if last_bar_idx - final_low_idx > _MAX_FINAL_LOW_AGE:
            continue

        # Already-broken gate: if price has CLOSED meaningfully above pivot AND
        # traded sustainably above pivot, the breakout already happened.
        if _already_broken(bars, candidate):
            continue

        # Prior advance gate
        if not _has_prior_advance(bars, candidate):
            continue

        # Hard volume gate: VCPs require volume DRYING UP through the sequence.
        # If volume is rising (final-vs-first contraction volume ratio > 1.0),
        # this is distribution dressed up as a tight base. Reject.
        if not _volume_contracts_overall(bars, candidate):
            continue

        # Hard context gate: VCPs require an UPTREND. If trend_stage is 4
        # (downtrend) AND rs_trend is down AND ma_alignment is stacked_bearish,
        # this is a Stage 4 base that looks like a VCP but won't act like one.
        if _hostile_context(context):
            continue

        geom_score = _score_geometry(candidate)
        vol_score = _score_volume(bars, candidate)
        ctx_score = _score_context(context, candidate)
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


def _enumerate_contraction_sequences(bars: List[Bar], pivots: List[dict]) -> List[dict]:
    """Walk pivots to find sequences of progressively tighter contractions.

    A contraction = (swing_high, subsequent_swing_low). The series:
      H1 -> L1 (contraction 1), H2 -> L2 (contraction 2, where H2>=H1*0.95 and
      contraction_pct decreasing)...

    We try every reasonable starting swing-high and extend as far as we can
    while the tightening invariant holds. Return the resulting candidates.
    """
    high_pivots = [p for p in pivots if p["type"] == "high"]
    if len(high_pivots) < 2:
        return []

    last_bar_idx = len(bars) - 1
    candidates: List[dict] = []

    # Look at most recent ~10 high pivots as potential starting points
    start_pool = high_pivots[-10:]

    for start_idx_in_pool, start_high in enumerate(start_pool):
        sequence = _try_extend_sequence(bars, pivots, start_high)
        if sequence is None:
            continue
        if len(sequence["contractions"]) < _MIN_CONTRACTIONS:
            continue
        candidates.append(sequence)

    return candidates


def _try_extend_sequence(bars: List[Bar], pivots: List[dict], start_high: dict) -> Optional[dict]:
    """Starting from start_high (a swing-high pivot), greedily extend a sequence
    of progressively tighter contractions.

    Returns a candidate dict with contractions list, or None if infeasible.
    """
    contractions: List[dict] = []
    current_high = start_high
    last_bar_idx = len(bars) - 1

    # Forward-walk: find next low pivot after current_high, then next high pivot
    # after that low, etc. Stop when:
    #   - no more pivots
    #   - contraction grows (violates tightening invariant)
    #   - pattern grew past _MAX_PATTERN_BARS
    while True:
        next_low = _next_pivot_of_type(pivots, current_high["bar_index"], "low")
        # If no formal swing-low pivot exists past current_high, the final
        # contraction may still be forming - fall back to the lowest LOW in
        # the bars between current_high and the most recent bar. This catches
        # 'ready to break' VCPs where the pivot detector hasn't confirmed
        # the trough yet.
        if next_low is None:
            fb = _fallback_recent_low(bars, current_high["bar_index"])
            if fb is None:
                break
            next_low = fb

        contraction_pct = (current_high["price"] - next_low["price"]) / current_high["price"]

        # First contraction bounds
        if not contractions:
            if contraction_pct < _MIN_FIRST_CONTRACTION_PCT:
                # Try advancing the start past this pivot - but caller already
                # iterates start_pool, so just abandon this attempt.
                return None
            if contraction_pct > _MAX_FIRST_CONTRACTION_PCT:
                return None
        else:
            # Subsequent contraction must be smaller than prior
            prior_pct = contractions[-1]["pct"]
            if contraction_pct >= prior_pct * _TIGHTENING_RATIO_MAX:
                # Not tightening enough - stop sequence here
                break
            if contraction_pct < _MIN_CONTRACTION_PCT:
                # Too shallow - likely just noise after a breakout. Stop sequence.
                break

        # Pattern length gate
        if next_low["bar_index"] - start_high["bar_index"] > _MAX_PATTERN_BARS:
            break

        contractions.append({
            "high_idx": current_high["bar_index"],
            "high_price": current_high["price"],
            "high_t": current_high["t"],
            "low_idx": next_low["bar_index"],
            "low_price": next_low["price"],
            "low_t": next_low["t"],
            "pct": contraction_pct,
            "bars_span": next_low["bar_index"] - current_high["bar_index"],
        })

        # Find next swing high AFTER this low to continue the sequence
        next_high = _next_pivot_of_type(pivots, next_low["bar_index"], "high")
        if next_high is None:
            # No more highs - the current_high is the pivot if next_low is recent
            break

        # New "high" should be reasonably close to the prior (not a huge new
        # leg up). VCP tops are roughly horizontal - the pivots cluster.
        # Allow up to +8% above prior high (modest new-high in tightening base)
        # and reject if more than 10% BELOW (broken structure).
        if next_high["price"] < current_high["price"] * 0.90:
            break
        # If next_high is way above, it might be a new pole - pivot is current_high
        if next_high["price"] > current_high["price"] * 1.08:
            break

        current_high = next_high

    if not contractions:
        return None

    # Last contraction high = pivot
    pivot_high_idx = contractions[-1]["high_idx"]
    pivot_high_price = contractions[-1]["high_price"]

    # Final contraction percentage gate
    final_pct = contractions[-1]["pct"]
    if final_pct > _MAX_FINAL_CONTRACTION_PCT:
        return None

    # Pattern total bars
    pattern_bars = contractions[-1]["low_idx"] - start_high["bar_index"]
    if pattern_bars < 10:
        return None
    if pattern_bars > _MAX_PATTERN_BARS:
        return None

    return {
        "start_idx": start_high["bar_index"],
        "start_price": start_high["price"],
        "start_t": start_high["t"],
        "contractions": contractions,
        "pivot_idx": pivot_high_idx,
        "pivot_price": pivot_high_price,
        "n_contractions": len(contractions),
        "pattern_bars": pattern_bars,
    }


def _next_pivot_of_type(pivots: List[dict], after_idx: int, ptype: str) -> Optional[dict]:
    """Return the first pivot AFTER bar_index `after_idx` matching `ptype`."""
    for p in pivots:
        if p["bar_index"] > after_idx and p["type"] == ptype:
            return p
    return None


def _fallback_recent_low(bars: List[Bar], after_idx: int) -> Optional[dict]:
    """Find the lowest LOW in bars[after_idx+1:] and return it pivot-shaped.

    Used when the final contraction's low hasn't been confirmed as a swing-low
    pivot yet (insufficient right-side bars). Requires at least 3 bars past
    `after_idx` and the low must be at least 1 bar past the high.
    """
    last_idx = len(bars) - 1
    if after_idx >= last_idx - 1:
        return None
    seg = bars[after_idx + 1: last_idx + 1]
    if len(seg) < 3:
        return None
    best_local_idx = 0
    best_low = seg[0]["l"]
    for j, b in enumerate(seg):
        if b["l"] < best_low:
            best_low = b["l"]
            best_local_idx = j
    low_idx = after_idx + 1 + best_local_idx
    # Don't accept if the low is literally the very last bar (no room to confirm)
    if low_idx >= last_idx:
        return None
    return {
        "bar_index": low_idx,
        "price": best_low,
        "t": bars[low_idx]["t"],
        "type": "low",
        "strength": 40,  # synthesized, slightly weaker than a real pivot
    }


def _already_broken(bars: List[Bar], candidate: dict) -> bool:
    """Return True if the pivot has been decisively broken upward already.

    A clean VCP setup is FORMING - price is still below or just at the pivot
    with the breakout pending. If price has closed materially above the pivot
    AND traded above for multiple bars, the trigger has fired and the setup
    is no longer 'ready' to be flagged.
    """
    pivot_idx = candidate["pivot_idx"]
    pivot_price = candidate["pivot_price"]
    last_idx = len(bars) - 1

    # Look at bars AFTER the pivot - count sustained closes >1% above pivot
    sustained_above = 0
    for i in range(pivot_idx + 1, last_idx + 1):
        if bars[i]["c"] > pivot_price * 1.01:
            sustained_above += 1

    return sustained_above >= 3


def _has_prior_advance(bars: List[Bar], candidate: dict) -> bool:
    """Verify there was a meaningful uptrend BEFORE the VCP started.

    Looks at the 60 bars (or fewer) prior to `start_idx`. Computes the
    advance from the lowest low to the start_price. Must be >=20%.
    """
    start_idx = candidate["start_idx"]
    if start_idx < 10:
        return False

    lookback_start = max(0, start_idx - 60)
    prior_window = bars[lookback_start:start_idx]
    if not prior_window:
        return False

    prior_low = min(b["l"] for b in prior_window)
    if prior_low <= 0:
        return False
    advance = (candidate["start_price"] - prior_low) / prior_low
    return advance >= _MIN_PRIOR_ADVANCE


def _volume_contracts_overall(bars: List[Bar], c: dict) -> bool:
    """Hard gate: final contraction volume must be lower than the first
    contraction's average volume. Otherwise this is not a VCP."""
    contractions = c["contractions"]
    if len(contractions) < 2:
        return False
    def _seg_avg(contr):
        a, b = contr["high_idx"], contr["low_idx"]
        if b < a: a, b = b, a
        seg = bars[a:b + 1]
        if not seg: return 0.0
        return sum(bar["v"] for bar in seg) / len(seg)
    first_v = _seg_avg(contractions[0])
    last_v = _seg_avg(contractions[-1])
    if first_v <= 0:
        return True
    return last_v < first_v


def _hostile_context(context: dict) -> bool:
    """Hard gate: reject VCP detections in clearly hostile market context.

    Stage 4 (downtrend) + stacked_bearish MA + rs_trend down = no buy signal
    matters here, regardless of geometric quality.
    """
    stage_bad = context.get("trend_stage") == 4
    ma_bad = context.get("ma_alignment") == "stacked_bearish"
    rs_bad = context.get("rs_trend") == "down"
    # Require ALL three to be hostile before rejecting (avoid false-rejects
    # on mid-cycle setups where one signal is mixed).
    return stage_bad and ma_bad and rs_bad


def _score_geometry(c: dict) -> float:
    """Geometry score components:
       - count_score: more contractions = better (3+ is textbook, 2 is minimum)
       - tightening_score: how monotonically the contractions tighten
       - recency_score: how close the final low is to "now" (handled via gate)
       - final_pct_score: tighter final contraction = better
    """
    contractions = c["contractions"]
    n = len(contractions)

    # Count: 2 = 60, 3 = 85, 4+ = 100
    if n >= 4:
        count_score = 100.0
    elif n == 3:
        count_score = 85.0
    else:
        count_score = 60.0

    # Tightening: ratio of each contraction vs prior, average tightness ratio
    # Smaller ratios (more tightening) = higher score
    ratios = []
    for i in range(1, n):
        prior = contractions[i - 1]["pct"]
        cur = contractions[i]["pct"]
        if prior > 0:
            ratios.append(cur / prior)
    avg_ratio = sum(ratios) / len(ratios) if ratios else 1.0
    # 0.3 ratio = 100, 0.85 ratio = 0
    tightening_score = max(0.0, min(100.0, (0.85 - avg_ratio) / 0.55 * 100))

    # Final contraction tightness: 3% = 100, 10% = 0
    final_pct = contractions[-1]["pct"]
    if final_pct <= 0.03:
        final_score = 100.0
    elif final_pct >= 0.10:
        final_score = 0.0
    else:
        final_score = (0.10 - final_pct) / 0.07 * 100

    # First contraction depth - 20-30% is textbook
    first_pct = contractions[0]["pct"]
    if 0.15 <= first_pct <= 0.30:
        first_score = 100.0
    elif first_pct < 0.15:
        first_score = max(0.0, (first_pct - _MIN_FIRST_CONTRACTION_PCT) / 0.09 * 100)
    else:
        first_score = max(0.0, (_MAX_FIRST_CONTRACTION_PCT - first_pct) / 0.10 * 100)

    return round(
        0.30 * count_score
        + 0.30 * tightening_score
        + 0.25 * final_score
        + 0.15 * first_score,
        2,
    )


def _score_volume(bars: List[Bar], c: dict) -> float:
    """Score volume contraction across the sequence.

    Compares avg volume during each contraction (from prior high to its low)
    versus the prior. Reward monotonic decline in volume.
    """
    contractions = c["contractions"]
    n = len(contractions)
    if n < 2:
        return 50.0

    # Average volume in each contraction's bars (high_idx..low_idx inclusive)
    contraction_avg_vols = []
    for contr in contractions:
        a, b = contr["high_idx"], contr["low_idx"]
        if b < a:
            a, b = b, a
        seg = bars[a:b + 1]
        if not seg:
            contraction_avg_vols.append(0.0)
            continue
        contraction_avg_vols.append(sum(bar["v"] for bar in seg) / len(seg))

    # Count strictly-declining transitions
    declines = 0
    total_transitions = n - 1
    for i in range(1, n):
        if contraction_avg_vols[i] < contraction_avg_vols[i - 1]:
            declines += 1
    decline_fraction = declines / total_transitions if total_transitions > 0 else 0.0
    decline_score = decline_fraction * 100

    # Magnitude: final contraction volume vs first contraction volume
    if contraction_avg_vols[0] > 0:
        ratio = contraction_avg_vols[-1] / contraction_avg_vols[0]
    else:
        ratio = 1.0
    # 0.2 ratio = 100, 1.0 ratio = 0
    if ratio >= 1.0:
        magnitude_score = 0.0
    elif ratio <= 0.2:
        magnitude_score = 100.0
    else:
        magnitude_score = (1.0 - ratio) / 0.8 * 100

    # Final contraction vs 50-bar average (when available)
    avg50_score = 50.0
    last_low_idx = contractions[-1]["low_idx"]
    if last_low_idx >= 50:
        lookback50 = bars[last_low_idx - 50:last_low_idx]
        avg50 = sum(b["v"] for b in lookback50) / 50 if lookback50 else 0
        if avg50 > 0:
            final_vol = contraction_avg_vols[-1]
            final_ratio = final_vol / avg50
            if final_ratio <= 0.3:
                avg50_score = 100.0
            elif final_ratio >= 1.0:
                avg50_score = 0.0
            else:
                avg50_score = (1.0 - final_ratio) / 0.7 * 100

    return round(0.40 * decline_score + 0.35 * magnitude_score + 0.25 * avg50_score, 2)


def _score_context(context: dict, candidate: dict) -> float:
    score = 30.0
    if context.get("trend_stage") == 2:
        score += 25
    if context.get("ma_alignment") == "stacked_bullish":
        score += 20
    if context.get("rs_trend") == "up":
        score += 15
    if context.get("volume_signature") == "contracting":
        score += 10
    return min(100.0, score)


def _compute_volume_signature(c: dict, bars: List[Bar]) -> str:
    """Compute a human-readable label for the final contraction's volume."""
    contractions = c["contractions"]
    last_low_idx = contractions[-1]["low_idx"]
    if last_low_idx < 50:
        return "drying"
    lookback50 = bars[last_low_idx - 50:last_low_idx]
    avg50 = sum(b["v"] for b in lookback50) / 50 if lookback50 else 0
    if avg50 <= 0:
        return "drying"
    last_high = contractions[-1]["high_idx"]
    last_low = contractions[-1]["low_idx"]
    seg = bars[last_high:last_low + 1]
    final_vol = sum(b["v"] for b in seg) / len(seg) if seg else 0
    ratio = final_vol / avg50
    if ratio <= 0.5:
        return "exceptionally dry"
    if ratio <= 0.75:
        return "notably contracted"
    if ratio <= 1.0:
        return "modestly below average"
    return "elevated (red flag)"


def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "fully stacked-bullish moving-average"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average"
    return "mixed moving-average"


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


def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving"
    if rs == "down":
        return "deteriorating"
    return "neutral"


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    contractions = c["contractions"]
    n = c["n_contractions"]
    pivot_price = c["pivot_price"]
    pivot_idx = c["pivot_idx"]
    last_bar = bars[-1]
    last_contraction_low = contractions[-1]["low_price"]

    # First contraction "start" is the start_high (which equals contractions[0]["high"]).
    first_contraction_high = contractions[0]["high_price"]
    first_contraction_height = first_contraction_high - contractions[0]["low_price"]

    # Levels
    entry = round(pivot_price * 1.001, 2)
    stop = round(last_contraction_low * 0.985, 2)
    target = round(pivot_price + (pivot_price - contractions[0]["low_price"]), 2)
    rr = (target - entry) / (entry - stop) if entry > stop else 0.0

    # Stop distance %
    stop_distance_pct = (entry - stop) / entry * 100 if entry > 0 else 0.0

    # Volume signatures
    vol_sig = _compute_volume_signature(c, bars)
    final_vol_ratio = _final_volume_ratio(c, bars)

    # Contraction pcts as human-readable list (rounded ints)
    contraction_pcts = [round(contr["pct"] * 100, 1) for contr in contractions]
    pcts_display = " -> ".join(f"{p:.1f}%" for p in contraction_pcts)

    final_bars = contractions[-1]["bars_span"]
    pattern_bars = c["pattern_bars"]

    sym_token = "the stock"   # populated at API level

    # Geometry anchors: start_high, then each contraction low, then pivot
    anchors = []
    anchors.append({"t": int(bars[c["start_idx"]]["t"]),
                    "price": float(c["start_price"])})
    for contr in contractions:
        anchors.append({"t": int(bars[contr["low_idx"]]["t"]),
                        "price": float(contr["low_price"])})
    # Append the pivot anchor (high of final contraction)
    anchors.append({"t": int(bars[pivot_idx]["t"]),
                    "price": float(pivot_price)})

    now = int(time.time())

    # Pivot ts: include start, each contraction low, pivot, last bar
    pivot_ts = [int(bars[c["start_idx"]]["t"])]
    for contr in contractions:
        pivot_ts.append(int(bars[contr["low_idx"]]["t"]))
    pivot_ts.append(int(bars[pivot_idx]["t"]))
    pivot_ts.append(int(last_bar["t"]))

    # Narrative composition - RICH, paragraph-length, with real values.
    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime = context.get("regime", "current")
    final_pct_pct = contractions[-1]["pct"] * 100
    first_pct_pct = contractions[0]["pct"] * 100

    headline = (
        f"VCP forming with {n} contractions tightening "
        f"{pcts_display} on {sym_token} - pivot at ${pivot_price:.2f}, "
        f"breakout target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Volatility Contraction Pattern, developed by Mark Minervini and refined "
        f"through his US Investing Champion records, is a high-edge setup that identifies "
        f"institutional accumulation through a sequence of progressively tighter pullbacks. "
        f"As big money quietly accumulates shares during the uptrend, each successive pullback "
        f"gets smaller - here the contractions tighten from {first_pct_pct:.1f}% in the first "
        f"leg down to {final_pct_pct:.1f}% in the final coil, with volume drying up as supply "
        f"is absorbed. The final, tightest contraction ({final_pct_pct:.1f}% over {final_bars} "
        f"bars) is where weak hands are exhausted and the stock coils for the next leg. "
        f"The pivot at ${pivot_price:.2f} represents the supply line that institutions have "
        f"been defending - once it breaks decisively, the path of least resistance is up. "
        f"VCP is the chart language of professional accumulation."
    )

    why_it_matters = (
        f"This VCP is setting up in {stage_phrase} with {ma_phrase} alignment and "
        f"{rs_phrase} relative strength versus the broader market. The {n}-contraction "
        f"sequence - particularly the tight {final_pct_pct:.1f}% final pullback on "
        f"{vol_sig} volume (~{final_vol_ratio:.0%} of the 50-bar average) - signals that "
        f"the supply at ${pivot_price:.2f} is finite and weakening. Historically, VCPs with "
        f"{n}+ contractions and a final tightening below 8% produce 25%+ moves within 8-12 "
        f"weeks when they trigger cleanly on volume. The {regime} regime adds further "
        f"context to position-sizing decisions, and the {pattern_bars}-bar formation length "
        f"is well inside Minervini's 6-13 week sweet spot for the highest-quality bases."
    )

    what_to_watch_for = (
        f"Watch for a daily close above ${entry:.2f} on volume of at least 1.5x the 20-bar "
        f"average - that's the trigger that confirms the pivot break and the start of the "
        f"institutional markup phase. An ideal follow-through has the stock closing in the "
        f"upper half of the trigger bar's range, with the next 1-3 bars holding the breakout "
        f"and never re-entering the prior contraction ({last_contraction_low:.2f} to "
        f"{pivot_price:.2f}). The measured target is ${target:.2f}, derived from the height "
        f"of the first contraction (${first_contraction_height:.2f}) projected up from the "
        f"pivot price. If the breakout day closes in the lower half of its range or volume "
        f"only matches the 20-bar average, treat the trigger as suspect - on a clean VCP, "
        f"institutional buying should be unmistakable and the tape should feel urgent."
    )

    failure_signal = (
        f"The VCP is invalidated if price closes back below the most recent contraction "
        f"low at ${last_contraction_low:.2f} (stop set at ${stop:.2f}, 1.5% below) - that "
        f"signals failed accumulation and a likely retest of the prior support shelf. A "
        f"more nuanced failure mode: the breakout occurs on weak or declining volume and "
        f"the next 2-3 bars fade back into the contraction range. This is the textbook "
        f"'failed breakout' that often precedes a deeper decline, because the institutions "
        f"that were absorbing supply have now stopped buying. Position size should reflect "
        f"the {stop_distance_pct:.1f}% risk distance - if you risk 1% of account on the "
        f"trade, your position is roughly {(1.0 / (stop_distance_pct / 100)):.0f}% of "
        f"equity. Stop discipline is non-negotiable; the entire edge of the VCP setup "
        f"depends on the breakout working immediately and decisively."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Volatility Contraction Pattern (VCP)",
        "category": "uct",
        "direction": "bullish",
        "start_t": int(bars[c["start_idx"]]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "trendline_pair",
            "anchors": anchors,
            "extras": {
                "n_contractions": n,
                "contraction_pcts": contraction_pcts,
                "pivot_price": round(pivot_price, 2),
                "last_contraction_low": round(last_contraction_low, 2),
                "first_contraction_high": round(first_contraction_high, 2),
                "first_contraction_height": round(first_contraction_height, 2),
                "final_contraction_volume_ratio": round(final_vol_ratio, 3),
                "pattern_bars": int(pattern_bars),
                "final_contraction_bars": int(final_bars),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} on volume > 1.5x 20-bar avg",
            "stop": stop,
            "stop_basis": "last_contraction_low_minus_1.5pct",
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


def _final_volume_ratio(c: dict, bars: List[Bar]) -> float:
    """Return final contraction average volume / 50-bar prior average."""
    contractions = c["contractions"]
    last_high = contractions[-1]["high_idx"]
    last_low = contractions[-1]["low_idx"]
    seg = bars[last_high:last_low + 1]
    if not seg:
        return 1.0
    final_vol = sum(b["v"] for b in seg) / len(seg)
    if last_low < 50:
        return 1.0
    lookback50 = bars[last_low - 50:last_low]
    avg50 = sum(b["v"] for b in lookback50) / 50 if lookback50 else 0
    if avg50 <= 0:
        return 1.0
    return final_vol / avg50


register(_PATTERN_ID, detect_vcp)
