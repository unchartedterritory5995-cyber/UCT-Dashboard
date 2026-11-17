"""Account deletion takes the member tables the 2026-11-17 census found with it.

The census (`tests/test_alert_erasure.py::test_THE_CENSUS_...`) went red on master naming four
member-keyed tables an account deletion neither purged nor named:
  * `chart_iq_feedback`        (chart_iq_feedback.db) -- a member's Chart IQ votes and notes;
  * `agent_conversation_state` (uct_agent.db)         -- the UCT Agent's last screen and coach consent;
  * `study_game_runs`          (study.db)             -- a member's Study game runs;
  * `j2_note_tweet_captures`   (auth.db)              -- a member's imported tweet cards.
The first three are in their own databases, which no statement on the purge's auth.db connection
reaches: `member_store_erasure.purge_user` now deletes them. The fourth is deleted by the member's
id, not only through its AFTER DELETE trigger on `j2_note_documents`.

What this file makes impossible:
  1. A deleted member's row surviving in any of the four, or the OTHER member's row going: seeded
     for two members through each store's OWN write API, then the account deleted the way the
     admin door does it (`purge_user_data`, then `_cascade_delete_user`), counted by name:
     (deleted, other) must go (n, n) -> (0, n). The tweet card set includes one whose document row
     is already gone, which the trigger can never reach.
  2. A purge that CREATES a store file a pod never had.
  3. One broken store aborting the others.
"""
from __future__ import annotations

import sqlite3

import pytest

GONE, STAYS = "member-gone-0001", "member-stays-0002"
TS = "2026-11-17T12:00:00+00:00"


@pytest.fixture
def member_stores(tmp_path, monkeypatch):
    """The three stores at tmp paths, pointed at through each module's OWN path authority."""
    from api.services import study_store
    from api.services.uct_agent import store as agent_store
    paths = {"chart_iq_feedback": tmp_path / "chart_iq_feedback.db",
             "uct_agent": tmp_path / "uct_agent.db",
             "study": tmp_path / "study.db"}
    monkeypatch.setenv("CHART_IQ_FEEDBACK_DB", str(paths["chart_iq_feedback"]))
    monkeypatch.setattr(agent_store, "_DB_PATH", str(paths["uct_agent"]))
    monkeypatch.setattr(agent_store, "_READY", False)
    monkeypatch.setattr(study_store, "_DB_PATH", str(paths["study"]))
    from api.services import member_store_erasure as mse
    # Non-vacuity: the purge resolves exactly these files.
    assert {s.name: s.path() for s in mse.STORES} == {k: str(v) for k, v in paths.items()}
    return paths


def _seed_member_stores(paths) -> None:
    """One row per member in each store, written by the product's own doors' functions."""
    from api.services import study_store
    from api.services.chart_iq import feedback
    from api.services.uct_agent import store as agent_store
    study_store.init_db()
    for uid in (GONE, STAYS):
        feedback.save(uid, "AAA", "2026-11-17", "useful", note=f"what {uid} thought")
        conv = agent_store.create_conversation(uid, f"screen for {uid}")
        assert agent_store.set_state(uid, conv, "lastScreen", {"spec": {"filters": []}, "ids": ["AAA"]})
        study_store.record_game_run(uid, "size", f"run-{uid}", 3, 5)


def _auth_db(tmp_path) -> sqlite3.Connection:
    """An auth.db with the real users DDL and the Journal schema; both members, each with one
    imported tweet card on a live document AND one whose document row is already gone."""
    from api.services import auth_db
    from api.services.journal_two.db import ensure_schema
    conn = sqlite3.connect(tmp_path / "auth.db")
    conn.row_factory = sqlite3.Row
    conn.executescript(auth_db._SCHEMA)
    ensure_schema(conn)
    for uid in (GONE, STAYS):
        conn.execute("INSERT INTO users (id, email, password_hash, display_name, role) "
                     "VALUES (?, ?, 'x', 'n', 'member')", (uid, f"{uid}@example.test"))
        conn.execute("INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
                     " VALUES (?,?,?,?,?,?,?,?)", (f"note-{uid}", uid, "t", '{"type":"doc"}', "b", "[]", TS, TS))
        conn.execute("INSERT INTO j2_note_documents (id, user_id, note_id, attachment_url, status, created_at)"
                     " VALUES (?,?,?,?,'ready',?)", (f"doc-{uid}", uid, f"note-{uid}", f"tweet:{uid}", TS))
        for doc in (f"doc-{uid}", f"doc-gone-{uid}"):
            conn.execute("INSERT INTO j2_note_tweet_captures (document_id, user_id, note_id, tweet_id, author_handle,"
                         " created_at) VALUES (?,?,?,?,?,?)", (doc, uid, f"note-{uid}", "1", "someone", TS))
    conn.commit()
    return conn


def _count(path, table, uid) -> int:
    k = sqlite3.connect(path)
    try:
        return k.execute(f'SELECT COUNT(*) FROM "{table}" WHERE user_id = ?', (uid,)).fetchone()[0]
    finally:
        k.close()


# ── 1. the account deletion empties all four, for the member and only them ─────────────────

def test_deleting_an_account_leaves_none_of_its_rows_in_the_four_census_tables(member_stores, tmp_path, monkeypatch):
    from api.routers.auth import _cascade_delete_user
    from api.services import account_tombstones as at
    from api.services.journal_two import account_purge
    monkeypatch.setenv(at.LOCAL_STORE_ENV, str(tmp_path / "tombs"))
    _seed_member_stores(member_stores)
    auth_path = tmp_path / "auth.db"
    conn = _auth_db(tmp_path)
    where = {"chart_iq_feedback": member_stores["chart_iq_feedback"],
             "agent_conversation_state": member_stores["uct_agent"],
             "study_game_runs": member_stores["study"],
             "j2_note_tweet_captures": auth_path}

    def counts():
        return {t: (_count(p, t, GONE), _count(p, t, STAYS)) for t, p in where.items()}

    try:
        before = counts()
        assert before == {"chart_iq_feedback": (1, 1), "agent_conversation_state": (1, 1),
                          "study_game_runs": (1, 1), "j2_note_tweet_captures": (2, 2)}, before
        report = account_purge.purge_user_data(GONE, conn)       # the admin door's order:
        _cascade_delete_user(conn, GONE)                          # the purge, then the account row
        assert conn.execute("SELECT COUNT(*) FROM users WHERE id = ?", (GONE,)).fetchone()[0] == 0
    finally:
        conn.close()
    assert report["errors"] == [], report["errors"]
    after = counts()
    assert after == {"chart_iq_feedback": (0, 1), "agent_conversation_state": (0, 1),
                     "study_game_runs": (0, 1), "j2_note_tweet_captures": (0, 2)}, (
        f"(deleted member, other member) rows after the account deletion: {after}")
    # The report names what it deleted, store by store.
    assert report["member_stores"]["rows_deleted"] == {
        "chart_iq_feedback": 1, "agent_conversation_state": 1, "study_game_runs": 1}
    # (The card on a live document already went with it -- j2_notes' trigger takes the documents,
    # theirs takes the cards; the direct delete is what reaches the card whose document was gone.)
    assert report["rows_deleted"]["j2_note_tweet_captures"] == 1


# ── 2. a store this pod never created is never created by the purge ─────────────────────────

def test_a_store_that_does_not_exist_is_reported_absent_and_is_never_created(tmp_path, monkeypatch):
    from api.services import member_store_erasure as mse
    from api.services import study_store
    from api.services.uct_agent import store as agent_store
    nope = tmp_path / "never"
    monkeypatch.setenv("CHART_IQ_FEEDBACK_DB", str(nope / "chart_iq_feedback.db"))
    monkeypatch.setattr(agent_store, "_DB_PATH", str(nope / "uct_agent.db"))
    monkeypatch.setattr(agent_store, "_READY", False)
    monkeypatch.setattr(study_store, "_DB_PATH", str(nope / "study.db"))
    rep = mse.purge_user(GONE)
    assert rep["errors"] == [] and rep["ok"] is True, rep
    assert {db: r.get("absent") for db, r in rep["stores"].items()} == {
        "chart_iq_feedback.db": True, "uct_agent.db": True, "study.db": True}
    assert set(rep["rows_deleted"]) == {"chart_iq_feedback", "agent_conversation_state", "study_game_runs"}
    assert not nope.exists()


# ── 3. one broken store never aborts the others ─────────────────────────────────────────────

def test_a_broken_store_is_reported_and_the_others_are_still_purged(member_stores):
    from api.services import member_store_erasure as mse
    _seed_member_stores(member_stores)
    member_stores["chart_iq_feedback"].write_bytes(b"this is not a sqlite database" * 64)
    rep = mse.purge_user(GONE)
    assert rep["ok"] is False
    assert [e for e in rep["errors"] if e.startswith("chart_iq_feedback.db")], rep["errors"]
    assert _count(member_stores["uct_agent"], "agent_conversation_state", GONE) == 0
    assert _count(member_stores["study"], "study_game_runs", GONE) == 0
    assert _count(member_stores["study"], "study_game_runs", STAYS) == 1
