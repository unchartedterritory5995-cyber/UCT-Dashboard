"""api/services/breadth_intraday.py — the shape of the session, not just its end.

`breadth_live` answers "where is breadth right now". This answers the question
that follows it: "and how did it get there today". A reading of 65% above the
50-day means one thing if it opened at 71 and another if it opened at 58, and
the daily row can never carry that — by the time it exists the session is over.

WHY A SEPARATE DATABASE
    `breadth_snapshots` holds the permanent daily series and the collector is
    its only writer. Provisional samples must not be able to reach it even by
    accident: that is the NAAIM failure, where a placeholder indistinguishable
    from a reading sat in permanent history for 93 sessions. A different file
    with a different schema makes the mistake unavailable rather than unlikely.

WHY THE WRITE IS SAFE ON THE REQUEST PATH
    `compute_live` is cached ~55s, so a sample lands at most once a minute no
    matter how many people are watching, and `record()` enforces its own
    minimum interval so a `force=1` refresh cannot turn into a write loop.
    Every entry point swallows its own errors: a store that cannot write must
    still let the live read through.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Optional

# One sample a minute is finer than the data moves and still only ~390 rows a
# session. Tighter would be noise; looser would miss the open.
MIN_SAMPLE_SECONDS = 55

# A week keeps "how did today compare with Monday" answerable without the file
# ever becoming something anyone has to think about.
RETENTION_DAYS = 7

# What a surface actually plots. Storing everything and serving a subset means a
# new chart can be added later without having lost the history to draw it.
PATH_METRICS = (
    "breadth_score",
    "pct_above_50sma",
    "pct_above_20ema",
    "adv_decline",
    "up_4pct_today",
    "down_4pct_today",
    "new_52w_highs",
)

_lock = threading.Lock()
_last_prune = 0.0

# Health. `record()` swallows its errors on purpose — the live read is the
# product and must survive a broken store — but swallowed silently for a whole
# session is how you find out at 4pm that no path was ever written. These make
# the failure VISIBLE without making it fatal.
_health = {"last_write_at": None, "last_error": None, "consecutive_failures": 0,
           "writes": 0}


def _db_path() -> str:
    override = os.environ.get("BREADTH_INTRADAY_DB")
    if override:
        return override
    if os.path.exists("/data"):
        return "/data/breadth_intraday.db"
    local = Path(__file__).parent.parent.parent / "data" / "breadth_intraday.db"
    local.parent.mkdir(exist_ok=True)
    return str(local)


_schema_ready = False


def _conn() -> sqlite3.Connection:
    global _schema_ready
    c = sqlite3.connect(_db_path(), timeout=5)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA synchronous=NORMAL")
    c.execute("PRAGMA busy_timeout=2000")
    if not _schema_ready:
        # Lazy rather than at import: this store is optional, and a missing
        # table must not be able to break the live read that owns the request.
        _init_schema(c)
        _schema_ready = True
    return c


def _init_schema(c: sqlite3.Connection) -> None:
    c.execute("""
            CREATE TABLE IF NOT EXISTS breadth_intraday (
                session_date TEXT    NOT NULL,
                as_of        INTEGER NOT NULL,   -- unix seconds, UTC
                metrics      TEXT    NOT NULL,   -- JSON, the anchored values
                PRIMARY KEY (session_date, as_of)
            )
        """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_intraday_session "
              "ON breadth_intraday(session_date, as_of)")
    c.commit()


def _last_sample_at(c: sqlite3.Connection, session_date: str) -> Optional[int]:
    row = c.execute(
        "SELECT MAX(as_of) FROM breadth_intraday WHERE session_date = ?",
        (session_date,),
    ).fetchone()
    return int(row[0]) if row and row[0] else None


def record(session_date: str, metrics: dict, now: Optional[float] = None) -> bool:
    """Store one sample. Returns True if it was written.

    Never raises: the live read is the product, this is a record of it.
    """
    if not session_date or not metrics:
        return False
    ts = int(now if now is not None else time.time())
    try:
        with _lock, _conn() as c:
            last = _last_sample_at(c, session_date)
            if last is not None and ts - last < MIN_SAMPLE_SECONDS:
                return False
            keep = {k: v for k, v in metrics.items()
                    if not k.startswith("_") and v is not None}
            c.execute(
                "INSERT OR REPLACE INTO breadth_intraday "
                "(session_date, as_of, metrics) VALUES (?, ?, ?)",
                (session_date, ts, json.dumps(keep)),
            )
            c.commit()
        _health["last_write_at"] = ts
        _health["consecutive_failures"] = 0
        _health["last_error"] = None
        _health["writes"] += 1
        _maybe_prune(ts)
        return True
    except Exception as e:
        _health["consecutive_failures"] += 1
        _health["last_error"] = f"{type(e).__name__}: {e}"
        print(f"[breadth_intraday] record failed: {e}")
        return False


def _maybe_prune(now_ts: int) -> None:
    """Drop sessions past the retention window, at most once an hour."""
    global _last_prune
    if now_ts - _last_prune < 3600:
        return
    _last_prune = now_ts
    try:
        cutoff = time.strftime("%Y-%m-%d",
                               time.gmtime(now_ts - RETENTION_DAYS * 86400))
        with _conn() as c:
            c.execute("DELETE FROM breadth_intraday WHERE session_date < ?", (cutoff,))
            c.commit()
    except Exception as e:
        print(f"[breadth_intraday] prune failed: {e}")


def _downsample(points: list, limit: int) -> list:
    """Thin evenly, ALWAYS keeping the first and last points.

    The open and the current reading are the two the eye actually uses — a
    naive stride can drop either, which would make the sparkline disagree with
    the number printed beside it.
    """
    if limit <= 2 or len(points) <= limit:
        return points
    step = (len(points) - 1) / (limit - 1)
    idx = sorted({0, *(round(i * step) for i in range(limit)), len(points) - 1})
    return [points[i] for i in idx if i < len(points)]


def session_path(session_date: str, metrics=PATH_METRICS,
                 limit: int = 60) -> dict[str, list]:
    """`{metric: [[epoch_seconds, value], ...]}` for one session, oldest first."""
    if not session_date:
        return {}
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT as_of, metrics FROM breadth_intraday "
                "WHERE session_date = ? ORDER BY as_of",
                (session_date,),
            ).fetchall()
    except Exception as e:
        print(f"[breadth_intraday] read failed: {e}")
        return {}

    series: dict[str, list] = {k: [] for k in metrics}
    for r in rows:
        try:
            m = json.loads(r["metrics"])
        except Exception:
            continue
        for k in metrics:
            v = m.get(k)
            if v is not None:
                series[k].append([int(r["as_of"]), v])
    return {k: _downsample(v, limit) for k, v in series.items() if v}


def session_open(session_date: str, metrics=PATH_METRICS) -> dict:
    """The FIRST sample of the session, per metric.

    "Up 6 points since the open" is the reading a trader actually wants, and it
    is only honest if the baseline is the earliest sample we really took — not
    yesterday's close, which is a different measurement entirely.
    """
    path = session_path(session_date, metrics, limit=0) or {}
    return {k: v[0][1] for k, v in path.items() if v}


def health() -> dict:
    """Is the store actually writing? Cheap enough for every live payload.

    `ok` is False only once a write has genuinely failed — a store that has not
    been asked to write yet (pre-open, or after the collector has taken over)
    is not unhealthy, it is idle.
    """
    return {
        "ok": _health["consecutive_failures"] == 0,
        "writes": _health["writes"],
        "last_write_at": _health["last_write_at"],
        "consecutive_failures": _health["consecutive_failures"],
        "last_error": _health["last_error"],
    }


def self_test() -> dict:
    """Prove the volume is writable, without waiting for a session to prove it.

    Writes a probe under a sentinel session date, reads it back, removes it.
    Lets "can this pod persist an intraday sample?" be answered the evening
    before rather than at 09:31 with everyone watching.
    """
    probe_date = "__selftest__"
    try:
        with _conn() as c:
            c.execute("INSERT OR REPLACE INTO breadth_intraday "
                      "(session_date, as_of, metrics) VALUES (?, ?, ?)",
                      (probe_date, 1, json.dumps({"probe": 1})))
            c.commit()
            back = c.execute("SELECT metrics FROM breadth_intraday "
                             "WHERE session_date = ?", (probe_date,)).fetchone()
            c.execute("DELETE FROM breadth_intraday WHERE session_date = ?", (probe_date,))
            c.commit()
        ok = bool(back) and json.loads(back["metrics"]).get("probe") == 1
        return {"writable": ok, "db": _db_path(),
                "error": None if ok else "probe did not read back"}
    except Exception as e:
        return {"writable": False, "db": _db_path(), "error": f"{type(e).__name__}: {e}"}


def status() -> dict:
    """Diagnostics: what the store actually holds."""
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT session_date, COUNT(*) n, MIN(as_of) a, MAX(as_of) b "
                "FROM breadth_intraday GROUP BY session_date "
                "ORDER BY session_date DESC LIMIT 10"
            ).fetchall()
        return {
            "db": _db_path(),
            "health": health(),
            "sessions": [
                {"date": r["session_date"], "samples": r["n"],
                 "first": r["a"], "last": r["b"]}
                for r in rows
            ],
        }
    except Exception as e:
        return {"db": _db_path(), "error": str(e)}
