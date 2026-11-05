# W3W4-D2 evidence: the "drawing build lowers nothing" wall was the value build's word

Branch `feat/pine-w34-d2-drawing-lower`, from origin/master `c855e8cadf` (engine 18, W6-T3a merged).

## Spike (read-only, local sample; identifiers only)
The spec's premise (`objectOpsLowered === 0` at the no-output exit, FE `:12243`) does not hold for these scripts.
`probeRuntimeProgram(src, {objectsInRun:true})` on the two sole scripts does NOT end in no-output:
- `rth-opening-range-with-extensions`: drawing build refuses `runtime:call-conversion-state` (`bool(...)` of a mutable value).
- `strong-start-rvol-dashboard`: drawing build refuses `runtime:history-dynamic-offset` (FE `calcDaily`), then, once peeled, `runtime:request`.
- `trading-sessions` (builtin): `runtime:loop` (`for ... in`), then a true no-output once peeled (nothing is drawn). Unchanged.
- `session-tpo-profile`, `power-of-3-ict-01`: already declined with other names at step 0; their no-output was only the last peel step.

Cause: `memberPaneDefinition.js::runtimeLaneDefinition` (about `:1360`) re-probes the VALUE build (`objectTrees: []`) when the drawing
build refuses. The value build hands every drawing to the host program, so a drawing-only script has nothing to plot THERE and
refuses `runtime:no-output`. The door took that as the script's wall and dropped the drawing build's real refusal
(`runtimeObjectsDoor.js` only deferred on `runtime:object-op`). The lowering itself (FE `:3111-3330`) is right: shapes
`var table` in `if barstate.islast`, table at top, drawing in a UDF, box, line all lower with `objectOps > 0`.

## Change (door only; the front end is NOT touched, so no overlap with D1 or D3, no second type authority)
- `runtimeObjectsDoor.js`: `VALUE_BUILD_NOTHING_GUARD` and `valueBuildDefersToDrawing(guard)` (object-op OR no-output); used by
  `runtimeOwnObjectsOf`'s `refusedForDrawing`.
- `memberPaneDefinition.js`: the decline uses the drawing build's refusal when the value build says no-output.
- `coverageMapDoorCensus.measure.test.js`: uses the same predicate (one authority).
No store family added, nothing drawn that was not drawn. Where TradingView hides: untouched (no drawing path changed).

## Rail `builder/memberPane/w3nDrawingBuildEmpty.test.js` (6 tests)
Shape rails (mutable conversion in a drawing argument, two forms) decline `runtime:call-conversion-state`; control: held drawing
lowers (`objectOps > 0`) and attaches run-owned; control: no drawing still declines `runtime:no-output`; predicate pin.
Mutations (mutate.py, `runs/w34-d2/muts.json`): see MUTATIONS below.

## Census (runtime-on, 5 scripts, step lists)
Before: rth `runtime:no-output` (stuck), strong-start `runtime:no-output` (stuck).
After: rth step0 `runtime:call-conversion-state`, then reaches the end of its peel (stuck none); strong-start step0
`runtime:history-dynamic-offset`, stuck `runtime:request`; trading-sessions unchanged (`runtime:loop` then no-output);
session-tpo-profile and power-of-3: no change in step-0 names (their final peel step differs only by later walls).
No script attaches; none was expected (nothing newly drawn). Cell text stays refused by name (S1), untouched.

Engine bump: NO for drawing output (nothing drawn changes), but the door's decline code moves for these scripts
(telemetry/refusal text). Coordinator's call; I recommend no bump.

## MUTATIONS
Proved by hand (tiny single-file rail, before the lock queue): with the door line reverted to `r.guard === 'runtime:object-op'`
the two shape rails go RED (2 failed of 6); the no-op control (`&& true`) stays green (6 of 6).
The formal run (`mutate.py`, 4 mutations incl. no-op and predicate mutations, `runs/w34-d2/muts.json`, driver
`runs/w34-d2/mut.sh`, output `runs/w34-d2/mut.out`) was QUEUED behind `w34t0-job` on heavy-mut.lock when I stopped; it may still
run and writes mut.out; mutate.py restores each file byte for byte.
Neighbouring suite green: `builder/memberPane` + `tableClear` = 34 files, 320 tests passed, 2 skipped.

## NOT DONE (next steps)
1. Read `runs/w34-d2/mut.out`: expect noop SURVIVED, the other three KILLED.
2. merge origin/master, then final-tip (heavy-final2.lock) on the final tree, then ready-check.sh.
3. measure-pair (heavy-mp2.lock, base pine-dsk-mpbase2 switched to the merge-base, assert HEAD before/after), queued behind D3.
   Expected C18 diff: none (front end untouched); expected movers: only the runtime-on census rows above.
