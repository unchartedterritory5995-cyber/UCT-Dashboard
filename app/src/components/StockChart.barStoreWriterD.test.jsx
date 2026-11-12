// P3-S1 — WRITER D UNDER BARSTORE: after every setData the developing candle is re-topped from
// THE SNAPSHOT'S developing bar (the store's merge of the server's developing bar, push frames
// and the tick fallback), never from a second source. Synthetic prices only.
//
// Contract, stated generally: after any snapshot change, the LAST write to the candle series is
// the snapshot's developing bar (time = its bucket, O/H/L/C = its values) — so the bar on screen
// can never be older or narrower than the store's.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, act } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'
import { toChartTime } from './chart/barTime'

const log = vi.hoisted(() => ({ ops: [] }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const series = () => {
    const s = {
      setData: (d) => { if (Array.isArray(d) && d.length && d[0]?.open != null) log.ops.push({ op: 'setData', n: d.length, last: d[d.length - 1] }) },
      update: (p) => { if (p && p.open != null) log.ops.push({ op: 'update', p }) },
      applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
      detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      getPane: () => ({ paneIndex: () => 0 }), priceFormatter: () => ({ format: (x) => String(x) }),
      dataByIndex: () => null, barsInLogicalRange: () => null,
    }
    return s
  }
  const chart = {
    addSeries: series, addCandlestickSeries: series, addHistogramSeries: series,
    addLineSeries: series, addAreaSeries: series, addBarSeries: series,
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
    panes: () => [{ getHeight: () => 300, getHTMLElement: () => document.createElement('div') }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
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

// Tue 2026-09-22 13:17 ET — the 13:15 bucket is forming.
const clock = pinWallClock('2026-09-22T17:17:00Z')
afterAll(() => clock.restore())
const et = (h, m) => Math.floor(Date.UTC(2026, 8, 22, h + 4, m) / 1000)
const rows = () => {
  const out = []
  for (let t = et(9, 30); t <= et(13, 15); t += 300) out.push({ t, o: 10, h: 11, l: 9, c: 10.5, v: 100 })
  return out
}
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))
/** The last candle write after the last setData (null when the setData was the last write). */
const lastRetop = () => {
  const i = log.ops.map((o) => o.op).lastIndexOf('setData')
  const after = log.ops.slice(i + 1).filter((o) => o.op === 'update')
  return after.length ? after[after.length - 1].p : null
}

describe('Writer D under BARSTORE re-tops from snapshot.developing', () => {
  let M
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      const u = String(url)
      if (!u.includes('/api/bars/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      // The store's ONE request: answered once, later polls stay pending (no second answer).
      if (fetch.mock.calls.filter((c) => String(c[0]).includes('/api/bars/WDX')).length > 1) return new Promise(() => {})
      const body = { ticker: 'WDX', tf: '5', bars: rows() }
      return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
    }))
    M = await loadWithBarStore(true, async () => ({
      StockChart: (await import('./StockChart')).default,
      index: await import('../data/barStore/index'),
      types: await import('../data/barStore/types'),
    }))
  })

  it('non-vacuity: the switch is ON in this graph', () => { expect(M.__barStore).toBe(true) })

  it('after setData the candle is re-topped with the snapshot developing bar; a push frame re-tops the new one', async () => {
    render(<M.StockChart sym="WDX" tf="5" backgroundWarm={false} />)
    await wait(600)
    expect(log.ops.some((o) => o.op === 'setData'), 'the series was painted').toBe(true)
    const r1 = lastRetop()
    expect(r1, 're-top after setData').toBeTruthy()
    expect(r1).toMatchObject({ time: toChartTime(et(13, 15)), open: 10, high: 11, low: 9, close: 10.5 })

    const store = M.index.getBarStore()
    const key = M.types.keyOf({ sym: 'WDX', tf: '5' })
    await act(async () => {
      store.registry.dispatch(key, { type: 'push-bar', key, event: { sym: 'WDX', bar: { t: et(13, 15) * 1000, o: 10, h: 11.8, l: 9, c: 11.6, v: 160 }, rev: Date.now() } })
    })
    await wait(300)
    const dev = store.getSnapshot(key).developing
    expect([dev.h, dev.c]).toEqual([11.8, 11.6])
    const r2 = lastRetop()
    expect(r2).toMatchObject({ time: toChartTime(et(13, 15)), open: 10, high: 11.8, low: 9, close: 11.6 })
  })
})
