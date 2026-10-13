# Gate 6 (tree 3eb941f283): classification of the four NEW rows

Manifest: `2026-10-13T13-04-07.md` / `.json`. VERDICT=NEW_FAILURES, new=4, test_files=3386, tests_failed=8,
reconciles=true. The box was loaded during this gate: two P2b agents ran named-file vitest with one worker,
and the integrator ran a C4 vitest (two workers) and lane re-runs.

No row is banked in `gate-baseline.json`. None is P2a's: `git diff --name-only origin/master...HEAD` names
none of the three test files below, and nothing under `app/src/components/chart/` or `ChartPlanPanel*`.

| Row | Failure in the gate | Alone on the gate tree `3eb941f283` | Alone on bare master `8f2b324a65` | Verdict |
|---|---|---|---|---|
| `flipCGeometry.test.jsx` > "production never calls the test override ..." | 15 s timeout | 31/31 passed, exit 0 | not needed | load timeout |
| `flipCGeometry.test.jsx` > "the four files do not exist ..." | 15 s timeout | (same run) | not needed | load timeout |
| `vendorHarness.coverageAudit.test.js` > delta-rsi ... RDDT MATCHES | `INCONCLUSIVE` vs `MATCH` | 185 passed, 7 skipped, exit 0 | 185 passed, 7 skipped, exit 0 | intermittent under load, not P2a |
| `ChartPlanPanel.asOfDay.test.jsx` > "opened at 20:30 Eastern: the stop hit ..." | `Unable to find ... 1 bar after the note · stop hit` | 26/26 passed, exit 0 | **1 failed, 25 passed**, same message | **master-owned, intermittent** |

`ChartPlanPanel.asOfDay` joins `StockChart.smoke` (gate 5, F-SMOKE-ORDER) as a master intermittent this
landing met. Filed as F-ASOF-INTERMITTENT for its owner.

## Carry-over

From this gate to the landing tree `1a78a9fd8c` (master `e051fa9721`): CARRIES, C1-C3 ok
(`carry-over-to-e051fa9721.txt`). C4 on `1a78a9fd8c`: vitest 63 files passed, 1 skipped (agentSmokeCapture,
opt-in real-model smoke), 962 tests; pytest 1001 passed, 2 skipped.
