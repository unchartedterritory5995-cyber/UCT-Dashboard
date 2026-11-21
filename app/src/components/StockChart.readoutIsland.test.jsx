// app/src/components/StockChart.readoutIsland.test.jsx
//
// ─── The readout re-renders its islands, not the chart (switch render cuts, 2026-11-20) ──────────
//
// The legend payload (`crosshairData`) and the off-hover end-tag chips are no longer StockChart state:
// they live in a per-chart store printed by `ReadoutIsland`s (`chart/ReadoutIsland.jsx`), so a readout
// write re-renders a few rows of text instead of the whole chart. On the REAL StockChart
// (lightweight-charts stubbed, the rsPriceHost harness) this file pins:
//   1. a hover frame prints the hovered bar and renders no StockChart (it used to render it on every frame);
//   2. THE FIXED POINT after it: a full StockChart render changes nothing on the chart's DOM. The islands
//      printed exactly what a StockChart render prints, so none of them read a value that only a
//      StockChart render refreshes.
// The switch side (one StockChart render before paint, the readout in a nested commit of islands, and the
// same fixed point right after the switch) is `StockChart.switchRenders.test.jsx`, on the production path
// (the bar store): here, on the legacy path, the chart re-renders on its own after a switch.
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const H = vi.hoisted(() => ({ crosshair: [], scRenders: 0, candle: null }))

vi.mock('lightweight-charts', () => {
  const T = { candle: {}, histogram: {}, line: {}, area: {}, bar: {}, baseline: {} }
  // one object per series (the render-window facade maps each one to its own proxy)
  const make = (type) => {
    const s = {
      setData: () => {}, update: () => {}, applyOptions: () => {},
      priceScale: () => ({ applyOptions: () => {} }),
      createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
      attachPrimitive: () => {}, detachPrimitive: () => {},
      priceToCoordinate: () => 100, coordinateToPrice: () => 0, options: () => ({}), dataByIndex: () => null,
      getPane: () => ({ getHeight: () => 300, paneIndex: () => 0, setStretchFactor: () => {}, getSeries: () => [] }),
      barsInLogicalRange: () => null, data: () => [], seriesType: () => 'Candlestick',
      priceFormatter: () => ({ format: (v) => String(v) }), moveToPane: () => {},
    }
    if (type === T.candle) H.candle = s
    return s
  }
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null, setVisibleRange: () => {}, scrollToPosition: () => {},
    subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {},
    timeToCoordinate: () => 500, coordinateToTime: () => null, resetTimeScale: () => {},
    options: () => ({}), width: () => 600,
    subscribeVisibleTimeRangeChange: () => {}, unsubscribeVisibleTimeRangeChange: () => {},
    getVisibleRange: () => null, coordinateToLogical: () => 0, logicalToCoordinate: () => 0,
    timeToIndex: () => 0, height: () => 40, scrollPosition: () => 0,
    subscribeSizeChange: () => {}, unsubscribeSizeChange: () => {},
  }
  const chart = {
    addSeries: (type) => make(type), addCandlestickSeries: () => make(T.candle), addHistogramSeries: () => make(T.histogram),
    addLineSeries: () => make(T.line), addAreaSeries: () => make(T.area), addBarSeries: () => make(T.bar),
    addCustomSeries: () => make(null),
    removeSeries: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    // ⭐ the hover path's input: the handler StockChart subscribes, called by the test
    subscribeCrosshairMove: (fn) => { H.crosshair.push(fn) }, unsubscribeCrosshairMove: () => {},
    subscribeClick: () => {}, unsubscribeClick: () => {},
    panes: () => [{ getHeight: () => 300, paneIndex: () => 0, setStretchFactor: () => {}, getHTMLElement: () => document.createElement('div'), getSeries: () => [], attachPrimitive: () => {} }],
    resize: () => {}, remove: () => {}, takeScreenshot: () => document.createElement('canvas'),
    chartElement: () => document.createElement('div'),
  }
  return {
    createChart: () => chart,
    ColorType: { Solid: 'solid', VerticalGradient: 'gradient' },
    CrosshairMode: { Normal: 0, Magnet: 1 },
    LineStyle: { Solid: 0, Dotted: 1, Dashed: 2, LargeDashed: 3 },
    CandlestickSeries: T.candle, HistogramSeries: T.histogram, LineSeries: T.line, AreaSeries: T.area, BarSeries: T.bar,
    createSeriesMarkers: () => ({ setMarkers: () => {}, detach: () => {} }),
    BaselineSeries: T.baseline, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
  }
})
// ⭐ THE RENDER COUNTER: StockChart calls this hook once per render of its body, and nothing else calls it
// (grep `useLegacyDailyTickE`). An island's render does not.
vi.mock('./chart/legacyLiveWriters', async (orig) => {
  const m = await orig()
  return { ...m, useLegacyDailyTickE: (...a) => { H.scRenders++; return m.useLegacyDailyTickE(...a) } }
})
vi.mock('../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, staleSymbols: new Set(), isStreaming: false, status: 'idle' }),
}))
vi.mock('../hooks/useRealtimeBars', () => ({ default: () => ({}) }))
vi.mock('../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: null, plan: 'free', isPaid: false, loading: false }),
  useIsPaid: () => false,
  AuthContext: { Provider: ({ children }) => children },
}))
vi.mock('../utils/barsIDB', () => ({
  idbGet: async () => null, idbPut: async () => {}, mergeDelta: (_a, b) => b,
  idbDelete: async () => {}, idbDeleteIntraday: async () => {}, idbCountKeys: async () => 0,
  idbImportPack: async () => {}, idbApplyDelta: async () => {},
  _findRecentBarByT: () => null, _closeMismatch: () => false,
}))

const { default: StockChart } = await import('./StockChart')
const { mergeChartSettings } = await import('./chart/chartDefaults')

// Two symbols with disjoint price bands, so no printed value of one can be read as the other's.
const barsAt = (base) => Array.from({ length: 120 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: base + 0.25, h: base + 1.5, l: base - 1.25, c: base + (i % 5), v: 1000 + i }
})
const BARS = { AAA: barsAt(100), BBB: barsAt(300) }
const lastClose = (sym) => BARS[sym][BARS[sym].length - 1].c.toFixed(2)
// a price overlay and a pane study: the legend's chips, its stack and a pane readout all print
const CS = mergeChartSettings({
  indicatorInstances: [
    { instanceId: 'ri-rsi', defId: 'rsi', inputs: {}, hidden: false },
    { instanceId: 'ri-ma', defId: 'movingAverage', inputs: { source: 'close', period: 20 }, hidden: false },
  ],
})

const settle = (ms = 300) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
/** The chart's DOM with what a render cannot be asked to reproduce (React's generated ids) normalised. */
const domOf = (c) => c.innerHTML.replace(/:r[0-9a-z]+:|«r[0-9a-z]+»/g, ':id:')

function mount() {
  const el = (sym) => (
    <MemoryRouter>
      <StockChart sym={sym} tf="D" barsOverride={BARS[sym]} settingsOverride={CS} alwaysShowLegend height={400} />
    </MemoryRouter>
  )
  return { view: render(el('AAA')), el }
}

beforeEach(() => {
  cleanup()
  H.crosshair.length = 0
  H.scRenders = 0
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('a hover frame re-renders the islands, not StockChart', () => {
  it('prints the hovered bar with no StockChart render, and a full render then changes nothing', async () => {
    const { view, el } = mount()
    await vi.waitFor(() => expect(view.container.textContent).toContain(lastClose('AAA')), { timeout: 8000 })
    await settle()
    expect(H.crosshair.length, 'StockChart subscribed to the crosshair').toBeGreaterThan(0)
    // the pointer is over the chart, on bar 40 (close 100 + 40 % 5 = 100): a value no off-cursor readout prints
    const bar = BARS.AAA[40]
    const time = Math.floor(Date.parse(bar.t + 'T00:00:00Z') / 1000)
    const point = { open: 111.11, high: 122.22, low: 99.99, close: 117.77, time }
    const n = H.scRenders
    await act(async () => {
      for (const fn of H.crosshair) fn({ point: { x: 10, y: 10 }, time, logical: 40, seriesData: new Map([[H.candle, point]]) })
      await new Promise((r) => setTimeout(r, 60))   // the handler coalesces to an animation frame
    })
    expect(view.container.textContent).toContain('117.77')
    expect(H.scRenders - n, 'StockChart renders for a hover frame').toBe(0)
    const before = domOf(view.container)
    await act(async () => { view.rerender(el('AAA')) })
    expect(H.scRenders).toBeGreaterThan(n)
    expect(domOf(view.container)).toBe(before)
  })
})
