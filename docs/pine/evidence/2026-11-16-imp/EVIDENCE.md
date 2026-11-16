# imp: loops and imperative statements on the runtime lane (coverage unit, 2026-11-16)

Branch `feat/pine-coverage-imperative` (PR #1469), off `origin/master` @ `e9807547d0`, master merged twice
(engine 62 at the second merge). Engine number NOT bumped; one `NUMBER PENDING` history line in
`scriptEngineVersion.js` (the landing train numbers it). The runtime lane stays dark; nothing is armed.

## What changed
- `ast/forInRule.js`: `FOR_IN_LIVE_WITNESSED_RUNTIME` (push, shift, set, remove, pop, unshift, insert,
  clear); `bodyMayWriteList` takes two options the runtime lane passes and the host lane does not:
  `reassignKeepsWalk` (G06) and `followHelpers` (G07: a helper handed the list itself counts only by what it
  does to the parameter it fills, under the same rule, at any depth). `forInMutationRefusal(src, allowed)`
  names the lane's own set (the host lane's sentence is unchanged: default argument);
  `forInHelperHeldRefusal` is G07's sentence while it is held.
- `ast/pineRuntimeFrontend.js::lowerForIn`: the runtime set and G06; the function-body refusal is gone (a walk
  in a function body lowers to the same counted `for` this lane already runs in a function body); handing the
  element to a function that writes its FIELDS is served (`forInFnWritesField` with `fieldWritesServed`; a
  function that changes a list the element HOLDS still refuses, by the same sentence); G07 behind the gate
  `FOR_IN_HELPER_SERVED = false` (test-only `opts.forInHelpersServed`).
- `foldBracketParamTypes`: a parameter typed `type[]` reads as `array<type>` in a function header.
- `forInElemHoldsList` types a field by its written word (`tyOfTypeWord`): a drawing field no longer reads as
  "a type this lane cannot tell" in the value build, where every record holding a drawing read as holding a
  list.
- The host object lane (`pineObjects.js`) is untouched.

## Witnesses
- The Pine v6 reference, `for...in`, Remarks: "Scripts can modify the sizes of arrays and matrices while
  iterating over their contents with a `for...in` loop." The User Manual, Loops, `for…in`: "Scripts can
  modify the sizes of arrays and matrices directly within a for…in loop's local scope." and, when the loop
  changes the collection's size, "the loop's header uses the updated size to control subsequent iterations".
- The committed capture `vw-forin-collections-2-rddt-1d-2026-10-02` (NYSE:RDDT 1D from the listing): G01
  remove 3, G02 pop 3, G03 unshift 7, G04 insert 7, G05 clear 1, G06 reassignment 5, G07 helper 3 passes.
  Graded on no lane before this branch. `vendorHarness.impForInGRows.test.js` runs the capture's own program
  through the runtime lane: every G-row and the control on every captured bar MATCH (G07 under the test-only
  option); the copy model (5/3/3/5/5 for G02-G05, G07) and the re-read-the-name model (G06: 1) are written out
  and differ; without the option the build refuses `for l in hs` by G07's sentence. In the corpus harness the
  probe stays INCONCLUSIVE (the product refuses G07).
- A `for … in` inside a function body: the reference's own `for...in` examples walk a parameter list inside a
  user function (`numGreaterThan(array<float> id, float value)`, `elementWiseAdd`).
- A field written through an element handed to a function: a record is a reference (`runtime/records.js`).
- `type[]` = `array<type>`: the User Manual, Arrays: a variable whose declaration includes `int[]` as the type
  keyword "accepts the type `array<int>`"; the capture's own helper `f_shift(line[] a)` compiled on TradingView.

## Held: G07 (Q-IMP-H)
Served, G07 frees `market-structure-break-order-block`, whose committed capture
(`market-structure-break-order-block-rddt-1d-2026-11-14`) then DIVERGEs on the runtime-on lane (measured on
this branch at `33cbb5dba4` with G07 served): lines 71 vs 53, labels 25 vs 7, boxes 3 vs 3. The 46 zigzag lines
agree; the 18 extra lines and labels are "MSB" events. The script reads `ta.change(market)` before
`market := …` on the same bar, and the runtime lane lowers `ta.change(name)` as `name - name[1]`
(`pineRuntimeFrontend.js`, the `changeTarget` branch: the previous bar's FINAL value). Engine-gap row Q-IMP-H,
probe `vw-imp-change-before-reassign.pine` (D01 the change read before `x :=`, E01 `x - x[1]` at the same place).
The host lane refuses that script earlier (`pine:collection`). Not fixed here: it is a call-site-history
question (the history unit's #1450 owns call-site kernels); the coordinator routes it.

## Still refused by name (queue rows)
- `reverse` / `sort` / `fill` / `concat` of the walked list: Q-IMP-R, probe `vw-imp-forin-reorder.pine`.
- A write to the loop variable (a Pine compile error: the reference, `for...in`, "The loop cannot modify this
  variable using reassignment or compound assignment operators") or directly through it (`x.f := …`): W6-F1,
  probe `vw-w6-forin-write-through.pine` (written 2026-11-07, not captured).
- A change of a list the element holds; the value of a `for … in`; `polyline.all`; matrix and map walks:
  W6-F1 / Q-W6T6-H rows, unchanged.
- The v6 unmatched `bool` block (`runtime:block-value`, builtin Volatility stop and five more): gate
  `V6_BOOL_UNMATCHED_CAPTURED` kept shut (coordinator ruling). Probes: `vw-wsa-v6-bool-unmatched.pine` (Q-A3,
  chart now NYSE:RDDT 1D) and the tuple half `vw-wsa-v6-bool-unmatched-tuple.pine` (Q-IMP-A3T).

## Routing measured, not built (coordinator ruling)
Scratch counterfactual door (never committed): a host document whose object program lost drawings, routed whole
to the runtime lane when that lane builds it with its own drawings and withholds nothing. Of the 25 unit scripts
that attach on the host lane with a partial program, 3 route (atr-support-and-resistance,
dual-view-htf-candlestick-patterns-theultimator5, fabio-style-order-flow); the other 22 do not build on the
runtime lane (first refusal: history-dynamic-offset 5, request-with-state 3, call-text-state 3,
expression-statement 3, request 2, pine:function 2, one each of call-windowed-state, block-value,
conditional-history, statement, budget:lookback, pine:request, pine:builtin). 2 of the 3 already mint the
engine-53 run half. The routed harness run hung and was stopped (PID 7772, mine), so those 3 are not graded.

## Coverage (the census's own runtime-on predicate)
Before = the engine-60 census rows of 2026-11-16 (`cov-e60/rt`); after = `coverageMapDoorCensus.measure.test.js`
over a subset on this branch at `178ed80d75` (one lock hold, 143 rows: the 76 unit scripts, 41 controls that
transfer and carry a loop or a block value, 26 other scripts with a `for … in`).
**Newly transfer: 0** (unit 0 → 0, other `for … in` scripts 0 → 0); **controls 41 → 41, none lost.** Production
lane: the host lane is unchanged. With G07 served, market-structure-break-order-block transferred (+1) and its
capture DIVERGEd, so it is held (above).
`for … in` walls, before → after, on the 13 sample scripts that carried one:

| script | `for … in` walls | first wall before → after | what remains |
|---|---|---|---|
| builtin:trading-sessions | 1 → 0 | `runtime:loop` → `runtime:statement` (session clock) | another unit's wall |
| committed:support-and-resistance-logistic-regression-flux-charts | 3 → 0 | `runtime:loop` → `runtime:function` (L192) | another unit's wall |
| builtin:price-target | 1 → 0 | `pine:builtin` → `pine:builtin` | `syminfo.target_price_date` |
| builtin:gaps | 2 → 1 | `runtime:loop` → `runtime:loop` | handed element changes a HELD list (W6-F1) |
| committed:ict-institutional-order-flow-fadi | 1 → 1 | `pine:builtin` | handed element changes a held list (W6-F1) |
| committed:market-structure-break-order-block | 4 → 4 | `runtime:function-global-state` | G07 held (Q-IMP-H) |
| committed:candelacharts-equal-highslows-eqheql | 2 → 2 | `runtime:loop` | `store.ehl_ln`'s type not told (a `line[]` FIELD) |
| reference:order-block-detector-luxalgo | 1 → 1 | `runtime:loop` | untyped parameter list |
| committed:ai-supertrend-x-pivot-percentile-strategy-presenttrading | 1 → 1 | `pine:request` | untyped list |
| reference:cumulative-volume-delta-divergence | 1 → 1 | `runtime:request-with-state` | untyped list |
| builtin:seasonality | 1 → 1 | `runtime:request` | a matrix's type not told |
| reference:fvg-order-blocks-bigbeluga | 2 → 2 | `pine:function` | not an array |
| reference:momentum-terrain-3d-luxalgo | 1 → 1 | `runtime:loop` | `polyline.all` (W6-F1) |

## Mutants (one lock hold, tree `178ed80d75`, rails `w6ForIn.test.js` + `vendorHarness.impForInGRows.test.js`, 31 tests)
Each: copy aside, mutate, run both rails, restore from the copy, `git hash-object` equals HEAD's blob (all OK).
M1 drop `remove` from the runtime set KILLED (7 red) · M2 `reassignKeepsWalk` off KILLED (4) · M3 `followHelpers`
off KILLED (4) · M4 any argument followed into a helper KILLED (1) · M5 a helper's body not read KILLED (1) · M6 the
function-body refusal back KILLED (1) · M7 field writes refused KILLED (2) · M8 the walk re-reads the list's NAME
KILLED (3) · M9 the `type[]` fold off KILLED (4) · M10 a drawing field typed by `writtenTyOf` KILLED (1) · M11 the
G07 gate open KILLED (2). 11 of 11.

## Harness (pine-heavy, run 43948529377, head 178ed80d75)
Both lanes: 4 verdicts differ from the committed snapshots, all master's (one fixture removed,
`supertrend-kivancozbilgic-rddt-1d-2026-10-02`; three new `syminfo-mincontract-*` INCONCLUSIVE). No capture
moves from this branch: no MATCH → DIVERGE, no new DIVERGE. Coverage ratchet over corpus/committed: production
and runtime-on PASS (runtime-on 86 of 266, snapshot 86, lost 0, gained 0).
