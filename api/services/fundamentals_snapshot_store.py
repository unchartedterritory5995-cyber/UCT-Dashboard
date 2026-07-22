"""Persistent fundamentals payload snapshots — the disk layer behind the
fundamentals widget's instant loads. The in-memory TTLCache dies on every
redeploy and only spans its TTL; this store keeps the last good payload per
(kind, ticker) on the /data volume so a ticker anyone has ever viewed serves
in milliseconds (stale-while-revalidate) instead of rebuilding multi-provider
data on the request path. Lazy-init, dashboard-owned SQLite (mirrors
fundamentals_estimates_store). Every call is best-effort: a store failure must
never break the serve path — callers fall through to a live build."""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import time
from contextlib import closing

_log = logging.getLogger(__name__)


def _db_path() -> str:
    p = os.environ.get("FUNDAMENTALS_TABLES_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/fundamentals_tables.db"
    # Local-dev fallback next to the repo working dir.
    return os.path.join(os.getcwd(), "fundamentals_tables.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_init() -> None:
    with closing(_connect()) as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS fund_snapshots (
                   kind TEXT NOT NULL,
                   ticker TEXT NOT NULL,
                   payload TEXT NOT NULL,
                   ttl REAL NOT NULL,
                   updated_at REAL NOT NULL,
                   PRIMARY KEY (kind, ticker)
               )"""
        )
        conn.commit()


def get(kind: str, ticker: str, now: float | None = None):
    """(payload, age_seconds, ttl) for the stored snapshot, or None."""
    now = time.time() if now is None else now
    try:
        _ensure_init()
        with closing(_connect()) as conn:
            row = conn.execute(
                "SELECT payload, ttl, updated_at FROM fund_snapshots WHERE kind=? AND ticker=?",
                (kind, ticker.upper()),
            ).fetchone()
        if not row:
            return None
        return json.loads(row[0]), max(0.0, now - row[2]), row[1]
    except Exception as e:
        _log.debug("fund snapshot get failed for %s/%s: %s", kind, ticker, e)
        return None


def put(kind: str, ticker: str, payload, ttl: float, now: float | None = None) -> None:
    now = time.time() if now is None else now
    try:
        _ensure_init()
        with closing(_connect()) as conn:
            conn.execute(
                """INSERT OR REPLACE INTO fund_snapshots
                       (kind, ticker, payload, ttl, updated_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (kind, ticker.upper(), json.dumps(payload), float(ttl), now),
            )
            conn.commit()
    except Exception as e:
        _log.debug("fund snapshot put failed for %s/%s: %s", kind, ticker, e)


def delete(kind: str, ticker: str) -> None:
    try:
        _ensure_init()
        with closing(_connect()) as conn:
            conn.execute(
                "DELETE FROM fund_snapshots WHERE kind=? AND ticker=?",
                (kind, ticker.upper()),
            )
            conn.commit()
    except Exception as e:
        _log.debug("fund snapshot delete failed for %s/%s: %s", kind, ticker, e)


def prune(max_age_days: int = 90, now: float | None = None) -> int:
    """Drop snapshots not refreshed in `max_age_days` (ticker nobody views)."""
    now = time.time() if now is None else now
    try:
        _ensure_init()
        with closing(_connect()) as conn:
            cur = conn.execute(
                "DELETE FROM fund_snapshots WHERE updated_at < ?",
                (now - max_age_days * 86400,),
            )
            conn.commit()
            return cur.rowcount
    except Exception as e:
        _log.debug("fund snapshot prune failed: %s", e)
        return 0
