// app/src/components/StockChart.rsVA2.test.jsx
//
// ─── UCT RS unit VA2 — the rating group on the REAL StockChart surfaces ─────
//
// The readout half is pinned purely in `engine/__tests__/readoutSchema.va2.test.js`;
// this is what a member SEES, with lightweight-charts stubbed (the harness of
// `StockChart.rsReadout.test.jsx`, same mocks, same reasons):
//   1. BANDS — a row carrying a `band` paints its value in the band's ink
//      (`data-band` + the band class), in the menu and in the card's numbers;
//      with the member's switch off, no row carries one.
//   2. THE PANE LABEL — `chipWhen` / `chipPrefix`: the headline input decides
//      which number rides the label, the fast one labelled.
//   3. TELEMETRY — opening a card counts `rs_marker_card` for UCT RS only (the
//      fixture is not UCT RS, so it must count nothing).
/* global process */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── Render harness: the staleReadout suite's mocks (same stubs, same reasons) ──
vi.mock('lightweight-charts', () => {
  const series = {
    setData: () => {}, update: () => {}, applyOptions: () => {},
    priceScale: () => ({ applyOptions: () => {} }),
    createPriceLine: () => ({}), removePriceLine: () => {}, setMarkers: () => {},
    attachPrimitive: () => {}, detachPrimitive: () => {}, priceToCoordinate: () => 0,
    coordinateToPrice: () => 0, options: () => ({}), dataByIndex: () => null,
    getPane: () => ({ getHeight: () => 300, paneIndex: () => 0, setStretchFactor: () => {}, getSeries: () => [] }),
    barsInLogicalRange: () => null, data: () => [], seriesType: () => 'Candlestick',
    priceFormatter: () => ({ format: (v) => String(v) }), moveToPane: () => {},
  }
  const timeScale = {
    applyOptions: () => {}, fitContent: () => {}, setVisibleLogicalRange: () => {},
    getVisibleLogicalRange: () => null, setVisibleRange: () => {}, scrollToPosition: () => {},
    subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {},
    timeToCoordinate: () => 0, coordinateToTime: () => null, resetTimeScale: () => {},
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

// Import AFTER the mocks are registered.
const { default: StockChart } = await import('./StockChart')
const { mergeChartSettings } = await import('./chart/chartDefaults')
const registry = await import('./chart/engine/nativeRegistry')
const { primeServerColumns, clearServerColumns, notifyColumnsLanded, serverColumnsKey, pickServerInputs, scalarsFor } =
  await import('./chart/engine/serverCompute')
const { legendChips, paneReadoutLabel } = await import('./chart/engine/readout')
const { __setRsTelemetrySink } = await import('../lib/rsTelemetry')

const DEF_ID = 'u_rs_va2_bands'
const SYM = 'ENPH'
const TF = 'D'
const CARD = Object.freeze({ what: 'The rating, 1 to 99.', origin: 'IBD-style.' })
const FIXTURE = Object.freeze({
  schemaVersion: 1, id: DEF_ID, version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: { name: 'Band Fixture', shortName: 'BF', category: 'Momentum', repaint: 'non-repainting', legendParams: ['benchmark'] },
  placement: { target: 'pane', scale: { min: 0, max: 100 } },
  inputs: [
    { key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 },
    { key: 'benchmark', type: 'enum', label: 'Benchmark', default: 'SPY', options: [['SPY', 'S&P 500'], ['SECTOR', 'Sector ETF']] },
    { key: 'bands', type: 'bool', label: 'Rating colours', default: true },
    { key: 'headline', type: 'enum', label: 'Headline', default: 'both', options: [['ibd', 'IBD'], ['fast', 'Fast'], ['both', 'Both']] },
  ],
  plots: [{ key: 'rsi', label: 'BF', style: 'line', color: 'token:info', width: 1, legend: { decimals: 1 } }],
  events: [],
  readout: [
    { key: 'benchmark', label: 'Benchmark', source: 'scalar:benchmark.resolved', format: 'text', chip: true },
    { key: 'ratingSummary', label: 'Rating', source: 'scalar:rating.summary', format: 'text', card: CARD,
      band: { source: 'scalar:rating.ibd', when: 'input:bands' } },
    { key: 'rating', label: 'IBD-style', source: 'scalar:rating.ibd', format: 'int', detailOf: 'ratingSummary',
      chip: true, chipWhen: { key: 'headline', in: ['ibd', 'both'] }, band: { source: 'scalar:rating.ibd', when: 'input:bands' } },
    { key: 'fastRating', label: 'Fast', source: 'scalar:rating.fast', format: 'int', detailOf: 'ratingSummary',
      chip: true, chipWhen: { key: 'headline', in: ['fast', 'both'] }, chipPrefix: 'fast',
      band: { source: 'scalar:rating.fast', when: 'input:bands' } },
  ],
})
const PAYLOAD = Object.freeze({
  benchmark: { requested: 'SPY', resolved: 'XLK', label: 'Technology (XLK)', fallback: null, bars: 330 },
  rating: { ibd: 94, fast: 35, summary: '94 · fast 35' },
})
const bars = Array.from({ length: 80 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 + i }
})
const settingsFor = (inputs) => mergeChartSettings({
  indicatorInstances: [{ instanceId: 'bf-1', defId: DEF_ID, inputs, hidden: false }],
})
function primeFixture(inputs) {
  const def = registry.getDefinition(DEF_ID)
  const keyInputs = pickServerInputs(def, registry.resolveInputs(def, inputs))
  primeServerColumns(DEF_ID, SYM, TF, keyInputs, { columns: {}, payload: PAYLOAD })
  return serverColumnsKey(DEF_ID, SYM, TF, keyInputs)
}
const chipEl = (container) => container.querySelector('[data-instance-id="bf-1"]')
const menuEl = () => document.querySelector('[data-guide="chart.chipMenu"]')
const openMenuWithRows = async (container) => {
  let menu
  await vi.waitFor(async () => {
    await vi.waitFor(() => expect(chipEl(container)).not.toBeNull(), { timeout: 8000 })
    await act(async () => { fireEvent.contextMenu(chipEl(container)) })
    await vi.waitFor(() => expect(menuEl()).not.toBeNull())
    menu = menuEl()
    if (!menu.querySelector('[data-readout-rows]')) {
      await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
      throw new Error('rows not yet derived')
    }
  }, { timeout: 8000, interval: 150 })
  return menu
}
// ⛔ `settingsOverride` is a memo dependency: built once per mount, never per render.
const mountWith = async (inputs) => {
  const settings = settingsFor(inputs)
  const out = render(
    <MemoryRouter>
      <StockChart sym={SYM} tf={TF} barsOverride={bars} settingsOverride={settings} alwaysShowLegend height={400} />
    </MemoryRouter>,
  )
  const key = primeFixture(inputs)
  await act(async () => { notifyColumnsLanded(key) })
  return out
}

const realClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
beforeEach(() => {
  cleanup()
  clearServerColumns()
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 400 })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  const r = registry.installUserDefinitions([FIXTURE])
  expect(r.errors, 'the fixture installs').toEqual([])
})
afterEach(() => {
  cleanup()
  registry.uninstallUserDefinition(DEF_ID)
  clearServerColumns()
  __setRsTelemetrySink(null)
  Object.defineProperty(Element.prototype, 'clientHeight', realClientHeight)
  vi.unstubAllGlobals()
})

describe('rating bands on the readout surfaces', () => {
  it('the menu row and the card numbers wear the band ink; the benchmark row wears none', async () => {
    const sent = []
    __setRsTelemetrySink((e, p) => sent.push([e, p]))
    const { container } = await mountWith({})
    const menu = await openMenuWithRows(container)
    const val = menu.querySelector('[data-readout-row="ratingSummary"] [data-band]')
    expect(val, 'the Rating row carries its band').not.toBeNull()
    expect(val.getAttribute('data-band')).toBe('lead')
    expect(val.className).toMatch(/legBandLead/)
    expect(menu.querySelector('[data-readout-row="benchmark"] [data-band]')).toBeNull()
    // the card's numbers block: IBD-style 94 lead, Fast 35 lag
    await act(async () => { fireEvent.click(menu.querySelector('[data-readout-row="ratingSummary"]')) })
    await vi.waitFor(() => expect(document.querySelector('[data-legend-card="ratingSummary"]')).not.toBeNull())
    const card = document.querySelector('[data-legend-card="ratingSummary"]')
    expect(card.querySelector('[data-card-number="rating"] [data-band]').getAttribute('data-band')).toBe('lead')
    expect(card.querySelector('[data-card-number="fastRating"] [data-band]').getAttribute('data-band')).toBe('lag')
    // the fixture is not UCT RS: opening its card counts nothing
    expect(sent).toEqual([])
  })

  it('with the member\'s switch off, no row carries a band', async () => {
    const { container } = await mountWith({ bands: false })
    const menu = await openMenuWithRows(container)
    expect(menu.querySelectorAll('[data-band]')).toHaveLength(0)
  })

  it('the stylesheet gives each band a theme token, above the card value\'s own rule', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/StockChart.module.css'), 'utf8')
    expect(css).toMatch(/\.legCardNumVal\.legBandLead[^{]*\{\s*color:\s*var\(--gain\)/)
    expect(css).toMatch(/\.legCardNumVal\.legBandNeutral[^{]*\{\s*color:\s*var\(--warn\)/)
    expect(css).toMatch(/\.legCardNumVal\.legBandLag[^{]*\{\s*color:\s*var\(--loss\)/)
  })
})

describe('the headline decides the pane label', () => {
  const chipsOf = (inputs) => {
    const b = { instanceId: 'bf-1', defId: DEF_ID, plotKey: 'rsi', series: { __id: 'x' }, lastValue: 50 }
    const inst = { instanceId: 'bf-1', defId: DEF_ID, inputs, hidden: false }
    return legendChips([b], null, registry, [inst], { scalarsOf: () => PAYLOAD })[0]
  }
  it('both → `94 · fast 35`; ibd → `94`; fast → `fast 35`', () => {
    expect(chipsOf({}).suffix).toBe(' · XLK · 94 · fast 35')
    expect(chipsOf({ headline: 'ibd' }).suffix).toBe(' · XLK · 94')
    expect(chipsOf({ headline: 'fast' }).suffix).toBe(' · XLK · fast 35')
    expect(paneReadoutLabel(chipsOf({ headline: 'fast' }), registry.getDefinition(DEF_ID), null)).toBe('Band Fixture · XLK · fast 35')
  })
})
