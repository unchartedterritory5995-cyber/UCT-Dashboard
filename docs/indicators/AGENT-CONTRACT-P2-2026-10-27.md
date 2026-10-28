# Indicators → Agent: Phase 2 contract (I-1 … I-13), implemented

**Status:** implemented on `feat/indicators-agent-contracts`. Draft PR only: not merged, not deployed.
**Answers:** `docs/agent/PHASE2-SHARED-CONTRACT.md` (the Agent's P2-G proposal, 2026-10-25).
**Basis:** origin/master `54821d83f7`. A1 is merged there (`826aa288ec`).

---

## 1. Rulings on the proposal

| § | Ruling |
|---|---|
| §2 frozen interfaces | **ACK.** Nothing listed there changed meaning. |
| §3 I-1 … I-8 | **Implemented** as new ops inside `uct.indicators.mutation/1`. Same token, same `REASONS`, same plan → apply → confirm → undo. |
| §3 I-9 … I-13 | **Implemented.** All additive. |
| §4 Undo unification | **Not adopted in this milestone.** The owner decided to keep two separate histories. Every new op returns an exact Undo token exactly as the old four do. No Agent change is recorded on the member's A1.2 stack. |
| §5 Restore Defaults | **Already available:** `keepIndicatorState(next, prev)` in `components/chart/indicatorPreservation.js`, which is what `ChartSettingsModal`'s Restore Defaults calls. To match the modal, the Agent can call `keepIndicatorState(JSON.parse(JSON.stringify(CHART_DEFAULTS)), cs)` instead of `keepOwned`. |
| §7 stability rules | **ACK.** The change is additive only: no existing op, field or refusal code changed, and `REASONS` has no new entries (a test pins this). |

---

## 2. What is exported

### `components/chart/builder/agentMutations.js` — `uct.indicators.mutation/1` (extended)

- `MUTATION_OPS`:
  - The first four are unchanged and keep their order: `add`, `remove`, `setVisible`, `setInputs`.
  - Then `STYLE_OPS`: `setAppearance`, `setPlotStyle`, `setColor`, `setDisplayTarget`.
  - Then `PANE_OPS`: `movePane`, `setPaneSize`.
  - Then `CREATE_OPS`: `duplicate`, `copyFrom`.
- `STYLE_OPS`, `PANE_OPS` and `CREATE_OPS` are also exported on their own.
- `planIndicatorMutation`, `applyIndicatorMutation`, `confirmIndicatorMutation` and `undoIndicatorMutation` keep the same signatures and accept the new ops.
- New: `styleOptionsOf(cs, registry, instanceId)`, `paneFingerprint(cs, registry, volumeOpts?)`, `planAcrossCharts(charts, request)`.
- Extended: `resolveIndicatorTarget(cs, registry, {instanceId | name | defId, inputs, ordinal})` (I-10).

### `components/chart/builder/agentPanes.js` — new (I-9)

- `paneKeysOf(cs, registry, volumeOpts?)` returns `[{paneKey, kind: 'price'|'volume'|'pane', label, index, ownerInstanceIds, hostInstanceId, share}]`.
  - Order is top to bottom, the same list Chart Data's Arrange shows.
- `paneArrangeArgs(cs, registry, volumeOpts?)` and `paneOrderOf(...)`.

### `components/chart/builder/agentDefinitions.js` — new: `uct.indicators.definitions/1`

- `searchDefinitions(query, ctx)`
- `describeDefinition(defId, ctx)`
- `findDefinitionUsage(defId, charts, registry)`
- `planDefinitionAction(request, ctx)`
- `executeDefinitionAction(plan, ctx, deps?)` (async)
- `undoDefinitionAction(undo, ctx, deps?)` (async)
- `DEFINITION_OPS = ['duplicate', 'delete']`
- `discardDraft`, re-exported unchanged from `authoring/1`

### `components/chart/builder/agentSeams.js` (I-11, additive)

`instancesOf` rows gain five fields:
- `hiddenVia` (`'definition'` | `null`)
- `inputs` (stored values; an absent key means the declared default)
- `presentation`
- `displayTarget` (resolved: `'price'` | `'volume'` | `'pane'` | `'@<hostId>'`)
- `paneKey` (an I-9 key)

### `components/chart/engine/instanceControls.js` (I-13)

- `isValidColorValue(v)`.
- `checkInstanceInput` now refuses a `color` input value that is not a drawable colour:
  - accepted: hex (3/4/6/8 digits), `rgb()`/`rgba()`/`hsl()`/`hsla()`, or a theme token that resolves (e.g. `token:bull`, `token:info@band`);
  - the definition's own declared default is always accepted.

### `hooks/useUserDefinitions.js`

- New: `readUserDefinition(defId)` returns `{ok, row}` or `{ok:false, status, error}`. A `404` status means the definition is not live.

---

## 3. Request shapes (one op per request; the Agent keeps indicator ops sequential)

All ops take `ctx = {canManage, ownedDefinitionIds, registry, chartId, boardRevision?, volumeOpts?}`.

**`volumeOpts`** is new and matters only for the pane ops. Pass exactly what the chart's host passes to Chart Settings:
- `ChartPane`: `{volumeSeparatePane: true, blankVolume: false}`.
- Omitted: the settings-only answer.

**Pass the same `volumeOpts` at plan, apply, confirm and undo**, because it is part of the pane fingerprint.

| Op | Request | UI writer wrapped | Notes |
|---|---|---|---|
| `setAppearance` (I-1) | `{instanceId, key: 'lineWidth'\|'lineStyle'\|'overlap', value}` | `setInstanceAppearance` | Only the keys the definition declares in `meta.appearance`. `lineWidth` ∈ 1–4; `lineStyle` ∈ solid / dashed / dotted. |
| `setPlotStyle` (I-2) | `{instanceId, plotKey?, style}` | `setInstancePlotStyle` | Offers exactly what the Inspector menu offers (`engine/styleCapability.styleChoicesFor`). For several outputs, `plotKey` is required. |
| `setColor` (I-3) | `{instanceId, target: 'input:<key>'\|'sign:up'\|'sign:down', plotKey?, color \| hex}` | the settings rows' colour lane (`setInstanceInput` / `setIndicatorInput`), or `setInstanceCandleColor` for sign targets | A sign colour equal to the chart's candle colour deletes the key, so it follows the theme again. |
| `setDisplayTarget` (I-4) | `{instanceId, target}` | `setInstanceDisplayTarget` | `target` is one of the values `styleOptionsOf(...).displayTarget.options` lists, or `'auto'`. The preview lists the `guests` drawing inside the moved pane. |
| `movePane` (I-5) | `{paneKey, delta: ±1}` or `{paneKey, beforeKey: <paneKey>\|null}` | `movePane` / `movePaneTo` | "Move RSI above price" is `{paneKey: <rsi instanceId>, beforeKey: 'price'}`. `null` means the bottom. |
| `setPaneSize` (I-6) | `{paneKey, share: 0.04–0.9 \| null}` | `setPaneSize` / `clearPaneSize` | `null` means automatic. |
| `duplicate` (I-7) | `{instanceId}` | `duplicateInstance` | Creates a new identity and carries everything configured. Undo removes only the copy. |
| `copyFrom` (I-8) | `{sourceCs, instanceIds, sourceChartId?}` | `captureIndicatorTemplate(…, {onlyIds})` + `applyIndicatorTemplate` | Source links and shared panes between the copied indicators are re-pointed. An identical indicator already on the target is reported in `already`; if all of them are already there, the result is `no-change`. |

**Multi-chart.** `planAcrossCharts([{chartId, cs, ctx}], request | (chart) => request)` returns one result per chart:
- Each result is `{chartId, ok, plan}` or `{chartId, ok:false, reason, detail?}`.
- A chart that refuses does not stop the others.
- The Agent then applies, persists and confirms **each chart separately**, through that chart's own persist path. Each chart has its own Undo token.
- "Apply these indicators to all my charts" is a `copyFrom` request through `planAcrossCharts`.

**Choosing values.** Call `styleOptionsOf(cs, registry, instanceId)` before proposing. It lists the current value and the allowed options for:
- appearance;
- plot styles per output;
- colour targets;
- display targets.

Every listed value is one the ops accept.

---

## 4. Receipts, refusals and Undo

**Every confirmed receipt** (the old four ops included) now carries `instanceFingerprintAfter`, read from the persisted copy (I-12).

The new ops also add:
- `change: {what, …, before, after}`
- `paneKey` (pane ops)
- `copied` and `already` (copy)

**Refusals use only the existing `REASONS`.** New op failures map onto them as follows:

| Reason | When it is returned | `detail` |
|---|---|---|
| `bad-input` | A value outside the allowed set | `{why, options}` |
| `bad-request` | The output is ambiguous (missing `plotKey`), or a `movePane` is missing its destination | `plots` / `panes` |
| `no-change` | The value is already what was asked for | — |
| `changed-while-working` | Staleness | `what`: `indicator` / `panes` / `chart` / `definition` / `board` / `usage` |
| `restore-conflict` | Undo can no longer be exact | — |
| `dependent-exists` | Undo of a copy while something reads it, or a delete while a chart uses the definition | — |

**Undo is exact or refused:**
- **Style and pane ops** revert the recorded leaves, but only while the instance (or the pane stack) is exactly as the change left it.
- **duplicate and copyFrom** remove what they created, using the product's own delete.

---

## 5. `uct.indicators.definitions/1`

**Reads**
- `searchDefinitions(query, {registry, ownedDefinitionIds, limit?, kind?})`:
  - returns built-ins plus the member's own formulas, never another member's;
  - ranked by exact match, then prefix, then all query words.
- `describeDefinition(defId, ctx)` returns:
  - inputs (`inputSpecOf` shape) and outputs;
  - per-output `capabilities: {alert, scan}`, taken from the evaluability gate;
  - `copyable`.
- `findDefinitionUsage(defId, [{chartId, cs}], registry)`.

**Duplicate:** `{op:'duplicate', defId, inputs?}`
- Runs `definitionActions.createCustomCopy`, the "Create custom copy" verb that the legend and Inspector share:
  - a member's formula is forked on the server;
  - a built-in is copied as a formula if `copyVerdict` allows it.
- Confirmed by reading it back.
- The receipt carries `newDefId`.
- Before `mutation/1` will add the new definition to a chart, re-read `useUserDefinitions` so `ownedDefinitionIds` includes it.
- Undo soft-deletes the copy, and is refused while a chart named in `ctx.charts` draws it.

**Delete:** `{op:'delete', defId, allowInUse?}`, with `ctx.charts` set to every chart the Agent can see.
- Only for the member's own saved formula.
- Safe by default:
  - If a chart draws the definition, the result is `dependent-exists` with `{usage}`.
  - `allowInUse: true` is honoured only after the member has approved a proposal that listed that usage.
  - The usage is pinned at plan time and checked again at execution.
- Steps:
  1. Read the stored document first. If it cannot be read, nothing is deleted.
  2. Soft-delete through `deleteUserDefinition`.
  3. Confirm with a `404` read-back.
- Undo re-saves the exact document under the **same id**, using the server's documented resurrect-on-PUT.
  - Every chart instance that names that id draws again.
  - The Undo is refused if the id is already live.

**Discard an unsaved draft:** `discardDraft` from `authoring/1`, unchanged.

---

## 6. Integration steps for the Agent session

1. Rebase `feat/agent-p2ab-chart-control` on this branch once it merges. The Agent overlap freeze (§7.4) can lift for these files.
2. Add `volumeOpts` (from the host) and `boardRevision` to `mutationCtx` in `agent/capabilities/indicatorEdits.js`.
3. Add these wrapper actions, with manifest and golden updates:

   | Agent action | Op |
   |---|---|
   | `indicator.style` | `setAppearance` / `setPlotStyle` / `setColor` |
   | `indicator.moveTo` | `setDisplayTarget` |
   | `pane.move` | `movePane` |
   | `pane.resize` | `setPaneSize` |
   | `indicator.duplicate` | `duplicate` |
   | `indicator.copyTo` | `copyFrom` via `planAcrossCharts` |
   | `definition.search` / `describe` / `duplicate` / `delete` | `definitions/1` |

4. Replace `instanceByLength` with the structured `resolveIndicatorTarget` (I-10). Treat `ambiguous` as a clarifying question, using `detail.candidates`.
5. Add the binding-pin extension for `paneSizes` and `presentation`. You can use `instanceFingerprintAfter` and `paneFingerprint`.
6. Census: the new write paths are inside `agentMutations.js`, which already writes only through the census-listed writers. No new raw write.

---

## 7. Evidence

New contract suites:

| Suite | Tests | Covers |
|---|---|---|
| `builder/agentMutations.ext.test.js` | 32 | each op byte-for-byte against the UI writer it wraps; receipts; exact Undo; staleness; permission; multi-chart; I-10, I-11, I-12 |
| `builder/agentDefinitions.test.js` | 14 | search / describe / usage; duplicate / delete / undo against an in-memory server; I-13 colour rules |

Existing contract suites are unchanged and passing:
- `agentMutations`, `agentMutations.inputs`
- `agentSeams`, `agentAuthoring`
- `indicatorTemplates`, `settingsRecordParity`
- `agentPermission`, `agentPreview`

For the scoped regression run, see the PR description.

**UI refactors with no behaviour change:**
- `ChartSettingsIndicators.jsx` now imports `ohlcCapableFor` / `sourceCapabilityFor` from `engine/styleCapability.js`, moved verbatim.
- Its active-row filter is now `chartDataMap.activeIndicatorRows`, so the panel and `paneKeysOf` share one rule.
