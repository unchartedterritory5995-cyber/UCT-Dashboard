// app/src/components/chart/engine/runtime/brokerRules.js
//
// ─── W9-T1: THE BROKER'S RULE IDS, AND THE CAPTURE ROW THAT PINS EACH ───────────
//
// ONE TABLE. Every emulator rule `runtime/broker.js` can exercise is named here, with the
// capture row (W9 design 5.2) whose MATCHing verdict pins it. `broker.js` asks
// `pinned(ruleId)` (`brokerPins.js`, the committed ledger) at the moment a run REACHES the
// rule; an unpinned rule stops the run there with `runtime:strategy-unpinned`, naming the rule
// and its capture row. The ledger (`brokerPins.resolved.json`) lists only rules whose fixtures
// all MATCH, so this table is the vocabulary and the ledger is the truth.
//
// ⛔ A RULE ID THAT IS NOT IN THIS TABLE CANNOT BE EXERCISED (`ruleCapture` throws), so a new
// emulator branch cannot serve without first being named here and, through the ledger, pinned.
// ⛔ THE LEDGER NEVER LISTS A RULE THIS TABLE DOES NOT NAME (rail: `s1StrategyBroker.test.js`).
// ⛔ A rule with `capture: null` has no probe queued yet: it is refused until one is written.

export const UNPINNED_GUARD = 'runtime:strategy-unpinned'

export const BROKER_RULES = Object.freeze({
  // the run's execution model
  'B-EXEC': Object.freeze({ capture: 'Q-S1p', what: 'a strategy executes once per closed bar; the forming bar is not executed' }),
  'B-FILL': Object.freeze({ capture: 'Q-S1-core', what: 'orders placed on bar t fill from the next bar, before the script runs on it' }),
  'B-MARKET': Object.freeze({ capture: 'Q-S1-core', what: 'a market order fills at the next bar open' }),
  'B-PATH': Object.freeze({ capture: 'Q-S1-core', what: 'the intrabar path open -> near extreme -> far extreme -> close' }),
  'B-GAP': Object.freeze({ capture: 'Q-S1-core', what: 'a level crossed between bars fills at the next open' }),
  'B-IMMEDIATE': Object.freeze({ capture: 'Q-S1e', what: 'a price order placed beyond the market fills on the next tick' }),
  'B-PYR': Object.freeze({ capture: 'Q-S1-core', what: 'pyramiding limits same-direction entries' }),
  'B-REVERSE': Object.freeze({ capture: 'Q-S1-core', what: 'an entry against the position closes it and opens the new size on one fill' }),
  'B-MODIFY': Object.freeze({ capture: 'Q-S1-core', what: 'an unfilled order with the same id is modified' }),
  'B-CANCEL': Object.freeze({ capture: null, what: 'strategy.cancel / cancel_all remove unfilled orders (no probe queued)' }),
  'B-CLOSE': Object.freeze({ capture: 'Q-S1-core', what: 'strategy.close / close_all' }),
  'B-EXIT-BIND': Object.freeze({ capture: 'Q-S1-core', what: 'strategy.exit binds a bracket to the trades of from_entry' }),
  'B-EXIT-LIFE': Object.freeze({ capture: 'Q-S1-core', what: 'how long an exit lives' }),
  'B-EXIT-NA': Object.freeze({ capture: 'Q-S1-core', what: 'an exit with every level na places nothing' }),
  'B-FIFO': Object.freeze({ capture: 'Q-S1-core', what: 'exits close the oldest trades first' }),
  'B-MARGIN': Object.freeze({ capture: 'Q-S1i', what: 'the margin check (a margin call is never modelled)' }),
  // the order arguments and the declaration
  'B-SIG': Object.freeze({ capture: 'Q-S1-core', what: 'positional order arguments follow the Pine version\'s signature' }),
  'B-WHEN': Object.freeze({ capture: 'Q-S1p', what: 'the `when` argument (v4, and v5)' }),
  'B-DIR': Object.freeze({ capture: 'Q-S1-core', what: 'strategy.long / strategy.short (v4 `long`) as directions' }),
  'B-QTY': Object.freeze({ capture: 'Q-S1a', what: 'qty = na takes the declared default size' }),
  'B-DEFAULTS': Object.freeze({ capture: 'Q-S1b', what: 'the per-version declaration defaults' }),
  // the values
  'B-VAL': Object.freeze({ capture: 'Q-S1-core', what: 'the strategy.* values and per-trade reads' }),
  // ── W9-T6: fill timing (`broker.js` tick routine and `endBar`, `vm.js` step order) ──
  // (The July-2026 defaults, W9-J1, are NOT a rule: every pin fixture's settings read-back must show what
  // its own source declares, defaults for the rest - a precondition in `evidence_engine.py::resolve_pins`. `backtest_fill_limits_assumption` other than 0 is
  // refused at build, `ast/strategyBroker.js`: no capture is queued for it.)
  'B-POC': Object.freeze({ capture: 'W9-P1', what: 'process_orders_on_close: a market order (entry, close, close_all) placed on bar t fills at t\'s close, after the script ran on t; the script reads that fill from bar t+1' }),
  'B-POC-PRICE': Object.freeze({ capture: 'W9-P1', what: 'process_orders_on_close: a price order placed on bar t gets one attempt at t\'s close and fills there only if the close meets its level; otherwise it is live from the next open' }),
  'B-POC-PYR': Object.freeze({ capture: 'W9-P1', what: 'process_orders_on_close with pyramiding: a close fill that adds to an open position in the same direction' }),
  'B-POC-FILLS': Object.freeze({ capture: 'W9-P1b', what: 'process_orders_on_close with calc_on_order_fills: a fill on the closing tick re-runs the script on that bar, from the bar\'s start state' }),
  'B-FILLS': Object.freeze({ capture: 'W9-P2', what: 'calc_on_order_fills on history: one extra execution on each tick (the open, a level on the path, an extreme) where an order fills; OHLC hold the bar\'s final values; the extra execution is rolled back; orders it places fill from the next tick' }),
  'B-TICK-HIST': Object.freeze({ capture: 'W9-P3', what: 'calc_on_every_tick on history: a historical bar executes once, on its close, as the default does' }),
})

export const BROKER_RULE_IDS = Object.freeze(Object.keys(BROKER_RULES))

/** The capture row that pins `ruleId`; throws for a rule this table does not name. */
export function ruleCapture(ruleId) {
  if (!Object.prototype.hasOwnProperty.call(BROKER_RULES, ruleId)) {
    throw new Error(`broker rule \`${ruleId}\` is not named in brokerRules.js`)
  }
  return BROKER_RULES[ruleId].capture
}
