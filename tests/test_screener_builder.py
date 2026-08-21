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


# ───────────────────────── the RS wire + the population census ──────────────
#
# 🔴 THE DEFECT THESE COVER. The 2026-08-09 03:05 build logged
# `built=3708 skipped=0 errors=0` while writing NULL into `market_cap`,
# `rs_rank` and `rs_return` on EVERY row. Nothing was red, because every
# producer's unit test mocks its provider. These rails watch the two things a
# mock cannot: which SOURCE owns a column, and whether the run can SAY a column
# came out empty.

def test_rs_fields_maps_the_ranking_entry_to_both_columns():
    from api.services.screener import snapshot_builder as b
    assert b.rs_fields(None) == {}
    assert b.rs_fields({}) == {}
    out = b.rs_fields({"ticker": "NVDA", "rs_rank": 97, "rs_score": 41.25})
    assert out == {"rs_rank": 97, "rs_return": 41.25}
    # A partial entry contributes what it has and invents nothing.
    assert b.rs_fields({"rs_rank": 12}) == {"rs_rank": 12}
    assert b.rs_fields({"rs_score": -3.5}) == {"rs_return": -3.5}


def test_the_rs_authority_wins_over_a_ratings_row_that_still_carries_rank(tmp_path, monkeypatch):
    """⛔ ONE AUTHORITY, ENFORCED BY MERGE ORDER.

    `enrich.ratings_fields` no longer emits `rs_rank`/`rs_return` (its own rail
    says so). This is the belt to that braces: even handed a ratings dict that
    DOES carry a rank — the shape that shipped for months — the value written is
    `rs_ranking`'s. Without the ordering, flipping RATINGS_PERCENTILE_ENABLED
    would silently change what `rs_rank > 80` means.
    """
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    row = b.build_row("AAA", [], {"rs_rank": 11, "rs_return": 1.0},
                      {}, {"rs_rank": 97, "rs_score": 41.25})
    assert row["rs_rank"] == 97
    assert row["rs_return"] == 41.25


def test_read_fundamentals_counts_a_MISS_not_only_a_raise(monkeypatch):
    """🔴 THE RED PROOF FOR THE CENSUS ITSELF.

    `massive.get_ticker_details` swallows its own errors and returns `{}`, so a
    missing `MASSIVE_API_KEY` arrives here as a polite `None`. The first cut of
    this counter watched `except` arms only and could never fire on the exact
    outage it was written for — measured by
    `.superpowers/sdd/phase-e/fix_empty_scalars_measure.py --no-key`.
    """
    from api.services.screener import snapshot_builder as b
    import api.services.massive as massive
    import api.services.ticker_meta as ticker_meta
    monkeypatch.setattr(massive, "get_market_cap", lambda t, price=None: None)
    monkeypatch.setattr(ticker_meta, "get_ticker_meta", lambda t: {"name": "A", "sector": "Tech"})
    failures = {}
    out = b._read_fundamentals("AAA", price=10.0, failures=failures)
    assert "market_cap" not in out
    assert failures["massive_market_cap"] == {"none": 1}

    # ...and a genuine raise is still counted, BY EXCEPTION NAME.
    def _boom(t, price=None):
        raise RuntimeError("MASSIVE_API_KEY not set in environment")
    monkeypatch.setattr(massive, "get_market_cap", _boom)
    failures = {}
    b._read_fundamentals("AAA", price=10.0, failures=failures)
    assert failures["massive_market_cap"] == {"RuntimeError": 1}


def test_run_build_names_the_columns_that_came_out_empty(tmp_path, monkeypatch):
    """The line the 03:05 build could not print.

    ⛔ `empty_columns` is DERIVED from `snapshot_db.COLUMNS`, so a 66th column
    is counted the day it lands. The assertion below is likewise derived: it
    asks whether the two columns this run could not fill are named, not whether
    the list equals something retyped here.
    """
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    bars = [{"t": 20260100 + i, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1000}
            for i in range(60)]
    monkeypatch.setattr(b, "_load_universe", lambda: ["AAA", "BBB"])
    monkeypatch.setattr(b, "_read_daily_bars", lambda t: bars)
    monkeypatch.setattr(b, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_fundamentals",
                        lambda t, price=None, failures=None: {"company": "X"})
    monkeypatch.setattr(b, "_read_rs_map", lambda: {})
    # ⛔ EXPLICIT, not left to a missing key. `fetch_bulk` no-ops without
    # FMP_API_KEY, so this test would PASS on a dry box and quietly fire six
    # bulk requests on a developer's — the order-dependent, environment-shaped
    # green this repo has measured before.
    monkeypatch.setattr(b, "_read_bulk_fundamentals",
                        lambda targets, failures=None: {})
    from api.services.screener import context_joins as cj
    # context readers stubbed: run_build unit tests predate context joins; real reads trip the shared-data-root guard on the dev box
    monkeypatch.setattr(cj, "read_breadth_flags", lambda targets, failures=None: {})
    monkeypatch.setattr(cj, "read_uct20", lambda targets, failures=None: {})
    monkeypatch.setattr(cj, "read_index_flags", lambda targets, failures=None: {})
    monkeypatch.setattr(cj, "read_etf_flags", lambda targets, failures=None: {})

    stats = b.run_build()
    assert stats["built"] == 2
    assert stats["populated"]["company"] == 2
    # Nothing supplied these, and the run SAYS SO instead of printing errors=0.
    assert "market_cap" in stats["empty_columns"]
    assert "rs_rank" in stats["empty_columns"]
    # A cold RS cache is attributed, not inferred from the empty column.
    assert stats["sources"]["rs_ranking"] == {"no_rank": 2}
    # ...and a column that WAS filled is not slandered.
    assert "price" not in stats["empty_columns"]


def test_run_build_stops_naming_a_column_once_it_is_filled(tmp_path, monkeypatch):
    """The control for the rail above: same run, one reader now answering.

    A census that named `market_cap` unconditionally would pass the previous
    test forever.
    """
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s2.db"))
    import api.services.screener.snapshot_builder as b
    importlib.reload(b)
    bars = [{"t": 20260100 + i, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1000}
            for i in range(60)]
    monkeypatch.setattr(b, "_load_universe", lambda: ["AAA", "BBB"])
    monkeypatch.setattr(b, "_read_daily_bars", lambda t: bars)
    monkeypatch.setattr(b, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_fundamentals",
                        lambda t, price=None, failures=None: {"market_cap": 1.0e9})
    monkeypatch.setattr(b, "_read_rs_map",
                        lambda: {"AAA": {"rs_rank": 90, "rs_score": 12.5},
                                 "BBB": {"rs_rank": 10, "rs_score": -4.0}})
    monkeypatch.setattr(b, "_read_bulk_fundamentals",
                        lambda targets, failures=None: {})
    from api.services.screener import context_joins as cj
    # context readers stubbed: run_build unit tests predate context joins; real reads trip the shared-data-root guard on the dev box
    monkeypatch.setattr(cj, "read_breadth_flags", lambda targets, failures=None: {})
    monkeypatch.setattr(cj, "read_uct20", lambda targets, failures=None: {})
    monkeypatch.setattr(cj, "read_index_flags", lambda targets, failures=None: {})
    monkeypatch.setattr(cj, "read_etf_flags", lambda targets, failures=None: {})
    stats = b.run_build()
    assert "market_cap" not in stats["empty_columns"]
    assert "rs_rank" not in stats["empty_columns"]
    assert stats["populated"]["rs_return"] == 2
    assert "rs_ranking" not in stats["sources"]
