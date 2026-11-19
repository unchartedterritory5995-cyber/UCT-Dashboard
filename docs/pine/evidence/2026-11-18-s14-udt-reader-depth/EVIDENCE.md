# S14 fix 3: a binding named like a namespace no longer loops the user-type reader (engine NUMBER PENDING)

This is the third and last root cause on S14's queue (`docs/pine/evidence/2026-11-18-s14-engine-fault-label/EVIDENCE.md`).
It covers 5 of the 13 walls the relabel moved. It is stacked on S14 fix 2, fix 1 and #1956.

The code sits next to the objects' user-type reader, but the defect is an engine crash. The coordinator ruled on
2026-11-18 that a crash root cause is S14's to fix and told the objects agent.

## The defect

`udtTypeOf` answers which user type a node holds. It bounds its own walk with a `depth` (24) and passes it along
whenever it recurses. A dotted name is the exception: `udtTypeOf` asks `fieldPathOf`, and `fieldPathOf` asks
`udtTypeOf` about the binding of the name's head, starting again from depth 0.

So when a binding's value reads a path whose head is that same binding, the walk never ends:

    string timeframe = timeframe.isintraday ? "1D" : timeframe.period
    ... timeframe.period ...

Here `timeframe.period` has the head `timeframe`. That head is bound to a value that reads `timeframe.period` again,
and the loop runs until the stack overflows (`Maximum call stack size exceeded`). The sample has 5 such walls:

- `committed:market-sessions-and-volume-profile-by-leviathan` (L336 `utcHour`)
- `committed:volume-open-interest-footprint-by-leviathan` (L124, L140)
- `reference:fibonacci-extention-retracment-pivot-points-by-dgt` (L515, L520)

## The fix

The depth now travels through `fieldPathOf` and back: `fieldPathOf(node, scope, depth)` calls
`udtTypeOf(bound.node, scope, depth + 1)`. At the bound the answer is `null`. That is the right answer, because a
`string` has no fields. The dotted name is therefore not a field path, and it is read as what it is: the built-in
`timeframe.period`.

## The rule, and the rail

Renaming a variable changes nothing else. So each script equals the same script with its variable renamed, bar for
bar.

`runtime/__tests__/udtReaderDepth.test.js` covers three shapes:

- a `string` named `timeframe` read back through `timeframe.period`;
- the market-sessions ternary over `timeframe.isintraday` and `timeframe.period`;
- the path read inside a function body.

Two controls check that a real record field still resolves through a binding: `g = Foo.new(2.5)` then `g.a`, and a
chain `h = g`.

One shape is deliberately not in the rail. `float syminfo = …` followed by `syminfo.mintick` is refused `pine:type` by
name both before and after this fix. That is a separate limitation; that shape never reached the loop.

`runtime/__tests__/engineFaultLabel.test.js` drops its end-to-end real defect, because S14's queue is now empty. Its
injected faults remain the rail for each kind of defect.

Mutants J1 and J2 are in `ci/mutants/s14-fix3-udt-reader-depth.json`. Each drops one hop of the depth. Each was made
on a saved copy, watched turn its rail red, and then restored from that copy and confirmed byte-equal.

## Blast radius (the 679-script coverage-map sample, every wall peeled, under the heavy lock)

Measured on S14 fix 2 and again on this branch:

- **First walls that change: 0, and builds that change: 0.**
- **3 scripts lose their `runtime:lower` (stack overflow) walls, 5 walls in all.** The peel now reaches the walls
  beyond them, each one a refusal by name:
  - `committed:market-sessions-and-volume-profile-by-leviathan`: -1 `runtime:lower`, +1 `pine:function`.
  - `committed:volume-open-interest-footprint-by-leviathan`: -2 `runtime:lower`, +1 `pine:builtin`,
    +1 `runtime:request`.
  - `reference:fibonacci-extention-retracment-pivot-points-by-dgt`: -2 `runtime:lower`,
    +2 `runtime:conditional-history`.
- No other wall moves. With fixes 1-3, none of the 13 walls the relabel moved is left in the sample.
