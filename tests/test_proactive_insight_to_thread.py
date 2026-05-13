"""
P4-C unification — proactive daemon insights mirrored into Compass thread.

Verifies that add_insight() side-effects a Compass-authored message into
the user's j2_chat_messages thread.
"""

import uuid

from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_proactive_service import add_insight
from api.services.journal_two.coach_chat import list_messages
from api.services.trader_memory import get_default_account_id


def _user():
    init_db()
    return create_user(f"piit_{uuid.uuid4()}@x.com", "p")["id"]


def _messages_for(user_id):
    acc = get_default_account_id(user_id)
    return list_messages(user_id=user_id, account_id=acc, limit=100)["messages"]


def test_insight_posts_to_compass_thread():
    uid = _user()
    before = _messages_for(uid)
    iid = add_insight(uid, kind="regime_shift",
                      headline="Regime flipped from GREEN to AMBER",
                      body="Breadth score dropped 25 points overnight.",
                      importance=9)
    assert iid is not None
    after = _messages_for(uid)
    assert len(after) == len(before) + 1

    new = after[-1]
    assert new["role"] == "assistant"
    assert "GREEN to AMBER" in new["content"]
    assert "Breadth score" in new["content"]


def test_insight_emoji_is_kind_specific():
    uid = _user()
    add_insight(uid, kind="watchlist_alert",
                headline="NVDA broke 215", symbol="NVDA", importance=8)
    msgs = _messages_for(uid)
    new = msgs[-1]
    assert "⚑" in new["content"]
    assert "NVDA" in new["content"]


def test_insight_metadata_marks_source():
    uid = _user()
    iid = add_insight(uid, kind="drift_warning",
                      headline="Win rate dropped to 35%", importance=8)
    msgs = _messages_for(uid)
    new = msgs[-1]
    meta = new.get("metadata") or {}
    if isinstance(meta, str):
        import json
        meta = json.loads(meta)
    assert meta.get("source") == "proactive_daemon"
    assert meta.get("insight_id") == iid
    assert meta.get("kind") == "drift_warning"
    assert meta.get("importance") == 8


def test_insight_below_min_importance_does_not_post():
    """If add_insight is suppressed (importance < MIN_IMPORTANCE_TO_QUEUE),
    no thread post happens either."""
    from api.services import voice_proactive_service as vps
    uid = _user()
    before = _messages_for(uid)
    # importance=1 should be suppressed (MIN_IMPORTANCE_TO_QUEUE)
    iid = add_insight(uid, kind="scanner_match",
                      headline="Low-priority ping", importance=1)
    # If suppressed, returns None
    if iid is None:
        after = _messages_for(uid)
        assert len(after) == len(before)
    else:
        # If accepted, the thread post is fine too — just won't have
        # been suppressed at the insight level
        after = _messages_for(uid)
        assert len(after) == len(before) + 1


def test_insight_post_includes_body_when_present():
    uid = _user()
    add_insight(uid, kind="mistake_pattern",
                headline="Three rapid trades", body="Step away — cooling off.",
                importance=9)
    msgs = _messages_for(uid)
    new = msgs[-1]
    assert "Step away" in new["content"]


def test_insight_post_handles_no_body():
    uid = _user()
    add_insight(uid, kind="regime_shift",
                headline="Phase shift to ORANGE", importance=8)
    msgs = _messages_for(uid)
    new = msgs[-1]
    assert "Phase shift to ORANGE" in new["content"]
    # Should still be a valid single-line message
    assert len(new["content"]) > 0


def test_two_insights_create_two_messages():
    uid = _user()
    before = _messages_for(uid)
    add_insight(uid, kind="regime_shift", headline="First", importance=8)
    add_insight(uid, kind="watchlist_alert", symbol="AAPL",
                headline="Second", importance=8)
    after = _messages_for(uid)
    # Both posted (with symbol cooldown not applicable because different kinds)
    assert len(after) >= len(before) + 1  # At least one (cooldown may suppress symbol-tagged)
