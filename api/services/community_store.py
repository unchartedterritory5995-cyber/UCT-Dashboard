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


# ── Threads & posts ──────────────────────────────────────────────────────────

def create_thread(space, author_id, title, body="", ticker_tags=None,
                  desk_content_id=None, pinned=0):
    if space not in SPACES:
        raise ValueError("bad-space")
    now = _now()
    with _WRITE_LOCK, closing(get_connection()) as conn:
        cur = conn.execute(
            """INSERT INTO threads (space, author_id, title, body, ticker_tags,
                                    pinned, desk_content_id, created_at, last_activity_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (space, author_id, title, body, json.dumps(ticker_tags or []),
             1 if pinned else 0, desk_content_id, now, now))
        conn.commit()
        return cur.lastrowid


def update_thread(thread_id, *, title=None, body=None):
    sets, vals = [], []
    if title is not None:
        sets.append("title=?"); vals.append(title)
    if body is not None:
        sets.append("body=?"); vals.append(body)
    if not sets:
        return
    vals.append(thread_id)
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute(f"UPDATE threads SET {', '.join(sets)} WHERE id=?", vals)
        conn.commit()


def _thread_row_to_dict(row):
    d = dict(row)
    d["ticker_tags"] = json.loads(d.get("ticker_tags") or "[]")
    return d


def list_threads(space, limit=50, offset=0):
    with closing(get_connection()) as conn:
        rows = conn.execute(
            """SELECT t.*,
                      (SELECT COUNT(*) FROM posts p
                        WHERE p.thread_id = t.id AND p.deleted = 0) AS reply_count,
                      (SELECT COALESCE(MAX(p.id), 0) FROM posts p
                        WHERE p.thread_id = t.id AND p.deleted = 0) AS last_post_id
                 FROM threads t
                WHERE t.space = ? AND t.deleted = 0
                ORDER BY t.pinned DESC, t.last_activity_at DESC
                LIMIT ? OFFSET ?""",
            (space, limit, offset)).fetchall()
    return [_thread_row_to_dict(r) for r in rows]


def get_thread(thread_id):
    with closing(get_connection()) as conn:
        row = conn.execute(
            "SELECT * FROM threads WHERE id=? AND deleted=0", (thread_id,)).fetchone()
        if not row:
            return None
        posts = [dict(p) for p in conn.execute(
            "SELECT * FROM posts WHERE thread_id=? ORDER BY created_at, id",
            (thread_id,)).fetchall()]
        counts = conn.execute(
            """SELECT post_id, kind, COUNT(*) AS n FROM reactions
                WHERE post_id IN (SELECT id FROM posts WHERE thread_id=?)
                GROUP BY post_id, kind""", (thread_id,)).fetchall()
    by_post = {}
    for c in counts:
        by_post.setdefault(c["post_id"], {})[c["kind"]] = c["n"]
    for p in posts:
        if p["deleted"]:
            p["body"] = ""
        p["reactions"] = by_post.get(p["id"], {})
    d = _thread_row_to_dict(row)
    d["posts"] = posts
    return d


def get_thread_by_desk_id(desk_content_id):
    with closing(get_connection()) as conn:
        row = conn.execute(
            "SELECT * FROM threads WHERE desk_content_id=?", (desk_content_id,)).fetchone()
    return _thread_row_to_dict(row) if row else None


def get_post(post_id):
    with closing(get_connection()) as conn:
        row = conn.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
    return dict(row) if row else None


def create_post(thread_id, author_id, body, parent_post_id=None):
    now = _now()
    with _WRITE_LOCK, closing(get_connection()) as conn:
        t = conn.execute(
            "SELECT locked FROM threads WHERE id=? AND deleted=0", (thread_id,)).fetchone()
        if not t:
            raise ValueError("no-thread")
        if t["locked"]:
            raise ValueError("locked")
        if parent_post_id is not None:
            parent = conn.execute(
                "SELECT thread_id, parent_post_id, deleted FROM posts WHERE id=?",
                (parent_post_id,)).fetchone()
            if (not parent or parent["deleted"] or parent["thread_id"] != thread_id
                    or parent["parent_post_id"] is not None):
                raise ValueError("bad-parent")
        cur = conn.execute(
            """INSERT INTO posts (thread_id, author_id, parent_post_id, body, created_at)
               VALUES (?,?,?,?,?)""",
            (thread_id, author_id, parent_post_id, body, now))
        conn.execute("UPDATE threads SET last_activity_at=? WHERE id=?", (now, thread_id))
        conn.commit()
        return cur.lastrowid


def soft_delete_thread(thread_id):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute("UPDATE threads SET deleted=1 WHERE id=?", (thread_id,))
        conn.commit()


def soft_delete_post(post_id):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute("UPDATE posts SET deleted=1 WHERE id=?", (post_id,))
        conn.commit()


def set_thread_flag(thread_id, field, value):
    if field not in ("pinned", "locked", "answered"):
        raise ValueError("bad-field")
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute(f"UPDATE threads SET {field}=? WHERE id=?",
                     (1 if value else 0, thread_id))
        conn.commit()


def count_recent_threads(author_id, seconds=3600):
    with closing(get_connection()) as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM threads WHERE author_id=? AND created_at > ?",
            (author_id, _now() - seconds)).fetchone()[0]


def count_recent_posts(author_id, seconds=3600):
    with closing(get_connection()) as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM posts WHERE author_id=? AND created_at > ?",
            (author_id, _now() - seconds)).fetchone()[0]
