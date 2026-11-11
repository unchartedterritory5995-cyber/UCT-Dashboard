# PR #1016: execution packets — chart settings, Multi Chart, cited-test re-run

Branch `agent/pl/exec-chart-settings`, off origin/master `dfc645ccb3`. PR #1016 now carries three constituents, merged with `--no-ff`. **Test code and docs only. No product code changes.**

**One failing constituent holds the whole PR.** If any of the 12 files below goes red, or a constituent's AUDIT condition fails, nothing in this PR merges until it is fixed or that constituent is taken out and the status doc recounted.

## Constituents

### 1. Chart display settings (head `2c218074ac`)

- Files: `app/src/agent/qa/chartsOutcome/chartSettings.outcome.test.jsx` (new), `docs/agent/program/EXEC-CHART-SETTINGS.md` (new), this file, the status doc.
- Totals: **40 passed + 5 known-gap (pinned) + 7 todo (vitest raw: `Tests 45 passed | 7 todo (52)`)**, Test Files 1 passed (1). vitest counts an `it.fails` as passed, so the raw count includes the 5 known-gap cases. The 40 are 33 outcome cases, 2 routing cases that hold (grid, label) and 5 KNOWN GAP pins.
- VERIFIED (29): C1-015, C1-016, C1-017, C1-018, C1-024, C1-050, C1-051, C1-052, C1-053, C1-054, C1-056, C1-057, C1-059, C1-062, C1-063, C1-064, C1-068, C1-069, C1-070, C1-071, C1-072, C1-073, C1-075, C1-076, C1-080, C1-087, C1-090, C1-091, C2-013.
- PARTIAL (SIMULATED) (3): C1-055 (text size covered; colour refused as inert), C1-061 (centred end state covered; the product's Reset write `watermarkPos: null` not), C1-144 (calculator inputs covered; placing the drawing not).
- Gap rows, unchanged, `it.todo` (7): C1-058, C1-067, C1-077, C1-078, C1-081, C1-092, C1-127. Gap list: `docs/agent/program/EXEC-CHART-SETTINGS.md` ("Gap list (for pl-exec)").

### 2. Multi Chart (head `d9e4068388`)

- Files: `app/src/agent/qa/chartsOutcome/multiChart.outcome.test.jsx` (new), `docs/agent/program/EXEC-MULTICHART.md` (new), `docs/agent/program/PR-exec-multichart.md` (now a pointer to this file), the status doc.
- Totals: **Tests 8 passed | 17 todo (25)**, Test Files 1 passed (1).
- VERIFIED (3): C3-056 (cell timeframe), C3-057 (cell chart style), C3-062 (alert from a cell, VERIFIED with a note: the NAMED cell's symbol at the asked level and direction, exactly one alert, byte-identical Undo, a CONTROL case and a negative control (the controls prove the request context and the outcome check; the cell-to-symbol choice is made by the scripted model); the cell's right-click "Set alert @ price" entry point is not exercised and the alert book is a stateful stub). All three were BLOCKED.
- PARTIAL (SIMULATED) (1): C3-058 (cell session; intraday persisted fork covered; the D/W/M view is cell-local by design and read only as a canvas prop). Was BLOCKED. The packet had counted PARTIAL inside IMPL / UNVERIFIED; it is in the PARTIAL column now.
- Gap rows, unchanged, `it.todo` (17): C3-042 to C3-055 and C3-059 to C3-061 (C3-054 is an owner decision). Gap list: `docs/agent/program/EXEC-MULTICHART.md` ("Gap list for pl-exec"). Stale note corrected: the Agent no longer refuses every Multi Chart request (STALE since `cf981857a0`).

### 3. Cited-test re-run (head `0ef40c0b13`)

- Files: `docs/agent/program/EXEC-CITED-RERUN.md` (new), the status doc. No test file changed; it re-ran 10 existing files.
- Totals: see the per-file table below (all 10 files pass).
- VERIFIED (35): C1-011, C1-019, C2-092, C3-002, C3-003, C3-006, C3-016, C3-017, C3-019, C3-030, C3-107, C3-110, C3-120, C3-121, C3-138, C3-148, C3-150, C3-152, C3-156, C3-158, C3-163, C3-169, C3-170, C3-171, C3-174, C3-177, C3-183, C3-184, C3-187, C3-188, C3-192, C3-202, C3-216, C3-217, C3-219.
- PARTIAL (SIMULATED) (5): C1-022 (percent only, no log), C3-139 (watchlist filter only, no category or linked symbol), C3-172 (open a theme, not pick a holding), C3-193 (Y and size axes, no X), C3-201 (open a note by name, not the note search).
- GAP: none. Per-row reasons: `docs/agent/program/EXEC-CITED-RERUN.md`.

## Combined counts

Recounted by script from the "All actions" table after the union of the three packets' row changes; never summed by hand. No row was changed by two packets (checked before writing).

| | VERIFIED | PARTIAL | IMPL / UNVERIFIED | MISSING | BLOCKED | UNMAPPED | In scope | Excluded |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-11-05 (origin/master `dfc645ccb3`) | 158 | 0 | 112 | 154 | 47 | 13 | 484 | 19 |
| + chart settings | +29 | +3 | −30 | −1 | 0 | −1 | 484 | 19 |
| + Multi Chart | +3 | +1 | 0 | 0 | −4 | 0 | 484 | 19 |
| + cited re-run | +35 | +5 | −13 | −27 | 0 | 0 | 484 | 19 |
| **PR #1016, combined** | **225** | **9** | **69** | **126** | **43** | **12** | **484** | **19** |

**225 of 484 actions, 46.5%, are VERIFIED** (SIMULATED, scripted model, jsdom). PARTIAL is in scope but never VERIFIED. Runtime-only IMPLEMENTED / UNVERIFIED rows: 43 → 29.

## Re-run of all 12 files on the combined branch

Each file once, single-file vitest, through the shared suite lock (`--who pl-auto`) at below-normal priority, from `C:/w/pl-auto-cs` (`app/node_modules` is a junction to an existing install):

```
BN_CWD='C:\w\pl-auto-cs\app' timeout 1200 python C:/w/pl-auto/tools/agent_suite_lock.py run --who pl-auto -- powershell -NoProfile -ExecutionPolicy Bypass -File "<scratchpad>\pl-auto\bn.ps1" node node_modules/vitest/vitest.mjs run src/<file> --reporter=default --reporter=json --outputFile=<scratch json>
```

| File (app/src/) | Test Files | Tests |
|---|---|---|
| `agent/qa/chartsOutcome/chartSettings.outcome.test.jsx` | Test Files 1 passed (1) | 40 passed + 5 known-gap (pinned) + 7 todo (vitest raw: `Tests 45 passed \| 7 todo (52)`) |
| `agent/qa/chartsOutcome/multiChart.outcome.test.jsx` | Test Files 1 passed (1) | Tests 8 passed \| 17 todo (25) |
| `agent/agentContracts.test.js` | Test Files 1 passed (1) | Tests 14 passed (14) |
| `agent/agentExecReach.test.jsx` | Test Files 1 passed (1) | Tests 23 passed (23) |
| `agent/agentExecRound5.test.jsx` | Test Files 1 passed (1) | Tests 18 passed (18) |
| `agent/agentIndicatorAlertTruth.test.jsx` | Test Files 1 passed (1) | Tests 57 passed (57) |
| `agent/qa/chartsOutcome/boardArrangement.outcome.test.jsx` | Test Files 1 passed (1) | Tests 13 passed (13) |
| `agent/qa/chartsOutcome/etfHoldings.outcome.test.jsx` | Test Files 1 passed (1) | Tests 6 passed (6) |
| `agent/qa/chartsOutcome/teNewsWatchlist.outcome.test.jsx` | Test Files 1 passed (1) | Tests 9 passed (9) |
| `agent/qa/chartsOutcome/themeTracker.outcome.test.jsx` | Test Files 1 passed (1) | Tests 19 passed (19) |
| `agent/qa/chartsOutcome/widgetControls.outcome.test.jsx` | Test Files 1 passed (1) | Tests 7 passed (7) |
| `agent/qa/chartsOutcome/widgetDoorRows.outcome.test.jsx` | Test Files 1 passed (1) | Tests 19 passed (19) |

All 12 files passed, with no failures and no skips.

## Gap lists

- Chart settings: `docs/agent/program/EXEC-CHART-SETTINGS.md`, "Gap list (for pl-exec)" (C1-058, 067, 077, 078, 081, 092, 127, and the optional C1-061 Reset write).
- Multi Chart: `docs/agent/program/EXEC-MULTICHART.md`, "Gap list for pl-exec" (read-only `gridBoard`, no `multiChart.set`, no layout kind filter, cell reset, grid settings opener; C3-054 owner decision).
- Cited re-run: no GAP rows; the PARTIAL rows' uncovered halves are in `docs/agent/program/EXEC-CITED-RERUN.md`.

## Held-out-only rows, for pl-exec (12)

Named only by held-out phrasing lists, which execute nothing. They stay NOT VERIFIED; each needs an execution test (an outcome test through the real panel that reads the end state back):

C1-065 (Legend bar-info fields, MISSING), C1-066 (Info-row fields, MISSING), C3-125 (Volume Surge logos, IMPLEMENTED / UNVERIFIED), C3-133 (News catalyst filter, IMPLEMENTED / UNVERIFIED), C3-151 (Calendar stars filter, IMPLEMENTED / UNVERIFIED), C3-159 (Breadth heatmap/ratio, MISSING), C3-164 (Options Flow scope, IMPLEMENTED / UNVERIFIED), C3-165 (Options Flow lead view, IMPLEMENTED / UNVERIFIED), C3-166 (Options Flow filters, MISSING), C3-194 (Market Map linked list, MISSING), C3-195 (Market Map labels/zoom, MISSING), C3-206 (Period Sort grouping/replay/start mark, MISSING).

## Known-gap pins and their flip owner

`chartSettings.outcome.test.jsx` has 5 `it.fails` routing cases, chart nouns read as tickers by `parsePriceSentence` (`agent/capabilities/marketDataPhrases.js`): axis, scale, crosshair, legend, watermark. Each is pinned by a sibling `KNOWN GAP ROUTE-NOUN <noun>` case that asserts today's exact wrong output (`{"intent":"quote","candidates":[{"text":"<noun>","form":"lower"}],"sessionWord":null}`). The pin goes red if the parser is fixed or if the wrong behaviour changes shape.

**Flip owner: pl-exec, in its NOT_A_TICKER fix PR.** In the same commit as the product fix (likely adding the chart nouns to `NOT_A_TICKER`, `marketDataPhrases.js:31`), each `it.fails` and its KNOWN GAP pin become one plain passing `it` (`parsePriceSentence(text) === null`). That is a product change and is not made here. The routing nouns are test cases, not status-doc rows, and none is counted as VERIFIED.

## Caveats

- **The model is scripted** in every constituent. The tests prove the request carries what is needed and that a correct plan reaches the right state (with Undo); they do not prove a paid model picks that plan.
- **jsdom, not a real browser.** StockChart is stubbed or does not paint; read-back is from stored settings, grid state, widget DOM, or fixture servers with invented values. Nothing ran in production or against a real backend.
- C1-080 seeds `themeAll` with `mergeChartSettings(null)`, not the member's prefs. C3-062's alert book is a stateful stub in the test file. C3-216 and C3-217 read the stored `opts.dock`, not the rendered dock.
- **No generator for the status doc.** It was rebuilt by script from `dfc645ccb3` plus the union of row changes and recounted; the recount reproduces "Counts by area" exactly, and line endings are kept. The P0 count (58 of 74) was not recounted: the doc has no per-row P0 tag.
- Nothing was pushed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
