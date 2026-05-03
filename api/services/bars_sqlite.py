"""Persistent SQLite OHLCV bar store — WAL mode, thread-local connections.

ts encoding:
  Intraday (1/5/15/30/60): unix seconds (integer)
  Daily / Weekly / Monthly: YYYYMMDD integer (e.g. 20240115)

First request for a ticker: full API fetch (~4-8 s), stored forever.
Every subsequent request: delta fetch of only new bars (<200 ms).
"""
import os
import sqlite3
import threading

_DB_PATH = os.path.join(os.environ.get("DATA_DIR", "/data"), "bars.db")
_local = threading.local()


def _conn() -> sqlite3.Connection:
    if getattr(_local, "conn", None) is None:
        c = sqlite3.connect(_DB_PATH, check_same_thread=False)
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        c.execute("PRAGMA cache_size=-8192")   # 8 MB page cache per connection
        c.execute("PRAGMA temp_store=MEMORY")
        _local.conn = c
    return _local.conn


def init_db() -> None:
    c = _conn()
    c.execute("""
        CREATE TABLE IF NOT EXISTS ohlcv (
            ticker TEXT NOT NULL,
            tf     TEXT NOT NULL,
            ts     INTEGER NOT NULL,
            o REAL, h REAL, l REAL, c REAL, v INTEGER,
            PRIMARY KEY (ticker, tf, ts)
        )
    """)
    c.execute(
        "CREATE INDEX IF NOT EXISTS idx_ohlcv_lookup ON ohlcv(ticker, tf, ts DESC)"
    )
    # ── One-time migration: purge tf='60' rows seeded before the
    # session-aligned hourly resample feature shipped (commit 2f42e55,
    # 2026-05-01). Pre-feature rows merged the 9:00 pre-market bar with
    # the 9:30 RTH-open bar into one 9:00 bucket, persisting incorrect
    # bars after the fix. Marker row records that the migration ran.
    c.execute("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at INTEGER)")
    already = c.execute("SELECT 1 FROM _migrations WHERE name=?", ("purge_tf60_2f42e55",)).fetchone()
    if not already:
        try:
            c.execute("DELETE FROM ohlcv WHERE tf='60'")
            c.execute("INSERT INTO _migrations(name, applied_at) VALUES (?, ?)",
                      ("purge_tf60_2f42e55", int(__import__('time').time())))
        except Exception:
            pass
    c.commit()


def delete_bars(ticker: str | None = None, tf: str | None = None) -> int:
    """Delete rows by (ticker, tf). Either may be None to wildcard.
    Returns rows deleted."""
    c = _conn()
    if ticker and tf:
        cur = c.execute("DELETE FROM ohlcv WHERE ticker=? AND tf=?", (ticker.upper(), tf))
    elif tf:
        cur = c.execute("DELETE FROM ohlcv WHERE tf=?", (tf,))
    elif ticker:
        cur = c.execute("DELETE FROM ohlcv WHERE ticker=?", (ticker.upper(),))
    else:
        cur = c.execute("DELETE FROM ohlcv")
    c.commit()
    return cur.rowcount


def get_last_ts(ticker: str, tf: str) -> int | None:
    """Return the largest stored ts for (ticker, tf), or None if no rows."""
    row = _conn().execute(
        "SELECT MAX(ts) FROM ohlcv WHERE ticker=? AND tf=?",
        (ticker.upper(), tf),
    ).fetchone()
    return row[0] if row and row[0] is not None else None


def get_count(ticker: str, tf: str) -> int:
    row = _conn().execute(
        "SELECT COUNT(*) FROM ohlcv WHERE ticker=? AND tf=?",
        (ticker.upper(), tf),
    ).fetchone()
    return row[0] if row else 0


def get_bars(ticker: str, tf: str, max_bars: int) -> list[tuple]:
    """Return up to max_bars rows as (ts, o, h, l, c, v), oldest-first."""
    return _conn().execute(
        """SELECT ts,o,h,l,c,v FROM (
               SELECT ts,o,h,l,c,v FROM ohlcv
               WHERE ticker=? AND tf=?
               ORDER BY ts DESC LIMIT ?
           ) ORDER BY ts ASC""",
        (ticker.upper(), tf, max_bars),
    ).fetchall()


def get_bars_since(ticker: str, tf: str, since_ts: int) -> list[tuple]:
    """Return bars with ts > since_ts, oldest-first (for browser delta sync)."""
    return _conn().execute(
        "SELECT ts,o,h,l,c,v FROM ohlcv WHERE ticker=? AND tf=? AND ts>? ORDER BY ts ASC",
        (ticker.upper(), tf, since_ts),
    ).fetchall()


def get_all_tickers() -> list[tuple]:
    """Return all (ticker, tf) pairs that have at least one row stored, ordered by ticker."""
    return _conn().execute(
        "SELECT DISTINCT ticker, tf FROM ohlcv ORDER BY ticker, tf"
    ).fetchall()


def put_bars(ticker: str, tf: str, bars: list[dict], date_tf: bool = False) -> int:
    """Upsert bars.  date_tf=True means bar["t"] is 'YYYY-MM-DD' → YYYYMMDD int.
    Returns number of rows inserted/replaced.
    """
    if not bars:
        return 0
    ticker = ticker.upper()
    rows = []
    for b in bars:
        t = b.get("t", 0)
        ts = int(str(t).replace("-", "")) if date_tf else int(t)
        rows.append((
            ticker, tf, ts,
            b.get("o"), b.get("h"), b.get("l"), b.get("c"),
            int(b.get("v") or 0),
        ))
    c = _conn()
    c.executemany(
        "INSERT OR REPLACE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)",
        rows,
    )
    c.commit()
    return len(rows)
