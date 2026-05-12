"""Explainability — structured 'why did you say that'."""

import uuid
import time

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_explainability as ve
from api.services.voice_session_service import (
    create_session, append_transcript, end_session,
)
from api.services.voice_reward_model import record_variant
from api.services.voice_feedback_service import record_tool_call
from api.services.voice_memory_service import add_fact


def _user():
    init_db()
    return create_user(f"vex_{uuid.uuid4()}@x.com", "p")["id"]


def test_explain_unknown_session():
    uid = _user()
    out = ve.explain_turn(user_id=uid, session_id=99999)
    assert out["ok"] is False


def test_explain_basic_session_shape():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb",
                         page_context="analyst")
    record_variant(sid, uid, variant_id="analyst_v1", agent_ctx="analyst")
    append_transcript(sid, role="user", text="what's NVDA at")
    append_transcript(sid, role="assistant", text="NVDA at 200, up 2%")
    record_tool_call(uid, tool_name="get_quote",
                     args={"symbol": "NVDA"}, ok=True, session_id=sid)
    end_session(sid, duration_seconds=10)

    out = ve.explain_turn(user_id=uid, session_id=sid)
    assert out["ok"] is True
    assert out["session"]["id"] == sid
    assert out["variant"]["variant_id"] == "analyst_v1"
    assert len(out["data_sources"]) >= 1
    assert out["data_sources"][0]["tool"] == "get_quote"
    assert "Session ran" in out["narration"]


def test_explain_filters_by_turn_text():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb")
    append_transcript(sid, role="user", text="quote NVDA")
    append_transcript(sid, role="assistant", text="NVDA at 200")
    # Wait a beat so timestamps differentiate
    time.sleep(0.01)
    record_tool_call(uid, tool_name="get_quote", args={"symbol": "AMD"},
                     ok=True, session_id=sid)
    append_transcript(sid, role="user", text="quote AMD")
    append_transcript(sid, role="assistant", text="AMD at 150")

    out = ve.explain_turn(user_id=uid, session_id=sid,
                          turn_text="NVDA at 200")
    assert out["ok"] is True
    assert out["target_turn"] is not None
    assert "NVDA at 200" in out["target_turn"]["text"]


def test_explain_includes_facts_and_corrections():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb")
    add_fact(uid, text="I trade swing setups", category="style")
    out = ve.explain_turn(user_id=uid, session_id=sid)
    assert out["ok"] is True
    assert out["facts_in_play_count"] >= 1
    assert any("swing" in (f.get("text") or "")
                for f in out["facts_in_play"])


def test_explain_user_isolation():
    a = _user()
    b = _user()
    sid = create_session(user_id=a, mode="c", source="orb")
    # B can't explain A's session
    out = ve.explain_turn(user_id=b, session_id=sid)
    assert out["ok"] is False


def test_explain_handles_session_with_no_tool_calls():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb")
    append_transcript(sid, role="user", text="hi")
    append_transcript(sid, role="assistant", text="hey")
    out = ve.explain_turn(user_id=uid, session_id=sid)
    assert out["ok"] is True
    assert out["data_sources"] == []
