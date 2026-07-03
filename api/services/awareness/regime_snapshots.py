"""Durable regime-label snapshot store -- the missing memory behind the
Awareness Engine's R4 (regime flip) rule.

voice_regime_classifier.get_current_regime() recomputes the label on every
call via a 15-min TTLCache but never persists the PRIOR label anywhere, so
nothing in the app can say "the regime just flipped" durably (the existing
voice_proactive_service.maybe_emit_regime_shift() only compares against text
in the user's last voice-session summary -- a heuristic, not a ledger). This
module is that ledger: one row appended per Awareness Engine scan cycle.

Schema + connection pragmas mirror api/services/indicator_alert_service.py
(same physical auth.db file via AUTH_DB_PATH, same WAL + busy_timeout=2000
web-pod convention)."""
from __future__ import annotations

import os
import sqlite3

_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS awareness_regime_snapshots (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  label       TEXT NOT NULL,
  confidence  REAL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_awareness_regime_snapshots_created
  ON awareness_regime_snapshots(created_at DESC);
"""


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_DB_PATH, timeout=10.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    return c


def init_schema() -> None:
    with _conn() as db:
        db.executescript(_SCHEMA)


def get_last_label() -> str | None:
    """Most recently recorded regime label, or None if the table is empty
    (first-ever scan -- nothing to compare against yet)."""
    with _conn() as db:
        row = db.execute(
            "SELECT label FROM awareness_regime_snapshots "
            "ORDER BY id DESC LIMIT 1"
        ).fetchone()
    return row[0] if row else None


def record_snapshot(label: str, confidence: float | None = None) -> int:
    """Append a new snapshot row. Called once per scan cycle, unconditionally
    -- this table is a ledger. Flip detection is a read-then-write done by
    the CALLER (engine.py): read get_last_label() BEFORE calling this."""
    with _conn() as db:
        cur = db.execute(
            "INSERT INTO awareness_regime_snapshots (label, confidence) "
            "VALUES (?, ?)",
            (label, confidence),
        )
        db.commit()
        return cur.lastrowid
