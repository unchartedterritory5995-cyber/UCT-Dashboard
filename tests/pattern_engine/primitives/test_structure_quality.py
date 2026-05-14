"""Tests for structure_quality primitives.

Validate the higher-low detector and the rising-MA-alignment primitive used
to boost continuation-pattern quality scores.
"""
from __future__ import annotations

from api.services.pattern_engine.primitives.structure_quality import (
    is_higher_low,
    nearest_rising_ma_alignment,
    _ema,
    _sma,
    _slope_sign,
)


def _bar(t, h, l, c=None, o=None, v=1000):
    c = c if c is not None else (h + l) / 2
    o = o if o is not None else c - 0.1
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


# ----- is_higher_low ---------------------------------------------------------

def test_higher_low_detects_higher_low():
    """Prior swing low at $90, current pullback low at $95 = higher low."""
    bars = []
    for i in range(20):
        if i == 5:
            bars.append(_bar(i, 95, 90, 92))   # prior swing low
        elif i == 15:
            bars.append(_bar(i, 100, 95, 97))  # current pullback low
        elif i < 5:
            bars.append(_bar(i, 100, 98, 99))
        elif i < 15:
            bars.append(_bar(i, 105, 100, 103))
        else:
            bars.append(_bar(i, 105, 100, 103))

    result = is_higher_low(bars, pullback_low_idx=15)
    assert result["is_higher_low"] is True
    assert result["lift_pct"] > 0
    assert result["prior_low_price"] == 90
    assert "Higher low confirmed" in result["narrative_phrase"]


def test_higher_low_detects_lower_low():
    """Prior low $90, current low $85 = lower low (uptrend broken)."""
    bars = []
    for i in range(20):
        if i == 5:
            bars.append(_bar(i, 95, 90, 92))
        elif i == 15:
            bars.append(_bar(i, 95, 85, 87))
        elif i < 5:
            bars.append(_bar(i, 100, 98, 99))
        elif i < 15:
            bars.append(_bar(i, 105, 100, 103))
        else:
            bars.append(_bar(i, 105, 100, 103))

    result = is_higher_low(bars, pullback_low_idx=15)
    assert result["is_higher_low"] is False
    assert "Lower low" in result["narrative_phrase"]


def test_higher_low_no_prior_swing_low():
    """If no prior pivots exist, returns is_higher_low=False with informative phrase."""
    bars = [_bar(i, 100, 98, 99) for i in range(10)]
    result = is_higher_low(bars, pullback_low_idx=5)
    assert result["is_higher_low"] is False
    assert result["prior_low_price"] is None
    assert "first pullback" in result["narrative_phrase"] or "unavailable" in result["narrative_phrase"]


def test_higher_low_out_of_range_idx():
    """Out-of-range idx returns the empty sentinel."""
    bars = [_bar(i, 100, 98, 99) for i in range(10)]
    result = is_higher_low(bars, pullback_low_idx=99)
    assert result["is_higher_low"] is False
    assert result["prior_low_price"] is None


def test_higher_low_large_lift_strong_phrase():
    """Lift >= 5% produces 'Strong uptrend structure' phrasing."""
    bars = []
    for i in range(20):
        if i == 5:
            bars.append(_bar(i, 95, 90, 92))    # prior low $90
        elif i == 15:
            bars.append(_bar(i, 105, 100, 102))  # current low $100 (+11%)
        elif i < 5:
            bars.append(_bar(i, 100, 98, 99))
        elif i < 15:
            bars.append(_bar(i, 110, 105, 107))
        else:
            bars.append(_bar(i, 110, 105, 107))

    result = is_higher_low(bars, pullback_low_idx=15)
    assert result["is_higher_low"] is True
    assert result["lift_pct"] >= 5
    assert "Strong uptrend" in result["narrative_phrase"]


# ----- nearest_rising_ma_alignment ------------------------------------------

def test_ma_alignment_at_rising_ma():
    """Steady rising trend — current pullback price near an MA aligns with it."""
    bars = []
    for i in range(80):
        c = 100 + i * 0.5
        bars.append(_bar(i, c + 0.5, c - 0.5, c))

    # Take the 21-EMA value and put the pullback right on it.
    closes = [b["c"] for b in bars]
    ema21 = _ema(closes, 21)
    assert ema21 is not None
    result = nearest_rising_ma_alignment(bars, ema21)
    assert result["aligned_ma"] is not None
    assert result["score_boost"] > 0
    assert abs(result["distance_pct"]) <= 1.5


def test_ma_alignment_no_aligned_ma_returns_zero():
    """Pullback low far from any MA returns score 0."""
    bars = [_bar(i, 110, 90, 100) for i in range(60)]
    result = nearest_rising_ma_alignment(bars, 200)  # way above any MA
    assert result["aligned_ma"] is None
    assert result["score_boost"] == 0


def test_ma_alignment_not_rising_skips():
    """If MA is falling, alignment shouldn't count."""
    bars = [_bar(i, 110 - i * 0.5, 90 - i * 0.5, 100 - i * 0.5) for i in range(60)]
    result = nearest_rising_ma_alignment(bars, 70)  # near falling MA
    # Falling MA = no boost
    assert result["score_boost"] == 0
    assert result["aligned_ma"] is None


def test_ma_alignment_empty_bars():
    """Empty input handled gracefully."""
    result = nearest_rising_ma_alignment([], 100)
    assert result["aligned_ma"] is None
    assert result["score_boost"] == 0


def test_ma_alignment_prefers_closer_ma():
    """When multiple MAs qualify, the closest one wins."""
    bars = []
    for i in range(80):
        c = 100 + i * 0.5
        bars.append(_bar(i, c + 0.5, c - 0.5, c))
    closes = [b["c"] for b in bars]
    ema10 = _ema(closes, 10)
    assert ema10 is not None
    # Land exactly on 10-EMA — should pick the closest MA available.
    result = nearest_rising_ma_alignment(bars, ema10)
    assert result["aligned_ma"] is not None
    # distance_pct to the picked MA should be <= 1.5
    assert abs(result["distance_pct"]) <= 1.5


# ----- helper math -----------------------------------------------------------

def test_sma_handles_short_input():
    assert _sma([1, 2, 3], 10) is None
    assert _sma([1, 2, 3, 4, 5], 5) == 3.0


def test_ema_handles_short_input():
    assert _ema([1, 2, 3], 10) is None
    val = _ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5)
    assert val is not None
    assert val > 0


def test_slope_sign_rising():
    closes = [100 + i for i in range(60)]
    assert _slope_sign(closes, 10) == 1


def test_slope_sign_falling():
    closes = [100 - i for i in range(60)]
    assert _slope_sign(closes, 10) == -1


def test_slope_sign_flat():
    closes = [100.0] * 60
    assert _slope_sign(closes, 10) == 0
