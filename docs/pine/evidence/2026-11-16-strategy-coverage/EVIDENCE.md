# Strategy coverage: the armed column, the armed route, Q-S1g (evidence, 2026-11-16)

Branch `feat/pine-coverage-strategies`, cut from `origin/master` `e9807547d0` (`SCRIPT_ENGINE_VERSION` 61).
The strategy broker stays DARK (`VITE_PINE_STRATEGY_BROKER_ENABLED` off). Arming it is the owner's act (W9
ruling D6) and is not among today's approvals. Nothing here changes what a member is served while the flag is off.

## 1. What `strategy:orders` is

The census wall `strategy:orders` (70 of the 679 sample scripts, the only wall of 36) is not a refusal the
member door raises. It is two things, one on top of the other:

- **(a) a census rule.** `tools/pine_coverage/coverage_map.py::transfers_fully` (lines 259-264) counts a script
  only when it is NOT a strategy that places orders; `:909-910` adds the `[strategy]` bucket wall to every such
  script and `runtimeClean` (`:932`) excludes them too. Whatever the door answers, an order-placing strategy
  never transfers.
- **(b) the broker is dark.** `engine/strategyBrokerGate.js:14-20` (`=== '1'`), registered by the member door
  (`memberPaneDefinition.js:35`). The census never stubs that flag (`coverageMapDoorCensus.measure.test.js`
  stubs the objects-only and runtime flags only). With it off, an order call is skipped (C50) and nothing
  simulates the trades.
- **(c)** `runtime:strategy-unpinned` exists only once (b) is armed: it is a run-time stop, never a door answer.

Two more walls sat behind the flag, both design (coordinator rulings, 2026-11-16):

1. With the flag ON, the door handed a script to the broker ONLY when its outputs read a `strategy.*` value
   (`pineRuntimeFrontend.js::buildRuntimeIr`, the retry on `pine:strategy-call`). The 16 strategies the door
   draws clean (plots only, orders skipped) would get no trades armed, and the 20 tester-only ones (no plot)
   refuse `pine:no-output` armed too. **Ruled: route every order-placing strategy to the broker when armed.**
2. Trade markers: MK-LOOK (W9-MK1) is unpinned, so an armed strategy's markers refuse by name. That is a
   disclosure, and counts as "drawn or disclosed" in the armed predicate.

`pine:strategy-call` (15 scripts): every token is a broker VALUE read (`strategy.position_size` x22,
`strategy.opentrades` x4, `strategy.position_avg_price` x3, `strategy.opentrades.entry_price` / `.size`,
`strategy.netprofit`). All are in `runtime/broker.js::BROKER_OPS` and served in broker mode. No `strategy.*`
call is unmapped: these 15 are the dark broker's refusal.

## 2. The armed column (a SEPARATE column; `transfers_fully` unchanged)

TBD

## 3. The armed route (behind the dark flag)

TBD

## 4. Q-S1g from a value witness: `B-PYR-PRICE`

TBD

## 5. Today's captures

TBD
