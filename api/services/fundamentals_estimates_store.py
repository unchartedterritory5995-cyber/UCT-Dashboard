"""Forward-estimate snapshot store — powers the ▲/▼ "consensus raised/cut"
markers on the fundamentals widget. One row per (ticker, fiscal_year) per
calendar day; revision_for() compares the current estimate to the snapshot
nearest N days ago. Lazy-init, dashboard-owned SQLite (mirrors catalyst metadata DB)."""
from __future__ import annotations

import os
import sqlite3
import time
from contextlib import closing

_REVISION_EPS_TOL = 0.005  # ±0.5% — ignore noise below this as "flat"


def _db_path() -> str:
    p = os.environ.get("FUNDAMENTALS_ESTIMATES_DB_PATH")
    if p:
        return p
    if os.path.isdir("/data"):
        return "/data/fundamentals_estimates.db"
    # Local-dev fallback next to the repo working dir.
    return os.path.join(os.getcwd(), "fundamentals_estimates.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_db_path(), timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _ensure_init() -> None:
    with closing(_connect()) as conn:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS estimate_snapshots (
                   ticker TEXT NOT NULL,
                   fiscal_year INTEGER NOT NULL,
                   eps_est REAL,
                   sales_est REAL,
                   captured_at REAL NOT NULL,
                   day_key TEXT NOT NULL,
                   PRIMARY KEY (ticker, fiscal_year, day_key)
               )"""
        )
        conn.commit()


def _day_key(now: float) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime(now))


def record_snapshot(ticker, fiscal_year, eps_est, sales_est, now=None):
    now = time.time() if now is None else now
    _ensure_init()
    with closing(_connect()) as conn:
        conn.execute(
            """INSERT OR IGNORE INTO estimate_snapshots
                   (ticker, fiscal_year, eps_est, sales_est, captured_at, day_key)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (ticker.upper(), int(fiscal_year), eps_est, sales_est, now, _day_key(now)),
        )
        conn.commit()


def _nearest_before(conn, ticker, fiscal_year, cutoff):
    row = conn.execute(
        """SELECT eps_est, sales_est FROM estimate_snapshots
               WHERE ticker=? AND fiscal_year=? AND captured_at<=?
               ORDER BY captured_at DESC LIMIT 1""",
        (ticker.upper(), int(fiscal_year), cutoff),
    ).fetchone()
    return row


def _dir(cur, old):
    if cur is None or old is None or old == 0:
        return None
    delta = (cur - old) / abs(old)
    if delta > _REVISION_EPS_TOL:
        return "up"
    if delta < -_REVISION_EPS_TOL:
        return "down"
    return None


def revision_for(ticker, fiscal_year, eps_est, sales_est, now=None, lookback_days=30):
    now = time.time() if now is None else now
    _ensure_init()
    cutoff = now - lookback_days * 86400
    with closing(_connect()) as conn:
        prior = _nearest_before(conn, ticker, fiscal_year, cutoff)
    if not prior:
        return {"eps": None, "sales": None}
    return {"eps": _dir(eps_est, prior[0]), "sales": _dir(sales_est, prior[1])}


def prune(now=None, max_age_days=400):
    now = time.time() if now is None else now
    _ensure_init()
    cutoff = now - max_age_days * 86400
    with closing(_connect()) as conn:
        cur = conn.execute("DELETE FROM estimate_snapshots WHERE captured_at < ?", (cutoff,))
        conn.commit()
        return cur.rowcount


def _count(ticker, fiscal_year):
    """Test helper — snapshot count for a (ticker, fiscal_year)."""
    _ensure_init()
    with closing(_connect()) as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM estimate_snapshots WHERE ticker=? AND fiscal_year=?",
            (ticker.upper(), int(fiscal_year)),
        ).fetchone()[0]
