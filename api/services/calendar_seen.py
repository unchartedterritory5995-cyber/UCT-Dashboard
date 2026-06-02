"""
calendar_seen.py — Read/unseen state for calendar items.

Table: calendar_seen(user_id, item_type, item_key, seen_at)
  Primary Key: (user_id, item_type, item_key)
  item_type ∈ earnings | filing | ipo | recap | insight | news

Self-initialising: table is created lazily on first use, mirroring the
pattern used by tweet_store.py and other Railway-volume services.
"""

from __future__ import annotations
import os
import sqlite3
import contextlib
from datetime import datetime, timezone

# ── DB path ────────────────────────────────────────────────────────────────────

_DB_PATH = os.environ.get("CALENDAR_SEEN_DB_PATH", "/data/auth.db")

# Fallback for local dev where /data/ may not exist
if not os.path.exists(os.path.dirname(_DB_PATH)):
    _DB_PATH = os.path.join(
        os.path.dirname(__file__), "..", "..", "data", "auth.db"
    )

_INIT_DONE = False


# ── Connection ─────────────────────────────────────────────────────────────────

def _get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn


# ── Schema init (lazy, idempotent) ─────────────────────────────────────────────

def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with contextlib.closing(_get_connection()) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS calendar_seen (
                user_id   TEXT NOT NULL,
                item_type TEXT NOT NULL,
                item_key  TEXT NOT NULL,
                seen_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, item_type, item_key)
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_calendar_seen_user_type "
            "ON calendar_seen(user_id, item_type)"
        )
        conn.commit()
    _INIT_DONE = True


# ── Public API ─────────────────────────────────────────────────────────────────

def mark_seen(user_id: str, item_type: str, item_key: str) -> None:
    """Idempotent upsert — marks an item as seen for the user.

    Re-marking an already-seen item is a no-op (preserves the original seen_at
    so relative-time badges remain stable).
    """
    _ensure_init()
    now_utc = datetime.now(timezone.utc).isoformat()
    with contextlib.closing(_get_connection()) as conn:
        conn.execute(
            """
            INSERT INTO calendar_seen (user_id, item_type, item_key, seen_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, item_type, item_key) DO NOTHING
            """,
            (user_id, item_type, item_key, now_utc),
        )
        conn.commit()


def get_seen(user_id: str, item_type: str | None = None) -> set[str]:
    """Return the set of item_keys seen by the user.

    If item_type is provided, only keys of that type are returned.
    Otherwise keys across ALL types are returned (useful for a full
    unseen-count sweep).
    """
    _ensure_init()
    with contextlib.closing(_get_connection()) as conn:
        if item_type:
            rows = conn.execute(
                "SELECT item_key FROM calendar_seen WHERE user_id = ? AND item_type = ?",
                (user_id, item_type),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT item_key FROM calendar_seen WHERE user_id = ?",
                (user_id,),
            ).fetchall()
    return {row["item_key"] for row in rows}
