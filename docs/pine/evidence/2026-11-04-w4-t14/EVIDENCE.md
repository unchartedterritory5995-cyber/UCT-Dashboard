# W4-T14 evidence: v6 `bool` typing for valueless arms

Branch `feat/pine-w4-t14`. Code tip `458c9149617e09b220db2bdd11ffba9706ee2b1d` (this file is a docs-only commit on top).
Tested on master `03a42b201a08895d8a84e517a2f9be9b974067de` (merge-base; measure-pair base worktree `pine-dsk-mpbase2` switched to it inside the job).
Engine bump: YES (new runtime answers; `SCRIPT_ENGINE_VERSION` NOT edited here).

## What changed
- FE `ast/pineRuntimeFrontend.js` only. T14 bands only: `typeTables` neighbourhood (new `provablyBoolNode/Toks`, `nameIsBool`,
  `fnIsBool` sit beside `provablyNonBoolToks`), `refuseV6UnmatchedBool` (now returns true when every arm value is provably a bool),
  and the two no-else/no-default call sites (`lowerIfChainInto`, `lowerSwitchInto`) which then lower the unmatched path as an
  assignment of `false` (0) into the single value slot (`mk.falseFallback`, set in `armAssignerFor`).
- Provably a bool: comparison, `and`/`or`/`not`, `true`/`false`, `input.bool`, a name declared `bool` or bound to a provable bool
  (per scope, conflicting declarations in reach are not provable), a user function whose every result is a provable bool, a ternary
  whose both branches are.
- Unchanged: v5 and below yield `na`; a number/string/colour arm still yields `na`; a mix, `array.get`, `timeframe.isdaily` etc.
  keep the named `runtime:block-value` refusal; the object door keeps Q-A3 refused (`p3WsaDarkGate` v6bool still green);
  a tuple sink is never served false.
- Q-A3 (TradingView capture) is NOT yet taken. This serves the documented reading (v6 migration guide, "Boolean values";
  conditional structures). The capture row stays open in `capture-queue-2026-10-31-wsa-for-bound.md`; if the capture disagrees,
  revert the `falseFallback` branch only.
- Old `p3WsaReviewFixes.test.js` tests that pinned "bool arm is refused" for now-provable shapes (7) were rewritten to assert the
  served `false` values; the refusal-for-unprovable tests are untouched.

## Rail
`app/src/components/chart/engine/runtime/__tests__/w4V6Bool.test.js` (17 tests) + the 7 rewritten tests in `p3WsaReviewFixes.test.js`.
Red on master (FE swapped to `origin/master` bytes, restored byte-exact): 18 failed / 82 passed of 100 across those two files. Green on tip: 144/144
with `p3WsaDarkGate`; wider runtime block-value rails (10 files, 264 tests) green.

## Mutations (mutate.py, default mutation lock lane `heavy-mut.lock`; 16 total, 15 killed)
| mutation | killed by |
|---|---|
| fallback writes na not false | every served-false test |
| comparison not bool / and-or not bool / `not` not bool | comparison, else-if, switch and/not tests |
| true/false literal not bool | literal-true and else-if tests |
| `input.bool` not bool | input.bool test + rewritten H-2 input.bool |
| bool-typed name / name bound to bool rhs not bool | name tests, rewritten M3 tests |
| user fn bool result not bool | fn test + rewritten (c) tests |
| ternary `&&`->`\|\|` | mixed ternary refused |
| arms `every`->`some` | mixed bool/number arms refused |
| served on object door | `p3WsaDarkGate` v6bool |
| v5 served false | v5 CONTROLs |
| if: unmatched left na / switch: unmatched left na | all if / switch tests |
| single-slot restriction dropped (`sink.slots.length === 1 ?` -> `true ?`) | SURVIVED: equivalent. A tuple sink's arm values are bracket lists that `parseWholeExpression` does not read as a bool, so `provablyBoolToks` is already false for them and the fallback is never requested. |

## measure-pair (cmd `bash w4t14-mp.sh`: base switched in-job to `03a42b201a`; lock lane `heavy-mp2.lock`)
Logs: `_resume-2026-11-01/runs/w4t14-mp0.log`, `w4t14-mp1.log` (out dirs `w4t14-mp0`, `w4t14-mp1`).
- `== side tip 458c914961` / `== side base 03a42b201a`, runtime 0 and runtime 1.
- C18 corpus audit and C18 constructed probes: identical (excluding `ms`) both lanes: 0 diffs.
- Vendor harness: rt0 `TOTAL 336 MATCH 93 DIVERGE 103 INCONCLUSIVE 140` both sides; rt1 `MATCH 111 DIVERGE 107 INCONCLUSIVE 118` both sides; harness dirs byte-identical.
- Census 967 rows. rt0: 2 differing rows; rt1: 3. Classification, 0 unintended (no row changed attached/clean/final guard):
  - INTENDED (rt1): `ict-institutional-order-flow-fadi`, `volume-delta-oi-delta-kioseff-trading`, `mirage-liquidity-sweep-pro-willyalgotrader`:
    the first wall moved from `runtime:block-value` (v6 unmatched `if`/`switch` of a bool) to a later, different refusal; still unattached.
  - NOISE (rt0): `volatility-coil-edge-bullbyte` (pine:timeout script, peel-step droppedOps 142 vs 137), `halftrend-longshort-signal-engine-bigbeluga`
    (pine:timeout vs pine:state in nested step detail); top-level attached/clean/peelSteps/stuck identical.
  - No new clean attach on the sample. The spec's expected `volatility-stop` attach is not in the sample census; it needs the capture and T2/T4.

## final-tip (lock lane `heavy-final2.lock`)
Command `final-tip.sh pine-dsk-w4t14 w4t14-final-r2` (log `runs/w4t14-final-r2/`), tip `458c9149617e` (evidence commit is docs-only).
- gate pytest `46 passed` rc=0; hygiene rc=0; zzMP files in js.log: 0.
- full chart+hooks vitest: `Test Files 2 failed | 1333 passed | 27 skipped (1362)`. Failures: `src/hooks/pollingSites.rail.test.js` (known desktop baseline)
  and `src/components/chart/settingsScope.rail.test.js` (`app/src/lab/StudyChart.jsx:32 <StockChart> passes settingsOverride without onSettingsPersist`).
  The second fails alone too, reproducibly. It scans `src/lab/StudyChart.jsx`, which this branch does not touch (`git diff origin/master -- src/lab` empty; last changed by master commit 96582cd549), so it is a master failure outside the lane, not a T14 regression.
- The first final-tip run (`w4t14-final`, concurrent with measure-pair in the same worktree) was discarded as invalid per coordinator; it showed the same two failures and no zzMP.

# r1 fix round (review W4-T14 NO-GO, finding B1)

Code tip `4106a6b0768cf8524ac026855b8c0c711b5157ab` (this r1 section is a docs-only commit on top). Tested on master `03a42b201a08895d8a84e517a2f9be9b974067de`. Engine bump: YES at merge (unchanged: the shipped lane serves nothing new, but the bool-typing machinery is in); `SCRIPT_ENGINE_VERSION` NOT edited.

## B1 fix
- `pineRuntimeFrontend.js`: new constant `V6_BOOL_UNMATCHED_CAPTURED = false` (Q-A3 gate). `refuseV6UnmatchedBool` returns true (serve `false`) only if the constant is true (or the TEST-ONLY opt `opts.w4t14ServeUnmatchedFalse === true`, never set by product code). With the gate shut, a typed-bool unmatched block falls through to the existing named refusal `runtime:block-value` ("a v6 bool is never `na`"). Typing machinery (`provablyBoolNode/Toks`, `nameIsBool`, `fnIsBool`, `falseFallback`) kept. Flipping the constant is the whole change once Q-A3 MATCHes.
- `p3WsaReviewFixes.test.js` restored byte-exact to its pre-T14 version (the 7 refusal rails are back; `git diff 458c914961^ -- <file>` is empty).
- `w4V6Bool.test.js`: new Q-A3 GATE describe (if and switch typed-bool blocks stay refused by name; machinery-present rail: with the test-only opt the same source is served false), object-door-with-opt stays refused; the served-false rails now run under the opt.
- `capture-queue-2026-10-31-wsa-for-bound.md` Q-A3 row: records the gate constant and the probe.
- Targeted: w4V6Bool + p3WsaReviewFixes + p3WsaDarkGate: 3 files, 148 passed.

## Mutations (mutate.py, lane `heavy-mut.lock`; 5 run, 5 killed after adding one rail)
| mutation | killed by |
|---|---|
| gate constant flipped to true (serve false) | the 7 restored refusal rails in p3WsaReviewFixes (M3 bool name, M-1b, L-4, re-review 3 (c) x2, H-2 x2) + the new GATE rails |
| gate removed entirely (always served) | same |
| object-door check dropped (opt on) | new rail "objectDoor + the test-only opt: still refused" (first run SURVIVED, rail added, then KILLED; with the gate shut it was otherwise equivalent) |
| comparison not bool | machinery rail + served-false rails |
| fallback writes na (`[]`) | machinery rail + served-false rails |
(r0's other 15 mutations concern the same machinery, unchanged by r1.)

## measure-pair (script `runs/w4t14r1/mp.sh`, lock `heavy-mp3.lock`, base `pine-dsk-mpbase3` switched in-job to `03a42b201a`)
Logs `runs/w4t14r1/mp-all.log`, `mp0.log`, `mp1.log`. HEAD asserted before/after each lane: tip `4106a6b076`, base `03a42b201a`, unchanged (22:35:01 -> 23:18:11 rt0; 23:18:11 -> 23:58:43 rt1).
- C18 corpus audit and constructed probes: identical excluding `ms`, both lanes (object door unchanged).
- Harness: rt0 `MATCH 93 DIVERGE 103 INCONCLUSIVE 140` both sides; rt1 `MATCH 111 DIVERGE 107 INCONCLUSIVE 118` both sides; harness dirs identical.
- Census 967 rows, fewer movers than r0 (r0: 2 + 3): rt0 2 rows, rt1 1 row, 0 changed `attached`/`clean` at top level; all NOISE (pine:timeout scripts `multi-timeframe-trend-indicator`, `halftrend-longshort-signal-engine-bigbeluga`: nested peel-step detail only). The 3 r0 intended wall moves are gone (the lane no longer serves the case). 0 unintended.

## final-tip (lock `heavy-final3.lock`; `final-tip.sh pine-dsk-w4t14 dsk-w4t14r1-final`; logs `runs/dsk-w4t14r1-final/`, `runs/w4t14r1/final.log`)
Tip `4106a6b076` (code tree; this commit is docs only). gate pytest `46 passed` rc=0; hygiene clean rc=0; full chart+hooks vitest `Test Files 2 failed | 1333 passed | 27 skipped (1362)`. The 2 failures are the baselines: `src/hooks/pollingSites.rail.test.js` (every master) and `src/components/chart/settingsScope.rail.test.js` (red on master since 96582cd549, StudyChart.jsx, not touched by this lane). 0 zzMP leftovers.
