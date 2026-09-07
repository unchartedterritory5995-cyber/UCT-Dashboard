# Full-registry runtime baseline (offline, read-only, real bars.db)

Scope: same discipline as the prior two lab passes (6-family, then 22-family
"wide" cohort) — offline, read-only, real `C:\data\bars.db`, real
`build_context`/`detect_all` pipeline. This pass runs the **complete,
currently-registered detector set**, not a hand-picked subset.

## Step 1 — the real registry, measured

`full_registry.py` imports `api.routers.patterns` (via
`voice_tool_impls._ensure_pattern_detectors_loaded`, Compass's own
entrypoint) and reads `list_pattern_ids()` back. **Measured today: 85
registered pattern_ids** (`_probe_registry.py`'s output; full list in
`full_registry_result.json`'s `error_catalog.registered_pattern_ids`). Not
82, not 87, not the wide-cohort docstring's own uncounted "~103" guess.

## Step 2/3 — full run: pipeline, pool, fetch depth

Pool: reused verbatim from sibling worktree `pattern-intelligence-lab`
(`coverage_result.json`, 1,253 real tickers, ≥220 stored daily bars, ranked
by bar count desc — that commit lands 7 minutes after this branch's fix, so
the data is fresh). Fetch depth: 300 bars (`bars_ro.PATTERN_SCAN_DAILY_BARS`,
asserted equal to the shipped `api.main._PATTERN_SCAN_DAILY_BARS` every
run). Detection call: `detect_all(bars, ctx)`, `pattern_ids=None` — the
exact call `_scan_patterns_daily` makes.

**The four newly-reachable detectors, real data, real universe:**

| pattern_id | executed OK | errors | detections | fired? |
|---|---|---|---|---|
| `pullback_to_50sma` | 1253/1253 | 0 | 9 | **yes** |
| `golden_cross` | 1253/1253 | 0 | 10 | **yes** |
| `death_cross` | 1253/1253 | 0 | 11 | **yes** |
| `pullback_to_200sma` | 1253/1253 | 0 | 0 | no |

Three of four fire on real data. `pullback_to_200sma` runs clean on
every symbol (zero errors, zero skips) but finds no match — its conditions
(≥40% prior advance, stacked-bullish reclaim of a *rising* 200-SMA within
1–5 bars) describe a demanding, genuinely rare Stage-2 retest
(Weinstein/Minervini), and one calendar day is a thin sample for a rare
setup. Structurally reachable, honestly absent — thresholds untouched.

## Step 4 — measurements

| universe | scanned | wall | fetch | context | detect (full registry) | detections |
|---|---|---|---|---|---|---|
| 50   | 50   | 1.247s   | 0.066s | 0.005s | 1.175s   | 943 |
| 200  | 200  | 15.614s  | 0.503s | 0.052s | 15.044s  | 3,913 |
| 500  | 500  | 47.743s  | 2.330s | 0.179s | 45.174s  | 9,863 |
| 1,253 (full) | 1,253 | 116.444s | 6.082s | 0.441s | 109.777s | 24,030 |

**All 85 detectors were also called directly** (bypassing `detect_all`'s
swallow-and-log wrapper), all 1,253 symbols — 106,505 invocations, separate
pass, 93.19s. Result: **0 errored, 0 executed zero times.** Nothing skipped.

**Top 10 most expensive** (ms/call, direct-call pass, full pool):

| detector | ms/call | detections |
|---|---|---|
| `u_and_r` | 8.68 | 273 |
| `flat_base` | 8.40 | 76 |
| `inverse_head_shoulders` | 5.93 | 565 |
| `wyckoff_spring` | 3.58 | 57 |
| `wyckoff_upthrust` | 3.41 | 10 |
| `triple_bottom` | 2.75 | 252 |
| `cup_handle` | 2.43 | 55 |
| `inverse_cup_handle` | 2.04 | 20 |
| `remount` | 1.96 | 59 |
| `double_bottom` | 1.86 | 345 |

These 10 (11.8% of the registry) account for ~57% of summed per-detector
cost. None was in the 22-family sample, which measured only 3 "expensive"
fitters (`head_shoulders`, `triple_top`, `cup_handle`) and flagged the rest
as open — now answered: several run 3–14x pricier than that sample's worst
case (`cup_handle`: 0.61ms there vs. 2.43ms here, a larger pool).

**Redundant primitives** (`measure_duplication_full.py`, n=300): **29 of 85
(34%)** detectors independently call `detect_pivots(bars, window=3)` —
identical args, identical `bars` — while `build_context()` never calls it.
Up from 8 callers in the 22-family pass. Measured: build_context
166.9us/symbol; one needed call 363.9us; the other 28 identical calls cost
**9,993.5us/symbol combined — ~60x** the shared context cost (19x wide-pass,
3.4x originally — worse every widening), **~12.5s pure duplication (~11% of
detect wall-clock)** full-pool, for one primitive. Two more categories are
real but only file-counted, not timed: **16 detectors** define their own
SMA/EMA helper (`build_context` computes SMA10/20/50/150/200 but never
exposes them), and **17** define their own ATR helper — **no shared ATR
primitive exists** under `primitives/`.

## Step 5 — direct answer

**Worse than the 22-family conclusion, by more than detector count alone
explains.** Registry size grew 3.86x (22→85); full-pool wall time grew
**17.8x** (6.55s→116.4s); redundancy nearly tripled (19x→60x). The extra ~63
detectors are not "more of the same cheap kind" — several are the priciest
in the registry.

**Scaling is linear from rank 51 onward, not uniformly.** Marginal cost/symbol
is ~23.5ms for the top-50 (highest-bar-count) tickers, then a consistent
~85–100ms/symbol from rank 51 through 1,253 — linear over the bulk, but
composition-dependent at the edge (which tickers are sampled moves the
average more than sample size, likely pivot-count-driven combinatorial cost).
Real, not a harness bug — `n_skipped_thin=0`, 0 errors everywhere.

**Classification: USEFUL, trending toward LIKELY-REQUIRED.** Not a clear
blocker today: the hourly leaders pass (84 symbols) costs ~7s, and the
nightly full-cap_universe pass (3,742 symbols, a 1:00–3:00 AM ET window)
extrapolates to comfortably under budget — both background-only. But the
trend is monotonic, now measured at full scale, not projected: redundancy
nearly tripled, and 34% of the registry pays for a primitive `build_context`
could supply once. Caching `detect_pivots` would recover ~11% of detect time
free; it would not fix the dominant cost (a handful of expensive
combinatorial fitters) — a per-detector question, not a shared-primitive
one. No optimization implemented here.

## Files

`full_registry.py` (registry + pool + redundancy lists) · `bars_ro.py`
(read-only `mode=ro` accessor, 300-bar depth) · `benchmark_full_registry.py`
→ `full_registry_result.json` (Steps 2–4) · `measure_duplication_full.py` →
`duplication_full_result.json` · `coverage_result.json` (the pool) ·
`_probe_registry.py` (Step-1 probe).
