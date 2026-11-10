# PR: Multi Chart grid execution and targeting (pl-grid, C3-042..061)

Branch `agent/pl/exec-multichart-grid`, rebased on origin/master `9bccdaab5c`. **Product code + tests + docs.** Evidence: LOCAL / SIMULATED (vitest, jsdom, scripted model, fixture server). Not a real browser, not the real model.

## What the member can now ask for

The Agent does, by natural language, what the Multi Charts menu and the cell buttons do. It goes through the same writers:

| Op | Product writer (the UI calls it too) | Rows |
|---|---|---|
| `multiChart.set` layout (preset or rows × cols; from the board too) | `mc.enterGrid` / `mc.applyCustomLayout` | C3-042, C3-043 |
| exit | `mc.exitGrid` | C3-044 |
| syncCrosshair / syncTimeRange | `mc.setSyncCrosshair` / `mc.setSyncTimeRange` | C3-045, C3-046 |
| groupsMode on / off ("Exit Groups") | `mc.setGroupsMode` | C3-047, C3-051 |
| pickGroup (picker, or an also-in chip) | `gridGroupActions.pickGroup` / `switchGroup` | C3-048, C3-049 |
| stepGroup (‹ Prev / Next ›) | `gridGroupActions.stepGroup` | C3-049 |
| refreshGroup (↻ Refresh) | `gridGroupActions.refreshGroup` | C3-050 |
| applySaved / saveGrid / deleteSaved | `mc.applyGridTemplate` / `useChartLayouts` save (create-only, user scope) / delete (own only) | C3-052, C3-053, C3-055 |
| openSettings | `mc.setSettingsOpen(true)` | C3-061 |
| restoreGrid | `mc.setMaxId(null)` | C3-060 |
| `multiChart.cell` maximize | `mc.setMaxId(id)` (lifted out of MultiChartGrid's local state) | C3-060 |
| `multiChart.cell` resetToMine | "Reset to my chart": the cell's own `settings` dropped, Style and timeframe kept | C3-059 |

C3-054 (save as global, admin) is **not done** (owner-blocked). The Agent saves only user-scope grids and refuses to delete a prebuilt one.

## Design

- **No duplicate logic.**
  - The group fetch-and-fill came out of the UI handlers into `pages/charts/grid/gridGroupActions.js`: `GroupPicker.pick`, `MultiChartMenu` Prev / Next and Refresh, and `MultiChartGrid`'s also-in switcher.
  - The saved-grid shape moved into `gridTemplateLayout` (gridLayouts.js).
  - Maximize moved into `useMultiChartState` (`maxId` / `setMaxId`). MultiChartGrid falls back to local state for the screener's `mc`.
  - The UI calls the same functions as the Agent.
- **One control object.** `pages/charts/grid/useGridAgentControl.js` is stable and reads everything live. It is mounted where `mc` lives (ChartsWorkspace: one hook call plus `gridControl` on the host). It is carried into grid mode by `scopeHostToGrid`.
- **Targets.**
  - `multiChart` is the grid: one ref, `boardScoped: false`.
  - `gridCell` is one cell, and its snapshot carries `chartRef`. Because the cell is chart-backed, deixis (anchor / negation / description), P2-B's unnamed-target check and gridMode's hidden-behind-maximized refusal all apply unchanged. `spatialCheck.js` and `deixis.js` are untouched.
  - No change to `useAgent.js`, `gridMode.js` or `deixis.js`.
- **Undo, byte for byte.**
  - The grid kind restores `mc.snapshot()`, the persisted board as a string, through `restoreSnapshot`, plus `maxId` and the dialog state.
  - A cell op restores that cell's JSON only.
  - Save and delete own only the saved-grid list: Undo deletes or re-saves, and never touches the grid.
  - Stale Undo is fingerprint-guarded.
  - A group fill that returns nothing is rolled back: the picker turns Groups mode on first.
- **Scope in receipts.**
  - Grid-wide ops say "every chart in the grid" or "the whole grid is now R×C".
  - A shrink names the charts it drops and is PROPOSED first. A delete is proposed first.
- **Routing.** A new add-only group, `multiChart` (2 actions, `fillLast`). No existing group was edited.

## Files

- Product:
  - `app/src/pages/charts/grid/{gridGroupActions.js (new), useGridAgentControl.js (new), useMultiChartState.js, MultiChartGrid.jsx, MultiChartMenu.jsx, GroupPicker.jsx, gridLayouts.js}`
  - `app/src/agent/capabilities/multiChart.js` (new)
  - `app/src/agent/host.js` (`gridControl` param)
  - `app/src/pages/charts/ChartsWorkspace.jsx`: 4 lines (import, hook, `gridControl`, eslint comment)
- Shared, final commit only, after the rebase:
  - `app/src/agent/builtins.js` (1 register line), `app/src/agent/routing.js` (new group)
  - Goldens: `contract/manifest.golden.json` (UPDATE_AGENT_GOLDEN=1), `api/services/uct_agent/scan/sat/section_b_requests.json` (UPDATE_SAT1_REQUESTS=1), `tests/fixtures/nl1_assemble_parity.json` (UPDATE_NL1_PARITY=1)
  - `agentRouting.test.jsx` census 157 → 159
  - `docs/agent/CHARTS_EXECUTION_STATUS.md`
- Tests:
  - `app/src/agent/qa/chartsOutcome/multiChart.outcome.test.jsx`: the 16 it.todo rows turned into outcome cases, plus boundary and ambiguity cases.
  - `app/src/agent/qa/chartsOutcome/multiChartGrid.family.test.jsx` (new): the held-out family over 2×2, 2×3 and 3×3.

## Results

All runs went through `python ../tools/agent_suite_lock.py run --who pl-grid -- powershell -File <scratch>\pl-grid\bn.ps1 node node_modules/vitest/vitest.mjs run <scope>`, from `app/`, at BelowNormal. Every run is SCOPED, never full; the Lead schedules the full suite.

- **Pre-fix** (capability built but not registered, so the model was never given `multiChart.*`):
  - Scope: `multiChart.outcome.test.jsx` and `multiChartGrid.family.test.jsx`.
  - Result: `Tests 60 failed | 8 passed | 1 todo (69)`. The 8 that passed are the existing C3-056/057/058/062 cases.
- **Final**, on the head before the shared commit plus the shared files, rebased on `9bccdaab5c`:
  - Scope: the two files above, plus `agentMultiChartMode`, `agentGridReuse`, `agentContracts`, `agentScanSat1Requests`, `agentRouting*`, `agentManifestCaps`, `agentNl1Selection*`, `agentSurfaces`, `pages/charts/ChartsWorkspace*.test.jsx`, `pages/charts/mobile/multiChartDoor.wire.test.jsx`, `src/pages/charts/grid/` and `src/pages/screener/focus/__tests__/`.
  - Result: `Test Files 97 passed (97)`, `Tests 1390 passed | 1 todo (1391)`.
  - Outcome file: 29 passed + 1 todo (C3-054).
  - Family file: 45 passed. vitest counts the 3 KNOWN-GAP `it.fails` pins as passed, and the 3 matching current-outcome pins are among the 45.
- **Mutations: 8 of 8 killed.** Each one ran both files in full against a single product mutant, and the file was restored and verified after each run.
  - M1, maximize targets cell 0: 16 failed.
  - M2, Undo skips the board snapshot: 16 failed.
  - M3, reset also drops the Style pick: 1 failed.
  - M4, no rollback of an empty group fill: 1 failed.
  - M5, workspace layouts listed as grids: 1 failed.
  - M6, a prebuilt grid deletable: 1 failed.
  - M7, a shrink that drops charts not shown first: 4 failed.
  - M8, refresh replaced by re-pick: killed after C3-050 was tightened to assert the also-in chips survive.
- **Notebook first-open bytes:** master `9bccdaab5c` 2,256,278 B → this head 2,256,291 B. **+13 B**, PASS (budget 2,260,793). Measured with `vite build` and `tools/notebook_perf_budgets.py --dist app/dist`.

## Rows moved (status doc, recounted by script)

- VERIFIED +16: C3-042, 043, 044, 045, 046, 047, 048, 049, 050, 051, 052, 053, 055, 059, 060, 061.
- C3-054 stays BLOCKED (owner).
- Charts total: 225 → **241 of 484 (49.8%)** VERIFIED. PARTIAL stays 9.

## Known gaps and notes for AUDIT

1. **Deixis, "not the one I clicked"** (pinned with an `it.fails` plus a test asserting today's wrong outcome, on all 3 shapes).
   - `NEG_POINTER` doesn't treat that phrase as a negation, so a plan on the clicked cell runs.
   - This is the shared machinery, independent of the target kind. It is routed to #988. Both pins flip when its fix lands.
   - "not the clicked one" is handled (it's asked).
2. **Server mirrors not updated** (pytest not run here):
   - `api/services/uct_agent/turn_v2.py` `_DOMAIN_OF` has no `multiChart` entry, so planner v2 files it under "history"; probably wants "board".
   - `knowledge/guard.py`'s action-name regex doesn't list `multiChart`.
   - `tests/test_uct_agent_nl1_selection.py` and `tests/test_agent_eval_run.py` read the regenerated parity fixture.
3. **Group seed is not persisted.** `sanitizeState` drops `group.seed` on hydrate, so an industry-cohort refresh after a reload says "Nothing to refresh". This is pre-existing and not changed here.
4. **`multiChart.cell` and `chart.*` in one plan.** They share refs (the cell id). A plan mixing them on the same cell is refused as "doesn't apply", never applied to a wrong cell.
5. **Opening Shared Chart Settings** is a dialog opener with an Undo that closes it (C3-061). Like C1-127, no other capability opens a dialog.
