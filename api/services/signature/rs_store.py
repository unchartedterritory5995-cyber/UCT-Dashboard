"""RS answers that outlive the process, and the shared cache's 1,000 entries.

THE PROBLEM (measured on production 2026-11-13)
-----------------------------------------------
An RS envelope (the line, the rating, the phases, the distance from its average)
costs 0.7 to 1.3 s to build for a symbol nobody has asked for yet, and it is kept
in `api.services.cache.cache`: in memory, 1,000 entries for the WHOLE app (bars,
news, snapshots, movers all share them), emptied by every deploy. So "already
computed" was true for minutes, not for the session the answer is valid for, and
after each deploy every symbol was cold for every member again.

WHAT THIS IS
------------
The same envelope, under the same key, in one sqlite file on the service's own
volume. `rs_provider` asks memory first and this second; a build is written
through, off the request (one writer thread, a bounded queue that drops when it
is full: a write that is skipped costs one more build later and nothing else).

WHY IT IS CORRECT AND NOT JUST FAST
-----------------------------------
Nothing here decides how long an answer lives. The key is the provider's own
(`compute.rev`, payload shape, symbol, timeframe, inputs, the data generation
and the ET session day are all in it), and each row carries the ABSOLUTE instant
the memory entry would have expired (`cache.set(ck, envelope, ttl)`'s). A read
after that instant is a miss; a read before it puts the envelope back in memory
for exactly the time it had left. A restart therefore changes when an answer is
recomputed for nobody: it serves what the process before it would have served.
The forming bar is not in question either: the chart moves the newest cell
itself (`plots[].liveTail`), from the bars route the candle comes from.

ONE THING IT IS STRICTER ABOUT THAN MEMORY
------------------------------------------
During a regular session the forming day's cells of a D/W/M answer are a snapshot
of the minute it was built (the RS line itself is moved live by the chart; the
other panes and the readout's numbers are not). In memory such an answer was, in
practice, rebuilt many times a day (evictions, deploys). A file would have made
the first build of the day the answer until the close, for every member. So a
caller may bound a read by AGE (`get(..., max_age=)`), and the provider does:
ten minutes while the session is open (`rs_provider._rs_disk_max_age`), no bound
outside it, when nothing is forming. A row past its bound is a miss, and one
within it goes back into memory only for what is left of the bound.

WHAT IT REFUSES
---------------
* an answer with under `MIN_TTL_S` to live (the one-minute "no benchmark bars
  yet" answer is never kept: the worker may land the rows any second);
* an envelope over `MAX_ENTRY_BYTES` compressed;
* any write while the volume has under `MIN_FREE_BYTES` free; and over its cap
  (`MAX_BYTES`, 200 MB of rows) the rows closest to expiry go first. A cache
  must never be the thing that fills a volume
  (docs/runbooks/flow-worker-deploys-and-flow-db.md is what that costs).

Every failure is a miss or a skipped write, logged once a minute at most. A file
sqlite calls malformed is deleted once and started again (it holds nothing that
cannot be recomputed); if that fails too the store is off until the next boot.

Knob: `RS_ENVELOPE_STORE` (docs/feature_flags.json). `0` turns it off: no file
is opened, read or written, and the provider is exactly what it was.
"""
from __future__ import annotations

import json
import logging
import os
import queue
import shutil
import sqlite3
import threading
import time
import zlib

logger = logging.getLogger(__name__)

#: An answer with less life than this is not worth a write.
MIN_TTL_S = 300
#: One envelope, compressed. The largest measured (rsLine, 1,300 daily bars, every
#: column) is a small fraction of this.
MAX_ENTRY_BYTES = 2 * 1024 * 1024
#: The file's cap: what its rows may add up to (the sweep enforces it).
MAX_BYTES = 200 * 1024 * 1024
#: No write while the volume has less than this free.
MIN_FREE_BYTES = 2 * 1024 ** 3
#: Builds waiting to be written. Full: the newest is dropped.
QUEUE_MAX = 128
#: Expired rows are removed, and the cap enforced, after this many writes or
#: this many seconds, whichever comes first.
SWEEP_EVERY_WRITES = 200
SWEEP_EVERY_S = 600.0
#: The cap is enforced down to this share of itself, so one sweep buys room for
#: many writes.
SWEEP_TO = 0.9
#: After a failed read or write (a busy file, a volume that is not there) the
#: store is left alone for this long: every lookup is a miss without an open.
QUIET_AFTER_FAILURE_S = 15.0
#: The row format (`PRAGMA user_version`). A file on another format is emptied.
FORMAT = 1
_MAGIC = b"z1"

_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS env ("
    " ck TEXT PRIMARY KEY, expires_at REAL NOT NULL, saved_at REAL NOT NULL,"
    " bytes INTEGER NOT NULL, body BLOB NOT NULL)",
    "CREATE INDEX IF NOT EXISTS env_expires ON env(expires_at)",
)


def enabled() -> bool:
    return os.environ.get("RS_ENVELOPE_STORE", "1").strip() != "0"


def _data_dir() -> str:
    return os.environ.get("DATA_DIR", "/data")


def store_path() -> str:
    return os.environ.get("RS_ENVELOPE_STORE_PATH") or os.path.join(_data_dir(), "rs_envelopes.db")



# ── state: one process, one writer ───────────────────────────────────────────
_local = threading.local()
_lock = threading.Lock()
_CLOSE = object()               # queued by `reset_for_tests`: the writer lets go of its file
_queue: "queue.Queue[tuple]" = queue.Queue(maxsize=QUEUE_MAX)
_writer: threading.Thread | None = None
#: `gen` moves when the file is started again (`_heal`): every thread's connection
#: is to the file of one generation, and is reopened once that is not this one.
_state = {"off": False, "healed": False, "gen": 0, "prepared": None, "quiet_until": 0.0,
          "low_disk": False, "free_bytes": None, "kept_bytes": None, "last_log": 0.0,
          "writes_since_sweep": 0, "last_sweep": 0.0}
_stats = {"hits": 0, "misses": 0, "writes": 0, "dropped": 0, "skipped": 0, "errors": 0, "evicted": 0}


def stats() -> dict:
    """Counters since boot, for a health read. Never opens the file."""
    out = dict(_stats)
    out.update(enabled=enabled(), off=_state["off"], low_disk=_state["low_disk"],
               queued=_queue.qsize(), kept_bytes=_state["kept_bytes"], cap_bytes=MAX_BYTES,
               free_bytes=_state["free_bytes"])    # the last two as of the last sweep
    return out


def _note(msg: str, *args) -> None:
    _stats["errors"] += 1
    now = time.time()
    if now - _state["last_log"] >= 60.0:
        _state["last_log"] = now
        logger.warning("rs_store: " + msg, *args, exc_info=True)


def _key() -> tuple:
    return store_path(), _state["gen"]


def _prepare(key: tuple) -> None:
    """The file made ready ONCE per process (and once more after a heal): its
    directory, WAL, the row format, the table. Under the lock, so the first
    burst of requests after a boot does not race to create it; every later
    connection only opens it."""
    if _state["prepared"] == key:
        return
    with _lock:
        if _state["prepared"] == key:
            return
        path = key[0]
        d = os.path.dirname(path)
        if d:
            os.makedirs(d, exist_ok=True)
        conn = sqlite3.connect(path, timeout=2.0)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            if conn.execute("PRAGMA user_version").fetchone()[0] != FORMAT:
                conn.execute("DROP TABLE IF EXISTS env")
                conn.execute(f"PRAGMA user_version={FORMAT}")
            for stmt in _SCHEMA:
                conn.execute(stmt)
            conn.commit()
        finally:
            conn.close()            # a file that cannot be used is not left held open (it may be removed next)
        _state["prepared"] = key


def _connect(key: tuple) -> sqlite3.Connection:
    _prepare(key)
    conn = sqlite3.connect(key[0], timeout=0.25)
    try:
        conn.execute("PRAGMA synchronous=NORMAL")
    except BaseException:
        conn.close()
        raise
    return conn


def _conn() -> sqlite3.Connection:
    """This thread's connection to the file `store_path()` names now."""
    key = _key()
    held = getattr(_local, "conn", None)
    if held is not None and getattr(_local, "key", None) == key:
        return held
    _forget_conn()
    _local.conn, _local.key = _connect(key), key
    return _local.conn


def _forget_conn() -> None:
    held = getattr(_local, "conn", None)
    _local.conn = None
    if held is not None:
        try:
            held.close()
        except Exception:                              # noqa: BLE001
            pass


def _malformed(exc: BaseException) -> bool:
    """sqlite's own word for a file it cannot use (as against a busy one)."""
    if isinstance(exc, sqlite3.OperationalError):
        return False
    return isinstance(exc, sqlite3.DatabaseError)


def _failed(exc: BaseException, key: tuple, what: str) -> None:
    """One failed read or write: logged, this thread's connection dropped, and
    the file started again if sqlite calls it malformed AND it is still the file
    the failed call was made against (a thread still holding the file a heal
    already replaced must not spend the one heal there is)."""
    _note(what)
    _forget_conn()
    if _malformed(exc):
        if key == _key():
            _heal()
    else:
        # busy, or a volume that is not there: asking again at once only costs every request an open
        _state["quiet_until"] = time.time() + QUIET_AFTER_FAILURE_S


def _heal() -> None:
    """A malformed file is removed ONCE and started again; a second time the
    store is off until the next boot."""
    with _lock:
        if _state["healed"]:
            _state["off"] = True
            return
        _state["healed"] = True
        path = store_path()
        for suffix in ("", "-wal", "-shm"):
            try:
                os.remove(path + suffix)
            except FileNotFoundError:
                pass
            except OSError:
                _state["off"] = True
                return
        _state["gen"] += 1
        _state["prepared"] = None


def _quiet() -> bool:
    return _state["quiet_until"] > 0.0 and time.time() < _state["quiet_until"]


# ── read ─────────────────────────────────────────────────────────────────────

def get(ck: str, now: float | None = None, max_age: float | None = None):
    """``(envelope, seconds_left)`` for a live row, else None. Never raises.

    ``max_age`` (seconds since the row was BUILT) bounds the read: a row older
    than it is a miss, and ``seconds_left`` is never more than what is left of
    the bound (see "ONE THING IT IS STRICTER ABOUT THAN MEMORY" above)."""
    if not enabled() or _state["off"] or _quiet():
        return None
    key = _key()
    try:
        row = _conn().execute("SELECT body, expires_at, saved_at FROM env WHERE ck=?", (ck,)).fetchone()
    except Exception as exc:                           # noqa: BLE001 — a miss, never a failed chart
        _failed(exc, key, "read failed")
        return None
    now = time.time() if now is None else now
    left = None if row is None else row[1] - now
    if left is not None and max_age is not None:
        left = min(left, max_age - (now - row[2]))
    if left is None or left <= 1.0:
        _stats["misses"] += 1
        return None
    try:
        body = bytes(row[0])
        if body[:len(_MAGIC)] != _MAGIC:
            raise ValueError("unknown row format")
        envelope = json.loads(zlib.decompress(body[len(_MAGIC):]))
        if not isinstance(envelope, dict) or not envelope.get("times"):
            raise ValueError("not an envelope")
    except Exception:                                  # noqa: BLE001
        _note("a row could not be read back")
        _stats["misses"] += 1
        return None
    _stats["hits"] += 1
    return envelope, left


# ── write (off the request) ──────────────────────────────────────────────────

def put(ck: str, envelope: dict, ttl: float) -> bool:
    """Queue `envelope` to be kept until ``now + ttl``. True when queued."""
    if not enabled() or _state["off"] or ttl < MIN_TTL_S or _quiet():
        return False
    # A tight volume is looked at again once a sweep is due: that one write goes
    # to the writer, which sweeps first and keeps it only if there is room now.
    if _state["low_disk"] and time.time() - _state["last_sweep"] < SWEEP_EVERY_S:
        _stats["skipped"] += 1
        return False
    _ensure_writer()
    try:
        _queue.put_nowait((ck, envelope, time.time() + ttl))
    except queue.Full:
        _stats["dropped"] += 1
        return False
    return True


def _ensure_writer() -> None:
    global _writer
    if _writer is not None and _writer.is_alive():
        return
    with _lock:
        if _writer is not None and _writer.is_alive():
            return
        _writer = threading.Thread(target=_write_loop, name="rs-store-writer", daemon=True)
        _writer.start()


def _write_loop() -> None:
    while True:
        item = _queue.get()
        key = _key()
        try:
            if item is _CLOSE:
                _forget_conn()
            else:
                _write(*item)
        except Exception as exc:                       # noqa: BLE001 — the writer never dies
            _failed(exc, key, "write failed")
        finally:
            _queue.task_done()


def _encode(envelope: dict) -> bytes:
    return _MAGIC + zlib.compress(json.dumps(envelope, separators=(",", ":")).encode("utf-8"), 1)


def _write(ck: str, envelope: dict, expires_at: float) -> None:
    now = time.time()
    if _state["off"] or expires_at - now < MIN_TTL_S / 2:
        return
    conn = _conn()
    if now - _state["last_sweep"] >= SWEEP_EVERY_S or _state["writes_since_sweep"] >= SWEEP_EVERY_WRITES:
        _sweep(conn, now)
    if _state["low_disk"]:
        _stats["skipped"] += 1
        return
    body = _encode(envelope)
    if len(body) > MAX_ENTRY_BYTES:
        _stats["skipped"] += 1
        return
    conn.execute("INSERT OR REPLACE INTO env(ck, expires_at, saved_at, bytes, body) VALUES (?,?,?,?,?)",
                 (ck, expires_at, now, len(body), body))
    conn.commit()
    _stats["writes"] += 1
    _state["writes_since_sweep"] += 1


def _sweep(conn: sqlite3.Connection, now: float) -> None:
    """Expired rows out; then, over the cap, the rows closest to expiry until the
    file holds `SWEEP_TO` of it; then the volume's free space, read once."""
    _state["last_sweep"] = now
    _state["writes_since_sweep"] = 0
    conn.execute("DELETE FROM env WHERE expires_at <= ?", (now,))
    total = conn.execute("SELECT COALESCE(SUM(bytes), 0) FROM env").fetchone()[0]
    cap = MAX_BYTES
    if total > cap:
        goal, gone = cap * SWEEP_TO, []
        for ck, size in conn.execute("SELECT ck, bytes FROM env ORDER BY expires_at ASC, saved_at ASC").fetchall():
            if total <= goal:
                break
            gone.append((ck,))
            total -= size
        conn.executemany("DELETE FROM env WHERE ck=?", gone)
        _stats["evicted"] += len(gone)
    conn.commit()
    _state["kept_bytes"] = int(total)
    try:
        free = shutil.disk_usage(os.path.dirname(store_path()) or ".").free
        _state["free_bytes"] = int(free)
        _state["low_disk"] = free < MIN_FREE_BYTES
    except OSError:
        _state["free_bytes"] = None
        _state["low_disk"] = True


def flush(timeout: float = 5.0) -> bool:
    """Wait until every queued write has been tried (tests, and a clean stop)."""
    deadline = time.time() + timeout
    while _queue.unfinished_tasks:
        if time.time() >= deadline:
            return False
        time.sleep(0.005)
    return True


def reset_for_tests() -> None:
    """Forget this process's state (never the file), and let go of the file."""
    if _writer is not None and _writer.is_alive():
        try:
            _queue.put_nowait(_CLOSE)
        except queue.Full:
            pass
    flush(2.0)
    _forget_conn()
    _state.update(off=False, healed=False, gen=0, prepared=None, quiet_until=0.0, low_disk=False,
                  free_bytes=None, kept_bytes=None, last_log=0.0, writes_since_sweep=0, last_sweep=0.0)
    for k in _stats:
        _stats[k] = 0
