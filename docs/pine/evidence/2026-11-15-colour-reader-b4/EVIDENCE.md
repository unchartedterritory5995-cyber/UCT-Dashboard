# B4 colour reader: a nested `iff` of colours and a subject-less `switch` of colours

Branch `fix/pine-engine-colour-reader`, stacked on #1330 (`fix/pine-engine58-colours`, head `1bf2c63760`),
because it builds on engine 58's palette work and #1330 is not merged. Engine-output change: master + 1 at
merge (history line NUMBER PENDING). The s245 report's G2.

## Witness
Two licence-held scripts, captured from the listing on NYSE:RDDT 1D (run store only: s4 / s5 2026-11-14;
nothing of theirs is committed):
- squeeze-momentum (LazyBear), no pragma: the histogram's colour is a nested `iff` of four named colours;
  `study.palettes.palette_0` is lime, green, red, maroon (the v3 table, which v1 draws) and the per-bar
  colorer index picks one.
- bbtrend, //@version=6: the columns' colour is a name bound to a subject-less `switch` of four
  `color.new` names; `palette_0` is the four at their own alphas (0.75 / 0.5).
Master drew both in the pane's gold; engine 58 withholds both (`pine:colour-unread`).

## Change
`pine.js::colourChainOf`, asked at the top of `colourConditional`:
- `iff(cond, a, b)` with three positional arguments, in v1-v4 and when the script defines no `iff` of its
  own, is the ternary `cond ? a : b`; a ternary holding an `iff` in an arm is re-read so the nested arm
  opens too.
- a name bound to a subject-less `name = switch` is the chain `subjectlessSwitchNode` already reads for the
  `:=` form (the first arm whose condition holds, the bare `=>` arm otherwise, `na` with none; an `na`
  condition is false). The declaration stays OPAQUE (`pine:block`) to every value reader; the chain is hung
  non-enumerably on that binding (`colourSwitch`) and only the colour reader takes it.
The rest is engine 58's machinery unchanged (palette, alpha per entry, index tree).

## Measured (local, run-store captures, `zzB4Colour.tmp.test.js`, not committed)
| script | before (engine 58) | after |
|---|---|---|
| squeeze-momentum histogram | uncarried, colour INCONCLUSIVE | colour MATCH, 628 compared, 0 mismatches |
| bbtrend columns | uncarried (`colorDynamic`), INCONCLUSIVE | MATCH, 617 compared, 0 mismatches |
squeeze's zero-line cross plot (a plain ternary of three colours) is ungraded in both (not this change).

## Rails and mutants
`app/src/components/chart/engine/__tests__/colourChainB4.test.js` (our own repros of the two shapes): the
nested-`iff` palette in reading order and its per-bar index; a script's own `iff` keeps its own body; the
switch's two colours at their own alphas and its condition per bar; a subject-less switch VALUE still
refused `pine:block`. Mutants (copy aside, mutate, the rail, restore byte-equal): `iff` not opened, a
script's own `iff` hijacked, the switch chain not hung, the ternary step not re-reading an arm: 4 of 4
killed. A redundant arm-opening inside the `iff` step survived its mutant (the ternary step covers it) and
was removed.
