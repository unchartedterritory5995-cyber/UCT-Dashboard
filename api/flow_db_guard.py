"""flow.db WAL guard: keep SQLite from ever deleting the write-ahead log under a live writer.

⚰️ ROOT CAUSE FOUND 2026-11-13. flow.db was damaged 8 times in 5 days. On 11/13 the worker's PID 1
was seen holding `/data/flow.db-wal (deleted)` while its other connections used a NEW
`flow.db-wal`: two write-ahead logs for one database, the textbook SQLite corruption. Every
damage followed a moment when the file was swapped under a running process (a restore/merge swap
renamed the live -wal/-shm; long-lived connections kept writing into the renamed log) or two
containers had the volume during a deploy/restart (the old process, believing it held the LAST
connection, checkpointed and deleted the WAL the new one was using; POSIX locks do not span the
two). Damage showed hours later, which is why 3 looked "deploy-free".

SQLite deletes the WAL only when the LAST connection in a process closes. So:
  * `open_anchor()`: one connection held for the life of the process. No other close is ever
    the last, so the WAL is never deleted while this process runs.
  * `exit_now()`: after shutdown work, leave with `os._exit` so interpreter teardown never closes
    the anchor (a dying container must never delete the WAL a new one is using).
  * `stale_handles()` / `check_and_heal()`: the tripwire, called from the canary tick. A handle
    to a deleted flow.db, -wal or -shm means two logs are already in play: shout, then restart the
    process cleanly (SIGTERM; Railway's ALWAYS policy brings it back) before damage builds.
  * `request_restart()`: used after any file swap (flow_db_autorestore) for the same reason.

⛔ Never inspect flow.db with plain file I/O in this process: closing ANY descriptor on the file
drops every POSIX lock the process holds on it, which is exactly how SQLite comes to believe a
connection is the last one. Read it through SQLite only.
"""
from __future__ import annotations

import logging
import os
import signal
import sqlite3
import threading

log = logging.getLogger(__name__)

_ANCHOR = None
_lock = threading.Lock()
_state = {"restart_requested": False}


def _db_path() -> str:
    return os.environ.get("FLOW_DB_PATH", "/data/flow.db")


def open_anchor(path: str | None = None):
    """Open (once) and keep the anchor connection. Returns it; never raises."""
    global _ANCHOR
    with _lock:
        if _ANCHOR is not None:
            return _ANCHOR
        try:
            c = sqlite3.connect(path or _db_path(), timeout=30, check_same_thread=False)
            c.execute("SELECT count(*) FROM sqlite_master").fetchone()   # takes the shared lock
            _ANCHOR = c
            log.info("[flow-db-guard] anchor connection open on %s", path or _db_path())
        except Exception as e:  # noqa: BLE001 -- a guard must never stop the worker booting
            log.warning("[flow-db-guard] anchor not opened: %s", e)
        return _ANCHOR


def stale_handles(db_path: str | None = None, fd_dir: str = "/proc/self/fd") -> list:
    """Targets of this process's descriptors that point at a DELETED flow.db / -wal / -shm."""
    db = db_path or _db_path()
    bad = {db + " (deleted)", db + "-wal (deleted)", db + "-shm (deleted)"}
    out = []
    try:
        for fd in os.listdir(fd_dir):
            try:
                t = os.readlink(os.path.join(fd_dir, fd))
            except OSError:
                continue
            if t in bad:
                out.append(t)
    except OSError:
        return []
    return out


def _shout(msg: str) -> None:
    log.error(msg)
    try:
        from api import flow_backup
        flow_backup._post_discord(msg)
    except Exception:  # noqa: BLE001
        pass


def request_restart(reason: str) -> bool:
    """Ask for a clean process restart (once). Returns True if this call requested it."""
    with _lock:
        if _state["restart_requested"]:
            return False
        _state["restart_requested"] = True
    _shout("[flow-db-guard] ⛔ restarting flow-worker cleanly: %s" % reason)
    try:
        os.kill(os.getpid(), signal.SIGTERM)
    except Exception as e:  # noqa: BLE001
        log.error("[flow-db-guard] SIGTERM failed: %s", e)
    return True


def check_and_heal(db_path: str | None = None, fd_dir: str = "/proc/self/fd") -> list:
    """The tripwire. Returns the stale handles found (and has requested a restart if any)."""
    stale = stale_handles(db_path, fd_dir)
    if stale:
        request_restart("this process holds %d handle(s) to a DELETED flow.db file (%s): two "
                        "write-ahead logs are in play, the corruption pattern of 11/09-11/13"
                        % (len(stale), ", ".join(sorted(set(stale)))))
    return stale


def exit_now(code: int = 0) -> None:
    """Leave without interpreter teardown, so the anchor (and every other connection) is never
    closed: a process that is being replaced must not checkpoint-and-delete the WAL."""
    logging.shutdown()
    os._exit(code)
