"""
Voice session + transcript persistence.

Sessions are append-only; transcripts are rolling per-session text logs.
Used by Mode C (Realtime conversational) primarily. Mode A read-aloud and
Mode B one-shot do NOT create sessions — they are point-in-time operations.
"""

from datetime import datetime, timezone
from api.services.auth_db import get_connection


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_session(*, user_id: str, mode: str, source: str = "orb",
                   page_context: str = "global") -> int:
    """Insert a new session row, return its id."""
    conn = get_connection()
    try:
        cur = conn.execute(
            """INSERT INTO voice_sessions
               (user_id, mode, source, started_at, status, page_context)
               VALUES (?, ?, ?, ?, 'active', ?)""",
            (user_id, mode, source, _now(), page_context),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def end_session(session_id: int, *, duration_seconds: int,
                status: str = "closed", estimated_cost_usd: float = 0.0) -> None:
    """Mark a session ended with its observed duration."""
    conn = get_connection()
    try:
        conn.execute(
            """UPDATE voice_sessions
               SET ended_at = ?, duration_seconds = ?, status = ?,
                   estimated_cost_usd = ?
               WHERE id = ?""",
            (_now(), int(duration_seconds), status, float(estimated_cost_usd), session_id),
        )
        conn.commit()
    finally:
        conn.close()
    # Wipe scratchpad — it's working memory, not durable
    try:
        from api.services.voice_scratchpad_service import clear_session
        clear_session(session_id=session_id)
    except Exception:  # noqa: BLE001
        pass


def append_transcript(session_id: int, *, role: str, text: str) -> None:
    """Append one transcript entry. role is 'user' | 'assistant' | 'tool'."""
    if role not in {"user", "assistant", "tool"}:
        raise ValueError(f"role must be user/assistant/tool, got {role!r}")
    text = (text or "").strip()
    if not text:
        return
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO voice_transcripts (session_id, role, text, timestamp)
               VALUES (?, ?, ?, ?)""",
            (session_id, role, text[:8000], _now()),
        )
        conn.commit()
    finally:
        conn.close()


def get_session(session_id: int) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM voice_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return None
        return dict(row)
    finally:
        conn.close()


def list_sessions(user_id: str, *, limit: int = 50) -> list[dict]:
    """Most recent sessions first."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM voice_sessions
               WHERE user_id = ?
               ORDER BY started_at DESC
               LIMIT ?""",
            (user_id, max(1, min(limit, 200))),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def get_transcripts(session_id: int) -> list[dict]:
    """All transcript entries for a session, oldest first."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM voice_transcripts
               WHERE session_id = ?
               ORDER BY timestamp ASC""",
            (session_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def session_belongs_to_user(session_id: int, user_id: str) -> bool:
    """Authorization helper — confirm a session id is owned by the given user."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT user_id FROM voice_sessions WHERE id = ?", (session_id,)
        ).fetchone()
        return row is not None and row["user_id"] == user_id
    finally:
        conn.close()
