"""Quarantine table for bad bars detected by validation or audit.

Bars in this table are skipped on cache reads, forcing a fresh fetch from
an alternate source on next access (self-healing).
"""
import os
import sqlite3
import time
from typing import Optional

_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS quarantined_bars (
  ticker TEXT NOT NULL,
  tf TEXT NOT NULL,
  bar_time INTEGER NOT NULL,
  reason TEXT NOT NULL,
  source TEXT,
  detected_at INTEGER NOT NULL,
  PRIMARY KEY (ticker, tf, bar_time)
);
CREATE INDEX IF NOT EXISTS idx_quarantine_detected ON quarantined_bars(detected_at);
"""


def _conn():
    c = sqlite3.connect(_DB_PATH, timeout=10.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    return c


def init_schema():
    with _conn() as db:
        db.executescript(_SCHEMA)


def _key(bar_time) -> int:
    """Normalise, or raise. A None key inside this module means a caller passed
    something that is not a bar time at all; silently writing a wrong key would
    filter a GOOD bar off a member's chart, which is worse than missing a bad one."""
    k = norm_bar_time(bar_time)
    if k is None:
        raise ValueError("un-keyable bar_time: %r" % (bar_time,))
    return k


def norm_bar_time(t):
    """Canonical quarantine key for a bar's `t`, or None when there is no key.

    INTRADAY IS IDENTITY. An int in gives the same int out, so every existing
    epoch-keyed row keeps matching and nothing is re-keyed. This is the whole
    reason the fix is key-ADDITIVE rather than key-changing: no migration, and no
    way to break a caller that already works.

    D/W/M bars carry an ISO date string (`"2026-09-11"`), and BOTH halves of the
    quarantine failed on it, in the same direction:

      * the WRITE did `int(bar["t"])` inside a bare `except: pass`
        (`bars_disk_cache.py`), so `int("2026-09-11")` raised and was swallowed —
        no daily row was ever written;
      * the READ compared that ISO string against a `set[int]`
        (`bars_disk_cache.py`), which can never match.

    Either failure alone would have left the feature dead, which is why no partial
    symptom ever appeared and nobody noticed.

    Returns None for anything unparseable rather than guessing — a wrong key
    would filter a GOOD bar out of the member's chart, which is worse than not
    quarantining a bad one.
    """
    if isinstance(t, bool):
        return None
    if isinstance(t, int):
        return t
    if isinstance(t, float):
        return int(t)
    if not isinstance(t, str):
        return None
    s = t.strip()
    if not s:
        return None
    if s.lstrip("-").isdigit():          # an epoch that arrived as text
        return int(s)
    head = s[:10]                         # "YYYY-MM-DD" from a date or datetime
    if len(head) == 10 and head[4] == "-" and head[7] == "-":
        y, m, d = head[:4], head[5:7], head[8:10]
        if y.isdigit() and m.isdigit() and d.isdigit():
            return int(y + m + d)
    return None

def add(ticker: str, tf: str, bar_time: int, reason: str, source: Optional[str] = None) -> None:
    """Quarantine a bad bar so it is skipped on subsequent cache reads.

    Re-quarantining the same (ticker, tf, bar_time) refreshes reason/source/detected_at
    to the latest detection (INSERT OR REPLACE semantics).
    """
    with _conn() as db:
        db.execute(
            "INSERT OR REPLACE INTO quarantined_bars "
            "(ticker, tf, bar_time, reason, source, detected_at) VALUES (?, ?, ?, ?, ?, ?)",
            (ticker.upper(), tf, _key(bar_time), reason, source, int(time.time())),
        )
    # Invalidate the read cache so the new quarantine takes effect immediately.
    # Lazy import avoids circular-import risk (bar_quarantine_cache imports this module).
    try:
        from api.services import bar_quarantine_cache
        bar_quarantine_cache.invalidate(ticker, tf)
    except Exception:
        pass


def remove(ticker: str, tf: str, bar_time: int) -> None:
    with _conn() as db:
        db.execute(
            "DELETE FROM quarantined_bars WHERE ticker=? AND tf=? AND bar_time=?",
            (ticker.upper(), tf, _key(bar_time)),
        )
    try:
        from api.services import bar_quarantine_cache
        bar_quarantine_cache.invalidate(ticker, tf)
    except Exception:
        pass


def is_quarantined(ticker: str, tf: str, bar_time: int) -> bool:
    with _conn() as db:
        row = db.execute(
            "SELECT 1 FROM quarantined_bars WHERE ticker=? AND tf=? AND bar_time=? LIMIT 1",
            (ticker.upper(), tf, _key(bar_time)),
        ).fetchone()
    return row is not None


def list_for_ticker(ticker: str, tf: Optional[str] = None) -> list[dict]:
    with _conn() as db:
        if tf:
            rows = db.execute(
                "SELECT ticker, tf, bar_time, reason, source, detected_at "
                "FROM quarantined_bars WHERE ticker=? AND tf=? ORDER BY bar_time",
                (ticker.upper(), tf),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT ticker, tf, bar_time, reason, source, detected_at "
                "FROM quarantined_bars WHERE ticker=? ORDER BY tf, bar_time",
                (ticker.upper(),),
            ).fetchall()
    return [
        {"ticker": r[0], "tf": r[1], "bar_time": r[2], "reason": r[3],
         "source": r[4], "detected_at": r[5]}
        for r in rows
    ]


def count(ticker: Optional[str] = None) -> int:
    with _conn() as db:
        if ticker:
            row = db.execute(
                "SELECT COUNT(*) FROM quarantined_bars WHERE ticker=?",
                (ticker.upper(),),
            ).fetchone()
        else:
            row = db.execute("SELECT COUNT(*) FROM quarantined_bars").fetchone()
    return int(row[0]) if row else 0


def quarantined_times(ticker: str, tf: str) -> set[int]:
    """Return set of bar timestamps quarantined for a ticker+tf — fast bulk check."""
    with _conn() as db:
        rows = db.execute(
            "SELECT bar_time FROM quarantined_bars WHERE ticker=? AND tf=?",
            (ticker.upper(), tf),
        ).fetchall()
    return {r[0] for r in rows}

