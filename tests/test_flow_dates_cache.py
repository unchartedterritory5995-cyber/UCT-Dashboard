"""`get_available_dates` is cached — and must not answer for the wrong database.

Measured on prod 2026-08-29, on a WARM pod: `/api/flow/dates` took ~3.0 s, and
`/live-massive` asks for it TWICE per page load. The query is
`SELECT DISTINCT CreatedDate FROM flow WHERE source = ?` over 678,988 rows to
produce ~53 dates; `idx_flow_source_date` covers it, but SQLite still walks every
index entry for that source to dedupe, and post-cutover it runs on the
flow-worker behind an HTTP proxy hop.

The risk in caching it is not staleness (the list only ever GAINS a date, so a
stale read omits a new day briefly and can never invent one). The risk is the
KEY: two FlowDB instances on different files sharing an answer is a cross-database
hit that looks like corruption and reproduces nowhere.
"""
from __future__ import annotations

import sqlite3

import pytest

from api.flow_db import FlowDB
from api.services.cache import cache as shared_cache


@pytest.fixture(autouse=True)
def _clean_cache():
    # The shared singleton is process-wide; don't let one case seed another.
    for key in [k for k in shared_cache.keys_with_prefix("flow_dates::")]:
        shared_cache.invalidate(key)
    yield
    for key in [k for k in shared_cache.keys_with_prefix("flow_dates::")]:
        shared_cache.invalidate(key)


def _db(tmp_path, name, rows):
    path = str(tmp_path / name)
    db = FlowDB(path)
    with db._conn() as conn:
        conn.executemany(
            "INSERT INTO flow (CreatedDate, source) VALUES (?, ?)",
            [(d, "stocks") for d in rows],
        )
    return db


def test_dates_come_back_sorted_chronologically(tmp_path):
    db = _db(tmp_path, "a.db", ["8/28/2026", "8/26/2026", "8/27/2026"])
    assert db.get_available_dates("stocks") == ["8/26/2026", "8/27/2026", "8/28/2026"]


def test_the_second_call_does_not_touch_the_database(tmp_path, monkeypatch):
    """The whole point: the repeat call is free.

    Asserted by BREAKING the db connection after the first call — if the second
    call still answers, it cannot have queried.
    """
    db = _db(tmp_path, "b.db", ["8/27/2026", "8/28/2026"])
    first = db.get_available_dates("stocks")
    assert first == ["8/27/2026", "8/28/2026"]

    def _boom():
        raise AssertionError("get_available_dates queried the DB on a cache hit")

    monkeypatch.setattr(db, "_conn", _boom)
    assert db.get_available_dates("stocks") == first


def test_two_databases_never_share_an_answer(tmp_path):
    """⛔ THE dangerous failure. Keyed on source alone, these would collide.

    Web keeps a frozen pre-cutover flow.db while the flow-worker holds the live
    one, and every test builds its own — a shared key would serve one file's
    dates for the other, which reads as data corruption and reproduces nowhere.
    """
    a = _db(tmp_path, "one.db", ["8/27/2026"])
    b = _db(tmp_path, "two.db", ["1/5/2026", "1/6/2026"])
    assert a.get_available_dates("stocks") == ["8/27/2026"]
    assert b.get_available_dates("stocks") == ["1/5/2026", "1/6/2026"]
    # …and again, now that both are cached, in the other order.
    assert b.get_available_dates("stocks") == ["1/5/2026", "1/6/2026"]
    assert a.get_available_dates("stocks") == ["8/27/2026"]


def test_sources_do_not_share_an_answer(tmp_path):
    path = str(tmp_path / "s.db")
    db = FlowDB(path)
    with db._conn() as conn:
        conn.executemany("INSERT INTO flow (CreatedDate, source) VALUES (?, ?)",
                         [("8/27/2026", "stocks"), ("8/20/2026", "indexes")])
    assert db.get_available_dates("stocks") == ["8/27/2026"]
    assert db.get_available_dates("indexes") == ["8/20/2026"]


def test_the_caller_cannot_mutate_the_cached_list(tmp_path):
    """A returned list is the caller's; poisoning the cache through it is not.

    ⚠️ BOTH directions are exercised on purpose, because they are separate bugs
    and an earlier version of this test caught only one. The FIRST call returns
    the freshly-computed list (guarded by caching a copy); the SECOND returns the
    cached one (guarded by returning a copy). Mutating only the first result left
    `return hit` — handing the caller the cache's own list — passing.
    """
    db = _db(tmp_path, "m.db", ["8/27/2026", "8/28/2026"])
    expected = ["8/27/2026", "8/28/2026"]

    # 1) mutate the COMPUTED result — must not reach the cache.
    first = db.get_available_dates("stocks")
    first.append("9/9/9999")
    first.clear()
    assert db.get_available_dates("stocks") == expected

    # 2) mutate the CACHED result — must not reach the cache either.
    cached = db.get_available_dates("stocks")
    cached.append("1/1/1970")
    cached.clear()
    assert db.get_available_dates("stocks") == expected


def test_a_new_day_appears_once_the_entry_expires(tmp_path):
    """Staleness is bounded and only ever OMITS — it never invents a date."""
    db = _db(tmp_path, "n.db", ["8/27/2026"])
    assert db.get_available_dates("stocks") == ["8/27/2026"]
    with db._conn() as conn:
        conn.execute("INSERT INTO flow (CreatedDate, source) VALUES (?, ?)",
                     ("8/28/2026", "stocks"))
    # Still the cached answer — omitting the new day, not inventing one.
    assert db.get_available_dates("stocks") == ["8/27/2026"]
    for key in list(shared_cache.keys_with_prefix("flow_dates::")):
        shared_cache.invalidate(key)          # stand in for the TTL elapsing
    assert db.get_available_dates("stocks") == ["8/27/2026", "8/28/2026"]


def test_a_cache_write_failure_does_not_fail_the_read(tmp_path, monkeypatch):
    """A caching problem must never become a data-availability problem."""
    db = _db(tmp_path, "f.db", ["8/27/2026"])

    def _explode(*a, **k):
        raise RuntimeError("cache is down")

    monkeypatch.setattr(shared_cache, "set", _explode)
    assert db.get_available_dates("stocks") == ["8/27/2026"]


def test_the_ttl_is_short_enough_to_be_honest():
    """A long TTL would hide a new trading day for the whole session."""
    from api import flow_db
    assert 0 < flow_db._DATES_CACHE_TTL_S <= 300, (
        f"{flow_db._DATES_CACHE_TTL_S}s is too long to wait for a new trading "
        "day to appear in the date picker"
    )
