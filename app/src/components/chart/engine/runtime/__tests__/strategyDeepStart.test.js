// app/src/components/chart/engine/runtime/__tests__/strategyDeepStart.test.js
//
// ─── THE STRATEGY-ONLY DAILY WINDOW: A RUN FROM THE LISTING DEEPER THAN THE SHARED WINDOW (2026-11-19) ──────────
//
// Coordinator ruling (D9, strategy-only; the owner may veto): a DAILY chart running a strategy holds the stock's whole
// daily history (`barsBackfill.js::fullBarsFor('D')`, pinned equal to `bars_window.STRATEGY_HISTORY_WINDOW_BARS`) and
// its broker run starts at the listing over that window. SERVING it stays refused by name until a TradingView capture
// witnesses where its backtest starts on such a chart (rows Q-SU-7 / Q-SU-8): the run asks the broker rule
// [B-START-DEEP] whenever it covers more bars from the listing than the depth served before (`listingDepthBars`, the
// shared `bars_window.HISTORY_WINDOW_BARS`, which the endpoint answers beside the strategy window), and while the
// ledger does not pin it the backtest is refused BY NAME (the plots stay). A run no caller hands that depth runs exactly
// as before. Nothing below the shared depth asks the rule: every chart served today is served the same.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { BROKER_RULES } from '../brokerRules.js'
import { pinned } from '../brokerPins.js'
import {
  windowOfPayload, listingDepthOfPayload, strategyNeedsFullDailyHistory, isStrategyWindowDefinition,
  loadStrategyHistoryWindow, resetStrategyHistoryWindow, strategyHistoryWindowNow, strategyListingDepthNow,
} from '../../strategyWindow'
import { STRATEGY_WINDOW_HISTORY } from '../strategyRecord.js'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'
import { loadCapture } from '../../__tests__/vendorHarness/harness.js'
import { toProductBars } from '../../__tests__/vendorHarness/ourSide.js'
import { chartStrategyWindowOf, historyWindowBarsOf, strategyWindowBarsOf } from './strategyArmed.js'
import { strategyServeOutcome } from './strategyServe.js'
import StrategyReportPanel from '../../../pane/StrategyReportPanel'

vi.setConfig({ testTimeout: 300000 })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const ROOT = path.resolve(process.cwd(), '..')
const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }
const T0 = 1700000000
const DAY = 86400
const ALL = () => true
const except = (...ids) => (id) => !ids.includes(id)
const bars12 = Array.from({ length: 12 }, (_, i) => ({ t: T0 + i * DAY, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1000 }))
const SRC = '//@version=6\nstrategy("t", initial_capital = 100000, default_qty_type = strategy.fixed, default_qty_value = 1, '
  + 'margin_long = 0, margin_short = 0)\nif bar_index == 3\n    strategy.entry("L", strategy.long)\nplot(strategy.position_size)\n'

const attempt = ({ win, depth, pins = ALL, bars = bars12 }) => {
  const built = buildRuntimeIr(SRC, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  const program = lowerIrProgram(built.ir, { historyFromListing: true })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const ctx = { bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
    historyWindowBars: win, minContract: 1, ...(depth === undefined ? {} : { listingDepthBars: depth }) }
  try {
    const res = execute(program, ctx, undefined, { brokerPinned: pins })
    return { used: res.broker.record.rulesUsed, trades: res.broker.record.trades, firsts: res.broker.ruleFirstBars }
  } catch (e) { return { err: e } }
}

describe('[B-START-DEEP] the rule and the run', () => {
  it('is a named rule with its capture row (Q-S1n), and the committed ledger does NOT pin it (serving waits on Q-SU-7 / -8)', () => {
    expect(BROKER_RULES['B-START-DEEP'].capture).toBe('Q-S1n')
    expect(BROKER_RULES['B-START-DEEP'].what).toMatch(/Q-SU-7/)
    expect(pinned('B-START-DEEP')).toBe(false)
  })

  it('a run from the listing over MORE bars than the served depth asks it: unpinned, refused BY NAME; pinned, served', () => {
    const un = attempt({ win: 12, depth: 8, pins: except('B-START-DEEP') })
    expect(un.err && un.err.guard).toBe('runtime:strategy-unpinned')
    expect(un.err.rule).toBe('B-START-DEEP')
    const ok = attempt({ win: 12, depth: 8 })
    expect(ok.err, ok.err && ok.err.message).toBeUndefined()
    expect(ok.used).toContain('B-START-DEEP')
    expect(ok.trades).toHaveLength(1)
    // dated on the first bar only a deep start runs (ruling D11): bars 0..3 of 12, past a depth of 8
    expect(ok.firsts['B-START-DEEP']).toBe(12 - 8)
  })

  it('CONTROL: at or below the served depth it is never asked, and with no depth handed the run is exactly as before', () => {
    expect(attempt({ win: 12, depth: 12, pins: except('B-START-DEEP') }).used).not.toContain('B-START-DEEP')
    expect(attempt({ win: 12, depth: 20, pins: except('B-START-DEEP') }).used).not.toContain('B-START-DEEP')
    const before = attempt({ win: 12, pins: except('B-START-DEEP') })
    expect(before.err).toBeUndefined()
    expect(before.used).not.toContain('B-START-DEEP')
    // and the window still bounds the run: more bars than the window is the old refusal, by name
    expect(attempt({ win: 10, depth: 8 }).err.guard).toBe('runtime:strategy-start')
  })
})

describe('the chart asks for the strategy window and its served depth (`strategyWindow.js`)', () => {
  it('reads the strategy window beside the shared one; a server from before the field answers exactly as before', () => {
    expect(windowOfPayload({ historyWindowBars: 5000, strategyHistoryWindowBars: 12500 })).toBe(12500)
    expect(listingDepthOfPayload({ historyWindowBars: 5000, strategyHistoryWindowBars: 12500 })).toBe(5000)
    expect(windowOfPayload({ historyWindowBars: 5000 })).toBe(5000)
    expect(listingDepthOfPayload({ historyWindowBars: 5000 })).toBe(null)
    // ⛔ never a window from half an answer, never a default
    expect(windowOfPayload({ strategyHistoryWindowBars: 12500 })).toBe(null)
    expect(windowOfPayload({ historyWindowBars: '5000', strategyHistoryWindowBars: 12500 })).toBe(null)
    expect(windowOfPayload({ historyWindowBars: 5000, strategyHistoryWindowBars: -1 })).toBe(5000)
    expect(windowOfPayload(null)).toBe(null)
  })

  it('the tab keeps both from ONE answer: the strategy window as its window, the shared one as its served depth', async () => {
    vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
    resetStrategyHistoryWindow()
    const fetchImpl = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ historyWindowBars: 5000, strategyHistoryWindowBars: 12500 }) })
    expect(await loadStrategyHistoryWindow(fetchImpl)).toBe(12500)
    expect(strategyHistoryWindowNow()).toBe(12500)
    expect(strategyListingDepthNow()).toBe(5000)
    // a server from before the field: the window it always answered, and no second value (the run as before)
    resetStrategyHistoryWindow()
    const old = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ historyWindowBars: 5000 }) })
    expect(await loadStrategyHistoryWindow(old)).toBe(5000)
    expect(strategyListingDepthNow()).toBe(null)
    resetStrategyHistoryWindow()
  })

  it('the census models the endpoint as it answers today: the strategy window over the shared depth, both off the module', () => {
    const w = chartStrategyWindowOf(ROOT)
    expect(w).toEqual({ historyWindowBars: strategyWindowBarsOf(ROOT), listingDepthBars: historyWindowBarsOf(ROOT) })
    expect(w.historyWindowBars).toBeGreaterThan(w.listingDepthBars)
  })

  it('only a DAILY chart holding a strategy, with the broker gate on, asks for its full daily history', () => {
    const strategy = { meta: { runtimeHistory: STRATEGY_WINDOW_HISTORY } }
    expect(isStrategyWindowDefinition(strategy)).toBe(true)
    const defOf = (id) => (id === 's' ? strategy : { meta: {} })
    const gate = (on) => vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', on ? '1' : '0')
    gate(true)
    expect(strategyNeedsFullDailyHistory({ tf: 'D', instances: [{ defId: 'x' }, { defId: 's' }], defOf })).toBe(true)
    for (const tf of ['W', 'M', '60', '5']) {
      expect(strategyNeedsFullDailyHistory({ tf, instances: [{ defId: 's' }], defOf }), tf).toBe(false)
    }
    expect(strategyNeedsFullDailyHistory({ tf: 'D', instances: [{ defId: 'x' }], defOf })).toBe(false)
    expect(strategyNeedsFullDailyHistory({ tf: 'D', instances: [], defOf })).toBe(false)
    gate(false)
    expect(strategyNeedsFullDailyHistory({ tf: 'D', instances: [{ defId: 's' }], defOf })).toBe(false)
  })

  it('RAIL: the chart\'s request reads it, and its full daily depth is the strategy window', () => {
    const chart = fs.readFileSync(path.resolve(process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
    expect(chart).toMatch(/const _strategyDailyFull = useMemo\(\(\) => strategyNeedsFullDailyHistory\(/)
    expect(chart).toMatch(/const barCount = \([^)]*_strategyDailyFull\) \? _fullTarget/)
    expect(chart).toMatch(/listingDepthBars: strategyListingDepth,/)
    const backfill = fs.readFileSync(path.resolve(process.cwd(), 'src/utils/barsBackfill.js'), 'utf8')
    expect(Number((backfill.match(/case 'D':\s*return\s+(\d+)/) || [])[1])).toBe(strategyWindowBarsOf(ROOT))
  })
})

describe('a member\'s daily SPY chart from its 1993 listing (8,473 bars): the backtest refused by name, the plots kept', () => {
  it('supertrend-strategy (community; MATCH on RDDT and ALAB from their listings) asks [B-START-DEEP] and is refused by name', () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('no network in this rail')))
    for (const f of ['VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', 'VITE_PINE_RUNTIME_PANE_ENABLED', 'VITE_PINE_STRATEGY_BROKER_ENABLED']) {
      vi.stubEnv(f, '1')
    }
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    const ref = loadCapture(path.join(ROOT, 'tests/fixtures/vendor/harness/vw-bool-cast-spy-1d-2026-09-28.json')).capture
    const bars = toProductBars(ref)
    expect(bars.length).toBe(8473)
    expect(bars[0].t).toBe('1993-01-29')
    const source = fs.readFileSync(path.join(ROOT, 'corpus/committed/supertrend-strategy__rcRbtoBiKG.pine'), 'utf8')
    const ctx = { tf: 'D', symbol: { ticker: 'SPY', exchange: 'NYSE Arca' }, newestBarIsForming: false, historyFromListing: true,
      ...chartStrategyWindowOf(ROOT) }
    const deep = strategyServeOutcome({ source, bars, ctx, Panel: StrategyReportPanel })
    expect(deep.third).toEqual([])
    expect(deep).toMatchObject({ state: 'refused', guard: 'runtime:strategy-unpinned', rule: 'B-START-DEEP' })
    expect(['report', 'run']).toContain(deep.at)
    expect(deep.plotsDrawn).toBeGreaterThan(0)
    // CONTROL: the shared window alone (the chart before this change) cuts the run off the listing: Q-S1n, by name
    const shared = strategyServeOutcome({ source, bars, ctx: { ...ctx, historyWindowBars: historyWindowBarsOf(ROOT),
      listingDepthBars: undefined }, Panel: StrategyReportPanel })
    expect(shared).toMatchObject({ state: 'refused', guard: 'runtime:strategy-unsettled' })
    expect(shared.sentence).toMatch(/first bar/)
    // what a member reads is the same either way: the plots, and the backtest refused by name
    expect(shared.plotsDrawn).toBe(deep.plotsDrawn)
  })
})
