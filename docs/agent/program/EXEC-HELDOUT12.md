# The 12 held-out-only execution rows: outcome tests

pl-auto, 2026-11-10. Branch `agent/pl/exec-heldout12`, based on master 5fed0561f1 (#1016 merged). Test and doc only: no product
code, no status-doc edit (the proposed row states are below for the Lead to apply).

Until now these 12 rows were named only by held-out ROUTING phrasings (agentExecHeldOut*.test.js), which execute nothing. Each
row now has outcome tests in `app/src/agent/qa/chartsOutcome/heldout12.outcome.test.jsx`.

## How the tests work

- The REAL Agent panel (outcomeHarness: AgentPanel, useAgent, registry, policy, runtime, receipts, Undo) runs over one fixture
  board. The board holds the selected chart and one widget of each type the rows name: volumescan, news, calendar, breadth,
  optionsflow, scatter (the market map) and periodsort.
- Each case gives the member's words, the plan a correct planner sends from THAT request, and the end state. The plan reads the
  widget id from `body.context.board`, the chart from its `selected` flag, and the key from the request's own widgetControls
  section; the case fails when the request does not carry them.
- The end state is read back from the stored opts, or for a chart from the chart blob through the product's own readers
  (`headerFieldKeys`, `barInfoFieldsOf` over `mergeChartSettings`).
- Each case then checks two more things: the chart and every OTHER widget are byte-identical, and Undo restores the exact opts.
- A case also fails if the scripted plan was never consumed, because that means a pre-model path answered on its own.
- **Evidence label:** jsdom panel test, SIMULATED (scripted model). LOCAL native Windows Node and vitest. Not a real browser, no
  paid model, no backend.

## Result

- Command (from `app/`): `npx vitest run src/agent/qa/chartsOutcome/heldout12.outcome.test.jsx`
- Commit: 5fed0561f1 plus this branch's test file.
- Scope: one file, 37 cases.
- Totals: `Test Files 1 passed (1)` / `Tests 33 passed | 4 todo (37)`. The 33 passed include 3 `it.fails` known-gap
  outcomes and 3 `it` pins of today's exact wrong output.

## Per row (proposed status)

| Row | Capability | Cases (end state + others untouched + Undo) | Proposed |
|---|---|---|---|
| C1-065 | Legend bar-info fields (`chart.setSetting header.barInfo`) | 3 held-out phrasings: -open, +changePct, -date | VERIFIED |
| C1-066 | Info-row fields (`chart.setSetting header.fields`) | 5 held-out phrasings: +dolvol, -mcap, -rating, +perf30d, +rvol | VERIFIED |
| C3-125 | Volume Surge logos (`showLogos`) | 2 held-out phrasings | VERIFIED |
| C3-133 | News catalyst filter (`filter`) | 1 held-out phrasing (up) | VERIFIED |
| C3-151 | Calendar econ stars (`econStars`) | **both held-out phrasings fail** (KNOWN GAP "routed", pinned); 1 tune phrasing passes | PARTIAL |
| C3-159 | Breadth heatmap / ratio view (`view`) | to ratio (held-out), back to heatmap | VERIFIED |
| C3-164 | Options Flow market / symbol scope (`scope`) | to symbol (held-out), back to market | VERIFIED |
| C3-165 | Options Flow lead view (`lead`) | 1 held-out phrasing (biggest) | VERIFIED |
| C3-166 | Options Flow filters (`callPut` / `printType` / `minPremium` / `direction`) | puts only, calls only (held-out), "options flow: sweeps only", premium and bearish (tune). **"only show sweeps in the options flow" (held-out) is refused before the model** (KNOWN GAP "refused", pinned) | PARTIAL |
| C3-194 | Market map follows the linked list (`followList`) | 1 held-out phrasing | VERIFIED |
| C3-195 | Market map labels / zoom (`labelMode`) | labels off (2 held-out), all; **zoom: it.todo**, no capability | PARTIAL |
| C3-206 | Period Sort grouping, replay, start mark (`group`) | group by industry (held-out); **replay, start mark and ungroup: it.todo** | PARTIAL |

Proposed: 8 VERIFIED, 4 PARTIAL. PARTIAL rows are never counted as VERIFIED.

## Known gaps (product NL findings, reported, not fixed here)

1. **C3-151 "routed".** "show only 3 star economic events" and "calendar widget: only 3 star economic events" reach the model
   WITHOUT the board-edit group. The request carries no widgetControls section and no `widget.setOption`, only `calendar.day`, so
   no correct plan can exist. "change the calendar widget filter to 3 stars" routes correctly. These are routing words for the
   econ-stars control (owner: routing.js boardEdit group).
2. **C3-166 "refused".** "only show sweeps in the options flow" goes to the screener fast path, which reads "sweeps" as an
   options-flow SCREEN filter. Because the message also names the Options Flow widget, `useAgent.js:2299-2305` answers
   `FLOW_WIDGET_REFUSAL` ("I can't set the Options Flow widget's filters for you yet…") with 0 model turns. That sentence is
   stale: `widget.setOption printType` now sets that exact chip, and "options flow: sweeps only" does it.

## Missing pieces (it.todo, with the source location in the test text)

- C3-195 zoom: an echarts dataZoom on the instance (ScatterWidget.jsx:463/:476). Nothing is in opts and there is no door.
- C3-206 start mark: dialog-local state (`PeriodSortConfig.jsx:18`), passed to `setStartMarker`. No capability writes it.
- C3-206 replay: dialog state, passed to `setReplayCutoff`. There is no period-sort capability (`chart.replay` is the Replay row).
- C3-206 ungroup: the registry's `group` options are theme | sector | industry. The dialog's "US Common Stocks" (group null) has
  no accepted value.
