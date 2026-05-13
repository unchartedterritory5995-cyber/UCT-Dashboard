"""Unit tests for shared narrative helpers."""
from api.services.pattern_engine.narrative_helpers import (
    ma_alignment_phrase,
    trend_stage_description,
    rs_trend_phrase,
    dcr_phrase,
    regime_phrase,
    volume_signature_phrase,
    position_in_range_phrase,
)


def test_ma_alignment_phrase_stacked_bullish():
    assert "stacked-bullish" in ma_alignment_phrase("stacked_bullish")


def test_ma_alignment_phrase_stacked_bearish():
    assert "stacked-bearish" in ma_alignment_phrase("stacked_bearish")


def test_ma_alignment_phrase_mixed():
    assert "mixed" in ma_alignment_phrase("mixed")


def test_ma_alignment_phrase_none():
    assert ma_alignment_phrase(None) == "unknown"


def test_trend_stage_description_each_stage():
    assert "Stage 1" in trend_stage_description(1)
    assert "Stage 2" in trend_stage_description(2)
    assert "Stage 3" in trend_stage_description(3)
    assert "Stage 4" in trend_stage_description(4)


def test_rs_trend_phrase_directions():
    assert "improving" in rs_trend_phrase("up")
    assert "neutral" in rs_trend_phrase("flat")
    assert "weakening" in rs_trend_phrase("down")


def test_dcr_phrase_includes_signature_and_avg():
    out = dcr_phrase("accumulation", 0.72)
    assert "accumulation" in out
    assert "72%" in out


def test_dcr_phrase_handles_missing_avg():
    out = dcr_phrase("neutral", None)
    assert "neutral" in out


def test_regime_phrase_returns_for_each_known():
    assert "bull" in regime_phrase("bull")
    assert "bear" in regime_phrase("bear")
    assert "choppy" in regime_phrase("choppy")
    assert "transition" in regime_phrase("transition")


def test_volume_signature_phrase_returns_prose():
    assert "contracting" in volume_signature_phrase("contracting")
    assert "expanding" in volume_signature_phrase("expanding")
    assert "neutral" in volume_signature_phrase("neutral")


def test_position_in_range_phrase_midpoint():
    out = position_in_range_phrase(50, 0, 100)
    assert "50%" in out


def test_position_in_range_phrase_zero_range():
    # Edge case: high == low
    out = position_in_range_phrase(50, 50, 50)
    assert "$50" in out
