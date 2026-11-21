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

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns } from '../runtimeColumns'
import { runtimeStrategyOf } from '../strategyRecord'
import { drawsTradeMarkers, memberTradeMarkers } from '../tradeMarkers'

export const ARMED_SCHEMA = 'uct.strategy-armed/v1'
/** A source that DECLARES a strategy (the call form, at the start of a line): the member door's own predicate,
 *  re-exported (one authority: the door's strategy-backtest disclosure reads the same one). */
export { STRATEGY_DECLARATION } from '../../../builder/memberPane/memberPaneDefinition'
const ARMED_DEF_ID = 'u_strategy-armed-census'

/** The broker gate's flag NAME, read off its module (`import.meta.env.<NAME> === '1'`), never typed. */
export function brokerFlagOf(gateSource) {
  return (String(gateSource).match(/env\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1] || null
}

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

const short = (s, n = 240) => (s == null ? null : String(s).slice(0, n))

/**
 * @param {object} p
 * @param {string} p.source
 * @param {(source:string) => {attached:boolean, clean:boolean, guard:(string|null), refusals:string[]}} p.door
 *   the census's own door answer for this source, flags as the caller stubbed them
 * @param {object[]} p.bars  `{t, o, h, l, c, v}` oldest first, `t` in epoch seconds
 * @param {object} p.ctx     the run context (`tf`, `symbol`, `newestBarIsForming`, `historyFromListing`,
 *                           `historyWindowBars`)
 * @returns {object} the verdict (`ARMED_SCHEMA`): `transfers`, and `wall` (the first thing that stops it)
 */
export function armedStrategyVerdict({ source, door, bars, ctx }) {
  const out = { schema: ARMED_SCHEMA, transfers: false, wall: null, door: null, holdsBroker: false, run: null, markers: null }
  const d = door(source) || {}
  out.door = { attached: !!d.attached, clean: !!d.clean, guard: d.guard || null,
    refusals: [...new Set((d.refusals || []).map((r) => (typeof r === 'string' ? r : r && r.guard)).filter(Boolean))] }
  if (!d.attached) { out.wall = `door:${d.guard || (d.runtimeDeclined && d.runtimeDeclined.code) || 'refused'}`; return out }
  if (!d.clean) { out.wall = `door-dirty:${out.door.refusals[0] || 'object-or-paint-loss'}`; return out }
  let def
  try {
    const m = memberPaneDefinition({ source, id: ARMED_DEF_ID, name: 'armed' })
    def = m.ok ? m.definition : null
  } catch (err) {
    out.wall = `door:threw:${short((err && err.message) || err, 80)}`
    return out
  }
  out.holdsBroker = drawsTradeMarkers(def)
  if (!out.holdsBroker) { out.wall = 'strategy:no-broker-run'; return out }
  let cols
  try {
    const { installed, errors } = registry.installUserDefinitions([def])
    if (!installed || !installed[0]) throw Object.assign(new Error(String((errors || []).join(' | '))), { guard: 'door:not-installed' })
    cols = computeRuntimeColumns(installed[0], bars, ctx)
  } catch (e) {
    out.run = { ok: false, guard: (e && (e.guard || e.code)) || 'runtime:error', rule: (e && e.rule) || null,
      capture: (e && (e.capture || e.probe)) || null, message: short(e && e.message) }
    // the rule an unpinned stop names, else the capture row an unsettled one names (`BrokerRefusal.probe`)
    const which = out.run.rule || out.run.capture
    out.wall = `run:${out.run.guard}${which ? `:${which}` : ''}`
    return out
  } finally {
    try { registry.uninstallUserDefinition(ARMED_DEF_ID) } catch { /* nothing installed */ }
  }
  const rec = runtimeStrategyOf(cols)
  if (!rec) { out.run = { ok: false, guard: 'strategy:no-record', rule: null }; out.wall = 'run:strategy:no-record'; return out }
  // ⭐ Engine 76 (#1803, fix/strategy-refusal-keeps-plots) — a broker run refused by name no longer throws when its plots
  // can stand in without the broker (`runtimeColumns.js::disarmedAfter`): the plots are drawn and the RECORD holds the
  // refusal (`refusedStrategyRecordOf`; every other record carries none). It is the run's wall exactly as the thrown
  // refusal was, by the same guard and rule (or capture row).
  const refusal = (rec.refusals || [])[0]
  if (refusal) {
    out.run = { ok: false, guard: refusal.guard || 'runtime:error', rule: refusal.rule || null, capture: null,
      message: short(refusal.sentence) }
    out.wall = `run:${out.run.guard}${refusal.rule ? `:${refusal.rule}` : ''}`
    return out
  }
  out.run = { ok: true, trades: rec.trades.length, orders: rec.orders.length, rulesUsed: [...rec.rulesUsed].sort() }
  const mk = memberTradeMarkers(cols) || {}
  out.markers = { status: mk.status || null, guard: mk.guard || null, capture: mk.capture || null,
    disclosed: mk.status === 'refused' && typeof mk.sentence === 'string' && mk.sentence.length > 0 }
  if (!(mk.status === 'ok' || out.markers.disclosed)) { out.wall = `markers:${mk.status || 'unstated'}`; return out }
  out.transfers = true
  return out
}
