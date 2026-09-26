# W6 on the landing tree 787a993f5 -- an instrument race exposing a real (pre-existing) focus defect

Raw evidence in this directory was captured before this note was written.

1. `walk-run1-W6-inconclusive.log`, `walk-run2-W6-inconclusive.log`: two full walks on 787a993f5,
   W6 INCONCLUSIVE both times ("Timeout 30000ms exceeded while waiting for event response" -- the
   POST /api/j2/saved-views never went out). W6 PASSED on 856369244 with byte-identical app code and
   walk script. The sandbox API listed no saved view from any of these runs: the save never fired.
2. `fresh-page-probe.json`: the same steps in a fresh page -- the POST fires on Enter and answers 200.
3. `instrumented-walk-W6-state.json`: an instrumented copy of the walk, at the moment Enter was
   pressed: document.activeElement = the dialog PANEL div (`_panel_modal_...`), not #save-view-name.
4. Cause: `app/src/components/mobile/Sheet.jsx:145` focuses the panel in a requestAnimationFrame after
   open, taking focus back from SavedViewEditor's `autoFocus`. Playwright's fill() re-focuses the
   field; on a quiet box the frame fires first (PASS), on a loaded box after fill() (Enter -> panel).
5. `person-paced-focus-probe.py` + `.output.json`: at a person's pace focus is on the panel at 0, 50,
   150 and 600 ms and typed text lands nowhere. Sheet.jsx and SavedViewEditor.jsx are byte-identical
   to origin/master 8ecf428bc -- the defect is LIVE in production and NOT introduced by this branch;
   10 components render a Sheet with an autoFocus child. Routed to wave 8 lane 8A (focus).
6. The walk now clicks the field before typing (what a member must do on the current build) and records
   `focus_on_open_150ms`, so the defect stays in the evidence: `../walk-787a993f5.json`, 17 PASS,
   1 INCONCLUSIVE (reminders, by design), focus_on_open_150ms = {DIV, isField: false}.
