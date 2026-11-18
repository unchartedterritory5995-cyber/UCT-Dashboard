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
  2026-10-01 (`vw-call-site-history-{rddt,spy}-1d-2026-10-01`, `vw-fn-series-history-rddt-1d-2026-09-30`).
  They are THAT ERA'S DATA, NOT THE SUMMATION: in those captures every reading misses, all four sums alike,
  at a relative error of at most 1.3e-15 (the bars or their serialisation then differ from TradingView's
  own operands in the last bits). Every capture taken from 2026-11-14 on: 0 for both exact sums.
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

### Server side (screener / alerts / backtests), this PC, outside the lock

3,742 tickers x (`sma(50)` + `sma(200)`) x 1,500 daily bars, synthetic random-walk closes rounded to cents,
through the exact code that runs:

| lane | before | after |
|---|---:|---:|
| Python, `ast_interpret._rolling` (what `FN["sma"]` / `compute_sma` run), two runs each | 55.8 s, 50.9 s | **22.5 s, 22.8 s** |
| JS columnar `interpret()` (the Pine runtime service's lane), two runs each | 46.4 s, 47.1 s | **4.1 s, 4.1 s** |

⭐ The JS figure is the SLIDING form (`rollingExactSum`). `exactSum` per window alone measured 58.5 s here,
+28% over before, which is what made the sliding form necessary: for a series with no `na`, every add and
subtract is a TwoSum, so `s` plus the sum of the errors is the window sum exactly after any number of steps.
The same certificate (lost + the error bound strictly inside half a gap) gives the exactly rounded value in
O(1) per bar; anywhere else the bar answers `exactSum` and the state restarts from that window. The old
`skip` path allocated a fresh window buffer per bar, which is why the after figure is 11x faster than before
rather than merely level. The runtime VM keeps the per-window reducer (it fills one ring per site; a script
pays about 3.5 ms more per 5,000-bar sma(200), see above).

The Python twin got FASTER: the left-to-right mean was a Python-level loop, `math.fsum` is one C call on the
window slice. ⭐ The first draft scanned each window for NaN and infinity in Python before the call and was 3x
SLOWER than before (200 tickers: 2.2 s -> 8.1 s); `math.fsum` already answers NaN for a NaN and the infinity
for one-signed infinities, so the shipped twin hands it the slice and only catches its two raises (overflow,
`inf + -inf`) to fall back to the left-to-right sum.

## Armed alerts (server lane): a re-freeze of the fire log, approved

`price_vs_ma` (`close - sma(close, n)`) is the one alert address on `sma`. Ruling (coordinator, 2026-11-16,
under the owner's "you decide" mandate): RE-FREEZE, no second SMA authority; alerts agree with the chart and
with TradingView. `docs/runbooks/alert-replay-gate.md` lists it as sanctioned re-freeze 3.

1. **Value-blind proof.** Replaying all 11 frozen fixtures with the RETIRED left-to-right mean swapped back
   into `ast_interpret` reproduces the previously committed `fire_log_forming.json` BYTE FOR BYTE: 11 / 11
   fixtures, every block, every digest. The replay is therefore the recorded code, and the only thing the
   re-freeze moves is the sum.
2. **What moved under the exact sum.** 22 of 22 (fixture, k) blocks changed digest; 132 per-alert entries
   moved and EVERY ONE is `price_vs_ma`. 25,454 fires present under both sums moved their VALUE only
   (the last bits). 54 fire rows are present under ONE sum only, at 21 distinct (fixture, bar, alert)
   points: each is an above/below pair swapping at one bar, or (spy_daily bar 282) a fire that neither side
   gives once the value sits exactly on the threshold (`above` is `>`, `below` is `<`). Every one is an
   EQUALITY EDGE: |value - threshold| is at most **3.79 ulps of the bar's close** (`close - sma` cancels, so
   the same margin reads up to 877 ulps of the small threshold). None is a genuine move. Totals: spy_daily
   k=1 29378 -> 29377 and k=4 114846 -> 114845 (it gives back the fire the 2026-08-09 SMA de-duplication
   added); every other block total is unchanged; grand total 1,153,247 -> 1,153,245.
3. **Re-frozen** with `tools/alert_replay.py --record --force` on this tree. `--record` does not carry the
   log's `appended` / `rerecorded` provenance, so both were put back and this re-record appended as
   `rerecorded[1]` with its reason and proof. `--check` after: FIRE LOG MATCHES, exit 0.
   `tests/test_alert_replay.py`'s `_FROZEN_EIGHT` table is regenerated from the re-frozen log.
   `tests/test_indicator_alert_evaluator.py` keeps its recording half untouched; its current-lane half now
   names an independent `math.fsum` SMA, and 0 of 5,040 recorded `triggered` booleans flip.

### Every fire that changed

| fixture | k | bar | sample | alert (address / side / threshold) | fires under | value that fired | bar close | margin, ulps of the close | margin, ulps of the threshold |
|---|---:|---:|---:|---|---|---:|---:|---:|---:|
| spy_daily | 1 | 282 | 0 | price_vs_ma / above / -4.4846 | retired only | -4.484599999999887 | 682.85 | 1.00 | 128 |
| spy_daily | 1 | 366 | 0 | price_vs_ma / above / 12.7158 | exact only | 12.715800000000058 | 740.96 | 0.52 | 33 |
| spy_daily | 1 | 366 | 0 | price_vs_ma / below / 12.7158 | retired only | 12.715799999999945 | 740.96 | 0.48 | 31 |
| spy_daily | 4 | 282 | 3 | price_vs_ma / above / -4.4846 | retired only | -4.484599999999887 | 682.85 | 1.00 | 128 |
| spy_daily | 4 | 366 | 3 | price_vs_ma / above / 12.7158 | exact only | 12.715800000000058 | 740.96 | 0.52 | 33 |
| spy_daily | 4 | 366 | 3 | price_vs_ma / below / 12.7158 | retired only | 12.715799999999945 | 740.96 | 0.48 | 31 |
| wick_that_unwinds | 1 | 60 | 0 | price_vs_ma / above / 2.001 | exact only | 2.0010000000000048 | 102.85 | 0.34 | 11 |
| wick_that_unwinds | 1 | 60 | 0 | price_vs_ma / below / 2.001 | retired only | 2.000999999999962 | 102.85 | 2.66 | 85 |
| wick_that_unwinds | 4 | 60 | 0 | price_vs_ma / above / 2.001 | exact only | 2.0010000000000048 | 102.85 | 0.34 | 11 |
| wick_that_unwinds | 4 | 60 | 1 | price_vs_ma / above / 2.001 | exact only | 2.0010000000000048 | 102.85 | 0.34 | 11 |
| wick_that_unwinds | 4 | 60 | 2 | price_vs_ma / above / 2.001 | exact only | 2.0010000000000048 | 102.85 | 0.34 | 11 |
| wick_that_unwinds | 4 | 60 | 3 | price_vs_ma / above / 2.001 | exact only | 2.0010000000000048 | 102.85 | 0.34 | 11 |
| wick_that_unwinds | 4 | 60 | 0 | price_vs_ma / below / 2.001 | retired only | 2.000999999999962 | 102.85 | 2.66 | 85 |
| wick_that_unwinds | 4 | 60 | 1 | price_vs_ma / below / 2.001 | retired only | 2.000999999999962 | 102.85 | 2.66 | 85 |
| wick_that_unwinds | 4 | 60 | 2 | price_vs_ma / below / 2.001 | retired only | 2.000999999999962 | 102.85 | 2.66 | 85 |
| wick_that_unwinds | 4 | 60 | 3 | price_vs_ma / below / 2.001 | retired only | 2.000999999999962 | 102.85 | 2.66 | 85 |
| gap_open_5m | 1 | 156 | 0 | price_vs_ma / above / -0.5506 | retired only | -0.5505999999999744 | 240.01 | 0.90 | 230 |
| gap_open_5m | 1 | 228 | 0 | price_vs_ma / above / 2.5058 | retired only | 2.5058000000001073 | 243.8 | 3.78 | 242 |
| gap_open_5m | 1 | 156 | 0 | price_vs_ma / below / -0.5506 | exact only | -0.5506000000000313 | 240.01 | 1.10 | 282 |
| gap_open_5m | 1 | 228 | 0 | price_vs_ma / below / 2.5058 | exact only | 2.5057999999999936 | 243.8 | 0.22 | 14 |
| gap_open_5m | 4 | 156 | 3 | price_vs_ma / above / -0.5506 | retired only | -0.5505999999999744 | 240.01 | 0.90 | 230 |
| gap_open_5m | 4 | 228 | 3 | price_vs_ma / above / 2.5058 | retired only | 2.5058000000001073 | 243.8 | 3.78 | 242 |
| gap_open_5m | 4 | 156 | 3 | price_vs_ma / below / -0.5506 | exact only | -0.5506000000000313 | 240.01 | 1.10 | 282 |
| gap_open_5m | 4 | 228 | 3 | price_vs_ma / below / 2.5058 | exact only | 2.5057999999999936 | 243.8 | 0.22 | 14 |
| high_vol_5m | 1 | 87 | 0 | price_vs_ma / above / 0.1324 | exact only | 0.13240000000000407 | 124.2 | 0.29 | 147 |
| high_vol_5m | 1 | 169 | 0 | price_vs_ma / above / 1.9702 | exact only | 1.9702000000000055 | 126.0 | 0.39 | 25 |
| high_vol_5m | 1 | 87 | 0 | price_vs_ma / below / 0.1324 | retired only | 0.13239999999997565 | 124.2 | 1.71 | 877 |
| high_vol_5m | 1 | 169 | 0 | price_vs_ma / below / 1.9702 | retired only | 1.9701999999999913 | 126.0 | 0.61 | 39 |
| high_vol_5m | 4 | 87 | 0 | price_vs_ma / above / 0.1324 | exact only | 0.13240000000000407 | 124.2 | 0.29 | 147 |
| high_vol_5m | 4 | 87 | 1 | price_vs_ma / above / 0.1324 | exact only | 0.13240000000000407 | 124.2 | 0.29 | 147 |
| high_vol_5m | 4 | 87 | 2 | price_vs_ma / above / 0.1324 | exact only | 0.13240000000000407 | 124.2 | 0.29 | 147 |
| high_vol_5m | 4 | 87 | 3 | price_vs_ma / above / 0.1324 | exact only | 0.13240000000000407 | 124.2 | 0.29 | 147 |
| high_vol_5m | 4 | 169 | 3 | price_vs_ma / above / 1.9702 | exact only | 1.9702000000000055 | 126.0 | 0.39 | 25 |
| high_vol_5m | 4 | 87 | 0 | price_vs_ma / below / 0.1324 | retired only | 0.13239999999997565 | 124.2 | 1.71 | 877 |
| high_vol_5m | 4 | 87 | 1 | price_vs_ma / below / 0.1324 | retired only | 0.13239999999997565 | 124.2 | 1.71 | 877 |
| high_vol_5m | 4 | 87 | 2 | price_vs_ma / below / 0.1324 | retired only | 0.13239999999997565 | 124.2 | 1.71 | 877 |
| high_vol_5m | 4 | 87 | 3 | price_vs_ma / below / 0.1324 | retired only | 0.13239999999997565 | 124.2 | 1.71 | 877 |
| high_vol_5m | 4 | 169 | 3 | price_vs_ma / below / 1.9702 | retired only | 1.9701999999999913 | 126.0 | 0.61 | 39 |
| halfday_30m | 1 | 147 | 0 | price_vs_ma / above / 3.2288 | exact only | 3.228800000000092 | 683.6 | 0.81 | 207 |
| halfday_30m | 1 | 147 | 0 | price_vs_ma / below / 3.2288 | retired only | 3.2287999999999784 | 683.6 | 0.19 | 49 |
| halfday_30m | 4 | 147 | 3 | price_vs_ma / above / 3.2288 | exact only | 3.228800000000092 | 683.6 | 0.81 | 207 |
| halfday_30m | 4 | 147 | 3 | price_vs_ma / below / 3.2288 | retired only | 3.2287999999999784 | 683.6 | 0.19 | 49 |
| hourly_open_60m | 1 | 179 | 0 | price_vs_ma / above / -0.7018 | exact only | -0.7017999999999347 | 738.98 | 0.57 | 588 |
| hourly_open_60m | 1 | 179 | 0 | price_vs_ma / below / -0.7018 | retired only | -0.7018000000000484 | 738.98 | 0.43 | 436 |
| hourly_open_60m | 4 | 179 | 3 | price_vs_ma / above / -0.7018 | exact only | -0.7017999999999347 | 738.98 | 0.57 | 588 |
| hourly_open_60m | 4 | 179 | 3 | price_vs_ma / below / -0.7018 | retired only | -0.7018000000000484 | 738.98 | 0.43 | 436 |
| gap_daily | 1 | 132 | 0 | price_vs_ma / above / -1.3626 | retired only | -1.3625999999999934 | 27.29 | 1.88 | 30 |
| gap_daily | 1 | 124 | 0 | price_vs_ma / above / -6.418 | retired only | -6.417999999999992 | 23.22 | 2.25 | 9 |
| gap_daily | 1 | 132 | 0 | price_vs_ma / below / -1.3626 | exact only | -1.362600000000004 | 27.29 | 1.12 | 18 |
| gap_daily | 1 | 124 | 0 | price_vs_ma / below / -6.418 | exact only | -6.418000000000003 | 23.22 | 0.75 | 3 |
| gap_daily | 4 | 132 | 3 | price_vs_ma / above / -1.3626 | retired only | -1.3625999999999934 | 27.29 | 1.88 | 30 |
| gap_daily | 4 | 124 | 3 | price_vs_ma / above / -6.418 | retired only | -6.417999999999992 | 23.22 | 2.25 | 9 |
| gap_daily | 4 | 132 | 3 | price_vs_ma / below / -1.3626 | exact only | -1.362600000000004 | 27.29 | 1.12 | 18 |
| gap_daily | 4 | 124 | 3 | price_vs_ma / below / -6.418 | exact only | -6.418000000000003 | 23.22 | 0.75 | 3 |

### The deploy boundary: a live alert that already fired cannot fire again on that bar

What protects it is the fire-once key, and the key holds no value (`api/services/alert_fired_log.py::fire_key`):

- a LEVEL condition (`above` / `below`, which is what `price_vs_ma` offers) is keyed `ep:<arm_epoch>`, one
  fire per armed episode. The episode moves only through `indicator_alert_service._rearm`, called from
  `record_evaluation` when the condition is OBSERVED FALSE while the alert is `fired`. On a closed bar (the
  closed lane, `indicator_alert_evaluator.ALERT_EVAL_MODE`'s default `"closed"`) the post-deploy value is one deterministic number, so the same bar cannot be
  observed false and then true again: an alert that fired on bar t under the old sum and reads 1 ulp on the
  other side under the new one RE-ARMS on bar t and can fire again only on a later bar where the condition is
  true, which is the TradingView-consistent behaviour.
- a CROSS condition is keyed `bar:<bar_time>` and `UNIQUE(alert_id, fire_key)` holds one fire per bar
  whatever the value does. In the rollback `forming` lane, `prev` is the stored `last_value` written by the
  old code, so an equality-edge alert could see one crossing at the deploy instant; it is still one fire per
  bar at most.

No guard is added: the existing key already makes "fires twice on one bar" unreachable, and nothing in this
change touches it.

## Rails and mutants

- `app/src/components/chart/engine/ast/__tests__/smaExactSum.test.js`: the exact sum against fixed cases
  (ties to even, a case where Neumaier is wrong, infinity and overflow), order independence, both committed
  `vw-cs2-sma-exact-tie` captures bit for bit on the columnar lane (T02 sma5, T05 sum5) and on the runtime
  VM's own window, the fixture's power to tell (left-to-right misses > 100 bars), `ta.wma` left-to-right on a
  window where the two weighted sums differ, and `vw-pt-na-guard-and-{rddt,spy}-1d-2026-11-16` (capture
  batch 1, #1468; unconditional): A02 bit for bit, E02 and E03 on every bar, SPY bars 488 and 3009 flat, and
  the fixture's power to tell (the left-to-right mean reads a rise there).
- `tests/test_ast_sma_exact_sum.py`: the Python twin on the same captures and cases, na-guard A02 included.
- The sliding form is railed bar for bar against `exactSum` over price walks, scale jumps of 1e6,
  cancellation around 1e16, exact halves at powers of two and the window where a compensated sum rounds the
  wrong way (`[1e16, 1e-16, 1]`), for n = 1, 2, 5, 30, 200, sma and sum.
- Mutants (each restored from a copy, never `git checkout`): 13 / 14 killed. Killed: JS sma left-to-right,
  JS sum left-to-right, certificate dropped (plain Neumaier), no half-even final rounding, `ta.wma` made
  exact, infinity fallback dropped, sliding certificate dropped, sliding leaving value not subtracted, half
  gap doubled; Python exact sum made left-to-right, Python sma and sum bypassing it, Python overflow gate
  dropped. SURVIVED, equivalent by construction: M12, the sliding form's restart after a fallback. The
  TwoSum invariant holds across a fallback without it, so every answer is still exactly rounded; the
  restart only keeps errors carried from an earlier price scale from forcing later bars to fall back (a
  cost, not a value), which no value rail can see.

## Open

- `ta.rma`'s seed (`(sum of the first n) / n`, in `interpret.js` CARRIED.rma and `ast_interpret._smooth_col`)
  is still a left-to-right sum; no capture separates it yet. RSI / ATR over an `sma` source moved (they read
  the sma), their own seeds did not.
- `tools/ast_conformance.py --check` is red independent of this change (barstate / tf lane disagreements,
  cases not in its frozen log, engine HL digests); this change additionally moves the digests of the cases
  built on `sma` (`sma_of_close`, `stdev_band`, `bbw_close_20_2`, `bop_twenty`, `rsi_of_a_smoothed_series`,
  ...). Its log is not re-recorded here: it is not gated, and a re-record over unrelated reds would hide them.
- `ta.stdev`'s formula: one plot misses everywhere under every sum. Needs its own probe (population vs
  sample divisor, two-pass vs `sqrt(mean(x^2) - mean(x)^2)`) before its sum is touched.
