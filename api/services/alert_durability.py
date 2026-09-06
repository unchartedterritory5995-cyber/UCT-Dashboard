"""Alert Durability V1 (owner authorization, 2026-09-06 Whole-Product
Strategic Re-Anchor -- Seam: "non-S7 alerts fully ephemeral, lost on every
redeploy").

``api/services/alerts.py``'s own module docstring already named the fix:
"if per-member alerts must survive a redeploy they belong in ``auth.db``
... as a ``user_alerts`` table alongside ``watchlist_alerts`` /
``indicator_alerts``, which is where the rest of the per-member alert
state already lives." This module is exactly that table, wired in as a
dual-write bridge mirroring S7's own already-proven durable pattern
(``api/services/alert_taxonomy/receipts.py``) rather than inventing a new
persistence idiom.

SCOPE (deliberately bounded, matching this session's V1 convention):
  - PRIVATE alerts only (``user_id is not None``). Broadcast alerts
    (regime_change/scanner_match/exposure_shift system-wide announcements)
    stay ephemeral-only for this V1 -- ``alerts.py``'s own docstring scopes
    the durability concern to per-member alerts specifically, and losing a
    system-wide announcement across a redeploy is a materially smaller
    member-trust cost than losing a personalized one.
  - S7 document-arrival alerts are explicitly EXCLUDED (see
    ``should_persist`` below) -- they already have their own, more capable
    durable pipeline (``alert_taxonomy.alert_fires``, with delivery-attempt
    tracking and fire-key dedup). Writing them here too would create a
    confusing THIRD copy of the same fire once the ephemeral cache expires,
    on top of the TWO stores ``alerts.get_alerts`` already merges.

Same DB, same WAL + busy_timeout pragmas, same private ``_conn()`` helper as
``indicator_alert_service.py``/``bar_quarantine.py``.
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from typing import Any, Optional

_DB_PATH = os.environ.get("AUTH_DB_PATH", "/data/auth.db")

# Retention is a per-user ROW CAP, not a time-based sweep -- no new scheduled
# job needed. 200 is well above the ephemeral cache's own _MAX_PER_LIST=100,
# so durability strictly extends what a member could already see, never
# narrows it.
_MAX_PER_USER = 200

_SCHEMA = """
CREATE TABLE IF NOT EXISTS user_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  data_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_alerts_user_created ON user_alerts(user_id, created_at);
"""


def should_persist(alert: dict) -> bool:
    """True iff this alert belongs in the durable table -- private, and not
    an S7 document-arrival fire (which already owns a separate, more capable
    durable pipeline). Exposed as its own function so `alerts.py` and this
    module's own tests share one answer, never two copies of the rule."""
    if not alert.get("user_id"):
        return False
    data = alert.get("data")
    if isinstance(data, dict) and data.get("source") == "document_arrival":
        return False
    return True


def _conn():
    c = sqlite3.connect(_DB_PATH, timeout=10.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=2000")
    return c


def init_schema() -> None:
    with _conn() as db:
        db.executescript(_SCHEMA)


def record_alert(alert: dict) -> None:
    """Insert-once durable copy of a private alert. Never raises -- a
    durability write must not be able to break the alert's own ephemeral
    delivery path (matches this module's callers' own "never breaks the
    feed" posture throughout alerts.py)."""
    try:
        with _conn() as db:
            db.execute(
                "INSERT OR IGNORE INTO user_alerts "
                "(id, user_id, type, severity, title, message, timestamp, read, data_json, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (alert["id"], alert["user_id"], alert["type"], alert["severity"],
                 alert["title"], alert["message"], alert["timestamp"],
                 1 if alert.get("read") else 0,
                 json.dumps(alert.get("data") or {}),
                 int(time.time())),
            )
            # Bound growth: keep only the newest _MAX_PER_USER rows for this
            # member. Runs on every write (cheap -- indexed, one user's rows).
            db.execute(
                "DELETE FROM user_alerts WHERE user_id = ? AND id NOT IN ("
                "  SELECT id FROM user_alerts WHERE user_id = ? "
                "  ORDER BY created_at DESC LIMIT ?)",
                (alert["user_id"], alert["user_id"], _MAX_PER_USER),
            )
            db.commit()
    except Exception:  # noqa: BLE001
        pass


def _row_to_alert(r: sqlite3.Row) -> dict[str, Any]:
    try:
        data = json.loads(r["data_json"]) if r["data_json"] else {}
    except Exception:  # noqa: BLE001
        data = {}
    return {
        "id": r["id"], "type": r["type"], "severity": r["severity"],
        "title": r["title"], "message": r["message"], "timestamp": r["timestamp"],
        "read": bool(r["read"]), "user_id": r["user_id"], "data": data,
    }


def list_durable_alerts(user_id: str, limit: int = 50) -> list[dict[str, Any]]:
    """This member's own durably-stored alerts, newest first. Never raises
    -- a table/connection failure degrades to "no durable rows this call",
    matching the S7 bridge's own posture, not a broken feed."""
    try:
        with _conn() as db:
            db.row_factory = sqlite3.Row
            rows = db.execute(
                "SELECT * FROM user_alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
            return [_row_to_alert(r) for r in rows]
    except Exception:  # noqa: BLE001
        return []


def mark_read(alert_id: str, user_id: str) -> bool:
    """Ownership-scoped, idempotent. True iff the caller owns a durable row
    with this id (whether or not this call is what marked it read)."""
    try:
        with _conn() as db:
            cur = db.execute(
                "UPDATE user_alerts SET read = 1 WHERE id = ? AND user_id = ?",
                (alert_id, user_id),
            )
            db.commit()
            return cur.rowcount > 0
    except Exception:  # noqa: BLE001
        return False


def mark_all_read(user_id: str) -> int:
    try:
        with _conn() as db:
            cur = db.execute(
                "UPDATE user_alerts SET read = 1 WHERE user_id = ? AND read = 0",
                (user_id,),
            )
            db.commit()
            return cur.rowcount
    except Exception:  # noqa: BLE001
        return 0


def clear_alerts(user_id: str) -> int:
    try:
        with _conn() as db:
            cur = db.execute("DELETE FROM user_alerts WHERE user_id = ?", (user_id,))
            db.commit()
            return cur.rowcount
    except Exception:  # noqa: BLE001
        return 0
