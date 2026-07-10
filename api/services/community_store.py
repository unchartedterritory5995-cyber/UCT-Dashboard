# api/services/community_store.py
"""The Floor — community store. Own SQLite DB (/data/community.db), house pattern.

NOTE: api/services/journal_two/community.py is an UNRELATED module (shared
watchlists). This store is the /community forum. Do not merge them.
"""
import json
import os
import sqlite3
import threading
import time
from contextlib import closing

_WRITE_LOCK = threading.Lock()

SPACES = {
    "mentor-desk": {"label": "Mentor Desk", "mentor_only": True},
    "trade-ideas": {"label": "Trade Ideas", "mentor_only": False},
    "questions": {"label": "Questions & Reviews", "mentor_only": False},
    "wins-lessons": {"label": "Wins & Lessons", "mentor_only": False},
}

REACTION_KINDS = ("fire", "bullish", "salute")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS threads (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    space            TEXT NOT NULL,
    author_id        TEXT,                -- NULL = seeded/system thread, renders as "UCT Mentor"
    title            TEXT NOT NULL,
    body             TEXT NOT NULL DEFAULT '',
    ticker_tags      TEXT NOT NULL DEFAULT '[]',
    pinned           INTEGER NOT NULL DEFAULT 0,
    locked           INTEGER NOT NULL DEFAULT 0,
    answered         INTEGER NOT NULL DEFAULT 0,
    desk_content_id  INTEGER UNIQUE,      -- education.db edu_videos.id when Desk-seeded
    deleted          INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_threads_space
    ON threads(space, pinned DESC, last_activity_at DESC);

CREATE TABLE IF NOT EXISTS posts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id        INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    author_id        TEXT NOT NULL,
    parent_post_id   INTEGER REFERENCES posts(id),
    body             TEXT NOT NULL,
    mentor_highlight INTEGER NOT NULL DEFAULT 0,
    deleted          INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_posts_author_time ON posts(author_id, created_at);

CREATE TABLE IF NOT EXISTS reactions (
    post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, user_id, kind)
);

CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id   INTEGER,
    post_id     INTEGER,
    reporter_id TEXT NOT NULL,
    reason      TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'open',   -- open | hidden | dismissed
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS read_state (
    user_id           TEXT NOT NULL,
    thread_id         INTEGER NOT NULL,
    last_seen_post_id INTEGER NOT NULL DEFAULT 0,
    seen_at           INTEGER NOT NULL,
    PRIMARY KEY (user_id, thread_id)
);

CREATE TABLE IF NOT EXISTS muted_users (
    user_id  TEXT PRIMARY KEY,
    muted_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS acks (
    user_id  TEXT PRIMARY KEY,
    acked_at INTEGER NOT NULL
);
"""


def _db_path() -> str:
    p = os.environ.get("COMMUNITY_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/community.db"
    return os.path.join(os.path.dirname(__file__), "..", "..", "data", "community.db")


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=5)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db() -> None:
    os.makedirs(os.path.dirname(os.path.abspath(_db_path())), exist_ok=True)
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.executescript(_SCHEMA)
        conn.commit()


def _now() -> int:
    return int(time.time())
