// app/src/components/chart/engine/runtime/__tests__/strategyRefusalKeepsPlots.test.js
//
// ─── ⭐⭐ Engine 76 (#1803, fix/strategy-refusal-keeps-plots) — THE BROKER REFUSED BY NAME: THE PLOTS STAY ──────
//
// Owner rule (coordinator ruling 2026-11-18): an admission must NEVER take away what a member sees today. With the
// strategy broker gate on, the member door hands an order-placing strategy to the runtime lane as a BROKER document
// (`strategyWindow.js`). When that document's run refuses by name on a chart (supertrend-strategy on SPY daily: the
// chart holds the most recent 5,000 of 8,509 bars, so the backtest cannot start at the listing, [B-START] Q-S1n),
// the member lost the seven plots and the bar colours the host lane draws on the same chart today.
//
// Now (`runtimeColumns.js::disarmedAfter`, `vm.js` `brokerDisarmed`): the same program runs again without its broker
// (an order places nothing; every bar is run, as the host lane runs it), its plots and paints are drawn, and the
// backtest ALONE is refused, by the broker's own name, in the member's words (`strategyRecord.js::
// refusedStrategyRecordOf`). A program whose outputs READ the broker cannot stand in: the member reads the broker's
// refusal exactly as before.
//
// ⭐⭐ Engine 77 (#1833, fix/strategy-disarmed-taint): WHAT the stand-in run draws is decided statically by the host
// lane's own taint (`strategyTaint.js::strategyDisarmOf`): a plot a broker value reaches is withheld BY NAME, never
// drawn from the `na` the disarmed run reads in the broker's place. Its rails: `strategyDisarmedTaint.test.js`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../../runtimeKill'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import * as registry from '../../nativeRegistry'
import { computeRuntimeColumns } from '../runtimeColumns'
import { runtimeStrategyOf, strategyRecordShapeErrors, backtestRefusedSentence, BACKTEST_FORMING_SENTENCE } from '../strategyRecord'
import { BrokerUnpinned } from '../broker.js'
import { pinned } from '../brokerPins.js'
import { strategyReportOf } from '../brokerReport.js'
import { isStrategyWindowDefinition } from '../../strategyWindow'
import { loadCapture } from '../../__tests__/vendorHarness/harness.js'
import { toProductBars } from '../../__tests__/vendorHarness/ourSide.js'
import { historyWindowBarsOf } from './strategyArmed.js'
import { storeExchangeOfCapture } from '../../__tests__/vendorHarness/storeExchange.js'
import { GUARD_ID_SOURCE } from '../../ast/guardIdText'
import { strategyServeOutcome } from './strategyServe.js'
import StrategyReportPanel from '../../../pane/StrategyReportPanel'

vi.setConfig({ testTimeout: 300000 })

const ROOT = path.resolve(process.cwd(), '..')
const GATE = (f) => fs.readFileSync(path.resolve(process.cwd(), `src/components/chart/engine/${f}`), 'utf8')
const FLAGS = ['objectsOnlyPaneGate.js', 'runtimePaneGate.js', 'strategyBrokerGate.js']
  .map((f) => (GATE(f).match(/(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1])
const SUPERTREND = fs.readFileSync(path.join(ROOT, 'corpus/committed/supertrend-strategy__rcRbtoBiKG.pine'), 'utf8')
const SPY = loadCapture(path.join(ROOT, 'tests/fixtures/vendor/harness/supertrend-strategy-spy-1d-2026-10-02.json')).capture
const RDDT = loadCapture(path.join(ROOT, 'tests/fixtures/vendor/harness/supertrend-strategy-rddt-1d-2026-10-02.json')).capture
const DEF_ID = 'u_strategy-refusal-keeps-plots'
const PLOT_TITLES = ['Up Trend', 'UpTrend Begins', 'Buy', 'Down Trend', 'DownTrend Begins', 'Sell']

/** The member door's document for `source`, installed, and its columns on `capture`'s bars as a member's daily chart
 *  hands them (ISO date keys), from the listing or not as the capture says. */
function runOn(source, capture) {
  const d = memberPaneDefinition({ source, id: DEF_ID, name: 'refusal keeps plots' })
  expect(d.ok, d.reason).toBe(true)
  expect(isStrategyWindowDefinition(d.definition), 'the door did not mint the broker document').toBe(true)
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(installed && installed[0], (errors || []).join(' | ')).toBeTruthy()
  try {
    const bars = toProductBars(capture)
    const ctx = { tf: 'D', symbol: { ticker: capture.symbol.name, exchange: storeExchangeOfCapture(capture, capture.symbol.exchange) || capture.symbol.exchange }, newestBarIsForming: false,
      historyFromListing: !!(capture.history && capture.history.startsAtBar0 === true), historyWindowBars: historyWindowBarsOf(ROOT) }
    return { d, bars, cols: computeRuntimeColumns(installed[0], bars, ctx) }
  } finally {
    registry.uninstallUserDefinition(DEF_ID)
  }
}
const rowKeys = (d) => Object.fromEntries((d.definition.plots || []).filter((p) => p.hidden !== true).map((p) => [p.label, p.key]))
const drawnBars = (col) => (col || []).filter((v) => Number.isFinite(v)).length

describe('a broker run refused by name keeps the plots; the backtest alone is refused', () => {
  beforeEach(() => {
    for (const f of FLAGS) vi.stubEnv(f, '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
  })
  afterEach(() => { vi.unstubAllEnvs(); __resetRuntimeAllowList() })

  it('⭐ supertrend-strategy on SPY daily (not from the listing): its plots are drawn, the backtest refused by name', () => {
    expect(SPY.history && SPY.history.startsAtBar0).not.toBe(true)
    const { d, bars, cols } = runOn(SUPERTREND, SPY)
    const keys = rowKeys(d)
    // every plot TradingView draws on this chart is drawn here, with values on the bars it has them
    for (const t of PLOT_TITLES) expect(keys[t], t).toBeTruthy()
    expect(drawnBars(cols[keys['Up Trend']])).toBeGreaterThan(100)
    expect(drawnBars(cols[keys['Down Trend']])).toBeGreaterThan(100)
    expect(cols[keys['Up Trend']]).toHaveLength(bars.length)
    // ...and every column the document maps (the plots, the bar colour's paint column) is computed on every bar
    const mapped = Object.keys((d.definition.compute && d.definition.compute.outputs) || {})
    expect(mapped.length).toBeGreaterThanOrEqual(PLOT_TITLES.length + 1)
    for (const k of mapped) expect(cols[k], k).toHaveLength(bars.length)
    // the backtest: a valid record holding ONE run-wide refusal, by the broker's name, in the member's words
    const rec = runtimeStrategyOf(cols)
    expect(rec).toBeTruthy()
    expect(strategyRecordShapeErrors(rec)).toEqual([])
    expect(rec.trades).toEqual([])
    expect(rec.refusals).toEqual([expect.objectContaining({ guard: 'runtime:strategy-unsettled', rule: 'Q-S1n' })])
    expect(rec.refusals[0].sentence).toBe(`The backtest is not run on this chart: it needs this symbol's history from its first bar, and this chart holds its most recent ${bars.length} bars. The script's plots are drawn.`)
    expect(new RegExp(GUARD_ID_SOURCE).test(rec.refusals[0].sentence)).toBe(false)
    const report = strategyReportOf(rec)
    expect(report.status).toBe('refused')
    expect(report.refusals[0].sentence).toBe(rec.refusals[0].sentence)
  })

  it('⭐ the serve census\'s own outcome on SPY daily: supertrend-strategy keeps its seven plots, the backtest refused by name', () => {
    const o = strategyServeOutcome({ source: SUPERTREND, bars: toProductBars(SPY), Panel: StrategyReportPanel,
      ctx: { tf: 'D', symbol: { ticker: 'SPY', exchange: storeExchangeOfCapture(SPY, 'AMEX') }, newestBarIsForming: false,
        historyFromListing: false, historyWindowBars: historyWindowBarsOf(ROOT) } })
    expect(o.third).toEqual([])
    expect(o).toMatchObject({ state: 'refused', at: 'report', guard: 'runtime:strategy-unsettled', rule: 'Q-S1n' })
    expect(o.sentence).toMatch(/^The backtest is not run on this chart: it needs this symbol's history from its first bar/)
    // the plots a member sees are the ones the broker's own run draws where it runs (RDDT daily, from the listing):
    // Up Trend, Down Trend and the two trend-start markers hold values (Buy / Sell are `na` while `showsignals` is off)
    const served = strategyServeOutcome({ source: SUPERTREND, bars: toProductBars(RDDT), Panel: StrategyReportPanel,
      ctx: { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, historyFromListing: true,
        historyWindowBars: historyWindowBarsOf(ROOT) } })
    expect(served.state).toBe('served')
    expect(o.plotsDrawn).toBeGreaterThanOrEqual(4)
    expect(o.plotsDrawn).toBe(served.plotsDrawn)
  })

  // ⭐ (2026-11-18, engine 80, #1902) [B-EXEC] — the newest bar still forming: the member reads the wait for the close,
  // never "a strategy rule that no comparison with TradingView has confirmed yet"
  it('⭐ [B-EXEC]: a backtest refused because the newest bar is still forming says so, in the coordinator\'s words', () => {
    expect(BACKTEST_FORMING_SENTENCE).toBe("The backtest isn't run while the newest bar is still forming. It runs on the closed bars once that bar has closed.")
    expect(backtestRefusedSentence(new BrokerUnpinned('B-EXEC'), 669, 0))
      .toBe(`${BACKTEST_FORMING_SENTENCE} The script's plots are drawn.`)
    expect(backtestRefusedSentence(new BrokerUnpinned('B-EXEC'), 669, 2))
      .toBe(`${BACKTEST_FORMING_SENTENCE} The script's plots are drawn, except those that show the backtest's own values.`)
    // CONTROL: any other unpinned rule keeps its sentence
    expect(backtestRefusedSentence(new BrokerUnpinned('B-EXIT-NA'), 669, 0))
      .toBe("The backtest is not run on this chart: it rests on a strategy rule that no comparison with TradingView has confirmed yet. The script's plots are drawn.")
    // the member's in-session chart, through the census's own outcome: the sentence while [B-EXEC] is unpinned, the
    // backtest served once a capture pins it (derived from the ledger production reads, never restated)
    const o = strategyServeOutcome({ source: SUPERTREND, bars: toProductBars(RDDT), Panel: StrategyReportPanel,
      ctx: { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: true, historyFromListing: true,
        historyWindowBars: historyWindowBarsOf(ROOT) } })
    if (pinned('B-EXEC')) {
      expect(o.state).toBe('served')
    } else {
      expect(o).toMatchObject({ state: 'refused', at: 'report', guard: 'runtime:strategy-unpinned', rule: 'B-EXEC' })
      expect(o.sentence).toBe(`${BACKTEST_FORMING_SENTENCE} The script's plots are drawn.`)
      expect(new RegExp(GUARD_ID_SOURCE).test(o.sentence)).toBe(false)
    }
  })

  it('CONTROL: on RDDT daily from the listing the broker runs: plots drawn AND the backtest served (no refusal)', () => {
    expect(RDDT.history.startsAtBar0).toBe(true)
    const { d, cols } = runOn(SUPERTREND, RDDT)
    expect(drawnBars(cols[rowKeys(d)['Up Trend']])).toBeGreaterThan(100)
    const rec = runtimeStrategyOf(cols)
    expect(rec.refusals).toEqual([])
    expect(rec.trades.length).toBeGreaterThan(5)
    expect(strategyReportOf(rec).status).toBe('ok')
  })

  it('⛔ a strategy whose EVERY plot shows a broker value: a stand-in would draw nothing, so the broker\'s refusal stands', () => {
    const reads = `//@version=5
strategy("reads the broker", overlay = false)
if ta.crossover(ta.sma(close, 5), ta.sma(close, 20))
    strategy.entry("L", strategy.long)
if ta.crossunder(ta.sma(close, 5), ta.sma(close, 20))
    strategy.close("L")
plot(strategy.position_size, "Position")
`
    let thrown = null
    try { runOn(reads, SPY) } catch (e) { thrown = e }
    expect(thrown, 'a plot of a broker value was drawn without the broker').toBeTruthy()
    expect(thrown.guard).toBe('runtime:strategy-unsettled')
  })
})
