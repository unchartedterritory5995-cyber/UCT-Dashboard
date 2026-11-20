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

import path from 'node:path'
import process from 'node:process'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lexPine, blockStatements, parseWholeExpression, findTop, isPunct, OUTPUT_CALLS as PINE_OUTPUT_CALLS } from '../../ast/pine.js'
import { splitCommaStatements } from '../../ast/objectFnInline.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'
import { strategyRecordOf } from '../../runtime/strategyRecord.js'
import { strategyReportOf } from '../../runtime/brokerReport.js'
import { symbolConstants, minContractOf } from '../../ast/bind.js'
import { historyWindowBarsOf } from '../../runtime/__tests__/strategyArmed.js'
import { toProductBars } from './ourSide.js'
import { storeExchangeOfCapture } from './storeExchange.js'
import { gradeStrategy, strategyFirstDifference, decodeVendorText } from '../../../../../../../tools/vendor_harness/compare.mjs'
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
function buildAsTheDoorDoes(capture, bars, member = null) {
  // ⭐⭐ (2026-11-20) `member`: a DAILY capture is built on the bars a member's daily chart hands the build (`/api/bars`'s
  // ISO date keys, `ourSide.js::toProductBars`) with the chart's timeframe, as `runtimeColumns.js::runtimeIrOptions` builds
  // it; `bars` (TradingView's epoch seconds) still decide where the run starts and key every point and fill
  const opts = member
    ? { bars: member.bars, inputs: {}, symbol: symbolOf(capture), strategyBroker: true, basePeriod: member.tf, tf: member.tf,
      ...runtimeClockOpts(capture.newestBarIsForming, { tf: member.tf }) }
    : { bars, inputs: {}, symbol: symbolOf(capture), strategyBroker: true, ...runtimeClockOpts(capture.newestBarIsForming) }
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

const DAILY_TF = /^1?D$/i

/** The member's daily chart's keys for `bars` (TradingView's epoch rows, the capture's own order): each row's ISO
 *  date as `/api/bars` keys it (`ourSide.js::toProductBars`), or null when a row has none. */
function memberDailyBarsOf(capture, bars) {
  const product = toProductBars(capture)
  const rows = capture.bars.rows
  const keyOf = new Map(rows.map((r, i) => [r[0], product[i] && product[i].t]))
  const out = bars.map((b) => ({ ...b, t: keyOf.get(b.t) }))
  return out.every((b) => typeof b.t === 'string') ? { bars: out, tf: 'D' } : null
}

/**
 * Run our broker on the capture's script and bars.
 * @returns {{ok:true, record, report, plots, drawn} | {ok:false, refusal:{rule, guard, expected, message}}}
 *   `plots`: our value outputs in the order the program emits them, each `{kind, points: [{time, value}]}`;
 *   `drawn`: `{status:'ok', labels:[{time, text}]}` when the run drew its own objects, else
 *   `{status:'ungraded', reason}` (the drawing build refused, or the store withheld the labels).
 */
export function runOurBroker(capture, { pins = ALL } = {}) {
  const ranOn = barsTradingViewRan(capture)
  // ⭐⭐ (2026-11-18, Q-S1p) A CAPTURE TAKEN IN SESSION is graded on the member's own run: every bar, the forming one
  // too, with the newest NOT confirmed, so our vm leaves it out ([B-EXEC]): the rule the capture grades.
  // ⚰️ The harness handed such a run the bars TradingView ran (the forming bar already cut) AND said the newest was
  // forming, so the vm left out a second bar: the last closed bar read `na` on our side (supertrend-strategy-is, the
  // first in-session strategy capture graded, DIVERGE at 11-17 on a run no member makes).
  const forming = capture.newestBarIsForming === true && ranOn.unrun !== null
  const bars = forming ? barsOfCapture(capture) : ranOn.bars
  if (!bars) return { ok: false, refusal: { rule: 'harness:bars', guard: 'harness:bars', expected: false, message: 'the capture has no unix-s bars' } }
  // ⭐⭐ (2026-11-20, Q-SU-8) A DAILY CAPTURE IS GRADED ON THE MEMBER'S OWN BAR KEYS. The build's clock reads a bar's
  // epoch seconds through the unit gate (`indicators.js::barOpenInstant`), whose number branch refuses anything before
  // 1990 (it guards a `YYYYMMDD` int read as seconds), so one pre-1990 bar blanked `time` on every bar: AAPL 1D from its
  // 1980 listing ran no `time`-windowed order at all (0 trades against TradingView's 59) on a run no member makes. A
  // member's daily chart hands ISO dates, which the date branch reads to TradingView's own 09:30 New York instant
  // (#1686: byte-identical records), so the build is handed those; the series, every point and every fill stay keyed
  // by TradingView's epoch seconds, the same instants (`strategyBarTimeIdentity.test.js`).
  const member = DAILY_TF.test(String(capture.timeframe || '')) ? memberDailyBarsOf(capture, bars) : null
  const made = buildAsTheDoorDoes(capture, bars, member)
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
  // ⭐⭐ (2026-11-19, the strategy-only daily window) A METHOD (a) CAPTURE FROM THE LISTING DEEPER THAN THE SHARED
  // WINDOW is a deep start ([B-START-DEEP], Q-SU-7 / Q-SU-8): the run is handed the depth a member's run is served at
  // without it (`bars_window.HISTORY_WINDOW_BARS`, read off the module), so the rule is exercised and a MATCH pins it.
  // ⛔ Method (b) never: its time guard keeps every order inside [X, Y), so where TradingView started is not what it
  // grades, and its run must never be evidence for (or against) the deep start.
  const deepDepth = capture.provenance && capture.provenance.gradeMethod === 'a'
    ? historyWindowBarsOf(path.resolve(process.cwd(), '..')) : null
  // ⭐⭐ PARITY (2026-11-16) — the symbol's minimum contract, derived exactly as the member's run derives it
  // (`runtimeColumns.js`: `minContractOf(symbolConstants(symbol))`, the witnessed `symbolScope.json::min_contract`
  // row). ⚰️ The harness passed none, so every cash / percent-of-equity size refused Q-S1a here while a member's run
  // on the same listing sized: the grade judged a program no member runs.
  const minContract = minContractOf(symbolConstants(symbolOf(capture)))
  let res
  try {
    res = execute(program, { bars: bars.length, series, columns: program.columns, confirmed, barTimes, historyWindowBars: windowBars,
      minContract, ...(deepDepth !== null ? { listingDepthBars: deepDepth } : {}) }, undefined, { brokerPinned: pins })
  } catch (e) {
    const guard = (e && e.guard) || 'runtime:error'
    // ruling D12: a refusal about a SETTING the run would have to assume (`BrokerRefusal.setting`, raised at bind,
    // before any rule) is EXPECTED: our run was never the run TradingView made, so it is evidence about the
    // setting, not about a fill. Every other broker refusal against a TradingView value stays a DIVERGE.
    const expected = EXPECTED_REFUSAL_GUARDS.includes(guard) || (!!e && typeof e.setting === 'string' && e.setting !== '')
    return { ok: false, refusal: { rule: (e && e.rule) || guard, guard, expected, message: String(e && e.message) } }
  }
  const record = strategyRecordOf({ summary: res.broker, decl: built.ir.broker, barTimes, historyWindowBars: windowBars, confirmed })
  // ⭐ the script's own VALUE outputs (`plot`, `plotshape`, `plotchar`, `plotarrow`), IN THE ORDER THE PROGRAM EMITS
  // THEM, each with the call that made it. A plot output carries no title (⚰️ U14 keyed them by `output.title`, which
  // no plot has: no value series was ever compared, and method (b)'s signal identity could only ever answer
  // INCONCLUSIVE). `valueSeriesOf` pairs them with the capture's value slots and refuses a pairing it cannot prove.
  const plots = []
  for (const [k, o] of (program.outputs || []).entries()) {
    if (!o || !VALUE_SLOT_CALLS.has(o.call) || !res.outputs[k]) continue
    plots.push({ kind: o.call, points: Array.from(res.outputs[k], (value, i) => ({ time: barTimes[i], value: Number.isFinite(value) ? value : null })) })
  }
  // the forming bar is neither side's evidence (TradingView's strategy did not run it, `newestBarNotRun`): its point
  // leaves our series ONLY when our run computed nothing there; a value of ours on it stays, and the grade reads it
  // as a bar of ours TradingView does not have (DIVERGE)
  if (forming) {
    for (const pl of plots) {
      const last = pl.points[pl.points.length - 1]
      if (last && last.time === ranOn.unrun && last.value === null) pl.points.pop()
    }
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
//
// ⭐⭐ (2026-11-17, Q-SD1 / Q-SD2) WHAT THE SOURCE DECLARES IS READ BY THE PINE PARSER, NEVER BY A TEXT PATTERN.
// ⚰️ `declaredPlots` matched a LINE-START `plot(`: it could not see `upPlot = plot(…)`, the idiom of every script
// that fills a band (a `fill` names its plots by binding them), nor a `plotshape`, a `fill` or a `barcolor`, each of
// which takes a TradingView plot slot. supertrend-strategy (Q-SD1, Q-SD2) declares its three plots bound, and the
// grade read "the source declares 0 plot(s) and the capture holds 10" after its trades, fills and report had matched.
// The source is now lexed and split into statements by `pine.js` (`lexPine`, `blockStatements`: comments are gone
// before anything is read) and each output call parsed by `parseWholeExpression`, the calls the runtime front end
// registers as outputs in the order it registers them (`pineRuntimeFrontend.js`: a top-level call statement, or one
// bound to a name). A rail holds the list against the front end's own `ir.outputs` on every committed strategy capture.

/** The TradingView plot TYPE each slot-taking output call is filed as (`metaInfo().plots[i].type`, measured on the
 *  committed captures). `fill` is not here: it is a FILLED AREA, whose own slots (a colorer for a per-bar colour, the
 *  data rows of a gradient) name it by `target: fill_<j>`; a fill with a constant colour takes no plot slot at all. */
export const TV_SLOT_TYPE = Object.freeze({
  plot: 'line', plotshape: 'shapes', plotchar: 'chars', plotarrow: 'arrows',
  alertcondition: 'alertcondition', bgcolor: 'bg_colorer', barcolor: 'bar_colorer',
})
/** The calls whose slot holds a VALUE, compared at step 7 bar by bar. A colour slot (a paint, a fill's colour, a
 *  plot's own colorer) and an alert condition are paired and LISTED as not compared there (`notCompared`): the paint
 *  grade grades colours. */
export const VALUE_SLOT_CALLS = Object.freeze(new Set(['plot', 'plotshape', 'plotchar', 'plotarrow']))
/** The calls whose TradingView slots this grade does not pair (four prices and up to three colours): refused by name. */
const UNPAIRED_SLOT_CALLS = Object.freeze(new Set(['plotcandle', 'plotbar']))
/** Every output call that takes a TradingView plot slot or a filled area, in the source's own order. */
export const SLOT_CALLS = Object.freeze(new Set([...Object.keys(TV_SLOT_TYPE), 'fill', ...UNPAIRED_SLOT_CALLS]))
/** The slots TradingView files right AFTER the slot they serve, naming it in `target`. */
const SUB_SLOT_TYPES = Object.freeze(new Set(['colorer', 'text_colorer']))

const argValue = (a) => (a && a.value !== undefined ? a.value : a)
const literalText = (node) => (node && node.type === 'string' && typeof node.value === 'string' ? node.value : null)

/** Does a parsed expression read a `strategy.*` value (a name or a call)? */
function readsStrategy(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 200) return false
  if (Array.isArray(node)) return node.some((x) => readsStrategy(x, depth + 1))
  if ((node.type === 'name' || node.type === 'call') && typeof node.name === 'string' && node.name.startsWith('strategy.')) return true
  for (const [k, v] of Object.entries(node)) {
    if (k === 'tok' || k === 'endTok') continue
    if (v && typeof v === 'object' && readsStrategy(v, depth + 1)) return true
  }
  return false
}

/**
 * Every output call of a source that takes a TradingView plot slot or a filled area, in source order:
 * `{ ok: true, slots: [{ kind, title, readsBroker, line }] }`, or `{ ok: false, reason }` when the source cannot be
 * read. `kind` is the call (`plot`, `plotshape`, `fill`, `barcolor`, ...). `title` is the call's literal title (for a
 * value call: `title =` or the second positional argument; for a paint, an alert or a fill: `title =` only, their
 * positional title differs by version), null when it has none. `readsBroker` says whether the call's own value
 * argument reads a `strategy.*` value (method (b): such a plot is a broker value, not a signal).
 */
export function declaredSlots(source) {
  let lexed
  let stmts
  try {
    lexed = lexPine(String(source == null ? '' : source))
    // a line of comma-joined statements (`c = x ? a : b, plot(…)`) is each of its statements, read by the one split
    // the lanes share (`objectFnInline.js::splitCommaStatements`)
    stmts = splitCommaStatements(blockStatements(lexed.tokens, lexed.indents, 0), { isPunct })
  } catch (e) {
    return { ok: false, reason: `the source cannot be read by the Pine parser (${String((e && e.message) || e).slice(0, 160)})` }
  }
  const slots = []
  for (const stmt of stmts) {
    const toks = stmt.header || []
    const head = toks[0]
    let at = -1
    // ── an output call statement: `plot(…)` ──
    if (head && head.kind === 'ident' && SLOT_CALLS.has(head.value) && isPunct(toks[1], '(')) at = 0
    else {
      // ── an output call BOUND TO A NAME: `p = plot(…)` (the front end's own test) ──
      const e = findTop(toks, (x) => isPunct(x, '='))
      const v = e > 0 ? toks[e + 1] : null
      if (v && v.kind === 'ident' && SLOT_CALLS.has(v.value) && isPunct(toks[e + 2], '(')) at = e + 1
    }
    if (at < 0) continue
    let call
    try { call = parseWholeExpression(toks.slice(at)) } catch (e) {
      return { ok: false, reason: `the \`${toks[at].value}()\` at line ${toks[at].line} cannot be parsed (${String((e && e.message) || e).slice(0, 120)})` }
    }
    if (!call || call.type !== 'call' || call.name !== toks[at].value) {
      return { ok: false, reason: `the statement at line ${toks[at].line} is not one \`${toks[at].value}()\` call` }
    }
    const kind = call.name
    const args = call.args || []
    const named = (n) => { const a = args.find((x) => x && x.name === n); return a ? argValue(a) : null }
    const positional = args.filter((x) => x && !x.name)
    let title = named('title')
    const valueCall = VALUE_SLOT_CALLS.has(kind) || kind === 'alertcondition'
    if (title === null && valueCall && positional.length > 1) title = argValue(positional[1])
    const valueName = Object.hasOwn(PINE_OUTPUT_CALLS, kind) ? PINE_OUTPUT_CALLS[kind] : null
    const value = valueCall ? (named(valueName) || (positional.length ? argValue(positional[0]) : null)) : null
    slots.push({ kind, title: literalText(title), readsBroker: readsStrategy(value), line: toks[at].line })
  }
  return { ok: true, slots }
}

/**
 * The slot-taking output calls the runtime front end REGISTERS for a capture's script, in the order it registers them
 * (`ir.outputs`; a candle's four outputs are one call), from the value build `runOurBroker` makes: what
 * `declaredSlots` is held against (`strategyGrading.test.js`). `{ok: false, refusal}` when that build refuses.
 */
export function engineSlotCallsOf(capture) {
  const { bars } = barsTradingViewRan(capture)
  const built = buildRuntimeIr(capture.source.text, { bars, inputs: {}, symbol: symbolOf(capture), strategyBroker: true,
    ...runtimeClockOpts(capture.newestBarIsForming), objectTrees: [] })
  if (!built.ok) return { ok: false, refusal: built.refusal || {} }
  const calls = []
  for (const o of built.ir.outputs || []) {
    if (!o || !SLOT_CALLS.has(o.call)) continue
    if (UNPAIRED_SLOT_CALLS.has(o.call) && o.role !== 'open') continue
    calls.push(o.call)
  }
  return { ok: true, calls }
}

/**
 * ⭐ WHICH CAPTURE SLOT IS WHICH SOURCE CALL, FAIL-CLOSED, read off the capture's OWN plot list
 * (`study.plots`: each slot's TradingView type, and the `target` a colour or data slot names). TradingView files a
 * study's slots in the order the source calls its outputs; a call's colorer / text colorer follows the slot it serves
 * and names it (`target: plot_k`), and a fill's slots name their filled area (`target: fill_<j>`, the j-th `fill`).
 * At every position the capture's slot must be the TYPE the source's call is filed as, and a value slot's style
 * title must BE the title the source gives it; every slot of the capture must be accounted for. Anything else is
 * `{status: 'unpaired', reason}`, never paired by position anyway.
 * @returns {{status:'ok', slots:{id, column, kind, title, readsBroker, value:boolean, what:string}[]}
 *   | {status:'unpaired', reason:string}}
 */
export function captureSlotsOf(capture, declared = declaredSlots(capture && capture.source && capture.source.text)) {
  const pv = capture.plotValues
  if (!pv || !Array.isArray(pv.fields) || !Array.isArray(pv.rows)) return { status: 'unpaired', reason: 'the capture holds no plot values' }
  if (!declared || !declared.ok) return { status: 'unpaired', reason: (declared && declared.reason) || 'the source declares nothing readable' }
  const plots = capture.study && Array.isArray(capture.study.plots) ? capture.study.plots : null
  const n = pv.fields.length - 1
  if (!plots) return { status: 'unpaired', reason: `the capture holds ${n} plot value column(s) and records no plot list (study.plots)` }
  const ids = plots.map((p) => p && p.id)
  if (ids.length !== n || pv.fields.slice(1).some((f) => !ids.includes(f))) {
    return { status: 'unpaired', reason: `the capture's plot list (${ids.length}) is not its value columns (${n})` }
  }
  const styles = capture.study.styles || {}
  const titleOf = (p, fromStyle) => {
    const t = fromStyle ? (styles[p.id] && styles[p.id].title) : (p.title ?? (styles[p.id] && styles[p.id].title))
    return typeof t === 'string' ? decodeVendorText(t) : null
  }
  const out = []
  const where = (d) => `\`${d.kind}\` at line ${d.line}`
  let i = 0
  let fills = 0
  const take = (p, d, value, what) => { out.push({ id: p.id, column: pv.fields.indexOf(p.id), kind: d.kind, title: d.title, readsBroker: d.readsBroker, value, what }); i += 1 }
  for (const d of declared.slots) {
    if (d.kind === 'fill') {
      const target = `fill_${fills}`
      fills += 1
      while (plots[i] && plots[i].target === target) take(plots[i], d, false, `${where(d)} (${plots[i].type} of ${target})`)
      continue
    }
    if (UNPAIRED_SLOT_CALLS.has(d.kind)) {
      return { status: 'unpaired', reason: `the source's ${where(d)} fills TradingView slots this grade does not pair` }
    }
    const p = plots[i]
    if (!p) return { status: 'unpaired', reason: `the source declares more plot slots than the capture holds (${n}): ${where(d)} has none` }
    const want = TV_SLOT_TYPE[d.kind]
    if (p.type !== want) {
      return { status: 'unpaired', reason: `${p.id} is a ${JSON.stringify(p.type)} slot in the capture and the source's ${where(d)} is filed as ${JSON.stringify(want)}` }
    }
    const value = VALUE_SLOT_CALLS.has(d.kind)
    if (value) {
      const title = titleOf(p, true)
      if (title === null || d.title === null || title !== d.title) {
        return { status: 'unpaired', reason: `${p.id} is titled ${JSON.stringify(title)} in the capture and ${JSON.stringify(d.title)} in the source (${where(d)})` }
      }
    } else {
      // a paint or an alert: identified by its type and its place; a title both sides carry must match
      const title = titleOf(p, false)
      if (title !== null && d.title !== null && title !== d.title) {
        return { status: 'unpaired', reason: `${p.id} is titled ${JSON.stringify(title)} in the capture and ${JSON.stringify(d.title)} in the source (${where(d)})` }
      }
    }
    const served = p.id
    take(p, d, value, where(d))
    while (plots[i] && SUB_SLOT_TYPES.has(plots[i].type) && plots[i].target === served) take(plots[i], d, false, `${where(d)} (${plots[i].type} of ${served})`)
  }
  if (i !== n) return { status: 'unpaired', reason: `the source declares ${i} plot slot(s) and the capture holds ${n}` }
  return { status: 'ok', slots: out }
}

/**
 * ⭐ THE PAIRING, FAIL-CLOSED. The capture's slots are first matched to the source's calls (`captureSlotsOf`); the
 * VALUE slots (`plot`, `plotshape`, `plotchar`, `plotarrow`) are then paired with OUR value outputs, the n-th of the
 * one with the n-th of the other, used ONLY when our run emitted exactly as many and of the same calls in the same
 * order. Every other slot is LISTED (`notCompared`: its id and the call it serves), never dropped. Anything else is
 * `{status: 'unpaired', reason}` (the grade is INCONCLUSIVE), never paired by position anyway.
 * @param {{kind:string, points:({time, value}[]|null), missing?:string}[]} ourPlots our value outputs in the order the
 *   program emits them (`points: null`: our side carried no column for it, `missing` says why)
 * @returns {{status:'ok', series:object[], notCompared:{slot:string, what:string}[]} | {status:'unpaired', reason:string}}
 */
export function valueSeriesOf(capture, ourPlots) {
  const slots = captureSlotsOf(capture)
  if (slots.status !== 'ok') return slots
  const pv = capture.plotValues
  const values = slots.slots.filter((s) => s.value)
  const kinds = (xs) => xs.map((x) => x && x.kind).join(', ')
  if (!Array.isArray(ourPlots) || ourPlots.length !== values.length) {
    return { status: 'unpaired', reason: `our run emitted ${Array.isArray(ourPlots) ? ourPlots.length : 0} value output(s) and the capture holds ${values.length}` }
  }
  if (kinds(ourPlots) !== kinds(values)) {
    return { status: 'unpaired', reason: `our run emitted its value outputs as [${kinds(ourPlots)}] and the source declares [${kinds(values)}]` }
  }
  // an output our side carried no column for is not a series of `na`: nothing of ours exists to compare
  const missing = ourPlots.findIndex((p) => !Array.isArray(p.points))
  if (missing >= 0) {
    const s = values[missing]
    return { status: 'unpaired', reason: `our side carried no column for ${s.id} (${s.what}): ${ourPlots[missing].missing || 'no column'}` }
  }
  const series = values.map((s, k) => ({
    title: s.title,
    readsBroker: s.readsBroker,
    reference: pv.rows.map((r) => ({ time: r[0], value: r[s.column] === undefined ? null : r[s.column] })),
    ours: ourPlots[k].points,
  }))
  if (new Set(series.map((x) => x.title)).size !== series.length) return { status: 'unpaired', reason: 'two plots share one title' }
  return { status: 'ok', series, notCompared: slots.slots.filter((s) => !s.value).map((s) => ({ slot: s.id, what: s.what })) }
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
    // the capture's slots paired with a source call and not compared as a value (a colour, an alert condition):
    // present only when there are any, so a verdict of plots alone keeps its shape
    ...(v.ungradedValues && v.ungradedValues.length ? { ungradedValues: v.ungradedValues } : {}),
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
