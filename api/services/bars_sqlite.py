"""Persistent SQLite OHLCV bar store — WAL mode, thread-local connections.

ts encoding:
  Intraday (1/5/15/30/60): unix seconds (integer)
  Daily / Weekly / Monthly: YYYYMMDD integer (e.g. 20240115)

First request for a ticker: full API fetch (~4-8 s), stored forever.
Every subsequent request: delta fetch of only new bars (<200 ms).
"""
import logging
import os
import sqlite3
import threading
import time

_logger = logging.getLogger(__name__)

_DB_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
_local = threading.local()

# Corruption-recovery state. When put_bars hits "disk image is malformed"
# we kick off a one-shot background snapshot pull from R2. The lock + flag
# guard against concurrent triggers, and the cooldown prevents tight loops
# if the remote snapshot is also corrupt (we'd otherwise trigger recovery,
# pull a bad snapshot, fail again, trigger recovery, ...).
_recovery_lock = threading.Lock()
_recovery_active = False
_recovery_last_attempt = 0.0
_RECOVERY_COOLDOWN_SECONDS = 60.0

# In-process write serializer. SQLite allows exactly ONE writer; the
# worker prewarmer runs many fetch threads (P-1 raised the pool) plus
# detached bg_delta threads, and without this they all hit the DB at
# once → "database is locked", the retry/backoff burns time, and some
# writes get skipped (slowing the warm + log spam). Reads (get_bars /
# get_last_ts) stay LOCK-FREE — WAL allows concurrent readers — so this
# only orders writers, which SQLite was going to serialize anyway. Net:
# orderly in-process queueing instead of wasteful lock-collision churn.
# Per-process (web and worker are separate processes / separate DBs).
_WRITE_LOCK = threading.Lock()

# Connection epoch — bumped whenever /data/bars.db is replaced wholesale
# (currently: data_sync.download_snapshot when the web pulls a fresh
# snapshot from R2). Each thread caches its own (conn, epoch) pair in
# _local; on the first _conn() call after a bump, the cached connection
# is closed and a fresh one opens against the new inode.
#
# Why this exists: shutil.move atomically replaces the bars.db inode but
# does NOT close existing FDs. On Linux the old inode lingers as an
# unlinked-but-open file, and any thread holding a connection keeps
# reading it forever. Without this epoch check, snapshot pulls would
# silently have ZERO effect on the data the web actually serves.
_db_epoch = 0
_db_epoch_lock = threading.Lock()


def bump_db_epoch() -> None:
    """Mark every thread-local SQLite connection as stale.

    Call this immediately after replacing /data/bars.db. Every subsequent
    _conn() in any thread will close its cached connection and open a
    fresh one against the current inode."""
    global _db_epoch
    with _db_epoch_lock:
        _db_epoch += 1


def _conn() -> sqlite3.Connection:
    # Snapshot the global ONCE per call so a concurrent bump (single-writer:
    # only the puller calls bump_db_epoch) can't make us stamp an already-
    # stale epoch on the new connection. Worst-case: we miss a bump and the
    # NEXT call sees the gap and reconnects. Better than holding a connection
    # we believe is current when it's not.
    cur_epoch = _db_epoch
    if getattr(_local, "epoch", -1) != cur_epoch:
        # bars.db has been replaced since this thread last touched it.
        # Close the stale connection so a fresh one opens below.
        old = getattr(_local, "conn", None)
        if old is not None:
            try:
                old.close()
            except Exception:
                pass
        _local.conn = None
        _local.epoch = cur_epoch
    if getattr(_local, "conn", None) is None:
        c = sqlite3.connect(_DB_PATH, check_same_thread=False)
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        # busy_timeout = how long a contended writer WAITS before raising
        # OperationalError("database is locked"). This is context-aware:
        #
        #  • WEB (serves requests): keep 2s. A long wait here compounds
        #    with the put_bars retry loop and saturates the anyio thread
        #    pool — the documented reason 2s was chosen (a prior 10s
        #    setting → ~30s/request and a stalled site).
        #  • WORKER (background prewarmer, no latency SLA): 30s. It
        #    contends with its OWN 5-min full-DB backup (the uploader's
        #    sqlite .backup(), a separate connection outside _WRITE_LOCK)
        #    and rolling-deploy overlap. At 2s those contend-windows
        #    blew straight past the timeout → ~155 "database is locked"
        #    per 45s, each a wasted Massive fetch + a slower warm. The
        #    worker should simply WAIT it out and succeed.
        _busy_ms = 30000 if os.environ.get("WORKER_ENABLED") == "1" else 2000
        c.execute(f"PRAGMA busy_timeout={_busy_ms}")
        c.execute("PRAGMA cache_size=-8192")   # 8 MB page cache per connection
        c.execute("PRAGMA temp_store=MEMORY")
        _local.conn = c
    return _local.conn


def init_db() -> None:
    c = _conn()
    c.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv (
            ticker TEXT NOT NULL,
            tf     TEXT NOT NULL,
            ts     INTEGER NOT NULL,
            o REAL, h REAL, l REAL, c REAL, v INTEGER,
            PRIMARY KEY (ticker, tf, ts)
        )
    """)
    c.execute(
        "CREATE INDEX IF NOT EXISTS idx_ohlcv_lookup ON ohlcv(ticker, tf, ts DESC)"
    )
    # Provenance metadata: which source produced each bar and when.
    # Sibling table to ohlcv (same primary key) so existing query paths
    # don't need to change. Populated by put_bars callers that pass a
    # ``source`` argument; legacy callers leave it unpopulated. Future
    # audit logic joins ohlcv ⨝ bars_provenance to report "this bad bar
    # came from yfinance fallback at fetched_at=..." which collapses
    # debugging from "guess which source" to a one-query answer.
    c.execute("""
        CREATE TABLE IF NOT EXISTS bars_provenance (
            ticker     TEXT NOT NULL,
            tf         TEXT NOT NULL,
            ts         INTEGER NOT NULL,
            source     TEXT NOT NULL,
            fetched_at INTEGER NOT NULL,
            PRIMARY KEY (ticker, tf, ts)
        )
    """)
    c.execute(
        "CREATE INDEX IF NOT EXISTS idx_provenance_source "
        "ON bars_provenance(source)"
    )
    # ── One-time migration: purge tf='60' rows seeded before the
    # session-aligned hourly resample feature shipped (commit 2f42e55,
    # 2026-05-01). Pre-feature rows merged the 9:00 pre-market bar with
    # the 9:30 RTH-open bar into one 9:00 bucket, persisting incorrect
    # bars after the fix. Marker row records that the migration ran.
    c.execute("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER)")
    # Each migration tuple: (name, sql_to_run). Runs once per name. Add a new
    # entry whenever the upstream intraday fetch path changes so existing
    # cached rows get re-fetched through the corrected code path.
    _migrations = [
        ("purge_tf60_2f42e55",            "DELETE FROM ohlcv WHERE tf='60'"),
        ("purge_tf60_3cbe1cf_src_cap",    "DELETE FROM ohlcv WHERE tf='60'"),
        # Pagination support (this commit) gives every intraday TF full history
        # instead of the truncated/stale 30-day window. Repurge ALL intraday
        # rows so they re-fetch through the paginated path.
        ("purge_intraday_pagination_v1",  "DELETE FROM ohlcv WHERE tf IN ('1','5','15','30','60')"),
    ]
    for migration_name, sql in _migrations:
        already = c.execute("SELECT 1 FROM _migrations WHERE name=?", (migration_name,)).fetchone()
        if not already:
            try:
                cur = c.execute(sql)
                c.execute("INSERT INTO _migrations(name, applied_at) VALUES (?, ?)",
                          (migration_name, int(__import__('time').time())))
                print(f"[sqlite-migration] Applied {migration_name}: deleted {cur.rowcount} rows")
            except Exception:
                pass
    c.commit()


def delete_bars(ticker: str | None = None, tf: str | None = None) -> int:
    """Delete rows by (ticker, tf). Either may be None to wildcard.
    Returns rows deleted."""
    c = _conn()
    if ticker and tf:
        cur = c.execute("DELETE FROM ohlcv WHERE ticker=? AND tf=?", (ticker.upper(), tf))
    elif tf:
        cur = c.execute("DELETE FROM ohlcv WHERE tf=?", (tf,))
    elif ticker:
        cur = c.execute("DELETE FROM ohlcv WHERE ticker=?", (ticker.upper(),))
    else:
        cur = c.execute("DELETE FROM ohlcv")
    c.commit()
    return cur.rowcount


def purge_mis_keyed_weekly_rows() -> int:
    """Delete weekly rows whose date key is not the FRIDAY of its ISO week.

    Weekly candles are keyed to the calendar Friday of their ISO week
    (commit e9c75603) — under that scheme a non-Friday `tf='W'` key can only
    be a leftover from the old Monday keying. Because the date IS the primary
    key, stale Monday rows coexist with the Friday rows every fetch writes,
    and the chart shows two identical candles per week.

    Content-based and idempotent on purpose: the original flag-gated one-shot
    heal only ran in api.main's lifespan, so the worker's bars.db kept its
    Monday rows and every R2 snapshot pull re-poisoned the web pod while the
    flag file blocked a re-heal. This runs at EVERY boot on BOTH services and
    after snapshot restores — a clean DB costs one DISTINCT scan (~ms).

    Returns rows deleted.
    """
    import datetime as _dt

    c = _conn()
    rows = c.execute("SELECT DISTINCT ts FROM ohlcv WHERE tf='W'").fetchall()
    bad: list[int] = []
    for (ts,) in rows:
        s = str(ts)
        if len(s) != 8:
            bad.append(ts)  # not a YYYYMMDD key — malformed for a date TF
            continue
        try:
            d = _dt.date(int(s[:4]), int(s[4:6]), int(s[6:]))
        except ValueError:
            bad.append(ts)
            continue
        if d.weekday() != 4:  # 4 = Friday
            bad.append(ts)
    if not bad:
        return 0
    deleted = 0
    with _WRITE_LOCK:
        # Chunk the IN() list to stay far below SQLite's parameter limit.
        for i in range(0, len(bad), 500):
            chunk = bad[i:i + 500]
            qs = ",".join("?" for _ in chunk)
            cur = c.execute(f"DELETE FROM ohlcv WHERE tf='W' AND ts IN ({qs})", chunk)
            deleted += cur.rowcount
        c.commit()
    if deleted:
        _logger.info(f"[sqlite] purge_mis_keyed_weekly_rows: deleted {deleted} stale weekly rows")
    return deleted


def get_last_ts(ticker: str, tf: str) -> int | None:
    """Return the largest stored ts for (ticker, tf), or None if no rows."""
    row = _conn().execute(
        "SELECT MAX(ts) FROM ohlcv WHERE ticker=? AND tf=?",
        (ticker.upper(), tf),
    ).fetchone()
    return row[0] if row and row[0] is not None else None


def get_count(ticker: str, tf: str) -> int:
    row = _conn().execute(
        "SELECT COUNT(*) FROM ohlcv WHERE ticker=? AND tf=?",
        (ticker.upper(), tf),
    ).fetchone()
    return row[0] if row else 0


def get_bars(ticker: str, tf: str, max_bars: int) -> list[tuple]:
    """Return up to max_bars rows as (ts, o, h, l, c, v), oldest-first."""
    return _conn().execute(
        """SELECT ts,o,h,l,c,v FROM (
               SELECT ts,o,h,l,c,v FROM ohlcv
               WHERE ticker=? AND tf=?
               ORDER BY ts DESC LIMIT ?
           ) ORDER BY ts ASC""",
        (ticker.upper(), tf, max_bars),
    ).fetchall()


def get_bars_since(ticker: str, tf: str, since_ts: int) -> list[tuple]:
    """Return bars with ts > since_ts, oldest-first (for browser delta sync)."""
    return _conn().execute(
        "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? AND ts>? ORDER BY ts ASC",
        (ticker.upper(), tf, since_ts),
    ).fetchall()


def get_all_tickers() -> list[tuple]:
    """Return all (ticker, tf) pairs that have at least one row stored, ordered by ticker."""
    return _conn().execute(
        "SELECT DISTINCT ticker, tf FROM ohlcv ORDER BY ticker, tf"
    ).fetchall()


def put_provenance(
    ticker: str, tf: str, timestamps: list[int],
    source: str, fetched_at: int | None = None,
) -> int:
    """Record provenance for a batch of bars (one source per call).

    Pairs with put_bars: each ``ts`` in ``timestamps`` should correspond
    to a row that was just upserted into ohlcv. The (ticker, tf, ts)
    primary key matches between the two tables so a JOIN reads cleanly.

    fetched_at defaults to "now" — pass an explicit value when recording
    historical provenance (e.g. backfilling from a snapshot whose actual
    fetch time you want to preserve).

    Returns rows inserted/replaced. INSERT OR REPLACE so calling twice
    for the same (ticker, tf, ts) updates the source/fetched_at — useful
    when a higher-priority source replaces a fallback bar.
    """
    if not timestamps:
        return 0
    if fetched_at is None:
        fetched_at = int(time.time())
    ticker_up = ticker.upper()
    rows = [(ticker_up, tf, int(ts), source, int(fetched_at)) for ts in timestamps]
    last_lock_err: sqlite3.OperationalError | None = None
    for attempt in range(3):
        try:
            with _WRITE_LOCK:
                c = _conn()
                c.executemany(
                    "INSERT OR REPLACE INTO bars_provenance"
                    "(ticker,tf,ts,source,fetched_at) VALUES(?,?,?,?,?)",
                    rows,
                )
                c.commit()
            return len(rows)
        except sqlite3.OperationalError as e:
            if "locked" not in str(e).lower():
                raise
            last_lock_err = e
            time.sleep(0.05 * (attempt + 1))
            continue
    if last_lock_err is not None:
        raise last_lock_err
    return 0  # unreachable


def get_provenance(ticker: str, tf: str, ts: int) -> dict | None:
    """Return (source, fetched_at) for one bar, or None if no row exists.

    Used by debugging endpoints and the audit pipeline when reporting
    "this bar came from {source} at {fetched_at}". Cheap point lookup
    via primary key."""
    row = _conn().execute(
        "SELECT source, fetched_at FROM bars_provenance "
        "WHERE ticker=? AND tf=? AND ts=?",
        (ticker.upper(), tf, int(ts)),
    ).fetchone()
    if row is None:
        return None
    return {"source": row[0], "fetched_at": int(row[1])}


def get_provenance_summary(ticker: str, tf: str) -> dict:
    """Return per-source counts for a (ticker, tf). Useful for spot-checking
    "are most of this ticker's bars from the canonical source or did
    yfinance fallback fire heavily?". Empty dict if no provenance recorded."""
    rows = _conn().execute(
        "SELECT source, COUNT(*) FROM bars_provenance "
        "WHERE ticker=? AND tf=? GROUP BY source",
        (ticker.upper(), tf),
    ).fetchall()
    return {row[0]: row[1] for row in rows}


def integrity_ok() -> bool:
    """Return True if /data/bars.db passes ``PRAGMA integrity_check``.

    Used at startup to detect "disk image is malformed" corruption before
    any handler tries to write. Returns:
      - True if the file does not exist (init_db will create a fresh DB)
      - True if integrity_check returns "ok"
      - False if integrity_check returns anything else, or if SQLite cannot
        even open the file (which itself indicates structural corruption).

    Opens a one-off connection (not the thread-local cached one) so a
    failed check doesn't poison subsequent normal operation.
    """
    if not os.path.exists(_DB_PATH):
        return True
    try:
        c = sqlite3.connect(_DB_PATH, timeout=10)
        try:
            row = c.execute("PRAGMA integrity_check").fetchone()
            return bool(row and row[0] == "ok")
        finally:
            c.close()
    except sqlite3.DatabaseError as e:
        _logger.error(f"[sqlite] integrity_check failed to open bars.db: {e}")
        return False


def _is_malformed_error(exc: BaseException) -> bool:
    """True if the SQLite exception indicates on-disk corruption.

    ``database disk image is malformed`` is the canonical message; we also
    match the lowercase substring as a defense against minor wording
    changes between SQLite versions."""
    msg = str(exc).lower()
    return "malformed" in msg


def _drop_local_conn() -> None:
    """Close and forget this thread's cached SQLite connection.

    Called after a malformed-image error so the next ``_conn()`` call (after
    recovery has bumped the epoch) opens a fresh handle to the replaced
    inode instead of reusing the poisoned one."""
    c = getattr(_local, "conn", None)
    if c is not None:
        try:
            c.close()
        except Exception:
            pass
    _local.conn = None


def _trigger_corruption_recovery() -> None:
    """Spawn a one-shot background recovery: pull a fresh snapshot from R2
    and atomically replace bars.db (which also bumps the epoch, refreshing
    every thread's connection on next use).

    No-op if a recovery is already in flight, if one finished within the
    last ``_RECOVERY_COOLDOWN_SECONDS``, or if the recovery is gated off
    via env var (default OFF — see below).

    GATED 2026-05-08: while the worker prewarmer is broken, the R2 snapshot
    is itself stale (last upload from worker frozen at some past point).
    A malformed-image error on the WEB then triggers force_resync, which
    REPLACES the web's local bars.db with R2's stale snapshot — rolling
    back hours of fresh data we already wrote correctly. Symptom: large
    cluster of tickers stuck at the exact same recent timestamp.

    Until the worker is fixed AND R2 sync is switched to per-bar MERGE
    semantics (INSERT OR IGNORE), default this OFF. With the gate off,
    malformed-image errors propagate to put_bars callers which log + retry
    on next request; local data is preserved.

    Set ``R2_RECOVERY_ENABLED=1`` to re-enable when R2 is trustworthy.
    """
    global _recovery_active, _recovery_last_attempt
    if os.environ.get("R2_RECOVERY_ENABLED", "0") != "1":
        _logger.warning(
            "[sqlite] malformed-image detected but R2_RECOVERY_ENABLED!=1; "
            "skipping force_resync to preserve local data. Set "
            "R2_RECOVERY_ENABLED=1 to re-enable when R2 snapshot is fresh."
        )
        return
    with _recovery_lock:
        now = time.time()
        if _recovery_active:
            return
        if now - _recovery_last_attempt < _RECOVERY_COOLDOWN_SECONDS:
            return
        _recovery_active = True
        _recovery_last_attempt = now

    def _run() -> None:
        global _recovery_active
        try:
            _logger.error(
                "[sqlite] corruption detected — pulling fresh snapshot from R2"
            )
            try:
                # Late import: data_sync imports bars_sqlite indirectly via
                # bump_db_epoch, so a top-level import here would create a
                # cycle at module-load time. Importing inside the recovery
                # thread is safe because the modules are fully loaded by
                # the time any put_bars call has fired.
                from api.services import data_sync
            except Exception as e:
                _logger.exception(f"[sqlite] cannot import data_sync: {e}")
                return
            try:
                ok = data_sync.force_resync()
            except Exception as e:
                _logger.exception(f"[sqlite] force_resync raised: {e}")
                return
            if ok:
                _logger.info("[sqlite] recovery succeeded — bars.db restored from R2")
            else:
                _logger.error(
                    "[sqlite] recovery FAILED — no usable snapshot available; "
                    "manual intervention required"
                )
        finally:
            with _recovery_lock:
                _recovery_active = False

    threading.Thread(
        target=_run, daemon=True, name="sqlite-recovery"
    ).start()


def put_bars(ticker: str, tf: str, bars: list[dict], date_tf: bool = False) -> int:
    """Upsert bars.  date_tf=True means bar["t"] is 'YYYY-MM-DD' → YYYYMMDD int.
    Returns number of rows inserted/replaced.

    On ``OperationalError: database is locked`` retries up to 3 times with
    short backoff (busy_timeout already gives 10s of in-driver waiting; the
    extra retries cover edge cases like ``BEGIN IMMEDIATE`` failing fast).
    On ``DatabaseError: disk image is malformed`` schedules a background
    recovery (snapshot re-pull from R2) and re-raises so the caller's
    exception handler can return an empty result for this single request.
    """
    if not bars:
        return 0
    ticker = ticker.upper()
    rows = []
    for b in bars:
        t = b.get("t", 0)
        ts = int(str(t).replace("-", "")) if date_tf else int(t)
        rows.append((
            ticker, tf, ts,
            b.get("o"), b.get("h"), b.get("l"), b.get("c"),
            int(b.get("v") or 0),
        ))

    last_lock_err: sqlite3.OperationalError | None = None
    for attempt in range(3):
        try:
            with _WRITE_LOCK:
                c = _conn()
                c.executemany(
                    "INSERT OR REPLACE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)",
                    rows,
                )
                c.commit()
            return len(rows)
        except sqlite3.OperationalError as e:
            # OperationalError covers "locked" (contention) and a few non-
            # corruption cases; only retry the locked variant. Other
            # OperationalErrors propagate immediately so callers see them.
            if "locked" not in str(e).lower():
                raise
            last_lock_err = e
            time.sleep(0.05 * (attempt + 1))
            continue
        except sqlite3.DatabaseError as e:
            if _is_malformed_error(e):
                _logger.error(
                    f"[sqlite] put_bars hit malformed image for {ticker} tf={tf}; "
                    f"scheduling recovery"
                )
                _trigger_corruption_recovery()
                _drop_local_conn()
            raise

    if last_lock_err is not None:
        raise last_lock_err
    return 0  # unreachable
