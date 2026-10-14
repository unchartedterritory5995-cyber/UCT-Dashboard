# C4: board-level indicator configuration for the multi-chart grid (final design)

- **Status:** design only. **No C4 code is written.** Implementation waits for owner approval of this document.
- **Branch:** `design/indicators-c4`, isolated, based on master `66cd9fe126`. The implementation will go on its own `feat/indicators-c4`.
- **Supersedes** the option analysis in `docs/indicators/a1/C4-CHART-LOCAL-INDICATORS-PROPOSAL.md`. Option B is chosen; owner decisions Q1–Q6 are incorporated.
- **Paths** are under `app/src/` unless noted.

## 1. Owner decisions, and how this design meets each

| # | Decision | Where it lands |
|---|---|---|
| Q1 | An explicit **Reset Grid Indicators**, scoped to grid indicator configuration only | §5.4 |
| Q2 | The shared grid modal's indicator configuration moves onto the board record, preserving its intended behaviour | §5.3 |
| Q3 | Volume is included where it is part of the indicator configuration; current volume semantics are preserved | §3.2 |
| Q4 | Saved grid templates preserve the board's indicator configuration | §5.5 |
| Q5 | Popup-chart leakage is a **separate follow-up**, not in C4 | §9 |
| Q6 | Phone and desktop use the same saved board configuration | §3.1, §5.6 |
| + | Per-chart overrides are preserved where supported | §4 |
| + | Embedded-chart edits are never silently written into global preferences | §5.1, §7 test G |
| + | No destructive migration | §6 |
| + | Resets are scoped and undoable | §5.4 |

## 2. Today, verified on `66cd9fe126`

- A grid cell (`pages/charts/grid/GridChartCell.jsx`) renders a `StockChart` with `settingsOverride` = the first /charts widget's raw settings (`ownChartSource`) plus the cell's `chartType`, and no `onSettingsPersist`.
- `StockChart.handleUpdateChartSettings` (`components/StockChart.jsx:5107`) restores only keys the write carried through unchanged. So an edited `indicatorInstances` array, which carries the override's ids, is written into the member's **global** `chart_settings`. That is the leak.
- The **shared grid modal** (`MultiChartGrid.jsx:491`) reads `mergeChartSettings(prefs.chart_settings)` (global) and writes global, while the cells render `ownChartSource`. **The modal and the cells already disagree about which indicators the grid has.**
- Per-cell undo history is per mount today: there is no `indicatorHistoryKey` prop, so each cell keeps its own stack.
- `multichart_state` is one pref shared by all devices. Device-specific fields live in `presentation` (MOB-08). `sanitizeState` is an **allow-list**, so an unknown key is dropped on hydrate.
- Server side, `multichart_state` is `_PREF_OPAQUE` (`api/routers/auth.py:2796`), so no backend change is needed. The indicator-alert deletion guard (`api/services/indicator_alert_service.py:1430`) already walks `multichart_state` for every `instanceId`, so instances in the board record stay visible to it.
- The Agent marks multichart unsupported (`useAgent.js:905`). No Agent path writes a grid cell.

## 3. The record

### 3.1 Where it lives

- **Where:** an optional top-level field `multichart_state.indicatorDelta`.
- **Shared across devices (Q6):** it is outside `presentation`, so phone and desktop read and write the same field.
- **When it exists:** it is written only after a member's first indicator edit on the board. A board that was never edited has no such key.

```js
indicatorDelta = {
  v: 1,
  instances:   { [instanceId]: Instance | { instanceId, deleted: true } }, // whole-instance replace
  order:       [instanceId, …] | undefined,      // only when the member reordered instances
  indicators:  { [key]: object },                // the legacy mirror, per key
  overlays:    { [slot]: object },               // MA slots, positional, per slot
  volume:      { …indicator-owned volume keys }, // §3.2
  replace:     { paneOrder?, paneSizes?, paneSeriesOrder?, volumeOverlayIndicators? }, // whole value
  infoValues:  { [key]: value | null },          // header.infoValues; null = removed vs base
}
```

**Why entries replace whole instances.** `mergeSettingsOverride` merges `inputs` (`{...prev.inputs, ...patch.inputs}`). An input the member removed in the grid would come back from the base. The delta therefore stores each touched instance whole, and its apply step never merges inputs.

### 3.2 The indicator slice

The slice is **derived, not hand-listed**:
- `INDICATOR_OWNED_TOP_KEYS` (`builder/agentSeams.js:30`): `indicatorInstances`, `indicators`, `overlays`, `paneOrder`, `paneSizes`, `paneSeriesOrder`, `volumeOverlayIndicators`;
- plus `header.infoValues` (finding C5: the owned list's top-level `infoValues` names nothing);
- plus the **indicator-owned volume keys**.

A test fails if `INDICATOR_OWNED_TOP_KEYS` gains a key the delta does not carry.

**Volume (Q3).**
- **What is included:** the Indicators panel lists a Volume row, with show/hide, a tombstone remove (`removed: true`), and its settings. So the keys that row edits are part of the indicator configuration and go in the slice: `visible`, `removed`, the volume MA, and the readout.
- **How the list is fixed:** in step C4.1 the exact key list is enumerated from the Volume row's settings form, and a test derives it.
- **What stays out:** `volume.separatePane` and `volume.paneHeightPct`. A grid cell forces both through props (`volumeSeparatePane`, `volumePaneHeightPct={volPanePct}`, capped at 10%), and the shared modal fixes them (`volumePaneFixed`, `volumeOpts`). Storing them would change nothing on screen. They keep today's semantics: they are read from global and never written by the grid.

## 4. Composition

From lowest to highest precedence:

```
CHART_DEFAULTS  <  global chart_settings  <  ownChartSource (source widget)
                <  board indicatorDelta   <  cell.chartType  <  surface-fixed props
```

- **The delta applies after the override.** The base is the cell's pre-delta `csMerged`, so the source widget remains the base.
- **Existing per-chart overrides keep precedence:**
  - `cell.chartType` is the only per-cell setting that exists today;
  - the surface-fixed volume pane comes last.
- **No per-cell indicator layer** exists today, so there is none to preserve. The shape leaves room for one later (`cells[i].indicatorDelta`, applied after the board delta) without building it.
- **One shared base:** every cell and the shared modal compute the same pre-delta base from the same inputs, so they all agree on what the board has. Today the modal and the cells disagree (§2).

## 5. Behaviour

### 5.1 A cell edit, which is the leak fix

New `StockChart` props: `localIndicatorDelta` and `onLocalIndicatorDelta`. When `onLocalIndicatorDelta` is present, `handleUpdateChartSettings` works as follows:

1. **Split** `newSettings` into the indicator slice and the rest.
2. **If the slice changed** against the pre-delta base, call `onLocalIndicatorDelta(computeIndicatorDelta(base, newSettings))`.
3. **The rest goes to global exactly as today**, except that every slice key is set back to `csBase` first. In this mode the slice **never** reaches `setPref('chart_settings')`.
4. **If nothing outside the slice changed** (ignoring `preset`), there is no `setPref` call at all.

The split lives in `StockChart` because the existing restore depends on `Object.is(newSettings[k], cs[k])`. A host that recomputed `cs` would make every override key look edited.

### 5.2 Undo across the board

- **History key:** cells pass `indicatorHistoryKey="chart:multichart"` and `origin = cell.id`. One stack covers the board.
- **Toasts:** they show only in the cell that made the change (the existing origin filter).
- **Undo writes:** an Undo writes through the cell's own funnel, so it lands in the delta and never in global. A1's `applying` guard keeps it from recording itself.
- **Refusals:** if the source widget changed the same entries since the edit, Undo refuses ("changed since"). It never writes a partial or stale state.

### 5.3 The shared grid modal (Q2)

- **What it shows:** the board view, `applyIndicatorDelta(preDeltaBase, delta)`, instead of global. It then shows the indicators the cells actually draw.
- **What it writes:** its `onChange` goes through one host writer, `writeBoardSettings(next)` in `MultiChartGrid`, which uses the same split as §5.1:
  - the slice goes to `setIndicatorDelta`;
  - appearance keys go to global, unchanged from today. That is its intended behaviour: appearance edits are global.
- **Volume:** the existing `volumePaneFixed` and `volumeOpts` stay.
- **Undo buttons:** the modal's buttons use `chart:multichart` with `writeBoardSettings` as the sink.

### 5.4 Reset Grid Indicators (Q1)

- **Where:** a row in `MultiChartMenu` and a button in the shared modal's Indicators tab.
- **When it is available:** it is disabled when the board has no delta.
- **What it does:** removes `indicatorDelta`, so the board shows the source chart's indicators again.
  - It **never** touches global `chart_settings`, the source widget, cells, layout or appearance.
- **Undo:** the reset is recorded on `chart:multichart` as "Grid indicators reset", and **Undo restores the delta**.
- **No confirmation dialog:** it is undoable instead, matching A1's pattern for presets and resets.

### 5.5 Templates (Q4)

- **Saving:** `MultiChartMenu.handleSaveAs` adds `indicatorDelta` to the saved layout when the board has one. The server stores `layout` as an opaque dict (`api/routers/charts_layouts.py:76` validates only `widgets: []`).
- **Applying a template that has the field:** the template's delta replaces the board's. The change is recorded on `chart:multichart` as "Applied grid template “X”" and is undoable.
- **Applying a template saved before C4** (no field): **the board's current delta is kept.** Such a template never described indicators, so applying it changes cells and layout as it does today, and nothing is discarded. *(See risk R8: confirm this.)*
- **Shared templates** (`/shared/{token}`) carry the sender's delta the same way. They are recorded and undoable, with no silent merge.

### 5.6 Phone (Q6)

- The phone grid mounts the same `MultiChartGrid` with the same `mc` (`ChartsWorkspace.jsx:3150` and `:3617`), so it reads and writes the same `indicatorDelta`.
- Step C4.7 enumerates every phone door that edits indicators in a cell, and tests that each one goes through the cell funnel or `writeBoardSettings`.

### 5.7 Not changed

- `mergeSettingsOverride`;
- `ChartPane`, `useChartSurfaceSettings` and `agent/*`;
- cell shape and ids;
- `charts_workspace_layout`;
- the `onSettingsPersist` path;
- the cell's direct-to-global extended-hours toggle (`GridChartCell.jsx:108`). It builds from `mergeChartSettings(prefs.chart_settings)` and cannot leak.

`pages/ChartRender.jsx` gets `onSettingsPersist={noop}`, because a headless renderer must not persist.

## 6. Persistence and existing saved boards

- **Old boards round-trip unchanged:** `sanitizeState` carries `indicatorDelta` only when `sanitizeIndicatorDelta` accepts it and it is non-empty. When absent, the key is omitted, so an existing saved board round-trips byte-identically and renders exactly as today. **No migration.**
- **Board operations keep the delta:** `fillCells`, `restoreCells`, refills and `applyGridTemplate` (without a template delta) keep `prev.indicatorDelta`. This is board-level, so re-minted cell ids do not lose it.
- **Size:**
  - a client cap of 64 KB on the serialized delta;
  - an edit that would exceed it is **refused with a notice**, never truncated;
  - the cap's value is a placeholder until measured against the largest real `indicatorInstances` arrays: counts and sizes only, no values.
- **Corrupt records:** a corrupt delta is dropped on hydrate, and the board falls back to the source indicators. The board is never blank. There is one test per junk shape.

## 7. Required tests

| ID | Area | Test |
|---|---|---|
| D | pure module | hide, edit and remove of a global id and of an override-only id; showing back to the base value drops the entry; the overlays and `ovl:` pairing stay consistent; a change only to `header.infoValues`; a removed input key does not come back; reordering; tombstones; slice coverage derived from `INDICATOR_OWNED_TOP_KEYS` |
| I | grid-cell isolation | editing a cell changes the board record. Every cell shows it; the source widget, global and other boards do not change |
| G | **global protection** | in delta mode, every `setPref('chart_settings')` payload deep-equals `csBase` on slice keys, and an indicator-only edit makes **no** `setPref` call. Covers cell edits, modal edits, Reset, template apply and Undo/Redo |
| P | persistence | an edit survives the debounced save, remount and reload; `sanitizeState(oldBlob)` deep-equals today's output with no key; a valid delta round-trips; junk is dropped; refill, restore and layout change keep it |
| T | templates | save includes the delta; apply with a delta replaces it and is undoable; apply of a pre-C4 template keeps the current delta; a shared-token template behaves the same |
| R | reopening | switching away from and back to the board, exiting and re-entering grid mode, and opening a saved layout and returning all keep the delta |
| M | mobile | the phone grid shows the desktop delta and vice versa; phone indicator doors write the delta; device-scoped `presentation` is untouched |
| Q2 | shared modal | it shows the board view, an indicator edit goes to the delta, an appearance edit goes to global, and volume pane options are unchanged |
| Q1 | reset | it clears only the delta, records an entry, Undo restores it, and it is disabled with no delta |
| U | Undo | records on `chart:multichart` with origin `cell.id`; `global` and per-mount stacks stay empty; Undo writes the delta; no toast in sibling cells; a "changed since" refusal writes nothing |
| V | volume | the volume row's hide and remove go to the delta; `separatePane` and `paneHeightPct` stay prop-fixed and are never stored |
| A | Agent regression | the `agent/*` and `ChartPane` suites stay green; `applySettings` still records only on `chart:<widgetId>` |
| AL | alerts | a backend unit test: an instance that exists only in `indicatorDelta` is found by `chart_instance_ids`. A tombstone is treated the same as it is in `chart_settings` today (see R11) |

## 8. Commit plan

Each commit stands alone and can be reverted, with its own test gate.

| # | Commit | Why it's separate |
|---|---|---|
| C4.0 | `sanitizeState` **carries** a valid `indicatorDelta`; nothing reads it yet | lands first so a later rollback of C4.1+ does not erase saved edits (R10) |
| C4.1 | `components/chart/localIndicatorDelta.js` (pure) and its tests | |
| C4.2 | the `StockChart` split sink and props; no host uses them yet | |
| C4.3 | grid wiring: cells, `chart:multichart`, `setIndicatorDelta`, the `ChartRender` noop | the leak fix |
| C4.4 | the shared modal moves onto the board view (Q2) | |
| C4.5 | Reset Grid Indicators and its Undo (Q1) | |
| C4.6 | templates save and apply (Q4) | |
| C4.7 | the phone door census and tests (Q6) | |

## 9. Out of scope (Q5)

The popup charts are a **separate follow-up project**: TickerPopup, embedded Watchlists, DarkPool, OptionsFlow, ThemeTracker, Overview, journal pages, VideoDock, DiscordActivity and TickerHubSheet. They write the whole merged blob to global (`useChartSurfaceSettings.js:59-62`) and have no per-surface record, so they need a new per-surface preference. C4 does not touch them.

The `EtfHoldingsPanel` `watchlist_settings` leak stays filed separately.

## 10. Remaining architectural risks

| # | Risk | Mitigation / status |
|---|---|---|
| R1 | **Masking.** A delta entry pins its value, so later changes to the same id on the source widget don't show on the board. A delta-added id that later collides with a source id: the delta wins | the visible, scoped Reset (Q1); entries are per id, so untouched ids still follow the source |
| R2 | **Concurrent writers.** `multichart_state` is one pref saved last-write-wins, debounced. Two devices editing the board at the same moment: the later save wins the whole pref, exactly as cells do today | unchanged from today; not made worse. A revision guard like the workspace's would be a separate change |
| R3 | **Appearance mismatch in the shared modal.** It shows and writes **global** appearance while cells render the source widget's appearance. C4 fixes the indicator half only | pre-existing; named as a follow-up, not silently changed |
| R4 | **Base drift and Undo.** An Undo after the source widget changed the same entries refuses ("changed since") instead of guessing | honest refusal, tested (U) |
| R5 | **The overlays and `ovl:` pairing** through `adoptOverlayAverages` (`explicitReset`) | the delta stores both halves together; a test in D |
| R6 | **Volume key list.** If the Volume row later edits a new key, it must join the slice | a derived test fails when the row and the slice disagree |
| R7 | **Size.** A board with very many indicators could approach the cap | refuse with a notice, never truncate; the cap is measured before shipping |
| R8 | **Pre-C4 templates keep the current delta.** The alternative, clearing it, would make old templates show source indicators | **needs owner confirmation**; the design defaults to keep, which is non-destructive |
| R9 | **Phone doors not yet enumerated** | C4.7 is a census with a ratchet test |
| R10 | **Rollback.** Reverting C4 after members have edited boards: a pre-C4 `sanitizeState` drops the unknown key on the next save, so the grid edits are lost. Global is never harmed | C4.0 lands first, so rolling back the behaviour commits keeps the data; reverting C4.0 itself is the only lossy step, and that is documented |
| R11 | **Alerts and tombstones.** The alert guard's vocabulary-free walker counts any `instanceId`, including a tombstone's, as present. That is pre-existing behaviour for `chart_settings` too | not changed by C4; flagged to the alert owner, covered by the AL test |
| R12 | **The Agent becomes grid-capable later.** Its writes would have to go through `writeBoardSettings`, not `applySettings` on a cell | Agent-owned decision; noted in the Agent coordination doc when it arises |

## 11. Owner confirmations still needed before coding

1. **R8:** applying a template saved before C4 keeps the board's current grid indicators. *(Recommended: keep.)*
2. **Reset placement:** in both the Multi Chart menu and the shared modal's Indicators tab. *(Recommended: both.)*
3. **R3:** handle the shared modal's appearance mismatch as a separate follow-up. *(Recommended: yes.)*
