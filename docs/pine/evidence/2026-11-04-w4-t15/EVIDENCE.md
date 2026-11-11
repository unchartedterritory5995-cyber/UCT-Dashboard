# W4-T15 evidence: function and statement forms (T16 folded in)

Branch `feat/pine-w4-t15-fn-forms`. Code tip `7106f71efd` (this file is a docs-only commit on top).
Tested on master `6990d63b02` (merge-base; `pine-dsk-mpbase2` switched to it inside each hl job, base HEAD asserted equal to it).
Engine bump: YES (new runtime answers; `SCRIPT_ENGINE_VERSION` NOT edited here).
Machine: desktop. Lanes used: mutation lane `heavy-mut.lock`; measure-pair lane `heavy-mp2.lock` (runtime 0 and 1, one job); final-tip lane 3 `heavy-final3.lock`.

## What changed (FE `ast/pineRuntimeFrontend.js` only; no ast/pine.js, no RT file, no other lane's band)
1. Named arguments on a user function (`bindNamedUserArgs`, before `completeUserArgs`; `defaultArgOf` is the one place a default becomes an argument). Binds by parameter name in any order; a skipped parameter takes its declared default; refused by name: unknown name, given twice, positional after named, skipped parameter with no default. Parameter defaults themselves already worked on master (positional).
2. A function body whose last statement is a `for`/`while` returns the last pass's value (na when no pass runs). Loop body lowered as a value block into a seeded sink (`pendingLoopSink`, `servedLoopLine`). Served only when the loop has no break/continue and its body's last line is a plain value line (expression, binding, reassignment) or another served loop. A body ending in a call, tuple, or if chain keeps master's answer (valueless; reading the value refuses by name).
3. One-line bodies that are a binding or comma statements (`f(x) => a = x*2, a+1`, `ma(x)=>a=0.,a:=...`): `oneLineBodyOf` turns the text after `=>` into the statement list an indented body uses; split before the last statement is read.
4. `log.info/warning/error` as statements (`LOG_FNS`, `logStmtsOf`): no chart effect, no stop. Arguments with effects (user function, array/drawing call, method) are lowered and run; pure arguments are not lowered. A function may end in a log call (valueless, as for a void array call).
5. Every new form is gated `!atObjectDoor`: the object door keeps master's answer and sentence.
Two older rails changed meaning: `c18WhileAndLastBar` and `runtimeStatementShapes` asserted "a function ending in a loop is refused when read"; they now use a loop with `break` (still refused). `p3WsaReviewFixes` L2 likewise (value-arm loop with `break`).

## Rail
`app/src/components/chart/engine/runtime/__tests__/w4FunctionForms.test.js` (29 tests): defaults/named, loop value (for, while, count-down, na, nested, break, void-call, if-chain, tuple tails), one-line bodies, log.*, object door.
Red on master (FE swapped to origin/master bytes, restored byte-exact; log `_resume-2026-11-01/runs/w4t15/mut.log` first run, 24 tests): 19 failed / 5 passed; on the final 29-test file (`mut5.log`): 21 failed / 8 passed (the passers are controls true on both). Green on tip: 29/29.

## Mutations (mutate.py, 25, all killed, 0 survivors; `mut5.log`)
loop sink dropped; break loop still served; sink not seeded na (nested inner loop with no pass); function not routed to value path; for/while body ignores sink (2); loop served at the object door; log.error not a log statement; log args never evaluated; method/user-fn arg treated pure; log served at object door; function ending in log not valueless; named arg: unknown / duplicate / positional-after-named / skipped-without-default allowed; skipped param takes no default; named args bound at the door; named args by call order; named-arg binding skipped; one-line comma not read; one-line binding not read; one-line body at the door; served loop accepts a call-ending body; nested loop served unconditionally.
Dead guards removed after a mutation survived: `for ... in` exclusion (refused identically either way), if-chain keyword check (a body with sub-lines is already excluded), tuple bracket check (subsumed by the token-kind check).

## measure-pair (`mpb.sh`: base switched in-job to `6990d63b02`; `measure-pair.sh <out> tip:pine-dsk-w4t15 base:pine-dsk-mpbase2 <rt> 1`). Logs `runs/w4t15/mpb.log`, dirs `mpb0`, `mpb1`.
(An earlier rt1 pass was discarded: another session switched the shared `pine-dsk-mpbase2` to `5d95103c8a` mid-job. The rerun asserts base == merge-base before each lane.)
- `== side tip 7106f71efd` / `== side base 6990d63b02`, runtime 0 and runtime 1.
- C18 corpus audit (`out-*.json`) and constructed probes (`probe-*.json`): 0 diffs both lanes (excluding `ms`). Object-door census change by script name: none.
- Vendor harness: rt0 `MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140`, rt1 `MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118`, both sides; harness output dirs byte-identical.
- Census 967 rows. rt0: 1 differing row. rt1: 3. Classification, 0 unintended:
  - INTENDED: `reference:kaufman-adaptive-bands__sXCNphOxWh` (rt0 and rt1): its one-line `ma(x)=>a=0.,a:=...` is now read; runtime lane attaches (clean false; remaining refusal `pine:statement` is a peeled line); production lane unchanged (unattached).
  - INTENDED, wall moved only (rt1): `committed:ict-turtle-soup-flux-charts__053c3e6056` and `reference:open-interest-stochastic-money-flow-index__kGyXZBhXgx`: `reachedAfterPeel` false to true (peel now finishes in fewer steps); attached/clean unchanged (false/false), same final refusal guard.
  - Earlier discarded rt0 pass had one more row, `halftrend-longshort-signal-engine-bigbeluga` (60 s timeout, `stuck` flag): NOISE; absent from the final pass.

## final-tip (`final-tip.sh pine-dsk-w4t15 w4t15-final2 tests/test_script_engine_version_gate.py`, tip `7106f71efd`, log `runs/w4t15/final2.log`)
- gate pytest `46 passed` rc=0; hygiene rc=0 (`clean: 34910 tracked file(s)`); `test_script_engine_version_gate.py` `6 passed`.
- full chart+hooks vitest: `Test Files  2 failed | 1333 passed | 27 skipped (1362)`. The two failures are the desktop baseline: `src/hooks/pollingSites.rail.test.js` and `src/components/chart/settingsScope.rail.test.js` (static scan of `app/src/lab/StudyChart.jsx:32`, red on master at/after 96582cd549; this branch touches no `src/lab` file).
- The first final-tip run (tip `ce10616cdf`) found three new reds (`c21DualView`, `runtimeWallsC23`, `p3WsaReviewFixes`): the loop value was being served for bodies ending in a drawing call or value-arm loop. Fixed by the plain-tail rule above; rerun clean.

## Open captures (add to capture queue)
- W4-T15-a: value of a loop that ends via `break`/`continue` (refused by name here).
- W4-T15-b: value of a loop whose body ends in an if chain, call, or tuple (kept valueless here).
- W4-T15-c: `log.*` with a format string needing `str.format` semantics is not evaluated (no chart effect, nothing observable here).
