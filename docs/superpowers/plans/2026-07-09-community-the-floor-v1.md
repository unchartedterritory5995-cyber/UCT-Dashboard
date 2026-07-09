# The Floor — Community V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship V1 of "The Floor" — a native, paid-members community at `/community` with four fixed spaces, threaded discussion, mentor tools, Desk auto-seeded threads, and a report queue — dark behind `COMMUNITY_ENABLED`.

**Architecture:** House pattern end-to-end: a new `/data/community.db` SQLite store (`api/services/community_store.py`) + FastAPI router (`api/routers/community.py`) + a lazy-loaded React page (`app/src/pages/community/`). Desk publishes seed Mentor Desk threads via `api/services/community_seed.py` hooks (idempotent by `desk_content_id`). Spec: `docs/superpowers/specs/2026-07-09-community-space-design.md`.

**Tech Stack:** FastAPI + sqlite3 (stdlib) · React 18 + Vite + SWR + TipTap 3 (already installed) · Pillow for image uploads · pytest (httpx ASGITransport) + vitest.

## Global Constraints

- **Feature flag:** every `/api/community/*` endpoint except `/status` returns **503** when `COMMUNITY_ENABLED != "1"`. Frontend nav hides unless `/api/community/status` says `enabled: true`.
- **Access:** reads+writes require a **paid plan or admin** (`is_paid_user`); mentor/mod actions require `role == 'admin'` (`require_admin`). Mentor == admin — no new user column.
- **Spaces are fixed in code:** `mentor-desk` (mentor-only thread creation), `trade-ideas`, `questions`, `wins-lessons`. Exactly these four keys.
- **One-level reply nesting:** `parent_post_id` must reference a post in the same thread whose own `parent_post_id` IS NULL. Deeper nesting is a 400.
- **Soft-delete everywhere** — never `DELETE` rows for user content; set `deleted=1`.
- **Post/thread body = TipTap JSON string** (same as Notebook), max 50,000 bytes, must `json.loads` cleanly. NOT markdown (spec amended).
- **Rate limits (per user, app-level):** 5 threads/hour, 30 posts/hour (env `COMMUNITY_THREADS_PER_HOUR` / `COMMUNITY_POSTS_PER_HOUR`).
- **Images:** `/data/community_uploads/{user_id}/{uuid}.webp`, Pillow-converted, 5 MB upload cap, images only (spec amended — /data volume, not R2).
- **No emoji in UI** — icons via `UIcon` (`app/src/components/ui/UIcon.jsx`); add glyphs to its `ICONS` registry.
- **CSS:** design tokens from `app/src/styles/tokens.css`; breakpoints ONLY 640/1024; layout responsiveness via CSS `@media`, never `useMediaQuery`.
- **DB connections:** WAL + `PRAGMA foreign_keys=ON`, `row_factory = sqlite3.Row`, `contextlib.closing` on every connection, module `_WRITE_LOCK` around writes.
- **Timestamps:** integer epoch seconds (`int(time.time())`).
- **Ship dark:** deploy with `COMMUNITY_ENABLED` unset. Deploys land **≥4:20 PM ET or <9:15 AM ET** only. Before push: `grep -c broker_sync api/main.py` must be ≥ 7.
- Run backend tests with `python -m pytest tests/api/test_community_store.py -v` style commands from the repo root; frontend with `cd app && npx vitest run src/pages/community`.

---

### Task 1: Community store — schema, connection, init

**Files:**
- Create: `api/services/community_store.py`
- Test: `tests/api/test_community_store.py`

**Interfaces:**
- Consumes: nothing (stdlib only)
- Produces: `SPACES: dict[str, dict]` (keys `mentor-desk|trade-ideas|questions|wins-lessons`, values `{"label": str, "mentor_only": bool}`), `REACTION_KINDS = ("fire", "bullish", "salute")`, `_db_path() -> str`, `get_connection() -> sqlite3.Connection`, `_init_db() -> None`

- [ ] **Step 1: Write the failing test**

```python
# tests/api/test_community_store.py
import os
import sqlite3
import tempfile

import pytest


@pytest.fixture
def store(monkeypatch, tmp_path):
    """community_store pointed at a temp DB (path read dynamically per call)."""
    monkeypatch.setenv("COMMUNITY_DB_PATH", str(tmp_path / "community.db"))
    from api.services import community_store
    community_store._init_db()
    return community_store


def test_init_creates_tables(store):
    with store.get_connection() as conn:
        names = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert {"threads", "posts", "reactions", "reports",
            "read_state", "muted_users", "acks"} <= names


def test_spaces_fixed(store):
    assert set(store.SPACES) == {"mentor-desk", "trade-ideas", "questions", "wins-lessons"}
    assert store.SPACES["mentor-desk"]["mentor_only"] is True
    assert store.SPACES["trade-ideas"]["mentor_only"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_community_store.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.community_store'`

- [ ] **Step 3: Write the store module**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/api/test_community_store.py -v`
Expected: 2 passed

- [ ] **Step 5: Commit**

```bash
git add api/services/community_store.py tests/api/test_community_store.py
git commit -m "feat(community): community.db store — schema + connection (The Floor V1)"
```

---

### Task 2: Store — thread/post CRUD, nesting rule, rate-limit counters

**Files:**
- Modify: `api/services/community_store.py` (append functions)
- Test: `tests/api/test_community_store.py` (append tests)

**Interfaces:**
- Consumes: Task 1 (`get_connection`, `_now`, `_WRITE_LOCK`, `SPACES`)
- Produces:
  - `create_thread(space: str, author_id: str | None, title: str, body: str = "", ticker_tags: list[str] | None = None, desk_content_id: int | None = None, pinned: int = 0) -> int` — raises `ValueError("bad-space")`
  - `list_threads(space: str, limit: int = 50, offset: int = 0) -> list[dict]` — pinned first then `last_activity_at` desc; each dict adds `reply_count: int` and `last_post_id: int`
  - `get_thread(thread_id: int) -> dict | None` — adds `posts: list[dict]` (chronological; deleted posts keep the row but `body == ""` and `deleted == 1`); each post adds `reactions: dict[str, int]`
  - `get_thread_by_desk_id(desk_content_id: int) -> dict | None` (bare row, no posts)
  - `update_thread(thread_id: int, *, title: str | None = None, body: str | None = None) -> None`
  - `create_post(thread_id: int, author_id: str, body: str, parent_post_id: int | None = None) -> int` — raises `ValueError` with message `"no-thread"|"locked"|"bad-parent"`
  - `soft_delete_thread(thread_id: int)` / `soft_delete_post(post_id: int)`
  - `get_post(post_id: int) -> dict | None`
  - `count_recent_threads(author_id: str, seconds: int = 3600) -> int` / `count_recent_posts(author_id: str, seconds: int = 3600) -> int`

- [ ] **Step 1: Write the failing tests (append to `tests/api/test_community_store.py`)**

```python
def test_thread_and_post_roundtrip(store):
    tid = store.create_thread("trade-ideas", "u1", "NVDA setup", body='{"type":"doc"}',
                              ticker_tags=["NVDA"])
    rows = store.list_threads("trade-ideas")
    assert [r["id"] for r in rows] == [tid]
    assert rows[0]["reply_count"] == 0

    p1 = store.create_post(tid, "u2", '{"type":"doc"}')
    p2 = store.create_post(tid, "u3", '{"type":"doc"}', parent_post_id=p1)
    t = store.get_thread(tid)
    assert [p["id"] for p in t["posts"]] == [p1, p2]
    assert store.list_threads("trade-ideas")[0]["reply_count"] == 2

    # one-level nesting only: replying to a reply is rejected
    with pytest.raises(ValueError, match="bad-parent"):
        store.create_post(tid, "u4", '{"type":"doc"}', parent_post_id=p2)


def test_bad_space_rejected(store):
    with pytest.raises(ValueError, match="bad-space"):
        store.create_thread("random-room", "u1", "x")


def test_locked_thread_rejects_posts(store):
    tid = store.create_thread("questions", "u1", "q")
    store.set_thread_flag(tid, "locked", 1)  # defined in Task 3; stub inline for now
    with pytest.raises(ValueError, match="locked"):
        store.create_post(tid, "u2", '{"type":"doc"}')


def test_soft_delete_redacts_post_body(store):
    tid = store.create_thread("questions", "u1", "q")
    pid = store.create_post(tid, "u2", '{"type":"doc"}')
    store.soft_delete_post(pid)
    t = store.get_thread(tid)
    assert t["posts"][0]["deleted"] == 1
    assert t["posts"][0]["body"] == ""


def test_pinned_sorts_first(store):
    a = store.create_thread("trade-ideas", "u1", "a")
    b = store.create_thread("trade-ideas", "u1", "b", pinned=1)
    assert [r["id"] for r in store.list_threads("trade-ideas")] == [b, a]


def test_rate_limit_counters(store):
    for _ in range(3):
        store.create_thread("trade-ideas", "u9", "t")
    assert store.count_recent_threads("u9") == 3
    assert store.count_recent_threads("someone-else") == 0
```

Note: `test_locked_thread_rejects_posts` uses `set_thread_flag` from Task 3 — include a minimal `set_thread_flag` in this task (it is 6 lines) so the test suite stays green per-task.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `python -m pytest tests/api/test_community_store.py -v`
Expected: Task-1 tests pass; new tests FAIL with `AttributeError: ... has no attribute 'create_thread'`

- [ ] **Step 3: Append the implementation to `api/services/community_store.py`**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_community_store.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add api/services/community_store.py tests/api/test_community_store.py
git commit -m "feat(community): thread/post CRUD, one-level nesting, rate counters"
```

---

### Task 3: Store — mentor actions, reactions, read state, reports, mute, ack

**Files:**
- Modify: `api/services/community_store.py` (append)
- Test: `tests/api/test_community_store.py` (append)

**Interfaces:**
- Consumes: Tasks 1–2
- Produces:
  - `set_highlight(post_id: int, value: bool) -> None` — setting True clears any other highlight in the same thread (single mentor take per thread)
  - `toggle_reaction(post_id: int, user_id: str, kind: str) -> bool` — returns True if now ON; raises `ValueError("bad-kind")` for kinds outside `REACTION_KINDS`
  - `mark_read(user_id: str, thread_id: int, last_seen_post_id: int) -> None` (monotonic — never moves backwards)
  - `unread_summary(user_id: str) -> dict` — `{"total": int, "by_space": {space: int}}`; a thread is unread when it has never been opened (no read_state row) or `last_post_id > last_seen_post_id`
  - `create_report(reporter_id: str, reason: str, thread_id: int | None = None, post_id: int | None = None) -> int` — exactly one target required (`ValueError("bad-target")`)
  - `list_reports(status: str = "open") -> list[dict]` — each row joined with `preview` (thread title or post body head) and `target_author_id`
  - `set_report_status(report_id: int, status: str) -> None`
  - `set_muted(user_id: str, muted: bool) -> None` / `is_muted(user_id: str) -> bool`
  - `set_ack(user_id: str) -> None` / `has_ack(user_id: str) -> bool`

- [ ] **Step 1: Write the failing tests (append to `tests/api/test_community_store.py`)**

```python
def test_highlight_is_exclusive_per_thread(store):
    tid = store.create_thread("questions", "u1", "q")
    p1 = store.create_post(tid, "u2", "{}")
    p2 = store.create_post(tid, "u3", "{}")
    store.set_highlight(p1, True)
    store.set_highlight(p2, True)
    posts = {p["id"]: p for p in store.get_thread(tid)["posts"]}
    assert posts[p1]["mentor_highlight"] == 0
    assert posts[p2]["mentor_highlight"] == 1


def test_reaction_toggle(store):
    tid = store.create_thread("wins-lessons", "u1", "w")
    pid = store.create_post(tid, "u2", "{}")
    assert store.toggle_reaction(pid, "u3", "fire") is True
    assert store.get_thread(tid)["posts"][0]["reactions"] == {"fire": 1}
    assert store.toggle_reaction(pid, "u3", "fire") is False
    assert store.get_thread(tid)["posts"][0]["reactions"] == {}
    with pytest.raises(ValueError, match="bad-kind"):
        store.toggle_reaction(pid, "u3", "rocketship")


def test_unread_summary_and_mark_read(store):
    tid = store.create_thread("trade-ideas", "u1", "t")
    pid = store.create_post(tid, "u2", "{}")
    s = store.unread_summary("u3")
    assert s["total"] == 1 and s["by_space"]["trade-ideas"] == 1
    store.mark_read("u3", tid, pid)
    assert store.unread_summary("u3")["total"] == 0
    # monotonic: marking an older post doesn't regress
    p2 = store.create_post(tid, "u2", "{}")
    store.mark_read("u3", tid, p2)
    store.mark_read("u3", tid, pid)
    assert store.unread_summary("u3")["total"] == 0


def test_reports_lifecycle(store):
    tid = store.create_thread("questions", "u1", "spam thread")
    rid = store.create_report("u2", "spam", thread_id=tid)
    open_reports = store.list_reports("open")
    assert [r["id"] for r in open_reports] == [rid]
    assert "spam thread" in open_reports[0]["preview"]
    store.set_report_status(rid, "dismissed")
    assert store.list_reports("open") == []
    with pytest.raises(ValueError, match="bad-target"):
        store.create_report("u2", "both", thread_id=1, post_id=1)


def test_mute_and_ack(store):
    assert store.is_muted("u1") is False
    store.set_muted("u1", True)
    assert store.is_muted("u1") is True
    store.set_muted("u1", False)
    assert store.is_muted("u1") is False
    assert store.has_ack("u1") is False
    store.set_ack("u1")
    assert store.has_ack("u1") is True
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `python -m pytest tests/api/test_community_store.py -v`
Expected: new tests FAIL with `AttributeError` on the new function names

- [ ] **Step 3: Append the implementation to `api/services/community_store.py`**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_community_store.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add api/services/community_store.py tests/api/test_community_store.py
git commit -m "feat(community): mentor tools, reactions, read state, reports, mute, ack"
```

---

### Task 4: Router — flag gate, status, read endpoints

**Files:**
- Create: `api/routers/community.py`
- Test: `tests/api/test_community_router.py`

**Interfaces:**
- Consumes: `community_store` (Tasks 1–3); `get_current_user`, `get_current_user_with_plan`, `is_paid_user`, `require_admin` from `api.middleware.auth_middleware`
- Produces: `router = APIRouter(prefix="/api/community", tags=["community"])` with:
  - `GET /api/community/status` → `{"enabled": bool, "acked": bool, "is_mentor": bool, "muted": bool}` (auth required; reachable even when flag is off, so the nav can hide itself)
  - `GET /api/community/spaces` → `[{key, label, mentor_only, unread}]`
  - `GET /api/community/threads?space=&limit=&offset=` → `{"threads": [...]}`
  - `GET /api/community/threads/{id}` → thread dict incl. `posts`
  - `GET /api/community/unread` → `{"total": n, "by_space": {...}}`
  - Dependency `require_community(user=Depends(get_current_user_with_plan))` — 503 when flag off, 402 when not paid/admin (admins always pass via `is_paid_user`)
  - Module constants `MAX_BODY_BYTES = 50_000`, `THREADS_PER_HOUR`, `POSTS_PER_HOUR` (used by Task 5)

- [ ] **Step 1: Write the failing tests**

```python
# tests/api/test_community_router.py
import pytest
from httpx import AsyncClient, ASGITransport


MEMBER = {"id": "u-member", "email": "m@x.com", "display_name": "Mem",
          "role": "member", "plan": "pro", "email_verified": True}
ADMIN = {"id": "u-admin", "email": "a@x.com", "display_name": "Adm",
         "role": "admin", "plan": "free", "email_verified": True}
FREE = {"id": "u-free", "email": "f@x.com", "display_name": "Fre",
        "role": "member", "plan": "free", "email_verified": True}


@pytest.fixture
def client_for(monkeypatch, tmp_path):
    """Factory: authed ASGI client with the community flag ON and a temp DB."""
    monkeypatch.setenv("COMMUNITY_DB_PATH", str(tmp_path / "community.db"))
    monkeypatch.setenv("COMMUNITY_ENABLED", "1")
    from api.services import community_store
    community_store._init_db()
    from api.main import app
    # Self-contained until Task 7 registers the router in main.py (no-op after).
    from api.routers import community as community_router
    if not any(getattr(r, "path", "").startswith("/api/community")
               for r in app.router.routes):
        app.include_router(community_router.router)
    from api.middleware.auth_middleware import get_current_user, get_current_user_with_plan

    def make(user):
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_current_user_with_plan] = lambda: user
        return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")

    yield make
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_status_reports_enabled_and_role(client_for):
    async with client_for(ADMIN) as ac:
        r = await ac.get("/api/community/status")
    assert r.status_code == 200
    body = r.json()
    assert body["enabled"] is True and body["is_mentor"] is True


@pytest.mark.asyncio
async def test_flag_off_returns_503(client_for, monkeypatch):
    monkeypatch.setenv("COMMUNITY_ENABLED", "0")
    async with client_for(MEMBER) as ac:
        assert (await ac.get("/api/community/spaces")).status_code == 503
        r = await ac.get("/api/community/status")
        assert r.status_code == 200 and r.json()["enabled"] is False


@pytest.mark.asyncio
async def test_free_plan_gets_402(client_for):
    async with client_for(FREE) as ac:
        assert (await ac.get("/api/community/spaces")).status_code == 402


@pytest.mark.asyncio
async def test_spaces_and_threads_read(client_for):
    from api.services import community_store
    tid = community_store.create_thread("trade-ideas", "u-member", "AMD flag", body="{}")
    async with client_for(MEMBER) as ac:
        spaces = (await ac.get("/api/community/spaces")).json()
        assert {s["key"] for s in spaces} == {"mentor-desk", "trade-ideas",
                                              "questions", "wins-lessons"}
        threads = (await ac.get("/api/community/threads",
                                params={"space": "trade-ideas"})).json()["threads"]
        assert threads[0]["id"] == tid
        detail = (await ac.get(f"/api/community/threads/{tid}")).json()
        assert detail["title"] == "AMD flag" and detail["posts"] == []
        assert (await ac.get("/api/community/threads/999999")).status_code == 404
        assert (await ac.get("/api/community/threads",
                             params={"space": "nope"})).status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_community_router.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.routers.community'`

- [ ] **Step 3: Write the router (read side)**

```python
# api/routers/community.py
"""The Floor — community forum API.

Spec: docs/superpowers/specs/2026-07-09-community-space-design.md
"""
import json
import os

from fastapi import APIRouter, Depends, HTTPException, Query

from api.middleware.auth_middleware import (
    get_current_user,
    get_current_user_with_plan,
    is_paid_user,
    require_admin,
)
from api.services import community_store as store

router = APIRouter(prefix="/api/community", tags=["community"])

MAX_BODY_BYTES = 50_000
THREADS_PER_HOUR = int(os.environ.get("COMMUNITY_THREADS_PER_HOUR", "5"))
POSTS_PER_HOUR = int(os.environ.get("COMMUNITY_POSTS_PER_HOUR", "30"))


def _enabled() -> bool:
    return os.environ.get("COMMUNITY_ENABLED", "0") == "1"


def require_community(user: dict = Depends(get_current_user_with_plan)) -> dict:
    if not _enabled():
        raise HTTPException(status_code=503, detail="Community is not enabled")
    if not is_paid_user(user):
        raise HTTPException(status_code=402, detail="The Floor requires a paid plan")
    return user


def _is_mentor(user: dict) -> bool:
    return user.get("role") == "admin"


@router.get("/status")
def status(user: dict = Depends(get_current_user)):
    enabled = _enabled()
    return {
        "enabled": enabled,
        "acked": store.has_ack(user["id"]) if enabled else False,
        "is_mentor": _is_mentor(user),
        "muted": store.is_muted(user["id"]) if enabled else False,
    }


@router.get("/spaces")
def spaces(user: dict = Depends(require_community)):
    unread = store.unread_summary(user["id"])["by_space"]
    return [
        {"key": k, "label": v["label"], "mentor_only": v["mentor_only"],
         "unread": unread.get(k, 0)}
        for k, v in store.SPACES.items()
    ]


@router.get("/unread")
def unread(user: dict = Depends(require_community)):
    return store.unread_summary(user["id"])


@router.get("/threads")
def threads(space: str = Query(...), limit: int = Query(50, ge=1, le=100),
            offset: int = Query(0, ge=0),
            user: dict = Depends(require_community)):
    if space not in store.SPACES:
        raise HTTPException(status_code=400, detail="Unknown space")
    return {"threads": store.list_threads(space, limit=limit, offset=offset)}


@router.get("/threads/{thread_id}")
def thread_detail(thread_id: int, user: dict = Depends(require_community)):
    t = store.get_thread(thread_id)
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    return t
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_community_router.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add api/routers/community.py tests/api/test_community_router.py
git commit -m "feat(community): router read side — flag gate, status, spaces, threads"
```

---

### Task 5: Router — write endpoints + permission matrix

**Files:**
- Modify: `api/routers/community.py` (append)
- Test: `tests/api/test_community_router.py` (append)

**Interfaces:**
- Consumes: Tasks 1–4
- Produces:
  - `POST /api/community/ack` → `{"ok": true}`
  - `POST /api/community/threads` body `{space, title, body, ticker_tags?}` → `{"id": int}` — 403 no-ack (`detail="acknowledgment_required"`), 403 muted, 403 member posting to `mentor-desk`, 429 rate-limited, 400 bad body/title
  - `POST /api/community/threads/{id}/posts` body `{body, parent_post_id?}` → `{"id": int}` — same gates + 409 locked + 400 bad-parent
  - `POST /api/community/posts/{id}/reactions` body `{kind}` → `{"on": bool}`
  - `POST /api/community/threads/{id}/read` body `{last_seen_post_id}` → `{"ok": true}`
  - `POST /api/community/reports` body `{thread_id? | post_id?, reason}` → `{"id": int}`
  - `DELETE /api/community/threads/{id}` / `DELETE /api/community/posts/{id}` — author or admin, soft-delete
  - `PATCH /api/community/threads/{id}/mod` body `{pinned?|locked?|answered?}` (require_admin)
  - `PATCH /api/community/posts/{id}/highlight` body `{value: bool}` (require_admin)
  - `GET /api/community/admin/reports?status=` (require_admin) → `{"reports": [...]}`
  - `PATCH /api/community/admin/reports/{id}` body `{action: "hide"|"dismiss"}` (require_admin) — `hide` also soft-deletes the reported target
  - `POST /api/community/admin/mute/{user_id}` body `{muted: bool}` (require_admin)

- [ ] **Step 1: Write the failing tests (append to `tests/api/test_community_router.py`)**

```python
VALID_BODY = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"hi"}]}]}'


async def _ack(ac):
    assert (await ac.post("/api/community/ack")).status_code == 200


@pytest.mark.asyncio
async def test_thread_write_requires_ack(client_for):
    async with client_for(MEMBER) as ac:
        r = await ac.post("/api/community/threads",
                          json={"space": "trade-ideas", "title": "t", "body": VALID_BODY})
        assert r.status_code == 403 and r.json()["detail"] == "acknowledgment_required"
        await _ack(ac)
        r = await ac.post("/api/community/threads",
                          json={"space": "trade-ideas", "title": "t", "body": VALID_BODY})
        assert r.status_code == 200 and r.json()["id"] > 0


@pytest.mark.asyncio
async def test_member_cannot_post_thread_in_mentor_desk(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/threads",
                          json={"space": "mentor-desk", "title": "t", "body": VALID_BODY})
        assert r.status_code == 403
    async with client_for(ADMIN) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/threads",
                          json={"space": "mentor-desk", "title": "lesson", "body": VALID_BODY})
        assert r.status_code == 200


@pytest.mark.asyncio
async def test_muted_member_cannot_write(client_for):
    from api.services import community_store
    community_store.set_ack(MEMBER["id"])
    community_store.set_muted(MEMBER["id"], True)
    async with client_for(MEMBER) as ac:
        r = await ac.post("/api/community/threads",
                          json={"space": "trade-ideas", "title": "t", "body": VALID_BODY})
        assert r.status_code == 403


@pytest.mark.asyncio
async def test_thread_rate_limit_429(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        for _ in range(5):
            r = await ac.post("/api/community/threads",
                              json={"space": "trade-ideas", "title": "t", "body": VALID_BODY})
            assert r.status_code == 200
        r = await ac.post("/api/community/threads",
                          json={"space": "trade-ideas", "title": "t", "body": VALID_BODY})
        assert r.status_code == 429


@pytest.mark.asyncio
async def test_reply_locked_and_bad_parent(client_for):
    from api.services import community_store
    community_store.set_ack(MEMBER["id"])
    tid = community_store.create_thread("questions", "u-x", "q", body=VALID_BODY)
    async with client_for(MEMBER) as ac:
        p1 = (await ac.post(f"/api/community/threads/{tid}/posts",
                            json={"body": VALID_BODY})).json()["id"]
        p2 = (await ac.post(f"/api/community/threads/{tid}/posts",
                            json={"body": VALID_BODY, "parent_post_id": p1})).json()["id"]
        r = await ac.post(f"/api/community/threads/{tid}/posts",
                          json={"body": VALID_BODY, "parent_post_id": p2})
        assert r.status_code == 400
        community_store.set_thread_flag(tid, "locked", 1)
        r = await ac.post(f"/api/community/threads/{tid}/posts", json={"body": VALID_BODY})
        assert r.status_code == 409


@pytest.mark.asyncio
async def test_mod_actions_admin_only(client_for):
    from api.services import community_store
    tid = community_store.create_thread("questions", "u-x", "q", body=VALID_BODY)
    async with client_for(MEMBER) as ac:
        assert (await ac.patch(f"/api/community/threads/{tid}/mod",
                               json={"pinned": True})).status_code == 403
    async with client_for(ADMIN) as ac:
        assert (await ac.patch(f"/api/community/threads/{tid}/mod",
                               json={"pinned": True, "answered": True})).status_code == 200
    assert community_store.get_thread(tid)["pinned"] == 1


@pytest.mark.asyncio
async def test_delete_own_content_only(client_for):
    from api.services import community_store
    community_store.set_ack(MEMBER["id"])
    tid = community_store.create_thread("questions", "other-user", "q", body=VALID_BODY)
    async with client_for(MEMBER) as ac:
        assert (await ac.delete(f"/api/community/threads/{tid}")).status_code == 403
    async with client_for(ADMIN) as ac:
        assert (await ac.delete(f"/api/community/threads/{tid}")).status_code == 200
    assert community_store.get_thread(tid) is None


@pytest.mark.asyncio
async def test_report_hide_flow(client_for):
    from api.services import community_store
    tid = community_store.create_thread("questions", "u-x", "bad", body=VALID_BODY)
    async with client_for(MEMBER) as ac:
        rid = (await ac.post("/api/community/reports",
                             json={"thread_id": tid, "reason": "spam"})).json()["id"]
    async with client_for(ADMIN) as ac:
        reports = (await ac.get("/api/community/admin/reports")).json()["reports"]
        assert reports[0]["id"] == rid
        assert (await ac.patch(f"/api/community/admin/reports/{rid}",
                               json={"action": "hide"})).status_code == 200
    assert community_store.get_thread(tid) is None          # soft-deleted
    assert community_store.list_reports("hidden")[0]["id"] == rid


@pytest.mark.asyncio
async def test_invalid_body_json_400(client_for):
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/threads",
                          json={"space": "trade-ideas", "title": "t", "body": "not json{"})
        assert r.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_community_router.py -v`
Expected: new tests FAIL with 404/405 (endpoints missing)

- [ ] **Step 3: Append write endpoints to `api/routers/community.py`**

```python
from pydantic import BaseModel


class ThreadIn(BaseModel):
    space: str
    title: str
    body: str = ""
    ticker_tags: list[str] | None = None


class PostIn(BaseModel):
    body: str
    parent_post_id: int | None = None


class ReactionIn(BaseModel):
    kind: str


class ReadIn(BaseModel):
    last_seen_post_id: int


class ReportIn(BaseModel):
    thread_id: int | None = None
    post_id: int | None = None
    reason: str = ""


class ModIn(BaseModel):
    pinned: bool | None = None
    locked: bool | None = None
    answered: bool | None = None


class HighlightIn(BaseModel):
    value: bool


class ReportActionIn(BaseModel):
    action: str  # hide | dismiss


class MuteIn(BaseModel):
    muted: bool


def _validate_body(body: str) -> str:
    body = body or ""
    if len(body.encode("utf-8", "ignore")) > MAX_BODY_BYTES:
        raise HTTPException(status_code=400, detail="Body too large")
    if body:
        try:
            doc = json.loads(body)
            if not isinstance(doc, dict):
                raise ValueError
        except ValueError:
            raise HTTPException(status_code=400, detail="Body must be TipTap JSON")
    return body


def _writer(user: dict) -> dict:
    """Gates shared by every write: disclaimer ack + not muted."""
    if not store.has_ack(user["id"]):
        raise HTTPException(status_code=403, detail="acknowledgment_required")
    if store.is_muted(user["id"]):
        raise HTTPException(status_code=403, detail="You are muted")
    return user


@router.post("/ack")
def ack(user: dict = Depends(require_community)):
    store.set_ack(user["id"])
    return {"ok": True}


@router.post("/threads")
def create_thread(body: ThreadIn, user: dict = Depends(require_community)):
    _writer(user)
    if body.space not in store.SPACES:
        raise HTTPException(status_code=400, detail="Unknown space")
    if store.SPACES[body.space]["mentor_only"] and not _is_mentor(user):
        raise HTTPException(status_code=403, detail="Mentor Desk threads are mentor-only")
    title = (body.title or "").strip()
    if not title or len(title) > 200:
        raise HTTPException(status_code=400, detail="Title required (max 200 chars)")
    if not _is_mentor(user) and store.count_recent_threads(user["id"]) >= THREADS_PER_HOUR:
        raise HTTPException(status_code=429, detail="Thread rate limit — try again later")
    tid = store.create_thread(
        body.space, user["id"], title, body=_validate_body(body.body),
        ticker_tags=[t.upper()[:8] for t in (body.ticker_tags or [])][:10])
    return {"id": tid}


@router.post("/threads/{thread_id}/posts")
def create_post(thread_id: int, body: PostIn, user: dict = Depends(require_community)):
    _writer(user)
    if not _is_mentor(user) and store.count_recent_posts(user["id"]) >= POSTS_PER_HOUR:
        raise HTTPException(status_code=429, detail="Post rate limit — try again later")
    try:
        pid = store.create_post(thread_id, user["id"], _validate_body(body.body),
                                parent_post_id=body.parent_post_id)
    except ValueError as e:
        code = {"no-thread": 404, "locked": 409, "bad-parent": 400}.get(str(e), 400)
        raise HTTPException(status_code=code, detail=str(e))
    return {"id": pid}


@router.post("/posts/{post_id}/reactions")
def react(post_id: int, body: ReactionIn, user: dict = Depends(require_community)):
    if not store.get_post(post_id):
        raise HTTPException(status_code=404, detail="Post not found")
    try:
        on = store.toggle_reaction(post_id, user["id"], body.kind)
    except ValueError:
        raise HTTPException(status_code=400, detail="Unknown reaction")
    return {"on": on}


@router.post("/threads/{thread_id}/read")
def mark_read(thread_id: int, body: ReadIn, user: dict = Depends(require_community)):
    store.mark_read(user["id"], thread_id, body.last_seen_post_id)
    return {"ok": True}


@router.post("/reports")
def report(body: ReportIn, user: dict = Depends(require_community)):
    try:
        rid = store.create_report(user["id"], body.reason,
                                  thread_id=body.thread_id, post_id=body.post_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Report needs exactly one target")
    return {"id": rid}


@router.delete("/threads/{thread_id}")
def delete_thread(thread_id: int, user: dict = Depends(require_community)):
    t = store.get_thread(thread_id)
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    if t["author_id"] != user["id"] and not _is_mentor(user):
        raise HTTPException(status_code=403, detail="Not your thread")
    store.soft_delete_thread(thread_id)
    return {"ok": True}


@router.delete("/posts/{post_id}")
def delete_post(post_id: int, user: dict = Depends(require_community)):
    p = store.get_post(post_id)
    if not p:
        raise HTTPException(status_code=404, detail="Post not found")
    if p["author_id"] != user["id"] and not _is_mentor(user):
        raise HTTPException(status_code=403, detail="Not your post")
    store.soft_delete_post(post_id)
    return {"ok": True}


# ── Mentor / moderator ───────────────────────────────────────────────────────

@router.patch("/threads/{thread_id}/mod")
def mod_thread(thread_id: int, body: ModIn, admin: dict = Depends(require_admin)):
    if not store.get_thread(thread_id):
        raise HTTPException(status_code=404, detail="Thread not found")
    for field in ("pinned", "locked", "answered"):
        value = getattr(body, field)
        if value is not None:
            store.set_thread_flag(thread_id, field, value)
    return {"ok": True}


@router.patch("/posts/{post_id}/highlight")
def highlight(post_id: int, body: HighlightIn, admin: dict = Depends(require_admin)):
    if not store.get_post(post_id):
        raise HTTPException(status_code=404, detail="Post not found")
    store.set_highlight(post_id, body.value)
    return {"ok": True}


@router.get("/admin/reports")
def admin_reports(status: str = Query("open"), admin: dict = Depends(require_admin)):
    return {"reports": store.list_reports(status)}


@router.patch("/admin/reports/{report_id}")
def admin_report_action(report_id: int, body: ReportActionIn,
                        admin: dict = Depends(require_admin)):
    reports = {r["id"]: r for r in store.list_reports("open")}
    r = reports.get(report_id)
    if not r:
        raise HTTPException(status_code=404, detail="Open report not found")
    if body.action == "hide":
        if r["thread_id"]:
            store.soft_delete_thread(r["thread_id"])
        elif r["post_id"]:
            store.soft_delete_post(r["post_id"])
        store.set_report_status(report_id, "hidden")
    elif body.action == "dismiss":
        store.set_report_status(report_id, "dismissed")
    else:
        raise HTTPException(status_code=400, detail="action must be hide|dismiss")
    return {"ok": True}


@router.post("/admin/mute/{user_id}")
def admin_mute(user_id: str, body: MuteIn, admin: dict = Depends(require_admin)):
    store.set_muted(user_id, body.muted)
    return {"ok": True}
```

Note on `require_admin`: it depends on `get_current_user`, which the test fixture overrides — so ADMIN/MEMBER personas flow through it correctly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_community_router.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add api/routers/community.py tests/api/test_community_router.py
git commit -m "feat(community): write endpoints — threads/posts/reactions/reports + mentor mod tools"
```

---

### Task 6: Image upload endpoint (chart screenshots)

**Files:**
- Modify: `api/routers/community.py` (append)
- Test: `tests/api/test_community_router.py` (append)

**Interfaces:**
- Consumes: Tasks 4–5 (`require_community`, `_writer`); Pillow (already a dependency — avatar + journal screenshots use it)
- Produces:
  - `POST /api/community/images` (multipart `file`) → `{"url": "/api/community/images/{user_id}/{name}.webp", "width": int, "height": int}` — 400 non-image/oversize
  - `GET /api/community/images/{user_id}/{name}` → `FileResponse` (auth: `require_community`)
  - `_UPLOAD_DIR` resolves `/data/community_uploads` (env `COMMUNITY_UPLOAD_DIR` override for tests)

- [ ] **Step 1: Write the failing test (append)**

```python
@pytest.mark.asyncio
async def test_image_upload_roundtrip(client_for, monkeypatch, tmp_path):
    monkeypatch.setenv("COMMUNITY_UPLOAD_DIR", str(tmp_path / "uploads"))
    from PIL import Image
    import io
    buf = io.BytesIO()
    Image.new("RGB", (900, 500), (20, 20, 20)).save(buf, format="PNG")
    async with client_for(MEMBER) as ac:
        await _ack(ac)
        r = await ac.post("/api/community/images",
                          files={"file": ("chart.png", buf.getvalue(), "image/png")})
        assert r.status_code == 200
        url = r.json()["url"]
        assert url.startswith("/api/community/images/") and url.endswith(".webp")
        r2 = await ac.get(url)
        assert r2.status_code == 200
        # non-image rejected
        r3 = await ac.post("/api/community/images",
                           files={"file": ("x.txt", b"hello", "text/plain")})
        assert r3.status_code == 400
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/api/test_community_router.py::test_image_upload_roundtrip -v`
Expected: FAIL 404

- [ ] **Step 3: Append the implementation**

```python
import io
import re
import uuid as _uuid

from fastapi import File, UploadFile
from fastapi.responses import FileResponse

_ALLOWED_IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
_MAX_IMAGE_BYTES = 5 * 1024 * 1024
_MAX_DIM = 1920
_SAFE_NAME = re.compile(r"^[a-f0-9]{32}\.webp$")


def _upload_dir() -> str:
    d = os.environ.get("COMMUNITY_UPLOAD_DIR")
    if d:
        return d
    if os.path.isdir("/data"):
        return "/data/community_uploads"
    return os.path.join(os.path.dirname(__file__), "..", "..", "data", "community_uploads")


@router.post("/images")
async def upload_image(file: UploadFile = File(...),
                       user: dict = Depends(require_community)):
    _writer(user)
    if file.content_type not in _ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Images only (png/jpg/webp/gif)")
    raw = await file.read()
    if not raw or len(raw) > _MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Image must be 1 byte – 5 MB")
    from PIL import Image
    try:
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read image")
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGB")
    img.thumbnail((_MAX_DIM, _MAX_DIM), Image.LANCZOS)
    name = f"{_uuid.uuid4().hex}.webp"
    user_dir = os.path.join(_upload_dir(), user["id"])
    os.makedirs(user_dir, exist_ok=True)
    img.save(os.path.join(user_dir, name), format="WEBP", quality=85)
    return {"url": f"/api/community/images/{user['id']}/{name}",
            "width": img.width, "height": img.height}


@router.get("/images/{owner_id}/{name}")
def serve_image(owner_id: str, name: str, user: dict = Depends(require_community)):
    if not _SAFE_NAME.match(name) or "/" in owner_id or ".." in owner_id:
        raise HTTPException(status_code=404, detail="Not found")
    path = os.path.join(_upload_dir(), owner_id, name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(path, media_type="image/webp",
                        headers={"Cache-Control": "public, max-age=31536000, immutable"})
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_community_router.py -v`
Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add api/routers/community.py tests/api/test_community_router.py
git commit -m "feat(community): chart-screenshot upload — Pillow→WebP on /data volume"
```

---

### Task 7: Wire router + DB init into `api/main.py`

**Files:**
- Modify: `api/main.py` — two anchors:
  1. Router imports block (near `from api.routers import journal_two as journal_two_router`, ~line 39–109)
  2. `app.include_router(...)` block (starts ~line 3056; put it next to `app.include_router(journal_two_router.router)` ~line 3085)
  3. Lifespan startup: next to the other `_init_db()` calls (e.g. where `desk_session_jobs._init_db()` runs)

**Interfaces:**
- Consumes: `api/routers/community.py` router; `community_store._init_db`
- Produces: `/api/community/*` mounted on the production app

- [ ] **Step 1: Add the import**

In the router-imports block of `api/main.py`:

```python
from api.routers import community as community_router
```

- [ ] **Step 2: Register the router**

In the `include_router` block, next to `app.include_router(journal_two_router.router)`:

```python
app.include_router(community_router.router)
```

- [ ] **Step 3: Init the DB in lifespan**

In the lifespan startup section, next to `desk_session_jobs._init_db()`:

```python
    try:
        from api.services import community_store
        community_store._init_db()
        log.info("community store ready")
    except Exception as e:
        log.exception(f"community store init failed: {e}")
```

(The router works flag-off regardless — `_init_db` is cheap and idempotent, so init unconditionally like the other stores.)

- [ ] **Step 4: Verify — full router tests against the real app + invariant grep**

Run: `python -m pytest tests/api/test_community_router.py tests/api/test_community_store.py -v`
Expected: all pass (the fixture's include_router guard is now a no-op).

Run: `grep -c broker_sync api/main.py`
Expected: ≥ 7 (LOCKED invariant).

Run: `python -c "from api.main import app; print([r.path for r in app.router.routes if r.path.startswith('/api/community')][:3])"`
Expected: prints community routes.

- [ ] **Step 5: Commit**

```bash
git add api/main.py
git commit -m "feat(community): mount /api/community router + init community.db at startup"
```

---

### Task 8: Desk seeding — `community_seed.py`, three hooks, backfill script

**Files:**
- Create: `api/services/community_seed.py`
- Create: `scripts/backfill_community_desk_threads.py`
- Modify: `api/services/desk_daily_session.py` (the `if created_now:` branch, ~line 279–280)
- Modify: `api/services/desk_session_insights.py` (after `set_video_insights` in `_run_one_pending` ~line 766, and in `repolish_video` ~line 890)
- Modify: `api/routers/education.py` (`add_video`, line 183–192)
- Test: `tests/api/test_community_seed.py`

**Interfaces:**
- Consumes: `community_store` (Tasks 1–3), `api.services.education_service` (`get_video`, `get_video_by_youtube_id`, `get_insights`)
- Produces:
  - `upsert_desk_thread(video_id: int) -> int | None` — creates or updates the Mentor Desk thread for an education video; idempotent by `desk_content_id == video_id`; returns thread id; never raises (returns None on failure)
  - `seed_for_youtube_id(youtube_id: str) -> int | None`
  - `_tiptap_doc(headline, bullets, youtube_id) -> str` (TipTap JSON string)

- [ ] **Step 1: Write the failing tests**

```python
# tests/api/test_community_seed.py
import json

import pytest


@pytest.fixture
def store(monkeypatch, tmp_path):
    monkeypatch.setenv("COMMUNITY_DB_PATH", str(tmp_path / "community.db"))
    from api.services import community_store
    community_store._init_db()
    return community_store


VIDEO = {"id": 42, "youtube_id": "abcdefghijk", "title": "Live Trading — Jul 9, 2026",
         "category": "Live Trading Sessions"}
INSIGHTS = {"headline": "NVDA breakout walkthrough",
            "summary": ["Opened with breadth read", "NVDA entry at prev-day high"],
            "chapters": [], "ticker_moments": [], "has_transcript": True,
            "has_poster": True}


@pytest.fixture
def seed(monkeypatch, store):
    from api.services import community_seed, education_service
    monkeypatch.setattr(education_service, "get_video", lambda vid: dict(VIDEO))
    monkeypatch.setattr(education_service, "get_video_by_youtube_id",
                        lambda yt: dict(VIDEO) if yt == VIDEO["youtube_id"] else None)
    monkeypatch.setattr(education_service, "get_insights", lambda vid: dict(INSIGHTS))
    return community_seed


def test_seed_creates_mentor_desk_thread(seed, store):
    tid = seed.upsert_desk_thread(42)
    t = store.get_thread(tid)
    assert t["space"] == "mentor-desk"
    assert t["author_id"] is None                 # renders as "UCT Mentor"
    assert t["desk_content_id"] == 42
    assert t["title"] == "Live Trading — Jul 9, 2026"
    body = json.loads(t["body"])
    text = json.dumps(body)
    assert "NVDA breakout walkthrough" in text
    assert "Opened with breadth read" in text


def test_seed_is_idempotent_and_updates(seed, store, monkeypatch):
    t1 = seed.upsert_desk_thread(42)
    from api.services import education_service
    updated = dict(INSIGHTS, headline="REPOLISHED headline")
    monkeypatch.setattr(education_service, "get_insights", lambda vid: updated)
    t2 = seed.upsert_desk_thread(42)
    assert t1 == t2                               # same thread, no duplicate
    assert len(store.list_threads("mentor-desk")) == 1
    assert "REPOLISHED headline" in store.get_thread(t1)["body"]


def test_seed_never_raises(seed, monkeypatch):
    from api.services import education_service
    monkeypatch.setattr(education_service, "get_video",
                        lambda vid: (_ for _ in ()).throw(RuntimeError("boom")))
    assert seed.upsert_desk_thread(42) is None


def test_seed_for_youtube_id(seed, store):
    assert seed.seed_for_youtube_id("abcdefghijk") is not None
    assert seed.seed_for_youtube_id("nope-nope-np") is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_community_seed.py -v`
Expected: FAIL — `ModuleNotFoundError: api.services.community_seed`

- [ ] **Step 3: Write `api/services/community_seed.py`**

```python
# api/services/community_seed.py
"""Desk → Community bridge: publish/insights hooks upsert a Mentor Desk thread
per education video. Idempotent by threads.desk_content_id == edu_videos.id.
Best-effort by design — a seeding failure must NEVER break a Desk publish."""
import json

from api.services import community_store


def _tiptap_doc(headline, bullets, youtube_id):
    content = []
    if headline:
        content.append({"type": "paragraph", "content": [
            {"type": "text", "marks": [{"type": "bold"}], "text": str(headline)}]})
    if bullets:
        content.append({"type": "bulletList", "content": [
            {"type": "listItem", "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": str(b)}]}]}
            for b in bullets if str(b).strip()]})
    if youtube_id:
        content.append({"type": "paragraph", "content": [
            {"type": "text",
             "marks": [{"type": "link", "attrs":
                        {"href": f"https://www.youtube.com/watch?v={youtube_id}"}}],
             "text": "Watch the session"}]})
    if not content:
        content = [{"type": "paragraph", "content": [
            {"type": "text", "text": "Recap coming soon — discuss below."}]}]
    return json.dumps({"type": "doc", "content": content})


def upsert_desk_thread(video_id):
    """Create or refresh the Mentor Desk thread for an education video.
    Returns thread id, or None on any failure (never raises)."""
    try:
        from api.services import education_service
        video = education_service.get_video(int(video_id))
        if not video:
            return None
        try:
            ins = education_service.get_insights(int(video_id)) or {}
        except Exception:
            ins = {}
        body = _tiptap_doc(ins.get("headline"), ins.get("summary") or [],
                           video.get("youtube_id"))
        existing = community_store.get_thread_by_desk_id(int(video_id))
        if existing:
            community_store.update_thread(existing["id"],
                                          title=video.get("title") or existing["title"],
                                          body=body)
            return existing["id"]
        return community_store.create_thread(
            "mentor-desk", None, video.get("title") or "Desk Session",
            body=body, desk_content_id=int(video_id))
    except Exception as e:
        print(f"[community-seed] upsert failed for video {video_id} (non-fatal): {e}")
        return None


def seed_for_youtube_id(youtube_id):
    try:
        from api.services import education_service
        row = education_service.get_video_by_youtube_id(youtube_id)
        if not row:
            return None
        return upsert_desk_thread(row["id"])
    except Exception as e:
        print(f"[community-seed] seed_for_youtube_id failed (non-fatal): {e}")
        return None
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/api/test_community_seed.py -v`
Expected: all pass

- [ ] **Step 5: Hook 1 — publish path (`api/services/desk_daily_session.py`)**

Find (lines ~279–280):

```python
            if created_now:                 # alert once, only on a genuinely-new publish
                _notify_published(title, vid, section)
```

Replace with:

```python
            if created_now:                 # alert once, only on a genuinely-new publish
                _notify_published(title, vid, section)
                try:  # seed the community Mentor Desk thread — NEVER fail publish over it
                    from api.services import community_seed
                    community_seed.seed_for_youtube_id(vid)
                except Exception as ce:
                    print(f"[desk-sessions] community seed failed (non-fatal): {ce}")
```

- [ ] **Step 6: Hook 2 — insights + repolish (`api/services/desk_session_insights.py`)**

(a) In `_run_one_pending`, immediately AFTER the `education_service.set_video_insights(...)` call (~line 766), add:

```python
        try:  # refresh the community thread body with the polished recap (non-fatal)
            from api.services import community_seed
            community_seed.upsert_desk_thread(vid_id)
        except Exception as ce:
            print(f"[desk-insights] community seed refresh failed (non-fatal): {ce}")
```

Use the same video-id variable that `set_video_insights` receives in that scope (read the surrounding code — it is the education row id, not the youtube id).

(b) In `repolish_video(video_id)`, immediately after its `set_video_insights(...)` call, add the identical block with `video_id`.

- [ ] **Step 7: Hook 3 — manual/admin video creation (`api/routers/education.py`)**

`add_video` (line 183) currently ends with `return svc.create_video(payload)`. Replace that line with:

```python
    created = svc.create_video(payload)
    try:  # seed a community discussion thread for the new video (non-fatal)
        from api.services import community_seed
        community_seed.upsert_desk_thread(created["id"])
    except Exception as ce:
        print(f"[education] community seed failed (non-fatal): {ce}")
    return created
```

Check `svc.create_video`'s return shape first: if it returns a row dict use `created["id"]`; if it returns a bare id, use it directly. Adjust accordingly.

- [ ] **Step 8: Backfill script**

```python
# scripts/backfill_community_desk_threads.py
"""One-shot: seed Mentor Desk threads for recent Desk session videos.

Run ON THE RAILWAY WEB POD (the DBs live on its /data volume):
  railway ssh --service web -- /opt/venv/bin/python scripts/backfill_community_desk_threads.py --days 14
(Plain `python3` on the pod is Nix system python without app deps — always /opt/venv/bin/python.)
"""
import argparse
import sys
import time

sys.path.insert(0, ".")

from api.services import community_seed, community_store, education_service


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    community_store._init_db()
    cutoff = int(time.time()) - args.days * 86400
    videos = [v for v in education_service.get_all_videos()
              if (v.get("created_at") or 0) >= cutoff and v.get("meeting_uuid")]
    print(f"{len(videos)} session videos in the last {args.days} days")
    for v in videos:
        if args.dry_run:
            print(f"would seed: [{v['id']}] {v['title']}")
            continue
        tid = community_seed.upsert_desk_thread(v["id"])
        print(f"seeded: [{v['id']}] {v['title']} -> thread {tid}")


if __name__ == "__main__":
    main()
```

Note: check `education_service` for the actual list-all function name (`get_all_videos` / `list_videos` / `get_videos`) and use that one; it must return rows including `id`, `title`, `created_at`, `meeting_uuid`.

- [ ] **Step 9: Run the full backend suite**

Run: `python -m pytest tests/api/test_community_store.py tests/api/test_community_router.py tests/api/test_community_seed.py -v`
Expected: all pass

- [ ] **Step 10: Commit**

```bash
git add api/services/community_seed.py api/services/desk_daily_session.py api/services/desk_session_insights.py api/routers/education.py scripts/backfill_community_desk_threads.py tests/api/test_community_seed.py
git commit -m "feat(community): Desk auto-seeding — publish/insights/manual hooks + backfill script"
```

---

### Task 9: Author enrichment + Desk-thread lookup + Desk "Discussion" link

**Files:**
- Modify: `api/routers/community.py`
- Modify: `app/src/pages/desk/VideosSection.jsx` (video card, ~line 252 where `playVideo(cat.videos, vi)` is wired)
- Test: `tests/api/test_community_router.py` (append)

**Interfaces:**
- Consumes: Tasks 4–5; `api.services.auth_db.get_connection` (users table: `id, display_name, email, role`)
- Produces:
  - Every thread returned by `GET /threads` and `GET /threads/{id}` — and every post inside — gains `"author": {"name": str, "is_mentor": bool}`. `author_id IS NULL` → `{"name": "UCT Mentor", "is_mentor": true}`. Avatars come from the existing public `GET /api/auth/avatar/{user_id}` (frontend uses `author_id` directly).
  - `GET /api/community/desk-threads?ids=1,2,3` → `{"41": {"thread_id": 7, "reply_count": 3}, ...}` (string keys; videos without a thread omitted). Auth: `require_community`.

- [ ] **Step 1: Write the failing tests (append)**

```python
@pytest.mark.asyncio
async def test_threads_carry_author_names(client_for, monkeypatch):
    from api.services import community_store
    # seeded thread (author_id NULL) + a member thread
    seeded = community_store.create_thread("mentor-desk", None, "Session", body="{}",
                                           desk_content_id=41)
    async with client_for(MEMBER) as ac:
        rows = (await ac.get("/api/community/threads",
                             params={"space": "mentor-desk"})).json()["threads"]
    assert rows[0]["author"] == {"name": "UCT Mentor", "is_mentor": True}


@pytest.mark.asyncio
async def test_desk_threads_batch(client_for):
    from api.services import community_store
    tid = community_store.create_thread("mentor-desk", None, "Session", body="{}",
                                        desk_content_id=41)
    community_store.create_post(tid, "u-z", "{}")
    async with client_for(MEMBER) as ac:
        r = await ac.get("/api/community/desk-threads", params={"ids": "41,42"})
    body = r.json()
    assert body["41"]["thread_id"] == tid and body["41"]["reply_count"] == 1
    assert "42" not in body
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/api/test_community_router.py -k "author or desk_threads" -v`
Expected: FAIL (no `author` key; 404 on /desk-threads)

- [ ] **Step 3: Add enrichment + batch endpoint to `api/routers/community.py`**

```python
from contextlib import closing as _closing

_MENTOR_AUTHOR = {"name": "UCT Mentor", "is_mentor": True}


def _author_map(ids):
    ids = sorted({i for i in ids if i})
    if not ids:
        return {}
    try:
        from api.services.auth_db import get_connection as _auth_conn
        q = ",".join("?" * len(ids))
        with _closing(_auth_conn()) as conn:
            rows = conn.execute(
                f"SELECT id, display_name, email, role FROM users WHERE id IN ({q})",
                ids).fetchall()
        return {r["id"]: {"name": r["display_name"]
                                  or (r["email"] or "member").split("@")[0],
                          "is_mentor": r["role"] == "admin"}
                for r in rows}
    except Exception:
        return {}


def _attach_authors(items):
    amap = _author_map([i.get("author_id") for i in items])
    for i in items:
        aid = i.get("author_id")
        i["author"] = dict(_MENTOR_AUTHOR) if aid is None else \
            amap.get(aid, {"name": "member", "is_mentor": False})
    return items
```

Then modify the two read endpoints from Task 4:

```python
# in threads():
    return {"threads": _attach_authors(store.list_threads(space, limit=limit, offset=offset))}

# in thread_detail():
    t = store.get_thread(thread_id)
    if not t:
        raise HTTPException(status_code=404, detail="Thread not found")
    _attach_authors([t])
    _attach_authors(t["posts"])
    return t
```

And add the batch endpoint:

```python
@router.get("/desk-threads")
def desk_threads(ids: str = Query(""), user: dict = Depends(require_community)):
    out = {}
    for raw in ids.split(",")[:100]:
        raw = raw.strip()
        if not raw.isdigit():
            continue
        t = store.get_thread_by_desk_id(int(raw))
        if not t or t.get("deleted"):
            continue
        detail = store.list_threads(t["space"], limit=1000)
        match = next((x for x in detail if x["id"] == t["id"]), None)
        out[raw] = {"thread_id": t["id"],
                    "reply_count": match["reply_count"] if match else 0}
    return out
```

(If that per-id lookup reads clumsy, an equivalent single SQL in `community_store` is fine — `get_desk_thread_summaries(ids) -> dict` with one query; keep the router thin either way.)

- [ ] **Step 4: Run backend tests**

Run: `python -m pytest tests/api/test_community_router.py -v`
Expected: all pass

- [ ] **Step 5: Desk card link (`app/src/pages/desk/VideosSection.jsx`)**

At the top of the component, add the batch hook (SWR is already imported in this file — if not, import `useSWR` and the module's fetcher pattern):

```jsx
const allVideoIds = useMemo(
  () => (categories || []).flatMap((c) => c.videos.map((v) => v.id)).filter(Boolean),
  [categories],
)
const { data: deskThreads } = useSWR(
  allVideoIds.length ? `/api/community/desk-threads?ids=${allVideoIds.join(',')}` : null,
  (url) => fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null)),
)
```

(Use this file's real variable holding the grouped categories — read the component first; adjust `categories`/`c.videos` names to match.)

On each video card, next to the duration/meta line, render:

```jsx
{deskThreads?.[String(v.id)] && (
  <Link
    to={`/community/${deskThreads[String(v.id)].thread_id}`}
    className={styles.discussLink}
    onClick={(e) => e.stopPropagation()}
  >
    Discussion ({deskThreads[String(v.id)].reply_count})
  </Link>
)}
```

Add to `EducationalVideos.module.css`:

```css
.discussLink {
  font-size: 11px;
  color: var(--ut-gold);
  text-decoration: none;
  letter-spacing: 0.4px;
}
.discussLink:hover { text-decoration: underline; }
```

Note: when the community flag is off the batch endpoint 503s → `deskThreads` is null → no links render. That is the desired dark behavior; no extra gating needed.

- [ ] **Step 6: Commit**

```bash
git add api/routers/community.py tests/api/test_community_router.py app/src/pages/desk/VideosSection.jsx app/src/pages/desk/EducationalVideos.module.css
git commit -m "feat(community): author enrichment, desk-thread batch lookup, Desk discussion links"
```

---

### Task 10: Frontend scaffold — route, nav, page shell, thread list

**Files:**
- Create: `app/src/pages/community/CommunityPage.jsx`
- Create: `app/src/pages/community/Community.module.css`
- Create: `app/src/pages/community/hooks/useCommunity.js`
- Modify: `app/src/App.jsx` (lazy import ~lines 17–63; route inside the `<Route element={<Layout />}>` nesting ~line 170)
- Modify: `app/src/components/NavBar.jsx` (NAV_ITEMS ~line 28; badge pattern ~lines 42–52, 102–107)
- Modify: `app/src/components/MobileNav.jsx` (`ROUTE_TITLES`, lines 17–37)
- Modify: `app/src/components/mobile/MoreSheet.jsx` (Trading section items, ~line 47)
- Modify: `app/src/components/ui/UIcon.jsx` (ICONS registry — add `community` glyph)
- Modify: `app/vite.config.js` (manualChunks object, lines 17–23)
- Test: `app/src/pages/community/CommunityPage.test.jsx`

**Interfaces:**
- Consumes: `/api/community/status|spaces|threads` (Tasks 4, 9)
- Produces:
  - Route `/community` and `/community/:threadId` → `CommunityPage`
  - `useCommunity.js` exports: `fetcher`, `apiCall(url, body?, method?)` (JSON or FormData; throws Error with `.status` and server `detail`), `useCommunityStatus()`, `useSpaces(enabled)`, `useThreads(space, enabled)`, `useThread(threadId)`
  - CSS classes used by later tasks: `.page`, `.rail`, `.railItem`, `.railItemActive`, `.railBadge`, `.main`, `.threadRow`, `.threadTitle`, `.mentorBadge`, `.pinIcon`, `.answeredTick`, `.tickerChip`, `.meta`

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/community/CommunityPage.test.jsx
import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'
import CommunityPage from './CommunityPage'

vi.mock('swr', () => ({
  default: (key) => {
    if (typeof key === 'string' && key.includes('/status'))
      return { data: { enabled: true, acked: true, is_mentor: false, muted: false } }
    if (typeof key === 'string' && key.includes('/spaces'))
      return { data: [
        { key: 'mentor-desk', label: 'Mentor Desk', mentor_only: true, unread: 2 },
        { key: 'trade-ideas', label: 'Trade Ideas', mentor_only: false, unread: 0 },
        { key: 'questions', label: 'Questions & Reviews', mentor_only: false, unread: 0 },
        { key: 'wins-lessons', label: 'Wins & Lessons', mentor_only: false, unread: 0 },
      ] }
    if (typeof key === 'string' && key.includes('/threads?'))
      return { data: { threads: [{ id: 1, title: 'July 9 Session', pinned: 1,
        answered: 0, ticker_tags: ['NVDA'], reply_count: 3,
        last_activity_at: 1780000000, author: { name: 'UCT Mentor', is_mentor: true },
        author_id: null }] } }
    return { data: null }
  },
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

test('renders spaces rail and thread list', () => {
  renderWithProviders(<CommunityPage />, { route: '/community' })
  expect(screen.getByText('Mentor Desk')).toBeTruthy()
  expect(screen.getByText('Trade Ideas')).toBeTruthy()
  expect(screen.getByText('July 9 Session')).toBeTruthy()
  expect(screen.getByText('UCT Mentor')).toBeTruthy()
})

test('renders coming-soon when disabled', () => {
  // second render uses same mock; simulate by rendering with a status override:
  // simplest: assert the enabled path above; the disabled branch is covered by
  // the component's `if (!status?.enabled)` early return — keep one smoke assert:
  expect(true).toBe(true)
})
```

(Drop the placeholder second test if it adds noise — the first test is the gate.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/community`
Expected: FAIL — cannot resolve `./CommunityPage`

- [ ] **Step 3: Create `hooks/useCommunity.js`**

```js
// app/src/pages/community/hooks/useCommunity.js
import useSWR from 'swr'

export const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) {
      const e = new Error(String(r.status))
      e.status = r.status
      throw e
    }
    return r.json()
  })

export async function apiCall(url, body, method = 'POST') {
  const isForm = body instanceof FormData
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: isForm || body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = new Error(data.detail || String(res.status))
    e.status = res.status
    throw e
  }
  return data
}

export const useCommunityStatus = () => useSWR('/api/community/status', fetcher)

export const useSpaces = (enabled) =>
  useSWR(enabled ? '/api/community/spaces' : null, fetcher, { refreshInterval: 30_000 })

export const useThreads = (space, enabled) =>
  useSWR(enabled && space ? `/api/community/threads?space=${space}` : null, fetcher,
         { refreshInterval: 30_000 })

export const useThread = (threadId) =>
  useSWR(threadId ? `/api/community/threads/${threadId}` : null, fetcher,
         { refreshInterval: 20_000 })
```

- [ ] **Step 4: Create `CommunityPage.jsx` (shell + rail + thread list)**

```jsx
// app/src/pages/community/CommunityPage.jsx
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import UIcon from '../../components/ui/UIcon'
import { useCommunityStatus, useSpaces, useThreads } from './hooks/useCommunity'
import styles from './Community.module.css'

function timeAgo(epoch) {
  if (!epoch) return ''
  const s = Math.max(1, Math.floor(Date.now() / 1000 - epoch))
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}

export default function CommunityPage() {
  const navigate = useNavigate()
  const { threadId } = useParams()
  const { data: status } = useCommunityStatus()
  const enabled = !!status?.enabled
  const [space, setSpace] = useState('mentor-desk')
  const { data: spaces } = useSpaces(enabled)
  const { data: threadsData } = useThreads(space, enabled && !threadId)

  if (status && !enabled) {
    return (
      <div className={styles.comingSoon}>
        <UIcon name="community" size={40} />
        <h2 className="t-page-title">The Floor</h2>
        <p className="t-body">The UCT community space is opening soon.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <aside className={styles.rail}>
        <div className={styles.railTitle}>
          <UIcon name="community" size={16} /> The Floor
        </div>
        {(spaces || []).map((s) => (
          <button
            key={s.key}
            className={`${styles.railItem} ${space === s.key && !threadId ? styles.railItemActive : ''}`}
            onClick={() => { setSpace(s.key); navigate('/community') }}
          >
            <span>{s.label}</span>
            {s.unread > 0 && <span className={styles.railBadge}>{s.unread > 9 ? '9+' : s.unread}</span>}
          </button>
        ))}
      </aside>
      <main className={styles.main}>
        {threadId ? (
          <ThreadViewMount threadId={threadId} />
        ) : (
          <ThreadList
            threads={threadsData?.threads || []}
            onOpen={(id) => navigate(`/community/${id}`)}
          />
        )}
      </main>
    </div>
  )
}

function ThreadList({ threads, onOpen }) {
  if (!threads.length) {
    return <div className={styles.empty}>No threads here yet.</div>
  }
  return (
    <div className={styles.threadList}>
      {threads.map((t) => (
        <button key={t.id} className={styles.threadRow} onClick={() => onOpen(t.id)}>
          <div className={styles.threadTitleRow}>
            {!!t.pinned && <span className={styles.pinIcon}><UIcon name="pin" size={13} /></span>}
            <span className={styles.threadTitle}>{t.title}</span>
            {!!t.answered && <span className={styles.answeredTick}>Answered</span>}
          </div>
          <div className={styles.meta}>
            <span className={t.author?.is_mentor ? styles.mentorBadge : ''}>
              {t.author?.name || 'member'}
            </span>
            {(t.ticker_tags || []).map((tk) => (
              <span key={tk} className={styles.tickerChip}>${tk}</span>
            ))}
            <span>{t.reply_count} repl{t.reply_count === 1 ? 'y' : 'ies'}</span>
            <span>{timeAgo(t.last_activity_at)}</span>
          </div>
        </button>
      ))}
    </div>
  )
}

// Placeholder until Task 11 lands ThreadView; keeps this task shippable alone.
function ThreadViewMount({ threadId }) {
  let ThreadView = null
  try {
    // eslint-disable-next-line global-require
    ThreadView = require('./ThreadView').default
  } catch {
    /* Task 11 adds it */
  }
  if (!ThreadView) return <div className={styles.empty}>Thread {threadId}</div>
  return <ThreadView threadId={threadId} />
}
```

Simplification allowed: if the `require()` shim fights Vite, just render `<div>` in Task 10 and replace `ThreadViewMount` with a direct `import ThreadView from './ThreadView'` in Task 11.

- [ ] **Step 5: Create `Community.module.css`**

```css
/* app/src/pages/community/Community.module.css */
.page { display: flex; height: 100%; overflow: hidden; background: var(--bg); }

.rail {
  width: 240px; min-width: 200px; flex-shrink: 0;
  display: flex; flex-direction: column; gap: 2px;
  border-right: 1px solid var(--border); background: var(--bg-surface);
  padding: 14px 8px; overflow-y: auto;
}
.railTitle {
  display: flex; align-items: center; gap: 8px;
  color: var(--ut-gold); text-transform: uppercase; letter-spacing: 1px;
  font-size: 12px; font-weight: 600; padding: 4px 10px 12px;
}
.railItem {
  display: flex; justify-content: space-between; align-items: center;
  padding: 9px 10px; border: none; border-radius: 6px; background: none;
  color: var(--text); font-size: 13px; cursor: pointer; text-align: left;
  min-height: var(--tap-min);
}
.railItem:hover { background: var(--bg-hover); }
.railItemActive { background: rgba(201, 168, 76, 0.08); border-left: 2px solid var(--ut-gold); color: var(--text-heading); }
.railBadge {
  background: var(--ut-gold); color: #14150f; border-radius: 9px;
  font-size: 10px; font-weight: 700; padding: 1px 6px;
}

.main { flex: 1; min-width: 0; overflow-y: auto; padding: 16px 20px; }

.threadList { display: flex; flex-direction: column; gap: 6px; max-width: 860px; }
.threadRow {
  display: block; width: 100%; text-align: left; cursor: pointer;
  background: var(--bg-surface); border: 1px solid var(--border);
  border-radius: 8px; padding: 12px 14px;
}
.threadRow:hover { border-color: var(--ut-gold-glow); background: var(--bg-elevated); }
.threadTitleRow { display: flex; align-items: center; gap: 8px; }
.threadTitle { color: var(--text-heading); font-size: 14px; font-weight: 600; }
.pinIcon { color: var(--ut-gold); display: inline-flex; }
.answeredTick {
  color: var(--ut-green); font-size: 10px; letter-spacing: 0.6px;
  text-transform: uppercase; border: 1px solid var(--ut-green);
  border-radius: 4px; padding: 1px 6px;
}
.meta { display: flex; align-items: center; gap: 10px; margin-top: 6px; color: var(--text); font-size: 11.5px; }
.mentorBadge { color: var(--ut-gold); font-weight: 600; }
.tickerChip { color: var(--ut-gold); background: var(--ut-gold-dim); border-radius: 4px; padding: 0 5px; font-size: 11px; }

.empty { color: var(--text); padding: 40px; text-align: center; }
.comingSoon {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px; color: var(--text);
}

@media (max-width: 1024px) {
  .page { flex-direction: column; }
  .rail {
    width: 100%; min-width: 0; flex-direction: row; overflow-x: auto;
    border-right: none; border-bottom: 1px solid var(--border); padding: 8px;
  }
  .railTitle { display: none; }
  .railItem { flex-shrink: 0; }
}
```

- [ ] **Step 6: Register route, nav, icon, chunks**

(a) `app/src/App.jsx` — with the other lazy declarations:

```jsx
const Community = lazy(() => import('./pages/community/CommunityPage'))
```

Inside the `<Route element={<Layout />}>` nesting (next to `/journal`):

```jsx
<Route path="/community" element={<Community />} />
<Route path="/community/:threadId" element={<Community />} />
```

(b) `app/src/components/ui/UIcon.jsx` — add to the ICONS registry (same shape as the `journal` glyph at line 100):

```jsx
  community: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 19c.6-3.2 2.9-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="16.5" cy="9.5" r="2.4" />
      <path d="M15.2 14.3c2.6.2 4.6 1.8 5.2 4.7" />
    </>
  ),
```

(c) `app/src/components/NavBar.jsx` — add to `NAV_ITEMS` (do NOT add `/community` to `FREE_PAGES`):

```jsx
  { to: '/community', label: 'Community', icon: 'community' },
```

Below the existing `pending` SWR block (lines 42–52), add:

```jsx
const { data: communityStatus } = useSWR(user ? '/api/community/status' : null, fetcher, {
  refreshInterval: 120_000,
})
const { data: communityUnread } = useSWR(
  communityStatus?.enabled && isPaid ? '/api/community/unread' : null,
  fetcher,
  { refreshInterval: 30_000 },
)
const floorUnread = communityUnread?.total || 0
```

In the item render loop, before rendering each item add the dark-launch gate:

```jsx
if (item.to === '/community' && !communityStatus?.enabled) return null
```

And next to the existing compass badge JSX (lines 102–107), add:

```jsx
{item.to === '/community' && floorUnread > 0 && (
  <span className={styles.compassBadge} title={`${floorUnread} unread`}>
    {floorUnread > 9 ? '9+' : floorUnread}
  </span>
)}
```

(d) `app/src/components/MobileNav.jsx` — add to `ROUTE_TITLES`:

```jsx
  '/community': 'Community',
```

(e) `app/src/components/mobile/MoreSheet.jsx` — in the `Trading` section items (line ~47):

```jsx
      { to: '/community', label: 'Community', icon: 'community' },
```

MoreSheet already fetches the compass badge; add the same status gate there — fetch `/api/community/status` with the NavBar pattern and filter the item out when `!communityStatus?.enabled` (mirror however the component maps `items`; a `.filter()` before render is fine).

(f) `app/vite.config.js` — add to the manualChunks OBJECT (never function form):

```js
        'vendor-tiptap': [
          '@tiptap/react', '@tiptap/starter-kit', '@tiptap/core',
          '@tiptap/extension-image', '@tiptap/extension-link',
          '@tiptap/extension-placeholder', '@tiptap/suggestion',
        ],
```

- [ ] **Step 7: Run tests + build**

Run: `cd app && npx vitest run src/pages/community && npm run build`
Expected: tests pass; build succeeds with a `vendor-tiptap` chunk in output.

- [ ] **Step 8: Commit**

```bash
git add app/src/pages/community app/src/App.jsx app/src/components/NavBar.jsx app/src/components/MobileNav.jsx app/src/components/mobile/MoreSheet.jsx app/src/components/ui/UIcon.jsx app/vite.config.js
git commit -m "feat(community): /community page shell — rail, thread list, nav integration (dark-gated)"
```

---

### Task 11: Thread view — posts, replies, reactions, read marking

**Files:**
- Create: `app/src/pages/community/ThreadView.jsx`
- Create: `app/src/pages/community/lib/tiptapExtensions.js`
- Create: `app/src/pages/community/lib/renderBody.js`
- Modify: `app/src/pages/community/CommunityPage.jsx` (replace `ThreadViewMount` with direct import)
- Modify: `app/src/pages/community/Community.module.css` (append)
- Test: `app/src/pages/community/ThreadView.test.jsx`

**Interfaces:**
- Consumes: `useThread`, `apiCall` (Task 10); `GET/POST` endpoints (Tasks 4–5, 9)
- Produces:
  - `<ThreadView threadId />` — renders OP body, one-level nested replies, reaction buttons, marks thread read on load
  - `buildCommunityExtensions(placeholder?) -> Extension[]` — StarterKit(h2/h3) + Image + Link(https) + Placeholder (shared with the composer in Task 12)
  - `renderBodyHTML(bodyJsonString) -> string` — sanitized HTML (drops non-https link hrefs and non-community image srcs); returns `''` on parse failure

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/community/ThreadView.test.jsx
import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'

const THREAD = {
  id: 1, title: 'July 9 Session', space: 'mentor-desk', author_id: null,
  author: { name: 'UCT Mentor', is_mentor: true }, locked: 0, answered: 0, pinned: 1,
  ticker_tags: [], created_at: 1780000000, last_activity_at: 1780000000,
  body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph',
    content: [{ type: 'text', text: 'Recap body text' }] }] }),
  posts: [
    { id: 11, author_id: 'u1', author: { name: 'Alice', is_mentor: false },
      parent_post_id: null, mentor_highlight: 0, deleted: 0, created_at: 1780000100,
      reactions: { fire: 2 },
      body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph',
        content: [{ type: 'text', text: 'Great session' }] }] }) },
    { id: 12, author_id: 'u2', author: { name: 'Coach', is_mentor: true },
      parent_post_id: 11, mentor_highlight: 1, deleted: 0, created_at: 1780000200,
      reactions: {},
      body: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph',
        content: [{ type: 'text', text: 'Watch the 10am reclaim' }] }] }) },
  ],
}

vi.mock('swr', () => ({
  default: (key) => {
    if (typeof key === 'string' && key.includes('/threads/1')) return { data: THREAD, mutate: vi.fn() }
    if (typeof key === 'string' && key.includes('/status'))
      return { data: { enabled: true, acked: true, is_mentor: false, muted: false } }
    return { data: null, mutate: vi.fn() }
  },
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))

import ThreadView from './ThreadView'

test('renders OP, replies, highlight and reactions', () => {
  renderWithProviders(<ThreadView threadId="1" />, { route: '/community/1' })
  expect(screen.getByText('July 9 Session')).toBeTruthy()
  expect(screen.getByText('Recap body text')).toBeTruthy()
  expect(screen.getByText('Great session')).toBeTruthy()
  expect(screen.getByText('Watch the 10am reclaim')).toBeTruthy()
  expect(screen.getAllByText('UCT Mentor').length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/community/ThreadView`
Expected: FAIL — cannot resolve `./ThreadView`

- [ ] **Step 3: Create the shared extensions + renderer**

```js
// app/src/pages/community/lib/tiptapExtensions.js
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'

export function buildCommunityExtensions(placeholder = 'Share your thinking…') {
  return [
    StarterKit.configure({ heading: { levels: [2, 3] } }),
    Image.configure({ inline: false, allowBase64: false }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      protocols: ['https'],
      HTMLAttributes: { rel: 'noreferrer', target: '_blank' },
    }),
    Placeholder.configure({ placeholder }),
  ]
}
```

```js
// app/src/pages/community/lib/renderBody.js
import { generateHTML } from '@tiptap/core'
import { buildCommunityExtensions } from './tiptapExtensions'

const EXTENSIONS = buildCommunityExtensions()

// Defense-in-depth vs stored XSS: bodies are user-supplied JSON POSTed to the
// API, so a crafted doc could carry javascript: hrefs or foreign image srcs.
// Whitelist link/image destinations before generating HTML.
function sanitizeNode(node) {
  if (!node || typeof node !== 'object') return node
  if (Array.isArray(node.marks)) {
    node.marks = node.marks.filter((m) => {
      if (m?.type !== 'link') return true
      const href = m?.attrs?.href || ''
      return href.startsWith('https://')
    })
  }
  if (node.type === 'image') {
    const src = node?.attrs?.src || ''
    if (!src.startsWith('/api/community/images/') && !src.startsWith('https://')) return null
  }
  if (Array.isArray(node.content)) {
    node.content = node.content.map(sanitizeNode).filter(Boolean)
  }
  return node
}

export function renderBodyHTML(bodyJson) {
  if (!bodyJson) return ''
  try {
    const doc = sanitizeNode(JSON.parse(bodyJson))
    if (!doc || doc.type !== 'doc') return ''
    return generateHTML(doc, EXTENSIONS)
  } catch {
    return ''
  }
}
```

- [ ] **Step 4: Create `ThreadView.jsx`**

```jsx
// app/src/pages/community/ThreadView.jsx
import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import UIcon from '../../components/ui/UIcon'
import { useThread, apiCall } from './hooks/useCommunity'
import { renderBodyHTML } from './lib/renderBody'
import styles from './Community.module.css'

const REACTIONS = [
  { kind: 'fire', icon: 'flame', label: 'Fire' },
  { kind: 'bullish', icon: 'trendUp', label: 'Bullish' },
  { kind: 'salute', icon: 'star', label: 'Respect' },
]
// NOTE: check UIcon's registry for real glyph names close to flame/trendUp/star
// and use the nearest existing ones (or add small glyphs) — never emoji.

function Author({ author, authorId }) {
  return (
    <span className={styles.authorWrap}>
      {authorId && (
        <img
          className={styles.avatar}
          src={`/api/auth/avatar/${authorId}`}
          alt=""
          width={20}
          height={20}
        />
      )}
      <span className={author?.is_mentor ? styles.mentorBadge : styles.authorName}>
        {author?.name || 'member'}
        {author?.is_mentor && <span className={styles.mentorChip}>UCT MENTOR</span>}
      </span>
    </span>
  )
}

function Post({ post, replies, onReact, onReply }) {
  return (
    <div className={`${styles.post} ${post.author?.is_mentor ? styles.postMentor : ''} ${post.mentor_highlight ? styles.postHighlight : ''}`}>
      <div className={styles.postHead}>
        <Author author={post.author} authorId={post.author_id} />
        {!!post.mentor_highlight && <span className={styles.highlightTag}>Mentor take</span>}
      </div>
      {post.deleted ? (
        <div className={styles.deletedBody}>removed by moderator</div>
      ) : (
        <div
          className={styles.postBody}
          dangerouslySetInnerHTML={{ __html: renderBodyHTML(post.body) }}
        />
      )}
      <div className={styles.postActions}>
        {REACTIONS.map((r) => (
          <button key={r.kind} className={styles.reactBtn} title={r.label}
                  onClick={() => onReact(post.id, r.kind)}>
            <UIcon name={r.icon} size={14} />
            {post.reactions?.[r.kind] ? <span>{post.reactions[r.kind]}</span> : null}
          </button>
        ))}
        {!post.parent_post_id && (
          <button className={styles.replyBtn} onClick={() => onReply(post.id)}>Reply</button>
        )}
      </div>
      {replies.length > 0 && (
        <div className={styles.replies}>
          {replies.map((r) => (
            <Post key={r.id} post={r} replies={[]} onReact={onReact} onReply={onReply} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function ThreadView({ threadId }) {
  const { data: thread, mutate } = useThread(threadId)

  // mark read once loaded
  useEffect(() => {
    if (!thread?.id) return
    const lastId = thread.posts.length ? thread.posts[thread.posts.length - 1].id : 0
    apiCall(`/api/community/threads/${thread.id}/read`, { last_seen_post_id: lastId })
      .catch(() => {})
  }, [thread?.id, thread?.posts?.length])

  const { topLevel, byParent } = useMemo(() => {
    const posts = thread?.posts || []
    const top = posts.filter((p) => !p.parent_post_id)
    // highlighted mentor take floats to the front of top-level replies
    top.sort((a, b) => (b.mentor_highlight - a.mentor_highlight) || (a.id - b.id))
    const map = {}
    posts.filter((p) => p.parent_post_id).forEach((p) => {
      ;(map[p.parent_post_id] = map[p.parent_post_id] || []).push(p)
    })
    return { topLevel: top, byParent: map }
  }, [thread?.posts])

  if (!thread) return <div className={styles.empty}>Loading…</div>

  const onReact = async (postId, kind) => {
    try {
      await apiCall(`/api/community/posts/${postId}/reactions`, { kind })
      mutate()
    } catch { /* noop */ }
  }

  // onReply target is consumed by the Composer (Task 12); store in state there.
  const onReply = () => {}

  return (
    <div className={styles.threadView}>
      <Link to="/community" className={styles.backLink}>&larr; The Floor</Link>
      <div className={styles.opCard}>
        <h2 className={styles.opTitle}>
          {!!thread.pinned && <span className={styles.pinIcon}><UIcon name="pin" size={14} /></span>}
          {thread.title}
          {!!thread.answered && <span className={styles.answeredTick}>Answered</span>}
        </h2>
        <div className={styles.postHead}>
          <Author author={thread.author} authorId={thread.author_id} />
          {(thread.ticker_tags || []).map((tk) => (
            <span key={tk} className={styles.tickerChip}>${tk}</span>
          ))}
        </div>
        <div className={styles.postBody}
             dangerouslySetInnerHTML={{ __html: renderBodyHTML(thread.body) }} />
      </div>
      <div className={styles.postsList}>
        {topLevel.map((p) => (
          <Post key={p.id} post={p} replies={byParent[p.id] || []}
                onReact={onReact} onReply={onReply} />
        ))}
      </div>
      {!!thread.locked && <div className={styles.lockedNote}>This thread is locked.</div>}
    </div>
  )
}
```

In `CommunityPage.jsx`, delete the `ThreadViewMount` shim and use `import ThreadView from './ThreadView'` + `<ThreadView threadId={threadId} />` directly.

- [ ] **Step 5: Append thread-view styles to `Community.module.css`**

```css
.threadView { max-width: 860px; }
.backLink { color: var(--text); font-size: 12px; text-decoration: none; }
.backLink:hover { color: var(--ut-gold); }
.opCard {
  background: var(--bg-surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 16px 18px; margin: 12px 0 18px;
}
.opTitle { display: flex; align-items: center; gap: 8px; color: var(--text-heading); font-size: 18px; margin: 0 0 10px; }
.postsList { display: flex; flex-direction: column; gap: 10px; }
.post { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
.postMentor { border-left: 2px solid var(--ut-gold); }
.postHighlight { background: rgba(201, 168, 76, 0.06); border-color: var(--ut-gold-glow); }
.highlightTag { color: var(--ut-gold); font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; }
.postHead { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.authorWrap { display: inline-flex; align-items: center; gap: 6px; }
.avatar { border-radius: 50%; }
.authorName { color: var(--text-heading); font-size: 12.5px; }
.mentorChip {
  margin-left: 6px; color: var(--ut-gold); border: 1px solid var(--ut-gold);
  border-radius: 4px; padding: 0 4px; font-size: 9px; letter-spacing: 0.8px;
}
.postBody { color: var(--text); font-size: 13.5px; line-height: 1.6; }
.postBody img { max-width: 100%; border-radius: 6px; }
.deletedBody { color: var(--text); font-style: italic; opacity: 0.6; font-size: 12.5px; }
.postActions { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.reactBtn, .replyBtn {
  display: inline-flex; align-items: center; gap: 4px;
  background: none; border: 1px solid var(--border); border-radius: 6px;
  color: var(--text); font-size: 11.5px; padding: 3px 8px; cursor: pointer;
  min-height: 28px;
}
.reactBtn:hover, .replyBtn:hover { border-color: var(--ut-gold-glow); color: var(--text-heading); }
.replies { margin: 10px 0 0 22px; display: flex; flex-direction: column; gap: 8px; }
.lockedNote { color: var(--text); font-size: 12px; margin-top: 14px; font-style: italic; }
```

- [ ] **Step 6: Run tests**

Run: `cd app && npx vitest run src/pages/community`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/community
git commit -m "feat(community): thread view — replies, mentor highlight, reactions, read marking"
```

---

### Task 12: Composer — TipTap, image paste, $TICKER chips, new-thread + reply

**Files:**
- Create: `app/src/pages/community/lib/tickerMention.js`
- Create: `app/src/pages/community/Composer.jsx`
- Modify: `app/src/pages/community/lib/tiptapExtensions.js` (add TickerMention to the shared list so `renderBodyHTML` can render chips)
- Modify: `app/src/pages/community/CommunityPage.jsx` (New Thread modal)
- Modify: `app/src/pages/community/ThreadView.jsx` (reply composer + `onReply` state)
- Modify: `app/src/pages/community/Community.module.css` (append)
- Test: `app/src/pages/community/Composer.test.jsx`

**Interfaces:**
- Consumes: Tasks 10–11 (`apiCall`, `buildCommunityExtensions`); `GET /api/ticker-search?q=&limit=` (existing endpoint, returns `{results: [{ticker, name}]}`); `POST /api/community/images`
- Produces:
  - `TickerMention` — inline atom node `tickerChip` with attr `ticker`; typing `$NV` opens an autocomplete; picking inserts a gold chip. Rendered HTML: `<span data-ticker="NVDA" class="community-ticker-chip">$NVDA</span>`
  - `<Composer placeholder onSubmit(bodyJson, tickers) submitLabel busy />` — TipTap editor + image paste/drop upload + Post button; `extractTickers(docJson) -> string[]`
  - CommunityPage "New Thread" button (hidden in `mentor-desk` for non-mentors) → modal with title input + Composer → `POST /api/community/threads` → navigate to the new thread
  - ThreadView bottom composer → `POST /api/community/threads/{id}/posts` (with `parent_post_id` when replying; a "Replying to…" chip clears it)

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/community/Composer.test.jsx
import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'
import { extractTickers } from './lib/tickerMention'
import Composer from './Composer'

vi.mock('swr', () => ({
  default: () => ({ data: null }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

test('extractTickers pulls chip attrs out of a doc', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'watching ' },
    { type: 'tickerChip', attrs: { ticker: 'NVDA' } },
    { type: 'text', text: ' and ' },
    { type: 'tickerChip', attrs: { ticker: 'AMD' } },
  ] }] }
  expect(extractTickers(doc)).toEqual(['NVDA', 'AMD'])
})

test('composer renders editor and submit button', () => {
  renderWithProviders(<Composer onSubmit={vi.fn()} submitLabel="Post" />)
  expect(screen.getByText('Post')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/community/Composer`
Expected: FAIL — cannot resolve `./Composer`

- [ ] **Step 3: Create `lib/tickerMention.js`**

```js
// app/src/pages/community/lib/tickerMention.js
// $TICKER inline chip + $-triggered autocomplete (vanilla-DOM dropdown, no tippy).
import { Node, mergeAttributes } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'

export function extractTickers(doc) {
  const out = []
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'tickerChip' && node.attrs?.ticker) out.push(node.attrs.ticker)
    ;(node.content || []).forEach(walk)
  }
  walk(doc)
  return [...new Set(out)]
}

async function searchTickers(query) {
  if (!query) return []
  try {
    const r = await fetch(`/api/ticker-search?q=${encodeURIComponent(query)}&limit=8`,
                          { credentials: 'include' })
    if (!r.ok) return []
    const body = await r.json()
    return (body.results || []).slice(0, 8)
  } catch {
    return []
  }
}

function makeDropdown() {
  const el = document.createElement('div')
  el.className = 'community-ticker-dropdown'
  document.body.appendChild(el)
  return el
}

export const TickerMention = Node.create({
  name: 'tickerChip',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return { ticker: { default: '' } }
  },

  parseHTML() {
    return [{ tag: 'span[data-ticker]',
              getAttrs: (el) => ({ ticker: el.getAttribute('data-ticker') }) }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-ticker': node.attrs.ticker,
      class: 'community-ticker-chip',
    }), `$${node.attrs.ticker}`]
  },

  addProseMirrorPlugins() {
    let dropdown = null
    let items = []
    let selected = 0
    let currentProps = null

    const renderItems = () => {
      if (!dropdown) return
      dropdown.innerHTML = ''
      items.forEach((it, i) => {
        const row = document.createElement('button')
        row.type = 'button'
        row.className = `community-ticker-row${i === selected ? ' is-active' : ''}`
        row.innerHTML = `<strong>$${it.ticker}</strong><span>${it.name || ''}</span>`
        row.onmousedown = (e) => { e.preventDefault(); pick(i) }
        dropdown.appendChild(row)
      })
      dropdown.style.display = items.length ? 'block' : 'none'
    }

    const pick = (i) => {
      const it = items[i]
      if (!it || !currentProps) return
      currentProps.command({ ticker: it.ticker })
    }

    return [
      Suggestion({
        editor: this.editor,
        char: '$',
        allowSpaces: false,
        command: ({ editor, range, props }) => {
          editor.chain().focus().insertContentAt(range, [
            { type: 'tickerChip', attrs: { ticker: props.ticker } },
            { type: 'text', text: ' ' },
          ]).run()
        },
        items: ({ query }) => searchTickers((query || '').toUpperCase()),
        render: () => ({
          onStart: (props) => {
            currentProps = props
            dropdown = makeDropdown()
            items = props.items || []
            selected = 0
            const rect = props.clientRect?.()
            if (rect) {
              dropdown.style.left = `${rect.left}px`
              dropdown.style.top = `${rect.bottom + 4}px`
            }
            renderItems()
          },
          onUpdate: (props) => {
            currentProps = props
            items = props.items || []
            selected = Math.min(selected, Math.max(0, items.length - 1))
            const rect = props.clientRect?.()
            if (rect && dropdown) {
              dropdown.style.left = `${rect.left}px`
              dropdown.style.top = `${rect.bottom + 4}px`
            }
            renderItems()
          },
          onKeyDown: ({ event }) => {
            if (!items.length) return false
            if (event.key === 'ArrowDown') { selected = (selected + 1) % items.length; renderItems(); return true }
            if (event.key === 'ArrowUp') { selected = (selected - 1 + items.length) % items.length; renderItems(); return true }
            if (event.key === 'Enter') { pick(selected); return true }
            if (event.key === 'Escape') { dropdown?.remove(); dropdown = null; return true }
            return false
          },
          onExit: () => { dropdown?.remove(); dropdown = null; items = []; currentProps = null },
        }),
      }),
    ]
  },
})
```

Add the dropdown/chip styles GLOBALLY (the dropdown mounts on `document.body`, so a CSS module won't reach it). Append to `app/src/index.css`:

```css
/* Community $TICKER chips (global — TipTap renders outside CSS modules) */
.community-ticker-chip {
  color: var(--ut-gold);
  background: var(--ut-gold-dim);
  border-radius: 4px;
  padding: 0 4px;
  font-weight: 600;
}
.community-ticker-dropdown {
  position: fixed;
  z-index: var(--z-popover, 1000);
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  min-width: 220px;
  max-height: 260px;
  overflow-y: auto;
  display: none;
}
.community-ticker-row {
  display: flex; gap: 8px; align-items: baseline; width: 100%;
  padding: 8px 10px; background: none; border: none; cursor: pointer;
  color: var(--text); font-size: 12.5px; text-align: left;
}
.community-ticker-row strong { color: var(--ut-gold); }
.community-ticker-row.is-active, .community-ticker-row:hover { background: var(--bg-hover); }
```

- [ ] **Step 4: Add TickerMention to the shared extensions**

In `lib/tiptapExtensions.js`:

```js
import { TickerMention } from './tickerMention'
// ...inside buildCommunityExtensions() return array, add:
    TickerMention,
```

(`renderBodyHTML` now renders stored chips; its sanitizer passes them through untouched since chips carry no href/src.)

- [ ] **Step 5: Create `Composer.jsx`**

```jsx
// app/src/pages/community/Composer.jsx
import { useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { buildCommunityExtensions } from './lib/tiptapExtensions'
import { extractTickers } from './lib/tickerMention'
import { apiCall } from './hooks/useCommunity'
import styles from './Community.module.css'

async function uploadImage(file) {
  const fd = new FormData()
  fd.append('file', file)
  return apiCall('/api/community/images', fd)   // -> {url, width, height}
}

export default function Composer({ onSubmit, placeholder = 'Share your thinking…',
                                   submitLabel = 'Post', busy = false }) {
  const [error, setError] = useState(null)

  const editor = useEditor({
    extensions: buildCommunityExtensions(placeholder),
    editorProps: {
      handlePaste(view, event) {
        const items = event.clipboardData?.items
        if (!items) return false
        for (const item of items) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            event.preventDefault()
            const file = item.getAsFile()
            if (file)

              uploadImage(file)
                .then(({ url }) => editor?.chain().focus().setImage({ src: url, alt: '' }).run())
                .catch((e) => setError(e.message))
            return true
          }
        }
        return false
      },
      handleDrop(view, event) {
        const file = event.dataTransfer?.files?.[0]
        if (file && file.type.startsWith('image/')) {
          event.preventDefault()
          uploadImage(file)
            .then(({ url }) => editor?.chain().focus().setImage({ src: url, alt: '' }).run())
            .catch((e) => setError(e.message))
          return true
        }
        return false
      },
    },
  })

  const submit = async () => {
    if (!editor || busy) return
    const doc = editor.getJSON()
    const isEmpty = editor.isEmpty
    if (isEmpty) { setError('Write something first'); return }
    setError(null)
    try {
      await onSubmit(JSON.stringify(doc), extractTickers(doc))
      editor.commands.clearContent()
    } catch (e) {
      setError(e.message === 'acknowledgment_required'
        ? 'Accept the community guidelines first' : e.message)
    }
  }

  return (
    <div className={styles.composer}>
      <EditorContent editor={editor} className={styles.composerEditor} />
      <div className={styles.composerFoot}>
        {error && <span className={styles.composerError}>{error}</span>}
        <span className={styles.composerHint}>$ for tickers · paste charts directly</span>
        <button className={styles.composerSubmit} onClick={submit} disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
```

Note the direct `editor.getJSON()` at click time — reads are taken when the button fires, so the Notebook `onUpdate` stale-closure trap does not apply here (no autosave). If any autosave is ever added, use the latest-callback-ref pattern from `NoteEditorPage.jsx:38-44`.

- [ ] **Step 6: Wire New Thread into `CommunityPage.jsx`**

Add state + modal (inside the default export, alongside existing state):

```jsx
const [composing, setComposing] = useState(false)
const [title, setTitle] = useState('')
const [posting, setPosting] = useState(false)
const { mutate: refreshThreads } = useThreads(space, enabled && !threadId)
const canPost = spaces && !(spaces.find((s) => s.key === space)?.mentor_only) || status?.is_mentor
```

Toolbar above `ThreadList`:

```jsx
{canPost && (
  <button className={styles.newThreadBtn} onClick={() => setComposing(true)}>
    New Thread
  </button>
)}
{composing && (
  <div className={styles.newThreadCard}>
    <input
      className={styles.titleInput}
      placeholder="Title"
      maxLength={200}
      value={title}
      onChange={(e) => setTitle(e.target.value)}
    />
    <Composer
      submitLabel="Post Thread"
      busy={posting}
      onSubmit={async (body, tickers) => {
        setPosting(true)
        try {
          const { id } = await apiCall('/api/community/threads',
            { space, title, body, ticker_tags: tickers })
          setComposing(false); setTitle('')
          refreshThreads()
          navigate(`/community/${id}`)
        } finally {
          setPosting(false)
        }
      }}
    />
  </div>
)}
```

(Imports: `Composer`, `apiCall`.)

- [ ] **Step 7: Wire the reply composer into `ThreadView.jsx`**

Replace the no-op `onReply` with state, and render a Composer at the bottom when the thread is not locked:

```jsx
const [replyTo, setReplyTo] = useState(null)
const onReply = (postId) => setReplyTo(postId)
// ...bottom of the returned JSX, before lockedNote:
{!thread.locked && (
  <div className={styles.replyComposer}>
    {replyTo && (
      <div className={styles.replyingChip}>
        Replying to a comment
        <button onClick={() => setReplyTo(null)}>×</button>
      </div>
    )}
    <Composer
      placeholder="Reply…"
      submitLabel="Reply"
      onSubmit={async (body) => {
        await apiCall(`/api/community/threads/${thread.id}/posts`,
          { body, parent_post_id: replyTo })
        setReplyTo(null)
        mutate()
      }}
    />
  </div>
)}
```

- [ ] **Step 8: Append composer styles to `Community.module.css`**

```css
.composer { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; }
.composerEditor { min-height: 90px; padding: 10px 12px; font-size: 13.5px; color: var(--text); }
.composerEditor :global(.ProseMirror) { outline: none; min-height: 70px; }
.composerFoot {
  display: flex; align-items: center; gap: 10px; justify-content: flex-end;
  border-top: 1px solid var(--border); padding: 6px 10px;
}
.composerHint { color: var(--text); font-size: 10.5px; opacity: 0.7; margin-right: auto; }
.composerError { color: var(--ut-red); font-size: 11.5px; }
.composerSubmit {
  background: var(--ut-gold); color: #14150f; border: none; border-radius: 6px;
  font-weight: 700; font-size: 12.5px; padding: 6px 14px; cursor: pointer;
  min-height: 32px;
}
.composerSubmit:disabled { opacity: 0.5; cursor: default; }
.newThreadBtn {
  background: none; border: 1px solid var(--ut-gold); color: var(--ut-gold);
  border-radius: 6px; padding: 6px 14px; font-size: 12.5px; cursor: pointer;
  margin-bottom: 12px; min-height: 32px;
}
.newThreadCard { margin-bottom: 14px; display: flex; flex-direction: column; gap: 8px; }
.titleInput {
  background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px;
  color: var(--text-heading); font-size: 14px; padding: 10px 12px; outline: none;
}
.titleInput:focus { border-color: var(--ut-gold-glow); }
.replyComposer { margin-top: 16px; }
.replyingChip {
  display: inline-flex; gap: 8px; align-items: center; color: var(--ut-gold);
  font-size: 11.5px; margin-bottom: 6px;
}
.replyingChip button { background: none; border: none; color: var(--text); cursor: pointer; }
```

- [ ] **Step 9: Run tests + build**

Run: `cd app && npx vitest run src/pages/community && npm run build`
Expected: pass; build green.

- [ ] **Step 10: Commit**

```bash
git add app/src/pages/community app/src/index.css
git commit -m "feat(community): composer — TipTap, chart-image paste, \$TICKER autocomplete chips"
```

---

### Task 13: Ack gate, mentor tools UI, report flow

**Files:**
- Create: `app/src/pages/community/AckGate.jsx`
- Modify: `app/src/pages/community/CommunityPage.jsx` (mount AckGate)
- Modify: `app/src/pages/community/ThreadView.jsx` (mentor buttons + report + delete)
- Modify: `app/src/pages/community/Community.module.css` (append)
- Test: `app/src/pages/community/AckGate.test.jsx`

**Interfaces:**
- Consumes: `useCommunityStatus`, `apiCall`; endpoints from Task 5
- Produces: `<AckGate status onAcked />` overlay; mentor action row on ThreadView (`Pin/Unpin · Lock/Unlock · Mark Answered · Highlight` per post, `Remove` per item); `Report` button on every post + thread

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/pages/community/AckGate.test.jsx
import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'
import AckGate from './AckGate'

test('renders disclaimer and agree button when not acked', () => {
  renderWithProviders(
    <AckGate status={{ enabled: true, acked: false }} onAcked={vi.fn()} />,
  )
  expect(screen.getByText(/not financial advice/i)).toBeTruthy()
  expect(screen.getByText(/I understand/i)).toBeTruthy()
})

test('renders nothing when acked', () => {
  const { container } = renderWithProviders(
    <AckGate status={{ enabled: true, acked: true }} onAcked={vi.fn()} />,
  )
  expect(container.firstChild).toBeNull()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/community/AckGate`
Expected: FAIL — cannot resolve `./AckGate`

- [ ] **Step 3: Create `AckGate.jsx`**

```jsx
// app/src/pages/community/AckGate.jsx
import { useState } from 'react'
import { apiCall } from './hooks/useCommunity'
import styles from './Community.module.css'

// ⚠️ OWNER OPEN ITEM: this wording needs a pass from whoever reviewed the
// existing Terms/disclaimer page before the flag flips on.
const DISCLAIMER = `The Floor is a member community. Posts are the opinions of
individual members — nothing here is financial advice, a recommendation, or a
solicitation to buy or sell any security. Performance claims are unverified.
Do your own research and manage your own risk.`

export default function AckGate({ status, onAcked }) {
  const [busy, setBusy] = useState(false)
  if (!status || status.acked) return null
  const agree = async () => {
    setBusy(true)
    try {
      await apiCall('/api/community/ack')
      onAcked?.()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className={styles.ackBackdrop} role="dialog" aria-modal="true">
      <div className={styles.ackCard}>
        <h3 className="t-section-title">Welcome to The Floor</h3>
        <p className={styles.ackText}>{DISCLAIMER}</p>
        <p className={styles.ackText}>
          Be constructive. No spam, no promotion, no sharing other members&apos; info.
          Moderators may remove content that breaks the rules.
        </p>
        <button className={styles.composerSubmit} disabled={busy} onClick={agree}>
          I understand — this is not financial advice
        </button>
      </div>
    </div>
  )
}
```

Mount in `CommunityPage.jsx` (top of the enabled branch), refreshing status after ack:

```jsx
const { data: status, mutate: refreshStatus } = useCommunityStatus()
// ...inside the main return, first child of styles.page:
<AckGate status={status} onAcked={() => refreshStatus()} />
```

- [ ] **Step 4: Mentor tools + report + delete in `ThreadView.jsx`**

Pass `status` down (import `useCommunityStatus` in ThreadView). Add an actions row in the OP card:

```jsx
const { data: status } = useCommunityStatus()
const isMentor = !!status?.is_mentor

const mod = async (patch) => {
  await apiCall(`/api/community/threads/${thread.id}/mod`, patch, 'PATCH')
  mutate()
}
const reportItem = async (target) => {
  const reason = window.prompt('Why are you reporting this?') || ''
  if (!reason.trim()) return
  await apiCall('/api/community/reports', { ...target, reason })
  window.alert('Reported — a moderator will review it.')
}

// OP card actions row:
<div className={styles.postActions}>
  {isMentor && (
    <>
      <button className={styles.modBtn} onClick={() => mod({ pinned: !thread.pinned })}>
        {thread.pinned ? 'Unpin' : 'Pin'}
      </button>
      <button className={styles.modBtn} onClick={() => mod({ locked: !thread.locked })}>
        {thread.locked ? 'Unlock' : 'Lock'}
      </button>
      {thread.space === 'questions' && (
        <button className={styles.modBtn} onClick={() => mod({ answered: !thread.answered })}>
          {thread.answered ? 'Unmark Answered' : 'Mark Answered'}
        </button>
      )}
    </>
  )}
  <button className={styles.reportBtn} onClick={() => reportItem({ thread_id: thread.id })}>
    Report
  </button>
</div>
```

Per-post extras inside `Post` (pass `isMentor`, `onHighlight`, `onReport`, `onDelete`, `meId` as props from ThreadView):

```jsx
{isMentor && !post.parent_post_id && (
  <button className={styles.modBtn}
          onClick={() => onHighlight(post.id, !post.mentor_highlight)}>
    {post.mentor_highlight ? 'Unhighlight' : 'Highlight'}
  </button>
)}
<button className={styles.reportBtn} onClick={() => onReport({ post_id: post.id })}>Report</button>
{(isMentor || post.author_id === meId) && !post.deleted && (
  <button className={styles.reportBtn} onClick={() => onDelete(post.id)}>Remove</button>
)}
```

With handlers in ThreadView:

```jsx
const onHighlight = async (postId, value) => {
  await apiCall(`/api/community/posts/${postId}/highlight`, { value }, 'PATCH')
  mutate()
}
const onDelete = async (postId) => {
  if (!window.confirm('Remove this post?')) return
  await apiCall(`/api/community/posts/${postId}`, undefined, 'DELETE')
  mutate()
}
```

`meId`: get from `useAuth()` (`user?.id`) — import from `../../context/AuthContext`.

(`window.prompt/confirm` are deliberate v1 minimalism; upgrade to `Sheet` popovers in polish.)

- [ ] **Step 5: Append styles**

```css
.ackBackdrop {
  position: fixed; inset: 0; z-index: var(--z-modal, 1200);
  background: rgba(0, 0, 0, 0.72); display: flex; align-items: center; justify-content: center;
  padding: 20px;
}
.ackCard {
  max-width: 480px; background: var(--bg-elevated); border: 1px solid var(--ut-gold-glow);
  border-radius: 12px; padding: 22px 24px; display: flex; flex-direction: column; gap: 12px;
}
.ackText { color: var(--text); font-size: 12.5px; line-height: 1.65; margin: 0; }
.modBtn {
  background: none; border: 1px solid var(--ut-gold-glow); color: var(--ut-gold);
  border-radius: 6px; font-size: 11px; padding: 3px 8px; cursor: pointer; min-height: 28px;
}
.reportBtn {
  background: none; border: none; color: var(--text); opacity: 0.55;
  font-size: 11px; cursor: pointer; min-height: 28px;
}
.reportBtn:hover { opacity: 1; color: var(--ut-red); }
```

- [ ] **Step 6: Run tests**

Run: `cd app && npx vitest run src/pages/community`
Expected: all pass

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/community
git commit -m "feat(community): disclaimer ack gate, mentor mod tools, report + remove"
```

---

### Task 14: Admin — community reports queue on /admin

**Files:**
- Create: `app/src/components/admin/CommunityReportsPanel.jsx`
- Modify: `app/src/pages/Admin.jsx` — mount next to `TwitterAccountsPanel` (precedent: "slotted between Section 6b Admin Tools and Section 7 System Health")
- Test: `app/src/components/admin/CommunityReportsPanel.test.jsx`

**Interfaces:**
- Consumes: `GET /api/community/admin/reports`, `PATCH /api/community/admin/reports/{id}`, `POST /api/community/admin/mute/{user_id}` (Task 5)
- Produces: `<CommunityReportsPanel />` — renders nothing when the reports fetch 503s (flag off), so it is safe to mount before launch

- [ ] **Step 1: Write the failing test**

```jsx
// app/src/components/admin/CommunityReportsPanel.test.jsx
import { renderWithProviders, screen } from '../../test-utils'
import { vi } from 'vitest'

vi.mock('swr', () => ({
  default: () => ({ data: { reports: [
    { id: 1, thread_id: 5, post_id: null, reporter_id: 'u2', reason: 'spam',
      preview: 'BUY MY COURSE', target_author_id: 'u9', created_at: 1780000000 },
  ] }, mutate: vi.fn() }),
  useSWRConfig: () => ({ mutate: vi.fn() }),
}))

import CommunityReportsPanel from './CommunityReportsPanel'

test('renders open reports with actions', () => {
  renderWithProviders(<CommunityReportsPanel />)
  expect(screen.getByText(/BUY MY COURSE/)).toBeTruthy()
  expect(screen.getByText('Hide')).toBeTruthy()
  expect(screen.getByText('Dismiss')).toBeTruthy()
  expect(screen.getByText('Mute author')).toBeTruthy()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/components/admin/CommunityReportsPanel`
Expected: FAIL — cannot resolve

- [ ] **Step 3: Create the panel**

```jsx
// app/src/components/admin/CommunityReportsPanel.jsx
import useSWR from 'swr'
import { apiCall, fetcher } from '../../pages/community/hooks/useCommunity'

export default function CommunityReportsPanel() {
  const { data, mutate } = useSWR('/api/community/admin/reports', fetcher,
                                  { refreshInterval: 60_000 })
  const reports = data?.reports || []
  if (!data) return null            // flag off / not loaded — render nothing

  const act = async (id, action) => {
    await apiCall(`/api/community/admin/reports/${id}`, { action }, 'PATCH')
    mutate()
  }
  const mute = async (userId) => {
    if (!window.confirm(`Mute ${userId}? They can read but not post.`)) return
    await apiCall(`/api/community/admin/mute/${userId}`, { muted: true })
  }

  return (
    <section style={{ marginTop: 24 }}>
      <h3>Community Reports ({reports.length} open)</h3>
      {reports.length === 0 && <p style={{ opacity: 0.6 }}>Queue is clear.</p>}
      {reports.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center',
                                 padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden',
                         textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            <strong>{r.thread_id ? 'Thread' : 'Post'}</strong> — {r.preview}
            <em style={{ opacity: 0.6 }}> · “{r.reason}” by {r.reporter_id}</em>
          </span>
          <button onClick={() => act(r.id, 'hide')}>Hide</button>
          <button onClick={() => act(r.id, 'dismiss')}>Dismiss</button>
          <button onClick={() => mute(r.target_author_id)}>Mute author</button>
        </div>
      ))}
    </section>
  )
}
```

(Match Admin.jsx's local styling idiom when mounting — if that page uses module classes for section cards, wrap accordingly. Follow `TwitterAccountsPanel`'s mount pattern exactly.)

- [ ] **Step 4: Mount in `Admin.jsx`**

Find where `TwitterAccountsPanel` is rendered; add below it:

```jsx
<CommunityReportsPanel />
```

with the corresponding import at the top.

- [ ] **Step 5: Run tests**

Run: `cd app && npx vitest run src/components/admin/CommunityReportsPanel`
Expected: pass

- [ ] **Step 6: Commit**

```bash
git add app/src/components/admin/CommunityReportsPanel.jsx app/src/components/admin/CommunityReportsPanel.test.jsx app/src/pages/Admin.jsx
git commit -m "feat(community): admin reports queue panel"
```

---

### Task 15: Full verification + dark ship + launch runbook

**Files:**
- No new code. Verification + deploy.

- [ ] **Step 1: Full backend suite**

Run: `python -m pytest tests/api/test_community_store.py tests/api/test_community_router.py tests/api/test_community_seed.py -v`
Expected: all pass. Then run the broader API suite to catch regressions: `python -m pytest tests/api -x -q` (pre-existing failures unrelated to community are out of scope — compare against a pre-branch run).

- [ ] **Step 2: Full frontend suite + build**

Run: `cd app && npx vitest run && npm run build`
Expected: no new failures vs the pre-branch baseline; build emits `vendor-tiptap` chunk.

- [ ] **Step 3: Local end-to-end smoke (flag ON)**

```powershell
$env:COMMUNITY_ENABLED="1"; $env:ADMIN_EMAILS="mobtest@local.dev"; $env:WORKER_ENABLED="0"; $env:CATALYST_ENGINE_ENABLED="0"; $env:TWITTERAPI_IO_ENABLED="0"; $env:BARS_PREWARM_DISABLED="1"; $env:TICKER_NAMES_PREWARM_DISABLED="1"
python -m uvicorn api.main:app --port 8077
```

Rebuild `app` first so the backend serves fresh `dist/`. Then in a browser as the admin test account: Community appears in nav → ack gate → create a Mentor Desk thread → reply as the same user → react → pin/lock/highlight → report → check /admin queue → hide. Verify a member-role account cannot post in Mentor Desk (signup a second local account). Verify `$NV` autocomplete inserts a chip and image paste renders.

- [ ] **Step 4: Invariant checks before push**

```bash
grep -c broker_sync api/main.py     # must be ≥ 7
git log --oneline origin/master..HEAD   # review the commit train
```

- [ ] **Step 5: Ship dark (outside 9:15 AM–4:20 PM ET)**

```bash
git push origin HEAD:master
```

Do NOT set `COMMUNITY_ENABLED` in Railway yet. Verify deploy per the standard playbook (origin bundle hash vs Cloudflare; memory `reference_dashboard_deploy_verify_cloudflare`). Confirm `/api/community/status` returns `{"enabled": false, ...}` for a logged-in user and nothing shows in the nav.

- [ ] **Step 6: Launch runbook (OWNER-GATED — do not execute without explicit go)**

1. Owner gets disclaimer wording approved (AckGate text + footer).
2. Backfill on the pod: `railway ssh --service web -- /opt/venv/bin/python scripts/backfill_community_desk_threads.py --days 14 --dry-run`, review, re-run without `--dry-run`.
3. Owner writes 3–5 mentor posts + pinned "Welcome to the Floor" rules thread (via the UI, flag enabled only for admin testing is NOT possible with a global flag — write them immediately after flipping, before announcing).
4. Check Railway vars first (standing rule), then set `COMMUNITY_ENABLED=1` and redeploy in the shipping window.
5. Announce in the morning Wire + dashboard.
6. Daily: auto-seeded session thread lands after each Desk publish; owner highlights/answers early and often.
