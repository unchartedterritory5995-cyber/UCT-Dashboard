# CO-1: a Pine v4 colour compared with `na` (2026-11-18)

Engine number PENDING (the coordinator numbers the train). Branch `feat/pine-colour-na-v4`. Roadmap unit U-COLOUR
(`docs/pine/PARITY-ROADMAP-2026-11-18.md` section 5), first change.

## The witness

`tests/fixtures/vendor/harness/vw-tc1-colour-na-compare-rddt-1d-2026-11-16.json` is probe
`tools/visual_conformance/probes/vw-tc1-colour-na-compare.pine` (Pine v4) on NYSE:RDDT 1D, 667 bars, with
`c = up ? color.yellow : na` and `x = up ? close : na`. Each row's value, split by whether the bar is up (`c` a
colour) or not (`c` is `na`):

| row | expression | up bars (316) | other bars (351) |
|---|---|---|---|
| C1 | `c != na` | 0 | 0 |
| C2 | `c == na` | 0 | 0 |
| C3 | `na(c)` | 0 | 1 |
| N1 | `x != na` | 0 | 0 |
| N2 | `x == na` | 0 | 0 |
| N3 | `na(x)` | 0 | 1 |

So in v4 a comparison with the literal `na` reads false on every bar, for a colour exactly as for a number. The
runtime lane already answered N1 / N2 that way (measured: 0 differences on the 666 graded bars).

## The change

`ast/pineRuntimeFrontend.js`, in the TC colour-operator branch. In Pine v4, `==` / `!=` between a colour and the
literal `na` is lowered as the number comparison is. Our side, measured on the capture's bars, differs from C1
and C2 on 0 of the 666 graded bars. Every other version keeps `runtime:colour`, by name, because no capture holds
it. reference:engulfing-sinyal (`alertcondition(Bueng != na, ...)`, its only wall) now builds on the runtime lane.

Rails: `runtime/__tests__/colourNaCompareV4.test.js`. `runtime/__tests__/tcTextColour.test.js` is re-pinned: it
asserted the v4 refusal. Mutants K1-K3: `ci/mutants/co1-colour-na-v4.json`.
