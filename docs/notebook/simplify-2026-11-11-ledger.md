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
