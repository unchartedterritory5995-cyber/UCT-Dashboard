"""NA_SKIP is one forward pass (2026-11-19): the ring is byte-identical to the backward gather it replaced, and its cost
does not depend on how long the gaps are.

MEASURED (production e86, Fred RS on RDDT 1D -> 5m): the JS twin's per-bar backward gather walked every `na` before
it; a series `na` for its first 19,864 of 28,006 bars cost ~2e8 steps, 16.1 s of a 21.9 s main-thread freeze. This
module is the Python twin (`api/services/ast_interpret._rolling`); `interpret.js::rollingSkip` is the JS one.

  1. IDENTITY: over randomized series (an `na` prefix, interior holes, isolated `na`, all `na`, all finite, shorter
     than the window) and window sizes 1..300, `_rolling(..., NA_SKIP)` equals the old gather loop for every reducer
     the table runs under NA_SKIP (mean, sum, stdev, median), bit for bit, and hands `reduce` the same operand lists.
  2. STEP COUNT (never a wall clock): reading a 6,000-bar series `na` for its first 4,000 bars and across a 1,000-bar
     interior hole costs at most 3 reads per bar. (Mutant, run 2026-11-19: with the ring's `return` removed, the old
     gather read the series 8,894,826 times and this rail went RED.)
"""
import math
import random
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import api.services.ast_interpret as A  # noqa: E402

NAN = float("nan")
REDUCERS = {"mean": A._window_mean, "sum": A._window_sum, "stdev": A._window_stdev, "median": A._window_median}


def _old(series, n, reduce):
    """The gather this replaced, verbatim in effect: `_rolling`'s loop over `_window_operands(..., NA_SKIP)`."""
    out = A._nan_col(len(series))
    for i in range(n - 1, len(series)):
        w = A._window_operands(series, n, i, A.NA_SKIP)
        if w is not None:
            buf, lo, hi = w
            out[i] = reduce(buf, lo, hi)
    return out


def _bits(xs):
    return [struct.pack("<d", float(x)) for x in xs]


def _series(rng, length, shape):
    xs = [rng.uniform(-50, 150) for _ in range(length)]
    if shape == "prefix":
        cut = rng.randint(0, length)
        xs[:cut] = [NAN] * cut
    elif shape == "holes":
        for _ in range(rng.randint(1, 6)):
            a = rng.randint(0, length)
            b = min(length, a + rng.randint(1, max(1, length // 3)))
            xs[a:b] = [NAN] * (b - a)
    elif shape == "sparse":
        xs = [x if rng.random() < 0.15 else NAN for x in xs]
    elif shape == "allna":
        xs = [NAN] * length
    return xs


def test_the_ring_is_byte_identical_to_the_gather_it_replaced():
    rng = random.Random(20261119)
    cases = 0
    for shape in ("prefix", "holes", "sparse", "allna", "finite"):
        for _ in range(12):
            length = rng.randint(0, 900)
            series = _series(rng, length, shape)
            for n in sorted({1, 2, 3, rng.randint(1, 50), rng.randint(1, 300), max(1, length), length + 5}):
                for name, red in REDUCERS.items():
                    got = A._rolling(series, n, red, A.NA_SKIP)
                    want = _old(series, n, red)
                    assert _bits(got) == _bits(want), (shape, length, n, name)
                    cases += 1
    assert cases > 1000


def test_the_ring_hands_reduce_the_same_operands_on_the_same_bars():
    rng = random.Random(7)
    for shape in ("prefix", "holes", "sparse"):
        series = _series(rng, 700, shape)
        for n in (1, 5, 40, 250):
            got_log, want_log = [], []
            A._rolling(series, n, lambda b, lo, hi: got_log.append(tuple(b[lo:hi + 1])) or 0.0, A.NA_SKIP)
            _old(series, n, lambda b, lo, hi: want_log.append(tuple(b[lo:hi + 1])) or 0.0)
            assert got_log == want_log, (shape, n)


class _Counted:
    """A series that counts every element read."""

    def __init__(self, xs):
        self.xs, self.reads = xs, 0

    def __len__(self):
        return len(self.xs)

    def __getitem__(self, i):
        if isinstance(i, slice):
            self.reads += len(range(*i.indices(len(self.xs))))
        else:
            self.reads += 1
        return self.xs[i]

    def __iter__(self):
        for x in self.xs:
            self.reads += 1
            yield x


def test_the_cost_does_not_depend_on_how_long_the_gaps_are():
    xs = [NAN] * 4000 + [100.0 + (i % 17) for i in range(1000)] + [NAN] * 1000
    s = _Counted(xs)
    out = A._rolling(s, 50, A._window_mean, A.NA_SKIP)
    assert s.reads <= 3 * len(xs), f"{s.reads} reads for {len(xs)} bars: the gather is back"
    # CONTROL: the answers are there (the bar holding the 50th finite value onward, the hole answering)
    assert math.isnan(out[4048]) and math.isfinite(out[4049]) and math.isfinite(out[5999])
