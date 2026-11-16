# imp: loops and imperative statements on the runtime lane (coverage unit, 2026-11-16)

Branch `feat/pine-coverage-imperative`, off `origin/master` @ `e9807547d0` (engine 61). Engine number:
NOT bumped; one `NUMBER PENDING` history line in `scriptEngineVersion.js` (the landing train numbers it).
The runtime lane stays dark for members; nothing is armed.

## What changed (slice 1, `runtime:loop:for-in`)
- `ast/forInRule.js`: `FOR_IN_LIVE_WITNESSED_RUNTIME` (push, shift, set, remove, pop, unshift, insert,
  clear); `bodyMayWriteList` takes two options the runtime lane passes and the host lane does not:
  `reassignKeepsWalk` (G06) and `followHelpers` (G07: a helper handed the list itself counts only by what it
  does to the parameter it fills, under the same rule, at any depth). `forInMutationRefusal(src, allowed)`
  names the lane's own set; the host lane's sentence is unchanged (default argument).
- `ast/pineRuntimeFrontend.js::lowerForIn`: reads the runtime set and both options; the function-body
  refusal is gone (a walk in a function body lowers to the same counted `for` this lane already runs in a
  function body); handing the element to a function that writes its FIELDS is served
  (`forInFnWritesField` with `fieldWritesServed`: a function that changes a list the element HOLDS still
  refuses, by the same sentence).
- The host object lane (`pineObjects.js`) is untouched: it keeps C48's three members.

## Witnesses
- The Pine v6 reference, `for...in`, Remarks: "Scripts can modify the sizes of arrays and matrices while
  iterating over their contents with a `for...in` loop." The User Manual, Loops, `for…in`: "Scripts can
  modify the sizes of arrays and matrices directly within a for…in loop's local scope." and, when the loop
  changes the size of the collection, "the loop's header uses the updated size to control subsequent
  iterations".
- The capture `vw-forin-collections-2-rddt-1d-2026-10-02` (committed, NYSE:RDDT 1D from the listing),
  G01-G07: remove 3, pop 3, unshift 7, insert 7, clear 1, reassignment 5, helper 3 passes. Graded on no lane
  before this branch. Rail: `__tests__/vendorHarness/vendorHarness.impForInGRows.test.js` (every G-row and
  the control on every captured bar, through the runtime lane; the copy model and the re-read-the-name model
  are written out and must differ).
- A `for … in` inside a function body: the reference's own `for...in` examples iterate a parameter list
  inside a user function (`numGreaterThan(array<float> id, float value)`, `elementWiseAdd`). The
  script-level capture: SEE "Harness" below.
- A field written through an element handed to a function: a record is a reference
  (`runtime/records.js`); the script-level capture: SEE "Harness" below.

## Still refused by name (queue rows)
- `reverse` / `sort` / `fill` / `concat` of the walked list: Q-IMP-R, probe `vw-imp-forin-reorder.pine`
  (`docs/pine/capture-queue-2026-11-16-imp.md`).
- A write to the loop variable (a Pine compile error: the reference, `for...in`, "The loop cannot modify this
  variable using reassignment or compound assignment operators"), or directly through it (`x.f := …`):
  W6-F1, probe `vw-w6-forin-write-through.pine` (already written, not captured).
- A change of a list the element holds; the value of a `for … in`; `polyline.all`; matrix and map walks:
  W6-F1 / Q-W6T6-H rows, unchanged.
- The v6 unmatched `bool` block (`runtime:block-value`, builtin Volatility stop and five more): gate
  `V6_BOOL_UNMATCHED_CAPTURED` kept shut (coordinator, 2026-11-16). Probes for the capture session:
  `vw-wsa-v6-bool-unmatched.pine` (Q-A3, chart now named NYSE:RDDT 1D) and the tuple half
  `vw-wsa-v6-bool-unmatched-tuple.pine` (Q-IMP-A3T).
