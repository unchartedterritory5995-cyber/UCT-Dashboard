"""Build the Context enrichment dict for a pattern detection.

Pulls trend/MA/RS/volume context from the bars themselves. Reads regime
from existing wire_data cache when available, else accepts a hint argument.
Earnings proximity + sector strength rank are stubbed for Phase 0 (None)
and wired in later phases.
"""
from __future__ import annotations

from typing import List, Optional

from api.services.pattern_engine.primitives.can_slim import can_slim_score as _compute_can_slim
from api.services.pattern_engine.primitives.dcr import avg_dcr, dcr_signature
from api.services.pattern_engine.primitives.volume import volume_signature
from api.services.pattern_engine.types import Bar, Context


def _sma(values: List[float], period: int) -> Optional[float]:
    """Latest SMA value, or None if insufficient data."""
    if len(values) < period:
        return None
    return sum(values[-period:]) / period


def _slope_sign(values: List[float], window: int) -> int:
    """Return +1 if values rising over `window`, -1 if falling, 0 if flat.
    Uses first vs last in the window."""
    if len(values) < window:
        return 0
    a, b = values[-window], values[-1]
    if b > a * 1.02: return 1
    if b < a * 0.98: return -1
    return 0


def _ma_alignment(bars: List[Bar]) -> str:
    closes = [b["c"] for b in bars]
    last = closes[-1] if closes else 0
    s10  = _sma(closes, 10)
    s20  = _sma(closes, 20)
    s50  = _sma(closes, 50)
    s200 = _sma(closes, 200)

    if None in (s10, s20, s50, s200):
        # Insufficient history — try without 200.
        if s10 and s20 and s50:
            if last > s10 > s20 > s50:
                return "stacked_bullish"
            if last < s10 < s20 < s50:
                return "stacked_bearish"
        return "mixed"

    if last > s10 > s20 > s50 > s200:
        return "stacked_bullish"
    if last < s10 < s20 < s50 < s200:
        return "stacked_bearish"
    return "mixed"


def _trend_stage(bars: List[Bar]) -> int:
    """Weinstein 1-4 simplified:
      Stage 1: flat 30-week SMA, price near it (consolidation/accumulation)
      Stage 2: rising 30-week SMA, price above it (uptrend)
      Stage 3: flat 30-week SMA, price near it after up move (distribution)
      Stage 4: falling 30-week SMA, price below it (downtrend)
    """
    closes = [b["c"] for b in bars]
    last = closes[-1] if closes else 0
    if len(closes) >= 200:
        sma_long = _sma(closes, 150)
        slope_sign = _slope_sign(closes, 50)
    elif len(closes) >= 50:
        sma_long = _sma(closes, 50)
        slope_sign = _slope_sign(closes, 20)
    else:
        return 1

    if sma_long is None:
        return 1

    above = last > sma_long
    if slope_sign > 0 and above:  return 2
    if slope_sign < 0 and not above: return 4
    if slope_sign > 0 and not above: return 1
    if slope_sign < 0 and above:     return 3
    return 1


def _rs_trend(bars: List[Bar]) -> str:
    """Relative strength trend over the last 20 bars vs the previous 20.

    Simplified to absolute trend (no SPY comparison in Phase 0).
    """
    closes = [b["c"] for b in bars]
    if len(closes) < 40:
        return "flat"
    recent = closes[-20:]
    prior  = closes[-40:-20]
    r_pct  = (recent[-1] - recent[0]) / recent[0] if recent[0] > 0 else 0
    p_pct  = (prior[-1] - prior[0]) / prior[0] if prior[0] > 0 else 0
    diff = r_pct - p_pct
    if diff > 0.03: return "up"
    if diff < -0.03: return "down"
    return "flat"


def _nearest_resistance(bars: List[Bar]) -> Optional[float]:
    """Highest high in the last 60 bars, above current close."""
    if not bars:
        return None
    last_close = bars[-1]["c"]
    lookback = bars[-60:]
    above = [b["h"] for b in lookback if b["h"] > last_close]
    return min(above) if above else None


def _nearest_support(bars: List[Bar]) -> Optional[float]:
    if not bars:
        return None
    last_close = bars[-1]["c"]
    lookback = bars[-60:]
    below = [b["l"] for b in lookback if b["l"] < last_close]
    return max(below) if below else None


def build_context(
    bars: List[Bar],
    sym: str,
    regime_hint: Optional[str] = None,
) -> Context:
    """Build a Context dict from bars + optional regime hint.

    Args:
      bars: OHLCV list, sorted by t asc, most-recent last.
      sym: ticker (used only for downstream enrichment; not needed for math).
      regime_hint: caller-supplied regime tag. Phase 0 doesn't read from
        wire_data cache directly — that wiring is left for Phase 1+ if the
        regime hint is missing.

    Returns:
      Context dict matching the TypedDict schema.
    """
    regime = regime_hint if regime_hint else "unknown"

    trend_stage = _trend_stage(bars)
    rs_trend = _rs_trend(bars)
    vol_sig = volume_signature(bars, lookback=10)
    dcr_sig = dcr_signature(bars, lookback=10)

    # CAN SLIM composite (Phase 7.5) - O'Neil 7-pillar meta-grading.
    # Computed from already-derived structural signals + bars; never crashes on
    # short series (returns neutral grade "C" / score 50 internally).
    can_slim = _compute_can_slim(bars, {
        "trend_stage": trend_stage,
        "regime": regime,
        "rs_trend": rs_trend,
        "dcr_signature": dcr_sig,
        "volume_signature": vol_sig,
        "sector_strength_rank": None,
    })

    return {
        "trend_stage": trend_stage,
        "rs_trend": rs_trend,
        "ma_alignment": _ma_alignment(bars),
        "volume_signature": vol_sig,
        "regime": regime,
        "nearest_resistance": _nearest_resistance(bars),
        "nearest_support": _nearest_support(bars),
        "days_to_earnings": None,
        "sector_strength_rank": None,
        "recent_dcr_avg": round(avg_dcr(bars, lookback=10), 4),
        "dcr_signature": dcr_sig,
        "can_slim_grade": can_slim["grade"],
        "can_slim_score": can_slim["composite_score"],
    }
