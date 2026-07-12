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

# ── Live chat (Pulse) ────────────────────────────────────────────────────────
# v1 launches ONE Pulse channel. Channels are code-defined (like SPACES, no DB
# table) and the slug is validated on every write/subscribe, mirroring
# create_thread's bad-space guard — a typo'd slug can never create an orphan room.
# Board spaces are also live rooms, addressed on the stream as "board:{space}".
CHANNELS = {
    "trading-floor": {"label": "Trading Floor",
                      "topic": "Live market-hours chat — talk the tape in real time.",
                      "sort": 0},
    "pre-market": {"label": "Pre-Market",
                   "topic": "Catalysts, gappers, and the plan before the bell. UCT posts the morning brief here.",
                   "sort": 1},
    "after-hours": {"label": "After Hours",
                    "topic": "Earnings reactions, EOD review, and tomorrow's watchlist.",
                    "sort": 2},
    "wins": {"label": "Wins & Green Days",
             "topic": "Share the trades that worked — screenshots and trade cards welcome.",
             "sort": 3},
}

# Chat reactions reuse the forum's kinds so the same UIcon glyphs render
# (fire→flame, bullish→equity, salute→star) — never emoji.
CHAT_REACTION_KINDS = REACTION_KINDS

# Chat rate limits (two-tier: short burst + hourly), env-tunable. Enforced INSIDE
# create_message under the write lock so a parallel flood can't slip the check.
CHAT_BURST_MAX = int(os.environ.get("CHAT_BURST_MAX", "5"))
CHAT_BURST_WINDOW_SECS = int(os.environ.get("CHAT_BURST_WINDOW_SECS", "10"))
CHAT_HOURLY_MAX = int(os.environ.get("CHAT_HOURLY_MAX", "300"))
CHAT_MENTION_CAP = 10


def is_valid_channel(slug) -> bool:
    """A Pulse channel slug, or a board room key 'board:{space}'."""
    if slug in CHANNELS:
        return True
    if isinstance(slug, str) and slug.startswith("board:"):
        return slug[len("board:"):] in SPACES
    return False


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

-- ── Live chat (Pulse channels + live Boards) ────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_slug        TEXT NOT NULL,          -- CHANNELS key or 'board:{space}'
    author_id           TEXT,                   -- NULL = system/mentor → "UCT Mentor"
    body                TEXT NOT NULL DEFAULT '',-- TipTap doc JSON string
    ticker_tags         TEXT NOT NULL DEFAULT '[]',
    card_json           TEXT,                   -- server-built typed embed (nullable)
    reply_to_message_id INTEGER,                -- v1 lightweight quote-reply
    pinned              INTEGER NOT NULL DEFAULT 0,   -- mentor pin (column now, feature soon)
    graduated_thread_id INTEGER,               -- forward-compat: Phase-2 Graduate
    edited_at           INTEGER,
    deleted             INTEGER NOT NULL DEFAULT 0,
    created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel_slug, id);
CREATE INDEX IF NOT EXISTS idx_messages_author_time ON messages(author_id, created_at);

CREATE TABLE IF NOT EXISTS message_reactions (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL,
    kind       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id, kind)
);

CREATE TABLE IF NOT EXISTS mentions (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id         INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    mentioned_user_id  TEXT NOT NULL,
    channel_slug       TEXT NOT NULL,
    seen               INTEGER NOT NULL DEFAULT 0,
    created_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mentions_user ON mentions(mentioned_user_id, seen);
CREATE INDEX IF NOT EXISTS idx_mentions_message ON mentions(message_id);

CREATE TABLE IF NOT EXISTS chat_read_state (
    user_id              TEXT NOT NULL,
    channel_slug         TEXT NOT NULL,
    last_seen_message_id INTEGER NOT NULL DEFAULT 0,
    seen_at              INTEGER NOT NULL,
    PRIMARY KEY (user_id, channel_slug)
);

CREATE TABLE IF NOT EXISTS chat_reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id  INTEGER NOT NULL,
    reporter_id TEXT NOT NULL,
    reason      TEXT NOT NULL DEFAULT '',
    preview     TEXT NOT NULL DEFAULT '',   -- snapshot of body at report time (edit-proof)
    status      TEXT NOT NULL DEFAULT 'open',   -- open | hidden | dismissed
    created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS poll_votes (
    message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL,
    option_key  TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id)   -- one vote per user per poll (re-vote updates)
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


def get_desk_thread_summaries(desk_content_ids):
    """Map desk_content_id (str) -> {thread_id, reply_count} for non-deleted seeded
    threads, in ONE query (no per-id full-space scan, and correct for threads ranked
    beyond any list window)."""
    ids = [int(i) for i in desk_content_ids if str(i).isdigit()]
    if not ids:
        return {}
    q = ",".join("?" * len(ids))
    with closing(get_connection()) as conn:
        rows = conn.execute(
            f"""SELECT t.desk_content_id AS dcid, t.id AS thread_id,
                       (SELECT COUNT(*) FROM posts p
                         WHERE p.thread_id = t.id AND p.deleted = 0) AS reply_count
                  FROM threads t
                 WHERE t.deleted = 0 AND t.desk_content_id IN ({q})""",
            ids).fetchall()
    return {str(r["dcid"]): {"thread_id": r["thread_id"],
                             "reply_count": r["reply_count"]} for r in rows}


def get_post(post_id):
    with closing(get_connection()) as conn:
        row = conn.execute("SELECT * FROM posts WHERE id=?", (post_id,)).fetchone()
    return dict(row) if row else None


def thread_space(thread_id):
    """Cheap space lookup (for live-board broadcast keys) without loading posts."""
    with closing(get_connection()) as conn:
        row = conn.execute("SELECT space FROM threads WHERE id=?", (thread_id,)).fetchone()
    return row["space"] if row else None


def post_space(post_id):
    with closing(get_connection()) as conn:
        row = conn.execute(
            "SELECT t.space FROM posts p JOIN threads t ON t.id=p.thread_id WHERE p.id=?",
            (post_id,)).fetchone()
    return row["space"] if row else None


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
                WHERE t.deleted = 0
                  AND (t.author_id IS NULL OR t.author_id != ?)""",
            (user_id, user_id)).fetchall()
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


# ── Live chat: messages, reactions, mentions, read-state, reports ────────────

class ChatRateLimited(Exception):
    """Raised by create_message when a member exceeds the burst/hourly cap."""


def list_channels():
    return [dict(slug=s, **meta)
            for s, meta in sorted(CHANNELS.items(), key=lambda kv: kv[1].get("sort", 0))]


def _walk_doc(node, fn):
    if isinstance(node, dict):
        fn(node)
        for c in node.get("content") or []:
            _walk_doc(c, fn)
    elif isinstance(node, list):
        for c in node:
            _walk_doc(c, fn)


def message_plaintext(body_json, limit=120):
    """Collapse a TipTap doc to a short plaintext snippet (for previews/reports)."""
    try:
        doc = json.loads(body_json) if isinstance(body_json, str) else body_json
    except Exception:
        return ""
    parts = []
    _walk_doc(doc, lambda n: parts.append(n["text"])
              if n.get("type") == "text" and isinstance(n.get("text"), str) else None)
    text = " ".join(" ".join(parts).split())
    return text[:limit]


def parse_mentions_from_doc(body_json):
    """Extract mentioned user ids from `userMention` nodes IN THE BODY (never trust a
    client-supplied array). Deduped, order-preserved, capped. The router validates
    each id against auth.db before persisting."""
    try:
        doc = json.loads(body_json) if isinstance(body_json, str) else body_json
    except Exception:
        return []
    ids = []

    def visit(n):
        if n.get("type") == "userMention":
            uid = (n.get("attrs") or {}).get("userId")
            if uid:
                ids.append(str(uid))
    _walk_doc(doc, visit)
    seen, out = set(), []
    for i in ids:
        if i not in seen:
            seen.add(i)
            out.append(i)
        if len(out) >= CHAT_MENTION_CAP:
            break
    return out


def _message_row_to_dict(row):
    d = dict(row)
    d["ticker_tags"] = json.loads(d.get("ticker_tags") or "[]")
    if d.get("deleted"):
        d["body"] = ""
        d["card_json"] = None
    return d


def create_message(channel_slug, author_id, body, *, ticker_tags=None, card_json=None,
                   reply_to_message_id=None, mention_user_ids=None,
                   bypass_rate_limit=False):
    """Persist a chat message + its mentions atomically. Rate limit is checked
    INSIDE the write lock so N parallel sends can't all slip a lock-free pre-check."""
    if not is_valid_channel(channel_slug):
        raise ValueError("bad-channel")
    now = _now()
    with _WRITE_LOCK, closing(get_connection()) as conn:
        if not bypass_rate_limit and author_id is not None:
            burst = conn.execute(
                "SELECT COUNT(*) FROM messages WHERE author_id=? AND created_at > ?",
                (author_id, now - CHAT_BURST_WINDOW_SECS)).fetchone()[0]
            if burst >= CHAT_BURST_MAX:
                raise ChatRateLimited("burst")
            hourly = conn.execute(
                "SELECT COUNT(*) FROM messages WHERE author_id=? AND created_at > ?",
                (author_id, now - 3600)).fetchone()[0]
            if hourly >= CHAT_HOURLY_MAX:
                raise ChatRateLimited("hourly")
        if reply_to_message_id is not None:
            r = conn.execute(
                "SELECT channel_slug, deleted FROM messages WHERE id=?",
                (reply_to_message_id,)).fetchone()
            if not r or r["deleted"] or r["channel_slug"] != channel_slug:
                reply_to_message_id = None   # drop a dangling referent, don't 400
        cur = conn.execute(
            """INSERT INTO messages (channel_slug, author_id, body, ticker_tags,
                                     card_json, reply_to_message_id, created_at)
               VALUES (?,?,?,?,?,?,?)""",
            (channel_slug, author_id, body, json.dumps(ticker_tags or []),
             card_json, reply_to_message_id, now))
        mid = cur.lastrowid
        for uid in (mention_user_ids or [])[:CHAT_MENTION_CAP]:
            if str(uid) == str(author_id):
                continue
            conn.execute(
                """INSERT INTO mentions (message_id, mentioned_user_id, channel_slug, created_at)
                   VALUES (?,?,?,?)""",
                (mid, str(uid), channel_slug, now))
        conn.commit()
        return mid


def get_message(message_id):
    with closing(get_connection()) as conn:
        row = conn.execute("SELECT * FROM messages WHERE id=?", (message_id,)).fetchone()
    return _message_row_to_dict(row) if row else None


def _attach_reactions_and_replies(conn, msgs, viewer_id=None):
    ids = [m["id"] for m in msgs]
    if not ids:
        return
    q = ",".join("?" * len(ids))
    rx = conn.execute(
        f"""SELECT message_id, kind, COUNT(*) AS n FROM message_reactions
             WHERE message_id IN ({q}) GROUP BY message_id, kind""", ids).fetchall()
    by_msg = {}
    for r in rx:
        by_msg.setdefault(r["message_id"], {})[r["kind"]] = r["n"]
    mine = {}
    if viewer_id is not None:
        for r in conn.execute(
                f"""SELECT message_id, kind FROM message_reactions
                     WHERE message_id IN ({q}) AND user_id=?""", ids + [viewer_id]).fetchall():
            mine.setdefault(r["message_id"], []).append(r["kind"])
    reply_ids = [m["reply_to_message_id"] for m in msgs if m.get("reply_to_message_id")]
    replies = {}
    if reply_ids:
        q2 = ",".join("?" * len(reply_ids))
        for r in conn.execute(
                f"SELECT id, author_id, body, deleted FROM messages WHERE id IN ({q2})",
                reply_ids).fetchall():
            replies[r["id"]] = {
                "id": r["id"], "author_id": r["author_id"],
                "snippet": "" if r["deleted"] else message_plaintext(r["body"], 80)}
    for m in msgs:
        m["reactions"] = by_msg.get(m["id"], {})
        m["my_reactions"] = mine.get(m["id"], [])
        rt = m.get("reply_to_message_id")
        m["reply_preview"] = replies.get(rt) if rt else None


def list_messages(channel_slug, *, before_id=None, after_id=None, limit=50, viewer_id=None):
    """Return messages ascending by id (deleted rows kept as blanked tombstones so
    reconnecting clients converge). `before_id` paginates history; `after_id` gap-fills."""
    limit = max(1, min(int(limit), 200))
    where, params = "channel_slug=?", [channel_slug]
    if before_id:
        where += " AND id < ?"; params.append(int(before_id))
    if after_id:
        where += " AND id > ?"; params.append(int(after_id))
    order = "ASC" if after_id else "DESC"
    with closing(get_connection()) as conn:
        rows = conn.execute(
            f"SELECT * FROM messages WHERE {where} ORDER BY id {order} LIMIT ?",
            params + [limit]).fetchall()
        msgs = [_message_row_to_dict(r) for r in rows]
        if order == "DESC":
            msgs.reverse()
        _attach_reactions_and_replies(conn, msgs, viewer_id=viewer_id)
    return msgs


def edit_message(message_id, author_id, body, ticker_tags=None):
    now = _now()
    with _WRITE_LOCK, closing(get_connection()) as conn:
        row = conn.execute(
            "SELECT author_id, deleted FROM messages WHERE id=?", (message_id,)).fetchone()
        if not row or row["deleted"]:
            raise ValueError("no-message")
        if row["author_id"] != author_id:
            raise ValueError("not-author")
        sets, vals = ["body=?", "edited_at=?"], [body, now]
        if ticker_tags is not None:
            sets.append("ticker_tags=?"); vals.append(json.dumps(ticker_tags))
        vals.append(message_id)
        conn.execute(f"UPDATE messages SET {', '.join(sets)} WHERE id=?", vals)
        conn.commit()


def soft_delete_message(message_id):
    """Blank BOTH body and card_json — a deleted trade card still carries journal data."""
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute(
            "UPDATE messages SET deleted=1, body='', card_json=NULL WHERE id=?",
            (message_id,))
        conn.commit()


def set_message_pinned(message_id, value):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute("UPDATE messages SET pinned=? WHERE id=?",
                     (1 if value else 0, message_id))
        conn.commit()


def set_message_graduated(message_id, thread_id):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute("UPDATE messages SET graduated_thread_id=? WHERE id=?",
                     (thread_id, message_id))
        conn.commit()


def toggle_message_reaction(message_id, user_id, kind):
    if kind not in CHAT_REACTION_KINDS:
        raise ValueError("bad-kind")
    with _WRITE_LOCK, closing(get_connection()) as conn:
        exists = conn.execute(
            "SELECT 1 FROM message_reactions WHERE message_id=? AND user_id=? AND kind=?",
            (message_id, user_id, kind)).fetchone()
        if exists:
            conn.execute(
                "DELETE FROM message_reactions WHERE message_id=? AND user_id=? AND kind=?",
                (message_id, user_id, kind))
            conn.commit()
            return False
        conn.execute(
            "INSERT INTO message_reactions (message_id, user_id, kind, created_at) VALUES (?,?,?,?)",
            (message_id, user_id, kind, _now()))
        conn.commit()
        return True


def mark_channel_read(user_id, channel_slug, last_seen_message_id):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute(
            """INSERT INTO chat_read_state (user_id, channel_slug, last_seen_message_id, seen_at)
               VALUES (?,?,?,?)
               ON CONFLICT(user_id, channel_slug) DO UPDATE SET
                 last_seen_message_id =
                   MAX(chat_read_state.last_seen_message_id, excluded.last_seen_message_id),
                 seen_at = excluded.seen_at""",
            (user_id, channel_slug, int(last_seen_message_id or 0), _now()))
        conn.commit()


def ensure_caught_up(user_id, channel_slug):
    """On first open of a channel, seed last_seen = MAX(id) so a new member isn't
    greeted with the whole history as unread ('joined = caught up')."""
    with _WRITE_LOCK, closing(get_connection()) as conn:
        if conn.execute("SELECT 1 FROM chat_read_state WHERE user_id=? AND channel_slug=?",
                        (user_id, channel_slug)).fetchone():
            return
        maxid = conn.execute(
            "SELECT COALESCE(MAX(id),0) FROM messages WHERE channel_slug=?",
            (channel_slug,)).fetchone()[0]
        conn.execute(
            "INSERT INTO chat_read_state (user_id, channel_slug, last_seen_message_id, seen_at) "
            "VALUES (?,?,?,?)", (user_id, channel_slug, maxid, _now()))
        conn.commit()


def ensure_caught_up_many(user_id, slugs):
    """Seed read-state for several channels — called off the event loop (each
    ensure_caught_up takes the write lock + touches SQLite)."""
    for s in slugs or []:
        try:
            ensure_caught_up(user_id, s)
        except Exception:
            pass


def unread_by_channel(user_id):
    """Per-Pulse-channel unread count. Excludes deleted + the user's own messages,
    capped at 100. A never-opened channel reads 0 (caught-up default)."""
    out = {}
    with closing(get_connection()) as conn:
        for slug in CHANNELS:
            rs = conn.execute(
                "SELECT last_seen_message_id FROM chat_read_state WHERE user_id=? AND channel_slug=?",
                (user_id, slug)).fetchone()
            if rs is None:
                out[slug] = 0
                continue
            out[slug] = conn.execute(
                """SELECT COUNT(*) FROM (
                     SELECT id FROM messages
                      WHERE channel_slug=? AND deleted=0 AND id > ?
                        AND (author_id IS NULL OR author_id != ?)
                      LIMIT 100)""",
                (slug, rs["last_seen_message_id"], user_id)).fetchone()[0]
    return out


def list_mentions(user_id, limit=30):
    with closing(get_connection()) as conn:
        rows = conn.execute(
            """SELECT mn.id, mn.message_id, mn.channel_slug, mn.seen, mn.created_at,
                      m.author_id, m.body
                 FROM mentions mn JOIN messages m ON m.id = mn.message_id
                WHERE mn.mentioned_user_id=? AND m.deleted=0
                ORDER BY mn.id DESC LIMIT ?""",
            (user_id, limit)).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["snippet"] = message_plaintext(d.pop("body") or "", 120)
        out.append(d)
    return out


def count_unseen_mentions(user_id):
    with closing(get_connection()) as conn:
        return conn.execute(
            """SELECT COUNT(*) FROM mentions mn JOIN messages m ON m.id=mn.message_id
                WHERE mn.mentioned_user_id=? AND mn.seen=0 AND m.deleted=0""",
            (user_id,)).fetchone()[0]


def mark_mentions_seen(user_id, mention_ids=None):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        if mention_ids:
            q = ",".join("?" * len(mention_ids))
            conn.execute(
                f"UPDATE mentions SET seen=1 WHERE mentioned_user_id=? AND id IN ({q})",
                [user_id] + [int(i) for i in mention_ids])
        else:
            conn.execute("UPDATE mentions SET seen=1 WHERE mentioned_user_id=?", (user_id,))
        conn.commit()


def create_chat_report(reporter_id, message_id, reason=""):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        m = conn.execute("SELECT body FROM messages WHERE id=?", (message_id,)).fetchone()
        if not m:
            raise ValueError("no-message")
        preview = message_plaintext(m["body"] or "", 200)
        cur = conn.execute(
            """INSERT INTO chat_reports (message_id, reporter_id, reason, preview, created_at)
               VALUES (?,?,?,?,?)""",
            (message_id, reporter_id, (reason or "")[:500], preview, _now()))
        conn.commit()
        return cur.lastrowid


def list_chat_reports(status="open"):
    with closing(get_connection()) as conn:
        rows = conn.execute(
            """SELECT r.*, m.author_id AS target_author_id, m.channel_slug,
                      m.deleted AS target_deleted
                 FROM chat_reports r LEFT JOIN messages m ON m.id = r.message_id
                WHERE r.status=? ORDER BY r.created_at DESC""",
            (status,)).fetchall()
    return [dict(r) for r in rows]


def set_chat_report_status(report_id, status):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute("UPDATE chat_reports SET status=? WHERE id=?", (status, report_id))
        conn.commit()


def set_poll_vote(message_id, user_id, option_key):
    with _WRITE_LOCK, closing(get_connection()) as conn:
        conn.execute(
            """INSERT INTO poll_votes (message_id, user_id, option_key, created_at)
               VALUES (?,?,?,?)
               ON CONFLICT(message_id, user_id) DO UPDATE SET
                 option_key = excluded.option_key, created_at = excluded.created_at""",
            (message_id, user_id, option_key, _now()))
        conn.commit()


def poll_results(message_id, viewer_id=None):
    with closing(get_connection()) as conn:
        rows = conn.execute(
            "SELECT option_key, COUNT(*) AS n FROM poll_votes WHERE message_id=? GROUP BY option_key",
            (message_id,)).fetchall()
        counts = {r["option_key"]: r["n"] for r in rows}
        my = None
        if viewer_id is not None:
            r = conn.execute(
                "SELECT option_key FROM poll_votes WHERE message_id=? AND user_id=?",
                (message_id, viewer_id)).fetchone()
            my = r["option_key"] if r else None
    return {"counts": counts, "total": sum(counts.values()), "my_vote": my}


def hot_tickers(limit=6, since_seconds=7200, scan=400):
    """Most-discussed tickers across recent live-chat messages — powers The Tape."""
    import collections
    cutoff = _now() - since_seconds
    with closing(get_connection()) as conn:
        rows = conn.execute(
            "SELECT ticker_tags FROM messages WHERE deleted=0 AND created_at > ? "
            "ORDER BY id DESC LIMIT ?", (cutoff, scan)).fetchall()
    counts = collections.Counter()
    for r in rows:
        for t in (json.loads(r["ticker_tags"] or "[]") or []):
            counts[t] += 1
    return [{"ticker": t, "count": n} for t, n in counts.most_common(limit)]
