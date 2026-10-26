"""F-SORT-1 -- "newest first" inside one ET day is the trade's own time, never its id.

The closed-trades and options scans order by ET day, then (before this fix) by the row id, a
random uuid, so a list sorted newest ("Tag today's trades") showed one day's trades in a random
order. They now break a day's tie by the row's own instant (a trade's close, a strategy's close,
or its entry while open), newest first, and only then by id.

Every case seeds ids in the OPPOSITE order to time (the oldest trade gets the largest id), so the
old uuid tie-break reads the day oldest-first and goes red. Each carries a cross-day control: a
later day still comes first whatever its time of day.

Seeded through `auth_db.init_db` on a temp sqlite file (the Task 8.5 fixtures); nothing here
reaches `C:\\data`.
"""
from __future__ import annotations

import copy
from datetime import datetime, timezone

import pytest

from api.services.journal_two import notebook_widgets as nw
from api.services.journal_two.widget_engine import plan, run as wrun, sources
from api.services.journal_two.widget_engine import compile as wcompile
from tests.test_widget_options_source import add_opt, raw as opt_raw
from tests.test_widget_sources import (  # noqa: F401 -- `conn` is a fixture used by name
    TODAY, UID, add_trade, conn, raw_plan,
)

RUN_NOW = datetime(2026, 10, 24, 15, 30, tzinfo=timezone.utc)      # ET day = TODAY

# (symbol, ET day, close instant, id). On 2026-10-23 the ids run AGAINST time; the later day's
# trade closes before every earlier-day trade's time of day and still has to lead (the control).
SEED = [
    ("LATE", "2026-10-23", "2026-10-23T19:45:00+00:00", "00000000-0000-4000-8000-000000000001"),
    ("MID", "2026-10-23", "2026-10-23T15:30:00+00:00", "88888888-0000-4000-8000-000000000002"),
    ("EARLY", "2026-10-23", "2026-10-23T14:00:00+00:00", "ffffffff-0000-4000-8000-000000000003"),
    ("PRIOR", "2026-10-22", "2026-10-22T20:30:00+00:00", "ffffffff-0000-4000-8000-000000000004"),
    ("OLDER", "2026-10-21", "2026-10-21T13:35:00+00:00", "00000000-0000-4000-8000-000000000005"),
]
EXPECTED = [s[0] for s in SEED]


@pytest.fixture(autouse=True)
def _fresh_state(monkeypatch):
    monkeypatch.setattr(nw, "_POOL", nw.BoundedPool(nw.WIDGET_POOL_WORKERS, "nb-wsort-test",
                                                    reserve=nw.WIDGET_POOL_RESERVE))
    wrun._reset_state()
    yield
    wrun._reset_state()


def _seed_trade(c, symbol, day, exit_iso, tid, *, commit=True):
    made = add_trade(c, UID, day=day, symbol=symbol, exit_iso=exit_iso,
                     entry_iso=f"{day}T13:31:00+00:00", commit=False)
    c.execute("UPDATE j2_trades SET id = ? WHERE id = ?", (tid, made))
    if commit:
        c.commit()


@pytest.fixture
def seeded(conn):
    for sym, day, exit_iso, tid in reversed(SEED):          # insertion order is no help either
        _seed_trade(conn, sym, day, exit_iso, tid, commit=False)
    conn.commit()
    return conn


def _list(**kw):
    return raw_plan(measures=("trades",), view={"type": "list"}, **kw)


def _compiled(source, raw):
    p = plan.validate_plan(raw, sources.CATALOG)
    rng = plan.resolve_range(p["range"], TODAY)
    return p, rng, wcompile.compile_scan(source, p, {}, rng, UID)


def _labels(payload):
    return [r["label"] for r in payload["rows"]]


# -- closed trades --------------------------------------------------------------------------------

def test_the_pushdown_sql_orders_a_day_by_close_time(seeded):
    _p, _rng, (sql, params) = _compiled(sources.CLOSED, _list())
    assert sql.endswith("DESC, t.exit_date DESC, t.id DESC LIMIT 5001")
    assert [r["symbol"] for r in seeded.execute(sql, params)] == EXPECTED


def test_the_scan_rows_are_newest_first_within_a_day(seeded):
    p, rng, _ = _compiled(sources.CLOSED, _list())
    sc = sources.scan(seeded, p, {}, rng, UID, today=TODAY)
    assert [r["symbol"] for r in sc.rows] == EXPECTED


def test_last_n_pushdown_keeps_the_days_latest_trades(conn):
    # LIMIT 20 cuts inside 2026-10-22: the 18 newer-day trades, then that day's TWO latest closes.
    for i in range(18):
        add_trade(conn, UID, day="2026-10-23", symbol=f"N{i:02d}", commit=False)
    day = [("D4", "2026-10-22T19:50:00+00:00", "00000000-0000-4000-8000-0000000000a1"),
           ("D3", "2026-10-22T18:10:00+00:00", "55555555-0000-4000-8000-0000000000a2"),
           ("D2", "2026-10-22T16:00:00+00:00", "aaaaaaaa-0000-4000-8000-0000000000a3"),
           ("D1", "2026-10-22T14:05:00+00:00", "ffffffff-0000-4000-8000-0000000000a4")]
    for sym, ex, tid in day:
        _seed_trade(conn, sym, "2026-10-22", ex, tid, commit=False)
    conn.commit()
    raw = raw_plan(measures=("trades",), range={"token": "last_20_trades"})
    p, rng, (sql, _params) = _compiled(sources.CLOSED, raw)
    assert sql.endswith("LIMIT 20")                          # the SQL LIMIT path, not the Python one
    sc = sources.scan(conn, p, {}, rng, UID, today=TODAY)
    assert [r["symbol"] for r in sc.rows][18:] == ["D4", "D3"]


def test_last_n_python_path_keeps_the_days_latest_trades(seeded):
    # A list view with "last N" keeps the newest N after filtering in Python (scan_closed).
    raw = _list(range={"token": "last_20_trades"})
    p, rng, (sql, _params) = _compiled(sources.CLOSED, raw)
    assert sql.endswith("LIMIT 5001") and wcompile.last_n_after_filters(sources.CLOSED, p, rng)
    sc = sources.scan(seeded, p, {}, rng, UID, today=TODAY)
    assert [r["symbol"] for r in sc.rows] == EXPECTED


def test_the_built_list_payload_is_newest_first_within_a_day(seeded):
    out = wrun.run_plan(UID, _list(range={"token": "last_30d"}), {}, lane="run", now=RUN_NOW)
    assert out["sample"] is False and _labels(out) == EXPECTED


def test_the_shared_batch_scan_keeps_the_order(seeded):
    # run_plans_batch reads ONE scan per source and cuts each card from it (`run._narrow`).
    cards = [("a", _list(range={"token": "last_30d"})), ("b", _list(range={"token": "all"}))]
    out = wrun.run_plans_batch(UID, cards, now=RUN_NOW)
    for card in out["cards"]:
        assert card["payload"]["sample"] is False
        assert _labels(card["payload"]) == EXPECTED


def test_the_sample_book_sorts_the_same_way():
    rows = wrun.sample_rows("closed_trades")
    book = {t["id"]: t for t in wrun._book()["data"]["closed_trades"]}
    keys = [(r["day"], book[r["_tid"]]["exit_at"], r["_tid"]) for r in rows]
    assert keys == sorted(keys, reverse=True)
    days = [k[0] for k in keys]
    assert any(days.count(d) > 1 for d in set(days))         # non-vacuous: the book has shared days


def test_the_sample_book_breaks_a_day_by_close_time_not_by_id():
    # The book's own ids happen to run in time order, so an id tie-break would read it the same:
    # give one shared day's trades ids that run AGAINST time and the order must not move.
    book = copy.deepcopy(wrun._book()["data"])
    by_day: dict = {}
    for t in book["closed_trades"]:
        by_day.setdefault(t["day"], []).append(t)
    day, trades = next((d, ts) for d, ts in sorted(by_day.items()) if len(ts) >= 3)
    trades.sort(key=lambda t: t["exit_at"])
    for i, t in enumerate(trades):                           # oldest close, largest id
        t["id"] = f"zz-{len(trades) - i:03d}"
    got = [r["_tid"] for r in wrun._sample_closed(book) if r["day"] == day]
    assert got == [t["id"] for t in reversed(trades)]


def test_the_scan_adds_no_sort_of_its_own(seeded):
    # The day expression already forces ONE temp B-tree; the new tie-break rides in it.
    for source, raw in ((sources.CLOSED, _list()),
                        (sources.CLOSED, raw_plan(range={"token": "last_20_trades"})),
                        (sources.OPTIONS, opt_raw(measures=("strategies",)))):
        _p, _rng, (sql, params) = _compiled(source, raw)
        steps = [r[3] for r in seeded.execute("EXPLAIN QUERY PLAN " + sql, params)]
        assert sum("TEMP B-TREE" in s for s in steps) == 1, steps
        assert "USE TEMP B-TREE FOR ORDER BY" in steps


# -- options strategies (the same order: a SQL pushdown and a Python re-sort) ------------------

OPT_SEED = [   # (underlying, entry, closed_at or None for open, id)
    ("OLATE", "2026-10-23T13:40:00Z", "2026-10-23T19:50:00Z", "00000000-0000-4000-8000-0000000000b1"),
    ("OMID", "2026-10-23T13:41:00Z", "2026-10-23T16:20:00Z", "88888888-0000-4000-8000-0000000000b2"),
    ("OEARLY", "2026-10-23T13:42:00Z", "2026-10-23T14:10:00Z", "ffffffff-0000-4000-8000-0000000000b3"),
    ("OPRIOR", "2026-10-22T13:45:00Z", "2026-10-22T20:40:00Z", "ffffffff-0000-4000-8000-0000000000b4"),
]
OPT_EXPECTED = [s[0] for s in OPT_SEED]


@pytest.fixture
def opts(conn):
    for und, entry, closed, sid in reversed(OPT_SEED):
        add_opt(conn, UID, entry=entry, closed_at=closed, underlying=und, sid=sid, commit=False)
    conn.commit()
    return conn


def test_the_options_pushdown_sql_orders_a_day_by_close_time(opts):
    _p, _rng, (sql, params) = _compiled(sources.OPTIONS, opt_raw(measures=("strategies",)))
    assert "COALESCE(o.closed_at, o.entry_date) DESC, o.id DESC" in sql
    assert [r["underlying"] for r in opts.execute(sql, params)] == OPT_EXPECTED


def test_the_options_scan_rows_are_newest_first_within_a_day(opts):
    p, rng, _ = _compiled(sources.OPTIONS, opt_raw(measures=("strategies",)))
    sc = sources.scan(opts, p, {}, rng, UID, today=TODAY)
    assert [r["underlying"] for r in sc.rows] == OPT_EXPECTED


def test_an_open_strategy_is_ordered_by_its_entry(conn):
    # Open strategies sit on their entry ET day, ordered by entry instant.
    add_opt(conn, UID, status="open", entry="2026-10-23T14:00:00Z", underlying="OPA",
            sid="ffffffff-0000-4000-8000-0000000000c1", commit=False)
    add_opt(conn, UID, status="open", entry="2026-10-23T17:00:00Z", underlying="OPB",
            sid="00000000-0000-4000-8000-0000000000c2", commit=False)
    conn.commit()
    p, rng, _ = _compiled(sources.OPTIONS, opt_raw(measures=("strategies",)))
    sc = sources.scan(conn, p, {}, rng, UID, today=TODAY)
    assert [r["underlying"] for r in sc.rows] == ["OPB", "OPA"]
