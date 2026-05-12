"""Remount detector — Pradeep Bonde / Stockbee swing system.

The Remount is the cousin of Undercut & Rally but operates on a LONGER
timescale. A stock previously broke a key level (20-EMA, 50-SMA, or a
prior breakout pivot) and traded BELOW for 5-30 bars — long enough that
the prior bullish thesis seemed broken. Then it reclaims the level on a
confirmed close above, with follow-through bars holding.

The "remount" signals that despite the prior breakdown, demand is
reasserting itself — and reclaim breakouts often outperform original
breakouts because the false breakdown shook out weak hands.

Geometric definition:
  - Key level: 20-EMA, 50-SMA, or a prior breakout pivot (swing high
    that price had broken above and then fell back through).
  - Breakdown period: 5-30 consecutive bars closing BELOW the key level.
  - Remount bar: within the last 5 bars, a bar that closes ABOVE the
    key level on volume > 1.2x avg.
  - Follow-through: the bars after the remount bar must hold above the
    level (no close < level after remount).
  - Volume signature: remount bar volume / 20-bar avg (>=1.5x strong,
    >=1.2x pass).
  - Direction: bullish

Scoring (composite 0-100):
  geometry_score:   breakdown cleanliness (consecutive closes below),
                    remount bar strength (close in upper half of range),
                    follow-through quality.
  volume_score:     remount bar volume / 20-bar avg.
  context_score:    Stage 2 (better) or Stage 1 emerging, MA stack
                    improving from bearish toward bullish.
  historical_score: 50.0 (neutral prior).
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.pivots import detect_pivots
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "remount"
_MIN_BREAKDOWN_BARS = 5          # at least 5 consecutive closes below = real breakdown
_MAX_BREAKDOWN_BARS = 30         # more than 30 = structural damage too severe
_REMOUNT_LOOKBACK = 5            # the remount bar must be within the last 5 bars
_FOLLOW_THROUGH_BARS = 3         # bars after remount must hold above the level
_MIN_REMOUNT_VOL_RATIO = 1.2     # remount bar volume vs 20-bar avg
_ATR_PERIOD = 14
_EMA_PERIOD = 20
_SMA_PERIOD = 50
_PRIOR_HIGH_LOOKBACK = 60        # find prior-advance high in this many bars before breakdown
_MAX_SWING_PIVOT_AGE = 80        # only consider prior breakout pivots within last N bars
_CONFIDENCE_FLOOR = 50.0


def detect_remount(bars: List[Bar], context: dict) -> List[Detection]:
    """Detect Remount patterns. May emit 0-1 detections (best one)."""
    # Need enough history: EMA20 warmup + max breakdown + a couple follow-through
    if len(bars) < _EMA_PERIOD + _MAX_BREAKDOWN_BARS + 5:
        return []

    # Hard hostile-context gate: full Stage 4 + stacked bearish + rs down = no
    # reclaim trade worth flagging.
    if _hostile_context(context):
        return []

    # Pre-compute EMA20 and SMA50 series so we can read the value at any bar.
    ema20_series = _ema_series(bars, _EMA_PERIOD)
    sma50_series = _sma_series(bars, _SMA_PERIOD)
    atr14 = _atr(bars, _ATR_PERIOD)
    if atr14 is None or atr14 <= 0:
        return []

    last_idx = len(bars) - 1

    # Enumerate candidates: each is (key_level, key_level_type, breakdown_start,
    # breakdown_end, remount_idx, prior_high). The detector scans recent bars
    # for a remount candidate, then walks back to find the breakdown period.
    candidates = _enumerate_candidates(
        bars, ema20_series, sma50_series, last_idx
    )
    if not candidates:
        return []

    best_candidate = None
    best_confidence = -1.0
    best_scores = None

    for cand in candidates:
        # Already-broken-too-far gate: if price has been WAY above the key
        # level for many bars already, the remount has fully played out.
        if _already_extended(bars, cand):
            continue

        # Volume gate at the remount bar
        if cand["remount_volume_ratio"] < _MIN_REMOUNT_VOL_RATIO:
            continue

        geom_score = _score_geometry(bars, cand)
        vol_score = _score_volume(cand)
        ctx_score = _score_context(context)
        hist_score = 50.0

        confidence = round(
            0.40 * geom_score + 0.25 * vol_score + 0.20 * ctx_score + 0.15 * hist_score, 2
        )
        if confidence < _CONFIDENCE_FLOOR:
            continue

        if confidence > best_confidence:
            best_confidence = confidence
            best_candidate = cand
            best_scores = (geom_score, vol_score, ctx_score, hist_score)

    if best_candidate is None:
        return []

    geom_score, vol_score, ctx_score, hist_score = best_scores
    d = _build_detection(
        bars, best_candidate, atr14, best_confidence, context,
        geom_score, vol_score, ctx_score, hist_score,
    )
    return [d]


# ------------------------------------------------------------------ #
# Candidate enumeration                                              #
# ------------------------------------------------------------------ #


def _enumerate_candidates(
    bars: List[Bar],
    ema20_series: List[Optional[float]],
    sma50_series: List[Optional[float]],
    last_idx: int,
) -> List[dict]:
    """Find all (key_level, breakdown_period, remount_bar) triples.

    Strategy:
      For each candidate remount bar in the last _REMOUNT_LOOKBACK bars:
        For each key-level source (20-EMA-then, 50-SMA-then, prior swing high):
          1. Read the level value at the remount bar
          2. Walk backwards to find the longest consecutive run of bars
             where close < level (the breakdown period)
          3. Validate breakdown length in [5, 30]
          4. Validate the post-remount bars hold above the level
    """
    out: List[dict] = []

    # Pre-collect prior swing-high pivots that might serve as "broken levels"
    swing_highs = _recent_swing_highs(bars, last_idx)

    earliest_remount = max(_EMA_PERIOD, last_idx - _REMOUNT_LOOKBACK + 1)

    for remount_idx in range(earliest_remount, last_idx + 1):
        # Need at least _FOLLOW_THROUGH_BARS bars AFTER the remount bar before
        # `last_idx` to validate follow-through (or the remount bar itself is
        # the last bar — we still allow it but follow-through is weaker).
        bars_after = last_idx - remount_idx
        # We require at least 1 follow-through bar; ideal is 3.
        if bars_after < 1:
            # Allow the remount to be the very last bar IF the bar itself is
            # strong enough — but only if there's no later bar to invalidate it.
            pass

        # ---- Source 1: 20-EMA value at the remount bar ----
        ema_val = ema20_series[remount_idx]
        if ema_val is not None:
            cand = _try_candidate(
                bars, remount_idx, ema_val, "20_ema", last_idx,
            )
            if cand is not None:
                out.append(cand)

        # ---- Source 2: 50-SMA value at the remount bar ----
        sma_val = sma50_series[remount_idx]
        if sma_val is not None:
            cand = _try_candidate(
                bars, remount_idx, sma_val, "50_sma", last_idx,
            )
            if cand is not None:
                out.append(cand)

        # ---- Source 3: prior swing-high pivots (broken breakout pivots) ----
        for sh in swing_highs:
            # The pivot must be BEFORE the breakdown period began. We use a
            # heuristic: the pivot has to be older than (remount_idx -
            # _MIN_BREAKDOWN_BARS). The pivot's price serves as the "broken
            # level" — price must have closed above it, then below for
            # 5-30 bars, then reclaimed.
            if sh["bar_index"] >= remount_idx - _MIN_BREAKDOWN_BARS:
                continue
            cand = _try_candidate(
                bars, remount_idx, sh["price"], "prior_pivot", last_idx,
                pivot_bar_idx=sh["bar_index"],
            )
            if cand is not None:
                out.append(cand)

    return out


def _try_candidate(
    bars: List[Bar],
    remount_idx: int,
    key_level: float,
    key_level_type: str,
    last_idx: int,
    pivot_bar_idx: Optional[int] = None,
) -> Optional[dict]:
    """Validate a (remount_idx, key_level) candidate.

    Returns the candidate dict (with breakdown stats + remount metrics +
    prior_high) if valid; None otherwise.
    """
    # 1. The remount bar must close ABOVE the key level.
    remount_bar = bars[remount_idx]
    if remount_bar["c"] <= key_level:
        return None

    # 2. The previous bar must close BELOW the key level (so the remount
    # is a genuine reclaim — not a noise tick of an already-above stock).
    if remount_idx - 1 < 0:
        return None
    if bars[remount_idx - 1]["c"] >= key_level:
        return None

    # 3. Walk backwards to find the breakdown period: consecutive bars
    # closing below key_level ending at (remount_idx - 1).
    breakdown_end = remount_idx - 1
    breakdown_start = breakdown_end
    while breakdown_start - 1 >= 0 and bars[breakdown_start - 1]["c"] < key_level:
        breakdown_start -= 1
        # Cap walk-back to avoid pathological scans
        if breakdown_end - breakdown_start + 1 > _MAX_BREAKDOWN_BARS + 5:
            break
    breakdown_bars_count = breakdown_end - breakdown_start + 1

    if breakdown_bars_count < _MIN_BREAKDOWN_BARS:
        return None
    if breakdown_bars_count > _MAX_BREAKDOWN_BARS:
        return None

    # 4. For a "prior_pivot" key level, ensure price had closed ABOVE the pivot
    # BEFORE the breakdown (so the pivot is a real prior breakout level).
    if key_level_type == "prior_pivot" and pivot_bar_idx is not None:
        # Look at bars between pivot_bar_idx and breakdown_start. At least one
        # must close above key_level (it was previously broken to the upside).
        had_above = any(
            bars[i]["c"] > key_level
            for i in range(pivot_bar_idx, breakdown_start)
        )
        if not had_above:
            return None

    # 5. Follow-through validation: post-remount bars must hold above the level.
    # Compute how many of the next bars (up to _FOLLOW_THROUGH_BARS) hold above.
    post = bars[remount_idx + 1: min(remount_idx + 1 + _FOLLOW_THROUGH_BARS, last_idx + 1)]
    n_post = len(post)
    holds_above = sum(1 for b in post if b["c"] >= key_level)
    # Allow up to 1 re-violation if there are 3 post-bars (some intraday slop
    # is fine), but if EVERY post-bar closes below, reject.
    if n_post > 0 and holds_above == 0:
        return None

    # 6. Compute volume metrics for the remount bar.
    vol_lookback_start = max(0, remount_idx - 20)
    vol_window = bars[vol_lookback_start:remount_idx]
    avg_vol = sum(b["v"] for b in vol_window) / len(vol_window) if vol_window else 0.0
    remount_vol = float(remount_bar["v"])
    vol_ratio = (remount_vol / avg_vol) if avg_vol > 0 else 1.0

    # 7. Compute breakdown low (the lowest low during the breakdown period,
    # used as stop reference if it's within the last 5 bars of remount).
    breakdown_window = bars[breakdown_start:breakdown_end + 1]
    breakdown_low = min(b["l"] for b in breakdown_window)
    # Recent pullback low: lowest low in the last 5 bars of the breakdown
    recent_start = max(breakdown_start, breakdown_end - 4)
    recent_window = bars[recent_start:breakdown_end + 1]
    recent_pullback_low = min(b["l"] for b in recent_window)

    # 8. Compute prior high (the high BEFORE the breakdown). Look back up to
    # _PRIOR_HIGH_LOOKBACK bars before breakdown_start.
    prior_lookback_start = max(0, breakdown_start - _PRIOR_HIGH_LOOKBACK)
    if prior_lookback_start >= breakdown_start:
        return None
    prior_window = bars[prior_lookback_start:breakdown_start]
    if not prior_window:
        return None
    prior_high = max(b["h"] for b in prior_window)
    prior_high_idx_rel = max(range(len(prior_window)), key=lambda i: prior_window[i]["h"])
    prior_high_idx = prior_lookback_start + prior_high_idx_rel

    # 9. Sanity: the prior high must be above the key level (otherwise this
    # isn't a meaningful reclaim — there was nothing previously bullish).
    if prior_high <= key_level:
        return None

    # 10. Remount bar quality: close in upper half of range?
    bar_range = remount_bar["h"] - remount_bar["l"]
    if bar_range > 0:
        upper_half_close = remount_bar["c"] >= (remount_bar["l"] + bar_range * 0.5)
    else:
        upper_half_close = True

    return {
        "key_level": float(key_level),
        "key_level_type": key_level_type,
        "breakdown_start": breakdown_start,
        "breakdown_end": breakdown_end,
        "breakdown_bars": int(breakdown_bars_count),
        "breakdown_low": float(breakdown_low),
        "recent_pullback_low": float(recent_pullback_low),
        "remount_idx": remount_idx,
        "remount_close": float(remount_bar["c"]),
        "remount_volume": float(remount_vol),
        "remount_volume_ratio": float(vol_ratio),
        "remount_upper_half_close": bool(upper_half_close),
        "follow_through_bars": int(n_post),
        "follow_through_holds": int(holds_above),
        "prior_high": float(prior_high),
        "prior_high_idx": int(prior_high_idx),
        "pivot_bar_idx": pivot_bar_idx,
    }


# ------------------------------------------------------------------ #
# Series + helpers                                                   #
# ------------------------------------------------------------------ #


def _ema_series(bars: List[Bar], period: int) -> List[Optional[float]]:
    """Compute EMA series matching bars length. None where insufficient data."""
    n = len(bars)
    out: List[Optional[float]] = [None] * n
    if n < period:
        return out
    # Seed with SMA of first `period` closes
    seed = sum(bars[i]["c"] for i in range(period)) / period
    out[period - 1] = seed
    k = 2.0 / (period + 1)
    prev = seed
    for i in range(period, n):
        ema = bars[i]["c"] * k + prev * (1.0 - k)
        out[i] = ema
        prev = ema
    return out


def _sma_series(bars: List[Bar], period: int) -> List[Optional[float]]:
    """Compute SMA series matching bars length. None where insufficient data."""
    n = len(bars)
    out: List[Optional[float]] = [None] * n
    if n < period:
        return out
    rolling = sum(bars[i]["c"] for i in range(period))
    out[period - 1] = rolling / period
    for i in range(period, n):
        rolling += bars[i]["c"] - bars[i - period]["c"]
        out[i] = rolling / period
    return out


def _atr(bars: List[Bar], period: int) -> Optional[float]:
    """Latest ATR(period) using Wilder's smoothing approximation (simple avg)."""
    if len(bars) < period + 1:
        return None
    trs: List[float] = []
    for i in range(1, len(bars)):
        h = bars[i]["h"]
        l = bars[i]["l"]
        pc = bars[i - 1]["c"]
        tr = max(h - l, abs(h - pc), abs(l - pc))
        trs.append(tr)
    if len(trs) < period:
        return None
    return sum(trs[-period:]) / period


def _recent_swing_highs(bars: List[Bar], last_idx: int) -> List[dict]:
    """Return swing-high pivots within the last _MAX_SWING_PIVOT_AGE bars."""
    pivots = detect_pivots(bars, window=3)
    cutoff = last_idx - _MAX_SWING_PIVOT_AGE
    out = []
    for p in pivots:
        if p["type"] != "high":
            continue
        if p["bar_index"] < cutoff:
            continue
        out.append({"price": float(p["price"]), "bar_index": p["bar_index"]})
    return out


# ------------------------------------------------------------------ #
# Gates                                                              #
# ------------------------------------------------------------------ #


def _already_extended(bars: List[Bar], c: dict) -> bool:
    """If price closed >8% above the key level for the bulk of post-remount
    bars, the remount has already played out and the trade is extended.

    Threshold is generous because remount + 1 ATR entry buffer + healthy
    follow-through can naturally reach 3-6% above the level. Only reject
    when price has truly extended far away (>8%) and held there.
    """
    key = c["key_level"]
    remount_idx = c["remount_idx"]
    last_idx = len(bars) - 1
    post = last_idx - remount_idx
    if post < 3:
        return False
    extended_bars = 0
    for i in range(remount_idx + 1, last_idx + 1):
        if bars[i]["c"] > key * 1.08:
            extended_bars += 1
    # Need at least 4 bars and the majority extended >8% above
    return extended_bars >= 4 and extended_bars / max(1, post) >= 0.7


def _hostile_context(context: dict) -> bool:
    """Reject only if Stage 4 + stacked_bearish + rs_trend down all coincide."""
    stage_bad = context.get("trend_stage") == 4
    ma_bad = context.get("ma_alignment") == "stacked_bearish"
    rs_bad = context.get("rs_trend") == "down"
    return stage_bad and ma_bad and rs_bad


# ------------------------------------------------------------------ #
# Scoring                                                            #
# ------------------------------------------------------------------ #


def _score_geometry(bars: List[Bar], c: dict) -> float:
    """Components:
      - breakdown_quality: how cleanly price stayed below (consecutive closes)
        and whether the productive zone (10-20 bars) was hit.
      - remount_strength: close in upper half of bar's range.
      - follow_through_score: fraction of post-bars that held above the level.
    """
    breakdown_bars = c["breakdown_bars"]
    # Productive zone 10-20 = 100; tapers to ~60 at edges (5 and 30)
    if 10 <= breakdown_bars <= 20:
        breakdown_score = 100.0
    elif breakdown_bars < 10:
        # 5 -> 60, 10 -> 100
        breakdown_score = 60.0 + (breakdown_bars - _MIN_BREAKDOWN_BARS) / (10 - _MIN_BREAKDOWN_BARS) * 40.0
    else:
        # 20 -> 100, 30 -> 50
        breakdown_score = max(50.0, 100.0 - (breakdown_bars - 20) / (_MAX_BREAKDOWN_BARS - 20) * 50.0)

    # Remount strength: close in upper half = 100, else 50
    remount_score = 100.0 if c["remount_upper_half_close"] else 50.0

    # Follow-through: holds / total post-bars
    if c["follow_through_bars"] > 0:
        ft_frac = c["follow_through_holds"] / c["follow_through_bars"]
        follow_score = ft_frac * 100.0
    else:
        # No follow-through bars yet — the remount bar IS the last bar.
        # Give moderate credit (signal is fresh, not yet invalidated).
        follow_score = 70.0

    return round(
        0.45 * breakdown_score + 0.25 * remount_score + 0.30 * follow_score, 2
    )


def _score_volume(c: dict) -> float:
    """Score remount bar volume vs 20-bar avg.

    1.2x = 50, 1.5x = 75, 2.0x+ = 100.
    """
    ratio = c["remount_volume_ratio"]
    if ratio >= 2.0:
        return 100.0
    if ratio >= 1.5:
        # 1.5 -> 75, 2.0 -> 100
        return round(75.0 + (ratio - 1.5) * 50.0, 2)
    if ratio >= 1.2:
        # 1.2 -> 50, 1.5 -> 75
        return round(50.0 + (ratio - 1.2) / 0.3 * 25.0, 2)
    # Below 1.2 — but volume gate already rejected, defensive
    return 0.0


def _score_context(context: dict) -> float:
    """Remount is a RECLAIM setup — Stage 2 or Stage 1 emerging is ideal.
    MA stack improving from bearish/mixed toward bullish is supportive."""
    score = 30.0
    stage = context.get("trend_stage")
    if stage == 2:
        score += 25
    elif stage == 1:
        score += 18
    elif stage == 3:
        score += 5
    align = context.get("ma_alignment")
    if align == "stacked_bullish":
        score += 20
    elif align == "mixed":
        score += 12
    rs = context.get("rs_trend")
    if rs == "up":
        score += 15
    elif rs == "flat":
        score += 8
    return min(100.0, score)


# ------------------------------------------------------------------ #
# Narrative helpers                                                  #
# ------------------------------------------------------------------ #


def _ma_alignment_phrase(context: dict) -> str:
    align = context.get("ma_alignment", "mixed")
    if align == "stacked_bullish":
        return "fully stacked-bullish moving-average"
    if align == "stacked_bearish":
        return "stacked-bearish moving-average"
    return "mixed moving-average (transitioning back toward bullish)"


def _trend_stage_description(context: dict) -> str:
    stage = context.get("trend_stage", 0)
    if stage == 2:
        return "a confirmed Stage 2 uptrend that experienced a corrective phase"
    if stage == 1:
        return "a Stage 1 base/accumulation environment that's beginning to reassert"
    if stage == 3:
        return "a Stage 3 distribution environment (caution — late-cycle remount has reduced edge)"
    if stage == 4:
        return "a Stage 4 downtrend (counter-trend remount — reduce size accordingly)"
    return "an undefined trend stage"


def _rs_trend_phrase(context: dict) -> str:
    rs = context.get("rs_trend", "flat")
    if rs == "up":
        return "improving"
    if rs == "down":
        return "still-deteriorating"
    return "neutral"


def _key_level_description(key_level_type: str) -> str:
    if key_level_type == "20_ema":
        return "20-bar exponential moving average"
    if key_level_type == "50_sma":
        return "50-bar simple moving average"
    if key_level_type == "prior_pivot":
        return "prior breakout pivot"
    return "key technical level"


def _regime_context_sentence(context: dict, c: dict) -> str:
    regime = context.get("regime", "current")
    stage = context.get("trend_stage", 0)
    breakdown_bars = c["breakdown_bars"]
    if stage == 2:
        return (
            f"Within the {regime} regime, a Stage 2 remount after a {breakdown_bars}-bar "
            f"breakdown is precisely the structural setup Bonde teaches as the highest-edge "
            f"reclaim signal — institutional buyers reasserting after a corrective phase, "
            f"often producing faster and cleaner trends than original breakouts because the "
            f"weak hands have already been shaken out during the breakdown period"
        )
    if stage == 1:
        return (
            f"Within the {regime} regime, a Stage 1 remount is earlier-cycle: the chart is "
            f"transitioning from accumulation toward trend, and reclaiming the key level is "
            f"the first technical signal that buyers are seizing control — sizing should be "
            f"lighter until Stage 2 confirmation arrives"
        )
    return (
        f"The {regime} regime context is mixed for remount trades — position sizing should "
        f"reflect the higher dispersion of outcomes when the reclaim forms outside a clean "
        f"Stage 2 backdrop, and trail stops should be tightened more aggressively"
    )


# ------------------------------------------------------------------ #
# Detection assembly                                                 #
# ------------------------------------------------------------------ #


def _build_detection(bars, c, atr14, confidence, context,
                     geom_score, vol_score, ctx_score, hist_score) -> Detection:
    last_bar = bars[-1]
    key_level = c["key_level"]
    key_level_type = c["key_level_type"]
    breakdown_bars = c["breakdown_bars"]
    breakdown_start = c["breakdown_start"]
    breakdown_end = c["breakdown_end"]
    breakdown_low = c["breakdown_low"]
    recent_pullback_low = c["recent_pullback_low"]
    remount_idx = c["remount_idx"]
    remount_close = c["remount_close"]
    remount_volume_ratio = c["remount_volume_ratio"]
    prior_high = c["prior_high"]
    prior_high_idx = c["prior_high_idx"]
    follow_through_holds = c["follow_through_holds"]
    follow_through_bars = c["follow_through_bars"]

    # Levels — per spec
    entry = round(key_level + atr14 * 1.0, 2)
    stop = round(recent_pullback_low * 0.985, 2)
    target = round(prior_high * 1.075, 2)
    rr_distance = entry - stop
    rr = (target - entry) / rr_distance if rr_distance > 0 else 0.0
    stop_distance_pct = (rr_distance / entry * 100.0) if entry > 0 else 0.0

    # Geometry anchors:
    # [breakdown_start, key_level_line_left, key_level_line_right,
    #  breakdown_low_anchor, remount_close]
    # Find the bar inside [breakdown_start, breakdown_end] with the lowest low
    breakdown_low_idx = breakdown_start
    for i in range(breakdown_start, breakdown_end + 1):
        if bars[i]["l"] == breakdown_low:
            breakdown_low_idx = i
            break

    anchors = [
        {"t": int(bars[breakdown_start]["t"]),
         "price": float(bars[breakdown_start]["c"])},
        {"t": int(bars[breakdown_start]["t"]),
         "price": float(key_level)},
        {"t": int(bars[remount_idx]["t"]),
         "price": float(key_level)},
        {"t": int(bars[breakdown_low_idx]["t"]),
         "price": float(breakdown_low)},
        {"t": int(bars[remount_idx]["t"]),
         "price": float(remount_close)},
    ]

    now = int(time.time())

    pivot_ts = [
        int(bars[prior_high_idx]["t"]),
        int(bars[breakdown_start]["t"]),
        int(bars[breakdown_low_idx]["t"]),
        int(bars[remount_idx]["t"]),
        int(last_bar["t"]),
    ]

    # ---- Narrative composition — RICH, paragraph-length, real values ----
    ma_phrase = _ma_alignment_phrase(context)
    stage_phrase = _trend_stage_description(context)
    rs_phrase = _rs_trend_phrase(context)
    regime_sentence = _regime_context_sentence(context, c)
    regime = context.get("regime", "current")
    key_level_desc = _key_level_description(key_level_type)

    headline = (
        f"Remount — reclaimed ${key_level:.2f} ({key_level_type}) on "
        f"{remount_volume_ratio:.2f}x volume after {breakdown_bars} bars below. "
        f"Pivot ${entry:.2f}, target ${target:.2f}, R:R {rr:.1f}."
    )

    what_it_is = (
        f"The Remount pattern, popularized by Pradeep Bonde at Stockbee, is the chart's "
        f"signal that a stock previously broken on the longer timescale has reclaimed its "
        f"key technical level — and the implication is bullish even more than the original "
        f"breakout was. The setup begins when a stock breaks a structural level (20-EMA, "
        f"50-SMA, or a prior breakout pivot) and trades BELOW that level for an extended "
        f"period: here {breakdown_bars} bars below the ${key_level:.2f} {key_level_desc}. "
        f"During the breakdown, the bullish thesis appears broken — weak holders sell into "
        f"the decline, technicians label the chart 'broken,' and shorts add positions on "
        f"the breakdown momentum, leaning on the violated level as overhead resistance. "
        f"Then the chart does something unexpected: a single bar closes back ABOVE the "
        f"broken level on {remount_volume_ratio:.2f}x volume (the {key_level_desc} at "
        f"${key_level:.2f} is reclaimed), and the next several bars hold above. This "
        f"'remount' shakes out the shorts who leaned on the broken level and signals that "
        f"despite the temporary failure, demand is reasserting itself with conviction. "
        f"Bonde teaches that remount breakouts frequently outperform original breakouts "
        f"because the false breakdown has already shaken out weak hands and the move now "
        f"begins from a 'clean' float — fewer trapped longs, fewer overhead sellers, and "
        f"a fuel tank of short-cover demand standing by."
    )

    why_it_matters = (
        f"This remount is forming in {stage_phrase} with {ma_phrase} alignment and "
        f"{rs_phrase} relative strength versus the broader market — the context that "
        f"maximizes remount edge. The {key_level_desc} at ${key_level:.2f} is the key "
        f"technical level institutions watch: its violation triggered systematic selling "
        f"(stop runs, momentum-fund exits, technical-rule short adds), and the reclaim "
        f"signals that the systematic selling has exhausted and demand is back in the "
        f"driver's seat. The {breakdown_bars}-bar breakdown duration here is significant: "
        f"shorter than 5 bars is a normal pullback (not a true remount), longer than 30 "
        f"bars and the structural damage is too severe to remount cleanly — at "
        f"{breakdown_bars} bars we're in the productive zone where the breakdown was real "
        f"enough to shake out weak hands without scarring the trend permanently. Volume on "
        f"the remount bar at {remount_volume_ratio:.2f}x the 20-bar average confirms "
        f"institutional reentry, distinguishing this from a normal short cover rally or a "
        f"low-conviction relief bounce. Follow-through quality is "
        f"{follow_through_holds}/{follow_through_bars} bars holding above the reclaimed "
        f"level — the post-remount tape behavior that validates the reclaim is structural "
        f"rather than a one-bar fakeout. {regime_sentence}. Within the {regime} regime, "
        f"remount setups in liquid names ($300M+ cap) produce 1.5:1+ RR with high "
        f"frequency when traded with stop discipline and patience."
    )

    what_to_watch_for = (
        f"The trigger is a close above ${entry:.2f} (the ${key_level:.2f} {key_level_desc} "
        f"plus 1.0 ATR of buffer, ATR14 = ${atr14:.2f}) — entries closer than 1 ATR above "
        f"the level are vulnerable to whipsaws back through the reclaimed line, and "
        f"institutions typically wait for the ATR-buffer confirmation before adding size. "
        f"The ideal trigger bar closes in the upper half of its range with volume >=1.2x "
        f"the 20-bar average (the remount bar here already hit "
        f"{remount_volume_ratio:.2f}x). Measured target is ${target:.2f} (prior high "
        f"${prior_high:.2f} + 7.5% extension), which is conservative — strong remounts "
        f"frequently extend 15-30% above the prior high over 4-12 weeks because the "
        f"breakdown-then-reclaim sequence creates an unusually clean float with low "
        f"overhead supply. Trail stops below each new swing low as price advances; "
        f"remounts frequently retest the reclaimed level once before extending (a "
        f"'kiss-goodbye' to the reclaimed line from above), so the initial stop must "
        f"survive that retest without being shaken. Position size should reflect the "
        f"{stop_distance_pct:.2f}% stop distance — remount stops are typically wider than "
        f"U&R stops due to the longer breakdown duration, but the reward target "
        f"compensates."
    )

    failure_signal = (
        f"The remount is invalidated when price closes back below ${recent_pullback_low:.2f} "
        f"(stop ${stop:.2f}, 1.5% below the recent pullback low) — that signals the "
        f"reclaim was a counter-trend bounce rather than a structural recovery, and the "
        f"breakdown thesis is reasserting. A subtler failure: after the remount bar at "
        f"${remount_close:.2f}, the next 3-5 bars drift down on declining volume without "
        f"breaking the stop, eventually rolling over and re-violating ${key_level:.2f}. "
        f"This 'failed remount' is one of the more devastating failure modes because the "
        f"chart had already given a bullish signal — positioning is often heavier than on "
        f"initial breakouts since traders see the reclaim as confirmation that the "
        f"breakdown was a fakeout. Position size should reflect the "
        f"{stop_distance_pct:.2f}% stop distance — risking 1% of account on the trade "
        f"implies roughly "
        f"{(1.0 / (stop_distance_pct / 100)) if stop_distance_pct > 0 else 0:.0f}% of "
        f"equity allocated to the position, which is comfortably sized for the wider stop "
        f"that a remount requires. Stop discipline on remount trades is critical — the "
        f"pattern's edge depends on the reclaim sustaining (the institutional buyers who "
        f"reclaimed the level continuing to defend it), not on a one-bar bounce that "
        f"unwinds back through the line. Bonde teaches that the trader who cannot honor "
        f"the stop at ${stop:.2f} when it triggers will give back all of the asymmetric "
        f"reward remounts offer over time, because failed remounts often decline 10-20% "
        f"further before stabilizing."
    )

    return {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Remount",
        "category": "uct",
        "direction": "bullish",
        "start_t": int(bars[breakdown_start]["t"]),
        "end_t": int(last_bar["t"]),
        "pivot_ts": pivot_ts,
        "geometry": {
            "shape": "horizontal_line",
            "anchors": anchors,
            "extras": {
                "key_level": round(key_level, 2),
                "key_level_type": key_level_type,
                "breakdown_bars": int(breakdown_bars),
                "breakdown_low": round(breakdown_low, 2),
                "recent_pullback_low": round(recent_pullback_low, 2),
                "remount_close": round(remount_close, 2),
                "remount_volume_ratio": round(remount_volume_ratio, 2),
                "prior_high": round(prior_high, 2),
                "atr_14": round(atr14, 2),
                "follow_through_bars": int(follow_through_bars),
                "follow_through_holds": int(follow_through_holds),
            },
        },
        "levels": {
            "entry": entry,
            "entry_condition": f"close > {entry:.2f} (key_level + 1 ATR) on volume > 1.2x 20-bar avg",
            "stop": stop,
            "stop_basis": "recent_pullback_low_minus_1.5pct",
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


register(_PATTERN_ID, detect_remount)
