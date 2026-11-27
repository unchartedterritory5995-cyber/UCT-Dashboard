// app/src/components/chart/builder/authoring/strategyGate.js
//
// ─── ⭐⭐ THE GATE A WRITTEN STRATEGY PASSES BEFORE IT IS OFFERED (2026-11-26, coordinator ruling 1, step 2) ──────────
//
// The assistant is about to write `strategy()` scripts. A strategy the broker would refuse must never be offered as
// built. The check of a written script (`scriptAnswer.js::checkScript`) passed one on the member's chart whenever its
// plots could stand in: an unpinned rule DISARMS the broker (`runtimeColumns.js::disarmedAfter`), the plots are drawn,
// and the refusal lives ONLY in the strategy record, which the check never read (path map, 2026-11-26). It also ran a
// strategy with no strategy window in its context, so a run that must start from the window refused
// `runtime:strategy-start` before it reached a single pin.
//
// So the census predicate -- "would this strategy transfer if armed" (`armedStrategyVerdict`, written for
// `strategyArmedCensus.measure.test.js`) -- is HERE, in the product, and the census re-exports it: ONE authority over
// what a member's chart serves of a strategy, for a pasted script and a written one alike. Its steps, unchanged:
// the member door's document holds the broker; `computeRuntimeColumns` on the bars with the COMMITTED pin ledger
// finishes with a strategy record that carries no refusal; the trades are drawn or their markers refused WITH a
// sentence (MK-LOOK unpinned: disclosed by name, coordinator ruling 2026-11-26).
import { memberPaneDefinition } from '../memberPane/memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'
import { computeRuntimeColumns } from '../../engine/runtime/runtimeColumns'
import { runtimeStrategyOf } from '../../engine/runtime/strategyRecord'
import { drawsTradeMarkers, memberTradeMarkers } from '../../engine/runtime/tradeMarkers'
import { loadStrategyHistoryWindow, strategyHistoryWindowNow, strategyListingDepthNow } from '../../engine/strategyWindow'

export const ARMED_SCHEMA = 'uct.strategy-armed/v1'
const ARMED_DEF_ID = 'u_strategy-armed-census'
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

/** What the check hands the predicate as the door's answer: the paste check already attached the script cleanly and
 *  the run on the chart drew it (`checkScript` asks only then), so the door has said yes. */
export const PASTE_CHECK_PASSED = () => ({ attached: true, clean: true, guard: null, refusals: [] })

/** What the dock leads with when the broker would refuse a written strategy. */
export const STRATEGY_REFUSED_HEADLINE = 'Its backtest does not run on this chart'
/** The mark a strategy refusal carries back to the assistant (the server reads it: an unpinned rule is not repaired). */
export const STRATEGY_WALL_MARK = 'strategy-wall'

/**
 * The chart with the strategy window the binder hands a strategy document (`historyWindowBars`, `listingDepthBars`:
 * `StockChart.jsx`, `binder.js`), read through the same tab-wide answer (`strategyWindow.js`). Unchanged when the tab
 * holds no window (the broker gate off, the server silent): the run then refuses by name, as the chart would.
 */
export async function withStrategyWindow(chart, { load = loadStrategyHistoryWindow } = {}) {
  if (!chart || !chart.ctx) return chart
  try { await load() } catch { /* the window stays unknown: the run says so by name */ }
  const w = strategyHistoryWindowNow()
  const depth = strategyListingDepthNow()
  if (w === null) return chart
  return { ...chart, ctx: { ...chart.ctx, historyWindowBars: w, ...(depth !== null ? { listingDepthBars: depth } : {}) } }
}

/**
 * A verdict that said "runs", taken back when the predicate says the strategy does not transfer: the broker's own
 * wall and sentence become the reason the assistant reads, marked `STRATEGY_WALL_MARK`.
 */
export function gatedVerdict(verdict, armed, limits = { maxChars: 300 }) {
  if (!verdict || !verdict.runs || !armed || armed.transfers) return verdict
  const why = (armed.run && armed.run.message) || armed.wall || 'the broker would not run it'
  const line = `${STRATEGY_WALL_MARK} ${armed.wall}: ${why}`.replace(/\s+/g, ' ').trim().slice(0, limits.maxChars)
  return { ...verdict, runs: false, headline: STRATEGY_REFUSED_HEADLINE, strategyWall: armed.wall, errors: [line] }
}
