"""SQLite store for Morning Wire per-segment 👍/👎 votes.

Mirrors catalyst feedback: own DB file on the /data volume, snapshot the voted
segment's text at write time (historical rundown_html is not retained), upsert
keyed by (user_id, market_date, segment_key).
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
import time

_DB_PATH = os.environ.get("WIRE_FEEDBACK_DB_PATH", "/data/wire_feedback.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS wire_feedback (
  user_id      TEXT NOT NULL,
  market_date  TEXT NOT NULL,
  segment_key  TEXT NOT NULL,
  verdict      TEXT NOT NULL,        -- 'up' | 'down'
  segment_text TEXT NOT NULL DEFAULT '',
  is_admin     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (user_id, market_date, segment_key)
);
CREATE INDEX IF NOT EXISTS idx_wf_admin ON wire_feedback(is_admin, created_at DESC);
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


def record_vote(*, user_id: str, market_date: str, segment_key: str,
                verdict: str, segment_text: str, is_admin: int) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO wire_feedback
                 (user_id, market_date, segment_key, verdict, segment_text, is_admin, created_at)
               VALUES (:user_id, :market_date, :segment_key, :verdict, :segment_text, :is_admin, :created_at)
               ON CONFLICT(user_id, market_date, segment_key) DO UPDATE SET
                 verdict      = excluded.verdict,
                 segment_text = excluded.segment_text,
                 is_admin     = excluded.is_admin,
                 created_at   = excluded.created_at""",
            {"user_id": user_id, "market_date": market_date, "segment_key": segment_key,
             "verdict": verdict, "segment_text": segment_text, "is_admin": int(is_admin),
             "created_at": int(time.time())},
        )
        c.commit()


def recent_admin_votes(days: int = 30, now: float | None = None) -> list:
    cutoff = int((now if now is not None else time.time()) - days * 86400)
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT market_date, segment_key, verdict, segment_text "
            "FROM wire_feedback WHERE is_admin=1 AND created_at >= ? "
            "ORDER BY created_at DESC",
            (cutoff,),
        ).fetchall()
    return [dict(r) for r in rows]
