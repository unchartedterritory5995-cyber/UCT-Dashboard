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

**The predicate** (coordinator ruling, `runtime/__tests__/strategyArmed.js`, recorded per strategy by the census
door test as `strategyArmed`, read by `coverage_map.py` as `wouldTransferIfArmed` / `armedWall` and
`strategyOn.wouldTransferIfArmed` / `armedMeasured` / `armedWalls`): with the objects-only pane, the runtime pane and
the broker stubbed ON inside the measuring test, the member door attaches the script clean (the census's `isClean`,
or attached by the runtime lane, as the runtime-on lane judges), its document runs the broker (strategy window),
`computeRuntimeColumns` on the census reference bars (NYSE:RDDT 1D from the listing, 632 bars, the window
`bars_window.HISTORY_WINDOW_BARS`, the committed pin ledger) returns a strategy record, and its trades are drawn or
refused by name (`memberTradeMarkers`). A census row written before this column reads `null`, never `false`.

**Measured** in one local hold (strat-hold2) over the 70 strategies and 15 indicator controls, both lanes, on master
675b6fd4cf (the five engine files this unit changes written back from master, then restored and hash-checked) and
on the unit's tree 2987557454:

| | master | this unit |
|---|---:|---:|
| transfer fully (`transfers_fully`, both lanes) | 0 | 0 (unchanged by design) |
| armed: the door attaches clean | 20 | 39 |
| armed: the door's document runs the broker | 4 | 27 |
| **armed: would transfer** | **1** | **1** |

The one that would transfer on both trees is `committed:buy-monday-exit-tuesday` (its plots read the broker, so
the old route already reached it; its run on RDDT places no order and every rule it asks is pinned).

The armed walls, by the first thing that stops each script:

| wall | master | this unit |
|---|---:|---:|
| `door:pine:no-output` (tester-only) | 23 | 6 |
| `strategy:no-broker-run` (the door draws plots, no broker) | 16 | 12 |
| `run:runtime:strategy-unsettled:Q-S1a` | 0 | 18 |
| `run:runtime:strategy-unsettled:Q-S1b` (the v4 margin default, D12) | 2 | 7 |
| `door:pine:request` / `door:pine:module` | 7 / 6 | 7 / 6 |
| everything else (one or two each) | 15 | 13 |

So the route moved 21 strategies past the door to the broker run, where they now stop by name on the run's own
unsettled questions: Q-S1a (12 market entries sized by percent of equity on an exchange with no witnessed minimum
contract; 6 percent-sized STOP entries, a separate question, now queued with its own probe) and Q-S1b. The 12
`strategy:no-broker-run` are the broker-build refusals the route keeps as host documents: rule 11 repaint inputs
(`request.security`, `barstate.*`) and Pine v2 / v3 order signatures or unserved risk commands
(`runtime:strategy-option`).

**With the three `min_contract` rows** (section 5; re-measured in strat-hold3 on d2e50b9c44, the census's own
column on both lanes and the measurement test agree): still **1** would transfer. The 12 market-entry Q-S1a scripts
size now, and each stops at the next question its own run reaches, by name:

| wall after the rows | scripts | what settles it |
|---|---:|---|
| `Q-S1i`: the v6 default (100% of equity) sized on the signal close needs more funds than the strategy holds when the next open is higher (a margin call or a rejected order on TradingView, neither modelled) | 7 | the Q-S1i row (`w9-q-s1i-*` / `vw-s1-q-s1i-funds`), a capture with the report |
| `Q-S1a`: a percent-of-equity STOP entry (which price sizes it) | 6 | the new `w9-q-s1a-size-stop-v6` probe (this unit) |
| `Q-S1a`: a percent-of-equity entry while trades are open (whether "available equity" excludes them) | 4 | the Q-S1a row |
| `runtime:strategy-unpinned` B-EXIT-NA | 1 | Q-S1-core / the Q-S1k na-modify re-take |

Every census row of the 85 is unchanged by the rows with the flag off (rt lane: 0 differ; production lane: only the
luxalgo `pine:timeout` position again, which moves between any two runs).

**Flag off, nothing moved.** Every census row of the 85 scripts, on both lanes, is identical on the two trees once
`ms` and the `strategyArmed` counterfactual are set aside, with one exception that is not this unit's:
`reference:market-structure-with-inducements-sweeps-luxalgo` (an indicator control) carries a `pine:timeout`
refusal (the translator's TIME budget) whose second position differs between the two runs; the guard set, the
attach, the lane and `clean` are the same. A refusal raised by a wall-clock budget lands where the clock runs out.

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
`symbolScope.json::min_contract` rows; `symbolScopeMinContract.test.js` re-reads them (on master since #1465).

## 6. Rails and mutants

Rails: `builder/memberPane/w9ArmedRoute.test.js` (the front end and the door, flag off and on, through the real
door; the census predicate saying both), `runtime/__tests__/s1StrategyBroker.test.js` (the flag-off build is
master's; Q-S1g's shape), `ast/strategiesAreRuled.test.js` and `tests/test_broker_pins_resolve.py` (51 rules),
`tests/test_runtime_definitions.py` (the Python twin), `tests/test_pine_coverage_w9_t0_strategies.py` (the armed
column, an old row is unmeasured, the headline ignores it), `ast/symbolScopeMinContract.test.js`,
`runtime/__tests__/w9T4Sizing.test.js`, `runtime/__tests__/w9MinContractSource.test.js` (the rows).

Mutants (each: the file copied aside, mutated, the focused rail run, restored from the copy, `git hash-object`
equal to HEAD's blob; each target's rail first run GREEN unmutated as the control), all KILLED: M1 no
orders-skipped route; M2 a broker refusal replaces the plain build; M3 the no-output exemption dropped; M4 the
door takes any runtime document; M5 a broker-only document keeps its own pane; M6 a broker document with nothing
else is "nothing drawn"; M7 Q-S1g kept waiting; M8 Q-S1g asks no rule; M10 the armed predicate skips the broker
check; M11 an old census row reads as "no"; M12 the headline counts the armed column; M13 defSchema refuses a broker
document with no row; M14 the Python twin refuses it (strat-hold2, 2987557454). M9 as first written (the predicate's
`!rec` branch) SURVIVED: no document that holds the broker returns columns without a record, so the branch is
defensive and no rail can reach it; it was replaced by M9 "a run that stopped by name counts as served", KILLED
(strat-hold3, d2e50b9c44).

## 7. Next, in measured order (the armed column's walls with the rows)

1. Q-S1i, the v6 default (100% of equity) filled at a higher open: 7. The committed
   `w9-q-s1a-size-v6-rddt-1d-2026-11-15` capture (with the report) holds such fills; the strategy harness passes
   no `minContract` to the run (the product does, `runtimeColumns.js`), so it still grades that capture at Q-S1a.
   Passing it as the product does would let the committed report answer Q-S1i for this shape.
2. Q-S1b, the v4 margin default (D12): 7.
3. Rule 11 repaint inputs and v2 / v3 order signatures (`strategy:no-broker-run`): 12.
4. Q-S1a, a percent STOP entry: 6 (probe `w9-q-s1a-size-stop-v6`, queued); a percent entry while trades are open: 4.
5. The re-takes with the report: B-PYR, B-PYR-PRICE, B-STOP-LIMIT, B-EXIT-LEVELS (section 5); MK-LOOK (W9-MK1).
