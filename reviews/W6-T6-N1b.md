VERDICT: NO-GO @b1303e6bd3

Delta re-review of W6-T6-N1b r1. The previous verdict was NO-GO @64acd1ddc8, for B1 (the type route) and B2 (the untyped body-local refusal).
Lane fix/pine-w6-t6-n1b-indirect, tip b1303e6bd3, base master 7304620153 (engine 29), 2 commits.
Reviewer: independent (desktop), 2026-11-07. Same method as before: a detached worktree at the tip and a master
`app/src` extract, both with node_modules junctioned. Each probe is one `buildRuntimeIr` call per script (40 daily
bars, `objectsInRun` + `pane`, tf D), run on both trees. The corpus was run with `runtimeClockOpts(false)`.

## Blocking

B3. The reach rule serves aliases of a held list that it was written to catch. N1b asks that undecidable reach
refuse by name. Each row below SERVES on r1, and on master; none is a regression. Each one changes, during the
walk, a list a walked record holds.
| id | shape | r1 |
|---|---|---|
| X6 | IN THE BODY: `a = if close > open` / `q.arr` / `else` / `other`, then `array.push(a, 1.0)` | SERVED |
| X8 | IN THE BODY: `a = switch` / `close > open => q.arr` / `=> other`, then push `a` | SERVED |
| X7 | before the walk: `pre = if barstate.isfirst` / `array.get(qs, 0).arr` / `else` / `array.new_float()`, push `pre` in the walk | SERVED |
| X10 | `get0(array<Q> xs) => array.get(xs, 0).arr`; `pre = get0(qs)`; push `pre` in the walk | SERVED |
| X11 | `first0(array<Q> xs) => xs.first()`; `p0 = first0(qs)`; `array.push(p0.arr, …)` in the walk | SERVED |
| X19 | `pair(array<Q> xs) => [array.get(xs, 0).arr, 1.0]`; `[pre, z] = pair(qs)`; push `pre` | SERVED |
| X13 | `addQ(array<float> v) => array.push(qs, Q.new(1.0, v))`; `addQ(vals)`; push `vals` in the walk | SERVED |
| X14 | `mk(v) => array.from(Q.new(1.0, v))`; `qs = mk(vals)`; push `vals` | SERVED |
| X17 | `var qs = array.from(Q.new(1.0, vals))`; push `vals` in the walk | SERVED |

Causes, all in `forInRule.js`:
- (a) `bindingsOf` takes a binding's rhs from the HEADER line only. An `if` / `switch` expression's value lives
  in `sub`, so `a = if …` is seen as naming only the condition. This hits the body's `aliasClosure` (X6, X8: this
  is N1b shape b itself, written as an if-expression) and `walkedElementReach` (X7).
- (b) `callsCarryingFn` treats a call as carrying only if the function BODY names a carried global. A function
  HANDED the walked list (`get0(qs)`) is not treated as carrying (X10, X11, X19). The `walkedElementReach`
  docstring says "a user function handed (or naming) a carried value may return or keep it". The handed half is not built.
- (c) `visitStores` scans top-level statements only, and function bodies are filtered out. A function that pushes
  its parameter into the walked list is never seen, nor is a function whose result becomes the walked list (X13, X14).
- (d) The walked list's own binding rhs is never read for what it stores: `add` refuses `src`, and the backward
  rule fires only when the bound name is in `reach` (X17). `var qs = array.from(Q.new(…, vals))` is a plausible way to write this.

Suggested fixes:
- (a) For a binding whose rhs starts with `if` / `switch`, treat the names in its sub-block's value lines as the
  rhs, or refuse such a binding conservatively if it names anything carried.
- (b) In `callsCarryingFn`, also count a call whose arguments mention `lists` or `reach`.
- (c) Apply `fnEffects`-style "stores parameter k into outer list L" to calls at top level.
- (d) Seed the backward rule with the `src` binding's rhs.

Each fix needs a rail per shape and a control that comes out the other way.

## Closed from the previous review

- B1 CLOSED. The type route is gone: no `mayBeHeld`, `forInHeldKeys`, `typedHeld` or "a type it holds" remains.
  The hazard now refuses by reach whatever the declaration style: inferred (X1/H1), declared (X2/H2) and `float[]`
  (X3) all give "…may hold (through `vals`, an alias of it)…". The accumulator repros serve: VF1, VF2, VF3, D6,
  D8, D9, D10, D11, D12, D13, T11. Every one of the 49 over-refusal shapes from the last review now matches master,
  except the ones that should refuse (N1b-a, N1b-b, N1, H5) and T9 (q.arr.copy(), below).
- B2 CLOSED. Unrelated body-local lists serve: T14 `t = mk()` and T15/H4 `array.slice` of an unrelated list. So do S1/S2.
- Reach that is caught correctly, refused by name: a ternary before the walk (X4) and in the body (X5); a `:=`
  reassignment before the walk (X9); a function that names `qs` globally (X12); a record bound first and then
  pushed (X16); the method chain `qs.get(0).arr` (X20); `qs.copy()` then get (X21); the element method
  `q.arrOf()` (X23); `arrOf(q)` (X24). Inconclusive, refused earlier by unrelated guards on both trees: X15 (a field
  write on an expression), X18 (`map` member read), X22 (a loop-variable write).

## q.arr.copy() over-refusal (old N1): a note, not blocking

`t = q.arr.copy()` in the body refuses ("through `t`, an alias of it", X25/T9), although a copied array is
independent. Corpus count: 0.
- Across the 395 scripts in the five corpora, 25 have a `for … in`, and 0 of them call `.copy()` on a path rooted
  at the loop element.
- 4 `.copy()` calls appear in for-in scripts: footprint-iq `HD.gradientLevelsDelta.copy()`; higher-time-frame-fvg
  `formingTrend.copy()` and `formingFVG.copy()`; volume-profile-plus `dist.copy()`. None is reached by a walked element.
- The same over-refusal applies to `pre = array.get(qs, 0).arr.copy()` before the walk; it also has no corpus instances.

## Corpus

The 25 for-in scripts, each run alone with the clock told: first refusal or result IDENTICAL to master, 25/25
(one served on both). The latent case from the last review, volume-footprint, is no longer newly refused: its
accumulator shapes VF1 and VF2 serve.

## Verified

1. N1b shapes a and b refuse by name with the `forInHeldListRefusal` family. The three sentences are now pinned
   literally in the rails (my W7 is killed).
2. One authority: `heldListReach` has one FE call site, fed by `walkedElementReach`, and there is no FE copy. The
   duplicate mutator-target reader `forInUnwitnessedTargets` was already on master (unchanged note).
3. Host lane and object door unchanged. I compared 72 probe sources on tip and master: `translatePine(strict)` ok,
   output count and `forInRefused`; `objectDoor: true`; `objectIterTrees: []`. Result IDENTICAL.
   `pineObjects.js` / `objectLane.js` are untouched.
4. Runs:
   - Full `engine/ast` + `engine/runtime` (vitest, node 20.20.2, `--maxWorkers=1`): 509 files, 8116 tests, 8101 passed,
     11 skipped, 4 failed. All 4 are `Test timed out in 15000ms` in `*.measure` census files (guardProbe,
     objectLaneCallSites, objectLaneCensus, objectLaneDrawerCensus). No assertion failed.
   - `node --test --test-force-exit services/pine_runtime/test/*.test.mjs` (node 24.13.1): 125/125. The tree
     holds 125, not the 128 the brief named, and the lane touches nothing under `services/`.
   - hostParity `--host node --check` (node 24): HP-1 GREEN 166/166. Under node 20 the same check reports
     164/166, with 2 "V8 differs, REPORTED, not gated". That comes from the host, not from the lane.
5. merge-tree against origin/master is clean (tree c8ad005a59). master is an ancestor of the tip.

## Mutations (mine: copy, mutate, run `w6ForIn.test.js`, restore by copy, `cmp` equal, `git status` clean)

| id | mutation | result |
|---|---|---|
| W1 | backward store (a carried name stores its rhs) off | killed |
| W2 | `readsElementOf` route off | killed |
| W3 | a carried value pushed into another list does not make that list carry | killed |
| W4 | `callsCarryingFn` off | killed |
| W5 | a plain-name alias of the walked list not added to `lists` | killed |
| W6 | FE passes `outerReach: []` | killed |
| W7 | via-sentence "may hold" changed to "holds" (old R6) | killed |
| W8 | a NEW array is no longer skipped in `walkedElementReach` | killed |

8/8 killed.

## Notes

- N1 (unchanged, non-blocking): `x.copy()` on an ARRAY receiver is fresh. The receiver's type decides; the corpus count is 0.
- N2: X6/X8 show that the BODY alias closure from the first commit also misses if/switch expressions. Fix (a) covers both readers.
- N3: once B3 is fixed, the lane is GO by everything else checked here.
