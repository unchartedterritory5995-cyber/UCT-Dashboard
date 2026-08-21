"""Task 9 — builder wiring: setup_score + the four context maps into the
nightly build.

Two rails:
  * the bar-consumer disjointness rail (new ground: the five bar consumers
    ``update()`` unconditionally, so a key overlap is a silent clobber, not a
    crash or a duplicate)
  * the wiring proof: `build_row` merges `context_row` and runs
    `setup_score.compute`; `run_build` reads all four context maps once and
    threads the per-ticker merge through.
"""


def test_bar_consumers_write_disjoint_key_sets():
    bars = [{"o": 100.0, "h": 100.5, "l": 99.5, "c": 100.0, "v": 1000}] * 60
    from api.services.screener import technicals, candles, setup_score
    sets = {
        "compute_technicals": set(technicals.compute_technicals(bars)),
        "ath_fields": set(technicals.ath_fields(bars)),
        "single_candle": set(candles.single_candle(bars)),
        "multi_candle": set(candles.multi_candle(bars)),
        "setup_score": set(setup_score.compute(bars)),
    }
    names = sorted(sets)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            overlap = sets[a] & sets[b]
            assert not overlap, f"{a} and {b} both write {sorted(overlap)}"


def test_build_row_merges_context_and_scores(monkeypatch):
    from api.services.screener import snapshot_builder
    bars = [{"o": 100.0, "h": 100.5, "l": 99.5, "c": 100.0, "v": 1000}] * 60
    row = snapshot_builder.build_row(
        "T", bars, None, None,
        context_row={"stage2": True, "in_uct20": False, "index_sp500": True})
    assert row["stage2"] is True and row["index_sp500"] is True
    assert row["candle_score"] is not None        # setup_score ran
    assert row["dist_ath_pct"] is not None        # ath_fields ran


def test_run_build_passes_context_through(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_builder as sb, snapshot_db
    bars = [(20250101 + i, 100.0, 100.5, 99.5, 100.0, 1000) for i in range(60)]
    monkeypatch.setattr(sb, "_load_universe", lambda: ["AAA"])
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(bs, "get_bars", lambda t, tf, n: bars)
    monkeypatch.setattr(sb, "_read_rs_map", lambda: {})
    monkeypatch.setattr(sb, "_read_bulk_fundamentals", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_fundamentals",
                        lambda t, price=None, failures=None: {})
    monkeypatch.setattr(sb, "_read_spy_closes", lambda: [])
    from api.services.screener import context_joins as cj
    monkeypatch.setattr(cj, "read_breadth_flags",
                        lambda targets, failures=None: {"AAA": {"stage2": True}})
    for fn in ("read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    out = sb.run_build(max_tickers=1)
    assert out["built"] == 1
    assert snapshot_db.get_row("AAA")["stage2"] == 1
