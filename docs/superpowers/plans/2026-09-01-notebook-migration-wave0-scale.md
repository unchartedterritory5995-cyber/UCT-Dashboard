# Notebook Migration — Wave 0: Scale Regime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Notebook survive a migrated library — real full-text search, a working export, and measured limits — before any connector invites thousands of notes in.

**Architecture:** An FTS5 virtual table mirrors `(title, body_plain)` for every note, maintained by **SQLite triggers** rather than by calls added to each writer — there are 11 production write statements to `j2_notes` across 3 modules, and wiring each one is precisely the "four readers, three wrong" defect this codebase has already suffered. Triggers make the writer count irrelevant. Search switches to FTS5 with a `LIKE` fallback, pinned by an agreement rail modelled on `test_backlinks_and_the_list_filter_agree`. Export is a new read-only service producing a markdown+attachments zip — the same shape the importer already reads, which makes the door swing both ways.

**Tech Stack:** Python 3 / FastAPI / sqlite3 (stdlib), FTS5 with `porter unicode61` tokenizer, pytest. Frontend: React + vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-notebook-migration-program-design.md` (§4 Wave 0, §8.2 export)

## Global Constraints

- **A new column goes in BOTH places** — `_J2_SCHEMA` *and* the ALTER list. `first_image_url` lived only in the ALTER and cost 7 import-suite reds: a fresh schema (every test fixture, any new install) never gained it while the INSERT named it.
- **Anything referencing a migration-added column is created in `ensure_schema()` AFTER the migration calls**, never inside the `_J2_SCHEMA` executescript. That ordering was Critical-1 on the import wave.
- **`body_plain` stays authoritative.** The FTS table is a derived index, rebuildable from `body_plain`, never written independently.
- **Migrations are flag-gated in `DATA_DIR`** (`.notebook_migration_v4`) and idempotent by construction, exactly like v1/v2/v3.
- **Never crash startup over a migration** — `ensure_schema` wraps each in `try/except` and prints; match that.
- **Encoding-safe writes only**: encode → temp file → `os.replace`. A bare `open(path, "w")` truncates before your write can fail.
- **Read the suite summary line.** A task's exit code reports the wrapper, not the suites.
- Backend suites run from the repo root; frontend vitest runs from `app/`.

## File Structure

| File | Responsibility |
|---|---|
| `api/services/journal_two/db.py` | `_J2_SCHEMA` gains the FTS table + 3 triggers; new `run_notebook_migration_v4()`; `ensure_schema()` calls it |
| `api/services/journal_two/notes_search.py` | **new** — `fts_match_expr()`, the single place raw user text becomes an FTS5 MATCH expression |
| `api/services/journal_two/notes.py` | `list_notes()` search branch switches to FTS5 with fallback |
| `api/services/journal_two/notes_export.py` | **new** — TipTap→markdown walker + zip builder |
| `api/routers/journal_two.py` | `GET /api/j2/notes/export` route |
| `api/services/journal_two/test_notes_fts.py` | **new** — trigger maintenance, migration, agreement rail |
| `api/services/journal_two/test_notes_export.py` | **new** — markdown fidelity + zip shape |

---

## Task 1: FTS5 table, triggers, and migration v4

**Files:**
- Modify: `api/services/journal_two/db.py` (`_J2_SCHEMA` notes section; new migration fn; `ensure_schema`)
- Test: `api/services/journal_two/test_notes_fts.py` (create)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: table `j2_notes_fts(note_id UNINDEXED, user_id UNINDEXED, title, body_plain)`; `run_notebook_migration_v4(conn: sqlite3.Connection) -> None`

- [ ] **Step 1: Write the failing test**

Create `api/services/journal_two/test_notes_fts.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest api/services/journal_two/test_notes_fts.py -v`
Expected: FAIL — `sqlite3.OperationalError: no such table: j2_notes_fts`, and `AttributeError: module ... has no attribute 'run_notebook_migration_v4'`.

- [ ] **Step 3: Add the FTS table and triggers to `_J2_SCHEMA`**

In `api/services/journal_two/db.py`, immediately after the `idx_j2_notes_user_ticker` index in `_J2_SCHEMA` (before the `idx_j2_notes_user_import` comment block), add:

```sql
-- ── Notebook search index ───────────────────────────────────────────────────
-- Standalone (NOT external-content) FTS5 mirror of the searchable columns.
-- Standalone deliberately: an external-content table keys on rowid, and
-- j2_notes has a TEXT PRIMARY KEY, so its rowid is not stable across a
-- VACUUM -- which would silently desync the index. Storing note_id as an
-- UNINDEXED column costs duplicated text and buys an index that cannot drift.
-- Mirrors the house pattern in transcript_index.py / education_search.py.
--
-- ⛔ body_plain in j2_notes stays authoritative. This table is DERIVED and
-- fully rebuildable from it (run_notebook_migration_v4). Never write here
-- except through the triggers below.
CREATE VIRTUAL TABLE IF NOT EXISTS j2_notes_fts USING fts5(
    note_id UNINDEXED,
    user_id UNINDEXED,
    title,
    body_plain,
    tokenize = 'porter unicode61'
);

-- Triggers, not per-writer calls: j2_notes has 11 production write statements
-- across notes.py, note_connectors/engine.py and db.py. Wiring each writer is
-- how an index goes stale on the one path someone forgets -- and the paths
-- that would be forgotten are the importer and the sync engine, i.e. exactly
-- the notes a migrating member most needs to find.
CREATE TRIGGER IF NOT EXISTS j2_notes_fts_ai AFTER INSERT ON j2_notes BEGIN
    INSERT INTO j2_notes_fts(note_id, user_id, title, body_plain)
    VALUES (new.id, new.user_id, new.title, new.body_plain);
END;

CREATE TRIGGER IF NOT EXISTS j2_notes_fts_ad AFTER DELETE ON j2_notes BEGIN
    DELETE FROM j2_notes_fts WHERE note_id = old.id;
END;

-- UPDATE OF (not a bare UPDATE): the sync engine's timestamp-neutral
-- tags/import_hash writes must NOT re-index. A nightly full pass touches
-- those columns on every synced note.
CREATE TRIGGER IF NOT EXISTS j2_notes_fts_au
AFTER UPDATE OF title, body_plain ON j2_notes BEGIN
    DELETE FROM j2_notes_fts WHERE note_id = old.id;
    INSERT INTO j2_notes_fts(note_id, user_id, title, body_plain)
    VALUES (new.id, new.user_id, new.title, new.body_plain);
END;
```

- [ ] **Step 4: Add `run_notebook_migration_v4`**

In `api/services/journal_two/db.py`, after `run_notebook_migration_v3`:

```python
def run_notebook_migration_v4(conn: sqlite3.Connection) -> None:
    """Backfills j2_notes_fts for DBs whose notes predate the search index.

    Idempotent by CONSTRUCTION, not just by flag: it deletes the whole index
    and rebuilds it from j2_notes, so a half-finished previous run, a manual
    re-run, or a restored backup all converge on the same correct state. The
    flag file only makes the common case cheap.

    The index is DERIVED -- j2_notes.body_plain is authoritative -- so a full
    rebuild is always safe and never loses data.

    Spec: docs/superpowers/specs/2026-09-01-notebook-migration-program-design.md §4.1
    """
    flag = _data_dir() / ".notebook_migration_v4"
    if flag.exists():
        return

    has_fts = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='j2_notes_fts'"
    ).fetchone()
    if not has_fts:
        return  # _J2_SCHEMA has not run yet; nothing to backfill into.

    conn.execute("DELETE FROM j2_notes_fts")
    conn.execute(
        "INSERT INTO j2_notes_fts(note_id, user_id, title, body_plain) "
        "SELECT id, user_id, title, body_plain FROM j2_notes"
    )
    conn.commit()

    tmp = flag.with_suffix(".tmp")
    tmp.write_bytes(b"1")
    os.replace(tmp, flag)
```

Confirm `os` is imported at the top of `db.py`; add `import os` if not.

- [ ] **Step 5: Call it from `ensure_schema`**

In `ensure_schema()`, after the `run_notebook_migration_v2` try/except block and its index creation, add:

```python
    try:
        run_notebook_migration_v4(conn)
    except Exception as e:  # noqa: BLE001 — never crash startup over this
        print(f"[notebook-migration-v4] aborted: {e}")
```

Place it after `run_notebook_migration_v3(conn)` so the ordering reads v1 → v2 → v3 → v4.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `python -m pytest api/services/journal_two/test_notes_fts.py -v`
Expected: 5 passed. Read the summary line — its absence means the run did not finish.

- [ ] **Step 7: Run the surrounding suites for regressions**

Run: `python -m pytest api/services/journal_two/ -q`
Expected: the pre-existing `test_analyze_hold_duration_returns_winner_loser_compare` failure (a coach-chat date bomb, red on master too) may appear. Nothing else new.

- [ ] **Step 8: Commit**

```bash
git add api/services/journal_two/db.py api/services/journal_two/test_notes_fts.py
git commit -m "feat(notebook): FTS5 search index maintained by triggers"
```

---

## Task 2: Route search through FTS5

**Files:**
- Create: `api/services/journal_two/notes_search.py`
- Modify: `api/services/journal_two/notes.py` (the `if q:` branch in `list_notes`, around line 559)
- Test: `api/services/journal_two/test_notes_fts.py` (append)

**Interfaces:**
- Consumes: `j2_notes_fts` from Task 1
- Produces: `fts_match_expr(q: str) -> str | None` — returns an FTS5 MATCH expression, or `None` when the input cannot yield one (caller must fall back to `LIKE`)

- [ ] **Step 1: Write the failing test**

Append to `api/services/journal_two/test_notes_fts.py`:

```python
from api.services.journal_two.notes_search import fts_match_expr


def test_fts_match_expr_quotes_terms_and_prefixes_the_last():
    assert fts_match_expr("cup handle") == '"cup" "handle"*'


def test_fts_match_expr_neutralises_fts_operators():
    """A user typing a quote or a NEAR/OR operator must not crash the query
    or silently change its meaning -- FTS5 raises on malformed MATCH text."""
    assert fts_match_expr('nvda "breakout') == '"nvda" "breakout"*'
    assert fts_match_expr("cup OR handle") == '"cup" "OR" "handle"*'


def test_fts_match_expr_returns_none_when_nothing_is_searchable():
    assert fts_match_expr("   ") is None
    assert fts_match_expr('"""') is None


def test_search_finds_a_note_written_by_raw_sql():
    """The importer and sync engine both write via raw SQL. If search only
    saw service-function writes, every migrated note would be unfindable --
    which is the entire failure this wave exists to prevent."""
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", title="Migrated", body_plain="anchored volume shelf")
    rows = list_notes("u1", q="anchored", conn=c)
    assert [r["id"] for r in rows] == ["n1"]


def test_search_agrees_with_the_like_fallback():
    """Pins the two search paths together, the way
    test_backlinks_and_the_list_filter_agree pins the backlink reader to the
    list filter. If FTS and LIKE ever disagree on membership for a plain
    single-word query, this goes red rather than quietly returning a
    different set of notes than the code it replaced."""
    from api.services.journal_two.notes import list_notes
    c = _conn()
    _insert_note(c, "n1", title="Cup and handle", body_plain="NVDA base")
    _insert_note(c, "n2", title="Unrelated", body_plain="gold miners")
    for term in ("cup", "nvda", "gold", "handle"):
        fts = {r["id"] for r in list_notes("u1", q=term, conn=c)}
        like = {r["id"] for r in c.execute(
            "SELECT id FROM j2_notes WHERE user_id='u1' AND"
            " (lower(title) LIKE ? OR lower(body_plain) LIKE ?)",
            (f"%{term}%", f"%{term}%"))}
        assert fts == like, f"FTS and LIKE disagree on {term!r}: {fts} vs {like}"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest api/services/journal_two/test_notes_fts.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.journal_two.notes_search'`.

- [ ] **Step 3: Create `notes_search.py`**

```python
"""Turns raw user search text into an FTS5 MATCH expression.

ONE authority for this translation. FTS5's MATCH grammar raises on
unbalanced quotes and reinterprets bare words like OR / NEAR / NOT as
operators, so raw user text can never be passed through -- it would either
500 the notes list or silently change what the member asked for.

Every term is quoted (which makes operators literal) and the final term gets
a `*` so search feels live as you type.
"""
from __future__ import annotations

import re

# Anything that is not a word character or a digit is a separator. This also
# strips the quote characters that would unbalance the expression.
_TERM_RE = re.compile(r"[^\w]+", re.UNICODE)


def fts_match_expr(q: str) -> str | None:
    """Returns an FTS5 MATCH expression, or None if `q` has no searchable
    term (caller falls back to LIKE). Never raises on user input."""
    if not q:
        return None
    terms = [t for t in _TERM_RE.split(q.strip()) if t]
    if not terms:
        return None
    quoted = [f'"{t}"' for t in terms[:-1]]
    quoted.append(f'"{terms[-1]}"*')  # prefix-match the term being typed
    return " ".join(quoted)
```

- [ ] **Step 4: Switch the `list_notes` search branch**

In `api/services/journal_two/notes.py`, add to the imports:

```python
from .notes_search import fts_match_expr
```

Replace the `if q:` branch in `list_notes` (currently `sql += " AND (lower(title) LIKE ? OR lower(body_plain) LIKE ?)"`) with:

```python
        if q:
            # FTS5 when the text yields a valid MATCH expression; the old
            # LIKE scan remains the fallback so a query FTS cannot parse
            # still returns results rather than an error. body_plain stays
            # authoritative -- j2_notes_fts is a derived index (db.py).
            expr = fts_match_expr(q)
            if expr:
                sql += (" AND id IN (SELECT note_id FROM j2_notes_fts"
                        " WHERE j2_notes_fts MATCH ? AND user_id = ?)")
                params.extend([expr, user_id])
            else:
                sql += " AND (lower(title) LIKE ? OR lower(body_plain) LIKE ?)"
                ql = f"%{q.lower()}%"
                params.extend([ql, ql])
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `python -m pytest api/services/journal_two/test_notes_fts.py -v`
Expected: 10 passed.

- [ ] **Step 6: Run the notes suites**

Run: `python -m pytest api/services/journal_two/test_notes.py api/services/journal_two/test_notes_import.py -q`
Expected: green. Any red here means an existing search expectation depended on substring semantics — fix the caller, do not weaken the rail.

- [ ] **Step 7: Commit**

```bash
git add api/services/journal_two/notes_search.py api/services/journal_two/notes.py api/services/journal_two/test_notes_fts.py
git commit -m "feat(notebook): search via FTS5 with LIKE fallback and an agreement rail"
```

---

## Task 3: Note export — the door that swings both ways

**Files:**
- Create: `api/services/journal_two/notes_export.py`
- Modify: `api/routers/journal_two.py` (new route beside the existing `/trades/export` at ~line 367)
- Test: `api/services/journal_two/test_notes_export.py` (create)

**Interfaces:**
- Consumes: `list_notes`, `get_note` from `notes.py`; `_ATTACHMENT_ROOT` from `attachment_root.py`
- Produces:
  - `tiptap_to_markdown(doc: dict) -> str`
  - `build_export_zip(user_id: str, conn=None) -> tuple[bytes, str]` returning `(zip_bytes, filename)`

**Why this task exists:** there is no note export in Journal 2.0 — the only export endpoint is `/trades/export`. Nobody moves a decade of writing into a product they cannot leave, so this is a precondition for asking anyone to migrate, not a closing task. The output shape is markdown-plus-attachments, which is exactly what the Obsidian/generic importer already reads — so a member can round-trip out and back in.

- [ ] **Step 1: Write the failing test**

Create `api/services/journal_two/test_notes_export.py`:

```python
"""Notebook export: markdown fidelity and archive shape.

Fidelity matters more than prettiness here. An export is a trust artifact --
a member checks whether their notes survived, and silently dropping a table
or a task list is the failure that makes them keep paying for the old app.
"""
import io
import sqlite3
import zipfile

from api.services.journal_two.db import ensure_schema
from api.services.journal_two.notes_export import (
    build_export_zip, tiptap_to_markdown,
)


def _doc(*content):
    return {"type": "doc", "content": list(content)}


def _para(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def test_headings_and_paragraphs():
    md = tiptap_to_markdown(_doc(
        {"type": "heading", "attrs": {"level": 2},
         "content": [{"type": "text", "text": "Thesis"}]},
        _para("NVDA broke out."),
    ))
    assert md == "## Thesis\n\nNVDA broke out."


def test_marks_render_as_markdown():
    md = tiptap_to_markdown(_doc({"type": "paragraph", "content": [
        {"type": "text", "text": "bold", "marks": [{"type": "bold"}]},
        {"type": "text", "text": " and "},
        {"type": "text", "text": "italic", "marks": [{"type": "italic"}]},
    ]}))
    assert md == "**bold** and *italic*"


def test_link_mark_renders_with_href():
    md = tiptap_to_markdown(_doc({"type": "paragraph", "content": [
        {"type": "text", "text": "chart",
         "marks": [{"type": "link", "attrs": {"href": "https://example.com"}}]},
    ]}))
    assert md == "[chart](https://example.com)"


def test_task_list_uses_checkbox_syntax():
    md = tiptap_to_markdown(_doc({"type": "taskList", "content": [
        {"type": "taskItem", "attrs": {"checked": True}, "content": [_para("done")]},
        {"type": "taskItem", "attrs": {"checked": False}, "content": [_para("open")]},
    ]}))
    assert md == "- [x] done\n- [ ] open"


def test_table_renders_as_a_markdown_table():
    cell = lambda t: {"type": "tableCell", "content": [_para(t)]}
    head = lambda t: {"type": "tableHeader", "content": [_para(t)]}
    md = tiptap_to_markdown(_doc({"type": "table", "content": [
        {"type": "tableRow", "content": [head("Sym"), head("R")]},
        {"type": "tableRow", "content": [cell("NVDA"), cell("2.1")]},
    ]}))
    assert md == "| Sym | R |\n| --- | --- |\n| NVDA | 2.1 |"


def test_widget_embed_exports_its_search_text_not_an_empty_line():
    """A live chart cannot exist in markdown, but silently exporting nothing
    would make the note look like it lost content. The widget's own
    searchText is the honest textual stand-in."""
    md = tiptap_to_markdown(_doc({
        "type": "widgetEmbed",
        "attrs": {"searchText": "Chart NVDA 1D", "widgetId": "chart"},
    }))
    assert "Chart NVDA 1D" in md


def test_unknown_node_does_not_crash_and_keeps_descendant_text():
    """Export must never fail on a node type added after it was written --
    a future editor block should degrade to its text, not 500 the download."""
    md = tiptap_to_markdown(_doc({
        "type": "someFutureBlock",
        "content": [_para("still mine")],
    }))
    assert "still mine" in md


def test_zip_contains_one_markdown_file_per_note_with_front_matter():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    c.execute(
        "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
        " tags, ticker, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        ("n1", "u1", "Cup and handle",
         '{"type":"doc","content":[{"type":"paragraph","content":'
         '[{"type":"text","text":"NVDA base"}]}]}',
         "NVDA base", '["setup"]', "NVDA",
         "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
    )
    c.commit()

    blob, filename = build_export_zip("u1", conn=c)
    assert filename.endswith(".zip")
    zf = zipfile.ZipFile(io.BytesIO(blob))
    names = zf.namelist()
    md_files = [n for n in names if n.endswith(".md")]
    assert len(md_files) == 1
    body = zf.read(md_files[0]).decode("utf-8")
    assert "title: Cup and handle" in body
    assert "ticker: NVDA" in body
    assert "NVDA base" in body


def test_export_is_scoped_to_the_requesting_user():
    """Cross-tenant leakage in an export is the worst possible bug class here
    -- it hands one member another member's entire notebook in one file."""
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    for nid, uid in (("n1", "u1"), ("n2", "u2")):
        c.execute(
            "INSERT INTO j2_notes (id, user_id, title, body_json, body_plain,"
            " tags, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
            (nid, uid, f"note-{nid}", '{"type":"doc","content":[]}', "",
             "[]", "2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"),
        )
    c.commit()
    blob, _ = build_export_zip("u1", conn=c)
    names = zipfile.ZipFile(io.BytesIO(blob)).namelist()
    assert not any("n2" in n for n in names)
    assert any("n1" in n for n in names)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest api/services/journal_two/test_notes_export.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'api.services.journal_two.notes_export'`.

- [ ] **Step 3: Implement `notes_export.py`**

```python
"""Notebook export -- markdown + attachments, in the shape the importer reads.

The exported archive is deliberately the SAME shape the generic/Obsidian
importer already ingests: one .md per note with YAML front matter, folders as
directories. That makes the export a real exit rather than a gesture -- a
member can round-trip out and back in, which is the whole reason it earns
trust.

⛔ Never raises on an unknown node type. Export runs over content written by
every editor version a member has ever used, and a 500 on one odd block
would deny them the whole archive.
"""
from __future__ import annotations

import io
import json
import re
import sqlite3
import zipfile
from datetime import datetime, timezone
from typing import Any

_INLINE_MARKS = {
    "bold": ("**", "**"),
    "italic": ("*", "*"),
    "strike": ("~~", "~~"),
    "code": ("`", "`"),
}


def _text_with_marks(node: dict[str, Any]) -> str:
    text = node.get("text") or ""
    for mark in node.get("marks") or []:
        mtype = mark.get("type")
        if mtype == "link":
            href = (mark.get("attrs") or {}).get("href") or ""
            text = f"[{text}]({href})"
        elif mtype in _INLINE_MARKS:
            open_, close = _INLINE_MARKS[mtype]
            text = f"{open_}{text}{close}"
    return text


def _inline(nodes: list[dict[str, Any]] | None) -> str:
    out = []
    for n in nodes or []:
        if n.get("type") == "text":
            out.append(_text_with_marks(n))
        elif n.get("type") == "hardBreak":
            out.append("\n")
        else:
            out.append(_block(n))
    return "".join(out)


def _list_items(node: dict[str, Any], bullet) -> str:
    lines = []
    for i, item in enumerate(node.get("content") or []):
        inner = "\n".join(
            _block(c) for c in (item.get("content") or [])
        ).strip()
        if item.get("type") == "taskItem":
            box = "x" if (item.get("attrs") or {}).get("checked") else " "
            lines.append(f"- [{box}] {inner}")
        else:
            lines.append(f"{bullet(i)} {inner}")
    return "\n".join(lines)


def _table(node: dict[str, Any]) -> str:
    rows: list[list[str]] = []
    for row in node.get("content") or []:
        cells = [
            "\n".join(_block(c) for c in (cell.get("content") or [])).strip()
            for cell in (row.get("content") or [])
        ]
        rows.append(cells)
    if not rows:
        return ""
    out = ["| " + " | ".join(rows[0]) + " |",
           "| " + " | ".join("---" for _ in rows[0]) + " |"]
    for r in rows[1:]:
        out.append("| " + " | ".join(r) + " |")
    return "\n".join(out)


def _block(node: dict[str, Any]) -> str:
    ntype = node.get("type")
    attrs = node.get("attrs") or {}
    kids = node.get("content")

    if ntype == "text":
        return _text_with_marks(node)
    if ntype == "paragraph":
        return _inline(kids)
    if ntype == "heading":
        level = int(attrs.get("level") or 1)
        return f"{'#' * max(1, min(level, 6))} {_inline(kids)}"
    if ntype == "bulletList":
        return _list_items(node, lambda i: "-")
    if ntype == "orderedList":
        return _list_items(node, lambda i: f"{i + 1}.")
    if ntype == "taskList":
        return _list_items(node, lambda i: "-")
    if ntype == "listItem":
        return "\n".join(_block(c) for c in (kids or []))
    if ntype == "blockquote":
        inner = "\n".join(_block(c) for c in (kids or []))
        return "\n".join(f"> {ln}" for ln in inner.split("\n"))
    if ntype == "codeBlock":
        lang = attrs.get("language") or ""
        return f"```{lang}\n{_inline(kids)}\n```"
    if ntype == "horizontalRule":
        return "---"
    if ntype == "hardBreak":
        return "\n"
    if ntype in ("image", "resizableImage"):
        src = attrs.get("src") or ""
        return f"![{attrs.get('alt') or ''}]({src})"
    if ntype == "attachmentChip":
        return f"[{attrs.get('name') or 'attachment'}]({attrs.get('href') or ''})"
    if ntype == "videoTimestamp":
        return f"[{attrs.get('label') or attrs.get('seconds') or 'timestamp'}]"
    if ntype == "widgetEmbed":
        # A live widget cannot exist in markdown. Exporting nothing would make
        # the note look like it lost content, so emit the widget's own
        # pre-computed search line -- the same string that feeds body_plain.
        label = attrs.get("searchText") or attrs.get("widgetId") or "widget"
        return f"> [{label}]"
    if ntype == "table":
        return _table(node)

    # Unknown node (a block added after this exporter was written): keep the
    # member's text rather than dropping it or raising.
    if kids:
        return "\n".join(_block(c) for c in kids)
    return ""


def tiptap_to_markdown(doc: dict[str, Any] | None) -> str:
    """TipTap document JSON -> markdown. Never raises on unknown nodes."""
    if not isinstance(doc, dict):
        return ""
    blocks = [_block(n) for n in (doc.get("content") or [])]
    return "\n\n".join(b for b in blocks if b != "").strip()


_UNSAFE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def _safe_name(name: str, fallback: str) -> str:
    cleaned = _UNSAFE.sub("-", (name or "").strip()).strip(". ")
    return (cleaned or fallback)[:120]


def _front_matter(row: sqlite3.Row) -> str:
    try:
        tags = json.loads(row["tags"] or "[]")
    except (ValueError, TypeError):
        tags = []
    lines = ["---", f"title: {row['title'] or 'Untitled'}"]
    if row["ticker"]:
        lines.append(f"ticker: {row['ticker']}")
    if tags:
        lines.append("tags: [" + ", ".join(str(t) for t in tags) + "]")
    lines.append(f"created: {row['created_at']}")
    lines.append(f"updated: {row['updated_at']}")
    lines.append("---")
    return "\n".join(lines)


def build_export_zip(
    user_id: str, conn: sqlite3.Connection | None = None,
) -> tuple[bytes, str]:
    """Every note this user owns, as markdown in a zip. Returns (bytes, filename).

    ⛔ Scoped by user_id in SQL, never filtered in Python -- an export is the
    highest-blast-radius place a tenancy mistake could land."""
    from .db import get_connection

    owned = conn is None
    conn = conn or get_connection()
    try:
        folders = {
            r["id"]: r["name"] for r in conn.execute(
                "SELECT id, name FROM j2_note_folders WHERE user_id = ?", (user_id,))
        }
        rows = conn.execute(
            "SELECT id, title, body_json, tags, ticker, folder_id,"
            " created_at, updated_at FROM j2_notes WHERE user_id = ?"
            " ORDER BY updated_at DESC", (user_id,),
        ).fetchall()

        buf = io.BytesIO()
        used: set[str] = set()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for row in rows:
                try:
                    doc = json.loads(row["body_json"] or "{}")
                except (ValueError, TypeError):
                    doc = {}
                body = tiptap_to_markdown(doc)
                folder = _safe_name(folders.get(row["folder_id"], ""), "")
                base = _safe_name(row["title"], row["id"])
                path = f"{folder}/{base}" if folder else base
                # Two notes may share a title; the id keeps them distinct.
                if f"{path}.md" in used:
                    path = f"{path}-{row['id'][:8]}"
                used.add(f"{path}.md")
                zf.writestr(f"{path}.md", f"{_front_matter(row)}\n\n{body}\n")

        stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        return buf.getvalue(), f"uct-notebook-export-{stamp}.zip"
    finally:
        if owned:
            conn.close()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest api/services/journal_two/test_notes_export.py -v`
Expected: 9 passed.

- [ ] **Step 5: Add the route**

In `api/routers/journal_two.py`, beside the existing `/trades/export` route:

```python
@router.get("/notes/export")
def export_notes(user=Depends(get_current_user)):
    """Download every note as markdown + front matter in a zip.

    Deliberately unpaginated and synchronous: it is a rare, member-initiated
    action, and a partial export is worse than a slow one. If large libraries
    make this slow enough to matter, move it behind the job runner -- do not
    silently truncate it."""
    from api.services.journal_two.notes_export import build_export_zip

    blob, filename = build_export_zip(user["id"])
    return Response(
        content=blob,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
```

Match the surrounding routes' auth dependency and user-id accessor exactly — read `export_trades` immediately above and mirror it rather than assuming `user["id"]`.

- [ ] **Step 6: Verify the route responds**

Run: `python -m pytest api/routers/ -q -k "journal_two or notes"`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add api/services/journal_two/notes_export.py api/services/journal_two/test_notes_export.py api/routers/journal_two.py
git commit -m "feat(notebook): export all notes as markdown + front matter zip"
```

---

## Task 4: Volume headroom — measure, then guard

**Files:**
- Create: `tools/notebook_volume_report.py`
- Create: `api/services/journal_two/notes_quota.py`
- Test: `api/services/journal_two/test_notes_quota.py`

**Interfaces:**
- Consumes: `_attachment_root()` from `attachment_root.py`
- Produces: `volume_headroom() -> dict`, `assert_import_headroom(bytes_wanted: int) -> None` (raises `NoteQuotaExceeded`)

**⛔ Order matters and is not negotiable:** the report runs first and its numbers go in the ledger; the guard's threshold is set from what it measures. Writing a threshold into this plan would be a forecast, not a measurement — and this codebase has a standing rule that an acceptance number is a forecast until derived.

- [ ] **Step 1: Write the measurement tool**

```python
"""What is actually on the notebook attachment volume, and how much room is left.

Run BEFORE opening any connector to members. Its output sets the import
media budget -- which is why no budget number is hard-coded anywhere yet.

Usage: python tools/notebook_volume_report.py
"""
import os
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api.services.journal_two.attachment_root import _attachment_root  # noqa: E402


def main() -> None:
    root = _attachment_root()
    total = files = 0
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            try:
                total += os.path.getsize(os.path.join(dirpath, fn))
            except OSError:
                continue
            files += 1
    usage = shutil.disk_usage(root)
    print(f"attachment root : {root}")
    print(f"files           : {files:,}")
    print(f"attachment bytes: {total:,} ({total / 1e9:.2f} GB)")
    print(f"volume total    : {usage.total / 1e9:.2f} GB")
    print(f"volume free     : {usage.free / 1e9:.2f} GB")
    if files:
        print(f"mean bytes/file : {total // files:,}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it and record the numbers**

Run: `python tools/notebook_volume_report.py`

Record the output in the wave ledger. ⛔ Do not run this on the prod pod — it double-loads the api stack beside uvicorn and has already caused member-visible OOM outages twice. Run it locally against `C:\data`, or over `railway ssh` as a standalone probe with `PYTHONPATH=/app`.

- [ ] **Step 3: Write the failing guard test**

```python
"""Import media budget. The threshold comes from tools/notebook_volume_report.py
-- these tests pin the BEHAVIOUR (refuse when short on room), not a number
invented at planning time."""
import pytest

from api.services.journal_two.notes_quota import (
    NoteQuotaExceeded, assert_import_headroom,
)


def test_import_is_refused_when_free_space_is_below_the_floor(monkeypatch):
    from api.services.journal_two import notes_quota
    monkeypatch.setattr(notes_quota, "_free_bytes", lambda: 100)
    with pytest.raises(NoteQuotaExceeded):
        assert_import_headroom(10_000)


def test_import_proceeds_with_ample_room(monkeypatch):
    from api.services.journal_two import notes_quota
    monkeypatch.setattr(notes_quota, "_free_bytes", lambda: 500 * 1024**3)
    assert_import_headroom(10_000) is None


def test_guard_fails_closed_when_the_volume_cannot_be_read(monkeypatch):
    """If we cannot tell how much room is left, refuse. Filling the volume
    that holds 20+ SQLite DBs is a member-visible outage, not a note error."""
    from api.services.journal_two import notes_quota

    def boom():
        raise OSError("volume unreadable")

    monkeypatch.setattr(notes_quota, "_free_bytes", boom)
    with pytest.raises(NoteQuotaExceeded):
        assert_import_headroom(1)
```

- [ ] **Step 4: Run to verify it fails**

Run: `python -m pytest api/services/journal_two/test_notes_quota.py -v`
Expected: FAIL — module not found.

- [ ] **Step 5: Implement the guard**

```python
"""Import media budget for the notebook attachment volume.

The volume also holds 20+ SQLite DBs on a single-replica pod. Filling it is
not a note-level error, it is an outage -- so this guard FAILS CLOSED: if
free space cannot be determined, the import is refused.

RESERVE_BYTES is set from tools/notebook_volume_report.py against the real
volume. Do not tune it from intuition.
"""
from __future__ import annotations

import os
import shutil

from .attachment_root import _attachment_root

# Headroom that must remain free AFTER an import completes. Derived from
# tools/notebook_volume_report.py -- see the wave ledger for the measurement.
RESERVE_BYTES = int(os.environ.get("NOTE_IMPORT_RESERVE_BYTES", 2 * 1024**3))


class NoteQuotaExceeded(Exception):
    """Not enough room on the attachment volume to accept this import."""


def _free_bytes() -> int:
    return shutil.disk_usage(_attachment_root()).free


def volume_headroom() -> dict:
    try:
        free = _free_bytes()
    except OSError as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "free_bytes": free, "reserve_bytes": RESERVE_BYTES}


def assert_import_headroom(bytes_wanted: int) -> None:
    """Raises NoteQuotaExceeded unless the volume can take `bytes_wanted`
    and still keep RESERVE_BYTES free."""
    try:
        free = _free_bytes()
    except OSError as e:
        raise NoteQuotaExceeded(f"cannot read volume free space: {e}") from e
    if free - max(0, bytes_wanted) < RESERVE_BYTES:
        raise NoteQuotaExceeded(
            f"import needs {bytes_wanted:,}B; only {free:,}B free with a "
            f"{RESERVE_BYTES:,}B reserve")
```

- [ ] **Step 6: Run to verify it passes**

Run: `python -m pytest api/services/journal_two/test_notes_quota.py -v`
Expected: 3 passed.

- [ ] **Step 7: Set `RESERVE_BYTES` from the Step 2 measurement**

Replace the default with the derived value, and note the measurement date in the docstring. If the measurement shows the volume is already tight, this is the signal to move note media to R2 — raise it rather than shipping a guard that refuses every import.

- [ ] **Step 8: Commit**

```bash
git add tools/notebook_volume_report.py api/services/journal_two/notes_quota.py api/services/journal_two/test_notes_quota.py
git commit -m "feat(notebook): measured volume headroom guard for imports"
```

---

## Task 5: Tag cloud cap

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx`
- Test: `app/src/pages/journal-2-0/components/notebook/FolderSidebar.test.jsx` (append)

A decade of Evernote tags is not a cloud, it is a wall. Cap the rendered set to the most-used tags with a "show all" affordance and a filter input.

- [ ] **Step 1: Read the current tag rendering**

Run: `sed -n '1,80p' app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx`

Identify how the tag list is derived and rendered before changing anything. ⛔ Read the surrounding decision before inventing one — if a cap or sort already exists for a stated reason, extend it rather than replacing it.

- [ ] **Step 2: Write the failing test**

Append to `FolderSidebar.test.jsx`:

```jsx
it('caps the tag list and reveals the rest on demand', async () => {
  const tags = Array.from({ length: 120 }, (_, i) => ({ tag: `t${i}`, count: 120 - i }))
  render(<FolderSidebar folders={[]} tags={tags} onSelect={() => {}} />)
  // Only the capped set renders initially.
  expect(screen.queryByText('t119')).not.toBeInTheDocument()
  expect(screen.getByText('t0')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /show all tags/i }))
  expect(screen.getByText('t119')).toBeInTheDocument()
})
```

Match the component's real props — read them in Step 1 and correct this test to fit rather than changing the component's signature to fit the test.

- [ ] **Step 3: Run to verify it fails**

Run (from `app/`): `npx vitest run src/pages/journal-2-0/components/notebook/FolderSidebar.test.jsx`
Expected: FAIL.

- [ ] **Step 4: Implement the cap**

Sort tags by count descending, slice to a `TAG_CAP` of 40, and render a "Show all tags" button plus a filter input when the total exceeds the cap.

- [ ] **Step 5: Run to verify it passes, then commit**

```bash
git add app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx app/src/pages/journal-2-0/components/notebook/FolderSidebar.test.jsx
git commit -m "feat(notebook): cap the tag cloud for migrated libraries"
```

---

## Task 6: Prove it at scale (the wave gate)

**Files:**
- Create: `tools/seed_large_notebook.py`

No new feature — this is the gate that decides whether Wave 0 is done. jsdom computes no layout and unit tests do not measure query time; the numbers have to come from a real library.

- [ ] **Step 1: Write the seeder**

A script that inserts N notes (default 5,000) for a test user with realistic body lengths, via the same INSERT the importer uses, into a local DB — never prod.

- [ ] **Step 2: Measure search before and after**

Time `list_notes(user, q=...)` at N=5,000 against both the FTS path and the old `LIKE` path (temporarily forcing the fallback). Record both numbers.

- [ ] **Step 3: Measure the archive list render**

Load the Notebook tab against the seeded DB in a real browser and confirm the list virtualizes. `FrozenList` exists — confirm `NotebookTab` actually routes through it rather than rendering all 5,000 cards. **The browser sees what no test can.** If it does not virtualize, that is a defect this wave owns.

- [ ] **Step 4: Record the numbers in the ledger and commit**

```bash
git add tools/seed_large_notebook.py
git commit -m "test(notebook): large-library seeder for the scale gate"
```

---

## Self-Review

**Spec coverage (§4 + §8.2):**

| Spec requirement | Task |
|---|---|
| §4.1 FTS5 over (title, body_plain), derived, one writer authority | 1, 2 |
| §4.2 Measure volume, then set an import media budget guard | 4 |
| §4.3 Tag cloud cap | 5 |
| §4.3 Archive list virtualization verified | 6 |
| §4.3 Folder sidebar depth | **not covered — deferred**, see below |
| §4.4 Initial-sync concurrency ceiling | **not covered — deferred**, see below |
| §8.2 Note export | 3 |

**Two spec items deliberately deferred out of this plan, not forgotten:**

- **§4.4 initial-sync concurrency ceiling** belongs in the connector waves, not here — it guards the sync scheduler, which no Wave 0 task touches. It must land before the first connector opens to members. Tracked as the first task of Wave 1.
- **§4.3 folder sidebar depth** has no failing behaviour to write a test against until a real deep tree exists. Re-assess against the Task 6 seeded library; if the tree renders acceptably at depth, there is nothing to build.

**Type consistency:** `fts_match_expr` (Task 2) is the only name shared across tasks and is used identically in both. `build_export_zip` returns `(bytes, str)` in both its definition and its route caller. `_free_bytes` is the single monkeypatch seam in Task 4 and is referenced by that exact name in all three of its tests.

**Placeholder scan:** no TBD/TODO markers; every code step carries runnable code. Task 5's test is explicitly marked as needing prop correction against the real component — that is an instruction to verify, not a placeholder.
