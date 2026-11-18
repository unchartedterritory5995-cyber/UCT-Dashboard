# The compute caps, measured: none raised (evidence, 2026-11-17)

Branch `feat/engine-compute-caps-measured`, cut from master `0c36eb2465` (`SCRIPT_ENGINE_VERSION = 71`).
Unit brief: the 2026-11-17 coverage map (`COVERAGE-MAP-2026-11-17.md`, section 8, blocker 6,
`[compute-budget]`) found 9 scripts whose only blocker is a cap in `budget.js` (lookback 960,
distinct series 8, formula nodes 128). Rule a raise on MEASURED cost, then make it.

## 1. The ruling

**No cap is raised.** Each candidate (lookback 2,560, series 12, nodes 384) was measured on both lanes,
and each one admits work outside the budgets its own comment names:

- **The scripts a raise frees are expensive on the host lane, and four of them are served today by the
  runtime lane at a small fraction of that cost.** The member door asks the HOST lane first and offers the
  runtime lane only what the host lane refuses (`memberPaneDefinition.js`). A raise therefore does not only
  admit new scripts: it MOVES `check-head-and-shoulders` (16 ms on the runtime lane, 441 s on the host lane),
  `range-filter-buy-and-sell-5min` (6.7 ms, 18.4 s), `multi-timeframe-vwap-v5` (101 ms, 5.1 s) and
  `tradingviews-technical-analysis` (110 ms, 1.19 s, and every one of its host columns withheld
  `pine:block`) onto the slower lane, which runs on the member's main thread and recomputes on every live bar.
- **The lookback cap is the only bound on nested-recurrence work.** A Pine `var` gets a 250-bar warm-up
  (`pine.js::PINE_STATE_WARMUP`) and nested ones add up in the tree sum, so the lookback a script needs is
  how deep its recurrences nest. The three scripts that need 1,000 to 1,052 bars cost 18.4 s to 32.2 s per
  compute; the one that needs 2,547 costs 441 s. (The two that only wrap `vwap()`, 976 and 982 bars, cost
  33 and 110 ms: a session is a reach, not work. Section 7.)
- **Above 2,400 bars, a cap-deep recurrence no longer computes over the server's window.**
  `accum(close, max(self, close), w)` over 5,000 bars computes at w = 2,400 and refuses `interpret:steps` at
  2,500 and 2,560, in both lanes: `MAX_RECURRENCE_STEPS` (12,000,000) / `HISTORY_WINDOW_BARS` (5,000) = 2,400.
- **The node cap bounds how many recurrences one plot holds.** 31 cap-deep recurrences (128 nodes) cost
  4.3 s per compute in the browser and 21 s per symbol on the server; 95 (384 nodes) cost 13.1 s and over
  60 s.
- **The series cap's own budget is cheap, but what it frees is not.** Four more distinct series cost 2.6 ms
  (browser) and 1 ms per symbol (server); the scripts a series raise frees cost 0.66 s to 5.1 s on the host
  lane, and two of them are served today by the runtime lane in 18.5 and 101 ms.
- **And the two committed scripts a raise would newly serve grade DIVERGE against TradingView** at the
  candidates (`mtf-key-levels`, `volume-spikes`: their plots MATCH, their drawings and table do not), so the
  owner's 2026-11-17 rule would refuse them by name anyway (section 4).

What would let a cap move is in section 7. The caps, their twins and the agreement rail are unchanged;
the measurement is recorded beside each cap (`budget.js`, `ast_budget.py`) and railed
(`computeCapRuling.test.js`, `tests/test_ast_budget.py`).

## 2. The budgets each cap is checked against

Quoted from the comments beside the caps and the costs they name.

| cap | the budget its comment names | the number used here |
|---|---|---|
| `maxNodes` 128 | "far short of anything that blocks a frame at the 5,000-bar cap" (`budget.js`) | a long task (50 ms) on the main thread; the live recompute interval (about one second, `binder.js`: `updateChart` re-runs on every data poll and recomputes when the bars array changes) |
| `maxLookback` 960 | the warm-up a member reads as an empty pane (81% drawable at 960 on 5,000 bars); `MAX_RECURRENCE_STEPS`, "the Python lane's exposure does not move ... 5,000 x 960 = 4,800,000" (`interpret.js`, `ast_interpret.py`) | `5,000 x maxLookback <= 12,000,000`; the frame and recompute numbers above |
| `maxSeriesRefs` 8 | spec section 5: at most 60 series and 8 panes per chart; "eight base-series reads inside ONE definition is already the whole pane budget's worth of data" | columns fetched, held and walked |
| all, server side | `scan_evaluator.LIVE_DEFINITION_WORST_CASE_S` = 60 s for one definition over the 3,742-symbol universe (16 ms a symbol), measured for `close > sma(close, 50)` | seconds per symbol on the alert window |
| the runtime lane (for comparison) | `RUNTIME_PANE_TIME_BUDGET_MS` = 1,000 ms per run, in a worker | |

⚠️ **The frame budget does not hold at today's caps, so "inside the budget" cannot mean "inside a frame".**
Over the 90 committed scripts the member door installs on the host lane today (production flags, 5,000
daily bars), the median compute is 13.6 ms, 29 take over 50 ms, 17 over one second, and the worst,
`pivot-point-supertrend`, 25.8 s (then `pmax-explorer` 19.8 s, `supertrend-strategy` 15.9 s,
`supertrend-explorer` 14.8 s, `twin-range-filter` 14.1 s, `keltner-center-of-gravity-channel` 7.6 s at
exactly 128 nodes). The caps do not keep this lane inside a frame; they bound how much worse it can get.
The criterion applied is therefore: **a raise is safe only if the worst case it admits costs no more than
today's caps already admit, and it moves no script off the runtime lane onto a slower host compute.**
Every candidate fails it:

| cap | candidate | worst it admits vs the same shape at today's cap (browser / server per symbol) | moves off the runtime lane | verdict |
|---|---|---|---|---|
| `maxLookback` | 2,560 | freed scripts 18.4 s to 441 s (today's worst host document 25.8 s); a cap-deep recurrence refused over 5,000 bars above 2,400 | `check-head-and-shoulders` (16 ms -> 441 s), `range-filter-buy-and-sell-5min` (6.7 ms -> 18.4 s) | stays |
| `maxSeriesRefs` | 12 | 12 series 11.4 ms vs 8.8 ms / 23 vs 22 ms: inside | `multi-timeframe-vwap-v5` (101 ms -> 5.1 s), `vwap-fibo` (18.5 ms -> 1.5 s) | stays |
| `maxNodes` | 384 | cap-deep recurrences 13.1 s vs 4.3 s / 59 s vs 21 s | `tradingviews-technical-analysis` (110 ms -> 1.19 s) | stays |

## 3. Measurements

Newest 5,000 daily bars of `tests/fixtures/vendor/harness/vw-deadband-ticks-aapl-1d-2026-09-28.json`.
Browser: `interpret` / `computeFor`, node v24.13.1, median of three runs after one warm run (one run when
the first takes over 3 s), heap growth over one run with nothing collected during it (an upper bound).
Server: `ast_interpret.interpret`, Python 3.14.0, one process per case, on the alert window
(`indicator_alert_evaluator.bars_wanted(lookback)`, which is also the sweep's `want`) and on all 5,000
bars, with a wall-clock stop (">= N s (stopped)" is a lower bound, never a reading).

### 3.1 Lookback: 960 -> 2,560 (one construct per cost class the table holds)

| construct | browser ms at 960 / 2,400 / 2,560 | server s per symbol (alert window) at 960 / 2,400 / 2,560 | server s on 5,000 bars at 960 / 2,560 | verdict |
|---|---|---|---|---|
| `sma(close, w)` (rolling exact sum) | 2.6 / 1.7 / 1.0 | 0.025 / 0.040 / 0.043 | 0.10 / 0.15 | cheap |
| `highest(high, w)` (bars x window) | 7.1 / 25.5 / 27.5 | 0.043 / 0.084 / 0.090 | 0.26 / 0.41 | cheap |
| `stdev(close, w)` | 33.8 / 58.2 / 62.8 | 0.051 / 0.109 / 0.127 | 0.36 / 0.57 | over a long task at 2,400+ |
| `percentrank(close, w)` | 8.6 / 13.4 / 10.8 | 0.051 / 0.099 / 0.099 | 0.33 / 0.54 | cheap |
| `percentileLinearInterpolation(close, w, 50)` | 533 / 658 / 666 | 0.056 / - / 0.130 | - | over a long task at 960 already |
| `accum(close, max(self, close), w)` (bars x warm-up) | 161 / 228 / **refused `interpret:steps`** (2,500 too) | 0.51 / 1.26 / 1.42 | 5.13 / **refused** (8.52 at 2,400) | **over the ceiling above 2,400** |
| `close[w]` | 0.6 / 1.4 / 1.4 | 0.003 / 0.006 / 0.006 | 0.010 / 0.010 | cheap |
| `median(close, w)` (window squared, rank counting) | 6,623 / 26,761 / 34,530 | 28.2 / - / >= 90 (stopped) | - | outside at 960 already |
| `rci(close, w)` (window squared) | 6,653 / 26,095 / 21,852 | 60.2 / - / >= 90 (stopped) | - | outside at 960 already |

Heap growth is under 18 MB for every construct (36 MB for `percentileLinearInterpolation` at 960); server
peaks under 5 MB. The scripts the raise frees are the realistic worst case (section 4).

### 3.2 Series: 8 -> 12

| construct | browser ms | server s per symbol (window / 5,000) | verdict |
|---|---|---|---|
| `sma(x, 50)` summed over 8 distinct series | 8.8 | 0.022 / 0.108 | |
| ... over 12 (the prices, then clock columns) | 11.4 | 0.023 / 0.144 | the cap's own budget: cheap |

### 3.3 Nodes: 128 -> 384

| tree at the cap | browser ms (128 / 384) | heap growth MB (128 / 384) | server s per symbol, window (128 / 384) | server s on 5,000 bars (128 / 384) |
|---|---|---|---|---|
| pointwise arithmetic | 11.7 / 29.7 | 5.3 / 9.3 | 0.006 / 0.015 | 0.04 / 0.10 |
| distinct `sma` windows | 44.5 / 83.2 | 10.2 / 24.1 | 0.047 / 0.184 | 0.39 / 1.68 |
| distinct `highest` windows at 960 | 241.5 / 747.7 | 61.5 / 13.8 | 1.90 / 8.51 | 17.2 / >= 60 (stopped) |
| distinct recurrences, each warm-up 960 (31 / 95 of them) | **4,333 / 13,135** | - | **21.0 / 59.0** | >= 60 (stopped) / - |

Python's recursion: the interpreter recurses about two frames per tree level. A 384-deep chain (every node
kind tried: `u-`, `abs()`, `max(x, close)`, `x + close`, `?:`, `nz(x, 0)`, `x[0]`) evaluates with a recursion
limit of 780 (128-deep: 270) against the default 1,000: inside it, with about 210 frames left for the caller.

## 4. The nine scripts (and the two strategies beside them)

What each needs (the install door's own measurement), what frees it, and what it costs. Host lane: at the
candidate caps, the chart's binding (inputs at their defaults, the capture's symbol). Runtime lane: today.

| script | needs (nodes / lookback / series) | freed by | host lane, browser | runtime lane today, browser | server, alert window | committed captures |
|---|---|---|---|---|---|---|
| committed `chart-champions-part-1-npoc-levels-vwaps` | - / 961 / **16** | not by any candidate: 16 series | refused `budget:series` | declined (`budget:series`) | - | rddt, spy (INCONCLUSIVE: refused on our side) |
| committed `mtf-key-levels-support-and-resistance` | 54 / 960 / 10 | series >= 10 | 660 ms (3 drawing ops dropped: not clean) | declined (`pine:request`) | 0.95 s | rddt, spy (INCONCLUSIVE: refused on our side; **DIVERGE** at the candidates) |
| committed `volume-spikes-growing-volume-signals-with-alerts-scanner` | 31 / 1,000 / 5 | lookback >= 1,000 | **32.2 s** (8 table texts dropped: not clean) | declined (`pine:function`) | >= 90 s (stopped) | rddt, spy (INCONCLUSIVE: refused on our side; **DIVERGE** at the candidates) |
| reference `check-head-and-shouldersmask-man` | 158 / 2,547 / 4 | lookback >= 2,547 AND nodes >= 158 | **441.5 s** | **16.2 ms** (served) | >= 90 s (stopped) | none |
| reference `multi-timeframe-vwap-v5` | 63 / 504 / 11 | series >= 11 | **5,101 ms** | **101 ms** (served) | 6.97 s | none |
| reference `range-filter-buy-and-sell-5min` | 62 / 1,052 / 3 | lookback >= 1,052 | **18.4 s** | **6.7 ms** (served) | >= 60 s (stopped) | none |
| reference `tradingviews-technical-analysis` | 339 / 201 / 8 | nodes >= 339 | **1,190 ms**, 63 MB, every column withheld `pine:block` | **110 ms** (served) | 2.59 s | none |
| reference `ut-bot-linreg-candles-longevity-zones-sr-dashboard` | 111 / 1,000 / 7 | lookback >= 1,000 | **29.8 s** (10 drawing ops dropped: not clean) | declined (`budget:lookback`) | >= 60 s (stopped) | none |
| reference `vwapmvwapema-crossover` | 33 / 982 / 3 | lookback >= 982 | 110 ms | declined (`budget:lookback`) | 0.141 s | none |
| committed `rsi-vwap-indicator` (places orders) | 13 / 976 / 1 | lookback >= 976 | 32.8 ms | declined | 0.038 s | none |
| committed `vwap-fibo-dev-extensions-strategy` (places orders) | 58 / 503 / 10 | series >= 10 | 1,514 ms | **18.5 ms** | 2.32 s | none |

None of the nine has a MATCH capture. The three committed ones each have two committed captures that grade
INCONCLUSIVE ("refused on our side") on both lanes; no reference script has one. A TradingView capture session
would capture the rest; no cap moves, so no grade moves with this change.

**Graded at the candidates** (the six committed captures through the vendor harness, both lanes, caps patched
for the run and restored byte-equal): `chart-champions` stays INCONCLUSIVE (16 series); `mtf-key-levels` grades
**DIVERGE** on RDDT and SPY (W-, M- and Y-VWAP MATCH on every bar; D-VWAP's colour on the newest bar, vendor
transparent and ours blue; lines 23 vs 22 and labels 27 vs 26); `volume-spikes` grades **DIVERGE** on RDDT and SPY
(both spike markers MATCH on every bar; its table's 8 cells are 0 here, and its paints differ). So the two committed
scripts a raise frees would, under the owner's 2026-11-17 rule, go straight onto the host known-divergence list:
a raise would not have served them honestly either.

## 5. The census rows: what each lane would serve

`tools/pine_coverage/run_census.py`'s own loop (`run_census.drive`, cap 8) over the 11 scripts, judged by
`coverage_map.py`'s own predicates (`transfers_fully`, `runtime_on_transfers`, with the host known-divergence
list and the runtime kill list applied). Production runs the runtime pane armed, so the runtime-on lane is what
a member is served.

| | production lane transfers | runtime-on lane transfers | where they draw |
|---|---|---|---|
| today's caps (this branch) | 0 of 9 | 4 of 9 | `check-head-and-shoulders`, `multi-timeframe-vwap-v5`, `range-filter-buy-and-sell-5min`, `tradingviews-technical-analysis`, all on the RUNTIME lane |
| the candidates (384 / 2,560 / 12, measured, not committed) | 5 of 9 | 5 of 9 | the four above plus `vwapmvwapema-crossover`, all on the HOST lane |

At the candidates `mtf-key-levels`, `volume-spikes` and `ut-bot` attach on the host lane but do not transfer:
their next wall is drawing objects (3, 8 and 10 object ops dropped). `chart-champions` stops at 16 series.
So for a member the candidates buy one script (`vwapmvwapema-crossover`, 110 ms) and move four from the
runtime lane (6.7 to 110 ms) onto the host lane (1.19 s to 441 s). The coverage ratchet does not move: the
caps do not change and no committed script's verdict changes.

## 6. Exposures the measurement found at TODAY's caps (not changed here)

1. **17 of the 90 host documents the door installs today cost over a second per compute** (section 2), the
   worst 25.8 s, on the member's main thread, recomputed on each live bar. 15 of the 17 need 251 to 960 bars
   of lookback, the signature of Pine `var` state (a 250-bar warm-up each): the supertrend and trailing-stop
   family leads the list. Every one is a script members can paste today.
2. **`median` and `rci` are quadratic in their window** (rank counting, no sort): 6.6 s in the browser and
   28 s and 60 s per symbol on the server at a window of 960, which today's lookback cap admits.
3. **The sweep's per-definition worst case is already exceeded by one cap-deep recurrence**: 0.51 s per
   symbol, about 31 minutes over 3,742 symbols, against `LIVE_DEFINITION_WORST_CASE_S` = 60 s (measured on
   `close > sma(close, 50)`).

## 7. What would let a cap move

- **Route by cost, or make host recurrences incremental.** The runtime lane computes the same scripts in
  milliseconds; the host lane re-runs each bounded-window recurrence `bars x warm-up` times. While the door
  asks the host lane first, any cap raise moves runtime-served scripts onto it.
- **Charge a session-anchored reach apart from work.** `vwap()` declares one whole session (960 bars) and
  costs O(bars); it is what makes `crossOver(close, vwap())` (961) and `vwapmvwapema-crossover` (982) refuse.
  A reach that is not recurrence depth could be thresholded separately from the depth this cap bounds.
- **A work guard for the quadratic reducers** (`median`, `rci`) independent of the lookback cap.

## 8. How it was measured

All runs on the dev PC under `heavy_lock.py`, one at a time; scratch output outside the repo. The candidates
were measured by patching the two `DEFAULT_BUDGET` literals in the worktree and restoring them byte-equal from
saved copies (`cmp`); nothing patched is committed. The server tool takes the candidates as `--caps` and sets
them in its own child process.

```sh
# browser, candidate caps patched (from app/)
COMPUTE_CAP_COST_OUT=$O/js.json COMPUTE_CAP_SCRIPTS=<sample cache>/reference \
  node node_modules/vitest/vitest.mjs run src/components/chart/engine/ast/computeCapCost.measure.test.js --maxWorkers=1
# browser baseline at today's caps: every committed host document, and the freed scripts on the runtime lane
COMPUTE_CAP_MODE=baseline COMPUTE_CAP_COST_OUT=$O/base.json COMPUTE_CAP_SCRIPTS=<sample cache>/reference \
  node node_modules/vitest/vitest.mjs run src/components/chart/engine/ast/computeCapCost.measure.test.js --maxWorkers=1
# server, over the trees the browser run wrote
python tools/pine_coverage/compute_cap_cost.py --trees $O/js.json.trees.json --out $O/py.json \
  --caps 384,2560,12 --timeout 90
# census rows: run_census.drive over the 11 keys, one --cache per lane, judged by coverage_map's predicates
#   (transfers_fully / runtime_on_transfers, with order_usage_of, is_host_listed and runtime_killed_hashes)
# grades at the candidates: the six committed captures copied to $O/harness6, caps patched (from app/)
VENDOR_HARNESS_RUNTIME_ON=0 VENDOR_HARNESS_DIR=$O/harness6 VENDOR_HARNESS_OUT=$O/h6-0   node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=1
# (and VENDOR_HARNESS_RUNTIME_ON=1 into $O/h6-1)
# Python's recursion depth: a chain of each node kind at the node cap, evaluated under a lowered sys.setrecursionlimit
```
