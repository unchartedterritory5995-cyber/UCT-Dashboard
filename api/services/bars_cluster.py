"""Clustered OHLCV storage: one online, crash-safe rebuild of `ohlcv` as WITHOUT ROWID.

⭐ ROOT CAUSE THIS EXISTS FOR (measured on production 2026-11-11, Server-Timing only).
At the open, first views of S&P 100 names on /api/bars?tf=5&bars=600 spent 0.05-1.4 s in
the `get_bars` segment while `last_ts` (an index seek) stayed under 1 ms. The SAME read
repeated seconds later took 2.3-4 ms on every ticker, and tf=15 cold reads took 3-18 ms.
A lock, a busy writer or the GIL would not care whether the pages were resident; this
cost was paid ONCE per (ticker, tf) and then vanished -- it is cold-page I/O, and its size
is set by how many pages one series' newest rows are spread across.

`ohlcv` was a ROWID table: rows are stored in insertion order, and the (ticker, tf, ts) key
lives in two separate b-trees (the PK autoindex and `idx_ohlcv_lookup`) that point back
into it. The universe live store (`bars_live_store` -> `put_bars_many`) writes every
ticker's 5m bucket every few seconds, so each ticker's newest rows are interleaved with
~10k other tickers' -- 600 bars of one ticker sit on ~600 different table pages, each a
random read from the volume when cold. tf=15 is written per ticker in runs, which is why
it was ~50x cheaper. No cache size fixes this: the hot set of a scattered layout is
~(tickers x tfs x 600) pages, tens of GB.

⭐ THE FIX IS THE LAYOUT. A WITHOUT ROWID table IS its primary-key b-tree: rows are stored
in (ticker, tf, ts) order, so the newest 600 bars of a series are ~10 adjacent leaf pages
whatever order they were written in, the get_bars query is a single range scan with no
second lookup, the two redundant key b-trees disappear (the file shrinks), and every write
touches one b-tree instead of three. `bars_sqlite.init_db` creates new stores this way;
this module converts an existing store in place.

HOW (one owner of the conversion; idempotent; resumes after a crash or deploy):
  1. `ohlcv_clustered` (WITHOUT ROWID, same columns) + three mirror triggers on `ohlcv`,
     in one transaction. From then on every insert/replace/update/delete by ANY
     connection, in ANY process, is applied to both tables inside the writer's own
     transaction -- the copy can never miss a write.
  2. Copy in primary-key order, `CHUNK_ROWS` rows per short transaction (taken under
     `bars_sqlite._WRITE_LOCK` so in-process writers queue instead of hitting busy), the
     cursor persisted in the SAME transaction as the rows it covers.
  3. Swap, one transaction: sampled verification, drop triggers, rename `ohlcv` ->
     `ohlcv_rowid_retired`, rename `ohlcv_clustered` -> `ohlcv`. Readers re-prepare; no
     file is replaced, so no connection anywhere can be left on a stale inode.
  4. Drop the retired table (its pages go to the freelist and are reused as the store
     grows; the file does not shrink without a VACUUM, which is deliberately not run).

GATES (safety, not a dark flag -- it runs by default on the serving tier):
  * quiet window only (`in_quiet_window`): overnight ET and weekends, never while the
    live store writes; a window that closes mid-copy pauses at the persisted cursor;
  * free disk >= `DISK_HEADROOM` x the file size (the new table is written beside the
    old until the swap);
  * `BARS_CLUSTER_ENABLED=0` stops it (kill switch).
"""
from __future__ import annotations

import logging
import os
import random
import shutil
import sqlite3
import threading
import time
from datetime import datetime, timedelta

_log = logging.getLogger(__name__)

CLUSTERED = "ohlcv_clustered"
RETIRED = "ohlcv_rowid_retired"
STATE = "_bars_cluster_state"
TRIGGERS = ("ohlcv_cluster_ai", "ohlcv_cluster_au", "ohlcv_cluster_ad")
_COLS = "ticker,tf,ts,o,h,l,c,v"
_NEW = "NEW.ticker,NEW.tf,NEW.ts,NEW.o,NEW.h,NEW.l,NEW.c,NEW.v"
_OLD_KEY = "ticker=OLD.ticker AND tf=OLD.tf AND ts=OLD.ts"

CHUNK_ROWS = int(os.environ.get("BARS_CLUSTER_CHUNK_ROWS", "20000"))
#: A chunk transaction longer than this halves the next chunk (writers never queue long).
CHUNK_BUDGET_S = float(os.environ.get("BARS_CLUSTER_CHUNK_BUDGET_S", "0.5"))
DISK_HEADROOM = float(os.environ.get("BARS_CLUSTER_DISK_HEADROOM", "0.8"))
VERIFY_SAMPLES = 200

_TRIGGER_DDL = (
    f"CREATE TRIGGER IF NOT EXISTS {TRIGGERS[0]} AFTER INSERT ON ohlcv BEGIN "
    f"INSERT OR REPLACE INTO {CLUSTERED}({_COLS}) VALUES ({_NEW}); END",
    f"CREATE TRIGGER IF NOT EXISTS {TRIGGERS[1]} AFTER UPDATE ON ohlcv BEGIN "
    f"DELETE FROM {CLUSTERED} WHERE {_OLD_KEY}; "
    f"INSERT OR REPLACE INTO {CLUSTERED}({_COLS}) VALUES ({_NEW}); END",
    f"CREATE TRIGGER IF NOT EXISTS {TRIGGERS[2]} AFTER DELETE ON ohlcv BEGIN "
    f"DELETE FROM {CLUSTERED} WHERE {_OLD_KEY}; END",
)

_status_lock = threading.Lock()
_status: dict = {"phase": None, "store_phase": None, "copied": 0, "chunks": 0, "max_chunk_ms": 0.0,
                 "last": None, "err": None, "started": None, "finished": None}


def status() -> dict:
    with _status_lock:
        return dict(_status)


def _set(**kw) -> None:
    with _status_lock:
        _status.update(kw)


def enabled() -> bool:
    return os.environ.get("BARS_CLUSTER_ENABLED", "1") != "0"


# ── layout ───────────────────────────────────────────────────────────────────
def _table_sql(conn: sqlite3.Connection, name: str) -> str | None:
    row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
                       (name,)).fetchone()
    return row[0] if row else None


def is_clustered_sql(sql: str | None) -> bool:
    return bool(sql) and "WITHOUT ROWID" in " ".join(sql.upper().split())


def layout(conn: sqlite3.Connection) -> str:
    """'clustered' | 'rowid' | 'absent' for the live `ohlcv` table."""
    sql = _table_sql(conn, "ohlcv")
    if sql is None:
        return "absent"
    return "clustered" if is_clustered_sql(sql) else "rowid"


def phase(conn: sqlite3.Connection) -> str:
    """Where a store is in the conversion -- derived from the schema, never remembered:
    'done' | 'absent' | 'pending' (rowid, not started) | 'copy' | 'retire'."""
    lay = layout(conn)
    if lay == "absent":
        return "absent"
    if _table_sql(conn, RETIRED) is not None:
        return "retire"
    if lay == "clustered":
        return "done"
    return "copy" if _table_sql(conn, CLUSTERED) is not None else "pending"


# ── gates ────────────────────────────────────────────────────────────────────
def in_quiet_window(now: datetime | None = None) -> bool:
    """True overnight ET (20:15 -> 03:45 next morning, Mon-Fri) and all weekend.

    The live store and the R2 merges write from the 04:00 pre-market to the 20:00 close
    of the post-market; the conversion's copy/swap/drop never overlaps them."""
    from zoneinfo import ZoneInfo
    et = (now or datetime.now(tz=ZoneInfo("UTC"))).astimezone(ZoneInfo("America/New_York"))
    minute = et.hour * 60 + et.minute
    if et.weekday() >= 5:                            # Saturday / Sunday
        return True
    return minute >= 20 * 60 + 15 or minute < 3 * 60 + 45


def disk_ok(db_path: str) -> tuple[bool, dict]:
    try:
        size = os.path.getsize(db_path)
        free = shutil.disk_usage(os.path.dirname(os.path.abspath(db_path)) or ".").free
    except OSError as e:
        return False, {"err": str(e)}
    need = int(size * DISK_HEADROOM) + (1 << 30)
    return free >= need, {"db_bytes": size, "free_bytes": free, "need_bytes": need}


# ── steps ────────────────────────────────────────────────────────────────────
def _connect(db_path: str) -> sqlite3.Connection:
    c = sqlite3.connect(db_path, timeout=30, isolation_level=None, check_same_thread=False)
    c.execute("PRAGMA busy_timeout=30000")
    return c


def _write_lock():
    from api.services import bars_sqlite
    return bars_sqlite._WRITE_LOCK


def _begin(conn: sqlite3.Connection) -> None:
    conn.execute("BEGIN IMMEDIATE")


def _prepare(conn: sqlite3.Connection) -> None:
    """Phase 1: the clustered table, the mirror triggers and the cursor -- atomically."""
    from api.services.bars_sqlite import ohlcv_ddl
    _begin(conn)
    try:
        conn.execute(ohlcv_ddl(CLUSTERED))
        conn.execute(f"CREATE TABLE IF NOT EXISTS {STATE} (k TEXT PRIMARY KEY, v)")
        for ddl in _TRIGGER_DDL:
            conn.execute(ddl)
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def _cursor(conn: sqlite3.Connection):
    rows = dict(conn.execute(f"SELECT k, v FROM {STATE}").fetchall())
    if "ticker" not in rows:
        return None
    return rows["ticker"], rows["tf"], int(rows["ts"])


def copy_chunk(conn: sqlite3.Connection, rows: int) -> int:
    """Copy the next `rows` keys (PK order) after the persisted cursor. Returns rows
    examined (0 = the copy is complete). Cursor and rows commit together."""
    _begin(conn)
    try:
        cur = _cursor(conn)
        where, args = ("", ()) if cur is None else ("WHERE (ticker, tf, ts) > (?, ?, ?)", cur)
        hi = conn.execute(
            f"SELECT ticker, tf, ts FROM ohlcv {where} ORDER BY ticker, tf, ts "
            f"LIMIT 1 OFFSET ?", args + (rows - 1,)).fetchone()
        if hi is None:      # fewer than `rows` keys left: take them all
            hi = conn.execute(
                f"SELECT ticker, tf, ts FROM ohlcv {where} ORDER BY ticker DESC, tf DESC, ts DESC "
                f"LIMIT 1", args).fetchone()
            if hi is None:
                conn.execute("COMMIT")
                return 0
        lo_sql = "" if cur is None else "(ticker, tf, ts) > (?, ?, ?) AND "
        before = conn.total_changes
        conn.execute(
            f"INSERT OR IGNORE INTO {CLUSTERED}({_COLS}) SELECT {_COLS} FROM ohlcv "
            # ORDER BY is load-bearing: it makes the planner range-scan the PK on the FULL
            # key; without it SQLite picks idx_ohlcv_lookup bounded on (ticker, tf) only,
            # re-reading a deep series from its start for every chunk inside it.
            f"WHERE {lo_sql}(ticker, tf, ts) <= (?, ?, ?) ORDER BY ticker, tf, ts",
            args + tuple(hi))
        n = conn.total_changes - before
        conn.executemany(f"INSERT OR REPLACE INTO {STATE}(k, v) VALUES (?, ?)",
                         (("ticker", hi[0]), ("tf", hi[1]), ("ts", int(hi[2]))))
        conn.execute("COMMIT")
        return max(n, 1)
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def _next(conn, sql: str, args: tuple):
    row = conn.execute(sql, args).fetchone()
    return row[0] if row else None


def _sample_pairs(conn: sqlite3.Connection, k: int, max_tickers: int = 50_000) -> list:
    """Up to `k` random (ticker, tf) pairs, found by PK seeks (never a scan)."""
    tickers, t = [], _next(conn, "SELECT MIN(ticker) FROM ohlcv", ())
    while t is not None and len(tickers) < max_tickers:
        tickers.append(t)
        t = _next(conn, "SELECT ticker FROM ohlcv WHERE ticker > ? ORDER BY ticker LIMIT 1", (t,))
    pairs = []
    for tkr in random.Random().sample(tickers, min(k, len(tickers))):
        tf = _next(conn, "SELECT MIN(tf) FROM ohlcv WHERE ticker=?", (tkr,))
        while tf is not None:
            pairs.append((tkr, tf))
            tf = _next(conn, "SELECT tf FROM ohlcv WHERE ticker=? AND tf > ? ORDER BY tf LIMIT 1",
                       (tkr, tf))
    return pairs


def verify(conn: sqlite3.Connection, k: int = VERIFY_SAMPLES) -> list:
    """(ticker, tf) pairs whose row count / newest key / close checksum differ between the
    two tables, read in ONE read transaction (a consistent snapshot: the mirror triggers
    change both tables atomically, so any difference is a real defect). Never blocks a
    writer (WAL)."""
    q = "SELECT COUNT(*), MAX(ts), TOTAL(c) FROM {} WHERE ticker=? AND tf=?"
    conn.execute("BEGIN")
    try:
        return [p for p in _sample_pairs(conn, k)
                if conn.execute(q.format("ohlcv"), p).fetchone()
                != conn.execute(q.format(CLUSTERED), p).fetchone()]
    finally:
        conn.execute("COMMIT")


def swap(conn: sqlite3.Connection) -> None:
    """Phase 3, one short transaction: the clustered table becomes `ohlcv`."""
    _begin(conn)
    try:
        for t in TRIGGERS:
            conn.execute(f"DROP TRIGGER IF EXISTS {t}")
        conn.execute(f"ALTER TABLE ohlcv RENAME TO {RETIRED}")
        conn.execute(f"ALTER TABLE {CLUSTERED} RENAME TO ohlcv")
        conn.execute(f"DROP TABLE IF EXISTS {STATE}")
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def retire(conn: sqlite3.Connection) -> None:
    """Phase 4: drop the old rowid table -- its secondary indexes first, each in its own
    transaction, so no single write-lock hold covers the whole multi-GB free."""
    names = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? "
        "AND name NOT LIKE 'sqlite_autoindex_%'", (RETIRED,)).fetchall()]
    stmts = [f'DROP INDEX IF EXISTS "{n}"' for n in names] + [f"DROP TABLE IF EXISTS {RETIRED}"]
    for sql in stmts:
        with _write_lock():
            _begin(conn)
            try:
                conn.execute(sql)
                conn.execute("COMMIT")
            except BaseException:
                conn.execute("ROLLBACK")
                raise


def abort(conn: sqlite3.Connection) -> None:
    """Undo a conversion that has not swapped yet (triggers, partial copy, cursor)."""
    _begin(conn)
    try:
        for t in TRIGGERS:
            conn.execute(f"DROP TRIGGER IF EXISTS {t}")
        conn.execute(f"DROP TABLE IF EXISTS {CLUSTERED}")
        conn.execute(f"DROP TABLE IF EXISTS {STATE}")
        conn.execute("COMMIT")
    except BaseException:
        conn.execute("ROLLBACK")
        raise


def run(db_path: str, *, may_continue=lambda: True, chunk_rows: int | None = None,
        pause_s: float = 0.02) -> str:
    """Drive the conversion as far as `may_continue()` allows. Returns the phase reached.
    Safe to call repeatedly / concurrently with any writer; resumes where it stopped."""
    size = max(1, int(chunk_rows or CHUNK_ROWS))
    lock = _write_lock()
    conn = _connect(db_path)
    try:
        ph = phase(conn)
        if ph in ("absent", "done"):
            return ph
        if ph == "pending":
            if not may_continue():
                return ph
            with lock:
                _prepare(conn)
            _set(phase="copy", started=time.time())
            ph = "copy"
        if ph == "copy":
            while True:
                if not may_continue():
                    return "copy"
                t0 = time.monotonic()
                with lock:
                    n = copy_chunk(conn, size)
                held = time.monotonic() - t0
                with _status_lock:
                    _status["copied"] += n
                    _status["chunks"] += 1
                    _status["max_chunk_ms"] = max(_status["max_chunk_ms"], held * 1000)
                    _status["last"] = time.time()
                if n == 0:
                    break
                if held > CHUNK_BUDGET_S and size > 1000:
                    size //= 2
                if pause_s:
                    time.sleep(pause_s)
            bad = verify(conn)
            if bad:
                _log.error("[bars-cluster] verification FAILED for %d pairs (e.g. %s) -- "
                           "conversion undone", len(bad), bad[:3])
                with lock:
                    abort(conn)
                _set(phase="aborted", err=f"verification failed: {bad[:3]}")
                return "aborted"
            with lock:
                swap(conn)
            _log.info("[bars-cluster] swapped: ohlcv is now clustered (WITHOUT ROWID)")
            ph = "retire"
        if ph == "retire":
            if not may_continue():
                return ph
            t0 = time.monotonic()
            retire(conn)                # takes the write lock per transaction
            _log.info("[bars-cluster] retired rowid table in %.1fs", time.monotonic() - t0)
        _set(phase="done", finished=time.time())
        return "done"
    finally:
        conn.close()


# ── background driver (serving tier) ─────────────────────────────────────────
_started = False
_started_lock = threading.Lock()


def start(startup_delay_s: float = 300.0, poll_s: float = 300.0) -> None:
    """Idempotent. Converts this process's bars.db in quiet windows, then exits."""
    global _started
    if not enabled():
        _log.info("[bars-cluster] disabled (BARS_CLUSTER_ENABLED=0)")
        return
    with _started_lock:
        if _started:
            return
        _started = True

    def _loop():
        from api.services import bars_sqlite
        time.sleep(startup_delay_s)
        while True:
            try:
                db = bars_sqlite._DB_PATH
                if not os.path.exists(db):
                    time.sleep(poll_s)
                    continue
                c = _connect(db)
                try:
                    _set(store_phase=phase(c))
                finally:
                    c.close()
                ok_disk, du = disk_ok(db)
                epoch = bars_sqlite._db_epoch

                def gate():
                    # Stop at once if the window closes, the switch flips, or bars.db is
                    # replaced wholesale (a snapshot install): never copy into a stale inode.
                    return enabled() and in_quiet_window() and bars_sqlite._db_epoch == epoch
                if not ok_disk:
                    _set(phase="waiting-disk", err=str(du))
                elif gate():
                    ph = run(db, may_continue=gate)
                    _set(phase=ph)
                    if ph in ("done", "absent"):
                        _log.info("[bars-cluster] store is clustered; driver exiting")
                        return
                    if ph == "aborted":     # a defect, not a condition: never loop on it
                        return
            except Exception as e:  # noqa: BLE001 -- runtime condition, retry next poll
                _set(err=str(e)[:200])
                _log.warning("[bars-cluster] step failed (will retry): %s", e)
            time.sleep(poll_s)

    threading.Thread(target=_loop, name="bars-cluster", daemon=True).start()
    _log.info("[bars-cluster] driver started (quiet-window conversion to WITHOUT ROWID)")
