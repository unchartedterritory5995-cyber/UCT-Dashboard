// app/src/components/StockChart.postCloseAsOf.test.jsx
//
// ⭐⭐ (2026-11-18) AFTER THE CLOSE A STRATEGY'S REPORT IS AS OF THE NEWEST BAR — through the REAL chart.
//
// The production check, RDDT 1D after the close (22:43-22:46Z, three loads alike, the rig's readings): the page
// painted from the device cache first (the 11-18 close on screen at 1.65 s); `/api/bars` answered
// `newest_bar_is_forming: false`, newest bar 2026-11-18; the history lake answered sealed through 2026-11-17; and
// the supertrend strategy's report read "As of the bar closed 2026-11-17", its backtest refused by [B-EXEC]: the
// run never took the route's "closed". The lake's sealed date is not what the run reads (it reads the chart's
// `newestBarIsForming`, the payload's flag); the run was computed while the newest bar was UNKNOWN (the cache
// paint, no payload yet) and was not recomputed when the payload's flag landed over the same bars.
//
// This rail drives the exact sequence on the real StockChart (lightweight-charts stubbed, the device cache and the
// server faked): a cache paint through D (deeper than the route's window), the lake sealed through D-1, then the
// route through D with `false`. The strategy's report must be as of D. ⚠️ On this path the chart already recovers
// before the fix (the route's answer reaches the run because the bars change identity when it lands), so this rail
// guards the chain, cache paint -> route flag -> run -> report, and does not reproduce the rig's stuck report; its
// mutant is the chart handing the run no flag at all.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pinWallClock } from '../testing/pinnedWallClock'

const idb = vi.hoisted(() => ({ answer: null }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
    detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
    getPane: () => ({ paneIndex: () => 0, getHeight: () => 300, setStretchFactor: () => {}, getSeries: () => [] }),
    priceFormatter: () => ({ format: (p) => String(p) }),
    dataByIndex: () => null, barsInLogicalRange: () => null, data: () => [], moveToPane: () => {},
  }
  const chart = {
    addSeries: () => series, addCustomSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
      getVisibleLogicalRange: () => null, setVisibleRange: () => {}, scrollToPosition: () => {},
      subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {},
      timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600, height: () => 28, logicalToCoordinate: () => 0,
      subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    paneSize: () => ({ width: 600, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [{ getHeight: () => 300, paneIndex: () => 0, setStretchFactor: () => {}, getHTMLElement: () => document.createElement('div'), getSeries: () => [], attachPrimitive: () => {}, detachPrimitive: () => {} }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
    chartElement: () => document.createElement('div'),
  }
  return { ...real, createChart: () => chart, createSeriesMarkers: () => ({ setMarkers: () => {}, detach: () => {} }) }
})
vi.mock('../utils/barsIDB', async (orig) => {
  const real = await orig()
  return {
    ...real,
    idbGet: () => Promise.resolve(idb.answer),
    idbPut: async () => {}, idbGetHistory: async () => null, idbPutHistory: async () => null,
  }
})
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// Wed 2026-11-18 17:43 ET: the session closed at 16:00 ET, so the route calls the 11-18 daily bar closed.
const clock = pinWallClock('2026-11-18T22:43:00Z')
afterAll(() => clock.restore())

const { default: StockChart } = await import('./StockChart')
const { mergeChartSettings } = await import('./chart/chartDefaults')
const registry = await import('./chart/engine/nativeRegistry')
const { memberPaneDefinition } = await import('./chart/builder/memberPane/memberPaneDefinition')
const { isStrategyWindowDefinition } = await import('./chart/engine/strategyWindow')
const { strategyRecordFor, resetStrategyRecords } = await import('./chart/engine/strategyReportNotice')
const { __permitRuntimePaneForTests } = await import('./chart/engine/runtimePaneGate')
const { __allowEveryRuntimeScriptForTests, setRuntimeKillList } = await import('./chart/engine/runtimeKill')
const { memClear } = await import('../utils/barsMemCache')

const REPO = path.resolve(process.cwd(), '..')
const GATE = (f) => fs.readFileSync(path.resolve(process.cwd(), `src/components/chart/engine/${f}`), 'utf8')
const FLAGS = ['objectsOnlyPaneGate.js', 'runtimePaneGate.js', 'strategyBrokerGate.js']
  .map((f) => (GATE(f).match(/(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1])
const SUPERTREND = fs.readFileSync(path.join(REPO, 'corpus/committed/supertrend-strategy__rcRbtoBiKG.pine'), 'utf8')
const DEF_ID = 'u_post-close-as-of'
const D = '2026-11-18'

// 400 weekday sessions ending D (synthetic prices: a slow wave, so the strategy trades)
function sessions(n, last) {
  const out = []
  const d = new Date(`${last}T00:00:00Z`)
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const DAYS = sessions(500, D)
const BARS = DAYS.map((t, i) => {
  const c = 100 + 25 * Math.sin(i / 23) + 6 * Math.sin(i / 5)
  return { t, o: c - 0.5, h: c + 2, l: c - 2, c, v: 1e6 + i }
})
const LAKE = BARS.slice(0, -1)                                   // sealed through D-1
const ROUTE = BARS.slice(-400)                                    // the route's window: the newest 400 sessions, through D
const DAY_BEFORE = DAYS[DAYS.length - 2]

let order
const ROUTE_MS = 1500   // the route answers AFTER the lake (the rig's order)
const okJson = (body) => ({ ok: true, status: 200, json: async () => body })
const later = (ms, body) => new Promise((r) => setTimeout(() => r(okJson(body)), ms))
function serve() {
  order = []
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (u.includes('/api/bars-history/')) { order.push('lake'); return later(20, { ticker: 'RDDT', tf: 'D', sealed: true, version: `1.${DAY_BEFORE}`, last_sealed: DAY_BEFORE, bars: LAKE }) }
    if (u.includes('/api/bars/RDDT') && /[?&]tf=D(&|$)/.test(u) && !u.includes('warm=1')) {
      order.push('route')
      return later(ROUTE_MS, { ticker: 'RDDT', tf: 'D', bars: ROUTE, newest_bar_is_forming: false })
    }
    if (u.includes('history-window')) return later(5, { historyWindowBars: 5000 })
    if (u.includes('ticker-ipo')) return later(5, { list_date: DAYS[0], first_trade_date: DAYS[0] })
    if (u.includes('ticker-meta')) return later(5, { ticker: 'RDDT', exchange: 'NYSE', security_type: 'stock' })
    if (u.includes('/api/bars/')) return new Promise(() => {})   // other timeframes' warms: never answer
    return Promise.resolve(okJson({}))
  }))
}
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
async function until(cond, ms = 15000) {
  for (let t = 0; t < ms && !cond(); t += 50) await wait(50)
  return cond()
}
const realClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')

beforeEach(() => {
  cleanup(); memClear(); resetStrategyRecords()
  for (const f of FLAGS) vi.stubEnv(f, '1')
  __permitRuntimePaneForTests()
  __allowEveryRuntimeScriptForTests()
  setRuntimeKillList([])
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 400 })
  const built = memberPaneDefinition({ source: SUPERTREND, id: DEF_ID, name: 'SuperTrend STRATEGY' })
  expect(built.ok, built.reason).toBe(true)
  expect(isStrategyWindowDefinition(built.definition)).toBe(true)
  expect(registry.installUserDefinitions([built.definition]).installed.length).toBe(1)
  // the device cache holds the series through D, DEEPER than the route's window (a persistent profile; the rig's
  // first paint showed the 11-18 close)
  idb.answer = { bars: BARS, lastT: D, savedAt: Date.now() }
})
afterEach(() => {
  cleanup()
  Object.defineProperty(Element.prototype, 'clientHeight', realClientHeight)
  registry.uninstallUserDefinition(DEF_ID)
  resetStrategyRecords()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const settings = () => mergeChartSettings({ indicatorInstances: [{ instanceId: 'pc-i1', defId: DEF_ID, inputs: {}, hidden: false }] })
const asOf = () => {
  const rec = strategyRecordFor('pc-i1', 'pc-scope')
  const t = rec && rec.window ? rec.window.asOfBar : null
  return t == null ? null : (typeof t === 'string' ? t.slice(0, 10) : new Date(t * 1000).toISOString().slice(0, 10))
}

describe('after the close: a cache paint, the lake sealed through D-1, the route through D (closed)', { timeout: 60000 }, () => {
  it('⭐ the strategy\'s report is as of D, the newest bar the route calls closed', async () => {
    serve()
    render(<StockChart sym="RDDT" tf="D" settingsOverride={settings()} noticeScope="pc-scope" />)
    const ok = await until(() => order.includes('route') && order.includes('lake') && asOf() !== null)
    expect(ok).toBe(true)
    // let every answer land and every paint run
    await wait(ROUTE_MS + 1500)
    expect(asOf()).toBe(D)                     // ⚰️ read DAY_BEFORE: the run kept the cache paint's "unknown"
  })
})
