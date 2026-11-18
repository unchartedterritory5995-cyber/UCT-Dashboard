"""LANE B0 (2026-11-09): ``wma``'s warm-up counts FINITE observations, not bars.

The Python twin of ``app/src/components/chart/engine/ast/b0NaSeed.test.js`` rule 2.
Witnessed from the listing on ``trend-targets-algoalpha-rddt-1d-2026-10-02``: a
source finite on bar 0, ``na`` on 1..88 and finite from 89 has its first
``ta.wma(src, 40)`` on bar 127 (the 40th finite value), not 89.
"""
import math

from api.services import ast_interpret as ai

NAN = float("nan")


def _wma(series, n):
    return ai._rolling(series, n, ai._window_weighted_mean, ai.NA_FFILL)


def _first(col):
    return next(i for i, v in enumerate(col) if math.isfinite(v))


def test_a_gap_after_bar_0_waits_for_n_finite_values():
    src = [100.0] + [NAN] * 88 + [100.0 + i for i in range(1, 112)]
    assert _first(_wma(src, 40)) == 127


def test_control_a_series_with_no_gap_answers_from_bar_n_minus_1():
    src = [100.0 + i for i in range(200)]
    assert _first(_wma(src, 40)) == 39
