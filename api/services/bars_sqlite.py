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
        #  • BARS-API (dedicated serving tier, BARS_API_ENABLED): worker-LIKE.
        #    Its cold-fetch CACHE write runs on a BACKGROUND pool (off the anyio
        #    request thread), it does NOT run the web pod's reconciliation/audit
        #    writers, and it has 32GB headroom. At the web 2s timeout every
        #    cold-fetch write LOST its collision with the 30s R2-merge and failed
        #    "database is locked" → obscure long-tail tickers never cached (17-20s
        #    on every view, forever). It must WAIT the merge out and succeed.
        _is_worker = os.environ.get("WORKER_ENABLED") == "1"
        _bg_tier = _is_worker or os.environ.get("BARS_API_ENABLED") == "1"
        _busy_ms = 30000 if _bg_tier else 2000
        c.execute(f"PRAGMA busy_timeout={_busy_ms}")
        # Per-connection page cache is CONTEXT-AWARE (2026-07-03):
        #  • WEB serves requests on up to 64 anyio threads, each with its own
        #    connection. At the old -8192 (8 MB) that is up to 64 × 8 = 512 MB of
        #    page cache alone on a 512 MB pod — which surfaces as latency spikes /
        #    OOM (not clean errors) under a chart-load soak. Drop web to -2048
        #    (2 MB); the mmap below + the OS page cache cover the working set, so
        #    warm read latency is unchanged while RSS pressure drops ~4×.
        #  • WORKER (few long-lived prewarm threads, more headroom, heavy writes)
        #    keeps the larger 8 MB cache.
        c.execute(f"PRAGMA cache_size={-8192 if _bg_tier else -2048}")
        # Memory-map the DB so reads fault pages straight from the OS page cache
        # instead of per-read read() syscalls into the per-connection cache. On a
        # multi-GB bars.db this materially cuts read latency and lets the smaller
        # web cache_size above lean on shared, evictable, file-backed pages rather
        # than private RSS. 256 MB cap keeps the mapped window bounded on the pod.
        c.execute("PRAGMA mmap_size=268435456")
        c.execute("PRAGMA temp_store=MEMORY")
        _local.conn = c
    return _local.conn


LOOKUP_INDEX = "idx_ohlcv_lookup"
DAILY_BYDATE_INDEX = "idx_ohlcv_daily_bydate"

#: ⭐ THE ONE AUTHORITY over which indexes a bars.db is expected to carry, name -> DDL.
#:
#: ⛔⛔ INCIDENT 2026-10-02: the worker's R2 snapshot is a backup-API copy of the
#: WORKER's bars.db, and the worker never ran the web-only by-date build -- so the
#: snapshot arrived WITHOUT `idx_ohlcv_daily_bydate`, and every web boot after the
#: install started a 31 GB `CREATE INDEX` that held the write lock for ~13 min.
#: `data_sync._make_tarball` now creates every index named HERE on the snapshot
#: copy before it ships, so an install can never arrive short of one, and
#: `init_db` / `ensure_daily_bydate_index` read their DDL from HERE rather than
#: restating it. A new index added anywhere in this module without an entry here
#: fails `tests/test_bars_snapshot_carries_indexes.py` by name.
BARS_INDEX_DDL = {
    LOOKUP_INDEX: (
        f"CREATE INDEX IF NOT EXISTS {LOOKUP_INDEX} ON ohlcv(ticker, tf, ts DESC)"
    ),
    DAILY_BYDATE_INDEX: (
        f"CREATE INDEX IF NOT EXISTS {DAILY_BYDATE_INDEX} "
        "ON ohlcv(ts, ticker, c) WHERE tf='D'"
    ),
}

# One-time migrations: (name, sql_to_run). Runs once per name. Add a new entry
# whenever the upstream intraday fetch path changes so existing cached rows get
# re-fetched through the corrected code path.
_MIGRATIONS = (
    ("purge_tf60_2f42e55",            "DELETE FROM ohlcv WHERE tf='60'"),
    ("purge_tf60_3cbe1cf_src_cap",    "DELETE FROM ohlcv WHERE tf='60'"),
    # Pagination support gives every intraday TF full history instead of the
    # truncated/stale 30-day window. Repurge ALL intraday rows so they re-fetch
    # through the paginated path.
    ("purge_intraday_pagination_v1",  "DELETE FROM ohlcv WHERE tf IN ('1','5','15','30','60')"),
)
MIGRATION_NAMES = tuple(name for name, _sql in _MIGRATIONS)


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
    c.execute(BARS_INDEX_DDL[LOOKUP_INDEX])
    # ⚰️ `bars_provenance` LIVED HERE UNTIL 2026-08-09 AND ITS COMMENT PROMISED
    # A DEBUGGING AFFORDANCE THAT NEVER EXISTED. It said future audit logic
    # "joins ohlcv ⨝ bars_provenance to report 'this bad bar came from yfinance
    # fallback at fetched_at=…', which collapses debugging from 'guess which
    # source' to a one-query answer." Measured: the table held 0 rows,
    # `put_provenance` had 8 call sites and all 8 were in `bars_sqlite_test.py`,
    # and `get_provenance_summary` had none anywhere (AST over 1,798 files, not
    # a grep). Nothing in the product ever wrote a row, so the join it described
    # would have returned nothing on every bar it was ever asked about.
    #
    # ⛔ AND IT WAS ONE CHARACTER FROM THE REAL THING. `api/services/
    # bar_provenance.py` — SINGULAR — is the live system: `bars_disk_cache.put`
    # records every clean bar through it and `/api/admin/bars/provenance` and
    # `/api/admin/bars/source-health` read it. That is the affordance this
    # comment described, already built, next door.
    #
    # ⛔ SO IT WAS DELETED, NOT WIRED. Wiring it would have put a second
    # authority over "where did this bar come from" — two tables, one fact, and
    # a reader with no way to know which one lied. This repo's most repeated
    # defect, and a plausible-looking comment is exactly how it gets built.
    #
    # ⚠️ EXISTING `bars.db` FILES STILL CARRY THE EMPTY TABLE. No DROP is issued
    # here: it is 0 rows and inert, and a destructive migration to reclaim
    # nothing is a worse trade than a vestigial table.
    # ── One-time migration: purge tf='60' rows seeded before the
    # session-aligned hourly resample feature shipped (commit 2f42e55,
    # 2026-05-01). Pre-feature rows merged the 9:00 pre-market bar with
    # the 9:30 RTH-open bar into one 9:00 bucket, persisting incorrect
    # bars after the fix. Marker row records that the migration ran.
    _create_meta_tables(c)
    c.execute("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER)")
    _wholesale = False
    for migration_name, sql in _MIGRATIONS:
        already = c.execute("SELECT 1 FROM _migrations WHERE name=?", (migration_name,)).fetchone()
        if not already:
            try:
                cur = c.execute(sql)
                c.execute("INSERT INTO _migrations(name, applied_at) VALUES (?, ?)",
                          (migration_name, int(__import__('time').time())))
                print(f"[sqlite-migration] Applied {migration_name}: deleted {cur.rowcount} rows")
                _wholesale = _wholesale or bool(cur.rowcount)
            except Exception:
                pass
    c.commit()
    if _wholesale:
        bump_store_floor("init_db migration")


# ── SERIES META: series_rev + verified_through, IN THE STORE (P1 bar contract) ──
# ⭐ Contract: docs/architecture/bar-contract.md. One row per STORED series
# (ticker, tf). A chart session never selects different stored rows (rth/eth read the
# same 1-30m rows; the ETH 60m grid is derived from 15m), so (ticker, tf, session) maps
# onto exactly one stored series — `bar_contract.source_series`.
#
#   rev               hybrid-logical-clock MILLISECONDS: every committed write that
#                     touches the series' rows sets rev = max(rev + 1, now_ms) IN THE
#                     SAME TRANSACTION as the rows. Monotonic; ms-valued so a rev also
#                     says "as of when".
#   verified_through  unix seconds: the provider (or the live stream) was asked at this
#                     instant and every row it returned had already reached this store.
#                     Written write-behind (batched, `flush_meta`), max()-merged.
#   proof_floor       unix seconds: a DELETE of the series' rows invalidates every proof
#                     taken before it (verified_through is cleared and a late flush of an
#                     older proof is refused).
#
# ⛔ ONE WRITER RULE. Row writers go through `bump_series_revs` inside their own
# transaction; wholesale writers (snapshot install, bulk heals that delete across
# series) call `bump_store_floor`. `tests/test_bar_contract.py` holds a census rail:
# a new `INTO ohlcv` / `DELETE FROM ohlcv` site that calls neither fails by name.
# ⚖️ Why not an SQLite trigger: measured 2026-11-11, a per-row AFTER INSERT trigger
# made a 4M-row bulk load ~6x slower (25 s -> 156 s), and the R2 merge is exactly that
# shape. One upsert per (series, transaction) costs one extra row per write.
_META_DDL = (
    "CREATE TABLE IF NOT EXISTS series_meta ("
    " ticker TEXT NOT NULL, tf TEXT NOT NULL,"
    " rev INTEGER NOT NULL DEFAULT 0,"
    " history_rev INTEGER NOT NULL DEFAULT 0,"
    " verified_through REAL,"
    " sealed_through REAL,"
    " sealed_checked_at REAL,"
    " unsealed_from INTEGER,"
    " proof_floor REAL,"
    " PRIMARY KEY (ticker, tf)) WITHOUT ROWID",
    "CREATE TABLE IF NOT EXISTS store_meta (k TEXT PRIMARY KEY, v REAL)",
)
# `history_rev`: the rev of the newest write that changed SEALED history — a row older
# than the series' stored tail, or the tail itself once proven (`_history_keys`), or any
# delete. A client holding history_rev H only needs `since=` deltas while H is current;
# a newer history_rev means re-read the window (a correction: split re-adjust, heal,
# merge correction, reconciliation).
_REV_SET = "rev = max(series_meta.rev + 1, excluded.rev)"
_HIST_SET = "history_rev = max(series_meta.rev + 1, excluded.rev)"
_REV_UPSERT_SQL = (
    "INSERT INTO series_meta(ticker, tf, rev) VALUES (?, ?, ?) "
    f"ON CONFLICT(ticker, tf) DO UPDATE SET {_REV_SET}")
_REV_HISTORY_UPSERT_SQL = (
    "INSERT INTO series_meta(ticker, tf, rev, history_rev) VALUES (?, ?, ?, ?) "
    f"ON CONFLICT(ticker, tf) DO UPDATE SET {_REV_SET}, {_HIST_SET}")
_REV_DELETE_UPSERT_SQL = (
    "INSERT INTO series_meta(ticker, tf, rev, history_rev, proof_floor, unsealed_from) "
    "VALUES (?, ?, ?, ?, ?, ?) "
    f"ON CONFLICT(ticker, tf) DO UPDATE SET {_REV_SET}, {_HIST_SET}, "
    "verified_through = NULL, sealed_through = NULL, sealed_checked_at = NULL, "
    "proof_floor = excluded.proof_floor, unsealed_from = CASE "
    " WHEN excluded.unsealed_from IS NULL THEN series_meta.unsealed_from "
    " WHEN series_meta.unsealed_from IS NULL THEN excluded.unsealed_from "
    " ELSE min(series_meta.unsealed_from, excluded.unsealed_from) END")
_VERIFIED_UPSERT_SQL = (
    "INSERT INTO series_meta(ticker, tf, rev, verified_through) VALUES (?, ?, 0, ?) "
    "ON CONFLICT(ticker, tf) DO UPDATE SET verified_through = CASE "
    " WHEN excluded.verified_through <= COALESCE(series_meta.proof_floor, 0) "
    "   THEN series_meta.verified_through "
    " ELSE max(COALESCE(series_meta.verified_through, 0), excluded.verified_through) END")
#: `sealed_through` (unix s): every bucket of the series that ENDED at or before it is
#: final in this store. Advanced only by a provider answer whose rewritten window
#: STARTS at or before the current value (a contiguous proof), to its instant minus the
#: seal lag (`record_sealed`). A series with no value yet trusts the rows below the
#: window: they are the repair's own "already-final history" (`_DELTA_HEAL_WINDOW_SECONDS`).
#: When a seal applies (same rule as `_apply_seal`): its check is newer than the last
#: delete and than the current seal's check, and its rewritten window starts at or before
#: the current seal — or, with no seal, at or before the oldest row deleted since
#: (`unsealed_from`; NULL = nothing was deleted, so the rows below the window are the
#: repair's own already-final history).
_SEAL_OK = (
    "(:checked > COALESCE(series_meta.proof_floor, 0) "
    " AND :checked >= COALESCE(series_meta.sealed_checked_at, 0) "
    " AND ((series_meta.sealed_through IS NOT NULL AND :wstart <= series_meta.sealed_through) "
    "   OR (series_meta.sealed_through IS NULL AND (series_meta.unsealed_from IS NULL "
    "       OR :wstart <= series_meta.unsealed_from))))")
_SEAL_UPSERT_SQL = (
    "INSERT INTO series_meta(ticker, tf, rev, sealed_through, sealed_checked_at) "
    "VALUES (:t, :tf, 0, :sealed, :checked) "
    "ON CONFLICT(ticker, tf) DO UPDATE SET "
    f"sealed_through = CASE WHEN {_SEAL_OK} "
    "  THEN max(COALESCE(series_meta.sealed_through, 0), :sealed) ELSE series_meta.sealed_through END, "
    f"sealed_checked_at = CASE WHEN {_SEAL_OK} THEN :checked ELSE series_meta.sealed_checked_at END, "
    f"unsealed_from = CASE WHEN {_SEAL_OK} THEN NULL ELSE series_meta.unsealed_from END")
#: store_meta keys: wholesale-change floors (see `bump_store_floor`).
REV_FLOOR_KEY = "rev_floor_ms"
PROOF_FLOOR_KEY = "proof_floor_s"


def _create_meta_tables(c: sqlite3.Connection) -> None:
    for ddl in _META_DDL:
        c.execute(ddl)
    cols = {row[1] for row in c.execute("PRAGMA table_info(series_meta)").fetchall()}
    if "history_rev" not in cols:      # a pre-release dev store
        c.execute("ALTER TABLE series_meta ADD COLUMN history_rev INTEGER NOT NULL DEFAULT 0")
    for col, typ in (("sealed_through", "REAL"), ("sealed_checked_at", "REAL"),
                     ("unsealed_from", "INTEGER")):
        if col not in cols:
            c.execute(f"ALTER TABLE series_meta ADD COLUMN {col} {typ}")


_hlc_lock = threading.Lock()
_hlc_last_ms = 0


def _now_ms() -> int:
    """This process's hybrid-logical clock in ms: wall time, but strictly increasing
    across calls (two writes in one millisecond still get distinct, ordered revs)."""
    global _hlc_last_ms
    with _hlc_lock:
        _hlc_last_ms = max(_hlc_last_ms + 1, int(time.time() * 1000))
        return _hlc_last_ms


def bump_series_revs(c: sqlite3.Connection, keys, *, deleted: bool = False,
                     history=(), deleted_from=None) -> None:
    """Advance `rev` of every (ticker, tf) in `keys` INSIDE the caller's open write
    transaction (same commit as the rows). `history` = the keys whose write changed
    sealed history (`True` = all of them); `deleted=True` implies history for every key
    and invalidates the series' proofs; `deleted_from` = the OLDEST deleted key (int, or
    {(ticker, tf): int}) — a later seal must reach back to it (`unsealed_from`). None =
    every row of the series went (or a full rebuild), nothing below to distrust.
    Self-heals a store that predates the meta table."""
    keys = sorted({(str(t).upper(), str(tf)) for t, tf in keys})
    if not keys:
        return
    if history is True or deleted:
        hist = set(keys)
    else:
        hist = {(str(t).upper(), str(tf)) for t, tf in (history or ())}
    now_ms = _now_ms()
    batches = []
    if deleted:
        now_s = time.time()
        def _from(t, tf):
            if isinstance(deleted_from, dict):
                v = deleted_from.get((t, tf), deleted_from.get((t.lower(), tf)))
                if v is None:
                    v = next((x for (a, b), x in deleted_from.items()
                              if str(a).upper() == t and str(b) == tf), None)
                return None if v is None else int(v)
            return None if deleted_from is None else int(deleted_from)
        batches.append((_REV_DELETE_UPSERT_SQL,
                        [(t, tf, now_ms, now_ms, now_s, _from(t, tf)) for t, tf in keys]))
    else:
        h = [(t, tf, now_ms, now_ms) for t, tf in keys if (t, tf) in hist]
        p = [(t, tf, now_ms) for t, tf in keys if (t, tf) not in hist]
        if h:
            batches.append((_REV_HISTORY_UPSERT_SQL, h))
        if p:
            batches.append((_REV_UPSERT_SQL, p))
    for sql, params in batches:
        try:
            c.executemany(sql, params)
        except sqlite3.OperationalError as e:
            msg = str(e).lower()
            if "no such table" not in msg and "no column" not in msg and "has no column" not in msg:
                raise
            _create_meta_tables(c)
            c.executemany(sql, params)
    if deleted:
        _drop_pending_verified(keys)


def _differs(old: tuple, new: tuple) -> bool:
    for a, b in zip(old, new):
        if a is None or b is None:
            if a is not b:
                return True
        elif abs(float(a) - float(b)) > 1e-9 * max(1.0, abs(float(b))):
            return True
    return False


def _sealed_through_many(c: sqlite3.Connection, tf: str, tickers: list) -> dict:
    """{TICKER: sealed_through} (as `series_meta` states it) for many series at once."""
    rows = {}
    _rev_floor, store_pfloor = _store_floors(c)
    for i in range(0, len(tickers), 400):
        chunk = tickers[i:i + 400]
        qs = ",".join("?" for _ in chunk)
        try:
            for t, sealed, ck, uns, pf in c.execute(
                    f"SELECT ticker, sealed_through, sealed_checked_at, unsealed_from, proof_floor "
                    f"FROM series_meta WHERE tf=? AND ticker IN ({qs})", [tf, *chunk]).fetchall():
                rows[t] = (sealed, ck, uns, max(store_pfloor, float(pf or 0)))
        except sqlite3.OperationalError:
            break
    with _pending_lock:
        pend = {t: list(_pending_seals.get((t, tf), ())) for t in tickers
                if (t, tf) in _pending_seals}
    out = {}
    for t in set(rows) | set(pend):
        sealed, ck, uns, pf = rows.get(t, (None, None, None, store_pfloor))
        s, _ck = _seal_state(sealed, ck, uns, pend.get(t, ()), pf)
        if s is not None:
            out[t] = s
    return out


def _history_keys(c: sqlite3.Connection, tf: str, written, *, replace: bool = True) -> set:
    """The (TICKER, tf) keys among `written` row tuples (ticker, tf, ts, o, h, l, c, v)
    whose write changes SEALED history: a row whose bucket ENDED at or before the
    series' `sealed_through` (the region `complete_through` calls final) and whose stored
    values differ (`replace`) or whose bucket was empty. Completing a provisional row,
    growing the tail and updating the developing bar never count. Read under the
    caller's write lock, before the write; bounded by the rows being written."""
    by_t: dict = {}
    for r in written:
        by_t.setdefault(r[0], []).append(r)
    out = set()
    if not by_t:
        return out
    sealed = _sealed_through_many(c, tf, list(by_t))
    if not sealed:
        return out
    from api.services import bar_contract
    grid = bar_contract.grid_for(tf)
    for tkr, rs in by_t.items():
        st = sealed.get(tkr)
        if st is None:
            continue
        hits = []
        for r in rs:
            b = bar_contract.bucket_bounds(tf, int(r[2]), grid)
            if b is not None and b[1] <= st:
                hits.append(r)
        if not hits:
            continue
        qs = ",".join("?" for _ in hits)
        stored = {int(t): v for t, *v in c.execute(
            f"SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? AND ts IN ({qs})",
            [tkr, tf, *[int(r[2]) for r in hits]]).fetchall()}
        for r in hits:
            old = stored.get(int(r[2]))
            if old is None or (replace and _differs(tuple(old), tuple(r[3:8]))):
                out.add((tkr, tf))
                break
    return out


# Process-local view of the store floors (also persisted to store_meta by the flusher,
# so a restart or another process reading this store sees them).
_floor_lock = threading.Lock()
_mem_floors = {"rev_floor_ms": 0.0, "proof_floor_s": 0.0}
_pending_floors: dict = {}


def bump_store_floor(reason: str = "") -> None:
    """A WHOLESALE change (bars.db replaced by a snapshot, a bulk delete across many
    series): every series' served rev becomes >= now_ms and every proof taken before
    now is void. Lock-free for the caller (persisted by the meta flusher) so it is safe
    to call from any writer, including one holding its own connection or the lock."""
    now_ms, now_s = float(_now_ms()), time.time()
    with _floor_lock:
        _mem_floors[REV_FLOOR_KEY] = max(_mem_floors[REV_FLOOR_KEY], now_ms)
        _mem_floors[PROOF_FLOOR_KEY] = max(_mem_floors[PROOF_FLOOR_KEY], now_s)
        _pending_floors[REV_FLOOR_KEY] = _mem_floors[REV_FLOOR_KEY]
        _pending_floors[PROOF_FLOOR_KEY] = _mem_floors[PROOF_FLOOR_KEY]
    with _pending_lock:
        _pending_verified.clear()       # every queued proof predates the floor
        _pending_seals.clear()
    _logger.info("[sqlite] store floor bumped (%s)", reason or "wholesale change")
    _ensure_meta_flusher()


# Write-behind buffers: verified_through (TICKER, tf) -> newest checked_at, and seals
# (TICKER, tf) -> [(sealed, window_start, checked_at), ...] in the order they happened.
_pending_lock = threading.Lock()
_pending_verified: dict = {}
_pending_seals: dict = {}
_META_FLUSH_S = float(os.environ.get("BARS_META_FLUSH_SECONDS", "1.0"))
_flusher_started = False
_flusher_lock = threading.Lock()
_meta_flush_stats = {"flushes": 0, "rows": 0, "lock_ms_max": 0.0, "lock_ms_total": 0.0,
                     "errors": 0}


def _drop_pending_verified(keys) -> None:
    with _pending_lock:
        for k in keys:
            _pending_verified.pop(k, None)
            _pending_seals.pop(k, None)


def record_sealed(ticker: str, tf: str, sealed: float, window_start: float,
                  checked_at: float) -> None:
    """Queue a seal: a provider answer at `checked_at` rewrote the series from
    `window_start`, so every bucket that ended by `sealed` is final (see
    `_SEAL_UPSERT_SQL`). Visible in-process at once, other processes after a flush."""
    key = (ticker.upper(), str(tf))
    with _pending_lock:
        lst = _pending_seals.setdefault(key, [])
        if len(lst) >= 256:
            # ⛔ Never trim the OLDEST entries: a later seal is only valid on top of the
            # earlier ones (contiguity), so a trimmed head would let the rest be applied
            # to "no seal" and trusted. A runaway buffer (flusher dead) drops them ALL —
            # losing proofs only weakens what is claimed.
            lst.clear()
            return
        lst.append((float(sealed), float(window_start), float(checked_at)))
    _ensure_meta_flusher()


def _apply_seal(state: tuple, sealed: float, wstart: float, checked: float,
                pfloor: float) -> tuple:
    """The `_SEAL_UPSERT_SQL` rule in Python (the unflushed buffer).
    state = (sealed_through, sealed_checked_at, unsealed_from)."""
    cur, cur_ck, unsealed = state
    ok = (checked > pfloor and checked >= (cur_ck or 0.0)
          and ((cur is not None and wstart <= cur)
               or (cur is None and (unsealed is None or wstart <= unsealed))))
    if not ok:
        return state
    return (sealed if cur is None else max(cur, sealed)), checked, None


def _seal_state(row_sealed, row_ck, row_unsealed, pending, pfloor: float) -> tuple:
    """(sealed_through, sealed_checked_at) as this store states it: the persisted seal
    (void when its CHECK predates the floor — a delete or a wholesale change) with this
    process's unflushed seals applied in order."""
    state = (None if row_sealed is None else float(row_sealed),
             None if row_ck is None else float(row_ck),
             None if row_unsealed is None else int(row_unsealed))
    if state[0] is not None and (state[1] is None or state[1] <= pfloor):
        state = (None, None, state[2])
    for s_, w, ck in pending:
        state = _apply_seal(state, s_, w, ck, pfloor)
    return state[0], state[1]


def record_verified(ticker: str, tf: str, checked_at: float) -> None:
    """Queue a proof (see `_VERIFIED_UPSERT_SQL`). Readers see it at once in this
    process (`series_meta` merges the buffer); other processes after the next flush."""
    key = (ticker.upper(), str(tf))
    with _pending_lock:
        prev = _pending_verified.get(key)
        if prev is None or checked_at > prev:
            _pending_verified[key] = float(checked_at)
    _ensure_meta_flusher()


def flush_meta() -> int:
    """Write every queued proof + floor in ONE short transaction. Returns rows written.
    A failure re-queues (max-merged) and is retried on the next tick."""
    with _pending_lock:
        batch = dict(_pending_verified)
        _pending_verified.clear()
        seals = {k: list(v) for k, v in _pending_seals.items()}
        _pending_seals.clear()
    with _floor_lock:
        floors = dict(_pending_floors)
        _pending_floors.clear()
        pfloor = _mem_floors[PROOF_FLOOR_KEY]
    if not batch and not floors and not seals:
        return 0
    seal_params = [{"t": t, "tf": tf, "sealed": s_, "wstart": w, "checked": ck}
                   for (t, tf), lst in seals.items() for (s_, w, ck) in lst if ck > pfloor]

    def _write(c):
        if floors:
            c.executemany(
                "INSERT INTO store_meta(k, v) VALUES (?, ?) "
                "ON CONFLICT(k) DO UPDATE SET v = max(store_meta.v, excluded.v)",
                list(floors.items()))
        if batch:
            c.executemany(_VERIFIED_UPSERT_SQL,
                          [(t, tf, vt) for (t, tf), vt in batch.items()])
        if seal_params:
            c.executemany(_SEAL_UPSERT_SQL, seal_params)

    try:
        t0 = time.perf_counter()
        with _WRITE_LOCK:
            c = _conn()
            try:
                _write(c)
            except sqlite3.OperationalError as e:
                msg = str(e).lower()
                if "no such table" not in msg and "no column" not in msg:
                    raise
                c.rollback()
                _create_meta_tables(c)
                _write(c)
            c.commit()
        held = (time.perf_counter() - t0) * 1000.0
        _meta_flush_stats["flushes"] += 1
        n = len(batch) + len(floors) + len(seal_params)
        _meta_flush_stats["rows"] += n
        _meta_flush_stats["lock_ms_total"] += held
        _meta_flush_stats["lock_ms_max"] = max(_meta_flush_stats["lock_ms_max"], held)
        return n
    except Exception as e:                               # noqa: BLE001 — retried next tick
        _meta_flush_stats["errors"] += 1
        _logger.warning("[sqlite] meta flush failed (%s); re-queued", type(e).__name__)
        try:
            _conn().rollback()
        except Exception:                                # noqa: BLE001
            pass
        with _pending_lock:
            for k, vt in batch.items():
                if vt > _pending_verified.get(k, 0.0):
                    _pending_verified[k] = vt
            for k, lst in seals.items():
                _pending_seals[k] = lst + _pending_seals.get(k, [])
        with _floor_lock:
            for k, v in floors.items():
                _pending_floors[k] = max(_pending_floors.get(k, 0.0), v)
        return 0


def reset_meta_state_for_tests() -> None:
    """Test-only: forget every unflushed proof / seal / floor and cached floor read
    (what a process restart forgets). The persisted store is untouched."""
    with _pending_lock:
        _pending_verified.clear()
        _pending_seals.clear()
    with _floor_lock:
        _pending_floors.clear()
        for k in _mem_floors:
            _mem_floors[k] = 0.0
    _floors_cache.clear()


def meta_flush_stats() -> dict:
    with _pending_lock:
        pending = len(_pending_verified)
    return dict(_meta_flush_stats, pending=pending)


def _ensure_meta_flusher() -> None:
    global _flusher_started
    if _flusher_started or _META_FLUSH_S <= 0:
        return
    with _flusher_lock:
        if _flusher_started:
            return
        _flusher_started = True

        def _loop():
            while True:
                time.sleep(_META_FLUSH_S)
                try:
                    flush_meta()
                except Exception:                        # noqa: BLE001
                    pass

        threading.Thread(target=_loop, name="bars-meta-flush", daemon=True).start()


_FLOORS_TTL_S = 1.0
_floors_cache: dict = {}        # db path -> (monotonic read time, epoch, rev_floor, proof_floor)


def _store_floors(c: sqlite3.Connection) -> tuple[float, float]:
    """The store-wide floors (persisted; another process may have raised them) merged
    with this process's. The persisted pair is re-read at most once a second (and after
    every epoch bump): they move only on wholesale changes."""
    now = time.monotonic()
    hit = _floors_cache.get(_DB_PATH)
    if hit is not None and hit[1] == _db_epoch and now - hit[0] < _FLOORS_TTL_S:
        db_rev, db_proof = hit[2], hit[3]
    else:
        db_rev = db_proof = 0.0
        try:
            for k, v in c.execute("SELECT k, v FROM store_meta WHERE k IN (?, ?)",
                                  (REV_FLOOR_KEY, PROOF_FLOOR_KEY)).fetchall():
                if k == REV_FLOOR_KEY:
                    db_rev = float(v or 0)
                else:
                    db_proof = float(v or 0)
        except sqlite3.OperationalError:
            pass
        _floors_cache[_DB_PATH] = (now, _db_epoch, db_rev, db_proof)
    return (max(_mem_floors[REV_FLOOR_KEY], db_rev),
            max(_mem_floors[PROOF_FLOOR_KEY], db_proof))


def series_meta(ticker: str, tf: str, _conn_override=None) -> dict:
    """{"rev", "history_rev", "verified_through", "sealed_through"} for a stored series, as THIS
    store states it (persisted value merged with this process's unflushed proofs).
    rev 0 = no write recorded since the meta table existed (still a valid rev; it
    only grows). Never raises: an unreadable store answers rev 0 / no proof."""
    key = (ticker.upper(), str(tf))
    rev, hrev, vt, pfloor = 0, 0, None, _mem_floors[PROOF_FLOOR_KEY]
    row_sealed = row_ck = row_uns = None
    try:
        c = _conn_override if _conn_override is not None else _conn()
        rev_floor, store_pfloor = _store_floors(c)
        try:
            row = c.execute(
                "SELECT rev, history_rev, verified_through, proof_floor, sealed_through, "
                "sealed_checked_at, unsealed_from FROM series_meta "
                "WHERE ticker=? AND tf=?", key).fetchone()
        except sqlite3.OperationalError:
            row = None
        if row:
            rev = int(row[0] or 0)
            hrev = int(row[1] or 0)
            vt = float(row[2]) if row[2] is not None else None
            pfloor = max(pfloor, float(row[3] or 0))
            row_sealed, row_ck, row_uns = row[4], row[5], row[6]
        rev = max(rev, int(rev_floor))
        hrev = max(hrev, int(rev_floor))
        pfloor = max(pfloor, store_pfloor)
    except Exception:                                    # noqa: BLE001
        pass
    with _pending_lock:
        pend = _pending_verified.get(key)
        seals = list(_pending_seals.get(key, ()))
    if pend is not None and (vt is None or pend > vt):
        vt = pend
    if vt is not None and vt <= pfloor:
        vt = None
    sealed, sealed_ck = _seal_state(row_sealed, row_ck, row_uns, seals, pfloor)
    return {"rev": rev, "history_rev": hrev, "verified_through": vt,
            "sealed_through": sealed, "sealed_checked_at": sealed_ck}


def daily_bydate_index_ready() -> bool:
    """True if the by-date daily index exists — a cheap catalog check (no build)."""
    try:
        return _conn().execute(
            "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?",
            (DAILY_BYDATE_INDEX,),
        ).fetchone() is not None
    except Exception:
        return False


#: How long the by-date build may WAIT for bars.db's write lock before giving up
#: (it then retries at its next opportunity). ⛔ SHORT ON PURPOSE. This used to be
#: 600 000 ms: a build that could queue ten minutes behind another writer and then
#: hold the write lock itself for the whole multi-minute build. A build that cannot
#: get the lock promptly steps aside; it never queues.
BYDATE_BUILD_BUSY_MS = 2000

_bydate_build_lock = threading.Lock()     # held for a build's duration (dedupe only)
_bydate_state_lock = threading.Lock()     # guards the dict below; never held across I/O
_bydate_build_state = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "last_outcome": None,    # "built" | "already_present" | "busy" | "error: ..."
    "last_seconds": None,
    "trigger": None,
}


def bydate_build_state() -> dict:
    """Snapshot of the by-date build's last/current attempt (for the admin route)."""
    with _bydate_state_lock:
        out = dict(_bydate_build_state)
    out["index_present"] = daily_bydate_index_ready()
    out["busy_timeout_ms"] = BYDATE_BUILD_BUSY_MS
    return out


def ensure_daily_bydate_index(busy_timeout_ms: int = BYDATE_BUILD_BUSY_MS,
                              trigger: str = "manual") -> bool:
    """Build (once) a PARTIAL, COVERING index over daily rows keyed BY DATE, so a
    whole-market "every ticker's close on date X" read is one contiguous index range-
    scan instead of a scan of the multi-GB daily partition.

    The base index (ticker, tf, ts DESC) leads with `ticker`, so `WHERE tf='D' AND
    ts BETWEEN…` can't use it — that read (the pre-~2004 Custom-Period Sort fallback)
    took MINUTES on cold, network-backed storage. `(ts, ticker, c) WHERE tf='D'` is
    daily-ONLY and COVERING, so the windowed read is index-only and fast even cold.
    Returns True when the index exists afterwards.

    ⛔⛔ NEVER CALL THIS FROM A BOOT OR REQUEST PATH (incident 2026-10-02). On the
    31 GB production store it is a ~13-minute full scan at the network volume's
    ~40 MB/s that holds bars.db's write transaction the whole time. Started 90 s
    after every boot, it ran while three deploys in a row failed their 600 s
    healthcheck. The index normally ARRIVES with the R2 snapshot
    (`data_sync._make_tarball` creates every `BARS_INDEX_DDL` index on the copy);
    on web this build is a fallback, reachable only through `bars_bydate_index`
    (the owner's admin trigger, or the flag-gated low-traffic window).

    Bounded two ways: a concurrent second call returns False at once instead of
    queueing a second build, and the build waits at most `busy_timeout_ms` for the
    write lock (another writer holding it => outcome "busy", False, retry later).

    Do NOT hold _WRITE_LOCK here: CREATE INDEX holds a SQLite write transaction for
    its entire build and every put_bars acquires _WRITE_LOCK, so holding it would
    block every bar write site-wide for minutes. Without it, put_bars contends at the
    SQLite level (fail-fast 2 s + retry) for the build's duration."""
    if daily_bydate_index_ready():
        with _bydate_state_lock:
            _bydate_build_state["last_outcome"] = "already_present"
        return True
    if not _bydate_build_lock.acquire(blocking=False):
        return False  # a build is already running; never queue a second one
    t0 = time.time()
    with _bydate_state_lock:
        _bydate_build_state.update(running=True, started_at=int(t0), finished_at=None,
                                   trigger=trigger)
    outcome = "error"
    try:
        bc = sqlite3.connect(_DB_PATH, check_same_thread=False,
                             timeout=max(0.0, busy_timeout_ms / 1000.0))
        try:
            bc.execute("PRAGMA journal_mode=WAL")
            bc.execute(f"PRAGMA busy_timeout={int(busy_timeout_ms)}")
            bc.execute("PRAGMA temp_store=MEMORY")
            bc.execute(BARS_INDEX_DDL[DAILY_BYDATE_INDEX])
            bc.commit()
        finally:
            bc.close()
        outcome = "built"
        print(f"[sqlite-index] built {DAILY_BYDATE_INDEX} in {time.time() - t0:.1f}s "
              f"(trigger={trigger})")
        return True
    except sqlite3.OperationalError as e:
        msg = str(e).lower()
        outcome = "busy" if ("locked" in msg or "busy" in msg) else f"error: {e}"
        print(f"[sqlite-index] {DAILY_BYDATE_INDEX} not built after {time.time() - t0:.1f}s "
              f"({outcome}); will retry later")
        return False
    except Exception as e:
        outcome = f"error: {e}"
        print(f"[sqlite-index] {DAILY_BYDATE_INDEX} build failed after {time.time() - t0:.1f}s: {e}")
        return False
    finally:
        with _bydate_state_lock:
            _bydate_build_state.update(running=False, finished_at=int(time.time()),
                                       last_outcome=outcome,
                                       last_seconds=round(time.time() - t0, 1))
        _bydate_build_lock.release()


def ensure_indexes_at(db_path: str) -> list[str]:
    """Create every `BARS_INDEX_DDL` index MISSING from the bars.db at `db_path`.

    For a PRIVATE copy -- the snapshot `data_sync._make_tarball` is about to ship.
    Nothing else has it open, so there is no lock to wait on and no member traffic
    to starve. Returns the names it had to create ([] when the copy already carried
    them all). Raises on failure: a snapshot that cannot be given its indexes must
    not ship without them."""
    c = sqlite3.connect(db_path)
    try:
        present = {r[0] for r in c.execute(
            "SELECT name FROM sqlite_master WHERE type='index'").fetchall()}
        created = []
        for name, ddl in BARS_INDEX_DDL.items():
            if name in present:
                continue
            c.execute(ddl)
            created.append(name)
        c.commit()
        return created
    finally:
        c.close()


def daily_coverage_probe(start_ymd: int, end_ymd: int) -> dict:
    """Fast diagnostic: does bars.db actually HOLD daily data near these dates?
    Uses the by-date index when present (else best-effort). Answers the real question
    behind a stuck pre-2004 sort — is it slow, or is the deep history simply absent on
    this pod?"""
    import time as _t
    out = {"index_ready": daily_bydate_index_ready(), "path": _DB_PATH}
    c = _conn()

    def _window(to_ymd):
        frm = int(to_ymd) - 30
        t0 = _t.time()
        try:
            n = c.execute(
                "SELECT COUNT(*) FROM ohlcv WHERE tf='D' AND ts<=? AND ts>=? AND c>0",
                (int(to_ymd), frm),
            ).fetchone()[0]
            samp = [r[0] for r in c.execute(
                "SELECT DISTINCT ticker FROM ohlcv WHERE tf='D' AND ts<=? AND ts>=? AND c>0 LIMIT 8",
                (int(to_ymd), frm),
            ).fetchall()]
        except Exception as e:
            return {"error": str(e), "ms": round((_t.time() - t0) * 1000)}
        return {"count": n, "sample": samp, "ms": round((_t.time() - t0) * 1000)}

    try:
        t0 = _t.time()
        row = c.execute("SELECT MIN(ts), MAX(ts) FROM ohlcv WHERE tf='D'").fetchone()
        out["daily_min_ts"], out["daily_max_ts"] = (row or (None, None))
        out["minmax_ms"] = round((_t.time() - t0) * 1000)
    except Exception as e:
        out["minmax_error"] = str(e)
    out["start_window"] = _window(start_ymd)
    out["end_window"] = _window(end_ymd)
    return out


_COVERAGE_CACHE = {"ts": 0.0, "data": None}


def coverage_stats(sample: list[str] | None = None, universe: list[str] | None = None,
                   *, fresh_within_days: int = 5, n: int = 400) -> dict:
    """Universe-WARMTH snapshot — the ground-truth measure of "how much of the
    universe is instant on first view". SAMPLE-BASED and FAST by design: a
    COUNT(DISTINCT ticker) walks 100M+ rows on the multi-GB db (>55s, RAM-heavy),
    so instead we probe a random N of each passed list via the PK-indexed
    get_last_ts (~1ms each) and report the % with a RECENT daily bar. `sample` =
    the liquid set (cap_universe); `universe` = the full long-tail set — the
    long-tail % is the real "are obscure movers warm" number. Cached 5min. READ-ONLY."""
    import time as _t
    now = _t.time()
    cached = _COVERAGE_CACHE["data"]
    if cached and now - _COVERAGE_CACHE["ts"] < 300:
        return cached
    from datetime import datetime, timedelta
    import random
    cutoff = int((datetime.utcnow() - timedelta(days=fresh_within_days)).strftime("%Y%m%d"))
    out = {"path": _DB_PATH, "at": int(now)}

    def _probe(syms, label):
        try:
            pool = list({s for s in syms if s})
            if not pool:
                return
            picked = random.sample(pool, min(n, len(pool)))
            t0 = _t.time()
            have = fresh = 0
            for s in picked:
                lt = get_last_ts(s, "D")
                if lt:
                    have += 1
                    if int(lt) >= cutoff:
                        fresh += 1
            k = len(picked)
            out[f"{label}_n"] = k
            out[f"{label}_have_pct"] = round(100.0 * have / k, 1) if k else 0.0
            out[f"{label}_fresh_pct"] = round(100.0 * fresh / k, 1) if k else 0.0  # % WARM
            out[f"{label}_ms"] = round((_t.time() - t0) * 1000)
        except Exception as e:  # noqa: BLE001
            out[f"{label}_error"] = str(e)

    if sample:
        _probe(sample, "cap")
    if universe:
        _probe(universe, "univ")
        # extrapolate an approximate warm-ticker count for the whole universe
        fp = out.get("univ_fresh_pct")
        if fp is not None:
            out["univ_size"] = len({s for s in universe if s})
            out["est_warm_tickers"] = int(round(out["univ_size"] * fp / 100.0))
    _COVERAGE_CACHE.update(ts=now, data=out)
    return out


def delete_bars(ticker: str | None = None, tf: str | None = None) -> int:
    """Delete rows by (ticker, tf). Either may be None to wildcard.
    Returns rows deleted."""
    c = _conn()
    if ticker and tf:
        cur = c.execute("DELETE FROM ohlcv WHERE ticker=? AND tf=?", (ticker.upper(), tf))
        if cur.rowcount:
            bump_series_revs(c, [(ticker, tf)], deleted=True)
    elif tf:
        cur = c.execute("DELETE FROM ohlcv WHERE tf=?", (tf,))
    elif ticker:
        cur = c.execute("DELETE FROM ohlcv WHERE ticker=?", (ticker.upper(),))
    else:
        cur = c.execute("DELETE FROM ohlcv")
    c.commit()
    if cur.rowcount and not (ticker and tf):
        bump_store_floor("delete_bars wildcard")
    return cur.rowcount


def iter_tickers(conn: sqlite3.Connection):
    """Yield each distinct ticker in ohlcv, in order, by seeking the primary key.

    `SELECT DISTINCT ticker` reads every index entry, about 58M on the worker.
    Each step here is one index seek, so the cost follows the number of tickers."""
    current = ""
    while True:
        row = conn.execute(
            "SELECT ticker FROM ohlcv WHERE ticker>? ORDER BY ticker LIMIT 1",
            (current,),
        ).fetchone()
        if row is None:
            return
        current = row[0]
        yield current


# ── 60m grid migration (2026-11-10: clock hours → TradingView session grid) ──
# The stored tf=60 layout moved from 09:30(30 min), 10:00, 11:00 … 15:00 to
# TradingView's 09:30, 10:30 … 15:30 (bars_fetch.SIXTY_MIN_GRID). A row stamped
# on an ET :00 between 10:00 and the regular close can ONLY come from the old
# layout, and an old ticker's 09:30 row has the right key but 30 minutes of
# content — so detection is per row, healing is per TICKER: drop every 60m row
# of a ticker that has any, and the next request re-resamples from 15m.
_ET_ZONE = None


def is_old_grid_60m_ts(ts: int) -> bool:
    """True when a stored tf=60 ``ts`` is a pre-2026-11-10 clock-hour RTH bucket
    (an ET :00 in [10:00, regular close)), which the session grid never emits."""
    global _ET_ZONE
    from datetime import datetime
    if _ET_ZONE is None:
        from zoneinfo import ZoneInfo
        _ET_ZONE = ZoneInfo("America/New_York")
    try:
        dt = datetime.fromtimestamp(int(ts), tz=_ET_ZONE)
    except (TypeError, ValueError, OverflowError, OSError):
        return False
    if dt.minute != 0 or dt.second != 0:
        return False
    close_h = 16
    try:
        from api.services.nyse_calendar import NYSE_EARLY_CLOSES_YYYYMMDD
        if dt.year * 10000 + dt.month * 100 + dt.day in NYSE_EARLY_CLOSES_YYYYMMDD:
            close_h = 13
    except Exception:  # noqa: BLE001 — calendar unreadable → regular day
        pass
    return 10 <= dt.hour < close_h


def ticker_has_old_grid_60m(c: sqlite3.Connection, ticker: str, probe: int = 120) -> bool:
    """Index-seek both ends of a ticker's tf=60 rows for an old-layout bucket."""
    for order in ("DESC", "ASC"):
        rows = c.execute(
            f"SELECT ts FROM ohlcv WHERE ticker=? AND tf='60' ORDER BY ts {order} LIMIT ?",
            (ticker, int(probe)),
        ).fetchall()
        if any(is_old_grid_60m_ts(r[0]) for r in rows):
            return True
    return False


def _invalidate_60m_caches(tkr: str) -> None:
    try:
        from api.services import bars_disk_cache as _disk
        _disk.delete(tkr, "60")
    except Exception:  # noqa: BLE001 — a stale disk JSON is re-validated on read anyway
        pass
    try:
        from api.services.cache import cache as _mem
        _mem.delete_prefix(f"bars_{tkr}_60_")
        _mem.delete_prefix(f"histfull_{tkr}_60")
    except Exception:  # noqa: BLE001
        pass


def replace_ticker_tf_rows(ticker: str, tf: str, bars: list[dict]) -> tuple[int, int]:
    """Atomically replace ALL of (ticker, tf)'s rows with ``bars`` (validated like
    ``put_bars``). One transaction under the write lock: a reader sees the old set
    or the new one, never a mix. Returns (rows deleted, rows written)."""
    tkr = ticker.upper()
    keep, _rej = _writable_bars(tkr, tf, bars)
    rows = [(tkr, tf, int(b["t"]), b.get("o"), b.get("h"), b.get("l"), b.get("c"),
             int(b.get("v") or 0)) for b in keep]
    c = _conn()
    with _WRITE_LOCK:
        try:
            cur = c.execute("DELETE FROM ohlcv WHERE ticker=? AND tf=?", (tkr, tf))
            deleted = cur.rowcount
            if rows:
                c.executemany(
                    "INSERT OR REPLACE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)", rows)
            if deleted or rows:
                bump_series_revs(c, [(tkr, tf)], deleted=bool(deleted), history=True)
            c.commit()
        except BaseException:
            c.rollback()
            raise
    return deleted, len(rows)


#: One-time marker: set once a full sweep finds no old-grid 60m ticker. After
#: it, boot/snapshot passes skip the per-ticker probe entirely (snapshot merges
#: reject old-grid 60m rows at the door — data_sync._merge_pair).
SIXTY_GRID_CLEAN_MARKER = "sixty_min_grid_tv_2026_11_10_clean"
#: Tickers rebuilt per sweep pass (local 15m/30m resample, no provider call).
#: The rest are rebuilt lazily on serve, or by the next pass.
SIXTY_GRID_REBUILDS_PER_PASS = int(os.environ.get("BARS_SIXTY_GRID_REBUILDS_PER_PASS", "400"))


def _sixty_grid_clean(c: sqlite3.Connection) -> bool:
    try:
        return c.execute("SELECT 1 FROM _migrations WHERE name=?",
                         (SIXTY_GRID_CLEAN_MARKER,)).fetchone() is not None
    except Exception:  # noqa: BLE001
        return False


#: Set once a boot pass has scanned EVERY ticker's full daily history for off-calendar
#: keys (`purge_off_calendar_daily`). After it, each pass scans only the last
#: `OFF_CALENDAR_RECENT_DAYS` — the write door and the serve guard stop new bad rows,
#: so the full scan (tens of millions of D rows, and the R2 uploader waits on this
#: pass) is a one-time cost. It lives IN bars.db, so a restored snapshot that never
#: had the full pass carries no marker and gets one.
OFF_CALENDAR_CLEAN_MARKER = "daily_off_calendar_2026_11_11_clean"
OFF_CALENDAR_RECENT_DAYS = 30


def _marker_set(c: sqlite3.Connection, name: str) -> bool:
    try:
        return c.execute("SELECT 1 FROM _migrations WHERE name=?", (name,)).fetchone() is not None
    except Exception:  # noqa: BLE001
        return False


def _set_marker(c: sqlite3.Connection, name: str) -> None:
    try:
        with _WRITE_LOCK:
            c.execute("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER)")
            c.execute("INSERT OR IGNORE INTO _migrations(name, applied_at) VALUES (?, ?)",
                      (name, int(time.time())))
            c.commit()
    except Exception as e:  # noqa: BLE001
        _logger.warning(f"[sqlite] marker {name} not written (non-fatal): {e}")


def _mark_sixty_grid_clean(c: sqlite3.Connection) -> None:
    try:
        with _WRITE_LOCK:
            c.execute("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER)")
            c.execute("INSERT OR IGNORE INTO _migrations(name, applied_at) VALUES (?, ?)",
                      (SIXTY_GRID_CLEAN_MARKER, int(time.time())))
            c.commit()
    except Exception as e:  # noqa: BLE001
        _logger.warning(f"[sqlite] 60m grid clean marker not written (non-fatal): {e}")


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
    flag file blocked a re-heal.

    PERFORMANCE (2026-07-03 hard lesson): `WHERE tf='W'` alone cannot use the
    (ticker, tf, ts) primary key, so a global `DELETE ... WHERE tf='W' AND ts
    IN (...)` full-scans the ~58M-row table PER CHUNK. The first deploy of
    this purge did exactly that while holding _WRITE_LOCK at worker boot,
    blocked the healthcheck past its 600s budget, and FAILED the deploy.
    This version reads and deletes per-ticker (PK-prefixed → indexed) and
    takes the write lock only for a ticker with something to delete, so the
    prewarmer is never starved. Callers on a boot path MUST use
    purge_mis_keyed_weekly_rows_async().

    2026-11-09: discovery was still one `WHERE tf='W'` table scan. It took 35
    minutes on the worker, and the R2 uploader waits for this purge, so
    frequent deploys kept the uploader from ever running.

    Returns rows deleted.
    """
    from api.services import date_bar_keys as _dk

    def _is_bad(ts: int) -> bool:
        return not _dk.key_ok("W", ts)  # the ISO-week-Friday rule — `date_bar_keys`

    c = _conn()
    deleted = 0
    off_calendar = 0
    # Full daily history once (until the marker), then a bounded recent window.
    off_full = not _marker_set(c, OFF_CALENDAR_CLEAN_MARKER)
    off_since = None if off_full else _off_calendar_window_start()
    off_errors = 0
    # ⭐ Same pass, same PK-prefixed seeks: a ticker still carrying the
    # pre-2026-11-10 clock-hour 60m layout is REBUILT in place from its own stored
    # 15m/30m rows (bars_fetch.rebuild_sixty_min_grid — local, no provider call),
    # bounded per pass. Skipped entirely once a pass has found none (marker).
    sixty_probe = not _sixty_grid_clean(c)
    sixty_old = sixty_rebuilt = 0
    for tkr in iter_tickers(c):
        if sixty_probe:
            try:
                if ticker_has_old_grid_60m(c, tkr):
                    sixty_old += 1
                    if sixty_rebuilt < SIXTY_GRID_REBUILDS_PER_PASS:
                        from api.services.bars_fetch import rebuild_sixty_min_grid
                        rebuild_sixty_min_grid(tkr)
                        sixty_rebuilt += 1
            except Exception as e:  # noqa: BLE001 — never let the 60m check stop the weekly purge
                _logger.warning(f"[sqlite] 60m grid rebuild {tkr} failed (non-fatal): {e}")
        # Same pass, same PK-prefixed seek: daily rows on a non-trading day (+ the
        # weeks/months they were summed into). Runs before the W scan below so a W row
        # it rewrites is judged by that scan like any other.
        try:
            off_calendar += purge_off_calendar_daily(tkr, c, since_ymd=off_since)
        except Exception as e:  # noqa: BLE001 — never let it stop the weekly purge
            off_errors += 1
            _logger.warning(f"[sqlite] off-calendar daily purge {tkr} failed (non-fatal): {e}")
        bad = [
            ts for (ts,) in c.execute(
                "SELECT ts FROM ohlcv WHERE ticker=? AND tf='W'", (tkr,)
            ).fetchall()
            if _is_bad(ts)
        ]
        if not bad:
            continue
        with _WRITE_LOCK:
            for i in range(0, len(bad), 500):
                chunk = bad[i:i + 500]
                qs = ",".join("?" for _ in chunk)
                cur = c.execute(
                    f"DELETE FROM ohlcv WHERE ticker=? AND tf='W' AND ts IN ({qs})",
                    [tkr, *chunk],
                )
                deleted += cur.rowcount
            bump_series_revs(c, [(tkr, "W")], deleted=True, deleted_from=min(bad))
            c.commit()
    if sixty_probe:
        _logger.info(f"[sqlite] 60m grid: {sixty_old} old-layout ticker(s), {sixty_rebuilt} rebuilt this pass")
        if sixty_old == 0:
            _mark_sixty_grid_clean(c)
    if deleted:
        _logger.info(f"[sqlite] purge_mis_keyed_weekly_rows: deleted {deleted} stale weekly rows")
    if off_calendar:
        _logger.warning(f"[sqlite] purge_off_calendar_daily: deleted {off_calendar} non-trading-day daily rows")
    if off_full and not off_errors:
        _set_marker(c, OFF_CALENDAR_CLEAN_MARKER)
    return deleted


def _off_calendar_window_start() -> int:
    """YYYYMMDD of the bounded per-boot scan's lower edge (ET date − N days)."""
    import datetime as _dt
    from zoneinfo import ZoneInfo
    d = _dt.datetime.now(ZoneInfo("America/New_York")).date() - _dt.timedelta(days=OFF_CALENDAR_RECENT_DAYS)
    return int(d.strftime("%Y%m%d"))


def _off_calendar_candidate_sql() -> tuple[str, list]:
    """A SQL PRE-FILTER (superset) for D keys that are not NYSE trading days:
    Saturday/Sunday, a calendar holiday, or not a real date. Every candidate is
    re-judged by `date_bar_keys.key_ok` — the SQL never decides a deletion alone
    (same discipline as `_IMPOSSIBLE_CANDIDATE_SQL`). Spelled in SQL so the scan of
    a ticker's daily rows stays in C instead of one Python call per row."""
    from api.services import session_calendar as _sc
    hol = sorted(int(d.strftime("%Y%m%d")) for d in _sc.calendar().holidays)
    iso = "printf('%04d-%02d-%02d', ts / 10000, (ts / 100) % 100, ts % 100)"
    sql = (f"(date({iso}) IS NULL OR date({iso}) != {iso} "
           f"OR strftime('%w', {iso}) IN ('0','6')"
           + (f" OR ts IN ({','.join('?' for _ in hol)})" if hol else "") + ")")
    return sql, hol


def purge_off_calendar_daily(ticker: str, c: sqlite3.Connection | None = None,
                             since_ymd: int | None = None) -> int:
    """Delete ``ticker``'s daily rows keyed on a non-trading day, then rebuild the
    stored W / M rows those days were summed into from the remaining daily rows.

    Idempotent (a second run finds nothing) and bounded (one PK-prefixed read per
    ticker; writes only for a ticker that has a bad row). A W/M row is rebuilt only
    when the store holds the period's daily rows from its start — otherwise it is
    left as it is rather than replaced by a partial period. ``since_ymd`` bounds the
    scan to keys at/after it (the per-boot window once the full pass has run; see
    `OFF_CALENDAR_CLEAN_MARKER`); None scans the whole history. Returns D rows deleted.
    Rule: `date_bar_keys`. The write gate (`_writable_bars`) stops new ones."""
    from api.services import date_bar_keys as _dk
    tkr = ticker.upper()
    if not _dk.calendar_applies(tkr):
        return 0
    c = c or _conn()
    pred, params = _off_calendar_candidate_sql()
    lo = "" if since_ymd is None else " AND ts>=?"
    cand = [ts for (ts,) in c.execute(
        f"SELECT ts FROM ohlcv WHERE ticker=? AND tf='D'{lo} AND {pred}",
        [tkr, *([] if since_ymd is None else [int(since_ymd)]), *params]).fetchall()]
    bad = [ts for ts in cand if not _dk.key_ok("D", ts)]
    if not bad:
        return 0
    with _WRITE_LOCK:
        qs = ",".join("?" for _ in bad)
        cur = c.execute(f"DELETE FROM ohlcv WHERE ticker=? AND tf='D' AND ts IN ({qs})", [tkr, *bad])
        if cur.rowcount:
            bump_series_revs(c, [(tkr, "D")], deleted=True, deleted_from=min(bad))
        c.commit()
    n = cur.rowcount
    _logger.warning("[sqlite] %s: deleted %d non-trading-day daily row(s): %s", tkr, n, bad[:5])
    _rebuild_periods_from_daily(tkr, bad, c)
    return n


def _rebuild_periods_from_daily(tkr: str, bad_ts: list[int], c: sqlite3.Connection) -> None:
    """Recompute the stored W and M rows covering ``bad_ts`` from stored D rows,
    with the one W/M resampler (`bars_fetch._resample_*_iso`)."""
    import datetime as _dt
    from api.services import date_bar_keys as _dk
    from api.services.bars_fetch import _resample_monthly_iso, _resample_weekly_iso

    def ymd(x) -> int:
        return int(x.strftime("%Y%m%d"))

    first_d = get_first_ts(tkr, "D")
    periods = set()
    for ts in bad_ts:
        d = _dk.key_date(ts)
        if d is None:
            continue
        mon = d - _dt.timedelta(days=d.weekday())
        periods.add(("W", mon, mon + _dt.timedelta(days=6), mon + _dt.timedelta(days=4)))
        m1 = d.replace(day=1)
        nxt = (m1 + _dt.timedelta(days=32)).replace(day=1)
        periods.add(("M", m1, nxt - _dt.timedelta(days=1), m1))
    for tf, start, end, key in sorted(periods):
        if not first_d or first_d > ymd(start):
            continue  # the store's daily history does not reach the period start
        if not c.execute("SELECT 1 FROM ohlcv WHERE ticker=? AND tf=? AND ts=?",
                         (tkr, tf, ymd(key))).fetchone():
            continue  # no stored row to correct
        rows = c.execute("SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf='D' AND ts>=? AND ts<=? "
                         "ORDER BY ts", (tkr, ymd(start), ymd(end))).fetchall()
        daily = [{"t": f"{str(r[0])[:4]}-{str(r[0])[4:6]}-{str(r[0])[6:]}", "o": r[1], "h": r[2],
                  "l": r[3], "c": r[4], "v": r[5]} for r in rows if None not in r[1:5]]
        if not daily:
            continue
        built = (_resample_weekly_iso if tf == "W" else _resample_monthly_iso)(daily, ticker=tkr)
        if built:
            put_bars(tkr, tf, built[-1:], date_tf=True)


_purge_weekly_thread_lock = threading.Lock()
_purge_weekly_running = False


def purge_mis_keyed_weekly_rows_async() -> None:
    """Run the weekly-key purge in a daemon thread (deduped).

    The purge's discovery pass scans the ohlcv table — minutes on the
    worker's ~58M-row DB — so it must NEVER run inline on a boot path
    (Railway healthcheck budget is 600s; the 2026-07-03 worker deploy
    failure was this exact mistake). The serve-time weekly guard in
    _fmt_sqlite_bars keeps charts clean during the window before the
    background purge lands."""
    global _purge_weekly_running
    with _purge_weekly_thread_lock:
        if _purge_weekly_running:
            return
        _purge_weekly_running = True

    def _run():
        global _purge_weekly_running
        try:
            purge_mis_keyed_weekly_rows()
        except Exception as e:
            _logger.warning(f"[sqlite] weekly key purge failed (non-fatal): {e}")
        finally:
            with _purge_weekly_thread_lock:
                _purge_weekly_running = False

    threading.Thread(target=_run, daemon=True, name="weekly-key-purge").start()


#: A SUPERSET of `bar_validation.possible_bar_reasons`, spelled in SQL so the
#: scan is an index-free single pass rather than 17,144,361 Python calls.
#: ⛔ IT IS A PRE-FILTER, NOT THE RULE. Every candidate it returns is re-judged in
#: Python by `possible_bar_reasons`, which stays the single authority — a SQL
#: predicate that had quietly drifted from the Python one would delete rows the
#: write path considers fine. It only has to be a superset, and a superset that
#: is too wide costs a Python call, never a wrong deletion.
#: (SQLite stores a NaN REAL as NULL, so the NaN class is caught by `IS NULL`.)
_IMPOSSIBLE_CANDIDATE_SQL = (
    "o IS NULL OR h IS NULL OR l IS NULL OR c IS NULL OR v IS NULL "
    "OR o <= 0 OR h <= 0 OR l <= 0 OR c <= 0 "
    "OR h < l OR h < o OR h < c OR l > o OR l > c OR v < 0"
)


def impossible_bars(tf: str | None = None, limit: int | None = None) -> list[dict]:
    """Every stored row that does not describe a bar that could have happened.

    ⭐ THE SELECTOR IS THE RULE, NOT THE SYMPTOM. A repair keyed on "open above
    high" cannot re-find its own failures once it has changed them, and this repo
    has been bitten by exactly that. This asks the same question the write path
    now asks, so a re-scan after a repair is a real measurement.
    """
    from api.services.bar_validation import possible_bar_reasons
    sql = ("SELECT ticker, tf, ts, o, h, l, c, v FROM ohlcv WHERE ("
           + _IMPOSSIBLE_CANDIDATE_SQL + ")")
    params: list = []
    if tf is not None:
        sql += " AND tf=?"
        params.append(tf)
    sql += " ORDER BY ticker, tf, ts"
    if limit:
        sql += f" LIMIT {int(limit)}"
    out: list[dict] = []
    for r in _conn().execute(sql, params).fetchall():
        bar = {"t": r[2], "o": r[3], "h": r[4], "l": r[5], "c": r[6], "v": r[7]}
        reasons = possible_bar_reasons(bar)
        if reasons:
            out.append({"ticker": r[0], "tf": r[1], "ts": r[2],
                        "bar": bar, "reasons": reasons})
    return out


def purge_impossible_bars(tf: str | None = None, *, apply: bool = False,
                          limit: int | None = None) -> dict:
    """Delete the rows `impossible_bars` names. ``apply=False`` is a real dry run.

    ⛔ DELETION, NEVER COERCION, AND THAT IS THE WHOLE DESIGN. Clamping an open
    into `[low, high]`, or widening the high to admit it, invents a print that did
    not happen — which is the defect class the 2026-08-09 audit exists to remove,
    not a repair of it. A row that cannot be recovered from a provider is ABSENT,
    and `_fmt_sqlite_bars` already drops absent-shaped rows at serve time, so
    nothing user-visible regresses.

    ⚠️ RUN THE REFETCH PASS FIRST. `tools/bars_integrity_repair.py --refetch` asks
    the provider for the affected sessions before this runs, so a settled session
    the provider can still supply is REPLACED rather than lost. What survives to
    here is what no source has — a vendor's `0.0` open sentinel, an all-NULL
    placeholder — and those are honest absences.
    """
    found = impossible_bars(tf=tf, limit=limit)
    summary = {"found": len(found), "deleted": 0, "applied": bool(apply),
               "by_reason": {}}
    for row in found:
        key = row["reasons"][0]
        summary["by_reason"][key] = summary["by_reason"].get(key, 0) + 1
    if not found or not apply:
        return summary
    with _WRITE_LOCK:
        c = _conn()
        c.executemany("DELETE FROM ohlcv WHERE ticker=? AND tf=? AND ts=?",
                      [(r["ticker"], r["tf"], r["ts"]) for r in found])
        _oldest: dict = {}
        for r in found:
            k = (r["ticker"], r["tf"])
            _oldest[k] = min(_oldest.get(k, r["ts"]), r["ts"])
        bump_series_revs(c, list(_oldest), deleted=True, deleted_from=_oldest)
        c.commit()
    summary["deleted"] = len(found)
    _logger.warning("[sqlite] purged %d impossible bars: %s",
                    len(found), summary["by_reason"])
    return summary


def get_last_ts(ticker: str, tf: str) -> int | None:
    """Return the largest stored ts for (ticker, tf), or None if no rows."""
    row = _conn().execute(
        "SELECT MAX(ts) FROM ohlcv WHERE ticker=? AND tf=?",
        (ticker.upper(), tf),
    ).fetchone()
    return row[0] if row and row[0] is not None else None


def get_first_ts(ticker: str, tf: str) -> int | None:
    """Return the SMALLEST stored ts for (ticker, tf), or None if no rows.

    The mirror of `get_last_ts`, and the only honest answer to "how far back does
    this series actually reach?". A row COUNT cannot answer that — see
    `deep_history_warm._already_deep`, where a count-based depth test silently
    stopped working once Massive's own 2003-09-10 floor grew past the threshold.
    """
    row = _conn().execute(
        "SELECT MIN(ts) FROM ohlcv WHERE ticker=? AND tf=?",
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


def get_bars_before(ticker: str, tf: str, max_bars: int, to_key: int) -> list[tuple]:
    """Up to max_bars rows with ts <= to_key, oldest-first — the pre-cutoff window used
    by replay mode. Uses the (ticker, tf, ts DESC) index, so it's a fast index seek even
    for a deep window. (ts is YYYYMMDD for D/W/M, unix seconds for intraday.)"""
    return _conn().execute(
        """SELECT ts,o,h,l,c,v FROM (
               SELECT ts,o,h,l,c,v FROM ohlcv
               WHERE ticker=? AND tf=? AND ts<=?
               ORDER BY ts DESC LIMIT ?
           ) ORDER BY ts ASC""",
        (ticker.upper(), tf, int(to_key), max_bars),
    ).fetchall()


def get_bars_since(ticker: str, tf: str, since_ts: int) -> list[tuple]:
    """Return bars with ts > since_ts, oldest-first (for browser delta sync)."""
    return _conn().execute(
        "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? AND ts>? ORDER BY ts ASC",
        (ticker.upper(), tf, since_ts),
    ).fetchall()


def max_daily_volume_in_range(from_ymd: int, to_ymd: int, min_sessions: int = 2) -> dict:
    """{TICKER: max daily volume} over DAILY bars with from_ymd <= ts < to_ymd,
    for tickers having >= min_sessions bars in that window.

    Daily bars store `ts` as a YYYYMMDD int, so the range is a plain int compare.
    One indexed GROUP BY builds the volume-scan's 1-year reference in a single
    query instead of thousands of per-ticker reads."""
    rows = _conn().execute(
        """SELECT ticker, MAX(v) AS mv, COUNT(*) AS n FROM ohlcv
           WHERE tf='D' AND ts>=? AND ts<?
           GROUP BY ticker HAVING n>=? AND mv>0""",
        (int(from_ymd), int(to_ymd), int(min_sessions)),
    ).fetchall()
    return {str(r[0]).upper(): int(r[1]) for r in rows}


def closes_near_date(to_ymd: int, from_ymd: int) -> dict:
    """{TICKER: most-recent daily close with from_ymd <= ts <= to_ymd} — each ticker's close
    on the nearest trading day on/before `to_ymd` within the window (one scan handles
    holidays). This is bars.db's deep (yfinance-sourced) fallback for whole-market grouped
    closes on PRE-~2004 dates, which the provider's grouped-daily endpoint doesn't cover.
    Tickers are app/hyphen form (BRK-B), matching storage. With idx_ohlcv_daily_bydate
    (see ensure_daily_bydate_index) this is an index-only range scan of the ~9-day window
    (fast even cold); WITHOUT it, a full scan of the daily partition — so the caller must
    ensure the index first. ⚠️ SURVIVORSHIP-BIASED: only names still in the warmed universe
    are present; companies delisted before now are absent."""
    rows = _conn().execute(
        "SELECT ticker, ts, c FROM ohlcv WHERE tf='D' AND ts<=? AND ts>=? AND c>0",
        (int(to_ymd), int(from_ymd)),
    ).fetchall()
    out: dict[str, float] = {}
    best: dict[str, int] = {}
    for t, ts, c in rows:
        u = str(t).upper()
        if ts > best.get(u, 0):
            best[u] = ts
            out[u] = float(c)
    return out


def closes_asof(symbols, to_ymd: int, from_ymd: int) -> dict:
    """{TICKER: close on the nearest daily trading day in [from_ymd, to_ymd]} via ONE
    INDEXED point-lookup per ticker — the fast pre-~2004 whole-market fallback.

    closes_near_date() does a single `WHERE tf='D' AND ts BETWEEN…` which the only index
    (ticker, tf, ts DESC) can't serve → a full scan of the multi-GB daily partition (minutes).
    Here each `WHERE ticker=? AND tf='D' AND ts<=? AND ts>=? ORDER BY ts DESC LIMIT 1` IS a
    pure index seek, so looping the ~CS universe (a few thousand seeks) resolves in seconds.
    Pass app/hyphen-form tickers (BRK-B), matching storage. SURVIVORSHIP-BIASED like
    closes_near_date (only names still warmed are present)."""
    conn = _conn()
    q = ("SELECT c FROM ohlcv WHERE ticker=? AND tf='D' AND ts<=? AND ts>=? AND c>0 "
         "ORDER BY ts DESC LIMIT 1")
    to_i, from_i = int(to_ymd), int(from_ymd)
    out: dict[str, float] = {}
    for s in symbols:
        row = conn.execute(q, (s, to_i, from_i)).fetchone()
        if row and row[0] and row[0] > 0:
            out[str(s).upper()] = float(row[0])
    return out


def recent_first_trade(since_ymd: int) -> dict:
    """{TICKER: earliest daily-bar ts (YYYYMMDD)} for tickers whose FIRST daily bar is
    on/after since_ymd — a proxy for "first traded (IPO'd) within the window", given
    bars.db's since-inception daily coverage for the tracked universe. One indexed
    GROUP BY; powers the IPO-in-last-year scan."""
    rows = _conn().execute(
        """SELECT ticker, MIN(ts) AS first_ts FROM ohlcv
           WHERE tf='D' GROUP BY ticker HAVING first_ts>=? AND first_ts>0""",
        (int(since_ymd),),
    ).fetchall()
    return {str(r[0]).upper(): int(r[1]) for r in rows}


def recent_relisting_candidates(since_ymd: int, floor_ymd: int,
                                gap_days: int = 21, price_factor: float = 4.0) -> dict:
    """{TICKER: resume YYYYMMDD} for tickers that RESUMED trading on/after since_ymd after a
    long gap with a big price jump — a recycled symbol whose NEW listing is recent (SPCX).

    Deliberately requires an ACTUAL gap (never a ticker's first bar), so continuous names and
    short-history on-demand names are NOT flagged — this is the small reuse OVERLAY for the
    IPO scan (recent_first_trade already covers normal IPOs), and callers verify each hit
    against the chart sanitize. Matches bars_sanitize's metadata-free reuse signal (gap >=
    gap_days days + a >= price_factor / <= 1/price_factor close jump). `floor_ymd` bounds the
    window scan for performance."""
    lo = 1.0 / price_factor if price_factor else 0.0
    rows = _conn().execute(
        """
        WITH parsed AS (
          SELECT ticker, ts, c,
                 julianday(substr(printf('%08d', ts),1,4)||'-'||
                           substr(printf('%08d', ts),5,2)||'-'||
                           substr(printf('%08d', ts),7,2)) AS jd
          FROM ohlcv WHERE tf='D' AND c>0 AND ts>=?
        ),
        seg AS (
          SELECT ticker, ts,
                 jd - LAG(jd) OVER w AS gap_days,
                 c*1.0 / NULLIF(LAG(c) OVER w, 0) AS ratio
          FROM parsed
          WINDOW w AS (PARTITION BY ticker ORDER BY ts)
        )
        SELECT ticker, MAX(ts) FROM seg
        WHERE gap_days>=? AND (ratio>=? OR ratio<=?) AND ts>=?
        GROUP BY ticker
        """,
        (int(floor_ymd), int(gap_days), float(price_factor), float(lo), int(since_ymd)),
    ).fetchall()
    return {str(r[0]).upper(): int(r[1]) for r in rows}


def avg_daily_volume(tickers, sessions: int = 20, before_ymd: int | None = None) -> dict:
    """{TICKER: average daily volume over its last `sessions` COMPLETED daily bars}.

    Excludes today's evolving bar when `before_ymd` (a YYYYMMDD int) is given. The
    last-N-per-ticker window can't be a single GROUP BY, so this runs one small
    indexed query per ticker — callers pass a bounded batch (the watchlist meta
    batch caps at 100). Powers the RVOL column (live volume / this average)."""
    conn = _conn()
    upper = int(before_ymd) if before_ymd is not None else 99999999
    out: dict = {}
    for t in tickers or []:
        tu = str(t).upper()
        try:
            row = conn.execute(
                """SELECT AVG(v) FROM (
                       SELECT v FROM ohlcv
                       WHERE ticker=? AND tf='D' AND v>0 AND ts<?
                       ORDER BY ts DESC LIMIT ?
                   )""",
                (tu, upper, int(sessions)),
            ).fetchone()
        except Exception:
            continue
        if row and row[0]:
            out[tu] = int(round(row[0]))
    return out


def first_trade_dates(tickers) -> dict:
    """{TICKER: earliest daily-bar ts (YYYYMMDD)} for the GIVEN tickers — a proxy for the
    IPO / first-trade date, given bars.db's since-inception daily coverage for the tracked
    universe. One indexed GROUP BY over a bounded ticker list. Powers the watchlist
    'IPO Date' column (callers pass the meta batch's ≤100 tickers)."""
    syms = [str(t).upper() for t in (tickers or []) if t]
    if not syms:
        return {}
    ph = ",".join("?" * len(syms))
    rows = _conn().execute(
        f"""SELECT ticker, MIN(ts) AS first_ts FROM ohlcv
            WHERE tf='D' AND ticker IN ({ph}) GROUP BY ticker HAVING first_ts>0""",
        syms,
    ).fetchall()
    return {str(r[0]).upper(): int(r[1]) for r in rows}


def current_listing_starts(since_ymd: int, gap_days: int = 21, price_factor: float = 4.0) -> dict:
    """{TICKER: current-listing-start YYYYMMDD} — the first daily bar of each ticker's
    MOST-RECENT continuous listing, detecting ticker REUSE (a recycled symbol whose new
    security starts after a long gap with a big price discontinuity: SPCX, DRAM, RMIX…).

    A reuse boundary is a gap ≥ `gap_days` calendar days WITH a ≥ `price_factor` (or
    ≤ 1/price_factor) close jump — the same metadata-free signal bars_sanitize uses. The
    scan is bounded to bars on/after `since_ymd` (a ~2-year floor is plenty to place any
    listing that began within the last year and keeps the window query fast). Continuous
    names report their earliest IN-WINDOW bar — fine, since callers only test recency /
    an as-of date, never treat it as the true multi-year IPO date.

    One window-function pass (julianday gap + close-ratio) — powers the reuse-aware IPO
    scan and the gainers scans' "listed after the lookback start ⇒ drop" filter."""
    lo = 1.0 / price_factor if price_factor else 0.0
    rows = _conn().execute(
        """
        WITH parsed AS (
          SELECT ticker, ts, c,
                 julianday(substr(printf('%08d', ts),1,4)||'-'||
                           substr(printf('%08d', ts),5,2)||'-'||
                           substr(printf('%08d', ts),7,2)) AS jd
          FROM ohlcv WHERE tf='D' AND c>0 AND ts>=?
        ),
        seg AS (
          SELECT ticker, ts,
                 jd - LAG(jd) OVER w AS gap_days,
                 c*1.0 / NULLIF(LAG(c) OVER w, 0) AS ratio
          FROM parsed
          WINDOW w AS (PARTITION BY ticker ORDER BY ts)
        )
        SELECT ticker, MAX(ts) FROM seg
        WHERE gap_days IS NULL OR (gap_days>=? AND (ratio>=? OR ratio<=?))
        GROUP BY ticker
        """,
        (int(since_ymd), int(gap_days), float(price_factor), float(lo)),
    ).fetchall()
    return {str(r[0]).upper(): int(r[1]) for r in rows}


def nth_recent_trading_date(n: int, before_ymd: int) -> int | None:
    """The Nth most-recent DISTINCT daily-bar date (YYYYMMDD int) strictly before
    before_ymd — the market trading calendar (distinct ts across all tickers, so a
    single-name gap can't skew it). Powers the Top-Gainers scans' "N trading days back"
    reference date. None when fewer than N sessions exist.

    ⛔⛔ THE QUERY THAT HELD THE BOOT, incident 2026-10-02. With
    `idx_ohlcv_daily_bydate` this is a SEARCH that reads ~N index entries. WITHOUT
    it the only usable index leads with `ticker`, and SQLite's plan is a SCAN of
    the whole `idx_ohlcv_lookup` (every row of every timeframe) plus two temp
    b-trees -- measured 10,017,000 vs 6,000 VM steps on a 2M-row fixture; on the
    31 GB production store it is a full read of the volume. The lifespan reached
    it through the pattern-vision contract line, on the event-loop thread.
    So the full-market query runs ONLY when the by-date index exists; otherwise the
    calendar is the DISTINCT union of a few always-trading index ETFs, read through
    the (ticker, tf, ts DESC) lookup index -- a few thousand rows, never a scan.
    (Four names, not one, so a single-name gap still cannot skew it.)"""
    if daily_bydate_index_ready():
        row = _conn().execute(
            """SELECT ts FROM (
                   SELECT DISTINCT ts FROM ohlcv WHERE tf='D' AND ts<? ORDER BY ts DESC LIMIT ?
               ) ORDER BY ts ASC LIMIT 1""",
            (int(before_ymd), int(n)),
        ).fetchone()
    else:
        marks = ",".join("?" * len(CALENDAR_REFERENCE_TICKERS))
        row = _conn().execute(
            f"""SELECT ts FROM (
                    SELECT DISTINCT ts FROM ohlcv
                    WHERE ticker IN ({marks}) AND tf='D' AND ts<?
                    ORDER BY ts DESC LIMIT ?
                ) ORDER BY ts ASC LIMIT 1""",
            (*CALENDAR_REFERENCE_TICKERS, int(before_ymd), int(n)),
        ).fetchone()
    return int(row[0]) if row and row[0] else None


#: Always-trading names whose daily bars define the session calendar when the
#: by-date index is absent (see `nth_recent_trading_date`).
CALENDAR_REFERENCE_TICKERS = ("SPY", "QQQ", "IWM", "DIA")


def close_n_sessions_back(n: int, before_ymd: int) -> dict:
    """{TICKER: close} of the Nth most-recent COMPLETED daily session strictly BEFORE
    before_ymd (YYYYMMDD int) — the reference close for an "N-day change" measured against
    a live price (matches the frontend's N-day column: N trading days back).

    One window-function pass over daily bars. Tickers with fewer than N completed sessions
    are absent (they can't form an N-day move — e.g. recent IPOs). Powers the Top-Gainers
    scans."""
    rows = _conn().execute(
        """SELECT ticker, c FROM (
               SELECT ticker, c,
                      ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY ts DESC) AS rn
               FROM ohlcv
               WHERE tf='D' AND ts<? AND c>0
           ) WHERE rn=?""",
        (int(before_ymd), int(n)),
    ).fetchall()
    return {str(r[0]).upper(): float(r[1]) for r in rows}


def avg_dollar_volume_bulk(sessions: int, before_ymd: int, floor_ymd: int) -> dict:
    """{TICKER: AVG(close*volume) over its last `sessions` COMPLETED daily bars strictly
    before before_ymd} — the tradability metric for the preset scans. One window-function
    pass, bounded to bars on/after floor_ymd for speed (floor should cover `sessions` days)."""
    rows = _conn().execute(
        """
        WITH recent AS (
          SELECT ticker, c*v AS dv,
                 ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY ts DESC) AS rn
          FROM ohlcv WHERE tf='D' AND ts<? AND ts>=? AND c>0 AND v>0
        )
        SELECT ticker, AVG(dv) FROM recent WHERE rn<=? GROUP BY ticker
        """,
        (int(before_ymd), int(floor_ymd), int(sessions)),
    ).fetchall()
    return {str(r[0]).upper(): float(r[1]) for r in rows if r[1]}


def get_all_tickers() -> list[tuple]:
    """Return all (ticker, tf) pairs that have at least one row stored, ordered by ticker."""
    return _conn().execute(
        "SELECT DISTINCT ticker, tf FROM ohlcv ORDER BY ticker, tf"
    ).fetchall()


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
            # PRAGMA quick_check, NOT integrity_check. The full integrity_check
            # cross-verifies every index against its table content — on this 58M-row
            # store that grew to 283 SECONDS at boot (2026-08-19), and it runs in a
            # CPU-heavy background thread that starved the single event loop for ~5
            # min after every deploy (warm charts served at 20-42s during the window).
            # quick_check reads the same b-tree pages and catches the "disk image is
            # malformed" / structural corruption this probe exists to detect (its whole
            # purpose per the docstring), but SKIPS the expensive index-content pass —
            # ~an order of magnitude faster. Deep index/content drift is caught at
            # runtime + by bars_reconciliation, not needed on the boot-safety path.
            row = c.execute("PRAGMA quick_check").fetchone()
            return bool(row and row[0] == "ok")
        finally:
            c.close()
    except sqlite3.DatabaseError as e:
        _logger.error(f"[sqlite] quick_check failed to open bars.db: {e}")
        return False


def integrity_smoke_ok() -> bool:
    """Near-instant structural smoke probe for /data/bars.db — the BOOT-path
    replacement for the full ``PRAGMA quick_check``.

    quick_check reads every b-tree page (~200-280s on this 58M-row store) and,
    even in a background thread, its CPU/IO starved the single-process web pod for
    ~5 min after EVERY deploy (warm charts served at 20-42s during the window).
    This does NOT scan the whole file: it opens the db and exercises the header,
    the schema b-tree, the ohlcv table b-tree (head + tail pages), and the lookup
    index b-tree with a handful of O(1) reads. A "disk image is malformed" from a
    crash mid-write or disk fault trips one of these instantly.

    Coverage trade — deliberate, and the same one quick_check already accepted for
    index/content drift: deep corruption in a COLD interior page this probe never
    touches is left to (1) the runtime malformed-error path (``_is_malformed_error``
    → resync), (2) the deferred periodic full ``integrity_ok`` deep pass, and
    (3) bars_reconciliation. The snapshot web pulls was already integrity-checked
    on the worker before upload (data_sync assert-shippable), so a web-local
    mid-write crash is the realistic corruption this guards, and it lives on the
    hot pages this touches.

    Returns True on a missing file (init_db creates fresh) or when every probe read
    succeeds; False on any DatabaseError (structural corruption).
    """
    if not os.path.exists(_DB_PATH):
        return True
    try:
        c = sqlite3.connect(_DB_PATH, timeout=10)
        try:
            c.execute("PRAGMA schema_version").fetchone()               # db header
            c.execute("SELECT count(*) FROM sqlite_master").fetchone()  # schema b-tree
            # ohlcv table b-tree — head page (LIMIT 1) + tail page (rowid DESC).
            # Any ticker: this validates STRUCTURE, not the presence of a symbol.
            c.execute("SELECT ticker,tf,ts,c FROM ohlcv LIMIT 1").fetchone()
            c.execute("SELECT ts FROM ohlcv ORDER BY rowid DESC LIMIT 1").fetchone()
            # Lookup index b-tree via the exact hot serve path (idx_ohlcv_lookup).
            c.execute("SELECT ts FROM ohlcv WHERE ticker='AAPL' AND tf='D' "
                      "ORDER BY ts DESC LIMIT 1").fetchone()
            return True
        finally:
            c.close()
    except sqlite3.DatabaseError as e:
        _logger.error(f"[sqlite] integrity smoke probe failed: {e}")
        return False


def _is_malformed_error(exc: BaseException) -> bool:
    """True if the SQLite exception indicates on-disk corruption.

    ``database disk image is malformed`` is the canonical message; we also
    match the lowercase substring as a defense against minor wording
    changes between SQLite versions."""
    msg = str(exc).lower()
    return "malformed" in msg


#: The distinct things that can be wrong with the bars store, named by what an
#: operator must DO about each rather than by what SQLite happened to say.
STORE_OK = "ok"
STORE_EMPTY = "empty"                    # table is there, holds nothing
STORE_SCHEMA_MISSING = "schema-missing"  # self-repairable: init_db() recreates it
STORE_MALFORMED = "malformed"            # needs a snapshot restore and a human
STORE_TRANSIENT = "transient"            # the ~30 s inode swap during force_resync


def classify_fault(exc: BaseException) -> str:
    """Classify a bars-store exception into something actionable.

    ⭐ THIS LIVES HERE, BESIDE THE CONNECTION CODE, ON PURPOSE. It is the
    store's own knowledge, and it now drives TWO callers — the request path's
    self-repair (`api/routers/bars.py`) and the background monitor's alerting
    (`bars_continuous_audit`). A second copy in either of them would be a
    second authority over one value, which is the defect that has cost this
    repo more outages than any other.

    ⛔ `malformed` is checked BEFORE `no such table`: a corrupt image can
    report a missing table as a *symptom*, and treating that as self-repairable
    would run `CREATE TABLE` against damage.
    """
    if _is_malformed_error(exc):
        return STORE_MALFORMED
    text = str(exc).lower()
    if "no such table" in text:
        return STORE_SCHEMA_MISSING
    if "not a database" in text or "corrupt" in text:
        return STORE_MALFORMED
    return STORE_TRANSIENT


def store_health() -> dict:
    """Ask the store, right now, whether it can answer for any bar at all.

    🔴 WRITTEN AFTER 2026-08-10, WHERE NOTHING NOTICED THE STORE WAS GONE.
    `/data/bars.db` lost its `ohlcv` table mid-session and charts were dead for
    a session, and the only thing watching — `bars_continuous_audit` — went
    SILENT rather than red, two different ways (see that module).

    ⭐ IT READS THE ARTIFACT, NOT A PROXY. One `SELECT 1 ... LIMIT 1` against
    the same thread-local handle a request would use, so the answer is what a
    member's chart would get — not a counter, not a streak, not a sample.
    ⛔ Deliberately NOT `COUNT(*)`: on 119M rows that is a table scan, and a
    monitor that is expensive gets its interval raised until it is useless.

    Returns ``{"ok": bool, "kind": <STORE_*>}``. Never raises — a health check
    that can crash its own caller is how the last one stayed quiet.
    """
    try:
        row = _conn().execute("SELECT 1 FROM ohlcv LIMIT 1").fetchone()
    except Exception as e:      # noqa: BLE001
        kind = classify_fault(e)
        return {"ok": False, "kind": kind, "detail": str(e)[:200]}
    if row is None:
        # ⚠️ An intact, EMPTY table is its own fault kind. It cannot be reached
        # by the request path's exception handler (nothing throws — every query
        # just answers "no rows"), so if this function did not name it, it
        # would stay invisible exactly as it did on 8/10.
        return {"ok": False, "kind": STORE_EMPTY, "detail": "ohlcv holds 0 rows"}
    return {"ok": True, "kind": STORE_OK, "detail": ""}


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


#: 🔴 THE WRITE-PATH INVARIANT, AND IT LIVES HERE BECAUSE HERE IS THE ONLY PLACE
#: EVERY APPLICATION WRITE PASSES. The 2026-08-09 audit found **3,533 daily bars
#: whose open sits outside `[low, high]`** (`GME 2026-08-03 o=20.46 h=20.45`;
#: `MSC 2026-07-10 o=1.89 h=1.76`), 32 with the close outside it, 119 with a NULL
#: close beside 20 M shares of volume, and **ZERO intraday violations**. That
#: asymmetry is the diagnosis: `bar_validation.validate_bar` already encoded
#: every one of these rules, and its callers were the INTRADAY fetch chain, the
#: disk serving cache and two read-only auditors. The daily chain — `_fetch_daily`,
#: `_fetch_daily_yf`, `_delta_daily` — called none of them, and this function
#: validated nothing. The deep-warm path demonstrates it in twelve lines: it
#: writes a payload to SQLite unvalidated, then writes the SAME object through
#: `bars_disk_cache.put`, which validates it and quarantines the bad bars. The
#: chart cache came out clean; the store kept the impossible row.
#:
#: ⛔ IT IS THE GEOMETRY ONLY, NEVER THE PLAUSIBILITY. `possible_bar_reasons`
#: asks whether the bar COULD have happened; `validate_bar`'s wide-bar and
#: prior-close gates are thresholded heuristics, right for a cache boundary and
#: wrong here — they would refuse to store a genuinely violent session.
#:
#: ⛔ AND A REJECTED BAR IS DROPPED, NEVER COERCED. Clamping `o` into `[l, h]`, or
#: widening `h` to admit it, fabricates a print that did not happen — which is
#: the defect class this audit exists to remove, not a repair of it. The
#: `_delta_daily` path refetches the last ten sessions on every touch, so a
#: rejected frontier bar is re-supplied from the provider once the session
#: settles; that is what makes dropping the honest answer rather than the lossy
#: one.
#:
#: ⚠️ THE RETURN VALUE IS NOW THE ACCEPTED COUNT. `alert_bars_freshness` reads it
#: as `if not rows: status = "empty"`, so returning `len(bars)` after rejecting
#: all of them would report success on a batch that stored nothing.
#:
#: Kill switch: `BARS_WRITE_VALIDATION=0` — an escape hatch, not a mode. With it
#: off the store can accept an impossible bar again.
def _writable_bars(ticker: str, tf: str, bars: list[dict]) -> tuple[list[dict], list[tuple]]:
    """Split `bars` into (storable, [(bar, reasons)]). Never raises."""
    if os.environ.get("BARS_WRITE_VALIDATION", "1") == "0":
        return list(bars), []
    try:
        from api.services.bar_validation import possible_bar_reasons
    except Exception:                                    # pragma: no cover
        return list(bars), []
    # 🔴 THE DATE-KEY INVARIANT, AT THE SAME DOOR (2026-11-11): a D row only on an NYSE
    # trading day, a W row only on its ISO-week Friday, an M row only on the 1st. Prod
    # held a SATURDAY daily bar (META et al. 2026-11-07) that drew as an extra candle
    # and was summed into the week. Rule + rationale: `date_bar_keys` module doc.
    key_reason = None
    if tf in ("D", "W", "M"):
        try:
            from api.services import date_bar_keys as _dk
            if tf != "D" or _dk.calendar_applies(ticker):
                key_reason = _dk.key_reason
        except Exception:                                # pragma: no cover
            key_reason = None
    keep, rejected = [], []
    for b in bars:
        try:
            reasons = possible_bar_reasons(b)
            if key_reason is not None:
                why = key_reason(tf, b.get("t"))
                if why:
                    reasons = [*reasons, why]
        except Exception:                                # pragma: no cover
            reasons = []
        if reasons:
            rejected.append((b, reasons))
        else:
            keep.append(b)
    if rejected:
        _logger.warning(
            "[sqlite] put_bars refused %d/%d impossible bars for %s tf=%s; first: t=%r %s",
            len(rejected), len(bars), ticker, tf,
            rejected[0][0].get("t"), rejected[0][1])
    return keep, rejected


#: 🔴 THE GRID INVARIANT, AT THE SAME DOOR (2026-11-10). An intraday row is keyed on
#: its BUCKET START. Prod held post-market rows stamped at a trade time (SPY 5m
#: 16:35:50 beside 16:35:00), each drawn as an extra candle — the yfinance fallback's
#: separate live row, written add-only beside the Massive grid row. A misaligned row
#: whose bucket has a row in the batch is dropped (that row wins); otherwise it is
#: snapped to the bucket start and written INSERT OR IGNORE (fills an empty bucket,
#: never replaces a stored one). Rule + rationale: `intraday_grid` module doc.
def _grid_rows(ticker: str, tf: str, bars: list[dict], date_tf: bool) -> tuple[list[dict], list[dict]]:
    if date_tf or not bars:
        return bars, []
    try:
        from api.services import intraday_grid
        return intraday_grid.fold_for_write(ticker, tf, bars)
    except Exception as e:                               # pragma: no cover
        _logger.warning("[sqlite] grid fold failed for %s tf=%s (writing as-is): %s", ticker, tf, e)
        return bars, []


def put_bars_many(tf: str, bars_by_ticker: dict[str, list[dict]]) -> int:
    """Upsert many tickers' bars of ONE timeframe in a single transaction.

    The universe live feed (`bars_live_store`) lands ~10k tickers' newest bucket a
    minute; one `put_bars` per ticker would be ~10k transactions, each taking the
    write lock. Same validity gate and the same INSERT OR REPLACE as `put_bars`.
    `t` is the stored integer key (unix seconds intraday, YYYYMMDD for D)."""
    rows = []
    snapped_rows = []
    for ticker, bars in (bars_by_ticker or {}).items():
        keep, _rejected = _writable_bars(ticker.upper(), tf, bars)
        keep, snapped = _grid_rows(ticker.upper(), tf, keep, False)
        for b in keep:
            rows.append((ticker.upper(), tf, int(b.get("t", 0)), b.get("o"), b.get("h"),
                         b.get("l"), b.get("c"), int(b.get("v") or 0)))
        for b in snapped:
            snapped_rows.append((ticker.upper(), tf, int(b["t"]), b.get("o"), b.get("h"),
                                 b.get("l"), b.get("c"), int(b.get("v") or 0)))
    if not rows and not snapped_rows:
        return 0
    last_lock_err: sqlite3.OperationalError | None = None
    for attempt in range(3):
        try:
            with _WRITE_LOCK:
                c = _conn()
                _hist = _history_keys(c, tf, rows) | _history_keys(c, tf, snapped_rows, replace=False)
                c.executemany(
                    "INSERT OR REPLACE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)",
                    rows,
                )
                if snapped_rows:
                    c.executemany(
                        "INSERT OR IGNORE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)",
                        snapped_rows,
                    )
                bump_series_revs(c, {(r[0], tf) for r in rows} | {(r[0], tf) for r in snapped_rows},
                                 history=_hist)
                c.commit()
            return len(rows) + len(snapped_rows)
        except sqlite3.OperationalError as e:
            if "locked" not in str(e).lower():
                raise
            last_lock_err = e
            time.sleep(0.05 * (attempt + 1))
    if last_lock_err is not None:
        raise last_lock_err
    return 0


# ── PROVIDER CHECK INSTANT OF A WRITE (bar contract, review #1098 F2) ────────────
# ⛔ Concurrent repairs of one series (the request tail repair, the since= background
# repair, the background gap-fill, the warm loop) each persist what the provider said AT
# THEIR CHECK. One that checked EARLIER but writes LATER would REPLACE final rows with an
# older partial aggregate inside the span a newer check already sealed — and
# complete_through would call that partial final. A write that knows its check instant
# (`checked_at=`, or the thread's `provider_check` context the repair opens) may not
# change rows inside the sealed span when that instant predates the seal's own check.
# Writes with no check instant (corrections: split repair, merges, rebuilds) are not
# filtered — they are what `history_rev` announces.
_check_ctx = threading.local()


class provider_check:
    """`with provider_check(checked_at):` — every `put_bars` on this thread inside the
    block persists a provider answer taken at `checked_at`."""

    def __init__(self, checked_at: float):
        self.checked_at = float(checked_at)

    def __enter__(self):
        self._prev = getattr(_check_ctx, "at", None)
        _check_ctx.at = self.checked_at
        return self

    def __exit__(self, *exc):
        _check_ctx.at = self._prev
        return False


_stale_sealed_drops = {"rows": 0, "writes": 0}


def _drop_stale_sealed(c, ticker: str, tf: str, rows: list, snapped: list, checked_at: float):
    """Rows of a write checked at `checked_at` minus those inside a seal taken by a NEWER
    check (see the block above)."""
    m = series_meta(ticker, tf, _conn_override=c)
    sealed, sealed_ck = m.get("sealed_through"), m.get("sealed_checked_at")
    if sealed is None or sealed_ck is None or checked_at >= sealed_ck:
        return rows, snapped
    try:
        from api.services import bar_contract
        grid = bar_contract.grid_for(tf)

        def keep(r):
            b = bar_contract.bucket_bounds(tf, int(r[2]), grid)
            return b is None or b[1] > sealed
    except Exception:                                    # noqa: BLE001
        return rows, snapped
    k_rows = [r for r in rows if keep(r)]
    k_snap = [r for r in snapped if keep(r)]
    dropped = len(rows) + len(snapped) - len(k_rows) - len(k_snap)
    if dropped:
        _stale_sealed_drops["rows"] += dropped
        _stale_sealed_drops["writes"] += 1
        _logger.info("[sqlite] %s tf=%s: kept %d sealed row(s) from an older check's write",
                     ticker, tf, dropped)
    return k_rows, k_snap


def put_bars(ticker: str, tf: str, bars: list[dict], date_tf: bool = False,
             on_conflict: str = "replace", checked_at: float | None = None) -> int:
    """Upsert bars.  date_tf=True means bar["t"] is 'YYYY-MM-DD' → YYYYMMDD int.

    ``on_conflict``: "replace" (default — INSERT OR REPLACE, the authoritative
    serve/prewarm write) or "ignore" (INSERT OR IGNORE — ADD-ONLY, keeps any
    existing row on a PK collision). "ignore" is for gap-fillers that must NEVER
    downgrade a fresher local bar (the web-side Bars Pack ingest).
    Returns the number of rows ACCEPTED and written — see ``_writable_bars``: a
    bar that does not describe a possible session is dropped, counted and logged,
    never stored and never coerced into shape.

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
    bars, _rejected = _writable_bars(ticker, tf, bars)
    bars, snapped = _grid_rows(ticker, tf, bars, date_tf)
    if not bars and not snapped:
        return 0
    rows = []
    for b in bars:
        t = b.get("t", 0)
        ts = int(str(t).replace("-", "")) if date_tf else int(t)
        rows.append((
            ticker, tf, ts,
            b.get("o"), b.get("h"), b.get("l"), b.get("c"),
            int(b.get("v") or 0),
        ))
    snapped_rows = [(ticker, tf, int(b["t"]), b.get("o"), b.get("h"), b.get("l"),
                     b.get("c"), int(b.get("v") or 0)) for b in snapped]

    _verb = "INSERT OR IGNORE" if on_conflict == "ignore" else "INSERT OR REPLACE"
    last_lock_err: sqlite3.OperationalError | None = None
    for attempt in range(3):
        try:
            with _WRITE_LOCK:
                c = _conn()
                _ck = checked_at if checked_at is not None else getattr(_check_ctx, "at", None)
                if _ck is not None and not date_tf:
                    rows, snapped_rows = _drop_stale_sealed(c, ticker, tf, rows, snapped_rows, _ck)
                    if not rows and not snapped_rows:
                        return 0
                _hist = (_history_keys(c, tf, rows, replace=(on_conflict != "ignore"))
                         | _history_keys(c, tf, snapped_rows, replace=False))
                _changes0 = c.total_changes
                if rows:
                    c.executemany(
                        f"{_verb} INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)",
                        rows,
                    )
                if snapped_rows:
                    # Snapped off-grid rows fill an EMPTY bucket only (intraday_grid doc).
                    c.executemany(
                        "INSERT OR IGNORE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)",
                        snapped_rows,
                    )
                if c.total_changes != _changes0:
                    bump_series_revs(c, [(ticker, tf)], history=_hist)
                c.commit()
            return len(rows) + len(snapped_rows)
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


def iter_ts_close(ticker: str, tf: str, batch: int = 20_000):
    """Yield ``(ts, c)`` for every stored row of (ticker, tf), oldest first, paged by
    primary-key seeks of ``batch`` rows. O(batch) memory however deep the series is —
    the intraday split detector only needs closes, never a materialised bar list."""
    ticker = ticker.upper()
    last = None
    while True:
        if last is None:
            rows = _conn().execute(
                "SELECT ts, c FROM ohlcv WHERE ticker=? AND tf=? ORDER BY ts LIMIT ?",
                (ticker, tf, int(batch))).fetchall()
        else:
            rows = _conn().execute(
                "SELECT ts, c FROM ohlcv WHERE ticker=? AND tf=? AND ts>? ORDER BY ts LIMIT ?",
                (ticker, tf, int(last), int(batch))).fetchall()
        if not rows:
            return
        yield from rows
        last = rows[-1][0]
        if len(rows) < batch:
            return


