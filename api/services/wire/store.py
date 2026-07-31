"""SQLite store for the earnings wire. CRUD only — no business logic.

Its own DB on the Railway volume, mirroring catalysts.db / tweets.db / cot.db.
The sticky-actuals JSON ledger was considered and rejected for this: it is a
whole-file rewrite under a lock, which would thrash during a 250-name print
window, and per-field provenance is relational.

Two invariants are load-bearing for the feed's readability and are enforced HERE
rather than by the caller, so no future writer can bypass them:

  • `first_seen_at` is IMMUTABLE. The wire sorts on it, so an upgrade that
    rewrote it would make a row jump position while it is being read.
  • `peak_move_pct` only RATCHETS UP, and `confirmed` never regresses. Both
    drive how loudly a row renders; a later quiet tick must not undo them.

Every other field uses COALESCE(excluded, existing) so a partial tick can never
blank a value an earlier one established.
"""
from __future__ import annotations

import os
import sqlite3
import threading

_DB_PATH = os.environ.get("WIRE_DB_PATH", "/data/earnings_wire.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS wire_prints (
  market_date   TEXT NOT NULL,
  sym           TEXT NOT NULL,
  timing        TEXT,
  first_seen_at REAL NOT NULL,
  trigger       TEXT,
  eps_act REAL, eps_est REAL,
  rev_act REAL, rev_est REAL,
  eps_src TEXT, rev_src TEXT,
  confirmed     INTEGER DEFAULT 0,
  peak_move_pct REAL DEFAULT 0.0,
  updated_at    REAL,
  PRIMARY KEY (market_date, sym)
);
CREATE INDEX IF NOT EXISTS idx_wire_day_seen
  ON wire_prints(market_date, first_seen_at);
"""

_FIELDS = ("market_date", "sym", "timing", "first_seen_at", "trigger",
           "eps_act", "eps_est", "rev_act", "rev_est",
           "eps_src", "rev_src", "confirmed", "peak_move_pct")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with _connect() as conn:
        conn.executescript(_SCHEMA)


def upsert_print(row: dict) -> None:
    """Insert a new print, or upgrade an existing one IN PLACE."""
    vals = [row.get(f) for f in _FIELDS]
    with _WRITE_LOCK, _connect() as conn:
        conn.execute(
            f"""INSERT INTO wire_prints ({','.join(_FIELDS)}, updated_at)
                VALUES ({','.join('?' * len(_FIELDS))}, strftime('%s','now'))
                ON CONFLICT(market_date, sym) DO UPDATE SET
                  timing        = COALESCE(excluded.timing, wire_prints.timing),
                  trigger       = COALESCE(wire_prints.trigger, excluded.trigger),
                  eps_act       = COALESCE(excluded.eps_act, wire_prints.eps_act),
                  eps_est       = COALESCE(excluded.eps_est, wire_prints.eps_est),
                  rev_act       = COALESCE(excluded.rev_act, wire_prints.rev_act),
                  rev_est       = COALESCE(excluded.rev_est, wire_prints.rev_est),
                  eps_src       = COALESCE(excluded.eps_src, wire_prints.eps_src),
                  rev_src       = COALESCE(excluded.rev_src, wire_prints.rev_src),
                  confirmed     = MAX(excluded.confirmed, wire_prints.confirmed),
                  peak_move_pct = MAX(excluded.peak_move_pct, wire_prints.peak_move_pct),
                  updated_at    = strftime('%s','now')
            """, vals)


def get_prints(market_date: str) -> list[dict]:
    """This session's prints, oldest arrival first."""
    with _connect() as conn:
        rows = conn.execute(
            "SELECT * FROM wire_prints WHERE market_date=? ORDER BY first_seen_at ASC",
            (market_date,)).fetchall()
    return [dict(r) for r in rows]


def get_print(market_date: str, sym: str) -> dict | None:
    with _connect() as conn:
        r = conn.execute(
            "SELECT * FROM wire_prints WHERE market_date=? AND sym=?",
            (market_date, sym)).fetchone()
    return dict(r) if r else None
