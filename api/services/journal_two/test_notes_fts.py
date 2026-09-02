"""FTS5 index maintenance for the Notebook.

The index is maintained by SQLite TRIGGERS, not by calls in each writer.
There are 11 production write statements against j2_notes across notes.py,
note_connectors/engine.py and db.py; a hand-wired index would go stale on
whichever one a future change forgets. These tests exercise the index
through RAW SQL writes precisely BECAUSE that is what the importer and the
sync engine do -- if the triggers only worked via the service functions,
every imported note would be invisible to search.
"""
import sqlite3

from api.services.journal_two.db import ensure_schema


def _conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    return c


def _insert_note(c, note_id, user_id="u1", title="", body_plain=""):
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        (note_id, user_id, title, '{"type":"doc","content":[]}', body_plain,
         "[]", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    )
    c.commit()


def _fts_ids(c, expr):
    return {r["note_id"] for r in c.execute(
        "SELECT note_id FROM j2_notes_fts WHERE j2_notes_fts MATCH ?", (expr,))}


def test_raw_insert_is_indexed_by_trigger():
    c = _conn()
    _insert_note(c, "n1", title="Breakout thesis", body_plain="NVDA cup and handle")
    assert _fts_ids(c, "cup") == {"n1"}


def test_raw_update_reindexes_and_drops_stale_terms():
    c = _conn()
    _insert_note(c, "n1", title="Old", body_plain="obsolete wording")
    c.execute("UPDATE j2_notes SET title=?, body_plain=? WHERE id=?",
              ("New", "fresh wording", "n1"))
    c.commit()
    assert _fts_ids(c, "fresh") == {"n1"}
    assert _fts_ids(c, "obsolete") == set()


def test_raw_delete_removes_from_index():
    c = _conn()
    _insert_note(c, "n1", body_plain="ephemeral")
    c.execute("DELETE FROM j2_notes WHERE id=?", ("n1",))
    c.commit()
    assert _fts_ids(c, "ephemeral") == set()


def test_bookkeeping_update_does_not_touch_the_index():
    """The sync engine writes tags/import_hash via raw SQL that deliberately
    preserves updated_at. Those columns are not indexed, so the trigger must
    not fire for them -- re-indexing every bookkeeping write would make a
    nightly full pass rewrite the entire index."""
    c = _conn()
    _insert_note(c, "n1", body_plain="stable text")
    c.execute("UPDATE j2_notes SET tags=? WHERE id=?", ('["a"]', "n1"))
    c.commit()
    assert _fts_ids(c, "stable") == {"n1"}


def test_migration_v4_backfills_rows_that_predate_the_index(tmp_path, monkeypatch):
    """A pre-existing DB has notes but no index. The migration must backfill,
    and must be safe to run twice (no duplicate hits)."""
    from api.services.journal_two import db as dbmod
    monkeypatch.setattr(dbmod, "_data_dir", lambda: tmp_path)
    c = _conn()
    _insert_note(c, "n1", body_plain="legacy content")
    c.execute("DELETE FROM j2_notes_fts")  # simulate an un-indexed legacy DB
    c.commit()
    assert _fts_ids(c, "legacy") == set()

    dbmod.run_notebook_migration_v4(c)
    assert _fts_ids(c, "legacy") == {"n1"}

    (tmp_path / ".notebook_migration_v4").unlink()
    dbmod.run_notebook_migration_v4(c)
    rows = list(c.execute(
        "SELECT note_id FROM j2_notes_fts WHERE j2_notes_fts MATCH ?", ("legacy",)))
    assert len(rows) == 1, "re-running the migration duplicated index rows"
