"""Regression rails for the RS Phase 2a review, unit U3 (screener build + rating
store), 2026-11-07. One section per finding:

  #5   the `bars_rs` build step is dark unless RS_V2_ENABLED, and its time is in
       the receipt
  #4   the rating's split guard judges against the DECLARED split list
       (`bars_sanitize.unadjusted_splits`) and reads only the scored closes;
       since owner decision N4 (2026-11-07) there is no threshold fallback: an
       unknown list is rated and counted
  #15  SPY / RSP get the same settle and catch-up as every ticker before the RS
       columns read them
  #20  a rating session too many trading sessions behind is withheld, not served
  #30  `read_fields` reads one symbol's rows by primary key, not whole sessions
  #31  `status()` / `last_run()` create nothing and decode no full table

Everything runs against a `screener.db` in `tmp_path`, synthetic bars and stubbed
readers: no network, no bars.db, no real data root.
"""
from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import date, timedelta

import pytest

import api.services.screener.snapshot_builder as b
from api.services.screener import rs_columns
from api.services.screener import rs_history as rh
from api.services.screener import snapshot_db
from api.services.signature import registry_defs

SEVEN = ("rs_rating_ibd", "rs_rating_chg_5", "rs_rating_chg_20",
         "rs_rating_1m", "rs_rating_3m", "rs_rating_6m", "rs_rating_12m")


# ───────────────────────────── fixtures ─────────────────────────────────────

@pytest.fixture(autouse=True)
def _no_provider(monkeypatch):
    """No test here may reach the corporate-action provider: the default split-list
    reader's fetch refuses, and its brake is a local no-op (no shared state)."""
    from api.services import declared_splits as ds

    def refuse(ticker):
        raise RuntimeError("no provider in tests")
    monkeypatch.setattr(ds, "_default_fetch", refuse)
    monkeypatch.setattr(ds, "_default_gate", lambda: (lambda: True, lambda: 0.0, lambda: None))
    monkeypatch.setattr(ds, "FETCH_PAUSE_S", 0)


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    assert snapshot_db.get_db_path() == str(path)
    return path


def _weekdays_ending(end: date, n: int) -> list:
    out, d = [], end
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d -= timedelta(days=1)
    return sorted(out)


def _ymd(d: date) -> int:
    return int(d.strftime("%Y%m%d"))


def _bar_dicts(closes, end: date) -> list:
    days = _weekdays_ending(end, len(closes))
    return [{"t": _ymd(d), "o": c, "h": c * 1.01, "l": c * 0.99, "c": c, "v": 1000.0}
            for d, c in zip(days, closes)]


def make_reader(series: dict, end: date):
    rows_by_ticker = {}
    for t, closes in series.items():
        days = _weekdays_ending(end, len(closes))
        rows_by_ticker[t.upper()] = [(_ymd(d), c, c, c, c, 1000) for d, c in zip(days, closes)]

    def reader(ticker, n, to_key):
        rows = [r for r in rows_by_ticker.get(ticker.upper(), []) if r[0] <= int(to_key)]
        return rows[-int(n):]
    return reader


def _riser(n=270, daily=0.003, gap_at=None, gap=0.65):
    out, c = [], 100.0
    for i in range(n):
        c *= (1.0 + daily)
        if gap_at is not None and i == gap_at:
            c *= (1.0 + gap)
        out.append(c)
    return out


def _stub_build(monkeypatch, series: dict, settled_frames=None, settled=None):
    """Every reader `run_build` calls stubbed; `series` maps a symbol to its bar
    dicts (benchmarks included); `settled_frames` maps a date to grouped rows."""
    from api.services.screener import (context_joins as cj, finviz_universe,
                                       earnings_dates, earnings_context,
                                       analyst_pass, insider_capture,
                                       pattern_join, darkpool_agg, opt_flow,
                                       archive_join)
    reads = []

    def _read(t):
        reads.append(t)
        return [dict(x) for x in series.get(t, [])]

    tickers = [t for t in series if t not in ("SPY", "RSP")]
    monkeypatch.setattr(b, "_load_universe", lambda: list(tickers))
    monkeypatch.setattr(b, "_read_daily_bars", _read)
    monkeypatch.setattr(b, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_fundamentals",
                        lambda t, price=None, failures=None: {"company": "X"})
    monkeypatch.setattr(b, "_read_rs_map", lambda: {})
    monkeypatch.setattr(b, "_read_bulk_fundamentals", lambda targets, failures=None: {})
    monkeypatch.setattr(b, "_read_prev_closes", lambda: {})
    frames = settled_frames or {}
    if settled is not None:
        monkeypatch.setattr(b, "settled_session", lambda now=None: settled)

    def _settled(d):
        rows = frames.get(d)
        return {"rows": rows} if rows else {"error": "stubbed"}
    monkeypatch.setattr(b, "_read_settled_bars", _settled)
    for fn in ("read_breadth_flags", "read_uct20", "read_index_flags", "read_etf_flags"):
        monkeypatch.setattr(cj, fn, lambda targets, failures=None: {})
    for mod, fn in ((finviz_universe, "read_finviz_fields"),
                    (earnings_dates, "read_earnings_dates"),
                    (earnings_context, "read_last_report_move"),
                    (earnings_context, "read_implied_context"),
                    (analyst_pass, "read_analyst_fields"),
                    (insider_capture, "read_insider_fields"),
                    (pattern_join, "read_pattern_fields"),
                    (darkpool_agg, "read_darkpool_fields"),
                    (opt_flow, "read_opt_flow_fields"),
                    (archive_join, "read_archive_fields")):
        monkeypatch.setattr(mod, fn, lambda targets, failures=None, **kw: {})
    return reads


def _spy_collect(monkeypatch):
    calls = []
    real = rs_columns.collect_one

    def _spy(bars, spy_bars, rsp_bars=None, **kw):
        calls.append({"spy": list(spy_bars or []), "rsp": list(rsp_bars or [])})
        return real(bars, spy_bars, rsp_bars, **kw)
    monkeypatch.setattr(rs_columns, "collect_one", _spy)
    return calls


END = date(2026, 11, 5)
CLOSES = [100.0 + 0.1 * i for i in range(300)]


# ───────────────────────────── #5 the bars_rs gate ──────────────────────────

def test_the_flag_defaults_off():
    assert registry_defs.RS_V2_ENABLED is False, "every RS flag ships dark"
    assert b.rs_v2_enabled() is False


def test_dark_build_row_never_runs_the_collector(monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", False)
    calls = _spy_collect(monkeypatch)
    bars = _bar_dicts(CLOSES, END)
    failures, timing = {}, {}
    row = b.build_row("AAA", bars, None, None, failures=failures,
                      spy_bars=bars, rsp_bars=bars, rs_timing=timing)
    assert calls == [], "a dark pod pays nothing for the ten columns"
    assert all(row[c] is None for c in rs_columns.COLUMNS)
    assert "bars_rs" not in failures and timing == {}
    assert row["price"] == bars[-1]["c"], "the rest of the row still builds"


def test_dark_run_build_reads_no_rsp_and_says_so_in_the_receipt(tmp_db, monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", False)
    bars = _bar_dicts(CLOSES, END)
    reads = _stub_build(monkeypatch, {"AAA": bars, "SPY": bars, "RSP": bars})
    calls = _spy_collect(monkeypatch)
    stats = b.run_build()
    assert stats["built"] == 1
    assert calls == []
    assert reads.count("SPY") == 1, "rs_line_trend still reads SPY"
    assert "RSP" not in reads, "RSP feeds only the dark step"
    assert "bars_rs" not in stats["sources"] and "rsp_bars" not in stats["sources"]
    # `phase3` / `phase3_ms` joined the receipt with UCT RS Phase 3 unit 3-10
    # (tests/test_screener_rs_phase3_columns.py): dark here, so off and zero.
    assert stats["bars_rs"] == {"enabled": False, "rows": 0, "ms": 0.0, "ms_per_row": None,
                                "phase3": False, "phase3_ms": 0.0}


def test_armed_run_build_times_the_step_into_the_receipt(tmp_db, monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    bars = _bar_dicts(CLOSES, END)
    _stub_build(monkeypatch, {"AAA": bars, "BBB": bars, "SPY": bars, "RSP": bars})
    stats = b.run_build()
    rcpt = stats["bars_rs"]
    assert rcpt["enabled"] is True and rcpt["rows"] == 2
    assert rcpt["ms"] > 0 and rcpt["ms_per_row"] == pytest.approx(rcpt["ms"] / 2, abs=0.01)
    assert stats["sources"]["bars_rs"] == {"rated": 2}


# ───────────────────────────── #4 the split guard ───────────────────────────

def test_a_real_big_gap_leader_is_rated_not_split_guarded():
    """The reviewer's repro: a 0.3 %/day riser with one +65 % day was bars=0,
    unadjusted_split, against a true score near the top."""
    gap = _riser(gap_at=200)
    flat = [100.0] * 270
    out = rh.compute_ratings({"GAP": gap, "F1": flat, "F2": flat, "F3": flat}, set())
    assert out["GAP"].get("reason") is None, out["GAP"]
    assert out["GAP"]["bars"] == 270 and out["GAP"]["ibd"] == 99


def test_a_real_crash_is_rated_not_split_guarded():
    crash = [100.0] * 200 + [40.0] * 70           # -60 % in one bar
    out = rh.compute_ratings({"CR": crash, "OK": [100.0] * 270}, set())
    assert out["CR"].get("reason") is None and out["CR"]["bars"] == 270


def test_the_guard_reads_only_the_scored_closes():
    days = _weekdays_ending(END, 270)
    ts = [_ymd(d) for d in days]
    old_split = [300.0] * 5 + [100.0] * 265        # 3:1 at index 5 of 270: older than 253
    assert len(old_split) - 5 > rh.SCORE_BARS
    assert not rh.window_split_suspect(ts, old_split, [(days[5].isoformat(), 3.0)]), \
        "the score never reaches that boundary"
    recent = [300.0] * 100 + [100.0] * 170
    assert rh.window_split_suspect(ts, recent, [(days[100].isoformat(), 3.0)]), \
        "an unadjusted 3:1 inside the scored closes still trips"


def test_there_is_no_threshold_fallback_any_more():
    """N4 (2026-11-07): one judge. A threshold either passes a 2:1 split or drops a
    real 50 % move, so the +/-60 % fallback and its factor table are gone."""
    for name in ("split_suspect", "SPLIT_GUARD_PCT", "SPLIT_FACTORS", "_split_sized", "_split_tol"):
        assert not hasattr(rh, name), f"{name} came back: a second split judge beside unadjusted_splits"
    days = _weekdays_ending(END, 270)
    ts = [_ymd(d) for d in days]
    for closes in ([100.0] * 200 + [50.0] * 70,       # a real -50 % day
                   [100.0] * 200 + [200.0] * 70,      # a real +100 % day
                   [100.0] * 200 + [25.0] * 70):      # a 4:1 cliff nobody declared
        assert not rh.window_split_suspect(ts, closes, None), "an unknown list is no evidence"
        assert not rh.window_split_suspect(ts, closes, []), "nothing declared: a gap is a gap"


def test_the_declared_list_is_the_judge_when_it_is_known():
    days = _weekdays_ending(END, 270)
    ts = [_ymd(d) for d in days]
    split = [100.0] * 200 + [25.0] * 70             # unadjusted 4:1 at index 200
    declared = [(days[200].isoformat(), 4.0)]
    assert rh.window_split_suspect(ts, split, declared), "a declared split still on the closes"
    assert not rh.window_split_suspect(ts, [25.0] * 270, declared), "already adjusted"
    two_for_one = [100.0] * 200 + [50.0] * 70       # the 2:1 the old +/-60 % let through
    assert rh.window_split_suspect(ts, two_for_one, [(days[200].isoformat(), 2.0)])
    doubled = [100.0] * 200 + [200.0] * 70          # a real +100 % day, no split declared
    assert not rh.window_split_suspect(ts, doubled, []), "nothing declared: a gap is a gap"


def test_nightly_job_judges_each_name_against_its_declared_splits(tmp_db):
    end = END
    days = _weekdays_ending(end, 270)
    series = {
        "SPLT": [100.0] * 200 + [25.0] * 70,       # declared 4:1, still unadjusted
        "DBL": [100.0] * 200 + [200.0] * 70,       # a real +100 % day, nothing declared
        "GAP": _riser(gap_at=200),                 # a real +65 % day, list unknown
        "OK": [100.0] * 270,
    }
    declared = {"SPLT": [(days[200].isoformat(), 4.0)], "DBL": []}
    r = rh.nightly_job(end, universe=list(series), etf_tickers=set(),
                       bars_reader=make_reader(series, end), fast_map={},
                       splits_reader=lambda t: declared.get(t))
    assert r["ok"] is True
    assert r["split_guard"] == 1, r
    assert r["note"]["split_basis"] == {"declared": 2, "unknown": 2}
    stored = {x["ticker"] for x in _rows(tmp_db)}
    assert stored == {"DBL", "GAP", "OK"}, "only the unadjusted declared split is skipped"


def test_backfill_uses_the_declared_list_too(tmp_db, tmp_path):
    end = END
    days = _weekdays_ending(end, 275)
    series = {"DBL": [100.0] * 200 + [200.0] * 75, "OK": [100.0] * 275}
    r = rh.backfill(days=3, universe=list(series), etf_tickers=set(),
                    bars_reader=make_reader(series, end),
                    sessions=days[-3:], data_dir=str(tmp_path),
                    splits_reader=lambda t: [])
    assert r["ok"] is True and r["note"]["split_basis"] == {"declared": 2, "unknown": 0}
    assert {(x["ticker"]) for x in _rows(tmp_db)} == {"DBL", "OK"}


def test_the_default_splits_reader_never_schedules_a_warm_and_fetches_on_budget(monkeypatch):
    """A universe sweep must not schedule thousands of background warms (the serve
    path's pool); it asks through its own budgeted reader instead (N4)."""
    from api.services import bars_sanitize as san
    from api.services import declared_splits as ds
    submitted, asked = [], []
    monkeypatch.setattr(san.cache, "get", lambda key: None)
    monkeypatch.setattr(san.cache, "set", lambda key, value, ttl: None)
    monkeypatch.setattr(san._warm_pool, "submit", lambda fn: submitted.append(fn))
    monkeypatch.setattr(ds, "_default_fetch",
                        lambda t: asked.append(t) or {"ipo": None, "splits": [("2026-01-02", 2.0)]})
    monkeypatch.setattr(ds, "_default_gate", lambda: (lambda: True, lambda: 0.0, lambda: None))
    monkeypatch.setattr(ds, "FETCH_PAUSE_S", 0)
    reader = rh.default_splits_reader(None, budget=1)
    assert reader("ZZZZ") == [("2026-01-02", 2.0)] and asked == ["ZZZZ"]
    assert reader("YYYY") is None, "the budget is spent: unknown, not guessed"
    assert submitted == [], "no warm scheduled"
    assert reader.stats["fetched"] == 1 and reader.stats["unknown"] == 1
    assert rh.default_splits_reader(None).budget == ds.DEFAULT_FETCH_BUDGET, "the nightly default"


def _rows(path):
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(f"SELECT * FROM {rh.TABLE}").fetchall()]
    finally:
        conn.close()


# ───────────────────────────── #15 benchmark settle ─────────────────────────

def _grouped(bar, c=None):
    c = bar["c"] if c is None else c
    return {"o": bar["o"], "h": max(bar["h"], c), "l": min(bar["l"], c), "c": c, "v": 5000.0}


def test_armed_build_settles_and_catches_up_the_benchmarks(tmp_db, monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", True)
    aaa = _bar_dicts(CLOSES, END)                  # newest bar = 2026-11-05
    spy = _bar_dicts(CLOSES, END)
    spy[-1] = {**spy[-1], "c": 99.0}               # an intraday snapshot of 11-05
    rsp = _bar_dicts(CLOSES[:-1], date(2026, 11, 4))   # one session short
    frames = {
        END: {"AAA": _grouped(aaa[-1]), "SPY": _grouped(spy[-1], c=spy[-1]["h"] * 0.995),
              "RSP": {"o": 130.0, "h": 131.0, "l": 129.0, "c": 130.5, "v": 9000.0}},
        date(2026, 11, 4): {"RSP": _grouped(rsp[-1])},
    }
    settled_spy_close = frames[END]["SPY"]["c"]
    _stub_build(monkeypatch, {"AAA": aaa, "SPY": spy, "RSP": rsp},
                settled_frames=frames, settled=END)
    calls = _spy_collect(monkeypatch)
    stats = b.run_build()
    assert stats["built"] == 1 and len(calls) == 1
    got = calls[0]
    assert got["spy"][-1]["c"] == settled_spy_close, "SPY's newest bar is the settled one"
    assert got["rsp"][-1]["t"] == _ymd(END) and got["rsp"][-1]["c"] == 130.5, \
        "RSP was caught up to the settled session"
    bench = stats["settled_bars"]["benchmarks"]
    assert bench["SPY"] == {"settled": "applied", "current": True}
    assert bench["RSP"] == {"settled": "not_session", "catchup": "caught_up",
                            "appended": 1, "current": True}
    assert stats["sources"]["bars_rs"] == {"rated": 1}, "no no_bench from a lagging benchmark"


def test_dark_build_settles_no_benchmark(tmp_db, monkeypatch):
    monkeypatch.setattr(registry_defs, "RS_V2_ENABLED", False)
    aaa = _bar_dicts(CLOSES, END)
    frames = {END: {"AAA": _grouped(aaa[-1]), "SPY": _grouped(aaa[-1])}}
    _stub_build(monkeypatch, {"AAA": aaa, "SPY": aaa}, settled_frames=frames, settled=END)
    stats = b.run_build()
    assert "benchmarks" not in stats["settled_bars"]


# ───────────────────────────── #20 stale ratings withheld ───────────────────

def _seed(last: date, n=21):
    days = _weekdays_ending(last, n)
    for k, d in enumerate(days):
        rh.store_rows(d.isoformat(), {"AAA": {"ibd": 50 + k, "m1": 1, "m3": 2, "m6": 3,
                                              "m12": 4, "score": 1.1, "bars": 253}})
    return days


def test_four_sessions_behind_is_withheld_and_counted(tmp_db, monkeypatch):
    _seed(date(2026, 1, 21))
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 27))
    failures = {}
    assert b._read_rs_history_fields(["AAA"], failures=failures) == {}
    assert failures["rs_history"]["withheld_stale"] == 1


def test_three_sessions_behind_is_still_served(tmp_db, monkeypatch):
    _seed(date(2026, 1, 21))
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 26))
    failures = {}
    out = b._read_rs_history_fields(["AAA"], failures=failures)
    assert out["AAA"]["rs_rating_ibd"] == 70
    assert "withheld_stale" not in failures.get("rs_history", {})


def test_the_tuesday_after_good_friday_is_one_session_not_four_days(tmp_db, monkeypatch):
    """Counted in trading sessions: a calendar-day rule would blank a healthy
    table here. 2026-04-03 is Good Friday; the newest stored session is Thursday."""
    from api.services import session_calendar as sc
    assert not sc.is_trading_day(date(2026, 4, 3))
    _seed(date(2026, 4, 2))
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 4, 6))
    failures = {}
    out = b._read_rs_history_fields(["AAA"], failures=failures)
    assert out["AAA"]["rs_rating_ibd"] == 70
    assert failures == {"rs_history": {"stale:4d": 1}}, "noted, never withheld"


def test_a_withheld_session_leaves_the_seven_null_in_the_build(tmp_db, monkeypatch):
    _seed(date(2026, 1, 21))
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 2, 20))
    bars = _bar_dicts(CLOSES, END)
    _stub_build(monkeypatch, {"AAA": bars, "SPY": bars})
    stats = b.run_build()
    with closing(snapshot_db.connect()) as conn:
        row = conn.execute(f"SELECT {', '.join(SEVEN)} FROM screener_rows "
                           "WHERE ticker='AAA'").fetchone()
    assert tuple(row) == (None,) * 7
    assert stats["sources"]["rs_history"]["withheld_stale"] == 1


# ───────────────────────────── #30 narrow reads ─────────────────────────────

def _trace(monkeypatch):
    statements = []
    real = snapshot_db.connect

    def _connect(*a, **k):
        conn = real(*a, **k)
        conn.set_trace_callback(statements.append)
        return conn
    monkeypatch.setattr(snapshot_db, "connect", _connect)
    return statements


def test_a_one_symbol_read_touches_only_that_symbols_rows(tmp_db, monkeypatch):
    days = _weekdays_ending(date(2026, 1, 21), 21)
    for k, d in enumerate(days):
        ratings = {f"T{i:03d}": {"ibd": 10, "m1": 1, "m3": 1, "m6": 1, "m12": 1,
                                 "score": 1.0, "bars": 253} for i in range(300)}
        ratings["AAA"] = {"ibd": 50 + k, "m1": 1, "m3": 2, "m6": 3, "m12": 4,
                          "score": 1.1, "bars": 253}
        rh.store_rows(d.isoformat(), ratings)
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 22))
    wide = rh.read_fields(["AAA"] + [f"T{i:03d}" for i in range(getattr(rh, "NARROW_READ_MAX", 200))])
    statements = _trace(monkeypatch)
    narrow = rh.read_fields(["AAA"])
    assert narrow["AAA"] == wide["AAA"], "same answer, d5 and d20 included"
    assert narrow["AAA"]["d5"] == 5 and narrow["AAA"]["d20"] == 20
    reads = [s for s in statements if "FROM rs_rating_history WHERE session = " in s]
    assert len(reads) == 3 and all("ticker IN" in s for s in reads), reads
    assert not any("DISTINCT" in s for s in statements), "sessions come from PK seeks"


def test_the_bulk_read_keeps_the_whole_session_read(tmp_db, monkeypatch):
    _seed(date(2026, 1, 21))
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 22))
    statements = _trace(monkeypatch)
    want = ["AAA"] + [f"X{i}" for i in range(getattr(rh, "NARROW_READ_MAX", 200))]
    out = rh.read_fields(want)
    assert out["AAA"]["ibd"] == 70 and out["X0"] == {}
    reads = [s for s in statements if "FROM rs_rating_history WHERE session = " in s]
    assert reads and not any("ticker IN" in s for s in reads)


def test_read_fields_for_an_explicit_session_still_demands_an_exact_match(tmp_db, monkeypatch):
    _seed(date(2026, 1, 21))
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 22))
    out = rh.read_fields(["AAA"], session="2026-01-14")
    assert out["AAA"]["asof"] == "2026-01-14" and out["AAA"]["d5"] == 5
    failures = {}
    assert rh.read_fields(["AAA"], session="2026-01-17", failures=failures) == {}, "a Saturday"
    assert failures == {"rs_history": {"missing": 1}}


# ───────────────────────────── #31 read-only status ─────────────────────────

def _tables(path):
    conn = sqlite3.connect(path)
    try:
        return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        conn.close()


def test_status_on_a_dark_pod_creates_no_table(tmp_db):
    with closing(snapshot_db.connect()) as conn:      # the screener.db exists, the RS tables do not
        conn.execute("CREATE TABLE other (x INTEGER)")
        conn.commit()
    st = rh.status()
    assert (st["rows"], st["sessions"], st["latest_session"], st["last_run"]) == (0, 0, None, None)
    assert rh.last_run() is None
    tables = _tables(tmp_db)
    assert rh.TABLE not in tables and rh.RUNS_TABLE not in tables, tables


def test_status_counts_without_a_distinct_scan(tmp_db, monkeypatch):
    days = _seed(date(2026, 1, 21))
    statements = _trace(monkeypatch)
    st = rh.status()
    assert (st["rows"], st["sessions"], st["latest_session"]) == (21, 21, days[-1].isoformat())
    assert not any("DISTINCT" in s for s in statements), statements
