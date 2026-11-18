# The host worker's follow-ups: a superseded running job, the window-work estimate, production (evidence, 2026-11-18)

Branch `feat/host-lane-worker-followups`, cut from master at `3a44393c21` (PR #1746, the host lane's worker).
Follows `docs/pine/evidence/2026-11-17-host-lane-worker/EVIDENCE.md` (its sections 4 and 8 named the first two
tasks) and reuses its browser rig (`tools/pine_coverage/host_lane_browser_probe.py`) and its corpus measurement.

## 1. Answer first

- **A. A running job its pane superseded now stops, by terminating its worker** (a cooperative checkpoint has no
  channel: the page is not cross-origin isolated, so there is no `SharedArrayBuffer` for the evaluator to poll;
  measured). A stop costs a fresh worker, 0.08-0.21 s off the main thread. **The pane's first picture is the
  exception**: stopping the 600-bar first paint when the deep history arrives (0.1-0.8 s into it, measured) would
  blank the pane until the deep job lands, so that worker is retired instead: it finishes the first paint, which is
  drawn, while the deep job starts at once on a second worker. Same probe as #1746, bracketed:
  **pivot-point-supertrend's final values land 5.2-6.9 s sooner (12.1-13.7 s against 18.9-19.0 s from the 600-bar
  tail; 14.5-15.9 s absolute against 20.8 s+), first values unchanged (5.4 s against 5.3-6.3 s);
  supertrend-strategy's final values 0.6-0.8 s sooner, first values unchanged.** The stop-everything variant was
  built and measured too: it pushes first values back by 2.5-13.6 s for no better final values. Values unchanged (the
  worker chunk is byte-identical; the parity rail green), a stopped job never paints, no worker state outlives its
  worker; 8 mutants, 8 red.
- **B. The window-work estimate was measured before it was written, and it does not hold; the estimate is not
  changed.** Window functions × window length explains almost none of the 8 documents' cost: calibrated the
  estimate's own way it moves **0 of 8**, and no single rate moves all 8 without also moving 11 documents under
  50 ms. What does predict it is the evaluator's own count of the nodes it evaluates (masks re-interpreting
  subtrees: 2,635 and 3,859 for the two over a second, against 199 and 97 distinct nodes in their trees), which
  moves the two dearest and no cheap one, but cannot be read off the trees and costs 87-181 ms to read by a dry run
  of exactly those two. The option left (learn the count from the first paint the chart computes anyway) is a
  change of the estimate's contract and is the coordinator's call. The 61 cheap-stays-main documents re-checked:
  unchanged.
- **C. Production serves `3a44393c21` (#1746) and the member path holds: pivot-point-supertrend's longest
  main-thread task 208 ms on load and 92 ms on the poll, worst frame gap 317 / 167 ms** (12-17 s before #1746),
  measured 2026-11-18 03:27-03:33Z as the synthetic admin, signed in through `synthetic_session.py` and signed out,
  the account left exactly as found.
- **Engine number: none** (section 5).

## 2. Task A: a running job its pane superseded

### 2.1 What the timeline said before any code

The #1746 evidence's own probe output (`after2-pivot`, `after2-strategy`, the production build of #1746 on a
sandboxed backend) holds every job's post and landing time. For pivot-point-supertrend the 600-bar first paint
was posted at 3.19 s and took the worker 5.6 s (cold); the deep history (11,533 bars) was asked for at **3.57 s,
0.4 s into that job**, and waited behind it. For supertrend-strategy the 600-bar job was posted at 2.12 s and ran
1.6 s; the deep history was asked for at 2.55 s, again 0.4 s in.

So the job the deep history waits behind is the pane's **first picture**: on a first load nothing else is drawn
until it lands (the pane's loading state), and it holds the newest 600 bars, which is the range a chart opens on.
Stopping it would bring the deep values forward by the rest of that job and push the first values back to the deep
job's landing (pivot: from ~9 s to the deep job's ~13 s or more; strategy: from ~4 s to ~12 s). Both were built
and measured (section 2.4) rather than argued.

### 2.2 The design as built (`hostLaneAsync.js`)

- **A newer request of a pane stops that pane's running job** (`submit` -> `supersedeRunning`): its worker is
  terminated at once, the job forgotten (its memo entry deleted: never answered, never painted, and its bars asked
  again are a new job), and the newer job is posted to a fresh worker straight away. A symbol or timeframe switch,
  a settings change, and a poll over a poll all take this path.
- **Why terminate, not a checkpoint.** A worker computing a job runs one synchronous task; a message posted to it
  (a "cancel") is not read until that task ends. A cooperative stop needs a flag the evaluator can read mid-run
  without the event loop, which in a browser is a `SharedArrayBuffer` (`Atomics.load` from the interpreter's step
  counter). Such a buffer exists only on a cross-origin-isolated page (`COOP: same-origin` + `COEP: require-corp`).
  Measured: production answers `/charts` with neither header, and the probe reads `crossOriginIsolated === false`
  and `typeof SharedArrayBuffer === 'undefined'` on the page (section 4 and the sandbox runs). Turning isolation on
  would make every third-party embed on the site carry CORP/CORS headers, a site-wide change far outside this one.
  So the only stop available is `Worker.terminate()`; what it costs is measured below (a fresh worker's start,
  the document sent again, a cold interpreter).
- **The one exception: the pane's first picture** (`paintsWhileNewerComputes`). When the running job's answer is
  what the pane would draw while the newer one computes (the same document, settings, symbol and timeframe, and
  nothing of them drawn yet), it is not thrown away: its worker is **retired** (`retireRunning`). It finishes that
  one job beside the fresh worker, its answer lands and is drawn (re-aligned on bar time, exactly as a poll's last
  picture is), and it is terminated. At most one worker is retiring; a running job that would need a second is
  stopped instead. A retiring worker that crashes, sends an unreadable message or outruns the watchdog is
  terminated and its job forgotten (the newer job draws); it is not counted as a lost worker.
- **A late answer is dropped** (`settleLanded`, `_landedSeq`): every job carries the order it was asked in; an
  answer whose pane already drew a NEWER job's answer is never settled and never drawn (only a retiring worker can
  answer that late). A picture is only ever replaced by a newer one.
- **A cancel is not a failure.** `HOST_WORKER_MAX_STARTS` (3) now counts workers LOST (a crash, an unreadable
  message, the watchdog), not workers started: a member flicking through symbols must never retire the tab to the
  main thread.
- **No worker state outlives its worker**: a terminated worker's doors are closed before `terminate()` (no late
  message reaches the queue), and the documents it held go with it (`workerOf` starts every worker holding none,
  so the first job is posted with its document).
- **Values unchanged**: nothing the worker computes changed (`hostLaneWorker-*.js` is byte-identical in the three
  builds: the same chunk hash), only which jobs it is asked to finish.

### 2.3 Cooperative or terminate: measured

- **Cooperative: not available on this page.** Every run below (and production, section 4) read
  `crossOriginIsolated === false` and `typeof SharedArrayBuffer === 'undefined'`. With no shared memory a running
  worker cannot learn of a cancel until its job ends, which is the very thing a cancel exists to avoid.
- **Terminate and respawn: what it costs.** A fresh worker's start (the cached chunk loaded and compiled, the
  document posted again) is the difference between a job's post-to-landing time and the worker's own compute time
  for the first job on a new worker: **0.08 to 0.21 s** in the four `after` runs (pivot 0.19 s and 0.17 s; strategy
  0.21 s and 0.08 s), against 0.00 s for the warm worker in `base`. The cold interpreter did not show: the deep job's
  compute on a fresh worker was 10.7-13.3 s against 12.0-13.7 s on the warm one (the box's own noise, ±3 s between
  runs of the same build, is larger than any difference). What a stop saves is the rest of the superseded job:
  up to 4.3-4.9 s for pivot-point-supertrend's first paint.

### 2.4 Before and after, on the same probe

The #1746 rig: production builds with production's flags, one sandboxed backend (`PINE_RUNTIME_STAGE=off`, the
member view: both scripts are host documents), the AAPL daily capture answered at the network (a 600-bar first
paint, then 11,534 bars from the listing), `--wait-final` (section 6). Three builds, the backend's `app/dist`
re-pointed between runs: **base** = `3a44393c21` (#1746 as merged), **after** = this branch, **p1** = this branch
with the retire branch disabled (every superseded running job stopped, the first paint included). Two rounds, each
script bracketed base / after / p1, on the dev PC under `heavy_lock` (2026-11-18 03:03-03:14Z). "First values" is
when the script's legend chip first showed a number; "final values" when the deep history's values job landed (the
page's own `host-lane:worker-run` timeline). The box was busy (other sessions' jobs): page start times varied by up
to 10 s between runs (base-pivot-1's bars were first asked for at 11.6 s, after-pivot-1's at 2.2 s), so each time
is also given from the moment the 600-bar tail arrived.

| run | first values (s) | final values (s) | from the 600-bar tail: first / final (s) | the deep job posted at (s) | longest task / worst frame gap (ms) |
|---|---|---|---|---|---|
| base, pivot-point-supertrend, 1 | 17.9 | 30.6 | 6.3 / **19.0** | 17.77 (when the first paint landed) | 336 / 499 |
| **after**, pivot-point-supertrend, 1 | 7.5 | 15.9 | 5.4 / **13.7** | 3.38 (worker 2, beside it) | 315 / 317 |
| p1, pivot-point-supertrend, 1 | 21.5 | 21.4 | **13.7** / 13.6 | 9.26 (first paint stopped) | 351 / 400 |
| base, pivot-point-supertrend, 2 | 7.3 | 20.8 | 5.3 / **18.9** | 7.14 | 344 / 533 |
| **after**, pivot-point-supertrend, 2 | 7.9 | 14.5 | 5.4 / **12.1** | 3.69 | 304 / 317 |
| p1, pivot-point-supertrend, 2 | 10.5 | 10.3 | **8.8** / 8.6 | 2.76 | 169 / 200 |
| base, supertrend-strategy, 1 | 5.5 | 17.7 | 3.3 / **15.4** | 5.34 | 1,145 / 1,150 ¹ |
| **after**, supertrend-strategy, 1 | 5.5 | 16.8 | 3.4 / **14.6** | 3.29 | 1,123 / 1,117 ¹ |
| p1, supertrend-strategy, 1 | 17.5 | 16.5 | **15.5** / 14.5 | 3.13 | 985 / 1,000 ¹ |
| base, supertrend-strategy, 2 | 3.1 | 10.9 | 1.9 / **9.8** | 2.95 | 624 / 617 ¹ |
| **after**, supertrend-strategy, 2 | 3.5 | 10.8 | 2.0 / **9.2** | 2.62 | 747 / 750 ¹ |
| p1, supertrend-strategy, 2 | 14.9 | 14.0 | **13.2** / 12.3 | 2.79 | 910 / 917 ¹ |

¹ lightweight-charts setting the strategy's series when its values land (#1746 section 4): drawing, not compute.

What the numbers say:

- **pivot-point-supertrend: final values 5.2-6.9 s sooner, first values unchanged.** From the tail: final 18.9-19.0 s
  (base) -> 12.1-13.7 s (after); first 5.3-6.3 s -> 5.4 s. In absolute time the deep values land at 14.5-15.9 s
  against 20.8-30.6 s, and against #1746's 21.2-24.0 s and the pre-worker main thread's 19.4-20.5 s. The deep job is
  posted 0.7 s after the first paint's (as soon as the history arrives) instead of when it lands.
- **supertrend-strategy: final values 0.6-0.8 s sooner, first values unchanged** (its first paint computes in only
  1.3-2.4 s, and the deep history arrives 0.7 s into it, so there is little to win; first values 3.3 / 1.9 s ->
  3.4 / 2.0 s from the tail).
- **Stopping the first paint (p1) is the wrong trade, as section 2.1 predicted**: first values move from 5.3-6.3 s
  to 8.8-13.7 s for pivot and from 1.9-3.3 s to 13.2-15.5 s for strategy (from the tail), for final values no
  better than retiring gives (pivot 8.6-13.6 s, strategy 12.3-14.5 s, within the box's noise of `after`). The member
  would stare at an empty pane for 13-15 s on a script that today shows its values in 2-3 s.
- **The main thread is untouched**: the longest task and worst frame gap are the same in all three builds
  (pivot 0.17-0.35 s; strategy's 0.6-1.1 s is the renderer). Both workers computing at once (the retired first
  paint and the deep job, about 4 s of overlap for pivot) is on other threads.
- **A symbol or timeframe switch, a settings change, a poll over a poll** now start the newer job at once instead
  of after up to a whole deep compute (12-14 s for these two scripts); railed in section 2.5 rather than browser-
  measured here.

### 2.5 The rails, each proven able to fail

`__tests__/hostLaneWorker.rail.test.js`, section 3 (rewritten for running jobs) and new section 3b, on the
stand-in workers (the worker's own handler over structured clones of the exact messages; `answerFrom(i)` added so a
rail can choose which worker answers first). Each mutant applied to `hostLaneAsync.js` from a saved copy, the rail
file run, the file restored from the copy and checked byte-equal (sha256), never `git checkout`; a control run of
the unmutated rails, green, first (scratch harness `mutants_a.py`).

| rail | what it holds | mutant -> red |
|---|---|---|
| a symbol switch stops the old symbol's RUNNING job | its worker terminated at once, the new symbol on a fresh worker, the stopped job never answered; asked again, a new job | MA1 no running job is superseded (today's behaviour) -> at least 4 red (the harness prints four). MA4 a stopped job not forgotten -> red. MA7 a stop counted as a lost worker -> 2 red |
| the first picture is never thrown away | the first paint's worker retired (not terminated), the deep job at once on a second worker; the first paint lands and is drawn re-aligned on bar time; its worker then terminated; the deep job lands equal to today's | MA2 always stop, never retire -> 2 red. MA6 the retired worker outlives its job -> 2 red |
| a symbol switch during the first load | the old symbol's first job is stopped, not retired (it would never be drawn) | MA3 retire whatever the signature -> red |
| a late older answer is dropped | the deep job lands first, the retired first paint after: dropped; a poll's stale picture is the deep one | MA5 a late answer taken -> red |
| a poll over a poll | each superseded poll's worker stopped, the pane keeps its last picture; 4 stops in a row never retire the tab to the main thread | MA7 (above) |
| no worker state outlives its worker | the fresh worker is handed the document in its first message | MA8 a fresh worker believed to hold the stopped one's documents -> 3 red (it first survived as "the cancel does not clear the documents": `workerOf` clears them for every new worker, so that copy was a second guard and was removed; the rail now pins the one) |
| the existing rails | the waiting-job rail now holds the worker with another pane's job (a pane's own second request now stops, not queues); the 18 others unchanged and green | - |

**8 mutants, 8 red, 8 restored byte-equal.** Remote run on GitHub runners (`tools/remote_tests.py`, head
`44437b4b5e`, run `44227171963`): the parity rail over the corpus (unchanged: one job per pane, so no stop; still
byte-equal), the rails, `hostLaneCost.test.js`, `binder.test.js`, the C45 harness rail and the guard-id drift rail:
**green**.

### 2.6 Consequences, stated

- **Up to two host workers at once, briefly**: the retired first paint and the newer job (pivot: about 4 s of
  overlap on a first load). Never more: a second retirement is a stop. On a two-core machine the two compete with
  each other, not with the main thread.
- **A stop costs a fresh worker** (0.08-0.21 s measured, off the main thread) and the documents that worker held are
  sent again (one structured clone each, #1746 section 5: under 2 ms).
- **`HOST_WORKER_MAX_STARTS` now counts lost workers**, not started ones; a tab still retires to the main thread
  after three crashes, unreadable messages or watchdog stops, and never because a member changed symbols.
- **A retiring worker that fails is not a failure of the pane**: its job is forgotten and the newer job draws; it
  is not counted as lost (the newer job's worker is the one whose health matters).
- **Rollback**: revert the commit. No flag: values are unchanged and every path ends where #1746's did.

## 3. Task B: window work in the ONE estimate

**Asked:** extend the ONE estimate (`hostLaneCost.js::hostLaneCostOf`) to count window work (window functions ×
window length × bars), calibrated against measured ms, so that the 8 host documents under the recurrence budget
that cost a long task or more (#1746 evidence section 8) route to the worker, and re-check that the cheap ones stay.

**Answer: measured, and the model does not hold. The estimate is NOT changed.** Window length explains almost none
of what these documents cost; calibrated by the estimate's own rule it moves none of the 8, and no single rate moves
all 8 without also moving cheap documents. What does predict their cost is the evaluator's own count of the nodes it
evaluates, and that count cannot be read off the trees (section 3.3).

### 3.1 The census

`hostLaneWorker.measure.test.js`, new opt-in block (`HOST_WORKER_WINDOW_OUT`), every committed script through the
member door with the runtime pane off, the 61 host documents under the recurrence budget, the AAPL daily capture,
node 24 on the dev PC under `heavy_lock` (2026-11-18 03:03Z), values timed as #1746 timed them (`astLaneColumns`,
5,000 bars, median of three after a warm run). Two window counts read off each specialised document, each distinct
unit once (the memo): the evaluator's own window table (`FINITE_WINDOW`: sma, wma, stdev, sum, dev, median,
highest, lowest, highestbars, lowestbars) and every call with a lookback that is not carried state. Beside them, the
evaluator's OWN count of what it evaluates (`interpret.js::evalNode`'s counter, `opts.workSink`, read through a
sink that only counts), at 64, 600 and 5,000 bars.

| script (**the 8**) | ms, 5,000 bars | window steps a bar (table / every) | nodes evaluated (64 / 600 / 5,000 bars) | recurrence steps a bar |
|---|---|---|---|---|
| **reverse-stochastic-momentum-index-on-chart** | 1,271.9 | 26 / 26 | 2,635 / 2,635 / 2,635 | 0 |
| **smart-money-volume-index-algoalpha** | 1,004.2 | 550 / 550 | 3,859 / 3,859 / 3,859 | 0 |
| **institutional-smc-order-flow-matrix-pro** | 334.4 | 0 / 40 | 71 / 70 / 70 | 500 |
| **implied-volatility-suite** | 141.0 | 820 / 820 | 435 / 435 / 435 | 0 |
| **donchian-channels** | 104.4 | 200 / 200 | 244 / 244 / 244 | 0 |
| **madrid-moving-average-ribbon** | 98.3 | 955 / 955 | 576 / 576 / 576 | 0 |
| **support-and-resistance-multi-time-frame** | 88.0 | 68 / 68 | 84 / 84 / 84 | 0 |
| **momentum-volatility-scanner** | 61.7 | 111 / 111 | 226 / 226 / 226 | 0 |
| atr-trailing-stoploss | 51.3 ¹ | 10 / 10 | 220 / 220 / 220 | 0 |
| atr-support-and-resistance | 44.9 | 600 / 600 | 283 / 283 / 283 | 0 |
| macd-shortlong-strategy-for-tradingview-input-optimizer | 42.1 | 81 / 81 | 140 / 140 / 140 | 0 |
| candlestick-patterns-identified-update-1-17-26 | 38.6 | 10 / 10 | 274 / 274 / 274 | 0 |
| smart-money-interest-index-algoalpha | 37.4 | 525 / 525 | 216 / 216 / 216 | 0 |
| cdc-btc-rainbow-road | 17.9 | 730 / 730 | 90 / 90 / 90 | 0 |
| … 47 more, all under 34 ms | | | | |

¹ 37.1 ms in #1746's run of the same measurement: the line between "a long task" and not runs through the noise
for this one; every other document keeps its side of 50 ms in both runs.

### 3.2 The window count, calibrated the estimate's way

The recurrence estimate is calibrated at the CHEAPEST measured step (a document moves only when even at that rate
its recurrences alone would make a long task; the largest honest budget). The same rule for window steps:

| count | cheapest measured window step | budget (5,000 bars, a long task) | moves of the 8 | cheap moved |
|---|---|---|---|---|
| `FINITE_WINDOW` lookbacks | 4.90 ns (cdc-btc-rainbow-road: `sma(close, 730)`) | 2,039 steps a bar | **0** | 0 |
| every non-carried lookback | 3.80 ns (extrapolated-pivot-connector) | 2,632 steps a bar | **0** | 0 |

And no rate can rescue it. The two dearest documents read 26 and 550 window steps a bar while cdc-btc-rainbow-road
reads 730 and costs 17.9 ms (an `sma` over finite closes is a running sum: one step a bar, whatever its length) and
atr-support-and-resistance reads 600 and costs 44.9 ms. institutional-smc reads 0 table steps (its 334 ms is its
recurrence, 500 steps a bar: under the recurrence budget at the cheapest step, measured at 134 ns a step); support-
and-resistance-multi-time-frame's 88 ms is its weekly resample. To move all 8 by the second count the budget must
fall under 26 steps a bar, which also moves **11 documents that cost under 50 ms**; by the first it cannot be done
at all. Per document the rate the window count implies runs from 4.9 ns to 9.8 µs a step: three orders of
magnitude. Calibrated, the brief's model moves nothing; tuned to move the 8, it moves cheap documents and still
misattributes three of the 8.

### 3.3 What does predict it, and why it is not wired here

The profiles (an in-process V8 CPU profile of one warm run per document, a scratch measurement: `node:inspector`
inside vitest, not committed) put the two dear documents' time in the evaluator itself, not in any window
(reverse-stochastic: `interpretOnce` and its column ops 2.2 s of a 2.6 s profiled run; smart-money-volume-index:
the generic rolling sum over a source with gaps, `windowOperands` / `windowSum` / `rolling`, re-run by every
re-evaluation): reverse-stochastic evaluates 2,635 nodes over its run where its trees hold 199
distinct ones, smart-money-volume-index 3,859 against 97. The withheld-bar masks (`withheldReadMask`:
`windowHoleMask`, `historyReadMask`, `boolNaMask`, …) re-interpret subtrees with fresh memos, per plot tree, so the
work a document does is its evaluated nodes times its bars, plus its window scans. The evaluator's own counter
measures exactly that, and it is **bar-count independent** (the same count at 64, 600 and 5,000 bars for 60 of 61
documents; institutional-smc 71 / 70 / 70). Calibrated the same way (the cheapest measured node-bar, 11.4 ns,
liquidation-levels): a budget of 877 nodes a bar moves **2 of the 8 (the two over a second) and no cheap document**;
the others' counts (70 to 576) overlap the cheap ones (up to 283), so even this count does not move all 8.

It is not wired, for three measured reasons:
- **It cannot be read off the trees.** The static unit count (`evaluationUnits`, what `budget:nodes` thresholds) is
  199 and 97 for the two; the multiplier is the masks' re-interpretation, and restating which subtrees each mask
  re-interprets in the estimate would be a second authority over what the evaluator evaluates.
- **Reading it by running the document costs what it measures**: a 64-bar dry run takes a median 1.0 ms, but
  181 ms for smart-money-volume-index and 87 ms for reverse-stochastic, exactly the two it would move.
- **`.over` has a second reader.** #1711's cost route (`memberPaneDefinition.js::routeByCost`) offers every document
  over the estimate to the runtime lane for a runtime-on viewer; #1711 measured window work as no cheaper there
  (smart-money-volume-index 1,234 ms on the runtime lane, past that lane's own 1,000 ms run budget). Any extension
  must be a second answer of the estimate for the worker route only, not `.over`.

The option that survives the measurement is to LEARN the count from a compute the chart already makes (the first
paint runs on the main thread anyway; the evaluator's counter is free to read there) and route the later, larger
computes (the deep history, every poll) by it. It changes the estimate's contract from "read off the trees" to
"read off the first run", so it is the coordinator's call, not taken here.

**The cheap-stays-main decision, re-checked**: unchanged. All 61 documents under the recurrence budget still compute
on the main thread; 52 of the other 53 cost under 50 ms at 5,000 bars (atr-trailing-stoploss read 51.3 ms in this
run and 37.1 ms in #1746's), the median is #1746's 6 ms, and the 8 that cost more are named above with what each
one's cost actually is. At a member's real deep history (11,534 bars,
from the listing) the 8 cost 28 ms (institutional-smc) to 628 ms (smart-money-volume-index); reverse-stochastic
drops to 117 ms there (the listing pass skips the left-edge window mask).

## 4. Task C: production

**#1746 is live, and on production pivot-point-supertrend's longest main-thread task is 208 ms on load and 92 ms on
the poll (12-17 s before #1746).**

| | |
|---|---|
| production commit | `3a44393c210e18ebbd255c4a364992c599244e83` from `/api/health` at the start and the end (uptime 2,718 s -> 3,078 s: no deploy during the run); `git merge-base --is-ancestor 3a44393c21 3a44393c21...` -> **true** |
| when | 2026-11-18 03:27:43Z - 03:33:43Z |
| account | `smoke@uctintelligence.internal` (admin), signed in through `tools/synthetic_session.py`'s Playwright form (`sign_in_playwright`) and signed out at the end (`/api/auth/me` then refused the session); never the owner's Chrome |
| lane | the saved document is a host document (`ast`, 12 plots); the host worker answered it: the 600-bar first paint (2.4 s in the worker), the deep history (11,534 bars, 7.4 s) and the poll (5.7 s), each a `host-lane:worker-run` entry. (`pine_runtime_pane_enabled` is true for this admin; #1711's cost route did not move this script.) |
| bars | answered at the network in the probe's own browser from the committed AAPL capture, as in #1746's rig (the account's chart symbol was AGL; nothing reached a vendor) |

| on production | long tasks | **longest task** | **worst frame gap** | first values | final values |
|---|---|---|---|---|---|
| load | 9, 839 ms in all | **208 ms** | **317 ms** | 4.6 s | 11.7 s |
| the chart's own next poll (waited 285 s) | 1, 92 ms | **92 ms** | **167 ms** | (stale picture kept) | landed 5.7 s after the poll |

Against #1746's sandbox numbers for the same script: load 0.33 / 0.34 s and poll 0.25 / 0.19 s after (12.0 /
11.9 s and 16.7 / 12.5 s before). Production is under the ~350 ms expected on both. The production page also reads
`crossOriginIsolated === false` (section 2.3).

**What the run wrote, and what it left.** The probe changes nothing the product would not write on its own except
the script it needs: through the member door's UI it saved one definition and the attach wrote the chart layout
(`charts_workspace_layout`); the workspace already held two chart widgets, so none was added. At the end it deleted
that definition (`DELETE /api/user-definitions/u_6ade457608b3`) and wrote the layout preference back to its exact
earlier value through the product's own preference write (naming the workspace document's version, as the app
does). Read back before signing out: **0 saved scripts (0 before), the same 13 preference keys with byte-equal
values.** The workspace document's own version history keeps the two versions that write and its undo made, as it
would for a member who added and removed a script. The same path (`--synthetic loopback-test`) was rehearsed on a
sandbox account that already held a script and a layout first, and left both as found; production was run only
after the rehearsal said so.

## 5. Engine number

`scriptEngineVersion.js`: a bump is owed "in the SAME commit as any engine change that alters what the translator
WRITES for an unchanged script". Task A changes which jobs the host worker finishes, not a value (the worker chunk
is byte-identical, the parity rail is unchanged and green); Task B changes no code the engine runs (the estimate is
unchanged; one opt-in measurement block was added to a measurement test). **No bump, no NUMBER PENDING line.**

## 6. How it was measured

All on the dev PC, one heavy job at a time under `heavy_lock.py`; scratch output outside the repo.

```sh
# three production builds with production's flags, from this worktree, each moved out of app/dist:
#   base = 3a44393c21 (#1746), after = this branch, p1 = this branch with the retire branch disabled
#   (built from an edited copy of hostLaneAsync.js, restored from a saved copy, sha256 byte-equal after)
VITE_PINE_MEMBER_PANE_ENABLED=1 VITE_PINE_OBJECTS_ONLY_PANE_ENABLED=1 VITE_PINE_RUNTIME_PANE_ENABLED=1 \
  VITE_PINE_STRATEGY_BROKER_ENABLED=1 npm run build
# ONE sandboxed backend; app/dist a junction re-pointed at base / after / p1 before each run
PINE_RUNTIME_STAGE=off PINE_RUNTIME_CAPABILITY_ADMISSION=on PINE_RUNTIME_SAVE_ENABLED=1 \
  python tools/local_backend_sandbox.py --port 8161 --email <sandbox>
python tools/pine_coverage/host_lane_browser_probe.py --base http://127.0.0.1:8161 \
  --script corpus/committed/<file>.pine --label <variant>-<script>-<round> --out $O --wait-final
# the window census (section 3)
HOST_WORKER_WINDOW_OUT=$O/window.json node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/hostLaneWorker.measure.test.js --maxWorkers=1 --testTimeout=7200000
# production (section 4): rehearsed first on a sandbox through the same path (--synthetic loopback-test)
python tools/pine_coverage/host_lane_browser_probe.py --base https://uctintelligence.com --synthetic smoke \
  --script corpus/committed/pivot-point-supertrend__HN4w1eNW3B.pine --label prod-pivot --out $O --poll --wait-final
```

The probe gained three things here: `--wait-final` (settle only once the deep history's values job has landed, so
"final values" is the landing of the 11,534-bar job on the page's own timeline, not a guess), the page's isolation
facts (`crossOriginIsolated`, `typeof SharedArrayBuffer`), and `--synthetic` (section 4).

**And one red on master, fixed here.** `tests/test_synthetic_session_signout.py` (every tool's sign-in goes through
`synthetic_session.py` or is a named local-sandbox exemption) was red on `3a44393c21`: the probe POSTs
`/api/auth/login` for its sandbox account and was not on the exemption list. It is now, with the reason held by
code: the plain sign-in (with its sign-up and its clean slate of saved scripts) runs only on a loopback base, and
any other base is refused before a browser starts unless `--synthetic`. New rail
`tests/test_host_lane_probe_refuses_production.py` (production, the Railway origin and a LAN address refused;
control: loopback and `--synthetic` get past it, to a stubbed browser): 2 mutants (the refusal removed; the
refusal for every base) both red, restored byte-equal; without the exemption entry the sign-out rail is red.
