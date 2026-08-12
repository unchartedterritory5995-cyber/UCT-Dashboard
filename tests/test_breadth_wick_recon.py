"""Phase 3 historical-wick core: intraday replay → OHLC + the anti-garbage gate.

Uses the REAL breadth_live.compute_metrics (not a mock) over a synthetic flat-price
universe, so it proves the method end-to-end: a genuine intraday breadth swing
becomes a real wick, and the failed shortcut's tell (an absurd intraday range) is
rejected back to an honest body.
"""
import numpy as np

from api.services import breadth_live as bl
from api.services import breadth_wick_recon as wr


def _levels_flat(tickers, n_dates=260, close=100.0):
    """build_levels over a flat history — every MA equals `close`, so a stock priced
    above/below `close` is deterministically above/below all its MAs."""
    closes = np.full((len(tickers), n_dates), close, dtype=float)
    vols = np.full((len(tickers), n_dates), 1e6, dtype=float)
    return bl.build_levels(tickers, closes, vols, 20260810)


def _prices(tickers, n_above, hi=101.0, lo=99.0):
    return {t: (hi if i < n_above else lo) for i, t in enumerate(tickers)}


def test_aggregate_day_reconstructs_a_real_wick():
    tickers = [f"T{i}" for i in range(10)]
    levels = _levels_flat(tickers)
    # % above 50MA swings 60 → 70 → 50 through the day; official close 60.
    buckets = [_prices(tickers, 6), _prices(tickers, 7), _prices(tickers, 5)]
    out = wr.aggregate_day(levels, buckets, {"pct_above_50sma": 60.0})
    r = out["pct_above_50sma"]
    assert r["source"] == "intraday_recon"
    assert r["o"] == 60.0 and r["c"] == 60.0
    assert r["h"] == 70.0 and r["l"] == 50.0        # real upper + lower wick


def test_aggregate_day_rejects_the_garbage_wick_signature():
    tickers = [f"T{i}" for i in range(10)]
    levels = _levels_flat(tickers)
    # a 20 → 90 → 20 "swing" (70-pt range) is the per-stock-extremes bug's tell.
    buckets = [_prices(tickers, 2), _prices(tickers, 9), _prices(tickers, 2)]
    out = wr.aggregate_day(levels, buckets, {"pct_above_50sma": 20.0})
    r = out["pct_above_50sma"]
    assert r["source"] == "close_recon"             # wick rejected → honest body
    assert r["o"] == r["h"] == r["l"] == r["c"] == 20.0
    assert "garbage-wick" in r.get("flagged", "")


def test_sane_wick_gate():
    assert wr.sane_wick("pct_above_50sma", 60, 70, 50, 60)[0] is True
    assert wr.sane_wick("pct_above_50sma", 20, 90, 20, 20)[0] is False   # 70-pt range
    assert wr.sane_wick("pct_above_50sma", 60, 55, 50, 60)[0] is False   # h < body-high (inverted)
    assert wr.sane_wick("pct_above_50sma", 60, 70, 62, 60)[0] is False   # l > body-low (inverted)
    assert wr.sane_wick("new_20d_lows", 100, 400, 50, 300)[0] is True    # count: no delta bound
    assert wr.sane_wick("pct_above_50sma", 60, float("nan"), 50, 60)[0] is False
