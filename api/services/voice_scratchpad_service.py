"""
Voice scratchpad — per-session key/value store the model can write to and
read from during a Realtime conversation.

Use case: model is reasoning about a trade, fetches NVDA quote + theme +
journal stats, writes them to scratchpad ("nvda_quote", "nvda_setup",
"nvda_risk"), then synthesizes a final answer referencing all three.

Without this, the model has to keep everything in its own context window
and re-fetch when it forgets. Scratchpad gives it durable working memory
for the current session.
"""

import logging
from api.services.auth_db import get_connection

_log = logging.getLogger(__name__)

MAX_NOTES_PER_SESSION = 50
MAX_VALUE_CHARS = 4000


def write_note(*, user_id: str, session_id: int | None,
               key: str, value: str) -> dict:
    """Upsert a key/value pair for the current session. UNIQUE on (session_id, key)."""
    k = (key or "").strip()
    v = (value or "").strip()
    if not k:
        raise ValueError("key is required")
    if not v:
        raise ValueError("value is required")
    if len(v) > MAX_VALUE_CHARS:
        v = v[:MAX_VALUE_CHARS]
    conn = get_connection()
    try:
        # Enforce per-session note cap
        if session_id is not None:
            count = conn.execute(
                "SELECT COUNT(*) FROM voice_scratchpad WHERE session_id = ?",
                (session_id,),
            ).fetchone()[0]
            if count >= MAX_NOTES_PER_SESSION:
                existing = conn.execute(
                    "SELECT id FROM voice_scratchpad WHERE session_id = ? AND key = ?",
                    (session_id, k),
                ).fetchone()
                if not existing:
                    raise ValueError(
                        f"scratchpad full ({MAX_NOTES_PER_SESSION} notes/session)"
                    )

        # Upsert via DELETE+INSERT (SQLite ON CONFLICT requires more setup)
        if session_id is not None:
            conn.execute(
                "DELETE FROM voice_scratchpad WHERE session_id = ? AND key = ?",
                (session_id, k),
            )
        conn.execute(
            """INSERT INTO voice_scratchpad (session_id, user_id, key, value)
               VALUES (?, ?, ?, ?)""",
            (session_id, user_id, k, v),
        )
        conn.commit()
        return {"key": k, "value": v}
    finally:
        conn.close()


def read_note(*, session_id: int | None, key: str) -> str | None:
    if not session_id:
        return None
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT value FROM voice_scratchpad WHERE session_id = ? AND key = ?",
            (session_id, (key or "").strip()),
        ).fetchone()
        return row["value"] if row else None
    finally:
        conn.close()


def list_notes(*, session_id: int | None) -> list[dict]:
    """Read all notes for the current session, newest first."""
    if not session_id:
        return []
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT key, value, created_at
                 FROM voice_scratchpad
                WHERE session_id = ?
                ORDER BY created_at DESC""",
            (session_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def clear_session(*, session_id: int) -> int:
    """Wipe scratchpad for a session. Called on session end."""
    conn = get_connection()
    try:
        result = conn.execute(
            "DELETE FROM voice_scratchpad WHERE session_id = ?",
            (session_id,),
        )
        conn.commit()
        return result.rowcount or 0
    finally:
        conn.close()
