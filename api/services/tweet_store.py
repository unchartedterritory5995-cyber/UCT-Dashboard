"""SQLite-backed store for tweets, ticker links, curated accounts, and poll state.

DB path: /data/tweets.db (web service Railway volume).
WAL mode for concurrent reads during background polling.
"""
from __future__ import annotations

import contextlib
import os
import sqlite3
import threading
import time
from typing import Iterable, Optional

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
        c.commit()


# ---- writes ----------------------------------------------------------------

def upsert_tweet(tweet: dict, tickers: Iterable[str]) -> None:
    """Insert or update a tweet and its ticker links. Idempotent on tweet.id."""
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
            c.execute(
                "INSERT OR IGNORE INTO tweet_tickers (tweet_id, ticker) VALUES (?, ?)",
                (tweet["id"], t),
            )
        c.commit()


def delete_tweets_older_than(days: int) -> int:
    """Delete tweets older than N days. Cascades to tweet_tickers. Returns row count."""
    cutoff = int(time.time()) - days * 86400
    with _WRITE_LOCK, contextlib.closing(_connect()) as c:
        cur = c.execute("DELETE FROM tweets WHERE created_at < ?", (cutoff,))
        c.commit()
        return cur.rowcount


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


# ---- queries ---------------------------------------------------------------

def tweets_for_ticker(ticker: str, hours: int = 24) -> list[dict]:
    since = int(time.time()) - hours * 3600
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT t.* FROM tweets t
               JOIN tweet_tickers tt ON tt.tweet_id = t.id
               WHERE tt.ticker = ? AND t.created_at >= ?
               ORDER BY t.created_at DESC""",
            (ticker.upper(), since),
        ).fetchall()
        return [dict(r) for r in rows]


def tape(hours: int = 12, limit: int = 15) -> list[dict]:
    """Distinct tickers mentioned in window, newest-mention first.
    Does NOT exclude current movers — that join happens in the router."""
    since = int(time.time()) - hours * 3600
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT tt.ticker,
                      MAX(t.created_at) AS latest_at,
                      COUNT(*)          AS n_tweets
               FROM tweet_tickers tt
               JOIN tweets t ON t.id = tt.tweet_id
               WHERE t.created_at >= ?
               GROUP BY tt.ticker
               ORDER BY latest_at DESC
               LIMIT ?""",
            (since, limit),
        ).fetchall()
        result = []
        for r in rows:
            sample = c.execute(
                """SELECT t.* FROM tweets t
                   JOIN tweet_tickers tt ON tt.tweet_id = t.id
                   WHERE tt.ticker = ? AND t.created_at >= ?
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


def feed(hours: int = 12, limit: int = 50) -> list[dict]:
    """Raw tweets in the window, newest first, each with its joined tickers.

    Unlike ``tape`` (which groups by ticker), this returns a chronological
    stream suitable for a live "read the morning tape" feed.
    """
    since = int(time.time()) - hours * 3600
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            """SELECT * FROM tweets
               WHERE created_at >= ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (since, limit),
        ).fetchall()
        tweets = [dict(r) for r in rows]
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
        return tweets


def batch_counts(tickers: Iterable[str], hours: int = 24) -> dict[str, int]:
    """Count of tweets per ticker in window. Returns 0 for tickers with no tweets."""
    tickers = [t.upper() for t in tickers]
    if not tickers:
        return {}
    since = int(time.time()) - hours * 3600
    placeholders = ",".join("?" * len(tickers))
    out = {t: 0 for t in tickers}
    with contextlib.closing(_connect()) as c:
        rows = c.execute(
            f"""SELECT tt.ticker, COUNT(*) AS n
                FROM tweet_tickers tt
                JOIN tweets t ON t.id = tt.tweet_id
                WHERE tt.ticker IN ({placeholders}) AND t.created_at >= ?
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
