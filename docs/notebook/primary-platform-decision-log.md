# UCT Notebook — Primary-Platform Decision Log

Durable record of major decisions across Phase Zero, the Evidence-Integrity Audit, Phase One, and Phase Two. Prevents future sessions from re-litigating resolved questions without new evidence. Each entry: decision, alternatives considered, evidence, rationale, consequences, reversibility, and what would cause reconsideration.

---

## Pre-Wave-0 Test Baseline (captured 2026-09-05, before any Wave 0 code change)

**Master reconciliation:** `origin/master`'s delta since the research baseline (`54d7de266`) is the same 8 files identified in Phase Two: this program's own account-deletion fix (`api/routers/auth.py`, `api/services/journal_two/account_purge.py`, `docs/account-deletion-manifest.md`, `tests/test_journal_two_account_purge.py` — **MATERIAL WAVE-0 IMPACT, positive: a Wave-0 security/privacy prerequisite is already satisfied**) and 4 unrelated Package-8G-B pattern-engine/screener performance files (**NO IMPACT** — zero overlap with Notebook/Journal 2.0/Compass/auth-lifecycle/search/AI/charts-widgets/Terminal/screener-scanner/company-pages/portfolio-watchlists, confirmed via `diff --stat`). Merged into `notebook-primary-platform` cleanly (no conflicts); `account_purge.py` confirmed present in the implementation tree post-merge. No Wave-0 assumption required re-verification.

**Broad regression scan** (1147 tests matched by a keyword filter across `tests/` + `journal_two/`, ~39 min): 10 failed, 2 errors, 1 skipped (a flag-off skip, working as intended), rest passed.

**Re-run in isolation (this session, before any Wave-0 change), to distinguish deterministic failures from order-dependent artifacts of the broad run:**

| Test | Broad-run result | Isolated result | Classification |
|---|---|---|---|
| `test_scan_screener_auth.py::test_a_PAID_member_still_gets_200_on_EVERY_route` | FAILED | **FAILED** | Deterministic. `TypeError: stub_services.<locals>.<lambda>() got an unexpected keyword argument 'user'` — a test-fixture stub signature mismatch in the test file itself (not app code — confirmed `stub_services` doesn't exist in `api/routers/screener.py`). Screener-specific, zero relation to Notebook/Wave 0. |
| `test_scan_screener_auth.py::test_an_ADMIN_gets_200_everywhere_including_the_refresh_route` | FAILED | **FAILED** | Same cause as above. |
| `test_scan_screener_auth.py::test_a_TRIAL_member_is_treated_as_paid` | FAILED | **FAILED** | Same cause as above. |
| `test_screener_api.py::test_saved_screens_delete_of_a_missing_or_foreign_screen_answers_404_not_found` | FAILED | **FAILED** | Deterministic. `sqlite3.OperationalError: no such table: screener_saved_screens` — a missing table in this test's own fixture setup. Screener-specific, zero relation to Notebook/Wave 0. |
| `test_alert_ledger_admission.py::test_a_USER_AUTHORED_fire_lands_ZERO_receipts_beside_a_builtin_that_lands_ONE` | FAILED | **PASSED** | Order-dependent — a known class this repo's own `conftest.py` documents extensively (e.g. the `AUTH_DB_PATH`-reload split-store defect). Not a Wave-0 concern, not introduced by this session. |
| `test_alert_user_admission.py::test_one_accounts_formula_cannot_answer_for_another` | FAILED | **PASSED** | Order-dependent, same class. |
| `test_alert_user_router.py::test_one_accounts_formula_cannot_be_armed_by_another_over_HTTP` | FAILED | **PASSED** | Order-dependent, same class. |
| `test_definition_record.py::test_BLIND_SPOT_4_a_USER_AUTHORED_fire_is_refused_FIRST_yet_the_record_has_it` | FAILED | **PASSED** | Order-dependent, same class. |
| `test_user_definition_reproof.py::test_the_QUIET_STOPS_when_the_SUPPRESSION_IS_DELETED[forming/closed]` | FAILED (×2) | **PASSED** | Order-dependent, same class. |
| `test_user_definitions_auth.py::test_the_owner_ruling_is_carried_as_a_TIER_and_the_ast_lane_is_premium` | ERROR | **PASSED** | Order-dependent, same class. |
| `test_user_definitions_auth.py::test_the_free_tier_is_EXACTLY_the_sixteen_natives_and_that_is_the_OWNER_QUESTION` | ERROR | **PASSED** | Order-dependent, same class. |

**Baseline verdict:** 4 deterministic pre-existing failures, both root-caused to test-fixture bugs in the `screener` test suite (not app code, not Notebook, not Wave 0). 8 order-dependent flakes, reproduced as passing in isolation, consistent with an already-known, already-documented test-isolation defect class in this repo — not new, not a regression, not touching any Wave-0 code path. **None of the 12 overlap, by import or reference, with `account_purge.py`, `auth.py`'s deletion endpoints, or any `journal_two`/Notebook file** (confirmed by grep before this baseline was recorded). This baseline — 4 deterministic screener failures, 8 known-flaky order-dependent tests — is what any post-Wave-0 comparison must be measured against, so a genuine Wave-0 regression is never confused with either of these two pre-existing classes, and neither is silently waved off as "pre-existing" without this record to point to.

**Addendum (2026-09-05, discovered during first post-Wave-0-code broad retest of `api/services/journal_two/`):** a 13th pre-existing, environment-dependent failure class not present in the baseline scan above because that scan didn't cover the full `journal_two/` directory (only the keyword-filtered 1147). 25 failures — `test_note_connectors_media.py` (23 of them), `test_note_connectors_engine.py::test_*` (5, all `mediaUploaded == 0` instead of `1`, because the engine's per-media-item `except Exception` swallows the same error), `test_attachment_gc.py::test_identical_image_uploads_dedupe_to_one_file`, `test_obsidian_parity_fixtures.py::test_regeneration_is_byte_identical_to_the_committed_fixtures` — all trace to `assert_import_headroom()` (`notes_quota.py`) refusing writes because this dev box's *real, live* free disk space (`C:\` — measured 2026-09-05: ~42GB free) has dropped below the quota reserve threshold (~49.9GB) since the original baseline capture. **Reproduced identically with every Wave-0 change stashed** (`git stash` to the pre-Wave-0 commit, reran the same 25 tests, same 25 failures, same assertion) — confirmed NOT a Wave-0 regression before being recorded here. No code or test was changed for this class; it is a genuine machine-state fact (disk fill on `C:\`), not a defect, and will self-resolve when free space rises back above the reserve. `test_save_note_attachment_stores_and_caps` (in `test_notes_import.py`, already deselected in the Wave-0 unit-test reruns) is the same root cause. Any future run on this box should expect this class to reappear until disk space is freed; it is orthogonal to and must never be conflated with a real Wave-0 regression.

---

## Wave 0 Implementation Progress (updated as slices land — not a per-decision entry)

**Baseline commit:** `6771c3105` (docs: pre-Wave-0 test baseline + master-reconciliation record). **Working tree:** uncommitted (backend slice below not yet committed). **origin/master:** unchanged since the Pre-Wave-0 reconciliation above — no new upstream commits landed during this slice.

**Authoritative Wave 0 scope** (`primary-platform-implementation-plan.md` §3, "Wave 0 — Trust Foundation"): note trash + undo-delete (P0-1); folder-sidebar correctness fix (P0-2); search read-latency benchmark (verification only); local draft safety net (P1-10, pulled forward). Non-goals: version history (Wave 9), bulk-restore UI polish.

### Slice 1 — Backend: soft-delete/restore/purge (P0-1) + folder-count/by-folder reads (P0-2) — BACKEND COMPLETE, frontend NOT started

**Implemented:**
- `j2_notes.deleted_at` column (idempotent ALTER) + covering index.
- `notes.py`: `delete_note` rewritten soft (embeds preserved for restorability); new `restore_note`; new `purge_expired_deleted_notes` (real hard-delete, cross-user system sweep, `TRASH_RETENTION_DAYS=30`); new `register_trash_purge_job` (03:20 ET daily, **on by default** — the one deliberate exception to this codebase's usual dark-by-default convention, because the retention promise is unfulfilled without it); new `folder_note_counts` + `notes_for_folders` (the P0-2 fix — replaces `FolderSidebar.jsx`'s capped-100-row-derived `hasChildren`/leaf-row logic with real server-side counts, mirroring the already-proven `unfiledTotalFromServer` pattern).
- Full cross-file `deleted_at` audit across every `j2_notes` query site in `journal_two/` (`_notes_filter_sql`/`list_notes`/`count_notes`/`get_note`/`update_note`/`append_widget_embed`/`tag_counts`/`get_symbol_backlinks`/`import_check`/`import_confirm`/`note_shares._owned`/`enrichment.scan_notes_for_tickers`/`notes_export`'s export query/`note_connectors/engine.py`'s import-key lookup) — each fixed with a stated reason, or (one case, `attachment_gc.py`'s reference scan) deliberately left unfiltered with a comment explaining why filtering it would break restore.
- New router endpoints: `POST /notes/{id}/restore`, `GET /notes/folder-counts`, `GET /notes/by-folders?ids=&limit=`; `DELETE /notes/{id}` docstring updated (soft, not hard); `GET /notes` gained `deleted: bool = False`.
- `main.py`: scheduler registration for the trash-purge job, mirroring the existing `attachment_gc.register_jobs` convention.

**Residual scope explicitly deferred (not silently dropped):** `note_connectors/engine.py` has 6 more `j2_notes` queries (two tag-housekeeping lookups, one sibling-note conflict-resolution lookup, three `id IN (...)` lookups on already-resolved id sets) not filtered on `deleted_at` — judged lower-stakes than the one fixed (the import-key resurrection path), flagged here for a future pass rather than left unrecorded.

**Test evidence:**
- New unit tests: `test_notes_trash.py` (21 tests — delete/restore lifecycle incl. double-delete/restore-twice/cross-user isolation, `purge_expired_deleted_notes` retention-boundary + cross-user sweep, `folder_note_counts` + `notes_for_folders` incl. the >100-row case the P0-2 fix exists for, `get_symbol_backlinks` agreement with the `embed_symbol` list filter across delete/restore, `tag_counts` exclusion).
- Extended `test_notes.py` with 6 router-level tests (soft-delete→restore round trip via HTTP, restore-of-never-deleted 404, delete-of-missing 404, folder-counts endpoint, by-folders endpoint, empty-ids no-op) reusing the existing `route_client` fixture, and rewrote `test_update_note_resyncs_and_delete_cleans_sidecar` (asserted hard-delete-clears-embeds immediately, now false by design) into two tests: `test_update_note_resyncs_sidecar` (unchanged assertion, renamed) + `test_soft_delete_preserves_embeds_purge_clears_them` (embeds survive `delete_note`, only `purge_expired_deleted_notes` clears them) — an intentional contract change, not a regression.
- Extended `test_note_shares.py` (+2: a trashed note can't be newly shared; an existing share stops resolving once its note is trashed and resumes once restored — revoke is final, soft-delete is not) and `test_enrichment.py` (+1: a trashed note is never offered a ticker-embed suggestion).
- Fixed `test_notes_import.py`'s `conn` fixture: was a hand-rolled partial replica of `ensure_schema()` (`executescript(_J2_SCHEMA)` + `run_notebook_migration_v2` only) that silently skipped `_PHASE_2_ALTERS` — the source of 15 of the first 17 failures this slice's schema change produced. Fixed by calling the real `ensure_schema()` instead, closing this drift class permanently rather than patching around it.
- **Full `api/services/journal_two/` suite: 1901 passed, 26 failed (0 new).** The 26 are a confirmed pre-existing, environment-dependent class (real free disk space on this dev box, ~42GB, now below the `notes_quota.py` reserve threshold, ~49.9GB) — reproduced identically with every Wave-0 change stashed back to baseline commit `6771c3105` before being classified. Not a Wave-0 regression; see the Pre-Wave-0 baseline addendum above for full detail. 30 net-new tests added this slice, all passing.

### Slice 2 — Frontend: trash UI (P0-1) + folder-sidebar honest counts (P0-2)

**Implemented:**
- `hooks/useJ2Notes.js`: `deleted` param threaded through `buildNotesUrl`/`useJ2Notes`/`loadMore`; two new hooks, `useJ2NoteFolderCounts` (wraps `GET /notes/folder-counts`, `counts` deliberately `undefined` — not `{}` — while loading, mirroring the existing "unknown vs. known-empty" convention `total` already uses elsewhere in this file) and `useJ2NotesByFolders` (wraps `GET /notes/by-folders`, keyed on the sorted-joined id list so click order never fragments the SWR cache).
- `FolderSidebar.jsx`: a "Trash" row (mirrors "Unfiled"'s honest-count idiom, `deleted:true` + `limit:1`) routing through the existing `onSelectFolder('__trash__')` sentinel channel — no new selection mechanism. `FolderNode`'s `hasChildren`/leaf-row derivation now prefers the honest `folder_note_counts`/`notes_for_folders` data over the old capped-page-derived `notesByFolder`, falling back to the page-derived guess only during the brief window before the honest data has loaded (same "prefer honest, fall back while unknown" pattern as the existing Unfiled/tag-cloud fixes) — this is the actual P0-2 fix.
- `NotebookTab.jsx`: `isTrashView = folderId === '__trash__'` drives the main `useJ2Notes` call (`deleted:true`, folder/tag cleared, sort forced to `'deleted'` — `list_notes`'s dict-lookup only defaults to `deleted_at DESC` when `sort` is unrecognized, and the toolbar's own default `'updated'` IS recognized, so this had to be explicit or the trash view would silently sort by `updated_at`); new `restoreNote` handler (`POST /notes/{id}/restore`); trash-specific empty state ("Trash is empty"); new notes created while viewing trash never inherit the `__trash__` sentinel as a folder id.
- `NoteCard.jsx`: a trashed-note variant (`onRestore` prop) — inert (not a click-to-open button, since opening a trashed note 404s by design) with an explicit Restore action, instead of trying to nest a button inside a button.
- `NoteEditorPage.jsx`: the delete-confirm copy corrected from a bare "Delete this note?" to state the real, now-restorable contract ("...You can restore it from Trash for 30 days.") — a member's mental model must match the product's actual behavior. (Distinct from, and did not touch, the CaptureInboxTray's own unrelated "unrecoverable" delete, which is a real hard-delete on a different feature.)

**Test evidence:** `FolderSidebar.test.jsx` +8 (P0-2 fix: honest count wins over an empty/stale loaded page and vice versa, page-derived fallback while loading, real per-folder note list on expand overriding a stale page note, sorted stable cache key for expanded-ids; Trash row: honest count, `__trash__` routing, no false-zero while loading, active-state highlight) — mock factory extended to stub the two new named hook exports. `NotebookTab.test.jsx` +4 (trash-view fetch shape, empty-trash copy, restore round trip incl. the real `POST .../restore` call + refresh, exiting trash via Clear filter) — `FolderSidebar` mock extended to forward `onSelectFolder` (mirroring the existing `ImportWizard` interactive-stub pattern), `NoteCard` mock extended to forward `onRestore`. Full `journal-2-0` frontend suite: **153 files / 1412 tests passing, 0 failures.**

**Full-repo frontend suite (`npx vitest run`, all ~1000 files):** 6 pre-existing failures, confirmed unrelated — `hooks/pollingSites.rail.test.js`, `utils/jsonFetcher.test.js` (breadth analytical-lenses rails), `components/screener/reachable.test.js` (scoped to `components/screener/**` per its own design, per this repo's CLAUDE.md), `components/chart/builder/ImportBox.thinkscript.test.jsx`, `components/chart/engine/ast/{manifestProse,pine.blindCorpus}.test.js` (chart-builder/Pine-parity rails — Pine parity has a documented ceiling of 17/21 per user memory). Zero overlap confirmed via `git diff --stat` against every one of these paths — none touched by this session's changes. Not a Wave-0 regression.

### Slice 3 — Frontend: local draft safety net (P1-10)

**The gap:** the network autosave is debounced 800ms behind the last keystroke (`AUTOSAVE_MS`), with a further exponential backoff on transient failure. A tab closed, crashed, or the machine losing power/network inside that window never runs React's unmount cleanup (which only fires on in-app SPA navigation anyway) — so everything typed since the last successful `PUT` is gone.

**Implemented (`NoteEditorPage.jsx`):** every edit (title/subtitle onChange, TipTap `onUpdate`) synchronously mirrors `{title, subtitle, bodyJson, savedAt}` to `localStorage` under `uct.j2.notedraft.<noteId>` — BEFORE the 800ms network debounce, not gated on it, so no keystroke is ever unprotected. `title`/`subtitle` are read through refs kept in sync directly inside the onChange handlers (not via a `useEffect` on the state, and not the state itself) so the draft write is never one keystroke stale relative to React's batched setState. On note load, a draft that genuinely differs from the server's copy is offered via a non-blocking banner (Restore / Discard) — never auto-applied, since silently preferring a local draft over the server's copy could just as easily clobber real, already-synced work from another tab/device. A draft that matches the server's content is treated as "saved fine" and self-heals (removed) rather than surfacing as noise. The local copy is cleared the moment any real network save actually lands — it is a safety net, never a second source of truth. Restoring re-applies the draft to the editor/title/subtitle and immediately schedules a real save.

**Test evidence:** new `NoteEditorPage.draft.test.jsx` (7 tests, driving the REAL TipTap editor, no mock — matching this file's existing `NoteEditorPage.rails.test.jsx` convention): no banner on a clean note; a keystroke writes the local draft before the network debounce fires at all; a successful save clears it; a stale draft that differs from the server offers Restore/Discard; an identical draft is silently self-cleaned with no banner; Restore applies the draft and schedules a real save with the recovered content; Discard clears the draft and leaves server content untouched. Existing `NoteEditorPage.rails.test.jsx` + `.video.test.jsx`: unaffected (5/5 still pass). Full `journal-2-0` suite: **154 files / 1419 tests passing, 0 failures** (up from 153/1412 — +1 file, +7 tests, matching this slice exactly).

### Slice 4 — Search/folder-count read-latency benchmark (VERIFICATION ONLY — no code changes)

Per the plan's Performance gate ("benchmark FTS5 read path at 5k/20k/100k... before declaring search 'proven at scale'") and the directive's explicit instruction not to generate a performance claim from trivial fixtures. `tools/notebook_scale_benchmark.py` seeds a REAL SQLite file (via `ensure_schema` + the real FTS5 triggers — a bulk raw `INSERT` still fires `AFTER INSERT ON j2_notes` identically to `create_note()`, so the FTS index it produces is byte-for-byte what production builds) at 100 / 1,000 / 10,000 / 50,000 notes, with a realistic shape: one "catch-all" folder holding ~15% of the library (the exact shape of the P0-2 defect), varied tags/tickers, ~10% of notes carrying a chart embed, and real trading-journal-style body text with an injected common term (~30% of notes) and a rare term (exactly 1 note) for FTS measurement. Every tier also runs 6 CORRECTNESS assertions (whole-library count matches the seed, the heavy folder's honest count matches what was actually seeded, `notes_for_folders` returns the folder's true size rather than a capped page, FTS list/count agree, the rare term finds exactly the one note, backlinks count matches the seeded embed rows) — a fast wrong answer is not a pass.

**Result: all 4 tiers, all correctness checks passed.** Honest latency (ms), this dev box:

| Operation | 100 | 1,000 | 10,000 | 50,000 |
|---|---|---|---|---|
| `list_notes` (page 1, default sort) | 2.3 | 1.3 | 1.4 | 1.4 |
| `count_notes` (whole library) | 0.04 | 0.05 | 0.4 | 1.9 |
| `list_notes` (FTS, common term ~30%) | 0.7 | 2.2 | 8.6 | 36.2 |
| `count_notes` (FTS, common term ~30%) | 0.2 | 1.0 | 16.2 | 88.5 |
| `list_notes` (FTS, rare term, 1 note) | 0.1 | 0.5 | 8.6 | 44.3 |
| `folder_note_counts` (whole library) | 0.06 | 0.25 | 16.4 | 92.3 |
| `notes_for_folders` (heavy + 2 others) | 0.6 | 3.8 | 22.1 | 91.8 |
| `get_symbol_backlinks` | 0.2 | 0.4 | 6.5 | 52.4 |
| `tag_counts` (whole library) | 0.2 | 1.0 | 14.2 | 78.1 |

**Reading it honestly:** `list_notes`'s default (unfiltered, paginated) path is flat across every tier — it's an indexed `ORDER BY ... LIMIT 100` and scales the way a member's actual "open the Notebook" load does. Everything else (FTS search, `folder_note_counts`, `notes_for_folders`, `tag_counts`, `get_symbol_backlinks`) grows with library size and is clearly super-linear between 10k and 50k, landing in the **40–92ms range at 50,000 notes** — noticeable but not alarming for what are session-cached, once-per-load fetches (SWR caches `folder_note_counts` and the tag cloud after first fetch), not per-keystroke costs. **Flagged, not fixed (out of this task's verification-only scope):** `folder_note_counts` and `notes_for_folders` both filter/group on `(user_id, folder_id, deleted_at)` with only `idx_j2_notes_user_deleted` (`user_id, deleted_at`) to lean on — no index covers `folder_id` — which is the most likely explanation for their super-linear growth; an index on `j2_notes(user_id, folder_id)` would be the obvious next step if a future wave needs snappier behavior at 50k+ notes or wants to support noticeably larger libraries (100k+). Not built now, per this task's explicit verification-only scope. Peak traced Python memory stayed under 1.2MB at every tier (not a concern at this scale). Full machine-readable report + the script are committed for re-running against any future change.

### Slice 5 — Real member-facing E2E (sandboxed local server, browser-driven) — found + fixed 2 real defects

Ran against a SANDBOXED local dev server (isolated `DATA_DIR`/`AUTH_DB_PATH`, confirmed via a fresh `auth.db` and a near-zero server uptime before use — this box's port 8077 already holds an unrelated stale backend per this repo's own documented lesson, so a different port + fully separate data directory were used) with a real admin test account, real browser clicks (no mocks), driving the actual built frontend.

**P0-2 verified end-to-end:** seeded 110 alphabetically-first filler notes (filling the entire old 100-row global-alphabetical page) + 150 alphabetically-last notes in one folder — reproducing the exact pre-fix defect shape. The folder correctly showed a disclosure arrow and expanded to its real notes; `folder_note_counts`/`notes_for_folders` confirmed working through the real UI, not just via API/unit tests.

**P0-1 verified end-to-end, plus one real defect found and fixed:** create → delete → appears in Trash with a Restore button (not click-to-open) → restore → reappears with exact title intact, all through real clicks. **Found:** the sidebar's Trash badge count did not update live after a delete/restore in the same session (a separate SWR cache entry inside `FolderSidebar`, invalidated by nothing outside it) — a real discoverability gap this verification step exists to catch, not something any unit test would have surfaced (they mock the hooks). **Fixed:** `NotebookTab.jsx` gained `refreshSidebarCounts()` (a key-predicate `swr` global `mutate` over anything under `/api/j2/notes`), called from `closeNote()` and `restoreNote()`. Re-verified live in the browser: badge now updates immediately on both delete and restore, no reload needed.

**P1-10 verified end-to-end, plus one real defect found and fixed (root-caused, not papered over):** typing correctly wrote a local draft before the network debounce could fire (confirmed by blocking `fetch` and inspecting `localStorage` directly); reloading with the network still blocked correctly showed the recovery banner with the right content. **Found:** clicking "Restore" intermittently (reproduced in roughly half of ~10 real-browser attempts) saved an EMPTY title instead of the recovered draft — the very thing the safety net exists to prevent, silently defeated on its own recovery action. Root-caused via targeted instrumentation (not guessed): a single click was firing the handler TWICE in quick succession, both invocations reading the same still-non-null `pendingDraft` before React committed the first call's `setPendingDraft(null)` — two concurrent PUTs racing over the network. **Fixed** with a re-entrancy guard (`restoringDraftRef`) in `restoreDraft`, plus rewriting it to persist directly and immediately (bypassing the debounced `scheduleAutosave` path entirely, which is designed for casual per-keystroke saves, not a one-shot deliberate action). Re-verified: 3 consecutive clean real-browser trials after the fix (vs. failing roughly half the time before it). Added a mutation-checked regression test (`NoteEditorPage.draft.test.jsx`, two synchronous `.click()` calls reproducing the same-tick double-invocation shape) — confirmed RED with the guard removed, GREEN with it restored.

**Both fixes committed together** with the E2E session that found them; full `journal-2-0` suite re-confirmed green after each (154 files / 1420 tests, +1 from the new regression test).

**Not yet done:** the full adversarial matrix from the directive (double-delete via direct API replay, folder-deletion interaction with trashed notes, multi-user isolation) — the delete/restore/draft-recovery lifecycle itself is now proven correct through the real UI, but these specific adversarial variants weren't separately exercised this session; discoverability verification (two-rail: route/AST reachability + unmocked mount) for the new Trash entry and restore actions; deploy; production verification; the final Wave 0 certification report.

---

### 2026-09-05 — North star narrows from "primary notebook" to "financial research system of record"

**Decision:** UCT Notebook's immediate ambition is to be the best financial research/knowledge system for active traders first, used *alongside* a member's general notebook — not a Notion/Evernote/Obsidian replacement.
**Alternatives:** (a) full incumbent replacement as originally briefed ("Notion + Evernote + Obsidian + UCT Financial Intelligence"); (b) the narrower system-of-record framing adopted.
**Evidence:** Phase Zero's own §1 executive framing already argued for (b) ("win on the one axis none of the three can structurally match") while §33's proposed end state reverted to (a) without re-deriving it — an internal inconsistency. Supporting evidence: the Obsidian trust bar is conceded unclearable by policy alone; offline is downgraded; note content is plaintext server-side; the Do-Not-Build list (clipper, plugin marketplace, team collaboration, full graph) is only coherent under (b).
**Rationale:** (b) is a cheaper trust claim to earn (a bounded, financial-tagged slice vs. the whole vault), makes the Do-Not-Build list durable rather than provisional, and increases rather than decreases the value of the closed migration/connector program's bidirectional sync work.
**Consequences:** Stage C's definition of "Primary Notebook Ready" explicitly allows a hybrid outcome (UCT for financial captures, incumbent retained for everything else) as success, not failure. Migration-trust UX rescopes from "prove your whole vault survived" to "prove the financial notes are trustworthy."
**Reversibility:** Reversible — nothing in the Stage A/B build list forecloses later full-replacement ambition; it's a positioning and prioritization choice, not an architectural one.
**Reconsider if:** Stage C evidence shows the beachhead persona spontaneously wants full displacement and the trust/parity bars needed to support it are cheap to add.

---

### 2026-09-05 — Stage C sharpened: optional continued incumbent use ≠ required incumbent use due to a capability gap

**Decision:** Refine (not reverse) the Stage C definition set by the entry above. Stage C — "Primary Notebook Ready" — means a target financial member does not *need* Notion/Evernote/Obsidian for their important, in-scope daily/research workflows. A member's optional, chosen continued use of an incumbent for out-of-scope workflows (general note-taking, unrelated projects) remains a legitimate permanent outcome. A member's *required* return to an incumbent because UCT genuinely cannot do an in-scope, named target-persona workflow is **not** Stage C for that workflow, regardless of how much other work has shipped.
**Alternatives:** Leave the original entry's "hybrid outcome... as success" language unqualified, which risked being read as license to treat any and all continued incumbent dependence — including on workflows this program explicitly researched and named as in scope — as an acceptable permanent end state.
**Evidence:** No new research evidence — this is a strategic-intent clarification, requested explicitly to prevent the roadmap from optimizing around permanent coexistence rather than treating coexistence as the *initial* adoption strategy on the way to a higher bar.
**Rationale:** The original entry's narrowing (system-of-record over full-replacement as the *initial* strategy) remains correct and is not reversed here — Stage B is still the right place to earn adoption first. What was underspecified is the ultimate Stage-C quality bar: "used alongside" must not quietly become "permanently dependent on the incumbent for something we should have built." Distinguishing optional-out-of-scope-use from required-in-scope-gap-use closes that ambiguity without reopening the beachhead or Stage-B decisions.
**Consequences:** `primary-platform-master-product-spec.md` §1, §2 (Constitution item 15), and §4.3 updated with this distinction. No change to Stage A or Stage B scope, build lists, or sequencing — this affects only how Stage C's exit evidence is judged, later.
**Reversibility:** Fully reversible — a definitional sharpening, not an architectural or roadmap change.
**Reconsider if:** never expected to reverse; could be further refined if real Stage-C evidence surfaces a target workflow this program never researched and therefore never scoped as "in scope" in the first place — that would be a scoping question, not a reason to relax the optional/required distinction itself.

---

### 2026-09-05 — Beachhead persona: active/swing trader, not four co-equal personas

**Decision:** The active/swing trader already inside Journal 2.0 + Compass + broker sync is the primary beachhead. Fundamental investor and PM-of-own-capital are secondary (alongside model). Professional analyst/institutional PM are deferred.
**Alternatives:** Treat all four Phase Zero personas (trader, fundamental investor, professional analyst, PM) as co-equal v1 targets.
**Evidence:** Direct, file:line-verified inspection: Notebook's 8 templates are entirely trader-ritual-shaped (zero fundamental-research templates); Compass's 10-category onboarding taxonomy uses trading-specific vocabulary throughout; the entire Compass coaching layer (28+ tools) models a trading-discipline coach; `j2_notes` has one entity field (a single `ticker` column), inadequate for a fundamental investor's coverage-universe/comps needs.
**Rationale:** The product's existing architecture already picked a persona — building toward four different structural needs (trading-discipline coaching vs. relational databases vs. team/compliance vs. portfolio risk) with one editor, one entity model, one AI grounding design would dilute all four.
**Consequences:** Stage A/B build lists are scoped to what serves the trader persona first; fundamental-investor value comes via capture/connector bridges into their real vault, not native Notebook features competing with Notion databases.
**Reversibility:** Reversible at the margin (secondary personas can be promoted later) but the initial engineering investment (templates, onboarding, entity model) is trader-shaped and would need real rework to re-center.
**Reconsider if:** real signup-source/usage data shows meaningful fundamental-investor or professional-analyst adoption independent of this program's own trader-first design choices.

---

### 2026-09-05 — Professional-analyst/PM persona deferred, not researched further, pending two unresolved questions

**Decision:** Do not invest further roadmap weight in the professional-analyst/institutional-PM persona until (a) whether their real competitive set is Notion/Evernote/Obsidian at all (vs. Excel/Bloomberg/FactSet/internal wikis) is resolved with real data, and (b) an employer-compliance question (can this persona put firm research in a personal SaaS tool at all?) is answered.
**Alternatives:** Continue treating this persona's Notion/Evernote/Obsidian switching-blocker analysis as directly applicable without checking either premise.
**Evidence:** New evidence gathered during Phase One (a Notion Marketplace niche of retail/prosumer "Equity Research Command Center" templates; Obsidian trading-journal plugins aimed at swing traders) skews the whole research program's competitive evidence toward the retail/prosumer end of the stated persona list, leaving the professional half's actual competitive set unexamined. The employer-compliance question was never raised in Phase Zero at all.
**Rationale:** Both questions are answerable-only-with-real-data or a compliance opinion, not more competitive research — continuing to build toward this persona without answering them risks building for a switching decision that isn't actually available to make (if firm compliance forbids it) or against a competitor that isn't actually the right one (if the real competitive set is Bloomberg/FactSet).
**Consequences:** No professional-analyst-specific features are scheduled in Stage A or B.
**Reversibility:** Fully reversible — this is a research/investment gate, not an architectural exclusion.
**Reconsider if:** signup-source data shows this persona already exists in UCT's base at meaningful numbers, or a compliance answer removes the employer-permission concern.

---

### 2026-09-05 — Trading Journal object model rejected outright, replaced with a link layer

**Decision:** Do not build a new Trading Journal object model inside Notebook. Journal 2.0's existing trade/position/verdict/review/intervention system (broker-synced, AI-coached) is authoritative; Notebook links to it.
**Alternatives:** Build the originally-proposed model (Trade → Thesis note → derived Position → Catalyst tags → Chart snapshots → post-exit Review note), benchmarked against TradeZella/Edgewonk/TraderSync.
**Evidence:** Direct schema/code verification: `j2_trades`/`j2_positions` (broker-synced, holdings-as-truth), `j2_verdicts` (structured pre-trade rationale), `j2_trade_reviews` (AI post-mortem), `j2_interventions` (4 live tilt rules) already ship every proposed component, more integrated than the cited external competitors, one tab from Notebook in the same shell (`JournalTwoRoot.jsx`). Phase Zero's own research never checked this — it benchmarked only external tools.
**Rationale:** Building any of these a second time would be a direct instance of this codebase's own named "second-authority-over-one-value" defect class. The only genuinely missing piece is a pre-trade Thesis note with no existing analog.
**Consequences:** The former large P1 "Trading Journal object model" item shrinks to a small link/cross-nav wave (implementation plan Waves 3 + 7).
**Reversibility:** The decision not to duplicate is effectively permanent (reversing it would require deliberately creating the duplication this decision exists to avoid). The link-layer implementation itself is normal, reversible feature work.
**Reconsider if:** never, absent a fundamental restructuring of Journal 2.0 itself that this program does not control.

---

### 2026-09-05 — "Ask My Notebook" splits into three tiers, only the first is P0

**Decision:** Ask Current Note is the true P0. Ask Notebook (corpus-wide) is P1. Ask Notebook + UCT (mixing personal notes with vendor data) is an Experiment, gated on the external legal review.
**Alternatives:** Keep the single P0-6 item as originally scoped, even after Appendix C's tenant-isolation correction.
**Evidence:** Two independent arguments converged: (1) Phase Zero's own persona-rejection research (§13/§23/§24) never names absent note-AI as a first-30-minutes or first-week switching blocker for any persona — the P0 placement traced to a competitive-parity argument, not the "foundation/switching-blocker" test the P0 tier itself claims to use; (2) the engineering shape of the corpus-wide version (new index, cost/latency budget, tenancy that must be proven, not just designed) doesn't match the "cheap, low-risk" shape every other P0 item has.
**Rationale:** A P0 in a foundation wave should be cheap and low-risk by definition; Ask Current Note is that shape (a copy of an already-proven pattern, zero new leak surface) and Ask Notebook is not.
**Consequences:** Implementation plan Wave 2 (Ask Current Note) ships in Stage A; Wave 6 (Ask Notebook) is Stage B, sequenced after the entity layer and fact ledger it depends on.
**Reversibility:** Fully reversible — a priority/sequencing call, not an architectural one.
**Reconsider if:** real usage data from Stage A shows members specifically asking for cross-note AI before other Stage-B work is ready — would argue for resequencing, not for abandoning the tiering itself.

---

### 2026-09-05 — Entity/mention model: three-tier CONFIRMED/STORED/SUGGESTED, stored join not a graph

**Decision:** Formalize the already-organically-converged-on model (explicit author tag = CONFIRMED; accepted embed = STORED; scanned-but-unconfirmed mention = SUGGESTED) as deliberate policy. Store the ticker↔note relationship as a committed join table, never a live-rescanned index or a general knowledge graph.
**Alternatives:** Fully automatic tagging (rejected); a derived/rescanned-at-read-time index (rejected); a general graph database (rejected).
**Evidence:** `/buzz`'s own documented history shows recall-biased auto-detection is correct for a public board and would be wrong once auto-committed to a personal note (a missed suggestion costs nothing; a wrong confirmed tag is real annoyance). A live-rescanned index would drift under universe churn (delistings/renames — UCT's own Model Book feature hit this exact problem independently for SQ→Block, WTW→Willis Towers Watson).
**Rationale:** Confirmed/hybrid for anything persisted, suggested/recall-biased for the detection pass feeding it — exactly what's already built, just never named as policy. A stored join is temporally stable by construction; a graph is unneeded complexity for a one-hop (plus theme) retrieval need.
**Consequences:** No graph-database investment anywhere in this program. The remaining build (implementation plan Wave 1) is a small extension, not new architecture.
**Reversibility:** Reversible in principle (nothing prevents a future graph layer) but the committed-join design is load-bearing for the reverse-index and would need real migration work to replace.
**Reconsider if:** real usage shows demand for multi-hop queries (e.g., "companies in the same supply chain") that a one-hop ticker/theme join genuinely cannot answer — tracked as the already-existing "full multi-hop knowledge graph" Experiment item, not reopened here.

---

### 2026-09-05 — Temporal semantics: explicit four-state contract, not "freeze everything"

**Decision:** Every financial content type is classified LIVE / SNAPSHOT / LIVE+ORIGINAL-SNAPSHOT / REFERENCE-ONLY, per an explicit governing test (safe to re-fetch live only when the source has a genuine point-in-time query).
**Alternatives:** A blanket "freeze everything at insert" rule, as an early framing of the moat implied.
**Evidence:** Direct verification: charts are already correctly hybrid (frozen anchor + capped live opt-in, per-timeframe reconstruction ceiling); watchlist/scanner are correctly full-freeze (re-running would silently change which tickers even appear — verified as already the right call, not reopened); analyst estimates have **no capture path at all** today (inverting the "highest-danger block" framing from "harden existing" to "build new"); the Calendar embed has a real, live, previously-unflagged bug (`reconstructable: true` unconditional, wrong for a pre-event capture reopened after the event resolves).
**Rationale:** A single blanket rule would either over-freeze content that should legitimately stay live (making the product feel stale) or under-freeze content that must never silently rewrite a member's historical decision context (corrupting the core trust claim). The four-state model, with an explicit test, generalizes correctly to every content type examined so far.
**Consequences:** Implementation plan Wave 5 builds the analyst-estimates capture path as new work (not a hardening task) and fixes the Calendar bug as a small, scoped, isolated change.
**Reversibility:** The model itself is durable; individual content-type classifications can be revisited as new types are added.
**Reconsider if:** a future content type doesn't cleanly fit one of the four states — extend the model deliberately rather than forcing a fit.

---

### 2026-09-05 — Provenance: object-level, extending an existing idiom, not a new system

**Decision:** Provenance is stamped at the object level (an attrs bag, by the mechanism that inserts content) — not block-level prose tagging, not citation-level inline markup, not a single note-level field.
**Alternatives:** Citation-level inline markup (Notion Research-Mode style); block-level tagging of arbitrary prose spans.
**Evidence:** Three independent existing precedents at this exact granularity: `widgetEmbed` attrs (`mode`/`captured_at`), `j2_chat_messages.role`, `modelbook_catalysts.source`. No block-level precedent anywhere in the codebase.
**Rationale:** The work is extending an idiom to two more insertion paths (quoted excerpts, AI synthesis), not designing a new system. Citation-level markup would fight the "quick jot" UX principle and has no existing infrastructure to build on.
**Consequences:** No new provenance system to design or maintain; citations belong specifically inside an Ask My Notebook answer's rendering, not the note body.
**Reversibility:** Reversible in principle; low cost either way since the extension is small.
**Reconsider if:** a future capability (e.g., multi-source AI synthesis spanning many cited passages) genuinely needs finer granularity than one object-level attrs bag can express.

---

### 2026-09-05 — Search evolution: lexical+entity before semantic/vector, evidence-gated

**Decision:** Vectors are the last stage of search evolution (implementation plan Wave 4 → 6 → Experiment), built only once usage telemetry shows lexical+entity actually fails a measurable fraction of real queries.
**Alternatives:** Build semantic search early/in parallel with lexical improvements, as an implicit assumption in some framings.
**Evidence:** FTS5 already works and is comfortably within RAIL/Nielsen targets for search-as-you-type; a trader/analyst's actual retrieval habit is entity- and time-anchored ("what did I write about NVDA," "before the Fed meeting"), which lexical+entity answers directly and cheaply; the narrower residual class vectors solve (queries with no shared vocabulary or named entity) is real but unproven to be common.
**Rationale:** Building embedding infrastructure ahead of measuring whether the cheaper layer has a real gap is exactly the kind of premature investment this program's evidence-integrity discipline exists to prevent.
**Consequences:** No vector-database work scheduled in Stage A or B; Wave 4's read-latency benchmark is the actual gating measurement.
**Reversibility:** Fully reversible — a sequencing decision.
**Reconsider if:** the Wave 4 benchmark or post-launch telemetry shows lexical+entity failing a measurable, real fraction of queries.

---

### 2026-09-05 — Thesis model: note + tag + read-time diff view, no new object

**Decision:** Thesis is a `j2_notes` row tagged `"thesis"` with ordinary body content for substantive fields, citing `j2_verdicts` as an evidence source, with "what changed" computed as a read-time diff over the fact ledger — not a new `j2_theses` table.
**Alternatives:** A dedicated first-class Thesis object/table with structured fields.
**Evidence:** A dedicated table would contradict the Core UX Constitution principle (every structural concept is opt-in scaffolding on a plain note, never a mandatory form). `j2_notes` has no properties/custom-fields system today, and `j2_verdicts` already covers "structured, AI-assisted trade rationale" — a naive Thesis object would re-plow that ground.
**Rationale:** The smallest architecture that supports every required capability (history via version history, assumptions/evidence as body content, diff as a query, AI analysis as a tag-filtered retrieval slice) without new storage.
**Consequences:** No properties-engine investment; the `tags: ["thesis"]` convention reuses an idiom already shipped for `"quote"`.
**Reversibility:** Reversible — a heavier object model could be introduced later if real usage demands structured fields a tag+prose model can't express.
**Reconsider if:** members consistently need to query/filter on structured thesis fields (e.g., "all theses with risk X") in ways prose content can't support well.

---

### 2026-09-05 — Account-deletion purge: fixed and deployed, not merely scheduled

**Decision:** Fixed a live data-lifecycle defect (none of 60+ `j2_*` tables were reachable by the generic account-deletion cascade) via a new, bounded `account_purge.py` module, on its own branch off current `master` (not the pinned research branch), merged and pushed directly to `master` given `master` was already checked out in another worktree.
**Alternatives considered and rejected:** (a) add real database-level foreign keys to every `j2_*` table (rejected — requires a full-table-rebuild migration in SQLite for existing tables, out of the explicitly bounded scope, and broader than the fix needs to be); (b) fix only Notebook-specific tables and leave the broker-purge gap (9 of 14 `j2_broker_*` tables also missed) for later (rejected — same shape of defect, same fix mechanism, cheaper to close both at once than to reopen this work later).
**Evidence:** Independently re-verified by executing the actual schema (zero `REFERENCES users`/`FOREIGN KEY` declarations across the family) and the actual cascade-discovery query, in an isolated sandbox, before writing any fix. A comprehensive, schema-driven regression test proven discriminating (red pre-fix via monkeypatch, green post-fix).
**Rationale:** This is a present-tense compliance/data-lifecycle exposure, not a roadmap item — it does not wait for the Notebook program's normal sequencing, and every new capture surface this program ships compounds it if left unfixed.
**Consequences:** Trust principles (Constitution §2 item 5) and Stage-A entry criteria now reflect this as done. `account_purge.py`'s table list becomes the enforcement point for every future `j2_*` table — a structural requirement (architecture §3.4, §20) that any new table must be added to it in the same commit that creates it.
**Reversibility:** The fix itself is a normal, revertible code change (two call sites + one new module). The underlying compliance exposure it closes should not be reintroduced — any future table added to the schema without corresponding purge coverage silently reopens it.
**Reconsider if:** never, as a direction — only extend coverage (never remove it) as the schema grows.

---

### 2026-09-05 — Master-branch reconciliation: merge, not rebase; direct push to the remote ref

**Decision:** For the account-deletion fix, merged `origin/master`'s 3 unrelated new commits into the fix branch (rather than rebasing), then pushed the fix branch directly to the `master` ref (`git push origin HEAD:master`) rather than locally checking out `master`, because `master` was already checked out in a different, active worktree (`entity-master`) that this program's own crash-recovery directive requires leaving undisturbed.
**Alternatives:** Rebase onto master (rejected — rewrites commit history for no benefit here, and this repo's own conventions favor merge commits for branch integration); locally check out and merge into `master` in the current worktree (impossible — git disallows the same branch checked out in two worktrees simultaneously) or in the `entity-master` worktree (rejected — would touch another session's active work).
**Evidence:** `git worktree list` confirmed `master` checked out at `entity-master`, modified as recently as the same day.
**Rationale:** Achieves the same end state (the fix lands on `master`, deployed) without any risk to unrelated in-progress work in another worktree.
**Consequences:** None beyond the mechanical git history shape (a merge commit exists on `master` for the 3 unrelated commits + this fix, rather than a linear rebase).
**Reversibility:** N/A — a completed git operation, not an ongoing decision.
**Reconsider if:** never — this was a one-time mechanical choice, not a standing policy, though the same reasoning (check `git worktree list` before assuming you can check out a branch) applies to any future push-to-master need from this or another worktree.

---

## Open Questions Carried Forward

See `primary-platform-master-product-spec.md` §7-8 and the Phase One artifact's own Open Questions section for the full list. Highest-priority, restated here for durability:

1. **Does the professional-analyst/PM persona's real competitive set include Notion/Evernote/Obsidian at all, or is it Excel/Bloomberg/FactSet/internal wikis?** Needs signup-source/usage data. Gates further investment in that persona (see the dedicated decision entry above).
2. **Is a sell-side/buy-side analyst permitted to put employer-owned research in a personal consumer SaaS notebook?** Unexamined by any prior research pass; plausibly disqualifying for that persona regardless of features built.
3. **Is this codebase's current SQLite usage compatible with a SQLCipher-style whole-database encryption approach** that wouldn't break FTS5 search? The Wave 10 design spike's first deliverable.
4. **Is `tradeRef` on widget embeds actually populated by any current frontend writer, or unwired scaffolding?** Confirm before Wave 3 treats it as partially-built.
5. **Real usage telemetry: how many current Notebook users have >100 notes in one folder?** Bears directly on how urgent the Wave 0 folder-sidebar fix is in practice vs. in principle (though the fix ships regardless, given it's cheap and a genuine correctness bug).
6. **Could a determined Notion/Obsidian power user approximate the "Ask Notebook + UCT" fusion moat via existing agent/connector features?** Plausible, unchecked against current competitor capability documentation — bears on how durable that Experiment item's differentiation claim is if it's ever unblocked.
7. **Does real member demand exist for the narrower bookmarklet-first financial-capture-extension**, specifically, versus the rejected general clipper? Untested — the Experiment item's own validation step is designed to answer this cheaply before further investment.
