"""Persistent company-news store.

The piece nothing in UCT had. `catalyst/news_store.py` keeps a 48-hour working
set for the morning engine by design; the Company Panel needs years of history
with cursor pagination and full-text search, so this lives beside it rather
than inside it. Same SQLite + lazy-init + WAL conventions as tweet_store and
catalyst/news_store, so operational behaviour is familiar.

    ⚠️ Opening a company's News tab must never touch a provider. Everything
    the panel renders is read from here.
"""

from __future__ import annotations

import base64
import contextlib
import json
import logging
import os
import re
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

_log = logging.getLogger(__name__)

_DB_PATH = os.environ.get(
    "COMPANY_NEWS_DB_PATH",
    os.path.join(os.environ.get("DATA_DIR", "/data"), "company_news.db"))

_WRITE_LOCK = threading.RLock()
_INIT_DONE = False
_INIT_LOCK = threading.Lock()

# Retention by relevance (§ approved Decision 5). Configurable, not hardcoded
# through the codebase: one table, read at prune time.
RETENTION_DAYS: dict[str, int | None] = {
    "reject": int(os.environ.get("NEWS_RETAIN_REJECT_DAYS", "7")),
    "unknown": int(os.environ.get("NEWS_RETAIN_UNKNOWN_DAYS", "90")),
    "mention": int(os.environ.get("NEWS_RETAIN_MENTION_DAYS", "90")),
    "related": int(os.environ.get("NEWS_RETAIN_RELATED_DAYS", "730")),
    "direct": None,   # keep
}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS news_items (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  provider          TEXT NOT NULL,
  provider_id       TEXT NOT NULL,
  source_name       TEXT NOT NULL DEFAULT '',
  source_display    TEXT NOT NULL DEFAULT '',
  source_class      TEXT NOT NULL DEFAULT 'unknown',
  url               TEXT NOT NULL DEFAULT '',
  canonical_url     TEXT NOT NULL DEFAULT '',
  headline          TEXT NOT NULL DEFAULT '',
  headline_key      TEXT NOT NULL DEFAULT '',
  description       TEXT NOT NULL DEFAULT '',
  author            TEXT NOT NULL DEFAULT '',
  published_at      TEXT NOT NULL,
  updated_at        TEXT NOT NULL DEFAULT '',
  ingested_at       TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'other',
  sentiment         TEXT NOT NULL DEFAULT '',
  sentiment_reason  TEXT NOT NULL DEFAULT '',
  image_url         TEXT NOT NULL DEFAULT '',
  image_is_house    INTEGER NOT NULL DEFAULT 0,
  media_type        TEXT NOT NULL DEFAULT '',
  embed_url         TEXT NOT NULL DEFAULT '',
  form_type         TEXT NOT NULL DEFAULT '',
  event_key         TEXT NOT NULL DEFAULT '',
  is_primary        INTEGER NOT NULL DEFAULT 1,
  reject_reason     TEXT NOT NULL DEFAULT '',
  raw_ref           TEXT NOT NULL DEFAULT '',
  UNIQUE(provider, provider_id)
);
CREATE INDEX IF NOT EXISTS ix_news_pub    ON news_items(published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS ix_news_canon  ON news_items(canonical_url) WHERE canonical_url <> '';
CREATE INDEX IF NOT EXISTS ix_news_hkey   ON news_items(headline_key, published_at);
CREATE INDEX IF NOT EXISTS ix_news_event  ON news_items(event_key) WHERE event_key <> '';

CREATE TABLE IF NOT EXISTS news_tickers (
  news_id     INTEGER NOT NULL,
  ticker      TEXT NOT NULL,
  relevance   TEXT NOT NULL DEFAULT 'unknown',
  subject     TEXT NOT NULL DEFAULT 'unknown',
  PRIMARY KEY (news_id, ticker),
  FOREIGN KEY (news_id) REFERENCES news_items(id) ON DELETE CASCADE
);
-- THE feed query: one ticker, displayable rows, newest first.
CREATE INDEX IF NOT EXISTS ix_nt_feed ON news_tickers(ticker, relevance, news_id DESC);

CREATE TABLE IF NOT EXISTS news_source_health (
  source        TEXT PRIMARY KEY,
  last_attempt  TEXT NOT NULL DEFAULT '',
  last_ok       TEXT NOT NULL DEFAULT '',
  last_item_at  TEXT NOT NULL DEFAULT '',
  ok_count      INTEGER NOT NULL DEFAULT 0,
  err_count     INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT NOT NULL DEFAULT '',
  state         TEXT NOT NULL DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS news_ingest_stats (
  day        TEXT NOT NULL,
  source     TEXT NOT NULL,
  metric     TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  n          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source, metric, detail)
);

CREATE TABLE IF NOT EXISTS news_backfill_state (
  job        TEXT PRIMARY KEY,
  cursor     TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  done       INTEGER NOT NULL DEFAULT 0,
  requests   INTEGER NOT NULL DEFAULT 0,
  note       TEXT NOT NULL DEFAULT ''
);

CREATE VIRTUAL TABLE IF NOT EXISTS news_fts USING fts5(
  headline, description, source_display,
  content='news_items', content_rowid='id', tokenize='porter unicode61'
);
"""

_FTS_TRIGGERS = """
CREATE TRIGGER IF NOT EXISTS news_ai AFTER INSERT ON news_items BEGIN
  INSERT INTO news_fts(rowid, headline, description, source_display)
  VALUES (new.id, new.headline, new.description, new.source_display);
END;
CREATE TRIGGER IF NOT EXISTS news_ad AFTER DELETE ON news_items BEGIN
  INSERT INTO news_fts(news_fts, rowid, headline, description, source_display)
  VALUES ('delete', old.id, old.headline, old.description, old.source_display);
END;
CREATE TRIGGER IF NOT EXISTS news_au AFTER UPDATE ON news_items BEGIN
  INSERT INTO news_fts(news_fts, rowid, headline, description, source_display)
  VALUES ('delete', old.id, old.headline, old.description, old.source_display);
  INSERT INTO news_fts(rowid, headline, description, source_display)
  VALUES (new.id, new.headline, new.description, new.source_display);
END;
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
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
            try:
                os.makedirs(parent, exist_ok=True)
            except OSError:
                pass
        with contextlib.closing(_connect()) as c:
            c.executescript(_SCHEMA)
            try:
                c.executescript(_FTS_TRIGGERS)
            except sqlite3.OperationalError as e:      # FTS5 not compiled in
                _log.warning("company news FTS unavailable: %s", e)
            c.commit()
        _INIT_DONE = True


def set_db_path(path: str) -> None:
    """Test hook. Points the store at a temp file and forces re-init."""
    global _DB_PATH, _INIT_DONE
    with _INIT_LOCK:
        _DB_PATH = path
        _INIT_DONE = False


def db_path() -> str:
    return _DB_PATH


def _iso(dt: datetime | None) -> str:
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# writes
# ---------------------------------------------------------------------------
_ITEM_COLS = (
    "provider", "provider_id", "source_name", "source_display", "source_class",
    "url", "canonical_url", "headline", "headline_key", "description", "author",
    "published_at", "updated_at", "ingested_at", "category", "sentiment",
    "sentiment_reason", "image_url", "image_is_house", "media_type",
    "embed_url", "form_type", "event_key", "is_primary", "reject_reason",
    "raw_ref",
)


def upsert(item: dict[str, Any], tickers: Iterable[dict[str, str]]) -> int:
    """Insert or update one story. Idempotent on (provider, provider_id).

    Returns the row id. Re-ingesting the same article updates it in place --
    which is what makes the backfill safe to restart (§17).
    """
    _ensure_init()
    row = {k: item.get(k) for k in _ITEM_COLS}
    row["provider"] = row.get("provider") or "?"
    row["provider_id"] = row.get("provider_id") or ""
    row["published_at"] = row.get("published_at") or ""
    row["ingested_at"] = row.get("ingested_at") or _now()
    row["image_is_house"] = int(bool(row.get("image_is_house")))
    row["is_primary"] = int(1 if row.get("is_primary", True) else 0)
    for k in _ITEM_COLS:
        if row.get(k) is None:
            row[k] = "" if k not in ("image_is_house", "is_primary") else 0

    cols = ",".join(_ITEM_COLS)
    ph = ",".join("?" for _ in _ITEM_COLS)
    upd = ",".join(f"{c}=excluded.{c}" for c in _ITEM_COLS
                   if c not in ("provider", "provider_id", "ingested_at"))
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute(
            f"INSERT INTO news_items ({cols}) VALUES ({ph}) "
            f"ON CONFLICT(provider, provider_id) DO UPDATE SET {upd}",
            [row[k] for k in _ITEM_COLS])
        nid = cur.lastrowid
        if not nid:
            r = c.execute(
                "SELECT id FROM news_items WHERE provider=? AND provider_id=?",
                (row["provider"], row["provider_id"])).fetchone()
            nid = r["id"] if r else 0
        if nid:
            for t in tickers:
                sym = (t.get("ticker") or "").upper().strip()
                if not sym:
                    continue
                c.execute(
                    "INSERT INTO news_tickers (news_id, ticker, relevance, subject) "
                    "VALUES (?,?,?,?) ON CONFLICT(news_id, ticker) DO UPDATE SET "
                    "relevance=excluded.relevance, subject=excluded.subject",
                    (nid, sym, t.get("relevance") or "unknown",
                     t.get("subject") or "unknown"))
        c.commit()
        return int(nid or 0)


def find_by_canonical(canonical: str) -> dict | None:
    if not canonical:
        return None
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        r = c.execute("SELECT * FROM news_items WHERE canonical_url=? LIMIT 1",
                      (canonical,)).fetchone()
        return dict(r) if r else None


def find_cluster_candidates(tickers: set[str], published_at: datetime,
                            window_hours: int = 12) -> list[dict]:
    """Recent displayable items sharing a ticker, for event clustering."""
    _ensure_init()
    if not tickers:
        return []
    lo = _iso(published_at - timedelta(hours=window_hours))
    hi = _iso(published_at + timedelta(hours=window_hours))
    marks = ",".join("?" for _ in tickers)
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            f"SELECT DISTINCT i.* FROM news_items i "
            f"JOIN news_tickers t ON t.news_id = i.id "
            f"WHERE t.ticker IN ({marks}) AND i.published_at BETWEEN ? AND ? "
            f"AND i.reject_reason='' LIMIT 400",
            [*[s.upper() for s in tickers], lo, hi]).fetchall()
        return [dict(r) for r in rows]


def set_event(news_ids: list[int], key: str, primary_id: int) -> None:
    if not news_ids:
        return
    _ensure_init()
    marks = ",".join("?" for _ in news_ids)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(f"UPDATE news_items SET event_key=?, is_primary=CASE WHEN id=? "
                  f"THEN 1 ELSE 0 END WHERE id IN ({marks})",
                  [key, primary_id, *news_ids])
        c.commit()


# ---------------------------------------------------------------------------
# cursor
# ---------------------------------------------------------------------------
def encode_cursor(published_at: str, nid: int) -> str:
    raw = json.dumps({"p": published_at, "i": int(nid)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def decode_cursor(cur: str | None) -> tuple[str, int] | None:
    """(published_at, id) or None. Never raises on malformed input."""
    if not cur:
        return None
    try:
        pad = "=" * (-len(cur) % 4)
        obj = json.loads(base64.urlsafe_b64decode(cur + pad).decode("utf-8"))
        return str(obj["p"]), int(obj["i"])
    except Exception:
        return None


_FTS_SAFE = re.compile(r"[^\w\s\-]+")


def _fts_query(q: str) -> str:
    """User text -> a safe FTS5 MATCH expression.

    Quotes every token so punctuation can never be read as FTS syntax, and
    prefix-matches the final token so search feels live as the user types.
    """
    toks = [t for t in _FTS_SAFE.sub(" ", q or "").split() if t]
    if not toks:
        return ""
    parts = [f'"{t}"' for t in toks[:-1]]
    parts.append(f'"{toks[-1]}"*')
    return " AND ".join(parts)


# ---------------------------------------------------------------------------
# reads
# ---------------------------------------------------------------------------
def feed(ticker: str, *, limit: int = 25, cursor: str | None = None,
         sentiment: str = "", categories: Iterable[str] | None = None,
         source_classes: Iterable[str] | None = None,
         query: str = "", relevance: Iterable[str] | None = None,
         include_secondary: bool = False) -> dict[str, Any]:
    """One company's feed: strict reverse chronological, cursor-paginated.

    No provider is contacted. This is a single indexed read of our own DB.
    """
    _ensure_init()
    sym = (ticker or "").upper().strip()
    if not sym:
        return {"items": [], "next_cursor": None, "has_more": False}

    limit = max(1, min(100, int(limit or 25)))
    rel = list(relevance) if relevance else ["direct"]
    where = ["t.ticker = ?", "i.reject_reason = ''"]
    args: list[Any] = [sym]

    where.append("t.relevance IN (%s)" % ",".join("?" for _ in rel))
    args.extend(rel)

    if not include_secondary:
        where.append("i.is_primary = 1")

    if sentiment in ("bullish", "bearish"):
        where.append("i.sentiment = ?")
        args.append(sentiment)

    cats = [c for c in (categories or []) if c]
    if cats:
        where.append("i.category IN (%s)" % ",".join("?" for _ in cats))
        args.extend(cats)

    classes = [c for c in (source_classes or []) if c]
    if classes:
        where.append("i.source_class IN (%s)" % ",".join("?" for _ in classes))
        args.extend(classes)
    else:
        where.append("i.source_class IN ('primary','wire','journalism','social')")

    join = ""
    match = _fts_query(query) if query else ""
    if match:
        join = "JOIN news_fts f ON f.rowid = i.id"
        where.append("news_fts MATCH ?")
        args.append(match)

    cur = decode_cursor(cursor)
    if cur:
        where.append("(i.published_at < ? OR (i.published_at = ? AND i.id < ?))")
        args.extend([cur[0], cur[0], cur[1]])

    sql = (f"SELECT i.*, t.relevance AS rel, t.subject AS subj "
           f"FROM news_items i "
           f"JOIN news_tickers t ON t.news_id = i.id {join} "
           f"WHERE {' AND '.join(where)} "
           f"ORDER BY i.published_at DESC, i.id DESC LIMIT ?")
    args.append(limit + 1)

    with contextlib.closing(_connect()) as c:
        try:
            rows = [dict(r) for r in c.execute(sql, args).fetchall()]
        except sqlite3.OperationalError as e:
            _log.warning("news feed query failed (%s); retrying without FTS", e)
            if not match:
                raise
            return feed(ticker, limit=limit, cursor=cursor, sentiment=sentiment,
                        categories=categories, source_classes=source_classes,
                        query="", relevance=relevance,
                        include_secondary=include_secondary)

    has_more = len(rows) > limit
    rows = rows[:limit]
    nxt = (encode_cursor(rows[-1]["published_at"], rows[-1]["id"])
           if rows and has_more else None)
    return {"items": rows, "next_cursor": nxt, "has_more": has_more}


def related_for_event(event_key: str, exclude_id: int) -> list[dict]:
    if not event_key:
        return []
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT source_display, source_class, url, headline, published_at "
            "FROM news_items WHERE event_key=? AND id<>? AND reject_reason='' "
            "ORDER BY published_at ASC LIMIT 6", (event_key, exclude_id)).fetchall()
        return [dict(r) for r in rows]


def counts_for(ticker: str) -> dict[str, int]:
    _ensure_init()
    sym = (ticker or "").upper().strip()
    with contextlib.closing(_connect()) as c:
        r = c.execute(
            "SELECT COUNT(*) n, SUM(i.sentiment='bullish') b, SUM(i.sentiment='bearish') s "
            "FROM news_items i JOIN news_tickers t ON t.news_id=i.id "
            "WHERE t.ticker=? AND t.relevance='direct' AND i.reject_reason='' "
            "AND i.is_primary=1 "
            "AND i.source_class IN ('primary','wire','journalism','social')",
            (sym,)).fetchone()
        return {"total": int(r["n"] or 0), "bullish": int(r["b"] or 0),
                "bearish": int(r["s"] or 0)}


def newest_published(ticker: str = "") -> str:
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        if ticker:
            r = c.execute(
                "SELECT MAX(i.published_at) m FROM news_items i "
                "JOIN news_tickers t ON t.news_id=i.id WHERE t.ticker=?",
                (ticker.upper(),)).fetchone()
        else:
            r = c.execute("SELECT MAX(published_at) m FROM news_items").fetchone()
        return (r["m"] if r and r["m"] else "") or ""


# ---------------------------------------------------------------------------
# health + stats (§43, §44)
# ---------------------------------------------------------------------------
def record_health(source: str, *, ok: bool, error: str = "",
                  last_item_at: str = "") -> None:
    _ensure_init()
    now = _now()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "INSERT INTO news_source_health (source, last_attempt, last_ok, "
            "last_item_at, ok_count, err_count, last_error, state) "
            "VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(source) DO UPDATE SET "
            "last_attempt=excluded.last_attempt, "
            "last_ok=CASE WHEN ? THEN excluded.last_ok ELSE news_source_health.last_ok END, "
            "last_item_at=CASE WHEN excluded.last_item_at<>'' THEN excluded.last_item_at "
            "  ELSE news_source_health.last_item_at END, "
            "ok_count=news_source_health.ok_count + ?, "
            "err_count=news_source_health.err_count + ?, "
            "last_error=CASE WHEN ? THEN news_source_health.last_error ELSE excluded.last_error END, "
            "state=excluded.state",
            (source, now, now if ok else "", last_item_at,
             1 if ok else 0, 0 if ok else 1, error[:300],
             "ok" if ok else "error",
             1 if ok else 0, 1 if ok else 0, 0 if ok else 1, 1 if ok else 0))
        c.commit()


def bump(source: str, metric: str, n: int = 1, detail: str = "") -> None:
    """Counter for §43 instrumentation. Cheap, per-day, per-source."""
    if n <= 0:
        return
    _ensure_init()
    day = datetime.now(timezone.utc).date().isoformat()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "INSERT INTO news_ingest_stats (day, source, metric, detail, n) "
            "VALUES (?,?,?,?,?) ON CONFLICT(day, source, metric, detail) "
            "DO UPDATE SET n = news_ingest_stats.n + excluded.n",
            (day, source, metric, detail[:80], int(n)))
        c.commit()


def health_snapshot(days: int = 3) -> dict[str, Any]:
    _ensure_init()
    since = (datetime.now(timezone.utc).date() - timedelta(days=days)).isoformat()
    with contextlib.closing(_connect()) as c:
        health = [dict(r) for r in c.execute(
            "SELECT * FROM news_source_health ORDER BY source").fetchall()]
        stats = [dict(r) for r in c.execute(
            "SELECT day, source, metric, detail, n FROM news_ingest_stats "
            "WHERE day >= ? ORDER BY day DESC, source, metric, n DESC",
            (since,)).fetchall()]
        mix = [dict(r) for r in c.execute(
            "SELECT source_display, source_class, COUNT(*) n FROM news_items "
            "WHERE ingested_at >= ? GROUP BY source_display, source_class "
            "ORDER BY n DESC LIMIT 60", (since,)).fetchall()]
        total = c.execute("SELECT COUNT(*) n FROM news_items").fetchone()["n"]
        links = c.execute("SELECT COUNT(*) n FROM news_tickers").fetchone()["n"]
    return {"sources": health, "stats": stats, "publisher_mix": mix,
            "total_items": total, "total_links": links,
            "db_path": _DB_PATH, "newest": newest_published()}


# ---------------------------------------------------------------------------
# backfill state (§17)
# ---------------------------------------------------------------------------
def get_backfill(job: str) -> dict | None:
    _ensure_init()
    with contextlib.closing(_connect()) as c:
        r = c.execute("SELECT * FROM news_backfill_state WHERE job=?",
                      (job,)).fetchone()
        return dict(r) if r else None


def set_backfill(job: str, cursor: str, *, done: bool = False,
                 requests: int = 0, note: str = "") -> None:
    _ensure_init()
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            "INSERT INTO news_backfill_state (job, cursor, updated_at, done, requests, note) "
            "VALUES (?,?,?,?,?,?) ON CONFLICT(job) DO UPDATE SET "
            "cursor=excluded.cursor, updated_at=excluded.updated_at, "
            "done=excluded.done, requests=news_backfill_state.requests+excluded.requests, "
            "note=excluded.note",
            (job, cursor, _now(), 1 if done else 0, int(requests), note[:200]))
        c.commit()


def prune() -> dict[str, int]:
    """Retention sweep. Configurable per relevance class."""
    _ensure_init()
    out: dict[str, int] = {}
    now = datetime.now(timezone.utc)
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        rej_days = RETENTION_DAYS.get("reject")
        if rej_days:
            cut = _iso(now - timedelta(days=rej_days))
            n = c.execute("DELETE FROM news_items WHERE reject_reason<>'' "
                          "AND published_at < ?", (cut,)).rowcount
            out["reject"] = n or 0
        for level in ("unknown", "mention", "related"):
            days = RETENTION_DAYS.get(level)
            if not days:
                continue
            cut = _iso(now - timedelta(days=days))
            n = c.execute(
                "DELETE FROM news_items WHERE published_at < ? AND id NOT IN ("
                "  SELECT news_id FROM news_tickers WHERE relevance='direct')"
                " AND id IN (SELECT news_id FROM news_tickers WHERE relevance=?)",
                (cut, level)).rowcount
            out[level] = n or 0
        c.execute("DELETE FROM news_tickers WHERE news_id NOT IN "
                  "(SELECT id FROM news_items)")
        c.commit()
    return out
