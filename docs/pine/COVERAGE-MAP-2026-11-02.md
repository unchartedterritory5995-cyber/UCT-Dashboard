# Pine coverage map, 2026-11-02 (W0 measurement refresh)

Measured 2026-11-02 on `origin/master` @ `6272ed7fa3` (includes the engine-4 work merged
2026-11-01/02). Previous map: [`COVERAGE-MAP.md`](COVERAGE-MAP.md) prose (10-30, `dadccbc98d`,
185 transfer) and the committed `coverage-map.json` (10-31, `b6a3046739`, 211 transfer); the
comparisons below are against the **10-31 JSON**, the last measurement through the same tooling.

Everything here was produced by the repo's own tooling, unmodified:
`tools/pine_coverage/run_census.py` (both lanes), `vendorHarness.corpus.test.js` (both lanes),
`tools/pine_coverage/coverage_map.py` (writes [`coverage-map.json`](coverage-map.json), regenerated
in this commit). The per-wall and per-wave script lists are a pure join over that JSON, written to
[`coverage-targets-2026-11-02.json`](coverage-targets-2026-11-02.json) (section 9 says how).

Inputs:
- **Sample**: the same 679 scripts (266 committed, 271 reference, 142 built-in), from the cached
  `fetch_sample.py` output; a fresh copy of the cache per lane.
- **TradingView v6 reference**: **regenerated today from TradingView's public bundles** with
  `tools/pine_survey/pine_reference_extract.js` (719 functions, 251 methods, 162 variables, 241
  constants; 295 whole-script examples, the same count as the previous map). The rebuilt
  stand-in (`ref_rebuilt.json`, 288 examples) was **not** needed and not used.
- **Captures**: 336 vendor captures in `tests/fixtures/vendor/harness` (unchanged since 10-31).

Definitions are unchanged from [`COVERAGE-MAP.md` section 1](COVERAGE-MAP.md#1-headline):
**transfers fully** = the production member door attaches the script with zero refusals, nothing
dropped or withheld, and it is not an order-placing strategy. **Runtime-on** = the same door with
the runtime pane on at every peel step, as a permitted member with every script graded (an upper
bound: the server's starter allowlist is not applied, and runtime-lane drawing is not graded).
These are door verdicts, not parity verdicts.

---

> **Status (2026-11-02).** All four measurements are done and summarised below: production
> census, runtime-on census, vendor harness both lanes, and the map (both lanes), all on master
> 6272ed7fa3. The optional engine-door probe (the `COVERAGE_DOOR_OUT` step in section 10) was NOT
> run for this measurement, so `engineTableThroughPineDoor` in `coverage-map.json` is EMPTY (the
> 10-31 map had 83 rows). No count in this document depends on it. The next W0 re-run, after the
> next merged waves, measures it with `--engine-door`.
> Raw census caches and harness outputs are not committed: the reference sources and fetched
> scripts are licence-held and stay local. The tables regenerate from `coverage-map.json` with
> `tools/pine_coverage/w0/targets.py` then `gen_md.py` (section 9).

## 1. Headline

> **Production lane: 211 of 679 (31.1%) transfer fully, unchanged since 10-31, script for script.**
> **Runtime-on lane: 250 of 679 (36.8%), up from 239 (+13 gained, -2 lost; runtime attaches 29 -> 41).**
> **Verified (transfers AND a TradingView capture MATCHes): 45 of 679 (6.6%), unchanged.**

What this means for ordering:
- Today's engine-4 work moved **only the runtime lane**. The production door, its walls and the
  greedy order are identical to 10-31 (every production wall row below has the same sole/blocks).
- The two runtime-lane losses are deliberate new refusals by name, not regressions: both now
  decline with `runtime:conditional-history` (history-keeping call in one arm of `?:` / a branch
  that does not run every bar), which is the refuse-by-name rule working:
  `builtin:mcginley-dynamic` (line 6, `ta.ema` in a `?:` arm) and
  `reference:williams-vix-fix-bottoms-and-tops` (line 32, `ta.sma` in a `?:` arm).
  `runtime:conditional-history` is now a **33-script runtime wall** (section 4).
- Runtime-on parity: 111 MATCH / 107 DIVERGE / 118 INCONCLUSIVE over the 336 captures, against
  production's 93 / 103 / 140 (18 INCONCLUSIVE->MATCH, 4 INCONCLUSIVE->DIVERGE, nothing that
  MATCHes in production changes). On 10-31 it was 108 / 108 / 120 (15 ->MATCH, 5 ->DIVERGE).

## 2. Numbers against the previous map

| measure | 2026-10-31 (`b6a3046739`) | 2026-11-02 (`6272ed7fa3`) | change |
|---|---:|---:|---:|
| Transfer fully, production lane | 211 (31.1%) | **211 (31.1%)** | +0 |
| Attach in any form, production lane | 285 (42.0%) | **285 (42.0%)** | +0 |
| Step-0 runtime counterfactual (production census) | 239 (35.2%) | **250 (36.8%)** | +11 |
| Transfer, RUNTIME-ON lane (pane on at every peel step) | 239 (35.2%) | **250 (36.8%)** | +11 |
| Runtime lane attaches (runtime-on) | 29 (4.3%) | **41 (6.0%)** | +12 |
| Transfer fully AND a TradingView capture MATCHes | 45 (6.6%) | **45 (6.6%)** | +0 |
| TradingView reference examples that transfer (of 295) | 77 (26.1%) | **77 (26.1%)** | +0 |

Vendor harness, production lane: {"DIVERGE": 103, "INCONCLUSIVE": 140, "MATCH": 93} (prev {"DIVERGE": 103, "INCONCLUSIVE": 140, "MATCH": 93}). Runtime-on: {"DIVERGE": 107, "INCONCLUSIVE": 118, "MATCH": 111}; changed vs production: {"INCONCLUSIVE->DIVERGE": 4, "INCONCLUSIVE->MATCH": 18}.

Runtime-on vs production: +39 added, -0 lost. Lost: none

Gained since 10-31 (production): none

Lost since 10-31 (production): none

### by population / version / declaration
| slice | scripts | transfer | % | runtime-on |
|---|---:|---:|---:|---:|
| committed | 266 | 56 | 21.1 | 78 |
| reference | 271 | 84 | 31.0 | 95 |
| builtin | 142 | 71 | 50.0 | 77 |
| Pine v1-v3 | 85 | 48 | 56.5 | |
| Pine v4 | 132 | 40 | 30.3 | |
| Pine v5 | 191 | 37 | 19.4 | |
| Pine v6 | 271 | 86 | 31.7 | |
| `indicator()` | 609 | 211 | 34.6 | |
| `strategy()` | 70 | 0 | 0.0 | |

Runtime-on gained since 10-31 (13): `builtin:time-weighted-average-price`, `builtin:williams-fractal`,
`committed:fair-value-gap`, `committed:inside-bar-boxes`, `committed:macd-with-filter-visual-backtest-module-sample`,
`committed:machine-learning-knn-based-strategy`, `committed:order-block-finder`,
`committed:williams-fractal-trailing-stops`, `reference:auto-fibonacci-and-gann-fanretracements-combo`,
`reference:best-sr-indicator-with-candlestick-patterns`, `reference:logistic-rsi-stoch-roc-ao-by-dgt`,
`reference:market-structure-with-inducements-sweeps-luxalgo`, `reference:non-repainting-swing-highlow-signals`.
Runtime-on lost since 10-31 (2, both deliberate `runtime:conditional-history` refusals, section 1):
`builtin:mcginley-dynamic`, `reference:williams-vix-fix-bottoms-and-tops`.
Two order-placing strategies now attach on the runtime lane (`builtin:parabolic-sar-strategy`,
`reference:trailing-sl-strategy-quantnomad`); they do not count (no broker simulation, W9).

Walls fully enumerated: production 215 of 468 non-transferring scripts; runtime-on 166 of 429.
For the rest the peel stopped (8-step cap, whole-program refusal, no progress), so "sole" /
"only this wave left" are **upper bounds** for them; "firm" counts only fully enumerated scripts.

## 3. Production lane: walls, ranked

Same method as [`COVERAGE-MAP.md` section 3](COVERAGE-MAP.md#3-top-30-blockers-ranked-by-scripts-unblocked)
(peel through the member door, up to 8 steps). **sole** = the only wall found; **blocks** = has
the wall at all. "wave" is the plan wave that owns the capability (mapping in section 9).
Every row is identical to 10-31.

| # | wall | capability | wave | sole | blocks | prev sole/blocks |
|---:|---|---|---|---:|---:|---|
| 1 | [drawing-objects] | drawing-objects | W3 | 55 | 105 | 55/105 |
| 2 | [imperative] | imperative | W4 | 48 | 185 | 48/185 |
| 3 | [strategy] | strategy | W9 | 37 | 70 | 37/70 |
| 4 | request.security | request-security | W7 | 15 | 49 | 15/49 |
| 5 | [imports-libraries] | imports-libraries | W8 | 10 | 65 | 10/65 |
| 6 | [translator-robustness] | translator-robustness | W1 | 7 | 34 | 7/34 |
| 7 | [output-contract] | output-contract | other | 6 | 6 | 6/6 |
| 8 | [history-offsets] | history-offsets | W4 | 4 | 22 | 4/22 |
| 9 | [udt-methods] | udt-methods | W6 | 4 | 21 | 4/21 |
| 10 | object op dropped: cell:text | drawing-objects | W3 | 3 | 48 | 3/48 |
| 11 | object op dropped: create:label | drawing-objects | W3 | 3 | 37 | 3/37 |
| 12 | [user-functions] | user-functions | W4 | 2 | 54 | 2/54 |
| 13 | time | builtin-missing | W1 | 2 | 16 | 2/16 |
| 14 | array.get | collections | W6 | 2 | 7 | 2/7 |
| 15 | ta.sar | builtin-missing | W1 | 2 | 3 | 2/3 |
| 16 | object op dropped: guard:loop | drawing-objects | W3 | 1 | 22 | 1/22 |
| 17 | [text-colour-values] | text-colour-values | W4 | 1 | 8 | 1/8 |
| 18 | ta.barssince | builtin-missing | W1 | 1 | 8 | 1/8 |
| 19 | array.unshift | collections | W6 | 1 | 4 | 1/4 |
| 20 | input.time | builtin-missing | W1 | 1 | 4 | 1/4 |
| 21 | ta.valuewhen | builtin-missing | W1 | 1 | 3 | 1/3 |
| 22 | [tuples] | tuples | W4 | 0 | 49 | 0/49 |
| 23 | object op dropped: guard:create | drawing-objects | W3 | 0 | 36 | 0/36 |
| 24 | object op dropped: create:line | drawing-objects | W3 | 0 | 25 | 0/25 |
| 25 | object op dropped: guard:update | drawing-objects | W3 | 0 | 24 | 0/24 |
| 26 | object op dropped: update:props | drawing-objects | W3 | 0 | 19 | 0/19 |
| 27 | object op dropped: coll:diverged | drawing-objects | W3 | 0 | 16 | 0/16 |
| 28 | object op dropped: guard:delete | drawing-objects | W3 | 0 | 16 | 0/16 |
| 29 | object op dropped: loop:empty | drawing-objects | W3 | 0 | 16 | 0/16 |
| 30 | strategy.position_size | strategy | W9 | 0 | 11 | 0/11 |
| 31 | object op dropped: loop:bounds | drawing-objects | W3 | 0 | 10 | 0/10 |
| 32 | object op dropped: geometry:lost | drawing-objects | W3 | 0 | 9 | 0/9 |
| 33 | line.delete | drawing-objects | W3 | 0 | 8 | 0/8 |
| 34 | object op dropped: coll:push | drawing-objects | W3 | 0 | 8 | 0/8 |
| 35 | object op dropped: guard:cell | drawing-objects | W3 | 0 | 8 | 0/8 |
| 36 | object op dropped: guard:coll_push | drawing-objects | W3 | 0 | 8 | 0/8 |
| 37 | array.push | collections | W6 | 0 | 7 | 0/7 |
| 38 | array.remove | collections | W6 | 0 | 6 | 0/6 |
| 39 | object op dropped: content:lost | drawing-objects | W3 | 0 | 6 | 0/6 |
| 40 | object op dropped: geometry:withheld | drawing-objects | W3 | 0 | 6 | 0/6 |

### 3.1 By capability, greedy order (`capabilities.greedyRoadmap`, the tool's own order)

| step | capability | wave | blocks | unblocks | firm | cumulative | prev unblocks |
|---:|---|---|---:|---:|---:|---:|---:|
| 1 | drawing-objects | W3 | 196 | 108 | 59 | 319 (47.0%) | 108 |
| 2 | imperative | W4 | 185 | 59 | 22 | 378 (55.7%) | 59 |
| 3 | strategy | W9 | 70 | 46 | 17 | 424 (62.4%) | 46 |
| 4 | request-security | W7 | 52 | 28 | 15 | 452 (66.6%) | 28 |
| 5 | imports-libraries | W8 | 65 | 26 | 7 | 478 (70.4%) | 26 |
| 6 | tuples | W4 | 49 | 28 | 9 | 506 (74.5%) | 28 |
| 7 | user-functions | W4 | 54 | 29 | 7 | 535 (78.8%) | 29 |
| 8 | builtin-missing | W1 | 47 | 35 | 22 | 570 (83.9%) | 35 |
| 9 | translator-robustness | W1 | 34 | 29 | 25 | 599 (88.2%) | 29 |
| 10 | collections | W6 | 25 | 22 | 11 | 621 (91.5%) | 22 |
| 11 | history-offsets | W4 | 22 | 20 | 10 | 641 (94.4%) | 20 |
| 12 | udt-methods | W6 | 21 | 20 | 6 | 661 (97.3%) | 20 |
| 13 | text-colour-values | W4 | 8 | 8 | 4 | 669 (98.5%) | 8 |
| 14 | output-contract | other | 6 | 6 | 0 | 675 (99.4%) | 6 |
| 15 | call-mapping | W1 | 4 | 4 | 1 | 679 (100.0%) | 4 |

## 4. Runtime-on lane: walls, ranked

The runtime lane's own wall per peel step (`runtimeOn.walls.byScript`: the probe's guard, else its
decline code, else `host:<guards>` for a refusal the runtime lane was never offered). Touches over
the 429 scripts that do not transfer with the pane on.

| # | runtime-lane wall | wave | scripts (touches) |
|---:|---|---|---:|
| 1 | `pine:statement` | W4 | 76 |
| 2 | `pine:builtin` | W1 | 73 |
| 3 | `runtime:call-undeclared-builtin-state` | W4 | 68 |
| 4 | `runtime:library` | W8 | 64 |
| 5 | `pine:function` | W1 | 53 |
| 6 | `runtime:history-dynamic-offset` | W4 | 40 |
| 7 | `runtime:no-output` | W4 | 38 |
| 8 | `runtime:object-op` | W4 | 35 |
| 9 | `runtime:conditional-history` | W4 | 33 |
| 10 | `pine:request` | W7 | 31 |
| 11 | `runtime:history-expression` | W4 | 28 |
| 12 | `runtime:function` | W4 | 27 |
| 13 | `runtime:statement` | W4 | 24 |
| 14 | `runtime:expression-statement` | W4 | 23 |
| 15 | `runtime:array` | W6 | 22 |
| 16 | `host:pine:constant-only` | other | 20 |
| 17 | `runtime:block-value` | W4 | 16 |
| 18 | `runtime:request` | W7 | 15 |
| 19 | `runtime:presentation` | W4 | 15 |
| 20 | `runtime:loop` | W4 | 15 |
| 21 | `pine:strategy-call` | W9 | 14 |
| 22 | `runtime:call-windowed-state` | W4 | 12 |
| 23 | `runtime:call-text-state` | W4 | 12 |
| 24 | `runtime:request-with-state` | W7 | 11 |
| 25 | `runtime:unbound` | W4 | 11 |
| 26 | `lower-tf:store-unmeasured` | W7 | 9 |
| 27 | `runtime:nothing-drawn` | W4 | 8 |
| 28 | `runtime:colour` | W4 | 8 |
| 29 | `runtime:function-global-state` | W4 | 7 |
| 30 | `pine:state` | W4 | 6 |
| 31 | `pine:arity` | W1 | 5 |
| 32 | `pine:offset-literal` | W4 | 4 |
| 33 | `pine:type` | W6 | 4 |
| 34 | `pine:collection` | W6 | 4 |
| 35 | `runtime:tuple` | W4 | 4 |
| 36 | `pine:drawing` | W3 | 4 |
| 37 | `runtime:fill-target` | W4 | 4 |
| 38 | `pine:window` | W4 | 3 |
| 39 | `lower-tf:lookahead` | W7 | 3 |
| 40 | `runtime:directive` | W4 | 3 |

**Caveat on `pine:builtin` / `pine:function` in this lane (W1 count).** 122 runtime-on scripts
carry a missing-name wall, but only **68** of them name a real Pine v6 item; for **54** every missing
name is a user function, a library alias or a UDT field (`f_security`, `zigzag.newInstance`,
`loxxexpandedsourcetypes.rclose`, `TVta.kama`, `lastH.time`...). Those belong to W4 (user
functions), W8 (libraries) and W6 (UDT fields), not to W1. Real Pine names the runtime lane
lacks, by scripts: `time()` forms 16, `barstate.isnew` 5, `chart.left_visible_bar_time` 4,
`syminfo.type` 4, `timeframe.change` 3, `chart.right_visible_bar_time` 3, `ticker.heikinashi` 3,
`ta.dmi` 3, `box()`/`line()`/`label()`/`color()` casts 3/3/2/3, `ta.sar` 2, `session.isfirstbar` 2,
`str.tonumber` 2, `math.e` 2, `interval` 2, `string()` 2, `input.string` (as an input kind) 2,
then singles (`syminfo.volumetype`, `math.toradians`, ...).

## 5. Wave order (greedy over plan waves)

Each script's walls mapped to the wave that owns them; close the wave that unblocks the most,
then the next. Upper bounds (see section 2). The runtime-on column starts from 250 and counts
the 68 host-attached-but-dirty scripts (objects dropped / paint withheld, never offered to the
runtime lane: the WS-J routing gap) as W3.

| step | production lane: wave | unblocks | cumulative | runtime-on lane: wave | unblocks | cumulative |
|---:|---|---:|---:|---|---:|---:|
| 1 | W3 | 108 | 319 (47.0%) | W4 | 88 | 338 (49.8%) |
| 2 | W4 | 100 | 419 (61.7%) | W3 | 72 | 410 (60.4%) |
| 3 | W1 | 54 | 473 (69.7%) | W1 | 57 | 467 (68.8%) |
| 4 | W9 | 56 | 529 (77.9%) | W9 | 57 | 524 (77.2%) |
| 5 | W8 | 49 | 578 (85.1%) | W7 | 48 | 572 (84.2%) |
| 6 | W7 | 50 | 628 (92.5%) | W8 | 51 | 623 (91.8%) |
| 7 | W6 | 45 | 673 (99.1%) | W6 | 35 | 658 (96.9%) |
| 8 | other | 6 | 679 (100.0%) | other | 21 | 679 (100.0%) |

**Reading it.** On the production lane W3 (drawing completeness) is still the biggest single
lever (+108, 59 firm). With the runtime lane armed, W4 becomes first (+88) and W3 second (+72,
of which 68 are the routing gap: scripts the host attaches with a dropped object or withheld
paint, which the runtime lane is never offered). W1 is third on both lanes and is the cheapest.
W9 (strategies) is +56/+57 but is a quarter-plus of work.

## 6. Per-wave target script lists

Counts per wave, both lanes. **blocks** = scripts with at least one wall the wave owns (its
target set). **only this wave left** = closing this wave alone makes them transfer (upper bound;
production **firm** = fully enumerated). Full `blocks` lists for every wave are in
`coverage-targets-2026-11-02.json` (`prodWaves.<W>.blocks`, `runtimeWaves.<W>.blocks`); the
"only this wave left" lists are printed below (keys without the population prefix).

| wave | prod: blocks | prod: only this wave left (upper) | prod: firm | runtime-on: blocks | runtime-on: only this wave left |
|---|---:|---:|---:|---:|---:|
| W1 | 82 | 15 | 13 | 122 | 8 |
| W3 | 196 | 107 | 59 | 73 | 69 |
| W4 | 222 | 77 | 17 | 287 | 88 |
| W6 | 45 | 10 | 2 | 35 | 2 |
| W7 | 52 | 15 | 6 | 65 | 15 |
| W8 | 65 | 10 | 0 | 64 | 5 |
| W9 | 70 | 40 | 12 | 70 | 20 |
| other | 6 | 6 | 0 | 21 | 4 |

### W1 names and robustness
- **production, only this wave left (15; firm marked \*):** `parabolic-sar__PSAR`, `price-target__Price1Target`, `3-level-zigzag-semafor__3078`\*, `cc-yata__bd898a1af0`\*, `session-hilo__WM2g5GtC4h`\*, `zigzag-ma-pattern-recognition__1302`\*, `check-head-and-shouldersmask-man__INWKFwOBpV`\*, `cm-gann-swing-highlow-v2__592`\*, `mema-bb-parabolic-sar__nurAC4OTMa`\*, `multi-timeframe-vwap-v5__Au03ORcOFj`\*, `parabolic-sar-alerts-on-close-quantnomad__hdvUgc9je5`\*, `pivot-points-high-low-extension__Pxr8FVNWPB`\*, `range-filter-buy-and-sell-5min__65cb674338`\*, `tradingviews-technical-analysis__oZFVfrvzZI`\*, `vwapmvwapema-crossover__N16MOYK6AE`\*
- **runtime-on, only this wave left (8):** `visible-average-price__Visible1Aver`, `elliot-wave-detector-pro__ce1cc9553e`, `ict-killzone-index-version__28962c02dd`, `open-interest-suite-aggregated-by-leviathan__44b150b3df`, `session-highs-and-lows-indicator-smc-sessions-dst-safe__c0ca8cf749`, `zigzag-ma-pattern-recognition__1302`, `squeeze-momentum-indicator-lazybear-vx-by-dgt__bjAASLSxLp`, `supertrendrange-by-dgt__jDAxwdo5u7`
- production blocks 82, runtime-on blocks 122: full lists in `coverage-targets-2026-11-02.json` (`prodWaves.W1.blocks`, `runtimeWaves.W1.blocks`).

### W3 drawing-object completeness
- **production, only this wave left (107; firm marked \*):** `multi-time-period-charts__Multi-TimePe`\*, `pivot-points-standard__Pivot1Points`, `trading-sessions__Trading1Sess`, `artemis-oscillator-pro__ea1097ca9e`\*, `asianrange-and-killzones__ef41eb5ad6`, `atr-support-and-resistance__3e9ddb38c4`\*, `atr-trailing-stop-by-ceyhun__UMldb6tGLd`\*, `auto-harmonic-patterns-open-source__ca6022754b`, `auto-trendline-dojiemoji__c21f83602c`\*, `average-day-range-adr-pivots__38b8c996e9`\*, `bigbeluga-smart-money-concepts__e41b7abd03`, `camarilla-screener__UsBJPF3MkA`, `correlation-matrix__dzN3DMCFJL`, `dual-view-htf-candlestick-patterns-theultimator5__e0385fb61b`\*, `ema-ribbon-trend-filter-strixedge__737f5c58ad`\*, `fair-value-gap__1048fa103a`, `fibonacci-retracement-statistics-by-volprofex__999c924fce`, `footprint-iq-pro-tradingiq__3b96428a77`, `fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated__578addf606`, `heat-map-seasons__53acdf3223`\*, `high-low-open-mid-ranges__5715509e0b`\*, `higher-time-frame-fair-value-gap-zeroherotrading__202f1347b8`, `htf-candle-footprint-cartel-console__ca3ff4e904`\*, `htf-liquidity-dashboard-tfo__ec8f8316a4`\*, `ict-institutional-order-flow-fadi__25d4834579`, `ict-killzone-index-version__28962c02dd`, `ict-killzones-pivots-tfo__d0b8be94f1`\*, `ipda-standard-deviations-dexterlab-x-tfo-x-toodegrees__7366c2d2c0`, `liquidity-heatmap-nephew-sam__7628c72c3d`\*, `market-profile-with-tpo__b2b119d8ab`, `market-sessions-and-volume-profile-by-leviathan__c85c28c18a`, `market-structure-inducements-ict-tradinfinder-choch-bos-sweeps__7569f1043e`, `mgi-levels-suite__285168ddfb`, `mtf-watchlist-charts-anan__3453680ea1`, `multi-timeframe-fvg-tfo__adbed9f590`, `multi-timeframe-supply-demand-zones__a98a2ab367`\*, `multicator-table__486858895c`\*, `order-blocks__b324078711`, `position-size-calc__a42db1a620`\*, `power-of-3-ict-01-tradingfinder-amd-ict-smc-accumulations__c8dd500862`, `previous-day-high-and-low-separators-dailyweekly__0ef3e35a9d`, `screener-mean-reversion-channel__nTK2sHWDlB`, `sector-rotation__0fca060bf4`\*, `session-tpo-profile__41088ef96d`, `strong-start-rvol-dashboard__36140b1cbe`, `supertrend-explorer__V4MsmtCeKs`\*, `support-and-resistance__c4792aabd0`, `swing-highlow-zigzag-chartprime__c53f5bc4e2`\*, `tehthomas-aligned-timeframe-fair-value-gaps__f843e207ca`, `trend-lines-supports-and-resistances__413ee2ee3b`\*, `trendline-pivots-quantvue__3dc9be8b73`, `trendlinesample__61d59f90bc`, `vdubus-pattern-gen-v2-restored-refined__66dc68412e`\*, `vold-market-breadth__9c5cde9557`\*, `volume-delta-oi-delta-kioseff-trading__9056fd6b37`, `volume-open-interest-footprint-by-leviathan__f84b8fc7c4`, `volume-profile-auto-line-v2__b0e947fd20`, `volume-profile-v054beta__PNSKf75832`, `volume-profile__X0dKLxdLh4`\*, `volumized-order-blocks-flux-charts__1675b2b8e3`, `zigzag-multi-time-frame-with-fibonacci-retracement__ppvz14qunp`, `auto-fibonacci-and-gann-fanretracements-combo__e764b93365`, `auto-trendlines-by-pivots-perfect-non-repainting-lines-spyqqq-daily-pr__8b82863b79`\*, `cobra039s-crypto-market-visualizer__c3636f55f4`\*, `crypto-correlation-matrix__0f59de2d3d`\*, `cryptosignalscanner-rsi-overboughtoversold-divergence-indicator-new__918919b267`\*, `custom-screener-with-alerts__dd1bf69eb8`\*, `dot-dynamics__Zd1PZqZcep`\*, `dual-supertrend-ichimoku-and-dmi-color-weighted-by-dgt__6pPzwGaxjU`\*, `dynamic-higher-timeframe-fibonacci-pivot-points__8Hv70DXiZU`\*, `dynamic-linear-regression-channels__17ec799bc1`\*, `edufx-amd__0ca9b3c747`, `fabio-style-order-flow-lvn-volumeprofile-fvgob-liquiditygrabs-dashboar__d7293b07f6`\*, `fibonacci-extention-retracment-pivot-points-by-dgt__smOGfR6p3n`\*, `footprint__6848998fe8`, `fourier-extrapolator-of-price-w-projection-forecast-loxx__5c7061572f`\*, `fvg-order-blocks-bigbeluga__64decdabc4`, `inside-bar-setup__a1528b4d74`\*, `intraday-power-3-visual__f9b34d80bb`\*, `linear-regression-channel-curve-slope-by-dgt__WvWdhArzmm`\*, `liquidity-heatmap-swiftedge__8291fe0662`\*, `liquidity-pools-pro-willyalgotrader__409687ce4a`\*, `liquidity-sniper-pro__da4b93aa0a`\*, `liquidity-swings-luxalgo__780e612168`\*, `machine-learning-random-forest-strategy-gainzalgo__fab416ff3f`\*, `market-trend-levels-detector-bigbeluga__317e91d708`\*, `momentum-terrain-3d-luxalgo__f7eb2c2d64`, `money-flow-index__3LM5J3rc0O`\*, `onchart-wavetrend-divergence-with-pivots__2f8b996d4c`\*, `relative-strength-index-divergences-libertus__g2odvjJQz8`\*, `rsi-multi-timeframe-dashboard-by-giua64__cb0cdabd5f`\*, `rsi-support-resistance-by-dgt__ZkkLVEb1ak`\*, `rth-opening-range-with-extensions__88bbcc36f3`, `screener-for-40-instruments__a009097811`\*, `session-liquidity__96d8d1599c`, `smart-money-concepts-probability-expo__285cd9fa6f`\*, `smc-target-liquidity-v35-manual-distance-control__811da09c25`, `supertrend-mtf-heatmap__ODcEBlvB3g`, `support-and-resistance-step-4__d24e4b30cf`\*, `support-and-resistance__c13363a5d2`\*, `support-resistance-fibonacci-retracement__06a1a2c80d`\*, `trend-channels-with-liquidity-breaks-chartprime__6cabbffddf`\*, `trend-direction-helper__XQTKs6HB2y`\*, `trend-range-detector-zeiierman__56816eee0d`, `vp-period__iO1NrPRRG5`, `williams-r-rsi-ema-tendance-silver-wong__sogth7qpzs`\*, `zig-zag-channels-luxalgo__c253c72883`\*
- **runtime-on, only this wave left (69):** `multi-time-period-charts__Multi-TimePe`, `artemis-oscillator-pro__ea1097ca9e`, `atr-support-and-resistance__3e9ddb38c4`, `atr-trailing-stop-by-ceyhun__UMldb6tGLd`, `auto-trendline-dojiemoji__c21f83602c`, `average-day-range-adr-pivots__38b8c996e9`, `dual-view-htf-candlestick-patterns-theultimator5__e0385fb61b`, `ema-ribbon-trend-filter-strixedge__737f5c58ad`, `heat-map-seasons__53acdf3223`, `high-low-open-mid-ranges__5715509e0b`, `htf-candle-footprint-cartel-console__ca3ff4e904`, `htf-liquidity-dashboard-tfo__ec8f8316a4`, `ict-killzones-pivots-tfo__d0b8be94f1`, `liquidity-heatmap-nephew-sam__7628c72c3d`, `mtf-key-levels-support-and-resistance__29f470a089`, `multi-timeframe-supply-demand-zones__a98a2ab367`, `multicator-table__486858895c`, `position-size-calc__a42db1a620`, `sector-rotation__0fca060bf4`, `supertrend-explorer__V4MsmtCeKs`, `swing-highlow-zigzag-chartprime__c53f5bc4e2`, `trend-lines-supports-and-resistances__413ee2ee3b`, `vdubus-pattern-gen-v2-restored-refined__66dc68412e`, `vold-market-breadth__9c5cde9557`, `volume-profile__X0dKLxdLh4`, `volume-spikes-growing-volume-signals-with-alerts-scanner__8e706f448f`, `auto-trendlines-by-pivots-perfect-non-repainting-lines-spyqqq-daily-pr__8b82863b79`, `camarilla-levels-intraday__bfb5a2b8db`, `check-head-and-shouldersmask-man__INWKFwOBpV`, `cobra039s-crypto-market-visualizer__c3636f55f4`, `crypto-correlation-matrix__0f59de2d3d`, `cryptosignalscanner-rsi-overboughtoversold-divergence-indicator-new__918919b267`, `custom-screener-with-alerts__dd1bf69eb8`, `dot-dynamics__Zd1PZqZcep`, `dual-supertrend-ichimoku-and-dmi-color-weighted-by-dgt__6pPzwGaxjU`, `dynamic-higher-timeframe-fibonacci-pivot-points__8Hv70DXiZU`, `dynamic-linear-regression-channels__17ec799bc1`, `fabio-style-order-flow-lvn-volumeprofile-fvgob-liquiditygrabs-dashboar__d7293b07f6`, `fibonacci-extention-retracment-pivot-points-by-dgt__smOGfR6p3n`, `fourier-extrapolator-of-price-w-projection-forecast-loxx__5c7061572f`, `inside-bar-setup__a1528b4d74`, `intraday-power-3-visual__f9b34d80bb`, `linear-regression-channel-curve-slope-by-dgt__WvWdhArzmm`, `liquidity-heatmap-swiftedge__8291fe0662`, `liquidity-pools-pro-willyalgotrader__409687ce4a`, `liquidity-sniper-pro__da4b93aa0a`, `liquidity-swings-luxalgo__780e612168`, `machine-learning-random-forest-strategy-gainzalgo__fab416ff3f`, `market-trend-levels-detector-bigbeluga__317e91d708`, `money-flow-index__3LM5J3rc0O`, `multi-timeframe-vwap-v5__Au03ORcOFj`, `onchart-wavetrend-divergence-with-pivots__2f8b996d4c`, `range-filter-buy-and-sell-5min__65cb674338`, `relative-strength-index-divergences-libertus__g2odvjJQz8`, `rsi-multi-timeframe-dashboard-by-giua64__cb0cdabd5f`, `rsi-support-resistance-by-dgt__ZkkLVEb1ak`, `screener-for-40-instruments__a009097811`, `smart-money-concepts-probability-expo__285cd9fa6f`, `supply-and-demand-zones-bigbeluga__6f46de6c8a`, `support-and-resistance-step-4__d24e4b30cf`, `support-and-resistance__c13363a5d2`, `support-resistance-fibonacci-retracement__06a1a2c80d`, `tradingviews-technical-analysis__oZFVfrvzZI`, `trend-channels-with-liquidity-breaks-chartprime__6cabbffddf`, `trend-direction-helper__XQTKs6HB2y`, `ut-bot-linreg-candles-longevity-zones-sr-dashboard__26fb08b910`, `vwapmvwapema-crossover__N16MOYK6AE`, `williams-r-rsi-ema-tendance-silver-wong__sogth7qpzs`, `zig-zag-channels-luxalgo__c253c72883`
- production blocks 196, runtime-on blocks 73: full lists in `coverage-targets-2026-11-02.json` (`prodWaves.W3.blocks`, `runtimeWaves.W3.blocks`).

### W4 runtime lane finished (runtime walls)
- **production, only this wave left (77; firm marked \*):** `detrended-price-oscillator__DPO`, `fisher-transform__Fisher_Trans`, `hull-moving-average__Hull1MA`, `mcginley-dynamic__McGinley1Dyn`, `moving-average-convergence-divergence__MACD`, `open-interest__OpenInterest`, `percentage-volume-oscillator__Volume1Oscil`, `price-oscillator__Price_Oscill`, `relative-strength-index__RSI`\*, `time-weighted-average-price__Time1Weighte`\*, `volatility-stop__Volatility_S`, `volume-weighted-average-price__VWAP`, `williams-fractal__Whilliams_Fr`, `adx-and-di-for-v4__932`, `anchored-vwap-pinch-handoff-intervals-and-signals__2174489a80`, `blackflag-fts__GdkmXaTINI`\*, `bolingger-bands-inside-bar-boxes__3294017d4f`\*, `boom-hunter-entry-point-screener-alerts__0fc5982548`, `deadband-hysteresis-filter-backquant__3fb3d09595`, `delta-rsi-oscillator-strategy__z4Yj46FVTX`, `ema-92150-vwap-macd-rsi-pro-v6__014bfba33d`\*, `fvg-trend__21e364f2ed`\*, `ict-turtle-soup-flux-charts__053c3e6056`, `inside-bar-boxes__2f747d848b`, `inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat__832e485b9c`\*, `kalman-price-filter-backquant__47a601e4bc`, `kernel-channel-backquant__d8c4b7f75c`, `linear-regression-channel-200__243d67c804`, `linear-regression-channel__jiDgL4o6Qx`, `macd-with-filter-visual-backtest-module-sample__kuNU8uQsIH`, `machine-learning-moving-average-backquant__4d7ff59e68`, `moving-averages-as-support-resistance-mtf__gcBksfRvvy`, `nadaraya-watson-rational-quadratic-kernel-non-repainting__2d248c3125`, `neural-network-buy-and-sell-signals__fbbb11d0c7`, `nonlinear-regression-zero-lag-moving-average-loxx__e5075eb888`, `supply-demand-mtf-flux-charts__7fb4bff229`, `support-and-resistance-logistic-regression-flux-charts__9d844269d6`, `trend-line-harrybot__vMv5yOQxcA`, `trend-targets-algoalpha__92ff5628d7`\*, `volatility-coil-edge-bullbyte__604f0fd1c6`, `volume-divergence-by-mm__cvG2Djaryv`, `volume-profile-bar-magnified-order-blocks-jacobmagleby__3b3ebba156`, `ai-moving-average-expo__cddaa37ee5`, `all-in-one-sessions-weekly-monday-previous-highslows__26254838fe`, `anti-volume-stop-loss__QyDEhGL8DB`, `coral-trend-indicator-lazybear__836`\*, `engulfing-sinyal__pAgeLQw9kl`, `flying-buddha-inside-bars-indicator-v1-by-justunclel__0d9CiLNXGu`, `halftrend-longshort-signal-engine-bigbeluga__07070e14d6`, `hma-kahlman-trend-trendlines__AhvnhJbO5J`, `hurst-cycle-channel-clone-lazybear__1192`, `kalman-trend-levels-bigbeluga__3fb104b310`\*, `kaufman-adaptive-bands__sXCNphOxWh`\*, `laguerre-rsi-v4-lk__114`, `luxy-momentum-trend-and-breakout-indicators-with-multi-timeframe-bias-__0fa143447a`, `luxy-super-duper-supertrend-predictor-engine__582421244d`, `machine-learning-supertrend-aslan__68a59b1fc0`, `mirage-liquidity-sweep-pro-willyalgotrader__238f0e26eb`, `money-flow-index-mtf-alerts__RkKU95fUai`, `mtf-order-block-finder__ce13bf1b46`, `nadaraya-watson-trend-quantalgo__052bdb2a18`, `non-repainting-swing-highlow-signals__ccf063295a`\*, `obv-macd-indicator__5JF4Np02Ma`\*, `order-block-detector-luxalgo__7c893384eb`, `price-divergence-detector-v32-revised-by-justunclel__iWPERpdLcd`, `range-filter-v1__T5nXpEBeCh`\*, `rsi-cyclic-smoothed__ckgSq3I4CY`, `rsi-kernel-optimized-flux-charts__427926d08f`, `squeeze-momentum-indicator-lazybear-vx-by-dgt__bjAASLSxLp`\*, `stoch-money-flow-admf-absolute-strength-index-asi-ci8dh__XqxUTKWKYq`, `study-for-squeeze-momentum-indicator-lazybear__2BZblBj6eA`\*, `thelark-lma-v2-laguerre__1029`, `triangular-hull-moving-average-volatility-bigbeluga__f20311448f`, `twiggs-money-flow-lazybear__1562`, `uptrick-volatility-adjusted-trail__ff9f0f608f`, `volatility-regimes-gainzalgo__31d94ea2c3`, `williams-vix-fix-bottoms-and-tops__f5d5130307`\*
- **runtime-on, only this wave left (88):** `gaps__Gaps`, `linear-regression-channel__Linear_Regre`, `relative-strength-index__RSI`, `seasonality__Seasonality`, `trading-sessions__Trading1Sess`, `volatility-stop__Volatility_S`, `auto-harmonic-patterns-open-source__ca6022754b`, `bolingger-bands-inside-bar-boxes__3294017d4f`, `boom-hunter-entry-point-screener-alerts__0fc5982548`, `breaks-and-retests-hg__ddba061af8`, `camarilla__jw9faob08r`, `correlation-matrix__dzN3DMCFJL`, `delta-volume-v21-by-kernel-phi__uP24atP4R0`, `double-topbottom-ultimate-os__bd013ff4f5`, `ema-92150-vwap-macd-rsi-pro-v6__014bfba33d`, `footprint-iq-pro-tradingiq__3b96428a77`, `fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated__578addf606`, `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor__f91c76bdec`, `ict-turtle-soup-flux-charts__053c3e6056`, `ipda-standard-deviations-dexterlab-x-tfo-x-toodegrees__7366c2d2c0`, `kernel-channel-backquant__d8c4b7f75c`, `linear-regression-channel-200__243d67c804`, `liquidity-levels-sonarlab__bba13c46c4`, `market-structure-inducements-ict-tradinfinder-choch-bos-sweeps__7569f1043e`, `mtf-watchlist-charts-anan__3453680ea1`, `neural-network-buy-and-sell-signals__fbbb11d0c7`, `nonlinear-regression-zero-lag-moving-average-loxx__e5075eb888`, `nubia-auto-midas-anchored-vwap-xdecow__MOpN5jQbSn`, `one-indicator-multiple-max-40-checked-symbols-and-quotinfinitequot-num__015bb66e64`, `previous-day-high-and-low-separators-dailyweekly__0ef3e35a9d`, `range-filter-bs-signals__eCVFctFlqp`, `renderingnature-smc-reversal-engine-v71__f8734584d9`, `smc-structures-and-multi-timeframe-fvg-ma-py__fd50b245b6`, `strong-start-rvol-dashboard__36140b1cbe`, `support-and-resistance-logistic-regression-flux-charts__9d844269d6`, `support-and-resistance__c4792aabd0`, `trend-line-harrybot__vMv5yOQxcA`, `trendlinesample__61d59f90bc`, `visualizing-displacement-tfo__5b861441c2`, `volatility-coil-edge-bullbyte__604f0fd1c6`, `volatility-trend-score-backquant__0794882a37`, `volume-divergence-by-mm__cvG2Djaryv`, `volume-profile-auto-line-v2__b0e947fd20`, `volume-profile-v054beta__PNSKf75832`, `zigzag-multi-time-frame-with-fibonacci-retracement__ppvz14qunp`, `ai-moving-average-expo__cddaa37ee5`, `anti-volume-stop-loss__QyDEhGL8DB`, `auto-length-moving-average-trend-signals-zeiierman__30185ad35b`, `best-abcd-pattern-screener__ROdc6mWjx4`, `breaks-and-retests-with-volatility-stop-hg__ebbd1d4440`, `chases-buysell-indicator-advance-decline__37714ef0a5`, `cm-forex-sessions-highlight-v1__41`, `cm-gann-swing-highlow-v2__592`, `color-gradient-framework-pinecoders__9ICIDOiMbF`, `coral-trend-indicator-lazybear__836`, `delta-volume-columns-lucf__HmUxm6bIQC`, `edufx-amd__0ca9b3c747`, `flying-buddha-inside-bars-indicator-v1-by-justunclel__0d9CiLNXGu`, `fvg-instantaneous-mitigation-signals-luxalgo__4769478b4b`, `fxn-asian-session-range__jNLZBfpYDO`, `heatmap-volume-xdecow__2lteb6l2tk`, `ichimoku-kinko-hyo-一目均衡表__a8a2aa1034`, `ict-killzone__fE0Mzs0mp0`, `interactive-atr-stop-loss__6d419f128f`, `kz-boxes__zed4AoolEW`, `money-flow-index-mtf-alerts__RkKU95fUai`, `mtf-order-block-finder__ce13bf1b46`, `nadaraya-watson-trend-quantalgo__052bdb2a18`, `obv-macd-indicator__5JF4Np02Ma`, `order-block-detector-luxalgo__7c893384eb`, `pivot-points-high-low-extension__Pxr8FVNWPB`, `range-filter-v1__T5nXpEBeCh`, `rsi-cyclic-smoothed__ckgSq3I4CY`, `rsi-entry-engine-trade-w-samet__6fa55b9515`, `rth-opening-range-with-extensions__88bbcc36f3`, `sessions-nephew-sam__nTgXSYRNbD`, `smc-target-liquidity-v35-manual-distance-control__811da09c25`, `stoch-money-flow-admf-absolute-strength-index-asi-ci8dh__XqxUTKWKYq`, `study-for-squeeze-momentum-indicator-lazybear__2BZblBj6eA`, `supertrend-mtf-heatmap__ODcEBlvB3g`, `thelark-lma-v2-laguerre__1029`, `trading-session-indicator__E4P4ZGnwPT`, `trend-range-detector-zeiierman__56816eee0d`, `trendlines-2x__rzuOQrVQWt`, `trendlines-jd__BYXZzZURrT`, `uptrick-volatility-adjusted-trail__ff9f0f608f`, `vwap-supply-demand-zones-pro__537326bd2f`, `williams-vix-fix-bottoms-and-tops__f5d5130307`
- production blocks 222, runtime-on blocks 287: full lists in `coverage-targets-2026-11-02.json` (`prodWaves.W4.blocks`, `runtimeWaves.W4.blocks`).

### W6 collections, UDTs, methods
- **production, only this wave left (10; firm marked \*):** `visible-average-price__Visible1Aver`, `candelacharts-equal-highslows-eqheql__4485a6c447`\*, `double-topbottom-ultimate-os__bd013ff4f5`, `fibonacci-dolphintradebot__d93b208611`, `machine-learning-knn-based-strategy__lj1Gjlbycb`, `range-filter-bs-signals__eCVFctFlqp`, `range-filter-dw__pshyCmQSql`\*, `support-resistance-mtf-flux-charts__dd04862677`, `volatility-trend-score-backquant__0794882a37`, `enhanced-mcclellan-summation-index__f2989eaa65`
- **runtime-on, only this wave left (2):** `range-filter-dw__pshyCmQSql`, `price-divergence-detector-v32-revised-by-justunclel__iWPERpdLcd`
- production blocks 45, runtime-on blocks 35: full lists in `coverage-targets-2026-11-02.json` (`prodWaves.W6.blocks`, `runtimeWaves.W6.blocks`).

### W7 request.*
- **production, only this wave left (15; firm marked \*):** `advance-decline-line__Advance1Decl`, `correlation-coefficient__Correlation_`\*, `cumulative-volume-index__Cumulative1V`, `rob-booker-ziv-ghost-pivots__Rob1Booker1G`\*, `cumulative-volume-delta__c772250751`, `multi-timeframe-trend-indicator__fa4022ecf5`, `previous-n-daysweeksmonths-high-low__78f5b05522`\*, `best-rsi-divergences-screener-regular-and-hidden__F9uUIwmi9f`, `best-rsi-divergences-screener__TmlpugZKr6`, `chases-buysell-indicator-advance-decline__37714ef0a5`\*, `earnings-sr-levels-lazybear__453`, `global-liquidity-index__1b7ae64e24`, `multi-timeframe-rolling-bitmex-liquidation-levels__6luLopNPPH`\*, `my-cme-open-interest__ndAEr9lJjO`\*, `price-action-doji-harami-v02-by-justunclel__4219`
- **runtime-on, only this wave left (15):** `correlation-coefficient__Correlation_`, `rob-booker-ziv-ghost-pivots__Rob1Booker1G`, `4c-nyse-market-breadth-ratio__722410befd`, `cppivot-boss-floor-pivots-with-atr-dilation-and-dynamic-levels__eb13ccd13f`, `mtf-dashboard-pro-rsi-fib-sr-volume-strixedge__bad34083e8`, `previous-n-daysweeksmonths-high-low__78f5b05522`, `sub__1xYROVYMlX`, `swing-points-and-liquidity-by-leviathan__919c1fd9c6`, `earnings-sr-levels-lazybear__453`, `global-liquidity-index__1b7ae64e24`, `multi-timeframe-rolling-bitmex-liquidation-levels__6luLopNPPH`, `my-cme-open-interest__ndAEr9lJjO`, `price-action-doji-harami-v02-by-justunclel__4219`, `ripster-rvol-saty-atr-levels-v6-options-dashboard__fe6c658029`, `saty-atr-levels__99165984ef`
- production blocks 52, runtime-on blocks 65: full lists in `coverage-targets-2026-11-02.json` (`prodWaves.W7.blocks`, `runtimeWaves.W7.blocks`).

### W8 libraries (import)
- **production, only this wave left (10; firm marked \*):** `auto-fib-extension__Auto1Fib1Ext`, `auto-fib-retracement__Auto1Fib1Ret`, `auto-pitchfork__Auto1Pitchfo`, `zigzag__Zig_Zag`, `smart-money-concept-tradingfinder-major-minor-ob-fvg-smc__3a423d6669`, `strength-of-divergence-across-multiple-indicators__ff2ae4fdab`, `volume-profile-plus__91ff446fe0`, `auto-chart-patterns-trendoscope__257dbd8cad`, `recursive-reversal-chart-patterns-trendoscope__c1da465c0a`, `solar-system-in-3d-astro-tool-w-zodiac-alien-algorithms__213cfb6fbb`
- **runtime-on, only this wave left (5):** `performance__Performance`, `all-chart-patterns-theeccentrictrader__03e4633d31`, `black-scholes-option-pricing-model-w-greeks-loxx__12d143e9b2`, `auto-trendlines-trendoscope__c1dc011801`, `volume-profile-heatmap__89dbe956a4`
- production blocks 65, runtime-on blocks 64: full lists in `coverage-targets-2026-11-02.json` (`prodWaves.W8.blocks`, `runtimeWaves.W8.blocks`).

### W9 strategy tester
- **production, only this wave left (40; firm marked \*):** `bar-updown-strategy__Bars1Up1Dn1S`, `bollinger-bands-strategy-directed__Bollinger1Ba`, `bollinger-bands-strategy__Bollinger1Ba`, `channel-breakout-strategy__Channel1Brea`, `consecutive-updown-strategy__Consecutive1`, `greedy-strategy__Greedy1Strat`, `inside-bar-strategy__InSide1Bar1S`, `keltner-channels-strategy__Keltner1Chan`, `macd-strategy__MACD1Strateg`, `momentum-strategy__Momentum1Str`, `moving-average-crossover__MovingAvg1Cr`, `outside-bar-strategy__OutSide1Bar1`, `pivot-extension-strategy__Pivot1Extens`, `pivot-reversal-strategy__Pivot1Revers`, `price-channel-strategy__Price1Channe`, `rob-booker-adx-breakout__Rob1Booker1A`, `rsi-strategy__RSI1Strategy`, `stochastic-slow-strategy__Stochastic1S`, `supertrend-strategy__SupertrendSt`, `two-moving-averages-crossover__MovingAvg1Cr`, `volatility-expansion-close-strategy__Volty1Expan1`, `buy-monday-exit-tuesday__8f2f69cc99`, `flawless-victory-strategy__1BVZuaaWOU`, `highlow-channel-swing__e3692e253c`\*, `linear-regression-channel-breakout-strategy__3a1cf28800`, `macd-shortlong-strategy-for-tradingview-input-optimizer__59bb295a99`\*, `optimized-keltner-channels-sltp-strategy-for-btc__48bc69cf84`\*, `scalping-strategy-with-williams-r-macd-and-sma-1-minute-only__e247952471`, `tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto__EqnpYOP7hy`\*, `tradingview-alerts-to-mt4-mt5-strategy-example__LclqojYSOA`\*, `bollinger-bands-filter__M8AKuon90n`\*, `bollinger-rsi-double-strategy-by-chartart-v11__2187`\*, `camarillastrategyv1__1913`, `dynamic-swing-anchored-vwap-strategy-zeiierman-x-pineindicators__ee0c3c9ccd`, `fixed-percent-stop-loss-take-profit__1j62blFnpJ`, `golden-cross-sma-200-long-only-moving-average-strategy-by-chartart__2811`\*, `hull-moving-average-crossover-strategy__ASuWFtACGl`\*, `macd-sma-200-strategy-by-chartart__2004`\*, `ut-bot-strategy__VynMPwQs9U`\*, `vix-fix-stochrsi-strategy__3173`\*
- **runtime-on, only this wave left (20):** `parabolic-sar-strategy__Parabolic1SA`, `highlow-channel-swing__e3692e253c`, `linear-regression-channel-breakout-strategy__3a1cf28800`, `macd-shortlong-strategy-for-tradingview-input-optimizer__59bb295a99`, `optimized-keltner-channels-sltp-strategy-for-btc__48bc69cf84`, `pmax-explorer__jN9HBNhynF`, `rsi-vwap-indicator__pTI5ZVw9n4`, `supertrend-strategy__rcRbtoBiKG`, `tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto__EqnpYOP7hy`, `tradingview-alerts-to-mt4-mt5-strategy-example__LclqojYSOA`, `vwap-fibo-dev-extensions-strategy__mR2vfyGjUv`, `bollinger-bands-filter__M8AKuon90n`, `bollinger-rsi-double-strategy-by-chartart-v11__2187`, `golden-cross-sma-200-long-only-moving-average-strategy-by-chartart__2811`, `hull-moving-average-crossover-strategy__ASuWFtACGl`, `macd-sma-200-strategy-by-chartart__2004`, `swing-parabolic-sar-strategy__i5Ni9xpTee`, `trailing-sl-strategy-quantnomad__kvEZ1RweKL`, `ut-bot-strategy__VynMPwQs9U`, `vix-fix-stochrsi-strategy__3173`
- production blocks 70, runtime-on blocks 70: full lists in `coverage-targets-2026-11-02.json` (`prodWaves.W9.blocks`, `runtimeWaves.W9.blocks`).

### other output contract (script offers nothing a pane carries)
- **production, only this wave left (6; firm marked \*):** `bollinger-bars__Bollinger1Ba`, `chop-zone__Chop1Zone`, `one-indicator-multiple-max-40-checked-symbols-and-quotinfinitequot-num__015bb66e64`, `visualizing-displacement-tfo__5b861441c2`, `cm-forex-sessions-highlight-v1__41`, `trading-session-indicator__E4P4ZGnwPT`
- **runtime-on, only this wave left (4):** `bollinger-bars__Bollinger1Ba`, `chop-zone__Chop1Zone`, `bigbeluga-smart-money-concepts__e41b7abd03`, `camarilla-screener__UsBJPF3MkA`
- production blocks 6, runtime-on blocks 21: full lists in `coverage-targets-2026-11-02.json` (`prodWaves.other.blocks`, `runtimeWaves.other.blocks`).

### 6.1 W1 names by production wall

Production-lane walls owned by W1 (blocker, sole, blocks): `[translator-robustness]` 7/34,
`time` (session / timeframe forms) 2/16, `ta.sar` 2/3, `ta.barssince` 1/8, `input.time` 1/4,
`ta.valuewhen` (role order) 1/3, `[call-mapping]` 0/4, then 0/2: `barstate.isnew`, `input.enum`,
`str.length`, `ta.pivothigh`, `ta.pivotlow`, `timeframe.in_seconds`, `timestamp`; then 0/1:
`dayofmonth`, `month`, `year`, `syminfo.target_price_average/high/low` (data-limited),
`ta.obv`, `timeframe.change`. Since 10-30 the names `fixnan`, `ta.alma`, `ta.cci`, `ta.rci`,
`ta.tsi`, `ta.nvi`, `ta.pvi`, `ta.accdist`, `ta.percentile_nearest_rank`, `ta.swma` have left the
production wall list. `fixnan` is now verified (a MATCH capture); the other nine transfer but
have **no MATCH capture** (section 7.1 lists the captures that verify them).

## 7. Captures that convert the most "transfers" into graded MATCH

Only 45 of the 211 production transfers (and of the 250 runtime-on) have a MATCHing capture.
Three lists, in the order to capture:

**7.1 Greedy over unverified items.** 73 Pine items translate today but have **no MATCH capture
anywhere** (`supported-unverified`). Each row is the transferring script (either lane, no MATCH
yet) that verifies the most still-unverified items, then the next. 29 captures cover 49 of the 73
(the rest are only in scripts that do not transfer, or are ungraded names: `strategy.*`,
`alert*`, `log.*`, `runtime.*`). Capture on the dedicated rig, RDDT and SPY daily, per
`docs/pine/capture-procedure.md`.

| # | script | lane | existing capture | items it would verify first |
|---:|---|---|---|---|
| 1 | `reference:fxn-week-and-day-separator__ingZSaBNLa` (FXN - Week and Day Separator) | production | none | `hour`, `minute`, `scale.none`, `syminfo.timezone`, `timeframe.isdwm` |
| 2 | `builtin:commodity-channel-index__CCI` (Commodity channel index) | production | none | `display.all`, `format.price`, `ta.dev`, `ta.rma`, `ta.vwma` |
| 3 | `committed:poor-man039s-volume-profile__ZnFTCYyvGJ` (Poor man&#039;s volume profile) | production | DIVERGE | `input.symbol`, `label.set_color`, `line.set_xloc`, `line.set_y2` |
| 4 | `committed:machine-learning-knn-based-strategy__lj1Gjlbycb` (Machine Learning: kNN-based Strategy) | runtime-on | none | `math.sign`, `ta.cci`, `timestamp` |
| 5 | `committed:relative-volume__LnFmPEoFXQ` (Relative Volume) | production | none | `format.volume`, `syminfo.description`, `ta.alma` |
| 6 | `reference:cm-enhanced-ichimoku-cloud-v5__664` (CM_Enhanced_Ichimoku Cloud-V5) | production | none | `plotarrow`, `ticker.standard` |
| 7 | `committed:smart-money-volume-index-algoalpha__6663950b80` (Smart Money Volume Index [AlgoAlpha]) | production | none | `ta.nvi`, `ta.pvi` |
| 8 | `committed:k-clustering__8e82f5aa4b` (K clustering) | production | DIVERGE | `array.copy`, `array.slice` |
| 9 | `reference:liquidity-by-makuchaku-efe__8db03bf972` (Liquidity by makuchaku & eFe) | production | none | `line.style_arrow_both`, `line.style_arrow_left` |
| 10 | `reference:trade-archer-on-balance-volume-moving-averages-v1__897` (Trade Archer - On Balance Volume Moving Averages - v1) | production | none | `math.ceil`, `ta.obv` |
| 11 | `reference:cm-stochastic-mtf__648` (CM_Stochastic_MTF) | production | none | `ticker.new` |
| 12 | `committed:linear-regression-channel__jiDgL4o6Qx` (Linear Regression Channel) | runtime-on | none | `array.new_color` |
| 13 | `reference:average-true-range-stop-loss-finder__d48234236f` (Average True Range Stop Loss Finder) | production | none | `table.cell_set_text_color` |
| 14 | `committed:delta-rsi-oscillator-strategy__z4Yj46FVTX` (Delta-RSI Oscillator Strategy) | runtime-on | INCONCLUSIVE | `shape.xcross` |
| 15 | `committed:renko-candles-overlay__d76a18d49e` (Renko Candles Overlay) | runtime-on | INCONCLUSIVE | `barstate.isrealtime` |
| 16 | `reference:pivot-points-high-low-hhhllhll-anan__b04lNFHeme` (Pivot Points High Low (HH/HL/LH/LL) [Anan] ) | production | none | `last_bar_index` |
| 17 | `reference:cog-double-channel-lazybear__7` (COG Double Channel [LazyBear]) | production | none | `ta.median` |
| 18 | `committed:wyckoff-accumulation-distribution__d9ae726e21` (Wyckoff Accumulation Distribution) | runtime-on | INCONCLUSIVE | `display.pane` |
| 19 | `reference:liquidation-screener__jwAtEwngOd` (Liquidation Screener) | production | none | `ta.mode` |
| 20 | `builtin:aroon__Aroon` (Aroon) | production | none | `format.percent` |
| 21 | `builtin:chaikin-oscillator__Chaikin_Osci` (Chaikin oscillator) | production | none | `ta.accdist` |
| 22 | `builtin:choppiness-index__Choppiness_I` (Choppiness index) | production | none | `math.log10` |
| 23 | `builtin:median__Median` (Median) | production | none | `ta.percentile_nearest_rank` |
| 24 | `builtin:money-flow-index__Money_Flow` (Money flow index) | production | none | `ta.mfi` |
| 25 | `builtin:rank-correlation-index__Rank_Correla` (Rank correlation index) | production | none | `ta.rci` |
| 26 | `builtin:relative-vigor-index__Relative_Vig` (Relative vigor index) | production | none | `ta.swma` |
| 27 | `builtin:smi-ergodic-indicator__SMI_Ergodic_` (SMI ergodic indicator) | production | none | `ta.tsi` |
| 28 | `builtin:supertrend__Supertrend` (Supertrend) | production | none | `ta.supertrend` |
| 29 | `builtin:trend-strength-index__Trend1Streng` (Trend strength index) | production | none | `ta.correlation` |

**7.2 Transferring scripts whose existing capture is INCONCLUSIVE or DIVERGE** (re-capture or re-grade first; a DIVERGE on a clean script is a correctness lead): `k-clustering__8e82f5aa4b` (DIVERGE), `mcclellan-indicators__29fdf0235d` (DIVERGE), `opening-range-initial-balance-opening-price__4a7416ab01` (INCONCLUSIVE), `poor-man039s-volume-profile__ZnFTCYyvGJ` (DIVERGE), `smt-divergence-ict-01-tradingfinder-smart-money-technique__3f66e16b3c` (DIVERGE), `support-and-resistance-multi-time-frame__Ph230jpfC9` (DIVERGE), `supertrend__VfOPXWDHDP` (INCONCLUSIVE)

**7.3 Most popular transferring scripts with no capture at all** (by TradingView boosts; each is one capture from a MATCH that members will actually load): `order-block-finder__fVSb3j0I87` (agree 39242), `fibonacci-bollinger-bands__2835` (agree 32721), `rsi-chart-bars__131` (agree 26226), `cm-rsi-2-strat-low__568` (agree 24513), `wavetrend-with-crosses-lazybear__2295` (agree 23460), `cm-stochastic-mtf__648` (agree 22983), `cm-ultimate-rsi-mtf__454` (agree 22249), `4-colour-macd__1146` (agree 20391), `rsi-divergence__Q55lng135i` (agree 19528), `ichimoku2c__68` (agree 18815), `linear-regression-channel__jiDgL4o6Qx` (agree 17120), `support-and-resistance__1505` (agree 16390), `elliott-wave-oscillator__r4MVRjtjDc` (agree 16122), `cm-enhanced-ichimoku-cloud-v5__664` (agree 15398), `simple-moving-averages__kWRFasqqym` (agree 14583), `moving-average-colored-emasma__1581` (agree 14272), `fibonacci-levels__RHEhVHNx6d` (agree 13494), `triple-moving-averages__iRcDB7kRWk` (agree 13391), `supertrend__nlyrgnVJ8Z` (agree 13344), `average-true-range-stop-loss-finder__d48234236f` (agree 11838)


## 8. Exact script lists for the top 15 walls, both lanes
### Production lane, top 15 walls
<details><summary><b>[drawing-objects]</b> (drawing-objects): blocks 105, sole 55</summary>

Sole (this wall alone): `pivot-points-standard__Pivot1Points`, `trading-sessions__Trading1Sess`, `asianrange-and-killzones__ef41eb5ad6`, `auto-harmonic-patterns-open-source__ca6022754b`, `bigbeluga-smart-money-concepts__e41b7abd03`, `camarilla-screener__UsBJPF3MkA`, `correlation-matrix__dzN3DMCFJL`, `fair-value-gap__1048fa103a`, `fibonacci-retracement-statistics-by-volprofex__999c924fce`, `footprint-iq-pro-tradingiq__3b96428a77`, `fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated__578addf606`, `heat-map-seasons__53acdf3223`, `high-low-open-mid-ranges__5715509e0b`, `higher-time-frame-fair-value-gap-zeroherotrading__202f1347b8`, `ict-institutional-order-flow-fadi__25d4834579`, `ict-killzone-index-version__28962c02dd`, `ipda-standard-deviations-dexterlab-x-tfo-x-toodegrees__7366c2d2c0`, `market-profile-with-tpo__b2b119d8ab`, `market-sessions-and-volume-profile-by-leviathan__c85c28c18a`, `market-structure-inducements-ict-tradinfinder-choch-bos-sweeps__7569f1043e`, `mgi-levels-suite__285168ddfb`, `mtf-watchlist-charts-anan__3453680ea1`, `multi-timeframe-fvg-tfo__adbed9f590`, `order-blocks__b324078711`, `power-of-3-ict-01-tradingfinder-amd-ict-smc-accumulations__c8dd500862`, `previous-day-high-and-low-separators-dailyweekly__0ef3e35a9d`, `screener-mean-reversion-channel__nTK2sHWDlB`, `session-tpo-profile__41088ef96d`, `strong-start-rvol-dashboard__36140b1cbe`, `support-and-resistance__c4792aabd0`, `tehthomas-aligned-timeframe-fair-value-gaps__f843e207ca`, `trendline-pivots-quantvue__3dc9be8b73`, `trendlinesample__61d59f90bc`, `volume-delta-oi-delta-kioseff-trading__9056fd6b37`, `volume-open-interest-footprint-by-leviathan__f84b8fc7c4`, `volume-profile-auto-line-v2__b0e947fd20`, `volume-profile-v054beta__PNSKf75832`, `volumized-order-blocks-flux-charts__1675b2b8e3`, `zigzag-multi-time-frame-with-fibonacci-retracement__ppvz14qunp`, `auto-fibonacci-and-gann-fanretracements-combo__e764b93365`, `dot-dynamics__Zd1PZqZcep`, `dual-supertrend-ichimoku-and-dmi-color-weighted-by-dgt__6pPzwGaxjU`, `edufx-amd__0ca9b3c747`, `footprint__6848998fe8`, `fvg-order-blocks-bigbeluga__64decdabc4`, `inside-bar-setup__a1528b4d74`, `momentum-terrain-3d-luxalgo__f7eb2c2d64`, `money-flow-index__3LM5J3rc0O`, `relative-strength-index-divergences-libertus__g2odvjJQz8`, `rth-opening-range-with-extensions__88bbcc36f3`, `session-liquidity__96d8d1599c`, `smc-target-liquidity-v35-manual-distance-control__811da09c25`, `supertrend-mtf-heatmap__ODcEBlvB3g`, `trend-range-detector-zeiierman__56816eee0d`, `vp-period__iO1NrPRRG5`

All: `gaps__Gaps`, `multi-time-period-charts__Multi-TimePe`, `pivot-points-standard__Pivot1Points`, `trading-sessions__Trading1Sess`, `all-chart-patterns-theeccentrictrader__03e4633d31`, `asianrange-and-killzones__ef41eb5ad6`, `atr-trailing-stoploss-strategy__oayb1wVXkZ`, `atr-trend-bands-misu__a34d44410a`, `auto-harmonic-patterns-open-source__ca6022754b`, `bigbeluga-smart-money-concepts__e41b7abd03`, `black-scholes-option-pricing-model-w-greeks-loxx__12d143e9b2`, `bollinger-band-width-percentile__03JuGF728K`, `bull-vs-bear-market-intraday-sessions-kioseff-trading__0999ba6cd8`, `camarilla-screener__UsBJPF3MkA`, `candlestick-patterns-on-backtest__c85b9d3ec6`, `chart-vwap__804099ca2f`, `correlation-matrix__dzN3DMCFJL`, `fair-value-gap__1048fa103a`, `fibonacci-retracement-statistics-by-volprofex__999c924fce`, `footprint-iq-pro-tradingiq__3b96428a77`, `fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated__578addf606`, `heat-map-seasons__53acdf3223`, `high-low-open-mid-ranges__5715509e0b`, `higher-time-frame-fair-value-gap-zeroherotrading__202f1347b8`, `htf-candle-footprint-cartel-console__ca3ff4e904`, `htf-liquidity-dashboard-tfo__ec8f8316a4`, `ict-institutional-order-flow-fadi__25d4834579`, `ict-killzone-index-version__28962c02dd`, `ict-killzones-pivots-tfo__d0b8be94f1`, `ipda-standard-deviations-dexterlab-x-tfo-x-toodegrees__7366c2d2c0`, `liquidity-heatmap-nephew-sam__7628c72c3d`, `machine-learning-rsi-bullvision__50b4566edd`, `market-profile-with-tpo__b2b119d8ab`, `market-sessions-and-volume-profile-by-leviathan__c85c28c18a`, `market-structure-inducements-ict-tradinfinder-choch-bos-sweeps__7569f1043e`, `mgi-levels-suite__285168ddfb`, `mtf-watchlist-charts-anan__3453680ea1`, `multi-timeframe-fvg-tfo__adbed9f590`, `multi-timeframe-supply-demand-zones__a98a2ab367`, `order-blocks__b324078711`, `position-size-calc__a42db1a620`, `power-of-3-ict-01-tradingfinder-amd-ict-smc-accumulations__c8dd500862`, `previous-day-high-and-low-separators-dailyweekly__0ef3e35a9d`, `screener-mean-reversion-channel__nTK2sHWDlB`, `session-tpo-profile__41088ef96d`, `strong-start-rvol-dashboard__36140b1cbe`, `supertrend-strategy__rcRbtoBiKG`, `support-and-resistance__c4792aabd0`, `swing-highlow-zigzag-chartprime__c53f5bc4e2`, `tehthomas-aligned-timeframe-fair-value-gaps__f843e207ca`, `trendline-pivots-quantvue__3dc9be8b73`, `trendlinesample__61d59f90bc`, `vdubus-pattern-gen-v2-restored-refined__66dc68412e`, `vold-market-breadth__9c5cde9557`, `volume-delta-oi-delta-kioseff-trading__9056fd6b37`, `volume-open-interest-footprint-by-leviathan__f84b8fc7c4`, `volume-profile-auto-line-v2__b0e947fd20`, `volume-profile-v054beta__PNSKf75832`, `volume-profile__X0dKLxdLh4`, `volume-suite-by-leviathan__48da793360`, `volumized-order-blocks-flux-charts__1675b2b8e3`, `zigzag-multi-time-frame-with-fibonacci-retracement__ppvz14qunp`, `auto-fibonacci-and-gann-fanretracements-combo__e764b93365`, `auto-trendlines-by-pivots-perfect-non-repainting-lines-spyqqq-daily-pr__8b82863b79`, `auto-trendlines-trendoscope__c1dc011801`, `bb-custom-indicator-tradingview-version__Vf3832aju8`, `cobra039s-crypto-market-visualizer__c3636f55f4`, `color-gradient-framework-pinecoders__9ICIDOiMbF`, `crypto-correlation-matrix__0f59de2d3d`, `custom-screener-with-alerts__dd1bf69eb8`, `dot-dynamics__Zd1PZqZcep`, `dual-supertrend-ichimoku-and-dmi-color-weighted-by-dgt__6pPzwGaxjU`, `dynamic-higher-timeframe-fibonacci-pivot-points__8Hv70DXiZU`, `dynamic-linear-regression-channels__17ec799bc1`, `dynamic-support-and-resistance-with-trend-lines-multi-language__1928d26a07`, `edufx-amd__0ca9b3c747`, `footprint__6848998fe8`, `fourier-extrapolator-of-price-w-projection-forecast-loxx__5c7061572f`, `fvg-instantaneous-mitigation-signals-luxalgo__4769478b4b`, `fvg-order-blocks-bigbeluga__64decdabc4`, `heatmap-volume-xdecow__2lteb6l2tk`, `inside-bar-setup__a1528b4d74`, `intraday-power-3-visual__f9b34d80bb`, `liquidity-pools-pro-willyalgotrader__409687ce4a`, `liquidity-swings-luxalgo__780e612168`, `machine-learning-random-forest-strategy-gainzalgo__fab416ff3f`, `momentum-terrain-3d-luxalgo__f7eb2c2d64`, `money-flow-index__3LM5J3rc0O`, `relative-strength-index-divergences-libertus__g2odvjJQz8`, `rsi-multi-timeframe-dashboard-by-giua64__cb0cdabd5f`, `rth-opening-range-with-extensions__88bbcc36f3`, `screener-for-40-instruments__a009097811`, `session-liquidity__96d8d1599c`, `smart-money-concepts-probability-expo__285cd9fa6f`, `smc-target-liquidity-v35-manual-distance-control__811da09c25`, `strategyrszigzag-pa-strategy-v41__2186`, `strategyrszigzag-pa-strategy-v4__2134`, `supertrend-mtf-heatmap__ODcEBlvB3g`, `supply-and-demand-zones-bigbeluga__6f46de6c8a`, `support-and-resistance-step-4__d24e4b30cf`, `support-resistance-fibonacci-retracement__06a1a2c80d`, `trend-channels-with-liquidity-breaks-chartprime__6cabbffddf`, `trend-range-detector-zeiierman__56816eee0d`, `volume-profile-heatmap__89dbe956a4`, `vp-period__iO1NrPRRG5`

</details>

<details><summary><b>[imperative]</b> (imperative): blocks 185, sole 48</summary>

Sole (this wall alone): `fisher-transform__Fisher_Trans`, `mcginley-dynamic__McGinley1Dyn`, `moving-average-convergence-divergence__MACD`, `percentage-volume-oscillator__Volume1Oscil`, `price-oscillator__Price_Oscill`, `relative-strength-index__RSI`, `time-weighted-average-price__Time1Weighte`, `volume-weighted-average-price__VWAP`, `williams-fractal__Whilliams_Fr`, `adx-and-di-for-v4__932`, `bolingger-bands-inside-bar-boxes__3294017d4f`, `deadband-hysteresis-filter-backquant__3fb3d09595`, `ema-92150-vwap-macd-rsi-pro-v6__014bfba33d`, `fvg-trend__21e364f2ed`, `ict-turtle-soup-flux-charts__053c3e6056`, `inside-bar-boxes__2f747d848b`, `inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat__832e485b9c`, `kalman-price-filter-backquant__47a601e4bc`, `machine-learning-moving-average-backquant__4d7ff59e68`, `moving-averages-as-support-resistance-mtf__gcBksfRvvy`, `nadaraya-watson-rational-quadratic-kernel-non-repainting__2d248c3125`, `nonlinear-regression-zero-lag-moving-average-loxx__e5075eb888`, `supply-demand-mtf-flux-charts__7fb4bff229`, `support-and-resistance-logistic-regression-flux-charts__9d844269d6`, `trend-line-harrybot__vMv5yOQxcA`, `trend-targets-algoalpha__92ff5628d7`, `volatility-coil-edge-bullbyte__604f0fd1c6`, `volume-divergence-by-mm__cvG2Djaryv`, `ai-moving-average-expo__cddaa37ee5`, `all-in-one-sessions-weekly-monday-previous-highslows__26254838fe`, `anti-volume-stop-loss__QyDEhGL8DB`, `coral-trend-indicator-lazybear__836`, `flying-buddha-inside-bars-indicator-v1-by-justunclel__0d9CiLNXGu`, `halftrend-longshort-signal-engine-bigbeluga__07070e14d6`, `kalman-trend-levels-bigbeluga__3fb104b310`, `laguerre-rsi-v4-lk__114`, `luxy-momentum-trend-and-breakout-indicators-with-multi-timeframe-bias-__0fa143447a`, `mtf-order-block-finder__ce13bf1b46`, `nadaraya-watson-trend-quantalgo__052bdb2a18`, `non-repainting-swing-highlow-signals__ccf063295a`, `order-block-detector-luxalgo__7c893384eb`, `price-divergence-detector-v32-revised-by-justunclel__iWPERpdLcd`, `rsi-kernel-optimized-flux-charts__427926d08f`, `thelark-lma-v2-laguerre__1029`, `twiggs-money-flow-lazybear__1562`, `uptrick-volatility-adjusted-trail__ff9f0f608f`, `volatility-regimes-gainzalgo__31d94ea2c3`, `williams-vix-fix-bottoms-and-tops__f5d5130307`

All: `chandelier-exit__Chandelier_E`, `cumulative-volume-delta__Cumulative1V`, `fisher-transform__Fisher_Trans`, `linear-regression-channel__Linear_Regre`, `mcginley-dynamic__McGinley1Dyn`, `moon-phases__Moon1Phases`, `moving-average-convergence-divergence__MACD`, `net-volume__Net1Volume`, `open-interest__OpenInterest`, `parabolic-sar-strategy__Parabolic1SA`, `percentage-volume-oscillator__Volume1Oscil`, `price-momentum-oscillator__Price_Moment`, `price-oscillator__Price_Oscill`, `pring039s-special-k__Prings_Speci`, `relative-strength-index__RSI`, `relative-volume-at-time__Relative1Vol`, `seasonality__Seasonality`, `technical-ratings__Technical1Ra`, `time-weighted-average-price__Time1Weighte`, `updown-volume__UP_DOWN_Volu`, `volatility-stop__Volatility_S`, `volume-delta__Volume1Delta`, `volume-weighted-average-price__VWAP`, `williams-fractal__Whilliams_Fr`, `72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt`, `adaptive-trend-following-suite-alpha-extract__d615e5a027`, `advanced-custom-multi-ma-signals-emasmavwmavwap__1bca3565a4`, `adx-and-di-for-v4__932`, `ai-supertrend-x-pivot-percentile-strategy-presenttrading__3b9db05a48`, `anchored-vwap-pinch-handoff-intervals-and-signals__2174489a80`, `atr-god-strategy-by-tradesmart__4369755a29`, `atr-stepped-pdf-ma-loxx__9b90a3f7bb`, `atr-trailing-stoploss-strategy__oayb1wVXkZ`, `atr-trend-bands-misu__a34d44410a`, `auto-trendlines-tradingfinder-support-resistance-signal-alerts__c78da9ac73`, `blackflag-fts__GdkmXaTINI`, `bolingger-bands-inside-bar-boxes__3294017d4f`, `boom-hunter-entry-point-screener-alerts__0fc5982548`, `breaks-and-retests-hg__ddba061af8`, `chart-vwap__804099ca2f`, `cvd-cumulative-volume-delta-candles__fb6471a4d9`, `cvd-cumulative-volume-delta-chart__84da7a14bf`, `deadband-hysteresis-filter-backquant__3fb3d09595`, `delta-imbalance-map-joat__b80f337fb3`, `delta-rsi-oscillator-strategy__z4Yj46FVTX`, `delta-volume-v21-by-kernel-phi__uP24atP4R0`, `deviation-scaled-moving-average-w-dsl-loxx__878af32b43`, `elliot-wave-detector-pro__ce1cc9553e`, `ema-92150-vwap-macd-rsi-pro-v6__014bfba33d`, `fibonacci-retracement-mtflog__54a8dbfa8e`, `fvg-trend__21e364f2ed`, `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor__f91c76bdec`, `ict-turtle-soup-flux-charts__053c3e6056`, `initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q`, `inside-bar-boxes__2f747d848b`, `inside-bar-range-mother-candle-breakoutbreakdown-with-volume-confirmat__832e485b9c`, `inside-bar-strategy-w-sl__b39f395d5d`, `kalman-price-filter-backquant__47a601e4bc`, `kalman-psar-backquant__0a389f529b`, `kernel-channel-backquant__d8c4b7f75c`, `linear-regression-channel-200__243d67c804`, `linear-regression-channel__jiDgL4o6Qx`, `liquidity-engulfing-displacement-msf__58824c94f0`, `liquidity-levels-sonarlab__bba13c46c4`, `macd-with-filter-visual-backtest-module-sample__kuNU8uQsIH`, `machine-learning-logistic-regression-v3__TDlqz0q9TN`, `machine-learning-lorentzian-classification__21f5ec5277`, `machine-learning-lorentzian-classification__5c7960db26`, `machine-learning-moving-average-backquant__4d7ff59e68`, `machine-learning-rsi-bullvision__50b4566edd`, `market-structure-break-order-block__3a1fb6197f`, `market-structure-trend-targets-chartprime__d3c06abad6`, `moving-averages-as-support-resistance-mtf__gcBksfRvvy`, `mtf-dashboard-pro-rsi-fib-sr-volume-strixedge__bad34083e8`, `nadaraya-watson-rational-quadratic-kernel-non-repainting__2d248c3125`, `neural-network-buy-and-sell-signals__fbbb11d0c7`, `nonlinear-regression-zero-lag-moving-average-loxx__e5075eb888`, `nubia-auto-midas-anchored-vwap-xdecow__MOpN5jQbSn`, `one-sided-gaussian-support-resistance-rate-loxx__c801e68b6c`, `open-interest-suite-aggregated-by-leviathan__44b150b3df`, `optimized-trend-tracker__ZhWiFvtpwE`, `order-block-finder__fVSb3j0I87`, `parabolic-sar__xoeoPMOWGJ`, `rate-of-change__5efd12f955`, `relative-volume-at-time__gei8CBKbc5`, `renderingnature-smc-reversal-engine-v71__f8734584d9`, `renko-candles-overlay__d76a18d49e`, `session-highs-and-lows-indicator-smc-sessions-dst-safe__c0ca8cf749`, `smart-money-breakout-channels-algoalpha__8c2d234156`, `smart-money-breakouts-chartprime__ea79c79a67`, `smart-money-concepts-by-welotrades__0bff41a2e5`, `smart-money-volume-activity-algoalpha__699c36ad31`, `smc-structures-and-multi-timeframe-fvg-ma-py__fd50b245b6`, `smoothed-gaussian-trend-filter-algoalpha__69de2e99a0`, `smt-divergence-ict-killzones__c932d56665`, `std-filtered-adaptive-exponential-hull-moving-average-loxx__6046c21764`, `stop-loss-clustering-breakouts-kioseff-trading__c6388de20b`, `supertrend-relative-volume-kernel-optimized-flux-charts__47728a39df`, `supply-demand-mtf-flux-charts__7fb4bff229`, `support-and-resistance-logistic-regression-flux-charts__9d844269d6`, `trailing-take-profit-trailing-stop-loss__41jwaH1ikz`, `trend-line-harrybot__vMv5yOQxcA`, `trend-targets-algoalpha__92ff5628d7`, `volatility-coil-edge-bullbyte__604f0fd1c6`, `volatility-stop-mtf__K5XG42uHV9`, `volume-divergence-by-mm__cvG2Djaryv`, `volume-footprint-measuring-classical-indicators-by-math-geometry-intro__e15e52b27d`, `volume-profile-bar-magnified-order-blocks-jacobmagleby__3b3ebba156`, `williams-fractal-trailing-stops__UOOIN5REYl`, `wyckoff-accumulation-distribution__d9ae726e21`, `aetheredge-smart-money-flow__c22c6f1f81`, `ai-moving-average-expo__cddaa37ee5`, `all-in-one-sessions-weekly-monday-previous-highslows__26254838fe`, `anchored-vwap__u9vU8nIMXA`, `anti-volume-stop-loss__QyDEhGL8DB`, `auto-length-moving-average-trend-signals-zeiierman__30185ad35b`, `best-sr-indicator-with-candlestick-patterns__4af8b3cc84`, `bitcoin-futures-funding-rates-v5__zGOXiHPIn3`, `breaks-and-retests-with-volatility-stop-hg__ebbd1d4440`, `color-gradient-framework-pinecoders__9ICIDOiMbF`, `coral-trend-indicator-lazybear__836`, `ct-displacement-fvg-toolkit__1ae5bb663e`, `cumulative-volume-delta-divergence__fbc538f076`, `delta-volume-columns-lucf__HmUxm6bIQC`, `divergence-screener-trendoscope__5bfc8355aa`, `divergence-stack-scanner-agpro-series__5bfe6b3a16`, `flying-buddha-inside-bars-indicator-v1-by-justunclel__0d9CiLNXGu`, `fvg-instantaneous-mitigation-signals-luxalgo__4769478b4b`, `gex-levels-breakout-structure-session-avwap-esspxspy__4e5d712bec`, `halftrend-longshort-signal-engine-bigbeluga__07070e14d6`, `ichimoku-kinko-hyo-一目均衡表__a8a2aa1034`, `interactive-atr-stop-loss__6d419f128f`, `kalman-trend-levels-bigbeluga__3fb104b310`, `kaufman-adaptive-bands__sXCNphOxWh`, `laguerre-rsi-v4-lk__114`, `logistic-rsi-stoch-roc-ao-by-dgt__aYY2rK1EEf`, `lorentzian-classification-advanced-trading-dashboard__0de1c85a2f`, `luxy-momentum-trend-and-breakout-indicators-with-multi-timeframe-bias-__0fa143447a`, `luxy-super-duper-supertrend-predictor-engine__582421244d`, `machine-learning-supertrend-aslan__68a59b1fc0`, `market-structure-with-inducements-sweeps-luxalgo__7948c21279`, `mirage-liquidity-sweep-pro-willyalgotrader__238f0e26eb`, `most-screener__d7d9ae5349`, `mtf-order-block-finder__ce13bf1b46`, `nadaraya-watson-combine__dbe3a7309e`, `nadaraya-watson-trend-quantalgo__052bdb2a18`, `non-repainting-swing-highlow-signals__ccf063295a`, `obv-macd-indicator__5JF4Np02Ma`, `open-interest-stochastic-money-flow-index__kGyXZBhXgx`, `order-block-detector-luxalgo__7c893384eb`, `ot-mtf-trend-dashboard-10__d43fa61404`, `price-divergence-detector-v32-revised-by-justunclel__iWPERpdLcd`, `qqe-mod-ssl-hybrid-waddah-attar-explosion__6092fcc4e7`, `range-filter-x-hull-suite__8430e18838`, `rsi-cyclic-smoothed__ckgSq3I4CY`, `rsi-entry-engine-trade-w-samet__6fa55b9515`, `rsi-kernel-optimized-flux-charts__427926d08f`, `rsi-trend-reversal__8ec0d3e25e`, `squeeze-momentum-indicator-lazybear-vx-by-dgt__bjAASLSxLp`, `strong-knn-classifier__852c26b11d`, `study-for-squeeze-momentum-indicator-lazybear__2BZblBj6eA`, `supertrend-cluster-zeiierman__9c3900bb94`, `supertrend-ladder-atr-1909capital-trendoscope__c61e4a062a`, `supertrendrange-by-dgt__jDAxwdo5u7`, `supply-and-demand-zones-with-enhanced-signals-and-stop-losstake-profit__0c84641326`, `support-and-resistance-zones-feels__87b9b078c8`, `swing-parabolic-sar-strategy__i5Ni9xpTee`, `thelark-lma-v2-laguerre__1029`, `trailing-sl-strategy-quantnomad__kvEZ1RweKL`, `trend-speed-analyzer-zeiierman__bd2f816c88`, `trendline-breaks-with-multi-fibonacci-supertrend-strategy__89cd796179`, `trendlines-2x__rzuOQrVQWt`, `twiggs-money-flow-lazybear__1562`, `uptrick-volatility-adjusted-trail__ff9f0f608f`, `volatility-regimes-gainzalgo__31d94ea2c3`, `volume-profile-free-pro-by-rrb__a7xsrJkK2R`, `volume-profile-free-ultra-sli-by-rrb__TFpVVPsMEJ`, `volume-supertrend-ai-zeiierman__b96fdd470d`, `volume-with-market-buysell-and-neutral-volume-split-for-realtime-bars__f4cd30cd7f`, `vwap-mtf__2809`, `vwap-stdev-bands-v2-mod__2741`, `vwap-stdev-bands-v2-mod__2744`, `vwap-supply-demand-zones-pro__537326bd2f`, `vwap-trendfollow-strategy-wbburgin__0279619ca1`, `williams-vix-fix-bottoms-and-tops__f5d5130307`

</details>

<details><summary><b>[strategy]</b> (strategy): blocks 70, sole 37</summary>

Sole (this wall alone): `bar-updown-strategy__Bars1Up1Dn1S`, `bollinger-bands-strategy-directed__Bollinger1Ba`, `bollinger-bands-strategy__Bollinger1Ba`, `channel-breakout-strategy__Channel1Brea`, `consecutive-updown-strategy__Consecutive1`, `greedy-strategy__Greedy1Strat`, `inside-bar-strategy__InSide1Bar1S`, `keltner-channels-strategy__Keltner1Chan`, `macd-strategy__MACD1Strateg`, `momentum-strategy__Momentum1Str`, `moving-average-crossover__MovingAvg1Cr`, `outside-bar-strategy__OutSide1Bar1`, `pivot-extension-strategy__Pivot1Extens`, `pivot-reversal-strategy__Pivot1Revers`, `price-channel-strategy__Price1Channe`, `rsi-strategy__RSI1Strategy`, `stochastic-slow-strategy__Stochastic1S`, `supertrend-strategy__SupertrendSt`, `two-moving-averages-crossover__MovingAvg1Cr`, `volatility-expansion-close-strategy__Volty1Expan1`, `flawless-victory-strategy__1BVZuaaWOU`, `highlow-channel-swing__e3692e253c`, `linear-regression-channel-breakout-strategy__3a1cf28800`, `macd-shortlong-strategy-for-tradingview-input-optimizer__59bb295a99`, `optimized-keltner-channels-sltp-strategy-for-btc__48bc69cf84`, `scalping-strategy-with-williams-r-macd-and-sma-1-minute-only__e247952471`, `tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto__EqnpYOP7hy`, `tradingview-alerts-to-mt4-mt5-strategy-example__LclqojYSOA`, `bollinger-bands-filter__M8AKuon90n`, `bollinger-rsi-double-strategy-by-chartart-v11__2187`, `camarillastrategyv1__1913`, `dynamic-swing-anchored-vwap-strategy-zeiierman-x-pineindicators__ee0c3c9ccd`, `golden-cross-sma-200-long-only-moving-average-strategy-by-chartart__2811`, `hull-moving-average-crossover-strategy__ASuWFtACGl`, `macd-sma-200-strategy-by-chartart__2004`, `ut-bot-strategy__VynMPwQs9U`, `vix-fix-stochrsi-strategy__3173`

All: `bar-updown-strategy__Bars1Up1Dn1S`, `bollinger-bands-strategy-directed__Bollinger1Ba`, `bollinger-bands-strategy__Bollinger1Ba`, `channel-breakout-strategy__Channel1Brea`, `consecutive-updown-strategy__Consecutive1`, `greedy-strategy__Greedy1Strat`, `inside-bar-strategy__InSide1Bar1S`, `keltner-channels-strategy__Keltner1Chan`, `macd-strategy__MACD1Strateg`, `momentum-strategy__Momentum1Str`, `moving-average-crossover__MovingAvg1Cr`, `outside-bar-strategy__OutSide1Bar1`, `parabolic-sar-strategy__Parabolic1SA`, `pivot-extension-strategy__Pivot1Extens`, `pivot-reversal-strategy__Pivot1Revers`, `price-channel-strategy__Price1Channe`, `rob-booker-adx-breakout__Rob1Booker1A`, `rsi-strategy__RSI1Strategy`, `stochastic-slow-strategy__Stochastic1S`, `supertrend-strategy__SupertrendSt`, `technical-ratings-strategy__Technical1Ra`, `two-moving-averages-crossover__MovingAvg1Cr`, `volatility-expansion-close-strategy__Volty1Expan1`, `72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt`, `ai-supertrend-x-pivot-percentile-strategy-presenttrading__3b9db05a48`, `atr-god-strategy-by-tradesmart__4369755a29`, `atr-trailing-stoploss-strategy__oayb1wVXkZ`, `buy-monday-exit-tuesday__8f2f69cc99`, `flawless-victory-strategy__1BVZuaaWOU`, `heikin-ashi-supertrend__2fb7267210`, `highlow-channel-swing__e3692e253c`, `inside-bar-strategy-w-sl__b39f395d5d`, `linear-regression-channel-breakout-strategy__3a1cf28800`, `macd-shortlong-strategy-for-tradingview-input-optimizer__59bb295a99`, `machine-learning-lorentzian-classification__5c7960db26`, `multi-timeframe-rsi-buy-sell-strategy-tradedots__1375ad2640`, `optimized-keltner-channels-sltp-strategy-for-btc__48bc69cf84`, `optimized-trend-tracker__ZhWiFvtpwE`, `pmax-explorer__jN9HBNhynF`, `rsi-vwap-indicator__pTI5ZVw9n4`, `scalping-strategy-with-williams-r-macd-and-sma-1-minute-only__e247952471`, `stop-loss-and-take-profit-in-example__YlblCbts4x`, `supertrend-strategy__rcRbtoBiKG`, `take-profit-multi-timeframe__8c16588ae9`, `tradingview-alerts-to-mt4-mt5-forex-indices-commodities-stocks-crypto__EqnpYOP7hy`, `tradingview-alerts-to-mt4-mt5-strategy-example__LclqojYSOA`, `trailing-take-profit-trailing-stop-loss__41jwaH1ikz`, `vwap-fibo-dev-extensions-strategy__mR2vfyGjUv`, `best-engulfing-ma__Vh6SGyOD3H`, `bollinger-bands-filter__M8AKuon90n`, `bollinger-rsi-double-strategy-by-chartart-v11__2187`, `camarillastrategyv1__1913`, `dynamic-swing-anchored-vwap-strategy-zeiierman-x-pineindicators__ee0c3c9ccd`, `fixed-percent-stop-loss-take-profit__1j62blFnpJ`, `footprint-strategy__c1753fd287`, `golden-cross-sma-200-long-only-moving-average-strategy-by-chartart__2811`, `hull-moving-average-crossover-strategy__ASuWFtACGl`, `macd-sma-200-strategy-by-chartart__2004`, `qqe-mod-ssl-hybrid-waddah-attar-explosion__6092fcc4e7`, `rsi-trend-reversal__8ec0d3e25e`, `strategyrszigzag-pa-strategy-v41__2186`, `strategyrszigzag-pa-strategy-v4__2134`, `swing-parabolic-sar-strategy__i5Ni9xpTee`, `tradepro039s-trading-idea-cipher-b-divergence-ema-pullback-strategy__98d2ed3472`, `trailing-sl-strategy-quantnomad__kvEZ1RweKL`, `trend-following-parabolic-buy-sell-strategy-tradedots__bb6d929535`, `trendline-breaks-with-multi-fibonacci-supertrend-strategy__89cd796179`, `ut-bot-strategy__VynMPwQs9U`, `vix-fix-stochrsi-strategy__3173`, `vwap-trendfollow-strategy-wbburgin__0279619ca1`

</details>

<details><summary><b>request.security</b> (request-security): blocks 49, sole 15</summary>

Sole (this wall alone): `advance-decline-line__Advance1Decl`, `correlation-coefficient__Correlation_`, `cumulative-volume-index__Cumulative1V`, `rob-booker-ziv-ghost-pivots__Rob1Booker1G`, `cumulative-volume-delta__c772250751`, `multi-timeframe-trend-indicator__fa4022ecf5`, `previous-n-daysweeksmonths-high-low__78f5b05522`, `best-rsi-divergences-screener-regular-and-hidden__F9uUIwmi9f`, `best-rsi-divergences-screener__TmlpugZKr6`, `chases-buysell-indicator-advance-decline__37714ef0a5`, `earnings-sr-levels-lazybear__453`, `global-liquidity-index__1b7ae64e24`, `multi-timeframe-rolling-bitmex-liquidation-levels__6luLopNPPH`, `my-cme-open-interest__ndAEr9lJjO`, `price-action-doji-harami-v02-by-justunclel__4219`

All: `24-hour-volume__24hVolume`, `advance-decline-line__Advance1Decl`, `advance-decline-ratio__Advance1Decl`, `correlation-coefficient__Correlation_`, `cumulative-volume-index__Cumulative1V`, `rob-booker-ziv-ghost-pivots__Rob1Booker1G`, `4c-nyse-market-breadth-ratio__722410befd`, `ad-line-of-sp-sectors__af306a4359`, `advanced-custom-multi-ma-signals-emasmavwmavwap__1bca3565a4`, `ai-supertrend-x-pivot-percentile-strategy-presenttrading__3b9db05a48`, `banknifty-mcclellan-oscillator__A2qCyYWwcs`, `cppivot-boss-floor-pivots-with-atr-dilation-and-dynamic-levels__eb13ccd13f`, `cumulative-volume-delta__c772250751`, `delta-volume-v21-by-kernel-phi__uP24atP4R0`, `deviation-scaled-moving-average-w-dsl-loxx__878af32b43`, `heikin-ashi-supertrend__2fb7267210`, `machine-learning-logistic-regression-v3__TDlqz0q9TN`, `multi-timeframe-rsi-buy-sell-strategy-tradedots__1375ad2640`, `multi-timeframe-trend-indicator__fa4022ecf5`, `previous-n-daysweeksmonths-high-low__78f5b05522`, `relative-volume-at-time__gei8CBKbc5`, `renderingnature-smc-reversal-engine-v71__f8734584d9`, `smart-money-concepts-by-welotrades__0bff41a2e5`, `std-filtered-adaptive-exponential-hull-moving-average-loxx__6046c21764`, `sub__1xYROVYMlX`, `swing-points-and-liquidity-by-leviathan__919c1fd9c6`, `take-profit-multi-timeframe__8c16588ae9`, `anchored-vwap__u9vU8nIMXA`, `best-abcd-pattern-screener__ROdc6mWjx4`, `best-rsi-divergences-screener-regular-and-hidden__F9uUIwmi9f`, `best-rsi-divergences-screener__TmlpugZKr6`, `bitcoin-futures-funding-rates-v5__zGOXiHPIn3`, `chases-buysell-indicator-advance-decline__37714ef0a5`, `delta-volume-columns-lucf__HmUxm6bIQC`, `earnings-sr-levels-lazybear__453`, `global-liquidity-index__1b7ae64e24`, `multi-timeframe-rolling-bitmex-liquidation-levels__6luLopNPPH`, `my-cme-open-interest__ndAEr9lJjO`, `ot-mtf-trend-dashboard-10__d43fa61404`, `price-action-doji-harami-v02-by-justunclel__4219`, `ripster-rvol-saty-atr-levels-v6-options-dashboard__fe6c658029`, `rsi-trend-reversal__8ec0d3e25e`, `saty-atr-levels__99165984ef`, `strategyrszigzag-pa-strategy-v41__2186`, `strategyrszigzag-pa-strategy-v4__2134`, `supply-and-demand-zones-with-enhanced-signals-and-stop-losstake-profit__0c84641326`, `tradepro039s-trading-idea-cipher-b-divergence-ema-pullback-strategy__98d2ed3472`, `trendlines-2x__rzuOQrVQWt`, `vumanchu-b-divergences__uA35GeckoT`

</details>

<details><summary><b>[imports-libraries]</b> (imports-libraries): blocks 65, sole 10</summary>

Sole (this wall alone): `auto-fib-extension__Auto1Fib1Ext`, `auto-fib-retracement__Auto1Fib1Ret`, `auto-pitchfork__Auto1Pitchfo`, `zigzag__Zig_Zag`, `smart-money-concept-tradingfinder-major-minor-ob-fvg-smc__3a423d6669`, `strength-of-divergence-across-multiple-indicators__ff2ae4fdab`, `volume-profile-plus__91ff446fe0`, `auto-chart-patterns-trendoscope__257dbd8cad`, `recursive-reversal-chart-patterns-trendoscope__c1da465c0a`, `solar-system-in-3d-astro-tool-w-zodiac-alien-algorithms__213cfb6fbb`

All: `24-hour-volume__24hVolume`, `aroon-oscillator__Aroon_Oscill`, `auto-fib-extension__Auto1Fib1Ext`, `auto-fib-retracement__Auto1Fib1Ret`, `auto-pitchfork__Auto1Pitchfo`, `chandelier-exit__Chandelier_E`, `cumulative-volume-delta__Cumulative1V`, `kaufman039s-adaptive-moving-average__Kaufmans_Ada`, `net-volume__Net1Volume`, `performance__Performance`, `price-momentum-oscillator__Price_Moment`, `pring039s-special-k__Prings_Speci`, `relative-volume-at-time__Relative1Vol`, `technical-ratings-strategy__Technical1Ra`, `technical-ratings__Technical1Ra`, `ulcer-index__Ulcer_Index`, `updown-volume__UP_DOWN_Volu`, `volume-delta__Volume1Delta`, `zigzag__Zig_Zag`, `adaptive-trend-following-suite-alpha-extract__d615e5a027`, `all-chart-patterns-theeccentrictrader__03e4633d31`, `atr-stop-loss-indicator__LOfv1FvRhL`, `atr-trend-bands-misu__a34d44410a`, `auto-trendlines-tradingfinder-support-resistance-signal-alerts__c78da9ac73`, `black-scholes-option-pricing-model-w-greeks-loxx__12d143e9b2`, `bull-vs-bear-market-intraday-sessions-kioseff-trading__0999ba6cd8`, `candlestick-patterns-on-backtest__c85b9d3ec6`, `chart-vwap__804099ca2f`, `cvd-cumulative-volume-delta-candles__fb6471a4d9`, `cvd-cumulative-volume-delta-chart__84da7a14bf`, `delta-volume-candles-lucf__qADnaAfCPp`, `deviation-scaled-moving-average-w-dsl-loxx__878af32b43`, `fx-market-sessions__3KZoMPYziy`, `heikin-ashi-supertrend__2fb7267210`, `kalman-psar-backquant__0a389f529b`, `machine-learning-lorentzian-classification__21f5ec5277`, `machine-learning-lorentzian-classification__5c7960db26`, `machine-learning-rsi-bullvision__50b4566edd`, `pivot-trendlines-with-breaks-hg__f1464ad5b7`, `rate-of-change__5efd12f955`, `rolling-vwap__043320bb57`, `rsi-trendlines-with-breakouts-hg__033f4cab46`, `smart-money-breakout-channels-algoalpha__8c2d234156`, `smart-money-concept-tradingfinder-major-minor-ob-fvg-smc__3a423d6669`, `smc-structures-and-multi-timeframe-fvg-ma-py__fd50b245b6`, `std-filtered-adaptive-exponential-hull-moving-average-loxx__6046c21764`, `stop-loss-clustering-breakouts-kioseff-trading__c6388de20b`, `strength-of-divergence-across-multiple-indicators__ff2ae4fdab`, `supertrend-relative-volume-kernel-optimized-flux-charts__47728a39df`, `trailing-take-profit-trailing-stop-loss__41jwaH1ikz`, `volatility-stop-mtf__K5XG42uHV9`, `volume-footprint-measuring-classical-indicators-by-math-geometry-intro__e15e52b27d`, `volume-profile-plus__91ff446fe0`, `auto-chart-patterns-trendoscope__257dbd8cad`, `auto-trendlines-trendoscope__c1dc011801`, `divergence-screener-trendoscope__5bfc8355aa`, `dynamic-support-and-resistance-with-trend-lines-multi-language__1928d26a07`, `footprint-strategy__c1753fd287`, `lorentzian-classification-advanced-trading-dashboard__0de1c85a2f`, `open-interest-stochastic-money-flow-index__kGyXZBhXgx`, `recursive-reversal-chart-patterns-trendoscope__c1da465c0a`, `solar-system-in-3d-astro-tool-w-zodiac-alien-algorithms__213cfb6fbb`, `supertrend-ladder-atr-1909capital-trendoscope__c61e4a062a`, `volume-profile-heatmap__89dbe956a4`, `vwap-trendfollow-strategy-wbburgin__0279619ca1`

</details>

<details><summary><b>[translator-robustness]</b> (translator-robustness): blocks 34, sole 7</summary>

Sole (this wall alone): `cc-yata__bd898a1af0`, `check-head-and-shouldersmask-man__INWKFwOBpV`, `multi-timeframe-vwap-v5__Au03ORcOFj`, `parabolic-sar-alerts-on-close-quantnomad__hdvUgc9je5`, `range-filter-buy-and-sell-5min__65cb674338`, `tradingviews-technical-analysis__oZFVfrvzZI`, `vwapmvwapema-crossover__N16MOYK6AE`

All: `cc-yata__bd898a1af0`, `chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2`, `cppivot-boss-floor-pivots-with-atr-dilation-and-dynamic-levels__eb13ccd13f`, `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor__f91c76bdec`, `initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q`, `momentum-based-zigzag__38d39d2d6c`, `mtf-key-levels-support-and-resistance__29f470a089`, `nubia-auto-midas-anchored-vwap-xdecow__MOpN5jQbSn`, `parabolic-sar__xoeoPMOWGJ`, `rsi-vwap-indicator__pTI5ZVw9n4`, `smoothed-gaussian-trend-filter-algoalpha__69de2e99a0`, `swing-points-and-liquidity-by-leviathan__919c1fd9c6`, `volume-spikes-growing-volume-signals-with-alerts-scanner__8e706f448f`, `vwap-fibo-dev-extensions-strategy__mR2vfyGjUv`, `angled-volume-profile-feeblev3__Z9Gy9K2ptd`, `check-head-and-shouldersmask-man__INWKFwOBpV`, `ct-displacement-fvg-toolkit__1ae5bb663e`, `gex-levels-breakout-structure-session-avwap-esspxspy__4e5d712bec`, `interactive-atr-stop-loss__6d419f128f`, `market-structure-with-inducements-sweeps-luxalgo__7948c21279`, `multi-timeframe-vwap-v5__Au03ORcOFj`, `parabolic-sar-alerts-on-close-quantnomad__hdvUgc9je5`, `range-filter-buy-and-sell-5min__65cb674338`, `strong-knn-classifier__852c26b11d`, `supertrendrange-by-dgt__jDAxwdo5u7`, `tradingviews-technical-analysis__oZFVfrvzZI`, `trailing-sl-strategy-quantnomad__kvEZ1RweKL`, `trendline-breaks-with-multi-fibonacci-supertrend-strategy__89cd796179`, `ut-bot-linreg-candles-longevity-zones-sr-dashboard__26fb08b910`, `volume-profile-free-pro-by-rrb__a7xsrJkK2R`, `volume-profile-free-ultra-sli-by-rrb__TFpVVPsMEJ`, `volume-supertrend-ai-zeiierman__b96fdd470d`, `vwap-supply-demand-zones-pro__537326bd2f`, `vwapmvwapema-crossover__N16MOYK6AE`

</details>

<details><summary><b>[output-contract]</b> (output-contract): blocks 6, sole 6</summary>

Sole (this wall alone): `bollinger-bars__Bollinger1Ba`, `chop-zone__Chop1Zone`, `one-indicator-multiple-max-40-checked-symbols-and-quotinfinitequot-num__015bb66e64`, `visualizing-displacement-tfo__5b861441c2`, `cm-forex-sessions-highlight-v1__41`, `trading-session-indicator__E4P4ZGnwPT`

All: `bollinger-bars__Bollinger1Ba`, `chop-zone__Chop1Zone`, `one-indicator-multiple-max-40-checked-symbols-and-quotinfinitequot-num__015bb66e64`, `visualizing-displacement-tfo__5b861441c2`, `cm-forex-sessions-highlight-v1__41`, `trading-session-indicator__E4P4ZGnwPT`

</details>

<details><summary><b>[history-offsets]</b> (history-offsets): blocks 22, sole 4</summary>

Sole (this wall alone): `detrended-price-oscillator__DPO`, `hull-moving-average__Hull1MA`, `hurst-cycle-channel-clone-lazybear__1192`, `range-filter-v1__T5nXpEBeCh`

All: `detrended-price-oscillator__DPO`, `hull-moving-average__Hull1MA`, `camarilla__jw9faob08r`, `renderingnature-smc-reversal-engine-v71__f8734584d9`, `smart-money-concepts-by-welotrades__0bff41a2e5`, `smarter-snr__ac98ab25d5`, `trend-levels-chartprime__90a5bf4ab1`, `auto-length-moving-average-trend-signals-zeiierman__30185ad35b`, `bb-custom-indicator-tradingview-version__Vf3832aju8`, `heatmap-volume-xdecow__2lteb6l2tk`, `hurst-cycle-channel-clone-lazybear__1192`, `ichimoku-kinko-hyo-一目均衡表__a8a2aa1034`, `qqe-mod-ssl-hybrid-waddah-attar-explosion__6092fcc4e7`, `range-filter-v1__T5nXpEBeCh`, `rsi-cyclic-smoothed__ckgSq3I4CY`, `sessions-nephew-sam__nTgXSYRNbD`, `spy-moving-averages-and-signals__KSz0yeOiH2`, `stoch-money-flow-admf-absolute-strength-index-asi-ci8dh__XqxUTKWKYq`, `trendlines-2x__rzuOQrVQWt`, `triangular-hull-moving-average-volatility-bigbeluga__f20311448f`, `volume-profile-free-pro-by-rrb__a7xsrJkK2R`, `volume-profile-free-ultra-sli-by-rrb__TFpVVPsMEJ`

</details>

<details><summary><b>[udt-methods]</b> (udt-methods): blocks 21, sole 4</summary>

Sole (this wall alone): `candelacharts-equal-highslows-eqheql__4485a6c447`, `support-resistance-mtf-flux-charts__dd04862677`, `volatility-trend-score-backquant__0794882a37`, `enhanced-mcclellan-summation-index__f2989eaa65`

All: `gaps__Gaps`, `moon-phases__Moon1Phases`, `candelacharts-equal-highslows-eqheql__4485a6c447`, `cvd-cumulative-volume-delta-candles__fb6471a4d9`, `cvd-cumulative-volume-delta-chart__84da7a14bf`, `elliot-wave-detector-pro__ce1cc9553e`, `fx-market-sessions__3KZoMPYziy`, `machine-learning-lorentzian-classification__21f5ec5277`, `machine-learning-lorentzian-classification__5c7960db26`, `rsi-trendlines-with-breakouts-hg__033f4cab46`, `smart-money-breakout-channels-algoalpha__8c2d234156`, `stop-loss-clustering-breakouts-kioseff-trading__c6388de20b`, `supertrend-relative-volume-kernel-optimized-flux-charts__47728a39df`, `support-resistance-mtf-flux-charts__dd04862677`, `volatility-trend-score-backquant__0794882a37`, `volume-delta-hapharmonic__d5748870fd`, `divergence-screener-trendoscope__5bfc8355aa`, `enhanced-mcclellan-summation-index__f2989eaa65`, `ichimoku-kinko-hyo-一目均衡表__a8a2aa1034`, `support-and-resistance-zones-feels__87b9b078c8`, `trend-following-parabolic-buy-sell-strategy-tradedots__bb6d929535`

</details>

<details><summary><b>object op dropped: cell:text</b> (drawing-objects): blocks 48, sole 3</summary>

Sole (this wall alone): `artemis-oscillator-pro__ea1097ca9e`, `ema-ribbon-trend-filter-strixedge__737f5c58ad`, `cryptosignalscanner-rsi-overboughtoversold-divergence-indicator-new__918919b267`

All: `4c-nyse-market-breadth-ratio__722410befd`, `artemis-oscillator-pro__ea1097ca9e`, `average-day-range-adr-pivots__38b8c996e9`, `black-scholes-option-pricing-model-w-greeks-loxx__12d143e9b2`, `cvd-cumulative-volume-delta-chart__84da7a14bf`, `delta-imbalance-map-joat__b80f337fb3`, `delta-volume-candles-lucf__qADnaAfCPp`, `ema-ribbon-trend-filter-strixedge__737f5c58ad`, `fibonacci-retracement-mtflog__54a8dbfa8e`, `fx-market-sessions__3KZoMPYziy`, `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor__f91c76bdec`, `htf-liquidity-dashboard-tfo__ec8f8316a4`, `ict-killzones-pivots-tfo__d0b8be94f1`, `machine-learning-lorentzian-classification__5c7960db26`, `mtf-dashboard-pro-rsi-fib-sr-volume-strixedge__bad34083e8`, `multicator-table__486858895c`, `open-interest-suite-aggregated-by-leviathan__44b150b3df`, `position-size-calc__a42db1a620`, `rolling-vwap__043320bb57`, `smart-money-breakouts-chartprime__ea79c79a67`, `smarter-snr__ac98ab25d5`, `vdubus-pattern-gen-v2-restored-refined__66dc68412e`, `vold-market-breadth__9c5cde9557`, `volume-delta-hapharmonic__d5748870fd`, `volume-footprint-measuring-classical-indicators-by-math-geometry-intro__e15e52b27d`, `volume-spikes-growing-volume-signals-with-alerts-scanner__8e706f448f`, `auto-length-moving-average-trend-signals-zeiierman__30185ad35b`, `auto-trendlines-trendoscope__c1dc011801`, `cobra039s-crypto-market-visualizer__c3636f55f4`, `crypto-correlation-matrix__0f59de2d3d`, `cryptosignalscanner-rsi-overboughtoversold-divergence-indicator-new__918919b267`, `gex-levels-breakout-structure-session-avwap-esspxspy__4e5d712bec`, `liquidity-pools-pro-willyalgotrader__409687ce4a`, `liquidity-sniper-pro__da4b93aa0a`, `lorentzian-classification-advanced-trading-dashboard__0de1c85a2f`, `machine-learning-random-forest-strategy-gainzalgo__fab416ff3f`, `ot-mtf-trend-dashboard-10__d43fa61404`, `ripster-rvol-saty-atr-levels-v6-options-dashboard__fe6c658029`, `rsi-multi-timeframe-dashboard-by-giua64__cb0cdabd5f`, `saty-atr-levels__99165984ef`, `sessions-nephew-sam__nTgXSYRNbD`, `strong-knn-classifier__852c26b11d`, `supertrendrange-by-dgt__jDAxwdo5u7`, `supply-and-demand-zones-bigbeluga__6f46de6c8a`, `support-and-resistance-step-4__d24e4b30cf`, `trend-speed-analyzer-zeiierman__bd2f816c88`, `ut-bot-linreg-candles-longevity-zones-sr-dashboard__26fb08b910`, `vwap-supply-demand-zones-pro__537326bd2f`

</details>

<details><summary><b>object op dropped: create:label</b> (drawing-objects): blocks 37, sole 3</summary>

Sole (this wall alone): `atr-trailing-stop-by-ceyhun__UMldb6tGLd`, `supertrend-explorer__V4MsmtCeKs`, `williams-r-rsi-ema-tendance-silver-wong__sogth7qpzs`

All: `linear-regression-channel__Linear_Regre`, `atr-trailing-stop-by-ceyhun__UMldb6tGLd`, `cppivot-boss-floor-pivots-with-atr-dilation-and-dynamic-levels__eb13ccd13f`, `fibonacci-retracement-mtflog__54a8dbfa8e`, `fx-market-sessions__3KZoMPYziy`, `htf-candle-footprint-cartel-console__ca3ff4e904`, `initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q`, `momentum-based-zigzag__38d39d2d6c`, `mtf-key-levels-support-and-resistance__29f470a089`, `multicator-table__486858895c`, `order-block-finder__fVSb3j0I87`, `pmax-explorer__jN9HBNhynF`, `rsi-vwap-indicator__pTI5ZVw9n4`, `smart-money-breakouts-chartprime__ea79c79a67`, `sub__1xYROVYMlX`, `supertrend-explorer__V4MsmtCeKs`, `trend-levels-chartprime__90a5bf4ab1`, `volume-delta-hapharmonic__d5748870fd`, `bb-custom-indicator-tradingview-version__Vf3832aju8`, `ct-displacement-fvg-toolkit__1ae5bb663e`, `delta-volume-columns-lucf__HmUxm6bIQC`, `dynamic-higher-timeframe-fibonacci-pivot-points__8Hv70DXiZU`, `fibonacci-extention-retracment-pivot-points-by-dgt__smOGfR6p3n`, `gex-levels-breakout-structure-session-avwap-esspxspy__4e5d712bec`, `intraday-power-3-visual__f9b34d80bb`, `linear-regression-channel-curve-slope-by-dgt__WvWdhArzmm`, `liquidity-pools-pro-willyalgotrader__409687ce4a`, `logistic-rsi-stoch-roc-ao-by-dgt__aYY2rK1EEf`, `lorentzian-classification-advanced-trading-dashboard__0de1c85a2f`, `market-structure-with-inducements-sweeps-luxalgo__7948c21279`, `most-screener__d7d9ae5349`, `range-filter-x-hull-suite__8430e18838`, `spy-moving-averages-and-signals__KSz0yeOiH2`, `strong-knn-classifier__852c26b11d`, `support-and-resistance__c13363a5d2`, `volume-with-market-buysell-and-neutral-volume-split-for-realtime-bars__f4cd30cd7f`, `williams-r-rsi-ema-tendance-silver-wong__sogth7qpzs`

</details>

<details><summary><b>[user-functions]</b> (user-functions): blocks 54, sole 2</summary>

Sole (this wall alone): `hma-kahlman-trend-trendlines__AhvnhJbO5J`, `money-flow-index-mtf-alerts__RkKU95fUai`

All: `advance-decline-ratio__Advance1Decl`, `kaufman039s-adaptive-moving-average__Kaufmans_Ada`, `moon-phases__Moon1Phases`, `technical-ratings__Technical1Ra`, `ulcer-index__Ulcer_Index`, `72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt`, `ad-line-of-sp-sectors__af306a4359`, `atr-stop-loss-indicator__LOfv1FvRhL`, `banknifty-mcclellan-oscillator__A2qCyYWwcs`, `blackflag-fts__GdkmXaTINI`, `boom-hunter-entry-point-screener-alerts__0fc5982548`, `chart-vwap__804099ca2f`, `cvd-cumulative-volume-delta-chart__84da7a14bf`, `delta-volume-candles-lucf__qADnaAfCPp`, `deviation-scaled-moving-average-w-dsl-loxx__878af32b43`, `initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q`, `kalman-psar-backquant__0a389f529b`, `kernel-channel-backquant__d8c4b7f75c`, `macd-with-filter-visual-backtest-module-sample__kuNU8uQsIH`, `machine-learning-lorentzian-classification__21f5ec5277`, `machine-learning-lorentzian-classification__5c7960db26`, `multiple-mtf-moving-average-xdecow__aArjfk9ShG`, `neural-network-buy-and-sell-signals__fbbb11d0c7`, `optimized-trend-tracker__ZhWiFvtpwE`, `rate-of-change__5efd12f955`, `relative-volume-at-time__gei8CBKbc5`, `rolling-vwap__043320bb57`, `sessions__2677`, `smc-structures-and-multi-timeframe-fvg-ma-py__fd50b245b6`, `std-filtered-adaptive-exponential-hull-moving-average-loxx__6046c21764`, `stop-loss-and-take-profit-in-example__YlblCbts4x`, `angled-volume-profile-feeblev3__Z9Gy9K2ptd`, `delta-volume-columns-lucf__HmUxm6bIQC`, `divergence-screener-trendoscope__5bfc8355aa`, `divergence-stack-scanner-agpro-series__5bfe6b3a16`, `fxn-asian-session-range__jNLZBfpYDO`, `hma-kahlman-trend-trendlines__AhvnhJbO5J`, `ichimoku-kinko-hyo-一目均衡表__a8a2aa1034`, `ict-killzone__fE0Mzs0mp0`, `kaufman-adaptive-bands__sXCNphOxWh`, `kz-boxes__zed4AoolEW`, `mirage-liquidity-sweep-pro-willyalgotrader__238f0e26eb`, `money-flow-index-mtf-alerts__RkKU95fUai`, `nylondonasian-sessions-ict-swings__14bce3660b`, `open-interest-stochastic-money-flow-index__kGyXZBhXgx`, `range-filter-x-hull-suite__8430e18838`, `spy-moving-averages-and-signals__KSz0yeOiH2`, `stoch-money-flow-admf-absolute-strength-index-asi-ci8dh__XqxUTKWKYq`, `supertrend-ladder-atr-1909capital-trendoscope__c61e4a062a`, `tradepro039s-trading-idea-cipher-b-divergence-ema-pullback-strategy__98d2ed3472`, `trend-following-parabolic-buy-sell-strategy-tradedots__bb6d929535`, `trendlines-2x__rzuOQrVQWt`, `triangular-hull-moving-average-volatility-bigbeluga__f20311448f`, `vumanchu-b-divergences__uA35GeckoT`

</details>

<details><summary><b>time</b> (builtin-missing): blocks 16, sole 2</summary>

Sole (this wall alone): `3-level-zigzag-semafor__3078`, `zigzag-ma-pattern-recognition__1302`

All: `3-level-zigzag-semafor__3078`, `chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2`, `initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q`, `relative-volume-at-time__gei8CBKbc5`, `session-highs-and-lows-indicator-smc-sessions-dst-safe__c0ca8cf749`, `sessions__2677`, `smart-money-concepts-by-welotrades__0bff41a2e5`, `zigzag-ma-pattern-recognition__1302`, `fxn-asian-session-range__jNLZBfpYDO`, `ict-killzone__fE0Mzs0mp0`, `kz-boxes__zed4AoolEW`, `nylondonasian-sessions-ict-swings__14bce3660b`, `range-filter-x-hull-suite__8430e18838`, `vwap-mtf__2809`, `vwap-stdev-bands-v2-mod__2741`, `vwap-stdev-bands-v2-mod__2744`

</details>

<details><summary><b>array.get</b> (collections): blocks 7, sole 2</summary>

Sole (this wall alone): `range-filter-bs-signals__eCVFctFlqp`, `range-filter-dw__pshyCmQSql`

All: `double-topbottom-ultimate-os__bd013ff4f5`, `market-structure-break-order-block__3a1fb6197f`, `range-filter-bs-signals__eCVFctFlqp`, `range-filter-dw__pshyCmQSql`, `swing-points-and-liquidity-by-leviathan__919c1fd9c6`, `best-sr-indicator-with-candlestick-patterns__4af8b3cc84`, `logistic-rsi-stoch-roc-ao-by-dgt__aYY2rK1EEf`

</details>

<details><summary><b>ta.sar</b> (builtin-missing): blocks 3, sole 2</summary>

Sole (this wall alone): `parabolic-sar__PSAR`, `mema-bb-parabolic-sar__nurAC4OTMa`

All: `parabolic-sar__PSAR`, `mema-bb-parabolic-sar__nurAC4OTMa`, `trend-following-parabolic-buy-sell-strategy-tradedots__bb6d929535`

</details>

### Runtime-on lane, top 15 walls
<details><summary><b>pine:statement</b> (W4): 76 scripts</summary>

`24-hour-volume__24hVolume`, `auto-fib-retracement__Auto1Fib1Ret`, `auto-pitchfork__Auto1Pitchfo`, `gaps__Gaps`, `moon-phases__Moon1Phases`, `pivot-points-standard__Pivot1Points`, `price-target__Price1Target`, `seasonality__Seasonality`, `trading-sessions__Trading1Sess`, `zigzag__Zig_Zag`, `72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt`, `adaptive-trend-following-suite-alpha-extract__d615e5a027`, `advanced-custom-multi-ma-signals-emasmavwmavwap__1bca3565a4`, `ai-supertrend-x-pivot-percentile-strategy-presenttrading__3b9db05a48`, `atr-god-strategy-by-tradesmart__4369755a29`, `blackflag-fts__GdkmXaTINI`, `boom-hunter-entry-point-screener-alerts__0fc5982548`, `bull-vs-bear-market-intraday-sessions-kioseff-trading__0999ba6cd8`, `correlation-matrix__dzN3DMCFJL`, `cvd-cumulative-volume-delta-candles__fb6471a4d9`, `cvd-cumulative-volume-delta-chart__84da7a14bf`, `delta-imbalance-map-joat__b80f337fb3`, `double-topbottom-ultimate-os__bd013ff4f5`, `footprint-iq-pro-tradingiq__3b96428a77`, `fx-market-sessions__3KZoMPYziy`, `heikin-ashi-true-strength-index-and-optimized-trend-tracker-erebor__f91c76bdec`, `ict-institutional-order-flow-fadi__25d4834579`, `inside-bar-strategy-w-sl__b39f395d5d`, `ipda-standard-deviations-dexterlab-x-tfo-x-toodegrees__7366c2d2c0`, `liquidity-engulfing-displacement-msf__58824c94f0`, `liquidity-levels-sonarlab__bba13c46c4`, `market-profile-with-tpo__b2b119d8ab`, `market-structure-trend-targets-chartprime__d3c06abad6`, `neural-network-buy-and-sell-signals__fbbb11d0c7`, `one-sided-gaussian-support-resistance-rate-loxx__c801e68b6c`, `renderingnature-smc-reversal-engine-v71__f8734584d9`, `screener-mean-reversion-channel__nTK2sHWDlB`, `smart-money-breakouts-chartprime__ea79c79a67`, `smart-money-volume-activity-algoalpha__699c36ad31`, `smoothed-gaussian-trend-filter-algoalpha__69de2e99a0`, `stop-loss-clustering-breakouts-kioseff-trading__c6388de20b`, `strength-of-divergence-across-multiple-indicators__ff2ae4fdab`, `support-and-resistance-logistic-regression-flux-charts__9d844269d6`, `tehthomas-aligned-timeframe-fair-value-gaps__f843e207ca`, `trailing-take-profit-trailing-stop-loss__41jwaH1ikz`, `trend-line-harrybot__vMv5yOQxcA`, `volatility-coil-edge-bullbyte__604f0fd1c6`, `volatility-trend-score-backquant__0794882a37`, `volume-delta-hapharmonic__d5748870fd`, `volume-footprint-measuring-classical-indicators-by-math-geometry-intro__e15e52b27d`, `volumized-order-blocks-flux-charts__1675b2b8e3`, `ai-moving-average-expo__cddaa37ee5`, `bb-custom-indicator-tradingview-version__Vf3832aju8`, `bitcoin-futures-funding-rates-v5__zGOXiHPIn3`, `color-gradient-framework-pinecoders__9ICIDOiMbF`, `cumulative-volume-delta-divergence__fbc538f076`, `divergence-screener-trendoscope__5bfc8355aa`, `enhanced-mcclellan-summation-index__f2989eaa65`, `fixed-percent-stop-loss-take-profit__1j62blFnpJ`, `hma-kahlman-trend-trendlines__AhvnhJbO5J`, `ichimoku-kinko-hyo-一目均衡表__a8a2aa1034`, `kaufman-adaptive-bands__sXCNphOxWh`, `luxy-momentum-trend-and-breakout-indicators-with-multi-timeframe-bias-__0fa143447a`, `machine-learning-supertrend-aslan__68a59b1fc0`, `mtf-order-block-finder__ce13bf1b46`, `order-block-detector-luxalgo__7c893384eb`, `rsi-entry-engine-trade-w-samet__6fa55b9515`, `spy-moving-averages-and-signals__KSz0yeOiH2`, `study-for-squeeze-momentum-indicator-lazybear__2BZblBj6eA`, `support-and-resistance-zones-feels__87b9b078c8`, `tradepro039s-trading-idea-cipher-b-divergence-ema-pullback-strategy__98d2ed3472`, `trend-following-parabolic-buy-sell-strategy-tradedots__bb6d929535`, `trendline-breaks-with-multi-fibonacci-supertrend-strategy__89cd796179`, `trendlines-jd__BYXZzZURrT`, `vwap-supply-demand-zones-pro__537326bd2f`, `williams-vix-fix-bottoms-and-tops__f5d5130307`

</details>

<details><summary><b>pine:builtin</b> (W1): 73 scripts</summary>

`24-hour-volume__24hVolume`, `aroon-oscillator__Aroon_Oscill`, `auto-fib-extension__Auto1Fib1Ext`, `auto-fib-retracement__Auto1Fib1Ret`, `auto-pitchfork__Auto1Pitchfo`, `chandelier-exit__Chandelier_E`, `kaufman039s-adaptive-moving-average__Kaufmans_Ada`, `open-interest__OpenInterest`, `pivot-points-standard__Pivot1Points`, `price-momentum-oscillator__Price_Moment`, `price-target__Price1Target`, `pring039s-special-k__Prings_Speci`, `technical-ratings-strategy__Technical1Ra`, `technical-ratings__Technical1Ra`, `ulcer-index__Ulcer_Index`, `visible-average-price__Visible1Aver`, `volume-weighted-average-price__VWAP`, `zigzag__Zig_Zag`, `72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt`, `advanced-custom-multi-ma-signals-emasmavwmavwap__1bca3565a4`, `atr-stop-loss-indicator__LOfv1FvRhL`, `atr-trend-bands-misu__a34d44410a`, `candelacharts-equal-highslows-eqheql__4485a6c447`, `chart-vwap__804099ca2f`, `cvd-cumulative-volume-delta-candles__fb6471a4d9`, `cvd-cumulative-volume-delta-chart__84da7a14bf`, `delta-volume-candles-lucf__qADnaAfCPp`, `deviation-scaled-moving-average-w-dsl-loxx__878af32b43`, `elliot-wave-detector-pro__ce1cc9553e`, `heikin-ashi-supertrend__2fb7267210`, `higher-time-frame-fair-value-gap-zeroherotrading__202f1347b8`, `ict-institutional-order-flow-fadi__25d4834579`, `liquidity-engulfing-displacement-msf__58824c94f0`, `market-profile-with-tpo__b2b119d8ab`, `market-sessions-and-volume-profile-by-leviathan__c85c28c18a`, `mgi-levels-suite__285168ddfb`, `open-interest-profile-fixed-range-by-leviathan__875691ab51`, `power-of-3-ict-01-tradingfinder-amd-ict-smc-accumulations__c8dd500862`, `rate-of-change__5efd12f955`, `rsi-trendlines-with-breakouts-hg__033f4cab46`, `smart-money-breakouts-chartprime__ea79c79a67`, `smart-money-volume-activity-algoalpha__699c36ad31`, `std-filtered-adaptive-exponential-hull-moving-average-loxx__6046c21764`, `supertrend-relative-volume-kernel-optimized-flux-charts__47728a39df`, `support-resistance-mtf-flux-charts__dd04862677`, `tehthomas-aligned-timeframe-fair-value-gaps__f843e207ca`, `trendline-pivots-quantvue__3dc9be8b73`, `volatility-stop-mtf__K5XG42uHV9`, `volume-delta-hapharmonic__d5748870fd`, `volume-delta-oi-delta-kioseff-trading__9056fd6b37`, `volume-open-interest-footprint-by-leviathan__f84b8fc7c4`, `volume-profile-plus__91ff446fe0`, `volumized-order-blocks-flux-charts__1675b2b8e3`, `anchored-vwap__u9vU8nIMXA`, `angled-volume-profile-feeblev3__Z9Gy9K2ptd`, `bb-custom-indicator-tradingview-version__Vf3832aju8`, `footprint-strategy__c1753fd287`, `footprint__6848998fe8`, `luxy-momentum-trend-and-breakout-indicators-with-multi-timeframe-bias-__0fa143447a`, `machine-learning-supertrend-aslan__68a59b1fc0`, `open-interest-stochastic-money-flow-index__kGyXZBhXgx`, `ot-mtf-trend-dashboard-10__d43fa61404`, `recursive-reversal-chart-patterns-trendoscope__c1da465c0a`, `rsi-trend-reversal__8ec0d3e25e`, `session-liquidity__96d8d1599c`, `solar-system-in-3d-astro-tool-w-zodiac-alien-algorithms__213cfb6fbb`, `support-and-resistance-zones-feels__87b9b078c8`, `volume-profile-free-pro-by-rrb__a7xsrJkK2R`, `volume-with-market-buysell-and-neutral-volume-split-for-realtime-bars__f4cd30cd7f`, `vwap-mtf__2809`, `vwap-stdev-bands-v2-mod__2741`, `vwap-stdev-bands-v2-mod__2744`, `vwap-trendfollow-strategy-wbburgin__0279619ca1`

</details>

<details><summary><b>runtime:call-undeclared-builtin-state</b> (W4): 68 scripts</summary>

`advance-decline-line__Advance1Decl`, `cumulative-volume-delta__Cumulative1V`, `moon-phases__Moon1Phases`, `net-volume__Net1Volume`, `updown-volume__UP_DOWN_Volu`, `volume-delta__Volume1Delta`, `72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt`, `asianrange-and-killzones__ef41eb5ad6`, `atr-god-strategy-by-tradesmart__4369755a29`, `atr-stop-loss-indicator__LOfv1FvRhL`, `boom-hunter-entry-point-screener-alerts__0fc5982548`, `camarilla__jw9faob08r`, `cvd-cumulative-volume-delta-candles__fb6471a4d9`, `delta-volume-v21-by-kernel-phi__uP24atP4R0`, `fibonacci-retracement-statistics-by-volprofex__999c924fce`, `ipda-standard-deviations-dexterlab-x-tfo-x-toodegrees__7366c2d2c0`, `kalman-psar-backquant__0a389f529b`, `linear-regression-channel-200__243d67c804`, `machine-learning-logistic-regression-v3__TDlqz0q9TN`, `machine-learning-lorentzian-classification__21f5ec5277`, `machine-learning-lorentzian-classification__5c7960db26`, `market-structure-trend-targets-chartprime__d3c06abad6`, `moving-averages-as-support-resistance-mtf__gcBksfRvvy`, `mtf-watchlist-charts-anan__3453680ea1`, `multiple-mtf-moving-average-xdecow__aArjfk9ShG`, `optimized-trend-tracker__ZhWiFvtpwE`, `pivot-trendlines-with-breaks-hg__f1464ad5b7`, `previous-day-high-and-low-separators-dailyweekly__0ef3e35a9d`, `relative-volume-at-time__gei8CBKbc5`, `rolling-vwap__043320bb57`, `rsi-trendlines-with-breakouts-hg__033f4cab46`, `smart-money-breakouts-chartprime__ea79c79a67`, `smart-money-concepts-by-welotrades__0bff41a2e5`, `smt-divergence-ict-killzones__c932d56665`, `strength-of-divergence-across-multiple-indicators__ff2ae4fdab`, `supertrend-relative-volume-kernel-optimized-flux-charts__47728a39df`, `supply-demand-mtf-flux-charts__7fb4bff229`, `volume-delta-hapharmonic__d5748870fd`, `volume-profile-auto-line-v2__b0e947fd20`, `angled-volume-profile-feeblev3__Z9Gy9K2ptd`, `auto-chart-patterns-trendoscope__257dbd8cad`, `best-abcd-pattern-screener__ROdc6mWjx4`, `best-rsi-divergences-screener-regular-and-hidden__F9uUIwmi9f`, `best-rsi-divergences-screener__TmlpugZKr6`, `delta-volume-columns-lucf__HmUxm6bIQC`, `divergence-stack-scanner-agpro-series__5bfe6b3a16`, `dynamic-support-and-resistance-with-trend-lines-multi-language__1928d26a07`, `footprint-strategy__c1753fd287`, `fvg-instantaneous-mitigation-signals-luxalgo__4769478b4b`, `fxn-asian-session-range__jNLZBfpYDO`, `interactive-atr-stop-loss__6d419f128f`, `kalman-trend-levels-bigbeluga__3fb104b310`, `lorentzian-classification-advanced-trading-dashboard__0de1c85a2f`, `luxy-super-duper-supertrend-predictor-engine__582421244d`, `money-flow-index-mtf-alerts__RkKU95fUai`, `mtf-order-block-finder__ce13bf1b46`, `obv-macd-indicator__5JF4Np02Ma`, `open-interest-stochastic-money-flow-index__kGyXZBhXgx`, `range-filter-x-hull-suite__8430e18838`, `rsi-kernel-optimized-flux-charts__427926d08f`, `solar-system-in-3d-astro-tool-w-zodiac-alien-algorithms__213cfb6fbb`, `supertrend-ladder-atr-1909capital-trendoscope__c61e4a062a`, `supertrend-mtf-heatmap__ODcEBlvB3g`, `support-and-resistance-zones-feels__87b9b078c8`, `thelark-lma-v2-laguerre__1029`, `tradepro039s-trading-idea-cipher-b-divergence-ema-pullback-strategy__98d2ed3472`, `trend-range-detector-zeiierman__56816eee0d`, `vumanchu-b-divergences__uA35GeckoT`

</details>

<details><summary><b>runtime:library</b> (W8): 64 scripts</summary>

`24-hour-volume__24hVolume`, `aroon-oscillator__Aroon_Oscill`, `auto-fib-extension__Auto1Fib1Ext`, `auto-fib-retracement__Auto1Fib1Ret`, `auto-pitchfork__Auto1Pitchfo`, `chandelier-exit__Chandelier_E`, `cumulative-volume-delta__Cumulative1V`, `kaufman039s-adaptive-moving-average__Kaufmans_Ada`, `net-volume__Net1Volume`, `performance__Performance`, `price-momentum-oscillator__Price_Moment`, `pring039s-special-k__Prings_Speci`, `relative-volume-at-time__Relative1Vol`, `technical-ratings-strategy__Technical1Ra`, `technical-ratings__Technical1Ra`, `ulcer-index__Ulcer_Index`, `updown-volume__UP_DOWN_Volu`, `volume-delta__Volume1Delta`, `zigzag__Zig_Zag`, `adaptive-trend-following-suite-alpha-extract__d615e5a027`, `all-chart-patterns-theeccentrictrader__03e4633d31`, `atr-stop-loss-indicator__LOfv1FvRhL`, `atr-trend-bands-misu__a34d44410a`, `auto-trendlines-tradingfinder-support-resistance-signal-alerts__c78da9ac73`, `black-scholes-option-pricing-model-w-greeks-loxx__12d143e9b2`, `bull-vs-bear-market-intraday-sessions-kioseff-trading__0999ba6cd8`, `candlestick-patterns-on-backtest__c85b9d3ec6`, `chart-vwap__804099ca2f`, `cvd-cumulative-volume-delta-candles__fb6471a4d9`, `cvd-cumulative-volume-delta-chart__84da7a14bf`, `delta-volume-candles-lucf__qADnaAfCPp`, `deviation-scaled-moving-average-w-dsl-loxx__878af32b43`, `fx-market-sessions__3KZoMPYziy`, `heikin-ashi-supertrend__2fb7267210`, `kalman-psar-backquant__0a389f529b`, `machine-learning-lorentzian-classification__21f5ec5277`, `machine-learning-lorentzian-classification__5c7960db26`, `machine-learning-rsi-bullvision__50b4566edd`, `pivot-trendlines-with-breaks-hg__f1464ad5b7`, `rate-of-change__5efd12f955`, `rolling-vwap__043320bb57`, `rsi-trendlines-with-breakouts-hg__033f4cab46`, `smart-money-breakout-channels-algoalpha__8c2d234156`, `smart-money-concept-tradingfinder-major-minor-ob-fvg-smc__3a423d6669`, `std-filtered-adaptive-exponential-hull-moving-average-loxx__6046c21764`, `stop-loss-clustering-breakouts-kioseff-trading__c6388de20b`, `strength-of-divergence-across-multiple-indicators__ff2ae4fdab`, `supertrend-relative-volume-kernel-optimized-flux-charts__47728a39df`, `trailing-take-profit-trailing-stop-loss__41jwaH1ikz`, `volatility-stop-mtf__K5XG42uHV9`, `volume-footprint-measuring-classical-indicators-by-math-geometry-intro__e15e52b27d`, `volume-profile-plus__91ff446fe0`, `auto-chart-patterns-trendoscope__257dbd8cad`, `auto-trendlines-trendoscope__c1dc011801`, `divergence-screener-trendoscope__5bfc8355aa`, `dynamic-support-and-resistance-with-trend-lines-multi-language__1928d26a07`, `footprint-strategy__c1753fd287`, `lorentzian-classification-advanced-trading-dashboard__0de1c85a2f`, `open-interest-stochastic-money-flow-index__kGyXZBhXgx`, `recursive-reversal-chart-patterns-trendoscope__c1da465c0a`, `solar-system-in-3d-astro-tool-w-zodiac-alien-algorithms__213cfb6fbb`, `supertrend-ladder-atr-1909capital-trendoscope__c61e4a062a`, `volume-profile-heatmap__89dbe956a4`, `vwap-trendfollow-strategy-wbburgin__0279619ca1`

</details>

<details><summary><b>pine:function</b> (W1): 53 scripts</summary>

`advance-decline-ratio__Advance1Decl`, `moon-phases__Moon1Phases`, `parabolic-sar__PSAR`, `relative-volume-at-time__Relative1Vol`, `3-level-zigzag-semafor__3078`, `ad-line-of-sp-sectors__af306a4359`, `asianrange-and-killzones__ef41eb5ad6`, `banknifty-mcclellan-oscillator__A2qCyYWwcs`, `chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2`, `ict-killzone-index-version__28962c02dd`, `market-structure-trend-targets-chartprime__d3c06abad6`, `mgi-levels-suite__285168ddfb`, `momentum-based-zigzag__38d39d2d6c`, `moving-averages-as-support-resistance-mtf__gcBksfRvvy`, `multi-timeframe-trend-indicator__fa4022ecf5`, `open-interest-profile-fixed-range-by-leviathan__875691ab51`, `open-interest-suite-aggregated-by-leviathan__44b150b3df`, `power-of-3-ict-01-tradingfinder-amd-ict-smc-accumulations__c8dd500862`, `relative-volume-at-time__gei8CBKbc5`, `screener-mean-reversion-channel__nTK2sHWDlB`, `session-highs-and-lows-indicator-smc-sessions-dst-safe__c0ca8cf749`, `session-hilo__WM2g5GtC4h`, `sessions__2677`, `smart-money-breakout-channels-algoalpha__8c2d234156`, `stop-loss-and-take-profit-in-example__YlblCbts4x`, `supertrend-relative-volume-kernel-optimized-flux-charts__47728a39df`, `trend-levels-chartprime__90a5bf4ab1`, `zigzag-ma-pattern-recognition__1302`, `bb-custom-indicator-tradingview-version__Vf3832aju8`, `divergence-stack-scanner-agpro-series__5bfe6b3a16`, `dynamic-swing-anchored-vwap-strategy-zeiierman-x-pineindicators__ee0c3c9ccd`, `fvg-order-blocks-bigbeluga__64decdabc4`, `hma-kahlman-trend-trendlines__AhvnhJbO5J`, `kalman-trend-levels-bigbeluga__3fb104b310`, `kaufman-adaptive-bands__sXCNphOxWh`, `machine-learning-supertrend-aslan__68a59b1fc0`, `mema-bb-parabolic-sar__nurAC4OTMa`, `most-screener__d7d9ae5349`, `nylondonasian-sessions-ict-swings__14bce3660b`, `ot-mtf-trend-dashboard-10__d43fa61404`, `qqe-mod-ssl-hybrid-waddah-attar-explosion__6092fcc4e7`, `rsi-kernel-optimized-flux-charts__427926d08f`, `session-liquidity__96d8d1599c`, `spy-moving-averages-and-signals__KSz0yeOiH2`, `squeeze-momentum-indicator-lazybear-vx-by-dgt__bjAASLSxLp`, `supertrendrange-by-dgt__jDAxwdo5u7`, `tradepro039s-trading-idea-cipher-b-divergence-ema-pullback-strategy__98d2ed3472`, `trend-following-parabolic-buy-sell-strategy-tradedots__bb6d929535`, `triangular-hull-moving-average-volatility-bigbeluga__f20311448f`, `volatility-regimes-gainzalgo__31d94ea2c3`, `volume-profile-free-ultra-sli-by-rrb__TFpVVPsMEJ`, `vp-period__iO1NrPRRG5`, `vumanchu-b-divergences__uA35GeckoT`

</details>

<details><summary><b>runtime:history-dynamic-offset</b> (W4): 40 scripts</summary>

`auto-fib-extension__Auto1Fib1Ext`, `linear-regression-channel__Linear_Regre`, `ict-institutional-order-flow-fadi__25d4834579`, `initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q`, `market-sessions-and-volume-profile-by-leviathan__c85c28c18a`, `market-structure-break-order-block__3a1fb6197f`, `momentum-based-zigzag__38d39d2d6c`, `nubia-auto-midas-anchored-vwap-xdecow__MOpN5jQbSn`, `open-interest-profile-fixed-range-by-leviathan__875691ab51`, `optimized-trend-tracker__ZhWiFvtpwE`, `range-filter-bs-signals__eCVFctFlqp`, `relative-volume-at-time__gei8CBKbc5`, `smart-money-concepts-by-welotrades__0bff41a2e5`, `smarter-snr__ac98ab25d5`, `support-and-resistance__c4792aabd0`, `trend-levels-chartprime__90a5bf4ab1`, `volatility-coil-edge-bullbyte__604f0fd1c6`, `volume-open-interest-footprint-by-leviathan__f84b8fc7c4`, `volume-profile-v054beta__PNSKf75832`, `zigzag-multi-time-frame-with-fibonacci-retracement__ppvz14qunp`, `anti-volume-stop-loss__QyDEhGL8DB`, `auto-length-moving-average-trend-signals-zeiierman__30185ad35b`, `cm-forex-sessions-highlight-v1__41`, `flying-buddha-inside-bars-indicator-v1-by-justunclel__0d9CiLNXGu`, `fxn-asian-session-range__jNLZBfpYDO`, `heatmap-volume-xdecow__2lteb6l2tk`, `ict-killzone__fE0Mzs0mp0`, `kz-boxes__zed4AoolEW`, `lorentzian-classification-advanced-trading-dashboard__0de1c85a2f`, `luxy-momentum-trend-and-breakout-indicators-with-multi-timeframe-bias-__0fa143447a`, `luxy-super-duper-supertrend-predictor-engine__582421244d`, `most-screener__d7d9ae5349`, `obv-macd-indicator__5JF4Np02Ma`, `open-interest-stochastic-money-flow-index__kGyXZBhXgx`, `range-filter-v1__T5nXpEBeCh`, `range-filter-x-hull-suite__8430e18838`, `rsi-trend-reversal__8ec0d3e25e`, `supertrend-cluster-zeiierman__9c3900bb94`, `trading-session-indicator__E4P4ZGnwPT`, `volatility-regimes-gainzalgo__31d94ea2c3`

</details>

<details><summary><b>runtime:no-output</b> (W4): 38 scripts</summary>

`advance-decline-ratio__Advance1Decl`, `bar-updown-strategy__Bars1Up1Dn1S`, `bollinger-bands-strategy-directed__Bollinger1Ba`, `bollinger-bands-strategy__Bollinger1Ba`, `chandelier-exit__Chandelier_E`, `channel-breakout-strategy__Channel1Brea`, `consecutive-updown-strategy__Consecutive1`, `greedy-strategy__Greedy1Strat`, `inside-bar-strategy__InSide1Bar1S`, `kaufman039s-adaptive-moving-average__Kaufmans_Ada`, `keltner-channels-strategy__Keltner1Chan`, `macd-strategy__MACD1Strateg`, `momentum-strategy__Momentum1Str`, `moving-average-crossover__MovingAvg1Cr`, `outside-bar-strategy__OutSide1Bar1`, `pivot-extension-strategy__Pivot1Extens`, `pivot-reversal-strategy__Pivot1Revers`, `price-channel-strategy__Price1Channe`, `rsi-strategy__RSI1Strategy`, `stochastic-slow-strategy__Stochastic1S`, `supertrend-strategy__SupertrendSt`, `technical-ratings-strategy__Technical1Ra`, `two-moving-averages-crossover__MovingAvg1Cr`, `updown-volume__UP_DOWN_Volu`, `volatility-expansion-close-strategy__Volty1Expan1`, `buy-monday-exit-tuesday__8f2f69cc99`, `correlation-matrix__dzN3DMCFJL`, `one-indicator-multiple-max-40-checked-symbols-and-quotinfinitequot-num__015bb66e64`, `power-of-3-ict-01-tradingfinder-amd-ict-smc-accumulations__c8dd500862`, `session-tpo-profile__41088ef96d`, `strong-start-rvol-dashboard__36140b1cbe`, `trendlinesample__61d59f90bc`, `zigzag-multi-time-frame-with-fibonacci-retracement__ppvz14qunp`, `camarillastrategyv1__1913`, `dynamic-swing-anchored-vwap-strategy-zeiierman-x-pineindicators__ee0c3c9ccd`, `rth-opening-range-with-extensions__88bbcc36f3`, `trading-session-indicator__E4P4ZGnwPT`, `trend-range-detector-zeiierman__56816eee0d`

</details>

<details><summary><b>runtime:object-op</b> (W4): 35 scripts</summary>

`gaps__Gaps`, `auto-harmonic-patterns-open-source__ca6022754b`, `breaks-and-retests-hg__ddba061af8`, `camarilla__jw9faob08r`, `chart-champions-part-1-npoc-levels-vwaps__wdeUFJ4ZD2`, `correlation-matrix__dzN3DMCFJL`, `double-topbottom-ultimate-os__bd013ff4f5`, `liquidity-levels-sonarlab__bba13c46c4`, `market-structure-break-order-block__3a1fb6197f`, `multi-timeframe-trend-indicator__fa4022ecf5`, `renderingnature-smc-reversal-engine-v71__f8734584d9`, `screener-mean-reversion-channel__nTK2sHWDlB`, `smarter-snr__ac98ab25d5`, `smt-divergence-ict-killzones__c932d56665`, `tehthomas-aligned-timeframe-fair-value-gaps__f843e207ca`, `trend-line-harrybot__vMv5yOQxcA`, `trendline-pivots-quantvue__3dc9be8b73`, `trendlinesample__61d59f90bc`, `volatility-coil-edge-bullbyte__604f0fd1c6`, `volume-delta-hapharmonic__d5748870fd`, `volume-profile-bar-magnified-order-blocks-jacobmagleby__3b3ebba156`, `all-in-one-sessions-weekly-monday-previous-highslows__26254838fe`, `breaks-and-retests-with-volatility-stop-hg__ebbd1d4440`, `ct-displacement-fvg-toolkit__1ae5bb663e`, `dynamic-support-and-resistance-with-trend-lines-multi-language__1928d26a07`, `edufx-amd__0ca9b3c747`, `fxn-asian-session-range__jNLZBfpYDO`, `hma-kahlman-trend-trendlines__AhvnhJbO5J`, `interactive-atr-stop-loss__6d419f128f`, `mirage-liquidity-sweep-pro-willyalgotrader__238f0e26eb`, `mtf-order-block-finder__ce13bf1b46`, `rsi-entry-engine-trade-w-samet__6fa55b9515`, `session-liquidity__96d8d1599c`, `smc-target-liquidity-v35-manual-distance-control__811da09c25`, `vwap-supply-demand-zones-pro__537326bd2f`

</details>

<details><summary><b>runtime:conditional-history</b> (W4): 33 scripts</summary>

`mcginley-dynamic__McGinley1Dyn`, `relative-strength-index__RSI`, `rob-booker-adx-breakout__Rob1Booker1A`, `atr-god-strategy-by-tradesmart__4369755a29`, `auto-harmonic-patterns-open-source__ca6022754b`, `banknifty-mcclellan-oscillator__A2qCyYWwcs`, `double-topbottom-ultimate-os__bd013ff4f5`, `ema-92150-vwap-macd-rsi-pro-v6__014bfba33d`, `kernel-channel-backquant__d8c4b7f75c`, `machine-learning-rsi-bullvision__50b4566edd`, `market-sessions-and-volume-profile-by-leviathan__c85c28c18a`, `market-structure-inducements-ict-tradinfinder-choch-bos-sweeps__7569f1043e`, `market-structure-trend-targets-chartprime__d3c06abad6`, `momentum-based-zigzag__38d39d2d6c`, `relative-volume-at-time__gei8CBKbc5`, `scalping-strategy-with-williams-r-macd-and-sma-1-minute-only__e247952471`, `support-and-resistance__c4792aabd0`, `trend-line-harrybot__vMv5yOQxcA`, `volumized-order-blocks-flux-charts__1675b2b8e3`, `all-in-one-sessions-weekly-monday-previous-highslows__26254838fe`, `auto-length-moving-average-trend-signals-zeiierman__30185ad35b`, `best-engulfing-ma__Vh6SGyOD3H`, `flying-buddha-inside-bars-indicator-v1-by-justunclel__0d9CiLNXGu`, `luxy-momentum-trend-and-breakout-indicators-with-multi-timeframe-bias-__0fa143447a`, `nadaraya-watson-trend-quantalgo__052bdb2a18`, `qqe-mod-ssl-hybrid-waddah-attar-explosion__6092fcc4e7`, `strategyrszigzag-pa-strategy-v41__2186`, `strategyrszigzag-pa-strategy-v4__2134`, `supply-and-demand-zones-with-enhanced-signals-and-stop-losstake-profit__0c84641326`, `trendlines-2x__rzuOQrVQWt`, `trendlines-jd__BYXZzZURrT`, `volatility-regimes-gainzalgo__31d94ea2c3`, `williams-vix-fix-bottoms-and-tops__f5d5130307`

</details>

<details><summary><b>pine:request</b> (W7): 31 scripts</summary>

`correlation-coefficient__Correlation_`, `cumulative-volume-index__Cumulative1V`, `volume-weighted-average-price__VWAP`, `ai-supertrend-x-pivot-percentile-strategy-presenttrading__3b9db05a48`, `cppivot-boss-floor-pivots-with-atr-dilation-and-dynamic-levels__eb13ccd13f`, `cumulative-volume-delta__c772250751`, `delta-imbalance-map-joat__b80f337fb3`, `delta-volume-candles-lucf__qADnaAfCPp`, `fibonacci-retracement-statistics-by-volprofex__999c924fce`, `initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q`, `machine-learning-logistic-regression-v3__TDlqz0q9TN`, `market-sessions-and-volume-profile-by-leviathan__c85c28c18a`, `previous-n-daysweeksmonths-high-low__78f5b05522`, `sub__1xYROVYMlX`, `swing-points-and-liquidity-by-leviathan__919c1fd9c6`, `volume-delta-oi-delta-kioseff-trading__9056fd6b37`, `volume-profile-bar-magnified-order-blocks-jacobmagleby__3b3ebba156`, `volume-suite-by-leviathan__48da793360`, `anchored-vwap__u9vU8nIMXA`, `bitcoin-futures-funding-rates-v5__zGOXiHPIn3`, `earnings-sr-levels-lazybear__453`, `footprint-strategy__c1753fd287`, `global-liquidity-index__1b7ae64e24`, `lorentzian-classification-advanced-trading-dashboard__0de1c85a2f`, `multi-timeframe-rolling-bitmex-liquidation-levels__6luLopNPPH`, `my-cme-open-interest__ndAEr9lJjO`, `open-interest-stochastic-money-flow-index__kGyXZBhXgx`, `ot-mtf-trend-dashboard-10__d43fa61404`, `price-action-doji-harami-v02-by-justunclel__4219`, `tradepro039s-trading-idea-cipher-b-divergence-ema-pullback-strategy__98d2ed3472`, `vwap-trendfollow-strategy-wbburgin__0279619ca1`

</details>

<details><summary><b>runtime:history-expression</b> (W4): 28 scripts</summary>

`ad-line-of-sp-sectors__af306a4359`, `advanced-custom-multi-ma-signals-emasmavwmavwap__1bca3565a4`, `atr-god-strategy-by-tradesmart__4369755a29`, `auto-trendlines-tradingfinder-support-resistance-signal-alerts__c78da9ac73`, `bollinger-band-width-percentile__03JuGF728K`, `machine-learning-logistic-regression-v3__TDlqz0q9TN`, `machine-learning-rsi-bullvision__50b4566edd`, `market-structure-inducements-ict-tradinfinder-choch-bos-sweeps__7569f1043e`, `momentum-based-zigzag__38d39d2d6c`, `multi-timeframe-trend-indicator__fa4022ecf5`, `neural-network-buy-and-sell-signals__fbbb11d0c7`, `optimized-trend-tracker__ZhWiFvtpwE`, `smart-money-breakouts-chartprime__ea79c79a67`, `best-engulfing-ma__Vh6SGyOD3H`, `flying-buddha-inside-bars-indicator-v1-by-justunclel__0d9CiLNXGu`, `hma-kahlman-trend-trendlines__AhvnhJbO5J`, `luxy-momentum-trend-and-breakout-indicators-with-multi-timeframe-bias-__0fa143447a`, `most-screener__d7d9ae5349`, `obv-macd-indicator__5JF4Np02Ma`, `qqe-mod-ssl-hybrid-waddah-attar-explosion__6092fcc4e7`, `range-filter-v1__T5nXpEBeCh`, `range-filter-x-hull-suite__8430e18838`, `smc-target-liquidity-v35-manual-distance-control__811da09c25`, `spy-moving-averages-and-signals__KSz0yeOiH2`, `trend-following-parabolic-buy-sell-strategy-tradedots__bb6d929535`, `triangular-hull-moving-average-volatility-bigbeluga__f20311448f`, `volatility-regimes-gainzalgo__31d94ea2c3`, `vumanchu-b-divergences__uA35GeckoT`

</details>

<details><summary><b>runtime:function</b> (W4): 27 scripts</summary>

`trading-sessions__Trading1Sess`, `ad-line-of-sp-sectors__af306a4359`, `asianrange-and-killzones__ef41eb5ad6`, `candelacharts-equal-highslows-eqheql__4485a6c447`, `fibonacci-retracement-statistics-by-volprofex__999c924fce`, `kalman-psar-backquant__0a389f529b`, `machine-learning-logistic-regression-v3__TDlqz0q9TN`, `mgi-levels-suite__285168ddfb`, `momentum-based-zigzag__38d39d2d6c`, `one-indicator-multiple-max-40-checked-symbols-and-quotinfinitequot-num__015bb66e64`, `pivot-trendlines-with-breaks-hg__f1464ad5b7`, `relative-volume-at-time__gei8CBKbc5`, `sessions__2677`, `smart-money-breakouts-chartprime__ea79c79a67`, `smart-money-concepts-by-welotrades__0bff41a2e5`, `smc-structures-and-multi-timeframe-fvg-ma-py__fd50b245b6`, `smt-divergence-ict-killzones__c932d56665`, `stop-loss-and-take-profit-in-example__YlblCbts4x`, `take-profit-multi-timeframe__8c16588ae9`, `trend-line-harrybot__vMv5yOQxcA`, `volume-profile-bar-magnified-order-blocks-jacobmagleby__3b3ebba156`, `delta-volume-columns-lucf__HmUxm6bIQC`, `divergence-stack-scanner-agpro-series__5bfe6b3a16`, `nylondonasian-sessions-ict-swings__14bce3660b`, `open-interest-stochastic-money-flow-index__kGyXZBhXgx`, `strong-knn-classifier__852c26b11d`, `triangular-hull-moving-average-volatility-bigbeluga__f20311448f`

</details>

<details><summary><b>runtime:statement</b> (W4): 24 scripts</summary>

`trading-sessions__Trading1Sess`, `adaptive-trend-following-suite-alpha-extract__d615e5a027`, `anchored-vwap-pinch-handoff-intervals-and-signals__2174489a80`, `chart-vwap__804099ca2f`, `ict-institutional-order-flow-fadi__25d4834579`, `kalman-psar-backquant__0a389f529b`, `machine-learning-moving-average-backquant__4d7ff59e68`, `market-profile-with-tpo__b2b119d8ab`, `market-sessions-and-volume-profile-by-leviathan__c85c28c18a`, `renderingnature-smc-reversal-engine-v71__f8734584d9`, `session-hilo__WM2g5GtC4h`, `support-and-resistance__c4792aabd0`, `take-profit-multi-timeframe__8c16588ae9`, `volume-open-interest-footprint-by-leviathan__f84b8fc7c4`, `volume-profile-v054beta__PNSKf75832`, `ai-moving-average-expo__cddaa37ee5`, `auto-chart-patterns-trendoscope__257dbd8cad`, `flying-buddha-inside-bars-indicator-v1-by-justunclel__0d9CiLNXGu`, `fxn-asian-session-range__jNLZBfpYDO`, `halftrend-longshort-signal-engine-bigbeluga__07070e14d6`, `mtf-order-block-finder__ce13bf1b46`, `solar-system-in-3d-astro-tool-w-zodiac-alien-algorithms__213cfb6fbb`, `thelark-lma-v2-laguerre__1029`, `trend-speed-analyzer-zeiierman__bd2f816c88`

</details>

<details><summary><b>runtime:expression-statement</b> (W4): 23 scripts</summary>

`zigzag__Zig_Zag`, `atr-trailing-stoploss-strategy__oayb1wVXkZ`, `breaks-and-retests-hg__ddba061af8`, `candelacharts-equal-highslows-eqheql__4485a6c447`, `ict-turtle-soup-flux-charts__053c3e6056`, `linear-regression-channel-200__243d67c804`, `multi-timeframe-fvg-tfo__adbed9f590`, `one-indicator-multiple-max-40-checked-symbols-and-quotinfinitequot-num__015bb66e64`, `pivot-trendlines-with-breaks-hg__f1464ad5b7`, `rsi-trendlines-with-breakouts-hg__033f4cab46`, `smart-money-breakouts-chartprime__ea79c79a67`, `smc-structures-and-multi-timeframe-fvg-ma-py__fd50b245b6`, `supertrend-relative-volume-kernel-optimized-flux-charts__47728a39df`, `support-resistance-mtf-flux-charts__dd04862677`, `trendline-pivots-quantvue__3dc9be8b73`, `volume-profile-bar-magnified-order-blocks-jacobmagleby__3b3ebba156`, `breaks-and-retests-with-volatility-stop-hg__ebbd1d4440`, `divergence-screener-trendoscope__5bfc8355aa`, `dynamic-swing-anchored-vwap-strategy-zeiierman-x-pineindicators__ee0c3c9ccd`, `fvg-order-blocks-bigbeluga__64decdabc4`, `momentum-terrain-3d-luxalgo__f7eb2c2d64`, `supertrend-ladder-atr-1909capital-trendoscope__c61e4a062a`, `trend-speed-analyzer-zeiierman__bd2f816c88`

</details>

<details><summary><b>runtime:array</b> (W6): 22 scripts</summary>

`pivot-points-standard__Pivot1Points`, `auto-trendlines-tradingfinder-support-resistance-signal-alerts__c78da9ac73`, `bollinger-band-width-percentile__03JuGF728K`, `bull-vs-bear-market-intraday-sessions-kioseff-trading__0999ba6cd8`, `candlestick-patterns-on-backtest__c85b9d3ec6`, `initial-balance-ib-and-previous-day-week-high-low-close__M0u1uaug4Q`, `machine-learning-moving-average-backquant__4d7ff59e68`, `market-sessions-and-volume-profile-by-leviathan__c85c28c18a`, `one-sided-gaussian-support-resistance-rate-loxx__c801e68b6c`, `range-filter-dw__pshyCmQSql`, `session-tpo-profile__41088ef96d`, `smart-money-concept-tradingfinder-major-minor-ob-fvg-smc__3a423d6669`, `supertrend-relative-volume-kernel-optimized-flux-charts__47728a39df`, `supply-demand-mtf-flux-charts__7fb4bff229`, `support-resistance-mtf-flux-charts__dd04862677`, `volume-open-interest-footprint-by-leviathan__f84b8fc7c4`, `divergence-screener-trendoscope__5bfc8355aa`, `footprint__6848998fe8`, `momentum-terrain-3d-luxalgo__f7eb2c2d64`, `rsi-kernel-optimized-flux-charts__427926d08f`, `supertrend-cluster-zeiierman__9c3900bb94`, `vp-period__iO1NrPRRG5`

</details>


## 9. Method, mapping and caveats

**Capability -> wave mapping** (production lane, `coverage_map.py` capability buckets):
W1 = `builtin-missing`, `call-mapping`, `translator-robustness`; W3 = `drawing-objects`;
W4 = `imperative`, `user-functions`, `tuples`, `history-offsets`, `text-colour-values`,
`na-semantics`, `realtime-bar-state`; W6 = `collections`, `udt-methods`; W7 = `request-security`;
W8 = `imports-libraries`; W9 = `strategy`; other = `output-contract`.

**Runtime-lane guard -> wave mapping:** W1 = `pine:builtin`, `pine:function`, `pine:arity`,
`pine:input-kind`, `pine:named-argument`, `pine:role-order` (see the section 4 caveat: 54 of
these scripts are really W4/W6/W8); W3 = `pine:drawing`, `host:pine:object*`, plus host-attached
dirty scripts; W6 = `runtime:array*`, `runtime:udt*`, `runtime:map*`, `runtime:matrix*`,
`pine:collection`, `pine:type`, `pine:member`; W7 = `pine:request`, `runtime:request*`,
`lower-tf:*`; W8 = `runtime:library`; W9 = `pine:strategy*` and every order-placing strategy;
other = `host:pine:constant-only`, `host:pine:presentation-only`, `threw`; everything else
(`pine:statement`, `runtime:*` history / statement / block / object-op / presentation /
builtin-over-state, `pine:state`, ...) = W4. Runtime-lane drawing walls (`runtime:object-op`,
`runtime:nothing-drawn`, `runtime:withheld-all`) are W4 group E ("drawing from the run") per
`PHASE3-RUNTIME-PLAN.md` 2.3, not W3.

**Caveats.**
- Door acceptance, not parity. A runtime-lane attach is counted without grading its drawing.
- The sample is the popular head (most-boosted first); built-ins transfer at 50% vs 21-31% for
  community scripts.
- The production and runtime lists are each a lane's own peel; a script's runtime-lane walls can
  differ from its production walls (the runtime lane is offered a script only on a host refusal).
- The engine's declared functions through the Pine door (`engineTableThroughPineDoor`) were NOT
  measured in this run (the field is empty; see the status note at the top). It does not feed
  any count above.

**How the target lists were made.** `coverage-targets-2026-11-02.json` is a join over
`coverage-map.json` only: `prodWalls` (production wall label -> scripts, from `scripts[].walls`),
`runtimeWalls` (runtime guard -> scripts, from `runtimeOn.walls.byScript`), `prodWaves` /
`runtimeWaves` (per wave: `blocks`, `onlyThisWave`, and production `firm`), `waveGreedy`,
`runtimeOnHostAttachedDirty`, and the capture lists (`captureGreedy`, `captureRegradeTransferring`,
`capturePopularUncaptured`; item usage from `coverage_map.usage_of`). Script keys are
`<population>:<slug>__<id>`; `titles` maps each key to its TradingView title.

## 10. How to re-run (exact commands used)

```sh
SCR=<scratch dir>; cp -r <sample cache>/. $SCR/prod/; cp -r <sample cache>/. $SCR/rt/
node tools/pine_survey/pine_reference_extract.js --out $SCR/ref/pine_v6_reference.json --cache $SCR/ref/_chunkcache
L="python $HEAVY_LOCK run --timeout 14400"   # HEAVY_LOCK = this machine's heavy_lock.py
$L --label census-prod -- python tools/pine_coverage/run_census.py --cache $SCR/prod --ref $SCR/ref/pine_v6_reference.json
$L --label census-rt   -- python tools/pine_coverage/run_census.py --runtime-on --cache $SCR/rt --ref $SCR/ref/pine_v6_reference.json
cd app
VENDOR_HARNESS_RUNTIME_ON=0 VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$SCR/verdicts-prod \
  $L --label harness-prod -- node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=2
VENDOR_HARNESS_RUNTIME_ON=1 VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$SCR/verdicts-rt \
  $L --label harness-rt -- node node_modules/vitest/vitest.mjs run src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=2
COVERAGE_DOOR_OUT=$SCR/engine_door.json $L --label engine-door -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js --maxWorkers=2
cd ..
python tools/pine_coverage/coverage_map.py --cache $SCR/prod --ref $SCR/ref/pine_v6_reference.json \
  --verdicts $SCR/verdicts-prod/verdicts.json --engine-door $SCR/engine_door.json \
  --runtime-cache $SCR/rt --runtime-verdicts $SCR/verdicts-rt/verdicts.json \
  --out docs/pine/coverage-map.json --measured-on 2026-11-02 --master-sha 6272ed7fa3
```

Wall-clock on the owner's PC: production census 10.7 min, runtime-on census 9.3 min, each
harness lane about 3 min (974 census rows per lane, no killed scripts, `LANE MEASURED` both).
