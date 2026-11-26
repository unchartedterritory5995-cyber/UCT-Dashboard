// A written strategy the broker would refuse is never "runs" (2026-11-26, coordinator ruling 1, step 2: THE GATE).
//
// The check of a written script passed a strategy whose broker refused it by name whenever its plots could stand in:
// the refusal lived only in the strategy record, which the check never read. The case: supertrend-strategy on SPY daily,
// where the chart holds the most recent bars and not the listing, so the backtest cannot start ([B-START], the record's
// refusal). The control: the same script on RDDT from its listing, which the broker serves.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../../engine/runtimeKill'
import { STRATEGY_DECLARATION } from '../memberPane/memberPaneDefinition'
import { loadCapture } from '../../engine/__tests__/vendorHarness/harness.js'
import { toProductBars } from '../../engine/__tests__/vendorHarness/ourSide.js'
import { storeExchangeOfCapture } from '../../engine/__tests__/vendorHarness/storeExchange.js'
import { historyWindowBarsOf, armedStrategyVerdict as censusPredicate } from '../../engine/runtime/__tests__/strategyArmed.js'
import { resetStrategyHistoryWindow, loadStrategyHistoryWindow } from '../../engine/strategyWindow'
import * as gate from './strategyGate'
import { checkScript, STRATEGY_SOURCE, SCRIPT_REFUSAL_LIMITS } from './scriptAnswer'
import { verdictOnChart } from '../runsHere'

vi.setConfig({ testTimeout: 300000 })

const ROOT = path.resolve(process.cwd(), '..')
const GATE_SRC = (f) => fs.readFileSync(path.resolve(process.cwd(), `src/components/chart/engine/${f}`), 'utf8')
const FLAGS = ['objectsOnlyPaneGate.js', 'runtimePaneGate.js', 'strategyBrokerGate.js']
  .map((f) => (GATE_SRC(f).match(/(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1])
const SUPERTREND = fs.readFileSync(path.join(ROOT, 'corpus/committed/supertrend-strategy__rcRbtoBiKG.pine'), 'utf8')
const SPY = loadCapture(path.join(ROOT, 'tests/fixtures/vendor/harness/supertrend-strategy-spy-1d-2026-10-02.json')).capture
const RDDT = loadCapture(path.join(ROOT, 'tests/fixtures/vendor/harness/supertrend-strategy-rddt-1d-2026-10-02.json')).capture
const INDICATOR = '//@version=5\nindicator("ema", overlay=true)\nplot(ta.ema(close, 20))\n'

/** A member's daily chart of `capture`, as the check is handed it (no strategy window: the chart object has none). */
function chartOf(capture) {
  return { bars: toProductBars(capture), ctx: { tf: 'D', symbol: { ticker: capture.symbol.name,
    exchange: storeExchangeOfCapture(capture, capture.symbol.exchange) || capture.symbol.exchange }, newestBarIsForming: false,
    historyFromListing: !!(capture.history && capture.history.startsAtBar0 === true) } }
}
/** The window the server answers, primed into the tab as `GET /api/pine/history-window` would. */
async function primeWindow() {
  const w = historyWindowBarsOf(ROOT)
  await loadStrategyHistoryWindow(async () => ({ ok: true, json: async () => ({ historyWindowBars: w }) }))
  return w
}
/** The paste check passes and the run on the chart draws (`runHere` RAN): only the gate can take "runs" away. */
function passingLoad(engine = { strategyGate: gate }) {
  return async () => ({
    inspectSource: () => ({}), memberPaneDefinition: () => ({ ok: true, definition: {} }),
    editorStatus: () => ({ state: 'runs', headline: 'Runs on the chart', items: [] }),
    prepare: async () => {}, judgeOffThread: null, consultPending: () => false, pendingReason: () => null,
    runHereWhenLanded: async () => ({ state: 'ran', stops: [], unchecked: [], waiting: [], notes: [] }),
    verdictOnChart, ...engine,
  })
}

describe('the gate a written strategy passes', () => {
  beforeEach(async () => {
    for (const f of FLAGS) vi.stubEnv(f, '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    resetStrategyHistoryWindow()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    __resetRuntimeAllowList()
    resetStrategyHistoryWindow()
  })

  it('ONE authority: the census reads the product predicate, and the declaration test is the door\'s', () => {
    expect(censusPredicate).toBe(gate.armedStrategyVerdict)
    expect(STRATEGY_SOURCE.source).toBe(STRATEGY_DECLARATION.source)
    expect(STRATEGY_SOURCE.flags).toBe(STRATEGY_DECLARATION.flags)
  })

  it('THE CASE: a strategy the broker refuses by name (plots standing in) is never "runs"', async () => {
    await primeWindow()
    const chart = await gate.withStrategyWindow(chartOf(SPY))
    const armed = gate.armedStrategyVerdict({ source: SUPERTREND, door: gate.PASTE_CHECK_PASSED, bars: chart.bars, ctx: chart.ctx })
    expect(armed.transfers, JSON.stringify(armed)).toBe(false)
    expect(armed.wall).toMatch(/^run:runtime:strategy-/)
    const v = await checkScript(SUPERTREND, { load: passingLoad(), chart: chartOf(SPY) })
    expect(v.runs).toBe(false)
    expect(v.headline).toBe(gate.STRATEGY_REFUSED_HEADLINE)
    expect(v.strategyWall).toBe(armed.wall)
    expect(v.errors).toHaveLength(1)
    expect(v.errors[0].startsWith(`${gate.STRATEGY_WALL_MARK} ${armed.wall}`)).toBe(true)
    expect(v.errors[0].length).toBeLessThanOrEqual(SCRIPT_REFUSAL_LIMITS.maxChars)
  })

  it('CONTROL: the same strategy on a chart from its listing transfers, and keeps "runs"', async () => {
    await primeWindow()
    const chart = await gate.withStrategyWindow(chartOf(RDDT))
    const armed = gate.armedStrategyVerdict({ source: SUPERTREND, door: gate.PASTE_CHECK_PASSED, bars: chart.bars, ctx: chart.ctx })
    expect(armed.transfers, JSON.stringify(armed)).toBe(true)
    const v = await checkScript(SUPERTREND, { load: passingLoad(), chart: chartOf(RDDT) })
    expect(v.runs).toBe(true)
    expect(v.strategyWall).toBeUndefined()
  })

  it('the strategy window is handed to the run, as the binder hands it', async () => {
    const w = await primeWindow()
    const chart = await gate.withStrategyWindow(chartOf(RDDT))
    expect(chart.ctx.historyWindowBars).toBe(w)
    resetStrategyHistoryWindow()
    const none = await gate.withStrategyWindow(chartOf(RDDT), { load: async () => null })
    expect(none.ctx.historyWindowBars).toBeUndefined()                 // unknown: unchanged, the run says so by name
  })

  it('CONTROL: an indicator never reaches the gate (an engine with no gate is never asked)', async () => {
    const v = await checkScript(INDICATOR, { load: passingLoad({}), chart: chartOf(RDDT) })
    expect(v.runs).toBe(true)
  })
})
