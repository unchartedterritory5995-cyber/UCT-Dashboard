"""48-hour persistence for RSS news items feeding the catalyst engine.

The live RSS pull is a point-in-time snapshot of ~80 items across feeds. A
catalyst that breaks in the evening (index reconstitution, M&A, guidance)
has rolled out of every feed's window by the 6 AM premarket refresh — the
Nasdaq-100 inclusion headline (2026-06-11 evening) was unfindable by the
time the engine could have used it. Each refresh now upserts the live pull
into this store and reads back the full retention window, so evening news
survives to the morning run.

Same lazy-SQLite pattern as ticker_metadata.py. Keyed by URL (title-hash
fallback) so repeat pulls dedupe. Retention pruned on every upsert.
"""
import contextlib
import hashlib
import json
import logging
import os
import sqlite3
import threading
import time

logger = logging.getLogger(__name__)

_DB_PATH = os.environ.get("CATALYST_NEWS_DB_PATH",
                          os.path.join(os.environ.get("DATA_DIR", "/data"),
                                       "catalyst_news.db"))
RETENTION_HOURS = int(os.environ.get("CATALYST_NEWS_RETENTION_HOURS", "48"))
_READ_LIMIT = 600  # hard bound on items handed to extraction per refresh

_SCHEMA = """
CREATE TABLE IF NOT EXISTS news_items (
  key            TEXT PRIMARY KEY,
  title          TEXT,
  summary        TEXT,
  url            TEXT,
  source         TEXT,
  time_published TEXT,
  tickers_json   TEXT,
  first_seen_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_seen ON news_items(first_seen_at);
"""

_INIT_DONE = False
_INIT_LOCK = threading.Lock()
_WRITE_LOCK = threading.Lock()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with _INIT_LOCK:
        if _INIT_DONE:
            return
        parent = os.path.dirname(_DB_PATH)
        if parent:
            os.makedirs(parent, exist_ok=True)
        with contextlib.closing(_connect()) as c:
            c.executescript(_SCHEMA)
            c.commit()
        _INIT_DONE = True


def _key(item: dict) -> str:
    url = (item.get("url") or "").strip()
    if url:
        return url
    title = (item.get("title") or item.get("headline") or "").strip()
    return "t:" + hashlib.sha1(title.lower().encode()).hexdigest()


def upsert_items(items: list[dict]) -> int:
    """Insert new items; existing keys keep their first_seen_at (the item's
    age in the retention window is when WE first saw it, not when a feed
    re-served it). Prunes expired rows. Returns number of new rows."""
    if not items:
        return 0
    _ensure_init()
    now = int(time.time())
    new = 0
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        for item in items:
            title = item.get("title") or item.get("headline") or ""
            if not title:
                continue
            cur = c.execute(
                """INSERT OR IGNORE INTO news_items
                   (key, title, summary, url, source, time_published,
                    tickers_json, first_seen_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (_key(item), title, item.get("summary") or "",
                 item.get("url"), item.get("source") or item.get("category"),
                 item.get("time_published"),
                 json.dumps(item.get("tickers") or []), now),
            )
            new += cur.rowcount
        cutoff = now - RETENTION_HOURS * 3600
        c.execute("DELETE FROM news_items WHERE first_seen_at < ?", (cutoff,))
        c.commit()
    return new


def recent_items(hours: int = RETENTION_HOURS) -> list[dict]:
    """Items first seen within the window, newest-seen first, in the same
    shape the live fetch_rss_news returns."""
    _ensure_init()
    since = int(time.time()) - hours * 3600
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT * FROM news_items WHERE first_seen_at >= ?
               ORDER BY first_seen_at DESC LIMIT ?""",
            (since, _READ_LIMIT),
        ).fetchall()
    out = []
    for r in rows:
        try:
            tickers = json.loads(r["tickers_json"] or "[]")
        except (TypeError, ValueError):
            tickers = []
        out.append({
            "title": r["title"],
            "summary": r["summary"],
            "url": r["url"],
            "source": r["source"],
            "time_published": r["time_published"],
            "tickers": tickers,
        })
    return out
