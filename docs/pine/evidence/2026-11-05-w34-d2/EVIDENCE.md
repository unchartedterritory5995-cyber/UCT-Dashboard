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

## Measure-pair (base c855e8cadf asserted before and after; tip 5ea5f9ed17; 967 rows per lane)
Harness verdicts and C18 probes: byte-identical base vs tip in both lanes. C18 audit: 0 diffs. `attached` unchanged on every row.
### Runtime-on census: 18 rows differ, all refusal-name moves of a correct word for a wrong one (value build's no-output -> the drawing build's own word)
- rth-opening-range-with-extensions: no-output -> `runtime:call-conversion-state`, peel now ends clean.
- strong-start-rvol-dashboard: no-output -> `runtime:history-dynamic-offset`, then `runtime:request`.
- session-tpo-profile, dynamic-swing-anchored-vwap-strategy (peel tail): final no-output -> peel ends clean.
- power-of-3-ict-01: final no-output -> `runtime:statement`.
- 9 doc examples (array.join, array.new_label, request.security_lower_tf, str.repeat, str.substring, strategy.closedtrades.entry_id/entry_time, strategy.default_entry_qty, strategy.opentrades.entry_id): no-output -> `runtime:array` / `pine:builtin` / `pine:request` / `pine:strategy-call`.
- trading-sessions, multi-timeframe-trend-indicator: step names identical; only a census annotation (`rtProbe`) differs.
### Production census: 3 rows differ (ai-supertrend-x-pivot, halftrend-bigbeluga, luxy-momentum)
Re-run alone, production lane, 3x on base (c855e8cadf, HEAD asserted) and 3x on tip, interleaved (`runs/w34-d2/rep-*.jsonl`).
All 18 runs: identical step lists (guard + reason + attached) per script, base == tip, `attached` false everywhere, final `pine:roundtrip`.
- ai-supertrend: 7 steps, ends `pine:roundtrip` on every run, both sides (the one-off `stuck None` in mp0 base did not recur).
- halftrend (8 steps, 89-93 s) and luxy (5 steps, 109-133 s): same in all 6 runs each.
Classification: time-budget noise (the translator's "did not finish" budget under load; wall times 2.1-133 s vary run to run, signatures never do). No real production change.

## MUTATIONS
`mutate.py` (runs/w34-d2/mut.out): noop-control SURVIVED; door-only-object-op, predicate-drops-no-output, predicate-defers-everything KILLED.
Reviewer N1 (`runtimeObjectsDoor.js:77`): rail `runtimeOwnObjectsOf: a clean host drawing whose value build says no-output ...` plus a control (host draws and plots keeps the host).
Reverting :77 to `=== VALUE_BUILD_DRAWING_GUARD` -> 1 failed of 8 (KILLED); `&& true` no-op -> 8 of 8.
memberPane + tableClear: 34 files, 320 tests green.

## Engine bump: no (door only; no translator output changes).
