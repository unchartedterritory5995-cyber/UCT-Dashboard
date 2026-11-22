import { describe, it, expect, vi, afterAll } from 'vitest'
import { render, act } from '@testing-library/react'
import { pinWallClock } from '../testing/pinnedWallClock'

// ⛔ NYSE HALF-DAY (13:00 close): the regular-hours view must end at 12:55 — the 13:00-16:00
// bars are POST-market. StockChart's sessionBars filter hard-coded 16:00 and drew them as
// regular session. Real component, barsOverride (no network). All prices synthetic.

const T = vi.hoisted(() => ({ series: [] }))
vi.mock('lightweight-charts', async (importOriginal) => {
  const real = await importOriginal()
  const ts = { range: null }
  const makeSeries = (ctor, options) => {
    const s = {
      __ctor: ctor, __options: { ...(options || {}) }, __data: [],
      setData: (d) => { s.__data = [...(d || [])] },
      update: (p) => {
        const i = s.__data.findIndex(d => d.time === p.time)
        if (i >= 0) s.__data[i] = p; else s.__data = [...s.__data, p]
      },
      applyOptions: (o) => { Object.assign(s.__options, o || {}) },
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
      createPriceLine: () => ({ applyOptions: () => {} }), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 0, coordinateToPrice: () => 0, options: () => s.__options,
      moveToPane: () => {}, getPane: () => ({ getHeight: () => 300, paneIndex: () => 0 }),
      dataByIndex: () => null, data: () => s.__data, barsInLogicalRange: () => null,
      priceFormatter: () => ({ format: (p) => String(p) }),
    }
    T.series.push(s)
    return s
  }
  const timeScale = new Proxy({
    setVisibleLogicalRange: (r) => { ts.range = r }, getVisibleLogicalRange: () => ts.range,
    getVisibleRange: () => null, setVisibleRange: () => {}, fitContent: () => {},
    timeToCoordinate: () => 0, coordinateToTime: () => null, logicalToCoordinate: () => 0, coordinateToLogical: () => 0,
    options: () => ({ barSpacing: 6, rightOffset: 3 }), width: () => 600, height: () => 40, barSpacing: () => 6,
  }, { get: (t, p) => (p in t ? t[p] : (typeof p === 'symbol' || p === 'then') ? undefined : () => undefined) })
  const chart = {
    addSeries: (ctor, options) => makeSeries(ctor, options),
    addCustomSeries: (_i, options) => makeSeries('custom', options),
    removeSeries: (s) => { const i = T.series.indexOf(s); if (i >= 0) T.series.splice(i, 1) },
    applyOptions: () => {}, priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale, paneSize: () => ({ width: 600, height: 300 }),
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {}, subscribeDblClick: () => {}, unsubscribeDblClick: () => {},
    panes: () => [0, 1, 2, 3].map(() => ({
      getHeight: () => 300, setHeight: () => {}, getHTMLElement: () => document.createElement('div'),
      priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    })),
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
  }
  return { ...real, createChart: () => chart, createSeriesMarkers: () => ({ setMarkers: () => {} }) }
})
vi.mock('../utils/barsIDB', async (orig) => {
  const real = await orig()
  return { ...real, idbGet: async () => null, idbPut: async () => {} }
})
vi.mock('../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, status: 'idle' }) }))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
HTMLCanvasElement.prototype.getContext = function getContext() {
  const ctx = { canvas: null, measureText: () => ({ width: 0 }), createLinearGradient: () => ({ addColorStop: () => {} }), getImageData: () => ({ data: [] }) }
  for (const m of ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'stroke', 'fill', 'save', 'restore', 'setLineDash', 'translate', 'scale', 'rotate', 'setTransform', 'quadraticCurveTo', 'bezierCurveTo', 'ellipse', 'rect', 'clip', 'drawImage', 'putImageData']) ctx[m] = () => {}
  return ctx
}

const clock = pinWallClock('2026-11-30T17:00:00Z')   // Mon after the Nov 27 half-day
afterAll(() => clock.restore())

const { default: StockChart } = await import('./StockChart')
const { toChartTime } = await import('./chart/barTime')

const etUnix = (mo, d, h, m) => {
  const wall = Date.UTC(2026, mo - 1, d, h, m) / 1000
  return toChartTime(wall + 18000) === wall ? wall + 18000 : wall + 14400
}
const wait = (ms) => act(() => new Promise((r) => setTimeout(r, ms)))

describe('regular-hours view on an NYSE half-day', () => {
  it('Nov 27 2026: candles stop at 12:55; an ordinary day keeps 09:30-15:55', async () => {
    const bars = []
    let k = 0
    for (const d of [25, 27]) {
      for (let mins = 4 * 60; mins < 20 * 60; mins += 5) {
        const o = 20 + (k % 7) * 0.1
        bars.push({ t: etUnix(11, d, Math.floor(mins / 60), mins % 60), o, h: o + 0.2, l: o - 0.2, c: o + 0.1, v: 100 + (k++ % 13) })
      }
    }
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: async () => ({}) })))
    const real = await vi.importActual('lightweight-charts')
    render(<StockChart sym="SYN" tf="5" barsOverride={bars} backgroundWarm={false} forceExtendedHours={false} />)
    await wait(300)
    const c = T.series.find(s => s.__ctor === real.CandlestickSeries)
    const times = c.__data.filter(p => p.open !== undefined).map(p => p.time)
    const minOf = (t) => (((t % 86400) + 86400) % 86400) / 60
    const half = times.filter(t => t >= toChartTime(etUnix(11, 27, 0, 0)))
    const ord = times.filter(t => t < toChartTime(etUnix(11, 27, 0, 0)))
    expect(half.length).toBe((780 - 570) / 5)
    expect(minOf(half[half.length - 1])).toBe(12 * 60 + 55)
    expect(ord.length).toBe((960 - 570) / 5)
    expect(minOf(ord[ord.length - 1])).toBe(15 * 60 + 55)
  })
})
