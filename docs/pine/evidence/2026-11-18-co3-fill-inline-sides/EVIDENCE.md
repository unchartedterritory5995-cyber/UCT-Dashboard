# CO-3: `fill(plot(a), plot(b))` is the bound form (engine NUMBER PENDING)

Coordinator's order, item 5: an inline `fill(plot(a), plot(b))`, with ict-killzone's `fill(h1, h2)` diagnosed
separately.

## The rule

The Pine v6 User Manual, *Fills* (https://www.tradingview.com/pine-script-docs/visuals/fills/), paraphrased:

- The signatures are `fill(plot1, plot2, …)` and `fill(hline1, hline2, …)`.
- Those parameters take the IDs that `plot()` and `hline()` calls return.
- A call takes either two plot IDs or two hline IDs, never one of each.

The Manual's examples always bind the ID first (`p1 = plot(…)`). An argument is its value, so the inline form passes
the same ID.

The Pine v6 reference states it directly (read from the local extraction of TradingView's reference data,
`docs/pine/pine-reference-extraction.md`): `plot` "Returns: A plot object, that can be used in fill()"; `hline`
"Returns: An hline object, that can be used in fill()"; `fill`'s `plot1` is "The first plot object".

## The wall

The runtime lane read a fill side only as a name bound to a plot, through `plotRefs` from `p = plot(…)`. An inline
side was refused `runtime:fill-target`: "argument 1 of `fill()` is not a plot".

## The change (`pineRuntimeFrontend.js::emitFill`, `sideOf`)

- **An inline `plot(…)` or `hline(…)` side** is emitted where it stands, through the same `emitOutputCall` a
  statement or a binding uses. The sides are emitted left to right, before the fill, so the outputs come in the same
  order as the bound form's.
- **Only `plot` and `hline`.** Those are the two calls that return a fill's ID. An inline `plotshape(…)` is still not
  a plot, and is refused by name as before.
- **A pair with an inline side that mixes the two kinds** is refused by name (the Manual's rule).
- **A pair of two bound names** keeps master's answer, so the change takes nothing away from the bound form.
- **Never at the object door.**

## Rails and mutants

`runtime/__tests__/fillInlineSides.test.js` compares each inline form with its bound form. The outputs, their order,
the fill descriptor (`call`, `upper`, `lower`, `gradient`, `hidden`) and every column must be equal, bar for bar.
The cases:

- two inline plots;
- inline plots with their own arguments and a colour given by position;
- one inline side and one bound side;
- two inline hlines;
- a hidden fill (`color = na`);
- plots after the fill keep their place.

It also checks what stays refused, by name:

- a plot beside an hline;
- an inline `plotshape`;
- a series that is not a plot ID.

Mutants M1-M3 are in `ci/mutants/co3-fill-inline-sides.json`. Each was made on a saved copy, watched turn its rail
red, and then restored from that copy and confirmed byte-equal.

## ict-killzone's fills, diagnosed (no change made)

`reference:ict-killzone`'s `runtime:fill-target` walls (L46-L48, `fill(varhigh, varhigh2, …)`) are not a fill defect.
They are artifacts of the peel:

- Its first wall is `pine:function` on L28, `time(<timeframe>, <session>)`. The session `"0100-0500"` has no day
  list, and in Pine v2 the default days are not stated by any reference text this engine holds.
- Peeling that line leaves `BarInSession` undefined, which in turn peels the plot bindings L41-L44.
- With those bindings peeled, the fills on L46-L48 name plots that no longer exist.

The wall to move is the v2 `time()` default-days question, which belongs to the builtins and request ground. Its
fills are already the bound form this change keeps.

## Blast radius (the 679-script coverage-map sample, every wall peeled, under the heavy lock)

Measured on master (cf06117f98) and again on this branch:

- **Builds that change: 0, and first walls that change: 0.**
- **2 scripts lose a `runtime:fill-target` wall.** Both are still refused at the same first wall:
  - `reference:hma-kahlman-trend-trendlines` (first wall `runtime:history-dynamic-offset`);
  - `reference:uptrick-volatility-weighted-cloud` (first wall `runtime:call-windowed-state`).
- No other wall moves.
