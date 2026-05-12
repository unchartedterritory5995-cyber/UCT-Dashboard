"""Profile suggestions — actionable feedback turned into pending refinements."""
from __future__ import annotations
import os
import uuid
from datetime import datetime, timezone


def _get_conn(conn=None):
    if conn is not None:
        return conn, False
    import sqlite3 as _sq
    path = os.environ.get("AUTH_DB_PATH") or "/data/auth.db"
    c = _sq.connect(path)
    c.row_factory = _sq.Row
    return c, True


def create_suggestion(
    *, user_id: str, account_id: str,
    source_type: str, source_id: str,
    suggestion: str,
    conn=None,
) -> str:
    """Insert a pending suggestion. Returns its id."""
    _conn, _close = _get_conn(conn)
    try:
        sid = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        _conn.execute(
            """INSERT INTO j2_profile_suggestions
               (id, user_id, account_id, source_type, source_id,
                suggestion, status, created_at, resolved_at)
               VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL)""",
            (sid, user_id, account_id, source_type, source_id,
             suggestion, now_iso),
        )
        _conn.commit()
        return sid
    finally:
        if _close:
            _conn.close()


def list_pending(*, user_id: str, account_id: str, conn=None) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        rows = _conn.execute(
            """SELECT id, source_type, source_id, suggestion, status, created_at
               FROM j2_profile_suggestions
               WHERE user_id = ? AND account_id = ? AND status = 'pending'
               ORDER BY created_at DESC""",
            (user_id, account_id),
        ).fetchall()
        return {"suggestions": [dict(r) for r in rows]}
    finally:
        if _close:
            _conn.close()


def resolve_suggestion(suggestion_id: str, *, user_id: str, conn=None) -> int:
    _conn, _close = _get_conn(conn)
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        cur = _conn.execute(
            """UPDATE j2_profile_suggestions
               SET status = 'resolved', resolved_at = ?
               WHERE id = ? AND user_id = ?""",
            (now_iso, suggestion_id, user_id),
        )
        _conn.commit()
        return cur.rowcount
    finally:
        if _close:
            _conn.close()


def dismiss_suggestion(suggestion_id: str, *, user_id: str, conn=None) -> int:
    _conn, _close = _get_conn(conn)
    try:
        now_iso = datetime.now(timezone.utc).isoformat()
        cur = _conn.execute(
            """UPDATE j2_profile_suggestions
               SET status = 'dismissed', resolved_at = ?
               WHERE id = ? AND user_id = ?""",
            (now_iso, suggestion_id, user_id),
        )
        _conn.commit()
        return cur.rowcount
    finally:
        if _close:
            _conn.close()


def auto_create_from_unhelpful_feedback(
    *, user_id: str, account_id: str,
    source_type: str, source_id: str,
    source_body: str,
    conn=None,
) -> str | None:
    """Called by set_feedback when feedback='unhelpful'. Crafts a generic
    suggestion message; Compass will later expand on it in chat.

    Returns the suggestion id, or None if not created (e.g., dup)."""
    excerpt = (source_body or "")[:200].replace("\n", " ")
    suggestion = (
        f"Trader marked this {source_type} as unhelpful. Excerpt: \"{excerpt}…\" "
        f"In chat, ask the trader what specifically was off and propose a profile refinement."
    )
    return create_suggestion(
        user_id=user_id, account_id=account_id,
        source_type=source_type, source_id=source_id,
        suggestion=suggestion, conn=conn,
    )
