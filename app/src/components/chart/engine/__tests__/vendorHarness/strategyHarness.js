// app/src/components/chart/engine/__tests__/vendorHarness/strategyHarness.js
//
// ─── U14: OUR BROKER ON A STRATEGY CAPTURE, GRADED FILL BY FILL ──────────────────
//
// A strategy capture (tv_capture.js v3, with `provenance.report`) carries TradingView's own
// Strategy Tester answer. This runs OUR broker (`runtime/broker.js`) on the capture's script and
// the capture's own bars, and grades it with the ONE strategy grade (`compare.mjs::gradeStrategy`):
// the reference floor, the settings (declared, effective and unread), bar identity, the trades,
// the fills fill by fill, and the report slots. The result becomes a VERDICT FILE
// (`docs/pine/vendor-harness/strategy-verdicts/<captureId>.json`), which is what
// `tools/vendor_harness/evidence_engine.py pins` reads.
//
// ⛔ BEHIND THE EXISTING GATE. The broker is reached only through `buildRuntimeIr`'s
// `strategyBroker: true` build option, the gate's own override for rails and measurement
// (`strategyBrokerGate.js`); `VITE_PINE_STRATEGY_BROKER_ENABLED` is never read or set here, and
// no member path imports this file.
// ⛔ UNDER `__tests__` ON PURPOSE. A grade asks what our broker does when EVERY rule may serve, so
// it runs with the test-only pin predicate (`brokerPinned`), which `brokerPinsLock.test.js`
// refuses anywhere outside `__tests__`. What the run REACHED is its `rulesUsed`: the rules this
// capture exercises, and so the rules a MATCH may pin.

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'
import { strategyRecordOf } from '../../runtime/strategyRecord.js'
import { strategyReportOf } from '../../runtime/brokerReport.js'
import { gradeStrategy } from '../../../../../../../tools/vendor_harness/compare.mjs'
import { settingsAgreement, propertiesByKey, pineVersionOf, extractReportFields, isStrategyCapture } from '../../../../../../../tools/vendor_harness/strategy_capture.mjs'
import {
  referenceOfCapture, tickOfCapture, effectiveSettingsDisagreements, unreadDependedOn,
} from '../../../../../../../tools/vendor_harness/strategy_reference.mjs'

export const STRATEGY_VERDICT_SCHEMA = 'uct.strategy-verdict/v1'
/** Rule 11's refusals (repaint-class inputs) are EXPECTED: tallied apart, never a DIVERGE. */
export const EXPECTED_REFUSAL_GUARDS = Object.freeze(['runtime:strategy-repaint'])
/** Slots that are counts (compared exactly); every other slot is a value (REL_TOL). */
const COUNT_SLOTS = new Set(['totalClosedTrades', 'totalOpenTrades', 'numberWinningTrades', 'numberLosingTrades'])
const ALL = () => true

function symbolOf(capture) {
  const s = capture.symbol || {}
  const pro = String(s.pro_name || s.full_name || s.name || '')
  return { ticker: pro.includes(':') ? pro.split(':').pop() : (s.name || pro), exchange: s.exchange || (pro.includes(':') ? pro.split(':')[0] : null) }
}

/** The capture's bars, oldest first, in the broker's shape (bar times in epoch seconds). */
export function barsOfCapture(capture) {
  const b = capture && capture.bars
  if (!b || b.timeUnit !== 'unix-s' || !Array.isArray(b.rows)) return null
  return b.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v === null || v === undefined ? 0 : v }))
}

/**
 * Run our broker on the capture's script and bars.
 * @returns {{ok:true, record, report} | {ok:false, refusal:{rule, guard, expected, message}}}
 */
export function runOurBroker(capture, { pins = ALL } = {}) {
  const bars = barsOfCapture(capture)
  if (!bars) return { ok: false, refusal: { rule: 'harness:bars', guard: 'harness:bars', expected: false, message: 'the capture has no unix-s bars' } }
  // the capture says whether its newest bar had finished; the build is told through the one producer
  // (`pineRuntimeFrontendGate`: no file reaches the runtime lane without it), unknown stays unknown
  const built = buildRuntimeIr(capture.source.text, {
    bars, inputs: {}, symbol: symbolOf(capture), strategyBroker: true, ...runtimeClockOpts(capture.newestBarIsForming),
  })
  if (!built.ok) {
    const r = built.refusal || {}
    const guard = r.guard || r.code || 'build'
    return { ok: false, refusal: { rule: guard, guard, expected: EXPECTED_REFUSAL_GUARDS.includes(guard), message: r.message || JSON.stringify(r) } }
  }
  const program = lowerIrProgram(built.ir, { historyFromListing: runsFromTradingViewsFirstBar(capture, bars) })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((x) => x[k])))
  const barTimes = bars.map((x) => x.t)
  const confirmed = capture.newestBarIsForming === false
  // the run is handed TradingView's own loaded bars, every one of them: the product's server window (5,000,
  // `bars_window.HISTORY_WINDOW_BARS`) is not what TradingView ran on (w9-r1-risk-intraday-range: 6,343 SPY 15m
  // bars), and a run cut to it would start on another bar than TradingView's
  const windowBars = Math.max(5000, bars.length)
  let res
  try {
    res = execute(program, { bars: bars.length, series, columns: program.columns, confirmed, barTimes, historyWindowBars: windowBars },
      undefined, { brokerPinned: pins })
  } catch (e) {
    const guard = (e && e.guard) || 'runtime:error'
    return { ok: false, refusal: { rule: (e && e.rule) || guard, guard, expected: EXPECTED_REFUSAL_GUARDS.includes(guard), message: String(e && e.message) } }
  }
  const record = strategyRecordOf({ summary: res.broker, decl: built.ir.broker, barTimes, historyWindowBars: windowBars, confirmed })
  // the script's own plots, by title (method (b)'s signal identity reads them)
  const signals = {}
  for (const [k, o] of (program.outputs || []).entries()) {
    if (!o || typeof o.title !== 'string' || !res.outputs[k]) continue
    signals[o.title] = Array.from(res.outputs[k], (value, i) => ({ time: barTimes[i], value: Number.isFinite(value) ? value : null }))
  }
  return { ok: true, record, report: strategyReportOf(record, { isPinned: pins }), signals }
}

/** [B-START] serves a backtest only from TradingView's OWN first bar. Method (a): the capture asserts its
 *  bars start at the listing. Method (b): the capture's bars are TradingView's loaded window, and this run
 *  is handed exactly those bars, so it starts on TradingView's first bar by construction (asserted: the
 *  first bar is the window's `firstBarTime`); the guard keeps every order inside [X, Y). */
function runsFromTradingViewsFirstBar(capture, bars) {
  const method = capture.provenance && capture.provenance.gradeMethod
  if (method === 'a') return !!(capture.history && capture.history.startsAtBar0 === true)
  if (method === 'b') return !!(capture.window && bars.length && capture.window.firstBarTime === bars[0].t)
  return false
}

/** TradingView's plots, by title (`study.styles[plot_k].title`), as `{ time, value }` rows. */
function referenceSignalsOf(capture) {
  const pv = capture.plotValues
  const styles = (capture.study && capture.study.styles) || {}
  if (!pv || !Array.isArray(pv.fields) || !Array.isArray(pv.rows)) return {}
  const out = {}
  for (const [k, f] of pv.fields.entries()) {
    const title = styles[f] && styles[f].title
    if (k === 0 || typeof title !== 'string') continue
    out[title] = pv.rows.map((r) => ({ time: r[0], value: r[k] === undefined ? null : r[k] }))
  }
  return out
}

/** Our record's closed trades and fills in the grade's vocabulary. */
export function oursOf(record, report) {
  const profitOf = new Map(((report && report.trades && report.trades.rows) || []).map((r) => [r.n, r.profit]))
  const trades = record.trades.filter((t) => !t.open).map((t) => {
    const p = profitOf.get(t.n)
    return { n: t.n, direction: t.dir, entryTime: t.entryTime, exitTime: t.exitTime, entryPrice: t.entryPrice, exitPrice: t.exitPrice,
      qty: t.qty, profit: p && p.status === 'served' ? p.value : null, rule: t.entryRule }
  })
  const fills = record.orders.filter((o) => o.status === 'filled').map((o) => ({
    time: o.fillTime,
    side: o.side,
    // the order COMMAND, as TradingView's `e` names it (strategy_reference.mjs FILL_ROLES): an entry is an entry
    // even when it only closes (allow_entry_in) or reverses; strategy.order is neither
    role: o.kind === 'entry' ? 'entry' : o.kind === 'order' ? 'order' : 'exit',
    price: o.fillPrice,
    qty: o.fillQty,
    id: o.id,
    // TradingView names closes itself ("Close position order"): only an entry / exit / order id is ours to compare
    labelled: (o.kind === 'entry' || o.kind === 'exit' || o.kind === 'order') && typeof o.id === 'string',
    rule: o.rule,
    kind: o.kind,
  }))
  return { trades, fills }
}

function slotsOf(capture, report, slotMap) {
  if (!slotMap) return null
  const tree = capture.provenance.report.tree
  const ref = extractReportFields(tree, slotMap.slots)
  const out = {}
  for (const [slot, r] of Object.entries(ref)) {
    const m = report && report.metrics ? report.metrics[slot] : undefined
    out[slot] = { kind: COUNT_SLOTS.has(slot) ? 'count' : 'value', reference: r,
      ours: m ? { status: m.status, value: m.value, guard: m.guard } : { status: 'absent' } }
  }
  return out
}

/**
 * Grade one strategy capture.
 * @param {object} capture
 * @param {{slotMap?:object, run?:Function}} [opts]  `slotMap` is `strategy_report_slots.json`;
 *   `run` replaces `runOurBroker` (rails only).
 */
export function gradeStrategyCapture(capture, { slotMap = null, run = runOurBroker } = {}) {
  if (!isStrategyCapture(capture)) return { verdict: 'INCONCLUSIVE', step: 0, reason: 'not a strategy capture', rulesExercised: [] }
  const method = capture.provenance && capture.provenance.gradeMethod
  if (method !== 'a' && method !== 'b') return { verdict: 'INCONCLUSIVE', step: 0, reason: `grade method ${JSON.stringify(method)} is not (a) or (b)`, rulesExercised: [] }
  // method (b): trades and fills graded inside [X, Y); bars over [X - warm-up, Y); the script's plots inside [X, Y)
  let span
  let graded
  if (method === 'b') {
    const gr = capture.provenance.gradeRange || {}
    const before = capture.bars.rows.filter((r) => r[0] < gr.fromTime)
    if (!(before.length >= gr.warmupBars)) return { verdict: 'INCONCLUSIVE', step: 0, reason: 'method (b): the capture does not hold the warm-up before X', rulesExercised: [] }
    span = { from: gr.warmupBars > 0 ? before[before.length - gr.warmupBars][0] : gr.fromTime, to: gr.toTime }
    graded = { from: gr.fromTime, to: gr.toTime }
  }
  const reference = referenceOfCapture(capture)
  if (!reference.ok) return { verdict: 'INCONCLUSIVE', step: 0, reason: reference.reason, rulesExercised: [] }
  const tick = tickOfCapture(capture)
  if (tick === null) return { verdict: 'INCONCLUSIVE', step: 0, reason: 'the capture states no tick (minmov / pricescale)', rulesExercised: [] }

  // our run is read lazily, AFTER the reference floor (gradeStrategy step 0 never touches `ours`)
  let ran = null
  const runOnce = () => { if (!ran) ran = run(capture); return ran }
  let mapped = null
  const mappedOnce = () => { if (!mapped) { const r = runOnce(); mapped = r.ok ? oursOf(r.record, r.report) : { trades: [], fills: [] } } return mapped }
  const ours = {}
  Object.defineProperty(ours, 'refusal', { enumerable: true, get: () => { const r = runOnce(); return r.ok ? null : r.refusal } })
  Object.defineProperty(ours, 'trades', { enumerable: true, get: () => mappedOnce().trades })
  Object.defineProperty(ours, 'fills', { enumerable: true, get: () => mappedOnce().fills })

  const agreement = settingsAgreement(capture)
  const { found } = propertiesByKey(capture.provenance.strategySettings, pineVersionOf(capture.source.text))
  const settings = {
    ...agreement,
    get effectiveDisagreements() { const r = runOnce(); return r.ok ? effectiveSettingsDisagreements(found, r.record.settings) : [] },
    get unreadDependedOn() {
      const r = runOnce()
      // what the run and the grade READ: every rule the run reached, and every report slot our report SERVES
      // (a slot ours refuses is never compared, so an input only it depends on cannot move the grade)
      const served = Object.entries((r.ok && r.report.metrics) || {}).filter(([, m]) => m && m.status === 'served').map(([k]) => `report:${k}`)
      const readers = r.ok ? [...r.record.rulesUsed, ...served] : []
      return unreadDependedOn(agreement.unread, readers)
    },
  }
  const refBars = capture.bars.rows.map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
  const ourBarsOf = () => barsOfCapture(capture).map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }))
  const g = {
    reference, method, tick, refBars, span, graded,
    refSignals: method === 'b' ? referenceSignalsOf(capture) : undefined,
    // a function: read at step 3 only (our run is never read before the floor)
    ourSignals: () => { const r = runOnce(); return r.ok ? r.signals : null },
    get ours() { return ours },
    get settings() { return settings },
    get ourBars() { return ourBarsOf() },
    // a function: read at step 6 only (destructuring a getter would run our broker before the floor)
    slots: () => { const r = runOnce(); return r.ok ? slotsOf(capture, r.report, slotMap) : null },
  }
  const verdict = gradeStrategy(g)
  const r = ran
  return {
    ...verdict,
    referenceTrades: reference.trades.length,
    rulesExercised: r && r.ok ? [...r.record.rulesUsed].sort() : [],
  }
}

/** The verdict file for one capture: what `evidence_engine.py pins` reads. Carries the source
 *  sha (never the text) and the Properties read-back (names and values only). */
export function strategyVerdictOf(capture, { captureSha256, queueTargetId, slotMap }) {
  const v = gradeStrategyCapture(capture, { slotMap })
  const props = ((capture.provenance || {}).strategySettings || {}).properties || []
  return {
    schema: STRATEGY_VERDICT_SCHEMA,
    captureId: capture.id,
    captureSha256,
    receipt: (capture.receipt || {}).fnv1a ?? null,
    sourceSha256: capture.source.sha256,
    queueTargetId,
    symbol: (capture.symbol || {}).pro_name || null,
    timeframe: capture.timeframe,
    gradeMethod: capture.provenance.gradeMethod,
    verdict: v.verdict,
    step: v.step,
    reason: v.reason,
    first: v.first ?? null,
    graded: v.graded ?? { trades: false, fills: false, slots: 0 },
    referenceTrades: v.referenceTrades ?? null,
    rulesExercised: v.rulesExercised,
    ungradedSlots: v.ungradedSlots ?? [],
    provenance: { strategySettings: { properties: props.map((p) => ({ name: p.name, value: p.value })) } },
  }
}
