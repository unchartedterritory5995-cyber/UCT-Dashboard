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


def test_ensure_schema_upgrades_a_v1_shaped_database_without_crashing(tmp_path, monkeypatch):
    """CRITICAL regression: ensure_schema() used to executescript a
    CREATE INDEX on j2_notes(import_key) as part of _J2_SCHEMA — BEFORE
    run_notebook_migration_v2 adds that column — raising
    `OperationalError: no such column: import_key` on every pre-existing
    (v1-shaped) database. api/main.py swallows that as a non-fatal startup
    error, so migration v2 never runs and _row_to_folder reads a missing
    parent_id -> the Notebook sidebar 500s for every current user.

    Drives ensure_schema() ITSELF (not run_notebook_migration_v2 directly,
    which the other tests in this file already cover) over a v1-shaped DB —
    the exact shape test_migration_v2_preserves_existing_flat_folders builds:
    folders WITHOUT parent_id, notes WITHOUT import columns, seeded rows."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = sqlite3.connect(tmp_path / "v1_via_ensure_schema.db")
    c.row_factory = sqlite3.Row
    # v1-era table shapes (pre-parent_id, pre-import-columns).
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
    c.execute("INSERT INTO j2_notes (id,user_id,folder_id,title,created_at,updated_at) "
               "VALUES ('n1','u1','f1','My note','2026-01-01','2026-01-01')")
    c.commit()

    # The whole point of the fix: this must NOT raise.
    j2db.ensure_schema(c)

    fcols = {r[1] for r in c.execute("PRAGMA table_info(j2_note_folders)")}
    assert "parent_id" in fcols
    ncols = {r[1] for r in c.execute("PRAGMA table_info(j2_notes)")}
    assert "import_key" in ncols

    row = c.execute("SELECT * FROM j2_note_folders WHERE id='f1'").fetchone()
    assert row["name"] == "Trading" and row["parent_id"] == "" and row["sort_order"] == 3
    note = c.execute("SELECT folder_id, import_key FROM j2_notes WHERE id='n1'").fetchone()
    assert note["folder_id"] == "f1" and note["import_key"] is None

    folders = notes_svc.list_folders("u1", conn=c)
    assert len(folders) == 1
    assert folders[0]["id"] == "f1"
    assert folders[0]["parentId"] is None
    c.close()


def test_migration_v2_recovers_from_crash_state(tmp_path, monkeypatch):
    """Simulates a process crash between RENAME and CREATE TABLE. The next boot
    must detect j2_note_folders_v1 stranded on disk and recover."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = sqlite3.connect(tmp_path / "crash.db")
    c.row_factory = sqlite3.Row
    # Simulate the half-migrated crash state: old rows in j2_note_folders_v1,
    # no j2_note_folders table, and no flag file (crashed before writing the flag).
    c.executescript("""
        CREATE TABLE j2_note_folders_v1 (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
        CREATE TABLE j2_notes (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, account_id TEXT,
            folder_id TEXT, title TEXT NOT NULL, subtitle TEXT,
            body_json TEXT NOT NULL DEFAULT '{}', body_plain TEXT NOT NULL DEFAULT '',
            hero_image_url TEXT, ticker TEXT, tags TEXT NOT NULL DEFAULT '[]',
            status TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    """)
    c.execute("INSERT INTO j2_note_folders_v1 VALUES ('f1','u1','Trading',5,'2026-01-01')")
    c.execute("INSERT INTO j2_notes (id,user_id,folder_id,title,created_at,updated_at) VALUES ('n1','u1','f1','My note','2026-01-01','2026-01-01')")
    c.commit()

    # Run the migration. It should detect v1 exists and rebuild.
    j2db.run_notebook_migration_v2(c)

    # Verify j2_note_folders has the data with parent_id set.
    row = c.execute("SELECT * FROM j2_note_folders WHERE id='f1'").fetchone()
    assert row["name"] == "Trading" and row["parent_id"] == "" and row["sort_order"] == 5
    # Verify v1 is gone.
    v1_exists = c.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='j2_note_folders_v1'"
    ).fetchone()
    assert v1_exists is None
    # Verify import_key column exists.
    note = c.execute("SELECT folder_id, import_key FROM j2_notes WHERE id='n1'").fetchone()
    assert note["folder_id"] == "f1" and note["import_key"] is None
    c.close()


def test_create_folder_with_parent_and_depth_cap(conn):
    root = notes_svc.create_folder("u1", "A", conn=conn)
    assert root["parentId"] is None
    child = notes_svc.create_folder("u1", "B", parent_id=root["id"], conn=conn)
    assert child["parentId"] == root["id"]
    # depth cap: build a chain to MAX_FOLDER_DEPTH then one more fails
    pid = child["id"]
    for i in range(notes_svc.MAX_FOLDER_DEPTH - 2):
        pid = notes_svc.create_folder("u1", f"d{i}", parent_id=pid, conn=conn)["id"]
    with pytest.raises(notes_svc.NoteValidationError):
        notes_svc.create_folder("u1", "too-deep", parent_id=pid, conn=conn)
    # bogus parent rejected
    with pytest.raises(notes_svc.NoteValidationError):
        notes_svc.create_folder("u1", "orphan", parent_id="nope", conn=conn)


def test_delete_folder_reparents_children_and_notes(conn):
    a = notes_svc.create_folder("u1", "A", conn=conn)
    b = notes_svc.create_folder("u1", "B", parent_id=a["id"], conn=conn)
    c = notes_svc.create_folder("u1", "C", parent_id=b["id"], conn=conn)
    note = notes_svc.create_note("u1", {"title": "in B", "folderId": b["id"]}, conn=conn)
    assert notes_svc.delete_folder("u1", b["id"], conn=conn) is True
    folders = {f["id"]: f for f in notes_svc.list_folders("u1", conn=conn)}
    assert folders[c["id"]]["parentId"] == a["id"]          # child climbed to grandparent
    got = notes_svc.get_note("u1", note["id"], conn=conn)
    assert got["folderId"] == a["id"]                        # note climbed too
    # root deletion → notes go Unfiled (None), children become roots
    note2 = notes_svc.create_note("u1", {"title": "in A", "folderId": a["id"]}, conn=conn)
    notes_svc.delete_folder("u1", a["id"], conn=conn)
    assert notes_svc.get_note("u1", note2["id"], conn=conn)["folderId"] is None
    assert {f["id"]: f for f in notes_svc.list_folders("u1", conn=conn)}[c["id"]]["parentId"] is None


def test_ensure_folder_path_creates_and_reuses(conn):
    leaf = notes_svc.ensure_folder_path("u1", ["Trading", "Setups", "VCP"], conn=conn)
    again = notes_svc.ensure_folder_path("u1", ["Trading", "Setups", "VCP"], conn=conn)
    assert leaf == again
    assert len(notes_svc.list_folders("u1", conn=conn)) == 3
    # under a destination folder
    dest = notes_svc.create_folder("u1", "Imported", conn=conn)
    leaf2 = notes_svc.ensure_folder_path("u1", ["Trading"], dest_folder_id=dest["id"], conn=conn)
    assert leaf2 != leaf  # 'Trading' under 'Imported' is a different folder


def test_delete_folder_collision_detection(conn):
    # Build: A/{Setups, B/{Setups}}
    a = notes_svc.create_folder("u1", "A", conn=conn)
    a_setups = notes_svc.create_folder("u1", "Setups", parent_id=a["id"], conn=conn)
    b = notes_svc.create_folder("u1", "B", parent_id=a["id"], conn=conn)
    b_setups = notes_svc.create_folder("u1", "Setups", parent_id=b["id"], conn=conn)
    note = notes_svc.create_note("u1", {"title": "in B", "folderId": b["id"]}, conn=conn)

    # Attempt to delete B should fail: "Setups" already exists under A
    with pytest.raises(notes_svc.NoteValidationError) as exc_info:
        notes_svc.delete_folder("u1", b["id"], conn=conn)
    assert "already exists at the destination" in str(exc_info.value)

    # Verify NOTHING changed: B still exists with its child, note still in B
    folders = {f["id"]: f for f in notes_svc.list_folders("u1", conn=conn)}
    assert b["id"] in folders
    assert b_setups["id"] in folders
    assert folders[b_setups["id"]]["parentId"] == b["id"]
    got = notes_svc.get_note("u1", note["id"], conn=conn)
    assert got["folderId"] == b["id"]


def test_delete_folder_with_same_named_child_succeeds(conn):
    # Build: Docs/{Docs} — parent and child with same name
    docs_parent = notes_svc.create_folder("u1", "Docs", conn=conn)
    docs_child = notes_svc.create_folder("u1", "Docs", parent_id=docs_parent["id"], conn=conn)

    # Deleting the parent should succeed (child is promoted to root with its name intact)
    assert notes_svc.delete_folder("u1", docs_parent["id"], conn=conn) is True

    # Verify child is now a root folder
    folders = {f["id"]: f for f in notes_svc.list_folders("u1", conn=conn)}
    assert docs_child["id"] in folders
    assert folders[docs_child["id"]]["parentId"] is None
    assert folders[docs_child["id"]]["name"] == "Docs"


def test_create_folder_cross_user_parent_rejected(conn):
    # Create folders for two users
    a_u1 = notes_svc.create_folder("u1", "A", conn=conn)
    a_u2 = notes_svc.create_folder("u2", "A", conn=conn)

    # Try to create a folder under u2's parent as u1 user
    with pytest.raises(notes_svc.NoteValidationError) as exc_info:
        notes_svc.create_folder("u1", "Child", parent_id=a_u2["id"], conn=conn)
    assert "parent folder not found" in str(exc_info.value)


def _mk_import_note(key, title="T", body=None, path=("Inbox",)):
    return {
        "importKey": key, "title": title,
        "bodyJson": body or {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": f"body of {title}"}]}]},
        "tags": ["imported"], "folderPath": list(path),
        "createdAt": "2024-03-01T12:00:00Z", "updatedAt": "2024-03-02T12:00:00Z",
    }


def test_import_confirm_creates_then_reimport_skips_then_change_updates(conn):
    payload = {"source": "obsidian", "destFolderId": None,
               "notes": [_mk_import_note("obsidian:a.md", "Alpha"),
                          _mk_import_note("obsidian:b.md", "Beta", path=("Trading", "Setups"))]}
    r1 = notes_svc.import_confirm("u1", payload, conn=conn)
    assert [n["importKey"] for n in r1["created"]] == ["obsidian:a.md", "obsidian:b.md"]
    # original dates preserved
    note = notes_svc.get_note("u1", r1["created"][0]["id"], conn=conn)
    assert note["createdAt"].startswith("2024-03-01")
    # folder path materialized
    names = {f["name"] for f in notes_svc.list_folders("u1", conn=conn)}
    assert {"Inbox", "Trading", "Setups"} <= names
    # identical re-import: everything skipped, nothing duplicated
    r2 = notes_svc.import_confirm("u1", payload, conn=conn)
    assert len(r2["skipped"]) == 2 and not r2["created"] and not r2["updated"]
    # changed body: updated in place, same id
    payload["notes"][0]["bodyJson"]["content"][0]["content"][0]["text"] = "edited"
    r3 = notes_svc.import_confirm("u1", payload, conn=conn)
    assert len(r3["updated"]) == 1
    assert r3["updated"][0]["id"] == r1["created"][0]["id"]


def test_import_confirm_clamps_folder_depth_to_dest_instead_of_raising(conn):
    """A folderPath was truncated to MAX_FOLDER_DEPTH segments but then
    created UNDER destFolderId (depth >= 1), so a deep path could still raise
    NoteValidationError("folder nesting too deep") and 400 the whole batch.
    dest sits at depth 1 (root); a 7-segment folderPath must clamp to 5
    segments so the note's folder chain tops out at MAX_FOLDER_DEPTH (6)."""
    dest = notes_svc.create_folder("u1", "Imported", conn=conn)
    deep_path = tuple(f"L{i}" for i in range(7))
    payload = {"source": "x", "destFolderId": dest["id"],
               "notes": [_mk_import_note("x:deep", "Deep", path=deep_path)]}
    r = notes_svc.import_confirm("u1", payload, conn=conn)
    assert len(r["created"]) == 1
    note = notes_svc.get_note("u1", r["created"][0]["id"], conn=conn)
    assert note["folderId"] is not None
    # Only 5 of the 7 requested segments should have been materialized
    # (L5/L6 dropped) — walk the chain from the note's folder to the root.
    folder = notes_svc.list_folders("u1", conn=conn)
    by_id = {f["id"]: f for f in folder}
    names = []
    cur = note["folderId"]
    depth = 0
    seen = set()
    while cur and cur not in seen:
        seen.add(cur)
        depth += 1
        f = by_id[cur]
        names.append(f["name"])
        cur = f["parentId"]
    assert depth == notes_svc.MAX_FOLDER_DEPTH
    assert names == ["L4", "L3", "L2", "L1", "L0", "Imported"]
    assert "L5" not in {f["name"] for f in folder}
    assert "L6" not in {f["name"] for f in folder}


def test_import_check_reports_existing(conn):
    notes_svc.import_confirm("u1", {"source": "x", "destFolderId": None,
                                     "notes": [_mk_import_note("x:1")]}, conn=conn)
    out = notes_svc.import_check("u1", ["x:1", "x:2"], conn=conn)
    assert "x:1" in out["existing"] and "x:2" not in out["existing"]


def test_import_confirm_is_atomic(conn):
    bad = {"source": "x", "destFolderId": None,
           "notes": [_mk_import_note("x:ok"),
                      {"importKey": "x:bad", "title": "B", "bodyJson": "not-a-doc",
                       "tags": [], "folderPath": []}]}
    with pytest.raises(notes_svc.NoteValidationError):
        notes_svc.import_confirm("u1", bad, conn=conn)
    # Verify rollback: no notes exist
    assert notes_svc.import_check("u1", ["x:ok"], conn=conn)["existing"] == {}
    # Verify rollback: no folders were created either
    folders = {f["name"] for f in notes_svc.list_folders("u1", conn=conn)}
    assert "Inbox" not in folders


# ── Non-image attachment upload ──────────────────────────────────────────────

class _FakeUpload:
    def __init__(self, data: bytes, content_type="application/pdf", filename="report.pdf"):
        self._data, self.content_type, self.filename = data, content_type, filename
    async def read(self):
        return self._data


def test_save_note_attachment_stores_and_caps(conn, tmp_path, monkeypatch):
    import asyncio
    monkeypatch.setattr(notes_svc, "_ATTACHMENT_ROOT", tmp_path / "att")
    note = notes_svc.create_note("u1", {"title": "n"}, conn=conn)
    out = asyncio.run(notes_svc.save_note_attachment("u1", note["id"], _FakeUpload(b"%PDF-1.4 x")))
    assert out["url"].startswith(f"/api/j2/notes/attachments/u1/{note['id']}/file/")
    assert out["name"] == "report.pdf" and out["size"] == 10
    with pytest.raises(notes_svc.NoteValidationError):
        asyncio.run(notes_svc.save_note_attachment("u1", note["id"],
                    _FakeUpload(b"x", content_type="application/x-msdownload")))
    with pytest.raises(notes_svc.NoteValidationError):
        asyncio.run(notes_svc.save_note_attachment("u1", note["id"],
                    _FakeUpload(b"x" * (notes_svc._MAX_FILE_BYTES + 1))))
