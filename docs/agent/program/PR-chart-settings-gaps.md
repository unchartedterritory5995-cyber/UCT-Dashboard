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

## Status of the 7 gaps (head of this branch, merged with origin/master `c77ef92b7b`)

| # | case | status | reason |
|---|---|---|---|
| 1 | C1-058 watermark alignment | DONE | eligible row `watermark.align` (left/center/right) |
| 2 | C1-067 header colours | DONE | eligible rows `header.colors.<key>`: title, dayChangeUp, dayChangeDown, legend, plus one per Info-row field `colorKey` (signed fields: `:pos` and `:neg`), generated from `headerFields.js` |
| 3 | C1-077 saved colours | NOT BUILT (it.todo kept) | a member-wide pref (`chart_saved_colors`), not a chart setting: needs a new member-pref capability with its own undo; out of this PR's scope |
| 4 | C1-078 light/dark palette | DONE | eligible row `theme` (dark/light), the Shift+T write |
| 5 | C1-081 theme all widgets | NOT BUILT (it.todo kept) | the product write touches every widget's opts and N global prefs; needs a board-level capability with multi-pref undo |
| 6 | C1-092 volume-pane overlay | STOP | `volumeOverlayIndicators` is `owned:indicator` (Indicator Intelligence) |
| 7 | C1-127 open Chart Settings | NOT BUILT (it.todo kept) | no host hook reaches `ChartWidget` `paneRef.openSettings`; needs a host.charts adapter change |

None of the built rows touch #988's targeting files (`deixis.js`, `spatialCheck.js`, `clickRef.js`).

## Try it (owner), and known limits

All three are ordinary `chart.setSetting` rows: the chart is chosen by the existing targeting (selected chart, a named
chart, "every chart except X"); an excluded or ambiguous chart is not written. Undo restores the previous settings blob
exactly (a key the chart never had is removed again).

* **C1-058**: "align the watermark to the left" / "right-align the watermark text" (tested); "center the watermark" uses the same row but has no test of its own.
  Limits: needs the watermark on; with it off the Agent says to turn it on first (same rule as watermark size/weight).
  Three positions only (left/center/right); no free x/y here (that is `watermark.x|y`).
* **C1-067**: "make the header title gold", "green up days and orange down days in the header", "make the chart legend
  text white", "colour the Company Name in the info row purple, % Change green when up and red when down".
  Limits: the stored value is a hex colour (#rrggbb); a colour name is turned into hex by the model. Only keys the
  header catalog names are writable; any other `header.colors.*` key stays a KNOWN row (the Agent says where it lives).
  A colour shows only where its item is on screen (an Info-row field that is turned off shows nothing).
  "Reset the header colours to default" is not tested and is not expected to work (no row removes a colour key).
* **C1-078**: "switch this chart to the light palette" / "put this chart back on the dark palette".
  Limits: light/dark only (the Shift+T toggle); named gallery themes stay `chart.applyTheme` / `chart.applyThemeAll`.

Test evidence is scripted-plan (the outcome tests give the plan the model would return; no paid model call was made).
Whether the live model picks these rows from the sentence is not measured here.

## Evidence (head after the merge)

* Red first: `39120427dd`, `chartSettings.outcome.test.jsx` 14 failed on the base.
* Focused vitest, no lock, 16 files: 16 passed, 228 tests passed, 4 todo (the 4 not-built/stopped gaps).
  Files: agentChartSettingsTruth, agentChartSettingsW1B, agentContracts, agentNl1Selection, agentW11RepairA,
  chartSettings.outcome, settingsLiveness, chartSettingsDescriptors, headerFields, ChartSettingsModal.header-colors,
  ChartWidget.agent, agentRouting, noRegexLookbehind, agentNoLookbehindStrings, controlDoorCensus, agentExecFamilies.
* Backend pytest (real pytest, focused, reads the golden manifest): test_uct_agent_contract, test_uct_agent_args_live_shapes,
  test_uct_agent_autoapply: 184 passed.
* Mutants, all killed: M1 no `watermark.align` row (6 tests fail); M2 palette option typo (6); M3 header colours not
  generated from the catalog (1); M4 signed fields not split pos/neg (1); M5 Undo leaves a default instead of removing
  the key (1).
* Controls per built gap: a named other chart (SPY) changes SPY only; "every chart except QQQ" never touches QQQ.

## Files (git diff --stat origin/master HEAD)

```
 app/src/agent/agentChartSettingsW1B.test.jsx                  |  5 +--
 app/src/agent/capabilities/chart.js                           |  9 +++---
 app/src/agent/contract/manifest.golden.json                   | 39 ++++++++++++++++++++++-
 app/src/agent/qa/chartsOutcome/chartSettings.outcome.test.jsx | 88 +++++++++++++++++++++++++++++++++++++++++++++------
 app/src/agent/settingsLiveness.test.js                        |  3 +-
 app/src/components/chart/chartSettingsDescriptors.js          | 29 ++++++++++++++++-
 app/src/components/chart/chartSettingsDescriptors.test.js     |  9 +++++-
 docs/agent/program/PR-chart-settings-gaps.md                  | (this file)
```

Product code is 2 files (~38 lines); the rest is tests, the golden manifest and this doc. One PR is the smallest
releasable unit: the three rows share the hints string under the 1000-char cap and one golden manifest, so splitting
them would mean regenerating the golden three times for no gain. No split proposed.

## Coverage ledger

225/484 is VOID. This PR does not cite it.
