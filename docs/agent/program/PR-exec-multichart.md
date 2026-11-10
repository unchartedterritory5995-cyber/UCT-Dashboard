# PR: Multi Chart execution family — outcome tests + status

Branch `agent/pl/exec-multichart`, off origin/master `dfc645ccb3`. **Test code and docs only. No product code changes.**

## Scope

This PR covers the Multi Chart rows C3-042 to C3-062 in `docs/agent/CHARTS_EXECUTION_STATUS.md`. It changes four files:

- `app/src/agent/qa/chartsOutcome/multiChart.outcome.test.jsx` (new). Each case runs through the real AgentPanel in gridMode, over the real MultiChartGrid, GridChartCell and useMultiChartState (the agentMultiChartMode.test.jsx mount).
  - The scripted model reads the cell from `body.context`.
  - The outcome is read back from state.
  - The other cells must stay byte-identical, and Undo must restore.
  - A case also fails if its scripted plan was never consumed, which catches a pre-model fast path answering in its place.
  - Rows with no capability path are `it.todo` entries that name the missing piece.
- `docs/agent/program/EXEC-MULTICHART.md` (new): the method, the per-row table and the gap list.
- `docs/agent/CHARTS_EXECUTION_STATUS.md`:
  - the rows that pass are raised under AUDIT's rule;
  - the 17 other rows keep their status and point to the gap list;
  - the stale note is corrected in place;
  - the counts are recounted;
  - a dated section, "Update 2026-11-10: Multi Chart (pl-auto)", is added.
- This file.

## Per-row results

| Row | Action | Capability | Test | Status doc |
|---|---|---|---|---|
| C3-042 | Enter a preset grid | none | it.todo | BLOCKED (unchanged), gap list |
| C3-043 | Custom rows × columns | none | it.todo | MISSING (unchanged), gap list |
| C3-044 | Exit Multi Chart | none | it.todo | BLOCKED (unchanged), gap list |
| C3-045 | Toggle crosshair sync | none | it.todo | BLOCKED (unchanged), gap list |
| C3-046 | Toggle time-range sync | none | it.todo | BLOCKED (unchanged), gap list |
| C3-047 | Turn on Groups mode | none | it.todo | BLOCKED (unchanged), gap list |
| C3-048 | Pick a group | none | it.todo | BLOCKED (unchanged), gap list |
| C3-049 | Step or switch group | none | it.todo | BLOCKED (unchanged), gap list |
| C3-050 | Refresh the group | none | it.todo | BLOCKED (unchanged), gap list |
| C3-051 | Exit Groups | none | it.todo | BLOCKED (unchanged), gap list |
| C3-052 | Apply a saved grid | none | it.todo | BLOCKED (unchanged), gap list |
| C3-053 | Save a grid | layout.saveAs, wrong kind | it.todo | BLOCKED (unchanged), gap list |
| C3-054 | Save a grid as global (admin) | n/a | it.todo | BLOCKED (unchanged), owner decision |
| C3-055 | Delete a saved grid | layout.delete, wrong kind | it.todo | BLOCKED (unchanged), gap list |
| C3-056 | Set a cell's timeframe | chart.setTimeframe | PASS: scripted plan and pre-model path; `tf` read back from the cell and the saved `multichart_state` | **VERIFIED (SIMULATED outcome test, scripted model, jsdom)** |
| C3-057 | Set a cell's chart style | chart.setType | PASS: `chartType` read back from the cell, the saved state and the canvas override; Undo restores the cell's own pick | **VERIFIED (SIMULATED …)** |
| C3-058 | Toggle a cell's session | chart.setSession | PASS (2 cases): intraday persisted fork; D/W/M canvas `sessionView` | **PARTIAL (SIMULATED)**: the intraday half is persisted; the D/W/M view is cell-local by design and read only as a canvas prop |
| C3-059 | Reset a cell to my chart | none that matches | it.todo | BLOCKED (unchanged), gap list |
| C3-060 | Maximize or restore a cell | none | it.todo | BLOCKED (unchanged), gap list |
| C3-061 | Open shared grid settings | none | it.todo | BLOCKED (unchanged), gap list |
| C3-062 | Set an alert from a cell | alert.create | PASS (3 cases): exactly one alert added, on the NAMED cell's symbol at 250 above, none on another cell's symbol; CONTROL with a different cell clicked; a negative control (an active-cell plan) fails the same check; Undo → book byte-identical; grid untouched | **VERIFIED (SIMULATED …)**, with a note: cell resolution is proven by the control; the right-click "Set alert @ price" entry point is NOT exercised; the alert book is a stub |

## Gap list (for pl-exec; each needs product code)

1. **The grid object is read-only.** `gridBoard` (`MultiChartGrid.jsx:232-245`) has no writers. Writers that already exist in `useMultiChartState.js` but are not exposed:
   - `enterGrid` :133
   - `exitGrid` :140
   - `applyCustomLayout` :144
   - `fillCells` :161
   - `clearGroup` :225
   - `setSyncCrosshair` :229
   - `setSyncTimeRange` :233
   - `setGroupsMode` :237
   - `applyGridTemplate` :245
   - `restoreCells`, for Undo

   Maximize is different: it is local `useState` (`MultiChartGrid.jsx:104`, `setMaxId` :108), so it needs lifting or wiring.
2. **No `multiChart.set` capability.** It should be a data-row capability over those writers, plus an allowance in `screenGridOps` (`gridMode.js:75` refuses board, workspace and layouts writes). Rows it unlocks:
   - C3-043, 044, 045, 046, 047, 051 and 060;
   - C3-042 also needs the writer reachable from the board host (`buildWorkspaceHost`, `host.js:749`);
   - C3-048 and 049 also need the group fetch-and-fill lifted out of `MultiChartMenu.jsx:84-101`;
   - C3-050 also needs the inline refresh at `MultiChartMenu.jsx:288-312` lifted, plus a groups fixture.
3. **Layout kind filter** (C3-052, 053, 055):
   - the Agent's layout source holds workspace-kind entries only (`ChartsWorkspace.jsx:2861-2862` → `dockEntries` → `agentLayoutsRef.entries` :3376);
   - `layout.saveAs` (`capabilities/layout.js:454`) saves the workspace board, not the `{kind:'multichart', layout, cells, group}` shape at `MultiChartMenu.jsx:103-127`;
   - `layout.delete` (`capabilities/layout.js:598`) sees workspace entries only;
   - all three are refused in grid mode by `gridMode.js:75`.
4. **Cell reset** (C3-059): the product writes `settings: null` (`GridChartCell.jsx:228-231`, merged by presence at `MultiChartGrid.jsx:202-205`). `chart.resetDefaults` (`capabilities/chart.js:893`) writes CHART_DEFAULTS into a fork instead, which is a different outcome.
5. **Open shared grid settings** (C3-061): no capability opens a dialog. The opener is `mc.setSettingsOpen` (`useMultiChartState.js:61`), the same gap as C1-127.
6. **C3-054**: an owner decision (admin/global scope).

## Stale-note correction

"Only exists in Multi Chart mode, and the Agent refuses every request there (useAgent.js:1836)" has been STALE since `cf981857a0`, which is an ancestor of `dfc645ccb3`:

- `useAgent.js:637` scopes the host to the grid (`scopeHostToGrid`);
- chart, indicator and drawing operations run on cells;
- only grid-level writes are refused (`screenGridOps`, `gridMode.js:69-96`);
- `useAgent.js:1836` is now `dismiss`.

In the status doc the note is struck through and corrected in place, in the 18 "Other state changes" rows and the "Limits" bullet. It is also corrected in `EXEC-MULTICHART.md`.

## Counts (this branch, origin/master `dfc645ccb3`)

These were recounted by a script from the "All actions" table. Before editing, the script confirmed that its recount reproduced every "Counts by area" row. PARTIAL is counted in IMPL / UNVERIFIED, never in VERIFIED.

| | VERIFIED | IMPL / UNVERIFIED | MISSING | BLOCKED | UNMAPPED | In scope |
|---|---:|---:|---:|---:|---:|---:|
| Multi Chart, before | 0 | 0 | 2 | 19 | 0 | 21 |
| Multi Chart, after | 3 | 1 | 2 | 15 | 0 | 21 |
| Total, before | 158 | 112 | 154 | 47 | 13 | 484 |
| Total, after | 161 | 113 | 154 | 43 | 13 | 484 |

VERIFIED is now 161 of 484 (33.3%). **PR #1016 (chart settings) also edits these totals.** Whichever PR merges second must rebase and recount from the "All actions" table, not sum the two by hand.

## Run

This is one run of the file, under the shared suite lock, at below-normal priority:

```
cd C:/w/pl-auto-mc && BN_CWD='C:\w\pl-auto-mc\app' timeout 900 python C:/w/pl-auto/tools/agent_suite_lock.py run --who pl-auto -- powershell -NoProfile -ExecutionPolicy Bypass -File "<scratchpad>\pl-auto\bn.ps1" node node_modules/vitest/vitest.mjs run src/agent/qa/chartsOutcome/multiChart.outcome.test.jsx
```

Totals (vitest, scripted model (jsdom/panel), not a real browser): **8 passed + 17 todo** (`Tests 8 passed | 17 todo (25)`, 1 file passed).

## Caveats

- **The model is scripted.** These tests prove two things: the request carries enough to name the cell, and a correct plan reaches the right state, with Undo. They do not prove the paid model picks that plan.
- **`StockChart` is stubbed** (jsdom). "The cell draws X" means the props the real GridChartCell hands its canvas, not pixels.
- **C3-062: route and stub.**
  - Route: the product's door is the cell's right-click "Set alert @ price" (`GridChartCell.jsx:353-360`), which uses the cursor price and infers the direction. The Agent's route creates the same kind of price alert at a stated level on the cell's symbol. The outcome is the same; the door is not. The right-click entry point is NOT exercised. Cell resolution is proven at scripted-model level by a CONTROL case: the member clicked a cell holding a different symbol, and a plan alerting the active cell fails the same check.
  - Stub: the alert book is a stateful `/api/watchlist-alerts` stub (GET, POST, DELETE) in the test file. It is not the shared fixture server and not a real backend.
- **C3-058**: the D/W/M session view is not persisted by the product, hence PARTIAL.
- No row was run in a real browser. Nothing was pushed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
