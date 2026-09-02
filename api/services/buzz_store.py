"""Ticker-mention counts for #main-chat, one row per (message x ticker).

Deliberately stores NO message text. `message_id` + `channel_id` reconstruct a
Discord jump link, which stays true when a member edits or deletes; a stored
copy would not. The composite primary key makes re-ingesting an overlapping
window a no-op, so a retry can never double-count.
"""
from __future__ import annotations

import os
import sqlite3
import threading

DISCORD_EPOCH_MS = 1420070400000

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None
_conn_path: str | None = None


def db_path() -> str:
    return os.environ.get("BUZZ_DB_PATH", "/data/buzz.db")


def _reset_for_tests() -> None:
    """Drop the cached handle so a test's BUZZ_DB_PATH takes effect."""
    global _conn, _conn_path
    with _lock:
        if _conn is not None:
            _conn.close()
        _conn = None
        _conn_path = None


def connect() -> sqlite3.Connection:
    global _conn, _conn_path
    path = db_path()
    with _lock:
        if _conn is None or _conn_path != path:
            if _conn is not None:
                _conn.close()
            parent = os.path.dirname(path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            _conn = sqlite3.connect(path, check_same_thread=False, timeout=5.0)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn_path = path
        return _conn


def init_db(path: str | None = None) -> None:
    if path:
        os.environ["BUZZ_DB_PATH"] = path
        _reset_for_tests()
    c = connect()
    c.executescript(
        """
        CREATE TABLE IF NOT EXISTS mentions (
          message_id  TEXT    NOT NULL,
          channel_id  TEXT    NOT NULL,
          author_id   TEXT    NOT NULL,
          ticker      TEXT    NOT NULL,
          ts          INTEGER NOT NULL,
          confidence  TEXT    NOT NULL,
          PRIMARY KEY (message_id, ticker)
        );
        CREATE INDEX IF NOT EXISTS idx_mentions_ticker_ts ON mentions(ticker, ts);
        CREATE INDEX IF NOT EXISTS idx_mentions_ts        ON mentions(ts);
        CREATE TABLE IF NOT EXISTS ingest_state (
          channel_id      TEXT PRIMARY KEY,
          last_message_id TEXT    NOT NULL,
          updated_at      INTEGER NOT NULL
        );
        """
    )
    c.commit()


def snowflake_ts(sid: str) -> int:
    """Unix SECONDS for a Discord snowflake."""
    return ((int(sid) >> 22) + DISCORD_EPOCH_MS) // 1000


def record_mentions(rows) -> int:
    rows = list(rows)
    if not rows:
        return 0
    c = connect()
    before = c.total_changes
    c.executemany(
        "INSERT OR IGNORE INTO mentions "
        "(message_id, channel_id, author_id, ticker, ts, confidence) VALUES (?,?,?,?,?,?)",
        rows,
    )
    c.commit()
    return c.total_changes - before


def get_cursor(channel_id: str) -> str | None:
    r = connect().execute(
        "SELECT last_message_id FROM ingest_state WHERE channel_id=?", (channel_id,)
    ).fetchone()
    return r["last_message_id"] if r else None


def set_cursor(channel_id: str, message_id: str) -> None:
    import time
    c = connect()
    c.execute(
        "INSERT INTO ingest_state (channel_id, last_message_id, updated_at) VALUES (?,?,?) "
        "ON CONFLICT(channel_id) DO UPDATE SET last_message_id=excluded.last_message_id, "
        "updated_at=excluded.updated_at",
        (channel_id, str(message_id), int(time.time())),
    )
    c.commit()


# ── The BACKWARD watermark, distinct from the forward cursor above.
#
# `last_message_id` is how far FORWARD the poller has read. This is how far
# BACK the backfill has walked, and the two must not share a row: the poller
# advances one every minute, the backfill the other only during a manual run.
#
# It lives in the same table under a suffixed key rather than in a new column,
# so no migration is needed on a volume that already holds a live table. The
# suffix cannot collide with a real channel id — Discord snowflakes are digits
# only, and `_BACKFILL_SUFFIX` is not.
#
# ⛔ It exists because `backfill` used to restart from the NEWEST message on
# every run. On a channel doing ~1,100 messages a day, one rate limit at page
# 11 capped the walk at about 14 hours of history, and every re-run re-walked
# the same pages and stopped in the same place. The tool told the operator
# "re-run to continue"; re-running could not continue. Measured on #main-chat:
# five consecutive runs, four of them adding zero new mentions.
_BACKFILL_SUFFIX = ":backfill"


def get_backfill_mark(channel_id: str) -> str | None:
    """Oldest message id this channel's backfill has reached, if any."""
    return get_cursor(channel_id + _BACKFILL_SUFFIX)


def set_backfill_mark(channel_id: str, message_id: str) -> None:
    """Record how far back the walk got. ⛔ Call this only AFTER the page's rows
    are committed — same ordering rule as the forward cursor. A mark written
    before the write would skip a page permanently on a crash."""
    set_cursor(channel_id + _BACKFILL_SUFFIX, message_id)


def clear_backfill_mark(channel_id: str) -> None:
    c = connect()
    c.execute("DELETE FROM ingest_state WHERE channel_id=?", (channel_id + _BACKFILL_SUFFIX,))
    c.commit()


def _chan_clause(channels):
    if not channels:
        return "", []
    return " AND channel_id IN (%s)" % ",".join("?" * len(channels)), list(channels)


def board(start_ts: int, end_ts: int, channels, limit: int = 10) -> list[dict]:
    cl, params = _chan_clause(channels)
    sql = (
        "SELECT ticker, COUNT(DISTINCT author_id) AS people, COUNT(*) AS mentions "
        "FROM mentions WHERE ts >= ? AND ts < ?" + cl +
        " GROUP BY ticker ORDER BY people DESC, mentions DESC, ticker ASC LIMIT ?"
    )
    rows = connect().execute(sql, [start_ts, end_ts, *params, limit]).fetchall()
    return [{"ticker": r["ticker"], "people": r["people"], "mentions": r["mentions"]} for r in rows]


def count(ticker: str, start_ts: int, end_ts: int, channels) -> int:
    cl, params = _chan_clause(channels)
    sql = "SELECT COUNT(*) AS n FROM mentions WHERE ticker=? AND ts >= ? AND ts < ?" + cl
    return connect().execute(sql, [ticker, start_ts, end_ts, *params]).fetchone()["n"]


def total_in(start_ts: int, end_ts: int, channels) -> int:
    """Every mention in the window, all tickers. Used to ask whether the ROOM
    was active in a past session -- a market holiday and a session that
    predates the store both look like "0 mentions" for any single ticker, and
    counting either as a real zero drags a heat baseline toward zero."""
    cl, params = _chan_clause(channels)
    sql = "SELECT COUNT(*) AS n FROM mentions WHERE ts >= ? AND ts < ?" + cl
    return connect().execute(sql, [start_ts, end_ts, *params]).fetchone()["n"]


def series(ticker: str, start_ts: int, end_ts: int, buckets: int, channels) -> list[int]:
    out = [0] * buckets
    if end_ts <= start_ts or buckets <= 0:
        return out
    cl, params = _chan_clause(channels)
    sql = "SELECT ts FROM mentions WHERE ticker=? AND ts >= ? AND ts < ?" + cl
    for r in connect().execute(sql, [ticker, start_ts, end_ts, *params]):
        i = min(buckets - 1, ((r["ts"] - start_ts) * buckets) // (end_ts - start_ts))
        out[i] += 1
    return out


def known_tickers(prefix: str, limit: int = 25) -> list[tuple[str, int]]:
    p = (prefix or "").upper()
    rows = connect().execute(
        "SELECT ticker, COUNT(*) AS n FROM mentions WHERE ticker LIKE ? "
        "GROUP BY ticker ORDER BY n DESC, ticker ASC LIMIT ?",
        (p + "%", limit),
    ).fetchall()
    return [(r["ticker"], r["n"]) for r in rows]


def latest_ts(channels) -> int | None:
    cl, params = _chan_clause(channels)
    r = connect().execute(
        "SELECT MAX(ts) AS t FROM mentions WHERE 1=1" + cl, params
    ).fetchone()
    return r["t"] if r and r["t"] is not None else None
