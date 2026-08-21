"""Task 10 — builder wiring: the six Wave 2 source readers into `build_row`
and `run_build`, plus the `pt_upside_pct` derivation.

Two rails:
  * `build_row` merges `market_row` (the per-ticker merge of the six Wave 2
    readers) between `ratings_row` and `context_row`, and derives
    `pt_upside_pct` from `pt_target` (market_row) vs `price` (bars).
  * `run_build` reads each of the six readers ONCE per build (never per
    ticker) and threads the per-ticker merge through as `market_row=`.
"""


def test_build_row_merges_market_row_and_derives_pt_upside():
    from api.services.screener import snapshot_builder
    bars = [{"o": 100.0, "h": 100.5, "l": 99.5, "c": 100.0, "v": 1000}] * 40
    row = snapshot_builder.build_row(
        "T", bars, None, None,
        market_row={"short_float_pct": 22.4, "pt_target": 125.0,
                    "next_earnings_date": "2026-09-03"})
    assert row["short_float_pct"] == 22.4
    assert row["pt_upside_pct"] == 25.0          # 125 vs price 100
    assert row["days_to_earnings"] is not None   # T4's derivation fires


def test_run_build_passes_market_row_through(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_builder as sb, snapshot_db
    from api.services.screener import (finviz_universe, earnings_dates,
                                       earnings_context, analyst_pass,
                                       insider_capture, context_joins as cj)
    bars = [(20250101 + i, 100.0, 100.5, 99.5, 100.0, 1000) for i in range(60)]
    monkeypatch.setattr(sb, "_load_universe", lambda: ["AAA"])
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(bs, "get_bars", lambda t, tf, n: bars)
    monkeypatch.setattr(sb, "_read_rs_map", lambda: {})
    monkeypatch.setattr(sb, "_read_bulk_fundamentals",
                        lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(sb, "_read_fundamentals",
                        lambda t, price=None, failures=None: {})
    monkeypatch.setattr(sb, "_read_spy_closes", lambda: [])
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags",
               "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})

    calls = {"finviz": 0, "analyst": 0}

    def finviz_stub(targets, failures=None):
        calls["finviz"] += 1
        return {"AAA": {"short_float_pct": 31.2}}

    def analyst_stub(targets, failures=None):
        calls["analyst"] += 1
        return {"AAA": {"pt_target": 130.0}}

    monkeypatch.setattr(finviz_universe, "read_finviz_fields", finviz_stub)
    monkeypatch.setattr(analyst_pass, "read_analyst_fields", analyst_stub)
    for mod, fn in ((earnings_dates, "read_earnings_dates"),
                    (earnings_context, "read_last_report_move"),
                    (earnings_context, "read_implied_context"),
                    (insider_capture, "read_insider_fields")):
        monkeypatch.setattr(mod, fn, lambda targets, failures=None: {})

    out = sb.run_build(max_tickers=1)
    assert out["built"] == 1
    row = snapshot_db.get_row("AAA")
    assert row["short_float_pct"] == 31.2
    assert row["pt_target"] == 130.0
    assert row["pt_upside_pct"] == 30.0        # derived vs price 100
    assert calls == {"finviz": 1, "analyst": 1}  # one read per build, each
