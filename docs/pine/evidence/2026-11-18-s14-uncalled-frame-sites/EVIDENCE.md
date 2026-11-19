# S14 fix 1: a helper nothing calls no longer fails the program (engine 84)

This is the first root cause on S14's queue (`docs/pine/evidence/2026-11-18-s14-engine-fault-label/EVIDENCE.md`). It
covers 6 of the 13 walls the relabel moved. The branch is stacked on #1956 (the relabel) and merges after it.

## The defect

A function body keeps four kinds of state, and each one lives per call site:

| state | example | where it lives |
|---|---|---|
| a carried built-in | `ta.barssince` | `carriedBase` + the body's own index |
| a two-input carried built-in | `ta.valuewhen` | `carried2Base` + the body's own index |
| a window | `ta.highest` | `windowBase` + the body's own index |
| a variable's history ring | `y[1]` | `historyBase` + the body's own index |

The front end numbers each of these sites inside the function's own frame. At the end of the build it gives every
call site its own block in the program's tables: `carried`, `carried2`, `windows` and `history`.

Two checks read a body's index against the WHOLE table instead:

- the IR check, `ir.js::validateIr`;
- the bytecode verifier, `program.js::validateProgram`.

A function nothing calls has no block in the whole table, so its body failed the entire program:

- `carried site 0 outside 0`
- `history over a variable must name the HISTORY slot`
- `window site 0 outside 0`
- `READ_HIST_SLOT 1 outside 1`

Until #1956 this read as `runtime:statement`; #1956 relabels it `runtime:lower`, an engine defect. Six scripts in the
coverage sample hit it:

- builtin:advance-decline-line
- builtin:relative-strength-index (`_inRange`)
- committed:trend-line-harrybot
- reference:support-and-resistance
- reference:thelark-lma-v2-laguerre
- reference:trendlines-jd

For a called function the old check passed by coincidence: its operand was compared with an unrelated main-program
entry.

## The rule

TradingView never runs a function nothing calls, so a script with one is the same script without it. This is railed
bar for bar.

## The fix

Both checks now read a body's index against that function's own count. In a body:

- **The IR check:** `frameBound` uses `carriedCount`, `carried2Count`, `windowCount` and `historyCount`.
  `carried2Count` is new on the function record. A hand-built record that states no count keeps the whole-table check.
- **Each call site's block** is checked against its table (base + count <= length), in the `callSites` loop.
- **The bytecode verifier:** a frame-relative operand (CARRIED, CARRIED2, WINDOW, READ_HIST_SLOT, READ_HIST_SLOT_DYN)
  is bounded by the largest frame's count as well as by the table, the same way LOCAL and PERSIST already are.
  - Each instance's own rule is now checked over its table, where every call site's instance is: a carried length of
    at least 1, an occurrence index of at least 0, a window span of at least 1.
  - Before, that rule was checked at the operand, which read the wrong entry inside a body.
- **Not touched:** the verifier's main-frame depth check for READ_HIST_SLOT (`mainEntry`). That is the S4 owner's
  (#1917).

## Blast radius (the 679-script coverage-map sample, every wall peeled, under the heavy lock)

The sample was measured on #1956 (the relabel) and again on this branch:

- **First walls that change: 0.** No script in the sample changes what it serves. Every script below is still refused
  at an earlier wall.
- **6 scripts lose their `runtime:lower` wall**, and each now builds once its other walls are peeled: the six named
  above. No other wall moves.

## Rails and mutants

`runtime/__tests__/uncalledHelperState.test.js`:

- An uncalled helper holding each kind of state, and all four at once, builds. Every output matches the script
  without the helper, bar for bar. Each case is run twice: beside a body that keeps state, and beside a body that
  keeps none (where the main tables are empty).
- Controls:
  - One helper called at two sites is two recurrences, each equal to the same built-in at the top level.
  - A called helper beside an uncalled one still computes.
- The checks can still fail:
  - a body's site past its function's own count;
  - a call site's block past the table;
  - a carried instance with no length;
  - a CARRIED or READ_HIST_SLOT operand past every frame and the table.

Re-pinned:

- `ast/v3SelfDeclaration.test.js`: three uncalled-helper rows are now `OK` at the runtime door.
- `runtime/__tests__/engineFaultLabel.test.js`: its end-to-end real defect moves to the next one on the queue (the
  parse offset that `fromCanonical` mistakes for a canonical one). It also gains an injected `IrError` case, so the
  relabel's mutant F4 still has a rail.

Mutants G1-G8 are in `ci/mutants/s14-fix1-frame-sites.json`. Each was made on a saved copy, watched turn its rail red,
and then restored from that copy and confirmed byte-equal (never `git checkout`).
