# Gate 4 (tree efd110b538): classification of the one NEW row

Manifest: `2026-10-13T08-18-48.md` / `.json`. VERDICT=NEW_FAILURES, new=1, test_files=3384, reconciles=true.

## NEW: `src/components/StockChart.smoke.test.jsx > StockChart render smoke > reports the drawn bar count to onDrawnBarCount`

Failure in shard 2: `TypeError: timeScale.subscribeVisibleTimeRangeChange is not a function` at
`src/components/chart/PatternOverlay.jsx:72`.

Classified ORDER-DEPENDENT, not a P2a regression. NOT banked in `gate-baseline.json`.

Evidence:

1. **Alone on the same tree it passes**: `npx vitest run src/components/StockChart.smoke.test.jsx` on
   `efd110b538` (the gate worktree, after the gate released it): `Tests 9 passed (9)`, exit 0.
2. **Its import closure did not move between gate 3 and gate 4.** Closure from `tools/import_edges.mjs`
   (5,752 nodes): 452 files. `git diff --name-only 221d5c5d43 efd110b538`: 51 files, none in the closure
   (control: the diff is non-empty and contains `useAgent.js`). The same test passed in gate 3 on `221d5c5d43`.
3. **The one P2a file in its closure** is `app/src/pages/journal-2-0/hooks/useJ2SelectedAccount.js`
   (account selection). It was identical in gate 3, where the test passed, and it does not touch the
   chart mock the error names.

What a reader should do with this: if it recurs on master, it is cross-file pollution of the
`lightweight-charts` mock inside one shard; the 51 incoming files changed shard composition. Filed as
F-SMOKE-ORDER for the chart workstream.
