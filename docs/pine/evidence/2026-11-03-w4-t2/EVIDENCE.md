# W4-T2 `simple` qualifier folding — evidence (desktop, 2026-11-03)

Branch `feat/pine-w4-t2-simple-folding`. Tested-on-master **`5d95103c8a`** (merge-base, `origin/master`).
Engine commit `29e61f317f`; pin update + this file in the commits after it (see "Final tip").
Logs (desktop, licence-held where noted): `C:\Users\Patrick\uct-worktrees\_resume-2026-11-01\runs\dsk-w4t2\`.

## What changed

`app/src/components/chart/engine/ast/pineRuntimeFrontend.js` (T2 band only):
- new `simpleValueOf` (+ `simpleShapeOf`, `simpleValueAt`, `simpleFoldToks`, `foldsExactly`) just above
  `constValueOf`. A root name is `simple` when every write is one of: its single root declaration
  (never `series`/`varip`) whose value folds; `:=`/`+=`/`-=`/`*=` at the root or inside
  `if`/`else if`/`else` bodies whose tests fold; a `var` only if nothing reassigns it. The value at a
  read is the straight-line run of those writes up to that read (the taken arms chosen by the folded
  tests). Anything else (a loop, `switch`, inline arm, function body, tuple, block-valued right side,
  a shadowing declaration, a value or test that does not fold, `/` or `%`) keeps master's refusal.
- hooks: `invariantTest` (after the frame substitution), `constValueOf`, `foldConstNode`.
- `foldConstNode` also folds pointwise arithmetic over a canonical tree with no bar in it
  (`k + 2`, `math.max(len, 3)`), no `/` or `%` (T17).
- numbers fold at the author's default (the owner's 2026-08-11 frozen rule, `history.test.js`);
  text at the value in force (`fixedTextOf`); timeframe flags from the build's own `bindConsts`
  (no `tf`, no fold). The object door keeps master's answer (both new folds are off there).
- Not touched: T1/T3/T4/W3 regions, `constantArgOf` (T3) — so shape (a) of wall 1 (a simple text
  through a UDF parameter) is still T3's.

Tests: new `runtime/__tests__/w4SimpleFolding.test.js` (26); `objectDoorGate.test.js` +3 shapes
(`t2_if`, `t2_var`, `t2_arith`, x3 cases each); `finiteWindow.test.js` "measured gap" `k + 2` now
asserts span 7 (the test said to assert the value the day it lands); `constantLengthRefusal.test.js`
reassigned control moved under a per-bar `if` (an unconditional `n := 6` is now simple); the two
vendor pins on `volume-profile` (`vendorHarness.c47ConstTernary`, `vendorHarness.f6SpyDrawings`) move
past `ta.highest(lookback_bars)`@154 (a never-reassigned `var`, now simple) to the next wall by name.

## Rails red on master, green on tip

Command (inside `hl dsk-w4t2-mut2`): master FE bytes written over the tip FE, the four files run,
tip bytes restored (`redmaster.log`). Master `5d95103c8a`: **22 failed**:
- `w4SimpleFolding.test.js`: 18 failed (every served shape: `var L = 7`, var initialiser follows the
  member's text input, offset bound, `for` bound, RSI `var enableMA`, `if` on a text input,
  `if timeframe.isintraday`, else-if chain with compound forms, value at the read, own-name write,
  test reading its own name, writeless `if`, named argument, simple-reads-simple, `math.max` x2,
  numeric input at default, depth ceiling); the 8 controls pass on master (they must).
- `objectDoorGate.test.js`: `t2_if`/`t2_var`/`t2_arith: the runtime pane builds it` (3).
- `finiteWindow.test.js`: `ARITHMETIC over an input folds` (1).
Tip: all four files green (w4SimpleFolding 26/26, door gate + finiteWindow 86/86).

## Mutation proofs (`mutate.py`, test files: the four above)

Logs `mut1.log`, `mut2.log`, `mut3.log`. Final code, every mutation KILLED:

| mutation | killed by |
|---|---|
| M1 a write under a test that does not fold treated as not-taken | `under if timeframe.isintraday` (no tf) |
| M2 drop the never-reassigned check on `var` | `a var written inside a block, even under an invariant test` |
| M3 drop the `invariantTest` hook | RSI `var enableMA` |
| M4 drop the `constValueOf` hook | `it bounds a for counter` |
| M5 drop the `foldConstNode` hook | `var L = 7 sizes a window` |
| M6 drop the arithmetic fold | `math.max(len, 3) over an input` |
| M7 arithmetic fold at the object door | door gate `t2_arith` |
| M8 simple fold at the object door | door gate `t2_if` / `t2_var` |
| M11 let `/` and `%` fold | `a series-declared name, and /` |
| M12 no depth ceiling | `a chain deeper than the ceiling refuses` |
| M13 a declaration outside the root counts | `a block that declares its OWN len` |
| M14 a write in any block counts | `a write inside a loop, a switch arm…` |
| M16 every block is an `if` body | same |
| M17 any declaration word (`series`) | `a series-declared name, and /` |
| M18 a named argument counts as a write | `a named argument after the read` |
| M19 read inside a write's own right side | `the value at a read is the value AT THAT READ` |
| M20 read inside an arm's test | `a test that reads the name it guards` |
| M22 a chain with no writes is evaluated | `an if that writes nothing…` |
| M23 the first arm always taken | `under if on a text input` |
| M24 `+=` as `:=` | else-if chain with compound forms |
| M25 text names at the author's default | `its initialiser follows the member's text input` |
| M26 timeframe flags not bound | `under if timeframe.isintraday` |
| M28 a failed arm run still answers | `a series-declared name, and /` |
| M29 a failed declaration fold still answers | `a value that does not fold makes the name per-bar` |
| M30 a failed write fold keeps the old value | `a write inside a loop…` |

Round-1 survivors were removed rather than kept unproved: the `inRequestValue` and `owner !== null`
guards (equivalent: a request value is lowered in its own scope and refuses
`runtime:request-with-state` first; a function body's scope holds no global — pinned by the new
control `a function body reads a global at the CALL's moment`), a block-RHS check (equivalent: a
block header never parses as one expression), a second-declaration check, the main "stop at the
read" line (covered by the write and arm stops), and a finiteness re-check (`foldConstNode` already
refuses a non-integer). No equivalent survivor remains.

## measure-pair (both lanes, base `pine-dsk-mpbase` switched to M inside the same hl job)

`hl dsk-w4t2-big`: `measure-pair.sh mp0 tip:pine-dsk-w4t2 base:pine-dsk-mpbase 0 1`, then `… 1 1`.
`== side tip 29e61f317f` / `== side base 5d95103c8a` on both lanes.

| lane | C18 `out-*.json` | C18 `probe-*.json` | harness TOTAL (tip = base) | census diffs |
|---|---|---|---|---|
| 0 (production) | 0 diffs (only `ms` timing) | identical | 336: MATCH 93 · DIVERGE 103 · INCONCLUSIVE 140; `verdicts.json` identical | 0 / 967 |
| 1 (runtime-on) | 0 diffs (only `ms` timing) | identical | 336: MATCH 111 · DIVERGE 107 · INCONCLUSIVE 118; `verdicts.json` identical | 6 / 967 |

Runtime-on census diffs, all INTENDED (a runtime-lane wall that was a `simple` fold is gone; no row
attaches or detaches at step 0; no host-lane row moves):
- `builtin:relative-strength-index__RSI`: `runtime:conditional-history`@42 and @43 gone (the
  `var enableMA` test is invariant now); next wall is T4's `?:` arm @76/@86, as the spec predicted.
- `committed:volatility-coil-edge-bullbyte`: first wall `runtime:history-dynamic-offset`@367 gone;
  next walls are the existing text-state/statement ones (stuck now `no-progress` at the peel of @662).
- `reference:supertrend-cluster-zeiierman`: `runtime:history-dynamic-offset`@140 gone; the rest
  (@131-137, arrays @192-194) unchanged.
- `reference:volatility-regimes-gainzalgo`: `runtime:history-dynamic-offset`@213 gone.
- `committed:multi-timeframe-trend-indicator`, `committed:zigzag-multi-time-frame-with-fibonacci-
  retracement`: after the same peel steps the remaining program now builds (the later
  `pine:input-kind` / `pine:function` / `history-expression` / `runtime:no-output` steps were reached
  only because a simple length refused). Peel-step artefacts; step-0 walls unchanged.
- Spec rows not moved: `range-filter-bs-signals` is not in this desktop sample; `luxy-super-duper-…`
  unchanged (its wall is not a root simple name).
- Stage-1 script `adx-and-di-for-v4`: no census, C18 or harness diff on either lane.

## Final tip

`final-tip.sh pine-dsk-w4t2 dsk-w4t2/final tests/test_script_engine_version_gate.py` on `29e61f317f`:
gate pytest 46 passed; `test_script_engine_version_gate.py` 6 passed; hygiene clean; vitest
chart+hooks `Test Files 3 failed | 1332 passed | 27 skipped (1362)`, `Tests 3 failed | 22393 passed |
118 skipped (22514)`. Failures: `pollingSites.rail` (known baseline) and the two `volume-profile` pins
above, which this branch then updated (wall moved, intended). Desktop baseline (`runs/dsk-baseline`,
master): `Tests 1 failed | 22360 passed | 118 skipped (22479)` (`pollingSites.rail`).
**Final tree `ce5c4bf34b`** (engine + pins; the next commit only fills this paragraph):
`final-tip.sh pine-dsk-w4t2 dsk-w4t2/final2 tests/test_script_engine_version_gate.py`: gate pytest 46
passed; `test_script_engine_version_gate.py` 6 passed; hygiene clean; vitest chart+hooks
`Test Files 1 failed | 1334 passed | 27 skipped (1362)`, `Tests 1 failed | 22395 passed | 118 skipped
(22514)`; the one failure is `pollingSites.rail` (known baseline, also red on the desktop baseline).
Logs `runs/dsk-w4t2/final2/`.

## Open items

- Numeric inputs fold at the AUTHOR'S default in lengths and offsets (the owner's 2026-08-11 rule);
  the spec's "changes with the member's input" holds for text inputs and timeframe tests only. A
  member who changes a numeric length still gets the default ring, as on master.
- Not served (refuse as before): writes in loops or `switch`, `/`/`%` quotients (T17), simple values
  inside function bodies (call-time value; needs per-call-site folding) and text-valued simple slots
  (T3).
- Engine bump needed: **yes** (refusals become served values on the runtime lane). C18 door unchanged.
