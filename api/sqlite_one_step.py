"""Read a whole SQLite result in ONE `sqlite3_step`, for threads that share a busy GIL.

⛔ WHY THIS EXISTS (L1, 2026-10-08). CPython's `sqlite3` releases the GIL around EVERY
`sqlite3_step`, i.e. once per row. In a process where another thread is CPU-bound in Python
(flow-worker: the OPRA consumer runs in the same process as uvicorn), each release hands the
GIL to that thread, and getting it back waits up to `sys.getswitchinterval()` (5 ms). The
row costs microseconds; the wait costs milliseconds. Measured locally with one busy thread:
4,004 rows = 0.04 s idle, **29.15 s** busy (7 ms/row). A ticker's 5-day options flow is tens of
thousands of rows, so `/api/live/massive/ticker-flow` for NVDA ran past the 90 s gateway limit
in market hours while SOFI took 11.6 s (audit L1, 2026-10-05). The same read through
`fetch_rows_one_step` took 0.10 s busy: SQLite builds the result as one JSON value inside a
single step, so the GIL is released and re-acquired once per statement, not once per row.

Rows come back as plain dicts (`r["col"]`, `r.keys()`, `dict(r)` all work, like
`sqlite3.Row`), in the statement's own order. Falls back to an ordinary `fetchall` when the
SQLite build lacks JSON1, so a reader never breaks over it.
"""
from __future__ import annotations

import json
import sqlite3


def fetch_rows_one_step(conn: sqlite3.Connection, sql: str, params=(),
                        as_tuples: bool = False) -> list:
    """Every row of `sql`, fetched in one GIL round-trip: dicts keyed by column name, or plain
    tuples with `as_tuples=True` (for a caller that indexes by position)."""
    params = list(params or ())
    probe = conn.execute(f"SELECT * FROM ({sql}) LIMIT 0", params)
    cols = [d[0] for d in probe.description]
    probe.close()
    # Columns are referenced by their quoted result names, which also covers a computed column
    # (`MAX(CASE ...)` is a legal quoted identifier). Two columns sharing a name cannot be told
    # apart that way, so that shape takes the plain path.
    try:
        if len(set(cols)) != len(cols):
            raise sqlite3.OperationalError("duplicate column names")
        quoted = ", ".join('"' + c.replace('"', '""') + '"' for c in cols)
        blob = conn.execute(
            f"SELECT json_group_array(json_array({quoted})) FROM ({sql})", params).fetchone()[0]
        vals = json.loads(blob or "[]")
    except sqlite3.OperationalError:          # no JSON1 / ambiguous names: the slow, safe way
        vals = [tuple(r) for r in conn.execute(sql, params).fetchall()]
    if as_tuples:
        return [tuple(v) for v in vals]
    return [dict(zip(cols, v)) for v in vals]
