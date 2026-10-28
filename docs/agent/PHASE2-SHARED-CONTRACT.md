# Agent ⇄ Indicators (and Charts) — Phase 2 shared interface contract

> **Status 2026-10-27 (Charts operator P1, `feat/agent-charts-operator-p1`):**
> - §4 — the two Undo histories stay SEPARATE (owner). The A1 integration tests (a)–(c) are now Agent suites: `app/src/agent/agentA1UndoCompat.test.jsx`.
> - §5 — done: `chart.resetDefaults` uses A1's `keepIndicatorState` (also `header.infoValues`); `keepOwned` is a thin alias of it.
> - §6 C-3 — done: `components/chart/drawingTools.js` exports `POINT_COUNT` (parity-tested against the overlay), `validateDrawing`, `drawingTimeFor`.
> - §3 (I-1…I-13) — still requested from Indicators; the Agent has built nothing against them (CHARTS-OPERATOR-PLAN Phase 2).

**Status:** PROPOSAL for the Indicators session to review and ACK, 2026-10-25. Written by the Agent session (P2-G).
**Basis:** origin/master `f0b4599b6f`; Indicators A1 = draft PR #325 (`feat/indicators-a1` `2928cfc55e`), read only, never checked out.
**Companion:** `docs/agent/PHASE2-CHART-CONTROL-AUDIT.md` (capability matrix, defects F1–F16, batches).
**Agent work this assumes:** local branch `feat/agent-p2ab-chart-control` (P2-A `f1d96fd100`, P2-B `25b48648d0`), not pushed.

Nothing in this document is implemented on the Indicators side. Every Indicators item below is a request; each needs an ACK, or a counter-proposal, before either side builds on it.

---

## 1. Ownership (unchanged from the audit, restated as the rule both sessions follow)

| Owner | Owns | Files |
|---|---|---|
| **Indicators** | calculation, rendering, panes (creation, order, sizes), indicator configuration and styling, Formula Builder and validation, indicator persistence, the indicator mutation and authoring contracts, the member's indicator Undo history (A1.2) | `components/chart/builder/**`, `components/chart/engine/**`, `ChartSettingsIndicators.jsx`, `ChartSettingsModal.jsx` (indicator rows, Restore Defaults after A1.3), `indicatorPreservation.js` (A1) |
| **Agent** | NL interpretation, routing and NL-1 selection, chart and object reference resolution, planning, approvals, receipts, the Agent's Undo stack, conversation memory, action schemas, context providers | `app/src/agent/**`, `api/services/uct_agent/**`, `api/routers/uct_agent.py` |
| **Charts workspace / drawing layer** (neither project) | the ChartWidget `agent` adapter, `ChartsWorkspace` `widgetOps`, `drawingsStore`, `ChartDrawingOverlay`, the Compare panel, chart settings descriptors | `pages/charts/**`, `components/chart/drawingsStore.js`, `components/chart/ChartDrawingOverlay.jsx`, `components/chart/chartSettingsDescriptors.js` |

**Rule:** the Agent never writes indicator state except through `uct.indicators.mutation/1` (or a whole-chart write that Indicators' control-door census lists). It never renders, evaluates a formula, or derives panes itself. Indicators never interprets language or plans multi-step work.

---

## 2. Frozen today: what both sides may rely on now (no change requested)

| Interface | Where | Used by the Agent for |
|---|---|---|
| `uct.indicators.mutation/1`: `planIndicatorMutation(cs, request, ctx)` → `applyIndicatorMutation(cs, plan, ctx)` → `confirmIndicatorMutation(persisted, pending, ctx)` → `undoIndicatorMutation(cs, undo, ctx)` | `builder/agentMutations.js:418/509/555/592` | `indicator.add/remove/update/show/hide` |
| `MUTATION_OPS = ['add','remove','setVisible','setInputs']`; `REASONS`; tokens are opaque JSON stamped with `contract` | `agentMutations.js:35/38` | refusal wording, staleness |
| `resolveIndicatorTarget(cs, registry, {instanceId \| name})` | `agentMutations.js:387` | instance addressing |
| `checkIndicatorPermission(op, args, ctx)`, `ctx = {canManage, ownedDefinitionIds, registry, chartId, boardRevision?}` | `agentMutations.js:363` | availability |
| `instancesOf(cs, registry)`, `instanceFingerprint(cs)`, `INDICATOR_OWNED_TOP_KEYS`, `seedFrom` | `builder/agentSeams.js` | context rows, approval binding |
| `catalogRows`, `inputSpecOf`, `checkInstanceInput(def, key, value)` | `engine/instanceControls.js:138/163` | the catalog the model sees; input checks |
| `uct.indicators.authoring/1` (`openDraft`, `draftTurn`, `saveDraft`, `showDraftPreview`, `draftUndo`) | `builder/agentAuthoring.js` | `indicator.draft/previewDraft/saveDraft/undoDraft` |
| Agent action schemas `indicator.add {defId, inputs}`, `remove {instance}`, `update {instance, inputs}`, `show`/`hide {instance}`, `openCreate {request, defId}` | `agent/capabilities/indicatorEdits.js`, `indicators.js` | the model's manifest (golden: `agent/contract/manifest.golden.json`) |

**Agent-side constraint added in P2-A (F4):** `indicator.add` and `indicator.update` now refuse any input the definition declares as `color`, `source` or `text`, *before* Indicators is asked. The Agent writes only `int | float | enum | bool`, which is what it advertises. Nothing changes on the Indicators side.

---

## 3. Requested from Indicators: new mutation ops (after A1 merges)

Every op uses the existing **plan → apply → confirm → undo** shape and the same token, `REASONS` and permission rules, and wraps the writer the UI already uses. One op per request; the Agent keeps running indicator ops `exclusive` + `sequential`.

| # | Op | Request shape | Wraps the UI's writer | Agent action it unblocks | Trader instruction |
|---|---|---|---|---|---|
| I-1 | `setAppearance` | `{instanceId, key: 'lineWidth'\|'lineStyle'\|'overlap', value}` | `setInstanceAppearance` (`instanceControls.js:994`) | `indicator.style` | "make the 20 thicker and dashed" |
| I-2 | `setPlotStyle` | `{instanceId, plotKey?, style}` | `setInstancePlotStyle` | `indicator.style` | "show MACD as a histogram" |
| I-3 | `setColor` | `{instanceId, target: 'input:<key>'\|'sign:<up\|down>', plotKey?, hex}`; hex validated; theme-colour → delete rule kept | `applyRowPatch` colour input / `setInstanceCandleColor` (`:813`) | `indicator.style` | "make the 9 green and the 20 red" |
| I-4 | `setDisplayTarget` | `{instanceId, target: 'pane'\|'volume'\|'price'\|'@<instanceId>'}` | `setInstanceDisplayTarget` (`:866`) | `indicator.moveTo` | "put RSI in its own pane", "overlay it on price" |
| I-5 | `movePane` | `{paneKey, beforeKey: string\|null}` or `{paneKey, delta: ±1}` | `movePaneTo` / `movePane` (`engine/paneOrder.js:166/182`) | `pane.move` | "move RSI above price" |
| I-6 | `setPaneSize` | `{paneKey, share}` | `setPaneSizes` (`engine/paneSizes.js`) | `pane.resize` | "make the RSI pane bigger" |
| I-7 | `duplicate` | `{instanceId}` | `duplicateInstance` (`:1088`) | `indicator.duplicate` | "add another one like that" |
| I-8 | `copyFrom` | `{sourceCs, instanceIds}`: exact copies with source links re-pointed, the template layer's rule | `addInstanceCopy` (`:1137`) | `indicator.copyTo` | "copy these indicators to the chart on the right" |

Supporting reads (pure, exported, no React):

| # | Read | Shape | Why |
|---|---|---|---|
| I-9 | `paneKeysOf(cs, registry)` | `[{paneKey, kind: 'price'\|'volume'\|'pane', ownerInstanceIds, label}]`, same derivation as `ChartSettingsIndicators.jsx:1305` | the Agent can name panes ("above price") without deriving them |
| I-10 | structured `resolveIndicatorTarget(cs, registry, {defId?, inputs?: {period, maType}, ordinal?})` | `{ok, instanceId}` or `{ok:false, reason: AMBIGUOUS, candidates}` | replaces the Agent's legend-regex `#<len>` lookup (`indicatorEdits.js` `instanceByLength`) |
| I-11 | `instancesOf` rows add `hiddenVia` (A1.1), built-in `defId` and current `inputs` | — | show/hide of a definition-hidden group; copy and "make it look like" |
| I-12 | `confirmIndicatorMutation` receipt adds `instanceFingerprintAfter` | — | follow-ups and the Agent's binding pin the post-change state |
| I-13 | `checkInstanceInput` validates `color` values (hex or a named theme colour) | — | today any string is stored (audit F4; the Agent no longer sends colours, but other doors could) |

**Agent side, once these exist:**
- Wrapper actions, with manifest and golden updates and NL-1 group placement.
- `ctx.boardRevision` passed from `mutationCtx` (`indicatorEdits.js:42`; never passed today).
- The approval binding extended to `paneSizes` and `presentation`.
- `indicator.add` gains an optional `placement {target?, beforePane?}`, after I-4, I-5 and I-9.

---

## 4. Undo: one canonical history (owner decision 5)

**Today, three histories can reverse one chart's indicators:**
1. The Agent's stack (`useAgent` `undoRef`, 20 entries, session-only, exact by fingerprint).
2. A1.2's member history (`indicatorHistoryStore`, keyed `chart:<chartId>`, depth 50, Ctrl+Z / toast). It records Settings-modal and StockChart-funnel changes, never Agent writes.
3. For drawings, `drawingsStore`'s per-symbol history, which Agent drawing writes also land in.

Each refuses on conflict (`changed-since` / `restore-conflict`), so nothing is corrupted. But a member's Ctrl+Z does not undo an Agent indicator change, and two buttons can describe one change.

**Proposed rule (needs Indicators' ACK; no Agent code until then):**

| Change | Canonical history | The other side |
|---|---|---|
| Indicator mutations (add / remove / setVisible / setInputs, and I-1…I-8) | **A1.2's history.** Each confirmed Agent mutation is recorded once, through `recordIndicatorChange(surfaceKey, before, after, {origin: 'agent', label})`, returning an entry id | The Agent's receipt keeps only that **id** and its Undo button calls `undoIndicatorChange(surfaceKey, {id})`. The Agent stack holds a pointer, never a second copy of the state. A member's Ctrl+Z undoes Agent changes too |
| Chart settings, timeframe, symbol, compare, view (not indicator state) | The Agent's stack (A1.2 does not cover these) | unchanged |
| Board / layout / watchlist / alert changes | The Agent's stack | unchanged |
| Drawings | `drawingsStore`'s history is the member's; the Agent's entry is by id (today) | **Open question for the drawing layer:** record-once by id, as for indicators |

**What Indicators would need to add for this:**
- `recordIndicatorChange` returns the entry id.
- `undoIndicatorChange(surfaceKey, {id})` undoes a *specific* entry, refusing `changed-since`.
- `peekIndicatorHistory` exposes `origin`.

Both stacks keep refusing on `changed-since`, and "Agent records never carry `granularity`" stays (A1.0 `settingsRecord`). **Until this is ACKed, the Agent keeps its own indicator Undo exactly as it is, with no duplicate recording.**

**Reconciled with Indicators' A1 integration report** (`integrate/indicators-a1-on-master` `8e31c7b6c8`, `docs/indicators/a1/A1-INTEGRATION-REPORT-2026-10-25.md` §3–§4; read only):
- Today's split is deliberate and safe:
  - Agent writes are never recorded on the member stack.
  - One record engine (`settingsRecord`) is shared.
  - On the same instance the later writer wins and the older Undo is refused.
  - NL-1 "undo that" only touches the Agent's stack.
- The proposal above is therefore a *unification request*, not a defect fix.

Before any Undo change, the Agent will add the three integration tests that report asks for. They need A1's code, so they come after A1 merges:
- **(a)** A waiting Agent proposal, then a member A1 Undo, then "do it" → fails closed on binding drift.
- **(b)** NL-1 "undo that" after a member A1 Undo → only the Agent's own entry is undone.
- **(c)** The 10-13 scratch tests (`C:/w/a1gc`) promoted into Agent suites.

Their report also notes an Agent robustness gap: a `/api/agent/turn` 200 response without `envelope` throws in `useAgent` (`env.disposition`). This is Agent-owned and queued for the next Agent batch. It is not in P2-A or P2-B.

The trial merge of `feat/agent-p2ab-chart-control` with that integration branch (`git merge-tree`) is clean: no conflicts, and A1 touches no `app/src/agent/**` file.

---

## 5. Restore Defaults (owner decision 3) — deferred to A1.3

- **Manual today (master):** `ChartSettingsModal.handleReset` writes a clone of `CHART_DEFAULTS`, wiping indicators.
- **Manual after A1.3:** `keepIndicatorState(JSON.parse(JSON.stringify(CHART_DEFAULTS)), settings)` (`indicatorPreservation.js`), which keeps indicators.
- **Agent `chart.resetDefaults` today:** clones `CHART_DEFAULTS` and carries indicator-owned keys over with its own `keepOwned`. This already matches A1.3's meaning, through a *second* implementation, and is always proposed.

**Requested:** A1 exports `keepIndicatorState` (or a `restoreDefaultsSettings(cs)` wrapper) as the one Restore. When A1 merges, the Agent replaces `keepOwned` with that call. A parity test then asserts the Agent's result equals the modal's for the same chart, and the census entry for `agent/capabilities/chart.js` is updated to name the shared helper.

I did not change the Agent to wipe indicators in the interim. It would contradict Indicators' census assertion (`controlDoorCensus.test.js`, "a Reset never stamps indicator state"), and A1.3 then reverses the manual meaning.

---

## 6. Charts / drawing-layer requests (no owner session today; via PRODUCT-HANDOFFS)

| # | Request | Why |
|---|---|---|
| C-1 | `CompareSymbolsPanel` enforces `MAX_COMPARISONS`, as `ComparisonPicker` does; export its entry builder | the panel can exceed the published ceiling of 5; the Agent re-implements the entry shape |
| C-2 | `chartSettingsDescriptors.js:133` maps `comparisonSymbols` to `chart.setSymbol` | stale; it is `chart.compare` |
| C-3 | Drawing layer exports `POINT_COUNT`, `validateDrawing(type, points)` and a real-time → display-time helper per timeframe | time-anchored Agent drawings (trendline, ray, rect, fib, text), batch P2-E2 |
| C-4 | `confirmDrawingsSynced` must learn the dark `/api/tracings` store before `TRACINGS_STORE_ENABLED` flips | otherwise every Agent drawing receipt says "not synced" and drops Undo |
| C-5 | Multi-Chart grid cells register an `agent` adapter | grid cells are invisible to the Agent ("all charts" cannot include them) |

---

## 7. Stability rules for both sessions

1. **Additive only:** a new op or a new field never changes an existing one's meaning. A breaking change bumps `mutation/1` → `/2`, and the Agent pins the version it supports.
2. **Golden manifest:** any Agent action-schema change regenerates `agent/contract/manifest.golden.json` (JS and Python read it) in the same PR.
3. **Census:** any new Agent write path to indicator state is added to `controlDoorCensus.test.js` *by Indicators*, with its reason.
4. **Overlap freeze until A1 merges:** the Agent does not edit `agentMutations.js`, `instanceControls.js`, `ChartWidget.jsx`, `ChartsWorkspace.jsx` or `ChartSettingsModal.jsx`. Indicators does not edit `app/src/agent/**`. (P2-A and P2-B kept to this.)
5. **Tests per new op:**
   - Indicators: op unit tests, UI-door parity.
   - Agent: plan → apply → read-back → Undo through the real panel, a stale-approval refusal, a dev-corpus case.
6. **No real-model evaluation** is implied by this contract; NL-1 stays off.

## 8. Asks, in order

1. ACK §2 (frozen) and §7 (rules).
2. Rule on §4 (Undo) and §5 (Restore Defaults helper).
3. Schedule I-3 + I-13 (colour), I-1 (appearance), I-9 + I-5 (pane order) first: they unblock the most-asked trader instructions ("make the 9 green", "thicker", "move RSI above price").
4. Then I-8 (copy) and I-10 to I-12.
