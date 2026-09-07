# Pattern-engine incremental-scan feasibility — local prototype results

Scope: bounded, offline, read-only. Cohort of 6 detector families (chosen
independently — no parallel workstream to coordinate with): candlestick
(`hammer`), structural/flag (`bull_flag`), growth/base (`vcp`), MA-pullback
(`pullback_to_50sma`), event/gap (`power_earnings_gap`), structure/regime
(`stage_analysis`). All numbers below are measured, not estimated, against
the real local `C:\data\bars.db` (~3GB, opened strictly `mode=ro`) using the
production read shape (`bars_sqlite.get_bars(sym,"D",200)`) and the real
`build_context` / `detect_all` pipeline (`api/main.py::_scan_patterns_daily`).

## Lookback each family actually needs (read from source, not assumed)
- `hammer`: `_MIN_BARS=6`; meaningful context scoring wants ~10-50 bars.
- `bull_flag`: hard gate `len(bars)>=30`; pole ≤20 + flag 3-20 bars, but
  `detect_pivots` runs over the **whole** supplied series regardless.
- `vcp`: `_MIN_PATTERN_BARS=30..90`, plus a 150/200-day SMA "trend template"
  precondition that fails **open** below 200 bars — genuinely wants up to 200.
- `pullback_to_50sma`: hard gate `len(bars) < 50*3 + 120//2` = **`< 210`**.
  Production fetches exactly 200 bars (`get_bars(sym,"D",200)`) — **200 < 210
  always** — so this gate can never pass in production today. Confirmed
  empirically: 0 detections, ~0.4µs/symbol (instant early return) at every
  universe size tested — a real, verifiable finding from reading the code.
- `power_earnings_gap`: last 30 bars + a 20-bar volume-avg lookback (~50 total).
- `stage_analysis`: `_WINDOW_BARS=200`, degrades gracefully below 30.

## Duplicated computation (measured, `measure_duplication.py`, n=300 real symbols)
`build_context()` already IS a once-per-symbol shared pass (SMA10/20/50/150/200,
volume signature, DCR, CAN SLIM) — costs **~48µs/symbol**. On top of that,
this 6-detector cohort independently **re-derives** primitives context already
computed, on the identical `bars`:
- `detect_pivots(bars, window=3)` — called separately by `vcp.py:112` **and**
  `bull_flag.py:65`. One of the two is pure waste: **~144µs/symbol**.
- `stage_analysis.py:95,101` calls `_trend_stage(bars)` and `_ma_alignment(bars)`
  — the exact same functions `build_context` already called on the exact same
  bars — then calls `_sma(closes,50/150/200)` **again**, directly, three more
  times (`stage_analysis.py:103-105`). ~15.4µs/symbol combined.
- `vcp.py:396-397` re-derives SMA150/SMA200 (duplicates of context's).
  ~2.5µs/symbol.
- `pullback_to_50sma.py:70` re-derives SMA50 (duplicate). ~0.6µs/symbol.

**Total measured redundant recompute: ~163µs/symbol — 3.4x the cost of the
entire shared context-build pass it's duplicating.** SMA-level duplication is
real but cheap (O(period) over ≤200 floats, single-digit µs); the pivot
duplication is ~88% of all measured waste — an O(n) fractal sweep re-run
twice for no reason.

## Benchmark: naive per-symbol scan at 50/200/500 real symbols
(`benchmark_naive.py`; symbols confirmed via read-only probe to hold ≥220
stored daily bars — 1,253 of 1,306 sampled cap_universe tickers qualified)

| universe | wall | fetch | context | detect (cohort) | detections |
|---|---|---|---|---|---|
| 50  | 0.145s | 0.115s | 0.003s | 0.026s | 72 |
| 200 | 0.377s | 0.266s | 0.012s | 0.097s | 286 |
| 500 | 0.808s | 0.487s | 0.028s | 0.238s | 699 |

Per-family avg (500-universe, 100-symbol sample): `bull_flag` 0.25ms,
`vcp` 0.15ms, `stage_analysis` 0.07ms, `power_earnings_gap` 0.009ms,
`hammer` 0.006ms, `pullback_to_50sma` ~0ms (dead gate, above). `bull_flag`+
`vcp` — the two `detect_pivots` callers — are 84% of all cohort detector time.

Wall-clock scaled **sub-linearly** (10x symbols → 5.6x wall-clock): per-symbol
fetch cost fell 2.3ms → 1.0ms as the run progressed (OS page-cache /
connection warm-up on the single reused read-only connection). No lock
contention or slowdown was observed against the live, actively-used
production file with one sequential reader.

## Shared-pass prototype (`benchmark_shared_pass.py`) — no source edited
In-process only: monkeypatched the 4 duplicated pure functions above
(`context._sma`, `context._trend_stage`, `context._ma_alignment`,
`pivots.detect_pivots`) with a per-symbol memoizing wrapper, on the actual
imported module objects — zero detector files touched. **Correctness
verified**: detection counts matched the naive run exactly at every universe
size (72/286/699). **Measured speedup, cohort detect-time only**: 500→
0.238s→0.199s (-16%), 200→ 0.097s→0.078s (-19%), 50→ 0.026s→0.021s (-18%).
Fetch-time differences between the two runs are **not** attributable to the
patch (later run benefits from a warmer OS page cache from the prior run) and
are excluded from this comparison.

## Classification
- **EASY TO UPDATE INCREMENTALLY**: `hammer`, `power_earnings_gap` — small
  bounded lookback (≤50 bars), cheap, genuinely event/recency-driven.
- **NEEDS LONGER HISTORY BUT STILL BAR-DRIVEN**: `bull_flag`, `vcp`,
  `pullback_to_50sma`, `stage_analysis` — all are pure functions of one
  symbol's own bar series (no cross-symbol state), so a per-symbol rolling
  history buffer would work in principle; today's implementation re-sweeps
  the whole fetched window every scan rather than updating incrementally.
- **EXPENSIVE-SUITED-TO-BATCH**: none observed in this 6-detector cohort —
  everything measured was sub-millisecond per symbol.
- **UNKNOWN**: the other ~84 registered detectors (classical multi-pivot
  fitters like `head_shoulders`/`triple_top` in particular) were not
  measured; scope discipline kept this cohort bounded to 6.

## Biggest concrete bottleneck actually observed
Not the DB (fetch amortizes down, never contended) and not any single
detector's own logic — it's **redundant recomputation of a shared primitive**
(`detect_pivots`), independently re-run by 2 of 6 cohort detectors on
identical input, costing ~3x the entire shared-context pass it duplicates.
Deduplicating just that call (plus trivial SMA sharing), with zero
detector-source changes, cut cohort detector-side wall-clock 16-19% at every
universe size tested.
