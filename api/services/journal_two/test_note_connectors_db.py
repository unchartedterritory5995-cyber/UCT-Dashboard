"""Migration v3 (Note Connectors tables) — spec 2026-08-11-note-connectors §5.

Mirrors the migration-v2 test shape in test_notes_import.py. The load-bearing
case is (b): a v2-shaped DB (current _J2_SCHEMA minus the 4 new tables) driven
through ensure_schema() ITSELF — not run_notebook_migration_v3 directly — must
gain the tables, keep seeded j2_notes/j2_note_folders rows intact, and be
idempotent on a second run.
"""
import sqlite3

import pytest

from api.services import auth_db
from api.services.journal_two import db as j2db
from api.services.journal_two.note_connectors import engine

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


def test_ensure_schema_adds_miss_streak_and_conflicts_to_a_pre_task8_shaped_db(tmp_path, monkeypatch):
    """CRITICAL regression (review 2026-08-12): run_notebook_migration_v3 is
    flag-gated (returns instantly once `.notebook_migration_v3` exists on
    disk) AND its CREATE TABLE IF NOT EXISTS statements no-op on a table that
    already exists — so a DB that ran ensure_schema() under a _J2_SCHEMA
    snapshot from BEFORE Task 8 added `miss_streak`/`conflicts` never gains
    those columns, no matter how many times ensure_schema() reruns.

    Builds the exact pre-Task-8 shape of j2_note_remote_index/j2_note_sync_log
    (no miss_streak, no conflicts), touches the v3 flag file (simulating an
    already-migrated production DB), drives ensure_schema() ITSELF, and then
    proves the column is not just PRESENT but actually USABLE by running a
    real delete-detection pass (`engine._run_delete_detection`) against it."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    dbfile = tmp_path / "pre_task8.db"
    c = sqlite3.connect(dbfile)
    c.row_factory = sqlite3.Row
    c.executescript(j2db._J2_SCHEMA)
    c.execute("DROP TABLE j2_note_remote_index")
    c.execute("DROP TABLE j2_note_sync_log")
    c.executescript("""
        CREATE TABLE j2_note_remote_index (
            user_id TEXT NOT NULL, source_id TEXT NOT NULL, remote_id TEXT NOT NULL,
            import_key TEXT NOT NULL, remote_updated_at TEXT, seen_at TEXT NOT NULL,
            PRIMARY KEY(user_id, source_id, remote_id));
        CREATE TABLE j2_note_sync_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, source_id TEXT NOT NULL, user_id TEXT NOT NULL,
            started_at TEXT, finished_at TEXT, status TEXT, error TEXT,
            notes_created INTEGER, notes_updated INTEGER, notes_skipped INTEGER,
            media_uploaded INTEGER);
    """)
    c.commit()
    # Simulate an already-migrated production DB: the v3 flag already exists.
    (tmp_path / ".notebook_migration_v3").touch()

    rcols_before = {r[1] for r in c.execute("PRAGMA table_info(j2_note_remote_index)")}
    lcols_before = {r[1] for r in c.execute("PRAGMA table_info(j2_note_sync_log)")}
    assert "miss_streak" not in rcols_before
    assert "conflicts" not in lcols_before

    # The whole point of the fix: this must add the columns despite the flag.
    j2db.ensure_schema(c)

    rcols = {r[1] for r in c.execute("PRAGMA table_info(j2_note_remote_index)")}
    lcols = {r[1] for r in c.execute("PRAGMA table_info(j2_note_sync_log)")}
    assert "miss_streak" in rcols
    assert "conflicts" in lcols
    c.close()

    # Not just present — USABLE, via the real engine code path (not hand-rolled SQL).
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn2 = auth_db.get_connection()
    conn2.execute(
        "INSERT INTO j2_note_remote_index (user_id, source_id, remote_id, import_key, seen_at) "
        "VALUES ('u1','s1','r1','fake:g/r1','2026-08-01T00:00:00+00:00')"
    )
    conn2.commit()
    conn2.close()

    from api.services.journal_two.note_connectors.providers.base import RemoteRef
    seen_ref = RemoteRef(remote_id="r1", updated_at="2026-08-02T00:00:00+00:00")
    dd = engine._run_delete_detection("u1", {"id": "s1", "remoteId": "g"}, [seen_ref])
    assert dd["status"] == "ok"
    assert dd["deleted"] == 0

    conn3 = auth_db.get_connection()
    row = conn3.execute(
        "SELECT miss_streak FROM j2_note_remote_index WHERE remote_id = 'r1'"
    ).fetchone()
    conn3.close()
    assert row["miss_streak"] == 0  # still present/seen — column read+wrote cleanly
