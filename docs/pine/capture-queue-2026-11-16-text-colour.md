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
