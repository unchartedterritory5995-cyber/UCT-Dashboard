"""CRUD service for chart indicator alerts.

Stores per-user (ticker, indicator, condition, threshold, timeframe) alerts
that the background evaluator checks every 60s. When a condition triggers,
delivery reuses the existing watchlist-alert infrastructure (bell + email +
Discord + browser notification + sound).

Schema and patterns mirror ``api/services/bar_quarantine.py`` — same DB,
same WAL + busy_timeout pragmas, same private ``_conn()`` helper.
"""
import json
import os
import sqlite3
import time
from typing import Any, Optional

_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")


_SCHEMA = """
CREATE TABLE IF NOT EXISTS indicator_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  sym TEXT NOT NULL,
  indicator TEXT NOT NULL,
  condition TEXT NOT NULL,
  threshold REAL,
  tf TEXT NOT NULL,
  params_json TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  last_value REAL,
  last_evaluated_at INTEGER,
  triggered_at INTEGER,
  trigger_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_indicator_alerts_user ON indicator_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_indicator_alerts_active ON indicator_alerts(active);
CREATE INDEX IF NOT EXISTS idx_indicator_alerts_sym ON indicator_alerts(sym);
"""


def _conn():
    c = sqlite3.connect(_DB_PATH, timeout=10.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    return c


def init_schema():
    with _conn() as db:
        db.executescript(_SCHEMA)


def _row_to_dict(row: tuple) -> dict:
    return {
        "id": row[0],
        "user_id": row[1],
        "sym": row[2],
        "indicator": row[3],
        "condition": row[4],
        "threshold": row[5],
        "tf": row[6],
        "params_json": row[7],
        "active": bool(row[8]),
        "last_value": row[9],
        "last_evaluated_at": row[10],
        "triggered_at": row[11],
        "trigger_count": row[12],
        "created_at": row[13],
    }


_COLS = (
    "id, user_id, sym, indicator, condition, threshold, tf, params_json, "
    "active, last_value, last_evaluated_at, triggered_at, trigger_count, created_at"
)


def create(
    user_id: int,
    sym: str,
    indicator: str,
    condition: str,
    threshold: Optional[float],
    tf: str,
    params_json: Optional[Any] = None,
) -> int:
    """Create a new indicator alert. Returns the new alert ID."""
    if params_json is not None and not isinstance(params_json, str):
        params_json = json.dumps(params_json)
    with _conn() as db:
        cur = db.execute(
            "INSERT INTO indicator_alerts "
            "(user_id, sym, indicator, condition, threshold, tf, params_json, "
            "active, trigger_count, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?)",
            (
                int(user_id),
                sym.upper(),
                indicator,
                condition,
                None if threshold is None else float(threshold),
                tf,
                params_json,
                int(time.time()),
            ),
        )
        return int(cur.lastrowid)


def get(alert_id: int) -> Optional[dict]:
    with _conn() as db:
        row = db.execute(
            f"SELECT {_COLS} FROM indicator_alerts WHERE id=?",
            (int(alert_id),),
        ).fetchone()
    return _row_to_dict(row) if row else None


def list_for_user(user_id: int) -> list[dict]:
    with _conn() as db:
        rows = db.execute(
            f"SELECT {_COLS} FROM indicator_alerts WHERE user_id=? ORDER BY created_at DESC",
            (int(user_id),),
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def list_active() -> list[dict]:
    with _conn() as db:
        rows = db.execute(
            f"SELECT {_COLS} FROM indicator_alerts WHERE active=1 ORDER BY id"
        ).fetchall()
    return [_row_to_dict(r) for r in rows]


def set_active(alert_id: int, active: bool) -> None:
    with _conn() as db:
        db.execute(
            "UPDATE indicator_alerts SET active=? WHERE id=?",
            (1 if active else 0, int(alert_id)),
        )


def delete(alert_id: int) -> None:
    with _conn() as db:
        db.execute("DELETE FROM indicator_alerts WHERE id=?", (int(alert_id),))


def record_evaluation(alert_id: int, last_value: float) -> None:
    """Record that an alert was evaluated but did not trigger."""
    with _conn() as db:
        db.execute(
            "UPDATE indicator_alerts SET last_value=?, last_evaluated_at=? WHERE id=?",
            (float(last_value), int(time.time()), int(alert_id)),
        )


def record_trigger(alert_id: int, last_value: float) -> None:
    """Record that an alert triggered: bump trigger_count, set triggered_at, update last_value."""
    now = int(time.time())
    with _conn() as db:
        db.execute(
            "UPDATE indicator_alerts SET "
            "last_value=?, last_evaluated_at=?, triggered_at=?, "
            "trigger_count=trigger_count+1 WHERE id=?",
            (float(last_value), now, now, int(alert_id)),
        )
