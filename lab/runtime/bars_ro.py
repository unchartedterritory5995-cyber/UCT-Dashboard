"""Strictly read-only accessor for the real local bars.db.

This is deliberately NOT a reuse of api.services.bars_sqlite: that module's
`_conn()` opens the database with `sqlite3.connect(_DB_PATH, ...)` (default
flags — a writable handle) and sets WAL/synchronous/cache PRAGMAs on it. For
a local research prototype touching the live, actively-written production
bars.db (~3GB, WAL mode, used by other scheduled jobs on this box), the lab
mission requires a connection that is PHYSICALLY INCAPABLE of writing, not
merely "a handle we promise only to read with". SQLite's `mode=ro` URI flag
gives that guarantee at the OS/driver level, so this module opens its own
connection that way and replicates ONLY the exact read query `get_bars`
already uses (same SELECT, same ORDER BY, same shape), so results are
identical to what the production read path would return.

Every query here is a small, fast, single indexed lookup — no long-running
transactions, no writes, no schema access.
"""
from __future__ import annotations

import os
import sqlite3
import time

DB_PATH = os.environ.get("LAB_BARS_DB_PATH", r"C:\data\bars.db")


def ro_connect() -> sqlite3.Connection:
    """Open a strictly read-only connection (SQLite URI mode=ro).

    A mode=ro connection cannot INSERT/UPDATE/DELETE/CREATE even if the
    calling code has a bug — SQLite rejects the write at the driver level.
    """
    uri = f"file:{DB_PATH}?mode=ro"
    return sqlite3.connect(uri, uri=True, timeout=5)


def get_daily_bars(conn: sqlite3.Connection, ticker: str, max_bars: int = 200) -> list[tuple]:
    """Up to max_bars daily (ts,o,h,l,c,v) rows, oldest-first.

    Identical query shape to api.services.bars_sqlite.get_bars(ticker, "D",
    max_bars) — verified by reading that function before writing this one.
    """
    return conn.execute(
        """SELECT ts,o,h,l,c,v FROM (
               SELECT ts,o,h,l,c,v FROM ohlcv
               WHERE ticker=? AND tf='D'
               ORDER BY ts DESC LIMIT ?
           ) ORDER BY ts ASC""",
        (ticker.upper(), max_bars),
    ).fetchall()


def rows_to_bar_dicts(rows: list[tuple]) -> list[dict]:
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]} for r in rows]


def timed_get_daily_bars(conn, ticker: str, max_bars: int = 200) -> tuple[list[dict], float]:
    t0 = time.perf_counter()
    rows = get_daily_bars(conn, ticker, max_bars)
    bars = rows_to_bar_dicts(rows)
    return bars, time.perf_counter() - t0
