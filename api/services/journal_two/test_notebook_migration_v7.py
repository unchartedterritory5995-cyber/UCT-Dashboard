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
                      (json.dumps(fresh_doc), "fresh words $AMD"))
            notes_mod._sync_note_mentions(c, "u1", "n1", "fresh words $AMD")   # as that save does
        return real(doc)

    monkeypatch.setattr(notes_mod, "extract_plain_text", racing)
    dbmod.run_notebook_migration_v7(c)
    assert fired
    row = c.execute("SELECT body_json, body_plain FROM j2_notes WHERE id='n1'").fetchone()
    assert json.loads(row[0]) == fresh_doc and row[1] == "fresh words $AMD"
    # ...and its mentions are the save's, not rebuilt from text this pass did not write.
    assert set(_mentions(c, "n1")) == {"AMD"}


def test_a_budget_spent_MID_BATCH_stops_within_one_row_and_the_next_boot_resumes_there(c, tmp_path, monkeypatch):
    # R23-N1, as measured: 200 near-cap notes took 68 s in ONE batch against a
    # 20 s budget, because the clock was read only between batches. Here each
    # rewritten note costs 30 s (its mentions rebuild, as a ~1 MB note's did),
    # and all five notes sit in ONE batch.
    _seed(c)
    assert dbmod._BODY_PLAIN_BACKFILL_BATCH >= 5          # the stop is MID-batch, not between batches
    now = [0.0]
    real = notes_mod._sync_note_mentions

    def slow_row(conn, uid, nid, bp):
        now[0] += 30.0
        return real(conn, uid, nid, bp)

    monkeypatch.setattr(notes_mod, "_sync_note_mentions", slow_row)
    out = dbmod.run_notebook_migration_v7(c, clock=lambda: now[0])
    assert out["complete"] is False
    assert out["j2_notes"] == {"scanned": 1, "updated": 1}  # n1, and nothing after the budget went
    assert now[0] == 30.0                                   # ONE row's cost past a 20 s budget, not five
    assert not (tmp_path / ".notebook_migration_v7").exists()
    # The resume point is the last row WALKED -- exact, not the batch's end.
    assert json.loads((tmp_path / ".notebook_migration_v7.progress").read_text()) == {"j2_notes": 1}
    assert [r["body_plain"] for r in _rows(c, "j2_notes")] == [
        NVDA_NEW, HIGHLIGHT_OLD, "already right", NVDA_OLD, HIGHLIGHT_OLD]   # what it wrote is committed

    monkeypatch.setattr(notes_mod, "_sync_note_mentions", real)
    resumed = dbmod.run_notebook_migration_v7(c, clock=lambda: 0.0)
    assert resumed["complete"] is True
    assert resumed["j2_notes"] == {"scanned": 4, "updated": 3}  # n2-n5 only: n1 is not walked again
    assert resumed["j2_note_versions"] == {"scanned": 2, "updated": 2}
    assert (tmp_path / ".notebook_migration_v7").exists()
    assert not (tmp_path / ".notebook_migration_v7.progress").exists()
    assert [r["body_plain"] for r in _rows(c, "j2_notes")] == [
        NVDA_NEW, "This is very important to remember", "already right", NVDA_NEW,
        "This is very important to remember"]


def test_an_unreadable_body_is_left_alone(c, tmp_path):
    _seed(c)
    c.execute("UPDATE j2_notes SET body_json = 'not json' WHERE id = 'n3'")
    c.commit()
    out = dbmod.run_notebook_migration_v7(c)
    assert out["complete"] is True
    assert c.execute("SELECT body_plain FROM j2_notes WHERE id='n3'").fetchone()[0] == "already right"
    assert (tmp_path / ".notebook_migration_v7").exists()


@pytest.mark.parametrize("stored", ["null", "[]", '"hello"', "42", '{"type": "paragraph", "content": []}',
                                    '{"content": [{"type": "text", "text": "x"}]}'])
def test_a_body_that_parses_but_is_not_a_doc_is_left_alone(c, stored):
    # R23-N2: JSON that parses to something other than a doc read as an EMPTY
    # doc, and the row's body_plain was erased. It is as unreadable as
    # 'not json' -- the save's own rule is an object whose type is "doc".
    _seed(c)
    c.execute("UPDATE j2_notes SET body_json = ? WHERE id = 'n3'", (stored,))
    c.commit()
    out = dbmod.run_notebook_migration_v7(c)
    assert out["complete"] is True
    assert c.execute("SELECT body_plain FROM j2_notes WHERE id='n3'").fetchone()[0] == "already right"
    # ...and the pass still did its work on the readable rows (non-vacuity).
    assert c.execute("SELECT body_plain FROM j2_notes WHERE id='n1'").fetchone()[0] == NVDA_NEW


def test_ensure_schema_runs_it(c):
    _seed(c)
    ensure_schema(c)  # the startup door, not a direct call
    assert c.execute("SELECT body_plain FROM j2_notes WHERE id='n1'").fetchone()[0] == NVDA_NEW


# ── fix round 3: the mentions sidecar follows the text it derives from ──────

CASHTAG_DOC = {"type": "doc", "content": [{"type": "paragraph", "content": [
    {"type": "text", "text": "$NV", "marks": [{"type": "bold"}]},
    {"type": "text", "text": "DA rallies"}]}]}
CASHTAG_OLD = "$NV DA rallies"


def _mentions(c, nid):
    return {r[0]: r[1] for r in c.execute(
        "SELECT symbol, created_at FROM j2_note_mentions WHERE note_id = ?", (nid,))}


def test_a_part_bold_cashtag_note_gains_its_mention_and_keeps_updated_at(c):
    _seed(c)
    _note(c, "m1", CASHTAG_DOC, CASHTAG_OLD, "2026-09-19T09:09:09.090909+00:00")
    # As the old save left it: the mention was read off the split text.
    notes_mod._sync_note_mentions(c, "u1", "m1", CASHTAG_OLD)
    notes_mod._sync_note_mentions(c, "u1", "n3", "already right $AMD")   # a row v7 will NOT rewrite
    c.commit()
    before = _mentions(c, "m1")
    untouched_before = _mentions(c, "n3")
    updated_before = c.execute("SELECT updated_at FROM j2_notes WHERE id='m1'").fetchone()[0]
    assert "NVDA" not in before                                  # the defect, as stored

    dbmod.run_notebook_migration_v7(c)

    assert set(_mentions(c, "m1")) == {"NVDA"}
    assert c.execute("SELECT updated_at FROM j2_notes WHERE id='m1'").fetchone()[0] == updated_before
    assert _mentions(c, "n3") == untouched_before                # only rewritten notes are rebuilt


def test_the_mentions_rebuild_is_the_saves_own_function(c, monkeypatch):
    # One authority: the backfill reaches the SAME function a save does.
    _seed(c)
    calls = []
    real = notes_mod._sync_note_mentions
    monkeypatch.setattr(notes_mod, "_sync_note_mentions",
                        lambda conn, uid, nid, bp: (calls.append((uid, nid, bp)), real(conn, uid, nid, bp)))
    dbmod.run_notebook_migration_v7(c)
    assert sorted(calls) == sorted([
        ("u1", "n1", NVDA_NEW), ("u1", "n2", "This is very important to remember"),
        ("u2", "n4", NVDA_NEW), ("u1", "n5", "This is very important to remember"),
    ])


# ── fix round 3: the playbook's entries get the same backfill ───────────────

@pytest.fixture
def upb(tmp_path, monkeypatch):
    from api.services.user_playbook import db as upb_db
    monkeypatch.setattr(dbmod, "_data_dir", lambda: tmp_path)
    conn = sqlite3.connect(":memory:")
    upb_db.ensure_schema(conn)        # zero entries: the backfill runs, writes nothing, flags nothing
    conn.execute("INSERT INTO upb_sections (id, user_id, title, created_at, updated_at) VALUES ('s1','u1','S',1,1)")
    conn.commit()
    yield conn, upb_db
    conn.close()


def _entry(conn, eid, doc, body_plain, updated_at):
    conn.execute(
        "INSERT INTO upb_entries (id, user_id, section_id, title, body_json, body_plain, created_at, updated_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (eid, "u1", "s1", eid, json.dumps(doc) if doc is not None else "", body_plain, 1, updated_at))
    conn.commit()


def test_playbook_entries_are_re_derived_with_updated_at_untouched(upb, tmp_path):
    conn, upb_db = upb
    assert not (tmp_path / ".upb_body_plain_v1").exists()        # no flag over zero entries
    _entry(conn, "e1", NVDA_DOC, NVDA_OLD, 1726000000123)
    _entry(conn, "e2", HIGHLIGHT_DOC, HIGHLIGHT_OLD, 1726000000456)
    _entry(conn, "e3", None, "", 1726000000789)                    # the schema's '' default: unreadable
    before = {r[0]: r[1:] for r in conn.execute("SELECT id, updated_at, body_json FROM upb_entries")}

    out = upb_db.run_upb_body_plain_backfill(conn)

    assert out["upb_entries"] == {"scanned": 3, "updated": 2}
    got = dict(conn.execute("SELECT id, body_plain FROM upb_entries"))
    assert got == {"e1": NVDA_NEW, "e2": "This is very important to remember", "e3": ""}
    assert {r[0]: r[1:] for r in conn.execute("SELECT id, updated_at, body_json FROM upb_entries")} == before
    assert (tmp_path / ".upb_body_plain_v1").exists()
    assert upb_db.run_upb_body_plain_backfill(conn) == {"complete": True, "skipped": "flag"}
    (tmp_path / ".upb_body_plain_v1").unlink()
    again = upb_db.run_upb_body_plain_backfill(conn)
    assert again["upb_entries"] == {"scanned": 3, "updated": 0}  # idempotent: read-only re-run


def test_playbook_backfill_stops_within_one_row_and_resumes_there(upb, tmp_path, monkeypatch):
    # R23-N1 for the playbook: the same engine, so the same per-row budget.
    conn, upb_db = upb
    _entry(conn, "e1", NVDA_DOC, NVDA_OLD, 1)
    _entry(conn, "e2", HIGHLIGHT_DOC, HIGHLIGHT_OLD, 2)
    _entry(conn, "e3", NVDA_DOC, NVDA_OLD, 3)
    monkeypatch.setattr(dbmod, "_BODY_PLAIN_BACKFILL_BUDGET_S", 1.5)
    reads = iter(range(100))                                # every read of the clock is one second later
    out = upb_db.run_upb_body_plain_backfill(conn, clock=lambda: float(next(reads)))
    assert out["complete"] is False
    assert out["upb_entries"] == {"scanned": 2, "updated": 2}   # spent after e2, mid-batch
    assert json.loads((tmp_path / ".upb_body_plain_v1.progress").read_text()) == {"upb_entries": 2}
    assert conn.execute("SELECT body_plain FROM upb_entries WHERE id='e3'").fetchone()[0] == NVDA_OLD

    again = upb_db.run_upb_body_plain_backfill(conn, clock=lambda: 0.0)
    assert again["complete"] is True
    assert again["upb_entries"] == {"scanned": 1, "updated": 1}  # e3 only
    assert (tmp_path / ".upb_body_plain_v1").exists()


def test_playbook_backfill_runs_from_its_own_ensure_schema(upb):
    conn, upb_db = upb
    _entry(conn, "e1", NVDA_DOC, NVDA_OLD, 5)
    upb_db.ensure_schema(conn)        # the startup door
    assert conn.execute("SELECT body_plain FROM upb_entries WHERE id='e1'").fetchone()[0] == NVDA_NEW


def test_playbook_backfill_keeps_an_entry_saved_between_read_and_write(upb, monkeypatch):
    conn, upb_db = upb
    _entry(conn, "e1", NVDA_DOC, NVDA_OLD, 5)
    fresh = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "fresh"}]}]}
    real = notes_mod.extract_plain_text
    fired = []

    def racing(doc):
        if not fired:
            fired.append(1)
            conn.execute("UPDATE upb_entries SET body_json = ?, body_plain = 'fresh' WHERE id = 'e1'",
                         (json.dumps(fresh),))
        return real(doc)

    monkeypatch.setattr(notes_mod, "extract_plain_text", racing)
    upb_db.run_upb_body_plain_backfill(conn)
    assert fired
    assert conn.execute("SELECT body_plain FROM upb_entries WHERE id='e1'").fetchone()[0] == "fresh"
