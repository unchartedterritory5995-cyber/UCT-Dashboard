# Execution family: chart display settings (pl-auto, 2026-11-10)

Branch `agent/pl/exec-chart-settings`, off origin/master `dfc645ccb3`. Test code only, no product changes.
Test file: `app/src/agent/qa/chartsOutcome/chartSettings.outcome.test.jsx`.

## Method

- One table-driven outcome test over the real Agent panel (`outcomeHarness`: AgentPanel, useAgent, registry, policy, runtime, receipts, Undo) and the fixture board's chart writer (`__fixtures__/board.js`, `charts.commit`).
- The board has four charts (SPY / QQQ / NVDA / TSLA). The member has selected the top-right chart. The scripted model reads its target from `body.context` (the chart marked `selected`). The test fails if the request does not carry that target.
- Each case does four things:
  1. The member sends a natural request.
  2. The scripted plan calls the existing capability.
  3. The test reads the chart's stored blob back through the product's own resolver (`settingValue` over `mergeChartSettings`, which is what Chart Settings shows). A `watermarkPos` row reads `opts.watermarkPos`.
  4. The test checks that the other three charts are byte-identical, says "undo", and checks that the target chart's `opts` are byte-identical to before.
- The test never asserts against the plan or a receipt alone.
- Each case is named with its row id, so the ledger reader can match it.
- C1-080 wires the fixture board's `widgetOps.themeAll` to the product's pure `themeAllChartWidgets` (the same function ChartsWorkspace's `themeAll` calls, seeded with `mergeChartSettings(null)` instead of the member's prefs). This is test wiring only.

## Per-row results

| Row | Request | Capability + args | Read-back asserted | Result |
|---|---|---|---|---|
| C1-015 | show the breadth chart as a line | chart.setType {type:'line'} on a breadth series (UCTA50) | `breadthChartType`='line', `chartType` stays 'bars' | PASS |
| C1-016 | switch this chart to heikin ashi candles | chart.setSetting heikinAshi=true | heikinAshi=true | PASS |
| C1-017 | color the candles by open vs close | chart.setSetting candleColorMode='openclose' | candleColorMode='openclose' | PASS |
| C1-018 | make the bars thicker on this chart (Bars chart) | chart.setSetting candles.thinBars=false | candles.thinBars=false | PASS |
| C1-024 | flip the price scale upside down | chart.setSetting invertScale=true | invertScale=true | PASS |
| C1-050 | gradient background with a navy top | setSetting bgMode='gradient', bgGradient.top='#1a2b4c' | both | PASS |
| C1-051 | only show the crosshair while I hold the mouse | setSetting crosshair.mode='hold' | crosshairModeOf = 'hold' | PASS |
| C1-052 | crosshair red, 2px, dashed | setSetting crosshair.color / .width=2 / .style='dashed' | color '#ff0000', width 2, style 2 | PASS |
| C1-053 | turn on the magnet crosshair | setSetting crosshair.magnet=true | magnet=true | PASS |
| C1-054 | hide the last price label and show the MA labels | setSetting showPriceLabels=false, showMaLabels=true | both | PASS (see NL finding) |
| C1-055 | bump the scale text up to 14 / make the scale text yellow | setSetting textSize=14; textColor='#ffff00' | textSize=14; textColor is refused with its `inert` reason and nothing is written | PARTIAL (SIMULATED): size covered; colour not (refused by design) |
| C1-056 | hide the watermark | setSetting watermark.visible=false | false | PASS |
| C1-057 | company off the watermark, add the logo | setSetting watermark.lines.company=false, .logo=true | both | PASS |
| C1-059 | watermark bigger, bold, blue, 30% opacity | setSetting watermark.sizeScale=2, .weight=700, .color, .opacity=0.3 | all four | PASS |
| C1-061 | put the watermark back in the middle (seed: moved) | setSetting watermark.x=0.5, watermark.y=0.5 | opts.watermarkPos x/y = 0.5 | PARTIAL (SIMULATED): the centred state is covered; the product's Reset write (`watermarkPos: null`, ChartWidget.jsx:499) is not |
| C1-062 | ticker and company in the title | setSetting header.titleMode='both' | 'both' | PASS |
| C1-063 | hide the day change next to the title | setSetting header.showChange=false | false | PASS |
| C1-064 | only show the legend when I hold the crosshair | setSetting header.legendMode='hold' | legendModeOf = 'hold' | PASS |
| C1-068 | swing labels on, high sensitivity | setSetting swingLabels.enabled=true, .sensitivity='high' | both | PASS |
| C1-069 | swing labels tinted, green/red, grey bg (seed: swing on) | setSetting swingLabels.tintByType, .upColor, .downColor, .bg | all four | PASS |
| C1-070 | show earnings and news markers | setSetting markers.earnings, markers.news = true | both | PASS |
| C1-071 | beat green, miss red, yellow IPO (seed: earnings on) | setSetting markers.earningsBeat / earningsMiss / ipoColor | all three | PASS |
| C1-072 | turn off the previous day high line (5m) | setSetting prevDayLevels.high.enabled=false | false | PASS |
| C1-073 | prior day low solid, 3px, magenta (5m) | setSetting prevDayLevels.low.style / width / color | all three | PASS |
| C1-075 | show the bar close countdown (5m) | setSetting countdown=true | true | PASS |
| C1-076 | restore this chart to the default look | chart.resetDefaults {} (proposal → Apply) | background and grid.visible equal CHART_DEFAULTS, invertScale off, overlays (indicator-owned) unchanged | PASS |
| C1-080 | apply the <theme> theme to all my charts | chart.applyThemeAll {theme} on the board ref | each of 4 charts' settings equal `themeAllChartWidgets` output; the news widget is unchanged; Undo restores every widget's opts | PASS |
| C1-087 | remove volume from this chart | volume.setState {state:'removed'} | volume.removed=true | PASS |
| C1-090 | stop highlighting the highest volume candle | setSetting volume.hvcEnabled=false | false | PASS |
| C1-091 | volume colours, 50 MA in white, hide label, histogram | setSetting volume.upColor / downColor / maPeriod=50 / maColor / labelVisible=false / barStyle='histogram' | all six | PASS |
| C1-144 | position calculator: 25k account, 0.5% risk | setSetting positionCalc.accountSize=25000, .riskPct=0.5 | both | PARTIAL (SIMULATED): inputs covered; placing the calculator drawing (drawing family) is not |
| C2-013 | turn on Chart IQ pattern recognition | setSetting showChartIq=true | true | PASS |
| C1-058 | watermark alignment | none | n/a | GAP (it.todo) |
| C1-067 | header colours | none (`header.colors.*` is KNOWN) | n/a | GAP (it.todo) |
| C1-077 | save / delete a custom colour | none | n/a | GAP (it.todo) |
| C1-078 | light/dark palette (Shift+T) | none (`theme` is KNOWN) | n/a | GAP (it.todo) |
| C1-081 | apply a theme to all widgets | none | n/a | GAP (it.todo) |
| C1-092 | overlay an indicator on volume | none (owned:indicator) | n/a | GAP (it.todo), owned by another project |
| C1-127 | open Chart Settings (Alt+, / gear) | none | n/a | GAP (it.todo) |

**Candidates for VERIFIED (29):** C1-015, 016, 017, 018, 024, 050, 051, 052, 053, 054, 056, 057, 059, 062, 063, 064, 068, 069, 070, 071, 072, 073, 075, 076, 080, 087, 090, 091, and C2-013.

**PARTIAL (SIMULATED), not VERIFIED (3), per AUDIT on PR #1016:**
- C1-055: text size is covered. Colour is not; it is refused as inert by design.
- C1-061: the centred end state is covered. The product's own Reset write (`watermarkPos: null`) is not.
- C1-144: the calculator inputs are covered. Placing the drawing is not.

The status doc records these as described in its "Update 2026-11-10" section.

## Gap list (for pl-exec)

1. **C1-058, watermark alignment.** `CHART_DEFAULTS.watermark` has no alignment key, and `chartSettingsDescriptors.js:98-193` has no ELIGIBLE row for one. The product needs the setting before the Agent can write it.
2. **C1-067, header colours.** `header.colors.*` is `K(...)` KNOWN at `chartSettingsDescriptors.js:243`, so `chart.setSetting` rejects it. Fix: a typed eligible row per colour key (as with `bgGradient.top`), or a map writer.
3. **C1-077, save / delete a custom colour.** No capability writes the colour picker's saved swatches. Fix: a new capability over the picker's own store.
4. **C1-078, light/dark palette (Shift+T).** `theme` is KNOWN at `chartSettingsDescriptors.js:246`. Fix: promote it to an eligible enum `['dark','light']`. Note that `canvasLock` (`:352`) already reads `settings.theme === 'light'`.
5. **C1-081, apply a theme to all widgets.** `chart.applyThemeAll` (`capabilities/board.js:1414`) themes chart widgets and chart tabs only. Nothing calls `mapThemeToWidgetSettings` (`chartThemes.js:528`) or writes `WIDGET_GLOBAL_PREF_KEYS`. Fix: a `widget.applyThemeAll`, or a scope arg on chart.applyThemeAll.
6. **C1-092, overlay an indicator on volume.** `volumeOverlayIndicators` is `owned:indicator` (`chartSettingsDescriptors.js:226`). This is out of this family; route it to Indicator Intelligence.
7. **C1-127, open Chart Settings.** No capability opens the dialog. There is nothing in `capabilities/chart.js` or `chartSetup.js`, and the host exposes no open-settings hook.
8. **C1-061, follow-up (optional).** If exact parity with right-click Reset is wanted, add a `watermarkPos: null` write: a "reset" value on watermark.x/y, or a `chart.resetWatermark`. Today the Agent writes 0.5 / 0.5 with `anchor: null`.

**NL finding (not a capability gap).** "hide the price label **on the axis** and show the moving average labels" never reaches the model. A pre-model resolver reads "axis" as a ticker and answers "I'm not sure which instrument "axis" means…" (the text comes from `capabilities/marketDataResolve.js`). The test uses "hide the last price label…" instead. This is worth a held-out phrasing for the routing / NL owners.

## Run

Command (from `C:/w/pl-auto-cs`, `BN_CWD='C:\w\pl-auto-cs\app'`, shared lock, below-normal priority):

```
timeout 900 python C:/w/pl-auto/tools/agent_suite_lock.py run --who pl-auto -- powershell -NoProfile -ExecutionPolicy Bypass -File "<scratchpad>\pl-auto\bn.ps1" node node_modules/vitest/vitest.mjs run src/agent/qa/chartsOutcome/chartSettings.outcome.test.jsx
```

Result (vitest, scripted model (jsdom/panel), not a real browser):
`Test Files 1 passed (1) · Tests 33 passed | 7 todo (40)` (first commit, before the routing block)

Current file, after the held-out routing block and its KNOWN GAP pins (see `PR-exec-chart-settings.md`): **40 passed + 5 known-gap (pinned) + 7 todo** (vitest raw count `Tests 45 passed | 7 todo (52)`: vitest counts an `it.fails` as passed). The 40 are 33 outcome cases, 2 routing cases that hold, and 5 KNOWN GAP pins.

Caveats:
- The model is scripted. This proves the request carries the target, and that a correct plan changes the chart's stored settings and Undo restores them. It does not prove that a paid model picks this plan.
- It does not prove that StockChart paints the stored value. `settingsLiveness.test.js` is the source-level rail for that.
- The C1-080 theme-all writer is seeded with product defaults, not the member's prefs.
