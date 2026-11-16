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

What changes for an ARMED member (nothing changes while the flag is off; rail: `w9ArmedRoute.test.js`, flag off
and on, through the real door):

| strategy | flag off (today) | flag on, before this unit | flag on, now |
|---|---|---|---|
| plots read a `strategy.*` value | refused `pine:strategy-call` | broker document (strategy window) | unchanged |
| plots read no `strategy.*` value | host document, plots drawn, orders skipped, disclosed | the same host document: no trades | broker document: the same plots, its trades in the record, markers refused by name (W9-MK1), the report |
| tester-only (orders, no plot) | refused `pine:no-output` | refused `pine:no-output` | broker document on the price pane, a hidden anchor row only; its output is its trades |
| the broker build refuses (a v2 order signature, an unserved risk command, a repaint-class input) | as the rows above | as the rows above | the host document it had (plots, orders skipped), with the broker's refusal named beside the build (`brokerDeclined`) |

How:

- `pineRuntimeFrontend.js::buildRuntimeIr`: with the broker on, a build that stands with an order call SKIPPED
  (`runtime:strategy-order` noted), or that refused `runtime:no-output` with one skipped, is built again in broker
  mode. Rule 11 (repaint-class inputs) is asked first, as for the value-read retry. A broker build that refuses
  keeps the build that stood, never a refusal in its place. The C18 object door never reaches broker mode (W9
  rule 4, railed again for the new route). In broker mode a strategy whose orders are its only output is a
  program (`runtime:no-output` is not raised when the broker lowered an order).
- `memberPaneDefinition.js`: with both gates on (runtime pane, broker), a host-drawable `strategy()` is offered to
  the runtime lane, and its document replaces the host's only when it holds the broker (strategy window). Every
  decline (the kill list, the starter allowlist, a broker refusal, a pairing, a strategy that places no order)
  keeps the host document. A broker document with no row of its own sits on the price pane.
- `defSchema.js` and its Python twin `runtime_definitions.py`: a runtime document stamped with the strategy window
  may map no plot; any other runtime document with an empty output map is still refused (rails on both sides).
- Known cost, armed only: a host document's run half (`hostPartialRunHalf`) declines `run-half:strategy` when the
  probe holds the broker, so a strategy whose broker document declines (for example on the starter allowlist) and
  whose host drawings lost objects keeps its host plots without the run half it could mint while armed before.

## 4. Q-S1g from a value witness: `B-PYR-PRICE`

`vw-s1-q-s1g-blocked-stop-entry` (NYSE:RDDT 1D, 2026-11-16, run cb1; report not requested): pyramiding 1, a long
from bar 50, `strategy.entry("L2", strategy.long, stop = close * 1.01)` placed on bar 52, the long closed on bar 70.
L2's stop (60.6707) is reached on bars 53-70 while the position is at the limit, and again on every bar from 71
after it closes. TradingView's `strategy.position_size` is 1 on bars 51-70 and 0 from bar 71 to the last bar;
`strategy.opentrades` never exceeds 1. So a price entry reached at the pyramiding limit is not kept waiting.

The broker refused this case by name (`runtime:strategy-unsettled`, Q-S1g). It now serves it under a rule of its
own, `B-PYR-PRICE` (`brokerRules.js`, appended so S1's 22 stay the first 22): the entry is rejected (`pyramiding`)
and dropped. The rule is UNPINNED: the value witness carries no fills, and the ledger's own tooling pins only a
MATCH that graded fills and values (`evidence_engine.resolve_pins`). Until the re-take with the Strategy Tester
report grades MATCH, a run that reaches the case stops there by name, now under the rule that will pin it.
Rails: `s1StrategyBroker.test.js` (the witness's shape on synthetic bars; the unpinned stop names the rule).

## 5. Today's captures (run cb1-2026-11-16, outside git; read, never committed here)

**No pin today.** The 12 strategy captures (the ten `vw-s1-q-*` rows, `w9-d11-late-first-use`,
`w9-d1-margin50`) carry `provenance.report.status: "not-requested"` and were taken during RTH
(`newestBarIsForming: true`). Through the ledger's own tooling none can pin: the grade stops at step 0
(`strategy_reference.mjs::referenceOfCapture`, "the report is not-requested"), and `evidence_engine.resolve_pins`
pins only a MATCH that graded fills and values. The capture session files them as value witnesses and re-takes
all 12 after the close with the Strategy Tester report (coordinator, 2026-11-16).

Our broker against their VALUES (a scratch comparison, every rule allowed, the forming bar dropped; never
committed), every plotted series bar by bar:

| capture | our run | value series compared | rules our run exercised (unpinned in bold) |
|---|---|---|---|
| vw-s1-q-s1g-blocked-stop-entry | ran | 3 series x 666 bars, all equal | B-CLOSE, B-DEFAULTS, B-DIR, B-FIFO, B-FILL, B-MARGIN, B-MARKET, B-PATH, **B-PYR**, **B-PYR-PRICE**, B-QTY, B-SIG, B-VAL |
| vw-s1-q-s1j-stop-limit | ran | 2 x 666, all equal | B-DEFAULTS, B-DIR, B-FILL, B-MARGIN, B-PATH, B-QTY, B-SIG, **B-STOP-LIMIT**, B-VAL |
| vw-s1-q-s1k-profit-and-limit | ran | 2 x 666, all equal | B-DEFAULTS, B-DIR, B-EXIT-BIND, **B-EXIT-LEVELS**, B-EXIT-LIFE, B-FIFO, B-FILL, B-MARGIN, B-MARKET, B-PATH, B-QTY, B-SIG, B-VAL |
| w9-d11-late-first-use | ran, 32 trades | 38 x 666, all equal | B-CLOSE, B-DEFAULTS, B-DIR, B-FIFO, B-FILL, B-MARGIN, B-MARKET, **B-PYR**, B-QTY, B-ROUND, B-SIG, B-TXT-CLOSE-ID, B-TXT-NO-COMMENT, B-VAL |
| vw-s1-q-s1d-close-reverse, -two-entries, -two-stops | refused `runtime:strategy-unsettled` Q-S1d | - | - |
| vw-s1-q-s1e-stop-past | refused Q-S1e (an exit active past its level) | - | - |
| vw-s1-q-s1h-fifo-exit | refused Q-S1h (an exit that targets a trade that is not the oldest) | - | - |
| vw-s1-q-s1k-fractional-profit | refused Q-S1k (150.5 ticks) | - | - |
| vw-s1-q-s1k-na-modify | refused at build, `runtime:call-undeclared-builtin-state` (`math.round_to_mintick` fed a mutable value) | - | - |
| w9-d1-margin50 | refused at build, `runtime:strategy-value` (`strategy.margin_liquidation_price`) | - | - |

So the re-takes, if TradingView's fills agree with the values, pin B-PYR (w9-d11, and the D11 shape it was
written for), B-PYR-PRICE (Q-S1g), B-STOP-LIMIT (Q-S1j) and B-EXIT-LEVELS (Q-S1k). What the values do NOT
settle, and why: Q-S1d (both fill orders give the same position and open-trade count), Q-S1h (the open trade
left after the FIFO split is not visible in the position), Q-S1e and the fractional profit (the fill price is not
plotted). Those wait for the report.

The three `syminfo.mincontract` captures (NYSE:RDDT, AMEX:SPY, NASDAQ:AAPL: `M01_mincontract` 1 on every bar,
control `M03_len_ticker_CONTROL` the ticker's length, the committed probe's sha256) become the three
`symbolScope.json::min_contract` rows; `symbolScopeMinContract.test.js` re-reads them once the capture session's
data PR has put them on master.
