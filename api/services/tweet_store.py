"""SQLite-backed store for tweets, ticker links, curated accounts, and poll state.

DB path: /data/tweets.db (web service Railway volume).
WAL mode for concurrent reads during background polling.
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import sqlite3
import threading
import time
from typing import Iterable, Mapping, Optional

from api.services.a8_taxonomy import primary_mention_enabled

# Twitter image media URLs live on pbs.twimg.com/media/. Regex-scan the (possibly
# truncated) raw_json string directly — robust to the 8KB cap + shape changes.
_MEDIA_RE = re.compile(r'https://pbs\.twimg\.com/media/[A-Za-z0-9_\-]+(?:\.[A-Za-z]+)?(?:\?[^"\\\s]*)?')


def _extract_media(raw_json: Optional[str], limit: int = 4) -> list[str]:
    """Pull up to `limit` distinct image URLs out of a tweet's raw_json."""
    if not raw_json:
        return []
    seen: list[str] = []
    for m in _MEDIA_RE.findall(raw_json):
        # Normalize Twitter media to a reasonable display size.
        if "name=" not in m and "format=" not in m:
            m = m + ("&" if "?" in m else "?") + "format=jpg&name=small"
        if m not in seen:
            seen.append(m)
        if len(seen) >= limit:
            break
    return seen

_DB_PATH = os.environ.get("TWEET_DB_PATH", "/data/tweets.db")
_WRITE_LOCK = threading.Lock()  # serializes writes; reads stay lock-free under WAL


_SCHEMA = """
CREATE TABLE IF NOT EXISTS tweets (
  id              TEXT PRIMARY KEY,
  author_handle   TEXT NOT NULL,
  author_name     TEXT,
  text            TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  url             TEXT NOT NULL,
  reply_count     INTEGER DEFAULT 0,
  like_count      INTEGER DEFAULT 0,
  retweet_count   INTEGER DEFAULT 0,
  is_retweet      INTEGER DEFAULT 0,
  raw_json        TEXT,
  ingested_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tweets_created ON tweets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tweets_author  ON tweets(author_handle, created_at DESC);

CREATE TABLE IF NOT EXISTS tweet_tickers (
  tweet_id  TEXT NOT NULL,
  ticker    TEXT NOT NULL,
  PRIMARY KEY (tweet_id, ticker),
  FOREIGN KEY (tweet_id) REFERENCES tweets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_tt_ticker ON tweet_tickers(ticker);

CREATE TABLE IF NOT EXISTS twitter_accounts (
  handle           TEXT PRIMARY KEY,
  display_name     TEXT,
  added_at         INTEGER NOT NULL,
  added_by_user_id INTEGER,
  enabled          INTEGER DEFAULT 1,
  notes            TEXT
);

CREATE TABLE IF NOT EXISTS tweet_poll_state (
  handle             TEXT PRIMARY KEY,
  last_seen_tweet_id TEXT,
  last_poll_at       INTEGER,
  last_poll_status   TEXT,
  last_error         TEXT,
  total_tweets_seen  INTEGER DEFAULT 0,
  FOREIGN KEY (handle) REFERENCES twitter_accounts(handle) ON DELETE CASCADE
);

-- Roster-search cursor (tweet_poller search/shadow modes). One row per mode,
-- deliberately NOT in tweet_poll_state: that table's handle is a foreign key
-- to twitter_accounts, and a cursor is not an account.
CREATE TABLE IF NOT EXISTS tweet_search_state (
  key          TEXT PRIMARY KEY,
  since_id     TEXT,
  started_at   INTEGER,
  updated_at   INTEGER,
  last_status  TEXT,
  last_error   TEXT
);

-- Shadow comparison: when the roster search first saw each tweet. The timeline
-- side needs no column -- tweets.ingested_at already is its first-seen time.
CREATE TABLE IF NOT EXISTS tweet_search_shadow (
  id              TEXT PRIMARY KEY,
  author_handle   TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  search_seen_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tss_created ON tweet_search_shadow(created_at);
"""


def _connect() -> sqlite3.Connection:
    """Open a sqlite connection. Caller is responsible for closing — use
    ``with contextlib.closing(_connect()) as c:`` to ensure release.
    The bare ``with sqlite3.connect()`` form only commits, not closes."""
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_db() -> None:
    parent = os.path.dirname(_DB_PATH)
    if parent:
        os.makedirs(parent, exist_ok=True)
    with contextlib.closing(_connect()) as c:
        c.executescript(_SCHEMA)
        # Forward-compat: flag for "official" UCT accounts surfaced in The Desk's
        # Posts section (vs. the market-news tape). SQLite has no IF NOT EXISTS on
        # columns — try + swallow duplicate-column.
        try:
            c.execute("ALTER TABLE twitter_accounts ADD COLUMN is_official INTEGER DEFAULT 0")
        except sqlite3.OperationalError as e:
            if "duplicate column name" not in str(e).lower():
                raise
        # Account kind: 'news' (headline wire) or 'commentary' (a trader's takes).
        # Powers the Notebook tweet-import Headlines filter. DEFAULT reads every
        # existing account as commentary.
        try:
            c.execute("ALTER TABLE twitter_accounts ADD COLUMN content_kind TEXT NOT NULL DEFAULT 'commentary'")
        except sqlite3.OperationalError as e:
            if "duplicate column name" not in str(e).lower():
                raise
        # TERM-075 (FB-A8-01): the primary-vs-mentioned bit on the story-to-ticker
        # join. ADDITIVE — DEFAULT 1 reads every existing row as a subject, which
        # is exactly today's behaviour. Nothing is rewritten.
        try:
            c.execute("ALTER TABLE tweet_tickers ADD COLUMN is_primary INTEGER NOT NULL DEFAULT 1")
        except sqlite3.OperationalError as e:
            if "duplicate column name" not in str(e).lower():
                raise
        c.commit()


def _subject_clause() -> str:
    """The extra predicate a SUBJECT count adds on `tweet_tickers tt`.

    Empty while `A8_PRIMARY_MENTION_ENABLED` is off, so every query is the exact
    text it was before the column existed. On, a mention-only link stops counting
    as the story being about that ticker. Read per call — never at import."""
    return " AND tt.is_primary = 1" if primary_mention_enabled() else ""


# ---- writes ----------------------------------------------------------------

def upsert_tweet(tweet: dict, tickers: Iterable[str],
                 primary: Optional[Mapping[str, bool]] = None) -> None:
    """Insert or update a tweet and its ticker links. Idempotent on tweet.id.

    ``primary`` is the A8 resolver's {ticker: is-the-subject} answer. Omitted (or
    a ticker missing from it) writes the column default — every link primary,
    today's behaviour. Links already stored are never rewritten."""
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """
            INSERT INTO tweets (id, author_handle, author_name, text, created_at, url,
                                reply_count, like_count, retweet_count, is_retweet,
                                raw_json, ingested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              reply_count = excluded.reply_count,
              like_count = excluded.like_count,
              retweet_count = excluded.retweet_count
            """,
            (
                tweet["id"], tweet["author_handle"], tweet.get("author_name"),
                tweet["text"], tweet["created_at"], tweet["url"],
                tweet.get("reply_count", 0), tweet.get("like_count", 0),
                tweet.get("retweet_count", 0), tweet.get("is_retweet", 0),
                tweet.get("raw_json", "{}"), now,
            ),
        )
        for t in set(tickers):
            if primary is None or t not in primary:
                c.execute(
                    "INSERT OR IGNORE INTO tweet_tickers (tweet_id, ticker) VALUES (?, ?)",
                    (tweet["id"], t),
                )
            else:
                c.execute(
                    "INSERT OR IGNORE INTO tweet_tickers (tweet_id, ticker, is_primary) VALUES (?, ?, ?)",
                    (tweet["id"], t, 1 if primary[t] else 0),
                )
        c.commit()


def delete_tweets_older_than(days: int) -> int:
    """Delete tweets older than N days. Cascades to tweet_tickers. Returns row count."""
    cutoff = int(time.time()) - days * 86400
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM tweets WHERE created_at < ?", (cutoff,))
        c.commit()
        return cur.rowcount


def delete_tweets_by_ids(ids: list[str]) -> int:
    """Delete specific tweets by id. Cascades to tweet_tickers. Returns row
    count. Mirrors delete_tweets_older_than's shape (same _WRITE_LOCK +
    contextlib.closing pattern) — used by the X deletion-sync (PACKET-S CP4,
    RG-21 §1d) to remove tweets TwitterAPI.io reports as no longer resolving,
    independent of the age-based sweep above."""
    ids = [str(i) for i in ids if i]
    if not ids:
        return 0
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        placeholders = ",".join("?" * len(ids))
        cur = c.execute(f"DELETE FROM tweets WHERE id IN ({placeholders})", ids)
        c.commit()
        return cur.rowcount


def oldest_tweet_ids(limit: int, exclude: Iterable[str] = ()) -> list[str]:
    """The oldest stored tweet ids, leaving out `exclude`. The oldest because the deletion sync has
    had the longest to drop any that left X."""
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            "SELECT id FROM tweets WHERE id NOT IN (SELECT value FROM json_each(?))"
            " ORDER BY created_at, id LIMIT ?",
            (json.dumps([str(i) for i in exclude]), limit)).fetchall()
    return [row[0] for row in rows]


# ---- account CRUD ----------------------------------------------------------

# Curated FinTwit accounts seeded idempotently on startup. INSERT OR IGNORE
# means an admin who later disables/edits one of these is NOT clobbered.
DEFAULT_ACCOUNTS = [
    ("DeItaone", "Walter Bloomberg"),
    ("FinancialJuice", "FinancialJuice"),
    ("Benzinga", "Benzinga"),
    ("WallStEngine", "Wall St Engine"),
    ("FirstSquawk", "First Squawk"),
    ("LiveSquawk", "LiveSquawk"),
    ("StockMKTNewz", "Evan @ StockMarketNewz"),
    ("unusual_whales", "unusual whales"),
    ("Stocktwits", "Stocktwits"),
    ("TheTranscript_", "The Transcript"),
]


def ensure_default_accounts() -> int:
    """Idempotently seed the curated FinTwit accounts. INSERT OR IGNORE means
    accounts an admin later disabled/edited are NOT clobbered. Returns count
    seeded/attempted. Never raises."""
    n = 0
    for handle, display in DEFAULT_ACCOUNTS:
        try:
            add_account(handle, display_name=display, notes="default-seed")
            n += 1
        except Exception:
            pass
    return n


# The firm's OWN accounts — seeded + flagged is_official so they surface in The
# Desk's Posts section (separate from the market-news tape). Idempotent.
OFFICIAL_ACCOUNTS = [
    ("TSDR_Trading", "TSDR Trading"),
    ("Braczyy", "Bracco"),
    ("1ChartMaster", "Elite Swing Traders"),
]


def ensure_official_accounts() -> None:
    """Idempotently seed + flag the firm's own accounts as official. add_account
    is INSERT OR IGNORE (won't clobber edits); then mark official. Never raises."""
    for handle, display in OFFICIAL_ACCOUNTS:
        try:
            add_account(handle, display_name=display, notes="official-seed")
            set_account_official(handle, True)
        except Exception:
            pass


def add_account(handle: str, display_name: Optional[str] = None,
                added_by_user_id: Optional[int] = None, notes: Optional[str] = None) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT OR IGNORE INTO twitter_accounts
               (handle, display_name, added_at, added_by_user_id, enabled, notes)
               VALUES (?, ?, ?, ?, 1, ?)""",
            (handle, display_name, int(time.time()), added_by_user_id, notes),
        )
        c.commit()


def set_account_enabled(handle: str, enabled: bool) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE twitter_accounts SET enabled=? WHERE handle=?",
                  (1 if enabled else 0, handle))
        c.commit()


def update_account_notes(handle: str, notes: str) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE twitter_accounts SET notes=? WHERE handle=?", (notes, handle))
        c.commit()


def set_account_official(handle: str, official: bool) -> None:
    """Flag/unflag an account as an official UCT account (Desk → Posts section)."""
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE twitter_accounts SET is_official=? WHERE handle=?",
                  (1 if official else 0, handle))
        c.commit()


CONTENT_KINDS = ("news", "commentary")


def set_account_content_kind(handle: str, kind: str) -> None:
    """Mark an account as 'news' or 'commentary'. Raises ValueError otherwise."""
    if kind not in CONTENT_KINDS:
        raise ValueError(f"content_kind must be one of {CONTENT_KINDS}, got {kind!r}")
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute("UPDATE twitter_accounts SET content_kind=? WHERE handle=?",
                  (kind, handle))
        c.commit()


def list_accounts(enabled_only: bool = False) -> list[dict]:
    sql = "SELECT * FROM twitter_accounts"
    if enabled_only:
        sql += " WHERE enabled=1"
    sql += " ORDER BY handle"
    with contextlib.closing(_connect()) as c:
        return [dict(r) for r in c.execute(sql).fetchall()]


# ---- poll state ------------------------------------------------------------

def update_poll_state(handle: str, *, last_seen_tweet_id: Optional[str] = None,
                      status: str, error: Optional[str] = None,
                      tweets_seen: int = 0) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO tweet_poll_state
               (handle, last_seen_tweet_id, last_poll_at, last_poll_status,
                last_error, total_tweets_seen)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(handle) DO UPDATE SET
                 last_seen_tweet_id = COALESCE(excluded.last_seen_tweet_id, last_seen_tweet_id),
                 last_poll_at = excluded.last_poll_at,
                 last_poll_status = excluded.last_poll_status,
                 last_error = excluded.last_error,
                 total_tweets_seen = total_tweets_seen + excluded.total_tweets_seen
            """,
            (handle, last_seen_tweet_id, int(time.time()), status, error, tweets_seen),
        )
        c.commit()


def get_poll_state(handle: str) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM tweet_poll_state WHERE handle=?", (handle,)).fetchone()
        return dict(row) if row else None


# ---- roster-search cursor + shadow log ---------------------------------------

def get_search_state(key: str) -> Optional[dict]:
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM tweet_search_state WHERE key=?", (key,)).fetchone()
        return dict(row) if row else None


def update_search_state(key: str, *, status: str, since_id: Optional[str] = None,
                        error: Optional[str] = None) -> None:
    """since_id=None keeps the stored cursor (a failed poll never moves it)."""
    now = int(time.time())
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        c.execute(
            """INSERT INTO tweet_search_state
               (key, since_id, started_at, updated_at, last_status, last_error)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET
                 since_id = COALESCE(excluded.since_id, since_id),
                 updated_at = excluded.updated_at,
                 last_status = excluded.last_status,
                 last_error = excluded.last_error
            """,
            (key, since_id, now, now, status, error),
        )
        c.commit()


def record_shadow_seen(tweets: Iterable[dict]) -> int:
    """First time the roster search saw each tweet. Never overwrites."""
    now = int(time.time())
    rows = [(t["id"], t.get("author_handle") or "", int(t.get("created_at") or 0), now)
            for t in tweets if t.get("id")]
    if not rows:
        return 0
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.executemany(
            "INSERT OR IGNORE INTO tweet_search_shadow "
            "(id, author_handle, created_at, search_seen_at) VALUES (?, ?, ?, ?)",
            rows,
        )
        c.commit()
        return cur.rowcount


def shadow_report(since_unix: int, settle_seconds: int = 300) -> dict:
    """Compare the timeline poller (tweets.ingested_at) with the roster search
    (tweet_search_shadow.search_seen_at) for tweets CREATED in
    [since_unix, now - settle_seconds], enabled accounts only.

    The settle margin keeps a tweet posted seconds ago, which one side may
    simply not have polled for yet, out of both 'only' buckets. Handles compare
    case-insensitively: the roster stores what an admin typed, the API returns
    the account's canonical casing."""
    until = int(time.time()) - settle_seconds
    with contextlib.closing(_connect()) as c:
        enabled = {r["handle"].lower() for r in
                   c.execute("SELECT handle FROM twitter_accounts WHERE enabled=1")}
        tl = {r["id"]: (r["author_handle"], r["ingested_at"]) for r in c.execute(
            "SELECT id, author_handle, ingested_at FROM tweets "
            "WHERE created_at BETWEEN ? AND ?", (since_unix, until))}
        sh = {r["id"]: (r["author_handle"], r["search_seen_at"]) for r in c.execute(
            "SELECT id, author_handle, search_seen_at FROM tweet_search_shadow "
            "WHERE created_at BETWEEN ? AND ?", (since_unix, until))}
    tl = {k: v for k, v in tl.items() if (v[0] or "").lower() in enabled}
    sh = {k: v for k, v in sh.items() if (v[0] or "").lower() in enabled}
    both = tl.keys() & sh.keys()
    only_tl = sorted(tl.keys() - sh.keys())
    only_sh = sorted(sh.keys() - tl.keys())
    # Positive lead = the search saw it first, by that many seconds.
    leads = sorted(tl[i][1] - sh[i][1] for i in both)

    def pct(p):
        return leads[min(len(leads) - 1, int(p * len(leads)))] if leads else None

    by_handle: dict[str, dict] = {}
    for i in only_tl:
        by_handle.setdefault(tl[i][0], {"only_timeline": 0, "only_search": 0})["only_timeline"] += 1
    for i in only_sh:
        by_handle.setdefault(sh[i][0], {"only_timeline": 0, "only_search": 0})["only_search"] += 1
    return {
        "window": {"from": since_unix, "to": until},
        "both": len(both),
        "only_timeline": len(only_tl),
        "only_search": len(only_sh),
        "only_timeline_ids": only_tl[:50],
        "only_search_ids": only_sh[:50],
        "by_handle": by_handle,
        "search_lead_seconds": {"p10": pct(0.10), "median": pct(0.50), "p90": pct(0.90),
                                "n": len(leads)},
    }


def delete_shadow_older_than(days: int) -> int:
    cutoff = int(time.time()) - days * 86400
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM tweet_search_shadow WHERE created_at < ?", (cutoff,))
        c.commit()
        return cur.rowcount


# ---- queries ---------------------------------------------------------------

def tweets_for_ticker(ticker: str, hours: int = 24) -> list[dict]:
    since = int(time.time()) - hours * 3600
    subject = _subject_clause()
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            f"""SELECT t.* FROM tweets t
               JOIN tweet_tickers tt ON tt.tweet_id = t.id
               WHERE tt.ticker = ? AND t.created_at >= ?{subject}
               ORDER BY t.created_at DESC""",
            (ticker.upper(), since),
        ).fetchall()
        return [dict(r) for r in rows]


def tape(hours: int = 12, limit: int = 15) -> list[dict]:
    """Distinct tickers mentioned in window, newest-mention first.
    Does NOT exclude current movers — that join happens in the router."""
    since = int(time.time()) - hours * 3600
    subject = _subject_clause()
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            f"""SELECT tt.ticker,
                      MAX(t.created_at) AS latest_at,
                      COUNT(*)          AS n_tweets
               FROM tweet_tickers tt
               JOIN tweets t ON t.id = tt.tweet_id
               WHERE t.created_at >= ?{subject}
               GROUP BY tt.ticker
               ORDER BY latest_at DESC
               LIMIT ?""",
            (since, limit),
        ).fetchall()
        result = []
        for r in rows:
            sample = c.execute(
                f"""SELECT t.* FROM tweets t
                   JOIN tweet_tickers tt ON tt.tweet_id = t.id
                   WHERE tt.ticker = ? AND t.created_at >= ?{subject}
                   ORDER BY t.created_at DESC LIMIT 1""",
                (r["ticker"], since),
            ).fetchone()
            result.append({
                "ticker": r["ticker"],
                "latest_at": r["latest_at"],
                "n_tweets": r["n_tweets"],
                "sample_tweet": dict(sample) if sample else None,
            })
        return result


def feed(hours: int = 12, limit: int = 50, official_only: bool = False) -> list[dict]:
    """Raw tweets in the window, newest first, each with its joined tickers.

    Unlike ``tape`` (which groups by ticker), this returns a chronological
    stream suitable for a live "read the morning tape" feed. When
    ``official_only`` is set, restricts to authors flagged is_official=1
    (case-insensitive handle match) — powers The Desk's Posts section.
    """
    since = int(time.time()) - hours * 3600
    with contextlib.closing(_connect()) as c:
        if official_only:
            rows = c.execute(
                """SELECT t.* FROM tweets t
                   JOIN twitter_accounts a
                     ON LOWER(a.handle) = LOWER(t.author_handle)
                   WHERE t.created_at >= ? AND a.is_official = 1
                   ORDER BY t.created_at DESC
                   LIMIT ?""",
                (since, limit),
            ).fetchall()
        else:
            rows = c.execute(
                """SELECT * FROM tweets
                   WHERE created_at >= ?
                   ORDER BY created_at DESC
                   LIMIT ?""",
                (since, limit),
            ).fetchall()
        return _attach_links(c, [dict(r) for r in rows])


def _attach_links(c: sqlite3.Connection, tweets: list[dict]) -> list[dict]:
    """Add `tickers` (joined) and `media` (from raw_json) to each row, in place."""
    if tweets:
        ids = [t["id"] for t in tweets]
        placeholders = ",".join("?" * len(ids))
        links = c.execute(
            f"""SELECT tweet_id, ticker FROM tweet_tickers
                WHERE tweet_id IN ({placeholders})""",
            ids,
        ).fetchall()
        by_id: dict[str, list[str]] = {}
        for lr in links:
            by_id.setdefault(lr["tweet_id"], []).append(lr["ticker"])
        for t in tweets:
            t["tickers"] = by_id.get(t["id"], [])
            t["media"] = _extract_media(t.get("raw_json"))
    return tweets


def with_links(tweets: list[dict]) -> list[dict]:
    """`tweets` (rows from `tweets_for_ticker`, say) with `tickers` and `media`
    attached the way `feed` does. Read-only; the input rows are not mutated."""
    rows = [dict(t) for t in tweets]
    if not rows:
        return rows
    with contextlib.closing(_connect()) as c:
        return _attach_links(c, rows)


def get_tweet(tweet_id: str) -> Optional[dict]:
    """One stored tweet by its id, with `tickers` and `media`, or None."""
    with contextlib.closing(_connect()) as c:
        row = c.execute("SELECT * FROM tweets WHERE id = ?", (str(tweet_id),)).fetchone()
        if row is None:
            return None
        return _attach_links(c, [dict(row)])[0]


def batch_counts(tickers: Iterable[str], hours: int = 24) -> dict[str, int]:
    """Count of tweets per ticker in window. Returns 0 for tickers with no tweets."""
    tickers = [t.upper() for t in tickers]
    if not tickers:
        return {}
    since = int(time.time()) - hours * 3600
    placeholders = ",".join("?" * len(tickers))
    subject = _subject_clause()
    out = {t: 0 for t in tickers}
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            f"""SELECT tt.ticker, COUNT(*) AS n
                FROM tweet_tickers tt
                JOIN tweets t ON t.id = tt.tweet_id
                WHERE tt.ticker IN ({placeholders}) AND t.created_at >= ?{subject}
                GROUP BY tt.ticker""",
            (*tickers, since),
        ).fetchall()
        for r in rows:
            out[r["ticker"]] = r["n"]
    return out


# ---- diagnostic helpers (used by tests + admin stats) ----------------------

def count_tweets() -> int:
    with contextlib.closing(_connect()) as c:
        return c.execute("SELECT COUNT(*) FROM tweets").fetchone()[0]


def count_ticker_links() -> int:
    with contextlib.closing(_connect()) as c:
        return c.execute("SELECT COUNT(*) FROM tweet_tickers").fetchone()[0]
