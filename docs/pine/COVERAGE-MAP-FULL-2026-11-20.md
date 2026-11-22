# Pine coverage map, full population (2026-11-20)

The coverage map ([`COVERAGE-MAP.md`](COVERAGE-MAP.md)) measures a 679-script sample. This page measures
**every open-source script we fetched**, with the same census: the same member door, the same `isClean`
predicate, both lanes, production's library store, the same served and wall rules
([`PARITY-ROADMAP-2026-11-18.md`](PARITY-ROADMAP-2026-11-18.md) section 1). It sits **beside** the 679 line and
replaces nothing: `coverage-map.json` and `parity-roadmap.json` stay the comparable series.

Owner ruling (2026-11-18, relayed): every outside script is **test material** for the engine's accuracy, so that
anyone can create and build on the platform. None of these scripts is served or derived from; they measure us.

Machine twins:
- [`coverage-map-full.json`](coverage-map-full.json): the map over the full population (the `census` block
  names the population file, the run, and every population script with no row);
- [`parity-roadmap-full.json`](parity-roadmap-full.json): the roadmap's walls, units and build order over it,
  derived by the same `parity_roadmap.py build` (rail: `tests/test_pine_census_full.py`);
- [`census-full/population.json`](census-full/population.json): the population, identifiers only.

Measured 2026-11-20 at `d7062cd8cb` (`SCRIPT_ENGINE_VERSION = 87`), production's library store (8 promoted
versions), on GitHub runners: workflow run
[44685778092](https://github.com/unchartedterritory5995-cyber/UCT-Dashboard/actions/runs/44685778092).

## 1. Headline

> **Members are served 1,831 of 5,091 public open-source scripts (36.0%)**, against 43.4% on the 679 sample in
> the same run. The sample over-states the whole population by about 7 points: the popularity plan and the
> built-ins it draws from are easier than the long tail (the ecosystem scripts: 34.8%).
> **3,260 (64.0%) are refused, every one by name** (at least one named wall each).
> **73 (1.4%) are served and graded MATCH** by a TradingView capture on the lane that serves them; the other
> 1,757 served scripts are served on the door's verdict alone (no capture, or an inconclusive or stale one), and 1
> is served with a DIVERGE capture.
> **The same-run 679 line is the committed one plus exactly one script**: 295 served against 294
> (`reference:camarilla-levels-intraday`, engines 85 to 87), host-only 227 against 226, runtime-on 300 against 299.
> Nothing else moved, so the runners (Node 20, Linux, both lanes at once) measure what the dev PC measures, and
> the full numbers below are comparable with the 679 series.

### 1.1 The headline in plain numbers

| | scripts | % of 5091 |
|---|---:|---:|
| served to a member (the door attaches and draws it) | **1831** | 36.0% |
| ... and a TradingView capture of it grades MATCH on the lane that serves it | 73 | 1.4% |
| ... graded MATCH with substituted inputs | 0 | 0.0% |
| ... a capture DIVERGEs (served, wrong somewhere) | 1 | 0.0% |
| ... served on the door's verdict alone (no capture, or inconclusive / stale) | 1757 | 34.5% |
| refused by name (every one of them carries at least one named wall) | **3260** | 64.0% |
| not served with no named wall | 0 | 0.0% |

The most common refusals, by the number of not-served scripts that carry them (a script can carry several):

| wall | unit | scripts carrying it | its only wall |
|---|---|---:|---:|
| `pine:builtin` | `builtins` | 528 | 43 |
| `runtime:call-undeclared-builtin-state` | `builtins` | 420 | 24 |
| `[strategy]` | `strategy` | 418 | 194 |
| `pine:function` | `builtins` | 410 | 79 |
| `runtime:statement` | `statements` | 330 | 62 |

"Served" is the roadmap's member model ([`PARITY-ROADMAP-2026-11-18.md`](PARITY-ROADMAP-2026-11-18.md)
section 1): the host lane transfers it fully, or the runtime lane draws it and the server's capability admission
admits it. The grade is the map's production verdict for a host-served script and the script's runtime-on
captures for a script only the runtime lane draws (`coverage_map.script_verdict`: any DIVERGE dominates).

### 1.2 Beside the 679 line

| measurement | scripts | member-served | runtime-on (census grants all) | host-only | not served |
|---|---:|---:|---:|---:|---:|
| **full population**, engine 87 (this run) | 5091 | **1831** (36.0%) | 1850 (36.3%) | 1189 (23.4%) | 3260 |
| the 679 sample inside this run (same engine, same runners) | 679 | **295** (43.4%) | 300 (44.2%) | 227 (33.4%) | 384 |
| the 679 map as committed (`coverage-map.json`, 2026-11-19, engine 85) | 679 | **294** (43.3%) | 299 (44.0%) | 226 (33.3%) | 385 |

### 1.3 By population

| population | scripts | member-served | runtime-on | host-only |
|---|---:|---:|---:|---:|
| committed | 266 | 91 (34.2%) | 95 (35.7%) | 61 (22.9%) |
| reference | 271 | 120 (44.3%) | 121 (44.6%) | 90 (33.2%) |
| builtin | 142 | 84 (59.2%) | 84 (59.2%) | 76 (53.5%) |
| ecosystem | 4412 | 1536 (34.8%) | 1551 (35.2%) | 962 (21.8%) |

### 1.4 By Pine version and declaration

| slice | scripts | member-served | host-only |
|---|---:|---:|---:|
| v1-v3 | 737 | 461 (62.6%) | 404 (54.8%) |
| v4 | 842 | 376 (44.7%) | 247 (29.3%) |
| v5 | 1705 | 557 (32.7%) | 323 (18.9%) |
| v6 | 1807 | 437 (24.2%) | 215 (11.9%) |
| `indicator()` | 4664 | 1831 (39.3%) | 1189 (25.5%) |
| `strategy()` | 418 | 0 (0.0%) | 0 (0.0%) |
| `library()` | 9 | 0 (0.0%) | 0 (0.0%) |

Modern scripts fare worst: v6 is served at 24.2% and v5 at 32.7%, against 62.6% for v1-v3. The ecosystem is
mostly v5 and v6 (3,050 of 4,412). No `strategy()` that places orders is served (the broker is not armed for
members; 418 strategies), and no `library()` (9).

## 2. Where the walls are, over all of it

### 2.1 Walls by engineering unit

Sole: the unit is the script's only wall (a fix of it alone serves the script). Any: one of its walls. The rank is by sole, as the roadmap's section 5 ranks.

| unit | kind | full: sole (enumerated) | full: any | full rank | 679: sole | 679: any | 679 rank |
|---|---|---:|---:|---:|---:|---:|---:|
| `objects` | engine | 453 (441) | 602 | 1 | 43 | 71 | 2 |
| `strategy` | owner | 249 (183) | 427 | 2 | 45 | 70 | 1 |
| `request` | engine | 176 (111) | 531 | 3 | 21 | 64 | 3 |
| `builtins` | engine | 172 (143) | 1147 | 4 | 18 | 150 | 4 |
| `dynamic-history` | engine | 93 (78) | 315 | 5 | 6 | 44 | 6 |
| `statements` | engine | 80 (58) | 563 | 6 | 3 | 54 | 9 |
| `conditional-history` | engine | 62 (41) | 267 | 7 | 6 | 30 | 7 |
| `output-contract` | engine | 59 (5) | 256 | 8 | 7 | 32 | 5 |
| `state-calls` | engine | 35 (30) | 221 | 9 | 2 | 18 | 14 |
| `libraries` | engine | 32 (32) | 348 | 10 | 2 | 58 | 13 |
| `lower-tf` | engine | 28 (20) | 109 | 11 | 4 | 14 | 8 |
| `compute-budget` | engine | 17 (14) | 47 | 12 | 3 | 6 | 12 |
| `request-with-state` | engine | 16 (11) | 156 | 13 | 3 | 27 | 10 |
| `imperative-host` | engine | 15 (15) | 43 | 14 | 0 | 6 | 30 |
| `robustness` | engine | 15 (2) | 40 | 15 | 0 | 1 | 35 |
| `call-mapping` | engine | 14 (13) | 96 | 16 | 1 | 7 | 20 |
| `functions` | engine | 13 (6) | 148 | 17 | 0 | 16 | 22 |
| `unmapped` | engine | 13 (13) | 33 | 18 | - | - | - |
| `block-value` | engine | 7 (6) | 84 | 19 | 1 | 12 | 17 |
| `function-global-state` | engine | 7 (5) | 63 | 20 | 0 | 8 | 28 |
| `loops` | engine | 6 (6) | 77 | 21 | 1 | 9 | 19 |
| `colour` | engine | 5 (4) | 94 | 22 | 0 | 14 | 23 |
| `admit:varip` | evidence | 5 (5) | 43 | 23 | 1 | 6 | 21 |
| `admit:method-def` | evidence | 4 (4) | 200 | 24 | 1 | 25 | 16 |
| `collections` | engine | 3 (3) | 113 | 25 | 0 | 9 | 26 |
| `admit:collections:matrix` | evidence | 3 (3) | 80 | 26 | 2 | 10 | 15 |
| `known-lists` | engine | 3 (3) | 11 | 27 | 3 | 11 | 11 |
| `admit:calc-bars` | evidence | 2 (2) | 67 | 28 | 1 | 9 | 18 |
| `admit:collections:map` | evidence | 2 (2) | 57 | 29 | 0 | 8 | 27 |
| `admit:enum` | evidence | 2 (2) | 44 | 30 | 0 | 4 | 32 |
| `detector` | engine | 1 (1) | 31 | 31 | 0 | 7 | 29 |
| `admit:obj:polyline` | evidence | 0 (0) | 122 | 32 | 0 | 9 | 25 |
| `types` | engine | 0 (0) | 70 | 33 | 0 | 11 | 24 |
| `realtime` | engine | 0 (0) | 8 | 34 | 0 | 3 | 33 |

What the full population changes:

- **Drawing objects (`objects`) are the biggest wall by far**: the sole wall of 453 scripts (441 fully
  enumerated), against 43 on the sample. It moves from second to first, by count and by boosts (section 2.4).
- **Strategies (`strategy`, the owner's broker decision)**: 249 sole, 427 any.
- **Statements and state calls climb**: `statements` from 10th to 6th (80 sole), `state-calls` from 14th to 9th
  (35 sole); `imperative-host` (15) and `robustness` (15) appear, from 0 on the sample.
- **Five walls no unit rule names** (filed under `unmapped`, as `parity_roadmap.py` does with a wall it cannot
  place): `pine:bool-na-unwitnessed` (any 18, sole 11), `interpret:node` (5, 2), `resolve:window` (8, 0),
  `pine:indent` (1, 0), `runtime:request-hoisted-history` (1, 0). The sample never met them. Each needs a unit rule
  in `parity_roadmap.UNITS` (an engine-roadmap decision, not made here).

### 2.2 Build order over the full population

| step | unit | size | unlocks | unlocks (enumerated) | served after | % |
|---:|---|---:|---:|---:|---:|---:|
| 1 | `objects` | 4 | 424 | 412 | 2255 | 44.3% |
| 2 | `request` | 2 | 119 | 77 | 2374 | 46.6% |
| 3 | `builtins` | 4 | 213 | 154 | 2587 | 50.8% |
| 4 | `statements` | 2 | 127 | 83 | 2714 | 53.3% |
| 5 | `dynamic-history` | 2 | 132 | 96 | 2846 | 55.9% |
| 6 | `output-contract` | 2 | 137 | 22 | 2983 | 58.6% |
| 7 | `conditional-history` | 2 | 128 | 66 | 3111 | 61.1% |
| 8 | `state-calls` | 2 | 107 | 65 | 3218 | 63.2% |
| 9 | `call-mapping` | 1 | 50 | 28 | 3268 | 64.2% |
| 10 | `functions` | 2 | 49 | 17 | 3317 | 65.2% |
| 11 | `admit:method-def` | 1 | 54 | 20 | 3371 | 66.2% |
| 12 | `function-global-state` | 2 | 40 | 16 | 3411 | 67.0% |
| 13 | `types` | 2 | 16 | 4 | 3427 | 67.3% |
| 14 | `libraries` | 4 | 210 | 79 | 3637 | 71.4% |
| 15 | `colour` | 1 | 48 | 20 | 3685 | 72.4% |
| 16 | `admit:obj:polyline` | 1 | 47 | 12 | 3732 | 73.3% |
| 17 | `request-with-state` | 2 | 95 | 34 | 3827 | 75.2% |
| 18 | `lower-tf` | 2 | 86 | 38 | 3913 | 76.9% |
| 19 | `loops` | 1 | 43 | 24 | 3956 | 77.7% |
| 20 | `admit:collections:matrix` | 1 | 40 | 18 | 3996 | 78.5% |
| 21 | `collections` | 2 | 89 | 39 | 4085 | 80.2% |
| 22 | `admit:calc-bars` | 1 | 45 | 11 | 4130 | 81.1% |
| 23 | `block-value` | 2 | 70 | 23 | 4200 | 82.5% |
| 24 | `admit:collections:map` | 1 | 39 | 8 | 4239 | 83.3% |
| 25 | `imperative-host` | 1 | 36 | 26 | 4275 | 84.0% |
| 26 | `admit:varip` | 1 | 31 | 11 | 4306 | 84.6% |
| 27 | `admit:enum` | 1 | 31 | 6 | 4337 | 85.2% |
| 28 | `robustness` | 1 | 33 | 2 | 4370 | 85.8% |
| 29 | `detector` | 1 | 30 | 3 | 4400 | 86.4% |
| 30 | `compute-budget` | 2 | 38 | 22 | 4438 | 87.2% |
| 31 | `unmapped` | 2 | 31 | 23 | 4469 | 87.8% |
| 32 | `known-lists` | 2 | 11 | 11 | 4480 | 88.0% |
| 33 | `realtime` | 2 | 8 | 1 | 4488 | 88.2% |

The upper bound, every unit built: 4,488 of 5,091 (88.2%), against the sample's 589 of 679 (86.7%). The first
step is the same as the sample's (`objects`), and it alone is worth 424 scripts here. Of the 3,260 not served,
1,815 have their whole wall list enumerated (the peel reached a build); for the rest, `sole` is an upper bound,
as on the sample. 203 of the served scripts are served on closed-bar history only, and 19 that the runtime lane
draws are declined by admission (`varip` 5, `method-def` 4, `collections:matrix` 3, `calc-bars` 2,
`collections:map` 2, `enum` 2, unreadable 1).

### 2.3 Never served, and data decisions

| class | scripts |
|---|---:|
| never-serve: `fundamentals` | 23 |
| never-serve: `footprint-ticks` | 27 |
| never-serve: `other-feeds` | 88 |
| never-serve: `licence` | 6 |
| never-serve: `broker` | 7 |
| data decision: `breadth` | 13 |
| data decision: `indices` | 32 |
| data decision: `corporate-events` | 15 |

### 2.4 Demand: units ranked by the boosts of the community scripts a fix alone would serve

| rank by boosts | unit | sole scripts | community | built-ins | boosts | rank by count |
|---:|---|---:|---:|---:|---:|---:|
| 1 | `objects` | 453 | 452 | 1 | 1071646 | 1 |
| 2 | `strategy` | 249 | 227 | 22 | 409261 | 2 |
| 3 | `builtins` | 172 | 170 | 2 | 352440 | 4 |
| 4 | `request` | 176 | 176 | 0 | 189293 | 3 |
| 5 | `dynamic-history` | 93 | 93 | 0 | 158849 | 5 |
| 6 | `statements` | 80 | 80 | 0 | 153010 | 6 |
| 7 | `conditional-history` | 62 | 61 | 1 | 106201 | 7 |
| 8 | `output-contract` | 59 | 57 | 2 | 95031 | 8 |
| 9 | `state-calls` | 35 | 34 | 1 | 79030 | 9 |
| 10 | `imperative-host` | 15 | 15 | 0 | 59110 | 14 |
| 11 | `lower-tf` | 28 | 27 | 1 | 53215 | 11 |
| 12 | `compute-budget` | 17 | 17 | 0 | 48300 | 12 |
| 13 | `libraries` | 32 | 31 | 1 | 43184 | 10 |
| 14 | `unmapped` | 13 | 13 | 0 | 36821 | 17 |
| 15 | `functions` | 13 | 13 | 0 | 36248 | 18 |
| 16 | `call-mapping` | 14 | 14 | 0 | 32120 | 16 |
| 17 | `request-with-state` | 16 | 16 | 0 | 23112 | 13 |
| 18 | `block-value` | 7 | 7 | 0 | 16050 | 19 |
| 19 | `known-lists` | 3 | 3 | 0 | 15276 | 25 |
| 20 | `robustness` | 15 | 15 | 0 | 15214 | 15 |
| 21 | `loops` | 6 | 6 | 0 | 11002 | 21 |
| 22 | `collections` | 3 | 3 | 0 | 9530 | 26 |
| 23 | `colour` | 5 | 5 | 0 | 7800 | 22 |
| 24 | `admit:varip` | 5 | 5 | 0 | 6264 | 23 |
| 25 | `function-global-state` | 7 | 7 | 0 | 6216 | 20 |
| 26 | `admit:collections:matrix` | 3 | 3 | 0 | 5282 | 27 |
| 27 | `admit:method-def` | 4 | 4 | 0 | 4361 | 24 |
| 28 | `admit:calc-bars` | 2 | 2 | 0 | 3855 | 28 |
| 29 | `admit:enum` | 2 | 2 | 0 | 837 | 29 |
| 30 | `detector` | 1 | 1 | 0 | 513 | 31 |
| 31 | `admit:collections:map` | 2 | 2 | 0 | 188 | 30 |

[`demand-ranking-full.json`](demand-ranking-full.json): `demand_ranking.build` (the same arithmetic as
[`demand-ranking.json`](demand-ranking.json)) over the full roadmap, with the ecosystem counted as community
scripts and every boost count read from the population file. Built-ins carry no boost count; sole unlocks only.

## 3. What the census could not finish

Eight lane runs died and are recorded `killed` (a row, never a gap): four scripts per lane, all ecosystem scripts.
Seven held a lane with no row for 15 minutes and the watchdog ended them; one exited the test process (rc 1).

| script | production | runtime-on |
|---|---|---|
| `ecosystem:ehlers-stochastic-cg-oscillator-lazybear__1368` | killed (no row 15 min) | killed (no row 15 min) |
| `ecosystem:fair-value-gap-profiles-algoalpha__c136c1df46` | killed (process exit 1) | killed (process exit 1) |
| `ecosystem:elliott-wave-rule-checker__1e6186f63d` | killed (no row 15 min) | |
| `ecosystem:ict-unicorn-model-breaker-block-fvg-zone-lunqfx__b94e103faf` | killed (no row 15 min) | |
| `ecosystem:chandelier-exit-oscillator-state-mapping__398844d2c2` | | killed (no row 15 min) |
| `ecosystem:correlation-crypto-matrix__e3aa497d08` | | killed (no row 15 min) |

A member pasting one of these would wait on a door that does not answer: compute-budget findings for the engine,
not census noise. Every other population script has a row on both lanes (`census.unmeasured` is empty).

## 4. The population, and how it was drawn

The 2026-09-08 ecosystem survey read 4,898 open-source scripts ([`README.md`](README.md)). **That cache no
longer exists**: it lived in a worktree scratch directory that has since been removed, and no copy of its catalogue
or sources was left on the machine. So "every script we have fetched" is a re-read made on 2026-11-20 with the
survey's own query vocabulary (`tools/pine_survey/tvfetch.py` `QUERIES`, 169 searches of TradingView's public
script search), not the 9/08 files.

| | 2026-09-08 survey | 2026-11-20 re-read |
|---|---:|---:|
| scripts catalogued by the 169 queries | 6,156 | 6,037 |
| open-source (`access` 1) | 4,898 | 4,938 |
| protected / invite-only | 932 / 326 | 800 / 299 |

| population | scripts | v1-v3 | v4 | v5 | v6 |
|---|---:|---:|---:|---:|---:|
| committed | 266 | 0 | 71 | 125 | 70 |
| reference | 271 | 84 | 61 | 66 | 60 |
| builtin | 142 | 1 | 0 | 0 | 141 |
| ecosystem | 4412 | 652 | 710 | 1514 | 1536 |
| **all** | **5091** | **737** | **842** | **1705** | **1807** |

The population is the 679 sample plus every open catalogued script that is not already in it:

- **committed** (266): `corpus/committed`, measured from the repository;
- **reference** (271) and **builtin** (142): the 679 sample's own scripts, each pinned to the TradingView revision
  whose text **is** the text the 679 map measured (413 of 413 pinned), so the 679 inside this run is the same text;
- **ecosystem** (4,412): every other open catalogued script, fetched by `/last` on 2026-11-20 (4,412 of 4,412).
  11 of the 537-script popularity plan are no longer returned by the queries; they stay in through the sample.

⚠️ Bias, as the 679 page says of its sample: a search catalogue is the popular head of each query, not the
whole long tail of TradingView, and it is dated (a re-read on another day returns a slightly different set).

## 5. How it was measured

**The census is the coverage map's own**, unchanged: `run_census.drive` (the door, `isClean`, the peel, the lane
proof, the store check), both lanes, production's library store (the allowlist's 8 promoted versions, held by
`promotion_check.py check --exact`), and TradingView's reference examples (288, matched by sha256 from a fresh
reference extract). The map and roadmap are `coverage_map.py` and `parity_roadmap.py facts` / `build` with no
full-population special case beyond counting a fourth population (`coverage_map.populations_of`).

**Where.** On GitHub runners, not the dev PC (`.github/workflows/pine-census-full.yml`): 4 long shard jobs, each
running both lanes at once (production in key order, runtime-on reversed so the two do not meet a heap-hungry
script together), plus one job for the vendor harness (both lanes, with the store) and the engine-door census. A
15-minute stall watchdog kills a lane that writes no row, and `drive` records the script as `killed`, as it
records an OOM death on the dev PC.

**The repository is public and most of these scripts are licence-held** ([`LICENSING.md`](LICENSING.md)):

- nothing we hold is sent to CI: each shard fetches its own scripts from TradingView's public `pine-facade`
  endpoint **by the pinned revision** and refuses a text whose sha256 is not the population file's;
- census rows and harness verdicts quote source lines, so they leave the runner only **sealed** (AES-256 under a
  random key, the key wrapped with RSA-OAEP to an operator public key whose private half never leaves the
  operator's machine); job logs and step summaries carry counts only; `tests/test_pine_census_full.py` holds the
  workflow to uploading only the sealed envelope;
- what is committed is identifiers and aggregates only, as `coverage-map.json` already is: the population file
  (key, public id, revision, sha256, boosts, kind, Pine version), the maps' per-script verdict rows and walls.

**What it cost.** Workflow run 44685778092: 4 shard jobs of 2 h 39 min to 3 h 36 min and a harness job of
9 min, about 715 runner-minutes, 06:11Z to 09:51Z. Per shard: the fetch took 97 to 99 minutes at 4.8 s per
request (1,273 rows, 0 sha mismatches, 0 refusals); the lanes took 59 to 116 minutes (shard 1 carried the
examples and two 15-minute stalls). The 50-script smoke run before it (44672463763) measured 0.69 s per
ecosystem script on the production lane and 1.13 s on runtime-on. Locally, coverage_map + roadmap facts/build
over the assembled rows: 2.5 minutes under the heavy lock.

**Politeness** (coordinator ruling): the shards together keep the survey's single-stream rate to TradingView,
one request per 1.2 s in aggregate (each shard waits 1.2 s x the shard count). A 429 or 403 is a refusal: the
script is recorded `unfetched` by name, the shard backs off and never retries it, and stops asking after five
refusals in a row. The map's `census.unmeasured` names every population script with no row.

## 6. Honest limits

- **Door verdicts on one daily chart** (NYSE:RDDT 1D), as the 679 map: a served script attaches and draws; it is
  not graded against TradingView unless a capture exists. The parity block joins captures by source text, so it
  covers almost only the 679 sample's scripts.
- **No render sweep over the full population.** The 679 map splits member-served by what the chart draws
  (`renderGaps`, from captures); the full map has no `renderGaps`, so its member-served is not split.
- **Environment.** The runners run Node 20 on Linux; the 679 map was measured on the dev PC (Node 24, Windows).
  The same-run 679 line (headline table) separates that effect from the population effect.
- **One script is lost on the runtime-on lane, and has no facts.** `ecosystem:chaikin-volatility-strategy__403`
  (an `indicator()`, whatever its title says) transfers fully on the host lane and is lost when the runtime pane
  is on, so it is counted not served, with the walls `[translator-robustness]` and `runtime:lost-on-runtime-on`.
  `parity_roadmap.py facts` skips host-clean scripts, so the roadmap lists it under `missingFacts`. The sample
  never had a lost script; this is the first, and a finding for the route-by-cost rule.
- **Row order.** Each lane is one vitest process over its shard, and the runtime-on lane walks it in reverse. Rows
  are independent by design (the 679 census restarts past a process death the same way); a cache that leaked
  between scripts would show as a difference between the same-run 679 line and the committed one.

## 7. How to re-run

```sh
SCR=<scratch dir>; P=docs/pine/census-full/population.json
# 1. the population (network: TradingView's public search + pine-facade, ~1 h at 0.5 s per request)
python tools/pine_coverage/census_full.py enumerate --cache $SCR/cache
python tools/pine_coverage/census_full.py fetch --cache $SCR/cache --sample <679 sample cache>
python tools/pine_coverage/census_full.py pin --cache $SCR/cache --sample <679 sample cache>
python tools/pine_coverage/census_full.py population --cache $SCR/cache --sample <679 sample cache> \
  --ref <ref_rebuilt.json> --out $P --created-on <yyyy-mm-dd>
# 2. a key pair (the private half stays on this machine), then a run branch: feature HEAD + one commit adding
#    ci/census-full/run.json ({"shards": 4, "harness": true, "libraries": [{path, pubId, sha256}...]}) and
#    ci/census-full/pubkey.pem; push census-full/run/<label>. The push runs `pine census full`.
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out $SCR/private.pem
openssl pkey -in $SCR/private.pem -pubout -out ci/census-full/pubkey.pem
# 3. after the run (under the heavy lock): download, unseal, assemble both lanes, map, stamp, roadmap
gh run download <run id> -D $SCR/artifacts
python tools/pine_coverage/census_full.py unseal --privkey $SCR/private.pem --sealed $SCR/artifacts/census-full-shard-1/shard-1 --out $SCR/shards/shard-1
#    (each shard, and census-full-harness/harness -> $SCR/harness)
python tools/pine_coverage/census_full.py assemble --population $P --cache $SCR/cache --shards $SCR/shards --of 4 --lane production --out $SCR/prod
python tools/pine_coverage/census_full.py assemble --population $P --cache $SCR/cache --shards $SCR/shards --of 4 --lane runtime-on --out $SCR/rt
python tools/pine_coverage/coverage_map.py --cache $SCR/prod --ref <ref_rebuilt.json> \
  --verdicts $SCR/harness/verdicts-prod/verdicts.json --runtime-cache $SCR/rt --runtime-verdicts $SCR/harness/verdicts-rt/verdicts.json \
  --engine-door $SCR/harness/engine_door.json --out docs/pine/coverage-map-full.json --measured-on <date> --master-sha <sha>
python tools/pine_coverage/census_full.py stamp --population $P --map docs/pine/coverage-map-full.json --run <run id>
python tools/pine_coverage/parity_roadmap.py facts --map docs/pine/coverage-map-full.json --ref <ref_rebuilt.json> \
  --names-ref <whole v6 reference> --cache $SCR/prod --runtime-cache $SCR/rt --verdicts ... --runtime-verdicts ... \
  --local-runs %LOCALAPPDATA%/uct-vendor-batch/runs --out $SCR/facts-full.json
python tools/pine_coverage/parity_roadmap.py build --map docs/pine/coverage-map-full.json --facts $SCR/facts-full.json \
  --out docs/pine/parity-roadmap-full.json
python tools/pine_coverage/census_full.py report ...   # the tables on this page
```
