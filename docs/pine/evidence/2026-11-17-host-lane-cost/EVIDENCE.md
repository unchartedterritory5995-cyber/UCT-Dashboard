# The host lane's cost, on the member's real path; route by cost (evidence, 2026-11-17)

Branch `feat/route-by-cost`, cut from master `e3deef7d5f` (`SCRIPT_ENGINE_VERSION = 71`). Follows the
compute-caps ruling (PR #1672, `docs/pine/evidence/2026-11-17-compute-caps/EVIDENCE.md`), whose
section 6 found 17 host documents over a second and described the host lane as "on the member's main
thread, recomputed on every live bar". This document checks that claim first, measures what a member
feels, and then routes by cost where that is honest.

## 1. Answer first

- **The host lane runs on the member's main thread.** Verified in code and in a real browser
  (section 3). It is computed synchronously inside the chart's paint, for every new bars array.
- **"Recomputed on every live bar" is half right.** A live TICK does not recompute it (only SMA, EMA and
  VWAP bindings are stepped on a tick). A new BARS ARRAY does: the 600-bar first paint, the deep
  history (12,500 bars requested on a daily chart, every browser since 2026-09-03), every poll whose
  newest bar moved (5 minutes on a daily chart, 30 seconds intraday), a new intraday bucket, a symbol
  or timeframe switch, and a settings change.
- **Members feel it.** On the real `/charts` page, a member's daily chart with
  pivot-point-supertrend attached stops drawing frames for **5.6 to 6.3 seconds** when the deep history lands
  (after a 2-second stop on the 600-bar tail), and **twice, 6 to 7.5 seconds each, on every daily poll**;
  supertrend-strategy stops for **8.6 seconds** on load and **7.5 to 8.1 seconds twice** per poll. The
  control (the same chart, no script) never stops for more than 150 ms. The CPU profile puts the time in
  `engine/ast/interpret.js`. Moved to the runtime lane, pivot-point-supertrend's longest main-thread task is
  **0.2 s** and its poll costs 0.2 s (section 3).
- **Members are on the runtime lane, and the host lane still computes every script it accepts.** Stage:
  read live on production by the coordinator on 2026-11-17 (`railway variables --service web --kv`): `PINE_RUNTIME_STAGE=all`, `VITE_PINE_RUNTIME_PANE_ENABLED=1` and `VITE_PINE_MEMBER_PANE_ENABLED=1` on both `web` and `web-front`, capability admission on. (The flag ledger still read `admins`; it is corrected in #1714.) The member door asks the HOST lane
  first, so a script the host lane accepts is computed there, on the main thread, for every member, even
  when the runtime lane would draw it in milliseconds: that is what this change addresses.
- **Route by cost is built (section 6) and moves 6 committed scripts, for every viewer whose runtime lane is
  on, which at stage `all` is every member as soon as it ships**: pivot-point-supertrend (23.5 s on the host
  lane, 11 ms on the runtime lane), twin-range-filter (13.8 s / 5 ms), qqe-signals (3.5 s / 8 ms), trendlines
  (2.6 s / 18 ms), btc-charlie (404 / 141 ms), trend-duration-forecast (82 / 9 ms).
- **Of the 16 host documents over a second it moves 4** (pivot-point-supertrend, twin-range-filter,
  qqe-signals, trendlines). **It cannot honestly move the other 12**, for any viewer: the runtime lane draws
  a different picture for 6 (it draws no fills yet; markers lost), declines 4, does not admit 1
  (pa-zigzag-fibonacci-fan, `request-other`), and 1 is window work the route does not offer
  (reverse-stochastic). Those need the host lane's own compute off the main thread
  (option b, section 8: not built here).

## 2. Where the host lane computes (the code)

```
StockChart.updateChart                       (React, main thread)
  -> binder.sync({bars: filteredBars, ...})  (engine/binder.js)
     -> memo hit? (same registry, def, bars ARRAY, inputs signature) -> reuse
     -> registry.computeFor(def, calcBars, inputs, ctx)               (nativeRegistry.js)
        -> computeLaneOf(def) === 'ast' -> astLaneColumns(...)        (astColumns.js, synchronous)
           -> interpret(tree, bars, ...) per tree                     (ast/interpret.js)
```

- The memo keys on the bars ARRAY's identity (`binder.js`, `memo.bars === calcBars`). A poll that adds
  nothing keeps the array (`useLegacyChartBars.js`, the flicker guard) and recomputes nothing; a poll
  that moves the newest bar makes a new array and recomputes the whole document over every loaded bar.
- `calcBars` is every loaded bar (`binder.js`, `let calcBars = bars`), not a window.
- The only Web Workers in the app are the runtime lane's (`runtime/runtimeAsync.js`), the bars pack's and
  options flow's. None computes the host lane.
- Production's bar source is the legacy hook (`VITE_BARSTORE` dark). A live tick reaches the series
  through the live writers (`legacyLiveWriters.js`) and steps only SMA / EMA / VWAP bindings
  (`StockChart._extendOverlaysLive`): "the other kit types ... hold until the next poll recomputes them".
- On a daily chart the deep history arrives on first paint for every browser
  (`BARS_HISTORY_FIRST_PAINT_PCT = 100`), and the chart states `historyFromListing` when the first bar is
  the listing day (`listingSeed.historyFromListingOf`, from `/api/ticker-ipo`). With it, a recurrence can
  take the cheaper listing pass; without it (intraday, weekly, monthly, a symbol older than the 12,500-bar
  depth, the 600-bar first paint) it takes the bounded window.

## 3. The member's real path, in a browser

**Rig** (`tools/pine_coverage/host_lane_browser_probe.py`): the production bundle (`npm run build` with the
production flags: member pane, objects-only pane, runtime pane built, strategy broker gate) served by a
local backend on a sandbox `DATA_DIR` (`tools/local_backend_sandbox.py`, a Temp directory; never `C:\data`),
signed in as a sandbox account. The real `/charts` page in Chromium (Playwright, 1440x900, headless): a Chart
widget added through "Add widget", the script attached through the member door's own clicks (Chart settings,
Indicators, Add indicator, Create indicator, Paste a script, "Add this script to my chart"), then a fresh
browser context (no device cache) opens `/charts` and is measured. Bars are answered at the network from the
committed AAPL daily capture (11,534 bars from AAPL's listing day) in the server's own payload shapes, and
`/api/ticker-ipo` with that listing day, so the chart states `historyFromListing` as it does for AAPL;
each `tf=D` poll after the first moves the newest close by a cent, as a session's poll does.

Measured in the page: `longtask` entries (every main-thread task over 50 ms), long-animation-frame
entries, a requestAnimationFrame heartbeat (every gap between frames over 50 ms), when the script's legend
row first shows a value (the probe hovers the price pane; the legend shows values under the crosshair), and a
V8 CPU profile of the main thread mapped to source files through the build's hidden sourcemaps
(`tools/pine_coverage/profile_by_source.mjs`). Then the chart's own next daily poll (300 s) is waited for.
A Chromium performance trace was recorded for pivot-point-supertrend (kept locally, 175 MB).

**Before the route** = `PINE_RUNTIME_STAGE=off` on the sandbox (this rig was planned on the stale ledger). For
these host-accepted scripts it is also what a runtime-on member got before this change: the door asks the host
lane first and served the same host document either way. (The only runtime-on run that saved a host document,
a first pivot run that attached before its verdict landed, is noted below; it ran on a busier machine.)

| run | long tasks on load | longest | frames stopped (max gap) | script values first on screen | each daily poll |
|---|---|---|---|---|---|
| control: the same chart, no member script | 6, 423 ms in all | 133 ms | 150 ms | - | - |
| `pivot-point-supertrend`, host lane | 6, **8,635 ms** in all | **6,252 ms** | **6,267 ms** | 3.4 s (600 bars), final 9.9 s | **2 long tasks, 5,438 + 5,295 ms** |
| `pivot-point-supertrend`, host lane, bracket run A | 8, 9,097 ms | 6,327 ms | 6,350 ms | 3.9 s, final 10.6 s | 7,220 + 7,484 ms |
| `pivot-point-supertrend`, host lane, bracket run A2 | 3, 7,630 ms | 5,576 ms | 5,583 ms | 3.8 s, final 9.4 s | 6,465 + 6,124 ms |
| `trendlines`, host lane | 8, 1,394 ms | 546 ms | 583 ms | 2.4 s | 636 + 405 ms |
| `supertrend-strategy`, host lane | 9, **10,826 ms** | **8,629 ms** | **8,650 ms** | 4.0 s | **8,111 + 7,451 ms** |

What the pivot-point-supertrend load does, in order: the 600-bar tail lands at 1.1 s and the host lane
computes it in one **1,987 ms** task (no listing on 600 bars: the bounded window); the first values show at
3.4 s; the 11,533-bar deep history lands at 3.5 s and the host lane recomputes the whole document in one
**6,252 ms** task, during which the page draws no frame (and the chart's own timeframe warm-up requests wait
behind it). The CPU profile puts **7,788 ms** of the load's main-thread time in `engine/ast/interpret.js`.
Five minutes later the daily poll moves the newest bar: the page freezes again, **twice** (5.4 s and 5.3 s;
the poll's new array, then the merged deep array), **10,202 ms** in `interpret.js`. On a daily chart that is
every five minutes of a session; on an intraday chart the poll is every 30 seconds.

**After the route, a runtime-on viewer: every member at production's stage `all`** (`PINE_RUNTIME_STAGE=admins`
on a second sandbox with the sandbox account an admin, which admits the same viewer for this question; the
probe attaches only once the preview says it is drawn bar by bar, i.e. after the capability verdict landed and
the door moved it). Run B sits between A and A2 above, back to back,
so the three share the machine's conditions:

| run | saved document | long tasks on load | longest | frames stopped | values first / final | each daily poll |
|---|---|---|---|---|---|---|
| `pivot-point-supertrend`, bracket run B (moved) | **runtime** | 6, **651 ms** | **199 ms** | **217 ms** | **2.8 s / 3.5 s** | **131 + 66 ms** |
| `trendlines` (moved) | runtime | 11, 1,889 ms | 514 ms | 517 ms | 4.2 s | 212, 122, 316 ms |
| `supertrend-strategy` (NOT moved: fills; not admitted) | host | 13, 22,700 ms | 18,778 ms | 18,832 ms | 6.1 s | 19,694 ms |

- **pivot-point-supertrend, A / B / A2:** the load's main-thread blocking falls from 9.1 s and 7.6 s to
  0.65 s, close to the control's 0.42 s, the longest frame stop from 6.3 s and 5.6 s to 0.2 s, and the
  final values arrive at 3.5 s instead of 10.6 s and 9.4 s. Each daily poll: 14.7 s and 12.6 s of frozen
  page become 0.2 s. `interpret.js` on the main thread: 8,007 / 6 / 7,033 ms on load, 13,993 / 0 / 11,992 ms
  on the poll. The Chromium traces say the same from the other side: the host run's renderer main thread
  ran tasks of 6,253, 5,438, 5,296 and 1,988 ms; the moved run's main thread never ran one over 200 ms, and
  the script's runs appear on the **DedicatedWorker** thread (159, 107 and 87 ms).
- **trendlines** buys little: on the listing it is cheap on the host lane anyway (164 ms in node), and its
  first values come later on the runtime lane (4.2 s against 2.4 s) because the worker chunk loads cold.
- **supertrend-strategy is what the route cannot fix**, and it is the worst script measured: a member's
  load freezes for 8.6 s and every daily poll twice for 7.5 to 8.1 s.
- ⚠️ The trendlines and supertrend-strategy runtime-on rows, and a first runtime-on pivot run (which attached
  before the verdict landed and so saved the host document), ran on a busier machine: every part of that pivot run's
  main-thread profile was about 1.8 times the member run's (`interpret.js` 13,923 against 7,788 ms, and
  lightweight-charts, React and the parser alike), so they are not compared with the member rows. That is
  why the A / B / A2 bracket was run.
- The recurring ~100 to 400 ms tasks every ~64 s through the poll wait (React, lightweight-charts,
  `StockChart`, `marketSession`; `interpret.js` under 1 s across a whole 5-minute window on the trendlines
  chart) are the chart's own work, not the host lane; not this question (not measured without a script).

## 4. The host lane, every committed script a member is served (node)

`ast/hostLaneCost.measure.test.js` (opt-in): every committed script (`corpus/committed`, 266) through the
member door as a member gets it today (runtime pane off, the host known-divergence list on), timed with
`computeFor` on the AAPL daily capture (`tests/fixtures/vendor/harness/vw-deadband-ticks-aapl-1d-2026-09-28.json`):
its newest 5,000 bars, and all 11,534 from the listing day (`historyFromListing`, what a member's daily
chart computes once the deep history lands). Each host document over 50 ms was then asked of the
runtime lane through the SAME door (its hash as the only entry of a synthetic known-divergence list, so the
door offers it exactly as it offers any host refusal), timed with the door clock pinned, and compared
output by output. Node 24.13.1, median of three after a warm run (one run past 3 s), dev PC under
`heavy_lock`.

**81 host documents. Median 11.5 ms, 28 over 50 ms, 16 over a second, worst 23.5 s.**
(The compute-caps evidence counted 90 with the known-divergence list ignored; this counts what a
member is served.) Recurrence steps a bar is the estimate of section 6.

| script | host ms, 5,000 bars | host ms, listing (11,534) | recurrence steps / bar | runtime lane | runtime ms, 5,000 | runtime ms, listing |
|---|---|---|---|---|---|---|
| `pivot-point-supertrend` | 23,467.2 | 8,630.8 | 4,250 | runtime | 11.3 | 12.1 |
| `supertrend-explorer` | 17,660.4 | 10,607.2 | 3,750 | declined `runtime:request-with-state` | - | - |
| `pmax-explorer` | 17,042.1 | 19,130 | 3,750 | declined `runtime:function-global-state` | - | - |
| `supertrend-strategy` | 13,917.6 | 10,940.9 | 3,750 | runtime | 17.8 | 9 |
| `twin-range-filter` | 13,758.9 | 2,612.6 | 4,250 | runtime | 4.9 | 13.8 |
| `keltner-center-of-gravity-channel` | 6,516.3 | 1,789.2 | 5,250 | runtime | 26.8 | 29.9 |
| `opening-range-initial-balance-opening-price` | 6,251.4 | 337.7 | 4,250 | runtime | 7.2 | 6.2 |
| `cpr-with-mas-super-trend-vwap-by-guruprasadmeduri` | 4,283.0 | 6,283.1 | 2,250 | runtime | 284.6 | 217.3 |
| `atr-trailing-stop-by-ceyhun` | 4,204.8 | 12,342.4 | 6,000 | runtime | 16.1 | 14.6 |
| `multicator-table` | 3,582.9 | 223.1 | 4,100 | declined `pine:function` | - | - |
| `qqe-signals` | 3,479.0 | 5,697.4 | 4,750 | runtime | 8.1 | 9.2 |
| `trendlines` | 2,607.5 | 164.4 | 2,000 | runtime | 17.9 | 21.6 |
| `session-hilo` | 1,795.7 | 60.1 | 2,500 | runtime | 5.6 | 3.4 |
| `pa-zigzag-fibonacci-fan` | 1,531.2 | 247.6 | 750 | runtime | 12 | 7.2 |
| `support-and-resistance` | 1,420.8 | 81.7 | 2,000 | declined `runtime:function-global-state` | - | - |
| `reverse-stochastic-momentum-index-on-chart` | 1,097.0 | 117.4 | 0 | runtime | 20.8 | 9.4 |
| `smart-money-volume-index-algoalpha` | 934.4 | 612.3 | 0 | runtime | **1,234.4** | 604.8 |
| `auto-trendline-dojiemoji` | 844.9 | 270.7 | 1,000 | declined `runtime:statement` | - | - |
| `optimized-keltner-channels-sltp-strategy-for-btc` | 686.4 | 29.7 | 1,000 | declined `runtime:statement` | - | - |
| `sessions` | 555.7 | 1,419.8 | 6,000 | runtime | 5.6 | 5.5 |
| `btc-charlie-trader-xo-macro-trend-scanner` | 404.0 | 1,496.3 | 1,500 | runtime | 141.4 | 151.4 |
| `institutional-smc-order-flow-matrix-pro` | 299.4 | 28.4 | 500 | declined `runtime:conditional-history` | - | - |
| `donchian-channels` | 113.3 | 106.6 | 0 | runtime | 317.7 | 120.1 |
| `implied-volatility-suite` | 111.2 | 64.2 | 0 | declined `runtime:history-dynamic-offset` | - | - |
| `support-and-resistance-multi-time-frame` | 85.2 | 119.2 | 0 | declined `runtime:request-with-state` | - | - |
| `trend-duration-forecast-chartprime` | 81.9 | 182.8 | 750 | runtime | 8.9 | 9.7 |
| `madrid-moving-average-ribbon` | 75.4 | 162.5 | 0 | runtime | 24.9 | 25.8 |
| `momentum-volatility-scanner` | 53.3 | 127.9 | 0 | runtime | 110.8 | 106.4 |

What the table says:

1. **The listing pass helps less than hoped.** On a member's deep daily chart the worst host documents
   still cost 8.6 to 19.1 s per compute (pivot-point-supertrend, supertrend-explorer, pmax-explorer,
   supertrend-strategy, atr-trailing-stop). Some cost MORE over the listing than over 5,000 bars (more
   bars, and the bars where the listing trajectories disagree pay the bounded window).
2. **Recurrences are the cost, and the runtime lane does them in milliseconds.** Every document with a
   recurrence costs 82 ms to 23.5 s; the runtime lane computes the ones it builds in 4.9 to 285 ms.
3. **Window work is not what the runtime lane fixes.** The documents with no recurrence cost at most
   1.1 s on the host lane, and one of them is SLOWER on the runtime lane (smart-money-volume-index,
   1,234 ms there, past the runtime lane's own 1,000 ms per-run budget).

## 5. Parity of the two lanes, and what each draws

Values, output by output (the vendor harness's row mapping, the run-half rail's equality rule,
`costRouteParity.js`), for the 14 documents over the budget that the runtime lane builds:

- **From the listing: every compared bar of every compared output is equal on both lanes, in all 14.**
  (pivot-point-supertrend 92,272 of 92,272; keltner 138,408 of 138,408; cpr 311,418 of 311,418; ...)
- Over the newest 5,000 bars (no listing): **no bar where both lanes draw a value disagrees.** The
  difference is the warm-up each lane withholds: the host draws its bounded window's first bars where the
  runtime lane withholds its warm-up off the listing (keltner 3,146 bars, trendlines 14,389), or the
  reverse (atr-trailing-stop 4,464, twin-range-filter 176).

What each document DRAWS is not the same for 7 of the 14 (`ROWS` pass of the measurement):

| script | host draws | runtime document draws | same picture? |
|---|---|---|---|
| keltner-center-of-gravity-channel | 6 plots, 10 fills | 12 plots (the 6 hidden fill anchors drawn), 0 fills | no |
| sessions | 4 plots, 4 fills, 3 paints | 8 plots, 0 fills, 3 paints | no |
| session-hilo | 1 plot, 1 fill | 2 plots, 0 fills | no |
| atr-trailing-stop-by-ceyhun | 3 plots, 1 fill | 3 plots, 0 fills | no |
| supertrend-strategy | 6 plots, 1 fill | 6 plots, 0 fills, 1 paint | no |
| opening-range-initial-balance-opening-price | 14 plots (7 markers) | 7 plots | no |
| cpr-with-mas-super-trend-vwap | 11 plots (2 arrows) | 27 plots (16 the host hides), no arrows | no |
| pivot-point-supertrend, twin-range-filter, qqe-signals, trendlines, pa-zigzag-fibonacci-fan, btc-charlie, trend-duration-forecast | | | **yes** |

The runtime lane does not draw a fill, a horizontal line, a background or a bar colour yet
(`memberPaneDefinition.js::RUNTIME_UNDRAWN_KINDS`, "which a script drawn bar by bar does not draw here
yet"). Moving those scripts would show the member less.

**Admission.** The runtime lane serves a member's script only when the server's capability detector
admits it (`PINE_RUNTIME_CAPABILITY_ADMISSION = on`). Asked of the 7 with the same picture
(`api/services/pine_capabilities.capabilities_of` against `runtime_definitions.admitted_capabilities`):
pa-zigzag-fibonacci-fan is NOT admitted (`request-other`); the other 6 are.

**Graded against TradingView** (the vendor harness, `vendorHarness.corpus.test.js`, over every committed
capture of the 7 scripts the route moves: 14 captures, RDDT and SPY daily), on the production lane
(`VENDOR_HARNESS_RUNTIME_ON=0`: the host documents) and on the runtime-on lane after the change
(`VENDOR_HARNESS_RUNTIME_ON=1`: the lane evidence reports `runtimeDrawn: 14`, so every one was drawn by
the runtime lane, moved by the route):

| capture | host lane | runtime lane (moved) |
|---|---|---|
| btc-charlie-trader-xo-macro-trend-scanner, RDDT / SPY | MATCH (5 plots, objects) | MATCH (5 plots, objects) |
| pivot-point-supertrend, RDDT / SPY | MATCH (8) | MATCH (8) |
| qqe-signals, RDDT / SPY | MATCH (2) | MATCH (2) |
| trend-duration-forecast-chartprime, RDDT / SPY | MATCH (1, objects) | MATCH (1, objects) |
| trendlines, RDDT / SPY | MATCH (8, objects) | MATCH (8, objects) |
| twin-range-filter, RDDT / SPY | MATCH (2) | MATCH (2) |
| vw-ratchet-stops (harness fixture), RDDT / SPY | MATCH (8) | MATCH (8) |

14 of 14 MATCH on both lanes, every plot and every object comparison. (`vw-ratchet-stops` is a harness
fixture script, not in `corpus/committed`; the route moves it too.)

## 6. Route by cost: the design (written before the code)

**What moves.** The member door (`memberPaneDefinition`) still asks the host lane first. When the host
lane accepts a script, and only while the runtime pane is on for this viewer, the door reads what the
host document costs (`engine/hostLaneCost.js::hostLaneCostOf`). A document over budget is offered to
the runtime lane exactly as a host refusal is (`runtimeLaneDefinition`, `routed: false`), and the door
serves the runtime document only when all three hold:

1. the runtime lane builds it and admits it: its own kill list, starter allowlist and per-script
   capability verdict, unchanged (`runtimeLaneDefinition`);
2. its document draws **the same picture** as the host document (`costRoute.js::sameDrawnSurface`):
   the same visible plots, matched by the translation output each draws, with the same style, and the
   same number of fills, horizontal lines and paints, and drawings on both or neither;
3. (a property of 1) it carries the runtime lane's own per-run budget and worker.

Anything else returns the host answer a member gets today, unchanged, carrying `costRoute` (why it
stayed: the runtime decline's code, or `cost-route:surface`) for a census. Nothing a member reads changes.

**The estimate, one authority, no clock.** `interpret.js::recurrenceStepsPerBar`: the host lane computes
a recurrence (`accum` / `accumK`, a Pine `var`) over a bounded window, so one bar costs the recurrence's
warm-up times what one step computes. Both factors are read from the evaluator's own authorities: the
step's units are the units `evaluationUnits` keys on that recurrence (the walk `budget:nodes` thresholds
and the memo is keyed on, now with an optional tally that changes no count), the warm-up is the
recurrence's declared lookback (`ownLookback`). The document's trees are measured as one pass (a
recurrence two plots share is computed once). Window work is not counted: it costs about the same on both
lanes and moving it fixes nothing (smart-money-volume-index is slower on the runtime lane).

**The budget, derived.** `HOST_RECURRENCE_STEP_BUDGET = LONG_TASK_MS / CHEAPEST_MEASURED_STEP_NS`: a long
task (50 ms, the W3C threshold) at the CHEAPEST recurrence step measured in section 4 (`sessions`,
18.5 ns), over 5,000 bars: 2,702,702 steps, 540 a bar. The cheapest step gives the largest honest budget:
a document moves only when even at that rate its recurrences alone would hold the main thread for a long
task. Against the corpus: every document over it measured at least 82 ms; the only document with a
recurrence under it (institutional-smc, 500 a bar) is declined by the runtime lane anyway.

**Why it stays honest.**
- The runtime lane's own admission is not bypassed: a moved script is one that lane would draw if the
  host refused it today.
- The picture is compared before moving; the corpus showed 7 of 14 candidates would have drawn differently.
- The values are compared (section 5 and the rail): equal on every bar both lanes draw.
- Only viewers whose runtime pane is on are affected; with it off the door is byte-identical (railed).
- Saved documents are not rewritten: `savedScriptUpgrade.retranslateRow` answers "inconclusive" when a
  re-translation lands on another lane, so a member's saved host document stays host. The route reaches
  scripts installed after it ships.

**Consequences, stated.**
- A cost-routed document is a runtime document. It draws only while the runtime pane is on for the
  viewer and the script is not killed, like every runtime document: if `PINE_RUNTIME_STAGE` is turned
  down, a cost-routed document saved by an admin says "switched off" instead of falling back to the host
  lane. A share-install copies the saved document, so a cost-routed document shared with a member who
  has no runtime pane is refused for that member (as every runtime document is today).
- Off the listing the two lanes withhold different warm-up bars (section 5): a moved script can draw a
  few hundred more or fewer early bars on a weekly or intraday chart. No drawn value differs.
- **Server lanes.** Alerts, scans and backtests run a runtime document only at `PINE_RUNTIME_SERVER_STAGE`
  (dark in the flag ledger), so a cost-routed script's server-side evaluations are withheld by name, where its
  host document would have been run by the Python lane (`ast_interpret`). For these scripts that lane is
  itself expensive (the compute-caps evidence: one cap-deep recurrence is 0.51 s a symbol on the sweep), but
  it is a change, and it reaches only viewers whose runtime pane is on.
- **The first draw waits for the worker.** A runtime document draws when its worker run lands; on a cold
  tab the worker chunk (about 1.3 MB) loads first (trendlines: values at 4.2 s against 2.4 s on the host
  lane). And, as for every runtime document today, the pane draws nothing while a run for a new bars array
  is in flight (`runtimeColumnsFor` answers `{}`), which for these scripts is milliseconds.

**Rollback.** Revert the commit; the door is the only behaviour change and saved documents were never
rewritten. Per script, the runtime kill list (`PINE_RUNTIME_KILL_LIST`) declines a script on the runtime
lane, and the route then keeps the host answer for new installs. For everyone at once,
`PINE_RUNTIME_STAGE=off` stops every runtime document, cost-routed ones included.

**Engine number.** The door writes a different document for an unchanged script (for a runtime-on
viewer), so `scriptEngineVersion.js` carries a NUMBER PENDING line; the coordinator numbers it at merge.

## 7. Route by cost: the rails, and what else moved

| rail | what it holds | mutation (break it, see red, restore byte-equal) |
|---|---|---|
| `engine/hostLaneCost.test.js` (10) | the estimate on trees: one `var` is its warm-up times one step's units; no recurrence is 0; a recurrence read twice counts once; nested ones each count; the tally changes no unit count; the budget is derived (2,702,702 = 50 ms / 18.5 ns) and 540 a bar stays, 541 moves; a shared recurrence across plots counts once; a non-host or unreadable document never moves | M1: the tally counts 0 -> 11 red. M2: never over -> 8 red |
| `builder/memberPane/costRoute.test.js` (6) | the picture: same plots by output (keys differ between lanes) is the same; a plot the run does not draw, a row the host hides and the run draws, a fill, a style, hlines, paints and drawings each differ, with controls | M5: fills not compared -> red |
| `builder/memberPane/routeByCost.test.js` (9) | the door, on committed scripts: twin-range-filter MOVES (and says why); with the runtime pane off nothing moves and nothing is asked; keltner's fills keep the host answer; pmax-explorer's runtime decline keeps it; not graded keeps it; production's admission (no grant): no verdict keeps it, the latched verdict moves it; a cheap document is not offered; and the moved script's values equal on both lanes (from the listing and over 5,000 bars) with a control that must report a 0.1% perturbation | M3: the runtime-pane gate removed -> 3 red. M4: the picture check removed -> red. M6: declines treated as moves -> 2 red. M8: the note's reason dropped -> red |

**Found by the suites and fixed here**: the runtime lane's run key (`runtimeColumns.runtimeContentKey`) did
not name the libraries a run links (U15's `meta.libraries`), so an incremental session compiled against one
library was resumed for a document pinned to another. `vendorHarness.capRound4`'s control (a library whose
declared default is `low` must DIVERGE) passed alone and went MATCH after its MATCH sibling once the route
put the probe on the runtime lane. The pins are now part of the key (M7: dropped -> the control red).
Unreachable in production today (a pinned library version is immutable), so a correctness of the key, not a
member-facing defect.

**Pins that follow the moved scripts**: `capabilityEvidenceLane.test.js` re-asks the door the lanes of the
reach run (`2026-11-16-draw1-drawing-objects/runs/report.json`); 14 rows move `host -> runtime` (the 7
scripts, RDDT and SPY), each graded MATCH on the runtime lane after the change (section 5); the REACH rule
(no runtime-lane DIVERGE) holds. `vendorHarness.rt1RuntimeFallback`'s qqe-signals and pivot-point-supertrend
cases asserted "the host lane serves it first (H1)"; they now assert the cost route.

Suites (GitHub runners, `tools/remote_tests.py`, `src/components/chart/builder` + `src/components/chart/engine`,
6 shards, plus `tests/test_pine_capability_admission.py` and `tests/test_ast_budget.py`): green except two
rails inherited from this branch's base and fixed on master since by `69931215c4`
(`memberPaneGate`'s path through the share page, `suiteCoverage`'s `builder/inspect` acknowledgement).

## 8. What a member still feels, and the fix this does not build

With the runtime pane on for every member (stage `all`), this change moves the 6 committed scripts for every
member. 12 of the 16 host documents over a second stay on the host lane (6 draw fills or markers the runtime
lane does not draw yet; 4 the runtime lane declines; 1 it does not admit; 1 is window work), and they include
the worst (supertrend-strategy
8.6 s per load freeze and two 7.5 to 8.1 s freezes per daily poll in the browser; pmax-explorer and
supertrend-explorer 17 s at 5,000 bars in node).

The way to reach them, larger than this change:

- **Compute the host lane off the main thread (option b).** The same lane, the same code, in a worker:
   every host document, every member, today, values unchanged by construction. What it needs, read off the
   code: the host values are `astColumns.js::astColumnsFor`, already host-neutral (the server bundle runs it,
   `headlessCompute.js`), and the run-read parts are applied AFTER it (`astLaneColumns`'s `extras`), so they
   can stay on the main thread; the side records (`columnErrors`, chart clock, other-symbol, lower-timeframe
   and withheld-bars reports) are attached by five `with*` helpers and would cross the worker boundary as
   plain data; the context's maps (`secondary`, `lowerTf`) cross as the runtime worker already sends them.
   The hard part is not the worker: **a lane answering `{}` while its run is in flight makes the binder
   release the series** (`binder.js`, `hasData`), which is what the runtime lane does today for its run's
   duration on every new bars array. For a 6-second host compute that would be a pane blank for 6 seconds on
   every poll, so option b needs the previous columns kept on screen while the next run computes
   (stale-while-revalidate, aligned on bar time), and a symbol or timeframe switch must still clear them. A
   worker for members who never load the runtime lane (its chunk is 1.3 MB) and the object lane (host
   drawings are evaluated on the main thread too, `objectRuntime.js`) are the rest of its scope.

## 9. How it was measured

All on the dev PC, one heavy job at a time under `heavy_lock.py`; scratch output outside the repo.

```sh
# node: every host document, both lanes, parity (from app/; ~8 minutes)
HOST_LANE_COST_OUT=$O/hostcost.json node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/ast/hostLaneCost.measure.test.js --maxWorkers=1 --testTimeout=7200000
# the static estimate per document; what each lane's document draws (no compute)
HOST_LANE_COST_ESTIMATE_OUT=$O/estimate.json ... -t "static recurrence"
HOST_LANE_COST_ROWS_OUT=$O/rows.json HOST_LANE_COST_ONLY=<slug,...> ... -t "what each lane draws"

# browser: a production build, a sandboxed backend per stage, the probe
VITE_PINE_MEMBER_PANE_ENABLED=1 VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1 VITE_PINE_RUNTIME_PANE_ENABLED=1 \
  VITE_PINE_STRATEGY_BROKER_ENABLED=1 npm run build
PINE_RUNTIME_STAGE=off    PINE_RUNTIME_CAPABILITY_ADMISSION=on PINE_RUNTIME_SAVE_ENABLED=1 \
  python tools/local_backend_sandbox.py --port 8142 --email <sandbox>   # before the route
PINE_RUNTIME_STAGE=admins PINE_RUNTIME_CAPABILITY_ADMISSION=on PINE_RUNTIME_SAVE_ENABLED=1 \
  python tools/local_backend_sandbox.py --port 8141 --email <sandbox>   # a runtime-on viewer
python tools/pine_coverage/host_lane_browser_probe.py --base http://127.0.0.1:8142 \
  --script corpus/committed/<slug>.pine --label <name> --out $O --poll [--trace]
python tools/pine_coverage/host_lane_browser_probe.py --base http://127.0.0.1:8141 \
  --script corpus/committed/<slug>.pine --label <name> --out $O --poll --expect-runtime
node tools/pine_coverage/profile_by_source.mjs $O/<name>.load.cpuprofile   # CPU by source file

# the harness, both lanes, over the moved scripts' captures (copied to $H)
VENDOR_HARNESS_RUNTIME_ON=0|1 VENDOR_HARNESS_DIR=$H VENDOR_HARNESS_OUT=$O/h0|h1 \
  node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js
```

Notes on the rig, learned the hard way: a fresh account's workspace is empty (the probe adds a Chart
widget); the member door's entry moved under "Add indicator" (2026-11-16, UCT Signature R2; the older
capture tool still looks for "New Formula"); the legend shows a script's values only under the crosshair, so
the probe hovers inside the price pane; a heavy script's preview computes on the main thread before its
save, so the probe waits for the stored definition; and a runtime-on viewer's preview moves to the runtime
lane only when the capability verdict lands, so `--expect-runtime` waits for that preview. The bundle
measured carries the route; three edits after it (the run key's library pins, a decline code, the note's
sentence) do not touch these scripts' compute.
