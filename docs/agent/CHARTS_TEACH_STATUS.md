# Charts visual teaching status

> **BROWSER-MOCK-MODEL.** Every count below is from the local agent harness with a scripted model. It is not production evidence and not gate evidence.

Generated 2026-11-10 by `app/src/testing/agent/guide/status.mjs` from a committed browser run (`teach.mjs`, README in that folder). LOCAL native Windows Node, headless Chrome on the agent harness (real ChartsWorkspace and Agent panel, synthetic bars, fixture lists and layouts, one price-alert fixture), BROWSER-MOCK-MODEL / SIMULATED. Not production evidence.

**Method.** Each inventory row (`CHARTS_COVERAGE_MATRIX.md`) is asked in its own words: "how do I " + its Human action, or "show me how to " + its Example phrase. A row becomes a browser case only when those words reach the walkthrough a person assigned to it (`expected.json`: the 2026-11-05 matrix's Guide feature column, plus catalog controls reviewed by hand 2026-11-07). The runner types the words into the real composer and follows the card with real mouse input. VERIFIED means the walkthrough reached its last step with the gold ring on that step's own control, not on a fallback. A family walkthrough (one feature, many rows) is matched at the feature.

This replaces the 2026-11-05 count (283 VERIFIED). Its runner was never committed, so it could not be reproduced. That count is kept per row as "11-05" for reference only.

| Part | VERIFIED | ROUTED / BROWSER FAILED | ASSIGNED / NOT REACHED | NO ASSIGNED WALKTHROUGH | NO WALKTHROUGH | NOT IN PRODUCT |
|---|---|---|---|---|---|---|
| C1 | 134 | 3 | 13 | 14 | 11 | 0 |
| C2 | 44 | 6 | 16 | 23 | 12 | 0 |
| C3 | 136 | 15 | 24 | 26 | 16 | 6 |
| All | 314 | 24 | 53 | 63 | 39 | 6 |

- VERIFIED: proved in the browser, as above.
- ROUTED / BROWSER FAILED: the words reach the right walkthrough, but the browser run did not end on its control. Routing only; the reason is in the row.
- ASSIGNED / NOT REACHED: a walkthrough is assigned, but the inventory's own words do not reach it. Other words may.
- NO ASSIGNED WALKTHROUGH: the words reach some walkthrough, or a question, that no person has judged right for this row.
- NO WALKTHROUGH: nothing.
- NOT IN PRODUCT: the shipped product has no such control (notInProduct.json, with the reason in the row): not a missing walkthrough.

| ID | Area | Action | Teach status | Assigned walkthrough | Evidence | 11-05 |
|---|---|---|---|---|---|---|
| C1-001 | Symbol | Change ticker by search pick | VERIFIED | symbol | Browser 2026-11-10: "how do I change ticker by search pick" → ring on the last step's control | VERIFIED |
| C1-002 | Symbol | Type-to-search on focused chart | ASSIGNED / NOT REACHED | symbol | Assigned symbol; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-003 | Symbol | Filter search by category chip | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C1-004 | Symbol | Open a free-typed symbol with no result row | ASSIGNED / NOT REACHED | symbol | Assigned symbol; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-005 | Symbol | Flag current ticker (Shift+F) | VERIFIED | chartView | Browser 2026-11-10: "how do I flag current ticker (Shift+F)" → ring on the last step's control | VERIFIED |
| C1-006 | Timeframe | Pick preset timeframe on bar | VERIFIED | timeframe | Browser 2026-11-10: "how do I pick preset timeframe on bar" → ring on the last step's control | VERIFIED |
| C1-007 | Timeframe | Pick from full timeframe menu | VERIFIED | timeframe | Browser 2026-11-10: "how do I pick from full timeframe menu" → ring on the last step's control | VERIFIED |
| C1-008 | Timeframe | Add custom interval | VERIFIED | timeframeCustom | Browser 2026-11-10: "how do I add custom interval" → ring on the last step's control | VERIFIED |
| C1-009 | Timeframe | Delete custom interval | VERIFIED | panelAction | Browser 2026-11-10: "how do I delete custom interval" → ring on the last step's control | VERIFIED |
| C1-010 | Timeframe | Star a favourite timeframe | VERIFIED | panelAction | Browser 2026-11-10: "how do I star a favourite timeframe" → ring on the last step's control | VERIFIED |
| C1-011 | Timeframe | Timeframe keys with repeat-press cycle | VERIFIED | timeframe | Browser 2026-11-10: "how do I timeframe keys with repeat-press cycle" → ring on the last step's control | VERIFIED |
| C1-012 | Timeframe | Change timeframe from right-click | NO ASSIGNED WALKTHROUGH |  | The words reach timeframe; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-013 | Chart type | Choose chart type in settings | VERIFIED | chartType | Browser 2026-11-10: "how do I choose chart type in settings" → ring on the last step's control | VERIFIED |
| C1-014 | Chart type | Choose chart type from right-click | NO ASSIGNED WALKTHROUGH |  | The words reach chartType; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-015 | Chart type | Breadth Line/Candles quick toggle | NO ASSIGNED WALKTHROUGH |  | The words reach settings; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-016 | Chart type | Heikin Ashi candles | NO ASSIGNED WALKTHROUGH |  | The words reach settings; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-017 | Chart type | Candle colour mode | VERIFIED | chartSetting | Browser 2026-11-10: "how do I candle colour mode" → ring on the last step's control | VERIFIED |
| C1-018 | Chart type | Thin bars | VERIFIED | chartSetting | Browser 2026-11-10: "how do I thin bars" → ring on the last step's control | VERIFIED |
| C1-019 | Session | Regular/extended on intraday | VERIFIED | chartView | Browser 2026-11-10: "how do I regular/extended on intraday" → ring on the last step's control | VERIFIED |
| C1-020 | Session | Regular/extended on D/W/M | VERIFIED | chartView | Browser 2026-11-10: "how do I regular/extended on D/W/M" → ring on the last step's control | VERIFIED |
| C1-021 | Session | Extended hours from price-axis menu | NO ASSIGNED WALKTHROUGH |  | The words reach chartView; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-022 | Scale | Arithmetic/log/percent from menu | VERIFIED | chartView | Browser 2026-11-10: "show me how to log scale" → ring on the last step's control | VERIFIED |
| C1-023 | Scale | Toggle log (Shift+L) | ASSIGNED / NOT REACHED | chartView | Assigned chartView; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-024 | Scale | Invert scale (Alt+I) | VERIFIED | chartView | Browser 2026-11-10: "how do I invert scale (Alt+I)" → ring on the last step's control | VERIFIED |
| C1-025 | Scale | Auto-scale | VERIFIED | chartView | Browser 2026-11-10: "how do I auto-scale" → ring on the last step's control | VERIFIED |
| C1-026 | Scale | Drag price axis to compress | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C1-027 | View | Reset view | VERIFIED | chartMenu | Browser 2026-11-10: "how do I reset view" → ring on the last step's control | VERIFIED |
| C1-028 | View | Zoom in/out (+/-) | VERIFIED | chartView | Browser 2026-11-10: "how do I zoom in/out (+/-)" → ring on the last step's control | VERIFIED |
| C1-029 | View | Range buttons (3M/6M/YTD/1Y/5Y) | VERIFIED | chartView | Browser 2026-11-10: "how do I range buttons (3M/6M/YTD/1Y/5Y)" → ring on the last step's control | VERIFIED |
| C1-030 | Go to date | Type a date in Time Navigator | VERIFIED | goToDate | Browser 2026-11-10: "how do I type a date in Time Navigator" → ring on the last step's control | VERIFIED |
| C1-031 | Go to date | Pick date or year in calendar | VERIFIED | goToDate | Browser 2026-11-10: "show me how to go to 2020" → ring on the last step's control | VERIFIED |
| C1-032 | Go to date | Step one bar back/forward | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C1-033 | Go to date | Open date box (Alt+G) | ASSIGNED / NOT REACHED | goToDate | Assigned goToDate; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-034 | Compare | Add a symbol | VERIFIED | compare | Browser 2026-11-10: "show me how to compare with AMD" → ring on the last step's control | VERIFIED |
| C1-035 | Compare | Add a whole group | VERIFIED | compareAction | Browser 2026-11-10: "show me how to compare against the semis group" → ring on the last step's control | VERIFIED |
| C1-036 | Compare | Remove one symbol | ASSIGNED / NOT REACHED | compareAction | Assigned compareAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-037 | Compare | Remove a group | VERIFIED | compareAction | Browser 2026-11-10: "show me how to remove the semis overlay" → ring on the last step's control | VERIFIED |
| C1-038 | Compare | Clear all comparisons | VERIFIED | compareAction | Browser 2026-11-10: "how do I clear all comparisons" → ring on the last step's control | VERIFIED |
| C1-039 | Compare | Same/new scale per symbol | VERIFIED | compareAction | Browser 2026-11-10: "how do I same/new scale per symbol" → ring on the last step's control | VERIFIED |
| C1-040 | Compare | Same/new scale for a group | VERIFIED | compareAction | Browser 2026-11-10: "how do I same/new scale for a group" → ring on the last step's control | VERIFIED |
| C1-041 | Compare | Group only (hide base) | VERIFIED | compareAction | Browser 2026-11-10: "show me how to show only the comparisons" → ring on the last step's control | VERIFIED |
| C1-042 | Replay | Start from a date | VERIFIED | replay | Browser 2026-11-10: "show me how to replay from Oct 15" → ring on the last step's control | VERIFIED |
| C1-043 | Replay | Choose replay timeframe | VERIFIED | replay | Browser 2026-11-10: "how do I choose replay timeframe" → ring on the last step's control | VERIFIED |
| C1-044 | Replay | Pick the cutoff on the chart | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C1-045 | Replay | Exit replay | ROUTED / BROWSER FAILED | panelAction | "how do I exit replay" reaches it; browser: last step shows its fallback: Replay isn’t running, so there’s nothing to exit. Exit replay shows here while it runs. | ROUTED / BROWSER FAILED |
| C1-046 | Replay | Legacy bar replay play/step/speed/scrub | NO ASSIGNED WALKTHROUGH |  | The words reach replay; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-047 | Settings | Toggle grid | VERIFIED | chartSetting | Browser 2026-11-10: "how do I toggle grid" → ring on the last step's control | VERIFIED |
| C1-048 | Settings | Solid/gradient background | VERIFIED | chartSetting | Browser 2026-11-10: "how do I solid/gradient background" → ring on the last step's control | VERIFIED |
| C1-049 | Settings | Solid background colour | VERIFIED | control: The chart’s background | Browser 2026-11-10: "how do I solid background colour" → ring on the last step's control | VERIFIED |
| C1-050 | Settings | Gradient colours | VERIFIED | chartSetting | Browser 2026-11-10: "how do I gradient colours" → ring on the last step's control | VERIFIED |
| C1-051 | Settings | Crosshair mode | VERIFIED | chartSetting | Browser 2026-11-10: "how do I crosshair mode" → ring on the last step's control | VERIFIED |
| C1-052 | Settings | Crosshair colour/width/style | VERIFIED | chartSetting | Browser 2026-11-10: "how do I crosshair colour/width/style" → ring on the last step's control | VERIFIED |
| C1-053 | Settings | Magnet crosshair | NO ASSIGNED WALKTHROUGH |  | The words reach chartSetting; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-054 | Settings | Price labels / MA labels | VERIFIED | chartSetting | Browser 2026-11-10: "how do I price labels / MA labels" → ring on the last step's control | VERIFIED |
| C1-055 | Settings | Scale text size and colour | VERIFIED | chartSetting | Browser 2026-11-10: "how do I scale text size and colour" → ring on the last step's control | VERIFIED |
| C1-056 | Settings | Watermark on/off (Alt+Shift+W) | VERIFIED | chartSetting | Browser 2026-11-10: "how do I watermark on/off (Alt+Shift+W)" → ring on the last step's control | VERIFIED |
| C1-057 | Settings | Watermark lines | VERIFIED | chartSetting | Browser 2026-11-10: "how do I watermark lines" → ring on the last step's control | VERIFIED |
| C1-058 | Settings | Watermark alignment | VERIFIED | control: Aligning the watermark | Browser 2026-11-10: "how do I watermark alignment" → ring on the last step's control | VERIFIED |
| C1-059 | Settings | Watermark size/weight/colour/opacity | VERIFIED | chartSetting | Browser 2026-11-10: "how do I watermark size/weight/colour/opacity" → ring on the last step's control | VERIFIED |
| C1-060 | Settings | Move watermark | VERIFIED | control: Moving the watermark | Browser 2026-11-10: "how do I move watermark" → ring on the last step's control | VERIFIED |
| C1-061 | Settings | Reset watermark to centre | VERIFIED | control: Centring the watermark | Browser 2026-11-10: "how do I reset watermark to centre" → ring on the last step's control | VERIFIED |
| C1-062 | Settings | Title shows ticker/company/both | VERIFIED | chartSetting | Browser 2026-11-10: "how do I title shows ticker/company/both" → ring on the last step's control | VERIFIED |
| C1-063 | Settings | Day change beside title | VERIFIED | chartSetting | Browser 2026-11-10: "how do I day change beside title" → ring on the last step's control | VERIFIED |
| C1-064 | Settings | Legend mode | VERIFIED | chartSetting | Browser 2026-11-10: "how do I legend mode" → ring on the last step's control | VERIFIED |
| C1-065 | Settings | Legend bar-info fields | VERIFIED | control: The legend’s bar values | Browser 2026-11-10: "how do I legend bar-info fields" → ring on the last step's control | VERIFIED |
| C1-066 | Settings | Info-row fields | ASSIGNED / NOT REACHED | panelAction | Assigned panelAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-067 | Settings | Header colours | VERIFIED | chartSetting: Changing Header colors | Browser 2026-11-10: "how do I header colours" → ring on the last step's control | VERIFIED |
| C1-068 | Settings | Swing labels on/off and sensitivity | VERIFIED | chartSetting | Browser 2026-11-10: "how do I swing labels on/off and sensitivity" → ring on the last step's control | VERIFIED |
| C1-069 | Settings | Swing label background, tint, colours | VERIFIED | chartSetting | Browser 2026-11-10: "how do I swing label background, tint, colours" → ring on the last step's control | VERIFIED |
| C1-070 | Settings | Event markers | VERIFIED | chartSetting | Browser 2026-11-10: "show me how to turn on earnings markers" → ring on the last step's control | VERIFIED |
| C1-071 | Settings | Earnings beat/miss and IPO colours | VERIFIED | chartSetting | Browser 2026-11-10: "how do I earnings beat/miss and IPO colours" → ring on the last step's control | VERIFIED |
| C1-072 | Settings | Prev-day lines on/off | VERIFIED | chartSetting | Browser 2026-11-10: "show me how to show the prior day high" → ring on the last step's control | VERIFIED |
| C1-073 | Settings | Prev-day line style/width/colour | VERIFIED | chartSetting | Browser 2026-11-10: "show me how to dash the prior day low" → ring on the last step's control | VERIFIED |
| C1-074 | Settings | Dark-pool levels | VERIFIED | chartSetting | Browser 2026-11-10: "how do I dark-pool levels" → ring on the last step's control | VERIFIED |
| C1-075 | Settings | Bar-close countdown (Shift+C) | VERIFIED | chartSetting | Browser 2026-11-10: "how do I bar-close countdown (Shift+C)" → ring on the last step's control | VERIFIED |
| C1-076 | Settings | Restore defaults | VERIFIED | panelAction: Restoring a chart’s defaults | Browser 2026-11-10: "how do I restore defaults" → ring on the last step's control | VERIFIED |
| C1-077 | Settings | Save / delete a custom colour | NO ASSIGNED WALKTHROUGH |  | The words reach settings; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-078 | Settings | Light/dark palette (Shift+T) | VERIFIED | chartView: Light or dark chart | Browser 2026-11-10: "how do I light/dark palette (Shift+T)" → ring on the last step's control | VERIFIED |
| C1-079 | Themes | Apply a theme to one chart | VERIFIED | chartThemes | Browser 2026-11-10: "how do I apply a theme to one chart" → ring on the last step's control | VERIFIED |
| C1-080 | Themes | Apply a theme to all charts | VERIFIED | panelAction | Browser 2026-11-10: "how do I apply a theme to all charts" → ring on the last step's control | VERIFIED |
| C1-081 | Themes | Apply a theme to all widgets | VERIFIED | panelAction | Browser 2026-11-10: "how do I apply a theme to all widgets" → ring on the last step's control | VERIFIED |
| C1-082 | Templates | Apply a template | VERIFIED | chartTemplate | Browser 2026-11-10: "how do I apply a template" → ring on the last step's control | VERIFIED |
| C1-083 | Templates | Save a template | VERIFIED | chartTemplate | Browser 2026-11-10: "how do I save a template" → ring on the last step's control | VERIFIED |
| C1-084 | Templates | Delete a template | VERIFIED | chartTemplate | Browser 2026-11-10: "how do I delete a template" → ring on the last step's control | VERIFIED |
| C1-085 | Templates | Copy another chart's look | NO ASSIGNED WALKTHROUGH |  | The words reach charts; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-086 | Volume | Show/hide volume (Ctrl+V, menu) | VERIFIED | chartView | Browser 2026-11-10: "how do I show/hide volume (Ctrl+V, menu)" → ring on the last step's control | VERIFIED |
| C1-087 | Volume | Remove volume | VERIFIED | chartView | Browser 2026-11-10: "how do I remove volume" → ring on the last step's control | VERIFIED |
| C1-088 | Volume | Separate pane toggle | VERIFIED | chartMenu | Browser 2026-11-10: "show me how to put volume in its own pane" → ring on the last step's control | VERIFIED |
| C1-089 | Volume | Resize volume pane by drag | VERIFIED | chartView | Browser 2026-11-10: "how do I resize volume pane by drag" → ring on the last step's control | VERIFIED |
| C1-090 | Volume | HVC highlight | VERIFIED | chartMenu | Browser 2026-11-10: "how do I hVC highlight" → ring on the last step's control | VERIFIED |
| C1-091 | Volume | Volume colours, MA, label, bar style | VERIFIED | chartMenu | Browser 2026-11-10: "how do I volume colours, MA, label, bar style" → ring on the last step's control | VERIFIED |
| C1-092 | Volume | Overlay indicator on volume | NO ASSIGNED WALKTHROUGH |  | The words reach indicators; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-093 | Panes | Move a pane | ASSIGNED / NOT REACHED | indicatorManage | Assigned indicatorManage; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-094 | Panes | Resize a pane | VERIFIED | chartView | Browser 2026-11-10: "how do I resize a pane" → ring on the last step's control | VERIFIED |
| C1-095 | Panes | Collapse a pane | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C1-096 | Crosshair | Copy price at the cursor | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C1-097 | Legend | Hide/show an indicator from chip | VERIFIED | legendChip | Browser 2026-11-10: "how do I hide/show an indicator from chip" → ring on the last step's control | VERIFIED |
| C1-098 | Legend | Display in another pane from chip | VERIFIED | legendChip | Browser 2026-11-10: "how do I display in another pane from chip" → ring on the last step's control | VERIFIED |
| C1-099 | Legend | Duplicate on chart | VERIFIED | legendChip | Browser 2026-11-10: "show me how to duplicate the 20 EMA" → ring on the last step's control | VERIFIED |
| C1-100 | Legend | Show latest value in header | VERIFIED | legendChip | Browser 2026-11-10: "show me how to show RSI value in the header" → ring on the last step's control | VERIFIED |
| C1-101 | Legend | Add alert from chip | VERIFIED | legendChip | Browser 2026-11-10: "how do I add alert from chip" → ring on the last step's control | VERIFIED |
| C1-102 | Legend | Delete indicator from chip | VERIFIED | legendChip | Browser 2026-11-10: "how do I delete indicator from chip" → ring on the last step's control | VERIFIED |
| C1-103 | Legend | Hide all indicators (Alt+Shift+I) | VERIFIED | chartView | Browser 2026-11-10: "how do I hide all indicators (Alt+Shift+I)" → ring on the last step's control | VERIFIED |
| C1-104 | Legend | Toggle RSI/MACD/BB/VWAP chord | ASSIGNED / NOT REACHED | chartView | Assigned chartView; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-105 | Legend | Toggle moving averages (Ctrl+M) | VERIFIED | chartView | Browser 2026-11-10: "how do I toggle moving averages (Ctrl+M)" → ring on the last step's control | VERIFIED |
| C1-106 | Measure | Measure on the chart | ASSIGNED / NOT REACHED | drawing | Assigned drawing; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-107 | Measure | Bars & Time | VERIFIED | drawing | Browser 2026-11-10: "how do I bars & Time" → ring on the last step's control | VERIFIED |
| C1-108 | Measure | Price range | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C1-109 | Measure | Price Move | VERIFIED | drawing | Browser 2026-11-10: "how do I price Move" → ring on the last step's control | VERIFIED |
| C1-110 | Share | Open share popover (Alt+S) | VERIFIED | chartView | Browser 2026-11-10: "how do I open share popover (Alt+S)" → ring on the last step's control | VERIFIED |
| C1-111 | Share | Download PNG | VERIFIED | control: Sharing: Download PNG | Browser 2026-11-10: "how do I download PNG" → ring on the last step's control | VERIFIED |
| C1-112 | Share | Copy image | VERIFIED | control: Sharing: Copy to Clipboard | Browser 2026-11-10: "how do I copy image" → ring on the last step's control | VERIFIED |
| C1-113 | Share | Copy share link | VERIFIED | control: Sharing: Copy Share URL | Browser 2026-11-10: "how do I copy share link" → ring on the last step's control | VERIFIED |
| C1-114 | Alerts | Price alert at the cursor (Alt+N) | ASSIGNED / NOT REACHED | chartMenu | Assigned chartMenu; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-115 | Alerts | Alert on a line, following it | VERIFIED | drawingEdit | Browser 2026-11-10: "how do I alert on a line, following it" → ring on the last step's control | VERIFIED |
| C1-116 | Alerts | Alert at a line's fixed level | VERIFIED | drawingEdit | Browser 2026-11-10: "how do I alert at a line's fixed level" → ring on the last step's control | VERIFIED |
| C1-117 | Alerts | Alert on a fib level | NO ASSIGNED WALKTHROUGH |  | The words reach alertPrice; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-118 | Alerts | Position alerts (three lines) | NO ASSIGNED WALKTHROUGH |  | The words reach drawingEdit; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-119 | Alerts | Pause/resume indicator alert | VERIFIED | alertAction: Pausing an indicator alert | Browser 2026-11-10: "how do I pause/resume indicator alert" → ring on the last step's control | VERIFIED |
| C1-120 | Alerts | Delete indicator alert | VERIFIED | alertAction: Deleting an indicator alert | Browser 2026-11-10: "how do I delete indicator alert" → ring on the last step's control | VERIFIED |
| C1-121 | Alerts | Move a level line | VERIFIED | drawingEdit | Browser 2026-11-10: "how do I move a level line" → ring on the last step's control | VERIFIED |
| C1-122 | Right-click | Draw line at clicked price | NO ASSIGNED WALKTHROUGH |  | The words reach drawing; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-123 | Right-click | Add indicator from menu | ASSIGNED / NOT REACHED | chartView | Assigned chartView; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-124 | Right-click | Open indicator settings | VERIFIED | indicatorEdit | Browser 2026-11-10: "how do I open indicator settings" → ring on the last step's control | VERIFIED |
| C1-125 | Right-click | Clear all drawings | VERIFIED | chartMenu | Browser 2026-11-10: "how do I clear all drawings" → ring on the last step's control | VERIFIED |
| C1-126 | Right-click | Hide all drawings | VERIFIED | hideDrawings | Browser 2026-11-10: "how do I hide all drawings" → ring on the last step's control | VERIFIED |
| C1-127 | Settings door | Open chart settings (Alt+,, gear) | VERIFIED | settings | Browser 2026-11-10: "how do I open chart settings (Alt+,, gear)" → ring on the last step's control | VERIFIED |
| C1-128 | Drawing | Trendline | VERIFIED | drawing | Browser 2026-11-10: "how do I trendline" → ring on the last step's control | VERIFIED |
| C1-129 | Drawing | Ray | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C1-130 | Drawing | Extended line | VERIFIED | drawing | Browser 2026-11-10: "how do I extended line" → ring on the last step's control | VERIFIED |
| C1-131 | Drawing | Horizontal line | VERIFIED | drawing | Browser 2026-11-10: "how do I horizontal line" → ring on the last step's control | VERIFIED |
| C1-132 | Drawing | Horizontal ray | VERIFIED | drawing | Browser 2026-11-10: "how do I horizontal ray" → ring on the last step's control | VERIFIED |
| C1-133 | Drawing | Vertical line | VERIFIED | drawing | Browser 2026-11-10: "how do I vertical line" → ring on the last step's control | VERIFIED |
| C1-134 | Drawing | Rectangle | VERIFIED | drawing | Browser 2026-11-10: "how do I rectangle" → ring on the last step's control | VERIFIED |
| C1-135 | Drawing | Circle | VERIFIED | drawing | Browser 2026-11-10: "how do I circle" → ring on the last step's control | VERIFIED |
| C1-136 | Drawing | Arrow | VERIFIED | drawing | Browser 2026-11-10: "how do I arrow" → ring on the last step's control | VERIFIED |
| C1-137 | Drawing | Fib retracement | VERIFIED | drawing | Browser 2026-11-10: "how do I fib retracement" → ring on the last step's control | VERIFIED |
| C1-138 | Drawing | Fib extension | VERIFIED | drawing | Browser 2026-11-10: "how do I fib extension" → ring on the last step's control | VERIFIED |
| C1-139 | Drawing | Pitchfork | VERIFIED | drawing | Browser 2026-11-10: "how do I pitchfork" → ring on the last step's control | VERIFIED |
| C1-140 | Drawing | Parallel channel | VERIFIED | drawing | Browser 2026-11-10: "how do I parallel channel" → ring on the last step's control | VERIFIED |
| C1-141 | Drawing | Cup curve | VERIFIED | drawing | Browser 2026-11-10: "how do I cup curve" → ring on the last step's control | VERIFIED |
| C1-142 | Drawing | Anchored VWAP | VERIFIED | drawing | Browser 2026-11-10: "how do I anchored VWAP" → ring on the last step's control | VERIFIED |
| C1-143 | Drawing | Text note | VERIFIED | drawing | Browser 2026-11-10: "how do I text note" → ring on the last step's control | VERIFIED |
| C1-144 | Drawing | Position calculator | VERIFIED | drawing | Browser 2026-11-10: "how do I position calculator" → ring on the last step's control | VERIFIED |
| C1-145 | Drawing | Eraser | VERIFIED | drawingEdit | Browser 2026-11-10: "how do I eraser" → ring on the last step's control | VERIFIED |
| C1-146 | Drawing | Delete selected (Del, button) | VERIFIED | drawingEdit | Browser 2026-11-10: "show me how to remove that trendline" → ring on the last step's control | VERIFIED |
| C1-147 | Drawing | Recolour | VERIFIED | drawingEdit | Browser 2026-11-10: "show me how to make that line pink" → ring on the last step's control | VERIFIED |
| C1-148 | Drawing | Width and line style | VERIFIED | drawingEdit | Browser 2026-11-10: "how do I width and line style" → ring on the last step's control | VERIFIED |
| C1-149 | Drawing | Fill and border | VERIFIED | control: A drawing’s Fill | Browser 2026-11-10: "show me how to shade that box blue" → ring on the last step's control | VERIFIED |
| C1-150 | Drawing | Text font, size, bold, italic, background | VERIFIED | control: A drawing’s Bold | Browser 2026-11-10: "show me how to make the note bold" → ring on the last step's control | VERIFIED |
| C1-151 | Drawing | Fib levels and fills | VERIFIED | drawingEdit | Browser 2026-11-10: "how do I fib levels and fills" → ring on the last step's control | VERIFIED |
| C1-152 | Drawing | Reset fib | ROUTED / BROWSER FAILED | control: A drawing’s Reset levels | "show me how to reset the fib levels" reaches it; browser: step 1: no point of the region it names opened the menu row it needs | ROUTED / BROWSER FAILED |
| C1-153 | Drawing | Measure-label options | ROUTED / BROWSER FAILED | control: A drawing’s Show bars | "show me how to hide bars on the measure" reaches it; browser: step 1: no point of the region it names opened the menu row it needs | ROUTED / BROWSER FAILED |
| C1-154 | Drawing | Price label on a line | VERIFIED | control: A drawing’s Show price label | Browser 2026-11-10: "show me how to show the price on that line" → ring on the last step's control | VERIFIED |
| C1-155 | Drawing | Edit anchors | VERIFIED | drawingEdit | Browser 2026-11-10: "how do I edit anchors" → ring on the last step's control | VERIFIED |
| C1-156 | Drawing | Make horizontal | VERIFIED | control: A drawing’s Make horizontal | Browser 2026-11-10: "show me how to flatten that line" → ring on the last step's control | VERIFIED |
| C1-157 | Drawing | Duplicate | VERIFIED | control: A drawing’s Duplicate | Browser 2026-11-10: "show me how to copy that line" → ring on the last step's control | VERIFIED |
| C1-158 | Drawing | Lock/unlock | VERIFIED | drawingEdit | Browser 2026-11-10: "show me how to lock that line" → ring on the last step's control | VERIFIED |
| C1-159 | Drawing | Hide/show one | VERIFIED | drawingEdit | Browser 2026-11-10: "show me how to hide that fib" → ring on the last step's control | VERIFIED |
| C1-160 | Drawing | Save as default | NO ASSIGNED WALKTHROUGH |  | The words reach control; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C1-161 | Drawing | Reorder (front/back) | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C1-162 | Drawing | Undo/redo a drawing | VERIFIED | drawingEdit | Browser 2026-11-10: "how do I undo/redo a drawing" → ring on the last step's control | VERIFIED |
| C1-163 | Drawing | Magnet for drawing | VERIFIED | control: The drawing magnet | Browser 2026-11-10: "how do I magnet for drawing" → ring on the last step's control | VERIFIED |
| C1-164 | Drawing | Repeat drawing mode | VERIFIED | control: Repeat drawing | Browser 2026-11-10: "how do I repeat drawing mode" → ring on the last step's control | VERIFIED |
| C1-165 | Drawing | Customise tool favourites | VERIFIED | control: Choosing your drawing tools | Browser 2026-11-10: "how do I customise tool favourites" → ring on the last step's control | VERIFIED |
| C1-166 | Drawing | Nudge selected with arrows | VERIFIED | control: Nudging a drawing from the keyboard | Browser 2026-11-10: "how do I nudge selected with arrows" → ring on the last step's control | VERIFIED |
| C1-167 | Boards | Switch drawing board | VERIFIED | control: Drawing boards: a board | Browser 2026-11-10: "how do I switch drawing board" → ring on the last step's control | VERIFIED |
| C1-168 | Boards | Create a board | VERIFIED | control: Drawing boards: New board | Browser 2026-11-10: "how do I create a board" → ring on the last step's control | VERIFIED |
| C1-169 | Boards | Rename a board | VERIFIED | control: Drawing boards: Rename | Browser 2026-11-10: "how do I rename a board" → ring on the last step's control | VERIFIED |
| C1-170 | Boards | Delete a board | VERIFIED | control: Drawing boards: Delete | Browser 2026-11-10: "how do I delete a board" → ring on the last step's control | VERIFIED |
| C1-171 | Keyboard | Add ticker to watchlist (Alt+Q) | ASSIGNED / NOT REACHED | chartView | Assigned chartView; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-172 | Keyboard | Add indicator dialog (Alt+Shift+A) | ASSIGNED / NOT REACHED | chartView | Assigned chartView; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C1-173 | Keyboard | Cycle grid layout (Alt+\\) | VERIFIED | multiChart | Browser 2026-11-10: "show me how to 2x2 grid" → ring on the last step's control | VERIFIED |
| C1-174 | Keyboard | Keyboard help (?) | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C1-175 | Keyboard | Escape to cursor / cancel | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-001 | Picker | Open indicator library | VERIFIED | indicators | Browser 2026-11-10: "how do I open indicator library" → ring on the last step's control | VERIFIED |
| C2-002 | Picker | Search indicators by name or purpose | VERIFIED | indicators | Browser 2026-11-10: "how do I search indicators by name or purpose" → ring on the last step's control | VERIFIED |
| C2-003 | Picker | Browse by category | VERIFIED | indicators | Browser 2026-11-10: "show me how to what momentum indicators do you have" → ring on the last step's control | VERIFIED |
| C2-004 | Add | Add built-in indicator | VERIFIED | indicators | Browser 2026-11-10: "how do I add built-in indicator" → ring on the last step's control | VERIFIED |
| C2-005 | Add | Add with chosen settings | VERIFIED | indicators | Browser 2026-11-10: "show me how to add a 20 EMA" → ring on the last step's control | VERIFIED |
| C2-006 | Add | Add another copy with defaults | VERIFIED | indicatorManage | Browser 2026-11-10: "show me how to add another 20 EMA" → ring on the last step's control | VERIFIED |
| C2-007 | Add | Add own saved indicator | ROUTED / BROWSER FAILED | indicatorManage | "how do I add own saved indicator" reaches it; browser: last step shows its fallback: You have no saved indicators yet. Search here, or use Create Indicator above. | ROUTED / BROWSER FAILED |
| C2-008 | Add | Add a symbol as a data series from search | VERIFIED | indicatorManage | Browser 2026-11-10: "how do I add a symbol as a data series from search" → ring on the last step's control | VERIFIED |
| C2-009 | Add | Add economic series | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-010 | Add | Keyboard chord toggles RSI, MACD, BB, VWAP | VERIFIED | chartView | Browser 2026-11-10: "how do I keyboard chord toggles RSI, MACD, BB, VWAP" → ring on the last step's control | VERIFIED |
| C2-011 | Add | Enable classic overlay average | VERIFIED | indicators: Adding MA | Browser 2026-11-10: "show me how to turn on moving average 3" → ring on the last step's control | VERIFIED |
| C2-012 | Add | Add Volume Profile | ASSIGNED / NOT REACHED | indicators | Assigned indicators; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-013 | Add | Toggle Chart IQ pattern recognition | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-014 | Remove | Delete indicator from legend | VERIFIED | legendChip | Browser 2026-11-10: "how do I delete indicator from legend" → ring on the last step's control | VERIFIED |
| C2-015 | Remove | Delete from Chart Settings | ASSIGNED / NOT REACHED | indicatorManage | Assigned indicatorManage; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-016 | Remove | Delete classic average row | VERIFIED | legendChip | Browser 2026-11-10: "show me how to remove the 9 EMA" → ring on the last step's control | VERIFIED |
| C2-017 | Remove | Remove an unavailable indicator | VERIFIED | legendChip: Removing an indicator | Browser 2026-11-10: "how do I remove an unavailable indicator" → ring on the last step's control | VERIFIED |
| C2-018 | Visibility | Hide indicator | VERIFIED | legendChip | Browser 2026-11-10: "how do I hide indicator" → ring on the last step's control | VERIFIED |
| C2-019 | Visibility | Show indicator | VERIFIED | legendChip | Browser 2026-11-10: "how do I show indicator" → ring on the last step's control | VERIFIED |
| C2-020 | Visibility | Hide or show volume | VERIFIED | chartView | Browser 2026-11-10: "how do I hide or show volume" → ring on the last step's control | VERIFIED |
| C2-021 | Visibility | Limit to chosen timeframes | ASSIGNED / NOT REACHED | indicatorEdit | Assigned indicatorEdit; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-022 | Read | See what is on a chart | VERIFIED | indicatorManage | Browser 2026-11-10: "show me how to what indicators are on this chart" → ring on the last step's control | VERIFIED |
| C2-023 | Read | Read About text | ASSIGNED / NOT REACHED | legendChip | Assigned legendChip; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-024 | Inputs | Change numeric setting | VERIFIED | indicatorEdit | Browser 2026-11-10: "show me how to make RSI 7" → ring on the last step's control | VERIFIED |
| C2-025 | Inputs | Change select setting (MA type, source) | VERIFIED | indicatorEdit | Browser 2026-11-10: "how do I change select setting (MA type, source)" → ring on the last step's control | VERIFIED |
| C2-026 | Inputs | Flip a toggle setting | VERIFIED | indicatorEdit | Browser 2026-11-10: "show me how to turn off the signal line" → ring on the last step's control | VERIFIED |
| C2-027 | Inputs | Edit session input | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-028 | Inputs | Cancel settings, roll back all edits | NO ASSIGNED WALKTHROUGH |  | The words reach settings; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-029 | Inputs | Set calculation timeframe | VERIFIED | indicatorEdit | Browser 2026-11-10: "show me how to calculate this RSI on the weekly" → ring on the last step's control | VERIFIED |
| C2-030 | Style | Change line colour | ASSIGNED / NOT REACHED | indicatorColor | Assigned indicatorColor; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-031 | Style | Change histogram up / down colours | VERIFIED | indicatorColor | Browser 2026-11-10: "show me how to make MACD bars blue when rising" → ring on the last step's control | VERIFIED |
| C2-032 | Style | Change line width | ASSIGNED / NOT REACHED | indicatorEdit | Assigned indicatorEdit; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-033 | Style | Change line style | ASSIGNED / NOT REACHED | indicatorEdit | Assigned indicatorEdit; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-034 | Style | Change plot style | VERIFIED | indicatorManage | Browser 2026-11-10: "how do I change plot style" → ring on the last step's control | VERIFIED |
| C2-035 | Style | Toggle overlap candles | NO ASSIGNED WALKTHROUGH |  | The words reach settings; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-036 | Placement | Move to price, volume or own pane | ASSIGNED / NOT REACHED | indicatorEdit | Assigned indicatorEdit; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-037 | Placement | Move into another indicator's pane | ASSIGNED / NOT REACHED | legendChip | Assigned legendChip; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-038 | Panes | Reorder pane | ASSIGNED / NOT REACHED | indicatorManage | Assigned indicatorManage; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-039 | Panes | Resize pane by divider | VERIFIED | chartView | Browser 2026-11-10: "how do I resize pane by divider" → ring on the last step's control | VERIFIED |
| C2-040 | Panes | Reorder series within a pane | NO ASSIGNED WALKTHROUGH |  | The words reach indicatorManage; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-041 | Legend | Show latest value in header | VERIFIED | legendChip | Browser 2026-11-10: "show me how to show RSI's value in the header" → ring on the last step's control | VERIFIED |
| C2-042 | Legend | Duplicate on chart | VERIFIED | legendChip | Browser 2026-11-10: "show me how to duplicate the 20 EMA" → ring on the last step's control | VERIFIED |
| C2-043 | Legend | Create custom copy | VERIFIED | legendChip | Browser 2026-11-10: "show me how to make my own copy of MACD" → ring on the last step's control | VERIFIED |
| C2-044 | Legend | Open Modify with UCT Intelligence | ASSIGNED / NOT REACHED | legendChip | Assigned legendChip; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-045 | Legend | Open Edit formula | NO ASSIGNED WALKTHROUGH |  | The words reach builderAction; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-046 | Legend | Apply script accuracy upgrade | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-047 | Legend | Report mismatch with TradingView | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-048 | Undo | Indicator undo and redo buttons | VERIFIED | indicatorManage | Browser 2026-11-10: "how do I indicator undo and redo buttons" → ring on the last step's control | VERIFIED |
| C2-049 | Copy | Copy indicators to another chart | NO ASSIGNED WALKTHROUGH |  | The words reach indicators; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-050 | Copy | Accept or refuse a shared chart's indicators | NO ASSIGNED WALKTHROUGH |  | The words reach indicators; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-051 | Templates | Save indicator template | NO ASSIGNED WALKTHROUGH |  | The words reach chartTemplate; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-052 | Templates | Apply indicator template | NO ASSIGNED WALKTHROUGH |  | The words reach chartTemplate; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-053 | Templates | Delete indicator template | NO ASSIGNED WALKTHROUGH |  | The words reach legendChip; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-054 | Templates | List indicator templates | NO ASSIGNED WALKTHROUGH |  | The words reach watchlistAction; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-055 | Create | Open Create Indicator | VERIFIED | indicatorManage | Browser 2026-11-10: "how do I open Create Indicator" → ring on the last step's control | VERIFIED |
| C2-056 | Create | Describe an indicator, get a draft | VERIFIED | indicatorManage | Browser 2026-11-10: "how do I describe an indicator, get a draft" → ring on the last step's control | VERIFIED |
| C2-057 | Create | Refine draft by conversation | ASSIGNED / NOT REACHED | indicatorManage | Assigned indicatorManage; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-058 | Create | Answer the builder's choice question | NO ASSIGNED WALKTHROUGH |  | The words reach builderAction; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-059 | Create | Undo a draft step | VERIFIED | builderAction | Browser 2026-11-10: "how do I undo a draft step" → ring on the last step's control | VERIFIED |
| C2-060 | Create | Preview draft on chart | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-061 | Create | Save draft, acknowledge warnings | VERIFIED | builderAction | Browser 2026-11-10: "how do I save draft, acknowledge warnings" → ring on the last step's control | VERIFIED |
| C2-062 | Create | Discard draft | VERIFIED | builderAction | Browser 2026-11-10: "how do I discard draft" → ring on the last step's control | VERIFIED |
| C2-063 | Create | Keep draft and close | NO ASSIGNED WALKTHROUGH |  | The words reach control; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-064 | Builder | Build by conditions | ASSIGNED / NOT REACHED | builderAction | Assigned builderAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-065 | Builder | Group conditions, any or all | NO ASSIGNED WALKTHROUGH |  | The words reach indicators; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-066 | Builder | Enter a formula | VERIFIED | builderAction | Browser 2026-11-10: "how do I enter a formula" → ring on the last step's control | VERIFIED |
| C2-067 | Builder | Add or remove member input | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-068 | Builder | Add, remove or restyle output plot | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-069 | Builder | Set placement and levels | ASSIGNED / NOT REACHED | builderAction | Assigned builderAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-070 | Builder | Set signal markers | ROUTED / BROWSER FAILED | builderAction | "show me how to put a green arrow under the bar when true" reaches it; browser: last step shows its fallback: These show once the formula gives a yes or no, such as close > open. Type one, then set it as a Signal. | ROUTED / BROWSER FAILED |
| C2-071 | Builder | Colour candles or background on a signal | ROUTED / BROWSER FAILED | builderAction | "show me how to paint the candles gold when true" reaches it; browser: last step shows its fallback: These show once the formula gives a yes or no, such as close > open. Type one, then set it as a Signal. | ROUTED / BROWSER FAILED |
| C2-072 | Builder | Name the draft | VERIFIED | builderAction | Browser 2026-11-10: "how do I name the draft" → ring on the last step's control | VERIFIED |
| C2-073 | Builder | Ask for an alert from the builder | VERIFIED | builderAction | Browser 2026-11-10: "how do I ask for an alert from the builder" → ring on the last step's control | VERIFIED |
| C2-074 | Builder | Run Evidence tab | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-075 | Builder | Use a starter | NO ASSIGNED WALKTHROUGH |  | The words reach chartTemplate; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-076 | Import | Paste Pine or thinkScript | VERIFIED | builderAction | Browser 2026-11-10: "how do I paste Pine or thinkScript" → ring on the last step's control | VERIFIED |
| C2-077 | Import | Apply import suggestion | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-078 | Import | Change script settings | NO ASSIGNED WALKTHROUGH |  | The words reach settings; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-079 | Import | Turn script output into a screen | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-080 | Image | Read an indicator from a screenshot | NO ASSIGNED WALKTHROUGH |  | The words reach chartView; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-081 | Image | Accept image candidate | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C2-082 | Saved | Open saved definition to edit | ASSIGNED / NOT REACHED | builderAction | Assigned builderAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-083 | Saved | Delete saved definition | ASSIGNED / NOT REACHED | builderAction | Assigned builderAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C2-084 | Saved | Share a definition by link | NO ASSIGNED WALKTHROUGH |  | The words reach chartView; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-085 | Saved | Publish to or withdraw from library | NO ASSIGNED WALKTHROUGH |  | The words reach indicators; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-086 | Saved | Install from a share link | NO ASSIGNED WALKTHROUGH |  | The words reach chartView; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-087 | Saved | Restore an older version | NO ASSIGNED WALKTHROUGH |  | The words reach control; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-088 | Alerts | Open indicator alerts popover | VERIFIED | alertIndicator | Browser 2026-11-10: "how do I open indicator alerts popover" → ring on the last step's control | VERIFIED |
| C2-089 | Alerts | Create threshold alert | VERIFIED | alertIndicator | Browser 2026-11-10: "show me how to alert me when RSI goes above 70" → ring on the last step's control | VERIFIED |
| C2-090 | Alerts | Create MA cross alert | VERIFIED | alertAction | Browser 2026-11-10: "how do I create MA cross alert" → ring on the last step's control | VERIFIED |
| C2-091 | Alerts | Choose plot on a multi-line indicator | ROUTED / BROWSER FAILED | alertAction | "show me how to alert on the MACD signal line" reaches it; browser: last step shows its fallback: Choose an indicator with several lines first, such as MACD: the Plot list appears here. | ROUTED / BROWSER FAILED |
| C2-092 | Alerts | Alert on a yes/no signal with trigger policy | ROUTED / BROWSER FAILED | alertAction | "how do I alert on a yes/no signal with trigger policy" reaches it; browser: last step shows its fallback: This shows when the indicator gives a yes or no signal. | ROUTED / BROWSER FAILED |
| C2-093 | Alerts | Alert on another timeframe | VERIFIED | alertAction | Browser 2026-11-10: "how do I alert on another timeframe" → ring on the last step's control | VERIFIED |
| C2-094 | Alerts | Limit alert to this chart | NO ASSIGNED WALKTHROUGH |  | The words reach alertPrice; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-095 | Alerts | Override alert inputs | NO ASSIGNED WALKTHROUGH |  | The words reach alertPrice; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C2-096 | Alerts | Choose which instance | VERIFIED | alertIndicator | Browser 2026-11-10: "show me how to the alert on the 9 EMA, left chart" → ring on the last step's control | VERIFIED |
| C2-097 | Alerts | List indicator alerts | VERIFIED | alertAction | Browser 2026-11-10: "show me how to show my indicator alerts" → ring on the last step's control | VERIFIED |
| C2-098 | Alerts | Pause or resume alert | VERIFIED | alertAction | Browser 2026-11-10: "how do I pause or resume alert" → ring on the last step's control | VERIFIED |
| C2-099 | Alerts | Delete alert | VERIFIED | alertAction | Browser 2026-11-10: "show me how to delete the RSI alert" → ring on the last step's control | VERIFIED |
| C2-100 | Alerts | See why an alert cannot fire | ROUTED / BROWSER FAILED | alertAction | "how do I see why an alert cannot fire" reaches it; browser: last step shows its fallback: None of your alerts for this symbol are blocked. A blocked one says why under its name here. | ROUTED / BROWSER FAILED |
| C2-101 | Mobile | Edit an average or study on phone | NO ASSIGNED WALKTHROUGH |  | The words reach indicators; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-001 | Board | Add a widget from Widgets ▾ | VERIFIED | widgetAdd | Browser 2026-11-10: "how do I add a widget from Widgets ▾" → ring on the last step's control | VERIFIED |
| C3-002 | Board | Drag a widget to move it, or nudge it | VERIFIED | widgetMove | Browser 2026-11-10: "how do I drag a widget to move it, or nudge it" → ring on the last step's control | VERIFIED |
| C3-003 | Board | Drag a widget edge or merged seam to resize | VERIFIED | widgetResize | Browser 2026-11-10: "how do I drag a widget edge or merged seam to resize" → ring on the last step's control | VERIFIED |
| C3-004 | Board | Close a widget | VERIFIED | widgetHeader | Browser 2026-11-10: "how do I close a widget" → ring on the last step's control | VERIFIED |
| C3-005 | Board | Merge or unmerge widgets (lock board, drop borders) | VERIFIED | widgetMerge | Browser 2026-11-10: "how do I merge or unmerge widgets (lock board, drop borders)" → ring on the last step's control | VERIFIED |
| C3-006 | Link | Cycle a widget's link colour | VERIFIED | link | Browser 2026-11-10: "how do I cycle a widget's link colour" → ring on the last step's control | VERIFIED |
| C3-007 | Link | Change a tool panel's colour group | VERIFIED | link | Browser 2026-11-10: "how do I change a tool panel's colour group" → ring on the last step's control | VERIFIED |
| C3-008 | Float | Float a widget over another | VERIFIED | widgetHeader | Browser 2026-11-10: "how do I float a widget over another" → ring on the last step's control | VERIFIED |
| C3-009 | Float | Drag or resize a floating widget | VERIFIED | widgetResize | Browser 2026-11-10: "how do I drag or resize a floating widget" → ring on the last step's control | VERIFIED |
| C3-010 | Float | Dock a floating widget back into the grid | NO ASSIGNED WALKTHROUGH |  | The words reach chartSetting; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-011 | Float | Move a floating widget into another widget's tabs | VERIFIED | widgetMove | Browser 2026-11-10: "how do I move a floating widget into another widget's tabs" → ring on the last step's control | VERIFIED |
| C3-012 | Popout | Pop a widget into its own window | VERIFIED | widgetHeader | Browser 2026-11-10: "how do I pop a widget into its own window" → ring on the last step's control | VERIFIED |
| C3-013 | Popout | Pop out the whole layout | ASSIGNED / NOT REACHED | layouts | Assigned layouts; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-014 | Popout | Dock a popped widget or layout back | NO ASSIGNED WALKTHROUGH |  | The words reach layouts; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-015 | Popout | Close a popped widget | VERIFIED | widgetHeader: Widget controls: Close | Browser 2026-11-10: "how do I close a popped widget" → ring on the last step's control | VERIFIED |
| C3-016 | Widget tabs | Add a widget as a tab | VERIFIED | widgetHeader | Browser 2026-11-10: "how do I add a widget as a tab" → ring on the last step's control | VERIFIED |
| C3-017 | Widget tabs | Switch a widget tab | VERIFIED | tabAction | Browser 2026-11-10: "how do I switch a widget tab" → ring on the last step's control | VERIFIED |
| C3-018 | Widget tabs | Rename a widget tab | VERIFIED | control: Renaming a widget tab | Browser 2026-11-10: "how do I rename a widget tab" → ring on the last step's control | VERIFIED |
| C3-019 | Widget tabs | Close a widget tab | VERIFIED | tabAction | Browser 2026-11-10: "how do I close a widget tab" → ring on the last step's control | VERIFIED |
| C3-020 | Chart tabs | Add a chart tab | VERIFIED | chartTab | Browser 2026-11-10: "how do I add a chart tab" → ring on the last step's control | VERIFIED |
| C3-021 | Chart tabs | Switch a chart tab | VERIFIED | tabAction | Browser 2026-11-10: "how do I switch a chart tab" → ring on the last step's control | VERIFIED |
| C3-022 | Chart tabs | Rename a chart tab | VERIFIED | control: Renaming a chart tab | Browser 2026-11-10: "how do I rename a chart tab" → ring on the last step's control | VERIFIED |
| C3-023 | Chart tabs | Change a chart tab's link colour | ROUTED / BROWSER FAILED | control: A chart tab’s link colour | "how do I change a chart tab's link colour" reaches it; browser: no walkthrough: Harness 9:54 PM how do I change a chart tab's link colour // UCT Agent 9:54 PM I can’t see the tab’s dot on your screen right now — Chart (SPY) may be scrolled | ROUTED / BROWSER FAILED |
| C3-024 | Chart tabs | Close a chart tab | VERIFIED | tabAction | Browser 2026-11-10: "how do I close a chart tab" → ring on the last step's control | VERIFIED |
| C3-025 | Layout Dock | Open a saved layout | VERIFIED | layouts | Browser 2026-11-10: "how do I open a saved layout" → ring on the last step's control | VERIFIED |
| C3-026 | Layout Dock | See which layout is open | VERIFIED | layoutAction | Browser 2026-11-10: "how do I see which layout is open" → ring on the last step's control | VERIFIED |
| C3-027 | Layout Dock | Undo a layout switch from the toast | VERIFIED | layoutAction | Browser 2026-11-10: "how do I undo a layout switch from the toast" → ring on the last step's control | VERIFIED |
| C3-028 | Layout Dock | Create a new layout from the dock | VERIFIED | layouts | Browser 2026-11-10: "how do I create a new layout from the dock" → ring on the last step's control | VERIFIED |
| C3-029 | Layout Dock | Start a new blank board from the Layouts menu | VERIFIED | layouts | Browser 2026-11-10: "how do I start a new blank board from the Layouts menu" → ring on the last step's control | VERIFIED |
| C3-030 | Layout Dock | Save the open layout | VERIFIED | layoutSave | Browser 2026-11-10: "show me how to save my layout" → ring on the last step's control | VERIFIED |
| C3-031 | Layout Dock | Save as a new layout | VERIFIED | layoutSave | Browser 2026-11-10: "how do I save as a new layout" → ring on the last step's control | VERIFIED |
| C3-032 | Layout Dock | Save a layout as a global template (admin) | NO ASSIGNED WALKTHROUGH |  | The words reach chartTemplate; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-033 | Layout Dock | Rename a layout | VERIFIED | layoutAction | Browser 2026-11-10: "how do I rename a layout" → ring on the last step's control | VERIFIED |
| C3-034 | Layout Dock | Duplicate a layout | VERIFIED | layoutAction | Browser 2026-11-10: "how do I duplicate a layout" → ring on the last step's control | VERIFIED |
| C3-035 | Layout Dock | Delete a layout | VERIFIED | control: Deleting a layout | Browser 2026-11-10: "how do I delete a layout" → ring on the last step's control | VERIFIED |
| C3-036 | Layout Dock | Delete a prebuilt template (admin) | NO ASSIGNED WALKTHROUGH |  | The words reach chartTemplate; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-037 | Layout Dock | Pin a layout to the bar | VERIFIED | control: Putting a layout on the bar | Browser 2026-11-10: "how do I pin a layout to the bar" → ring on the last step's control | VERIFIED |
| C3-038 | Layout Dock | Reorder layouts on the bar | NO ASSIGNED WALKTHROUGH |  | The words reach control; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-039 | Layout Dock | Remove a layout from the bar | VERIFIED | layoutAction | Browser 2026-11-10: "how do I remove a layout from the bar" → ring on the last step's control | VERIFIED |
| C3-040 | Layout Dock | View a layout's version history | VERIFIED | layoutAction | Browser 2026-11-10: "how do I view a layout's version history" → ring on the last step's control | VERIFIED |
| C3-041 | Layout Dock | Restore a layout version | VERIFIED | layoutAction | Browser 2026-11-10: "how do I restore a layout version" → ring on the last step's control | VERIFIED |
| C3-042 | Multi Chart | Enter a preset grid | VERIFIED | multiChart | Browser 2026-11-10: "show me how to use the 3x3 multi chart" → ring on the last step's control | VERIFIED |
| C3-043 | Multi Chart | Apply a custom rows × columns grid | VERIFIED | multiChart | Browser 2026-11-10: "show me how to multi chart 2 by 5" → ring on the last step's control | VERIFIED |
| C3-044 | Multi Chart | Exit Multi Chart | VERIFIED | gridAction | Browser 2026-11-10: "how do I exit Multi Chart" → ring on the last step's control | VERIFIED |
| C3-045 | Multi Chart | Toggle crosshair sync | VERIFIED | gridAction | Browser 2026-11-10: "show me how to sync the crosshairs" → ring on the last step's control | VERIFIED |
| C3-046 | Multi Chart | Toggle time-range sync | VERIFIED | gridAction | Browser 2026-11-10: "show me how to sync the time range" → ring on the last step's control | VERIFIED |
| C3-047 | Multi Chart | Turn on Groups mode | VERIFIED | gridAction | Browser 2026-11-10: "how do I turn on Groups mode" → ring on the last step's control | VERIFIED |
| C3-048 | Multi Chart | Pick a group for the grid | VERIFIED | gridAction | Browser 2026-11-10: "how do I pick a group for the grid" → ring on the last step's control | VERIFIED |
| C3-049 | Multi Chart | Step or switch group | VERIFIED | gridAction | Browser 2026-11-10: "show me how to next group" → ring on the last step's control | VERIFIED |
| C3-050 | Multi Chart | Refresh the group | VERIFIED | gridAction | Browser 2026-11-10: "how do I refresh the group" → ring on the last step's control | VERIFIED |
| C3-051 | Multi Chart | Exit Groups | VERIFIED | gridAction | Browser 2026-11-10: "how do I exit Groups" → ring on the last step's control | VERIFIED |
| C3-052 | Multi Chart | Apply a saved grid | VERIFIED | gridAction | Browser 2026-11-10: "how do I apply a saved grid" → ring on the last step's control | VERIFIED |
| C3-053 | Multi Chart | Save a grid | VERIFIED | gridAction | Browser 2026-11-10: "how do I save a grid" → ring on the last step's control | VERIFIED |
| C3-054 | Multi Chart | Save a grid as global (admin) | VERIFIED | gridAction | Browser 2026-11-10: "how do I save a grid as global (admin)" → ring on the last step's control | VERIFIED |
| C3-055 | Multi Chart | Delete a saved grid | VERIFIED | gridAction | Browser 2026-11-10: "how do I delete a saved grid" → ring on the last step's control | VERIFIED |
| C3-056 | Multi Chart | Set a cell's timeframe | VERIFIED | gridAction | Browser 2026-11-10: "how do I set a cell's timeframe" → ring on the last step's control | VERIFIED |
| C3-057 | Multi Chart | Set a cell's chart style | VERIFIED | gridAction | Browser 2026-11-10: "how do I set a cell's chart style" → ring on the last step's control | VERIFIED |
| C3-058 | Multi Chart | Toggle a cell's session | ROUTED / BROWSER FAILED | gridAction | "how do I toggle a cell's session" reaches it; browser: last step shows its fallback: This chart is too narrow to show them. Maximize it, or close me for a moment. | ROUTED / BROWSER FAILED |
| C3-059 | Multi Chart | Reset a cell to my chart | VERIFIED | gridAction | Browser 2026-11-10: "how do I reset a cell to my chart" → ring on the last step's control | VERIFIED |
| C3-060 | Multi Chart | Maximize or restore a cell | VERIFIED | gridAction | Browser 2026-11-10: "how do I maximize or restore a cell" → ring on the last step's control | VERIFIED |
| C3-061 | Multi Chart | Open shared grid settings | VERIFIED | gridAction | Browser 2026-11-10: "how do I open shared grid settings" → ring on the last step's control | VERIFIED |
| C3-062 | Multi Chart | Set an alert from a cell | VERIFIED | gridAction | Browser 2026-11-10: "how do I set an alert from a cell" → ring on the last step's control | VERIFIED |
| C3-063 | Watchlist | Open a list in a widget (own) | VERIFIED | watchlistAction: Opening one of your lists | Browser 2026-11-10: "show me how to show my Momentum list" → ring on the last step's control | VERIFIED |
| C3-064 | Watchlist | Open a prebuilt or community list | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I open a prebuilt or community list" → ring on the last step's control | VERIFIED |
| C3-065 | Watchlist | Open the Flagged list | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I open the Flagged list" → ring on the last step's control | VERIFIED |
| C3-066 | Watchlist | Open a colour-tag list | NOT IN PRODUCT |  | Colour-tag lists are rendered only by the unscoped Watchlists page (!pickList), and /watchlists redirects to Charts; the widget's list picker has no tag lists. | NOT IN PRODUCT |
| C3-067 | Watchlist | Go back to the list picker | VERIFIED | control: Going back to the list picker | Browser 2026-11-10: "how do I go back to the list picker" → ring on the last step's control | VERIFIED |
| C3-068 | Watchlist | Click a row to load the symbol | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I click a row to load the symbol" → ring on the last step's control | VERIFIED |
| C3-069 | Watchlist | Walk the list with arrow keys or space | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I walk the list with arrow keys or space" → ring on the last step's control | VERIFIED |
| C3-070 | Watchlist | Create a list | VERIFIED | watchlistCreate | Browser 2026-11-10: "how do I create a list" → ring on the last step's control | VERIFIED |
| C3-071 | Watchlist | Create a list from a template | ROUTED / BROWSER FAILED | watchlistAction: Creating a list from a template | "how do I create a list from a template" reaches it; browser: last step shows its fallback: You have no saved watchlist looks yet, so there’s no Template here. Save one from ⚙ → ＋ Save as Template on a list first. | ROUTED / BROWSER FAILED |
| C3-072 | Watchlist | Save a community list to My Lists | VERIFIED | watchlistAction: Saving a community list to My Lists | Browser 2026-11-10: "how do I save a community list to My Lists" → ring on the last step's control | NO ASSIGNED WALKTHROUGH |
| C3-073 | Watchlist | Rename a list | VERIFIED | watchlistAction: Renaming a list | Browser 2026-11-10: "how do I rename a list" → ring on the last step's control | NO ASSIGNED WALKTHROUGH |
| C3-074 | Watchlist | Rename the Flagged list | VERIFIED | watchlistAction: Renaming a list | Browser 2026-11-10: "how do I rename the Flagged list" → ring on the last step's control | NO WALKTHROUGH |
| C3-075 | Watchlist | Delete a list | VERIFIED | control: Deleting a watchlist | Browser 2026-11-10: "how do I delete a list" → ring on the last step's control | VERIFIED |
| C3-076 | Watchlist | Add a symbol | VERIFIED | watchlistAddSymbol | Browser 2026-11-10: "show me how to add NVDA to Momentum" → ring on the last step's control | VERIFIED |
| C3-077 | Watchlist | Add to Flagged | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I add to Flagged" → ring on the last step's control | VERIFIED |
| C3-078 | Watchlist | Flag or unflag a row (star) | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I flag or unflag a row (star)" → ring on the last step's control | VERIFIED |
| C3-079 | Watchlist | Remove a symbol | VERIFIED | watchlistAction | Browser 2026-11-10: "show me how to remove NVDA from Momentum" → ring on the last step's control | VERIFIED |
| C3-080 | Watchlist | Remove all starred symbols from a list | NOT IN PRODUCT |  | No way to star a ticker in a list: the list menu’s Remove starred shows only while a list has starred tickers, and nothing in the product stars one (pages/Watchlists.jsx toggleStar is never called; a row’s ☆ is Add to Flagged). | NO ASSIGNED WALKTHROUGH |
| C3-081 | Watchlist | Reorder symbols by hand | NOT IN PRODUCT |  | No control in the product: Watchlists.jsx never starts a row drag (dragItemId is never set), so a ticker cannot be reordered by hand. | NOT IN PRODUCT |
| C3-082 | Watchlist | Sort by a column | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I sort by a column" → ring on the last step's control | VERIFIED |
| C3-083 | Watchlist | Show or hide a column | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I show or hide a column" → ring on the last step's control | VERIFIED |
| C3-084 | Watchlist | Apply a column preset | NOT IN PRODUCT |  | Column presets (COL_PRESETS) are rendered only in the unscoped page's sub-header (!pickList); the widget's column menu has none. | NOT IN PRODUCT |
| C3-085 | Watchlist | Reorder columns by drag | VERIFIED | watchlistAction: Reordering a list’s columns | Browser 2026-11-10: "how do I reorder columns by drag" → ring on the last step's control | VERIFIED |
| C3-086 | Watchlist | Resize a column | VERIFIED | control: Resizing a list’s column | Browser 2026-11-10: "how do I resize a column" → ring on the last step's control | VERIFIED |
| C3-087 | Watchlist | Reset columns | VERIFIED | control: Resetting a list’s columns | Browser 2026-11-10: "how do I reset columns" → ring on the last step's control | VERIFIED |
| C3-088 | Watchlist | Write or edit a ticker note | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I write or edit a ticker note" → ring on the last step's control | VERIFIED |
| C3-089 | Watchlist | Expand or collapse a list | NOT IN PRODUCT |  | The widget shows one list, always open: there is nothing to expand or collapse. ‹ Lists switches the list. | NOT IN PRODUCT |
| C3-090 | Watchlist | Tag a symbol with a colour | NOT IN PRODUCT |  | Not in the Charts Watchlist widget (counted NOT IN PRODUCT for the widget family): a ticker’s colour tag lives on the ticker action menu (components/TickerActions.jsx, opened from TickerPopup and from ticker lists on other pages: the Calendar, the Screener’s results, Theme Tracker, the Desk reader), which the widget does not open. | NOT IN PRODUCT |
| C3-091 | Watchlist | Share a tag colour or Flagged | VERIFIED | watchlistAction: Sharing a list with the community | Browser 2026-11-10: "how do I share a tag colour or Flagged" → ring on the last step's control | NO ASSIGNED WALKTHROUGH |
| C3-092 | Watchlist | Make a list public | VERIFIED | watchlistAction: Sharing a list with the community | Browser 2026-11-10: "how do I make a list public" → ring on the last step's control | NO ASSIGNED WALKTHROUGH |
| C3-093 | Watchlist | Mark a list prebuilt (admin) | VERIFIED | watchlistAction: Publishing a list to Prebuilt | Browser 2026-11-10: "how do I mark a list prebuilt (admin)" → ring on the last step's control | NO ASSIGNED WALKTHROUGH |
| C3-094 | Watchlist | Copy a list to the clipboard | VERIFIED | watchlistAction: Copying a list to the clipboard | Browser 2026-11-10: "how do I copy a list to the clipboard" → ring on the last step's control | NO ASSIGNED WALKTHROUGH |
| C3-095 | Watchlist | Export a list as CSV or Excel | VERIFIED | watchlistAction: Exporting a list | Browser 2026-11-10: "how do I export a list as CSV or Excel" → ring on the last step's control | NO ASSIGNED WALKTHROUGH |
| C3-096 | Watchlist | Import tickers | NO ASSIGNED WALKTHROUGH |  | The words reach control; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-097 | Watchlist | View or restore list version history | VERIFIED | watchlistAction: A list’s version history | Browser 2026-11-10: "how do I view or restore list version history" → ring on the last step's control | NO WALKTHROUGH |
| C3-098 | Watchlist | Set a price alert from a row | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I set a price alert from a row" → ring on the last step's control | VERIFIED |
| C3-099 | Watchlist | Delete an alert from the row popover | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I delete an alert from the row popover" → ring on the last step's control | VERIFIED |
| C3-100 | Watchlist | Open Full Research or AI from a row | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I open Full Research or AI from a row" → ring on the last step's control | VERIFIED |
| C3-101 | Watchlist | Compare from a row | VERIFIED | watchlistAction | Browser 2026-11-10: "how do I compare from a row" → ring on the last step's control | VERIFIED |
| C3-102 | Watchlist | Open a row's attention facts | VERIFIED | watchlistAction: A ticker’s attention facts | Browser 2026-11-10: "how do I open a row's attention facts" → ring on the last step's control | VERIFIED |
| C3-103 | Watchlist | Change list appearance (canvas, text, tint) | VERIFIED | watchlistAction: Changing a watchlist’s look | Browser 2026-11-10: "how do I change list appearance (canvas, text, tint)" → ring on the last step's control | VERIFIED |
| C3-104 | Watchlist | Save or load a watchlist look | VERIFIED | watchlistAction: A saved watchlist look | Browser 2026-11-10: "how do I save or load a watchlist look" → ring on the last step's control | VERIFIED |
| C3-105 | Watchlist | Track or freeze a linked scan or theme | NO ASSIGNED WALKTHROUGH |  | The words reach chartThemes; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-106 | Watchlist | Use a saved screen as a list | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-107 | Scanner | Pick a preset scan | VERIFIED | widgetAction | Browser 2026-11-10: "how do I pick a preset scan" → ring on the last step's control | VERIFIED |
| C3-108 | Scanner | Leave a scan, back to the picker | VERIFIED | control: Back to the list of scans | Browser 2026-11-10: "how do I leave a scan, back to the picker" → ring on the last step's control | VERIFIED |
| C3-109 | Scanner | Search the preset list | ASSIGNED / NOT REACHED | control: Searching the scans | Assigned control (Searching the scans); the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-110 | Scanner | Read a scan's conditions | VERIFIED | widgetAction | Browser 2026-11-10: "how do I read a scan's conditions" → ring on the last step's control | VERIFIED |
| C3-111 | Scanner | Read a scan's results | VERIFIED | widgetAction | Browser 2026-11-10: "how do I read a scan's results" → ring on the last step's control | VERIFIED |
| C3-112 | Scanner | Refresh a scan | VERIFIED | control: Refreshing a scan | Browser 2026-11-10: "how do I refresh a scan" → ring on the last step's control | VERIFIED |
| C3-113 | Scanner | Sort a scan | VERIFIED | widgetAction | Browser 2026-11-10: "how do I sort a scan" → ring on the last step's control | VERIFIED |
| C3-114 | Scanner | Change scan columns | VERIFIED | widgetAction | Browser 2026-11-10: "how do I change scan columns" → ring on the last step's control | VERIFIED |
| C3-115 | Scanner | Create a scanner in the workspace | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-116 | Scanner | Modify a preset scan's conditions | NO ASSIGNED WALKTHROUGH |  | The words reach widgetAction; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-117 | Scanner | Open an AI Search scan in the builder and edit conditions | NO ASSIGNED WALKTHROUGH |  | The words reach control; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-118 | Scanner | Run or refine a screen from the workspace chat | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-119 | Scanner | Save a screen run from the workspace | NO ASSIGNED WALKTHROUGH |  | The words reach layoutSave; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-120 | Scanner | Send a scan to Journal | ROUTED / BROWSER FAILED | widgetAction | "how do I send a scan to Journal" reaches it; browser: no walkthrough: Harness 10:08 PM how do I send a scan to Journal // UCT Agent 10:08 PM Sending a scan to the Journal isn’t available yet. It will show in the Scanner widget on | ROUTED / BROWSER FAILED |
| C3-121 | Volume Surge | Choose what the scanner watches | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-122 | Volume Surge | Create, rename or delete a scope list | ROUTED / BROWSER FAILED | control: Deleting a Volume Surge list | "how do I create, rename or delete a scope list" reaches it; browser: last step shows its fallback: You have no lists of your own here yet. | ROUTED / BROWSER FAILED |
| C3-123 | Volume Surge | Add a ticker to a scope list | VERIFIED | control: Adding a ticker to a Volume Surge list | Browser 2026-11-10: "how do I add a ticker to a scope list" → ring on the last step's control | VERIFIED |
| C3-124 | Volume Surge | Set thresholds (RVOL, burst, move, $ floor) | ASSIGNED / NOT REACHED | widgetSettings | Assigned widgetSettings; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-125 | Volume Surge | Toggle logos | VERIFIED | control: Logos on Volume Surge | Browser 2026-11-10: "show me how to show logos on volume surge" → ring on the last step's control | VERIFIED |
| C3-126 | Volume Surge | Click a row or remove it from the list | NO ASSIGNED WALKTHROUGH |  | The words reach watchlistAction; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-127 | Alerts | See my alerts | VERIFIED | widgetAction | Browser 2026-11-10: "how do I see my alerts" → ring on the last step's control | VERIFIED |
| C3-128 | Alerts | Create a price alert | VERIFIED | alertPrice | Browser 2026-11-10: "how do I create a price alert" → ring on the last step's control | VERIFIED |
| C3-129 | Alerts | Delete an alert | VERIFIED | widgetAction | Browser 2026-11-10: "how do I delete an alert" → ring on the last step's control | VERIFIED |
| C3-130 | Alerts | Click an alert to load the symbol | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-131 | Alerts | Change Alerts widget appearance | VERIFIED | widgetSettings | Browser 2026-11-10: "how do I change Alerts widget appearance" → ring on the last step's control | VERIFIED |
| C3-132 | Alerts | Send alerts to Journal | VERIFIED | control: Sending Alerts to the Journal | Browser 2026-11-10: "how do I send alerts to Journal" → ring on the last step's control | VERIFIED |
| C3-133 | News | Filter catalysts up, down or all | VERIFIED | widgetAction | Browser 2026-11-10: "how do I filter catalysts up, down or all" → ring on the last step's control | VERIFIED |
| C3-134 | News | Read stored headlines for a symbol | VERIFIED | widgetAction | Browser 2026-11-10: "how do I read stored headlines for a symbol" → ring on the last step's control | VERIFIED |
| C3-135 | News | Place a headline on the chart | ASSIGNED / NOT REACHED | control: A headline on the chart | Assigned control (A headline on the chart); the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-136 | News | Change News widget appearance | ROUTED / BROWSER FAILED | widgetSettings | "how do I change News widget appearance" reaches it; browser: step 4 was not completed by the runner's input (card: Looking for it on your screen…) | ROUTED / BROWSER FAILED |
| C3-137 | News | Send the feed to Journal | VERIFIED | control: Sending News & Catalysts to the Journal | Browser 2026-11-10: "how do I send the feed to Journal" → ring on the last step's control | VERIFIED |
| C3-138 | TE News | Search headlines | VERIFIED | widgetAction | Browser 2026-11-10: "how do I search headlines" → ring on the last step's control | VERIFIED |
| C3-139 | TE News | Filter by category, linked symbol or watchlist | VERIFIED | widgetAction | Browser 2026-11-10: "show me how to only show headlines on my watchlist" → ring on the last step's control | VERIFIED |
| C3-140 | TE News | Apply, rename or delete a filter preset | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-141 | TE News | Save or unsave a headline | VERIFIED | control: Saving a headline | Browser 2026-11-10: "how do I save or unsave a headline" → ring on the last step's control | VERIFIED |
| C3-142 | TE News | Add or edit a headline note | NO ASSIGNED WALKTHROUGH |  | The words reach widgetAction; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-143 | TE News | Manage collections | NO ASSIGNED WALKTHROUGH |  | The words reach control; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-144 | TE News | Add a headline's ticker to a watchlist | VERIFIED | control: A headline’s actions: list | Browser 2026-11-10: "how do I add a headline's ticker to a watchlist" → ring on the last step's control | VERIFIED |
| C3-145 | TE News | Explain a headline or ask about it | VERIFIED | widgetAction | Browser 2026-11-10: "how do I explain a headline or ask about it" → ring on the last step's control | VERIFIED |
| C3-146 | TE News | Jump to live or browse a past day | ROUTED / BROWSER FAILED | control: Back to the live feed | "show me how to back to live news" reaches it; browser: step 4 was not completed by the runner's input (card: Looking for it on your screen…) | ROUTED / BROWSER FAILED |
| C3-147 | TE News | Send a headline to Notebook | VERIFIED | control: A headline’s actions: notebook | Browser 2026-11-10: "how do I send a headline to Notebook" → ring on the last step's control | VERIFIED |
| C3-148 | Calendar | Step days in the widget | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-149 | Calendar | Ask who reports on a day from Charts | VERIFIED | widgetAction | Browser 2026-11-10: "how do I ask who reports on a day from Charts" → ring on the last step's control | VERIFIED |
| C3-150 | Calendar | Ask when a stock reports from Charts | VERIFIED | dockAction | Browser 2026-11-10: "how do I ask when a stock reports from Charts" → ring on the last step's control | VERIFIED |
| C3-151 | Calendar | Filter economic events by stars | VERIFIED | widgetAction | Browser 2026-11-10: "how do I filter economic events by stars" → ring on the last step's control | VERIFIED |
| C3-152 | Calendar | Toggle the TBD section | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-153 | Calendar | Sort earnings columns | NO ASSIGNED WALKTHROUGH |  | The words reach watchlists; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-154 | Calendar | Show all earnings in a section | NO ASSIGNED WALKTHROUGH |  | The words reach chartView; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-155 | Calendar | Click an earnings row | VERIFIED | widgetAction | Browser 2026-11-10: "how do I click an earnings row" → ring on the last step's control | VERIFIED |
| C3-156 | Calendar | Send a day to Journal | VERIFIED | control: Sending UCT Terminal to the Journal | Browser 2026-11-10: "how do I send a day to Journal" → ring on the last step's control | VERIFIED |
| C3-157 | Breadth | Read breadth tiles | VERIFIED | widgetAction | Browser 2026-11-10: "how do I read breadth tiles" → ring on the last step's control | VERIFIED |
| C3-158 | Breadth | Add or remove a reading | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-159 | Breadth | Switch heatmap and ratio view | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-160 | Breadth | Change tile style | ASSIGNED / NOT REACHED | widgetSettings | Assigned widgetSettings; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-161 | Breadth | Change palette, intensity or background | ASSIGNED / NOT REACHED | widgetSettings | Assigned widgetSettings; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-162 | Breadth | Drill into a reading | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-163 | Breadth | Send a snapshot to Journal | VERIFIED | control: Sending Breadth to the Journal | Browser 2026-11-10: "show me how to send breadth to journal" → ring on the last step's control | VERIFIED |
| C3-164 | Options Flow | Switch market or symbol scope | VERIFIED | widgetAction | Browser 2026-11-10: "show me how to flow for this symbol only" → ring on the last step's control | VERIFIED |
| C3-165 | Options Flow | Switch the lead view | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-166 | Options Flow | Set filters (premium, call/put, type, direction) | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-167 | Options Flow | Read the flow | VERIFIED | widgetAction | Browser 2026-11-10: "how do I read the flow" → ring on the last step's control | VERIFIED |
| C3-168 | Options Flow | Click a flow row | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-169 | Themes | Pick a period or ranking | VERIFIED | widgetAction | Browser 2026-11-10: "show me how to show themes by week" → ring on the last step's control | VERIFIED |
| C3-170 | Themes | Flip sort direction | VERIFIED | widgetAction | Browser 2026-11-10: "show me how to sort themes worst first" → ring on the last step's control | VERIFIED |
| C3-171 | Themes | Switch today basis | VERIFIED | widgetAction | Browser 2026-11-10: "show me how to measure from the open" → ring on the last step's control | VERIFIED |
| C3-172 | Themes | Open a theme or pick a holding | VERIFIED | widgetAction | Browser 2026-11-10: "how do I open a theme or pick a holding" → ring on the last step's control | VERIFIED |
| C3-173 | Themes | Search themes or tickers | VERIFIED | widgetAction | Browser 2026-11-10: "how do I search themes or tickers" → ring on the last step's control | VERIFIED |
| C3-174 | Themes | Pick, rename or delete a theme set | VERIFIED | widgetAction | Browser 2026-11-10: "how do I pick, rename or delete a theme set" → ring on the last step's control | VERIFIED |
| C3-175 | Themes | Edit a set (add, hide, reset, custom theme) | VERIFIED | widgetAction: Theme presets | Browser 2026-11-10: "how do I edit a set (add, hide, reset, custom theme)" → ring on the last step's control | VERIFIED |
| C3-176 | Themes | Add or remove a stock in a theme | NO ASSIGNED WALKTHROUGH |  | The words reach chartThemes; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-177 | Themes | Send the ranking to Journal | VERIFIED | control: Sending Theme Tracker to the Journal | Browser 2026-11-10: "how do I send the ranking to Journal" → ring on the last step's control | VERIFIED |
| C3-178 | Fundamentals | Switch view | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-179 | Fundamentals | Read the numbers | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-180 | Fundamentals | Change appearance or send to Journal | ASSIGNED / NOT REACHED | widgetSettings | Assigned widgetSettings; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-181 | Profile | Read profile and earnings table | VERIFIED | widgetAction | Browser 2026-11-10: "how do I read profile and earnings table" → ring on the last step's control | VERIFIED |
| C3-182 | Profile | Click a peer ticker | NO ASSIGNED WALKTHROUGH |  | The words reach symbol; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-183 | Indexes | Hide or restore an index | ROUTED / BROWSER FAILED | control: Hiding an index | "how do I hide or restore an index" reaches it; browser: no walkthrough: Harness 10:16 PM how do I hide or restore an index // UCT Agent 10:16 PM The Indexes widget isn’t available yet. It will be on Widgets ▾ once it’s switched on. | ROUTED / BROWSER FAILED |
| C3-184 | Indexes | Send levels to Journal | ROUTED / BROWSER FAILED | control: Sending Indexes to the Journal | "show me how to send index levels to journal" reaches it; browser: no walkthrough: Harness 10:16 PM show me how to send index levels to journal // UCT Agent 10:16 PM The Indexes widget isn’t available yet. It will be on Widgets ▾ once it’s sw | ROUTED / BROWSER FAILED |
| C3-185 | Market Context | Read market context | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-186 | Market Context | Send to Journal | NO ASSIGNED WALKTHROUGH |  | The words reach control; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-187 | NH/NL | Add or remove a universe | VERIFIED | widgetAction | Browser 2026-11-10: "show me how to add the Nasdaq 100 to new highs" → ring on the last step's control | VERIFIED |
| C3-188 | NH/NL | Switch universe tab | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-189 | NH/NL | Expand a row or pick a symbol | NO ASSIGNED WALKTHROUGH |  | The words reach symbol; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-190 | NH/NL | Toggle logos, font, background | ASSIGNED / NOT REACHED | widgetSettings | Assigned widgetSettings; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-191 | H/L Pulse | Change Pulse settings | ASSIGNED / NOT REACHED | widgetSettings | Assigned widgetSettings; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-192 | Market Map | Pick or remove a universe | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-193 | Market Map | Pick X, Y or size axis | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-194 | Market Map | Follow the linked list | NO ASSIGNED WALKTHROUGH |  | The words reach watchlists; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-195 | Market Map | Cycle labels or zoom | NO ASSIGNED WALKTHROUGH |  | The words reach chartView; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-196 | AI Search | Ask a question or follow one up | VERIFIED | widgetAction | Browser 2026-11-10: "show me how to ask AI search about NVDA" → ring on the last step's control | VERIFIED |
| C3-197 | AI Search | Change ask mode, stop or retry | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-198 | AI Search | Save, reopen or remove an answer | ROUTED / BROWSER FAILED | control: Saving an answer | "show me how to save that answer" reaches it; browser: last step shows its fallback: Ask something first: this shows under each answer. | ROUTED / BROWSER FAILED |
| C3-199 | AI Search | Copy or speak an answer | ROUTED / BROWSER FAILED | control: Copying an answer | "how do I copy or speak an answer" reaches it; browser: last step shows its fallback: Ask something first: this shows under each answer. | ROUTED / BROWSER FAILED |
| C3-200 | AI Search | Send the conversation to Journal | ROUTED / BROWSER FAILED | control: Sending AI Search to the Journal | "how do I send the conversation to Journal" reaches it; browser: last step shows its fallback: Send to Journal shows in this widget’s top bar once it has something to send. | ROUTED / BROWSER FAILED |
| C3-201 | Notebook | Open or search a note | VERIFIED | widgetAction | Browser 2026-11-10: "how do I open or search a note" → ring on the last step's control | VERIFIED |
| C3-202 | Notebook | Create a note | ASSIGNED / NOT REACHED | widgetAction | Assigned widgetAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-203 | Notebook | Edit a note's title or body | ROUTED / BROWSER FAILED | control: Editing a note | "how do I edit a note's title or body" reaches it; browser: last step shows its fallback: Open a note from the list first. | ROUTED / BROWSER FAILED |
| C3-204 | Notebook | Browse folders | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-205 | Period Sort | Start a custom-period sort | VERIFIED | periodSort | Browser 2026-11-10: "how do I start a custom-period sort" → ring on the last step's control | VERIFIED |
| C3-206 | Period Sort | Choose grouping, replay and start mark | NO ASSIGNED WALKTHROUGH |  | The words reach replay; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-207 | Period Sort | Dock the panel or add it as a tab | NO ASSIGNED WALKTHROUGH |  | The words reach dockAction; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-208 | Period Sort | Refresh results | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-209 | Replay | Start replay at a date | VERIFIED | replay | Browser 2026-11-10: "how do I start replay at a date" → ring on the last step's control | VERIFIED |
| C3-210 | Replay | Exit replay | ROUTED / BROWSER FAILED | panelAction | "how do I exit replay" reaches it; browser: last step shows its fallback: Replay isn’t running, so there’s nothing to exit. Exit replay shows here while it runs. | ROUTED / BROWSER FAILED |
| C3-211 | Replay | Pick the cutoff by clicking the chart | NO ASSIGNED WALKTHROUGH |  | The words reach replay; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-212 | Replay | Set replay timeframe | VERIFIED | replay | Browser 2026-11-10: "how do I set replay timeframe" → ring on the last step's control | VERIFIED |
| C3-213 | Review | Start Review Charts from a results list | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-214 | Review | Step next or previous in a review (mobile only at this commit) | NO ASSIGNED WALKTHROUGH |  | The words reach symbol; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-215 | Review | Open the review feed card (mobile only) | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-216 | Company dock | Switch dock tab | ASSIGNED / NOT REACHED | dockAction | Assigned dockAction; the inventory's own words do not reach it | ASSIGNED / NOT REACHED |
| C3-217 | Company dock | Open or collapse the dock | VERIFIED | dockAction | Browser 2026-11-10: "show me how to hide the company panel" → ring on the last step's control | VERIFIED |
| C3-218 | Company dock | Search company info | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-219 | Company dock | Open ETF holdings | ROUTED / BROWSER FAILED | dockAction | "how do I open ETF holdings" reaches it; browser: last step shows its fallback: View Holdings shows on a chart of an ETF or an index. Load one first. | ROUTED / BROWSER FAILED |
| C3-220 | Company dock | Pick a leveraged or inverse ETF | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-221 | Workspace | Open the Agent | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |
| C3-222 | Workspace | Change a widget's UCT theme section | NO ASSIGNED WALKTHROUGH |  | The words reach chartThemes; nobody has judged it right | NO ASSIGNED WALKTHROUGH |
| C3-223 | Workspace | Toggle the journal shortcut (Ctrl+Alt+J) | NO WALKTHROUGH |  | The inventory words reach none. | NO WALKTHROUGH |

## Held-out KNOWN MISSES (not passes)

Held-out phrasings that do NOT reach what their held-out file named. Asserted both ways in that file (not what was named; what they reach today), so they pass as tests but are NOT passes. Kept in step with COV3_MISSES, COV4_MISSES, COV4B_MISSES COV5_MISSES and WL_TITLE_MENU_MISSES in the agentGuideHeldOutCov3/Cov4/Cov4b/Cov5 test files.

| Set | Words | Named | Reaches | Why |
|---|---|---|---|---|
| cov-3 | how do I only see call options with a big premium | Flow filters | Options Flow: minimum premium | the Options Flow catalog control is more specific than the row the held-out named |
| cov-3 | how do I open the options flow then filter it to puts | Flow filters | Options Flow: calls or puts | the Options Flow catalog control is more specific than the row the held-out named |
| cov-3 | how do I add a horizontal line and then lock it | Locking a drawing | Drawing a Horizontal Line, then locking a drawing | a two-part walkthrough's title lowercases its second part |
| cov-4 | how do I show the market cap in the info row | Market cap in the info row | The header’s info row | the info row's own panel walkthrough (the matrix's assignment for C1-066) takes it first |
| cov-4b | how do I get alerted at a fib level | An alert on a line | Setting a price alert | a fib has no Set alert of its own (drawingSettingsSchema.js), so the truthful walkthrough is a price alert at the level |
| cov-5 | how do I set a solid colour behind the candles | The chart’s background | Finding chart settings | no word of the background’s own: “behind the candles” names nothing the catalog or the settings table holds |
| cov-5 | how do I make the crosshair snap to the candles | The magnet crosshair | Changing Crosshair | the magnet crosshair’s only toggles (StockChart’s region menu, ChartToolbar’s panel) are not opened by a desktop /charts right-click; the workspace chart menu has no such row |
| cov-5 | how do I turn on the magnet crosshair | The magnet crosshair | Changing Crosshair | the magnet crosshair’s only toggles (StockChart’s region menu, ChartToolbar’s panel) are not opened by a desktop /charts right-click; the workspace chart menu has no such row |
| wl title menu | how do I clear out all the starred tickers in my watchlist | Removing the starred tickers | Using watchlists | NOT IN PRODUCT (C3-080): nothing stars a ticker in a list (Watchlists.jsx toggleStar is never called), so Remove starred never shows; the walkthrough was withdrawn |
