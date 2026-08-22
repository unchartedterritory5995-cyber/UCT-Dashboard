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


def test_recon_day_seeds_open_bucket_with_prior_close(monkeypatch):
    """The seeded-open fix: the 9:30 bucket must see the FULL universe (untraded
    names sitting at prior close), not just the handful that printed in the first
    30 min — otherwise the open is a biased fake-low that becomes a garbage wick."""
    from api.services import build_intraday_cache as bic
    tickers = [f"T{i}" for i in range(10)]
    levels = _levels_flat(tickers, close=100.0)      # prev_close = 100 for all

    monkeypatch.setattr(wr.bl if hasattr(wr, "bl") else bl, "_bars_conn",
                        lambda: None, raising=False)
    monkeypatch.setattr(bl, "_bars_conn", lambda: None, raising=False)
    monkeypatch.setattr(wr, "_levels_for_day", lambda conn, u, ts: levels)
    monkeypatch.setattr(wr, "_s3_client", lambda: object())
    # only ONE name prints in the (single) bucket; the other nine never trade
    monkeypatch.setattr(bic, "download_and_resample",
                        lambda client, key, mins, uni: {30: {"T0": [{"t": 1, "o": 101,
                        "h": 101, "l": 101, "c": 101, "v": 1}]}})

    captured = {}
    real_agg = wr.aggregate_day
    def spy(levels_, pbb, close_val, *a, **k):
        captured["pbb"] = pbb
        return real_agg(levels_, pbb, close_val, *a, **k)
    monkeypatch.setattr(wr, "aggregate_day", spy)

    wr.recon_day("2026-07-28", tickers, client=object(), bucket_min=30)
    open_bucket = captured["pbb"][0]
    assert len(open_bucket) == 10                     # full universe, not just T0
    assert open_bucket["T0"] == 101.0                 # the name that traded
    assert open_bucket["T5"] == 100.0                 # an untraded name → prior close


def test_sane_wick_gate():
    assert wr.sane_wick("pct_above_50sma", 60, 70, 50, 60)[0] is True
    assert wr.sane_wick("pct_above_50sma", 20, 90, 20, 20)[0] is False   # 70-pt range
    assert wr.sane_wick("pct_above_50sma", 60, 55, 50, 60)[0] is False   # h < body-high (inverted)
    assert wr.sane_wick("pct_above_50sma", 60, 70, 62, 60)[0] is False   # l > body-low (inverted)
    assert wr.sane_wick("new_20d_lows", 100, 400, 50, 300)[0] is True    # count: no delta bound
    assert wr.sane_wick("pct_above_50sma", 60, float("nan"), 50, 60)[0] is False
