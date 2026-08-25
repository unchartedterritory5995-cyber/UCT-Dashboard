"""The backtest's contracts — and above all, that its controls actually work.

⭐ THE MODULE'S ENTIRE VALUE IS ITS CONTROLS. A backtest that reports a raw hit
rate is worse than no backtest, because it hands a member a number that looks
like evidence. These tests build populations where the TRUE excess is known to
be zero and assert the measurement finds zero — a control that cannot fail is
not a control.
"""
import pytest

from api.services.screener import candle_backtest as bt


def _bar(o, h, l, c, t=20260101, v=1_000_000):
    return {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}


# ── the date-matched base rate ──────────────────────────────────────────────
def test_a_label_that_only_fires_on_up_days_shows_no_excess():
    """🔴 THE DEFECT THIS WHOLE MODULE EXISTS FOR. Building the T+1 column, a
    59.9% hit rate looked like edge until the universe's own rate on the same
    days turned out to be 59%. Here: a label that fires ONLY on days the whole
    market rose, and rises exactly as much as the market does, must measure ZERO
    excess — not the market's return."""
    universe, labelled = {}, {}
    for day in range(200):
        cell = (20260000 + day, 4)
        # the market gained 3% that day, across 100 bars
        universe[cell] = [100, 3.0 * 100, 3.0 * 100, 3.0 * 100, 100.0]
        # our label fired on 10 of them and did exactly as well
        labelled[("ghost", cell)] = [10, 3.0 * 10, 3.0 * 10, 3.0 * 10, 10.0]
    rows = bt.summarize(labelled, universe, min_dates=10)
    assert len(rows) == 1
    r = rows[0]
    assert r["label"] == "ghost"
    assert abs(r["excess_5d"]) < 1e-9, r
    assert abs(r["excess_winrate_5d"]) < 1e-9, r


def test_a_label_with_real_excess_is_detected():
    """⛔ THE CONTROL ON THE CONTROL. If the test above passed because the
    measurement always returns zero, it would be proving nothing."""
    universe, labelled = {}, {}
    for day in range(200):
        cell = (20260000 + day, 4)
        universe[cell] = [100, 0.0, 0.0, 0.0, 50.0]
        labelled[("real", cell)] = [10, 5.0, 20.0, 30.0, 10.0]   # +2% mean at 5d
    rows = bt.summarize(labelled, universe, min_dates=10)
    r = rows[0]
    assert abs(r["excess_5d"] - 2.0) < 1e-9, r
    assert r["t_5d"] > 100, "a noiseless effect should be overwhelmingly significant"


def test_an_all_time_base_rate_would_have_been_wrong():
    """⛔ THE BASE RATE IS DATE-MATCHED, NOT ALL-TIME. A label that fires only in
    a crash must be judged against the crash. Measured against the fifty-year
    mean it would look catastrophic; measured against its own days it is flat."""
    universe, labelled = {}, {}
    for day in range(100):                       # ordinary days, market flat
        universe[(20260000 + day, 4)] = [100, 0.0, 0.0, 0.0, 50.0]
    for day in range(100, 160):                  # the crash, market -8%
        cell = (20260000 + day, 4)
        universe[cell] = [100, -800.0, -800.0, -800.0, 0.0]
        labelled[("crash_only", cell)] = [10, -80.0, -80.0, -80.0, 0.0]
    rows = bt.summarize(labelled, universe, min_dates=10)
    assert abs(rows[0]["excess_5d"]) < 1e-9, "date-matching should net this to zero"


# ── the same-day-move control ───────────────────────────────────────────────
def test_the_move_bucket_separates_a_drop_from_a_rally():
    """🔴 THE SECOND CONFOUND, AND IT WAS LARGE. Matched on date alone, every
    bearish label measured POSITIVE and every bullish one NEGATIVE — short-term
    mean reversion, not a candle effect. Bars are matched on how far they moved,
    in ATR units, so a 3% day on a quiet name and a 3% day on a wild one are not
    pooled together."""
    assert bt.move_bucket(-6.0, 2.0) == 0            # -3 ATR
    assert bt.move_bucket(-1.5, 2.0) == 2            # -0.75 ATR
    assert bt.move_bucket(1.5, 2.0) == 5             # +0.75 ATR
    assert bt.move_bucket(6.0, 2.0) == 7             # +3 ATR
    assert bt.move_bucket(-6.0, 2.0) != bt.move_bucket(6.0, 2.0)


def test_an_unmeasurable_move_is_dropped_not_pooled():
    """⚠️ A bar with no usable ATR cannot be matched to anything. Pooling it with
    moves it may not resemble is how a control quietly stops controlling."""
    assert bt.move_bucket(1.0, 0) is None
    assert bt.move_bucket(1.0, None) is None
    assert bt.move_bucket(1.0, -1) is None


def test_the_buckets_are_total_over_every_finite_move():
    seen = {bt.move_bucket(z * 2.0, 2.0) for z in
            (-100, -3, -2, -1.5, -1, -0.75, -0.5, -0.1, 0, 0.1, 0.5, 1, 2, 3, 100)}
    assert None not in seen
    assert seen == set(range(len(bt.MOVE_BUCKETS) + 1))


# ── date clustering ─────────────────────────────────────────────────────────
def test_one_tape_is_one_observation():
    """⛔ 4,000 hammers on one morning are not 4,000 independent samples. The
    significance of a label that fired on FIVE days must not grow just because
    it fired on more tickers each of those days."""
    # ⚠️ REAL SPREAD ACROSS DAYS. With an identical excess every session the
    # variance is zero, the t-stat is degenerate for BOTH arms, and the
    # comparison would prove nothing about clustering.
    daily = [0.4, 1.6, -0.3, 2.2, 0.9]

    def _rows(per_day):
        universe, labelled = {}, {}
        for day, r in enumerate(daily):
            cell = (20260000 + day, 4)
            universe[cell] = [per_day * 10, 0.0, 0.0, 0.0, 50.0]
            labelled[("x", cell)] = [per_day, 0.0, per_day * r, 0.0, per_day * 1.0]
        return bt.summarize(labelled, universe, min_dates=1)[0]

    few, many = _rows(10), _rows(10_000)
    assert few["n_dates"] == many["n_dates"] == 5
    assert many["n_instances"] == 1000 * few["n_instances"]
    assert 0 < few["t_5d"] < float("inf"), few
    assert abs(few["t_5d"] - many["t_5d"]) < 1e-6, \
        "significance must come from DATES, never from instances"


def test_a_label_below_the_session_floor_is_not_reported():
    universe = {(20260001, 4): [100, 0.0, 0.0, 0.0, 50.0]}
    labelled = {("rare", (20260001, 4)): [1, 5.0, 5.0, 5.0, 1.0]}
    assert bt.summarize(labelled, universe, min_dates=30) == []


def test_a_cell_the_label_wholly_occupies_is_dropped():
    """⛔ When the label's instances ARE the whole cell, the base rate is the
    label's own mean and the excess is identically zero — which would drag every
    average toward nothing and understate a real effect."""
    universe, labelled = {}, {}
    for day in range(60):
        cell = (20260000 + day, 4)
        universe[cell] = [5, 50.0, 50.0, 50.0, 5.0]         # the label IS the cell
        labelled[("solo", cell)] = [5, 50.0, 50.0, 50.0, 5.0]
    assert bt.summarize(labelled, universe, min_dates=10) == []


# ── no lookahead ────────────────────────────────────────────────────────────
def test_classification_never_sees_a_bar_it_is_predicting():
    """⛔ The single failure that would invalidate everything. The window handed
    to the classifier must END at the bar being labelled."""
    seen = {}

    def spy(window):
        seen["last"] = window[-1]["t"]
        seen["len"] = len(window)
        return {"candle_matches": ",x,"}

    bars = [_bar(10, 11, 9, 10, t=20260000 + i) for i in range(120)]
    bt.labels_for(bars, 60, spy, lambda w: None, lambda s: ["x"])
    assert seen["last"] == bars[60]["t"], "window ran past the labelled bar"
    assert seen["len"] <= bt.WINDOW + 1


def test_the_scan_stops_far_enough_from_the_end_to_have_a_forward_return():
    calls = []
    bars = [_bar(10, 11, 9, 10 + (i % 3), t=20260000 + i) for i in range(200)]

    def spy(window):
        calls.append(window[-1]["t"])
        return {"candle_matches": ",x,"}

    bt.scan_ticker(bars, spy, lambda w: None, lambda s: ["x"])
    assert calls, "nothing was scanned"
    assert max(calls) <= bars[-1 - max(bt.HORIZONS)]["t"]


def test_a_broken_bar_costs_its_own_observation_not_the_ticker():
    bars = [_bar(10, 11, 9, 10, t=20260000 + i) for i in range(200)]
    bars[100] = {"t": 20260100, "o": None, "h": None, "l": None, "c": None, "v": 0}
    lab, uni = bt.scan_ticker(bars, lambda w: {"candle_matches": ",x,"},
                              lambda w: None, lambda s: ["x"])
    assert uni, "one bad bar killed the whole ticker"
    assert not any(k[0] == 20260100 for k in uni), "the bad bar was counted"


# ── outlier control ─────────────────────────────────────────────────────────
def test_forward_returns_are_clipped_before_averaging():
    """🔴 THE TELL THAT FOUND THIS: the first full run reported `gravestone-doji`
    at +6.0% excess with a t-statistic of 1.48. A huge mean beside a negligible
    t is a handful of observations carrying the whole average — sub-dollar names
    that went up 2,000% in a week. Real moves, but a statistic they dominate
    describes them, not the label."""
    assert bt._clip(2000.0) == bt.WINSOR_PCT
    assert bt._clip(-2000.0) == -bt.WINSOR_PCT
    assert bt._clip(3.2) == 3.2          # ordinary moves untouched


def test_the_clip_is_applied_to_the_universe_too():
    """⛔ CLIPPED ON BOTH SIDES OR NOT AT ALL. If only the labelled population
    were clipped, every label would measure an artificial deficit against an
    unclipped base rate."""
    bars = [_bar(10, 11, 9, 10, t=20260000 + i) for i in range(120)]
    bars[80] = _bar(10, 300, 9, 250, t=bars[80]["t"])       # a moonshot
    for i in range(81, 120):
        bars[i] = _bar(250, 260, 240, 250, t=bars[i]["t"])
    _, uni = bt.scan_ticker(bars, lambda w: {"candle_matches": ",x,"},
                            lambda w: None, lambda s: ["x"])
    worst = max(abs(u[2] / u[0]) for u in uni.values() if u[0])
    assert worst <= bt.WINSOR_PCT + 1e-9, worst
