"""SQLite store for the News & Catalysts widget — cached AI-generated significant
catalysts per (symbol, period). Mirrors modelbook_service / catalyst.store:
WAL mode, _WRITE_LOCK on writes, contextlib.closing on every connection (Windows
teardown requires explicit close). Generate-once idiom via news_catalyst_meta.

DB path: /data/news_catalysts.db (env NEWS_CATALYSTS_DB_PATH).
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
import time

_DB_PATH = os.environ.get("NEWS_CATALYSTS_DB_PATH", "/data/news_catalysts.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS news_catalysts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol        TEXT    NOT NULL,
  period        TEXT    NOT NULL,   -- 'ytd2026'
  catalyst_date TEXT    NOT NULL,   -- 'YYYY-MM-DD' the trading day the catalyst hit
  title         TEXT    NOT NULL,
  description   TEXT,
  move_pct      REAL,               -- signed single-day % move (+ up / - down)
  direction     TEXT,               -- 'up' | 'down'
  sort_order    INTEGER NOT NULL DEFAULT 0,
  source        TEXT    NOT NULL DEFAULT 'ai',
  created_at    INTEGER NOT NULL,
  UNIQUE(symbol, period, catalyst_date, title)
);
CREATE INDEX IF NOT EXISTS idx_nc_sym ON news_catalysts(symbol, period);

CREATE TABLE IF NOT EXISTS news_catalyst_meta (
  symbol       TEXT NOT NULL,
  period       TEXT NOT NULL,
  catalysts_at INTEGER,             -- epoch of last generation ATTEMPT (the "don't loop" marker)
  PRIMARY KEY (symbol, period)
);

CREATE TABLE IF NOT EXISTS news_catalyst_cost_log (
  ts            INTEGER,
  symbol        TEXT,
  model         TEXT,
  cost_usd      REAL
);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        c.commit()


def get_catalysts(symbol: str, period: str) -> list[dict]:
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT catalyst_date, title, description, move_pct, direction, sort_order, source "
            "FROM news_catalysts WHERE symbol=? AND period=? "
            "ORDER BY catalyst_date DESC, sort_order",
            (symbol.upper(), period),
        ).fetchall()
    return [dict(r) for r in rows]


def replace_catalysts(symbol: str, period: str, items: list[dict]) -> None:
    """Swap the cached catalyst set for (symbol, period) + stamp the attempt time."""
    sym = symbol.upper()
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("DELETE FROM news_catalysts WHERE symbol=? AND period=?", (sym, period))
        for i, it in enumerate(items or []):
            c.execute(
                "INSERT OR IGNORE INTO news_catalysts "
                "(symbol, period, catalyst_date, title, description, move_pct, direction, "
                " sort_order, source, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (
                    sym, period,
                    it.get("date") or it.get("catalyst_date"),
                    it.get("title"),
                    it.get("description"),
                    it.get("move_pct"),
                    it.get("direction"),
                    it.get("sort_order", i),
                    it.get("source", "ai"),
                    now,
                ),
            )
        _stamp_attempt(c, sym, period, now)
        c.commit()


def mark_attempt(symbol: str, period: str) -> None:
    """Stamp a generation ATTEMPT (used when generation produced nothing, so a
    permanent-empty stock doesn't re-run the LLM on every view until retry_after)."""
    sym = symbol.upper()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        _stamp_attempt(c, sym, period, int(time.time()))
        c.commit()


def _stamp_attempt(c: sqlite3.Connection, sym: str, period: str, now: int) -> None:
    c.execute(
        "INSERT INTO news_catalyst_meta (symbol, period, catalysts_at) VALUES (?,?,?) "
        "ON CONFLICT(symbol, period) DO UPDATE SET catalysts_at=excluded.catalysts_at",
        (sym, period, now),
    )


def needs_generation(symbol: str, period: str, retry_after: int) -> bool:
    """True when there are no cached rows AND we haven't attempted within retry_after."""
    sym = symbol.upper()
    with contextlib.closing(_connect()) as c:
        has = c.execute(
            "SELECT 1 FROM news_catalysts WHERE symbol=? AND period=? LIMIT 1", (sym, period)
        ).fetchone()
        if has:
            return False
        row = c.execute(
            "SELECT catalysts_at FROM news_catalyst_meta WHERE symbol=? AND period=?", (sym, period)
        ).fetchone()
    at = row["catalysts_at"] if row else None
    return (at is None) or (int(time.time()) - at > retry_after)


def log_cost(symbol: str, model: str, cost_usd: float) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "INSERT INTO news_catalyst_cost_log (ts, symbol, model, cost_usd) VALUES (?,?,?,?)",
            (int(time.time()), symbol.upper(), model, cost_usd),
        )
        c.commit()
