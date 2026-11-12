# Notebook Simplify (preview build) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Notebook quieter and simpler on screen (about 103 clickable things on an open note down to about 70) without removing a feature, as real code on a branch the owner can look at on localhost before anything goes live.

**Architecture:** Client-only changes under `app/src/pages/journal-2-0/` plus two shared components. Things are folded, merged or moved one click away; nothing is deleted from the product and no server route, table or flag changes. This is the PREVIEW pass: the look is built and unit-tested; walkthrough re-pointing, the real-browser walk and the deploy gate are a later go-live pass after the owner approves the look.

**Tech Stack:** React + Vite SPA, CSS modules, vitest + Testing Library. No new dependency.

**Spec:** the owner-approved proposal, `C:\Users\Patrick\Documents\UCT-Notebook-Simplify-2026-11-11\index.html` (local file, nine numbered changes with before/after pictures). The owner's words: "lets do all that but show me what it would look like in a local host first before we make it live and final".

## Global Constraints

- No feature removed. Every template, widget, walkthrough, view, export and AI tool stays reachable.
- No server, API, database or feature-flag change. No new feature flag (ruling: pre-launch, rollback is a revert).
- No new dependency. Never run `npm install` / `npm ci`: `app/node_modules` in this worktree is a junction into another worktree's install.
- No emoji; icons are `UIcon` only. Breakpoints are 640 and 1024 only. Nothing animates forever.
- Every existing `data-tour` value keeps existing exactly once (`components/notebook/onboarding/tourAnchors.test.js` stays green). A control that moves into a menu keeps its anchor on the item or on the menu's button.
- Desktop is the target. Phone and tablet (touch tier, 1024 and below) keep their current rows and menus; do not remove a phone-only door.
- Copy: plain words, sentence case. One word per thing: Notebook, Template, Insert, AI, Help.
- Tests: focused vitest files only, from `app/`: `npx vitest run <file> <file>`. Never the whole suite, never backend pytest. Read the runner's own exit status and totals line (no `| tail`).
- Every new or changed test is proven able to fail once (break the code, see red, restore from a saved copy, never `git checkout`).
- Git: commit locally once per task on `feat/notebook-simplify`, naming files (`git add <paths>`, never `-A`). Never push. Never `git stash`.
- Deferred to the go-live pass, and recorded, not fixed here: walkthrough steps that now point at a folded control, `tools/notebook_fin_walk.py`, `tools/notebook_door_audit.py`, `tools/notebook_perf_budgets.py`. Each task appends what it deferred, and any pre-existing test it had to change and why, to `docs/notebook/simplify-2026-11-11-ledger.md`.

## Review Focus

1. A member whose stored `notebook_landing` is `today` or `home` opens the Notebook: lands on the notes list, no error, and no daily note is created just by opening it. (Task 5)
2. Old links still land somewhere sensible: `?view=home`, `?view=today`, `?note=<id>`, the `#search` door. (Task 5)
3. The row a member is on sits inside a fold (Trash, Archived, Unfiled, a tag filter): the fold is open so the active row is visible. (Task 2)
4. A filtered list or saved view that matches nothing while the account has notes says "No notes match this view", never "Your notebook is empty", and offers Clear filter, not the template wall. (Task 2)
5. A member without Writing help (free plan or flag off) sees one plain "Ask this note" button, not a one-item menu; the caret is in a quote or code block and the "Aa" button reads as active. (Task 4)

---

### Task 1: Quiet frame and no unprompted offers (changes 2, 8, title half of 9)

**Files:**
- Modify: `app/src/pages/journal-2-0/JournalLayout.jsx` (header, about lines 280-450) and its CSS module
- Modify: `app/src/pages/journal-2-0/components/notebook/onboarding/TourOfferDoor.jsx` (and `tourEligibility.js` if the gate lives there)
- Modify: `app/src/components/voice/FloatingOrb.jsx` (the "Meet Compass" coachmark, about lines 51-80)
- Modify: `app/src/pages/journal-2-0/components/notebook/GettingStartedChecklist.jsx`
- Modify: `app/src/pages/journal-2-0/components/notebook/onboarding/LearnMenu.jsx`
- Modify: `app/src/pages/journal-2-0/components/notebook/styles/KindSection.jsx` (the "How do you trade?" card, about line 121)
- Test: the existing test file beside each (create `JournalLayout.notebookHeader.test.jsx` if none covers the header)

**Decisions:**
- "On the Notebook" means the pathname starts with `/journal/notebook`.
- On the Notebook, desktop: the header shows the six section tabs and Help only. Log Trade, the account selector, Generate report, the settings gear and the More menu are not rendered. On every other Journal page the header is unchanged. The UCT Agent button, where shown today, stays.
- On the Notebook the page title reads "Notebook" (elsewhere it stays "Trade Journal").
- The "New in your Notebook: <tour>" offer never opens by itself. The component and its queue stay; the automatic trigger is off. Walkthroughs stay reachable from Help.
- The "Meet Compass" card does not show while on the Notebook (it may still show on other pages, once, as today).
- The Get started checklist renders only while the member has zero notes.
- The "How do you trade?" card renders only when the account truly has zero notes (never above a filtered-empty list).
- The Learn menu shows no "New" badges ("Done" may stay).

- [ ] **Step 1: Write failing tests** for: header control set on `/journal/notebook` vs `/journal/trades`; title text; offer door does not open on mount with an eligible tour; coachmark absent on the Notebook path; checklist absent with one note; no "New" badge in Learn.
- [ ] **Step 2: Run them, see them fail.** `npx vitest run <those files>`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them plus the neighbouring existing suites** (`JournalLayout*`, `TourOffer*`, `GettingStarted*`, `LearnMenu*`, `FloatingOrb*`, `tourAnchors.test.js`). All pass, or the change to a pre-existing expectation is recorded in the ledger with the reason.
- [ ] **Step 5: Commit** `feat(notebook): quiet header and no unprompted offers`.

### Task 2: Left panel is for finding notes (change 3 and the empty-message defect)

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx` (+ CSS module)
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (View menu about line 2838; empty states about lines 3043-3084)
- Test: `FolderSidebar*.test.jsx`, `tabs/NotebookTab.toolbar.test.jsx`, new `FolderSidebar.folds.test.jsx`

**Interfaces:**
- Produces: localStorage keys `uct.notebook.sidebar.moreOpen` and `uct.notebook.sidebar.tagsOpen`, both `'1'` / absent, default closed.

**Decisions:**
- Order, top to bottom: Favorites (when any), Recents (when any), All notes, the folder tree, "+ New folder", a fold labelled "More", a fold labelled "Tags".
- "More" holds Unfiled, Archived, Trash and the My Playbook link. A zero counter is not shown. The fold is forced open while the active view is one of its rows.
- "Tags" holds the existing tag list unchanged, including its filter box. Forced open while a tag filter is active. The rename pencil shows on hover and on keyboard focus (always on touch).
- Saved views leave the panel and become a "Saved views" group at the bottom of the View menu: one row per view (click applies it), rename and delete on each row, and the "Add thesis starter views" action there when the member has none.
- The "Today" row is handled in Task 5; leave it in place here.
- Empty states: when the list is empty because of a filter, saved view, search or tag while the account has notes, show "No notes match this view." with a "Clear filter" button and nothing else. The template picker and "Import notes" show only when the account has zero notes.

- [ ] **Step 1: Write failing tests** for: default fold state; persistence; forced-open on active row and on tag filter; zero counters hidden; saved views listed in the View menu and absent from the panel; the filtered-empty sentence with notes present; the zero-notes state unchanged.
- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them plus existing `FolderSidebar*`, `NotebookTab.toolbar*`, `NotebookTab.toolbarFits*`, saved-view suites and `tourAnchors.test.js`.**
- [ ] **Step 5: Commit** `feat(notebook): left panel folds, saved views in the View menu, honest empty message`.

### Task 3: A list that is a list, and one New menu (change 4, New-menu half of 9)

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (list render, View menu, New menu about lines 2283-2305) + CSS module
- Modify: `app/src/pages/journal-2-0/components/notebook/NoteCard.jsx` + `NoteCard.module.css`
- Test: `NoteCard*.test.jsx`, `NotebookTab.toolbar.test.jsx`, new `NotebookTab.listLayout.test.jsx`

**Interfaces:**
- Produces: localStorage key `uct.notebook.list.layout` = `'rows'` (default) or `'cards'`. This is a display choice inside List view, not a new view mode: `SAVEABLE_VIEW_MODES` and the server list are untouched.

**Decisions:**
- List view, layout `rows`: one note per row in a single column, max width 860px, a hairline between rows, no card border or background. Line one: the title (16px, one line, ellipsis). Line two: relative date, then `$TICKER`, then up to three tags in the muted text colour (no blue chips), then the subtitle if there is one. Lock and "Not synced" marks stay. Hover and keyboard focus show a subtle row highlight.
- The select tick box shows on row hover, on keyboard focus, and on every row once anything is selected; always on touch.
- The View menu gains, under List, a two-way choice "Rows" / "Cards". "Cards" is today's grid, unchanged.
- The New caret menu is: Blank, From a template, Voice note, Import. "From an outline" is removed (it opened the same sheet); "From a template" keeps today's behaviour of its own row. Add a group "Reviews": Today's recap, This week's review, This month's review, calling the same actions Research home's "Reviews that write themselves" buttons call.
- The toolbar's "Today" button is relabelled "Today's note".

- [ ] **Step 1: Write failing tests** for: rows is the default and renders one column of rows with the meta line; choosing Cards persists and restores the grid; tick box visibility rules; New menu items and order; the three review items call the review action.
- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them plus existing `NoteCard*`, `NotebookTab.toolbar*`, `NotebookTab.toolbarFits*`, `NotebookTab.touchTier*`, `tourAnchors.test.js`.**
- [ ] **Step 5: Commit** `feat(notebook): notes as rows, one New menu`.

### Task 4: A calmer editor (changes 5, 6, 7)

**Files:**
- Modify: `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx` (header about lines 5232-5485, toolbar about lines 5582-5865) + CSS module
- Modify: `app/src/pages/journal-2-0/components/notebook/NoteDetailsLine.jsx`
- Modify: `app/src/pages/journal-2-0/components/notebook/NoteMenuActions.jsx`, `NoteExportControls.jsx`, `AskPanel.jsx` only as far as the trigger needs
- Test: `NoteEditorPage.moreMenu.test.jsx`, `NoteEditorPage.toolbarOneStop*`, `NoteEditorPage.headerFits*`, `NoteEditorPage.details*`, new `NoteEditorPage.calmToolbar.test.jsx`

**Decisions:**
- Desktop formatting row, in order: B, I, H1, H2, bullet list, numbered list, link, image, mic (where shown today), "Aa", Insert. The touch row is unchanged.
- "Aa" (aria-label "More formatting") opens a menu holding Font, Size, Text colour and highlight, Quote, Code, Attach a file, Divider, each doing exactly what its button does today. Escape closes it and returns focus to "Aa". "Aa" reads as active when the caret is in a quote or code block.
- The Insert button's accessible name is "Insert".
- Note header, desktop: Saved indicator, Favorite, one "AI" button, Share, More. "AI" opens a two-item menu: "Ask about this note" (today's Ask this note) and "Writing help" (today's Writing help), each opening its existing panel. If only one of the two is available to this member, render that one as the plain button it is today.
- The line under the title shows the folder select, up to three tags, the ticker and the Details toggle. Sector, "N properties" and the reviewed status are no longer in the summary; they stay inside Details. Linked-trade chips stay.
- More menu: one "Save as template" entry; choosing plain or "keep live blocks" happens inside what it opens (default plain). PNG and Print move inside the Export submenu, above the file formats. Everything else unchanged. Result: Find in note, Outline, History, Duplicate, Make this a thesis, Lock, Archive, Save as template, Open a note beside, Export, Move to Trash.

- [ ] **Step 1: Write failing tests** for: the desktop row's exact button set and order; each "Aa" item triggers the same editor command as before; "Aa" active state; AI menu items and the single-capability fallback; details summary content; More menu entry list; PNG and Print inside Export.
- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them plus existing `NoteEditorPage.moreMenu*`, `toolbarOneStop*`, `headerFits*`, `phoneHeader*`, `phoneHeaderRow*`, `details*`, `NoteDetailsLine*`, `NoteMenuActions*`, `NoteExportControls*`, `AskPanel*`, `tourAnchors.test.js`.**
- [ ] **Step 5: Commit** `feat(notebook): calmer editor header, toolbar and More menu`.

### Task 5: Open on your notes (change 1)

**Files:**
- Modify: `app/src/pages/journal-2-0/lib/todayHome.js`
- Modify: `app/src/pages/journal-2-0/tabs/NotebookTab.jsx` (landing resolution, toolbar)
- Modify: `app/src/pages/journal-2-0/components/notebook/FolderSidebar.jsx` (the Today row, about line 1953)
- Modify: `app/src/pages/journal-2-0/components/notebook/TodayHome.jsx`
- Modify: `app/src/pages/journal-2-0/components/notebook/ResearchHome.jsx` only as needed to reuse its sections
- Test: `lib/todayHome.test.js`, `TodayHome*.test.jsx`, `ResearchHome.*.test.jsx`, new `NotebookTab.landing.test.jsx`

**Decisions:**
- A bare `/journal/notebook` always opens the notes list (All notes). The stored `notebook_landing` preference is no longer read for landing; `resolveLanding` returns `'all'` for every input. Opening the Notebook never creates the day's note.
- `?view=today` opens the Daily brief page. `?view=home` opens the notes list. `?view=all`, `?note=`, `#search` behave as today.
- The left panel's "Today" row is renamed "Daily brief", sits directly under "All notes", and opens `?view=today`. It shows no weekday counter.
- The Daily brief page is today's Today home with: the "Open the Notebook on" select and the "Research home" link removed; its "All notes" header button kept; and, below the cards, Research home's "Reporting soon" and "Passed setups" sections, folded by default.
- The notes-list toolbar gains an "AI" button, left of "Today's note", that opens Research home's notebook-wide Ask (and its "tell Notebook what to change" action where that is available today). Anchors that lived on Research home's Ask move with it.
- Research home is no longer routed to. Its component file stays if sections are reused; if any module becomes unreachable and `components/screener/reachable.test.js` flags it, record it in the ledger for the go-live pass rather than deleting product code now.
- A member with zero notes still gets the first-run sheet and the list's own empty state (template picker, Import).

- [ ] **Step 1: Write failing tests** for: bare route renders the list for stored values `today`, `home`, `all` and none; no daily-note request fires on a bare open; `?view=home` renders the list; `?view=today` renders Daily brief without the landing select; the sidebar row label and target; the toolbar AI button opens the Ask panel.
- [ ] **Step 2: Run, see fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them plus existing `todayHome*`, `TodayHome*`, `ResearchHome*`, `NotebookTab.toolbar*`, `FolderSidebar*`, `tourAnchors.test.js`, and `components/screener/reachable.test.js`.** Suites that asserted the old landing are updated to the new decision and listed in the ledger.
- [ ] **Step 5: Commit** `feat(notebook): open on the notes list, one optional home`.

### Task 6: Build and hand over the preview

- [ ] **Step 1:** `cd app && npm run build`; exit 0.
- [ ] **Step 2:** Boot the local sandbox with production's armed flags (`python tools/notebook_fin_walk.py --config c1 --data-root <empty dir outside C:\data> --port 8134 --out <dir> --tip <sha> --serve-only`), seed the sample member, and capture the same screens as the proposal's "before" set at 1920x945 and 390x844.
- [ ] **Step 3:** Count clickable things on the list and on an open note with the proposal's census script; record the numbers in the ledger.
- [ ] **Step 4:** Open the preview for the owner.
