# tests/api/test_community_store.py
import os
import sqlite3
import tempfile

import pytest


@pytest.fixture
def store(monkeypatch, tmp_path):
    """community_store pointed at a temp DB (path read dynamically per call)."""
    monkeypatch.setenv("COMMUNITY_DB_PATH", str(tmp_path / "community.db"))
    from api.services import community_store
    community_store._init_db()
    return community_store


def test_init_creates_tables(store):
    with store.get_connection() as conn:
        names = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    assert {"threads", "posts", "reactions", "reports",
            "read_state", "muted_users", "acks"} <= names


def test_spaces_fixed(store):
    assert set(store.SPACES) == {"mentor-desk", "trade-ideas", "questions", "wins-lessons"}
    assert store.SPACES["mentor-desk"]["mentor_only"] is True
    assert store.SPACES["trade-ideas"]["mentor_only"] is False


def test_thread_and_post_roundtrip(store):
    tid = store.create_thread("trade-ideas", "u1", "NVDA setup", body='{"type":"doc"}',
                              ticker_tags=["NVDA"])
    rows = store.list_threads("trade-ideas")
    assert [r["id"] for r in rows] == [tid]
    assert rows[0]["reply_count"] == 0

    p1 = store.create_post(tid, "u2", '{"type":"doc"}')
    p2 = store.create_post(tid, "u3", '{"type":"doc"}', parent_post_id=p1)
    t = store.get_thread(tid)
    assert [p["id"] for p in t["posts"]] == [p1, p2]
    assert store.list_threads("trade-ideas")[0]["reply_count"] == 2

    # one-level nesting only: replying to a reply is rejected
    with pytest.raises(ValueError, match="bad-parent"):
        store.create_post(tid, "u4", '{"type":"doc"}', parent_post_id=p2)


def test_bad_space_rejected(store):
    with pytest.raises(ValueError, match="bad-space"):
        store.create_thread("random-room", "u1", "x")


def test_locked_thread_rejects_posts(store):
    tid = store.create_thread("questions", "u1", "q")
    store.set_thread_flag(tid, "locked", 1)  # defined in Task 3; stub inline for now
    with pytest.raises(ValueError, match="locked"):
        store.create_post(tid, "u2", '{"type":"doc"}')


def test_soft_delete_redacts_post_body(store):
    tid = store.create_thread("questions", "u1", "q")
    pid = store.create_post(tid, "u2", '{"type":"doc"}')
    store.soft_delete_post(pid)
    t = store.get_thread(tid)
    assert t["posts"][0]["deleted"] == 1
    assert t["posts"][0]["body"] == ""


def test_pinned_sorts_first(store):
    a = store.create_thread("trade-ideas", "u1", "a")
    b = store.create_thread("trade-ideas", "u1", "b", pinned=1)
    assert [r["id"] for r in store.list_threads("trade-ideas")] == [b, a]


def test_rate_limit_counters(store):
    for _ in range(3):
        store.create_thread("trade-ideas", "u9", "t")
    assert store.count_recent_threads("u9") == 3
    assert store.count_recent_threads("someone-else") == 0
