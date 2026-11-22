# W9-T0 evidence: census honesty for strategies

Lane: `feat/pine-w9-t0-census`. Design: `docs/pine/W9-STRATEGY-DESIGN.md` (origin/docs/pine-w9-strategy-design
@59bf931484, GO-WITH-NOTES), task T0. Base: train landing commit 1b8b4616d8; merged
`origin/integ/pine-train-2026-11-05` @36ea8ec530 before final-tip.

Measured 2026-11-05 on tree `6a9198cac5` (code commit `0b8e9145bd`). No engine change; no
`SCRIPT_ENGINE_VERSION` edit; **no engine bump needed**. No licence-held text is committed: the tool writes
names, versions, sha256 prefixes and counts only (the sample cache is read locally from
`_resume-2026-11-01/pine-sample`, never copied).

## What changed

- `tools/pine_coverage/coverage_map.py`
  - `STRATEGY_ORDERS` is parsed from `pine.js` `STRATEGY_ORDER_CALLS` (13 names; the old copy named 5).
  - `usage_of()` returns `orders`, the order-set names a script calls, read from its comment- and
    string-stripped text (`order_calls_in`). `places_orders(u)` replaces the four
    `u["items"] & STRATEGY_ORDERS` uses (the inventory lookup).
  - Each map row carries `placesOrders`; the map carries a top-level `strategyOn` block (order set, strategy and
    order-placing counts, `byCall`, door-clean-but-placing and transferring-but-placing counts, wave W9).
- `tools/pine_coverage/w0/targets.py`: `placing_orders(row)` reads `placesOrders` (an old map falls back to the
  `[strategy]` label). `rt_wave` already mapped `runtime:strategy-*` and an order strategy's `runtime:no-output` to
  W9 (W4-T0); the new rail pins both.
- `tools/pine_coverage/w9_strategy_walls.py` (new): reproduces the design's section 1 per-wall counts.
- `tests/test_support_loop_tools.py`: the headline-predicate fixture now passes `orders` (shape change only).

Why 6 strategies came out as transfers on the peel branch: the 11-03 map's reference inventory
(`docs/pine/coverage-map.json`, `inventory.items`) has no `strategy.entry`, `strategy.exit`, `strategy.order`,
`strategy.position_size`, `strategy.position_avg_price` or `strategy.opentrades`. Detection went through the
inventory, so a strategy whose only order calls were `entry` / `exit` / `cancel` read as "no orders". The 6 rows
in that map with `declaration: strategy, clean: true` all call `strategy.entry` in their text. The rail
`test_an_order_strategy_never_transfers_whatever_the_inventory_says` rebuilds that situation (an inventory with no
strategy names) on three committed scripts.

## Reproduce

```
python tools/pine_coverage/w9_strategy_walls.py --cache <_resume-2026-11-01/pine-sample> \
    --map docs/pine/coverage-map.json --out <run dir>/walls.json
```
Without `--cache` only the 25 committed scripts are measured (the pinned CI rail).

## Per-wall counts over the 70 strategies (tool vs design section 1)

Population 70 = 25 committed + 23 builtin + 22 reference; versions v6 25, v5 16, v4 20, v2 6, v1 3; 70 of 70
place orders (all three populations): matches the design's 70.

| wall | tool | design | note |
|---|---:|---:|---|
| sizing: percent of equity (declared + v6 default) | 39 | 39 | match |
| sizing: v1-v4 default quantity | 19 | 19 | match |
| `currency =` | 8 | 8 | match |
| v5 defaults: capital 1,000,000, margin 0 | 5 | 5 | match (v5 with no `initial_capital`) |
| `strategy.risk.*` | 6 | 6 | match |
| v5 `when =` | 6 | 6 | match |
| `strategy.order` | 3 | 3 | match |
| OCA groups | 4 | 3 | tool counts any `oca_type` / `oca_name` argument; string contents are stripped so a name cannot be told from the default `""`. 1 script is the difference |
| trailing exits | 4 | 4 | match |
| commission (non-zero `commission_value`) | 17 | 17 | match after dropping the literal 0 (19 declare it, 2 as `0`) |
| partial exits (`qty`, or `qty_percent` other than 100) | 6 | 6 | match after dropping `qty_percent=100` (7 before) |
| slippage (non-zero) | 3 | 3 | match after dropping the literal 0 (5 declare it) |
| partial `strategy.close` | 2 | 2 | match |
| `calc_on_every_tick = true` | 2 | 2 | match |
| `process_orders_on_close = true` | 2 | 2 | match |
| `calc_on_order_fills = true` | 1 | 1 | match |
| `close_entries_rule`, `margin_*`, `backtest_fill_limits_assumption` | 1 | 1 each | the tool reports one row for the group (`close_entries_rule` declared; zero margins and fill assumption are defaults) |
| `close_all(immediately = true)` | 1 | 1 | match |
| pyramiding default (no `pyramiding =`) | 52 | 52 | match |
| values outside S1's set | not measured | 4 | needs S1's 23-value set; not in this tool |
| repaint-class inputs | not measured | 17 | the design took it from the review's source reading; not in this tool |

Census against source (scripts using the read-back):

| read-back | map today | source (tool) | design source |
|---|---:|---:|---:|
| `strategy.position_size` | 0 | 18 | 18 |
| `strategy.position_avg_price` | 0 | 16 | 16 |
| `strategy.opentrades` | 0 | 7 | 6 |

The committed 11-03 map's inventory has no row for these names at all (so its column is 0, not the design's 11 /
3 / 1, which came from another run); `opentrades` is 7, not 6, by one script. The gap to the source is what the
`placesOrders` detection removes for order calls.

Only-W9 (a strategy whose only map wall is `[strategy]`): tool 41 against the design's 40, from the committed
11-03 map. The design's 40 came from its own scan of the 11-02 map; the cause of the one-script difference was not
traced. Firm, greedy and the non-broker wall table are not reproduced by this tool (the
design says they come from the grading classification and the map).

Committed-corpus pin (CI rail): 25 strategies; sizing-percent 7, v1-v4 qty 9, currency 2, v5 defaults 3, risk 2,
v5 when 5, order 1, oca 1, trailing 1, commission 10, partial-exit 5, slippage 2, partial-close 2,
calc-on-every-tick 1, process-orders-on-close 2, close-entries-margin-fill 1, close-all-immediately 1,
pyramiding-default 18; read-backs 11 / 11 / 2.

## Rails (red on the old tooling, green on the tip)

`tests/test_pine_coverage_w9_t0_strategies.py` (23 tests). On the base the module has no `places_orders`,
`order_calls_in`, `engine_order_calls`, `strategy_on_block`, `placing_orders` or `w9_strategy_walls`, so the whole
file is red there. Set parity (`test_the_order_set_is_the_engines_not_a_copy`), detection independent of the
inventory, `runtime:strategy-*` to W9, the `strategyOn` counts, each wall detector, and the committed-corpus pin.

Targeted run on the tip: `python -m pytest tests/test_pine_coverage_w9_t0_strategies.py
tests/test_pine_coverage_w4_t0_honesty.py tests/test_support_loop_tools.py` -> 74 passed (before the last test
was added); the new file alone is 23 passed.

## Mutation table (`runs/w9t0/mut.py`, bytes restored exactly; log `runs/w9t0/mut.log`, `mut2.log`)

| mutation | killed by |
|---|---|
| no-op control | survives (as it must) |
| inventory-based detection returns (`places_orders` reads `items & old 5 names`) | `test_an_order_strategy_never_transfers_whatever_the_inventory_says` |
| drop `strategy.cancel` from the set | `test_the_order_set_is_the_engines_not_a_copy` |
| restate the 5-name set | `test_the_order_set_is_the_engines_not_a_copy` |
| order regex ignores spaced dots | `test_risk_calls_and_spaced_dots_count_and_comments_strings_do_not` |
| `rt_wave` drops `runtime:strategy` | `test_rt_wave_routes_strategy_guards_to_w9` |
| `rt_wave` drops order-strategy `no-output` | `test_rt_wave_routes_strategy_guards_to_w9` |
| `placing_orders` reads the label only | `test_the_target_lists_read_the_maps_own_placing_flag` |
| `strategyOn` counts every strategy as placing | `test_strategy_on_block_counts_from_the_rows` |
| `nonzero` always true | `test_a_v6_strategy_with_no_size_hits_the_percent_default_wall_and_pyramiding` |
| `qty_percent=100` counted as partial | `test_qty_percent_100_is_a_whole_exit` |
| `v5-when` for any version | `test_committed_corpus_wall_counts_are_pinned` |
| pyramiding default flipped | `test_a_v6_strategy_with_no_size_hits_the_percent_default_wall_and_pyramiding` |
| walls measured on raw text, not stripped code | first run SURVIVED (equivalent only by weak fixture); added `test_measure_reads_stripped_code_not_the_raw_file`, then KILLED (`mut2.log`) |

No equivalent survivors.

## Not run

`coverage_map.py main()` was not re-run end to end (it needs a full door census: heavy, W0's re-run). The edited
lines in `main()` (`placesOrders`, `_orders`, `orders_by_key`, `strategyOn`) are exercised by unit rails on their
helpers only. The next W0 census re-run should show `strategyOn.placingOrders` = 70 and 0 strategies with
`clean: true` that call an order.

Interaction with the train's reds (`coverageMapDoorCensus.measure`, `vendorHarness.coverageAudit`): no file of
theirs was edited; this change touches Python tooling only.

## final-tip

TIP `6f962f833e` (code `0b8e9145bd` + train merge `6a9198cac5` + evidence). Node 20.20.2 (a local `node@20.20.2`
npm copy first on PATH; the box default is 24), `FINAL_TIP_SCOPE=affected`, base `origin/integ/pine-train-2026-11-05`,
`app/node_modules` junctioned to `pine-base`. Logs: `_resume-2026-11-01/runs/w9t0/final/`, `final2.out`.
The change is Python tooling only, so `vitest --changed` selects nothing; the rails run is the vitest scope.

- gate pytest (4 files): rc 0, 46 passed.
- hygiene: rc 0.
- pytest of every test importing a changed module: rc 0, 255 passed
  (`test_pine_coverage_w9_t0_strategies`, `test_pine_coverage_w4_t0_honesty`, `test_pine_coverage_conditional_ta`,
  `test_language_coverage`, `test_support_loop_tools`, `test_pine_runtime_switch_on`).
- vitest rails (4 files), js rc 1, `3 failed | 207 passed | 9 skipped`:
  - `coverageMapDoorCensus.measure.test.js`: passed (the train's fix is in the merge).
  - `pollingSites.rail.test.js`: FAIL, the named baseline.
  - `settingsScope.rail.test.js`: FAIL, the named baseline.
  - `vendorHarness.coverageAudit.test.js`: FAIL (`delta-rsi-oscillator-strategy (runtime pane): RDDT MATCHES ...`),
    the train red the coordinator named. This change touches no JS and no vendor fixture, so it is not the cause.
- integrity: ok (HEAD and tree did not move). The full chart+hooks vitest was not run (scope as briefed).

### FULL final-tip (coordinator rerun), tip `92986fa77d`

Node 20.20.2 via `dsk/node20.sh`; scope full (chart + hooks vitest, 1 shard); logs `runs/w9t0/full/`, `full.out`.
rc gate=0 hyg=0 py=0 js=1; totals ok; integrity ok. vitest failing files:
`enumerationSites.test.js`, `vendorHarness.test.js` (master baselines at 646dca8cbf), `settingsScope.rail.test.js`,
`pollingSites.rail.test.js` (named baselines), `vendorHarness.coverageAudit.test.js` (train red; re-run alone
(`runs/w9t0/ca-alone.log`): the same one test, `delta-rsi-oscillator-strategy (runtime pane): RDDT MATCHES`, still
red, 1 failed | 184 passed). Coordinator ruling: this is the train-wide 1000 ms wall-clock instrument limit of
`delta-rsi` on this machine (master itself runs it at 761-942 ms), not caused by this lane; solo log
`runs/w9t0/ca-alone.log`. No failure involves a file this lane touched.

## Open items

- Wall "values outside S1's set" (design: 4) is not measured by the tool (needs S1's 23-value set).
- Wall "repaint-class inputs" (design: 17) is not measured by the tool.
- The measured differences above (OCA 4 vs 3, `opentrades` 7 vs 6, only-W9 41 vs 40) stand as reported.
