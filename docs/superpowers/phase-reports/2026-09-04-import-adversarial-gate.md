# Adversarial gate — file import / migration path (Notion · Obsidian · Evernote)

**Date:** 2026-09-04 · **Worktree:** `notebook-migration` · **Scope:** file-import wizard
(`app/src/pages/journal-2-0/lib/importer/**`, `components/notebook/import/**`) +
backend (`api/services/journal_two/notes.py::import_check/import_confirm`). Verify only —
no rebuild. Follows the 2026-09-02 audit (`2026-09-02-notebook-migration-adversarial-audit.md`)
whose findings (A1 all-or-nothing batch loss, B1 import_check truncation, B4 ignored-file
silence, B5 media-pending skip) are recorded there as fixed; this gate re-proves each still
holds today, plus the two regimes the wave's owner explicitly called out as unfinished:
a real >5,000-note library and near/over-ceiling body sizes.

**Method:** ran every existing rail (baseline, before any edits), then added new tests only
where a claim had no test proving it by execution, per the file-ownership rule (mine:
`test_notes_import.py`, `test_notes.py`, `lib/importer/*.test.js`, fixtures). One new test
(COUNT regime) was proven non-vacuous by deliberately breaking `import_confirm`'s
fingerprint-skip line, watching it go red, then restoring the file exactly (`git checkout`)
and watching it go green again — transcript below.

## Baseline (before this session's edits)

- `python -m pytest api/services/journal_two -q` → **1889 passed, 2 failed** (both in
  `test_metrics_registry.py` — unrelated to import, pre-existing, untouched by this task).
- `npx vitest run …/lib/importer …/components/notebook/import` (from `app/`) →
  **14 files / 172 tests passed.**

## Final (after this session's new tests)

- Backend: **1892 passed, 2 failed** (same 2 pre-existing `test_metrics_registry.py`
  failures — confirmed unrelated: metrics-registry period overrides, no import code
  in the call chain).
- Frontend: **14 files / 176 tests passed.**

## Capability table

Legend: **PROVEN** = executed a test today (existing or new) that would fail if the
behaviour broke. **BROKEN** = a real defect found. **UNPROVEN** = no execution-based
proof exists for this source; noted why.

| Capability | Notion | Obsidian | Evernote |
|---|---|---|---|
| Format detection | PROVEN (`registry.test.js`, `notion.test.js` detect scoring) | PROVEN (`obsidian.test.js`, `.obsidian/` + content heuristic) | PROVEN (`evernote.test.js`, `.enex` signal; ordering railed evernote>notion>obsidian>generic) |
| Guided import (wizard steps) | PROVEN (`ImportWizard.test.jsx`, 26 cases, shared across sources) | PROVEN (same) | PROVEN (same) |
| Per-folder selection | PROVEN (`ImportWizard.jsx` `excludedFolders`/`selectAllInGroup`, exercised in `ImportWizard.test.jsx`) | PROVEN (same, source-agnostic) | PROVEN (same) |
| Per-note selection | PROVEN (`excludedNotes`, `selectAllNotes`, tested) | PROVEN | PROVEN |
| Preview counts (create/update/unchanged) | PROVEN (`previewCounts` derived from `checkExisting`, tested) | PROVEN | PROVEN |
| Create/update/unchanged classification | PROVEN (`import_check` fingerprint hash, `test_import_check_reports_existing`) | PROVEN | PROVEN |
| Re-import (fingerprint UPDATE, never duplicate) — **small scale** | PROVEN (`test_import_confirm_creates_then_reimport_skips_then_change_updates`) | PROVEN | PROVEN (source-agnostic backend path) |
| Re-import at **>5,000-note COUNT scale** | **PROVEN TODAY** (new: `test_import_confirm_at_scale_past_5000_notes_reimport_updates_not_duplicates` — 5,300 real notes created across 11 batches, re-imported whole-library with edits at idx 5001/5299; 0 duplicates, correct skip/update split, `import_check` not truncated over 5,300 keys) | same (backend is source-agnostic) | same |
| Attachments (images/files) | PROVEN (`notion.test.js` media refs, `commit.test.js` upload MIME) | PROVEN (`obsidian.test.js`) | PROVEN (`evernote.test.js` en-media) |
| Internal links | PROVEN (`notion.js` `data-import-link` + `commit.test.js` link resolution) | PROVEN (`obsidianParity.contract.test.js`) | **UNPROVEN — N/A**: `.enex` carries no note-to-note link construct; nothing to prove |
| Warnings | PROVEN (CSV-row-limit, id-collision warnings in `notion.test.js`) | PROVEN | PROVEN (mixed-platform-drop warning) |
| Unsupported-file reporting | PROVEN (`reportIgnoredFiles`, audit-B4 coverage in `notion.test.js`) | PROVEN | PROVEN (`evernote.test.js` "names the non-.enex files it silently discarded") |
| Resumability (partial run retried safely) | PROVEN (`commit.test.js`: failed-batch continuation, media-pending retry, skip-on-match) | PROVEN | PROVEN |
| Member-visible partial-failure reporting | PROVEN (`ImportWizard.jsx` renders `summaryResult.failures` by name; `commit.test.js` asserts `failures`/`attentionKeys` outside mock callbacks) | PROVEN | PROVEN |
| Completion summary | PROVEN (`ImportWizard.test.jsx` summary step) | PROVEN | PROVEN |
| Round-trip export | PROVEN (`exportRoundtrip.test.js`: real `build_export_zip` → real `detectAdapter`+`parse`, checks title/tags/dates/attachments/callout/toggle survive) | PROVEN (same fixture is Obsidian-shaped markdown) | UNPROVEN — no `.enex`-shaped round-trip fixture exists; export always emits UCT's own markdown format, so this is an export→**our own importer** proof, not export→Evernote-shape |
| **SIZE: near-ceiling body lands** | PROVEN (backend, shape-agnostic: `test_import_confirm_commits_a_realistic_near_boundary_meeting_log_among_many_siblings`, 948,453 bytes) | same | same |
| **SIZE: over-ceiling isolated, siblings survive, named** | PROVEN (`test_import_confirm_isolates_a_realistically_oversized_meeting_log_without_losing_siblings`, `_an_oversized_many_inline_images_note`) | same | same |
| **SIZE: many-short-headings ~9x shape, wizard path** | **PROVEN TODAY** (new: `convert.test.js` — measured **>4.7x** through the real `mdToHtml`→`htmlToNote` wizard converter, independent of the connector's own Python `md_to_tiptap` measurement) | same | same |
| **SIZE: pathological titles** (colon/slash/unicode/very-long) | **PROVEN TODAY** (new: `test_import_confirm_handles_pathological_titles_without_corrupting_siblings` — 4 healthy pathological titles commit correctly incl. truncation to `MAX_TITLE_CHARS`; 1 malformed non-string title isolates via `failed` without harming siblings) | same | same |

## New tests added (this session)

- `api/services/journal_two/test_notes_import.py`:
  `test_import_confirm_at_scale_past_5000_notes_reimport_updates_not_duplicates`,
  `test_import_confirm_handles_pathological_titles_without_corrupting_siblings`.
- `app/src/pages/journal-2-0/lib/importer/convert.test.js`: 4 new cases measuring
  md→TipTap blowup through the real wizard converter (meeting log, many-short-headings,
  many inline images, a ~212,765-char near-ceiling body).

## Red/green proof (COUNT-regime test is non-vacuous)

Broke `notes.py:498`'s fingerprint-skip condition (`if row and row["import_hash"] == h …`
→ `if False and …`), forcing every unchanged note through the UPDATE path instead of
`skipped`:

```
FAILED test_import_confirm_at_scale_past_5000_notes_reimport_updates_not_duplicates
AssertionError: assert {'lib:0', 'lib:102', ...} == set()
  (updated_keys contained hundreds of unchanged notes that should have been skipped)
```

Restored via `git checkout -- api/services/journal_two/notes.py`; re-ran — 2 passed. No
residual diff on `notes.py` (confirmed `git status --porcelain`).

## Defects found

**None.** No production code was changed. The 2026-09-02 audit's four findings (A1/B1/B4/B5)
all re-verified as fixed by execution today, including at a scale (5,300 notes) and through
a code path (frontend wizard converter) neither the original audit nor its follow-up fixes
had exercised.

## What could not be proven, and why

- **Evernote internal links** — `.enex` has no note-to-note link primitive; not a gap, a
  format limitation. Confirmed by reading `adapters/evernote.js` (no link-resolution code
  path exists, matching the format).
- **Evernote round-trip export** — our exporter always emits UCT's own markdown+front-matter
  shape (proven to round-trip through `detectAdapter`), never an `.enex` file, so "export as
  Evernote, reimport as Evernote" has no fixture to test against. This is a design fact
  (single export format), not an unverified claim.
- **>5,000-note COUNT regime through the real browser wizard** (`commit.js`'s 200-note
  `CONFIRM_BATCH_SIZE` loop, real `fetch`, real DOM) was proven only at the backend
  (`import_confirm`/`import_check` called directly, 500-note server-side batches) — `commit.js`'s
  batching/retry logic is separately proven correct at moderate scale (401 docs,
  `commit.test.js`) with mocked `fetch`; composing the two into one 5,000+ browser-driven
  run was not attempted (no browser harness in scope, and `vitest`'s mocked-fetch approach
  does not exercise real network chunking behavior differently at 26 batches vs 3).

## Files touched

- `C:\Users\Patrick\uct-worktrees\notebook-migration\api\services\journal_two\test_notes_import.py`
- `C:\Users\Patrick\uct-worktrees\notebook-migration\app\src\pages\journal-2-0\lib\importer\convert.test.js`
- `C:\Users\Patrick\uct-worktrees\notebook-migration\docs\superpowers\phase-reports\2026-09-04-import-adversarial-gate.md` (this file)
