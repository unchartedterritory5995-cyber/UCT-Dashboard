NEXT STEP: none on this lane — READY (final-tip FULL + READY-CHECK PASS on 0c897466bc); landing by the coordinator. Engine bump: YES.

# W6-T6 `for … in` on the runtime lane — evidence

**Code tip: `2513b7e18c`** (branch `feat/pine-w6-t6-forin`, from origin/master `2f40ee68c5`;
master unmoved at final-tip, merge-base == origin/master). Later commits are docs only.
**Engine bump: YES** (a refusal becomes a served value on the runtime pane; `SCRIPT_ENGINE_VERSION` NOT edited here).

## What changed
- NEW `ast/forInRule.js` — THE walk rule, one table read by both lanes: `FOR_IN_SNAPSHOT_SOURCES` (`line/box/label.all`),
  `FOR_IN_LIVE_WITNESSED` (push / shift / set), `COLLECTION_MUTATORS`, `REASSIGN_OPS`, `bodyMayWriteList` (the host lane's
  scan, moved verbatim, its readers injected) and `forInMutationRefusal` (the host's sentence, byte-identical).
- `ast/pineObjects.js` — import only: the local copies are gone (C40/C48 behaviour unchanged: `objectForInLoops.test.js`
  and `vendorHarness.c48ForIn.test.js` untouched and green).
- `runtime/ir.js` / `runtime/lowerIr.js` — `forStmt({…, live: true})`, no new op: `to` is the list LENGTH, an exclusive
  bound re-read before every pass; counts up only (an empty list runs no pass); `continue` lands on the step. The IR of
  every other `for` is unchanged (`live` is absent unless set; validator: absent or true).
- `ast/pineRuntimeFrontend.js` — `lowerForIn`: `<list>` read once into a hidden slot (a user array = the reference, the
  LIVE walk; `<family>.all` = a SNAPSHOT), hidden pass counter, `i` / `x` declared per pass (`x` typed through
  `initialiserTy` → T3b `exprType`, the same answer as the member's own `x = array.get(list, i)`; no new per-slot flag).

Served (runtime pane): `for x in` / `for [i, x] in` over a named user array (numbers, text, records, drawings) and over
`line.all` / `box.all` / `label.all`; push / shift / set on the walked list (live); `break` / `continue`; a body-local
NEW array (`array.new*` / `from` / `copy`, never reassigned) changed by anything; a helper that only READS the element.
Refused BY NAME (`runtime:loop`, rows in `docs/pine/capture-queue-2026-11-06-w6-t6.md`): remove / pop / unshift /
insert / clear / reverse / sort / fill / concat / reassignment / a helper handed the list (G-rows, ungraded); a change
of a same-typed or untyped list that may alias the walked one; a write to or through the loop variable, or handing the
element to a function that writes a field (transitively); inside a function body; a loop whose value is read;
`polyline.all`; matrix / map (here refused at creation, `runtime:array`); a source that is not a name.
Doors: the C18 object door refuses BY NAME (`runtime:object-door`, `objectDoorRefuses`); the host object pass's lane
(`objectLane.js`, `objectIterTrees`) keeps master's exact refusal.

## Rails (red on master's engine sources, green on tip; log `runs/w6-t6/job1.log`)
- `__tests__/vendorHarness/vendorHarness.w6ForInRuntime.test.js` (5): the capture's own program
  (`vw-forin-collections-rddt-1d-2026-10-01`, source asserted equal to the committed probe) through the runtime lane:
  every row F01-F04, A01-A05, W01, Z01-Z03, C00 on every captured bar MATCH, and every object (24 lines, 3 boxes,
  5 labels; F05 y=59 moved, A06 "0" "1" "2"). Controls: read-once and live-`box.all` alternatives produce 5/3 and 2/2.
- `runtime/__tests__/w6ForIn.test.js` (17): served shapes, refusals by name with controls, the shared table and the host's
  identical sentence, both doors.
- `runtime/__tests__/objectDoorGate.test.js`: +3 shapes (`forin_sum`, `forin_live`, `forin_udt`; named=true).
- RED BEFORE (master's 4 engine files swapped in, restored byte-exact): 23 failed | 94 passed (117) across the 3 files.
- Targeted green (19 files incl. objectForInLoops, c40/c48ForIn, a4LoopRefusals, irDeferredFunction, irSymbolFold,
  lexerGaps, pineRuntimeTextLane, capabilityDemandCensus, objectFnInline, doorScorecard, p3Wsa*, loops, finiteWindow,
  runtimeAllowlistParity): 501 passed (`runs/w6-t6/job2.log`).

## Mutations (`docs/pine/parity-programme/scripts/mutate.py`; `runs/w6-t6/muts*.json`, logs job1.log / muts2.log / job2.log)
| mutation | killed by |
|---|---|
| M0 no-op control (comment) | SURVIVED (control) |
| M1 read the length once | w6ForInRuntime (F03/F04 rows) |
| M2 walk `<family>.all` live | w6ForIn snapshot + w6ForInRuntime A-rows |
| M3 admit `remove` in the shared table | w6ForIn G-rows + table rail |
| M4 FE skips the shared mutation rule | w6ForIn G-rows |
| M5 skip the object-door refusal | w6ForIn doors + objectDoorGate |
| M6 no alias guard | w6ForIn alias |
| M7 no loop-variable write guard | w6ForIn write |
| M8 / M8b / M8c handed-element guard off / refuse any helper / no transitive scan | w6ForIn write-through |
| M9 serve inside a function body / M10 serve a loop value / M11 serve on objectLane / M12 serve `polyline.all` | w6ForIn |
| M13 live test `<=` / M15 `continue` lands on the test | w6ForInRuntime / w6ForIn break-continue |
| M14 drop `set` from the shared table (host AND runtime) | w6ForInRuntime + objectForInLoops |
| M16 fresh local stays fresh after `:=` / M17 any call is a new array (`array.slice` is a view) / M18 no fresh exemption | w6ForIn fresh-local |
M12 first SURVIVED (a later generic refusal still named `polyline.all`); the rail now pins the W6-F1 sentence and M12 is KILLED.

## measure-pair (`runs/w6-t6/mp.sh`, lock `dsk/heavy-mp3.lock`, base `pine-dsk-mpbase3` switched in-job; HEAD asserted)
Final pair (round 2): `== side tip 2513b7e18c` / `== side base 2f40ee68c5` (tested-on-master `2f40ee68c5`).
Logs `runs/w6-t6/mp-all2.log`, `mp0.log`, `mp1.log`; compare `runs/w6-t6/mpcompare{0,1}.txt` (`runs/w6t3b/mpcompare.py`).
Round 1 (tip `cc905eddcb`) kept as `r1-*`.
- **C18 corpus audit 395 rows: 5 differ, guard name only, both lanes; 0 verdict diffs** (refused on both sides):
  `bigbeluga-smart-money-concepts`, `candelacharts-equal-highslows-eqheql`, `htf-candle-footprint-cartel-console`,
  `support-and-resistance-logistic-regression-flux-charts`, `curated/21-volume-profile-plus`:
  `runtime:loop` → `runtime:object-door` (the door's named refusal of `for … in`). INTENDED. Constructed probes 69: 0 diffs.
- **Harness** rt0 identical (93/103/140). rt1 tip 111/107/118 vs base 110/107/119: `vw-forin-collections-rddt-1d-2026-10-01`
  INCONCLUSIVE → MATCH (15 of 15 items, objects MATCH). INTENDED. Stage-1 `adx-and-di-for-v4` unchanged.
- **Census rt1 (967 rows): 17 differ.** INTENDED: the 16 `for … in` rows' first wall moves (refusal reason now named, or the
  next wall): gaps, price-target, seasonality, technical-ratings, trading-sessions, ai-supertrend-x-pivot, atr-god-strategy,
  candelacharts-eqheql, market-structure-break-order-block, smt-divergence-ict-killzones, s-r-logistic-regression,
  **trendline-pivots-quantvue ATTACHES** (peelSteps 2 → 0), cumulative-volume-delta-divergence, fvg-order-blocks-bigbeluga,
  momentum-terrain-3d-luxalgo, order-block-detector-luxalgo (refused: function body, W6-F1; not counted, per coordinator).
  NOISE: multi-timeframe-trend-indicator (`pine:timeout` wall-clock reason text), recorded by W4-T14 / W6-T3a/b.
- **Census rt0: 6 differ.** trendline-pivots-quantvue: only the `.runtime.attached` annotation (top-level attach unchanged,
  production lane). NOISE (timeout rows recorded by W34-D2 / W6-T3b): multi-timeframe-trend-indicator,
  volatility-coil-edge-bullbyte, halftrend-bigbeluga, luxy-momentum, mirage-liquidity-sweep (`pine:timeout` vs `pine:tuple`).
  Round 1 also showed ai-supertrend `stuck` noise (W34-D2 classified the same one-off).
0 unintended.

## final-tip — NOT COMPLETE (killed by the host's memory reaper, not a test failure)
Run 1 (`runs/w6-t6/ft.sh`, LOCK_FINAL2, FULL, 2 parallel shards, Node 20.20.2; logs `runs/w6-t6-final/`, `runs/w6-t6/ft.out`):
`TIP 2513b7e18c`; gate pytest rc=0 (46 passed); hygiene rc=0; rails pytest rc=0 (196 passed: engine-version gate,
saved-script prebump, runtime definitions, language coverage). The full vitest step started 09:54:46 and the job's
wrapper was stopped at ~10:24 by the session's low-memory reaper, so no FINAL_DONE was written. The two orphaned shard
processes (this lane's, created 09:54:46) were stopped so they would not run outside the lock; no other process
touched. Ready-check therefore not run. Re-run is the next step.

## Round 2 — review GO-WITH-NOTES (`dsk/reviews/W6-T6.md`): N1 fixed, origin/master merged
- N1: a list HELD by the loop element and changed in the walk (`array.push(q.arr, v)`, `q.arr.push(v)`, `array.clear(q.arr)`,
  or a helper handed `q` that does so) was served with no capture; now refused by name. One rule in `forInRule.js`
  (`heldListMutation`, `forInHeldListRefusal`), read by the FE body guard and by the helper scan (`forInFnWritesField`).
  Queue row Q-W6T6-H. Rail: `w6ForIn.test.js` "a write to the loop variable, or through it" (three shapes + the helper;
  control: READING `array.size(q.arr)` in the walk is served). Mutation (`runs/w6-t6/mutN1.py`, log `mutN1.log`,
  --maxWorkers=1): N0 no-op control SURVIVED; N1 drop the guard KILLED. `objectForInLoops.test.js` 55/55 (host unchanged).
- Merged origin/master `3e8dc3fae5` (W9-T1, dark, disjoint) with a normal merge commit: `9912d08b16`, clean.
  Targeted on the merged tree (--maxWorkers=1): w6ForIn + w6ForInRuntime + objectDoorGate 119/119.
- The round-1 measure-pair (base 2f40ee68c5) still classifies this lane's own diffs: N1 only adds a refusal on a shape no
  census row or capture reached as served (the 16 moved rows' walls are unchanged: none walks a field-held list).

## final-tip round 2 — COMPLETE (`runs/w6-t6/ft2.sh`, lock `dsk/heavy-final3.lock`, FULL, 2 parallel shards, Node 20.20.2; logs `runs/w6-t6-final2/`, `runs/w6-t6/ft2.out`)
`TIP 0c897466bc done` (last non-docs `9912d08b16`, merged origin/master `3e8dc3fae5`), `scope=full shards=2`,
`rc gate=0 hyg=0 py=0 js=1`, `totals=ok errors=0 integrity=ok`. jsfail: the 4 named baselines (`pollingSites.rail`,
`settingsScope.rail`, `enumerationSites`, `vendorHarness`) + `controlDoorCensus`, `usePreferences.additionsOnly`,
`vendorHarness.coverageAudit` (delta-rsi wall clock): the same seven red on master recorded by W6-T3b; none touches this lane.
`ready-check.sh pine-dsk-w6t6 runs/w6-t6-final2`: **READY-CHECK PASS** (HEAD 0c897466bc == origin, docs-only after TIP).
