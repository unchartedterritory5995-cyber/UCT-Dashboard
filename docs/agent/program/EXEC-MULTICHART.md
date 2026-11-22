# Execution family: Multi Chart (pl-auto, 2026-11-10)

Branch `agent/pl/exec-multichart`, off origin/master `dfc645ccb3`. Test code and docs only, no product changes.
Test file: `app/src/agent/qa/chartsOutcome/multiChart.outcome.test.jsx`.
Rows: C3-042 to C3-062 in `docs/agent/CHARTS_EXECUTION_STATUS.md`.

## Method

- The mount is the one `agentMultiChartMode.test.jsx` uses. It is not the board `outcomeHarness`, because Multi Chart is its own board. It uses:
  - the real `AgentPanel` in `gridMode` (useAgent, planner policy, runtime, receipts, Undo);
  - the real `MultiChartGrid`, `GridChartCell` and `useMultiChartState` over the `multichart_state` pref;
  - the real `buildWorkspaceHost` behind `scopeHostToGrid`.
- These are stand-ins:
  - the canvas: `StockChart` records the props each cell draws with;
  - the server, through `fetch`: prefs, ticker search, and a stateful `/api/watchlist-alerts` book (GET, POST, DELETE);
  - the model, which is scripted.
- The grid is 2×2: NVDA, AMD, TSLA, and one empty cell, in reading order.
- The scripted model reads its target from the request: the cell is found in `body.context.charts` by `position` (top-left, top-right and so on). If the plan needs a capability the request did not offer, the script asks for it through routing (`need_groups`), as a real planner has to. The case fails if the request does not carry what the plan needs.
- The case also fails if the scripted plan was not consumed. That catches a pre-model fast path answering in its place. "make the top-right chart weekly" is answered without the model, so C3-056 has two cases: one through the scripted model, and one through the pre-model path, which asserts that the model was never asked.
- Each PASS case does four things:
  1. The member sends a natural request.
  2. The scripted plan calls an existing capability.
  3. The test reads the outcome back from state: `H.mc.state.cells`, the persisted `multichart_state`, the props the cell hands its canvas, or the alert book. It never reads the outcome from the plan.
  4. The test checks the other cells are byte-identical, says "undo", and checks the state is restored.
- Each case is named with its row id.

## Correction to the ledger: Multi Chart no longer refuses everything

The C3-044 to C3-062 notes in `CHARTS_EXECUTION_STATUS.md` say: "Only exists in Multi Chart mode, and the Agent refuses every request there (useAgent.js:1836)". **That note is STALE.**

- Since `cf981857a0`, which is an ancestor of master `dfc645ccb3`, `useAgent` scopes the host to the grid: `useAgent.js:637` calls `scopeHostToGrid` when `gridMode`. Chart, indicator and drawing operations run on the grid's cells through the ordinary planner, policy, receipts and Undo.
- What is refused is narrower, in `screenGridOps` (`gridMode.js:69-96`):
  - writes to the hidden board, the workspace, and the `layouts` target (`gridMode.js:75`);
  - a cell behind a maximized one;
  - a ticker change while Groups mode is on;
  - watermark settings;
  - a display change on an empty cell.
- `useAgent.js:1836` is now `dismiss`, which has nothing to do with Multi Chart.
- Existing evidence: `agentMultiChartMode.test.jsx:146-153` ("a chart command runs (it used to be refused outright)") and `:338-387` (timeframe, ticker, settings fork, type, session and date on cells, with Undo).
- The real gate today: **the grid object the Agent sees is read-only.** `gridBoard` (`MultiChartGrid.jsx:232-245`) exposes `cells`, `shape`, `selected`, `lastChanged`, `maximized`, `syncTimeRange`, `groupsMode` and `persist`. None of them is a grid-level writer. The writers exist in `useMultiChartState.js:133-262`, but no capability reaches them.

## Per-row results

| Row | Action | State now (this run) | Capability | Result |
|---|---|---|---|---|
| C3-042 | Enter a preset grid | no Agent path | none (`mc.enterGrid`, useMultiChartState.js:133) | GAP |
| C3-043 | Apply a custom rows × columns grid | no Agent path | none (`mc.applyCustomLayout` :144) | GAP |
| C3-044 | Exit Multi Chart | no Agent path; board/workspace writes refused in grid (gridMode.js:75) | none (`mc.exitGrid` :140) | GAP |
| C3-045 | Toggle crosshair sync | no Agent path | none (`mc.setSyncCrosshair` :229) | GAP |
| C3-046 | Toggle time-range sync | readable only (`gridBoard.syncTimeRange`) | none (`mc.setSyncTimeRange` :233) | GAP |
| C3-047 | Turn on Groups mode | readable only (`gridBoard.groupsMode`) | none (`mc.setGroupsMode(true)` :237) | GAP |
| C3-048 | Pick a group for the grid | no Agent path; fetch-and-fill is in MultiChartMenu.jsx | none (`mc.fillCells` :161) | GAP |
| C3-049 | Step or switch group | no Agent path; `stepGroup` is component code (MultiChartMenu.jsx:84-101) | none | GAP |
| C3-050 | Refresh the group | no Agent path; handler inline (MultiChartMenu.jsx:288-312) | none | GAP |
| C3-051 | Exit Groups | no Agent path | none (`mc.setGroupsMode(false)` :237 / `mc.clearGroup` :225) | GAP |
| C3-052 | Apply a saved grid | multichart layouts hidden from the Agent (ChartsWorkspace.jsx:2861-2862 → dockEntries → agentLayoutsRef :3376) | none (`mc.applyGridTemplate` :245) | GAP |
| C3-053 | Save a grid | `layout.saveAs` saves the workspace board; layouts writes refused in grid (gridMode.js:75) | layout.saveAs (capabilities/layout.js:454), wrong kind | GAP |
| C3-054 | Save a grid as global (admin) | admin scope | — | BLOCKED-owner |
| C3-055 | Delete a saved grid | `layout.delete` sees workspace-kind entries only; refused in grid (gridMode.js:75) | layout.delete (capabilities/layout.js:598), wrong kind | GAP |
| C3-056 | Set a cell's timeframe | cell `tf` W, saved pref W, canvas `tf` W; Undo → D; others byte-identical (scripted plan **and** pre-model path) | chart.setTimeframe | **PASS** |
| C3-057 | Set a cell's chart style | cell `chartType` bars, canvas `settingsOverride.chartType` bars, saved; Undo → the cell's own pick (hollow), no fork left | chart.setType | **PASS** |
| C3-058 | Toggle a cell's session | D/W/M: the cell's canvas `sessionView` extended, others regular, Undo → regular. Intraday: the cell's own `settings.extendedHoursShading` false, saved, global `chart_settings` never written, Undo drops the fork | chart.setSession | **PASS** in test; ledger **PARTIAL (SIMULATED)**: only the intraday half is a persisted outcome |
| C3-059 | Reset a cell to my chart | product writes `settings: null` (GridChartCell.jsx:228-231); `chart.resetDefaults` writes CHART_DEFAULTS into a fork instead | none that matches | GAP |
| C3-060 | Maximize or restore a cell | `maxId` is local `useState` (MultiChartGrid.jsx:104); `gridBoard.maximized()` is read-only | none | GAP |
| C3-061 | Open shared grid settings | dialog opener only (`mc.setSettingsOpen`, useMultiChartState.js:61) | none (no capability opens a dialog, like C1-127) | GAP |
| C3-062 | Set an alert from a cell | proposed; nothing written before Apply; Apply → exactly one POST; exactly one alert added: `AMD above 250`, the NAMED top-right cell's symbol read from the grid, none on another cell's symbol; CONTROL with the top-left cell (NVDA) clicked gives the same result, and a negative control (an active-cell plan) is rejected by the same check; Undo → book byte-identical (seeded); grid byte-identical; the right-click "Set alert @ price" entry point is NOT exercised | alert.create (alertLibrary target, not refused in grid) | **PASS** (see caveat) |

**PASS: 4 rows (C3-056, 057, 058, 062) in 8 cases. GAP: 16 rows. BLOCKED-owner: 1 row (C3-054).**

In `CHARTS_EXECUTION_STATUS.md`, under AUDIT's rule (VERIFIED only when the test reads back the real persisted outcome), these become: C3-056, C3-057 and C3-062 VERIFIED (SIMULATED outcome test, scripted model, jsdom), with C3-062 carrying its route/stub note; C3-058 PARTIAL (SIMULATED). See "Update 2026-11-10: Multi Chart (pl-auto)" there.

The earlier read expected 062 to stay unverified. It passes because `alert.create` targets `alertLibrary`, which is neither board- nor layouts-scoped, so `screenGridOps` lets it through.

## Gap list for pl-exec

Each gap needs product code. These tests do not change product code.

1. **Grid writers on `gridBoard`** (`MultiChartGrid.jsx:232-245`). Expose writers that call the existing `useMultiChartState.js` functions, each with a before/after read for Undo:
   - `enterGrid` :133
   - `exitGrid` :140
   - `applyCustomLayout` :144
   - `setSyncCrosshair` :229
   - `setSyncTimeRange` :233
   - `setGroupsMode` :237
   - `clearGroup` :225
   - `applyGridTemplate` :245
   - `restoreCells` (for Undo)
   - a maximize writer for `setMaxId` (MultiChartGrid.jsx:104-108). It is local state today, so it needs lifting or a ref.
2. **A data-row `multiChart.set` capability** (target: the grid) over those writers, and an allowance in `screenGridOps` (`gridMode.js:75` refuses board, workspace and layouts writes; the new target kind must not be in `BOARD_KINDS`). Rows it unlocks:
   - **C3-043, 044, 045, 046, 047, 051, 060** in grid mode;
   - **C3-042** needs the same writer reachable from the BOARD host too (`buildWorkspaceHost`, host.js:749, has no `mc` handle), because the member is not in grid mode yet;
   - **C3-048 and 049** additionally need the group fetch-and-fill (`fetchGroupTop` + `pinEtf` → `fillCells`) lifted out of `MultiChartMenu.jsx:84-101` into a shared function the capability can call.
3. **Group refresh** (C3-050): the inline handler at `MultiChartMenu.jsx:288-312` needs lifting the same way. To verify it, the test also needs a groups fixture.
4. **Layout kind filter** (C3-052, 053, 055):
   - the Agent's layout source holds `dockEntries`, which are workspace-kind only (`ChartsWorkspace.jsx:2861-2862` filters `kind === 'multichart'` out; `agentLayoutsRef.entries` :3376);
   - `layout.saveAs` (`capabilities/layout.js:454`) saves the workspace board, not `{kind:'multichart', layout, cells, group}` (the shape at `MultiChartMenu.jsx:103-127`);
   - `layout.delete` (`capabilities/layout.js:598`) only sees workspace entries;
   - all three are refused in grid mode by `gridMode.js:75`.
   
   They need a `kind:'multichart'` list, a save of that shape, a delete filter, and a grid-mode allowance for those writes. Apply goes through `mc.applyGridTemplate`.
5. **Cell reset** (C3-059): a capability, or a grid mapping in `gridAgentAdapter.js`, that writes `settings: null` on the cell. That is what "Reset to my chart" does (`GridChartCell.jsx:228-231`, merged by presence at `MultiChartGrid.jsx:202-205`). `chart.resetDefaults` (`capabilities/chart.js:893`) restores UCT defaults into a fork, which is a different outcome.
6. **Open shared grid settings** (C3-061): no capability opens a dialog. This is the same gap as C1-127, and the opener is `mc.setSettingsOpen` (`useMultiChartState.js:61`).
7. **C3-054 (admin/global save)**: an owner decision, like C3-032. Not attempted.

## Run

Run on 2026-11-10, under the shared suite lock, at below-normal priority, one file:

```
cd C:/w/pl-auto-mc && BN_CWD='C:\w\pl-auto-mc\app' timeout 900 python C:/w/pl-auto/tools/agent_suite_lock.py run --who pl-auto -- powershell -NoProfile -ExecutionPolicy Bypass -File "<scratchpad>\pl-auto\bn.ps1" node node_modules/vitest/vitest.mjs run src/agent/qa/chartsOutcome/multiChart.outcome.test.jsx
```

Totals line (**vitest, scripted model (jsdom/panel), not a real browser**):

```
Test Files  1 passed (1)
     Tests  8 passed | 17 todo (25)
```

## Caveats

- The model is scripted. These cases prove two things: the request carries enough to name the cell, and a correct plan reaches the right state, with Undo. They do not prove the paid model picks that plan.
- jsdom, with `StockChart` stubbed. "The cell draws X" means the props the real `GridChartCell` hands its canvas, not pixels.
- C3-058 (D/W/M): the session view is the cell's local state (`GridChartCell.jsx:107`) and is not persisted, so the read-back is the canvas prop. The intraday case reads the persisted cell settings.
- C3-062: the product's own door is the cell's right-click "Set alert @ price" (`GridChartCell.jsx:353-360`), which picks the price under the cursor and infers the direction. The Agent's path creates the same kind of price alert on the cell's symbol at a stated price and direction. The outcome (an alert in the book) is the same; the door is not. The alert book is a stateful fetch fake, not the fixture server. A CONTROL case (the clicked cell NVDA differs from the named one AMD) and a negative control (alerting the active cell fails the same check): the controls prove the request context and the outcome check; the cell-to-symbol choice is made by the scripted model. The right-click entry point itself is NOT exercised.
- No row here was run in a real browser.
