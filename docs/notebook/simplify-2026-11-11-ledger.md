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
