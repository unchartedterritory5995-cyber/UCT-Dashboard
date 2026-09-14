"""wisdom.db — the Wisdom Loop's structured store (docs/wisdom/CONTRACTS.md §2.3).

The path is resolved on EVERY call from WISDOM_DB_PATH (default /data/wisdom.db),
so a test's monkeypatch.setenv reaches it and the repo-root conftest census can
pin it to a sandbox. Never add another /data literal to this package.

Writes are serialised in-process by WRITE_LOCK and run inside BEGIN IMMEDIATE,
which also serialises writers across processes sharing the file.

⛔⛔ A NESTED write() ON THE SAME THREAD JOINS THE TRANSACTION ALREADY OPEN — it does
not open a second one. WRITE_LOCK is not re-entrant and BEGIN IMMEDIATE excludes even
the same thread's second connection, so without this a seam that opens its own write()
while the caller holds one DEADLOCKS THE PROCESS: no exception, no timeout, nothing in
a log. Measured 2026-09-14 on TWO live paths, both reached from extract.writer inside
batch.handle_result's transaction:
  * core.entities.resolve -> aliases.load_aliases -> aliases.seed -> store.write
  * core.vocab.record_candidate -> lookup -> ensure_seeded -> vocab.seed -> store.write
⭐ It does not present as a red test either: under pytest on Windows the timeout plugin
KILLS the process, so the run loses its totals line and reads as an infrastructure
failure rather than a defect (`lesson_a_task_status_reports_the_wrappers_exit_not_the_suites`).
The inner block shares the outer connection, so an inner failure rolls the whole unit of
work back and an inner write commits with the outer — which is what a candidate row or a
seeded alias belongs to anyway. Rail: tests/test_wisdom_core_store_reentrancy.py.
"""
from __future__ import annotations

import contextlib
import logging
import os
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Iterator, Optional

log = logging.getLogger(__name__)

WRITE_LOCK = threading.Lock()
#: Per-thread: the write connection this thread already has open, by database file.
_OPEN_WRITES = threading.local()


def db_path() -> str:
    return os.environ.get("WISDOM_DB_PATH", "/data/wisdom.db")


def _resolve(path: Optional[str]) -> str:
    return path or db_path()


def _write_key(path: str) -> str:
    """One key per FILE, so two spellings of the same database are one transaction."""
    return os.path.normcase(os.path.abspath(path))


def _open_writes() -> dict:
    conns = getattr(_OPEN_WRITES, "conns", None)
    if conns is None:
        conns = {}
        _OPEN_WRITES.conns = conns
    return conns


def in_write(db_path: Optional[str] = None) -> bool:
    """Does THIS thread already hold an open write transaction on that database?"""
    return _write_key(_resolve(db_path)) in _open_writes()


def connect(db_path: Optional[str] = None, *, for_request: bool = False) -> sqlite3.Connection:
    path = _resolve(db_path)
    parent = os.path.dirname(path)
    if parent:
        os.makedirs(parent, exist_ok=True)
    conn = sqlite3.connect(path, timeout=5.0, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    # Request handlers wait briefly (the web pod has one shared threadpool);
    # scheduler threads can afford to wait longer.
    conn.execute(f"PRAGMA busy_timeout={2000 if for_request else 5000}")
    return conn


@contextlib.contextmanager
def read(db_path: Optional[str] = None, *, for_request: bool = False) -> Iterator[sqlite3.Connection]:
    # ⛔ READ-YOUR-OWN-WRITES. A read opened while THIS thread holds a write transaction
    # uses that connection. A fresh connection cannot see uncommitted rows, and the two
    # halves of one lazy seed are exactly that shape: core.vocab.seed writes through
    # store.write() and core.vocab._db_rows reads back through store.read(). Split
    # across two connections the read comes back EMPTY, list_for_prompt silently falls
    # back to the draft file, and prompt.extractor_version() — a sha over the prompt,
    # vocabulary included — returns a DIFFERENT version than the same process computes
    # a moment later outside the transaction. Measured 2026-09-14: wx-v0-2b432338 inside
    # vs wx-v0-74bafea0 outside, which blocks the golden gate against a version nothing
    # ever evaluated. Joining keeps one answer per thread.
    path = _resolve(db_path)
    open_writes = _open_writes()
    key = _write_key(path)
    if key in open_writes:
        yield open_writes[key]
        return
    conn = connect(path, for_request=for_request)
    try:
        yield conn
    finally:
        conn.close()


@contextlib.contextmanager
def write(db_path: Optional[str] = None) -> Iterator[sqlite3.Connection]:
    path = _resolve(db_path)
    key = _write_key(path)
    open_writes = _open_writes()
    if key in open_writes:
        yield open_writes[key]            # join the transaction this thread already holds
        return
    with WRITE_LOCK:
        conn = connect(path)
        open_writes[key] = conn
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
            open_writes.pop(key, None)
            conn.close()


def init_db(db_path: Optional[str] = None) -> list[str]:
    """Apply the base contract DDL and every package migration not yet applied.

    Returns the names applied by THIS call. A failing migration is logged loudly,
    left unrecorded (so it retries next boot) and does not stop the others."""
    from api.services.wisdom import registry

    applied: list[str] = []
    with WRITE_LOCK:
        conn = connect(db_path)
        try:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS wisdom_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)"
            )
            conn.commit()
            done = {row[0] for row in conn.execute("SELECT name FROM wisdom_migrations")}
            for name, sql in registry.schema_migrations():
                if name in done:
                    continue
                try:
                    conn.executescript(sql)
                    conn.execute(
                        "INSERT INTO wisdom_migrations(name, applied_at) VALUES (?, ?)",
                        (name, datetime.now(timezone.utc).isoformat(timespec="seconds")),
                    )
                    conn.commit()
                    applied.append(name)
                except Exception:
                    log.exception("[wisdom] migration %s FAILED; not recorded, will retry next boot", name)
        finally:
            conn.close()
    return applied
