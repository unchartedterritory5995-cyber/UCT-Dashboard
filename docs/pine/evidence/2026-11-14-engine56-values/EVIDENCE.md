# Engine 56: wrong values found by fresh TradingView captures

Branch `fix/pine-engine56-values`, on `origin/master` (engine 54). Engine 55
(`fix/pine-engine55-honest-htf`) merges first; this branch takes 56. Sources: the S3/S4 investigator
report (section A: A1, A2, A3, S4-1, S4-2, S4-4) and the S5 capture session (aroon and connors-rsi,
2026-11-14). Every capture named below is NYSE:RDDT 1D from the listing unless stated; they are
licence-held and stay in `%LOCALAPPDATA%/uct-vendor-batch/runs/*/captures` (only their verdicts reach the
evidence ledger). The rails run scripts written in this repo's own words on the committed
`support-and-resistance-5f95e90f-rddt-1d-2026-11-13` bars, which are the same 666 sessions the held
captures hold (checked bar for bar), and grade them against the captures' numbers.

## What changed, item by item

### A1: a v1/v2 self-declaration keeps `nz(x[k], S)` and `na(x[k]) ? S :` in the step
`pine.js::nzSeedAndUpdate` stripped `nz(self[k], S)` to `self[k]` ("inside the built body `self[k]` is
never unknown"), and `ternarySeedAndUpdate` built the accumulator from the update arm alone. Both are
true on bar 0 (the history is filled with the seed) and false after an update that answers `na`:
- `average-true-range-trailing-stops-strategy-by-sylvain-vervoort` (v1): `nLoss` is `na` on bars 0-3,
  `max(0, na)` makes the stop `na`, and Pine's `nz(x[1], 0)` reads 0 on bar 4. TradingView draws 16.49207;
  the stripped step drew 99.01 off a bare `na` self.
- the ternary twin: `x = na(x[1]) ? 0 : U` with `U` answering `na` re-seeds on the next bar in Pine; the
  update-only step carried `na` forever.

Now `seedAndUpdateOf` returns `{seed, update, step}`: `step` is the body as written (wrappers and test
kept), and it is what the accumulator runs (`pine.js` and `thinkscript.js`, which shares the function);
`update` (stripped / the arm alone) is still what the convergence gates (`forgetsItsSeed`,
`forgetsOnReset`, `isBarCounterUpdate`) ask, so no gate decision moved. Bar 0 is unchanged (the seed fills
the lag history, so `nz` and the test are no-ops there).

### A2: `percentrank` counts an `na` prior as "not <="
`interpret.js::percentrankAt` and `ast_interpret._percentrank_at`: a `na` prior value is skipped
(`continue`), the divisor stays `length`, a `na` current bar and a bar before `length` stay `na`.
Witnesses: `uptrick-volatility-weighted-cloud` (v6; bands from bar 100, 0.49 / 0.53 / 0 / 0.47 on bars
100 / 101 / 120 / 141 where this answered `na` to bar 141) and the builtin `connors-rsi` (v6; CRSI
68.6058732213702 on bar 100 over `ta.percentrank(ta.roc(close, 1), 100)`, whose window holds the `na` of
bar 0). The runtime lane computes `ta.percentrank` through the columnar lane, so it moved with it.

### A3: a Pine v1-v5 `bool` can be `na`
Pine v1-v5: a comparison with `na` is an `na` bool, and `na == true` / `na == false` are false (the v6
migration guide, for v5; measured for v1 on `accumulation-distribution-with-markers`, bar 14:
`adSmaller == true and adSmaller[1] == false` with `adSmaller[1]` the comparison of bar 13 against a
warming-up `sma`; TradingView draws `na`, this engine drew -11152358.65). v6 bools are never `na`.

The engine keeps a comparison's value (`cmp` answers 0 for a `na` operand, which every condition reads as
Pine's cast reads `na`: false), and the Pine door now tracks WHERE a `bool` is `na`
(`pine.js::naInfo`: `{na, maybe}` per resolved tree; comparisons, offsets of them, `?:` of bool arms,
`and` / `or` / `not`, the bool-returning calls). Operators that tell `na` from false are rewritten in v1-v5
and with no `//@version` (`pine.js::boolNaOperator`):

| form | v1-v3 / no pragma | v4 / v5 | v6 |
|---|---|---|---|
| `b == true`, `b == false` (a written literal) | SERVED: false where `b` is `na` | SERVED | unchanged |
| `b != L`, `b1 == b2` (both `na`-able, or a non-literal side) | WITHHELD on the bars an operand is `na` | WITHHELD | unchanged |
| `not b`, `b or c` | WITHHELD on those bars | unchanged (read as false: `rt3-na-logic` v4/v5, witnessed) | unchanged |
| `b and c` | served (false or `na`; every condition reads both as false), tracked as `maybe` | unchanged | unchanged |
| `?:` / `if` / `iff` test | unchanged (false) | unchanged | unchanged |

A withheld bar is the canonical marker `boolNaWithheld(operand, flag)` (a new table function: its operand
on every bar, both lanes) and the mask `interpret.js::boolNaMask` / `ast_interpret.bool_na_mask` (every
root bar within reach of a flagged bar, `historyReadMask`'s rule), named
`pine:bool-na-unwitnessed` in the chart-clock channel with a sentence that says what is drawn, what is not,
and what would settle it (the A3 probe). Residual, stated: a tree whose `na` cannot be tracked (a
recurrence's own value read as a bool, a numeric operand used as a bool) keeps the value it had.

### S4-1: pivots ignore a left-side `na`
`pivotCol`, the runtime kernel `pivotPineStep` and `ast_interpret._pivot_col`: for `j < i` a `na` is
skipped. A right-side `na`, a `na` current bar and a bar with fewer than `left` bars before it stay not
computable. Witness: `on-balance-volume-macd-acceleratorawesome-oscillator-pivdiv-3` (v4), first Bear Div
L/M/S markers on bars 73, 58, 54; the investigator's recompute of all six pivot columns had 0 diffs.
The edge (S6, the builtin `rsi-divergence-indicator`, 0 mismatches over 666 bars under this rule): its
pivot high of bar 14 has its WHOLE left window (bars 9..13, the RSI warm-up) `na` and still counts, so an
all-`na` left window passes; the only withheld left condition is a window that reaches before bar 0
(`i - left < 0`, the loop's start). Railed on the capture's numbers (bar 19: 45.19746465138957, bar 23:
41.366625940024655) with a mutant that withholds an all-`na` left window.

### S4-2: the arg-extreme tie depends on the source
Two witnesses say the NEWEST tied bar wins over a bar price: the builtin `aroon` (v6, S5; Aroon Up 100 on
bar 116, where `ta.highestbars(high, 15)` ties the current bar with bar 112; this engine read 71.43) and
`pivot-high-low-points` (v4; no marker on bar 117, where `highestbars(11)` ties bars 112 and 116).
`divergences.json::argextreme-ties-resolve-to-the-newest-bar` measured OLDEST (380 ok / 0 bad) on a
two-valued COMPUTED source at v6. The two are not reconciled, so (coordinator decision):
- over a price the bar holds (`open`/`high`/`low`/`close`, `hl2`/`hlc3`/`ohlc4`/`hlcc4` as the door builds
  them: `interpret.js::isBarPriceTree`, `ast_interpret.is_bar_price_tree`) the newest tied bar wins, at
  every version (`FN_BAR_PRICE_NEWEST`, `FINITE_WINDOW.*.reduceNewest`, the runtime window's `newest`
  plan flag); `aroonUp` / `aroonDown` read `high` / `low` and take the same rule;
- over any other source the oldest-wins answer stays underneath and every bar whose window holds a tied
  extreme is WITHHELD by name (`argExtremeTieMask`, `pine:tie-unwitnessed`) until the tie probe settles it.
The divergences.json entry is kept as the computed-source measurement; `_functions_arg_extreme` records
the conflict.

### The runtime lane
It has no per-bar withholding, so it declines by the same codes: a column the columnar lane withholds by
either code declines the run (`columnOf`, the `runtime:chart-clock` pattern); a VM `==` / `!=` (and v1-v3
`or` / `not`) over a comparison that can be `na` declines `pine:bool-na-unwitnessed`; a VM window of
`highestbars` / `lowestbars` over a computed source declines `pine:tie-unwitnessed`, and over a bar price it
runs the newest reducer.

### S4-4: the harness
- `compare.mjs`: a plot a running total feeds (`cum`, `cumFrom`, `sum` in its tree) is graded with an
  absolute floor of `8 · ε · max |total|` over the prefix (`ourSide.js::floatOrderFloorOf`); a relative
  1e-6 error still diverges (railed).
- a bar withheld by a per-bar witness code (`nativeRegistry.withheldBarsReport`, recorded by
  `spreadWitnessMask`) is not compared; where TradingView drew a value on one, the plot is INCONCLUSIVE
  with the count.
