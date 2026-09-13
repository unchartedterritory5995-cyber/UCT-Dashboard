"""wisdom.db — the Wisdom Loop's structured store (docs/wisdom/CONTRACTS.md §2.3).

The path is resolved on EVERY call from WISDOM_DB_PATH (default /data/wisdom.db),
so a test's monkeypatch.setenv reaches it and the repo-root conftest census can
pin it to a sandbox. Never add another /data literal to this package.

Writes are serialised in-process by WRITE_LOCK and run inside BEGIN IMMEDIATE,
which also serialises writers across processes sharing the file.
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


def db_path() -> str:
    return os.environ.get("WISDOM_DB_PATH", "/data/wisdom.db")


def _resolve(path: Optional[str]) -> str:
    return path or db_path()


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
    conn = connect(db_path, for_request=for_request)
    try:
        yield conn
    finally:
        conn.close()


@contextlib.contextmanager
def write(db_path: Optional[str] = None) -> Iterator[sqlite3.Connection]:
    with WRITE_LOCK:
        conn = connect(db_path)
        try:
            conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except BaseException:
            conn.rollback()
            raise
        finally:
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
