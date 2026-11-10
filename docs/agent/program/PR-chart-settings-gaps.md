# PR: the chart-settings gaps (EXEC-CHART-SETTINGS it.todo rows)

Branch `agent/pl/chart-settings-gaps`, from origin/master `16c653db95`. Worker pl-grid.

Coverage-ledger note: the ledger numbers in `docs/agent/CHARTS_EXECUTION_STATUS.md` (225 of 484 VERIFIED) are **VOID
pending re-measurement**. This PR does not cite them as verified and does not recount them.

## The 7 gaps, as found on `16c653db95` (written before any code)

Source: `app/src/agent/qa/chartsOutcome/chartSettings.outcome.test.jsx:167-173` (7 `it.todo`) and
`docs/agent/program/EXEC-CHART-SETTINGS.md` (gap list, items 1-7; item 8, C1-061 Reset parity, is marked optional
and is not an it.todo). The count is 7, as stated ("45 passed / 7 todo").

| # | case | request (sentence) | why it fails today (verified in source) | decision |
|---|---|---|---|---|
| 1 | C1-058 | "align the watermark to the left" | `chart.setSetting` has no `watermark.align` row, so it refuses. The todo says "no alignment key"; that is only half right: `CHART_DEFAULTS.watermark` has none, but Chart Settings → Canvas → Watermark → Alignment writes `watermark.align` (`ChartSettingsModal.jsx` `setWmAlign`, left/center/right, absent = center) and StockChart / watermarkPrimitive read it. | BUILD (descriptor row) |
| 2 | C1-067 | "make the day change green up and orange down in the header" / "title in gold" | `header.colors.*` is a KNOWN row (`chartSettingsDescriptors.js:243`), so `chart.setSetting` refuses it. The panel writes `header.colors.<key>` (`ChartSettingsModal.jsx` COLOR_PATHS hdr* and the `hdrf:<colorKey>` Info-row pickers). | BUILD (descriptor rows, generated per colour key) |
| 3 | C1-077 | "save this blue to my colours" / "delete that saved colour" | No capability writes the colour picker's saved swatches: member pref `chart_saved_colors` (`ChartPane.jsx` saveColor / deleteColor, newest first, 24 max). It is a member-wide pref, not a chart setting. | see "Not built" |
| 4 | C1-078 | "switch this chart to the light palette" (Shift+T) | `theme` is a KNOWN row (`chartSettingsDescriptors.js:246`). The Shift+T chord writes `{ ...cs, theme: 'light'|'dark', preset: 'custom' }` (`StockChart.jsx` toggle:theme); `CHART_DEFAULTS.theme = 'dark'`. | BUILD (descriptor row) |
| 5 | C1-081 | "apply the <theme> theme to all my widgets" | `chart.applyThemeAll` (`capabilities/board.js`) themes chart widgets only. The product's all-widgets apply (`ChartsWorkspace.jsx` applyThemeToAllWidgets) also patches every widget's opts and writes one global pref per on-screen GLOBAL type (`WIDGET_GLOBAL_PREF_KEYS`). No capability does either. | see "Not built" |
| 6 | C1-092 | "overlay the 50 MA on the volume pane" | `volumeOverlayIndicators` is `owned:indicator` (`chartSettingsDescriptors.js:226`): Indicator Intelligence's family. | STOP: owned by another project |
| 7 | C1-127 | "open chart settings" (Alt+, / gear) | No capability opens the dialog. ChartWidget opens it through `paneRef.current.openSettings(section)`; the Agent's chart adapter (host.charts) exposes no such hook. | see "Not built" |

## Rules held for each built gap

* The write is the chart's own settings writer: `withSetting` (the shape Chart Settings' own setters produce),
  committed by `chart.setSetting` through the chart's normal onOptsChange path. No parallel write path.
* Generalized by setting family: a descriptor row per key (generated from the product's own catalog where there is
  one), never per sentence.
* Each gap: an outcome test that failed first (red commit), a mutant that is killed, a control that a request naming
  a different chart, or excluding this one, does not touch it, and Undo restoring the exact previous blob (a key that
  did not exist is gone again, not left as `{}`/default: the live listView `?? {}` undo bug is the pattern avoided).
* No change to #988's targeting code (`deixis.js`, `spatialCheck.js`, `clickRef.js`).
