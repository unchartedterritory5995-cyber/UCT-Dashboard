"""Quarantine table for bad bars detected by validation or audit.

Bars in this table are skipped on cache reads, forcing a fresh fetch from
an alternate source on next access (self-healing).
"""
import os
import sqlite3
import time
from typing import Optional

_DB_PATH = os.environ.get("AUTH_DB", "/data/auth.db")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS quarantined_bars (
  ticker TEXT NOT NULL,
  tf TEXT NOT NULL,
  bar_time INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source TEXT,
  detected_at INTEGER NOT NULL,
  PRIMARY KEY (ticker, tf, bar_time)
);
CREATE INDEX IF NOT EXISTS idx_quarantine_detected ON quarantined_bars(detected_at);
"""


def _conn():
    return sqlite3.connect(_DB_PATH, timeout=10.0)


def init_schema():
    with _conn() as db:
        db.executescript(_SCHEMA)


def add(ticker: str, tf: str, bar_time: int, reason: str, source: Optional[str] = None) -> None:
    with _conn() as db:
        db.execute(
            "INSERT OR REPLACE INTO quarantined_bars "
            "(ticker, tf, bar_time, reason, source, detected_at) VALUES (?, ?, ?, ?, ?, ?)",
            (ticker.upper(), tf, int(bar_time), reason, source, int(time.time())),
        )


def remove(ticker: str, tf: str, bar_time: int) -> None:
    with _conn() as db:
        db.execute(
            "DELETE FROM quarantined_bars WHERE ticker=? AND tf=? AND bar_time=?",
            (ticker.upper(), tf, int(bar_time)),
        )


def is_quarantined(ticker: str, tf: str, bar_time: int) -> bool:
    with _conn() as db:
        row = db.execute(
            "SELECT 1 FROM quarantined_bars WHERE ticker=? AND tf=? AND bar_time=? LIMIT 1",
            (ticker.upper(), tf, int(bar_time)),
        ).fetchone()
    return row is not None


def list_for_ticker(ticker: str, tf: Optional[str] = None) -> list[dict]:
    with _conn() as db:
        if tf:
            rows = db.execute(
                "SELECT ticker, tf, bar_time, reason, source, detected_at "
                "FROM quarantined_bars WHERE ticker=? AND tf=? ORDER BY bar_time",
                (ticker.upper(), tf),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT ticker, tf, bar_time, reason, source, detected_at "
                "FROM quarantined_bars WHERE ticker=? ORDER BY tf, bar_time",
                (ticker.upper(),),
            ).fetchall()
    return [
        {"ticker": r[0], "tf": r[1], "bar_time": r[2], "reason": r[3],
         "source": r[4], "detected_at": r[5]}
        for r in rows
    ]


def count(ticker: Optional[str] = None) -> int:
    with _conn() as db:
        if ticker:
            row = db.execute(
                "SELECT COUNT(*) FROM quarantined_bars WHERE ticker=?",
                (ticker.upper(),),
            ).fetchone()
        else:
            row = db.execute("SELECT COUNT(*) FROM quarantined_bars").fetchone()
    return int(row[0]) if row else 0


def quarantined_times(ticker: str, tf: str) -> set[int]:
    """Return set of bar timestamps quarantined for a ticker+tf — fast bulk check."""
    with _conn() as db:
        rows = db.execute(
            "SELECT bar_time FROM quarantined_bars WHERE ticker=? AND tf=?",
            (ticker.upper(), tf),
        ).fetchall()
    return {r[0] for r in rows}
