# Capture queue: W6-T6 `for … in` on the runtime lane (2026-11-06)

Every row names the refusal it keeps (`runtime:loop`, sentence in quotes) until its capture MATCHes.
The served half needs no capture: it is graded against `vw-forin-collections-rddt-1d-2026-10-01`
(`vendorHarness.w6ForInRuntime.test.js`, every row on every bar and every object).

| id | probe | symbol / tf | refusal kept | unblocks | owner |
|---|---|---|---|---|---|
| Q-W6T6-G (grade only) | `vw-forin-collections-2-rddt-1d-2026-10-02` (captured: G01-G07, S01-S04, P01) | `NYSE:RDDT 1D` | "the body changes `x`, the list it walks, by more than push / shift / set" (host `forInRefused`, the same sentence from `forInRule.js`) | `remove` / `pop` / `unshift` / `insert` / `clear` / a reassignment / a helper handed the list | a lane that grades it. Today the harness reads it INCONCLUSIVE because the member door refuses the probe's reassignment (`pine:reassign`); the rule table is one entry (`FOR_IN_LIVE_WITNESSED`) once graded |
| Q-W6T6-A | `vw-w6-forin-alias.pine` (to write): `b = a` then `for x in a` with `array.remove(b, 0)` in the body; and a DIFFERENT list of the same type changed by `remove` in the body | `NYSE:RDDT 1D` | "the body changes `b`, which may be `a`, by more than push / shift / set" | a same-typed list the body changes by an unwitnessed member (today refused whether or not it is the walked list: this lane cannot prove two names hold different arrays) | after Q-W6T6-G; the alias half follows from Pine's reference semantics once G is graded, the distinct half needs a "provably distinct" rule, not a capture |
| W6-F1 (W6-BREAKDOWN §5) | `vw-w6-forin-runtime.pine` | `NYSE:RDDT 1D` | "inside a function body, …"; "the value of a `for … in` loop …"; "`polyline.all` is not yet captured"; "a walk over a matrix / map …" (here first refused at the matrix / map creation, `runtime:array`); "the body writes the loop variable `x` or through it"; "the body hands the element `x` to a function that may write through it" | per-call-site walks and a loop's value; the `polyline.all` snapshot; matrix (rows) and map (`[k, v]`) walks; write-through and loop-variable writes | T6 follow-ups (T7 / T8 for matrix / map) |
| object door | none: measure-pair | — | `runtime:object-door` "a `for … in` loop is served on the runtime pane only …" | the C18 door serving `for … in` | a follow-up that shows 0 C18 diffs with the door gate lifted |

Not a capture row: a `for … in` whose collection is not a name (`for x in array.from(…)`, `for x in f()`) refuses
"the walked collection is not a name or `<family>.all`"; widening it is a lowering change (the snapshot / live rule
is the same: a call result has no other name to change it through).
