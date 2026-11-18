// app/src/components/chart/engine/runtime/__tests__/strategyServe.js
//
// ─── SERVE OR REFUSE BY NAME: WHAT A MEMBER IS SHOWN FOR ONE STRATEGY, GATE ON ────────────────
//
// A MEASUREMENT HELPER, under `__tests__` on purpose: nothing in the bundle imports it, and it arms
// nothing. The caller stubs the flags (objects-only pane, runtime pane, the strategy broker) and the
// runtime lane's admission state; this follows ONE strategy source through the product path a member's
// chart takes, and says which of two states it lands in:
//
//   SERVED   the member door hands the chart a broker document (`strategyWindow.js`
//            `isStrategyWindowDefinition`), its run on the bars finishes with a strategy record, and
//            `brokerReport.js::strategyReportOf` answers `status: 'ok'`. Every metric the report SERVES is
//            re-checked here against the committed pin ledger (the rules its value rests on: the run's
//            `rulesUsed`, B-VAL, and for anything but a count the commission's rules), and the panel
//            (`StrategyReportPanel.jsx`) is rendered so every cell a member reads is a number or a sentence.
//   REFUSED  by name, at one of four places, each with the sentence the member reads:
//              door      the member door refuses the script (`memberPaneDefinition` `reason`);
//              run       the broker run stops at a rule (`runtime:strategy-unpinned`, `-unsettled`, ...): the
//                        chart's strip reads `nativeRegistry.runtimeRunStopOf`'s sentence over the run's reason;
//              report    the run finished and the report refuses whole (its `refusals[].sentence`);
//              no-backtest  the door kept a document that does NOT run the broker (a plain host or runtime
//                        document: the broker build declined, or the runtime lane declined the script), and the
//                        member reads that the strategy's orders and backtest are not run
//                        (`importOutcome.js`, the `pine:strategy-chart` note every host strategy carries).
//
// ⛔ THERE IS NO THIRD STATE. Anything else is returned as `third` with what failed: a served metric whose
// rules are not all pinned, a refusal with no sentence, a cell with nothing in it, a guard id in the DOM, a
// strategy whose backtest is silently absent. The census rails assert `third` is empty.
import { createElement } from 'react'
import { render, cleanup, fireEvent } from '@testing-library/react'

import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns } from '../runtimeColumns'
import { runtimeStrategyOf } from '../strategyRecord'
import { strategyReportOf, SERVED_METRICS } from '../brokerReport.js'
import { commissionRulesOf } from '../brokerRules.js'
import RESOLVED from '../brokerPins.resolved.json'
import { isStrategyWindowDefinition } from '../../strategyWindow'
import { withoutGuardIds, GUARD_ID_SOURCE } from '../../ast/guardIdText'
import { importOutcome } from '../../ast/importOutcome'

export const SERVE_SCHEMA = 'uct.strategy-serve/v1'
const DEF_ID = 'u_strategy-serve-audit'
const short = (s, n = 300) => (s == null ? null : String(s).slice(0, n))
const GUARD_ID = new RegExp(GUARD_ID_SOURCE)
const PINNED = new Set(Object.keys((RESOLVED && RESOLVED.rules) || {}))

/** The rules a SERVED metric of kind `kind` rests on (brokerReport.js `rulesFor`, re-derived here, not imported). */
export function rulesBehind(rec, kind) {
  const capital = kind === 'percent' && (rec.settings.defaulted || []).includes('initialCapital') ? ['B-DEFAULTS'] : []
  return [...new Set([...(rec.rulesUsed || []), 'B-VAL', ...(kind === 'count' ? [] : commissionRulesOf(rec.settings.commission)),
    ...capital])].sort()
}

/** A member sentence is present when, guard ids removed, words remain. */
const said = (s) => typeof s === 'string' && withoutGuardIds(s).trim().length > 0

/** What the chart's disclosure strip reads for a run that computed nothing (`nativeRegistry.runtimeRunStopOf`). */
const runStopSentence = (guard, message) => `not drawn on this chart (${guard}): ${String(message || '').trim() || 'the per-bar run computed nothing'}`

/** Render the panel and read every cell a member sees, on every tab. `Panel` is `pane/StrategyReportPanel.jsx`,
 *  handed in by the test file: the panel has ONE mount in product code (`strategyReportPanel.test.jsx`), and a helper
 *  outside a `.test.` file that imported it would count as a second. */
function panelCells(Panel, report, name) {
  const out = { rows: 0, served: 0, refused: 0, empty: [], guardIds: [], trades: 0, tradeCellsEmpty: [] }
  const { container, getAllByRole, unmount } = render(createElement(Panel, { report, name }))
  try {
    const tabs = getAllByRole('tab')
    for (const tab of tabs) {
      fireEvent.click(tab)
      for (const row of container.querySelectorAll('[data-testid^="strategy-report-metric-"]')) {
        out.rows += 1
        const cell = row.querySelector('td')
        const text = cell ? cell.textContent.trim() : ''
        if (row.getAttribute('data-status') === 'served') out.served += 1
        else out.refused += 1
        if (!text) out.empty.push(row.getAttribute('data-testid'))
      }
      for (const tr of container.querySelectorAll('[data-testid^="strategy-report-trade-"]')) {
        out.trades += 1
        const tds = [...tr.querySelectorAll('td')]
        // the exit columns of an OPEN trade are blank by design (no exit yet); every other cell holds text
        const open = tr.textContent.includes('Open')
        tds.forEach((td, i) => {
          const exitCol = i === 5 || i === 7
          if (!td.textContent.trim() && !(open && exitCol)) out.tradeCellsEmpty.push(`${tr.getAttribute('data-testid')}#${i}`)
        })
      }
    }
    const text = container.textContent || ''
    const m = text.match(GUARD_ID)
    if (m) out.guardIds.push(m[0])
  } finally {
    unmount()
    cleanup()
  }
  return out
}

/**
 * @param {object} p
 * @param {string} p.source
 * @param {object[]} p.bars  `{t, o, h, l, c, v}`, oldest first
 * @param {object} p.ctx     the run context (`tf`, `symbol`, `newestBarIsForming`, `historyFromListing`, `historyWindowBars`)
 * @param {Function} p.Panel  `pane/StrategyReportPanel.jsx`'s default export (the test file imports it)
 */
export function strategyServeOutcome({ source, bars, ctx, Panel }) {
  const out = { schema: SERVE_SCHEMA, state: null, at: null, guard: null, rule: null, row: null, sentence: null,
    runtimeDeclined: null, served: null, third: [] }
  const refused = (at, guard, sentence, extra = {}) => {
    Object.assign(out, { state: 'refused', at, guard: guard || null, sentence: short(sentence), ...extra })
    if (!said(sentence)) out.third.push(`${at}: refused with no member sentence`)
    if (out.third.length) out.state = 'third'
    return out
  }
  let d
  try {
    d = memberPaneDefinition({ source, id: DEF_ID, name: 'audit' })
  } catch (err) {
    out.third.push(`door threw: ${short((err && err.message) || err, 120)}`)
    out.state = 'third'
    return out
  }
  if (d.runtimeDeclined) out.runtimeDeclined = { code: d.runtimeDeclined.code, why: short(d.runtimeDeclined.why, 160) }
  if (!d.ok) return refused('door', d.guard, d.reason)
  const def = d.definition
  if (!isStrategyWindowDefinition(def)) {
    // the chart draws a document that does not run the broker: what tells the member the backtest is not run?
    // two surfaces say it: the member pane's own disclosures (`d.notes`, rendered verbatim by MemberPane), and
    // the import verdict of the translation the door drew from (`importOutcome`, the PineBox line above it)
    out.lane = d.lane || null
    const paneNote = (d.notes || []).find((n) => n && /backtest/.test(String(n.note)))
    if (paneNote) return refused('no-backtest', paneNote.guard || null, `${paneNote.name}: ${paneNote.note}`, { surface: 'pane' })
    const t = d.translation || {}
    const verdict = importOutcome({ ...t, ignored: t.ignored || t.notes || [], dialect: 'pine' })
    const part = d.lane === 'runtime' ? null : (verdict.missing || []).find((m) => /backtest/.test(String(m.name)))
    if (!part) {
      out.state = 'third'
      out.third.push(`no-backtest: the chart draws a ${d.lane || 'host'} document without the broker and nothing names the backtest as not run`)
      return out
    }
    return refused('no-backtest', part.guard, `${part.name}: ${part.message}`, { surface: 'import' })
  }
  let cols
  let installedOk = false
  try {
    const { installed, errors } = registry.installUserDefinitions([def])
    if (!installed || !installed[0]) {
      return refused('door', 'door:not-installed', `the install door refused the document: ${short((errors || []).join(' | '))}`)
    }
    installedOk = true
    cols = computeRuntimeColumns(installed[0], bars, ctx)
  } catch (e) {
    const guard = (e && (e.guard || e.code)) || 'runtime:error'
    return refused('run', guard, runStopSentence(guard, e && e.message),
      { rule: (e && e.rule) || null, row: (e && (e.capture || e.probe)) || null })
  } finally {
    if (installedOk) { try { registry.uninstallUserDefinition(DEF_ID) } catch { /* nothing installed */ } }
  }
  // ⭐ Engine 76 (#1803, fix/strategy-refusal-keeps-plots) — what the member SEES beside the backtest: the drawn plots
  // whose column holds a value on some bar (a backtest refused by name keeps them, `runtimeColumns.js::disarmedAfter`)
  out.plotsDrawn = (def.plots || []).filter((p) => p && p.hidden !== true && Array.isArray(cols[p.key])
    && cols[p.key].some((v) => Number.isFinite(v))).length
  const rec = runtimeStrategyOf(cols)
  if (!rec) {
    out.state = 'third'
    out.third.push('run: a broker document ran and published no strategy record')
    return out
  }
  const report = strategyReportOf(rec)
  if (report.status !== 'ok') {
    const s = (report.refusals || []).map((r) => r && r.sentence).filter(Boolean)
    const first = (report.refusals || [])[0] || {}
    if ((report.refusals || []).some((r) => !said(r && r.sentence))) out.third.push('report: a run-wide refusal with no sentence')
    return refused('report', first.guard, s.join(' | '), { rule: first.rule || null, row: first.row || first.probe || null })
  }
  // ⭐ SERVED: every number re-checked against the committed ledger, every refusal carries its sentence
  const served = { trades: rec.trades.length, rulesUsed: [...rec.rulesUsed].sort(), metrics: {}, withheld: {}, tradeList: null,
    unpinnedServed: [] }
  for (const [key, m] of Object.entries(report.metrics || {})) {
    if (m && m.status === 'served') {
      const kind = SERVED_METRICS[key] ? SERVED_METRICS[key].kind : null
      if (!kind) { out.third.push(`metric ${key}: served but not a SERVED_METRICS key`); continue }
      const missing = rulesBehind(rec, kind).filter((id) => !PINNED.has(id))
      if (missing.length) served.unpinnedServed.push(`${key}<-${missing.join('+')}`)
      if (!Number.isFinite(m.value)) out.third.push(`metric ${key}: served with no finite value`)
      served.metrics[key] = m.value
    } else {
      if (!said(m && m.sentence)) out.third.push(`metric ${key}: withheld with no sentence`)
      served.withheld[key] = (m && m.guard) || null
    }
  }
  if (served.unpinnedServed.length) out.third.push(`served on an unpinned rule: ${served.unpinnedServed.join(', ')}`)
  const tl = report.trades
  if (tl && tl.status === 'served') {
    const profitRules = rulesBehind(rec, 'money')
    let profitServed = 0
    for (const r of tl.rows) {
      if (r.profit && r.profit.status === 'served') {
        profitServed += 1
        const miss = profitRules.filter((id) => !PINNED.has(id))
        if (miss.length) out.third.push(`trade ${r.n} profit served on an unpinned rule: ${miss.join('+')}`)
      } else if (!said(r.profit && r.profit.sentence)) out.third.push(`trade ${r.n} profit withheld with no sentence`)
      for (const sig of [r.entrySignal, r.exitSignal]) {
        if (sig && sig.status !== 'served' && !said(sig.sentence)) out.third.push(`trade ${r.n} signal withheld with no sentence`)
      }
    }
    const listMissing = served.rulesUsed.filter((id) => !PINNED.has(id))
    if (listMissing.length) out.third.push(`trade list served on an unpinned rule: ${listMissing.join('+')}`)
    served.tradeList = { status: 'served', rows: tl.rows.length, profitServed }
  } else {
    if (!said(tl && tl.sentence)) out.third.push('trade list withheld with no sentence')
    served.tradeList = { status: 'refused', guard: (tl && tl.guard) || null }
  }
  if (!said(report.window && report.window.sentence)) out.third.push('the D2 start sentence is missing')
  if (typeof Panel !== 'function') out.third.push('the panel was not handed in, so what a member reads is unchecked')
  else {
    const cells = panelCells(Panel, report, 'audit')
    served.panel = { rows: cells.rows, served: cells.served, refused: cells.refused, trades: cells.trades }
    if (cells.empty.length) out.third.push(`panel cells with nothing in them: ${cells.empty.slice(0, 5).join(', ')}`)
    if (cells.tradeCellsEmpty.length) out.third.push(`trade cells with nothing in them: ${cells.tradeCellsEmpty.slice(0, 5).join(', ')}`)
    if (cells.guardIds.length) out.third.push(`a guard id reached the DOM: ${cells.guardIds[0]}`)
  }
  out.state = out.third.length ? 'third' : 'served'
  out.served = served
  return out
}
