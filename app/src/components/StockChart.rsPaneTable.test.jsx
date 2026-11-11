// app/src/components/StockChart.rsPaneTable.test.jsx
//
// ─── UCT RS design round (2026-11-08) · the ranks table on the real surface ──
//
// `meta.paneTable` resolves on the chip (`readout.js` → `paneTable.paneTableFor`)
// and StockChart draws it as `PaneRanksTable` in the pane's top-right corner,
// pinned by `pinPaneLegend` in the same frame as the pane label. This file pins:
//   1. the component's DOM (header codes, ranks, bands, the muted dash, 9M);
//   2. the wire on the REAL StockChart with lightweight-charts stubbed (the
//      staleReadout / rsReadout harness): no envelope, no table; an envelope on
//      a daily chart, the table, in the label's pane, pinned left of the scale;
//      a weekly chart or the member's switch off, none.
//
// ⚠️ NO BROWSER LAYOUT HERE. jsdom measures every box as 0, so the collision rule
// (`paneTableFits`, unit-tested in `rsDesignRound.test.js`) always fits here; the
// real-screen look at desktop and 390 px is a manual check (see the round report).
/* global process */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
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
const { default: PaneRanksTable } = await import('./chart/pane/PaneRanksTable')
const { mergeChartSettings } = await import('./chart/chartDefaults')
const registry = await import('./chart/engine/nativeRegistry')
const { primeServerColumns, clearServerColumns, notifyColumnsLanded, serverColumnsKey, pickServerInputs } =
  await import('./chart/engine/serverCompute')
const { paneTableFor } = await import('./chart/engine/paneTable')

// ── The fixture: an own-pane definition that declares the RS ranks table ─────
// ⛔ Installed through `installUserDefinitions` (the door a chart resolves a
// non-shipped definition through), on the native lane (`fn: 'rsi'`), so no
// request and no worker are involved; its `meta.paneTable` is the RS
// definition's own, so this pins the SHIPPED table grammar on the real surface.
const RS = registry.getDefinition('rsLine')
const DEF_ID = 'u_rs_pane_table'
const SYM = 'NVDA'
const RATING_INPUTS = RS.inputs.filter((i) => ['showRating', 'showRanksTable', 'ratingBands'].includes(i.key))
  .map(({ $refs: _r, ...i }) => ({ ...i, activeWhen: undefined }))
  .map((i) => Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)))
const FIXTURE = Object.freeze({
  schemaVersion: 1, id: DEF_ID, version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: { name: 'Ranks Fixture', shortName: 'RKF', category: 'Momentum', repaint: 'non-repainting',
    paneTable: RS.meta.paneTable },
  placement: { target: 'pane', scale: { min: 0, max: 100 } },
  inputs: [{ key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 }, ...RATING_INPUTS],
  plots: [{ key: 'rsi', label: 'RKF', style: 'line', color: 'token:info', width: 1, legend: { decimals: 1 } }],
  events: [],
  readout: [{ key: 'rating', label: 'Rating', source: 'scalar:rating.ibd', format: 'int', chip: true }],
})
// Round 2 (rev 5): the v4 payload carries the 9-month rank too.
const RATING = Object.freeze({ ibd: 94, fast: 91, asof: '2026-11-06', m1: 91, m3: 97, m6: 95, m9: 93, m12: 38, source: 'row' })

const bars = Array.from({ length: 80 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 + i }
})
const settings = (inputs = {}) => mergeChartSettings({
  indicatorInstances: [{ instanceId: 'rkf-1', defId: DEF_ID, inputs, hidden: false }],
})
const SETTINGS = settings()
const mount = (tf = 'D', cs = SETTINGS) => render(
  <MemoryRouter><StockChart sym={SYM} tf={tf} barsOverride={bars} settingsOverride={cs} alwaysShowLegend height={400} /></MemoryRouter>)

function prime(tf = 'D', rating = RATING, stored = {}) {
  const def = registry.getDefinition(DEF_ID)
  const inputs = pickServerInputs(def, registry.resolveInputs(def, stored))
  primeServerColumns(DEF_ID, SYM, tf, inputs, { columns: {}, payload: { rating } })
  return serverColumnsKey(DEF_ID, SYM, tf, inputs)
}
const tableOf = (container) => container.querySelector('[data-pane-table]')
const cells = (el, sel) => [...el.querySelectorAll(sel)].map((c) => c.textContent)

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
  Object.defineProperty(Element.prototype, 'clientHeight', realClientHeight)
  vi.unstubAllGlobals()
})

describe('PaneRanksTable — the DOM it draws, pinned', () => {
  const t = (rating, inputs) => paneTableFor(RS, { rating: { ...RATING, ...rating } }, { inputs })

  it('ONE row of code-and-rank pairs (a description list), the rating last and set apart', () => {
    const { container } = render(<PaneRanksTable table={t({ m12: 96 })} paneKey="rs" />)
    const root = container.firstElementChild
    expect(root.getAttribute('data-pane-table')).toBe('rs')
    expect(root.getAttribute('role')).toBe('group')
    expect(root.getAttribute('aria-label')).toBe('RS ranks')
    expect(cells(root, 'dt')).toEqual(['1M', '3M', '6M', '9M', '12M', 'RS'])
    expect(cells(root, 'dd')).toEqual(['91', '97', '95', '93', '96', '94'])
    // every pair is a code and its rank, in one list: ONE row (the real-screen fix:
    // a two-row table covered the RS line's newest bars in the pane's top-right)
    expect(root.querySelectorAll('dl')).toHaveLength(1)
    expect([...root.querySelectorAll('dl > div')].map((d) => d.getAttribute('data-col'))).toEqual(['m1', 'm3', 'm6', 'm9', 'm12', 'rating'])
    expect(root.querySelector('[data-col="rating"]').className).toMatch(/legendRankEmph/)
    expect(root.querySelectorAll('[class*="legendRankEmph"]')).toHaveLength(1)
    // the class names carry "legend": the newsletter export hides it with the pane label
    expect(root.className).toMatch(/legend/i)
    expect(root.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('bands: lead / strong / neutral / lag on the values only while Rating colours is on; a missing rank is a muted dash', () => {
    const { container, rerender } = render(<PaneRanksTable table={t({ m1: 35, m3: 45, m6: 65, m12: null })} />)
    const td = (k) => container.querySelector(`[data-col="${k}"] dd`)
    expect(['m1', 'm3', 'm6', 'rating'].map((k) => td(k).getAttribute('data-band'))).toEqual(['lag', 'neutral', 'strong', 'lead'])
    expect(td('m12').textContent).toBe('–')
    expect(td('m12').hasAttribute('data-missing')).toBe(true)
    expect(td('m12').getAttribute('aria-label')).toBe('12M not rated')
    expect(td('m12').hasAttribute('data-band')).toBe(false)
    rerender(<PaneRanksTable table={t({ m1: 35 }, { ratingBands: false })} />)
    expect(container.querySelectorAll('[data-band]')).toHaveLength(0)
  })

  it('the 9M column is required since round 2: between 6M and 12M, a muted dash until the row holds it', () => {
    const { container } = render(<PaneRanksTable table={t({ m9: 93, m12: 96 })} />)
    expect(cells(container, 'dt')).toEqual(['1M', '3M', '6M', '9M', '12M', 'RS'])
    cleanup()
    const dash = render(<PaneRanksTable table={t({ m9: null, m12: 96 })} />).container
    expect(dash.querySelector('[data-col="m9"] dd').textContent).toBe('–')
    expect(dash.querySelector('[data-col="m9"] dd').getAttribute('aria-label')).toBe('9M not rated')
  })

  it('the canvas tone rides the element (dark by default, light on request)', () => {
    const a = render(<PaneRanksTable table={t({ m12: 96 })} />).container.firstElementChild
    expect(a.getAttribute('data-canvas')).toBe('dark')
    cleanup()
    const b = render(<PaneRanksTable table={t({ m12: 96 })} canvas="light" />).container.firstElementChild
    expect(b.getAttribute('data-canvas')).toBe('light')
  })

  it('nothing to draw draws nothing', () => {
    expect(render(<PaneRanksTable table={null} />).container.firstElementChild).toBeNull()
  })

  it('the stylesheet: 11 px tabular numbers, neutral inks, the band tokens, no gold, and a collapse that keeps its width', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/chart/pane/PaneRanksTable.module.css'), 'utf8')
    expect(css).toMatch(/font-size:\s*11px/)
    expect(css).toMatch(/font-variant-numeric:\s*tabular-nums/)
    expect(css).not.toMatch(/gold|#c9a84c|#dcbb5e|premium/i)
    expect(css).toMatch(/\.legendRankVal\.legendRankLead\s*\{\s*color:\s*var\(--rank-lead\)/)
    expect(css).toMatch(/\.legendRankVal\.legendRankLag\s*\{\s*color:\s*var\(--rank-lag\)/)
    // the band inks are the theme's own: dark gain / warn / loss, or the light theme's on a light canvas
    expect(css).toMatch(/--rank-lead:\s*var\(--gain\)/)
    expect(css).toMatch(/\[data-canvas="light"\]\s*\{[^}]*--rank-lead:\s*#0a5c22[^}]*--rank-neutral:\s*#7a5c16[^}]*--rank-lag:\s*#7d1620/)
    // and the neutral inks are the pane label's canvas-aware ones
    expect(css).toMatch(/--legend-ink-bright:\s*var\(--legend-ink-bright-low/)
    expect(css).toMatch(/--legend-ink-muted:\s*var\(--legend-ink-muted-low/)
    expect(css).toMatch(/\[data-collapsed\]\s*\{\s*visibility:\s*hidden/)
    expect(css).toMatch(/pointer-events:\s*none/)
    expect(css).toMatch(/white-space:\s*nowrap/)
  })
})

describe('on the real StockChart: the table rides its pane, daily only', () => {
  it('no envelope → no table; once the envelope lands → the ranks table, pinned beside the pane label', async () => {
    const { container } = mount()
    await vi.waitFor(() => expect(container.querySelector('[data-pane-legend]'), 'the pane readout').not.toBeNull(), { timeout: 8000 })
    expect(tableOf(container)).toBeNull()
    const key = prime()
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(tableOf(container), 'the ranks table').not.toBeNull(), { timeout: 8000, interval: 100 })
    const el = tableOf(container)
    expect(cells(el, 'dt')).toEqual(['1M', '3M', '6M', '9M', '12M', 'RS'])
    expect(cells(el, 'dd')).toEqual(['91', '97', '95', '93', '38', '94'])
    // the same pane as its label, and pinned by the same frame: top written, right of
    // the plot (the stub's price scale is 0 wide ⇒ 6 px), not collapsed on a 600 px plot
    const legend = container.querySelector('[data-pane-legend]')
    expect(el.getAttribute('data-pane-table')).toBe(legend.getAttribute('data-pane-legend'))
    await vi.waitFor(() => expect(el.style.right).toBe('6px'))
    // 1 px under the pane top where the label sits 3 px under it: the 16 px strip
    // ends inside the band the scale keeps clear above the line
    expect(parseInt(el.style.top, 10)).toBe(parseInt(legend.style.top, 10) - 2)
    expect(el.hasAttribute('data-collapsed')).toBe(false)
    // the 12M rank (38) is below 40: the lag band, while Rating colours is on by default
    expect(el.querySelector('[data-col="m12"] dd').getAttribute('data-band')).toBe('lag')
  })

  it('⛔ a weekly chart draws no table (the ratings are daily)', async () => {
    const key = prime('W')
    const { container } = mount('W')
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(container.querySelector('[data-pane-legend]')).not.toBeNull(), { timeout: 8000 })
    await new Promise((r) => setTimeout(r, 300))
    expect(tableOf(container)).toBeNull()
    // control: the envelope landed on this weekly chart (its rating rides the label)
    expect(container.querySelector('[data-pane-legend]').textContent).toContain('94')
  })

  it('⛔ the member\'s switch: Ranks table off draws none', async () => {
    // primed under the SAME inputs the instance carries, so the envelope is there
    // and only the switch can be what keeps the table away
    const key = prime('D', RATING, { showRanksTable: false })
    const { container } = mount('D', settings({ showRanksTable: false }))
    await act(async () => { notifyColumnsLanded(key) })
    await vi.waitFor(() => expect(container.querySelector('[data-pane-legend]')).not.toBeNull(), { timeout: 8000 })
    await new Promise((r) => setTimeout(r, 300))
    expect(tableOf(container)).toBeNull()
    // control: the readout row from the same envelope DID land, so the envelope is real
    expect(container.querySelector('[data-pane-legend]').textContent).toContain('94')
  })
})
