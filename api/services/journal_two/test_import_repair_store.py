"""Plan F Task 5: the import repair's progress, per-note log and notice tables, and their store.

Real schema (`ensure_schema` on a temp auth.db). Commits are checked from a SECOND connection,
so "commits" means another reader sees it, not just this connection.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services import auth_db
from api.services.journal_two import account_purge
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.import_repair import store

RUN = "run-1"
TABLES = ("j2_import_repair_progress", "j2_import_repair_log", "j2_import_repair_notices")


@pytest.fixture
def conn(tmp_path, monkeypatch):
    monkeypatch.setattr(auth_db, "_DB_PATH", str(tmp_path / "auth.db"))
    c = auth_db.get_connection()
    ensure_schema(c)
    yield c
    c.close()


def _other():
    """A second connection: what it sees is what was committed."""
    c = auth_db.get_connection()
    c.row_factory = sqlite3.Row
    return c


def _columns(c, table):
    return [(r[1], r[2], bool(r[3]), r[5]) for r in c.execute(f"PRAGMA table_info({table})")]


def test_tables_are_exactly_the_briefs(conn):
    assert _columns(conn, "j2_import_repair_progress") == [
        ("run_id", "TEXT", True, 1), ("user_id", "TEXT", True, 2), ("status", "TEXT", True, 0),
        ("notes_checked", "INTEGER", True, 0), ("notes_repaired", "INTEGER", True, 0),
        ("started_at", "TEXT", True, 0), ("finished_at", "TEXT", False, 0),
        # fix round 1, M-4: the one-runner-per-member lease
        ("lease_holder", "TEXT", False, 0), ("lease_at", "TEXT", False, 0)]
    assert _columns(conn, "j2_import_repair_log") == [
        ("id", "INTEGER", False, 1), ("run_id", "TEXT", True, 0), ("user_id", "TEXT", True, 0),
        ("note_id", "TEXT", True, 0), ("outcome", "TEXT", True, 0), ("shapes_json", "TEXT", True, 0),
        ("actions_json", "TEXT", True, 0), ("before_body_json", "TEXT", False, 0),
        ("created_at", "TEXT", True, 0)]
    assert _columns(conn, "j2_import_repair_notices") == [
        ("user_id", "TEXT", False, 1), ("loss_notes", "INTEGER", True, 0),
        ("created_at", "TEXT", True, 0), ("dismissed_at", "TEXT", False, 0)]
    indexed = [r[1] for r in conn.execute("PRAGMA index_list(j2_import_repair_log)")]  # (seq, name, ...)
    cols = {name: [r[2] for r in conn.execute(f"PRAGMA index_info({name})")] for name in indexed}
    assert ["run_id", "user_id"] in cols.values()


def test_ensure_schema_adds_the_tables_to_an_existing_database(conn):
    """A pod whose auth.db predates Plan F gets the tables on its next boot (`_J2_SCHEMA` runs
    on every `ensure_schema`, the path Plan C's new table takes too)."""
    for table in TABLES:
        conn.execute(f"DROP TABLE {table}")
    conn.commit()
    ensure_schema(conn)
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert set(TABLES) <= names


def test_outcomes_include_unchanged_and_the_started_row():
    """Brief + C12 (`unchanged`, counted, never logged) + C7 (`repair_started`, the undo copy
    committed BEFORE the write)."""
    assert store.OUTCOMES == ("repaired", "kept_edited", "race_lost", "failed", "fetch_failed",
                              "relist_requested", "unchanged", "repair_started")


def test_progress_marks_and_resumes(conn):
    assert store.member_done(conn, RUN, "u1") is False
    store.start_member(conn, RUN, "u1")
    conn.commit()
    row = _other().execute("SELECT * FROM j2_import_repair_progress").fetchone()
    assert (row["status"], row["notes_checked"], row["notes_repaired"], row["finished_at"]) == (
        "in_progress", 0, 0, None)
    assert store.member_done(conn, RUN, "u1") is False  # in progress is not done: resume it
    store.start_member(conn, RUN, "u1")  # a resumed run: INSERT OR IGNORE keeps the first start
    started = row["started_at"]
    store.finish_member(conn, RUN, "u1", checked=5, repaired=2)  # commits
    row = _other().execute("SELECT * FROM j2_import_repair_progress").fetchone()
    assert (row["status"], row["notes_checked"], row["notes_repaired"]) == ("done", 5, 2)
    assert row["started_at"] == started and row["finished_at"] is not None
    assert store.member_done(conn, RUN, "u1") is True
    assert store.member_done(conn, "run-2", "u1") is False  # another run starts over
    assert store.member_done(conn, RUN, "u2") is False


def test_one_runner_at_a_time_per_member(conn, caplog):
    """Fix round 1, M-4: the repair's write is timestamp-neutral, so its optimistic lock cannot
    stop a second runner. The store's lease does: a member held by a live runner is refused to
    any other (in any run); a lease older than `stale_after_s` is taken over, and that is
    logged; a runner that lost its lease learns it on renewal."""
    other = auth_db.get_connection()
    try:
        assert store.claim_member(conn, RUN, "u1", "runner-a") == []
        row = other.execute("SELECT status, lease_holder FROM j2_import_repair_progress").fetchone()
        assert tuple(row) == ("in_progress", "runner-a")  # committed: the other process sees it
        with pytest.raises(store.MemberBusy):
            store.claim_member(other, "run-2", "u1", "runner-b")
        with pytest.raises(store.MemberBusy):
            store.claim_member(other, RUN, "u1", "runner-b")
        assert store.claim_member(other, RUN, "u2", "runner-b") == []  # another member is free
        assert store.claim_member(conn, RUN, "u1", "runner-a") == []  # the holder may resume
        assert store.renew_lease(conn, RUN, "u1", "runner-a") is True
        # the holder died: its lease goes stale and is taken over, logged
        conn.execute("UPDATE j2_import_repair_progress SET lease_at = '2026-01-01T00:00:00+00:00'"
                     " WHERE user_id = 'u1'")
        conn.commit()
        with caplog.at_level("WARNING"):
            taken = store.claim_member(other, "run-2", "u1", "runner-b", stale_after_s=600)
        assert taken == [(RUN, "runner-a")]
        assert "stale" in caplog.text and "runner-a" in caplog.text
        assert store.renew_lease(conn, RUN, "u1", "runner-a") is False  # A learns it lost
        store.finish_member(other, "run-2", "u1", checked=1, repaired=0)
        lease = other.execute("SELECT lease_holder, lease_at FROM j2_import_repair_progress"
                              " WHERE run_id = 'run-2' AND user_id = 'u1'").fetchone()
        assert tuple(lease) == (None, None)  # a finished member holds no lease
        assert store.claim_member(conn, "run-3", "u1", "runner-c") == []
    finally:
        other.close()


def test_finish_member_is_holder_scoped(conn):
    """Task 7 review M-8: given its holder, `finish_member` finishes only a member this runner
    still holds; a runner whose lease was taken over gets `MemberBusy` and the member stays."""
    store.claim_member(conn, RUN, "u1", "runner-a")
    conn.execute("UPDATE j2_import_repair_progress SET lease_holder = 'runner-b'")
    conn.commit()
    with pytest.raises(store.MemberBusy):
        store.finish_member(conn, RUN, "u1", checked=1, repaired=0, holder="runner-a")
    assert store.member_done(conn, RUN, "u1") is False
    store.finish_member(conn, RUN, "u1", checked=1, repaired=0, holder="runner-b")
    assert store.member_done(conn, RUN, "u1") is True


def test_finish_member_refuses_a_member_never_started(conn):
    """Fix round 1, M-2: finishing a member nobody started is a runner bug, never a silent
    no-op that leaves it not-done and re-processed next run."""
    with pytest.raises(ValueError):
        store.finish_member(conn, RUN, "u1", checked=1, repaired=0)
    assert store.member_done(conn, RUN, "u1") is False


def test_record_notice_never_rearms_a_dismissed_notice(conn):
    """Fix round 1, I-1: while the notice is pending it shows the MOST loss notes any run found;
    once dismissed, no later run re-arms or changes it."""
    assert store.pending_notice(conn, "u1") is None
    store.record_notice(conn, "u1", 3)
    assert store.pending_notice(conn, "u1") == 3
    store.record_notice(conn, "u1", 9)  # a later run found more: the notice says so
    assert store.pending_notice(conn, "u1") == 9
    store.record_notice(conn, "u1", 5)  # fewer never lowers it
    assert store.pending_notice(conn, "u1") == 9
    created = conn.execute("SELECT created_at FROM j2_import_repair_notices").fetchone()[0]
    assert store.dismiss_notice(conn, "u1") is True
    assert store.pending_notice(conn, "u1") is None
    store.record_notice(conn, "u1", 12)  # a later run never re-arms it
    assert store.pending_notice(conn, "u1") is None
    row = conn.execute("SELECT loss_notes, created_at FROM j2_import_repair_notices").fetchone()
    assert (row[0], row[1]) == (9, created)  # a dismissed row is untouched
    assert store.dismiss_notice(conn, "u1") is False  # already dismissed
    assert store.dismiss_notice(conn, "nobody") is False


@pytest.mark.parametrize("count", [0, -2])
def test_a_notice_needs_a_loss(conn, count):
    """Fix round 1, M-6: a notice reading "0 notes" never reaches a member."""
    store.record_notice(conn, "u1", count)
    assert conn.execute("SELECT COUNT(*) FROM j2_import_repair_notices").fetchone()[0] == 0
    assert store.pending_notice(conn, "u1") is None


def test_dismiss_is_an_update(conn):
    store.record_notice(conn, "u1", 2)
    conn.commit()
    created = _other().execute("SELECT created_at FROM j2_import_repair_notices").fetchone()[0]
    assert store.dismiss_notice(conn, "u1") is True  # commits
    rows = _other().execute("SELECT * FROM j2_import_repair_notices").fetchall()
    assert len(rows) == 1  # never a DELETE
    assert (rows[0]["user_id"], rows[0]["loss_notes"], rows[0]["created_at"]) == ("u1", 2, created)
    assert rows[0]["dismissed_at"] is not None


def test_log_note_round_trips(conn):
    shapes = {"stranded_media_ref": 1, "bare_url": 1}
    actions = ["linkified", "relative_unresolved"]
    before = json.dumps({"type": "doc", "content": []})
    store.log_note(conn, RUN, "u1", "n1", "repaired", shapes, actions, before)
    store.log_note(conn, RUN, "u1", "n2", "kept_edited", {"bare_url": 1}, [], None)
    conn.commit()
    rows = _other().execute("SELECT * FROM j2_import_repair_log ORDER BY id").fetchall()
    assert [(r["run_id"], r["user_id"], r["note_id"], r["outcome"]) for r in rows] == [
        (RUN, "u1", "n1", "repaired"), (RUN, "u1", "n2", "kept_edited")]
    assert json.loads(rows[0]["shapes_json"]) == shapes and json.loads(rows[0]["actions_json"]) == actions
    assert rows[0]["before_body_json"] == before and rows[1]["before_body_json"] is None
    assert all(r["created_at"] for r in rows)


def test_log_note_refuses_an_unknown_outcome_and_never_logs_unchanged(conn):
    with pytest.raises(ValueError):
        store.log_note(conn, RUN, "u1", "n1", "fixed", {}, [], None)
    store.log_note(conn, RUN, "u1", "n1", "unchanged", {}, [], None)  # C12: counted, not logged
    assert conn.execute("SELECT COUNT(*) FROM j2_import_repair_log").fetchone()[0] == 0


def test_the_started_row_is_committed_first_and_the_outcome_supersedes_it(conn):
    """C7: the undo copy is durable BEFORE the body is replaced; a crash between the two leaves
    `repair_started` as the note's latest outcome, holding the body to restore."""
    before = json.dumps({"type": "doc", "content": [{"type": "paragraph"}]})
    store.log_started(conn, RUN, "u1", "n1", {"bare_url": 1}, ["linkified"], before)  # commits
    assert _other().execute("SELECT outcome, before_body_json FROM j2_import_repair_log").fetchone()[:] == (
        "repair_started", before)
    assert store.latest_outcome(conn, RUN, "n1") == "repair_started"
    store.log_note(conn, RUN, "u1", "n1", "repaired", {"bare_url": 1}, ["linkified"], before)
    assert store.latest_outcome(conn, RUN, "n1") == "repaired"
    assert store.latest_outcome(conn, RUN, "n2") is None
    assert store.latest_outcome(conn, "run-2", "n1") is None


@pytest.mark.parametrize("body", [None, "", "   "])
def test_the_started_row_needs_a_body(conn, body):
    """Fix round 1, M-3: an "undo copy" with no body would look like C7 was honoured."""
    with pytest.raises(ValueError):
        store.log_started(conn, RUN, "u1", "n1", {}, [], body)
    assert conn.execute("SELECT COUNT(*) FROM j2_import_repair_log").fetchone()[0] == 0


def test_latest_outcome_is_an_index_seek(conn):
    """Fix round 1, M-1: called per note on resume, so it must not scan the run's rows."""
    plan = " ".join(r[3] for r in conn.execute(
        "EXPLAIN QUERY PLAN SELECT outcome FROM j2_import_repair_log WHERE run_id = ? AND note_id = ?"
        " ORDER BY id DESC LIMIT 1", (RUN, "n1")))
    assert "idx_j2_import_repair_log_run_note" in plan and "(run_id=? AND note_id=?)" in plan, plan


def test_the_member_tables_leave_with_the_account():
    """C2: all three are keyed on the member, and the log holds member note bodies."""
    for table in TABLES:
        assert table in account_purge._DIRECT_USER_TABLES, table
