// P3-S2 — UNDER BARSTORE THE STORE IS THE ONLY WRITER OF THE DEVELOPING CANDLE.
//
// Contracts, stated generally, checked on what the chart PAINTS (a stateful series double that
// keeps its points exactly as lightweight-charts would: setData replaces, update() replaces the
// last point or appends a later one, and refuses an earlier one). Synthetic prices only.
//   P1  within a bucket, as painted: open once, high never falls, low never rises, volume never
//       falls — over a seeded stream of push frames (any order the store accepts);
//   P2  no frame paints an older developing state after a newer one: after every frame the
//       painted tail IS the store's newest developing bar;
//   P3  across a bucket roll the closed candle on screen equals the store's closed row;
//   HA  under Heikin-Ashi the developing candle is the HA transform (the base bars' own owner,
//       indicators.heikinAshiNext) — never a raw candle amid HA bars (review fix (b));
//   R1  the legacy writers are not mounted: a quote handed to the chart's live-price hook never
//       reaches the candle under BARSTORE (and does under the legacy source — non-vacuity).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'
import { loadWithBarStore } from '../testing/barStoreModes'
import { toChartTime } from './chart/barTime'
import { toHeikinAshi } from './chart/indicators'

const S = vi.hoisted(() => ({ series: [], prices: {} }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const make = (type) => {
    const s = {
      kind: type === real.CandlestickSeries ? 'candle' : type === real.HistogramSeries ? 'volume' : 'other',
      points: [], updates: [],
      setData: (d) => { s.points = Array.isArray(d) ? d.map((p) => ({ ...p })) : [] },
      update: (p) => {
        const last = s.points[s.points.length - 1]
        if (last && p.time < last.time) throw new Error('Cannot update oldest data')
        s.updates.push({ ...p })
        if (last && last.time === p.time) s.points[s.points.length - 1] = { ...p }
        else s.points.push({ ...p })
      },
      data: () => s.points,
      applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {}, attachPrimitive: () => {},
      detachPrimitive: () => {}, priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => ({}),
      getPane: () => ({ paneIndex: () => 0 }), priceFormatter: () => ({ format: (x) => String(x) }),
      dataByIndex: () => null, barsInLogicalRange: () => null,
      subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
    }
    S.series.push(s)
    return s
  }
  const chart = {
    addSeries: (type) => make(type),
    addCandlestickSeries: () => make(real.CandlestickSeries), addHistogramSeries: () => make(real.HistogramSeries),
    addLineSeries: () => make(null), addAreaSeries: () => make(null), addBarSeries: () => make(null),
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
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: S.prices, status: 'idle' }) }))
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
const candle = () => S.series.filter((s) => s.kind === 'candle').at(-1)
const volume = () => S.series.filter((s) => s.kind === 'volume').at(-1)
const HA_SETTINGS = Object.freeze({ heikinAshi: true })

function stubFetch(sym) {
  vi.stubGlobal('fetch', vi.fn((url) => {
    const u = String(url)
    if (!u.includes('/api/bars/')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
    // The store's ONE request: answered once, later polls stay pending.
    if (fetch.mock.calls.filter((c) => String(c[0]).includes(`/api/bars/${sym}`)).length > 1) return new Promise(() => {})
    const body = { ticker: sym, tf: '5', bars: rows() }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, clone() { return this }, json: async () => body })
  }))
}

async function loadGraph(on) {
  return loadWithBarStore(on, async () => ({
    StockChart: (await import('./StockChart')).default,
    index: await import('../data/barStore/index'),
    types: await import('../data/barStore/types'),
  }))
}

describe('BARSTORE: the store paints the developing candle (P1 / P2 / P3)', () => {
  let M
  beforeAll(async () => { stubFetch('LVX'); M = await loadGraph(true) })
  afterAll(() => cleanup())

  it('non-vacuity: the switch is ON in this graph', () => { expect(M.__barStore).toBe(true) })

  it.each([11, 23, 37])('seed %i: open-once, H↑ L↓ V↑ in a bucket, painted = newest, roll = the store\'s closed row', async (seed) => {
    cleanup(); S.series.length = 0
    M.index._resetBarStoreForTests?.()
    stubFetch('LVX')
    render(<M.StockChart sym="LVX" tf="5" backgroundWarm={false} />)
    await wait(600)
    const store = M.index.getBarStore()
    const key = M.types.keyOf({ sym: 'LVX', tf: '5' })
    expect(candle()?.points.length, 'the series was painted').toBeGreaterThan(10)
    let s = seed
    const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648 }
    let bucket = et(13, 15), hi = 11, lo = 9, c = 10.5, v = 100, rev = Date.now()
    let prev = null, rolls = 0, sameBucket = 0
    for (let i = 0; i < 40; i++) {
      const roll = rnd() < 0.12
      if (roll) { bucket += 300; hi = lo = c; v = 2 }
      else {
        // any frame the feed might deliver, including a stale / narrower one (the store merges)
        c = Math.round((c + (rnd() - 0.5) * 0.4) * 100) / 100
        hi = Math.max(hi, c); lo = Math.min(lo, c); v += Math.floor(rnd() * 20)
      }
      const narrow = !roll && rnd() < 0.2
      await act(async () => {
        store.registry.dispatch(key, { type: 'push-bar', key, event: { sym: 'LVX', bar: {
          t: bucket * 1000, o: 10, h: narrow ? c : hi, l: narrow ? c : lo, c, v: narrow ? Math.max(1, v - 30) : v,
        }, rev: ++rev } })
      })
      await wait(30)   // one frame: the dev channel flushes
      const snap = store.getSnapshot(key)
      const dev = snap.developing
      const P = candle().points.at(-1), V = volume()?.points.at(-1)
      // P2: the painted tail IS the store's newest developing bar
      expect(P, `step ${i}`).toMatchObject({ time: toChartTime(dev.t), open: dev.o, high: dev.h, low: dev.l, close: dev.c })
      if (V) expect(V.value, `step ${i} volume`).toBe(dev.v)
      if (prev && prev.time === P.time) {
        sameBucket++
        // P1: within the bucket, as painted
        expect(P.open, `step ${i} open-once`).toBe(prev.open)
        expect(P.high, `step ${i} H↑`).toBeGreaterThanOrEqual(prev.high)
        expect(P.low, `step ${i} L↓`).toBeLessThanOrEqual(prev.low)
        if (V && prev.v != null) expect(V.value, `step ${i} V↑`).toBeGreaterThanOrEqual(prev.v)
      } else if (prev) {
        rolls++
        // P3: the bucket that just closed, on screen, equals the store's closed row
        const row = snap.bars.find((b) => b.t === dev.t - 300)
        const onScreen = candle().points.find((p) => p.time === prev.time)
        expect(row, `step ${i}: the closed row`).toBeTruthy()
        expect(onScreen).toMatchObject({ open: row.o, high: row.h, low: row.l, close: row.c })
        const vOn = volume()?.points.find((p) => p.time === prev.time)
        if (vOn) expect(vOn.value).toBe(row.v)
      }
      prev = { ...P, v: V?.value }
    }
    // non-vacuity: both branches ran, and the volume series was checked
    expect(rolls).toBeGreaterThan(0)
    expect(sameBucket).toBeGreaterThan(10)
    expect(volume()?.points.length).toBeGreaterThan(10)
  })
})

describe('BARSTORE: Heikin-Ashi developing candle (review fix (b))', () => {
  let M
  beforeAll(async () => { stubFetch('HAX'); M = await loadGraph(true) })
  afterAll(() => cleanup())

  it('the developing candle is the HA transform of snapshot.developing, continued from the HA bar before it', async () => {
    cleanup(); S.series.length = 0
    render(<M.StockChart sym="HAX" tf="5" backgroundWarm={false} settingsOverride={HA_SETTINGS} />)
    await wait(600)
    const store = M.index.getBarStore()
    const key = M.types.keyOf({ sym: 'HAX', tf: '5' })
    expect(candle()?.points.length).toBeGreaterThan(10)
    let rev = Date.now()
    for (const [h, l, c] of [[11.4, 9, 11.2], [11.9, 8.7, 9.1], [12.2, 8.7, 12.0]]) {
      await act(async () => {
        store.registry.dispatch(key, { type: 'push-bar', key, event: { sym: 'HAX', bar: { t: et(13, 15) * 1000, o: 10, h, l, c, v: 300 }, rev: ++rev } })
      })
      await wait(30)
      const snap = store.getSnapshot(key)
      const all = [...snap.bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c })), snap.developing]
      const ha = toHeikinAshi(all).at(-1)
      const P = candle().points.at(-1)
      expect(P.time).toBe(toChartTime(et(13, 15)))
      expect(P.open).toBeCloseTo(ha.o, 10)
      expect(P.high).toBeCloseTo(ha.h, 10)
      expect(P.low).toBeCloseTo(ha.l, 10)
      expect(P.close).toBeCloseTo(ha.c, 10)
      // never the raw candle (non-vacuity: HA differs from raw here)
      expect(P.close).not.toBe(c)
    }
  })
})

describe('R1: the legacy writers are not mounted under BARSTORE', () => {
  afterAll(() => { cleanup(); S.prices = {} })

  it.each([false, true])('BARSTORE=%s: a quote from the live-price hook reaches the candle only under the legacy source', async (on) => {
    cleanup(); S.series.length = 0; S.prices = {}
    stubFetch('QTX')
    const M = await loadGraph(on)
    expect(M.__barStore).toBe(on)
    const { rerender } = render(<M.StockChart sym="QTX" tf="5" backgroundWarm={false} />)
    await wait(600)
    expect(candle()?.points.length).toBeGreaterThan(10)
    const QUOTE = 10.37   // a price no bar or developing state carries
    S.prices = { QTX: { price: QUOTE, updated_at: Math.floor(Date.now() / 1000), day_open: 10, day_high: 11, day_low: 9, prev_close: 10.2 } }
    rerender(<M.StockChart sym="QTX" tf="5" backgroundWarm={false} />)
    await wait(200)
    const quoted = candle().updates.some((p) => p.close === QUOTE || p.value === QUOTE)
    expect(quoted, on ? 'no legacy writer paints a quote under BARSTORE' : 'Writer A paints the quote (legacy)').toBe(!on)
  })
})
