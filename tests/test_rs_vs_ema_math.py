"""RS split unit U4 (engineering map projects/rs-split-handoff-2026-11-09/
engineering-map.md §(d)): the UCT RS vs 21 EMA math, hand-derived.

    M_t    = EMA_21(R)_t
    dist_t = 100 · (R_t / M_t − 1)
    fast_t = EMA_3(dist)_t
    slow_t = EMA_13(dist)_t

⭐ `dist` IS `legend_scalars(...)["pctFromMa"]`, the number the RS line readout
prints as "above its 21 EMA by X%": one formula over one average
(`rs_moving_average(rs, 21, "EMA")`), so the histogram and the readout can
never disagree. The rail below holds them equal bar for bar, with a benchmark
gap at the newest bar so the readout's "last bar with a ratio" rule is on the
table too.
"""
from __future__ import annotations

import pytest

from api.services import relative_strength as rsm
from tests.test_rs_columns_provider import _long_daily


def _bars(closes, start_t=1_000):
    return [{"t": start_t + i, "o": c, "h": c, "l": c, "c": float(c), "v": 1} for i, c in enumerate(closes)]


# ── closed forms ──────────────────────────────────────────────────────────────
#
# Stock 100 + i, benchmark flat at 100: R_i = 1 + i/100, an arithmetic series.
#   EMA21(R)_20 = SMA(R_0..R_20) = 1.10
#   EMA21(R)_i  = 1 + (i − 10)/100 for i ≥ 20: with α = 2/22 the recursion
#                 M + (R − M)·(1/11) = M + (0.11)·(1/11) = M + 0.01 each bar
#   dist_i = 100 · ((1 + i/100) / (1 + (i − 10)/100) − 1) = 1000 / (90 + i)

N = 40
STOCK = [100.0 + i for i in range(N)]
BENCH = [100.0] * N


def _dist(i):
    return 1000.0 / (90.0 + i)


def test_the_21_ema_and_the_distance_on_paper():
    cols = rsm.compute_rs_vs_ema_columns(_bars(STOCK), _bars(BENCH))
    assert cols["dist"][:20] == [None] * 20, "null until the 21 EMA is seeded"
    assert cols["dist"][20] == pytest.approx(100.0 * (1.20 / 1.10 - 1.0))     # 9.0909…
    assert cols["dist"][21] == pytest.approx(100.0 * (1.21 / 1.11 - 1.0))     # 9.0090…
    assert cols["dist"][22] == pytest.approx(100.0 * (1.22 / 1.12 - 1.0))     # 8.9285…
    for i in range(20, N):
        assert cols["dist"][i] == pytest.approx(_dist(i), rel=1e-12), i


def test_fast_and_slow_are_emas_of_the_distance_on_paper():
    cols = rsm.compute_rs_vs_ema_columns(_bars(STOCK), _bars(BENCH))
    # EMA 3 of dist seeds at the third distance (bar 22) with their mean, then α = 1/2
    assert cols["fast"][:22] == [None] * 22
    seed3 = (_dist(20) + _dist(21) + _dist(22)) / 3.0
    assert cols["fast"][22] == pytest.approx(seed3)
    assert cols["fast"][23] == pytest.approx(seed3 * 0.5 + _dist(23) * 0.5)
    # EMA 13 of dist seeds at the thirteenth distance (bar 32), α = 1/7
    assert cols["slow"][:32] == [None] * 32
    seed13 = sum(_dist(i) for i in range(20, 33)) / 13.0
    assert cols["slow"][32] == pytest.approx(seed13)
    assert cols["slow"][33] == pytest.approx(seed13 * (6.0 / 7.0) + _dist(33) / 7.0)


def test_other_lengths_are_honoured():
    cols = rsm.compute_rs_vs_ema_columns(_bars(STOCK), _bars(BENCH), ema=5, fast=2, slow=4)
    # EMA5(R)_4 = SMA(1.00..1.04) = 1.02; dist_4 = 100·(1.04/1.02 − 1)
    assert cols["dist"][:4] == [None] * 4
    assert cols["dist"][4] == pytest.approx(100.0 * (1.04 / 1.02 - 1.0))
    assert cols["fast"][5] is not None and cols["fast"][4] is None
    assert cols["slow"][7] is not None and cols["slow"][6] is None


# ── the one-formula rail against the RS line readout ──────────────────────────

def test_dist_is_the_readout_pct_from_ma_bar_for_bar():
    store = _long_daily(n=400)
    bars, bench = store["NVDA"], store["SPY"]
    cols = rsm.compute_rs_vs_ema_columns(bars, bench)
    p1 = rsm.compute_phase1_columns(bars, bench)       # the RS line's defaults: 21 EMA
    for i in range(400):
        rs, ma = p1["rsLine"][i], p1["rsMa"][i]
        if ma is None:
            assert cols["dist"][i] is None, i
        else:
            assert cols["dist"][i] == pytest.approx((rs / ma - 1.0) * 100.0, rel=1e-12), i
    leg = rsm.legend_scalars(p1)
    assert leg["index"] == 399
    assert cols["dist"][399] == pytest.approx(leg["pctFromMa"], rel=1e-12)
    assert (cols["dist"][399] >= 0) == leg["above"]


def test_dist_matches_the_readout_when_the_benchmark_lacks_the_newest_bar():
    """The readout reads the last bar WITH a ratio (visual round A8); `dist`
    is null on the gap bar and equals the readout at the bar it reads."""
    store = _long_daily(n=300)
    bars, bench = store["NVDA"], store["SPY"][:-1]
    cols = rsm.compute_rs_vs_ema_columns(bars, bench)
    leg = rsm.legend_scalars(rsm.compute_phase1_columns(bars, bench))
    assert cols["dist"][-1] is None and leg["index"] == 298
    assert cols["dist"][298] == pytest.approx(leg["pctFromMa"], rel=1e-12)


def test_the_default_length_is_the_rs_line_default_average():
    assert rsm.DEFAULT_VS_EMA_LENGTH == rsm.DEFAULT_MA_LENGTH == 21
    assert (rsm.DEFAULT_VS_EMA_FAST, rsm.DEFAULT_VS_EMA_SLOW) == (3, 13)
    assert rsm.RS_VS_EMA_COLUMNS == ("dist", "fast", "slow")


# ── gaps and empties ──────────────────────────────────────────────────────────

def test_a_gap_bar_is_none_everywhere_and_skipped_by_the_averages():
    bench = _bars(BENCH)
    del bench[25]
    cols = rsm.compute_rs_vs_ema_columns(_bars(STOCK), bench)
    assert cols["dist"][25] is None and cols["fast"][25] is None and cols["slow"][25] is None
    # bar 26's average ran over the valid ratios in order: R_26 enters as the 26th value
    r = [1.0 + i / 100.0 for i in range(N) if i != 25]
    k = 2.0 / 22.0
    m = sum(r[:21]) / 21.0
    for v in r[21:26]:
        m = m * (1 - k) + v * k
    assert cols["dist"][26] == pytest.approx(100.0 * (r[25] / m - 1.0), rel=1e-12)


def test_empty_bars_give_empty_columns():
    assert rsm.compute_rs_vs_ema_columns([], []) == {"dist": [], "fast": [], "slow": []}
