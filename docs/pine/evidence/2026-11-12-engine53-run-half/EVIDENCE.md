# Engine 53 — the run half (host-partial drawings drawn by the per-bar run)

Plan: `ENGINE53-PLAN-2026-11-12.md` sections 1, 2 and 4 (Part 1 only; Part 2, capability
admission, is NOT in this PR). Base: `origin/master` `b89d075af8` (engine 51). Follows engine 52
(PR #1164, `fix/pine-engine52-serve-never-default`), which claims 52.

## What changed

A host-OK script whose object program lost drawings (`objectLoss` verdict `partial` or
`removes`) gets `compute.runtimeObjects = {source, outputs, ...runtimeVersionStamp}` on its
kind `ast` document (precedent: DIV-4 `compute.runtimeColours`). The plots stay the host's; the
host object program stays in `definition.objects` as the fallback.

| File | Change |
|---|---|
| `builder/memberPane/runRowPairing.js` (new) | `pairRunRows(t, runOutputs)`: THE row pairing (kind + ordinal, candles four to a group by role), extracted from `runtimeLaneDefinition` (mPD:1466-1511 at base) so both lanes share one function; returns `runOutputOf` (host output index -> run output index). |
| `builder/memberPane/memberPaneDefinition.js` | `runtimeLaneDefinition` calls `pairRunRows` (no behaviour change); new `hostPartialRunHalf` (minted after the host document is built, beside DIV-4); `routeHostPartial` option (default on); the drawing note gains `RUN_HALF_DRAWING_SENTENCE` when minted; result carries `runHalf: {minted, columns}` or `runHalfDeclined: {code, why}`. |
| `engine/nativeRegistry.js` | `withRunHalf` after `withRuntimeColours` on the `ast` path of `computeFor`; every gate on every run; the column rail; frozen synthetic runtime document per `runtimeObjects` (WeakMap); state rides non-enumerable; `computeSignature` carries the run half's gate state (latch / lists) into the binder's memo key; `withRuntimeColours` also honours the server's served stamps. |
| `engine/runtime/runtimeObjects.js` | `RUN_HALF_KEY`, `withRunHalfState`, `runHalfOf`, `carriesRunHalf` (module still imports nothing). |
| `engine/binder.js` | run branch also for a run half that is `served` or `pending` (pending -> empty layer); `refused` -> host branch with the refusal sentence in the drawing note's `why`; a host result whose run half is pending is never memoised. |
| `engine/ast/objectLoss.js` | `RUN_HALF_WHY_KEY`, `RUN_HALF_DRAWING_SENTENCE`, `runHalfRefusedSentence(code)` (plain words; no guard token). |
| `engine/defSchema.js` | `runtimeObjectsErrors` + `RUNTIME_OBJECTS_FIELDS` (closed), called from `validateDefinition`. |
| `api/services/presentation_schema.py` | `_check_runtime_objects` + `RUNTIME_OBJECTS_FIELDS`, rule for rule (code `runtime-objects`). |
| `tests/fixtures/runtime_objects_schema.json` | one fixture both sides read (21 cases, error PATHS). |
| `api/services/runtime_definitions.py` | `stamp_served` reaches an `ast` row with `runtimeObjects` / `runtimeColours` (kill / stage / allowlist); a stale stamp written back is dropped; `run_read_source`. |
| `engine/scriptEngineVersion.js` | 53 (history line notes it follows 52). |
| harness: `ourSide.js`, `objectsV2Regrade.measure.test.js`, `partialDrawing.census.measure.test.js`, `runHalf.reach.measure.test.js` (new) | record run half minted / declined / served / refused; objects graded from the run where the bind served it; regrade runtime-on mode (`PINE_OBJECTS_V2_RUNTIME_ON=1`) grading each minted capture before (killed) and after. |

### The door (`hostPartialRunHalf`) — minted only when ALL hold
runtime pane enabled (build flag + latch) and `routeHostPartial !== false`; verdict partial /
removes with `attemptedOps > 0`; no `calc_bars_count`; not killed; graded (allowlist);
`runtimeRepaintOf(source).ok`; `probeRuntimeProgram(source, {objectsInRun: true})` ok with
`objectOps > 0`, `requests === 0`, `naTests === 0`, no broker; `pairRunRows` ok and every
VISIBLE drawable host row pairs; the document (graph-reduced if needed) <= 64 KiB.
Otherwise the document is byte-identical and `runHalfDeclined` names the code. It never
creates a refusal.

### The bind (`withRunHalf`) — every run
build flag; latch; kill list (this tab's list and the served stamp `meta.runtimeKilled`);
allowlist (list and `meta.runtimeNotGraded`); the script's own `runtime.error`; inputs at
defaults (the DIV-4 rule: every declared input at its default and the manifest at its
defaults); the lane loaded; the run built and finished with its drawings `ok` (not `WITHHELD`,
not `OBJECT_UNWITNESSED`); no family withheld that the host program creates; and THE COLUMN
RAIL: for every mapped key, the run's column equals the host column on every bar from the
run's served start (`runtimeWarmupOf(...).withheldBars`, 0 from the listing): `na` with `na`,
a number to 1e-9 of its size. Served -> the run's drawings ride on the column record under
the RT5 key (non-enumerable) and the binder draws them INSTEAD of the host program. Pending
(worker in flight) -> empty object layer, not memoised. Refused -> host picture + sentence.
`ctx` absent (the event-column probe) asks nothing of the run.

Deliberate readings, stated:
- A run half that maps NO plot (a drawing-only partial script) is allowed: the rail is then
  vacuous and the gates (allowlist above all) are the guarantee, as for an RT5 runtime
  document's drawings.
- A visible host row the pairing cannot map (a kind with no run column) declines the run half
  (`run-half:row-unpaired`) rather than leaving a plot out of the rail.
- At-defaults counts every declared input (chrome included), as DIV-4 does: a member who
  restyles a plot keeps the host picture. Conservative; widening it is a later ruling.

## Measurement (plan section 4)

All runs on `242db4f0b7` (the branch head before evidence), under `heavy_lock` label `eng53`,
`--maxWorkers=1`. BEFORE = the same tree with `origin/master`'s `memberPaneDefinition.js`
swapped in (so no run half is ever minted), restored afterwards from the saved copy
(`git hash-object` = committed blob `7eb37a5f9d`). Summaries in `runs/`.

### (i) Reach — the member door over 679 scripts (266 committed corpus + 271 reference + 142 builtin)

`runHalf.reach.measure.test.js` (`runs/reach.json`). Host-OK scripts 299; host-partial
(verdict partial / removes) **58**.

| lane | minted | declined |
|---|---|---|
| off (runtime pane dark: every member without the stage) | **0** | `run-half:pane-off` 58 |
| real (pane on, the SERVER allowlist: adx-and-di-for-v4 only) — production for an admin | **0** | `runtime:not-yet-graded` 58 |
| every (test-only allow-every override: upper bound) | **7** | 51, by code below |

So with the real allowlist the slice is production-inert: 0 run halves minted, therefore 0
that draw; and every declined document is byte-identical to the door that never asks
(digest with the run half stripped == digest, for every non-minted row; the door tests
compare the JSON byte for byte).

Upper bound, the 7 minted, bound over a 600-bar synthetic series from the listing (proves the
gates and the rail run; never parity): **4 served** (atr-support-and-resistance,
auto-trendlines-by-pivots, fabio-style-order-flow, intraday-power-3-visual), **3 refused**
(`runtime:limit` 2: volume-profile, fourier-extrapolator; `interpret:bind-time-text` 1:
dual-view-htf-candlestick-patterns). Bind time with the run (synchronous, cold): p50 41 ms,
**p95 340 ms**, max 340 ms, against the pane's 1,000 ms budget (`RUNTIME_PANE_TIME_BUDGET_MS`).

Door decline codes, upper-bound lane (count): `pine:function` 7, `runtime:request` 7,
`runtime:conditional-history` 5, `runtime:request-with-state` 5, `runtime:history-dynamic-offset` 5,
`pine:request` 3, `runtime:statement` 2, `budget:lookback` 2, `pine:builtin` 2,
`runtime:call-text-state` 2, and 1 each: `runtime:call-windowed-state`, `runtime:object-op`,
`lower-tf:store-unmeasured`, `runtime:block-value`, `runtime:colour`, `runtime:input-state`,
`runtime:call-undeclared-builtin-state`, `lower-tf:lookahead`, `pine:colour-value`,
`runtime:function`, `runtime:history-expression` (the run cannot build the script with its
drawings: the objects-in-run probe's own guard).

partialDrawing census, runtime pane on + permit + allow-every (committed corpus, objects-only
flag off / on): minted 2 / 3, the rest declined by the same probe codes.

### (ii) Vendor harness, plot verdicts identical before and after

| lane | captures | before (M/D/I) | after (M/D/I) | plot-verdict diffs | capture diffs |
|---|---|---|---|---|---|
| production (`VENDOR_HARNESS_RUNTIME_ON=0`) | 369 | 154/48/167 | 154/48/167 | **0** | **0** |
| runtime-on (`=1`, upper bound) | 369 | 181/48/140 | 183/48/138 | **0** | 2: both atr-support-and-resistance captures (RDDT, SPY) INCONCLUSIVE -> **MATCH** on objects |

### (iii) Objects v1 / v2 regrade (`objectsV2Regrade`, new runtime-on mode)

| lane | v1 M/D/I | v2 M/D/I | MATCH->DIVERGE |
|---|---|---|---|
| production, before (master door) | 79/31/15 | **75/35/15** | — |
| production, after | 79/31/15 | **75/35/15** (row for row identical) | **0** |
| runtime-on, after (upper bound) | 96/31/13 | 92/35/13 | **0** (run half `movedToDiverge: []`) |

Runtime-on run-half ledger over the 152 captures with object records: door minted 6
(3 scripts x RDDT/SPY), declined 36 (the probe codes above). Bind: **served 2**
(atr-support-and-resistance RDDT and SPY: v1 and v2 INCONCLUSIVE before, **MATCH / MATCH**
after), refused 4 (`runtime:limit`: dual-view-htf both, volume-profile both; their verdicts
unchanged, the host picture stays). The six watched host-partial MATCH captures:
average-day-range (declined `runtime:request`), high-low-open-mid (not minted),
ict-killzones (declined `runtime:block-value`), vdubus (declined `runtime:colour`),
multi-tf-supply-demand and swing-zigzag-chartprime (no capture verdict moved): all unchanged.

### (iv) Perf
The run half adds one runtime-lane run per chart load for a minted document (in the worker,
off the main thread, memoised per bars array; coalesced per pane like any runtime document).
Measured cold and synchronous on 600 bars: p95 340 ms (above). Inert in production today.

## Mutants (copy -> edit -> focused tests -> restore FROM THE SAVED COPY -> hash-object == committed blob)

`runs/mutants.json`. C0 (no edit): GREEN, 29 tests. Every restore: blob equal.

| id | mutant | killed by |
|---|---|---|
| M1 | route a clean host (door ignores the verdict) | runHalf.test (clean CONTROL) |
| M2 | drop the door's kill check | runHalf.test (declined byte-identical, `runtime:killed`) |
| M3a / M3b | drop the bind's kill / graded check | runHalf.test (bind kill / allowlist, list and stamp) |
| M4 | draw host and run together (no `continue`) | runHalf.test (served set ONCE; latch revoke) |
| M5 | the column rail always agrees | runHalf.test (swapped outputs refused) |
| M6 | memoise a pending result | runHalf.test (pending then land, same bars) |
| M7 | a revoked latch keeps the run's objects | runHalf.test (bind latch) |
| M8 | moved inputs keep the run's objects | runHalf.test (member moved a setting) |
| M9 | mint with the pane disabled | runHalf.test (pane off) |
| M10 | mint past 64 KiB | runHalf.test (size) |
| M11 | route an output-map mismatch | runHalf.pairing.rail (one plot more on the run) |
| M12 | a run withholding a family the host draws is served | runHalf.test (family withheld) |
| M13 | pending draws the host picture then swaps | runHalf.test (pending layer EMPTY) |
| M14a / M14b | server loses the duplicate-index rule / client loses the undeclared-key rule | test_runtime_objects_schema_parity.py / runtimeObjectsSchemaParity.test.js |
| M15 | a guard id leaks into a sentence | runHalf.test (sentences; refused note text) |
| M16 | a second copy of the row pairing in the door | runHalf.pairing.rail |

All 18 KILLED.

<!-- RUNS -->
