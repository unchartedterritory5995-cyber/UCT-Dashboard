# C4: indicator edits on embedded charts stay chart-local

- **Status:** design only. Not implemented; this needs owner approval.
- **Paths** are under `app/src/`.

## The defect, measured

A `StockChart` that has a `settingsOverride` but no `onSettingsPersist` writes every settings change into the member's **global** `chart_settings`. The chart's `cs` is the global settings merged with the override, so the write carries along any instance ids that exist only in the override. Those ids then appear on every chart that reads global settings.

The A1.1 attempt to strip those ids at the save step was rejected, because it would silently drop the member's edits.

**Hosts on this path, verified:**

| Host | Override | Where writes go today | Natural chart-local home |
|---|---|---|---|
| `pages/charts/grid/GridChartCell.jsx` (MultiChartGrid cells) | `ownChartSource`: the first /charts widget's raw settings, plus `cell.chartType` (L176, L187-191) | global `chart_settings` | `multichart_state`, saved debounced (`useMultiChartState.js:71-90`). It is an allow-list: `sanitizeState` (`gridLayouts.js:122-153`) keeps id/sym/tf/chartType per cell, and cell ids are re-minted on refill (`useMultiChartState.js:159-163`) |
| `pages/ChartRender.jsx` (L953) | owner blob + preset + `?indicators=` | global (rare: a headless renderer) | none needed: it should not persist |
| BreadthDrill / ETF holdings / ListSubscription / PeriodSort | not chart settings. Their override is the *watchlist appearance* blob | — | — (`EtfHoldingsPanel.jsx:80` has the same class of leak for `watchlist_settings`, filed separately) |
| **Own-chart `ChartPane` popups** with `stored={null}` and no `onStore`: TickerPopup, embedded Watchlists, DarkPool, OptionsFlow, ThemeTracker, Overview, journal pages, VideoDock, DiscordActivity, TickerHubSheet | `ownChartSource` | `useChartSurfaceSettings` writes the **whole merged blob** to global (`useChartSurfaceSettings.js:59-62`), without even the override-restore | **none today**. This is the larger instance of the same bug |

## Options

**A. A delta per cell in `multichart_state.cells[i]`.**
- `sanitizeState`, `fillCells`, `restoreCells` and `applyGridTemplate` would all have to change.
- A refill mints new ids, so a cell's edits would be lost.
- Cells would stop looking the same as each other, with up to 16 blobs.
- Fragile.

**B. One indicator delta per board, in `multichart_state` (recommended).**
- Add an optional top-level `indicatorDelta` field, stored only once a member edits an indicator in a cell.
- **Composition:** global < `ownChartSource` < delta < per-cell `chartType`.
- **On a write,** `StockChart` splits the change:
  - the indicator slice goes to the host as a delta against the pre-delta base;
  - every other key keeps today's global path, with the indicator slice set back to `csBase`.
- **The indicator slice:**
  - `indicatorInstances` (per id, with a tombstone for an id the base has and the next value removes);
  - the `indicators` mirror (per key);
  - `overlays` (moving-average edits write overlays and `ovl:` instances together);
  - `paneSizes` and `paneOrder`;
  - `header.infoValues`.
- **No migration:** a saved board without `indicatorDelta` renders exactly as today.
- **No effect on the Agent:** it never drives grid cells (`useAgent.js:905` marks multichart unsupported). `ChartPane` / `useChartSurfaceSettings` (the Agent's path) are not touched.
- **Why the split belongs in `StockChart`:** today's restore relies on `Object.is(newSettings[k], cs[k])`, and a host that recomputes `cs` would make every override key look edited.

**C. Write through to the source widget via WorkspaceContext, or make indicators read-only with an "Edit on the source chart" link.**
- It turns the first widget into a second global.
- It interleaves with the Agent's `applySettings` and Undo on that widget.
- There is nothing to write to when `ownChartSource` is null.
- The read-only variant blocks edits instead of keeping them, which conflicts with the owner's requirement.

**Recommendation: B, scoped to the grid.** Give `ChartRender` a no-op `onSettingsPersist`, since a headless renderer must not persist. Treat the own-chart `ChartPane` popups as a **separate follow-up**: they have no per-surface record, so they need a new per-surface preference key, which is a bigger decision.

## Files B changes, and what must not change

**Changes:**
- `components/chart/localIndicatorDelta.js` (new, pure): `computeIndicatorDelta(base, next)`, `applyIndicatorDelta(base, delta)`, `sanitizeIndicatorDelta`.
- `components/StockChart.jsx`: new props `localIndicatorDelta` and `onLocalIndicatorDelta`.
  - In `csMerged`, apply the delta after the override.
  - In `handleUpdateChartSettings`, emit the delta when the slice changed; set the slice back to `csBase`; skip the global write when nothing but `preset` remains.
- `pages/charts/grid/GridChartCell.jsx`: forward the two props, plus `indicatorHistoryKey="chart:multichart"`. Toasts are already filtered by `origin` = `cell.id`.
- `pages/charts/grid/MultiChartGrid.jsx`: pass `mc.state.indicatorDelta` and a stable setter.
- `pages/charts/grid/useMultiChartState.js`: add `setIndicatorDelta`; `applyGridTemplate` keeps `prev.indicatorDelta`.
- `pages/charts/grid/gridLayouts.js`: `sanitizeState` carries the field only when valid, and omits it when absent, so old blobs round-trip byte-identically.
- `pages/ChartRender.jsx`: `onSettingsPersist={noop}`.

**Must not change:**
- `mergeSettingsOverride` semantics;
- `ChartPane`, `useChartSurfaceSettings` and `agent/*`;
- cell shape and ids;
- `charts_workspace_layout`;
- the `onSettingsPersist` path.

## Required tests

- **`localIndicatorDelta`:**
  - hide, edit and remove of a global id, and of an override-only id;
  - showing an instance back to its base value drops it from the delta;
  - the overlays/MA pairing;
  - a change to `header.infoValues` alone;
  - the inputs-merge quirk (`{...prev.inputs, ...patch.inputs}`): a key removed in the grid must not come back.
- **`gridLayouts`:**
  - `sanitizeState(oldBlob)` deep-equals today's output, with no `indicatorDelta` key;
  - a valid delta round-trips;
  - junk is dropped;
  - `fillCells`, `restoreCells` and `applyGridTemplate` keep it.
- **`StockChart` wiring:**
  - in delta mode, hiding an override-only instance calls the sink and leaves global `chart_settings` byte-identical (or makes no `setPref` call);
  - a `chartType` edit still writes global, without indicator keys.
- **Integration:** an edit in one cell persists into the `multichart_state` save and survives remount and reload. Other cells show it; global is unchanged.
- **Undo:**
  - the change records on `chart:multichart` with origin `cell.id`, and `global` stays empty;
  - Undo writes the delta, never global;
  - sibling cells show no toast.
- **Agent regression:** the `agent/*` and `ChartPane` suites stay green, and `applySettings` still records only on `chart:<widgetId>`.

## Questions for the owner

1. **Masking:** a delta entry hides later changes the member makes to that id on the source widget. Should there be a "Reset grid indicators" action?
2. **Shared grid modal:** it still edits and shows global (a pre-existing mismatch). Should its Indicators tab move onto the delta in a follow-up?
3. **Volume:** is volume (`volume.visible` / `volume.removed`) part of the indicator slice? Today it would stay global.
4. **Templates:** should saved multichart templates carry the delta? I'd default to no.
5. **Own-chart popups:** should the larger instance get its own fix, with a new per-surface preference, as a separate item?
6. **Devices:** the delta is shared across devices, so phone and desktop grids share it. Is that acceptable?
