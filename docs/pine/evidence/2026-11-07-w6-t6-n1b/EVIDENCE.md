# W6-T6-N1b: a held list reached INDIRECTLY refuses by name (2026-11-07)

Base: origin/master `7304620153` (PR #911, engine 29). Branch `fix/pine-w6-t6-n1b-indirect`.
Source: review `W6-T6.md` note N1b. Light phase only: no heavy lock, no mutate.py, no measure-pair,
no final-tip. `SCRIPT_ENGINE_VERSION` untouched.

## What changed

- `ast/forInRule.js`: ONE rule, `heldListReach(list, elem, rule)`, answers "may this walk's body
  change a list the element holds?" with `null` or `{ via }`. `forInHeldListRefusal(elem, via)` keeps
  N1's sentence when `via` is null (a dotted write through the element) and gives the same sentence
  family for an indirect route: "the body changes a list the element `q` may hold (<via>), not yet
  captured (W6-F1)". The routes it covers:
  - **direct**: a mutating member on a path rooted at `elem` (N1, unchanged sentence);
  - **alias** (shape b): a name bound through any chain of re-assignments (`=`, `:=`, tuples,
    `o.f := …`) to an expression that names `elem`, except a NEW array (`array.new*`, `array.from`,
    `array.copy`; NOT `x.copy()`, a shallow record copy whose fields are the same lists);
  - **a function handed it** (shape a): `fnEffects` reads, per user function, which parameters it
    changes: directly, through a local alias, by handing it on to another user function (helpers of
    helpers), or by storing it into an outer name with `:=`. Methods (the receiver is parameter 0),
    named arguments, and overloaded names (every parameter, as the body is picked by type) are covered.
    It also reads which outer lists a function changes by name;
  - **a list of a type the element holds**, conservative: a list bound BEFORE the walk may be the same
    array, and no name ties it to `elem`. The lane supplies `mayBeHeld(name)` from its own typing: the
    element's record type holds (through fields, at any depth) a list of that type, or the name cannot
    be typed. A body-local name is followed through its plain re-assignment chain. Off (`null`) when
    the element holds no list, so walks over numbers, text and drawings are unaffected.
  `heldListMutation` is now derived from the shared `listMutationTarget` (the runtime lane's `forInFnWritesField`
  reader keeps working); no second copy of the rule.
- `ast/pineRuntimeFrontend.js`: `forInChangesHeldList` is removed. `lowerForIn` calls `heldListReach` once,
  after the existing "hands the element" check (`forInHandsOn` keeps its own sentence) and before the
  walked-list alias check (so N1's direct sentence still comes first). `forInHeldKeys(srcTy.elem)` gives
  the held list types.
- `docs/pine/capture-queue-2026-11-06-w6-t6.md`: row Q-W6T6-H now names `heldListReach`, plus two N1b rows
  (shape a, shape b), each with the probe source it needs.

## Rails (`runtime/__tests__/w6ForIn.test.js`, new `it` "(review N1b)")

- Shape a refuses, exact sentence: `bump(q.arr)`, `q.arr.bumpm()`, `bumpm(q.arr)` (method), `viaLocal(q.arr)`
  (local alias inside the function), `outer(q.arr)` (helper of a helper), `named(1.0, into = q.arr)`,
  `bump(q.copy().arr)`, and `grab(q)` where `grab` changes `z.arr` through a local alias.
- Shape b refuses, exact sentence: `a = q.arr` + `array.push(a, …)`; a chain `a = q.arr`, `b = a`,
  `b.push(…)`; `r = q` + `array.set(r.arr, …)`; an outer `g := q.arr` + `array.push(g, …)`; an alias handed
  to `bump`; and a same-typed list bound before the walk (conservative, by type).
- Controls that SERVE: a non-held list (`array<string>`) handed to a function that changes it (value
  checked: size N); a NEW array of the held type handed to `bump`; an alias chain to an unrelated list
  (value checked); a number walk whose body hands another list to a mutating function (value 2N).
  Note: this lane types int and float as one type (`num`), so the unrelated list in the controls is text.

## Runs (node 20.20.2, `--maxWorkers=1`)

- Targeted: `w6ForIn.test.js` 18/18; with `vendorHarness.{w6ForInRuntime,c40ForIn,c48ForIn}` 38/38.
- Full `engine/ast` + `engine/runtime`: 509 files, 8114 tests: **8097 passed, 11 skipped, 6 failed**. All 6
  are `Test timed out in 15000ms` load timeouts: five in `*.measure` files (objectLaneCensus x2, guardProbe,
  objectLaneCallSites, objectLaneDrawerCensus) and `ast/pineStrictCensus.test.js` (a corpus census without
  the `.measure` suffix). Rerun alone with `--testTimeout=120000`, it passes (1/1, 11.3 s). No assertion failure.

## Hand mutations (copy, mutate, run `w6ForIn.test.js`, restore by copy, `cmp`)

| id | mutation | result | restore |
|---|---|---|---|
| M1 | alias route removed in `heldListReach` | killed (1 failed) | cmp equal |
| M2 | `fnEffects` never records a changed parameter | killed | cmp equal |
| M3 | no alias closure (`roots = {elem}`) | killed | cmp equal |
| M4 | FE `mayBeHeld` always false (type route off) | killed | cmp equal |
| M5 | plain re-assignment chain not followed (always held) | killed | cmp equal |
| M6 | `isFreshRhs` always false | killed | cmp equal |
| M7 | a helper's parameter handed on is not tracked (nested helper) | killed | cmp equal |

Control after restore: the targeted 4 files 38/38 green.

## Limits (refused conservatively or out of scope)

- (superseded by r1) A same-typed list that is provably NOT held still refuses when the element's type holds
  a list of that type.
- The host object lane (`pineObjects.js`) is unchanged; it does not serve held-list writes via this rule.

## r1 (review W6-T6-N1b NO-GO @64acd1ddc8: B1 type route, B2 body-local refusal, N sentence unpinned)

Both N1b shapes (handed to a function, alias chain) are kept unchanged.

- **Removed**: the type route (`typedHeld`, FE `mayBeHeld` / `forInHeldKeys`) and the untyped body-local refusal.
  Whether a list is refused no longer depends on its declared or inferred type.
- **Reach** (`forInRule.js::walkedElementReach(stmts, src, rule)`, passed to `heldListReach` as `outerReach`): a
  script-wide fixpoint (function definitions are excluded; their bodies are read per call by `fnEffects`):
  - `lists` holds `src`, plain aliases of it, `array.slice` / `array.copy` / `.slice()` / `.copy()` of it (a copy
    holds the SAME records), and any list a carried value is pushed into (the "through a collection" case);
  - `reach` holds every `for x in src` element; any name bound to an element read of a `lists` name (`get`,
    `first`, `last`, `pop`, `shift`, `remove`); names forward-derived from a `reach` name; and, BACKWARD, the
    names a carried place stores: a mutator argument on a carried list (`array.push(qs, Q.new(1.0, vals))`), the
    right-hand side of a carried binding or field write (`q0 = Q.new(…, vals)` where `q0` is carried). Only plain
    names and constructor / user-call arguments count as stored. Arithmetic stores nothing, so an accumulator
    `array.set(acc, k, array.get(acc, k) + q.v)` never joins;
  - ⛔ undecidable, so assumed reached (comment in code): a binding that calls a user function whose body
    (or a callee's) names a carried value (returned from a user function); a list a carried value is pushed into.
  - A NEW array (`array.new*`, `array.from`, `array.copy(<not a walked list>)`) is never reached.
- H1 (inferred `var vals`) and H2 (declared `var array<float> vals`, also `float[]`) now answer the same: REFUSED
  "through `vals`, an alias of it". VF1 / VF2 / D6 (accumulators over records that hold a float list) SERVE.

Rails (`w6ForIn.test.js`, 20/20):
- pinned sentence: three literal strings (handed-to, alias, N1 direct). The reviewer's R6 ("may hold" changed
  to "holds") is now killed (X9);
- new `it` "(review N1b r1) REACH, not type": H1/H2/`float[]` refuse alike; backward through a bound record;
  H5 (`pre = array.get(qs, 0).arr`); alias of the walked list + method read + forward chain; returned from a user
  function; passed through another collection. Controls that SERVE: VF1 (value checked, 6N), VF2 block-local,
  D6 `array<int>`, body-local `t = mk()` (unrelated user function), body-local slice of an unrelated list, an
  `array.copy` of a held list made outside the walk, a same-typed unreached list handed to a mutating function.

Runs (node 20.20.2, `--maxWorkers=1`): targeted 20/20. Full `engine/ast` + `engine/runtime`: 509 files, 8116
tests, **8100 passed, 11 skipped, 5 failed**, all `Test timed out in 15000ms` in `*.measure` files (guardProbe,
objectLaneCallSites, objectLaneCensus x2, objectLaneDrawerCensus). No assertion failed.

Hand mutations r1 (copy, mutate, run `w6ForIn.test.js`, restore by copy, `cmp` equal each time):

| id | mutation | result |
|---|---|---|
| X0 | control (identity substitution) | 20/20 green |
| X1 | a value stored into the walked list is not carried | killed |
| X2 | backward through a carried binding off | killed |
| X3 | element reads of the walked list off | killed |
| X4 | "returned from a user function" off | killed |
| X5 | "through a collection" off | killed |
| X6 | FE passes no `outerReach` | killed |
| X7 | aliases of the walked list off | killed |
| X8 | forward chain outside the walk off | killed |
| X9 | refusal sentence "may hold" changed to "holds" | killed (was the reviewer's surviving R6) |
| X10 | element read over-broad (any method call reads) | killed |
| X11 | NEW arrays outside the walk no longer exempt | killed (a rail was added after it first survived) |

r1 limits: `q.arr.copy()` (the method form on an array receiver, reviewer note N1) still counts as an alias in the
body (`aliasClosure` cannot tell the receiver's type); rare, refused by name. The handed-the-element sentence
(`forInHandsOn`) and `fnEffects` still give two sentences for one question depending on the route (reviewer note).

## r2 (review delta NO-GO @b1303e6bd3: B3, reach still served nine aliases)

B1 and B2 stay closed. Following the coordinator's ruling, reach is no longer chased: **the default is inverted**.

- `forInRule.js::heldListReach` (still ONE rule, one FE call site): while walking records that hold a list, every
  change (any mutating member, the witnessed three included; method forms; a user function or method that changes
  a parameter, or an outer list by name) is allowed ONLY on a list PROVABLY INDEPENDENT of the walked elements.
  Everything else refuses by name: "…may hold (through `t`, not provably independent of it)…", or "…(handed to
  `f`, which changes it)…". A change through the element itself keeps N1's sentence.
- PROVABLY INDEPENDENT (a plain name): every binding of it in the script (outside function definitions, plus any
  `:=` inside one) is `array.new*`, `array.from`, `array.copy`, `x.copy()` (of anything), `na`, or another provably
  independent plain name; AND it is never STORED where a record could hold it: a record constructor's or
  `array.from`'s argument, a field write's value, or a user function that keeps that parameter (`fnStores`:
  constructor / `array.from` / field write / `:=` to an outer name / handed to another storer), through any name
  bound to it (`storeClass`). A read by an `array.*` built-in (first argument, not `array.from`) is not a store.
- NEVER independent: a field path, an element read, a function result, an `if` / `switch` / ternary value, a tuple,
  a slice. The walked list itself stays with the walked-list rule.
- The gate `forInElemHoldsList(srcTy.elem)` (FE): the rule runs only when the element's record type holds a
  collection field at any depth, or a field this lane cannot type. Number, text and drawing walks are unaffected.
- Removed: `walkedElementReach` and its helpers (`readsElementOf`, `storedNames`), and `outerReach`.
- `q.arr.copy()` (old note N1) is now independent and serves.

Rails (`w6ForIn.test.js`, 21/21), new `it` "(review N1b r2) DEFAULT INVERTED":
- each review hole refuses with the exact pinned sentence: X6 (if-expression alias in the body), X8 (switch), X7
  (if-expression before the walk), X10 (returned by a function handed `qs`), X11 (record returned, then its field:
  `p0.arr`), X19 (tuple from a function), X13 (stored by a function), X14 (stored by a function whose result is the
  walked list), X17 (stored in the walked list's own binding); also a global changed by name by a called function,
  a non-independent list handed to a mutating function, a field write that stores it (refused), and a field path
  only ever assigned a NEW list (`st.xs`);
- controls that SERVE: the accumulator VF1 (value 6N); a NEW list handed to a mutating function (value N);
  `q.arr.copy()` pushed (value N); X17's shape with a NEW list in the record; a list read by `array.sum` inside a
  constructor; body-local NEW lists, including a plain alias of one (value 3N).
- r1 rails re-pinned to the r2 sentence. Two r1 controls flip BY DESIGN: a body-local `t = mk()` (function
  result) and `t = array.slice(other, …)` now refuse by name, because neither is provably independent.

Runs (node 20.20.2, `--maxWorkers=1`): targeted 21/21. Full `engine/ast` + `engine/runtime` on the r2 code
before the final `storeClass` simplification: 509 files, 8117 tests, **8106 passed, 11 skipped, 0 failed**. The
final-code run is recorded below.

Corpus (the 25 scripts with a `for … in` in `corpus/committed` + `tests/fixtures/{pine,pine_oos,pine_blind,pine_community}`),
each built alone with `buildRuntimeIr(src, runtimeClockOpts(false))`: tip vs master engine files in the same tree
(`forInRule.js` and `pineRuntimeFrontend.js` swapped to `7304620153`, then restored and `cmp`-checked):
**IDENTICAL 25/25, 0 newly refused**. (A first attempt that ran master from a `git archive` extract showed a
`footprint-iq` difference in an unrelated translator guard; it came from the extract's module resolution and
disappeared with the in-tree swap.) Latent scan by hand of every for-in body that changes a list other than the
walked one: the only walks over records that hold a list are volume-footprint's three `FpBar` accumulators
(`rowSumB/S`, `ctlRowSum`, `mRowSumB/S`), all `array.new<float>(…)`, never stored, so they serve once their
earlier blocker (`runtime:library`) clears; ict-killzones' `l.…` writes are N1-direct (refused on master too). The
other walks (EqualLevels, volTime, ProfComp, Candle, lines, numbers) hold no list, so the rule is off.

Hand mutations r2 (copy, mutate, run `w6ForIn.test.js`, restore by copy, `cmp` equal each time):

| id | mutation | result |
|---|---|---|
| Y0 | control (identity substitution) | 21/21 green |
| Y1 | body target never checked (default not inverted) | killed |
| Y2 | a field path may be independent | killed (after the `st.xs` rail was added; it first survived) |
| Y3 | any binding counts as fresh | killed |
| Y4 | store check off | killed |
| Y5 | a constructor argument is not a store | killed |
| Y6 | `fnStores` off | killed |
| Y7 | a global changed by name in a called function not checked | killed |
| Y8 | a non-independent argument handed to a mutating function not checked | killed |
| Y9 | `x.copy()` not fresh | killed |
| Y10 | every position harmless | killed |
| Y11 | no position harmless | killed (after the `array.sum`-in-constructor control was added; it first survived) |
| Y12 | FE gate always off | killed |
| Y13 | FE gate always on (number walks) | killed |
| Y14 | sentence "may hold" changed to "holds" | killed |

A fifteenth, Y15 (`storeClass`'s backward plain-alias edge off), survived. The edge was redundant, because
`independent(t)` already recurses into the aliased name's own store check, so it was removed rather than railed.

Final-code full run (`engine/ast` + `engine/runtime`, after the `storeClass` simplification): 509 files, 8117 tests,
**8102 passed, 11 skipped, 4 failed**, all `Test timed out in 15000ms` in `*.measure` files (guardProbe,
objectLaneCallSites, objectLaneCensus, objectLaneDrawerCensus). No assertion failed.

## Review GO-WITH-NOTES @a0bc6a6a1d: Z10 rail, heavy phase, master merge

- **Z10 (reviewer note N-A)**: rail added at `9fdacea8c1`: a user function that changes a held list through a LOCAL alias
  (`f() => l = array.get(qs, 0).arr; array.push(l, 1.0)`, called in the walk) refuses "…(through `l`, not provably
  independent of it, changed by `f`)…". The Z10 mutant (`fnEffects.own` true for any binding): hand run 1 failed /
  20 passed (killed), restored by cmp.
- **mutate.py** (programme script, under `dsk/heavy-mut.lock`, RAM gate, 74 s):
  `_resume-2026-11-01/runs/w6-t6-n1b/muts.json` (Y0-Y14 + Z10) over `w6ForIn.test.js` +
  `vendorHarness.w6ForInRuntime.test.js`. **15/15 KILLED; Y0 no-op control SURVIVED (as required)**; tree clean after.
  Log: `runs/w6-t6-n1b/mutate.log`.
- **measure-pair** (`runs/w6-t6-n1b/mpr`, `dsk/heavy-mp2.lock`, RAM gate, 71 min; tip `9fdacea8c1` vs base
  `pine-dsk-mpbase2` detached at the merge-base `7304620153`; HEADs unmoved):
  - runtime 1: out 395 rows 0 differ; probe 69 rows 0 differ; census 967 rows 0 differ; harness IDENTICAL
    (MATCH 112, DIVERGE 107, INCONCLUSIVE 117 both sides).
  - runtime 0: out 395 rows **0 differ**; probe 69 rows 0 differ; harness IDENTICAL (MATCH 93, DIVERGE 103,
    INCONCLUSIVE 140 both sides); census 967 rows, **3 differ**:
    `ai-supertrend…3b9db05a48` (tip `stuck: pine:roundtrip`, base reached), `volatility-coil-edge…604f0fd1c6`
    (`update@842: pine:state` vs `loop@630: pine:timeout`), `mirage-liquidity-sweep…238f0e26eb` (`cell:text@988:
    pine:tuple` vs `pine:timeout`). Two are `pine:timeout` steps. The first was not re-run, but its row carries 19
    `pine:timeout` steps on BOTH sides, the same tip reaches it in runtime 1, and its only `for … in` walks an int
    list, where this lane's rule is gated off (`forInElemHoldsList` false). Attributed to the census time budget
    under load, not to this lane. Not re-measured.
- **Merged origin/master** `d0a29bbf24` (PR #915, engine 30) cleanly as `0f125c5b66`. On the merged tree: rails
  (`w6ForIn` + `vendorHarness.{w6ForInRuntime,c40ForIn,c48ForIn}`) 41/41; full `engine/ast` + `engine/runtime`
  (node 20.20.2, `--maxWorkers=1`) 511 files, 8163 tests, **8148 passed, 11 skipped, 4 failed**, all `Test timed out
  in 15000ms` in `*.measure` files (guardProbe, objectLaneCallSites, objectLaneCensus, objectLaneDrawerCensus);
  service suite `node --test --test-force-exit services/pine_runtime/test/*.test.mjs` (node 24.13.1) **128/128**.
- Not run here: final-tip (the coordinator runs it).
