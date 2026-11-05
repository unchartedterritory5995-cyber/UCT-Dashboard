# Charts visual teaching status

Companion to `docs/agent/CHARTS_COVERAGE_MATRIX.md`. VERIFIED means a walkthrough ran in a real headless browser on the local Agent harness with fixture data, not on production. Generated 2026-11-05 at agent/pl/teach-coverage-2 7bd9c09289.

# Charts teach matrix

One row per action ID in the three inventory files. Generated from real-mouse runs on the agent harness (real ChartsWorkspace and Agent panel, headless Chrome, synthetic bars), not from reading code.

- VERIFIED: in the browser, a "how do I…" ran the walkthrough and the gold ring sat on the real control for this action (the run clicked it, except where noted in the evidence key).
- IMPLEMENTED / UNVERIFIED: a walkthrough covers it, but this exact control was not exercised in the browser.
- MISSING: no walkthrough yet.
- BLOCKED: cannot be guided as things stand; the reason is in the row.

Counts: VERIFIED 238 · IMPLEMENTED / UNVERIFIED 33 · MISSING 164 · BLOCKED 64 (of 499)

| Part | VERIFIED | IMPLEMENTED / UNVERIFIED | MISSING | BLOCKED |
|---|---|---|---|---|
| C1 | 118 | 6 | 35 | 16 |
| C2 | 35 | 9 | 44 | 13 |
| C3 | 85 | 18 | 85 | 35 |

| ID | Area | Action | Teach status | Guide feature | Browser evidence |
|---|---|---|---|---|---|
| C1-001 | Symbol | Change ticker by search pick | VERIFIED | symbol | Browser: basic.symbol |
| C1-002 | Symbol | Type-to-search on focused chart | VERIFIED | symbol | Browser: basic.symbol |
| C1-003 | Symbol | Filter search by category chip | MISSING |  | No walkthrough. |
| C1-004 | Symbol | Open a free-typed symbol with no result row | VERIFIED | symbol | Browser: basic.symbol |
| C1-005 | Symbol | Flag current ticker (Shift+F) | VERIFIED | chartView | Browser: key.flag |
| C1-006 | Timeframe | Pick preset timeframe on bar | VERIFIED | timeframe | Browser: basic.timeframe |
| C1-007 | Timeframe | Pick from full timeframe menu | VERIFIED | timeframe | Browser: basic.timeframe |
| C1-008 | Timeframe | Add custom interval | VERIFIED | timeframeCustom | Browser: basic.timeframeCustom |
| C1-009 | Timeframe | Delete custom interval | IMPLEMENTED / UNVERIFIED | panelAction | Row built and its fallback proved; the harness does not keep a custom interval, so the ✕ never rendered to ring. |
| C1-010 | Timeframe | Star a favourite timeframe | VERIFIED | panelAction | Browser: tf.star |
| C1-011 | Timeframe | Timeframe keys with repeat-press cycle | VERIFIED | timeframe | Browser: basic.timeframe |
| C1-012 | Timeframe | Change timeframe from right-click | BLOCKED |  | The inventory read this from StockChart's app-wide menu. On /charts the right-click goes to ChartWidget's own menu, which has no such row, so there is no control to teach here. |
| C1-013 | Chart type | Choose chart type in settings | VERIFIED | chartType | Browser: basic.chartType |
| C1-014 | Chart type | Choose chart type from right-click | BLOCKED |  | The inventory read this from StockChart's app-wide menu. On /charts the right-click goes to ChartWidget's own menu, which has no such row, so there is no control to teach here. |
| C1-015 | Chart type | Breadth Line/Candles quick toggle | MISSING |  | No walkthrough. |
| C1-016 | Chart type | Heikin Ashi candles | MISSING |  | No walkthrough. |
| C1-017 | Chart type | Candle colour mode | VERIFIED | chartSetting | Browser: set.colorMode |
| C1-018 | Chart type | Thin bars | VERIFIED | chartSetting | Browser: set.thin |
| C1-019 | Session | Regular/extended on intraday | VERIFIED | chartView | Browser: view.sessionIntraday |
| C1-020 | Session | Regular/extended on D/W/M | VERIFIED | chartView | Browser: view.session |
| C1-021 | Session | Extended hours from price-axis menu | BLOCKED |  | The inventory read this from StockChart's app-wide menu. On /charts the right-click goes to ChartWidget's own menu, which has no such row, so there is no control to teach here. |
| C1-022 | Scale | Arithmetic/log/percent from menu | VERIFIED | chartView | Browser: view.scale |
| C1-023 | Scale | Toggle log (Shift+L) | VERIFIED | chartView | Browser: key.log, view.scale |
| C1-024 | Scale | Invert scale (Alt+I) | VERIFIED | chartView | Browser: key.invert |
| C1-025 | Scale | Auto-scale | VERIFIED | chartView | Browser: key.auto |
| C1-026 | Scale | Drag price axis to compress | BLOCKED |  | A drag on the axis with no stable element; would need a data-guide on the price scale and a way to confirm it. |
| C1-027 | View | Reset view | VERIFIED | chartMenu | Browser: menu.reset |
| C1-028 | View | Zoom in/out (+/-) | VERIFIED | chartView | Browser: key.zoom |
| C1-029 | View | Range buttons (3M/6M/YTD/1Y/5Y) | VERIFIED | chartView | Browser: view.range, view.rangeClick |
| C1-030 | Go to date | Type a date in Time Navigator | VERIFIED | goToDate | Browser: goToDate |
| C1-031 | Go to date | Pick date or year in calendar | VERIFIED | goToDate | Browser: goToDate |
| C1-032 | Go to date | Step one bar back/forward | MISSING |  | No walkthrough. |
| C1-033 | Go to date | Open date box (Alt+G) | VERIFIED | goToDate | Browser: goToDate |
| C1-034 | Compare | Add a symbol | VERIFIED | compare | Browser: compare |
| C1-035 | Compare | Add a whole group | VERIFIED | compareAction | Browser: cmp.group |
| C1-036 | Compare | Remove one symbol | VERIFIED | compareAction | Browser: cmp.remove |
| C1-037 | Compare | Remove a group | IMPLEMENTED / UNVERIFIED | compareAction | Row built; the harness has no group list for Compare, so no group was on the panel. |
| C1-038 | Compare | Clear all comparisons | VERIFIED | compareAction | Browser: cmp.clear |
| C1-039 | Compare | Same/new scale per symbol | VERIFIED | compareAction | Browser: cmp.scale |
| C1-040 | Compare | Same/new scale for a group | IMPLEMENTED / UNVERIFIED | compareAction | Row built; the harness has no group list for Compare, so no group was on the panel. |
| C1-041 | Compare | Group only (hide base) | VERIFIED | compareAction | Browser: cmp.only |
| C1-042 | Replay | Start from a date | VERIFIED | replay | Browser: replay.full |
| C1-043 | Replay | Choose replay timeframe | VERIFIED | replay | Browser: replay.full |
| C1-044 | Replay | Pick the cutoff on the chart | BLOCKED |  | Picking on the chart while replay arms it; the date box teaches the same outcome. |
| C1-045 | Replay | Exit replay | VERIFIED | panelAction | Browser: replay.exit |
| C1-046 | Replay | Legacy bar replay play/step/speed/scrub | BLOCKED |  | Reachability on /charts unconfirmed in the inventory: not verified to exist. |
| C1-047 | Settings | Toggle grid | VERIFIED | chartSetting | Browser: setting.grid.visible |
| C1-048 | Settings | Solid/gradient background | VERIFIED | chartSetting | Browser: setting.bgMode |
| C1-049 | Settings | Solid background colour | VERIFIED | chartSetting | Browser: set.bg |
| C1-050 | Settings | Gradient colours | VERIFIED | chartSetting | Browser: setting.bgGradient.bottom, setting.bgGradient.top |
| C1-051 | Settings | Crosshair mode | VERIFIED | chartSetting | Browser: setting.crosshair.mode |
| C1-052 | Settings | Crosshair colour/width/style | VERIFIED | chartSetting | Browser: set.crossStyle |
| C1-053 | Settings | Magnet crosshair | MISSING |  | No walkthrough. |
| C1-054 | Settings | Price labels / MA labels | VERIFIED | chartSetting | Browser: set.price, set.ma |
| C1-055 | Settings | Scale text size and colour | VERIFIED | chartSetting | Browser: setting.textSize |
| C1-056 | Settings | Watermark on/off (Alt+Shift+W) | VERIFIED | chartSetting | Browser: setting.watermark.visible |
| C1-057 | Settings | Watermark lines | VERIFIED | chartSetting | Browser: setting.watermark.lines.*, setting.watermark.lines.interval, setting.watermark.lines.industry |
| C1-058 | Settings | Watermark alignment | MISSING |  | No walkthrough. |
| C1-059 | Settings | Watermark size/weight/colour/opacity | VERIFIED | chartSetting | Browser: setting.watermark.lines.*, setting.watermark.opacity, setting.watermark.lines.interval |
| C1-060 | Settings | Move watermark | MISSING |  | No walkthrough. |
| C1-061 | Settings | Reset watermark to centre | MISSING |  | No walkthrough. |
| C1-062 | Settings | Title shows ticker/company/both | VERIFIED | chartSetting | Browser: setting.header.titleMode |
| C1-063 | Settings | Day change beside title | VERIFIED | chartSetting | Browser: setting.header.showChange |
| C1-064 | Settings | Legend mode | VERIFIED | chartSetting | Browser: setting.header.legendMode |
| C1-065 | Settings | Legend bar-info fields | MISSING |  | No walkthrough. |
| C1-066 | Settings | Info-row fields | VERIFIED | panelAction | Browser: set.infoRow |
| C1-067 | Settings | Header colours | MISSING |  | No walkthrough. |
| C1-068 | Settings | Swing labels on/off and sensitivity | VERIFIED | chartSetting | Browser: setting.swingLabels.tintByType, setting.swingLabels.bg, setting.swingLabels.sensitivity |
| C1-069 | Settings | Swing label background, tint, colours | VERIFIED | chartSetting | Browser: setting.swingLabels.tintByType, setting.swingLabels.bg, setting.swingLabels.sensitivity |
| C1-070 | Settings | Event markers | VERIFIED | chartSetting | Browser: set.earn, set.div, set.splits, set.news, set.desk |
| C1-071 | Settings | Earnings beat/miss and IPO colours | IMPLEMENTED / UNVERIFIED | chartSetting | Browser reached the tab, not this exact row: setting.markers.desk, setting.markers.dividends |
| C1-072 | Settings | Prev-day lines on/off | VERIFIED | chartSetting | Browser: set.pd, set.pdHigh |
| C1-073 | Settings | Prev-day line style/width/colour | VERIFIED | chartSetting | Browser: set.pdStyle |
| C1-074 | Settings | Dark-pool levels | VERIFIED | chartSetting | Browser: setting.darkPool.enabled |
| C1-075 | Settings | Bar-close countdown (Shift+C) | VERIFIED | chartSetting | Browser: setting.countdown |
| C1-076 | Settings | Restore defaults | VERIFIED | chartSetting | Browser: set.reset |
| C1-077 | Settings | Save / delete a custom colour | MISSING |  | No walkthrough. |
| C1-078 | Settings | Light/dark palette (Shift+T) | MISSING |  | No walkthrough. |
| C1-079 | Themes | Apply a theme to one chart | VERIFIED | chartThemes | Browser: chartThemes |
| C1-080 | Themes | Apply a theme to all charts | VERIFIED | panelAction | Browser: theme.all |
| C1-081 | Themes | Apply a theme to all widgets | VERIFIED | panelAction | Browser: theme.widgets |
| C1-082 | Templates | Apply a template | VERIFIED | chartTemplate | Browser: basic.chartTemplate |
| C1-083 | Templates | Save a template | VERIFIED | chartTemplate | Browser: basic.chartTemplate |
| C1-084 | Templates | Delete a template | VERIFIED | chartTemplate | Browser: basic.chartTemplate |
| C1-085 | Templates | Copy another chart's look | BLOCKED |  | No human control located by the inventory. |
| C1-086 | Volume | Show/hide volume (Ctrl+V, menu) | VERIFIED | chartView | Browser: key.volume |
| C1-087 | Volume | Remove volume | VERIFIED | chartView | Browser: key.volume |
| C1-088 | Volume | Separate pane toggle | VERIFIED | chartMenu | Browser: menu.volume, menu.volumeShows |
| C1-089 | Volume | Resize volume pane by drag | VERIFIED | chartView | Browser: pane.divider |
| C1-090 | Volume | HVC highlight | VERIFIED | chartMenu | Browser: menu.volume, menu.volumeShows |
| C1-091 | Volume | Volume colours, MA, label, bar style | VERIFIED | chartMenu | Browser: menu.volume, menu.volumeShows |
| C1-092 | Volume | Overlay indicator on volume | MISSING |  | No walkthrough. |
| C1-093 | Panes | Move a pane | VERIFIED | indicatorManage | Browser: ind.arrange |
| C1-094 | Panes | Resize a pane | VERIFIED | chartView | Browser: pane.divider |
| C1-095 | Panes | Collapse a pane | BLOCKED |  | No pane-collapse control exists. |
| C1-096 | Crosshair | Copy price at the cursor | BLOCKED |  | Needs a live pointer position on the canvas; nothing to highlight. |
| C1-097 | Legend | Hide/show an indicator from chip | VERIFIED | legendChip | Browser: chip.hide |
| C1-098 | Legend | Display in another pane from chip | VERIFIED | legendChip | Browser: chip.move |
| C1-099 | Legend | Duplicate on chart | VERIFIED | legendChip | Browser: chip.dup |
| C1-100 | Legend | Show latest value in header | VERIFIED | legendChip | Browser: chip.value |
| C1-101 | Legend | Add alert from chip | VERIFIED | legendChip | Browser: chip.alert |
| C1-102 | Legend | Delete indicator from chip | VERIFIED | legendChip | Browser: chip.delete |
| C1-103 | Legend | Hide all indicators (Alt+Shift+I) | VERIFIED | chartView | Browser: key.hideAll |
| C1-104 | Legend | Toggle RSI/MACD/BB/VWAP chord | VERIFIED | chartView | Browser: key.rsi |
| C1-105 | Legend | Toggle moving averages (Ctrl+M) | VERIFIED | chartView | Browser: key.ma |
| C1-106 | Measure | Measure on the chart | VERIFIED | drawing | Browser: tool.measure |
| C1-107 | Measure | Bars & Time | VERIFIED | drawing | Browser: tool.dateRange |
| C1-108 | Measure | Price range | MISSING |  | No walkthrough. |
| C1-109 | Measure | Price Move | VERIFIED | drawing | Browser: tool.advance |
| C1-110 | Share | Open share popover (Alt+S) | VERIFIED | chartView | Browser: view.share |
| C1-111 | Share | Download PNG | MISSING |  | No walkthrough. |
| C1-112 | Share | Copy image | MISSING |  | No walkthrough. |
| C1-113 | Share | Copy share link | MISSING |  | No walkthrough. |
| C1-114 | Alerts | Price alert at the cursor (Alt+N) | VERIFIED | chartMenu | Browser: menu.setAlert |
| C1-115 | Alerts | Alert on a line, following it | VERIFIED | drawingEdit | Browser: draw.alert |
| C1-116 | Alerts | Alert at a line's fixed level | VERIFIED | drawingEdit | Browser: draw.alert |
| C1-117 | Alerts | Alert on a fib level | MISSING |  | No walkthrough. |
| C1-118 | Alerts | Position alerts (three lines) | MISSING |  | No walkthrough. |
| C1-119 | Alerts | Pause/resume indicator alert | IMPLEMENTED / UNVERIFIED | alertIndicator | Walkthrough reaches the panel holding this control; no step on this exact control was run in the browser. |
| C1-120 | Alerts | Delete indicator alert | IMPLEMENTED / UNVERIFIED | alertIndicator | Walkthrough reaches the panel holding this control; no step on this exact control was run in the browser. |
| C1-121 | Alerts | Move a level line | VERIFIED | drawingEdit | Browser: draw.move, draw.moveReal |
| C1-122 | Right-click | Draw line at clicked price | BLOCKED |  | The inventory read this from StockChart's app-wide menu. On /charts the right-click goes to ChartWidget's own menu, which has no such row, so there is no control to teach here. The Horizontal Line tool teaches the same outcome (drawing: tool.horizontal). |
| C1-123 | Right-click | Add indicator from menu | VERIFIED | chartView | Browser: key.addInd |
| C1-124 | Right-click | Open indicator settings | BLOCKED |  | The inventory read this from StockChart's app-wide menu. On /charts the right-click goes to ChartWidget's own menu, which has no such row, so there is no control to teach here. A chip's Edit in Indicators teaches the same outcome (chip.edit). |
| C1-125 | Right-click | Clear all drawings | VERIFIED | chartMenu | Browser: menu.clearDrawings |
| C1-126 | Right-click | Hide all drawings | VERIFIED | hideDrawings | Browser: basic.hideDrawings |
| C1-127 | Settings door | Open chart settings (Alt+,, gear) | VERIFIED | settings | Browser: basic.settings |
| C1-128 | Drawing | Trendline | VERIFIED | drawing | Browser: tool.trendline |
| C1-129 | Drawing | Ray | BLOCKED |  | No toolbar button or shortcut exists for Ray: only a render case. Nothing to point at. |
| C1-130 | Drawing | Extended line | VERIFIED | drawing | Browser: tool.extended |
| C1-131 | Drawing | Horizontal line | VERIFIED | drawing | Browser: tool.horizontal |
| C1-132 | Drawing | Horizontal ray | VERIFIED | drawing | Browser: tool.hray |
| C1-133 | Drawing | Vertical line | VERIFIED | drawing | Browser: tool.vertical |
| C1-134 | Drawing | Rectangle | VERIFIED | drawing | Browser: tool.rect |
| C1-135 | Drawing | Circle | VERIFIED | drawing | Browser: tool.circle |
| C1-136 | Drawing | Arrow | VERIFIED | drawing | Browser: tool.arrow |
| C1-137 | Drawing | Fib retracement | VERIFIED | drawing | Browser: tool.fib |
| C1-138 | Drawing | Fib extension | VERIFIED | drawing | Browser: tool.fibext |
| C1-139 | Drawing | Pitchfork | VERIFIED | drawing | Browser: tool.pitchfork |
| C1-140 | Drawing | Parallel channel | VERIFIED | drawing | Browser: tool.channel |
| C1-141 | Drawing | Cup curve | VERIFIED | drawing | Browser: tool.cup |
| C1-142 | Drawing | Anchored VWAP | VERIFIED | drawing | Browser: tool.avwap |
| C1-143 | Drawing | Text note | VERIFIED | drawing | Browser: tool.text |
| C1-144 | Drawing | Position calculator | VERIFIED | drawing | Browser: tool.position |
| C1-145 | Drawing | Eraser | VERIFIED | drawingEdit | Browser: draw.erase |
| C1-146 | Drawing | Delete selected (Del, button) | VERIFIED | drawingEdit | Browser: draw.delete |
| C1-147 | Drawing | Recolour | VERIFIED | drawingEdit | Browser: draw.color |
| C1-148 | Drawing | Width and line style | VERIFIED | drawingEdit | Browser: draw.width |
| C1-149 | Drawing | Fill and border | MISSING |  | No walkthrough. |
| C1-150 | Drawing | Text font, size, bold, italic, background | MISSING |  | No walkthrough. |
| C1-151 | Drawing | Fib levels and fills | VERIFIED | drawingEdit | Browser: draw.fib |
| C1-152 | Drawing | Reset fib | MISSING |  | No walkthrough. |
| C1-153 | Drawing | Measure-label options | MISSING |  | No walkthrough. |
| C1-154 | Drawing | Price label on a line | MISSING |  | No walkthrough. |
| C1-155 | Drawing | Edit anchors | VERIFIED | drawingEdit | Browser: draw.move, draw.moveReal |
| C1-156 | Drawing | Make horizontal | MISSING |  | No walkthrough. |
| C1-157 | Drawing | Duplicate | MISSING |  | No walkthrough. |
| C1-158 | Drawing | Lock/unlock | VERIFIED | drawingEdit | Browser: draw.lock |
| C1-159 | Drawing | Hide/show one | VERIFIED | drawingEdit | Browser: draw.hide |
| C1-160 | Drawing | Save as default | MISSING |  | No walkthrough. |
| C1-161 | Drawing | Reorder (front/back) | MISSING |  | No walkthrough. |
| C1-162 | Drawing | Undo/redo a drawing | VERIFIED | drawingEdit | Browser: draw.undo |
| C1-163 | Drawing | Magnet for drawing | MISSING |  | No walkthrough. |
| C1-164 | Drawing | Repeat drawing mode | MISSING |  | No walkthrough. |
| C1-165 | Drawing | Customise tool favourites | MISSING |  | No walkthrough. |
| C1-166 | Drawing | Nudge selected with arrows | BLOCKED |  | Keyboard-only: no on-screen control to highlight. |
| C1-167 | Boards | Switch drawing board | MISSING |  | No walkthrough. |
| C1-168 | Boards | Create a board | MISSING |  | No walkthrough. |
| C1-169 | Boards | Rename a board | MISSING |  | No walkthrough. |
| C1-170 | Boards | Delete a board | MISSING |  | No walkthrough. |
| C1-171 | Keyboard | Add ticker to watchlist (Alt+Q) | VERIFIED | chartView | Browser: key.addList |
| C1-172 | Keyboard | Add indicator dialog (Alt+Shift+A) | VERIFIED | chartView | Browser: key.addInd |
| C1-173 | Keyboard | Cycle grid layout (Alt+\\) | BLOCKED |  | Keyboard-only: no on-screen control to highlight. |
| C1-174 | Keyboard | Keyboard help (?) | BLOCKED |  | Keyboard-only: no on-screen control to highlight. |
| C1-175 | Keyboard | Escape to cursor / cancel | BLOCKED |  | Keyboard-only: no on-screen control to highlight. |
| C2-001 | Picker | Open indicator library | VERIFIED | indicators | Browser: add.browser |
| C2-002 | Picker | Search indicators by name or purpose | VERIFIED | indicators | Browser: add.browser |
| C2-003 | Picker | Browse by category | IMPLEMENTED / UNVERIFIED | indicators | Walkthrough reaches the panel holding this control; no step on this exact control was run in the browser. |
| C2-004 | Add | Add built-in indicator | VERIFIED | indicators | Browser: add.browser |
| C2-005 | Add | Add with chosen settings | IMPLEMENTED / UNVERIFIED | indicators | indicators walkthrough reaches the add surface; picking settings before Add was not run. |
| C2-006 | Add | Add another copy with defaults | IMPLEMENTED / UNVERIFIED | indicators | indicators walkthrough reaches the add surface; Add another was not run. |
| C2-007 | Add | Add own saved indicator | MISSING |  | Not built: needs a saved definition on the account, which the harness has none of. |
| C2-008 | Add | Add a symbol as a data series from search | MISSING |  | Not built: the search result row for a symbol needs live search results. |
| C2-009 | Add | Add economic series | MISSING |  | No walkthrough. |
| C2-010 | Add | Keyboard chord toggles RSI, MACD, BB, VWAP | MISSING |  | No walkthrough. |
| C2-011 | Add | Enable classic overlay average | MISSING |  | No walkthrough. |
| C2-012 | Add | Add Volume Profile | VERIFIED | indicators | Browser: ind.volumeProfile |
| C2-013 | Add | Toggle Chart IQ pattern recognition | MISSING |  | No walkthrough. |
| C2-014 | Remove | Delete indicator from legend | VERIFIED | legendChip | Browser: chip.delete |
| C2-015 | Remove | Delete from Chart Settings | VERIFIED | indicatorManage | Browser: ind.remove |
| C2-016 | Remove | Delete classic average row | VERIFIED | legendChip | Browser: chip.deleteMa |
| C2-017 | Remove | Remove an unavailable indicator | MISSING |  | No walkthrough. |
| C2-018 | Visibility | Hide indicator | VERIFIED | legendChip | Browser: chip.hide |
| C2-019 | Visibility | Show indicator | VERIFIED | legendChip | Browser: chip.hide |
| C2-020 | Visibility | Hide or show volume | VERIFIED | chartView | Browser: key.volume |
| C2-021 | Visibility | Limit to chosen timeframes | VERIFIED | indicatorEdit | Browser: field.__visibility__ |
| C2-022 | Read | See what is on a chart | VERIFIED | indicatorManage | Browser: ind.list |
| C2-023 | Read | Read About text | VERIFIED | legendChip | Browser: chip.about |
| C2-024 | Inputs | Change numeric setting | VERIFIED | indicatorEdit | Browser: field.period |
| C2-025 | Inputs | Change select setting (MA type, source) | VERIFIED | indicatorEdit | Browser: field.maType |
| C2-026 | Inputs | Flip a toggle setting | MISSING |  | indicatorEdit reaches the inspector; no toggle-type input was run. |
| C2-027 | Inputs | Edit session input | MISSING |  | No walkthrough. |
| C2-028 | Inputs | Cancel settings, roll back all edits | MISSING |  | No walkthrough. |
| C2-029 | Inputs | Set calculation timeframe | VERIFIED | indicatorEdit | Browser: field.__timeframe__ |
| C2-030 | Style | Change line colour | VERIFIED | indicatorColor | Browser: color.browser |
| C2-031 | Style | Change histogram up / down colours | VERIFIED | indicatorColor | Browser: color.macd |
| C2-032 | Style | Change line width | VERIFIED | indicatorEdit | Browser: field.lineWidth |
| C2-033 | Style | Change line style | VERIFIED | indicatorEdit | Browser: field.lineStyle |
| C2-034 | Style | Change plot style | VERIFIED | indicatorManage | Browser: ind.plotStyle |
| C2-035 | Style | Toggle overlap candles | MISSING |  | No walkthrough. |
| C2-036 | Placement | Move to price, volume or own pane | VERIFIED | indicatorEdit | Browser: field.__display__ |
| C2-037 | Placement | Move into another indicator's pane | VERIFIED | legendChip | Browser: chip.move |
| C2-038 | Panes | Reorder pane | VERIFIED | indicatorManage | Browser: ind.arrange |
| C2-039 | Panes | Resize pane by divider | BLOCKED |  | The divider control was not located, and it has no data-guide; a drag with no way to confirm it. Needs an attribute on the pane separator. |
| C2-040 | Panes | Reorder series within a pane | MISSING |  | No walkthrough. |
| C2-041 | Legend | Show latest value in header | VERIFIED | legendChip | Browser: chip.value |
| C2-042 | Legend | Duplicate on chart | VERIFIED | legendChip | Browser: chip.dup |
| C2-043 | Legend | Create custom copy | VERIFIED | legendChip | Browser: chip.copy |
| C2-044 | Legend | Open Modify with UCT Intelligence | IMPLEMENTED / UNVERIFIED | legendChip | Row built and the card now says it needs your own indicator; the harness has no user definition to prove it on. |
| C2-045 | Legend | Open Edit formula | MISSING |  | No walkthrough. |
| C2-046 | Legend | Apply script accuracy upgrade | BLOCKED |  | Shown only for imported scripts with a known mismatch: not reachable on demand to verify. |
| C2-047 | Legend | Report mismatch with TradingView | BLOCKED |  | Shown only for imported scripts with a known mismatch: not reachable on demand to verify. |
| C2-048 | Undo | Indicator undo and redo buttons | VERIFIED | indicatorManage | Browser: ind.history |
| C2-049 | Copy | Copy indicators to another chart | BLOCKED |  | No dedicated control exists; the nearest route is indicator templates. |
| C2-050 | Copy | Accept or refuse a shared chart's indicators | MISSING |  | No walkthrough. |
| C2-051 | Templates | Save indicator template | BLOCKED |  | The bar is behind VITE_INDICATOR_TEMPLATES_ENABLED and renders nothing without it, so there is no control to point at. The chart template walkthrough covers saving a whole look. |
| C2-052 | Templates | Apply indicator template | BLOCKED |  | The bar is behind VITE_INDICATOR_TEMPLATES_ENABLED and renders nothing without it, so there is no control to point at. The chart template walkthrough covers saving a whole look. |
| C2-053 | Templates | Delete indicator template | MISSING |  | No walkthrough. |
| C2-054 | Templates | List indicator templates | BLOCKED |  | The bar is behind VITE_INDICATOR_TEMPLATES_ENABLED and renders nothing without it, so there is no control to point at. The chart template walkthrough covers saving a whole look. |
| C2-055 | Create | Open Create Indicator | MISSING |  | No walkthrough. |
| C2-056 | Create | Describe an indicator, get a draft | VERIFIED | indicatorManage | Browser: ind.create |
| C2-057 | Create | Refine draft by conversation | VERIFIED | indicatorManage | Browser: ind.create |
| C2-058 | Create | Answer the builder's choice question | MISSING |  | No walkthrough. |
| C2-059 | Create | Undo a draft step | BLOCKED |  | This happens in the Agent conversation itself. The guide runs inside the Agent panel, so it has no control of its own to point at. |
| C2-060 | Create | Preview draft on chart | BLOCKED |  | This happens in the Agent conversation itself. The guide runs inside the Agent panel, so it has no control of its own to point at. |
| C2-061 | Create | Save draft, acknowledge warnings | BLOCKED |  | This happens in the Agent conversation itself. The guide runs inside the Agent panel, so it has no control of its own to point at. |
| C2-062 | Create | Discard draft | BLOCKED |  | This happens in the Agent conversation itself. The guide runs inside the Agent panel, so it has no control of its own to point at. |
| C2-063 | Create | Keep draft and close | MISSING |  | No walkthrough. |
| C2-064 | Builder | Build by conditions | MISSING |  | Not built: Formula Builder family. On /charts Create Indicator opens the Agent, so the builder needs its own door proved first. |
| C2-065 | Builder | Group conditions, any or all | MISSING |  | No walkthrough. |
| C2-066 | Builder | Enter a formula | MISSING |  | Not built: Formula Builder family (see C2-064). |
| C2-067 | Builder | Add or remove member input | MISSING |  | No walkthrough. |
| C2-068 | Builder | Add, remove or restyle output plot | MISSING |  | No walkthrough. |
| C2-069 | Builder | Set placement and levels | MISSING |  | Not built: Formula Builder family (see C2-064). |
| C2-070 | Builder | Set signal markers | MISSING |  | Not built: Formula Builder family (see C2-064). |
| C2-071 | Builder | Colour candles or background on a signal | MISSING |  | Not built: Formula Builder family (see C2-064). |
| C2-072 | Builder | Name the draft | BLOCKED |  | The control was not located by the inventory. |
| C2-073 | Builder | Ask for an alert from the builder | MISSING |  | Not built: Formula Builder family (see C2-064). |
| C2-074 | Builder | Run Evidence tab | MISSING |  | No walkthrough. |
| C2-075 | Builder | Use a starter | MISSING |  | No walkthrough. |
| C2-076 | Import | Paste Pine or thinkScript | MISSING |  | Not built: Formula Builder family (see C2-064). |
| C2-077 | Import | Apply import suggestion | MISSING |  | No walkthrough. |
| C2-078 | Import | Change script settings | MISSING |  | No walkthrough. |
| C2-079 | Import | Turn script output into a screen | MISSING |  | No walkthrough. |
| C2-080 | Image | Read an indicator from a screenshot | MISSING |  | No walkthrough. |
| C2-081 | Image | Accept image candidate | MISSING |  | No walkthrough. |
| C2-082 | Saved | Open saved definition to edit | MISSING |  | Not built: needs a saved definition (see C2-007). |
| C2-083 | Saved | Delete saved definition | MISSING |  | Not built: needs a saved definition (see C2-007). |
| C2-084 | Saved | Share a definition by link | MISSING |  | No walkthrough. |
| C2-085 | Saved | Publish to or withdraw from library | MISSING |  | No walkthrough. |
| C2-086 | Saved | Install from a share link | MISSING |  | No walkthrough. |
| C2-087 | Saved | Restore an older version | MISSING |  | No walkthrough. |
| C2-088 | Alerts | Open indicator alerts popover | VERIFIED | alertIndicator | Browser: alert.indicator, alert.form |
| C2-089 | Alerts | Create threshold alert | VERIFIED | alertIndicator | Browser: alert.indicator, alert.form |
| C2-090 | Alerts | Create MA cross alert | VERIFIED | alertAction | Browser: alert.cross |
| C2-091 | Alerts | Choose plot on a multi-line indicator | IMPLEMENTED / UNVERIFIED | alertIndicator | Row built with its fallback; the harness catalog has one single-line indicator, so the Plot list never showed. |
| C2-092 | Alerts | Alert on a yes/no signal with trigger policy | IMPLEMENTED / UNVERIFIED | alertAction | Row built with its fallback; the harness catalog has no yes/no signal indicator, so the list never showed. |
| C2-093 | Alerts | Alert on another timeframe | VERIFIED | alertAction | Browser: alert.timeframe |
| C2-094 | Alerts | Limit alert to this chart | MISSING |  | No walkthrough. |
| C2-095 | Alerts | Override alert inputs | MISSING |  | No walkthrough. |
| C2-096 | Alerts | Choose which instance | IMPLEMENTED / UNVERIFIED | alertIndicator | Row built with its fallback; not run with two copies of one indicator. |
| C2-097 | Alerts | List indicator alerts | VERIFIED | alertAction | Browser: alert.list |
| C2-098 | Alerts | Pause or resume alert | IMPLEMENTED / UNVERIFIED | alertAction | Row built with its fallback; the harness alert list stayed empty, so the switch never rendered. |
| C2-099 | Alerts | Delete alert | IMPLEMENTED / UNVERIFIED | alertAction | Row built with its fallback; the harness alert list stayed empty, so the × never rendered. |
| C2-100 | Alerts | See why an alert cannot fire | MISSING |  | Not built: needs an alert the catalog cannot serve. |
| C2-101 | Mobile | Edit an average or study on phone | BLOCKED |  | Phone shell only; the guide runs on the desktop Charts workspace. |
| C3-001 | Board | Add a widget from Widgets ▾ | VERIFIED | widgetAdd | Browser: widgetAdd.news |
| C3-002 | Board | Drag a widget to move it, or nudge it | VERIFIED | widgetMove | Browser: widgetMove |
| C3-003 | Board | Drag a widget edge or merged seam to resize | VERIFIED | widgetResize | Browser: resize.browser, resize.merged |
| C3-004 | Board | Close a widget | VERIFIED | widgetHeader | Browser: header.close |
| C3-005 | Board | Merge or unmerge widgets (lock board, drop borders) | VERIFIED | widgetMerge | Browser: widgetMerge |
| C3-006 | Link | Cycle a widget's link colour | VERIFIED | link | Browser: basic.link |
| C3-007 | Link | Change a tool panel's colour group | MISSING |  | No walkthrough. |
| C3-008 | Float | Float a widget over another | VERIFIED | widgetHeader | Browser: header.float |
| C3-009 | Float | Drag or resize a floating widget | BLOCKED |  | Needs a floating widget on the board first; reachable after Float, but not verified on the harness. |
| C3-010 | Float | Dock a floating widget back into the grid | BLOCKED |  | Needs a floating widget on the board first; reachable after Float, but not verified on the harness. |
| C3-011 | Float | Move a floating widget into another widget's tabs | BLOCKED |  | Needs a floating widget on the board first; reachable after Float, but not verified on the harness. |
| C3-012 | Popout | Pop a widget into its own window | VERIFIED | widgetHeader | Browser: header.popOut |
| C3-013 | Popout | Pop out the whole layout | IMPLEMENTED / UNVERIFIED | layouts | Walkthrough reaches the panel holding this control; no step on this exact control was run in the browser. |
| C3-014 | Popout | Dock a popped widget or layout back | MISSING |  | No walkthrough. |
| C3-015 | Popout | Close a popped widget | MISSING |  | No walkthrough. |
| C3-016 | Widget tabs | Add a widget as a tab | VERIFIED | widgetHeader | Browser: header.addTab |
| C3-017 | Widget tabs | Switch a widget tab | VERIFIED | tabAction | Browser: tab.widget |
| C3-018 | Widget tabs | Rename a widget tab | MISSING |  | No walkthrough. |
| C3-019 | Widget tabs | Close a widget tab | VERIFIED | tabAction | Browser: tab.widgetClose |
| C3-020 | Chart tabs | Add a chart tab | VERIFIED | chartTab | Browser: chartTab |
| C3-021 | Chart tabs | Switch a chart tab | VERIFIED | tabAction | Browser: tab.chart |
| C3-022 | Chart tabs | Rename a chart tab | MISSING |  | No walkthrough. |
| C3-023 | Chart tabs | Change a chart tab's link colour | MISSING |  | No walkthrough. |
| C3-024 | Chart tabs | Close a chart tab | VERIFIED | tabAction | Browser: tab.chartClose |
| C3-025 | Layout Dock | Open a saved layout | VERIFIED | layouts | Browser: basic.layouts |
| C3-026 | Layout Dock | See which layout is open | VERIFIED | layoutAction | Browser: ly.active |
| C3-027 | Layout Dock | Undo a layout switch from the toast | VERIFIED | layoutAction | Browser: ly.undo |
| C3-028 | Layout Dock | Create a new layout from the dock | VERIFIED | layouts | Browser: basic.layouts |
| C3-029 | Layout Dock | Start a new blank board from the Layouts menu | IMPLEMENTED / UNVERIFIED | layouts | Walkthrough reaches the panel holding this control; no step on this exact control was run in the browser. |
| C3-030 | Layout Dock | Save the open layout | VERIFIED | layoutSave | Browser: save.browser |
| C3-031 | Layout Dock | Save as a new layout | VERIFIED | layoutSave | Browser: save.browser |
| C3-032 | Layout Dock | Save a layout as a global template (admin) | MISSING |  | No walkthrough. |
| C3-033 | Layout Dock | Rename a layout | VERIFIED | layoutAction | Browser: ly.rename |
| C3-034 | Layout Dock | Duplicate a layout | MISSING |  | No walkthrough. |
| C3-035 | Layout Dock | Delete a layout | MISSING |  | No walkthrough. |
| C3-036 | Layout Dock | Delete a prebuilt template (admin) | MISSING |  | No walkthrough. |
| C3-037 | Layout Dock | Pin a layout to the bar | MISSING |  | No walkthrough. |
| C3-038 | Layout Dock | Reorder layouts on the bar | MISSING |  | No walkthrough. |
| C3-039 | Layout Dock | Remove a layout from the bar | MISSING |  | No walkthrough. |
| C3-040 | Layout Dock | View a layout's version history | MISSING |  | No walkthrough. |
| C3-041 | Layout Dock | Restore a layout version | VERIFIED | layoutAction | Browser: ly.history |
| C3-042 | Multi Chart | Enter a preset grid | VERIFIED | multiChart | Browser: grid.browser |
| C3-043 | Multi Chart | Apply a custom rows × columns grid | IMPLEMENTED / UNVERIFIED | multiChart | Walkthrough reaches the panel holding this control; no step on this exact control was run in the browser. |
| C3-044 | Multi Chart | Exit Multi Chart | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-045 | Multi Chart | Toggle crosshair sync | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-046 | Multi Chart | Toggle time-range sync | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-047 | Multi Chart | Turn on Groups mode | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-048 | Multi Chart | Pick a group for the grid | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-049 | Multi Chart | Step or switch group | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-050 | Multi Chart | Refresh the group | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-051 | Multi Chart | Exit Groups | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-052 | Multi Chart | Apply a saved grid | BLOCKED |  | Saved grids appear in the Multi Chart menu; saving one needs grid mode, where the Agent refuses every request. |
| C3-053 | Multi Chart | Save a grid | BLOCKED |  | Saved grids appear in the Multi Chart menu; saving one needs grid mode, where the Agent refuses every request. |
| C3-054 | Multi Chart | Save a grid as global (admin) | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-055 | Multi Chart | Delete a saved grid | BLOCKED |  | Saved grids appear in the Multi Chart menu; saving one needs grid mode, where the Agent refuses every request. |
| C3-056 | Multi Chart | Set a cell's timeframe | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-057 | Multi Chart | Set a cell's chart style | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-058 | Multi Chart | Toggle a cell's session | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-059 | Multi Chart | Reset a cell to my chart | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-060 | Multi Chart | Maximize or restore a cell | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-061 | Multi Chart | Open shared grid settings | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-062 | Multi Chart | Set an alert from a cell | BLOCKED |  | Multi Chart mode only, and the Agent refuses every request there ("Switch out of Multi Chart"), so no walkthrough can start. Fixing it means useAgent.js, which is off limits. |
| C3-063 | Watchlist | Open a list in a widget (own) | VERIFIED | watchlists | Browser: defects.watchlists |
| C3-064 | Watchlist | Open a prebuilt or community list | VERIFIED | watchlistAction | Browser: wl.prebuilt |
| C3-065 | Watchlist | Open the Flagged list | VERIFIED | watchlistAction | Browser: wl.flagged |
| C3-066 | Watchlist | Open a colour-tag list | MISSING |  | No walkthrough. |
| C3-067 | Watchlist | Go back to the list picker | MISSING |  | No walkthrough. |
| C3-068 | Watchlist | Click a row to load the symbol | VERIFIED | watchlistAction | Browser: wl.pick |
| C3-069 | Watchlist | Walk the list with arrow keys or space | VERIFIED | watchlistAction | Browser: wl.walk, wl.walkReal |
| C3-070 | Watchlist | Create a list | VERIFIED | watchlistCreate | Browser: basic.wlCreate |
| C3-071 | Watchlist | Create a list from a template | MISSING |  | No walkthrough. |
| C3-072 | Watchlist | Save a community list to My Lists | MISSING |  | No walkthrough. |
| C3-073 | Watchlist | Rename a list | BLOCKED |  | Only on the Watchlists page: a Watchlist widget on /charts opens one list in pick mode, with no list header and no column gear. |
| C3-074 | Watchlist | Rename the Flagged list | MISSING |  | No walkthrough. |
| C3-075 | Watchlist | Delete a list | MISSING |  | No walkthrough. |
| C3-076 | Watchlist | Add a symbol | VERIFIED | watchlistAddSymbol | Browser: basic.wlAddSymbol |
| C3-077 | Watchlist | Add to Flagged | VERIFIED | watchlistAction | Browser: wl.flagged, basic.wlAddSymbol |
| C3-078 | Watchlist | Flag or unflag a row (star) | VERIFIED | watchlistAction | Browser: wl.flag |
| C3-079 | Watchlist | Remove a symbol | VERIFIED | watchlistAction | Browser: wl.remove |
| C3-080 | Watchlist | Remove all starred symbols from a list | MISSING |  | No walkthrough. |
| C3-081 | Watchlist | Reorder symbols by hand | BLOCKED |  | No reachable control: the reorder handler has no caller (inventory D2). |
| C3-082 | Watchlist | Sort by a column | VERIFIED | watchlistAction | Browser: wl.sort |
| C3-083 | Watchlist | Show or hide a column | VERIFIED | watchlistAction | Browser: wl.columns |
| C3-084 | Watchlist | Apply a column preset | BLOCKED |  | Only on the Watchlists page: a Watchlist widget on /charts opens one list in pick mode, with no list header and no column gear. |
| C3-085 | Watchlist | Reorder columns by drag | MISSING |  | No walkthrough. |
| C3-086 | Watchlist | Resize a column | MISSING |  | No walkthrough. |
| C3-087 | Watchlist | Reset columns | MISSING |  | No walkthrough. |
| C3-088 | Watchlist | Write or edit a ticker note | VERIFIED | watchlistAction | Browser: wl.notes |
| C3-089 | Watchlist | Expand or collapse a list | MISSING |  | No walkthrough. |
| C3-090 | Watchlist | Tag a symbol with a colour | BLOCKED |  | The tag menu lives in the app-wide chart menu, which /charts does not use. There is no tag control on the workspace. |
| C3-091 | Watchlist | Share a tag colour or Flagged | MISSING |  | No walkthrough. |
| C3-092 | Watchlist | Make a list public | MISSING |  | No walkthrough. |
| C3-093 | Watchlist | Mark a list prebuilt (admin) | MISSING |  | No walkthrough. |
| C3-094 | Watchlist | Copy a list to the clipboard | MISSING |  | No walkthrough. |
| C3-095 | Watchlist | Export a list as CSV or Excel | MISSING |  | No walkthrough. |
| C3-096 | Watchlist | Import tickers | MISSING |  | No walkthrough. |
| C3-097 | Watchlist | View or restore list version history | MISSING |  | No walkthrough. |
| C3-098 | Watchlist | Set a price alert from a row | VERIFIED | watchlistAction | Browser: wl.alert, wl.alertBox |
| C3-099 | Watchlist | Delete an alert from the row popover | IMPLEMENTED / UNVERIFIED | watchlistAction | wl.alertBox proved the box; the × needs an alert on that ticker, which the harness stub did not reach. |
| C3-100 | Watchlist | Open Full Research or AI from a row | VERIFIED | watchlistAction | Browser: wl.research |
| C3-101 | Watchlist | Compare from a row | VERIFIED | watchlistAction | Browser: wl.compare |
| C3-102 | Watchlist | Open a row's attention facts | MISSING |  | No walkthrough. |
| C3-103 | Watchlist | Change list appearance (canvas, text, tint) | VERIFIED | widgetSettings | Browser: gear.watchlist |
| C3-104 | Watchlist | Save or load a watchlist look | MISSING |  | No walkthrough. |
| C3-105 | Watchlist | Track or freeze a linked scan or theme | MISSING |  | Not built: the offer shows only on a list linked to a scan or theme. |
| C3-106 | Watchlist | Use a saved screen as a list | MISSING |  | Not built: needs a saved screen on the account. |
| C3-107 | Scanner | Pick a preset scan | VERIFIED | widgetAction | Browser: w.scanPick |
| C3-108 | Scanner | Leave a scan, back to the picker | MISSING |  | No walkthrough. |
| C3-109 | Scanner | Search the preset list | MISSING |  | No walkthrough. |
| C3-110 | Scanner | Read a scan's conditions | VERIFIED | widgetAction | Browser: w.scanCriteria |
| C3-111 | Scanner | Read a scan's results | VERIFIED | widgetAction | Browser: w.scanRead |
| C3-112 | Scanner | Refresh a scan | MISSING |  | No walkthrough. |
| C3-113 | Scanner | Sort a scan | VERIFIED | widgetAction | Browser: w.scanSort |
| C3-114 | Scanner | Change scan columns | VERIFIED | widgetAction | Browser: w.scanSort |
| C3-115 | Scanner | Create a scanner in the workspace | BLOCKED |  | The product shows a coming-soon panel / read-only conditions: there is no action to teach. |
| C3-116 | Scanner | Modify a preset scan's conditions | BLOCKED |  | The product shows a coming-soon panel / read-only conditions: there is no action to teach. |
| C3-117 | Scanner | Open an AI Search scan in the builder and edit conditions | MISSING |  | Not built: the card shows only after a real AI Search answer. |
| C3-118 | Scanner | Run or refine a screen from the workspace chat | BLOCKED |  | This happens in the Agent conversation itself. The guide runs inside the Agent panel, so it has no control of its own to point at. |
| C3-119 | Scanner | Save a screen run from the workspace | BLOCKED |  | This happens in the Agent conversation itself. The guide runs inside the Agent panel, so it has no control of its own to point at. |
| C3-120 | Scanner | Send a scan to Journal | IMPLEMENTED / UNVERIFIED | widgetAction | Row built; the button shows only once a scan has symbols, and the harness has no scan results. |
| C3-121 | Volume Surge | Choose what the scanner watches | VERIFIED | widgetAction | Browser: w.vol |
| C3-122 | Volume Surge | Create, rename or delete a scope list | MISSING |  | No walkthrough. |
| C3-123 | Volume Surge | Add a ticker to a scope list | MISSING |  | No walkthrough. |
| C3-124 | Volume Surge | Set thresholds (RVOL, burst, move, $ floor) | VERIFIED | widgetSettings | Browser: gear.volumeScan |
| C3-125 | Volume Surge | Toggle logos | MISSING |  | No walkthrough. |
| C3-126 | Volume Surge | Click a row or remove it from the list | MISSING |  | No walkthrough. |
| C3-127 | Alerts | See my alerts | VERIFIED | widgetAction | Browser: w.alerts |
| C3-128 | Alerts | Create a price alert | VERIFIED | alertPrice | Browser: alertp.browser |
| C3-129 | Alerts | Delete an alert | VERIFIED | widgetAction | Browser: w.alertsDel |
| C3-130 | Alerts | Click an alert to load the symbol | VERIFIED | widgetAction | Browser: w.alerts |
| C3-131 | Alerts | Change Alerts widget appearance | VERIFIED | widgetSettings | Browser: gear.alerts |
| C3-132 | Alerts | Send alerts to Journal | MISSING |  | No walkthrough. |
| C3-133 | News | Filter catalysts up, down or all | VERIFIED | widgetAction | Browser: w.news |
| C3-134 | News | Read stored headlines for a symbol | VERIFIED | widgetAction | Browser: w.news2 |
| C3-135 | News | Place a headline on the chart | MISSING |  | No walkthrough. |
| C3-136 | News | Change News widget appearance | VERIFIED | widgetSettings | Browser: gear.news |
| C3-137 | News | Send the feed to Journal | MISSING |  | No walkthrough. |
| C3-138 | TE News | Search headlines | VERIFIED | widgetAction | Browser: w.te |
| C3-139 | TE News | Filter by category, linked symbol or watchlist | VERIFIED | widgetAction | Browser: w.te2 |
| C3-140 | TE News | Apply, rename or delete a filter preset | MISSING |  | No walkthrough. |
| C3-141 | TE News | Save or unsave a headline | MISSING |  | No walkthrough. |
| C3-142 | TE News | Add or edit a headline note | MISSING |  | No walkthrough. |
| C3-143 | TE News | Manage collections | MISSING |  | No walkthrough. |
| C3-144 | TE News | Add a headline's ticker to a watchlist | MISSING |  | No walkthrough. |
| C3-145 | TE News | Explain a headline or ask about it | IMPLEMENTED / UNVERIFIED | widgetAction | Row built; Explain shows on a headline, and the harness feed is empty. |
| C3-146 | TE News | Jump to live or browse a past day | MISSING |  | No walkthrough. |
| C3-147 | TE News | Send a headline to Notebook | MISSING |  | No walkthrough. |
| C3-148 | Calendar | Step days in the widget | VERIFIED | widgetAction | Browser: w.cal |
| C3-149 | Calendar | Ask who reports on a day from Charts | VERIFIED | widgetAction | Browser: w.cal2 |
| C3-150 | Calendar | Ask when a stock reports from Charts | IMPLEMENTED / UNVERIFIED | dockAction | Row built with its fallback; adding Company Info was not proved in the harness. |
| C3-151 | Calendar | Filter economic events by stars | IMPLEMENTED / UNVERIFIED | widgetAction | Row built with its fallback; the harness has no economic events. |
| C3-152 | Calendar | Toggle the TBD section | MISSING |  | No walkthrough. |
| C3-153 | Calendar | Sort earnings columns | MISSING |  | No walkthrough. |
| C3-154 | Calendar | Show all earnings in a section | MISSING |  | No walkthrough. |
| C3-155 | Calendar | Click an earnings row | MISSING |  | Not built: needs earnings rows, and the harness has none. |
| C3-156 | Calendar | Send a day to Journal | MISSING |  | No walkthrough. |
| C3-157 | Breadth | Read breadth tiles | VERIFIED | widgetAction | Browser: w.breadth |
| C3-158 | Breadth | Add or remove a reading | VERIFIED | widgetAction | Browser: w.breadthAdd |
| C3-159 | Breadth | Switch heatmap and ratio view | MISSING |  | No walkthrough. |
| C3-160 | Breadth | Change tile style | VERIFIED | widgetSettings | Browser: gear.breadth |
| C3-161 | Breadth | Change palette, intensity or background | VERIFIED | widgetSettings | Browser: gear.breadth |
| C3-162 | Breadth | Drill into a reading | IMPLEMENTED / UNVERIFIED | widgetAction | The sentence is on the widget, not a tile: the harness has no breadth data, so no tile rendered to ring. |
| C3-163 | Breadth | Send a snapshot to Journal | MISSING |  | No walkthrough. |
| C3-164 | Options Flow | Switch market or symbol scope | VERIFIED | widgetAction | Browser: w.flow |
| C3-165 | Options Flow | Switch the lead view | VERIFIED | widgetAction | Browser: w.flow2 |
| C3-166 | Options Flow | Set filters (premium, call/put, type, direction) | VERIFIED | widgetAction | Browser: w.flow3 |
| C3-167 | Options Flow | Read the flow | VERIFIED | widgetAction | Browser: w.flow4 |
| C3-168 | Options Flow | Click a flow row | IMPLEMENTED / UNVERIFIED | widgetAction | The sentence is on the widget, not a row: the harness has no flow rows. |
| C3-169 | Themes | Pick a period or ranking | VERIFIED | widgetAction | Browser: w.themes |
| C3-170 | Themes | Flip sort direction | VERIFIED | widgetAction | Browser: w.themes |
| C3-171 | Themes | Switch today basis | VERIFIED | widgetAction | Browser: w.themeBasis |
| C3-172 | Themes | Open a theme or pick a holding | VERIFIED | widgetAction | Browser: w.themes4 |
| C3-173 | Themes | Search themes or tickers | VERIFIED | widgetAction | Browser: w.themes2 |
| C3-174 | Themes | Pick, rename or delete a theme set | IMPLEMENTED / UNVERIFIED | widgetAction | Row built; useThemeSets reports the feature off here, so the control is not on screen. |
| C3-175 | Themes | Edit a set (add, hide, reset, custom theme) | MISSING |  | No walkthrough. |
| C3-176 | Themes | Add or remove a stock in a theme | MISSING |  | No walkthrough. |
| C3-177 | Themes | Send the ranking to Journal | MISSING |  | No walkthrough. |
| C3-178 | Fundamentals | Switch view | IMPLEMENTED / UNVERIFIED | widgetAction | Row built with its fallback; the harness has no fundamentals for the symbol. |
| C3-179 | Fundamentals | Read the numbers | VERIFIED | widgetAction | Browser: w.fund2 |
| C3-180 | Fundamentals | Change appearance or send to Journal | IMPLEMENTED / UNVERIFIED | widgetSettings | Browser failed or not run: gear.fundamentals |
| C3-181 | Profile | Read profile and earnings table | VERIFIED | widgetAction | Browser: w.profile |
| C3-182 | Profile | Click a peer ticker | MISSING |  | No walkthrough. |
| C3-183 | Indexes | Hide or restore an index | MISSING |  | No walkthrough. |
| C3-184 | Indexes | Send levels to Journal | MISSING |  | No walkthrough. |
| C3-185 | Market Context | Read market context | BLOCKED |  | Market Context is not in Widgets ▾ (WORKSPACE_PICKER_TYPES leaves it out), so a board can only hold it if a layout already does. No path to teach. |
| C3-186 | Market Context | Send to Journal | MISSING |  | No walkthrough. |
| C3-187 | NH/NL | Add or remove a universe | VERIFIED | widgetAction | Browser: w.nhnl |
| C3-188 | NH/NL | Switch universe tab | VERIFIED | widgetAction | Browser: w.nhnl |
| C3-189 | NH/NL | Expand a row or pick a symbol | MISSING |  | No walkthrough. |
| C3-190 | NH/NL | Toggle logos, font, background | VERIFIED | widgetSettings | Browser: gear.newHighsLows |
| C3-191 | H/L Pulse | Change Pulse settings | VERIFIED | widgetSettings | Browser: gear.nhnlPulse |
| C3-192 | Market Map | Pick or remove a universe | IMPLEMENTED / UNVERIFIED | widgetAction | Row built; the harness Market Map has no valid universe data. |
| C3-193 | Market Map | Pick X, Y or size axis | IMPLEMENTED / UNVERIFIED | widgetAction | Row built; the harness Market Map has no valid universe data. |
| C3-194 | Market Map | Follow the linked list | MISSING |  | No walkthrough. |
| C3-195 | Market Map | Cycle labels or zoom | MISSING |  | No walkthrough. |
| C3-196 | AI Search | Ask a question or follow one up | VERIFIED | widgetAction | Browser: w.ai |
| C3-197 | AI Search | Change ask mode, stop or retry | MISSING |  | No walkthrough. |
| C3-198 | AI Search | Save, reopen or remove an answer | MISSING |  | No walkthrough. |
| C3-199 | AI Search | Copy or speak an answer | MISSING |  | No walkthrough. |
| C3-200 | AI Search | Send the conversation to Journal | MISSING |  | No walkthrough. |
| C3-201 | Notebook | Open or search a note | VERIFIED | widgetAction | Browser: w.note2 |
| C3-202 | Notebook | Create a note | VERIFIED | widgetAction | Browser: w.note |
| C3-203 | Notebook | Edit a note's title or body | MISSING |  | No walkthrough. |
| C3-204 | Notebook | Browse folders | MISSING |  | No walkthrough. |
| C3-205 | Period Sort | Start a custom-period sort | VERIFIED | periodSort | Browser: periodSort |
| C3-206 | Period Sort | Choose grouping, replay and start mark | MISSING |  | No walkthrough. |
| C3-207 | Period Sort | Dock the panel or add it as a tab | MISSING |  | No walkthrough. |
| C3-208 | Period Sort | Refresh results | MISSING |  | No walkthrough. |
| C3-209 | Replay | Start replay at a date | VERIFIED | replay | Browser: replay.full |
| C3-210 | Replay | Exit replay | VERIFIED | panelAction | Browser: replay.exit |
| C3-211 | Replay | Pick the cutoff by clicking the chart | MISSING |  | No walkthrough. |
| C3-212 | Replay | Set replay timeframe | VERIFIED | replay | Browser: replay.full |
| C3-213 | Review | Start Review Charts from a results list | BLOCKED |  | Not on the desktop Charts workspace. |
| C3-214 | Review | Step next or previous in a review (mobile only at this commit) | BLOCKED |  | Not on the desktop Charts workspace. |
| C3-215 | Review | Open the review feed card (mobile only) | BLOCKED |  | Not on the desktop Charts workspace. |
| C3-216 | Company dock | Switch dock tab | IMPLEMENTED / UNVERIFIED | dockAction | Row built with its fallback; adding Company Info was not proved in the harness. |
| C3-217 | Company dock | Open or collapse the dock | IMPLEMENTED / UNVERIFIED | dockAction | Row built with its fallback; adding Company Info was not proved in the harness. |
| C3-218 | Company dock | Search company info | MISSING |  | No walkthrough. |
| C3-219 | Company dock | Open ETF holdings | IMPLEMENTED / UNVERIFIED | dockAction | Row built with its fallback; the harness does not report SPY as an ETF, so the button never rendered. |
| C3-220 | Company dock | Pick a leveraged or inverse ETF | MISSING |  | No walkthrough. |
| C3-221 | Workspace | Open the Agent | BLOCKED |  | The guide runs inside the Agent panel: it cannot teach opening it. |
| C3-222 | Workspace | Change a widget's UCT theme section | MISSING |  | No walkthrough. |
| C3-223 | Workspace | Toggle the journal shortcut (Ctrl+Alt+J) | MISSING |  | No walkthrough. |
