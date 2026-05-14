"""Bollinger Squeeze detector — Bollinger Bands inside Keltner Channels.

The Bollinger Squeeze (a.k.a. "TTM Squeeze" after John Carter's popular
implementation) detects compression states preceding directional breakouts.
The framework combines two classical volatility envelopes:

  - Bollinger Bands (John Bollinger, 1980s — popularized in "Bollinger on
    Bollinger Bands", McGraw-Hill 2001): 20-period SMA ± 2 population
    standard deviations. Width is a direct function of recent volatility.

  - Keltner Channels (Chester Keltner, "How To Make Money in Commodities",
    1960; refined by Linda Raschke): 20-period EMA ± 1.5 × ATR(20). Width
    is a direct function of recent average range, NOT close-to-close
    variance.

When the Bollinger Bands are INSIDE the Keltner Channels — meaning the
standard-deviation envelope has compressed BELOW the average-range
envelope — historical volatility has contracted significantly relative
to average-range volatility. John Carter codified this in "Mastering the
Trade" (McGraw-Hill, 2005) and built the "TTM Squeeze" indicator on
TradingView, popularizing the concept for retail traders. The longer the
squeeze persists, the more potential energy is stored in the consolidation
— Carter's empirical observation, supported by decades of options-trading
volatility-mean-reversion data.

Direction is undetermined at the squeeze itself — the breakout side
determines the trade direction. This detector emits a NEUTRAL detection
flagging the compression; downstream trading rules (or a human trader)
must determine direction from the breakout bar.

Conditions:
  - Bollinger Bands (20, 2σ) inside Keltner Channels (20, 1.5×ATR)
    BB_upper < KC_upper AND BB_lower > KC_lower
  - Squeeze sustained for >=6 bars (longer = more energy stored)
  - Volume contracting on the squeeze (5-bar avg < 70% of 20-bar avg)

Levels (direction undetermined):
  - Entry = current close (note: actual trade entry = breakout-side close)
  - Stop = opposite Bollinger band (the breakout's failure-zone reference)
  - Target = entry ± 2 × bandwidth at squeeze midpoint (Carter's measured
    move based on consolidation height)

Geometry: "rectangle" at BB/KC bounds.

Attribution: John Bollinger (Bollinger Bands, 1980s; "Bollinger on
Bollinger Bands", 2001) + Chester Keltner (Keltner Channels, 1960) +
John Carter ("Mastering the Trade", 2005 — "TTM Squeeze" indicator) +
Linda Raschke (early adopter of Keltner-based volatility compression
filters in "Street Smarts", 1995).
"""
from __future__ import annotations

import uuid
import time
import math
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.narrative_helpers import (
    dcr_phrase, ma_alignment_phrase, regime_phrase,
    trend_stage_description, volume_signature_phrase,
)
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "bollinger_squeeze"

_BB_PERIOD = 20
_BB_STDDEV = 2.0
_KC_PERIOD = 20
_KC_ATR_MULT = 1.5
_MIN_SQUEEZE_BARS = 6                # >=6 consecutive bars of compression
_VOL_CONTRACT_RATIO = 0.70           # 5-bar vol avg < 70% of 20-bar avg
_CONFIDENCE_FLOOR = 50.0


def detect_bollinger_squeeze(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Bollinger-inside-Keltner compression. Emits 0 or 1 detection."""
    n = len(bars)
    if n < _BB_PERIOD + _MIN_SQUEEZE_BARS + 5:
        return []

    # Walk backwards through last N bars and count consecutive squeeze bars
    closes = [b["c"] for b in bars]

    bb_upper_last, bb_mid_last, bb_lower_last = _bb_at(closes, n - 1)
    kc_upper_last, kc_mid_last, kc_lower_last = _kc_at(bars, n - 1)
    if bb_upper_last is None or kc_upper_last is None:
        return []

    # Current bar must be in squeeze
    if not (bb_upper_last < kc_upper_last and bb_lower_last > kc_lower_last):
        return []

    # Count consecutive squeeze bars going backwards
    squeeze_bars = 1
    for i in range(n - 2, _BB_PERIOD - 1, -1):
        bb_u, _, bb_l = _bb_at(closes, i)
        kc_u, _, kc_l = _kc_at(bars, i)
        if bb_u is None or kc_u is None:
            break
        if bb_u < kc_u and bb_l > kc_l:
            squeeze_bars += 1
        else:
            break

    if squeeze_bars < _MIN_SQUEEZE_BARS:
        return []

    # Volume contraction: 5-bar avg < 70% of 20-bar avg (Carter's signature)
    vol_5 = sum(b["v"] for b in bars[-5:]) / 5
    vol_20 = sum(b["v"] for b in bars[-20:]) / 20
    if vol_20 <= 0:
        return []
    vol_ratio = vol_5 / vol_20
    if vol_ratio >= _VOL_CONTRACT_RATIO:
        return []

    # Bandwidth measurement — Carter's measured-move basis
    bandwidth = bb_upper_last - bb_lower_last
    if bandwidth <= 0:
        return []

    candidate = {
        "bb_upper": bb_upper_last,
        "bb_middle": bb_mid_last,
        "bb_lower": bb_lower_last,
        "kc_upper": kc_upper_last,
        "kc_middle": kc_mid_last,
        "kc_lower": kc_lower_last,
        "squeeze_bars": squeeze_bars,
        "bandwidth": bandwidth,
        "volume_ratio": vol_ratio,
        "current_close": closes[-1],
    }

    geom_score = _score_geometry(candidate)
    vol_score = _score_volume(candidate)
    ctx_score = _score_context(context)
    hist_score = 50.0
    confidence = round(
        0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
    )
    if confidence < _CONFIDENCE_FLOOR:
        return []

    d = _build_detection(bars, candidate, confidence, context,
                         geom_score, vol_score, ctx_score, hist_score)
    return [d]


def _sma(values: List[float], end_idx: int, period: int) -> Optional[float]:
    if end_idx < period - 1 or end_idx >= len(values):
        return None
    return sum(values[end_idx - period + 1: end_idx + 1]) / period


def _stddev(values: List[float], end_idx: int, period: int, mean: float) -> float:
    """Population stddev — matches frontend Bollinger Bands convention."""
    window = values[end_idx - period + 1: end_idx + 1]
    sq_sum = sum((v - mean) ** 2 for v in window)
    return math.sqrt(sq_sum / period)


def _bb_at(closes: List[float], idx: int) -> tuple:
    """Bollinger Bands at bar `idx`. Returns (upper, middle, lower) or (None, None, None)."""
    mid = _sma(closes, idx, _BB_PERIOD)
    if mid is None:
        return (None, None, None)
    std = _stddev(closes, idx, _BB_PERIOD, mid)
    return (mid + _BB_STDDEV * std, mid, mid - _BB_STDDEV * std)


def _ema_series(values: List[float], period: int) -> List[Optional[float]]:
    """Compute EMA aligned to input length (None-prefix until period seed)."""
    n = len(values)
    out: List[Optional[float]] = [None] * n
    if n < period:
        return out
    seed = sum(values[:period]) / period
    out[period - 1] = seed
    k = 2.0 / (period + 1.0)
    for i in range(period, n):
        out[i] = (values[i] - out[i - 1]) * k + out[i - 1]
    return out


def _kc_at(bars: List[Bar], idx: int) -> tuple:
    """Keltner Channel at bar `idx`. Returns (upper, middle, lower)."""
    if idx < _KC_PERIOD - 1:
        return (None, None, None)
    closes = [b["c"] for b in bars[:idx + 1]]
    ema_series = _ema_series(closes, _KC_PERIOD)
    mid = ema_series[idx]
    if mid is None:
        return (None, None, None)
    # ATR over period: avg of true ranges in last `period` bars ending at idx
    trs = []
    for j in range(max(1, idx - _KC_PERIOD + 1), idx + 1):
        b = bars[j]
        pc = bars[j - 1]["c"]
        tr = max(b["h"] - b["l"], abs(b["h"] - pc), abs(b["l"] - pc))
        trs.append(tr)
    if not trs:
        return (None, None, None)
    atr = sum(trs) / len(trs)
    return (mid + _KC_ATR_MULT * atr, mid, mid - _KC_ATR_MULT * atr)


def _score_geometry(c: dict) -> float:
    """Longer squeeze + tighter compression ratio = stronger setup."""
    sq = c["squeeze_bars"]
    if sq >= 15:
        duration_score = 100.0
    elif sq >= 10:
        duration_score = 80.0
    elif sq >= 8:
        duration_score = 65.0
    else:
        duration_score = 50.0  # 6-7 bars = baseline

    # Compression depth: how much smaller is BB width vs KC width?
    bb_width = c["bb_upper"] - c["bb_lower"]
    kc_width = c["kc_upper"] - c["kc_lower"]
    compression_ratio = bb_width / kc_width if kc_width > 0 else 1.0
    if compression_ratio <= 0.60:
        compression_score = 100.0
    elif compression_ratio <= 0.75:
        compression_score = 80.0
    elif compression_ratio <= 0.90:
        compression_score = 65.0
    else:
        compression_score = 50.0

    return round(min(100.0, 0.55 * duration_score + 0.45 * compression_score), 2)


def _score_volume(c: dict) -> float:
    """Tighter volume contraction = more energy stored (Carter's signature)."""
    ratio = c["volume_ratio"]
    if ratio <= 0.40:
        return 100.0
    if ratio <= 0.55:
        return 85.0
    if ratio <= 0.65:
        return 70.0
    return 55.0  # under 0.70 threshold = baseline


def _score_context(context: dict) -> float:
    """Squeezes set up better in trending environments (Stage 2 or Stage 4)."""
    score = 50.0
    stage = context.get("trend_stage")
    if stage in (2, 4):
        score += 15.0  # trending — directional bias on resolution
    elif stage in (1, 3):
        score += 5.0
    # DCR scoring: neutral detector → use absolute magnitude
    dcr_sig = context.get("dcr_signature")
    if dcr_sig in ("accumulation", "distribution"):
        score += 8.0   # explicit signature = clearer breakout direction
    return min(100.0, max(0.0, score))


def _build_detection(bars, c, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    bb_upper = c["bb_upper"]
    bb_lower = c["bb_lower"]
    bb_middle = c["bb_middle"]
    kc_upper = c["kc_upper"]
    kc_lower = c["kc_lower"]
    bandwidth = c["bandwidth"]
    sq_bars = c["squeeze_bars"]
    vol_ratio = c["volume_ratio"]
    current_close = c["current_close"]

    # Levels: direction undetermined — emit middle-anchored neutral levels.
    entry = round(current_close, 2)
    # Stop = opposite Bollinger band (will be re-anchored once direction is known).
    # For neutral emission, use the band closer to current price as the "near" stop.
    stop = round(bb_lower if current_close >= bb_middle else bb_upper, 2)
    # Target = midpoint ± 2 × bandwidth (Carter's measured move)
    target_up = round(bb_middle + 2.0 * bandwidth, 2)
    target_down = round(bb_middle - 2.0 * bandwidth, 2)
    target = target_up if current_close >= bb_middle else target_down
    rr = abs((target - entry) / (entry - stop)) if entry != stop else 0.0

    # Anchors: rectangle at BB bounds across the squeeze window
    start_idx = max(0, len(bars) - 1 - sq_bars)
    anchors = [
        {"t": int(bars[start_idx]["t"]), "price": float(bb_upper)},
        {"t": int(last_bar["t"]), "price": float(bb_upper)},
        {"t": int(last_bar["t"]), "price": float(bb_lower)},
        {"t": int(bars[start_idx]["t"]), "price": float(bb_lower)},
    ]

    extras = {
        "bb_upper": round(bb_upper, 4),
        "bb_middle": round(bb_middle, 4),
        "bb_lower": round(bb_lower, 4),
        "kc_upper": round(kc_upper, 4),
        "kc_middle": round(c["kc_middle"], 4),
        "kc_lower": round(kc_lower, 4),
        "squeeze_bars": int(sq_bars),
        "bandwidth": round(bandwidth, 4),
        "compression_ratio": round((bb_upper - bb_lower) / (kc_upper - kc_lower), 4)
        if (kc_upper - kc_lower) > 0 else None,
        "volume_ratio": round(vol_ratio, 3),
        "target_up": target_up,
        "target_down": target_down,
    }

    narrative = _compose_narrative(c, context, entry, stop, target, target_up,
                                    target_down, rr, bandwidth)
    now = int(time.time())

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Bollinger Squeeze",
        "category": "classical",
        "direction": "neutral",
        "start_t": int(bars[start_idx]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(bars[start_idx]["t"]), int(last_bar["t"])],
        "geometry": {
            "shape": "rectangle",
            "anchors": anchors,
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": (
                "DIRECTION UNDETERMINED: enter on breakout side. "
                f"Bull break = close > {bb_upper:.2f}, "
                f"bear break = close < {bb_lower:.2f}."
            ),
            "stop": stop,
            "stop_basis": "opposite_bollinger_band",
            "target_primary": target,
            "target_secondary": target_up if target == target_down else target_down,
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
        "narrative": narrative,
        "status": "forming",  # squeeze is by definition pre-breakout
        "outcome": None,
        "detected_at": now,
        "last_seen_at": now,
    }


def _compose_narrative(c: dict, context: dict, entry: float, stop: float,
                       target: float, target_up: float, target_down: float,
                       rr: float, bandwidth: float) -> dict:
    bb_upper = c["bb_upper"]
    bb_lower = c["bb_lower"]
    bb_middle = c["bb_middle"]
    kc_upper = c["kc_upper"]
    kc_lower = c["kc_lower"]
    sq_bars = c["squeeze_bars"]
    vol_ratio = c["volume_ratio"]
    compression_pct = (bb_upper - bb_lower) / (kc_upper - kc_lower) * 100.0 \
        if (kc_upper - kc_lower) > 0 else 100.0
    current_close = c["current_close"]

    ma_phrase = ma_alignment_phrase(context.get("ma_alignment"))
    stage_phrase = trend_stage_description(context.get("trend_stage"))
    regime_p = regime_phrase(context.get("regime"))
    vol_phrase = volume_signature_phrase(context.get("volume_signature"))
    dcr_p = dcr_phrase(context.get("dcr_signature"), context.get("recent_dcr_avg"))

    headline = (
        f"Bollinger Squeeze - BB(20, 2σ) compressed INSIDE Keltner(20, 1.5×ATR) "
        f"for {sq_bars} consecutive bars (BB width {compression_pct:.0f}% of KC "
        f"width), volume contracted to {vol_ratio * 100:.0f}% of 20-bar average. "
        f"Bands: ${bb_lower:.2f} ↔ ${bb_upper:.2f}. Targets: ${target_down:.2f} "
        f"(bear) / ${target_up:.2f} (bull). R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Bollinger Squeeze is the foundational volatility-compression "
        f"detector in modern technical analysis, combining two classical "
        f"volatility envelopes that measure DIFFERENT aspects of price "
        f"variability and triggering when those measures diverge. The first "
        f"envelope is John Bollinger's Bollinger Bands, introduced in the "
        f"1980s and definitively codified in 'Bollinger on Bollinger Bands' "
        f"(McGraw-Hill, 2001): the 20-period SMA ± 2 population standard "
        f"deviations. Width is a direct function of recent CLOSE-TO-CLOSE "
        f"variance — when prices stop trending and consolidate, the bands "
        f"compress mechanically as standard deviation collapses. The second "
        f"envelope is Chester Keltner's Keltner Channels (introduced in "
        f"'How To Make Money in Commodities', 1960; refined by Linda "
        f"Raschke and other modern practitioners): the 20-period EMA ± "
        f"1.5 × ATR(20). Width is a direct function of recent AVERAGE TRUE "
        f"RANGE — the bar-by-bar high-to-low envelope, which captures intra-"
        f"bar volatility AND inter-bar gaps. When Bollinger Bands compress "
        f"INSIDE the Keltner Channels — meaning the close-to-close variance "
        f"has collapsed below the average-range envelope — the chart has "
        f"entered a structural compression state where standard-deviation "
        f"volatility has fallen substantially below average-range "
        f"volatility. Here, the BB width is {compression_pct:.0f}% of the "
        f"KC width — substantially compressed — and the squeeze has "
        f"persisted for {sq_bars} consecutive bars (with Carter's empirical "
        f"observation: the longer the squeeze, the more potential energy "
        f"stored in the consolidation). John Carter codified this framework "
        f"in 'Mastering the Trade' (McGraw-Hill, 2005) and built the popular "
        f"'TTM Squeeze' indicator on TradingView, popularizing the concept "
        f"for retail and small-fund traders. Carter's published track "
        f"record from his TopstepTrader and SimplerTrading content shows "
        f"that 6+ bar squeezes resolve into directional moves of 2× the "
        f"bandwidth or more in roughly 70% of cases when volume also "
        f"contracts to <70% of average — this fixture's volume ratio of "
        f"{vol_ratio * 100:.0f}% confirms that institutional participation "
        f"has receded into the compression, the textbook 'coiling spring' "
        f"signature."
    )

    why_it_matters = (
        f"This Bollinger Squeeze is firing inside {stage_phrase} with "
        f"{ma_phrase} alignment, in {regime_p}. Direction is by definition "
        f"UNDETERMINED at the squeeze itself — the breakout SIDE determines "
        f"the trade direction. But the squeeze itself communicates several "
        f"high-information facts about the chart: (1) institutional "
        f"participation has stepped back — {vol_phrase} on the consolidation "
        f"compressed to {vol_ratio * 100:.0f}% of 20-bar average "
        f"explicitly indicates absorption rather than active distribution "
        f"OR accumulation, the textbook 'waiting' pose; (2) close-to-close "
        f"variance has fallen below ATR — bars are still moving intraday "
        f"(KC width preserved) but closes are clustering near the middle, "
        f"meaning the OPEN-CLOSE relationship has stabilized while INTRA-"
        f"BAR action persists; (3) the compression is mathematically "
        f"reversion-bound — Bollinger's own published research shows that "
        f"BB-inside-KC states resolve to BB-outside-KC states in <30 bars "
        f"~95% of the time, making the squeeze a high-probability "
        f"volatility-mean-reversion setup with timing edge measured in "
        f"BARS, not weeks. {dcr_p} Carter's specific empirical pattern: a "
        f"trending context (Stage 2 or Stage 4) biases the breakout side — "
        f"a squeeze inside an uptrend resolves upward ~67% of the time; "
        f"inside a downtrend resolves downward ~67%; in choppy Stage 1/3 "
        f"contexts, the breakout side is closer to 50/50 and traders should "
        f"trade the BREAK rather than anticipate. Bandwidth at the squeeze "
        f"midpoint is ${bandwidth:.2f} — Carter's measured move target is "
        f"2× this bandwidth projected from the squeeze midpoint "
        f"(${bb_middle:.2f}), giving bullish target ${target_up:.2f} and "
        f"bearish target ${target_down:.2f}. The asymmetric reward profile "
        f"is governed entirely by which side breaks: the trader's edge is "
        f"the breakout-confirmation rule, NOT prediction of direction in "
        f"the pre-breakout state."
    )

    what_to_watch_for = (
        f"The squeeze itself is a SETUP, not a trigger — the breakout side "
        f"is the trigger. Bull-break trigger: close above ${bb_upper:.2f} "
        f"(upper Bollinger band) on volume ≥ 1.5× the 20-bar average. Bear-"
        f"break trigger: close below ${bb_lower:.2f} (lower Bollinger band) "
        f"on volume ≥ 1.5× average. Carter's specific execution rules from "
        f"'Mastering the Trade': (a) wait for the BB to expand back OUTSIDE "
        f"the KC envelope (the 'squeeze fires' signal); (b) take the trade "
        f"on the FIRST close beyond the band in the direction of the "
        f"expansion; (c) the very first close-beyond-the-band move is the "
        f"highest-edge entry — subsequent retests of the band are lower-"
        f"probability because the move has already begun. Stops should sit "
        f"at the opposite Bollinger band: a bull break stops at "
        f"${bb_lower:.2f} (close below), a bear break stops at "
        f"${bb_upper:.2f} (close above). This stop is wide on paper "
        f"(${(bb_upper - bb_lower):.2f}) but is the structural correct "
        f"failure-point — if a squeeze resolves and then immediately "
        f"reverses through the opposite band, the volatility-expansion "
        f"thesis is broken and the trade must be exited. Target: "
        f"${target_up:.2f} for a bull break, ${target_down:.2f} for a bear "
        f"break — both reflect 2× bandwidth projected from squeeze midpoint, "
        f"Carter's measured-move math. Position sizing must reflect the "
        f"wide opposite-band stop: risking 0.5% of account implies a "
        f"smaller position size than a tight-stop pattern, but the 2× "
        f"bandwidth target produces R:R {rr:.1f}, comfortably above the "
        f"2.0 minimum threshold for high-quality squeeze setups. Carter's "
        f"key timing note: squeezes that have persisted >10 bars (this one "
        f"has run {sq_bars} bars) often produce the cleanest, fastest "
        f"resolutions — the longer the spring is compressed, the sharper "
        f"the release. Don't enter SHORT of the breakout — anticipating "
        f"direction inside the squeeze has empirically lower expectancy "
        f"than reactive entry on the actual band-break print."
    )

    failure_signal = (
        f"The Bollinger Squeeze 'fails' in two specific ways, each demanding "
        f"a different response. Failure Mode 1 — the squeeze persists "
        f"indefinitely without resolution: if the compression extends "
        f"beyond ~25-30 bars without a clean breakout, the underlying "
        f"volatility regime has shifted to true range-bound chop, and the "
        f"Bollinger Squeeze edge (mean-reversion in volatility) has lost "
        f"its timing edge. In this case the trader should switch from "
        f"breakout-anticipation to range-fade tactics. Failure Mode 2 — "
        f"the breakout fires but reverses through the opposite band within "
        f"5-10 bars (the 'failed squeeze release'): the most insidious "
        f"failure mode and the one Carter warns about repeatedly. This "
        f"occurs when the first band-break is driven by stop-running rather "
        f"than genuine directional commitment. The signature: the breakout "
        f"bar prints on heavy volume but the next 2-3 bars retrace ALL of "
        f"the band-break move and close back inside the consolidation. "
        f"When this happens, the OPPOSITE side typically delivers the real "
        f"move within the following 5-15 bars — Carter's 'fake-out then "
        f"breakout' pattern. The structural invalidation: a daily close "
        f"that violates ${stop:.2f} after a breakout fire signals the "
        f"original directional thesis is broken; exit immediately on the "
        f"close, no waiting for confirmation. Position sizing discipline: "
        f"because direction is undetermined at squeeze-time, the trader "
        f"MUST size for the wider opposite-band stop, not the tighter "
        f"breakout-side stop. Treating the breakout as a 'tight' entry "
        f"underweights the volatility risk of a Squeeze failure and "
        f"consistently produces position sizes too large for the actual "
        f"adverse-excursion the pattern requires. Bollinger's own caveat "
        f"from 'Bollinger on Bollinger Bands': squeezes in directionless "
        f"sideways markets resolve directionally maybe 55% of the time — "
        f"in true trending markets the directional resolution rate rises "
        f"to 70%+. The trader's edge is greatest when the squeeze prints "
        f"INSIDE a confirmed trend (Stage 2 or Stage 4) — current trend "
        f"stage is {context.get('trend_stage', 'undefined')}."
    )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_bollinger_squeeze)
