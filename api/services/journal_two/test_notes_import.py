"""Migration v2 (folder tree + import provenance) + tree CRUD + import upsert."""
import sqlite3
import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc


@pytest.fixture()
def conn(tmp_path, monkeypatch):
    """Fresh sandboxed J2 db with schema + both notebook migrations applied."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = sqlite3.connect(tmp_path / "j2_test.db")
    c.row_factory = sqlite3.Row
    c.executescript(j2db._J2_SCHEMA)
    j2db.run_notebook_migration_v2(c)
    yield c
    c.close()


def test_migration_v2_adds_parent_id_and_per_parent_uniqueness(conn):
    cols = {r[1] for r in conn.execute("PRAGMA table_info(j2_note_folders)")}
    assert "parent_id" in cols
    now = "2026-08-11T00:00:00Z"
    conn.execute("INSERT INTO j2_note_folders (id,user_id,name,parent_id,sort_order,created_at) VALUES ('a','u1','Ideas','',0,?)", (now,))
    # same name under a different parent is fine
    conn.execute("INSERT INTO j2_note_folders (id,user_id,name,parent_id,sort_order,created_at) VALUES ('b','u1','Ideas','a',0,?)", (now,))
    # duplicate root name rejected (this is why parent_id is '' not NULL)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO j2_note_folders (id,user_id,name,parent_id,sort_order,created_at) VALUES ('c','u1','Ideas','',0,?)", (now,))


def test_migration_v2_preserves_existing_flat_folders(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = sqlite3.connect(tmp_path / "old.db")
    c.row_factory = sqlite3.Row
    # v1-era table shape (pre-parent_id)
    c.executescript("""
        CREATE TABLE j2_note_folders (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
            UNIQUE(user_id, name));
        CREATE TABLE j2_notes (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT,
            folder_id TEXT, title TEXT NOT NULL, subtitle TEXT,
            body_json TEXT NOT NULL DEFAULT '{}', body_plain TEXT NOT NULL DEFAULT '',
            hero_image_url TEXT, ticker TEXT, tags TEXT NOT NULL DEFAULT '[]',
            status TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    """)
    c.execute("INSERT INTO j2_note_folders VALUES ('f1','u1','Trading',3,'2026-01-01')")
    c.execute("INSERT INTO j2_notes (id,user_id,folder_id,title,created_at,updated_at) VALUES ('n1','u1','f1','My note','2026-01-01','2026-01-01')")
    c.commit()
    j2db.run_notebook_migration_v2(c)
    row = c.execute("SELECT * FROM j2_note_folders WHERE id='f1'").fetchone()
    assert row["name"] == "Trading" and row["parent_id"] == "" and row["sort_order"] == 3
    note = c.execute("SELECT folder_id, import_key FROM j2_notes WHERE id='n1'").fetchone()
    assert note["folder_id"] == "f1" and note["import_key"] is None
    # idempotent: second run is a no-op (flag file)
    j2db.run_notebook_migration_v2(c)
    assert c.execute("SELECT COUNT(*) FROM j2_note_folders").fetchone()[0] == 1
    c.close()
