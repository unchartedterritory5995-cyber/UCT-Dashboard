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
  source        TEXT    NOT NULL DEFAULT 'ai',   -- 'web' (web-researched) | 'ai' (from-memory fallback)
  url           TEXT,               -- top source citation (web-researched catalysts)
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
        # Forward-compat: add new columns to an existing DB (no IF NOT EXISTS on cols).
        for table, col, decl in (
            ("news_catalysts", "url", "TEXT"),
            # WHY an attempt needs a KIND: "the web found nothing to report" and
            # "we could not reach the web" both used to land as one bare
            # timestamp, so a rate-limited symbol waited out the full 24h
            # retry as if we had actually looked and found nothing.
            ("news_catalyst_meta", "attempt_kind", "TEXT"),
        ):
            try:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")
            except sqlite3.OperationalError as e:
                if "duplicate column name" not in str(e).lower():
                    raise
        c.commit()


def get_catalysts(symbol: str, period: str) -> list[dict]:
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT catalyst_date, title, description, move_pct, direction, sort_order, source, url "
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
                " sort_order, source, url, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                (
                    sym, period,
                    it.get("date") or it.get("catalyst_date"),
                    it.get("title"),
                    it.get("description"),
                    it.get("move_pct"),
                    it.get("direction"),
                    it.get("sort_order", i),
                    it.get("source", "ai"),
                    it.get("url"),
                    now,
                ),
            )
        _stamp_attempt(c, sym, period, now)
        c.commit()


def mark_attempt(symbol: str, period: str, kind: str | None = None) -> None:
    """Stamp a generation ATTEMPT (used when generation produced nothing, so a
    permanent-empty stock doesn't re-run the LLM on every view until retry_after).

    `kind` says WHY nothing came back — `"error"` means we never got a usable
    answer out of the provider (a 429, a timeout, a bad response), as opposed
    to the provider answering that there is nothing to report. Only the second
    one deserves the full retry window; see `needs_generation`."""
    sym = symbol.upper()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        _stamp_attempt(c, sym, period, int(time.time()), kind)
        c.commit()


def _stamp_attempt(c: sqlite3.Connection, sym: str, period: str, now: int,
                   kind: str | None = None) -> None:
    c.execute(
        "INSERT INTO news_catalyst_meta (symbol, period, catalysts_at, attempt_kind) "
        "VALUES (?,?,?,?) "
        "ON CONFLICT(symbol, period) DO UPDATE SET catalysts_at=excluded.catalysts_at, "
        "attempt_kind=excluded.attempt_kind",
        (sym, period, now, kind),
    )


def needs_generation(symbol: str, period: str, retry_after: int, *,
                     error_retry_after: int | None = None,
                     upgrade_after: int | None = None) -> bool:
    """Should we (re)generate the catalyst set for (symbol, period)?

    ⛔ THIS USED TO BE `if any row exists: return False` — and that is not
    "generate once", it is "generate once, FOREVER". The from-memory fallback
    (`source='ai'`, written when the web leg is unavailable — the model is
    pre-cutoff and "produces less") counted as a finished answer, so a single
    Perplexity 429 at the wrong moment pinned the weaker set permanently: no
    later pass could ever replace it, because `retry_after` is only consulted
    when there are NO rows at all. Measured 2026-08-24 while warming 62 names
    at once — 142 429s in fourteen minutes, and the only reason nothing was
    baked in is that the retries happened to win.

    So a set is FINISHED only when it is web-grounded:
      • any row with `source='web'`      → False (done, never re-billed)
      • rows, but all from the fallback  → PROVISIONAL: try to upgrade it once
        `upgrade_after` has passed, and never more often than `retry_after`
        (`replace_catalysts` stamps the attempt, so that bound is real).
      • no rows at all                   → the original attempt window, except
        that a failed attempt (`attempt_kind='error'`) uses the shorter
        `error_retry_after`: we never actually looked, so waiting a full day
        before looking again is the wrong lesson to draw.

    Both new bounds are keyword-only with `None` defaults that reproduce the
    old behaviour exactly, so any caller that has not opted in is unchanged."""
    sym = symbol.upper()
    now = int(time.time())
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT COUNT(*) AS n, "
            "       SUM(CASE WHEN source='web' THEN 1 ELSE 0 END) AS web, "
            "       MAX(created_at) AS newest "
            "FROM news_catalysts WHERE symbol=? AND period=?", (sym, period)
        ).fetchone()
        meta = c.execute(
            "SELECT catalysts_at, attempt_kind FROM news_catalyst_meta "
            "WHERE symbol=? AND period=?", (sym, period)
        ).fetchone()

    at = meta["catalysts_at"] if meta else None
    kind = (meta["attempt_kind"] if meta else None) or None

    if row and (row["n"] or 0) > 0:
        if (row["web"] or 0) > 0:
            return False                      # web-grounded: finished
        if upgrade_after is None:
            return False                      # opted out → old behaviour
        # Provisional (fallback-only). Old enough to be worth another look, and
        # not more often than the ordinary retry window.
        newest = row["newest"] or 0
        if (now - newest) < upgrade_after:
            return False
        return at is None or (now - at) > retry_after

    window = retry_after
    if kind == "error" and error_retry_after is not None:
        window = min(retry_after, error_retry_after)
    return (at is None) or (now - at > window)


def log_cost(symbol: str, model: str, cost_usd: float) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "INSERT INTO news_catalyst_cost_log (ts, symbol, model, cost_usd) VALUES (?,?,?,?)",
            (int(time.time()), symbol.upper(), model, cost_usd),
        )
        c.commit()
