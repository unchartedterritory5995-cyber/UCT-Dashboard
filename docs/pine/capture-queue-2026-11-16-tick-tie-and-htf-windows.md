# Capture queue: 2026-11-16, tick-rounding ties and window calls inside a weekly request

Same procedure as `docs/pine/capture-queue-2026-09-28.md`; capture from the listing (NYSE:RDDT 1D and
AMEX:SPY 1D), and keep the plotted values as full float64 text.

## Tick-rounding ties

`math.round_to_mintick(654.405)` is 654.41 on TradingView (`parabolic-sar-spy-1d-2026-11-15`, the label on
2025-09-30). The engine computed `round(x / tick)`, and 654.405 / 0.01 is 65440.49999999999 in binary, so it
printed 654.4. It now computes `round(x * (1 / tick))` (654.405 * 100 is 65440.5 exactly). That is one
witness, and three readings fit it; the rows below part them. Until they are captured the engine serves the
reading that changes the fewest answers: of the decimal ties at a 0.01 tick it moves about one in twenty,
all of them up, and it leaves a value such as 1.005 where it was (1.00), which is also what TradingView's
`format.mintick` prints for it (`vw-fmt-tie-readings` T08).

| row | probe | what it settles |
|---|---|---|
| K01-K04 | `vw-round-to-mintick-ties.pine` | which reading TradingView's `math.round_to_mintick` uses on a decimal tie that is not a binary tie: multiply by the price scale (1.005 reads 1.00), a tolerance on `x / tick` or the shortest decimal (1.005 reads 1.01) |
| K05-K08 | `vw-round-to-mintick-ties.pine` | the direction of a negative tie (the reference says ties round up; no capture holds one) |
| K09 | `vw-round-to-mintick-ties.pine` | whether a value a hair under a half tick rounds up (the broker's fill rounding, B-ROUND, allows 1e-6 of a tick) |
| K11 | `vw-round-to-mintick-ties.pine` | whether the result is `k * tick` or `k / scale` in its last bit |
| K21 | `vw-round-to-mintick-ties.pine` | whether `str.tostring(654.405, format.mintick)` prints 654.41 as well (the engine prints 654.40 there: `round(x / tick)`, CBC-FMT) |

## Window calls inside a weekly request

Engine 59's open note: `builtinWitnessMask` and `windowHoleMask` do not list `tf_merge` among the reads
whose child is analysed on its own bars, so a `ta.stoch` / `ta.highest` site inside
`request.security(…, "W", …)` is asked about on the chart's daily bars too, and daily bars are withheld that
the weekly read does not need (36 daily bars of 666, bars 64 to 99, on the constructed flat-run shape of
`engine57Builtins.test.js` over the RDDT daily bars, every one a bar the weekly read alone would draw). It never draws a wrong value.
No committed capture plots a window call inside a weekly request, so those bars stay withheld until one does
(`tfMergeNestedMasks.test.js`, `tests/test_pine_tfmerge_nested_masks.py`).

| row | probe | what it settles |
|---|---|---|
| H01-H02 | `vw-htf-window-sites.pine` | a weekly `ta.stoch` merged onto daily bars, bar for bar (no committed capture plots one) |
| H03 | `vw-htf-window-sites.pine` | the constructed flat run: the daily bars the root mask withholds today, as TradingView draws them |
| H04-H05 | `vw-htf-window-sites.pine` | a weekly `ta.highest` / `ta.lowest` over a source with `na` holes |
