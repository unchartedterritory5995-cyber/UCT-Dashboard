# RMA-SEED: `ta.rma`'s seed is the exactly rounded sum, and `ta.dmi` is TradingView's body over it (NUMBER PENDING)

Branch `feat/pine-dmi-rma-seed`, for e90. The coordinator numbers the train.
Coordinator ruling 2026-11-20: (a) `ta.dmi` as TradingView's body and (b) the exactly rounded `ta.rma` seed
ship TOGETHER. The rule lives in ONE place, read by every `ta.rma` consumer on both lanes and by the Python twin.

## The finding

Pine's published `ta.rma` seeds with `ta.sma(src, length)`, and TradingView's `ta.sma` is the exactly rounded
window sum (SMA-EXACT, `docs/pine/evidence/2026-11-16-sma-exact-sum/EVIDENCE.md`). The engine seeded `ta.rma`
with a LEFT-TO-RIGHT running sum / n. The 2026-11-16 rma-summation captures could not tell the two seeds apart
(its seed variants "did not separate"). Our committed probe `vw-bi-dmi-{spy,rddt}-1d-2026-11-19`
(`tools/visual_conformance/probes/vw-bi-dmi.pine`) can.

That probe plots `ta.dmi` at (14, 14), (17, 14) and (14, 20). W1-W4 subtract TradingView's own "Directional
Movement Index" body, written out over `ta.rma`, from it:

```
dirmov(len) =>
    up = ta.change(high)
    down = -ta.change(low)
    plusDM = na(up) ? na : (up > down and up > 0 ? up : 0)
    minusDM = na(down) ? na : (down > up and down > 0 ? down : 0)
    truerange = ta.rma(ta.tr, len)
    plus = fixnan(100 * ta.rma(plusDM, len) / truerange)
    minus = fixnan(100 * ta.rma(minusDM, len) / truerange)
    [plus, minus]
adx = 100 * ta.rma(math.abs(plus - minus) / (sum == 0 ? 1 : sum), adxlen)
```

W1-W4 read 0 on every bar TradingView plots them, on both symbols. So `ta.dmi` IS that body, and its ADX smooths
over the SECOND length.

## Measured offline, by float64 bit pattern (never a tolerance)

Bars are each capture's own. Bars compared are those where TradingView plots a value.

| capture | column | bars | body, left-to-right seed | body, exactly rounded seed | house `computeADX` (served for equal periods) |
|---|---|---:|---:|---:|---:|
| SPY | D1 +DI (14, 14) | 8,497 | 8,497 | **8,497** | 1,794 |
| SPY | D2 -DI (14, 14) | 8,497 | 8,497 | **8,497** | 1,739 |
| SPY | D3 ADX (14, 14) | 8,484 | 8,484 | **8,484** | 1,221 |
| SPY | U1 +DI (17, 14) | 8,494 | 8,494 | **8,494** | refused |
| SPY | U2 -DI (17, 14) | 8,494 | 8,494 | **8,494** | refused |
| SPY | U3 ADX (17, 14) | 8,481 | 8,478 | **8,481** | refused |
| SPY | U4 ADX (14, 20) | 8,478 | 8,458 | **8,478** | refused |
| RDDT | D1 / D2 / D3 | 656 / 656 / 643 | all | **all** | 138 / 148 / 96 |
| RDDT | U1 / U2 | 653 / 653 | all | **all** | refused |
| RDDT | U3 ADX (17, 14) | 640 | 634 | **640** | refused |
| RDDT | U4 ADX (14, 20) | 637 | 637 | **637** | refused |

The left-to-right misses start at the ADX rma's SEED bar (U3 bar 30 on both symbols, U4 bar 33 on SPY) and
decay over the next bars. Of the six ADX seeds, three separate the two sums, and TradingView's value is the exactly
rounded one at all three:

| seed | TradingView | exactly rounded / n | left-to-right / n |
|---|---|---|---|
| SPY U3 bar 30 | 10.20040692455124 | 10.20040692455124 | 10.200406924551238 |
| RDDT U3 bar 30 | 11.715328969189473 | 11.715328969189473 | 11.715328969189475 |
| SPY U4 bar 33 | 13.051521411698408 | 13.051521411698408 | 13.051521411698412 |

(Reversed order, `sum * (1/n)`, an incremental mean and `sum(x / n)` each miss at least one of the six. Only
`math.fsum` / n matches all six, which is SMA-EXACT's rule.) The house `computeADX` this replaces for equal periods
is a Wilder SUM (`s - s/n + x`, then `100 * s+ / sTR`), not `ta.rma`. It is about 1e-15 relative off TradingView on
most bars.

## What changed

- `interpret.js::rmaSeedMean(values, lo, n)` = `exactSum(values, lo, lo + n - 1) / n`. This is THE seed rule.
  - `smoothStepOf(recur, exactSeed)`: `rmaStep` keeps its first `n` finite values after the three scalars
    (`RMA_CELLS`) and seeds with `rmaSeedMean`. The hold on `na` is unchanged. `ema` keeps its running sum
    (unmeasured).
  - `CARRIED.rma.cells` is a function of the length. `carriedCellsOf(spec, n, bars)` sizes every store outside the
    VM, and the column driver caps it at the series length. The VM already sized function cells (`carCellsOf`).
  - `rsiPineStep` (Pine's `ta.rsi` on the runtime lane) seeds both averages with `rmaSeedMean`, because `ta.rsi`
    is two `ta.rma`s in its published body.
  - `FN_PINE.rsi` (Pine's `ta.rsi` on the host lane) hands `computeRSI` `{ seedMean: rmaSeedMean }`. Without the
    option, `computeRSI` is byte for byte as before; that path serves the native chart RSI, the screener and the
    formula language's `rsi`.
- `pine.js::PINE_TUPLE_BUILTINS.dmi`: the body above, as Pine trees. The runtime lane takes the same trees through
  `pineTupleBuiltinCallParts`. ⚰️ `dmiParts` / the `dmiLeg` resolver are gone; they mapped the three legs onto the
  house table's one-period `adx` / `plusDI` / `minusDI` and refused an unequal pair `pine:tuple`. The synthetic
  leg keys stay declared only for formulas already translated to them.
- Python twin: `ast_interpret._rma_seed_mean` (read by `_smooth_col(..., wilder=True)` and so by `_rma_col` and
  `atrPine`), and `FN_PINE["rsi"]` through `compute_rsi_raw(..., seed_mean=)`.
- ⛔ NOT touched: the native chart / screener ADX (`indicators.js::computeADX`), which is not Pine-served; `ta.ema`;
  and the formula language's `rsi` / `atr` / `adx`.

## What moves

`ta.rma`, `ta.atr` and `ta.rsi`, and everything built on them, move in their LAST BIT at the SEED BAR, toward
TradingView's value. That happens wherever the left-to-right sum of the first n values and the exactly rounded sum
differ. The recurrence carries that bit forward and it decays. `ta.dmi` with unequal lengths is served on both
lanes. With equal lengths it moves off `computeADX` onto TradingView's doubles.

## Rails

- `app/src/components/chart/engine/ast/rmaSeedDmi.test.js`:
  - The witness: W1-W4 are 0.
  - The longhand with the exact seed equals all seven columns on every bar. The left-to-right longhand misses at
    the three separating seed bars.
  - The seed rule itself, `CARRIED.rma` stepped and as a column (U3 bit for bit), and the column driver's sizing.
  - `ta.rsi`'s two seeds on both lanes, with the native RSI unchanged.
  - `ta.dmi` on the host and runtime lanes: all seven columns, every bar, both symbols.
  - The VM's own carried kernel seeding U3.
  - A control showing `computeADX` misses +DI on more than 5,000 SPY bars.
  - A named argument or a wrong count still refuses.
- `tests/test_ast_rma_seed.py`: the Python seed rule, `_rma_col` at the three separating seeds and every bar,
  Pine RSI against an independent longhand, and JS against Python bit for bit where `rma(close, 14)`'s seed parts.
- Updated to the exact seed: `rmaSummation.test.js`, `runtime/__tests__/carriedState.test.js` (the longhands) and
  `runtime/__tests__/runtimeRsiHma.test.js`. The `ta.dmi` read-backs are updated in `pine.tuples.test.js` and
  `pine.tupleBuiltins.test.js`.
- Mutants: `ci/mutants/u-rma-seed-dmi.json`.
  - S1-S6: the seed rule, `rsiPine`, `FN_PINE.rsi`, `computeRSI`'s seed and the column driver's sizing.
  - D1-D2: the ADX length and the `na` first move.
  - P1-P3: the Python twin, killed locally 3/3.

## Capture re-check, base vs head, both lanes

Pending: every committed capture graded by the vendor harness on base (`29eeb1b108`) and head, production and
runtime-on lanes. The moves will be listed here.
