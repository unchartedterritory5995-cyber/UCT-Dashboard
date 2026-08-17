"""SQLite store for "The Desk" content hub — Substack publications/posts and
Team members.

DB path: /data/desk.db (web service Railway volume). Mirrors the modelbook /
tweet_store conventions: WAL mode, _WRITE_LOCK on writes, contextlib.closing on
every connection (Windows teardown requires explicit close).

Three tables:
  substack_publications — admin-configured Substack RSS feeds.
  substack_posts        — posts pulled from those feeds (link-out cards).
  team_members          — "Meet the Team" member cards.
"""
from __future__ import annotations

import contextlib
import html
import os
import re
import sqlite3
import threading
import time
from typing import Optional

_DB_PATH = os.environ.get("DESK_DB_PATH", "/data/desk.db")
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS substack_publications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  feed_url    TEXT    NOT NULL UNIQUE,
  enabled     INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  added_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS substack_posts (
  id            TEXT PRIMARY KEY,           -- guid or url (dedupe key)
  publication_id INTEGER REFERENCES substack_publications(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  excerpt       TEXT,
  url           TEXT NOT NULL,
  hero_image    TEXT,
  author        TEXT,
  published_at  INTEGER NOT NULL,           -- unix seconds
  ingested_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_substack_posts_pub
  ON substack_posts(published_at DESC);

CREATE TABLE IF NOT EXISTS team_members (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT    NOT NULL,
  role           TEXT,
  bio            TEXT,
  years_trading  TEXT,
  trading_style  TEXT,
  teaching_focus TEXT,
  has_photo      INTEGER NOT NULL DEFAULT 0,
  twitter_url    TEXT,
  substack_url   TEXT,
  email          TEXT,
  link_url       TEXT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  enabled        INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_team_order ON team_members(sort_order, id);
"""

# Columns added after the original team_members schema shipped — ALTERed in on
# existing DBs (each wrapped in try/except so a re-run / already-present column
# is a no-op). Mirrors the j2 _PHASE_2_ALTERS idiom.
_TEAM_ALTERS = (
    "ALTER TABLE team_members ADD COLUMN years_trading TEXT",
    "ALTER TABLE team_members ADD COLUMN trading_style TEXT",
    "ALTER TABLE team_members ADD COLUMN teaching_focus TEXT",
)

# Native article reader. `body_raw` is the publisher's HTML exactly as fetched;
# `body_html` is our converted output. Keeping BOTH is what makes a converter
# improvement a local re-render instead of re-scraping the publication.
_POST_ALTERS = (
    "ALTER TABLE substack_posts ADD COLUMN body_raw TEXT",
    "ALTER TABLE substack_posts ADD COLUMN body_html TEXT",
    "ALTER TABLE substack_posts ADD COLUMN body_hash TEXT",
    "ALTER TABLE substack_posts ADD COLUMN sections_json TEXT",
    "ALTER TABLE substack_posts ADD COLUMN tickers_json TEXT",
    "ALTER TABLE substack_posts ADD COLUMN display_title TEXT",
    "ALTER TABLE substack_posts ADD COLUMN slug TEXT",
    "ALTER TABLE substack_posts ADD COLUMN word_count INTEGER",
    "ALTER TABLE substack_posts ADD COLUMN reading_minutes INTEGER",
    "ALTER TABLE substack_posts ADD COLUMN image_count INTEGER",
    "ALTER TABLE substack_posts ADD COLUMN converter_version INTEGER",
    "ALTER TABLE substack_posts ADD COLUMN body_fetched_at INTEGER",
)

# Columns the ARTICLE LIST is allowed to select. `SELECT p.*` here would put
# every row's ~200 KB body into a payload that renders cards -- roughly 20 MB
# per page load for an 84-post archive. The reader endpoint fetches one row.
_POST_LIST_COLS = (
    "id", "publication_id", "title", "display_title", "slug", "excerpt", "url",
    "hero_image", "author", "published_at", "ingested_at",
    "word_count", "reading_minutes", "image_count", "tickers_json",
)

_PUB_FIELDS = ("name", "feed_url", "enabled", "sort_order")
_MEMBER_FIELDS = ("name", "role", "bio", "years_trading", "trading_style",
                  "teaching_focus", "twitter_url", "substack_url", "email",
                  "link_url", "sort_order", "enabled")


# Full-text search over the archive. A standalone (non-content) FTS5 table keyed
# on the post id: `substack_posts.id` is the post URL, which an external-content
# table cannot use as a rowid.
_FTS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS substack_posts_fts USING fts5(
  post_id UNINDEXED,
  title,
  tickers,
  body,
  tokenize='porter unicode61'
);
"""

# Whether this build of SQLite has FTS5. Resolved once, at init.
_FTS_READY = False


def fts_available() -> bool:
    return _FTS_READY


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db() -> None:
    global _FTS_READY
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        for stmt in _TEAM_ALTERS + _POST_ALTERS:
            try:
                c.execute(stmt)
            except sqlite3.OperationalError:
                pass  # column already exists (fresh schema or prior run)
        # FTS5 is compiled in on every build we run on, but an unguarded CREATE
        # VIRTUAL TABLE here would take the WHOLE Desk down (articles, team) on a
        # build without it. Search degrades; the hub keeps working.
        try:
            c.executescript(_FTS_SCHEMA)
            _FTS_READY = True
        except sqlite3.OperationalError as e:
            print(f"[desk_store] FTS5 unavailable, archive search disabled: {e}")
            _FTS_READY = False
        c.commit()


# The firm's own Substack, seeded idempotently on startup (admin can edit/remove).
DEFAULT_PUBLICATIONS = [
    ("Uncharted Territory", "https://unchartedterritoryy.substack.com/feed"),
]


def ensure_default_publications() -> None:
    """Idempotently seed the firm's Substack feed(s). create_publication upserts
    on feed_url, so an admin who renames/edits one is not clobbered. Never raises."""
    for name, feed_url in DEFAULT_PUBLICATIONS:
        try:
            create_publication(name, feed_url)
        except Exception:
            pass


# Avatar storage. Bundled seed avatars (the traders' X profile pics, pulled from
# the roster sheet) ship in the repo; the live serving copy lives on the Railway
# volume next to admin-uploaded photos. DESK_PHOTO_DIR mirrors api/routers/desk.py.
_BUNDLED_PHOTO_DIR = os.path.join(os.path.dirname(__file__), "desk_team_photos")
_TEAM_PHOTO_DIR = os.environ.get("DESK_PHOTO_DIR", "/data/team_photos")


def seed_member_photo(member_id: int, photo_filename: str) -> bool:
    """Copy a bundled seed avatar into the live photo dir as {id}.webp and flag
    the member has_photo. The bundled files are already WebP. Returns True on
    success, False on a missing file. Never raises."""
    if not photo_filename:
        return False
    src = os.path.join(_BUNDLED_PHOTO_DIR, photo_filename)
    if not os.path.exists(src):
        return False
    try:
        os.makedirs(_TEAM_PHOTO_DIR, exist_ok=True)
        with open(src, "rb") as f:
            data = f.read()
        with open(os.path.join(_TEAM_PHOTO_DIR, f"{int(member_id)}.webp"), "wb") as f:
            f.write(data)
        set_member_photo(member_id, True)
        return True
    except Exception:
        return False


def ensure_default_team() -> None:
    """Idempotently seed the firm's traders ("Meet the Team") from the curated
    roster. Inserts only members whose name is not already present, so an admin
    who edits/hides/reorders a member or uploads a photo is never clobbered, and
    re-runs on every boot never duplicate. Also backfills the bundled X-avatar for
    any seed member that still has no photo (covers members seeded before avatars
    shipped). Never raises."""
    try:
        from api.services.desk_team_seed import SEED_MEMBERS
    except Exception:
        return
    try:
        existing = {(m.get("name") or "").strip().lower(): m for m in list_team()}
    except Exception:
        existing = {}
    for member in SEED_MEMBERS:
        key = (member.get("name") or "").strip().lower()
        row = existing.get(key)
        if row is None:
            try:
                row = create_member(member)
            except Exception:
                continue
        # Backfill the bundled avatar only when the member has no photo yet —
        # never clobbers an admin upload (has_photo == 1).
        if row and not row.get("has_photo") and member.get("photo"):
            seed_member_photo(row["id"], member["photo"])
    _reseed_photos_once()


# Bump when the bundled avatar set is regenerated (e.g. crisper sources) and you
# want already-seeded members to adopt the new images. Each version runs exactly
# once (flag file on the photo volume).
_PHOTO_VERSION = "v2_crisp"


def _reseed_photos_once() -> None:
    """One-shot: re-stamp every seed member's photo from the (updated) bundled
    avatars, so members seeded with an older/smaller image pick up the crisper
    set. Gated by a per-version flag file on the photo volume → runs once. This
    DOES overwrite an existing seed photo (that's the point); it only touches
    members whose name matches the seed roster. Never raises."""
    flag = os.path.join(_TEAM_PHOTO_DIR, f".photos_{_PHOTO_VERSION}")
    try:
        if os.path.exists(flag):
            return
    except Exception:
        return
    try:
        from api.services.desk_team_seed import SEED_MEMBERS
        by_name = {(m.get("name") or "").strip().lower(): m for m in SEED_MEMBERS}
        for row in list_team():
            seed = by_name.get((row.get("name") or "").strip().lower())
            if seed and seed.get("photo"):
                seed_member_photo(row["id"], seed["photo"])
        os.makedirs(_TEAM_PHOTO_DIR, exist_ok=True)
        with open(flag, "w") as f:
            f.write(_PHOTO_VERSION)
    except Exception:
        pass


# ── Substack publications ───────────────────────────────────────────────────────

def list_publications(enabled_only: bool = False) -> list[dict]:
    sql = "SELECT * FROM substack_publications"
    if enabled_only:
        sql += " WHERE enabled=1"
    sql += " ORDER BY sort_order ASC, name ASC"
    with contextlib.closing(_connect()) as c:
        return [dict(r) for r in c.execute(sql).fetchall()]


def create_publication(name: str, feed_url: str, sort_order: int = 0) -> dict:
    name = (name or "").strip()
    feed_url = (feed_url or "").strip()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO substack_publications (name, feed_url, enabled, sort_order, added_at)
               VALUES (?, ?, 1, ?, ?)
               ON CONFLICT(feed_url) DO UPDATE SET name=excluded.name, enabled=1""",
            (name, feed_url, sort_order, int(time.time())),
        )
        c.commit()
        row = c.execute("SELECT * FROM substack_publications WHERE feed_url=?",
                        (feed_url,)).fetchone()
        return dict(row)


def update_publication(pub_id: int, payload: dict) -> Optional[dict]:
    fields = {f: payload[f] for f in _PUB_FIELDS if f in payload}
    if not fields:
        return get_publication(pub_id)
    set_clause = ", ".join(f"{k}=:{k}" for k in fields)
    fields["id"] = int(pub_id)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(f"UPDATE substack_publications SET {set_clause} WHERE id=:id", fields)
        c.commit()
        if cur.rowcount == 0:
            return None
    return get_publication(pub_id)


def get_publication(pub_id: int) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM substack_publications WHERE id=?", (int(pub_id),)).fetchone()
        return dict(row) if row else None


def delete_publication(pub_id: int) -> bool:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM substack_publications WHERE id=?", (int(pub_id),))
        c.commit()
        return cur.rowcount > 0


# ── Substack posts ──────────────────────────────────────────────────────────────

def upsert_post(post: dict) -> None:
    """Insert a post (idempotent on id = guid/url). Updates title/excerpt/hero in
    case the publisher edited the post."""
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO substack_posts
               (id, publication_id, title, excerpt, url, hero_image, author,
                published_at, ingested_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 title=excluded.title, excerpt=excluded.excerpt, hero_image=excluded.hero_image""",
            (post["id"], post.get("publication_id"), post["title"], post.get("excerpt"),
             post["url"], post.get("hero_image"), post.get("author"),
             int(post["published_at"]), now),
        )
        c.commit()


def list_posts(limit: int = 60) -> list[dict]:
    """Newest-first posts, deduped by URL. Read-time dedupe guarantees the page
    never shows the same post twice even if legacy rows exist under two ids
    (early RSS rows keyed by guid + archive rows keyed by numeric id).

    Selects columns EXPLICITLY, never `p.*`: the body columns live on this table
    and a card grid that shipped them would be ~20 MB per load.
    """
    cols = ", ".join(f"p.{c}" for c in _POST_LIST_COLS)
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            f"""SELECT {cols},
                       pub.name AS publication_name,
                       (p.body_html IS NOT NULL AND p.body_html != '') AS has_body
               FROM substack_posts p
               LEFT JOIN substack_publications pub ON pub.id = p.publication_id
               ORDER BY p.published_at DESC""",
        ).fetchall()
        out, seen = [], set()
        for r in rows:
            d = dict(r)
            key = (d.get("url") or "").strip().rstrip("/").lower() or d.get("id")
            if key in seen:
                continue
            seen.add(key)
            out.append(d)
            if len(out) >= int(limit):
                break
        return out


def dedupe_posts() -> int:
    """Physically remove duplicate post rows that share a URL, keeping the newest
    by published_at (then lowest rowid). Returns rows deleted. Idempotent."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            """DELETE FROM substack_posts
               WHERE rowid NOT IN (
                 SELECT rowid FROM (
                   SELECT rowid,
                          ROW_NUMBER() OVER (
                            PARTITION BY LOWER(RTRIM(url,'/'))
                            ORDER BY published_at DESC, rowid ASC
                          ) AS rn
                   FROM substack_posts
                 ) WHERE rn = 1
               )""")
        c.commit()
        return cur.rowcount


def delete_posts_for_publication(pub_id: int) -> int:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM substack_posts WHERE publication_id=?", (int(pub_id),))
        c.commit()
        return cur.rowcount


# ── Native article bodies ───────────────────────────────────────────────────────

def get_post(post_id: str) -> Optional[dict]:
    """One post WITH its converted body — the reader endpoint's row."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            """SELECT p.*, pub.name AS publication_name
               FROM substack_posts p
               LEFT JOIN substack_publications pub ON pub.id = p.publication_id
               WHERE p.id = ?""",
            (str(post_id),),
        ).fetchone()
        return dict(row) if row else None


def get_post_by_slug(slug: str) -> Optional[dict]:
    """Reader lookup by the URL-facing slug (falls back to id at the router)."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            """SELECT p.*, pub.name AS publication_name
               FROM substack_posts p
               LEFT JOIN substack_publications pub ON pub.id = p.publication_id
               WHERE p.slug = ?
               ORDER BY p.published_at DESC LIMIT 1""",
            (str(slug),),
        ).fetchone()
        return dict(row) if row else None


def save_post_body(post_id: str, fields: dict) -> None:
    """Store a converted body against an existing post row.

    Deliberately UPDATE-only: the roster is owned by the poller, so a body for a
    post we never listed would create a half-row the article list can't render.
    """
    allowed = ("body_raw", "body_html", "body_hash", "sections_json", "tickers_json",
               "display_title", "slug", "word_count", "reading_minutes",
               "image_count", "converter_version", "body_fetched_at")
    payload = {k: fields[k] for k in allowed if k in fields}
    if not payload:
        return
    sets = ", ".join(f"{k}=:{k}" for k in payload)
    payload["id"] = str(post_id)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(f"UPDATE substack_posts SET {sets} WHERE id=:id", payload)
        c.commit()


def posts_needing_body(converter_version: int, limit: int = 500) -> list[dict]:
    """Posts whose body is absent or was built by an older converter.

    Ordered newest-first so a partial backfill leaves the archive useful from the
    top rather than from 2025. Returns only what the fetcher needs.
    """
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT id, url, title, published_at, body_hash, converter_version,
                      (body_raw IS NOT NULL AND body_raw != '') AS has_raw
               FROM substack_posts
               WHERE body_html IS NULL OR body_html = ''
                  OR converter_version IS NULL
                  OR converter_version < ?
               ORDER BY published_at DESC
               LIMIT ?""",
            (int(converter_version), int(limit)),
        ).fetchall()
        return [dict(r) for r in rows]


def index_post_search(post_id: str, *, title: str, tickers: list, body: str) -> None:
    """(Re)index one article for search. Idempotent: the old row is removed first,
    so re-converting an article never leaves a stale duplicate behind."""
    if not _FTS_READY:
        return
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("DELETE FROM substack_posts_fts WHERE post_id=?", (str(post_id),))
        c.execute(
            "INSERT INTO substack_posts_fts (post_id, title, tickers, body) VALUES (?,?,?,?)",
            (str(post_id), title or "", " ".join(tickers or []), body or ""),
        )
        c.commit()


def search_posts(query: str, limit: int = 30) -> list:
    """Rank the archive against a query. Returns list rows + a highlighted snippet.

    Deliberately NOT returning bodies — this feeds a result list, and the whole
    reason list_posts selects explicit columns is that bodies are ~200 KB each.
    """
    q = (query or "").strip()
    if not q or not _FTS_READY:
        return []
    cols = ", ".join(f"p.{c}" for c in _POST_LIST_COLS)
    with contextlib.closing(_connect()) as c:
        try:
            rows = c.execute(
                f"""SELECT {cols},
                           pub.name AS publication_name,
                           snippet(substack_posts_fts, 3, char(2), char(3), '…', 18) AS snippet,
                           bm25(substack_posts_fts, 0.0, 8.0, 6.0, 1.0) AS rank
                    FROM substack_posts_fts
                    JOIN substack_posts p ON p.id = substack_posts_fts.post_id
                    LEFT JOIN substack_publications pub ON pub.id = p.publication_id
                    WHERE substack_posts_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?""",
                (_fts_query(q), int(limit)),
            ).fetchall()
        except sqlite3.OperationalError:
            # A malformed FTS expression (stray quote, bare operator) is a user
            # typing, not a server fault.
            return []
        return [_with_safe_snippet(dict(r)) for r in rows]


# FTS5 marks the hit with delimiters we choose. We ask for two CONTROL CHARS,
# escape the whole snippet, then swap them for <mark> — because the indexed body
# is PLAIN TEXT in which `<` is a literal character (the converter decodes
# entities), so asking SQLite for '<mark>' directly would emit unescaped author
# text straight into dangerouslySetInnerHTML.
_SNIPPET_OPEN, _SNIPPET_CLOSE = "\x02", "\x03"


def _with_safe_snippet(row: dict) -> dict:
    raw = row.get("snippet")
    if raw:
        safe = html.escape(str(raw), quote=False)
        row["snippet"] = (safe.replace(_SNIPPET_OPEN, "<mark>")
                              .replace(_SNIPPET_CLOSE, "</mark>"))
    return row


def _fts_query(raw: str) -> str:
    """User text -> a safe FTS5 MATCH expression.

    Every term is quoted, so `AND`/`OR`/`NEAR`/`*`/`:` typed by a member are
    searched for literally instead of being parsed as operators (or raising).
    A bare ticker still works because quoting a single token matches that token.
    """
    terms = [t for t in re.split(r"\s+", raw.strip()) if t]
    quoted = ['"' + t.replace('"', '""') + '"' for t in terms[:12]]
    return " ".join(quoted)


def count_indexed_posts() -> int:
    if not _FTS_READY:
        return 0
    with contextlib.closing(_connect()) as c:
        return c.execute("SELECT COUNT(*) FROM substack_posts_fts").fetchone()[0]


def get_post_raw(post_id: str) -> Optional[str]:
    """The stored publisher HTML, for re-converting without a network call."""
    with contextlib.closing(_connect()) as c:
        row = c.execute(
            "SELECT body_raw FROM substack_posts WHERE id=?", (str(post_id),)
        ).fetchone()
        return (row["body_raw"] if row else None) or None


# ── Team members ────────────────────────────────────────────────────────────────

def list_team(enabled_only: bool = False) -> list[dict]:
    sql = "SELECT * FROM team_members"
    if enabled_only:
        sql += " WHERE enabled=1"
    sql += " ORDER BY sort_order ASC, id ASC"
    with contextlib.closing(_connect()) as c:
        return [dict(r) for r in c.execute(sql).fetchall()]


def get_member(member_id: int) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM team_members WHERE id=?", (int(member_id),)).fetchone()
        return dict(row) if row else None


def create_member(payload: dict) -> dict:
    now = int(time.time())
    data = {f: payload.get(f) for f in _MEMBER_FIELDS}
    data["name"] = (data.get("name") or "").strip()
    data["sort_order"] = data.get("sort_order") or 0
    data["enabled"] = 1 if data.get("enabled", 1) else 0
    data["created_at"] = now
    data["updated_at"] = now
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            """INSERT INTO team_members
               (name, role, bio, years_trading, trading_style, teaching_focus,
                twitter_url, substack_url, email, link_url,
                sort_order, enabled, created_at, updated_at)
               VALUES (:name, :role, :bio, :years_trading, :trading_style,
                       :teaching_focus, :twitter_url, :substack_url, :email,
                       :link_url, :sort_order, :enabled, :created_at, :updated_at)""",
            data,
        )
        c.commit()
        return get_member(cur.lastrowid)


def update_member(member_id: int, payload: dict) -> Optional[dict]:
    fields = {f: payload[f] for f in _MEMBER_FIELDS if f in payload}
    if "enabled" in fields:
        fields["enabled"] = 1 if fields["enabled"] else 0
    if not fields:
        return get_member(member_id)
    fields["updated_at"] = int(time.time())
    set_clause = ", ".join(f"{k}=:{k}" for k in fields)
    fields["id"] = int(member_id)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(f"UPDATE team_members SET {set_clause} WHERE id=:id", fields)
        c.commit()
        if cur.rowcount == 0:
            return None
    return get_member(member_id)


def set_member_photo(member_id: int, has_photo: bool) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE team_members SET has_photo=?, updated_at=? WHERE id=?",
                  (1 if has_photo else 0, int(time.time()), int(member_id)))
        c.commit()


def delete_member(member_id: int) -> bool:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM team_members WHERE id=?", (int(member_id),))
        c.commit()
        return cur.rowcount > 0
