# W9-T11 evidence: the record through the run

Branch `feat/pine-w9-t11-record`, built on origin/master `2e6ceff105` (engine 24; W9-T1 #890, T14a, W5-T1
and W5-T19 are all on it, so this lane is built on top of them). Light phase only: no mutate.py, no
measure-pair, no final-tip, no heavy lock. Node 20.20.2, vitest `--maxWorkers=1`.

Engine bump: NO. Translator output does not change. With the broker gate off (the default),
`probe.broker` is always false, so the member door stamps exactly what master stamps. Every runtime
change is reached only by a broker program or by a ctx that sets `historyWindowBars`, and no product
caller sets one yet.

## What changed
- NEW `engine/runtime/strategyRecord.js` (imports nothing). Holds:
  - the v1 record (design 3.2): `window{startTime, fromListing, bars, historyWindowBars, asOfBar}`,
    `settings`, `trades` keyed by bar TIME with entry/exit rule, `refusals`, `rulesUsed`;
  - `strategyRecordShapeErrors`, the one schema check, for T12, T13a and the T14 codec;
  - `RUNTIME_STRATEGY_KEY` (non-enumerable, beside the columns);
  - `STRATEGY_WINDOW_HISTORY`, the document stamp.
  Fields 3.2 names that no served rule produces are `null` and listed in `unserved`, each with its
  owning task: orders (T7), equity (T13a), the trade's exitId, profit, commission, runUp and drawdown,
  and the settings' commission, slippage, process_orders_on_close, bar_detalization and currency.
  The shape check refuses a value in any of them.
- `runtimeColumns.js`:
  - a document stamped `strategy-window` runs over the most recent `ctx.historyWindowBars` bars (one
    run, the caller's budget). A cut window runs with `historyFromListing: false`, so the VM's own
    [B-START] / Q-S1n decides. A run told no window goes to the VM, which refuses
    `runtime:strategy-start`, so that refusal keeps one author;
  - the window is handed to `execute`, and it is part of the memo key;
  - the record is attached after the run;
  - `probeRuntimeProgram` reports `broker`;
  - a stamped document with no broker program (gate off) refuses `pine:strategy-call`;
  - a broker over a sliding window (framed / calc_bars) refuses `runtime:strategy-start`.
- `runtimeWorker.js`:
  - registers the real broker flag reader. This fixes T1 review N1a: the worker's own module graph
    read the registry default, so it was off;
  - posts `strategy` beside the columns.
- `runtimeAsync.js` (the main-thread half of the worker boundary, outside the T11 list, which it
  cannot work without):
  - carries `ctx.historyWindowBars` in the message;
  - re-attaches the record.
- `memberPaneDefinition.js`, runtime path: a document whose probe holds a broker is stamped
  `strategy-window`. Every other document is stamped as before (`listing`, or nothing when routed).
- `limits.js`: unchanged. One budget means the windowed run is the only run, under the pane budget and
  DEFAULT_LIMITS. It adds no limit name, and a rail asserts that.

## Rails (new files: red on master, where `strategyRecord.js` does not exist; green on the tip)
`engine/runtime/__tests__/w9T11Record.test.js` (16) and `builder/memberPane/w9T11StrategyStamp.test.js` (3): 19/19 pass.
- Schema:
  - v1 record, non-enumerable, trades keyed by bar time, `window` exact;
  - forming bar gives `asOfBar` = newest confirmed;
  - the shape check refuses unserved values, a window with bars > historyWindowBars, and v0.
- Window from the context:
  - no window: `runtime:strategy-start`;
  - two ctx values give two records;
  - a cut window gives Q-S1n, not "holds 30";
  - the memo key carries the window;
  - one budget (pane time budget stops it; no broker limit name);
  - RAIL: no line naming the window in any chart/ product source holds a 3+ digit number or an
    `||`/`??` numeric default. The regexes are self-checked.
  - A framed instance refuses `runtime:strategy-start`.
- Worker boundary:
  - the posted message carries the window;
  - the REAL worker module refuses with the env unset and serves the record with env '1' (registration
    proved);
  - the main thread re-attaches the record unchanged.
- Gate off:
  - the probe has no broker;
  - a stamped strategy refuses `pine:strategy-call`, including an orders-only one whose plots read no
    broker value;
  - an indicator's columns are identical with or without a window, and it has no record;
  - the member door: flag off, the strategy is not drawn; an indicator keeps `listing` with the flag
    on or off.
- Pins: tests mock `brokerPins.js::pinned` in-file. No product code takes a pin set, and T1's
  `brokerPinned` grep rail is green.

## Checks
- Targeted: `npx vitest run <the 2 files> --maxWorkers=1`: 2 files, 19 passed.
- Folder: `npx vitest run src/components/chart/engine/runtime src/components/chart/builder/memberPane --maxWorkers=1`
  at tip-tree (base 2e6ceff105 + this diff, before the last 2 rails were added):
  Test Files 4 failed | 201 passed | 2 skipped (207); Tests 5 failed | 3255 passed | 2 skipped.
  - The 5 failures are all `*.measure.test.js` timeouts at testTimeout 15 s. Each walks the whole
    committed corpus, about 24 s on this box: guardProbe, objectLaneCallSites, objectLaneCensus (2)
    and objectLaneDrawerCensus.
  - BASELINE: the same 4 files with the 4 changed product files replaced by `origin/master` copies
    (restored by copy, cmp OK) gave the same 5 failures.
  - serverBundle.rail, hostNeutralClosure.rail, pineRuntimeFrontendGate, s1StrategyBroker, w9T1Broker,
    objectDoorGate, strategyBrokerGate.product and runtimeWorkerWarmup are all green in the folder run.
- Hand mutations: copy, mutate, run the rail file, restore by copy, filecmp; tree unchanged after.
  Control (a comment edit) SURVIVED. All 21 below KILLED:

| mutation | file | killed by |
|---|---|---|
| vm-not-told-window | runtimeColumns | schema/window tests (7) |
| drop-record-attach | runtimeColumns | schema (6) |
| no-slice | runtimeColumns | cut-window test |
| cut-keeps-listing | runtimeColumns | cut-window test |
| window-not-in-memo-key | runtimeColumns | memo test |
| drop-gate-off-stamp-guard | runtimeColumns | orders-only gate-off test |
| drop-slides-guard | runtimeColumns | framed test |
| probe-broker-false | runtimeColumns | probe test |
| literal-window-default (`\|\| 5000`) | runtimeColumns | literal rail |
| strategy-skips-window | runtimeColumns | cut-window test |
| worker-no-gate-register | runtimeWorker | real-worker test |
| worker-drops-record | runtimeWorker | real-worker test |
| main-drops-record | runtimeAsync | re-attach test |
| message-drops-window | runtimeAsync | message test |
| door-stamps-listing | memberPaneDefinition | stamp test |
| door-stamps-always | memberPaneDefinition | indicator stamp test |
| asof-ignores-forming | strategyRecord | forming test |
| shape-skips-unserved | strategyRecord | shape test |
| shape-skips-window-bound | strategyRecord | shape test |
| record-trade-time-index | strategyRecord | schema test |
| record-window-from-literal (`5000`) | strategyRecord | window tests (5) |

  Not observable today: slicing the FIRST window bars instead of the most recent. Every cut window has
  `fromListing` false and is refused at Q-S1n before bar 0. It becomes observable when the Q-S1n
  ruling serves a non-listing window (design 3.4); a rail is owed then.

## Open items
1. No product caller sets `ctx.historyWindowBars` (T1 N1b, still open), so every chart broker run
   refuses `runtime:strategy-start` by name.
   - The value must reach the chart's run context from the server (`bars_window.HISTORY_WINDOW_BARS`),
     through StockChart / nativeRegistry. Those are chart-lane files, outside T11.
   - The runtime path and the worker now carry it end to end.
2. `runtimeAsync.js` is touched (the main-thread half of the worker boundary). The coordinator should
   check this against other lanes.
3. T1 N1c (`objectLane.js` objectDoor) and N2 (`-unsettled` in RUNTIME_REFUSALS) are not T11's and
   are untouched.
4. A strategy document that owns drawings goes through the window path without the RT5 drawings
   withheld-fallback, so a drawing failure stops the run by name instead of withholding. This is the
   conservative choice, and the broker is dark.

Logs: `$UCT_RESUME/runs/w9-t11/` (folder.log, measure-master.log, handmut.log, handmut.json).

## Heavy steps (coordinator GO after review GO-WITH-NOTES @600b735e2b)
### mutate.py (heavy-mut.lock, free when taken; 7.1 min)
`mutate.py muts.json w9T11Record.test.js w9T11StrategyStamp.test.js` at tip 600b735e2b (`muts.json` in this dir is the
same 22 rows as `handmut.py`). Result: control SURVIVED; all 21 others KILLED. Tree clean afterwards apart from muts.json.
Log: runs/w9-t11/mut.log.

### measure-pair (heavy-mp3.lock, ram_gate; 1.6 h)
Tip 600b735e2b vs base pine-dsk-mpbase3 detached at merge-base 2e6ceff105 (asserted before and after each side;
HEAD unmoved). Logs: runs/w9-t11/mpr/mp-all.log, mp0/, mp1/.
- runtime 0: C18 out 395 rows, 0 differ; probe 69 rows, 0 differ; harness identical (93/103/140 on both sides).
  Census 967 rows, 4 differ, all classified LOAD NOISE (the 10 s wall-clock `pine:timeout`, landing on a different
  step or line):
  - multi-timeframe-trend-indicator (peelSteps 3 vs 2; pine:timeout count 7 vs 5);
  - volatility-coil-edge-bullbyte (`pine:state` vs `pine:timeout` on one drop head);
  - halftrend-longshort-signal-engine (both refusals are `pine:timeout`, at line 83 vs 12);
  - mirage-liquidity-sweep-pro (`pine:timeout` vs `pine:undefined` on one drop head).
- runtime 1: C18 0 differ; probe 0 differ; harness identical (112/107/117 on both sides).
  Census 1 differ, multi-timeframe-trend-indicator, LOAD NOISE: steps[2] holds 3 vs 2 refusals, all `pine:timeout`.
- 0 unintended diffs. That is expected: with the gate off no broker program exists, so the census, C18 and harness
  paths are unchanged.

### Merge origin/master (engine 26, 82e87cb40b) -> b5f4e0041d, clean
Rails after the merge (`--maxWorkers=1`): w9T11Record, w9T11StrategyStamp, w9T1Broker, s1StrategyBroker,
serverBundle.rail, hostNeutralClosure.rail, runtimeWorkerWarmup, objectDoorGate: 8 files, 309/309 passed
(runs/w9-t11/postmerge.log). Engine bump: still NO. final-tip is left to the coordinator.

## r1 (landing HELD: HP-7 red at f82c6c669f), path (a)
Cause: `runtimeAsync.js::messageOf` forwards `ctx.historyWindowBars`, and the service adapter (`job.mjs::runArgs`) did
not. `services/pine_runtime/test/adapter.test.mjs` (`node --test`, never run by vitest) flagged the key drift.
Fix (a): the service reads the window from the same source the browser does, its ctx, and never from a literal.
- `protocol.mjs`: the wire `ctx` takes an optional `historyWindowBars`, refused unless it is a positive safe integer.
  A job without it parses exactly as before.
- `job.mjs::runArgs` forwards `job.ctx.historyWindowBars` with the same conditional shape as `messageOf`. With it,
  HP-7's key lists agree, and HP-7 now asserts that both hosts read the window from their ctx.
- `cache.mjs::canonicalCtx` appends `window=<n>` only when the job states one. Every existing result key is unchanged,
  and two windows can never share a cached answer.
- The Python client (`pine_runtime_client.py`) is NOT changed. It sends no window yet, so a service broker run refuses
  `runtime:strategy-start` by name, as a browser run with no window does. Sending
  `bars_window.HISTORY_WINDOW_BARS` is T14's (design T14: "the window is bars_window.HISTORY_WINDOW_BARS, imported").
- Rails: protocol (optional; positive integer; absent when unsent), job (forwards only when stated), cache (key
  unchanged without a window; two windows give two keys), and the HP-7 assertions.
- Hand mutations (`svcmut.py`; copy, mutate, `node --test`, restore by copy, filecmp; tree unchanged): control
  SURVIVED. All 7 KILLED: job-drops-window, job-literal-window, protocol-closes-window, protocol-accepts-zero,
  protocol-always-carries, cache-ignores-window, cache-always-window. Log: runs/w9-t11/svcmut.log.
- Merged origin/master 7304620153 (engine 29), clean, giving 021ad96038. After the merge:
  - `node --test services/pine_runtime/test/*.test.mjs` (Node 24.13.1): 128/128 pass (runs/w9-t11/svc-r1.log).
    Pre-merge it was also 128/128.
  - `node tools/pine_runtime_host_parity.mjs --host node --check` (Node 24.13.1): HP-1 GREEN, 166/166 equal the
    committed digests, no digest change.
  - vitest engine/runtime + builder/memberPane (Node 20, `--maxWorkers=1`): 205 files pass, 5 tests fail, 2 skipped,
    3559 tests passed. The 5 failures are the same `*.measure` corpus timeouts as the baseline above. The T11 rails
    are green inside that run (runs/w9-t11/folder-r1.log).
- Engine bump: still NO. Translator output and HP-1 digests are unchanged, and the wire change is optional.
