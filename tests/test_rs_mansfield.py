"""Rails for the Phase 2a (unit 2a-02) functions of
`api/services/relative_strength.py`: Mansfield Relative Strength, its three-state
read and zero-line crosses, the bars-ago age helper, and benchmark agreement
(plan §7 items 13 and 22; engineering map §2.5 / §2.6 name who reads them).

Every rail states the clause it pins, and the Mansfield arithmetic is written
out in the test body — the `test_relative_strength_columns.py` style — so a
module change that moves a value is red here with the numbers in hand.
"""
from __future__ import annotations

import math

import pytest

from api.services import relative_strength as rs


def _bars(closes, start_t=1_000):
    return [{"t": start_t + i, "o": c, "h": c, "l": c, "c": c, "v": 1} for i, c in enumerate(closes)]


def _events_only(col):
    assert all(v in (0.0, 1.0, None) for v in col), col
    assert all(type(v) is float for v in col if v is not None), col


# ── §7 item 13: MRS = ((RP / SMA(RP, n)) − 1) × 100, RP = rs × 100 ──────────────

def test_mansfield_hand_derived_on_a_tiny_series():
    """rs 1.00, 1.02, 1.04, 1.06, 1.08 with n = 3.

    RP        = 100, 102, 104, 106, 108
    SMA3(RP)  = —, —, (100+102+104)/3 = 102, (102+104+106)/3 = 104, (104+106+108)/3 = 106
    MRS       = —, —, (104/102 − 1)×100, (106/104 − 1)×100, (108/106 − 1)×100
    """
    mrs = rs.mansfield_column([1.00, 1.02, 1.04, 1.06, 1.08], 3)
    assert mrs[:2] == [None, None]
    assert mrs[2] == pytest.approx((104 / 102 - 1) * 100) == pytest.approx(1.9607843137254901)
    assert mrs[3] == pytest.approx((106 / 104 - 1) * 100) == pytest.approx(1.9230769230769162)
    assert mrs[4] == pytest.approx((108 / 106 - 1) * 100) == pytest.approx(1.8867924528301927)
    # a ratio climbing at a constant ABSOLUTE step is above its average but
    # decelerating in percent terms — above zero and falling, i.e. neutral.
    assert rs.mansfield_state_column(mrs) == [None, None, None, 0, 0]


def test_mansfield_is_invariant_to_the_scale_of_the_ratio():
    """RP = rs × 100 is the published form; because SMA is linear the ×100
    cancels, so the column cannot depend on what the ratio is quoted in."""
    base = [0.5, 0.52, 0.51, 0.55, 0.56, 0.6, 0.58]
    a = rs.mansfield_column(base, 3)
    b = rs.mansfield_column([v * 7.3 for v in base], 3)
    for x, y in zip(a, b):
        assert (x is None and y is None) or x == pytest.approx(y, rel=1e-12)


def test_mansfield_warmup_is_exactly_length_minus_one_VALID_bars():
    series = [float(v) for v in range(1, 13)]
    mrs = rs.mansfield_column(series, 5)
    assert mrs[:4] == [None] * 4, "the pad is length − 1 bars"
    assert mrs[4] is not None and all(v is not None for v in mrs[4:])
    # with a gap INSIDE the warm-up the pad is counted in VALID bars, so the gap
    # bar pushes the first value one index later.
    gapped = [1.0, 2.0, None, 3.0, 4.0, 5.0, 6.0]
    mrs = rs.mansfield_column(gapped, 3)
    assert mrs[:3] == [None, None, None]
    # first SMA3 over valid RP 100, 200, 300 = 200 → (300/200 − 1)×100 = 50
    assert mrs[3] == pytest.approx(50.0)
    # next: RP 200, 300, 400 → 300 → (400/300 − 1)×100
    assert mrs[4] == pytest.approx((400 / 300 - 1) * 100)


def test_mansfield_gap_bar_is_none_and_the_average_skips_it():
    """A gap after warm-up: None on the gap bar, and the next bar's SMA is over
    the valid values in order (the gap is not a zero and not a restart)."""
    series = [1.0] * 5 + [None] + [1.1] * 3
    mrs = rs.mansfield_column(series, 3)
    assert mrs[5] is None
    # window of VALID RP ending at bar 6: 100, 100, 110 → mean 310/3
    assert mrs[6] == pytest.approx((110 / (310 / 3) - 1) * 100) == pytest.approx(6.451612903225806)
    assert mrs[7] == pytest.approx((110 / (320 / 3) - 1) * 100)
    assert mrs[8] == pytest.approx(0.0)


def test_mansfield_degenerate_length_is_all_none_not_an_error():
    assert rs.mansfield_column([1.0, 1.1, 1.2], 0) == [None, None, None]
    assert rs.mansfield_column([1.0, 1.1], 5) == [None, None], "fewer valid bars than n"
    assert rs.mansfield_column([], 3) == []


# ── the three-state read: domain {-1, 0, 1, None}, as ints ───────────────────

def test_mansfield_state_rules_and_domain():
    mrs = [None, 1.0, 2.0, 1.5, -0.5, -1.0, -0.8, 0.0, 0.0, None, 1.0]
    #       pad  no-prior ↑>0  ↓>0   ↓<0   ↓<0   ↑<0   zero  flat  gap  no-prior
    state = rs.mansfield_state_column(mrs)
    assert state == [None, None, 1, 0, -1, -1, 0, 0, 0, None, None]
    assert all(v is None or (type(v) is int and v in (-1, 0, 1)) for v in state)
    assert not any(isinstance(v, bool) for v in state)


def test_mansfield_state_needs_a_prior_bar_so_the_bar_after_a_gap_is_none():
    mrs = [None, None, 0.5, 0.6, None, 0.7, 0.8]
    assert rs.mansfield_state_column(mrs) == [None, None, None, 1, None, None, 1]


# ── zero-line crosses, the same shape as cross_columns ──────────────────────

def test_mansfield_cross_columns_detect_the_zero_line_with_rsAbove_s_inclusive_rule():
    mrs = [None, -1.0, 0.5, 0.0, -0.2, None, 0.3, 0.4]
    assert rs.above_zero_column(mrs) == [None, 0.0, 1.0, 1.0, 0.0, None, 1.0, 1.0], "0.0 is ABOVE (≥), like rsAbove"
    c = rs.mansfield_cross_column(mrs)
    assert set(c) == {"crossUp", "crossDown"}
    assert c["crossUp"] == [None, None, 1.0, 0.0, 0.0, None, None, 0.0]
    assert c["crossDown"] == [None, None, 0.0, 0.0, 1.0, None, None, 0.0]
    _events_only(c["crossUp"]); _events_only(c["crossDown"])
    # …and it IS cross_columns over above_zero — one implementation, two lines
    assert c == rs.cross_columns(rs.above_zero_column(mrs))


# ── bars-ago: 0 on the event bar, counts up, None before the first event ─────

def test_bars_ago_semantics():
    events = [None, 0.0, 1.0, 0.0, 0.0, None, 1.0, 0.0]
    age = rs.bars_ago_column(events)
    assert age == [None, None, 0.0, 1.0, 2.0, 3.0, 0.0, 1.0]
    assert all(v is None or type(v) is float for v in age)
    assert rs.bars_ago_column([0.0, 0.0, None]) == [None, None, None], "no event yet ⇒ None, never 'infinity'"
    assert rs.bars_ago_column([]) == []


def test_bars_ago_counts_through_a_hole_rather_than_resetting():
    """A None in the event column is 'no event seen here'. The distance to the
    last event is still known; a hidden event could only make the age LARGER,
    never claim a cross that did not happen — the safe direction for a scan."""
    age = rs.bars_ago_column([1.0, None, None, 0.0])
    assert age == [0.0, 1.0, 2.0, 3.0]


def test_either_is_the_or_combinator_with_the_same_hole_rule_as_both():
    assert rs.either([1.0, 0.0, 0.0, None, 1.0], [0.0, 0.0, 1.0, 1.0, None]) == [1.0, 0.0, 1.0, None, None]


# ── §7 item 22: benchmark agreement over a least-squares slope ───────────────

def test_slope_is_plain_least_squares_and_refuses_holes():
    assert rs._slope([1.0, 2.0, 3.0]) == pytest.approx(1.0)
    assert rs._slope([3.0, 1.0, 2.0]) == pytest.approx(-0.5)        # x̄=1, ȳ=2: Σ(x−x̄)(y−ȳ) = −1, Σ(x−x̄)² = 2
    assert rs._slope([2.0, 2.0, 2.0]) == pytest.approx(0.0)
    assert rs._slope([None, 1.0, 2.0]) is None
    assert rs._slope([1.0]) is None and rs._slope([]) is None


def test_benchmark_agree_agree_disagree_flat_and_warmup():
    a = [1.0, 2.0, 3.0, 4.0, 5.0, 4.0]
    b = [10.0, 11.0, 12.0, 13.0, 14.0, 13.0]
    c = [5.0, 6.0, 7.0, 8.0, 9.0, 8.0]
    out = rs.benchmark_agree(a, b, c, window=3)
    assert out[:2] == [None, None], "None until `window` bars exist"
    assert out[2:5] == [1.0, 1.0, 1.0], "all three rising"
    assert out[5] == 0.0, "windows 4,5,4 are FLAT — a zero slope is neither rising nor falling"
    _events_only(out)
    # all falling agrees too
    assert rs.benchmark_agree([v * -1 for v in a], [v * -1 for v in b], [v * -1 for v in c], window=3)[2:5] == [1.0] * 3
    # one series falling while the others rise disagrees
    assert rs.benchmark_agree(a, b, [9.0, 8.0, 7.0, 6.0, 5.0, 6.0], window=3)[2:5] == [0.0] * 3


def test_benchmark_agree_is_none_while_any_window_holds_a_gap():
    a = [1.0, 2.0, 3.0, None, 5.0, 6.0, 7.0]
    b = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0]
    out = rs.benchmark_agree(a, b, b, window=3)
    assert out == [None, None, 1.0, None, None, None, 1.0]
    assert rs.benchmark_agree(b, b, b, window=1) == [None] * 7, "a one-bar window has no slope"
    assert rs.benchmark_agree([], [], []) == []


# ── the Phase 2a set, in one call; PHASE1_COLUMNS untouched ──────────────────

def test_compute_mansfield_columns_returns_the_phase2a_set_aligned_and_masks_the_gap():
    closes = [50.0 + i * 0.5 for i in range(30)]
    bench = [100.0 + (i % 3) * 0.4 for i in range(30)]
    bars, bbars = _bars(closes), _bars(bench)
    del bbars[14]                                   # no benchmark bar at t = 1014
    out = rs.compute_mansfield_columns(bars, bbars, 5)
    assert tuple(out) == rs.PHASE2A_COLUMNS
    for key, col in out.items():
        assert len(col) == 30, key
    assert out["mansfield"][:4] == [None] * 4 and out["mansfield"][4] is not None
    for key in rs.PHASE2A_COLUMNS:
        assert out[key][14] is None, f"{key} invented a value on the gap bar"
    assert out["mansfield"][15] is not None, "the average skipped the gap"
    assert out["mansfieldState"][15] is None and out["mansfieldCrossUp"][15] is None
    _events_only(out["mansfieldCrossUp"]); _events_only(out["mansfieldCrossDown"])
    # the age is since the last cross in EITHER direction
    crosses = rs.either(out["mansfieldCrossUp"], out["mansfieldCrossDown"])
    expect_age = rs.bars_ago_column(crosses)
    for i, (got, exp) in enumerate(zip(out["mansfieldCrossBarsAgo"], expect_age)):
        assert got == (None if out["mansfield"][i] is None else exp), i


def test_compute_mansfield_columns_on_empty_bars_is_empty_and_clamps_length():
    out = rs.compute_mansfield_columns([], [], 10)
    assert set(out) == set(rs.PHASE2A_COLUMNS) and all(col == [] for col in out.values())
    bars = _bars([float(v) for v in range(1, 9)])
    bench = _bars([2.0] * 8)
    assert rs.MANSFIELD_LENGTH_RANGE == (2, 500)
    # 0 clamps to 2 (the same floor Phase 1 gives maLength): one pad bar, then values
    low = rs.compute_mansfield_columns(bars, bench, 0)
    assert low["mansfield"][0] is None and low["mansfield"][1] is not None
    # 9999 clamps to 500: longer than the series, so every bar is pad, never an error
    high = rs.compute_mansfield_columns(bars, bench, 9999)
    assert all(v is None for v in high["mansfield"])


def test_no_phase2a_column_carries_nan_or_a_bool_and_only_state_is_int():
    n = 60
    out = rs.compute_mansfield_columns(_bars([50.0 + math.sin(i / 3) * 5 for i in range(n)]),
                                       _bars([100.0 + (i % 5) for i in range(n)]), 10)
    for key, col in out.items():
        for v in col:
            assert not isinstance(v, bool), (key, v)
            if key == "mansfieldState":
                assert v is None or (type(v) is int and v in (-1, 0, 1)), (key, v)
            else:
                assert v is None or (type(v) is float and math.isfinite(v)), (key, v)
    assert {v for v in out["mansfieldState"] if v is not None} == {-1, 0, 1}, "a 60-bar sine shows all three states"


def test_phase1_columns_are_unchanged_and_phase2a_is_a_separate_tuple():
    """The Phase 1 wire contract (`compute.rev: 2`) is pinned by the provider
    tests and the `rs_events_default` fixture; 2a-02 must not grow it."""
    assert rs.PHASE1_COLUMNS == (
        "rsLine", "rsMa", "rsAbove",
        "rsNH", "rsNHpartial", "pxNH", "rsNHbeforePx", "rsNHred", "rsNL",
        "gor", "rog", "crossUp", "crossDown",
        "dotNH", "dotNHbeforePx", "dotNHred", "dotNHpartial", "dotNL",
    )
    assert rs.PHASE2A_COLUMNS == (
        "mansfield", "mansfieldState", "mansfieldCrossUp", "mansfieldCrossDown", "mansfieldCrossBarsAgo",
    )
    assert not set(rs.PHASE1_COLUMNS) & set(rs.PHASE2A_COLUMNS)
    assert set(rs.compute_phase1_columns([], [], None)) == set(rs.PHASE1_COLUMNS)
    assert rs.DEFAULT_MANSFIELD_LENGTH == 200 and rs.DEFAULT_SENSITIVITY_WINDOW == 20
