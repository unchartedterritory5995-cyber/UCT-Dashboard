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
