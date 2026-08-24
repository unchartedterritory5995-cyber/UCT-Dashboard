"""Task 10 — builder wiring: the six Wave 2 source readers into `build_row`
and `run_build`, plus the `pt_upside_pct` derivation.

Two rails:
  * `build_row` merges `market_row` (the per-ticker merge of the six Wave 2
    readers) between `ratings_row` and `context_row`, and derives
    `pt_upside_pct` from `pt_target` (market_row) vs `price` (bars).
  * `run_build` reads each of the six readers ONCE per build (never per
    ticker) and threads the per-ticker merge through as `market_row=`.

Fix round 1 (2026-08-22 review) adds three more:
  * a raising reader degrades to `{}` and is reported, never crashes the
    whole nightly build (Critical 1);
  * a valid-JSON-but-not-object finviz artifact degrades cleanly (Important 2);
  * `pt_target=0.0` (analyst_pass's own not-computable sentinel) stays
    honest-None rather than computing a confident `-100.0` (Important 3).

Fix round 2 (accuracy audit 2026-08-23, #4) adds the clock to that last one:
`pt_upside_pct` divides last night's analyst target by the row's `price`, so
the two factors must share a clock as well as both be positive. The fixtures
below therefore carry REAL, FRESH bar dates — see `_weekday_ymds`.
"""
import datetime


def _weekday_ymds(n, end=None):
    """`n` consecutive weekday `YYYYMMDD` ints ending on `end` (default TODAY),
    oldest first.

    ⛔ DERIVED FROM THE CLOCK, NEVER A LITERAL. `build_row` now ages a row's
    price against today (`snapshot_builder.price_is_stale`), so a fixture
    pinned to a hardcoded date would pass this week and go red on its own in a
    month — the `_weekday_only_test_time_bombs` shape. Anchoring the newest bar
    to today keeps the age at 0 forever; the staleness rails below pass an
    explicit `end` in the past because staleness is what they are testing.
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


def test_build_row_merges_market_row_and_derives_pt_upside():
    from api.services.screener import snapshot_builder
    row = snapshot_builder.build_row(
        "T", _bars(), None, None,
        market_row={"short_float_pct": 22.4, "pt_target": 125.0,
                    "next_earnings_date": "2026-09-03"})
    assert row["short_float_pct"] == 22.4
    assert row["pt_upside_pct"] == 25.0          # 125 vs price 100
    assert row["days_to_earnings"] is not None   # T4's derivation fires


def test_pt_upside_pct_is_withheld_when_the_price_is_stale():
    """🔴 ACCURACY AUDIT 2026-08-23 #4 — two clocks in one row.

    `pt_target` is last night's analyst consensus. `price` can be a bar from
    June: measured on `C:\\data\\screener.db`, 805 of 3,707 rows sit on bars
    older than 2026-08-01, RDDT publishes $174.96 off a 2026-06-18 bar. A ratio
    between those two dates describes no session that ever happened, and it is
    invisible — it sorts, it filters, and it renders identically to the fresh
    row beside it. Not computable ⇒ absent.

    ⭐ THE CONTROL IS THE TEST ABOVE, and it is why this one cannot pass for
    the wrong reason: identical inputs but a FRESH last bar publish 25.0. The
    only difference between them is the bar date.
    """
    from api.services.screener import snapshot_builder
    old = datetime.date.today() - datetime.timedelta(days=120)
    bars = _bars(end=old)
    row = snapshot_builder.build_row(
        "T", bars, None, None,
        market_row={"short_float_pct": 22.4, "pt_target": 125.0})
    assert row["pt_upside_pct"] is None
    # ...and the row is still SERVED, with its price and its date intact. The
    # withheld thing is the cross-clock ratio, never the row and never the
    # bar-derived family, which is internally consistent at `bars_asof`.
    # ⛔ The expected as-of is READ OFF THE FIXTURE, not restated from `old` —
    # `_weekday_ymds` skips weekends, so a hand-typed date disagrees with the
    # bars whenever `old` lands on one.
    assert row["price"] == 100.0
    assert row["bars_asof"] == str(bars[-1]["t"])
    assert row["short_float_pct"] == 22.4


def test_a_row_that_cannot_date_its_price_withholds_the_cross_clock_ratio():
    """Bars with no `t` at all ⇒ `bars_asof` is NULL ⇒ the age is unknown.

    Unknown reads as STALE, deliberately: a row that will not say what day its
    price is from cannot be shown to be fresh, and the failure direction of
    guessing wrong is a published percentage between two different dates.
    """
    from api.services.screener import snapshot_builder
    bars = [{"o": 100.0, "h": 100.5, "l": 99.5, "c": 100.0, "v": 1000}
            for _ in range(40)]
    row = snapshot_builder.build_row("T", bars, None, None,
                                     market_row={"pt_target": 125.0})
    assert row["bars_asof"] is None
    assert row["pt_upside_pct"] is None


def test_run_build_passes_market_row_through(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_builder as sb, snapshot_db
    from api.services.screener import (finviz_universe, earnings_dates,
                                       earnings_context, analyst_pass,
                                       insider_capture, context_joins as cj)
    # ⭐ REAL, FRESH bar dates (see `_weekday_ymds`): `pt_upside_pct` is now
    # gated on the row's price age, so a synthetic `20250101+i` — which is not
    # even a valid calendar date past January — would read as STALE and the
    # assertion below would be measuring the gate, not the wiring.
    bars = [(ymd, 100.0, 100.5, 99.5, 100.0, 1000)
            for ymd in _weekday_ymds(60)]
    # ⚠️ FIX ROUND 1 (2026-08-22 review, Minor 5): TWO tickers, both actually
    # built (max_tickers=2). With a single-ticker universe, `calls["finviz"]
    # == 1` cannot distinguish "once per build" from "once per ticker" — the
    # two collapse to the same number. A second ticker makes them disagree:
    # once-per-ticker would read 2, and only the once-per-build wiring stays
    # at 1.
    monkeypatch.setattr(sb, "_load_universe", lambda: ["AAA", "BBB"])
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

    out = sb.run_build(max_tickers=2)
    assert out["built"] == 2
    row = snapshot_db.get_row("AAA")
    assert row["short_float_pct"] == 31.2
    assert row["pt_target"] == 130.0
    assert row["pt_upside_pct"] == 30.0        # derived vs price 100
    assert calls == {"finviz": 1, "analyst": 1}  # one read per build, each


# ───────────────────────── fix round 1 (2026-08-22 review) ──────────────────

def test_a_raising_reader_degrades_to_empty_and_is_reported(monkeypatch, tmp_path):
    """🔴 CRITICAL FIX. `insider_capture.read_insider_fields` calls `_init_db()`
    BEFORE its own try/except, so a dead store used to escape the reader
    entirely and crash `run_build` — zero rows built, not just
    `insider_cluster_days` NULL. Reproduced exactly as the reviewer did:
    monkeypatch `insider_capture._connect` to raise. `run_build`'s
    `_read_market_source` wrapper must catch this AT THE CONSUMER SEAM: the
    build still completes and the failure is named in the census.
    """
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.setenv("SCREENER_INSIDER_DB_PATH", str(tmp_path / "insider.db"))
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
    monkeypatch.setattr(finviz_universe, "read_finviz_fields",
                        lambda targets, failures=None: {})
    monkeypatch.setattr(earnings_dates, "read_earnings_dates",
                        lambda targets, failures=None: {})
    monkeypatch.setattr(earnings_context, "read_last_report_move",
                        lambda targets, failures=None: {})
    monkeypatch.setattr(earnings_context, "read_implied_context",
                        lambda targets, failures=None: {})
    monkeypatch.setattr(analyst_pass, "read_analyst_fields",
                        lambda targets, failures=None: {})

    def _boom():
        raise RuntimeError("insider store unavailable")
    monkeypatch.setattr(insider_capture, "_connect", _boom)

    out = sb.run_build(max_tickers=1)
    assert out["built"] == 1                       # the build survived
    assert snapshot_db.get_row("AAA") is not None   # the row still landed
    assert out["sources"]["insider_capture"] == {"RuntimeError": 1}


def test_finviz_artifact_containing_json_null_degrades_without_raising(
        monkeypatch, tmp_path):
    """⚠️ IMPORTANT FIX. Valid JSON that is not an object (`null`) used to
    reach `payload.get("rows")` unguarded and raise `AttributeError` —
    mirrors the `isinstance(blob, dict)` guard `earnings_dates
    .read_earnings_dates` already carries for this exact shape.
    """
    from api.services.screener import finviz_universe
    path = tmp_path / "finviz_null.json"
    path.write_text("null", encoding="utf-8")
    monkeypatch.setenv("SCREENER_FINVIZ_ARTIFACT", str(path))
    failures = {}
    out = finviz_universe.read_finviz_fields(["AAA"], failures=failures)
    assert out == {}
    assert failures["finviz_universe"] == {"missing": 1}


def test_pt_upside_pct_is_none_when_pt_target_is_zero():
    """⚠️ IMPORTANT FIX. `pt_target=0.0` is `analyst_pass`'s own
    not-computable sentinel (its price-target leg returns `None`, never a
    confident zero — see `_fetch_pt_target`), not a real target implying a
    100% decline. `pt_upside_pct` must stay honest-None here, not compute a
    confident `-100.0`.
    """
    from api.services.screener import snapshot_builder
    bars = [{"o": 100.0, "h": 100.5, "l": 99.5, "c": 100.0, "v": 1000}] * 40
    row = snapshot_builder.build_row(
        "T", bars, None, None, market_row={"pt_target": 0.0})
    assert row["pt_upside_pct"] is None
