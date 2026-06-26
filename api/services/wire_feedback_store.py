"""SQLite store for Morning Wire per-segment 👍/👎 votes + free-text notes.

Mirrors catalyst feedback: own DB file on the /data volume, snapshot the voted
segment's text at write time (historical rundown_html is not retained), upsert
keyed by (user_id, market_date, segment_key).

A row may carry a vote ('up'/'down'), a free-text note, or both — a note can be
left without a thumb and vice-versa. Owner/admin feedback (votes + notes) feeds
the nightly wire-critic so the brief self-refines.
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
import time

_DB_PATH = os.environ.get("WIRE_FEEDBACK_DB_PATH", "/data/wire_feedback.db")
_WRITE_LOCK = threading.Lock()
_NOTE_MAX = 2000

_SCHEMA = """
CREATE TABLE IF NOT EXISTS wire_feedback (
  user_id      TEXT NOT NULL,
  market_date  TEXT NOT NULL,
  segment_key  TEXT NOT NULL,
  verdict      TEXT NOT NULL DEFAULT '',  -- 'up' | 'down' | '' (note-only)
  note         TEXT NOT NULL DEFAULT '',  -- free-text owner feedback
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
        # Migration: add `note` to pre-existing DBs created before notes shipped.
        cols = {r["name"] for r in c.execute("PRAGMA table_info(wire_feedback)")}
        if "note" not in cols:
            c.execute("ALTER TABLE wire_feedback ADD COLUMN note TEXT NOT NULL DEFAULT ''")
        c.commit()


def record_feedback(*, user_id: str, market_date: str, segment_key: str,
                    verdict: str | None = None, note: str | None = None,
                    segment_text: str = "", is_admin: int = 0) -> None:
    """Upsert a vote and/or note. Partial-merge: a None field is left unchanged,
    so adding a note later never clobbers an earlier thumb (and vice-versa)."""
    if note is not None:
        note = note[:_NOTE_MAX]
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT verdict, note, segment_text FROM wire_feedback "
            "WHERE user_id=? AND market_date=? AND segment_key=?",
            (user_id, market_date, segment_key),
        ).fetchone()
        cur_verdict = row["verdict"] if row else ""
        cur_note = row["note"] if row else ""
        cur_segtext = row["segment_text"] if row else ""
        new_verdict = verdict if verdict is not None else cur_verdict
        new_note = note if note is not None else cur_note
        new_segtext = segment_text or cur_segtext  # never overwrite with empty
        c.execute(
            """INSERT OR REPLACE INTO wire_feedback
                 (user_id, market_date, segment_key, verdict, note, segment_text, is_admin, created_at)
               VALUES (:user_id, :market_date, :segment_key, :verdict, :note, :segment_text, :is_admin, :created_at)""",
            {"user_id": user_id, "market_date": market_date, "segment_key": segment_key,
             "verdict": new_verdict, "note": new_note, "segment_text": new_segtext,
             "is_admin": int(is_admin), "created_at": int(time.time())},
        )
        c.commit()


def record_vote(*, user_id: str, market_date: str, segment_key: str,
                verdict: str, segment_text: str, is_admin: int) -> None:
    """Back-compat shim — a thumb vote is feedback with no note."""
    record_feedback(user_id=user_id, market_date=market_date, segment_key=segment_key,
                    verdict=verdict, note=None, segment_text=segment_text, is_admin=is_admin)


def recent_admin_votes(days: int = 30, now: float | None = None) -> list:
    """Owner/admin feedback in the window, newest first — votes AND notes."""
    cutoff = int((now if now is not None else time.time()) - days * 86400)
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT market_date, segment_key, verdict, note, segment_text "
            "FROM wire_feedback WHERE is_admin=1 AND created_at >= ? "
            "ORDER BY created_at DESC",
            (cutoff,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_user_feedback(user_id: str, market_date: str) -> dict:
    """This user's votes + notes for one day, keyed by segment — hydrates the UI."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT segment_key, verdict, note FROM wire_feedback "
            "WHERE user_id=? AND market_date=?",
            (user_id, market_date),
        ).fetchall()
    return {r["segment_key"]: {"verdict": r["verdict"], "note": r["note"]} for r in rows}
