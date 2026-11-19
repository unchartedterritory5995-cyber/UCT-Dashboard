# S14 fix 2: a caller's own argument inside a built tree stays itself (engine NUMBER PENDING)

This is the second root cause on S14's queue (`docs/pine/evidence/2026-11-18-s14-engine-fault-label/EVIDENCE.md`).
It covers 2 of the 13 walls the relabel moved. It is stacked on S14 fix 1, which is stacked on #1956.

## The defect

Two built-ins are lowered through a canonical tree, `pine.js::PINE_NAMESPACED_TREE`: `ta.highestbars` and
`ta.lowestbars`. For example, `ta.highestbars(src, len)` becomes `-highestbars(src, len)` (`negatedBars`), and the
caller's own `src` and `len` are embedded in that tree as they were parsed. On this lane the tree is used only when
the length is known only while the bar runs; a fixed length is a pure column.

`fromCanonical` converts the tree into this lane's parse shape. It promises that "a parse node passes through
untouched". But the two dialects spell `call` and `offset` with the same `type`, and both were read as canonical:

- **A caller's `high[2]`** (a parse offset `{arg, n}`) was rebuilt from the canonical fields `{args, value}`. It lost
  its operand and threw `Cannot read properties of undefined (reading 'type')`. That is an engine defect, which
  `committed:smarter-snr` hit twice (L77 `ta.highestbars(high[Period], bar_pl1)`, L81 the `lowestbars` twin).
- **A caller's `ta.sma(high, 3)`** (a parse call whose arguments are `{name?, value}` records) had each record wrapped
  again. The result was refused as `pine:statement`, "not a shape the translator reads".

## The fix

The two dialects are now told apart by SHAPE in the cases where they share a `type`:

- A call whose arguments are records, not nodes, is a parse call.
- An offset carrying `arg` or `n` is a parse offset.

Both pass through untouched. The canonical spellings still convert.

The canonical-offset branch (`pivotAtConfirmation`'s shift) has no input that reaches it on this lane today, because
the pivots are lowered before the built tree. It is kept as it was, with no mutant on it, since no rail could kill
one there.

## The rule, and the rail

An argument is its value. So the call over an expression equals the same call over a name bound to that
expression, bar for bar. This lane computes the bound form by a separate path, a slot source.

`runtime/__tests__/canonicalPassthrough.test.js` checks this for:

- `ta.highestbars` and `ta.lowestbars`;
- five sources: `high[2]`, `low[1]`, `ta.sma(high, 3)`, `math.max(high, low[1])` and `(high + low) / 2`;
- two lengths: a fixed 5, and a `var` length the bars move between 2 and 8.

Every case is non-vacuous: it has a real offset on some bars and zero on others. The controls check that the built
tree's own canonical call and canonical `high` / `low` source still convert: the one-argument form equals the
two-argument form.

`runtime/__tests__/engineFaultLabel.test.js` moves its real defect to the next one on the queue (see below).

Mutants H1, H2 and H4 are in `ci/mutants/s14-fix2-canonical-passthrough.json`. Each was made on a saved copy, watched
turn its rail red, and then restored from that copy and confirmed byte-equal.

## Blast radius (the 679-script coverage-map sample, every wall peeled, under the heavy lock)

Measured on S14 fix 1 and again on this branch:

- **Builds that change: 0.** No script in the sample changes what it serves.
- **2 scripts move:**
  - `committed:smarter-snr` loses both `runtime:lower` walls (L77, L81). Its first wall is now
    `runtime:conditional-history`, and it is still refused there.
  - `committed:smoothed-gaussian-trend-filter-algoalpha` loses two `pine:statement` walls. These were the
    double-wrapped call ("not a shape the translator reads"). Its first wall is now `lower-tf:store-unmeasured`, a
    named refusal, and it is still refused.
- No other wall moves.

## What is left on S14's queue

Recursion with no floor: 5 walls in 3 scripts. Its cause is in the user-type reader on the objects' ground.
`udtTypeOf` calls `fieldPathOf`, and `fieldPathOf` calls `udtTypeOf` without passing its depth, so the depth resets.
A binding named like a namespace (`string timeframe = timeframe.period`, then `timeframe.period` read again) therefore
loops until the stack overflows. The coordinator ruled it S14's (an engine crash), and S14 fix 3, stacked next,
settles it.
