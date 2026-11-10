"""Rails for the seven history-derived UCT RS rating columns in the nightly
screener build (plan §10.1; engineering map §2.5 and §3 row 2a-06).

`snapshot_builder._read_rs_history_fields` reads `rs_history.read_fields` ONCE
per build through `_read_market_source("rs_history", ...)` — a disjoint peer of
the Wave 2/5 readers — and maps the reader's field names to the seven columns
`snapshot_db` declares. Everything here runs against a `screener.db` in
`tmp_path` (`SCREENER_DB_PATH`), synthetic bars and stubbed readers: no
network, no bars.db, no real data root.

The session rule, pinned below because it is the one decision in this unit:
the build reads the NEWEST stored session, not its own settled session.
`rs_history_nightly` runs at 04:15 ET, after the 03:00 build, so at build time
the newest row is normally the session before `bars_asof`; `read_fields`'s own
`STALE_DAYS` rule (3 calendar days behind the settled session) notes `stale:<n>d`.
Moved 2026-11-07 (RS review finding #20): a stored session more than
`snapshot_builder.RS_HISTORY_MAX_LAG_SESSIONS` trading sessions behind is
WITHHELD (the seven go NULL) and counted `withheld_stale`; it was served at any age.
"""
from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import date

import pytest

import api.services.screener.snapshot_builder as b
from api.services.screener import rs_history as rh
from api.services.screener import snapshot_db

SEVEN = ("rs_rating_ibd", "rs_rating_chg_5", "rs_rating_chg_20",
         "rs_rating_1m", "rs_rating_3m", "rs_rating_6m", "rs_rating_12m")


# ───────────────────────────── fixtures ─────────────────────────────────────

@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    """Point `snapshot_db.connect()` (and so `rs_history`) at a fresh file."""
    path = tmp_path / "screener.db"
    monkeypatch.setenv("SCREENER_DB_PATH", str(path))
    assert snapshot_db.get_db_path() == str(path)
    return path


def _seed(n_sessions=21):
    """`n_sessions` stored sessions 2026-01-01.. for AAA with ibd 50, 51, ... so
    the 5- and 20-session deltas are exactly 5 and 20; BBB only in the newest
    session, with an unrated 12-month component and no earlier session."""
    keys = [f"2026-01-{d:02d}" for d in range(1, n_sessions + 1)]
    for k, key in enumerate(keys):
        ratings = {"AAA": {"ibd": 50 + k, "m1": 1, "m3": 2, "m6": 3, "m12": 4,
                           "score": 1.1, "bars": 253}}
        if k == len(keys) - 1:
            ratings["BBB"] = {"ibd": 10, "m1": 11, "m3": 12, "m6": 13, "m12": None,
                              "score": 1.0, "bars": 200}
        rh.store_rows(key, ratings, {"AAA": 61} if k == len(keys) - 1 else None)
    return keys


def _bars(n=60):
    return [{"t": 20260100 + i, "o": 10.0, "h": 10.5, "l": 9.5, "c": 10.0, "v": 1000}
            for i in range(n)]


def _stub_build(monkeypatch, tickers):
    """Every reader `run_build` calls EXCEPT rs_history, stubbed the way the
    builder's own tests stub them; the bars store is synthetic."""
    from api.services.screener import (context_joins as cj, finviz_universe,
                                       earnings_dates, earnings_context,
                                       analyst_pass, insider_capture,
                                       pattern_join, darkpool_agg, opt_flow,
                                       archive_join)
    bars = _bars()
    monkeypatch.setattr(b, "_load_universe", lambda: list(tickers))
    monkeypatch.setattr(b, "_read_daily_bars", lambda t: list(bars))
    monkeypatch.setattr(b, "_read_ratings", lambda t, failures=None: {})
    monkeypatch.setattr(b, "_read_fundamentals",
                        lambda t, price=None, failures=None: {"company": "X"})
    monkeypatch.setattr(b, "_read_rs_map", lambda: {})
    monkeypatch.setattr(b, "_read_bulk_fundamentals", lambda targets, failures=None: {})
    monkeypatch.setattr(b, "_read_prev_closes", lambda: {})
    monkeypatch.setattr(b, "_read_settled_bars", lambda d: {"error": "stubbed"})
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


def _stored(ticker):
    """The seven, as persisted, in SEVEN's order."""
    with closing(snapshot_db.connect()) as conn:
        row = conn.execute(
            f"SELECT {', '.join(SEVEN)} FROM screener_rows WHERE ticker = ?",
            (ticker,)).fetchone()
    return None if row is None else tuple(row)


# ───────────────────────────── the schema ───────────────────────────────────

def test_the_seven_are_integer_columns_of_the_schema():
    for c in SEVEN:
        assert c in snapshot_db.COLUMNS, c
        assert c in snapshot_db._INT and c not in snapshot_db._TEXT, c
        assert snapshot_db._coldef(c) == f"{c} INTEGER", c
        assert snapshot_db.COLUMNS.count(c) == 1, c
    assert not (set(SEVEN) & snapshot_db.LIVE_ONLY_COLUMNS)


def test_the_mapping_names_exactly_the_seven_and_only_reader_fields():
    """The shim's table is the ONE place the reader's field names meet column
    names: its keys are the seven columns, its values are fields `read_fields`
    actually emits, and the UCT fast rating is deliberately not among them
    (`rs_rank` already is that number)."""
    # S1 (2026-11-10): the eighth, rs_rating_9m <- m9, is pinned by its own tests below.
    assert set(b._RS_HISTORY_COLUMNS) == set(SEVEN) | {"rs_rating_9m"}
    reader_fields = set(rh.ROW_COLUMNS) | {"d5", "d20"}
    assert set(b._RS_HISTORY_COLUMNS.values()) <= reader_fields
    assert "fast" not in b._RS_HISTORY_COLUMNS.values()
    assert len(set(b._RS_HISTORY_COLUMNS.values())) == 8, "no two columns read one field"


def test_the_seven_are_alter_added_to_a_legacy_table(tmp_db):
    """A pod whose screener_rows predates this unit gains the seven on its next
    init — `CREATE TABLE IF NOT EXISTS` never widens, the ALTER-add loop does —
    typed INTEGER, with the rows it already held untouched."""
    legacy = [c for c in snapshot_db.COLUMNS if c not in SEVEN]
    with closing(sqlite3.connect(str(tmp_db))) as conn:
        conn.execute("CREATE TABLE screener_rows ("
                     + ", ".join(snapshot_db._coldef(c) for c in legacy) + ")")
        conn.execute("INSERT INTO screener_rows (ticker, price) VALUES ('AAA', 10.0)")
        conn.commit()
    snapshot_db.init_db()
    with closing(sqlite3.connect(str(tmp_db))) as conn:
        info = {r[1]: r[2] for r in conn.execute("PRAGMA table_info(screener_rows)")}
        kept = conn.execute("SELECT price FROM screener_rows WHERE ticker='AAA'").fetchone()
    for c in SEVEN:
        assert info.get(c) == "INTEGER", (c, info.get(c))
    assert kept == (10.0,), "the migration widens; it never rewrites"
    snapshot_db.init_db()   # idempotent: a second init finds nothing to add


# ───────────────────────────── the reader shim ──────────────────────────────

def test_the_shim_maps_stored_fields_and_leaves_out_what_the_row_cannot_supply(tmp_db, monkeypatch):
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 22))
    _seed()
    failures = {}
    out = b._read_rs_history_fields(["aaa", "BBB", "ZZZ"], failures=failures)
    assert out["AAA"] == {"rs_rating_ibd": 70, "rs_rating_chg_5": 5, "rs_rating_chg_20": 20,
                          "rs_rating_1m": 1, "rs_rating_3m": 2, "rs_rating_6m": 3,
                          "rs_rating_12m": 4}
    # BBB: one stored session (no deltas) and an unrated 12-month component —
    # ABSENT keys, never None, so build_row leaves those columns NULL.
    assert out["BBB"] == {"rs_rating_ibd": 10, "rs_rating_1m": 11,
                          "rs_rating_3m": 12, "rs_rating_6m": 13}
    assert "ZZZ" not in out, "a name with no row is absent from the map"
    assert failures == {}, "one day behind the settled session is fresh"
    # the reader's provenance fields never leak as columns
    leaked = {"fast", "score", "bars", "asof"} & set().union(*out.values())
    assert not leaked, leaked


def test_the_shim_maps_the_nine_month_rank_and_leaves_it_out_when_unfilled(tmp_db, monkeypatch):
    """S1: `rs_rating_9m` <- the stored `m9`. A row stored before the m9 backfill
    carries no m9, so the key is ABSENT (the column stays NULL), never 0."""
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 22))
    _seed()
    assert "rs_rating_9m" not in b._read_rs_history_fields(["AAA"])["AAA"]
    rh.store_rows("2026-01-22", {"AAA": {"ibd": 90, "m1": 1, "m3": 2, "m6": 3, "m9": 77,
                                         "m12": 4, "score": 1.1, "bars": 253}}, None)
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 23))
    assert b._read_rs_history_fields(["AAA"])["AAA"]["rs_rating_9m"] == 77
    assert snapshot_db.COLUMNS.count("rs_rating_9m") == 1
    assert "rs_rating_9m" in snapshot_db._INT


def test_the_shim_is_a_market_source_reader_by_contract():
    """`_read_market_source` calls `reader(targets, failures=failures)`; the shim
    must accept exactly that shape (a dead store reaches the guard, not a
    TypeError that the guard would then count under the wrong name)."""
    import inspect
    params = inspect.signature(b._read_rs_history_fields).parameters
    assert list(params) == ["targets", "failures"]
    assert params["failures"].default is None


# ───────────────────────────── the build seat ───────────────────────────────

def test_run_build_fills_the_seven_from_the_newest_stored_session_with_deltas(tmp_db, monkeypatch):
    """End to end. The build's settled session is 2026-01-22; the newest stored
    session is 2026-01-21 (the 04:15 ordering): the values land, nothing is
    stale, and the receipt counts rated and no_row by name."""
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 22))
    _seed()
    _stub_build(monkeypatch, ["AAA", "BBB", "CCC"])
    stats = b.run_build()
    assert stats["built"] == 3 and stats["errors"] == 0
    assert _stored("AAA") == (70, 5, 20, 1, 2, 3, 4)
    assert _stored("BBB") == (10, None, None, 11, 12, 13, None)
    assert _stored("CCC") == (None,) * 7
    assert stats["sources"]["rs_history"] == {"rated": 2, "no_row": 1}
    assert stats["populated"]["rs_rating_ibd"] == 2
    assert stats["populated"]["rs_rating_chg_20"] == 1
    assert stats["populated"]["rs_rating_12m"] == 1
    assert not (set(SEVEN) & set(stats["empty_columns"]))


def test_a_stale_newest_session_is_withheld_and_counted(tmp_db, monkeypatch):
    """`read_fields`'s own rule: a newest session more than STALE_DAYS (3) calendar
    days behind the settled session notes `stale:<n>d` ONCE.

    Pin moved 2026-11-07 (RS review finding #20, unit U3). This said "stale is
    served": the column carried the last rating the pod had at ANY age, so a
    rolled-back flag froze every row's rating with no as-of date. 2026-01-21 is
    seven trading sessions behind 2026-01-30, past
    `RS_HISTORY_MAX_LAG_SESSIONS` (3), so the seven are withheld and the receipt
    counts the withheld rows."""
    assert rh.STALE_DAYS == 3
    assert b.RS_HISTORY_MAX_LAG_SESSIONS == 3
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 30))
    _seed()
    _stub_build(monkeypatch, ["AAA", "CCC"])
    stats = b.run_build()
    assert stats["built"] == 2
    assert _stored("AAA") == (None,) * 7, "too stale to publish"
    assert stats["sources"]["rs_history"] == {"stale:9d": 1, "withheld_stale": 1,
                                              "no_row": 2}


def test_no_table_leaves_the_seven_null_and_the_row_intact(tmp_db, monkeypatch):
    """A dark pod: `rs_history` never wrote, so there is no side table. The
    reader returns {} and notes `missing` once; every row builds; the seven are
    NULL, named in `empty_columns`; and reading never CREATES the table."""
    _stub_build(monkeypatch, ["AAA", "BBB"])
    stats = b.run_build()
    assert stats["built"] == 2 and stats["errors"] == 0
    assert stats["sources"]["rs_history"] == {"missing": 1, "no_row": 2}
    assert _stored("AAA") == (None,) * 7
    assert snapshot_db.get_row("AAA")["price"] == 10.0, "the rest of the row filled"
    assert set(SEVEN) <= set(stats["empty_columns"])
    with closing(snapshot_db.connect()) as conn:
        names = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    assert rh.TABLE not in names, "a read never creates the side table"


def test_a_raising_reader_degrades_and_is_counted_by_name(tmp_db, monkeypatch):
    """The `_read_market_source` contract at this seam: a raise inside the
    reader costs the seven columns for one build, never a row, and is counted
    under the source's own label by exception name."""
    def _boom(tickers, session=None, failures=None, now=None):
        raise RuntimeError("side table unreadable")
    monkeypatch.setattr(rh, "read_fields", _boom)
    _stub_build(monkeypatch, ["AAA", "BBB"])
    stats = b.run_build()
    assert stats["built"] == 2 and stats["errors"] == 0
    assert stats["sources"]["rs_history"] == {"RuntimeError": 1, "no_row": 2}
    assert snapshot_db.get_row("AAA") is not None
    assert _stored("AAA") == (None,) * 7


def test_the_reader_is_called_exactly_once_per_build_with_every_target(tmp_db, monkeypatch):
    """One whole-market read per build, never per ticker, and for the newest
    stored session (`session=None`) — see the module docstring for why."""
    monkeypatch.setattr(rh, "settled_session", lambda now=None: date(2026, 1, 22))
    _seed()
    calls = []
    real = rh.read_fields

    def _spy(tickers, session=None, failures=None, now=None):
        calls.append((sorted(tickers), session))
        return real(tickers, session=session, failures=failures, now=now)
    monkeypatch.setattr(rh, "read_fields", _spy)
    _stub_build(monkeypatch, ["AAA", "BBB", "CCC"])
    stats = b.run_build()
    assert stats["built"] == 3
    assert len(calls) == 1, "one whole-market read per build, never per ticker"
    assert calls[0][0] == ["AAA", "BBB", "CCC"]
    assert calls[0][1] is None, "the newest stored session, not the build's own"
