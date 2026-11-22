# Input-kind: a `var` text input reads as its default (track 4, 2026-11-22)

Track 4, the input-kind unit, assigned by the coordinator on 2026-11-22. Engine number: NUMBER PENDING (train e95).

This document holds counts and verdicts only. No corpus script is named: the corpus rows are counted, and every
TradingView value stays in the local capture store.

## The defect

A Pine script that declares a text setting with `var`,

    var anchor = input.string(defval = "Session", title = "Anchor Period", options = ["Session", "Week", "Earnings"])

and then reads it as a `switch` subject or an `==` operand (TradingView's VWAP anchor shape, written by two corpus
scripts) was refused on the host lane: `pine:input-kind` at `anchor == "Earnings"` and `pine:block` at `switch anchor`.
The same setting declared without `var` (`anchor = input.string(...)`) was always read, and the runtime lane already
read the `var` form.

A `var` that nothing reassigns holds its initializer on every bar: Pine runs the declaration once, on bar 0, and no
later statement writes it. Read as text, it is the plain binding.

## The change

| part | where |
|---|---|
| A `var` nothing reassigns, whose initializer is an `input.string`, read as text, is that input | `app/src/components/chart/engine/ast/pine.js::Resolver.fixedVarBinding`, asked by `stringValueOf` and `enumInputCallOf` |
| The `var`'s `input.string` is named as its knob, as the plain binding's is | `pine.js::stampVarStringInput` (both declaration sites) |

Limits, each held by a rail:

- Only where the script-wide reassignment scan names no write of the `var` anywhere (`neverReassignedVarSeed`, the
  predicate the plot and paint lanes already share). A `var` reassigned anywhere, above the read or below it, keeps
  its refusal.
- Only where that scan was handed to the Resolver: the runtime frontend's Resolvers are built without it and read
  every `var` exactly as before.
- Only in the readers that return text fixed before bar 0 (`stringValueOf`) or an `input.string` call
  (`enumInputCallOf`). A `var` holding per-bar text (`var t = close > open ? "up" : "down"`) holds bar 0's value, so
  it is never read per bar; it stays refused.
- Only for an `input.string` initializer. A `var` holding a string literal (`var string MODE = "Fixed"`) would read the
  same way, soundly, but 563 corpus scripts declare a `var` with text against the 41 this unit measured, so it is its
  own unit. A first version reached those too, and CI's paint harness caught one committed capture moving refused ->
  refused (`pine:text-value` -> `pine:request`); the scope was narrowed and is now railed.

## What the member sees

Before: the indicator did not draw, and the chart said "this Pine input carries a default the engine grammar cannot
hold" (or that a `switch` "subject is not a value the script fixes").

After: the indicator draws at the setting's default, exactly as it does when the setting is declared without `var`.
The translation reads a member's choice through the `var` as it does through the plain binding (railed); on the chart
pane, for the corpus scripts measured, no control is offered for the setting, the same as for the plain form. No bar
is newly withheld by this unit, and no new refusal is added.

## Rails and mutants

Rails: `app/src/components/chart/engine/ast/varTextInput.test.js` (14 tests): the `var` form and the plain form give
one translation (default and live knob alike) and the same drawn values on the host lane, for a `switch` subject, an
`==` operand and the VWAP anchor shape; the run draws the plain form's values and the host draws the run's; controls
for a reassigned `var` (above and below the read, both lanes), a per-bar-text `var`, a string-literal `var` (the
scope), and a Resolver built without the reassignment scan.

Mutants: `ci/mutants/t4-input-kind-var-text.json`, IK1-IK6, each KILLED locally with a byte-identical restore.

| id | the break | killed by |
|---|---|---|
| IK1 | a `var` nothing reassigns is never its initializer (the defect) | the member door serves it |
| IK2 | a reassigned `var` is read as its initializer too | the reassigned `var` control (reassignment below the read) |
| IK3 | the `var`'s input is not named as its knob | the live-knob translation |
| IK4 | the knob is not followed through the `var` | the live-knob translation |
| IK5 | a Resolver built without the reassignment scan treats every `var` as never reassigned | the Resolver-level rail |
| IK6 | the read reaches a `var` holding a string literal | the scope control |

## Census (41 corpus scripts declaring a `var` `input.string`)

The member door census (`coverageMapDoorCensus.measure.test.js`), master (`b071e3d2cd`) against this branch merged
with it, the same promoted library store.

| lane | served in full | attached (served in full included) | served -> refused |
|---|---|---|---|
| host (runtime off) | 0 -> 2 | 5 -> 8 | 0 |
| runtime on | 0 -> 2 | 10 -> 12 | 0 |

The rows that move lose `pine:input-kind`, `pine:text-value` or `pine:block` at the `var` read; one loses
`pine:plot-offset`, because its offset is chosen by a `var` text setting compared with `==`. Two more refused rows
refuse one wall deeper (`pine:block` -> `pine:state`, `pine:block` -> `pine:request`).

**One row is slower to refuse.** It reads the setting in a long ternary chain and refused at `pine:input-kind` within
6 seconds of census time. It now reaches the node budget (`budget:nodes`): 35 seconds on the host lane, and past the
census's 118-second cap with the runtime lane on. Its plain-binding form (the same script without `var`) costs the
same on master: `budget:nodes` at 24 to 38 seconds on the host lane (a loaded box), past 118 seconds with the runtime
lane on. The `var` form now costs what the plain form already costs; the bound on that time is the translate step
budget and wall stop (train e94), which this unit does not touch.

**On the train (with E2 and the named-request follow).** A census of the first, wider version over E2's stack gave the
same served and refused moves as against master, 0 served -> refused.

## Grade diff (15 captures whose source declares a `var` `input.string`: 11 local, 4 committed)

| lane | before | after | plot MATCH | MATCH lost |
|---|---|---|---|---|
| production | 5 DIVERGE, 10 INCONCLUSIVE | 5 DIVERGE, 10 INCONCLUSIVE | 12 -> 12 | 0 |
| runtime on | 5 DIVERGE, 10 INCONCLUSIVE | 5 DIVERGE, 10 INCONCLUSIVE | 12 -> 12 | 0 |

Identical row by row: the INCONCLUSIVE rows refuse at walls outside this unit (`pine:reassign`, `pine:module`) before
the `var` read, and the DIVERGE rows are the same ones. No captured script turns MATCH, because none of the scripts
this unit newly serves has a TradingView capture yet.

## Findings outside this unit

- On bar 0 the host lane draws `timeframe.change(...)` as `na` where the run draws 0, for a plain binding exactly as
  for a `var`. The rails compare the two lanes from bar 1.
- A `var int len = input(14, ...)` is reported by the runtime lane as a name "never given a value" (one corpus row);
  the host lane reads it.
- The string-literal `var` (above): sound to read the same way, 563 corpus scripts to measure; a candidate unit.
