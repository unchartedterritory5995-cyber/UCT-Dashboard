"""
Trace replay — Batch 13d.

For any past Mode C session, reconstruct the full lineage:
  - Session metadata (id, mode, page_context, started_at, ended_at,
    duration, status)
  - Variant in use (from voice_prompt_variants)
  - Every transcript turn (user / assistant / tool)
  - Every tool call (tool_name, args, ok, error, latency_ms, created_at)
  - Any feedback (thumbs + corrections) tied to the session

Useful for: debugging "why did the assistant say X", auditing risk-
officer refusals, exporting a session for offline review.
"""

import json
import logging
from typing import Any

from api.services.auth_db import get_connection

_log = logging.getLogger(__name__)


def get_trace(session_id: int, user_id: str) -> dict[str, Any] | None:
    """
    Build a full trace for one session. Returns None if the session
    doesn't exist or doesn't belong to the user.
    """
    conn = get_connection()
    try:
        session_row = conn.execute(
            """SELECT id, user_id, mode, source, started_at, ended_at,
                      duration_seconds, status, page_context,
                      estimated_cost_usd
                 FROM voice_sessions
                WHERE id = ? AND user_id = ?""",
            (session_id, user_id),
        ).fetchone()
        if not session_row:
            return None

        # Variant
        variant_row = conn.execute(
            """SELECT variant_id, agent_ctx, created_at
                 FROM voice_prompt_variants
                WHERE session_id = ?""",
            (session_id,),
        ).fetchone()

        # Transcripts (user/assistant/tool turns)
        transcripts = conn.execute(
            """SELECT role, text, timestamp
                 FROM voice_transcripts
                WHERE session_id = ?
                ORDER BY timestamp ASC, id ASC""",
            (session_id,),
        ).fetchall()

        # Tool calls
        tool_calls = conn.execute(
            """SELECT tool_name, args_json, ok, error, latency_ms, created_at
                 FROM voice_tool_calls
                WHERE session_id = ?
                ORDER BY created_at ASC, id ASC""",
            (session_id,),
        ).fetchall()

        # Feedback tied to this session
        feedback = conn.execute(
            """SELECT rating, turn_text, correction_text, created_at
                 FROM voice_feedback
                WHERE session_id = ?
                ORDER BY created_at ASC""",
            (session_id,),
        ).fetchall()

        # Scratchpad notes from this session (if any survived — they
        # auto-clear on session end so usually empty for past sessions)
        scratchpad = conn.execute(
            """SELECT key, value, created_at
                 FROM voice_scratchpad
                WHERE session_id = ?
                ORDER BY created_at ASC""",
            (session_id,),
        ).fetchall()
    finally:
        conn.close()

    def _decode_args(j: str | None) -> Any:
        if not j:
            return None
        try:
            return json.loads(j)
        except (json.JSONDecodeError, TypeError):
            return j

    return {
        "session": dict(session_row),
        "variant": dict(variant_row) if variant_row else None,
        "transcripts": [dict(r) for r in transcripts],
        "tool_calls": [
            {
                "tool_name": r["tool_name"],
                "args": _decode_args(r["args_json"]),
                "ok": bool(r["ok"]),
                "error": r["error"],
                "latency_ms": r["latency_ms"],
                "created_at": r["created_at"],
            }
            for r in tool_calls
        ],
        "feedback": [dict(r) for r in feedback],
        "scratchpad": [dict(r) for r in scratchpad],
        "counts": {
            "transcripts": len(transcripts),
            "tool_calls": len(tool_calls),
            "feedback": len(feedback),
            "scratchpad_entries": len(scratchpad),
        },
    }


def list_recent_sessions(user_id: str, *, limit: int = 50) -> list[dict]:
    """Sessions newest-first for the user, with cheap summary stats."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT vs.id, vs.mode, vs.page_context, vs.started_at,
                      vs.ended_at, vs.duration_seconds, vs.status,
                      vpv.variant_id,
                      (SELECT COUNT(*) FROM voice_transcripts vt
                         WHERE vt.session_id = vs.id) AS transcript_count,
                      (SELECT COUNT(*) FROM voice_tool_calls vtc
                         WHERE vtc.session_id = vs.id) AS tool_call_count
                 FROM voice_sessions vs
                 LEFT JOIN voice_prompt_variants vpv ON vpv.session_id = vs.id
                WHERE vs.user_id = ?
                ORDER BY vs.id DESC
                LIMIT ?""",
            (user_id, max(1, min(200, int(limit)))),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
