"""Rails for `api/services/relative_strength.py` — the UCT Relative Strength
column math (plan §7, §12.3 `tests/test_rs_columns_provider.py` names the
provider rails; these are the pure-function rails beneath them).

Every rail states the plan clause it pins so a future edit can see what it is
about to change.
"""
from __future__ import annotations

import math

import pytest

from api.services import relative_strength as rs


def _bars(closes, start_t=1_000):
    return [{"t": start_t + i, "o": c, "h": c, "l": c, "c": c, "v": 1} for i, c in enumerate(closes)]


def _events_only(col):
    assert all(v in (0.0, 1.0, None) for v in col), col


# ── §7.1 the ratio, joined by time ───────────────────────────────────────────

def test_rs_line_is_close_over_benchmark_joined_by_time_not_index():
    bars = _bars([10, 20, 30, 40])
    bench = _bars([2, 4, 6, 8])
    del bench[2]                       # benchmark has no bar at t=1002
    out = rs.rs_line(bars, bench)
    assert out[0] == 5.0 and out[1] == 5.0 and out[3] == 5.0
    assert out[2] is None, "a missing benchmark bar is a gap, never a shifted ratio"


def test_single_symbol_rs_is_flat_one_the_existing_golden_claim():
    bars = _bars([3, 5, 8, 13])
    assert rs.rs_line(bars, bars) == [1.0, 1.0, 1.0, 1.0]


# ── §7.2 the moving average skips gaps instead of poisoning the recursion ───

def test_rs_moving_average_warmup_is_length_minus_one_and_skips_gaps():
    series = [1.0, 2.0, None, 3.0, 4.0, 5.0]
    ma = rs.rs_moving_average(series, 3, "SMA")
    # valid values in order: 1,2,3,4,5 → SMA3 first at the third VALID bar (index 3)
    assert ma[0] is None and ma[1] is None and ma[2] is None
    assert ma[3] == pytest.approx(2.0)
    assert ma[4] == pytest.approx(3.0)
    assert ma[5] == pytest.approx(4.0)


def test_rs_moving_average_ema_matches_the_repo_ema_on_a_gapless_series():
    from api.services.indicator_compute import compute_ema
    series = [float(v) for v in range(1, 30)]
    assert rs.rs_moving_average(series, 5, "EMA") == compute_ema(series, 5)


def test_above_and_cross_columns_are_events():
    above = [None, 0.0, 0.0, 1.0, 1.0, 0.0]
    c = rs.cross_columns(above)
    assert c["crossUp"] == [None, None, 0.0, 1.0, 0.0, 0.0]
    assert c["crossDown"] == [None, None, 0.0, 0.0, 0.0, 1.0]
    _events_only(c["crossUp"]); _events_only(c["crossDown"])


# ── §7.3 new highs: ties count, warm-up is exactly N, gaps are honest ────────

def test_rs_new_high_warmup_is_exactly_the_lookback_and_ties_count():
    series = [1.0, 2.0, 3.0, 3.0, 2.5, 4.0]
    nh = rs.rolling_extreme_event(series, 3, high=True)
    assert nh[:3] == [None, None, None], "N prior bars are needed"
    assert nh[3] == 1.0, "a tie with the prior max counts as a new high"
    assert nh[4] == 0.0
    assert nh[5] == 1.0
    _events_only(nh)


def test_rs_new_high_is_none_when_the_window_has_a_gap():
    series = [1.0, None, 3.0, 4.0, 5.0]
    nh = rs.rolling_extreme_event(series, 2, high=True)
    assert nh[2] is None, "a window with a hole has no honest maximum"
    assert nh[3] is None, "the gap is still inside this bar's window"
    assert nh[4] == 1.0, "the first bar whose window is whole can answer"


def test_price_new_high_tolerance_counts_a_close_within_two_percent_as_at_high():
    closes = [100.0, 100.0, 100.0, 98.5, 97.0]
    px = rs.rolling_extreme_event(closes, 3, high=True, tolerance_pct=2.0)
    assert px[3] == 1.0, "98.5 is within 2 % of the 100 high"
    assert px[4] == 0.0, "97 is not"


def test_partial_new_high_fires_only_before_the_full_lookback_exists():
    series = [float(v) for v in range(1, 40)]      # strictly rising
    full = rs.rolling_extreme_event(series, 30, high=True)
    part = rs.partial_extreme_event(series, 30, high=True, min_bars=20)
    assert all(v is None for v in part[:20])
    assert all(v == 1.0 for v in part[20:30])
    assert all(v is None for v in part[30:]), "the full-window column owns these bars"
    assert all(v == 1.0 for v in full[30:])
    for a, b in zip(full, part):
        assert not (a == 1.0 and b == 1.0), "the two columns never both fire"


# ── §7.5–7.7 before price, red days, green-on-red ──────────────────────────

def test_rs_new_high_before_price_is_rs_high_and_not_price_high():
    assert rs.and_not([1.0, 1.0, 0.0, None], [0.0, 1.0, 0.0, 0.0]) == [1.0, 0.0, 0.0, None]


def test_red_day_threshold_is_inclusive_and_negative():
    chg = [None, -0.5, -0.49, -2.0, 0.3]
    red = rs.red_day_column(chg, -0.5)
    assert red == [None, 1.0, 0.0, 1.0, 0.0]


def test_green_on_red_counts_over_a_window():
    gor = [None, 1.0, 0.0, 1.0, 1.0, 0.0]
    cnt = rs.rolling_count(gor, 3)
    assert cnt == [None, None, None, 2.0, 2.0, 2.0]


# ── the dot shape the marker primitive needs ───────────────────────────────

def test_dot_column_carries_the_rs_value_only_where_the_event_fired():
    values = [0.5, 0.6, 0.7]
    events = [0.0, 1.0, None]
    assert rs.dot_column(values, events) == [None, 0.6, None]


# ── the whole Phase 1 set ──────────────────────────────────────────────────

def test_compute_phase1_columns_returns_every_declared_column_aligned_to_bars():
    n = 320
    closes = [100.0 + i * 0.5 for i in range(n)]
    bench = [50.0 + (i * 0.1) for i in range(n)]
    out = rs.compute_phase1_columns(_bars(closes), _bars(bench), {"lookback": 252, "maLength": 21})
    assert set(out) == set(rs.PHASE1_COLUMNS)
    for key, col in out.items():
        assert len(col) == n, key
    for key in ("rsNH", "rsNHpartial", "pxNH", "rsNHbeforePx", "rsNHred", "rsNL", "gor", "rog", "crossUp", "crossDown", "rsAbove"):
        _events_only(out[key])
    # a stock rising faster than its benchmark makes RS new highs once the lookback exists
    assert out["rsNH"][:252] == [None] * 252
    assert all(v == 1.0 for v in out["rsNH"][252:])
    # and price is at its own high, so none of them is "before price"
    assert all(v == 0.0 for v in out["rsNHbeforePx"][252:])
    # dots sit at the RS value
    for i in range(252, n):
        assert out["dotNH"][i] == pytest.approx(out["rsLine"][i])


def test_compute_phase1_columns_clamps_inputs_and_defaults_the_rest():
    p = rs.resolve_phase1_inputs({"lookback": 9999, "maLength": 0, "maType": "weird",
                                  "priceTolerance": -4, "redDayThreshold": 7})
    assert p == {"lookback": 500, "maLength": 2, "maType": "EMA",
                 "priceTolerance": 0.0, "redDayThreshold": 0.0}
    assert rs.resolve_phase1_inputs(None)["lookback"] == rs.DEFAULT_LOOKBACK


def test_resolve_phase1_inputs_rounds_integers_like_the_route_does():
    """Review B9 residual: the route's `_clamp_number` rounds (`int(round)`)
    while this guard truncated, so 20.6 was 21 on the chart and 20 in a scan."""
    p = rs.resolve_phase1_inputs({"lookback": 20.6, "maLength": 20.6})
    assert p["lookback"] == 21 and p["maLength"] == 21, "20.6 → 21, not int(20.6) == 20"
    p = rs.resolve_phase1_inputs({"lookback": 20.4, "maLength": 20.4})
    assert p["lookback"] == 20 and p["maLength"] == 20
    assert isinstance(p["lookback"], int) and not isinstance(p["lookback"], bool)


def test_compute_phase1_columns_on_empty_bars_is_empty_not_an_error():
    out = rs.compute_phase1_columns([], [], None)
    assert set(out) == set(rs.PHASE1_COLUMNS) and all(col == [] for col in out.values())


def test_last_rs_high_and_legend_scalars_read_the_last_bar():
    cols = {
        "rsNH": [None, 0.0, 1.0, 0.0],
        "rsNHbeforePx": [None, 0.0, 1.0, 0.0],
        "rsNHred": [None, 0.0, 0.0, 0.0],
        "rsLine": [1.0, 1.1, 1.2, 1.26],
        "rsMa": [None, None, 1.1, 1.2],
    }
    last = rs.last_rs_high(cols, [10, 11, 12, 13])
    assert last == {"index": 2, "time": 12, "beforePrice": True, "redDay": False, "barsAgo": 1}
    leg = rs.legend_scalars(cols)
    assert leg["pctFromMa"] == pytest.approx(5.0)
    assert leg["above"] is True and leg["maSlope"] == 1


def test_red_on_green_is_the_mirror_of_green_on_red():
    """A green day is the benchmark UP by at least the red-day magnitude and the
    stock strictly DOWN; a flat day on either side is neither (review finding)."""
    closes = [100.0, 99.0, 99.0, 98.0, 99.0]          # down, flat, down, up
    bench = [100.0, 100.6, 100.4, 101.2, 100.0]        # +0.6, −0.2, +0.8, −1.19
    out = rs.compute_phase1_columns(_bars(closes), _bars(bench), {"lookback": 20, "maLength": 2})
    assert out["rog"] == [None, 1.0, 0.0, 1.0, 0.0]    # flat stock on a mild day is not red-on-green
    assert out["gor"] == [None, 0.0, 0.0, 0.0, 1.0]


def test_partial_dots_only_when_the_history_really_is_short():
    series = [float(v) for v in range(1, 40)]
    bars, bench = _bars(series), _bars([2.0] * 39)
    long = rs.compute_phase1_columns(bars, bench, {"lookback": 30, "maLength": 5})
    assert all(v is None for v in long["rsNHpartial"]) and all(v is None for v in long["dotNHpartial"])
    short = rs.compute_phase1_columns(bars, bench, {"lookback": 30, "maLength": 5}, short_history=True)
    assert any(v == 1.0 for v in short["rsNHpartial"])


def test_no_column_ever_carries_nan_or_a_bool():
    n = 60
    out = rs.compute_phase1_columns(_bars([float(i + 1) for i in range(n)]),
                                    _bars([2.0] * n), {"lookback": 20, "maLength": 5})
    for key, col in out.items():
        for v in col:
            assert v is None or (isinstance(v, float) and math.isfinite(v)), (key, v)
            assert not isinstance(v, bool), (key, v)
