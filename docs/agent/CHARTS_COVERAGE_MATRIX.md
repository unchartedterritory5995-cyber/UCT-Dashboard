# Charts coverage matrix

Working inventory of human actions in the Charts workspace, for Phase 1 of `docs/UCT_AGENT_PRODUCT_CONTRACT.md`. Generated 2026-11-05 at master 179d57570d by reading code and tests. No test was run for this inventory, so VERIFIED rows are claims to confirm. Part 3 VERIFIED rows are state-level on a fixture board, and no test mounts the real ChartsWorkspace. The denominator will grow.

| Part | Actions | VERIFIED | IMPLEMENTED / UNVERIFIED | MISSING | BLOCKED | UNMAPPED |
|---|---|---|---|---|---|---|
| Chart surface | 175 | 56 | 44 | 51 | 15 | 9 |
| Indicators | 101 | 32 | 32 | 27 | 5 | 5 |
| Workspace | 223 | 55 | 21 | 128 | 13 | 6 |
| Total | 499 | 143 | 97 | 206 | 33 | 20 |


# Charts inventory, part 1: the individual chart surface

Source: commit `179d57570d`, read with `git show` / `git grep` only. No test was run, so VERIFIED means a named test exists and asserts the final state. It does not mean I watched it pass. Every panel test uses a scripted model, so none of this is evidence about the real planner model.

## State definitions (owner schema)

| State | Meaning here |
|---|---|
| VERIFIED | An end-to-end test through the real Agent panel reads back the resulting state. The test is named. |
| IMPLEMENTED / UNVERIFIED | A capability exists, but the only proof is source inspection, or a runtime test below the panel. |
| MISSING | The control exists and no capability does it. |
| BLOCKED | The Agent should not do it yet, or cannot prove it. The reason is in the row. |
| UNMAPPED | The control exists, but this pass did not settle how it maps, or whether it is reachable on desktop /charts. |

Follow-ups: `yes` only where a test has a later turn acting on this capability. `unknown` means no such test found. `no` means there is no capability to follow up on.

Evidence shorthand:
- `c:<id>` is a corpus intent in `app/src/agent/qa/capabilityRegression/corpus.finalState.*.test.jsx`, driven from `baseline/corpus.json`. It runs through the real panel and asserts final state.
- `GW-nn` is a workflow in `qa/capabilityRegression/golden.test.jsx`.
- Test files without a path are in `app/src/agent/`.

Path shorthand:
- SC `app/src/components/StockChart.jsx`
- CP `app/src/components/chart/pane/ChartPane.jsx`
- CIR `.../pane/ChartIdentityRow.jsx`
- CTF `.../pane/ChartTfBar.jsx`
- TB `app/src/components/chart/ChartToolbar.jsx`
- CSM `.../chart/ChartSettingsModal.jsx`
- CDO `.../chart/ChartDrawingOverlay.jsx`
- KS `.../chart/keyboardShortcuts.js`
- SS `.../chart/SymbolSearch.jsx`
- CTM `.../chart/ChartThemesModal.jsx`
- SP `.../chart/ScreenshotPopover.jsx`
- PP `.../chart/PositionPanel.jsx`
- TP `.../chart/TracingsPanel.jsx`
- CHM `.../chart/legend/chipMenu.js`
- DS `.../chart/drawingsStore.js`
- TFM `app/src/pages/charts/widgets/TimeframeMenu.jsx`
- CDN `.../widgets/ChartDateNav.jsx`
- CW `app/src/pages/charts/ChartsWorkspace.jsx`
- CSP `app/src/pages/charts/CompareSymbolsPanel.jsx`
- RP `app/src/pages/charts/ReplayPanel.jsx`
- Wid `.../widgets/ChartWidget.jsx`

Not rowed separately: mobile sheets (`pages/charts/mobile/*`, `MobileDrawBar`), which are alternate doors. Widget and board actions and chart tabs belong to other parts. Indicator actions are rowed only where they sit on the chart surface.

## Matrix

| ID | Area | Human action | UI control | Canonical writer/hook | Agent capability | State | Evidence | Follow-ups | Confirm / Undo | Missing work | Example phrase | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C1-001 | Symbol | Change ticker by search pick | SS:354 | CP:775 handleSymbolChange, Wid group link | chart.setSymbol | VERIFIED | c:symbol.switch; GW-01; GW-09 | yes (GW-01) | Auto; exact Undo tested | None | "pull up AMD" | P0 |
| C1-002 | Symbol | Type-to-search on focused chart | CP:1021 handleChartKeyDown | searchRef.openWith | chart.setSymbol | VERIFIED | Same outcome as C1-001 | yes (GW-01) | Auto; exact Undo tested | None | "chart NVDA" | P0 |
| C1-003 | Symbol | Filter search by category chip | SS:339 | SS setChip | none | MISSING | No capability; company-name lookup in chart.setSymbol prepare is not a category filter | no | n/a | Decide if a "find ETFs named X" read is wanted | "search ETFs for semis" | P2 |
| C1-004 | Symbol | Open a free-typed symbol with no result row | SS:399 | SS submit | chart.setSymbol | VERIFIED | Unknown ticker refused: c:symbol.switch plus refuse.bqa1 evidence | yes (GW-01) | Refuses unknown tickers | None | "show XYZ" | P2 |
| C1-005 | Symbol | Flag current ticker (Shift+F) | CP:1021 via matchesChord | toggleFlag | none | MISSING | discovery watchlists known lists flagging; operator plan: flagged list syncs as a whole set | no | n/a | Capability over the whole-set write, with Undo | "flag this ticker" | P0 |
| C1-006 | Timeframe | Pick preset timeframe on bar | CTF:28 | CP handleTf, onTfChange | chart.setTimeframe | VERIFIED | c:timeframe.weekly; c:timeframe.5m; c:compound.change-then-undo | yes (2-op plan, GW-01) | Auto; exact Undo tested | None | "switch to weekly" | P0 |
| C1-007 | Timeframe | Pick from full timeframe menu | TFM:27 | onSelect, onTfChange | chart.setTimeframe, chart.addCustomTimeframe | IMPLEMENTED / UNVERIFIED | CHART_TIMEFRAMES is native only, so a saved custom code goes through addCustomTimeframe with switch:true; no test of selecting an existing custom | unknown | Auto; exact Undo | Corpus case: switch to an existing custom timeframe | "go to the 45 minute" | P1 |
| C1-008 | Timeframe | Add custom interval | TFM:54 | CP:512 addCustomTf | chart.addCustomTimeframe | VERIFIED | c:chart.addCustomTimeframe | unknown | Auto; exact Undo tested | None | "add a 45 minute timeframe" | P1 |
| C1-009 | Timeframe | Delete custom interval | TFM:30 | CP:516 removeCustomTf | chartSetup.removeTimeframe | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1 runtime read-back; coverage all ✗ | unknown | Auto; exact Undo (runtime test) | Panel/corpus case | "remove the 45 minute timeframe" | P2 |
| C1-010 | Timeframe | Star a favourite timeframe | TFM:25 | CP:508 toggleTfFav | chartSetup.favoriteTimeframe | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1 runtime read-back; coverage all ✗ | unknown | Auto; exact Undo declared | Panel/corpus case | "star the 2 hour" | P2 |
| C1-011 | Timeframe | Timeframe keys with repeat-press cycle | KS:102-109 | resolveTfCycle | chart.setTimeframe | VERIFIED | Direct outcome as C1-006; cycling itself has no spoken equivalent | yes (GW-01) | Auto; exact Undo tested | None | "go up one timeframe" (not handled) | P0 |
| C1-012 | Timeframe | Change timeframe from right-click | SC:6051 | onTfChange | chart.setTimeframe | VERIFIED | Same outcome as C1-006 | yes | Auto; exact Undo tested | None | "make it daily" | P2 |
| C1-013 | Chart type | Choose chart type in settings | CSM:1671 | CSM:647 setType | chart.setType | VERIFIED | c:charttype.line | unknown | Auto; exact Undo declared, coverage undo ✗ | Undo case | "make it a line chart" | P0 |
| C1-014 | Chart type | Choose chart type from right-click | SC:6055 | setCs('chartType') | chart.setType | VERIFIED | c:charttype.line | unknown | Auto; undo untested | Undo case | "show bars" | P1 |
| C1-015 | Chart type | Breadth Line/Candles quick toggle | CP:977 | CP:366 toggleBreadthLine | chart.setType (breadthChartType via typeKeyOf) | IMPLEMENTED / UNVERIFIED | Source only; no breadth-symbol type test found | unknown | Auto; exact Undo declared | Breadth case | "show breadth as a line" | P2 |
| C1-016 | Chart type | Heikin Ashi candles | Only found at TB:615; reachability unverified | SC:9537 toHeikinAshi | chart.setSetting heikinAshi | UNMAPPED | Descriptor says not drawn on /charts, yet SC applies the transform when cs.heikinAshi is set | unknown | Auto; Undo | Confirm whether any /charts control exists and fix the descriptor text | "heikin ashi candles" | P2 |
| C1-017 | Chart type | Candle colour mode | CSM:1712 | CSM:653 setColorMode | chart.setSetting candleColorMode | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "colour candles by net change" | P2 |
| C1-018 | Chart type | Thin bars | CSM:1693 | setSetting candles.thinBars | chart.setSetting candles.thinBars | IMPLEMENTED / UNVERIFIED | Refusal rule in descriptor; no row test | unknown | Auto; Undo | Row test | "thin bars" | P2 |
| C1-019 | Session | Regular/extended on intraday | CIR:122, CIR:128 | CP:339 setExtHours | chart.setSession | VERIFIED | c:session.extended | unknown | Auto; exact Undo tested | None | "show extended hours" | P0 |
| C1-020 | Session | Regular/extended on D/W/M | CIR:105, CIR:111 | CP:327 setSessionView | chart.setSession | IMPLEMENTED / UNVERIFIED | Source: check mirrors extEnabled; I did not confirm which timeframe c:session.extended uses | unknown | Auto; exact Undo | Daily-chart case inside and outside the ext window | "include premarket on the daily" | P1 |
| C1-021 | Session | Extended hours from price-axis menu | SC:6257 | setCs('extendedHoursShading') | chart.setSession | VERIFIED | c:session.extended | unknown | Auto; exact Undo tested | None | "extended hours off" | P2 |
| C1-022 | Scale | Arithmetic/log/percent from menu | SC:6240-6242 | SC:3144 setScale | chart.setScale | VERIFIED | c:scale.log; GW-01 | yes (GW-01) | Auto; exact Undo tested | None | "log scale" | P0 |
| C1-023 | Scale | Toggle log (Shift+L) | KS:139 | SC toggle:log | chart.setScale | VERIFIED | c:scale.log | yes | Auto; exact Undo tested | None | "log" | P1 |
| C1-024 | Scale | Invert scale (Alt+I) | KS:143 | setCs invertScale | chart.setSetting invertScale | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "flip the chart upside down" | P2 |
| C1-025 | Scale | Auto-scale | SC:6244 | SC:5971 autoScale | none | MISSING | Not in manifest | no | n/a | Capability with a price-scale read-back | "auto fit the price" | P1 |
| C1-026 | Scale | Drag price axis to compress | SC price scale drag (carryDragPlacement, CP prop) | viewLock capture | none | BLOCKED | Operator plan: no read-back the Agent can verify | no | n/a | A readable view-state contract | "squeeze the price scale" | P2 |
| C1-027 | View | Reset view | SC:6272 | SC:5853 doResetView | none | BLOCKED | Discovery known and operator plan: no verifiable read-back; the API exists at SC:17770 | no | n/a | Read-back of the view, then a capability | "reset the chart" | P0 |
| C1-028 | View | Zoom in/out (+/-) | KS:171 | SC:9223 | none | BLOCKED | Same read-back gap as C1-027 | no | n/a | View-state contract | "zoom out" | P0 |
| C1-029 | View | Range buttons (3M/6M/YTD/1Y/5Y) | SC:1004 RANGE_OPTS | SC:18642 applyRange | none | MISSING | Not in manifest; a named range has a readable target, unlike free zoom | no | n/a | chart.setRange using applyRange | "show one year" | P0 |
| C1-030 | Go to date | Type a date in Time Navigator | CDN:214 | paneRef goToDate (CP imperative) | chart.goToDate | VERIFIED | c:chart.goToDate; agentBatch6 | unknown | Auto; exact Undo declared, coverage undo ✗; undoNote when prior view unknown | Undo case | "go to March 15 2024" | P1 |
| C1-031 | Go to date | Pick date or year in calendar | CDN:125, CDN:140 | goToDate, goToYear | chart.goToDate | VERIFIED | Date outcome as C1-030; a bare year is not separately tested | unknown | Auto; Undo untested | Year-only phrase case | "go to 2020" | P2 |
| C1-032 | Go to date | Step one bar back/forward | CDN:205, CDN:226 | stepBar | none | MISSING | Not in manifest | no | n/a | Decide if useful outside replay | "back one bar" | P2 |
| C1-033 | Go to date | Open date box (Alt+G) | KS:175 | gotodate command | chart.goToDate | VERIFIED | Same outcome as C1-030 | unknown | Auto | None | "jump to last Friday" | P2 |
| C1-034 | Compare | Add a symbol | CSP:178 | CSP push, comparisonSymbols | chart.compare | VERIFIED | c:compare.amd; agentBatch6 | unknown | Auto; exact Undo tested | None | "compare with AMD" | P0 |
| C1-035 | Compare | Add a whole group | CSP:212 | CSP:100 addGroup | none | MISSING | chart.compare takes tickers only and writes no group field | no | n/a | Group arg resolved through the panel's own lookup | "compare against the semis group" | P1 |
| C1-036 | Compare | Remove one symbol | CSP:254, CSP:268 | CSP:128 removeSymbol | chart.compare remove | IMPLEMENTED / UNVERIFIED | agentBatch6 runtime test | unknown | Auto; Undo | Panel case | "take AMD off" | P1 |
| C1-037 | Compare | Remove a group | CSP:242 | CSP:129 removeGroup | none | MISSING | No group concept in chart.compare; individual removes only | no | n/a | As C1-035 | "remove the semis overlay" | P2 |
| C1-038 | Compare | Clear all comparisons | CSP:169 | CSP:130 clearAll | chart.compare clear | IMPLEMENTED / UNVERIFIED | agentBatch6 runtime test | unknown | Auto; Undo | Panel case | "clear comparisons" | P1 |
| C1-039 | Compare | Same/new scale per symbol | CSP:271-272 | CSP:136 setScaleMode | chartSetup.compareDisplay | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1 runtime read-back; coverage all ✗ | unknown | Auto; exact Undo (runtime) | Panel case | "put AMD on the main scale" | P2 |
| C1-040 | Compare | Same/new scale for a group | CSP:245-246 | CSP:139 setGroupScale | none | MISSING | compareDisplay is per symbol | no | n/a | Group target | "main scale for the group" | P2 |
| C1-041 | Compare | Group only (hide base) | CSP:282 | CSP:131 toggleHideBase | chartSetup.compareDisplay | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1 runtime read-back | unknown | Auto; exact Undo (runtime) | Panel case | "show only the comparisons" | P2 |
| C1-042 | Replay | Start from a date | RP:45, RP:79 | CW:1927 startReplay | chart.replay | VERIFIED | c:chart.replay; agentChartReplay panel test | yes (c:chart.replay.exit after an earlier turn) | Auto; exact Undo, tested in agentChartReplay | Coverage undo ✗ is stale against that test | "replay from Oct 15" | P1 |
| C1-043 | Replay | Choose replay timeframe | RP:61 | CW:1929 applyTfToCharts | none | MISSING | chart.replay passes no timeframe; a chained chart.setTimeframe is one chart, while the dialog applies to all | no | n/a | Timeframe arg | "replay from Oct 15 on the 5 minute" | P2 |
| C1-044 | Replay | Pick the cutoff on the chart | RP:55 | onArmPick, Wid replay pick | none | BLOCKED | Needs a live pointer click | no | n/a | None; a spoken date covers it | n/a | P2 |
| C1-045 | Replay | Exit replay | RP:73 | CW:1932 exitReplayMode | chart.replay null | VERIFIED | c:chart.replay.exit | yes | Auto; Undo restores cutoff | None | "exit replay" | P1 |
| C1-046 | Replay | Legacy bar replay play/step/speed/scrub | TB:2214-2250; KS:166-168 | SC replayMode | none | UNMAPPED | Bar exists only under replayMode; did not confirm onReplayToggle is passed on /charts | no | n/a | Confirm reachability | "play the replay" | P2 |
| C1-047 | Settings | Toggle grid | CSM:1131 | setGridVisible | chart.setSetting grid.visible | VERIFIED | c:chart.setSetting.grid | unknown | Auto; exact Undo tested | None | "hide the grid" | P1 |
| C1-048 | Settings | Solid/gradient background | CSM:1099 | CSM:856 setBgMode | chart.setSetting bgMode | VERIFIED | c:chart.setSetting.gradient | unknown | Auto; exact Undo tested | None | "turn the gradient off" | P2 |
| C1-049 | Settings | Solid background colour | CSM colour menu (activeTarget, CSM:911) | setSetting background | chart.setBackground | VERIFIED | c:chart.setBackground | unknown | Auto; exact Undo tested | None | "background to black" | P1 |
| C1-050 | Settings | Gradient colours | CSM:911 | setSetting bgGradient | chart.setSetting bgGradient.* | IMPLEMENTED / UNVERIFIED | agentChartSettingsW1B colours test (needs Gradient first) | unknown | Auto; Undo | Corpus case | "make the gradient top navy" | P2 |
| C1-051 | Settings | Crosshair mode | CSM:1159 | setSetting crosshair.mode | chart.setSetting crosshair.mode | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "crosshair off" | P1 |
| C1-052 | Settings | Crosshair colour/width/style | CSM:911 | setSetting crosshair.* | chart.setSetting | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "dashed crosshair" | P2 |
| C1-053 | Settings | Magnet crosshair | SC:6254 | setCs crosshair.magnet | chart.setSetting crosshair.magnet | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "turn on magnet" | P2 |
| C1-054 | Settings | Price labels / MA labels | CSM:1198, CSM:1209 | setSetting | chart.setSetting showPriceLabels, showMaLabels | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "hide price labels" | P2 |
| C1-055 | Settings | Scale text size and colour | CSM Canvas tab | setSetting | chart.setSetting textSize, textColor | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "bigger axis text" | P2 |
| C1-056 | Settings | Watermark on/off (Alt+Shift+W) | CSM:1225; KS:142 | setWmVisible | chart.setSetting watermark.visible | IMPLEMENTED / UNVERIFIED | agentBatch6 covers Batch 6 rows generally | unknown | Auto; Undo | Row test | "hide the watermark" | P2 |
| C1-057 | Settings | Watermark lines | CSM:1242 | setWmLine | chart.setSetting watermark.lines.* | IMPLEMENTED / UNVERIFIED | Generic rail; note descriptor has both eligible rows and a stale known row `watermark.lines.*` | unknown | Auto; Undo | Row test; drop stale row | "hide sector on the watermark" | P2 |
| C1-058 | Settings | Watermark alignment | CSM:1258 | CSM:860 setWmAlign | none | MISSING | `watermark.align` has no descriptor row in the tables read; I did not confirm how the completeness rail treats it | no | n/a | Add row | "left-align the watermark" | P2 |
| C1-059 | Settings | Watermark size/weight/colour/opacity | CSM watermark block (CSM:1225-1310) | setSetting | chart.setSetting watermark.* | IMPLEMENTED / UNVERIFIED | agentBatch6 rows | unknown | Auto; Undo | Row test | "watermark more subtle" | P2 |
| C1-060 | Settings | Move watermark | CSM:1315 | Wid:480 opts.watermarkPos | chart.setSetting watermark.x, .y | IMPLEMENTED / UNVERIFIED | Wrong writer: see defect D2 | unknown | Auto; Undo restores cs only | Write opts.watermarkPos | "move the watermark to the top left" | P2 |
| C1-061 | Settings | Reset watermark to centre | CSM:1317 | Wid:491 resetWatermark | none | MISSING | No capability touches opts.watermarkPos | no | n/a | Pair with C1-060 | "centre the watermark" | P2 |
| C1-062 | Settings | Title shows ticker/company/both | CSM:1382 | setHeader | chart.setSetting header.titleMode | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "show the company name" | P2 |
| C1-063 | Settings | Day change beside title | CSM:929 | setHeader | chart.setSetting header.showChange | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "hide day change" | P2 |
| C1-064 | Settings | Legend mode | CSM:1422; SC:6285-6292 | setHeader legendMode | chart.setSetting header.legendMode | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "hide the legend" | P1 |
| C1-065 | Settings | Legend bar-info fields | CSM:1453 | CSM:884 toggleBarField | none | MISSING | `header.barInfo` writer has no capability | no | n/a | List writer | "show volume in the legend" | P2 |
| C1-066 | Settings | Info-row fields | CSM:1810 | CSM:888 toggleInfoField | none | MISSING | Descriptor names a `header.fields` list writer as the honest capability; not built | no | n/a | Build it | "add market cap to the header" | P1 |
| C1-067 | Settings | Header colours | CSM:681-687 targets | setHeader colors | none | MISSING | `header.colors.*` classified known | no | n/a | Promote rows | "make the title gold" | P2 |
| C1-068 | Settings | Swing labels on/off and sensitivity | CSM:1510, CSM:1522; SC:6259 | setSwing | chart.setSetting swingLabels.* | IMPLEMENTED / UNVERIFIED | agentBatch6 prerequisite test | unknown | Auto; Undo | Row test | "turn on swing labels" | P2 |
| C1-069 | Settings | Swing label background, tint, colours | CSM:1538, CSM:1550 | setSwing | chart.setSetting swingLabels.* | IMPLEMENTED / UNVERIFIED | agentBatch6 | unknown | Auto; Undo | Row test | "tint swing labels" | P2 |
| C1-070 | Settings | Event markers | CSM:1573 | CSM:896 setMarker | chart.setSetting markers.* | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "turn on earnings markers" | P1 |
| C1-071 | Settings | Earnings beat/miss and IPO colours | CSM:694 targets | setMarker | chart.setSetting markers.* | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "make beats blue" | P2 |
| C1-072 | Settings | Prev-day lines on/off | CSM:1612 | CSM:899 setPrevDay | chart.setSetting prevDayLevels.*.enabled | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "show the prior day high" | P1 |
| C1-073 | Settings | Prev-day line style/width/colour | CSM Markers tab | setPrevDay | chart.setSetting prevDayLevels.* | IMPLEMENTED / UNVERIFIED | agentBatch6 | unknown | Auto; Undo | Row test | "dash the prior day low" | P2 |
| C1-074 | Settings | Dark-pool levels | CSM:1632 | setSetting darkPool | chart.setSetting darkPool.enabled | VERIFIED | agentChartSettingsW1B "turn on dark pool": panel, read-back, Undo | unknown | Auto; exact Undo tested | None | "turn on dark pool" | P2 |
| C1-075 | Settings | Bar-close countdown (Shift+C) | CSM:1656; KS:141 | setSetting countdown | chart.setSetting countdown | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "show the countdown" | P2 |
| C1-076 | Settings | Restore defaults | CSM:974 | CSM:485 handleReset | chart.resetDefaults | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1, agentBatch6 runtime; coverage all ✗ | unknown | Confirm card; exact Undo declared | Panel/corpus case | "reset this chart's settings" | P1 |
| C1-077 | Settings | Save / delete a custom colour | CP saveColor, deleteColor via picker | setPref chart_saved_colors | none | MISSING | Not in manifest | no | n/a | Low value | "save this colour" | P2 |
| C1-078 | Settings | Light/dark palette (Shift+T) | KS:140 | SC toggle:theme | none | MISSING | Descriptor `theme` known | no | n/a | Promote row | "light chart" | P2 |
| C1-079 | Themes | Apply a theme to one chart | CTM:190 | applyThemeToOneChart | chart.applyTheme | VERIFIED | c:chart.applyTheme | unknown | Auto; exact Undo tested | None | "apply the nord theme" | P1 |
| C1-080 | Themes | Apply a theme to all charts | CTM:214 | onApplyThemeAll | chart.applyThemeAll | IMPLEMENTED / UNVERIFIED | agentBoard.test.jsx mentions it, assertion not read; coverage all ✗ | unknown | Auto; exact Undo declared | Corpus case | "nord on every chart" | P1 |
| C1-081 | Themes | Apply a theme to all widgets | CTM:222 | onApplyThemeAllWidgets | none | MISSING | Not in manifest | no | n/a | Capability | "theme every widget" | P2 |
| C1-082 | Templates | Apply a template | CSM:1005 | CSM:468 applyTemplate, chartTemplateSettings | chart.applyTemplate | VERIFIED | c:chart.applyTemplate; agentChartTemplateParity | unknown | Confirm card; exact Undo in agentBatch6, coverage undo ✗ | Corpus undo case | "apply my swing template" | P1 |
| C1-083 | Templates | Save a template | CSM:1034 | CSM:459 commitSaveTemplate | chartSetup.saveTemplate | VERIFIED | c:chartSetup.saveTemplate | unknown | Auto, confirm if replacing; exact Undo tested | None | "save this as Swing" | P1 |
| C1-084 | Templates | Delete a template | CSM:1011 | CSM:479 deleteTemplate | chartSetup.deleteTemplate | VERIFIED | c:chartSetup.deleteTemplate | unknown | Confirm card; exact Undo declared, coverage undo ✗ | Undo case | "delete my Swing template" | P2 |
| C1-085 | Templates | Copy another chart's look | Right-click Chart template door is nearest; no direct control found | lookOnto | chartSetup.copyLook | UNMAPPED | agentChartsOperatorAcceptance A3 tests the Agent side; no human control located | unknown | Confirm card; Undo tested in A3 | Name the human equivalent | "make the left chart look like the right" | P2 |
| C1-086 | Volume | Show/hide volume (Ctrl+V, menu) | KS:163; SC:6129 | setCs volume.visible | volume.setState | VERIFIED | c:volume.hide | unknown | Auto; exact Undo tested | None | "hide volume" | P1 |
| C1-087 | Volume | Remove volume | Legend remove (LegendRow) | volume.removed | volume.setState | IMPLEMENTED / UNVERIFIED | Only the hide intent cited in coverage | unknown | Auto; Undo | Remove case | "remove volume" | P2 |
| C1-088 | Volume | Separate pane toggle | SC:6131 | setCs volume.separatePane | chart.setSetting volume.separatePane | BLOCKED | Inert on /charts, defect D1 | unknown | Auto; receipt misleads | Refuse on /charts | "put volume in its own pane" | P2 |
| C1-089 | Volume | Resize volume pane by drag | volumePaneDrag via SC, CP handleVolPaneResize | setPref charts_vol_pane_pct | chart.setSetting volume.paneHeightPct | BLOCKED | Wrong writer, defect D1 | unknown | Auto; receipt misleads | Write the pref | "make volume taller" | P1 |
| C1-090 | Volume | HVC highlight | SC:6132 | setCs volume.hvcEnabled | chart.setSetting volume.hvcEnabled | IMPLEMENTED / UNVERIFIED | Generic rail only | unknown | Auto; Undo | Row test | "mark the highest volume bar" | P2 |
| C1-091 | Volume | Volume colours, MA, label, bar style | CSM Indicators tab | setSetting volume.* | chart.setSetting volume.* | IMPLEMENTED / UNVERIFIED | agentChartSettingsW1B number test is generic | unknown | Auto; Undo | Row tests | "50 day volume average" | P2 |
| C1-092 | Volume | Overlay indicator on volume | SC:6117 | setCs volumeOverlayIndicators | indicatorStyle.placeIn | IMPLEMENTED / UNVERIFIED | Volume target stated in operator plan; c: evidence not checked for this target | unknown | Auto; exact Undo | Volume-target case | "put the MA on volume" | P2 |
| C1-093 | Panes | Move a pane | ChartSettingsIndicators.jsx:1283 | movePane, movePaneTo | pane.move | VERIFIED | agentIndicatorsP2 E4: panel, reads paneKeysOf | yes (P2 sequence test, runtime) | Auto; exact Undo | Corpus case; coverage all ✗ | "move rsi above price" | P1 |
| C1-094 | Panes | Resize a pane | Separator drag, SC:17043 | setPaneSizes | pane.resize | IMPLEMENTED / UNVERIFIED | agentIndicatorsP2 runtime read-back only | yes (P2 sequence test, runtime) | Auto; exact Undo | Panel case | "make the rsi pane bigger" | P1 |
| C1-095 | Panes | Collapse a pane | No control found (grep of SC) | n/a | none | UNMAPPED | The brief lists collapse; no pane-collapse control found in SC | no | n/a | Confirm it does not exist | n/a | P2 |
| C1-096 | Crosshair | Copy price at the cursor | SC:6026 | navigator.clipboard | none | BLOCKED | Needs a pointer position; clipboard write | no | n/a | None | n/a | P2 |
| C1-097 | Legend | Hide/show an indicator from chip | CHM:143 | onToggleHidden | indicator.hide, indicator.show | VERIFIED | Coverage execution ✓ for both; ids not read for this row | unknown | Auto; exact Undo | Show undo case | "hide RSI" | P0 |
| C1-098 | Legend | Display in another pane from chip | CHM:149 | setDisplayTarget | indicatorStyle.placeIn | VERIFIED | Coverage execution ✓; agentIndicatorsP2 | unknown | Auto; exact Undo | None | "put RSI on price" | P1 |
| C1-099 | Legend | Duplicate on chart | CHM:209 | duplicate | indicatorCopy.duplicate | VERIFIED | Coverage execution ✓ | unknown | Auto; Undo removes the copy | None | "duplicate the 20 EMA" | P2 |
| C1-100 | Legend | Show latest value in header | CHM:173 | infoValues | none | MISSING | `infoValues` is owned by indicators; no capability | no | n/a | Indicators op wrapper | "show RSI value in the header" | P2 |
| C1-101 | Legend | Add alert from chip | CHM:241; SC:6190 | toolbar openAlerts | indicatorAlert.create | VERIFIED | c:indicatorAlert.threshold; agentIndicatorAlerts | unknown | Confirm card; exact Undo declared, coverage undo ✗ | Undo case | "alert when RSI crosses 70" | P1 |
| C1-102 | Legend | Delete indicator from chip | CHM:256 | remove | indicator.remove | VERIFIED | Coverage execution ✓ | unknown | Confirm card; exact Undo declared | Undo case | "remove RSI" | P0 |
| C1-103 | Legend | Hide all indicators (Alt+Shift+I) | KS:144 | SC:16406 block | none | MISSING | One-at-a-time only | no | n/a | Bulk capability | "hide all my indicators" | P1 |
| C1-104 | Legend | Toggle RSI/MACD/BB/VWAP chord | KS:30-33 | setIndicatorEnabled | indicator.add, indicator.show, indicator.hide | VERIFIED | Outcome via indicator.* coverage | unknown | Mixed | None | "add RSI" | P1 |
| C1-105 | Legend | Toggle moving averages (Ctrl+M) | KS:162 | toggle:ma | none | MISSING | Four-slot toggle has no capability; discovery lists classic overlays as known | no | n/a | Bulk toggle | "hide my moving averages" | P1 |
| C1-106 | Measure | Measure on the chart | KS:136; TB:202 | CDO measure tool | none | MISSING | Discovery known; not in manifest. Saved as a drawing, so addable | no | n/a | drawing.addMeasure, or a read-only % between two dates | "how far from Oct 1 to now" | P1 |
| C1-107 | Measure | Bars & Time | KS:129; TB:203 | CDO dateRange | none | MISSING | Not in manifest | no | n/a | As above | "how many bars since the low" | P2 |
| C1-108 | Measure | Price range | KS:125 | CDO priceRange | none | MISSING | Not in manifest | no | n/a | As above | "measure 180 to 200" | P2 |
| C1-109 | Measure | Price Move | TB:208 | CDO advance | none | MISSING | Not in manifest | no | n/a | Anchored tool | "mark the move from the setup candle" | P2 |
| C1-110 | Share | Open share popover (Alt+S) | TB:1777; KS:174 | SC:20969 | none | BLOCKED | Discovery vision is the inbound case; operator plan scopes screenshots out | no | n/a | Owner decision | "screenshot this" | P1 |
| C1-111 | Share | Download PNG | SP:36 | chartScreenshot | none | BLOCKED | Out of scope in operator plan; browser file save | no | n/a | Owner decision | "save a PNG" | P2 |
| C1-112 | Share | Copy image | SP:40 | chartScreenshot | none | BLOCKED | Out of scope; clipboard needs a user gesture | no | n/a | Owner decision | "copy the chart" | P2 |
| C1-113 | Share | Copy share link | SP:44 | chartScreenshot share | none | BLOCKED | Publishes a link; needs an approval rule | no | n/a | Owner decision | "share this chart" | P2 |
| C1-114 | Alerts | Price alert at the cursor (Alt+N) | KS:177; SC:9193 | SC:16441 createAlertAtCursor | alert.create | VERIFIED | c:alert.price-above; GW-14; agentAlerts panel test | unknown | Confirm card; exact Undo in agentAlerts, coverage undo ✗ | Undo in corpus | "alert me above 200" | P0 |
| C1-115 | Alerts | Alert on a line, following it | CDO:4106 | SC:6637 onSetAlert bound | none | MISSING | Discovery says trendline alerts are known; alert.create is price-only | no | n/a | Bound alert capability | "alert me if it breaks this trendline" | P0 |
| C1-116 | Alerts | Alert at a line's fixed level | CDO:4107 | onSetAlert | alert.create | IMPLEMENTED / UNVERIFIED | Same outcome as a price alert if the price is said; drawing lookup untested | unknown | Confirm card | Case "alert at that line" | "alert at that line" | P1 |
| C1-117 | Alerts | Alert on a fib level | CDO:3884 | onSetLevelAlert | none | MISSING | Not in manifest | no | n/a | Bound alert | "alert at the 61.8" | P2 |
| C1-118 | Alerts | Position alerts (three lines) | CDO:4068, "All three" CDO:4091 | positionAlerts action | none | MISSING | Not in manifest | no | n/a | Bound alert | "alert at entry, stop and target" | P2 |
| C1-119 | Alerts | Pause/resume indicator alert | IndicatorAlertManager | indicator alert writer | indicatorAlert.toggle | VERIFIED | c:indicatorAlert.toggle | unknown | Auto; exact Undo tested | None | "pause that alert" | P2 |
| C1-120 | Alerts | Delete indicator alert | IndicatorAlertManager | indicator alert writer | indicatorAlert.delete | VERIFIED | c:indicatorAlert.delete | unknown | Confirm card; no Undo | None | "delete the RSI alert" | P2 |
| C1-121 | Alerts | Move a level line | CDO:4012, CDO:3173 flattenTo | DS:223 updateDrawing | drawing.setLevel | VERIFIED | c:drawing.setLevel | yes (after an earlier turn) | Auto; card if alert bound; exact Undo tested | None | "move that line to 205" | P0 |
| C1-122 | Right-click | Draw line at clicked price | SC:6021 | addDrawingRef | drawing.addLevel | VERIFIED | c:drawing.addLevel; agentDrawings | unknown | Auto; exact Undo tested | None | "draw a line at 200" | P0 |
| C1-123 | Right-click | Add indicator from menu | SC:6012 | openIndicatorLibrary | indicator.add | VERIFIED | Coverage execution ✓ | yes (multiStep ✓) | Auto; exact Undo | None | "add a 20 EMA" | P0 |
| C1-124 | Right-click | Open indicator settings | SC:6173 | setSettingsInstanceId | indicator.update | VERIFIED | Coverage execution ✓ for changing inputs; opening a dialog is not offered | unknown | Auto; exact Undo | None | "change RSI to 21" | P1 |
| C1-125 | Right-click | Clear all drawings | SC:6312; TB:2186 | DS:234 clearAll | drawing.clear | VERIFIED | c:drawing.clear | yes (after an earlier turn) | Confirm card; exact Undo in P1, coverage undo ✗ | Undo in corpus | "clear my drawings" | P1 |
| C1-126 | Right-click | Hide all drawings | SC:6298; TB:2138 | setCs hideDrawings | drawing.setAllVisible | IMPLEMENTED / UNVERIFIED | c:drawing.hideAll passes, but writes per-drawing `hidden`, not `hideDrawings`, and descriptor says the flag is not on /charts while SC:6298 shows it is | yes (after an earlier turn) | Auto; exact Undo declared, coverage undo ✗ | Settle writer; undo case | "hide all drawings" | P1 |
| C1-127 | Settings door | Open chart settings (Alt+,, gear) | KS:172; CP:998 | openSettings | none | MISSING | guide.show highlights only; opening a dialog is not offered | no | n/a | Probably unnecessary | "open chart settings" | P2 |
| C1-128 | Drawing | Trendline | TB:184; KS:113 | DS:195 addDrawing | drawing.addTrendline | VERIFIED | c:drawing.trendline; agentDrawingsAnchored | unknown | Auto; exact Undo tested | None | "trendline from Oct 15 at 180 to Oct 30 at 195" | P0 |
| C1-129 | Drawing | Ray | No toolbar button found (TB:184-215); only the render case CDO:1389 | addDrawing | drawing.addRay | UNMAPPED | c:drawing.ray proves the Agent side, but no human door was found for this type | unknown | Auto; exact Undo tested | Confirm whether a human door exists | "ray from Oct 15 at 180" | P1 |
| C1-130 | Drawing | Extended line | TB:185 | addDrawing | none | MISSING | Not in manifest | no | n/a | Add tool | "extend that line both ways" | P1 |
| C1-131 | Drawing | Horizontal line | TB:186; KS:114 | addDrawing | drawing.addLevel | VERIFIED | c:drawing.addLevel | unknown | Auto; exact Undo tested | None | "horizontal line at 200" | P0 |
| C1-132 | Drawing | Horizontal ray | TB:187; KS:115 | addDrawing | drawing.addHorizontalRay | VERIFIED | c:drawing.horizontalRay | unknown | Auto; exact Undo tested | None | "horizontal ray from Oct 15 at 200" | P1 |
| C1-133 | Drawing | Vertical line | TB:188; KS:116 | addDrawing | none | MISSING | Not in manifest | no | n/a | Add tool | "vertical line on Oct 15" | P1 |
| C1-134 | Drawing | Rectangle | TB:190; KS:117 | addDrawing | drawing.addRectangle | VERIFIED | c:drawing.rectangle | unknown | Auto; exact Undo tested | None | "box from Oct 1 at 180 to Oct 15 at 200" | P1 |
| C1-135 | Drawing | Circle | TB:191; KS:118 | addDrawing | none | MISSING | Not in manifest | no | n/a | Add tool | "circle that area" | P2 |
| C1-136 | Drawing | Arrow | TB:192; KS:119 | addDrawing | none | MISSING | Not in manifest | no | n/a | Add tool | "arrow at Oct 15" | P2 |
| C1-137 | Drawing | Fib retracement | TB:194; KS:120 | addDrawing | drawing.addFib | VERIFIED | c:drawing.fib | unknown | Auto; exact Undo tested | None | "fib from the Oct low to the Nov high" | P0 |
| C1-138 | Drawing | Fib extension | TB:195; KS:121 | addDrawing | none | MISSING | Not in manifest | no | n/a | Add tool | "fib extension" | P1 |
| C1-139 | Drawing | Pitchfork | TB:196; KS:135 | addDrawing | none | MISSING | Discovery known | no | n/a | Add tool | "pitchfork from these points" | P2 |
| C1-140 | Drawing | Parallel channel | TB:197 | addDrawing | none | MISSING | Discovery known; Phase 3 plan named channel | no | n/a | Add tool | "channel from these lows" | P1 |
| C1-141 | Drawing | Cup curve | TB:198 | addDrawing | none | MISSING | Not in manifest | no | n/a | Add tool | "draw the cup" | P2 |
| C1-142 | Drawing | Anchored VWAP | TB:199; KS:122 | addDrawing | drawing.addAvwap | VERIFIED | c:drawing.avwap | unknown | Auto; exact Undo tested | None | "anchor VWAP to Oct 15" | P0 |
| C1-143 | Drawing | Text note | TB:201; KS:123 | addDrawing | drawing.addText | VERIFIED | c:drawing.text | unknown | Auto; exact Undo tested | None | "note 'earnings gap' on Oct 15" | P1 |
| C1-144 | Drawing | Position calculator | TB:215; KS:124; PP:46-69 | SC calculator, positionCalc | chart.setSetting positionCalc.* | IMPLEMENTED / UNVERIFIED | Account and risk only; entry/stop/target are not settable | unknown | Auto; Undo | Entry/stop/target capability | "risk 1% on a 50k account" | P1 |
| C1-145 | Drawing | Eraser | KS:130 | removeDrawing | drawing.remove | VERIFIED | c:drawing.remove | yes (after an earlier turn) | Auto; exact Undo tested | None | "delete that line" | P1 |
| C1-146 | Drawing | Delete selected (Del, button) | CDO:2780; TB:2175 | DS:214 removeDrawing | drawing.remove | VERIFIED | c:drawing.remove; refused when alert-bound or locked in agentDrawings | yes (after an earlier turn) | Auto; card if hidden; exact Undo tested | None | "remove that trendline" | P0 |
| C1-147 | Drawing | Recolour | TB:2036; CDO DrawingContextMenu:3505 | DS:223 updateDrawing | drawing.style | VERIFIED | c:drawing.style | yes (after an earlier turn) | Auto; exact Undo in agentDrawings, coverage undo ✗ | Corpus undo case | "make that line pink" | P0 |
| C1-148 | Drawing | Width and line style | TB:2066, TB:2097 | updateDrawing | drawing.style | VERIFIED | c:drawing.style; agentDrawings dashed case | yes | Auto; Undo as above | None | "thicker and dashed" | P1 |
| C1-149 | Drawing | Fill and border | Schema drawingSettingsSchema:129, 133 | updateDrawing | none | MISSING | drawing.style covers colour, style and width per discovery; fill args not read in schema | no | n/a | Extend args after checking | "shade that box blue" | P2 |
| C1-150 | Drawing | Text font, size, bold, italic, background | CDO:3776, CDO:3985, schema:275-321 | updateDrawing | none | MISSING | Not in discovery's style list | no | n/a | Extend style | "make the note bold" | P2 |
| C1-151 | Drawing | Fib levels and fills | CDO:3866, CDO:3910 | updateDrawing | none | MISSING | Not in manifest | no | n/a | Fib edit capability | "remove the 78.6" | P1 |
| C1-152 | Drawing | Reset fib | Schema:223 | updateDrawing | none | MISSING | Not in manifest | no | n/a | With C1-151 | "reset the fib levels" | P2 |
| C1-153 | Drawing | Measure-label options | Schema:160-184 | updateDrawing | none | MISSING | Not in manifest | no | n/a | After C1-106 | "hide bars on the measure" | P2 |
| C1-154 | Drawing | Price label on a line | Schema:196 | updateDrawing | none | MISSING | Not in manifest | no | n/a | Extend style | "show the price on that line" | P2 |
| C1-155 | Drawing | Edit anchors | Schema:238; drag in CDO | updateDrawing | none | MISSING | setLevel is horizontal only; a trendline is refused in P1 test | no | n/a | Anchor edit capability | "move the second point to Nov 1" | P1 |
| C1-156 | Drawing | Make horizontal | CDO:3177 | flattenTo | none | MISSING | Not in manifest | no | n/a | Capability | "flatten that line" | P2 |
| C1-157 | Drawing | Duplicate | CDO:3459, CDO:3212 | addDrawing | none | MISSING | Not in manifest | no | n/a | Capability | "copy that line" | P2 |
| C1-158 | Drawing | Lock/unlock | CDO:3468, CDO:3210 | updateDrawing locked | drawing.lock | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1 runtime; coverage all ✗ | unknown | Auto; exact Undo (runtime) | Panel case | "lock that line" | P1 |
| C1-159 | Drawing | Hide/show one | CDO:3211 | updateDrawing hidden | drawing.setVisible | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1 runtime; coverage all ✗ | unknown | Auto; exact Undo (runtime) | Panel case | "hide that fib" | P1 |
| C1-160 | Drawing | Save as default | CDO:3219 | onSaveDefaults | none | MISSING | `drawingDefaults.*` known | no | n/a | Promote | "make gold my default" | P2 |
| C1-161 | Drawing | Reorder (front/back) | DS:241 reorderDrawing | reorderDrawing | none | UNMAPPED | Store export found; UI control not located | no | n/a | Find the door | "send that to back" | P2 |
| C1-162 | Drawing | Undo/redo a drawing | TB:2152, TB:2163; CDO:3452 | DS:264, DS:282 | agent.undo (own changes only) | BLOCKED | Owner: Agent and member histories stay separate | yes (own changes) | Refuses on conflict | None | "undo that" | P0 |
| C1-163 | Drawing | Magnet for drawing | TB:1635 | setMagnet | none | UNMAPPED | Tool-session state; not the crosshair magnet | no | n/a | Decide if meaningful without a pointer | n/a | P2 |
| C1-164 | Drawing | Repeat drawing mode | TB:1686 | setRepeatMode | none | BLOCKED | Pointer-session state | no | n/a | None | n/a | P2 |
| C1-165 | Drawing | Customise tool favourites | TB:830, TB:835 | onToggleHidden, onToggleFavorite | none | MISSING | Not in manifest | no | n/a | Low value | "pin fib to my toolbar" | P2 |
| C1-166 | Drawing | Nudge selected with arrows | CDO:2790 | updateDrawing | none | BLOCKED | Needs a selection; anchor edits cover the outcome | no | n/a | See C1-155 | n/a | P2 |
| C1-167 | Boards | Switch drawing board | TP:66 | activate tracing | none | MISSING | agentDrawings proves Undo refuses after a switch; no capability | no | n/a | Capability | "switch to my swing board" | P2 |
| C1-168 | Boards | Create a board | TP:185 | DS:418 createTracing | none | MISSING | Not in manifest | no | n/a | Capability | "new drawing board" | P2 |
| C1-169 | Boards | Rename a board | TP:76, TP:126 | DS:429 renameTracing | none | MISSING | Not in manifest | no | n/a | Capability | "rename this board" | P2 |
| C1-170 | Boards | Delete a board | TP:105 | onDelete | none | MISSING | Not in manifest | no | n/a | Confirm-risk capability | "delete that board" | P2 |
| C1-171 | Keyboard | Add ticker to watchlist (Alt+Q) | KS:176 | SC openAddList | watchlist.add | VERIFIED | Coverage execution ✓ (lists domain) | yes (multiStep ✓) | Auto; exact Undo | None | "add this to my watchlist" | P0 |
| C1-172 | Keyboard | Add indicator dialog (Alt+Shift+A) | KS:173 | openIndicatorLibrary | indicator.add | VERIFIED | Coverage execution ✓ | yes | Auto; exact Undo | None | "add MACD" | P1 |
| C1-173 | Keyboard | Cycle grid layout (Alt+\\) | KS:178 | gridcycle | chartGrid.set | UNMAPPED | Grid belongs to the board part; rowed for completeness | unknown | Auto; Undo | Covered by part 2 | "2x2 grid" | P2 |
| C1-174 | Keyboard | Keyboard help (?) | KS:179 | onShowHelp | guide.show | UNMAPPED | guide.show covers Charts controls; shortcut list not confirmed | unknown | Read only | Check guide scope | "what are the shortcuts" | P2 |
| C1-175 | Keyboard | Escape to cursor / cancel | KS:112 | tool:cursor | none | BLOCKED | Pointer-session state | no | n/a | None | n/a | P2 |

## Defects found

- **D1, a false receipt (source inspection).** `volume.separatePane` and `volume.paneHeightPct` are Agent-eligible, but on /charts `paneLook.js:35` passes `volumeSeparatePane: true` and `paneLook.js:63` passes a pane height that is never null (`paneVolumePct`, default 12). `StockChart.jsx:12706` reads `volumePaneHeightPct ?? cs.volume?.paneHeightPct`, so the Agent's value never applies, and `ChartPane.jsx` says these two settings render inert in the dialog. The Agent still reports success. The real writer is the `charts_vol_pane_pct` pref. `agentChartSettingsW1B` checks the stored value only, so it would not catch this.
- **D2, wrong writer (source inspection).** `watermark.x` and `.y` cite "right-click → Move watermark", but that control writes `opts.watermarkPos` (`ChartWidget.jsx:480`). `watermarkX ?? cs.watermark.x` means a moved watermark ignores the Agent's write, and the receipt still claims the change.
- **D3, untrue discovery.** The `charts` topic in `discovery.js` lists `chart.replay` in `caps` and also lists replay under `known`, so the answer says both that the Agent can and cannot do it.
- **D4, stale descriptors.** `comparisonSymbols` and `compareHideBase` are classified `specialized:chart.setSymbol`, but `chart.compare` and `chartSetup.compareDisplay` write them. `watermark.lines.*` is `known` while each line is eligible. `hideDrawings` says "not on /charts", yet `StockChart.jsx:6298` offers it there.
- **D5, stale coverage report.** `chart.replay` shows undo ✗, yet `agentChartReplay.test.jsx` asserts Undo. Coverage counts corpus entries only, so ✗ does not always mean untested. The reverse also holds: coverage shows `chart.resetDefaults` and `chartSetup.copyLook` as all ✗ despite named tests.

## Limits of this pass

- `baseline/corpus.json` was not read intent by intent, so a phrasing tagged with a known `gap` could still sit under a VERIFIED row.
- Rows citing "Coverage execution ✓" rely on the generated report rather than on my reading the assertion.
- C1-087 and the IndicatorAlertManager rows name a component because the exact line was not pinned.
- Colour rows in the settings dialog share the `activeTarget` picker, so they cite the target table or tab.


# Charts inventory part 2: indicators and indicator alerts

Commit: 179d57570d. Read-only source audit. No test was run for this report.

## States (owner schema)
- VERIFIED: a named end-to-end test exists that goes through the Agent and reads the resulting state back. The test was read, not executed. Models in these tests are scripted, so real-model routing is not proven.
- IMPLEMENTED / UNVERIFIED: a capability uses the canonical writer, but the only proof is source, a contract test or a partial test. The gap is in "missing work".
- MISSING: traced, and no capability does this.
- BLOCKED: should not, or cannot, be Agent-run as things stand. The reason is in "evidence".
- UNMAPPED: control found, but not traced far enough to say whether a capability reaches it.

The coordinator gave the state names without definitions. The MISSING, BLOCKED and UNMAPPED meanings above are my reading, and each BLOCKED reason is my judgement, not an existing owner ruling.

## Evidence keys
- FS:<id> = intent in `app/src/agent/qa/capabilityRegression/corpus.finalState.*.test.jsx`, which runs the real panel and asserts final state.
- P2:n = line in `app/src/agent/agentIndicatorsP2.test.jsx`. E-numbered cases mount the real panel; other P2 cases drive the runtime and read the store.
- M1/M2/M3:n = `app/src/agent/agentIndicators{M1,M2,M3}.test.jsx`. IA:n = `app/src/agent/agentIndicatorAlerts.test.jsx`. DEF:n = `app/src/components/chart/builder/agentDefinitions.test.js`.
- GW-27 = golden workflow `indicator-package-draft-to-delete`.
- `coverage.json` shows no execution for pane.move, pane.resize, definition.describe and definition.duplicate. It counts corpus cases only, so it understates pane.move and pane.resize.

## Paths
CSI = `app/src/components/chart/ChartSettingsIndicators.jsx`; LIB = `IndicatorLibraryDialog.jsx`; ISD = `IndicatorSettingsDialog.jsx`; IAP = `IndicatorAlertPopover.jsx`; IAM = `IndicatorAlertManager.jsx`; ITB = `IndicatorTemplatesBar.jsx`; CM = `legend/chipMenu.js`; TB = `ChartToolbar.jsx` (all under `app/src/components/chart/`); SC = `app/src/components/StockChart.jsx`; BS = `builder/BuilderSheet.jsx`; PB = `builder/PineBox.jsx`; IB = `builder/ImageBox.jsx`; SP = `builder/SharePanel.jsx`; CIP = `builder/studio/CreateIndicatorPanel.jsx`; CB = `builder/ConverseBox.jsx`; CP = `builder/CriteriaPicker.jsx`; FF = `builder/FormulaField.jsx` (builder paths under `app/src/components/chart/`); MIS = `app/src/pages/charts/mobile/MobileIndicatorSheet.jsx`.

## Matrix

| ID | Area | Human action | UI control | Canonical writer/hook | Agent capability | State | Evidence | Follow-ups work | Confirmation / Undo | Missing work | Example phrase | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C2-001 | Picker | Open indicator library | TB:1912 mount; TB:1278 opener | openIndicatorLibrary | none | MISSING | no opener capability; add works without it | n/a | n/a | Low value unless browsing is wanted | "open the indicators list" | P2 |
| C2-002 | Picker | Search indicators by name or purpose | LIB:464; CSI:3404 | matches() over catalog rows | definition.search | VERIFIED | FS:definition.search; P2:206 | unknown | Read-only | Follow-up from a result to add is untested | "find me a volatility indicator" | P1 |
| C2-003 | Picker | Browse by category | CSI:3462 | catalog categories | definition.search (partial) | IMPLEMENTED / UNVERIFIED | search takes words and kind, no category | unknown | Read-only | No category listing | "what momentum indicators do you have" | P2 |
| C2-004 | Add | Add built-in indicator | LIB:547 | toggledRow / addInstance | indicator.add | VERIFIED | FS:indicator.rsi; FS:indicator.ema-9-20; M2:91 | yes | Applied; exact Undo tested | none | "add RSI" | P0 |
| C2-005 | Add | Add with chosen settings | CSI:3318 | addInstance + setInstanceInput | indicator.add inputs | VERIFIED | agentIndicatorsInputs.test.jsx:104 | yes | Applied; exact Undo | none | "add a 20 EMA" | P0 |
| C2-006 | Add | Add another copy with defaults | LIB:608; CSI:3288 | addInstance | indicator.add (phrase path indicatorEdits.js:731) | IMPLEMENTED / UNVERIFIED | phrase path in source; no outcome test found | unknown | Applied; Undo expected | Final-state case | "add another 20 EMA" | P1 |
| C2-007 | Add | Add own saved indicator | CSI:3214 | addInstance | indicator.add | VERIFIED | FS:indicator.apply-saved | yes | Applied; Undo tested | none | "add my Trend Strength" | P0 |
| C2-008 | Add | Add a symbol as a data series from search | LIB:422 (createFromResult); CSI:3553 | createFromResult | none traced; chart.compare may overlap | UNMAPPED | no createFromResult in capabilities; chart.compare not traced here | unknown | unknown | Decide whether chart.compare is equivalent | "plot QQQ under this chart" | P1 |
| C2-009 | Add | Add economic series | CSI:3252 | catalog row add | none traced | UNMAPPED | row found; Agent path not traced | unknown | unknown | Trace catalog eligibility | "add CPI to the chart" | P2 |
| C2-010 | Add | Keyboard chord toggles RSI, MACD, BB, VWAP | keyboardShortcuts.js:29 | INDICATOR_CHORDS | indicator.add / indicator.remove | IMPLEMENTED / UNVERIFIED | same outcome as C2-004 for RSI; toggle semantics untested | unknown | As add / remove | No "toggle" verb; covered by add or remove | "toggle MACD" | P2 |
| C2-011 | Add | Enable classic overlay average | TB:471 | updateOverlay | none (refused by design) | MISSING | indicator.add hint; M2:141 | n/a | n/a | Agent points to Chart Settings; decide if engine MA is enough | "turn on moving average 3" | P2 |
| C2-012 | Add | Add Volume Profile | LIB:547 (carved-out row) | toggledRow | none (refused by design) | MISSING | discovery.js:99; M2:141 | n/a | n/a | No capability | "turn on volume profile" | P1 |
| C2-013 | Add | Toggle Chart IQ pattern recognition | MIS:343 | showChartIq write | none traced | UNMAPPED | chart.setSetting allow-list not traced | unknown | unknown | Check chart.setSetting keys | "turn on Chart IQ" | P2 |
| C2-014 | Remove | Delete indicator from legend | CM:255; SC:5428 | removeInstance | indicator.remove | VERIFIED | FS:indicator.remove-sma200; M2:106 | unknown | Always proposed; exact Undo in M2:106, not in corpus | Follow-up case | "remove the 200 SMA" | P0 |
| C2-015 | Remove | Delete from Chart Settings | CSI:2356; CSI:2528 | removeInstance | indicator.remove | VERIFIED | as C2-014 | unknown | As C2-014 | none | "take RSI off" | P0 |
| C2-016 | Remove | Delete classic average row | SC:18977 | legendRowRemove | indicator.remove | VERIFIED | M2:141 | unknown | Proposed; exact Undo | none | "remove the 9 EMA" | P1 |
| C2-017 | Remove | Remove an unavailable indicator | UnavailableIndicators.jsx:92 | act('remove') | indicator.remove not proven for this state | UNMAPPED | list path for unavailable rows not traced | unknown | unknown | Trace and test | "remove the broken indicator" | P2 |
| C2-018 | Visibility | Hide indicator | CM:142; CSI:2427; ISD:636 | setInstanceHidden | indicator.hide | VERIFIED | FS:indicator.hide | unknown | Applied; exact Undo tested | none | "hide RSI" | P0 |
| C2-019 | Visibility | Show indicator | CM:142; CSI:2427 | setInstanceHidden | indicator.show | VERIFIED | FS:indicator.show | yes | Applied; Undo not in corpus | Undo case | "show RSI again" | P0 |
| C2-020 | Visibility | Hide or show volume | SC:18968; TB:497 | volume.visible | volume.setState | VERIFIED | FS:volume.hide | unknown | Applied; Undo tested | none | "hide volume" | P1 |
| C2-021 | Visibility | Limit to chosen timeframes | CSI:2982; CSI:3007 | setVisibility | indicatorStyle.set showOn | VERIFIED | FS:indicator.followup-daily-only | yes | Applied; Undo tested | none | "only show it on the daily" | P1 |
| C2-022 | Read | See what is on a chart | CSI:3691 | instancesOf | indicator.list | VERIFIED | FS:indicator.list | unknown | Read-only | none | "what indicators are on this chart" | P1 |
| C2-023 | Read | Read About text | CM:247; SC:19026 | def.meta.description | definition.describe | IMPLEMENTED / UNVERIFIED | P2:206 runtime; DEF:75 | unknown | Read-only | No panel case | "what does ADX do" | P1 |
| C2-024 | Inputs | Change numeric setting | ISD:427 | setInstanceInput | indicator.update | VERIFIED | FS:indicator.update-period | unknown | Applied; Undo tested | none | "make RSI 7" | P0 |
| C2-025 | Inputs | Change select setting (MA type, source) | ISD:448; CSI:2256 | setInstanceInput | indicator.update | IMPLEMENTED / UNVERIFIED | hint covers maType; agentMutations.inputs.test.js is contract level | unknown | Applied; Undo expected | Final-state case | "change that to an SMA" | P0 |
| C2-026 | Inputs | Flip a toggle setting | ISD:495; CSI:2218 | setInstanceInput | indicator.update | IMPLEMENTED / UNVERIFIED | no outcome test found | unknown | Applied; Undo expected | Final-state case | "turn off the signal line" | P1 |
| C2-027 | Inputs | Edit session input | ISD:481 | setInstanceInput | indicator.update | IMPLEMENTED / UNVERIFIED | no outcome test found | unknown | Applied; Undo expected | Test session format | "set the session to 0930-1100" | P2 |
| C2-028 | Inputs | Cancel settings, roll back all edits | ISD:666 | snapshot restore | agent.undo (one step at a time) | MISSING | no multi-change rollback | n/a | Undo is per step | Decide if needed | "undo everything I changed on RSI" | P2 |
| C2-029 | Inputs | Set calculation timeframe | CSI:2830 | setInstanceCalculationTimeframe | none for chart instances | MISSING | absent from capabilities; set_calculation_timeframe is a draft patch op | n/a | n/a | Add mutation op and capability | "calculate this RSI on the weekly" | P1 |
| C2-030 | Style | Change line colour | ISD:513; CSI:2215 | setColor | indicatorStyle.set | VERIFIED | FS:indicatorStyle.colour; P2:275 E1 | yes | Applied; Undo tested | none | "make the 9 green" | P0 |
| C2-031 | Style | Change histogram up / down colours | CSI:2215 | setColor sign:up/down | indicatorStyle.set | IMPLEMENTED / UNVERIFIED | styleRequest branch; no outcome test found | unknown | Applied; Undo expected | Final-state case | "make MACD bars blue when rising" | P1 |
| C2-032 | Style | Change line width | CSI:2910 | setAppearance | indicatorStyle.set | VERIFIED | FS:indicator.followup-thicker | yes | Applied; Undo tested | none | "make it thicker" | P0 |
| C2-033 | Style | Change line style | CSI:2894 | setAppearance | indicatorStyle.set | VERIFIED | P2:289 E2 | yes | Applied; Undo at P2:80 | none | "make the 20 dashed" | P1 |
| C2-034 | Style | Change plot style | CSI:2743 | setPlotStyle | indicatorStyle.set | IMPLEMENTED / UNVERIFIED | P2:97 runtime only | unknown | Applied; Undo expected | Panel case | "show it as a histogram" | P1 |
| C2-035 | Style | Toggle overlap candles | CSI:2880 | setAppearance overlap | indicatorStyle.set | IMPLEMENTED / UNVERIFIED | in schema; no test found | unknown | Applied; Undo expected | Final-state case | "let it overlap the candles" | P2 |
| C2-036 | Placement | Move to price, volume or own pane | CM:148; ISD:648; CSI:2649 | setInstanceDisplayTarget | indicatorStyle.placeIn | VERIFIED | FS:indicatorStyle.place-own-pane | unknown | Applied, proposed if others move; Undo tested | none | "put RSI in its own pane" | P0 |
| C2-037 | Placement | Move into another indicator's pane | CM:59; CSI:2649 | setDisplayTarget @host | indicatorStyle.placeIn | IMPLEMENTED / UNVERIFIED | placeRequest source; no outcome test found | unknown | Proposed when guests move | Final-state case | "put this inside the RSI pane" | P1 |
| C2-038 | Panes | Reorder pane | CSI:1877; CSI:1841 | movePane | pane.move | VERIFIED | P2:356 E4 reads pane order | unknown | Applied; Undo at P2:106 (runtime) | Add to corpus; phrasings are 0 | "move RSI above price" | P1 |
| C2-039 | Panes | Resize pane by divider | not located (see Limits) | setPaneSize (engine/paneSizes) | pane.resize | IMPLEMENTED / UNVERIFIED | P2:106 runtime reads share | unknown | Applied; Undo at P2:106 | Panel case; locate control | "make the RSI pane bigger" | P1 |
| C2-040 | Panes | Reorder series within a pane | CSI:1609 | not traced | none traced | UNMAPPED | control found | unknown | unknown | Trace writer | "put the 9 on top of the 20" | P2 |
| C2-041 | Legend | Show latest value in header | CM:172; SC:5436 | handleChipInfoValue | none | MISSING | no capability; request_info_value is a draft patch op | n/a | n/a | Add capability | "show RSI's value in the header" | P1 |
| C2-042 | Legend | Duplicate on chart | CM:205; SC:5455; CSI:2523 | duplicateInstance | indicatorCopy.duplicate | VERIFIED | FS:indicatorCopy.duplicate | unknown | Applied; Undo tested | none | "duplicate the 20 EMA" | P1 |
| C2-043 | Legend | Create custom copy | CM:216; CSI:2503; CSI:3221 | createCustomCopy | definition.duplicate | IMPLEMENTED / UNVERIFIED | DEF:96, DEF:110 contract only; coverage empty | unknown | Proposed; Undo deletes copy | Panel case with read-back | "make my own copy of MACD" | P1 |
| C2-044 | Legend | Open Modify with UCT Intelligence | CM:187; CSI:2496; CSI:3216 | openCreateIndicator {defId} | indicator.openCreate | IMPLEMENTED / UNVERIFIED | M1:162 opener; corpus none | unknown | No Undo; receipt says how to cancel | Corpus case | "open Modify on Trend Strength" | P1 |
| C2-045 | Legend | Open Edit formula | CM:191; CSI:2500; CSI:3219 | openFormulaEditor | none | MISSING | indicator.draft edits by words; no formula door | n/a | n/a | Add opener if wanted | "open the formula for Trend Strength" | P2 |
| C2-046 | Legend | Apply script accuracy upgrade | CM:200 | openScriptUpgrade | none | BLOCKED | rewrites a saved script; member should review it | n/a | n/a | At most an opener | "update my script" | P2 |
| C2-047 | Legend | Report mismatch with TradingView | CM:233 | setReportFor dialog | none | BLOCKED | a report is the member's own statement | n/a | n/a | At most an opener | "report that this doesn't match" | P2 |
| C2-048 | Undo | Indicator undo and redo buttons | IndicatorHistoryButtons.jsx:33; IndicatorUndoToast.jsx:120 | undoIndicatorChange / redoIndicatorChange | agent.undo (own steps only) | IMPLEMENTED / UNVERIFIED | manual history not reached; no redo capability | unknown | n/a | Decide on manual history and redo | "redo that" | P1 |
| C2-049 | Copy | Copy indicators to another chart | ITB:154 (nearest manual route) | copyFrom | indicatorCopy.copyTo | VERIFIED | FS:indicator.followup-other-chart; P2:304 E3 | yes | Applied; Undo tested | none | "copy these to my other charts" | P1 |
| C2-050 | Copy | Accept or refuse a shared chart's indicators | SharedIndicatorsPrompt.jsx:26 | useSharedIndicators | none | MISSING | prompt only | n/a | n/a | Low value | "use their indicators" | P2 |
| C2-051 | Templates | Save indicator template | ITB:188 | captureIndicatorTemplate + setPrefMerged | none | MISSING | no indicator template use in capabilities; chartSetup.saveTemplate is chart settings | n/a | n/a | Add capability | "save these indicators as Swing Setup" | P1 |
| C2-052 | Templates | Apply indicator template | ITB:154 | applyIndicatorTemplate | none | MISSING | chart.applyTemplate is a different store | n/a | n/a | Add capability; must not route to chart.applyTemplate | "apply my Swing Setup indicators" | P0 |
| C2-053 | Templates | Delete indicator template | ITB:138 | withoutTemplate | none | MISSING | as C2-051 | n/a | n/a | Add capability, proposed | "delete the Swing Setup template" | P2 |
| C2-054 | Templates | List indicator templates | ITB:129 | parseIndicatorTemplates | none | MISSING | as C2-051 | n/a | n/a | Add query | "what indicator templates do I have" | P1 |
| C2-055 | Create | Open Create Indicator | CSI:3360; TB:1312 | openCreateIndicator | indicator.openCreate | IMPLEMENTED / UNVERIFIED | M1:144; corpus none | unknown | No Undo | Corpus case | "open Create Indicator" | P2 |
| C2-056 | Create | Describe an indicator, get a draft | CIP:366; CB:422 | draftTurn (/converse) | indicator.draft | VERIFIED | FS:indicator.draft-create; M3:154 | yes | Local draft; Undo tested | Scripted builder model only | "build an indicator for RSI above 50" | P0 |
| C2-057 | Create | Refine draft by conversation | CB:422 | draftTurn | indicator.draft | VERIFIED | M3:154 | yes | Draft undo | none | "also require RSI above 50" | P1 |
| C2-058 | Create | Answer the builder's choice question | CB:399 | send(choice) | indicator.draft | IMPLEMENTED / UNVERIFIED | M3:241 proves the question changes nothing, not the answer turn | unknown | No change until answered | Test the answer turn | "the second one" | P2 |
| C2-059 | Create | Undo a draft step | CB:426 | undoStep | indicator.undoDraft / agent.undo | IMPLEMENTED / UNVERIFIED | M3:442, M3:433; coverage empty | unknown | Exact on draft | Corpus case | "undo the last change to my draft" | P1 |
| C2-060 | Create | Preview draft on chart | BS:3207 | previewChannel | indicator.previewDraft | VERIFIED | FS:indicator.preview-draft; GW-27 | yes | Not saved | none | "show me that on the chart" | P1 |
| C2-061 | Create | Save draft, acknowledge warnings | CB:444; CB:452; BS:3910 | save with read-back | indicator.saveDraft | VERIFIED | FS:indicator.save-draft-as; GW-27 | yes | Proposed unless explicit; no Undo, Save is permanent | none | "save it as Bullish Trend" | P0 |
| C2-062 | Create | Discard draft | CIP:349 | discardDraft | indicator.discardDraft | VERIFIED | FS:indicator.discard-draft | yes | Proposed; no Undo | none | "discard the draft" | P1 |
| C2-063 | Create | Keep draft and close | CIP:346 | draft persistence | none (drafts persist per tab) | IMPLEMENTED / UNVERIFIED | source comment in indicatorAuthoring.js | unknown | n/a | Test only | "keep that for later" | P2 |
| C2-064 | Builder | Build by conditions | BS:2569; CP:520 | add_clause / remove_clause | indicator.draft (by words) | IMPLEMENTED / UNVERIFIED | patch ops exist; per-op outcome unproven | unknown | Draft undo | Per-op cases | "add a clause, close above VWAP" | P1 |
| C2-065 | Builder | Group conditions, any or all | CP:462 | criteria tree | indicator.draft | IMPLEMENTED / UNVERIFIED | no outcome test found | unknown | Draft undo | Test | "either RSI over 70 or MACD up" | P2 |
| C2-066 | Builder | Enter a formula | FF:480 | formula compile | indicator.draft (words only) | IMPLEMENTED / UNVERIFIED | no raw-formula test found | unknown | Draft undo | Decide a raw formula path | "use sma(close, 20) minus sma(close, 50)" | P1 |
| C2-067 | Builder | Add or remove member input | BS:3329; BS:3314 | set_input / remove_input | indicator.draft | IMPLEMENTED / UNVERIFIED | patch ops only | unknown | Draft undo | Test | "make the length adjustable" | P2 |
| C2-068 | Builder | Add, remove or restyle output plot | BS:3509; BS:3459; BS:3401 | add_output / remove_output / set_style | indicator.draft | IMPLEMENTED / UNVERIFIED | patch ops only | unknown | Draft undo | Test | "add a second line for the signal" | P2 |
| C2-069 | Builder | Set placement and levels | BS:3522; BS:3538 | set_placement / set_levels | indicator.draft | IMPLEMENTED / UNVERIFIED | patch ops only | unknown | Draft undo | Test | "put 70 and 30 lines on it" | P1 |
| C2-070 | Builder | Set signal markers | BS:3624; BS:3633; BS:3642 | set_marker / remove_marker | indicator.draft | IMPLEMENTED / UNVERIFIED | patch ops only | unknown | Draft undo | Test | "put a green arrow under the bar when true" | P1 |
| C2-071 | Builder | Colour candles or background on a signal | BS:3655; BS:3668 | set_paint / set_color_rule | indicator.draft | IMPLEMENTED / UNVERIFIED | patch ops only | unknown | Draft undo | Test | "paint the candles gold when true" | P1 |
| C2-072 | Builder | Name the draft | not located (see Limits) | rename_definition | indicator.saveDraft name | VERIFIED | FS:indicator.save-draft-as | yes | Local step, undoable | Locate control | "call it Bullish Trend" | P1 |
| C2-073 | Builder | Ask for an alert from the builder | CB:418 | request_alert | indicator.draft (routing unproven) | IMPLEMENTED / UNVERIFIED | patch op exists; no Agent test found | unknown | unknown | Test end to end | "alert me when it becomes true" | P1 |
| C2-074 | Builder | Run Evidence tab | BS:2630 | evidence job | none | MISSING | no capability | n/a | n/a | Add query | "backtest this signal" | P2 |
| C2-075 | Builder | Use a starter | StarterLibrary.jsx:167 | starter load | none | MISSING | no capability | n/a | n/a | Low value | "start from a pullback template" | P2 |
| C2-076 | Import | Paste Pine or thinkScript | PB:1072; PB:1536 | import pipeline | none | MISSING | no script argument in any capability | n/a | n/a | Add path that shows the import verdict | "import this Pine script" | P1 |
| C2-077 | Import | Apply import suggestion | PB:513 | import-suggest apply | none | MISSING | as C2-076 | n/a | n/a | Follows C2-076 | "use the suggested fix" | P2 |
| C2-078 | Import | Change script settings | PB:1323 | param manifest | none | MISSING | as C2-076 | n/a | n/a | Follows C2-076 | "set the script length to 14" | P2 |
| C2-079 | Import | Turn script output into a screen | PB:1491; PB:1503 | to-screen | none | MISSING | no capability | n/a | n/a | Low value | "scan on this script above 50" | P2 |
| C2-080 | Image | Read an indicator from a screenshot | IB:166; IB:193 | image door | none | MISSING | no attachment capability | n/a | n/a | Add attachment path | "build this from my screenshot" | P2 |
| C2-081 | Image | Accept image candidate | IB:251 | candidate accept | none | MISSING | as C2-080 | n/a | n/a | Follows C2-080 | "use the first one" | P2 |
| C2-082 | Saved | Open saved definition to edit | BS:3932 | editing state | indicator.draft edit / indicator.openCreate | IMPLEMENTED / UNVERIFIED | M1:162; edit turn outcome unproven | unknown | Draft | Test new-version path | "edit Trend Strength" | P1 |
| C2-083 | Saved | Delete saved definition | BS:3946; BS:3954 | soft delete | definition.delete | VERIFIED | GW-27; P2:215 | yes | Proposed, names charts; Undo re-saves same id | none | "delete my Trend Strength indicator" | P1 |
| C2-084 | Saved | Share a definition by link | SP:198; SP:189 | mint / revoke | none | BLOCKED | exposes member work outward; needs owner policy; discovery.js:91 lists it as a gap | n/a | n/a | Owner decision | "share this indicator" | P2 |
| C2-085 | Saved | Publish to or withdraw from library | SP:240; SP:217 | library publish | none | BLOCKED | visible to others; needs owner policy | n/a | n/a | Owner decision | "publish this indicator" | P2 |
| C2-086 | Saved | Install from a share link | SP:256; SP:272 | lookUp / install | none | BLOCKED | runs someone else's content; needs a review step | n/a | n/a | Owner decision | "install this indicator link" | P2 |
| C2-087 | Saved | Restore an older version | SP:291 | loadHistory | none | MISSING | discovery.js:91 lists it as a gap | n/a | n/a | Add capability | "go back to yesterday's version" | P2 |
| C2-088 | Alerts | Open indicator alerts popover | TB:1841 | popover state | none | MISSING | no opener; create works without it | n/a | n/a | Low value | "open indicator alerts" | P2 |
| C2-089 | Alerts | Create threshold alert | IAP:616; IAP:641; IAP:697 | createIndicatorAlert | indicatorAlert.create | VERIFIED | FS:indicatorAlert.threshold; IA:202 | unknown | Proposed; Undo deletes (IA:202) | Follow-up case | "alert me when RSI goes above 70" | P0 |
| C2-090 | Alerts | Create MA cross alert | IAP:616 | createIndicatorAlert (ma_cross) | indicatorAlert.create | VERIFIED | FS:indicatorAlert.ma-cross; FS:indicatorAlert.ma-cross-multichart | unknown | Proposed; Undo deletes | Follow-up case | "alert when the 9 crosses above the 20" | P0 |
| C2-091 | Alerts | Choose plot on a multi-line indicator | IAP:494 | payload.indicator | indicatorAlert.create plot | IMPLEMENTED / UNVERIFIED | IA:124 runtime | unknown | Proposed | Final-state case | "alert on the MACD signal line" | P1 |
| C2-092 | Alerts | Alert on a yes/no signal with trigger policy | IAP:599 | compileTriggerPolicy | none (refused) | MISSING | indicatorAlert.create check refuses signal plots | n/a | n/a | Add policy argument | "alert me when my Bullish Trend turns on" | P0 |
| C2-093 | Alerts | Alert on another timeframe | IAP:655 | payload.tf | indicatorAlert.create (chart timeframe only) | MISSING | toCreate uses found.chart.tf; no tf argument | n/a | n/a | Add tf limited to native timeframes | "alert on the weekly RSI" | P1 |
| C2-094 | Alerts | Limit alert to this chart | IAP:675 | payload.scope | none (always global) | MISSING | commit payload has no scope, indicatorAlerts.js:208 | n/a | n/a | Add scope argument | "alert only on this chart" | P2 |
| C2-095 | Alerts | Override alert inputs | IAP:521; IAP:536 | payload.params | none (instance inputs only) | MISSING | toCreate reads instance inputs | n/a | n/a | Workaround is to change the instance | "alert on RSI 7 without adding it" | P2 |
| C2-096 | Alerts | Choose which instance | IAP:577 | instance_id | indicatorAlert.create instance | VERIFIED | FS:indicatorAlert.ma-cross-multichart | unknown | Proposed | none | "the alert on the 9 EMA, left chart" | P1 |
| C2-097 | Alerts | List indicator alerts | IAP:860; IAM:119 | useIndicatorAlerts | none (context only; alert.js:255 excludes these) | MISSING | no indicatorAlert.list capability | n/a | n/a | Add query; context is truncated | "show my indicator alerts" | P1 |
| C2-098 | Alerts | Pause or resume alert | IAP:862 | toggleIndicatorAlert | indicatorAlert.toggle | VERIFIED | FS:indicatorAlert.toggle | unknown | Applied; Undo tested | none | "pause the RSI alert" | P1 |
| C2-099 | Alerts | Delete alert | IAP:869 | deleteIndicatorAlert | indicatorAlert.delete | VERIFIED | FS:indicatorAlert.delete; IA:158 | unknown | Proposed; no Undo, permanent | none | "delete the RSI alert" | P1 |
| C2-100 | Alerts | See why an alert cannot fire | IAM:143 | state / state_detail | context status only | IMPLEMENTED / UNVERIFIED | statusOf in context; no test of the reason | unknown | Read-only | Expose state_detail in a list query | "why hasn't my alert fired" | P1 |
| C2-101 | Mobile | Edit an average or study on phone | MIS:269; MIS:301; MIS:450 | same instance writers | indicator.update | IMPLEMENTED / UNVERIFIED | capability surface is charts; mobile mount not traced | unknown | As desktop | Confirm Agent on mobile | "make RSI 7" | P2 |

## Counts
101 rows.

| State | P0 | P1 | P2 | Total |
|---|---|---|---|---|
| VERIFIED | 15 | 17 | 0 | 32 |
| IMPLEMENTED / UNVERIFIED | 1 | 20 | 11 | 32 |
| MISSING | 2 | 8 | 17 | 27 |
| BLOCKED | 0 | 0 | 5 | 5 |
| UNMAPPED | 0 | 1 | 4 | 5 |

## Defects
1. `app/src/agent/capabilities/alert.js:299` (alert.create hint) tells the model to answer "unsupported" for an alert on an indicator, although indicatorAlert.create exists. The scripted corpus cannot catch this, so real-model behaviour is unproven.
2. `app/src/agent/discovery.js:99` lists "indicator alerts (set them on the chart)" as a known limitation, and line 97 omits `indicatorAlert.*`. Line 91 repeats the idea for new indicators.
3. `indicatorAlert.toggle` calls itself "the alert manager's own switch", but IAM is read-only. The real switch is IAP:862.
4. Risk, unconfirmed: `toCreate` passes the chart's timeframe unchecked, while the popover offers native timeframes only. The custom-timeframe result depends on server code I did not read.

## Product gap, not a row
No UI edits an existing indicator alert; a member deletes and recreates it. It has no row because no control exists, but traders will ask ("change that alert to 75").

## Limits
- C2-039 and C2-072 have no control file:line. The writer and the setName state are confirmed; the control was not located in time.
- C2-049 cites the nearest manual route because no dedicated copy control was found.
- "Follow-ups work" is yes only where a test shows a follow-up turn. Unknown means no such test was found, not that it fails.
- Backend and engine internals are out of scope.


# Charts inventory part 3: workspace around the chart

Commit 179d57570d, read from C:/w/aaudit. Evidence comes from source and test-file reading only. No tests were run.

**Counts:** 223 rows. MISSING 128, VERIFIED 55, IMPLEMENTED / UNVERIFIED 21, BLOCKED 13, UNMAPPED 6. By priority: P0 31, P1 82, P2 110.

## How to read this

**Path shorthand.** `CW` = app/src/pages/charts/ChartsWorkspace.jsx. `WL` = app/src/pages/Watchlists.jsx. `TT` = app/src/pages/ThemeTrackerPage.jsx. `W/` = app/src/pages/charts/widgets/. `G/` = app/src/pages/charts/grid/. `C/` = app/src/pages/charts/. Test names without a path are in app/src/agent/. `test:N` is the line of the `it(`.

**States, as I applied them.** The coordinator's update named the states but did not define them, so these readings are mine:

- `VERIFIED`: a named test commits the capability (real panel or `commitPlan`) and reads the resulting state back.
- `IMPLEMENTED / UNVERIFIED`: the capability exists, but no such test exists, or it covers only part of the action. The missing-work column says which.
- `MISSING`: the human action works and the Agent has no route to it.
- `BLOCKED`: the Agent should not do it, or cannot until someone decides. The reason is in missing work.
- `UNMAPPED`: a human control I found but did not trace to a writer or judge. This is an honest gap in this pass.

**VERIFIED means state-level, on a fixture board.** No test mounts the Agent inside the real `ChartsWorkspace`. Agent tests use the real panel or runtime with `__fixtures__/board.js` (real placement and applyBoard, per agentOperatorLive.test.jsx header). A widget's reaction to its `opts` is therefore not proven. D1 below shows this gap produces false receipts, so treat VERIFIED as "the canonical state was written", and downgrade it if the owner requires a real-workspace run.

**capreg** is app/src/agent/qa/capabilityRegression. Its `corpus.finalState.*.test.jsx` suites run the backticked cases.

**Follow-ups.** `yes` means a named test or a capreg `multiStep` entry (coverage.json) shows the follow-up. `unknown` means a capability exists but no follow-up proof was found. `no` means no capability exists.

**Confirmation and Undo** come from manifest `risk` / `undo`, tightened by tests. `undo unproven` means the manifest says exact but capreg has `undo: false` and I found no test.

**Guide.** Charts-surface topics in guide/registry.js are link, charts, watchlists, layouts, plus chart-only topics. Only three of the 11 Charts topics touch the workspace beyond linking (charts, watchlists, layouts). discovery.js topics (arrange, widgets, layouts, watchlists, alerts) answer "can you…", but they are not tutorials.

## Defects

- **D1 (HIGH, false receipt): `widget.setOption` writes four option keys the live widget never reads.** The receipt says the change was made, the opts are saved, and nothing changes on screen.
  - `themes.period` and `themes.sortDir`: TT:545 uses local `useState({key:'Today',...})`. TT reads only `opts.todayBasis` and `opts.themeSetId` (TT:551, 559, 593).
  - `breadth.tileStyle`: W/BreadthWidget.jsx:398 reads `bwSettings.tileStyle`, which comes from the global pref `breadth_widget_settings`, not opts.
  - `calendar.tbdOpen`: W/CalendarWidget.jsx:311 is `useState(false)`.
  - `nhnl.minCount`: W/NewHighsLowsWidget.jsx:213 hard-codes `min_count=1`.
  - These keys are `paramsSchema` entries for journal captures, not widget controls. agentWidgetOptions.test.jsx:35 and :104 pass only because they read `opts`, so the test's flagship phrase "show the theme tracker by week" is one of the false receipts.
  - The other offered keys are read live: fundamentals.view, news.filter, calendar.econStars, optionsflow.lead/scope, volumescan.showLogos.
- **D2 (LOW, dead code): `handleDrop` at WL:1078 has no caller.** No `onDrop` or `onDragStart` is wired for rows, so a human cannot reorder a list by drag. The `/reorder` route is reachable only through `watchlist.reorder`. `setFilterText` at WL:1008 also has no caller. The comment at WL:21 still promises reorder.
- **D3 (LOW, stale copy): the ScannerWidget.jsx header and picker text describe scans as a "disabled create your own".** My Scans and Community are "coming soon" panels (W/ScannerPicker.jsx:158, :166). No scan can be built inside the Scanner widget.
- **D4 (LOW, inconsistent writes): AlertsWidget `addAlert` ignores the response (W/AlertsWidget.jsx:137).** A refused create fails silently for humans, while the Agent's `alert.create` reports it. Same route, different honesty.
- **D5 (NOTE): capreg shows 0 phrasings for a whole family of board capabilities.** widget.move, resize, showList, showScan, setOption, selectTab, renameTab, closeTab, addTab; chart.selectTab, chart.linkTab, chart.applyThemeAll; watchlist.open, layout.current, layout.saveCurrent. Some have direct tests (see rows), but none has an NL routing, argument or receipt regression case.

## Not rows, by design

- **Dark pool and heatmap widgets:** the brief named them, but no such widget exists in widgets/registry.js or widgets/ at this commit. The nearest are the Breadth heatmap view (W/BreadthWidget.jsx:478) and Market Map (ScatterWidget).
- **Agent-only actions with no human control:** `watchlist.clear`, `board.swap`, `widget.addCharts`, `chartGrid.set`, `chart.applyThemeAll`. They are mapped from other work, not from a control here.
- **App theme, default timeframe and page navigation:** these live outside app/src/pages/charts, so they are left to the part that covers Settings.
- **Mobile:** only the review stepper appears, because it is unique to the mobile shell.

## Matrix

| ID | area | human action | UI control | canonical writer/hook | Agent capability | status | follow-ups | confirmation / Undo | guide | evidence | missing work | example phrase | priority |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| C3-001 | Board | Add a widget from Widgets ▾ | CW:3545 | handleAddWidget CW:1679 | widget.add | VERIFIED | yes | local; exact Undo | charts | agentMultiActionFollowups.test.jsx:108, :170; capreg `widget.news` | none | add a news widget | P0 |
| C3-002 | Board | Drag a widget to move it, or nudge it | CW:3435, handleNudge CW:1904 | handleDragStop CW:1289 → repackAroundMoved CW:501 | widget.move | VERIFIED | unknown | local; exact Undo; refused while any widget floats | charts | agentBoard.test.jsx:117, :129, :231 | capreg phrasings (D5) | move my watchlist to the left | P0 |
| C3-003 | Board | Drag a widget edge or merged seam to resize | C/MergedSeamOverlay.jsx via handleSeamResize CW:1505 | handleLayoutChange CW:1303 / handleSeamResize | widget.resize | VERIFIED | unknown | local; exact Undo | charts | agentBatch6.test.jsx:192, :204 | capreg phrasings (D5) | make the watchlist narrower | P0 |
| C3-004 | Board | Close a widget | C/WidgetHeader.jsx:388 | handleRemoveWidget CW:1486 | widget.remove | VERIFIED | unknown | local for one, proposed for two; exact Undo | none | agentBoard.test.jsx:64, :82; :301 full tab restore | guide topic | close the news widget | P0 |
| C3-005 | Board | Merge or unmerge widgets (lock board, drop borders) | CW:3560 | toggleMerged CW:818 → setPref charts_merged | none | MISSING | no | n/a | none | no capability in manifest or board.js | new local capability with exact Undo on the pref | merge my widgets | P2 |
| C3-006 | Link | Cycle a widget's link colour | C/WidgetHeader.jsx:301 | handleColorChange CW:1519 | widget.setLink | VERIFIED | unknown | local; undo unproven | link | agentBoard.test.jsx:138, :145 | Undo test (capreg undo false) | link the watchlist to the gold charts | P0 |
| C3-007 | Link | Change a tool panel's colour group | W/EtfHoldingsPanel.jsx:83; C/PeriodSortPanel.jsx:88 | local setPanelColor | none | MISSING | no | n/a | none | panels are not board widgets | only worth doing with panel support | link the holdings panel to blue | P2 |
| C3-008 | Float | Float a widget over another | C/WidgetHeader.jsx:325 | handleFloatWidget CW:2490 | none | MISSING | no | n/a | none | no capability; board ops wait while one floats (agentBoard.test.jsx:231) | new capability | float the watchlist over the chart | P2 |
| C3-009 | Float | Drag or resize a floating widget | C/WidgetHeader.jsx:293; C/FloatingWidgetPanel.jsx:85 | FloatingWidgetPanel local state → board | none | BLOCKED | no | Agent deliberately refuses | none | agentBoard.test.jsx:229-246 | owner decision to lift the "never edits floating" rule | move the floating watchlist right | P2 |
| C3-010 | Float | Dock a floating widget back into the grid | C/WidgetHeader.jsx:344 | handleDockFloatWidget CW:2496 | none | MISSING | no | n/a | none | no capability | new capability; placement may refuse | dock the floating watchlist | P2 |
| C3-011 | Float | Move a floating widget into another widget's tabs | C/WidgetHeader.jsx:371 | handleFloatWidgetToTab CW:2507 | none | MISSING | no | n/a | none | widget.addTab only creates a new tab | new capability | put the floating news into the watchlist tabs | P2 |
| C3-012 | Popout | Pop a widget into its own window | C/WidgetHeader.jsx:334 | handlePopOutWidget CW:2476 | none | MISSING | no | n/a | none | no capability | new capability; check popup blocking when not click-driven (not tested here) | pop the watchlist out | P1 |
| C3-013 | Popout | Pop out the whole layout | CW:3647 | handlePopOutLayout CW:2529 | none | MISSING | no | n/a | none | no capability | same popup check | pop this layout out to my other monitor | P2 |
| C3-014 | Popout | Dock a popped widget or layout back | C/WidgetHeader.jsx:344 (onDock) | handleDockWidget CW:2479, handleDockLayout CW:2540 | none | MISSING | no | n/a | none | no capability | new capability, with state read across windows | bring the popped watchlist back | P2 |
| C3-015 | Popout | Close a popped widget | C/WidgetHeader.jsx:388 | handleRemovePoppedWidget CW:2483 | none | MISSING | no | n/a | none | widget.remove targets the grid; popped/floating refused | extend widget.remove | close the popped chart | P2 |
| C3-016 | Widget tabs | Add a widget as a tab | C/WidgetHeader.jsx:249, :264 | addWidgetTab C/widgetTabs.js | widget.addTab | VERIFIED | unknown | local; exact Undo | none | agentChartsOperatorP1.test.jsx:564 | guide topic; capreg (D5) | add news as a tab on the watchlist | P1 |
| C3-017 | Widget tabs | Switch a widget tab | C/WidgetHeader.jsx:195 | setActiveWidgetTab | widget.selectTab | VERIFIED | unknown | local; exact Undo | none | agentBoard.test.jsx:259 | capreg (D5) | switch that widget to the news tab | P1 |
| C3-018 | Widget tabs | Rename a widget tab | C/WidgetHeader.jsx:196 | renameWidgetTab | widget.renameTab | VERIFIED | unknown | local; exact Undo | none | agentBoard.test.jsx:268 | capreg (D5) | rename that tab to Earnings | P2 |
| C3-019 | Widget tabs | Close a widget tab | C/WidgetHeader.jsx:223 | closeWidgetTab | widget.closeTab | VERIFIED | unknown | local; exact Undo; human UI asks twice, Agent does not | none | agentBoard.test.jsx:268, :280, :301 | capreg (D5) | close the news tab | P1 |
| C3-020 | Chart tabs | Add a chart tab | W/ChartTabStrip.jsx:129 | addChartTab C/chartTabs.js | chart.addTab | VERIFIED | unknown | local; exact Undo | none | agentBatch6.test.jsx:222; capreg `chart.addTab` | none | open a new tab on this chart | P1 |
| C3-021 | Chart tabs | Switch a chart tab | W/ChartTabStrip.jsx:81 | setActiveChartTab | chart.selectTab | VERIFIED | unknown | local; exact Undo | none | agentBatch6.test.jsx:222 | capreg (D5) | go to the second tab | P1 |
| C3-022 | Chart tabs | Rename a chart tab | W/ChartTabStrip.jsx:82 | renameChartTab | chart.renameTab | VERIFIED | yes | local; exact Undo | none | agentBatch6.test.jsx:222; capreg multiStep | none | call this tab Daily | P2 |
| C3-023 | Chart tabs | Change a chart tab's link colour | W/ChartTabStrip.jsx:93 | patchChartTab | chart.linkTab | VERIFIED | unknown | local; exact Undo | link (widget only) | agentBatch6.test.jsx:222 | capreg (D5) | link this tab to green | P2 |
| C3-024 | Chart tabs | Close a chart tab | W/ChartTabStrip.jsx:120 | closeChartTab | chart.closeTab | VERIFIED | yes | local; exact Undo | none | agentBatch6.test.jsx:222; capreg multiStep | none | close this tab | P1 |
| C3-025 | Layout Dock | Open a saved layout | C/LayoutDock.jsx:249; CW:3586-3601 | handleDockOpen CW:2865 | layout.open | VERIFIED | unknown | local; exact Undo; proposed if unsaved edits would be lost; exclusive step | layouts | agentLayouts.test.jsx:71, :110, :151 | none | open my Swing layout | P0 |
| C3-026 | Layout Dock | See which layout is open | C/LayoutDock.jsx:293 | agentLayoutsRef snapshot | layout.current, layout.list | VERIFIED | unknown | read only | layouts | agentLayouts.test.jsx:52, :248 | capreg for layout.current | what layout am I on | P1 |
| C3-027 | Layout Dock | Undo a layout switch from the toast | CW:3497 | undoLayoutOpen, C/layoutUndo.js | layout.open (by name); agent.undo for Agent's own switch | IMPLEMENTED / UNVERIFIED | unknown | Agent undoes only its own; human toast undoes clicks; contract in ChartsWorkspace.layoutUndoAgent.test.jsx | layouts | agentLayouts.test.jsx:71 covers the Agent's own; no test for "go back to the previous layout" after a human click | a "previous layout" referent | go back to my last layout | P1 |
| C3-028 | Layout Dock | Create a new layout from the dock | C/LayoutDock.jsx:364 | handleDockCreate CW:2915, C/dockCreate.js | layout.create | VERIFIED | unknown | proposed; exact Undo until opened | layouts | agentLayouts.test.jsx:356, :392 | none | create a blank layout called Research | P1 |
| C3-029 | Layout Dock | Start a new blank board from the Layouts menu | CW:3636 | handleNewLayout CW:2336 | layout.create then layout.open | IMPLEMENTED / UNVERIFIED | unknown | two steps by design | layouts | agentLayouts.test.jsx:403 says create only, switching is separate | one-request create-and-open, or leave as two steps | give me a blank board | P2 |
| C3-030 | Layout Dock | Save the open layout | C/LayoutDock.jsx:454; CW:3612 | handleSaveLayout CW:2423 | layout.saveCurrent | VERIFIED | unknown | proposed; no Undo | layouts | agentBoard.test.jsx:200, :212 | capreg (D5) | save my layout | P0 |
| C3-031 | Layout Dock | Save as a new layout | CW:3630 | handleSaveAsTemplate CW:2403 | layout.saveAs | VERIFIED | unknown | proposed; no Undo; never overwrites | layouts | agentLayouts.test.jsx:162, :175, :182 | none | save this as Earnings Week | P1 |
| C3-032 | Layout Dock | Save a layout as a global template (admin) | CW:3626 | handleSaveAsTemplate scope=global | none | BLOCKED | no | n/a | none | saveAs has no scope arg | owner decision: shared template for all members | publish this layout as a template | P2 |
| C3-033 | Layout Dock | Rename a layout | C/LayoutDock.jsx:460, :267 | handleDockRename CW:2834 | layout.rename | VERIFIED | unknown | proposed; exact Undo | layouts | agentLayouts.test.jsx:193, :204 | none | rename Swing to Swing 2 | P1 |
| C3-034 | Layout Dock | Duplicate a layout | C/LayoutDock.jsx:465 | handleDockDuplicate CW:2817 | layout.duplicate | VERIFIED | unknown | proposed; no Undo | layouts | agentLayouts.test.jsx:321, :333 | none | make a copy of my Swing layout | P2 |
| C3-035 | Layout Dock | Delete a layout | C/LayoutDock.jsx:389; CW:3605 | handleDockDelete CW:2848 | layout.delete | VERIFIED | unknown | proposed; no Undo; never the open one | layouts | agentLayouts.test.jsx:260, :285, :308 | none | delete my old Swing layout | P2 |
| C3-036 | Layout Dock | Delete a prebuilt template (admin) | CW:3594 | handleDeleteTemplate CW:2456 | none | BLOCKED | no | n/a | none | agentProtectedLayouts.test.js; layout.delete is own-only | owner decision; keep refused | delete the prebuilt layout | P2 |
| C3-037 | Layout Dock | Pin a layout to the bar | C/LayoutDock.jsx:373, :401 | addToBar, C/layoutDockPins.js | none | MISSING | no | n/a | none | no capability | new local capability | pin Swing to my layouts bar | P2 |
| C3-038 | Layout Dock | Reorder layouts on the bar | C/LayoutDock.jsx:441, :446 | move, C/layoutDockPins.js | none | MISSING | no | n/a | none | no capability | new local capability | move Swing to the front | P2 |
| C3-039 | Layout Dock | Remove a layout from the bar | C/LayoutDock.jsx:477 | closeSlot, C/layoutDockPins.js | none | MISSING | no | n/a | none | no capability | new local capability | take Swing off the bar | P2 |
| C3-040 | Layout Dock | View a layout's version history | C/LayoutDock.jsx:471; C/VersionHistory.jsx:289 | VersionHistory | none | MISSING | no | n/a | none | no capability | read capability | what versions of this layout exist | P2 |
| C3-041 | Layout Dock | Restore a layout version | C/VersionHistory.jsx:315 | handleVersionRestored CW:2618, handleDockRestored CW:2858 | none | MISSING | no | n/a | none | no capability | proposed capability with stale checks | restore yesterday's layout | P1 |
| C3-042 | Multi Chart | Enter a preset grid | G/MultiChartMenu.jsx:155 | useMultiChartState enterGrid :118 | none (chartGrid.set is a different writer) | MISSING | no | n/a | charts (widget grid only) | chartGrid.set writes board widgets, not mc state | decide whether Multi Chart mode needs its own capability or chartGrid.set replaces it | use the 3x3 multi chart | P1 |
| C3-043 | Multi Chart | Apply a custom rows × columns grid | G/MultiChartMenu.jsx:180 | applyCustomLayout :129 | none | MISSING | no | n/a | none | as above | as above | multi chart 2 by 5 | P2 |
| C3-044 | Multi Chart | Exit Multi Chart | G/MultiChartMenu.jsx:267; CW:3237, CW:3690 | exitGrid :125 | none | MISSING | no | n/a | none | no capability | new capability | exit multi chart | P1 |
| C3-045 | Multi Chart | Toggle crosshair sync | G/MultiChartMenu.jsx:188 | setSyncCrosshair :214 | none | MISSING | no | n/a | none | no capability | new capability | sync the crosshairs | P1 |
| C3-046 | Multi Chart | Toggle time-range sync | G/MultiChartMenu.jsx:195 | setSyncTimeRange :218 | none | MISSING | no | n/a | none | no capability | new capability | sync the time range | P1 |
| C3-047 | Multi Chart | Turn on Groups mode | G/MultiChartMenu.jsx:203 | setGroupsMode :222 | none | MISSING | no | n/a | none | no capability | new capability | show theme groups in the grid | P1 |
| C3-048 | Multi Chart | Pick a group for the grid | G/GroupPicker.jsx:59, :74 | setGroup :206 | none | MISSING | no | n/a | none | no capability | new capability | load Semis into the grid | P1 |
| C3-049 | Multi Chart | Step or switch group | G/MultiChartMenu.jsx:282; G/GroupHeatHeader.jsx:41 | stepGroup, onSwitch | none | MISSING | no | n/a | none | no capability | new capability | next group | P1 |
| C3-050 | Multi Chart | Refresh the group | G/MultiChartMenu.jsx:286 | fillCells with fetchGroupTop/fetchPeers | none | MISSING | no | n/a | none | no capability | new capability | refresh this group | P2 |
| C3-051 | Multi Chart | Exit Groups | G/MultiChartMenu.jsx:312 | setGroupsMode(false) | none | MISSING | no | n/a | none | no capability | new capability | exit groups | P2 |
| C3-052 | Multi Chart | Apply a saved grid | G/MultiChartMenu.jsx:220, :229 | applyGridTemplate :230 | none | MISSING | no | n/a | none | no capability | new capability | open my 4-up grid | P1 |
| C3-053 | Multi Chart | Save a grid | G/MultiChartMenu.jsx:256 | handleSaveAs | none | MISSING | no | n/a | none | no capability | new capability | save this grid as Leaders | P2 |
| C3-054 | Multi Chart | Save a grid as global (admin) | G/MultiChartMenu.jsx:251 | saveScope global | none | BLOCKED | no | n/a | none | same rule as global layouts | owner decision | publish this grid | P2 |
| C3-055 | Multi Chart | Delete a saved grid | G/MultiChartMenu.jsx:222, :230 | deleteLayout | none | MISSING | no | n/a | none | no capability | proposed capability | delete my 4-up grid | P2 |
| C3-056 | Multi Chart | Set a cell's timeframe | G/GridChartCell.jsx:382 | handleTfChange | none proven (chart.setTimeframe targets board charts) | UNMAPPED | unknown | unknown | timeframe | did not trace whether grid cells are chart targets | trace cells as targets | make cell 2 weekly | P1 |
| C3-057 | Multi Chart | Set a cell's chart style | G/GridChartCell.jsx:334 | handleTypeChange | none proven | UNMAPPED | unknown | unknown | none | same | trace cells as targets | hollow candles in this cell | P2 |
| C3-058 | Multi Chart | Toggle a cell's session | G/GridChartCell.jsx:423, :439 | setSessionView, setExtHours | none proven | UNMAPPED | unknown | unknown | none | same | trace cells as targets | turn on extended hours here | P2 |
| C3-059 | Multi Chart | Reset a cell to my chart | G/GridChartCell.jsx:346, :570 | resetToMyChart | none | MISSING | no | n/a | none | no capability | new capability | reset this cell | P2 |
| C3-060 | Multi Chart | Maximize or restore a cell | G/GridChartCell.jsx:366 | onToggleMaximize | none | MISSING | no | n/a | none | no capability | new capability | maximize this chart | P1 |
| C3-061 | Multi Chart | Open shared grid settings | G/MultiChartMenu.jsx:212; G/GridChartCell.jsx:357 | setSettingsOpen | none | MISSING | no | n/a | settings (single chart) | no capability | guide target | open the shared chart settings | P2 |
| C3-062 | Multi Chart | Set an alert from a cell | G/GridChartCell.jsx:561 | handleSetAlert | alert.create | IMPLEMENTED / UNVERIFIED | unknown | proposed; Undo until fired | none | alert.create tested on the route, not from a cell | cell price context | alert me here | P2 |
| C3-063 | Watchlist | Open a list in a widget (own) | W/WatchlistPicker.jsx:313 | onOptsChange watchKey user:<id> | widget.showList, watchlist.open | VERIFIED | unknown | local; exact Undo | watchlists | agentBoard.test.jsx:158 proves showList with Undo; watchlist.open appears only in scripted plans (agentEval.test.jsx:114) and fast-path parsing (agentGateBSafety.test.js:35), so it has no read-back of its own | read-back test for watchlist.open; capreg (D5) | show my Momentum list | P0 |
| C3-064 | Watchlist | Open a prebuilt or community list | W/WatchlistPicker.jsx:250, :267 | handlePick community:<id> | none | MISSING | no | n/a | watchlists | showList resolves own lists only (board.js:868) | allow community keys | show the Leaders list | P1 |
| C3-065 | Watchlist | Open the Flagged list | W/WatchlistPicker.jsx:305 | handlePick flagged | none | MISSING | no | n/a | watchlists | flagged excluded (watchlist.js header) | show-only path is safe | show my flagged list | P1 |
| C3-066 | Watchlist | Open a colour-tag list | WL:3084, :3169 | toggleList tag:<color> | none | MISSING | no | n/a | none | no tag concept in capabilities | read/show path | show my red tags | P2 |
| C3-067 | Watchlist | Go back to the list picker | WL:2948 | onExitPick | none | MISSING | no | n/a | none | no capability | low value | go back to the list picker | P2 |
| C3-068 | Watchlist | Click a row to load the symbol | WL:601 | activateRow → setGroupSym | chart.setSymbol | VERIFIED | yes | local; exact Undo | watchlists, symbol | capreg finalState `symbol.switch` | "the next name in the list" referent | show NVDA | P0 |
| C3-069 | Watchlist | Walk the list with arrow keys or space | WL:1578 | handleKeyDown | none | MISSING | no | n/a | none | no list position concept | referent for next/previous row | next ticker | P0 |
| C3-070 | Watchlist | Create a list | W/WatchlistPicker.jsx:280; WL:3038 | POST /api/watchlists | watchlist.create | VERIFIED | yes | proposed; no Undo; filled in one proposal | none | agentWatchlists.test.jsx:189, :203; capreg multiStep | template pick at W/WatchlistPicker.jsx:290 not offered | create a Momentum list | P1 |
| C3-071 | Watchlist | Create a list from a template | W/WatchlistPicker.jsx:290 | tplId create | none | MISSING | no | n/a | none | create has name and as only | add template arg | make a list from my template | P2 |
| C3-072 | Watchlist | Save a community list to My Lists | WL:2608; app/src/pages/watchlist/SaveListDialog.jsx:106 | SaveListDialog | none | MISSING | no | n/a | none | no capability | proposed capability | save this list to mine | P2 |
| C3-073 | Watchlist | Rename a list | WL:3506, :2579 | handleRename | watchlist.rename | VERIFIED | unknown | proposed; exact Undo | none | agentWatchlists.test.jsx:222 | none | rename Momentum to Leaders | P1 |
| C3-074 | Watchlist | Rename the Flagged list | WL:2792 | renameFlagged | none | MISSING | no | n/a | none | flagged excluded | small capability | rename Flagged to Focus | P2 |
| C3-075 | Watchlist | Delete a list | W/WatchlistPicker.jsx:324; WL:2655 | DELETE /api/watchlists/:id | watchlist.delete | VERIFIED | unknown | proposed; no Undo; refused if a widget shows it | none | agentWatchlists.test.jsx:377, :388, :395 | none | delete my old list | P2 |
| C3-076 | Watchlist | Add a symbol | WL:2634, :2956, :2742 | handle add route (WL:1820 dedupe) | watchlist.add | VERIFIED | yes | local; exact Undo; big batch proposed | watchlists | agentWatchlists.test.jsx:73, :88, :98 | none | add NVDA to Momentum | P0 |
| C3-077 | Watchlist | Add to Flagged | WL:2835 | toggleFlag | none | MISSING | no | n/a | none | flagged set syncs whole (overwrite race, watchlist.js header) | needs a safe per-symbol route | flag NVDA | P0 |
| C3-078 | Watchlist | Flag or unflag a row (star) | WL:450; TT:334 | onToggleFlag | none | MISSING | no | n/a | none | same | same | unflag TSLA | P0 |
| C3-079 | Watchlist | Remove a symbol | WL:3499 | handleRemoveSym | watchlist.remove | VERIFIED | unknown | local; exact Undo with note and order | watchlists | agentWatchlists.test.jsx:157, :169 | none | remove NVDA from Momentum | P0 |
| C3-080 | Watchlist | Remove all starred symbols from a list | WL:3550 | handleRemoveStarred | none (watchlist.remove with explicit symbols) | IMPLEMENTED / UNVERIFIED | unknown | local; exact Undo | none | no starred concept; remove takes tickers | starred resolver | remove the starred names | P2 |
| C3-081 | Watchlist | Reorder symbols by hand | none reachable: WL:1078 is dead (D2) | PUT /api/watchlists/:id/reorder | watchlist.reorder | VERIFIED | unknown | local; exact Undo | none | agentChartsOperatorP1.test.jsx:358, :366, :377 | human UI missing, Agent-only (D2) | move NVDA to the top of Momentum | P1 |
| C3-082 | Watchlist | Sort by a column | WL:2388 | handleColSort WL:2161 → saveColCfg | none (reorder rewrites the stored list, not the view sort) | MISSING | no | n/a | none | watchlist.reorder sort is A–Z on the stored order | per-widget view sort capability | sort my watchlist by RVOL | P0 |
| C3-083 | Watchlist | Show or hide a column | WL:3356, :3362, :3021 | toggleColHidden WL:2160, toggleExtraCol WL:2109 | none | MISSING | no | n/a | none | cols live in localStorage (registry comment) | capability over saveColCfg | add the ADR column | P0 |
| C3-084 | Watchlist | Apply a column preset | WL:3026 | setVisiblePerf | none | MISSING | no | n/a | none | no capability | capability over saveColCfg | use the performance columns | P1 |
| C3-085 | Watchlist | Reorder columns by drag | WL:2369 | dragColRef → saveColCfg | none | MISSING | no | n/a | none | no capability | capability over saveColCfg | move RVOL next to price | P2 |
| C3-086 | Watchlist | Resize a column | WL:2409 | column divider → saveColCfg | none | MISSING | no | n/a | none | no capability | low value | widen the symbol column | P2 |
| C3-087 | Watchlist | Reset columns | WL:3368 | saveColCfg({}) | none | MISSING | no | n/a | none | no capability | capability over saveColCfg | reset my columns | P2 |
| C3-088 | Watchlist | Write or edit a ticker note | WL:3485, :2696 | toggleNoteSym WL:1887, saveNote | watchlist.setNote | VERIFIED | unknown | local; exact Undo per test, capreg undo false | none | agentChartsOperatorP1.test.jsx:384 | capreg Undo case | note on NVDA: earnings gap | P1 |
| C3-089 | Watchlist | Expand or collapse a list | WL:2568 | toggleList | none | MISSING | no | n/a | none | no capability | low value | expand Momentum | P2 |
| C3-090 | Watchlist | Tag a symbol with a colour | app/src/pages/journal-2-0/GlobalAddPositionProvider.jsx:265 | useTickerTags setTag | none | MISSING | no | n/a | none | no capability | new capability | tag NVDA red | P1 |
| C3-091 | Watchlist | Share a tag colour or Flagged | WL:3117, :2844 | toggleShareColor, toggleShare | none | BLOCKED | no | n/a | none | publishes member data | owner decision | share my red tags | P2 |
| C3-092 | Watchlist | Make a list public | WL:2650 | handleTogglePublic WL:1798 | none | BLOCKED | no | n/a | none | publishes member data | owner decision | make this list public | P2 |
| C3-093 | Watchlist | Mark a list prebuilt (admin) | WL:2644 | handleTogglePrebuilt WL:1809 | none | BLOCKED | no | n/a | none | admin-only, reaches all members | keep refused | make this a prebuilt list | P2 |
| C3-094 | Watchlist | Copy a list to the clipboard | WL:3517 | handleCopyList WL:1151 | none | MISSING | no | n/a | none | no capability | watchlist.show already gives the symbols | copy this list | P2 |
| C3-095 | Watchlist | Export a list as CSV or Excel | WL:3521, :3527 | exportCSV WL:1047 | none | MISSING | no | n/a | none | no capability | file download path | export Momentum | P2 |
| C3-096 | Watchlist | Import tickers | WL:3535, :3342 | import modal | watchlist.add | IMPLEMENTED / UNVERIFIED | unknown | local; big batch proposed | none | add is proven; paste parsing is not | paste-to-add phrase test | add these 30 tickers | P2 |
| C3-097 | Watchlist | View or restore list version history | WL:3544, :3575 | Sheet history | none | MISSING | no | n/a | none | no capability | proposed capability | restore yesterday's Momentum | P2 |
| C3-098 | Watchlist | Set a price alert from a row | WL:3490, :3395 | alertPopover → /api/watchlist-alerts | alert.create | VERIFIED | unknown | proposed; Undo until it fires | none | agentAlerts.test.jsx:161, :176 | none | alert me if NVDA hits a level | P0 |
| C3-099 | Watchlist | Delete an alert from the row popover | WL:3406 | deleteAlert | alert.delete | VERIFIED | unknown | proposed; no Undo | none | agentAlerts.test.jsx:248, :259 | none | delete my NVDA alert | P1 |
| C3-100 | Watchlist | Open Full Research or AI from a row | WL:3469, :3473 | navigate /research | app.open | IMPLEMENTED / UNVERIFIED | unknown | local | none | agentBatch1 and agentBatch4 route it; capreg none | capreg case | open research on NVDA | P1 |
| C3-101 | Watchlist | Compare from a row | WL:3477, :3445 | comparePopover | chart.compare | VERIFIED | unknown | local; exact Undo | none | agentBatch6.test.jsx:120; capreg ex/re/un | none | compare NVDA to this chart | P1 |
| C3-102 | Watchlist | Open a row's attention facts | WL:590, :3424 | onAttention popover | none | UNMAPPED | unknown | unknown | none | did not trace intelFacts to a query | trace | why is NVDA flagged | P2 |
| C3-103 | Watchlist | Change list appearance (canvas, text, tint) | W/WatchlistPicker.jsx:204 via app/src/pages/watchlist/WatchlistSettingsPanel.jsx:228-289 | patchSettings opts.settings | none | MISSING | no | n/a | none | setOption excludes json settings | shared widget-appearance capability | make the list text bigger | P2 |
| C3-104 | Watchlist | Save or load a watchlist look | app/src/pages/watchlist/WatchlistSettingsPanel.jsx:172, :221 | templates | none | MISSING | no | n/a | none | no capability | low value | use my dark watchlist look | P2 |
| C3-105 | Watchlist | Track or freeze a linked scan or theme | W/ListSubscription.jsx:201, :204 | listSub opts | none | BLOCKED | no | n/a | none | dark behind CHARTS_LIST_SUBSCRIBE_ENABLED | ship the flag first; agent refuses listSub widgets | track that scan here | P1 |
| C3-106 | Watchlist | Use a saved screen as a list | W/ListSubscription.jsx:309, :325 | ScreenSourceOffer | none | BLOCKED | no | n/a | none | same flag | same | show my Breakout screen as a list | P1 |
| C3-107 | Scanner | Pick a preset scan | W/ScannerPicker.jsx:142 | pickScan W/ScannerWidget.jsx:20 | widget.showScan | VERIFIED | unknown | local; exact Undo | none | agentBoard.test.jsx:171 | guide topic; capreg (D5) | show highest volume in 1 year | P0 |
| C3-108 | Scanner | Leave a scan, back to the picker | WL:2948 in scan mode | exitScan W/ScannerWidget.jsx:24 | none | MISSING | no | n/a | none | no capability | small; or showScan replaces it | change this scanner | P2 |
| C3-109 | Scanner | Search the preset list | W/PickerHeader.jsx:66 | local filter | none | MISSING | no | n/a | none | hints carry every scan name | low value | which volume scans are there | P2 |
| C3-110 | Scanner | Read a scan's conditions | WL:2975 | Scan criteria popover (read only) | none | MISSING | no | n/a | none | no query returns preset criteria; board only says `shows` (board.js:594) | read capability | what does this scan filter on | P1 |
| C3-111 | Scanner | Read a scan's results | W/ScannerResults.jsx:308 | /api/scans/<key> | none | MISSING | no | n/a | none | no capability reads a Scanner widget; screener.run is a different engine | query capability | what's top of this scan | P0 |
| C3-112 | Scanner | Refresh a scan | W/ScannerResults.jsx:295 | mutate() | none | MISSING | no | n/a | none | no capability | low value, polls every 30 s | refresh the scan | P2 |
| C3-113 | Scanner | Sort a scan | WL:2388 in scan mode | handleColSort, per-scan cols key | none | MISSING | no | n/a | none | same gap as watchlist sort | shared with watchlist sort | sort this scan by RVOL | P1 |
| C3-114 | Scanner | Change scan columns | WL:3356 in scan mode | saveColCfg per-scan | none | MISSING | no | n/a | none | same gap as watchlist columns | shared with columns | add ADR to this scan | P1 |
| C3-115 | Scanner | Create a scanner in the workspace | W/ScannerPicker.jsx:158 (coming soon panel) | none exists | none | BLOCKED | no | n/a | none | product has no writer here (D3); screener.saveAs and BuilderSheet live elsewhere | product must ship the builder door first | build a scan for RS leaders | P1 |
| C3-116 | Scanner | Modify a preset scan's conditions | none; WL:2980 is read only | none exists | none | BLOCKED | no | n/a | none | presets are server-defined; only the Screener can refine (screener.run within, scanRefine.js) | decide: copy a preset into a saved screen? | tighten this scan to over $10 | P1 |
| C3-117 | Scanner | Open an AI Search scan in the builder and edit conditions | W/ScanObjectCard.jsx:98 | BuilderSheet, its own Save only | none | MISSING | no | n/a | none | card is AI Search only; no capability opens the sheet | guide or door capability; the sheet's Save stays the only write | open that scan in the builder | P1 |
| C3-118 | Scanner | Run or refine a screen from the workspace chat | Agent panel CW:3701 | Screener engine | screener.run | VERIFIED | yes | local; read only | none | capreg `screener.adr`, follow-up `scan.refine.sector` | none | now only technology | P0 |
| C3-119 | Scanner | Save a screen run from the workspace | Agent panel CW:3701 | saved screens route | screener.saveAs | VERIFIED | yes | proposed; exact Undo per manifest, capreg undo false | none | capreg ex/multiStep; agentScreener.test.jsx | Undo case | save this as Breakouts | P1 |
| C3-120 | Scanner | Send a scan to Journal | W/ScannerResults.jsx:252, :262 | sendCaptureToJournal | none | MISSING | no | n/a | none | no capture capability; applies to every widget door below | one shared capture capability | send this scan to my journal | P1 |
| C3-121 | Volume Surge | Choose what the scanner watches | W/VolumeScanLists.jsx:181, :119, :139 | helpers.setActive → opts.volActive | none | MISSING | no | n/a | none | no capability | new option | scan only my Semis list | P1 |
| C3-122 | Volume Surge | Create, rename or delete a scope list | W/VolumeScanLists.jsx:168, :147, :149 | helpers create/rename/remove | none | MISSING | no | n/a | none | no capability | new capability | make a surge list for semis | P2 |
| C3-123 | Volume Surge | Add a ticker to a scope list | W/VolumeScanLists.jsx:218 | helpers | none | MISSING | no | n/a | none | no capability | new capability | add NVDA to the surge list | P2 |
| C3-124 | Volume Surge | Set thresholds (RVOL, burst, move, $ floor) | W/VolumeScanWidget.jsx:143-148 (settings panel W/VolumeScanWidget.jsx:262) | opts.minRvol etc | none | MISSING | no | n/a | none | agentWidgetOptions.test.jsx:96 says unbounded numbers are never offered | declare min/max in paramsSchema | only show RVOL over 3 | P1 |
| C3-125 | Volume Surge | Toggle logos | W/VolumeScanWidget.jsx:155 | toggleLogos | widget.setOption (showLogos) | IMPLEMENTED / UNVERIFIED | unknown | local; exact Undo | none | key read live; not in the agentWidgetOptions.test.jsx:49 value list | add to the value list | show logos on volume surge | P2 |
| C3-126 | Volume Surge | Click a row or remove it from the list | W/VolumeScanWidget.jsx:120, :121 | onPick; right-click remove | chart.setSymbol for click; none for remove | IMPLEMENTED / UNVERIFIED | unknown | local | none | click same as watchlist row; remove not covered | remove path | drop that name | P2 |
| C3-127 | Alerts | See my alerts | W/AlertsWidget.jsx:168 | useSWR ALERTS_URL | alert.list | VERIFIED | unknown | read only | none | agentAlerts.test.jsx:123, :133 | guide topic | show my alerts | P0 |
| C3-128 | Alerts | Create a price alert | W/AlertsWidget.jsx:333 | addAlert → POST /api/watchlist-alerts | alert.create | VERIFIED | unknown | proposed; Undo until fired | none | agentAlerts.test.jsx:161, :176, :291 | D4 on the human side | alert me if AMD goes above a level | P0 |
| C3-129 | Alerts | Delete an alert | W/AlertsWidget.jsx:199 | removeAlert → DELETE | alert.delete | VERIFIED | unknown | proposed; no Undo | none | agentAlerts.test.jsx:248, :259, :271 | none | delete my AMD alert | P1 |
| C3-130 | Alerts | Click an alert to load the symbol | W/AlertsWidget.jsx:168 | goToSym | chart.setSymbol | VERIFIED | yes | local; exact Undo | symbol | capreg finalState `symbol.switch` | none | show that one on the chart | P1 |
| C3-131 | Alerts | Change Alerts widget appearance | W/AlertsWidget.jsx:290, :224 | patchSettings | none | MISSING | no | n/a | none | same gap as all widget settings | shared capability | darken the alerts widget | P2 |
| C3-132 | Alerts | Send alerts to Journal | W/AlertsWidget.jsx:252, :265 | sendCaptureToJournal | none | MISSING | no | n/a | none | see capture row | shared capture | send my alerts to journal | P2 |
| C3-133 | News | Filter catalysts up, down or all | W/NewsWidget.jsx:265 | opts.filter | widget.setOption (filter) | VERIFIED | unknown | local; exact Undo | none | agentWidgetOptions.test.jsx:49 | capreg (D5) | only show up catalysts | P1 |
| C3-134 | News | Read stored headlines for a symbol | W/NewsWidget.jsx:370 | news route | news.latest, news.catalysts | VERIFIED | unknown | read only | none | capreg `news.latest`, `news.catalysts` | none | any news on NVDA | P0 |
| C3-135 | News | Place a headline on the chart | W/NewsWidget.jsx:397 | placeOnChart | none | MISSING | no | n/a | none | no capability | new capability | pin that headline to the chart | P2 |
| C3-136 | News | Change News widget appearance | W/NewsSettingsPanel.jsx:140, :181 | patchSettings | none | MISSING | no | n/a | none | shared gap | shared capability | darken the news widget | P2 |
| C3-137 | News | Send the feed to Journal | W/NewsWidget.jsx:284, :294 | sendCaptureToJournal | none | MISSING | no | n/a | none | see capture row | shared capture | send this feed to journal | P2 |
| C3-138 | TE News | Search headlines | W/TradeExchangeNewsWidget.jsx:549 | setQueryRaw | none | MISSING | no | n/a | none | news.latest reads the company tab only | query over the archive | search the feed for Fed | P1 |
| C3-139 | TE News | Filter by category, linked symbol or watchlist | W/TradeExchangeNewsWidget.jsx:574; W/TradeExchangeNewsParts.jsx:581, :594 | patchOpts | widget.setOption has no key for it | MISSING | no | n/a | none | tradeExchangeNews not in the offered types | structured option | only show headlines on my watchlist | P1 |
| C3-140 | TE News | Apply, rename or delete a filter preset | W/TradeExchangeNewsParts.jsx:608, :610, :612 | savePreset W/TradeExchangeNewsWidget.jsx:350 | none | MISSING | no | n/a | none | no capability | new capability | use my macro preset | P2 |
| C3-141 | TE News | Save or unsave a headline | W/TradeExchangeNewsParts.jsx:245 | library.toggle :323 | none | MISSING | no | n/a | none | no capability | new capability | bookmark that headline | P2 |
| C3-142 | TE News | Add or edit a headline note | W/TradeExchangeNewsSaved.jsx:92; W/TradeExchangeNewsCollections.jsx:179 | saveNote | none | MISSING | no | n/a | none | no capability | new capability | note that headline | P2 |
| C3-143 | TE News | Manage collections | W/TradeExchangeNewsCollections.jsx:67, :117, :120 | library collections | none | MISSING | no | n/a | none | no capability | new capability | put that in my Macro collection | P2 |
| C3-144 | TE News | Add a headline's ticker to a watchlist | W/TradeExchangeNewsParts.jsx:546 | addTo | watchlist.add | IMPLEMENTED / UNVERIFIED | unknown | local; exact Undo | none | add proven; "that headline's ticker" referent not | referent test | add that ticker to Momentum | P2 |
| C3-145 | TE News | Explain a headline or ask about it | W/TradeExchangeNewsParts.jsx:234; W/TradeExchangeNewsAsk.jsx:105 | Agent explain and ask | useAgentAsk seam (not a manifest capability) | IMPLEMENTED / UNVERIFIED | unknown | read only | none | agentNewsAsk.test.jsx and agentNewsContinue.test.jsx exist; only the header was read | confirm against those tests | why does this matter | P1 |
| C3-146 | TE News | Jump to live or browse a past day | W/TradeExchangeNewsWidget.jsx:591 | jumpToLive, useTradeExchangeNewsDay | none | MISSING | no | n/a | none | no capability | low value | back to live news | P2 |
| C3-147 | TE News | Send a headline to Notebook | W/TradeExchangeNewsParts.jsx:475 | notebook capture | none | MISSING | no | n/a | none | see capture row | shared capture | send that to my notebook | P2 |
| C3-148 | Calendar | Step days in the widget | W/CalendarWidget.jsx:420, :425 | setSelected :307 (local state) | none | MISSING | no | n/a | calendar page only | CG-35, agentMultiActionFollowups.test.jsx:927; coverage.json surfaces = calendar only | make state an opt, then a capability | show tomorrow's earnings here | P1 |
| C3-149 | Calendar | Ask who reports on a day from Charts | W/CalendarWidget.jsx:521, :525 | calendar endpoints | calendar.day (page only) | MISSING | no | n/a | none | same CG-35; not on the charts surface | surface on /charts | who reports tonight | P0 |
| C3-150 | Calendar | Ask when a stock reports from Charts | W/ChartDetailDock.jsx:175 | calendar search | calendar.nextReport (page only), stock.earnings | IMPLEMENTED / UNVERIFIED | unknown | read only | none | stock.earnings: capreg `earnings.date`; calendar.nextReport surfaces = calendar only | confirm routing on /charts | when does NVDA report | P0 |
| C3-151 | Calendar | Filter economic events by stars | W/CalendarWidget.jsx:491 | setEconStars :315 → opts | widget.setOption (econStars) | VERIFIED | unknown | local; exact Undo | none | agentWidgetOptions.test.jsx:49 | capreg (D5) | only high-impact events | P1 |
| C3-152 | Calendar | Toggle the TBD section | W/CalendarWidget.jsx:530 | setTbdOpen (local useState :311) | widget.setOption (tbdOpen) | IMPLEMENTED / UNVERIFIED | unknown | false receipt (D1) | none | test reads opts only; widget ignores them | fix D1 | open the TBD section | P2 |
| C3-153 | Calendar | Sort earnings columns | W/CalendarWidget.jsx:208-229 | clickCol local | none | MISSING | no | n/a | none | local state only | move to opts first | sort by implied move | P2 |
| C3-154 | Calendar | Show all earnings in a section | W/CalendarWidget.jsx:235 | setShowAll local | none | MISSING | no | n/a | none | local state only | low value | show all premarket names | P2 |
| C3-155 | Calendar | Click an earnings row | W/CalendarWidget.jsx:155 | onSelect → group symbol | chart.setSymbol | VERIFIED | yes | local; exact Undo | symbol | capreg finalState `symbol.switch` | none | show that one | P1 |
| C3-156 | Calendar | Send a day to Journal | W/CalendarWidget.jsx:432, :440 | sendDayToJournal | none | MISSING | no | n/a | none | see capture row | shared capture | send today's calendar to journal | P2 |
| C3-157 | Breadth | Read breadth tiles | W/BreadthWidget.jsx:157 | breadth series | breadth.show | VERIFIED | unknown | read only | none | capreg `breadth.now`, `breadth.measure-now` | none | how's breadth today | P0 |
| C3-158 | Breadth | Add or remove a reading | W/BreadthWidget.jsx:310, :168, :537 | opts.hiddenMetrics :369, :374 | none | MISSING | no | n/a | none | agentWidgetOptions test: json options never touched | structured capability | hide the 20-day reading | P1 |
| C3-159 | Breadth | Switch heatmap and ratio view | W/BreadthWidget.jsx:478, :483 | setView | none | MISSING | no | n/a | none | no capability | new option | switch breadth to ratio | P2 |
| C3-160 | Breadth | Change tile style | W/BreadthSettingsPanel.jsx:183 | patchSettings → global pref | widget.setOption (tileStyle) | IMPLEMENTED / UNVERIFIED | unknown | false receipt (D1) | none | writes opts; widget reads prefs | fix D1 | use spark tiles | P2 |
| C3-161 | Breadth | Change palette, intensity or background | W/BreadthSettingsPanel.jsx:202, :212, :162 | global pref | none | MISSING | no | n/a | none | no capability | shared capability | stronger breadth colours | P2 |
| C3-162 | Breadth | Drill into a reading | W/BreadthWidget.jsx:157 | onDrill → breadthDrill source | none | MISSING | no | n/a | none | no capability | new capability | show me the names above the 50 | P1 |
| C3-163 | Breadth | Send a snapshot to Journal | W/BreadthWidget.jsx:505, :513 | sendCaptureToJournal | none | MISSING | no | n/a | none | see capture row | shared capture | send breadth to journal | P2 |
| C3-164 | Options Flow | Switch market or symbol scope | W/OptionsFlowWidget.jsx:427, :432 | patchOpts scope | widget.setOption (scope) | VERIFIED | unknown | local; exact Undo | none | agentWidgetOptions.test.jsx:49 | capreg (D5) | flow for this symbol only | P1 |
| C3-165 | Options Flow | Switch the lead view | W/OptionsFlowWidget.jsx:442 | patchOpts lead | widget.setOption (lead) | IMPLEMENTED / UNVERIFIED | unknown | local; exact Undo | none | key read live; agentWidgetOptions.test.jsx:35 fixture carries lead, value list does not | add to the value list | show the biggest flow | P1 |
| C3-166 | Options Flow | Set filters (premium, call/put, type, direction) | W/OptionsFlowWidget.jsx:468, :477, :485, :493 | setFilter → opts.filters | none | MISSING | no | n/a | none | filters are json, excluded by setOption | structured option, UI-only; never touch flow-worker | only calls over a premium floor | P1 |
| C3-167 | Options Flow | Read the flow | W/OptionsFlowWidget.jsx:266 | proxy route | none | MISSING | no | n/a | none | no flow query capability | proxy-only read; never flow-worker | any big flow on NVDA | P1 |
| C3-168 | Options Flow | Click a flow row | W/OptionsFlowWidget.jsx:266, :298 | goToSym | chart.setSymbol | VERIFIED | yes | local; exact Undo | symbol | capreg finalState `symbol.switch` | none | show that one | P1 |
| C3-169 | Themes | Pick a period or ranking | TT:1281 | handleTabClick → local tabSort TT:545 | widget.setOption (period, sortDir) | IMPLEMENTED / UNVERIFIED | unknown | false receipt (D1) | none | agentWidgetOptions.test.jsx:35 reads opts; TT ignores them | fix D1, seed tabSort from opts or stop offering | show themes by week | P0 |
| C3-170 | Themes | Flip sort direction | TT:1409, :1420 | setTabSort | widget.setOption (sortDir) | IMPLEMENTED / UNVERIFIED | unknown | false receipt (D1) | none | same | fix D1 | sort themes worst first | P1 |
| C3-171 | Themes | Switch today basis | TT:1396, :1402 | setTodayBasis → opts.todayBasis | none | MISSING | no | n/a | none | not in paramsSchema | add to schema | measure from the open | P1 |
| C3-172 | Themes | Open a theme or pick a holding | TT:272, :326, :298 | onToggle, onSelectSym | stock.themes (read), chart.setSymbol | IMPLEMENTED / UNVERIFIED | unknown | local | none | stock.themes not in capreg; opening a theme has no capability | open-theme capability | open the Semis theme | P0 |
| C3-173 | Themes | Search themes or tickers | TT:207 | local | none | MISSING | no | n/a | none | no capability | new query | which theme is NVDA in | P1 |
| C3-174 | Themes | Pick, rename or delete a theme set | TT:409, :440, :442 | themeSetId, opts | none | MISSING | no | n/a | none | no capability | new capability | use my Growth set | P1 |
| C3-175 | Themes | Edit a set (add, hide, reset, custom theme) | TT:415, :468, :283, :1350, :490 | theme set editor | none | MISSING | no | n/a | none | no capability | new capability | hide the Crypto theme | P2 |
| C3-176 | Themes | Add or remove a stock in a theme | TT:236, :344 | onRemoveSym | none | MISSING | no | n/a | none | no capability | new capability | remove NVDA from this theme | P2 |
| C3-177 | Themes | Send the ranking to Journal | TT:1292, :1298 | sendThemesToJournal | none | MISSING | no | n/a | none | see capture row | shared capture | send themes to journal | P2 |
| C3-178 | Fundamentals | Switch view | W/FundamentalsWidget.jsx:246-275 | setView :194 → opts.view | widget.setOption (view) | VERIFIED | unknown | local; exact Undo | none | agentWidgetOptions.test.jsx:49 | capreg (D5) | show annual numbers | P1 |
| C3-179 | Fundamentals | Read the numbers | W/FundamentalsWidget.jsx:57 | research endpoints | stock.profile, stock.earnings | VERIFIED | unknown | read only | none | capreg `stock.profile`, `earnings.date` | none | what's NVDA's EPS growth | P0 |
| C3-180 | Fundamentals | Change appearance or send to Journal | W/FundamentalsSettingsPanel.jsx:148; W/FundamentalsWidget.jsx:300 | patchSettings, capture | none | MISSING | no | n/a | none | shared gaps | shared capabilities | send this to journal | P2 |
| C3-181 | Profile | Read profile and earnings table | W/ProfileWidget.jsx:228 | research endpoints | stock.profile, stock.earnings | VERIFIED | unknown | read only | none | capreg `stock.profile`, `earnings.date` | none | what does NVDA do | P1 |
| C3-182 | Profile | Click a peer ticker | W/ProfileWidget.jsx:290 | setGroupSym | chart.setSymbol | VERIFIED | yes | local; exact Undo | symbol | capreg finalState `symbol.switch` | none | show AMD | P2 |
| C3-183 | Indexes | Hide or restore an index | W/IndexesWidget.jsx:155, :96 | hideSym, showAll → opts.hiddenSymbols | none | MISSING | no | n/a | none | json option excluded | structured capability | hide the Dow | P2 |
| C3-184 | Indexes | Send levels to Journal | W/IndexesWidget.jsx:104, :113 | capture | none | MISSING | no | n/a | none | see capture row | shared capture | send index levels to journal | P2 |
| C3-185 | Market Context | Read market context | W/MarketContextWidget.jsx:161 | wire readings | none | UNMAPPED | unknown | unknown | none | did not trace knowledge or digest paths | trace | what's the market context | P1 |
| C3-186 | Market Context | Send to Journal | W/MarketContextWidget.jsx:116, :125 | capture | none | MISSING | no | n/a | none | see capture row | shared capture | send context to journal | P2 |
| C3-187 | NH/NL | Add or remove a universe | W/NhnlUniverseMenu.jsx:174; W/NewHighsLowsWidget.jsx:268 | patch opts.universes :186 | none | MISSING | no | n/a | none | json option excluded | structured capability | add the Nasdaq 100 to new highs | P1 |
| C3-188 | NH/NL | Switch universe tab | W/NewHighsLowsWidget.jsx:263 | patch activeUniverse | none | MISSING | no | n/a | none | no capability | new option | switch to Semis | P1 |
| C3-189 | NH/NL | Expand a row or pick a symbol | W/NewHighsLowsWidget.jsx:114, :61 | onPick | chart.setSymbol | VERIFIED | yes | local; exact Undo | symbol | capreg finalState `symbol.switch` | expand has no capability, low value | show that one | P2 |
| C3-190 | NH/NL | Toggle logos, font, background | W/NhnlSettingsPanel.jsx:141, :174, :154 | patchSettings | none | MISSING | no | n/a | none | shared gap | shared capability | smaller text on new highs | P2 |
| C3-191 | H/L Pulse | Change Pulse settings | W/NhnlPulseWidget.jsx:197 | patchSettings | none | MISSING | no | n/a | none | shared gap | shared capability | darken the pulse widget | P2 |
| C3-192 | Market Map | Pick or remove a universe | W/ScatterWidget.jsx:165, :481, :486, :492 | universe opts | none | MISSING | no | n/a | none | string opts excluded | structured capability | map the S&P 500 | P1 |
| C3-193 | Market Map | Pick X, Y or size axis | W/ScatterWidget.jsx:557, :561, :564 | xKey, yKey, sizeKey | none | MISSING | no | n/a | none | string opts excluded | enum in paramsSchema | plot RVOL against change | P1 |
| C3-194 | Market Map | Follow the linked list | W/ScatterWidget.jsx:516 | toggleFollow | none | MISSING | no | n/a | none | no capability | new option | follow my watchlist | P2 |
| C3-195 | Market Map | Cycle labels or zoom | W/ScatterWidget.jsx:568, :575-577 | cycleLabelMode, zoom | none | MISSING | no | n/a | none | no capability | low value | zoom in | P2 |
| C3-196 | AI Search | Ask a question or follow one up | W/AiSearchWidget.jsx:1288, :478 | run | research.ask | IMPLEMENTED / UNVERIFIED | unknown | read only | none | not in capreg, separate surface | decide relation to the Agent | ask AI search about NVDA | P1 |
| C3-197 | AI Search | Change ask mode, stop or retry | W/AiSearchWidget.jsx:1275, :1284, :1223 | cycleAskMode, stop | none | MISSING | no | n/a | none | no capability | low value | use deep search | P2 |
| C3-198 | AI Search | Save, reopen or remove an answer | W/AiSearchWidget.jsx:457, :1145, :1146 | onSave, restoreSaved | none | MISSING | no | n/a | none | no capability | new capability | save that answer | P2 |
| C3-199 | AI Search | Copy or speak an answer | W/AiSearchWidget.jsx:447, :451 | onCopy, onSpeak | none | MISSING | no | n/a | none | no capability | low value | read that out | P2 |
| C3-200 | AI Search | Send the conversation to Journal | W/AiSearchWidget.jsx:1086, :1097 | capture | none | MISSING | no | n/a | none | see capture row | shared capture | send this to journal | P2 |
| C3-201 | Notebook | Open or search a note | W/NotebookWidget.jsx:377, :157, :364 | openNote | journal.listNotes (page only) | MISSING | no | n/a | journalNewNote is /journal only | coverage.json surfaces = journal only | surface on /charts | find my NVDA note | P1 |
| C3-202 | Notebook | Create a note | W/NotebookWidget.jsx:365 | newNote | journal.createNote (page only) | MISSING | no | n/a | journalNewNote is /journal only | same | surface on /charts | add a note: held the 21 | P1 |
| C3-203 | Notebook | Edit a note's title or body | W/NotebookWidget.jsx:115, :119 | editor autosave | none | BLOCKED | no | n/a | none | free-form editor state; no safe merge | owner decision | rewrite that note | P2 |
| C3-204 | Notebook | Browse folders | W/NotebookWidget.jsx:174, :181, :398 | setFolder | none | MISSING | no | n/a | none | no capability | low value | open my Earnings folder | P2 |
| C3-205 | Period Sort | Start a custom-period sort | CW:3670; C/PeriodSortConfig.jsx:80 | handlePeriodSelected CW:1181 | none | MISSING | no | n/a | none | no capability; periodsort in no menu | new capability | rank stocks from Oct 1 to today | P1 |
| C3-206 | Period Sort | Choose grouping, replay and start mark | C/PeriodSortConfig.jsx:37, :64, :71 | config state | none | MISSING | no | n/a | none | no capability | args on the new capability | group that by theme | P2 |
| C3-207 | Period Sort | Dock the panel or add it as a tab | C/PeriodSortPanel.jsx:107, :100 | handleDockPeriodSort CW:1938, handlePeriodSortToTab CW:1970 | none | MISSING | no | n/a | none | no capability | new capability | dock that ranking | P2 |
| C3-208 | Period Sort | Refresh results | W/PeriodSortResults.jsx:172 | mutate | none | MISSING | no | n/a | none | no capability | low value | refresh the ranking | P2 |
| C3-209 | Replay | Start replay at a date | C/ReplayPanel.jsx:79; CW:3682 | startReplay via handleReplayCutoffPicked CW:1190 | chart.replay | VERIFIED | yes | local; exact Undo per test, capreg undo false | none | agentChartReplay.test.jsx:41, :104 | guide topic | replay from Oct 15 | P0 |
| C3-210 | Replay | Exit replay | C/ReplayPanel.jsx:73 | onExit | chart.replay (null) | VERIFIED | yes | local; exact Undo | none | agentChartReplay.test.jsx:56; capreg chart.replay.exit | none | exit replay | P0 |
| C3-211 | Replay | Pick the cutoff by clicking the chart | C/ReplayPanel.jsx:55 | onArmPick | none | MISSING | no | n/a | none | human-only pointer step; date arg covers intent | none needed | replay from here | P2 |
| C3-212 | Replay | Set replay timeframe | C/ReplayPanel.jsx:61 | setTf | chart.setTimeframe then chart.replay | IMPLEMENTED / UNVERIFIED | unknown | two steps | none | agentChartReplay.test.jsx:41 says no timeframe change | compound test | replay weekly from March | P2 |
| C3-213 | Review | Start Review Charts from a results list | app/src/components/screener/ScanResults.jsx:498 (no Charts control) | reviewSession enter, publish | none | MISSING | no | n/a | none | Screener-side door; no capability | "work through these" capability | review this scan | P1 |
| C3-214 | Review | Step next or previous in a review (mobile only at this commit) | C/review/ReviewNavControl.jsx:76, :98 | useReviewSession via MobileChartsApp.jsx:190 | none | MISSING | no | n/a | none | wired only in mobile shell | desktop door first | next symbol | P1 |
| C3-215 | Review | Open the review feed card (mobile only) | C/review/ReviewFeedCard.jsx:50 | ReviewFeed | none | MISSING | no | n/a | none | wired only in mobile shell | as above | open the third one | P2 |
| C3-216 | Company dock | Switch dock tab | W/ChartDetailDock.jsx:175 | setTab | none | MISSING | no | n/a | none | no capability | new capability | show the ownership tab | P1 |
| C3-217 | Company dock | Open or collapse the dock | W/ChartDetailDock.jsx:191, :231 | setCompanyOpen | none | MISSING | no | n/a | none | no capability | new capability | hide the company panel | P1 |
| C3-218 | Company dock | Search company info | W/ChartDetailDock.jsx:182; W/CompanySearch.jsx:226 | setSearchOpen | stock.profile (nearest) | IMPLEMENTED / UNVERIFIED | unknown | read only | none | answers the question, does not drive the UI | none needed | who are NVDA's suppliers | P2 |
| C3-219 | Company dock | Open ETF holdings | W/ViewHoldingsControl.jsx:110 | toggle → holdings panel | none | MISSING | no | n/a | none | no capability | new capability | show SMH's holdings | P1 |
| C3-220 | Company dock | Pick a leveraged or inverse ETF | W/LeverageInverseControl.jsx:147, :206, :217 | pick → group symbol | chart.setSymbol | IMPLEMENTED / UNVERIFIED | unknown | local; exact Undo | none | ticker path proven; "the 2x long" referent not | referent | switch to the 2x long | P2 |
| C3-221 | Workspace | Open the Agent | CW:3701 | setAgentOpen | none | BLOCKED | no | n/a | none | the panel must already be open to ask | none | open the agent | P2 |
| C3-222 | Workspace | Change a widget's UCT theme section | W/WidgetThemeSection.jsx:39 | shared theme picker | none (chart.applyThemeAll is charts only) | MISSING | no | n/a | settings (charts only) | non-chart widgets uncovered | shared appearance capability | give the watchlist the Sunset theme | P2 |
| C3-223 | Workspace | Toggle the journal shortcut (Ctrl+Alt+J) | CW:2678 | keydown handler | none | UNMAPPED | unknown | unknown | none | did not trace target | trace | open the journal capture | P2 |

