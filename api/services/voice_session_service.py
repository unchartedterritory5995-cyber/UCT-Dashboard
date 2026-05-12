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
    """Mark a session ended with its observed duration. If
    estimated_cost_usd is 0 (default), compute it from duration via
    voice_cost_service so we always have a cost number stamped."""
    # Compute cost if caller didn't provide one
    if estimated_cost_usd <= 0:
        try:
            from api.services.voice_cost_service import estimate_mode_c_cost
            estimated_cost_usd = estimate_mode_c_cost(int(duration_seconds))
        except Exception:
            estimated_cost_usd = 0.0
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


def get_agent_stats(user_id: str, *, days: int = 30) -> list[dict]:
    """
    Aggregate Mode C sessions grouped by page_context (which holds the
    agent_id for specialist sessions: analyst, risk_officer, coach,
    scout, global, train_me). Returns one row per context with session
    count, total duration, average duration.

    For risk_officer, additionally counts how many trades were refused
    by the validator during sessions in that bucket.
    """
    from datetime import datetime, timezone, timedelta
    cutoff = (datetime.now(timezone.utc) - timedelta(days=max(1, int(days)))).isoformat()

    conn = get_connection()
    try:
        rows = conn.execute(
            """
            SELECT page_context,
                   COUNT(*)              AS session_count,
                   SUM(duration_seconds) AS total_duration_s,
                   AVG(duration_seconds) AS avg_duration_s,
                   MAX(started_at)       AS last_used_at
              FROM voice_sessions
             WHERE user_id = ? AND mode = 'c'
               AND started_at >= ?
             GROUP BY page_context
             ORDER BY session_count DESC
            """,
            (user_id, cutoff),
        ).fetchall()

        # Risk-officer-specific: count validate_trade calls that returned
        # ok=False during sessions where page_context = 'risk_officer'.
        refusals = conn.execute(
            """
            SELECT COUNT(*) FROM voice_tool_calls
             WHERE user_id = ?
               AND tool_name = 'validate_trade'
               AND ok = 0
               AND created_at >= ?
            """,
            (user_id, cutoff),
        ).fetchone()[0]

        out = []
        for r in rows:
            ctx = r["page_context"] or "global"
            row_data = {
                "context": ctx,
                "session_count": r["session_count"] or 0,
                "total_duration_seconds": int(r["total_duration_s"] or 0),
                "avg_duration_seconds": round(float(r["avg_duration_s"] or 0), 1),
                "last_used_at": r["last_used_at"],
            }
            if ctx == "risk_officer":
                row_data["trade_refusals"] = int(refusals or 0)
            out.append(row_data)
        return out
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
