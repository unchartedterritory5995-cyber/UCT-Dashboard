"""End-to-end smoke: build one real ticker via the actual readers, then scan it.
Skips gracefully when local bars aren't available in the environment, but still
proves the reader wrappers resolve (no AttributeError on real service names)."""
import importlib
import pytest


def test_build_one_ticker_then_scan(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    try:
        bars = b._read_daily_bars("AAPL")
    except Exception as e:
        pytest.skip(f"local bars reader unavailable: {e}")
    if not bars:
        pytest.skip("no local bars for AAPL in this environment")

    # readers must at least not raise
    ratings = b._read_ratings("AAPL")
    funda = b._read_fundamentals("AAPL")
    row = b.build_row("AAPL", bars, ratings, funda)

    import api.services.screener.snapshot_db as db
    importlib.reload(db)
    db.init_db()
    db.upsert_rows([row])

    import api.services.screener.query as q
    importlib.reload(q)
    res = q.run_scan({"filters": [{"key": "price", "op": "gte", "min": 1}],
                      "view": "technical"})
    assert res["total"] == 1
    assert res["rows"][0]["ticker"] == "AAPL"


def test_pct_survives_a_null_close():
    """A bar with a null close is ordinary (halt, thin tape, provider gap).
    `_pct` guarded only its denominator, so a null numerator raised TypeError
    and took down the ENTIRE row build in snapshot_builder.build_row — not
    just the one percentage field. Regression rail for that crash."""
    from api.services.screener import technicals as t
    assert t._pct(None, 309.38) is None      # the crash
    assert t._pct(309.38, None) is None      # mirror
    assert t._pct(None, None) is None
    assert t._pct(309.38, 0) is None         # denominator still guarded
    # CONTROL: real numbers still compute, and a genuine 0% is not swallowed.
    assert t._pct(110.0, 100.0) == 10.0
    assert t._pct(90.0, 100.0) == -10.0
    assert t._pct(100.0, 100.0) == 0.0


def test_compute_technicals_with_a_null_close_does_not_raise():
    from api.services.screener import technicals as t
    # A null close anywhere in the series used to raise out of _rsi/_sma/_ema
    # and kill the WHOLE row, not just the fields that touched it.
    bars = [{"c": 100.0, "o": 99.0, "h": 101.0, "l": 98.0, "v": 1000},
            {"c": None, "o": 100.0, "h": 102.0, "l": 99.0, "v": 1200},
            {"c": 110.0, "o": 105.0, "h": 111.0, "l": 104.0, "v": 1500}]
    out = t.compute_technicals(bars)          # must not raise
    # The unusable bar is dropped, so "1d" compares the two sessions that
    # actually printed: 110 vs 100.
    assert out["price"] == 110.0
    assert out["chg_pct_1d"] == 10.0
    # gap_pct pairs THIS bar's open with the prior printed close (105 vs 100).
    assert out["gap_pct"] == 5.0

    # CONTROL: a clean series is untouched by the filter.
    clean = [{"c": 100.0, "o": 99.0, "h": 101.0, "l": 98.0, "v": 1000},
             {"c": 110.0, "o": 105.0, "h": 111.0, "l": 104.0, "v": 1500}]
    assert t.compute_technicals(clean)["chg_pct_1d"] == 10.0

    # A series with NOTHING usable returns the empty shape rather than raising.
    assert t.compute_technicals([{"c": None, "o": 1.0, "h": 1.0, "l": 1.0, "v": 1}])["price"] is None


def test_build_row_survives_a_bar_with_a_null_close():
    """The whole point of sanitizing at the boundary: ONE bad bar must not
    cost the ticker its fundamentals and ratings, which have nothing to do
    with the tape. Before the fix this raised out of technicals (or candles,
    or patterns — whichever ran first) and lost the entire row."""
    from api.services.screener import snapshot_builder as b
    bars = ([{"c": 100.0 + i, "o": 99.0 + i, "h": 101.0 + i, "l": 98.0 + i, "v": 1000, "t": i}
             for i in range(40)]
            + [{"c": None, "o": 140.0, "h": 142.0, "l": 139.0, "v": 1200, "t": 40}])
    row = b.build_row("AAPL", bars, {"rs_rank": 88}, {"market_cap": 3.1e12})
    assert row["ticker"] == "AAPL"
    # Bar-derived fields still computed, from the sessions that printed.
    assert row["price"] == 139.0
    assert row["rsi14"] is not None
    # And the non-bar data survived — that is what the crash used to destroy.
    assert row["rs_rank"] == 88
    assert row["market_cap"] == 3.1e12


def test_usable_bars_rejects_nan_and_booleans():
    from api.services.screener import technicals as t
    good = {"o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5}
    assert t.usable_bars([good]) == [good]
    assert t.usable_bars([{**good, "c": float("nan")}]) == []   # NaN is a float
    assert t.usable_bars([{**good, "c": True}]) == []           # bool is an int
    assert t.usable_bars([{**good, "o": None}]) == []           # not just the close
    assert t.usable_bars([{**good, "h": "2.0"}]) == []          # strings are not prices
    assert t.usable_bars(None) == []
