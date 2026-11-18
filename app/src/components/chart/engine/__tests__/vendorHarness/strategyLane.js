// app/src/components/chart/engine/__tests__/vendorHarness/strategyLane.js
//
// ─── THE STRATEGY'S OUTPUT ON THE RUNTIME LANE, GRADED AS A MEMBER'S CHART RUNS IT (2026-11-17) ──────────
//
// A strategy's trades are its output (coordinator ruling 2026-11-16). With the strategy broker gate ON (the
// production build's default since #1664) the member door hands a strategy to the runtime lane as a BROKER
// document (`strategyWindow.js`), and the run publishes its strategy record beside its columns. This grades that
// record, and the report a member reads from it (`brokerReport.js::strategyReportOf`, on the COMMITTED pin
// ledger), against TradingView's own Strategy Tester answer with the ONE strategy grade
// (`strategyHarness.js::gradeStrategyCapture` -> `compare.mjs::gradeStrategy`): the trade list, the fills, the
// report slots, every plotted value and every drawn text.
//
// ⛔ ONE CODE PATH. The broker is armed the way production arms it: the gate's build flag, stubbed by the caller
// (`vendorHarness.corpus.test.js`, runtime-on), and the runtime lane's admission granted for the run. Nothing here
// builds, lowers or executes a program, passes `strategyBroker: true`, or widens the pin ledger (`brokerPinned`):
// the record is the one `ourSide.js::strategyRunOf` read back off the product's own columns (`computeFor`), on the
// window the binder hands (`ctx.historyWindowBars`). `strategyHarness.js::runOurBroker` answers the OTHER question
// (what our broker does when every rule may serve), which is what pins a rule; this answers what a member is shown.
//
// ⭐ THE FOLD (`foldStrategyGrade`). Where a capture holds a Strategy Tester report, or our door ran a broker
// document, the capture's verdict is the indicator grade AND the strategy grade: MATCH only when both are MATCH,
// DIVERGE when either is, INCONCLUSIVE otherwise. So a strategy capture can grade MATCH runtime-on only when its
// trades were run and agree:
//   * a broker document graded against a capture with NO report is INCONCLUSIVE (its output was never compared);
//   * a run stopped BY NAME (an unpinned or unsettled rule, a window it cannot start from) is INCONCLUSIVE,
//     refused on our side, exactly as a door refusal is (`EXPECTED-REFUSAL` / `UNGRADABLE` fold to it);
//   * a report capture whose script the door drew WITHOUT its broker (a host document, a plain runtime build) is
//     INCONCLUSIVE: the backtest the capture witnesses was not run.
// `verdictWithoutStrategy` keeps the indicator grade beside it, so both are read from ONE run.

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { isStrategyCapture } from '../../../../../../../tools/vendor_harness/strategy_capture.mjs'
import { gradeStrategyCapture, barsTradingViewRan, VALUE_SLOT_CALLS } from './strategyHarness.js'
import { strategyReportOf } from '../../runtime/brokerReport.js'
import { LANE_PRODUCTION, LANE_RUNTIME_ON } from '../../../../../../../tools/pine_coverage/runtime_lane.mjs'

const REPO = path.resolve(process.cwd(), '..')
/** `tools/vendor_harness/strategy_report_slots.json`: which Strategy Tester slot is which report metric (PINNED). */
export const STRATEGY_SLOT_MAP = JSON.parse(fs.readFileSync(path.join(REPO, 'tools/vendor_harness/strategy_report_slots.json'), 'utf8'))

/** Does this capture hold TradingView's Strategy Tester answer (a strategy capture with its report read,
 *  `tv_capture.js` v3 `provenance.report`)? A strategy captured before the report was read holds none. */
export function holdsStrategyReport(capture) {
  return isStrategyCapture(capture) && !!(capture.provenance && capture.provenance.report)
}

/** Every verdict the strategy grade can give, folded into the harness's three. */
export const threeOf = (v) => (v === 'MATCH' || v === 'DIVERGE' ? v : 'INCONCLUSIVE')

/**
 * The capture as TradingView's strategy RAN it. A STRATEGY capture whose value rows are exactly its bars but the
 * newest (`barsTradingViewRan`, the strategy grade's own rule: TradingView had not run a bar it had not
 * confirmed) is restricted to the bars before it, on BOTH sides: our side is handed those bars, and every grade
 * reads them. Any other capture is returned unchanged.
 * ⭐ (coordinator ruling 2026-11-18, (b)(i)) EVERY strategy capture, not only one holding a Strategy Tester report:
 * r1-strategy-draws-rddt-1d-2026-10-02 (no report) holds 636 bars and 635 value rows, its bar 635 closed three hours
 * before the capture (`newestBarIsForming: false`), and it graded DIVERGE on four plots there (TradingView: no row,
 * ours: a value). ⛔ The cut is keyed on the ROW BEING ABSENT, the newest bar only and only while the bar list holds
 * it (`barsTradingViewRan` checks every other row time for time): a row of `na` is compared, and a row missing
 * anywhere else is not cut. When TradingView confirms a closed daily bar for a strategy is an open question, the
 * parity roadmap's wall U-CONFIRM; until a capture pins it the engine does not guess.
 * @returns {{view: object, unrun: (number|null)}}
 */
export function strategyRanView(capture) {
  if (!isStrategyCapture(capture)) return { view: capture, unrun: null }
  const { unrun } = barsTradingViewRan(capture)
  if (unrun === null) return { view: capture, unrun: null }
  const rows = capture.bars.rows.slice(0, -1)
  // a bar FOLLOWS the view's newest, so the view's newest has finished (whatever the cut bar was)
  return { view: { ...capture, newestBarIsForming: false, bars: { ...capture.bars, rows, count: rows.length } }, unrun }
}

// ⚰️ (2026-11-17, strategy-epoch-bar-times) `recordOnCaptureClock` mapped each time the record stated from the
// product's bar KEY to the capture's bar time, because a daily chart's run recorded dates. The run now records each
// bar's opening instant (`runtimeColumns.js::brokerBarTimes`, the gate `time` reads), so the record is graded on ITS
// OWN times: a run that recorded a date, or an instant off TradingView's, now grades as what it is instead of being
// mapped onto TradingView's clock by the harness.

/** Our VALUE outputs (`plot`, `plotshape`, `plotchar`, `plotarrow`: `strategyHarness.js::VALUE_SLOT_CALLS`), in the
 *  order the source makes them, each `{kind, points: [{time, value}]}` on the capture's bars.
 *  ⛔ AN OUTPUT OUR SIDE CARRIED NO COLUMN FOR IS NOT `na` ON EVERY BAR: it is `{kind, points: null, missing}`, the
 *  door's own reason (`ourSide.js` `missingReason`), and the value grade cannot compare it (INCONCLUSIVE, named).
 *  ⚰️ (2026-11-17) read as all-`na`, supertrend-strategy's `mPlot` (a fill anchor the member pane does not carry)
 *  graded DIVERGE at step 7 against TradingView's `ohlc4`, a value our side never computed for the chart. */
export function laneValueOutputsOf(ours, capture) {
  const times = capture.bars.rows.map((r) => r[0])
  return (ours.plots || []).filter((p) => VALUE_SLOT_CALLS.has(p.kind)).map((p) => (p.column ? { kind: p.kind, points: times.map((time, i) => {
    const v = p.column[i]
    return { time, value: Number.isFinite(v) ? v : null }
  }) } : { kind: p.kind, points: null, missing: p.missingReason || 'our side carried no column for it' }))
}

/** The label texts the run drew, by bar time; or why they cannot be graded (`strategyHarness.js::drawnOf`'s rule). */
function drawnOf(s) {
  if (s.objectsWithheld) return { status: 'ungraded', reason: `our run withheld its drawings (${s.objectsWithheld.guard || 'by name'})` }
  const fin = s.objects
  if (!fin) return { status: 'ungraded', reason: 'the script draws nothing in our run' }
  if (fin.withheld && fin.withheld.label) return { status: 'ungraded', reason: `our run withheld its labels (${fin.withheld.label})` }
  const labels = []
  for (const o of fin.live || []) {
    if (o.family !== 'label') continue
    const x = o.props && o.props.x
    const time = Number.isInteger(x) && x >= 0 && x < s.unixAt.length ? s.unixAt[x] : null
    if (time === null || typeof o.props.text !== 'string') return { status: 'ungraded', reason: 'a label of ours has no bar or no text to compare' }
    labels.push({ time, text: o.props.text })
  }
  return { status: 'ok', labels }
}

/**
 * The product's run, in the shape `gradeStrategyCapture`'s `run` returns: `{ok, record, report, plots, drawn}` (the
 * record's times its own, plots and labels on the capture's bars), or `{ok: false, refusal}` with the name our side refused by (always `expected`: a refusal
 * by name is our side declining to answer, never a different answer).
 */
export function strategyLaneRunOf(capture, ours) {
  const refused = (guard, message) => ({ ok: false, refusal: { rule: guard, guard, expected: true, message: String(message || '') } })
  if (!ours) return refused('harness:invalid', 'the capture failed validation, so our side was not run')
  if (!ours.ok) return refused('door', 'the member door refused the script, so nothing was run')
  const s = ours.strategy
  if (!s) {
    return refused('harness:no-broker', "the member door drew this strategy without its broker, so its orders and backtest were not run")
  }
  if (!s.record) return refused(s.refusal.guard, s.refusal.message)
  const report = strategyReportOf(s.record)
  // ⭐ A REPORT REFUSED WHOLE is what the member reads (`StrategyReportPanel`: the refusal's sentence, no number):
  // our side declined to answer, by name, so nothing of it is compared (a withheld profit is not a different one)
  if (report.status !== 'ok') {
    const first = (report.refusals || [])[0] || {}
    return refused(first.guard || 'runtime:strategy-report', first.sentence || 'the strategy report refused')
  }
  return { ok: true, record: s.record, report, plots: laneValueOutputsOf(ours, capture), drawn: drawnOf(s), ruleFirstTime: null }
}

/**
 * The strategy grade of one capture on our side's run, or null when there is nothing to grade (neither a report
 * capture nor a broker document).
 * @param {object} capture  the capture as graded (`strategyRanView(...).view`)
 * @param {object|null} ours `ourSide.js::runOurSide`'s answer
 * @param {{slotMap?: object, unrun?: (number|null)}} [opts]
 */
export function strategyLaneGradeOf(capture, ours, { slotMap = STRATEGY_SLOT_MAP, unrun = null } = {}) {
  const report = holdsStrategyReport(capture)
  const broker = !!(ours && ours.ok && ours.strategy)
  if (!report && !broker) return null
  const base = { broker, ...(unrun !== null ? { newestBarNotRun: unrun } : {}) }
  if (!report) {
    const s = ours.strategy
    // what the run did, said beside the grade it could not have: a record (its trade count) or the refusal's name
    const ran = s.record ? { tradesRun: s.record.trades.length } : { refusedBy: s.refusal.guard, refusal: s.refusal.message.slice(0, 400) }
    return { ...base, ...ran, verdict: 'INCONCLUSIVE', step: 0, rulesExercised: [], graded: null,
      reason: "our side ran this strategy's broker, and the capture holds no Strategy Tester report to grade its trades (its output) against" }
  }
  const run = strategyLaneRunOf(capture, ours)
  const g = gradeStrategyCapture(capture, { slotMap, run: () => run })
  return {
    ...base,
    verdict: g.verdict,
    step: g.step,
    reason: g.reason,
    graded: g.graded ?? null,
    first: g.first ?? null,
    referenceTrades: g.referenceTrades ?? null,
    rulesExercised: g.rulesExercised || [],
    ungradedSlots: (g.ungradedSlots || []).map((u) => u.slot),
    ...(g.ungradedValues && g.ungradedValues.length ? { ungradedValues: g.ungradedValues.map((u) => u.slot) } : {}),
    ...(run.ok ? { tradesRun: run.record.trades.length } : { refusedBy: run.refusal.guard, refusal: run.refusal.message.slice(0, 400) }),
  }
}

/** The strategy broker gate's flag NAME, read off its module (`import.meta.env.<NAME> === '1'`), never typed. */
export function strategyBrokerFlag() {
  const src = fs.readFileSync(path.join(REPO, 'app/src/components/chart/engine/strategyBrokerGate.js'), 'utf8')
  const name = (src.match(/import\.meta\.env\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
  if (!name) throw new Error('strategyBrokerGate.js reads no VITE_ flag')
  return name
}

/**
 * What the STRATEGY lane did over one harness run: how many captures were graded on their trades (`strategy`
 * folded into the verdict), how many of those our door ran as a broker document, and the strategy verdicts.
 * `brokerGate` is the gate as read at COLLECTION, in the module state that graded.
 */
export function strategyEvidenceOf(run, { brokerGate }) {
  const graded = run.results.filter((r) => r.strategy)
  const verdicts = {}
  for (const r of graded) verdicts[r.strategy.verdict] = (verdicts[r.strategy.verdict] || 0) + 1
  return { brokerGate: !!brokerGate, graded: graded.length, brokerRuns: graded.filter((r) => r.strategy.broker).length, verdicts }
}

/** ⛔ THE STRATEGY LANE MEASURED IS THE ONE REQUESTED: runtime-on runs with the broker gate ON (as production's
 *  build does), and a run that graded strategy captures on their trades ran at least one broker document; the
 *  production lane (runtime dark) runs none. Throws, so the run writes nothing a later diff could trust. */
export function assertStrategyLaneMeasured({ requested, brokerGate, graded, brokerRuns }) {
  if (requested === LANE_RUNTIME_ON) {
    if (!brokerGate) {
      throw new Error('STRATEGY BROKER IS DARK: runtime-on was requested and the broker gate read OFF at collection, '
        + 'so no strategy reached its broker and every strategy capture would grade on its plots alone')
    }
    if (graded > 0 && brokerRuns === 0) {
      throw new Error(`STRATEGY BROKER NEVER RAN: ${graded} strategy capture(s) were graded on their trades and the `
        + 'member door ran no broker document for any of them')
    }
  }
  if (requested === LANE_PRODUCTION && brokerRuns > 0) {
    throw new Error(`THE PRODUCTION LANE RAN ${brokerRuns} BROKER DOCUMENT(S): the runtime lane is dark there`)
  }
  return `strategy lane: broker gate ${brokerGate ? 'ON' : 'off'}, ${graded} graded on their trades, ${brokerRuns} broker run(s)`
}

/** The capture's verdict with the strategy grade folded in (see THE FOLD above); `verdict` unchanged when null. */
export function foldStrategyGrade(verdict, strategy) {
  if (!strategy) return verdict
  const v = verdict.verdict
  const s = threeOf(strategy.verdict)
  const folded = v === 'DIVERGE' || s === 'DIVERGE' ? 'DIVERGE' : (v === 'MATCH' && s === 'MATCH' ? 'MATCH' : 'INCONCLUSIVE')
  return {
    ...verdict,
    verdict: folded,
    verdictWithoutStrategy: v,
    reason: `${verdict.reason}; strategy ${strategy.verdict} at step ${strategy.step}: ${strategy.reason}`,
    strategy,
  }
}
