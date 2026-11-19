# S14: an exception is never a statement shape (robustness, engine 84)

Coordinator's approval: S14 ROBUSTNESS, 2026-11-18. An exception must never be labelled `runtime:statement`. Relabel
it `runtime:lower` with a true sentence, then fix each case by its root cause, one at a time. This PR is the relabel.
Each root cause is its own PR after it.

## What changed

`pineRuntimeFrontend.js::fail` answers every refusal of a runtime-lane build. Before this change, anything thrown that
was not one of the three refusal classes (`RuntimeRefusal`, `PineRefusal`, `TableRefusal`) was given
`runtime:statement`, "a statement shape this front end does not recognise". That sentence describes the script, but
it was said about failures inside the engine. Now any such exception is `runtime:lower`, which is the guard
`runtimeColumns.js` already gives a lowering that throws. The sentence depends on what was thrown:

- **A defect**: a JavaScript error (`TypeError`, `RangeError`, ...), a plain `Error`, a thrown non-error, or an
  `IrError` (the program this lane built breaks the IR's own check). The message is
  "this lane failed inside the engine while building the script (an engine defect, not a shape it refuses by name),
  so none of it runs here", followed by what was thrown.
- **An engine module's named error** (`ColourError`, `ExpansionRefusal`, ...): its own message already describes the
  script ("not a colour this engine can read"), so it is kept unchanged.

A real refusal keeps its own guard and sentence. `runtime:lower` sits in the same member-facing family as
`runtime:statement` (`editorStatus.js`, "A Pine construct we do not run yet"). In the parity roadmap it belongs to the
robustness unit, not the statements unit.

## Blast radius (the 679-script coverage-map sample, before and after, every wall peeled)

The measurement used the master front end and the relabelled one, in memory, over the same sources, with up to eight
walls peeled per script. The probe ran under the heavy lock.

- **Builds that change: 0.** Every script whose answer moves was refused before and is refused now.
- **10 scripts, 13 walls move from `runtime:statement` to `runtime:lower`.** Only one script's first wall moves
  (`committed:smarter-snr`).
- No other wall moves, and each script's peel takes the same path (only the guard named in "stuck:<guard>" differs).

The 13 walls fall into three root causes. These make up S14's fix queue:

| root cause | walls | scripts |
|---|---:|---|
| A function nothing calls has a site its state lives at (a carried built-in, or a variable's history). The site is numbered relative to the function's own frame, but the IR's check reads it against the whole program's table, and with no call site there is nothing in that table. (`carried site 0 outside 0`, `history over a variable must name the HISTORY slot`) | 6 | builtin:advance-decline-line, builtin:relative-strength-index (`_inRange`), committed:trend-line-harrybot, reference:support-and-resistance, reference:thelark-lma-v2-laguerre, reference:trendlines-jd |
| A recursion with no floor (`Maximum call stack size exceeded`) | 5 | committed:market-sessions-and-volume-profile-by-leviathan, committed:volume-open-interest-footprint-by-leviathan (2), reference:fibonacci-extention-retracment-pivot-points-by-dgt (2) |
| A parse node mistaken for a canonical one: `fromCanonical` reads a caller's own `x[k]` inside a built tree as a canonical offset and loses its operand (`Cannot read properties of undefined (reading 'type')`). Minimal case: `ta.highestbars(high[2], n)` with a length known only while the bar runs | 2 | committed:smarter-snr |

The sample's other `runtime:lower` walls (`READ_HIST_SLOT reads x[k] but its ring was planned for depth d`) were
already `runtime:lower` before this change. They belong to the history-buffer work.

## Rails and mutants

`runtime/__tests__/engineFaultLabel.test.js` covers:

- A fault injected at the build's first step, one per kind (a `TypeError`, a `RangeError`, a plain `Error`, a thrown
  string, a `ColourError`).
- Two real cases end to end: the uncalled-helper IR defect, and an unreadable colour literal that keeps its sentence
  and its statement's position.
- Controls: a statement-shape `RuntimeRefusal` stays `runtime:statement`, a `PineRefusal` keeps its `pine:` guard,
  and a source with no injected fault builds.

Mutants F1-F5 are in `ci/mutants/s14-engine-fault-label.json`. Each was made on a saved copy, watched turn its rail
red, and then restored from that copy and confirmed byte-equal (never `git checkout`).
