"""Unit tests for the indicator-alert evaluator.

Covers:
  1. The pure ``check_condition`` decision function (the spec from plan Task 3
     Step 1 — six cases).
  2. Two end-to-end ``_evaluate_one`` tests with mocked bars that exercise the
     RSI compute → condition match path.
"""

from __future__ import annotations

import pytest

from api.services import indicator_alert_evaluator as evaluator
from api.services.indicator_alert_evaluator import check_condition


# ─── pure condition tests (plan Task 3 Step 1) ───────────────────────────────

def test_rsi_above():
    assert check_condition("above", current=72, prev=65, threshold=70) is True
    assert check_condition("above", current=68, prev=65, threshold=70) is False


def test_rsi_below():
    assert check_condition("below", current=25, prev=35, threshold=30) is True


def test_cross_above_requires_crossing():
    """cross_above triggers only on the bar where price moves from below threshold to above."""
    # Clean cross from below to above
    assert check_condition("cross_above", current=72, prev=65, threshold=70) is True
    # Both above: no cross
    assert check_condition("cross_above", current=72, prev=71, threshold=70) is False
    # Stayed below: no cross
    assert check_condition("cross_above", current=68, prev=65, threshold=70) is False


def test_cross_below():
    # Clean cross from above to below
    assert check_condition("cross_below", current=25, prev=35, threshold=30) is True
    # Both above: no cross
    assert check_condition("cross_below", current=35, prev=40, threshold=30) is False


def test_cross_zero_above():
    assert check_condition("cross_zero", current=0.5, prev=-0.3, threshold=0) is True


def test_unknown_condition_returns_false():
    assert check_condition("bogus", current=70, prev=60, threshold=50) is False


# ─── integration: _evaluate_one with mocked bars ─────────────────────────────

def _ramp_bars(n: int, start: float = 100.0, step: float = 1.0) -> list[dict]:
    """Monotonically rising synthetic bars — guaranteed RSI = 100 once warm.

    The evaluator works in dict-bar form (``h/l/c/v`` keys). For RSI the
    only field that matters is ``c``; we still populate the rest so any
    indicator function we add later can consume the same fixture.
    """
    bars = []
    for i in range(n):
        c = start + i * step
        bars.append({
            "t": i,
            "o": c - 0.1,
            "h": c + 0.2,
            "l": c - 0.2,
            "c": c,
            "v": 1000 + i,
        })
    return bars


def _falling_bars(n: int, start: float = 100.0, step: float = 1.0) -> list[dict]:
    """Monotonically falling synthetic bars — RSI = 0 once warm."""
    bars = []
    for i in range(n):
        c = start - i * step
        bars.append({
            "t": i,
            "o": c + 0.1,
            "h": c + 0.2,
            "l": c - 0.2,
            "c": c,
            "v": 1000 + i,
        })
    return bars


def test_evaluate_one_rsi_above_triggers():
    """RSI > 70 on a monotonic uptrend should trigger an 'above 70' alert."""
    bars = _ramp_bars(40)  # plenty of bars to warm a 14-period RSI
    alert = {
        "id": 1,
        "user_id": 1,
        "sym": "TEST",
        "indicator": "rsi",
        "condition": "above",
        "threshold": 70.0,
        "tf": "D",
        "params_json": None,
        "last_value": None,
    }
    value, triggered = evaluator._evaluate_one(alert, bars=bars)
    assert value is not None
    # Constant uptrend → RSI saturates at 100.
    assert value == pytest.approx(100.0, abs=0.5)
    assert triggered is True


def test_evaluate_one_rsi_below_threshold_no_trigger():
    """RSI well above 30 should NOT trigger an 'rsi below 30' alert."""
    # Same uptrend → RSI near 100, which is NOT below 30.
    bars = _ramp_bars(40)
    alert = {
        "id": 2,
        "user_id": 1,
        "sym": "TEST",
        "indicator": "rsi",
        "condition": "below",
        "threshold": 30.0,
        "tf": "D",
        "params_json": None,
        "last_value": None,
    }
    value, triggered = evaluator._evaluate_one(alert, bars=bars)
    assert value is not None
    assert value > 30.0
    assert triggered is False


def test_evaluate_one_rsi_below_triggers_on_downtrend():
    """RSI on a monotonic downtrend saturates at 0 → 'below 30' triggers."""
    bars = _falling_bars(40)
    alert = {
        "id": 3,
        "user_id": 1,
        "sym": "TEST",
        "indicator": "rsi",
        "condition": "below",
        "threshold": 30.0,
        "tf": "D",
        "params_json": None,
        "last_value": None,
    }
    value, triggered = evaluator._evaluate_one(alert, bars=bars)
    assert value is not None
    assert value == pytest.approx(0.0, abs=0.5)
    assert triggered is True


def test_evaluate_one_unknown_indicator_returns_none():
    """Unknown indicator names short-circuit to (None, False)."""
    bars = _ramp_bars(40)
    alert = {
        "id": 4,
        "user_id": 1,
        "sym": "TEST",
        "indicator": "fictional",
        "condition": "above",
        "threshold": 50.0,
        "tf": "D",
        "params_json": None,
        "last_value": None,
    }
    value, triggered = evaluator._evaluate_one(alert, bars=bars)
    assert value is None
    assert triggered is False


def test_evaluate_one_empty_bars_returns_none():
    """No bars in store → graceful (None, False), no exception."""
    alert = {
        "id": 5,
        "user_id": 1,
        "sym": "TEST",
        "indicator": "rsi",
        "condition": "above",
        "threshold": 70.0,
        "tf": "D",
        "params_json": None,
        "last_value": None,
    }
    value, triggered = evaluator._evaluate_one(alert, bars=[])
    assert value is None
    assert triggered is False
