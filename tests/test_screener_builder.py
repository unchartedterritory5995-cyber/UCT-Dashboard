import importlib
import logging


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
    # ⚰️ 2026-08-30: was `row["patterns"]`, the retired six-detector
    # heuristic. The structure group replaces it, and its SHAPE is a total
    # partition — every row with enough history gets exactly one, so this
    # asserts a stronger property than the old column could.
    assert row["base_shape"]
    assert row["base_matches"].startswith(",")
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


# ───────────────────── FIX 3 (2026-08-22 receipts-fix): _read_rs_map ────────
#
# 🔴 THE DEFECT. The 2026-08-22 03:04 ET build logged `rs_map=0`,
# `sources["rs_ranking"] == {"no_rank": 3741}` — rs_rank/rs_return/
# chg_pct_3m/chg_pct_6m NULL universe-wide. Proven mechanism: `rs_ranking`'s
# warmed cache lives under ONE key in the shared bounded LRU and was evicted
# by the overnight job flood between the 06:41Z warm and the 07:00Z build.
# `_read_rs_map` (and ONLY this nightly-build reader) now computes once on a
# cold cache rather than accepting `{}` — `cached_rank_map` itself keeps its
# no-compute contract for request-path callers.

def test_read_rs_map_warm_cache_never_computes(monkeypatch, caplog):
    from api.services import rs_ranking
    from api.services.screener import snapshot_builder as b

    warm_map = {"AAA": {"ticker": "AAA", "rs_rank": 90, "rs_score": 12.5}}
    monkeypatch.setattr(rs_ranking, "cached_rank_map", lambda: warm_map)

    calls = {"compute": 0}

    def _boom_if_called(force=False):
        calls["compute"] += 1
        raise AssertionError("compute_rs_scores must not be called on a warm cache")

    monkeypatch.setattr(rs_ranking, "compute_rs_scores", _boom_if_called)

    with caplog.at_level(logging.INFO, logger=b.log.name):
        out = b._read_rs_map()

    assert out == warm_map
    assert calls["compute"] == 0
    assert any("source=cache-warm" in r.getMessage() for r in caplog.records)


def test_read_rs_map_computes_on_cold_and_succeeds(monkeypatch, caplog):
    from api.services import rs_ranking
    from api.services.screener import snapshot_builder as b

    populated = {"AAA": {"ticker": "AAA", "rs_rank": 77, "rs_score": 5.0}}
    state = {"computed": False}

    def _cached_rank_map():
        return populated if state["computed"] else {}

    def _compute_rs_scores(force=False):
        assert force is False
        state["computed"] = True
        return list(populated.values())

    monkeypatch.setattr(rs_ranking, "cached_rank_map", _cached_rank_map)
    monkeypatch.setattr(rs_ranking, "compute_rs_scores", _compute_rs_scores)

    with caplog.at_level(logging.INFO, logger=b.log.name):
        out = b._read_rs_map()

    assert out == populated
    assert any("source=computed-on-cold" in r.getMessage() for r in caplog.records)


def test_read_rs_map_cold_compute_raises_degrades_to_empty_no_raise(monkeypatch, caplog):
    from api.services import rs_ranking
    from api.services.screener import snapshot_builder as b

    monkeypatch.setattr(rs_ranking, "cached_rank_map", lambda: {})

    def _boom(force=False):
        raise RuntimeError("no universe available")

    monkeypatch.setattr(rs_ranking, "compute_rs_scores", _boom)

    with caplog.at_level(logging.WARNING, logger=b.log.name):
        out = b._read_rs_map()  # must not raise

    assert out == {}
    warnings = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings, "a failed compute-on-cold logged nothing"


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


# ══════════════════════════════════════════════════════════════════════════
# FIX ROUND 2 — accuracy audit 2026-08-23, defect #4: FRESHNESS
#
# Two columns in one row disagreed about what day it is. Measured on
# `C:\data\screener.db`, `snapshot_date='2026-08-23'`:
#   * 805 of 3,707 rows (21.7%) carry bars older than 2026-08-01;
#   * ages behind 2026-08-23 — 2,749 at 0 sessions, 137 at 1, 5 at 2-9,
#     11 at 10-20, 812 at 21+ (a healthy row, then a cliff);
#   * ACA/APGE/CRNX/NUVL are absent from `cap_universe.json` and still serve
#     rows stamped 2026-07-10 — CRNX at price 35.87 against an 8/21 close of
#     84.69 (+136%);
#   * HCICU raises `ZeroDivisionError` out of `setup_score.compute` every
#     night, so its whole row is discarded and the served one is 30 sessions
#     stale.
# ══════════════════════════════════════════════════════════════════════════

import datetime


def _weekday_ymds(n, end=None):
    """`n` consecutive weekday `YYYYMMDD` ints ending on `end` (default TODAY).

    ⛔ DERIVED FROM THE CLOCK. Staleness is measured against today, so a
    fixture pinned to a literal date passes this week and goes red on its own
    next month — `_weekday_only_test_time_bombs`.
    """
    out, d = [], (end or datetime.date.today())
    while len(out) < n:
        if d.weekday() < 5:
            out.append(int(d.strftime("%Y%m%d")))
        d -= datetime.timedelta(days=1)
    return list(reversed(out))


def _bars(n=40, end=None, close=100.0):
    return [{"t": ymd, "o": close, "h": close + 0.5, "l": close - 0.5,
             "c": close, "v": 1000} for ymd in _weekday_ymds(n, end)]


# ───────────────────── the age measurement + the policy ─────────────────────

def test_price_age_is_borrowed_from_the_live_tier_never_recomputed(monkeypatch):
    """⛔ ONE AUTHORITY FOR "HOW OLD IS THIS ANCHOR".

    `live_tier.anchor_age_sessions` already counts weekday sessions in
    `(bars_asof, ymd]` and is what the live overlay's own staleness gate reads.
    This asserts the builder CALLS it rather than carrying a private copy — a
    second implementation would be the exact defect this whole audit found
    everywhere else. The stub returns a value no real calendar produces, so a
    private copy could not accidentally agree with it.
    """
    from api.services.screener import snapshot_builder as b, live_tier
    seen = {}

    def _fake(bars_asof, ymd):
        seen["args"] = (bars_asof, ymd)
        return 999

    monkeypatch.setattr(live_tier, "anchor_age_sessions", _fake)
    assert b.price_age_sessions("20260618", today_ymd=20260823) == 999
    assert seen["args"] == ("20260618", 20260823)


def test_price_is_stale_reads_the_real_calendar_at_the_shipped_threshold():
    """The measurement, unstubbed, on the audit's own dates."""
    from api.services.screener import snapshot_builder as b
    # RDDT's row: a 2026-06-18 bar served on 2026-08-23 — 46 weekdays in
    # (6/18, 8/23], counted independently, not copied out of the function.
    assert b.price_age_sessions("20260618", today_ymd=20260823) == 46
    assert b.price_is_stale("20260618", today_ymd=20260823) is True
    # Friday's close served on Sunday's build is the HEALTHY case and must not
    # trip the gate — 0 sessions, the shape 2,749 of 3,707 rows are in.
    assert b.price_age_sessions("20260821", today_ymd=20260823) == 0
    assert b.price_is_stale("20260821", today_ymd=20260823) is False
    # A row that will not say what day its price is from cannot be shown to be
    # fresh, so unknown reads as STALE — the direction that withholds.
    assert b.price_is_stale(None, today_ymd=20260823) is True
    assert b.price_is_stale("not-a-date", today_ymd=20260823) is True


def test_the_staleness_threshold_is_this_module_s_own_knob(monkeypatch):
    """⛔ NOT `live_tier.max_anchor_age_sessions()`. That answers "may we hang a
    live tick on this level"; this answers "may we divide last night's analyst
    target by this price". Moving one must not move the other.
    """
    from api.services.screener import snapshot_builder as b, live_tier
    assert b.stale_price_sessions() == 10
    monkeypatch.setenv("SCREENER_STALE_PRICE_SESSIONS", "2")
    assert b.stale_price_sessions() == 2
    # ...and the live tier's own gate is untouched by that env var.
    assert live_tier.max_anchor_age_sessions() == 5
    # A junk value falls back to the documented default rather than raising
    # inside a nightly build.
    monkeypatch.setenv("SCREENER_STALE_PRICE_SESSIONS", "soon")
    assert b.stale_price_sessions() == 10


# ─────────────── a raising bar consumer costs its columns, not the row ───────

def test_a_raising_bar_consumer_costs_its_columns_never_the_row(monkeypatch):
    """🔴 THE HCICU DEFECT. `setup_score.compute` divides by the mean volume of
    the window's down days and raises `ZeroDivisionError` when every one of
    them is zero-volume. `build_row` did not wrap it, so the exception escaped
    to `run_build`'s per-ticker `except`, the row was DISCARDED, and the
    previously-upserted row was never touched — which is not an absence, it is
    last month's row staying live. Reproduced from `bars.db`: HCICU's served
    row is `snapshot_date=2026-08-10, bars_asof=20260709` while bars.db holds
    it through 20260820.
    """
    from api.services.screener import snapshot_builder as b, setup_score

    def _boom(bars, pole_pct=None):
        raise ZeroDivisionError("division by zero")

    monkeypatch.setattr(setup_score, "compute", _boom)
    bars = _bars()
    failures = {}
    row = b.build_row("HCICU", bars, None, None, failures=failures)

    # The row exists, is re-dated, and every OTHER consumer's columns landed.
    assert row["ticker"] == "HCICU"
    assert row["bars_asof"] == str(bars[-1]["t"])
    assert row["price"] == 100.0
    assert row["candle_type"] is not None
    # The failed consumer's columns are honestly NULL...
    assert row["candle_score"] is None
    assert row["ema_touch_count"] is None
    # ...and the reason is COUNTED BY NAME in the same census every reader in
    # this file reports into, never swallowed.
    assert failures["bars_setup_score"] == {"ZeroDivisionError": 1}


def test_the_control_the_same_row_with_setup_score_working():
    """The control for the rail above. Without it, a `build_row` that had
    simply stopped calling `setup_score` would pass forever."""
    from api.services.screener import snapshot_builder as b
    failures = {}
    row = b.build_row("HCICU", _bars(), None, None, failures=failures)
    assert row["candle_score"] is not None
    assert row["ema_touch_count"] is not None
    assert "bars_setup_score" not in failures


def test_a_raising_consumer_still_advances_the_rows_date(monkeypatch):
    """`bars_asof` is stamped OUTSIDE every guard. Even with EVERY bar consumer
    dead, the row still says which session its bars came from — a row that
    cannot date itself is the one shape no downstream label can rescue."""
    from api.services.screener import (snapshot_builder as b, technicals,
                                       candles, setup_score, bases)

    def _boom(*a, **k):
        raise RuntimeError("dead")

    for mod, fn in ((technicals, "compute_technicals"),
                    (technicals, "ath_fields"), (candles, "single_candle"),
                    (candles, "multi_candle"), (setup_score, "compute"),
                    (bases, "classify")):
        monkeypatch.setattr(mod, fn, _boom)
    bars = _bars()
    failures = {}
    row = b.build_row("AAA", bars, None, None, failures=failures)
    assert row["bars_asof"] == str(bars[-1]["t"])
    assert row["price"] is None            # honest-None, never a fabricated 0
    # ⛔ A SUBSET, NOT A COUNT. This asserted `len(failures) == 6` — a hand-typed
    # number beside the list it describes, which is this repo's most repeated
    # defect (the writer-index FOUR, the COT router's "4 routes", the setup
    # catalog's "24"). Two more bar consumers landed and it went stale the same
    # day, while the property actually under test — every failure is NAMED, never
    # rolled into one anonymous bucket — had not changed at all.
    named = {"bars_technicals", "bars_ath_fields", "bars_single_candle",
             "bars_multi_candle", "bars_setup_score", "bars_structure"}
    assert named <= set(failures), sorted(named - set(failures))
    # each entry is keyed by its own label and counts the exception BY TYPE
    for label, kinds in failures.items():
        assert label and isinstance(kinds, dict) and kinds, label
        assert all(isinstance(k, str) and v >= 1 for k, v in kinds.items()), label


# ───────────── the target set includes the rows we already serve ─────────────

def test_stalest_queues_a_row_the_universe_no_longer_lists(tmp_path, monkeypatch):
    """🔴 CRNX +136%. `_stalest` iterated `cap_universe.json` alone, so a ticker
    dropped from the universe kept its row FOREVER — still selected by every
    scan, still sorting, still filtering, never revisited. Four such rows are
    live on this box (ACA, APGE, CRNX, NUVL, all stamped 2026-07-10).
    """
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    import api.services.screener.snapshot_db as sdb
    import api.services.screener.snapshot_builder as b
    importlib.reload(sdb)
    importlib.reload(b)
    sdb.init_db()
    sdb.upsert_rows([{"ticker": "CRNX", "price": 35.87, "built_at": 1},
                     {"ticker": "AAA", "price": 10.0, "built_at": 99}])

    out = b._stalest(["AAA", "BBB"], 10)
    assert "CRNX" in out, "a row we already serve is a rebuild target"
    # ...and it is ordered ahead of the fresher built row, because it is the
    # stalest thing in the table.
    assert out.index("CRNX") < out.index("AAA")
    # Never-built symbols still come first overall.
    assert out[0] == "BBB"


def test_stalest_does_not_turn_a_missing_universe_into_a_whole_rebuild(tmp_path, monkeypatch):
    """The control. `_load_universe` returns `[]` when the file is missing or
    unreadable, and "no universe" must keep meaning "build nothing" — the union
    turning that into "rebuild every row we hold" would make a missing config
    file silently launch a whole-universe run."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s2.db"))
    import api.services.screener.snapshot_db as sdb
    import api.services.screener.snapshot_builder as b
    importlib.reload(sdb)
    importlib.reload(b)
    sdb.init_db()
    sdb.upsert_rows([{"ticker": "CRNX", "price": 35.87, "built_at": 1}])
    assert b._stalest([], 10) == []


# ───────────── market_cap keeps ONE meaning on a stale row ─────────────

def _stub_run_build_readers(monkeypatch, b, tickers, bars, got):
    """Stub every reader `run_build` calls, recording the price that reaches
    `_read_fundamentals` (the argument `massive.get_market_cap` uses for its
    shares x price fallback)."""
    from api.services.screener import (context_joins as cj, finviz_universe,
                                       earnings_dates, earnings_context,
                                       analyst_pass, insider_capture,
                                       pattern_join, darkpool_agg, opt_flow)
    import api.services.bars_sqlite as bs
    tuples = [(x["t"], x["o"], x["h"], x["l"], x["c"], x["v"]) for x in bars]
    monkeypatch.setattr(b, "_load_universe", lambda: list(tickers))
    monkeypatch.setattr(bs, "get_bars", lambda t, tf, n: tuples)
    monkeypatch.setattr(b, "_read_rs_map", lambda: {})
    monkeypatch.setattr(b, "_read_bulk_fundamentals",
                        lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_spy_closes", lambda: [])

    def _funda(t, price=None, failures=None):
        got["price"] = price
        return {}

    monkeypatch.setattr(b, "_read_fundamentals", _funda)
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags",
               "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    for mod, fn in ((finviz_universe, "read_finviz_fields"),
                    (earnings_dates, "read_earnings_dates"),
                    (earnings_context, "read_last_report_move"),
                    (earnings_context, "read_implied_context"),
                    (analyst_pass, "read_analyst_fields"),
                    (insider_capture, "read_insider_fields"),
                    (pattern_join, "read_pattern_fields"),
                    (darkpool_agg, "read_darkpool_fields"),
                    (opt_flow, "read_opt_flow_fields")):
        monkeypatch.setattr(mod, fn, lambda targets, failures=None, **kw: {})


def test_the_market_cap_price_is_the_row_s_own_price(tmp_path, monkeypatch):
    """`anchor_asof` must agree with what `build_row` stamps, or the two would
    be two answers to "what day is this row's price from". This pins that the
    price handed to `massive.get_market_cap` on a FRESH row is the row's own
    `price`, and that the row's `bars_asof` is the one `anchor_asof` predicted.
    """
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s3.db"))
    import api.services.screener.snapshot_db as sdb
    import api.services.screener.snapshot_builder as b
    importlib.reload(sdb)
    importlib.reload(b)
    bars = _bars(60)
    got = {}

    _stub_run_build_readers(monkeypatch, b, ["AAA"], bars, got)
    b.run_build(max_tickers=1)
    row = sdb.get_row("AAA")
    assert b.anchor_asof(bars) == row["bars_asof"]
    assert got["price"] == row["price"] == 100.0


def test_market_cap_is_handed_no_price_when_the_row_is_stale(tmp_path, monkeypatch):
    """🔴 ONE NAME, ONE MEANING. `massive.get_market_cap` prefers the provider's
    CURRENT `market_cap` field and falls back to `shares x the price WE hand
    it`. On a stale row those two paths publish different quantities under one
    column name — one dated today, one dated a June bar — and nothing on the
    row tells them apart. Handing it no price collapses that to a single
    meaning: the provider's current figure, or honestly absent.

    ⭐ THE CONTROL IS THE TEST ABOVE: identical wiring, a FRESH last bar, and
    the price IS handed over. The bar date is the only difference.
    """
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s4.db"))
    import api.services.screener.snapshot_db as sdb
    import api.services.screener.snapshot_builder as b
    importlib.reload(sdb)
    importlib.reload(b)
    old = datetime.date.today() - datetime.timedelta(days=120)
    bars = _bars(60, end=old)
    got = {}

    _stub_run_build_readers(monkeypatch, b, ["AAA"], bars, got)
    b.run_build(max_tickers=1)
    row = sdb.get_row("AAA")
    assert got["price"] is None
    # The row itself is untouched: price and date still published.
    assert row["price"] == 100.0
    assert row["bars_asof"] == str(bars[-1]["t"])


# ── the conjunction starters ────────────────────────────────────────────────
def test_every_starter_screen_is_executable():
    """⛔ A STARTER THAT REFERENCES A DEAD KEY IS A BROKEN PROMISE a member finds
    before we do. Every filter key must exist, every operator must be legal for
    that key's type, and every view must be real."""
    from api.services.screener import saved_screens, filters
    starters = saved_screens.starters()
    assert starters
    ids = [s["id"] for s in starters]
    assert len(ids) == len(set(ids)), "duplicate starter id"
    for s in starters:
        spec = s["spec"]
        assert s["name"] and spec["view"] in filters.VIEWS, s["id"]
        for f in spec["filters"]:
            key = f["key"]
            assert key in filters.FILTERS, (s["id"], key)
            assert filters.is_valid_op(key, f["op"]), (s["id"], key, f["op"])
        sort_key = (spec.get("sort") or {}).get("key")
        if sort_key:
            assert sort_key in filters.FILTERS or sort_key in ("market_cap",), \
                (s["id"], sort_key)


def test_a_candle_type_starter_queries_the_match_set_not_the_rendered_head():
    """⛔ Candle Type filters `candle_matches`, which is DELIMITER-WRAPPED so
    `contains` is an exact-token test. A starter carrying a bare key would match
    `inverted-hammer` when it meant `hammer` — or nothing at all."""
    from api.services.screener import saved_screens, candle_catalog
    for s in saved_screens.candle_starters():
        for f in s["spec"]["filters"]:
            if f["key"] == "candle_type":
                assert f["op"] == "contains", s["id"]
                assert f["value"].startswith(candle_catalog.MATCH_SEP), s["id"]
                assert f["value"].endswith(candle_catalog.MATCH_SEP), s["id"]
                inner = f["value"].strip(candle_catalog.MATCH_SEP)
                assert inner in candle_catalog.BY_KEY, (s["id"], inner)


def test_starters_only_name_values_the_classifiers_can_actually_emit():
    """⛔ A starter pinned to a label nothing produces returns nothing FOREVER,
    and is indistinguishable from a quiet market. Every enum value is checked
    against the registry that emits it."""
    from api.services.screener import saved_screens, candle_catalog, bar_character
    ok = {
        "bar_character": set(bar_character.BY_KEY),
        "candle_weekly": set(candle_catalog.BY_KEY),
        "candle_monthly": set(candle_catalog.BY_KEY),
        "candle_recent": set(candle_catalog.RELATION_KEYS),
        "candle_trend": {"up", "down", "neutral", "unknown"},
        "candle_recent_status": {"provisional", "opened-with", "opened-against",
                                 "opened-flat"},
    }
    for s in saved_screens.starters():
        for f in s["spec"]["filters"]:
            allowed = ok.get(f["key"])
            if allowed and f["op"] == "eq":
                assert f["value"] in allowed, (s["id"], f["key"], f["value"])
