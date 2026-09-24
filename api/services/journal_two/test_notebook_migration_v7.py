"""run_notebook_migration_v7 — the body_plain backfill for the 2026-09-23
plain-text rule (notes.extract_plain_text = ProseMirror's textBetween with a
space: runs inside one block join with NOTHING).

Rows stored before the rule changed still hold the old every-node-joined-by-a-
space text, so a part-bold "**NV**DA" is indexed as "NV DA" and a search for
NVDA misses it. The backfill re-derives body_plain and NOTHING else: never
updated_at (the offline baseline and the sync engine's optimistic lock), never
body_json, never a version row.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services.journal_two import db as dbmod
from api.services.journal_two import notes as notes_mod
from api.services.journal_two.db import ensure_schema
from api.services.journal_two.notes import list_notes

NVDA_DOC = {"type": "doc", "content": [{"type": "paragraph", "content": [
    {"type": "text", "text": "NV", "marks": [{"type": "bold"}]},
    {"type": "text", "text": "DA rallies"}]}]}
NVDA_OLD = "NV DA rallies"          # the pre-2026-09-23 form: every node joined by a space
NVDA_NEW = "NVDA rallies"

HIGHLIGHT_DOC = {"type": "doc", "content": [{"type": "paragraph", "content": [
    {"type": "text", "text": "This is "},
    {"type": "text", "text": "very important", "marks": [{"type": "highlight"}]},
    {"type": "text", "text": " to remember"}]}]}
HIGHLIGHT_OLD = "This is  very important  to remember"

PLAIN_DOC = {"type": "doc", "content": [{"type": "paragraph", "content": [
    {"type": "text", "text": "already right"}]}]}


@pytest.fixture
def c(tmp_path, monkeypatch):
    monkeypatch.setattr(dbmod, "_data_dir", lambda: tmp_path)
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)  # zero notes: v7 runs, writes nothing, and must NOT flag
    yield conn
    conn.close()


def _note(c, nid, doc, body_plain, updated_at, user="u1"):
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain, tags, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (nid, user, f"title {nid}", json.dumps(doc), body_plain, "[]",
         "2026-01-02T03:04:05.678901+00:00", updated_at))
    c.commit()


def _version(c, vid, nid, doc, body_plain, user="u1"):
    c.execute(
        "INSERT INTO j2_note_versions (id, user_id, note_id, title, subtitle, body_json, body_plain, created_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (vid, user, nid, f"title {nid}", None, json.dumps(doc), body_plain, "2026-01-01T00:00:00+00:00"))
    c.commit()


def _seed(c):
    # updated_at deliberately in several shapes: whatever is stored must come
    # back byte for byte, not re-formatted.
    _note(c, "n1", NVDA_DOC, NVDA_OLD, "2026-09-20T10:00:00.123456+00:00")
    _note(c, "n2", HIGHLIGHT_DOC, HIGHLIGHT_OLD, "2026-09-21T11:11:11Z")
    _note(c, "n3", PLAIN_DOC, "already right", "2026-09-22 12:00:00")
    _note(c, "n4", NVDA_DOC, NVDA_OLD, "2026-09-23T00:00:00+00:00", user="u2")
    _note(c, "n5", HIGHLIGHT_DOC, HIGHLIGHT_OLD, "2026-09-23T01:02:03.000001+00:00")
    _version(c, "v1", "n1", NVDA_DOC, NVDA_OLD)
    _version(c, "v2", "n2", HIGHLIGHT_DOC, HIGHLIGHT_OLD)


def _rows(c, table):
    return [dict(r) for r in c.execute(f"SELECT * FROM {table} ORDER BY id")]


def _without(rows, col):
    return [{k: v for k, v in r.items() if k != col} for r in rows]


def test_updated_at_is_byte_identical_and_search_now_finds_NVDA(c, tmp_path):
    _seed(c)
    before = {r["id"]: r["updated_at"] for r in _rows(c, "j2_notes")}
    # Control: the defect is real before the backfill -- a search for NVDA
    # misses the note whose body is **NV**DA.
    assert [r["id"] for r in list_notes("u1", q="NVDA", conn=c)] == []

    out = dbmod.run_notebook_migration_v7(c)

    assert out["complete"] is True
    after = {r["id"]: r["updated_at"] for r in _rows(c, "j2_notes")}
    assert after == before
    assert [r["id"] for r in list_notes("u1", q="NVDA", conn=c)] == ["n1"]
    assert c.execute("SELECT body_plain FROM j2_notes WHERE id='n1'").fetchone()[0] == NVDA_NEW
    assert (tmp_path / ".notebook_migration_v7").exists()


def test_it_writes_body_plain_and_nothing_else(c):
    _seed(c)
    notes_before, versions_before = _rows(c, "j2_notes"), _rows(c, "j2_note_versions")
    dbmod.run_notebook_migration_v7(c)
    notes_after, versions_after = _rows(c, "j2_notes"), _rows(c, "j2_note_versions")
    assert _without(notes_after, "body_plain") == _without(notes_before, "body_plain")
    assert _without(versions_after, "body_plain") == _without(versions_before, "body_plain")
    # ...and body_plain really moved, on both tables (non-vacuity).
    assert [r["body_plain"] for r in notes_after] == [
        NVDA_NEW, "This is very important to remember", "already right", NVDA_NEW,
        "This is very important to remember"]
    assert [r["body_plain"] for r in versions_after] == [NVDA_NEW, "This is very important to remember"]


def test_versions_are_re_derived_so_an_unchanged_note_writes_no_spurious_checkpoint(c):
    # The note's versioned content is compared with its latest version's; a
    # backfill of the note alone would make the two differ and the next save
    # of an unchanged note would capture a checkpoint nobody made.
    _seed(c)
    dbmod.run_notebook_migration_v7(c)
    existing = c.execute("SELECT * FROM j2_notes WHERE id='n1'").fetchone()
    notes_mod._maybe_capture_version(c, "n1", "u1", existing, force=True)
    assert c.execute("SELECT COUNT(*) FROM j2_note_versions WHERE note_id='n1'").fetchone()[0] == 1


def test_a_rerun_is_read_only_and_the_flag_short_circuits(c, tmp_path):
    _seed(c)
    first = dbmod.run_notebook_migration_v7(c)
    assert first["j2_notes"]["updated"] == 4 and first["j2_note_versions"]["updated"] == 2
    assert dbmod.run_notebook_migration_v7(c) == {"complete": True, "skipped": "flag"}
    (tmp_path / ".notebook_migration_v7").unlink()
    again = dbmod.run_notebook_migration_v7(c)
    assert again["j2_notes"] == {"scanned": 5, "updated": 0}
    assert again["j2_note_versions"] == {"scanned": 2, "updated": 0}


def test_no_flag_over_zero_notes(c, tmp_path):
    out = dbmod.run_notebook_migration_v7(c)
    assert out["complete"] is True
    assert not (tmp_path / ".notebook_migration_v7").exists()


def test_a_note_saved_between_read_and_write_keeps_its_own_save(c, monkeypatch):
    _seed(c)
    fresh_doc = {"type": "doc", "content": [{"type": "paragraph", "content": [
        {"type": "text", "text": "fresh words"}]}]}
    real = notes_mod.extract_plain_text
    fired = []

    def racing(doc):
        if not fired and doc == NVDA_DOC:
            fired.append(1)  # a member's save lands after the batch was read
            c.execute("UPDATE j2_notes SET body_json = ?, body_plain = ? WHERE id = 'n1'",
                      (json.dumps(fresh_doc), "fresh words"))
        return real(doc)

    monkeypatch.setattr(notes_mod, "extract_plain_text", racing)
    dbmod.run_notebook_migration_v7(c)
    assert fired
    row = c.execute("SELECT body_json, body_plain FROM j2_notes WHERE id='n1'").fetchone()
    assert json.loads(row[0]) == fresh_doc and row[1] == "fresh words"


def test_a_spent_budget_stops_between_batches_and_the_next_boot_resumes(c, tmp_path, monkeypatch):
    _seed(c)
    monkeypatch.setattr(dbmod, "_BODY_PLAIN_BACKFILL_BATCH", 2)
    ticks = iter([0.0, 0.0, 1e9])  # start, first check (runs a batch), second check (spent)
    out = dbmod.run_notebook_migration_v7(c, clock=lambda: next(ticks))
    assert out["complete"] is False
    assert out["j2_notes"] == {"scanned": 2, "updated": 2}  # n1, n2
    assert not (tmp_path / ".notebook_migration_v7").exists()
    assert json.loads((tmp_path / ".notebook_migration_v7.progress").read_text()) == {"j2_notes": 2}

    resumed = dbmod.run_notebook_migration_v7(c)
    assert resumed["complete"] is True
    assert resumed["j2_notes"] == {"scanned": 3, "updated": 2}  # n3-n5 only: rows 1-2 are not walked again
    assert (tmp_path / ".notebook_migration_v7").exists()
    assert not (tmp_path / ".notebook_migration_v7.progress").exists()
    assert [r["body_plain"] for r in _rows(c, "j2_notes")][0] == NVDA_NEW


def test_an_unreadable_body_is_left_alone(c, tmp_path):
    _seed(c)
    c.execute("UPDATE j2_notes SET body_json = 'not json' WHERE id = 'n3'")
    c.commit()
    out = dbmod.run_notebook_migration_v7(c)
    assert out["complete"] is True
    assert c.execute("SELECT body_plain FROM j2_notes WHERE id='n3'").fetchone()[0] == "already right"
    assert (tmp_path / ".notebook_migration_v7").exists()


def test_ensure_schema_runs_it(c):
    _seed(c)
    ensure_schema(c)  # the startup door, not a direct call
    assert c.execute("SELECT body_plain FROM j2_notes WHERE id='n1'").fetchone()[0] == NVDA_NEW
