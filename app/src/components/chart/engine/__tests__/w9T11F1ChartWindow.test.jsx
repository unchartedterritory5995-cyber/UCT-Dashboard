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
import { render, renderHook, waitFor, cleanup, act } from '@testing-library/react'

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
import AttachedStrategyReports from '../../pane/AttachedStrategyReports'
import {
  STRATEGY_WINDOW_URL, FAILURE_RETRY_MS, REQUEST_TIMEOUT_MS, loadStrategyHistoryWindow, strategyHistoryWindowNow, resetStrategyHistoryWindow,
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
const ctxFor = (instances, { bars, listing = true, window, pending, reg = registry, tf = 'D', frames }) => ({
  enabled: true, instances, registry: reg, bars, tf, sym: 'RDDT', newestBarIsForming: false,
  historyFromListing: listing, symbol: { ticker: 'RDDT', exchange: 'NYSE' },
  ...(window !== undefined ? { historyWindowBars: window } : {}),
  ...(pending !== undefined ? { historyWindowPending: pending } : {}),
  ...(frames ? { frames } : {}),
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

  it('no default: a bad answer or a failed request is no window, and the next ask after the failure period tries again', async () => {
    flags(true)
    for (const bad of [0, -1, 1.5, '5000', null, undefined]) expect(windowOfPayload({ historyWindowBars: bad })).toBe(null)
    expect(windowOfPayload(null)).toBe(null)
    let t = 1_000_000
    const now = () => t
    const fails = [okFetch('5000'), vi.fn(async () => ({ ok: false, json: async () => ({ historyWindowBars: SERVER_WINDOW }) })),
      vi.fn(async () => { throw new Error('offline') })]
    for (const f of fails) {
      expect(await loadStrategyHistoryWindow(f, now)).toBe(null)
      expect(f).toHaveBeenCalledTimes(1)
      expect(strategyHistoryWindowNow()).toBe(null)
      t += FAILURE_RETRY_MS
    }
    expect(await loadStrategyHistoryWindow(okFetch(SERVER_WINDOW), now)).toBe(SERVER_WINDOW)
  })

  it('r1 (N1): a 401 is asked once, then answered "no window" with no request for the failure period', async () => {
    flags(true)
    let t = 5_000_000
    const now = () => t
    const unauth = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ detail: 'Not authenticated' }) }))
    expect(await loadStrategyHistoryWindow(unauth, now)).toBe(null)
    expect(unauth).toHaveBeenCalledTimes(1)
    t += FAILURE_RETRY_MS - 1
    for (let i = 0; i < 3; i++) expect(await loadStrategyHistoryWindow(unauth, now)).toBe(null)
    expect(unauth).toHaveBeenCalledTimes(1)
    t += 1
    const ok = okFetch(SERVER_WINDOW)
    expect(await loadStrategyHistoryWindow(ok, now)).toBe(SERVER_WINDOW)
    expect(ok).toHaveBeenCalledTimes(1)
  })

  it('the chart hook: gate off, or a chart with no strategy, asks nothing; gate on with a strategy is pending, then the value', async () => {
    flags(false)
    const f = okFetch(SERVER_WINDOW)
    vi.stubGlobal('fetch', f)
    const off = renderHook(() => useStrategyHistoryWindow(true))
    await Promise.resolve()
    expect(off.result.current).toEqual({ bars: null, pending: false })
    off.unmount()

    flags(true)
    // r1 (N1): a chart that holds only indicators never asks
    const ind = renderHook(() => useStrategyHistoryWindow(false))
    await Promise.resolve()
    expect(ind.result.current).toEqual({ bars: null, pending: false })
    ind.unmount()
    expect(f).not.toHaveBeenCalled()

    const on = renderHook(() => useStrategyHistoryWindow(true))
    // r1 (N3): asked and not answered yet is PENDING, not a missing window
    expect(on.result.current).toEqual({ bars: null, pending: true })
    await waitFor(() => expect(on.result.current).toEqual({ bars: SERVER_WINDOW, pending: false }))
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][1]).toMatchObject({ credentials: 'include' })
    expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('the chart hook after a 401: pending, then no window (the named refusal), and a second chart within the period asks nothing', async () => {
    flags(true)
    const f = vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }))
    vi.stubGlobal('fetch', f)
    const a = renderHook(() => useStrategyHistoryWindow(true))
    expect(a.result.current).toEqual({ bars: null, pending: true })
    await waitFor(() => expect(a.result.current).toEqual({ bars: null, pending: false }))
    const b = renderHook(() => useStrategyHistoryWindow(true))
    await waitFor(() => expect(b.result.current).toEqual({ bars: null, pending: false }))
    expect(f).toHaveBeenCalledTimes(1)
  })
})

describe('W9-T11-F1 r2: an ask that never settles fails, and a mounted chart asks again', () => {
  afterEach(() => { vi.useRealTimers() })

  it('r2 (N5): an ask that never settles is aborted after REQUEST_TIMEOUT_MS and counts as a failure', async () => {
    flags(true)
    vi.useFakeTimers()
    let signal = null
    const hang = vi.fn((url, init) => { signal = init.signal; return new Promise(() => {}) })
    let settled = 'unsettled'
    loadStrategyHistoryWindow(hang).then((v) => { settled = v })
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1)
    expect(settled).toBe('unsettled')
    expect(signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(null)
    expect(signal.aborted).toBe(true)
    // remembered as a failure: no request inside the failure period
    const g = okFetch(SERVER_WINDOW)
    expect(await loadStrategyHistoryWindow(g)).toBe(null)
    expect(g).not.toHaveBeenCalled()
  })

  it('r2 (N5): the chart is pending while it hangs, then not pending with no window (the named refusal follows)', async () => {
    flags(true)
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    const h = renderHook(() => useStrategyHistoryWindow(true))
    expect(h.result.current).toEqual({ bars: null, pending: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1) })
    expect(h.result.current).toEqual({ bars: null, pending: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(h.result.current).toEqual({ bars: null, pending: false })
    h.unmount()
    // what the binder does with that answer
    vi.useRealTimers()
    install(SRC, DEF_ID, 'Window strategy')
    binder.sync(ctxFor([inst()], { bars: makeBars(40), pending: h.result.current.pending }))
    expect(runtimeErrorNoticeFor('i1')).toMatch(/runtime:strategy-start/)
  })

  it('r2 (N6): a mounted chart asks again after each failure period, quietly, and takes the window when it lands', async () => {
    flags(true)
    vi.useFakeTimers()
    const answers = [
      { ok: false, status: 401, json: async () => ({}) },
      { ok: false, status: 500, json: async () => ({}) },
      { ok: true, json: async () => ({ historyWindowBars: SERVER_WINDOW }) },
    ]
    const f = vi.fn(async () => answers.shift())
    vi.stubGlobal('fetch', f)
    const seen = []
    const h = renderHook(() => { const r = useStrategyHistoryWindow(true); seen.push(r); return r })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h.result.current).toEqual({ bars: null, pending: false })
    expect(f).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(FAILURE_RETRY_MS - 1) })
    expect(f).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(f).toHaveBeenCalledTimes(2)
    expect(h.result.current).toEqual({ bars: null, pending: false })
    await act(async () => { await vi.advanceTimersByTimeAsync(FAILURE_RETRY_MS) })
    expect(f).toHaveBeenCalledTimes(3)
    expect(h.result.current).toEqual({ bars: SERVER_WINDOW, pending: false })
    // quiet: once the first ask failed, the chart was never pending again (no flicker to an empty pane)
    const firstAnswer = seen.findIndex((r) => !r.pending)
    expect(firstAnswer).toBeGreaterThan(-1)
    expect(seen.slice(firstAnswer).every((r) => !r.pending)).toBe(true)
    // and once the window is in hand nothing more is asked
    await act(async () => { await vi.advanceTimersByTimeAsync(FAILURE_RETRY_MS * 3) })
    expect(f).toHaveBeenCalledTimes(3)
    h.unmount()
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

  it('r1 (N3): while the window is PENDING the run is held: no record, no refusal notice, no report', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    const bars = makeBars(40)
    binder.sync(ctxFor([inst()], { bars, pending: true }))
    expect(strategyRecordFor('i1')).toBe(null)
    expect(runtimeErrorNoticeFor('i1')).toBe(null)
    const { container } = render(<AttachedStrategyReports settings={{ indicatorInstances: [inst()] }} />)
    expect(container.innerHTML).toBe('')
    cleanup()
    // the answer lands: the run computes and publishes
    binder.sync(ctxFor([inst()], { bars, window: SERVER_WINDOW, pending: false }))
    expect(strategyRecordFor('i1')).not.toBe(null)
    expect(runtimeErrorNoticeFor('i1')).toBe(null)
  })

  it('r1 (N3): a window in hand wins over a pending flag: the run computes (pending only means "no answer yet")', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    binder.sync(ctxFor([inst()], { bars: makeBars(40), window: SERVER_WINDOW, pending: true }))
    expect(strategyRecordFor('i1')).not.toBe(null)
  })

  it('r1 (N3): once the ask has FAILED (not pending, no window) the run refuses by name', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    const bars = makeBars(40)
    binder.sync(ctxFor([inst()], { bars, pending: true }))
    expect(runtimeErrorNoticeFor('i1')).toBe(null)
    binder.sync(ctxFor([inst()], { bars, pending: false }))
    expect(strategyRecordFor('i1')).toBe(null)
    expect(runtimeErrorNoticeFor('i1')).toMatch(/runtime:strategy-start/)
  })

  it('r1 (N3): pending holds only a strategy; an indicator beside it computes as before', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    install(IND, IND_ID, 'Plain indicator')
    const seen = []
    const spy = { ...registry, computeFor: (def, b, inputs, c) => { seen.push(def.id); return registry.computeFor(def, b, inputs, c) } }
    binder.sync(ctxFor([inst(), inst(IND_ID, 'i2')], { bars: makeBars(40), pending: true, reg: spy }))
    expect(seen).toContain(IND_ID)
    expect(seen).not.toContain(DEF_ID)
  })

  // r1 (N2) — "only the chart's own series". A runtime document (every strategy) is never framed
  // (`calcTimeframeCapability`: kind 'runtime' refuses a calculation timeframe), so the product case
  // is the first rail; the binder's own `!frame` rule is held by the second, on a frameable
  // definition stamped `strategy-window`, with an unframed control beside it.
  const dailyBars = () => {
    const out = []
    for (let d = Date.UTC(2026, 0, 5), i = 0; out.length < 40; d += 86400000, i++) {
      if (new Date(d).getUTCDay() % 6 !== 0) out.push({ t: new Date(d).toISOString().slice(0, 10), o: 10 + i, h: 11 + i, l: 9 + i, c: 10 + i, v: 1000 })
    }
    return out
  }

  it('r1 (N2): a strategy asked for another timeframe is not framed: it runs on the chart series the window describes', () => {
    flags(true)
    install(SRC, DEF_ID, 'Window strategy')
    const frames = new Map([['D|RDDT', { bars: dailyBars(), status: 'available', newestBarIsForming: false }]])
    const seen = []
    const spy = { ...registry, computeFor: (def, b, inputs, c) => { seen.push([def.id, b, c]); return registry.computeFor(def, b, inputs, c) } }
    const chartBars = makeBars(40)
    binder.sync(ctxFor([{ ...inst(), calculationTimeframe: 'D' }], { bars: chartBars, tf: '60', window: SERVER_WINDOW, frames, reg: spy }))
    const strat = seen.filter(([id]) => id === DEF_ID)
    expect(strat.length).toBeGreaterThan(0)
    for (const [, b, c] of strat) {
      expect(c.framed).toBe(false)
      expect(b).toBe(chartBars)
      expect(c.historyWindowBars).toBe(SERVER_WINDOW)
    }
  })

  it('r1 (N2): the binder hands the window to the chart own series only: a FRAMED stamped instance never gets it', () => {
    flags(true)
    const base = registry.getDefinition('movingAverage')
    const stamped = { ...base, meta: { ...(base.meta || {}), runtimeHistory: 'strategy-window' } }
    const seen = []
    const spy = {
      ...registry,
      getDefinition: (id) => (id === 'movingAverage' ? stamped : registry.getDefinition(id)),
      computeFor: (def, b, inputs, c) => { seen.push([def === stamped, c]); return registry.computeFor(def, b, inputs, c) },
    }
    const frames = new Map([['D|RDDT', { bars: dailyBars(), status: 'available', newestBarIsForming: false }]])
    const avg = (id, extra = {}) => ({ instanceId: id, defId: 'movingAverage', inputs: { source: 'close', period: 5, maType: 'sma' }, hidden: false, ...extra })
    binder.sync(ctxFor([avg('framed', { calculationTimeframe: 'D' }), avg('own')], {
      bars: makeBars(40), tf: '60', window: SERVER_WINDOW, frames, reg: spy,
    }))
    const calls = seen.filter(([isStamped]) => isStamped).map(([, c]) => c)
    const framed = calls.filter((c) => c.framed === true)
    const own = calls.filter((c) => c.framed === false)
    expect(framed.length).toBeGreaterThan(0)
    expect(own.length).toBeGreaterThan(0)
    for (const c of framed) expect('historyWindowBars' in c).toBe(false)
    // control: the same stamped document on the chart's own series IS handed the window
    for (const c of own) expect(c.historyWindowBars).toBe(SERVER_WINDOW)
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
    expect(count(/const \{ bars: strategyHistoryWindow, pending: strategyWindowPending \} = useStrategyHistoryWindow\(_holdsStrategyWindow\)/g)).toBe(1)
    // r1 (N1): asked only when a stored instance's definition is a strategy (the shared reader)
    expect(count(/\.some\(\(i\) => isStrategyWindowDefinition\(_defOf\(i && i\.defId\)\)\)/g)).toBe(1)
    expect(SRC).toMatch(/const _holdsStrategyWindow = useMemo\(/)
    const sync = SRC.indexOf('engineRef.current.binder.sync({')
    const line = SRC.indexOf('historyWindowBars: strategyHistoryWindow,')
    expect(sync).toBeGreaterThan(-1)
    expect(line).toBeGreaterThan(sync)
    expect(count(/historyWindowBars:/g)).toBe(1)
    expect(SRC.indexOf('historyWindowPending: strategyWindowPending,')).toBeGreaterThan(sync)
    // the sync effect's dependency list carries it, so a window that lands re-syncs the binder
    // (the first effect close after the ctx line is the sync effect's: it also lists `historyFromListing`)
    const deps = SRC.slice(line).match(/\n {2}\}, \[([^\]]*)\]\)/)
    const names = deps ? deps[1].split(',').map((x) => x.trim()) : []
    expect(names).toContain('historyFromListing')
    expect(names).toContain('strategyHistoryWindow')
    expect(names).toContain('strategyWindowPending')
  })
})
