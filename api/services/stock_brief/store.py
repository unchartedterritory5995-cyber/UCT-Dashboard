"""SQLite store for the Dossier widget — cached AI-generated per-stock profile
(company description + this-year thematic narrative + sector/industry), keyed by
(symbol, period). Mirrors news_catalysts.store / modelbook_service: WAL mode,
_WRITE_LOCK on writes, contextlib.closing on every connection (Windows teardown
requires an explicit close). Generate-once idiom via generated_at / attempt_at.

The YTD *stats* and *earnings* are NOT stored here — they're computed live and
short-cached in the in-memory TTLCache. Only the LLM-generated profile is
persisted so a redeploy doesn't re-spend on every viewed ticker.

DB path: /data/stock_brief.db (env STOCK_BRIEF_DB_PATH).
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
import time

_DB_PATH = os.environ.get("STOCK_BRIEF_DB_PATH", "/data/stock_brief.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS stock_profiles (
  symbol       TEXT NOT NULL,
  period       TEXT NOT NULL,       -- 'y2026'
  company_desc TEXT,
  run_story    TEXT,
  sector       TEXT,
  industry     TEXT,
  generated_at INTEGER,             -- epoch of last SUCCESSFUL generation (NULL if never)
  attempt_at   INTEGER,             -- epoch of last attempt (the "don't loop" marker)
  PRIMARY KEY (symbol, period)
);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db() -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        c.commit()


def get_profile(symbol: str, period: str) -> dict | None:
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM stock_profiles WHERE symbol=? AND period=?",
            (symbol.upper(), period),
        ).fetchone()
        return dict(row) if row else None


def save_profile(symbol: str, period: str, data: dict) -> None:
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO stock_profiles
                 (symbol, period, company_desc, run_story, sector, industry, generated_at, attempt_at)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(symbol, period) DO UPDATE SET
                 company_desc=excluded.company_desc, run_story=excluded.run_story,
                 sector=excluded.sector, industry=excluded.industry,
                 generated_at=excluded.generated_at, attempt_at=excluded.attempt_at""",
            (symbol.upper(), period, data.get("company_desc"), data.get("run_story"),
             data.get("sector"), data.get("industry"), now, now),
        )
        c.commit()


def mark_attempt(symbol: str, period: str) -> None:
    """Stamp an attempt WITHOUT clobbering any content already stored (a failed
    refresh must not wipe last year's good text)."""
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO stock_profiles (symbol, period, attempt_at) VALUES (?,?,?)
               ON CONFLICT(symbol, period) DO UPDATE SET attempt_at=excluded.attempt_at""",
            (symbol.upper(), period, now),
        )
        c.commit()


def has_content(symbol: str, period: str) -> bool:
    row = get_profile(symbol, period)
    return bool(row and (row.get("company_desc") or row.get("run_story")))


def needs_generation(symbol: str, period: str, retry_after: int, refresh_after: int) -> bool:
    """True when we should (re)generate: never generated, only-attempted past the
    retry cooldown, or content that's gone stale past the refresh window (the YTD
    narrative evolves through the year)."""
    row = get_profile(symbol, period)
    now = int(time.time())
    if not row:
        return True
    if not (row.get("company_desc") or row.get("run_story")):
        return (now - (row.get("attempt_at") or 0)) >= retry_after
    return (now - (row.get("generated_at") or 0)) >= refresh_after
