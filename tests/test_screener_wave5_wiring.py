"""Task A6 — builder wiring: the three Wave 5 readers (pattern_join,
darkpool_agg, opt_flow) into `build_row` and `run_build`, plus the
pattern-distance derivations.

Mirrors `test_screener_wave2_wiring.py`'s shape exactly (same two rails):
  * `build_row` merges `market_row` (now the per-ticker merge of NINE
    readers — six Wave 2 + three Wave 5) and derives
    `pattern_entry_dist_pct`/`pattern_stop_dist_pct` from pattern_join's two
    non-column CARRIER keys (`pattern_entry_px`/`pattern_stop_px`) vs the
    bar-derived `price`, beside the existing `pt_upside_pct` derivation.
  * `run_build` reads each of the three new readers ONCE per build (never
    per ticker), threads `prev_closes` (a single `screener_rows` query) into
    `darkpool_agg.read_darkpool_fields`'s `closes=` kwarg, and the carrier
    keys never reach the persisted row (`screener_rows`'s schema has no
    column for them at all — `snapshot_db.get_row`'s `SELECT *` structurally
    cannot return them, which is the strongest form of "never persisted").
"""
import datetime
import time


def _weekday_ymds(n, end=None):
    """`n` consecutive weekday `YYYYMMDD` ints ending on `end` (default TODAY),
    oldest first.

    ⛔ DERIVED FROM THE CLOCK, NEVER A LITERAL — same reason as the twin in
    `test_screener_wave2_wiring.py`: the pattern distances are now gated on the
    row's price age (accuracy audit 2026-08-23 #4), so a fixture pinned to a
    hardcoded date would go red on its own in a month.
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


# ───────────────────────── build_row: the derivation block ──────────────────

def test_build_row_derives_pattern_dist_pct_entry_above_stop_below():
    """K5 shape: entry ABOVE price -> positive distance; stop BELOW price ->
    negative distance. Bars give price=100.0 (last close)."""
    from api.services.screener import snapshot_builder
    row = snapshot_builder.build_row(
        "T", _bars(), None, None,
        market_row={"pattern_entry_px": 110.0, "pattern_stop_px": 95.0})
    assert row["pattern_entry_dist_pct"] == 10.0   # (110/100 - 1) * 100
    assert row["pattern_stop_dist_pct"] == -5.0    # (95/100 - 1) * 100


def test_pattern_dist_pct_is_withheld_when_the_price_is_stale():
    """🔴 ACCURACY AUDIT 2026-08-23 #4 — the same two-clock defect as
    `pt_upside_pct`, in the family beside it.

    `pattern_join` serves detections from the LAST SEVEN DAYS. Dividing one of
    those levels by a price from a June bar is not a distance to an entry, it
    is arithmetic between two dates — and on the current snapshot 805 of 3,707
    rows carry bars older than 2026-08-01. Not computable ⇒ absent.

    ⭐ THE CONTROL IS THE TEST ABOVE: identical carriers, identical price, a
    FRESH last bar, and both distances publish. The bar date is the only
    difference, so this cannot pass because the derivation was simply deleted.
    """
    from api.services.screener import snapshot_builder
    old = datetime.date.today() - datetime.timedelta(days=120)
    bars = _bars(end=old)
    row = snapshot_builder.build_row(
        "T", bars, None, None,
        market_row={"pattern_entry_px": 110.0, "pattern_stop_px": 95.0,
                    "pattern_engine_conf": 80.0})
    assert row["pattern_entry_dist_pct"] is None
    assert row["pattern_stop_dist_pct"] is None
    # The row, its price, its date and the pattern engine's own (non-derived)
    # columns are all still served — only the cross-clock ratios are withheld.
    assert row["price"] == 100.0
    assert row["bars_asof"] == str(bars[-1]["t"])
    assert row["pattern_engine_conf"] == 80.0


def test_build_row_pattern_dist_pct_null_when_carriers_absent():
    """K5: pattern_join emits neither carrier when the best detection lacks
    levels (or there is no active detection at all) — both dist columns stay
    honest-None, never a fabricated 0.0."""
    from api.services.screener import snapshot_builder
    bars = [{"o": 100.0, "h": 100.5, "l": 99.5, "c": 100.0, "v": 1000}] * 40
    row = snapshot_builder.build_row("T", bars, None, None, market_row={})
    assert row["pattern_entry_dist_pct"] is None
    assert row["pattern_stop_dist_pct"] is None

    row2 = snapshot_builder.build_row("T", bars, None, None, market_row=None)
    assert row2["pattern_entry_dist_pct"] is None
    assert row2["pattern_stop_dist_pct"] is None


def test_build_row_pattern_dist_pct_null_when_price_missing():
    """No usable bars -> no `price` -> both derivations must not fire (the
    same positive-both-factors guard `pt_upside_pct` uses one block above)."""
    from api.services.screener import snapshot_builder
    row = snapshot_builder.build_row(
        "T", [], None, None,
        market_row={"pattern_entry_px": 110.0, "pattern_stop_px": 95.0})
    assert row["pattern_entry_dist_pct"] is None
    assert row["pattern_stop_dist_pct"] is None


def test_build_row_carrier_keys_never_land_in_the_persisted_row():
    """The two carrier keys ride `market_row` but `row = {c: None for c in
    snapshot_db.COLUMNS}` + the `if k in row` merge drops any key that is not
    a real column, by construction — this pins that build_row's returned
    dict never carries them under their own name, even though it read them."""
    from api.services.screener import snapshot_builder, snapshot_db
    bars = [{"o": 100.0, "h": 100.5, "l": 99.5, "c": 100.0, "v": 1000}] * 40
    row = snapshot_builder.build_row(
        "T", bars, None, None,
        market_row={"pattern_entry_px": 110.0, "pattern_stop_px": 95.0})
    assert "pattern_entry_px" not in row
    assert "pattern_stop_px" not in row
    # Not merely absent from this one row — they are not schema columns at
    # all, so no future writer could persist them under this name either.
    assert "pattern_entry_px" not in snapshot_db.COLUMNS
    assert "pattern_stop_px" not in snapshot_db.COLUMNS


def test_build_row_merges_pattern_darkpool_optflow_columns():
    """The full nine-source `market_row` merge (six Wave 2 + three Wave 5) —
    real columns from all three new readers land in the row untouched."""
    from api.services.screener import snapshot_builder
    bars = [{"o": 100.0, "h": 100.5, "l": 99.5, "c": 100.0, "v": 1000}] * 40
    row = snapshot_builder.build_row(
        "T", bars, None, None,
        market_row={
            "pattern_engine_ids": "bull_flag,vcp", "pattern_engine_conf": 80.0,
            "pattern_engine_dir": 1, "pattern_expectancy_r": 0.42,
            "dp_notional_1d": 5_000_000.0, "dp_prints_1d": 3,
            "dp_notional_5d": 12_000_000.0, "dp_level_dist_pct": 2.5,
            "opt_net_premium_1d": 1_000_000.0, "opt_bull_pct_1d": 62.5,
            "opt_net_premium_5d": 4_200_000.0,
        })
    assert row["pattern_engine_ids"] == "bull_flag,vcp"
    assert row["pattern_engine_conf"] == 80.0
    assert row["pattern_engine_dir"] == 1
    assert row["pattern_expectancy_r"] == 0.42
    assert row["dp_notional_1d"] == 5_000_000.0
    assert row["dp_prints_1d"] == 3
    assert row["dp_notional_5d"] == 12_000_000.0
    assert row["dp_level_dist_pct"] == 2.5
    assert row["opt_net_premium_1d"] == 1_000_000.0
    assert row["opt_bull_pct_1d"] == 62.5
    assert row["opt_net_premium_5d"] == 4_200_000.0


# ───────────────────────── run_build: the reader wiring ─────────────────────

def _stub_all_but_wave5(monkeypatch, sb, tickers, bars):
    """Stub the bars store + every pre-existing reader to a cheap `{}`/no-op,
    leaving only the three Wave 5 readers un-stubbed for the caller to wire.
    Mirrors `test_screener_wave2_wiring.py::test_run_build_passes_market_row_
    through`'s setup exactly, extended with the Wave 5 imports."""
    from api.services.screener import (finviz_universe, earnings_dates,
                                       earnings_context, analyst_pass,
                                       insider_capture, context_joins as cj)
    import api.services.bars_sqlite as bs
    monkeypatch.setattr(sb, "_load_universe", lambda: list(tickers))
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
    for mod, fn in ((finviz_universe, "read_finviz_fields"),
                    (earnings_dates, "read_earnings_dates"),
                    (earnings_context, "read_last_report_move"),
                    (earnings_context, "read_implied_context"),
                    (analyst_pass, "read_analyst_fields"),
                    (insider_capture, "read_insider_fields")):
        monkeypatch.setattr(mod, fn, lambda targets, failures=None: {})


def test_run_build_reads_all_three_wave5_readers_once_per_build_not_per_ticker(
        monkeypatch, tmp_path):
    """⚠️ Mirrors the Wave 2 rail's Minor 5 fix: TWO tickers, both actually
    built, so "once per build" and "once per ticker" disagree (1 vs 2) — a
    single-ticker universe cannot tell the difference."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_builder as sb, snapshot_db
    from api.services.screener import pattern_join, darkpool_agg, opt_flow

    bars = [(ymd, 100.0, 100.5, 99.5, 100.0, 1000)
            for ymd in _weekday_ymds(60)]   # real, fresh dates: the
    # pattern distances are gated on the row's price age (audit #4)
    _stub_all_but_wave5(monkeypatch, sb, ["AAA", "BBB"], bars)
    monkeypatch.setattr(sb, "_read_prev_closes", lambda: {"AAA": 105.0})

    calls = {"pattern": 0, "darkpool": 0, "optflow": 0}
    captured_closes = {}

    def pattern_stub(targets, failures=None):
        calls["pattern"] += 1
        return {"AAA": {"pattern_engine_ids": "bull_flag",
                         "pattern_engine_conf": 80.0,
                         "pattern_engine_dir": 1,
                         "pattern_entry_px": 110.0,
                         "pattern_stop_px": 95.0,
                         "pattern_expectancy_r": 0.5}}

    def darkpool_stub(targets, closes=None, failures=None):
        calls["darkpool"] += 1
        captured_closes.update(closes or {})
        return {"AAA": {"dp_notional_1d": 5_000_000.0, "dp_prints_1d": 2,
                         "dp_notional_5d": 12_000_000.0}}

    def optflow_stub(targets, failures=None):
        calls["optflow"] += 1
        return {"AAA": {"opt_net_premium_1d": 1_000_000.0,
                         "opt_bull_pct_1d": 60.0,
                         "opt_net_premium_5d": 3_000_000.0}}

    monkeypatch.setattr(pattern_join, "read_pattern_fields", pattern_stub)
    monkeypatch.setattr(darkpool_agg, "read_darkpool_fields", darkpool_stub)
    monkeypatch.setattr(opt_flow, "read_opt_flow_fields", optflow_stub)

    out = sb.run_build(max_tickers=2)

    assert out["built"] == 2
    assert calls == {"pattern": 1, "darkpool": 1, "optflow": 1}
    # `prev_closes` was threaded through to darkpool_agg's `closes=` kwarg —
    # the exact wrap `_read_market_source` needs (see snapshot_builder.py's
    # documented divergence from the brief's literal `lambda t, f: ...` sketch).
    assert captured_closes == {"AAA": 105.0}

    row = snapshot_db.get_row("AAA")
    assert row["pattern_engine_ids"] == "bull_flag"
    assert row["pattern_engine_conf"] == 80.0
    assert row["pattern_engine_dir"] == 1
    assert row["pattern_expectancy_r"] == 0.5
    assert row["dp_notional_1d"] == 5_000_000.0
    assert row["dp_prints_1d"] == 2
    assert row["dp_notional_5d"] == 12_000_000.0
    assert row["opt_net_premium_1d"] == 1_000_000.0
    assert row["opt_bull_pct_1d"] == 60.0
    assert row["opt_net_premium_5d"] == 3_000_000.0
    # Derived from the carrier keys vs the bar-derived price (100.0).
    assert row["pattern_entry_dist_pct"] == 10.0
    assert row["pattern_stop_dist_pct"] == -5.0
    # Never persisted — the table has no such columns (see get_row's SELECT *).
    assert "pattern_entry_px" not in row
    assert "pattern_stop_px" not in row


def test_a_raising_darkpool_reader_degrades_and_is_reported(monkeypatch, tmp_path):
    """The `_read_market_source` contract (fix round 1, 2026-08-22 review),
    now exercised through the darkpool lambda wrap specifically: a raise
    inside `darkpool_agg.read_darkpool_fields` — reached through the lambda
    that threads `closes=prev_closes` — must degrade to `{}` and be counted
    under the reader's own label, never crash the whole nightly build."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_builder as sb, snapshot_db
    from api.services.screener import pattern_join, darkpool_agg, opt_flow

    bars = [(ymd, 100.0, 100.5, 99.5, 100.0, 1000)
            for ymd in _weekday_ymds(60)]   # real, fresh dates: the
    # pattern distances are gated on the row's price age (audit #4)
    _stub_all_but_wave5(monkeypatch, sb, ["AAA"], bars)
    monkeypatch.setattr(sb, "_read_prev_closes", lambda: {})
    monkeypatch.setattr(pattern_join, "read_pattern_fields",
                        lambda targets, failures=None: {})
    monkeypatch.setattr(opt_flow, "read_opt_flow_fields",
                        lambda targets, failures=None: {})

    def _boom(targets, closes=None, failures=None):
        raise RuntimeError("darkpool store unavailable")
    monkeypatch.setattr(darkpool_agg, "read_darkpool_fields", _boom)

    out = sb.run_build(max_tickers=1)

    assert out["built"] == 1                       # the build survived
    assert snapshot_db.get_row("AAA") is not None   # the row still landed
    assert out["sources"]["darkpool_agg"] == {"RuntimeError": 1}


def test_a_raising_pattern_join_reader_degrades_and_is_reported(monkeypatch, tmp_path):
    """Same contract, the plain (non-lambda) reader this time — pattern_join
    is passed straight to `_read_market_source` with no wrap."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_builder as sb, snapshot_db
    from api.services.screener import pattern_join, darkpool_agg, opt_flow

    bars = [(ymd, 100.0, 100.5, 99.5, 100.0, 1000)
            for ymd in _weekday_ymds(60)]   # real, fresh dates: the
    # pattern distances are gated on the row's price age (audit #4)
    _stub_all_but_wave5(monkeypatch, sb, ["AAA"], bars)
    monkeypatch.setattr(sb, "_read_prev_closes", lambda: {})
    monkeypatch.setattr(darkpool_agg, "read_darkpool_fields",
                        lambda targets, closes=None, failures=None: {})
    monkeypatch.setattr(opt_flow, "read_opt_flow_fields",
                        lambda targets, failures=None: {})

    def _boom(targets, failures=None):
        raise RuntimeError("patterns.db unavailable")
    monkeypatch.setattr(pattern_join, "read_pattern_fields", _boom)

    out = sb.run_build(max_tickers=1)

    assert out["built"] == 1
    assert snapshot_db.get_row("AAA") is not None
    assert out["sources"]["pattern_join"] == {"RuntimeError": 1}


def test_prev_closes_is_one_query_never_per_ticker(monkeypatch, tmp_path):
    """K4-shaped rail: `_read_prev_closes` must be called exactly once per
    build, matching `_read_rs_map`/`_read_spy_closes`'s existing precedent —
    a per-ticker call would be the same defect class darkpool_agg's own
    module docstring (K4-adjacent) exists to forbid."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_builder as sb, snapshot_db
    from api.services.screener import pattern_join, darkpool_agg, opt_flow

    bars = [(ymd, 100.0, 100.5, 99.5, 100.0, 1000)
            for ymd in _weekday_ymds(60)]   # real, fresh dates: the
    # pattern distances are gated on the row's price age (audit #4)
    _stub_all_but_wave5(monkeypatch, sb, ["AAA", "BBB"], bars)
    monkeypatch.setattr(pattern_join, "read_pattern_fields",
                        lambda targets, failures=None: {})
    monkeypatch.setattr(opt_flow, "read_opt_flow_fields",
                        lambda targets, failures=None: {})
    monkeypatch.setattr(darkpool_agg, "read_darkpool_fields",
                        lambda targets, closes=None, failures=None: {})

    calls = {"n": 0}
    real_prev_closes = sb._read_prev_closes

    def counting_prev_closes():
        calls["n"] += 1
        return real_prev_closes()

    monkeypatch.setattr(sb, "_read_prev_closes", counting_prev_closes)

    out = sb.run_build(max_tickers=2)
    assert out["built"] == 2
    assert calls["n"] == 1


def test_read_prev_closes_reads_screener_rows_price_column(monkeypatch, tmp_path):
    """Unit-level pin on `_read_prev_closes` itself: reads `{ticker: price}`
    off already-persisted rows, skipping NULL prices, never raising on an
    empty/cold table."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_builder as sb, snapshot_db

    # Cold table: init_db() has never run for this path -> connect() still
    # works (SQLite creates the file), but the table doesn't exist yet.
    assert sb._read_prev_closes() == {}

    snapshot_db.init_db()
    snapshot_db.upsert_rows([
        {**{c: None for c in snapshot_db.COLUMNS}, "ticker": "AAA", "price": 105.0},
        {**{c: None for c in snapshot_db.COLUMNS}, "ticker": "BBB", "price": None},
    ])
    out = sb._read_prev_closes()
    assert out == {"AAA": 105.0}   # BBB's NULL price is skipped, not a 0.0
