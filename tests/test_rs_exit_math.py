"""UCT RS Exit Warnings (`rsExit`): the signal maths, hand-derived.

Mike Webster's three warnings on the RS line, in OUR reading (the module header in
`relative_strength.py` states the rules and why they are ours):

    Quick Break          rs crosses BELOW its fast SMA
                         (rs[t] < fast[t] and not rs[t-1] < fast[t-1]); remembers rs[t]
    Quicksand            first later bar of the same cycle with rs < the remembered level
    cycle ends           the first bar at or above the fast SMA
    Grateful Dead Break  rs crosses BELOW its slow SMA, no cycle, no prior Quick Break needed

Every expected column below is worked out on paper from the bars, never read back
from the function. The averages are SIMPLE averages OF THE RS LINE.
"""
from __future__ import annotations

import pytest

from api.services import relative_strength as rsm

N = None


def _ev(rs, fast, slow):
    return rsm.rs_exit_events(rs, fast, slow)


# ── the event rules, on explicit lines and averages ─────────────────────────

def test_a_full_cycle_a_quicksand_a_reset_and_a_second_cycle():
    # constants: fast 10, slow 9
    rs = [10, 10, 9, 8, 7, 9, 11, 8, 7]
    fast = [10.0] * 9
    slow = [9.0] * 9
    ev = _ev(rs, fast, slow)
    # i0 has no previous bar. i1 sits ON the fast average (10 < 10 is false: not below).
    # i2: 9 < 10 and the bar before was not below -> Quick Break, level 9.
    # i3: 8 < 10 (still below) and 8 < 9 -> Quicksand, once.
    # i4, i5: still below the average, Quicksand already fired this cycle -> 0.
    # i6: 11 is at or above -> the cycle ends. i7: 8 < 10 -> a second Quick Break, level 8.
    # i8: 7 < 8 -> a second Quicksand.
    assert ev["quickBreak"] == [N, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    assert ev["quicksand"] == [N, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]
    # slow 9: i3 is 8 < 9 and the bar before (9) is >= 9 -> Grateful Dead; i4 (7) is
    # a second bar below, not a cross; i5 (9) is not below 9; i7 (8) crosses again.
    assert ev["deadBreak"] == [N, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0]


def test_quicksand_needs_a_close_strictly_lower_than_the_break_level():
    # fast 10, slow 5 (never reached). Break at 9. 9.5 is higher, 9.2 is higher,
    # EXACTLY 9 is not lower, 8.9 is lower -> the one Quicksand; 8.0 after it is silent.
    rs = [10, 10, 9, 9.5, 9.2, 9.0, 8.9, 8.0]
    ev = _ev(rs, [10.0] * 8, [5.0] * 8)
    assert ev["quickBreak"] == [N, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    assert ev["quicksand"] == [N, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0]
    assert ev["deadBreak"] == [N, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]


def test_a_grateful_dead_break_needs_no_quick_break():
    # fast 5 is never crossed (7 >= 5), slow 8 is: 9 -> 7.
    ev = _ev([9, 9, 7, 7], [5.0] * 4, [8.0] * 4)
    assert ev["quickBreak"] == [N, 0.0, 0.0, 0.0]
    assert ev["quicksand"] == [N, 0.0, 0.0, 0.0]
    assert ev["deadBreak"] == [N, 0.0, 1.0, 0.0]


def test_a_series_that_starts_below_its_fast_average_has_no_quick_break_to_measure_from():
    # fast 10. The first three bars sit below it: nothing to cross from, so no Quick Break
    # and no level, hence no Quicksand. 12 ends the below-run. 8 then crosses down (a real
    # Quick Break, level 8) and 7 is the Quicksand.
    rs = [8, 8, 8, 12, 8, 7]
    ev = _ev(rs, [10.0] * 6, [1.0] * 6)
    assert ev["quickBreak"] == [N, 0.0, 0.0, 0.0, 1.0, 0.0]
    assert ev["quicksand"] == [N, 0.0, 0.0, 0.0, 0.0, 1.0]


def test_a_gap_bar_abandons_the_cycle_and_is_not_judged():
    # break at i1 (level 9). i2 has no ratio (a benchmark bar is missing): None, and the
    # cycle is abandoned. i3's previous bar is the gap: None. i4 is below with nothing
    # to measure from -> no Quicksand even though 7 < 9.
    rs = [10, 9, None, 8, 7]
    ev = _ev(rs, [10.0] * 5, [5.0] * 5)
    assert ev["quickBreak"] == [N, 1.0, N, N, 0.0]
    assert ev["quicksand"] == [N, 0.0, N, N, 0.0]
    assert ev["deadBreak"] == [N, 0.0, N, N, 0.0]


def test_warm_up_bars_are_none_never_zero():
    # the fast average exists from i2; its previous bar (i1) has none, so i2 cannot be
    # judged either. i3 is the first judged bar: 1 < 2 but the bar before was already below.
    ev = _ev([1, 1, 1, 1], [N, N, 2.0, 2.0], [N, N, N, N])
    assert ev["quickBreak"] == [N, N, N, 0.0]
    assert ev["quicksand"] == [N, N, N, 0.0]
    assert ev["deadBreak"] == [N, N, N, N]


def test_sitting_on_the_average_is_not_below_it():
    # rs == fast on every bar: never below, so never a break. (The `above_column` convention.)
    ev = _ev([5, 5, 5, 5], [5.0] * 4, [5.0] * 4)
    assert ev["quickBreak"] == [N, 0.0, 0.0, 0.0]
    assert ev["deadBreak"] == [N, 0.0, 0.0, 0.0]


def test_empty_series():
    assert _ev([], [], []) == {"quickBreak": [], "quicksand": [], "deadBreak": []}


# ── the whole pipeline on bars: SMAs of the RS LINE, the events and the dots ─────────

def _bars(closes, start_t=1_000):
    return [{"t": start_t + i, "o": c, "h": c, "l": c, "c": float(c), "v": 1} for i, c in enumerate(closes)]


# Benchmark flat at 100, so RS = close / 100 and a simple average of RS is the simple
# average of the closes / 100. Closes 100,100,100,80,92,60,72,40 give
#   RS     1.00 1.00 1.00 0.80 0.92 0.60 0.72 0.40
#   SMA 2   -   1.00 1.00 0.90 0.86 0.76 0.66 0.56
#   SMA 3   -    -   1.00 0.9333 0.9067 0.7733 0.7467 0.5733
CLOSES = [100.0, 100.0, 100.0, 80.0, 92.0, 60.0, 72.0, 40.0]


def test_the_columns_on_paper_with_a_fast_2_and_a_slow_3():
    cols = rsm.compute_rs_exit_columns(_bars(CLOSES), _bars([100.0] * 8), fast=2, slow=3)
    assert cols["rsLine"] == pytest.approx([1.0, 1.0, 1.0, 0.8, 0.92, 0.6, 0.72, 0.4])
    assert cols["fast"][0] is None
    assert cols["fast"][1:] == pytest.approx([1.0, 1.0, 0.9, 0.86, 0.76, 0.66, 0.56])
    assert cols["slow"][:2] == [N, N]
    assert cols["slow"][2:] == pytest.approx([1.0, 0.93333333333, 0.90666666667, 0.77333333333,
                                              0.74666666667, 0.57333333333])
    # Quick Break: i3 (0.8 < 0.9, the bar before 1.0 vs 1.0 was level), i5 (0.6 < 0.76 after
    # 0.92 vs 0.86), i7 (0.4 < 0.56 after 0.72 vs 0.66). i1's previous bar has no average.
    assert cols["quickBreak"] == [N, N, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0]
    # a bounce above the fast average ends every cycle before the line falls below its break
    # level: no Quicksand.
    assert cols["quicksand"] == [N, N, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
    # Grateful Dead: i3 (0.8 < 0.9333 after 1.0 vs 1.0) and i5 (0.6 < 0.7733 after 0.92 vs 0.9067)
    # cross the slow average from above. i6 (0.72 < 0.7467) is already below it, i7 (0.4) is a
    # second bar below, neither is a fresh cross.
    assert cols["deadBreak"] == [N, N, N, 1.0, 0.0, 1.0, 0.0, 0.0]
    # dots carry the RS value on an event bar and nothing elsewhere
    assert cols["dotQuick"] == pytest.approx([N, N, N, 0.8, N, 0.6, N, 0.4], nan_ok=True) or \
        [v for v in cols["dotQuick"]] == [N, N, N, 0.8, N, 0.6, N, 0.4]
    assert cols["dotQuicksand"] == [N] * 8
    assert [i for i, v in enumerate(cols["dotDead"]) if v is not None] == [3, 5]


def test_a_benchmark_gap_blanks_the_bar_it_touches():
    bench = _bars([100.0] * 8)
    del bench[4]                                      # the benchmark has no bar for t=1004
    cols = rsm.compute_rs_exit_columns(_bars(CLOSES), bench, fast=2, slow=3)
    assert cols["rsLine"][4] is None
    assert cols["quickBreak"][4] is None and cols["deadBreak"][4] is None
    assert cols["dotQuick"][4] is None


def test_empty_bars():
    cols = rsm.compute_rs_exit_columns([], [], fast=2, slow=3)
    assert set(cols) == set(rsm.RS_EXIT_COLUMNS) and all(v == [] for v in cols.values())


# ── the lengths ──────────────────────────────────────────────────────────────

@pytest.mark.parametrize("tf,fast,slow,want", [
    ("D", 0, 0, (21, 50)),           # auto, daily: Webster's pair
    ("W", 0, 0, (8, 21)),            # auto, weekly
    ("M", 0, 0, (21, 50)),           # any other timeframe reads the daily pair
    ("D", 10, 0, (10, 50)),          # one given, one auto
    ("W", 0, 30, (8, 30)),
    ("D", 1, 5, (2, 5)),             # a given length below 2 is clamped up to 2... (1 is a number >= 1)
    ("D", 500, 900, (399, 400)),     # the top of the range, the slow one kept longer
    ("D", 30, 20, (30, 31)),         # a slow at or under the fast is raised to fast + 1
    ("D", 30, 30, (30, 31)),
    ("D", "abc", None, (21, 50)),    # junk is auto
    ("D", -5, float("nan"), (21, 50)),
    ("D", 12.6, 40.4, (13, 40)),     # rounded
])
def test_resolve_exit_lengths(tf, fast, slow, want):
    assert rsm.resolve_exit_lengths(tf, fast, slow) == want


def test_the_auto_pair_is_the_published_one_and_the_range_is_two_to_four_hundred():
    assert rsm.EXIT_AUTO_LENGTHS == {"D": (21, 50), "W": (8, 21)}
    assert rsm.EXIT_LENGTH_RANGE == (2, 400)
