# U-LOOP: a `for … in` over an untyped parameter is typed by its call site (engine 84)

Coordinator's order item 3: type the `?:` of two arrays from the call site's argument types (the User Manual's
"inherits the same type as its specified argument"), plus engine 69's live-list rule for `array.remove` inside a
`for … in`. The coordinator later narrowed the scope to collections only; the objects' ground is excluded.

## The rule

The Pine v6 User Manual, *User-defined functions* > *Declaring parameter types*, says: "If a function parameter does
not have a type keyword in its declaration, its type is initially undefined. In each separate call to the function,
the parameter automatically inherits the same type as its specified argument."

## The wall

The runtime lane walks `for x in a` once it knows that `a` is an array (`lowerForIn`). An untyped parameter has no
type in the shared frame of a function body, so `f(a) => for x in a …` was refused at every call with "the type of
`a` cannot be told". The same happened when `a` was a tuple element from a user call (`[top, btm] = f(…)`): the
destructured names were declared with no type. `reference:order-block-detector-luxalgo` combines both: its arrays
come out of a function as a tuple, and its walk is `for element in (bull ? ob_btm : ob_top)` with `array.remove` on
both arrays inside. `runtime:loop` is its only wall.

## The change (`pineRuntimeFrontend.js`)

- **The walk's refusal names the function's untyped parameters** (`typeParams`) when the walk sits in a function
  body.
- **A call site compiles its own copy** (`typeSpecialisation`, beside `colourSpecialisation`, using the C35 / TC
  compile step) when its arguments give those parameters a COLLECTION type (`exprType`: an array, a map or a matrix,
  with its element). The copy is keyed by the types, so two call sites with two element types get two copies, and
  each call site keeps its own persistent locals. A copy that refuses again keeps that refusal. Nothing is compiled
  inside a request's value or at the object door.
- **`[a, b] = f(…)` over a function that returns its own slots** (`[top, btm]`): each name takes that slot's
  COLLECTION type. The values are those slots' values, and a collection is the same object.
- ⛔ **Not typed:** a record (a user type). What a record reads is the object lane's ground. Such a parameter or tuple
  element stays as the shared body has it.

The walk itself is unchanged. It is engine 69's live list (IMP-1, witnessed by `vw-forin-collections-2`, with
`array.remove` among the mutations).

## Rails and mutants

`runtime/__tests__/forInParamTypes.test.js` checks that each walk equals the same walk written at the top level, bar
for bar:

- the order-block-detector shape: two arrays and a `?:` choosing which to walk, with `array.remove` on both inside,
  run through an untyped helper. The walk removes on some bars and not on others;
- a plain walk over an untyped array parameter;
- two call sites with two element types, which compile two copies;
- a walk over `[bt, bb] = coords(…)`, and those arrays handed to the walking helper. The walk removes on some bars,
  and equals the top-level walk over the destructured arrays;
- ⛔ an argument whose type cannot be told keeps the refusal, by name.

Mutants L1-L4 are in `ci/mutants/uloop-forin-param-types.json`. Each was made on a saved copy, watched turn its rail
red, and then restored from that copy and confirmed byte-equal.

## Blast radius (the 679-script coverage-map sample, every wall peeled, under the heavy lock)

Measured on master (cf06117f98) and again on this branch:

- **One script is freed: `reference:order-block-detector-luxalgo`.** `runtime:loop` was its only wall. It now builds
  at step 0 on the runtime lane. It is not host-clean, so the host lane does not draw it today.
- **3 more scripts move, all still refused at the same first wall:**
  - `committed:ai-supertrend-x-pivot-percentile-strategy-presenttrading` (first wall `pine:request`): its
    `runtime:loop` wall gives way to `runtime:call-windowed-state`.
  - `committed:multi-timeframe-supply-demand-zones` (first wall `runtime:request`): `runtime:loop`,
    `runtime:function` and `runtime:expression-statement` give way to `runtime:conditional-history` and
    `pine:bool-na-unwitnessed`.
  - `committed:auto-trendlines-tradingfinder-support-resistance-signal-alerts` (first wall `runtime:library`): the
    peel now meets `runtime:object-op` where it met `runtime:call-undeclared-builtin-state`.
- No other wall moves. With the narrowing to collections, nothing on the objects' ground moves: the record typing an
  earlier draft carried had moved `committed:volumized-order-blocks-flux-charts`' first wall, and that draft is not
  this one.

## Evidence a capture could add

`reference:order-block-detector-luxalgo` has no committed capture, so no capture grades its runtime drawing. The
construct it needs is backed by the Manual sentence above and by engine 69's witnessed live list. A capture of that
script on NYSE:RDDT 1D and AMEX:SPY 1D would grade the whole drawing. It is suggested as a queue row and not added
here.
