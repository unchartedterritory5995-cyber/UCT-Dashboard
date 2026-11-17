// app/src/components/chart/engine/__tests__/vendorHarness/strategyHarness.js
//
// ─── U14: OUR BROKER ON A STRATEGY CAPTURE, GRADED FILL BY FILL ──────────────────
//
// A strategy capture (tv_capture.js v3, with `provenance.report`) carries TradingView's own
// Strategy Tester answer. This runs OUR broker (`runtime/broker.js`) on the capture's script and
// the capture's own bars, and grades it with the ONE strategy grade (`compare.mjs::gradeStrategy`):
// the reference floor, the settings (declared, effective and unread), bar identity, the trades,
// the fills fill by fill, the report slots, every plotted value bar by bar, and the texts the script
// draws. The result becomes a VERDICT FILE
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
import { symbolConstants, minContractOf } from '../../ast/bind.js'
import { storeExchangeOfCapture } from './storeExchange.js'
import { gradeStrategy, strategyFirstDifference } from '../../../../../../../tools/vendor_harness/compare.mjs'
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

/** ⭐⭐ PARITY (2026-11-16) — the symbol AS THE PRODUCT HANDS IT: OUR STORE's exchange spelling
 *  (`storeExchange.js`, the indicator side's one authority: `NYSE Arca` for AMEX:SPY), never TradingView's alone.
 *  ⚰️ This handed the run TradingView's spelling, so AMEX:SPY settled no `syminfo.mintick` (the store's tick row is
 *  `NYSE Arca`) and w9-r1-risk-intraday-range-spy-15 refused at bind on a chart a member's run would have bound. */
function symbolOf(capture) {
  const s = capture.symbol || {}
  const pro = String(s.pro_name || s.full_name || s.name || '')
  const tv = s.exchange || (pro.includes(':') ? pro.split(':')[0] : null)
  return { ticker: pro.includes(':') ? pro.split(':').pop() : (s.name || pro), exchange: storeExchangeOfCapture(capture, tv) || tv }
}

/** The capture's bars, oldest first, in the broker's shape (bar times in epoch seconds). */
export function barsOfCapture(capture) {
  const b = capture && capture.bars
  if (!b || b.timeUnit !== 'unix-s' || !Array.isArray(b.rows)) return null
  return b.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v === null || v === undefined ? 0 : v }))
}

/**
 * ⭐ THE BARS TRADINGVIEW'S STRATEGY RAN ON. A strategy (no `calc_on_every_tick`) runs a bar once TradingView
 * CONFIRMS it, and a chart can hold a newest bar its strategy has not run yet: after the session, before
 * TradingView confirms the daily bar. ⚰️ 2026-11-16: every strategy capture of the night (22:09-23:18 UTC) held
 * 667 bars and 666 value rows, the 11-16 bar missing; our run took all 667 as confirmed, and the grade read the
 * extra bar as "667 bars of ours against 666" (W9-V-D11 -rpt and both W9-MK1 captures DIVERGE, 13 broker pins
 * un-pinned), while every indicator capture of the same session held its newest bar.
 * When the capture's value rows are EXACTLY its bars but the newest, time for time, our run is handed those bars
 * and the newest is named as not run (`unrun`, its time). ⛔ Any other difference between the two is left to the
 * grade, which calls a bar of ours TradingView does not have DIVERGE.
 * @returns {{bars: (object[]|null), unrun: (number|null)}}
 */
export function barsTradingViewRan(capture) {
  const bars = barsOfCapture(capture)
  const rows = capture && capture.plotValues && Array.isArray(capture.plotValues.rows) ? capture.plotValues.rows : null
  if (!bars || !rows || bars.length < 2 || rows.length !== bars.length - 1) return { bars, unrun: null }
  for (let i = 0; i < rows.length; i += 1) {
    if (!Array.isArray(rows[i]) || rows[i][0] !== bars[i].t) return { bars, unrun: null }
  }
  return { bars: bars.slice(0, -1), unrun: bars[bars.length - 1].t }
}

/**
 * ⭐ THE BUILD, AS THE MEMBER DOOR MAKES IT (`builder/memberPane/runtimeObjectsDoor.js::runtimeOwnObjectsOf`). A
 * script that draws is built WITH its drawings (`objectsInRun`: the run executes every `label.new` and holds
 * what it makes), which is the build that reads the `strategy.*` texts a label prints. When that build lowers no
 * drawing, or refuses, the door falls back to the value build that hands every drawing to the host program
 * (`objectTrees: []`: skipped, never drawn); the run then draws nothing, and its texts are listed UNGRADED with
 * the drawing build's own refusal, never dropped.
 * ⚰️ U14 built with neither option, so every probe with the std set's label block refused `runtime:object-op`
 * at build the moment its `strategy.*` reads were served.
 * @returns {{ok:true, built, drawing:boolean, drawingRefusal:(object|null)} | {ok:false, refusal}}
 */
function buildAsTheDoorDoes(capture, bars) {
  const opts = { bars, inputs: {}, symbol: symbolOf(capture), strategyBroker: true, ...runtimeClockOpts(capture.newestBarIsForming) }
  // the capture says whether its newest bar had finished; the build is told through the one producer
  // (`pineRuntimeFrontendGate`: no file reaches the runtime lane without it), unknown stays unknown
  const drawing = buildRuntimeIr(capture.source.text, { ...opts, objectsInRun: true })
  const lower = (b) => lowerIrProgram(b.ir, { historyFromListing: runsFromTradingViewsFirstBar(capture, bars) })
  if (drawing.ok) {
    const program = lower(drawing)
    // the door's own test: the drawing build stands only when it lowered a drawing operation
    if ((program.objectOps || []).length > 0) return { ok: true, built: drawing, program, drawing: true, drawingRefusal: null }
  }
  const value = buildRuntimeIr(capture.source.text, { ...opts, objectTrees: [] })
  if (value.ok) return { ok: true, built: value, program: lower(value), drawing: false, drawingRefusal: drawing.ok ? null : (drawing.refusal || {}) }
  // neither builds: the refusal is the drawing build's when the value build only deferred to it
  const vr = value.refusal || {}
  const refusal = !drawing.ok && (vr.guard === 'runtime:object-op' || vr.guard === 'runtime:no-output') ? (drawing.refusal || {}) : vr
  return { ok: false, refusal }
}

/**
 * Run our broker on the capture's script and bars.
 * @returns {{ok:true, record, report, plots, drawn} | {ok:false, refusal:{rule, guard, expected, message}}}
 *   `plots`: our `plot` outputs in the order the program emits them, each `[{time, value}]`;
 *   `drawn`: `{status:'ok', labels:[{time, text}]}` when the run drew its own objects, else
 *   `{status:'ungraded', reason}` (the drawing build refused, or the store withheld the labels).
 */
export function runOurBroker(capture, { pins = ALL } = {}) {
  const { bars } = barsTradingViewRan(capture)
  if (!bars) return { ok: false, refusal: { rule: 'harness:bars', guard: 'harness:bars', expected: false, message: 'the capture has no unix-s bars' } }
  const made = buildAsTheDoorDoes(capture, bars)
  if (!made.ok) {
    const r = made.refusal || {}
    const guard = r.guard || r.code || 'build'
    return { ok: false, refusal: { rule: guard, guard, expected: EXPECTED_REFUSAL_GUARDS.includes(guard), message: r.message || JSON.stringify(r) } }
  }
  const built = made.built
  const program = made.program
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((x) => x[k])))
  const barTimes = bars.map((x) => x.t)
  const confirmed = capture.newestBarIsForming === false
  // the run is handed TradingView's own loaded bars, every one of them: the product's server window (5,000,
  // `bars_window.HISTORY_WINDOW_BARS`) is not what TradingView ran on (w9-r1-risk-intraday-range: 6,343 SPY 15m
  // bars), and a run cut to it would start on another bar than TradingView's
  const windowBars = Math.max(5000, bars.length)
  // ⭐⭐ PARITY (2026-11-16) — the symbol's minimum contract, derived exactly as the member's run derives it
  // (`runtimeColumns.js`: `minContractOf(symbolConstants(symbol))`, the witnessed `symbolScope.json::min_contract`
  // row). ⚰️ The harness passed none, so every cash / percent-of-equity size refused Q-S1a here while a member's run
  // on the same listing sized: the grade judged a program no member runs.
  const minContract = minContractOf(symbolConstants(symbolOf(capture)))
  let res
  try {
    res = execute(program, { bars: bars.length, series, columns: program.columns, confirmed, barTimes, historyWindowBars: windowBars,
      minContract }, undefined, { brokerPinned: pins })
  } catch (e) {
    const guard = (e && e.guard) || 'runtime:error'
    // ruling D12: a refusal about a SETTING the run would have to assume (`BrokerRefusal.setting`, raised at bind,
    // before any rule) is EXPECTED: our run was never the run TradingView made, so it is evidence about the
    // setting, not about a fill. Every other broker refusal against a TradingView value stays a DIVERGE.
    const expected = EXPECTED_REFUSAL_GUARDS.includes(guard) || (!!e && typeof e.setting === 'string' && e.setting !== '')
    return { ok: false, refusal: { rule: (e && e.rule) || guard, guard, expected, message: String(e && e.message) } }
  }
  const record = strategyRecordOf({ summary: res.broker, decl: built.ir.broker, barTimes, historyWindowBars: windowBars, confirmed })
  // ⭐ the script's own plots, IN THE ORDER THE PROGRAM EMITS THEM. A plot output carries no title (⚰️ U14 keyed
  // them by `output.title`, which no plot has: no value series was ever compared, and method (b)'s signal
  // identity could only ever answer INCONCLUSIVE). `valueSeriesOf` pairs them with the capture's plots and
  // refuses a pairing it cannot prove.
  const plots = []
  for (const [k, o] of (program.outputs || []).entries()) {
    if (!o || o.call !== 'plot' || !res.outputs[k]) continue
    plots.push(Array.from(res.outputs[k], (value, i) => ({ time: barTimes[i], value: Number.isFinite(value) ? value : null })))
  }
  // ruling D11: the bar TIME each rule was first asked on (null: before the first bar)
  const ruleFirstTime = {}
  for (const [id, bar] of Object.entries((res.broker && res.broker.ruleFirstBars) || {})) {
    ruleFirstTime[id] = Number.isInteger(bar) && bar >= 0 && bar < barTimes.length ? barTimes[bar] : null
  }
  return { ok: true, record, report: strategyReportOf(record, { isPinned: pins }), plots, drawn: drawnOf(made, res, barTimes), ruleFirstTime }
}

/**
 * ⭐⭐ RULING D11 (coordinator, owner-delegated, 2026-11-16) — WHAT A DIVERGING CAPTURE UN-PINS, as recorded
 * fields a resolver can check. For a DIVERGE whose first differing event sits on a bar
 * (`compare.mjs::strategyFirstDifference`): `culprit` is the rules our broker FIRST exercised on that bar
 * (`ruleFirstTime`, the broker's own account), `afterDifference` the rules it first exercised on a later bar
 * (after the two runs parted, nothing is evidence for them either), and `prefixExact` the proof that every graded
 * step is equal on the bars strictly before. `evidence_engine.resolve_pins` applies the exception only when all
 * of them are present, `prefixExact` is true and `culprit` is not empty; anything else is the strict rule.
 * @returns {{firstDifference:{bar:number, step:number}, prefixExact:boolean, culprit:string[], afterDifference:string[]} | null}
 */
export function culpritOf(fd, run) {
  if (!fd || !run || !run.ok || !run.ruleFirstTime) return null
  const first = run.ruleFirstTime
  const used = [...run.record.rulesUsed].sort()
  // a rule the broker did not date is treated as exercised AT the event: it can never be excused
  const at = (id) => (Object.prototype.hasOwnProperty.call(first, id) ? first[id] : fd.bar)
  return {
    firstDifference: { bar: fd.bar, step: fd.step },
    prefixExact: fd.prefixExact === true,
    culprit: used.filter((id) => at(id) === fd.bar),
    afterDifference: used.filter((id) => at(id) !== null && at(id) > fd.bar),
  }
}

/** The label texts our run drew, by bar time; or why they cannot be graded. */
function drawnOf(made, res, barTimes) {
  if (!made.drawing) {
    const r = made.drawingRefusal
    return { status: 'ungraded', reason: r ? `the build that draws refused (${r.guard || 'build'})` : 'the script draws nothing in our run' }
  }
  const fin = res.objects && typeof res.objects.finish === 'function' ? res.objects.finish() : null
  if (!fin || fin.status !== 'ok') return { status: 'ungraded', reason: `our run withheld its drawings (${(fin && fin.reason) || 'no object store'})` }
  if (fin.withheld && fin.withheld.label) return { status: 'ungraded', reason: `our run withheld its labels (${fin.withheld.label})` }
  const labels = []
  for (const o of fin.live) {
    if (o.family !== 'label') continue
    const x = o.props.x
    const time = Number.isInteger(x) && x >= 0 && x < barTimes.length ? barTimes[x] : null
    if (time === null || typeof o.props.text !== 'string') return { status: 'ungraded', reason: 'a label of ours has no bar or no text to compare' }
    labels.push({ time, text: o.props.text })
  }
  return { status: 'ok', labels }
}

// ─── the value series: the capture's plots against ours ──────────────────────────
/** Every top-level `plot(...)` of a source, in order: `{ title, readsBroker }`. `title` is its literal title
 *  (the second positional argument or `title =`), null when it has none; `readsBroker` says whether the call's
 *  own text reads a `strategy.*` value (method (b): such a plot is a broker value, not a signal). */
export function declaredPlots(source) {
  const text = String(source || '').replace(/\r\n/g, '\n')
  const out = []
  const re = /^plot[ \t]*\(/gm
  let m
  while ((m = re.exec(text))) {
    const args = []
    let depth = 0
    let cur = ''
    let q = null
    let i = m.index + m[0].length
    for (; i < text.length; i += 1) {
      const ch = text[i]
      if (q) { cur += ch; if (ch === '\\') { cur += text[i + 1] || ''; i += 1 } else if (ch === q) q = null; continue }
      if (ch === '"' || ch === "'") { q = ch; cur += ch; continue }
      if (ch === '(' || ch === '[') depth += 1
      else if (ch === ')' || ch === ']') { if (depth === 0) break; depth -= 1 } else if (ch === ',' && depth === 0) { args.push(cur); cur = ''; continue }
      cur += ch
    }
    args.push(cur)
    const lit = (a) => { const t = /^\s*(?:title\s*=\s*)?"((?:[^"\\]|\\.)*)"\s*$/.exec(a || ''); return t ? t[1] : null }
    const named = args.find((a) => /^\s*title\s*=/.test(a))
    const title = named !== undefined ? lit(named) : (args.length > 1 && !/^\s*\w+\s*=(?!=)/.test(args[1]) ? lit(args[1]) : null)
    out.push({ title, readsBroker: /\bstrategy\./.test(args[0] || '') })
    re.lastIndex = i
  }
  return out
}

/**
 * ⭐ THE PAIRING, FAIL-CLOSED. TradingView names a study's plots `plot_0..plot_n` in the order the source calls
 * `plot()`, and our program emits its `plot` outputs in that order too. That is used ONLY when the capture
 * itself confirms it: the source declares exactly as many titled plots as the capture holds and as our run
 * emitted, and every plot's style title in the capture IS the title the source declares at that position.
 * Anything else is `{status: 'unpaired', reason}` (the grade is INCONCLUSIVE), never paired by position anyway.
 * @returns {{status:'ok', series:object[]} | {status:'unpaired', reason:string}}
 */
export function valueSeriesOf(capture, ourPlots) {
  const pv = capture.plotValues
  if (!pv || !Array.isArray(pv.fields) || !Array.isArray(pv.rows)) return { status: 'unpaired', reason: 'the capture holds no plot values' }
  const styles = (capture.study && capture.study.styles) || {}
  const declared = declaredPlots(capture.source.text)
  const n = pv.fields.length - 1
  if (declared.length !== n) return { status: 'unpaired', reason: `the source declares ${declared.length} plot(s) and the capture holds ${n}` }
  if (!Array.isArray(ourPlots) || ourPlots.length !== n) {
    return { status: 'unpaired', reason: `our run emitted ${Array.isArray(ourPlots) ? ourPlots.length : 0} plot(s) and the capture holds ${n}` }
  }
  const series = []
  for (let k = 1; k <= n; k += 1) {
    const style = styles[pv.fields[k]]
    const title = style && typeof style.title === 'string' ? style.title : null
    const want = declared[k - 1].title
    if (title === null || want === null || title !== want) {
      return { status: 'unpaired', reason: `plot ${k} is titled ${JSON.stringify(title)} in the capture and ${JSON.stringify(want)} in the source` }
    }
    series.push({
      title,
      readsBroker: declared[k - 1].readsBroker,
      reference: pv.rows.map((r) => ({ time: r[0], value: r[k] === undefined ? null : r[k] })),
      ours: ourPlots[k - 1],
    })
  }
  if (new Set(series.map((x) => x.title)).size !== series.length) return { status: 'unpaired', reason: 'two plots share one title' }
  return { status: 'ok', series }
}

/** TradingView's label texts by bar time (`objects.records.labels`, each `x` a position in `objects.xIndex`). */
export function referenceTextsOf(capture) {
  const o = capture.objects
  if (!o || !o.records || !Array.isArray(o.records.labels)) return { status: 'none' }
  const labels = o.records.labels
  if (labels.length === 0) return { status: 'none' }
  if ((o.unreadable || []).length) return { status: 'unread', reason: `the capture could not read ${o.unreadable.length} object(s)` }
  const xi = o.xIndex
  if (!xi || xi.found !== true || !Array.isArray(xi.times)) return { status: 'unread', reason: 'the capture carries no object x index' }
  const out = []
  for (const l of labels) {
    const time = Number.isInteger(l.x) ? xi.times[l.x] : null
    if (!Number.isFinite(time) || typeof l.t !== 'string') return { status: 'unread', reason: 'a captured label has no bar time or no text' }
    out.push({ time, text: l.t })
  }
  return { status: 'ok', labels: out }
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

/** Method (b)'s SIGNALS: the paired plots that read no `strategy.*` value (a broker value is graded at step 7,
 *  as a value, never excused as a warm-up that has not converged). `side`: 'reference' | 'ours'. */
function signalsOf(paired, side) {
  if (!paired || paired.status !== 'ok') return null
  const out = {}
  for (const s of paired.series) if (!s.readsBroker) out[s.title] = s[side]
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
  // ⭐ A REVERSAL IS ONE FILL OF BOTH SIZES in TradingView's fill list (strategy_reference.mjs: "a reversal is ONE
  // fill of both sizes"; w9-r1-risk-ddown: `S` sells 2 to close a long of 1 and open a short of 1). Our order log
  // states the size the order asked for (`fillQty`, the trade it opened) and links the trades it closed; the fill
  // TradingView lists is the two together.
  const closedQty = (o) => (o.kind === 'entry' && o.opened.length && o.closed.length
    ? o.closed.reduce((s, n) => s + ((record.trades[n - 1] || {}).qty || 0), 0) : 0)
  const fills = record.orders.filter((o) => o.status === 'filled').map((o) => ({
    time: o.fillTime,
    side: o.side,
    // the order COMMAND, as TradingView's `e` names it (strategy_reference.mjs FILL_ROLES): an entry is an entry
    // even when it only closes (allow_entry_in) or reverses; strategy.order is neither. ⭐ A MARGIN CALL is neither
    // too: TradingView lists its fill with `e: null`, as it lists strategy.order's (all 13 margin-call fills of
    // w9-q-s1i-short-v6-rddt-1d-2026-11-16, ids `Margin call 0`..`12`), so it takes the role `e: null` maps to
    role: o.kind === 'entry' ? 'entry' : (o.kind === 'order' || o.kind === 'margin_call') ? 'order' : 'exit',
    price: o.fillPrice,
    qty: o.fillQty + closedQty(o),
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

  // the pairing of the capture's plots with ours, made once (read at step 3 on method (b), and at step 7)
  let paired = null
  const pairedOnce = () => { if (!paired) { const r = runOnce(); paired = r.ok ? valueSeriesOf(capture, r.plots) : { status: 'unpaired', reason: 'our run refused' } } return paired }

  const agreement = settingsAgreement(capture)
  const { found } = propertiesByKey(capture.provenance.strategySettings, pineVersionOf(capture.source.text))
  const settings = {
    ...agreement,
    get effectiveDisagreements() {
      const r = runOnce()
      if (!r.ok) return []
      const out = effectiveSettingsDisagreements(found, r.record.settings)
      // ⭐ the tick every fill and value was computed on is the CAPTURE's own (`minmov / pricescale`, what
      // TradingView reports as `syminfo.mintick`), never ours alone: a run on another tick is not graded
      const ours = r.record.symbol ? r.record.symbol.mintick : null
      if (ours !== null && ours !== undefined && Math.abs(ours - tick) > 1e-12 * Math.max(1, tick)) out.push({ key: 'syminfo.mintick', ours, readBack: tick })
      return out
    },
    get unreadDependedOn() {
      const r = runOnce()
      // what the run and the grade READ: every rule the run reached, and every report slot our report SERVES
      // (a slot ours refuses is never compared, so an input only it depends on cannot move the grade)
      const served = Object.entries((r.ok && r.report.metrics) || {}).filter(([, m]) => m && m.status === 'served').map(([k]) => `report:${k}`)
      const readers = r.ok ? [...r.record.rulesUsed, ...served] : []
      return unreadDependedOn(agreement.unread, readers)
    },
  }
  // ⭐ the bars TradingView's strategy RAN, on both sides (`barsTradingViewRan`): a newest bar it had not run is
  // neither side's evidence, and is named in the verdict (`newestBarNotRun`)
  const ranOn = barsTradingViewRan(capture)
  const ranCount = ranOn.bars ? ranOn.bars.length : capture.bars.rows.length
  const refBars = capture.bars.rows.slice(0, ranCount).map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }))
  const ourBarsOf = () => ranOn.bars.map((b) => ({ time: b.t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }))
  const g = {
    reference, method, tick, refBars, span, graded,
    // functions: read at step 3 only (our run is never read before the floor; a getter would be read when
    // `gradeStrategy` destructures its argument)
    refSignals: method === 'b' ? () => (signalsOf(pairedOnce(), 'reference') || {}) : undefined,
    ourSignals: () => signalsOf(pairedOnce(), 'ours'),
    get ours() { return ours },
    get settings() { return settings },
    get ourBars() { return ourBarsOf() },
    // a function: read at step 6 only (destructuring a getter would run our broker before the floor)
    slots: () => { const r = runOnce(); return r.ok ? slotsOf(capture, r.report, slotMap) : null },
    // step 7: every plot of the capture against ours (a function: read only there)
    values: () => (runOnce().ok ? pairedOnce() : null),
    // step 8: the label texts (a function: read only there)
    texts: () => {
      const r = runOnce()
      if (!r.ok) return null
      const ref = referenceTextsOf(capture)
      const drawn = r.drawn || { status: 'ungraded', reason: 'our run states no drawings' }
      if (ref.status === 'none') return drawn.status === 'ok' && drawn.labels.length ? { status: 'ok', reference: [], ours: drawn.labels } : null
      if (ref.status !== 'ok') return { status: 'unread', reason: ref.reason }
      if (drawn.status !== 'ok') return { status: 'ungraded', what: `labels (${ref.labels.length})`, reason: drawn.reason }
      return { status: 'ok', reference: ref.labels, ours: drawn.labels }
    },
  }
  const verdict = gradeStrategy(g)
  const r = ran
  // ruling D11: a DIVERGE of a run that RAN is scoped to its first differing event, mechanically
  let scope = null
  if (verdict.verdict === 'DIVERGE' && r && r.ok) {
    const fd = strategyFirstDifference({ reference, ours: mappedOnce(), tick, span, graded, values: g.values(), texts: g.texts() })
    scope = culpritOf(fd, r)
  }
  return {
    ...verdict,
    ...(scope || {}),
    referenceTrades: reference.trades.length,
    rulesExercised: r && r.ok ? [...r.record.rulesUsed].sort() : [],
    ...(ranOn.unrun !== null ? { newestBarNotRun: ranOn.unrun } : {}),
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
    graded: v.graded ?? { trades: false, fills: false, slots: 0, values: 0, texts: 0 },
    referenceTrades: v.referenceTrades ?? null,
    rulesExercised: v.rulesExercised,
    ungradedSlots: v.ungradedSlots ?? [],
    ungradedTexts: v.ungradedTexts ?? [],
    // ruling D11 (null unless the capture DIVERGEs at an event on a bar): see `culpritOf`
    firstDifference: v.firstDifference ?? null,
    prefixExact: v.prefixExact ?? null,
    culprit: v.culprit ?? null,
    afterDifference: v.afterDifference ?? null,
    // the newest bar TradingView's strategy had not run (`barsTradingViewRan`): graded through the bar before it
    ...(v.newestBarNotRun !== undefined ? { newestBarNotRun: v.newestBarNotRun } : {}),
    provenance: { strategySettings: { properties: props.map((p) => ({ name: p.name, value: p.value })) } },
  }
}
