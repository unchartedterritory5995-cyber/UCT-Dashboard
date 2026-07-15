"""Tests for the thematic equal-weight index math (api/services/theme_index.py)."""
from api.services.theme_index import _compute_index_bars, _resample, _slugify

D = 86_400_000  # one day in ms


def _bar(day, o, h, l, c, v):
    return {"t": day * D, "o": o, "h": h, "l": l, "c": c, "v": v}


def test_equal_weight_daily_rebalanced():
    # A: 100 -> +10% -> -10% ; B: 50 -> +10% -> +10%
    A = [_bar(1, 100, 100, 100, 100, 1000), _bar(2, 101, 112, 100, 110, 1000), _bar(3, 110, 110, 98, 99, 1000)]
    B = [_bar(1, 50, 50, 50, 50, 2000), _bar(2, 50, 56, 50, 55, 2000), _bar(3, 55, 61, 55, 60.5, 2000)]
    idx = _compute_index_bars({"A": A, "B": B})
    assert len(idx) == 2                       # first bar of each has no prior close
    assert abs(idx[0]["c"] - 110.0) < 0.01     # +10% & +10% -> +10% from base 100
    assert abs(idx[1]["c"] - 110.0) < 0.6      # -10% & +10% -> ~flat
    assert all(b["v"] == 3000 for b in idx)    # volume summed across holdings


def test_candles_always_valid():
    A = [_bar(1, 10, 10, 10, 10, 5), _bar(2, 9, 15, 8, 12, 5)]
    B = [_bar(1, 20, 20, 20, 20, 5), _bar(2, 22, 25, 19, 21, 5)]
    for b in _compute_index_bars({"A": A, "B": B}):
        assert b["h"] >= max(b["o"], b["c"])
        assert b["l"] <= min(b["o"], b["c"])


def test_holding_joins_when_it_starts():
    # B starts a day late; the index still forms from A alone, then blends B in.
    A = [_bar(1, 100, 100, 100, 100, 1), _bar(2, 100, 110, 100, 110, 1), _bar(3, 110, 110, 100, 110, 1)]
    B = [_bar(2, 50, 50, 50, 50, 1), _bar(3, 50, 60, 50, 60, 1)]  # +20% on day 3
    idx = _compute_index_bars({"A": A, "B": B})
    assert len(idx) == 2  # day2 (A only), day3 (A flat + B +20%)


def test_resample_weekly():
    daily = [
        {"t": 1 * D, "o": 100, "h": 105, "l": 99, "c": 104, "v": 10},
        {"t": 2 * D, "o": 104, "h": 108, "l": 103, "c": 107, "v": 20},
    ]
    wk = _resample(daily, "W")
    assert len(wk) == 1
    assert wk[0]["o"] == 100 and wk[0]["c"] == 107
    assert wk[0]["h"] == 108 and wk[0]["l"] == 99 and wk[0]["v"] == 30


def test_slugify():
    assert _slugify("MEMORY & HBM") == "memory-hbm"
    assert _slugify("Photonics & Optical") == "photonics-optical"
