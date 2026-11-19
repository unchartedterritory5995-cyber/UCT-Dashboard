# The served set, by what the member's chart draws (census tools, 2026-11-19)

Engine 85, production's 8-version library store (the census's `libraryStore`), the committed map's census
(`measuredOn` 2026-11-19, `masterSha` 3685713d65). Keys and counts only: script keys, capture ids, families, guard
names. No source, no text.

## Headline

**memberServed 294 = servedFully 262 + servedWithDisclosedGap 12 + servedUnmeasured 12 + servedDiverging 8.**

| class | rule (`parity_roadmap.render_split`, a partition, first match wins) |
|---|---|
| servedDiverging | a capture of it grades DIVERGE on the sweep's lane (coordinator ruling 2026-11-19: never "fully") |
| servedUnmeasured | no capture of it was measured (none on disk, or our side refused every one) |
| servedWithDisclosedGap | a measured capture leaves drawings off: placed nowhere, or withheld by name |
| servedFully | measured, and no measured capture leaves a drawing off or grades DIVERGE |

## The walls (`renderWalls`, unit `render`, ranked like `memberWalls`)

| wall | scripts (all sole) |
|---|---|
| `render:coordinate-unplaced` | 5: committed:position-size-calculator, committed:price-action-as-in-book-fibonacci-supportresistant-trendline, committed:reverse-stochastic-momentum-index-on-chart, reference:edufx-amd, reference:fikira-pivots-fibonacci-retracement-3 |
| `render:drawings-withheld:objects:not-computable` | 3: committed:k-clustering, committed:poor-man039s-volume-profile, committed:smt-divergence-ict-01-tradingfinder-smart-money-technique |
| `render:drawings-withheld:runtime:history-start` | 2: reference:non-repainting-swing-highlow-signals, reference:uptrick-volatility-adjusted-trail |
| `render:drawings-withheld:objects:count-at-cap` | 1: committed:fvg-detector-tradingfinder-fair-value-gap-imbalance-mitigated |
| `render:drawings-withheld:runtime:objects-without-run` | 1: committed:trend-targets-algoalpha |

No served script has a withheld text (`render:text-withheld:*`): the one withheld-text capture on disk is the probe
`vw-fmt-tie-readings` (4 labels, kind `unnamed`), which is not a sample script.

**The coordinate class, its verified cause.** position-size-calculator's label sits at +90.0 days and
reverse-stochastic's at +15.3 days (also off the session grid): both are `xloc.bar_time` labels to the RIGHT of the
last bar, a finite time no bar of the chart places. The sweep measures each as 1 `label` per capture, class
`coordinate`, on both RDDT 1D and SPY 1D.

**The drawings-withheld class** is the coordinator's ruling: a served script whose drawing families are withheld
whole by name on its captures is not fully served (counting it fully would be false).

## servedDiverging: the 8, by capture (runtime-on lane, engine 85)

| script | DIVERGE captures | others |
|---|---|---|
| committed:sonarlab-order-blocks (host-clean) | aapl-1d-2026-10-02 (also DIVERGE on the production lane; its drawings are withheld `objects:off-listing` there) | brk-a, rddt, spy MATCH |
| reference:auto-length-moving-average-trend-signals-zeiierman | rddt-1d-2026-11-14 | |
| reference:average-true-range-trailing-stops-strategy-by-sylvain-vervoort | rddt-1d-2026-11-14 | |
| reference:check-head-and-shouldersmask-man | spy-1d-2026-11-17 | 3 INCONCLUSIVE |
| reference:market-structure-with-inducements-sweeps-luxalgo | rddt-1d-2026-11-14 | |
| reference:multi-timeframe-vwap-v5 | rddt-1d-2026-11-16, rddt-1d-2026-11-17, spy-1d-2026-11-16 | spy 11-17 INCONCLUSIVE |
| reference:sessions-nephew-sam | rddt-1d-2026-11-14 | |
| reference:tradingviews-technical-analysis | rddt-1d-2026-11-17, spy-1d-2026-11-17 | |

The seven reference scripts' captures are licence-held (the local store), so the committed kill list cannot see
them. Before any kill they are re-graded with the fixed object-pairing grader (objects agent); only genuine
DIVERGEs are killed, by source hash. The map's `vendorVerdict` reads sonarlab MATCH because any MATCH wins: the
aggregation fix is the next unit.

## servedUnmeasured: the 12

committed: linear-regression-channel, macd-with-filter-visual-backtest-module-sample, order-block-finder,
order-blocks, range-filter-bs-signals, range-filter-dw, williams-fractal-trailing-stops; reference:
auto-fibonacci-and-gann-fanretracements-combo, heatmap-volume-xdecow, nadaraya-watson-combine,
stoch-money-flow-admf-absolute-strength-index-asi-ci8dh, volume-supertrend-ai-zeiierman.

## The sweep

| run | result |
|---|---|
| committed captures (`tests/fixtures/vendor/harness`) | 921 captures: measured 580, refused 322, objects-failed 19; 10.9 min |
| local store (`%LOCALAPPDATA%/uct-vendor-batch/runs/*/captures`) | 1480 captures: measured 852, refused 610, objects-failed 18; 38.2 min (lock wait included) |
| join (`render_gaps.py`) | 1653 captures after 748 duplicates (by id); 985 joined to 578 sample scripts; 668 unmatched (probes, other texts); verdicts DIVERGE 63, INCONCLUSIVE 527, MATCH 395 |

Self-checks:
- Each capture's render state, rebuilt by the sweep, equals the harness's own (`dropped`, capture for capture: 0
  differ).
- The sweep's verdicts equal the census harness's runtime-on verdicts (`verdicts-rt`) for 910 of 910 common captures.
- The map regenerated without `--render-gaps` is byte for byte the committed map. With it, the only change is the
  new `renderGaps` section.

Commands (from `app/`; `$S` = production's store, `$O` = the census run):

```sh
PINE_RENDER_GAPS=1 PINE_RENDER_GAPS_OUT=$RG/rows-committed.json PINE_RENDER_GAPS_DIR=../tests/fixtures/vendor/harness \
  PINE_LIBRARY_STORE=$S node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/__tests__/vendorHarness/renderGaps.measure.test.js --maxWorkers=1
PINE_RENDER_GAPS=1 PINE_RENDER_GAPS_OUT=$RG/rows-local.json PINE_RENDER_GAPS_DIR="<every runs/*/captures, ;-separated>" \
  PINE_LIBRARY_STORE=$S node node_modules/vitest/vitest.mjs run \
  src/components/chart/engine/__tests__/vendorHarness/renderGaps.measure.test.js --maxWorkers=1
python tools/pine_coverage/render_gaps.py --rows $RG/rows-committed.json --rows $RG/rows-local.json --cache $O/prod --out $RG/render-gaps.json
python tools/pine_coverage/coverage_map.py <section 9.0's arguments> --render-gaps $RG/render-gaps.json
python tools/pine_coverage/parity_roadmap.py build --facts docs/pine/parity-roadmap.json
python tools/pine_coverage/parity_roadmap.py check
```
