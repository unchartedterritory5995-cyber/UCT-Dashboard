"""`get_available_dates` answers by skip-scan, not by walking every row (2026-11-12).

`SELECT DISTINCT CreatedDate` walked every `idx_flow_source_date` entry for the source
(679k for stocks) to find ~53 dates: /api/flow/dates p50 2.8 s / p95 5.9 s in the member
beacon. The recursive CTE seeks once per distinct date. These rails pin (1) the answer is
the same set DISTINCT gives, per source, NULL excluded; (2) the query is the seek-per-date
shape, read from SQLite's own plan, not from the source text.
"""
from __future__ import annotations

import random

import pytest

from api.flow_db import FlowDB
from api.services.cache import cache as shared_cache


@pytest.fixture(autouse=True)
def _clean_cache():
    for key in list(shared_cache.keys_with_prefix("flow_dates::")):
        shared_cache.invalidate(key)
    yield
    for key in list(shared_cache.keys_with_prefix("flow_dates::")):
        shared_cache.invalidate(key)


def _db(tmp_path, rows):
    db = FlowDB(str(tmp_path / "f.db"))
    with db._conn() as conn:
        conn.executemany("INSERT INTO flow (CreatedDate, source) VALUES (?, ?)", rows)
    return db


def test_same_dates_as_distinct_for_each_source_and_no_leak_across_sources(tmp_path):
    rng = random.Random(7)
    stock_days = [f"{m}/{d}/2026" for m in (8, 9, 10) for d in (1, 2, 15, 28)]
    index_days = ["9/3/2026", "11/11/2026"]
    rows = [(rng.choice(stock_days), "stocks") for _ in range(2000)]
    rows += [(d, "stocks") for d in stock_days]           # every day present at least once
    rows += [(d, "indexes") for d in index_days for _ in range(30)]
    rows += [(None, "stocks")] * 5
    db = _db(tmp_path, rows)
    with db._conn() as conn:
        want = {r[0] for r in conn.execute(
            "SELECT DISTINCT CreatedDate FROM flow WHERE source='stocks' AND CreatedDate IS NOT NULL")}
    got = db.get_available_dates("stocks")
    assert set(got) == want and len(got) == len(want) == len(stock_days)
    assert db.get_available_dates("indexes") == index_days


def test_empty_source_answers_empty(tmp_path):
    db = _db(tmp_path, [("9/3/2026", "indexes")])
    assert db.get_available_dates("stocks") == []


def test_the_query_seeks_the_source_date_index(tmp_path, monkeypatch):
    """Capture the SQL the method runs and ask SQLite for its plan: every MIN must be an
    index SEARCH (a seek), and nothing may SCAN the flow table or use a temp b-tree for
    DISTINCT (the old shape)."""
    db = _db(tmp_path, [("9/3/2026", "stocks")])
    seen = []
    real_conn = db._conn

    class _Spy:
        def __init__(self, c):
            self._c = c

        def execute(self, sql, *a, **k):
            seen.append(sql)
            return self._c.execute(sql, *a, **k)

        def __getattr__(self, n):
            return getattr(self._c, n)

    from contextlib import contextmanager

    @contextmanager
    def spy_conn():
        with real_conn() as c:
            yield _Spy(c)

    monkeypatch.setattr(db, "_conn", spy_conn)
    db.get_available_dates("stocks")
    sql = next(s for s in seen if "CreatedDate" in s)
    with real_conn() as c:
        plan = " | ".join(r[-1] for r in c.execute("EXPLAIN QUERY PLAN " + sql, ("stocks",)))
    assert "USE TEMP B-TREE FOR DISTINCT" not in plan, plan
    assert "SCAN flow" not in plan, plan
    assert "SEARCH flow USING COVERING INDEX" in plan, plan
