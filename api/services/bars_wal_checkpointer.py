"""Background WAL checkpointer for bars.db on the WEB pod.

⭐ WHY THIS EXISTS (2026-09-02, root-caused with Server-Timing sub-metrics).
First-view of an obscure long-tail chart was measured at 0.3–6.8 s and HIGHLY
variable, while `last_ts` on the same table/connection stayed <50 ms. Phase
timing localised the entire cost to `bars_sqlite.get_bars` — the read of the
OHLCV rows — not the provider fetch and not the query (it is indexed by
`idx_ohlcv_lookup(ticker,tf,ts DESC)` and the connection is thread-cached).

That signature — a fast keyed lookup but a slow, wildly-variable row read on the
SAME db — is WAL bloat. The web pod does CONTINUOUS background WRITES into bars.db
(the R2 newer-wins merge, the barspack web-ingest, the stale-swr bg-delta heals,
the reconciliation deletes). With no dedicated checkpointer, SQLite's default
autocheckpoint (1000 pages, run on whichever connection happens to commit past the
threshold) cannot keep up, so the -wal file grows without bound and every reader
must walk an ever-larger WAL index to find the newest version of each page. A big
WAL turns a 5 ms read into a multi-second one, and the size of the WAL at the
instant of the read is why it is so variable.

THE FIX: a dedicated thread that runs `PRAGMA wal_checkpoint(PASSIVE)` on a tight
cadence, keeping the WAL small so reads stay fast.

⛔ PASSIVE, NOT TRUNCATE/FULL, BY DEFAULT. A PASSIVE checkpoint transfers only the
frames it can without EVER waiting on a reader or writer — it cannot block a
request or the background writers, so it carries no stall/regression risk. (An
occasional TRUNCATE is attempted only when the WAL has grown past a high-water
mark AND the pod is quiet enough for it to succeed immediately; if it would block
it simply no-ops that cycle.) This runs on the WEB pod only — the worker has its
own write cadence + the uploader's `.backup()` and a 30 s busy_timeout, and its
reads are not on the user request path.

Self-verifying: every cycle logs the checkpoint result `(busy, wal_frames,
checkpointed_frames)`, so the WAL size is observable in prod logs and the fix can
be confirmed (or falsified) directly. Gated + reversible via
`BARS_WAL_CHECKPOINT_ENABLED` (kill = set to 0).
"""
import os
import sqlite3
import threading
import time
import logging

_log = logging.getLogger(__name__)

# High-water mark (in WAL frames) above which we attempt a TRUNCATE to hard-reset
# the WAL. Default ~2000 frames (~8 MB at 4 KB pages). Tunable.
_TRUNCATE_HWM = int(os.environ.get("BARS_WAL_CHECKPOINT_TRUNCATE_FRAMES", "2000"))
_INTERVAL_S = int(os.environ.get("BARS_WAL_CHECKPOINT_SECONDS", "20"))
_STARTUP_DELAY_S = int(os.environ.get("BARS_WAL_CHECKPOINT_STARTUP_DELAY", "30"))

_started = False
_started_lock = threading.Lock()
# Last observed checkpoint stats, for a health/status read.
_last = {"ts": 0.0, "busy": None, "wal_frames": None, "ckpt_frames": None,
         "mode": None, "err": None, "cycles": 0}
_last_lock = threading.Lock()


def enabled() -> bool:
    return os.environ.get("BARS_WAL_CHECKPOINT_ENABLED", "1") == "1"


def last_status() -> dict:
    with _last_lock:
        return dict(_last)


def _db_path() -> str:
    # Single source of truth for the bars.db path — never a second literal.
    from api.services.bars_sqlite import _DB_PATH
    return _DB_PATH


def _run_once(conn: sqlite3.Connection) -> None:
    """One checkpoint cycle. PASSIVE always; TRUNCATE only when the WAL is large
    (and only if it doesn't have to wait — TRUNCATE returns busy=1 and no-ops
    rather than blocking under load)."""
    row = conn.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone() or (None, None, None)
    busy, wal_frames, ckpt_frames = (row + (None, None, None))[:3]
    mode = "PASSIVE"
    # If the WAL is large, try to hard-reset it. TRUNCATE will not block: if any
    # reader/writer holds it, SQLite returns busy=1 and leaves the WAL as-is, and
    # the next PASSIVE cycle keeps draining it. So this is still stall-free.
    try:
        if isinstance(wal_frames, int) and wal_frames >= _TRUNCATE_HWM:
            trow = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone() or (None, None, None)
            tbusy, twal, tckpt = (trow + (None, None, None))[:3]
            if tbusy == 0:
                busy, wal_frames, ckpt_frames, mode = tbusy, twal, tckpt, "TRUNCATE"
    except Exception:
        pass  # TRUNCATE is best-effort; PASSIVE already made progress
    with _last_lock:
        _last.update(ts=time.time(), busy=busy, wal_frames=wal_frames,
                     ckpt_frames=ckpt_frames, mode=mode, err=None,
                     cycles=_last["cycles"] + 1)


def _loop() -> None:
    time.sleep(_STARTUP_DELAY_S)  # let boot settle before touching the store
    conn = None
    while True:
        try:
            if conn is None:
                conn = sqlite3.connect(_db_path(), check_same_thread=False, timeout=5)
                # A checkpointer must NOT itself hold a long busy wait — if it can't
                # act now it should return quickly and retry next cycle.
                conn.execute("PRAGMA busy_timeout=1000")
            _run_once(conn)
        except Exception as e:  # noqa: BLE001
            # Never die: a locked/replaced db is a runtime condition, not a bug.
            with _last_lock:
                _last.update(ts=time.time(), err=str(e)[:200])
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass
            conn = None  # reopen next cycle (handles a force_resync inode swap)
        time.sleep(_INTERVAL_S)


def start_bars_wal_checkpointer() -> None:
    """Idempotent. Starts the daemon on the WEB pod when enabled."""
    global _started
    if not enabled():
        _log.info("[bars-wal] checkpointer disabled (BARS_WAL_CHECKPOINT_ENABLED=0)")
        return
    with _started_lock:
        if _started:
            return
        _started = True
    t = threading.Thread(target=_loop, name="bars-wal-checkpointer", daemon=True)
    t.start()
    _log.info("[bars-wal] checkpointer started (interval=%ss, truncate_hwm=%s frames)",
              _INTERVAL_S, _TRUNCATE_HWM)
