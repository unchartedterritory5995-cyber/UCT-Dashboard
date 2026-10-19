# P5 landing gate a368118fc3: classification of the 19 NEW rows

Raw manifest: `2026-10-19T00-04-32.{json,md}` beside this file (committed first, `685c810e80`).
`VERDICT=NEW_FAILURES new=19`, 3,594 test files, totals reconcile.

Every NEW file was run ALONE, once on the branch (gate worktree `notebook-p5-gate` at `a368118fc3`) and once on
origin/master `5a4a8a9907` (probe worktree `notebook-p5-masterprobe`, made by this session, owner file and
node_modules junction in place). Both raw logs are beside this file:
- `alone-branch-a368118fc3.log`: 10 files, 19 failed / 133 passed. Every NEW row is red alone.
- `alone-master-5a4a8a9907.log`: 10 files, 14 failed / 138 passed. `ExamplesInUse.test.jsx` passes.

## THIS BRANCH'S: 6 rows (BLOCKING)

`src/pages/journal-2-0/components/notebook/styles/ExamplesInUse.test.jsx`, all six cases:
- In use, in the style's Preview > an image src points at the gallery route
- In use, in the style's Preview > no section when the server sends no `examples` at all
- In use, in the style's Preview > no section with no examples
- In use, in the style's Preview > the section renders: one card per example ...
- P3b-F-R8: Report on an In use card > reports THAT example ...
- P3b-F-R8: Report on an In use card > the style's own author gets no Report on its examples

These are red alone on the branch and green alone on master. The failure text is the same in every case:
`TestingLibraryElementError: Found multiple elements with the role "button" and name "Preview Weekend prep"`.

Cause (read from the code, not measured by a fix): this is the P5-R-T3-3 collision.
- The regenerated gallery list fixture carries P5's 15 firm style rows.
- One of the swing pack's three firm rows shares the member style's title, "Weekend prep".
- P5 Task 3 filtered the fixture back to its pre-P5 rows (`templates.filter((t) => !t.firm)`), but only in the two
  P3a client tests (`StyleLibrary.test.jsx:26-32`).
- P3b's `ExamplesInUse.test.jsx` came in with the master merge `519a9def16` and reads the same fixture unfiltered.
- The likely fix is the same one-line filter in that test (or a firm-free fixture reader). It touches `app/`, so it
  voids this gate: the fix needs a re-gate.

The part A landing vitest run (38 files) did not include `ExamplesInUse.test.jsx`. That is why it was not seen
before the gate.

## MASTER'S: 13 rows (red alone on 5a4a8a9907, same failure text)

StockChart.focusWarmStep; enumerationSites; lwcHazards H1; panelAdoption.ratchet (TERM-047);
handRolledFormatters.census; keyListenerCensus x2 (TERM-063; master also shows a third, NON-VACUITY row);
offlineNeverStoresComputed x2; terminalReachableContrast x3; themeColours.rail.

This is the same set the P3b second gate classified as master's (`p3b-gate-landing2-20261019T0035`).

## LOAD-SENSITIVE: 0

Verdict: **NOT CLEAN.** 6 rows are this branch's. Carry-over, the packet commit and the PR are on hold.
