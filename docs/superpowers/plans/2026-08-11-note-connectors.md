# Note Connectors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Account-connected background sync of external note libraries (Roam + Craft live; Notion + Dropbox dark) into the Notebook, through the shipped fingerprint import pipeline, with a server-side conversion layer pinned to the editor schema by cross-language contract tests.

**Architecture:** `api/services/journal_two/note_connectors/` package (providers + sync engine + server converters) mirroring the broker-sync template; one scheduler job gated by `NOTE_SYNC_ENABLED`; router `/api/j2/notes/connectors/*`; `ConnectedAppsCard` UI. Everything upserts via the existing `notes.import_confirm` service path.

**Tech Stack:** FastAPI + SQLite (WAL), httpx (async), markdown-it-py + mdit-py-plugins (GFM tables/tasklists), crypto_box Fernet, APScheduler; React + SWR frontend; vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-08-11-note-connectors-design.md` — READ IT FIRST for any task; it carries the research-derived provider mechanics.

## Global Constraints

- Worktree `C:\Users\Patrick\uct-worktrees\note-connectors`, branch `note-connectors`. Explicit `git add <paths>` only — NEVER `git add -A`. Commits end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Backend tests from worktree root: `python -m pytest <file> -v`. Frontend from `app/`: `cd app && npx vitest run <path>` (never `--prefix`/`--root`). The repo-root conftest sandboxes `/data` — never bypass.
- **Migration lesson (paid for once):** nothing in `_J2_SCHEMA` may reference a column a migration adds later; migration v3 mirrors v2's resumable pattern (flag `.notebook_migration_v3` + column/table probes) and is called after v1/v2 in `ensure_schema`; new indexes created AFTER migrations. A test MUST drive `ensure_schema()` itself on a v2-shaped DB.
- **Ordering constraints (load-bearing, from the wizard):** import hash is computed over the PLACEHOLDER body (media as `import-ref://<ref>`, links as `import-link://<key>`) BEFORE upload/rewrite; remote `updated_at` goes into the hash basis (`updatedAt` field of the confirm payload).
- **Second-authority rail:** every Python converter change regenerates the golden fixtures consumed by the vitest schema-contract test (Task 5). A converter task is not done until its fixtures validate in vitest.
- Exception taxonomy: `NoteConnNotConfigured / NoteConnAuthError / NoteConnTokenExpired(⊂AuthError) / NoteConnRateLimited(retry_after) / NoteConnTransient / NoteConnUnsupported(reason)` in `note_connectors/errors.py` — providers raise ONLY these outward.
- Scheduler: ONE job, `max_instances=1`, cron minute offset `:23` (off broker jobs), serial source processing, gated `NOTE_SYNC_ENABLED == "1"` with the job function re-checking (double-gate idiom).
- Secrets: `crypto_box` with env family `NOTE_ENCRYPTION_KEY` / `NOTE_ENCRYPTION_KEYS_V<n>` (generalize crypto_box's key-env parameter, do not fork the module). Token blobs are JSON.
- UI: UIcon only (no emoji); breakpoints 640/1024 only; Sheet idiom for modals; paid-plan gate + consent checkbox mirror `BrokerConnectionsCard`.
- New Python deps: `markdown-it-py`, `mdit-py-plugins` (add to requirements.txt — note railway.json is shared by 3 services; requirements.txt IS flow-watched, so THE SHIP needs `UCT_FLOW_OVERRIDE` review — flag in the final report, owner call).
- Providers must be import-inert: importing the package with no env vars set must not raise (NotConfigured only on use).

## File Structure

```
api/services/journal_two/note_connectors/
  __init__.py errors.py registry.py connections.py engine.py scheduler.py
  providers/base.py providers/roam.py providers/craft.py providers/notion.py providers/dropbox.py
  convert/mddoc.py convert/notion_blocks.py convert/roam_text.py convert/rewrite.py convert/fixtures_gen.py
api/services/journal_two/{db.py,notes.py}        # migration v3; bytes-level media fns
api/routers/note_sync.py                          # + registration in api/main.py (+ scheduler block)
api/services/journal_two/test_note_connectors*.py # per-area test files
tests/test_note_sync_router.py
app/src/pages/journal-2-0/components/connectors/ConnectedAppsCard.{jsx,module.css,test.jsx}
app/src/pages/journal-2-0/components/connectors/SourceRow.jsx  ConnectTokenModal.jsx
app/src/pages/journal-2-0/hooks/useNoteConnectors.js
app/src/pages/journal-2-0/lib/importer/__fixtures__/server_convert/*.json   # generated
app/src/pages/journal-2-0/lib/importer/serverConvert.contract.test.js
```

---

### Task 1: Migration v3 — connector tables (via ensure_schema, the safe way)

**Files:** Modify `api/services/journal_two/db.py`; test `api/services/journal_two/test_note_connectors_db.py` (new).
**Interfaces:** Produces the four tables from spec §5 in `_J2_SCHEMA` (they are NEW tables — `CREATE TABLE IF NOT EXISTS` in the base schema is safe; no ALTERs needed) + `run_notebook_migration_v3(conn)` (flag `.notebook_migration_v3`, table-probed, creates the same tables for pre-existing DBs + index `idx_j2_note_sources_user ON j2_note_sources(user_id, provider)` AFTER creation), called after v2 in `ensure_schema`.
- [ ] Failing tests: (a) fresh `_J2_SCHEMA` has all 4 tables; (b) a v2-shaped DB (build with current `_J2_SCHEMA` minus the 4 new tables via DROP) driven through **`ensure_schema()` itself** gains them, seeded j2_notes/folders rows survive, idempotent second run; (c) `PRAGMA index_list` shows the sources index.
- [ ] Implement; run `python -m pytest api/services/journal_two/test_note_connectors_db.py api/services/journal_two/test_notes_import.py -v` (v2 suite must stay green).
- [ ] Commit `feat(connectors): migration v3 - connector/source/log/remote-index tables`.

### Task 2: crypto_box key-family generalization + connections layer

**Files:** Modify `api/services/crypto_box.py` (parameterize env prefix, default `BROKER_ENCRYPTION_KEY` — zero behavior change for broker callers; add `NoteBox = CryptoBox(prefix="NOTE_ENCRYPTION_KEY")`-style accessor per the module's actual shape — READ IT FIRST and follow its structure); create `note_connectors/connections.py` + `errors.py`; test `test_note_connectors_connections.py`.
**Interfaces:** `upsert_connector(user_id, provider, token_dict, account_label) `/`get_token(user_id, provider) -> dict`/`set_connector_status`/`delete_connector(purges sources+index too)`/`create_source`/`list_sources(user_id)`/`list_due_sources(interval_min)`/`update_cursor`/`record_sync_result`/`get_source`. Encrypt at exactly one write site, decrypt at one read site. `CryptoBoxError` → connector status `broken`, never crash (broker contract).
- [ ] Failing tests: token roundtrip (encrypt→get_token equals dict); broker env prefix still works (control); missing NOTE key → `is_configured() False` and get_token raises `CryptoBoxError`; delete_connector cascades sources + remote_index but NOT notes; list_due_sources honors last_sync_at + interval + sync_enabled + status.
- [ ] Implement; targeted pytest green (incl. any existing crypto_box tests — find and run them).
- [ ] Commit `feat(connectors): connections layer + crypto_box key-family generalization`.

### Task 3: Bytes-level media functions

**Files:** Modify `api/services/journal_two/notes.py`; extend `test_note_connectors_connections.py` or new test file.
**Interfaces:** `save_note_image_bytes(user_id, note_id, data: bytes, filename: str, content_type: str) -> {url,width,height}` and `save_note_attachment_bytes(... ) -> {url,name,size}` — extracted from the existing async UploadFile fns, which become thin wrappers (read → delegate). Same MIME allowlists, size caps, storage layout, return shapes. Sync (no await) so the engine can call from a thread.
- [ ] Failing tests: bytes path stores + serves-path matches existing pattern; UploadFile wrapper still passes the EXISTING image/attachment tests unchanged (run `test_notes_import.py` + `test_notes.py` as the regression control).
- [ ] Implement; pytest green.
- [ ] Commit `feat(connectors): bytes-level media save functions`.

### Task 4: Server converters — mddoc + rewrite (the core)

**Files:** Create `convert/mddoc.py`, `convert/rewrite.py`; add `markdown-it-py`,`mdit-py-plugins` to requirements.txt; test `test_note_convert_mddoc.py`.
**Interfaces:** `md_to_tiptap(md: str) -> {doc: dict, media: [{ref,kind,name}], links: [str]}` — markdown-it-py (`gfm-like` preset: tables plugin, tasklists plugin, strikethrough) token walker emitting TipTap nodes per spec §4 (paragraph/heading1-3(clamp 4-6→3)/bullet+ordered+taskList/table(+header row)/codeBlock(+language)/blockquote/horizontalRule/hardBreak/text marks bold-italic-strike-code-link/image→`{type:'image',attrs:{src:'import-ref://<ref>'}}` with media entry/`import-link://` passthrough hrefs → link marks. `rewrite_body(doc, media_urls: dict, id_by_key: dict) -> (doc, dropped_media: list)` — exact `commit.js rewriteBody` semantics: deep walk, image src swap or drop-with-record, attachmentChip href swap, `import-link://` marks → `/journal?j2tab=notebook&note=<id>` or mark-stripped-text-kept. Pure functions.
- [ ] Failing tests (write ALL before implementing): golden md fixture (headings, nested lists, task list with checked states, table, code, quote, image, link, strike, inline code) → exact TipTap JSON snapshot assertions on structure (types + checked attrs + table shape + placeholder src); rewrite tests mirroring commit.test.js's three cases (swap, drop+record, unresolved-link mark-stripped).
- [ ] Implement; pytest green.
- [ ] Commit `feat(connectors): server-side markdown->TipTap converter + rewrite`.

### Task 5: The cross-language schema rail

**Files:** Create `convert/fixtures_gen.py` (walks a fixtures dir of inputs → writes JSON outputs to `app/src/pages/journal-2-0/lib/importer/__fixtures__/server_convert/`), generated fixtures (committed), `app/src/pages/journal-2-0/lib/importer/serverConvert.contract.test.js`.
**Interfaces:** vitest test: for every `server_convert/*.json`, `Node.fromJSON(getSchema(resolveExtensions(buildExtensions())), doc)` must not throw AND `generateHTML(doc, buildExtensions())` produces non-empty output; semantic pins: taskItem checked survives, table renders `<table>`, link marks keep hrefs. A Python test asserts fixtures_gen output is byte-stable (regeneration == committed files) so drift is visible in CI.
- [ ] Failing vitest (no fixtures yet) → generate via `python -m api.services.journal_two.note_connectors.convert.fixtures_gen` → green both sides. Mutation check: hand-corrupt one fixture node type → vitest reds → restore.
- [ ] Commit `feat(connectors): cross-language schema contract rail`.

### Task 6: Provider base + Roam provider

**Files:** Create `providers/base.py`, `providers/roam.py`, `convert/roam_text.py`; test `test_note_connectors_roam.py` (recorded-fixture httpx transport — `httpx.MockTransport`).
**Interfaces:** base: `RemoteRef{remote_id, updated_at}`, `RemoteNote{remote_id,title,doc,media,links,tags,folder_path,created_at,updated_at}`, abstract `validate/list_changed/fetch`. Roam per spec §7: token+graph validation q; enumeration q (uid,title,edit-time); `pull-many` batches of 40 with recursive selector; 308 redirect re-auth (httpx `follow_redirects=False`, manual re-send WITH Authorization); 503 cold-start retries (3, backoff); encrypted-graph → `NoteConnUnsupported`; `roam_text.py` pre-passes (code-protection first, `[[link]]`→`import-link://roam:{graph}/{resolved-uid}` via title→uid map from enumeration, `((ref))`→inline resolved text (from a uid→string map built during pull; unresolved→literal), `{{[[TODO]]}}`→`- [ ]`, `{{[[DONE]]}}`→`- [x]`, `^^x^^`→`==x==`, `attr::` line → plain) then `md_to_tiptap`. Firebase image URLs in strings → media refs (mirrored). import_key `roam:{graph}/{uid}`.
- [ ] Failing tests: enumeration+pull fixture → RemoteNotes with correct keys/docs (taskItems from TODO, link placeholder, image ref); 308 re-auth path; 503 retry; encrypted-graph error; incremental (edit-time newer than cursor only).
- [ ] Implement; pytest green; regenerate+validate rail fixtures for roam samples (Task 5 harness).
- [ ] Commit `feat(connectors): Roam provider + roam-markdown conversion`.

### Task 7: Craft provider

**Files:** Create `providers/craft.py`; test `test_note_connectors_craft.py`.
**Interfaces:** Spec §7: capability URL + Bearer (parse/normalize the pasted URL, validate via `GET /connection` then `GET /documents?fetchMetadata=true` page-1); full pull lists documents, `fetch` gets `GET /blocks?id=` with `Accept: text/markdown` → `md_to_tiptap`; incremental `lastModifiedDateGte={cursor-1h}`; folders via document folderId → folder names (folder endpoint) else flat; images in markdown → media refs (Craft-hosted URLs mirrored); self-imposed 3 rps AsyncRateLimiter; import_key `craft:{link_id}/{doc_id}`.
- [ ] Failing tests: fixture list+blocks → RemoteNotes (title/doc/folder); modified-since filter applied with overlap; bad token → NoteConnAuthError; rate limiter engaged (injectable clock).
- [ ] Implement; green; rail fixtures regenerated.
- [ ] Commit `feat(connectors): Craft provider`.

### Task 8: Sync engine

**Files:** Create `engine.py`; test `test_note_connectors_engine.py` (fake provider).
**Interfaces:** `sync_source(source_id, full=False)` — per-source `asyncio.Lock` (setdefault idiom) + 10-min cooldown (manual bypasses) + `_LOCKED_RETRY_DELAYS` on sqlite lock; `_start_log/_finish_log` bracket; flow per spec §3: list_changed(cursor-overlap) → fetch each → build confirm payload (PLACEHOLDER body, `updatedAt`=remote) → call `notes_svc.import_confirm` directly in ≤200 batches → media: download via provider (`provider.fetch_media(ref)` added to base) → `save_note_*_bytes` → `rewrite_body` → `notes_svc.update_note(bodyJson=...)`; conflict policy spec §6 (local `updated_at > imported_at` → sibling `#remote` note + `sync-conflict` tags, never overwrite); remote_index upsert + delete detection (2-strikes unseen → tag `source-deleted`, sever index row) with the <50%-enumeration refuse guard; cursor advance only on success; failures land in the log row and NEVER abort other sources (`sync_due_sources` iterates serially, exception-walled per source).
- [ ] Failing tests: initial sync creates notes+folders+media (fake provider, tmp attachment root); re-sync all-skipped; remote edit → update; local-edit conflict → sibling+tags+original untouched; delete detection 2-strikes + refuse guard; cursor overlap; cooldown; log rows accurate (status error on provider raise).
- [ ] Implement; green.
- [ ] Commit `feat(connectors): sync engine - locks, conflict policy, delete detection`.

### Task 9: Notion provider (dark)

**Files:** Create `providers/notion.py`, `convert/notion_blocks.py`, `note_connectors/oauth.py`; test `test_note_connectors_notion.py`.
**Interfaces:** oauth.py: `authorize_url(provider, state)`, `exchange_code`, `refresh_if_needed(user_id, provider)` — refresh lock-guarded per (user,provider); notion.py per spec §7 (Notion-Version 2025-09-03 header pinned; search enumeration; recursive children traversal only where has_children; data_source resolution + query for child_databases ≤50 rows→table else per-row; 3 rps bucket; 429/529 Retry-After; media downloaded during traversal, 403→refetch block); `notion_blocks.py` dispatch table per spec §4 (every listed type; `unsupported`→visible marker paragraph; synced_block cycle-guard; list grouping). `NOTION_CLIENT_ID/SECRET` absent → registry marks provider unconfigured (UI shows "not available yet").
- [ ] Failing tests: dispatch table over a fixture page covering ALL mapped types (snapshot doc); traversal recursion + pagination fixture; token refresh race (two concurrent → one refresh); incremental minute-overlap; trash sweep marks deletions; unconfigured-inert import.
- [ ] Implement; green; rail fixtures regenerated (notion samples).
- [ ] Commit `feat(connectors): Notion provider (dark) + block converter`.

### Task 10: Dropbox provider (dark)

**Files:** Create `providers/dropbox.py`; test `test_note_connectors_dropbox.py`.
**Interfaces:** Spec §7: offline OAuth via oauth.py; folder tree listing for the picker (`list_folders(path)` non-recursive); initial recursive list_folder+continue → md/txt/html files → converters (html via a minimal `html_to_tiptap` added to mddoc.py using markdown-it-py? NO — html files: strip to text-preserving minimal mapping via Python html.parser walker into TipTap paragraphs/headings/lists/links/images — keep scope minimal, note fidelity limits in code comment); non-text files ≤25MB → attachments; images → media; `content_hash` in remote_index.remote_updated_at slot for change detection; cursor persistence; 409 reset → full re-list; webhook receiver route stub in the router task (HMAC verify + enqueue account_id → set sources due-now); Retry-After honoring, 6-way bounded downloads. import_key `dropbox:{folder_id}/{path_lower}`.
- [ ] Failing tests: list+continue fixture → notes; content_hash skip; deleted tag → 2-strikes flow feeds engine correctly; 409 reset path; webhook HMAC validation (bad sig 403, good → sources marked due).
- [ ] Implement; green.
- [ ] Commit `feat(connectors): Dropbox folder-sync provider (dark)`.

### Task 11: Router + scheduler + registry wiring

**Files:** Create `api/routers/note_sync.py`, `note_connectors/registry.py`, `scheduler.py`; modify `api/main.py` (import + include_router + `NOTE_SYNC_ENABLED` block, cron minute `:23`); test `tests/test_note_sync_router.py` (TestClient + dependency_overrides pattern from tests/test_notes_import_router.py).
**Interfaces:** Endpoints per spec §8 with paid gate + consent; `GET /status` shape `{enabled, providers:{roam:{configured,connected,sources:[...]},...}}`; OAuth start/callback with signed state (itsdangerous or hmac of user_id+ts using PUSH_SECRET idiom — read how the repo signs elsewhere first: `export-token` HMAC pattern in calendar); disconnect keeps notes; manual sync `background=1` via `asyncio.create_task`. Registry maps provider name → module + configured() check. Scheduler job `note_sync_due` double-gated, `max_instances=1`.
- [ ] Failing tests: status unconfigured/configured matrix; connect roam happy (mock provider validate) + bad token 400; consent required 400; paid gate 403; callback state validation; disconnect cascade; manual sync fires engine (mocked); main.py wiring pinned by AST/route-presence tests with non-vacuity controls (the desk-audit idiom — grep `tests/test_desk_session_audit.py` for the pattern and copy it).
- [ ] Implement; green (run the full router + journal_two suites).
- [ ] Commit `feat(connectors): router, registry, scheduler wiring`.

### Task 12: ConnectedAppsCard UI + trust strip

**Files:** Create the `components/connectors/` files + `hooks/useNoteConnectors.js`; modify Settings page (mount card — find where BrokerConnectionsCard mounts and mirror) and the ImportWizard drop step (compact connect tiles above the dropzone: configured providers only) + NotebookTab (trust strip mount when sources exist); tests `ConnectedAppsCard.test.jsx` + an ImportWizard test extension.
**Interfaces:** Card states per spec §8 (upsell !isPaid; per-provider: not-configured "Coming soon" tile / Connect / Connected·sources); ConnectTokenModal (roam: graph name + token fields with the exact "Settings → Graph → API tokens" helper text; craft: paste API URL + key, "shown once" warning); OAuth providers → `window.location = redirect_url`, return-querystring handler (`?connector=notion&connected=1`) self-heals like the broker card; SourceRow (freshness tone/label, counts incl. conflicts, Sync now, pause toggle, disconnect 2-step); trust strip on NotebookTab (compact: "Roam · synced 5m ago · 2 conflicts" linking to Settings).
- [ ] Failing tests: card renders provider matrix from mocked status; token modal posts and handles 400 detail; wizard shows tiles only for configured providers; Sync-now fires endpoint; conflict count renders.
- [ ] Implement; run `cd app && npx vitest run src/pages/journal-2-0` full sweep — watch the FILE count.
- [ ] Commit `feat(connectors): Connected apps UI + notebook trust strip`.

### Task 13: Full verification + docs + live gates

**Files:** CLAUDE.md one-liner (Journal 2.0 section); no new code except gate scripts (uncommitted).
- [ ] Backend: `python -m pytest api/services/journal_two/ tests/test_note_sync_router.py tests/test_notes_import_router.py -q` — all green (report the one pre-existing coach-chat time-bomb only if still red on master).
- [ ] Frontend: full `src/pages/journal-2-0` sweep + `npm run build` — connectors code must NOT grow the main index chunk (grep dist).
- [ ] Contract rail: regenerate fixtures → vitest contract test green → `git status` proves no fixture drift.
- [ ] LIVE GATE (controller-driven, sandboxed uvicorn :8078): mock-provider end-to-end via the engine against the live server (initial sync → notes/folders/media/links correct → re-sync all-skipped → conflict + delete-detection scenarios) + on-screen Playwright pass (connect roam via token modal against a stubbed provider server, first sync, note renders, trust strip). Real-account Roam/Craft gates run at activation when the owner supplies tokens.
- [ ] Commit docs; push branch. Do NOT ship to master — final report to owner includes the activation checklist + the requirements.txt flow-watch note (`UCT_FLOW_OVERRIDE` is owner-only).

## Execution notes for the controller
- Tasks 1→5 sequential (foundations). 6/7 parallelizable after 5 (file-disjoint). 8 after 6+7. 9/10 parallelizable after 8. 11 after 9/10. 12 after 11. 13 last.
- Implementer model: sonnet for 4/5/6/8/9 (judgment-heavy), haiku acceptable for 1/2/3/7/10 transcription-leaning tasks with full briefs; reviewers sonnet; final review most-capable.
