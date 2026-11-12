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
