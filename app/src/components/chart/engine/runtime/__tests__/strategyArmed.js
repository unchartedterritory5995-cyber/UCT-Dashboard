// app/src/components/chart/engine/runtime/__tests__/strategyArmed.js
//
// ─── "WOULD TRANSFER IF ARMED": THE CENSUS PREDICATE FOR AN ORDER-PLACING STRATEGY ──
//
// A MEASUREMENT HELPER, under `__tests__` on purpose: nothing in the bundle imports it, and it never arms
// anything. The coverage map's headline (`coverage_map.py::transfers_fully`) never counts an order-placing
// strategy, because the strategy broker is dark (`strategyBrokerGate.js`) and arming it is the owner's act
// (W9 ruling D6). This asks, of one script, what arming WOULD serve, with every flag stubbed by the caller
// (objects-only pane, runtime pane, broker) inside a test. Coordinator ruling 2026-11-16: the predicate is
//
//   1. the member door, flags on, attaches the script CLEAN (the census's own `isClean`, handed in);
//   2. the door's document runs the broker (`tradeMarkers.js::drawsTradeMarkers`: a runtime document
//      stamped with the strategy window);
//   3. that document, run through the product path (`computeRuntimeColumns`) on the reference bars with
//      the COMMITTED pin ledger, finishes with a strategy record: every broker rule it exercised is pinned
//      (an unpinned or unsettled rule stops the run by name, and that is the script's wall);
//   4. its trades are drawn or disclosed: the member door's marker outcome (`memberTradeMarkers`) is
//      `ok`, or `refused` WITH a sentence (W9-T12: until MK-LOOK pins, the markers refuse by name).
//
// ⛔ It is a SEPARATE column. `transfers_fully` is unchanged by it.
import fs from 'node:fs'
import path from 'node:path'


// ⭐ 2026-11-26 -- THE PREDICATE IS A PRODUCT MODULE NOW (`builder/authoring/strategyGate.js`): the assistant's
// check of a written strategy runs it, and this census reads the SAME function (one authority, never two).
export { armedStrategyVerdict, ARMED_SCHEMA } from '../../../builder/authoring/strategyGate'
/** A source that DECLARES a strategy (the call form, at the start of a line): the member door's own predicate,
 *  re-exported (one authority: the door's strategy-backtest disclosure reads the same one). */
export { STRATEGY_DECLARATION } from '../../../builder/memberPane/memberPaneDefinition'

/** The broker gate's flag NAME, read off its module (`import.meta.env.<NAME> === '1'`), never typed. */
export function brokerFlagOf(gateSource) {
  return (String(gateSource).match(/env\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1] || null
}

/** ⭐⭐ W9 ARMED (owner decision 2026-11-26): is the broker armed in a production build? One reader, `brokerArmed.js`. */
export { brokerArmedInDockerfile, productionBrokerArmedOf } from './brokerArmed.js'

/** `bars_window.HISTORY_WINDOW_BARS`, the ONE authority over a strategy run's window, read off the Python
 *  module (W9 rule 3: no second bar constant). `repoRoot` is the repository root. */
export function historyWindowBarsOf(repoRoot) {
  const text = fs.readFileSync(path.join(repoRoot, 'api', 'services', 'bars_window.py'), 'utf8')
  const m = text.match(/^HISTORY_WINDOW_BARS\s*=\s*(\d+)\s*$/m)
  if (!m) throw new Error('api/services/bars_window.py states no HISTORY_WINDOW_BARS')
  return Number(m[1])
}

/** ⭐⭐ (2026-11-19, the strategy-only daily window) `bars_window.STRATEGY_HISTORY_WINDOW_BARS`, the window a strategy
 *  run on a member's chart takes (`GET /api/pine/history-window` answers it as `strategyHistoryWindowBars`, beside the
 *  shared `historyWindowBars`, which the chart hands as the run's `listingDepthBars`), read off the Python module. */
export function strategyWindowBarsOf(repoRoot) {
  const text = fs.readFileSync(path.join(repoRoot, 'api', 'services', 'bars_window.py'), 'utf8')
  const m = text.match(/^STRATEGY_HISTORY_WINDOW_BARS\s*=\s*(\d+)\s*$/m)
  if (!m) throw new Error('api/services/bars_window.py states no STRATEGY_HISTORY_WINDOW_BARS')
  return Number(m[1])
}

/** What the chart hands a strategy run for its window, as `GET /api/pine/history-window` answers it today:
 *  `{historyWindowBars: <the strategy window>, listingDepthBars: <the shared window>}`. */
export function chartStrategyWindowOf(repoRoot) {
  return { historyWindowBars: strategyWindowBarsOf(repoRoot), listingDepthBars: historyWindowBarsOf(repoRoot) }
}


