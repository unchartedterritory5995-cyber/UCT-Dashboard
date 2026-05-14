"""Stage Analysis - Stan Weinstein's 4-stage market cycle classification.

The foundational context filter for every other pattern. Classifies the current
chart into one of four stages of the institutional money-flow cycle:

  - Stage 1 - Basing / Accumulation: After a downtrend, price flattens.
    30-week MA flattens. Volume dries up. Smart money quietly accumulates from
    exhausted retail sellers.
  - Stage 2 - Markup / Uptrend: Price breaks above the Stage 1 base. 30-week
    MA turns up. Volume expands. This is where institutional money is long and
    where the bulk of swing-trade profits are made.
  - Stage 3 - Distribution / Topping: Price stalls after a long advance.
    30-week MA flattens. Distribution days accumulate. Smart money begins to
    exit; retail still chasing.
  - Stage 4 - Markdown / Downtrend: Price breaks below the Stage 3 base.
    30-week MA turns down. The decline phase, where short positions work.

Reference: Stan Weinstein, "Secrets For Profiting In Bull And Bear Markets"
(1988). This detector wraps the simplified `_trend_stage()` primitive in
`api/services/pattern_engine/primitives/context.py` and surfaces it as a
first-class Detection so that downstream consumers, the API, and the UI can
all reason about the foundational regime context for a chart.

Geometric definition:
  - ALWAYS emits exactly ONE Detection summarizing the current stage.
  - Uses the last 200 bars (or all if shorter; the 30-week MA needs context).
  - If fewer than 30 bars, defaults to Stage 1 with a 50 confidence floor.
  - Direction:
      Stage 1 -> "neutral"   (basing - direction TBD)
      Stage 2 -> "bullish"   (uptrend - long bias)
      Stage 3 -> "neutral"   (topping - direction TBD)
      Stage 4 -> "bearish"   (downtrend - short bias)

Confidence:
  Start at 70.
    + 20 if MA stack matches expected for stage
    + 10 if 50-bar slope sign matches expected direction
    -  10 if borderline (e.g., 200-SMA not established, just crossed)
  Clamp [50, 100].

Levels (per stage):
  Stage 1: entry = base-high reference (NOT a trigger). stop/target = None.
  Stage 2: entry = current 20-EMA (buy-the-pullback ref). stop = recent
           swing low. target = prior-advance projection.
  Stage 3: entry = None. stop/target = None. (Warning, no new longs.)
  Stage 4: entry = current 20-EMA (short-the-rally ref). stop = recent
           swing high. target = None.

Quality components:
  geometry_score:   stage-MA-stack alignment
  volume_score:     stage-volume alignment
  context_score:    100 (the stage IS the context)
  historical_score: 50 (neutral prior)
"""
from __future__ import annotations

import uuid
import time
from typing import List, Optional, Tuple

from api.services.pattern_engine.detectors.registry import register
from api.services.pattern_engine.primitives.context import (
    _ma_alignment,
    _sma,
    _slope_sign,
    _trend_stage,
)
from api.services.pattern_engine.types import Bar, Detection


_PATTERN_ID = "stage_analysis"
_WINDOW_BARS = 200
_MIN_BARS_FOR_FULL_CONFIDENCE = 30


_STAGE_NAMES = {
    1: "Basing / Accumulation",
    2: "Markup / Uptrend",
    3: "Distribution / Topping",
    4: "Markdown / Downtrend",
}


def detect_stage_analysis(bars: List[Bar], context: dict) -> List[Detection]:
    """ALWAYS emit exactly one Detection summarizing the chart's stage."""
    if not bars:
        return []

    last_bar = bars[-1]
    last_bar_idx = len(bars) - 1
    window_bars_actual = min(_WINDOW_BARS, len(bars))
    current_close = float(last_bar["c"])

    # ---- Compute the stage ----
    stage_number = _trend_stage(bars)
    if stage_number not in (1, 2, 3, 4):
        stage_number = 1
    stage_name = _STAGE_NAMES[stage_number]

    # ---- Compute MA alignment + key MA values ----
    ma_alignment = _ma_alignment(bars)
    closes = [float(b["c"]) for b in bars]
    sma_50 = _sma(closes, 50)
    sma_200 = _sma(closes, 200)
    sma_150 = _sma(closes, 150)
    ema_20 = _ema(closes, 20)

    # 50-bar slope as % per bar (over last 20 bars)
    sma_50_slope_pct_per_bar = _sma_slope_pct(closes, period=50, window=20)
    sma_50_annualized_slope = sma_50_slope_pct_per_bar * 252.0

    # 50-bar slope sign (for direction matching)
    slope_sign_50 = _slope_sign(closes, 50) if len(closes) >= 50 else 0
    slope_sign_20 = _slope_sign(closes, 20) if len(closes) >= 20 else 0

    # Distance from current close to MAs
    distance_to_50sma_pct = _safe_distance_pct(current_close, sma_50)
    distance_to_200sma_pct = _safe_distance_pct(current_close, sma_200)
    distance_to_20ema_pct = _safe_distance_pct(current_close, ema_20)

    # Volume: recent vs pre-base
    vol_avg_20 = _avg_volume(bars, lookback=20)
    vol_avg_60 = _avg_volume(bars, lookback=60)
    pre_base_vol_avg = _avg_volume_window(bars, start=-120, end=-60)
    volume_drop_pct = (
        ((pre_base_vol_avg - vol_avg_20) / pre_base_vol_avg * 100.0)
        if pre_base_vol_avg > 0 else 0.0
    )

    # Recent swing high / swing low (last 40 bars) for stop placement
    recent_swing_high = _recent_swing(bars[-40:], "high")
    recent_swing_low = _recent_swing(bars[-40:], "low")

    # Base high (Stage 1 breakout reference) - highest high in last 60 bars
    base_high = _recent_high(bars[-60:])

    # Prior advance amount (Stage 2 target projection) - the % gain from the
    # last meaningful swing low to current price.
    prior_advance_pct = _prior_advance_pct(bars, stage_number)

    # ---- Confidence ----
    confidence, confidence_components = _compute_confidence(
        stage_number=stage_number,
        ma_alignment=ma_alignment,
        slope_sign_50=slope_sign_50,
        n_bars=len(bars),
        sma_200=sma_200,
    )

    direction = _direction_for_stage(stage_number)

    # ---- Levels per stage ----
    entry, entry_condition, stop, stop_basis, target, target_secondary = (
        _build_levels(
            stage_number=stage_number,
            ema_20=ema_20,
            recent_swing_high=recent_swing_high,
            recent_swing_low=recent_swing_low,
            base_high=base_high,
            current_close=current_close,
            prior_advance_pct=prior_advance_pct,
        )
    )
    rr = _risk_reward(entry, stop, target)

    # ---- Quality components ----
    geometry_score = _geometry_score(stage_number, ma_alignment, slope_sign_50)
    volume_score = _volume_score(stage_number, vol_avg_20, vol_avg_60,
                                 pre_base_vol_avg)
    context_score = 100.0  # the stage IS the context
    historical_score = 50.0

    # ---- Anchors / extras / geometry ----
    anchor = {"t": int(last_bar["t"]), "price": current_close}

    extras = {
        "stage_number": int(stage_number),
        "stage_name": stage_name,
        "sma_50": _round_or_none(sma_50, 4),
        "sma_150": _round_or_none(sma_150, 4),
        "sma_200": _round_or_none(sma_200, 4),
        "ema_20": _round_or_none(ema_20, 4),
        "sma_50_slope_pct_per_bar": round(sma_50_slope_pct_per_bar, 6),
        "sma_50_annualized_slope_pct": round(sma_50_annualized_slope, 4),
        "ma_alignment": str(ma_alignment),
        "current_close": round(current_close, 4),
        "distance_to_50sma_pct": _round_or_none(distance_to_50sma_pct, 4),
        "distance_to_200sma_pct": _round_or_none(distance_to_200sma_pct, 4),
        "distance_to_20ema_pct": _round_or_none(distance_to_20ema_pct, 4),
        "regime": str(context.get("regime", "unknown")),
        "rs_trend": str(context.get("rs_trend", "flat")),
        "volume_signature": str(context.get("volume_signature", "neutral")),
        "vol_avg_20": round(vol_avg_20, 2),
        "vol_avg_60": round(vol_avg_60, 2),
        "pre_base_vol_avg": round(pre_base_vol_avg, 2),
        "volume_drop_pct": round(volume_drop_pct, 3),
        "window_bars": int(window_bars_actual),
        "n_bars_available": int(len(bars)),
        "recent_swing_high": _round_or_none(recent_swing_high, 4),
        "recent_swing_low": _round_or_none(recent_swing_low, 4),
        "base_high": _round_or_none(base_high, 4),
        "prior_advance_pct": _round_or_none(prior_advance_pct, 4),
        "slope_sign_50": int(slope_sign_50),
        "slope_sign_20": int(slope_sign_20),
        "confidence_components": confidence_components,
        "dcr_score_adj": 0.0,
    }

    # ---- Narrative ----
    narrative = _compose_narrative(
        stage_number=stage_number,
        stage_name=stage_name,
        ma_alignment=ma_alignment,
        current_close=current_close,
        sma_50=sma_50,
        sma_200=sma_200,
        sma_150=sma_150,
        ema_20=ema_20,
        sma_50_slope_pct_per_bar=sma_50_slope_pct_per_bar,
        sma_50_annualized_slope=sma_50_annualized_slope,
        distance_to_50sma_pct=distance_to_50sma_pct,
        distance_to_200sma_pct=distance_to_200sma_pct,
        distance_to_20ema_pct=distance_to_20ema_pct,
        vol_avg_20=vol_avg_20,
        pre_base_vol_avg=pre_base_vol_avg,
        volume_drop_pct=volume_drop_pct,
        n_bars=len(bars),
        regime=context.get("regime", "unknown"),
        rs_trend=context.get("rs_trend", "flat"),
        volume_signature=context.get("volume_signature", "neutral"),
        confidence=confidence,
        prior_advance_pct=prior_advance_pct,
        base_high=base_high,
        recent_swing_high=recent_swing_high,
        recent_swing_low=recent_swing_low,
    )

    headline = narrative["headline"]
    what_it_is = narrative["what_it_is"]
    why_it_matters = narrative["why_it_matters"]
    what_to_watch_for = narrative["what_to_watch_for"]
    failure_signal = narrative["failure_signal"]

    now = int(time.time())
    start_t = int(bars[max(0, last_bar_idx - window_bars_actual + 1)]["t"])

    detection: Detection = {
        "id": str(uuid.uuid4()),
        "sym": "",
        "tf": "",
        "pattern_id": _PATTERN_ID,
        "pattern_name": "Weinstein Stage Analysis",
        "category": "structure",
        "direction": direction,
        "start_t": start_t,
        "end_t": int(last_bar["t"]),
        "pivot_ts": [int(last_bar["t"])],
        "geometry": {
            "shape": "candle_mark",
            "anchors": [anchor],
            "extras": extras,
        },
        "levels": {
            "entry": entry,
            "entry_condition": entry_condition,
            "stop": stop,
            "stop_basis": stop_basis,
            "target_primary": target,
            "target_secondary": target_secondary,
            "risk_reward": rr,
        },
        "context": context,
        "confidence": confidence,
        "quality_components": {
            "geometry_score": round(float(geometry_score), 2),
            "volume_score": round(float(volume_score), 2),
            "context_score": round(float(context_score), 2),
            "historical_score": round(float(historical_score), 2),
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
    return [detection]


# ---------------------------------------------------------------------------
# Helpers - math
# ---------------------------------------------------------------------------

def _ema(values: List[float], period: int) -> Optional[float]:
    """Latest EMA value or None if insufficient data."""
    if len(values) < period:
        return None
    k = 2.0 / (period + 1)
    # Seed with the SMA of the first `period` values
    ema = sum(values[:period]) / period
    for v in values[period:]:
        ema = v * k + ema * (1.0 - k)
    return float(ema)


def _sma_slope_pct(values: List[float], period: int, window: int) -> float:
    """Compute SMA(period)'s % change per bar over the last `window` bars.

    Returns 0.0 if insufficient data.
    """
    if len(values) < period + window:
        return 0.0
    # SMA series at the last `window+1` points
    sma_now = sum(values[-period:]) / period
    sma_past = sum(values[-period - window:-window]) / period
    if sma_past <= 0:
        return 0.0
    total_pct = (sma_now - sma_past) / sma_past * 100.0
    return total_pct / float(window)


def _safe_distance_pct(price: float, ma: Optional[float]) -> Optional[float]:
    if ma is None or ma <= 0:
        return None
    return (price - ma) / ma * 100.0


def _round_or_none(v: Optional[float], digits: int) -> Optional[float]:
    if v is None:
        return None
    return round(float(v), digits)


def _avg_volume(bars: List[Bar], lookback: int) -> float:
    seg = bars[-lookback:] if len(bars) >= lookback else bars
    if not seg:
        return 0.0
    return sum(float(b["v"]) for b in seg) / len(seg)


def _avg_volume_window(bars: List[Bar], start: int, end: int) -> float:
    """start/end are negative offsets from the end of bars (Python slicing)."""
    if len(bars) < abs(start):
        # not enough history - fall back to all available
        if len(bars) <= abs(end):
            return _avg_volume(bars, lookback=len(bars))
        seg = bars[:end] if end < 0 else bars
        if not seg:
            return 0.0
        return sum(float(b["v"]) for b in seg) / len(seg)
    seg = bars[start:end] if end < 0 else bars[start:]
    if not seg:
        return 0.0
    return sum(float(b["v"]) for b in seg) / len(seg)


def _recent_swing(bars: List[Bar], kind: str) -> Optional[float]:
    if not bars:
        return None
    if kind == "high":
        return float(max(b["h"] for b in bars))
    return float(min(b["l"] for b in bars))


def _recent_high(bars: List[Bar]) -> Optional[float]:
    if not bars:
        return None
    return float(max(b["h"] for b in bars))


def _prior_advance_pct(bars: List[Bar], stage_number: int) -> Optional[float]:
    """For Stage 2 target projection, compute the % advance of the last leg.

    Walks back from the current bar to find the lowest low in the last 100
    bars, then expresses current_close as % above that low. Used as a coarse
    projection target.
    """
    if not bars:
        return None
    seg = bars[-100:] if len(bars) >= 100 else bars
    if not seg:
        return None
    lo = float(min(b["l"] for b in seg))
    if lo <= 0:
        return None
    cur = float(bars[-1]["c"])
    return (cur - lo) / lo * 100.0


# ---------------------------------------------------------------------------
# Helpers - confidence + scoring
# ---------------------------------------------------------------------------

def _expected_ma_alignment_for_stage(stage: int) -> Tuple[str, ...]:
    """Return the expected ma_alignment value(s) for the given stage."""
    if stage == 1:
        return ("mixed",)  # flat MAs read as mixed in the simplified primitive
    if stage == 2:
        return ("stacked_bullish",)
    if stage == 3:
        return ("mixed",)
    if stage == 4:
        return ("stacked_bearish",)
    return ("mixed",)


def _expected_slope_sign_for_stage(stage: int) -> int:
    if stage == 2:
        return 1
    if stage == 4:
        return -1
    return 0


def _direction_for_stage(stage: int) -> str:
    if stage == 2:
        return "bullish"
    if stage == 4:
        return "bearish"
    return "neutral"


def _compute_confidence(
    stage_number: int,
    ma_alignment: str,
    slope_sign_50: int,
    n_bars: int,
    sma_200: Optional[float],
) -> Tuple[float, dict]:
    """Compute confidence in [50, 100] with components dict for transparency."""
    if n_bars < _MIN_BARS_FOR_FULL_CONFIDENCE:
        # Insufficient data floor
        return 50.0, {
            "base": 50,
            "ma_stack_match_bonus": 0,
            "slope_match_bonus": 0,
            "borderline_penalty": 0,
            "insufficient_data": True,
        }

    base = 70.0
    expected_ma = _expected_ma_alignment_for_stage(stage_number)
    ma_match_bonus = 20.0 if ma_alignment in expected_ma else 0.0

    expected_slope = _expected_slope_sign_for_stage(stage_number)
    slope_match_bonus = 0.0
    if expected_slope != 0 and slope_sign_50 == expected_slope:
        slope_match_bonus = 10.0
    elif expected_slope == 0 and slope_sign_50 == 0:
        slope_match_bonus = 10.0

    borderline_penalty = 0.0
    # 200-SMA not yet established = borderline
    if sma_200 is None:
        borderline_penalty = 10.0

    raw = base + ma_match_bonus + slope_match_bonus - borderline_penalty
    clamped = max(50.0, min(100.0, raw))
    return round(clamped, 1), {
        "base": base,
        "ma_stack_match_bonus": ma_match_bonus,
        "slope_match_bonus": slope_match_bonus,
        "borderline_penalty": borderline_penalty,
        "insufficient_data": False,
    }


def _geometry_score(stage: int, ma_alignment: str, slope_sign_50: int) -> float:
    """How cleanly does the MA stack and slope align with the stage?"""
    expected_ma = _expected_ma_alignment_for_stage(stage)
    expected_slope = _expected_slope_sign_for_stage(stage)

    score = 50.0
    if ma_alignment in expected_ma:
        score += 30.0
    if expected_slope == 0 and slope_sign_50 == 0:
        score += 20.0
    elif expected_slope != 0 and slope_sign_50 == expected_slope:
        score += 20.0
    return float(min(100.0, max(0.0, score)))


def _volume_score(stage: int, vol_avg_20: float, vol_avg_60: float,
                  pre_base_vol_avg: float) -> float:
    """How well does the recent volume signature match the stage?

    Stage 1 - volume should be DRYING UP (vol_avg_20 < pre_base_vol_avg).
    Stage 2 - volume should be EXPANDING (vol_avg_20 > vol_avg_60).
    Stage 3 - volume mixed, often slight expansion on down days.
    Stage 4 - volume expanding on declines.
    """
    if vol_avg_20 <= 0:
        return 50.0

    if stage == 1:
        if pre_base_vol_avg <= 0:
            return 50.0
        ratio = vol_avg_20 / pre_base_vol_avg
        if ratio <= 0.5: return 100.0
        if ratio <= 0.7: return 85.0
        if ratio <= 0.9: return 65.0
        if ratio <= 1.1: return 50.0
        return 30.0
    if stage == 2:
        if vol_avg_60 <= 0:
            return 60.0
        ratio = vol_avg_20 / vol_avg_60
        if ratio >= 1.5: return 100.0
        if ratio >= 1.2: return 80.0
        if ratio >= 1.0: return 60.0
        if ratio >= 0.8: return 50.0
        return 35.0
    if stage == 3:
        # Mixed volume, slight expansion preferred
        return 55.0
    if stage == 4:
        if vol_avg_60 <= 0:
            return 60.0
        ratio = vol_avg_20 / vol_avg_60
        if ratio >= 1.3: return 90.0
        if ratio >= 1.0: return 70.0
        return 50.0
    return 50.0


# ---------------------------------------------------------------------------
# Helpers - levels per stage
# ---------------------------------------------------------------------------

def _build_levels(
    stage_number: int,
    ema_20: Optional[float],
    recent_swing_high: Optional[float],
    recent_swing_low: Optional[float],
    base_high: Optional[float],
    current_close: float,
    prior_advance_pct: Optional[float],
) -> Tuple[Optional[float], str, Optional[float], str,
           Optional[float], Optional[float]]:
    """Stage-specific entry/stop/target levels."""
    if stage_number == 1:
        # Stage 1: not a trade trigger, reference the base high
        entry = _round_or_none(base_high, 2)
        entry_condition = (
            "Stage 1 base - not a trade trigger; reference the breakout level "
            f"at ${base_high:.2f}"
            if base_high is not None else
            "Stage 1 base - not a trade trigger; insufficient bars to fix a "
            "breakout reference"
        )
        return entry, entry_condition, None, "", None, None

    if stage_number == 2:
        # Stage 2: buy pullbacks to 20EMA, stop below recent swing low,
        # target = projection of prior advance.
        entry = _round_or_none(ema_20, 2) if ema_20 is not None else None
        entry_condition = (
            f"Stage 2 long - buy pullbacks to the 20-EMA at ${ema_20:.2f} on "
            "declining volume; trail stops on the 20-EMA"
            if ema_20 is not None else
            "Stage 2 long - 20-EMA reference unavailable; size on bar-by-bar "
            "trend continuation"
        )
        stop = (
            _round_or_none(recent_swing_low * 0.99, 2)
            if recent_swing_low is not None else None
        )
        stop_basis = (
            "1% below the most recent 40-bar swing low at "
            f"${recent_swing_low:.2f}"
            if recent_swing_low is not None else ""
        )
        # Target: project the prior advance % up from current close as a coarse
        # measured-move estimate
        target = None
        if prior_advance_pct is not None and prior_advance_pct > 0:
            target = round(current_close * (1.0 + prior_advance_pct / 100.0), 2)
        return entry, entry_condition, stop, stop_basis, target, None

    if stage_number == 3:
        # Stage 3: warning, no new longs
        entry_condition = (
            "Stage 3 distribution warning - do NOT initiate new longs; trim "
            "existing positions and tighten stops on remaining longs"
        )
        return None, entry_condition, None, "", None, None

    # Stage 4
    entry = _round_or_none(ema_20, 2) if ema_20 is not None else None
    entry_condition = (
        f"Stage 4 short - consider shorts on rallies to the 20-EMA at "
        f"${ema_20:.2f} with stops above the most recent swing high; avoid "
        "long positions entirely"
        if ema_20 is not None else
        "Stage 4 short - 20-EMA reference unavailable; avoid longs and look "
        "for short setups on counter-trend rallies"
    )
    stop = (
        _round_or_none(recent_swing_high * 1.01, 2)
        if recent_swing_high is not None else None
    )
    stop_basis = (
        "1% above the most recent 40-bar swing high at "
        f"${recent_swing_high:.2f}"
        if recent_swing_high is not None else ""
    )
    return entry, entry_condition, stop, stop_basis, None, None


def _risk_reward(entry: Optional[float], stop: Optional[float],
                 target: Optional[float]) -> float:
    if entry is None or stop is None or target is None:
        return 0.0
    denom = abs(float(entry) - float(stop))
    if denom <= 0:
        return 0.0
    return round(abs(float(target) - float(entry)) / denom, 2)


# ---------------------------------------------------------------------------
# Helpers - narrative
# ---------------------------------------------------------------------------

def _ma_alignment_descriptor(alignment: str) -> str:
    return {
        "stacked_bullish": (
            "fully stacked-bullish (close > 10-SMA > 20-SMA > 50-SMA > 200-SMA)"
        ),
        "stacked_bearish": (
            "fully stacked-bearish (close < 10-SMA < 20-SMA < 50-SMA < 200-SMA)"
        ),
        "mixed": (
            "mixed (no clean directional stacking - the typical signature of a "
            "transitional or sideways phase)"
        ),
    }.get(alignment, f"{alignment}")


def _trending_descriptor(slope_pct_per_bar: float) -> str:
    if slope_pct_per_bar > 0.05:
        return "rising"
    if slope_pct_per_bar < -0.05:
        return "falling"
    return "flat"


def _stage_quality_descriptor(stage: int, n_bars: int,
                              ma_alignment: str) -> str:
    expected = _expected_ma_alignment_for_stage(stage)
    if ma_alignment in expected:
        if n_bars >= 200:
            return "high-quality classification with full 200-bar context"
        return "good-quality classification but reduced bar count"
    return "borderline classification - MA stack does not fully confirm the stage"


def _position_descriptor(current_close: float, sma: Optional[float]) -> str:
    if sma is None or sma <= 0:
        return "with no 200-SMA reference available"
    if current_close > sma * 1.05:
        return f"comfortably above"
    if current_close > sma:
        return "just above"
    if current_close > sma * 0.95:
        return "just below"
    return "well below"


def _compose_narrative(
    stage_number: int,
    stage_name: str,
    ma_alignment: str,
    current_close: float,
    sma_50: Optional[float],
    sma_200: Optional[float],
    sma_150: Optional[float],
    ema_20: Optional[float],
    sma_50_slope_pct_per_bar: float,
    sma_50_annualized_slope: float,
    distance_to_50sma_pct: Optional[float],
    distance_to_200sma_pct: Optional[float],
    distance_to_20ema_pct: Optional[float],
    vol_avg_20: float,
    pre_base_vol_avg: float,
    volume_drop_pct: float,
    n_bars: int,
    regime: str,
    rs_trend: str,
    volume_signature: str,
    confidence: float,
    prior_advance_pct: Optional[float],
    base_high: Optional[float],
    recent_swing_high: Optional[float],
    recent_swing_low: Optional[float],
) -> dict:
    """Compose a stage-specific paragraph-length narrative."""
    ma_desc = _ma_alignment_descriptor(ma_alignment)
    trending_desc = _trending_descriptor(sma_50_slope_pct_per_bar)
    quality_desc = _stage_quality_descriptor(stage_number, n_bars, ma_alignment)
    above_or_below_50 = (
        "above" if (sma_50 is not None and current_close > sma_50) else "below"
    )
    sma_50_str = f"${sma_50:.2f}" if sma_50 is not None else "(insufficient bars)"
    sma_200_str = f"${sma_200:.2f}" if sma_200 is not None else "not yet established (insufficient bars)"
    sma_150_str = f"${sma_150:.2f}" if sma_150 is not None else "not yet established"
    ema_20_str = f"${ema_20:.2f}" if ema_20 is not None else "(insufficient bars)"
    distance_50_str = (
        f"{distance_to_50sma_pct:+.2f}%"
        if distance_to_50sma_pct is not None else "n/a"
    )
    distance_200_str = (
        f"{distance_to_200sma_pct:+.2f}%"
        if distance_to_200sma_pct is not None else "n/a"
    )
    pre_base_vol_str = (
        f"{pre_base_vol_avg:,.0f}" if pre_base_vol_avg > 0 else "n/a"
    )
    base_high_str = f"${base_high:.2f}" if base_high is not None else "n/a"
    prior_advance_str = (
        f"{prior_advance_pct:.1f}%"
        if prior_advance_pct is not None else "n/a"
    )
    swing_high_str = (
        f"${recent_swing_high:.2f}" if recent_swing_high is not None else "n/a"
    )
    swing_low_str = (
        f"${recent_swing_low:.2f}" if recent_swing_low is not None else "n/a"
    )
    sma_50_slope_str = f"{sma_50_slope_pct_per_bar:+.4f}%/bar"

    # ---- HEADLINE ----
    headline = (
        f"Stage {stage_number} - {stage_name}: current close ${current_close:.2f} "
        f"{above_or_below_50} 50-SMA ({sma_50_str}), 50-SMA "
        f"{trending_desc} at {sma_50_slope_str}, MA stack {ma_alignment}, "
        f"confidence {confidence:.0f}."
    )

    # ---- STAGE-SPECIFIC BODY ----
    if stage_number == 1:
        what_it_is = (
            f"This chart is in Stan Weinstein's Stage 1 - the Basing / "
            f"Accumulation phase of the four-stage institutional cycle. After "
            f"a prior downtrend, price has flattened and is consolidating, "
            f"with the 30-week (~150-bar) moving average at {sma_150_str} now "
            f"effectively horizontal and the 50-SMA at {sma_50_str} reading "
            f"a slope of {sma_50_slope_str} (annualized "
            f"{sma_50_annualized_slope:+.1f}%). Stage 1 is where smart money "
            f"quietly accumulates shares from retail sellers who are exhausted "
            f"from the prior decline; volume dries up dramatically - here the "
            f"20-bar average is {vol_avg_20:,.0f} vs the 60-bar pre-base "
            f"average of {pre_base_vol_str}, a {volume_drop_pct:.1f}% decline, "
            f"the institutional signature of accumulation absent price markup. "
            f"The current MA alignment reads {ma_desc}, and price is trading "
            f"{distance_50_str} from the 50-SMA. Stage 1 phases historically "
            f"last 5 weeks to 6 months - the longer the base, the stronger the "
            f"subsequent Stage 2 advance because more shares get transferred "
            f"from weak hands to strong hands. The current bar is "
            f"{_position_descriptor(current_close, sma_200)} the 200-SMA "
            f"({sma_200_str}, {distance_200_str}), and this is a "
            f"{quality_desc}. Oliver Kell's 'Victorious Stock Operator' "
            f"5-stage Cycle of Price Action — reversal extension → wedge "
            f"pop → exhaustion extension → wedge drop → base & breakout — "
            f"maps onto Weinstein's 4 stages but is more granular and "
            f"action-oriented; Weinstein's Stage 1 corresponds to the "
            f"tail end of Kell's wedge drop transitioning into the base & "
            f"breakout phase, where institutional accumulation is silently "
            f"setting up the next mark-up leg."
        )
        why_it_matters = (
            f"Stage 1 is the FOUNDATIONAL context for every other pattern on "
            f"the chart - the interpretation of any setup changes dramatically "
            f"depending on which stage produced it. Episodic Pivots in Stage 1 "
            f"can MARK the transition to Stage 2 if they break out of the base "
            f"with conviction, so an EP appearing in a Stage 1 base is one of "
            f"the highest-quality trade signals in technical analysis. VCPs, "
            f"flat bases, and cup-with-handle patterns that form INSIDE a "
            f"Stage 1 base have a higher win rate than the same patterns in "
            f"any other stage because they coincide with the broader "
            f"transition from accumulation to markup. Conversely, a Stage 1 "
            f"environment is a poor place to look for short setups - the "
            f"selling pressure has already been exhausted and the path of "
            f"least resistance, once it resolves, tends to be up. The current "
            f"{regime} regime adds further texture to position-sizing "
            f"decisions, with {rs_trend} relative strength versus the broader "
            f"market and {volume_signature} volume signature. Stage 1 bases "
            f"are where the largest institutional positions are quietly built "
            f"and where the most profitable swing-trade entries are sourced - "
            f"smart money preferentially fishes here because the risk/reward "
            f"asymmetry is at its lifetime peak."
        )
        what_to_watch_for = (
            f"Watch for the breakout above the base high at {base_high_str} on "
            f"volume of at least 1.5x the 20-bar average ({vol_avg_20:,.0f}) - "
            f"that's the trigger that confirms the transition from Stage 1 to "
            f"Stage 2 and is the highest-probability entry on the entire chart. "
            f"Pre-breakout signals to track: (1) the 50-SMA at {sma_50_str} "
            f"flattening and beginning to curl up - rising 50-SMA is the early "
            f"institutional fingerprint; (2) volume drying up to multi-month "
            f"lows in the final 1-3 weeks before the break - quiet bases are "
            f"the launchpads for explosive Stage 2 moves; (3) higher lows "
            f"forming inside the base, with each pullback shallower than the "
            f"prior (the VCP signature); (4) relative strength versus the "
            f"broader market improving from {rs_trend} - leadership typically "
            f"shows up in RS BEFORE it shows up in absolute price. Position "
            f"sizing should reflect the asymmetry: the stop is just below the "
            f"most recent 40-bar swing low at {swing_low_str}, the target is "
            f"the prior structural high or a measured projection of the base "
            f"depth, and the R:R on Stage 1 -> Stage 2 transitions is "
            f"historically 3:1 or better on clean setups."
        )
        failure_signal = (
            f"The Stage 1 classification fails if price breaks DOWN through "
            f"the most recent 40-bar swing low at {swing_low_str} on volume "
            f">1.5x average, with the 50-SMA at {sma_50_str} simultaneously "
            f"turning DOWN (negative slope). That's a Stage 1 -> Stage 4 "
            f"transition - the worst possible outcome - and the stock often "
            f"loses another 20-50% before bottoming. Less catastrophic failure "
            f"modes: (a) the base is FALSE and price chops sideways for 6+ "
            f"more months without resolving (the 'graveyard base' - capital "
            f"opportunity-cost loss only); (b) the breakout fails and price "
            f"re-enters the base within 5 bars on weak follow-through volume - "
            f"this is the classic 'failed breakout' and is the textbook "
            f"warning sign to step aside and wait for a fresh setup; (c) the "
            f"50-SMA refuses to turn up after 3-6 months of basing - "
            f"institutional accumulation is absent and the stock is simply "
            f"forgotten by the market. Stage 1 positioning is always "
            f"speculative at the base-formation phase and should be sized "
            f"accordingly; full institutional position sizes should be "
            f"reserved for after the Stage 2 breakout confirms with volume "
            f"AND the 50-SMA inflects up."
        )
    elif stage_number == 2:
        what_it_is = (
            f"This chart is in Stan Weinstein's Stage 2 - the institutional "
            f"Markup / Uptrend phase. The 30-week (~150-bar) moving average is "
            f"at {sma_150_str} and rising, the 50-SMA at {sma_50_str} carries "
            f"a slope of {sma_50_slope_str} (annualized "
            f"{sma_50_annualized_slope:+.1f}%), and price is trading "
            f"{distance_50_str} above the 50-SMA. The MA alignment reads "
            f"{ma_desc}, reflecting the institutional fingerprint where every "
            f"successive higher moving average sits above the next-lower one. "
            f"Stage 2 is where the bulk of money is made in growth-stock "
            f"investing - institutional buyers systematically build positions "
            f"during pullbacks, and price advances in a measured series of "
            f"higher highs and higher lows with each leg up confirmed by "
            f"rising volume. The current bar at ${current_close:.2f} is "
            f"{distance_to_50sma_pct:+.2f}% from the 50-SMA - a healthy "
            f"positioning that supports a continued long bias without being "
            f"dangerously over-extended (extensions of 15-25%+ tend to precede "
            f"short-term corrections back to the 20-EMA at {ema_20_str}). "
            f"This is a {quality_desc} - the 20-bar volume average of "
            f"{vol_avg_20:,.0f} reflects active institutional engagement. "
            f"Oliver Kell's 'Victorious Stock Operator' 5-stage Cycle of "
            f"Price Action — reversal extension → wedge pop → exhaustion "
            f"extension → wedge drop → base & breakout — provides a more "
            f"granular, action-oriented map than Weinstein's 4 stages; "
            f"Weinstein's Stage 2 corresponds to Kell's base-and-breakout "
            f"and reversal-extension phases, where the markup leg accelerates "
            f"out of the prior consolidation. Kristjan Kullamägi operates "
            f"almost exclusively in this exact transition — Stage 2 / Kell "
            f"base-and-breakout — and treats any setup forming outside this "
            f"context as a markedly lower-edge trade."
        )
        why_it_matters = (
            f"Stage 2 is the highest-edge environment for long-side trading. "
            f"Episodic Pivots in Stage 2 produce 70%+ continuation rates "
            f"because the institutional bid is already established and an EP "
            f"is simply a fresh leg of accumulation. VCPs, flat bases, and "
            f"cup-with-handle patterns that form INSIDE Stage 2 are textbook "
            f"buy setups - the broader trend is the wind at their back, and "
            f"the base merely catches breath before the next leg up. "
            f"Conversely, head-and-shoulders tops, double tops, and rising "
            f"wedges in Stage 2 frequently FAIL because the institutional bid "
            f"absorbs the supply that those bearish patterns require. The "
            f"current {regime} regime with {rs_trend} relative strength and "
            f"{volume_signature} volume signature creates a setup where long "
            f"exposure should be elevated; portfolio-level position sizing in "
            f"Stage 2 typically runs 100-150% of book in concentrated leaders, "
            f"with stops trailed on the rising 20-EMA. The defining "
            f"characteristic of Stage 2 is that PULLBACKS GET BOUGHT - and the "
            f"single best location to add or initiate is the 20-EMA at "
            f"{ema_20_str}, where institutional limit orders cluster. Risk "
            f"management in Stage 2 is forgiving: the trend itself is the "
            f"primary edge, and time in the market generally beats market "
            f"timing inside this phase."
        )
        what_to_watch_for = (
            f"Watch for pullbacks to the 20-EMA at {ema_20_str} on declining "
            f"volume - that's the ideal Stage 2 add or initiate point. The "
            f"50-SMA at {sma_50_str} is the deeper structural support; "
            f"pullbacks to the 50 on light volume are 'second-chance' entries "
            f"that work but require wider stops. Higher highs and higher lows "
            f"should print on each successive leg - if either fails to print "
            f"(i.e., a lower high or lower low appears), Stage 2 is at risk. "
            f"Monitor volume on the bounces off the 20-EMA - rising volume "
            f"on the bounce versus drying volume on the pullback is the "
            f"textbook accumulation signature. Earnings reactions in Stage 2 "
            f"tend to be additive: a Power Earnings Gap on top of a Stage 2 "
            f"trend often produces 30-60% moves within 6-12 weeks, while a "
            f"disappointing earnings reaction tends to be quickly bought. The "
            f"prior advance from the most recent swing low at {swing_low_str} "
            f"to current price is {prior_advance_str} - this is a useful "
            f"projection reference for next-leg targets, with measured-move "
            f"projections placing potential targets ~{prior_advance_str} above "
            f"current price. Tighten stops as the trend matures; Stage 2 "
            f"transitions to Stage 3 quietly and the early warning is "
            f"deteriorating volume on rallies."
        )
        failure_signal = (
            f"Stage 2 fails when price closes below the 50-SMA at "
            f"{sma_50_str} on volume >1.5x average AND the 50-SMA "
            f"simultaneously turns down (negative slope). That's the Stage 2 "
            f"-> Stage 3 transition - usually marked by a series of "
            f"distribution days (heavy-volume down sessions) that begin to "
            f"accumulate inside the prior uptrend. Less catastrophic warning "
            f"signs: (a) the 20-EMA at {ema_20_str} fails to hold on a "
            f"pullback for the first time in many weeks - this is the first "
            f"crack in the institutional bid; (b) rallies begin to print on "
            f"LIGHTER volume than the preceding pullbacks - the reverse of "
            f"the textbook accumulation signature; (c) the most recent swing "
            f"high at {swing_high_str} fails to be exceeded on a subsequent "
            f"rally attempt - that's a lower high, the structural definition "
            f"of trend change; (d) relative strength versus the broader "
            f"market deteriorates from {rs_trend} - leadership stocks lose "
            f"their RS BEFORE they lose absolute price. The single most "
            f"reliable Stage 2 failure trigger is the 30-week (~150-bar) "
            f"moving average at {sma_150_str} rolling over - that change of "
            f"trend tells you the institutional bid has stepped aside and the "
            f"long thesis is no longer working. Risk-off discipline in Stage "
            f"2 means trimming size into strength, not selling into weakness."
        )
    elif stage_number == 3:
        what_it_is = (
            f"This chart is in Stan Weinstein's Stage 3 - the Distribution / "
            f"Topping phase. After a Stage 2 advance, price has stalled and "
            f"the 30-week (~150-bar) moving average at {sma_150_str} has "
            f"flattened from its prior rising trajectory. The 50-SMA at "
            f"{sma_50_str} carries a slope of {sma_50_slope_str} (annualized "
            f"{sma_50_annualized_slope:+.1f}%) and price is trading "
            f"{distance_50_str} from it with no clear directional bias. The "
            f"MA alignment reads {ma_desc}. Stage 3 is the WARNING phase - "
            f"smart money is systematically distributing shares to retail "
            f"buyers who are still chasing the prior Stage 2 advance; "
            f"distribution days (heavy-volume down sessions) begin to "
            f"accumulate inside the topping action, while rallies fail to "
            f"print on the conviction-volume that defined the Stage 2 phase. "
            f"The volume signature is {volume_signature} and the recent "
            f"20-bar average of {vol_avg_20:,.0f} reflects the choppy "
            f"two-sided flow characteristic of institutional distribution. "
            f"This is a {quality_desc}, and the 200-SMA reference at "
            f"{sma_200_str} (price is {distance_200_str} from it) provides "
            f"context for how far the move has extended. Oliver Kell's "
            f"'Victorious Stock Operator' 5-stage Cycle of Price Action — "
            f"reversal extension → wedge pop → exhaustion extension → wedge "
            f"drop → base & breakout — provides a more granular, action-"
            f"oriented map than Weinstein's 4 stages; Weinstein's Stage 3 "
            f"corresponds to Kell's exhaustion-extension and early wedge-"
            f"drop phases, where institutional distribution begins absorbing "
            f"the late-cycle FOMO buying that defined the prior markup."
        )
        why_it_matters = (
            f"Stage 3 is the most DANGEROUS phase for trend-following "
            f"long-only investors - the trend that worked all the way through "
            f"Stage 2 stops working WITHOUT producing an obvious change-of-"
            f"character signal. Episodic Pivots and breakout setups in Stage "
            f"3 routinely fail because the institutional bid that supported "
            f"them in Stage 2 has stepped aside. VCPs and flat bases in "
            f"Stage 3 are particularly treacherous - they LOOK like the same "
            f"pattern that worked in Stage 2 but produce 'failed breakout' "
            f"outcomes at much higher rates because the broader stage is no "
            f"longer aligned. The current {regime} regime and {rs_trend} "
            f"relative strength create a setup where defensive positioning "
            f"makes sense: trim winners, raise stops on remaining longs, and "
            f"do NOT initiate new long positions. Stage 3 phases historically "
            f"resolve into Stage 4 declines roughly 60-70% of the time and "
            f"back into renewed Stage 2 advances about 30-40% of the time - "
            f"the outcome distribution is asymmetric to the downside. Smart "
            f"money's primary action in Stage 3 is to HARVEST the gains "
            f"earned in Stage 2 and rotate capital into fresh Stage 1 bases "
            f"in other names. Risk management in Stage 3 is non-negotiable: "
            f"the cost of holding through a Stage 3 -> Stage 4 transition is "
            f"the destruction of months of accumulated Stage 2 gains in a few "
            f"weeks of markdown."
        )
        what_to_watch_for = (
            f"Watch for distribution days (down sessions on volume >1.3x the "
            f"20-bar average of {vol_avg_20:,.0f}) - the textbook count is "
            f"4-5 distribution days in a 25-bar window is the institutional "
            f"warning that Stage 3 is transitioning to Stage 4. Track the "
            f"50-SMA at {sma_50_str} - the moment it inflects DOWN (negative "
            f"slope) and price closes below it on volume, the Stage 3 -> "
            f"Stage 4 transition is confirmed. Other Stage 3 warning signals: "
            f"(a) the most recent swing high at {swing_high_str} failing to "
            f"be exceeded on rallies - that's a lower high, the structural "
            f"definition of trend change; (b) the most recent swing low at "
            f"{swing_low_str} being breached on a heavy-volume day - that's "
            f"a lower low, the confirmation of the change; (c) relative "
            f"strength versus the broader market deteriorating from "
            f"{rs_trend} - leaders lose RS first; (d) the 30-week (~150-bar) "
            f"moving average at {sma_150_str} rolling over from its prior "
            f"rising trajectory. The Stage 3 -> Stage 2 (renewed) resolution "
            f"is signaled by: (a) volume drying up on pullbacks rather than "
            f"expanding; (b) the 50-SMA flattening then re-inflecting up; "
            f"(c) a fresh higher high above the most recent Stage 3 peak."
        )
        failure_signal = (
            f"Stage 3 classification is invalidated in two directions. The "
            f"BEARISH resolution (Stage 3 -> Stage 4) is confirmed when price "
            f"closes below the 50-SMA at {sma_50_str} by >2% on volume >1.5x "
            f"average AND the 50-SMA simultaneously turns down (negative "
            f"slope) - this is the textbook transition and typically marks "
            f"the beginning of a multi-month decline. The BULLISH resolution "
            f"(Stage 3 -> renewed Stage 2) is confirmed when price prints a "
            f"fresh higher high above the most recent swing high at "
            f"{swing_high_str} on volume >1.5x average, with the 50-SMA "
            f"holding its prior rising slope. Stage 3 classifications are "
            f"INHERENTLY borderline because the data IS ambiguous in this "
            f"phase - that's why the confidence floor sits lower than for "
            f"Stage 2 or Stage 4. The most common Stage 3 outcome is a "
            f"6-16 week topping range followed by a clean Stage 4 markdown - "
            f"the longer the Stage 3 phase, the more thoroughly institutional "
            f"distribution has been completed and the cleaner the subsequent "
            f"Stage 4 decline tends to be. Risk-off discipline is the only "
            f"sustainable Stage 3 posture: harvest the Stage 2 gains, rotate "
            f"capital into fresh Stage 1 bases, and wait for the next "
            f"institutional cycle to begin."
        )
    else:  # Stage 4
        what_it_is = (
            f"This chart is in Stan Weinstein's Stage 4 - the Markdown / "
            f"Downtrend phase. The 30-week (~150-bar) moving average at "
            f"{sma_150_str} is falling and price is trading below it; the "
            f"50-SMA at {sma_50_str} carries a slope of {sma_50_slope_str} "
            f"(annualized {sma_50_annualized_slope:+.1f}%), reflecting the "
            f"strength of the institutional supply. The MA alignment reads "
            f"{ma_desc} and price is trading {distance_50_str} from the "
            f"50-SMA - typically below it in clean Stage 4 decline. Stage 4 "
            f"is the phase where short positions work and long positions "
            f"destroy capital - institutional sellers systematically "
            f"distribute, and price declines in a measured series of lower "
            f"highs and lower lows with each leg down confirmed by expanding "
            f"volume. The current bar at ${current_close:.2f} is "
            f"{_position_descriptor(current_close, sma_200)} the 200-SMA "
            f"({sma_200_str}, {distance_200_str}) and the 20-bar volume "
            f"average of {vol_avg_20:,.0f} reflects active institutional "
            f"distribution. This is a {quality_desc}. Oliver Kell's "
            f"'Victorious Stock Operator' 5-stage Cycle of Price Action — "
            f"reversal extension → wedge pop → exhaustion extension → wedge "
            f"drop → base & breakout — provides a more granular, action-"
            f"oriented map than Weinstein's 4 stages; Weinstein's Stage 4 "
            f"corresponds to Kell's full wedge-drop phase, where institutional "
            f"supply systematically marks the stock down through a series of "
            f"failed bounces. The stage will eventually transition back to "
            f"Kell's base-and-breakout / Weinstein's Stage 1 once distribution "
            f"completes and accumulation can begin again."
        )
        why_it_matters = (
            f"Stage 4 is the FOUNDATIONAL bearish context. Episodic Pivots "
            f"in Stage 4 are usually short-term short squeezes that FADE "
            f"within a few bars - the institutional supply re-asserts and "
            f"the down-trend resumes. VCPs and flat bases that form INSIDE "
            f"Stage 4 are bear-flag continuations dressed up as bullish "
            f"setups; they routinely fail at the breakout level because the "
            f"broader stage is hostile. Head-and-shoulders tops, rising "
            f"wedges, and double tops that form INSIDE Stage 4 are textbook "
            f"high-edge short setups - the broader trend is the wind at "
            f"their back. The current {regime} regime with {rs_trend} "
            f"relative strength and {volume_signature} volume signature "
            f"creates a setup where SHORT exposure can be elevated and LONG "
            f"exposure must be either avoided or aggressively hedged. The "
            f"defining characteristic of Stage 4 is that RALLIES GET SOLD - "
            f"the textbook short entry is on a rally to the 20-EMA at "
            f"{ema_20_str}, where institutional supply orders cluster. "
            f"Capital preservation is the primary objective in Stage 4 - "
            f"trend-following long-only investors should sit in cash or in "
            f"Stage 1 bases of unrelated names rather than trying to bottom-"
            f"fish a Stage 4 decline. Stage 4 phases historically last 3-8 "
            f"weeks of acute decline before transitioning to Stage 1 basing, "
            f"and the most damaging period for buy-and-hold investors."
        )
        what_to_watch_for = (
            f"For shorts: watch for rallies to the 20-EMA at {ema_20_str} on "
            f"weak volume - that's the ideal Stage 4 short-the-rally entry. "
            f"Stops above the most recent 40-bar swing high at "
            f"{swing_high_str}; targets at the most recent swing low at "
            f"{swing_low_str} or a measured-move projection of the prior "
            f"down-leg. The 50-SMA at {sma_50_str} is the deeper structural "
            f"resistance for shorts; rallies to the 50 on light volume are "
            f"prime second-chance shorts. Lower highs and lower lows should "
            f"print on each successive leg - if either fails to print, "
            f"Stage 4 is at risk of transitioning to Stage 1 basing. For "
            f"longs: AVOID entirely. The textbook Stage 4 -> Stage 1 "
            f"transition is signaled by: (a) volume drying up on declines "
            f"rather than expanding - sellers becoming exhausted; (b) the "
            f"50-SMA flattening from its prior falling trajectory; (c) a "
            f"fresh higher low above the most recent Stage 4 trough; (d) "
            f"relative strength versus the broader market improving from "
            f"{rs_trend}. The single best long entry on the entire chart is "
            f"the breakout from the FUTURE Stage 1 base that forms at the "
            f"end of Stage 4 - patience now will be rewarded with a high-"
            f"edge entry in 1-6 months."
        )
        failure_signal = (
            f"Stage 4 classification fails when price reclaims the 50-SMA at "
            f"{sma_50_str} on volume >1.5x average AND the 50-SMA "
            f"simultaneously turns up (positive slope). That's the Stage 4 "
            f"-> Stage 1 (then Stage 2) transition and is one of the most "
            f"powerful long-side setups in the market - the down-trend has "
            f"exhausted itself and a fresh institutional cycle is beginning. "
            f"Less catastrophic short-side warning signs (that the short "
            f"trade is at risk but Stage 4 is still intact): (a) the 20-EMA "
            f"at {ema_20_str} fails to act as resistance on a rally for the "
            f"first time in many weeks - the first crack in the "
            f"institutional supply; (b) declines begin to print on LIGHTER "
            f"volume than the preceding rallies - the reverse of the "
            f"textbook distribution signature; (c) the most recent swing low "
            f"at {swing_low_str} holds on a subsequent retest rather than "
            f"being broken - that's a higher low, the structural definition "
            f"of trend change; (d) relative strength improves from "
            f"{rs_trend} - laggards regain RS BEFORE they regain absolute "
            f"price. The single most reliable Stage 4 failure trigger is "
            f"the 30-week (~150-bar) moving average at {sma_150_str} "
            f"flattening - that change of trend tells you the institutional "
            f"supply has stepped aside and a base is forming."
        )

    return {
        "headline": headline,
        "what_it_is": what_it_is,
        "why_it_matters": why_it_matters,
        "what_to_watch_for": what_to_watch_for,
        "failure_signal": failure_signal,
    }


register(_PATTERN_ID, detect_stage_analysis)
