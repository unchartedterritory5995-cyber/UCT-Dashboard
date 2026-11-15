# Notebook Simplify, Pass 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One name per thing in the Notebook, a Daily brief that draws only what has content and never creates a note by being opened, and shorter menus, using only reversible moves.

**Architecture:** Client-only copy and layout changes in `app/src/pages/journal-2-0/` plus two small server changes (the client asks the existing `make=0` form of today's read; new members' daily folder gets a clearer name). Menus gain a "second view" inside the existing menu engine (`useMenuButton` / `MenuRows` in `components/notebook/NewNoteMenu.jsx`, the pattern `NoteFormatMenu.jsx` uses for Font and Size) instead of new components. Nothing is deleted.

**Tech Stack:** React 19 + Vite, CSS modules, vitest + Testing Library; FastAPI + SQLite, pytest (scoped files only).

**Spec:** `docs/superpowers/specs/2026-11-12-notebook-simplify-2-design.md` (read it; this plan argues from it).

## Global Constraints

- Reversible moves only: rename, hide while empty, move one click deeper. No feature, route, template, widget, walkthrough, view or export is deleted.
- No emoji (icons are `UIcon`). Breakpoints 640 and 1024 only (copy the `@media` strings from `app/src/styles/breakpoints.css`). Tokens, not raw px, in new CSS. Nothing animates forever. Member-visible copy: plain words, sentence case, no em dash.
- No new dependency, no new feature flag, no schema change. Never `npm install` / `npm ci` (`app/node_modules` is a junction into another worktree's install).
- Every `data-tour` value exists exactly once (`components/notebook/onboarding/tourAnchors.test.js`); a control that moves takes its anchor with it; every walkthrough keeps at least one step at phone, tablet and desktop (the registry rail) and still runs start to finish.
- First-open bytes do not grow: after a build, `python tools/notebook_perf_budgets.py --dist app/dist` must PASS (budget 2,260,793 B; 2,256,355 B at the start). On-demand code a member types into loads through `app/src/pages/journal-2-0/lib/heldModule.js`, never `React.lazy` + Suspense.
- Tests: focused vitest files only, from `app/` (`npx vitest run <file> <file>`), never the whole suite; backend pytest only by named file. Read the runner's own totals line; never pipe a runner to `tail`. Every new or changed guard is broken on purpose once, seen red, and restored from a saved copy (never `git checkout`).
- Git: commit locally per task, naming files (`git add <paths>`, never `-A`). No push, no merge, no stash. Never commit anything under `docs/plans/joystick/sandbox-runs/`. The repository is public: no local absolute path, account email, token or member data in anything committed.
- Known reds on master that are not this work's and must not be added to: `components/screener/reachable.test.js`, `lib/persistence/persistenceManifest.test.js`, `pages/command/keyListenerCensus.test.js`, `lib/formula/offlineNeverStoresComputed.test.js`, `widgetFormula.lazy.test.js`, `styles/tokens.reachable.test.js`.
- Each task appends a dated section to `docs/notebook/simplify-2026-11-11-ledger.md`: what moved, how to undo it in one line, every walker or door-table string the change invalidates (grep `tools/notebook_*.py`, `tools/notebook_door_audit_doors.json`, `tests/test_notebook_*`), and any existing test it had to change and why. Tasks 1 to 3 do not edit `tools/` or the Python walker tests; Task 4 does.

## Review Focus

1. Today's note exists / is in Trash / was made earlier by a page load: opening the Daily brief creates nothing, resurrects nothing, and the button says "Open today's note", offers Restore, or says "Start today's note" respectively. (Task 2 tests.)
2. An existing member with a "Daily" folder keeps using it; a member with both "Daily" and "Daily notes" gets new daily notes in the one that already holds daily notes (the older "Daily"), never split. (Task 2 pytest.)
3. A saved view of type graph or timeline, and a `?view=timeline` link, still open with the modes tucked; the View button names the mode. (Task 3 tests.)
4. The Daily brief for a member with nothing: no empty heading, no layout jump when the second read lands, no request added to a plain Notebook open. (Task 2 tests.)
5. Every menu with a second view: Enter or click opens it with focus on its first row; a "Back" row and Esc return to the first view with focus on the row that opened it; a second Esc closes the menu and returns focus to the menu's button; arrow keys skip nothing. (Task 3 tests, one shared helper.)

---

### Task 1: One name per thing (spec section A, except A3)

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/TodayHome.jsx` (header: A1), `components/notebook/styles/StylesManager.jsx` and `styles/SaveAsStyleForm.jsx` (A4), `styles/StyleUpdateSheet.jsx` and `app/src/pages/Support.jsx` (A5), `components/notebook/AskPanel.jsx` and `components/notebook/NoteEditorPage.jsx` (A6), `app/src/components/MobileNav.jsx` (A7), `components/notebook/NotebookPlusSheet.jsx` and `tabs/NotebookTab.jsx` (A8, A9, A10), `components/notebook/NoteEditorPage.jsx` (A9).
- Test: the existing suite beside each file, plus `app/src/components/MobileNav.test.jsx` (create if absent).

**Interfaces:**
- Produces: the Daily brief's visible heading is an `<h2>` with the exact text `Daily brief` (Task 2 keeps it). The greeting sentence moves into the date line as its first part ("Good morning, {name} · Thursday, Nov 12 · ...").
- Produces: `NotebookPlusSheet` gains a prop `onAskNotebook: () => void`; its row reads `Ask your Notebook` and calls it. `NotebookTab` passes the same handler the More row "Ask your Notebook" uses. The row keeps its paid-only condition. Compass stays reachable from the Journal's Compass tab.
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests.** One assertion per row of spec table A (A1, A4 to A10) against the member-visible string, by role and accessible name. A7: `titleFor('/journal/notebook')`, `titleFor('/journal/notebook/setups')` return `Notebook`; `titleFor('/journal/trades')` still returns `Journal` (export `titleFor` if it is not exported). A8: pressing the "+" sheet's row calls `onAskNotebook` and does not navigate to `/journal/compass`. A4: after adding a note type the status line reads `Note type added.`; after renaming, `Note type renamed.`; the picker's empty option reads `Choose a note type`; the delete control's name contains `note type`. A6: the plain header button's name is `Ask about this note`.
- [ ] **Step 2: Run them; each fails on the old words.**
- [ ] **Step 3: Change the strings and the one behaviour (A8).** For A4 and A5 grep the whole of `app/src` for member-visible "kind" and "layout" used with these meanings (strings and JSX text, not identifiers or comments) and change every hit; leave a "kind" that means a price-level role in `TradeCanvasDialogs.jsx` and "layout" that means the page-layout panels.
- [ ] **Step 4: Run the suites of every touched file, plus** `tourAnchors.test.js`, `notebookTokens.lint`, the a11y surfaces for the touched components, and any test that pinned an old sentence (update it honestly and list it in the ledger).
- [ ] **Step 5: Red-prove each new assertion, then commit** (`feat(notebook): one name per thing ...`), with the ledger section.

### Task 2: Daily brief shows only what it has (spec section B and A3)

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/TodayHome.jsx`, `TodayHome.module.css`, `TodayHomeNotes.jsx` if needed, `app/src/pages/journal-2-0/lib/todayHome.js` (the read's URL), `tabs/NotebookTab.jsx` (only where it decides `make` for the Daily brief read, near the `viewParam` block), `app/src/pages/Support.jsx` (the Daily brief answer gains the moved teaching sentences).
- Modify (server): `api/services/journal_two/note_daily.py` (A3 only).
- Test: `components/notebook/TodayHome*.test.jsx`, `lib/todayHome.test.js`; pytest `tests/test_note_daily*.py` (find the file that covers `open_daily_note`; add cases there) and the personal-API walk test that pins `DAILY_FOLDER_NAME` (`tests/test_notebook_personal_api_walk.py`).

**Interfaces:**
- Consumes: Task 1's `<h2>Daily brief</h2>`.
- Produces (client): the Daily brief's read is `GET /api/j2/notes/today?make=0` always. A new handler `startTodayNote()` in `TodayHome` calls the existing create path the list's "Today's note" button uses (passed down from `NotebookTab` as the existing `onOpenToday`-style prop; do not write a second create path), then opens the note.
- Produces (server): `note_daily.DAILY_FOLDER_NAME = "Daily notes"` and `note_daily.LEGACY_DAILY_FOLDER_NAMES = ("Daily",)`. The folder lookup returns, in order: a root folder named any legacy name (oldest first), else one named `DAILY_FOLDER_NAME`, else creates `DAILY_FOLDER_NAME`. No rename, no migration.
- Header: one button. Text `Open today's note` when today's note exists, `Start today's note` when it does not, and the existing Restore / "Start a fresh one" pair when it is in Trash. "Quick capture", "All notes" and "+ New" are removed from the header (their other doors are unchanged).

- [ ] **Step 1: Server tests first** (pytest, named file): a member with a root folder "Daily" gets today's note there and no "Daily notes" folder is made; a member with neither gets a "Daily notes" folder; a member with both gets the note in "Daily"; `get_today(..., make=False)` on a member with no note returns `missing: true` and creates neither note nor folder (assert row counts before and after).
- [ ] **Step 2: Run; the first three fail.** Implement the lookup. Run again; all pass. Run `tests/test_notebook_personal_api_walk.py` and every other pytest file that names `DAILY_FOLDER_NAME` or the literal folder name (grep `tests/` for `"Daily"`), by file name.
- [ ] **Step 3: Client tests:** (a) mounting the Daily brief issues exactly one today read and its URL carries `make=0`; no POST; (b) with `missing: true` the header button reads `Start today's note`, pressing it calls the create path once and opens the note; (c) with a note, `Open today's note`; (d) a card whose section is empty is not in the document (query by its heading: "Open from yesterday", "On this day", "Today's plan" with no open lines) and its teaching sentence is not on the page; (e) with every section empty the page shows the one quiet line from spec B5 and the two compact asks, and no `<h3>` without content; (f) the compact asks contain a heading, one sentence and the field, and no ordered list; (g) the first-run slot, "Needs review", "Notes on your open positions", Notices and the two folded boxes still draw under their existing conditions; (h) a second read landing does not unmount the cards (the existing latch tests still pass).
- [ ] **Step 4: Implement B1 to B5.** Keep the session-dependent card ORDER as it is; only skip empty ones. Keep every `data-tour` anchor on the Daily brief (`reporting-soon-list`, `passed-list`, the setups card's anchors, the first-plan ask's); if an anchored element is no longer drawn when empty, the walkthrough that needs it must still open: check `tours/b2Trading.js`, `tours/b3Research.js` and the base tour, and keep the anchored element drawn for a member the tour would be offered to, or move the anchor to the compact ask.
- [ ] **Step 5: Run** every `TodayHome*` suite, `todayLanding.tours.test.jsx`, `todayLanding.anchor.test.jsx`, `tourReachability.test.jsx`, `tourAnchors.test.js`, `phoneHiddenAnchors`, the a11y recipe for the Daily brief, `notebookTokens.lint`, `Support.notebook.test.jsx`. Build and run the byte budget.
- [ ] **Step 6: Red-prove each new guard (client and server), then commit** with the ledger section (it must list that the Daily brief no longer creates the note, so the walkers' "visit the brief, then expect today's note" steps need re-pointing).

### Task 3: Fewer rows (spec sections C and D)

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/NewNoteMenu.jsx` (+ `.module.css`): second-view support in `MenuRows`; `tabs/NotebookTab.jsx` (View menu C1, New and More menus C2, empty list C5, phone row words C6, sample hold D2, hash close D3); `components/notebook/NoteExportControls.jsx` and `NoteMoreMenu.jsx` (C3); `components/notebook/WidgetPalette.jsx` (C4); `components/notebook/onboarding/RegistryToursGate.jsx` (D1); `components/notebook/onboarding/sampleNotebook.js` (D2); `onboarding/tours/reviewDrafts*.js` (the Reviews walkthrough's steps).
- Test: the suite beside each, plus a new shared helper `app/src/pages/journal-2-0/components/notebook/menuSecondView.testkit.js`.

**Interfaces:**
- Produces: a `MenuRows` item may carry `children: Item[]` and `childLabel: string`. Pressing it replaces the menu's rows with a first row `Back` (icon chevron-left, accessible name `Back to {parent menu label}`) followed by `children`, inside the SAME `role="menu"` element (no nested popup, no flyout). Focus moves to the first child row. `Back`, Esc and ArrowLeft return to the parent rows with focus on the row that opened the view; Esc on the parent rows closes the menu. The menu's height cap and phone clearance (pass 1) apply unchanged. If `NoteFormatMenu.jsx` already implements this for Font and Size, lift ITS implementation into `MenuRows` and make `NoteFormatMenu` use the shared one; do not write a second mechanism.
- Produces: `menuSecondView.testkit.js` exports `expectSecondView({ openMenu, parentRowName, childRowNames })`, which asserts Review Focus item 5 for any menu; every menu changed here calls it.
- C1: View menu rows: List (with "Show as" Rows / Cards while active), Table, Board, Calendar, Tasks, `More views` (children: Graph, Timeline), Save view, Saved views. When the active mode is Graph or Timeline the View button still reads `View: Graph` / `View: Timeline` and the `More views` row shows as the active one.
- C2: New menu rows: Blank, From a template, Voice note, Import, `Draft a review` (children: Today's recap, This week's review, This month's review; the busy/disabled behaviour stays on the children). Phone More: the same single row in place of the "Reviews" heading and its three rows. Anchors `review-drafts-daily/-weekly/-monthly` stay on the three children; the parent row gets a new literal anchor `review-drafts-open` (desktop) and keeps `review-drafts-phone` on the phone parent row. The Reviews walkthrough gains one step ("Open Draft a review", `waitFor` the first child) at each tier and stays within the registry's step budget.
- C3: the note's More panel shows one row `Export` (children: PNG, Print, Markdown, Web page, JSON, Word, in today's order and with today's handlers and names). The command palette's "Export this note" and the list's whole-notebook Export are unchanged.
- C4: `WidgetPalette` draws the "More" group collapsed behind a button `Show all` (accessible name `Show all blocks`) at the foot; once opened it stays open for that palette session. Search in the palette, if it has one, still finds items in the collapsed group.
- C5: on the zero-notes list, the inline "Start from a template" grid is not drawn while the Get started card is up (use the same `useGettingStartedCardUp()` signal pass 1's sample door uses); otherwise unchanged.
- C6: at 640 and below the removal row's label is `Remove sample notebook`; above, unchanged. One element, two labels by CSS-visible spans or a width hook already used in the file; the accessible name matches the visible words at each width.
- D1: `RegistryToursGate` releases a held Help-started walkthrough after 10 000 ms of first-run hold and shows the existing `TOUR_FAILED_NOTICE`. D2: `describeSampleHold` keeps a separate sentence for a `blocked` note: its title, then "is waiting to sync. Edit it once more so it can save, then remove the sample again." D3: when the location's hash stops being `#templates` (browser Back), the New note sheet opened by that hash closes; a sheet opened by a button is not affected.

- [ ] **Step 1: Write the testkit and the failing tests** for C1 to C6 and D1 to D3 (each asserts the rows by role and name in order, the anchors, and calls `expectSecondView` where a second view exists; C1 also asserts a saved view of type `graph` and the URL `?view=timeline` render their views and the button names them).
- [ ] **Step 2: Run; they fail.**
- [ ] **Step 3: Implement the shared second view in `MenuRows`, then C1, C2, C3; then C4, C5, C6; then D1 to D3.** Commit after each of the three groups.
- [ ] **Step 4: Run** every suite beside a touched file, `NewNoteMenu.test.jsx`, `NoteFormatMenu` suites (it now uses the shared view), `NotebookTab.goLiveMenus.test.jsx`, `NotebookTab.toolbar.test.jsx`, `NotebookTab.sampleRemove.test.jsx`, the tour rails (`tourAnchors`, `tourRegistry`, `tourReachability`, `phoneHiddenAnchors`, `todayLanding.*`, `GenericTourEngine.tiers`), `a11y/simplifyMenus.a11y.test.jsx` and `a11y/surfaceCoverage.test.js` (add recipes for the second views, drawn open), `notebookTokens.lint`, `targetFloors`. Build; byte budget must PASS.
- [ ] **Step 5: Red-prove each new guard, then the ledger section.**

### Task 4: Instruments, acceptance walk and evidence

**Files:**
- Modify: `tools/notebook_fin_walk.py`, `tools/notebook_fin_walk_features.py`, `tools/notebook_door_audit.py`, `tools/notebook_door_audit_doors.json`, other `tools/notebook_*` walkers named in the three ledger sections, and the Python tests that pin their words (`tests/test_notebook_*walk*.py`, `tests/test_notebook_door_audit.py`).
- Create: `docs/notebook/evidence/fin-walk/<short sha>/` (redacted like `13f1b01f5e`), a dated section in `docs/notebook/fin-walk.md`, a ledger section, and before/after screenshots under `docs/notebook/evidence/simplify-2/` for every row of spec tables A, B and C at 1280 and, where the change is phone-only, 390.

**Interfaces:**
- Consumes: the "strings invalidated" lists in the ledger sections of Tasks 1 to 3.

- [ ] **Step 1:** Update every listed walker and door-table string; run the named pytest files (totals line).
- [ ] **Step 2:** Build; byte budget. Boot ONE held c2 sandbox from an empty data root outside `C:/data` on port 8132 (`python tools/notebook_fin_walk.py --config c2 --data-root <empty temp dir> --port 8132 --out <temp out> --tip <sha> --serve-only`) and iterate with `--attach --only <steps>` until the steps this pass touches are green: the Daily brief steps (no note on visit; Start today's note), the View menu (More views), New and More menus (Draft a review), note export, Insert palette, the empty list, every walkthrough at 1280 / 820 / 390, the sample steps.
- [ ] **Step 3:** One FULL c2 run from a fresh empty data root at the final head. Classify every row that is not PASS from the page's own answer: INSTRUMENT (re-point, re-run) or PRODUCT (smallest fix with a focused vitest and red proof, rebuild, re-run; anything over about 40 lines or needing a design call is left red and reported). The bar: zero PASS -> FAIL against `13f1b01f5e` + `7e849c6740-rewalk` that is PRODUCT.
- [ ] **Step 4:** Door audit at 1280 and 390 (`--self-check` first): zero HIDDEN; no door EASY before and HARD now without a line in the ledger.
- [ ] **Step 5:** Take the before/after screenshots (before = production's current build is not available locally: use the pass 1 evidence shots where they exist, otherwise describe "before" in one line), commit evidence and docs.

Never weaken a check to get green. A step is re-pointed at the door a member now uses, never deleted, skipped or turned into INFO.
