# Re-measured coverage ledger, #1016 (LOCAL, src/agent vitest + recount; scripted model, jsdom; 2026-11-11)

| Tree | Commit | Doc VERIFIED (of 484) | Re-proved by its own src/agent run (*) | Doc VERIFIED, citation unmatched, its named test files all passed (V~) | VERIFIED here, not on master: NEW CAPABILITY | ... EXISTING CAPABILITY NEWLY VERIFIED |
| --- | --- | --- | --- | --- | --- | --- |
| master (verified install) | 75421184a3 | 225 | 188 | 37 | - | - |
| master (stale 11-06 install, VOID) | b2300e547d | 225 | 188 | 37 | 0 | 0 |

V/P/I/M/B/U = the doc state; * = re-proved by that tree's src/agent run (every citation matched a passed test); V~ = doc VERIFIED, citation unmatched, its named test files all passed; plain V = doc VERIFIED and NOT re-proved
N = this re-measurement on the verified install; S = ledger6 master b2300e547d on the stale 11-06 install (AUDIT VOID), same recount.mjs

| Row | Area | Action | N | S | Not on master: class (tree) | Product commits (not upstream) |
| --- | --- | --- | --- | --- | --- | --- |
| C1-001 | Symbol | Change ticker by search pick | V* | V* |  |  |
| C1-002 | Symbol | Type-to-search on focused chart | V* | V* |  |  |
| C1-003 | Symbol | Filter search by category chip | M | M |  |  |
| C1-004 | Symbol | Open a free-typed symbol with no result row | I | I |  |  |
| C1-005 | Symbol | Flag current ticker (Shift+F) | V* | V* |  |  |
| C1-006 | Timeframe | Pick preset timeframe on bar | V* | V* |  |  |
| C1-007 | Timeframe | Pick from full timeframe menu | I | I |  |  |
| C1-008 | Timeframe | Add custom interval | V* | V* |  |  |
| C1-009 | Timeframe | Delete custom interval | I | I |  |  |
| C1-010 | Timeframe | Star a favourite timeframe | I | I |  |  |
| C1-011 | Timeframe | Timeframe keys with repeat-press cycle | V~ | V~ |  |  |
| C1-013 | Chart type | Choose chart type in settings | V* | V* |  |  |
| C1-015 | Chart type | Breadth Line/Candles quick toggle | V* | V* |  |  |
| C1-016 | Chart type | Heikin Ashi candles | V* | V* |  |  |
| C1-017 | Chart type | Candle colour mode | V* | V* |  |  |
| C1-018 | Chart type | Thin bars | V* | V* |  |  |
| C1-019 | Session | Regular/extended on intraday | V~ | V~ |  |  |
| C1-020 | Session | Regular/extended on D/W/M | V* | V* |  |  |
| C1-022 | Scale | Arithmetic/log/percent from menu | P | P |  |  |
| C1-023 | Scale | Toggle log (Shift+L) | V* | V* |  |  |
| C1-024 | Scale | Invert scale (Alt+I) | V* | V* |  |  |
| C1-025 | Scale | Auto-scale | M | M |  |  |
| C1-026 | Scale | Drag price axis to compress | B | B |  |  |
| C1-027 | View | Reset view | V* | V* |  |  |
| C1-028 | View | Zoom in/out (+/-) | B | B |  |  |
| C1-029 | View | Range buttons (3M/6M/YTD/1Y/5Y) | V* | V* |  |  |
| C1-030 | Go to date | Type a date in Time Navigator | V* | V* |  |  |
| C1-031 | Go to date | Pick date or year in calendar | I | I |  |  |
| C1-032 | Go to date | Step one bar back/forward | M | M |  |  |
| C1-033 | Go to date | Open date box (Alt+G) | V* | V* |  |  |
| C1-034 | Compare | Add a symbol | V* | V* |  |  |
| C1-035 | Compare | Add a whole group | M | M |  |  |
| C1-036 | Compare | Remove one symbol | I | I |  |  |
| C1-037 | Compare | Remove a group | M | M |  |  |
| C1-038 | Compare | Clear all comparisons | I | I |  |  |
| C1-039 | Compare | Same/new scale per symbol | I | I |  |  |
| C1-040 | Compare | Same/new scale for a group | M | M |  |  |
| C1-041 | Compare | Group only (hide base) | I | I |  |  |
| C1-042 | Replay | Start from a date | V* | V* |  |  |
| C1-043 | Replay | Choose replay timeframe | M | M |  |  |
| C1-044 | Replay | Pick the cutoff on the chart | B | B |  |  |
| C1-045 | Replay | Exit replay | V* | V* |  |  |
| C1-046 | Replay | Legacy bar replay play/step/speed/scrub | U | U |  |  |
| C1-047 | Settings | Toggle grid | V* | V* |  |  |
| C1-048 | Settings | Solid/gradient background | V* | V* |  |  |
| C1-049 | Settings | Solid background colour | V* | V* |  |  |
| C1-050 | Settings | Gradient colours | V* | V* |  |  |
| C1-051 | Settings | Crosshair mode | V* | V* |  |  |
| C1-052 | Settings | Crosshair colour/width/style | V* | V* |  |  |
| C1-053 | Settings | Magnet crosshair | V* | V* |  |  |
| C1-054 | Settings | Price labels / MA labels | V* | V* |  |  |
| C1-055 | Settings | Scale text size and colour | P | P |  |  |
| C1-056 | Settings | Watermark on/off (Alt+Shift+W) | V* | V* |  |  |
| C1-057 | Settings | Watermark lines | V* | V* |  |  |
| C1-058 | Settings | Watermark alignment | M | M |  |  |
| C1-059 | Settings | Watermark size/weight/colour/opacity | V* | V* |  |  |
| C1-060 | Settings | Move watermark | V* | V* |  |  |
| C1-061 | Settings | Reset watermark to centre | P | P |  |  |
| C1-062 | Settings | Title shows ticker/company/both | V* | V* |  |  |
| C1-063 | Settings | Day change beside title | V* | V* |  |  |
| C1-064 | Settings | Legend mode | V* | V* |  |  |
| C1-065 | Settings | Legend bar-info fields | M | M |  |  |
| C1-066 | Settings | Info-row fields | M | M |  |  |
| C1-067 | Settings | Header colours | M | M |  |  |
| C1-068 | Settings | Swing labels on/off and sensitivity | V* | V* |  |  |
| C1-069 | Settings | Swing label background, tint, colours | V* | V* |  |  |
| C1-070 | Settings | Event markers | V* | V* |  |  |
| C1-071 | Settings | Earnings beat/miss and IPO colours | V* | V* |  |  |
| C1-072 | Settings | Prev-day lines on/off | V* | V* |  |  |
| C1-073 | Settings | Prev-day line style/width/colour | V* | V* |  |  |
| C1-074 | Settings | Dark-pool levels | V* | V* |  |  |
| C1-075 | Settings | Bar-close countdown (Shift+C) | V* | V* |  |  |
| C1-076 | Settings | Restore defaults | V* | V* |  |  |
| C1-077 | Settings | Save / delete a custom colour | M | M |  |  |
| C1-078 | Settings | Light/dark palette (Shift+T) | M | M |  |  |
| C1-079 | Themes | Apply a theme to one chart | V* | V* |  |  |
| C1-080 | Themes | Apply a theme to all charts | V* | V* |  |  |
| C1-081 | Themes | Apply a theme to all widgets | M | M |  |  |
| C1-082 | Templates | Apply a template | V* | V* |  |  |
| C1-083 | Templates | Save a template | V* | V* |  |  |
| C1-084 | Templates | Delete a template | V* | V* |  |  |
| C1-086 | Volume | Show/hide volume (Ctrl+V, menu) | V* | V* |  |  |
| C1-087 | Volume | Remove volume | V* | V* |  |  |
| C1-089 | Volume | Resize volume pane by drag | V* | V* |  |  |
| C1-090 | Volume | HVC highlight | V* | V* |  |  |
| C1-091 | Volume | Volume colours, MA, label, bar style | V* | V* |  |  |
| C1-092 | Volume | Overlay indicator on volume | I | I |  |  |
| C1-093 | Panes | Move a pane | V* | V* |  |  |
| C1-094 | Panes | Resize a pane | I | I |  |  |
| C1-097 | Legend | Hide/show an indicator from chip | V* | V* |  |  |
| C1-098 | Legend | Display in another pane from chip | V* | V* |  |  |
| C1-099 | Legend | Duplicate on chart | I | I |  |  |
| C1-100 | Legend | Show latest value in header | M | M |  |  |
| C1-101 | Legend | Add alert from chip | V* | V* |  |  |
| C1-102 | Legend | Delete indicator from chip | V* | V* |  |  |
| C1-103 | Legend | Hide all indicators (Alt+Shift+I) | V* | V* |  |  |
| C1-104 | Legend | Toggle RSI/MACD/BB/VWAP chord | I | I |  |  |
| C1-105 | Legend | Toggle moving averages (Ctrl+M) | V* | V* |  |  |
| C1-106 | Measure | Measure on the chart | V* | V* |  |  |
| C1-107 | Measure | Bars & Time | V* | V* |  |  |
| C1-108 | Measure | Price range | V* | V* |  |  |
| C1-109 | Measure | Price Move | V* | V* |  |  |
| C1-110 | Share | Open share popover (Alt+S) | B | B |  |  |
| C1-111 | Share | Download PNG | B | B |  |  |
| C1-112 | Share | Copy image | B | B |  |  |
| C1-113 | Share | Copy share link | B | B |  |  |
| C1-114 | Alerts | Price alert at the cursor (Alt+N) | V* | V* |  |  |
| C1-115 | Alerts | Alert on a line, following it | V* | V* |  |  |
| C1-116 | Alerts | Alert at a line's fixed level | I | I |  |  |
| C1-117 | Alerts | Alert on a fib level | V* | V* |  |  |
| C1-118 | Alerts | Position alerts (three lines) | M | M |  |  |
| C1-119 | Alerts | Pause/resume indicator alert | V* | V* |  |  |
| C1-120 | Alerts | Delete indicator alert | V* | V* |  |  |
| C1-121 | Alerts | Move a level line | V* | V* |  |  |
| C1-125 | Right-click | Clear all drawings | V* | V* |  |  |
| C1-126 | Right-click | Hide all drawings | I | I |  |  |
| C1-127 | Settings door | Open chart settings (Alt+,, gear) | M | M |  |  |
| C1-128 | Drawing | Trendline | V* | V* |  |  |
| C1-130 | Drawing | Extended line | V* | V* |  |  |
| C1-131 | Drawing | Horizontal line | V* | V* |  |  |
| C1-132 | Drawing | Horizontal ray | V* | V* |  |  |
| C1-133 | Drawing | Vertical line | V* | V* |  |  |
| C1-134 | Drawing | Rectangle | V* | V* |  |  |
| C1-135 | Drawing | Circle | V* | V* |  |  |
| C1-136 | Drawing | Arrow | V* | V* |  |  |
| C1-137 | Drawing | Fib retracement | V* | V* |  |  |
| C1-138 | Drawing | Fib extension | V* | V* |  |  |
| C1-139 | Drawing | Pitchfork | V* | V* |  |  |
| C1-140 | Drawing | Parallel channel | V* | V* |  |  |
| C1-141 | Drawing | Cup curve | V* | V* |  |  |
| C1-142 | Drawing | Anchored VWAP | V* | V* |  |  |
| C1-143 | Drawing | Text note | V* | V* |  |  |
| C1-144 | Drawing | Position calculator | P | P |  |  |
| C1-145 | Drawing | Eraser | V* | V* |  |  |
| C1-146 | Drawing | Delete selected (Del, button) | V* | V* |  |  |
| C1-147 | Drawing | Recolour | V* | V* |  |  |
| C1-148 | Drawing | Width and line style | V* | V* |  |  |
| C1-149 | Drawing | Fill and border | V* | V* |  |  |
| C1-150 | Drawing | Text font, size, bold, italic, background | V* | V* |  |  |
| C1-151 | Drawing | Fib levels and fills | V* | V* |  |  |
| C1-152 | Drawing | Reset fib | V* | V* |  |  |
| C1-153 | Drawing | Measure-label options | V* | V* |  |  |
| C1-154 | Drawing | Price label on a line | V* | V* |  |  |
| C1-155 | Drawing | Edit anchors | V* | V* |  |  |
| C1-156 | Drawing | Make horizontal | V* | V* |  |  |
| C1-157 | Drawing | Duplicate | M | M |  |  |
| C1-158 | Drawing | Lock/unlock | I | I |  |  |
| C1-159 | Drawing | Hide/show one | I | I |  |  |
| C1-160 | Drawing | Save as default | M | M |  |  |
| C1-161 | Drawing | Reorder (front/back) | U | U |  |  |
| C1-162 | Drawing | Undo/redo a drawing | B | B |  |  |
| C1-163 | Drawing | Magnet for drawing | U | U |  |  |
| C1-164 | Drawing | Repeat drawing mode | B | B |  |  |
| C1-165 | Drawing | Customise tool favourites | M | M |  |  |
| C1-166 | Drawing | Nudge selected with arrows | B | B |  |  |
| C1-167 | Boards | Switch drawing board | M | M |  |  |
| C1-168 | Boards | Create a board | M | M |  |  |
| C1-169 | Boards | Rename a board | M | M |  |  |
| C1-170 | Boards | Delete a board | M | M |  |  |
| C1-171 | Keyboard | Add ticker to watchlist (Alt+Q) | V* | V* |  |  |
| C1-172 | Keyboard | Add indicator dialog (Alt+Shift+A) | V* | V* |  |  |
| C1-173 | Keyboard | Cycle grid layout (Alt+\\) | U | U |  |  |
| C1-174 | Keyboard | Keyboard help (?) | U | U |  |  |
| C1-175 | Keyboard | Escape to cursor / cancel | B | B |  |  |
| C2-001 | Picker | Open indicator library | M | M |  |  |
| C2-002 | Picker | Search indicators by name or purpose | I | I |  |  |
| C2-003 | Picker | Browse by category | I | I |  |  |
| C2-004 | Add | Add built-in indicator | V* | V* |  |  |
| C2-005 | Add | Add with chosen settings | V* | V* |  |  |
| C2-006 | Add | Add another copy with defaults | I | I |  |  |
| C2-007 | Add | Add own saved indicator | V* | V* |  |  |
| C2-008 | Add | Add a symbol as a data series from search | U | U |  |  |
| C2-009 | Add | Add economic series | U | U |  |  |
| C2-010 | Add | Keyboard chord toggles RSI, MACD, BB, VWAP | I | I |  |  |
| C2-011 | Add | Enable classic overlay average | M | M |  |  |
| C2-012 | Add | Add Volume Profile | M | M |  |  |
| C2-013 | Add | Toggle Chart IQ pattern recognition | V* | V* |  |  |
| C2-014 | Remove | Delete indicator from legend | V* | V* |  |  |
| C2-015 | Remove | Delete from Chart Settings | V* | V* |  |  |
| C2-016 | Remove | Delete classic average row | V* | V* |  |  |
| C2-017 | Remove | Remove an unavailable indicator | U | U |  |  |
| C2-018 | Visibility | Hide indicator | V* | V* |  |  |
| C2-019 | Visibility | Show indicator | V* | V* |  |  |
| C2-020 | Visibility | Hide or show volume | V* | V* |  |  |
| C2-021 | Visibility | Limit to chosen timeframes | V* | V* |  |  |
| C2-022 | Read | See what is on a chart | V* | V* |  |  |
| C2-023 | Read | Read About text | I | I |  |  |
| C2-024 | Inputs | Change numeric setting | V* | V* |  |  |
| C2-025 | Inputs | Change select setting (MA type, source) | V* | V* |  |  |
| C2-026 | Inputs | Flip a toggle setting | I | I |  |  |
| C2-027 | Inputs | Edit session input | I | I |  |  |
| C2-028 | Inputs | Cancel settings, roll back all edits | M | M |  |  |
| C2-029 | Inputs | Set calculation timeframe | M | M |  |  |
| C2-030 | Style | Change line colour | V* | V* |  |  |
| C2-031 | Style | Change histogram up / down colours | I | I |  |  |
| C2-032 | Style | Change line width | V* | V* |  |  |
| C2-033 | Style | Change line style | V* | V* |  |  |
| C2-034 | Style | Change plot style | I | I |  |  |
| C2-035 | Style | Toggle overlap candles | I | I |  |  |
| C2-036 | Placement | Move to price, volume or own pane | V* | V* |  |  |
| C2-037 | Placement | Move into another indicator's pane | I | I |  |  |
| C2-038 | Panes | Reorder pane | V* | V* |  |  |
| C2-039 | Panes | Resize pane by divider | I | I |  |  |
| C2-040 | Panes | Reorder series within a pane | U | U |  |  |
| C2-041 | Legend | Show latest value in header | M | M |  |  |
| C2-042 | Legend | Duplicate on chart | I | I |  |  |
| C2-043 | Legend | Create custom copy | I | I |  |  |
| C2-044 | Legend | Open Modify with UCT Intelligence | I | I |  |  |
| C2-045 | Legend | Open Edit formula | M | M |  |  |
| C2-046 | Legend | Apply script accuracy upgrade | B | B |  |  |
| C2-047 | Legend | Report mismatch with TradingView | B | B |  |  |
| C2-048 | Undo | Indicator undo and redo buttons | I | I |  |  |
| C2-049 | Copy | Copy indicators to another chart | V* | V* |  |  |
| C2-050 | Copy | Accept or refuse a shared chart's indicators | M | M |  |  |
| C2-051 | Templates | Save indicator template | V* | V* |  |  |
| C2-052 | Templates | Apply indicator template | V* | V* |  |  |
| C2-053 | Templates | Delete indicator template | V* | V* |  |  |
| C2-054 | Templates | List indicator templates | V* | V* |  |  |
| C2-055 | Create | Open Create Indicator | V* | V* |  |  |
| C2-056 | Create | Describe an indicator, get a draft | V* | V* |  |  |
| C2-057 | Create | Refine draft by conversation | I | I |  |  |
| C2-058 | Create | Answer the builder's choice question | I | I |  |  |
| C2-059 | Create | Undo a draft step | I | I |  |  |
| C2-060 | Create | Preview draft on chart | V* | V* |  |  |
| C2-061 | Create | Save draft, acknowledge warnings | V* | V* |  |  |
| C2-062 | Create | Discard draft | V* | V* |  |  |
| C2-063 | Create | Keep draft and close | I | I |  |  |
| C2-064 | Builder | Build by conditions | I | I |  |  |
| C2-065 | Builder | Group conditions, any or all | I | I |  |  |
| C2-066 | Builder | Enter a formula | I | I |  |  |
| C2-067 | Builder | Add or remove member input | I | I |  |  |
| C2-068 | Builder | Add, remove or restyle output plot | I | I |  |  |
| C2-069 | Builder | Set placement and levels | I | I |  |  |
| C2-070 | Builder | Set signal markers | I | I |  |  |
| C2-071 | Builder | Colour candles or background on a signal | I | I |  |  |
| C2-072 | Builder | Name the draft | V* | V* |  |  |
| C2-073 | Builder | Ask for an alert from the builder | I | I |  |  |
| C2-074 | Builder | Run Evidence tab | M | M |  |  |
| C2-075 | Builder | Use a starter | M | M |  |  |
| C2-076 | Import | Paste Pine or thinkScript | M | M |  |  |
| C2-077 | Import | Apply import suggestion | M | M |  |  |
| C2-078 | Import | Change script settings | M | M |  |  |
| C2-079 | Import | Turn script output into a screen | M | M |  |  |
| C2-080 | Image | Read an indicator from a screenshot | M | M |  |  |
| C2-081 | Image | Accept image candidate | M | M |  |  |
| C2-082 | Saved | Open saved definition to edit | I | I |  |  |
| C2-083 | Saved | Delete saved definition | V* | V* |  |  |
| C2-084 | Saved | Share a definition by link | B | B |  |  |
| C2-085 | Saved | Publish to or withdraw from library | B | B |  |  |
| C2-086 | Saved | Install from a share link | B | B |  |  |
| C2-087 | Saved | Restore an older version | M | M |  |  |
| C2-088 | Alerts | Open indicator alerts popover | M | M |  |  |
| C2-089 | Alerts | Create threshold alert | V* | V* |  |  |
| C2-090 | Alerts | Create MA cross alert | V* | V* |  |  |
| C2-091 | Alerts | Choose plot on a multi-line indicator | I | I |  |  |
| C2-092 | Alerts | Alert on a yes/no signal with trigger policy | V~ | V~ |  |  |
| C2-093 | Alerts | Alert on another timeframe | V* | V* |  |  |
| C2-094 | Alerts | Limit alert to this chart | M | M |  |  |
| C2-095 | Alerts | Override alert inputs | M | M |  |  |
| C2-096 | Alerts | Choose which instance | V* | V* |  |  |
| C2-097 | Alerts | List indicator alerts | V* | V* |  |  |
| C2-098 | Alerts | Pause or resume alert | V* | V* |  |  |
| C2-099 | Alerts | Delete alert | V* | V* |  |  |
| C2-100 | Alerts | See why an alert cannot fire | I | I |  |  |
| C3-001 | Board | Add a widget from Widgets ▾ | V* | V* |  |  |
| C3-002 | Board | Drag a widget to move it, or nudge it | V~ | V~ |  |  |
| C3-003 | Board | Drag a widget edge or merged seam to resize | V~ | V~ |  |  |
| C3-004 | Board | Close a widget | V* | V* |  |  |
| C3-005 | Board | Merge or unmerge widgets (lock board, drop borders) | M | M |  |  |
| C3-006 | Link | Cycle a widget's link colour | V~ | V~ |  |  |
| C3-007 | Link | Change a tool panel's colour group | M | M |  |  |
| C3-008 | Float | Float a widget over another | M | M |  |  |
| C3-009 | Float | Drag or resize a floating widget | B | B |  |  |
| C3-010 | Float | Dock a floating widget back into the grid | M | M |  |  |
| C3-011 | Float | Move a floating widget into another widget's tabs | M | M |  |  |
| C3-012 | Popout | Pop a widget into its own window | M | M |  |  |
| C3-013 | Popout | Pop out the whole layout | M | M |  |  |
| C3-014 | Popout | Dock a popped widget or layout back | M | M |  |  |
| C3-015 | Popout | Close a popped widget | M | M |  |  |
| C3-016 | Widget tabs | Add a widget as a tab | V~ | V~ |  |  |
| C3-017 | Widget tabs | Switch a widget tab | V~ | V~ |  |  |
| C3-018 | Widget tabs | Rename a widget tab | I | I |  |  |
| C3-019 | Widget tabs | Close a widget tab | V~ | V~ |  |  |
| C3-020 | Chart tabs | Add a chart tab | V* | V* |  |  |
| C3-021 | Chart tabs | Switch a chart tab | V* | V* |  |  |
| C3-022 | Chart tabs | Rename a chart tab | V* | V* |  |  |
| C3-023 | Chart tabs | Change a chart tab's link colour | I | I |  |  |
| C3-024 | Chart tabs | Close a chart tab | V* | V* |  |  |
| C3-025 | Layout Dock | Open a saved layout | V* | V* |  |  |
| C3-026 | Layout Dock | See which layout is open | V* | V* |  |  |
| C3-027 | Layout Dock | Undo a layout switch from the toast | I | I |  |  |
| C3-028 | Layout Dock | Create a new layout from the dock | V* | V* |  |  |
| C3-029 | Layout Dock | Start a new blank board from the Layouts menu | I | I |  |  |
| C3-030 | Layout Dock | Save the open layout | V~ | V~ |  |  |
| C3-031 | Layout Dock | Save as a new layout | V* | V* |  |  |
| C3-032 | Layout Dock | Save a layout as a global template (admin) | B | B |  |  |
| C3-033 | Layout Dock | Rename a layout | V* | V* |  |  |
| C3-034 | Layout Dock | Duplicate a layout | V* | V* |  |  |
| C3-035 | Layout Dock | Delete a layout | V* | V* |  |  |
| C3-036 | Layout Dock | Delete a prebuilt template (admin) | B | B |  |  |
| C3-037 | Layout Dock | Pin a layout to the bar | M | M |  |  |
| C3-038 | Layout Dock | Reorder layouts on the bar | M | M |  |  |
| C3-039 | Layout Dock | Remove a layout from the bar | M | M |  |  |
| C3-040 | Layout Dock | View a layout's version history | M | M |  |  |
| C3-041 | Layout Dock | Restore a layout version | M | M |  |  |
| C3-042 | Multi Chart | Enter a preset grid | M | M |  |  |
| C3-043 | Multi Chart | Apply a custom rows × columns grid | M | M |  |  |
| C3-044 | Multi Chart | Exit Multi Chart | B | B |  |  |
| C3-045 | Multi Chart | Toggle crosshair sync | B | B |  |  |
| C3-046 | Multi Chart | Toggle time-range sync | B | B |  |  |
| C3-047 | Multi Chart | Turn on Groups mode | B | B |  |  |
| C3-048 | Multi Chart | Pick a group for the grid | B | B |  |  |
| C3-049 | Multi Chart | Step or switch group | B | B |  |  |
| C3-050 | Multi Chart | Refresh the group | B | B |  |  |
| C3-051 | Multi Chart | Exit Groups | B | B |  |  |
| C3-052 | Multi Chart | Apply a saved grid | B | B |  |  |
| C3-053 | Multi Chart | Save a grid | B | B |  |  |
| C3-054 | Multi Chart | Save a grid as global (admin) | B | B |  |  |
| C3-055 | Multi Chart | Delete a saved grid | B | B |  |  |
| C3-056 | Multi Chart | Set a cell's timeframe | V~ | V~ |  |  |
| C3-057 | Multi Chart | Set a cell's chart style | V* | V* |  |  |
| C3-058 | Multi Chart | Toggle a cell's session | P | P |  |  |
| C3-059 | Multi Chart | Reset a cell to my chart | B | B |  |  |
| C3-060 | Multi Chart | Maximize or restore a cell | B | B |  |  |
| C3-061 | Multi Chart | Open shared grid settings | B | B |  |  |
| C3-062 | Multi Chart | Set an alert from a cell | V~ | V~ |  |  |
| C3-063 | Watchlist | Open a list in a widget (own) | I | I |  |  |
| C3-064 | Watchlist | Open a prebuilt or community list | M | M |  |  |
| C3-065 | Watchlist | Open the Flagged list | M | M |  |  |
| C3-066 | Watchlist | Open a colour-tag list | M | M |  |  |
| C3-067 | Watchlist | Go back to the list picker | M | M |  |  |
| C3-068 | Watchlist | Click a row to load the symbol | V* | V* |  |  |
| C3-069 | Watchlist | Walk the list with arrow keys or space | V* | V* |  |  |
| C3-070 | Watchlist | Create a list | V* | V* |  |  |
| C3-071 | Watchlist | Create a list from a template | M | M |  |  |
| C3-072 | Watchlist | Save a community list to My Lists | M | M |  |  |
| C3-074 | Watchlist | Rename the Flagged list | M | M |  |  |
| C3-075 | Watchlist | Delete a list | V* | V* |  |  |
| C3-076 | Watchlist | Add a symbol | V* | V* |  |  |
| C3-077 | Watchlist | Add to Flagged | V* | V* |  |  |
| C3-078 | Watchlist | Flag or unflag a row (star) | V* | V* |  |  |
| C3-079 | Watchlist | Remove a symbol | V* | V* |  |  |
| C3-080 | Watchlist | Remove all starred symbols from a list | I | I |  |  |
| C3-082 | Watchlist | Sort by a column | V* | V* |  |  |
| C3-083 | Watchlist | Show or hide a column | V* | V* |  |  |
| C3-085 | Watchlist | Reorder columns by drag | M | M |  |  |
| C3-086 | Watchlist | Resize a column | M | M |  |  |
| C3-087 | Watchlist | Reset columns | V* | V* |  |  |
| C3-088 | Watchlist | Write or edit a ticker note | V* | V* |  |  |
| C3-089 | Watchlist | Expand or collapse a list | M | M |  |  |
| C3-091 | Watchlist | Share a tag colour or Flagged | B | B |  |  |
| C3-092 | Watchlist | Make a list public | B | B |  |  |
| C3-093 | Watchlist | Mark a list prebuilt (admin) | B | B |  |  |
| C3-094 | Watchlist | Copy a list to the clipboard | M | M |  |  |
| C3-095 | Watchlist | Export a list as CSV or Excel | M | M |  |  |
| C3-096 | Watchlist | Import tickers | I | I |  |  |
| C3-097 | Watchlist | View or restore list version history | M | M |  |  |
| C3-098 | Watchlist | Set a price alert from a row | V* | V* |  |  |
| C3-099 | Watchlist | Delete an alert from the row popover | V* | V* |  |  |
| C3-100 | Watchlist | Open Full Research or AI from a row | I | I |  |  |
| C3-101 | Watchlist | Compare from a row | V* | V* |  |  |
| C3-102 | Watchlist | Open a row's attention facts | U | U |  |  |
| C3-103 | Watchlist | Change list appearance (canvas, text, tint) | M | M |  |  |
| C3-104 | Watchlist | Save or load a watchlist look | M | M |  |  |
| C3-105 | Watchlist | Track or freeze a linked scan or theme | B | B |  |  |
| C3-106 | Watchlist | Use a saved screen as a list | B | B |  |  |
| C3-107 | Scanner | Pick a preset scan | V~ | V~ |  |  |
| C3-108 | Scanner | Leave a scan, back to the picker | M | M |  |  |
| C3-109 | Scanner | Search the preset list | M | M |  |  |
| C3-110 | Scanner | Read a scan's conditions | V~ | V~ |  |  |
| C3-111 | Scanner | Read a scan's results | V* | V* |  |  |
| C3-112 | Scanner | Refresh a scan | M | M |  |  |
| C3-113 | Scanner | Sort a scan | V* | V* |  |  |
| C3-114 | Scanner | Change scan columns | V* | V* |  |  |
| C3-115 | Scanner | Create a scanner in the workspace | B | B |  |  |
| C3-116 | Scanner | Modify a preset scan's conditions | B | B |  |  |
| C3-117 | Scanner | Open an AI Search scan in the builder and edit conditions | M | M |  |  |
| C3-118 | Scanner | Run or refine a screen from the workspace chat | V* | V* |  |  |
| C3-119 | Scanner | Save a screen run from the workspace | V* | V* |  |  |
| C3-120 | Scanner | Send a scan to Journal | V~ | V~ |  |  |
| C3-121 | Volume Surge | Choose what the scanner watches | V~ | V~ |  |  |
| C3-122 | Volume Surge | Create, rename or delete a scope list | M | M |  |  |
| C3-123 | Volume Surge | Add a ticker to a scope list | M | M |  |  |
| C3-124 | Volume Surge | Set thresholds (RVOL, burst, move, $ floor) | M | M |  |  |
| C3-125 | Volume Surge | Toggle logos | I | I |  |  |
| C3-126 | Volume Surge | Click a row or remove it from the list | I | I |  |  |
| C3-127 | Alerts | See my alerts | V* | V* |  |  |
| C3-128 | Alerts | Create a price alert | V* | V* |  |  |
| C3-129 | Alerts | Delete an alert | V* | V* |  |  |
| C3-130 | Alerts | Click an alert to load the symbol | V* | V* |  |  |
| C3-131 | Alerts | Change Alerts widget appearance | M | M |  |  |
| C3-132 | Alerts | Send alerts to Journal | M | M |  |  |
| C3-133 | News | Filter catalysts up, down or all | I | I |  |  |
| C3-134 | News | Read stored headlines for a symbol | V* | V* |  |  |
| C3-135 | News | Place a headline on the chart | M | M |  |  |
| C3-136 | News | Change News widget appearance | M | M |  |  |
| C3-137 | News | Send the feed to Journal | M | M |  |  |
| C3-138 | TE News | Search headlines | V~ | V~ |  |  |
| C3-139 | TE News | Filter by category, linked symbol or watchlist | P | P |  |  |
| C3-140 | TE News | Apply, rename or delete a filter preset | M | M |  |  |
| C3-141 | TE News | Save or unsave a headline | M | M |  |  |
| C3-142 | TE News | Add or edit a headline note | M | M |  |  |
| C3-143 | TE News | Manage collections | M | M |  |  |
| C3-144 | TE News | Add a headline's ticker to a watchlist | I | I |  |  |
| C3-145 | TE News | Explain a headline or ask about it | I | I |  |  |
| C3-146 | TE News | Jump to live or browse a past day | M | M |  |  |
| C3-147 | TE News | Send a headline to Notebook | M | M |  |  |
| C3-148 | Calendar | Step days in the widget | V~ | V~ |  |  |
| C3-149 | Calendar | Ask who reports on a day from Charts | M | M |  |  |
| C3-150 | Calendar | Ask when a stock reports from Charts | V~ | V~ |  |  |
| C3-151 | Calendar | Filter economic events by stars | I | I |  |  |
| C3-152 | Calendar | Toggle the TBD section | V~ | V~ |  |  |
| C3-153 | Calendar | Sort earnings columns | M | M |  |  |
| C3-154 | Calendar | Show all earnings in a section | M | M |  |  |
| C3-155 | Calendar | Click an earnings row | V* | V* |  |  |
| C3-156 | Calendar | Send a day to Journal | V~ | V~ |  |  |
| C3-157 | Breadth | Read breadth tiles | V* | V* |  |  |
| C3-158 | Breadth | Add or remove a reading | V~ | V~ |  |  |
| C3-159 | Breadth | Switch heatmap and ratio view | M | M |  |  |
| C3-160 | Breadth | Change tile style | M | M |  |  |
| C3-161 | Breadth | Change palette, intensity or background | M | M |  |  |
| C3-162 | Breadth | Drill into a reading | M | M |  |  |
| C3-163 | Breadth | Send a snapshot to Journal | V~ | V~ |  |  |
| C3-164 | Options Flow | Switch market or symbol scope | I | I |  |  |
| C3-165 | Options Flow | Switch the lead view | I | I |  |  |
| C3-166 | Options Flow | Set filters (premium, call/put, type, direction) | M | M |  |  |
| C3-167 | Options Flow | Read the flow | M | M |  |  |
| C3-168 | Options Flow | Click a flow row | V* | V* |  |  |
| C3-169 | Themes | Pick a period or ranking | V~ | V~ |  |  |
| C3-170 | Themes | Flip sort direction | V~ | V~ |  |  |
| C3-171 | Themes | Switch today basis | V~ | V~ |  |  |
| C3-172 | Themes | Open a theme or pick a holding | P | P |  |  |
| C3-173 | Themes | Search themes or tickers | M | M |  |  |
| C3-174 | Themes | Pick, rename or delete a theme set | V~ | V~ |  |  |
| C3-175 | Themes | Edit a set (add, hide, reset, custom theme) | M | M |  |  |
| C3-176 | Themes | Add or remove a stock in a theme | M | M |  |  |
| C3-177 | Themes | Send the ranking to Journal | V~ | V~ |  |  |
| C3-178 | Fundamentals | Switch view | V* | V* |  |  |
| C3-179 | Fundamentals | Read the numbers | V* | V* |  |  |
| C3-180 | Fundamentals | Change appearance or send to Journal | M | M |  |  |
| C3-181 | Profile | Read profile and earnings table | V* | V* |  |  |
| C3-182 | Profile | Click a peer ticker | V* | V* |  |  |
| C3-183 | Indexes | Hide or restore an index | V~ | V~ |  |  |
| C3-184 | Indexes | Send levels to Journal | V~ | V~ |  |  |
| C3-185 | Market Context | Read market context | U | U |  |  |
| C3-186 | Market Context | Send to Journal | M | M |  |  |
| C3-187 | NH/NL | Add or remove a universe | V~ | V~ |  |  |
| C3-188 | NH/NL | Switch universe tab | V~ | V~ |  |  |
| C3-189 | NH/NL | Expand a row or pick a symbol | V* | V* |  |  |
| C3-190 | NH/NL | Toggle logos, font, background | M | M |  |  |
| C3-191 | H/L Pulse | Change Pulse settings | M | M |  |  |
| C3-192 | Market Map | Pick or remove a universe | V~ | V~ |  |  |
| C3-193 | Market Map | Pick X, Y or size axis | P | P |  |  |
| C3-194 | Market Map | Follow the linked list | M | M |  |  |
| C3-195 | Market Map | Cycle labels or zoom | M | M |  |  |
| C3-196 | AI Search | Ask a question or follow one up | I | I |  |  |
| C3-197 | AI Search | Change ask mode, stop or retry | M | M |  |  |
| C3-198 | AI Search | Save, reopen or remove an answer | M | M |  |  |
| C3-199 | AI Search | Copy or speak an answer | M | M |  |  |
| C3-200 | AI Search | Send the conversation to Journal | M | M |  |  |
| C3-201 | Notebook | Open or search a note | P | P |  |  |
| C3-202 | Notebook | Create a note | V~ | V~ |  |  |
| C3-203 | Notebook | Edit a note's title or body | B | B |  |  |
| C3-204 | Notebook | Browse folders | M | M |  |  |
| C3-205 | Period Sort | Start a custom-period sort | M | M |  |  |
| C3-206 | Period Sort | Choose grouping, replay and start mark | M | M |  |  |
| C3-207 | Period Sort | Dock the panel or add it as a tab | M | M |  |  |
| C3-208 | Period Sort | Refresh results | M | M |  |  |
| C3-209 | Replay | Start replay at a date | V* | V* |  |  |
| C3-210 | Replay | Exit replay | V* | V* |  |  |
| C3-211 | Replay | Pick the cutoff by clicking the chart | M | M |  |  |
| C3-212 | Replay | Set replay timeframe | I | I |  |  |
| C3-216 | Company dock | Switch dock tab | V~ | V~ |  |  |
| C3-217 | Company dock | Open or collapse the dock | V~ | V~ |  |  |
| C3-218 | Company dock | Search company info | I | I |  |  |
| C3-219 | Company dock | Open ETF holdings | V~ | V~ |  |  |
| C3-220 | Company dock | Pick a leveraged or inverse ETF | I | I |  |  |
| C3-221 | Workspace | Open the Agent | B | B |  |  |
| C3-222 | Workspace | Change a widget's UCT theme section | M | M |  |  |
| C3-223 | Workspace | Toggle the journal shortcut (Ctrl+Alt+J) | U | U |  |  |
| C1-176 | Right-click | Send chart to Journal | M | M |  |  |
| C1-177 | Right-click | Send chart to Journal, choose where | M | M |  |  |
| C1-178 | Right-click | Ask AI about the symbol on a bar | M | M |  |  |
| C1-179 | Right-click | Add widget, floating at the click | M | M |  |  |

