"""Trace replay — session reconstruction."""

import uuid
import pytest

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_trace_service as vts
from api.services.voice_session_service import (
    create_session, append_transcript, end_session,
)
from api.services.voice_reward_model import record_variant
from api.services.voice_feedback_service import record_feedback, record_tool_call


def _user():
    init_db()
    return create_user(f"vts_{uuid.uuid4()}@x.com", "p")["id"]


# ── get_trace ───────────────────────────────────────────────────────────────

def test_get_trace_returns_none_for_unknown_session():
    uid = _user()
    assert vts.get_trace(99999, uid) is None


def test_get_trace_user_isolation():
    """A can't trace B's session."""
    a = _user()
    b = _user()
    sid = create_session(user_id=a, mode="c", source="orb",
                         page_context="global")
    assert vts.get_trace(sid, b) is None
    assert vts.get_trace(sid, a) is not None


def test_get_trace_full_shape():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb",
                         page_context="analyst")
    record_variant(sid, uid, variant_id="analyst_v1", agent_ctx="analyst")
    append_transcript(sid, role="user", text="what's NVDA at")
    append_transcript(sid, role="assistant", text="NVDA at 200, up 2%")
    record_tool_call(uid, tool_name="get_quote",
                     args={"symbol": "NVDA"}, ok=True, latency_ms=42,
                     session_id=sid)
    record_feedback(uid, rating="up", session_id=sid,
                    turn_text="NVDA at 200, up 2%")
    end_session(sid, duration_seconds=15)

    trace = vts.get_trace(sid, uid)
    assert trace is not None
    assert trace["session"]["id"] == sid
    assert trace["session"]["page_context"] == "analyst"
    assert trace["variant"]["variant_id"] == "analyst_v1"
    assert len(trace["transcripts"]) == 2
    assert trace["transcripts"][0]["role"] == "user"
    assert len(trace["tool_calls"]) == 1
    assert trace["tool_calls"][0]["tool_name"] == "get_quote"
    assert trace["tool_calls"][0]["args"] == {"symbol": "NVDA"}
    assert trace["tool_calls"][0]["ok"] is True
    assert len(trace["feedback"]) == 1
    assert trace["feedback"][0]["rating"] == "up"
    assert trace["counts"]["transcripts"] == 2
    assert trace["counts"]["tool_calls"] == 1
    assert trace["counts"]["feedback"] == 1


def test_get_trace_decodes_invalid_args_gracefully():
    """args_json that can't be decoded shouldn't crash the trace."""
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb")
    # Force a bad args_json
    from api.services.auth_db import get_connection
    conn = get_connection()
    try:
        conn.execute(
            """INSERT INTO voice_tool_calls
                 (user_id, session_id, tool_name, args_json, ok)
                 VALUES (?, ?, ?, ?, ?)""",
            (uid, sid, "weird", "{not json", 1),
        )
        conn.commit()
    finally:
        conn.close()
    trace = vts.get_trace(sid, uid)
    assert trace is not None
    assert len(trace["tool_calls"]) == 1
    # Decoder fell back to raw string instead of crashing
    assert trace["tool_calls"][0]["args"] == "{not json"


def test_get_trace_empty_session():
    """Session with no turns / calls / feedback should still return."""
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb",
                         page_context="global")
    trace = vts.get_trace(sid, uid)
    assert trace is not None
    assert trace["counts"]["transcripts"] == 0
    assert trace["counts"]["tool_calls"] == 0


# ── list_recent_sessions ───────────────────────────────────────────────────

def test_list_recent_sessions_empty():
    uid = _user()
    assert vts.list_recent_sessions(uid) == []


def test_list_recent_sessions_ordered_newest_first():
    uid = _user()
    sids = [
        create_session(user_id=uid, mode="c", source="orb",
                       page_context="global")
        for _ in range(3)
    ]
    rows = vts.list_recent_sessions(uid)
    assert len(rows) == 3
    # Newest id first
    assert rows[0]["id"] == sids[2]
    assert rows[2]["id"] == sids[0]


def test_list_recent_sessions_includes_variant_and_counts():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb",
                         page_context="coach")
    record_variant(sid, uid, variant_id="coach_v1", agent_ctx="coach")
    append_transcript(sid, role="user", text="hi")
    append_transcript(sid, role="assistant", text="hey")
    record_tool_call(uid, tool_name="get_my_pnl", args={}, ok=True,
                     session_id=sid)
    rows = vts.list_recent_sessions(uid)
    assert len(rows) == 1
    assert rows[0]["variant_id"] == "coach_v1"
    assert rows[0]["transcript_count"] == 2
    assert rows[0]["tool_call_count"] == 1


def test_list_recent_sessions_user_isolation():
    a = _user()
    b = _user()
    create_session(user_id=a, mode="c", source="orb")
    rows_b = vts.list_recent_sessions(b)
    assert rows_b == []
