import importlib


def test_build_row_merges_all_groups(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    bars = [{"t": 20260100 + i, "o": float(i), "h": i * 1.01, "l": i * 0.99,
             "c": float(i), "v": 1_000_000} for i in range(1, 260)]
    # ratings + funda are already keyed by snapshot columns (the readers map them)
    ratings = {"uct_composite": 95, "rs_rank": 92, "accdis": "B"}
    funda = {"company": "NVIDIA", "sector": "Technology", "industry": "Semis",
             "market_cap": 4.5e12, "pe_ttm": 41.0, "pe_fwd": 30.0,
             "eps_growth": 50.0, "op_margin": 40.0, "roe": 30.0,
             "dividend_yield": 0.0, "beta": 1.6}
    row = b.build_row("nvda", bars, ratings, funda)
    assert row["ticker"] == "NVDA"
    assert row["company"] == "NVIDIA"
    assert row["uct_composite"] == 95
    assert row["pe_fwd"] == 30.0
    assert row["above_50sma"] is True
    assert row["ma_stack"] == "full-bull"
    assert row["candle_type"] is not None
    assert row["avg_volume_30d"] == 1_000_000
    assert row["patterns"]  # rising series -> at least breakout_52w
    assert "snapshot_date" in row and row["built_at"]


def test_build_row_survives_empty_bars(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    row = b.build_row("AAA", [], {}, {"company": "A"})
    assert row["ticker"] == "AAA"
    assert row["price"] is None
    assert row["company"] == "A"
