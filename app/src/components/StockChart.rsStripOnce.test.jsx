// app/src/components/StockChart.rsStripOnce.test.jsx
//
// ─── ONE RANKS STRIP PER CHART (2026-11-12, observed live on QQQ daily) ──────
//
// With the UCT RS Line (strip on the price pane) AND UCT RS Rating (own pane) on
// one chart, the 1M-12M ranks strip drew twice, identical numbers. The rule
// (`paneTable.paneTableOwners`): the rating pane yields while a visible RS line
// shows its strip; alone, or with the line hidden or its strip switched off, the
// rating pane shows it. Decided per render from the chips, never by saved inputs.
//
// The REAL StockChart, lightweight-charts stubbed (the rsPriceHost harness, same
// mocks, same reasons). The "RS line" is a price-hosted fixture declaring the RS
// line's own `meta.paneTable`; the rating is the real `rsRating`.
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const POINTS = [{ time: '2026-01-01', value: 0.2 }, { time: '2026-01-02', value: 0.25 }, { time: '2026-01-03' }]
vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
    attachPrimitive: () => {}, detachPrimitive: () => {},
    // ⭐ the tag's inputs: a pane-local y for the last value, a plot-local x for its time
    priceToCoordinate: () => 100, coordinateToPrice: () => 0, options: () => ({}), dataByIndex: () => null,
    getPane: () => ({ getHeight: () => 300, paneIndex: () => 0, setStretchFactor: () => {}, getSeries: () => [] }),
    barsInLogicalRange: () => null, data: () => POINTS, seriesType: () => 'Candlestick',
    priceFormatter: () => ({ format: (v) => String(v) }), moveToPane: () => {},
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
    addSeries: () => series, addCandlestickSeries: () => series, addHistogramSeries: () => series,
    addLineSeries: () => series, addAreaSeries: () => series, addBarSeries: () => series,
    addCustomSeries: () => series,
    removeSeries: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {}, width: () => 0 }),
    timeScale: () => timeScale,
    subscribeCrosshairMove: () => {}, unsubscribeCrosshairMove: () => {},
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
    CandlestickSeries: {}, HistogramSeries: {}, LineSeries: {}, AreaSeries: {}, BarSeries: {},
    createSeriesMarkers: () => ({ setMarkers: () => {}, detach: () => {} }),
    BaselineSeries: {}, LineType: { Simple: 0, WithSteps: 1, Curved: 2 },
  }
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
const registry = await import('./chart/engine/nativeRegistry')
const { primeServerColumns, clearServerColumns, notifyColumnsLanded, serverColumnsKey, pickServerInputs } =
  await import('./chart/engine/serverCompute')

const RS = registry.getDefinition('rsLine')
const SYM = 'QQQ'
const RATING_INPUTS = RS.inputs.filter((i) => ['showRating', 'showRanksTable', 'ratingBands'].includes(i.key))
  .map((i) => ({ ...i, $refs: undefined, activeWhen: undefined }))
  .map((i) => Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)))
const LINE = Object.freeze({
  schemaVersion: 1, id: 'u_rs_strip_line', version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: { name: 'Strip Line Fixture', shortName: 'SLF', category: 'Momentum', repaint: 'non-repainting',
    paneTable: RS.meta.paneTable },
  placement: { target: 'price', ownScale: true },
  inputs: [{ key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 }, ...RATING_INPUTS],
  plots: [{ key: 'rsi', label: 'SLF', style: 'line', color: '#4ea1ff', width: 1, legend: { decimals: 1 } }],
  events: [],
  readout: [{ key: 'rating', label: 'Rating', source: 'scalar:rating.ibd', format: 'int', chip: true }],
})
const RATING = Object.freeze({ ibd: 60, fast: 58, asof: '2026-11-11', m1: 34, m3: 44, m6: 51, m9: 58, m12: 60, source: 'row' })

const bars = Array.from({ length: 80 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 + i }
})
const inst = (instanceId, defId, extra = {}) => ({ instanceId, defId, inputs: {}, hidden: false, ...extra })
const mount = (instances) => render(
  <MemoryRouter><StockChart sym={SYM} tf="D" barsOverride={bars}
    settingsOverride={mergeChartSettings({ indicatorInstances: instances })} alwaysShowLegend height={400} /></MemoryRouter>)

function prime(defId, stored = {}) {
  const def = registry.getDefinition(defId)
  const inputs = pickServerInputs(def, registry.resolveInputs(def, stored))
  primeServerColumns(defId, SYM, 'D', inputs, { columns: {}, payload: { rating: RATING } })
  return serverColumnsKey(defId, SYM, 'D', inputs)
}
const strips = (c) => [...c.querySelectorAll('[data-pane-table]')]
const ranks = (el) => [...el.querySelectorAll('dd')].map((d) => d.textContent)
const settle = () => new Promise((r) => setTimeout(r, 300))

const realClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
const realOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
beforeEach(() => {
  cleanup()
  clearServerColumns()
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 400 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 40 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 16 })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  const r = registry.installUserDefinitions([LINE])
  expect(r.errors, 'the fixture installs').toEqual([])
})
afterEach(() => {
  cleanup()
  registry.uninstallUserDefinition(LINE.id)
  clearServerColumns()
  Object.defineProperty(Element.prototype, 'clientHeight', realClientHeight)
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffsetWidth)
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight)
  vi.unstubAllGlobals()
})

// Land every envelope, wait until the rating pane's label (when on the chart) and
// a strip are up, then let any second strip have its chance to appear.
async function land(container, keys, { ratingPane = true } = {}) {
  await act(async () => { for (const k of keys) notifyColumnsLanded(k) })
  await vi.waitFor(() => {
    if (ratingPane) expect(container.querySelector('[data-pane-legend]'), 'the rating pane label').not.toBeNull()
    expect(strips(container).length, 'a strip').toBeGreaterThan(0)
  }, { timeout: 8000, interval: 100 })
  await settle()
  return strips(container)
}

describe('one ranks strip per chart', () => {
  it('RS line + RS Rating → ONE strip, on the price pane (the rating pane yields)', async () => {
    const keys = [prime(LINE.id), prime('rsRating')]
    const { container } = mount([inst('line-1', LINE.id), inst('rr-1', 'rsRating')])
    const out = await land(container, keys)
    expect(out).toHaveLength(1)
    expect(out[0].getAttribute('data-host')).toBe('price')
    expect(ranks(out[0])).toEqual(['34', '44', '51', '58', '60', '60'])
  })

  it('RS Rating alone → its strip, in its pane', async () => {
    const keys = [prime('rsRating')]
    const { container } = mount([inst('rr-1', 'rsRating')])
    const out = await land(container, keys)
    expect(out).toHaveLength(1)
    expect(out[0].getAttribute('data-host')).toBe('pane')
    expect(ranks(out[0])).toEqual(['34', '44', '51', '58', '60', '60'])
  })

  it('RS line alone → its strip, on the price pane', async () => {
    const keys = [prime(LINE.id)]
    const { container } = mount([inst('line-1', LINE.id)])
    const out = await land(container, keys, { ratingPane: false })
    expect(out).toHaveLength(1)
    expect(out[0].getAttribute('data-host')).toBe('price')
  })

  it('RS line HIDDEN (visibility off) → the rating pane shows the strip', async () => {
    const keys = [prime(LINE.id), prime('rsRating')]
    const { container } = mount([inst('line-1', LINE.id, { hidden: true }), inst('rr-1', 'rsRating')])
    const out = await land(container, keys)
    expect(out).toHaveLength(1)
    expect(out[0].getAttribute('data-host')).toBe('pane')
  })

  it('RS line with its strip switched off → the rating pane shows the strip', async () => {
    const keys = [prime(LINE.id, { showRanksTable: false }), prime('rsRating')]
    const { container } = mount([inst('line-1', LINE.id, { inputs: { showRanksTable: false } }), inst('rr-1', 'rsRating')])
    const out = await land(container, keys)
    expect(out).toHaveLength(1)
    expect(out[0].getAttribute('data-host')).toBe('pane')
  })

  it('two RS lines + RS Rating → still one strip', async () => {
    const keys = [prime(LINE.id), prime('rsRating')]
    const { container } = mount([inst('line-1', LINE.id), inst('line-2', LINE.id), inst('rr-1', 'rsRating')])
    const out = await land(container, keys)
    expect(out).toHaveLength(1)
    expect(out[0].getAttribute('data-host')).toBe('price')
  })
})
