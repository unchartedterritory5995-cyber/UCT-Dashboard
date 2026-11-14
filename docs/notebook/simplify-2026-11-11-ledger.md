# Notebook simplify 2026-11-11 ledger

## Task 1: quiet frame and no unprompted offers

Deferred (go-live pass):
- Walkthrough steps that point at header controls now not rendered on the desktop Notebook (Log Trade, account selector, Generate report, settings gear, More). Tours and `tools/notebook_fin_walk.py`, `tools/notebook_door_audit.py` may reference them.
- Community and Accounts (the More menu) and Portfolio settings are not reachable from the desktop Notebook header; they stay on every other Journal page and in the touch-tier header.
- `LEARN_COPY.isNew` and `.newBadge` CSS are now unused (left in place; remove at go-live).
- A member who deletes every note sees the Get started list again (its done-state is no longer recorded once a note exists, because the gate does not mount the list).

Pre-existing test expectations changed (old behaviour deliberately changed):
- `onboarding/darkImports.test.jsx`: door tests that expect the gate to load now build the door with the automatic trigger on (third argument `true`); new case proves the app's own door loads nothing.
- `onboarding/LearnMenu.progress.test.jsx`: never-taken tours no longer carry a "New" mark or description; "Done" unchanged.
- `voice/FloatingOrb.coachmark.test.jsx`: the slot-landing case now uses `/journal/trades`; the "Notebook on a wider screen shows it" control now asserts the card waits there too.
- `notebook/GettingStartedChecklist.test.jsx`: cases that drive the list's tick and close rules with `hasAnyNotes: true` mount `GettingStartedList` directly, since the gate now renders nothing once a note exists (new cases cover the gate).
- `a11y/gettingStarted.a11y.test.jsx` (progress surface) mounts `GettingStartedList` directly, same reason as above.
- `notebook/ResearchHome.checklist.test.jsx`: "still there once the member has notes" became "gone once the member has notes".

## Task 2: left panel is for finding notes, honest empty message

Deferred (go-live pass):
- Base tour copy `tourCopy.js` (`sidebar` step): "Your folders, tags and saved views live here." Saved views are now the View menu's "Saved views" group, and tags sit under the panel's "Tags" fold (closed by default). The step's anchor (`data-tour="sidebar"`) is unchanged; its sentence and any step that expects a tag or shelf row on screen need the go-live pass. Pinned by `onboarding/NotebookTour.test.jsx` / `baseTour.zeroDrift.test.jsx`, left as they are.
- `tools/notebook_fin_walk.py`, `tools/notebook_door_audit.py`, `tools/notebook_proof_walk.py`: any step that clicks Unfiled, Archived, Trash, My Playbook or a tag in the panel must open the "More" / "Tags" fold first; any step that reopens a saved view by its panel row (`get_by_title(view_name)`) must open the View menu instead (the row keeps `title={view.name}`, and Rename/Delete keep their titles "Rename view"/"Delete view").
- Saved views are reachable from the notes list only (its View menu). Research Home, the Today home and an open note no longer list them; the way in is All notes, then View. Hidden too in the Trash and Archived lists, where the View menu is not drawn (unchanged).
- The toolbar's own "Clear filter" (pre-existing) clears the filters without the `view=all` flag, so after a saved view (which drops `?view=`) it lands on the member's landing page, not All notes. The new empty message's "Clear filter" lands on All notes. Not changed here.
- Deleting the saved view in use still drops the member on their landing page (pre-existing; the list's filters all clear). Focus then goes to the pane heading.

Pre-existing tests changed (old behaviour deliberately changed):
- `FolderSidebar.test.jsx`: the Saved Views section describes (Wave E, UX #1, J5 and row icons) moved, contract for contract, to the new `SavedViewsMenuGroup.test.jsx`; the double-click-to-rename case was dropped (a menu row applies on click, so the pencil is the rename door) and the `.viewRow` stylesheet case went with the rule. Opens both folds in `beforeEach`.
- `FolderSidebar.tags.test.jsx`, `FolderSidebar.tagRename.test.jsx`, `FolderSidebar.playbook.test.jsx`: open both folds in `beforeEach` (they test what the rows do; the folds have their own file, `FolderSidebar.folds.test.jsx`).
- `FolderSidebar.tree.test.jsx`: the Folders tree's rows are All notes then the folders; Unfiled/Archived/Trash are the "More" fold's own tree (new case); Down from All notes lands on the first folder.
- `NotebookTab.test.jsx`: the stubbed panel lost its saved-view buttons; the saved-view select/delete/rename cases press the real View menu rows; "on Research Home the Delete button opens the confirm" became "Research Home offers no saved-view row".
- `NotebookTab.savedViewRestore.test.jsx`, `NotebookTab.timeline.test.jsx`: reopen the saved view from the View menu instead of the panel.
- `a11y/deleteFocusFallback.test.jsx`: a saved-view delete now hands focus back to the View menu button (the confirm's invoker), or to the pane heading when the delete takes the list away; the neighbouring-row landing went with the panel rows.
- `NotebookTab.toolbar.test.jsx`: the mode list excludes the saved-views group's radios.
- `styles/notebookTokens.baseline.json` shrank (FolderSidebar: two 11 px and two 12 px icons, and three off-scale spacings, left with the saved-view rows and the starter button), and `notebookTokens.lint.test.js`'s CEILING was lowered to match (spacing 1253 -> 1250, icon-size 244 -> 240), as that rail requires. The new `SavedViewsMenuGroup` files are on the tokens (16 px icons, 4 px spacing steps).

Pre-existing failures seen while running neighbouring suites (not caused by Task 2, not changed):
- `components/screener/reachable.test.js` (two cases: five unrelated unreachable modules, `chart/rightMargin.js` still listed as awaiting a decision).
- `components/notebook/ChartEmbed.touchTargets.test.js` (`styles.legCard*` / `legMenuRowBtn` / `legPresetRow` / `legRowAction` floors).
- `styles/tokens.reachable.test.js` ("re-points an alias target": `pages/study/RevealCard.module.css`).
- `tabs/NotebookTab.templates.test.jsx`: two cases timed out once when run inside a 57-file batch; the file passes 9/9 on its own.

## Task 3: a list that is a list, and one New menu

Deferred (go-live pass):
- `tools/notebook_fin_walk.py`, `tools/notebook_door_audit.py`, `tools/notebook_perf_budgets.py`: any step that reads the notes list's card grid (`.grid`, a card's serif title, its tag chips, a thumbnail) now meets ROWS by default; Cards is one View menu choice away (`uct.notebook.list.layout = 'cards'` in localStorage restores the grid). Any step that presses the list ▾ "From an outline" must press "From a template" (the same sheet; its search box is one Tab or click away), and any step that presses the toolbar's "Today" button must press "Today's note". The new `lib/reviewDraftRun.js` (and `useJ2SelectedAccount`, now imported by NotebookTab) join the Notebook's first open; the drafts chunk itself stays lazy. Size not measured: `notebook_perf_budgets.py` needs a build, and this task ran none.
- Walkthroughs: no anchor moved (`new-note`, `templates`, `styles-button`, `view-switcher`, `import` each still once). A tour sentence that describes the list as cards, or the ▾ as listing "From an outline", needs the go-live pass.
- A row draws no thumbnail (the first image or a still hero); Cards still does. Formula and rollup chips still show on a row, under its meta line.
- In Cards the tick box keeps its old rule (always drawn, dimmed until hovered, focused or checked): the brief keeps Cards unchanged. The hover/focus/any-selected rule is the rows layout's.
- Trash and Archived draw the same layout as the list (rows by default, Cards if chosen); their View menu is not drawn (unchanged), so the choice is made from All notes.
- The Rows / Cards choice is shown in the View menu only while List is the mode.
- A review drafted from the New ▾ shows no "Drafting..." state (the menu closes at once); a second press while one runs is ignored, and a failure says so in the list's notice line with the same sentence Research Home shows.

Pre-existing tests changed (old behaviour deliberately changed):
- `NotebookTab.toolbar.test.jsx`: the row's daily-note button is "Today's note"; the ▾ no longer offers "From an outline"; Down from List in the View menu now lands on "Rows" (List's own choice, directly under it), then "Cards", then "Table".
- `tabs/__tests__/toolbarDoors.js`: the "Templates" door presses "From a template" (the search-first "From an outline" left the ▾).
- `NotebookTab.kindPicker.test.jsx`: the ▾ lists Blank, From a template, Import (switch on, voice off); "the Templates button still opens it with the search box focused" became "the sheet the Templates door opens still carries the template search".
- `NotebookTab.graphView.test.jsx`: "exactly one view mode checked" counts the modes only (List's Rows / Cards are a named group of radios of their own, like the saved views).
- `a11y/notebookTab.a11y.test.jsx`: the list-mode precondition counts `[data-note-card-id]` inside the Notes list (rows carry no "card" class; a document-wide count would also match the folders panel's tree rows, so it is scoped and was mutation-checked: an empty list now fails it).

Shared module lifted (no logic duplicated): `lib/reviewDraftRun.js` is the body of Research Home's `ReviewDraftsHomeBox.run`, moved; the box and the New ▾ "Reviews" group both call `draftReview(period, ...)`.

Pre-existing failures seen while running neighbouring suites (not caused by Task 3, not changed):
- `components/screener/reachable.test.js` (two cases, the same five unrelated modules and `chart/rightMargin.js` as Task 2 recorded).
- `styles/tokens.reachable.test.js` ("re-points an alias target": `pages/study/RevealCard.module.css`).

## Task 4: a calmer editor (formatting row, note header, details line, More menu)

Deferred (go-live pass):
- Walkthrough `b1WritingHelp` (step `open`, anchor `writing-help` in NoteEditorPage.jsx): the anchor is still written once, on Writing help's ONE door element (`writingHelpDoor`), which renders as the header button (the touch tier's; `display: none` at 1025 px and up while the "AI" menu is there) and, while the desktop "AI" menu is open, as its "Writing help" item. At desktop the tour finds the folded header button first; re-pointing it at the AI button (or opening the menu first) is the go-live pass.
- Walkthrough `b1ImageDocx` (steps `format` / `scan`, anchors `note-format`, `note-scan`) is a touch-tier tour and its controls are unchanged; at desktop both were already hidden. No change.
- Walkthroughs `export` (`note-export`, the More door) and `ask` (`ask-row`, the header controls) keep their anchors. A tour sentence that says PNG and Print sit beside Export, or that names "Ask this note" in the desktop header, needs the go-live pass.
- `tools/notebook_fin_walk.py`, `tools/notebook_door_audit.py`, `tools/notebook_proof_walk.py`: at 1025 px and up the row's Font, Size, Text color and highlight, Quote, `</>`, Attach a file, Horizontal rule and "Insert widget" are `display: none` (`.foldDesktop`); their desktop doors are the "More formatting" ("Aa") menu (Font, Size, Text color and highlight, Quote, Code, Attach a file, Divider) and the row's "Insert". The header's "Ask this note" toggle and "Writing help" button are folded the same way while the "AI" menu shows ("Ask about this note", "Writing help"). PNG and Print are items of More > Export now (menuitems "PNG", "Print"), and "Save as template with blocks" is More > Save as template > "Keep live blocks". A walk at 1024 px or below sees the old controls.
- `tools/notebook_perf_budgets.py`: `NoteFormatMenu.jsx` (and its CSS module) joins the note editor's chunk; `NewNoteMenu`'s `useMenuButton` was already in the Notebook's first open. Not measured: no build in this task.
- "Import a tweet" (flag `notebook_tweet_import_enabled`, off) is not in the brief's desktop row list; it stays where it was (after Insert image) when the flag is on, rather than being folded or dropped.
- The note header at desktop still shows a problem line (save failed, conflict, refused) and the Saved indicator before Favorite; unchanged.
- The details line keeps its "+N" after the third tag (it says how many more tags there are; Details lists them).

Pre-existing tests changed (old behaviour deliberately changed):
- `NoteEditorPage.details.test.jsx`: the summary is `#thesis · NVDA` (no sector, no "3 properties", no "Not reviewed"); it now waits on the properties having answered (the Sector row in Details) before reading the line.
- `NoteExportControls.test.jsx`, `.lazy.test.jsx`, `.a11y.test.jsx`: PNG and Print are the Export menu's first two items (6 items, not 4); a PNG hands focus back to the Export button (the menu closed when it was picked), and mid-export the busy guard is the disabled Export button.
- `NoteEditorPage.rails.test.jsx` (K2 row): PNG and Print are reached through More > Export.
- `NoteMenuActions.saveAsStyle.test.jsx`, `.styleDemand.test.jsx`, `.styleDoorFocus.test.jsx`: the blocks door is "Keep live blocks" inside the one "Save as template" entry; on demand still means nothing is fetched until that choice is pressed; while its chunk loads the pressed choice keeps its place and focus and an "Opening…" status shows. With the switch off the entry opens the plain form with no choice.
- `NoteEditorPage.phoneFormat.test.jsx`: the desktop row's own "More formatting" and "Insert" (`.desktopOnly`) are set aside from the touch-row classification and checked on their own (new case: in no run, and out of the Tab ring while Format is open); the Tab ring skips controls under `[hidden]`, as a browser does.
- `NoteEditorPage.phoneInsert.test.jsx`: the phone "+" is found by its phone-only class, since the desktop row's last control is also named "Insert".
- `NoteEditorPage.phoneHeaderRow.test.jsx`: the phone row count also skips `.desktopOnly` (the desktop "AI" menu, `display: none` below 1025 px).
- `styles/notebookTokens.baseline.json` shrank (NoteMenuActions lost one 13 px icon with the old blocks button; SaveStyleDoor's 13 px icon and its CSS module went with its button) and `notebookTokens.lint.test.js`'s CEILING was lowered to match (spacing 1250 -> 1249, icon-size 240 -> 238). The new `NoteFormatMenu` files are on the tokens.

Removed: `styles/SaveStyleDoor.module.css` (its button and sentence moved to NoteMenuActions; the door is now the blocks form alone). `NoteEditorPage` no longer reads `useNoteProperties` / `useThesisReviews` for the details line (PropertiesSection and ThesisSection read the same keys themselves).

Pre-existing failures seen while running neighbouring suites (not caused by Task 4, not changed):
- `components/screener/reachable.test.js` (two cases, the same five unrelated modules and `chart/rightMargin.js` as Tasks 2 and 3 recorded).

## Task 5: open on your notes (one front door, one optional home)

As built:
- A bare `/journal/notebook` opens the notes list (All notes), whatever `notebook_landing` holds: `resolveLanding` answers `'all'` for every input, and NotebookTab no longer reads the preference for the landing. `?view=home` and any `?view=` this build does not know open the list too; `?view=today` is the Daily brief. Opening the Notebook makes nothing: the day's note is made only by the Daily brief's own read (`GET /api/j2/notes/today`) or by "Today's note". The "Opening the Notebook" pending frame (and its `.landingPending` CSS) is gone. The Daily brief's chunk is preloaded only on `?view=today`.
- JournalLayout folds the phone header from the first paint on the bare address too (`isNotebookListAddress`: everything on the Notebook route except a note and the Daily brief is the list). It no longer reads the preferences for that.
- The Daily brief is the Today home without "Open the Notebook on" and the "Research home" link; "All notes" stays; Research home's "Reporting soon" and "Passed setups" sit below the cards, folded (each only while its switch is on; a walkthrough running now unfolds both, `#prep` unfolds Reporting soon; their open/closed choice is kept under new keys, `nb-today-reporting-soon` / `nb-today-passed-setups`). The pane heading reads "Daily brief". The palette's "Earnings prep" door (`NOTEBOOK_PREP_TO`) now goes to `/journal/notebook?view=today#prep`.
- The folders panel's Today row is "Daily brief", directly under All notes, opens `?view=today`, no weekday counter.
- The list toolbar has an "AI" button before "Today's note". It opens Research home's notebook-wide Ask under the toolbar (`NotebookAiPanel.jsx`, a lazy chunk: the question panel opens at once, and "Or tell Notebook what to change" sits below it while `notebook_ai_actions_enabled` is on; cited documents and captured passages open in place, as on Research home). Pressed again it closes; closing the question panel hands focus back to the door that opened it. On a phone the button gives way like "Today's note", and the ⋯ menu gains a phone-only "Ask your Notebook" row. Research home's Ask carried no `data-tour` anchor, so none moved.
- Zero notes: the list's empty state now also offers "Add a sample notebook" beside "Import notes" (`onboarding/SampleNotebookDoor.jsx`: the same `addSampleNotebook` action and rule as Research home's: onboarding switch on, paid, no sample recorded), and mounts the get-started list (`GettingStartedChecklist`), whose only mount was Research home.

Research home's pieces, and where a member reaches each now:
- Notebook-wide Ask and "Or tell Notebook what to change": the list toolbar's "AI" (phone: ⋯ > Ask your Notebook).
- Reporting soon, Passed setups: the Daily brief, folded.
- Setups box: the Daily brief's "Setups near entry" card (with its link to the setups board).
- Reviews that write themselves: the list's New ▾ > Reviews (Task 3).
- Its New note menu (Blank, From a template, Voice note, Today): the list's "+ New", its ▾ and "Today's note".
- Search box: the folders panel's search (and the command palette's `#search` door).
- Recent notes: the folders panel's Recents.
- Favorites: the folders panel's Favorites.
- Notices (task reminders, fill notices, resurfaced notes): no other door: decide at go-live.
- Active theses: no one-click door (View > Saved views > "Add thesis starter views" makes saved views over the thesis status): decide at go-live.
- Connected to your open positions: no other door: decide at go-live.
- Needs review: no other door: decide at go-live. `ThesisReviewSection.jsx` still tells a member a thesis "appears in Research Home when it comes due" (copy left as is).
- The Learn menu button: walkthroughs are under Help > Walkthroughs (and the tour offer); the Learn menu itself has no other mount: decide at go-live.
- First-run welcome (zero notes): the list's empty state carries the template picker, "+ New", Import notes, Add a sample notebook and the get-started list; "create a thesis" is New ▾ > From a template; "Take the tour" is Help > Walkthroughs; "See what it can do" (CapabilityPreview) has no other door: decide at go-live.
- The sample's "You're looking at the sample notebook — Remove it" strip: no one-press door (the sample notes can be selected in their "Sample notebook" folder and trashed with the bulk bar): decide at go-live.

Deferred (go-live pass):
- Walkthroughs that start at `?view=home` now land on the notes list, where their first anchor is not drawn (the engine skips a step whose anchor is absent): `voice-notes` (anchors `new-note-home`, `new-note-voice` in NewNoteMenu.jsx, Research home's New note menu), `review-drafts` (`review-drafts-home`/`-daily`/`-weekly`/`-monthly` in ResearchHome.jsx), `earnings-prep` (`reporting-soon-*` in ReportingSoon.jsx, now on the Daily brief, folded) and `passed-setups` (`passed-*` in PassedSetups.jsx, now on the Daily brief, folded). The last two can be re-pointed at `?view=today` (the Daily brief's folds open while a walkthrough runs); the first two need anchors on the list's New ▾. `todayLanding.tours.test.jsx` names the four in `DEFERRED_TO_GO_LIVE` and pins that list to exactly the tours whose first anchor is in a Research home file.
- The base tour's first step (`first-run`, ResearchHome.jsx) is never on screen now; the tour skips it and opens on the folders panel. Its copy may want a first step on the list's empty state.
- Anchors that now live only in files no route reaches (they still count for `tourAnchors.test.js` while the files exist): `first-run`, `review-drafts-home`/`-daily`/`-weekly`/`-monthly` (ResearchHome.jsx), `new-note-home`, `new-note-voice` (NewNoteMenu.jsx's default export, now unmounted; its `useMenuButton` is still used), `home-setups` (SetupsBox.jsx), `home-notices` (NoticesBox.jsx).
- `components/screener/reachable.test.js` newly flags six modules (ResearchHome.jsx is no longer imported by NotebookTab): `ResearchHome.jsx`, `SetupsBox.jsx`, `onboarding/LearnMenu.jsx`, `onboarding/LearnMenuPanel.jsx`, `onboarding/CapabilityPreview.jsx`, `onboarding/capabilityList.js`. Not deleted (controller ruling); decide at go-live. (The suite's other failures are the pre-existing five unrelated modules and `chart/rightMargin.js`.)
- The stored `notebook_landing` preference is left on accounts (no server change); nothing reads it for the landing and nothing writes it.
- `tools/notebook_fin_walk.py`, `tools/notebook_door_audit.py`, `tools/notebook_proof_walk.py`: a step that expects Research home (or the Today home) at the bare address now meets the list; a step that presses the panel's "Today" row must press "Daily brief"; a step that uses Research home's Ask must press the list's "AI". `tools/notebook_perf_budgets.py`: the Notebook's first open gains the AI button, the sample door and the get-started gate (small, eager); Research home was already lazy, so nothing left the first open; `NotebookAiPanel` is a new lazy chunk. Not measured: no build in this task.

Pre-existing tests changed (old behaviour deliberately changed):
- `tabs/NotebookTab.todayLanding.test.jsx`: the seven "where the Notebook opens" cases (Today default, chosen landing, pending frame, `?view=home` is Research Home, Research home link) are replaced by the new `NotebookTab.landing.test.jsx`; the first-run `make`/`hold`/`wait` cases stay.
- `tabs/NotebookTab.todayPreload.test.jsx`: the chunk is preloaded on `?view=today` only; new case: a bare open never asks for it. `NotebookTab.todayPreloadFiltered.test.jsx`: header and the Research Home stub only.
- `tabs/NotebookTab.test.jsx`: the Research Home stub is gone; its two "open a note" doors moved to the folders panel stub (the panel's `onOpenNote` is the same tab door); "bare-root renders Research Home" became "bare-root renders the notes list"; removed with Research home: "the New thesis action on Research Home", "on Research Home no saved-view row", "P0.1 the New-note door on Research Home", and P0.13's three "Home steps aside" cases plus its H14 stable-report case (the tab no longer passes the panel `onSearchModeChange`, whose only reader was Home; a new case says so, and "an unrelated re-render keeps the seed" re-renders through the panel toggle).
- `tabs/NotebookTab.kindPicker.test.jsx`: "the Home New-note menu gets a From a template door" removed; the M6 focus case runs through the list ▾.
- `tabs/NotebookTab.graphView.test.jsx`, `.phoneNote.test.jsx`, `.followup.test.jsx`, `.stylesDoor.test.jsx`, `.tourChunk.test.jsx`, `.homeNotesError.test.jsx`: the bare address is the list (they waited on Research Home or its first-run screen); the homeNotesError rail reads the list's failure line and covers `?view=home` too.
- `tabs/NotebookTab.citationLanding.test.jsx`: the Ask is opened from the list toolbar's "AI" (it was Research Home's Ask toggle); the citation landing is unchanged.
- `tabs/NotebookTab.toolbar.test.jsx`: the row is View, sort, AI, Today's note, + New, ▾, ⋯; the phone rule hides `.aiBtn` with "+ New" and Today.
- `tabs/NotebookTab.lazyViews.test.js`: ResearchHome left the lazy list; NotebookAiPanel joined it.
- `components/notebook/TodayHome.test.jsx`: "the member's choice is stored on the account" became "offers no landing choice and no Research home link; All notes stays"; new cases for the two folds.
- `a11y/todayHome.a11y.test.jsx`: axe reads the folds instead of the landing select. `a11y/notebookTab.a11y.test.jsx`: the `tab-home` surface (Research Home at the bare address) became `tab-daily-brief` (`?view=today`). `a11y/deleteFocusFallback.test.jsx`: deleting the saved view in use lands on the bare Notebook, the list, so focus goes back to the View button (it fell back to the pane heading when the bare address was a home).
- `components/notebook/onboarding/todayLanding.tours.test.jsx` and `todayLanding.anchor.test.jsx`: pin the deferred state above (the tours that start on the Notebook land on the list; review-drafts' first anchor is not drawn).
- `components/notebook/ImportRepairNotice.test.jsx`: "on Research Home" became "on the bare Notebook (where a member lands)", the list.
- `components/Layout.skipLink.test.jsx`: "Skip to getting started" is tested on the empty Notebook list (the fixture serves no notes). This case was already red on this branch before Task 5 (Task 1 made the list zero-notes only, and its fixture has notes).
- `JournalLayout.compactHeader.test.jsx` ("the address rule"): the bare address, `?view=home` and an unknown view are the list; `?view=today` is not.
- `components/CommandPalette.notebookDoors.test.jsx`: "Earnings prep" lands on `/journal/notebook?view=today#prep`.
- `hooks/usePreferences.additionsOnly.test.js`: `notebook_landing` left `BASELINE_KEYS` with its only write site (the rail requires it).

Pre-existing failures seen while running neighbouring suites (not caused by Task 5, not changed):
- `components/screener/reachable.test.js`: the five unrelated modules and `chart/rightMargin.js` (plus the six above, which are Task 5's).
- `hooks/pollingSites.rail.test.js`: `components/chart/useLegacyChartBars.js` (2 bare polling sites, listed 0); its other case timed out once under load.
- `components/trade/TradeDetailPage.test.jsx` ("renders the outcome header from the fixture trade": no `[data-testid="chart"]`): red twice (once on its own), green in the final batch; flaky, unrelated to the Notebook.
- `tabs/NotebookTab.templates.test.jsx`: two "creating from a member template" cases time out when run beside a heavy suite (seen beside TradeDetailPage); 9/9 on its own, twice, and beside NotebookTab.toolbar.test.jsx (as Task 2 recorded).
- `components/notebook/ImportRepairNotice.test.jsx` "Import notes on Research Home" was already red on this branch before Task 5 (rewritten above; green now).

## Preview fix round 1 (browser walk of 1edb49e133)

Fixed: the colour picker from "Aa" (one swatch wide), the note Ask panel over the header buttons, the header "AI" label sitting low, the list's AI section leaving "Or tell Notebook what to change" behind (and reopening on return to the list), the "Aa" menu opening left over the title.

Behaviour changed on purpose:
- `NotebookAiPanel`: closing the question panel now closes the whole section at every width, the "Or tell Notebook what to change" door with it. Task 5 had kept that door open after the question sheet closed on a phone; on a phone the section reopens from ⋯ "Ask your Notebook", which opens both again.
- The list's AI section closes when the member leaves the list (a note, the Daily brief), so it is closed on return.

Pre-existing tests changed: none (new cases in `NoteEditorPage.calmToolbar.test.jsx` and `NotebookTab.landing.test.jsx`).

Pre-existing failure seen (not caused here, not changed): `styles/tokens.reachable.test.js` ("re-points an alias target": `pages/study/RevealCard.module.css`), as Task 2 recorded.

## Preview walk (real browser, build 5c3cf93039, local sandbox with production's armed flags)

Counted with the audit's own counter (things you can click that are painted at rest; hover-only controls excluded), sample member with 14 notes in 4 folders.

| Screen | Before (master fd955df630) | After | 
|---|---|---|
| Open note, 1920x945 | 103 (rail 22, header 12, panel 38, note 31) | 69 (rail 22, header 7, panel 20, note 20) |
| Notes list, 1920x945 | 114 | 72 (rail 22, header 7, panel 20, list 23) |
| Open note, 1025x768 | not measured | 72 |
| Notes list, 1025x768 | not measured | 71 |

Checked on screen at 1920, 1025 and 390 wide:
- A bare open of the Notebook lands on the notes list; `?view=home` lands there too; `?view=today` is the Daily brief.
- No card, toast or dialog appears on the Notebook that the member did not ask for. The app-wide welcome animation is unchanged.
- Page title reads "Notebook" on the Notebook and "Trade Journal" on Trades; the Trades header keeps its 12 controls.
- New menu: Blank, From a template, Voice note, Import, then Reviews (Today's recap, This week's review, This month's review).
- Note More menu: 11 entries. Formatting row: one row at 1025 and 1920, no wrap.
- View menu (the door to saved views) is on screen at 390. No horizontal scroll at any of the three widths.

Left for the go-live pass (after the owner has looked):
- Phone: the folders-panel button paints over the top of the note's More menu at 390 wide. Not confirmed whether this predates the branch.
- Visiting the Daily brief creates today's daily note and a "Daily" folder (the old Today home did the same).
- The dictate button is drawn taller than its neighbours in the formatting row (it was before, too).
- Final whole-branch review, walkthrough re-pointing, the fin walk, door audit and first-open byte budget.

## Go-live wave 1: close what the simplification left open

Folded (Research home's pieces, and where a member reaches each now):
- Notices: the Daily brief, at the top of the cards (`NoticesPanel`, the Journal Today panel's lazy boundary, reused as is; it renders nothing with nothing to tell).
- Needs review: the Daily brief, a "Needs review" card after the phase cards, only when it has rows; each row carries the server's `reviewReasons` texts. The `GET /api/j2/notebook/home` read waits for the cards' own read (`useNotebookHome({ enabled })`).
- Connected to your open positions: the Daily brief, "Notes on your open positions", same rules, rows tagged "Open position".
- Sample notebook removal: the notes list's More menu row "Remove the sample notebook", at every width while the sample is active. The status read (`GET /api/j2/onboarding/sample-notebook`) is made the first time the More menu opens, and only when the preferences record a sample. Same flow as the strip (trash pre-check, confirmed "Remove anyway" in the list's notice line, DELETE), then "Sample notebook moved to Trash. You can restore it from there." (`SAMPLE_COPY.removed`). A failed status read is said by the list's LoadFailed line ("your sample notebook's status").
- "What your Notebook can do": Help (Support.jsx `NotebookCapabilitiesSection`, after Walkthroughs), plain lines from `armedCapabilities()`, on the wave-14 switch as before. `PREVIEW_COPY.sampleTail` names the new removal door.

Dropped (rulings): Active theses (the starter saved view and the Board view cover it); the Learn menu (Help > Walkthroughs lists every tour); CapabilityPreview; SetupsBox; the strip's dismiss "x".

Not done (ruling A3): the "Needs Review" starter saved view still filters only `review_date <= today`. The filter language is AND-only and its `neq` compiles to SQL `!=`, which drops a note with NO thesis status, so "not closed, or no status" cannot be expressed without a server change.

Deleted: `ResearchHome.jsx` and `.module.css` and its 23 test files; `SetupsBox.jsx`/`.module.css` and `a11y/setupsBox.a11y.test.jsx`; `onboarding/LearnMenu.jsx`/`.module.css`, `LearnMenuPanel.jsx`, seven `LearnMenu.*` tests and `a11y/learnMenu.a11y.test.jsx`; `onboarding/CapabilityPreview.jsx`/`.module.css`/test and `a11y/capabilityPreview.a11y.test.jsx`; `onboarding/learnMenuCopy.js` (`LEARN_COPY`, `isNew` with it; the `.newBadge` CSS went with LearnMenu.module.css); NewNoteMenu's default export and `CaretMenu` (and the `.split/.main/.caret` CSS); `learnTours.js` keeps only `startTour` (GettingStartedList's); `lib/todayHome.js` `LANDINGS`; FloatingOrb's `onPhoneNotebook` term; the `vi.mock` of ResearchHome in 22 NotebookTab suites, `blockedNoteSurface` and `offlineOptInEvent` (and the three now-vacuous "research-home is not shown" asserts).

Walkthroughs re-pointed:
- New engine feature: a step may carry `tier` (`phone`, `wide`, `touch`, `desktop`; `onboarding/tourTiers.js`, read once when the tour loads). GenericTourEngine drops the other tiers' steps, so each width counts and walks only its own. Registry rails allow the key and check that every tour keeps a step at phone, tablet and desktop width and that a kept `waitFor` names a kept later step.
- `voice-notes`: starts `?view=all`. Wide: the New menu arrow (`templates`) waiting for "Voice note" (`new-note-voice`, a literal anchor through the new MenuRows `render`), then that row twice. Phone: the More menu (`styles-button`) waiting for its new phone-only "Voice note" row (`new-note-voice-phone`), then that row.
- `review-drafts`: starts `?view=all`. Wide: the New menu arrow waiting for "Today's recap", then the three rows (`review-drafts-daily/-weekly/-monthly`). Phone: the More menu waiting for its new phone-only Reviews group (`review-drafts-phone`), then the group.
- `earnings-prep`, `passed-setups`: start `?view=today`; the Daily brief unfolds both boxes while a tour is wanted.
- `notebook-basics`: the `first-run` step and the Replay door's 8 s wait for it are gone; it opens on the folders panel. `sidebar` copy: folders and tags; `view-switcher` copy: saved views are in View too.
- `writing-help`: desktop: "AI" (`note-ai`) waiting for the menu's "Writing help" (`writing-help-menu`, its own anchor now: the header button and the menu item each carry one); touch: the header icon (`writing-help`). `preview` points at the header controls (`ask-row`, on every tier) so the tour stays within six steps.
- `image-docx-import` `add`: says Attach a file is under Aa on a wide screen.
- Rails: `todayLanding.tours` `DEFERRED_TO_GO_LIVE` is empty and models the Daily brief by reading TodayHome's imports; `tourReachability` models the list and the Daily brief, and gains a rail that every step's file is modelled and reached from App.jsx (an AST import walk).

Phone and tablet: the More menu gains phone-only "Voice note" and "Reviews" (the "+ New" group is not drawn on a phone, and reviews had no other phone door on the list since Task 5); "Ask your Notebook" is touch tier (<=1024px) and the toolbar "AI" hides at <=1024px (brief D2; the code showed it on a tablet before). The phone note's More panel now covers the folders button and the back chevron (`.chrome` at <=640px drops its z-index: a static flex item with a z-index was still a stacking context).

Minors: the View menu says "Saved views could not be loaded." on a failed read; a New-menu review shows "Drafting today's recap…" (held until it lands) and its rows are disabled meanwhile; the selected row tint is `color-mix` over `--accent` and outranks the hover rule; `.desktopOnly:not([hidden])`; a zero-notes list axe rail; the delete-confirm heading fallback has its test again; the list's "+ New" carries `data-start-note` (the voice tour's "Make a note first" card focuses it).

Copy fixed: Support getting started, templates and the daily note, the sample notebook; ThesisReviewSection ("on your Daily brief"); FirstRunSheet (the Daily brief's Your names card; Today's note on the notes list); stale comments in NotebookTab, setupsBoardLink, GettingStartedList, gettingStarted, tourRegistry, tourProgress, NoticesBox/ReportingSoon CSS and others.

Pre-existing tests changed (old behaviour deliberately changed):
- `FolderSidebar.test.jsx`: the H14 case drives the panel through the `#search` door with a probe in place of Research home's HomeSearch.
- Review drafts: the `ResearchHome.reviewAccount.finAi` and `.reviewLanding` cases moved to `lib/reviewDraftRun.test.js` (account id, landing on the collapsed block, the daily notice, the server's reason); `.reviewsSkipLink` deleted (box markup only); `invalidateNoteViews.test.jsx` drives the recap through `draftReview`.
- `NewNoteMenu.test.jsx`, `a11y/newNoteMenu.a11y.test.jsx`: the engine cases run on the list form; the split button's own markup cases are gone; a new MenuRows `render` case.
- `NotebookTour.test.jsx`, `.coldReplay`, `baseTour.zeroDrift`: the first step is `sidebar`; the Replay door opens at once (the cold-replay file now pins that).
- `learnTours.test.js` keeps the `startTour` cases; `b4Styles.test.jsx` lost its Learn-group case.
- `b1Core`, `b2Trading`, `b3Research`, `b4Styles` tests and `tourRegistry.test.js` allow a step's `tier`; the `b1Core`/`b2Trading`/`tourStart` tests pin the `?view=all` starts; `b1VoiceNotes.steps.test.js` pins the new shape.
- `NoteEditorPage.calmToolbar.test.jsx`: the menu item's anchor is `writing-help-menu`; `.desktopOnly:not([hidden])`.
- `SavedViewsMenuGroup.test.jsx`: "loading or failed draws nothing" is "loading draws nothing" (failed says so).
- `tourAnchors.test.js` CONTROL reads FolderSidebar.jsx; `FirstRunGate.lazy.test.js` reads TodayHome.jsx for the inline slot; `loadFailedConsumers.test.js` names NotebookTab as the sample status consumer; `notebookSurfaces.js` and `contrastAudit.js` drop the deleted surfaces; `usePreferences.additionsOnly.test.js` drops `notebook_sample` (its only client write site was Research home); `persistenceManifest.json` `notebook_sample` has no client files; `notebookTokens.baseline.json` shrank and the CEILING dropped to font-size 201, border-radius 75, spacing 1202, icon-size 215.
- Python (edited, not run, per the box rules): `tests/test_sample_notebook_trade_exclusion.py` (sampleTail names "Remove the sample notebook"), `tests/test_notebook_wave8_walk.py` line 546 (`removed` starts "Sample notebook moved to Trash").

Deferred (for the later task that owns `tools/notebook_*.py`):
- `tests/test_notebook_wave8_walk.py::test_the_tour_steps_are_read_in_order_with_every_title` expects the base tour to start `first-run` / "Welcome to your Notebook"; it starts `sidebar` / "Folders and tags" now. Its walk readers and `tools/notebook_fin_walk*.py` (the "remove sample" step, Research home's screens, the Learn menu) need the same pass.
- `NEEDS_NOTES` still names `voice-notes` (a member with no notes gets "Make a note first"); the list's New menu is on screen with no notes, so it can be dropped (kept to leave the mechanism's own tests untouched).
- The Notices box mounts above the Daily brief's cards and can push them down when it has rows (no reserved space, by ruling).

- `a11y/surfaceCoverage.test.js` "every file in the population has an entry" is red on this branch for three files earlier tasks added without an axe entry: `NoteFormatMenu.jsx` (Task 4), `NotebookAiPanel.jsx` (Task 5), `SavedViewsMenuGroup.jsx` (Task 2). Not this wave's files; each needs a recipe (or a true `coveredBy`) in `a11y/notebookSurfaces.js`.

Pre-existing failures seen (not caused here, not changed): `components/screener/reachable.test.js` "nothing committed is connected to nothing" (five non-Notebook modules: agentExecTune, railScan, railSupport, WhatElseOpenPrompt, useDayFacts; no Notebook module is flagged now); `lib/persistence/persistenceManifest.test.js` two census cases (unresolved StockChart/barStoreSwitch keys, a missing known key), unrelated to the Notebook; `GenericTourEngine.test.jsx` "on Home with Start a note there" failed once inside a 25-file batch (focus landed on <body>) and passed on its own (load flake).

## Go-live wave 1, fix round 1

First-open bytes (`python tools/notebook_perf_budgets.py --dist app/dist`): 2,277,805 B on `e53a0b9d38` (85 chunks, +17,012 over the 2,260,793 budget) -> 2,258,099 B (83 chunks, PASS, 2,694 under; master's CI 2,259,893, a local build of master's `bb74818ef2` 2,260,264). Moved off the Notebook's first open, each loaded where it is used:
- the review drafting door (`lib/reviewDraftRun.js`) on the first New-menu press (its words are `lib/reviewPeriods.js`);
- the sample notebook's client (`onboarding/sampleNotebook.js`) on a press (add, remove); the list keeps `onboarding/sampleNotebookKeys.js` (route, key, reader, row words) and `onboarding/useSampleNotebook.js` (the two hooks); `SampleNotebookDoor` is a lazy chunk of the zero-notes state;
- the View menu's `SavedViewsMenuGroup` (warmed when idle and on pointer/focus of "View");
- the Daily brief's note sections (`TodayHomeNotes.jsx`, which imports nothing of TodayHome's: a shared module folds the brief's manifest entry away) and its Notices panel;
- the note's find bar (`NoteFindBar`) and table toolbar (`TableToolbar`), warmed when the editor is idle (master-era code, moved to pay for this branch's additions).

Walkthroughs: `NEEDS_NOTES` is empty (every voice-notes step is drawn with zero notes at both tiers); its rails use a probe id. The tour cards and the failure notice say "start it again from Walkthroughs on the Support page" (the Learn menu is gone).

Review fixes: the D4 busy-line test now runs fake timers past 8 s (with a control); disabled menu rows are not keyboard stops; the sample removal re-reads the status at the press and empties the cached status at once on success; the Daily brief holds the Notices box and the note sections back while a walkthrough is wanted; copy (FirstRunSheet "Open today's note from the notes list", image-docx "on a desktop") and stale comments; tokens in the new CSS.

Deleted: `SAMPLE_COPY.dismiss`, `.removing`, `.cancel`. Deferred: `SAMPLE_COPY.strip`, `.remove`, `.tour` are walker-only (read by `tools/notebook_wave8_walk.py` and its Python test), kept for the instruments task.

Pre-existing tests changed: `loadFailedConsumers.test.js` (the sample route's reader is sampleNotebookKeys.js); `tourStart.test.js`, `GenericTourEngine.test.jsx` (NEEDS_NOTES probe; Walkthroughs wording); `GenericTourEngine.c1.test.jsx`, `RegistryToursGate.test.jsx` (the Learn wording); `TodayHome.homeNotes.test.jsx` (constants from TodayHomeNotes; the walkthrough hold); `NotebookTab.goLiveMenus.test.jsx`, `NotebookTab.sampleRemove.test.jsx` (review cases). New: `a11y/simplifyMenus.a11y.test.jsx` (recipes note-format-menu, saved-views-menu-group, notebook-ai-panel, today-home-notes, entries in notebookSurfaces.js).

Tests touched beyond the review cases: `NoteEditorPage.rails.test.jsx` (the Find rail awaits the lazy find bar); `NotebookTab.lazyViews.test.js` (SavedViewsMenuGroup, onboarding/SampleNotebookDoor and lib/reviewDraftRun are lazy); `sampleNotebook.test.js` (pins `SAMPLE_WRITE_URL`, the client's own literal for the door rail, to the keys module's route). Copy (4h): tourStart cards, RegistryToursGate's failure notice, FirstRunSheet's write failure, image-docx step; pinned by tourStart.test.js, RegistryToursGate.test.jsx, GenericTourEngine.c1.test.jsx. A last grep of member-visible strings for Learn, on Home, Research home, Notebook home and toolbar's Templates finds comments only.

Pre-existing red, not changed: `lib/widgetFormula/widgetFormula.lazy.test.js` NON-VACUITY (its roots are hardcoded without TodayHome; red on master `bb74818ef2` too). `a11y/surfaceCoverage.test.js` "every recipe ... registered" passes alone but can hit its 15 s timeout inside a large batch.

## Go-live wave 1, fix round 2

The lazy find bar's delay was React, not the chunk: a `React.lazy` component suspends on its first render even when its module is in hand (the factory's `import()` is a fresh promise, read as pending), the `<Suspense>` commits its fallback, and react-dom 19.2 holds the retry's reveal until FALLBACK_THROTTLE_MS (300 ms) after that fallback. Measured in Chromium on a minimal page (warmed chunk, Ctrl+F, wait 150 ms, type "qq" at 80 ms): `lazy` + `<Suspense>` 305 ms to the field holding focus (6/6 runs, both letters in the note); the component drawn directly 3 ms (0 letters in the note).

So the chunks this branch made lazy that a member types into (or keys through) the moment they open are fetched ahead into a module-level slot (`lib/heldModule.js`: idle, press, one in-place retry, then `failed`, never a reload) and drawn straight from it:
- the find bar and table toolbar (`components/notebook/EditorToolSlots.jsx`): with the chunk in hand the real bar mounts in the press's own commit; before it lands a stand-in field (same name, focused in a layout effect) keeps what is typed and the real bar takes it as its query, caret at the end; Esc closes the stand-in; a failed fetch says "Find could not be loaded." with Try again. The table toolbar stays absent on a failed fetch and is asked for again on the next editor mount;
- the notes list's AI section (`components/notebook/NotebookAiPanelSlot.jsx`, warmed on idle and on pointer/focus of "AI"; a failed fetch says "Ask could not be loaded." with Try again and Close);
- the View menu's saved views group (a slot in NotebookTab.jsx; a failed fetch leaves it undrawn).

To pay for the slots without giving bytes back, the rollup editor (`RollupEditor.jsx`, native selects, drawn only while a rollup is set up or edited) left the first open the same way (`RollupEditorSlot` in PropertiesSection.jsx, warmed on idle); `rollupReady` moved to `lib/formula/computed.js` (re-exported from RollupEditor.jsx).

First-open bytes: 2,258,071 B across 83 JS chunks, PASS (budget 2,260,793; fix round 1 head 2,258,099).

Minors: the Daily brief holds only what has not been drawn yet while a walkthrough is wanted (once Notices or the note sections are on screen they stay); the sample add-failure sentence is `SAMPLE_ADD_FAILED` in sampleNotebookKeys.js, read by the add hook and by `SAMPLE_COPY.addFailed`.

Tests: new `EditorToolSlots.test.jsx`, `NotebookAiPanelSlot.test.jsx`, `PropertiesSection.rollupSlot.test.jsx`; recipes `editor-find-stand-in` and `notebook-ai-panel-failed` in `a11y/simplifyMenus.a11y.test.jsx` (entries in notebookSurfaces.js); `NotebookTab.lazyViews.test.js` (NotebookAiPanel is reached through its slot); `TodayHome.homeNotes.test.jsx` (a tour after drawing); `sampleNotebook.test.js` (one add-failure sentence).

Seen and not changed (master-era): FormulaEditor (typed into) still loads through `lazyChunk` + `<Suspense>`, so its first open per page load carries the same ~300 ms hold.

## Go-live wave 2: the real-browser instruments

The fin walk (c2), the door audit, the wave-8, p5 and proof walkers and their Python tests were re-pointed at the doors a member uses on the simplified Notebook; the walk and the audit were then run on a sandbox from this tree. Full record: `docs/notebook/fin-walk.md` (section 9) and `.superpowers/sdd/2026-11-11-notebook-simplify/golive-2-report.md`.

Product fixes (found by the walk):
- The base tour waits for the 60-second first run (S16) on a new member's first visit: the two opened together on the empty notes list at every width (the tour gate latched before FirstRunGate's effect said the sheet was up). `NotebookTourGate` now also reads the sheet's own due rule.
- The first run's "Skip" text button floors its width to 44 px on the touch tier (measured 25 x 44 on the Daily brief at 820 and 390).

First-open bytes: 2,258,169 B across 83 chunks (budget 2,260,793 B).

Fin walk c2, final full run on `13f1b01f5e` from an empty data root: 316 steps, 282 PASS, 16 FAIL, 11 INFO, 7 NOT RUN (before the re-point, on `2c306762b6`: 272 steps, 137 PASS, 109 FAIL). The 16 rows are classified in fin-walk.md section 9.1; none is a PASS -> FAIL caused by this branch's product code.

Checks replaced by ruling (each now proves the replacement door; none was deleted):
- the welcome screen, the capability preview and the "Want to try it first?" promotion -> the empty notes list (Import notes, Add a sample notebook, Get started) and Help's "What your Notebook can do";
- the sample strip's "Remove it" -> the list's More menu "Remove the sample notebook" and its status line, and the row leaving the menu;
- the Get started ticks for opening a sample note, writing a note and starting from a template (the list is not drawn once a note exists, Task 1) -> on an empty member: the base tour item ticks when the tour is finished, survives a reload, Hide hides it for good; and a member with notes is not shown the list;
- the one-time tour offer on Home -> the offer stays away (Task 1: nothing the member did not ask for); Help > Walkthroughs and What's new;
- the Learn menu's grouped sheet and its sample item -> Help > Walkthroughs at 390 (every tour listed) and the empty list's sample door (with a member-with-notes control);
- Research home's New note split button, setups box, Ask section and search box -> the list's "+ New" and its arrow (the phone's More menu), the Daily brief's "Setups near entry" card, the list's "AI" (the note's "AI" menu "Ask about this note"), the folders panel's search and the `#search` door.

Door audit (final, both widths): EASY 7, OK 12, HARD 11 (each with a written HARD reason), HIDDEN 0, exit 0. Doors that are HARD now and were EASY or OK before, each a consequence of a ruling (an owner call to accept or give a nearer door):
- rows 29 and 53, "What your Notebook can do" lines: in Help after the Walkthroughs list (ruling A6), about 2.3 screens down (was OK through the Learn menu);
- row 41 (both entries), row 42, row 46: the setups board link and the Notices box live on the Daily brief (rulings A4, A9; Task 5); at 390 the Daily brief row is inside the folders drawer and the cards sit below the first screen (row 46 was EASY);
- row 63, New Daily prep at 390: the phone's door is More > New from a template, whose sheet keeps the kinds above its search (was OK through Research home's caret);
- row 39 at 390: the chart's phone header keeps Plan in its More sheet (master S12, by ruling).
Door rows re-pointed (no door dropped): 11 (View menu), 23 and 33-35 (the "+ New" arrow; the phone's More menu), 24 (desktop Aa menu), 26 (the list's AI; the phone's More > Ask your Notebook and its sheet), 41, 42, 46 (the Daily brief), 54 (More > Manage templates), 55 and 56 (From a template; the phone's More > New from a template), 59 (walked from Trades: Task 1 took the settings gear off the desktop Notebook), 63.

Walkthrough step counts the card showed (Help > Walkthroughs, real browser): see fin-walk.md section 9 (the four re-pointed tours, writing-help, the base tour).

Left for the owner or a later task (not fixed here, evidence in the report):
- The Template gallery and Template library tours do not open at 390: their first step is the list's "+ New" arrow, which a phone does not draw (master S12 already hid it). Needs phone-tier steps through More > New from a template (a copy and design call).
- `smart.screenshot-tag`: the c2 sandbox leaves `J2_OCR_ENABLED` unset, so a pasted screenshot has no text and no chip is offered (configuration, not product).
- `blocks.sizing` / `blocks.switch-off-renders` red with the blocks code unchanged on this branch (master-era).
- The sample removal held once ("still syncing") on the final run and passed in one press on the run before it, same product code; unsettled (report, Concerns).
- c1's first-run, note and template-picker steps were re-pointed but c1 was not run; c3, keyed and the other one-off walkers (w13*, w14*, wave10b, nvda, style library, verify) were not re-pointed or run; several still name Research home or the Learn menu.

## Final fix, part 1 (product), base `bdfec6ae5d`

What changed (focused vitest and a red proof for each new guard; report `.superpowers/sdd/2026-11-11-notebook-simplify/final-fix-1-report.md`):
- A1: the Template gallery and Template library walkthroughs open on a phone: two phone-tier steps through More > "New from a template" (new literal anchor `new-from-template-phone`), then the same later steps. Phone 5 steps, wide 4, each.
- A4: "0 of 3 done" over four Get started rows is deliberate (audit S5 B3: the sample is shown, never counted); the uncounted row now says "Optional". C4: the standalone "Add a sample notebook" is not drawn while the Get started card is up with its sample row not done. C2: the card's template row opens the New note sheet (`#templates`).
- B1-B5: the list's Ask draws its frame at once on a cold press ("Loading Ask…"); Try again keeps focus (Ask, Find); the rollup Save waits for its editor; heldModule survives a loader that throws synchronously; the find tests pin focus in the same commit and after Esc. C5 stale tab: after a repeat failure, "Reload the page to get this back." with a Reload the member presses.
- C1 (product): the sample removal's hold names the note (read from the server when the list on screen cannot) and says "Open it so it can finish saving, then remove the sample again." The bulk trash's shared words are unchanged.
- C3 (product): engine menus on a phone are held to the room below their top less 80 px for the floating "+", and scroll; "Remove the sample notebook" sits above "Journal tools".
- C5: walkthroughs from Help wait for the 60-second first run (RegistryToursGate reads the showing signal and a "first run pending" signal the notes list publishes); the Daily brief holds Notices for a walkthrough asked for on this visit; on a note, AI > "Ask about this note" no longer closes an open Ask; copy that named moved controls (phone "Today's note", Daily brief "+ New", guide registry, Support's Trash/Archived and Print); em dashes out of the two Insert tooltips, the review-draft failure sentence and the empty list line; three localStorage keys declared by hand in persistenceManifest.json.

First-open bytes after the build: 2,256,375 B of 2,260,793 B (PASS).

Pre-existing tests changed and why: `tours/b4Styles.test.jsx` and `tours/b4Styles.a11y.test.jsx` (the library tour now has tier steps; the a11y walk uses the engine's own tier filter), `GettingStartedChecklist.test.jsx` (href with `#templates`, "Optional"), `a11y/emptyNotebookList.a11y.test.jsx` (the first screen's sample door is the card's row now), `EditorToolSlots.test.jsx` (B5), `agentGuidePages.test.jsx`, `TodayHome.test.jsx`, `Support.notebook.test.jsx`, `vocabulary.test.js`, `reviewDraftRun.test.js` (the copy changes).

Left for part 2 (instruments): the 390 walks for A1 / C2 / C3, the C1 walker wait and seven rows and the by-hand reproduction, A2, A3, section E, and the walker / door-table words listed in the part 1 report.

## Final fix, part 2 (instruments and close-out), base `57dded41f4`

Report: `.superpowers/sdd/2026-11-11-notebook-simplify/final-fix-2-report.md`. Evidence: `docs/notebook/evidence/fin-walk/7e849c6740-rewalk/` and `docs/notebook/evidence/door-audit-20261113T023016Z/`; summary in `docs/notebook/fin-walk.md` section 9.4.

Product (the coordinator's three residuals from the part 1 re-review, each with a focused vitest and a red proof):
- R1: the sample removal's held-title reads give up after 3 s (aborted and raced), so one hung read cannot keep "Removing..." up; "A note" then.
- R2: the find stand-in's icons use the toolbar icon size (16); `styles/notebookTokens.lint.test.js` is green again (the stand-in file is this branch's).
- R3: "Remove the sample notebook" sits right after Export at every width, so a desktop More menu never opens with focus on the destructive row (desktop order: Export, Remove the sample notebook, My tools, Manage templates; keyboard and click both land on Export). On a phone it is reachable by scrolling inside the capped menu (walked at 390).

First-open bytes after the build: 2,256,355 B of 2,260,793 B (PASS).

Instruments: the walker and door-audit words part 1 listed (one sample door on the empty list; "Today's note"; the new hold words; "+ New"), the C1 save-wait (the walk leaves the AAPL note only once its save has landed), new walk cases for C2 (Get started template row opens the New note sheet) and C3 (390, sample active: the More menu inside the window above the "+", every row reachable, removal works), A2 (gallery Use, /style chooser title) and A3 (sizing on a member whose size was never saved; the Templates idle sentence). A2 and A3 rows were INSTRUMENT: master S7/S9 wording and master `9449b525d9` (a saved account size is the member's own whatever its value).

Door audit, rows touched re-measured (23, 26 x2, 34, 54, 56, 63): row 54 (More > Manage templates) is OK at 390 where it was EASY: the phone menu is now capped above the "+" (C3) and, with the sample active, its last row needs a scroll inside the menu. Not HARD, so no ruling needed; recorded here. Row 63's HARD reason now notes that the template walkthroughs start on the phone row (A1).

Recorded, not fixed (master-era, offline layer): the by-hand C1 reproduction held the removal with the new sentence; following the sentence let the removal through, but the words typed before the aborted save never reached the server (Concerns in the report).

## Pass 2, Task 1 (2026-11-12): one name per thing (spec A1, A4 to A10), base `64e5fc4516`

Spec: `docs/superpowers/specs/2026-11-12-notebook-simplify-2-design.md` section A. Report: `.superpowers/sdd/2026-11-12-notebook-simplify-2/task-1-report.md`. Every move is a string (A8 also a handler); undo any row by reverting its lines.

What moved, and the one-line undo:
- A1 `TodayHome.jsx`: the Daily brief's visible h2 reads "Daily brief"; the greeting ("Good morning, {name}") is the first part of the date line under it. Undo: put the greeting back in the h2 and `headerLine(data)` alone in the line.
- A4 note types, "kind" -> "Note type" in member copy: `styles/StylesManager.jsx` (Note type added. / renamed. / Give the note type a name. / Set the note type on N notes. / Set note types / Your note types / You have no note types of your own yet / Delete the note type X? / Yes, delete note type X / Keep note type X / Delete note type X (aria-label) / New note type name / Add note type), `styles/SaveAsStyleForm.jsx` (Choose a note type), `styles/ExampleNotePicker.jsx` (... of this note type ...), `styles/KindSection.jsx` (Loading note types..., screen-reader status). Undo: the old words back in those strings.
- A5 template, "layout" -> "template": `styles/StyleUpdateSheet.jsx` (sheet title Update template; LOCKED_SENTENCE ...change its template.; This note already has the latest template.), `styles/StyleUpdateBanner.jsx` (Update template to vN?), `pages/Support.jsx` FAQ "How do templates and the daily note work?" (start a note from a template; To make a template of your own). Undo: the old words back.
- A6 `AskPanel.jsx`: the note scope's door is "Ask about this note" (visible text and accessible name), and its panel (dialog) is named the same (was "Ask This note"). Undo: `toggle: 'Ask this note'` and `label={`Ask ${scopeLabel}`}`.
- A7 `components/MobileNav.jsx`: `'/journal/notebook': 'Notebook'` in `ROUTE_TITLES` (longest prefix wins); `titleFor` is exported for its test (no other file reads the table). Undo: drop the row.
- A8 `NotebookPlusSheet.jsx` + `NotebookTab.jsx`: the "+" sheet's "Ask AI" (navigated to `/journal/compass`) is "Ask your Notebook", prop `onAskNotebook` (replaces `askAi`); NotebookTab passes `openAiFromMenu`, the list More row's own handler, only when `auth.isPaid`. Compass stays reachable from the Journal's Compass tab. Undo: restore `askAi` and the `navigate('/journal/compass')` row.
- A9 "Journal tools" -> "Trade journal tools": the list More row (`NotebookTab.jsx`), the open note's More row (`NoteEditorPage.jsx`), and the room they open, the folded header's disclosure toggle (`JournalLayout.jsx`). Undo: the old words back in the three places.
- A10 `NotebookTab.jsx`: the View menu group "List layout" (Rows / Cards) is "Show as". Undo: the old group name.
- Comments only: `NewNoteMenu.jsx` (names the group), `NoteEditorPage.jsx` (A6 note).

Not renamed (recorded, a later job): the server's own words, which need a server change: the property name "Kind of note" (`note_properties.py`, mirrored by `lib/templateSlots.js`, already in `vocabulary.test.js`'s ALLOW), the widget builder's filter field "Note kind" (server catalog; `widgetBuilder/builderCatalog.js` keeps its matching fallbacks "A removed note kind" / "A note kind that couldn't be loaded"), and the refusals "Choose a kind of note." / "Choose a kind of note for this style." (shown as the server words them). The admin-only gallery review panel (`components/admin/TemplateGalleryReviewPanel.jsx`, "Kind of note:") is not member copy. "Kind" in `TradeCanvasDialogs.jsx` (a price-level role) and the page-layout panels' "layout" are other meanings, left.

Walker, door-table and Python-test strings these renames invalidate (Task 4 updates them; not edited here):
- `tools/notebook_fin_walk_features.py:2533`, `:2545` regex `Update layout to v\d+\?` -> `Update template to v\d+\?` (A5); `:3308` `f"Update layout to v{v2}?"` (A5); `:3297` comment.
- `tools/notebook_fin_walk_features.py:2851`, `:3237` `get_by_role("button", name="Journal tools", exact=True)` -> "Trade journal tools" (A9); `:2850` comment.
- `tools/notebook_proof_walk.py:1567` and `:3987` button "Ask this note" -> "Ask about this note" (A6).
- `tools/notebook_nvda_pass.py:1186`, `:1187`, `:1198` "Ask this note" in the expected speech and `focus_role("button", "Ask this note")` (A6; the panel is now announced "Ask about this note").
- `tools/notebook_w13q_clicks.py:1508` press label "Ask this note" (a label for the log; the locator is `[data-ask-toggle]`, still valid) (A6).
- `tools/notebook_w14_flagsoff_parity.py:156`, `:157` (`aria-label="Ask this note"` in the recorded head), `:164`, and `tests/test_notebook_w14_flagsoff_parity_expected.py:43`, `:51`, `:174` (the check's name "note Ask door is named 'Ask this note' (P0.7)") (A6).
- `tools/notebook_door_audit_doors.json:764`, `:766` prose "behind Journal tools" (A9; text only, no locator).
- Outside the named globs, same words: `tools/wave_n_e2e.py:441` `get_by_label("Ask this note")` (A6).
- Comments only, still true as history: `tools/notebook_fin_walk_features.py:2126`, `tools/notebook_fin_walk_keyed.py:287`, `tools/notebook_contract_fixtures.py:1865`, `tools/notebook_perf_harness.py:579`, `tests/test_notebook_flags.py:87`, `tests/test_notebook_perf_harness.py:619`.
- None found for A1 (no walker reads the greeting heading), A4 (no walker reads the kind strings), A7, A8 or A10.

Existing tests changed, and why (all follow the new words; none weakened):
- `StylesManager.test.jsx`, `a11y/journalStyles.a11y.test.jsx`, `NoteMenuActions.saveAsStyle.test.jsx`, `styles/KindSection.loadingShape.test.jsx`, `styles/ExampleNotePicker.test.jsx`: A4 words. `StylesManager.test.jsx`'s absence check `/with a Research Type\. Set their Kind/` now names "Note type", the words the offer really uses (the old pattern matched nothing either way).
- `NoteEditorPage.styleUpdate.test.jsx`, `NoteEditorPage.styleUpdate.gateOff.test.jsx`: A5 words; the two "no banner" checks now match `Update (layout|template)`, so they cannot pass by looking for words the page no longer uses.
- `AskPanel.test.jsx`, `NoteEditorPage.calmToolbar.test.jsx`, `NoteEditorPage.askInsert.test.jsx`, `NoteEditorPage.citations.test.jsx`, `NoteEditorPage.s10.test.jsx`, `NoteEditorPage.phoneHeader.test.jsx`, `a11y/focusFlows.test.jsx`: A6 door and panel name.
- `NotebookPlusFab.test.jsx`, `a11y/notebookPlusFab.a11y.test.jsx`: A8 (`onAskNotebook`, no navigation).
- `NotebookTab.phoneFoldFirstFrame.test.jsx`, `NoteEditorPage.titleWrap.test.jsx`, `JournalLayout.compactHeader.test.jsx`: A9.
- `NotebookTab.listLayout.test.jsx`: A10.
- `TodayHome.test.jsx`: A1 (the line now starts with the greeting).
- `NotebookTab.landing.test.jsx`, `a11y/deleteFocusFallback.test.jsx`: on the Daily brief there are now two h2s named "Daily brief" (the pane's visually hidden focus-landing heading, and the Today home's visible one), so these find the one they mean.

First-open bytes after the build: 2,256,957 B of 2,260,793 B (PASS). The same build of the base `64e5fc4516` measures 2,256,855 B, so these renames cost 102 B (longer words); the "2,256,355 B at the start" figure predates the #1169 merge in the base.

New tests: `components/MobileNav.test.jsx` (A7); the "+" row through the real NotebookTab in `NotebookTab.goLiveMenus.test.jsx` (A8); an A1 case with a member's name in `TodayHome.test.jsx`; the Support FAQ sentence in `Support.notebook.test.jsx` (A5); the rename status in `StylesManager.test.jsx` (A4).

### Pass 2, Task 1, fix round 1 (base `21dca6ca9b`)

What moved, and the one-line undo:
- A8, the "+" sheet's "Ask your Notebook" (`tabs/NotebookTab.jsx`, `openAiFromPlus`): from an open note or the Daily brief it first goes to the notes list (`selectAllNotes`, the panel's "All notes" action) and opens the Ask section there, in one press, focus in the question field; from the list it opens as before. Its opener is the "+" itself, so closing Ask puts focus back on "Add to your notebook". `closeAi` returns focus to an opener only while it is still in the page (`isConnected`), else the "AI" button. Undo: pass `openAiFromMenu` to the sheet again and drop the `isConnected` check.
- A4, client side, "Kind of note" / "Note kind" -> "Note type": the property `builtin:note_kind` is renamed where the client reads it, by `asNoteTypeName` / `withNoteTypeNames` in `lib/noteKinds.js`, in the fetchers of `hooks/useJ2PropertyDefs.js` (every list that offers a property: the board's group-by, the table, the filter, RollupEditor) and `hooks/useNoteProperties.js` (a note's rows), and in `lib/propertyAutofill.js` (suggestions); the template "pick yours" type word (`lib/templateSlots.js` `TYPE_LABELS.note_kind`) and a shared template's note-kind choice (`library/oneStepUse.js` `slotsOf`); the widget builder's filter field (`widgetBuilder/builderCatalog.js` `indexCatalog`, and its two fallbacks "A removed note type" / "A note type that couldn't be loaded"). The property id and stored key are unchanged. Undo: drop the three rename calls and put the two words back.
- A4 copy: `styles/ExampleNotePicker.jsx` "None of your notes of this type match." / "You don't have a note of this type yet."
- Comments that named "Update layout" as the current name now say "Update template": `NoteEditorPage.jsx` (two), `lib/journalStyles.js`, `styles/LibraryUpdateSheet.jsx`.
- `vocabulary.test.js`: the ALLOW entry for `lib/templateSlots.js|Kind of note` is gone (the word is no longer there); `templateSlots.test.js` now pins the ONE difference from the server's `share.TYPE_LABELS` (the server still says "Kind of note", the client "Note type").

Still the server's words, by ruling (a later server job): the refusals "Choose a kind of note." (`api/services/journal_two/journal_styles.py`, a styled create, contract fixture `app/src/pages/journal-2-0/__fixtures__/contract/notes.create.kind.unknown.json`) and "Choose a kind of note for this style." (the same file, fixture `journal-styles.create.bad-kind.json`, pinned by `tests/test_notebook_journal_styles_router.py:83`), shown as the server words them; the server's own labels ("Kind of note" in `note_properties.py` and `widget_engine/share.py`, "Note kind" / "No kind" in `widget_engine/sources.py` and `public_words.py`), which also reach a widget's own result rows ("No kind") and its server-written plain text.

Tests changed: `PropertiesSection.noteKind.test.jsx` now runs the REAL property hooks over the server's payload (the network is the only stand-in) and expects "Note type"; `widgetBuilder/sources.test.jsx` (the field and chip read "Note type", "Note kind" absent in the open field list); `templateSlots.test.js` (the pinned difference); `ExampleNotePicker.test.jsx`; `NotebookPlusFab.test.jsx` (the rows exactly and in order, in place of an absence check); `NotebookTab.listLayout.test.jsx` (the old name "List layout" absent where the group is drawn, and in the Table control). New: `hooks/noteTypeName.test.jsx`; in `NotebookTab.goLiveMenus.test.jsx` the "+" row from the list, an open note and the Daily brief, and focus return from "+" and from the ⋯ row.

First-open bytes after the build: 2,258,283 B of 2,260,793 B (PASS); +361 B over Task 2's 2,257,922 B.

## Pass 2, Task 2 (2026-11-12): the Daily brief shows only what it has (spec B1 to B5, A3), base `d470b736dc`

Spec: `docs/superpowers/specs/2026-11-12-notebook-simplify-2-design.md` section B and row A3. Report: `.superpowers/sdd/2026-11-12-notebook-simplify-2/task-2-report.md`.

⛔ **THE DAILY BRIEF NO LONGER CREATES TODAY'S NOTE.** Opening `?view=today` reads `GET /api/j2/notes/today?make=0` in every state (it used to make the note and its folder on the first open of the day unless the first run was pending). The note is made only by a press: the brief's "Start today's note", the list's "Today's note", Ctrl+Alt+D, the phone row, the first run's Build, the recap card. A walker step that visits the brief and then expects today's note to exist must press Start (or the list button) first.

What moved, and the one-line undo:
- A3 `api/services/journal_two/note_daily.py`: `DAILY_FOLDER_NAME = "Daily notes"`, `LEGACY_DAILY_FOLDER_NAMES = ("Daily",)`; `_daily_folder_id` looks for a root legacy-named folder first (oldest first), then "Daily notes", else makes "Daily notes". No rename, no migration. Undo: `DAILY_FOLDER_NAME = "Daily"` (the lookup then finds "Daily" twice, harmless) or revert the function.
- A3 follow-on, `lib/dailyNote.js`: `DAILY_FOLDER_NOTICE` "Saved in your Daily folder." -> "Saved with your daily notes." (the folder is "Daily notes" for a new member and "Daily" for an existing one, so the sentence names neither). Undo: the old string.
- B1 `lib/todayHome.js` `TODAY_READ_URL` (`/api/j2/notes/today?make=0`) is the brief's one read; `TodayHome.jsx`'s `todayKey`/`todayRead` (make / hold / wait) and the `onNoteMade` effect are gone; `NotebookTab.jsx` no longer computes `todayRead` (the first-run state it read still feeds the walkthrough gate). Undo: revert those three files' B1 hunks.
- B1/B4 header, `TodayHome.jsx`: "Quick capture", "All notes" and "+ New" are removed from the brief's header (their palette, panel-row and list doors are unchanged); one button in their place: "Open today's note" (exists), "Start today's note" (none; calls NotebookTab's `openToday`, the list button's door, with `seedToday: true` so the new note carries the plan the read used to seed), Restore / "Start a fresh one" with "Today's note is in Trash." (trashed), "Today's note" (the section could not be read). While the read is in flight an invisible copy holds the button's room. `openToday` now takes `{ seedToday }` and revalidates `TODAY_READ_URL` after it opens or makes the note. Undo: restore the three buttons and the plan card's footer button.
- B2 `TodayHome.jsx` `cardKind`: "Open from yesterday" and "On this day" are not drawn when empty; "Today's plan" only for an existing note with open lines (its "Open today's note ->" footer left: the header has the door); a section the plan does not include (`reasons.x === 'plan'`, e.g. setups without a paid plan) is not drawn. A section that failed still draws with "Try again". Card order per session unchanged; empty ones are skipped. Undo: `cardKind` returning `'content'` for every non-null section.
- B2 teaching sentences moved to Help (`pages/Support.jsx`, "How do I get started with the Notebook?"): "A checklist line you don't tick today, or a task due today, shows there tomorrow, and what you write today comes back there next year." The empty-card lines ("Nothing left open. ...", "Nothing written on this date ...", "Nothing on today's plan yet. ...", "Today's plan is written when you set up your Notebook.") are gone. Undo: the old empty states back in the three cards.
- B3 compact asks: `FirstPlanAsk compact` (new prop) draws one line ("Type a ticker to draw your first plan; it shows here, closest to its entry first.") and the field, no "Draw your first plan" title, no numbered steps, no "+ NVDA/SPY/QQQ" links (the setups board's full ask is unchanged); the names ask on the brief is `EmptyNamesAsk` with "Add the tickers you watch, and your earnings and plan will follow them.", no suggestions and no import row (`EmptyNamesAsk` draws its Suggestions group only when it has something in it). The "Add" disclosure for a member WITH names still opens the full ask. Undo: drop `compact` and the three props.
- B5 `NOTHING_YET`: "Nothing for today yet. Your plan, the setups near your entry and your names will show here." above the grid when every drawn card is an ask.
- Heading: the brief's visible `<h2>Daily brief</h2>` takes NotebookTab's `paneHeadingRef` (`tabIndex={-1}`, `data-focus-fallback`); NotebookTab draws its hidden pane heading only when not on the brief. While the brief's chunk loads, its `lazyView` fallback (`TodayHomeLoading`, `lazyView` now accepts a component fallback) draws the hidden heading with the ref, and hands focus to the visible one if it held focus when replaced. The visible heading's focus ring is the app's own `:focus-visible` rule. Undo: render the pane heading on every `!noteId` view and drop `headingRef`.

Walkthroughs: no `data-tour` anchor sits on the brief's cards, the setups card or `FirstPlanAsk` (grep of `data-tour` in `TodayHome*.jsx`, `FirstPlanAsk.jsx`, `EmptyNamesAsk.jsx`); `earnings-prep` and `passed-setups` anchor on the folded boxes, untouched. `tourAnchors`, `tourReachability`, `phoneHiddenAnchors`, `todayLanding.tours`, `todayLanding.anchor` pass unchanged.

Walker, door-table and Python-test strings this invalidates (Task 4; `tools/` not edited here):
- `tools/notebook_personal_api_walk.py:62`, `:120`-`:128`: the walk matches only a root folder named `DAILY_FOLDER_NAME`, now "Daily notes". bench@'s production folder is "Daily", so the daily step reports NOT RUN ("no root Daily notes folder") until it also accepts `note_daily.LEGACY_DAILY_FOLDER_NAMES` (import it, never restate it). `tests/test_notebook_personal_api_walk.py`'s stub library was moved to the door's name (see below); Task 4 should add a legacy-"Daily" case once the walk takes it.
- Visits to the brief that no longer make today's note: `tools/notebook_fin_walk.py:1023`, `tools/notebook_fin_walk_features.py:426`, `:1494`, `:2046`, `:2090`, `:3698`, `tools/notebook_proof_walk.py:1370` (`s_home`). None of them reads today's note afterwards by grep, but each must be confirmed: any step that expected the visit to leave a note in "Daily" must press "Start today's note".
- `tools/notebook_fin_walk_features.py:2090`-`:2122` (`discover.setups-card`): for a member with no plans the setups card is now the compact ask (no title, no steps, no "+ NVDA" links); the board link still shows only when `setups.count > 0`.
- No walker reads "Saved in your Daily folder.", the removed brief buttons, the empty-card sentences or "Open today's note ->" (grep of `tools/notebook_*.py` and `tools/notebook_door_audit_doors.json`). `tools/notebook_door_audit.py:122` (`[data-today-home]`) is unchanged.

Existing tests changed, and why:
- `tests/test_journal_two_daily_note_router.py`: three folder assertions name "Daily notes" (A3); the member-made "Daily" case kept as it was.
- `tests/test_notebook_personal_api_walk.py`: its stub's daily folder (and the trimmed / nested look-alikes) use `note_daily.DAILY_FOLDER_NAME` instead of the literal "Daily", because the walk it tests matches only that name (four rails went red on the rename). The identity rail is unchanged.
- `TodayHome.test.jsx`: the M7 "never empty" block, the I9 / R1-B read-decision cases and "a note this read MADE" are replaced by the B1 to B5 cases; the header assertions follow B4; Quick capture's case now asserts the brief opens no capture dialog.
- `TodayHome.homeNotes.test.jsx`: its fixture's today's note has one open line, because these cases wait on the plan card, which now draws only with one.
- `a11y/todayHome.a11y.test.jsx`, `TodayHome.homeNotes.test.jsx`: the read URL is `TODAY_READ_URL`; props follow the new interface.
- `NotebookTab.todayLanding.test.jsx`: the four read-decision cases (make / hold / wait) become "no read decision is handed down in any first-run state, and the Start door is".
- `NotebookTab.landing.test.jsx`, `a11y/deleteFocusFallback.test.jsx`: back to ONE "Daily brief" heading (Task 1 had them pick between two); the AI-section case leaves the brief by the panel's All notes row (its FolderSidebar stub gained that row) instead of the removed brief button.
- `NotebookTab.daily.test.jsx`, `surfaces/today/panels/panels.test.jsx`, `EODRecap.test.jsx`, `insights/InsightsHub.test.jsx`: the notice's new words.

First-open bytes after the build: 2,257,922 B of 2,260,793 B (PASS). The same build with the base's copies of this task's nine source files measures 2,256,949 B, so this task costs 973 B: `TodayHome` +311 B, `NotebookFlagGate` (NotebookTab) +370 B, `FirstPlanAsk` +265 B, `EmptyNamesAsk` +26 B, `reviewDraftsFlag` (dailyNote) +1 B. ⚠️ `TodayHome.jsx` is one of the budget's three roots (`docs/notebook/perf-budgets.json`), so the brief's code IS counted as first open; the brief chunk is not exempt.


### Pass 2, Task 2, fix round 1 (base `45220376c4`)

What moved, and the one-line undo:
- Nothing shifts on the first read (review Important 1): while the brief's read is in flight it draws the header and ONE skeleton (the plan card's; `SKELETON_ORDER = ['plan']`), and nothing below the grid: the first-run slot and the folded boxes ("Reporting soon", "Passed setups") wait for the answer or its failure, as the note sections already did. The half-card and recap skeleton reserves left `TodayHome.module.css` with their skeletons. A walkthrough wanted before the read still finds its fold open: the boxes mount with the answer and `CollapsibleSection` opens on a truthy `openSignal` at mount (the engine waits up to 8 s for a first anchor, `GenericTourEngine.START_WAIT_MS`). Undo: restore the five-card `SKELETON_ORDER` and its reserves, and draw `FirstRunSlot` / `MoreBoxes` unconditionally.
- One door, one note: `openToday` asks for `seedToday` on EVERY call, so a note made from the list's "Today's note", Ctrl+Alt+D or the phone row now starts with today's plan lines, as notes made by visiting the brief always did (an existing note is opened unchanged: the server seeds only a note this call makes). Undo: `seedToday: false` for those callers.
- After any create through `openToday`, the brief's cached answer is told at once that the note exists (an optimistic `todayNote` built from the create response), then re-read: a return to the brief says "Open today's note" without waiting. Undo: `mutateSwrKey(TODAY_READ_URL)` with no data.
- Start reads "Starting today's note…" (disabled, `aria-busy`) while it runs. Undo: drop `STARTING_ACTION`.
- `TODAY_URL` is no longer exported from `TodayHome.jsx` (tests use `TODAY_READ_URL` or the literal).
- The recap card's press can now make today's note and its folder (the page no longer does): its docstring says so.

Recorded facts (one line each):
- A3's match is case-insensitive, so a root folder named "Daily Notes" (a Roam import's) is adopted as the daily folder.
- `today_opened.created` is now always false on a page open.

Tests changed: `TodayHome.test.jsx` (the five-skeleton order case became "one skeleton, then the session's order"; new cases for read pending, a member with nothing, a failed read, and a walkthrough wanted before the read; Start's busy words), `TodayHome.layout.test.js` (one skeleton reserve, no others), `NotebookTab.daily.test.jsx` (the list button's and Ctrl+Alt+D's create requests carry `seedToday`), `NotebookTab.landing.test.jsx` (the brief's re-read is held after Start, so "Open today's note" must come from the written cache).

Walker strings this round touches (Task 4): the list button now seeds a note it makes, so a walk that makes today's note through it and then reads the body sees today's plan lines first: `tools/notebook_proof_walk.py:3041`, `:3826`, `tools/notebook_w13q_clicks.py:1296`, `:1298`, `tools/notebook_fin_walk_live.py:83` (by grep they check only that a note opened). The brief's busy label "Starting today's note…" is read by no walker.


## Pass 2, Task 3 (2026-11-13): fewer rows (spec C1 to C6, D1 to D3), base `16bc8c0129`

Spec: `docs/superpowers/specs/2026-11-12-notebook-simplify-2-design.md` sections C and D, Review focus 3 and 5. Report: `.superpowers/sdd/2026-11-12-notebook-simplify-2/task-3-report.md`.

### Group 1: one second view, then C1, C2, C3

What moved, and the one-line undo:
- The menu engine (`components/notebook/NewNoteMenu.jsx`) has ONE second-view mechanism, lifted from the "Aa" menu's Font and Size: a `MenuRows` item with `children` opens "Back" (named "Back to {menu}") and the children inside the same `role="menu"`; Back, Escape or Left return with focus on the opening row; Escape there closes. `NoteFormatMenu.jsx` now uses it (focus lands on the first font or size, not on Back). Undo: revert `NewNoteMenu.jsx` and `NoteFormatMenu.jsx` together (the old Aa view comes back with its file).
- C1 View menu: Graph and Timeline under "More views" (`more: true` on their `VIEW_MODES` rows, `lib/savedViewModes.js`); the trigger still names the mode and "More views" reads as current while one is on; `?view=` links and saved views open them directly. Undo: drop the two `more: true` flags (the menu draws every mode in its first view again; the More views row then has no children and should be removed with them).
- C2 New menu and phone More: one row "Draft a review" whose second view holds the three reviews (`draftReviewRow`, `tabs/NotebookTab.jsx`). Anchors: `review-drafts-open` (new, New menu row), `review-drafts-phone` (phone row, now a button), `review-drafts-daily` and `review-drafts-weekly` on the children in BOTH menus (written once, the menus are never open together). ⚠️ `review-drafts-monthly` was removed: the Reviews walkthrough gained an "Open Draft a review" step per tier and had to stay within 6 steps, so the weekly and monthly steps merged into `later` ("This week's and this month's review") and the orphan rail refuses an anchor no step names. Undo: restore the `group: 'Reviews', heading: true` items in both menus and the old `reviewDrafts.steps.js` (and the monthly anchor).
- C3 the note's More panel: one "Export" row; its formats are the panel's second view (`NoteMoreMenu.jsx` hides its content, kept mounted, and gives a `slot`; `NoteExportControls.jsx` portals its menu there). The formats' menu itself moved to `components/notebook/export/NoteExportMenu.jsx`, a chunk fetched on idle or at the press (`lib/heldModule.js`), off first open. Undo: revert the three files and delete `NoteExportMenu.jsx` (the dropdown under Export comes back).
- Test kit: `lib/testing/menuSecondView.testkit.js` (`expectSecondView`), called for every menu above. Not at the brief's path beside the components: `components/screener/reachable.test.js` counts only `testing/`-style paths as test infrastructure.

Walker, door-table and Python-test strings this group invalidates (Task 4; `tools/` not edited here):
- Graph and Timeline are one press deeper in the View menu (press "More views" first): `tools/notebook_proof_walk.py:1706`, `:1707` (`s_list(W, pg, "Timeline"|"Graph")`), `:4198` (`f_view("Timeline", ...)`), `:4162` and `:4222` (`btn(pg, "Graph view")`, already a pre-S11 name); `tools/notebook_nvda_pass.py:1204`, `:1206`, `tools/notebook_wave10b_walk.py:698`, `tools/notebook_wave6_walk.py:1026`, `:1110`, `tools/notebook_wave7_walk.py:1557`, `:1627` ("Graph view" / "Timeline view" buttons, stale since S11 and now also tucked).
- The three reviews are behind "Draft a review" (press it, then the review): `tools/notebook_fin_walk_features.py:1451` (`review-drafts-{kind}`, and `monthly` no longer has an anchor: press the row by name), `:1767`, `:1802` (the review names are no longer rows of the New menu / phone More first view; "Draft a review" is), `tools/notebook_fin_walk_keyed.py:831`, `tools/notebook_fin_walk_keyed_ai.py:527` (same, `monthly` by name), `tools/notebook_w13q_clicks.py:1972`-`:1980`, `tools/notebook_fin_walk.py:1189` (a Research-home path, already stale).
- The note's Export menu is now the More panel's second view, drawn from a chunk (wait for the menu after pressing Export; Escape returns to the panel, a second Escape closes it): `tools/notebook_proof_walk.py:1562`, `:4021`, `tools/notebook_wave8_walk.py:1741`. The palette door (`tools/notebook_w13q_clicks.py:1656`-`:1672`) still lands on the formats with focus on PNG.
- Unchanged and checked: `tools/notebook_p5_walk.py:408`, `:415` (the New note sheet's "Start from a template" group), `tests/test_notebook_contract_fixtures.py:202` and `tools/notebook_contract_fixtures.py:849`-`:899` (the review-drafts API routes), `tools/notebook_door_audit_doors.json` (no hit).

Existing tests changed, and why: listed in the report's group 1 section (the second view's focus and Back name in the Aa cases; C1 and C2 row lists; the review tour's start; the export cases that now find the menu after its chunk lands).

First-open bytes after the build: 2,257,929 B of 2,260,793 B (PASS), base 2,258,148 B: group 1 is -219 B (the same group measured +1,217 B before the Export menu moved to its own chunk).

### Group 2: C4, C5, C6

What moved, and the one-line undo:
- C4 Insert palette (`components/notebook/WidgetPalette.jsx`): the "More" group (the wave-4 market snapshots: news, breadth, indexes, market context, alerts, scans, watchlist, themes, COT, Model Book) is not drawn until "Show all" (accessible name "Show all blocks") at the foot of the list is pressed; then it stays for that palette's life (a form's Back keeps it) and focus goes to its first row. The palette has no search; the slash menu is unchanged. Undo: `const folded = false` (or drop `showAll`).
- C5 the zero-notes list (`tabs/NotebookTab.jsx`): the inline template grid is not drawn while the Get started card is up (`useGettingStartedCardUp()`, pass 1's signal), nor while the preferences read that decides the card is in flight; with the card hidden, closed, failed to load or switched off the grid draws as before. "+ New"'s arrow and the card's template row still open the picker. Undo: drop `!gridWaits &&` from the TemplatePicker's condition (and the `gridWaits` constant above it). (Pass 2 final fix M12: this line named `!prefsLoading && !gettingStartedUp &&`, which is not in the code.)
- C6 the More menu's removal row: "Remove sample notebook" at 640 px and below (`SAMPLE_ROW_COPY.removeRowPhone`, `sampleNotebookKeys.js`, chosen by the file's existing `useIsPhone()`), "Remove the sample notebook" above. Undo: label back to `SAMPLE_ROW_COPY.removeRow`.

Walker, door-table and Python-test strings this group invalidates (Task 4):
- `tools/notebook_fin_walk_features.py:1861`, `:1891`, `:1892`, `:1909` (`discover.phone-more-sample`, 390 px): the row is named "Remove sample notebook" there; `SAMPLE_REMOVE_ROW` (`:95`) still reads `removeRow` (desktop words), so the 390 step must read `removeRowPhone`. `:530`, `:4241`, `:4274` (desktop) are unchanged. `tests/test_notebook_wave8_walk.py:549` (`removeRow`) is unchanged.
- C5: a walk that opens a brand-new member's empty list with the Get started card up and expects the inline grid must open the picker (the card's "Start a note from a template", or "+ New"'s arrow, then "From a template") first. By grep, `tools/notebook_fin_walk_live.py:103` presses "Templates" first (a pre-S11 name already) and `tools/notebook_w13q_clicks.py:1045` reads the sheet, so no walker reads the inline grid on an empty account directly.
- C4: no walker presses a "More" group row in the Insert palette (grep of the ten titles in `tools/notebook_*.py`; `tools/notebook_fin_walk_features.py:2812` reaches Market context by the slash menu, unchanged). `tools/notebook_proof_walk.py:1547`-`:1549` opens the palette; its first view now ends in "Show all".

Existing tests changed: `pages/charts/widgets/captures/dataEmbedsInsert.test.jsx` and `newsCapture.test.jsx` press "Show all" before the More group's COT, Model Book and News rows.

First-open bytes after the build: 2,258,012 B (group 2: +83 B; the palette is its own chunk, so C4 costs nothing on first open).

### Group 3: D1, D2, D3 (and a C5 correction)

What moved, and the one-line undo:
- D1 `components/notebook/onboarding/RegistryToursGate.jsx`: a wanted walkthrough held behind the first run (`useFirstRunShowing() || useFirstRunPending()`) is let go after `FIRST_RUN_HOLD_MS` (10 000 ms) of hold, through the gate's own failure path: it closes as not opened (the offer is not spent) and the existing `TOUR_FAILED_NOTICE` is said. A first run that ends sooner opens it as before. The timer covers any held walkthrough, not only one started from Help (the gate does not know where a request came from; Help is the only door a brand-new member has during the first run). Undo: delete the `held` effect.
- D2 `components/notebook/onboarding/sampleNotebook.js` `describeSampleHold`: unsent notes keep their sentence; BLOCKED notes get one of their own after it: the title(s), then "is waiting to sync. Edit it once more so it can save, then remove the sample again." (`blockedOne` / `blockedMany`). Undo: map blocked ids through `heldOne` / `heldMany` again.
- D3 `tabs/NotebookTab.jsx`: the `#templates` door opens the New note sheet as `'hash'` (read as open everywhere else); when the hash goes away (browser Back) a `'hash'` sheet closes, and a sheet opened by a button is left alone. Undo: `setPickerOpen(true)` in the door and drop the else branch.
- C5 correction (found by `NotebookTab.test.jsx` after group 2 committed, four cases red): the grid waited for the preferences read for EVERY member; it now waits only while the Get started card's switch is on (`checklistEnabled(notebookFlag) && prefsLoading`), because with the switch off no card can come and the grid drew in the first render before. Undo: drop `!gridWaits &&` from the TemplatePicker's condition (and the `gridWaits` constant), as group 2's C5 line now says.

Walker, door-table and Python-test strings this group invalidates (Task 4):
- `tools/notebook_fin_walk_features.py:110`, `:111`, `:4250` (`remove sample`'s designed-hold detection reads `heldOne` / `heldMany`): a hold on a BLOCKED sample note now says `blockedOne` / `blockedMany`, which that check does not match; and its remedy is one more edit, not a wait, so the step's "wait 15 s and press again" cannot clear it.
- D1 and D3: no walker reads `TOUR_FAILED_NOTICE` or presses the browser's Back after `#templates` (grep: `tools/notebook_fin_walk_features.py:1814`-`:1838` follows the link and presses Escape).

Existing tests changed: `sampleNotebook.hold.test.js` ("several held notes (unsent and blocked)" became "several unsent notes"; the blocked cases are new).

First-open bytes after the build: 2,258,202 B of 2,260,793 B (PASS); group 3 +190 B. Task 3 in all: +54 B over the base's 2,258,148 B, 2,591 B of room left.

## Pass 2, Task 4 (2026-11-13): instruments, the acceptance walk and evidence, base `ae44ec5f2d`

Report: `.superpowers/sdd/2026-11-12-notebook-simplify-2/task-4-report.md`. Walk record: `docs/notebook/fin-walk.md` section 10, `docs/notebook/evidence/fin-walk/d84aa2d949/` (full c2) and `703a85d816-rerun/`, door audit `docs/notebook/evidence/door-audit-20261113T083108Z/`. Screenshots: `docs/notebook/evidence/simplify-2/` (`index.json` maps each spec row to its after shot and its before: a pass 1 evidence shot where the same screen exists, else one line).

Product (found by the walk; focused rail and red proof):
- C6 `tabs/NotebookTab.module.css`: at 390 "Remove sample notebook" still wrapped to two lines (the ⋯ menu sat at the menu engine's 200 px floor). The phone row-end menu (`.newWrap [role="menu"]`) now takes `width: max-content` (211 px measured, one line, inside the window; NewNoteMenu's max-width still caps it). Undo: drop the declaration. Rail: `NotebookTab.toolbarFits.test.js`.

Instruments re-pointed (every string the Task 1 to 3 sections listed; none deleted, skipped or turned into INFO):
- Fin walk: reviews through "+ New" arrow > "Draft a review" > the review by name; the New menu and phone More expect the one row and read its second view; phone sample row "Remove sample notebook" (one line); a BLOCKED sample hold recorded; "Update template", "Trade journal tools"; c3's review path.
- Proof walk, NVDA pass, w13q, wave N e2e, flags-off parity (+ its test): "Ask about this note"; proof walk, NVDA pass, wave 6, 7, 10b: Graph and Timeline through View > More views; proof walk and wave 8: Export waits for the More panel's second view (and skips its Back row). Door table rows 59/60 prose.
- `tools/notebook_personal_api_walk.py` accepts `note_daily.LEGACY_DAILY_FOLDER_NAMES` beside `DAILY_FOLDER_NAME` (imported); tests added (legacy root "Daily" appends; trimmed or nested look-alikes do not). Not run against production.
- blocks.prep-pack (`703a85d816`): reads what a gap that fills itself says since master S9 (FILLING_WORDS, no Captured line while filling) and S17's names ask; a non-retryable gap keeps the old read. Found by the full run (about 3 AM ET).
- New fin walk doors for the review's browser checks: `discover.daily-brief` (B1, B4, B5, check e), `discover.more-views` (C1, check f), `discover.note-second-views` (C3, check d), `discover.second-view-390` (check g), `discover.plus-ask-390` (A8, check a), `discover.insert-palette` (C4), and the C5 read in `first run`.

Recorded facts:
- At 390 the note's "Aa" is the Format row's toggle (font and size are native selects in the row); the Aa menu and its Font second view are desktop only.
- The empty list's line still says "Start from a template, or a blank page." while C5 hides the inline grid under the Get started card (the card's "Start a note from a template" and "+ New"'s arrow are the doors). Copy, owner call.

Results:
- Full c2 run, tip `d84aa2d949` (product as of `cbb10afc94`), empty data root: 332 steps, 308 PASS, 6 FAIL, 11 INFO, 7 NOT RUN. The 6 FAIL: blocks.prep-pack x3 (INSTRUMENT, re-pointed and re-run PASS x3) and smart.screenshot-tag x3 (configuration: no OCR in c2). Zero PASS -> FAIL that is PRODUCT against `13f1b01f5e` + `7e849c6740-rewalk`.
- Door audit, both widths: EASY 7, OK 12, HARD 11, HIDDEN 0, exit 0 (same counts as pass 1). No door went from EASY or OK to HARD, so no new ruling is needed.
- First-open bytes after the C6 fix: 2,258,225 B of 2,260,793 B (PASS).

Existing tests changed, and why: `tests/test_notebook_personal_api_walk.py` (legacy-folder cases; the restated-name rail now covers both names), `tests/test_notebook_w14_flagsoff_parity_expected.py` (the A6 entry's new name).

## Pass 2, final fix, part 1 (2026-11-13): product, base `63e87749aa`

Report: `.superpowers/sdd/2026-11-12-notebook-simplify-2/final-fix-1-report.md`. Brief: `final-fix-brief.md`, Part 1.

What changed (one undo line each):
- I2 `api/services/journal_two/note_daily.py` `_daily_folder_id`: the root folder of the member's most recent live daily note is used first when its name is a daily folder name (legacy "Daily" or "Daily notes", any casing); else the old name order. Undo: delete the `latest` read and its `if`.
- I3 `api/routers/journal_two.py` `POST /notes/daily`: `note_daily.daily_note_exists` first; the plan seed is built only when the note does not exist, inside `try/except` that logs and makes the note without it. Undo: build the seed unconditionally again (drop the `daily_note_exists` test and the `try`).
- I4 (ruling) the Daily brief's "Start today's note" makes the note and STAYS on the brief: the button becomes "Open today's note" and takes focus, the plan card arrives with the re-read, a polite status says "Today's note started." The list's button, Ctrl+Alt+D and the phone row still open the note. Undo: in `tabs/NotebookTab.jsx` pass `onStartToday={openToday}` to TodayHome (one line; `startTodayHere` then has no caller).
- I1 the recap card, New > Draft a review > Today's recap (and the phone row) and the Journal Today panel send the member's daily template and `seedToday` (the seed only for today's day). Undo: drop `templateId`/`seedToday` from `draftDailyReview`'s callers and from `TodayNotePanel`.
- M1 quiet line "Nothing for today yet. Today’s plan, the setups near your entry and your names will show here." M2 "Couldn't load your Daily brief." M3 the written recap card has no link of its own. M4 the first run says "Today's note started" when no plan line went in (`planSeeded` in the daily-note answer). M5 Help: the notes list's More menu > Export (whole notebook), the note's More menu > Export (one note); the walkthrough's Views card puts graph and timeline under More views. M6 "Note type" in the widget builder (restated, pinned by its test against `noteKinds.js`) and in template definitions (both names match the built-in). M7 a second view whose row leaves goes back to the first view with focus on its first row. M8 Export: "Export…" + `aria-busy` on a cold press, opens only where the member still is, ArrowRight opens it in the panel, a failed load says "Export could not be loaded. Reload the page to get this back." with a member-pressed Reload. M9 "Show all widgets". M10 `onPhone`. M11 runtime anchor-uniqueness rail. Undo: revert the commit named in the report for the item.
- Existing tests changed, and why: `NotebookTab.landing.test.jsx` (B1 now B1 + I4: Start stays), `TodayHome.test.jsx` (Start is `onStartToday`; recap call shape), `panels.test.jsx` (the panel's seed), `FirstRunSheet.test.jsx` (fixture answers `planSeeded`), `NotebookTab.phoneRow.test.js` (the rename), `NotebookTour.test.jsx` and `Support.notebook.test.jsx` (copy), `WidgetPalette.test.jsx` and two `charts/widgets/captures` tests (the palette button's name), `NotebookTab.listLayout.test.jsx` (four cases still expected Task 3's old first-view "Reviews" group; now the five first-view rows and the reviews behind "Draft a review", and its control no longer passes vacuously).

Strings these changes invalidate (Part 2 updates them; `tools/` and the walker pytest files were not edited here):
- `tools/notebook_fin_walk_features.py:4393`-`:4411` (`discover.daily-brief`, third step): presses `BRIEF_START` and then `wait_for_url(... "note=" ...)` at `:4394`, reading the made note from the URL. Start now STAYS on `?view=today`: the step must read the made note from `GET /api/j2/notes/today?make=0` (`todayNote.id`) or the daily POST, and assert the brief: still `?view=today`, the header button `BRIEF_OPEN` holding focus, the plan card (`[data-today-card="plan"]`) when the seed had lines, the polite status `[data-today-actions] [role="status"]` = "Today's note started." The step's sentence at `:4410` ("back on the brief the button says ...") and the comment at `:4343` say the old flow. A new walk row for I4 (Part 2 brief).
- `tools/notebook_fin_walk_features.py:135` reads `NOTHING_YET` with a single-quote pattern: the new line keeps single quotes (typographic apostrophe) so it still matches; `:4376` reads it by exact text (unchanged mechanism, new words).
- `tools/notebook_fin_walk_features.py:4644`, `:4659`, `:4661`: `aria-label="Show all blocks"` / `name="Show all blocks"` -> "Show all widgets".
- `tools/notebook_fin_walk_features.py:4512`-`:4535` (`discover.note-second-views`, the cold press on More > Export): still passes (Playwright's click focuses Export, so the formats open when the chunk lands); worth adding the new facts: the row reads "Export…" with `aria-busy="true"` while the chunk is held, and a failed chunk shows the alert "Export could not be loaded. Reload the page to get this back." with a Reload button (never "export failed").
- `tools/notebook_fin_walk.py:1185`-`:1201` (Draft a review > Today's recap): no string change; on a day with no note the recap now makes today's note WITH the member's daily template and the plan lines (Part 2's re-walk sets a daily template first).
- Door table `tools/notebook_door_audit_doors.json`: no row presses the brief's Start (grep); the Part 2 brief asks to re-measure only that door.
- No walker or Python test reads "Today's plan written", the recap card's old "Open today’s note →", the Help export sentences, the Views card or the "Note type" mapping (grep `tools/notebook_*.py`, `tests/test_notebook_*`).

First-open bytes: 2,259,277 B of 2,260,793 B (PASS, 1,516 B of room; 2,258,225 B at the base, so +1,052 B). The fix first measured 2,259,841 B; the payback is commit "keep first open inside the budget's room" (see the report).

## Pass 2, final fix, part 2 (2026-11-13): walkers, a targeted re-walk, the record, base `46436f6d6f`

Report: `.superpowers/sdd/2026-11-12-notebook-simplify-2/final-fix-2-report.md`. Walk record: `docs/notebook/fin-walk.md` section 10.4, `docs/notebook/evidence/fin-walk/4f3d94089f-rewalk/`, door audit `docs/notebook/evidence/door-audit-20261113T160915Z/` (rows 41 and 46). Screenshots: `docs/notebook/evidence/simplify-2/` B1, B4, B5 after-shots replaced and `B1-1280-after-start.png` added (`index.json`, `shots-facts.json`).

Product (R1, from the re-review of part 1): the Compass tab's recap card (`components/EODRecap.jsx`) and Insights' "Draft today's recap" (`components/insights/InsightsHub.jsx`) send the member's daily template and `seedToday` to `draftDailyReview`, like the Notebook's recap doors (the seed applies to today only). Undo: drop `templateId` and `seedToday` from those two calls (and the `usePreferences` read above each). Tests: `EODRecap.test.jsx`, `InsightsHub.test.jsx` (one case each; each argument removed is red). First-open bytes unchanged.

Instruments re-pointed (none deleted, skipped or turned into INFO):
- `discover.daily-brief`: Start stays on the brief (I4): the made note is read from `GET /api/j2/notes/today?make=0`; the row asserts `?view=today`, "Open today's note" with focus, the status "Today's note started." (`STARTED_STATUS`), the plan card's lines, ONE note after a double press, "Daily notes". New rows: Open today's note opens it; the list's Today's note on an existing note opens it at once and makes nothing.
- `discover.recap-template` (new door, I1): the recap door on a day with no note, with a daily template chosen in the template sheet.
- `discover.note-second-views`: the cold press's "Export…" + `aria-busy`, ArrowRight on the Export row (reached by Tab), and the failed-load alert with its Reload (`EXPORT_UNAVAILABLE` + `RELOAD_TO_RECOVER`, read from the product).
- `discover.insert-palette`: "Show all widgets" (read from WidgetPalette.jsx) at 1280, and at 390 through "+" > "Chart or block".
- `blocks.prep-pack`: the fourth gap state (`FINAL_WORDS` and the Captured line once nothing will fill it) through one pure read, `prep_gap_read`; pytest `tests/test_notebook_fin_walk_prep_gap.py`.
- Door table: no row presses the brief's Start; no string changed.

Results: re-walk at `4f3d94089f` (product `b4312c0ea7`): every final-fix row PASS; the only rows not PASS are three new rows' first contact (INSTRUMENT, re-pointed, PASS on the next run) and the resurfacing rows that need the `child` step's state (INSTRUMENT, attach state). Door audit rows 41 and 46 unchanged. First-open bytes 2,259,277 B of 2,260,793 B (PASS).

## Follow-up A (2026-11-13): first-open headroom, then usage counting, base `ae77287cb1`

Part 1, headroom. `lib/tradeCanvas.js` was one module imported statically by the schema node, the editor page, the slash menu and the canvas create door, so the board's operations, camera and placement rode on first open although only the board (already fetched on demand) runs them. The stored-shape half is now `lib/tradeCanvasModel.js` (re-exported by `tradeCanvas.js`); first-open importers read it. Rail: `lib/tradeCanvasModel.test.js`. First open 2,259,277 B to 2,252,145 B (-7,132 B). No surface changed when it appears.

Part 2, usage counting. Eight events, sent through the same telemetry door as every Notebook event (one POST each, never awaited by the press), stored as `j2:<event>` in `activity_log`, read by `tools/notebook_usage_report.py --db <path>` (read only). Every property is a fixed id or a bool: no title, ticker, tag, folder name, note text or anything typed is recorded, on the client (`sanitizeProps`) or again on arrival (`_sanitize_notebook_props`); a value off its list is stored as "other".

| Event | Question it answers |
|---|---|
| `view_used` (`mode`, `via`: menu, saved_view, link) | Which list views members choose, and through which door; which views could be retired. |
| `list_layout_used` (`layout`) | Whether anyone picks Cards over Rows. |
| `menu_row_used` (`menu`, `row`) | Which rows of the New, list More, View, note More, AI, Aa and phone "+" menus are pressed, and which never are. The row id is written on the row where it is defined (`row:` on a MenuRows item, `data-row` on a hand-written row); `lib/notebookUsage.test.js` fails by file and label on a row without one and holds the enum equal to the ids the rows carry. |
| `today_door_used` (`door`, `created`) | Which door today's note is opened or started from (list button, Ctrl+Alt+D, phone row, the brief's Start or Open, the recap), and how often a door makes the note. `journal_panel` is the Journal Today page's "Open today's note" (`surfaces/today/panels/TodayNotePanel.jsx`, wired in fix round 1). |
| `template_started` (`source`, `family`) | Catalogue, note type, own or library template, and which catalogue family or built-in note type. A member's own or library template is `custom`. |
| `block_inserted` (`kind`, `via`) | Which registry widgets and blocks are inserted from the slash menu, the palette, or the palette opened from the phone "+", once per press. A member-built widget is `custom`. Fix round 1: an insert that lands after the press (a widget fetched first, the `/routine` and `/track` pickers, a routine made from the picker or the examples, the widget builder's Save) carries the door it was opened from, and the door covers only the synchronous insert it wraps, so a body reload or a paste is never claimed. **Not measured (do not read their absence as "unused"):** plain slash blocks that are not registry kinds (headings, lists, quote, code block, divider, table, columns, table of contents, checklist, callout, toggle, math, emoji, image), financial facts (`/price` and the like), anything pasted, anything a template or a capture puts in, and widgets inserted by doors other than the slash menu and the palette. |
| `panel_row_used` (`row`) | Which left-panel rows are pressed (All notes, Daily brief, favorites, recents, a folder, a tag, the shelves, My Playbook, the Search tab); a folder or tag is only "folder" or "tag". |
| `notebook_route_opened` (`route`) | How often the Setups board, My Playbook (in the Notebook) and the ticker research page render. |

`block_used` stays as it was: it counts the 13 trader blocks whenever the widget insert command places one, whichever caller ran it, and nothing else. `block_inserted` is the wider one: every registry kind, but only from a member's press in one of the three insert doors, once per press, from the editor's own transaction (the widget node's plugin), so a multi-chart insert counts once.

## Follow-up D (2026-11-13): a note that is saved is not left marked "not finished saving", base `8a5550bd89`

The defect, older than this pass: a save that reached the server but whose answer the page never saw (it navigated, the tab closed) left the device's copy of the note marked unsent. The outbox drain then found the server holding exactly those words and removed only the queued entry, and opening the note wrote nothing, so Move to Trash, bulk trash, tag rename, sample removal, send to journal, AI actions and review drafts kept refusing with "has changes that have not finished saving", which was false, and "Open it so it can finish saving" did nothing.

- F1, the drain (`lib/offline/outboxDrain.js`): both "server already identical" branches go through one helper, `settleIfServerHolds`, in one IndexedDB transaction. A dirty record holding exactly the server's words, with every queued entry for the note holding them too, is written clean at the revision just read and its entries go; otherwise only the proven entry is removed, and only while it still holds those words (an entry rewritten by a newer capture during the server check is now kept, where it used to be deleted by id). The landed-revision ring is not touched; no request is added.
- F2, on open: when recovery finds a dirty record no local copy differs from, the editor settles it through the same helper before it shows its decision (`useDurableNote` `settleProvenEqual`, `NoteEditorPage` `decide()`).
- F3, the label: the save indicator says nothing until the device's recovery decision for the note is made; online, if the store held this note's unsent work on open, it reads "Saved in this browser · waiting to sync" (the queue's existing words) instead of "Saved", until this page commits a write of its own or the record is settled.
- F4: `pagehide` and a tab becoming hidden flush the pending durable write (the writer's own `flush()`); best effort, nothing else changed.
- Separately: `lib/offline/noteCopy.test.js` read a size sentence that master's `2cd5ccbd0a` had moved into `TOO_LONG_BODY_DETAIL`; the rail now reads the constant.

Rails: `lib/offline/provenEqualSettles.test.js`, `lib/offline/provenEqualOnOpen.test.jsx`; `ringVouchAuthority.test.js` names the new remove-only call. First open 2,250,747 B to 2,251,962 B (+1,215 B). Real-browser steps and the full record: `.superpowers/followups/D-report.md` (local).

### Follow-up D, fix round 1 (2026-11-13), base `bb2b2f3261`

- The settle on open uses only a copy of the note that this opening saw arrive from the network. A note reopened inside the app is served from the app's cache, and that copy can be older than the words on the device, so it proves nothing: such a reopen leaves the mark for the drain, as before this branch, and the label reads "Saved in this browser · waiting to sync" until the drain settles it. The shared helper also refuses a proof whose revision is older than the base the device's words were written on (drain and open alike). The drain's proof read is `cache: 'no-store'`.
- Discard on the recovery banner now discards. Before, it went through the ordinary durable write, whose guard against dropping unsent words kept the offered words dirty and queued, and after the note closed the drain wrote the discarded words into the note. Now one content-checked transaction replaces the device's copy with the server copy and removes the note's queued entries, only while the record and every queued entry hold exactly the offered words (or words the offered copy contains); anything else (words written since the offer, an entry that differs) is refused and the old path runs. Words typed while the banner was up are captured again once the record is clean (fix round 2: the crash draft at once, the durable copy without the debounce). Residual, ruled not fixed in this release: a durable write or a save-settle already in flight for the note when Discard is pressed (roughly the two seconds after the last keystroke) can put the offered words back; the outcome is then what it was before this fix (the words are sent after close, or arrive as a conflicted copy). Closing it means the two writers re-deciding inside one transaction, which touches fix 6's writer and is left for its own change.
- Second recorded residual (final fix pass, 2026-11-13): when the crash draft is a deletion or a mid-text edit ahead of the device record (the tab died within the 200 ms before the record caught up), Discard's content check refuses, the banner closes, and the record's words are sent when the note closes, as before this release. Closing it means carrying the edit lineage on the crash draft; left for its own change.
- Third recorded residual (final fix pass, 2026-11-13): a note reopened from the cached read keeps a dirty record that equals the server until the next full load or the list's drain; the header reads 'waiting to sync' meanwhile. Item 1 of the final fix pass removes the common way into this state.
- Fourth recorded residual (final fix pass, round 2): if a member reopens a note in the instant the list's drain is still sending it, the cached read is not dropped (an open editor's data is never cleared), so that reopen can still show the older copy and fork on the next save, as before this release. No words are lost.
- The label shows "Saving…" whatever the device has answered; only "Saved" and "waiting to sync" wait for the device's answer (or a save that landed on this page). "Waiting to sync" is cleared when the settle finds the note already clean.
- `f5Freeze.test.js` records the amendment and pins the drain's two `supersedeIdentical(` calls; `ringVouchAuthority.test.js` reads both helpers' bodies for a plan function or a ring write.

## Follow-up B (2026-11-13): the two day pages one press apart, and the recorded leftovers, base `09f6ebd951`

The Journal's Today tab (the account day) and the Notebook's Daily brief (the notes day) stay two pages; they now link to each other. Each line ends with its one-line undo.

- 1a. Journal Today's Quick actions gains "Daily brief" after "Open Notebook" (`surfaces/today/TodayQuickActions.jsx`, address in `lib/dailyBriefLink.js`). Undo: delete the button.
- 1b. The command palette gains "Daily brief" (`nb-daily-brief`, six typed characters like its neighbours). Undo: delete the entry.
- 1c. The setups board's way back reads "Back to Daily brief" and returns there when the member came from the brief's "Open the setups board" (router state `{from: 'daily-brief'}`, carried through the "Find more like this" sheet's address rewrites); otherwise "Back to Notebook" as before. Undo: drop the link's `state` in `TodayHome.jsx`.
- 1d. On a phone, choosing "Daily brief" in the folders drawer folds it (the fold effect is keyed on the address being the brief; the in-note sheet wraps the row in `closeSheetThen` like its neighbours). Undo: drop `viewParam === TODAY_VIEW` from the fold effect's keys.
- 2a. Walkthrough tiers read the CSS's own query (desktop `MQ.desktop`, touch the rest; phone `MQ.phone`, wide the rest), so a fractional width under zoom agrees with what is drawn; a screen that answers no query at all (a test environment) still gets the desktop tour. Undo: `STEP_TIERS` desktop/touch back on `MQ.tabletDown`.
- 2b. Back from a step that an earlier step waited for (the first review inside Draft a review) goes to that step, menu left open, instead of skipping to the step that opened the menu (`GenericTourEngine.jsx` `backFrom`). Undo: `goBack` back on `presentFrom`.
- 2c. A walkthrough asked for while the first run is UNDECIDED (preferences still loading) waits without a limit; the 10 s release applies only while the first run is due or showing (`lib/firstRun.js` publishes 'due' or 'undecided'). Undo: key the timer on `held` again.
- 3a. No change: Tab in the note's More > Export view already does what Tab does in the panel's first view (stays inside and wraps, wave 10 K2); now pinned by the kit (`tab: 'stays'`). Undo: none needed.
- 3b. The second-view test kit also checks Home, End, arrow wrap and Tab, and runs over Aa > Size. Undo: revert `lib/testing/menuSecondView.testkit.js`.
- 3c. The property formula editor is a held module like the rollup editor (one shared slot factory), warmed when the panel is idle with formulas on; Create and an edit's Save wait for it to be drawn. Undo: back to `lazyChunk` + Suspense in `PropertiesSection.jsx`.
- 4a. The daily folder: the most recent live daily note decides only when it sits in a root folder with a daily name; nested or Unfiled falls straight to the name order. Undo: restore the root-only join in `note_daily.py`.
- 4b. A failure of the "does today's note exist?" read no longer blocks opening or making today's note (no seed, `open_daily_note` decides). Undo: remove the try around `daily_note_exists`.
- 4c. Imports and connectors (Roam's "Daily Notes") reuse a ROOT folder of the same name in any casing (exact case preferred); nested folders unchanged (`notes.find_folder_segment`). Undo: exact match at the root again.
- 4d. The sample ledger lists `notebook_today.py` (guarded) and `note_daily.py` (exempt, with the reason), and pins that the sample never writes a `daily_date`. `tweet_capture*.py` (another workstream) still red there. Undo: remove the two entries.
- 5a. The server says "note type" where it said "kind of note" / "No kind" / "Note kind" to members (refusals, the notes widget's label and empty bucket); fixtures regenerated. Undo: revert the six strings.
- 5b. The Compass weekly email's "Open Compass" opens `/journal/compass`, not the Today tab. Undo: `COMPASS_PATH` back to `/journal`.
- 6a. A `?view=` link is counted once per router entry (`location.key`), not again on a remount. Undo: drop the key argument.
- 6b. Regression rail for the Daily brief's Restore accepting a retried library fetch (`TodayHome.restoreRetry.test.jsx`; the loader is a swappable property). Undo: delete the test.

First open 2,252,797 B to 2,253,325 B (+528 B). Full record: `.superpowers/followups/B-report.md` (local).

### Follow-up B, fix round 1 (2026-11-13), base `04fdfe0e7a`

- 2b, redone: the generic `backFrom` engine change is reverted; a step may carry `noBack: true` (its card draws no Back; the registry rail accepts the key, only as `true`). The Reviews walkthrough's first review card (inside Draft a review's second view, both tiers) has it. Undo: drop `noBack` from `reviewDrafts.steps.js`.
- 2c, a known consequence: a walkthrough asked for while the first run is undecided waits without a limit and without a notice; that includes a member whose notes read failed and whose first run was never recorded (a Notebook that cannot read its notes cannot run a walkthrough either). Undo: as 2c.
- 4c, two known consequences: an import whose ROOT folders differ only by case ("Daily notes" and "Daily Notes") now folds them into one at creation; and a remote folder renamed only by case no longer moves its notes (the root lookup already matches the old one). Undo: as 4c.
- The Daily brief's Recap card accepts a retried fetch of its library (`recapDraftsLoader`, its own acceptor), and Restore and Recap say "This action could not be loaded. Reload the page to get this back." with a Reload the member presses when their code cannot be fetched, never the browser's error text; a refused request still shows the server's own sentence. Undo: revert `ActionError` in `TodayHome.jsx`.
- Every member-facing sentence in `note_kinds.py` (name length, duplicate, limit, built-in change and delete, in use) and two gallery sentences (`EXAMPLE_KIND_SENTENCE`, the share report's note type line) say "note type"; contract fixtures regenerated. Undo: revert the strings.
- The Insert palette (`EditorToolSlots.jsx` `WidgetPaletteSlot`) and "Or tell Notebook what to change" (`NotebookAiPanel.jsx` `AiActionsSlot`) are held modules: warmed on idle and from their doors, drawn in the press's own commit, a focused frame on a cold press (nothing typed reaches the note), a failure sentence with a member-pressed Reload. Undo: back to `lazyChunk` + Suspense in each file.
- Minors: `FIRST_RUN_PENDING` is two string constants (`FIRST_RUN_DUE`, `FIRST_RUN_UNDECIDED`); `builderCatalog.js` no longer relabels "Note kind" (dead since 5a); a NotebookTab comment quotes "Choose a note type.".

## Follow-up C (2026-11-13): one room for templates, base `0c2ff723ce`

"Manage templates" is the one place a member manages every template they own. No server change, no schema change, no data migration, nothing deleted that was not deletable before.

- Moved in: Archived and Recently deleted (Restore, Delete permanently with the name typed, "Kept until") are views of the manager (a tablist: Active, Archived, Recently deleted, while wave 11 is on), drawn by the same list My tools drew (`myTools/TemplateList.jsx`, one implementation).
- Moved in: a member's own template row in Active gains Archive (with the hint that its notes keep it) and "Used in N notes" with its list. Delete's Undo line now names the template and says "Moved to Recently deleted."
- Moved in: the "Save as template" copies, as a "Plain templates" group below the per-note-type lists (Use, Preview, Rename, Delete, Share), with the "Daily notes start from" control at its top (same preference, plain templates only). Their rows and handlers stay in `MemberTemplates.jsx`, shared with the picker.
- The New note sheet's "Your templates" keeps Use and Preview; Rename, Delete, Share and the daily control became "Manage" and "Daily notes start from: {name}. Change", which open the manager at that group or control.
- My tools > Templates is one sentence and an "Open Manage templates" button (the tab stays in the row). `?styles=1&show=archived|deleted|plain` opens the manager at a view or group; any other `show` opens Active.
- Undo: My tools > Templates lists templates again; the picker manages plain templates again (revert the follow-up C commits).

First open 2,254,673 B to 2,254,602 B (-71 B). Full record: `.superpowers/followups/C-report.md` (local).

## Follow-up E (2026-11-13/14): the acceptance instruments, the full walk and its record, base `651d8897fe`

No product change: the full walk found no row a member would hit.

- Walkers re-pointed at the doors the follow-ups moved (`1f0e91c9ef`): the setups board reached from the brief is "Back to Daily brief" and returns to the brief; "Daily notes start from" is reached through the New note sheet's Change link (fin walk) or More > Manage templates (wave 8 W9); the wave 6/7 tag-rename notice is waited for (its bulk library loads on demand); the tours walker records a step's `noBack` and checks its card draws no Back; door row 41's way back names "Back to Daily brief".
- New c2 step `followups` (`b846ca27ef`, `tools/notebook_fin_walk_followups.py`): 30 rows over the template room, the day-page doors, the held modules with their chunks held back, a cold bulk trash, the save label and the usage events (with a check that no telemetry body carries a note title), plus a coverage row; rail `tests/test_notebook_fin_walk_followups.py`.
- Full c2 run at `b846ca27ef` (product `651d8897fe`): 369 steps, 346 PASS, 5 FAIL, 11 INFO, 7 NOT RUN. The five: `smart.screenshot-tag` x3 (no OCR in c2, configuration) and two INSTRUMENT rows re-pointed and re-walked green (`31c40d1a6c`): the gallery's Share now lives in Manage templates; the Daily brief's quiet line is correctly absent after 16:05 ET, when the recap card is drawn. Record `docs/notebook/fin-walk.md` section 11.
- Door audit at `dc52cfd130`: EASY 7, OK 13, HARD 12, HIDDEN 0, exit 0. Two rows added for doors follow-up C moved.
- Ruling recorded (follow-up C's one-room design, measured here): the "Daily notes start from" control is HARD (3 clicks and a scroll inside Manage templates, where the Plain templates group sits below the note-type lists; it was 3 clicks in the New note sheet, not measured then). The sheet's "Daily notes start from: <name>. Change" link opens the manager at it for a member who has a plain template, the only case it does anything. Costs a member who wants to set it from the manager a scroll; owner call: accept, or move the group above the note-type lists.
- Ruling recorded: My tools > Templates' "Open Manage templates" is HARD (4 clicks), a forwarding door; the list it drew is now Manage templates' Archived and Recently deleted views, 3 clicks (EASIER than the old tab's 4 to a row). Costs nothing a member had.
- Row 46 (the Notices box on the Daily brief) read OK at 390 (was HARD); it may differ by hour, since the brief draws different cards through the day.
- Undo: revert the follow-up E commits (walkers, the step, the rail, the door rows and the records); nothing in the product changes.
