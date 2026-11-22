# Pine coverage map, 2026-11-16 (engine 60 re-measure)

Measured 2026-11-16 on `origin/master` @ `890b6d165c` (`SCRIPT_ENGINE_VERSION = 60`), with the
repo's own tooling, unmodified. Machine twin: [`coverage-map.json`](coverage-map.json), regenerated
in this commit by `tools/pine_coverage/coverage_map.py`. Previous measurement: the committed JSON of
2026-11-05 (`masterSha 3ca4b0d358`, engine 18). The prose in [`COVERAGE-MAP.md`](COVERAGE-MAP.md)
is the 2026-10-30 map and keeps the definitions and the re-run procedure.

> **215 of 679 sampled open-source scripts (31.7%) transfer fully today** (212, 31.2%, on 11-05).
> **204 of those 215 are also clean on one bind** (`transferBound`, new since engine 55; no earlier value).
> **0 of 70 strategies transfer** (unchanged).

Door verdicts, not parity verdicts.

## 1. Same sample, same definition

- **Sample**: the same 679 scripts (266 committed, 271 reference, 142 built-in). All 679 keys match
  the 11-05 map and **every script's source sha256 is identical** to the 11-05 row (0 differ); Pine
  version, declaration and `placesOrders` are identical for all 679.
- **TradingView reference**: the same `ref_rebuilt.json` the 11-05 run used (288 whole-script
  examples; 967 census inputs per lane).
- **"Transfers fully"**: unchanged. `isClean` in `coverageMapDoorCensus.measure.test.js` and
  `transfers_fully` / `places_orders` in `coverage_map.py` are the 11-05 predicates; the engine's
  order-call set (`STRATEGY_ORDER_CALLS`) is the same 13 names.
- **What the instrument gained since 11-05** (additive; none of it enters the headline):
  - engine 55: `cleanBound` per script and `headline.transferBound` (the attached definition bound
    once on the RDDT 1D reference bars: no column error, no object op withheld as unknown, no
    spelling-decided other-symbol refusal, no fold note, no dark plot);
  - L7: `MATCH_SUBSTITUTED` as its own parity bucket; the evidence ledger and licence-held
    captures in the parity join;
  - W6 T1 / W3W4-D2: wall labels on the runtime lane (attribution only).
- ⚠️ **The paint rule changed AFTER this measurement** (instrument correction, branch
  `fix/pine-coverage-door-robustness`, coordinator ruling C): a paint (`bgcolor` / `barcolor`) now
  counts as withheld only when the document the member gets does not draw it
  (`tools/pine_coverage/paint_predicate.mjs`, imported by both measuring tests). Every number on this
  page is under the EARLIER rule (every paint the translation marked withheld counts, including a
  `barcolor` the runtime-on door draws from the per-bar run). A census run after the correction
  carries both on every row (`withheldPaints` / `withheldPaintsTranslated`, `clean` /
  `cleanTranslatedPaints`); a headline compared with this page must be stated under the earlier
  rule, or the difference is the instrument, not the engine.

## 2. Before and after

| | 2026-11-05 (`3ca4b0d358`) | 2026-11-16 (`890b6d165c`) | delta |
|---|---:|---:|---:|
| **transfers fully (headline)** | **212 (31.2%)** | **215 (31.7%)** | **+3** |
| transfers fully AND clean on one bind (`transferBound`) | not measured | 204 (30.0%) | |
| attached, any form | 287 (42.3%) | 287 (42.3%) | 0 |
| runtime-lane counterfactual / runtime-on lane | 260 (38.3%) | 267 (39.3%) | +7 |
| runtime-on: attached on the runtime lane | 50 | 55 | +5 |
| runtime-on: added over production / lost | 48 / 0 | 52 / 0 | +4 / 0 |
| strategies transferring | 0 of 70 | 0 of 70 | 0 |
| strategies the door draws but that place orders | 13 | 13 | 0 |
| TradingView reference examples transferring | 83 of 288 | 84 of 288 | +1 |

By population (transfer / attached / runtime counterfactual):

| population | n | 11-05 | 11-16 |
|---|---:|---|---|
| committed | 266 | 56 (21.1%) / 86 / 80 | 58 (21.8%) / 88 / 86 |
| reference | 271 | 85 (31.4%) / 129 / 101 | 86 (31.7%) / 127 / 102 |
| builtin | 142 | 71 (50.0%) / 72 / 79 | 71 (50.0%) / 72 / 79 |

By Pine version and declaration (transfer):

| slice | n | 11-05 | 11-16 |
|---|---:|---:|---:|
| Pine v1-v3 | 85 | 49 (57.6%) | 49 (57.6%) |
| Pine v4 | 132 | 40 (30.3%) | 41 (31.1%) |
| Pine v5 | 191 | 37 (19.4%) | 39 (20.4%) |
| Pine v6 | 271 | 86 (31.7%) | 86 (31.7%) |
| `indicator()` / `study()` | 609 | 212 (34.8%) | 215 (35.3%) |
| `strategy()` | 70 | 0 | 0 |

## 3. Blockers (top 15 of this map; the same 15 as on 11-05)

| blocker | scriptsBlocked 11-05 | 11-16 | soleBlockerOf 11-05 | 11-16 |
|---|---:|---:|---:|---:|
| `[imperative]` | 178 | 176 | 39 | 38 |
| `[strategy]` | 70 | 70 | 38 | 37 |
| `[request-security]` | 54 | 54 | 17 | 16 |
| `[imports-libraries]` | 65 | 61 | 10 | 11 |
| `[user-functions]` | 67 | 68 | 9 | 9 |
| `[translator-robustness]` | 36 | 50 | 7 | 9 |
| `[output-contract]` | 6 | 5 | 6 | 5 |
| `[history-offsets]` | 22 | 22 | 4 | 4 |
| `[drawing-objects]` | 44 | 44 | 3 | 3 |
| `[paint-withheld]` | 25 | 20 | 6 | 3 |
| `[udt-methods]` | 20 | 20 | 4 | 3 |
| `object op dropped: create:label <- pine:text-value` | 11 | 10 | 2 | 2 |
| `array.get` | 9 | 9 | 2 | 2 |
| `[text-colour-values]` | 8 | 8 | 2 | 2 |
| `ta.sar` | 3 | 3 | 2 | 2 |

`[translator-robustness]` grew by 14 scripts blocked: the engines since 18 refuse more shapes by
name. `[paint-withheld]` fell by 5 (sole 6 to 3).

## 4. Scripts that STOPPED transferring (2)

| script | refusal now | classification |
|---|---|---|
| `reference:ytc-swing-highs-lows__H94Z0NbN5P` (Pine v3) | no longer attaches: `pine:fn-history-in-block` on `has_LH_LH_EQ_LH_EQ_LH_LH`, line 156 | **Deliberate named refusal of previously wrong output.** `67e779e70f` (legacy semantics, B3): a function that reads a chart series at an offset and is called inside an `if` reads its own carried copy at v2/v3; the host lane drew the chart's history instead (the commit cites "G7, ytc bar 46") and now refuses v1-v3 block calls by name. It also left the runtime counterfactual. |
| `reference:volume-pace-pressure-table__235d4849a0` (Pine v5) | still attaches; 2 of 17 object ops dropped: `cell:text <- pine:type` at lines 130 and 131 (`pine:objects-only`) | **Named refusal of a previously guessed output, and the name is wrong for this script.** `34e2663587` (CBC-FMT, engine 59) turned the object reader's last resort ("a bare numeric expression in a text slot", carried as a number) into a `pine:type` refusal. Here the two texts are `var string` variables assigned in an `if` (`volPaceString`, `percentVolPaceString`): strings in Pine, which TradingView compiles. Before engine 59 the two cells were carried as numbers (a guess, counted clean); now they are dropped. What the pre-59 cells rendered was not re-measured. This is a host-lane gap (a mutable string the reader cannot follow), not a correct refusal of a compile error. |

## 5. Scripts that newly transfer (5)

| script | wall on 11-05 |
|---|---|
| `committed:session-hilo__WM2g5GtC4h` | `input.time` |
| `committed:visualizing-displacement-tfo__5b861441c2` | `[output-contract]` (`pine:no-output`) |
| `reference:flying-buddha-inside-bars-indicator-v1-by-justunclel__0d9CiLNXGu` | `[imperative]` |
| `reference:inside-bar-setup__a1528b4d74` | `[paint-withheld]` |
| `reference:money-flow-index__3LM5J3rc0O` | `[paint-withheld]` |

Net: +5, -2 = +3.

Other movement that does not touch the headline:

- **Attached, any form**: 3 gained, 3 lost (net 0). Lost: the ytc script above, and
  `reference:liquidity-pools-pro-willyalgotrader__409687ce4a` and
  `reference:rsi-multi-timeframe-dashboard-by-giua64__cb0cdabd5f`, both now refused
  `pine:prop-unreadable` (engine 52, `0e065a58cf`, "serve, never default": an unreadable object
  property is withheld by name). Neither transferred on 11-05.
- **Runtime counterfactual**: 10 gained, 3 lost. Lost: the two scripts of section 4, and
  `committed:machine-learning-knn-based-strategy__lj1Gjlbycb` (the runtime lane no longer attaches
  it; first host guard `pine:collection`; not traced to a commit).
- **Clean at the door but not on one bind** (11, in `scripts[].cleanBound == false`):
  `committed:btc-charlie-trader-xo-macro-trend-scanner`, `committed:k-clustering`,
  `committed:mcclellan-indicators`, `committed:poor-man039s-volume-profile`,
  `committed:smt-divergence-ict-01-tradingfinder-smart-money-technique`,
  `reference:advance-decline-line-nyse-buschi`,
  `reference:fixed-percent-stop-loss-take-profit-for-study-scripts`,
  `reference:kyadvance-decline-line`, `reference:mcclellan-oscillator-advndecl-breadth-indicator-lazybear`,
  `reference:pivot-based-swing-highs-and-lows`, `reference:uptrick-volume-weighted-bands`.
  These still count in the headline 215, because the headline predicate is the 11-05 one.

## 6. Not comparable with 11-05

- **Parity (`parity`, `runtimeOn.parity`, `verifiedTransfer`)**. The capture set grew from 336 to
  709 files in `tests/fixtures/vendor/harness`, 23 licence-held fixtures left the repo
  (`b39969b3ba`), the map now joins the evidence ledger, and `MATCH_SUBSTITUTED` is a new bucket.
  Today: production 179 MATCH / 53 DIVERGE / 477 INCONCLUSIVE; runtime-on 240 MATCH / 52 DIVERGE /
  414 INCONCLUSIVE / 3 MATCH_SUBSTITUTED; 51 scripts transfer AND have a MATCH capture (45 on
  11-05, over a different capture set). The ledger block reads `fresh 0, stale 440`: no ledger row
  was graded at engine 60, so ledger-only evidence credits nothing in this map.
- **`transferBound`** has no 11-05 value.
- **Wall attribution on the runtime lane** (`runtimeOn.walls`): the W6 T1 relabel and the W3W4-D2
  refusal naming landed after 11-05.
- Engine version: the 11-05 census ran at engine 18, this one at engine 60. The headline counts are
  comparable (same sample, same predicate); per-wall counts moved partly because refusals were
  renamed and split.

## 7. How it was measured

Worktree at `890b6d165c5ac48803689686fbddbeff6a3ee310` (`git rev-parse HEAD` identical before and
after every lane). One heavy-lock hold per lane, `VITEST_MAX_WORKERS=1`, node v24.13.1. `$O` is a
scratch directory outside the repo; `$O/prod` and `$O/rt` are fresh copies of the sample cache
(`sample_manifest.json`: 679 `ok` rows, every file present; 3 built-ins `closed_no_auth`, as before).

```sh
L="python C:/Users/Patrick/uct-clips/tools/heavy_lock.py --timeout 14400"
$L --label census-production run -- python tools/pine_coverage/run_census.py --cache $O/prod --ref $REF
$L --label census-runtime-on run -- python tools/pine_coverage/run_census.py --runtime-on --cache $O/rt --ref $REF
# from app/
VENDOR_HARNESS_RUNTIME_ON=0 VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$O/verdicts-prod \
  $L --label census-harness-production run -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=1
VENDOR_HARNESS_RUNTIME_ON=1 VENDOR_HARNESS_DIR=../tests/fixtures/vendor/harness VENDOR_HARNESS_OUT=$O/verdicts-rt \
  $L --label census-harness-runtime-on run -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/__tests__/vendorHarness/vendorHarness.corpus.test.js --maxWorkers=1
COVERAGE_DOOR_OUT=$O/engine_door.json $L --label census-engine-door run -- node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/ast/coverageMapDoorCensus.measure.test.js --maxWorkers=1
# the map
python tools/pine_coverage/coverage_map.py --cache $O/prod --ref $REF \
  --verdicts $O/verdicts-prod/verdicts.json --runtime-cache $O/rt --runtime-verdicts $O/verdicts-rt/verdicts.json \
  --engine-door $O/engine_door.json --out docs/pine/coverage-map.json --measured-on 2026-11-16 --master-sha 890b6d165c
```

Results of each run:

| run | result |
|---|---|
| census, production | 967 / 967 rows, 0 killed, 1 attempt; `LANE MEASURED: production (gate CLOSED, runtime lane reached 0, host refusals 1198)`; vitest 21 passed, 1 skipped; 18.4 min |
| census, runtime-on | 967 / 967 rows, 1 attempt; `LANE MEASURED: runtime-on (gate OPEN, runtime lane reached 1937, host refusals 1773)`; 16.1 min |
| harness, production | 1 file passed, 11 tests passed; 709 captures graded |
| harness, runtime-on | 1 file passed, 11 tests passed; 709 captures graded |
| engine door | 1 file passed, 21 passed, 1 skipped |

Not regenerated in this refresh: `coverage-targets-<date>.json` and `census/wall-detail-<date>.json`
(the 11-05 files stay as they are and describe the 11-05 map), and the section tables of
`COVERAGE-MAP.md` (inventory, features, greedy roadmap), which are still the 10-30 prose; the JSON
carries today's values for all of them.
