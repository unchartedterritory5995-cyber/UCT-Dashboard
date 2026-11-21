# RMA-SEED: `ta.rma`'s seed is the exactly rounded sum, and `ta.dmi` is TradingView's body over it (engine 92)

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

## How the `ta.dmi` body is written, and why

TradingView names `up`, `down` and `sum` as variables, computed on every bar. In a tuple tree, a stateful call
written inside a `?:` arm runs in Pine only on the bars that arm is taken:

- The member door refuses `ta.change` in an arm (`pine:block`, `armRunsWhy`). The first head build was refused
  exactly there.
- The runtime lane stops by name (`CallSiteRunsStop`) where `sum == 0` skips the `ta.rma`s inside `sum`, as a run of
  inside bars does.

So:

- `ta.change(high)` is spelled `high - high[1]` (and `-ta.change(low)` as `-(low - low[1])`). That is its
  definition, the same subtraction bit for bit.
- The ADX's `sum == 0 ? 1 : sum` is written `sum + (sum == 0 ? 1 : 0) * (1 - sum)`. It is bit-identical:
  - each DI is `fixnan(100 * rma(DM) / rma(TR))` with DM <= TR, so 0 <= DI <= 100, which makes `sum` finite and >= 0;
  - where `sum == 0` (TradingView's epsilon) the expression is `sum + fl(1 - sum)`, which rounds to exactly 1, because
    the rounding error of `1 - sum` is at most 2^-54 (ties to even);
  - elsewhere it is `sum + 0`, which is `sum` exactly;
  - `na` stays `na` both ways.
- A leg reads both lengths (`resolveEveryArg` / `mintArgs`), as `dmiParts`' legs did when they compared them. So a
  script that plots only +DI / -DI keeps its "DMI Smoothing" input: its frozen parameter ids (`paramIdLegacy.js`,
  `volume-spikes-growing-volume-signals`) still address it, and TradingView lists it too.

## Three observations map by the new paste

On base vs the first head, `adx-14` / `plus-di-14` / `minus-di-14` (2026-09-06 observations) went MATCH ->
INCONCLUSIVE on both lanes. Their plot selector is the formula text `adx(high, low, close, 14)` (and `plusDI(…)` /
`minusDI(…)`), which a pasted `ta.dmi` no longer lowers to. Values were never compared.

As with `ta.atr` -> `atrPine` (2026-09-27, `atr-14-2026-09-06`), each now declares `script.pasteLowersTo` with the
new formula, `since: 2026-11-20` and its reason. `engine` stays on the house formula `test_vendor_parity_adx.py`
grades. All three grade MATCH again: 80 / 130 / 130 steady-state bars, as on base.

## Capture re-check, base vs head, both lanes

Every committed capture (969) was graded by the vendor harness (`vendorHarness.corpus.test.js`, remote runners) on
base `29eeb1b108` and on head `163625400e`, production and runtime-on lanes. That includes 218 whose source calls
`ta.rma` / `ta.atr` / `ta.rsi` / `ta.dmi` / `ta.supertrend` / `ta.tr`.

| lane | capture-level moves | MATCH -> non-MATCH | plot-level moves |
|---|---|---|---|
| production | vw-bi-dmi-spy, vw-bi-dmi-rddt: INCONCLUSIVE -> MATCH | 0 | 24 plots `none -> MATCH` (the 12 rows of each) |
| runtime-on | the same two | 0 | the same 24 |

Every other capture holds its verdict on both lanes. No served value moved away from TradingView.

## Rails (final)

- `rmaSeedDmi.test.js` (16 tests): the witness, the longhands, the seed rule, `CARRIED.rma` and the column driver,
  `ta.rsi`'s seeds on both lanes, all seven columns on the host lane, the runtime lane and the member door, the
  `sum == 0` inside-bar chart on both lanes, the VM's carried kernel at the U3 seed, and the `computeADX` control.
- `tests/test_ast_rma_seed.py`: the Python twin, plus JS against Python bit for bit.
- Mutants `ci/mutants/u-rma-seed-dmi.json`, run locally: 13 / 13 killed, each restored byte-identical.
  - S1-S6: the seed rule, `rsiPine`, `FN_PINE.rsi`, `computeRSI` and the column driver.
  - D1: the ADX over the first length.
  - D2: the `na` first move.
  - D3: `sum == 0 ? 1 : sum` inline, red on the inside-bar chart.
  - D4: `ta.change(high)` inlined into the arms, red at the member door.
  - P1-P3: the Python twin.
- hostParity HP-1 (`tools/pine_runtime_host_parity.mjs --host node --check`): exactly THREE cases move, and that
  list is DECLARED for the e90 number step (HP-0 at the bump must show these and no others; one more or one fewer
  is a STOP):

  | case | committed | head | reason |
  |---|---|---|---|
  | `dmi_adx@listing` | `withheld` (`pine:function`: the runtime lane had no `ta.dmi`) | `ok` | `ta.dmi` is now served on the runtime lane (`PINE_TUPLE_BUILTINS.dmi`) |
  | `dmi_manual@calcbars` | ok, digest `8818519e…` | ok, digest `612f70f2…` | last bit at the rma seed bar (`ta.rma`'s exactly rounded seed) |
  | `rma_alma_hma@listing` | ok, digest `7f617fef…` | ok, digest `3ad969de…` | last bit at the rma seed bar |

  Confirmed by putting the left-to-right seed back (S1) and checking again: `dmi_manual` and `rma_alma_hma` return
  to their committed digests, and only `dmi_adx` (newly served) still moves. The digests are regenerated with
  `--write` at the engine bump, by the tool's own rule.
