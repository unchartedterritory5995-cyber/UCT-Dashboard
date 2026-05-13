"""
Phase 2-B — voice session → Compass thread bridge tests.

When a voice session ends, a Compass-authored summary message should
land in the user's Compass chat thread (j2_chat_messages).
"""

import uuid

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_session_service import (
    create_session, append_transcript,
)
from api.services.journal_two.coach_chat import list_messages
from api.services.trader_memory import get_default_account_id
from api.routers.voice import _bridge_session_to_compass_thread


def _user():
    init_db()
    return create_user(f"bridge_{uuid.uuid4()}@x.com", "p")["id"]


def _new_voice_session(user_id):
    sid = create_session(user_id=user_id, mode="c", source="orb")
    return sid


def test_bridge_no_op_when_no_transcripts():
    """Empty session → no Compass message posted."""
    uid = _user()
    sid = _new_voice_session(uid)
    acc_id = get_default_account_id(uid)
    # Snapshot Compass chat
    before = list_messages(user_id=uid, account_id=acc_id, limit=100)["messages"]
    _bridge_session_to_compass_thread(sid, uid)
    after = list_messages(user_id=uid, account_id=acc_id, limit=100)["messages"]
    assert len(after) == len(before)


def test_bridge_no_op_when_user_only():
    """User spoke but no assistant reply → don't bridge an incomplete turn."""
    uid = _user()
    sid = _new_voice_session(uid)
    append_transcript(sid, role="user", text="What's NVDA at")
    acc_id = get_default_account_id(uid)
    before = list_messages(user_id=uid, account_id=acc_id, limit=100)["messages"]
    _bridge_session_to_compass_thread(sid, uid)
    after = list_messages(user_id=uid, account_id=acc_id, limit=100)["messages"]
    assert len(after) == len(before)


def test_bridge_posts_summary_for_real_conversation():
    """User + Compass turns → a single summary message appended to thread."""
    uid = _user()
    sid = _new_voice_session(uid)
    append_transcript(sid, role="user", text="Check NVDA for me")
    append_transcript(sid, role="assistant", text="NVDA's up 2.3 percent at 215.")
    append_transcript(sid, role="user", text="Should I take it?")
    append_transcript(sid, role="assistant", text="No — it's extended off the 20 EMA.")

    acc_id = get_default_account_id(uid)
    before = list_messages(user_id=uid, account_id=acc_id, limit=100)["messages"]
    _bridge_session_to_compass_thread(sid, uid)
    after = list_messages(user_id=uid, account_id=acc_id, limit=100)["messages"]
    assert len(after) == len(before) + 1

    new = after[-1]
    assert new["role"] == "assistant"
    assert "Voice session" in new["content"]
    assert "Check NVDA" in new["content"]
    assert "extended" in new["content"]


def test_bridge_marks_source_in_metadata():
    """Bridged messages carry source=voice_session metadata for the UI to render differently."""
    uid = _user()
    sid = _new_voice_session(uid)
    append_transcript(sid, role="user", text="hi")
    append_transcript(sid, role="assistant", text="ready")

    _bridge_session_to_compass_thread(sid, uid)
    acc_id = get_default_account_id(uid)
    msgs = list_messages(user_id=uid, account_id=acc_id, limit=100)["messages"]
    new = msgs[-1]
    meta = new.get("metadata") or {}
    if isinstance(meta, str):
        import json
        meta = json.loads(meta)
    assert meta.get("source") == "voice_session"
    assert meta.get("session_id") == sid
    assert meta.get("turn_count") == 2


def test_bridge_never_raises_on_failure(monkeypatch):
    """Bridge swallows all errors — voice session end must not break."""
    uid = _user()
    sid = _new_voice_session(uid)
    # Simulate a broken append_message — bridge should still return cleanly
    import api.routers.voice as voice_router

    def _boom(*a, **k):
        raise RuntimeError("DB down")

    monkeypatch.setattr(
        "api.services.journal_two.coach_chat.append_message", _boom
    )
    # Should not raise
    _bridge_session_to_compass_thread(sid, uid)


def test_bridge_no_op_for_unknown_session():
    """Session that doesn't exist → no-op, no exception."""
    uid = _user()
    _bridge_session_to_compass_thread(99999999, uid)  # nonexistent
    # No assertion — just must not raise
