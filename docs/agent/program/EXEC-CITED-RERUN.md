# Cited-test re-run of 40 NOT VERIFIED execution rows (2026-11-10, pl-auto)

Branch `agent/pl/exec-cited-rerun` off `origin/master` `dfc645ccb3`. Test runs and docs only: no product code and no test was changed.
Input: `docs/agent/program/EXEC-LEDGER-CITED-52.md` (commit `828c30e124`), the 52 NOT VERIFIED rows of `docs/agent/CHARTS_EXECUTION_STATUS.md` that some existing test names. 40 of them are named by a test that is not a held-out phrasing list; 12 are named only by held-out lists (`agentExecHeldOut*.test.js`, `agentGuideHeldOutCov4.test.js`), which hold phrasings and execute nothing.

**Result: 10 of 10 files passed, 0 failed, 0 skipped, 0 todo, no `it.fails`. 35 rows VERIFIED, 5 PARTIAL, 0 GAP. 12 held-out-only rows stay NOT VERIFIED.**

## Method

- Each distinct non-held-out test file cited by the 40 rows (10 files) was run once, as a single-file vitest run, one file at a time, through the shared suite lock (`tools/agent_suite_lock.py`, `--who pl-auto`) at below-normal priority, while other agents held the other slot. Native Windows Node, jsdom, `app/node_modules` as installed (not modified).
- Each run wrote a JSON report (`--reporter=json`). Reports and logs are kept in the pl-auto scratch folder `cited-rerun\` (not committed). The per-row check reads the JSON: every test that carries the row (by its title) must have status `passed`. None was skipped, todo or `it.fails`, and grep finds no `it.fails`, `it.skip`, `it.todo` or KNOWN GAP pin in the 10 files.
- Then the specific test or tests for each row were read and graded:
  - **VERIFIED**: passed, and asserts the row's final outcome through the real Agent panel and reads back state (an outcome test over the real widget, or a panel test reading the board).
  - **PARTIAL**: passed, but only part of the row is covered (or routing / plan-shape only, or a capability unit test without the panel). A row that names several distinct end states (for example "arithmetic/log/percent") is PARTIAL when the test reaches only some of them. A row whose other variant is just another control for the same end state (a keyboard nudge for a move) is not held back for it, and an end state reached by Undo and read back counts.
  - **GAP**: failed, skipped or todo.
- The status doc has no generator. A script recounted its "All actions" table and confirmed it reproduced "Counts by area" exactly, rewrote the rows, rebuilt the counts table (with the PARTIAL column of PR #1016) from the recount, and recounted again; line endings were kept per line.

## Per file

Command for each file (from `C:/w/pl-auto-cr`), with `<file>` and `<name>` filled in:

```
BN_CWD='C:\w\pl-auto-cr\app' timeout 1200 python C:/w/pl-auto/tools/agent_suite_lock.py run --who pl-auto -- powershell -NoProfile -ExecutionPolicy Bypass -File "<scratch>\bn.ps1" node node_modules/vitest/vitest.mjs run src/<file> --reporter=default --reporter=json --outputFile="<scratch>\cited-rerun\<name>.json"
```

| File (app/src/) | Command | Totals line | Duration | Rows cited |
|---|---|---|---:|---|
| `agent/agentContracts.test.js` | `vitest run src/agent/agentContracts.test.js` | Test Files 1 passed (1); Tests 14 passed (14) | 11.86s | C1-011 |
| `agent/agentExecReach.test.jsx` | `vitest run src/agent/agentExecReach.test.jsx` | Test Files 1 passed (1); Tests 23 passed (23) | 190.66s | C3-138 |
| `agent/agentExecRound5.test.jsx` | `vitest run src/agent/agentExecRound5.test.jsx` | Test Files 1 passed (1); Tests 18 passed (18) | 30.42s | C1-011, C3-216, C3-217 |
| `agent/agentIndicatorAlertTruth.test.jsx` | `vitest run src/agent/agentIndicatorAlertTruth.test.jsx` | Test Files 1 passed (1); Tests 57 passed (57) | 18.80s | C2-092 |
| `agent/qa/chartsOutcome/boardArrangement.outcome.test.jsx` | `vitest run src/agent/qa/chartsOutcome/boardArrangement.outcome.test.jsx` | Test Files 1 passed (1); Tests 13 passed (13) | 24.95s | C1-019, C1-022, C3-002, C3-003, C3-006, C3-016, C3-017, C3-019, C3-030, C3-107, C3-150 |
| `agent/qa/chartsOutcome/etfHoldings.outcome.test.jsx` | `vitest run src/agent/qa/chartsOutcome/etfHoldings.outcome.test.jsx` | Test Files 1 passed (1); Tests 6 passed (6) | 11.39s | C3-219 |
| `agent/qa/chartsOutcome/teNewsWatchlist.outcome.test.jsx` | `vitest run src/agent/qa/chartsOutcome/teNewsWatchlist.outcome.test.jsx` | Test Files 1 passed (1); Tests 9 passed (9) | 16.38s | C3-138, C3-139 |
| `agent/qa/chartsOutcome/themeTracker.outcome.test.jsx` | `vitest run src/agent/qa/chartsOutcome/themeTracker.outcome.test.jsx` | Test Files 1 passed (1); Tests 19 passed (19) | 23.29s | C3-169, C3-170, C3-171, C3-172, C3-174 |
| `agent/qa/chartsOutcome/widgetControls.outcome.test.jsx` | `vitest run src/agent/qa/chartsOutcome/widgetControls.outcome.test.jsx` | Test Files 1 passed (1); Tests 7 passed (7) | 13.89s | C3-148, C3-152, C3-183, C3-187, C3-188 |
| `agent/qa/chartsOutcome/widgetDoorRows.outcome.test.jsx` | `vitest run src/agent/qa/chartsOutcome/widgetDoorRows.outcome.test.jsx` | Test Files 1 passed (1); Tests 19 passed (19) | 26.74s | C3-110, C3-120, C3-121, C3-156, C3-158, C3-163, C3-177, C3-184, C3-192, C3-193, C3-201, C3-202 |

## Per row

| Row | Area | Action | Was | File | Test | Result | New state | Reason |
|---|---|---|---|---|---|---|---|---|
| C1-011 | Timeframe | Timeframe keys with repeat-press cycle | IMPLEMENTED / UNVERIFIED | agentExecRound5.test.jsx | "C1-011: one rung up or down the timeframe keys' order" (+ NEGATIVE at the end of the ladder); agentContracts.test.js: next/previous in the chart.setTimeframe enum | pass | VERIFIED (SIMULATED panel test, scripted model, jsdom) | one rung up or down from the chart's own timeframe, read back from opts.tf, Undo; the ends are refused, never wrapped |
| C1-019 | Session | Regular/extended on intraday | IMPLEMENTED / UNVERIFIED | boardArrangement.outcome.test.jsx | C1-019 (held-out phrasing) "a 5-minute chart shows the extended session; Undo turns it off" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | extended asked on a 5m chart, read back from settings.extendedHoursShading; regular reached by Undo and read back |
| C1-022 | Scale | Arithmetic/log/percent from menu | IMPLEMENTED / UNVERIFIED | boardArrangement.outcome.test.jsx | C1-022 (held-out phrasing) "the chart goes to the percent scale; Undo goes back" | pass | PARTIAL (SIMULATED) | covered: percent scale (chart.setScale, settings.percentScale read back, Undo back to arithmetic); not covered: log scale, and asking for arithmetic by name, are not driven by this test |
| C2-092 | Alerts | Alert on a yes/no signal with trigger policy | MISSING | agentIndicatorAlertTruth.test.jsx | "C2-092 through the REAL panel: a yes/no signal alert with its trigger" (held-out phrasings) | pass | VERIFIED (SIMULATED panel test, scripted model, jsdom) | one card; Apply arms the policy and its compiled rule on the server fixture; Undo deletes it |
| C3-002 | Board | Drag a widget to move it, or nudge it | IMPLEMENTED / UNVERIFIED | boardArrangement.outcome.test.jsx | C3-002 (held-out phrasing) "the news widget moves to the right edge, the chart keeps its cell; Undo puts it back" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widget.move through the workspace's own repack, rects read back, Undo; a keyboard nudge reaches the same end state and is not driven separately |
| C3-003 | Board | Drag a widget edge or merged seam to resize | IMPLEMENTED / UNVERIFIED | boardArrangement.outcome.test.jsx | C3-003 (held-out phrasing) "the news widget's bottom edge moves down, the Terminal below gives up the rows; Undo puts both back" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | a shared edge through the product's resolveResize, both widgets read back, Undo |
| C3-006 | Link | Cycle a widget's link colour | IMPLEMENTED / UNVERIFIED | boardArrangement.outcome.test.jsx | C3-006 (held-out phrasing) "the widget joins link group B (green); Undo unlinks it again" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | link colour read back from the board, Undo |
| C3-016 | Widget tabs | Add a widget as a tab | IMPLEMENTED / UNVERIFIED | boardArrangement.outcome.test.jsx | "C3-016 / C3-017 / C3-019: add a Calendar as a tab on the news widget, switch to it, close it" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | add: the widget tabs read back |
| C3-017 | Widget tabs | Switch a widget tab | IMPLEMENTED / UNVERIFIED | boardArrangement.outcome.test.jsx | "C3-016 / C3-017 / C3-019: add a Calendar as a tab on the news widget, switch to it, close it" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | switch: activeWtab read back both ways |
| C3-019 | Widget tabs | Close a widget tab | IMPLEMENTED / UNVERIFIED | boardArrangement.outcome.test.jsx | "C3-016 / C3-017 / C3-019: add a Calendar as a tab on the news widget, switch to it, close it" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | close: the tab is gone from the widget tabs |
| C3-030 | Layout Dock | Save the open layout | IMPLEMENTED / UNVERIFIED | boardArrangement.outcome.test.jsx | C3-030 (held-out phrasing) "the open layout is saved with the board as it is now" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | read back from the layouts fixture server |
| C3-107 | Scanner | Pick a preset scan | IMPLEMENTED / UNVERIFIED | boardArrangement.outcome.test.jsx | C3-107 (held-out phrasing) "the Scanner widget shows that preset; Undo goes back" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | scanKey and scanName read back, Undo |
| C3-110 | Scanner | Read a scan's conditions | MISSING | widgetDoorRows.outcome.test.jsx | C3-110 "what are the conditions on my scanner" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | the answer carries the widget's own criteria; the board is unchanged |
| C3-120 | Scanner | Send a scan to Journal | MISSING | widgetDoorRows.outcome.test.jsx | C3-120 "send this scan to my journal" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | proposed first, nothing sent before Apply, the Journal fixture receives the scan's own capture |
| C3-121 | Volume Surge | Choose what the scanner watches | MISSING | widgetDoorRows.outcome.test.jsx | C3-121 "make the volume surge watch my Core list" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | volActive read back, the scope pill shows Core, Undo |
| C3-138 | TE News | Search headlines | MISSING | teNewsWatchlist.outcome.test.jsx | "C3-138: search the News widget through its own search box" (held-out phrasings, clear, NEGATIVE); agentExecReach.test.jsx: search held-out7 (routing reach only) | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | the search box value and the shown headlines read back, Undo clears; the reach test is routing only |
| C3-139 | TE News | Filter by category, linked symbol or watchlist | MISSING | teNewsWatchlist.outcome.test.jsx | "C3-139: the News widget filtered to one of the member's watchlists, through its own select" | pass | PARTIAL (SIMULATED) | covered: the watchlist filter (watchlistId and the shown headlines read back, Undo, NEGATIVE); not covered: the category filter and the linked-symbol filter |
| C3-148 | Calendar | Step days in the widget | MISSING | widgetControls.outcome.test.jsx | "show tomorrow on the terminal" (UCT Terminal, C3-148) | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | the day read back from the widget door and its text, Undo back to the first day |
| C3-150 | Calendar | Ask when a stock reports from Charts | IMPLEMENTED / UNVERIFIED | boardArrangement.outcome.test.jsx | C3-150 (held-out phrasings) "the earnings read answers with the date, no change to the board" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | the answer carries the next report date from a fixture; the board is unchanged |
| C3-152 | Calendar | Toggle the TBD section | MISSING | widgetControls.outcome.test.jsx | "expand the time tbd list on the terminal" (C3-152) | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | the TBD rows are drawn on expand and hidden on collapse, read from the widget's DOM |
| C3-156 | Calendar | Send a day to Journal | MISSING | widgetDoorRows.outcome.test.jsx | "Send to Journal over the real widgets' own capture doors", case C3-156 | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | proposed first; the Journal fixture receives the calendar capture as a new note |
| C3-158 | Breadth | Add or remove a reading | MISSING | widgetDoorRows.outcome.test.jsx | C3-158 "take the up 4% reading off the breadth widget" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | hiddenMetrics read back; the reading is shown again by Undo (adding a reading back is reached by Undo, not asked by name) |
| C3-163 | Breadth | Send a snapshot to Journal | MISSING | widgetDoorRows.outcome.test.jsx | "Send to Journal over the real widgets' own capture doors", case C3-163 | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | proposed first; the Journal fixture receives the breadth capture in the inbox |
| C3-169 | Themes | Pick a period or ranking | MISSING | themeTracker.outcome.test.jsx | C3-169 "show the theme tracker for the past month" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | the order the tracker draws read back, door period, Undo |
| C3-170 | Themes | Flip sort direction | MISSING | themeTracker.outcome.test.jsx | C3-170 "sort the theme tracker ascending" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | the drawn order flips, door sortDir |
| C3-171 | Themes | Switch today basis | MISSING | themeTracker.outcome.test.jsx | C3-171 "theme tracker from the open" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | drawn order and opts.todayBasis read back |
| C3-172 | Themes | Open a theme or pick a holding | IMPLEMENTED / UNVERIFIED | themeTracker.outcome.test.jsx | C3-172 "open the software theme in the theme tracker" | pass | PARTIAL (SIMULATED) | covered: opening a theme by its name (door openTheme, its holdings drawn); not covered: picking a holding inside the open theme |
| C3-174 | Themes | Pick, rename or delete a theme set | MISSING | themeTracker.outcome.test.jsx | C3-174 "switch the theme tracker to my Mine set" + "Theme Tracker theme sets: rename and delete" (held-out phrasings) | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | pick, rename (Undo) and delete (after Apply) read back from the set list; NEGATIVE refusals |
| C3-177 | Themes | Send the ranking to Journal | MISSING | widgetDoorRows.outcome.test.jsx | "Send to Journal over the real widgets' own capture doors", case C3-177 | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | proposed first; the Journal fixture receives the themes capture |
| C3-183 | Indexes | Hide or restore an index | MISSING | widgetControls.outcome.test.jsx | "Indexes (C3-183): hide or restore an index" (hide + Undo, restore by name, NEGATIVE) | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | tiles read from the widget DOM, hiddenSymbols, Undo |
| C3-184 | Indexes | Send levels to Journal | MISSING | widgetDoorRows.outcome.test.jsx | "Send to Journal over the real widgets' own capture doors", case C3-184 (+ NEGATIVE Dismiss) | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | proposed first; the Journal fixture receives the indexes capture; Dismiss sends nothing |
| C3-187 | NH/NL | Add or remove a universe | MISSING | widgetControls.outcome.test.jsx | "New Highs / Lows (C3-187, C3-188)": add, switch, remove | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | tabs read from the widget DOM after add and after remove; NEGATIVE: the last universe stays |
| C3-188 | NH/NL | Switch universe tab | MISSING | widgetControls.outcome.test.jsx | "New Highs / Lows (C3-187, C3-188)": add, switch, remove | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | activeUniverse read back after the switch |
| C3-192 | Market Map | Pick or remove a universe | MISSING | widgetDoorRows.outcome.test.jsx | "C3-192 / C3-193: add the Nasdaq 100 to the Market Map ... remove it again" | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | universes read back from the door after add and after remove |
| C3-193 | Market Map | Pick X, Y or size axis | MISSING | widgetDoorRows.outcome.test.jsx | "C3-192 / C3-193: ... day change on Y and size by market cap" + NEGATIVE axis | pass | PARTIAL (SIMULATED) | covered: the Y axis and the size axis (yKey, sizeKey read back); not covered: picking an X axis (only the refusal of an axis the map lacks is tested) |
| C3-201 | Notebook | Open or search a note | MISSING | widgetDoorRows.outcome.test.jsx | "the Notebook widget (C3-201 open a note by its name)" + NEGATIVE | pass | PARTIAL (SIMULATED) | covered: opening a note by its name (noteId read back, Undo; an ambiguous or unknown name is refused); not covered: the widget's own note search |
| C3-202 | Notebook | Create a note | MISSING | widgetDoorRows.outcome.test.jsx | "the Notebook widget: create a note through its own New control (C3-202)" (held-out phrasings) | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | nothing posted before Apply; one POST to the fixture; the new note opens and is in the widget list |
| C3-216 | Company dock | Switch dock tab | MISSING | agentExecRound5.test.jsx | C3-216 "show the ownership tab on the company panel" | pass | VERIFIED (SIMULATED panel test, scripted model, jsdom) | opts.dock tab read back, Undo; reads stored state, not the dock DOM |
| C3-217 | Company dock | Open or collapse the dock | MISSING | agentExecRound5.test.jsx | C3-217 "collapse the company panel" / "open the company info panel" + NEGATIVE (no panel) | pass | VERIFIED (SIMULATED panel test, scripted model, jsdom) | opts.dock open read back both ways, Undo; reads stored state, not the dock DOM |
| C3-219 | Company dock | Open ETF holdings | MISSING | etfHoldings.outcome.test.jsx | "C3-219: the chart's View Holdings button, through its door" (held-out phrasings, NEGATIVE on a stock) | pass | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | the holdings panel is on the page, the door reads it open, Undo closes it |

VERIFIED (35): C1-011, C1-019, C2-092, C3-002, C3-003, C3-006, C3-016, C3-017, C3-019, C3-030, C3-107, C3-110, C3-120, C3-121, C3-138, C3-148, C3-150, C3-152, C3-156, C3-158, C3-163, C3-169, C3-170, C3-171, C3-174, C3-177, C3-183, C3-184, C3-187, C3-188, C3-192, C3-202, C3-216, C3-217, C3-219.

PARTIAL (5): C1-022, C3-139, C3-172, C3-193, C3-201.

GAP: none.

## Held-out-only rows, for pl-exec (12)

These rows are named only by held-out phrasing lists, which execute nothing. They stay NOT VERIFIED, with their state unchanged; each needs an execution test (an outcome test over the real widget, through the real panel, that reads the end state back).

| Row | Area | Action | State | Named only by |
|---|---|---|---|---|
| C1-065 | Settings | Legend bar-info fields | MISSING | agentExecHeldOut.test.js |
| C1-066 | Settings | Info-row fields | MISSING | agentExecHeldOut.test.js, agentGuideHeldOutCov4.test.js |
| C3-125 | Volume Surge | Toggle logos | IMPLEMENTED / UNVERIFIED | agentExecHeldOut.test.js, agentExecHeldOut2.test.js |
| C3-133 | News | Filter catalysts up, down or all | IMPLEMENTED / UNVERIFIED | agentExecHeldOut.test.js |
| C3-151 | Calendar | Filter economic events by stars | IMPLEMENTED / UNVERIFIED | agentExecHeldOut.test.js |
| C3-159 | Breadth | Switch heatmap and ratio view | MISSING | agentExecHeldOut.test.js |
| C3-164 | Options Flow | Switch market or symbol scope | IMPLEMENTED / UNVERIFIED | agentExecHeldOut.test.js |
| C3-165 | Options Flow | Switch the lead view | IMPLEMENTED / UNVERIFIED | agentExecHeldOut.test.js |
| C3-166 | Options Flow | Set filters (premium, call/put, type, direction) | MISSING | agentExecHeldOut.test.js, agentExecHeldOut2.test.js |
| C3-194 | Market Map | Follow the linked list | MISSING | agentExecHeldOut.test.js |
| C3-195 | Market Map | Cycle labels or zoom | MISSING | agentExecHeldOut.test.js, agentExecHeldOut2.test.js |
| C3-206 | Period Sort | Choose grouping, replay and start mark | MISSING | agentExecHeldOut.test.js |

## Counts after this re-run

VERIFIED 158 → 193, PARTIAL 0 → 5, IMPLEMENTED / UNVERIFIED 112 → 99, MISSING 154 → 127; BLOCKED 47, UNMAPPED 13, in scope 484 and excluded 19 unchanged. 193 of 484 is 39.9%.

PR #1016 (chart settings) and exec-multichart also edit these totals and the same table. Whichever merges later rebases and recounts.

## Caveats

- The model is scripted: each test hands the panel the plan a correct model would send. This proves the Agent is given what it needs and that a correct plan reaches the right state, not that the real model picks that plan.
- jsdom, not a real browser: widgets render in jsdom, and the chart canvas does not draw. Data, servers (layouts, Journal, notes, alerts, earnings) and news are fixtures with invented values.
- C3-216 and C3-217 read the stored `opts.dock`, not the rendered dock. C3-110 and C3-150 are reads: the answer is asserted and the board is unchanged.
- The agentExecReach result for C3-138 is routing reach only and is not what raises the row; the teNewsWatchlist outcome test is.
- Nothing here ran in production or against the real backend.
