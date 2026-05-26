"""SQLite store for catalyst rows + cost log.

DB path: /data/catalysts.db (web service Railway volume).
WAL mode for concurrent reads during background refresh.
All connections wrapped in contextlib.closing — same pattern as
tweet_store.py (Windows teardown requires explicit close).
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
import time
from typing import Optional

_DB_PATH = os.environ.get("CATALYST_DB_PATH", "/data/catalysts.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS catalysts (
  market_date     TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  rank            INTEGER,
  score           REAL,
  tag             TEXT,
  price           REAL,
  gap_pct         REAL,
  vol_x           REAL,
  market_cap      REAL,
  sector          TEXT,
  thesis_text     TEXT,
  thesis_model    TEXT,
  thesis_at       INTEGER,
  thesis_sources  TEXT,
  signals_hash    TEXT,
  raw_signals     TEXT,
  PRIMARY KEY (market_date, ticker)
);
CREATE INDEX IF NOT EXISTS idx_catalysts_date_rank  ON catalysts(market_date, rank);
CREATE INDEX IF NOT EXISTS idx_catalysts_date_score ON catalysts(market_date, score DESC);

CREATE TABLE IF NOT EXISTS catalyst_cost_log (
  ts              INTEGER NOT NULL,
  market_date     TEXT NOT NULL,
  ticker          TEXT NOT NULL,
  model           TEXT NOT NULL,
  input_tokens    INTEGER,
  output_tokens   INTEGER,
  cost_usd        REAL,
  was_cached      INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_catalyst_cost_date ON catalyst_cost_log(market_date);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        c.commit()


def upsert_catalyst(row: dict) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO catalysts
               (market_date, ticker, rank, score, tag, price, gap_pct, vol_x,
                market_cap, sector, thesis_text, thesis_model, thesis_at,
                thesis_sources, signals_hash, raw_signals)
               VALUES (:market_date, :ticker, :rank, :score, :tag, :price, :gap_pct,
                       :vol_x, :market_cap, :sector, :thesis_text, :thesis_model,
                       :thesis_at, :thesis_sources, :signals_hash, :raw_signals)
               ON CONFLICT(market_date, ticker) DO UPDATE SET
                 rank           = excluded.rank,
                 score          = excluded.score,
                 tag            = excluded.tag,
                 price          = excluded.price,
                 gap_pct        = excluded.gap_pct,
                 vol_x          = excluded.vol_x,
                 market_cap     = excluded.market_cap,
                 sector         = excluded.sector,
                 thesis_text    = excluded.thesis_text,
                 thesis_model   = excluded.thesis_model,
                 thesis_at      = excluded.thesis_at,
                 thesis_sources = excluded.thesis_sources,
                 signals_hash   = excluded.signals_hash,
                 raw_signals    = excluded.raw_signals""",
            row,
        )
        c.commit()


def get_for_date(market_date: str, ranked_only: bool = True) -> list[dict]:
    sql = "SELECT * FROM catalysts WHERE market_date = ?"
    if ranked_only:
        sql += " AND rank IS NOT NULL"
    sql += " ORDER BY rank ASC NULLS LAST, score DESC"
    with contextlib.closing(_connect()) as c:
        return [dict(r) for r in c.execute(sql, (market_date,)).fetchall()]


def get_ticker_for_date(ticker: str, market_date: str) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT * FROM catalysts WHERE market_date = ? AND ticker = ?",
            (market_date, ticker),
        ).fetchone()
        return dict(row) if row else None


def clear_ranks_for_date(market_date: str) -> None:
    """Null-out ranks for all rows on a given date. Called before re-ranking
    so that dropped tickers stay in the DB (rank=NULL) for historical view."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE catalysts SET rank = NULL WHERE market_date = ?",
                  (market_date,))
        c.commit()


def log_cost(*, market_date: str, ticker: str, model: str,
             input_tokens: int, output_tokens: int,
             cost_usd: float, was_cached: bool) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO catalyst_cost_log
               (ts, market_date, ticker, model, input_tokens, output_tokens,
                cost_usd, was_cached)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (int(time.time()), market_date, ticker, model,
             input_tokens, output_tokens, cost_usd, 1 if was_cached else 0),
        )
        c.commit()


def cost_stats_for_date(market_date: str) -> dict:
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            """SELECT COUNT(*) AS call_count,
                      COALESCE(SUM(cost_usd), 0.0) AS total_cost_usd,
                      COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
                      COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
                      COALESCE(SUM(was_cached), 0) AS cached_count
               FROM catalyst_cost_log WHERE market_date = ?""",
            (market_date,),
        ).fetchone()
        return dict(row)


def cost_stats_mtd(year_month: str) -> dict:
    """year_month format: 'YYYY-MM'. Returns aggregate for that month."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            """SELECT COUNT(*) AS call_count,
                      COALESCE(SUM(cost_usd), 0.0) AS total_cost_usd
               FROM catalyst_cost_log WHERE market_date LIKE ?""",
            (f"{year_month}-%",),
        ).fetchone()
        return dict(row)
