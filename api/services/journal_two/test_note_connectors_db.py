"""Migration v3 (Note Connectors tables) — spec 2026-08-11-note-connectors §5.

Mirrors the migration-v2 test shape in test_notes_import.py. The load-bearing
case is (b): a v2-shaped DB (current _J2_SCHEMA minus the 4 new tables) driven
through ensure_schema() ITSELF — not run_notebook_migration_v3 directly — must
gain the tables, keep seeded j2_notes/j2_note_folders rows intact, and be
idempotent on a second run.
"""
import sqlite3

import pytest

from api.services.journal_two import db as j2db

_CONNECTOR_TABLES = (
    "j2_note_connectors",
    "j2_note_sources",
    "j2_note_sync_log",
    "j2_note_remote_index",
)


def _table_names(conn):
    return {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
    }


def test_fresh_schema_has_all_four_connector_tables():
    """(a) A brand-new DB built straight from _J2_SCHEMA already has all
    four Note Connectors tables — they're safe CREATE TABLE IF NOT EXISTS
    statements with no ALTER dependency."""
    c = sqlite3.connect(":memory:")
    c.executescript(j2db._J2_SCHEMA)
    tables = _table_names(c)
    for t in _CONNECTOR_TABLES:
        assert t in tables, f"{t} missing from fresh _J2_SCHEMA"
    c.close()


def test_ensure_schema_upgrades_a_v2_shaped_db_and_is_idempotent(tmp_path, monkeypatch):
    """(b) THE load-bearing case. Build a v2-shaped DB (everything in the
    current _J2_SCHEMA except the 4 new connector tables, dropped after
    creation — the same technique test_notes_import.py's v1-shaped tests
    use), seed real j2_notes/j2_note_folders rows, then drive ensure_schema()
    itself (never run_notebook_migration_v3 directly). It must gain the four
    tables, the seeded rows must survive untouched, and a second run must be
    a clean no-op."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = sqlite3.connect(tmp_path / "v2_shaped.db")
    c.row_factory = sqlite3.Row
    c.executescript(j2db._J2_SCHEMA)
    for t in _CONNECTOR_TABLES:
        c.execute(f"DROP TABLE IF EXISTS {t}")
    c.commit()
    assert not (_table_names(c) & set(_CONNECTOR_TABLES))

    now = "2026-08-11T00:00:00Z"
    c.execute(
        "INSERT INTO j2_note_folders (id,user_id,name,parent_id,sort_order,created_at) "
        "VALUES ('f1','u1','Ideas','',0,?)",
        (now,),
    )
    c.execute(
        "INSERT INTO j2_notes (id,user_id,folder_id,title,created_at,updated_at) "
        "VALUES ('n1','u1','f1','My note',?,?)",
        (now, now),
    )
    c.commit()

    j2db.ensure_schema(c)

    tables = _table_names(c)
    for t in _CONNECTOR_TABLES:
        assert t in tables, f"{t} not created by ensure_schema() on a v2-shaped DB"

    folder = c.execute("SELECT * FROM j2_note_folders WHERE id='f1'").fetchone()
    assert folder is not None and folder["name"] == "Ideas"
    note = c.execute("SELECT * FROM j2_notes WHERE id='n1'").fetchone()
    assert note is not None and note["title"] == "My note"

    # Idempotent second run — no crash, table set unchanged, seeded rows intact.
    j2db.ensure_schema(c)
    assert _table_names(c) >= set(_CONNECTOR_TABLES)
    assert c.execute("SELECT COUNT(*) FROM j2_note_folders").fetchone()[0] == 1
    assert c.execute("SELECT COUNT(*) FROM j2_notes").fetchone()[0] == 1
    c.close()


def test_note_sources_index_exists_after_ensure_schema(tmp_path, monkeypatch):
    """(c) idx_j2_note_sources_user is created (and visible via PRAGMA
    index_list), and it's created AFTER the migration call in ensure_schema
    per the idx_j2_notes_user_import precedent — never inline in
    _J2_SCHEMA."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = sqlite3.connect(tmp_path / "idx.db")
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
    idx_names = {r[1] for r in c.execute("PRAGMA index_list('j2_note_sources')")}
    assert "idx_j2_note_sources_user" in idx_names
    c.close()


def test_migration_v3_flag_file_makes_second_call_a_noop(tmp_path, monkeypatch):
    """Direct coverage of run_notebook_migration_v3's idempotency flag,
    mirroring how test_notes_import.py separately covers v2 both directly
    and via ensure_schema()."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = sqlite3.connect(tmp_path / "flag.db")
    c.row_factory = sqlite3.Row
    c.executescript(j2db._J2_SCHEMA)
    j2db.run_notebook_migration_v3(c)
    flag = tmp_path / ".notebook_migration_v3"
    assert flag.exists()
    # Second direct call must not raise even though the tables already exist.
    j2db.run_notebook_migration_v3(c)
    c.close()
