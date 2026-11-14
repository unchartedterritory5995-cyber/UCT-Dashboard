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

## Rails
- `app/src/components/chart/engine/ast/engine56Values.test.js` (host and runtime lanes, four doors):
  - A1: the trailing stop of bars 4..11 (16.49207, 16.49207, 16.49207, 17.547739840000006, …) from a v1
    script in this repo's words, v1 = v2; the ternary re-seed bar by bar; control: an update that never
    answers `na` (`x = close > nz(x[1], 0) ? close : nz(x[1], 0)`) is the running max.
  - A2: Connors RSI (written from its public definition) reads 68.6058732213702 on bar 100, `na` on 98/99,
    73.8326746093395 / 41.05454228993245 on 101/102; synthetic `[na x 3, values]`; the runtime lane
    draws the same column.
  - A3: the markers script reads `na` on bar 14 and -84920.78585333377 on bar 31, nothing withheld, no
    marker in the tree; v6 draws the bar-14 marker. Synthetic forms over v1 (no pragma) .. v6: `c == false`
    served at every version; `!=`, `==` of two `na`-able sides, v1-v3 `not` / `or`, `(c and x) == false`
    withheld on bars 0..3 with the code in the clock channel, `withheldBarsReport` and the door; the
    screen / pane / member door translate and `buildRuntimeIr` declines by the same code; the served
    forms are equal on both lanes.
  - S4-1: synthetic left-`na` pivots in `pivotCol` and the runtime kernel; a v4 pivot of
    `close - sma(close, 10)` on RDDT (the pivots of bars 10 and 14, read on bars 12 and 16);
    `rsi-divergence-indicator` (S6) bars 19 (45.19746465138957) and 23 (41.366625940024655), an all-`na`
    left window passing and a window before bar 0 withheld.
  - S4-2: the aroon form on RDDT (78.57142857142857 / 100 / 92.85714285714286 on bars 115..117); v4
    `highestbars(11)` = -1 on bar 117; a two-valued computed source withheld (v6, v4) with the runtime
    declining; a computed source with no tie drawn, tie bars counted exactly; the bar-price test.
  - the runtime lane's own path: a VM `!=` over a comparison of a mutable value declines (v5), not v6;
    a VM window over a computed source stops by name on its first tied window and is served (equal to
    the columnar lane) with none; `ta.highestbars(high, <per-bar length>)` names bar 116 on bar 116.
- `app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.engine56FloatFloor.test.js`:
  the S4-4 floor on the capture's magnitudes (2 ulps of a 1.2e9 total pass, a relative 1e-6 error still
  diverges), `floatOrderFloorOf`, and per-bar withholding (INCONCLUSIVE with a count in steady state,
  nothing in warm-up, a wrong value elsewhere still DIVERGE).
- `tests/test_engine56_values.py`: the Python twin of A2, S4-1, S4-2 (newest, aroon, tie mask) and the A3
  marker and mask.
- Pins updated for the new shape, each with its reason: `pine.convergence`, `pine.selfref`,
  `thinkscript.selfref` (the step keeps `nz` / the `na` test), `pinePhase1Builtins` (TradingView's Aroon:
  newest), `sentence` / `parse` / `doorCoverage` / `pine.window` / `periodAnchorParity` (the new table
  function and codes), `test_ast_interpret` / `test_ast_scalars` / the corpus and input-compat fixtures,
  `docs/formulas/GRAMMAR.md` (regenerated), `tools/lookback_agreement.json` (written by its own rail),
  host-parity digests (`--write`, every case moves with the engine identity; 0 status or guard changes).

## Census (1,816 sources: corpus 266, repo `.pine` 507, committed vendor captures 173, licence-held sample 679, held capture store 191)
BEFORE = this tree with `origin/master`'s product files swapped in (`ast_interpret.py`, `interpret.js`,
`pine.js`, `pineRuntimeFrontend.js`, `thinkscript.js`, `closedTable.json`, `nativeRegistry.js`, `vm.js`,
`scriptEngineVersion.js`, `ourSide.js`, `compare.mjs`), restored from saved copies afterwards (`git status`
clean on every one). Each source through the screen translation, the pane (`strict`), `buildRuntimeIr`
(300 synthetic bars, from the listing) and `memberPaneDefinition`.

- Guard changes: **0** at the screen, the pane and the member door. **5** at `buildRuntimeIr`, each
  `OK -> pine:bool-na-unwitnessed` (a column the columnar lane now withholds on some of those bars):
  `pivot-points-high-low-extension` (sample and held capture), `check-head-and-shouldersmask-man`,
  `stoch-money-flow-admf-absolute-strength-index-asi-ci8dh`, `vix-fix-stochrsi-strategy`.
- Translations that changed (output formulas / the door's definition): screen 17, pane 21, door 22 rows
  (A1's step shape, A3's rewrites): the v1/v2 self-declarations (`average-true-range-trailing-stops`,
  `bill-williams-awesome-oscillator`, `squeeze-momentum-indicator-lazybear`, `smoothed-heiken-ashi-candles`,
  `ehlers-instantaneous-trend`, `cm-williams-vix-fix`, `16-smacd`, …) and the v1-v5 bool forms
  (`accumulation-distribution-with-markers`, `ytc-swing-highs-lows`, `mcclellan-oscillator`,
  `onchart-wavetrend-divergence-with-pivots`, `qqe-mod-ssl-hybrid`, …). No translation errors appeared.

## Vendor harness, both lanes (BEFORE = `origin/master`'s files swapped in, as the census)
Committed fixtures (`tests/fixtures/vendor`, 376 files after the merge of `origin/master`) and the
licence-held store (`runs/{ext,probes,probes2,s2,s3,s4,s5,s6}`, 246 captures; verdicts only, nothing
committed). M/D/I counted per capture id.

| set | lane | before M/D/I | after M/D/I | moves |
|---|---|---|---|---|
| fixtures | production (`RUNTIME_ON=0`) | 155/50/166 | 156/49/166 | pivot-high-low-points D -> M |
| fixtures | runtime-on (`=1`, upper bound) | 181/50/140 | 182/49/140 | pivot-high-low-points D -> M |
| held store | production | 136/78/27 | 140/73/28 | aroon, connors-rsi, pivot-high-low-points, rsi-divergence-indicator D -> M; obv-macd-ao-pivdiv-3 D -> I |
| held store | runtime-on | 145/80/16 | 149/75/17 | the same five |

**0 MATCH -> DIVERGE, 0 new DIVERGE, in every set and lane.** pivdiv-3's only remaining item is its
hidden constant `0 line` (colour not resolvable on our side), as before; all 29 of its value plots MATCH.

Value level (bars where the value or its `na` differs, summed over a capture's plots), held store, both
lanes identical: accumulation-distribution-with-markers 1 -> 0, average-true-range-trailing-stops 31 -> 0,
uptrick-volatility-weighted-cloud 84 -> 0, accdist-macd SPY 2 -> 0 (the S4-4 floor, used on 2 Histogram
bars), obv-macd-ao-pivdiv-3 3 -> 0, pivot-high-low-points 1 -> 0, aroon 4 -> 0, connors-rsi 1 -> 0,
rsi-divergence-indicator 4 -> 0; **0 captures got worse**. accumulation-distribution, the ATR trailing
stop, uptrick, accdist-macd and bill-williams AO stay DIVERGE on COLOUR only (the v1-v3 palette and
default transparency: engine 57's lane, not this one).

Per-bar withholding in the graded sets: `pivot-points-high-low-extension` (v4, `pine:bool-na-unwitnessed`,
44 and 11 bars on four plots, every one a bar where TradingView draws nothing) and
`squeeze-momentum-indicator-lazybear` (named on one plot); no capture has a withheld bar where TradingView
draws a value. No `pine:tie-unwitnessed` bar occurs in any capture.
