# Execution ledger: next

**Method.** I read `docs/agent/CHARTS_EXECUTION_STATUS.md` (the "All actions" table), `docs/agent/CHARTS_COVERAGE_MATRIX.md` (the BLOCKED reasons) and the code, all at `dfc645ccb3`. I ran no tests. "Cited" means a test added after the ledger commit `3433893154` (2026-11-05) names the row id. That is a lead for a ledger refresh, not evidence: I did not run those tests, and they are not counted as VERIFIED here. The Watchlist area is excluded (pl-exec owns it).

## Scope

- Not verified, in scope: 326 rows (112 IMPLEMENTED / UNVERIFIED, 154 MISSING, 47 BLOCKED, 13 UNMAPPED). `VERIFIED †` counts as verified, and NOT ON /CHARTS is excluded.
- Minus Watchlist (25 rows): **301 rows**. Of those, **52 are cited** by tests added after the ledger (`agentExecTune.js` through `agentExecFamilies.test.jsx`, the `chartsOutcome/{boardArrangement,widgetControls,widgetDoorRows,themeTracker,teNewsWatchlist,etfHoldings}` files, `agentExecRound5.test.jsx`, and `agentExecHeldOut*.test.js`, which checks routing only). **Re-running the cited tests and regenerating the ledger is the cheapest single step.** It needs no code.
- The ledger is stale in two ways that matter here. (1) Multi Chart is no longer "refuse everything": since `cf981857a0`, chart, indicator and drawing ops run on grid cells (`app/src/agent/gridMode.js:1-12`, `useAgent.js:1407`). (2) Most of the C3 widget-control family was done by pl-exec (execution family W) after 11-05.

## Family ranking

Families are groups of Area values. I grouped closely related areas by the mechanism a fix would extend; the area list is in the last column. IMPL = IMPLEMENTED / UNVERIFIED.

| # | Family | Not verified | IMPL | MISSING | UNMAPPED | BLOCKED | Cited after ledger | Leverage | Areas |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| 1 | A. Data widgets (widget doors) | 89 | 14 | 71 | 1 | 3 | 39 | **High**: one door pattern, 4 levers | C3 Scanner, Volume Surge, Alerts, News, TE News, Calendar, Breadth, Options Flow, Themes, Fundamentals, Indexes, Market Context, NH/NL, H/L Pulse, Market Map, AI Search, Notebook, Period Sort, Company dock |
| 2 | B. Chart display settings | 38 | 28 | 9 | 1 | 0 | 2 | **High**: one capability, one test table | C1 Settings, Volume, Chart type, Settings door, Themes |
| 3 | C. Multi Chart grid | 21 | 0 | 2 | 0 | 19 | 0 | **High**: one adapter, one gate | C3 Multi Chart |
| 4 | D. Indicator authoring + controls | 46 | 30 | 10 | 4 | 2 | 0 | Medium-high (see note) | C2 Picker, Add, Remove, Read, Inputs, Style, Placement, Panes, Legend, Undo, Copy, Create, Builder |
| 5 | G. Board, tabs, layouts | 31 | 11 | 15 | 1 | 4 | 7 | Medium | C3 Board, Link, Float, Popout, Widget tabs, Chart tabs, Layout Dock, Workspace |
| 6 | L. Chart core | 23 | 13 | 5 | 2 | 3 | 3 | Medium (scattered) | C1 Symbol, Timeframe, Session, Scale, View, Go to date, Panes, Legend, Alerts, Keyboard |
| 7 | H. Drawing + drawing boards | 15 | 3 | 7 | 2 | 3 | 0 | Medium-low (C1-167..170 is one board adapter) | C1 Drawing, Boards |
| 8 | F. Indicator import, image, sharing | 11 | 1 | 7 | 0 | 3 | 0 | Low (model features, owner policy) | C2 Import, Image, Saved |
| 9 | K. Right-click + Share | 9 | 1 | 4 | 0 | 4 | 0 | Low (C1-176/177 ride lever A1; Share is the owner's call) | C1 Right-click, Share |
| 10 | I. Compare | 7 | 4 | 3 | 0 | 0 | 0 | Medium-small (`chart.compare` chart.js:959) | C1 Compare |
| 11 | E. Indicator alerts | 6 | 2 | 4 | 0 | 0 | 1 | Low-medium | C2 Alerts |
| 12 | J. Replay | 5 | 1 | 2 | 1 | 1 | 0 | Low | C1 Replay, C3 Replay |
| | **Total** | **301** | 108 | 139 | 12 | 42 | 52 | | |

D is ranked below C on purpose. Its 9 Builder rows (C2-064..073) go through `indicator.draft` (`indicatorAuthoring.js:910`), which forwards a sentence to Create Indicator's own builder engine. A panel test can only assert a fixture builder reply, so those rows prove a pass-through, not the builder. The other ~13 IMPL rows (`indicatorControls.js:267/281/314/327`, `indicatorAuthoring.js:975/1075/1093`, `indicatorEdits.js:858`) are cheap: there is no indicator file in `qa/chartsOutcome/` yet. The Indicators project owns the settings keys (`chartSettingsDescriptors.js:224-230`).

## BLOCKED rows (outside Multi Chart and Watchlist): which are technical

| Kind | Rows | Lever? |
|---|---|---|
| Technical: no readable view state | C1-026 squeeze axis, C1-028 zoom (P0) | Yes. One "view-state contract" (a readable visible range and price range on the chart API) unlocks both. |
| Technical: pointer or session state | C1-044, C1-164, C1-175 | No. A spoken date or anchor edit already covers the outcome. |
| Technical: product has no writer | C3-115 create scanner | Only after the product ships a builder door. |
| Inherent | C3-221 open the Agent | No. |
| Owner decision | C1-110..113 Share; C1-162 shared undo history; C2-046, C2-047; C2-084..086 publish, share, install; C3-009 floating; C3-032, C3-036 admin templates; C3-116 modify preset; C3-203 note body | Not a target until the owner rules. |
| Multi Chart (19) | C3-044..062 | **Technical: one gate.** See family C. Only C3-054 (admin global) is an owner decision, the same as C3-032. |

---

## Top 1: A. Data widgets (widget doors)

**The mechanism already exists.** Every widget control is one data row. Rows that live in `opts` are in `app/src/widgets/widgetControls.js:22-60` (OWN) and `app/src/agent/widgetNames.js:23-38` (AGENT_CONTROLS), plus the `live: true` paramsSchema fields in `widgets/registry.js`. A widget publishes `{read, options, write, capture, about}` through `useWidgetDoor` (`app/src/pages/charts/widgetDoors.js:32`), and `host.widgets.door` reads it (`app/src/agent/host.js:326`). Four generic capabilities consume it: `widget.setOption` (`capabilities/board.js:1219`), `widget.readOptions` (`:1278`), `widget.sendToJournal` (`:1305`, send at `:433`), and item ops (create, rename, delete) inside setOption (`board.js:1156-1210`, lists in `widgetNames.js:114`). The outcome template is `qa/chartsOutcome/widgetDoorRows.outcome.test.jsx`: real widgets in a `WidgetDoorContext` slot beside the real panel, with the Journal mocked at its own send at `:33-35`.

**Ledger refresh (no code), 39 cited rows:** C3-107, 110, 120, 121, 125, 133, 138, 139, 148, 150, 151, 152, 156, 158, 159, 163, 164, 165, 166, 169, 170, 171, 172, 174, 177, 183, 184, 187, 188, 192, 193, 194 (cited only by the routing-only held-out test), 195, 201, 202, 206, 216, 217, 219.

**Residual: 50 rows, in levers:**

| Lever (one reusable piece) | Rows (action, state) | Unlocks | Extend |
|---|---|---:|---|
| A1. Journal outcome test over existing capture doors. No product code. | C3-132 Send alerts to Journal (M), C3-137 Send News feed to Journal (M), C3-180 Fundamentals appearance/Journal, Journal half (M), C3-186 Market Context to Journal (M), C3-200 AI Search conversation to Journal (M), and from K: C1-176 Send chart to Journal (M), C1-177 choose where (M; `where` covers the destination, not the comment) | 7 | Doors already exist: `AlertsWidget.jsx:131`, `NewsWidget.jsx:225`, `FundamentalsWidget.jsx:206`, `MarketContextWidget.jsx:107`, `AiSearchWidget.jsx:605`, `ChartWidget.jsx:560-561`. Copy the `widgetDoorRows` Journal block. |
| A2. Appearance rows | C3-131 Alerts appearance (M), C3-136 News appearance (M), C3-190 NH/NL logos, font, background (M), C3-191 Pulse settings (M), C3-160 Breadth tile style (M), C3-124 Volume Surge thresholds (M), C3-161 Breadth palette (M), C3-180 Fundamentals appearance (M) | ~8 | Per-widget types keep appearance in `opts.settings` (`components/chart/chartThemes.js:525` `_PER_WIDGET_TYPES`). That makes them plain OWN rows with `path: 'settings.<k>'` (the `filters.minPrem` pattern, `widgetControls.js:40`), with no door. `tileStyle` (`registry.js:503`) and `minRvol/minMove/minDollarK` (`registry.js:~805`) only need `live: true` plus bounds. Breadth and Fundamentals use global prefs (`breadthWidgetSettings.js:13`, `fundamentalsSettings.js:13`), so they need `door: true` rows and a door `write`. |
| A3. Item-list ops (ITEM_LISTS) | C3-122 Volume Surge scope-list CRUD (M), C3-123 add ticker to scope list (M), C3-140 TE filter presets (M), C3-141 save/unsave headline (M), C3-143 collections (M), C3-175 edit a theme set (M), C3-176 stock in a theme (M), C3-198 AI answer saved/reopen/remove (M), C3-204 Notebook folders (M) | ~8-9 | Add entries to `ITEM_LISTS` (`widgetNames.js:114`, Themes and Notebook are the template) and a `read()[key]` list plus `write(key,{op,id,name})` on each widget's door (`VolumeScanWidget.jsx:194`, `TradeExchangeNewsWidget.jsx:433`, `ThemeTrackerPage.jsx:1077`, `AiSearchWidget.jsx:605`, `NotebookWidget.jsx:257`). |
| A4. Small door controls (text, day, enum, action) | C3-108 leave scan (M), C3-109 search presets (M), C3-112 refresh scan (M), C3-146 TE live or past day (M), C3-153 Calendar sort (M), C3-154 show all (M), C3-173 theme search (M), C3-197 AI ask mode/stop/retry (M), C3-205 start a period sort (M), C3-207 dock or tab (M), C3-208 refresh (M) | ~8-11 | The text pattern is TE `search` (`widgetNames.js:28`). The day pattern is Calendar `day` (`widgetControls.js:36`). Refresh, stop and retry need an `action`-type row that the door executes; that type does not exist yet. |
| A5. Reads | C3-149 who reports on a day (M), C3-167 read the flow (M), C3-185 read market context (UNMAPPED) | 3 | Door `about()` and `read()`, through `widget.readOptions` (`board.js:1278`). C3-149 may fit the earnings or calendar capability (`capabilities/calendar.js`) better. |
| IMPL, needs a panel test only | C3-126, C3-144, C3-145, C3-196, C3-218, C3-220 | 6 | |

**Stays unverified:** C3-115 and C3-116 (BLOCKED: no product writer, and a decision is pending); C3-203 (owner decision, free-form editor); C3-199 copy or speak (clipboard or audio, no read-back); C3-162 drill-in and C3-117 (navigation across surfaces); C3-135 put a headline on the chart (a drawing family, not a widget door); C3-147 send one headline to Notebook (a per-headline door, unlike the widget-level capture).

**Risks.** This is pl-exec's family W, and it is active; coordinate before touching `widgetNames.js` or `widgetControls.js`. The routing control-word gate (`widgetNames.js:87-109`) is pinned at 0 side effects (`agentExecSideEffect.test.jsx`). New words in a widget's vocabulary can move that number. Undo for `door: true` rows goes back through the widget's writer, and a widget that unmounts has no door, so that row refuses.

## Top 2: B. Chart display settings

**The mechanism is one capability over one descriptor table.** `chart.setSetting` (`app/src/agent/capabilities/chart.js:805`) offers every `agent: 'eligible'` row of `ELIGIBLE` (`components/chart/chartSettingsDescriptors.js:98-193`) plus `LIST_SETTINGS` (`chart.js:173-180`: Info row and Bar info). It validates, writes `withSetting`, reads back and undoes generically. The ledger's own limits note says it: each row is "one key of a shared generic path", with no test of its own. The existing panel tests are partial: `agentChartSettingsW1B.test.jsx:37-72` (2 rows), and `agentBatch6` / `agentChartsOperatorP1` are runtime only.

**One piece: a table-driven `qa/chartsOutcome/chartSettings.outcome.test.jsx`.** Rows are `{row, sentence, setting, value, path}`, run on the outcome harness `open()` (`outcomeHarness.jsx:38`). The scripted plan is `chart.setSetting`, and each case asserts the chart's stored `cs` at `path` plus an Undo. That unlocks:

| Rows (state) | Via |
|---|---|
| C1-017 colour mode, C1-018 thin bars (needs Bars/HLC), C1-050 gradient, C1-051 crosshair mode, C1-052 crosshair colour/width/style, C1-053 magnet, C1-054 price/MA labels, C1-055 scale text (textColor is `inert`: assert the refusal), C1-056 watermark, C1-057 watermark lines, C1-059 watermark size/weight/colour/opacity, C1-062 title, C1-063 day change, C1-064 legend mode, C1-068 swing on/sensitivity, C1-069 swing colours, C1-070 event markers, C1-071 earnings/IPO colours, C1-072 prev-day on (intraday), C1-073 prev-day style, C1-075 countdown, C1-090 HVC, C1-091 volume look (all IMPL) | `chart.setSetting` descriptors |
| C1-016 Heikin Ashi (UNMAPPED) | descriptor exists (`chartSettingsDescriptors.js:190`): map the row and test it |
| C1-015 breadth line/candles, C1-076 restore defaults, C1-087 remove volume, C1-080 theme on all charts (IMPL) | the same table's neighbours: `chart.setType` (`chart.js:536`), `chart.resetDefaults` (`:893`), `volume.setState` (`:772`), `chart.applyThemeAll` (`board.js:1414`) |
| Cross-area bonus: C1-024 invert scale (L), C1-144 position calculator (H), C2-013 Chart IQ (D) | descriptors `invertScale`, `positionCalc.*` (`:192`), `showChartIq` (`:191`) |

**Expected: about 29 rows from one test file, plus 3 cross-area.** C1-065 and C1-066 are already cited (refresh).

**Second piece (product code):** promote `KNOWN` to `ELIGIBLE` (`chartSettingsDescriptors.js:233-247`). Candidates are C1-067 header colours (`header.colors.*`, `:243`) and C1-078 light/dark palette (`theme`, `:246`; a design call, because it toggles the palette). That adds 2.

**Stays unverified:** C1-058 watermark alignment (no descriptor or field found); C1-061 reset watermark to centre (`watermark.x/y` exist, but `opts.watermarkPos` wins, see D2 at `:182`); C1-077 saved custom colours (a different store); C1-081 theme on all widgets (needs `applyThemeAll` extended over `chartThemes.js:686` per-widget mapping; that is shared with A2); C1-127 open the settings dialog (a UI-open door with no state read-back, compare `openIndicatorDoor` `host.js:212`); C1-092 volume overlay (owned by Indicators, `volumeOverlayIndicators`).

**Risks.** Rows gated by `requires`, `drawnOn` or `fixedBy` (swing labels on daily and up only, prev-day lines intraday only, Sunrise and light themes fixed) must be tested in a state where the gate holds. Otherwise the test proves a refusal, not the row. The † caveat applies to all of them: state is proven, the canvas redraw is not.

## Top 3: C. Multi Chart grid

**The ledger's single gate is now half lifted.** The grid is an Agent target: `GRID_BOARD_KEY` in `chartApiById` (`pages/charts/grid/MultiChartGrid.jsx:232-245`, `gridAgentAdapter.js:11-12`), and cells go through `gridCellKey`. `gridMode.js` lets chart ops run on cells and refuses only board-kind ops (`gridMode.js:75`). But `gridBoard` exposes **reads only** (cells, shape, selected, maximized, syncTimeRange, groupsMode, persist). The grid's own writers sit unused in `useMultiChartState` (`pages/charts/grid/useMultiChartState.js:133` enterGrid, `:140` exitGrid, `:144` applyCustomLayout, `:221` setGroup, `:225` clearGroup, `:229` setSyncCrosshair, `:233` setSyncTimeRange, `:237` setGroupsMode, `:245` applyGridTemplate; returned at `:258-262`). Maximize is `setMaxId` (`MultiChartGrid.jsx:104-108`).

**Refresh (no code):** C3-056 cell timeframe, C3-057 cell style and C3-058 cell session match panel tests in `agent/agentMultiChartMode.test.jsx:338`, `:365` and `:377-387` (added 11-07). That file does not cite row ids, so check the mapping. Expected +3.

**One piece: grid writers on `gridBoard`, plus one data-row capability `multiChart.set`.** Shape it like `widget.setOption`: controls are rows such as `{key:'syncCrosshair', type:'boolean'}`, `{key:'layout', type:'enum'}`, `{key:'groupsMode'}`, `{key:'group', from:'door'}` and `{key:'maximized'}`. Undo is the previous value through the same setter. Add it to the grid allow-list in `gridMode.js`. Entering from the board needs `enterGrid` and `applyCustomLayout` on the workspace host (`host.js:312` already passes `widgetOps.grid`).

| Rows | Unlocked by |
|---|---|
| C3-042 enter preset grid (M), C3-043 custom R×C (M), C3-044 exit (B), C3-045 crosshair sync (B), C3-046 time sync (B), C3-047 Groups on (B), C3-048 pick group (B), C3-049 step/switch group (B), C3-051 exit Groups (B), C3-060 maximize/restore (B) | writers plus `multiChart.set`: about 10 |
| C3-052 apply saved grid (B), C3-053 save grid (B), C3-055 delete saved grid (B) | Saved grids are `/api/charts/layouts` rows of `kind:'multichart'` (`MultiChartMenu.jsx:50-51,112`). Add a kind filter to `layout.saveAs/delete` (`capabilities/layout.js:454,598`) and an apply through `applyGridTemplate`: +3 |

**Expected: about 13 rows from one adapter, plus 3 on refresh.** **Stays unverified:** C3-054 save as global (admin; an owner decision, the same as C3-032); C3-050 refresh group (needs a seed and a server call, `MultiChartMenu.jsx:296`); C3-061 open shared grid settings (UI-open, no read-back); C3-059 reset cell to my chart (needs a drop-the-fork writer; today only Undo does it, `agentMultiChartMode.test.jsx:354`); C3-062 alert from a cell (not shown that `alert.*` targets cells).

**Risks.** Groups mode refills the grid when a ticker changes (`GRID_GROUPS_REFUSAL`, `gridMode.js:18`). The state is scoped per device (`writeScopedField`, `useMultiChartState.js:136,141,250`), so a write has to keep `presentation`. Persistence is async (`flushSave` returns `not-saved`), so a receipt has to wait for persist. Entering the grid hides the board, so plans in the same request that touch the board must be ordered or refused.

---

## Caveats

- No test was run. The 52 "cited" rows are names found in test files added after the ledger. Several of them are held-out routing tests (`agentExecHeldOut*.test.js`), which do not prove execution (C3-194 is cited only there).
- Unlock counts are estimates from reading code. Each row still needs a passing panel test under the ledger's rule (`CHARTS_EXECUTION_STATUS.md` "Rules used").
- Area counts come from the ledger's state column, so rows that drifted after the ledger (for example Multi Chart) still carry their 11-05 state.
