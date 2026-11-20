# One door for every chart pane's host values: memoised, routed by what the tab measured (evidence, 2026-11-19)

Branch `perf/ast-columns-offmain`, cut from master at `27add56b81` (engine train e87, which carries #2095, the
NA.SKIP fix). Follows `docs/pine/evidence/2026-11-17-host-lane-worker/EVIDENCE.md` (#1746: the host worker) and
`docs/pine/evidence/2026-11-18-host-lane-worker-followups/EVIDENCE.md` (#1756: supersede-terminate; the window-work
estimate measured and not wired).

## 1. Answer first

- **The case.** On production, a member's RDDT 1D -> 5m switch with Fred RS attached (patrick-54, CDP trace + V8
  profile, after #2095): **18 main-thread long tasks, 4,177 ms, worst 525 ms**, against **7 / 1,635 ms** with no
  script. Every sampled stack ended in `computeFor -> astLaneColumns -> interpret`, on the main thread.
- **Two faults, multiplied** (section 2):
  1. **The route.** The host worker (#1746) only took documents over #1711's estimate, which counts RECURRENCES.
     Fred RS is window work: **0 recurrence steps**, so its values ran on the main thread: **356 ms at 28,800
     five-minute rows** in node (25 ms at 600).
  2. **The repetition.** The binder never memoises a host answer whose RUN HALF is in flight (`binder.js`,
     `halfPending`), and the main-thread path kept no values of its own, so **every chart pass while Fred's run half
     waited computed the whole values pass again** (node: a repeat costs what the first did, 346 ms at 28,800 rows).
- **The fix: one door** (`hostLaneAsync.hostLaneColumns`) for every chart pane's host request:
  - the values are **memoised** per bars array, keyed on everything they read **and the rows' own content revision**,
    whichever thread computes them; a pass that asks again re-applies only the run-read parts;
  - the main thread computes them **only when this tab has measured them cheap at this size**
    (`hostLaneRoute.js`, predicted <= 50 ms), or for a document not measured yet over a first paint's rows; every
    other request goes to the worker. The measurement is a clock, per tab, bounded, never persisted.
- **The member's real path, before and after** (section 6: production builds, one sandboxed backend, a real click
  on `5m`, 28,080 rows as production's 28,006; three bracketed rounds):
  **before 6-7 long tasks, 1,750-2,074 ms, worst 413-453 ms; after 5-6, 460-894 ms, worst 156-341 ms; no script
  1-3, 147-384 ms, worst 147-251 ms.** `interpret.js` (the values) on the main thread over the switch: **871-972 ms
  before, 0-39 ms after**, and **at most 4 ms inside any after long task**. What is left in the after long tasks is the chart's own
  drawing and the run half's Pine frontend (named in section 8, not values).
- **Identical values, by construction and railed** (section 4): both threads run `astColumnsGiven` on the same
  arguments; the corpus parity rail now compares the main route's first answer and its memo hit with the no-pane
  answer byte for byte (and the worker's, as before); a cheap and a dear clock over the same documents answer the
  same columns. **No engine number, no NUMBER PENDING** (section 9).

## 2. The two faults, measured

Node 24 on the dev PC, vitest, under `heavy_lock`, Fred RS through the member door with the runtime pane on (what
production serves), synthetic RDDT-like 5-minute rows (04:00-20:00) with SPX at 5m on the newest 40% only (so the
series is `na` before them, as on production), SPX@D, its own daily rows and the seed (scratch harness, section 10):

| rows | values (`astLaneColumns`, ms) | the same request again (ms) | nodes evaluated |
|---|---|---|---|
| 600 | 25.3 | 22.3 | 191 |
| 5,000 | 105.6 | 83.7 | 191 |
| 11,534 | 182.8 | 190.1 | 191 |
| 28,800 | **356.0** | **345.7** | 191 |

- `hostLaneCostOf(fred)`: `{steps: 0, stepsPerBar: 0, over: false}`: the estimate sends it to the main thread.
- "The same request again" is `computeFor` on the same bars while the run half has not been served: it costs the
  whole values pass every time (fault 2). In the browser the binder asks on every pass while the run half waits (the
  rail in section 5, D, counts it: 6 syncs, 6 asks).
- Fred RS carries **no host object program** (its drawings are the run half's): the run half's object rail
  evaluates nothing for it, so the conditional third change (moving that rail off the main thread) was **not
  needed** and was not made.

## 3. Can the memo serve a stale picture? (the coordinator's hard requirement)

A memo keyed on the bars ARRAY would draw old values for a bar changed in place. Audited before building:

- **The bar store** freezes every bars array and every bar (`data/barStore/reducer.js`: `freezeBar`,
  `Object.freeze(n.bars)`): an in-place write cannot happen there.
- **The legacy bar hook** (`chart/useLegacyChartBars.js`) and the session filters (`keepRthBars`,
  `foldOffGridBars`) build new arrays (no `push`/`splice`/index write on a bars array; checked by search over
  `components/StockChart.jsx`, `components/chart/**`, `utils/`, `lib/`, `data/`).
- **The live writers** (six, derived by `engine/__tests__/singleWriterIndex.test.js`) write the renderer's series
  (`candleSeriesRef.current.update`), never the bars array.
- **A secondary's tail** lands as a new entry (`secondaryBars.refreshSecondaryTail`: `{ ...cur, bars: merged }`).
- The aggregators that assign `cur.h =` (`developingTail.aggregateToTf`, `resampleBars._aggregate`,
  `otherSymbols`' weekly fold) write accumulators they just created.

No path mutates in place today. **The key carries the content anyway**, so the memo's honesty does not rest on an
audit: `barsRevisionOf` hashes every bar's `t`, `o`, `h`, `l`, `c`, `v` (the fields the values read) and the row
count into 64 bits, for the chart's rows and for every other-symbol and intraday entry the values ask for. Rails
(section 5, C): a forming bar that moved, a bar appended and a historical bar corrected, **each IN PLACE on the same
array**, are each computed again on both routes, and equal a fresh compute; mutant M1 (the revision dropped from
the key) turns all of them red.

## 4. The design as built

```
binder.sync -> computeFor(def, calcBars, inputs, {..., hostPane})            nativeRegistry.js
  AST lane -> hostLaneColumns(...)                                           hostLaneAsync.js
    astLanePlan (settings, calc_bars window, scalars)                        main, as before
    memo: per bars array (WeakMap) x key (everything the values read + barsRevisionOf)
      done   -> astLaneFinish (run-read colours, run half) on a copy -> columns
      pending/refused/failed/threw -> as recorded
    new: the runtime.error stop (main, as before), then THE ROUTE
      over #1711's estimate           -> worker (unchanged)
      computesOnMain(doc, tf, rows)   -> main: astColumnsGiven, timed, memoised   hostLaneRoute.js
      otherwise                       -> worker: the job #1746 posts, its reply.ms learned
  any request with no hostPane (vendor harness, ratchets, headless, probes) -> astLaneColumns, unchanged
```

- **The route** (`hostLaneRoute.js`): per (document, timeframe) a few measured sizes; the prediction is the straight
  line through the two sizes around the request (a pass is a fixed cost plus a per-row cost), the smallest's cost
  below them, the line through the two largest above them (or cost per row with one sample: an over-estimate, the
  safe side). Not measured on this timeframe but on another: the dearest such prediction times 2. Not measured at
  all: the main thread over at most `FIRST_PAINT_MAX` (1,199) rows (a first paint, where it is then measured), the
  worker above. Main when predicted at most `LONG_TASK_MS` (50).
- **The memory**: module state (per tab), at most 128 documents (least recently measured forgotten first) and 4 sizes
  each, no storage of any kind (railed: the source names none, and a stubbed `localStorage` is never written).
- **The clock is ruled in for this route only** (coordinator, 2026-11-19): "no clock" governs what changes a value or
  a lane (`hostLaneCostOf(...).over` and #1711's cost route to the runtime lane are unchanged and deterministic);
  this picks only a thread.
- **Stale-while-revalidate, cancellation, failure**: #1746/#1756's, unchanged. A main-route answer is now also the
  pane's last picture (`STALE_PANES` 16 -> 32), so a deep history sent to the worker after a main-thread first paint
  keeps that first paint drawn, re-aligned on bar time, instead of blanking.
- **Render while computing** (railed, section 5, F): after a symbol or timeframe switch the pane signature differs, a
  pending answer holds no column, the binding is released: no series holds an old value, even where every old bar
  time is a new bar time (60m -> 30m).

## 5. Rails, each proven able to fail

`__tests__/hostLaneLearnedRoute.rail.test.js` (27) and `__tests__/hostLaneWorker.parity.test.js` (extended):

- **A. the route's memory**: constants derived from `LONG_TASK_MS` / `FIRST_PAINT_MAX`; the prediction rules; another
  timeframe doubled; one size kept at the dearer cost per row; bounded (128 documents, 4 sizes); never persisted.
- **B. the route through the door**: a first paint on the main thread, measured; a deep history not measured -> the
  worker; the worker's timing teaches the route; measured dear -> worker, measured cheap -> main, over the estimate ->
  worker; a throw is the same throw, computed once; no pane -> never the door; and **THE ROUTE NEVER CHANGES A
  VALUE**: five documents (cheap, three window-work, one over the estimate) asked 600 / 2,000 / 2,000 rows under a
  cheap clock (all main) and a dear clock (worker), byte-equal to the no-pane answer, with the routes shown to differ.
- **C. no stale picture**: section 3.
- **D. the repetition**: Fred RS in a binder, its run half never answering: 6 syncs, 6 asks, the values computed once.
- **E. Fred RS at 5m with its supply**: worker = memo = main = no-pane, byte for byte, runtime pane off and on.
- **F. a timeframe switch while computing**: 1D -> 60m and 60m -> 30m, no series holds an old value meanwhile; the
  landed values drawn.
- **Parity over the corpus** (`hostLaneWorker.parity.test.js`): for every committed host document on three bar sets,
  the main route's first answer and its memo hit equal `computeFor` with no pane (byte for byte, every record, frozen
  depth; a throw the same throw, computed once), beside the worker route (unchanged).

Mutants (scratch `mutants.py`: saved copy -> mutate -> run -> restore from the copy, sha256 checked; never `git
checkout`; a green control run first). **12 mutants, 12 red, 12 restored byte-equal:**

| mutant | red rail |
|---|---|
| M1 the key without the rows' revision | C (all six) |
| M2 the values memo never answers | D, B (the routes differ), parity (memo hit) |
| M3 the main route computes other rows | B (never changes a value), parity |
| M4 the worker route is posted other rows | B (never changes a value) |
| M5 always the main thread | A, B |
| M6 never the main thread | A, B |
| M7 the memory unbounded | A (bounded) |
| M8 the memory persisted | A (never persisted) |
| M9 the other timeframe's margin dropped | A |
| M10 the worker's timing not learned | B (the worker's timing teaches) |
| M11 the pane signature ignores the timeframe | F (60m -> 30m); it survived the first F (1D -> 60m, no shared bar time), which is why the second case exists |
| M12 a throw on the main route not remembered | B (a throw, computed once) |

## 6. Before and after, on the member's real path

Rig: `tools/pine_coverage/tf_switch_probe.py` (new). Two production builds with production's flags
(`VITE_PINE_MEMBER_PANE_ENABLED=1 VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1 VITE_PINE_RUNTIME_PANE_ENABLED=1
VITE_PINE_STRATEGY_BROKER_ENABLED=1`): **before** = `27add56b81`, **after** = this branch. ONE sandboxed backend
(`tools/local_backend_sandbox.py`, `PINE_RUNTIME_STAGE=all`: every member's runtime pane on, so Fred's run half runs,
as on production), `app/dist` a junction re-pointed between runs. Fred RS through the member door; the chart on 1D,
settled; then **a real click on the widget's `5m`**, recorded from the click until 8 quiet seconds after the deep
history. Bars answered at the network: RDDT daily (committed capture), 28,080 synthetic regular-session 5m rows (78
a session, America/New_York with DST), SPX 5m on the newest 105 sessions (so Fred's series is `na` before them, as
production's 19,864 of 28,006), SPX daily, the seed. **The depth is production's**: the trace drew 28,006 rows, the
whole-depth warm (`fullBarsFor('5')` = 30,000) that runs when the intraday smooth switch is off for the browser; the
probe sets that (`--depth full`). Long tasks: every main-thread task over 50 ms (PerformanceObserver). Attribution: a
V8 CPU profile of the main thread from the click, mapped by `profile_by_source.mjs` with each build's sourcemaps.

| run | long tasks | **worst task** | worst frame gap | `interpret.js` on main (ms) | worker values jobs |
|---|---|---|---|---|---|
| before, Fred, 1 | 6, 1,750 ms | **413 ms** | 400 ms | 871 | - |
| before, Fred, 2 | 7, 2,074 ms | **453 ms** | 450 ms | 972 | - |
| after, Fred, 1 | 6, 894 ms | **341 ms** ¹ | 367 ms | 0 | 600 rows 57 ms; 28,080 rows 516 ms |
| after, Fred, 2 | 5, 460 ms | **156 ms** | 183 ms | 39 | 600 rows 29 ms; 28,080 rows 313 ms |
| after, Fred, 3 | 6, 818 ms | **301 ms** ² | 333 ms | 18 | 600 rows 55 ms; 28,080 rows 493 ms |
| before, Fred, 3 | 6, 1,829 ms | **430 ms** | 433 ms | 908 | - |
| no script (before build), 1 | 2, 220 ms | 170 ms | 183 ms | - | - |
| no script (after build), 1 | 1, 147 ms | 147 ms | 150 ms | - | - |
| no script (before build), 2 | 3, 384 ms | 251 ms | 283 ms | - | - |
| no script (after build), 2 | 3, 372 ms | 241 ms | 250 ms | - | - |

¹ the click's own pass (the run half's Pine frontend and the chart, `pineRuntimeFrontend.js` 69 ms, `pine.js` 32 ms,
`interpret.js` 3 ms); another session's job held the box as that run started. ² the click's own pass again
(`pineRuntimeFrontend.js` 55 ms, `pine.js` 41 ms, `interpret.js` 4 ms).

What each long task was (profile windowed on the task):

- **before**: three or four tasks of **355-453 ms** after the deep history lands, each **146-240 ms of
  `interpret.js`**: Fred's values on the main thread, once per pass.
- **after**: **`interpret.js` is at most 4 ms in any long task.** What is left: the click's pass (156-341 ms; the run
  half's Pine frontend 42-106 ms, present before too: 74-84 ms), the deep history's arrival (149-238 ms:
  lightweight-charts and StockChart drawing 28,080 bars, the same pass the no-script control shows at 147-251 ms),
  and the values' landing (52-87 ms: lightweight-charts setting Fred's five series, `hostLaneAsync.js` 12-22 ms:
  the content revision and the realignment, `hostLaneWire.js` 6-8 ms: the answer unpacked).
- **The bar** ("no main-thread task from a script's values over 50 ms on the 5m switch"): **met**. The values of the
  28,080-row deep history are computed in the worker in every after run; the 600-row first paint went to the worker
  too (Fred's daily measurement, doubled for another timeframe, predicted it over 50 ms).

**The default depth** (`--depth window`: the smooth switch on, a 5m chart deepened by left windows; within the
probe's settle it stayed at its 600-row first paint): before 2 tasks, 453 ms, worst 340 ms (`interpret.js` 71 ms
over the switch); after 2 tasks, 294 ms, worst 232 ms (`interpret.js` 7 ms; the 600-row values in the worker, 51 ms).
Both worst tasks are the click's pass (the run half's Pine frontend 39-126 ms). The deep case is where the values
cost; this one shows the route costs a shallow chart nothing.

## 7. Consequences, stated

- **The first time a tab sees a document** it computes a first paint (<= 1,199 rows) on the main thread to measure
  it, as today. A window-heavy script's first paint can still cost one long task once per tab (for Fred, 25 ms at 600
  rows in node). A switch is covered: the document was measured on the timeframe it came from.
- **A slower machine routes more to the worker**: by design. A worker landing asks for one chart pass (#1746 section
  5); a document measured cheap stays on the main thread, so cheap scripts pay no extra pass and no pop-in.
- **The memo** lives as long as its bars array (a `WeakMap`); the content revision costs one pass over the rows per
  request (well under a millisecond at 28,080 rows; `hostLaneAsync.js` 35-47 ms in total over a whole switch).
- **Pictures**: 32 panes kept instead of 16 (each holds its bars array, which the chart holds anyway, and its columns).
- **Rollback**: revert the commit. No flag: values are unchanged and every failure path ends where #1746's did.

## 8. What is left on the main thread for a script like Fred (follow-ups, not this change)

- **The run half's Pine frontend** (`pineRuntimeFrontend.js` + `pine.js`): 42-106 ms in the click's pass, before
  and after alike (the run half's program prepared on the main thread for the new timeframe).
- **The landing's chart pass**: 52-87 ms per worker landing (lightweight-charts setting the series).
- **`strategyTaint.js`**: 21-24 ms in the pass after the click.

## 9. Engine number

`scriptEngineVersion.js`: a bump is owed for a change to what the translator WRITES for an unchanged script. This
changes which thread computes the values and that they are memoised, never what is computed (railed byte for byte
over the corpus, both routes, and a cheap and a dear clock). The vendor harness, the coverage ratchets, pine heavy's
legs and the headless export call `computeFor` with no chart pane and never reach the door. **No bump, no NUMBER
PENDING line.**

## 10. How it was measured

All on the dev PC, one heavy job at a time under `heavy_lock.py`; scratch output outside the repo.

```sh
# node: Fred RS's values at 600 / 5,000 / 11,534 / 28,800 rows, and the same request again (scratch vitest file)
# the rails, and the mutants (scratch mutants.py: saved copy -> mutate -> run -> restore -> sha256)
node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/hostLaneLearnedRoute.rail.test.js
HOST_LANE_COST_ONLY=donchian-channels,trend-duration-forecast-chartprime,atr-bands \
  node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/hostLaneWorker.parity.test.js
# browser: two production builds, ONE sandboxed backend, app/dist re-pointed between runs
VITE_PINE_MEMBER_PANE_ENABLED=1 VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1 VITE_PINE_RUNTIME_PANE_ENABLED=1 \
  VITE_PINE_STRATEGY_BROKER_ENABLED=1 npm run build          # at 27add56b81 (before) and this branch (after)
PINE_RUNTIME_STAGE=all PINE_RUNTIME_CAPABILITY_ADMISSION=on PINE_RUNTIME_SAVE_ENABLED=1 \
  python tools/local_backend_sandbox.py --port 8171 --email tfswitch@local.dev
python tools/pine_coverage/tf_switch_probe.py --base http://127.0.0.1:8171 \
  --script docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine --label after-fred-1 --out $O
python tools/pine_coverage/tf_switch_probe.py --base http://127.0.0.1:8171 --no-script --label after-control-1 --out $O
node tools/pine_coverage/profile_by_source.mjs $O/after-fred-1.switch.cpuprofile --dist <after dist> [--from ms --to ms]
```

**Production**: after this ships, patrick-54 reruns his production A/B (the same switch, smoke@, his rig).
