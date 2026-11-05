# W3W4-D3 evidence (lane w34-d3), WIP

Branch feat/pine-w34-d3-undeclared, on master c855e8cadf (engine 18 present). SCRIPT_ENGINE_VERSION not edited.

## Spike (corpus/committed, runtime lane, objectsInRun)
- correlation-matrix: `correlation` (v1 bare) -> served now.
- previous-day-high-and-low-separators-dailyweekly: `ta.pivot_point_levels` -> real missing builtin, refused by name (W1 list).
- volume-profile-auto-line-v2: `time(timeframe)` function form -> real missing builtin (needs a timeframe calendar), refused by name.
- Also seen: `ta.correlation` (heat-map-seasons, same name, v5), `avg` v4 (implied-volatility-suite), `linreg` with unfoldable length, `deviations.size`. Not in scope.

## Change
`runtimeRespelling` gets a `correlation` branch. ONE AUTHORITY: it calls `BUILTIN_CALL_TREE.correlation` -> `CALL_EXPANSIONS.correlation`, the builder the columnar/host lane uses for a pure call. No second formula. Length floor (whole number >= 2) is the builder's `windowOf`; my duplicate guard was unprovable by mutation and was deleted.
Object door refuses it as `runtime:object-door` (like hma), so C18 door output keeps master's behaviour class; measure-pair will classify.

## Parity evidence
Committed TradingView capture exists: tests/fixtures/vendor/r11-corr-pct-spy-2026-09-11.json (taCorrelation): na until the window fills (first defined bar = length-1), self-correlation exactly 1. The rail runs both rules over runtime state, and also asserts the runtime-state result equals the existing columnar lane's pure call. The capture does not cover na in a source, length 1-2, or unequal series; no semantics were invented there (inherited from the existing lane).

## Mutations (heavy-mut lock; mutate.py)
no-op control survives; drop-mapping, drop-version-gate, drop-effect-guard, drop-door-gate KILLED.
Defined-name guard (`definedNames.has(name) || isUserFn(name)` at the top of runtimeRespelling) is PRE-EXISTING and SHARED by every respelling branch, not mine; it survives my rail because the user-function path wins before the call reaches it. Reachability mutation over the whole runtime __tests__ dir was queued behind the lock: result below if present, else NEXT STEP.

## NEXT STEPS (queued behind other lanes' locks when usage ran short)
1. Reachability result for the shared defined-name guard (mutate.py muts3.json over runtime/__tests__, runs/w34-d3). If it SURVIVES the whole dir, delete the guard or prove it with a reaching case.
2. measure-pair (heavy-mp2 lock queued; mpbase2 was switched to c855e8cadf, assert HEAD before and after). Expect correlation-matrix first wall to move; 0 other C18 verdict changes.
3. Merge origin/master, final-tip FULL (heavy-final2), ready-check.
4. Engine bump: yes if correlation-matrix or heat-map-seasons outcome moves on the runtime lane (the runtime lane's output changes); recommend yes.
