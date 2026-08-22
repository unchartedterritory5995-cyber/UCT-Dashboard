# Journal 2.0 — Notebook Import (Notion / Obsidian / Evernote / everything else)

**Date:** 2026-08-11
**Status:** Design approved, awaiting implementation plan
**Scope:** A file-based importer that converts exports from every major note-taking and journaling app into native Notebook notes — folders, tags, images, attachments, and original dates intact — plus the two Notebook upgrades imports require: nested folders and table/checklist support in the editor.

---

## 1. Motivation

The Notebook (spec 2026-05-26) is a Substack-flavored writing surface. This feature turns it into an **onboarding funnel**: a prospective user with years of notes in Notion, Obsidian, or Evernote drags their export into the Notebook and watches their entire structure arrive intact. The importer is the argument for moving their note-taking workflow here.

The relationship with the outside service is **one-time import, re-import-safe** (owner decision 2026-08-11): no OAuth, no background sync. "Seamless updating" is delivered by fingerprinted re-import — dropping the same export again updates changed notes in place instead of duplicating.

## 2. Goals & Non-Goals

**Goals (v1 = Tier 1)**
- One dropzone, zero format questions: the importer auto-detects what was dropped.
- Tier 1 adapters: **Notion** (HTML zip preferred, Markdown & CSV zip supported), **Obsidian** (vault folder or zip), **Evernote** (.enex, one or many), **Generic** (loose/zipped `.md`, `.txt`, `.html`, `.docx`, TextBundle) — the generic lane also covers Bear, Craft, Apple Notes exports, and Joplin's markdown export.
- Preview → confirm flow mirroring the trade importer: write-free preview with honest create/update/skip counts that exactly equal the confirm's result.
- Re-import idempotency via per-note fingerprints (`import_key`).
- Nested folders (tree) in the Notebook, ported from the source's hierarchy.
- Editor gains tables, task lists (checklists), and file-attachment chips so imported content renders properly.
- `[[wiki-links]]` and Notion internal links resolve to real links between imported notes.
- Original created/updated dates preserved wherever the source carries them.
- Per-document failures reported by name; never a silent loss, never a half-import.
- Free-tier accessible (inherits Journal's `FREE_PAGES` membership) — onboarding must work before payment.

**Tier 2 (fast-follow adapters, same registry, not in v1):**
Google Keep (Takeout JSON), Day One (Journal.json), Roam (JSON), Joplin (JEX), Simplenote, Standard Notes, Logseq normalizer, Journey/Diarium. Each is a contained module + fixture; ship as ready.

**Non-goals**
- Live sync / OAuth connectors (incl. OneNote via Microsoft Graph — documented as future work).
- Parsing OneNote binary formats (.one/.onepkg), legacy `.doc`, `.rtf`, password-protected files, >4GB archives (fflate ceiling; preview reports it).
- Exporting notes back out (separate feature).
- Downloading remote-only media (e.g. Roam's Firebase URLs) — Tier 2 decision, default keep as remote links.
- Decrypting Evernote `<en-crypt>` blocks (rendered as a visible placeholder).

## 3. Architecture

**All parsing and conversion happens in the browser; the server receives finished TipTap JSON.** (Owner-approved "Approach A + bulk endpoint," 2026-08-11.)

Rationale: TipTap v3's `generateJSON(html, extensions)` builds ProseMirror JSON **using the same extension list the editor renders with** — fidelity by construction, no second schema authority in Python (this repo's most repeated defect class). Verified feasible end-to-end Aug 2026: nothing in the pipeline forces server-side processing.

```
drop → intake (fflate unzip / folder walk) → detect (adapter registry scores file tree)
     → adapter → intermediate docs {title, html, tags, dates, mediaRefs, linkRefs} + folder tree
     → shared converter (sanitize → checkbox mapping → generateJSON → body_json + body_plain)
     → POST /import/check (write-free counts) → preview UI → user confirms
     → POST /import/confirm (transactional upsert, returns fingerprint→id map)
     → media phase (upload images/attachments per note, rewrite refs + resolve links, PUT bodies)
     → summary (created / updated / skipped / failed-by-name)
```

**New frontend dependencies** (all lazy-loaded in the import chunk, main bundle untouched):
`fflate` (streaming unzip), `markdown-it` + plugins (`task-lists`, `mark`, `footnote`, obsidian callouts/wiki-links/images), `mammoth` (docx→HTML). TipTap additions: `@tiptap/extension-table`, `TaskList`/`TaskItem` from `@tiptap/extension-list` (v3 packaging).

**No new backend dependencies.**

## 4. UX

- **Entry points:** an **Import** button in the NotebookTab header; the empty state becomes an onboarding pitch ("Bring your notes from Notion, Obsidian, Evernote, or anywhere else") with the same button.
- **Wizard, step 1 — drop:** one dropzone accepting files, zips, and whole folders (drag an Obsidian vault in directly; `webkitGetAsEntry` recursive walk, `readEntries` looped past Chromium's 100-entry pages, entries collected synchronously before the first `await`; `<input webkitdirectory>` fallback picker). A collapsed "How do I export from …?" helper per app — this is where we steer Notion users to the HTML export and OneNote users to per-section Word docs.
- **Wizard, step 2 — preview:** "Found **214 notes** in **12 folders**, 89 images, 3 attachments — looks like an **Obsidian vault**." Folder tree with per-node checkboxes, destination picker (top level or under a folder, default "Imported from {source}"), and the dry-run counts from `/import/check`: "202 new · 12 will be updated · 41 unchanged (skipped)". Known-issue warnings appear here (Apple `FallbackImage.png` signature, Notion's missing dates, docx losses).
- **Wizard, step 3 — progress → summary:** progress bar over convert/save/media phases; summary lists created/updated/skipped counts and every failed document by name with reason. Nothing is silently dropped.
- **Re-import:** identical flow; fingerprint matches make it an update pass.

## 5. Editor upgrades

- **Tables** (`@tiptap/extension-table`: Table, TableRow, TableHeader, TableCell) — parses plain `<table>` HTML out of the box; slash menu gains a Table entry.
- **Task lists** (`TaskList`/`TaskItem` from `@tiptap/extension-list`) — slash menu gains a Checklist entry. ⚠️ TaskItem's `parseHTML` matches only `li[data-type="taskItem"]` — standard GFM checkbox HTML (`<li><input type="checkbox">`) parses as a plain bullet and the state is discarded. The shared converter therefore rewrites checkbox list items to the `data-type="taskList"`/`data-type="taskItem"`/`data-checked` shape **before** `generateJSON`. A fixture test locks this.
- **Attachment chip** — a small atom node (filename, size, download link) for non-image attachments (PDFs etc.). Plain-text extraction emits `[file: name.pdf]`.
- **Internal note links** — imported `[[wiki-links]]` / Notion relative links become links to `/journal` note routes. ⚠️ The shared Link config allows only `https:` protocols; internal links need a deliberate app-relative carve-out (extend the config, don't fork it — one authority).
- These benefit hand-written notes too; none are import-only code paths.

## 6. Nested folders

- **Data:** `j2_note_folders` gains `parent_id INTEGER REFERENCES j2_note_folders(id)`; uniqueness becomes `UNIQUE(user_id, parent_id, name)`. SQLite cannot alter constraints in place → **`run_notebook_migration_v2`**: rebuild-and-copy, idempotent, gated by `.notebook_migration_v2` flag file in `DATA_DIR` (exact pattern of `run_notebook_migration_v1` in `services/journal_two/db.py`).
- **Semantics:** max depth 6, enforced server-side. Deleting a folder re-parents its child folders and notes to the deleted folder's parent; at top level, notes go to Unfiled (today's behavior preserved).
- **UI:** `FolderSidebar` renders a collapsible tree (indent + disclosure); create/rename/delete gain a parent context. Existing flat folders are simply roots — no visual change for current users until they nest something.

## 7. Data model (deltas)

```sql
-- j2_note_folders: + parent_id, uniqueness per parent (rebuild migration)
parent_id  INTEGER REFERENCES j2_note_folders(id),
UNIQUE(user_id, parent_id, name)

-- j2_notes: import provenance
import_source TEXT,          -- 'notion' | 'obsidian' | 'evernote' | 'keep' | ... | 'file'
import_key    TEXT,          -- stable fingerprint, e.g. 'obsidian:Trading/Setups/VCP.md'
imported_at   TEXT,
CREATE INDEX idx_j2_notes_user_import ON j2_notes(user_id, import_key);
```

`created_at`/`updated_at` become settable from the import payload (validated ISO-8601; absent → now). Fingerprint construction per adapter: source prefix + the most stable identity the format offers (relative path for file trees; note GUID/uuid for JSON formats; enex: notebook-filename + title + created timestamp).

## 8. API

- **`POST /api/j2/notes/import/check`** — write-free. Body: `{import_keys: [...]}`. Returns `{existing: {key: {id, updated_at, content_hash}}}`. Powers preview counts; equals confirm's outcome by construction (same matching logic, shared function).
- **`POST /api/j2/notes/import/confirm`** — one transaction. Body: `{source, dest_folder_id, folders: [{path}], notes: [{import_key, title, subtitle?, body_json, body_plain, folder_path, tags, ticker?, created_at, updated_at, content_hash}]}`. Upserts folder tree by path under destination (respecting depth cap), upserts notes by `(user_id, import_key)`; unchanged `content_hash` → skipped. Returns `{created: [{import_key, id}], updated: [...], skipped: [...]}`. Rollback on any failure. Request size cap ~20MB; the client chunks very large imports into sequential confirm batches. Atomicity is per batch: a mid-run batch failure leaves earlier batches applied (they are complete, valid notes), stops the run, and the summary says exactly which batch failed and that re-dropping the export resumes safely — fingerprints make the retry an update/skip pass, so nothing duplicates. "Never a half-import" means never a partially-written note or folder tree, and never a silent partial success.
- **Media phase** — images: existing `POST /notes/{id}/images` (Pillow→WebP pipeline reused). Attachments: new `POST /notes/{id}/attachments` (25MB/file cap, MIME allow-list, stored under the existing note-attachment path family served by `serve_note_attachment`). Then one `PUT /notes/{id}` per affected note rewriting placeholder refs to real URLs and resolving internal links via the id map. Media failures retry ×2 then land in the summary by name.
- **Server-side validation:** body_json sanity (node-type allow-list matching the editor's extensions), tag/title length caps, per-import total media cap 500MB.

## 9. Adapters (Tier 1 specifics — from verified Aug 2026 research)

**Detection registry:** each adapter exposes `detect(fileTree) → score`; highest wins; tie/low-confidence → one-question fallback in the wizard. Every fixture must route correctly in tests.

- **Notion** (detect: 32-hex-id filename suffixes; `index.html` sitemap for HTML exports; nested zips possible — unpack recursively).
  - Prefer HTML export (richer; Obsidian's importer refuses the md export as lossy). Markdown lane must still handle **raw HTML islands** in .md (`<aside>` callouts, `<details>` toggles) — markdown-it with `html: true` passes them to the shared HTML sanitizer.
  - Strip hex-id suffixes from titles/folder names; resolve internal relative links via stripped-path → import_key.
  - Databases: full-page CSV + per-row .md subpages; import the row pages (property `Key: Value` header lines become... nothing special — left as body text v1); the CSV itself becomes a table note when ≤50 rows, else skipped-with-reason.
  - **No created/edited dates anywhere in the export** — preview states this; dates fall back to import time (or database Created-time property when present on row pages).
  - Embeds that exported as expiring S3 URLs stay as links, flagged in summary.
- **Obsidian** (detect: `.obsidian/` dir; or a folder/zip of .md files where at least one contains wiki-link/embed/callout syntax — otherwise the generic markdown lane takes it, which converts identically minus vault-specific link resolution).
  - markdown-it + plugins: wiki-links, `![[embeds]]`, `> [!note]` callouts, `==mark==`, footnotes, GFM tables/task lists.
  - YAML frontmatter: `tags` → tags; `created`/`date` keys → created_at when parseable; rest ignored v1.
  - `![[image.png]]` resolves against vault attachment folders by basename; `[[Note|alias]]` resolved post-confirm, unresolved → plain text.
- **Evernote** (detect: `<en-export` root; multiple .enex files welcome).
  - **Notebook name exists only in the .enex filename** → becomes the folder.
  - CDATA-wrapped ENML → inner parse; `<en-todo checked>` → task items; standard XHTML tables pass through; `<en-crypt>` → visible "🔒 encrypted content" placeholder; `evernote:///` inter-note links → plain text v1.
  - Resources: base64-decode straight to `Uint8Array`/Blob (never keep the binary string); match `<en-media hash>` by **MD5 of the decoded binary**; unreferenced resources still attach; missing `file-name` → invent from MIME; `<updated>` may be absent and any attribute may be export-disabled.
  - DOMParser on the main thread (not worker-capable), chunked per note; fine to tens of MB — larger .enex gets a "split your export" message v1.
- **Generic files** (fallback detect).
  - `.md` (markdown-it GFM), `.txt` (paragraphs), `.html` (sanitize→convert), `.docx` (mammoth: images arrive as base64 → re-uploaded as files; headers/footers and table styling are lost — stated in preview), TextBundle/textpack (info.json + text.md + assets — covers Bear and Craft).
  - Folder structure → folder tree; file dates → created/updated when the browser exposes them; inline `#tags` NOT auto-extracted v1 (Bear-specific; Tier 2 refinement).
  - Apple Notes bulk-export bug: every image ref = literal `FallbackImage.png` → detected, warned, images skipped-with-reason rather than imported wrong.

**Sanitizer (shared):** strip `script`/`iframe`/`form`/event handlers/`javascript:` URLs before `generateJSON`; unknown elements unwrap to their text content (generateJSON drops unmatched nodes silently — the extension list must cover everything adapters emit, locked by fixtures).

## 10. Limits & error handling

- Archive ≤4GB (fflate/Zip64 ceiling — detected, clear message), uncompressed total ≤2GB, ≤20,000 entries, attachment ≤25MB/file, media ≤500MB/import, confirm batches ≤20MB.
- Every per-document failure is captured `{name, reason}` and listed in the summary; conversion continues.
- Encoding: UTF-8 with latin-1 fallback; CRLF normalized (Windows-authored vaults).
- The import chunk is lazy-loaded; a conversion crash never takes down the Notebook tab (error boundary around the wizard).

## 11. Testing

- **Golden fixtures** (tiny, sanitized, checked into repo) per Tier 1 adapter covering the quirk list: Notion HTML + md-with-`<aside>`/`<details>` + hex-ids + nested zip + CSV database; enex with en-todo, table, base64 resource (MD5 match), missing file-name, absent `updated`; Obsidian frontmatter + wiki-links + embeds + callouts; generic docx (mammoth), TextBundle, GFM checkbox → taskItem mapping. Assert TipTap JSON snapshots + extracted plain text.
- **Detector tests:** every fixture routes to its adapter; a crafted ambiguous drop triggers the fallback question.
- **Backend:** upsert create/update/skip; re-import idempotency (same payload twice → all skipped); folder-path upsert, depth cap, delete re-parenting; migration v2 preserves existing flat folders and notes (fixture DB); date passthrough.
- **Wire tests** (this repo's unreachability lesson): Import button opens the wizard; wizard confirm issues `POST /import/confirm` with the converted payload (mocked fetch, asserted body); an imported table + checklist fixture **renders** in NoteEditorPage (component test) — reds if any wire is cut.
- **Manual ship gate:** real exports (Notion HTML, Obsidian vault, .enex) imported in the sandboxed dev environment and opened on screen before ship.

## 12. Rollout

- Tier 1 ships as one branch (`notebook-import`), pushed as `push origin notebook-import:master` **only on explicit "ship it"**, inside the deploy window (≥4:20 PM ET or <9:15 AM ET).
- Migration v2 runs at first startup post-deploy; additive UI otherwise — no feature flag needed, the Import button is the only new surface.
- Tier 2 adapters land individually behind the same registry, each with fixtures, no schema changes required.
