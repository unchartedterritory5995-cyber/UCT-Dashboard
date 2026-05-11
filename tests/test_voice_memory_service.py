"""Voice memory service — user facts + session summaries."""

import json
from api.services.auth_db import init_db
from api.services.auth_service import create_user
from api.services.voice_session_service import create_session
from api.services.voice_memory_service import (
    add_fact, list_facts, update_fact, delete_fact,
    add_summary, list_summaries, search_summaries,
    build_memory_context,
    MAX_MEMORY_CHARS,
)


def _user():
    init_db()
    return create_user(f"vm_{__import__('uuid').uuid4()}@example.com", "p")["id"]


def test_add_and_list_facts():
    uid = _user()
    f1 = add_fact(uid, text="I trade small caps under $5B", category="style")
    f2 = add_fact(uid, text="My Swing account is the primary one", category="account_alias")
    facts = list_facts(uid)
    ids = {f["id"] for f in facts}
    assert f1 in ids and f2 in ids
    assert any("small caps" in f["text"] for f in facts)


def test_update_fact():
    uid = _user()
    fid = add_fact(uid, text="I trade small caps", category="style")
    update_fact(fid, text="I trade small caps under $5B", category="style")
    facts = list_facts(uid)
    target = next(f for f in facts if f["id"] == fid)
    assert "under $5B" in target["text"]


def test_delete_fact():
    uid = _user()
    fid = add_fact(uid, text="some fact", category="general")
    delete_fact(fid, user_id=uid)
    facts = list_facts(uid)
    assert all(f["id"] != fid for f in facts)


def test_delete_fact_only_for_owner():
    uid = _user()
    other = _user()
    fid = add_fact(uid, text="my fact", category="general")
    delete_fact(fid, user_id=other)
    facts = list_facts(uid)
    assert any(f["id"] == fid for f in facts)


def test_add_and_search_summaries():
    uid = _user()
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    add_summary(
        session_id=sid, user_id=uid,
        summary_text="Discussed NVDA earnings and TSLA short setup",
        key_topics=["NVDA", "TSLA", "earnings", "short"],
    )
    matches = search_summaries(uid, query="NVDA")
    assert matches and "NVDA" in matches[0]["summary_text"]


def test_build_memory_context_caps_size():
    uid = _user()
    for i in range(100):
        add_fact(uid, text=f"fact number {i} with some content " * 5, category="general")
    sid = create_session(user_id=uid, mode="c", source="orb", page_context="global")
    for i in range(20):
        add_summary(session_id=sid, user_id=uid,
                    summary_text=f"summary {i} " * 30, key_topics=[])

    ctx = build_memory_context(uid)
    assert len(ctx) <= MAX_MEMORY_CHARS
    assert isinstance(ctx, str)


def test_build_memory_context_empty_for_new_user():
    uid = _user()
    ctx = build_memory_context(uid)
    assert ctx == ""
