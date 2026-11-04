# W4-T9 offsets bounded by a frame local derived from a parameter - evidence (desktop, 2026-11-04)

Branch `feat/pine-w4-t9-offsets`, stacked on W4-T2 (`ac659bae66`, origin/feat/pine-w4-t2-simple-folding).
Merge-base with master: `5d95103c8a` (same as T2's). Engine tip `133a4d217a` (commits `a2f48eaacc`, `133a4d217a`;
this file follows in a docs-only commit). Logs (desktop, licence-held where noted):
`C:\Users\Patrick\uct-worktrees\_resume-2026-11-01\runs\dsk-w4t9\`.
Runtime lanes used: lane 0 (production) AND lane 1 (runtime-on), both measured.

## What was wrong (and what was already there)

The T9 spec said "a counter bounded by a frame parameter carries `frameName`". On the T2 base that already holds
for a bound written straight from the parameter (`for j = 0 to length - 1`, two call sites): measured OK before any edit.
The wall that remained is the shape real scripts write: a LOCAL derived from the parameter,
`periods = length - 1` ... `for j = 0 to periods` (the TradingView built-in linear regression channel's deviation
function, first wall `runtime:history-dynamic-offset` @77). `constValueOf`/`foldConstNode` named the LOCAL (`periods`) as
the frame name; `simpleSpecialisation` only specialises on a parameter, so no call site could ever settle it.

## What changed (`app/src/components/chart/engine/ast/pineRuntimeFrontend.js`, no other lane's band)

- new `frameLocalDefs` (slot -> binding expression + declaring scope), filled where a function body binds
  `name = expr` (ordinary binding, not `var`, whose name is never mutated anywhere in the script).
- new `frameSubstitute(e, scope)`: the ONE place the frame's names are answered. A parameter the call site fixed is its
  constant (`frameConsts`, unchanged); a recorded frame local is replaced by its expression, read in the scope it was
  written in (so a nested redeclaration of a parameter name cannot capture it); any other frame name is `foreign` and is
  named on the refusal, as before. Off at the object door (`atObjectDoor`): master's answer there.
- `constValueOf` and `foldConstNode` call it in place of their two identical inline substitution copies (one
  authority). Their refusal objects and messages are unchanged. `forCounterRange` / `frameBoundRefusal` are NOT edited:
  they already carry `frameName`, and now receive the parameter's name.
- T2's helpers are not edited: `simpleValueOf`, `foldConstNode`'s body after the substitution and the `simpleValueOf`
  calls stay as T2 left them; only the substitution block inside `constValueOf`/`foldConstNode` was replaced.
- `/` and `%` stay refused: the fold already refuses them (a division guard written first was an equivalent survivor under
  mutation and was removed). `zxLag = math.floor((len - 1) / 2)` stays refused (T17).
- Known limit, not this lane: a DIRECT parameter offset `src[length - 1]` at two call sites stops at the history plan
  (`runtime:statement`, "ring was planned for depth 2") on the T2 base, with or without a local. The same shape with a
  local now stops there too instead of at `runtime:history-dynamic-offset` (still a named refusal, never a wrong number).

Tests: new `runtime/__tests__/w4OffsetFrameLocals.test.js` (16 tests); `objectDoorGate.test.js` +1 shape `t9_local` (x3 cases).

## Rails red on the T2 base, green on the tip

`hl w4t9-mut` (`mut.sh`): the T2 FE bytes (`git show ac659bae66:...`) written over the tip FE, the two files run, tip bytes
restored (`cmp` RESTORED, worktree clean). On the T2 base **8 failed**: `objectDoorGate: t9_local: the runtime pane builds it`,
and in `w4OffsetFrameLocals`: `periods = length - 1` at two call sites; chain of locals + conditional; simple input
through the local; nested redeclaration; equals the inline spelling; direct offset `src[periods]`; window length
`ta.sma(src, n)`, `n = length * 2`. The controls and still-refused cases pass on the base (they must).
Tip: four files (`w4OffsetFrameLocals`, `objectDoorGate`, `boundedSlotOffset`, `w4SimpleFolding`) **89/89**.
Logs `redbase.log`, `green.log`.

## Mutation proofs (`mutate.py`, the same four files; `mut2.log`, hl `w4t9-mut2`, heavy-mut.lock)

| mutation | killed by |
|---|---|
| M1 never expand a local | the two-call-site, chain, simple-input and inline-equality rails |
| M2 expand at the object door | door gate `t9_local` (door draws nothing new / falls back to master) |
| M3 record a reassigned local (`!mutable` guard forced true) | `a local the body reassigns` |
| M7 expand in the use-site scope, not the declaring scope | `a name the body redeclares in a nested block` |
| M8 `constValueOf` ignores the expansion | the two-call-site rails |
| M9 `foldConstNode` ignores the expansion | `the local sizes a window length too` |
| M10 a foreign frame name is not reported | the two-call-site rails |
| M11 `frameConsts` not consulted in the helper | the two-call-site rails |

All KILLED. Round-1 survivors, removed rather than kept: the division/remainder guard (M4/M5/M6: equivalent, the fold
refuses `/` and `%` itself, pinned by the `a division`, `a remainder` and `zxLag` rails), and M7 (the first
nested-redeclaration fixture used a macro binding that never shadows; fixed with a mutated inner name). Equivalent
survivors left: none.

## measure-pair (both lanes; base `pine-dsk-mpbase2` switched INSIDE the job to the T2 tip `ac659bae66`)

`hl w4t9-mp` on heavy-mp2.lock: `measure-pair.sh mp0 tip:<wt> base:<mpbase2> 0 1`, then `... 1 1`.
`== side tip 133a4d217a` / `== side base ac659bae66` on both lanes. Merge-base with master `5d95103c8a`
(the diff is T9's own: base = the T2 tip).

| lane | C18 `out-*.json` | C18 `probe-*.json` | harness TOTAL (tip = base) | `verdicts.json` | census rows, non-timing diff |
|---|---|---|---|---|---|
| 0 (production) | identical (only `ms`) | identical | 336: MATCH 93 / DIVERGE 103 / INCONCLUSIVE 140 | identical | 6 of 967 (below) |
| 1 (runtime-on) | identical (only `ms`) | identical | 336: MATCH 111 / DIVERGE 107 / INCONCLUSIVE 118 | identical | 13 of 967 |

**Object door: no change.** The C18 corpus audit and constructed probes are identical modulo timing on both lanes (the
M2 mutation and the `t9_local` door shape prove the gate). No object-door census change by script name.

Lane 1 census diffs, all INTENDED (a `runtime:history-dynamic-offset` wall that was a frame local is gone):
- `builtin:linear-regression-channel` (the spec's expected attach): step-0 wall `history-dynamic-offset`@77 gone, now
  ATTACHED on the runtime lane; `lossVerdict: partial` (drawings withheld, 10 of 13 object ops, `withheldObjects: true`).
- `committed:range-filter-bs-signals`: step-0 wall `history-dynamic-offset`@18 gone, ATTACHED, `lossVerdict: clean`,
  4 plots. NOT in the spec's expected list; same cause. Reviewer: no TradingView capture covers it, so confirm before arming.
- first wall moved on `optimized-trend-tracker` (@37 -> `call-undeclared-builtin-state`@42), `most-screener` (@31 ->
  `history-expression`@75), `supertrend-cluster-zeiierman` (@132 -> `history-expression`@135): as the spec predicted.
- later peel steps changed only (step-0 wall identical): `momentum-based-zigzag`, `flying-buddha-inside-bars`,
  `obv-macd-indicator`, `open-interest-stochastic-money-flow-index`, `range-filter-v1`, `range-filter-x-hull-suite`,
  `multi-timeframe-trend-indicator`, `market-structure-with-inducements-sweeps-luxalgo` (refusal text only; attached
  true on both). Peel-step artefacts of the walls above.
- Spec's `anti-volume-stop-loss`: no first-wall move on this sample.

Lane 0 census diffs: `builtin:linear-regression-channel` differs ONLY in the dark `runtime` probe record (attached
true; the member-facing `attached` is false on both), plus peel-step / `dropReasons` noise on
`multi-timeframe-trend-indicator` (base stuck `pine:timeout`, a timing artefact), `halftrend-longshort-signal-engine`,
`volatility-coil-edge`, `luxy-momentum-trend`. No member-lane step-0 wall or `attached` change. All intended or benign;
0 unintended.

## Final-tip numbers

`final-tip.sh pine-dsk-w4t9 dsk-w4t9/final tests/test_script_engine_version_gate.py` (hl `w4t9-final`, heavy-final2.lock) on `133a4d217a`:
gate pytest 46 passed; `test_script_engine_version_gate.py` 6 passed; hygiene clean; vitest chart+hooks
`Test Files 1 failed | 1335 passed | 27 skipped (1363)`, `Tests 1 failed | 22414 passed | 118 skipped (22533)`.
The one failure is `src/hooks/pollingSites.rail.test.js`, the desktop baseline (T2 base: 22393 passed; +21 = this lane's
16 + 3 door-gate cases + 2). `settingsScope.rail` is not red here: the tree predates master `96582cd549` and no file under
`src/lab` is touched. Log `final/js.log`.

## Engine bump

Yes: output-changing (a runtime-lane build that refused now builds). SCRIPT_ENGINE_VERSION NOT edited.
