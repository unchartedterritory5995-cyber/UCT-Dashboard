# Capture queue: 2026-11-16, text and colour values (TC coverage unit)

Same procedure as `docs/pine/capture-queue-2026-09-28.md`; capture from the listing (NYSE:RDDT 1D), and keep the
plotted values as full float64 text.

## A colour compared with `na`, and two colours compared

engulfing-sinyal (Pine v4) writes `alertcondition(Bueng != na, ...)` where `Bueng` is `<condition> ? color.yellow : na`.
The Pine v4 reference says of `na` "DON'T TRY TO COMPARE WITH IT!" and the v5 reference that comparing with it "might
lead to unexpected behavior", so what TradingView answers is not stated; the runtime lane refuses a colour compared with
the literal `na` by name (`runtime:colour`). Two colours compared with `==` / `!=` are served where each operand is
written with a whole-number transparency (or none); an operand written with a fractional transparency or a gradient is
refused by name, because two such colours can share one opacity byte while their transparencies differ.

| row | probe | what it settles |
|---|---|---|
| C1-C3 | `vw-tc1-colour-na-compare.pine` | `colour != na`, `colour == na` and `na(colour)` on a v4 colour series that is `na` on down bars (C3 may not compile on v4: record the error) |
| N1-N3 | `vw-tc1-colour-na-compare.pine` | the same three on a NUMBER, so a colour rule can be told from the general `na` rule |
| E1 | `vw-tc1-colour-na-compare.pine` | `color.new(color.red, 50.1) == color.new(color.red, 50.2)`: one opacity byte, two transparencies; does TradingView compare the byte or the number |
| E2 | `vw-tc1-colour-na-compare.pine` | `color.rgb(255, 82, 82) == color.red` (v4 red is #FF5252): a control that must read 1 |
| B0 | `vw-tc1-colour-na-compare.pine` | `bar_index`, the control that the capture's bars are the bars we compute on |

## The two reference scripts this unit makes transfer that capability admission would serve

`PINE_RUNTIME_CAPABILITY_ADMISSION=on` admits these two on capability evidence (`capability_admission.admission_row`
on this tree: every capability they declare is admitted, neither is on the kill list), and no committed capture of
either exists. Each is captured as written (its own inputs at defaults); if a capture DIVERGEs on the runtime-on lane,
the script goes on `api/data/pine_runtime_killlist.json` by its source sha256 in a follow-up.

| row | script (reference sample, not in the repo) | sha256 (first 16) | what it settles |
|---|---|---|---|
| TC-A1 | `reference:color-gradient-framework-pinecoders__9ICIDOiMbF` on NYSE:RDDT 1D | `e993b713307bcf78` | the untyped colour parameters (per-call-site copies), `color.new` over a fractional transparency on the bar, `color.from_gradient` over parameters; its plots (its `fill`s are named "Not drawn by this pane" on the runtime lane) |
| TC-A2 | `reference:study-for-squeeze-momentum-indicator-lazybear__2BZblBj6eA` on NYSE:RDDT 1D | `13a3f2f4a179e81a` | colour `==` / `!=`, a colour's past and v4 `iff` with colour arms, read through its six alert conditions |
