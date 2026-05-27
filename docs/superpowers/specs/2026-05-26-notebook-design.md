# Journal 2.0 — Notebook (replaces Playbook)

**Date:** 2026-05-26
**Status:** Design approved, awaiting implementation plan
**Scope:** Replace the Journal 2.0 "Playbook" tab with a Substack-flavored "Notebook" — a long-form, WYSIWYG-edited, folder+tag-organized notes surface that migrates existing Playbook entries into notes.

---

## 1. Motivation

The current Playbook tab is a structured "stock observation library" with rigid per-entry fields (symbol, status pill, trigger/stop/target levels, screenshots, thesis). The user wants a free-form, Substack-flavored writing surface — long-form posts with titles, subtitles, hero images, rich body text, and an archive view — while preserving the trading-context affordances (optional ticker per note, screenshots, organization).

This spec replaces Playbook entirely. Existing Playbook entries are migrated into notes; no UI for the old tab remains.

## 2. Goals & Non-Goals

**Goals (v1)**
- Substack-quality writing experience: WYSIWYG editor, hero image, title + subtitle, formatted body.
- Folder-based organization (flat) + per-note tags (free-form, autocompleted from history).
- Optional ticker association per note (filterable, clickable).
- One-shot, idempotent migration of all `j2_playbook_entries` rows into the new `j2_notes` table.
- "Save to Notebook" hand-off from the existing chart context menu (with chart screenshot as hero).
- All notes searchable across body text (`LIKE`-based).
- Free-tier accessible (inherits Journal's existing `FREE_PAGES` membership).

**Non-goals (deferred)**
- Nested folder tree / drag-reorder folders.
- SQLite FTS5 full-text search (LIKE is sufficient until ~1000+ notes).
- Wiki-style `[[note-title]]` cross-linking and backlinks panel.
- Export to single-file markdown or PDF.
- Sharing a note publicly (community Notebook).
- Compass voice integration on Notebook (explicitly dropped during brainstorming — Compass-as-coach against notes is a future hook).
- Pruning orphaned screenshots no longer referenced by any note.

## 3. Architecture

### 3.1 Frontend (`app/src/pages/journal-2-0/`)

| Path | Action |
|------|--------|
| `tabs/PlaybookTab.jsx`, `tabs/PlaybookTab.module.css` | Rename to `tabs/NotebookTab.{jsx,module.css}`. |
| `JournalTwoRoot.jsx` | In `NESTED_TABS`, swap `{ key: 'playbook', label: '📚 Playbook' }` → `{ key: 'notebook', label: '📓 Notebook' }`. Update the `nestedTab === 'playbook'` render branch to `'notebook'` rendering `<NotebookTab />`. Rebind hotkey from `g>b` (playbook) → `g>n` (notebook); update `ShortcutCheatSheet` listing accordingly. |
| `components/playbook/PlaybookEntryModal.{jsx,module.css}` | **Delete.** Replaced by `NoteEditorPage`. |
| `components/notebook/NoteEditorPage.jsx` (new) | Full-page editor (centered serif column, TipTap body, sticky header). |
| `components/notebook/NoteCard.jsx` (new) | Archive-grid card (hero thumb, title, subtitle, date, ticker, tags). |
| `components/notebook/FolderSidebar.jsx` (new) | Left rail: folder list + tag cloud + search. |
| `components/notebook/HeroImagePicker.jsx` (new) | Upload / replace / remove hero image. |
| `hooks/useJ2Playbook.js` | Rename to `hooks/useJ2Notes.js`. |
| `hooks/useJ2NoteFolders.js` (new) | SWR hook for folder CRUD. |
| `lib/tiptap.js` (new) | Shared TipTap configuration (extensions, image upload handler, link sanitizer, slash-menu suggestion). |

**Other touch-points**
- `app/src/pages/journal-2-0/components/ChartContextMenu.jsx` — **add a new "📓 Save to Notebook" menu item** (no Playbook equivalent existed; Playbook's empty-state hint claiming this feature was aspirational and never wired). New `onSaveToNotebook` prop, threaded through wherever the menu is mounted. The handler captures the chart pane to a blob and calls the flow in §5.4.
- `CLAUDE.md` and user-memory MEMORY.md entries that reference Playbook get a sweep so future sessions don't reference a tab that no longer exists. Also sweep any aspirational hint text (e.g. the PlaybookTab empty state) that referenced unbuilt features — the NotebookTab empty state should describe only what actually exists.

**New runtime dependencies**
```
@tiptap/react
@tiptap/starter-kit
@tiptap/extension-image
@tiptap/extension-link
@tiptap/extension-placeholder
```
All MIT, ~80KB gzip combined. No new backend deps.

### 3.2 Backend (`api/`)

| Path | Action |
|------|--------|
| `routers/journal_two.py` | Replace `/api/j2/playbook[/{id}]` and screenshot endpoint with `/api/j2/notes[/{id}]` family. Add `/api/j2/note-folders` CRUD family. |
| `services/journal_two/playbook.py` + `services/journal_two/test_playbook.py` | Replace with `services/journal_two/notes.py` + `services/journal_two/test_notes.py` — same shape (list / get / create / update / delete + image helpers) plus folder CRUD and a `convert_playbook_to_tiptap()` helper used by the migration. |
| `services/journal_two/db.py` | `_J2_SCHEMA` gains `j2_notes` + `j2_note_folders`. New `_NOTEBOOK_MIGRATION_V1` block performs the rename + ALTER + one-shot data backfill, gated by `.notebook_migration_v1` flag file in `DATA_DIR`. |

### 3.3 What is NOT changing

- Account model, fees, Accounts tab, Calendar, Analytics, Trade Journal, Compass surfaces — untouched.
- Screenshot storage path `/data/j2_screenshots/` and the Pillow→WebP pipeline — reused.
- Auth, AuthGuard, free-tier rules — Notebook inherits Playbook's current access (Journal already in `FREE_PAGES`).

## 4. Data Model

### 4.1 `j2_notes`

```sql
CREATE TABLE IF NOT EXISTS j2_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  account_id      INTEGER,                          -- nullable; same multi-account pattern as the rest of J2
  folder_id       INTEGER,                          -- nullable = "Unfiled"
  title           TEXT NOT NULL,
  subtitle        TEXT,
  body_json       TEXT NOT NULL DEFAULT '{}',       -- TipTap ProseMirror doc as JSON
  body_plain      TEXT NOT NULL DEFAULT '',         -- denormalized plain text for search + archive previews
  hero_image_url  TEXT,
  ticker          TEXT,                             -- optional, uppercase
  tags            TEXT NOT NULL DEFAULT '[]',       -- JSON array of strings (same convention as j2_accounts.muted_setups)
  status          TEXT,                             -- nullable; populated only on migrated rows ("watching","triggered",...) so historical filter still works
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (folder_id) REFERENCES j2_note_folders(id) ON DELETE SET NULL
);

CREATE INDEX idx_j2_notes_user_updated ON j2_notes(user_id, updated_at DESC);
CREATE INDEX idx_j2_notes_user_folder  ON j2_notes(user_id, folder_id);
CREATE INDEX idx_j2_notes_user_ticker  ON j2_notes(user_id, ticker);
```

### 4.2 `j2_note_folders`

```sql
CREATE TABLE IF NOT EXISTS j2_note_folders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE INDEX idx_j2_note_folders_user ON j2_note_folders(user_id, sort_order);
```

Folders are flat in v1.

### 4.3 Screenshots / images

- Continue writing to `/data/j2_screenshots/` via the existing upload pipeline.
- Endpoint `POST /api/j2/notes/{id}/images` returns `{url, width, height}`. TipTap's image node stores the URL in `src`.
- Endpoint `POST /api/j2/notes/{id}/hero` sets `hero_image_url` on the note row (same Pillow→WebP pipeline).
- No separate `attachments` table in v1. Orphan cleanup deferred.

### 4.4 TipTap `body_json` shape

Standard ProseMirror JSON. Example:

```json
{"type":"doc","content":[
  {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Why NVDA caught my eye"}]},
  {"type":"paragraph","content":[{"type":"text","text":"Sitting on the 50EMA after a 35% pole..."}]},
  {"type":"image","attrs":{"src":"/api/j2/notes/41/images/abc.webp","alt":""}}
]}
```

`body_plain` is derived server-side on every save by recursively walking the doc and concatenating all `text` nodes (space-separated). The client computes the same value optimistically for the autosave round-trip; the server's value is authoritative.

### 4.5 Migration (one-shot, idempotent)

Lives in `services/journal_two/db.py` next to the existing heal blocks. Gated by `.notebook_migration_v1` flag file in `DATA_DIR` (same pattern as `.fmp_tz_heal_v1`, `.strict_gt_heal_v2`, `.intraday_heal_v3_60day`).

Steps:
1. `CREATE TABLE IF NOT EXISTS j2_notes`, `j2_note_folders`, all indexes.
2. If `j2_playbook_entries` exists, read every row. For each:
   - Build TipTap doc:
     - H1 heading: `{symbol} — {observedDate}`
     - If `levels` non-empty: a table node with rows for Trigger / Support / Resistance / Stop / Target (only those that exist).
     - Paragraph: `thesis`
     - For each `kind == 'image'` attachment: an image node with that URL.
     - For each `kind == 'link'` attachment: a paragraph with a link node.
     - Paragraph: `notes`
   - `title` ← `"{symbol} {setup} — {observedDate}"` if `setup` set, else `"{symbol} — {observedDate}"`.
   - `subtitle` ← `setup` if set, else `NULL`.
   - `hero_image_url` ← first image attachment URL (if any).
   - `ticker` ← `symbol`.
   - `tags` ← `[status]` (so old `watching`/`triggered`/`traded`/`passed`/`dead` filter still works as a tag).
   - `status` ← original status string (kept for historical fidelity).
   - `body_plain` ← derived from the TipTap doc.
   - `folder_id` ← `NULL` (Unfiled).
   - `created_at` / `updated_at` ← original entry timestamps.
3. `ALTER TABLE j2_playbook_entries RENAME TO j2_playbook_entries_legacy_v1`.
4. Touch `/data/.notebook_migration_v1`.

The whole block runs inside a single transaction wrapped in `try/except`. On exception, the flag file is not written, so the next deploy retries cleanly. To guard against partial duplicates if the migration crashes mid-loop, INSERT into `j2_notes` is preceded by a `SELECT 1 FROM j2_notes WHERE user_id = ? AND created_at = ? AND title = ?` idempotency check.

**Legacy table retention:** `j2_playbook_entries_legacy_v1` is kept read-only for ~30 days as a safety net. Manual cleanup task (NOT part of v1): `DROP TABLE j2_playbook_entries_legacy_v1`.

## 5. UI / UX

### 5.1 Archive view (Notebook tab landing)

- Left rail (260px, collapsible on mobile): "All notes" / "Unfiled" / each folder / `+ New folder`; below that, a tag cloud sorted by count.
- Top toolbar: search input (debounced 200ms, `body_plain LIKE '%query%'` server-side), active-filter chips (folder / tag / ticker), sort dropdown (Updated / Created / Title).
- Grid: CSS `auto-fill, minmax(280px, 1fr)`. Each `NoteCard`:
  - Hero thumbnail (or initials-on-folded-corner placeholder if no hero)
  - Title (1–2 lines, ellipsis)
  - Subtitle (1 line)
  - Relative date (`3d`, `5d`, `1w`)
  - Ticker badge (`$NVDA`) if set — click jumps to chart
  - Tag chips
- Hover: subtle lift + gold accent border. Click anywhere on card → open editor.
- Empty state: centered illustration + "Your notebook is empty. Click + New note to start writing."
- `+ New note` (gold primary button, top-right): `POST /api/j2/notes` with empty body, then route to the editor for that ID — so image uploads work from the first keystroke.

### 5.2 Editor view (`NoteEditorPage`)

Route: `/journal?j2tab=notebook&note={id}` (query-param routing, matching the existing `useSearchParams`-based pattern in `JournalTwoRoot.jsx`). `NotebookTab` reads `searchParams.get('note')` — if present, it renders `<NoteEditorPage id={...} />` in place of the archive grid; if absent, it renders the archive. Back-arrow simply clears the `note` param via `setSearchParams`, which restores the archive view (filter + scroll state restored from `sessionStorage`).

Layout:
- Sticky header: back arrow (returns to archive, restores filter + scroll via `sessionStorage`); autosave indicator (`Saving…` / `Saved 2s ago`); folder selector dropdown (with inline `+ New folder`); ticker chip (click → existing `SymbolSearch` component used in `/charts`); tag editor (chip input with autocomplete); overflow `⋯` menu (Duplicate, Export markdown); Delete button (confirm modal).
- Centered column, ~720px max-width, Georgia/serif for title and headings (matches the existing serif exception carved out for cartographer decoration; explicitly allowed for Notebook because notes are presentation-grade content, not UI chrome).
- Hero image slot: empty = dashed-border "Click to add a hero image"; filled = image with hover ✕ (remove) and ↻ (replace).
- Title (`contentEditable`, autofocus on new notes) → Subtitle (lighter, smaller, optional) → TipTap body.
- TipTap toolbar: floating, appears on text selection. Buttons: B, I, H1, H2, bullet list, numbered list, blockquote, link, image, code, horizontal rule.
- Slash menu: typing `/` opens a Suggestion-based picker (image, headings, quote, code block, divider, table). Substack-style UX.
- Autosave: debounced 800ms after last edit; also fires on blur + on route-leave. Optimistic update + SWR revalidation.
- Keyboard: Ctrl+B / Ctrl+I / Ctrl+K (link). Esc → archive (with unsaved-changes confirm if dirty).
- Mobile (<640px): full-bleed editor; header collapses to back-arrow + save indicator + overflow sheet; folder/ticker/tag selectors live in the sheet.

### 5.3 TipTap configuration (`lib/tiptap.js`)

Extensions:
- `StarterKit` (paragraph, heading, bold, italic, strike, list, blockquote, code, codeBlock, horizontalRule, hardBreak, history)
- `Image` (wired to `POST /api/j2/notes/{id}/images`; supports drag-and-drop + clipboard paste)
- `Link` (autolink, sanitized to `https://` only, `rel="noreferrer"`)
- `Placeholder` (`"Start writing…"` when body is empty)
- Custom `SlashMenu` (built on `@tiptap/suggestion` — bundled in StarterKit's dep tree, no extra package)

### 5.4 ChartContextMenu hand-off (new feature)

`ChartContextMenu.jsx` currently exposes "Reset Chart View / + Add to Portfolio / Settings". v1 adds a fourth item: **"📓 Save to Notebook"**.

Flow when clicked:
1. Capture the chart pane via `canvas.toBlob()` (Lightweight Charts exposes the canvas via the existing chart instance ref — confirm the exact API call during implementation; this is the only piece that needs verification because Lightweight Charts v5 doesn't expose `toBlob` directly and may need a 2-canvas composite).
2. `POST /api/j2/notes` with `{ticker, title: "{TICKER} — {YYYY-MM-DD}"}` to create a draft.
3. `POST /api/j2/notes/{id}/hero` with the chart blob.
4. Navigate to `/journal?j2tab=notebook&note={id}` with the cursor on the title.

If the canvas capture step is non-trivial in Lightweight Charts v5, ship the menu item with ticker + date pre-fill only and leave the hero image as a manual upload — do NOT block v1 on the canvas-export rabbit hole.

## 6. API

All endpoints require authenticated session (`get_current_user`). All routes namespaced under `/api/j2`.

### Notes

| Method | Path | Body / Query | Returns |
|--------|------|--------------|---------|
| GET | `/api/j2/notes` | `?folder_id=…&tag=…&ticker=…&q=…&sort=updated\|created\|title&limit=…&offset=…` | `{notes: [...]}` |
| GET | `/api/j2/notes/{id}` | — | `{note: {...}}` |
| POST | `/api/j2/notes` | `{title?, subtitle?, body_json?, folder_id?, ticker?, tags?}` | `{note: {...}}` |
| PUT | `/api/j2/notes/{id}` | partial note fields | `{note: {...}}` |
| DELETE | `/api/j2/notes/{id}` | — | `{ok: true}` |
| POST | `/api/j2/notes/{id}/images` | multipart `file` | `{url, width, height}` |
| POST | `/api/j2/notes/{id}/hero` | multipart `file` | `{hero_image_url}` |
| DELETE | `/api/j2/notes/{id}/hero` | — | `{ok: true}` |

### Folders

| Method | Path | Body | Returns |
|--------|------|------|---------|
| GET | `/api/j2/note-folders` | — | `{folders: [...]}` |
| POST | `/api/j2/note-folders` | `{name, sort_order?}` | `{folder: {...}}` |
| PUT | `/api/j2/note-folders/{id}` | `{name?, sort_order?}` | `{folder: {...}}` |
| DELETE | `/api/j2/note-folders/{id}` | — | `{ok: true}` (sets `folder_id = NULL` on contained notes) |

## 7. Testing

### 7.1 Backend (`api/services/journal_two/test_notes.py` — new; replaces `test_playbook.py`, mirroring the co-located test convention already used by `test_accounts.py`, `test_options.py`, etc.)

- `notes_crud` — create / list / get / update / delete happy paths.
- `folders_crud` — create / list / rename / delete; deleting a folder sets `folder_id = NULL` on contained notes.
- `notes_filter` — by folder, by tag, by ticker, by `body_plain LIKE`.
- `body_plain_derivation` — recursive walk over a fixture TipTap doc with headings/lists/quotes/images returns the expected concatenated text.
- `image_upload` — POST a fixture WebP, get `{url, width, height}`, file lands in `/data/j2_screenshots/`.
- `hero_upload` — same path, sets `hero_image_url` on the note row.
- `migration_idempotent` — populate `j2_playbook_entries` with 5 fixture rows (varied: with/without levels, with/without screenshots), run migration twice, assert exactly 5 notes exist and the levels-table renders correctly in `body_json`.
- `migration_flag_gates_rerun` — second startup with `.notebook_migration_v1` present is a no-op.
- `auth_required` — every endpoint returns 401 without a session.

### 7.2 Frontend (vitest)

- `NotebookTab.test.jsx` — archive grid renders seeded notes; folder/tag/ticker filters narrow the grid; card click opens editor.
- `NoteEditorPage.test.jsx` — autosave fires after 800ms idle; save indicator updates; Esc returns to archive with sessionStorage scroll restore; unsaved-changes confirm fires when dirty.
- `FolderSidebar.test.jsx` — create folder, rename folder, delete folder (with contained-notes confirmation).
- `lib/tiptap.test.js` — client-side `extractPlainText(doc)` mirrors the server's `body_plain` derivation on fixture docs.

### 7.3 Manual smoke (pre-ship checklist)

- Create a fresh note → drag-paste an image into the body → image uploads and renders.
- Type `/` → slash menu opens → pick "Heading 2" → cursor stays in place with the new node inserted.
- Set a hero image → reload page → hero persists.
- Right-click a chart in `/charts` → "Save to Notebook" → editor opens with ticker pre-filled and chart screenshot as hero.
- Search "earnings" → matches body text from a migrated Playbook entry.
- On a fresh production-mirror DB, migration converts a real Playbook row into a note with the levels table intact and the original screenshots inline.

## 8. Rollout

- Single Railway deploy. No feature flag (migration is monotonic and bounded).
- Watch logs for the `[startup] notebook-migration` line and any `[error] notebook-migration` traceback.
- If migration fails on prod, the flag file isn't created → next redeploy retries cleanly.
- ~30 days after green ship: manual `DROP TABLE j2_playbook_entries_legacy_v1` cleanup task.

## 9. Open questions

None. All clarifying questions during brainstorming have been resolved:
- Flavor: Substack-style (long-form WYSIWYG with hero image).
- Fate of Playbook: replace, migrate entries into notes.
- Organization: folders + tags (folders flat in v1).
- Editor: TipTap WYSIWYG.
- Per-note fields: optional ticker + hero image; no Compass voice integration.
