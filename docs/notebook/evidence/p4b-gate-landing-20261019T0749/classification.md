# P4b landing gate 0ef00ed11e: classification of the 14 NEW rows

Raw manifest: `2026-10-19T03-39-03.{json,md}` beside this file (committed first, `c2c69d2c17`).
`VERDICT=NEW_FAILURES new=14`, 3,599 test files, totals reconcile, 15 tests failed. The tree head is `0ef00ed11e`
at both ends. The gate ran in `notebook-p4b-gate` (branch `notebook-p4b-gate`) with `--shards 6 --max-workers 3`
(20,468 MB available at start; no other gate or walk was running).

Each NEW file (10 files) was run ALONE on the branch (gate worktree at `0ef00ed11e`) and on origin/master
`c03b7473dd` (probe worktree `notebook-p5-masterprobe`, clean, already at current origin/master). Raw logs:
- `alone-branch-0ef00ed11e.log`: 10 files, 13 failed / 133 passed.
- `alone-master-c03b7473dd.log`: 10 files, 13 failed / 133 passed, the same 13 names.

## THIS BRANCH'S: 0

## MASTER'S (red alone on c03b7473dd, same names): 13 rows

StockChart.focusWarmStep; enumerationSites; lwcHazards H1; panelAdoption.ratchet (TERM-047);
handRolledFormatters.census; keyListenerCensus x2 (TERM-063); offlineNeverStoresComputed x2;
terminalReachableContrast x3; themeColours.rail. These are the same 13 the P5 landing gate classified as master's
(`p5-gate-landing2-20261019T0618/classification.md`).

## LOAD-SENSITIVE (pass alone on the branch and on master): 1 row

- `src/pages/charts/widgets/ScanObjectCard.test.jsx` ("lands in the Formula field on the Conditions tab, and Save
  writes that exact tree"). Not a Notebook file; passes alone in both logs.

Verdict: **CLEAN for this branch.**
