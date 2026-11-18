"""Offline conversion of a bars.db COPY to the clustered (WITHOUT ROWID) `ohlcv` layout.

⭐ WHY (measured on production 2026-11-11, Server-Timing only). At the open, the first
view of a name on /api/bars?tf=5&bars=600 spent 0.05-1.4 s in `get_bars` while `last_ts`
(an index seek) stayed under 1 ms; the SAME read seconds later took 2.3-4 ms on every
ticker. That is cold-page I/O, and its size is set by how many pages one series' newest
rows are spread over. In a rowid table rows sit in insertion order, and the universe live
store writes every ticker's 5m bucket every few seconds -- so a ticker's newest 600 bars sit
on ~600 different pages. Clustered on (ticker, tf, ts) they sit on ~12 adjacent pages
(synthetic 11.85M-row store: 701 -> 12 pages per cold read; file 1440 -> 751 MB).

⭐ WHERE. ONLY on a private copy nobody else has open -- the worker's snapshot copy in
`data_sync._make_tarball` -- never on a live store. Serving pods (bars-api, web) adopt the
clustered layout by the ordinary wholesale snapshot install (`download_snapshot`: extract
to a temp dir on the same volume, integrity check, atomic rename, `bump_db_epoch`). After
that nothing writes a rowid `ohlcv` back: `init_db` / deltas / merges only INSERT into the
existing table (`bars_sqlite.ohlcv_ddl` is the one DDL, clustered, and IF NOT EXISTS).

⭐ VERIFIED IN FULL before anything ships: every (ticker, tf) pair's row count, NULL counts,
SUM(ts) and the TOTAL of every value column must match exactly in BOTH directions, the global
COUNT(*) must match, and every other table's row count must match. Any mismatch raises and
the caller ships the unconverted copy, exactly as before this module existed.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import time

_log = logging.getLogger(__name__)


class ClusterError(RuntimeError):
    """The copy could not be converted (or did not verify). Nothing was replaced."""


_PAIR_AGG = ("SELECT ticker, tf, COUNT(*), SUM(ts), COUNT(o), COUNT(h), COUNT(l), COUNT(c), "
             "COUNT(v), TOTAL(o), TOTAL(h), TOTAL(l), TOTAL(c), TOTAL(v) "
             "FROM {s}.ohlcv GROUP BY ticker, tf")


def verify(conn: sqlite3.Connection, a: str = "src", b: str = "main") -> dict:
    """Full equality check of `ohlcv` between two attached schemas. Raises ClusterError."""
    na = conn.execute(f"SELECT COUNT(*) FROM {a}.ohlcv").fetchone()[0]
    nb = conn.execute(f"SELECT COUNT(*) FROM {b}.ohlcv").fetchone()[0]
    if na != nb:
        raise ClusterError(f"row count {na} != {nb}")
    for x, y in ((a, b), (b, a)):
        diff = conn.execute(f"SELECT COUNT(*) FROM ({_PAIR_AGG.format(s=x)} EXCEPT "
                            f"{_PAIR_AGG.format(s=y)})").fetchone()[0]
        if diff:
            raise ClusterError(f"{diff} (ticker, tf) pairs differ ({x} vs {y})")
    pairs = conn.execute(f"SELECT COUNT(*) FROM ({_PAIR_AGG.format(s=b)})").fetchone()[0]
    return {"rows": na, "pairs": pairs}


def cluster_copy(src_path: str, dst_path: str) -> dict:
    """Write a clustered copy of the bars.db at `src_path` to `dst_path` (must not exist).

    Every table, index, trigger and view is carried; `ohlcv` is rebuilt WITHOUT ROWID in
    primary-key order with the indexes `bars_sqlite.expected_index_ddl` wants on it (the
    redundant `idx_ohlcv_lookup` is dropped, every other index -- incl. the by-date index --
    is kept/created). Raises ClusterError (and removes `dst_path`) on any failure."""
    from api.services import bars_sqlite
    if os.path.exists(dst_path):
        raise ClusterError(f"{dst_path} exists")
    t0 = time.time()
    conn = sqlite3.connect(dst_path, isolation_level=None)
    try:
        conn.execute("PRAGMA journal_mode=OFF")      # private build file: no rollback needed
        conn.execute("PRAGMA synchronous=OFF")
        conn.execute("PRAGMA cache_size=-262144")
        conn.execute("PRAGMA temp_store=FILE")
        conn.execute("ATTACH DATABASE ? AS src", (src_path,))
        layout = bars_sqlite.ohlcv_layout(conn, "src")
        if layout != "rowid":
            raise ClusterError(f"source ohlcv is {layout}, nothing to convert")
        bad_ts = conn.execute(
            "SELECT COUNT(*) FROM src.ohlcv WHERE typeof(ts) != 'integer'").fetchone()[0]
        if bad_ts:
            raise ClusterError(f"{bad_ts} ohlcv rows have a non-integer ts")
        objs = conn.execute(
            "SELECT type, name, tbl_name, sql FROM src.sqlite_master WHERE sql IS NOT NULL "
            "AND name NOT LIKE 'sqlite_%'").fetchall()
        conn.execute("BEGIN")
        conn.execute(bars_sqlite.ohlcv_ddl())
        conn.execute("INSERT INTO main.ohlcv(ticker,tf,ts,o,h,l,c,v) "
                     "SELECT ticker,tf,ts,o,h,l,c,v FROM src.ohlcv ORDER BY ticker, tf, ts")
        others = [(n, sql) for typ, n, _t, sql in objs if typ == "table" and n != "ohlcv"]
        for name, sql in others:
            conn.execute(sql)
            conn.execute(f'INSERT INTO main."{name}" SELECT * FROM src."{name}"')
        conn.execute("COMMIT")
        # Secondary objects after the data (faster builds). ohlcv's indexes come from the
        # one authority, plus any other ohlcv index the source carried.
        wanted = bars_sqlite.expected_index_ddl(conn)
        for typ, name, tbl, sql in objs:
            if typ == "index" and (tbl != "ohlcv" or (name not in bars_sqlite.BARS_INDEX_DDL)):
                conn.execute(sql)
        for ddl in wanted.values():
            conn.execute(ddl)
        for typ, name, tbl, sql in objs:
            if typ in ("trigger", "view"):
                conn.execute(sql)
        stats = verify(conn)
        for name, _sql in others:
            a = conn.execute(f'SELECT COUNT(*) FROM src."{name}"').fetchone()[0]
            b = conn.execute(f'SELECT COUNT(*) FROM main."{name}"').fetchone()[0]
            if a != b:
                raise ClusterError(f"table {name}: {a} != {b} rows")
        conn.execute("DETACH DATABASE src")
        conn.execute("PRAGMA journal_mode=WAL")      # ship in the mode every reader opens
        stats.update(tables=len(others) + 1, seconds=round(time.time() - t0, 1))
        return stats
    except BaseException as e:
        try:
            conn.close()
        finally:
            for ext in ("", "-wal", "-shm", "-journal"):
                try:
                    os.remove(dst_path + ext)
                except OSError:
                    pass
        if isinstance(e, ClusterError):
            raise
        raise ClusterError(f"conversion failed: {e}") from e
    finally:
        try:
            conn.close()
        except Exception:
            pass
