VERDICT: GO-WITH-NOTES @d0ba8961cc

Independent review of PR #935, "W9 open questions 9.4 and 9.7". Branch `fix/pine-w9-open-questions`, one commit `d0ba8961cc` on master `911eb4b215` (origin/master has not moved). Reviewer: Opus, working in detached worktrees at the tip and at master (both removed afterwards). No lane code was edited, nothing was pushed, and Railway and flags were not touched.

## 1. 9.4: the census drop. CONFIRMED.

I recomputed from the committed `docs/pine/coverage-map.json` at each commit:

| map | inventory.items | entry/exit/order in inventory | rows with `[strategy]` wall | strategies `clean` | `placesOrders` |
|---|---:|---|---:|---:|---:|
| 11-02 `a3929e688e` | 927 | yes (entry, exit, order, close) | 70 | 0 | n/a |
| 11-03 `127a0f1e3c` | 286 | no (only `strategy.close`) | 53 | 6 | n/a |
| 11-05 `1f17794a75` | 286 | no | 70 | 0 | 70 |

- 17 rows were lost and none gained. 6 of the 17 became `clean`, which matches the design's "6 transfers". On 11-05 all 17 are walled again, all have `placesOrders`, and none is clean. `strategyOn`: 70 / 70 placing orders, 0 transferring.
- `--ref`: the 11-02 run used `$SCR/ref/pine_v6_reference.json` (COVERAGE-MAP-2026-11-02.md:630-640). The 11-03 job used `$REF` (job-desktop.sh).
- The tool at `05623fd2f7` tested for orders with `u["items"] & STRATEGY_ORDERS` (coverage_map.py:358/373/711/729/987), which only sees what the inventory resolves.
- W9-T0 `0b8e9145bd` is an ancestor of master. Master reads `STRATEGY_ORDER_CALLS` from pine.js and uses `places_orders(u)`, and the rail `test_an_order_strategy_never_transfers_whatever_the_inventory_says` exists.
- The diagnosis and the "already fixed" claim both hold. The open item (read-back columns still come from the small `--ref`) is honestly left with W0.

## 2. 9.7: the dark order's arguments. REPRODUCED. The fix gives Pine's value.

Probe: 8 synthetic bars, broker dark, `buildRuntimeIr` -> `lowerIrProgram` -> `execute`, the same code on master and on the tip.

| script | master | tip |
|---|---|---|
| top-level `strategy.entry(..., qty = g())`, where `g` pushes, plotting `array.size(a)` | **0 on every bar (wrong value served)** | 1..8 |
| the same inside `if bar_index % 2 == 0` | **0s** | 1,1,2,2,3,3,4,4 |
| `strategy.exit(stop = g(), limit = g())` | **0s** | 2,4,6,... |
| an `else` arm holding `strategy.close(comment = str.tostring(g()))` | **0s** | 0,0,0,1,2,... |
| v4 `when = g()` | **0s** | 1..8 |
| `qty = array.pop(a)` on an empty array | **0s** | runtime error "array is empty" (Pine also halts) |
| `comment = str.tostring(a.push(close))` (method form) | **0s** | refused `runtime:statement` |
| `comment = str.tostring(label.new(...))` | served (the label is silently dropped) | refused `runtime:object-op` |
| `qty = ta.sma`, a pure user function, `request.security`, `array.get`, `a.get`, v4 `security(...)` | served | served, same values |

**Reference.** The Pine reference does not say in so many words that a function's arguments are evaluated at every call. It does name the exceptions to eager evaluation: v6 `and` / `or` ("returns true without evaluating `expr2`") and the ternary. Everything else, function arguments included, is eagerly evaluated. The `alert()` C23 rule in this same file already relies on that.

**Ruling: serve (the PR's choice) is right.** Two reasons:
- The eager-evaluation model is not in doubt, so the evaluated value is Pine's value.
- Every case where the arguments cannot be lowered faithfully already ends in a refusal by name: `runtime:statement`, `runtime:object-op`, `runtime:unbound` (a global modified in a function, which Pine itself rejects), or a Pine-faithful runtime error.

Refusing every effectful argument would also be honest. It would cost served-correct output for no gain in correctness.

## 3. Lanes and member-visible output

- **Lane:** the runtime lane only (`pineRuntimeFrontend.js`). pine.js (the host lane) and scriptEngineVersion are untouched.
- **Object door:** I called it, and its definition hash is identical on all 395 files below.
- **C18 set** (corpus/committed, pine_oos, pine_blind, pine_community, pine: 395 files, 400 synthetic bars). Per file I recorded the runtime build outcome, the IR hash, the output digest, and `memberPaneDefinition` ok/guard plus a definition hash. Result: **0 diffs, master against tip.**
- **25 committed strategies:** 4 runtime-served and 21 refused on both sides, with outputs identical. This matches the builder's figures.
- **hostParity (Node 24.13.1, `--host node --check`):** HP-1 GREEN, **166/166** equal to the committed digests. No digest change.
- **Member-visible:** nothing in any measured corpus changes. The output changes only for a script whose order call has an argument with an effect: a wrong 0 becomes the right value, or the run refuses by name.
- **N1 (over-refusal, not a blocker).** An order argument that calls a `strategy.*` read now refuses `pine:strategy-call` where master served correct output. Examples:
  - `strategy.exit(stop = strategy.opentrades.entry_price(0) * 0.9)`
  - `comment = str.tostring(strategy.closedtrades.profit(0))`
  
  Reads like these have no effect. They fall to the "unknown namespaced call = effect" default and get lowered. None appears in the 395 files, but `opentrades.entry_price` in an exit stop is a common idiom among the 70 strategies, which are not all local. Member pastes can contain it. Suggested follow-up: treat `strategy.*` read calls as values at the order site (they refuse by name anyway the moment anything reads them). Alternatively, record the over-refusal on the ledger. The `alert()` site has the same behaviour, so this is not a new class.

## 4. Tests run

- Targeted vitest, Node 20.20.2, `--maxWorkers=1`: 17 files and **558/558 passed**. The files: w9OrderOnlyIf, alertSets, vendorHarness.w9Strategy, chartOnly, silenceSpeaks, strategiesAreRuled, objectDoorGate, presentationOutputs, runtimeStrategy, runtimeWallsC23, s1StrategyBroker, strategyBrokerGate.product, w9T11Record, w9T14ServerRecord, w9T1Broker, hostParity.rail, hostParity.v8.rail.
- Service suite, Node 24.13.1, `node --test "services/pine_runtime/test/**/*.mjs"`: **139/139 pass**, 0 fail, 0 skipped.
- hostParity `--check`: 166/166 (see section 3).

## 5. My mutations

Each mutation was applied by exact string replacement and the original bytes were restored with `cmp`. Each was run against the builder rail (w9OrderOnlyIf, 5 tests) and against my probe.

| id | mutation | rail | my probe |
|---|---|---|---|
| control | none | 5 passed | baseline |
| A | the bare-is-value regex also admits dotted names, so a namespaced effect (`array.pop`, a method push, `label.new`) is dropped | **SURVIVES** | killed (wrong 0s return) |
| B | the left/right/test/... recursion stops passing `bareIsValue` | **SURVIVES** | survives (no observable change) |
| C | the args recursion stops passing `bareIsValue` | killed (1) | no change |
| D | only the first effectful argument is evaluated (`break`) | **SURVIVES** | killed (exit_effect gives 1,2,3 where Pine gives 2,4,6) |
| E | user functions count as values at the order site | killed (1) | killed |

- **N2 (rail gaps, before landing preferred).** Add three cases to `w9OrderOnlyIf.test.js`:
  - (a) a namespaced effect in an argument, e.g. `qty = array.pop(a)`, or `a.push` in method form. This kills A.
  - (b) an order with two effectful arguments, e.g. `strategy.exit(stop = g(), limit = g())` giving 2,4,6,... This kills D.
  - (c) a v4 `when = crossover(close, sma(close, 3)) and close > 0`, so the bare call sits under a binary operator. This should kill B: under B that shape lowers inside the arm and refuses `runtime:conditional-history`, which re-breaks the very `highlow-channel-swing` shape this fix protects.
  
  The builder's three mutations are reproduced in spirit: C is killed, and the strict-default case (C plus the regex) is covered.

## 6. merge-tree

`git merge-tree --write-tree origin/master origin/fix/pine-w9-open-questions` gives tree `2735352a28`, rc 0, **clean**. The base equals origin/master.

## 7. Engine bump and measure-pair

- **Engine bump: NO.**
  - `SCRIPT_ENGINE_VERSION` gates translator/door output and the saved-script verdicts. The door definition is byte-identical on all 395 files, and pine.js is untouched.
  - The runtime service's cache keys on its engine identity, which includes `bundle_sha256`. The new bundle invalidates server-side results by itself.
  - No hostParity digest moved, so `--write` has nothing to justify.
  - If the coordinator holds that a runtime-lane semantic change needs a recorded identity, the knob is `RUNTIME_FRONTEND_VERSION` (=1), not the script engine. I do not require it.
- **Measure-pair: NOT required.** My 395-file pair shows 0 diffs on runtime IR, outputs and the door definition, and HP-1 is 166/166. The change is confined to the dark order-call branch, which no indicator reaches. Re-run final-tip on the landing tree as usual.

## Notes summary

- **N1:** `strategy.*` read calls in an order argument now over-refuse. Follow up or record it on the ledger. Not a wrong value.
- **N2:** add rail cases (a), (b) and (c) to kill mutations A, D and B.
- No blocker.

Cleanup: probe files deleted. Junctions unlinked with `cmd /c rmdir` and `pine-base/app/node_modules` verified intact. Both worktrees removed. The first `git worktree remove` failed with "Invalid argument" while the junction was still present; I then removed the junction, deleted the leftover checkout directory and ran `git worktree prune`. No other worktree was touched. One stray script I wrote into `pine-handoff-dsk-ops/docs/pine/parity-programme/scripts/` (cm2.py, written because the env script overwrote `$S`) was moved out at once. That tree's `git status` was clean afterwards.

SHA reviewed: d0ba8961cc
