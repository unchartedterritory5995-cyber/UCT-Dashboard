# Charts execution status

Companion to `docs/agent/CHARTS_COVERAGE_MATRIX.md`, and it supersedes that file's execution counts. Generated 2026-11-05 against agent/pl/integration-1 by running the cited tests. VERIFIED means a real panel test with a scripted model passed and asserts state. It does not prove the real model chooses that plan, and these features are not all in production yet.

# Charts execution status

Built on `agent/pl/bar-time-coverage` from `agent/pl/integration-1` `b07a97d526`, on 2026-11-05. Inventory read at `179d57570d`. Every test below was run, not read: 8116 passed and 0 failed in the Agent suites, under the suite lock, with a scratch hook that recorded which tests really mounted the Agent panel.

## The number

**158 of 484 actions, 32.6%, are VERIFIED at panel level with a scripted model.** That proves the Agent is given what it needs and that a correct plan reaches the right state. It does not prove the real model picks that plan, and it does not prove the real chart redraws.

- Production evidence with the real planner covers 13 of those 158 rows, from the 2026-11-03 live run on the older build `463a4bcba5`, read by receipt and some server reads.
- Real component in a browser, Agent executing: 0 rows. The browser runs in teach-status.md prove walkthroughs, where a person clicks. They never ran an Agent plan.
- A further 43 rows have a passing runtime test (capability and writer, no panel). They are IMPLEMENTED / UNVERIFIED and are not in the 158.
- P0 actions: 58 of 74 VERIFIED.

## Rules used

- VERIFIED: a test that passed in this run mounted the real AgentPanel and asserted the resulting state. This is the owner schema in part 1. Part 3 had also counted `commitPlan` tests, so those rows dropped.
- A read counts when the test asserts the canonical read ran or the answer, not just that the board stayed the same.
- A phrasing tagged KNOWN GAP is never counted.
- `chartsOutcome` and the other panel tests script the model and use fixture data. `listControl` mounts the real Watchlist widget in jsdom, not a browser.
- Rows marked † read the view from a stand-in for the chart inside the test, so they prove the call and the read-back contract, not that the real chart moved.

## Before and after

| State | Before | After |
|---|---:|---:|
| VERIFIED | 143 | 158 |
| IMPLEMENTED / UNVERIFIED | 97 | 112 |
| MISSING | 206 | 154 |
| BLOCKED | 33 | 47 |
| UNMAPPED | 20 | 13 |
| NOT ON /CHARTS | 0 | 19 |
| Total rows | 499 | 503 |
| In scope | 499 | 484 |

## Denominator

499 inventory rows, minus 19 with no real control on desktop /charts, plus 4 real right-click rows the inventory never had, gives 484. Excluded rows stay in the table as NOT ON /CHARTS. Their outcome still counts on the row that owns it, so nothing is double counted.

The real /charts right-click menu (`ChartWidget.jsx`) is: Set alert at price, Send to Journal, Send to Journal (choose where), Reset view, one location item that opens a settings section, Chart settings, Chart template, Add widget, Clear all drawings, Ask AI about the symbol.

| Excluded | Action | Was | Why |
|---|---|---|---|
| C1-012 | Change timeframe from right-click | VERIFIED | ChartWidget menu has no timeframe row. The outcome is C1-006. |
| C1-014 | Choose chart type from right-click | VERIFIED | ChartWidget menu has no chart type row (it only opens Candle settings). The outcome is C1-013. |
| C1-021 | Extended hours from price-axis menu | VERIFIED | ChartWidget menu has no extended hours row (the axis item only opens Axis settings). The outcome is C1-019 and C1-020. |
| C1-085 | Copy another chart's look | UNMAPPED | No human control exists. Agent-only, like the C3 "not rows" list. chartSetup.copyLook still has panel test A3. |
| C1-088 | Separate pane toggle | BLOCKED | /charts forces the volume pane, so no control does anything. The Agent refuses it (agentChartSettingsTruth "own pane"). |
| C1-095 | Collapse a pane | UNMAPPED | No pane collapse control exists. |
| C1-096 | Copy price at the cursor | BLOCKED | Copy price lives in the app-wide menu, which /charts does not open. |
| C1-122 | Draw line at clicked price | VERIFIED | ChartWidget menu has no draw line row. The outcome is C1-131. |
| C1-123 | Add indicator from menu | VERIFIED | ChartWidget menu has no add indicator row. The outcome is C1-172. |
| C1-124 | Open indicator settings | VERIFIED | ChartWidget menu has no indicator settings row. The outcome is C2-024. |
| C1-129 | Ray | UNMAPPED | No toolbar button or shortcut for Ray; only a render case. Agent-only (c:drawing.ray). |
| C2-101 | Edit an average or study on phone | IMPLEMENTED / UNVERIFIED | Phone shell only; not desktop /charts. |
| C3-073 | Rename a list | VERIFIED | Only on the Watchlists page: a Watchlist widget on /charts has no list header. Agent-only from /charts (c:watchlist.rename). |
| C3-081 | Reorder symbols by hand | VERIFIED | No reachable control: the reorder handler has no caller. Agent-only (c:watchlist.reorder). |
| C3-084 | Apply a column preset | MISSING | Only on the Watchlists page: a Watchlist widget on /charts has no column gear. |
| C3-090 | Tag a symbol with a colour | MISSING | The tag menu lives in the app-wide chart menu, which /charts does not use. |
| C3-213 | Start Review Charts from a results list | MISSING | Not on the desktop Charts workspace. |
| C3-214 | Step next or previous in a review (mobile only at this commit) | MISSING | Not on the desktop Charts workspace (mobile shell only). |
| C3-215 | Open the review feed card (mobile only) | MISSING | Not on the desktop Charts workspace (mobile shell only). |

## Controls corrected

Every file:line citation in the control column was checked against this tree: 331 unchanged, 93 moved, 3 changed or gone. The table lists the rows whose control itself was wrong.

| ID | Action | Real control on /charts |
|---|---|---|
| C1-022 | Arithmetic/log/percent from menu | Not the app-wide menu rows. Scale is reached by Shift+L and the view controls (teach: view.scale). |
| C1-027 | Reset view | ChartWidget right-click, Reset view. |
| C1-029 | Range buttons (3M/6M/YTD/1Y/5Y) | Range bar; RANGE_OPTS now lives in chart/rangeOptions.js. |
| C1-053 | Magnet crosshair | Not the app-wide menu. The only remaining control is in the ChartToolbar settings panel; reachability on /charts unproven. |
| C1-064 | Legend mode | CSM only; the SC menu rows are not on /charts. |
| C1-068 | Swing labels on/off and sensitivity | CSM only; the SC menu row is not on /charts. |
| C1-082 | Apply a template | Also ChartWidget right-click, Chart template flyout. |
| C1-086 | Show/hide volume (Ctrl+V, menu) | Ctrl+V only; the SC menu row is not on /charts. |
| C1-090 | HVC highlight | Not the app-wide menu. ChartWidget right-click, Volume settings (teach: menu.volume). |
| C1-092 | Overlay indicator on volume | Not the app-wide menu. The remaining control is in the ChartToolbar settings panel; reachability on /charts unproven. |
| C1-101 | Add alert from chip | Chip menu only; the SC menu row is not on /charts. |
| C1-114 | Price alert at the cursor (Alt+N) | Also ChartWidget right-click, Set alert at the clicked price. |
| C1-125 | Clear all drawings | ChartWidget right-click, Clear all drawings (only when the chart has drawings), and the toolbar. |
| C1-126 | Hide all drawings | Toolbar only; the SC menu row is not on /charts. |
| C1-127 | Open chart settings (Alt+,, gear) | Also ChartWidget right-click, Chart settings, and the location item that opens one section. |

## Counts by area

| Part | Area | VERIFIED | IMPL / UNVERIFIED | MISSING | BLOCKED | UNMAPPED | In scope | Excluded |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| C1 | Symbol | 3 | 1 | 1 | 0 | 0 | 5 | 0 |
| C1 | Timeframe | 2 | 4 | 0 | 0 | 0 | 6 | 1 |
| C1 | Chart type | 1 | 3 | 0 | 0 | 1 | 5 | 1 |
| C1 | Session | 1 | 1 | 0 | 0 | 0 | 2 | 1 |
| C1 | Scale | 1 | 2 | 1 | 1 | 0 | 5 | 0 |
| C1 | View | 2 | 0 | 0 | 1 | 0 | 3 | 0 |
| C1 | Go to date | 2 | 1 | 1 | 0 | 0 | 4 | 0 |
| C1 | Compare | 1 | 4 | 3 | 0 | 0 | 8 | 0 |
| C1 | Replay | 2 | 0 | 1 | 1 | 1 | 5 | 0 |
| C1 | Settings | 5 | 20 | 7 | 0 | 0 | 32 | 0 |
| C1 | Themes | 1 | 1 | 1 | 0 | 0 | 3 | 0 |
| C1 | Templates | 3 | 0 | 0 | 0 | 0 | 3 | 1 |
| C1 | Volume | 2 | 4 | 0 | 0 | 0 | 6 | 1 |
| C1 | Panes | 1 | 1 | 0 | 0 | 0 | 2 | 1 |
| C1 | Crosshair | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| C1 | Legend | 6 | 2 | 1 | 0 | 0 | 9 | 0 |
| C1 | Measure | 4 | 0 | 0 | 0 | 0 | 4 | 0 |
| C1 | Share | 0 | 0 | 0 | 4 | 0 | 4 | 0 |
| C1 | Alerts | 6 | 1 | 1 | 0 | 0 | 8 | 0 |
| C1 | Right-click | 1 | 1 | 4 | 0 | 0 | 6 | 3 |
| C1 | Settings door | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| C1 | Drawing | 27 | 3 | 3 | 3 | 2 | 38 | 1 |
| C1 | Boards | 0 | 0 | 4 | 0 | 0 | 4 | 0 |
| C1 | Keyboard | 2 | 0 | 0 | 1 | 2 | 5 | 0 |
| C2 | Picker | 0 | 2 | 1 | 0 | 0 | 3 | 0 |
| C2 | Add | 3 | 3 | 2 | 0 | 2 | 10 | 0 |
| C2 | Remove | 3 | 0 | 0 | 0 | 1 | 4 | 0 |
| C2 | Visibility | 4 | 0 | 0 | 0 | 0 | 4 | 0 |
| C2 | Read | 1 | 1 | 0 | 0 | 0 | 2 | 0 |
| C2 | Inputs | 2 | 2 | 2 | 0 | 0 | 6 | 0 |
| C2 | Style | 3 | 3 | 0 | 0 | 0 | 6 | 0 |
| C2 | Placement | 1 | 1 | 0 | 0 | 0 | 2 | 0 |
| C2 | Panes | 1 | 1 | 0 | 0 | 1 | 3 | 0 |
| C2 | Legend | 0 | 3 | 2 | 2 | 0 | 7 | 0 |
| C2 | Undo | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| C2 | Copy | 1 | 0 | 1 | 0 | 0 | 2 | 0 |
| C2 | Templates | 4 | 0 | 0 | 0 | 0 | 4 | 0 |
| C2 | Create | 5 | 4 | 0 | 0 | 0 | 9 | 0 |
| C2 | Builder | 1 | 9 | 2 | 0 | 0 | 12 | 0 |
| C2 | Import | 0 | 0 | 4 | 0 | 0 | 4 | 0 |
| C2 | Image | 0 | 0 | 2 | 0 | 0 | 2 | 0 |
| C2 | Saved | 1 | 1 | 1 | 3 | 0 | 6 | 0 |
| C2 | Alerts | 7 | 2 | 4 | 0 | 0 | 13 | 0 |
| C2 | Mobile | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| C3 | Board | 2 | 2 | 1 | 0 | 0 | 5 | 0 |
| C3 | Link | 0 | 1 | 1 | 0 | 0 | 2 | 0 |
| C3 | Float | 0 | 0 | 3 | 1 | 0 | 4 | 0 |
| C3 | Popout | 0 | 0 | 4 | 0 | 0 | 4 | 0 |
| C3 | Widget tabs | 0 | 4 | 0 | 0 | 0 | 4 | 0 |
| C3 | Chart tabs | 4 | 1 | 0 | 0 | 0 | 5 | 0 |
| C3 | Layout Dock | 7 | 3 | 5 | 2 | 0 | 17 | 0 |
| C3 | Multi Chart | 0 | 0 | 2 | 19 | 0 | 21 | 0 |
| C3 | Watchlist | 15 | 4 | 15 | 5 | 1 | 40 | 4 |
| C3 | Scanner | 5 | 1 | 6 | 2 | 0 | 14 | 0 |
| C3 | Volume Surge | 0 | 2 | 4 | 0 | 0 | 6 | 0 |
| C3 | Alerts | 4 | 0 | 2 | 0 | 0 | 6 | 0 |
| C3 | News | 1 | 1 | 3 | 0 | 0 | 5 | 0 |
| C3 | TE News | 0 | 2 | 8 | 0 | 0 | 10 | 0 |
| C3 | Calendar | 1 | 2 | 6 | 0 | 0 | 9 | 0 |
| C3 | Breadth | 1 | 0 | 6 | 0 | 0 | 7 | 0 |
| C3 | Options Flow | 1 | 2 | 2 | 0 | 0 | 5 | 0 |
| C3 | Themes | 0 | 1 | 8 | 0 | 0 | 9 | 0 |
| C3 | Fundamentals | 2 | 0 | 1 | 0 | 0 | 3 | 0 |
| C3 | Profile | 2 | 0 | 0 | 0 | 0 | 2 | 0 |
| C3 | Indexes | 0 | 0 | 2 | 0 | 0 | 2 | 0 |
| C3 | Market Context | 0 | 0 | 1 | 0 | 1 | 2 | 0 |
| C3 | NH/NL | 1 | 0 | 3 | 0 | 0 | 4 | 0 |
| C3 | H/L Pulse | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| C3 | Market Map | 0 | 0 | 4 | 0 | 0 | 4 | 0 |
| C3 | AI Search | 0 | 1 | 4 | 0 | 0 | 5 | 0 |
| C3 | Notebook | 0 | 0 | 3 | 1 | 0 | 4 | 0 |
| C3 | Period Sort | 0 | 0 | 4 | 0 | 0 | 4 | 0 |
| C3 | Replay | 2 | 1 | 1 | 0 | 0 | 4 | 0 |
| C3 | Review | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| C3 | Company dock | 0 | 2 | 3 | 0 | 0 | 5 | 0 |
| C3 | Workspace | 0 | 0 | 1 | 1 | 1 | 3 | 0 |
| C1 | **all** | 73 | 49 | 29 | 11 | 6 | 168 | 11 |
| C2 | **all** | 37 | 33 | 21 | 5 | 4 | 100 | 1 |
| C3 | **all** | 48 | 30 | 104 | 31 | 3 | 216 | 7 |
| | **Total** | 158 | 112 | 154 | 47 | 13 | 484 | 19 |

## Raised to VERIFIED (47)

| ID | Action | Was | Test |
|---|---|---|---|
| C1-005 | Flag current ticker (Shift+F) | MISSING | c:watchlist.setFlag; listControl: "flag NVDA" |
| C1-020 | Regular/extended on D/W/M | IMPLEMENTED / UNVERIFIED | c:session.extended |
| C1-027 | Reset view | BLOCKED | c:chartSetup.resetView; agentChartViewControls: reaches the chart's reset and is read back |
| C1-029 | Range buttons (3M/6M/YTD/1Y/5Y) | MISSING | c:chartSetup.setRange; agentChartViewControls: offers exactly the buttons the bar has |
| C1-060 | Move watermark | IMPLEMENTED / UNVERIFIED | agentChartSettingsTruth: writes opts.watermarkPos |
| C1-089 | Resize volume pane by drag | BLOCKED | agentChartSettingsTruth: the height: writes the pref |
| C1-103 | Hide all indicators (Alt+Shift+I) | MISSING | c:chartSetup.setIndicatorsHidden; agentChartViewControls: hides, reads back |
| C1-105 | Toggle moving averages (Ctrl+M) | MISSING | c:chartSetup.setMovingAverages; agentChartViewControls: through the panel: every moving average |
| C1-106 | Measure on the chart | MISSING | drawingFamily: measure: the right symbol; drawingFamily: it persists in the store |
| C1-107 | Bars & Time | MISSING | drawingFamily: dateRange: the right symbol |
| C1-108 | Price range | MISSING | drawingFamily: priceRange: the right symbol |
| C1-109 | Price Move | MISSING | drawingFamily: advance: the right symbol |
| C1-115 | Alert on a line, following it | MISSING | c:drawing.setAlert; drawingFamily: a trendline: shown first |
| C1-117 | Alert on a fib level | MISSING | drawingFamily: one Fibonacci level binds |
| C1-130 | Extended line | MISSING | drawingFamily: extended: the right symbol |
| C1-133 | Vertical line | MISSING | drawingFamily: vertical: the right symbol |
| C1-135 | Circle | MISSING | drawingFamily: circle: the right symbol |
| C1-136 | Arrow | MISSING | drawingFamily: arrow: the right symbol |
| C1-138 | Fib extension | MISSING | drawingFamily: fibext: the right symbol |
| C1-139 | Pitchfork | MISSING | drawingFamily: pitchfork: the right symbol |
| C1-140 | Parallel channel | MISSING | drawingFamily: channel: the right symbol |
| C1-141 | Cup curve | MISSING | drawingFamily: cup: the right symbol |
| C1-149 | Fill and border | MISSING | drawingFamily: a rectangle's fill keeps the candles visible |
| C1-150 | Text font, size, bold, italic, background | MISSING | drawingFamily: a note: font, size, bold, italic |
| C1-151 | Fib levels and fills | MISSING | drawingFamily: hides that level, no other; drawingFamily: a level's colour, a band on |
| C1-152 | Reset fib | MISSING | drawingFamily: reset returns the Fibonacci to the table |
| C1-153 | Measure-label options | MISSING | drawingFamily: Measure's label fields and position |
| C1-154 | Price label on a line | MISSING | drawingFamily: a horizontal line's price label |
| C1-155 | Edit anchors | MISSING | c:drawing.setAnchors; drawingFamily: the request carries each anchor |
| C1-156 | Make horizontal | MISSING | drawingFamily: a whole drawing moves with one item per point |
| C2-025 | Change select setting (MA type, source) | IMPLEMENTED / UNVERIFIED | agentIndicatorSelectInput: "change that to an SMA" |
| C2-051 | Save indicator template | MISSING | c:indicatorTemplate.save |
| C2-052 | Apply indicator template | MISSING | c:indicatorTemplate.apply |
| C2-053 | Delete indicator template | MISSING | c:indicatorTemplate.delete |
| C2-054 | List indicator templates | MISSING | c:indicatorTemplate.list |
| C2-055 | Open Create Indicator | IMPLEMENTED / UNVERIFIED | agentIndicatorsM1: model path: an EXPLICIT "open Create Indicator" |
| C2-093 | Alert on another timeframe | MISSING | agentIndicatorAlertTruth: "alert on the weekly RSI": a card first |
| C2-097 | List indicator alerts | MISSING | c:indicatorAlert.list; agentIndicatorAlertTruth: "show my indicator alerts" |
| C3-069 | Walk the list with arrow keys or space | MISSING | c:watchlist.step; listControl: previous, and both ends wrap |
| C3-077 | Add to Flagged | MISSING | c:watchlist.setFlag; listControl: "flag NVDA" |
| C3-078 | Flag or unflag a row (star) | MISSING | listControl: unflag keeps the rest |
| C3-082 | Sort by a column | MISSING | c:watchlist.sortColumn; listControl: "sort my watchlist by RVOL" |
| C3-083 | Show or hide a column | MISSING | c:watchlist.setColumns; listControl: "add the market cap column"; listControl: hide a default column and an added one |
| C3-087 | Reset columns | MISSING | listControl: reset goes to the defaults |
| C3-111 | Read a scan's results | MISSING | listControl: a Scanner: sorts and reads the same way |
| C3-113 | Sort a scan | MISSING | listControl: a Scanner: sorts and reads the same way |
| C3-114 | Change scan columns | MISSING | listControl: a Scanner: sorts and reads the same way |

## VERIFIED rows that dropped (32)

| ID | Action | Now | Reason |
|---|---|---|---|
| C1-004 | Open a free-typed symbol with no result row | IMPLEMENTED / UNVERIFIED | No named test. c:symbol.switch uses a known ticker, not a free-typed one. |
| C1-011 | Timeframe keys with repeat-press cycle | IMPLEMENTED / UNVERIFIED | The cycle is the point of this row and no capability does it ("go up one timeframe" is not handled). Direct timeframes are C1-006. |
| C1-012 | Change timeframe from right-click | NOT ON /CHARTS | ChartWidget menu has no timeframe row. The outcome is C1-006. |
| C1-014 | Choose chart type from right-click | NOT ON /CHARTS | ChartWidget menu has no chart type row (it only opens Candle settings). The outcome is C1-013. |
| C1-019 | Regular/extended on intraday | IMPLEMENTED / UNVERIFIED | c:session.extended runs on a daily chart and writes sessionView, the D/W/M writer (it proves C1-020). The intraday writer (extendedHoursShading) has only plan-level tests. |
| C1-021 | Extended hours from price-axis menu | NOT ON /CHARTS | ChartWidget menu has no extended hours row (the axis item only opens Axis settings). The outcome is C1-019 and C1-020. |
| C1-022 | Arithmetic/log/percent from menu | IMPLEMENTED / UNVERIFIED | Log and arithmetic pass (c:scale.log, g:GW-01 undo), percent has only plan-level tests (agentCore). Control is not the app-wide menu. |
| C1-031 | Pick date or year in calendar | IMPLEMENTED / UNVERIFIED | The cited test is a dated jump; a bare year ("go to 2020") has no test. |
| C1-099 | Duplicate on chart | IMPLEMENTED / UNVERIFIED | c:indicatorCopy.duplicate asserts a receipt only. The state read-back is runtime (agentIndicatorsP2 "duplicate the EMA 20"). |
| C1-104 | Toggle RSI/MACD/BB/VWAP chord | IMPLEMENTED / UNVERIFIED | No named test; toggle semantics untested (same as C2-010). |
| C1-122 | Draw line at clicked price | NOT ON /CHARTS | ChartWidget menu has no draw line row. The outcome is C1-131. |
| C1-123 | Add indicator from menu | NOT ON /CHARTS | ChartWidget menu has no add indicator row. The outcome is C1-172. |
| C1-124 | Open indicator settings | NOT ON /CHARTS | ChartWidget menu has no indicator settings row. The outcome is C2-024. |
| C2-002 | Search indicators by name or purpose | IMPLEMENTED / UNVERIFIED | c:definition.search asserts only that the board did not change. The result is read at runtime level (agentIndicatorsP2). |
| C2-042 | Duplicate on chart | IMPLEMENTED / UNVERIFIED | c:indicatorCopy.duplicate asserts a receipt only. The state read-back is runtime (agentIndicatorsP2 "duplicate the EMA 20"). |
| C2-057 | Refine draft by conversation | IMPLEMENTED / UNVERIFIED | agentIndicatorsM3 is runtime (no panel); no panel test has a second turn refining a draft. |
| C3-002 | Drag a widget to move it, or nudge it | IMPLEMENTED / UNVERIFIED | agentBoard passed, but it drives commitPlan with no panel. |
| C3-003 | Drag a widget edge or merged seam to resize | IMPLEMENTED / UNVERIFIED | agentBatch6 passed, but it drives commitPlan with no panel. |
| C3-006 | Cycle a widget's link colour | IMPLEMENTED / UNVERIFIED | agentBoard passed with no panel. c:widget.unlink asserts a receipt only. |
| C3-016 | Add a widget as a tab | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1 passed, but it drives commitPlan with no panel. |
| C3-017 | Switch a widget tab | IMPLEMENTED / UNVERIFIED | agentBoard passed, but it drives commitPlan with no panel. |
| C3-018 | Rename a widget tab | IMPLEMENTED / UNVERIFIED | agentBoard passed, but it drives commitPlan with no panel. |
| C3-019 | Close a widget tab | IMPLEMENTED / UNVERIFIED | agentBoard passed, but it drives commitPlan with no panel. |
| C3-023 | Change a chart tab's link colour | IMPLEMENTED / UNVERIFIED | agentBatch6 passed, but it drives commitPlan with no panel. |
| C3-030 | Save the open layout | IMPLEMENTED / UNVERIFIED | agentBoard is runtime. The one panel test (agentApprovalBinding) proves a refusal. Production turn E-06b saved it, on an older build, read by receipt. |
| C3-063 | Open a list in a widget (own) | IMPLEMENTED / UNVERIFIED | agentBoard passed with no panel. watchlist.open has no read-back at any level. |
| C3-073 | Rename a list | NOT ON /CHARTS | Only on the Watchlists page: a Watchlist widget on /charts has no list header. Agent-only from /charts (c:watchlist.rename). |
| C3-081 | Reorder symbols by hand | NOT ON /CHARTS | No reachable control: the reorder handler has no caller. Agent-only (c:watchlist.reorder). |
| C3-107 | Pick a preset scan | IMPLEMENTED / UNVERIFIED | agentBoard passed, but it drives commitPlan with no panel. |
| C3-133 | Filter catalysts up, down or all | IMPLEMENTED / UNVERIFIED | news.filter is written in a runtime test only (agentWidgetOptions "every option type"). |
| C3-151 | Filter economic events by stars | IMPLEMENTED / UNVERIFIED | calendar.econStars is written in a runtime test only. |
| C3-164 | Switch market or symbol scope | IMPLEMENTED / UNVERIFIED | optionsflow.scope is written in a runtime test only. |

## Other state changes (23)

| ID | Action | Was | Now | Reason |
|---|---|---|---|---|
| C2-013 | Toggle Chart IQ pattern recognition | UNMAPPED | IMPLEMENTED / UNVERIFIED | showChartIq is a chart.setSetting option; no state test. Control seen on the phone sheet only. |
| C3-044 | Exit Multi Chart | MISSING | VERIFIED | multiChart.exit (branch agent/pl/multichart-control, local). |
| C3-045 | Toggle crosshair sync | MISSING | VERIFIED | multiChart.setOption crosshair_sync (branch agent/pl/multichart-control, local). |
| C3-046 | Toggle time-range sync | MISSING | VERIFIED | multiChart.setOption time_range_sync (branch agent/pl/multichart-control, local). |
| C3-047 | Turn on Groups mode | MISSING | VERIFIED | multiChart.setOption groups_mode (branch agent/pl/multichart-control, local). |
| C3-048 | Pick a group for the grid | MISSING | VERIFIED | multiChart.loadGroup group (branch agent/pl/multichart-control, local). |
| C3-049 | Step or switch group | MISSING | VERIFIED | multiChart.loadGroup step (branch agent/pl/multichart-control, local). |
| C3-050 | Refresh the group | MISSING | VERIFIED | multiChart.loadGroup step refresh (branch agent/pl/multichart-control, local). |
| C3-051 | Exit Groups | MISSING | VERIFIED | multiChart.setOption groups_mode off (branch agent/pl/multichart-control, local). |
| C3-052 | Apply a saved grid | MISSING | VERIFIED | multiChart.openSaved (branch agent/pl/multichart-control, local). |
| C3-053 | Save a grid | MISSING | VERIFIED | multiChart.saveGrid (branch agent/pl/multichart-control, local). |
| C3-055 | Delete a saved grid | MISSING | VERIFIED | multiChart.deleteSaved (branch agent/pl/multichart-control, local). |
| C3-056 | Set a cell's timeframe | UNMAPPED | BLOCKED | Only exists in Multi Chart mode, and the Agent refuses every request there (useAgent.js:1836). |
| C3-057 | Set a cell's chart style | UNMAPPED | BLOCKED | Only exists in Multi Chart mode, and the Agent refuses every request there (useAgent.js:1836). |
| C3-058 | Toggle a cell's session | UNMAPPED | BLOCKED | Only exists in Multi Chart mode, and the Agent refuses every request there (useAgent.js:1836). |
| C3-059 | Reset a cell to my chart | MISSING | VERIFIED | multiChart.cell reset (branch agent/pl/multichart-control, local). |
| C3-060 | Maximize or restore a cell | MISSING | VERIFIED | multiChart.cell maximize, multiChart.setOption maximized (branch agent/pl/multichart-control, local). |
| C3-061 | Open shared grid settings | MISSING | BLOCKED | Only exists in Multi Chart mode, and the Agent refuses every request there (useAgent.js:1836). |
| C3-062 | Set an alert from a cell | IMPLEMENTED / UNVERIFIED | BLOCKED | Only exists in Multi Chart mode, and the Agent refuses every request there (useAgent.js:1836). |
| C3-152 | Toggle the TBD section | IMPLEMENTED / UNVERIFIED | MISSING | The offer was withdrawn: widget.setOption no longer offers tbdOpen because the widget never read it (2469b8c548). |
| C3-160 | Change tile style | IMPLEMENTED / UNVERIFIED | MISSING | The offer was withdrawn: the widget reads a global pref, not opts (2469b8c548). |
| C3-169 | Pick a period or ranking | IMPLEMENTED / UNVERIFIED | MISSING | The offer was withdrawn: the widget ignores opts; agentWidgetOptions now proves it refuses and stores nothing. |
| C3-170 | Flip sort direction | IMPLEMENTED / UNVERIFIED | MISSING | The offer was withdrawn with C3-169. |

## Limits

- Some actions are rowed twice across the parts (for example C1-097 and C2-018, C1-102 and C2-014). The inventory did this and I left it, so the percentage counts both.
- A chart setting row is one key of a shared generic path. Most have no test of their own and stay IMPLEMENTED / UNVERIFIED.
- The four indicator template rows pass with the build flag set. Docs say `VITE_INDICATOR_TEMPLATES_ENABLED` is on in production; the teach harness build had it off, and I could not confirm the production value here.
- The Multi Chart rows went to BLOCKED because the Agent refuses every request in that mode. That is one gate, not 19 separate problems.

## All actions

| ID | Area | Action | Status | Test | Result | Evidence level |
|---|---|---|---|---|---|---|
| C1-001 | Symbol | Change ticker by search pick | VERIFIED | c:symbol.switch; g:GW-01 | pass 8/8 | production (E-01) and panel |
| C1-002 | Symbol | Type-to-search on focused chart | VERIFIED | c:symbol.switch | pass 7/7 | production (E-01) and panel |
| C1-003 | Symbol | Filter search by category chip | MISSING | none | n/a | none |
| C1-004 | Symbol | Open a free-typed symbol with no result row | IMPLEMENTED / UNVERIFIED | c:symbol.switch | pass 7/7 | panel, partial |
| C1-005 | Symbol | Flag current ticker (Shift+F) | VERIFIED | c:watchlist.setFlag; listControl: "flag NVDA" | pass 5/5 | panel, scripted model |
| C1-006 | Timeframe | Pick preset timeframe on bar | VERIFIED | c:timeframe.weekly; c:timeframe.5m; c:compound.change-then-undo | pass 20/20 | production (E-01) and panel |
| C1-007 | Timeframe | Pick from full timeframe menu | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-008 | Timeframe | Add custom interval | VERIFIED | c:chart.addCustomTimeframe | pass 5/5 | panel, scripted model |
| C1-009 | Timeframe | Delete custom interval | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1.test.jsx | pass 48/48 | runtime, no panel |
| C1-010 | Timeframe | Star a favourite timeframe | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1.test.jsx | pass 48/48 | runtime, no panel |
| C1-011 | Timeframe | Timeframe keys with repeat-press cycle | IMPLEMENTED / UNVERIFIED | none named | n/a | source only |
| C1-012 | Timeframe | Change timeframe from right-click | NOT ON /CHARTS | none named | n/a | n/a |
| C1-013 | Chart type | Choose chart type in settings | VERIFIED | c:charttype.line | pass 5/5 | panel, scripted model |
| C1-014 | Chart type | Choose chart type from right-click | NOT ON /CHARTS | c:charttype.line | pass 5/5 | n/a |
| C1-015 | Chart type | Breadth Line/Candles quick toggle | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-016 | Chart type | Heikin Ashi candles | UNMAPPED | none | n/a | none |
| C1-017 | Chart type | Candle colour mode | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-018 | Chart type | Thin bars | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-019 | Session | Regular/extended on intraday | IMPLEMENTED / UNVERIFIED | c:session.extended | pass 5/5 | panel, partial |
| C1-020 | Session | Regular/extended on D/W/M | VERIFIED | c:session.extended | pass 5/5 | panel, scripted model |
| C1-021 | Session | Extended hours from price-axis menu | NOT ON /CHARTS | c:session.extended | pass 5/5 | n/a |
| C1-022 | Scale | Arithmetic/log/percent from menu | IMPLEMENTED / UNVERIFIED | c:scale.log; g:GW-01 | pass 7/7 | panel, partial |
| C1-023 | Scale | Toggle log (Shift+L) | VERIFIED | c:scale.log; g:GW-01 | pass 7/7 | production (E-01) and panel |
| C1-024 | Scale | Invert scale (Alt+I) | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-025 | Scale | Auto-scale | MISSING | none | n/a | none |
| C1-026 | Scale | Drag price axis to compress | BLOCKED | none | n/a | none |
| C1-027 | View | Reset view | VERIFIED † | c:chartSetup.resetView; agentChartViewControls: reaches the chart's reset and is read back | pass 5/5 | panel, scripted model |
| C1-028 | View | Zoom in/out (+/-) | BLOCKED | none | n/a | none |
| C1-029 | View | Range buttons (3M/6M/YTD/1Y/5Y) | VERIFIED † | c:chartSetup.setRange; agentChartViewControls: offers exactly the buttons the bar has | pass 6/6 | panel, scripted model |
| C1-030 | Go to date | Type a date in Time Navigator | VERIFIED † | c:chart.goToDate | pass 4/4 | panel, scripted model |
| C1-031 | Go to date | Pick date or year in calendar | IMPLEMENTED / UNVERIFIED | none named | n/a | source only |
| C1-032 | Go to date | Step one bar back/forward | MISSING | none | n/a | none |
| C1-033 | Go to date | Open date box (Alt+G) | VERIFIED † | c:chart.goToDate | pass 4/4 | panel, scripted model |
| C1-034 | Compare | Add a symbol | VERIFIED | c:compare.amd | pass 5/5 | panel, scripted model |
| C1-035 | Compare | Add a whole group | MISSING | none | n/a | none |
| C1-036 | Compare | Remove one symbol | IMPLEMENTED / UNVERIFIED | agentBatch6.test.jsx | pass 11/11 | runtime, no panel |
| C1-037 | Compare | Remove a group | MISSING | none | n/a | none |
| C1-038 | Compare | Clear all comparisons | IMPLEMENTED / UNVERIFIED | agentBatch6.test.jsx | pass 11/11 | runtime, no panel |
| C1-039 | Compare | Same/new scale per symbol | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1.test.jsx | pass 48/48 | runtime, no panel |
| C1-040 | Compare | Same/new scale for a group | MISSING | none | n/a | none |
| C1-041 | Compare | Group only (hide base) | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1.test.jsx | pass 48/48 | runtime, no panel |
| C1-042 | Replay | Start from a date | VERIFIED | c:chart.replay; agentChartReplay: replay from Oct 15 | pass 5/5 | panel, scripted model |
| C1-043 | Replay | Choose replay timeframe | MISSING | none | n/a | none |
| C1-044 | Replay | Pick the cutoff on the chart | BLOCKED | none | n/a | none |
| C1-045 | Replay | Exit replay | VERIFIED | c:chart.replay.exit | pass 4/4 | panel, scripted model |
| C1-046 | Replay | Legacy bar replay play/step/speed/scrub | UNMAPPED | none | n/a | none |
| C1-047 | Settings | Toggle grid | VERIFIED | c:chart.setSetting.grid | pass 5/5 | panel, scripted model |
| C1-048 | Settings | Solid/gradient background | VERIFIED | c:chart.setSetting.gradient | pass 5/5 | panel, scripted model |
| C1-049 | Settings | Solid background colour | VERIFIED | c:chart.setBackground | pass 5/5 | panel, scripted model |
| C1-050 | Settings | Gradient colours | IMPLEMENTED / UNVERIFIED | agentChartSettingsW1B.test.jsx | pass 4/4 | panel, partial |
| C1-051 | Settings | Crosshair mode | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-052 | Settings | Crosshair colour/width/style | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-053 | Settings | Magnet crosshair | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-054 | Settings | Price labels / MA labels | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-055 | Settings | Scale text size and colour | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-056 | Settings | Watermark on/off (Alt+Shift+W) | IMPLEMENTED / UNVERIFIED | agentBatch6.test.jsx | pass 11/11 | runtime, no panel |
| C1-057 | Settings | Watermark lines | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-058 | Settings | Watermark alignment | MISSING | none | n/a | none |
| C1-059 | Settings | Watermark size/weight/colour/opacity | IMPLEMENTED / UNVERIFIED | agentBatch6.test.jsx | pass 11/11 | runtime, no panel |
| C1-060 | Settings | Move watermark | VERIFIED | agentChartSettingsTruth: writes opts.watermarkPos | pass 1/1 | panel, scripted model |
| C1-061 | Settings | Reset watermark to centre | MISSING | none | n/a | none |
| C1-062 | Settings | Title shows ticker/company/both | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-063 | Settings | Day change beside title | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-064 | Settings | Legend mode | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-065 | Settings | Legend bar-info fields | MISSING | none | n/a | none |
| C1-066 | Settings | Info-row fields | MISSING | none | n/a | none |
| C1-067 | Settings | Header colours | MISSING | none | n/a | none |
| C1-068 | Settings | Swing labels on/off and sensitivity | IMPLEMENTED / UNVERIFIED | agentBatch6.test.jsx | pass 11/11 | runtime, no panel |
| C1-069 | Settings | Swing label background, tint, colours | IMPLEMENTED / UNVERIFIED | agentBatch6.test.jsx | pass 11/11 | runtime, no panel |
| C1-070 | Settings | Event markers | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-071 | Settings | Earnings beat/miss and IPO colours | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-072 | Settings | Prev-day lines on/off | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-073 | Settings | Prev-day line style/width/colour | IMPLEMENTED / UNVERIFIED | agentBatch6.test.jsx | pass 11/11 | runtime, no panel |
| C1-074 | Settings | Dark-pool levels | VERIFIED | agentChartSettingsW1B: turn on dark pool | pass 1/1 | panel, scripted model |
| C1-075 | Settings | Bar-close countdown (Shift+C) | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-076 | Settings | Restore defaults | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1.test.jsx; agentBatch6.test.jsx | pass 59/59 | runtime, no panel |
| C1-077 | Settings | Save / delete a custom colour | MISSING | none | n/a | none |
| C1-078 | Settings | Light/dark palette (Shift+T) | MISSING | none | n/a | none |
| C1-079 | Themes | Apply a theme to one chart | VERIFIED | c:chart.applyTheme | pass 5/5 | panel, scripted model |
| C1-080 | Themes | Apply a theme to all charts | IMPLEMENTED / UNVERIFIED | agentBoard.test.jsx | pass 22/22 | runtime, no panel |
| C1-081 | Themes | Apply a theme to all widgets | MISSING | none | n/a | none |
| C1-082 | Templates | Apply a template | VERIFIED | c:chart.applyTemplate | pass 4/4 | panel, scripted model |
| C1-083 | Templates | Save a template | VERIFIED | c:chartSetup.saveTemplate | pass 5/5 | panel, scripted model |
| C1-084 | Templates | Delete a template | VERIFIED | c:chartSetup.deleteTemplate | pass 4/4 | panel, scripted model |
| C1-085 | Templates | Copy another chart's look | NOT ON /CHARTS | agentChartsOperatorAcceptance.test.jsx | pass 10/10 | n/a |
| C1-086 | Volume | Show/hide volume (Ctrl+V, menu) | VERIFIED | c:volume.hide | pass 5/5 | panel, scripted model |
| C1-087 | Volume | Remove volume | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-088 | Volume | Separate pane toggle | NOT ON /CHARTS | none | n/a | n/a |
| C1-089 | Volume | Resize volume pane by drag | VERIFIED | agentChartSettingsTruth: the height: writes the pref | pass 1/1 | panel, scripted model |
| C1-090 | Volume | HVC highlight | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-091 | Volume | Volume colours, MA, label, bar style | IMPLEMENTED / UNVERIFIED | agentChartSettingsW1B.test.jsx | pass 4/4 | panel, partial |
| C1-092 | Volume | Overlay indicator on volume | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-093 | Panes | Move a pane | VERIFIED | agentIndicatorsP2: E4 | pass 1/1 | panel, scripted model |
| C1-094 | Panes | Resize a pane | IMPLEMENTED / UNVERIFIED | agentIndicatorsP2.test.jsx | pass 19/19 | panel, partial |
| C1-095 | Panes | Collapse a pane | NOT ON /CHARTS | none | n/a | n/a |
| C1-096 | Crosshair | Copy price at the cursor | NOT ON /CHARTS | none | n/a | n/a |
| C1-097 | Legend | Hide/show an indicator from chip | VERIFIED | c:indicator.hide; c:indicator.show | pass 9/9 | panel, scripted model |
| C1-098 | Legend | Display in another pane from chip | VERIFIED | c:indicatorStyle.place-own-pane | pass 4/4 | panel, scripted model |
| C1-099 | Legend | Duplicate on chart | IMPLEMENTED / UNVERIFIED | none named | n/a | source only |
| C1-100 | Legend | Show latest value in header | MISSING | none | n/a | none |
| C1-101 | Legend | Add alert from chip | VERIFIED | c:indicatorAlert.threshold | pass 5/5 | panel, scripted model |
| C1-102 | Legend | Delete indicator from chip | VERIFIED | c:indicator.remove-sma200 | pass 5/5 | panel, scripted model |
| C1-103 | Legend | Hide all indicators (Alt+Shift+I) | VERIFIED † | c:chartSetup.setIndicatorsHidden; agentChartViewControls: hides, reads back | pass 6/6 | panel, scripted model |
| C1-104 | Legend | Toggle RSI/MACD/BB/VWAP chord | IMPLEMENTED / UNVERIFIED | none named | n/a | source only |
| C1-105 | Legend | Toggle moving averages (Ctrl+M) | VERIFIED | c:chartSetup.setMovingAverages; agentChartViewControls: through the panel: every moving average | pass 6/6 | panel, scripted model |
| C1-106 | Measure | Measure on the chart | VERIFIED | drawingFamily: measure: the right symbol; drawingFamily: it persists in the store | pass 2/2 | panel, scripted model |
| C1-107 | Measure | Bars & Time | VERIFIED | drawingFamily: dateRange: the right symbol | pass 1/1 | panel, scripted model |
| C1-108 | Measure | Price range | VERIFIED | drawingFamily: priceRange: the right symbol | pass 1/1 | panel, scripted model |
| C1-109 | Measure | Price Move | VERIFIED | drawingFamily: advance: the right symbol | pass 1/1 | panel, scripted model |
| C1-110 | Share | Open share popover (Alt+S) | BLOCKED | none | n/a | none |
| C1-111 | Share | Download PNG | BLOCKED | none | n/a | none |
| C1-112 | Share | Copy image | BLOCKED | none | n/a | none |
| C1-113 | Share | Copy share link | BLOCKED | none | n/a | none |
| C1-114 | Alerts | Price alert at the cursor (Alt+N) | VERIFIED | c:alert.price-above; g:GW-14 | pass 7/7 | panel, scripted model |
| C1-115 | Alerts | Alert on a line, following it | VERIFIED | c:drawing.setAlert; drawingFamily: a trendline: shown first | pass 4/4 | panel, scripted model |
| C1-116 | Alerts | Alert at a line's fixed level | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-117 | Alerts | Alert on a fib level | VERIFIED | drawingFamily: one Fibonacci level binds | pass 1/1 | panel, scripted model |
| C1-118 | Alerts | Position alerts (three lines) | MISSING | none | n/a | none |
| C1-119 | Alerts | Pause/resume indicator alert | VERIFIED | c:indicatorAlert.toggle | pass 5/5 | panel, scripted model |
| C1-120 | Alerts | Delete indicator alert | VERIFIED | c:indicatorAlert.delete | pass 4/4 | panel, scripted model |
| C1-121 | Alerts | Move a level line | VERIFIED | c:drawing.setLevel | pass 5/5 | panel, scripted model |
| C1-122 | Right-click | Draw line at clicked price | NOT ON /CHARTS | c:drawing.addLevel; agentDrawings.test.jsx | pass 19/19 | n/a |
| C1-123 | Right-click | Add indicator from menu | NOT ON /CHARTS | none named | n/a | n/a |
| C1-124 | Right-click | Open indicator settings | NOT ON /CHARTS | none named | n/a | n/a |
| C1-125 | Right-click | Clear all drawings | VERIFIED | c:drawing.clear; drawings.outcome: a hidden drawing and "clear everything" | pass 5/5 | production (I-03) and panel |
| C1-126 | Right-click | Hide all drawings | IMPLEMENTED / UNVERIFIED | c:drawing.hideAll | pass 4/4 | panel, partial |
| C1-127 | Settings door | Open chart settings (Alt+,, gear) | MISSING | none | n/a | none |
| C1-128 | Drawing | Trendline | VERIFIED | c:drawing.trendline | pass 5/5 | production (B-01b) and panel |
| C1-129 | Drawing | Ray | NOT ON /CHARTS | c:drawing.ray | pass 5/5 | n/a |
| C1-130 | Drawing | Extended line | VERIFIED | drawingFamily: extended: the right symbol | pass 1/1 | panel, scripted model |
| C1-131 | Drawing | Horizontal line | VERIFIED | c:drawing.addLevel | pass 6/6 | panel, scripted model |
| C1-132 | Drawing | Horizontal ray | VERIFIED | c:drawing.horizontalRay | pass 5/5 | production (B-03) and panel |
| C1-133 | Drawing | Vertical line | VERIFIED | drawingFamily: vertical: the right symbol | pass 1/1 | panel, scripted model |
| C1-134 | Drawing | Rectangle | VERIFIED | c:drawing.rectangle | pass 5/5 | panel, scripted model |
| C1-135 | Drawing | Circle | VERIFIED | drawingFamily: circle: the right symbol | pass 1/1 | panel, scripted model |
| C1-136 | Drawing | Arrow | VERIFIED | drawingFamily: arrow: the right symbol | pass 1/1 | panel, scripted model |
| C1-137 | Drawing | Fib retracement | VERIFIED | c:drawing.fib | pass 5/5 | panel, scripted model |
| C1-138 | Drawing | Fib extension | VERIFIED | drawingFamily: fibext: the right symbol | pass 1/1 | panel, scripted model |
| C1-139 | Drawing | Pitchfork | VERIFIED | drawingFamily: pitchfork: the right symbol | pass 1/1 | panel, scripted model |
| C1-140 | Drawing | Parallel channel | VERIFIED | drawingFamily: channel: the right symbol | pass 1/1 | panel, scripted model |
| C1-141 | Drawing | Cup curve | VERIFIED | drawingFamily: cup: the right symbol | pass 1/1 | panel, scripted model |
| C1-142 | Drawing | Anchored VWAP | VERIFIED | c:drawing.avwap | pass 5/5 | panel, scripted model |
| C1-143 | Drawing | Text note | VERIFIED | c:drawing.text | pass 5/5 | panel, scripted model |
| C1-144 | Drawing | Position calculator | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C1-145 | Drawing | Eraser | VERIFIED | c:drawing.remove | pass 5/5 | panel, scripted model |
| C1-146 | Drawing | Delete selected (Del, button) | VERIFIED | c:drawing.remove; drawings.outcome: one visible drawing goes at once | pass 6/6 | panel, scripted model |
| C1-147 | Drawing | Recolour | VERIFIED | c:drawing.style | pass 4/4 | panel, scripted model |
| C1-148 | Drawing | Width and line style | VERIFIED | c:drawing.style; drawings.outcome: "make it red and dashed" | pass 5/5 | panel, scripted model |
| C1-149 | Drawing | Fill and border | VERIFIED | drawingFamily: a rectangle's fill keeps the candles visible | pass 1/1 | panel, scripted model |
| C1-150 | Drawing | Text font, size, bold, italic, background | VERIFIED | drawingFamily: a note: font, size, bold, italic | pass 1/1 | panel, scripted model |
| C1-151 | Drawing | Fib levels and fills | VERIFIED | drawingFamily: hides that level, no other; drawingFamily: a level's colour, a band on | pass 3/3 | panel, scripted model |
| C1-152 | Drawing | Reset fib | VERIFIED | drawingFamily: reset returns the Fibonacci to the table | pass 1/1 | panel, scripted model |
| C1-153 | Drawing | Measure-label options | VERIFIED | drawingFamily: Measure's label fields and position | pass 1/1 | panel, scripted model |
| C1-154 | Drawing | Price label on a line | VERIFIED | drawingFamily: a horizontal line's price label | pass 1/1 | panel, scripted model |
| C1-155 | Drawing | Edit anchors | VERIFIED | c:drawing.setAnchors; drawingFamily: the request carries each anchor | pass 5/5 | panel, scripted model |
| C1-156 | Drawing | Make horizontal | VERIFIED | drawingFamily: a whole drawing moves with one item per point | pass 1/1 | panel, scripted model |
| C1-157 | Drawing | Duplicate | MISSING | none | n/a | none |
| C1-158 | Drawing | Lock/unlock | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1.test.jsx | pass 48/48 | runtime, no panel |
| C1-159 | Drawing | Hide/show one | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1.test.jsx | pass 48/48 | runtime, no panel |
| C1-160 | Drawing | Save as default | MISSING | none | n/a | none |
| C1-161 | Drawing | Reorder (front/back) | UNMAPPED | none | n/a | none |
| C1-162 | Drawing | Undo/redo a drawing | BLOCKED | none | n/a | none |
| C1-163 | Drawing | Magnet for drawing | UNMAPPED | none | n/a | none |
| C1-164 | Drawing | Repeat drawing mode | BLOCKED | none | n/a | none |
| C1-165 | Drawing | Customise tool favourites | MISSING | none | n/a | none |
| C1-166 | Drawing | Nudge selected with arrows | BLOCKED | none | n/a | none |
| C1-167 | Boards | Switch drawing board | MISSING | agentDrawings.test.jsx | pass 13/13 | none |
| C1-168 | Boards | Create a board | MISSING | none | n/a | none |
| C1-169 | Boards | Rename a board | MISSING | none | n/a | none |
| C1-170 | Boards | Delete a board | MISSING | none | n/a | none |
| C1-171 | Keyboard | Add ticker to watchlist (Alt+Q) | VERIFIED | c:watchlist.add | pass 5/5 | panel, scripted model |
| C1-172 | Keyboard | Add indicator dialog (Alt+Shift+A) | VERIFIED | c:indicator.rsi | pass 5/5 | panel, scripted model |
| C1-173 | Keyboard | Cycle grid layout (Alt+\\) | UNMAPPED | none | n/a | none |
| C1-174 | Keyboard | Keyboard help (?) | UNMAPPED | none | n/a | none |
| C1-175 | Keyboard | Escape to cursor / cancel | BLOCKED | none | n/a | none |
| C2-001 | Picker | Open indicator library | MISSING | none | n/a | none |
| C2-002 | Picker | Search indicators by name or purpose | IMPLEMENTED / UNVERIFIED | c:definition.search; agentIndicatorsP2.test.jsx:206 | pass 5/5 | panel, partial |
| C2-003 | Picker | Browse by category | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-004 | Add | Add built-in indicator | VERIFIED | c:indicator.rsi; c:indicator.ema-9-20; g:GW-01 | pass 15/15 | production (E-01) and panel |
| C2-005 | Add | Add with chosen settings | VERIFIED | c:indicator.ema-9-20 | pass 9/9 | production (E-01) and panel |
| C2-006 | Add | Add another copy with defaults | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-007 | Add | Add own saved indicator | VERIFIED | c:indicator.apply-saved | pass 4/4 | panel, scripted model |
| C2-008 | Add | Add a symbol as a data series from search | UNMAPPED | none | n/a | none |
| C2-009 | Add | Add economic series | UNMAPPED | none | n/a | none |
| C2-010 | Add | Keyboard chord toggles RSI, MACD, BB, VWAP | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-011 | Add | Enable classic overlay average | MISSING | agentIndicatorsM2.test.jsx:141 | pass 1/1 | none |
| C2-012 | Add | Add Volume Profile | MISSING | agentIndicatorsM2.test.jsx:141 | pass 1/1 | none |
| C2-013 | Add | Toggle Chart IQ pattern recognition | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-014 | Remove | Delete indicator from legend | VERIFIED | c:indicator.remove-sma200 | pass 5/5 | panel, scripted model |
| C2-015 | Remove | Delete from Chart Settings | VERIFIED | c:indicator.remove-sma200 | pass 5/5 | panel, scripted model |
| C2-016 | Remove | Delete classic average row | VERIFIED | c:indicator.remove-sma200 | pass 5/5 | panel, scripted model |
| C2-017 | Remove | Remove an unavailable indicator | UNMAPPED | none | n/a | none |
| C2-018 | Visibility | Hide indicator | VERIFIED | c:indicator.hide | pass 5/5 | panel, scripted model |
| C2-019 | Visibility | Show indicator | VERIFIED | c:indicator.show | pass 4/4 | panel, scripted model |
| C2-020 | Visibility | Hide or show volume | VERIFIED | c:volume.hide | pass 5/5 | panel, scripted model |
| C2-021 | Visibility | Limit to chosen timeframes | VERIFIED | c:indicator.followup-daily-only | pass 5/5 | panel, scripted model |
| C2-022 | Read | See what is on a chart | VERIFIED | agentIndicatorsM1: "List the indicators on the right chart." | pass 1/1 | panel, scripted model |
| C2-023 | Read | Read About text | IMPLEMENTED / UNVERIFIED | agentIndicatorsP2.test.jsx:206; agentDefinitions.test.js:75 | pass 2/2 | runtime, no panel |
| C2-024 | Inputs | Change numeric setting | VERIFIED | c:indicator.update-period | pass 6/6 | panel, scripted model |
| C2-025 | Inputs | Change select setting (MA type, source) | VERIFIED | agentIndicatorSelectInput: "change that to an SMA" | pass 1/1 | panel, scripted model |
| C2-026 | Inputs | Flip a toggle setting | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-027 | Inputs | Edit session input | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-028 | Inputs | Cancel settings, roll back all edits | MISSING | none | n/a | none |
| C2-029 | Inputs | Set calculation timeframe | MISSING | none | n/a | none |
| C2-030 | Style | Change line colour | VERIFIED | c:indicatorStyle.colour | pass 6/6 | panel, scripted model |
| C2-031 | Style | Change histogram up / down colours | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-032 | Style | Change line width | VERIFIED | c:indicator.followup-thicker | pass 4/4 | panel, scripted model |
| C2-033 | Style | Change line style | VERIFIED | agentIndicatorsP2: E2 | pass 1/1 | panel, scripted model |
| C2-034 | Style | Change plot style | IMPLEMENTED / UNVERIFIED | agentIndicatorsP2.test.jsx:97 | pass 1/1 | runtime, no panel |
| C2-035 | Style | Toggle overlap candles | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-036 | Placement | Move to price, volume or own pane | VERIFIED | c:indicatorStyle.place-own-pane | pass 4/4 | panel, scripted model |
| C2-037 | Placement | Move into another indicator's pane | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-038 | Panes | Reorder pane | VERIFIED | agentIndicatorsP2: E4 | pass 1/1 | panel, scripted model |
| C2-039 | Panes | Resize pane by divider | IMPLEMENTED / UNVERIFIED | agentIndicatorsP2.test.jsx:106 | pass 1/1 | runtime, no panel |
| C2-040 | Panes | Reorder series within a pane | UNMAPPED | none | n/a | none |
| C2-041 | Legend | Show latest value in header | MISSING | none | n/a | none |
| C2-042 | Legend | Duplicate on chart | IMPLEMENTED / UNVERIFIED | c:indicatorCopy.duplicate | pass 4/4 | panel, partial |
| C2-043 | Legend | Create custom copy | IMPLEMENTED / UNVERIFIED | agentDefinitions.test.js:96; agentDefinitions.test.js:110 | pass 2/2 | runtime, no panel |
| C2-044 | Legend | Open Modify with UCT Intelligence | IMPLEMENTED / UNVERIFIED | agentIndicatorsM1.test.jsx:162 | pass 1/1 | runtime, no panel |
| C2-045 | Legend | Open Edit formula | MISSING | none | n/a | none |
| C2-046 | Legend | Apply script accuracy upgrade | BLOCKED | none | n/a | none |
| C2-047 | Legend | Report mismatch with TradingView | BLOCKED | none | n/a | none |
| C2-048 | Undo | Indicator undo and redo buttons | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-049 | Copy | Copy indicators to another chart | VERIFIED | c:indicator.followup-other-chart; agentIndicatorsP2: E3 | pass 5/5 | panel, scripted model |
| C2-050 | Copy | Accept or refuse a shared chart's indicators | MISSING | none | n/a | none |
| C2-051 | Templates | Save indicator template | VERIFIED | c:indicatorTemplate.save | pass 4/4 | panel, scripted model |
| C2-052 | Templates | Apply indicator template | VERIFIED | c:indicatorTemplate.apply | pass 4/4 | panel, scripted model |
| C2-053 | Templates | Delete indicator template | VERIFIED | c:indicatorTemplate.delete | pass 3/3 | panel, scripted model |
| C2-054 | Templates | List indicator templates | VERIFIED | c:indicatorTemplate.list | pass 3/3 | panel, scripted model |
| C2-055 | Create | Open Create Indicator | VERIFIED | agentIndicatorsM1: model path: an EXPLICIT "open Create Indicator" | pass 1/1 | panel, scripted model |
| C2-056 | Create | Describe an indicator, get a draft | VERIFIED | c:indicator.draft-create; g:GW-27 | pass 6/6 | panel, scripted model |
| C2-057 | Create | Refine draft by conversation | IMPLEMENTED / UNVERIFIED | agentIndicatorsM3.test.jsx:154 | pass 1/1 | runtime, no panel |
| C2-058 | Create | Answer the builder's choice question | IMPLEMENTED / UNVERIFIED | agentIndicatorsM3.test.jsx:241 | pass 1/1 | runtime, no panel |
| C2-059 | Create | Undo a draft step | IMPLEMENTED / UNVERIFIED | agentIndicatorsM3.test.jsx:442; agentIndicatorsM3.test.jsx:433 | pass 2/2 | runtime, no panel |
| C2-060 | Create | Preview draft on chart | VERIFIED | c:indicator.preview-draft; g:GW-27 | pass 5/5 | panel, scripted model |
| C2-061 | Create | Save draft, acknowledge warnings | VERIFIED | c:indicator.save-draft-as; g:GW-27 | pass 5/5 | panel, scripted model |
| C2-062 | Create | Discard draft | VERIFIED | c:indicator.discard-draft | pass 3/3 | panel, scripted model |
| C2-063 | Create | Keep draft and close | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-064 | Builder | Build by conditions | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-065 | Builder | Group conditions, any or all | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-066 | Builder | Enter a formula | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-067 | Builder | Add or remove member input | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-068 | Builder | Add, remove or restyle output plot | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-069 | Builder | Set placement and levels | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-070 | Builder | Set signal markers | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-071 | Builder | Colour candles or background on a signal | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-072 | Builder | Name the draft | VERIFIED | c:indicator.save-draft-as | pass 4/4 | panel, scripted model |
| C2-073 | Builder | Ask for an alert from the builder | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-074 | Builder | Run Evidence tab | MISSING | none | n/a | none |
| C2-075 | Builder | Use a starter | MISSING | none | n/a | none |
| C2-076 | Import | Paste Pine or thinkScript | MISSING | none | n/a | none |
| C2-077 | Import | Apply import suggestion | MISSING | none | n/a | none |
| C2-078 | Import | Change script settings | MISSING | none | n/a | none |
| C2-079 | Import | Turn script output into a screen | MISSING | none | n/a | none |
| C2-080 | Image | Read an indicator from a screenshot | MISSING | none | n/a | none |
| C2-081 | Image | Accept image candidate | MISSING | none | n/a | none |
| C2-082 | Saved | Open saved definition to edit | IMPLEMENTED / UNVERIFIED | agentIndicatorsM1.test.jsx:162 | pass 1/1 | runtime, no panel |
| C2-083 | Saved | Delete saved definition | VERIFIED | g:GW-27 | pass 1/1 | panel, scripted model |
| C2-084 | Saved | Share a definition by link | BLOCKED | none | n/a | none |
| C2-085 | Saved | Publish to or withdraw from library | BLOCKED | none | n/a | none |
| C2-086 | Saved | Install from a share link | BLOCKED | none | n/a | none |
| C2-087 | Saved | Restore an older version | MISSING | none | n/a | none |
| C2-088 | Alerts | Open indicator alerts popover | MISSING | none | n/a | none |
| C2-089 | Alerts | Create threshold alert | VERIFIED | c:indicatorAlert.threshold; agentIndicatorAlerts: "alert me when RSI goes above 70" | pass 6/6 | panel, scripted model |
| C2-090 | Alerts | Create MA cross alert | VERIFIED | c:indicatorAlert.ma-cross | pass 5/5 | panel, scripted model |
| C2-091 | Alerts | Choose plot on a multi-line indicator | IMPLEMENTED / UNVERIFIED | agentIndicatorAlerts.test.jsx:124 | pass 1/1 | runtime, no panel |
| C2-092 | Alerts | Alert on a yes/no signal with trigger policy | MISSING | none | n/a | none |
| C2-093 | Alerts | Alert on another timeframe | VERIFIED | agentIndicatorAlertTruth: "alert on the weekly RSI": a card first | pass 1/1 | panel, scripted model |
| C2-094 | Alerts | Limit alert to this chart | MISSING | none | n/a | none |
| C2-095 | Alerts | Override alert inputs | MISSING | none | n/a | none |
| C2-096 | Alerts | Choose which instance | VERIFIED | c:indicatorAlert.ma-cross-multichart | pass 3/3 | panel, scripted model |
| C2-097 | Alerts | List indicator alerts | VERIFIED | c:indicatorAlert.list; agentIndicatorAlertTruth: "show my indicator alerts" | pass 5/5 | panel, scripted model |
| C2-098 | Alerts | Pause or resume alert | VERIFIED | c:indicatorAlert.toggle | pass 5/5 | panel, scripted model |
| C2-099 | Alerts | Delete alert | VERIFIED | c:indicatorAlert.delete | pass 4/4 | panel, scripted model |
| C2-100 | Alerts | See why an alert cannot fire | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C2-101 | Mobile | Edit an average or study on phone | NOT ON /CHARTS | none | n/a | n/a |
| C3-001 | Board | Add a widget from Widgets ▾ | VERIFIED | c:widget.news | pass 5/5 | panel, scripted model |
| C3-002 | Board | Drag a widget to move it, or nudge it | IMPLEMENTED / UNVERIFIED | agentBoard.test.jsx:117; agentBoard.test.jsx:129; agentBoard.test.jsx:231 | pass 3/3 | runtime, no panel |
| C3-003 | Board | Drag a widget edge or merged seam to resize | IMPLEMENTED / UNVERIFIED | agentBatch6.test.jsx:192; agentBatch6.test.jsx:204 | pass 2/2 | runtime, no panel |
| C3-004 | Board | Close a widget | VERIFIED | c:widget.remove; closeChart: "close the top-left chart" | pass 7/7 | panel, scripted model |
| C3-005 | Board | Merge or unmerge widgets (lock board, drop borders) | MISSING | none | n/a | none |
| C3-006 | Link | Cycle a widget's link colour | IMPLEMENTED / UNVERIFIED | agentBoard.test.jsx:138; agentBoard.test.jsx:145 | pass 2/2 | runtime, no panel |
| C3-007 | Link | Change a tool panel's colour group | MISSING | none | n/a | none |
| C3-008 | Float | Float a widget over another | MISSING | agentBoard.test.jsx:231 | pass 1/1 | none |
| C3-009 | Float | Drag or resize a floating widget | BLOCKED | none | n/a | none |
| C3-010 | Float | Dock a floating widget back into the grid | MISSING | none | n/a | none |
| C3-011 | Float | Move a floating widget into another widget's tabs | MISSING | none | n/a | none |
| C3-012 | Popout | Pop a widget into its own window | MISSING | none | n/a | none |
| C3-013 | Popout | Pop out the whole layout | MISSING | none | n/a | none |
| C3-014 | Popout | Dock a popped widget or layout back | MISSING | none | n/a | none |
| C3-015 | Popout | Close a popped widget | MISSING | none | n/a | none |
| C3-016 | Widget tabs | Add a widget as a tab | IMPLEMENTED / UNVERIFIED | agentChartsOperatorP1.test.jsx:564 | pass 1/1 | runtime, no panel |
| C3-017 | Widget tabs | Switch a widget tab | IMPLEMENTED / UNVERIFIED | agentBoard.test.jsx:259 | pass 1/1 | runtime, no panel |
| C3-018 | Widget tabs | Rename a widget tab | IMPLEMENTED / UNVERIFIED | agentBoard.test.jsx:268 | pass 1/1 | runtime, no panel |
| C3-019 | Widget tabs | Close a widget tab | IMPLEMENTED / UNVERIFIED | agentBoard.test.jsx:268; agentBoard.test.jsx:280; agentBoard.test.jsx:301 | pass 3/3 | runtime, no panel |
| C3-020 | Chart tabs | Add a chart tab | VERIFIED | c:chart.addTab; chartTabs: "add a tab to this chart" | pass 6/6 | panel, scripted model |
| C3-021 | Chart tabs | Switch a chart tab | VERIFIED | chartTabs: add two, rename by position, select by name | pass 1/1 | panel, scripted model |
| C3-022 | Chart tabs | Rename a chart tab | VERIFIED | c:chart.renameTab | pass 5/5 | panel, scripted model |
| C3-023 | Chart tabs | Change a chart tab's link colour | IMPLEMENTED / UNVERIFIED | agentBatch6.test.jsx:222 | pass 1/1 | runtime, no panel |
| C3-024 | Chart tabs | Close a chart tab | VERIFIED | c:chart.closeTab | pass 5/5 | panel, scripted model |
| C3-025 | Layout Dock | Open a saved layout | VERIFIED | c:layout.open | pass 5/5 | panel, scripted model |
| C3-026 | Layout Dock | See which layout is open | VERIFIED | agentLayouts: a fast layout question is answered without the model | pass 1/1 | panel, scripted model |
| C3-027 | Layout Dock | Undo a layout switch from the toast | IMPLEMENTED / UNVERIFIED | agentLayouts.test.jsx:71 | pass 1/1 | runtime, no panel |
| C3-028 | Layout Dock | Create a new layout from the dock | VERIFIED | c:layout.create | pass 4/4 | panel, scripted model |
| C3-029 | Layout Dock | Start a new blank board from the Layouts menu | IMPLEMENTED / UNVERIFIED | agentLayouts.test.jsx:403 | pass 1/1 | runtime, no panel |
| C3-030 | Layout Dock | Save the open layout | IMPLEMENTED / UNVERIFIED | agentBoard.test.jsx:200; agentBoard.test.jsx:212 | pass 2/2 | production (E-06b) only |
| C3-031 | Layout Dock | Save as a new layout | VERIFIED | c:layout.saveAs | pass 4/4 | production (E-06) and panel |
| C3-032 | Layout Dock | Save a layout as a global template (admin) | BLOCKED | none | n/a | none |
| C3-033 | Layout Dock | Rename a layout | VERIFIED | c:layout.rename | pass 4/4 | panel, scripted model |
| C3-034 | Layout Dock | Duplicate a layout | VERIFIED | c:layout.duplicate | pass 4/4 | panel, scripted model |
| C3-035 | Layout Dock | Delete a layout | VERIFIED | c:layout.delete | pass 4/4 | panel, scripted model |
| C3-036 | Layout Dock | Delete a prebuilt template (admin) | BLOCKED | agentProtectedLayouts.test.js | pass 9/9 | none |
| C3-037 | Layout Dock | Pin a layout to the bar | MISSING | none | n/a | none |
| C3-038 | Layout Dock | Reorder layouts on the bar | MISSING | none | n/a | none |
| C3-039 | Layout Dock | Remove a layout from the bar | MISSING | none | n/a | none |
| C3-040 | Layout Dock | View a layout's version history | MISSING | none | n/a | none |
| C3-041 | Layout Dock | Restore a layout version | MISSING | none | n/a | none |
| C3-042 | Multi Chart | Enter a preset grid | VERIFIED | multiChart.enter | pass | browser, scripted model |
| C3-043 | Multi Chart | Apply a custom rows × columns grid | VERIFIED | multiChart.enter | pass | browser, scripted model |
| C3-044 | Multi Chart | Exit Multi Chart | VERIFIED | multiChart.exit | pass | browser, scripted model |
| C3-045 | Multi Chart | Toggle crosshair sync | VERIFIED | multiChart.setOption crosshair_sync | pass | browser, scripted model |
| C3-046 | Multi Chart | Toggle time-range sync | VERIFIED | multiChart.setOption time_range_sync | pass | browser, scripted model |
| C3-047 | Multi Chart | Turn on Groups mode | VERIFIED | multiChart.setOption groups_mode | pass | panel, scripted model |
| C3-048 | Multi Chart | Pick a group for the grid | VERIFIED | multiChart.loadGroup group | pass | panel, scripted model |
| C3-049 | Multi Chart | Step or switch group | VERIFIED | multiChart.loadGroup step | pass | panel, scripted model |
| C3-050 | Multi Chart | Refresh the group | VERIFIED | multiChart.loadGroup step refresh | pass | panel, scripted model |
| C3-051 | Multi Chart | Exit Groups | VERIFIED | multiChart.setOption groups_mode off | pass | panel, scripted model |
| C3-052 | Multi Chart | Apply a saved grid | VERIFIED | multiChart.openSaved | pass | panel, scripted model |
| C3-053 | Multi Chart | Save a grid | VERIFIED | multiChart.saveGrid | pass | panel, scripted model |
| C3-054 | Multi Chart | Save a grid as global (admin) | BLOCKED | none | n/a | none |
| C3-055 | Multi Chart | Delete a saved grid | VERIFIED | multiChart.deleteSaved | pass | panel, scripted model |
| C3-056 | Multi Chart | Set a cell's timeframe | BLOCKED | none | n/a | none |
| C3-057 | Multi Chart | Set a cell's chart style | BLOCKED | none | n/a | none |
| C3-058 | Multi Chart | Toggle a cell's session | BLOCKED | none | n/a | none |
| C3-059 | Multi Chart | Reset a cell to my chart | VERIFIED | multiChart.cell reset | pass | panel, scripted model |
| C3-060 | Multi Chart | Maximize or restore a cell | VERIFIED | multiChart.cell maximize, multiChart.setOption maximized | pass | browser, scripted model |
| C3-061 | Multi Chart | Open shared grid settings | BLOCKED | none | n/a | none |
| C3-062 | Multi Chart | Set an alert from a cell | BLOCKED | none | n/a | none |
| C3-063 | Watchlist | Open a list in a widget (own) | IMPLEMENTED / UNVERIFIED | agentBoard.test.jsx:158 | pass 1/1 | runtime, no panel |
| C3-064 | Watchlist | Open a prebuilt or community list | MISSING | none | n/a | none |
| C3-065 | Watchlist | Open the Flagged list | MISSING | none | n/a | none |
| C3-066 | Watchlist | Open a colour-tag list | MISSING | none | n/a | none |
| C3-067 | Watchlist | Go back to the list picker | MISSING | none | n/a | none |
| C3-068 | Watchlist | Click a row to load the symbol | VERIFIED | c:symbol.switch | pass 7/7 | panel, scripted model |
| C3-069 | Watchlist | Walk the list with arrow keys or space | VERIFIED | c:watchlist.step; listControl: previous, and both ends wrap | pass 5/5 | panel, scripted model |
| C3-070 | Watchlist | Create a list | VERIFIED | c:watchlist.create; watchlists.outcome: nothing exists until Apply | pass 5/5 | production (C-05b) and panel |
| C3-071 | Watchlist | Create a list from a template | MISSING | none | n/a | none |
| C3-072 | Watchlist | Save a community list to My Lists | MISSING | none | n/a | none |
| C3-073 | Watchlist | Rename a list | NOT ON /CHARTS | agentWatchlists.test.jsx:222 | pass 1/1 | n/a |
| C3-074 | Watchlist | Rename the Flagged list | MISSING | none | n/a | none |
| C3-075 | Watchlist | Delete a list | VERIFIED | c:watchlist.delete; watchlists.outcome: the proposal names the list and its size | pass 5/5 | production (I-01) and panel |
| C3-076 | Watchlist | Add a symbol | VERIFIED | c:watchlist.add | pass 5/5 | production (C-05b) and panel |
| C3-077 | Watchlist | Add to Flagged | VERIFIED | c:watchlist.setFlag; listControl: "flag NVDA" | pass 5/5 | panel, scripted model |
| C3-078 | Watchlist | Flag or unflag a row (star) | VERIFIED | listControl: unflag keeps the rest | pass 1/1 | panel, scripted model |
| C3-079 | Watchlist | Remove a symbol | VERIFIED | c:watchlist.remove | pass 5/5 | panel, scripted model |
| C3-080 | Watchlist | Remove all starred symbols from a list | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-081 | Watchlist | Reorder symbols by hand | NOT ON /CHARTS | agentChartsOperatorP1.test.jsx:358; agentChartsOperatorP1.test.jsx:366; agentChartsOperatorP1.test.jsx:377 | pass 3/3 | n/a |
| C3-082 | Watchlist | Sort by a column | VERIFIED | c:watchlist.sortColumn; listControl: "sort my watchlist by RVOL" | pass 6/6 | panel, scripted model |
| C3-083 | Watchlist | Show or hide a column | VERIFIED | c:watchlist.setColumns; listControl: "add the market cap column"; listControl: hide a default column and an added one | pass 6/6 | panel, scripted model |
| C3-084 | Watchlist | Apply a column preset | NOT ON /CHARTS | none | n/a | n/a |
| C3-085 | Watchlist | Reorder columns by drag | MISSING | none | n/a | none |
| C3-086 | Watchlist | Resize a column | MISSING | none | n/a | none |
| C3-087 | Watchlist | Reset columns | VERIFIED | listControl: reset goes to the defaults | pass 1/1 | panel, scripted model |
| C3-088 | Watchlist | Write or edit a ticker note | VERIFIED | c:watchlist.setNote | pass 4/4 | panel, scripted model |
| C3-089 | Watchlist | Expand or collapse a list | MISSING | none | n/a | none |
| C3-090 | Watchlist | Tag a symbol with a colour | NOT ON /CHARTS | none | n/a | n/a |
| C3-091 | Watchlist | Share a tag colour or Flagged | BLOCKED | none | n/a | none |
| C3-092 | Watchlist | Make a list public | BLOCKED | none | n/a | none |
| C3-093 | Watchlist | Mark a list prebuilt (admin) | BLOCKED | none | n/a | none |
| C3-094 | Watchlist | Copy a list to the clipboard | MISSING | none | n/a | none |
| C3-095 | Watchlist | Export a list as CSV or Excel | MISSING | none | n/a | none |
| C3-096 | Watchlist | Import tickers | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-097 | Watchlist | View or restore list version history | MISSING | none | n/a | none |
| C3-098 | Watchlist | Set a price alert from a row | VERIFIED | c:alert.price-above | pass 6/6 | panel, scripted model |
| C3-099 | Watchlist | Delete an alert from the row popover | VERIFIED | c:alert.delete | pass 4/4 | panel, scripted model |
| C3-100 | Watchlist | Open Full Research or AI from a row | IMPLEMENTED / UNVERIFIED | agentBatch1.test.jsx; agentBatch4.test.jsx | pass 39/39 | runtime, no panel |
| C3-101 | Watchlist | Compare from a row | VERIFIED | c:compare.amd | pass 5/5 | panel, scripted model |
| C3-102 | Watchlist | Open a row's attention facts | UNMAPPED | none | n/a | none |
| C3-103 | Watchlist | Change list appearance (canvas, text, tint) | MISSING | none | n/a | none |
| C3-104 | Watchlist | Save or load a watchlist look | MISSING | none | n/a | none |
| C3-105 | Watchlist | Track or freeze a linked scan or theme | BLOCKED | none | n/a | none |
| C3-106 | Watchlist | Use a saved screen as a list | BLOCKED | none | n/a | none |
| C3-107 | Scanner | Pick a preset scan | IMPLEMENTED / UNVERIFIED | agentBoard.test.jsx:171 | pass 1/1 | runtime, no panel |
| C3-108 | Scanner | Leave a scan, back to the picker | MISSING | none | n/a | none |
| C3-109 | Scanner | Search the preset list | MISSING | none | n/a | none |
| C3-110 | Scanner | Read a scan's conditions | MISSING | none | n/a | none |
| C3-111 | Scanner | Read a scan's results | VERIFIED | listControl: a Scanner: sorts and reads the same way | pass 1/1 | panel, scripted model |
| C3-112 | Scanner | Refresh a scan | MISSING | none | n/a | none |
| C3-113 | Scanner | Sort a scan | VERIFIED | listControl: a Scanner: sorts and reads the same way | pass 1/1 | panel, scripted model |
| C3-114 | Scanner | Change scan columns | VERIFIED | listControl: a Scanner: sorts and reads the same way | pass 1/1 | panel, scripted model |
| C3-115 | Scanner | Create a scanner in the workspace | BLOCKED | none | n/a | none |
| C3-116 | Scanner | Modify a preset scan's conditions | BLOCKED | none | n/a | none |
| C3-117 | Scanner | Open an AI Search scan in the builder and edit conditions | MISSING | none | n/a | none |
| C3-118 | Scanner | Run or refine a screen from the workspace chat | VERIFIED | c:scan.near-high.sign; c:scan.refine.sector | pass 7/7 | panel, scripted model |
| C3-119 | Scanner | Save a screen run from the workspace | VERIFIED | c:screener.saveAs | pass 4/4 | panel, scripted model |
| C3-120 | Scanner | Send a scan to Journal | MISSING | none | n/a | none |
| C3-121 | Volume Surge | Choose what the scanner watches | MISSING | none | n/a | none |
| C3-122 | Volume Surge | Create, rename or delete a scope list | MISSING | none | n/a | none |
| C3-123 | Volume Surge | Add a ticker to a scope list | MISSING | none | n/a | none |
| C3-124 | Volume Surge | Set thresholds (RVOL, burst, move, $ floor) | MISSING | none | n/a | none |
| C3-125 | Volume Surge | Toggle logos | IMPLEMENTED / UNVERIFIED | agentWidgetOptions.test.jsx:49 | pass 1/1 | runtime, no panel |
| C3-126 | Volume Surge | Click a row or remove it from the list | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-127 | Alerts | See my alerts | VERIFIED | alerts.outcome: nothing reaches the server until Apply | pass 1/1 | panel, scripted model |
| C3-128 | Alerts | Create a price alert | VERIFIED | c:alert.price-above; alerts.outcome: nothing reaches the server until Apply | pass 7/7 | panel, scripted model |
| C3-129 | Alerts | Delete an alert | VERIFIED | c:alert.delete; alerts.outcome: the proposal says what goes and that it is permanent | pass 5/5 | panel, scripted model |
| C3-130 | Alerts | Click an alert to load the symbol | VERIFIED | c:symbol.switch | pass 7/7 | panel, scripted model |
| C3-131 | Alerts | Change Alerts widget appearance | MISSING | none | n/a | none |
| C3-132 | Alerts | Send alerts to Journal | MISSING | none | n/a | none |
| C3-133 | News | Filter catalysts up, down or all | IMPLEMENTED / UNVERIFIED | agentWidgetOptions.test.jsx:49 | pass 1/1 | runtime, no panel |
| C3-134 | News | Read stored headlines for a symbol | VERIFIED | c:news.latest; c:news.catalysts | pass 9/9 | panel, scripted model |
| C3-135 | News | Place a headline on the chart | MISSING | none | n/a | none |
| C3-136 | News | Change News widget appearance | MISSING | none | n/a | none |
| C3-137 | News | Send the feed to Journal | MISSING | none | n/a | none |
| C3-138 | TE News | Search headlines | MISSING | none | n/a | none |
| C3-139 | TE News | Filter by category, linked symbol or watchlist | MISSING | none | n/a | none |
| C3-140 | TE News | Apply, rename or delete a filter preset | MISSING | none | n/a | none |
| C3-141 | TE News | Save or unsave a headline | MISSING | none | n/a | none |
| C3-142 | TE News | Add or edit a headline note | MISSING | none | n/a | none |
| C3-143 | TE News | Manage collections | MISSING | none | n/a | none |
| C3-144 | TE News | Add a headline's ticker to a watchlist | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-145 | TE News | Explain a headline or ask about it | IMPLEMENTED / UNVERIFIED | agentNewsAsk.test.jsx; agentNewsContinue.test.jsx | pass 21/21 | panel, partial |
| C3-146 | TE News | Jump to live or browse a past day | MISSING | none | n/a | none |
| C3-147 | TE News | Send a headline to Notebook | MISSING | none | n/a | none |
| C3-148 | Calendar | Step days in the widget | MISSING | agentMultiActionFollowups.test.jsx:927 | pass 1/1 | none |
| C3-149 | Calendar | Ask who reports on a day from Charts | MISSING | none | n/a | none |
| C3-150 | Calendar | Ask when a stock reports from Charts | IMPLEMENTED / UNVERIFIED | c:earnings.date | pass 6/6 | panel, partial |
| C3-151 | Calendar | Filter economic events by stars | IMPLEMENTED / UNVERIFIED | agentWidgetOptions.test.jsx:49 | pass 1/1 | runtime, no panel |
| C3-152 | Calendar | Toggle the TBD section | MISSING | none | n/a | none |
| C3-153 | Calendar | Sort earnings columns | MISSING | none | n/a | none |
| C3-154 | Calendar | Show all earnings in a section | MISSING | none | n/a | none |
| C3-155 | Calendar | Click an earnings row | VERIFIED | c:symbol.switch | pass 7/7 | panel, scripted model |
| C3-156 | Calendar | Send a day to Journal | MISSING | none | n/a | none |
| C3-157 | Breadth | Read breadth tiles | VERIFIED | c:breadth.now; c:breadth.measure-now | pass 11/11 | panel, scripted model |
| C3-158 | Breadth | Add or remove a reading | MISSING | agentWidgetOptions.test.jsx | pass 8/8 | none |
| C3-159 | Breadth | Switch heatmap and ratio view | MISSING | none | n/a | none |
| C3-160 | Breadth | Change tile style | MISSING | none | n/a | none |
| C3-161 | Breadth | Change palette, intensity or background | MISSING | none | n/a | none |
| C3-162 | Breadth | Drill into a reading | MISSING | none | n/a | none |
| C3-163 | Breadth | Send a snapshot to Journal | MISSING | none | n/a | none |
| C3-164 | Options Flow | Switch market or symbol scope | IMPLEMENTED / UNVERIFIED | agentWidgetOptions.test.jsx:49 | pass 1/1 | runtime, no panel |
| C3-165 | Options Flow | Switch the lead view | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-166 | Options Flow | Set filters (premium, call/put, type, direction) | MISSING | none | n/a | none |
| C3-167 | Options Flow | Read the flow | MISSING | none | n/a | none |
| C3-168 | Options Flow | Click a flow row | VERIFIED | c:symbol.switch | pass 7/7 | panel, scripted model |
| C3-169 | Themes | Pick a period or ranking | MISSING | none | n/a | none |
| C3-170 | Themes | Flip sort direction | MISSING | none | n/a | none |
| C3-171 | Themes | Switch today basis | MISSING | none | n/a | none |
| C3-172 | Themes | Open a theme or pick a holding | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-173 | Themes | Search themes or tickers | MISSING | none | n/a | none |
| C3-174 | Themes | Pick, rename or delete a theme set | MISSING | none | n/a | none |
| C3-175 | Themes | Edit a set (add, hide, reset, custom theme) | MISSING | none | n/a | none |
| C3-176 | Themes | Add or remove a stock in a theme | MISSING | none | n/a | none |
| C3-177 | Themes | Send the ranking to Journal | MISSING | none | n/a | none |
| C3-178 | Fundamentals | Switch view | VERIFIED | agentWidgetOptions: "show annual on the fundamentals" | pass 1/1 | panel, scripted model |
| C3-179 | Fundamentals | Read the numbers | VERIFIED | c:stock.profile; c:earnings.date | pass 10/10 | panel, scripted model |
| C3-180 | Fundamentals | Change appearance or send to Journal | MISSING | none | n/a | none |
| C3-181 | Profile | Read profile and earnings table | VERIFIED | c:stock.profile; c:earnings.date | pass 10/10 | panel, scripted model |
| C3-182 | Profile | Click a peer ticker | VERIFIED | c:symbol.switch | pass 7/7 | panel, scripted model |
| C3-183 | Indexes | Hide or restore an index | MISSING | none | n/a | none |
| C3-184 | Indexes | Send levels to Journal | MISSING | none | n/a | none |
| C3-185 | Market Context | Read market context | UNMAPPED | none | n/a | none |
| C3-186 | Market Context | Send to Journal | MISSING | none | n/a | none |
| C3-187 | NH/NL | Add or remove a universe | MISSING | none | n/a | none |
| C3-188 | NH/NL | Switch universe tab | MISSING | none | n/a | none |
| C3-189 | NH/NL | Expand a row or pick a symbol | VERIFIED | c:symbol.switch | pass 7/7 | panel, scripted model |
| C3-190 | NH/NL | Toggle logos, font, background | MISSING | none | n/a | none |
| C3-191 | H/L Pulse | Change Pulse settings | MISSING | none | n/a | none |
| C3-192 | Market Map | Pick or remove a universe | MISSING | none | n/a | none |
| C3-193 | Market Map | Pick X, Y or size axis | MISSING | none | n/a | none |
| C3-194 | Market Map | Follow the linked list | MISSING | none | n/a | none |
| C3-195 | Market Map | Cycle labels or zoom | MISSING | none | n/a | none |
| C3-196 | AI Search | Ask a question or follow one up | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-197 | AI Search | Change ask mode, stop or retry | MISSING | none | n/a | none |
| C3-198 | AI Search | Save, reopen or remove an answer | MISSING | none | n/a | none |
| C3-199 | AI Search | Copy or speak an answer | MISSING | none | n/a | none |
| C3-200 | AI Search | Send the conversation to Journal | MISSING | none | n/a | none |
| C3-201 | Notebook | Open or search a note | MISSING | none | n/a | none |
| C3-202 | Notebook | Create a note | MISSING | none | n/a | none |
| C3-203 | Notebook | Edit a note's title or body | BLOCKED | none | n/a | none |
| C3-204 | Notebook | Browse folders | MISSING | none | n/a | none |
| C3-205 | Period Sort | Start a custom-period sort | MISSING | none | n/a | none |
| C3-206 | Period Sort | Choose grouping, replay and start mark | MISSING | none | n/a | none |
| C3-207 | Period Sort | Dock the panel or add it as a tab | MISSING | none | n/a | none |
| C3-208 | Period Sort | Refresh results | MISSING | none | n/a | none |
| C3-209 | Replay | Start replay at a date | VERIFIED | c:chart.replay; agentChartReplay: replay from Oct 15 | pass 5/5 | panel, scripted model |
| C3-210 | Replay | Exit replay | VERIFIED | c:chart.replay.exit | pass 4/4 | panel, scripted model |
| C3-211 | Replay | Pick the cutoff by clicking the chart | MISSING | none | n/a | none |
| C3-212 | Replay | Set replay timeframe | IMPLEMENTED / UNVERIFIED | agentChartReplay.test.jsx:41 | pass 1/1 | runtime, no panel |
| C3-213 | Review | Start Review Charts from a results list | NOT ON /CHARTS | none | n/a | n/a |
| C3-214 | Review | Step next or previous in a review (mobile only at this commit) | NOT ON /CHARTS | none | n/a | n/a |
| C3-215 | Review | Open the review feed card (mobile only) | NOT ON /CHARTS | none | n/a | n/a |
| C3-216 | Company dock | Switch dock tab | MISSING | none | n/a | none |
| C3-217 | Company dock | Open or collapse the dock | MISSING | none | n/a | none |
| C3-218 | Company dock | Search company info | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-219 | Company dock | Open ETF holdings | MISSING | none | n/a | none |
| C3-220 | Company dock | Pick a leveraged or inverse ETF | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-221 | Workspace | Open the Agent | BLOCKED | none | n/a | none |
| C3-222 | Workspace | Change a widget's UCT theme section | MISSING | none | n/a | none |
| C3-223 | Workspace | Toggle the journal shortcut (Ctrl+Alt+J) | UNMAPPED | none | n/a | none |
| C1-176 | Right-click | Send chart to Journal | MISSING | none | n/a | none |
| C1-177 | Right-click | Send chart to Journal, choose where | MISSING | none | n/a | none |
| C1-178 | Right-click | Ask AI about the symbol on a bar | MISSING | none | n/a | none |
| C1-179 | Right-click | Add widget, floating at the click | MISSING | none | n/a | none |
