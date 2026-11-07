VERDICT: GO-WITH-NOTES @a0bc6a6a1d

Delta re-review of W6-T6-N1b r2. History: NO-GO @64acd1ddc8 (type route), then NO-GO @b1303e6bd3 (nine reach holes).
Lane fix/pine-w6-t6-n1b-indirect, tip a0bc6a6a1d, base master 7304620153 (engine 29), 3 commits.
Reviewer: independent (desktop), 2026-11-07. Same method: a detached worktree at the tip and a master `app/src`
extract, both with node_modules junctioned. Each probe is one `buildRuntimeIr` call per script (40 daily bars,
`objectsInRun` + `pane`, tf D), run on both trees.

r2 inverts the default. While a walk visits records that hold a list, a list may change only if it is PROVABLY
INDEPENDENT. That means every binding is a NEW list (`array.new*`, `array.from`, `array.copy`, `x.copy()`, `na`)
or another independent plain name, and the list is never stored where a record could hold it (`storesAny`). A field
path, an element read, a function result, an if / switch / ternary value, a tuple or a slice is never independent.
The rule is gated on the element type holding a list (`forInElemHoldsList`).

## Blocking

None.

## Notes, to fix before merge or as follow-up

- N-A. A rail is missing for a real route. My Z10 mutation SURVIVED: `fnEffects`'s `own(t)` treated as true for any
  binding. With it, this hazard SERVES:
  `f() => l = array.get(qs, 0).arr; array.push(l, 1.0)`, then `for q in qs` / `f()`.
  The real code REFUSES it ("through `l`, not provably independent of it, changed by `f`"). So the rule is sound and
  only the rail is missing. Add this shape, with a fresh-local control (`l = array.new_float()`, served).
- N-B. Z5 survived (`:=` bindings inside function definitions ignored). It is an equivalent mutant on this lane: a
  function that writes a global with `:=` is refused first by `runtime:unbound` (probe F2), as Pine forbids it. The
  code is defensive and harmless; no rail is possible today.
- N-C. There is a new over-refusal the builder did not list: an outer record field such as a "settings object"
  accumulator, `array.push(st.xs, q.v)`, refuses whatever the type of `xs` (T11, H3 string, Y19). It is conservative
  (a field path is never independent), and the corpus count is 0. Record it in the capture row next to `mk()` and slice.

## 1. Holes closed, and new probes

All nine holes from @b1303e6bd3 now REFUSE by name: X6, X7, X8, X10, X11, X13, X14, X17, X19, each with "…may hold
(through `<name>`, not provably independent of it)…". So do the r1-caught shapes (X4, X5, X9, X12, X16, X20, X21,
X23, X24), the hazards H1/H2/X1-X3 (inferred, declared, `float[]`), H5, and the N1b shapes a and b. X18 (`map` of Q)
was refused earlier by `pine:member` on master; it now refuses on this rule.

New probes I tried:
- REFUSED, correctly:
  - Y3 `r = q.copy()` then `array.push(r.arr, …)` (a shallow record copy);
  - Y4 a record copy's field, aliased;
  - Y5 `vals := q.arr` in the body;
  - Y8 `array.insert(qs, 0, Q.new(1.0, vals))`;
  - Y9 a named constructor argument `Q.new(v = 1.0, arr = vals)`;
  - Y10 `nq = Q.new(1.0, na)`, `nq.arr := vals`, push `nq`;
  - Y11 an alias `w = vals` stored instead of `vals`;
  - Y12 stored through a ternary;
  - Y13 stored through an identity function `id(vals)`;
  - Y18 an accumulator pushed into `qs` inside the walk.
- SERVED, correctly:
  - Y14 `var array<float> acc = na`, then `acc := array.new_float()`;
  - Y15 a fresh-per-bar accumulator;
  - Y16 an accumulator handed to a non-storing function;
  - Y17 `array.concat(out, acc)`;
  - Y21 a fresh body-local list inside an `if`;
  - Y22 an unrelated fresh body-local beside a held global.
- Inconclusive (refused earlier by unrelated guards on both trees): Y6 (a function `:=` to a global,
  `runtime:unbound`), Y7 (a method writing a field, `runtime:function`), X15, X22.

## 2. Is "provably independent" sound?

Yes, by construction and by probe. Nothing derived from an element can be classed independent:
- a field path is never independent;
- a binding from an element read, a call, a ternary, an if / switch or a tuple is not NEW;
- an alias is independent only if what it copies is;
- any name, or an alias of it, that reaches a constructor argument, an `array.from` argument, a field write or a
  storing user function fails `storesAny`.

`isFreshRhs` accepts `x.copy()` on any receiver, including a record. That is safe because a list reached through the
record copy is a field path, which refuses (Y3, Y4).

`array.copy` really copies at runtime: `collections.js` `'array.copy'` returns `a[0].slice()`. A value check
confirms it. The walk `t = q.arr.copy(); t.push(1.0)` (and the same with `array.copy(q.arr)`) leaves the held
list's size at 2 on the last bar (Y1, Y2).

## 3. The new over-refusals are acceptable

- `array.slice`: refusing it is CORRECT, not just conservative. In this runtime a slice is a VIEW
  (`collections.js` C18 `SLICED`), and writes through a slice already throw (`guardSliceWrite`).
- `t = mk()` (a function result) refuses by design: T14, S1, S2, and D13 (`var vals = mk()`).
- Outer field-path accumulators: see N-C.
- Corpus count: I scanned every for-in body in the 25 for-in scripts (395 scripts in five corpora) for mutation
  targets that are not provably fresh or are field paths.
  - Hits: bigbeluga `block`, smc `fvgBox` (the walked list itself, which is the walked-list rule's, not this one's);
    multi-timeframe-supply-demand `SnD_*` (function parameters in a walk over `SnD_Type`, not a list-holding record);
    stop-loss `timeScalingVola.*` fields (a walk over numeric `signVol`, so the gate is off).
  - Slices: 0. Function results: 0. Field paths in list-holding walks: 0.
- The q.arr.copy() over-refusal (old N1) is FIXED: it now serves (T9, X25, Y1).
- Over-refusal shapes from the first review that now serve: the accumulator VF1/VF2/VF3, D1-D12, D14, and T1-T10, T12, T13, T16-T19.

## 4. Corpus

The 25 for-in scripts, each run alone with the clock told: first refusal or result IDENTICAL to master, 25/25.

## 5. Door, host lane, runs

- I compared 95 probe sources on tip and master: host `translatePine(strict)` (ok, output count, `forInRefused`),
  `objectDoor: true`, `objectIterTrees: []`. Result IDENTICAL. `pineObjects.js` and `objectLane.js` are untouched.
- hostParity `--host node --check` (node 24.13.1): HP-1 GREEN 166/166.
- `node --test --test-force-exit services/pine_runtime/test/*.test.mjs` (node 24): 125/125. Nothing under
  `services/` changed; the tree holds 125, not 128.
- Full `engine/ast` + `engine/runtime` (vitest, node 20.20.2, `--maxWorkers=1`): 509 files, 8117 tests, 8102 passed,
  11 skipped, 4 failed. All 4 failures are `Test timed out in 15000ms` in `*.measure` census files (guardProbe,
  objectLaneCallSites, objectLaneCensus, objectLaneDrawerCensus), the same set as at r1. No assertion failed.
- One authority: `heldListReach` has one FE call site and no FE copy. `walkedElementReach` and the type route are gone.

## 6. Mutations and merge

Mine: copy, mutate, run `w6ForIn.test.js` (21 tests), restore by copy, `cmp` equal; `git status` clean after.
| id | mutation | result |
|---|---|---|
| Z1 | a field path may be independent | killed |
| Z2 | `storesAny` never fires | killed |
| Z3 | `harmlessAt` always true (no store ever seen) | killed |
| Z4 | `fnStores` empty | killed |
| Z5 | `:=` inside function definitions ignored | SURVIVED: equivalent on this lane (N-B) |
| Z6 | a name with no binding counts as independent | killed |
| Z7 | any single-token rhs counts as fresh (`a = q.arr`) | killed |
| Z8 | FE `forInElemHoldsList` gate off | killed |
| Z9 | a handed plain-name argument's independence not checked | killed |
| Z10 | `fnEffects.own` true for any binding | SURVIVED: a real hazard serves (N-A) |
| Z11 | a record constructor is not a store | killed |

9/11 killed. merge-tree against origin/master is clean (tree 5dbe7ceb55). master is an ancestor of the tip.
