"""The live overlay write issues a handful of statements, never one per row.

Why it matters (measured 2026-11-10): `sqlite3` releases the GIL around every statement step, and
`executemany` steps once per row. With ~10,800 rows and any CPU-bound Python thread alive in the web
pod, every one of those hand-offs waits for the GIL; production sweeps spent a median 17 s (max 93 s)
in this write against ~110 ms on an idle box, and locally one busy thread took `executemany` from
107 ms to 307 s. The fix packs rows into multi-row statements, so the number of statements, not the
number of rows, is what this pins.
"""
from __future__ import annotations

import contextlib
import math
import random
import sqlite3

import pytest

from api.services.screener import live_tier, snapshot_db


@pytest.fixture
def db(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "screener.db"))
    snapshot_db.init_db()
    return monkeypatch


def _rows(n, price=10.0):
    cols = snapshot_db._live_write_columns()
    out = []
    for i in range(n):
        r = {c: None for c in cols}
        r.update(ticker=f"T{i:05d}", live_session_ymd=20261111, live_asof=1.0, anchor_bars_asof="20261110",
                 src_price=price + i, anchor_price=price, live_cols=3, price=price + i,
                 chg_pct_1w=round(random.random() * 20, 2), candle_label="Doji (forming)")
        out.append(r)
    return out


def _count_inserts(monkeypatch):
    """Wrap `snapshot_db.connect` so every statement the write runs is traced."""
    seen = []
    real = snapshot_db.connect

    @contextlib.contextmanager
    def traced(*a, **k):
        with real(*a, **k) as conn:
            conn.set_trace_callback(lambda sql: seen.append(sql) if sql.lstrip().upper().startswith(
                "INSERT") else None)
            yield conn
    monkeypatch.setattr(snapshot_db, "connect", traced)
    return seen


def test_every_row_lands_with_its_values(db):
    rows = _rows(2_500)
    assert snapshot_db.upsert_live_rows(rows) == 2_500
    with snapshot_db.connect() as conn:
        got = {r["ticker"]: dict(r) for r in conn.execute(f"SELECT * FROM {live_tier.LIVE_TABLE}")}
    assert len(got) == 2_500
    for r in (rows[0], rows[1_234], rows[-1]):
        assert got[r["ticker"]]["price"] == r["price"]
        assert got[r["ticker"]]["chg_pct_1w"] == r["chg_pct_1w"]
        assert got[r["ticker"]]["candle_label"] == "Doji (forming)"


def test_a_second_sweep_replaces_rows_never_duplicates_them(db):
    snapshot_db.upsert_live_rows(_rows(1_000, price=10.0))
    snapshot_db.upsert_live_rows(_rows(1_000, price=50.0))
    with snapshot_db.connect() as conn:
        n, low = conn.execute(f"SELECT COUNT(*), MIN(price) FROM {live_tier.LIVE_TABLE}").fetchone()
    assert (n, low) == (1_000, 50.0)


def test_the_write_is_a_handful_of_statements_not_one_per_row(db):
    seen = _count_inserts(db)
    rows = _rows(10_842)                        # the size of a real sweep
    snapshot_db.upsert_live_rows(rows)
    with snapshot_db.connect() as conn:
        per = snapshot_db._variable_limit(conn) // len(snapshot_db._live_write_columns())
    assert len(seen) == math.ceil(10_842 / per)
    assert len(seen) <= 50, f"{len(seen)} statements for 10,842 rows: the GIL convoy is back"


def test_without_getlimit_it_still_packs_rows_and_stays_under_the_smallest_sqlite_limit(db):
    """Python before 3.11 has no `Connection.getlimit`; 999 is the smallest variable limit any SQLite
    build has, so every statement must still bind fewer than that."""
    seen = _count_inserts(db)
    db.setattr(snapshot_db, "_variable_limit", lambda conn: 999)
    rows = _rows(1_000)
    snapshot_db.upsert_live_rows(rows)
    per = 999 // len(snapshot_db._live_write_columns())
    assert len(seen) == math.ceil(1_000 / per) < 1_000
    with snapshot_db.connect() as conn:
        assert conn.execute(f"SELECT COUNT(*) FROM {live_tier.LIVE_TABLE}").fetchone()[0] == 1_000


def test_the_real_limit_is_read_from_the_connection():
    conn = sqlite3.connect(":memory:")
    assert snapshot_db._variable_limit(conn) >= 999
