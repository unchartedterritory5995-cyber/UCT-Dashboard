# W9 open questions 9.4 and 9.7: evidence

Lane: `fix/pine-w9-open-questions`, base `origin/master` `911eb4b215`. Design: `docs/pine/W9-STRATEGY-DESIGN.md`
section 9 (on `origin/docs/pine-w9-strategy-design`). Measured 2026-11-07, Node 20.20.2, `app/node_modules`
junctioned to `pine-base`. No `SCRIPT_ENGINE_VERSION` edit, no flag, no heavy lock, no census run.

## 9.4 Why the 11-03 census lost 17 strategies from `[strategy]`

**Answer: the 11-03 run used a smaller reference inventory, and the old tooling found order calls
through that inventory. The 17 were wrongly dropped. W9-T0 (`0b8e9145bd`) already fixed the
classification, with a rail, and the 11-05 census on master shows all 70 back. No change made here.**

How it was found (all from git objects; no census run):

| map (commit) | `inventory.items` | `strategy.entry` / `exit` / `order` in it | rows with `[strategy]` wall |
|---|---:|---|---:|
| 11-02, `a3929e688e` | 927 | yes | 70 |
| 11-03, `127a0f1e3c` (W4-T0 peel) | 286 | **no** | 53 |
| 11-05, `1f17794a75` (W3W4-T0 re-run, after W9-T0) | 286 | no | 70 |

- The 11-02 run passed `--ref $SCR/ref/pine_v6_reference.json` (`COVERAGE-MAP-2026-11-02.md:671-697`).
  The 11-03 run passed `--ref $UCT_RESUME/runs/C/ref_rebuilt.json`
  (`docs/pine/evidence/2026-11-03-w0-peel/job-desktop.sh:7`). Read locally, `ref_rebuilt.json` holds
  `strategy.close` and `strategy.cancel` but not `strategy.entry`, `strategy.exit`, `strategy.order` or
  `strategy.position_size`. Its inventory counts are functions 234, methods 0, operators 2 (against 719, 251,
  23 on 11-02).
- The tooling at `05623fd2f7` decided "places orders" as `u["items"] & STRATEGY_ORDERS`, where `u["items"]` is
  only the names the inventory resolves (`coverage_map.py:358/373/711/729/987` at that commit). A strategy
  whose only order calls were `entry` / `exit` / `order` therefore read as placing none, and lost the wall.
- The 17 lost rows are exactly 70 minus 53, none gained. 6 of them became `clean: true` (the 6 transfers of
  the design's finding 4); the other 11 kept another wall and stayed blocked.
- On the 11-05 map all 17 have `placesOrders: true` and the `[strategy]` wall, and none is `clean`.
  `strategyOn` reads `strategies 70, placingOrders 70, transferringPlacingOrders 0`. That run kept
  `ref_rebuilt.json`, so the fix holds with the small inventory, which is what T0's detection from source is for.
- Rail already on master: `tests/test_pine_coverage_w9_t0_strategies.py::test_an_order_strategy_never_transfers_whatever_the_inventory_says`
  (mutation "inventory-based detection returns" killed, `2026-11-05-w9-t0/EVIDENCE.md`).

Left open, not this lane's: the read-back columns (`strategy.position_size` and the rest) still come from
the inventory, so the map shows 0 for them against 18 / 16 / 7 in source, as T0's evidence records. The cause
is the same smaller `--ref`. Whether the census should go back to the full reference is W0's call.

## 9.7 How the statement walker handles an order-only `if` (F10)

**Answer: it does not skip the `if`, and it does not refuse it. The `if` is lowered: its test is lowered
and runs every bar (a `strategy.*` value in the test refuses `pine:strategy-call` by name). With the broker
dark, each order call inside is dropped, so the arm is empty. That part is correct: the dropped order changes
nothing that is served. What was silently wrong was one level down: the order call's ARGUMENTS were dropped
too, and Pine evaluates them. Fixed here.**

Code path (master): `pineRuntimeFrontend.js` statement `if` at the `word === 'if'` branch lowers every arm's
test with `lowerExpr` then the body with `lowerStmts`; inside, the `STRATEGY_ORDER_CALLS` branch notes
`runtime:strategy-order` and, with `brokerMode` off, `continue`s without lowering anything. The wave-18
`orderOnlyChain` bypass (F10 on the S1 branch) is not on master, as T1's evidence also says.

Probe (12 synthetic bars, broker dark, `buildRuntimeIr` -> `lowerIrProgram` -> `execute`):

| script | before | after |
|---|---|---|
| `if close > 105` -> `strategy.entry` only | served, plot = close | same |
| if / else if / else, all arms orders | served | same |
| `if f()` where `f` pushes to an array, plot `array.size(a)` | 1..12 (test runs) | same |
| `strategy.entry(..., qty = g())` in an `if`, `g` pushes, plot `array.size(a)` | **0 on every bar** | 1..12 |
| same at top level | **0 on every bar** | 1..12 |
| `if strategy.position_size == 0` | refused `pine:strategy-call` | same |

TradingView evaluates `g()` each time the call runs, so the old answer was a served wrong value.

### Fix

`pineRuntimeFrontend.js`, the dark branch of the order call: each argument for which `argumentHasEffect` is
true is lowered where the order stands, into a slot nothing reads. This is the rule `alert()` already
follows in the same file, with the same predicate. Inside an `if` arm it runs only on the bars the arm runs.
Pure arguments are still dropped, so the program is unchanged for them.

One adjustment: `argumentHasEffect` treats an unknown bare call as an effect (right for `alert`). At the
order site that made `when = crossover(...)` (v4) lower inside the arm, and `highlow-channel-swing` (served
today) began to refuse `runtime:conditional-history` for a value nothing reads. The predicate takes an option,
`bareIsValue`, used only at the order site. Pine's bare builtins that change state are output calls,
which never sit in an argument. Collection, drawing and method calls stay effects. `alert` keeps the default.

Nothing about strategies is served: the broker stays dark, values still refuse, no gate or flag is touched.

### Corpus check (the 25 committed strategies, broker dark, 400 synthetic bars)

Before and after: 21 refused, 4 served. Every guard and every output digest is identical
(`flawless-victory-strategy`, `highlow-channel-swing`, `supertrend-strategy`,
`tradingview-alerts-to-mt4-mt5-forex-...`). No committed strategy has an argument with an effect. A
static scan of all 70 strategies found 7 that call a user function or a bare builtin in an order argument,
the 6 committed ones are among the 25 above, all unchanged; the seventh (a reference script) was not run.

### Rail and mutations

`app/src/components/chart/engine/runtime/__tests__/w9OrderOnlyIf.test.js`, 5 tests: the `if` test runs every
bar; a value in the test refuses by name; an effectful argument runs only on the arm's bars (`bar_index % 2 == 0`
gives 1,1,2,2,...); a pure argument leaves the IR byte-identical to the order with no arguments; a v4 bare
`crossover` in `when =` stays served.

| mutation (bytes restored exactly, `os.replace`) | result |
|---|---|
| control | survives, 5 passed |
| drop the argument evaluation | KILLED (1 failed) |
| order site uses the strict default (bare = effect) | KILLED (1 failed) |
| evaluate every argument | KILLED (4 failed) |

Review N2 on #935 (`dsk/reviews/W9-OQ.md`): three rail cases added (a method-free namespaced effect
`str.tostring(array.push(a, close))`, two effectful arguments on one `strategy.exit`, a v4 bare
`crossover` under `and`). The rail is now 8 tests. Re-run of the reviewer's surviving mutations:

| mutation | result |
|---|---|
| control | survives, 8 passed |
| A: bare-is-value regex admits dotted names | KILLED (1 failed) |
| B: operator recursion drops `bareIsValue` | KILLED (1 failed) |
| D: only the first effectful argument is evaluated | KILLED (1 failed) |

### Tests run

- `w9OrderOnlyIf.test.js`: 5 passed.
- Every engine test file naming `alert(`, `strategy.entry` or `STRATEGY_ORDER_CALLS` (15 files, including
  `runtimeStrategy`, `w9T1Broker`, `s1StrategyBroker`, `strategyBrokerGate.product`, `strategiesAreRuled`,
  `w9T11Record`, `w9T14ServerRecord`, `alertSets`, `chartOnly`, `objectDoorGate`, `runtimeWallsC23`): 570 passed.
- `hostParity.rail.test.js` and `hostParity.v8.rail.test.js`: 36 passed (committed digests unchanged).
- Not run: the full vitest suite and `vendorHarness*` (the brief's scope: targeted, `--maxWorkers=1`).
