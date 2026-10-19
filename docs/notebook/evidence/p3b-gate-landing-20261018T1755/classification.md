# P3b landing gate 616097eb78: classification of the 14 NEW rows

Each row run ALONE on the branch tip (gate worktree at 616097eb78) and on the merged master base
88e55ab52e (detached probe worktree `notebook-p3b-masterprobe`). Raw logs beside this file.

## THIS BRANCH'S (red alone on the branch, green or absent on master): 3, BLOCKING

1. `formControls.census.test.js` > HAND-ROLLED SWITCHES MAY NOT GROW: names
   `app/src/pages/journal-2-0/components/notebook/styles/ExamplePreviewSheet.jsx` (1 hand-rolled `role="switch"`;
   the rail says render `components/ui/Switch`). Green on master.
2. `NoteEditorPage.styleChunks.test.js` > exactly two import()s of a styles/ module in journal-2-0: the branch adds
   three: `TemplateGallery.jsx -> ./styles/AddExampleNoteDoor`, `styles/AddExampleNoteDoor.jsx -> ./AddExampleNoteDoor`,
   `styles/ShareStyleForm.jsx -> ./AddExampleNoteDoor`. Green on master.
3. `styles/ExamplePreviewSheet.test.jsx` > CHANGE_KINDS ... example_sanitize.KINDS: the regex
   `/^KINDS: tuple\[str, \.\.\.\] = \(([\s\S]*?)\)\n/m` assumes LF. The gate checkout has
   `api/services/journal_two/example_sanitize.py` with CRLF (core.autocrlf=true: 768 CR / 768 LF; the blob and the
   notebook-p3b worktree are LF), so the match is null. File absent on master. Red on any CRLF checkout.

## MASTER'S (red alone on 88e55ab52e with the same names): 7 rows

enumerationSites, lwcHazards H1, panelAdoption.ratchet (TERM-047), keyListenerCensus x2 (TERM-063; the census block
is byte-identical branch vs master, 113 vs ceiling 111), terminalReachableContrast, themeColours.rail.

## LOAD-SENSITIVE (pass alone on the branch): 4 rows

StockChart.smoke (onDrawnBarCount), vendorHarness.coverageAudit (delta-rsi RDDT), ArticlesSection.native,
ChartPlanPanel.asOfDay (spring change, 9 pm).
