"""Voice scratchpad — per-session working memory."""

import uuid
import pytest

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services import voice_scratchpad_service as vss
from api.services.voice_session_service import create_session


def _user_and_session():
    init_db()
    uid = create_user(f"vss_{uuid.uuid4()}@example.com", "p")["id"]
    sid = create_session(user_id=uid, mode="c", source="orb")
    return uid, sid


def test_write_and_read_note():
    uid, sid = _user_and_session()
    vss.write_note(user_id=uid, session_id=sid, key="nvda_quote", value="200 up 2%")
    assert vss.read_note(session_id=sid, key="nvda_quote") == "200 up 2%"


def test_write_overwrites_existing_key():
    uid, sid = _user_and_session()
    vss.write_note(user_id=uid, session_id=sid, key="nvda", value="v1")
    vss.write_note(user_id=uid, session_id=sid, key="nvda", value="v2")
    assert vss.read_note(session_id=sid, key="nvda") == "v2"


def test_read_missing_key_returns_none():
    _, sid = _user_and_session()
    assert vss.read_note(session_id=sid, key="missing") is None


def test_list_notes():
    uid, sid = _user_and_session()
    vss.write_note(user_id=uid, session_id=sid, key="a", value="1")
    vss.write_note(user_id=uid, session_id=sid, key="b", value="2")
    notes = vss.list_notes(session_id=sid)
    assert len(notes) == 2
    keys = {n["key"] for n in notes}
    assert keys == {"a", "b"}


def test_write_rejects_empty_key():
    uid, sid = _user_and_session()
    with pytest.raises(ValueError):
        vss.write_note(user_id=uid, session_id=sid, key="", value="x")


def test_write_rejects_empty_value():
    uid, sid = _user_and_session()
    with pytest.raises(ValueError):
        vss.write_note(user_id=uid, session_id=sid, key="k", value="")


def test_write_truncates_long_value():
    uid, sid = _user_and_session()
    long_v = "x" * (vss.MAX_VALUE_CHARS + 500)
    vss.write_note(user_id=uid, session_id=sid, key="k", value=long_v)
    stored = vss.read_note(session_id=sid, key="k")
    assert len(stored) == vss.MAX_VALUE_CHARS


def test_per_session_note_cap_enforced():
    uid, sid = _user_and_session()
    for i in range(vss.MAX_NOTES_PER_SESSION):
        vss.write_note(user_id=uid, session_id=sid, key=f"k{i}", value="v")
    # One more new key should raise
    with pytest.raises(ValueError, match="full"):
        vss.write_note(user_id=uid, session_id=sid, key="overflow", value="v")
    # But updating an existing key is fine
    vss.write_note(user_id=uid, session_id=sid, key="k0", value="updated")
    assert vss.read_note(session_id=sid, key="k0") == "updated"


def test_clear_session_wipes_all_notes():
    uid, sid = _user_and_session()
    vss.write_note(user_id=uid, session_id=sid, key="a", value="1")
    vss.write_note(user_id=uid, session_id=sid, key="b", value="2")
    removed = vss.clear_session(session_id=sid)
    assert removed == 2
    assert vss.list_notes(session_id=sid) == []


def test_sessions_are_isolated():
    uid, sid1 = _user_and_session()
    _, sid2 = _user_and_session()
    vss.write_note(user_id=uid, session_id=sid1, key="k", value="from_1")
    vss.write_note(user_id=uid, session_id=sid2, key="k", value="from_2")
    assert vss.read_note(session_id=sid1, key="k") == "from_1"
    assert vss.read_note(session_id=sid2, key="k") == "from_2"
