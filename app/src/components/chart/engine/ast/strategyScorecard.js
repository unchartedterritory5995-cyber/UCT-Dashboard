// app/src/components/chart/engine/ast/strategyScorecard.js
//
// W9-T15, ruling D7: the scorecard's member-facing wording for strategy backtests.
//
// The counts are DERIVED, never typed: the rule vocabulary is `BROKER_RULES`
// (`runtime/brokerRules.js`) and the pinned set is the committed ledger
// (`runtime/brokerPins.resolved.json`), the same ledger `pinned(ruleId)` reads at run time.
// The refusal is named by the broker's own constant, so the sentence cannot drift from the
// guard a member actually sees.
//
// The screener ruling (`strategiesAreRuled.test.js`: a strategy is not a screen) is a
// separate row and is not changed by this wording.
//
// `served` is the CALLER's: whether a production build arms the strategy broker. The owner armed it
// on 2026-11-26 (verbatim: "we are only admins and have no users so everything can always be live
// fully"; ruling D6, every W2 stage at once). The scorecard reads it off Dockerfile.web and the gate
// module (`runtime/__tests__/brokerArmed.js::productionBrokerArmedOf`), never a constant. The default
// stays false (fail closed): a caller that does not ask is told "not served".
import { BROKER_RULE_IDS, UNPINNED_GUARD } from '../runtime/brokerRules.js'
import RESOLVED from '../runtime/brokerPins.resolved.json'

/** The rule ids the committed ledger pins, restricted to rules the broker can exercise. */
export function pinnedBrokerRules(ledger = RESOLVED) {
  const rules = (ledger && ledger.rules) || {}
  return BROKER_RULE_IDS.filter((id) => Object.prototype.hasOwnProperty.call(rules, id))
}

/** D7: what is pinned, what refuses by name, and whether strategies are served. */
export function strategyScorecardWording({ ledger = RESOLVED, served = false } = {}) {
  const pinned = pinnedBrokerRules(ledger).length
  const total = BROKER_RULE_IDS.length
  const parts = [
    `${pinned} of ${total} broker rules are pinned, each verified against a TradingView capture.`,
    `A backtest that reaches an unpinned rule stops and refuses by name (${UNPINNED_GUARD}).`,
  ]
  parts.push(served
    ? 'Strategy backtests are served to members where every broker rule a backtest reaches is pinned.'
    : 'Strategy backtests are not served to members yet.')
  return parts.join(' ')
}
