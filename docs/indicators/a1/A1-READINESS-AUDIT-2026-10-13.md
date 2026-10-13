# Indicators A1: readiness audit and revised implementation plan

- **Status:** preparation only. **A1 is not authorised for implementation.** No product code or tests are changed on this branch.
- **Branch:** `prep/indicators-a1` (worktree `C:/w/ia1`), from master **`fdba4c997d`**. Local only.
- **Base plan:** `A1-IMPLEMENTATION-PLAN.md` on `audit/indicators-competitive-2026-10-13` (`83c176408b`). It was written against `1eba7c105c`.
- **This document** lists what changed since then, and the corrections that apply on top of that plan. Paths are relative to `app/src/`.

## 1. Drift since the plan was written

| Check | Result |
|---|---|
| A1's files on master since `1eba7c105c` | **0 changed.** All 18 files in plan §5.1, plus `builder/agentMutations.js` and `builder/agentSeams.js`. Master's 13 new commits are Breadth, Agent breadth selection, ledger docs and discord-chart |
| The plan's Agent references | **All still hold.** `useAgent.js:255/653/775-818`, `chart.js:267-274/633/646`, `indicatorEdits.js:24`, `agentSeams.js:30-33`. `IndicatorSummary` moved to `:43-53` |
| Agent calls `setIndicatorEnabled`, `toggledRow` or `applyRowPatch` | **Never** (no hits in `agent/*`) |
| C5: Agent `chart.resetDefaults` drops `header.infoValues` | **Still true.** It is the Agent's to fix |
| In-flight branches touching A1 files | **None live.** `feat/agent-conversational-intelligence` (`C:/w/aconv`, the current Agent project) has no commits and only one untracked eval test. `notebook-p2b-*` change `pages/Settings.jsx:191`, which is far from A1's `:542-551`. The dirty `StockChart.jsx` edits in `~/projects/UCT-Dashboard*` date from 08-28 to 09-08 (abandoned) |
| A1-area tests on master | **15 files, 600/600 passing**: instanceControls, perInstanceDoor, controlDoorCensus, stockChartWiring, instanceInputSurvivesTheMirror, engineEnabledMigration, hiddenIsRemovedNotParked, chartRegion, IndicatorLibraryDialog, MobileIndicatorSheet.studies, MobileChartsApp.landing, agentChartTemplateParity, agentBatch6, agentSeams, addDoorIdentity |
| A1 work already done elsewhere | **None.** No `indicatorHistory*`, `indicatorPreservation*` or `unavailableInstances*` exists |

## 2. Corrections to the plan

### 2.1 Regressions the plan would have introduced

| # | Finding | Evidence | Plan change |
|---|---|---|---|
| **R1** | **A hidden door unhides on an edit.** `setIndicatorInput` calls `setIndicatorEnabled(cs, defId, true)` whenever `isIndicatorEnabled` is true, and a hidden instance counts as enabled. Under A1's new "ON + all hidden → unhide" branch, **a colour or input edit on a definition-hidden `legacy:<id>` row would show the whole definition again** | `engine/instanceControls.js:597-599`; reached from `indicatorRegistry.js:972` `applyRowPatch` ← `ChartSettingsModal.setRow` (`:650`, `:710-713`) | Split out a private `ensureLegacyInstance(cs, defId, registry)` (build or revive only, never unhide). `setIndicatorInput` calls it instead of `setIndicatorEnabled(true)`. New rail: "editing an input on a def-hidden row keeps it hidden, byte-for-byte apart from the input" |
| **R2** | **`applyRowPatch(enabled:false)` has a shipped caller**, contrary to the plan's "latent" | `ChartSettingsIndicators.setRowVisible` (`:803-810`) → `onRowPatch` → `ChartSettingsModal.jsx:1271` `setRow`, for engine rows **without** an `instanceId` (P2b legacy projection) | Add it to the door table as **D7**. Behaviour is unchanged, because with 0 live instances OFF still tombstones `legacy:<id>`. Covered by a door test |
| **R3** | **The §1.12 persist filter is not grid-only.** It runs on every StockChart with `settingsOverride` and no `onSettingsPersist` | `ChartRender.jsx:953`, `BreadthDrillList.jsx:238`, `EtfHoldingsResults.jsx:102`, `ListSubscription.jsx:263`, `PeriodSortResults.jsx:190` | The filter is right for all of them: an override-owned id should never leak into the global blob. But **the guard toast must be generic**: "This indicator comes from the chart this view mirrors — change it there". Add one door test per non-grid host family (list/drill) |
| **R4** | **Share-link strip collides with the workspace deep link.** `ChartsWorkspace.jsx:1611` already does `replaceState({}, …)`, which **wipes `history.state`** and leaves `?state=` in place | `ChartsWorkspace.jsx:1605-1613`, `lib/chartDeepLink.js:44-56`, `PopoutWindow.jsx:141` | Reuse `chartDeepLink`: add `SHARE_STATE_PARAM` and `stripShareState(search)`. A single strip site removes both groups of parameters. Change `ChartsWorkspace`'s `replaceState({}, …)` → `replaceState(window.history.state, …)` (one line, workspace-owned, A1.3 commit). Test: a `?sym=…&state=…` link applies both and strips both, and `history.state` survives |

### 2.2 Doors missing from the plan's table

**Behaviour fixes:**
- **D8.** The search-result checkmark at `ChartSettingsIndicators.jsx:3081` uses `isRowOn`, so a hidden definition would read "on". It must use the three-state `rowVisibility`.
- **D9.** The Chart Settings MA duplicate at `ChartSettingsIndicators.jsx:2089` (`duplicateWriter` → `toggledRow`). This is the add path. Assert it is unchanged.

**Keep the "exists" meaning, and document why:**
- **D10.** `indicatorRegistry.js:561`: the row's `enabled` uses `isIndicatorEnabled`.
- **D11.** `StockChart.jsx:6195-6196`: the share **sender** uses `isIndicatorEnabled`. Def-hidden instances travel hidden; the marker is inside the instance.

**Leave alone, but add to the census ledger:**
- **D12.** `testing/marketcap/marketCapHarness.jsx:200` calls `setInstanceHidden`. It is a test harness, and its behaviour gains only the `hiddenVia` deletion.

### 2.3 Reuse instead of new code

| Plan proposed | Already exists | Revised approach |
|---|---|---|
| `engine/indicatorHistory.js`, ~220 new lines: `recordOf`, `canApply`, `applyUndo/Redo` | `builder/agentMutations.js:69-300` (Indicators-owned): `recordOf`, `canon`/`same`/`clone`, `diffInto` with `{instanceId}` paths and `order`, `getAt`/`setAt`, `holds`, never-partial `revert` | **Extract** the generic diff/holds/setAt/revert into `engine/settingsRecord.js`, parametrised by granularity (`'leaf'` / `'element'`) and contract token. `agentMutations.js` re-exports it unchanged. **Add** what is missing: whole-element granularity, and add-undo by splice (today `setAt` throws "missing keyed element", so revert refuses). **No `agent/*` edit.** The Agent rails (`agentIndicatorsM2/M3`, `agentBatch6`, `agentSeams`) must stay byte-green |
| `keepIndicatorState` | `agent/capabilities/chart.js:267-274` `keepOwned` (Agent-owned) | A new Indicators-side function is still needed, because components must not import `agent/`. It iterates `INDICATOR_OWNED_TOP_KEYS` and adds `header.infoValues`. Offer the Agent the swap (that fixes C5); the Agent decides |
| `claimShareState` + strip | `lib/chartDeepLink.js` | Extend it (R4) |
| Unavailable group in Chart Settings, as a new component | `chartDataMap.js:188-191` repair groups (`orphans` "Needs attention", `hidden` "Not shown"), rendered at `ChartSettingsIndicators.jsx:1769-1795` (`insGroupRepair`) | Add a third group kind, `unavailable`, in `chartDataMap`, using the existing shell. `UnavailableIndicators.jsx` keeps only the **legend chip and popover**. The reader feeds on `normalizeInstances(...).dropped` (`engine/instances.js:763-817`), which already exists and is unused |
| `removeUnavailable` | private `severDependents` (`instanceControls.js:97`) and `severInfoValuesTo` | Reuse both, in the same file |
| History store | No generic store. Closest precedent: `builder/authoring/conversationSessions.js:77-110`, a guarded sessionStorage mirror | Copy its guard style, and add user scoping |
| BroadcastChannel | `createChangeChannel` (`journal-2-0/lib/offline/outboxLeader.js:115`, journal-owned) | Mirror the pattern locally; no cross-domain import |
| Undo toast | `MultiChartGrid.jsx:473-489` `styles.undoToast` (`role=status`, Undo button, 10 s). `chartToast` is text-only, 1.9 s | Build a new component in the same visual language |

### 2.4 Consistency with the Agent

| Topic | Fact | Decision for A1 |
|---|---|---|
| Layout undo (§1.11) | The Agent undoes `layout.open` by **reopening the previous layout**. It refuses when the switch discarded an unsaved board (`agent/capabilities/layout.js:143,233-236`). The plan's snapshot undo would **restore** an unsaved board | Recommend that A1.3b **matches the Agent** (reopen, and refuse with the same sentence), unless the owner wants unsaved-board restore. If so, the Agent's behaviour should change too. **New owner question Q7** |
| `hiddenVia` and pending Agent undo | `instanceFingerprint` (`agentSeams.js:116-128`) hashes whole instances, so a member's definition hide makes a pending Agent undo refuse | Correct (never clobber). Note it in the Agent handoff |
| Template apply | Agent `chart.applyTemplate` = click (replace), `chart.js:633`; parity rail `agentChartTemplateParity.test.jsx:114` | Unchanged; the click path only gains a record |

### 2.5 Test-plan corrections

- `hideModelPrototype.audit.test.js` (5) and `paths.audit.test.js` (16) **are not in the repo.** They are untracked scratch at `C:/w/indaud/app/src/__audit_scratch__/phaseA-3/`. A1.1 must **vendor** them as `engine/__tests__/indicatorVisibilityProperty.test.js` and `indicatorVersionSkew.test.js` before CI can run them.
- The `agentBatch6` `keepOwned` test is at `:113`, not `:78-114`.
- The `controlDoorCensus` caller-count assertion is at `:279-280`. **It stays 4**, because R1 adds no new external caller.
- **Running the new rails in CI depends on A0:** with A0's completion check, a full-suite run in which vitest does not finish reads INVALID instead of clean.

## 3. Revised implementation plan

### 3.1 Commits (each separately revertable; in order)

| Commit | Content | Main files |
|---|---|---|
| **A1.0** | Extract `engine/settingsRecord.js` from `agentMutations.js`, with no behaviour change: same exports, Agent rails byte-green. Vendor the two audit probes as failing-today tests (marked `.fails` until A1.1) | `builder/agentMutations.js`, `engine/settingsRecord.js` (new), 2 tests |
| **A1.1** | The hide model. `definitionVisibility`; new `setIndicatorEnabled` semantics; `ensureLegacyInstance` (R1); `removeDefinition`; `setAveragesVisible`. `setInstanceHidden`, `duplicateInstance` and `addInstanceCopy` drop `hiddenVia`. Doors D1–D6 and D7–D12. Region `hostKey`. Persist filter, with the generic notice (R3) | `engine/instanceControls.js`, `IndicatorLibraryDialog.jsx`, `ChartSettingsIndicators.jsx`, `chartRegion.js`, `StockChart.jsx` (hunks a–f), `MobileIndicatorSheet.jsx`, `indicatorPreservation.js` (strip/isOverrideOwned) |
| **A1.2** | Undo. `settingsRecord` element mode plus splice; `indicatorHistoryStore`; `IndicatorUndoToast`; panel Undo/Redo; toast-scoped capture Ctrl+Z | new store and toast; `StockChart.jsx` (i); `ChartSettingsIndicators.jsx`; `MobileIndicatorSheet.jsx`, `MobileChartsApp.jsx` |
| **A1.3** | Bulk preservation. `keepIndicatorState` (Restore Defaults, both presets sites). Template records. One-shot single-target share, with prompt, via `chartDeepLink` (R4) | `ChartSettingsModal.jsx`, `ChartToolbar.jsx`, `pages/Settings.jsx`, `ChartWidget.jsx`, `pane/ChartPane.jsx`, `lib/chartDeepLink.js`, `StockChart.jsx` (g), `ChartsWorkspace.jsx` (one line, R4) |
| **A1.3b** | Layout-apply undo, if Q3 is yes, with the semantics from Q7 | `ChartsWorkspace.jsx` |
| **A1.4** | Unavailable notice. Reader over `dropped`, `chartDataMap` group, legend chip. `removeUnavailable`, `repairInstance`. Projection suppression. v1-fold keeps dropped records. Uninstall-on-absence plus BroadcastChannel | `engine/unavailableInstances.js` (new), `chartDataMap.js`, `UnavailableIndicators.jsx` (new), `chartDefaults.js`, `StockChart.jsx` (h), `hooks/useUserDefinitions.js` |

### 3.2 Dependencies

- **A0 lands first.** Its CI completion check is what makes A1's frontend rails count. A1 shares no files with A0.
- **No backend change, no migration, no new storage keys** except `sessionStorage` under the exact prefixes `uct.indicators.history.v1:` and `uct.indicators.unavailable.dismissed.v1:`.
- **No feature flag** (plan §7.1). No new infrastructure, and no paid calls.
- **A2** runs in parallel. The overlap is `useUserDefinitions.js` (A1 owns `useInstalledUserDefinitions`) and the `IndicatorLibraryDialog` row (A1 owns the check span).

### 3.3 Regression tests

**Existing rails that change** (plan §6.1, about 17 files): every change carries its reason, and none is weakened.

**Must stay byte-green:**
- `hiddenIsRemovedNotParked`
- `engineEnabledMigration:511`
- `agentChartTemplateParity`
- `agentBatch6`
- `agentSeams`
- `agentIndicatorsM2/M3`
- `addDoorIdentity`

**New, beyond plan §6.2:**
- **R1:** an input or colour edit on a def-hidden legacy row stays hidden.
- **R2:** `setRowVisible` without `instanceId` → `applyRowPatch(false)` → `legacy:<id>` tombstone (unchanged).
- **R3:** the persist filter in a list/drill host (no `onSettingsPersist`); the generic notice copy.
- **R4:** a combined `?sym=&tf=&state=` link: one chart applies, every parameter is stripped, `history.state` is preserved, and a reload does not re-apply.
- **D8:** the search checkmark is three-state.
- **A1.0:** extraction parity. A golden of `recordOf`/`revert` outputs over the Agent M2/M3 fixtures, identical before and after.
- The property test runs ≥1,000 seeds, and the R1 step is in its generator.

**Each new door test must fail on today's code.**

### 3.4 Integration risks

| Risk | Severity | Mitigation |
|---|---|---|
| R1 (an edit unhides) if missed | High: a silent visibility change | `ensureLegacyInstance`, plus the R1 rail and a property-test step |
| `agentMutations` extraction alters Agent undo | Medium | A1.0 is a pure refactor with a golden parity test; it lands on its own commit and the Agent session reviews it |
| `StockChart.jsx` hunks collide with another session | Low today (no live branch) | Nine localized hunks; rebase onto A1 |
| Old tabs run the old delete-all for one deploy cycle | Accepted (plan §7.2) | Same as today's behaviour |
| Rollback trap: the old Library row reads "ticked" on def-hidden instances, so a click deletes | Medium, only if reverted | Rollback note: "use the legend eye" |
| Layout undo semantics diverge from the Agent | Medium (UX inconsistency) | Q7 |
| Ctrl+Z precedence with drawings | Low | Capture listener only while the toast is visible; no drawing file touched |

## 4. Owner decisions

- **Plan Q1–Q6** are unchanged, with the recommendations in the plan.
- **New: Q7.** Layout-apply undo: reopen the previous layout and refuse when an unsaved board was discarded (Agent parity, recommended), or restore the unsaved board snapshot (needs the Agent to change too)?
- **Coordination, not owner decisions:**
  - Agent review of A1.0 (record extraction);
  - Agent picks up C5 by swapping `keepOwned` for `keepIndicatorState`;
  - the drawing owner, for a future Ctrl+Z arbiter.
