# A1 — Protect configured studies: implementation plan

- **Date:** 2026-10-13
- **Status:** **design only. Not authorised for implementation.** The owner approved preparing this plan, nothing more. No code, test or configuration was changed, nothing was committed or pushed, and no production system was read.
- **Code read at:** `C:/w/ia0`, branch `fix/indicators-a0-safety` = master `1eba7c105c` (read only; A0 is being implemented there).
  - Since PA3's baseline `4a368e80ed`, master changed only `app/src/agent/*` (10 files, breadth/open-chart work). **No file in this plan's change list moved**, so every PA3 line reference was re-checked and still holds unless corrected below.
- **Re-run at `C:/w/indaud`:** the PA3 probes plus three rails (`instanceControls.test`, `perInstanceDoor`, `controlDoorCensus`): **5 files, 74/74 passing** (read-only run).
- **Inputs:** `PHASE-A-DECISION.md` (§2.4, §3 batch A1, D3–D8), `PA3-visibility-and-undo.md`, WS3 G1–G4.
- **Paths:** relative to `app/src/` unless they start with `api/`, `tools/` or `.github/`.

### Corrections to the inputs found while verifying

| # | Input said | Code says (at `1eba7c105c`) | Effect on the plan |
|---|---|---|---|
| C1 | The Agent record format lives in `app/src/agent/agentMutations.js` | It lives in **`components/chart/builder/agentMutations.js`** (Indicators-owned). The Agent consumes it through `agent/capabilities/indicatorEdits.js:24` | A1 shares the *shape*, not the file (§3.1) |
| C2 | Region "Hide \<label\>" should hide "the instance(s) drawn in that pane" | Pane keys are **host instance ids** since P2.0c (`engine/paneLayout.js:347-366`), but StockChart maps them back to the **defId** before building the region (`StockChart.jsx:17177-17198`), so the menu cannot know which RSI was clicked | `chartRegion.js` must pass the host key through (3 lines, §1.4) |
| C3 | Share link: "replaces the recipient's own instance list" | Worse. The mount effect (`StockChart.jsx:6219-6265`) runs in **every** StockChart on the page and the `state` param is **never stripped**. A `/charts?state=…` link rewrites every chart widget, and does it again on every reload | Share apply becomes one-shot and single-target (§1.10) |
| C4 | Grid D4b is a chord problem | It is a **persist-boundary** problem. `GridChartCell` passes the first widget's *whole* settings as `settingsOverride` (`pages/charts/grid/GridChartCell.jsx:187-191`). `handleUpdateChartSettings` restores only *unchanged* top-level keys (`StockChart.jsx:5127-5132`), so **any** instance write in a cell (chord, chip hide, chip Delete) pushes widget-owned ids into the global blob | The fix sits at the persist boundary, plus a door guard (§1.12) |
| C5 | Agent `keepOwned` preserves every indicator-owned key | `INDICATOR_OWNED_TOP_KEYS` lists `'infoValues'` as a **top-level** key (`builder/agentSeams.js:30-33`), but info values are stored at **`header.infoValues`** (`engine/infoValues.js:20,51`). Agent `chart.resetDefaults` therefore resets header info values | A1's preservation helper carries `header.infoValues` explicitly. Reported to the Agent session (§5.3) |

---

## 0. Scope

**In A1** (from `PHASE-A-DECISION.md` §3, plus N1, N2, N3, N4, N5 and WS3 P2-2):

1. The hide/show model on every definition-level "off" door (D3).
2. The phone sheet's "Remove from chart" removes one instance.
3. "Remove all of X" exists only in Chart Settings, with an undo toast (D4).
4. Restore Defaults and presets keep indicators (D5).
5. Template and layout apply keep replace semantics, with undo.
6. Share-link apply asks first, with undo (D6).
7. An indicator undo stack (D7).
8. The unavailable-indicator notice.
9. Uninstalling deleted definitions in open tabs.

**Not in A1:**
- A0's items: the alert orphan sweep (N6), the CI vitest count (N10), the N9 depth check and the security rails.
- Restoring already-lost instances (D8: no automatic restore). The Version History restore tool (PA3 O8) is a separate decision.
- The Ctrl+Z arbiter with drawings (needs the drawing owner; D7 approved the toast-scoped fallback).
- Unifying the Agent's undo stack with this one (needs Agent sign-off; §5.3 defines the seam).
- Undo records for input, appearance, placement and pane edits (§3.3 explains why that is safe).

---

## 1. Final behaviour specification

### 1.1 The model

**Definition visibility.** A new pure reader in `engine/instanceControls.js`:

```js
definitionVisibility(cs, defId, flippedIds)
  → { state: 'absent' | 'shown' | 'hidden', live: number, visible: number, partial: boolean }
```

- **`absent`:** no live stored instance, and no live legacy projection.
- **`shown`:** at least one live instance is visible, **or** there is no stored instance but `isIndicatorEnabled` says the legacy projection draws (the crossover/mirror case, so P2b behaves as today).
- **`hidden`:** live instances exist and every one has `hidden === true`.
- **`partial`:** some visible and some hidden. For UI only.

`isIndicatorEnabled` keeps its current meaning, "a live instance exists". The migrator, the mirror, the toolbar count (`ChartToolbar.jsx:264-266,294`), the quick-menu "listed while on" filter and the volume-overlay offer all keep using it. **Only the toggle doors' checkmarks and their toggle direction switch to `definitionVisibility`.** Without that, a fully hidden RSI would read "on" and a click would hide it again, so the toggle would be stuck.

**The marker.** There is one new optional instance key, `hiddenVia: 'definition'`.
- It is meaningful **only** while `hidden === true`. A marker on a visible instance is inert, which is what makes it robust to F10 (the union merge cannot delete keys, `instanceShape.js:107-127`).
- No schema, migration or write-on-load change is needed. Old clients tolerate the key (§2.4).

**The writer.** `setIndicatorEnabled(cs, defId, enabled, registry)` keeps its signature and its name. Every door already routes through it, and the census counts its call sites (`controlDoorCensus.test.js:254-287`), so changing it in place fixes doors D1–D6 at once. Only the semantics change:

| Branch | Before (shipped, `instanceControls.js:315-348`) | After (A1) |
|---|---|---|
| **OFF**, ≥1 live instance | Every live instance → tombstone `{instanceId, deleted:true}`; `legacy:<id>` tombstone added; mirror `enabled:false`; dependents severed (`!@id`) and info values `severed:true` | Every live, **visible** instance of `defId` (expanded to its `group` members, as `setInstanceHidden` does) → `{...i, hidden:true, hiddenVia:'definition'}`. Instances the member already hid are untouched and keep **no** marker. **No tombstone, no sever, no mirror write.** Returns `cs` **by identity** when nothing was visible |
| **OFF**, 0 live instances (legacy projection only, P2b) | `legacy:<id>` tombstone, mirror false | **Unchanged.** Nothing is lost: the inputs live in the mirror, and the tombstone still blocks the migrator (`engine/instances.js:420-427`) |
| **ON**, all live instances hidden | (unreachable today: a hidden instance reads "on") | Unhide the instances marked `hiddenVia:'definition'` and delete the marker. If **none** is marked, unhide **all** live instances (the member asked to see RSI). The mirror is unchanged (already true). **No add** |
| **ON**, 0 live instances | Revive a live `legacy:<id>` or build one from the mirror | **Unchanged** |
| **ON**, ≥1 visible instance | Revive or build `legacy:<id>` (voice-bus "add RSI" can produce a second RSI) | **Unchanged.** A1 does not alter add semantics |

**Mirror rule:** `indicators[defId].enabled` keeps meaning "a live instance exists" (`removeInstance`'s rule, `instanceControls.js:405-428`). Hiding never writes it, as `setInstanceHidden` already documents (`:358-367`).

**Dependents** (decision O3, implied by D3's "dependents are kept"):
- **Not cascade-hidden.** A visible MA(RSI) keeps computing off a hidden RSI (`binder.js:1484-1516`).
- The info value reads "The indicator is hidden" (`infoValueResolve.js:141-143`).
- A pane whose host is hidden but which still holds a visible guest keeps its rectangle (`paneLayout.js:340-346`).

**Alerts** are untouched by hide or show, the shipped rule for the per-instance eye. Removing an instance tombstones it, and A0's tombstone-aware orphan detector then flags its alert.

**Companion writer changes** in `instanceControls.js`:

| Function | Change | Why |
|---|---|---|
| `setInstanceHidden` (`:369-379`) | Writes `hidden` **and deletes `hiddenVia`** on every targeted instance | A member's own hide or show supersedes a definition hide. Agent `setVisible` goes through here, so the Agent stays exact (its `changeRecord` sees the deletion as a leaf) |
| `duplicateInstance` (`:1088-1108`) | Also drops `hiddenVia` (it already drops `hidden`) | A visible copy must not carry a marker |
| `addInstanceCopy` (`:1137-1158`) | Drops `hiddenVia` from the body | Templates copy `hidden` but not the marker |
| **NEW** `removeDefinition(cs, defId, registry)` | The **old OFF branch, moved verbatim**: tombstone every live instance plus `legacy:<id>`, mirror false, sever | The only writer for D4's "Remove all N RSI" |
| **NEW** `setAveragesVisible(cs, visible, registry)` | Moving averages (live instances whose definition has `meta.appearance`): hide the visible ones with the marker, or show the marked ones (all of them if none is marked). Unadopted `cs.overlays` slots keep today's `enabled` flip (`StockChart.jsx:8915-8935`) | One writer for Ctrl+M and the right-click MA row (O4). Ctrl+M's second press becomes exact for instances |
| **NEW** `removeUnavailable(cs, instanceId, registry)` | Tombstones a stored record that does **not** normalize, then severs dependents and info values (the same tail as `removeInstance`) | `findInstance` refuses non-normalizing records, so `removeInstance` cannot reach them (§4) |
| **NEW** `repairInstance(cs, instanceId, registry)` | Deletes undeclared input keys, and resets invalid values by deleting the key (so the default applies). Everything else is kept. Refuses **by identity** if the result still would not validate | The §4 "Repair" action |
| Docstrings `:300-303`, `:357-367`, `:618-621`; `indicatorRegistry.js:497-514,935-941` | Rewritten | Two rationales are false today (PA3 §3): "per-DEFINITION at v1" and "Alt+Shift+I writes hidden" |

**Door helper.** Every toggle door computes the direction the same way:

```js
const off = definitionVisibility(cs, defId, ENGINE_OWNED).state === 'shown'
next = setIndicatorEnabled(cs, defId, !off, registry)
```

### 1.2 Per-door specification

**Legend:**
- Writers are in `engine/instanceControls.js` unless a path is given.
- "+H" means the door pushes an undo record (§3). "+T" means it also shows a toast.
- The three states are those of `definitionVisibility`.

| # | Door (file:line at `1eba7c105c`) | Before | After | Writer after | Record |
|---|---|---|---|---|---|
| **D1** | **Library row** click on an engine row (`IndicatorLibraryDialog.jsx:380-397` → `toggledRow` `:130-187`) | ticked row ⇒ delete-all; ON rebuilds one default | absent → **add** (unchanged); shown → **hide** (marker); hidden → **show** exactly. Checkmark: ✓ shown, ✓ with "◐ 2/3" when partial, **○ + "Hidden"** when hidden, blank when absent. `meta.addOnly` rows stay add-only (`:183-185`); built-in overlay, volume and carved-out branches unchanged | `toggledRow` → `setIndicatorEnabled(!off)` | +H; +T on hide ("RSI hidden (2) · Undo") |
| D1b | Library "+ Add another" (`:399-420`) | `addInstance` | unchanged. Shown on shown **and** hidden rows | `addInstance` | +H |
| **D2** | **Right-click → Indicators ▸ \<name\>** (`StockChart.jsx:5801-5836`) | tick off ⇒ delete-all | Same state machine as D1. `checked` = state `shown`; a hidden row shows the suffix " (hidden)". The quick-menu filter (`:5833`) keeps `isIndicatorEnabled` so a hidden definition is still listed and can be shown again | `setIndEnabled(key, state !== 'shown')` → `setIndicatorEnabled` | +H, +T on hide |
| **D2b** | **Right-click → Indicators ▸ MA** (`movingAverage`, `addOnly`) | unticking tombstones every average, defaults included (4 → 0) | **Hide/show all moving averages** (O4, recommended), the same writer as Ctrl+M. `checked` = any average visible. Any other `addOnly` definition (none today) is excluded from the submenu, as in the Library | `setAveragesVisible` | +H, +T "Moving averages hidden (4) · Undo" |
| **D3** | **Right-click on an indicator pane → "Hide \<label\>"** (`StockChart.jsx:5927`) | delete-all for the definition | Hides **only the pane's host instance** (`region.hostKey`, C2; its group members follow). Label: `Hide RSI`, or `Hide RSI (21)` when siblings exist (`instanceMenuSuffixes`). A visible guest (MA(RSI)) keeps drawing, and its pane stays (`paneLayout.js:340-346`). Without a host key (band mode, `resolveChartRegion`) it falls back to D2's **definition hide** — never a delete | `setInstanceHidden(cs, hostKey, true)`, else `setIndicatorEnabled(false)` | +H, +T "RSI hidden · Undo" |
| **D4** | **Ctrl+I / Ctrl+O / Ctrl+B / Alt+U** (`StockChart.jsx:8696-8700`, `:8746-8750`, `:8907-8908`; table `keyboardShortcuts.js:29-34`) | delete-all | Same state machine as D1. A toast **after every chord** (hide: "RSI hidden (2) · Undo"; show: "RSI shown (2) · Undo"; add: "RSI added · Undo"), because a chord is easy to fire by accident | `toggleIndicatorById` → `setIndicatorEnabled` | +H, +T |
| D4-M | **Ctrl+M** (`StockChart.jsx:8915-8935`) | hand-rolled list write; second press un-hides *all* averages | `setAveragesVisible`. The second press restores exactly the averages the first one hid | `setAveragesVisible` | +H, +T |
| **D4b** | Chords **in an active MultiChartGrid cell** (`GridChartCell.jsx:442` `hotkeysActive`) | first widget's ids written into global as tombstones; the cell then shows nothing (PA3 probe) | The door acts only on instances the **cell's writer owns**, i.e. ids present in `csBase.indicatorInstances` (global). If every targeted instance is override-owned, nothing is written and a toast says "RSI comes from your /charts chart — change it there". The persist-boundary filter (§1.12) is the backstop for every door | `setIndicatorEnabled` on the filtered view | +H (key `global`) |
| **D5** | **Phone ƒx Studies switch** / tap on the name of a row that is off (`MobileIndicatorSheet.jsx:221-227,274-300`) | delete-all | Same state machine as D1. `aria-checked` = shown. A hidden row shows " · hidden" (the existing `indNote` style) and the switch off; a tap shows it. A tap on the name of a shown or hidden row still opens the editor (`editable` keeps `isRowOn`) | `toggledRow` | +H, +T |
| **D6** | **Phone editor → "Remove from chart"** (`MobileIndicatorSheet.jsx:437-447`) | `toggleStudy` = delete-all, ignoring `editing.instanceId` | Removes **the instance the editor shows**: `editInstanceOf(editing.defId, editing.instanceId)` (`:182-188`). Label `Remove RSI (21)` when siblings exist | `removeInstance` | +H, +T "Removed RSI (21) · Undo" |
| P1 | Legend chip → Delete (`StockChart.jsx:5166-5168`) | `removeInstance`, one click, no confirm (owner ruling 2026-09-14) | Unchanged semantics. Now undoable | `removeInstance` via `writeInstance` | +H, +T |
| P3 | Legend chip eye; Settings row switch (`ChartSettingsIndicators.jsx:803-808`); per-instance dialog eye (`IndicatorSettingsDialog.jsx:281`) | `setInstanceHidden` | Unchanged, except the writer now drops `hiddenVia` | `setInstanceHidden` | +H (no toast) |
| **Settings list** | Chart Settings → Indicators: row ✕ / Inspector Remove (`ChartSettingsIndicators.jsx:846-870`) | per-instance `removeInstance`; P2b `setIndicatorEnabled(false)` | Unchanged semantics. **NEW (D4):** when ≥2 live instances of the row's definition exist, the Inspector's remove area gains a secondary **"Remove all 3 RSI"**. One click, **no confirm**, undo toast. This is the only member door to `removeDefinition`. Undo/Redo buttons in the panel header (§3.4). A muted **"Unavailable"** group at the bottom (§4) | `removeInstance` / `removeDefinition` | +H, +T |
| Settings add | Search "+" / `revivable` (`ChartSettingsIndicators.jsx:1247-1256`) | `toggledRow` when `legacy:<id>` is live (dead code, PA3 §1D) | Unchanged. The misleading `revivable` comment is corrected; behaviour stays. Still unreachable: `canAdd = !isRowOn` | — | +H on add |
| **Restore Defaults** | Chart Settings header, two-click "Confirm?" (`ChartSettingsModal.jsx:468-479`) | writes a clone of `CHART_DEFAULTS`: `indicatorInstances: []`, no tombstones | Writes `keepIndicatorState(clone(CHART_DEFAULTS), settings)` (§2.1). **Appearance resets; indicators, moving averages, pane order and sizes, volume overlays, the mirror and `header.infoValues` are kept.** Tooltip: "Resets chart appearance. Your indicators stay." | `keepIndicatorState` | +H, +T "Chart appearance reset · Undo" |
| **Presets** (Settings page) | `pages/Settings.jsx:542-551` | `PRESETS[k].settings` / `CHART_DEFAULTS` written whole | `keepIndicatorState(preset.settings, cs)` / `keepIndicatorState(CHART_DEFAULTS, cs)`. The `confirm()` text becomes "Reset chart appearance to defaults? Your indicators are kept." There is no chart surface here, so no record and no toast | `keepIndicatorState` | — |
| **Presets** (toolbar) | `ChartToolbar.jsx:296-299` (non-/charts surfaces) | whole preset written | `keepIndicatorState(preset.settings, cs)` | `keepIndicatorState` | +H, +T "Applied Light · Undo" |
| **Template apply** | Chart Settings → Templates (`ChartSettingsModal.jsx:457-462`); right-click → Chart template (`pages/charts/widgets/ChartWidget.jsx:463-467`) | `chartTemplateSettings(t)` replaces everything, indicators included | **Replace, unchanged** (integrator ruling 2026-10-11, `chartTemplateApply.js:15-22`; Agent parity `agentChartTemplateParity.test.jsx` must stay green). **Added:** a record and the toast "Applied template 'Swing' · Undo". `chartTemplateApply.js` is not edited | `chartTemplateSettings` | +H, +T |
| **Layout apply** | Open Layout / prebuilt (`pages/charts/ChartsWorkspace.jsx:2037-2113` `applyTemplate`; `uctDefaultChartSettings` `:311-317`) | replaces the board; widgets remount with new ids | **Replace, unchanged.** It opens a different board, and the outgoing *named* layout is already flushed (`flushNamedSaveRef`, `:2051`). **Added:** a workspace-level toast "Opened 'Swing board' · Undo" (§1.11). Not part of the per-surface stack, because widget ids change | `applyTemplate(snapshot, {skipFlush:true})` | workspace snapshot |
| **Share link** `?state=` | mount effect (`StockChart.jsx:6219-6265`) | every chart on the page replaces its list; re-applies on every reload (C3) | **One-shot, one chart, asks first** (§1.10, D6) | `applyShareIndicators` (pure, new) | +H, +T |
| **MultiChartGrid cell** | all per-instance doors in a cell (`GridChartCell.jsx:187-191`; `MultiChartGrid.jsx:491-497` modal edits global) | widget-owned ids leak into global (C4) | Doors refuse override-owned ids with the notice above. The persist boundary strips them (§1.12). The grid's shared modal still edits global only | as each door | key `global` |
| **Agent** `indicator.add/remove/setVisible` (`builder/agentMutations.js`) | own proposal, exact undo, 20 deep, in memory (`agent/useAgent.js:255,653-654,775-800`) | **Unchanged.** It uses `addInstance` / `removeInstance` / `setInstanceHidden` only (`agentMutations.js:22`), never `setIndicatorEnabled`. The only visible difference: `setVisible` now also clears `hiddenVia` (inert for Agent fixtures, which carry none) | unchanged | Agent stack (§5.3) |
| Agent `chart.applyTemplate` / `chart.resetDefaults` (`agent/capabilities/chart.js:633,646`) | template replaces (parity with click); reset keeps owned keys via `keepOwned` | **Unchanged.** Reset now also matches the button, except for C5 (`header.infoValues`), which is the Agent's to fix | — | Agent stack |
| Voice bus (`hooks/useChartIndicatorBus.js:79-90`) | `applyRowPatch(enabled:true)` → `setIndicatorEnabled(true)` | absent → add (unchanged); **hidden → show** (new branch); shown → unchanged | `setIndicatorEnabled(true)` | — (no surface key; writes through `setPrefMerged`) |
| `applyRowPatch(enabled:false)` (`indicatorRegistry.js:935-944`) | delete-all (latent; no shipped caller) | definition hide | `setIndicatorEnabled(false)` | — |
| Alt+Shift+I (`StockChart.jsx:15960,16011`) | session-only declutter | unchanged | — | — |

### 1.3 The Library row (D1), exactly

- **`isRowOn(row, settings)`** (`IndicatorLibraryDialog.jsx:117-123`) is **kept** with its "exists" meaning. `ChartSettingsIndicators`, the phone sheet's `extras` filter and the `addAnother` gate depend on it.
- **New export `rowVisibility(row, settings)`.**
  - Engine rows return `definitionVisibility(...)`.
  - Built-in and carved-out rows return `{state: isRowOn ? 'shown' : 'absent'}`.
- **`toggledRow`:** the last line (`:186`) becomes `setIndicatorEnabled(settings, row.id, rowVisibility(row, settings).state !== 'shown', registry)`. The overlay, volume, carved-out and `addOnly` branches are untouched.
- **Rendering (`:487-505`):**
  - `aria-selected` = shown;
  - the check span shows `✓`, `✓◐` with a `title="2 of 3 shown"`, or `○`;
  - a hidden row gets a `Hidden` pill (the existing `styles.pill`).
- **Identity guard (`:396`) unchanged.** Hiding a definition whose instances are all already hidden returns `settings` by identity, so nothing persists.

### 1.4 The pane menu (D3), exactly

1. **`chartRegion.js` `resolveChartRegionFromPanes` (`:101-145`):** each pane entry may carry `hostKey`. The indicator branch returns `{type:'indicator', key, hostKey: pane.hostKey ?? null}`. `chartRegion.test.js` asserts the module's exports, which are unchanged.
2. **`StockChart.jsx:17184-17190`:** `panes` entries become `{ key: defId, hostKey: p.key, height }`.
3. **`StockChart.jsx:5926-5928`:**
   - host = `region.hostKey` if `findInstance(cs, hostKey)`;
   - the item is `{ id:'i-hide', label: host?.hidden ? 'Show RSI…' : 'Hide RSI…', kind:'toggle', checked: !host?.hidden, onSelect: () => writeHidden(host) }`;
   - with no host: `setIndEnabled(key, definitionVisibility(...).state !== 'shown')`.

### 1.5 Moving averages (D2b, D4-M)

- `setAveragesVisible(cs, visible, registry)`:
  - The **instance part** is exact via the marker.
  - The **slot part** keeps today's `enabled` flip, and only for unadopted slots (`liveOverlayList`). Every `/charts` read already adopts slots (`maAdoption.js`), so this is legacy-only.
- **Direction:** `visible = !(anyAverageInstanceVisible || anyLiveSlotEnabled)`, i.e. today's `anyEnabled` test (`StockChart.jsx:8928-8929`).

### 1.6 The phone sheet (D5, D6)

- **Studies switch:** state from `rowVisibility`. A hidden row shows " · hidden" in `indNote`.
- **Remove from chart:** `const inst = editInstanceOf(editing.defId, editing.instanceId); if (inst) write(removeInstance(cs, inst.instanceId, engineRegistry))`. The label carries the sibling suffix.
- **Moving-average rows** are per slot already (`toggle(i)`) and are unchanged.
- **New prop:** `historyKey` (§3.2) only. The sheet needs no toast channel of its own: it pushes to the shared store, and the `StockChart` on the phone, which has the same key, renders the toast (§3.4).

### 1.7 "Remove all" (D4)

- Shown only in Chart Settings → Indicators, inside the open row's Inspector, below "Remove indicator", and only when ≥2 live instances of that definition exist.
- Text: **"Remove all 3 RSI"**. One click, no confirm (the owner's chip-Delete taste, `legend/chipMenu.js:89-98`). It writes `removeDefinition`.
- Record and toast: "Removed 3 RSI · Undo". Undo is byte-exact: the tombstones, the severed sources and info values, and the mirror all revert.

### 1.8 Restore Defaults and presets (D5)

- **`keepIndicatorState(next, prev)`** is new, in `components/chart/indicatorPreservation.js`. It is pure and Indicators-owned.
  - Returns a deep copy of `next` in which every key of **`INDICATOR_OWNED_TOP_KEYS`** (`builder/agentSeams.js:30-33`) is taken from `prev` when present, and removed when absent. `keepOwned` follows the same rule (`agent/capabilities/chart.js:267-274`).
  - **Plus** `header.infoValues` (C5), copied into `next.header` when `prev.header` has it.
- **Consequence to accept (D5):** presets stop resetting moving-average colours. `classic`, `oled`, `light` and `tradingview` each declare `overlays` (`chartDefaults.js:419-424,448-453`), and averages are indicators. The theme still changes canvas, candles, grid, crosshair and volume colours.
- **`PRESETS` and `CHART_DEFAULTS` are not edited.** `engineEnabledMigration.test.js:507-522` ("every preset still inherits `indicatorInstances` BY IDENTITY") stays true. The keep happens at the **apply site**.

### 1.9 Templates (unchanged semantics) and their undo

- `chartTemplateSettings` is not touched.
- The two click sites push a record before writing:
  - `ChartSettingsModal.applyTemplate`, through a new `onRecord` prop;
  - `ChartWidget.applyChartTemplate`, which pushes with its pane's key.
- Agent parity is preserved by construction.

### 1.10 Share links (D6, C3)

The replacement is a pure function, `applyShareIndicators(cs, decoded)`. It is the indicator half of today's `next` (`StockChart.jsx:6233-6248`): `severInfoValuesForInstanceSwap`, the `indicators` mirror merge and the `indicatorInstances` replace.

The mount effect becomes:
1. **Claim once per page load.** A module latch `claimShareState(encoded)` returns true for the **first** StockChart only. Today that is the first widget to mount, which in practice is the top-left chart. It then strips `state` with `history.replaceState(history.state, '', urlWithoutState)`; passing `history.state` keeps React Router's key and index. Every other StockChart on the page ignores the param.
2. **Apply the non-indicator half immediately, as today:** `chartType`, `heikinAshi`, `logScale`, `comparisonSymbols`, `markers`, symbol and timeframe.
3. **Indicator half:**
   - **Wait for preferences** (`usePreferences().loading === false`; `StockChart.jsx:2601` today reads only `prefs, setPref`).
   - If the recipient has **no live instance**, or its live list is canonically equal to the sender's, apply directly, with the toast "Using the shared chart's indicators · Undo".
   - Otherwise show an **in-chart prompt** (`role="dialog"`, non-modal, top of the chart): **"This shared chart has 3 indicators. [Use theirs] [Keep mine]"**.
     - *Use theirs* writes `applyShareIndicators`, with +H and +T.
     - *Keep mine*, Esc or closing writes nothing for indicators.
   - The prompt is ephemeral: it is not persisted and is not shown again after a reload, because the param has been stripped.
4. **Senders are unchanged** (`StockChart.jsx:6185-6215`).
   - Old links still decode.
   - A link carrying def-hidden instances arrives hidden. The marker travels inside the instance, so the recipient's "Show" works.

### 1.11 Layout apply undo (workspace-level)

- Before `commitBoard` (`ChartsWorkspace.jsx:2060`), `applyTemplate` captures a snapshot (in memory, one level deep):
  - the current `layoutRef.current`;
  - the five settings prefs it is about to overwrite (`chart_settings`, `watchlist_settings`, `theme_tracker_settings`, `fundamentals_settings`, `breadth_widget_settings`);
  - the watchlist columns;
  - `charts_theme`, `charts_vol_pane_pct` and `charts_active_template`.
- The toast "Opened '\<name\>' · Undo" stays for 10 s.
- Undo calls the same `applyTemplate` with a synthetic template `{scope:'user', layout:{...prevBoard, chartSettings, …}}` and `{skipFlush:true}`, the Version-History restore path (`:2048-2051`). It then restores the three standalone prefs.
- If `commitBoard` reports `conflict` (`:2024-2029`), the undo reports the existing conflict notice and does nothing.
- **This touches a shared workspace file.** It is a separately revertable commit (A1.3b), and the owner may defer it (§8, Q3).

### 1.12 Grid cells (N5, C4)

**Persist-boundary filter.** `handleUpdateChartSettings` (`StockChart.jsx:5126-5133`), on the `settingsOverride && !onSettingsPersist` path, calls a new pure helper `stripOverrideOwnedInstances(persisted, { base: csBase, view: cs, override: settingsOverride })`:
- An element whose `instanceId` appears in `override.indicatorInstances` and **not** in `base.indicatorInstances` is **dropped** from the persisted list.
- An element present in both is restored to `base`'s element unless the write changed it relative to `cs`, the `Object.is` rule `:5127-5132` already applies to top-level keys.
- Newly minted ids (in neither) persist to global, as today.
- The helper lives in `components/chart/indicatorPreservation.js`.

**Door guard.** The doors in StockChart (chords, chip, region, D2) call `isOverrideOwned(cs, id)`, built from the same three inputs. When every target is override-owned they show the toast "RSI comes from your /charts chart — change it there" and write nothing.

---

## 2. Workspace preservation

### 2.1 What "indicators" means for preservation

`INDICATOR_OWNED_TOP_KEYS` is the owner-declared list, held equal to the Agent's `OWNED_TOP_KEYS` by `agentSeams.test.js`:

```
indicatorInstances, indicators, overlays, paneOrder, paneSizes, paneSeriesOrder, volumeOverlayIndicators, infoValues
```

`keepIndicatorState` adds `header.infoValues` because of C5. It does **not** add the `infoValues` top-level key: none exists, and the merge would drop one (`chartDefaults.js:639-650`).

### 2.2 Replace versus merge

| Operation | Semantics | Why | Protection |
|---|---|---|---|
| Restore Defaults | **Look reset, indicators kept** | D5 | record + toast |
| Presets | **Look replaced, indicators kept** | D5 | record + toast (chart surfaces) |
| Chart template | **Replace** | Ruling 2026-10-11; "the template is the whole saved look INCLUDING its indicators"; Agent parity | record + toast |
| Layout | **Replace the board** | It is a different board; the previous *named* board is flushed first | workspace undo toast (§1.11) and Version History when armed |
| Share link | **Ask, then replace** | D6 | prompt + record + toast |
| Indicator template (flag off) | **Merge, add-only** (`addInstanceCopy`) | already non-destructive | unchanged |

No operation merges instance lists by union. That is right for the grid override only, and a union would resurrect the recipient's tombstones (`StockChart.jsx:6240-6243`).

### 2.3 No destructive migration

- **Nothing is rewritten on load.** No `settingsVersion` bump. No new required key.
  - `hiddenVia` is optional and written only by the definition door.
  - Undo history lives in `sessionStorage`, not in the blob.
- **The v1→v2 fold gets an additive fix** (PA3 D12, `chartDefaults.js:831-836`). `out.indicatorInstances = [...kept, ...dropped.map(d => d.inst), ...removed]` keeps unresolvable records raw instead of discarding them. The output is unchanged for every blob without a dropped record, so the pinned digests do not move.
- **Projection suppression** (§4.3) changes what is *drawn*, never what is stored.

### 2.4 Version skew (old tabs and new blobs; new tabs and old blobs)

The evidence is the PA3 probe (`hideModelPrototype.audit.test.js`, "old-client tolerance"; `paths.audit.test.js`, "version skew"), re-run green today, plus code reading at `1eba7c105c`:

| Situation | What happens | Evidence |
|---|---|---|
| Old tab reads a blob with def-hidden instances | It keeps them: `validateInstance` does not reject unknown instance keys, so `normalizeInstances` keeps both marked instances | probe; `engine/instances.js:581-726` |
| …draws them? | No. Hidden is removed, not parked | `hiddenIsRemovedNotParked.test.js`; `binder.js:1516`; `pool.js:970` |
| …double-draws via the legacy projection? | No. The mirror is still true, so a raw migrator projects a 4th `legacy:rsi`, but the old StockChart filter counts hidden instances (`StockChart.jsx:12048-12055`, "HIDDEN COUNTS"), and so does the old fold (`chartDefaults.js:795-822`) | probe |
| …legend | A hidden chip with an eye per instance. One click there unhides it (the old `setInstanceHidden` leaves an **inert** marker) | `StockChart.jsx:135-139` |
| …Library checkbox / chord | Reads **ticked** (`isIndicatorEnabled` counts hidden), so an old-tab click or chord runs the **old delete-all**. This is today's behaviour, not a regression; the window is one deploy cycle **per tab**, and a tab is refreshed only when it reloads or hits a stale chunk (`utils/staleChunk.js`) | probe |
| Old `duplicateInstance` on a marked instance | Copies the marker onto a **visible** copy: inert | `instanceControls.js:1096-1104` |
| Old tab writes the whole blob (last write wins) | Overwrites the new tab's latest state: today's cross-tab hazard (WS3 §D4), unchanged | `hooks/usePreferences.js:246-305` |
| Grid union with a stale marker (F10) | `{...prev, ...patch}` can re-attach `hiddenVia` to an instance the member later hid by hand. Def-show would then unhide that one too. A residual, grid-path only | `instanceShape.js:107-127` |
| New tab reads blobs tombstoned by the old OFF | `absent`; ON adds one default (D8: no auto-restore) | probe |
| Rollback (old code on post-A1 blobs) | §7.3 | — |

---

## 3. Undo

### 3.1 Data model (the record format shared with the Agent)

A new pure module, `components/chart/engine/indicatorHistory.js`, Indicators-owned. It is **the same shape** as the Agent's record (`builder/agentMutations.js:217-254`), `{contract, ids, paths:[{path, before, after} | {path, order:{before, after}}]}`, with three differences:

1. **Contract** `'uct.indicators.history/1'`. It is distinct from `MUTATION_CONTRACT` (`agentMutations.js:31`), so neither undo engine accepts the other's token by mistake.
2. **Element-granular paths** for `indicatorInstances`: `['indicatorInstances', {instanceId}]`, with the whole element as `before`/`after`. `before: undefined` means "absent before" (an add): undo **splices** the element out. `after: undefined` means "absent after".
   - Every other changed top-level key is one whole-value path (`['header']`, `['indicators']`, `['overlays']`, …). `{order}` records the instance id order.
   - **Reverting writes the stored `before` element verbatim, so the result is byte-identical.** The Agent's leaf `setAt` reorders keys (PA3 probe: value-exact, not byte-exact).
3. **Entry wrapper:**

```js
{ id, contract: 'uct.indicators.history/1', key /* surface */, label, kind /* 'hide'|'show'|'remove'|'removeAll'|'add'|'reset'|'preset'|'template'|'share'|'unavailable' */,
  origin /* chartId|null */, at /* ms */, settingsVersion: 2, record, bytes }
```

**API (pure):**
- `recordOf(before, after)` builds the record.
- `canApply(cs, record, 'undo'|'redo')` checks that every path holds its `after` (or `before`) value, compared **canonically**, so key order does not matter for the check, the way the Agent's `same()` works.
- `applyUndo(cs, record)` / `applyRedo(cs, record)` return `{ok:true, cs}` or `{ok:false, reason:'changed-since', detail:{path, label}}`. **Never partial.**
- **Byte-exactness is asserted after the persisted read** (`mergeChartSettings(JSON.stringify(x))`). `indicatorInstances` passes through raw (`chartDefaults.js:707`), so element bytes are preserved; the merge rebuilds everything else canonically.

**Agent compatibility (no Agent file is edited):**
- Records of the two formats can coexist on one chart: both are exactness-checked against the live `cs`.
- **Optional later step (S4, Agent sign-off):** `agentMutations.recordOf` calls `indicatorHistory.recordOf`, which makes Agent undo byte-exact too. The token stays `MUTATION_CONTRACT`.

### 3.2 Scope, depth, persistence

**Surface key:** `indicatorHistoryKey({ chartId, isolated })`.
- `isolated` (the surface has its own sink: `onSettingsPersist`, or `stored || onStore` in `useChartSurfaceSettings`) gives `chart:<chartId>`. `chartId` is `widgetId` or `widgetId:tabId` (`ChartWidget.jsx:101-103`; phone `MobileChartsApp.jsx:387,475`), so desktop main tab and phone share a key for the same blob.
- `isolated` with no `chartId` gives `mount:<useId>`, which does not survive a reload.
- Otherwise `global`: grid cells, standalone StockChart pages, the grid's shared modal.

**Store:** `components/chart/indicatorHistoryStore.js`, a module singleton with React hook `useIndicatorHistory(key)`.
- **Depth:** 50 per key, with redo. Redo is cleared on any new push.
- **Persistence:** `sessionStorage` under the **exact** key `uct.indicators.history.v1:<userId>:<surfaceKey>`.
  - Every access is in try/catch; memory-only on failure.
  - Cap 256 KB per key, dropping the oldest entry first. Total cap 2 MB across this prefix, evicting the least-recently-used key.
  - It never reads, iterates or removes keys outside the `uct.indicators.history.v1:` prefix (shared origin; memory rule "exact keys").
  - `userId` comes from `AuthContext`, so a sign-in as someone else in the same tab never sees the previous member's stack.
- An entry with another `contract` or `settingsVersion` is ignored on load.

**Which operations push.** Every row marked +H in §1.2:
- add, add another, duplicate;
- definition hide/show, instance hide/show, region hide, the moving-average toggle;
- remove one, remove all;
- Restore Defaults, presets on chart surfaces, template apply, share apply;
- unavailable Remove and Repair.

### 3.3 Not recorded in A1, and why that is safe

Input, appearance, placement, display-target, calculation-timeframe, visibility, pane-order and pane-size edits are not recorded. They are about 25 writer sites across `IndicatorSettingsDialog`, the Inspector and pane drags. Recording them is a follow-up.

**Safety:** a record touches only its own elements and keys. An unrecorded edit to an unrelated instance does not block undo. An unrecorded edit to the **same** element refuses it with "Can't undo: RSI (21) changed since". It is never partial and never clobbers.

### 3.4 UI

**Toast:** `components/chart/IndicatorUndoToast.jsx`.
- **Mount:** one in StockChart, beside the existing `chartToast` (`StockChart.jsx:15969-15975`). It renders when the newest entry for its key has a toast and either `entry.origin === chartId`, or `origin == null` and this StockChart is the first mounted instance for the key.
- **Behaviour:**
  - shown for 8 s, paused on hover or focus;
  - `role="status"`, `aria-live="polite"`; an **Undo** button; × dismisses; Esc dismisses when focused;
  - a new entry replaces the visible toast (older entries stay on the stack);
  - after Undo it changes to "Undone · Redo" for 5 s.
- **Copy:** listed per door in §1.2.
- **Refusal:** "Can't undo: \<label\> changed since." It is shown in the same toast, and nothing is written.

**Panel buttons:** Undo and Redo icon buttons in the Chart Settings → Indicators header (`ChartSettingsIndicators.jsx`) and the phone ƒx sheet header.
- The tooltip and `aria-label` name the entry: "Undo: hide RSI (2)".
- They are disabled when there is nothing to undo.
- They write through the host's own sink: `onChange` in Settings, `onWrite` on the phone, `handleUpdateChartSettings` for the toast.

### 3.5 Ctrl+Z policy (pending the drawing owner)

- **Today:** `ChartDrawingOverlay.jsx:2754-2759` handles Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z on **window, bubble phase** (`:2816`).
- **A1 (D7 fallback, no drawing file touched):** while an indicator toast is visible, `IndicatorUndoToast` registers a **window capture-phase** `keydown` listener.
  - On Ctrl/Cmd+Z it runs the indicator undo, then calls `preventDefault()` and `stopImmediatePropagation()`.
  - On Ctrl+Shift+Z or Ctrl+Y it runs redo, only while "Undone · Redo" is showing.
  - It **does not act** when the target is INPUT, TEXTAREA, SELECT or contentEditable, or when `isModalOpen(e.target)`. Native text undo and the builder win.
  - With no toast visible there is no listener, so drawing undo is exactly as today.
- **Later (needs the drawing session):** a per-surface arbiter. The store exposes `lastAt(key)` for it. Drawings would need `at` stamps in `drawingsStore.js` (`:31,138,257`).

### 3.6 Cross-tab behaviour

- **History is per tab.** `sessionStorage` is per tab; a browser "Duplicate tab" copies it, and the exactness check against that tab's own `cs` keeps a copied stack honest.
- **Undo is an ordinary write** through the surface's sink. With the store dark it is last-write-wins, exactly like every other write (WS3 §D4). With the store armed, a stale tab gets the existing 409 / frozen-key behaviour, and the undo fails loudly through the existing notice.
- **No cross-tab undo.** Another tab's change makes this tab's records refuse once this tab sees the new `cs`. Until then, last-write-wins applies.

---

## 4. Unavailable-indicator notice

### 4.1 The reader

A new pure module, `components/chart/engine/unavailableInstances.js`:

```js
unavailableInstances(cs, registry, { userDefsReady, storeDefIds, installErrors })
  → [{ instanceId, defId, reason, name, keys?, detail }]
```

- **Input:** the **stored** list (`cs.indicatorInstances`; `csView` would include previews). Take the non-tombstone objects with a string `instanceId` that `normalizeInstances(...).dropped` rejects.
- **Excluded:** the studio preview id (`STUDIO_PREVIEW_DEF_ID`) and economic companions (`econp:`), which never reach storage anyway.
- **Classification.** It is computed here and **does not edit `engine/instances.js`**, which may be A2's:
  - `definition-pending`: the `defId` does not resolve, starts with `u_`, and `userDefsReady === false`. **Not shown.** This avoids the false flash before SWR installs (`StockChart.jsx:3395-3427`).
  - `definition-refused`: the `defId` does not resolve but `storeDefIds.has(defId)`, i.e. the store has it and today's gates refused it.
  - `definition-missing`: the `defId` does not resolve and the store does not have it (deleted, never installed here, another member's), or it is a native id that no longer exists.
  - `input-removed`: an input key the definition does not declare (`keys` listed).
  - `input-invalid`: a declared key whose value fails `checkInstanceInput` (`instanceControls.js:163-175`).
  - `malformed`: anything else.
- **Name:** `display.name`, else the definition's `meta.name`, else the store row's name, else `Formula u_…`.

### 4.2 The surfaces

- **Legend placeholder chip** at the end of the strip: **"⚠ 2 indicators can't be shown"**. It opens a popover with one row per record (component `components/chart/UnavailableIndicators.jsx`).
- **Chart Settings → Indicators:** a muted "Unavailable" group at the bottom, using the same rows.
- **Phone ƒx sheet:** the same group, at the bottom.

| Reason | Sentence | Actions |
|---|---|---|
| `definition-missing` | "This formula was deleted or isn't installed on this account." | **Remove** · **Keep** · *Restore formula* (only if O9 is approved, §8) |
| `definition-refused` | "This formula no longer passes checks: \<first install error sentence\>." | **Open in Builder** (where the host offers an edit launcher; absent otherwise) · Remove · Keep |
| `input-removed` | "This indicator's setting \<key\> no longer exists." | **Repair** (`repairInstance`) · Remove |
| `input-invalid` | "\<key\> = \<v\> is out of range (\<min\>–\<max\>)." | **Repair** (resets that key to its default) · Remove |
| `malformed` | "This saved indicator is damaged." | Remove · **Copy details** |

**Action rules:**
- **Remove** = `removeUnavailable`, with +H and +T.
- **Repair** = `repairInstance`, with +H and +T. It is refused by identity if the record would still not validate, and the row then says so.
- **Keep** dismisses the record for this tab: `sessionStorage` key `uct.indicators.unavailable.dismissed.v1:<surfaceKey>`, a list of instance ids. The record stays in the blob.

### 4.3 Projection suppression (stop substitution)

- **Where:** `StockChart.jsx:12053-12055` and the v1 fold (`chartDefaults.js:818-822`). The `liveStoredDefIds` set also counts the `defId` of every **dropped stored record** whose `defId` is a string.
- **What it changes:** a definition with a broken stored instance no longer gets a **default** `legacy:<defId>` drawn under the same name (PA3 §6.1). The member sees the notice instead.
- **Visible change:** a member currently looking at a substituted default RSI sees it disappear, with a notice and a one-click Repair. This is §8 Q5.

### 4.4 Uninstalling deleted definitions in open tabs (WS3 P2-2)

**`hooks/useUserDefinitions.js` `useInstalledUserDefinitions` (`:343-391`):**
- A module-level set `_fromStore` records the ids installed **from a store response**.
- On a response that is **authoritative and successful** (`data` present and `error` null), every id in `_fromStore` that is absent from the new rows is removed with `uninstallUserDefinition` (`engine/nativeRegistry.js:3937-3942`). `_fromStore` is then replaced.
- It **never** uninstalls on a transport error, a 5xx, while loading, or on ids installed by other paths. That covers BuilderSheet's post-save install and previews: an id enters `_fromStore` only when a store response contains it, so a stale in-flight response cannot evict a just-saved formula. The 401/402/403 `clearUserDefinitions` path is unchanged.
- **New return field:** `storeDefIds`, the ids present in the response, which feeds `definition-refused`.

**Other open tabs.**
- After a successful `saveUserDefinition`, `deleteUserDefinition` or `forkUserDefinition`, the tab posts `{type:'user-definitions-changed'}` on `BroadcastChannel('uct.user-definitions')`. This is guarded, so it is a no-op where `BroadcastChannel` is absent.
- Every tab's hook listens and calls `mutate(USER_DEFINITIONS_KEY)`. The revalidation is exactly what the deleting tab already does (`:430-434`).

**Effect:** the deleted formula's instance stops drawing in every open tab and shows as `definition-missing`. Alerts are server-side and unaffected (A0's detector flags them).

---

## 5. File ownership and integration boundaries

### 5.1 Files A1 modifies (verified at `1eba7c105c`)

**Indicators-owned (A1 is the only writer):**

| File | Functions / sites touched | ≈ size |
|---|---|---|
| `components/chart/engine/instanceControls.js` | `setIndicatorEnabled` (`:315-348`), `setInstanceHidden` (`:369-379`), `duplicateInstance` (`:1088-1108`), `addInstanceCopy` (`:1137-1158`), docstrings `:300-303,:357-367,:618-621`; **new** `definitionVisibility`, `removeDefinition`, `setAveragesVisible`, `removeUnavailable`, `repairInstance` | +200 / −25 |
| `components/chart/engine/indicatorHistory.js` **(new)** | `recordOf`, `canApply`, `applyUndo`, `applyRedo` | ~220 |
| `components/chart/indicatorHistoryStore.js` **(new)** | `push`, `undo`, `redo`, `peek`, `lastAt`, `subscribe`, `useIndicatorHistory`, `indicatorHistoryKey`, sessionStorage I/O | ~220 |
| `components/chart/indicatorPreservation.js` **(new)** | `keepIndicatorState`, `stripOverrideOwnedInstances`, `isOverrideOwned`, `applyShareIndicators`, `claimShareState` | ~150 |
| `components/chart/engine/unavailableInstances.js` **(new)** | `unavailableInstances` | ~160 |
| `components/chart/IndicatorUndoToast.jsx` + `.module.css` **(new)** | toast, capture-phase Ctrl+Z | ~140 |
| `components/chart/UnavailableIndicators.jsx` + `.module.css` **(new)** | chip, popover, settings/phone group | ~240 |
| `components/chart/IndicatorLibraryDialog.jsx` | `toggledRow` (`:186`), **new** `rowVisibility`, `toggle` (`:380-397`, history push), row render (`:487-505`), new prop `historyKey` | +60 |
| `components/chart/ChartSettingsIndicators.jsx` | `removeRow` (`:846-870`, push), `setRowVisible` (`:803-808`, push), Inspector "Remove all N", header Undo/Redo, Unavailable group, `revivable` comment (`:1247`) | +110 |
| `components/chart/indicatorRegistry.js` | comments only (`:497-514,:935-941`) | ±15 |
| `components/chart/chartRegion.js` | `resolveChartRegionFromPanes` returns `hostKey` (`:136-138`) | +3 |
| `components/chart/chartDefaults.js` | v1 fold keeps `dropped` and suppresses projection (`:818-836`). **`CHART_DEFAULTS` and `PRESETS` untouched** | +10 |

**Shared with other active workstreams:**

| File | Owner(s) | A1 sites | ≈ size |
|---|---|---|---|
| `components/StockChart.jsx` | chart, **drawing session**, Agent | (a) region hide `:5926-5928` + pane `hostKey` `:17184-17190`; (b) `indEnabled`/`setIndEnabled` direction + MA row `:5801-5836`; (c) `toggleIndicatorById` `:8696-8700` direction + push + toast; (d) Ctrl+M `:8915-8935` → `setAveragesVisible`; (e) `writeInstance` `:5150-5152` push; (f) persist filter in `handleUpdateChartSettings` `:5126-5133`; (g) share effect `:6219-6265` + `loading` from `usePreferences` `:2601`; (h) unavailable feed + projection suppression near `:12053-12064`; (i) `<IndicatorUndoToast>` + `historyKey` near `:15969`; pass `historyKey` to the toolbar | +170 / −40, nine localized hunks; **no drawing code touched** |
| `components/chart/ChartSettingsModal.jsx` | chart settings (Agent reads) | `handleReset` `:468-479` → `keepIndicatorState`; `applyTemplate` `:457-462` push; pass `historyKey` | +25 |
| `components/chart/ChartToolbar.jsx` | chart | `applyPreset` `:296-299`; pass `historyKey` to `IndicatorLibraryDialog` (`:1818`) | +8 |
| `components/chart/pane/ChartPane.jsx` | chart, **Agent** (`:836`) | pass `historyKey` to `ChartSettingsModal` (`:1149-1162`) | +4 |
| `pages/charts/widgets/ChartWidget.jsx` | workspace, Agent | `applyChartTemplate` `:463-467` push | +6 |
| `pages/charts/ChartsWorkspace.jsx` | workspace, **Agent Context** | `applyTemplate` snapshot + undo toast (§1.11), commit A1.3b | +70 |
| `pages/charts/mobile/MobileIndicatorSheet.jsx` | **mobile** | Studies three-state, Remove-from-chart, push, header Undo/Redo, Unavailable group, `historyKey` prop | +60 |
| `pages/charts/mobile/MobileChartsApp.jsx` | **mobile** | pass `historyKey` (`:568-577`) | +2 |
| `pages/Settings.jsx` | settings page | `applyPreset` / `resetToDefaults` `:542-551` | +8 |
| `hooks/useUserDefinitions.js` | Indicators builder, **possibly A2** (one-click STOC re-import uses the save door) | `useInstalledUserDefinitions` uninstall + `storeDefIds`; BroadcastChannel on save/delete/fork | +55 |

**Explicitly not modified:**
- `chartTemplateApply.js` and `builder/agentMutations.js`;
- `agent/*`, including `chart.js`;
- `engine/instances.js` and `engine/nativeRegistry.js`;
- `ChartDrawingOverlay.jsx` and `drawingsStore.js`;
- `GridChartCell.jsx` and `MultiChartGrid.jsx`;
- `keyboardShortcuts.js` (key table unchanged);
- every A0 file;
- every backend file.

### 5.2 A0's files: none overlap

A0 owns:
- `api/services/user_definitions.py` and `tools/ast_conformance.py`;
- the fixtures in `tests/test_compute_graph.py`, `test_param_manifest.py`, `test_param_repaste_c46.py` and `test_graph_wire_size.py`;
- `.github/workflows/*`;
- the new read-only orphan-alert and stale-screen-subscription detectors and their tests.

A1 touches **none** of them and **no backend file at all**.

**Dependencies on A0:**
- the **N10** fix (a non-zero vitest count in `full-suite-report.yml`), so A1's new rails are actually run in CI;
- the **N6** orphan semantics ("a tombstone counts as missing"), which A1's explicit removals rely on for alert hygiene.

### 5.3 Integration contracts

**Drawing session** (`StockChart.jsx`, `ChartDrawingOverlay.jsx`, `drawingsStore.js`):
- A1's StockChart hunks are the nine sites in §5.1. None is in drawing code, the drawing context menu, `useChartDrawings` (`:6266`) or drawing keyboard handling.
- Ctrl+Z: A1 adds only a window **capture** listener that exists **only while an indicator toast is visible**, and that never acts in text fields or modals. With no toast, Ctrl+Z reaches `ChartDrawingOverlay.jsx:2758` exactly as today.
- Future arbiter interface (S4): `indicatorHistoryStore.lastAt(surfaceKey) → ms|null`. Drawings would add `at` to `past` entries. Neither side imports the other's store.

**Agent sessions** (`agent/*`, `ChartPane.jsx`, `builder/agentMutations.js`, `builder/agentSeams.js`):
- No Agent file changes. `setIndicatorEnabled`'s new semantics do not reach the Agent: it never calls it (`agentMutations.js:22`).
- `setInstanceHidden` now clears `hiddenVia`. Agent `setVisible` records see one extra leaf deletion only when a marker existed, and its exact undo restores it.
- The Agent's `IndicatorSummary.hidden` / `enabled` (`agentSeams.js:44-58`) report def-hidden instances as `hidden:true, enabled:false`, which is correct.
- `agentChartTemplateParity.test.jsx` must stay green: the click path adds a record, never different settings.
- **C5 is for the Agent session:** `chart.resetDefaults` loses `header.infoValues`. The fix is either `keepOwned` → `keepIndicatorState`, or adding the sub-path. A1 does not edit Agent files.
- Stack unification is S4: the Agent pushes a confirmed mutation into `indicatorHistoryStore.push('chart:'+ctx.chartId, {kind:'agent', label:'UCT Intelligence: added EMA 20', record})`, with "consumed" marking on both sides.

**Chart settings** (`ChartSettingsModal.jsx`):
- New optional props `historyKey` and `onRecord`.
- With the props absent (`MultiChartGrid.jsx:491-497`) the modal falls back to `historyKey='global'`.

**Mobile** (`MobileIndicatorSheet.jsx`, `MobileChartsApp.jsx`):
- New optional prop `historyKey`. Without it the sheet keeps working with no undo UI.
- `MobileChartsApp.landing.test.jsx` covers the landing.

**A2:**
- A1 owns `toggledRow`, `isRowOn`, `rowVisibility` and the row check span in `IndicatorLibraryDialog.jsx`. Any A2 badge renders as a sibling element in the title row.
- In `useUserDefinitions.js`, A1 owns `useInstalledUserDefinitions` and the BroadcastChannel post, appended **after** the existing `mutate` calls. A2 owns any change to `saveUserDefinition`'s request body or response.
- If A2's STOC legacy acceptance were missing, refused STOC definitions would surface as `definition-refused` in A1's notice instead of vanishing. A1 is a safety net for A2, not a dependency.
- A2 must not make an installed definition refuse without that being intended. A1's notice will show it.

### 5.4 Merge order

1. **A0** lands first: the rails it repairs guard A1's area, and N10 makes A1's tests count.
2. **A1** lands as four commits, each separately revertable, in this order:
   - **A1.1** writer + reader + doors + grid filter + rail updates;
   - **A1.2** history module, store, toasts, panel buttons, toast-scoped Ctrl+Z;
   - **A1.3** bulk preservation (Restore Defaults, presets), template records, share-link one-shot + prompt. **A1.3b** layout undo (`ChartsWorkspace.jsx`);
   - **A1.4** unavailable notice, Repair/Remove writers, projection suppression, v1-fold fix, uninstall-on-absence + BroadcastChannel.
3. **A2** runs in parallel on different files. Whichever of A1 and A2 merges second rebases. The expected overlap is `useUserDefinitions.js` and possibly `IndicatorLibraryDialog.jsx`, with the boundaries above.
4. **Drawing and Agent sessions:**
   - rebase any in-flight `StockChart.jsx` work onto A1.1/A1.2 (nine small hunks);
   - the Agent session picks up C5 on its own branch.

---

## 6. Test plan

### 6.1 Rails that change (verified against current files)

Every change is deliberate, carries its reason in the test, and none is weakened.

| Test (path:line at `1eba7c105c`) | Pins today | Change | Reason |
|---|---|---|---|
| `components/chart/engine/instanceControls.test.js:88` "turning one OFF writes a TOMBSTONE" and `:107` "OFF tombstones EVERY live instance" | OFF tombstones | Rewrite: OFF hides and marks visible instances. OFF with no live instance tombstones `legacy:<id>` (kept). Same assertions moved onto `removeDefinition` | D3 |
| `instanceControls.test.js:354` "a HIDDEN instance still counts as enabled" | `isIndicatorEnabled` counts hidden | Assertion **kept**, reason rewritten ("exists", not Alt+Shift+I). Add `definitionVisibility` cases | False rationale (PA3 §3) |
| `engine/__tests__/perInstanceDoor.test.js:143` "the per-DEFINITION door still tombstones EVERY instance — unchanged contract", `:165` "DIVERGE…" | delete-all contract | Invert: the definition door hides and removes none. The divergence becomes hide versus remove; `removeDefinition` keeps the old contract | D3/D4 |
| `engine/__tests__/controlDoorCensus.test.js:496-540` "the four B4 surfaces all move the MIRROR", including "an OFF mirror still projected" | OFF ⇒ mirror false ⇒ no projection | For a fresh `on`, OFF = **hide** keeps the mirror true and the round trip still projects (hidden instance present). The "OFF mirror" assertion moves to `removeDefinition` | Mirror = "exists" |
| `controlDoorCensus.test.js:254-287` call-site census (`callers.length === 4`) | four files call `setIndicatorEnabled` / `setIndicatorInput` | **Stays 4.** A1 keeps every door on `setIndicatorEnabled`. `CALL_SITES` reasons are re-worded | — |
| `controlDoorCensus.test.js:613+` door EIGHT `LEDGER` | per-instance callers | Add `MobileIndicatorSheet.jsx` (`removeInstance`, D6), and StockChart's new `setInstanceHidden` use (region hide). Add `removeDefinition`, `setAveragesVisible`, `removeUnavailable` and `repairInstance` to `DOORS`, with their callers (`ChartSettingsIndicators.jsx`, `StockChart.jsx`, `UnavailableIndicators.jsx`) | New callers |
| `controlDoorCensus.test.js:208-250` `BULK_BLOB_SITES` | reasons for whole-blob sites | Same files still match the regex (the reset still clones `CHART_DEFAULTS`). Reasons updated: "kept through `keepIndicatorState`" | D5 |
| `controlDoorCensus.test.js:463` "ChartSettingsModal's reset clones the LIVE default" | the clone exists | Unchanged: the clone is still there, now wrapped | — |
| `engine/__tests__/stockChartWiring.test.jsx` — 14 `setIndicatorEnabled(…false)` sites (`:2019,2145,2582,2619,3245,3740,5106,5135,5491,5520,5559,5923,5964,6004`); `:2003` "…never leaves TWO RSI lines"; `:2236` "a TOMBSTONE releases the band"; `:2288` "Ctrl+I hides…"; `:2543` Ctrl+B; `:2570`; `:3200` Ctrl+O; `:3237`; `:3734` | chords and off delete; off/on yields one series | Keep "never two series". Add "off/on restores RSI(7) and RSI(21) byte-identical". `:2236` becomes "a HIDDEN instance releases the band". `:2288` and siblings assert `hidden:true, hiddenVia:'definition'` and a toast | D3 |
| `engine/__tests__/instanceInputSurvivesTheMirror.test.js` | a `legacy:` input survives off/on through the mirror | Still passes. **Add** the `inst:` case (fails today, WS3 probe2) | — |
| `engine/__truth__/p2x.sourceref.truth.test.js`, `engine/__tests__/infoValuesPersistence.test.js`, `engine/__truth__/p2.ui.truth.test.js` | the definition-off door severs | Severing stays for remove and `removeDefinition`. Definition-off leaves `@…` and info values unsevered | O3 |
| `engine/__tests__/legendFromDefinitions.test.jsx`, `engine/__tests__/flipB.test.jsx`, `engine/__truth__/p0.save.truth.test.js`, `pages/charts/mobile/MobileChartsApp.landing.test.jsx` | off drops the chip or series | A hidden chip is listed (already true for per-instance hides) | D3 |
| `components/chart/IndicatorLibraryDialog.test.jsx` | row toggles via `toggledRow` | three-state checkmark; hide/show exactness; `addOnly` unchanged | D1 |
| `pages/charts/mobile/MobileIndicatorSheet.studies.test.jsx` | switch toggles via `toggledRow` | three-state; "Remove from chart" removes only the edited instance | D5/D6 |
| `components/chart/__tests__/addDoorIdentity.test.js` | `toggledRow` add identity | Unchanged (add path) — must stay green | — |
| `engine/__tests__/engineEnabledMigration.test.js:507-522` | presets inherit `indicatorInstances` by identity | Unchanged — must stay green (PRESETS not edited) | D5 |
| `agent/agentBatch6.test.jsx:78-114` (`keepOwned`), `agent/agentChartTemplateParity.test.jsx` | Agent reset/template | Unchanged — must stay green | parity |
| `components/chart/chartRegion.test.js` | exports only the resolver | Add `hostKey` pass-through cases | C2 |
| `components/chart/engine/__tests__/hiddenIsRemovedNotParked.test.js` | hidden = removed | Unchanged; it is the pixel gate | — |

**Estimate:** about 17 existing files change, against PA3's estimate of about 12. The difference is the census ledgers, `chartRegion.test.js` and the mobile landing test.

### 6.2 New tests

1. **`engine/__tests__/indicatorVisibilityProperty.test.js`**, the property test. Promoted from `hideModelPrototype.audit.test.js` `runProperty`.
   - **Generator:** a seeded PRNG, 25–60 steps per sequence.
     - Fixture: three RSIs (7/W, 21/W, 50 hidden), MACD, MA(RSI#1), an info value on RSI#2, and the four default averages.
     - Steps: definition toggle (rsi/macd), averages toggle, instance hide/show, duplicate, remove, remove-all, unavailable Repair/Remove (on an injected broken record), undo, redo.
     - **Every write round-trips through `mergeChartSettings(JSON.stringify(x))`.**
   - **Invariants after every step:**
     1. no silent loss of inputs, calculation timeframe, placement, presentation or visibility for any instance not explicitly removed;
     2. undo of step *k* equals the state before *k* by `JSON.stringify`, and redo equals the state after;
     3. no `!`-prefixed source and no `severed` info value points at a live instance;
     4. def-hide then def-show is byte-identical, and member-hidden instances stay hidden;
     5. the StockChart drawn set (migrate → `liveStoredDefIds` filter → normalize) never holds a duplicate id, and never holds a `legacy:` projection beside a live (even hidden) stored instance or a dropped stored record of its definition;
     6. a stale undo (mutate a recorded element out of band) is refused, the blob is unchanged, and the reason names the element.
   - **Seeds:**
     - default **1,000** if a local run stays under 5 s (the prototype's 200 run in well under a second), else 200;
     - an env override `INDICATOR_PROPERTY_SEEDS` for CI. The workflow change is A0-owned, so ask its owner.
   - **Must fail on today's code:** the shipped toggle fails invariant 1 on 199/200 seeds (PA3).
2. **`engine/__tests__/indicatorVersionSkew.test.js`**, the version-skew test.
   - Vendors **frozen copies** of the pre-A1 `setIndicatorEnabled`, `setInstanceHidden`, `duplicateInstance` and `isIndicatorEnabled` from `1eba7c105c` into `__fixtures__/preA1InstanceControls.js` (header: "frozen; never edit"). It runs them against blobs written by the new writers, and the reverse.
   - Asserts every row of §2.4 and the rollback row of §7.3: old normalize keeps the marked instances; old drawn set has no double draw; old legend lists the hidden chips; an old show leaves an inert marker, which `definitionVisibility` reads as visible; an old duplicate's marker is inert; a new reader on an old-tombstoned blob reads `absent`.
3. **`engine/__tests__/indicatorHistory.test.js`:**
   - element record and order;
   - add-undo splices;
   - byte-exact undo/redo after a round trip;
   - canonical holds-check: a key-reordered but equal element still applies;
   - refusal never partial;
   - contract and `settingsVersion` mismatch ignored.
4. **`components/chart/indicatorHistoryStore.test.js`:**
   - depth 50; redo cleared;
   - sessionStorage round trip; quota exceptions fall back to memory;
   - 256 KB and 2 MB caps;
   - **exact-prefix hygiene:** foreign keys untouched, which is the shared-origin rule;
   - userId isolation.
5. **`components/chart/IndicatorUndoToast.test.jsx`:**
   - visibility and timer;
   - Undo writes through the host sink; refusal copy;
   - **capture-phase Ctrl+Z pre-empts the drawing undo only while visible**: mount a stub window bubble listener and assert it is not called while the toast shows and is called when it does not;
   - inputs and modals ignored.
6. **Per-door tests**, one `it` per door in §1.2, in the file that owns the door:
   - D1 (`IndicatorLibraryDialog.test.jsx`);
   - D2, D2b, D3, D4, D4-M, D4b, P1, the persist filter, share one-shot, share prompt, toast mount rule (`stockChartWiring.test.jsx`, new `describe('A1 doors')`);
   - D5, D6 (`MobileIndicatorSheet.studies.test.jsx`);
   - Settings ✕, Remove-all and header Undo (`ChartSettingsIndicators` test);
   - Restore Defaults and template record (`ChartSettingsModal` test);
   - toolbar presets (`ChartToolbar` test);
   - Settings-page presets (`pages/Settings` test);
   - right-click template (`ChartWidget` test);
   - layout undo, including the conflict path (`ChartsWorkspace.layoutUndo.test.jsx`).
7. **`components/chart/indicatorPreservation.test.js`:**
   - `keepIndicatorState` for every `INDICATOR_OWNED_TOP_KEYS` key plus `header.infoValues`;
   - absent stays absent;
   - `stripOverrideOwnedInstances` / `isOverrideOwned` truth table;
   - `applyShareIndicators` equals today's indicator half for a no-conflict link;
   - `claimShareState` latch.
8. **`engine/__tests__/unavailableInstances.test.jsx`:**
   - each reason class;
   - **no flash while `userDefsReady` is false**;
   - Repair and Remove writers, each with identity refusal;
   - projection suppression (substitution killed);
   - Keep dismissal per surface;
   - the chip, Settings group and phone group render.
9. **`chartDefaults` v1 fold:** a dropped record survives the fold. This is an addition to `settingsBlobMigration.test.js`.
10. **`hooks/useUserDefinitions.uninstall.test.jsx`:**
    - a successful response without the id uninstalls it;
    - an error, 5xx or loading state never does;
    - a BuilderSheet-installed id is never evicted by a stale response;
    - a BroadcastChannel message triggers `mutate`.

### 6.3 Acceptance criteria

**Automated (all required):**
- every §6.1 rail updated with its reason, and green;
- every §6.2 test green;
- the property test ≥1,000 seeds green with 0 failures;
- the version-skew test green;
- `hiddenIsRemovedNotParked`, the `engine_two_rsi_instances` parity case, `agentChartTemplateParity`, `agentBatch6` and `engineEnabledMigration` unchanged and green;
- the A0 Linux security-suite job green if A1 touches anything in its list (it does not plan to);
- each new test **fails on today's code**: the property test, the door tests, the share one-shot and the grid filter.

**Manual browser acceptance (lead), PA3 §8.2, plus:**
1. Two RSIs (7, 21) and a hidden RSI(50) on a `/charts` widget.
   - Ctrl+I → nothing drawn; toast "RSI hidden (2) · Undo".
   - Ctrl+I again → 7 and 21 back; 50 still hidden.
   - Reload between the presses: same result.
2. The same through the Library row, right-click Indicators ▸ RSI and the phone switch.
   - Right-click **on the RSI(21) pane** → "Hide RSI (21)" hides only RSI(21).
3. Right-click Indicators ▸ MA → all averages hidden, none deleted. Second click → exactly those back. Ctrl+M behaves the same.
4. Phone: open RSI(21) from its chip → Remove → only RSI(21) leaves. Undo → back with 21.
5. Chip Delete RSI(7) → Undo → back as `inst:rsi:1`, with the MA(RSI) source and the info value re-attached. Ctrl+Z inside the toast window does the same; outside it Ctrl+Z undoes the last drawing.
6. Restore Defaults → appearance resets, indicators stay → Undo restores the look.
   - Template apply → Undo.
   - Open a layout → Undo.
7. Open a `/charts?state=…` link on a board with 3 chart widgets:
   - **only one** chart changes;
   - the prompt appears when you have indicators;
   - *Keep mine* writes nothing;
   - the URL no longer carries `state`;
   - a reload does not re-apply.
8. Grid cell, Ctrl+I on a widget-owned RSI → notice, nothing written. The `/charts` widget and the cell agree after a reload.
9. Delete a formula in tab A → tab B (no reload) stops drawing it and shows "⚠ 1 indicator can't be shown" → Remove → Undo.
10. An old-bundle tab (pin the previous build): it shows hidden chips with eyes and does not double-draw.

---

## 7. Rollout and rollback

### 7.1 Flag or not

**Recommendation: no feature flag.**
- The flags here are build-time `VITE_*` values. Flipping one needs a rebuild and a ledger entry, which is the same cost as a revert, so a flag buys nothing over the four revertable commits (§5.4).
- The A1.1 writer change is a **bug fix to data loss**. Keeping the old path behind a flag keeps the defect live.
- **Exception, if the owner wants one:** A1.3b (layout undo) and the share-link prompt are pure UI and could ride a flag. I do not recommend it.

### 7.2 Old-tab cycle risk

- **Open tabs keep the old bundle until they reload.** There is no forced reload: `utils/staleChunk.js` reloads only on a missing lazy chunk.
- **During that window an old tab:**
  - draws def-hidden instances as hidden;
  - lists them in its legend with eyes;
  - **runs the old delete-all** from its Library, menu, chord or phone switch. That is today's behaviour, not a regression.
- **Last-write-wins between old and new tabs** is unchanged.
- **Optional mitigation (not recommended for A1):** a "new version available — reload" banner keyed on the build id. It is a separate, cross-app decision.

### 7.3 Rollback safety

Reverting A1 leaves post-A1 blobs readable by the old code:

| What was written by A1 | What the old code does with it |
|---|---|
| `hidden:true, hiddenVia:'definition'` | Draws them hidden; legend chip with eye (one-click unhide; the marker becomes inert); Library and menus read **ticked** (the old "exists" reader). **Trap:** a click on that ticked row then runs the **old delete-all**. This is the pre-A1 defect, now reachable for instances A1 hid. Rollback notes must tell members: "to show a hidden indicator, use its eye in the legend" |
| Instances kept by Restore Defaults / presets | Plain instances; fully readable |
| Tombstones from `removeDefinition` / `removeUnavailable` | Standard tombstones |
| Raw dropped records kept by the v1 fold | Already what v2 blobs do (`chartDefaults.js:707` passes the array through) |
| `sessionStorage` `uct.indicators.history.v1:*`, `uct.indicators.unavailable.dismissed.v1:*` | Never read; inert; cleared with the tab |
| A share link already stripped | Nothing to roll back |

**No blob becomes unreadable, no key the old merge rejects is introduced, and no `settingsVersion` changes.**

**Partial rollback:**
- Reverting A1.2 alone removes undo but keeps the hide model.
- Reverting A1.4 alone restores the silent drop. That is safe, because records stay in the blob.

---

## 8. Remaining owner decisions (still open)

D3–D8 are approved. Only these remain:

| # | Question | Recommendation |
|---|---|---|
| Q1 (PA3 O4) | Right-click Indicators ▸ **MA**: hide/show all averages (sharing Ctrl+M's writer), or remove the row? | **Hide/show all**, one writer with Ctrl+M |
| Q2 (PA3 O9) | Build "Restore formula" (server PUT over the soft-delete tombstone) in the unavailable popover? | Yes, but as a follow-up. A1 ships Remove, Keep, Repair and Open in Builder |
| Q3 | Include **layout-apply undo** (A1.3b, `ChartsWorkspace.jsx`, shared with the Agent Context work) in A1, or defer? | Include, as its own commit. The outgoing named layout is already flushed, so this mainly protects unnamed boards |
| Q4 (PA3 O7, remainder) | Restore Defaults: add an "Also remove indicators" option? | **No** for A1. Remove-all per definition plus undo covers it |
| Q5 | Accept two visible consequences: (a) presets no longer reset moving-average colours (averages are indicators, D5); (b) a substituted default (a broken stored RSI drawn as RSI 14 today) is replaced by the notice with Repair | Accept both |
| Q6 | Share link with indicators on both sides: offer only **Use theirs / Keep mine**, or also **Add theirs to mine**? | Two options in A1. "Add to mine" needs source re-pointing (the `addInstanceCopy` caller rule) and can follow |

**Not owner decisions:**
- **Coordination items:** sign-off on the Ctrl+Z arbiter (drawing owner), Agent stack unification and C5 (Agent session), the property-seed env in CI (A0 owner).
- **The Version History restore tool:** D8 plus the O8 flag check, outside A1.
