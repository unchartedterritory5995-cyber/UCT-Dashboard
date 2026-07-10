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


def test_highlight_is_exclusive_per_thread(store):
    tid = store.create_thread("questions", "u1", "q")
    p1 = store.create_post(tid, "u2", "{}")
    p2 = store.create_post(tid, "u3", "{}")
    store.set_highlight(p1, True)
    store.set_highlight(p2, True)
    posts = {p["id"]: p for p in store.get_thread(tid)["posts"]}
    assert posts[p1]["mentor_highlight"] == 0
    assert posts[p2]["mentor_highlight"] == 1


def test_reaction_toggle(store):
    tid = store.create_thread("wins-lessons", "u1", "w")
    pid = store.create_post(tid, "u2", "{}")
    assert store.toggle_reaction(pid, "u3", "fire") is True
    assert store.get_thread(tid)["posts"][0]["reactions"] == {"fire": 1}
    assert store.toggle_reaction(pid, "u3", "fire") is False
    assert store.get_thread(tid)["posts"][0]["reactions"] == {}
    with pytest.raises(ValueError, match="bad-kind"):
        store.toggle_reaction(pid, "u3", "rocketship")


def test_unread_summary_and_mark_read(store):
    tid = store.create_thread("trade-ideas", "u1", "t")
    pid = store.create_post(tid, "u2", "{}")
    s = store.unread_summary("u3")
    assert s["total"] == 1 and s["by_space"]["trade-ideas"] == 1
    store.mark_read("u3", tid, pid)
    assert store.unread_summary("u3")["total"] == 0
    # monotonic: marking an older post doesn't regress
    p2 = store.create_post(tid, "u2", "{}")
    store.mark_read("u3", tid, p2)
    store.mark_read("u3", tid, pid)
    assert store.unread_summary("u3")["total"] == 0


def test_reports_lifecycle(store):
    tid = store.create_thread("questions", "u1", "spam thread")
    rid = store.create_report("u2", "spam", thread_id=tid)
    open_reports = store.list_reports("open")
    assert [r["id"] for r in open_reports] == [rid]
    assert "spam thread" in open_reports[0]["preview"]
    store.set_report_status(rid, "dismissed")
    assert store.list_reports("open") == []
    with pytest.raises(ValueError, match="bad-target"):
        store.create_report("u2", "both", thread_id=1, post_id=1)


def test_mute_and_ack(store):
    assert store.is_muted("u1") is False
    store.set_muted("u1", True)
    assert store.is_muted("u1") is True
    store.set_muted("u1", False)
    assert store.is_muted("u1") is False
    assert store.has_ack("u1") is False
    store.set_ack("u1")
    assert store.has_ack("u1") is True


def test_desk_thread_summaries_single_query(store):
    t1 = store.create_thread("mentor-desk", None, "S1", desk_content_id=41)
    store.create_post(t1, "u-a", "{}")
    store.create_post(t1, "u-b", "{}")
    store.create_thread("mentor-desk", None, "S2", desk_content_id=42)  # zero replies
    summ = store.get_desk_thread_summaries(["41", "42", "99"])
    assert summ["41"] == {"thread_id": t1, "reply_count": 2}
    assert summ["42"]["reply_count"] == 0
    assert "99" not in summ                       # no thread for that desk id
    # soft-deleted seeded thread is excluded
    store.soft_delete_thread(t1)
    assert "41" not in store.get_desk_thread_summaries(["41"])


def test_unread_excludes_own_threads_but_counts_mentor_seed(store):
    # a member's own thread must NOT ping them as unread...
    own = store.create_thread("trade-ideas", "u-me", "mine", body="{}")
    assert store.unread_summary("u-me")["total"] == 0
    # ...but a mentor-desk seed (author_id NULL) counts as unread for everyone
    store.create_thread("mentor-desk", None, "Session", body="{}", desk_content_id=7)
    s = store.unread_summary("u-me")
    assert s["total"] == 1 and s["by_space"]["mentor-desk"] == 1
    # and another member DOES see the first member's thread as unread
    assert store.unread_summary("u-other")["by_space"]["trade-ideas"] == 1
