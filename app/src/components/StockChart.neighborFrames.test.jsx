// ⭐⭐ NEIGHBOR FRAMES (2026-11-20, `uct.neighborframes`) — the REAL StockChart, switching from the row it
// shows to the next row of the list that drives it. With the switch ON the next row is prepared in idle
// time (its per-bar arrays, its indicator columns and their points) and the switch takes what was prepared;
// with it OFF the switch computes everything, as today. What the renderer is HANDED on the switch (every
// series' `setData`, in order, with its data) must be identical, and the ON run must really have taken the
// prepared answers (non-vacuity: the hit counters).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'

const S = vi.hoisted(() => ({ log: [], n: 0, rec: false }))
vi.mock('../lib/realtimeBarsGate', () => ({ realtimeBarsEnabled: () => false }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const make = (type) => {
    const id = ++S.n
    const kind = type === real.CandlestickSeries ? 'candle' : type === real.HistogramSeries ? 'histogram' : type === real.LineSeries ? 'line' : 'other'
    const s = {
      setData: (d) => { if (S.rec) S.log.push([`${kind}#${id}`, 'setData', JSON.stringify(d)]) },
      update: (p) => { if (S.rec) S.log.push([`${kind}#${id}`, 'update', JSON.stringify(p)]) },
      data: () => [],
      applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
      detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      getPane: () => ({ paneIndex: () => 0, getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [] }),
      priceFormatter: () => ({ format: (x) => String(x) }), moveToPane: () => {}, seriesOrder: () => 0, setSeriesOrder: () => {},
      dataByIndex: () => null, barsInLogicalRange: () => null,
      subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
    }
    return s
  }
  const chart = {
    addSeries: (type) => make(type),
    addCandlestickSeries: () => make(real.CandlestickSeries), addHistogramSeries: () => make(real.HistogramSeries),
    addLineSeries: () => make(real.LineSeries), addAreaSeries: () => make(null), addBarSeries: () => make(null),
    removeSeries: () => {}, applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => ({
      applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {}, getVisibleLogicalRange: () => null,
      setVisibleRange: () => {}, scrollToPosition: () => {}, subscribeVisibleLogicalRangeChange: () => {},
      unsubscribeVisibleLogicalRangeChange: () => {}, timeToCoordinate: () => 0, coordinateToTime: () => null,
      resetTimeScale: () => {}, options: () => ({}), width: () => 600, logicalToCoordinate: () => 0,
      subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
      subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    }),
    paneSize: () => ({ width: 600, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {}, subscribeClick: () => {}, unsubscribeClick: () => {},
    subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div'), getSeries: () => [], setHeight: () => {}, setStretchFactor: () => {}, getStretchFactor: () => 1, paneIndex: () => 0 }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
    chartElement: () => document.createElement('div'),
  }
  return { ...real, createChart: () => chart, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})
vi.mock('../utils/barsIDB', async (orig) => ({ ...(await orig()), idbGet: async () => null, idbPut: async () => {}, idbPutMonotonic: async () => {} }))
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))

// a Saturday: the newest daily bar is settled and nothing forms
const clock = pinWallClock('2026-11-14T16:00:00Z')
afterAll(() => clock.restore())
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

const rowsFor = (k) => {
  const out = []
  const d = new Date(Date.UTC(2021, 0, 4))
  let i = 0
  while (d.toISOString().slice(0, 10) <= '2026-11-13') {
    const iso = d.toISOString().slice(0, 10)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) {
      const c = 40 * k + Math.sin(i / 11) * 6 * k + i * 0.01
      out.push({ t: iso, o: c - 0.5, h: c + 1.5, l: c - 1.7, c, v: 1e6 + ((i * 7919 * k) % 500000) })
      i++
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const BARS = { AAA: rowsFor(1), BBB: rowsFor(2) }

// the chart's own blob: three natives, an average of close, an average OF the RSI
const SETTINGS = {
  indicatorInstances: [
    { instanceId: 'nf-rsi', defId: 'rsi', inputs: {}, hidden: false },
    { instanceId: 'nf-macd', defId: 'macd', inputs: {}, hidden: false },
    { instanceId: 'nf-bb', defId: 'bb', inputs: {}, hidden: false },
    { instanceId: 'nf-ma', defId: 'movingAverage', inputs: { source: 'close', period: 50 }, hidden: false },
    { instanceId: 'nf-ma-rsi', defId: 'movingAverage', inputs: { source: '@nf-rsi::rsi', period: 9 }, hidden: false },
  ],
}
const noop = () => {}

/** Mount AAA, hold BBB in the store, (ON: let the next row be prepared), switch to BBB. What the switch handed. */
async function switchOnce(on) {
  S.log.length = 0
  S.n = 0
  S.rec = false
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    const m = /\/api\/bars\/([A-Z]+)/.exec(u)
    if (!m || !BARS[m[1]]) return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => ({}) })
    const body = { ticker: m[1], tf: 'D', bars: BARS[m[1]], newest_bar_is_forming: false }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
  }))
  const M = await loadWithBarStore(true, async () => ({
    StockChart: (await import('./StockChart')).default,
    nf: await import('./chart/neighborFrames'),
    store: (await import('../data/barStore/index')).getBarStore(),
    chartKeyFor: (await import('./chart/useBarSnapshotBars')).chartKeyFor,
  }))
  M.nf.__setNeighborFramesForTests(on)
  M.nf.__resetNeighborFramesStatsForTests()
  const key = M.chartKeyFor({ sym: 'BBB', resolvedTf: 'D', showExtended: false, replayCutoff: null, hasOverride: false })
  const view = render(<M.StockChart sym="AAA" tf="D" backgroundWarm={false} settingsOverride={SETTINGS} onSettingsPersist={noop} />)
  await wait(800)
  // the list's hold: BBB is in memory, answered by the server, before the member reaches it
  M.store.registry.acquire(key)
  await act(async () => { await M.store.ensure(key, { priority: 'urgent' }) })
  if (on) M.nf.publishScanNeighbors('AAA', ['BBB'], [])
  await wait(on ? 2500 : 200)
  S.rec = true
  view.rerender(<M.StockChart sym="BBB" tf="D" backgroundWarm={false} settingsOverride={SETTINGS} onSettingsPersist={noop} />)
  await wait(600)
  S.rec = false
  const stats = JSON.parse(JSON.stringify(M.nf.neighborFramesStats()))
  cleanup()
  M.store.registry.release(key)
  M.nf.__setNeighborFramesForTests(null)
  return { log: S.log.slice(), stats }
}

describe('the real chart: a prepared switch hands the renderer what a computed switch does', () => {
  let off
  let on
  beforeAll(async () => {
    off = await switchOnce(false)
    on = await switchOnce(true)
  }, 60_000)

  it('the computed switch drew the new row (the comparison is not vacuous)', () => {
    const candles = off.log.filter(([s, m]) => s.startsWith('candle') && m === 'setData')
    expect(candles.length).toBeGreaterThan(0)
    expect(off.log.length).toBeGreaterThan(8)
  })

  it('the prepared switch took the prepared columns, points and arrays', () => {
    expect(on.stats.colsPrepared).toBeGreaterThanOrEqual(5)
    expect(on.stats.colsHit).toBeGreaterThanOrEqual(5)
    expect(on.stats.pointsHit).toBeGreaterThan(0)
    expect(on.stats.derivedHit).toBeGreaterThan(0)
    // the switch itself says so (the production diagnostics read this)
    expect(on.stats.switchPrepared).toBeGreaterThanOrEqual(1)
    expect(on.stats.switches.some((x) => x.startsWith('BBB:D:P:'))).toBe(true)
    expect(off.stats.switchPrepared).toBe(0)
  })

  it('every series was handed the same data, in the same order', () => {
    expect(on.log.length).toBe(off.log.length)
    for (let i = 0; i < off.log.length; i++) expect(on.log[i], `call ${i} (${off.log[i][0]} ${off.log[i][1]})`).toEqual(off.log[i])
  })
})
