# tests/api/test_floor_store.py
"""The Floor (forum v2 / redesign) store — schema migration, votes, emoji
reactions, deep nesting, accepted answers, bookmarks, feed, events, search."""
import pytest


@pytest.fixture
def store(monkeypatch, tmp_path):
    monkeypatch.setenv("COMMUNITY_DB_PATH", str(tmp_path / "community.db"))
    from api.services import community_store
    community_store._init_db()
    return community_store


def test_migration_adds_columns_and_tables(store):
    with store.get_connection() as conn:
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        assert {"floor_votes", "floor_reactions", "floor_bookmarks",
                "floor_events", "floor_attachments"} <= tables
        tcols = {r[1] for r in conn.execute("PRAGMA table_info(threads)").fetchall()}
        assert {"flair", "score", "answer_post_id", "chart_json"} <= tcols
        pcols = {r[1] for r in conn.execute("PRAGMA table_info(posts)").fetchall()}
        assert {"score", "chart_json"} <= pcols


def test_migration_is_idempotent(store):
    # Re-running _init_db must not raise (ALTER + swallow duplicate-column).
    store._init_db()
    store._init_db()


def test_thread_defaults(store):
    tid = store.create_floor_thread("alice", "A gap-up question", flair="Question")
    feed = store.list_feed()
    assert len(feed) == 1
    assert feed[0]["flair"] == "Question"
    assert feed[0]["score"] == 0


def test_bad_flair_falls_back_to_discussion(store):
    tid = store.create_floor_thread("alice", "t", flair="Nonsense")
    assert store.list_feed()[0]["flair"] == "Discussion"


def test_deep_nesting_allowed(store):
    tid = store.create_floor_thread("alice", "t")
    c1 = store.create_floor_post(tid, "bob", '{"type":"doc"}')
    c2 = store.create_floor_post(tid, "carol", '{"type":"doc"}', parent_post_id=c1)
    c3 = store.create_floor_post(tid, "dave", '{"type":"doc"}', parent_post_id=c2)
    det = store.get_floor_thread(tid)
    parents = {p["id"]: p["parent_post_id"] for p in det["posts"]}
    assert parents == {c1: None, c2: c1, c3: c2}


def test_bad_parent_rejected(store):
    tid = store.create_floor_thread("alice", "t")
    other = store.create_floor_thread("alice", "other")
    op = store.create_floor_post(other, "bob", '{"type":"doc"}')
    with pytest.raises(ValueError, match="bad-parent"):
        store.create_floor_post(tid, "bob", '{"type":"doc"}', parent_post_id=op)


def test_vote_score_math_and_toggle(store):
    tid = store.create_floor_thread("alice", "t")
    assert store.toggle_vote("thread", tid, "bob", 1) == {"score": 1, "my_vote": 1}
    assert store.toggle_vote("thread", tid, "carol", 1) == {"score": 2, "my_vote": 1}
    # bob flips to downvote: 2 -> 0
    assert store.toggle_vote("thread", tid, "bob", -1) == {"score": 0, "my_vote": -1}
    # bob toggles the downvote off: 0 -> 1 (only carol's up remains)
    assert store.toggle_vote("thread", tid, "bob", -1) == {"score": 1, "my_vote": 0}
    # denormalized onto the row
    assert store.list_feed(viewer_id="carol")[0]["score"] == 1
    assert store.list_feed(viewer_id="carol")[0]["my_vote"] == 1


def test_bad_vote_rejected(store):
    tid = store.create_floor_thread("alice", "t")
    with pytest.raises(ValueError):
        store.toggle_vote("thread", tid, "bob", 5)
    with pytest.raises(ValueError):
        store.toggle_vote("banana", tid, "bob", 1)


def test_emoji_reaction_toggle_and_summary(store):
    tid = store.create_floor_thread("alice", "t")
    assert store.toggle_emoji_reaction("thread", tid, "bob", "\U0001f525") is True
    assert store.toggle_emoji_reaction("thread", tid, "carol", "\U0001f525") is True
    assert store.toggle_emoji_reaction("thread", tid, "bob", "\U0001f9e0") is True
    d = store.list_feed(viewer_id="bob")[0]
    by = {r["emoji"]: r for r in d["reactions"]}
    assert by["\U0001f525"]["count"] == 2 and by["\U0001f525"]["reacted"] is True
    assert by["\U0001f9e0"]["count"] == 1
    # carol has not reacted with brain
    d2 = store.list_feed(viewer_id="carol")[0]
    by2 = {r["emoji"]: r for r in d2["reactions"]}
    assert by2["\U0001f9e0"]["reacted"] is False
    # un-react
    assert store.toggle_emoji_reaction("thread", tid, "bob", "\U0001f525") is False
    d3 = store.list_feed(viewer_id="bob")[0]
    assert {r["emoji"]: r["count"] for r in d3["reactions"]}["\U0001f525"] == 1


def test_bookmark_toggle_and_filter(store):
    t1 = store.create_floor_thread("alice", "one")
    t2 = store.create_floor_thread("alice", "two")
    assert store.toggle_bookmark("bob", t1) is True
    assert store.list_bookmark_ids("bob") == [t1]
    assert [d["id"] for d in store.list_feed(filter="bookmarks", viewer_id="bob")] == [t1]
    assert store.toggle_bookmark("bob", t1) is False
    assert store.list_bookmark_ids("bob") == []


def test_accepted_answer(store):
    tid = store.create_floor_thread("alice", "q", flair="Question")
    c1 = store.create_floor_post(tid, "bob", '{"type":"doc"}')
    assert store.set_answer(tid, c1) == c1
    d = store.list_feed()[0]
    assert d["answer_post_id"] == c1 and d["answered"] == 1
    # toggling the same answer clears it
    assert store.set_answer(tid, c1) is None
    assert store.list_feed()[0]["answered"] == 0
    # bad post id rejected
    with pytest.raises(ValueError, match="bad-post"):
        store.set_answer(tid, 999999)


def test_feed_flair_and_myposts_filter(store):
    store.create_floor_thread("alice", "q", flair="Question")
    store.create_floor_thread("bob", "idea", flair="Trade Idea")
    store.create_floor_thread("alice", "lesson", flair="Lesson")
    assert len(store.list_feed(flair="Question")) == 1
    assert len(store.list_feed(flair="Trade Idea")) == 1
    assert {d["title"] for d in store.list_feed(filter="myposts", viewer_id="alice")} \
        == {"q", "lesson"}


def test_feed_sorts(store):
    a = store.create_floor_thread("alice", "old")
    b = store.create_floor_thread("bob", "new")
    store.toggle_vote("thread", a, "x", 1)
    store.toggle_vote("thread", a, "y", 1)
    top = store.list_feed(sort="top")
    assert top[0]["id"] == a  # highest score first
    new = store.list_feed(sort="new")
    assert new[0]["id"] == b  # newest first


def test_pinned_floats_to_top(store):
    a = store.create_floor_thread("alice", "normal")
    b = store.create_floor_thread("bob", "pinned")
    with store.get_connection() as conn:
        conn.execute("UPDATE threads SET pinned=1 WHERE id=?", (b,))
        conn.commit()
    assert store.list_feed(sort="new")[0]["id"] == b


def test_events_notifications_self_excluded(store):
    tid = store.create_floor_thread("alice", "t")
    c1 = store.create_floor_post(tid, "bob", '{"type":"doc"}')
    store.add_event("comment", actor_id="bob", thread_id=tid, post_id=c1,
                    target_user_id="alice")
    store.add_event("reaction", actor_id="carol", thread_id=tid,
                    emoji="\U0001f525", target_user_id="alice")
    # actor == target: never notified
    store.add_event("comment", actor_id="alice", thread_id=tid, post_id=c1,
                    target_user_id="alice")
    assert store.unread_notifications("alice") == 2
    kinds = [n["kind"] for n in store.list_notifications("alice")]
    assert kinds.count("comment") == 1 and kinds.count("reaction") == 1
    # activity shows all three (global)
    assert len(store.list_activity()) == 3
    store.mark_notifications_seen("alice")
    assert store.unread_notifications("alice") == 0


def test_search_is_dash_agnostic(store):
    store.create_floor_thread("alice", "How to handle a gap-up on a swing",
                              body="thoughts on gap ups")
    store.create_floor_thread("bob", "VCP vs flag", body="pattern talk")
    assert [d["title"] for d in store.search_floor("gap up")] == \
        ["How to handle a gap-up on a swing"]
    assert store.search_floor("zzzznope") == []


def test_search_matches_ticker_tags(store):
    store.create_floor_thread("alice", "setup idea", ticker_tags=["NVDA"])
    assert len(store.search_floor("nvda")) == 1


def test_chart_json_roundtrip(store):
    tid = store.create_floor_thread("alice", "t",
                                    chart_json={"ticker": "PLTR", "tf": "1D"})
    c1 = store.create_floor_post(tid, "bob", '{"type":"doc"}',
                                 chart_json={"ticker": "AMD", "tf": "5m"})
    det = store.get_floor_thread(tid)
    assert det["chart_json"] == {"ticker": "PLTR", "tf": "1D"}
    assert det["posts"][0]["chart_json"] == {"ticker": "AMD", "tf": "5m"}


def test_deleted_post_body_blanked_in_detail(store):
    tid = store.create_floor_thread("alice", "t")
    c1 = store.create_floor_post(tid, "bob", '{"type":"doc"}',
                                 chart_json={"ticker": "AMD"})
    store.soft_delete_post(c1)
    det = store.get_floor_thread(tid)
    assert det["posts"][0]["body"] == "" and det["posts"][0]["chart_json"] is None
    # deleted post not counted in reply_count
    assert det["reply_count"] == 0
