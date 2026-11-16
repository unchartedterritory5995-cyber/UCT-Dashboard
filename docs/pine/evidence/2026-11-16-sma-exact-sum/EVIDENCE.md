# SMA-EXACT: `ta.sma` and `math.sum` are the exactly rounded window sum (NUMBER PENDING)

Branch `fix/pine-sma-exact-sum`. Engine number: NUMBER PENDING (the coordinator numbers the train).

## The finding

`vw-pt-na-guard-and-spy` E02 (`not na(x) and ta.change(x) > 0`, `x = ta.sma(close, 30)`) reads 1 on our
side and 0 on TradingView's on SPY 1D bars 488 and 3009. On both bars the closes entering and leaving the
window are equal, so the true change is exactly 0; our left-to-right sum rounds the two windows to
different doubles (bar 3008 -> 3009: `chg 0.015000000000000568` on the previous bar, then a 1-ulp step).
TradingView's `ta.sma` does not: it is the exactly rounded sum of the window's doubles.

## Choosing by evidence: every committed and batch capture with a direct window plot

Plots that are a direct window of a bar field (`plot(ta.sma(close, n), "t")`, `math.sum`, `ta.wma`,
`ta.stdev`), committed under `tests/fixtures/vendor/harness/` plus today's batch store (our own `vw-*`
probes, not yet committed by the capture session). Bars compared = bars where TradingView has a value and
the window is all finite. A miss = not BIT-identical.

| function | captures | plots | bars | running sum (add new, subtract old) | left-to-right | Neumaier (Kahan-Babuska) | exactly rounded (`math.fsum`) |
|---|---|---:|---:|---:|---:|---:|---:|
| `ta.sma` | all | 34 | 132,789 | 106,959 | 31,863 | 2,544 | 2,544 |
| `ta.sma` | taken 2026-11-14 on | 31 | 129,726 | 104,131 | 29,305 | **0** | **0** |
| `math.sum` | all (2026-11-15) | 2 | 9,165 | 7,198 | 2,041 | **0** | **0** |
| `ta.wma` | all (2026-11-14 on) | 52 | 238,222 | n/a | **0** | 48,723 | 48,723 |
| `ta.stdev` | all | 1 | 663 | n/a | 661 | 662 | 662 |

- The 2,544 `ta.sma` misses left for the two exact sums are ALL in three captures from 2026-09-30 /
  2026-10-01 (`vw-call-site-history-{rddt,spy}-1d-2026-10-01`, `vw-fn-series-history-rddt-1d-2026-09-30`),
  where every reading misses at a relative error of at most 1.3e-15: the bar data or its serialisation of
  that era, not the sum. Every capture taken from 2026-11-14 on: 0 for both.
- `vw-pt-na-guard-and-spy` A02 (`ta.sma(close, 30)`, 8,479 SPY bars, an assigned plot the table's pattern
  does not pick up): exactly rounded 0, Neumaier 0, left-to-right 4,667, running 7,905. With the exact sum
  E02 reads 0 on bars 488 and 3009 (`x[bar] - x[bar - 1] === 0`).
- Neumaier and the exactly rounded sum never part on any capture. Ruling: on a tie, prefer `fsum`. The
  exactly rounded sum is also the one that can be stated: order-independent, and equal to Python's
  `math.fsum`, so the Python twin is one standard-library call.

### ⛔ `ta.wma` stays left-to-right

TradingView's `ta.wma` is the plain left-to-right weighted sum, `sum(x[i] * (i + 1)) / (n (n + 1) / 2)`:
0 misses on 238,222 bars, and the exactly rounded weighted sum misses 48,723. It is NOT changed, and a
rail (`smaExactSum.test.js`, `test_ast_sma_exact_sum.py`) fails if anyone "fixes" it.

### `ta.stdev` and `ta.dev` unchanged

The one `ta.stdev` plot misses on every bar under every summation of the model "mean, then mean squared
deviation", so its formula is the open question, not its sum. `ta.stdev` and `ta.dev` keep the
left-to-right mean they centre on (`windowMeanNaive` / `_window_mean_naive`) and draw exactly what they
drew before. A probe that separates their formula is the next step (queue row below).

## Per-capture detail (`ta.sma` / `math.sum`)

| capture | where | fn | plots | bars | running | left-to-right | Neumaier | exact |
|---|---|---|---:|---:|---:|---:|---:|---:|
| `vw-andor-history-rddt-1d-2026-11-16` | batch store | sma | 1 | 663 | 633 | 158 | 0 | 0 |
| `vw-andor-history-spy-1d-2026-11-16` | batch store | sma | 1 | 8,504 | 6,448 | 1,601 | 0 | 0 |
| `vw-arm-history-v3-rddt-1d-2026-11-16` | batch store | sma | 1 | 663 | 633 | 158 | 0 | 0 |
| `vw-arm-history-v3-spy-1d-2026-11-16` | batch store | sma | 1 | 8,504 | 6,448 | 1,600 | 0 | 0 |
| `vw-arm-history-v4-rddt-1d-2026-11-16` | batch store | sma | 1 | 663 | 633 | 159 | 0 | 0 |
| `vw-arm-history-v4-spy-1d-2026-11-16` | batch store | sma | 1 | 8,504 | 6,448 | 1,600 | 0 | 0 |
| `vw-arm-history-v5-rddt-1d-2026-11-16` | batch store | sma | 1 | 663 | 633 | 158 | 0 | 0 |
| `vw-arm-history-v5-spy-1d-2026-11-16` | batch store | sma | 1 | 8,504 | 6,448 | 1,600 | 0 | 0 |
| `vw-call-site-history-rddt-1d-2026-10-01` | committed | sma | 1 | 633 | 543 | 489 | 488 | 488 |
| `vw-call-site-history-spy-1d-2026-10-01` | committed | sma | 1 | 1,798 | 1,743 | 1,581 | 1,569 | 1,569 |
| `vw-cs1-calc-bars-rddt-1d-2026-11-14` | committed | sma | 1 | 91 | 89 | 40 | 0 | 0 |
| `vw-cs2-sma-exact-tie-rddt-1d-2026-11-15` | committed | sum | 1 | 662 | 637 | 189 | 0 | 0 |
| `vw-cs2-sma-exact-tie-spy-1d-2026-11-15` | committed | sum | 1 | 8,503 | 6,561 | 1,852 | 0 | 0 |
| `vw-cs2-v4-ternary-lazy-rddt-1d-2026-11-15` | committed | sma | 1 | 662 | 632 | 158 | 0 | 0 |
| `vw-ema-last-bit-rddt-1d-2026-11-16` | batch store | sma | 1 | 654 | 595 | 281 | 0 | 0 |
| `vw-ema-last-bit-spy-1d-2026-11-16` | batch store | sma | 1 | 8,495 | 7,494 | 3,334 | 0 | 0 |
| `vw-fn-series-history-rddt-1d-2026-09-30` | committed | sma | 1 | 632 | 542 | 488 | 487 | 487 |
| `vw-hist-frac-length-rddt-1d-2026-11-16` | batch store | sma | 2 | 1,327 | 1,227 | 303 | 0 | 0 |
| `vw-hist-frac-length-spy-1d-2026-11-16` | batch store | sma | 2 | 17,009 | 13,419 | 3,175 | 0 | 0 |
| `vw-hist-frac-length-v3-rddt-1d-2026-11-16` | batch store | sma | 3 | 1,980 | 1,786 | 695 | 0 | 0 |
| `vw-hist-frac-length-v3-spy-1d-2026-11-16` | batch store | sma | 3 | 25,503 | 20,805 | 7,242 | 0 | 0 |
| `vw-hist-frac-length-v4-rddt-1d-2026-11-16` | batch store | sma | 2 | 1,327 | 1,227 | 302 | 0 | 0 |
| `vw-hist-frac-length-v4-spy-1d-2026-11-16` | batch store | sma | 2 | 17,009 | 13,419 | 3,175 | 0 | 0 |
| `vw-hist-frac-length-v5-rddt-1d-2026-11-16` | batch store | sma | 2 | 1,327 | 1,227 | 303 | 0 | 0 |
| `vw-hist-frac-length-v5-spy-1d-2026-11-16` | batch store | sma | 2 | 17,009 | 13,419 | 3,176 | 0 | 0 |
| `vw-wsc-h8-ta-in-loop-rddt-1d-2026-11-16` | batch store | sma | 1 | 665 | 468 | 87 | 0 | 0 |

## What changed

- `interpret.js::exactSum` (new, exported): the exactly rounded sum. A compensated sum with a certificate
  (TwoSum errors plus a bound on summing them; where the rounded result is provably the exact rounding it
  answers) and Shewchuk's partials with `math.fsum`'s half-even final rounding everywhere else. Identical to
  Python's `math.fsum` on 23,000 / 23,000 random windows (adversarial magnitudes included).
- `windowMean` (`ta.sma`, also behind `bb`'s basis and every expansion that reaches `FINITE_WINDOW.sma`) and
  `windowSum` (`math.sum`, v4 `sum`) call it. The runtime VM's `OP.WINDOW` sites read the SAME
  `FINITE_WINDOW[fn].reduce`, so both lanes move together; the VM's ring buffer is refilled in bar order,
  and the exact sum is order-independent in any case.
- Python twin: `ast_interpret._exact_sum` (`math.fsum`), used by `_window_mean` and `_window_sum`; reached
  by alerts, scans and backtests through `FN["sma"]` / `indicator_compute.compute_sma`.
- Unchanged: `ta.wma` (left-to-right, witnessed above), `ta.stdev`, `ta.dev` (their centre stays the
  left-to-right mean), `ta.vwma` and every other reducer.
- A window holding an infinity, or whose sum overflows, answers the left-to-right sum as before (both twins;
  `math.fsum` raises on both).

## What a member sees

Nothing on the screen: the change is in the last bit of a double. What changes is every comparison built on
an sma or a sum that used to tip on that bit: `ta.change(ta.sma(...)) > 0`, crosses of an sma against a value
it equals, `sma == sma[1]` on a flat window, alert conditions on those. Those now agree with TradingView.

## Cost (5,000-bar `sma(200)`, SPY closes, median of 11-15 runs, this PC)

| reducer | ms |
|---|---:|
| left-to-right (before) | 0.5 |
| exactly rounded, shipped (certificate + fallback) | 3.5-4.3 |
| Shewchuk partials alone | 13 |
| Shewchuk with a JS array (first draft) | 37-42 |

The certificate falls back to the partials on 0.7% of real SPY windows. The runtime pane's budget is 1,000 ms
per pane (`RUNTIME_PANE_TIME_BUDGET_MS`); a script with ten sma(200) series pays about 35 ms more.

## Rails and mutants

- `app/src/components/chart/engine/ast/__tests__/smaExactSum.test.js`: the exact sum against fixed cases
  (ties to even, a case where Neumaier is wrong, infinity and overflow), order independence, both committed
  `vw-cs2-sma-exact-tie` captures bit for bit on the columnar lane (T02 sma5, T05 sum5) and on the runtime
  VM's own window, the fixture's power to tell (left-to-right misses > 100 bars), `ta.wma` left-to-right on a
  window where the two weighted sums differ, and the na-guard A02 / E02 block (runs when that capture is
  committed by the capture session's data PR; until then it is skipped by name).
- `tests/test_ast_sma_exact_sum.py`: the Python twin on the same captures and cases.
- Mutants (each restored from a copy, never `git checkout`): 9 / 9 killed: JS sma left-to-right, JS sum
  left-to-right, certificate dropped (plain Neumaier), no half-even final rounding, `ta.wma` made exact,
  infinity fallback dropped, Python exact sum made left-to-right, Python sma and sum bypassing it.

## Open

- `vw-pt-na-guard-and-spy-1d-2026-11-16` is in the batch store, not committed; the A02 / E02 rail runs as
  soon as the capture session commits it.
- `ta.stdev`'s formula: one plot misses everywhere under every sum. Needs its own probe (population vs
  sample divisor, two-pass vs `sqrt(mean(x^2) - mean(x)^2)`) before its sum is touched.
