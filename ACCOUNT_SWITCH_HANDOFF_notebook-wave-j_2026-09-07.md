# ACCOUNT SWITCH / FULL SHUTDOWN CONTINUITY HANDOFF

Written for a brand-new Claude instance with **zero conversational memory** of the
session that produced it. Do not assume any prior context. Everything needed to
resume correctly is below or is derivable from the repository itself.

---

## A. IDENTITY

- **Project:** UCT Dashboard (UCT Intelligence) — live trading dashboard, Railway-deployed, `uctintelligence.com`.
- **Workstream:** "UCT Notebook Pre-Launch Primary Notebook Construction Program" — a long-running, wave-based, autonomous-execution program building out the Notebook/Journal-2.0 research product. Each "Wave" is a user-issued directive; this handoff covers **Wave J — Document Intelligence II** (page-aware excerpts/highlights/annotations/thesis-evidence integration for financial source documents; OCR deliberately scoped out).
- **Repository root (this worktree):** `C:\Users\Patrick\uct-worktrees\notebook-primary-platform`
- **Worktree:** same as repo root — this is a dedicated git worktree, not the primary checkout.
- **Branch:** `notebook-primary-platform`
- **HEAD at checkpoint time:** `b6283a5cd` ("WIP: Wave J core slices 1-4 ... -- NOT CLOSED")
- **Upstream:** `origin/notebook-primary-platform` — **confirmed pushed and matching HEAD** at checkpoint time (verified via `git fetch` + `git log -1 origin/notebook-primary-platform` immediately after push).
- **Checkpoint date/time:** 2026-09-07, mid-session, interrupted mid-way through triaging a full `npx vitest run` regression pass.
- **Claude session name:** not explicitly set in this session (no `/rename` was issued). **Recommend running `/rename notebook-wave-j-2026-09-07` (or similar) before closing**, so this session is identifiable in session lists if you return to it directly rather than starting fresh.

---

## B. ORIGINAL OBJECTIVE

Build UCT Notebook into a credible primary research notebook for a financial/trading
persona, wave by wave, with a standing **absolute rule: no forks/subagents for any
part of the work** (research, architecture, implementation, testing, browser
verification, documentation, git, deployment — primary instance only, every wave).

**Wave J specifically** (directive verbatim substance, issued by the user after
accepting Wave I): *"Document Intelligence II: page-aware evidence + excerpts +
highlights + annotations + OCR fallback."* The product framing the directive was
explicit about: **not** "add OCR" — the job is *"turn financial source documents
into durable, citable research evidence."* A member should be able to open a PDF,
select an important passage, save it as a page-aware excerpt, optionally annotate
it, attach it to a thesis as Supports/Opposes evidence, and later click the evidence
to return to the exact source page. OCR is a fallback ingestion path for documents
lacking native text — explicitly secondary to the excerpt/evidence architecture.

The directive was extremely long (121 numbered sections) and itself instructed:
run a 49-point entry checkpoint before any source mutation, implement via
recomputed vertical slices, run a full real-browser E2E pass, run a mobile/tablet
audit, write closure documentation, merge to production, and deliver an 81-point
final certification report — then **STOP before Wave K** (presumptively "Ask
Notebook / Ask Document").

---

## C. AUTHORITATIVE SCOPE

**In scope for Wave J** (per the entry checkpoint already written and committed,
see `docs/notebook/prelaunch-primary-notebook-build-plan.md`'s "WAVE J" section):
1. PDF.js viewer + real text selection (replacing Wave I's inert iframe).
2. Excerpt/highlight/annotation data model.
3. Note insertion + source navigation (click-to-source, page + passage emphasis).
4. Thesis evidence integration (`document_excerpt` as a third evidence target type).
5. Search integration (excerpt FTS, sectioned sidebar results).
6. Lifecycle + security + export.
7. Mobile/tablet + full test matrix + real-browser E2E.
8. Closure + production merge/deploy + certification report.

**Explicitly OUT of scope for this wave** (a deliberate checkpoint decision, not an
oversight — see the checkpoint's own "OCR ... SCOPED, EXPLICITLY DEFERRED" section):
- OCR of scanned/image-only PDFs. No engine has been chosen; privacy/cost/rights
  review has not been done. The data model (`text_origin` column, already built in
  Wave I) accepts an `'ocr'` value with zero rework, so deferring costs nothing
  architecturally.
- Ticker-constrained document/excerpt search as a NEW search box inside the Ticker
  Research Workspace (a deliberate scope-narrowing decision recorded in the
  checkpoint — the existing bounded Documents section there already serves
  "browse this ticker's documents"; a full search box is additional net-new UI
  surface judged out of this wave's core job).
- Document TYPE labeling (Filing/Presentation/Report/Other) — unchanged from Wave
  I's own decision, no current consumer.
- SEC filing workflow integration — unchanged from Wave I, no rights-cleared
  filing-source integration exists to bridge from.

**Standing, cross-wave rules that remain in force:**
- **NO FORKS/SUBAGENTS.** Every prior wave and this one were built by the primary
  instance directly. Do not delegate any part of Wave J to a subagent/fork.
- **Disk safety.** Before substantial E2E/PDF work, check `C:` free space
  (`Get-PSDrive C`). May clean ONLY `%LOCALAPPDATA%\Temp\uct_e2e_sandbox_*`
  directories that are confirmed inactive. Never touch `C:\data`, never delete
  other git worktrees, no generic temp cleanup. At last check this session
  (2026-09-07), `C:` had **~139GB free** — healthy, no action needed.

---

## D. IMPORTANT PRIOR CONTEXT

This is wave **J** of an ongoing series. Waves A through I are already **fully
shipped, merged to `origin/master`, and production-verified** — this is not
greenfield work, it is one more increment on a mature, live product. The
`docs/notebook/` directory (see below) is the authoritative, continuously
maintained record of every prior wave's decisions, defects, and closure evidence —
**read it, don't re-derive it.**

Key architectural facts inherited from Wave I (Attachments + PDF foundation,
shipped, live in production):
- `j2_note_documents` / `j2_note_document_pages` (+ FTS5 index) — one row per PDF
  attachment, page-level native-extracted text via `pypdf`, honest
  `pending|ready|processing_failed|no_text` status states.
- Attachments have **no id of their own** (filesystem-path-is-identity model) — a
  document row is keyed `(note_id, attachment_url)`.
- `DocumentPreviewSheet.jsx` originally used a plain `<iframe>` for PDF preview.
  **This wave replaced that iframe** — see section E.

Key architectural facts inherited from Wave G (Thesis Intelligence, shipped, live):
- `j2_thesis_evidence`: a typed evidence edge FROM a thesis note TO a target,
  `target_type` was **deliberately left an open string** (`'note' | 'fact'` at the
  time), specifically so a third target type could be added later with a one-line
  change. This wave added `'document_excerpt'` — exactly the extension point it
  was built for.

Key architectural facts inherited from Wave F (Financial Fact Ledger, shipped, live):
- `financialFactNode.jsx` / `FinancialFactView.jsx`: the established pattern for
  "an atom TipTap node storing only an id, resolved live via a batched-per-note SWR
  hook, rendered as a quiet card with an explicit 'no longer available' fallback."
  This wave's `documentExcerptNode.jsx` / `ExcerptView.jsx` mirror this pattern
  exactly, deliberately, for consistency.
- `j2_note_fact_refs`: a note-content sidecar table (rebuilt on every save by
  walking the note body for `financialFact` nodes) distinct from the fact's own
  `note_id` (which records where it was originally captured). This wave's
  `j2_note_excerpt_refs` mirrors this shape exactly — **this was a real discovery
  mid-session**: the first draft of `note_excerpts.list_note_excerpts` queried
  `j2_note_excerpts` directly by `note_id`, which is WRONG (it would show an
  excerpt as "in this note" even if the member had deleted its card from the body)
  — fixed to read through the refs sidecar, matching `note_facts.list_note_facts`.

---

## E. DECISIONS ALREADY MADE (carry these forward, do not re-litigate)

1. **PDF.js is required, not optional** — resolved with LIVE, MEASURED evidence
   this session, not assumption: opened a real Wave-I preview in the browser and
   ran `iframe.contentDocument.body.innerText.length` → returned **0**. Chrome's
   built-in PDF viewer renders to an opaque internal surface with no real DOM text
   layer; `window.getSelection()` inside it is unusable. `pdfjs-dist@6.3.289` was
   added as a normal npm dependency (already committed in `package.json`/
   `package-lock.json`).

2. **Viewer architecture**: `PdfDocumentViewer.jsx` — canvas (`page.render()`) +
   pdfjs's own `TextLayer` class (an official, stable, lower-level API — NOT the
   full `web/pdf_viewer.mjs` `PDFViewer` machinery, which is far more opinionated
   than needed here) rendered as an absolutely-positioned, transparent, real-text
   `<span>`-per-run layer over the canvas. Virtualized page-by-page via
   `@tanstack/react-virtual` (an **already-installed, previously-unused**
   dependency — CLAUDE.md's own "Known remaining" section flagged it as unused
   before this wave).

3. **Text-layer sizing is set EXPLICITLY**, not left to pdfjs's own
   `setLayerDimensions`/CSS-`round()`-expression chain (which depends on
   `--total-scale-factor`/`--scale-round-x/y` custom properties normally supplied
   by the higher-level `PDFPageView` this viewer doesn't use). `PdfDocumentViewer.jsx`
   sets `container.style.width/height` to the exact viewport pixel size and
   `--total-scale-factor` to the render scale directly, right before calling
   `layer.render()`. **This was a deliberate robustness decision, not tested with a
   real PDF in a real browser yet** — see section K/L, this is the single highest-
   risk unverified piece of the whole wave.

4. **Excerpt = highlight** (one object, not two storage systems). New table
   `j2_note_excerpts`: `id, user_id, note_id, document_id, page_number,
   captured_text, quote_prefix, quote_suffix, char_start, char_end, annotation,
   created_at, modified_at`. `note_id` mirrors `j2_fact_observations`' own
   note-owned shape (destination chosen at save time, not necessarily the
   document's owning note — an excerpt is referenceable by any of the user's
   theses regardless of which note captured it, same as facts already are).

5. **Text anchoring**: quote-context (prefix/suffix, ~200 chars each, a text-quote-
   selector shape matching the W3C Web Annotation Data Model's own approach) is the
   ROBUST anchor; `char_start`/`char_end` are a supplementary fast-path hint, never
   load-bearing alone. `_locateTextRange` (in `PdfDocumentViewer.jsx`, exported for
   testing) does the offset-to-DOM-Range mapping and is unit-tested with synthetic
   multi-span layouts (`PdfDocumentViewer.test.jsx`) — **this is real, passing,
   verified logic**, not a stub.

6. **Source-text immutability**: `captured_text` is written once, never rewritten
   by a future re-extraction pass. Only `annotation` is editable (`update_excerpt_annotation`,
   stamps `modified_at`).

7. **Two-caption precedent, deliberately preserved**: `j2_note_excerpts.annotation`
   ("why this passage matters," portable across every thesis that cites it) is
   DISTINCT from `j2_thesis_evidence.caption` ("why this excerpt supports/opposes
   THIS particular thesis," can differ per thesis for the SAME excerpt) — this
   mirrors Wave F's own `fact.caption` vs. Wave G's `thesis_evidence.caption`
   coexistence exactly, which was independently verified to already work that way
   before writing any new code.

8. **Cascade-delete**: deleting a `j2_note_documents` row cascades to
   `j2_note_excerpts` (a citation must never claim a purged document still exists —
   directive's own explicit instruction). Deleting the owning `j2_notes` row
   cascades both `j2_note_excerpts` and `j2_note_excerpt_refs`.

9. **"Remove from note" is editor-local, not a hard delete** — clicking the "x" on
   an `ExcerptView` card calls TipTap's `deleteNode()` only (removes the node from
   THIS note's body), mirroring `FinancialFactView`'s own established behavior
   exactly. The underlying `j2_note_excerpts` row is untouched (it may still be
   referenced by a thesis in a different note). A `note_excerpts.delete_excerpt`
   service function exists (hard delete) but is **NOT wired to any UI this wave** —
   deliberately, to avoid ambiguity, tested at the service layer only.

10. **Click-to-source bridge**: reuses Wave I's own established pattern — a plain
    DOM click carrying `data-*` attributes on a button
    (`data-type="documentExcerptCitation"`), recognized by `NoteEditorPage.jsx`'s
    existing capture-phase `handleEditorClickCapture` handler — NOT a TipTap-
    extension-level callback (`addOptions`). Same bridge Wave I used for the
    `attachmentChip` → preview-Sheet case.

11. **Cross-note evidence resolution**: `GET /api/j2/excerpts/{id}` (new endpoint)
    returns a single excerpt joined to its source document's `name`/
    `attachment_url` — this is what lets a thesis-evidence row open its source
    even when the excerpt was captured into a DIFFERENT note than the one
    currently open (the common "click evidence in my thesis, source doc lives
    elsewhere" case).

12. **Export**: excerpts render as an inline markdown blockquote + citation line
    (`> quoted text` / `> — Document.pdf, p.17` / optional `*annotation*`) at the
    exact point they appear in the note body — via the SAME resolver-marker
    mechanism `noteLink` already uses for cross-reference resolution at export
    time (`document-excerpt://<id>` marker, `_make_note_link_aware_resolver`
    extended, not duplicated). `thesis_evidence:` front-matter also resolves
    `document_excerpt` targets to `"{Document}, p.{N}"` labels.

---

## F. RESEARCH / FINDINGS ALREADY ESTABLISHED (verified, not hypotheses)

- **Verified live in browser**: native iframe PDF viewer has zero selectable text
  (measured via `contentDocument.body.innerText.length === 0`).
- **Verified via unit tests**: the offset-to-DOM-Range mapping logic
  (`_locateTextRange`) correctly handles single-span quotes, multi-span quotes
  (pdfjs breaks text runs on font/style changes), quote-context disambiguation
  between repeated occurrences, and returns `null` honestly when text can no
  longer be found. **A real bug was caught and fixed by these very tests**: the
  first draft of the test helper (`makeSpans`) created orphan, unattached `<span>`
  elements — a `Range` spanning two disconnected DOM nodes has no valid common
  ancestor and silently produces an empty string. Fixed by attaching all synthetic
  spans to a shared container, matching pdfjs's real DOM shape. This was a
  TEST-FIXTURE bug, not a component bug — logged here so it isn't rediscovered.
- **Verified via backend tests (105/105 passing)**: full CRUD, two-sided tenant
  re-verification, cascade delete (both document-deletion and note-deletion
  paths), the refs-sidecar-not-bare-note_id read pattern, thesis-evidence
  `document_excerpt` target integration (including the "same excerpt supports one
  thesis AND opposes another" case), excerpt search (tenant-scoped, trash-
  excluded, annotation-edit re-indexing), export (inline blockquote rendering,
  honest "source no longer available" degradation, evidence citation labels),
  and account-purge coverage.
- **Verified: zero regressions across the full 2357-test backend suite**
  (`python -m pytest api/services/journal_two/ tests/test_journal_two_documents_router.py
  tests/test_journal_two_home_and_research_router.py -q`) — 2357 passed, 1 failed,
  and that 1 failure is the SAME pre-existing, unrelated Obsidian-parity fixture
  issue documented in every prior wave's own closure notes (not caused by this
  wave).
- **NOT YET VERIFIED / genuinely unknown**: whether the PDF.js canvas+text-layer
  actually renders correctly, whether text selection actually works, whether the
  explicit `--total-scale-factor`/pixel-size-override approach (decision E.3
  above) actually produces correctly-positioned, correctly-sized selectable text
  in a REAL browser against a REAL PDF. This has NEVER been visually confirmed.
  Treat this as the single highest-priority thing to check first upon resuming.
- **Frontend regression run (`npx vitest run`, no `-k` filter, full 1040-file
  suite) showed 9 failed tests + 1 unhandled error, NOT fully triaged before the
  shutdown interrupt landed.** One is CONCRETELY IDENTIFIED (see section L below,
  it is a known, trivial, already-solved-elsewhere fix). The other 8 test names
  were never captured — the interrupt arrived while grepping for the FAIL list.
  The 1 unhandled error (`LineType` missing from a `lightweight-charts` mock,
  in `StockChart.smoke.test.jsx`) is very likely pre-existing and unrelated
  (StockChart.jsx was never touched by this wave) but was **not confirmed**
  pre-existing before the interrupt — don't assert it as fact, verify it.

---

## G. WORK COMPLETED

**Backend (all committed, all tested, zero regressions confirmed):**
- `api/services/journal_two/db.py` — `j2_note_excerpts`, `j2_note_excerpt_refs`,
  `j2_note_excerpts_fts` (+ map table), cascade triggers (note deletion, document
  deletion), FTS insert/update/delete triggers.
- `api/services/journal_two/note_excerpts.py` (NEW) — full CRUD service.
- `api/services/journal_two/excerpt_search.py` (NEW) — tenant-scoped FTS search.
- `api/services/journal_two/thesis_evidence.py` — `document_excerpt` target type.
- `api/services/journal_two/notes.py` — `_extract_note_excerpt_refs`/
  `_sync_note_excerpt_refs` (mirrors the fact-refs pattern, wired into all 6 body-
  write call sites), `append_document_excerpt` (server-side node placement for the
  "opened from Ticker Workspace, no editor mounted" case), `extract_plain_text`
  gained a `documentExcerpt` → `[excerpt]` marker branch.
- `api/services/journal_two/notes_export.py` — `documentExcerpt` inline blockquote
  rendering, `document-excerpt://` resolver marker, `document_excerpt` evidence
  label resolution.
- `api/services/journal_two/account_purge.py` — both new tables added.
- `api/routers/journal_two.py` — `POST /notes/{id}/excerpts`,
  `GET /notes/{id}/excerpts`, `GET /excerpts/{id}`, `PATCH /excerpts/{id}`,
  `GET /notes/excerpts/search`.
- Tests: `api/services/journal_two/test_wave_j_excerpts.py` (21 tests),
  `tests/test_journal_two_excerpts_router.py` (13 tests), plus 3 new tests in
  `api/services/journal_two/test_notes_export.py`. **All passing.**

**Frontend (all committed, unit-tested where jsdom allows, NOT live-browser-verified):**
- `app/src/pages/journal-2-0/lib/pdfjs.js` (NEW) — pdfjs-dist worker setup.
- `app/src/pages/journal-2-0/components/notebook/PdfDocumentViewer.jsx` (NEW) —
  the viewer itself. + `.module.css` + `.test.jsx` (6 passing unit tests of the
  pure offset-mapping logic).
- `app/src/pages/journal-2-0/components/notebook/DocumentPreviewSheet.jsx` —
  rewritten to use `PdfDocumentViewer` instead of the Wave I `<iframe>`. Bar
  (filename, Open-in-new-tab, Download) preserved byte-for-byte.
  `.test.jsx` rewritten to mock `PdfDocumentViewer` (jsdom can't run real
  pdfjs — Worker/Canvas2D/ReadableStream unimplemented).
- `app/src/pages/journal-2-0/lib/documentExcerptNode.jsx` (NEW) — TipTap atom node.
- `app/src/pages/journal-2-0/components/notebook/ExcerptView.jsx` (NEW) + `.module.css`.
- `app/src/pages/journal-2-0/hooks/useNoteExcerpts.js` (NEW),
  `useNoteDocuments.js` (NEW).
- `app/src/pages/journal-2-0/lib/tiptap.js` — registered `DocumentExcerpt` node,
  added `documentExcerpt` → `[excerpt]` client-side plain-text marker.
- `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx` — full
  wiring: resolves `documentId` from `href` via `useNoteDocuments`, `previewDoc`
  state extended with `documentId`/`page`/`emphasizeExcerptId`/`emphasizeExcerpt`,
  `handleSaveExcerpt` (POST + insert node), `handleOpenExcerptSource` (cross-note
  resolution via `GET /excerpts/{id}`), `previewExcerpts` memo (filters this
  note's own excerpts by document, merges in a cross-note emphasis target when
  needed), citation-button click handling in `handleEditorClickCapture`.
- `app/src/pages/journal-2-0/components/notebook/ThesisSection.jsx` — third
  evidence target type ("Document excerpt"), excerpt picker (lists
  `useNoteExcerpts`), `ExcerptEvidenceRow` helper component, click-to-source via
  `onOpenExcerptSource` prop (passed down from `NoteEditorPage`).
- Tests: `PdfDocumentViewer.test.jsx` (6), `DocumentPreviewSheet.test.jsx`
  (rewritten, 7), `NoteEditorPage.excerpts.test.jsx` (NEW, 3),
  `NoteEditorPage.attachments.test.jsx` (2 assertions updated for the new
  dialog-role-based check instead of the removed iframe `title` attribute),
  `ThesisSection.test.jsx` (7 new tests appended). **All of the above individually
  confirmed passing when run in isolation** (see section K) — the FULL suite run
  had 9 failures, only 1 concretely triaged (see section L).

**Documentation:**
- `docs/notebook/prelaunch-primary-notebook-build-plan.md` — the full Wave J entry
  checkpoint (already committed in a separate prior commit, `64d1c3370`, BEFORE
  implementation began — matches this whole program's established "checkpoint
  commit, then implementation commit(s)" pattern).

**NOT done:** closure documentation updates to `competitive-gap-ledger.md` /
`primary-notebook-readiness-scorecard.md` / `primary-platform-decision-log.md`
(the other three docs updated at the close of every prior wave) — these were not
started.

---

## H. FILES / MODULES CHANGED

See section G above for the categorized list — it IS the file list, described by
purpose rather than repeated as a bare path dump. For the exact set with change
type (M/A), run `git show --stat b6283a5cd` from this repo root, or see the
commit body of `b6283a5cd` itself (`git log -1 b6283a5cd`).

---

## I. COMMITS / SHAs

All on branch `notebook-primary-platform`, all **pushed to
`origin/notebook-primary-platform`** (confirmed matching, not merely attempted):

| SHA | Description | Status |
|---|---|---|
| `64d1c3370` | Wave J entry checkpoint (documentation only, no code) | Pushed. Was local-only until this checkpoint; pushed together with 23 other previously-local commits (Waves E-I's own dev-branch history) in one backup push. |
| `b6283a5cd` | WIP: Wave J core slices 1-4 (all code in section G) — explicitly labeled NOT CLOSED in its own commit message | Pushed. **This is the tip of the branch as of this handoff.** |

**Important nuance on `origin/master` vs. this branch:** Waves E through I's
actual SHIPPED content already landed on `origin/master` independently, via a
separate isolated-worktree merge-and-push pattern used at the close of each of
those waves (this branch, `notebook-primary-platform`, is the ONGOING DEV branch
for the whole program — it is not itself deployed; production merges happen via
temporary throwaway worktrees created fresh each time, merged into `origin/master`,
then deleted). **Wave J has NOT been through that process yet** — nothing in this
handoff's commits is on `origin/master`, nothing is deployed, nothing is live.
Do not confuse "pushed to origin/notebook-primary-platform" (done, safe) with
"merged to production" (not done, not started).

---

## J. CURRENT GIT STATE

**As of the last verification in this session: completely clean.**
```
git status --short   → (empty)
```
No staged changes, no unstaged changes, no untracked files. Everything described
in this handoff is captured in the two commits in section I, both pushed.
**Verify this is still true when you resume** — do not assume it silently.

---

## K. VALIDATION / TEST EVIDENCE

**Backend — full suite, run this session, PASSING, zero regressions:**
```
cd C:\Users\Patrick\uct-worktrees\notebook-primary-platform
python -m pytest api/services/journal_two/ tests/test_journal_two_documents_router.py tests/test_journal_two_home_and_research_router.py -q
```
Result: **2357 passed, 1 failed** in 811s. The 1 failure is
`api/services/journal_two/test_obsidian_parity_fixtures.py::test_regeneration_is_byte_identical_to_the_committed_fixtures`
— pre-existing, unrelated, documented in every prior wave's closure notes.

**Backend — Wave J's own new test files, run individually, all passing:**
```
python -m pytest api/services/journal_two/test_wave_j_excerpts.py tests/test_journal_two_excerpts_router.py api/services/journal_two/test_notes_export.py -q
```
21 + 13 + 71(incl. 3 new) = confirmed green individually.

**Frontend — individual files, run this session, all passing:**
```
cd app
npx vitest run src/pages/journal-2-0/components/notebook/PdfDocumentViewer.test.jsx
npx vitest run src/pages/journal-2-0/components/notebook/DocumentPreviewSheet.test.jsx
npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.attachments.test.jsx
npx vitest run src/pages/journal-2-0/components/notebook/NoteEditorPage.excerpts.test.jsx
npx vitest run src/pages/journal-2-0/components/notebook/ThesisSection.test.jsx
```
Each of these, run in isolation, passed 100%.

**Frontend — FULL suite, run this session, NOT fully triaged:**
```
cd app
npx vitest run
```
Result: **8 test FILES failed, 1030 files passed, 1 skipped** (out of 1040
files); **9 individual tests failed, 14806 passed, 9 skipped**; plus **1
unhandled error**. **This is the single most important unfinished item in this
handoff.** Only one of the 9 is concretely identified — see section L.

**What has NEVER been tested:** any real-browser interaction with
`PdfDocumentViewer` — no PDF has been opened in an actual browser tab against
this wave's code, no selection has been attempted, no highlight has been visually
confirmed, no mobile/tablet pass has been run, `tools/mobile_audit.py` has not
been invoked for any Wave J route.

---

## L. OPEN ISSUES / RESIDUAL DEBT

**Highest priority — concretely identified, trivial fix, NOT applied (interrupt
landed mid-triage):**
- `app/src/pages/journal-2-0/components/notebook/TickerResearchWorkspace.test.jsx`
  line 128, test `'clicking a READY document row opens the preview sheet, not the
  note'`, asserts `screen.getByTitle('Preview of report.pdf')` — this is the
  Wave-I-era iframe assertion. `DocumentPreviewSheet` no longer renders an
  `<iframe>` with a `title` attribute reachable this way (it renders `PdfDocumentViewer`
  inside a `Sheet` whose dialog carries `aria-label="Preview of report.pdf"`
  instead). **The exact fix, already applied successfully twice elsewhere this
  session** (`NoteEditorPage.attachments.test.jsx`,
  `DocumentPreviewSheet.test.jsx`'s own rewrite): replace with
  `screen.getByRole('dialog', { name: 'Preview of report.pdf' })`. This file was
  simply never checked for the same stale pattern — a grep for
  `getByTitle\('Preview of` across `app/src/pages/journal-2-0/` confirms this is
  the ONLY remaining file with it.

**High priority — genuinely unknown, needs investigation, not yet started:**
- The other 8 failing tests from the full `npx vitest run`. Re-run it fresh, read
  the actual failure list this time (don't let it scroll past), and triage each
  one: is it caused by this wave's changes (most likely candidate: any other test
  file that mounts `NoteEditorPage`/`DocumentPreviewSheet`/`ThesisSection` without
  mocking `PdfDocumentViewer`, and therefore tries to run real pdfjs-dist code in
  jsdom, which has no `Worker`/`Canvas2D`/`ReadableStream`), or is it genuinely
  pre-existing and unrelated (the `StockChart.smoke.test.jsx` / `LineType` /
  `lightweight-charts` mock error looks likely to be this — StockChart.jsx was
  never touched — but was NOT confirmed pre-existing before the interrupt; check
  it against `origin/notebook-primary-platform`'s prior commit, `64d1c3370`,
  before assuming).
- **The single biggest unverified risk in this whole wave**: does
  `PdfDocumentViewer` actually work in a real browser? Canvas rendering, text-
  layer positioning (the explicit `--total-scale-factor`/pixel-size-override
  approach, decision E.3), native text selection, the selection popover, saving
  an excerpt, highlight-rect rendering (the `_locateTextRange` → `getClientRects()`
  → absolutely-positioned overlay pipeline) — NONE of this has been opened in an
  actual browser tab yet. This needs a real E2E pass before anything else in this
  wave can be trusted.

**Deferred by deliberate scope decision (see section C), not bugs:**
- OCR (engine choice, privacy review, cost/rate policy) — untouched, intentionally.
- A dedicated ticker-constrained document/excerpt search box — untouched,
  intentionally (the existing Ticker Workspace Documents section already serves
  browsing).
- Document type labeling, SEC filing workflow — untouched, matches Wave I.

**Not started at all:**
- Mobile/tablet audit (`tools/mobile_audit.py` against any Wave J route).
- Full real-browser E2E pass (upload → select → save excerpt → verify highlight
  → add to thesis as evidence → click evidence → confirm return to exact source
  page — the directive's own named highest-value exit gate).
- Closure documentation (3 of 4 tracked docs untouched — see section G).
- Production merge/deploy.
- The mandatory 81-point Wave J final certification report (directive's own
  §119 format).

---

## M. REJECTED / RULED-OUT APPROACHES

- **Using pdfjs-dist's full `web/pdf_viewer.mjs` `PDFViewer` component** (Mozilla's
  own reference viewer machinery) was considered and rejected in favor of the
  lower-level `TextLayer` class + manual per-page canvas rendering. Reasoning:
  `PDFViewer` is built for a full-chrome PDF viewer app (thumbnails, findbar,
  sidebar, its own event bus and DOM structure) — far more than this custom,
  Sheet-embedded, excerpt-focused UI needs, and would fight rather than help a
  custom selection-popover/highlight-overlay UI.
- **Storing highlight positions as pixel rectangles only** was rejected in favor
  of quote-context text anchoring (with offsets as a supplementary hint) —
  pixel rects don't survive a re-extraction, zoom change, or window resize the way
  a text-quote selector does.
- **A separate "OCR document" user-facing category** was explicitly rejected at
  the checkpoint stage (directive's own instruction) — OCR-sourced pages must use
  the exact same `j2_note_document_pages`/search/excerpt architecture as native
  ones, never a parallel silo. (This informed the schema design even though OCR
  itself isn't built yet.)
- **A fourth resolver parameter in `notes_export.py`** for excerpt export was
  rejected in favor of extending the existing single-resolver marker scheme
  (`document-excerpt://<id>`, alongside the pre-existing `internal-note-link://<id>`)
  — avoids threading a new parameter through 13 existing call sites.
- **Querying `j2_note_excerpts` directly by `note_id`** for `list_note_excerpts`
  was tried FIRST and is WRONG — see section D's "real discovery mid-session" note.
  Fixed to read through the `j2_note_excerpt_refs` sidecar instead. Do not revert
  to the direct-query approach.

---

## N. CRITICAL CONSTRAINTS (must not violate)

- **No forks/subagents, ever, for any part of this workstream.** This is not a
  suggestion — it has been restated as an absolute rule at the start of every
  wave in this program, by the user, explicitly.
- **Disk safety**: before heavy E2E work, check `C:` free space. May clean ONLY
  `%LOCALAPPDATA%\Temp\uct_e2e_sandbox_*`. Never `C:\data`, never other worktrees,
  no generic temp cleanup. (A real disk-full incident happened earlier in this
  program, in an earlier wave — this rule exists because of that, not
  hypothetically.)
- **Never merge/deploy Wave J to `origin/master` before it is genuinely closed**
  (full E2E verified, mobile audit run, tests green, closure docs written). The
  established program pattern is: implementation commit → live E2E → closure docs
  → THEN merge via a fresh temporary worktree off `origin/master` → push → verify
  production → THEN (and only then) a second small commit recording the
  production-closure evidence. Do not skip steps or reorder them.
- **The Wave J entry checkpoint (already committed, `64d1c3370`) is the
  authoritative decision record — do not silently contradict it.** If a decision
  in it turns out to be wrong once real browser testing happens, say so
  explicitly and update the documentation; don't just quietly build something
  different.
- **STOP before Wave K once Wave J is certified.** Do not begin the next wave
  automatically, per the governing directive's own final instruction.

---

## O. DEPENDENCIES / GATES

- No external approvals pending. No other workstream is currently blocking this
  one.
- **New dependency added this session**: `pdfjs-dist@6.3.289` (npm, `app/package.json`
  + `app/package-lock.json`, already committed). No other new dependencies.
- Railway CLI is linked to project `luminous-recreation`, service `web` (confirmed
  earlier in this session via `railway status`) — relevant only once Wave J
  actually reaches its production-merge step, not before.
- No credentials, API keys, or new environment variables were introduced by this
  wave's work.

---

## P. ENVIRONMENT / CONFIGURATION

- **Platform**: Windows 11, PowerShell primary shell, Bash tool also available
  (Git Bash / POSIX semantics — the two are NOT interchangeable syntax, be
  careful which tool you're issuing commands through).
- **Python**: 3.14, backend deps already installed in this environment (no new
  Python packages were added this wave — `pypdf` was already a Wave I dependency).
- **Node**: `app/` has its own `node_modules` with `pdfjs-dist@6.3.289` already
  `npm install`ed this session (confirmed present; a `git clone` elsewhere would
  need `npm install` re-run in `app/`, but THIS worktree already has it — a
  restart of this SAME machine does not remove `node_modules`).
- **A disposable local sandbox server** (`tools/e2e_sandbox_launcher.py --port 8092`)
  was running at the time of this checkpoint (PID 35088, started ~07:45 this
  session). **This will NOT survive an OS restart and does not need to** — it is
  fully reproducible: `python tools/e2e_sandbox_launcher.py --port 8092`
  (from this repo root), then sign up a fresh test account (its own DB is wiped
  on every relaunch — this is by design, not a bug). No unique state lived only
  in that sandbox that isn't already captured in this handoff or in committed
  code/tests.
- **No MCP servers, plugins, or special agent configuration were required for
  this workstream** beyond the standard Claude Code toolset (Bash, Read, Write,
  Edit, Grep, Glob) plus `mcp__claude-in-chrome__*` browser-automation tools for
  the live-browser verification steps that are still outstanding (see section L)
  — those tools were used earlier in the broader session (for Wave I) and would
  need to be re-loaded via `ToolSearch` if deferred/not already loaded in a fresh
  session (they are deferred-by-default tools in this environment).
- **Scratchpad directory** used earlier this broader session (for Wave I's E2E,
  not Wave J):
  `C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\9cad6d30-f4e3-49db-94e5-5c70ba785b75\scratchpad`
  — contains a real hand-built 3-page test PDF (`nvda-investor-deck.pdf`) and a
  disallowed-type test file (`bad-upload.svg`) from Wave I's own verification.
  **This scratchpad is tied to THIS session's ID and will likely not exist for a
  future session** — a fresh session will have its own scratchpad path; regenerate
  test fixtures there if needed (`api/services/journal_two/pdf_fixtures.py`'s
  `make_pdf()` is the easy in-repo way, or reuse the same real-PDF approach Wave I
  used if a fixture with actual visual page content is needed for a screenshot-
  based live check).

---

## Q. EXACT STOPPING POINT

Mid-way through a full-repo `npx vitest run` regression triage, immediately after
Wave J's core implementation (slices 1-4 of 8) was completed and unit-tested. The
triage had identified that 9 tests failed (down from a clean baseline), had
scrolled far enough to see ONE of them concretely
(`TickerResearchWorkspace.test.jsx:128`), and was in the process of grepping for
the full FAIL list when the user's shutdown/account-switch instruction arrived
mid-tool-call. All work has since been safely committed and pushed (see sections
I/J) — nothing was left uncommitted, nothing was left in a half-written state.

---

## R. NEXT RECOMMENDED ACTION

1. Verify this handoff's own claims first (section J's git state, this commit's
   presence on the remote) — do not trust it blindly, the instructions that
   produced it explicitly required exactly this kind of self-verification.
2. Fix the one concretely-identified test (section L, `TickerResearchWorkspace.test.jsx:128`).
3. Re-run `npx vitest run` (full suite) from `app/`, capture the COMPLETE failure
   list this time, and triage every one of the remaining ~8 against this wave's
   changes vs. pre-existing/unrelated.
4. Once frontend is green (or every remaining red is confirmed pre-existing and
   unrelated, matching this program's own established evidence bar), start the
   sandbox (`python tools/e2e_sandbox_launcher.py --port 8092` from repo root) and
   do the REAL live-browser E2E pass this wave has never had: open a note, attach
   a PDF (or reuse one already attached in a fresh sandbox account), open the
   preview, and — critically — **confirm text is actually visible and selectable
   in the rendered canvas+text-layer**. This is the load-bearing unknown.
5. If the viewer genuinely doesn't render/select correctly, debug `PdfDocumentViewer.jsx`
   directly (the `--total-scale-factor` / explicit pixel-size approach in decision
   E.3 is the most likely culprit if something's visually wrong) — do not
   architecturally restart; the data model, backend, and node/hook layer are
   independently solid (105+ backend tests, real unit-tested offset logic).
6. Continue through the remaining vertical slices (mobile/tablet audit, closure
   docs, production merge, 81-point certification) exactly as every prior wave in
   this program has: implement → verify live → document → merge → certify → stop.

---

## S. DO-NOT-DO LIST

- Do NOT assume the 9 failing frontend tests are already understood — only 1 of 9
  is concretely identified in this handoff.
- Do NOT assume `PdfDocumentViewer` works — it has never been opened in a real
  browser. Treat it as unverified, not as "probably fine because the unit tests
  pass" (the unit tests deliberately mock around everything jsdom can't do —
  they prove the pure logic is right, not that the rendering pipeline works).
- Do NOT merge or deploy Wave J to `origin/master` — it is not close to ready
  (no live E2E, no mobile audit, no closure docs).
- Do NOT dispatch a fork/subagent for any part of this — standing absolute rule.
- Do NOT re-litigate the architectural decisions in section E without new
  evidence contradicting them — they were each made deliberately, several with
  real measured/tested justification.
- Do NOT treat `origin/notebook-primary-platform` as deployed/production — it is
  the ongoing dev branch. Production is `origin/master`, and Wave J is not on it.
- Do NOT delete the disposable sandbox process/directories beyond the standing
  `uct_e2e_sandbox_*` rule, and do not touch `C:\data` or other worktrees.

---

## T. RECOVERY INSTRUCTIONS

1. Confirm the machine has restarted and you are in a fresh Claude Code session
   (new account, per the user's stated plan).
2. Navigate to `C:\Users\Patrick\uct-worktrees\notebook-primary-platform` (this
   worktree should be untouched — a git worktree is just files on disk).
3. Read this file (`ACCOUNT_SWITCH_HANDOFF_notebook-wave-j_2026-09-07.md`) in
   full — it should also exist as a second copy at
   `C:\Users\Patrick\ACCOUNT_SWITCH_HANDOFFS\ACCOUNT_SWITCH_HANDOFF_notebook-wave-j_2026-09-07.md`.
4. Run `git status`, `git log --oneline -5`, `git rev-parse HEAD` and confirm
   they match section A/I/J above. If they don't match, STOP and investigate the
   discrepancy before doing anything else — do not assume this document is still
   accurate.
5. Run `git log --oneline -1 origin/notebook-primary-platform` (may need
   `git fetch origin notebook-primary-platform` first) and confirm it matches
   local HEAD — confirming the push in section I actually landed and nothing was
   lost.
6. Proceed per section R.

---

## U. FIRST MESSAGE TO CLAUDE AFTER RECOVERY

> Read `ACCOUNT_SWITCH_HANDOFF_notebook-wave-j_2026-09-07.md` at the root of
> `C:\Users\Patrick\uct-worktrees\notebook-primary-platform` in full. Verify its
> git-state claims against the actual current `git status`/`git log`/
> `git rev-parse HEAD` in that worktree, and verify `origin/notebook-primary-platform`
> actually carries the commits it claims. Report back exactly what you find —
> including any discrepancy from the handoff — before taking any action. Then
> proceed per the handoff's own "R. NEXT RECOMMENDED ACTION" section: fix the one
> concretely-identified stale test assertion, re-run the full frontend suite and
> triage every failure, then move to the real-browser E2E pass for the PDF.js
> viewer (never yet verified) before continuing through the rest of Wave J. Standing
> rule: no forks/subagents for any part of this. Do not merge or deploy anything
> until Wave J is genuinely closed per the handoff's own description of this
> program's established closure process.
