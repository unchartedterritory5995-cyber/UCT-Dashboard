"""Ichimoku across the period range its own form accepts.

The settings form does not enforce ``tenkan <= kijun <= senkou_b``:
``tenkanPeriod`` declares ``max: 75``, ``kijunPeriod`` declares ``max: 200``, and
``senkouBPeriod`` can be set as low as ``1``. Both lanes assumed that ordering,
and each broke differently:

* **The frontend threw.** ``computeIchimoku``'s loop started at
  ``senkouBPeriod - 1``, so ``periodMid(bars, i, kijunPeriod)`` read from a
  NEGATIVE index; ``bars[-n]`` is ``undefined`` and ``undefined.h`` raises a
  TypeError out of the render path.
* **This lane bailed.** It returned five all-``None`` series, drawing nothing at
  all, with no error — under a comment that named the frontend crash as the
  reason ("a period past the window would read a negative index, which JS throws
  on and Python would silently wrap"). So the crash was known, and the workaround
  lived in the other lane.

Neither computed the result, and the result is perfectly well defined: Ichimoku's
three lines are midpoints of three independent look-back windows and nothing about
the definition requires one to be longer than another.

Both lanes now start at ``max(tenkan, kijun, senkou_b) - 1``. At the shipped
9/26/52 that IS ``senkou_b``, so every value on every existing chart is unchanged
— which is what keeps ``tests/test_indicator_golden.py`` green.
"""
import math

import pytest

from api.services.indicator_compute import compute_ichimoku_raw


def _bars(n=600):
    out = []
    px = 100.0
    for i in range(n):
        px += math.sin(i / 11.0) * 0.8 + math.cos(i / 37.0) * 0.5 + ((i * 29) % 13 - 6) * 0.07
        c = max(2.0, px)
        out.append({
            "t": 1600000000 + i * 86400,
            "o": c, "h": c * 1.004, "l": c * 0.996, "c": c, "v": 1_000_000,
        })
    return out


BARS = _bars(600)
NAMES = ("tenkan", "kijun", "span_a", "span_b", "chikou")


def _first_defined(series):
    for i, v in enumerate(series):
        if v is not None:
            return i
    return -1


# Every combination below is inside the declared bounds of all three inputs.
COMBOS = [
    (9, 26, 52),      # the shipped default
    (75, 26, 52),     # tenkan past senkou_b  — the frontend crash
    (9, 200, 52),     # kijun past senkou_b   — the frontend crash
    (9, 26, 1),       # senkou_b at its floor
    (75, 200, 1),     # every input at an extreme together
    (52, 52, 52),     # all equal
    (1, 1, 1),        # all at the floor
    (9, 26, 200),     # senkou_b longest — the assumed ordering, still correct
]


@pytest.mark.parametrize("tenkan,kijun,senkou_b", COMBOS)
def test_every_line_computes_for_any_accepted_period_set(tenkan, kijun, senkou_b):
    series = compute_ichimoku_raw(BARS, tenkan, kijun, senkou_b)
    for name, s in zip(NAMES, series):
        assert any(v is not None for v in s), (
            f"{name} drew NOTHING at tenkan={tenkan} kijun={kijun} senkou_b={senkou_b} "
            f"— all three are values the form accepts"
        )


@pytest.mark.parametrize("tenkan,kijun,senkou_b", COMBOS)
def test_the_first_computed_bar_is_the_longest_period(tenkan, kijun, senkou_b):
    tenkan_s, kijun_s, span_a, span_b, _chikou = compute_ichimoku_raw(BARS, tenkan, kijun, senkou_b)
    longest = max(tenkan, kijun, senkou_b)
    for name, s in (("tenkan", tenkan_s), ("kijun", kijun_s), ("span_a", span_a), ("span_b", span_b)):
        assert _first_defined(s) == longest - 1, f"{name} starts at the wrong bar"


@pytest.mark.parametrize("tenkan,kijun,senkou_b", COMBOS)
def test_no_accepted_period_set_raises(tenkan, kijun, senkou_b):
    compute_ichimoku_raw(BARS, tenkan, kijun, senkou_b)


@pytest.mark.parametrize("tenkan,kijun,senkou_b", COMBOS)
def test_span_a_is_the_mean_of_the_two_lines(tenkan, kijun, senkou_b):
    tenkan_s, kijun_s, span_a, _b, _c = compute_ichimoku_raw(BARS, tenkan, kijun, senkou_b)
    checked = 0
    for tk, kj, sa in zip(tenkan_s, kijun_s, span_a):
        if tk is None or kj is None:
            continue
        assert sa == pytest.approx((tk + kj) / 2, abs=1e-9)
        checked += 1
    assert checked > 50, "no bars carried both lines — the assertion proved nothing"


def test_a_nonpositive_period_still_refuses():
    # The other guard is untouched: zero and negative windows are not a parameter
    # set the form can produce, and a zero-length look-back has no midpoint.
    for combo in [(0, 26, 52), (9, 0, 52), (9, 26, 0), (-5, 26, 52)]:
        for s in compute_ichimoku_raw(BARS, *combo):
            assert all(v is None for v in s), f"{combo} should compute nothing"


def test_too_few_bars_for_the_longest_period_computes_nothing():
    short = _bars(30)
    for s in compute_ichimoku_raw(short, 9, 200, 52):
        assert all(v is None for v in s)


def test_the_default_is_byte_identical_to_what_shipped():
    tenkan_s, kijun_s, span_a, span_b, chikou = compute_ichimoku_raw(BARS, 9, 26, 52)
    assert _first_defined(tenkan_s) == 51
    assert _first_defined(span_b) == 51
    # Chikou keeps its TRAILING pad: bar i's close is written to i - 26.
    assert chikou[-1] is None
    assert _first_defined(chikou) == 51 - 26
