"""SQLite queue for pending Zoom recordings awaiting download+publish.
PK on meeting_uuid = idempotency against duplicate webhook deliveries.
Mirrors education_service: WAL, _WRITE_LOCK, contextlib.closing."""
from __future__ import annotations
import contextlib, os, sqlite3, threading, time

_DB_PATH = os.environ.get("DESK_JOBS_DB_PATH", "/data/desk_session_jobs.db")
_WRITE_LOCK = threading.Lock()
_MAX_ATTEMPTS = int(os.environ.get("DESK_DAILY_SESSION_MAX_ATTEMPTS", "3"))
_STALE_SECS = int(os.environ.get("DESK_DAILY_SESSION_STALE_SECS", "1800"))

_SCHEMA = """
CREATE TABLE IF NOT EXISTS desk_session_jobs (
  meeting_uuid  TEXT PRIMARY KEY,
  topic         TEXT,
  start_time    TEXT,
  download_url  TEXT NOT NULL,
  download_token TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|done|error
  youtube_id    TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dsj_status ON desk_session_jobs(status, created_at);
"""

def _connect():
    c = sqlite3.connect(_DB_PATH, timeout=10.0); c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL"); return c

def _init_db():
    parent = os.path.dirname(_DB_PATH)
    if parent: os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA); c.commit()

def enqueue(meeting_uuid, topic, start_time, download_url, download_token) -> bool:
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        try:
            c.execute(
                "INSERT INTO desk_session_jobs (meeting_uuid, topic, start_time, "
                "download_url, download_token, status, attempts, created_at, updated_at) "
                "VALUES (?,?,?,?,?, 'pending', 0, ?, ?)",
                (meeting_uuid, topic, start_time, download_url, download_token, now, now))
            c.commit(); return True
        except sqlite3.IntegrityError:
            return False  # duplicate webhook -> already queued

def claim_next():
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cutoff = int(time.time()) - _STALE_SECS
        row = c.execute(
            "SELECT * FROM desk_session_jobs WHERE status='pending' "
            "OR (status='processing' AND updated_at < ?) "
            "ORDER BY created_at ASC, rowid ASC LIMIT 1", (cutoff,)).fetchone()
        if not row:
            return None
        c.execute("UPDATE desk_session_jobs SET status='processing', updated_at=? "
                  "WHERE meeting_uuid=?", (int(time.time()), row["meeting_uuid"]))
        c.commit()
        return dict(row) | {"status": "processing"}

def mark_done(meeting_uuid, youtube_id):
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE desk_session_jobs SET status='done', youtube_id=?, "
                  "updated_at=? WHERE meeting_uuid=?",
                  (youtube_id, int(time.time()), meeting_uuid)); c.commit()

def mark_uploaded(meeting_uuid, youtube_id):
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE desk_session_jobs SET youtube_id=?, updated_at=? "
                  "WHERE meeting_uuid=?",
                  (youtube_id, int(time.time()), meeting_uuid)); c.commit()

def mark_error(meeting_uuid, error):
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        row = c.execute("SELECT attempts FROM desk_session_jobs WHERE meeting_uuid=?",
                        (meeting_uuid,)).fetchone()
        attempts = (row["attempts"] if row else 0) + 1
        status = "error" if attempts >= _MAX_ATTEMPTS else "pending"
        c.execute("UPDATE desk_session_jobs SET status=?, attempts=?, error=?, "
                  "updated_at=? WHERE meeting_uuid=?",
                  (status, attempts, str(error)[:500], int(time.time()), meeting_uuid))
        c.commit()

def count_status(status) -> int:
    with contextlib.closing(_connect()) as c:
        return c.execute("SELECT COUNT(*) n FROM desk_session_jobs WHERE status=?",
                         (status,)).fetchone()["n"]

def list_recent(limit=20):
    with contextlib.closing(_connect()) as c:
        rows = c.execute("SELECT * FROM desk_session_jobs ORDER BY created_at DESC "
                         "LIMIT ?", (int(limit),)).fetchall()
        return [dict(r) for r in rows]
