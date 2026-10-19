# P3b second landing gate 984b6329d2: classification of the 16 NEW rows

Each file run ALONE on the branch tip (gate worktree at 984b6329d2) and on the merged master base
f202ff9c48 (probe worktree `notebook-p3b-masterprobe`). Raw logs beside this file.

## THIS BRANCH'S: 0

Every row red alone on the branch is red alone on master too, and the failure sections of the two logs are
identical apart from three extra master timeouts (the census/ratchet reports name the same files and counts).

## MASTER'S (red alone on f202ff9c48, identical failure text): 13 rows

StockChart.focusWarmStep; enumerationSites; lwcHazards H1; panelAdoption.ratchet (TERM-047);
handRolledFormatters.census; keyListenerCensus x2 (TERM-063); offlineNeverStoresComputed x2 (SWRConfig census);
terminalReachableContrast x3; themeColours.rail.

## LOAD-SENSITIVE (pass alone on the branch): 3 rows

objectLaneCallSites.measure, objectLaneDrawerCensus.measure, ScanObjectCard (opens in the builder and saves).

Verdict: CLEAN for this branch.
