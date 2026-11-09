# Charts Agent coverage ledger

Development coverage, kept apart from what members can do today. Regenerate with `node src/testing/agent/autotest/ledger.mjs` (from `app/`); the command and inputs are below.

- **D (development):** origin/agent/pl/r8-integration 16fb5272a3, with only the autotest harness files added; walkthroughs from that tree's own CHARTS_TEACH_STATUS.md
- **P (production tree):** origin/master d98bb86457 (2026-11-09), with only the autotest harness files added. Master has since moved to fdd4d73bd1 (#998 merged): not re-run
- **R (real model, real production browser):** not measured. No real-model run on any tree; the only real-browser evidence this round is the guide-overlay geometry (REAL BROWSER, Chromium automation, scripted model), which measures the walkthrough ring, not execution

**Method.** Scripted model (BROWSER-MOCK-MODEL) in a local headless browser on the agent harness with fixture data, plus the `src/agent` vitest suite of the same tree, counted by `recount.mjs`. An execution row counts when every test its inventory evidence cites passed, or when every browser request naming the row passed (one failure takes it out). Refusals, how-to and unsupported requests never count as execution. Walkthrough rows are the VERIFIED rows of that tree's own `CHARTS_TEACH_STATUS.md`: the recount cannot re-prove a walkthrough. A request names every row of its family, so browser counts are an upper bound.

| Family (area) | In scope | Exec D | Exec P | P0 rows | P0 D | P0 P | Exec D: covered by a passing test, docs stale (not in Exec D) | Walkthrough D | Walkthrough P | R |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Symbol | 5 | 3 | 3 | 3 | 3 | 3 | 0 | 4 | 4 | not measured |
| Timeframe | 6 | 4 | 3 | 2 | 2 | 1 | 0 | 5 | 5 | not measured |
| Chart type | 5 | 1 | 1 | 1 | 1 | 1 | 0 | 3 | 3 | not measured |
| Session | 2 | 2 | 2 | 1 | 1 | 1 | 0 | 2 | 2 | not measured |
| Scale | 5 | 2 | 1 | 1 | 1 | 0 | 0 | 4 | 4 | not measured |
| View | 3 | 2 | 2 | 3 | 2 | 2 | 0 | 3 | 3 | not measured |
| Go to date | 4 | 2 | 2 | 0 | 0 | 0 | 0 | 3 | 3 | not measured |
| Compare | 8 | 1 | 1 | 1 | 1 | 1 | 0 | 6 | 6 | not measured |
| Replay | 9 | 4 | 4 | 2 | 2 | 2 | 0 | 6 | 6 | not measured |
| Settings | 32 | 7 | 5 | 0 | 0 | 0 | 0 | 23 | 23 | not measured |
| Themes | 12 | 7 | 1 | 2 | 2 | 0 | 0 | 8 | 8 | not measured |
| Templates | 7 | 7 | 7 | 1 | 1 | 1 | 0 | 3 | 3 | not measured |
| Volume | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 5 | 5 | not measured |
| Panes | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 4 | 4 | not measured |
| Legend | 16 | 6 | 6 | 2 | 2 | 2 | 0 | 12 | 12 | not measured |
| Measure | 4 | 4 | 4 | 0 | 0 | 0 | 0 | 3 | 3 | not measured |
| Share | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Alerts | 27 | 19 | 17 | 8 | 8 | 7 | 0 | 19 | 19 | not measured |
| Right-click | 6 | 1 | 1 | 0 | 0 | 0 | 1 | 2 | 2 | not measured |
| Settings door | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Drawing | 38 | 27 | 27 | 7 | 6 | 6 | 2 | 25 | 25 | not measured |
| Boards | 4 | 0 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | not measured |
| Keyboard | 5 | 2 | 2 | 1 | 1 | 1 | 0 | 2 | 2 | not measured |
| Picker | 3 | 1 | 1 | 0 | 0 | 0 | 0 | 2 | 2 | not measured |
| Add | 10 | 3 | 3 | 3 | 3 | 3 | 0 | 6 | 6 | not measured |
| Remove | 4 | 3 | 3 | 2 | 2 | 2 | 0 | 3 | 3 | not measured |
| Visibility | 4 | 4 | 4 | 2 | 2 | 2 | 0 | 4 | 4 | not measured |
| Read | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 2 | 2 | not measured |
| Inputs | 6 | 2 | 2 | 2 | 2 | 2 | 1 | 4 | 4 | not measured |
| Style | 6 | 3 | 3 | 2 | 2 | 2 | 1 | 5 | 5 | not measured |
| Placement | 2 | 1 | 1 | 1 | 1 | 1 | 0 | 2 | 2 | not measured |
| Undo | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Copy | 2 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | not measured |
| Create | 9 | 5 | 5 | 2 | 2 | 2 | 0 | 5 | 5 | not measured |
| Builder | 12 | 1 | 1 | 0 | 0 | 0 | 0 | 7 | 7 | not measured |
| Import | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Image | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not measured |
| Saved | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | not measured |
| Board | 5 | 4 | 4 | 4 | 4 | 4 | 0 | 5 | 5 | not measured |
| Link | 2 | 1 | 1 | 1 | 1 | 1 | 0 | 1 | 1 | not measured |
| Float | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Popout | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Widget tabs | 4 | 3 | 0 | 0 | 0 | 0 | 0 | 3 | 3 | not measured |
| Chart tabs | 5 | 4 | 4 | 0 | 0 | 0 | 0 | 3 | 3 | not measured |
| Layout Dock | 17 | 8 | 7 | 2 | 2 | 1 | 0 | 8 | 8 | not measured |
| Multi Chart | 21 | 3 | 3 | 0 | 0 | 0 | 0 | 19 | 19 | not measured |
| Watchlist | 40 | 18 | 17 | 10 | 10 | 10 | 0 | 17 | 17 | not measured |
| Scanner | 14 | 8 | 6 | 3 | 3 | 3 | 2 | 5 | 5 | not measured |
| Volume Surge | 6 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 2 | not measured |
| News | 5 | 2 | 1 | 1 | 1 | 1 | 0 | 3 | 3 | not measured |
| TE News | 10 | 2 | 0 | 0 | 0 | 0 | 1 | 2 | 2 | not measured |
| Calendar | 9 | 7 | 1 | 2 | 2 | 0 | 0 | 5 | 5 | not measured |
| Breadth | 7 | 4 | 1 | 1 | 1 | 1 | 0 | 4 | 4 | not measured |
| Options Flow | 5 | 4 | 1 | 0 | 0 | 0 | 0 | 4 | 4 | not measured |
| Fundamentals | 3 | 2 | 2 | 1 | 1 | 1 | 0 | 1 | 1 | not measured |
| Profile | 2 | 2 | 2 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Indexes | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not measured |
| Market Context | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not measured |
| NH/NL | 4 | 3 | 1 | 0 | 0 | 0 | 0 | 3 | 3 | not measured |
| H/L Pulse | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Market Map | 4 | 3 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | not measured |
| AI Search | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Notebook | 4 | 2 | 0 | 0 | 0 | 0 | 0 | 2 | 2 | not measured |
| Period Sort | 4 | 0 | 0 | 0 | 0 | 0 | 0 | 1 | 1 | not measured |
| Company dock | 5 | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 2 | not measured |
| Workspace | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | not measured |
| **Total** | 484 | 218 | 170 | 74 | 72 | 64 | 13 | 281 | 281 | not measured |

**Rows covered by a passing test on D whose status document is stale** (its citation names no passing test this reader can match; a separate column, never added to Exec D or P0 D):

| Row | Area | P0 | Action | Covering test (passed in this run on D) |
| --- | --- | --- | --- | --- |
| C1-126 | Right-click |  | Hide all drawings | `drawManage.outcome`: d3 "hide every drawing on this one" |
| C1-158 | Drawing |  | Lock/unlock | `drawManage.outcome`: d2 "lock the line on the QQQ chart so I can't move it" |
| C1-159 | Drawing |  | Hide/show one | `drawManage.outcome`: d1 "hide that line on this chart for now" |
| C1-167 | Boards |  | Switch drawing board | `agentDrawingBoards`: b1 "switch my drawings over to the earnings drawing board": the board panel reads it; Undo puts it back |
| C1-168 | Boards |  | Create a board | `agentDrawingBoards`: b2 "make a fresh drawing board called breakouts": the board panel reads it; Undo puts it back |
| C1-169 | Boards |  | Rename a board | `agentDrawingBoards`: b3 "rename the swing drawing board to swing trades": the board panel reads it; Undo puts it back |
| C1-170 | Boards |  | Delete a board | `agentDrawingBoards`: b4 "get rid of the earnings drawing board": shown first; nothing deleted before Apply; on Apply it is gone; no Undo |
| C2-026 | Inputs |  | Flip a toggle setting | `agentIndicatorStyle`: rsLine: its settings, colours, width and visibility as its own definition offers them |
| C2-031 | Style |  | Change histogram up / down colours | `agentIndicatorStyle`: macd: its settings, colours, width and visibility as its own definition offers them |
| C3-108 | Scanner |  | Leave a scan, back to the picker | `widgetDoorRows.outcome`: C3-108 "close this scan and show me the scanner list again": the picker shows again; Undo opens the scan back |
| C3-109 | Scanner |  | Search the preset list | `widgetDoorRows.outcome`: C3-109 "filter the scan list for gap": the picker lists only what matches; Undo lists all again |
| C3-140 | TE News |  | Apply, rename or delete a filter preset | `teNewsWatchlist.outcome`: "use my Earnings Watch preset on the news widget": the preset filters are on, only its rows show; Undo puts the filters back |
| C3-194 | Market Map |  | Follow the linked list | `widgetDoorRows.outcome`: C3-194 "make the market map follow my linked list": the widget’s own Follow toggle reads it; Undo puts it back |

Inputs: D = `D`; P = `P`.

**Notes.**

- SIMULATED (BROWSER-MOCK-MODEL). Sets run on each tree: public (246 requests) and selection public (223), plus vitest src/agent. D first run: public 241/245 (1 not run in this mode), selection 211/223; failures re-run once on the same tree and replaced: public 243/245, selection 214/223 (persistent: indicator-add-04, howto-10; sel-MC-indicator-all, sel-MC-symbol-ordinal, sel-MC-range-deictic, sel-MC-background-deictic, flow-mc-it-after-a-new-click, flow-mcx-it-after-a-turn, flow-mcx-bare-after-a-turn, flow-selected-chart-closed, flow-mcx-that-one-too). D vitest 10118 passed / 0 failed / 6 skipped.
- P first run only (its failures were not re-run): public 243/245 (1 not run), selection 218/223 (indicator-add-04, howto-10; flow-selected-chart-closed, sel-MC-indicator-all, flow-followup-keeps-the-named-chart, sel-MC-range-deictic, sel-MC-background-deictic). P vitest 9539 passed / 0 failed / 6 skipped. D had one re-run of its failures and P had none, so D's browser numbers had one more chance.
- Covered by a passing test, docs stale: 13 rows whose status document says VERIFIED but whose evidence citation names no test this reader can match on D (a branch tag such as (r8-drawings) inside the label, or held-out names). Each is credited only through a named test that passed in D's own vitest run (raises-D.json); they stay out of Exec D and P0 D. None is P0. The two P0 rows D does not count, C1-028 (zoom: no read-back) and C1-162 (drawing undo/redo: owner decision, histories separate), are BLOCKED and no test covers them.
