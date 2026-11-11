# Charts status recount, 2026-11-11

Master `8660b43615`. Table: "All actions" in `docs/agent/CHARTS_EXECUTION_STATUS.md` (authoritative). Tests run once on this tree (app/node_modules junction to `C:\w\pl-mc-fw\app\node_modules`), jsdom, scripted model, no suite lock: 5 files, 76 passed, 0 failed, 1 todo.

## Changed rows (8)

| ID | Old | New | Test (result) |
|---|---|---|---|
| C1-025 Auto-scale | MISSING | VERIFIED † | `app/src/agent/agentChartViewNudges.test.jsx` (15/15) |
| C1-032 Step one bar | MISSING | VERIFIED † | `app/src/agent/agentChartViewNudges.test.jsx` (15/15) |
| C1-035 Compare: add a group | MISSING | IMPLEMENTED / UNVERIFIED | `app/src/agent/agentCompareGroups.test.jsx` (11/11) |
| C1-037 Compare: remove a group | MISSING | IMPLEMENTED / UNVERIFIED | `app/src/agent/agentCompareGroups.test.jsx` (11/11) |
| C1-040 Compare: group scale | MISSING | IMPLEMENTED / UNVERIFIED | `app/src/agent/agentCompareGroups.test.jsx` (11/11) |
| C1-065 Bar-info fields | MISSING | VERIFIED | `app/src/agent/agentExecFamilies.test.jsx` family L (21/21) |
| C1-066 Info-row fields | MISSING | VERIFIED | `app/src/agent/agentExecFamilies.test.jsx` family L (21/21) |
| C1-127 Open chart settings | MISSING | PARTIAL (SIMULATED) | `app/src/agent/agentOpenChartSettings.test.jsx` (25/25, 1 todo) + `app/src/pages/charts/widgets/ChartWidget.openSettings.test.jsx` (4/4) |

Why not higher:
- C1-035/037/040: the test drives `commitPlan` with parity against the real CompareSymbolsPanel; it never mounts the AgentPanel, so under "Rules used" it is runtime, no panel.
- C1-127: the `it.todo` for "not the NVDA chart" (shared qualifier negation) is open. Also, `chartSettings.outcome.test.jsx` still carries a stale `it.todo` saying no capability opens the dialog; left as is (docs-only change).
- C1-025/032: † = the chart's view is a stand-in inside the test (same as C1-027/029).
- C1-065/066: the panel cases use tuning phrasings (agentExecTune LIST_TUNE), not held-out ones.

## Checked, no change
- #1027 watchlist widget rows (showList C3-063..067, arrangeColumns C3-085, exportList C3-094/095) and #1029 Options Flow chips (C3-166): already VERIFIED on master.
- Rows covered only by open PRs (#1074, #1030, #1076, #1070, #1082, #1059, #1023, #1071) were not touched.

## Totals (in scope 484, excluded 19)
| | VERIFIED | PARTIAL | IMPL / UNVERIFIED | MISSING | BLOCKED | UNMAPPED |
|---|---:|---:|---:|---:|---:|---:|
| Before | 243 | 11 | 68 | 107 | 43 | 12 |
| After | 247 | 12 | 71 | 99 | 43 | 12 |
