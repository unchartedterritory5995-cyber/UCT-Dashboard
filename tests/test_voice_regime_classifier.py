"""Live regime classifier — pattern detection across breadth, VIX, MAs."""

from unittest.mock import patch
import pytest

from api.services import voice_regime_classifier as vrc


# ── _to_float ──────────────────────────────────────────────────────────────

def test_to_float_handles_numeric():
    assert vrc._to_float(1.5) == 1.5
    assert vrc._to_float(2) == 2.0


def test_to_float_strips_pct_and_plus():
    assert vrc._to_float("+5.2%") == 5.2
    assert vrc._to_float("-3.1%") == -3.1


def test_to_float_garbage_returns_none():
    assert vrc._to_float("???") is None
    assert vrc._to_float(None) is None


# ── _classify — signal-driven regime detection ─────────────────────────────

def test_strong_bull_signals_yield_bull_trend():
    sig = {
        "pct_above_50ma": 80, "pct_above_200ma": 75,
        "new_highs": 200, "new_lows": 10,
        "vix": 12, "distribution_days": 1,
        "uct_exposure_rating": 120, "breadth_score": 75,
    }
    regime, conf, reasons = vrc._classify(sig)
    assert regime == "bull_trend"
    assert conf > 0.4
    assert any("50MA" in r or "200MA" in r for r in reasons)


def test_broken_signals_yield_bear_trend():
    sig = {
        "pct_above_50ma": 15, "pct_above_200ma": 20,
        "new_highs": 5, "new_lows": 250,
        "vix": 38, "distribution_days": 6,
        "uct_exposure_rating": 10, "breadth_score": 15,
    }
    regime, conf, reasons = vrc._classify(sig)
    assert regime == "bear_trend"
    assert conf > 0.3


def test_distribution_pattern():
    """Highs holding up but breadth narrowing — classic distribution."""
    sig = {
        "pct_above_50ma": 35, "pct_above_200ma": 55,
        "new_highs": 60, "new_lows": 40,  # close ratio
        "vix": 17, "distribution_days": 5,
        "uct_exposure_rating": 65, "breadth_score": 45,
    }
    regime, conf, reasons = vrc._classify(sig)
    # Distribution should win or tie chop/bull_correction
    assert regime in ("distribution", "chop", "bull_correction")


def test_chop_regime_for_balanced_signals():
    sig = {
        "pct_above_50ma": 45, "pct_above_200ma": 48,
        "new_highs": 30, "new_lows": 28,
        "vix": 21, "distribution_days": 2,
        "uct_exposure_rating": 50, "breadth_score": 50,
    }
    regime, conf, reasons = vrc._classify(sig)
    # Chop or bull_correction acceptable
    assert regime in ("chop", "bull_correction")


def test_classify_works_with_missing_signals():
    """If only some signals are present, classifier still returns a regime."""
    sig = {"pct_above_50ma": 80}
    regime, conf, reasons = vrc._classify(sig)
    assert regime in vrc.REGIMES
    assert conf >= 0.0


def test_classify_handles_empty_signals():
    regime, conf, reasons = vrc._classify({})
    assert regime in vrc.REGIMES


# ── get_current_regime ─────────────────────────────────────────────────────

def test_get_current_regime_returns_full_shape():
    """End-to-end: fetch signals from engine + classify."""
    fake_breadth = {
        "pct_above_50ma": 70, "pct_above_200ma": 65,
        "new_highs": 100, "new_lows": 20,
        "breadth_score": 65, "distribution_days": 1,
        "uct_exposure_rating": 90,
    }
    with patch("api.services.engine.get_breadth", return_value=fake_breadth), \
         patch("api.services.massive.get_ticker_snapshot",
               return_value={"close": 14}):
        result = vrc.get_current_regime(fresh=True)
    assert "regime" in result
    assert "confidence" in result
    assert "reasons" in result
    assert "signals" in result
    assert "narration" in result
    assert "label" in result
    assert result["regime"] in vrc.REGIMES
    assert result["regime"] == "bull_trend"
    assert "regime" in result["narration"].lower() or "bull" in result["narration"].lower()


def test_get_current_regime_handles_engine_errors():
    """If engine.get_breadth fails, we still return a regime (chop fallback)."""
    with patch("api.services.engine.get_breadth", side_effect=RuntimeError("down")):
        result = vrc.get_current_regime(fresh=True)
    # All signals None — classifier returns first regime by default
    assert result["regime"] in vrc.REGIMES


def test_build_regime_prompt_line_returns_string():
    with patch("api.services.engine.get_breadth",
               return_value={"pct_above_50ma": 75, "new_highs": 150,
                             "new_lows": 10, "breadth_score": 70}):
        line = vrc.build_regime_prompt_line()
    assert isinstance(line, str)
    assert "REGIME" in line or "regime" in line.lower()


def test_build_regime_prompt_line_safe_on_error():
    """Never raises; returns empty string if classification fails entirely."""
    with patch("api.services.voice_regime_classifier.get_current_regime",
               side_effect=RuntimeError("everything broken")):
        line = vrc.build_regime_prompt_line()
    assert line == ""
