# Pattern-engine scale question, re-tested with a harder cohort

Scope: same discipline as the prior pass (RESULTS.md) — offline, read-only,
real local `C:\data\bars.db`, real `build_context`/`detect_all` pipeline, real
symbol pool (1,253 confirmed real tickers with >=220 daily bars,
`coverage_result.json`).

## The 22-family cohort and why (`wide_cohort.py`)

The prior pass benchmarked 6 easy-to-benchmark families and explicitly
flagged "classical multi-pivot fitters like head_shoulders/triple_top" as
likely expensive and unmeasured. This pass reuses those 6 (minus `bull_flag`,
already characterized) and adds 16 more, chosen by reading each candidate's
source:

- **candlestick** (single + multi-candle): `hammer`\*, `bearish_engulfing`, `morning_star`, `three_black_crows`
- **structural**: `stage_analysis`\*, `swing_pivots`, `support_resistance`, `major_trendlines`, `volume_profile_nodes`
- **EXPENSIVE** (verified by reading code, not guessed): `head_shoulders`,
  `triple_top`, `cup_handle` — each enumerates triples/pairs over the most
  recent 8-12 swing-pivots via a triple/double-nested Python loop
  (O(k^3)/O(k^2) candidate search), unlike every original-cohort detector,
  which is a single O(n) pass.
- **moving-average**: `pullback_to_50sma`\*, `pullback_to_10ema`, `golden_cross`
- **momentum/breakout**: `donchian_breakout`, `macd_bullish_cross`, `rsi_bullish_divergence`, `ascending_triangle`
- **event/gap**: `power_earnings_gap`\*, `episodic_pivot`
- **growth/base**: `vcp`\*

(\* = reused from the original 6-family cohort)

## Benchmark: 50 / 200 / 500 / full 1,253-symbol pool

(`benchmark_wide_cohort.py`; same real-symbol pool as the prior pass)

| universe | wall | fetch | context | detect (cohort) | detections |
|---|---|---|---|---|---|
| 50   | 0.294s | 0.035s | 0.005s | 0.253s | 488 |
| 200  | 0.883s | 0.124s | 0.022s | 0.730s | 2,014 |
| 500  | 2.258s | 0.281s | 0.046s | 1.605s | 5,097 |
| 1,253 (full) | 6.550s | 1.470s | 0.163s | 4.867s | 12,443 |

Scaling stayed roughly linear (500->1,253 is 2.5x symbols for 2.9x wall-clock;
no DB lock contention with the single sequential read-only reader). Unlike
the prior pass, per-symbol fetch cost **rose** at the largest size (0.56ms at
500 -> 1.17ms at full) rather than falling with a warming page cache — the
tail of the ranked-by-bar-count pool likely sits in colder, scattered pages.
A real, measured wrinkle, not a blocker: fetch stays a minority of wall-clock
(1.47s of 6.55s) and detect dominates.

## Per-family breakdown (500-universe, 100-symbol sample) and the outlier

| family | ms/symbol | vs. original cohort's worst (bull_flag, 0.25ms) |
|---|---|---|
| `cup_handle` | **0.612** | 2.4x |
| `triple_top` | 0.296 | 1.2x |
| `ascending_triangle` | 0.288 | 1.2x |
| `head_shoulders` | 0.289 | 1.2x |
| `support_resistance` | 0.315 | 1.3x |
| `swing_pivots`/`volume_profile_nodes`/`major_trendlines` | ~0.22-0.23 | ~0.9x |
| `stage_analysis`\* | 0.121 | matches prior pass |
| `hammer`\*/`golden_cross`/`episodic_pivot` | <=0.01 | trivially cheap |

**Yes, the newly-included heavy detectors behave differently.** The
triple-nested-loop pattern fitters (`cup_handle`, `head_shoulders`,
`triple_top`) and the emit-many-detections structural detectors
(`support_resistance`: 288 detections/100 symbols; `volume_profile_nodes`:
384/100) all run 1.2-2.4x the previous worst case. None is catastrophic
(still sub-millisecond/symbol), but "everything is cheap" from the easy-6
sample does NOT hold uniformly — it holds by a much smaller margin.

## Redundant computation: much worse than the original pass found

`measure_duplication_wide.py` (n=300 real symbols). `build_context()` — the
shared per-symbol pass — **never calls `detect_pivots`** (verified by reading
`primitives/context.py`). Yet **8 of the 22 detectors** independently call
`detect_pivots(bars, window=3)` on identical `bars` — 4x the original pass's
callers (`vcp` + `bull_flag`): `vcp`, `swing_pivots`, `support_resistance`,
`major_trendlines`, `head_shoulders`, `triple_top`, `cup_handle`,
`ascending_triangle`.

One (needed) call averages 170us/symbol; the other 7 identical, independent
calls cost **1,169us/symbol combined** — **~19x** the shared `build_context`
pass (63us/symbol), and ~36% of this cohort's total detect time (1.17ms of
3.21ms at the 500-symbol universe). The original pass found redundant
recompute at 3.4x context cost; the wider cohort found **~19x** — a broader
sample surfaces far more duplication, because independently re-running
`detect_pivots` is the default among structural/multi-pivot detectors, not a
rare coincidence. (Not counted, args differ: `fit_trendline` is also called
independently by `ascending_triangle` and `major_trendlines`, each on its own
pivot subset — a softer, partial overlap.)

## Direct answer to the scale question

**The core "scales fine past 84 symbols" conclusion holds — but not
unconditionally.** Wall-clock stayed linear-ish with no DB contention all the
way to the full real 1,253-symbol pool, completing in 6.55s — entirely
reasonable for a batch/scheduled scan, not a fundamental wall. But the
sub-second-at-500-symbols headline from the easy-6 cohort does **not**
survive: this harder, representative 22-family cohort takes 2.26s at 500
symbols, driven by (a) genuinely more expensive multi-pivot fitters (up to
2.4x the prior worst case) and (b) redundant `detect_pivots` recompute that
scales with detector count — 4x more callers than the easy-6 sample,
costing ~19x the context pass instead of 3.4x. Toward the full
~103-detector registry, both effects compound further. The scale conclusion
is real but was measured on an unrepresentatively cheap sample; the wider
sample shows the margin is narrower than it looked, and shared-primitive
caching (already prototyped in the prior pass, not re-attempted here) would
matter more, not less, at full registry scale.
