"""Migration v2 (folder tree + import provenance) + tree CRUD + import upsert."""
import json
import sqlite3
import pytest

from api.services.journal_two import db as j2db
from api.services.journal_two import notes as notes_svc


@pytest.fixture()
def conn(tmp_path, monkeypatch):
    """Fresh sandboxed J2 db with the real, current schema applied.

    Was a hand-rolled `executescript(_J2_SCHEMA)` + `run_notebook_migration_v2`
    replica of `ensure_schema()` — it silently skipped `_PHASE_2_ALTERS`, so
    every column added there (e.g. Wave 0's `deleted_at`) never reached this
    fixture. Calling the real function keeps this fixture from drifting from
    production schema again."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    c = sqlite3.connect(tmp_path / "j2_test.db")
    c.row_factory = sqlite3.Row
    j2db.ensure_schema(c)
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


def test_import_check_does_not_silently_truncate_a_library_past_5000_keys(conn):
    """audit B1: `import_check` used to slice `[:5000]` with no signal to the
    caller. 5,000 is the wave's own benchmark size, so a note sitting one
    past that boundary is exactly the case that matters — it must still be
    reported as existing, and the response must never claim a truncation
    that didn't happen when the whole request fit."""
    # A real note sitting well past the old 5,000-key cutoff.
    notes_svc.import_confirm("u1", {"source": "x", "destFolderId": None,
                                     "notes": [_mk_import_note("x:5500")]}, conn=conn)
    keys = [f"x:{i}" for i in range(6000)]  # includes "x:5500"
    out = notes_svc.import_check("u1", keys, conn=conn)
    assert "x:5500" in out["existing"], (
        "a key past the old [:5000] cutoff was not checked at all — it would "
        "come back classified as a new note (a create), duplicating an "
        "existing one on re-import"
    )
    assert out.get("truncated") is not True
    assert out["checked"] == 6000
    assert out["total"] == 6000


def _mk_import_note_with_media(key, ref="abc123"):
    return {
        "importKey": key, "title": "With media",
        "bodyJson": {"type": "doc", "content": [
            {"type": "image", "attrs": {"src": f"import-ref://{ref}"}}]},
        "tags": [], "folderPath": ["Inbox"],
        "createdAt": "2024-03-01T12:00:00Z", "updatedAt": "2024-03-02T12:00:00Z",
    }


def test_import_confirm_marks_media_pending_until_the_client_confirms_it_resolved(conn):
    """audit B5: a note whose body still carries an unresolved import-ref://
    placeholder must not be treated as fully imported. If the client's
    post-confirm media upload fails, the note must be retried on the next
    import attempt instead of matching its fingerprint and coming back
    `skipped` forever (the exact permanent-data-loss shape the audit found:
    a failed image upload silently stripped the image and never retried)."""
    out = notes_svc.import_confirm("u1", {"source": "x", "destFolderId": None,
                                           "notes": [_mk_import_note_with_media("x:img")]}, conn=conn)
    note_id = out["created"][0]["id"]
    row = conn.execute("SELECT import_media_pending FROM j2_notes WHERE id=?", (note_id,)).fetchone()
    assert row["import_media_pending"] == 1

    # The client's media upload FAILED: rewriteBody dropped the unresolved
    # image node and the commit pipeline reports the failure honestly.
    notes_svc.update_note("u1", note_id, {
        "bodyJson": {"type": "doc", "content": []},
        "importMediaPending": True,
    }, conn=conn)

    # Member re-drops the SAME export. The fingerprint (over the ORIGINAL
    # import payload, unchanged) must not let this note skip past retry.
    again = notes_svc.import_confirm("u1", {"source": "x", "destFolderId": None,
                                             "notes": [_mk_import_note_with_media("x:img")]}, conn=conn)
    assert any(item["importKey"] == "x:img" for item in again["updated"]), (
        "a note whose media previously failed must be retried, not silently "
        "marked skipped forever"
    )
    assert not any(item["importKey"] == "x:img" for item in again["skipped"])


def test_import_confirm_skips_a_note_once_its_media_is_confirmed_resolved(conn):
    """The other half of the B5 fix: once the client reports the media
    phase actually succeeded, the note is genuinely done and re-importing
    the same export must not needlessly re-process it forever."""
    out = notes_svc.import_confirm("u1", {"source": "x", "destFolderId": None,
                                           "notes": [_mk_import_note_with_media("x:img2")]}, conn=conn)
    note_id = out["created"][0]["id"]

    notes_svc.update_note("u1", note_id, {
        "bodyJson": {"type": "doc", "content": [
            {"type": "image", "attrs": {"src": "/api/j2/notes/attachments/real.png"}}]},
        "importMediaPending": False,
    }, conn=conn)

    again = notes_svc.import_confirm("u1", {"source": "x", "destFolderId": None,
                                             "notes": [_mk_import_note_with_media("x:img2")]}, conn=conn)
    assert any(item["importKey"] == "x:img2" for item in again["skipped"])


def test_import_confirm_isolates_one_bad_note_and_commits_its_healthy_siblings(conn):
    """⛔⛔ session-audit.md A1/A2: ONE note that cannot be stored (here, a
    malformed body) must not roll back the whole batch. This test used to
    assert the OPPOSITE (`test_import_confirm_is_atomic`) — the audit's own
    root-cause reproduction against the real engine measured a 1.2MB
    Obsidian note taking twelve healthy siblings down with it: "notes in
    the member's notebook: 0 of 13", `status: ok`. The bad note is now
    reported in `failed`, by importKey, with its error — everything else in
    the batch commits normally."""
    good = {"source": "x", "destFolderId": None,
            "notes": [_mk_import_note("x:ok"),
                       {"importKey": "x:bad", "title": "B", "bodyJson": "not-a-doc",
                        "tags": [], "folderPath": []}]}
    r = notes_svc.import_confirm("u1", good, conn=conn)
    assert [n["importKey"] for n in r["created"]] == ["x:ok"]
    assert r["failed"] == [{
        "importKey": "x:bad",
        "error": "body_json must be valid JSON",
    }]
    # The healthy note actually landed — the OPPOSITE of the old all-or-
    # nothing rollback.
    assert notes_svc.import_check("u1", ["x:ok"], conn=conn)["existing"] != {}
    # The bad note was never stored under any id.
    assert notes_svc.import_check("u1", ["x:bad"], conn=conn)["existing"] == {}


def test_import_confirm_reimporting_a_previously_failed_note_recovers_it(conn):
    """A re-push with the SAME importKey but a now-VALID body must succeed —
    this is the "re-push recovers rather than skips" contract: a note that
    failed to store leaves no row behind, so a later import_confirm call
    for that importKey is treated as brand new, never as an unchanged
    (and therefore skipped) note."""
    bad = {"source": "x", "destFolderId": None,
           "notes": [{"importKey": "x:fix-me", "title": "Bad", "bodyJson": "not-a-doc",
                      "tags": [], "folderPath": []}]}
    r1 = notes_svc.import_confirm("u1", bad, conn=conn)
    assert r1["created"] == [] and len(r1["failed"]) == 1

    fixed = {"source": "x", "destFolderId": None,
             "notes": [_mk_import_note("x:fix-me", "Fixed")]}
    r2 = notes_svc.import_confirm("u1", fixed, conn=conn)
    assert [n["importKey"] for n in r2["created"]] == ["x:fix-me"]
    assert r2["failed"] == []
    note = notes_svc.get_note("u1", r2["created"][0]["id"], conn=conn)
    assert note["title"] == "Fixed"


# ── 2026-09-02 adversarial audit: note SIZE, not count, is what breaks this
# feature, and "not-a-doc" above is a MALFORMED-shape failure, not a
# SIZE-triggered one -- it never actually exercises `_validate_body_json`'s
# byte-cap branch. These fixtures build the two REAL shapes the audit calls
# out as what actually breaks a migrating member (a long meeting/daily-notes
# log of bullets+checkboxes, and a note carrying many inline images) sized
# to specific, MEASURED byte counts (not a round number, not uniform filler
# that would convert/compress for free) -- one just under the storage cap,
# one just over it, both realistic shapes a real adapter conversion produces.

def _meeting_log_doc(n_bullets: int, n_checks: int) -> dict:
    """A long meeting/daily-notes log: a heading, then hundreds-to-thousands
    of bullet items and checkbox task items -- the shape a markdown adapter
    actually emits for a real trading-journal daily file, not a single giant
    text blob (which would misrepresent what actually blows up the JSON
    body: node/attrs overhead per item, not raw character count)."""
    return {
        "type": "doc",
        "content": [
            {"type": "heading", "attrs": {"level": 2},
             "content": [{"type": "text", "text": "Daily Notes"}]},
            {"type": "bulletList", "content": [
                {"type": "listItem", "content": [
                    {"type": "paragraph", "content": [
                        {"type": "text", "text": f"Discussed item {i} with the team about the trade plan"}]}]}
                for i in range(n_bullets)]},
            {"type": "taskList", "content": [
                {"type": "taskItem", "attrs": {"checked": i % 2 == 0}, "content": [
                    {"type": "paragraph", "content": [
                        {"type": "text", "text": f"Follow up on action item {i} before next session"}]}]}
                for i in range(n_checks)]},
        ],
    }


def _many_inline_images_doc(n: int) -> dict:
    """A note carrying many inline images (chart screenshots pasted into a
    review note) -- structurally different overhead from the bullet/
    checkbox shape above (attrs-heavy leaf nodes vs. many small text runs),
    exercising the SAME size cap through a different real note shape."""
    content = [{"type": "heading", "attrs": {"level": 2},
                "content": [{"type": "text", "text": "Screenshots"}]}]
    for i in range(n):
        content.append({"type": "paragraph",
                         "content": [{"type": "text", "text": f"Chart snapshot {i}:"}]})
        content.append({"type": "image", "attrs": {
            "src": f"/api/j2/notes/attachments/u1/n1/inline/chart-{i:05d}.png",
            "alt": f"chart {i}"}})
    return {"type": "doc", "content": content}


def test_import_confirm_commits_a_realistic_near_boundary_meeting_log_among_many_siblings(conn):
    """The POSITIVE case nothing measured before: a genuinely large, real-
    shaped note (measured 948,453 bytes of TipTap JSON -- just under
    `notes.MAX_BODY_JSON_BYTES`) must actually commit, not merely fail
    gracefully. Every prior test in this suite (and the audit's own
    findings) only ever exercised the FAILURE side of the size cap; a
    regression that made the boundary too tight (or broke storage of a
    genuinely large-but-valid body) would pass every one of them."""
    big = _meeting_log_doc(2850, 2850)
    big_bytes = len(json.dumps(big).encode("utf-8"))
    assert 900_000 < big_bytes < notes_svc.MAX_BODY_JSON_BYTES

    notes = [_mk_import_note(f"x:small-{i}") for i in range(3)]
    notes.insert(1, {"importKey": "x:big", "title": "Daily Log", "bodyJson": big,
                      "tags": [], "folderPath": []})
    payload = {"source": "file", "destFolderId": None, "notes": notes}
    r = notes_svc.import_confirm("u1", payload, conn=conn)
    assert r["failed"] == []
    assert {n["importKey"] for n in r["created"]} == {
        "x:small-0", "x:small-1", "x:small-2", "x:big"}
    stored = notes_svc.get_note(
        "u1", next(n["id"] for n in r["created"] if n["importKey"] == "x:big"), conn=conn)
    assert len(stored["bodyJson"]["content"][1]["content"]) == 2850  # the full body landed, not truncated


def test_import_confirm_isolates_a_realistically_oversized_meeting_log_without_losing_siblings(conn):
    """The audit's own diagnosis: the earlier isolation test
    (`test_import_confirm_isolates_one_bad_note_and_commits_its_healthy_
    siblings`) uses a MALFORMED body ("not-a-doc"), which trips
    `_validate_body_json`'s JSON-parse branch, never its byte-cap branch --
    a genuine size trip was never exercised. This is a real, structurally
    valid daily-notes log (measured 1,015,153 bytes -- just over the cap),
    sandwiched between healthy siblings on BOTH sides so isolation is
    proven regardless of the bad note's position in the batch."""
    huge = _meeting_log_doc(3050, 3050)
    huge_bytes = len(json.dumps(huge).encode("utf-8"))
    assert huge_bytes > notes_svc.MAX_BODY_JSON_BYTES

    payload = {"source": "file", "destFolderId": None, "notes": [
        _mk_import_note("x:before-1"),
        _mk_import_note("x:before-2"),
        {"importKey": "x:huge-log", "title": "Huge Daily Log", "bodyJson": huge,
         "tags": [], "folderPath": []},
        _mk_import_note("x:after-1"),
        _mk_import_note("x:after-2"),
    ]}
    r = notes_svc.import_confirm("u1", payload, conn=conn)
    assert {n["importKey"] for n in r["created"]} == {
        "x:before-1", "x:before-2", "x:after-1", "x:after-2"}
    assert r["failed"] == [{"importKey": "x:huge-log", "error": "body_json too large (>1MB)"}]
    assert notes_svc.import_check("u1", ["x:huge-log"], conn=conn)["existing"] == {}


def test_import_confirm_isolates_an_oversized_many_inline_images_note(conn):
    """A structurally different large-note shape (many inline images, not
    text-heavy lists) -- proves the size cap and its per-note isolation
    aren't coincidentally correct only for the bullet/checkbox family."""
    huge = _many_inline_images_doc(5000)
    huge_bytes = len(json.dumps(huge).encode("utf-8"))
    assert huge_bytes > notes_svc.MAX_BODY_JSON_BYTES

    payload = {"source": "file", "destFolderId": None, "notes": [
        _mk_import_note("x:ok-1"),
        {"importKey": "x:huge-images", "title": "Chart Review", "bodyJson": huge,
         "tags": [], "folderPath": []},
        _mk_import_note("x:ok-2"),
    ]}
    r = notes_svc.import_confirm("u1", payload, conn=conn)
    assert {n["importKey"] for n in r["created"]} == {"x:ok-1", "x:ok-2"}
    assert r["failed"] == [{"importKey": "x:huge-images", "error": "body_json too large (>1MB)"}]


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


# ── 2026-09-04 adversarial gate: the COUNT regime, proven END-TO-END ────────
#
# The existing 5,000-key regression test (above) only proves `import_check`'s
# key-membership lookup doesn't truncate. It never actually CREATES more than
# 5,000 notes and never re-imports them — so it says nothing about whether
# `import_confirm`'s upsert-by-fingerprint logic (a completely different code
# path, keyed on `import_key`, not on request size) still resolves correctly
# once a real library has grown past that boundary. This test builds a real
# 5,300-note library through the exact multi-batch shape the frontend uses
# (chunked confirm calls, same as `commit.js`'s CONFIRM_BATCH_SIZE loop),
# re-imports the WHOLE thing with two notes edited (one just past the old
# 5,000 cutoff, one at the very end), and proves nothing on either side of
# that boundary duplicates.
_SCALE_N = 5300
_SCALE_BATCH = 500


def _scale_notes(mutate_indices=frozenset()):
    out = []
    for i in range(_SCALE_N):
        text = f"EDITED content for note {i}" if i in mutate_indices else f"content for note {i}"
        out.append({
            "importKey": f"lib:{i}", "title": f"Note {i}",
            "bodyJson": {"type": "doc", "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": text}]}]},
            "tags": [], "folderPath": ["Imported"],
            "createdAt": "2024-01-01T00:00:00Z", "updatedAt": "2024-01-01T00:00:00Z",
        })
    return out


def test_import_confirm_at_scale_past_5000_notes_reimport_updates_not_duplicates(conn):
    first_pass = _scale_notes()
    ids_by_key = {}
    for i in range(0, _SCALE_N, _SCALE_BATCH):
        chunk = first_pass[i:i + _SCALE_BATCH]
        r = notes_svc.import_confirm(
            "u1", {"source": "file", "destFolderId": None, "notes": chunk}, conn=conn)
        assert r["failed"] == [], r["failed"]
        assert len(r["created"]) == len(chunk)
        for item in r["created"]:
            ids_by_key[item["importKey"]] = item["id"]

    total = conn.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id='u1'").fetchone()[0]
    assert total == _SCALE_N

    # import_check across every key in the library, spanning the old 5,000
    # cutoff, must report every one existing -- never truncated.
    all_keys = [f"lib:{i}" for i in range(_SCALE_N)]
    check = notes_svc.import_check("u1", all_keys, conn=conn)
    assert check["truncated"] is not True
    assert check["checked"] == _SCALE_N
    assert len(check["existing"]) == _SCALE_N
    assert "lib:5299" in check["existing"], (
        "a key past the old [:5000] cutoff was not reported as existing at "
        "import_check time"
    )
    assert check["existing"]["lib:5299"]["id"] == ids_by_key["lib:5299"]

    # Re-import the SAME library, unmodified except two edits: one just past
    # the old 5,000 cutoff (5001) and one at the very tail (5299).
    mutate = {5001, 5299}
    second_pass = _scale_notes(mutate)
    for i in range(0, _SCALE_N, _SCALE_BATCH):
        chunk = second_pass[i:i + _SCALE_BATCH]
        chunk_keys = {n["importKey"] for n in chunk}
        r = notes_svc.import_confirm(
            "u1", {"source": "file", "destFolderId": None, "notes": chunk}, conn=conn)
        assert r["failed"] == [], r["failed"]
        created_keys = {n["importKey"] for n in r["created"]}
        updated_keys = {n["importKey"] for n in r["updated"]}
        skipped_keys = {n["importKey"] for n in r["skipped"]}
        assert created_keys == set(), (
            f"re-import DUPLICATED instead of updating: {created_keys} came "
            "back as brand-new creates for import keys that already existed"
        )
        expected_updated = {f"lib:{i}" for i in mutate} & chunk_keys
        assert updated_keys == expected_updated
        assert skipped_keys == chunk_keys - expected_updated

    # The two edited notes were genuinely UPDATED in place (same id, new
    # body) -- not deleted and recreated under a fresh id.
    note_5001 = notes_svc.get_note("u1", ids_by_key["lib:5001"], conn=conn)
    assert "EDITED" in note_5001["bodyJson"]["content"][0]["content"][0]["text"]
    note_5299 = notes_svc.get_note("u1", ids_by_key["lib:5299"], conn=conn)
    assert "EDITED" in note_5299["bodyJson"]["content"][0]["content"][0]["text"]

    total_after = conn.execute("SELECT COUNT(*) FROM j2_notes WHERE user_id='u1'").fetchone()[0]
    assert total_after == _SCALE_N, (
        f"expected {_SCALE_N} notes after re-import, found {total_after} -- "
        "the re-import duplicated rows instead of updating/skipping them"
    )


# ── Pathological titles ─────────────────────────────────────────────────────
# Real exports produce titles with colons/slashes (legal in an H1-extracted
# title even though neither can appear in a filesystem PATH SEGMENT), full
# unicode, and titles far longer than any UI affordance. None of these are
# ever used as a path component (import_key is derived from the source
# FILE PATH, never from title) -- the only real risk is truncation/mangling,
# plus a malformed (non-string) title must isolate like any other bad note.

def test_import_confirm_handles_pathological_titles_without_corrupting_siblings(conn):
    long_title = "A" * 500
    unicode_title = '复盘: 2024/03 交易日志 — "盘整" review 📈🚀'
    payload = {"source": "file", "destFolderId": None, "notes": [
        {"importKey": "x:colon", "title": "AAPL: the thesis",
         "bodyJson": {"type": "doc", "content": []}, "tags": [], "folderPath": []},
        {"importKey": "x:slash", "title": "Q1/Q2 comparison",
         "bodyJson": {"type": "doc", "content": []}, "tags": [], "folderPath": []},
        {"importKey": "x:unicode", "title": unicode_title,
         "bodyJson": {"type": "doc", "content": []}, "tags": [], "folderPath": []},
        {"importKey": "x:long", "title": long_title,
         "bodyJson": {"type": "doc", "content": []}, "tags": [], "folderPath": []},
        # malformed: a non-string title. Truthy, so it clears the `or
        # "Untitled"` guard, then `.strip()` raises on an int -- must be
        # isolated via `failed`, not crash the whole batch.
        {"importKey": "x:bad-title", "title": 12345,
         "bodyJson": {"type": "doc", "content": []}, "tags": [], "folderPath": []},
    ]}
    r = notes_svc.import_confirm("u1", payload, conn=conn)
    created = {n["importKey"]: n["id"] for n in r["created"]}
    assert {"x:colon", "x:slash", "x:unicode", "x:long"} <= created.keys(), (
        f"a healthy pathological-title note failed to import: {r['failed']}"
    )
    assert notes_svc.get_note("u1", created["x:colon"], conn=conn)["title"] == "AAPL: the thesis"
    assert notes_svc.get_note("u1", created["x:slash"], conn=conn)["title"] == "Q1/Q2 comparison"
    assert notes_svc.get_note("u1", created["x:unicode"], conn=conn)["title"] == unicode_title
    stored_long = notes_svc.get_note("u1", created["x:long"], conn=conn)["title"]
    assert len(stored_long) == notes_svc.MAX_TITLE_CHARS
    assert stored_long == long_title[:notes_svc.MAX_TITLE_CHARS]
    # The malformed title is isolated -- named by importKey, not silently
    # dropped and not aborting its healthy siblings above.
    assert any(f["importKey"] == "x:bad-title" for f in r["failed"]), r["failed"]
