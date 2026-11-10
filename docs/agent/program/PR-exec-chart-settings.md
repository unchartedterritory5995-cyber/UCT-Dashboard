# PR: execution family, chart display settings

Branch `agent/pl/exec-chart-settings`, off origin/master `dfc645ccb3`.

## Scope

- One table-driven outcome test, `app/src/agent/qa/chartsOutcome/chartSettings.outcome.test.jsx`. It covers the C1 Settings, Volume, Chart type and Themes rows that were not verified, plus C1-024, C1-144 and C2-013.
- A held-out routing block in the same file: chart nouns are never ticker symbols.
- Doc updates:
  - `docs/agent/CHARTS_EXECUTION_STATUS.md`: 32 rows raised to VERIFIED, counts recounted.
  - `docs/agent/program/EXEC-CHART-SETTINGS.md`: method and per-row ledger.
  - This file.
- Test and docs only. **No product code changes.**

Method: each case mounts the real Agent panel over a four-chart fixture board, with the top-right chart selected. The member sends a natural request, and the scripted model plans from the request it was sent. The plan calls the existing capability. The test then:
1. reads the chart's stored settings back through the product's resolver (`settingValue` over `mergeChartSettings`);
2. checks the other three charts are byte-identical;
3. says "undo" and checks the chart is byte-identical to before.

## Per-row table

| Row | Request | Capability + args | Read-back asserted | Result |
|---|---|---|---|---|
| C1-015 | show the breadth chart as a line | chart.setType {type:'line'} on a breadth series | `breadthChartType`='line', `chartType` unchanged | PASS |
| C1-016 | switch this chart to heikin ashi candles | chart.setSetting heikinAshi=true | heikinAshi | PASS |
| C1-017 | color the candles by open vs close | setSetting candleColorMode='openclose' | candleColorMode | PASS |
| C1-018 | make the bars thicker on this chart | setSetting candles.thinBars=false (Bars chart) | thinBars | PASS |
| C1-024 | flip the price scale upside down | setSetting invertScale=true | invertScale | PASS |
| C1-050 | gradient background with a navy top | setSetting bgMode='gradient', bgGradient.top | both | PASS |
| C1-051 | only show the crosshair while I hold the mouse | setSetting crosshair.mode='hold' | crosshairModeOf | PASS |
| C1-052 | crosshair red, 2px, dashed | setSetting crosshair.color / width / style | all three | PASS |
| C1-053 | turn on the magnet crosshair | setSetting crosshair.magnet=true | magnet | PASS |
| C1-054 | hide the last price label and show the MA labels | setSetting showPriceLabels=false, showMaLabels=true | both | PASS (see routing family) |
| C1-055 | bump the scale text up to 14 / make the scale text yellow | setSetting textSize=14; textColor | size written; colour refused with its `inert` reason, nothing written | PASS, qualified: size only |
| C1-056 | hide the watermark | setSetting watermark.visible=false | visible | PASS |
| C1-057 | company off the watermark, add the logo | setSetting watermark.lines.company / .logo | both | PASS |
| C1-059 | watermark bigger, bold, blue, 30% | setSetting watermark.sizeScale / weight / color / opacity | all four | PASS |
| C1-061 | put the watermark back in the middle | setSetting watermark.x=0.5, watermark.y=0.5 | opts.watermarkPos x/y | PASS, qualified: same state, different write from the product Reset (`watermarkPos: null`) |
| C1-062 | ticker and company in the title | setSetting header.titleMode='both' | titleMode | PASS |
| C1-063 | hide the day change next to the title | setSetting header.showChange=false | showChange | PASS |
| C1-064 | legend only while holding the crosshair | setSetting header.legendMode='hold' | legendModeOf | PASS |
| C1-068 | swing labels on, high sensitivity | setSetting swingLabels.enabled, .sensitivity | both | PASS |
| C1-069 | swing labels tinted, green/red, grey bg | setSetting swingLabels.tintByType / upColor / downColor / bg | all four | PASS |
| C1-070 | show earnings and news markers | setSetting markers.earnings, markers.news | both | PASS |
| C1-071 | beat green, miss red, yellow IPO | setSetting markers.earningsBeat / earningsMiss / ipoColor | all three | PASS |
| C1-072 | turn off the previous day high line | setSetting prevDayLevels.high.enabled=false | enabled | PASS |
| C1-073 | prior day low solid, 3px, magenta | setSetting prevDayLevels.low.style / width / color | all three | PASS |
| C1-075 | show the bar close countdown | setSetting countdown=true | countdown | PASS |
| C1-076 | restore this chart to the default look | chart.resetDefaults (proposal, then Apply) | defaults back, overlays kept | PASS |
| C1-080 | apply a theme to all my charts | chart.applyThemeAll {theme} | all 4 charts equal `themeAllChartWidgets` output; news widget unchanged | PASS |
| C1-087 | remove volume from this chart | volume.setState {state:'removed'} | volume.removed | PASS |
| C1-090 | stop highlighting the highest volume candle | setSetting volume.hvcEnabled=false | hvcEnabled | PASS |
| C1-091 | volume colours, 50 MA white, no label, histogram | setSetting volume.upColor / downColor / maPeriod / maColor / labelVisible / barStyle | all six | PASS |
| C1-144 | position calculator 25k, 0.5% risk | setSetting positionCalc.accountSize / riskPct | both | PASS, qualified: calculator inputs only (placing the drawing is the drawing family) |
| C2-013 | turn on Chart IQ pattern recognition | setSetting showChartIq=true | showChartIq | PASS |
| C1-058, 067, 077, 078, 081, 092, 127 | (see gap list) | none | n/a | GAP (`it.todo`) |

## Gap list (missing pieces, for pl-exec)

1. **C1-058, watermark alignment.** `CHART_DEFAULTS.watermark` has no alignment key, and there is no ELIGIBLE row (`components/chart/chartSettingsDescriptors.js:98-193`).
2. **C1-067, header colours.** `header.colors.*` is KNOWN, not eligible (`chartSettingsDescriptors.js:243`). Needs typed eligible colour rows or a map writer.
3. **C1-077, save / delete a custom colour.** No capability writes the colour picker's saved swatches.
4. **C1-078, light/dark palette (Shift+T).** `theme` is KNOWN (`chartSettingsDescriptors.js:246`). Needs promoting to an eligible enum `['dark','light']`; `canvasLock` (`:352`) already reads it.
5. **C1-081, theme to all widgets.** `chart.applyThemeAll` (`agent/capabilities/board.js:1414`) themes charts and chart tabs only. Nothing calls `mapThemeToWidgetSettings` (`components/chart/chartThemes.js:528`).
6. **C1-092, overlay an indicator on volume.** `volumeOverlayIndicators` is owned:indicator (`chartSettingsDescriptors.js:226`). It belongs to Indicator Intelligence.
7. **C1-127, open Chart Settings.** No capability opens the dialog; nothing in `capabilities/chart.js` or `chartSetup.js`.
8. **Optional, C1-061.** For exact parity with right-click Reset, add a `watermarkPos: null` write (ChartWidget.jsx:499).

## Routing family for pl-exec: chart nouns read as tickers

"hide the price label on the axis" never reaches the model. Before the model runs, a fast path that answers price questions (`agent/capabilities/marketDataPhrases.js` `parsePriceSentence`) treats any non-grammar word as a ticker candidate, and "price" counts as a quote frame. The only nouns it skips are those in `NOT_A_TICKER` (`marketDataPhrases.js:31`). The resolver then answers with `agent/capabilities/marketDataResolve.js` `clarifyText`: "I'm not sure which instrument "axis" means…".

The held-out block in `chartSettings.outcome.test.jsx` ("held-out routing: chart nouns are never ticker symbols") has one phrasing per noun:

| Case | Phrasing | Today |
|---|---|---|
| ROUTE-NOUN axis | hide the price label on the axis | KNOWN GAP (`it.fails`) |
| ROUTE-NOUN scale | show me the price scale | KNOWN GAP (`it.fails`) |
| ROUTE-NOUN crosshair | show the price on the crosshair | KNOWN GAP (`it.fails`) |
| ROUTE-NOUN legend | show the price legend | KNOWN GAP (`it.fails`) |
| ROUTE-NOUN watermark | show the price in the watermark | KNOWN GAP (`it.fails`) |
| ROUTE-NOUN grid | show the grid lines at the price | holds (`it`) |
| ROUTE-NOUN label | hide the price labels | holds (`it`) |

Each case asserts `parsePriceSentence(text) === null`, which means the sentence goes on to the model. An `it.fails` case passes while the gap exists and turns red once it is fixed; then make it a plain `it`. A likely fix is to add the chart nouns (axis, scale, legend, crosshair, watermark) to `NOT_A_TICKER`. That is a product change and is not made here.

## Run

From `C:/w/pl-auto-cs` with `BN_CWD='C:\w\pl-auto-cs\app'`, through the shared lock at below-normal priority:

```
timeout 900 python C:/w/pl-auto/tools/agent_suite_lock.py run --who pl-auto -- powershell -NoProfile -ExecutionPolicy Bypass -File "<scratchpad>\pl-auto\bn.ps1" node node_modules/vitest/vitest.mjs run src/agent/qa/chartsOutcome/chartSettings.outcome.test.jsx
```

Result (vitest, scripted model (jsdom/panel), not a real browser):
`Test Files 1 passed (1) · Tests 40 passed | 7 todo (47)`

The 40 passes are the 33 outcome cases and the 7 routing cases (5 of them `it.fails`).

## Caveats

- **The model is scripted.** The test proves that the request carries the target, and that a correct plan changes the stored settings and Undo restores them. It does not prove that a paid model would pick that plan.
- **It does not prove StockChart paints the value.** Read-back is from the stored settings blob. The source-level rail for paint is `settingsLiveness.test.js`. No real browser was used.
- **C1-080 wiring.** The fixture board has no `themeAll`, so the test sets `m.board.widgetOps.themeAll` to the product's `themeAllChartWidgets`. It is seeded with `mergeChartSettings(null)`, not the member's prefs as ChartsWorkspace does.
- **The routing cases are pure parser checks.** They do not mount the panel.
- **No generator for the status doc.** `CHARTS_EXECUTION_STATUS.md` was edited by script. The recount was checked to reproduce the existing counts exactly before the edit. The P0 count (58 of 74) was not recounted, because the doc has no per-row P0 tag.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
