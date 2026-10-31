# UCT Agent Phase 3: advanced workspace operation (Workstream 2)

This workstream gives the Agent new workspace operations that reuse the board's own writers. It also gives several
existing operations local readings, so they no longer need the model.

The Agent is still admin-only, and NL-1 is still OFF. Every change is ordinary and reversible, so it applies at once,
with one exact Undo, through the existing planner, policy, runtime and receipts.

## Capability inventory: what already existed

Most board operations in the brief were already Agent capabilities. They were reachable only through the model:

- `widget.move`, `widget.resize`, `widget.arrange`, `widget.remove`, `widget.setLink`
- `chartGrid.set`, `watchlist.open`
- the widget-tab and chart-tab actions
- `chart.setSymbol`, `chart.setTimeframe`, `chart.setType`, `chart.setScale`, `chart.setSession`, `chart.setSetting`
- `chartSetup.copyLook`
- `pane.resize`, `pane.move`, `indicatorStyle.set`, `indicatorStyle.placeIn`

Every `host` method is already used by a capability.

The real gaps were operations the board writer supports that had no action:
- swapping two widgets;
- duplicating a chart;
- a widget beside a grid of charts.

## New

| Request | Action | What happens | Undo |
|---|---|---|---|
| "swap the watchlist and the chart", "move my watchlist to the right", "swap the top left and bottom right charts" | `board.swap` (new) | Two widgets side by side (same rows) or stacked (same columns) trade sides, each keeping its size, so a rail stays a rail. Otherwise only same-sized widgets trade cells. Nothing else moves. | exact (board `set`) |
| "duplicate this chart", "make a copy of the NVDA chart", "clone the left chart" | `board.duplicateChart` (new) | The chart's cell is split in two (side by side when wide enough, else stacked). The copy is born in the other half through `handleAddWidget`'s seed. It has the chart's settings (look and indicators), timeframe and ticker, and is not linked. | the copy closed; the cell given back |
| "…four daily charts for NVDA, AMD, AVGO and MU, **a watchlist**, …" | `chartGrid.set` `watchlist: true` (new argument) | A column on the right edge, full height, is cleared of charts (a chart reaching into it is narrowed). A Watchlist widget is added there. Refused, never forced, when any other widget is in that column. Ignored when the board already has a Watchlist. | the grid's own Undo closes it |
| "make the watchlist wider", "make the left chart a little taller", "make the watchlist wider by 3" | `widget.resize` (existing; now read locally) | The edge that faces a neighbour moves: about 25% of the widget's size (15% for "a little", 50% for "much"), or the number given. | exact |
| "make all my charts match the top left timeframe", "sync the timeframes to the NVDA chart" | `chart.setTimeframe` (existing; now read locally) | Each other chart takes the timeframe the named chart shows now. One change. | exact |
| "make these charts use the same timeframe" | — | Asks which timeframe, listing each chart's. Nothing changes. | — |

**Workspace composition.** The brief's example is: "Make me a momentum trading workspace with four daily charts for
NVDA, AMD, AVGO and MU, a watchlist, and RSI beneath each chart." It is planned as two steps:
1. the grid, with its watchlist rail;
2. RSI below price on each of the grid's charts. A step without a verb, like "RSI beneath each chart", reads as
   "put RSI below price" on the request's charts.

The receipt says each step. Repeated Undo restores the board exactly.

Some requests are left to the model, which sees the board and can ask:
- a workspace with no tickers ("four daily charts" with no names);
- a named list ("my Momentum watchlist").

## Undo: a reused chart in a grid

A grid's Undo writes back only a reused chart's cell, link, ticker and timeframe (`opts.tf`), never its settings. Its
staleness check now covers exactly those, plus everything else outside `opts.settings`.

The problem it fixes: undoing an indicator added to that chart leaves bookkeeping in the stored settings. That is an
Indicators-owned behaviour; see `PHASE3-INDICATORS-HANDOFF.md`. Before this change it blocked the grid's own Undo with
"Board has changed".

Any newer edit to what the Undo WOULD overwrite still refuses. Charts the grid ADDED keep their existing comparison:
their Undo removes the whole chart.

## Routing, contract and discovery

**Routing.**
- `board.swap` and `board.duplicateChart` are in a new routing group, `boardEdit`, alongside `chartGrid`.
- Its words: swap, trade places, duplicate, clone, a copy of, "move … to the left/right…".
- The NL-1 core (≤ 45) and the workspace group keep their size.
- `tests/test_uct_agent_contract.py` maps the `board` domain to it.

**Contract.**
- `contract/manifest.golden.json` was regenerated: 2 new actions, plus `chartGrid.set.watchlist`.
- The NL-1 parity fixture (`tests/fixtures/nl1_assemble_parity.json`) was regenerated.
- The catalog counts in two tests went from 119 to 121 and from 113 to 115.

**Discovery.** `discovery.js` lists the new actions under its "arrange" and "widgets" topics, with what they do.
Discovery and permission are still separate: being listed grants nothing. Every action still passes the registry's
`available`, check, policy and approval rules.

## Verified in the real Charts workspace (agent-harness, writes refused, scripted model)

- **Duplicate:** "add rsi" then "duplicate this chart". The board showed two SPY charts side by side. Asking "what
  indicators are on the second chart" listed RSI (14) and the same moving averages as the first. Undo restored the one
  chart.
- **Swap and resize:**
  - "move my watchlist to the left" moved the rail to the left, still 6 columns wide.
  - "make the watchlist wider" resized it to 8 columns; the chart gave up the space.
  - Two Undos restored the cells exactly.
- **Composition:** on a half-empty board, the four-chart workspace request with NVDA, AMD, AVGO and TSM produced a 2×2
  of the four, a Watchlist at the right, and RSI on each. The receipt said each step and ended "All 2 steps done.".
  Five Undos restored the original single SPY chart in its original cell.

## Drawing tools: boundaries (not changed here)

**What the Agent drawing actions cover today:**
- list;
- horizontal levels at a price;
- colour, line style and width;
- show, hide, lock, remove;
- set a level;
- show all, clear.

**What the drawing store also supports, without anchor guessing (left for a follow-up):**
- **Duplicating a drawing** (`offsetPoints`).
- **More style keys** from `drawingSettingsSchema` (fill, text, labels).
- **Z-order** (`reorderDrawing`): needs a new patch field.
- **Tracing boards:** the store API exists, but there is no target kind yet.

**Anchored tools** (trend lines, Fibonacci, rectangles) need member-supplied dates and prices, and are a separate
milestone. The Agent must never guess chart coordinates.

## Tests

- **`agentWorkspaceP3.test.jsx`:** 23 tests through the real panel. They cover board cells, tickers, timeframes,
  widgets, indicators, Undo, refusals, and routing selection.
- **Updated:** the grid-argument expectations in `agentChartGrid.test.js` and `agentChartsOperatorP1.test.jsx`, and the
  counts in `agentRouting.test.jsx`, `agentScreener.test.jsx` and `agentNl1Eval.test.js`.
- **Vitest** across `src/agent` and `builder/agentMutations`: 1,755+ passed.
- **Pytest** `tests/test_uct_agent*.py` and `tests/test_agent_eval_run.py`: 674 passed.
