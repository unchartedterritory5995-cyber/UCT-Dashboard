"""Per-bar source attribution. Sidecar table; never blocks the cache path.

Records which source produced each cached bar so operators can answer:
  - "Where did this bar come from?"
  - "How many bars per source today?"
  - "Has it been independently verified by reconciliation?"
"""
import os
import sqlite3
import time
from typing import Optional

_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS bar_provenance (
  ticker TEXT NOT NULL,
  tf TEXT NOT NULL,
  bar_time INTEGER NOT NULL,
  source TEXT NOT NULL,
  validated_at INTEGER NOT NULL,
  verified_at INTEGER,
  PRIMARY KEY (ticker, tf, bar_time)
);
CREATE INDEX IF NOT EXISTS idx_provenance_source ON bar_provenance(source);
CREATE INDEX IF NOT EXISTS idx_provenance_validated_at ON bar_provenance(validated_at);
"""


def _conn():
    c = sqlite3.connect(_DB_PATH, timeout=10.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    return c


def init_schema():
    with _conn() as db:
        db.executescript(_SCHEMA)


def record(ticker: str, tf: str, bar_time: int, source: str) -> None:
    with _conn() as db:
        db.execute(
            "INSERT OR REPLACE INTO bar_provenance "
            "(ticker, tf, bar_time, source, validated_at) VALUES (?, ?, ?, ?, ?)",
            (ticker.upper(), tf, int(bar_time), source, int(time.time())),
        )


def mark_verified(ticker: str, tf: str, bar_time: int) -> None:
    with _conn() as db:
        db.execute(
            "UPDATE bar_provenance SET verified_at=? WHERE ticker=? AND tf=? AND bar_time=?",
            (int(time.time()), ticker.upper(), tf, int(bar_time)),
        )


def get(ticker: str, tf: str, bar_time: int) -> Optional[dict]:
    with _conn() as db:
        row = db.execute(
            "SELECT ticker, tf, bar_time, source, validated_at, verified_at "
            "FROM bar_provenance WHERE ticker=? AND tf=? AND bar_time=?",
            (ticker.upper(), tf, int(bar_time)),
        ).fetchone()
    if not row:
        return None
    return {"ticker": row[0], "tf": row[1], "bar_time": row[2],
            "source": row[3], "validated_at": row[4], "verified_at": row[5]}


def count_by_source() -> dict[str, int]:
    with _conn() as db:
        rows = db.execute(
            "SELECT source, COUNT(*) FROM bar_provenance GROUP BY source"
        ).fetchall()
    return {r[0]: r[1] for r in rows}
