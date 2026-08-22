"""MACD's EMA alignment in the PYTHON lane, swept across the parameter space.

The frontend's `computeMACD` returned NaN for `fast > slow`; this lane returns
something worse — a plausible number built on fabricated data:

    for i in range(slow - 1, n):
        f = fast_ema[i]; s = slow_ema[i]
        if f is None or s is None:
            macd_dense.append(0.0)  # placeholder; should not happen for i>=slow-1

That comment holds only while `fast <= slow`. With `fast > slow` the fast EMA is
still `None` for `slow-1 <= i < fast-1`, so the loop pushes **0.0 placeholders**
into the series the signal EMA is seeded from. `macd_out[i]` is correctly left
`None` for those bars, so the LINE looks right — but the SIGNAL is an EMA seeded
on invented zeros and decays out of that error slowly, returning numbers that
look entirely reasonable and are wrong.

So the two lanes disagreed on the same inputs: the browser drew nothing, the
backend served a wrong number presented as right. `tests/test_indicator_golden.py`
never caught it because its fixtures only cover the default 12/26/9.

⭐ THE ORACLE IS ANTISYMMETRY. MACD is `EMA(fast) - EMA(slow)`, so swapping the
periods must negate the line exactly, and the signal — an EMA of that line — must
negate with it. That is a property of the definition rather than of this
implementation, so it cannot be satisfied by copying current output, and it pins
the fix from both sides: the `fast < slow` cases pass today and must keep passing,
so "fixing" `fast > slow` by clamping or swapping the inputs fails here.
"""
import math

import pytest

from api.services.indicator_compute import compute_macd_raw


def _closes(n=400):
    """Deterministic closes with real curvature — a flat or monotonic series makes
    EMA differences degenerate and would let a broken alignment look fine."""
    out = []
    px = 100.0
    for i in range(n):
        px += math.sin(i / 7.0) * 1.4 + math.cos(i / 23.0) * 0.9 + ((i * 37) % 11 - 5) * 0.12
        out.append(max(1.0, px))
    return out


CLOSES = _closes(400)

FAST = [3, 5, 8, 12, 17, 20, 26, 30, 40]
SLOW = [5, 9, 12, 26, 35, 50]
PAIRS = [(f, s) for f in FAST for s in SLOW if f != s]


def _defined(series):
    return [v for v in series if v is not None]


def _first_defined_idx(series):
    for i, v in enumerate(series):
        if v is not None:
            return i
    return -1


@pytest.mark.parametrize("fast,slow", PAIRS)
@pytest.mark.parametrize("signal", [3, 9, 14])
def test_signal_line_exists_for_every_admissible_parameter_set(fast, slow, signal):
    macd, sig, hist = compute_macd_raw(CLOSES, fast, slow, signal)
    assert _defined(macd), f"MACD line empty for fast={fast} slow={slow} signal={signal}"
    assert _defined(sig), f"SIGNAL line empty for fast={fast} slow={slow} signal={signal}"
    assert _defined(hist), f"HISTOGRAM empty for fast={fast} slow={slow} signal={signal}"


@pytest.mark.parametrize("fast,slow", PAIRS)
def test_swapping_fast_and_slow_negates_the_line(fast, slow):
    a_macd, _, _ = compute_macd_raw(CLOSES, fast, slow, 9)
    b_macd, _, _ = compute_macd_raw(CLOSES, slow, fast, 9)
    compared = 0
    for i, (x, y) in enumerate(zip(a_macd, b_macd)):
        if x is None and y is None:
            continue
        assert x is not None and y is not None, (
            f"bar {i}: defined on one side only ({x!r} vs {y!r}) for {fast}/{slow}"
        )
        assert x == pytest.approx(-y, abs=1e-9)
        compared += 1
    # Without this the test would pass on two all-None series.
    assert compared > 50, "no overlapping defined bars were compared"


@pytest.mark.parametrize("fast,slow", PAIRS)
def test_swapping_fast_and_slow_negates_the_signal(fast, slow):
    _, a_sig, _ = compute_macd_raw(CLOSES, fast, slow, 9)
    _, b_sig, _ = compute_macd_raw(CLOSES, slow, fast, 9)
    compared = 0
    for i, (x, y) in enumerate(zip(a_sig, b_sig)):
        if x is None and y is None:
            continue
        assert x is not None and y is not None, (
            f"bar {i}: signal defined on one side only ({x!r} vs {y!r}) for {fast}/{slow}"
        )
        assert x == pytest.approx(-y, abs=1e-9)
        compared += 1
    assert compared > 50, "no overlapping defined signal bars were compared"


@pytest.mark.parametrize("fast,slow", PAIRS)
def test_line_starts_at_the_longer_period(fast, slow):
    macd, _, _ = compute_macd_raw(CLOSES, fast, slow, 9)
    assert _first_defined_idx(macd) == max(fast, slow) - 1


@pytest.mark.parametrize("fast,slow", PAIRS)
def test_histogram_is_line_minus_signal(fast, slow):
    macd, sig, hist = compute_macd_raw(CLOSES, fast, slow, 9)
    checked = 0
    for m, s, h in zip(macd, sig, hist):
        if m is None or s is None:
            continue
        assert h == pytest.approx(m - s, abs=1e-9)
        checked += 1
    assert checked > 50, "no bars had both a line and a signal value"


@pytest.mark.parametrize("period", [5, 12, 26, 50])
def test_fast_equals_slow_is_the_zero_line(period):
    macd, sig, _ = compute_macd_raw(CLOSES, period, period, 9)
    m = _defined(macd)
    s = _defined(sig)
    assert len(m) > 50 and len(s) > 50
    assert all(v == pytest.approx(0.0, abs=1e-9) for v in m)
    assert all(v == pytest.approx(0.0, abs=1e-9) for v in s)


def test_no_fabricated_zero_ever_reaches_the_signal_seed():
    """The specific defect: with fast > slow the old loop seeded the signal EMA
    with 0.0 placeholders. If any survive, the signal near its start is pulled
    toward zero relative to the correctly-computed line."""
    fast, slow, signal = 40, 10, 9
    macd, sig, _ = compute_macd_raw(CLOSES, fast, slow, signal)
    start = max(fast, slow) - 1
    # The first signal value is the mean of the first `signal` MACD values.
    seed_window = [macd[start + k] for k in range(signal)]
    assert all(v is not None for v in seed_window)
    expected_seed = sum(seed_window) / signal
    assert sig[start + signal - 1] == pytest.approx(expected_seed, abs=1e-9)


def test_length_guard_counts_the_longer_period():
    short = _closes(40)
    macd, sig, hist = compute_macd_raw(short, 100, 26, 9)
    assert _defined(macd) == []
    assert _defined(sig) == []
    assert _defined(hist) == []


def test_exactly_enough_bars_for_a_long_fast_period_computes():
    enough = _closes(100 + 9 + 5)
    macd, sig, _ = compute_macd_raw(enough, 100, 26, 9)
    assert _defined(macd)
    assert _defined(sig)


def test_the_default_is_unchanged_by_the_fix():
    macd, sig, hist = compute_macd_raw(CLOSES, 12, 26, 9)
    assert _first_defined_idx(macd) == 25
    assert _first_defined_idx(sig) == 33
    assert _first_defined_idx(hist) == 33
