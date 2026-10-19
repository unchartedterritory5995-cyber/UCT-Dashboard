# P5 landing re-gate 276c22bc24: classification of the 17 NEW rows

Raw manifest: `2026-10-19T01-18-36.{json,md}` beside this file (committed first, `fc3da4fd16`).
`VERDICT=NEW_FAILURES new=17`, 3,595 test files, totals reconcile. The tree head is `276c22bc24` at both ends.
The re-gate follows the ExamplesInUse test fix `df8a36632e` and the merge of origin/master `5a4a8a9907` as
`276c22bc24` (ruling P5-T11-R3).

Each NEW file was run ALONE on the branch (gate worktree `notebook-p5-gate` at `276c22bc24`) and on origin/master
`5a4a8a9907` (probe worktree `notebook-p5-masterprobe`, current master at the time of the run). Raw logs:
- `alone-branch-276c22bc24.log`: 13 files, 13 failed / 189 passed.
- `alone-master-5a4a8a9907.log`: 13 files, 14 failed / 188 passed.

## THIS BRANCH'S: 0

The six ExamplesInUse rows from gate 1 are gone. Every row that is red alone on the branch is also red alone on
master, with the same test names.

## MASTER'S (red alone on 5a4a8a9907, same names): 13 rows

StockChart.focusWarmStep; enumerationSites; lwcHazards H1; panelAdoption.ratchet (TERM-047);
handRolledFormatters.census; keyListenerCensus x2 (TERM-063; master also shows a third, NON-VACUITY row);
offlineNeverStoresComputed x2; terminalReachableContrast x3; themeColours.rail.

## LOAD-SENSITIVE (pass alone on the branch): 4 rows

- `src/components/chart/builder/authoring/converseClient.conversationId.test.js`
  ("holds no message or formula text ...")
- `src/pages/journal-2-0/components/WrappedDoor.contract.test.jsx` (file-level row)
- `src/pages/journal-2-0/components/notebook/blocks/PriceStampsBlock.test.jsx` (file-level row)
- `src/pages/journal-2-0/lib/askInsertNodes.test.js` (file-level row)

All four are among the "4 passed" files in the branch log.

Verdict: **CLEAN for this branch.**
