# Where an indicator edit is saved: a scope policy proposal (2026-11-02)

**Proposal for review. No behaviour has changed.** The owner asked on 2026-11-02 for a clear scope policy before anything changes. The findings come from a read-only investigation of `2cd4c3839c`. Line numbers are dated claims; re-read them before acting.

## The defect, confirmed by reading the code

Every host's indicator edit reaches `StockChart.jsx` `handleUpdateChartSettings`, which works like this:

- **When the host passes `onSettingsPersist`,** everything goes to the host's own store and nothing else is written:
  `if (onSettingsPersist) { onSettingsPersist(newSettings); return }`
- **When the host passes `settingsOverride` and no sink,**
  - the function restores the overridden keys that the edit did not change;
  - then it writes the rest to the member's **global** `chart_settings`.
  - `indicatorInstances` is a new array after any add, remove, hide or settings change, so it always fails the "unchanged" test and is always written to global.

The in-file comment says "today's only override is the primitive per-cell chartType". That is stale: a grid cell's override is now a whole widget blob, so one cell edit also copies the `/charts` widget's indicators into global.

### Surfaces, grouped

| Group | Surfaces | Where an edit goes |
|---|---|---|
| **Isolated (correct)** | `ChartWidget` (and its chart tabs), the breadth drill board, `WatchlistWidget` and every list it hosts, `ScanResults`, `MobileChartsApp`, the notebook `ChartEmbed` | the host's own blob |
| **Leaks into global (the defect)** | **multi-chart grid cells** (`GridChartCell.jsx`, `settingsOverride` with no sink); `EtfHoldingsPanel.jsx`; the standalone mounts of the hosted list components when no sink is supplied | global `chart_settings` |
| **Global by design** | plain `StockChart` with no override (Model Book, Research Technical tab, Theme Tracker panel and others) | global, and the "your chart, everywhere" contract (`useChartSurfaceSettings.js`) says so |
| **Mismatch (smaller, separate)** | `ChartPane` hosts with `stored={null}` (TickerPopup, TickerHubSheet, Watchlists page, Theme Tracker, DarkPool, OptionsFlow, OverviewTab) | they READ the widget blob but WRITE the whole merged blob to global |

The grid also has two global writers of its own:
- the extended-hours toggle (`GridChartCell.jsx`);
- the shared settings modal (`MultiChartGrid.jsx`).

Grid cells also share the global undo history: the history key is `isolated: !!onSettingsPersist`.

## Proposed policy

> **An indicator edit is saved where the chart lives.**
> - A chart that has its own home (a workspace widget, a chart tab, a grid cell, a drill-board widget, a hosted list) keeps its own indicator state. Its first edit forks it from the member's main chart.
> - A chart with no home of its own (a popup, a research tab, Model Book) edits the member's main chart. That is the existing "your chart, everywhere" contract.
> - No surface reads one store and writes another.

This is option **(A)**, chosen over two alternatives:
- **(B), refusing edits in cells.** This removes a capability. A1 built it once and removed it because it "would silently drop edits".
- **(C), asking "this chart / all charts" on every edit.** This is the most UI work. It can come later on top of (A).

(A) is also the model the isolated surfaces already use.

## The change it implies (not started)

1. **Grid cells.**
   - `multichart_state` cells gain an optional `settings`. `gridLayouts.sanitizeState` is an allow-list (`id, sym, tf, chartType`), so `settings` must be added there or it is silently dropped.
   - `GridChartCell` passes `onSettingsPersist`, which writes through the existing cell `onChange`.
   - The override becomes `cell.settings || ownChartSource`, plus `chartType`.
   - Named multichart layouts (`/api/charts/layouts`, `kind: 'multichart'`) carry the cell `settings` too.
2. **`EtfHoldingsPanel`** gets a sink in the same way.
3. **A "Reset to my chart" action** on a forked cell, so a fork is never frozen for good.
4. **The grid's extended-hours toggle and shared modal** are decided explicitly. Recommendation: the modal stays global (it is labelled as the shared settings), and the per-cell toggle writes to the cell.
5. **Fix the stale comment** in `StockChart.jsx`.

### Rails

- An add, hide or remove on a grid cell never calls `setPref('chart_settings')`.
- `sanitizeState` keeps `settings` through a round trip.
- A named-layout round trip.
- **An AST guard:** every host that passes `settingsOverride` also passes `onSettingsPersist`, derived from the source rather than a typed list. That keeps the next host from shipping the leak.

## What it does NOT fix

**Global blobs that are already polluted cannot be cleaned automatically.** Nothing records which surface an instance came from, so any cleanup would be guessing. The fix stops new leaks. A member can remove an unwanted indicator by hand, as today.

## Ownership and risk

- The grid (`pages/charts/grid/**`) and `EtfHoldingsPanel` are chart/workspace-owned. The change needs that owner's review.
- Indicators owns only the instance merge (`instanceShape.mergeSettingsOverride`), which is unchanged.
- Stored-data migration risk is low: no cell stores settings today, so the field starts empty.

## Owner decisions needed

1. Approve policy (A).
2. Decide the grid's shared-modal scope (proposal: it stays global).
3. Decide whether the `ChartPane` read/write mismatch is fixed in the same change or tracked separately (proposal: separately; it is a different surface family).
