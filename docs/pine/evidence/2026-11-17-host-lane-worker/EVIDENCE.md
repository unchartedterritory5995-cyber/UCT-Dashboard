# The host lane off the member's main thread (option b): design, byte-equality, before/after (evidence, 2026-11-17)

Branch `feat/host-lane-worker`, cut from `feat/route-by-cost` at `07fc57e6e0` (PR #1711, not merged when this
was cut; it goes into engine train e73). Follows `docs/pine/evidence/2026-11-17-host-lane-cost/EVIDENCE.md`,
whose section 8 scoped this change ("option b") and whose browser rig and corpus measurement are reused here.

## 1. Answer first

- **A chart's costly host document is computed in a Web Worker, and so is every host object program a chart
  draws.** The values are computed by the SAME function on both threads (`astColumns.js::astColumnsGiven`),
  the drawings by the SAME function (`hostObjects.js::hostObjectRun`), over the same rows, scalars and
  context; nothing about what is computed changed, only the thread.
- **Byte-equal by construction, and railed:** every committed script the door puts on the host lane (90),
  answered on the main thread and through the worker path over a structured clone of the exact messages, on the
  AAPL daily capture (unix times), from AAPL's listing day (ISO-date times) and on the SPY 60-minute capture:
  **270 of 270 answers byte-equal** (columns byte for byte, every record and its frozen depth) and **141 of 141
  drawings equal** (section 3).
- **The member's real path, before and after** (production build, sandboxed backend, member view, the chart's own
  daily poll): pivot-point-supertrend's longest main-thread task **12.0 s / 11.9 s -> 0.33 s / 0.34 s** on load and
  **16.7 s / 12.5 s -> 0.25 s / 0.19 s** on the poll; supertrend-strategy's **17.3 s / 15.1 s -> 0.19 s / 0.87 s**
  and **16.6 s / 12.1 s -> 1.1 s** (the 0.9-1.1 s left is lightweight-charts drawing its series when the values
  land, not compute); high-low-open-mid-ranges' drawings **4.0 s -> 0.12 s** and **2.9 s -> 0.08 s**; a cheap
  script unchanged or faster. `interpret.js` on the main thread: ~16 s per load and ~25 s per poll -> 51 ms and 0
  (section 4).
- **Stale-while-revalidate:** a poll's recompute keeps the pane's last values drawn (re-aligned on bar time)
  and its drawings in place; nothing blanks. The first load shows nothing until the values land (the pane's
  loading state); a symbol or timeframe switch never draws the old symbol's values or drawings.
- **Cheap documents stay on the main thread** by #1711's estimate (`hostLaneCost.js::hostLaneCostOf`, one
  authority, no clock): posting a cheap document and reading it back costs the main thread 0.75 ms at the median
  (5,000 bars), but its landing asks for a whole chart repaint (80-150 ms in the browser) against a median compute of
  6 ms, and its first paint would wait a round trip (section 5). ⚠️ The estimate counts recurrences, so 8 window-work
  documents (92 ms to 1.3 s at 5,000 bars) stay on the main thread: a gap of the ONE estimate, named in section 8,
  not routed around with a second one.
- **The object lane was NOT cheap enough to stay** (section 6): 29 of the 41 committed host object programs
  cost a long task or more per evaluation on 5,000 daily bars (up to 2.0 s; 4.0 s from the listing), and the
  binder evaluated them on EVERY sync, not only on new bars. They are now evaluated in the worker, once per bars
  array.
- **Engine number: none.** Nothing the translator writes changed (section 9).

## 2. The design as built

```
binder.sync (main thread, inside StockChart.updateChart)
  computeFor(def, calcBars, inputs, {..., hostPane})        nativeRegistry.js
    AST lane -> hostLaneOffThread(...)                       hostLaneAsync.js
      astLanePlan: the member's settings, the calc_bars window, the scalars   (main, as before)
      hostLaneCostOf(plan.def).over ? (#1711's estimate)   no -> null -> astLaneColumns, as before
      memo per bars array (+ everything else the values read) -> done: astLaneFinish (main) -> columns
                                                            -> pending: the pane's last picture, on bar time
      new job: the runtime.error stop asked here (its evaluator reaches the registry), then posted
  worker (one per tab)                                       hostLaneWorker.js -> hostLaneWorkerCore.js
      astColumnsGiven(def, rows, scalars, ctx, stop)         the function astColumnsFor runs on the main thread
  landed -> notifyColumnsLanded -> StockChart repaints -> binder.sync -> the memo answers -> drawn

  syncObjects -> hostObjectsOffThread(def, bars, readerOpts, pane)        hostLaneAsync.js
      memo per bars array -> done: {reader, run} -> toRenderState (main) -> the layer
      pending: the layer stays when it is this pane's own picture, is taken down when it is not
  worker: hostObjectRun(def, rows, readerOpts)               hostObjects.js (moved from runHalfObjectRail.js)
```

- **The split** (`astColumns.js`): `astLaneColumns` = `astLanePlan` (settings, window, scalars) + values
  (`astColumnsFor`) + `astLaneFinish` (the run-read parts and the window's widening and record): the same calls
  in the same order. The run-read parts (`nativeRegistry.astRunExtras`: run-read colours, the run half) answer
  to this tab's gates, so they stay on the main thread, applied when the values land.
- **What crosses** (`hostLaneWire.js`): every field of every bar, column by column (a field whose every value is
  a number rides a TRANSFERRED `Float64Array`; anything else, such as a daily bar's ISO-date `t`, a plain array);
  the context fields the values read (`HOST_CTX_FIELDS`, held to the closure by a rail), the symbol, the
  other-symbol and intraday entries the document's own decisions ask for (recorded on the main thread by running
  that decision, which reads no bars), and `exchangeOf`'s answers (a function does not cross; the table of its
  answers does). The document crosses ONCE per worker (kept by id, 32, evicted in step with the main thread).
  The answer: every column (buffers transferred back) and the six records the values carry non-enumerably
  (`AST_SIDE_RECORDS`: column reasons, the runtime.error stop, the other-symbol, lower-timeframe, chart-clock and
  withheld-bar reports), re-attached exactly as attached, frozen to the same depth.
- **Stale-while-revalidate** (`hostLaneAsync.pendingAnswer`): a pending answer carries the pane's last picture
  for the SAME pane signature (document and settings, symbol, timeframe) re-aligned on bar time to the bars now
  asked for (a bar the old answer did not hold reads `NaN`). Not the bars, not the listing statement, not the
  forming-bar state: those change under one pane (a poll, the deep history). The binder never memoises a pending
  answer, and holds the instance's notices and drawings as they stand until the values land. **On the renderer**
  a series the pane already holds is handed no data while pending (its points are placed by bar time, so they stay
  where they were; a new bar has no point yet), and when the values land the binder re-sets it whatever the plan
  says: the landing repaints with the SAME bars, and StockChart's `noop` plan leaves a series untouched, so without
  that re-set the landed values would reach the legend and not the line (found and fixed here; railed). A poll costs
  the renderer one `setData` per series, as before, not two.
- **Supersede** (`submit`): one job in the worker at a time; at most one waiting job per pane (a newer one
  replaces it; the replaced one is forgotten, never answered, so its bars asked again are a new job). A job
  already in the worker finishes and is remembered for ITS bars array only: a chart asks with its current bars,
  so a superseded answer is never painted, and as a stale picture it serves only a request with its own pane
  signature (another symbol's never does).
- **Failure** (never a silent blank): no worker can be started, a worker crashes, a message cannot be read, or a
  post is refused (a document that does not clone): that job is computed on the MAIN thread, today's path, with
  today's values; after three workers the tab computes every host document there. Past the watchdog
  (`HOST_WORKER_WATCHDOG_MS`, 180 s: the dearest document is 23.5-32.9 s at 5,000 bars in node) the worker is
  stopped and that job is refused BY NAME on every column (`host-lane:worker-unresponsive`), said on the member's
  strip beside a stopped run's sentence; not the main thread, because a job that outran the watchdog would freeze
  the page at least that long. The next bars array tries a fresh worker.
- **The worker's closure is host-neutral** (railed): `astColumns.js`'s (the server bundle's own) plus the object
  lane, which no longer reaches the chart registry: `objectColumns.js` and `runtimeErrorStop.js` read their
  helpers from where they live (`astColumns.js`, `ast/bind`), and the one runtime-document `computeFor` read the
  object reader makes goes through `objectRuntimeSeam.js`, which the registry writes on import.
- **Infrastructure reused from the runtime lane** (`runtime/runtimeAsync.js`): the spawn
  (`new Worker(new URL(...), {type: 'module'})`, Vite's worker chunk), the landing signal
  (`serverCompute.notifyColumnsLanded`, which `StockChart` already repaints on), the per-pane coalescing, the
  watchdog and the bounded restarts. One worker per tab. No dependency added.
- **Not moved**: requests that are not a chart pane's (`validateEventColumns`, the vendor harness, probes);
  host object programs with C18 runtime placeholders (`objects.runtime`: their values come from the runtime
  lane's VM, registered on the main thread only; 3 committed scripts); a run half's object rail
  (`runHalfObjectRail`, part of the run-read parts, only for a viewer whose runtime pane is on).

## 3. Byte-equality: worker against main thread, over the corpus

`__tests__/hostLaneWorker.parity.test.js`: every committed script (`corpus/committed`, 266) through the member door
with the runtime pane off (every script the door can put on the host lane is a host document: 81), each answered
on the main thread (`computeFor`, no pane) and through the worker path (`computeFor` with a chart pane:
`hostLaneAsync` plans it and posts the exact message; a stand-in worker runs the worker's own handler over a
`structuredClone` of that message with its transfer list and answers with a `structuredClone` of the reply; the
answer is finished on the main thread), with every route forced to the worker so cheap documents are compared too.
Compared: every own property of the answer, enumerable or not, typed arrays BYTE for byte, objects to the same
frozen depth; and, for every document whose drawings the worker takes, the object program's run and the reader
facts the binder reads.

Run on the dev PC under `heavy_lock` (node 24, vitest, 600 bars a set: the chart's first paint; the CI default):

| | |
|---|---|
| host documents compared | **90** (the 81 a member's door serves on the host lane, plus the 9 the known-divergence list routes away from it for a member: the test host ignores that list) |
| answers compared | **270** (90 × 3 bar sets), **270 byte-equal**, 0 differences; 0 throws (a throw is compared too: same name, message and guard) |
| bars | 162,000 |
| bar sets | AAPL daily newest 600 (unix-second times) · AAPL daily from the listing day, `historyFromListing` (ISO-date times) · SPY 60-minute newest 600 |
| records compared beside the columns | chart-clock reports on 47 answers, column reasons on 11, other-symbol reports on 15, the runtime.error stop on 3 (the lower-timeframe and withheld-bar reports appear on no committed answer here; they are held by a direct rail, section 7) |
| drawings compared | **141** (47 documents × 3 sets whose object program the worker takes), **141 equal** (105 of them draw something): the run (every live object, its props, cells, stats, withheld families and sentences) and the reader facts the binder reads |

`HOST_WORKER_PARITY_BARS` widens the bar count. The values are the same function on both threads over the same
arguments, so the bar count changes what is computed, not whether the threads agree; 600 keeps the rail in a CI
shard (150 s on the dev PC).

## 4. Before and after, on the member's real path

Rig: `tools/pine_coverage/host_lane_browser_probe.py` (#1711's), unchanged except that it now also reads the
`host-lane:worker-run` timeline entries (`hostLaneAsync` records one per landed job). Two production builds with
production's flags (`VITE_PINE_MEMBER_PANE_ENABLED=1 VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1
VITE_PINE_RUNTIME_PANE_ENABLED=1 VITE_PINE_STRATEGY_BROKER_ENABLED=1`): BEFORE = `07fc57e6e0` (route by cost),
AFTER = this branch. Each served by its own sandboxed backend (`tools/local_backend_sandbox.py`, a Temp `DATA_DIR`)
with `PINE_RUNTIME_STAGE=off` (a member with no runtime pane: the evidence's member view; every script below is a
host document), the same sandbox account, the AAPL daily capture answered at the network (11,534 bars from the
listing day; a 600-bar first paint, then the deep history), and the chart's own next daily poll waited for
(300 s; each poll moves the newest close by a cent). Runs bracketed per script (before, after, back to back), one
at a time under `heavy_lock`, on the dev PC.

Two brackets for the two costly scripts (the first `after` build predates the renderer fix of section 2; the `after2`
build is this branch's head), one for each of the others. "Long tasks" are every main-thread task over 50 ms
(PerformanceObserver); "frames stopped" the longest gap between animation frames; "first values" when the
script's legend chip first showed a number (the probe hovers the pane; a drawing-only script shows none).

| run | load: long tasks | **load: longest** | load: frames stopped | first values (s) | poll: long tasks | **poll: longest** | poll: frames stopped |
|---|---|---|---|---|---|---|---|
| pivot-point-supertrend, before | 10, 17,108 ms | **12,001 ms** | 12,050 ms | 8.2 | 7, 29,507 ms | **16,726 ms** | 16,733 ms |
| pivot-point-supertrend, after | 11, 1,370 ms | **327 ms** | 383 ms | 9.0 | 11, 924 ms | **248 ms** | 250 ms |
| pivot-point-supertrend, before (2) | 12, 17,074 ms | **11,935 ms** | 11,983 ms | 7.0 | 5, 24,584 ms | **12,476 ms** | 12,466 ms |
| pivot-point-supertrend, after (2) | 12, 1,421 ms | **339 ms** | 317 ms | 9.3 | 11, 916 ms | **186 ms** | 267 ms |
| supertrend-strategy, before | 11, 20,999 ms | **17,268 ms** | 17,333 ms | 5.5 | 5, 16,883 ms | **16,610 ms** | 16,616 ms |
| supertrend-strategy, after (pre-fix build) | 9, 1,007 ms | **192 ms** | 200 ms | 4.9 | 7, 9,449 ms | **2,433 ms** | 2,450 ms |
| supertrend-strategy, before (2) | 12, 18,656 ms | **15,118 ms** | 15,166 ms | 5.5 | 5, 23,887 ms | **12,058 ms** | 12,083 ms |
| supertrend-strategy, after (2) | 9, 1,664 ms | **869 ms** | 850 ms | 4.1 | 7, 2,069 ms | **1,073 ms** | 1,083 ms |
| keltner-channels-bands (cheap, values on the main thread in both) before | 19, 2,023 ms | 301 ms | 383 ms | drawn ¹ | 2, 179 ms | 117 ms | 117 ms |
| keltner-channels-bands after | 8, 747 ms | 156 ms | 167 ms | drawn ¹ | 4, 405 ms | 171 ms | 183 ms |
| high-low-open-mid-ranges (drawings: 1.3 s / 2.7 s in node) before | 22, 59,992 ms ² | **4,042 ms** | 4,050 ms | - | 3, 8,040 ms | **2,864 ms** | 2,866 ms |
| high-low-open-mid-ranges after | 10, 759 ms | **121 ms** | 133 ms | - | 2, 165 ms | **83 ms** | 83 ms |
| atr-bands (cheap values, 23 ms drawings) before | 5, 526 ms | 225 ms | 250 ms | 2.3 | 8, 878 ms | 148 ms | 150 ms |
| atr-bands after | 6, 518 ms | 138 ms | 167 ms | 1.8 | 3, 274 ms | 146 ms | 150 ms |

¹ the script's title carries a trailing space, so the probe's legend match never fired (fixed in the probe since);
the screenshot shows its five lines and the legend's values. ² the drawing-only scripts show no number in the legend,
so the probe ran to its 900 s settle limit and the load window holds two polls.

When the final values (the deep history) arrive — the time of the main thread's last compute before, the worker's
landing after:

| | before | after | worker compute of the deep history |
|---|---|---|---|
| pivot-point-supertrend | 20.5 s / 19.4 s (frozen 16.4 s / 16.0 s of it) | 21.2 s / 24.0 s (never frozen) | 12.3-14.8 s |
| supertrend-strategy | 23.1 s / 21.1 s (frozen 20.1 s / 17.8 s of it) | 17.0 s / 13.0 s (never frozen) | 6.7-13.5 s |

What the numbers say:

- **No main-thread task attributable to the host lane's compute exceeds 100 ms.** The CPU profiles: `interpret.js` on
  the main thread was ~16 s (load) and ~25 s (poll) of pivot-point-supertrend's `before (2)` run, and is 51 ms (load)
  and 0 ms (poll) after; the remaining long tasks are the chart's own work (lightweight-charts, React, StockChart,
  `marketSession`), the same families the evidence's no-script control showed (up to 133 ms there; this machine was
  busier today: the same `before` runs measured 12-17 s where #1711's measured 5.6-8.6 s).
- **The page never stops drawing for a script's compute.** pivot-point-supertrend: the longest frame gap falls from
  12.0 s to 0.3 s on load and from 16.7 s / 12.5 s to 0.25 s / 0.27 s on the daily poll; supertrend-strategy: 17.3 s
  / 15.2 s to 0.2 s / 0.85 s on load and 16.6 s / 12.1 s to 1.1 s on the poll; high-low-open-mid-ranges (drawings):
  4.0 s to 0.13 s and 2.9 s to 0.08 s.
- **supertrend-strategy's remaining ~0.9-1.1 s tasks are the renderer drawing it, not computing it**: each sits on a
  landing (13.0 s, 315.5 s), and its profile is lightweight-charts (setting 11,534 bars into the strategy's six
  series, its fill and its trade markers); before, the same drawing ran inside the 12-17 s freezes. The renderer fix
  of section 2 halved it (the pre-fix build re-set the stale picture too: four 1.6-2.4 s tasks per poll, now one).
  Making that drawing cheaper is not this change's question; it is measured here so it is not mistaken for compute.
- **First values**: about the same (pivot 9.0-9.3 s against 7.0-8.2 s: its 600-bar first paint computes in the
  worker, cold, in 4.9 s; supertrend-strategy 4.1-4.9 s against 5.5 s), and the page is live meanwhile.
- **Final values**: supertrend-strategy's arrive 4-8 s sooner; pivot-point-supertrend's 1-4 s later, because its deep
  history waits behind the 600-bar job (one job at a time, a running job is not cancelled: the 600-bar picture is
  what the member sees meanwhile). Cancelling a running job its pane has superseded would bring the deep values
  forward by the 600-bar job's length at the cost of that first picture: a follow-up, not done here.
- **Cheap documents are no slower**: keltner-channels-bands (values on the main thread both times) and atr-bands
  (its drawings now in the worker) show the same or shorter tasks, and atr-bands' values appear sooner (1.8 s
  against 2.3 s: its drawings no longer evaluate on the main thread on the first paint).
- `host-lane:worker-run` entries confirm the route: pivot-point-supertrend and supertrend-strategy posted values jobs
  (600 bars, then 11,534 per poll), high-low-open-mid-ranges and atr-bands posted only drawings jobs, and
  keltner-channels-bands posted none.

## 5. The cheap-document check

The question: does a worker round trip cost a cheap document more than computing it? Two parts of the round trip
land on the main thread: posting it and reading the answer back, and the repaint the landing asks for.

**Posting and reading back** (`hostLaneWorker.measure.test.js`, round-trip pass, node 24, every host document
UNDER the budget: 61; median of three after a warm run; one structured clone with the transfer list stands for both
halves of a `postMessage`):

| bars | compute, median (p90) | post: pack rows + context + clone, median (max) | answer: clone + re-attach, median (max) | documents whose compute is cheaper than these two |
|---|---|---|---|---|
| 600 (first paint) | 1.7 ms (13.5) | 0.15 ms (0.30) | 0.02 ms (0.09) | 3 of 61 |
| 5,000 | 6.3 ms (80.8) | 0.73 ms (1.6) | 0.02 ms (0.13) | 14 of 61 |
| 11,534 (listing) | 12.7 ms (87.2) | 1.6 ms (4.0) | 0.03 ms (0.17) | 13 of 61 |

The transfer is not the cost: the rows go as transferred `Float64Array`s (no copy) and the document crosses once.

**The landing's repaint** is what decides it. A landing asks StockChart to repaint (`notifyColumnsLanded`: its
effect, the binder's sync, the renderer): a whole chart pass, which the probes show as tasks of up to 80-150 ms
around landings (high-low-open-mid-ranges' poll: 4 object jobs landed, 2 tasks over 50 ms, the longest 83 ms;
atr-bands' poll: 146 ms). Against a median cheap compute of 6 ms at 5,000 bars, sending a cheap document's values to
the worker would cost the main thread MORE per new bars array, and on a first load its pane would wait a round trip
for values it computes in a few ms. **So the values route by #1711's estimate** (`hostLaneCostOf(...).over`: cheap
stays on the main thread; one authority, no clock; railed, M8).

**Drawings are the exception, by measurement**: the estimate cannot see an object program's cost (section 6), the
binder used to evaluate it on EVERY sync, and moving it costs one landing per new bars array, not one evaluation
per repaint. For a cheap drawing program (atr-bands: values 4 ms, drawings 23 ms at 5,000 bars), the browser numbers
below show no cost to the member: the longest task 138 ms against 225 ms before, the poll 146 against 148 ms, the
drawings landing 69-239 ms after their bars (the first job includes the worker's cold start).

## 6. The object lane: measured, and moved

`hostLaneWorker.measure.test.js` (opt-in), every committed host document, member door with the runtime pane off,
the AAPL capture, node 24 on the dev PC under `heavy_lock`, median of three after a warm run:

- **41 of the 81 host documents carry an object program; 29 cost 50 ms or more per evaluation at 5,000 bars, 22
  cost 100 ms or more, and 28 cost 100 ms or more from the listing (11,534 bars).**
- #1711's estimate does not see that cost: it counts plot RECURRENCES, and the dearest programs read 0
  recurrence steps (vdubus-pattern-gen 1,328 ms, high-low-open-mid-ranges 1,278 / 2,682 ms, fib-retracement
  970 ms); their cost is the object program's own evaluation (`objectReaderFor`'s columns and probes,
  `evaluateObjects`' per-bar ops).
- **And the binder evaluated them on EVERY sync** (`syncObjects` -> `hostObjectRun`, unconditionally), not only on
  a new bars array: any repaint (a landed server or runtime column, a settings change) paid it again.

| script | values, 5,000 bars (ms) | drawings, 5,000 bars (ms) | drawings, listing (ms) |
|---|---|---|---|
| market-structure-by-leviathan | 2.6 | **1,983** | 713 |
| rsi-swing-indicator | 3.6 | **1,714** | 443 |
| trend-duration-forecast-chartprime | 72 | **1,501** | **3,215** |
| vdubus-pattern-gen-v2-restored-refined | 21 | **1,328** | **1,982** |
| high-low-open-mid-ranges | 4.0 | **1,278** | **2,682** |
| institutional-smc-order-flow-matrix-pro | 347 | **1,186** | 456 |
| fib-retracement | 2.1 | **970** | **1,265** |
| pro-trading-art-double-top-bottom-with-alert | 3.6 | 634 | 365 |
| trendlines | 3,058 | 596 | 148 |
| price-action-as-in-book-fibonacci-supportresistant-trendline | 1.8 | 540 | 471 |
| session-hilo | 2,540 | 464 | 77 |
| swing-highlow-zigzag-chartprime | 0.5 | 330 | 599 |
| sonarlab-order-blocks | 0.6 | 299 | 832 |
| ultimate-pivot-points | 20 | 293 | 669 |
| poor-man039s-volume-profile (C18 runtime placeholders: stays on the main thread) | 1.0 | 108 | **1,954** |
| … 26 more | | 2.6 – 175 | |

So the object lane is **covered, not left**: every host object program a chart draws is evaluated in the worker by
the same `hostObjectRun` (railed equal, section 3), memoised per bars array (a repaint with the same bars evaluates
nothing; railed). Not moved: the 3 committed programs with C18 runtime placeholders (their values come from the
runtime lane's VM, registered on the main thread only): poor-man's volume profile (108 ms / 1,954 ms),
options-max-pain-calculator (90 / 221 ms), k-clustering (36 / 125 ms). They keep today's path, and today's cost.

## 7. The rails, each proven able to fail

`__tests__/hostLaneWorker.rail.test.js` (19) and `__tests__/hostLaneWorker.parity.test.js` (corpus). Every mutant
below was applied to the source, the rails were run and went red, and the file was restored from a saved copy and
checked byte-equal (sha256), never `git checkout`; a control run of the unmutated rails, green, came first. Harness:
`mutants.py` (scratch), the rail file plus the parity rail over a 6-script subset at 300 bars.

| rail | what it holds | mutant -> red |
|---|---|---|
| parity (corpus) | worker answer = main-thread answer, every property byte for byte, records and frozen depth; drawings equal | M2: the worker is not handed the listing statement (`HOST_CTX_FIELDS` without `historyFromListing`) -> 4 scripts red on `daily-listing`, and the context rail red |
| every bar field crosses | an ISO-date time, `-0`, `NaN`, `±Infinity`, `null`, a field one bar lacks: unpacked as packed | M1: the worker drops a field that is not all numbers -> red (the parity subset alone stayed green: none of its 6 scripts reads bar time at 300 bars; this rail was added for it) |
| every record crosses | the six records a values map carries, re-attached with the same keys, non-enumerable, frozen to the same depth | M3: column reasons re-attached unfrozen -> red (the subset alone stayed green: none of its answers carried that record; this rail was added for it) |
| every ctx field crosses | every `ctx.<field>` the values' readers use is one the worker is handed (`HOST_CTX_FIELDS` + `HOST_CTX_CARRIED`) | M2 (above) |
| the worker closure | no registry, network, storage or build flag reachable from `hostLaneWorker.js` (the object reader is in; its registry edge is gone) | - (a closure walk; it read red on the first run, when the object reader still imported the registry) |
| route | the costly document goes to the worker, the cheap one is answered at once (equal to today's), `hostLaneRunsOffThread` = `hostLaneCostOf(...).over`; a request with no chart pane is never sent | M8: every document sent -> 2 red. M9: a request with no pane sent -> red |
| stale-while-revalidate (answer) | first load: pending, no column; poll: pending, the last values at the same bar times, `NaN` on the new bar; landed: equal to today's | M4: a pending answer never carries the last picture -> 2 red |
| stale-while-revalidate (binder) | through a poll no series is released and each keeps its values at the same times; the landed values replace them | M5: the binder memoises a pending answer -> red |
| supersede | three requests of a pane: two posted, the middle one never; asked again, it is a new job | M7: a newer job does not replace the waiting one -> red |
| symbol switch | MSFT's pending answer holds no column, before and after AAPL's in-flight job lands; MSFT's landed values are MSFT's | M6: the pane signature ignores the symbol -> red |
| failure | no worker: main thread at once, equal; a crash mid-job x3: each job on the main thread, a fresh worker each time, then the tab retires the worker; a refused post: main thread | M10: a crashed job left pending -> red. M11: a refused post left pending -> red |
| watchdog | past 180 s: every plot refused by `host-lane:worker-unresponsive`, the sentence on the member's strip | M12: the binder does not say it -> red |
| drawings | a worker job; a repaint with the same bars posts nothing; a poll keeps the layer; a symbol switch takes it down; C18 programs stay on the main thread | M13: a pending drawing keeps any layer -> red (its first run stayed green: the rule was written twice and the mutant reached only the copy the rail does not walk; the two are now one function, `objectsPending`). M14: the drawings not memoised -> red |

| the renderer (2b) | StockChart's own `noop` rule: a pending poll re-sets no series; the landing re-sets each once and the landed values reach the series | M15: a held series re-set with the stale picture -> red. M16: no re-set on a noop landing (the stale line stays) -> red |

| a throw crosses (the one rule) | the wire's error doors ARE `runtime/errorImage.js`'s (#1749, one implementation for both workers); a refusal with extra fields crosses whole and still reads as a refusal | M18: a local copy that drops fields -> red |
| the member never reads the id (`pane/attachedPineDisclosures.noGuardIds.test.jsx`) | `host-lane` is a registered guard namespace (`ast/guardIdText.js`), so the strip strips `host-lane:worker-unresponsive`; a host-lane note is among the rendered fixtures | M17: the namespace unregistered -> the drift rail red |

18 mutants, 18 red, 18 restored byte-equal. `hostLaneWorker.rail.test.js` is a whole-app engine rail
(`tools/whole_app_engine_rails.txt`): its closure walk reads app files outside pine heavy's trigger paths.

## 8. Consequences, stated

- **A costly document's values appear when the worker answers**, not inside the paint: on a first load the pane
  shows nothing until then (the loading state), where today the page froze and then showed them. A deep-history
  landing or a poll shows the last values (on bar time) meanwhile; a bar the last answer did not hold (a new
  session's bar) is blank until the values land.
- **Each landing asks for one repaint** (`notifyColumnsLanded`, the runtime lane's own signal): a document's values
  and its drawings are two jobs, so up to two repaints per new bars array for a costly drawing script.
- **One worker, one job at a time**: several costly documents on several charts queue. A pane's newer request
  replaces its waiting one; a job already running finishes (it is not cancelled: its result is the pane's newest
  picture if its bars are close, and terminating a worker costs a cold restart).
- **The window-work gap of #1711's estimate stays.** It counts recurrences, so 8 host documents whose values are
  window work (no recurrence) stay on the main thread although they cost 92 ms to 1.3 s at 5,000 bars
  (reverse-stochastic-momentum-index 1,287 ms; smart-money-volume-index 1,056 ms; institutional-smc 347 ms;
  momentum-volatility-scanner 187 ms; implied-volatility-suite 180 ms; madrid-ribbon 125 ms; support-and-resistance-mtf
  95 ms; donchian-channels 92 ms). The brief's rule (one authority, no clock, no second estimate) is kept; extending
  the ONE estimate with window work is the follow-up that moves them (the worker already computes them byte-equal:
  the parity rail routes every document).
- **C18 drawing programs stay** (3 committed scripts), and **a run half's object rail** (part of the run-read parts,
  only for a viewer whose runtime pane is on) still evaluates the host program on the main thread.
- **The worker chunk** is `hostLaneWorker-*.js`, 712 KB (178 KB brotli), fetched only when a chart first asks for a
  costly document or draws a host object program; nothing on first open (`tools/notebook_perf_budgets.py`: the same
  2,259,614 bytes before and after).
- **Rollback**: revert the commits. There is no flag: values are unchanged by construction and every failure path
  ends on today's main-thread path; the two seams touched for the worker's closure (`objectColumns.js` /
  `runtimeErrorStop.js` imports, `objectRuntimeSeam.registerObjectComputeFor`) change no answer (railed by the
  engine suites).

## 9. Engine number

`scriptEngineVersion.js`: bump "in the SAME commit as any engine change that alters what the translator WRITES
for an unchanged script ... A change that only alters how an EXISTING document is drawn needs no bump". This
changes neither what the translator writes nor any value drawn (railed byte for byte): it changes the thread.
**No bump, no NUMBER PENDING line.** (#1711's own NUMBER PENDING line is inherited unchanged.)

## 10. How it was measured

All on the dev PC, one heavy job at a time under `heavy_lock.py`; scratch output outside the repo.

```sh
# node: what stays on the main thread (values, run-read parts, drawings, stop, clone), every host document (~26 min)
HOST_WORKER_MEASURE_OUT=$O/measure.json node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/hostLaneWorker.measure.test.js --maxWorkers=1 --testTimeout=7200000
# node: a cheap document's compute against the round trip's main-thread share
HOST_WORKER_ROUNDTRIP_OUT=$O/roundtrip.json node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/hostLaneWorker.measure.test.js --maxWorkers=1 --testTimeout=7200000
# the byte-equality rail over the corpus (HOST_WORKER_PARITY_BARS widens it; HOST_LANE_COST_ONLY=<slug,...> narrows it)
node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/hostLaneWorker.parity.test.js --maxWorkers=1

# browser: two production builds, two sandboxed backends, the probe (bracketed per script)
VITE_PINE_MEMBER_PANE_ENABLED=1 VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1 VITE_PINE_RUNTIME_PANE_ENABLED=1 \
  VITE_PINE_STRATEGY_BROKER_ENABLED=1 npm run build            # in a 07fc57e6e0 worktree, and in this branch
PINE_RUNTIME_STAGE=off PINE_RUNTIME_CAPABILITY_ADMISSION=on PINE_RUNTIME_SAVE_ENABLED=1 \
  python tools/local_backend_sandbox.py --port 8151 --email <sandbox>     # before (from the 07fc57e6e0 worktree)
...                                       --port 8152 --email <sandbox>     # after (from this branch)
python tools/pine_coverage/host_lane_browser_probe.py --base http://127.0.0.1:8151 \
  --script corpus/committed/<file>.pine --label before-<name> --out $O --poll
python tools/pine_coverage/host_lane_browser_probe.py --base http://127.0.0.1:8152 \
  --script corpus/committed/<file>.pine --label after-<name> --out $O --poll
```

The probe now waits for the workspace to be drawn (a widget, or the "Add widget" door, up to 120 s) instead of a
fixed 8 s: a cold sandbox drew it after 20-40 s, and the first two runs of this measurement read that as
"no chart widget" (no measurement was taken from them).
