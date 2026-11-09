// app/src/components/chart/engine/__tests__/w9T11F1ChartWindow.test.jsx
//
// W9-T11-F1 — THE CHART LANE PASSES A BACKTEST WINDOW (design 3.4, "The chart"; D2, D9).
//
// The T13b review found that with the broker gate on a chart still showed no backtest: the binder
// never handed a strategy run `ctx.historyWindowBars`, so every chart run refused
// `runtime:strategy-start`. These rails hold the fix end to end on the product's own pieces:
//   · the window comes from the SERVER (`GET /api/pine/history-window`, `strategyWindow.js`), asked
//     only with the gate on, kept fixed for the tab, and never defaulted;
//   · the real binder hands it to a STRATEGY document only (an indicator's ctx is unchanged);
//   · a run from the listing that fits the window publishes a record with the D2 sentence;
//   · an off-listing run refuses Q-S1n by name, and a run longer than the window refuses too (the
//     cut is off the listing), so a served window never slides as bars arrive;
//   · gate off: nothing is fetched and nothing is published.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

vi.mock('../runtime/brokerPins.js', () => ({ pinned: () => true }))
vi.setConfig({ testTimeout: 120000 })

import { createBinder } from '../binder'
import { createFakeChart, makeBars } from './fakeChart'
import * as registry from '../nativeRegistry'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { runtimeColumnsFor } from '../runtime/runtimeColumns'
import { strategyRecordShapeErrors, startSentenceOf, startDateOf } from '../runtime/strategyRecord'
import { strategyRecordFor, resetStrategyRecords } from '../strategyReportNotice'
import { runtimeErrorNoticeFor, resetRuntimeErrorNotices } from '../runtimeErrorNotice'
import {
  STRATEGY_WINDOW_URL, loadStrategyHistoryWindow, strategyHistoryWindowNow, resetStrategyHistoryWindow,
  windowOfPayload,
} from '../strategyWindow'
import useStrategyHistoryWindow from '../../../../hooks/useStrategyHistoryWindow'

// ⭐ D9: the window is `bars_window.HISTORY_WINDOW_BARS`, read from the SERVER SOURCE, so this file
// cannot agree with a number the server no longer holds.
const BARS_WINDOW_PY = path.resolve(__dirname, '../../../../../../api/services/bars_window.py')
const SERVER_WINDOW = Number(/^HISTORY_WINDOW_BARS\s*=\s*(\d+)\s*$/m.exec(fs.readFileSync(BARS_WINDOW_PY, 'utf8'))[1])

const LF = String.fromCharCode(10)
const DEF_ID = 'u_w9t11f1-window'
const IND_ID = 'u_w9t11f1-indicator'
const SRC = ['//@version=5', 'strategy("window")', 'if bar_index == 3', '    strategy.entry("L", strategy.long)',
  'if bar_index == 9', '    strategy.close("L")', 'plot(strategy.position_size, "pos")', ''].join(LF)
const IND = ['//@version=5', 'indicator("ind")', 'var float acc = 0.0', 'acc += close', 'plot(acc, "acc")', ''].join(LF)

const flags = (broker) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  if (broker) vi.stubEnv('VITE_PINE_STRATEGY_BROKER_ENABLED', '1')
}
const inst = (defId = DEF_ID, id = 'i1') => ({ instanceId: id, defId, inputs: {}, hidden: false })
const ctxFor = (instances, { bars, listing = true, window, reg = registry }) => ({
  enabled: true, instances, registry: reg, bars, tf: 'D', newestBarIsForming: false,
  historyFromListing: listing, symbol: { ticker: 'RDDT', exchange: 'NYSE' },
  ...(window !== undefined ? { historyWindowBars: window } : {}),
  adjustTime: (t) => t, plan: { fresh: true },
  applyData: (series, data) => { if (series && data) series.setData(data) },
  resolvePlacement: (i) => ({ paneIndex: 0, scaleId: i.defId, scaleOptions: {} }),
})
const okFetch = (w) => vi.fn(async () => ({ ok: true, json: async () => ({ historyWindowBars: w }) }))

let fake
let binder
beforeEach(() => {
  resetStrategyRecords()
  resetStrategyHistoryWindow()
  registry.registerRuntimeLane(runtimeColumnsFor)
  fake = createFakeChart()
  binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
})
afterEach(() => {
  cleanup()
  binder.teardown()
  registry.uninstallUserDefinition(DEF_ID)
  registry.uninstallUserDefinition(IND_ID)
  registry.registerRuntimeLane(null)
  resetStrategyRecords()
  resetRuntimeErrorNotices()
  resetStrategyHistoryWindow()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const install = (source, id, name) => {
  const d = memberPaneDefinition({ source, id, name })
  expect(d.ok, d.reason).toBe(true)
  const { installed, errors } = registry.installUserDefinitions([d.definition])
  expect(installed.length, errors.join(' | ')).toBe(1)
  return installed[0]
}

describe('W9-T11-F1 the window comes from the server, once, and only with the gate on', () => {
  it('D9: the server source holds 5000', () => {
    expect(SERVER_WINDOW).toBe(5000)
  })

  it('gate OFF: nothing is fetched and there is no window', async () => {
    flags(false)
    const f = okFetch(SERVER_WINDOW)
    expect(await loadStrategyHistoryWindow(f)).toBe(null)
    expect(strategyHistoryWindowNow()).toBe(null)
    expect(f).not.toHaveBeenCalled()
  })

  it('gate ON: one request to the endpoint, and the first good answer is fixed for the tab', async () => {
    flags(true)
    const f = okFetch(SERVER_WINDOW)
    expect(await loadStrategyHistoryWindow(f)).toBe(SERVER_WINDOW)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][0]).toBe(STRATEGY_WINDOW_URL)
    expect(STRATEGY_WINDOW_URL).toBe('/api/pine/history-window')
    // a later, different answer cannot move the window under an open chart
    const g = okFetch(SERVER_WINDOW + 1)
    expect(await loadStrategyHistoryWindow(g)).toBe(SERVER_WINDOW)
    expect(g).not.toHaveBeenCalled()
    expect(strategyHistoryWindowNow()).toBe(SERVER_WINDOW)
  })

  it('no default: a bad answer or a failed request is no window, and the next ask tries again', async () => {
    flags(true)
    for (const bad of [0, -1, 1.5, '5000', null, undefined]) expect(windowOfPayload({ historyWindowBars: bad })).toBe(null)
    expect(windowOfPayload(null)).toBe(null)
    expect(await loadStrategyHistoryWindow(okFetch('5000'))).toBe(null)
    expect(await loadStrategyHistoryWindow(vi.fn(async () => ({ ok: false, json: async () => ({ historyWindowBars: SERVER_WINDOW }) })))).toBe(null)
    expect(await loadStrategyHistoryWindow(vi.fn(async () => { throw new Error('offline') }))).toBe(null)
    expect(strategyHistoryWindowNow()).toBe(null)
    expect(await loadStrategyHistoryWindow(okFetch(SERVER_WINDOW))).toBe(SERVER_WINDOW)
  })

  it('the chart hook: gate off null with no request; gate on the server value', async () => {
    flags(false)
    const f = okFetch(SERVER_WINDOW)
    vi.stubGlobal('fetch', f)
    const off = renderHook(() => useStrategyHistoryWindow())
    await Promise.resolve()
    expect(off.result.current).toBe(null)
    expect(f).not.toHaveBeenCalled()
    off.unmount()

    flags(true)
    const on = renderHook(() => useStrategyHistoryWindow())
    await waitFor(() => expect(on.result.current).toBe(SERVER_WINDOW))
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][1]).toEqual({ credentials: 'include' })
  })
})

describe('W9-T11-F1 the binder hands a strategy run the chart\'s window', () => {
  it('from the listing, inside the window: the record is published with the D2 sentence and the window', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    const bars = makeBars(40)
    binder.sync(ctxFor([inst()], { bars, window: SERVER_WINDOW }))
    const rec = strategyRecordFor('i1')
    expect(rec, String(runtimeErrorNoticeFor('i1'))).not.toBe(null)
    expect(strategyRecordShapeErrors(rec)).toEqual([])
    expect(rec.window.fromListing).toBe(true)
    expect(rec.window.historyWindowBars).toBe(SERVER_WINDOW)
    expect(rec.window.bars).toBe(bars.length)
    expect(rec.window.startTime).toBe(bars[0].t)
    // D2 through the one authority (`strategyRecord.js::startSentenceOf`)
    expect(rec.window.startDate).toBe(startDateOf(bars[0].t))
    expect(rec.window.startSentence).toBe(startSentenceOf(bars[0].t))
    expect(rec.window.startSentence).toBe(`this backtest starts on ${startDateOf(bars[0].t)} (UTC); TradingView may start elsewhere`)
    expect(rec.trades.length).toBe(1)
  })

  it('the window is fixed across bar updates: a new bar never moves the start or an earlier trade', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    const all = makeBars(42)
    binder.sync(ctxFor([inst()], { bars: all.slice(0, 40), window: SERVER_WINDOW }))
    const a = strategyRecordFor('i1')
    binder.sync(ctxFor([inst()], { bars: all.slice(0, 41), window: SERVER_WINDOW }))
    const b = strategyRecordFor('i1')
    binder.sync(ctxFor([inst()], { bars: all, window: SERVER_WINDOW }))
    const c = strategyRecordFor('i1')
    for (const r of [a, b, c]) {
      expect(r).not.toBe(null)
      expect(r.window.startTime).toBe(all[0].t)
      expect(r.window.historyWindowBars).toBe(SERVER_WINDOW)
      expect(r.window.startSentence).toBe(a.window.startSentence)
      expect(r.trades).toEqual(a.trades)
    }
    expect([a.window.bars, b.window.bars, c.window.bars]).toEqual([40, 41, 42])
  })

  it('a run that would slide (more bars than the window) refuses by name and publishes nothing', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    const all = makeBars(31)
    // fits: served from the listing
    binder.sync(ctxFor([inst()], { bars: all.slice(0, 30), window: 30 }))
    expect(strategyRecordFor('i1')).not.toBe(null)
    // one bar more: the most recent 30 no longer start at the listing, so the run refuses (Q-S1n)
    // instead of trading from a moved start
    binder.sync(ctxFor([inst()], { bars: all, window: 30 }))
    expect(strategyRecordFor('i1')).toBe(null)
    expect(runtimeErrorNoticeFor('i1')).toMatch(/runtime:strategy-unsettled/)
    expect(runtimeErrorNoticeFor('i1')).toMatch(/symbol's first bar/)
  })

  it('off the listing: Q-S1n refuses by name and no record is published', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    binder.sync(ctxFor([inst()], { bars: makeBars(40), listing: false, window: SERVER_WINDOW }))
    expect(strategyRecordFor('i1')).toBe(null)
    expect(runtimeErrorNoticeFor('i1')).toMatch(/runtime:strategy-unsettled/)
    expect(runtimeErrorNoticeFor('i1')).toMatch(/symbol's first bar/)
  })

  it('no window (gate off on the fetch, or the server has not answered): runtime:strategy-start, nothing published', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    for (const window of [undefined, null, 0, '5000', 1.5]) {
      binder.sync(ctxFor([inst()], { bars: makeBars(40), window }))
      expect(strategyRecordFor('i1')).toBe(null)
      expect(runtimeErrorNoticeFor('i1')).toMatch(/runtime:strategy-start/)
    }
  })

  it('a window that lands after the bars (the server answers after first paint) recomputes the run', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    const bars = makeBars(40)
    binder.sync(ctxFor([inst()], { bars }))
    expect(strategyRecordFor('i1')).toBe(null)
    expect(runtimeErrorNoticeFor('i1')).toMatch(/runtime:strategy-start/)
    binder.sync(ctxFor([inst()], { bars, window: SERVER_WINDOW }))
    const rec = strategyRecordFor('i1')
    expect(rec).not.toBe(null)
    expect(rec.window.historyWindowBars).toBe(SERVER_WINDOW)
  })

  it('a different window on the same bars is a different run (the memo is keyed on the window)', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    const bars = makeBars(40)
    binder.sync(ctxFor([inst()], { bars, window: SERVER_WINDOW }))
    expect(strategyRecordFor('i1').window.historyWindowBars).toBe(SERVER_WINDOW)
    binder.sync(ctxFor([inst()], { bars, window: 50 }))
    expect(strategyRecordFor('i1').window.historyWindowBars).toBe(50)
  })

  it('only a strategy document is handed the window: an indicator\'s ctx is unchanged', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    install(IND, IND_ID, 'Plain indicator')
    const seen = []
    const spy = { ...registry, computeFor: (def, b, inputs, c) => { seen.push([def.id, c]); return registry.computeFor(def, b, inputs, c) } }
    binder.sync(ctxFor([inst(), inst(IND_ID, 'i2')], { bars: makeBars(40), window: SERVER_WINDOW, reg: spy }))
    const strat = seen.filter(([id]) => id === DEF_ID)
    const ind = seen.filter(([id]) => id === IND_ID)
    expect(strat.length).toBeGreaterThan(0)
    expect(ind.length).toBeGreaterThan(0)
    for (const [, c] of strat) expect(c.historyWindowBars).toBe(SERVER_WINDOW)
    for (const [, c] of ind) expect('historyWindowBars' in c).toBe(false)
    expect(strategyRecordFor('i2')).toBe(null)
  })
})

describe('W9-T11-F1 StockChart hands the binder the window from the hook', () => {
  // The repo's idiom for a StockChart seam (`listingReference.test.js`, `useServerColumns.test.jsx`):
  // the 20k-line component is read, not mounted.
  const SRC = fs.readFileSync(path.resolve(__dirname, '../../../StockChart.jsx'), 'utf8')
  const count = (re) => (SRC.match(re) || []).length
  it('reads the window from the hook, passes it in the binder ctx, and recomputes when it lands', () => {
    expect(count(/import useStrategyHistoryWindow from '\.\.\/hooks\/useStrategyHistoryWindow'/g)).toBe(1)
    expect(count(/const strategyHistoryWindow = useStrategyHistoryWindow\(\)/g)).toBe(1)
    const sync = SRC.indexOf('engineRef.current.binder.sync({')
    const line = SRC.indexOf('historyWindowBars: strategyHistoryWindow,')
    expect(sync).toBeGreaterThan(-1)
    expect(line).toBeGreaterThan(sync)
    expect(count(/historyWindowBars:/g)).toBe(1)
    // the sync effect's dependency list carries it, so a window that lands re-syncs the binder
    // (the first effect close after the ctx line is the sync effect's: it also lists `historyFromListing`)
    const deps = SRC.slice(line).match(/\n {2}\}, \[([^\]]*)\]\)/)
    const names = deps ? deps[1].split(',').map((x) => x.trim()) : []
    expect(names).toContain('historyFromListing')
    expect(names).toContain('strategyHistoryWindow')
  })
})
