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

## Changed files (`git diff --stat origin/master...HEAD`, head before this doc edit)

- `api/services/uct_agent/knowledge/guard.py` (4 lines)
- `api/services/uct_agent/scan/sat/section_b_requests.json` (120 lines)
- `api/services/uct_agent/turn_v2.py` (3 lines)
- `app/src/agent/agentRouting.test.jsx` (2 lines)
- `app/src/agent/builtins.js` (2 lines)
- `app/src/agent/capabilities/multiChart.js` (475 lines)
- `app/src/agent/contract/manifest.golden.json` (127 lines)
- `app/src/agent/host.js` (5 lines)
- `app/src/agent/qa/chartsOutcome/multiChart.outcome.test.jsx` (379 lines)
- `app/src/agent/qa/chartsOutcome/multiChartGrid.family.test.jsx` (406 lines)
- `app/src/agent/routing.js` (10 lines)
- `app/src/pages/charts/ChartsWorkspace.jsx` (6 lines)
- `app/src/pages/charts/grid/GroupPicker.jsx` (15 lines)
- `app/src/pages/charts/grid/MultiChartGrid.jsx` (29 lines)
- `app/src/pages/charts/grid/MultiChartMenu.jsx` (64 lines)
- `app/src/pages/charts/grid/gridGroupActions.js` (97 lines)
- `app/src/pages/charts/grid/gridLayouts.js` (14 lines)
- `app/src/pages/charts/grid/useGridAgentControl.js` (81 lines)
- `app/src/pages/charts/grid/useMultiChartState.js` (18 lines)
- `docs/agent/CHARTS_EXECUTION_STATUS.md` (59 lines)
- `docs/agent/program/PR-exec-multichart-grid.md` (113 lines)
- `tests/fixtures/nl1_assemble_parity.json` (33 lines)
- `tests/test_uct_agent_contract.py` (4 lines)
- `tests/test_uct_agent_server_capability_mirrors.py` (98 lines)

Totals: 24 files changed, 2023 insertions(+), 141 deletions(-)

**Note: `app/src/agent/host.js` changed** (5 lines: the `gridControl` param handed to the Multi Chart capability). It is the shared Agent host, so review it as a shared-file change, not grid-only.

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
   - **Flip plan:** the post-#988 re-merge. Once #988 is on master, this branch (or master, if #1030 merged first) takes one commit, `test(agent): the 'not the one I clicked' deixis pins become plain tests after #988 (pl-grid)`, which replaces the `it.fails` + `PINNED current WRONG outcome` pair in `multiChartGrid.family.test.jsx` (~line 331-348) with one plain `it` asserting the ask and the kept fork, on all 3 shapes. The Lead names that commit's SHA in the re-merge report.
   - "not the clicked one" is handled (it's asked).
2. **Server mirrors: FIXED in this head** (commit `fix(agent): server mirrors know the Multi Chart family`).
   - `api/services/uct_agent/turn_v2.py`: `_DOMAIN_OF["multiChart"] = "board"` (the workspace as a whole, like `board.*` / `widget.*` / `layout`-adjacent controls); the board domain title now names the Multi Chart grid.
   - `api/services/uct_agent/knowledge/guard.py`: `multiChart` added to the action-name prefixes and `cell` to its verbs, so a retrieved passage naming `multiChart.set` / `multiChart.cell` is withheld.
   - **Behaviour before the fix, now asserted by tests** (`tests/test_uct_agent_server_capability_mirrors.py`):
     - planner v2 does NOT refuse an unknown prefix; it silently misfiles it under `history` (`domain_for("someFutureFamily.doThing") == "history"`).
     - the knowledge guard FAILS OPEN on an unknown family: `"multiChart.cell maximize"` passed as clean data with no flag; only the generic "run/call/use <a.b>" clause caught it, and only with a verb in front.
   - Ratchets in the same file: every manifest prefix must have a `_DOMAIN_OF` entry (frozen known-unlisted: `calendar`; `breadth` is history by design), and every manifest action name must be withheld bare by the guard (45 pre-existing names frozen; the list may only shrink). A NEW capability family now fails CI until both mirrors know it.
   - `tests/test_uct_agent_contract.py` `_GROUP_OF` gains `"multiChart": "multiChart"` (it indexes every golden prefix, so the new family would have been a KeyError).
   - Rail (standalone stub runner, not pytest; same assertions, no backend): pre-fix 6 failed | 6 passed (12); post-fix 12 passed. Mutations 4/4 killed (standalone stub runner, not pytest): drop the domain (2 failed), map it to `chart` (1), drop the guard prefix (4), drop the `cell` verb (2). None of these counts is a pytest result; CI/AUDIT runs `tests/test_uct_agent*.py` under pytest.
   - Found, not changed (pre-existing, outside this PR): `calendar` is unlisted in `_DOMAIN_OF` (files under history); 45 action names (list in the test) pass the guard bare.
3. **Group seed is not persisted.** `sanitizeState` drops `group.seed` on hydrate, so an industry-cohort refresh after a reload says "Nothing to refresh". This is pre-existing and not changed here.
4. **`multiChart.cell` and `chart.*` in one plan.** They share refs (the cell id). A plan mixing them on the same cell is refused as "doesn't apply", never applied to a wrong cell.
5. **Opening Shared Chart Settings** is a dialog opener with an Undo that closes it (C3-061). Like C1-127, no other capability opens a dialog.

## Re-merged onto 64421f770d (2026-11-11)

Merge `951f7b9419` (origin/master `64421f770d`), SAT-1 `2918499cce`, this doc + the #988 pin swap after. LOCAL, vitest / pytest, scripted model, jsdom; no model calls, nothing pushed.

**STATUS: STOPPED for the Lead / AUDIT. Two rails fail by the rules of this re-merge, and neither was "fixed" here:**

1. **Routing v2: 2 in→out** (`docs/agent/program/evidence/1030-remerge/v2-first-calls.md`, 3635 requests, 320 differ; in→in 62, out→in 1, out→out 19, **in→out 2**, no expectation 236; in on master 665/774, merged 664/774). The rows are `corpus.json:slang-08` (screener.run) and `agentExec widget held-out:C3-172` (widget.setOption). Cause: the `multiChart` group is `fillLast` but not `wordsOnly`, so v2 uses it as filler and displaces `screener` / `boardEdit`. Experiment, not committed: `wordsOnly: true` gives 29 differing, 0 in→out.
2. **agentNoLookbehindEquivalence: frozen routing rows changed** (digests not re-recorded). v1 `selectGroups` over the 2745 frozen inputs: 984 change. 980 only add `multiChart`. **4 collapse from the full manifest (no group matched) to `multiChart` (+ agent / undo)**: lb.routing[75], [159], [200], [227]. Their bare words `groups`, `rows` and `sync` match the group's words. With `wordsOnly` 21 still change, and the same 4 still collapse. The v1 words need narrowing (bare `groups?`, `rows?|columns?`, `sync`), or the Lead must decide whether to re-record, as #1027 did.

Also failing, outside #1030's scope:
- `tests/test_uct_agent_nl1_selection.py::test_a_routed_nl1_request_is_three_cache_blocks_core_first`: the merge adds a 25th routing group, and `turn.py` MAX_GROUPS = 24 drops `guide`. Expected until the MAX_GROUPS 32 PR lands. turn.py is untouched.
- `tests/test_uct_agent_server_capability_mirrors.py::test_every_manifest_action_name_is_withheld_by_the_guard_ratchet` (#1030's own ratchet): master's newer actions `chartSetup.autoScale`, `chartSetup.compareGroup`, `chartSetup.stepBars`, `watchlist.arrangeColumns` and `watchlist.exportList` are not withheld by `knowledge/guard.py`'s verb list. The multiChart names pass. This needs a guard verb decision, so the guard is untouched.

Numbers on the merged tree:
- Pins: agentRouting FULL.length 164 + 2 = **166**. agentScreener manifestFor(CTX).length 158 + 2 = **160**. agentNl1Selection core and agentIndicatorsM2 are unchanged and pass (multiChart is its own fillLast group).
- agentNl1SelectionCoverage at budget 55: corpus 174/182 (95.6%), dev 43/43 (100%), heldout-v1 164/165 (99.4%). This is identical to master `64421f770d` run the same way, with 0 not reachable.
- agentExecReach: 23/23 tests pass, held-out v2 list 8/8. agentScanSat1Requests 62/62. routeReachability passes (multiChart.cell phrasing added). noRegexLookbehind passes.
- capreg routing / routingV2 / inventory (702) / golden / collision ×2 / contracts pass, and nlm1Routing passes.
- #988 rails pass: agentTargetTruth, agentRelativeChart, agentDiagonalChart, agentNegatedClickAct, agentTickerAnchors, agentLineAbsolute. multiChart.outcome passes, as do the grid tests (MultiChartGrid / GridChartCell / useMultiChartState) and agentMultiChartMode.
- Family test: 42/42. #988's NEG_POINTER fix flipped the 3 KNOWN-GAP it.fails and the 3 PINNED cases. As the pin said, each pair is now one plain `it` asserting the ask, so the clicked cell is never the target on a grid either. #988's targeting applies to `multiChart.cell` unchanged, because its snapshot carries `chartRef` (spatialCheck `chartRefOf`). There was no textual conflict: #1030 touches neither deixis.js, spatialCheck.js nor useAgent.js.
- Capreg corpus: #1030 had no entry for its actions. This merge adds them:
  - a GRID fixture board (`testing/gridStub.js`, the useGridAgentControl method set);
  - `expect.grid`;
  - two multiChart.set intents (2×3 layout + Undo, crosshair sync + Undo), 4 phrasings plus 2 undo cases, all passing;
  - a refusal case for multiChart.cell with the grid closed (`refusedAction` asserted);
  - lock 173 intents / 43 refusals / 31 workflows;
  - coverage 133/185.
- Generated files were reset to master and regenerated, each in its own run: golden (+127, the same delta as before), parity, capreg baseline, UPDATE_CAPREG. SAT-1 has 30 hunks, each the same multiChart group listing, in its own commit.
- CHARTS_EXECUTION_STATUS.md: master's file plus #1030's 16 rows, recounted by script: **259 / 484 VERIFIED (53.5%)**, MISSING 105, BLOCKED 29.

### Lead decisions applied (2026-11-11)

- **Routing.** The `multiChart` group is now `wordsOnly: true`, the same pattern as watchlistShow / compareGroups, with OWN_WORDS phrases in nlm1Routing.test.js. Its words now need grid context:
  - a grid acted on ("open / save / delete / apply / load / close / exit / restore / fill / refresh / rename … grid", "in / of / across the grid", "show me a 2x3 grid");
  - "multi chart", or "split my screen";
  - rows AND columns;
  - sync WITH crosshair / time range / charts / cells, and link / lock only WITH crosshair / time range;
  - "groups mode", "next / previous group", "refresh the group", "switch to the … group" (not when followed by comparison / overlay / scale).
  - A bare "grid", "2x2", "group(s)", "row(s)", "sync", "crosshair" or "link … charts" no longer selects it. Plain alternations plus one negative lookahead; no lookbehind.
- **Results:**
  - agentNoLookbehindEquivalence passes with **0 frozen rows changed**.
  - v2 first calls: **0 of 3635 requests differ from master** (in→out 0).
  - compareGroups' own phrases still select compareGroups and not multiChart.
- **Guard.** It is now stricter only: `step|auto|compare|arrange|export` joined the withheld verbs, commented "#1030 ratchet: master actions added by #1077/#1073/#1027". The full `tests/test_uct_agent*.py` run passed 4133, with 1 test deselected (the cap test below), including every knowledge test.
- **Unchanged files.** Golden, parity, capreg and SAT-1 did not move. Their rails pass without regeneration, and SAT-1's 30 hunks still list the multiChart group in the sent group lists.
- **Required set.** 18 files / 2438 tests and 31 files / 2364 tests (1 todo), all green.
  - NL-1 coverage at budget 55: corpus 95.6%, dev 100%, heldout-v1 99.4%, identical to master.
  - agentExecReach held-out v2 list 8/8.
- **Expected red, not this PR's.** `tests/test_uct_agent_nl1_selection.py::test_a_routed_nl1_request_is_three_cache_blocks_core_first` fails only because there are 25 routing groups and turn.py's MAX_GROUPS = 24 drops `guide`. The separate MAX_GROUPS 32 PR fixes it. turn.py is untouched.
