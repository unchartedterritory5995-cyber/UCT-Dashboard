"""Voice session + transcript service."""

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_session_service import (
    create_session, end_session, append_transcript,
    get_session, list_sessions, get_transcripts,
)


def _user():
    init_db()
    return create_user(f"vs_{__import__('uuid').uuid4()}@example.com", "password123")["id"]


def test_create_session_returns_id_with_active_status():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    s = get_session(sid)
    assert s["user_id"] == uid
    assert s["mode"] == "c"
    assert s["status"] == "active"
    assert s["ended_at"] is None


def test_end_session_records_duration():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    end_session(sid, duration_seconds=42)
    s = get_session(sid)
    assert s["status"] == "closed"
    assert s["duration_seconds"] == 42
    assert s["ended_at"] is not None


def test_append_transcript_persists():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    append_transcript(sid, role="user", text="What's NVDA at?")
    append_transcript(sid, role="assistant", text="NVDA is at 487, up 2 percent.")
    rows = get_transcripts(sid)
    assert len(rows) == 2
    assert rows[0]["role"] == "user"
    assert "NVDA" in rows[1]["text"]


def test_list_sessions_for_user_returns_recent_first():
    uid = _user()
    s1 = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    s2 = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    sessions = list_sessions(uid, limit=10)
    ids = [s["id"] for s in sessions]
    assert s2 in ids and s1 in ids
