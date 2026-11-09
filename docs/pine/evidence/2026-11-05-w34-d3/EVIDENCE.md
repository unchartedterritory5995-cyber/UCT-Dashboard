# FIX r1 (review NO-GO @753c0196a2): RESULT
- B1: the runtime branch is REMOVED; `pineRuntimeFrontend.js` is byte-identical to master. Reason: restricting to na-free-by-construction sources left it unreachable (probed: 0 hits; the columnar lane serves na-free pure calls first), so serving would add nothing the capture pins. `correlation` over runtime state (slots, request.security, gaps) stays refused as runtime:call-undeclared-builtin-state, token named. correlation-matrix therefore does NOT move; the earlier C18/census movement below is superseded: no runtime-lane outcome changes. ENGINE BUMP: NO.
- Rail (12 tests): refusals incl. the -47.64 slot probe; |r|<=1 invariant and Pearson on na-free calls; capture rules (na until window fills, self-correlation 1). Mutation: reinstating the unrestricted branch is KILLED; no-op control survives.
- B2: the SPELL shadow guard is deleted with the branch; the user sma/stdev case now cannot be served by this lane.
- N1 (pure-call -47.64 on master), N2/N4 routed: capture row in docs/pine/capture-queue-2026-11-05-w34-d3.md. Pre-existing master defect: pure ta.correlation over an na-gapped source.
- Old measure-pair/final-tip sections below are for the superseded tip; the final-tip for this fix is recorded at the end.

# STATUS: DONE. final-tip (runs/w34-d3-final2) complete, see final-tip section below. No next step except the coordinator's engine-bump call.

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

UPDATE: reachability mutation over runtime/__tests__ finished: drop-shared-defined-guard KILLED (failures in the corpus census-style tests 'prints the ceiling and the per-guard drawer count' and 'prints where the DRAWING dies', both 22 s runs, so possibly timing-sensitive; not a clean unit proof). Decision: KEEP the shared guard (reachable in at least one suite, not mine, outside this lane). Still NEXT: measure-pair, final-tip, ready-check.

## measure-pair (runs/w34-d3/mp; code tip 5176692ec1, base c855e8cadf; later commits touch only this test and docs)
The script printed MEASURE_FAILED "base head moved" only because I committed docs/test to the tip worktree mid-run (the app diff 5176692..HEAD is the rail file alone). Data are valid for the code.
- C18 corpus audit (out-*.json): identical on the 967-row corpus once the wall-clock `ms` keys are ignored. C18 probes identical. Vendor harness: identical totals (MATCH 111, DIVERGE 107, INCONCLUSIVE 118).
- runtime-on census: 2 rows differ. `committed:correlation-matrix__dzN3DMCFJL` reachedAfterPeel False -> True, peelSteps 7 -> 1 (the only script that moves). `multi-timeframe-trend-indicator` differs only in the line/token attached to a `pine:timeout` (wall-clock noise).
- Engine bump: YES recommended (a runtime-lane outcome moves: correlation-matrix).

## final-tip (runs/w34-d3-final2, TIP 47f1b23278; code last touched 508bed7d4c, docs only after)
rc gate=0 hyg=0, js=1, totals=ok, integrity=ok, errors=0. (An earlier run, w34-d3-final, was INCOMPLETE: my docs commit moved HEAD mid-run.)
js failures: baselines pollingSites, settingsScope, enumerationSites, vendorHarness, controlDoorCensus; coverageAudit (wall-clock flake: PASSES alone, 192 tests); usePreferences.additionsOnly: fails on `notebook/TodayHome.jsx: 1 opaque setPref site`, a master file this lane never touched (app/src/hooks diff vs master-base is empty); passes on an older base. Not mine.
ready-check: FAIL only on the coverageAudit flake (re-run alone passes) and the allowlist lacking enumerationSites/vendorHarness/controlDoorCensus/additionsOnly as named baselines; no failure in a file this lane touched.
Engine bump: YES recommended (correlation-matrix reachedAfterPeel False->True).

## FIX r1 final-tip (runs/w34-d3-final3, tip ae20b5f98f, merged with master; FE file identical to master)
gate 0, hyg 0, integrity ok, totals ok. js failures: allowlisted baselines + usePreferences.additionsOnly (master red, TodayHome.jsx:487) + coverageAudit (flake) + vendorHarness.wseCalcBars (timing-sensitive under full load; PASSES alone 2/2). All are files this lane does not touch.
