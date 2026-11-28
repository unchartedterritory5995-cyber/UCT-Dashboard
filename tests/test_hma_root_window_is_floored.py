"""Hull's root window is FLOOR(sqrt(n)), as TradingView computes ``ta.hma`` (2026-11-27, engine e100).

MEASURED, not read: FRED's Q-HMA capture (AMEX:SPY 1D, 8,505 rows; vendor data, kept local and never committed). At
n = 21 the floor window (4) is exact on 8,482 of 8,482 bars and the round window (5) is off on every one; the square
lengths 9 and 16 agree both ways. The capture's numbers are not in this repo, so the rails pin the RULE it settled:

  * identity -- ``_hma_col`` is ``wma(2 * wma(src, floor(n / 2)) - wma(src, n), floor(sqrt(n)))`` at every length,
    including the ones where floor and round differ (7, 13, 21), ones where they agree (12, 55) and the
    capture's square controls (9, 16);
  * the window rule -- the first valid bar is ``n + floor(sqrt(n)) - 2`` (21 -> 23, not 24);
  * the two lanes agree -- the Python twin equals ``oracle.json``'s ``expected.ma.hma`` (written by ``_oracle.py``,
    the reference the JavaScript ``maSeries`` rail reads), bar for bar.
A restored ``round`` reddens every one of them at 21.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from api.services import ast_interpret as ai

ORACLE = Path(__file__).resolve().parent / "fixtures" / "technical_library" / "oracle.json"


def _wma(series, n):
    return ai._rolling(series, n, ai._window_weighted_mean)


def _composed(series, n, root):
    raw = [2.0 * a - b for a, b in zip(_wma(series, max(1, n // 2)), _wma(series, n))]
    return _wma(raw, root)


def _first_finite(xs):
    return next(i for i, x in enumerate(xs) if x is not None and not (isinstance(x, float) and math.isnan(x)))


def _same(a, b):
    assert len(a) == len(b)
    for i, (x, y) in enumerate(zip(a, b)):
        xn = x is None or (isinstance(x, float) and math.isnan(x))
        yn = y is None or (isinstance(y, float) and math.isnan(y))
        assert xn == yn, f"bar {i}: {x!r} vs {y!r}"
        if not xn:
            assert x == pytest.approx(y, rel=1e-12, abs=1e-12), f"bar {i}"


SERIES = [100.0 + 7.0 * math.sin(i / 5.0) + 0.37 * i + (i % 7) * 0.9 for i in range(240)]


@pytest.mark.parametrize("n", [7, 12, 13, 21, 55, 9, 16])
def test_hma_is_the_floored_composition(n):
    _same(ai._hma_col(SERIES, n), _composed(SERIES, n, max(1, math.floor(math.sqrt(n)))))


@pytest.mark.parametrize("n", [7, 13, 21])
def test_the_round_window_is_not_what_it_draws(n):
    assert math.floor(math.sqrt(n)) != round(math.sqrt(n))
    ours, rounded = ai._hma_col(SERIES, n), _composed(SERIES, n, round(math.sqrt(n)))
    assert _first_finite(ours) == _first_finite(rounded) - 1
    assert any(abs(a - b) > 1e-6 for a, b in zip(ours[_first_finite(rounded):], rounded[_first_finite(rounded):]))


@pytest.mark.parametrize("n,first", [(21, 23), (9, 10), (16, 18), (55, 60)])
def test_the_first_valid_bar_is_n_plus_floor_root_minus_two(n, first):
    assert _first_finite(ai._hma_col(SERIES, n)) == first


def test_the_python_twin_draws_the_oracle_the_javascript_rail_reads():
    d = json.loads(ORACLE.read_text(encoding="utf-8"))
    closes = [float(b["c"]) for b in d["bars"]]
    want = d["expected"]["ma"]["hma"]
    assert _first_finite(want) == 23
    _same(ai._hma_col(closes, 21), [float("nan") if v is None else v for v in want])
