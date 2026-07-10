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


# ── Mentor tools, reactions, read state, reports, mute, ack ─────────────────

def set_highlight(post_id, value):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        row = conn.execute("SELECT thread_id FROM posts WHERE id=?", (post_id,)).fetchone()
        if not row:
            return
        if value:
            conn.execute("UPDATE posts SET mentor_highlight=0 WHERE thread_id=?",
                         (row["thread_id"],))
        conn.execute("UPDATE posts SET mentor_highlight=? WHERE id=?",
                     (1 if value else 0, post_id))
        conn.commit()


def toggle_reaction(post_id, user_id, kind):
    if kind not in REACTION_KINDS:
        raise ValueError("bad-kind")
    with _WRITE_LOCK, closing(get_connection()) as conn:
        existing = conn.execute(
            "SELECT 1 FROM reactions WHERE post_id=? AND user_id=? AND kind=?",
            (post_id, user_id, kind)).fetchone()
        if existing:
            conn.execute(
                "DELETE FROM reactions WHERE post_id=? AND user_id=? AND kind=?",
                (post_id, user_id, kind))
            conn.commit()
            return False
        conn.execute(
            "INSERT INTO reactions (post_id, user_id, kind, created_at) VALUES (?,?,?,?)",
            (post_id, user_id, kind, _now()))
        conn.commit()
        return True


def mark_read(user_id, thread_id, last_seen_post_id):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute(
            """INSERT INTO read_state (user_id, thread_id, last_seen_post_id, seen_at)
               VALUES (?,?,?,?)
               ON CONFLICT(user_id, thread_id) DO UPDATE SET
                 last_seen_post_id = MAX(read_state.last_seen_post_id, excluded.last_seen_post_id),
                 seen_at = excluded.seen_at""",
            (user_id, thread_id, int(last_seen_post_id or 0), _now()))
        conn.commit()


def unread_summary(user_id):
    with closing(get_connection()) as conn:
        rows = conn.execute(
            """SELECT t.space,
                      (SELECT COALESCE(MAX(p.id), 0) FROM posts p
                        WHERE p.thread_id = t.id AND p.deleted = 0) AS last_post_id,
                      COALESCE(rs.last_seen_post_id, -1) AS seen
                 FROM threads t
                 LEFT JOIN read_state rs
                        ON rs.thread_id = t.id AND rs.user_id = ?
                WHERE t.deleted = 0""",
            (user_id,)).fetchall()
    by_space = {k: 0 for k in SPACES}
    total = 0
    for r in rows:
        # unread = never opened (seen == -1) or new posts since last visit
        if r["seen"] == -1 or r["last_post_id"] > r["seen"]:
            by_space[r["space"]] = by_space.get(r["space"], 0) + 1
            total += 1
    return {"total": total, "by_space": by_space}


def create_report(reporter_id, reason, thread_id=None, post_id=None):
    if bool(thread_id) == bool(post_id):   # exactly one target
        raise ValueError("bad-target")
    with _WRITE_LOCK, closing(get_connection()) as conn:
        cur = conn.execute(
            """INSERT INTO reports (thread_id, post_id, reporter_id, reason, created_at)
               VALUES (?,?,?,?,?)""",
            (thread_id, post_id, reporter_id, (reason or "")[:500], _now()))
        conn.commit()
        return cur.lastrowid


def list_reports(status="open"):
    with closing(get_connection()) as conn:
        rows = conn.execute(
            """SELECT r.*,
                      COALESCE(t.title, substr(p.body, 1, 200), '') AS preview,
                      COALESCE(t.author_id, p.author_id) AS target_author_id
                 FROM reports r
                 LEFT JOIN threads t ON t.id = r.thread_id
                 LEFT JOIN posts p ON p.id = r.post_id
                WHERE r.status = ?
                ORDER BY r.created_at DESC""",
            (status,)).fetchall()
    return [dict(r) for r in rows]


def set_report_status(report_id, status):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute("UPDATE reports SET status=? WHERE id=?", (status, report_id))
        conn.commit()


def set_muted(user_id, muted):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        if muted:
            conn.execute(
                "INSERT OR REPLACE INTO muted_users (user_id, muted_at) VALUES (?,?)",
                (user_id, _now()))
        else:
            conn.execute("DELETE FROM muted_users WHERE user_id=?", (user_id,))
        conn.commit()


def is_muted(user_id):
    with closing(get_connection()) as conn:
        return conn.execute(
            "SELECT 1 FROM muted_users WHERE user_id=?", (user_id,)).fetchone() is not None


def set_ack(user_id):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute("INSERT OR IGNORE INTO acks (user_id, acked_at) VALUES (?,?)",
                     (user_id, _now()))
        conn.commit()


def has_ack(user_id):
    with closing(get_connection()) as conn:
        return conn.execute(
            "SELECT 1 FROM acks WHERE user_id=?", (user_id,)).fetchone() is not None
