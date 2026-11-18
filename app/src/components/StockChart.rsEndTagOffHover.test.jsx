// app/src/components/StockChart.rsEndTagOffHover.test.jsx
//
// ─── UCT RS split, F3 · the line-end tag with NO readout payload ──────────────
//
// ⚰️ MEASURED ON THE PHONE (sandbox, 390 px, `_phone_rsline_only.png`, 2026-11-10):
// the `RS 82` tag never showed on the price pane while the desktop drew it. The
// price-pane host read its chips off `crosshairData`, and the phone shell mounts
// StockChart with `alwaysShowLegend: false` (`MobileChartsApp.stockChartProps`:
// the legend is a crosshair inspection tool there), so off-hover the payload is
// `null` and the tag existed only under a finger. A desktop legend folded to
// hover-only lost it the same way.
//
// The decision pinned here: the tag is pane furniture (the number at the line's
// end, like the axis' own last-value tag), so it is hosted from
// `offHoverEndTagChips` whenever the payload is absent — and ONLY the tag: the
// ranks strip and the pane readouts keep the legend's gates.
//
// Same harness as `StockChart.rsPriceHost.test.jsx` (lightweight-charts stubbed,
// boxes stubbed on the prototype); the one difference is the mount, which passes
// no `alwaysShowLegend`, exactly as the phone shell does.
/* global process */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const POINTS = [{ time: '2026-01-01', value: 0.2 }, { time: '2026-01-02', value: 0.25 }, { time: '2026-01-03' }]
vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
    attachPrimitive: () => {}, detachPrimitive: () => {},
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
const SYM = 'NVDA'
const RATING_INPUTS = RS.inputs.filter((i) => ['showRating', 'showRanksTable', 'ratingBands'].includes(i.key))
  .map(({ $refs: _r, ...i }) => ({ ...i, activeWhen: undefined }))
  .map((i) => Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)))
const END_LABEL = RS.plots.find((p) => p.key === 'rsLine').endLabel
const fixture = (id, placement) => Object.freeze({
  schemaVersion: 1, id, version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: { name: 'Off Hover Fixture', shortName: 'OHF', category: 'Momentum', repaint: 'non-repainting',
    paneTable: RS.meta.paneTable },
  placement,
  inputs: [{ key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 }, ...RATING_INPUTS],
  plots: [{ key: 'rsi', label: 'OHF', style: 'line', color: '#4ea1ff', width: 1, legend: { decimals: 1 }, endLabel: END_LABEL }],
  events: [],
  readout: [{ key: 'rating', label: 'Rating', source: 'scalar:rating.ibd', format: 'int', chip: true }],
})
const ON_PRICE = fixture('u_rs_off_hover_price', { target: 'price', ownScale: true })
const IN_PANE = fixture('u_rs_off_hover_pane', { target: 'pane', scale: { min: 0, max: 100 } })
const RATING = Object.freeze({ ibd: 94, fast: 91, asof: '2026-11-06', m1: 91, m3: 97, m6: 95, m9: 93, m12: 38, source: 'row' })

const bars = Array.from({ length: 80 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 + i }
})
const settings = (defId, inputs = {}) => mergeChartSettings({
  indicatorInstances: [{ instanceId: 'ohf-1', defId, inputs, hidden: false }],
})
// ⛔ NO `alwaysShowLegend`: the phone shell's mount (`MobileChartsApp.stockChartProps`).
const mount = (defId, tf = 'D', cs = settings(defId)) => render(
  <MemoryRouter><StockChart sym={SYM} tf={tf} barsOverride={bars} settingsOverride={cs} height={400} /></MemoryRouter>)

function prime(defId, tf = 'D', rating = RATING, stored = {}) {
  const def = registry.getDefinition(defId)
  const inputs = pickServerInputs(def, registry.resolveInputs(def, stored))
  primeServerColumns(defId, SYM, tf, inputs, { columns: {}, payload: { rating } })
  return serverColumnsKey(defId, SYM, tf, inputs)
}
const tableOf = (c) => c.querySelector('[data-pane-table]')
const tagOf = (c) => c.querySelector('[data-end-label]')
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
  const r = registry.installUserDefinitions([ON_PRICE, IN_PANE])
  expect(r.errors, 'the fixtures install').toEqual([])
})
afterEach(() => {
  cleanup()
  registry.uninstallUserDefinition(ON_PRICE.id)
  registry.uninstallUserDefinition(IN_PANE.id)
  clearServerColumns()
  Object.defineProperty(Element.prototype, 'clientHeight', realClientHeight)
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', realOffsetWidth)
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', realOffsetHeight)
  vi.unstubAllGlobals()
})

describe('the line-end tag with a hover-only legend (the phone shell)', () => {
  it('on price: `RS 94` rides the line off-hover, placed from the series\' own coordinates; the strip waits for a payload', async () => {
    const key = prime(ON_PRICE.id)
    const { container } = mount(ON_PRICE.id)
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(tagOf(container), 'the end tag').not.toBeNull(), { timeout: 8000, interval: 100 })
    const tag = tagOf(container)
    expect(tag.getAttribute('data-end-label')).toBe('ohf-1::rsi')
    expect(tag.textContent).toBe('RS 94')
    expect(tag.style.color).toBe('rgb(78, 161, 255)')
    await vi.waitFor(() => expect(tag.hasAttribute('data-hidden')).toBe(false), { timeout: 4000 })
    // `endLabelPlacement`: x = 500, y = 100, plot 600 wide from 0, tag 40 × 16
    expect(tag.style.left).toBe(`${500 - 4 - 40}px`)
    expect(tag.style.top).toBe(`${100 - 8}px`)
    expect(container.querySelectorAll('[data-end-label]')).toHaveLength(1)
    // ⛔ tags only: no readout payload, so no ranks strip and no legend chip
    await settle()
    expect(tableOf(container)).toBeNull()
    expect(container.querySelector('[data-instance-id="ohf-1"]')).toBeNull()
    expect(container.querySelector('[data-pane-legend]')).toBeNull()
  })

  it('in an indicator PANE: the tag shows while the pane readout (a legend surface) stays off-hover-less', async () => {
    const key = prime(IN_PANE.id)
    const { container } = mount(IN_PANE.id)
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(tagOf(container)).not.toBeNull(), { timeout: 8000, interval: 100 })
    expect(tagOf(container).textContent).toBe('RS 94')
    await settle()
    expect(container.querySelector('[data-pane-legend]')).toBeNull()
    expect(tableOf(container)).toBeNull()
  })

  it('⛔ Rating off → no tag (its `when` gate) off-hover either; nothing landed → nothing', async () => {
    const key = prime(ON_PRICE.id, 'D', RATING, { showRating: false })
    const { container } = mount(ON_PRICE.id, 'D', settings(ON_PRICE.id, { showRating: false }))
    await act(async () => { notifyColumnsLanded(key) })
    await settle()
    expect(tagOf(container)).toBeNull()
    cleanup()
    clearServerColumns()
    const { container: bare } = mount(ON_PRICE.id)
    await settle()
    expect(tagOf(bare)).toBeNull()
  })

  it('the phone shell really mounts without a persistent legend (the premise of this file)', () => {
    const src = readFileSync(join(process.cwd(), 'src/pages/charts/mobile/MobileChartsApp.jsx'), 'utf8')
    expect(src).toMatch(/alwaysShowLegend:\s*false/)
    const tagSrc = readFileSync(join(process.cwd(), 'src/components/chart/pane/PlotEndLabel.jsx'), 'utf8')
    expect(tagSrc).toMatch(/offHoverEndTagChips/)
  })
})
