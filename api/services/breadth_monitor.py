"""api/services/breadth_monitor.py

SQLite service for the UCT Market Breadth Monitor.

DB location:
  Railway (persistent volume): /data/breadth_monitor.db
  Local dev:                   data/breadth_monitor.db (project root)

Schema:
  breadth_snapshots
    date        TEXT PRIMARY KEY  -- YYYY-MM-DD
    metrics     JSON NOT NULL     -- dict of all collected metrics
    created_at  TEXT              -- UTC timestamp
"""

import json
import os
import sqlite3
from pathlib import Path
from typing import Optional

# ── DB path ───────────────────────────────────────────────────────────────────

def _db_path() -> str:
    if os.path.exists("/data"):
        return "/data/breadth_monitor.db"
    # Local dev: project root / data /
    local = Path(__file__).parent.parent.parent / "data" / "breadth_monitor.db"
    local.parent.mkdir(exist_ok=True)
    return str(local)


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_db_path())
    c.row_factory = sqlite3.Row
    return c


# ── Init ──────────────────────────────────────────────────────────────────────

def init_db() -> None:
    with _conn() as c:
        c.execute("""
            CREATE TABLE IF NOT EXISTS breadth_snapshots (
                date       TEXT PRIMARY KEY,
                metrics    TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        c.commit()


# ── Write ─────────────────────────────────────────────────────────────────────

def store_snapshot(date_str: str, metrics: dict) -> bool:
    try:
        with _conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO breadth_snapshots (date, metrics) VALUES (?, ?)",
                (date_str, json.dumps(metrics)),
            )
            c.commit()
        return True
    except Exception as e:
        print(f"[breadth_monitor] store error: {e}")
        return False


# ── Read ──────────────────────────────────────────────────────────────────────

def get_history(days: int = 90) -> list:
    """Return last N trading days, newest first. Ratios computed from stored data."""
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT date, metrics FROM breadth_snapshots ORDER BY date DESC LIMIT ?",
                (days,),
            ).fetchall()
    except Exception as e:
        print(f"[breadth_monitor] get_history error: {e}")
        return []

    result = []
    for row in rows:
        m = json.loads(row["metrics"])
        m["date"] = row["date"]
        result.append(m)

    # Need oldest-first to compute rolling windows, then reverse back
    result_asc = list(reversed(result))

    for i, row in enumerate(result_asc):
        w5  = result_asc[max(0, i - 4):  i + 1]
        w10 = result_asc[max(0, i - 9):  i + 1]
        row["ratio_5day"]   = _ratio(w5,  "up_4pct_today", "down_4pct_today")
        row["ratio_10day"]  = _ratio(w10, "up_4pct_today", "down_4pct_today")
        row["avg_10d_cpc"]  = _rolling_avg(w10, "cboe_putcall", 2)

    # Return newest-first
    return list(reversed(result_asc))


def _rolling_avg(window: list, key: str, decimals: int = 1) -> Optional[float]:
    vals = [r[key] for r in window if r.get(key) is not None]
    if len(vals) < 3:
        return None
    return round(sum(vals) / len(vals), decimals)


def _ratio(window: list, key_up: str, key_dn: str) -> Optional[float]:
    ups = [r[key_up] for r in window if r.get(key_up) is not None]
    dns = [r[key_dn] for r in window if r.get(key_dn) is not None]
    if not ups or not dns:
        return None
    total_dn = sum(dns)
    if total_dn == 0:
        return None
    return round(sum(ups) / total_dn, 2)


def get_latest() -> Optional[dict]:
    history = get_history(1)
    return history[0] if history else None
