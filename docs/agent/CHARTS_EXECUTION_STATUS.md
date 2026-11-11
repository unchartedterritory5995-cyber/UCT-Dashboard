# Charts execution status

Companion to `docs/agent/CHARTS_COVERAGE_MATRIX.md`, and it supersedes that file's execution counts. Generated 2026-11-05 against agent/pl/integration-1 by running the cited tests. VERIFIED means a real panel test with a scripted model passed and asserts state. It does not prove the real model chooses that plan, and these features are not all in production yet.

# Charts execution status

Built on `agent/pl/bar-time-coverage` from `agent/pl/integration-1` `b07a97d526`, on 2026-11-05. Inventory read at `179d57570d`. Every test below was run, not read: 8116 passed and 0 failed in the Agent suites, under the suite lock, with a scratch hook that recorded which tests really mounted the Agent panel.

## The number

> **Re-measurement 2026-11-11 (owner decision of 2026-11-10).** The 225/484 below was first measured on a stale test installation (the 2026-11-06 `node_modules`; the master ledger run on that install, `b2300e547d`, was voided by AUDIT and is kept at `docs/agent/program/evidence/remeasure-1016/old-stale-b2300e547d/`). By the owner's decision of 2026-11-10 that **original 225/484 result is INVALID** as evidence. **Re-measured with the same method on a verified install: 225 of 484 VERIFIED (46.5%): 188 re-proved by a passed cited test, 37 file-level only (citation not matched, all named test files passed), 0 not re-proved.** The number did not change and no row changed state. See "Re-measurement 2026-11-11" below.

> **Since the re-measure:** it confirmed **225/484** on master `75421184a3`. #1029 (merged as `4dacc81529`) then verified C3-166, giving the **226** below; that one row rests on #1029's own evidence, not on the re-measure run.

**243 of 484 actions, 50.2%, are VERIFIED at panel level with a scripted model** (158 in the 2026-11-05 run, plus 85 on 2026-11-10: 29 from the chart-settings outcome test, 3 from the Multi Chart outcome test, 35 from the cited-test re-run, 1 from the Options Flow chips, 17 from the data-widget actions and watchlist groups A–D). A further 11 are PARTIAL (SIMULATED): part of the action passes, part is not covered. See "Update 2026-11-10: combined execution packets (PR #1016)" below. That proves the Agent is given what it needs and that a correct plan reaches the right state. It does not prove the real model picks that plan, and it does not prove the real chart redraws.

- Production evidence with the real planner covers 13 of those 158 rows, from the 2026-11-03 live run on the older build `463a4bcba5`, read by receipt and some server reads.
- Real component in a browser, Agent executing: 0 rows. The browser runs in teach-status.md prove walkthroughs, where a person clicks. They never ran an Agent plan.
- A further 28 rows have a passing runtime test (capability and writer, no panel). They are IMPLEMENTED / UNVERIFIED and are not in the 243. (It was 43 on 2026-11-05; 14 of them were raised on 2026-11-10.)
- P0 actions: 58 of 74 VERIFIED (as of 2026-11-05; this doc carries no per-row P0 tag, so the 2026-11-10 update did not recount it).

## Re-measurement 2026-11-11 (owner decision 4, 2026-11-10)

Owner decision of 2026-11-10: "Re-measure #1016's execution coverage using a correct, reproducible test installation. Mark the previous 225/484 result as invalid until verified." The previous 225/484 is INVALID (stale install, see "The number"). This is the re-measurement.

- Evidence: `docs/agent/program/evidence/remeasure-1016/attempt-2/` (raw outputs committed before interpretation). Script: `docs/agent/program/evidence/remeasure-1016/remeasure.sh attempt-2`, one run, 2026-11-11 02:50-03:22Z. Attempt-1 (`attempt-1/`) was interrupted by a PC crash after 8 of 12 packet files; it is kept and not used.
- Tree: `644b6d7188` = master `75421184a3` plus docs only (app/ diff against master empty, nothing uncommitted under app/). Install: `app/node_modules` is a junction to `C:\w\pl-mc-fw\app\node_modules`; every `package-lock.json` pin is installed at its version (539 match, 0 mismatched). Harness: `recount.mjs` from `6f9abd8515`. Scripted model, jsdom; not a real browser and not the real model.
- #1016's 12 packet files, each run alone: 12 of 12 passed (238 tests passed, 0 failed, 24 todo).
- `src/agent` (the ledger command): 314 files, 9845 passed, 0 failed, 14 skipped.
- Recount of the "All actions" table: VERIFIED 225, PARTIAL 9, IMPLEMENTED / UNVERIFIED 69, MISSING 126, BLOCKED 43, UNMAPPED 12; 484 in scope, 19 excluded. Unchanged.

| Part | In scope | OLD doc V | OLD re-proved | OLD file-level | NEW doc V | NEW re-proved | NEW file-level | NEW not re-proved |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| C1 | 168 | 103 | 101 | 2 | 103 | 101 | 2 | 0 |
| C2 | 100 | 39 | 38 | 1 | 39 | 38 | 1 | 0 |
| C3 | 216 | 83 | 49 | 34 | 83 | 49 | 34 | 0 |
| **Total** | 484 | 225 | 188 | 37 | 225 | 188 | 37 | 0 |

OLD = the voided run on the stale install; NEW = this run. Per-area table and per-row ledger: `attempt-2/compare.md`, `attempt-2/ledger.md`. 0 rows differ between OLD and NEW. A weakness the method keeps: 37 VERIFIED rows (34 in C3) are proved only at file level, because their citation names no test the recount can match.

## Update 2026-11-11: Drawing Boards execution (agent/pl/drawing-boards-exec)

The Agent switches, creates, renames and deletes Drawing Boards through the Boards panel's own store writers (drawingsStore setActiveTracing / createTracing / renameTracing / deleteTracing, via host.drawingBoards), reads the result back and waits for the server's tracings_doc. Delete is always a confirmation card that names the board and its drawing count, with no Undo. An unnamed or ambiguous board is asked about. A board request aimed at one chart is answered and not run. Test: `app/src/agent/qa/chartsOutcome/drawingBoards.outcome.test.jsx` (real panel, scripted model, jsdom, SIMULATED), plus `app/src/agent/agentDrawingBoards.test.jsx` (runtime). PR doc: `docs/agent/program/PR-exec-drawing-boards.md`.

- VERIFIED (4): C1-167, C1-168, C1-169, C1-170; was MISSING (4): C1-167, C1-168, C1-169, C1-170.
- Counts are not changed here: the summary numbers and tables are recounted at merge (rows C1-167..170 above are the only change).

## Update 2026-11-10 (3): data-widget actions and watchlist groups A–D (agent/pl/exec-widget-actions)

One widget-action layer: every row is data in `widgets/widgetControls.js` / `agent/widgetNames.js`, run by `widget.setOption` through the widget's own door (`pages/charts/widgetDoors.js`). New row types: `action` (a widget's own button, `act(key)`; done only once it resolves, nothing to undo) and `color` (#rrggbb). New capability: `watchlist.arrangeColumns` (the header drag's and the gridline's own results, now shared with the drag). Tests: real Agent panel beside the REAL widgets (Alerts, News, Market Context, AI Search, Fundamentals, Scanner, Period Sort, Watchlist), scripted model, jsdom, SIMULATED. Held-out phrasings were committed before each change and failed before it (48 of 48). PR doc: `docs/agent/program/PR-exec-widget-actions.md`.

- VERIFIED (17): C3-132, C3-137, C3-186, C3-200, C3-112, C3-208, C3-108, C3-104, C3-074, C3-085, C3-086, C3-063, C3-064, C3-065, C3-067, C3-094, C3-095; was IMPLEMENTED / UNVERIFIED (1): C3-063; was MISSING (16): C3-064, C3-065, C3-067, C3-074, C3-085, C3-086, C3-094, C3-095, C3-104, C3-108, C3-112, C3-132, C3-137, C3-186, C3-200, C3-208.
- PARTIAL (SIMULATED) (2): C3-180, C3-103; was MISSING (2): C3-103, C3-180. C3-103: no gradient, fonts, grid or tint colours. C3-180: the Journal half only.
- Known gap, pinned both ways: "narrow the price column to 50" (C3-086) is answered by the quote fast path before the model. Not this PR: C3-166 (the Options Flow chips, F-16 widened) is #1029's row, VERIFIED there. Deferred: C3-071, C3-072, C3-097 (see the PR doc).
- Recounted from the "All actions" table by `recount-widget-actions.mjs` (it first reproduces the previous "Counts by area" exactly from the previous rows).

## Update 2026-11-10 (4): the Options Flow widget's chips, F-16 widened (agent/pl/exec-flow-filters)

The owner widened F-16 to every existing Options Flow widget chip (Calls / Puts, Sweep / Block, Bull / Bear, the premium floor), through the widget’s own control (widget.setOption → opts.filters), never a screen, no hidden field, no data read, no trade. Built on #872 (Calls only). Test: `app/src/agent/qa/chartsOutcome/flowFilters.outcome.test.jsx` over the REAL OptionsFlowWidget beside the real panel (scripted model, jsdom, SIMULATED). PR doc: `docs/agent/program/PR-exec-flow-filters.md`.

- VERIFIED (1): C3-166; was MISSING (1): C3-166.
- Recounted from the "All actions" table by `recount-flow-filters.mjs` (it first reproduces the previous "Counts by area" exactly from the previous rows).

## Update 2026-11-10: combined execution packets (PR #1016)

PR #1016 now carries three execution packets. Each row below keeps the state its own packet gave it; no row was changed by two packets (checked before writing). The counts were recounted from the "All actions" table after the union, never summed by hand. Evidence for every packet: vitest, scripted model, jsdom, fixture data; not a real browser and not the real model. One failing constituent holds the whole PR.

### Chart display settings (agent/pl/exec-chart-settings, head `2c218074ac`)

Test: `app/src/agent/qa/chartsOutcome/chartSettings.outcome.test.jsx`, one table-driven outcome test. Each case reads the chart's stored settings back through `settingValue`, checks the other three charts are untouched, and checks Undo. Ledger and gap list: `docs/agent/program/EXEC-CHART-SETTINGS.md`.

- VERIFIED (29): C1-015, C1-016, C1-017, C1-018, C1-024, C1-050, C1-051, C1-052, C1-053, C1-054, C1-056, C1-057, C1-059, C1-062, C1-063, C1-064, C1-068, C1-069, C1-070, C1-071, C1-072, C1-073, C1-075, C1-076, C1-080, C1-087, C1-090, C1-091, C2-013; was IMPLEMENTED / UNVERIFIED (28): C1-015, C1-017, C1-018, C1-024, C1-050, C1-051, C1-052, C1-053, C1-054, C1-056, C1-057, C1-059, C1-062, C1-063, C1-064, C1-068, C1-069, C1-070, C1-071, C1-072, C1-073, C1-075, C1-076, C1-080, C1-087, C1-090, C1-091, C2-013; was UNMAPPED (1): C1-016.
- PARTIAL (SIMULATED) (3): C1-055, C1-061, C1-144; was IMPLEMENTED / UNVERIFIED (2): C1-055, C1-144; was MISSING (1): C1-061. C1-055: text size covered, colour refused as inert. C1-061: the centred end state covered, the product's own Reset write `watermarkPos: null` not. C1-144: calculator inputs covered, placing the drawing not.
- Unchanged, pointing to the gap list (7): C1-058, C1-067, C1-077, C1-078, C1-081, C1-092, C1-127.
- Not rows: the 5 held-out routing nouns (axis, scale, crosshair, legend, watermark) are `it.fails` cases, each pinned by a KNOWN GAP sibling. pl-exec's NOT_A_TICKER fix PR flips them.

### Multi Chart (agent/pl/exec-multichart, head `d9e4068388`)

Test: `app/src/agent/qa/chartsOutcome/multiChart.outcome.test.jsx`. It mounts the real AgentPanel in gridMode over the real MultiChartGrid / GridChartCell / useMultiChartState, reads the outcome back from the grid state, the saved `multichart_state`, the cell's canvas props or the alert book, checks the other cells are byte-identical, and checks Undo. Method, per-row table and gap list: `docs/agent/program/EXEC-MULTICHART.md`.

- VERIFIED (3): C3-056, C3-057, C3-062; was BLOCKED (3): C3-056, C3-057, C3-062. C3-062 is VERIFIED with a note, under AUDIT's conditions: the alert is on the NAMED cell's symbol at the asked level and direction, exactly one is added, Undo leaves the book byte-identical, and a CONTROL case and a negative control: the controls prove the request context and the outcome check; the cell-to-symbol choice is made by the scripted model. The cell's right-click "Set alert @ price" entry point is not exercised, and the alert book is a stateful stub in the test file.
- PARTIAL (SIMULATED) (1): C3-058; was BLOCKED (1): C3-058. The intraday half is a persisted per-cell fork, read back; the D/W/M half is cell-local by design (`GridChartCell.jsx:107`, never saved) and is read only as a canvas prop. (The multichart packet had counted PARTIAL inside IMPL / UNVERIFIED; it is in the PARTIAL column here.)
- Unchanged, pointing to the gap list (17): C3-042, C3-043, C3-044, C3-045, C3-046, C3-047, C3-048, C3-049, C3-050, C3-051, C3-052, C3-053, C3-054, C3-055, C3-059, C3-060, C3-061. C3-054 is an owner decision (admin/global scope). The others are really GAP: `gridBoard` is read-only, there is no `multiChart.set` capability, and the layout source has no `kind:'multichart'` filter.
- Stale note corrected: "the Agent refuses every request there (useAgent.js:1836)" is STALE since `cf981857a0` (`useAgent.js:637` scopes the host to the grid; only grid-level writes are refused, `gridMode.js:75`). It is struck through and corrected in place in 18 rows of "Other state changes" and in "Limits".

### Cited-test re-run (agent/pl/exec-cited-rerun, head `0ef40c0b13`)

The 10 non-held-out test files named by 40 NOT VERIFIED rows (ledger `docs/agent/program/EXEC-LEDGER-CITED-52.md`) were each run once, single-file, under the suite lock; all passed. Method, per-file totals and the reason for every row: `docs/agent/program/EXEC-CITED-RERUN.md`.

- VERIFIED (35): C1-011, C1-019, C2-092, C3-002, C3-003, C3-006, C3-016, C3-017, C3-019, C3-030, C3-107, C3-110, C3-120, C3-121, C3-138, C3-148, C3-150, C3-152, C3-156, C3-158, C3-163, C3-169, C3-170, C3-171, C3-174, C3-177, C3-183, C3-184, C3-187, C3-188, C3-192, C3-202, C3-216, C3-217, C3-219; was IMPLEMENTED / UNVERIFIED (11): C1-011, C1-019, C3-002, C3-003, C3-006, C3-016, C3-017, C3-019, C3-030, C3-107, C3-150; was MISSING (24): C2-092, C3-110, C3-120, C3-121, C3-138, C3-148, C3-152, C3-156, C3-158, C3-163, C3-169, C3-170, C3-171, C3-174, C3-177, C3-183, C3-184, C3-187, C3-188, C3-192, C3-202, C3-216, C3-217, C3-219.
- PARTIAL (SIMULATED) (5): C1-022, C3-139, C3-172, C3-193, C3-201; was IMPLEMENTED / UNVERIFIED (2): C1-022, C3-172; was MISSING (3): C3-139, C3-193, C3-201. C1-022: percent only, no log. C3-139: watchlist filter only, no category or linked symbol. C3-172: open a theme, not pick a holding. C3-193: Y and size axes, no X. C3-201: open a note by name, not the note search.
- GAP: none.
- Held-out-only, unchanged, pointing to the doc and listed there for pl-exec (12): C1-065, C1-066, C3-125, C3-133, C3-151, C3-159, C3-164, C3-165, C3-166, C3-194, C3-195, C3-206.
- Where a 2026-11-05 note below says an offer was withdrawn (C3-152, C3-169, C3-170), the outcome test re-run now passes over the real widget, so the row is VERIFIED; the note is left as that run wrote it.

### Combined counts

| | VERIFIED | PARTIAL | IMPL / UNVERIFIED | MISSING | BLOCKED | UNMAPPED | In scope | Excluded |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2026-11-05 | 158 | 0 | 112 | 154 | 47 | 13 | 484 | 19 |
| after chart settings + multichart + cited re-run | 225 | 9 | 69 | 126 | 43 | 12 | 484 | 19 |
| after the Options Flow chips (agent/pl/exec-flow-filters) | 226 | 9 | 69 | 125 | 43 | 12 | 484 | 19 |
| after the data-widget actions + watchlist A–D (agent/pl/exec-widget-actions) | 243 | 11 | 68 | 107 | 43 | 12 | 484 | 19 |

- VERIFIED 225 of 484, 46.5%. PARTIAL is in scope but never VERIFIED (the PARTIAL column PR #1016 introduced).
- Re-run on the combined branch (after both merges): all 12 test files of the three packets were run once each, single-file, under the suite lock, and all passed (chartSettings.outcome 40 passed + 5 known-gap (pinned) + 7 todo; multiChart.outcome 8 passed + 17 todo; the 10 cited files as in EXEC-CITED-RERUN.md). Totals lines: `docs/agent/program/PR-exec-chart-settings.md`.
- How: no generator exists. A script took the base `origin/master` `dfc645ccb3`, applied the union of the packets' row changes (and the multichart packet's note corrections), checked that no row or line was changed by two packets, recounted the "All actions" table into "Counts by area", "The number" and the runtime-only bullet, and kept every line's line ending. The 2026-11-05 sections below are left as that run wrote them, apart from the stale-note correction.

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

| Part | Area | VERIFIED | PARTIAL | IMPL / UNVERIFIED | MISSING | BLOCKED | UNMAPPED | In scope | Excluded |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| C1 | Symbol | 3 | 0 | 1 | 1 | 0 | 0 | 5 | 0 |
| C1 | Timeframe | 3 | 0 | 3 | 0 | 0 | 0 | 6 | 1 |
| C1 | Chart type | 5 | 0 | 0 | 0 | 0 | 0 | 5 | 1 |
| C1 | Session | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 1 |
| C1 | Scale | 2 | 1 | 0 | 1 | 1 | 0 | 5 | 0 |
| C1 | View | 2 | 0 | 0 | 0 | 1 | 0 | 3 | 0 |
| C1 | Go to date | 2 | 0 | 1 | 1 | 0 | 0 | 4 | 0 |
| C1 | Compare | 1 | 0 | 4 | 3 | 0 | 0 | 8 | 0 |
| C1 | Replay | 2 | 0 | 0 | 1 | 1 | 1 | 5 | 0 |
| C1 | Settings | 24 | 2 | 0 | 6 | 0 | 0 | 32 | 0 |
| C1 | Themes | 2 | 0 | 0 | 1 | 0 | 0 | 3 | 0 |
| C1 | Templates | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 1 |
| C1 | Volume | 5 | 0 | 1 | 0 | 0 | 0 | 6 | 1 |
| C1 | Panes | 1 | 0 | 1 | 0 | 0 | 0 | 2 | 1 |
| C1 | Crosshair | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| C1 | Legend | 6 | 0 | 2 | 1 | 0 | 0 | 9 | 0 |
| C1 | Measure | 4 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| C1 | Share | 0 | 0 | 0 | 0 | 4 | 0 | 4 | 0 |
| C1 | Alerts | 6 | 0 | 1 | 1 | 0 | 0 | 8 | 0 |
| C1 | Right-click | 1 | 0 | 1 | 4 | 0 | 0 | 6 | 3 |
| C1 | Settings door | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| C1 | Drawing | 27 | 1 | 2 | 3 | 3 | 2 | 38 | 1 |
| C1 | Boards | 0 | 0 | 0 | 4 | 0 | 0 | 4 | 0 |
| C1 | Keyboard | 2 | 0 | 0 | 0 | 1 | 2 | 5 | 0 |
| C2 | Picker | 0 | 0 | 2 | 1 | 0 | 0 | 3 | 0 |
| C2 | Add | 4 | 0 | 2 | 2 | 0 | 2 | 10 | 0 |
| C2 | Remove | 3 | 0 | 0 | 0 | 0 | 1 | 4 | 0 |
| C2 | Visibility | 4 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| C2 | Read | 1 | 0 | 1 | 0 | 0 | 0 | 2 | 0 |
| C2 | Inputs | 2 | 0 | 2 | 2 | 0 | 0 | 6 | 0 |
| C2 | Style | 3 | 0 | 3 | 0 | 0 | 0 | 6 | 0 |
| C2 | Placement | 1 | 0 | 1 | 0 | 0 | 0 | 2 | 0 |
| C2 | Panes | 1 | 0 | 1 | 0 | 0 | 1 | 3 | 0 |
| C2 | Legend | 0 | 0 | 3 | 2 | 2 | 0 | 7 | 0 |
| C2 | Undo | 0 | 0 | 1 | 0 | 0 | 0 | 1 | 0 |
| C2 | Copy | 1 | 0 | 0 | 1 | 0 | 0 | 2 | 0 |
| C2 | Templates | 4 | 0 | 0 | 0 | 0 | 0 | 4 | 0 |
| C2 | Create | 5 | 0 | 4 | 0 | 0 | 0 | 9 | 0 |
| C2 | Builder | 1 | 0 | 9 | 2 | 0 | 0 | 12 | 0 |
| C2 | Import | 0 | 0 | 0 | 4 | 0 | 0 | 4 | 0 |
| C2 | Image | 0 | 0 | 0 | 2 | 0 | 0 | 2 | 0 |
| C2 | Saved | 1 | 0 | 1 | 1 | 3 | 0 | 6 | 0 |
| C2 | Alerts | 8 | 0 | 2 | 3 | 0 | 0 | 13 | 0 |
| C2 | Mobile | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| C3 | Board | 4 | 0 | 0 | 1 | 0 | 0 | 5 | 0 |
| C3 | Link | 1 | 0 | 0 | 1 | 0 | 0 | 2 | 0 |
| C3 | Float | 0 | 0 | 0 | 3 | 1 | 0 | 4 | 0 |
| C3 | Popout | 0 | 0 | 0 | 4 | 0 | 0 | 4 | 0 |
| C3 | Widget tabs | 3 | 0 | 1 | 0 | 0 | 0 | 4 | 0 |
| C3 | Chart tabs | 4 | 0 | 1 | 0 | 0 | 0 | 5 | 0 |
| C3 | Layout Dock | 8 | 0 | 2 | 5 | 2 | 0 | 17 | 0 |
| C3 | Multi Chart | 3 | 1 | 0 | 2 | 15 | 0 | 21 | 0 |
| C3 | Watchlist | 25 | 1 | 3 | 5 | 5 | 1 | 40 | 4 |
| C3 | Scanner | 10 | 0 | 0 | 2 | 2 | 0 | 14 | 0 |
| C3 | Volume Surge | 1 | 0 | 2 | 3 | 0 | 0 | 6 | 0 |
| C3 | Alerts | 5 | 0 | 0 | 1 | 0 | 0 | 6 | 0 |
| C3 | News | 2 | 0 | 1 | 2 | 0 | 0 | 5 | 0 |
| C3 | TE News | 1 | 1 | 2 | 6 | 0 | 0 | 10 | 0 |
| C3 | Calendar | 5 | 0 | 1 | 3 | 0 | 0 | 9 | 0 |
| C3 | Breadth | 3 | 0 | 0 | 4 | 0 | 0 | 7 | 0 |
| C3 | Options Flow | 2 | 0 | 2 | 1 | 0 | 0 | 5 | 0 |
| C3 | Themes | 5 | 1 | 0 | 3 | 0 | 0 | 9 | 0 |
| C3 | Fundamentals | 2 | 1 | 0 | 0 | 0 | 0 | 3 | 0 |
| C3 | Profile | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| C3 | Indexes | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| C3 | Market Context | 1 | 0 | 0 | 0 | 0 | 1 | 2 | 0 |
| C3 | NH/NL | 3 | 0 | 0 | 1 | 0 | 0 | 4 | 0 |
| C3 | H/L Pulse | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 0 |
| C3 | Market Map | 1 | 1 | 0 | 2 | 0 | 0 | 4 | 0 |
| C3 | AI Search | 1 | 0 | 1 | 3 | 0 | 0 | 5 | 0 |
| C3 | Notebook | 1 | 1 | 0 | 1 | 1 | 0 | 4 | 0 |
| C3 | Period Sort | 1 | 0 | 0 | 3 | 0 | 0 | 4 | 0 |
| C3 | Replay | 2 | 0 | 1 | 1 | 0 | 0 | 4 | 0 |
| C3 | Review | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 3 |
| C3 | Company dock | 3 | 0 | 2 | 0 | 0 | 0 | 5 | 0 |
| C3 | Workspace | 0 | 0 | 0 | 1 | 1 | 1 | 3 | 0 |
| C1 | **all** | 103 | 4 | 17 | 28 | 11 | 5 | 168 | 11 |
| C2 | **all** | 39 | 0 | 32 | 20 | 5 | 4 | 100 | 1 |
| C3 | **all** | 101 | 7 | 19 | 59 | 27 | 3 | 216 | 7 |
| | **Total** | 243 | 11 | 68 | 107 | 43 | 12 | 484 | 19 |

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
| C3-044 | Exit Multi Chart | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-045 | Toggle crosshair sync | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-046 | Toggle time-range sync | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-047 | Turn on Groups mode | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-048 | Pick a group for the grid | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-049 | Step or switch group | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-050 | Refresh the group | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-051 | Exit Groups | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-052 | Apply a saved grid | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-053 | Save a grid | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-055 | Delete a saved grid | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-056 | Set a cell's timeframe | UNMAPPED | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-057 | Set a cell's chart style | UNMAPPED | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-058 | Toggle a cell's session | UNMAPPED | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-059 | Reset a cell to my chart | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-060 | Maximize or restore a cell | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-061 | Open shared grid settings | MISSING | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-062 | Set an alert from a cell | IMPLEMENTED / UNVERIFIED | BLOCKED | Only exists in Multi Chart mode. ~~The Agent refuses every request there (useAgent.js:1836).~~ Corrected 2026-11-10: STALE since cf981857a0; chart operations run on the cells and only grid-level writes are refused (gridMode.js:75). See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart. |
| C3-152 | Toggle the TBD section | IMPLEMENTED / UNVERIFIED | MISSING | The offer was withdrawn: widget.setOption no longer offers tbdOpen because the widget never read it (2469b8c548). |
| C3-160 | Change tile style | IMPLEMENTED / UNVERIFIED | MISSING | The offer was withdrawn: the widget reads a global pref, not opts (2469b8c548). |
| C3-169 | Pick a period or ranking | IMPLEMENTED / UNVERIFIED | MISSING | The offer was withdrawn: the widget ignores opts; agentWidgetOptions now proves it refuses and stores nothing. |
| C3-170 | Flip sort direction | IMPLEMENTED / UNVERIFIED | MISSING | The offer was withdrawn with C3-169. |

## Limits

- Some actions are rowed twice across the parts (for example C1-097 and C2-018, C1-102 and C2-014). The inventory did this and I left it, so the percentage counts both.
- A chart setting row is one key of a shared generic path. Most have no test of their own and stay IMPLEMENTED / UNVERIFIED.
- The four indicator template rows pass with the build flag set. Docs say `VITE_INDICATOR_TEMPLATES_ENABLED` is on in production; the teach harness build had it off, and I could not confirm the production value here.
- ~~The Multi Chart rows went to BLOCKED because the Agent refuses every request in that mode. That is one gate, not 19 separate problems.~~ Corrected 2026-11-10: STALE. Since cf981857a0 the Agent runs chart operations on the grid's cells; the real gate is that the grid object it sees (gridBoard, MultiChartGrid.jsx:232-245) has no writers. See "Update 2026-11-10: combined execution packets (PR #1016)", Multi Chart.

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
| C1-011 | Timeframe | Timeframe keys with repeat-press cycle | VERIFIED (SIMULATED panel test, scripted model, jsdom) | agentExecRound5.test.jsx: "C1-011: one rung up or down the timeframe keys' order" (+ NEGATIVE at the end of the ladder); agentContracts.test.js: next/previous in the chart.setTimeframe enum; see docs/agent/program/EXEC-CITED-RERUN.md | pass 18/18 | panel, scripted model |
| C1-012 | Timeframe | Change timeframe from right-click | NOT ON /CHARTS | none named | n/a | n/a |
| C1-013 | Chart type | Choose chart type in settings | VERIFIED | c:charttype.line | pass 5/5 | panel, scripted model |
| C1-014 | Chart type | Choose chart type from right-click | NOT ON /CHARTS | c:charttype.line | pass 5/5 | n/a |
| C1-015 | Chart type | Breadth Line/Candles quick toggle | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-015 "show the breadth chart as a line" | pass 33/33 (7 todo) | panel, scripted model |
| C1-016 | Chart type | Heikin Ashi candles | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-016 "switch this chart to heikin ashi candles" | pass 33/33 (7 todo) | panel, scripted model |
| C1-017 | Chart type | Candle colour mode | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-017 "color the candles by open vs close" | pass 33/33 (7 todo) | panel, scripted model |
| C1-018 | Chart type | Thin bars | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-018 "make the bars thicker on this chart" | pass 33/33 (7 todo) | panel, scripted model |
| C1-019 | Session | Regular/extended on intraday | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | boardArrangement.outcome.test.jsx: C1-019 (held-out phrasing) "a 5-minute chart shows the extended session; Undo turns it off"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 13/13 | panel, scripted model |
| C1-020 | Session | Regular/extended on D/W/M | VERIFIED | c:session.extended | pass 5/5 | panel, scripted model |
| C1-021 | Session | Extended hours from price-axis menu | NOT ON /CHARTS | c:session.extended | pass 5/5 | n/a |
| C1-022 | Scale | Arithmetic/log/percent from menu | PARTIAL (SIMULATED) — covered: percent scale (chart.setScale, settings.percentScale read back, Undo back to arithmetic); not covered: log scale, and asking for arithmetic by name, are not driven by this test | boardArrangement.outcome.test.jsx: C1-022 (held-out phrasing) "the chart goes to the percent scale; Undo goes back"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 13/13 | panel, scripted model |
| C1-023 | Scale | Toggle log (Shift+L) | VERIFIED | c:scale.log; g:GW-01 | pass 7/7 | production (E-01) and panel |
| C1-024 | Scale | Invert scale (Alt+I) | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-024 "flip the price scale upside down" | pass 33/33 (7 todo) | panel, scripted model |
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
| C1-050 | Settings | Gradient colours | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-050 "give this chart a gradient background with a navy top" | pass 33/33 (7 todo) | panel, scripted model |
| C1-051 | Settings | Crosshair mode | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-051 "only show the crosshair while I hold the mouse" | pass 33/33 (7 todo) | panel, scripted model |
| C1-052 | Settings | Crosshair colour/width/style | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-052 "make the crosshair red, 2px and dashed" | pass 33/33 (7 todo) | panel, scripted model |
| C1-053 | Settings | Magnet crosshair | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-053 "turn on the magnet crosshair" | pass 33/33 (7 todo) | panel, scripted model |
| C1-054 | Settings | Price labels / MA labels | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-054 "hide the last price label and show the moving average labels" | pass 33/33 (7 todo) | panel, scripted model |
| C1-055 | Settings | Scale text size and colour | PARTIAL (SIMULATED) — covered: scale text SIZE (chart.setSetting textSize, read back, Undo); not covered: scale text COLOUR, which chart.setSetting refuses as inert by design (the axes take their ink from the canvas) | chartSettings.outcome.test.jsx: C1-055 "bump the scale text up to 14" | pass 33/33 (7 todo) | panel, scripted model |
| C1-056 | Settings | Watermark on/off (Alt+Shift+W) | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-056 "hide the watermark on this chart" | pass 33/33 (7 todo) | panel, scripted model |
| C1-057 | Settings | Watermark lines | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-057 "take the company name off the watermark and add the logo" | pass 33/33 (7 todo) | panel, scripted model |
| C1-058 | Settings | Watermark alignment | MISSING | none; gap: docs/agent/program/EXEC-CHART-SETTINGS.md (gap list) | n/a | none |
| C1-059 | Settings | Watermark size/weight/colour/opacity | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-059 "make the watermark bigger, bold, blue and 30% opacity" | pass 33/33 (7 todo) | panel, scripted model |
| C1-060 | Settings | Move watermark | VERIFIED | agentChartSettingsTruth: writes opts.watermarkPos | pass 1/1 | panel, scripted model |
| C1-061 | Settings | Reset watermark to centre | PARTIAL (SIMULATED) — covered: the watermark ends centred (watermark.x/y = 0.5 in opts.watermarkPos, Undo); not covered: the product's own Reset write (watermarkPos: null, ChartWidget.jsx:499), which no capability makes | chartSettings.outcome.test.jsx: C1-061 "put the watermark back in the middle" | pass 33/33 (7 todo) | panel, scripted model |
| C1-062 | Settings | Title shows ticker/company/both | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-062 "show the ticker and the company name in the title" | pass 33/33 (7 todo) | panel, scripted model |
| C1-063 | Settings | Day change beside title | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-063 "hide the day change next to the title" | pass 33/33 (7 todo) | panel, scripted model |
| C1-064 | Settings | Legend mode | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-064 "only show the legend when I hold the crosshair" | pass 33/33 (7 todo) | panel, scripted model |
| C1-065 | Settings | Legend bar-info fields | MISSING | none; held-out phrasings only, no execution test: docs/agent/program/EXEC-CITED-RERUN.md (for pl-exec) | n/a | none |
| C1-066 | Settings | Info-row fields | MISSING | none; held-out phrasings only, no execution test: docs/agent/program/EXEC-CITED-RERUN.md (for pl-exec) | n/a | none |
| C1-067 | Settings | Header colours | MISSING | none; gap: docs/agent/program/EXEC-CHART-SETTINGS.md (gap list) | n/a | none |
| C1-068 | Settings | Swing labels on/off and sensitivity | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-068 "turn on swing labels with high sensitivity" | pass 33/33 (7 todo) | panel, scripted model |
| C1-069 | Settings | Swing label background, tint, colours | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-069 "swing labels on, tinted by high and low, green highs, red lows, dark grey background" | pass 33/33 (7 todo) | panel, scripted model |
| C1-070 | Settings | Event markers | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-070 "show earnings and news markers" | pass 33/33 (7 todo) | panel, scripted model |
| C1-071 | Settings | Earnings beat/miss and IPO colours | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-071 "earnings beats in green, misses in red, and a yellow IPO badge" | pass 33/33 (7 todo) | panel, scripted model |
| C1-072 | Settings | Prev-day lines on/off | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-072 "turn off the previous day high line" | pass 33/33 (7 todo) | panel, scripted model |
| C1-073 | Settings | Prev-day line style/width/colour | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-073 "make the prior day low line solid, 3px and magenta" | pass 33/33 (7 todo) | panel, scripted model |
| C1-074 | Settings | Dark-pool levels | VERIFIED | agentChartSettingsW1B: turn on dark pool | pass 1/1 | panel, scripted model |
| C1-075 | Settings | Bar-close countdown (Shift+C) | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-075 "show the bar close countdown" | pass 33/33 (7 todo) | panel, scripted model |
| C1-076 | Settings | Restore defaults | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-076 "restore this chart to the default look" | pass 33/33 (7 todo) | panel, scripted model |
| C1-077 | Settings | Save / delete a custom colour | MISSING | none; gap: docs/agent/program/EXEC-CHART-SETTINGS.md (gap list) | n/a | none |
| C1-078 | Settings | Light/dark palette (Shift+T) | MISSING | none; gap: docs/agent/program/EXEC-CHART-SETTINGS.md (gap list) | n/a | none |
| C1-079 | Themes | Apply a theme to one chart | VERIFIED | c:chart.applyTheme | pass 5/5 | panel, scripted model |
| C1-080 | Themes | Apply a theme to all charts | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-080 "apply a theme to all my charts" | pass 33/33 (7 todo) | panel, scripted model |
| C1-081 | Themes | Apply a theme to all widgets | MISSING | none; gap: docs/agent/program/EXEC-CHART-SETTINGS.md (gap list) | n/a | none |
| C1-082 | Templates | Apply a template | VERIFIED | c:chart.applyTemplate | pass 4/4 | panel, scripted model |
| C1-083 | Templates | Save a template | VERIFIED | c:chartSetup.saveTemplate | pass 5/5 | panel, scripted model |
| C1-084 | Templates | Delete a template | VERIFIED | c:chartSetup.deleteTemplate | pass 4/4 | panel, scripted model |
| C1-085 | Templates | Copy another chart's look | NOT ON /CHARTS | agentChartsOperatorAcceptance.test.jsx | pass 10/10 | n/a |
| C1-086 | Volume | Show/hide volume (Ctrl+V, menu) | VERIFIED | c:volume.hide | pass 5/5 | panel, scripted model |
| C1-087 | Volume | Remove volume | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-087 "remove volume from this chart" | pass 33/33 (7 todo) | panel, scripted model |
| C1-088 | Volume | Separate pane toggle | NOT ON /CHARTS | none | n/a | n/a |
| C1-089 | Volume | Resize volume pane by drag | VERIFIED | agentChartSettingsTruth: the height: writes the pref | pass 1/1 | panel, scripted model |
| C1-090 | Volume | HVC highlight | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-090 "stop highlighting the highest volume candle" | pass 33/33 (7 todo) | panel, scripted model |
| C1-091 | Volume | Volume colours, MA, label, bar style | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C1-091 "volume bars blue up and orange down, a 50 period volume average in white, hide the volume label, histogram bars" | pass 33/33 (7 todo) | panel, scripted model |
| C1-092 | Volume | Overlay indicator on volume | IMPLEMENTED / UNVERIFIED | none; gap: docs/agent/program/EXEC-CHART-SETTINGS.md (gap list) | n/a | source only |
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
| C1-127 | Settings door | Open chart settings (Alt+,, gear) | MISSING | none; gap: docs/agent/program/EXEC-CHART-SETTINGS.md (gap list) | n/a | none |
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
| C1-144 | Drawing | Position calculator | PARTIAL (SIMULATED) — covered: the calculator inputs (positionCalc.accountSize / riskPct, read back, Undo); not covered: placing the position-calculator drawing (drawing family) | chartSettings.outcome.test.jsx: C1-144 "set my position calculator to a 25k account risking half a percent" | pass 33/33 (7 todo) | panel, scripted model |
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
| C1-167 | Boards | Switch drawing board | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | drawingBoards.outcome.test.jsx: "switch to my Earnings board" | pass 6/6 | panel, scripted model |
| C1-168 | Boards | Create a board | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | drawingBoards.outcome.test.jsx: a planned new board called Breakouts | pass 6/6 | panel, scripted model |
| C1-169 | Boards | Rename a board | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | drawingBoards.outcome.test.jsx: "rename my Earnings board to Gaps" | pass 6/6 | panel, scripted model |
| C1-170 | Boards | Delete a board | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | drawingBoards.outcome.test.jsx: the card, Dismiss, Apply; "delete my board" asks | pass 6/6 | panel, scripted model |
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
| C2-013 | Add | Toggle Chart IQ pattern recognition | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | chartSettings.outcome.test.jsx: C2-013 "turn on Chart IQ pattern recognition" | pass 33/33 (7 todo) | panel, scripted model |
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
| C2-092 | Alerts | Alert on a yes/no signal with trigger policy | VERIFIED (SIMULATED panel test, scripted model, jsdom) | agentIndicatorAlertTruth.test.jsx: "C2-092 through the REAL panel: a yes/no signal alert with its trigger" (held-out phrasings); see docs/agent/program/EXEC-CITED-RERUN.md | pass 57/57 | panel, scripted model |
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
| C3-002 | Board | Drag a widget to move it, or nudge it | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | boardArrangement.outcome.test.jsx: C3-002 (held-out phrasing) "the news widget moves to the right edge, the chart keeps its cell; Undo puts it back"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 13/13 | panel, scripted model |
| C3-003 | Board | Drag a widget edge or merged seam to resize | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | boardArrangement.outcome.test.jsx: C3-003 (held-out phrasing) "the news widget's bottom edge moves down, the Terminal below gives up the rows; Undo puts both back"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 13/13 | panel, scripted model |
| C3-004 | Board | Close a widget | VERIFIED | c:widget.remove; closeChart: "close the top-left chart" | pass 7/7 | panel, scripted model |
| C3-005 | Board | Merge or unmerge widgets (lock board, drop borders) | MISSING | none | n/a | none |
| C3-006 | Link | Cycle a widget's link colour | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | boardArrangement.outcome.test.jsx: C3-006 (held-out phrasing) "the widget joins link group B (green); Undo unlinks it again"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 13/13 | panel, scripted model |
| C3-007 | Link | Change a tool panel's colour group | MISSING | none | n/a | none |
| C3-008 | Float | Float a widget over another | MISSING | agentBoard.test.jsx:231 | pass 1/1 | none |
| C3-009 | Float | Drag or resize a floating widget | BLOCKED | none | n/a | none |
| C3-010 | Float | Dock a floating widget back into the grid | MISSING | none | n/a | none |
| C3-011 | Float | Move a floating widget into another widget's tabs | MISSING | none | n/a | none |
| C3-012 | Popout | Pop a widget into its own window | MISSING | none | n/a | none |
| C3-013 | Popout | Pop out the whole layout | MISSING | none | n/a | none |
| C3-014 | Popout | Dock a popped widget or layout back | MISSING | none | n/a | none |
| C3-015 | Popout | Close a popped widget | MISSING | none | n/a | none |
| C3-016 | Widget tabs | Add a widget as a tab | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | boardArrangement.outcome.test.jsx: "C3-016 / C3-017 / C3-019: add a Calendar as a tab on the news widget, switch to it, close it"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 13/13 | panel, scripted model |
| C3-017 | Widget tabs | Switch a widget tab | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | boardArrangement.outcome.test.jsx: "C3-016 / C3-017 / C3-019: add a Calendar as a tab on the news widget, switch to it, close it"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 13/13 | panel, scripted model |
| C3-018 | Widget tabs | Rename a widget tab | IMPLEMENTED / UNVERIFIED | agentBoard.test.jsx:268 | pass 1/1 | runtime, no panel |
| C3-019 | Widget tabs | Close a widget tab | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | boardArrangement.outcome.test.jsx: "C3-016 / C3-017 / C3-019: add a Calendar as a tab on the news widget, switch to it, close it"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 13/13 | panel, scripted model |
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
| C3-030 | Layout Dock | Save the open layout | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | boardArrangement.outcome.test.jsx: C3-030 (held-out phrasing) "the open layout is saved with the board as it is now"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 13/13 | panel, scripted model |
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
| C3-042 | Multi Chart | Enter a preset grid | MISSING | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-043 | Multi Chart | Apply a custom rows × columns grid | MISSING | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-044 | Multi Chart | Exit Multi Chart | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-045 | Multi Chart | Toggle crosshair sync | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-046 | Multi Chart | Toggle time-range sync | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-047 | Multi Chart | Turn on Groups mode | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-048 | Multi Chart | Pick a group for the grid | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-049 | Multi Chart | Step or switch group | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-050 | Multi Chart | Refresh the group | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-051 | Multi Chart | Exit Groups | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-052 | Multi Chart | Apply a saved grid | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-053 | Multi Chart | Save a grid | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-054 | Multi Chart | Save a grid as global (admin) | BLOCKED | none; owner decision (admin/global scope): docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-055 | Multi Chart | Delete a saved grid | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-056 | Multi Chart | Set a cell's timeframe | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | multiChart.outcome.test.jsx: C3-056 "could you flip the top-right one over to a weekly view"; C3-056 (pre-model path) "make the top-right chart weekly" | pass 8/8 (17 todo) | panel, scripted model |
| C3-057 | Multi Chart | Set a cell's chart style | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | multiChart.outcome.test.jsx: C3-057 "turn the bottom-left chart into plain bars" | pass 8/8 (17 todo) | panel, scripted model |
| C3-058 | Multi Chart | Toggle a cell's session | PARTIAL (SIMULATED) — covered: intraday, the cell's own extendedHoursShading fork read back from the saved multichart_state, Undo drops it; not covered as persisted state: D/W/M, whose session view is cell-local by design (GridChartCell.jsx:107, never saved) and is read back only as the prop the real cell hands its stubbed canvas | multiChart.outcome.test.jsx: C3-058 (intraday) "regular hours only on the top-left chart"; C3-058 (D/W/M) "include extended hours on the top-left chart" | pass 8/8 (17 todo) | panel, scripted model |
| C3-059 | Multi Chart | Reset a cell to my chart | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-060 | Multi Chart | Maximize or restore a cell | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-061 | Multi Chart | Open shared grid settings | BLOCKED | none; gap: docs/agent/program/EXEC-MULTICHART.md (gap list) | n/a | none |
| C3-062 | Multi Chart | Set an alert from a cell | VERIFIED (SIMULATED outcome test, scripted model, jsdom) — note: the alert is on the NAMED cell's symbol, at the asked level (250) and direction (above), exactly one added and none on another cell's symbol, and Undo leaves the book byte-identical; a CONTROL case (the member clicked a cell holding a different symbol) and a negative control (a plan alerting the active cell is rejected by the same check): the controls prove the request context and the outcome check; the cell-to-symbol choice is made by the scripted model. The cell's right-click "Set alert @ price" entry point (GridChartCell.jsx:353-360) is NOT exercised: this is the Agent's route to the same outcome. The alert book is a stateful /api/watchlist-alerts stub with the real routes (GET/POST/DELETE) | multiChart.outcome.test.jsx: C3-062 "alert me when the top-right chart goes above 250"; C3-062 CONTROL (clicked top-left NVDA, named top-right AMD); C3-062 CONTROL (the check has teeth: an active-cell plan fails it) | pass 8/8 (17 todo) | panel, scripted model |
| C3-063 | Watchlist | Open a list in a widget (own) | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | agentWatchlistShow.test.jsx: C3-063 held-out x6 (own lists, as the picker writes them; Undo restores the previous watchKey exactly) | pass 35/35 | panel, scripted model |
| C3-064 | Watchlist | Open a prebuilt or community list | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | agentWatchlistShow.test.jsx: C3-064 held-out x12 (prebuilt and community); NEGATIVE near names | pass 35/35 | panel, scripted model |
| C3-065 | Watchlist | Open the Flagged list | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | agentWatchlistShow.test.jsx: C3-065 held-out x3 (Flagged) | pass 35/35 | panel, scripted model |
| C3-066 | Watchlist | Open a colour-tag list | MISSING | none | n/a | none |
| C3-067 | Watchlist | Go back to the list picker | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | agentWatchlistShow.test.jsx: C3-067 held-out x3 (back to the picker) | pass 35/35 | panel, scripted model |
| C3-068 | Watchlist | Click a row to load the symbol | VERIFIED | c:symbol.switch | pass 7/7 | panel, scripted model |
| C3-069 | Watchlist | Walk the list with arrow keys or space | VERIFIED | c:watchlist.step; listControl: previous, and both ends wrap | pass 5/5 | panel, scripted model |
| C3-070 | Watchlist | Create a list | VERIFIED | c:watchlist.create; watchlists.outcome: nothing exists until Apply | pass 5/5 | production (C-05b) and panel |
| C3-071 | Watchlist | Create a list from a template | MISSING | none | n/a | none |
| C3-072 | Watchlist | Save a community list to My Lists | MISSING | none | n/a | none |
| C3-073 | Watchlist | Rename a list | NOT ON /CHARTS | agentWatchlists.test.jsx:222 | pass 1/1 | n/a |
| C3-074 | Watchlist | Rename the Flagged list | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | watchlistLook.outcome.test.jsx: C3-074 "rename my flagged list to Hot Hands", "call the flagged watchlist A-List" (the title menu's renameFlagged; Undo renames back); NEGATIVE not showing Flagged | pass 18/18 | panel, scripted model |
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
| C3-085 | Watchlist | Reorder columns by drag | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | listControl.outcome.test.jsx: C3-085 x4 held-out (move a column before / after another, as the header drop does: the stored order and the header follow; Undo exact); NEGATIVE a hidden or unknown column | pass 114/114 (1 known gap pinned both ways) | panel, scripted model |
| C3-086 | Watchlist | Resize a column | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | listControl.outcome.test.jsx: C3-086 2 of 3 held-out (a width as the gridline sets it; Undo exact); NEGATIVE under the minimum, over 600; KNOWN GAP "narrow the price column to 50" answered by the quote fast path before the model (pinned it.fails + today's output) | pass 114/114 (1 known gap pinned both ways) | panel, scripted model |
| C3-087 | Watchlist | Reset columns | VERIFIED | listControl: reset goes to the defaults | pass 1/1 | panel, scripted model |
| C3-088 | Watchlist | Write or edit a ticker note | VERIFIED | c:watchlist.setNote | pass 4/4 | panel, scripted model |
| C3-089 | Watchlist | Expand or collapse a list | MISSING | none | n/a | none |
| C3-090 | Watchlist | Tag a symbol with a colour | NOT ON /CHARTS | none | n/a | n/a |
| C3-091 | Watchlist | Share a tag colour or Flagged | BLOCKED | none | n/a | none |
| C3-092 | Watchlist | Make a list public | BLOCKED | none | n/a | none |
| C3-093 | Watchlist | Mark a list prebuilt (admin) | BLOCKED | none | n/a | none |
| C3-094 | Watchlist | Copy a list to the clipboard | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | agentWatchlistOut.test.jsx + Watchlists.listout.test.jsx: C3-094 copied only once the clipboard write resolved (a refused write says so); the door reaches exactly the list menu's Copy (real Watchlists) | pass 29/29 + 7/7 | panel, scripted model |
| C3-095 | Watchlist | Export a list as CSV or Excel | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | agentWatchlistOut.test.jsx + Watchlists.listout.test.jsx: C3-095 CSV at once, Excel always proposed first (a quota); own lists only; the door reaches exactly the menu's Export CSV / Excel (real Watchlists) | pass 29/29 + 7/7 | panel, scripted model |
| C3-096 | Watchlist | Import tickers | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-097 | Watchlist | View or restore list version history | MISSING | none | n/a | none |
| C3-098 | Watchlist | Set a price alert from a row | VERIFIED | c:alert.price-above | pass 6/6 | panel, scripted model |
| C3-099 | Watchlist | Delete an alert from the row popover | VERIFIED | c:alert.delete | pass 4/4 | panel, scripted model |
| C3-100 | Watchlist | Open Full Research or AI from a row | IMPLEMENTED / UNVERIFIED | agentBatch1.test.jsx; agentBatch4.test.jsx | pass 39/39 | runtime, no panel |
| C3-101 | Watchlist | Compare from a row | VERIFIED | c:compare.amd | pass 5/5 | panel, scripted model |
| C3-102 | Watchlist | Open a row's attention facts | UNMAPPED | none | n/a | none |
| C3-103 | Watchlist | Change list appearance (canvas, text, tint) | PARTIAL (SIMULATED) — covered: logos, tick-flash tint, solid canvas, text, gain and loss colours through the ⚙ panel's own writer (this widget's opts.settings), the other widget untouched, Undo exact; not covered: gradient canvas, fonts, grid colour, tint colours | watchlistLook.outcome.test.jsx: C3-103 x6 held-out; NEGATIVE "sort of bluish" (#rrggbb) | pass 18/18 | panel, scripted model |
| C3-104 | Watchlist | Save or load a watchlist look | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | watchlistLook.outcome.test.jsx: C3-104 x5 held-out: save the look under a name (shown first; the look the widget had), apply a saved look (Undo exact), delete one (shown first); NEGATIVE unknown look, no name | pass 18/18 | panel, scripted model |
| C3-105 | Watchlist | Track or freeze a linked scan or theme | BLOCKED | none | n/a | none |
| C3-106 | Watchlist | Use a saved screen as a list | BLOCKED | none | n/a | none |
| C3-107 | Scanner | Pick a preset scan | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | boardArrangement.outcome.test.jsx: C3-107 (held-out phrasing) "the Scanner widget shows that preset; Undo goes back"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 13/13 | panel, scripted model |
| C3-108 | Scanner | Leave a scan, back to the picker | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetActions.outcome.test.jsx: C3-108 x4 held-out ("leave this scan in the scanner", "take the scanner back to its picker", …): scanKey / scanName cleared as its own "change scan" does, Undo exact; NEGATIVE already on the picker | pass 24/24 | panel, scripted model |
| C3-109 | Scanner | Search the preset list | MISSING | none | n/a | none |
| C3-110 | Scanner | Read a scan's conditions | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetDoorRows.outcome.test.jsx: C3-110 "what are the conditions on my scanner"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-111 | Scanner | Read a scan's results | VERIFIED | listControl: a Scanner: sorts and reads the same way | pass 1/1 | panel, scripted model |
| C3-112 | Scanner | Refresh a scan | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetActions.outcome.test.jsx: C3-112 x8 held-out ("refresh the scanner", "rerun the scanner now", …): the widget's own SWR mutate runs once, the receipt only after it resolves, a failed re-read claims nothing, two scanners told apart by position | pass 24/24 | panel, scripted model |
| C3-113 | Scanner | Sort a scan | VERIFIED | listControl: a Scanner: sorts and reads the same way | pass 1/1 | panel, scripted model |
| C3-114 | Scanner | Change scan columns | VERIFIED | listControl: a Scanner: sorts and reads the same way | pass 1/1 | panel, scripted model |
| C3-115 | Scanner | Create a scanner in the workspace | BLOCKED | none | n/a | none |
| C3-116 | Scanner | Modify a preset scan's conditions | BLOCKED | none | n/a | none |
| C3-117 | Scanner | Open an AI Search scan in the builder and edit conditions | MISSING | none | n/a | none |
| C3-118 | Scanner | Run or refine a screen from the workspace chat | VERIFIED | c:scan.near-high.sign; c:scan.refine.sector | pass 7/7 | panel, scripted model |
| C3-119 | Scanner | Save a screen run from the workspace | VERIFIED | c:screener.saveAs | pass 4/4 | panel, scripted model |
| C3-120 | Scanner | Send a scan to Journal | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetDoorRows.outcome.test.jsx: C3-120 "send this scan to my journal"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-121 | Volume Surge | Choose what the scanner watches | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetDoorRows.outcome.test.jsx: C3-121 "make the volume surge watch my Core list"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-122 | Volume Surge | Create, rename or delete a scope list | MISSING | none | n/a | none |
| C3-123 | Volume Surge | Add a ticker to a scope list | MISSING | none | n/a | none |
| C3-124 | Volume Surge | Set thresholds (RVOL, burst, move, $ floor) | MISSING | none | n/a | none |
| C3-125 | Volume Surge | Toggle logos | IMPLEMENTED / UNVERIFIED | agentWidgetOptions.test.jsx:49; held-out phrasings only, no execution test: docs/agent/program/EXEC-CITED-RERUN.md (for pl-exec) | pass 1/1 | runtime, no panel |
| C3-126 | Volume Surge | Click a row or remove it from the list | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-127 | Alerts | See my alerts | VERIFIED | alerts.outcome: nothing reaches the server until Apply | pass 1/1 | panel, scripted model |
| C3-128 | Alerts | Create a price alert | VERIFIED | c:alert.price-above; alerts.outcome: nothing reaches the server until Apply | pass 7/7 | panel, scripted model |
| C3-129 | Alerts | Delete an alert | VERIFIED | c:alert.delete; alerts.outcome: the proposal says what goes and that it is permanent | pass 5/5 | panel, scripted model |
| C3-130 | Alerts | Click an alert to load the symbol | VERIFIED | c:symbol.switch | pass 7/7 | panel, scripted model |
| C3-131 | Alerts | Change Alerts widget appearance | MISSING | none | n/a | none |
| C3-132 | Alerts | Send alerts to Journal | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetJournal.outcome.test.jsx: C3-132 "drop my alerts into the journal" (the real Alerts widget's capture door; shown first; the other widget untouched) | pass 7/7 | panel, scripted model |
| C3-133 | News | Filter catalysts up, down or all | IMPLEMENTED / UNVERIFIED | agentWidgetOptions.test.jsx:49; held-out phrasings only, no execution test: docs/agent/program/EXEC-CITED-RERUN.md (for pl-exec) | pass 1/1 | runtime, no panel |
| C3-134 | News | Read stored headlines for a symbol | VERIFIED | c:news.latest; c:news.catalysts | pass 9/9 | panel, scripted model |
| C3-135 | News | Place a headline on the chart | MISSING | none | n/a | none |
| C3-136 | News | Change News widget appearance | MISSING | none | n/a | none |
| C3-137 | News | Send the feed to Journal | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetJournal.outcome.test.jsx: C3-137 "put the news and catalysts feed in a fresh journal note" | pass 7/7 | panel, scripted model |
| C3-138 | TE News | Search headlines | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | teNewsWatchlist.outcome.test.jsx: "C3-138: search the News widget through its own search box" (held-out phrasings, clear, NEGATIVE); agentExecReach.test.jsx: search held-out7 (routing reach only); see docs/agent/program/EXEC-CITED-RERUN.md | pass 9/9 | panel, scripted model |
| C3-139 | TE News | Filter by category, linked symbol or watchlist | PARTIAL (SIMULATED) — covered: the watchlist filter (watchlistId and the shown headlines read back, Undo, NEGATIVE); not covered: the category filter and the linked-symbol filter | teNewsWatchlist.outcome.test.jsx: "C3-139: the News widget filtered to one of the member's watchlists, through its own select"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 9/9 | panel, scripted model |
| C3-140 | TE News | Apply, rename or delete a filter preset | MISSING | none | n/a | none |
| C3-141 | TE News | Save or unsave a headline | MISSING | none | n/a | none |
| C3-142 | TE News | Add or edit a headline note | MISSING | none | n/a | none |
| C3-143 | TE News | Manage collections | MISSING | none | n/a | none |
| C3-144 | TE News | Add a headline's ticker to a watchlist | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-145 | TE News | Explain a headline or ask about it | IMPLEMENTED / UNVERIFIED | agentNewsAsk.test.jsx; agentNewsContinue.test.jsx | pass 21/21 | panel, partial |
| C3-146 | TE News | Jump to live or browse a past day | MISSING | none | n/a | none |
| C3-147 | TE News | Send a headline to Notebook | MISSING | none | n/a | none |
| C3-148 | Calendar | Step days in the widget | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetControls.outcome.test.jsx: "show tomorrow on the terminal" (UCT Terminal, C3-148); see docs/agent/program/EXEC-CITED-RERUN.md | pass 7/7 | panel, scripted model |
| C3-149 | Calendar | Ask who reports on a day from Charts | MISSING | none | n/a | none |
| C3-150 | Calendar | Ask when a stock reports from Charts | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | boardArrangement.outcome.test.jsx: C3-150 (held-out phrasings) "the earnings read answers with the date, no change to the board"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 13/13 | panel, scripted model |
| C3-151 | Calendar | Filter economic events by stars | IMPLEMENTED / UNVERIFIED | agentWidgetOptions.test.jsx:49; held-out phrasings only, no execution test: docs/agent/program/EXEC-CITED-RERUN.md (for pl-exec) | pass 1/1 | runtime, no panel |
| C3-152 | Calendar | Toggle the TBD section | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetControls.outcome.test.jsx: "expand the time tbd list on the terminal" (C3-152); see docs/agent/program/EXEC-CITED-RERUN.md | pass 7/7 | panel, scripted model |
| C3-153 | Calendar | Sort earnings columns | MISSING | none | n/a | none |
| C3-154 | Calendar | Show all earnings in a section | MISSING | none | n/a | none |
| C3-155 | Calendar | Click an earnings row | VERIFIED | c:symbol.switch | pass 7/7 | panel, scripted model |
| C3-156 | Calendar | Send a day to Journal | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetDoorRows.outcome.test.jsx: "Send to Journal over the real widgets' own capture doors", case C3-156; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-157 | Breadth | Read breadth tiles | VERIFIED | c:breadth.now; c:breadth.measure-now | pass 11/11 | panel, scripted model |
| C3-158 | Breadth | Add or remove a reading | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetDoorRows.outcome.test.jsx: C3-158 "take the up 4% reading off the breadth widget"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-159 | Breadth | Switch heatmap and ratio view | MISSING | none; held-out phrasings only, no execution test: docs/agent/program/EXEC-CITED-RERUN.md (for pl-exec) | n/a | none |
| C3-160 | Breadth | Change tile style | MISSING | none | n/a | none |
| C3-161 | Breadth | Change palette, intensity or background | MISSING | none | n/a | none |
| C3-162 | Breadth | Drill into a reading | MISSING | none | n/a | none |
| C3-163 | Breadth | Send a snapshot to Journal | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetDoorRows.outcome.test.jsx: "Send to Journal over the real widgets' own capture doors", case C3-163; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-164 | Options Flow | Switch market or symbol scope | IMPLEMENTED / UNVERIFIED | agentWidgetOptions.test.jsx:49; held-out phrasings only, no execution test: docs/agent/program/EXEC-CITED-RERUN.md (for pl-exec) | pass 1/1 | runtime, no panel |
| C3-165 | Options Flow | Switch the lead view | IMPLEMENTED / UNVERIFIED | none; held-out phrasings only, no execution test: docs/agent/program/EXEC-CITED-RERUN.md (for pl-exec) | n/a | source only |
| C3-166 | Options Flow | Set filters (premium, call/put, type, direction) | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | flowFilters.outcome.test.jsx: C3-166 over the real OptionsFlowWidget, every chip group (premium, call/put, type, direction) and AND across groups: 12 held-out set phrasings + 2 resets read back from opts.filters AND the prints drawn, Undo exact; 5 refusals (same-group conflicts, a premium no chip has, an invented filter); two widgets asked or named; approve paths. F-16 widened by the owner 2026-11-10 (from #872) | pass 27/27 | panel, scripted model |
| C3-167 | Options Flow | Read the flow | MISSING | none | n/a | none |
| C3-168 | Options Flow | Click a flow row | VERIFIED | c:symbol.switch | pass 7/7 | panel, scripted model |
| C3-169 | Themes | Pick a period or ranking | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | themeTracker.outcome.test.jsx: C3-169 "show the theme tracker for the past month"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-170 | Themes | Flip sort direction | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | themeTracker.outcome.test.jsx: C3-170 "sort the theme tracker ascending"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-171 | Themes | Switch today basis | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | themeTracker.outcome.test.jsx: C3-171 "theme tracker from the open"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-172 | Themes | Open a theme or pick a holding | PARTIAL (SIMULATED) — covered: opening a theme by its name (door openTheme, its holdings drawn); not covered: picking a holding inside the open theme | themeTracker.outcome.test.jsx: C3-172 "open the software theme in the theme tracker"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-173 | Themes | Search themes or tickers | MISSING | none | n/a | none |
| C3-174 | Themes | Pick, rename or delete a theme set | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | themeTracker.outcome.test.jsx: C3-174 "switch the theme tracker to my Mine set" + "Theme Tracker theme sets: rename and delete" (held-out phrasings); see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-175 | Themes | Edit a set (add, hide, reset, custom theme) | MISSING | none | n/a | none |
| C3-176 | Themes | Add or remove a stock in a theme | MISSING | none | n/a | none |
| C3-177 | Themes | Send the ranking to Journal | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetDoorRows.outcome.test.jsx: "Send to Journal over the real widgets' own capture doors", case C3-177; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-178 | Fundamentals | Switch view | VERIFIED | agentWidgetOptions: "show annual on the fundamentals" | pass 1/1 | panel, scripted model |
| C3-179 | Fundamentals | Read the numbers | VERIFIED | c:stock.profile; c:earnings.date | pass 10/10 | panel, scripted model |
| C3-180 | Fundamentals | Change appearance or send to Journal | PARTIAL (SIMULATED) — covered: send the fundamentals to the Journal (the real widget's capture door); not covered: its appearance (a global pref, no door row) | widgetJournal.outcome.test.jsx: C3-180 "send the fundamentals table to a new journal note" | pass 7/7 | panel, scripted model |
| C3-181 | Profile | Read profile and earnings table | VERIFIED | c:stock.profile; c:earnings.date | pass 10/10 | panel, scripted model |
| C3-182 | Profile | Click a peer ticker | VERIFIED | c:symbol.switch | pass 7/7 | panel, scripted model |
| C3-183 | Indexes | Hide or restore an index | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetControls.outcome.test.jsx: "Indexes (C3-183): hide or restore an index" (hide + Undo, restore by name, NEGATIVE); see docs/agent/program/EXEC-CITED-RERUN.md | pass 7/7 | panel, scripted model |
| C3-184 | Indexes | Send levels to Journal | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetDoorRows.outcome.test.jsx: "Send to Journal over the real widgets' own capture doors", case C3-184 (+ NEGATIVE Dismiss); see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-185 | Market Context | Read market context | UNMAPPED | none | n/a | none |
| C3-186 | Market Context | Send to Journal | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetJournal.outcome.test.jsx: C3-186 "save the market context panel to my notebook inbox"; NEGATIVE Dismiss | pass 7/7 | panel, scripted model |
| C3-187 | NH/NL | Add or remove a universe | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetControls.outcome.test.jsx: "New Highs / Lows (C3-187, C3-188)": add, switch, remove; see docs/agent/program/EXEC-CITED-RERUN.md | pass 7/7 | panel, scripted model |
| C3-188 | NH/NL | Switch universe tab | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetControls.outcome.test.jsx: "New Highs / Lows (C3-187, C3-188)": add, switch, remove; see docs/agent/program/EXEC-CITED-RERUN.md | pass 7/7 | panel, scripted model |
| C3-189 | NH/NL | Expand a row or pick a symbol | VERIFIED | c:symbol.switch | pass 7/7 | panel, scripted model |
| C3-190 | NH/NL | Toggle logos, font, background | MISSING | none | n/a | none |
| C3-191 | H/L Pulse | Change Pulse settings | MISSING | none | n/a | none |
| C3-192 | Market Map | Pick or remove a universe | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetDoorRows.outcome.test.jsx: "C3-192 / C3-193: add the Nasdaq 100 to the Market Map ... remove it again"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-193 | Market Map | Pick X, Y or size axis | PARTIAL (SIMULATED) — covered: the Y axis and the size axis (yKey, sizeKey read back); not covered: picking an X axis (only the refusal of an axis the map lacks is tested) | widgetDoorRows.outcome.test.jsx: "C3-192 / C3-193: ... day change on Y and size by market cap" + NEGATIVE axis; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-194 | Market Map | Follow the linked list | MISSING | none; held-out phrasings only, no execution test: docs/agent/program/EXEC-CITED-RERUN.md (for pl-exec) | n/a | none |
| C3-195 | Market Map | Cycle labels or zoom | MISSING | none; held-out phrasings only, no execution test: docs/agent/program/EXEC-CITED-RERUN.md (for pl-exec) | n/a | none |
| C3-196 | AI Search | Ask a question or follow one up | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-197 | AI Search | Change ask mode, stop or retry | MISSING | none | n/a | none |
| C3-198 | AI Search | Save, reopen or remove an answer | MISSING | none | n/a | none |
| C3-199 | AI Search | Copy or speak an answer | MISSING | none | n/a | none |
| C3-200 | AI Search | Send the conversation to Journal | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetJournal.outcome.test.jsx: C3-200 "journal this ai search conversation" (the conversation is seeded through the widget's own initialThread prop: fixture data, no paid stream); NEGATIVE no conversation → refused | pass 7/7 | panel, scripted model |
| C3-201 | Notebook | Open or search a note | PARTIAL (SIMULATED) — covered: opening a note by its name (noteId read back, Undo; an ambiguous or unknown name is refused); not covered: the widget's own note search | widgetDoorRows.outcome.test.jsx: "the Notebook widget (C3-201 open a note by its name)" + NEGATIVE; see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-202 | Notebook | Create a note | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetDoorRows.outcome.test.jsx: "the Notebook widget: create a note through its own New control (C3-202)" (held-out phrasings); see docs/agent/program/EXEC-CITED-RERUN.md | pass 19/19 | panel, scripted model |
| C3-203 | Notebook | Edit a note's title or body | BLOCKED | none | n/a | none |
| C3-204 | Notebook | Browse folders | MISSING | none | n/a | none |
| C3-205 | Period Sort | Start a custom-period sort | MISSING | none | n/a | none |
| C3-206 | Period Sort | Choose grouping, replay and start mark | MISSING | none; held-out phrasings only, no execution test: docs/agent/program/EXEC-CITED-RERUN.md (for pl-exec) | n/a | none |
| C3-207 | Period Sort | Dock the panel or add it as a tab | MISSING | none | n/a | none |
| C3-208 | Period Sort | Refresh results | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | widgetActions.outcome.test.jsx: C3-208 x6 held-out ("refresh the period sort", "reload the period sort ranking", …) | pass 24/24 | panel, scripted model |
| C3-209 | Replay | Start replay at a date | VERIFIED | c:chart.replay; agentChartReplay: replay from Oct 15 | pass 5/5 | panel, scripted model |
| C3-210 | Replay | Exit replay | VERIFIED | c:chart.replay.exit | pass 4/4 | panel, scripted model |
| C3-211 | Replay | Pick the cutoff by clicking the chart | MISSING | none | n/a | none |
| C3-212 | Replay | Set replay timeframe | IMPLEMENTED / UNVERIFIED | agentChartReplay.test.jsx:41 | pass 1/1 | runtime, no panel |
| C3-213 | Review | Start Review Charts from a results list | NOT ON /CHARTS | none | n/a | n/a |
| C3-214 | Review | Step next or previous in a review (mobile only at this commit) | NOT ON /CHARTS | none | n/a | n/a |
| C3-215 | Review | Open the review feed card (mobile only) | NOT ON /CHARTS | none | n/a | n/a |
| C3-216 | Company dock | Switch dock tab | VERIFIED (SIMULATED panel test, scripted model, jsdom) | agentExecRound5.test.jsx: C3-216 "show the ownership tab on the company panel"; see docs/agent/program/EXEC-CITED-RERUN.md | pass 18/18 | panel, scripted model |
| C3-217 | Company dock | Open or collapse the dock | VERIFIED (SIMULATED panel test, scripted model, jsdom) | agentExecRound5.test.jsx: C3-217 "collapse the company panel" / "open the company info panel" + NEGATIVE (no panel); see docs/agent/program/EXEC-CITED-RERUN.md | pass 18/18 | panel, scripted model |
| C3-218 | Company dock | Search company info | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-219 | Company dock | Open ETF holdings | VERIFIED (SIMULATED outcome test, scripted model, jsdom) | etfHoldings.outcome.test.jsx: "C3-219: the chart's View Holdings button, through its door" (held-out phrasings, NEGATIVE on a stock); see docs/agent/program/EXEC-CITED-RERUN.md | pass 6/6 | panel, scripted model |
| C3-220 | Company dock | Pick a leveraged or inverse ETF | IMPLEMENTED / UNVERIFIED | none | n/a | source only |
| C3-221 | Workspace | Open the Agent | BLOCKED | none | n/a | none |
| C3-222 | Workspace | Change a widget's UCT theme section | MISSING | none | n/a | none |
| C3-223 | Workspace | Toggle the journal shortcut (Ctrl+Alt+J) | UNMAPPED | none | n/a | none |
| C1-176 | Right-click | Send chart to Journal | MISSING | none | n/a | none |
| C1-177 | Right-click | Send chart to Journal, choose where | MISSING | none | n/a | none |
| C1-178 | Right-click | Ask AI about the symbol on a bar | MISSING | none | n/a | none |
| C1-179 | Right-click | Add widget, floating at the click | MISSING | none | n/a | none |
