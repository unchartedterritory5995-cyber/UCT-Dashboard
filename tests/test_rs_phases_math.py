"""RS split unit U4 (engineering map projects/rs-split-handoff-2026-11-09/
engineering-map.md §(d)): the UCT RS Phases math, hand-derived.

    rsTrend_t    = EMA_3(R)_t / EMA_10(R)_t − 1
    benchTrend_t = EMA_3(B)_t / EMA_10(B)_t − 1
    phase_t      = 1 (RS up, market down) / 0 (RS down, market up) / None
    divergence_t = clamp((rsTrend − benchTrend) / σ63(spread), −3, +3)

Every expected number below is written out from the formula, never read back
from the module: the EMAs are seeded with the SMA of the first n values
(`indicator_compute.compute_ema`), so an arithmetic series has closed-form
averages a reader can check on paper.
"""
from __future__ import annotations

import math

import pytest

from api.services import relative_strength as rsm


def _bars(closes, start_t=1_000):
    return [{"t": start_t + i, "o": c, "h": c, "l": c, "c": float(c), "v": 1} for i, c in enumerate(closes)]


def _ref_ema(values, n):
    """An independent reference: seed = SMA of the first n, then α = 2/(n+1)."""
    out = [None] * len(values)
    if len(values) < n:
        return out
    k = 2.0 / (n + 1)
    prev = sum(values[:n]) / n
    out[n - 1] = prev
    for i in range(n, len(values)):
        prev = prev * (1 - k) + values[i] * k
        out[i] = prev
    return out


# ── the three phase cases, on paper ───────────────────────────────────────────
#
# Stock flat at 100 for 20 bars. The benchmark walks one point a bar, so its
# EMA 3 and EMA 10 have closed forms:
#   falling B = 100, 99, …, 81:  EMA3(B)_i = 101 − i (i ≥ 2); EMA10(B)_9 = SMA(100..91) = 95.5
#   rising  B = 100, 101, …, 119: EMA3(B)_i = 99 + i (i ≥ 2); EMA10(B)_9 = SMA(100..109) = 104.5
# (EMA3 recursion with α = 1/2 on a unit step stays exactly one bar behind the
# series: 99 → (99 + 97)/2 = 98 → (98 + 96)/2 = 97 …)

STOCK = [100.0] * 20
BENCH_DOWN = [100.0 - i for i in range(20)]
BENCH_UP = [100.0 + i for i in range(20)]


def test_blue_rs_rising_while_the_market_falls():
    cols = rsm.compute_rs_phases_columns(_bars(STOCK), _bars(BENCH_DOWN), 3, 10)
    assert cols["benchTrend"][9] == pytest.approx(92.0 / 95.5 - 1.0)          # 101−9 over SMA(100..91)
    assert cols["benchTrend"][9] < 0
    # R = 100 / B rises as B falls; its EMA 3 leads its EMA 10
    r = [100.0 / b for b in BENCH_DOWN]
    e3, e10 = _ref_ema(r, 3), _ref_ema(r, 10)
    assert cols["rsTrend"][9] == pytest.approx(e3[9] / e10[9] - 1.0)
    assert cols["rsTrend"][9] > 0
    assert cols["phase"][9:] == [1.0] * 11, cols["phase"]
    assert cols["phase"][:9] == [None] * 9, "nothing before the long average is seeded"


def test_red_rs_falling_while_the_market_rises():
    cols = rsm.compute_rs_phases_columns(_bars(STOCK), _bars(BENCH_UP), 3, 10)
    assert cols["benchTrend"][9] == pytest.approx(108.0 / 104.5 - 1.0)        # 99+9 over SMA(100..109)
    assert cols["benchTrend"][9] > 0 and cols["rsTrend"][9] < 0
    assert cols["phase"][9:] == [0.0] * 11, cols["phase"]


def test_none_when_rs_and_the_market_trend_the_same_way():
    """Stock up 2 a bar, benchmark up 1 a bar: R rises AND B rises (both
    trends positive), so no bar is shaded. The mirror (both falling) too."""
    stock_up = [100.0 + 2 * i for i in range(20)]
    cols = rsm.compute_rs_phases_columns(_bars(stock_up), _bars(BENCH_UP), 3, 10)
    assert all(v > 0 for v in cols["rsTrend"][9:]) and all(v > 0 for v in cols["benchTrend"][9:])
    assert cols["phase"] == [None] * 20
    stock_down = [100.0 - 2 * i for i in range(20)]
    cols = rsm.compute_rs_phases_columns(_bars(stock_down), _bars(BENCH_DOWN), 3, 10)
    assert all(v < 0 for v in cols["rsTrend"][9:]) and all(v < 0 for v in cols["benchTrend"][9:])
    assert cols["phase"] == [None] * 20


def test_a_flat_market_against_a_flat_stock_has_no_phase_and_no_divergence():
    cols = rsm.compute_rs_phases_columns(_bars([100.0] * 80), _bars([50.0] * 80), 3, 10)
    assert all(v == 0 for v in cols["rsTrend"][9:]) and all(v == 0 for v in cols["benchTrend"][9:])
    assert cols["phase"] == [None] * 80
    assert cols["divergence"] == [None] * 80, "a zero-variance spread has no z-score"


def test_the_trends_are_the_module_ema_ratio_against_an_independent_reference():
    """Every bar of a wiggly series: EMA 3 over EMA 10 minus one, both sides."""
    rnd = [100.0 + 7 * math.sin(i / 2.0) + (i % 3) for i in range(40)]
    bench = [200.0 + 5 * math.cos(i / 3.0) for i in range(40)]
    cols = rsm.compute_rs_phases_columns(_bars(rnd), _bars(bench), 3, 10)
    r = [s / b for s, b in zip(rnd, bench)]
    for name, series in (("rsTrend", r), ("benchTrend", bench)):
        e3, e10 = _ref_ema(series, 3), _ref_ema(series, 10)
        for i in range(40):
            if i < 9:
                assert cols[name][i] is None, (name, i)
            else:
                assert cols[name][i] == pytest.approx(e3[i] / e10[i] - 1.0, rel=1e-12), (name, i)


def test_other_lengths_seed_where_the_long_average_does():
    cols = rsm.compute_rs_phases_columns(_bars(STOCK), _bars(BENCH_DOWN), 2, 5)
    assert cols["rsTrend"][:4] == [None] * 4 and cols["rsTrend"][4] is not None
    # EMA2(B)_4 with α = 2/3: seed (100+99)/2 = 99.5 → 99.5/3 + 98·2/3 = 98.5 → 97.5 → 96.5
    assert cols["benchTrend"][4] == pytest.approx(96.5 / 98.0 - 1.0)        # over SMA(100..96) = 98


# ── the divergence z-score and its clamp ──────────────────────────────────────

def test_the_zscore_helper_on_paper():
    z = rsm.rolling_zscore_clamped([0.0, 0.0, 0.0, 0.0, 10.0], window=5)
    # mean 2, population variance (4·4 + 64)/5 = 16, σ = 4, z = 10/4
    assert z == [None, None, None, None, 2.5]
    assert rsm.rolling_zscore_clamped([1.0] * 5, window=5) == [None] * 5, "σ = 0: no z-score, never 0 or inf"
    assert rsm.rolling_zscore_clamped([1.0, 2.0, 3.0], window=5) == [None] * 3, "null before a full window"


def test_the_zscore_is_clamped_at_plus_and_minus_three():
    # nine zeros then one spike v: mean v/10, variance (9·(v/10)² + (9v/10)²)/10 = 9v²/100,
    # σ = 0.3·|v|, z = ±3.333… → clamped to ±3
    up = [0.0] * 9 + [100.0]
    assert rsm.rolling_zscore_clamped(up, window=10)[-1] == 3.0
    assert rsm.rolling_zscore_clamped([0.0] * 9 + [-100.0], window=10)[-1] == -3.0
    # and an unclamped value is left alone: 9 zeros then 2.5 ⇒ z = 3.33 again,
    # so use a gentler window: [0, 0, 0, 0, 10] ⇒ 2.5 (above)
    assert rsm.rolling_zscore_clamped([0.0, 0.0, 0.0, 0.0, 10.0], window=5, clamp=2.0)[-1] == 2.0


def test_the_zscore_skips_gaps_like_the_averages_do():
    z = rsm.rolling_zscore_clamped([0.0, None, 0.0, 0.0, None, 0.0, 10.0], window=5)
    assert z == [None, None, None, None, None, None, 2.5], "the five VALID values before and at the spike"


def test_a_single_split_after_a_flat_quarter_pins_the_divergence_at_the_clamp():
    """80 flat bars (spread 0, so no z-score yet), then the benchmark drops a
    fifth on bar 80: one non-zero spread inside a 63-bar window of zeros is
    63/√62 ≈ 8 standard deviations, so the wire reads exactly +3.0 (and the
    phase is blue); the mirror, a fifth up, reads −3.0 and red."""
    stock = [100.0] * 81
    down = [100.0] * 80 + [80.0]
    cols = rsm.compute_rs_phases_columns(_bars(stock), _bars(down), 3, 10)
    assert cols["divergence"][:80] == [None] * 80
    assert cols["divergence"][80] == 3.0 and cols["phase"][80] == 1.0
    up = [100.0] * 80 + [125.0]
    cols = rsm.compute_rs_phases_columns(_bars(stock), _bars(up), 3, 10)
    assert cols["divergence"][80] == -3.0 and cols["phase"][80] == 0.0


def test_the_divergence_warms_up_over_sixty_three_spreads():
    rnd = [100.0 + 7 * math.sin(i / 2.0) for i in range(90)]
    bench = [200.0 + 5 * math.cos(i / 3.0) for i in range(90)]
    cols = rsm.compute_rs_phases_columns(_bars(rnd), _bars(bench), 3, 10)
    first_spread = 9                                   # the long average seeds at index 9
    first_z = first_spread + rsm.PHASES_SIGMA_WINDOW - 1
    assert cols["divergence"][:first_z] == [None] * first_z
    assert all(v is not None and -3.0 <= v <= 3.0 for v in cols["divergence"][first_z:])
    # …and each one is the spread over the population σ of its last 63 spreads
    spread = [a - b for a, b in zip(cols["rsTrend"][9:], cols["benchTrend"][9:])]
    j = len(spread) - 1
    seg = spread[j - 62:j + 1]
    mean = sum(seg) / 63
    sd = math.sqrt(sum((v - mean) ** 2 for v in seg) / 63)
    assert cols["divergence"][-1] == pytest.approx(max(-3.0, min(3.0, spread[-1] / sd)))


# ── gaps, empties, the column set ─────────────────────────────────────────────

def test_a_bar_the_benchmark_lacks_is_none_in_every_column_and_does_not_poison_the_averages():
    bench = _bars(BENCH_DOWN)
    del bench[12]                                      # the benchmark has no bar at t = 1012
    cols = rsm.compute_rs_phases_columns(_bars(STOCK), bench, 3, 10)
    for k in rsm.RS_PHASES_COLUMNS:
        assert cols[k][12] is None, k
    assert cols["phase"][13] == 1.0 and cols["phase"][19] == 1.0
    # the averages ran over the valid values in order: bar 13 reads as if 12 never existed
    r = [100.0 / b for i, b in enumerate(BENCH_DOWN) if i != 12]
    e3, e10 = _ref_ema(r, 3), _ref_ema(r, 10)
    assert cols["rsTrend"][13] == pytest.approx(e3[12] / e10[12] - 1.0)


def test_empty_bars_give_empty_columns_and_the_column_set_is_fixed():
    assert rsm.compute_rs_phases_columns([], []) == {k: [] for k in rsm.RS_PHASES_COLUMNS}
    assert rsm.RS_PHASES_COLUMNS == ("phase", "divergence", "rsTrend", "benchTrend")
    assert (rsm.DEFAULT_PHASES_SHORT, rsm.DEFAULT_PHASES_LONG) == (3, 10)
    assert rsm.PHASES_SHORT_RANGE == (2, 20) and rsm.PHASES_LONG_RANGE == (3, 60)
    assert rsm.PHASES_SIGMA_WINDOW == 63 and rsm.PHASES_Z_CLAMP == 3.0


def test_phase_1_and_phase_2a_functions_are_untouched():
    """The no-move rail every RS unit carries: the alert and screener math is
    not what this unit changed."""
    import inspect
    for fn in (rsm.compute_phase1_columns, rsm.compute_mansfield_columns, rsm.rs_moving_average,
               rsm.legend_scalars):
        assert "phases" not in inspect.getsource(fn).lower(), fn.__name__
    bars, bench = _bars(STOCK), _bars(BENCH_DOWN)
    p1 = rsm.compute_phase1_columns(bars, bench, {"lookback": 20})
    assert set(p1) == set(rsm.PHASE1_COLUMNS) and p1["rsLine"][5] == pytest.approx(100.0 / 95.0)
