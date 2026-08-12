# Notebook Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** File-based importer that converts Notion / Obsidian / Evernote / generic (md, txt, html, docx, TextBundle) exports into native Notebook notes — nested folders, tags, images, attachments, original dates, re-import-safe — plus the editor upgrades imports need (tables, checklists, attachment chips, internal links).

**Architecture:** All parsing/conversion happens in the browser. Adapters normalize each format to a common intermediate `{title, html, tags, dates, folderPath, media, links}`; a shared converter sanitizes the HTML and runs TipTap v3 `generateJSON` with the editor's own extension list (fidelity by construction). A new transactional bulk endpoint upserts notes by fingerprint; media and link-resolution happen in a follow-up phase per note.

**Tech Stack:** React + Vite (vitest from `app/`), FastAPI + SQLite (pytest, sandboxed by repo-root conftest), TipTap v3 (`^3.23.6` family), new frontend deps: `fflate`, `markdown-it`, `markdown-it-task-lists`, `mammoth`, `spark-md5`. No new backend deps.

**Spec:** `docs/superpowers/specs/2026-08-11-notebook-import-design.md`

## Global Constraints

- Worktree: `C:\Users\Patrick\uct-worktrees\notebook-import`, branch `notebook-import`. Commit with explicit paths (`git add <paths>` — NEVER `git add -A`). Do NOT push to master; ship is `git push origin notebook-import:master` on explicit owner "ship it" only, inside the deploy window (≥4:20 PM ET or <9:15 AM ET).
- **Ids are TEXT uuid hex** (`uuid.uuid4().hex`) for notes AND folders — the shipped schema, not the 5/26 spec's illustrative INTEGER SQL.
- Frontend tests: `cd app && npx vitest run <file>` — NEVER `npm --prefix app` / `--root app` (phantom failures). Beware CRLF: never `toContain('\n...')` on multiline strings; compare normalized strings.
- Backend tests: run from repo root, `python -m pytest <file> -v`. The repo-root `conftest.py` sandboxes `/data` paths — do not bypass it.
- UI icons: `<UIcon name="..." />` — NO emoji in new UI. Breakpoints: only 640/1024 CSS literals.
- TipTap v3 packaging: tables from `@tiptap/extension-table` (exports `Table, TableRow, TableHeader, TableCell`), task lists from `@tiptap/extension-list` (exports `TaskList, TaskItem`). Install with the same `^3.23.6` range as existing TipTap deps.
- New heavy libs (`fflate`, `markdown-it*`, `mammoth`, `spark-md5`) must be imported ONLY inside `app/src/pages/journal-2-0/lib/importer/**` modules that are loaded via dynamic `import()` from the wizard — the main bundle must not grow.
- `parent_id` uses `''` (empty string) as the root sentinel, NOT NULL — SQLite treats NULLs as distinct in UNIQUE constraints, so `UNIQUE(user_id, parent_id, name)` would not deduplicate root folders with NULL. No SQL FK on parent_id (the sentinel would violate it); parent existence is service-enforced.
- API `parentId` serialization: `''` in the DB ⇔ `null` in JSON (`_row_to_folder` maps `'' → None`).

## File Structure

```
api/services/journal_two/db.py                 # + run_notebook_migration_v2
api/services/journal_two/notes.py              # + tree folder CRUD, ensure_folder_path, import_check/import_confirm, save_note_attachment
api/services/journal_two/test_notes_import.py  # NEW: migration v2 + tree + import upsert tests
api/routers/journal_two.py                     # + parentId on folders, /notes/import/check|confirm, /notes/{id}/attachments

app/src/pages/journal-2-0/lib/tiptap.js        # + Table/TaskList/TaskItem/AttachmentChip, link carve-out, plainText for chips
app/src/pages/journal-2-0/lib/attachmentChip.js         # NEW: AttachmentChip node
app/src/pages/journal-2-0/lib/tiptap.import.test.js     # NEW: generateJSON fixtures (table, taskItem, chip, internal link)
app/src/pages/journal-2-0/hooks/useJ2NoteFolders.js     # + parentId on create
app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx        # tree rendering
app/src/pages/journal-2-0/components/notebook/FolderSidebar.test.jsx   # NEW

app/src/pages/journal-2-0/lib/importer/convert.js       # sanitize + checkbox map + html→TipTap JSON
app/src/pages/journal-2-0/lib/importer/intake.js        # drop collection, folder walk, zip (fflate), caps
app/src/pages/journal-2-0/lib/importer/registry.js      # adapter registry + detectAdapter
app/src/pages/journal-2-0/lib/importer/adapters/generic.js
app/src/pages/journal-2-0/lib/importer/adapters/notion.js
app/src/pages/journal-2-0/lib/importer/adapters/obsidian.js
app/src/pages/journal-2-0/lib/importer/adapters/evernote.js
app/src/pages/journal-2-0/lib/importer/commit.js        # check/confirm/media/rewrite pipeline
app/src/pages/journal-2-0/lib/importer/__fixtures__/    # tiny golden exports per adapter
app/src/pages/journal-2-0/lib/importer/*.test.js        # one test file per module

app/src/pages/journal-2-0/components/notebook/import/ImportWizard.jsx  # + .module.css
app/src/pages/journal-2-0/components/notebook/import/ImportWizard.test.jsx
app/src/pages/journal-2-0/tabs/NotebookTab.jsx          # Import button + empty-state pitch
```

Conversion pipeline (all inside the lazy importer chunk):

```
DataTransfer → intake.collect() → VFile[] {path, bytes(), size, lastModified}
             → registry.detect(vfiles) → adapter
             → adapter.parse(vfiles) → { docs: IntermediateDoc[], folders: string[][], warnings: [] }
             → convert.htmlToNote(doc)  → { bodyJson, bodyPlain }  (per doc)
             → commit.runImport(...)    → check → confirm → media/links → summary
```

`IntermediateDoc = { importKey, title, subtitle?, html, tags: string[], createdAt?, updatedAt?, folderPath: string[], media: [{ref, vfile, kind:'image'|'file', name}], links: [{placeholder, targetKey}] }`

---

### Task 1: Migration v2 — folder tree columns + import provenance

**Files:**
- Modify: `api/services/journal_two/db.py` (add `run_notebook_migration_v2`, call it right after `run_notebook_migration_v1(conn)` in the init path — grep `run_notebook_migration_v1(conn)` for the call site)
- Test: `api/services/journal_two/test_notes_import.py` (new file)

**Interfaces:**
- Produces: `j2_note_folders.parent_id TEXT NOT NULL DEFAULT ''`, `UNIQUE(user_id, parent_id, name)`; `j2_notes` columns `import_source TEXT`, `import_key TEXT`, `import_hash TEXT`, `imported_at TEXT`; index `idx_j2_notes_user_import(user_id, import_key)`. Flag file `.notebook_migration_v2` in DATA_DIR.
- Consumes: existing `_data_dir()` helper and the v1 migration's flag-file pattern (read `run_notebook_migration_v1` in db.py:783 first and mirror its structure exactly).

- [ ] **Step 1: Write the failing tests**

```python
# api/services/journal_two/test_notes_import.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest api/services/journal_two/test_notes_import.py -v`
Expected: FAIL — `run_notebook_migration_v2` does not exist.

- [ ] **Step 3: Implement `run_notebook_migration_v2` in db.py**

Mirror the v1 pattern (flag file, try/except, log line). Place directly below `run_notebook_migration_v1`:

```python
def run_notebook_migration_v2(conn: sqlite3.Connection) -> None:
    """Folder tree (parent_id) + import provenance columns on j2_notes.
    Idempotent via .notebook_migration_v2 flag file AND column probes, so a
    fresh DB created after this ships is also handled. parent_id uses ''
    as the root sentinel (NULLs are distinct in SQLite UNIQUE constraints,
    which would allow duplicate root names)."""
    flag = _data_dir() / ".notebook_migration_v2"
    try:
        if flag.exists():
            return
        fcols = {r[1] for r in conn.execute("PRAGMA table_info(j2_note_folders)")}
        if fcols and "parent_id" not in fcols:
            conn.execute("ALTER TABLE j2_note_folders RENAME TO j2_note_folders_v1")
            conn.execute(
                """CREATE TABLE j2_note_folders (
                    id          TEXT PRIMARY KEY,
                    user_id     TEXT NOT NULL,
                    name        TEXT NOT NULL,
                    parent_id   TEXT NOT NULL DEFAULT '',
                    sort_order  INTEGER NOT NULL DEFAULT 0,
                    created_at  TEXT NOT NULL,
                    UNIQUE(user_id, parent_id, name))"""
            )
            conn.execute(
                "INSERT INTO j2_note_folders (id, user_id, name, parent_id, sort_order, created_at) "
                "SELECT id, user_id, name, '', sort_order, created_at FROM j2_note_folders_v1"
            )
            conn.execute("DROP TABLE j2_note_folders_v1")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_j2_note_folders_user "
                "ON j2_note_folders(user_id, sort_order)"
            )
        ncols = {r[1] for r in conn.execute("PRAGMA table_info(j2_notes)")}
        for col in ("import_source", "import_key", "import_hash", "imported_at"):
            if ncols and col not in ncols:
                conn.execute(f"ALTER TABLE j2_notes ADD COLUMN {col} TEXT")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_j2_notes_user_import "
            "ON j2_notes(user_id, import_key)"
        )
        conn.commit()
        flag.parent.mkdir(parents=True, exist_ok=True)
        flag.touch()
    except Exception as e:  # same failure posture as v1 — never block startup
        print(f"[j2] notebook migration v2 failed: {e}")
```

Also: the base `_J2_SCHEMA` `CREATE TABLE IF NOT EXISTS j2_note_folders` block must be updated to the NEW shape (with `parent_id`), and `j2_notes` in `_J2_SCHEMA` gains the four new columns — so a fresh install needs no rebuild (the migration's column probes then no-op). Add the call `run_notebook_migration_v2(conn)` immediately after the existing `run_notebook_migration_v1(conn)` call site.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest api/services/journal_two/test_notes_import.py -v`
Expected: 2 PASS. Also run the existing suite to catch schema regressions: `python -m pytest api/services/journal_two/test_notes.py -v` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/db.py api/services/journal_two/test_notes_import.py
git commit -m "feat(notebook): migration v2 - folder tree + import provenance columns"
```

---

### Task 2: Folder tree service — parent create, depth cap, delete re-parenting, path upsert

**Files:**
- Modify: `api/services/journal_two/notes.py` (`_row_to_folder`, `create_folder`, `delete_folder`; add `MAX_FOLDER_DEPTH`, `_folder_depth`, `ensure_folder_path`)
- Modify: `api/routers/journal_two.py` (folder create/update endpoints accept `parentId` — find `create_folder_endpoint` at the `/note-folders` POST)
- Test: `api/services/journal_two/test_notes_import.py` (extend)

**Interfaces:**
- Produces: `create_folder(user_id, name, sort_order=0, parent_id="", conn=None) -> dict` (dict gains `"parentId": str|None` — `''` maps to `None`); `delete_folder(user_id, folder_id, conn=None) -> bool` re-parents child folders AND notes to the deleted folder's parent (root deletion → notes go Unfiled, preserving today's behavior); `ensure_folder_path(user_id, path_parts: list[str], dest_folder_id: str = "", conn=None) -> str` (returns the leaf folder id, creating missing segments); `MAX_FOLDER_DEPTH = 6`.
- Consumes: Task 1 schema.

- [ ] **Step 1: Write the failing tests** (append to test_notes_import.py)

```python
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
```

- [ ] **Step 2: Run to verify FAIL** — `python -m pytest api/services/journal_two/test_notes_import.py -v` → new tests fail (`parent_id` kwarg / `ensure_folder_path` missing).

- [ ] **Step 3: Implement in notes.py**

```python
MAX_FOLDER_DEPTH = 6

def _row_to_folder(row):  # extend the existing fn: add parentId
    d = {... existing keys ...}
    d["parentId"] = row["parent_id"] or None
    return d

def _folder_depth(conn, user_id: str, folder_id: str) -> int:
    """1-based depth of folder_id. Walks up; a cycle or missing parent stops the walk."""
    depth, cur, seen = 0, folder_id, set()
    while cur and cur not in seen:
        seen.add(cur)
        row = conn.execute(
            "SELECT parent_id FROM j2_note_folders WHERE id = ? AND user_id = ?",
            (cur, user_id)).fetchone()
        if row is None:
            break
        depth += 1
        cur = row["parent_id"]
    return depth
```

`create_folder` gains `parent_id: str = ""`: when truthy, verify the parent row exists for this user (else `NoteValidationError("parent folder not found")`) and `_folder_depth(conn, user_id, parent_id) + 1 <= MAX_FOLDER_DEPTH` (else `NoteValidationError("folder nesting too deep")`); insert `parent_id` (default `''`). `delete_folder` becomes:

```python
def delete_folder(user_id, folder_id, conn=None) -> bool:
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT parent_id FROM j2_note_folders WHERE id = ? AND user_id = ?",
            (folder_id, user_id)).fetchone()
        if row is None:
            return False
        parent = row["parent_id"] or ""
        now = _now_iso()
        # notes climb to the parent; at root ('' parent) they go Unfiled (NULL)
        conn.execute(
            "UPDATE j2_notes SET folder_id = ?, updated_at = ? WHERE folder_id = ? AND user_id = ?",
            (parent or None, now, folder_id, user_id))
        conn.execute(
            "UPDATE j2_note_folders SET parent_id = ? WHERE parent_id = ? AND user_id = ?",
            (parent, folder_id, user_id))
        cur = conn.execute(
            "DELETE FROM j2_note_folders WHERE id = ? AND user_id = ?", (folder_id, user_id))
        conn.commit()
        return cur.rowcount > 0
    finally:
        if owned:
            conn.close()

def ensure_folder_path(user_id, path_parts, dest_folder_id: str = "", conn=None) -> str:
    """Upsert a folder chain under dest_folder_id; returns leaf folder id.
    Truncates each segment to the 80-char folder-name cap."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        pid = dest_folder_id or ""
        for raw in path_parts:
            name = (raw or "").strip()[:80] or "Untitled"
            row = conn.execute(
                "SELECT id FROM j2_note_folders WHERE user_id = ? AND parent_id = ? AND name = ?",
                (user_id, pid, name)).fetchone()
            if row:
                pid = row["id"]
            else:
                pid = create_folder(user_id, name, parent_id=pid, conn=conn)["id"]
        return pid
    finally:
        if owned:
            conn.close()
```

Note: a name-collision on re-import is handled by the SELECT-first (reuse). Router: `create_folder_endpoint` passes `payload.get("parentId") or ""` through as `parent_id`; the PUT endpoint does NOT accept parentId moves in v1 (YAGNI — imports create paths, users reorganize by drag later).

- [ ] **Step 4: Run to verify PASS** — same command; also `python -m pytest api/services/journal_two/test_notes.py -v` (delete_folder behavior for ROOT folders is unchanged: notes → Unfiled — existing tests must stay green).

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/notes.py api/routers/journal_two.py api/services/journal_two/test_notes_import.py
git commit -m "feat(notebook): folder tree service - parent create, depth cap, reparenting delete, path upsert"
```

---

### Task 3: Import check + confirm endpoints (transactional upsert by fingerprint)

**Files:**
- Modify: `api/services/journal_two/notes.py` (add `import_check`, `import_confirm`, `_import_payload_hash`)
- Modify: `api/routers/journal_two.py` (add `POST /notes/import/check` + `POST /notes/import/confirm` — **declare them ABOVE the existing `/notes/{note_id}` routes** per this repo's route-order lesson)
- Test: `api/services/journal_two/test_notes_import.py` (extend)

**Interfaces:**
- Produces:
  - `import_check(user_id, import_keys: list[str], conn=None) -> dict` → `{"existing": {key: {"id", "updatedAt", "importHash"}}}`
  - `import_confirm(user_id, payload: dict, conn=None) -> dict` → `{"created": [{"importKey","id"}], "updated": [...], "skipped": [...]}`
  - payload shape: `{"source": str, "destFolderId": str|None, "notes": [{"importKey", "title", "subtitle"?, "bodyJson", "tags", "ticker"?, "createdAt"?, "updatedAt"?, "folderPath": [str, ...]}]}`
- Consumes: `ensure_folder_path` (Task 2), `_validate_body_json`/`_validate_tags`/`extract_plain_text` (existing).
- Rules: one transaction (single `conn.commit()` at the end; any exception → `conn.rollback()` + re-raise). Upsert key `(user_id, import_key)`. Skip when `_import_payload_hash(note) == stored import_hash`. `created_at`/`updated_at` come from the payload when present (ISO strings, validated by `datetime.fromisoformat` after stripping a trailing `Z`), else `_now_iso()`. Caps: ≤500 notes per confirm call (client batches), title truncated to `MAX_TITLE_CHARS`, per-note bodyJson still bounded by `MAX_BODY_JSON_BYTES`.

- [ ] **Step 1: Write the failing tests** (append)

```python
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
    assert notes_svc.import_check("u1", ["x:ok"], conn=conn)["existing"] == {}
```

- [ ] **Step 2: Run to verify FAIL** — functions missing.

- [ ] **Step 3: Implement in notes.py**

```python
import hashlib

def _import_payload_hash(note: dict) -> str:
    basis = json.dumps({
        "title": note.get("title") or "",
        "subtitle": note.get("subtitle") or None,
        "bodyJson": note.get("bodyJson") or {},
        "tags": sorted(note.get("tags") or []),
        "ticker": note.get("ticker") or None,
        "folderPath": note.get("folderPath") or [],
        "updatedAt": note.get("updatedAt") or "",
    }, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()

def _import_date(value, fallback):
    if not value or not isinstance(value, str):
        return fallback
    try:
        from datetime import datetime
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value
    except ValueError:
        return fallback

def import_check(user_id, import_keys, conn=None) -> dict:
    owned = conn is None
    conn = conn or get_connection()
    try:
        existing = {}
        keys = [k for k in (import_keys or []) if isinstance(k, str)][:5000]
        for i in range(0, len(keys), 500):  # SQLite variable limit safety
            chunk = keys[i:i + 500]
            q = ",".join("?" * len(chunk))
            for row in conn.execute(
                f"SELECT id, import_key, updated_at, import_hash FROM j2_notes "
                f"WHERE user_id = ? AND import_key IN ({q})", (user_id, *chunk)):
                existing[row["import_key"]] = {
                    "id": row["id"], "updatedAt": row["updated_at"],
                    "importHash": row["import_hash"]}
        return {"existing": existing}
    finally:
        if owned:
            conn.close()

def import_confirm(user_id, payload, conn=None) -> dict:
    if not isinstance(payload, dict) or not isinstance(payload.get("notes"), list):
        raise NoteValidationError("invalid import payload")
    notes = payload["notes"]
    if len(notes) > 500:
        raise NoteValidationError("too many notes in one batch (max 500)")
    source = (payload.get("source") or "file")[:40]
    dest = payload.get("destFolderId") or ""
    owned = conn is None
    conn = conn or get_connection()
    try:
        if dest:
            ok = conn.execute("SELECT 1 FROM j2_note_folders WHERE id = ? AND user_id = ?",
                              (dest, user_id)).fetchone()
            if not ok:
                raise NoteValidationError("destination folder not found")
        created, updated, skipped = [], [], []
        now = _now_iso()
        path_cache: dict[tuple, str] = {}
        for n in notes:
            key = n.get("importKey")
            if not key or not isinstance(key, str):
                raise NoteValidationError("importKey required on every note")
            body_json = _validate_body_json(n.get("bodyJson"))
            body_plain = extract_plain_text(body_json)
            title = (n.get("title") or "Untitled").strip()[:MAX_TITLE_CHARS]
            tags = _validate_tags(n.get("tags"))
            ticker = _validate_ticker(n.get("ticker"))
            h = _import_payload_hash(n)
            path = tuple((n.get("folderPath") or [])[:MAX_FOLDER_DEPTH])
            if path not in path_cache:
                path_cache[path] = (ensure_folder_path(user_id, list(path), dest, conn=conn)
                                    if path else (dest or None))
            folder_id = path_cache[path] or None
            row = conn.execute(
                "SELECT id, import_hash FROM j2_notes WHERE user_id = ? AND import_key = ?",
                (user_id, key)).fetchone()
            item = {"importKey": key, "id": row["id"] if row else None}
            if row and row["import_hash"] == h:
                skipped.append(item); continue
            created_at = _import_date(n.get("createdAt"), now)
            updated_at = _import_date(n.get("updatedAt"), now)
            if row:
                conn.execute(
                    "UPDATE j2_notes SET title=?, subtitle=?, body_json=?, body_plain=?, "
                    "folder_id=?, ticker=?, tags=?, import_hash=?, imported_at=?, updated_at=? "
                    "WHERE id=? AND user_id=?",
                    (title, n.get("subtitle") or None, json.dumps(body_json), body_plain,
                     folder_id, ticker, json.dumps(tags), h, now, updated_at,
                     row["id"], user_id))
                updated.append(item)
            else:
                new_id = uuid.uuid4().hex
                conn.execute(
                    "INSERT INTO j2_notes (id, user_id, folder_id, title, subtitle, body_json, "
                    "body_plain, ticker, tags, import_source, import_key, import_hash, "
                    "imported_at, created_at, updated_at) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (new_id, user_id, folder_id, title, n.get("subtitle") or None,
                     json.dumps(body_json), body_plain, ticker, json.dumps(tags),
                     source, key, h, now, created_at, updated_at))
                item["id"] = new_id
                created.append(item)
        conn.commit()
        return {"created": created, "updated": updated, "skipped": skipped}
    except Exception:
        conn.rollback()
        raise
    finally:
        if owned:
            conn.close()
```

Router additions (above the `/notes/{note_id}` block, matching the file's existing endpoint style — `user: dict = Depends(get_current_user)`, `NoteValidationError → HTTPException(400)`):

```python
@router.post("/notes/import/check")
def notes_import_check_endpoint(payload: dict[str, Any], user: dict = Depends(get_current_user)):
    return notes_service.import_check(user["id"], payload.get("importKeys") or [])

@router.post("/notes/import/confirm")
def notes_import_confirm_endpoint(payload: dict[str, Any], user: dict = Depends(get_current_user)):
    try:
        return notes_service.import_confirm(user["id"], payload)
    except notes_service.NoteValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

- [ ] **Step 4: Run to verify PASS** — `python -m pytest api/services/journal_two/test_notes_import.py -v`

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/notes.py api/routers/journal_two.py api/services/journal_two/test_notes_import.py
git commit -m "feat(notebook): transactional import check/confirm endpoints with fingerprint upsert"
```

---

### Task 4: Non-image attachment upload endpoint

**Files:**
- Modify: `api/services/journal_two/notes.py` (add `save_note_attachment`, `_ALLOWED_FILE_MIMES`, `_MAX_FILE_BYTES`)
- Modify: `api/routers/journal_two.py` (add `POST /notes/{note_id}/attachments`)
- Test: `api/services/journal_two/test_notes_import.py` (extend) + a router test if the file already has router-level tests for images (mirror them)

**Interfaces:**
- Produces: `async save_note_attachment(user_id, note_id, upload) -> {"url", "name", "size"}`. Stored under `_ATTACHMENT_ROOT/{user_id}/notes/{note_id}/file/{uuid}{ext}`, served by the EXISTING `serve_note_attachment` route (its `{sub}` segment takes `file`). `_ALLOWED_FILE_MIMES = {"application/pdf", "text/plain", "text/csv", "text/markdown", "application/zip", "audio/mpeg", "audio/mp4", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.document"}`; `_MAX_FILE_BYTES = 25 * 1024 * 1024`.
- Consumes: `_ATTACHMENT_ROOT` and the `save_note_image` idiom (mirror it, minus Pillow).

- [ ] **Step 1: Write failing test** — async test (the file's existing async image tests show the idiom; if none, use `anyio`/`asyncio` marker consistent with the repo's other async tests — check `test_notes.py` for the pattern first):

```python
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
```

- [ ] **Step 2: FAIL** — function missing.
- [ ] **Step 3: Implement** — mirror `save_note_image`: MIME allowlist check, size cap, empty-file check, `sub = "file"`, ext derived from the UPLOAD FILENAME's suffix if it is in a safe allowlist (`.pdf .txt .csv .md .zip .mp3 .m4a .docx .xlsx`) else `.bin`; return `{"url", "name": upload.filename, "size": len(raw)}`. Router endpoint mirrors `upload_note_image_endpoint` (ownership check on the note, 400 on NoteValidationError). Also verify `serve_note_attachment`'s media-type guessing serves `sub="file"` paths (it takes filename; `FileResponse` infers) — if it restricts `sub` to `{"inline","hero"}`, extend the allowed set to include `"file"`.
- [ ] **Step 4: PASS** — run the file.
- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/notes.py api/routers/journal_two.py api/services/journal_two/test_notes_import.py
git commit -m "feat(notebook): non-image attachment uploads (25MB cap, MIME allowlist)"
```

---

### Task 5: Editor upgrades — tables, task lists, attachment chip, internal links

**Files:**
- Modify: `app/package.json` (add `@tiptap/extension-table@^3.23.6`, `@tiptap/extension-list@^3.23.6` — run `npm install` from `app/`)
- Create: `app/src/pages/journal-2-0/lib/attachmentChip.js`
- Modify: `app/src/pages/journal-2-0/lib/tiptap.js` (`buildExtensions`, `extractPlainText`)
- Modify: `app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx` (add Table + Checklist entries — read its existing item array first and follow that shape exactly)
- Test: `app/src/pages/journal-2-0/lib/tiptap.import.test.js`

**Interfaces:**
- Produces: `buildExtensions()` now includes `Table, TableRow, TableHeader, TableCell` (from `@tiptap/extension-table`), `TaskList, TaskItem` (from `@tiptap/extension-list`, `TaskItem.configure({ nested: true })`), `AttachmentChip`, and Link configured to also allow app-relative `/journal...` hrefs. `AttachmentChip` node: name `attachmentChip`, block atom, attrs `{href, name, size}`, renders `<a data-type="attachmentChip" href download>`, parses the same selector. `extractPlainText` emits `[file: <name>]` for attachmentChip nodes.
- Consumes: nothing new; Tasks 7–15 depend on these extensions existing.

- [ ] **Step 1: Write the failing test**

```js
// app/src/pages/journal-2-0/lib/tiptap.import.test.js
import { describe, it, expect } from 'vitest'
import { generateJSON } from '@tiptap/core'
import { buildExtensions, extractPlainText } from './tiptap'

const ext = buildExtensions()
const toDoc = (html) => generateJSON(html, ext)
const types = (doc) => (doc.content || []).map((n) => n.type)

describe('import-critical editor extensions', () => {
  it('parses a plain HTML table', () => {
    const doc = toDoc('<table><tr><th>h</th></tr><tr><td>c</td></tr></table>')
    expect(types(doc)).toContain('table')
  })

  it('parses taskList HTML (the mapped shape) with checked state', () => {
    const doc = toDoc(
      '<ul data-type="taskList">' +
      '<li data-type="taskItem" data-checked="true">done</li>' +
      '<li data-type="taskItem" data-checked="false">todo</li></ul>')
    const list = doc.content[0]
    expect(list.type).toBe('taskList')
    expect(list.content[0].attrs.checked).toBe(true)
    expect(list.content[1].attrs.checked).toBe(false)
  })

  it('round-trips an attachment chip and plain-texts it as [file: name]', () => {
    const doc = toDoc('<a data-type="attachmentChip" href="/api/x.pdf" data-name="x.pdf" data-size="10">x.pdf</a>')
    expect(types(doc)).toContain('attachmentChip')
    expect(extractPlainText(doc)).toContain('[file: x.pdf]')
  })

  it('keeps an app-relative internal note link', () => {
    const doc = toDoc('<p><a href="/journal?j2tab=notebook&note=abc123">Alpha</a></p>')
    const mark = doc.content[0].content[0].marks?.find((m) => m.type === 'link')
    expect(mark?.attrs?.href).toBe('/journal?j2tab=notebook&note=abc123')
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — `cd app && npx vitest run src/pages/journal-2-0/lib/tiptap.import.test.js` (table/taskList/chip fail; the link case may fail if Link strips relative hrefs — that's the point).

- [ ] **Step 3: Implement**

`attachmentChip.js`:

```js
import { Node, mergeAttributes } from '@tiptap/core'

/** File-attachment chip: a downloadable non-image file in the note body. */
export const AttachmentChip = Node.create({
  name: 'attachmentChip',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      href: { default: null },
      name: { default: 'file' },
      size: { default: null },
    }
  },
  parseHTML() {
    return [{
      tag: 'a[data-type="attachmentChip"]',
      getAttrs: (el) => ({
        href: el.getAttribute('href'),
        name: el.getAttribute('data-name') || el.textContent || 'file',
        size: el.getAttribute('data-size') ? Number(el.getAttribute('data-size')) : null,
      }),
    }]
  },
  renderHTML({ node }) {
    return ['a', mergeAttributes({
      'data-type': 'attachmentChip',
      'data-name': node.attrs.name,
      'data-size': node.attrs.size ?? undefined,
      href: node.attrs.href,
      download: node.attrs.name,
      rel: 'noreferrer',
    }), node.attrs.name]
  },
})
```

`tiptap.js` — in `buildExtensions`, after the existing extensions:

```js
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { AttachmentChip } from './attachmentChip'
// ...
Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
TaskList, TaskItem.configure({ nested: true }),
AttachmentChip,
```

Link config: keep `protocols: ['https']` and add `isAllowedUri: (url, ctx) => url.startsWith('/journal') || url.startsWith('import-link://') || ctx.defaultValidate(url)` (TipTap v3 Link option). `/journal...` is the shipped internal-link form; `import-link://<targetKey>` is the TEMPORARY placeholder the import pipeline round-trips through `generateJSON` before Task 13's `rewriteBody` resolves it — without the allowance the Link mark is stripped at parse time and every wiki-link import silently dies. In `extractPlainText`'s walk add: `if (node.type === 'attachmentChip') out.push(`[file: ${node.attrs?.name || 'file'}]`)`. SlashMenu: add `Table` (inserts `insertTable({ rows: 3, cols: 3, withHeaderRow: true })`) and `Checklist` (`toggleTaskList()`) entries following the file's existing item shape. Minimal CSS for tables/task lists/chips goes in `NoteEditorPage.module.css` following its existing body-content selectors (bordered cells, checkbox row alignment, chip = pill with a `UIcon name="file"`-style glyph rendered via CSS `::before` is NOT possible for UIcon — style the chip as a bordered pill; no emoji).

- [ ] **Step 4: Run to verify PASS**, then run the full editor-adjacent suites: `cd app && npx vitest run src/pages/journal-2-0` → all green (existing NoteEditorPage tests must not regress).

- [ ] **Step 5: Commit**

```bash
git add app/package.json app/package-lock.json app/src/pages/journal-2-0/lib/tiptap.js app/src/pages/journal-2-0/lib/attachmentChip.js app/src/pages/journal-2-0/lib/tiptap.import.test.js app/src/pages/journal-2-0/components/notebook/SlashMenu.jsx app/src/pages/journal-2-0/components/notebook/NoteEditorPage.module.css
git commit -m "feat(notebook): editor gains tables, checklists, attachment chips, internal links"
```

---

### Task 6: Folder sidebar tree UI

**Files:**
- Modify: `app/src/pages/journal-2-0/hooks/useJ2NoteFolders.js` (`create(name, parentId)`)
- Modify: `app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx` + `.module.css`
- Test: `app/src/pages/journal-2-0/components/notebook/FolderSidebar.test.jsx`

**Interfaces:**
- Consumes: folders from `/api/j2/note-folders` now carry `parentId: string|null` (Task 2).
- Produces: `buildFolderTree(folders) -> [{...folder, children: [...]}]` exported from FolderSidebar.jsx for testability; sidebar renders the tree with indentation + disclosure toggles; each folder row gets an "add subfolder" affordance; delete confirm copy becomes: `Delete folder "X"? Subfolders and notes move up one level.`

- [ ] **Step 1: Write the failing test**

```jsx
// FolderSidebar.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import FolderSidebar, { buildFolderTree } from './FolderSidebar'

vi.mock('../../hooks/useJ2NoteFolders', () => ({
  default: () => ({
    folders: [
      { id: 'a', name: 'Trading', parentId: null, sortOrder: 0 },
      { id: 'b', name: 'Setups', parentId: 'a', sortOrder: 0 },
      { id: 'c', name: 'Journal', parentId: null, sortOrder: 1 },
    ],
    create: vi.fn(), rename: vi.fn(), remove: vi.fn(), refresh: vi.fn(),
  }),
}))

describe('folder tree', () => {
  it('buildFolderTree nests children under parents (orphans become roots)', () => {
    const tree = buildFolderTree([
      { id: 'a', name: 'A', parentId: null },
      { id: 'b', name: 'B', parentId: 'a' },
      { id: 'x', name: 'X', parentId: 'gone' },
    ])
    expect(tree.map((n) => n.id)).toEqual(['a', 'x'])
    expect(tree[0].children[0].id).toBe('b')
  })

  it('renders nested folder and expands/collapses it', () => {
    render(<FolderSidebar notes={[]} activeFolderId={null} onSelectFolder={() => {}}
                          activeTag={null} onSelectTag={() => {}} />)
    expect(screen.getByText('Trading')).toBeInTheDocument()
    // children hidden until the parent is expanded
    expect(screen.queryByText('Setups')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Expand Trading'))
    expect(screen.getByText('Setups')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: FAIL** — `buildFolderTree` not exported, no disclosure control.
- [ ] **Step 3: Implement.** `buildFolderTree`: index by id, attach `children` sorted by `(sortOrder, name)`, parentId pointing at a missing id → treat as root (defensive). Render recursively (`FolderNode` inner component): disclosure button (`aria-label={expanded ? 'Collapse ' : 'Expand '}${name}`, chevron via inline SVG matching CollapsibleSection's idiom — no emoji), `paddingLeft: depth * 14px`, existing rename/delete inline controls preserved, an add-subfolder button per row reusing the existing `adding` form with a `parentForNew` state. `useJ2NoteFolders.create(name, parentId)` posts `{name, ...(parentId ? {parentId} : {})}`. Expansion state in `useState(new Set())` (session-local; YAGNI on persistence).
- [ ] **Step 4: PASS**, plus `cd app && npx vitest run src/pages/journal-2-0/tabs/NotebookTab.test.jsx` (sidebar consumer) → green.
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/hooks/useJ2NoteFolders.js app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx app/src/pages/journal-2-0/components/notebook/FolderSidebar.module.css app/src/pages/journal-2-0/components/notebook/FolderSidebar.test.jsx
git commit -m "feat(notebook): nested folder tree sidebar"
```

---

### Task 7: Shared converter — sanitize + checkbox mapping + HTML→TipTap JSON

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/convert.js`
- Test: `app/src/pages/journal-2-0/lib/importer/convert.test.js`

**Interfaces:**
- Produces:
  - `sanitizeHtml(html: string) -> string` — DOMParser-based: removes `script/iframe/form/object/embed/style` elements, strips `on*` attributes and `javascript:`/`data:text` hrefs/srcs, unwraps unknown elements' text.
  - `mapCheckboxLists(doc: Document) -> void` — rewrites any `li` whose first element child is `input[type=checkbox]` (and any `li.task-list-item`) to `li[data-type="taskItem"][data-checked]`, and its parent `ul` to `ul[data-type="taskList"]`, removing the input. (TipTap TaskItem only parses this shape — GFM checkbox HTML otherwise degrades to plain bullets.)
  - `htmlToNote(html: string) -> { bodyJson, bodyPlain }` — sanitize → checkbox-map → `generateJSON(cleanHtml, buildExtensions())` → `extractPlainText`.
- Consumes: `buildExtensions`, `extractPlainText` from `../tiptap` (Task 5).
- This module is imported by every adapter; it may import TipTap statically (the whole `importer/` dir is only ever loaded via dynamic `import()` from the wizard).

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest'
import { sanitizeHtml, htmlToNote } from './convert'

describe('sanitizeHtml', () => {
  it('strips scripts, event handlers, and javascript: URLs', () => {
    const out = sanitizeHtml(
      '<p onclick="x()">hi</p><script>evil()</script><a href="javascript:alert(1)">z</a>')
    expect(out).not.toContain('script')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('hi')
  })
})

describe('htmlToNote', () => {
  it('converts GFM checkbox HTML into real taskItems with state', () => {
    const { bodyJson } = htmlToNote(
      '<ul class="contains-task-list">' +
      '<li class="task-list-item"><input type="checkbox" checked> done</li>' +
      '<li class="task-list-item"><input type="checkbox"> todo</li></ul>')
    const list = bodyJson.content[0]
    expect(list.type).toBe('taskList')
    expect(list.content[0].attrs.checked).toBe(true)
    expect(list.content[1].attrs.checked).toBe(false)
  })

  it('keeps tables and produces searchable plain text', () => {
    const { bodyJson, bodyPlain } = htmlToNote(
      '<h1>Title</h1><table><tr><td>alpha</td></tr></table>')
    expect(bodyJson.content.map((n) => n.type)).toEqual(['heading', 'table'])
    expect(bodyPlain).toContain('alpha')
  })
})
```

- [ ] **Step 2: FAIL** — module missing. Run: `cd app && npx vitest run src/pages/journal-2-0/lib/importer/convert.test.js`

- [ ] **Step 3: Implement**

```js
import { generateJSON } from '@tiptap/core'
import { buildExtensions, extractPlainText } from '../tiptap'

const BANNED_TAGS = new Set(['SCRIPT', 'IFRAME', 'FORM', 'OBJECT', 'EMBED', 'STYLE', 'LINK', 'META'])

export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html')
  doc.querySelectorAll([...BANNED_TAGS].join(',')).forEach((el) => el.remove())
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      const val = (attr.value || '').trim().toLowerCase()
      if (name.startsWith('on')) el.removeAttribute(attr.name)
      if ((name === 'href' || name === 'src') &&
          (val.startsWith('javascript:') || val.startsWith('data:text'))) {
        el.removeAttribute(attr.name)
      }
    }
  })
  mapCheckboxLists(doc)
  return doc.body.innerHTML
}

export function mapCheckboxLists(doc) {
  doc.querySelectorAll('li').forEach((li) => {
    const box = li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]')
    if (!box && !li.classList.contains('task-list-item')) return
    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', box?.checked || box?.hasAttribute('checked') ? 'true' : 'false')
    box?.remove()
    li.closest('ul')?.setAttribute('data-type', 'taskList')
  })
}

let _ext
export function htmlToNote(html) {
  _ext = _ext || buildExtensions()
  const bodyJson = generateJSON(sanitizeHtml(html), _ext)
  return { bodyJson, bodyPlain: extractPlainText(bodyJson) }
}
```

(Note `sanitizeHtml` calls `mapCheckboxLists` on the same parsed doc — one parse, both transforms.)

- [ ] **Step 4: PASS** — run the file.
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/convert.js app/src/pages/journal-2-0/lib/importer/convert.test.js
git commit -m "feat(notebook-import): shared HTML->TipTap converter with sanitizer + checkbox mapping"
```

---

### Task 8: Intake — dropped files/folders/zips → VFile[]

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/intake.js`
- Test: `app/src/pages/journal-2-0/lib/importer/intake.test.js`
- Modify: `app/package.json` (add `fflate@^0.8.2`; `cd app && npm install`)

**Interfaces:**
- Produces:
  - `VFile = { path: string, size: number, lastModified: number|null, bytes: () => Promise<Uint8Array> }` (paths use `/` separators, no leading `/`)
  - `expandArchives(vfiles, {limits}) -> Promise<{files: VFile[], warnings: string[]}>` — expands `.zip` entries (fflate `unzipSync` on the zip's bytes; nested zips expanded recursively, one level of nesting minimum for Notion), enforces `limits = { maxTotalBytes: 2_147_483_648, maxEntries: 20_000, maxArchiveBytes: 4_294_967_295 }` — a violated cap throws `ImportLimitError` with a user-readable message.
  - `collectDropped(dataTransfer) -> Promise<VFile[]>` — walks `webkitGetAsEntry()` directories (**`readEntries` looped until it returns an empty array** — Chromium pages 100 per call; **all `dataTransfer.items` snapshotted synchronously before any `await`** — the list is neutered after the first microtask), falls back to plain `dataTransfer.files`.
  - `fromFileList(fileList) -> VFile[]` — for the `<input webkitdirectory>` fallback (uses `webkitRelativePath` when present).
- Consumes: nothing internal.

- [ ] **Step 1: Write the failing tests** (zip fixtures built in-test with fflate's `zipSync` — no binary fixtures committed)

```js
import { describe, it, expect } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { expandArchives, fromFileList, ImportLimitError } from './intake'

const vf = (path, u8) => ({ path, size: u8.length, lastModified: null, bytes: async () => u8 })

describe('expandArchives', () => {
  it('expands a zip into member VFiles with folder paths', async () => {
    const zip = zipSync({ 'Vault/Note.md': strToU8('# hi'), 'Vault/img/a.png': new Uint8Array([1]) })
    const { files } = await expandArchives([vf('export.zip', zip)])
    const paths = files.map((f) => f.path).sort()
    expect(paths).toEqual(['Vault/Note.md', 'Vault/img/a.png'])
    expect(new TextDecoder().decode(await files[0].bytes())).toBe('# hi')
  })

  it('expands a zip nested inside a zip (Notion workspace exports do this)', async () => {
    const inner = zipSync({ 'Page.md': strToU8('inner') })
    const outer = zipSync({ 'part-1.zip': inner })
    const { files } = await expandArchives([vf('export.zip', outer)])
    expect(files.map((f) => f.path)).toEqual(['part-1.zip/Page.md'])
  })

  it('throws ImportLimitError past the entry cap', async () => {
    const many = {}
    for (let i = 0; i < 30; i++) many[`f${i}.txt`] = strToU8('x')
    const zip = zipSync(many)
    await expect(expandArchives([vf('big.zip', zip)], { limits: { maxEntries: 10, maxTotalBytes: 1e9, maxArchiveBytes: 1e9 } }))
      .rejects.toBeInstanceOf(ImportLimitError)
  })
})

describe('fromFileList', () => {
  it('uses webkitRelativePath for folder-picker files', () => {
    const f = new File(['x'], 'a.md')
    Object.defineProperty(f, 'webkitRelativePath', { value: 'Vault/sub/a.md' })
    expect(fromFileList([f])[0].path).toBe('Vault/sub/a.md')
  })
})
```

- [ ] **Step 2: FAIL** — run `cd app && npx vitest run src/pages/journal-2-0/lib/importer/intake.test.js`.
- [ ] **Step 3: Implement.** `expandArchives`: iterate input; non-zip pass through; `.zip` (by extension OR magic bytes `PK\x03\x04`) → `unzipSync(await f.bytes())`, each member → VFile at `path` `${memberName}` (top-level zip: member names as-is; nested zip: prefix `${zipEntryName}/`), skip directory entries (`name.endsWith('/')`) and macOS junk (`__MACOSX/`, `.DS_Store`); count entries + accumulated bytes vs limits; recurse on members ending `.zip`. `collectDropped`: snapshot `[...dataTransfer.items].map((i) => i.webkitGetAsEntry?.())` synchronously first; walk with a queue; file entries → `entry.file()` promisified; directory entries → `createReader()` + `readEntries` loop; `File` → VFile via `{ path, size: file.size, lastModified: file.lastModified, bytes: async () => new Uint8Array(await file.arrayBuffer()) }`. `ImportLimitError extends Error` exported.
- [ ] **Step 4: PASS** — run the file.
- [ ] **Step 5: Commit**

```bash
git add app/package.json app/package-lock.json app/src/pages/journal-2-0/lib/importer/intake.js app/src/pages/journal-2-0/lib/importer/intake.test.js
git commit -m "feat(notebook-import): intake - folder walk + streaming-safe zip expansion with caps"
```

---

### Task 9: Detection registry + generic adapter (md/txt/html/docx/TextBundle)

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/registry.js`, `app/src/pages/journal-2-0/lib/importer/adapters/generic.js`
- Create fixtures: `app/src/pages/journal-2-0/lib/importer/__fixtures__/generic/` (`readme.md` with a table + checklist + `#` heading; `journal/entry.txt`; `page.html`)
- Test: `app/src/pages/journal-2-0/lib/importer/generic.test.js`, `app/src/pages/journal-2-0/lib/importer/registry.test.js`
- Modify: `app/package.json` (add `markdown-it@^14`, `markdown-it-task-lists@^2`, `mammoth@^1.11`)

**Interfaces:**
- Produces:
  - Adapter contract: `{ id: string, label: string, detect(vfiles) -> number /* 0..1 confidence */, parse(vfiles, {onProgress}) -> Promise<{ docs: IntermediateDoc[], warnings: string[] }> }`
  - `IntermediateDoc` as defined in File Structure. `importKey` = `${adapter.id}:${path}`. `folderPath` = the file's directory segments. `media` refs use placeholder markers: the doc's `html` references media as `<img src="import-ref://<ref>">` / attachments as `<a data-type="attachmentChip" data-import-ref="<ref>">`; `ref` is the vfile path.
  - `registry.detect(vfiles) -> { adapter, confidence }` — max score wins; generic is the floor (always ≥0.1 when any supported extension is present).
  - `mdToHtml(text) -> string` — markdown-it (`html: true, linkify: true`) + task-lists plugin; exported for reuse by the Obsidian/Notion adapters.
- Generic behaviors: `.md` → mdToHtml; `.txt` → escaped paragraphs; `.html` → body as-is (sanitizer downstream); `.docx` → `mammoth.convertToHtml({arrayBuffer})` (dynamic `import('mammoth')`), its base64 `<img src="data:...">` outputs converted to media entries (decode dataURI → bytes → synthetic VFile `docx-img-N`, src swapped to `import-ref://`); TextBundle dirs (`X.textbundle/text.md` + `assets/`) → one doc named after the bundle, asset refs resolved; relative `<img>`/`![]()` targets resolved against the file's directory to zip-member vfiles; title = first `<h1>` text if present else filename sans extension; dates from `lastModified` (both created/updated — best available); **Apple Notes bulk-export bug**: if >1 docs reference `FallbackImage.png`, drop those image refs and push a warning naming the affected notes.

- [ ] **Step 1: Write the failing tests**

```js
// generic.test.js
import { describe, it, expect } from 'vitest'
import { genericAdapter } from './adapters/generic'

const vf = (path, text) => ({
  path, size: text.length, lastModified: 1710000000000,
  bytes: async () => new TextEncoder().encode(text),
})

describe('generic adapter', () => {
  it('converts a markdown tree into docs with folderPath + importKey', async () => {
    const { docs } = await genericAdapter.parse([
      vf('Vault/Trading/vcp.md', '# VCP\n\n- [x] done\n- [ ] todo\n\n|a|b|\n|-|-|\n|1|2|'),
      vf('Vault/notes.txt', 'line one\n\nline two'),
    ])
    const vcp = docs.find((d) => d.importKey === 'file:Vault/Trading/vcp.md')
    expect(vcp.title).toBe('VCP')
    expect(vcp.folderPath).toEqual(['Vault', 'Trading'])
    // mdToHtml emits GFM checkbox <input>s; the DOWNSTREAM converter maps them
    // to taskItems (next test). Here just assert the checkbox survived markdown:
    expect(vcp.html).toContain('type="checkbox"')
    expect(vcp.html).toContain('<table>')
  })

  it('markdown checklists reach convert.htmlToNote as real taskItems (integration)', async () => {
    const { docs } = await genericAdapter.parse([vf('a.md', '- [x] done\n- [ ] todo')])
    const { htmlToNote } = await import('./convert')
    const { bodyJson } = htmlToNote(docs[0].html)
    expect(bodyJson.content[0].type).toBe('taskList')
    expect(bodyJson.content[0].content[0].attrs.checked).toBe(true)
  })

  it('resolves relative image refs to media placeholders', async () => {
    const png = { path: 'Vault/img/a.png', size: 1, lastModified: null, bytes: async () => new Uint8Array([1]) }
    const { docs } = await genericAdapter.parse([vf('Vault/note.md', '![alt](img/a.png)'), png])
    const doc = docs.find((d) => d.importKey === 'file:Vault/note.md')
    expect(doc.html).toContain('import-ref://Vault/img/a.png')
    expect(doc.media[0]).toMatchObject({ ref: 'Vault/img/a.png', kind: 'image' })
  })

  it('flags the Apple Notes FallbackImage.png bulk-export bug', async () => {
    const { docs, warnings } = await genericAdapter.parse([
      vf('n1.md', '![](FallbackImage.png)'), vf('n2.md', '![](FallbackImage.png)'),
      { path: 'FallbackImage.png', size: 1, lastModified: null, bytes: async () => new Uint8Array([1]) },
    ])
    expect(warnings.join(' ')).toMatch(/FallbackImage/)
    expect(docs.every((d) => d.media.length === 0)).toBe(true)
  })
})
```

```js
// registry.test.js
import { describe, it, expect } from 'vitest'
import { detectAdapter } from './registry'

const vf = (path) => ({ path, size: 1, lastModified: null, bytes: async () => new Uint8Array() })

describe('detectAdapter', () => {
  it('routes an Obsidian vault (has .obsidian/) to obsidian', () => {
    expect(detectAdapter([vf('.obsidian/app.json'), vf('note.md')]).adapter.id).toBe('obsidian')
  })
  it('routes hex-suffixed files to notion', () => {
    expect(detectAdapter([vf('Page abc123def456789012345678abcdef01.md')]).adapter.id).toBe('notion')
  })
  it('routes .enex to evernote', () => {
    expect(detectAdapter([vf('My Notebook.enex')]).adapter.id).toBe('evernote')
  })
  it('falls back to generic for loose markdown', () => {
    expect(detectAdapter([vf('a.md'), vf('b/c.txt')]).adapter.id).toBe('file')
  })
})
```

(Registry imports all four adapters; until Tasks 10–12 land, create `notion.js`/`obsidian.js`/`evernote.js` as **detection-only stubs** — real `detect`, `parse` that throws `new Error('not implemented')` — so the registry test is complete now and the parse tests arrive with their tasks.)

- [ ] **Step 2: FAIL** — run both files.
- [ ] **Step 3: Implement** `generic.js` + `registry.js` + the three detection-only stubs. Detection scores: obsidian 0.95 on `.obsidian/` dir, 0.6 when ≥1 md file contains `[[`; notion 0.9 when ≥30% of filenames match `/ [0-9a-f]{32}\.(md|html|csv)$/`, 0.7 when an `index.html` sits beside hex-suffixed dirs; evernote 1.0 on any `.enex`; generic 0.1 floor when any `.md/.txt/.html/.docx/.textbundle` present. `detectAdapter` returns highest; ties broken by registry order (evernote, notion, obsidian, generic).
- [ ] **Step 4: PASS** — run both files.
- [ ] **Step 5: Commit**

```bash
git add app/package.json app/package-lock.json app/src/pages/journal-2-0/lib/importer/registry.js app/src/pages/journal-2-0/lib/importer/adapters/ app/src/pages/journal-2-0/lib/importer/generic.test.js app/src/pages/journal-2-0/lib/importer/registry.test.js
git commit -m "feat(notebook-import): adapter registry + generic md/txt/html/docx/TextBundle adapter"
```

---

### Task 10: Notion adapter

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/adapters/notion.js` (replace stub's parse)
- Fixtures: `__fixtures__/notion/` — a small tree mimicking a real export: `My Page abc123def456789012345678abcdef01.md` (contains an `<aside>` callout, a `<details>` toggle, a relative link to the sub-page, an image ref), `My Page abc123def456789012345678abcdef01/Sub Page def456789012345678abcdef01abc123.md`, `My Page abc123def456789012345678abcdef01/img.png`, `Tasks fedcba98765432100123456789abcdef.csv`
- Test: `app/src/pages/journal-2-0/lib/importer/notion.test.js`

**Interfaces:**
- Consumes: `mdToHtml` (Task 9), VFiles.
- Produces docs where: hex-id suffixes stripped from titles AND folderPath segments; `importKey` = `notion:<path-with-ids-stripped>` (ids stripped so a re-export with fresh zip layout still matches); sub-page directories become folders named after the parent page; internal relative links (`.md`/`.html` targets) become `links: [{placeholder, targetKey}]` entries with `<a data-import-link="<targetKey>">` in the html; CSV files with ≤50 data rows → a doc whose html is a `<table>` (first row = `<th>`), >50 rows → skipped with a warning naming the file; HTML-export files (`.html`) preferred over `.md` twins when both exist for the same page id.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest'
import { notionAdapter } from './adapters/notion'

const vf = (path, text) => ({ path, size: text.length, lastModified: null,
                              bytes: async () => new TextEncoder().encode(text) })
const HEX = 'abc123def456789012345678abcdef01'
const HEX2 = 'def456789012345678abcdef01abc123'

describe('notion adapter', () => {
  it('strips hex ids from titles, folders, and importKeys', async () => {
    const { docs } = await notionAdapter.parse([
      vf(`My Page ${HEX}.md`, '# My Page\nbody'),
      vf(`My Page ${HEX}/Sub ${HEX2}.md`, 'child'),
    ])
    const sub = docs.find((d) => d.title === 'Sub')
    expect(sub.folderPath).toEqual(['My Page'])
    expect(sub.importKey).toBe('notion:My Page/Sub.md')
  })

  it('keeps callout/toggle HTML islands for the converter', async () => {
    const { docs } = await notionAdapter.parse([
      vf(`P ${HEX}.md`, '<aside>💡 tip</aside>\n\n<details><summary>t</summary>hidden</details>')])
    expect(docs[0].html).toContain('tip')
    expect(docs[0].html).toContain('hidden')
  })

  it('rewrites internal relative links to link placeholders', async () => {
    const { docs } = await notionAdapter.parse([
      vf(`A ${HEX}.md`, `[go](Sub%20${HEX2}.md)`),
      vf(`Sub ${HEX2}.md`, 'target'),
    ])
    const a = docs.find((d) => d.title === 'A')
    expect(a.html).toContain(`data-import-link="notion:Sub.md"`)
    expect(a.links[0].targetKey).toBe('notion:Sub.md')
  })

  it('turns a small CSV database into a table note and warns on big ones', async () => {
    const small = 'Name,Status\nAlpha,Done\nBeta,Open'
    const bigRows = ['Name'].concat(Array.from({ length: 60 }, (_, i) => `r${i}`)).join('\n')
    const { docs, warnings } = await notionAdapter.parse([
      vf(`Tasks ${HEX}.csv`, small), vf(`Big ${HEX2}.csv`, bigRows)])
    const table = docs.find((d) => d.title === 'Tasks')
    expect(table.html).toMatch(/<table>.*<th>Name<\/th>.*Alpha/s)
    expect(warnings.join(' ')).toMatch(/Big/)
  })
})
```

- [ ] **Step 2: FAIL** — stub throws.
- [ ] **Step 3: Implement.** Core helpers: `stripId = (s) => s.replace(/ [0-9a-f]{32}(?=(\.[a-z]+)?$)/i, '')` applied per path segment; URL-decode link hrefs before resolving (`decodeURIComponent`); resolve relative link targets against the source file's dir, then strip ids to build `targetKey`; images resolved like generic (relative path → media ref). Markdown lane through `mdToHtml` (html passthrough keeps the islands — the sanitizer downstream unwraps `<aside>` to its text inside a blockquote is NOT required: generateJSON with StarterKit maps `<details>`/`<aside>` to paragraphs/text; acceptable v1 degradation, content is preserved). CSV: parse with a 20-line hand parser (split lines, split on commas respecting simple quotes); emit `<table>`.
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/adapters/notion.js app/src/pages/journal-2-0/lib/importer/notion.test.js
git commit -m "feat(notebook-import): Notion adapter - id stripping, link resolution, CSV tables"
```

---

### Task 11: Obsidian adapter

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/adapters/obsidian.js` (replace stub's parse)
- Test: `app/src/pages/journal-2-0/lib/importer/obsidian.test.js`

**Interfaces:**
- Consumes: `mdToHtml` (Task 9).
- Produces: docs from every `.md` in the vault (skip `.obsidian/`, `.trash/`); frontmatter block (`--- ... ---` at byte 0) parsed for `tags` (list or comma string) and `created`/`date` keys, stripped from the body; wiki-syntax pre-processed BEFORE markdown-it via regex passes: `![[target]]` → `<img src="import-ref://<resolved path>">` (resolved by basename search across the vault when not path-qualified; non-image embed targets become attachment chips), `[[Target|alias]]` / `[[Target]]` → `<a data-import-link="obsidian:<resolved>.md">alias-or-target</a>` (unresolvable → plain text, no link entry); callout blocks `> [!note] Title` → blockquote with `<strong>Title</strong>` first line; `==highlight==` → `<mark>` (markdown-it-mark? no — one more regex: `==x==` → `<mark>x</mark>`, applied outside code fences).
- `importKey` = `obsidian:<vault-relative path>`.

- [ ] **Step 1: Write the failing tests**

```js
import { describe, it, expect } from 'vitest'
import { obsidianAdapter } from './adapters/obsidian'

const vf = (path, text) => ({ path, size: text.length, lastModified: null,
                              bytes: async () => new TextEncoder().encode(text) })

describe('obsidian adapter', () => {
  it('parses frontmatter tags + created and strips the block', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('Vault/n.md', '---\ntags: [swing, vcp]\ncreated: 2024-01-05\n---\n# N\nbody')])
    expect(docs[0].tags).toEqual(['swing', 'vcp'])
    expect(docs[0].createdAt).toBe('2024-01-05')
    expect(docs[0].html).not.toContain('tags:')
  })

  it('resolves wiki-links by basename and leaves unresolvable ones as text', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('Vault/a.md', 'see [[Setups/VCP|the setup]] and [[Ghost Note]]'),
      vf('Vault/Setups/VCP.md', 'x')])
    const a = docs.find((d) => d.importKey === 'obsidian:Vault/a.md')
    expect(a.html).toContain('data-import-link="obsidian:Vault/Setups/VCP.md"')
    expect(a.html).toContain('the setup')
    expect(a.html).not.toContain('data-import-link="obsidian:Ghost')
    expect(a.html).toContain('Ghost Note')
  })

  it('turns image embeds into media refs and callouts into blockquotes', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('V/n.md', '![[chart.png]]\n\n> [!warning] Risk\n> tight stop'),
      vf('V/files/chart.png', '')])
    const d = docs[0]
    expect(d.media[0].ref).toBe('V/files/chart.png')
    expect(d.html).toContain('import-ref://V/files/chart.png')
    expect(d.html).toMatch(/<blockquote>.*Risk.*tight stop/s)
  })

  it('skips the .obsidian config dir', async () => {
    const { docs } = await obsidianAdapter.parse([
      vf('.obsidian/workspace.json', '{}'), vf('n.md', 'x')])
    expect(docs).toHaveLength(1)
  })
})
```

- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement.** Order of regex passes on the raw markdown (outside fenced code — split on ``` fences, transform only non-code segments): 1) frontmatter extract; 2) `!\[\[([^\]]+)\]\]` embeds; 3) `\[\[([^\]|]+)(?:\|([^\]]+))?\]\]` links; 4) callout marker line rewrite; 5) `==([^=\n]+)==` → mark. Then `mdToHtml`. Basename resolution map built once: `Map<lowercased basename sans ext, full path>` over all vault files (first wins; ambiguity acceptable v1).
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/adapters/obsidian.js app/src/pages/journal-2-0/lib/importer/obsidian.test.js
git commit -m "feat(notebook-import): Obsidian adapter - frontmatter, wiki-links, embeds, callouts"
```

---

### Task 12: Evernote (.enex) adapter

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/adapters/evernote.js` (replace stub's parse)
- Test: `app/src/pages/journal-2-0/lib/importer/evernote.test.js`
- Modify: `app/package.json` (add `spark-md5@^3.0.2` — WebCrypto has no MD5, and `<en-media hash>` is the MD5 of the decoded resource body)

**Interfaces:**
- Consumes: VFiles (each `.enex` file), `spark-md5`.
- Produces: one doc per `<note>`; **folderPath = [enex filename sans extension]** (the notebook name lives ONLY in the filename); title from `<title>`; dates from `<created>`/`<updated>` (format `YYYYMMDDTHHMMSSZ` → ISO `YYYY-MM-DDTHH:MM:SSZ`; `<updated>` may be absent → fall back to created); tags from `<tag>` elements; ENML `<content>` CDATA parsed with a second DOMParser — `<en-note>` inner HTML with: `<en-todo checked="true|false"/>` lines mapped to `li[data-type=taskItem]` items (consecutive en-todo-bearing `<div>`s grouped into one `ul[data-type=taskList]`), `<en-media type hash>` → image media (`import-ref://<hash>`) or attachment chip by MIME, `<en-crypt>` → `<p>[encrypted content — cannot be imported]</p>`, `evernote:///` hrefs unwrapped to text; `<resource>` elements base64-decoded to bytes (synthetic VFile named by hash), matched by `SparkMD5.ArrayBuffer.hash(bytes)`; unreferenced resources appended as attachment chips at the note end; resource `file-name` missing → `attachment.<ext-from-mime>`.
- `importKey` = `evernote:<notebook filename>/<title>/<created>` (stable across re-exports of the same notebook).

- [ ] **Step 1: Write the failing test** (fixture enex built inline as a template string with one note: title, created, two tags, ENML body containing a checked en-todo line, an en-media image whose base64 resource is a 1×1 PNG, and an en-crypt block)

```js
import { describe, it, expect } from 'vitest'
import SparkMD5 from 'spark-md5'
import { evernoteAdapter } from './adapters/evernote'

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const pngBytes = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0))
const pngMd5 = SparkMD5.ArrayBuffer.hash(pngBytes.buffer)

const enex = `<?xml version="1.0" encoding="UTF-8"?>
<en-export export-date="20260810T120000Z" application="Evernote">
 <note><title>Trade recap</title>
  <content><![CDATA[<?xml version="1.0"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
   <en-note><div><en-todo checked="true"/>review AAPL</div><div><en-todo/>size DDOG</div>
   <div><en-media type="image/png" hash="${pngMd5}"/></div>
   <div><en-crypt cipher="AES">Zm9v</en-crypt></div></en-note>]]></content>
  <created>20240105T093000Z</created><tag>swing</tag><tag>recap</tag>
  <resource><data encoding="base64">${PNG_B64}</data><mime>image/png</mime>
   <resource-attributes><file-name>chart.png</file-name></resource-attributes></resource>
 </note></en-export>`

const vf = { path: 'Trading Notebook.enex', size: enex.length, lastModified: null,
             bytes: async () => new TextEncoder().encode(enex) }

describe('evernote adapter', () => {
  it('maps notebook filename to folder, dates, tags, todos, media, crypt', async () => {
    const { docs } = await evernoteAdapter.parse([vf])
    const d = docs[0]
    expect(d.folderPath).toEqual(['Trading Notebook'])
    expect(d.title).toBe('Trade recap')
    expect(d.createdAt).toBe('2024-01-05T09:30:00Z')
    expect(d.tags).toEqual(['swing', 'recap'])
    expect(d.html).toContain('data-type="taskList"')
    expect(d.html).toContain('data-checked="true"')
    expect(d.html).toContain(`import-ref://${pngMd5}`)
    expect(d.media[0]).toMatchObject({ kind: 'image', name: 'chart.png' })
    expect(d.html).toContain('encrypted content')
    expect(d.importKey).toBe('evernote:Trading Notebook/Trade recap/20240105T093000Z')
  })
})
```

- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement.** Parse outer XML with `new DOMParser().parseFromString(text, 'text/xml')`; per `<note>`: read fields; parse the CDATA content string with a second DOMParser (`text/html` — forgiving of ENML quirks); transform in-DOM (en-todo grouping, en-media swap to `<img>`/chip with `import-ref://<hash>`, en-crypt replace); serialize `en-note` innerHTML. `enDate = (s) => s.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')`. Decode base64 per-resource straight to Uint8Array (never keep the binary string).
- [ ] **Step 4: PASS.**
- [ ] **Step 5: Commit**

```bash
git add app/package.json app/package-lock.json app/src/pages/journal-2-0/lib/importer/adapters/evernote.js app/src/pages/journal-2-0/lib/importer/evernote.test.js
git commit -m "feat(notebook-import): Evernote adapter - ENML, en-todo, MD5 resource matching"
```

---

### Task 13: Commit pipeline — check, confirm batches, media upload, body rewrite

**Files:**
- Create: `app/src/pages/journal-2-0/lib/importer/commit.js`
- Test: `app/src/pages/journal-2-0/lib/importer/commit.test.js`

**Interfaces:**
- Consumes: converted docs `{...IntermediateDoc, bodyJson, bodyPlain}` (wizard runs `htmlToNote` per doc before calling this), Task 3/4 endpoints.
- Produces:
  - `checkExisting(docs) -> Promise<{existing}>` — POST `/api/j2/notes/import/check` with `{importKeys}`.
  - `rewriteBody(bodyJson, {mediaUrls, idByKey}) -> bodyJson'` — pure: deep-walks the doc; `image.attrs.src === 'import-ref://<ref>'` → `mediaUrls[ref]` (missing → node dropped, name recorded); `attachmentChip.attrs['data-import-ref']`-style placeholder (stored as `href: 'import-ref://<ref>'`) → real URL; link marks with `href === 'import-link://<targetKey>'` → `/journal?j2tab=notebook&note=${idByKey[targetKey]}` (unresolved → mark removed, text kept). **Adapters emit `data-import-link="<key>"`; convert.js's sanitizer rewrites that attribute to `href="import-link://<key>"` before generateJSON so it survives as a link mark — add that rewrite + a test to convert.js in this task.**
  - `runImport({source, destFolderId, docs, onProgress}) -> Promise<summary>` — sequence: confirm in batches of ≤200 (stop on batch failure, report which batch); build `idByKey` from responses; per note with media/links: upload each media vfile (images → `POST /api/j2/notes/{id}/images`, files → `/attachments`, FormData field `file`; 2 retries on 5xx), `rewriteBody`, `PUT /api/j2/notes/{id}` with `{bodyJson}`; collect `{created, updated, skipped, failures: [{name, reason}]}`; `onProgress({phase, done, total})` fired per note.

- [ ] **Step 1: Write the failing tests** (mock `global.fetch` with `vi.stubGlobal`; assert exact call sequence + bodies)

```js
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { rewriteBody, runImport } from './commit'

const img = (src) => ({ type: 'image', attrs: { src } })
const doc = (content) => ({ type: 'doc', content })

describe('rewriteBody', () => {
  it('swaps media refs, resolves links, drops failed media by name', () => {
    const body = doc([
      img('import-ref://v/a.png'),
      { type: 'paragraph', content: [{ type: 'text', text: 'go',
        marks: [{ type: 'link', attrs: { href: 'import-link://obsidian:v/b.md' } }] }] },
      img('import-ref://v/missing.png'),
    ])
    const { body: out, droppedMedia } = rewriteBody(body, {
      mediaUrls: { 'v/a.png': '/api/j2/notes/attachments/u/n/inline/x.png' },
      idByKey: { 'obsidian:v/b.md': 'note42' },
    })
    expect(out.content[0].attrs.src).toBe('/api/j2/notes/attachments/u/n/inline/x.png')
    expect(out.content[1].content[0].marks[0].attrs.href)
      .toBe('/journal?j2tab=notebook&note=note42')
    expect(out.content.filter((n) => n.type === 'image')).toHaveLength(1)
    expect(droppedMedia).toEqual(['v/missing.png'])
  })

  it('removes link marks whose target did not import, keeping the text', () => {
    const body = doc([{ type: 'paragraph', content: [{ type: 'text', text: 'ghost',
      marks: [{ type: 'link', attrs: { href: 'import-link://obsidian:gone.md' } }] }] }])
    const { body: out } = rewriteBody(body, { mediaUrls: {}, idByKey: {} })
    expect(out.content[0].content[0].marks ?? []).toHaveLength(0)
    expect(out.content[0].content[0].text).toBe('ghost')
  })
})

describe('runImport', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('confirms, uploads media, rewrites bodies, and reports the summary', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      calls.push({ url, method: opts?.method })
      if (url.endsWith('/import/confirm')) {
        return new Response(JSON.stringify({
          created: [{ importKey: 'file:a.md', id: 'n1' }], updated: [], skipped: [] }))
      }
      if (url.includes('/images')) return new Response(JSON.stringify({ url: '/img/1.png' }))
      return new Response(JSON.stringify({ ok: true }))
    }))
    const summary = await runImport({
      source: 'file', destFolderId: null,
      docs: [{ importKey: 'file:a.md', title: 'A', tags: [], folderPath: [],
               bodyJson: doc([img('import-ref://a.png')]), bodyPlain: 'x',
               media: [{ ref: 'a.png', kind: 'image', name: 'a.png',
                         vfile: { bytes: async () => new Uint8Array([1]), path: 'a.png' } }],
               links: [] }],
      onProgress: () => {},
    })
    expect(calls.map((c) => c.url)).toEqual([
      '/api/j2/notes/import/confirm', '/api/j2/notes/n1/images', '/api/j2/notes/n1',
    ])
    expect(summary.created).toBe(1)
    expect(summary.failures).toEqual([])
  })
})
```

- [ ] **Step 2: FAIL.**
- [ ] **Step 3: Implement** `commit.js` (+ the `data-import-link → href="import-link://"` rewrite inside `convert.js`'s sanitizer, with a convert.test.js case). All fetches `credentials: 'include'`. Confirm payload notes carry `importKey,title,subtitle,bodyJson,tags,ticker,createdAt,updatedAt,folderPath` (ISO dates from `lastModified` epoch via `new Date(ms).toISOString()`).
- [ ] **Step 4: PASS** — run commit.test.js + convert.test.js.
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/lib/importer/commit.js app/src/pages/journal-2-0/lib/importer/commit.test.js app/src/pages/journal-2-0/lib/importer/convert.js app/src/pages/journal-2-0/lib/importer/convert.test.js
git commit -m "feat(notebook-import): commit pipeline - batched confirm, media upload, body rewrite"
```

---

### Task 14: Import wizard UI

**Files:**
- Create: `app/src/pages/journal-2-0/components/notebook/import/ImportWizard.jsx` + `ImportWizard.module.css`
- Test: `app/src/pages/journal-2-0/components/notebook/import/ImportWizard.test.jsx`

**Interfaces:**
- Props: `{ open, onClose, onImported }` (`onImported` → NotebookTab refreshes notes + folders).
- Renders inside `Sheet` (`variant="fullscreen"` on touch, `modal` desktop — reuse `components/mobile/Sheet` exactly as NotebookTab already does for TemplatePicker).
- Steps: `drop` (dropzone + hidden `<input type="file" multiple webkitdirectory>` + a second plain multiple input; "How do I export from…" accordion with per-app copy incl. "Notion: choose **HTML** export", "OneNote: export sections as Word .docx", "Apple Notes: use the free Exporter app for bulk") → `scanning` → `preview` (source label, note/folder/media counts, `will create N / update M / unchanged K` from `checkExisting`, destination `<select>` of root folders + "Imported from {source}" default option, per-top-level-folder exclude checkboxes, warnings list) → `running` (progress bar from `onProgress`) → `summary` (created/updated/skipped counts + failures by name).
- All importer modules loaded via `await import('../../../lib/importer/...')` INSIDE the handlers (keeps the chunk lazy).
- Buttons/icons: `UIcon` only. Error boundary: wrap wizard content in the file's own small `class ErrorBoundary extends React.Component` rendering the error + a close button — a conversion crash must not take down the Notebook tab.

- [ ] **Step 1: Write the failing wire test** (this is the test that reds when the wire is cut)

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ImportWizard from './ImportWizard'

// jsdom lacks DataTransfer; drive the wizard through its file-input path.
const mdFile = new File(['# Hello\n\n- [x] done'], 'hello.md', { type: 'text/markdown' })

describe('ImportWizard wire', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url.endsWith('/import/check')) return new Response(JSON.stringify({ existing: {} }))
      if (url.endsWith('/import/confirm')) return new Response(JSON.stringify({
        created: [{ importKey: 'file:hello.md', id: 'n1' }], updated: [], skipped: [] }))
      if (url.endsWith('/note-folders')) return new Response(JSON.stringify({ folders: [] }))
      return new Response(JSON.stringify({ ok: true }))
    }))
  })

  it('drop -> preview shows counts -> confirm actually POSTs /import/confirm', async () => {
    render(<ImportWizard open onClose={() => {}} onImported={() => {}} />)
    const input = screen.getByTestId('import-file-input')
    fireEvent.change(input, { target: { files: [mdFile] } })
    // preview: found 1 note, will create 1
    await waitFor(() => expect(screen.getByText(/1 note/i)).toBeInTheDocument())
    expect(screen.getByText(/create 1/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    await waitFor(() => {
      const urls = vi.mocked(fetch).mock.calls.map((c) => c[0])
      expect(urls).toContain('/api/j2/notes/import/confirm')
    })
    await waitFor(() => expect(screen.getByText(/imported/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: FAIL** — component missing.
- [ ] **Step 3: Implement.** State machine via `useState('drop')`; `handleFiles(fileList)` → dynamic-import intake/registry/convert → `fromFileList` → `expandArchives` → `detectAdapter` → `adapter.parse` → `htmlToNote` per doc (yield to the event loop every 10 docs: `await new Promise(r => setTimeout(r))` so the tab stays responsive) → `checkExisting` → `preview`. Confirm button → dynamic-import commit → `runImport` with excluded top-level folders filtered out → `summary`, then `onImported()`. Dest folder: on preview, offer `Imported from {label}` (creates via existing folders POST before confirm) or any existing root folder. CSS: follow NotebookTab.module.css tokens; dropzone = dashed 2px border panel, `@media (max-width: 640px)` single-column.
- [ ] **Step 4: PASS** — run the file.
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/components/notebook/import/
git commit -m "feat(notebook-import): import wizard - drop, auto-detect, preview, progress, summary"
```

---

### Task 15: NotebookTab wiring — Import button + onboarding empty state

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` + `NotebookTab.module.css`
- Test: `app/src/pages/journal-2-0/tabs/NotebookTab.test.jsx` (extend)

**Interfaces:**
- Consumes: `ImportWizard` (Task 14).
- Produces: an "Import" button in the tab header (beside the existing new-note/template controls — read the header JSX first and match its button idiom), opening `<ImportWizard open={importOpen} onClose={...} onImported={() => { refresh(); folder hook refresh via key remount or exposed refresh }} />`. Empty state (no notes, no active filters) gains the pitch line: `Bring your notes from Notion, Obsidian, Evernote, or anywhere else` + the same Import button.

- [ ] **Step 1: Write the failing test** (extend NotebookTab.test.jsx following its existing mock setup — it already mocks `useJ2Notes`; mock ImportWizard shallowly to observe mounting):

```jsx
vi.mock('../components/notebook/import/ImportWizard', () => ({
  default: ({ open }) => (open ? <div data-testid="import-wizard" /> : null),
}))

it('header Import button opens the wizard', async () => {
  renderNotebookTab()  // reuse the file's existing render helper
  expect(screen.queryByTestId('import-wizard')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /import/i }))
  expect(screen.getByTestId('import-wizard')).toBeInTheDocument()
})

it('empty state pitches the import path', () => {
  renderNotebookTab({ notes: [] })
  expect(screen.getByText(/Notion, Obsidian, Evernote/i)).toBeInTheDocument()
})
```

- [ ] **Step 2: FAIL.** — `cd app && npx vitest run src/pages/journal-2-0/tabs/NotebookTab.test.jsx`
- [ ] **Step 3: Implement** (button uses an existing UIcon glyph — check `UIcon.jsx`'s registry for an upload/inbox glyph; if none fits, add one to the registry following its inline-SVG pattern).
- [ ] **Step 4: PASS**, then the whole journal-2-0 suite: `cd app && npx vitest run src/pages/journal-2-0` → green.
- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/tabs/NotebookTab.jsx app/src/pages/journal-2-0/tabs/NotebookTab.module.css app/src/pages/journal-2-0/tabs/NotebookTab.test.jsx
git commit -m "feat(notebook-import): Import entry points in NotebookTab header + empty state"
```

---

### Task 16: Full verification + docs

**Files:**
- Modify: `CLAUDE.md` (Journal 2.0 section: one line adding the importer + nested folders to the Notebook bullet)
- No new code.

- [ ] **Step 1: Backend suite (targeted — the full ~9,600-test run does not finish on this box):**

```bash
python -m pytest api/services/journal_two/ tests/ -k "note or folder or journal_two" -v
```
Expected: all PASS. Investigate ANY failure — do not rationalize.

- [ ] **Step 2: Frontend suite:**

```bash
cd app && npx vitest run src/pages/journal-2-0
```
Expected: all PASS **and check the FILE count in the summary** — every new test file from Tasks 5–15 must appear (a broken import can hide a whole file behind a green run).

- [ ] **Step 3: Build check:** `cd app && npm run build` — confirm the importer lands in a separate chunk (look for a `convert-*.js`/importer chunk in `dist/assets/`, and that the main index chunk did not grow by more than a few KB).

- [ ] **Step 4: Manual gate (owner-visible proof, sandboxed local backend):** start the sandboxed dev server (per memory: `DATA_DIR`/`AUTH_DB_PATH` → scratch, `ADMIN_EMAILS` → throwaway, `WORKER_ENABLED=0` etc.), build the app, then drag in (a) a real Obsidian vault folder, (b) a Notion HTML export zip, (c) an .enex file. Open imported notes ON SCREEN: folders nested, checklists checked, tables render, images render, wiki-links navigate. Re-drop the same export → preview says "unchanged", nothing duplicates. Screenshot the result for the ship report.

- [ ] **Step 5: Docs + final commit:**

```bash
git add CLAUDE.md
git commit -m "docs: notebook importer + nested folders in Journal 2.0 section"
git push origin notebook-import
```

Do NOT push to master. Report completion to the owner with the manual-gate evidence; ship only on explicit "ship it" inside the deploy window.

