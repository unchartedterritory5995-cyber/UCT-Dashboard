// app/src/components/StockChart.rsPriceHost.test.jsx
//
// ─── UCT RS split, U2 · the price-pane hosts on the real surface ─────────────
//
// Two things the engine could not draw before this unit, wired on the REAL
// StockChart with lightweight-charts stubbed (the rsPaneTable harness, same
// mocks, same reasons):
//   1. the ranks strip (`meta.paneTable`) for an instance drawn WITH THE CANDLES
//      (`placement.target: 'price'`, own scale): the same `PaneRanksTable`, keyed
//      `price`, hosted `price`, pinned left of the price scale on the legend's row;
//      none on a weekly chart, none with the member's switches off;
//   2. the line-end tag (`plots[].endLabel`): `RS 94` in the plot's colour at the
//      series' last finite point, positioned from the series' own
//      `priceToCoordinate` and the time scale's `timeToCoordinate`
//      (`endLabel.endLabelPlacement`), in the price pane AND in an indicator pane;
//      hidden while nothing has landed; gone with Rating off.
//
// ⚠️ jsdom measures every box as 0, so the stub gives the series two points, fixed
// coordinates, and `offsetWidth`/`offsetHeight` are stubbed on the prototype: the
// geometry asserted here is the pure model's arithmetic over those numbers. The
// real-screen look (desktop, 390 px) is the round's manual check.
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

// ── The fixtures: the RS ranks table + an end label, once ON PRICE, once in a pane ─
const RS = registry.getDefinition('rsLine')
const SYM = 'NVDA'
const RATING_INPUTS = RS.inputs.filter((i) => ['showRating', 'showRanksTable', 'ratingBands'].includes(i.key))
  .map(({ $refs: _r, ...i }) => ({ ...i, activeWhen: undefined }))
  .map((i) => Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)))
const END_LABEL = RS.plots.find((p) => p.key === 'rsLine').endLabel
const fixture = (id, placement) => Object.freeze({
  schemaVersion: 1, id, version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: { name: 'Price Host Fixture', shortName: 'PHF', category: 'Momentum', repaint: 'non-repainting',
    paneTable: RS.meta.paneTable },
  placement,
  inputs: [{ key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 }, ...RATING_INPUTS],
  // a literal colour (the RS line's `$color` resolves to one too): jsdom's style
  // declaration drops a `token:` spelling, which would make the ink assertion moot
  plots: [{ key: 'rsi', label: 'PHF', style: 'line', color: '#4ea1ff', width: 1, legend: { decimals: 1 }, endLabel: END_LABEL }],
  events: [],
  readout: [{ key: 'rating', label: 'Rating', source: 'scalar:rating.ibd', format: 'int', chip: true }],
})
const ON_PRICE = fixture('u_rs_on_price', { target: 'price', ownScale: true })
const IN_PANE = fixture('u_rs_in_pane', { target: 'pane', scale: { min: 0, max: 100 } })
const RATING = Object.freeze({ ibd: 94, fast: 91, asof: '2026-11-06', m1: 91, m3: 97, m6: 95, m9: 93, m12: 38, source: 'row' })

const bars = Array.from({ length: 80 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 + i }
})
const settings = (defId, inputs = {}) => mergeChartSettings({
  indicatorInstances: [{ instanceId: 'phf-1', defId, inputs, hidden: false }],
})
const mount = (defId, tf = 'D', cs = settings(defId)) => render(
  <MemoryRouter><StockChart sym={SYM} tf={tf} barsOverride={bars} settingsOverride={cs} alwaysShowLegend height={400} /></MemoryRouter>)

function prime(defId, tf = 'D', rating = RATING, stored = {}) {
  const def = registry.getDefinition(defId)
  const inputs = pickServerInputs(def, registry.resolveInputs(def, stored))
  primeServerColumns(defId, SYM, tf, inputs, { columns: {}, payload: { rating } })
  return serverColumnsKey(defId, SYM, tf, inputs)
}
const tableOf = (c) => c.querySelector('[data-pane-table]')
const tagOf = (c) => c.querySelector('[data-end-label]')
const cells = (el, sel) => [...el.querySelectorAll(sel)].map((c) => c.textContent)
const settle = () => new Promise((r) => setTimeout(r, 300))

const realClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
const realOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
const realOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
beforeEach(() => {
  cleanup()
  clearServerColumns()
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 400 })
  // ⭐ every box measures 40 × 16: the tag's own box in `endLabelPlacement`, and the
  // strip's width in `paneTableFits` (40 px fits a 600 px plot with the legend at 0)
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

describe('the ranks strip hosted by the PRICE pane', () => {
  it('no envelope → nothing; once it lands → the strip, keyed and hosted `price`, pinned left of the price scale, not collapsed', async () => {
    const { container } = mount(ON_PRICE.id)
    await vi.waitFor(() => expect(container.querySelector('[data-instance-id="phf-1"]'), 'the legend chip').not.toBeNull(), { timeout: 8000 })
    // on price there is no pane readout to host it, and nothing has landed
    expect(container.querySelector('[data-pane-legend]')).toBeNull()
    expect(tableOf(container)).toBeNull()
    expect(tagOf(container)).toBeNull()
    const key = prime(ON_PRICE.id)
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(tableOf(container), 'the ranks strip').not.toBeNull(), { timeout: 8000, interval: 100 })
    const el = tableOf(container)
    expect(el.getAttribute('data-pane-table')).toBe('price')
    expect(el.getAttribute('data-host')).toBe('price')
    expect(el.getAttribute('role')).toBe('group')
    // the same markup the pane version draws, number for number
    expect(cells(el, 'dt')).toEqual(['1M', '3M', '6M', '9M', '12M', 'RS'])
    expect(cells(el, 'dd')).toEqual(['91', '97', '95', '93', '38', '94'])
    expect(el.querySelector('[data-col="m12"] dd').getAttribute('data-band')).toBe('lag')
    // pinned: right of the plot (the stub's price scale is 0 wide ⇒ 6 px), on the
    // legend's row (jsdom's legend rect sits at 0), and it fits a 600 px plot
    await vi.waitFor(() => expect(el.style.right).toBe('6px'))
    expect(el.style.top).toBe('0px')
    expect(el.hasAttribute('data-collapsed')).toBe(false)
    // still no pane readout: the strip is price-pane furniture, not a pane label
    expect(container.querySelector('[data-pane-legend]')).toBeNull()
  })

  it('⭐ a re-render forces no layout from the strip: its ref attaches once, and the strip stays where it was pinned', async () => {
    const cs = settings(ON_PRICE.id)
    const view = mount(ON_PRICE.id, 'D', cs)
    const { container } = view
    const key = prime(ON_PRICE.id)
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(tableOf(container), 'the ranks strip').not.toBeNull(), { timeout: 8000, interval: 100 })
    const el = tableOf(container)
    await vi.waitFor(() => expect(el.style.right).toBe('6px'))
    // every layout read from here on, with WHERE it was made
    const reads = []
    const real = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function (...a) { reads.push(new Error().stack || ''); return real.apply(this, a) }
    try {
      // re-renders of the chart with the strip on screen (a new height prop: the chart renders, the strip stays)
      for (const h of [401, 402, 403]) {
        view.rerender(<MemoryRouter><StockChart sym={SYM} tf="D" barsOverride={bars} settingsOverride={cs} alwaysShowLegend height={h} /></MemoryRouter>)
        await act(async () => {})
      }
    } finally { Element.prototype.getBoundingClientRect = real }
    // ⛔ none of them came from attaching the strip's ref inside a commit (an inline ref re-attaches every render)
    const fromRefAttach = reads.filter((st) => /pinPriceTable/.test(st) && /AttachRef|attachRef/.test(st))
    expect(fromRefAttach, fromRefAttach[0] || '').toEqual([])
    expect(tableOf(container)).toBe(el)
    expect(el.style.right).toBe('6px')
    expect(el.style.top).toBe('0px')
    expect(el.hasAttribute('data-collapsed')).toBe(false)
  })

  it('⛔ a weekly chart draws no strip (the ranks are daily) — the end tag still rides the line', async () => {
    const key = prime(ON_PRICE.id, 'W')
    const { container } = mount(ON_PRICE.id, 'W')
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(tagOf(container)).not.toBeNull(), { timeout: 8000 })
    await settle()
    expect(tableOf(container)).toBeNull()
    expect(tagOf(container).textContent).toBe('RS 94')
  })

  it('⛔ the member\'s Ranks table switch off → no strip; the tag is unaffected', async () => {
    const key = prime(ON_PRICE.id, 'D', RATING, { showRanksTable: false })
    const { container } = mount(ON_PRICE.id, 'D', settings(ON_PRICE.id, { showRanksTable: false }))
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(tagOf(container)).not.toBeNull(), { timeout: 8000 })
    await settle()
    expect(tableOf(container)).toBeNull()
  })
})

describe('the line-end tag', () => {
  it('on price: `RS 94` in the plot\'s colour, right-aligned 4 px left of the point, centred on it, shown', async () => {
    const key = prime(ON_PRICE.id)
    const { container } = mount(ON_PRICE.id)
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(tagOf(container), 'the end tag').not.toBeNull(), { timeout: 8000, interval: 100 })
    const tag = tagOf(container)
    expect(tag.getAttribute('data-end-label')).toBe('phf-1::rsi')
    expect(tag.textContent).toBe('RS 94')
    expect(tag.style.color).toBe('rgb(78, 161, 255)')
    expect(tag.getAttribute('aria-hidden')).toBe('true')
    // the class carries "legend": the newsletter export hides it with the pane label
    expect(tag.className).toMatch(/legend/i)
    // ⛔ not a chip: the tour and the chip-count rails read `data-instance-id`
    expect(tag.hasAttribute('data-instance-id')).toBe(false)
    // geometry (`endLabelPlacement`): x = 500 (time scale), y = 100 (the series' own
    // scale), plot 600 wide from 0, pane 300 tall from 0, tag 40 × 16
    await vi.waitFor(() => expect(tag.hasAttribute('data-hidden')).toBe(false), { timeout: 4000 })
    expect(tag.style.left).toBe(`${500 - 4 - 40}px`)
    expect(tag.style.top).toBe(`${100 - 8}px`)
    // only ONE tag: the fixture's one plot
    expect(container.querySelectorAll('[data-end-label]')).toHaveLength(1)
  })

  it('in an indicator PANE: the same tag, from the same series coordinates, beside the pane readout', async () => {
    const key = prime(IN_PANE.id)
    const { container } = mount(IN_PANE.id)
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(container.querySelector('[data-pane-legend]')).not.toBeNull(), { timeout: 8000 })
    await vi.waitFor(() => expect(tagOf(container)).not.toBeNull(), { timeout: 8000, interval: 100 })
    const tag = tagOf(container)
    expect(tag.textContent).toBe('RS 94')
    await vi.waitFor(() => expect(tag.hasAttribute('data-hidden')).toBe(false), { timeout: 4000 })
    expect(tag.style.left).toBe('456px')
    // and the pane's own strip is the PANE version (host `pane`), not the price one
    const table = tableOf(container)
    expect(table).not.toBeNull()
    expect(table.getAttribute('data-host')).toBe('pane')
    expect(table.getAttribute('data-pane-table')).toBe(container.querySelector('[data-pane-legend]').getAttribute('data-pane-legend'))
  })

  // ⚡ (2026-11-26, the 4h board's switch) A RE-RENDER READS NO BOX FROM THE TAG AND RE-ATTACHES NOTHING. The tag's ref was an
  // inline arrow, re-attached on every commit of the readout island, and each re-attach pinned it with a fresh
  // `offsetWidth` read (a forced layout inside the commit: 1.46 ms of a 4h switch). Its box is kept per text now
  // (chart/pane/endLabelSize.js), its ref is one function per key, and the island's renders queue one pass per task.
  it('⭐ re-renders read no box from the tag, pin it once per commit at most, and leave it where it was pinned', async () => {
    const cs = settings(ON_PRICE.id)
    const view = mount(ON_PRICE.id, 'D', cs)
    const { container } = view
    const key = prime(ON_PRICE.id)
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(tagOf(container), 'the end tag').not.toBeNull(), { timeout: 8000, interval: 100 })
    const tag = tagOf(container)
    await vi.waitFor(() => expect(tag.hasAttribute('data-hidden')).toBe(false), { timeout: 4000 })
    await settle()
    expect(tag.style.left).toBe(`${500 - 4 - 40}px`)
    const top0 = tag.style.top
    let reads = 0
    let pins = 0
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { if (this === tag) reads += 1; return 40 } })
    const text = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')
    // every pin reads the tag's text once (`el.textContent !== text`): the count of pins
    Object.defineProperty(tag, 'textContent', { configurable: true, get() { pins += 1; return text.get.call(this) }, set(v) { text.set.call(this, v) } })
    try {
      for (const h of [401, 402, 403]) {
        view.rerender(<MemoryRouter><StockChart sym={SYM} tf="D" barsOverride={bars} settingsOverride={cs} alwaysShowLegend height={h} /></MemoryRouter>)
        await act(async () => {})
      }
    } finally { delete tag.textContent }
    expect(reads, 'the tag\'s box was read again for the same text').toBe(0)
    expect(pins, 'pinned more than once per commit (a ref re-attached as well as the queued pass)').toBeLessThanOrEqual(3)
    expect(tagOf(container)).toBe(tag)
    expect(tag.textContent).toBe('RS 94')
    expect(tag.style.left).toBe(`${500 - 4 - 40}px`)
    expect(tag.style.top).toBe(top0)
    expect(tag.hasAttribute('data-hidden')).toBe(false)
  })

  it('⭐ a new rating re-places the tag in the task it lands (its new box), without waiting for the frame loop', async () => {
    // the tag's box follows its text here (8 px a character): 'RS 94' is 40 wide, 'RS 9' is 32
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true,
      get() { return this.hasAttribute && this.hasAttribute('data-end-label') ? (this.textContent || '').length * 8 : 40 } })
    const key = prime(ON_PRICE.id)
    const { container } = mount(ON_PRICE.id)
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(tagOf(container), 'the end tag').not.toBeNull(), { timeout: 8000, interval: 100 })
    const tag = tagOf(container)
    await vi.waitFor(() => expect(tag.style.left).toBe(`${500 - 4 - 40}px`), { timeout: 4000 })
    await settle()
    const key2 = prime(ON_PRICE.id, 'D', { ...RATING, ibd: 9 })
    expect(key2).toBe(key)
    await act(async () => { notifyColumnsLanded(key2) })
    // no waitFor: the readout's render and its queued pass run inside this task, before any animation frame
    expect(tagOf(container)).toBe(tag)
    expect(tag.textContent).toBe('RS 9')
    expect(tag.style.left, 'the tag kept the old box: it was not re-placed in the task the rating landed').toBe(`${500 - 4 - 32}px`)
  })

  // (review of #2831) the models are recorded, and the pass queued, from a layout effect after the island's commit: a
  // NEW tag (no model at its ref) is placed and shown by that commit's pass, in the task it mounts
  it('⭐ a tag that mounts is placed and shown in the task it mounts, by its commit\'s pass', async () => {
    const { container } = mount(ON_PRICE.id)
    await vi.waitFor(() => expect(container.querySelector('[data-instance-id="phf-1"]'), 'the legend chip').not.toBeNull(), { timeout: 8000 })
    expect(tagOf(container), 'nothing has landed: no tag yet').toBeNull()
    const key = prime(ON_PRICE.id)
    await act(async () => { notifyColumnsLanded(key) })
    // no waitFor once it exists: the commit that mounted it placed it
    await vi.waitFor(() => expect(tagOf(container), 'the end tag').not.toBeNull(), { timeout: 8000, interval: 20 })
    const tag = tagOf(container)
    expect(tag.textContent).toBe('RS 94')
    expect(tag.hasAttribute('data-hidden'), 'mounted but never placed').toBe(false)
    expect(tag.style.left).toBe(`${500 - 4 - 40}px`)
    expect(tag.style.top).toBe(`${100 - 8}px`)
  })

  it('⛔ Rating off → no tag (its `when` gate), though the envelope landed', async () => {
    const key = prime(ON_PRICE.id, 'D', RATING, { showRating: false })
    const { container } = mount(ON_PRICE.id, 'D', settings(ON_PRICE.id, { showRating: false }))
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(container.querySelector('[data-instance-id="phf-1"]')).not.toBeNull(), { timeout: 8000 })
    await settle()
    expect(tagOf(container)).toBeNull()
    expect(tableOf(container)).toBeNull()
  })

  it('the stylesheet: the legend chips\' type (11 px, 600, tabular), the panel tokens, no hard-coded ink, hidden by visibility', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/chart/pane/PlotEndLabel.module.css'), 'utf8')
    expect(css).toMatch(/font-size:\s*11px/)
    expect(css).toMatch(/font-weight:\s*600/)
    expect(css).toMatch(/font-variant-numeric:\s*tabular-nums/)
    expect(css).toMatch(/background:\s*var\(--chart-panel-bg-low/)
    expect(css).toMatch(/border:\s*1px solid var\(--chart-panel-border-low/)
    expect(css).toMatch(/\[data-hidden\]\s*\{\s*visibility:\s*hidden/)
    expect(css).toMatch(/pointer-events:\s*none/)
    expect(css).not.toMatch(/gold|#c9a84c|#dcbb5e/i)
    // the price host of the ranks strip takes the TOP sample's inks and ground
    const strip = readFileSync(join(process.cwd(), 'src/components/chart/pane/PaneRanksTable.module.css'), 'utf8')
    expect(strip).toMatch(/\[data-host="price"\]\s*\{[^}]*background:\s*var\(--chart-panel-bg,[^}]*--legend-ink-bright:\s*inherit/)
  })
})
