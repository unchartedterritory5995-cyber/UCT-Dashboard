# Capture queue — 2026-10-31 Phase 3 WS-E, drawing and presentation from the run

Branch `feat/pine-p3-wse`. For CAP3 to run on the live TradingView rig with
`tools/vendor_harness/tv_capture.js` (procedure as `docs/pine/capture-queue-2026-09-28.md`).
The runtime lane is dark; these are what WS-E carries without a TradingView witness.

| id | probe / script | chart | question | what the engine does today | what the capture changes |
|---|---|---|---|---|---|
| Q-WSE1 | probe: `indicator("t", calc_bars_count = 100)` + `plot(bar_index)` | AMEX:SPY 1D (1,800 bars) | the VALUE of `bar_index` on the first calculated bar of a `calc_bars_count` window: 0, or the bar's index in the loaded history? | a windowed run whose answer moves when `bar_index` is read one bar further on is REFUSED by name (`runtime:calc-bars-bar-index`, review H1); one that reads it only as a distance or a drawing's place (wyckoff) is drawn | settles the value; the refusal can then be lifted, starting `bar_index` at 0 or at `cut` as the capture shows |
| Q-WSE2 | a `calc_bars_count` script whose state depends on its first bar (e.g. a `var` running total), live | any liquid symbol, 1m, market hours | does the initial window stay fixed while realtime bars are added (TradingView's documented rule), or slide? | the window slides with each new bar: what a reload shows, not a live session after N new bars | settles whether the runtime pane must pin the window's start for realtime bars |
| Q-WSE3 | `corpus/committed/atr-trend-bands-misu__a34d44410a.pine` | NYSE:RDDT 1D from the listing | its `barcolor(colorbars ? colorTrend : na)` over `var color colorTrend = na` | a name declared `color` reads as a colour whatever its initialiser (`runtime/colours.js::colourTypedNamesOf`); the bar colour is the run's | first TradingView grade of a per-bar barcolor through a `color`-typed `var` |
| Q-WSE4 | `corpus/committed/multi-timeframe-trend-indicator__fa4022ecf5.pine` | NYSE:RDDT 1D from the listing | `color barColor = na` assigned in an `if`, then `barcolor(barColor)` | as Q-WSE3 (if its other walls are cleared) | as Q-WSE3 |
| Q-WSE5 | builtin Relative Strength Index (`STD;RSI`) | NYSE:RDDT 1D from the listing | the RSI line and its two zone gradient fills | the gradient `fill` is lowered as an UNDRAWN fill (no fill is drawn from the run, solid or gradient) and named in the document's "Not drawn by this pane" note; the RSI line is the run's | grades the line; the fill stays undrawn until a run fill renderer exists (see the WS-E handoff) |
