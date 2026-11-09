// app/src/components/StockChart.rsTour.test.jsx
//
// ─── UCT RS Phase 4, unit 4-05 — the teaching surfaces on the REAL StockChart ──
//
// Engineering map 2026-11-08 §2 "4-05", decisions D12, D15, D16:
//   1. THE TOUR — the indicator library's first add of a definition with an unseen
//      `meta.tour` (4-03's `onFirstAdd`, wired through ChartToolbar) opens the new
//      chip's menu on a Tour page: one card at a time, Next / Back / "Skip tour";
//      Done and Skip mark it seen (`useIndicatorTours.markSeen`, mocked here). It
//      opens once per page (a second chart never reopens it), never for a re-enable
//      or a second instance, on the phone in the readout sheet, and never over an
//      armed pick.
//   2. THE GLOSSARY — the About page links `meta.glossaryHref` beside the lessons.
//   3. ASK COMPASS — a readout chip's menu carries `CompassAssistButton` (mocked:
//      it renders only while `voice.mounted`, as the real one needs a
//      VoiceProvider) with `readoutPageHint` over the glance rows.
//
// Harness: `StockChart.rsAnchor.test.jsx`'s (lightweight-charts stubbed), with a
// host that holds the chart's settings the way a Chart widget tab does
// (`settingsOverride` + `onSettingsPersist`), so a library add really lands.
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

let clickHandlers = []
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
    subscribeClick: (h) => { clickHandlers.push(h) },
    unsubscribeClick: (h) => { clickHandlers = clickHandlers.filter((x) => x !== h) },
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
// The seen state: a controllable stand-in for `useIndicatorTours` (one module, read
// by the library dialog and by StockChart alike). `landsSeen: false` models a seen
// write that has not landed yet.
const tours = vi.hoisted(() => ({ seen: new Set(), landsSeen: true, markSeen: null }))
vi.mock('./chart/useIndicatorTours', () => {
  tours.markSeen = vi.fn(async (id) => { if (tours.landsSeen) tours.seen.add(id); return true })
  return {
    INDICATOR_TOURS_PREF: 'indicator_tours_seen',
    default: () => ({ seen: (id) => tours.seen.has(id), markSeen: tours.markSeen, loading: false }),
  }
})
// The assist button: the real one returns null without a VoiceProvider.
const voice = vi.hoisted(() => ({ mounted: true }))
vi.mock('./voice/CompassAssistButton', () => ({
  default: ({ pageHint, label }) => (voice.mounted
    ? <button type="button" data-compass-assist="" data-page-hint={pageHint}>{label}</button>
    : null),
}))

// Import AFTER the mocks are registered.
const { default: StockChart } = await import('./StockChart')
const { mergeChartSettings } = await import('./chart/chartDefaults')
const registry = await import('./chart/engine/nativeRegistry')
const { resetTourClaims } = await import('./chart/legend/indicatorTour')
const { PAGE_HINT_MAX } = await import('./chart/legend/readoutPageHint')
const {
  primeServerColumns, clearServerColumns, notifyColumnsLanded, serverColumnsKey, pickServerInputs,
  primeServerDefinitions, clearServerDefinitions,
} = await import('./chart/engine/serverCompute')

const SYM = 'ENPH'
const CARD = Object.freeze({ what: 'What it is.', origin: 'Where it comes from.' })
const TOUR = Object.freeze([
  { title: 'Beating the market, or just riding it?', body: 'It compares your stock with the S&P 500.' },
  { title: 'Read the slope, not the level', body: 'The line rises when the stock outperforms.' },
  { title: 'It says where to look', body: 'Combine it with a base, volume and your own stop.' },
])
const TOUR_ID = 'u_rs_tour_405'
const TOUR_DEF = Object.freeze({
  schemaVersion: 1, id: TOUR_ID, version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: {
    name: 'Tour Fixture', shortName: 'TF', category: 'Momentum', repaint: 'non-repainting',
    tour: TOUR.map((c) => ({ ...c })), glossaryHref: '/methodology/relative-strength',
  },
  placement: { target: 'pane', scale: { min: 0, max: 100 } },
  inputs: [{ key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 }],
  plots: [{ key: 'rsi', label: 'TF', style: 'line', color: 'token:info', width: 1, legend: { decimals: 1 } }],
  events: [],
  readout: [
    { key: 'benchmarkName', label: 'Benchmark', source: 'scalar:benchmark.label', format: 'text', card: CARD },
    { key: 'benchmark', label: 'Resolved', source: 'scalar:benchmark.resolved', format: 'text', detailOf: 'benchmarkName' },
    { key: 'ratingSummary', label: 'Rating', source: 'scalar:rating.summary', format: 'text' },
    { key: 'phase', label: 'RS line', source: 'scalar:legend.summary', format: 'text' },
    { key: 'checks', label: 'Checks', source: 'scalar:checks.summary', format: 'text', card: CARD },
  ],
})
const TOUR_PAYLOAD = Object.freeze({
  benchmark: { label: 'S&P 500 (SPY)', resolved: 'SPY' },
  rating: { summary: '94 IBD-style' },
  legend: { summary: 'above its 21 EMA' },
  checks: { summary: '3 of 4' },
})
// The pick suite's definition (rsAnchor's), for "never over an armed pick".
const PICK_ID = 'u_rs_pick_405'
const PICK_INST = 'pick-1'
const PICK_DEF = Object.freeze({
  schemaVersion: 1, id: PICK_ID, version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: { name: 'Pick Fixture', shortName: 'PF', category: 'Momentum', repaint: 'non-repainting' },
  placement: { target: 'pane', scale: { min: 0, max: 100 } },
  inputs: [
    { key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 },
    { key: 'anchorDate', type: 'string', label: 'Anchor date', default: '', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  ],
  plots: [{ key: 'rsi', label: 'PF', style: 'line', color: 'token:info', width: 1, legend: { decimals: 1 } }],
  events: [],
  readout: [
    { key: 'checks', label: 'Checks', source: 'scalar:checks.summary', format: 'text', card: CARD },
    { key: 'checkAnchor', label: 'Since anchor', source: 'scalar:checks.anchor.line', format: 'text', detailOf: 'checks',
      action: { kind: 'pickDate', input: 'anchorDate' } },
  ],
})
const PICK_PAYLOAD = Object.freeze({ checks: { summary: '3 of 4 pass', anchor: { line: '+4.2% since the anchor' } } })
const definitionsBody = () => ({
  schemaVersion: 1,
  definitions: [{
    schemaVersion: 1, id: PICK_ID, version: 1, compute: { kind: 'server', fn: 'pickFixture', rev: 1 },
    inputs: [{ key: 'period', type: 'int', default: 14 }, { key: 'anchorDate', type: 'string', default: '' }],
    columns: ['rsi'],
  }],
})
const bars = Array.from({ length: 80 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 + i }
})

function prime(defId, payload, inputs = {}) {
  const def = registry.getDefinition(defId)
  const keyInputs = pickServerInputs(def, registry.resolveInputs(def, inputs))
  primeServerColumns(defId, SYM, 'D', keyInputs, { columns: {}, payload })
  return serverColumnsKey(defId, SYM, 'D', keyInputs)
}

/** A Chart-widget-tab host: the chart's settings live here, so an add lands. */
function Host({ initial, apiRef, settingsRef, extra }) {
  const [settings, setSettings] = React.useState(initial)
  settingsRef.current = settings
  return (
    <StockChart sym={SYM} tf="D" barsOverride={bars} settingsOverride={settings} onSettingsPersist={setSettings}
      alwaysShowLegend height={400} toolbarApiRef={apiRef} {...extra} />
  )
}
/** `thief`: wrap the chart the way `ChartPane` does — a focusable region whose
 *  onClick focuses itself (click to focus for type-to-search). React bubbles the
 *  chip popover's portal clicks through it, which is what threw keyboard focus
 *  out of the popover (§12.2 keyboard check, 2026-11-08). */
async function mount(instances = [], extra = {}, { thief = false } = {}) {
  const apiRef = { current: null }
  const settingsRef = { current: null }
  const initial = mergeChartSettings({ indicatorInstances: instances })
  const host = <Host initial={initial} apiRef={apiRef} settingsRef={settingsRef} extra={extra} />
  const out = render(<MemoryRouter>{thief
    ? <div tabIndex={0} role="region" aria-label="chart" data-focus-thief="" onClick={(e) => e.currentTarget.focus()}>{host}</div>
    : host}</MemoryRouter>)
  const keys = [prime(TOUR_ID, TOUR_PAYLOAD), prime(PICK_ID, PICK_PAYLOAD)]
  await act(async () => { for (const k of keys) notifyColumnsLanded(k) })
  await vi.waitFor(() => expect(apiRef.current).not.toBeNull())
  const liveOf = (defId) => ((settingsRef.current && settingsRef.current.indicatorInstances) || [])
    .filter((i) => i && i.defId === defId && !i.hidden && !i.removed)
  return { ...out, apiRef, settingsRef, liveOf }
}

const tourEl = () => document.querySelector('[data-legend-tour]')
const menuEl = () => document.querySelector('[data-guide="chart.chipMenu"]')
const click = async (el) => { await act(async () => { fireEvent.click(el) }) }
const settle = async (ms = 400) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)) }) }

/** Open the library through the toolbar's API and press the definition's row. */
async function addFromLibrary(apiRef, defId) {
  await act(async () => { apiRef.current.openIndicatorLibrary() })
  let li
  await vi.waitFor(() => {
    li = document.querySelector(`li[data-def-id="${defId}"]`)
    expect(li, `the library lists ${defId}`).not.toBeNull()
  }, { timeout: 8000 })
  await click(li)
}
/** Wait for the chip of `defId`'s live instance to render, and return it. */
async function chipOf(container, liveOf, defId) {
  let el
  await vi.waitFor(() => {
    const inst = liveOf(defId)[0]
    expect(inst, `${defId} has a live instance`).toBeTruthy()
    el = container.querySelector(`[data-instance-id="${inst.instanceId}"]`)
    expect(el).not.toBeNull()
  }, { timeout: 8000 })
  return el
}
async function waitTour() {
  await vi.waitFor(() => expect(tourEl()).not.toBeNull(), { timeout: 8000 })
  return tourEl()
}
const cardTitle = () => tourEl().querySelector('[data-tour-title]').textContent
const count = () => tourEl().querySelector('[data-tour-count]').textContent

/** Open a chip's menu once its readout rows are derived. */
async function openMenu(container, instanceId, rowSel = '[data-readout-rows]') {
  let menu
  await vi.waitFor(async () => {
    const chip = container.querySelector(`[data-instance-id="${instanceId}"]`)
    expect(chip).not.toBeNull()
    await act(async () => { fireEvent.contextMenu(chip) })
    await vi.waitFor(() => expect(menuEl()).not.toBeNull())
    menu = menuEl()
    if (!menu.querySelector(rowSel)) {
      await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
      throw new Error('rows not yet derived')
    }
  }, { timeout: 8000, interval: 150 })
  return menu
}

const touchMedia = (q) => ({ matches: q === '(max-width: 640px)' || q === '(max-width: 1024px)', media: q, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } })

const realClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
beforeEach(() => {
  cleanup()
  clickHandlers = []
  clearServerColumns()
  clearServerDefinitions()
  primeServerDefinitions(definitionsBody())
  resetTourClaims()
  tours.seen.clear()
  tours.landsSeen = true
  tours.markSeen.mockClear()
  voice.mounted = true
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 400 })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  const r = registry.installUserDefinitions([TOUR_DEF, PICK_DEF])
  expect(r.errors, 'the fixtures install').toEqual([])
})
afterEach(() => {
  cleanup()
  registry.uninstallUserDefinition(TOUR_ID)
  registry.uninstallUserDefinition(PICK_ID)
  clearServerColumns()
  clearServerDefinitions()
  Object.defineProperty(Element.prototype, 'clientHeight', realClientHeight)
  vi.unstubAllGlobals()
})

describe('1 · the first-add tour', () => {
  it('the first add opens the Tour page on card 1; Next and Back move one card; Done marks it seen', async () => {
    const { container, apiRef, liveOf } = await mount()
    await addFromLibrary(apiRef, TOUR_ID)
    await chipOf(container, liveOf, TOUR_ID)
    await waitTour()
    // the library closed first, and the tour is the chip menu's page (the RS popover, 296 px)
    expect(document.querySelector(`li[data-def-id="${TOUR_ID}"]`)).toBeNull()
    expect(menuEl()).not.toBeNull()
    expect(menuEl().contains(tourEl())).toBe(true)
    expect(menuEl().style.width).toBe('296px')
    expect(cardTitle()).toBe(TOUR[0].title)
    expect(count()).toBe('1 of 3')
    expect(tourEl().querySelector('[data-tour-back]'), 'no Back on card 1').toBeNull()
    expect(tourEl().querySelector('[data-tour-skip]').textContent).toBe('Skip tour')

    await click(tourEl().querySelector('[data-tour-next]'))
    expect(cardTitle()).toBe(TOUR[1].title)
    expect(count()).toBe('2 of 3')
    await click(tourEl().querySelector('[data-tour-back]'))
    expect(cardTitle()).toBe(TOUR[0].title)
    await click(tourEl().querySelector('[data-tour-next]'))
    await click(tourEl().querySelector('[data-tour-next]'))
    expect(cardTitle()).toBe(TOUR[2].title)
    // the last card: Done, no Next, no Skip
    expect(tourEl().querySelector('[data-tour-next]')).toBeNull()
    expect(tourEl().querySelector('[data-tour-skip]')).toBeNull()
    expect(tours.markSeen).not.toHaveBeenCalled()
    await click(tourEl().querySelector('[data-tour-done]'))
    expect(tours.markSeen).toHaveBeenCalledTimes(1)
    expect(tours.markSeen).toHaveBeenCalledWith(TOUR_ID)
    expect(tourEl()).toBeNull()
    expect(menuEl()).toBeNull()
  })

  it('Skip tour marks it seen; it opens once per page: a second chart does not reopen it, even before the write lands', async () => {
    tours.landsSeen = false   // the seen write has not landed: only the page claim holds
    const a = await mount()
    await addFromLibrary(a.apiRef, TOUR_ID)
    await waitTour()
    await click(tourEl().querySelector('[data-tour-skip]'))
    expect(tours.markSeen).toHaveBeenCalledWith(TOUR_ID)
    expect(tourEl()).toBeNull()
    a.unmount()

    const b = await mount()
    await addFromLibrary(b.apiRef, TOUR_ID)
    await chipOf(b.container, b.liveOf, TOUR_ID)
    await settle()
    expect(tourEl(), 'the second chart does not reopen the tour').toBeNull()
    expect(tours.markSeen).toHaveBeenCalledTimes(1)
  })

  it('a tour already seen does not open', async () => {
    tours.seen.add(TOUR_ID)
    const { container, apiRef, liveOf } = await mount()
    await addFromLibrary(apiRef, TOUR_ID)
    await chipOf(container, liveOf, TOUR_ID)
    await settle()
    expect(tourEl()).toBeNull()
  })

  it('re-enabling a hidden instance does not open it, and neither does a second instance', async () => {
    const { container, apiRef, liveOf } = await mount([{ instanceId: 'tf-1', defId: TOUR_ID, inputs: {}, hidden: true }])
    await addFromLibrary(apiRef, TOUR_ID)   // the row SHOWS the hidden instance
    await chipOf(container, liveOf, TOUR_ID)
    await settle()
    expect(tourEl(), 'a re-enable is not a first add').toBeNull()
    const another = document.querySelector('button[aria-label="Add another Tour Fixture"]')
    expect(another, 'the library is still open with + Add another').not.toBeNull()
    await click(another)
    await vi.waitFor(() => expect(liveOf(TOUR_ID).length).toBe(2))
    await settle()
    expect(tourEl(), 'a second instance is not a first add').toBeNull()
    expect(tours.markSeen).not.toHaveBeenCalled()
  })

  it('on the phone the tour opens in the readout sheet, and Next works there', async () => {
    const realMatchMedia = window.matchMedia
    window.matchMedia = touchMedia
    try {
      const { apiRef } = await mount([], { onLegendStudyTap: () => {} })
      await addFromLibrary(apiRef, TOUR_ID)
      const tour = await waitTour()
      // the touch branch is a Sheet (a dialog), not the anchored desktop menu
      expect(document.querySelector('[role="menu"][data-guide="chart.chipMenu"]')).toBeNull()
      expect(tour.closest('[role="dialog"]')).not.toBeNull()
      expect(cardTitle()).toBe(TOUR[0].title)
      await click(tourEl().querySelector('[data-tour-next]'))
      expect(cardTitle()).toBe(TOUR[1].title)
      await click(tourEl().querySelector('[data-tour-skip]'))
      expect(tours.markSeen).toHaveBeenCalledWith(TOUR_ID)
      expect(tourEl()).toBeNull()
    } finally {
      window.matchMedia = realMatchMedia
    }
  })

  it('every card is laid out in one cell (the live card over invisible sizers), so the sheet never changes height', async () => {
    const realMatchMedia = window.matchMedia
    window.matchMedia = touchMedia
    try {
      const { apiRef } = await mount([], { onLegendStudyTap: () => {} })
      await addFromLibrary(apiRef, TOUR_ID)
      const tour = await waitTour()
      const stack = tour.querySelector('[data-tour-cards]')
      expect(stack).not.toBeNull()
      const sizers = [...stack.querySelectorAll('[data-tour-sizer]')]
      expect(sizers.map((n) => n.querySelector('div').textContent)).toEqual(TOUR.map((c) => c.title))
      for (const n of sizers) {
        expect(n.getAttribute('aria-hidden')).toBe('true')
        expect(n.querySelector('[data-tour-title], [data-tour-body], button')).toBeNull()
      }
      // one live card, and it is the stack's first child on every step
      for (const step of [0, 1, 2]) {
        expect(tour.querySelectorAll('[data-tour-title]')).toHaveLength(1)
        expect(stack.firstElementChild.getAttribute('data-tour-card')).toBe(String(step))
        expect(cardTitle()).toBe(TOUR[step].title)
        expect(stack.querySelectorAll('[data-tour-sizer]')).toHaveLength(TOUR.length)
        if (step < 2) await click(tourEl().querySelector('[data-tour-next]'))
      }
    } finally {
      window.matchMedia = realMatchMedia
    }
    // the CSS that makes it one height: one grid cell for every card, the sizers invisible and inert
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'StockChart.module.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const rule = (sel) => {
      // a top-level rule whose WHOLE selector list is `sel`: split on braces, compare the trimmed selector
      const parts = css.split('}')
      for (const p of parts) {
        const at = p.indexOf('{')
        if (at < 0) continue
        if (p.slice(0, at).trim() === sel) return p.slice(at + 1).replace(/\s+/g, ' ').trim()
      }
      return null
    }
    expect(rule('.legTourCards')).toMatch(/display: grid/)
    expect(rule('.legTourCards > .legTourCard')).toMatch(/grid-area: 1 \/ 1/)
    expect(rule('.legTourSizer')).toMatch(/visibility: hidden/)
    expect(rule('.legTourSizer')).toMatch(/pointer-events: none/)
  })

  it('the Chart Settings door: the toolbar API indicatorFirstAdd opens the same tour, under the same rules (4-11)', async () => {
    // ChartPane hands Chart Settings → Indicators' first add here once its modal closes
    // (ChartPane.firstAddTour.test.jsx); the instance is already on the chart by then.
    const { container, apiRef, liveOf } = await mount([{ instanceId: 'tf-cs', defId: TOUR_ID, inputs: {}, hidden: false }])
    expect(typeof apiRef.current.indicatorFirstAdd).toBe('function')
    await chipOf(container, liveOf, TOUR_ID)
    await act(async () => { apiRef.current.indicatorFirstAdd(TOUR_ID) })
    await waitTour()
    expect(menuEl().contains(tourEl())).toBe(true)
    expect(cardTitle()).toBe(TOUR[0].title)
    await click(tourEl().querySelector('[data-tour-skip]'))
    expect(tours.markSeen).toHaveBeenCalledWith(TOUR_ID)
    // claimed for the page: a second hand-over never reopens it
    await act(async () => { apiRef.current.indicatorFirstAdd(TOUR_ID) })
    await settle()
    expect(tourEl()).toBeNull()
  })

  it('the Chart Settings door: a tour already seen does not open, and neither does one for a definition without a tour', async () => {
    tours.seen.add(TOUR_ID)
    const { container, apiRef, liveOf } = await mount([
      { instanceId: 'tf-cs', defId: TOUR_ID, inputs: {}, hidden: false },
      { instanceId: PICK_INST, defId: PICK_ID, inputs: {}, hidden: false },
    ])
    await chipOf(container, liveOf, TOUR_ID)
    await act(async () => { apiRef.current.indicatorFirstAdd(TOUR_ID); apiRef.current.indicatorFirstAdd(PICK_ID) })
    await settle()
    expect(tourEl()).toBeNull()
    expect(menuEl()).toBeNull()
  })

  it('never opens over an armed pick (and is not marked seen)', async () => {
    const { container, apiRef, liveOf } = await mount([{ instanceId: PICK_INST, defId: PICK_ID, inputs: {}, hidden: false }])
    const menu = await openMenu(container, PICK_INST, '[data-readout-row="checks"]')
    await click(menu.querySelector('[data-readout-row="checks"]'))
    let pick
    await vi.waitFor(() => {
      pick = document.querySelector('[data-legend-card="checks"] [data-readout-action="pickDate"]')
      expect(pick).not.toBeNull()
    })
    await click(pick)
    await vi.waitFor(() => expect(document.querySelector('[data-rs-pick-hint]')).not.toBeNull())

    await addFromLibrary(apiRef, TOUR_ID)
    await chipOf(container, liveOf, TOUR_ID)
    await settle()
    expect(tourEl(), 'no tour over the armed pick').toBeNull()
    expect(document.querySelector('[data-rs-pick-hint]'), 'the pick stays armed').not.toBeNull()
    expect(tours.markSeen).not.toHaveBeenCalled()
  })
})

describe('2 · the glossary link and Ask Compass', () => {
  it('the About page links the declared glossary beside the lessons; a definition without one shows none', async () => {
    const { container } = await mount([
      { instanceId: 'tf-1', defId: TOUR_ID, inputs: {}, hidden: false },
      { instanceId: PICK_INST, defId: PICK_ID, inputs: {}, hidden: false },
    ])
    let menu = await openMenu(container, 'tf-1')
    await click(menu.querySelector('[data-menu-id="about"]'))
    let link
    await vi.waitFor(() => {
      link = document.querySelector('a[data-glossary-link]')
      expect(link).not.toBeNull()
    })
    expect(link.getAttribute('href')).toBe('/methodology/relative-strength')
    expect(link.textContent).toBe('Glossary')
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    await vi.waitFor(() => expect(document.querySelector('a[data-glossary-link]')).toBeNull())

    menu = await openMenu(container, PICK_INST)
    await click(menu.querySelector('[data-menu-id="about"]'))
    await settle(100)
    expect(document.querySelector('a[data-glossary-link]')).toBeNull()
  })

  it('a readout chip offers "Ask Compass about this" with the glance rows as a hint of at most 480 characters', async () => {
    const { container } = await mount([{ instanceId: 'tf-1', defId: TOUR_ID, inputs: {}, hidden: false }])
    const menu = await openMenu(container, 'tf-1')
    const btn = menu.querySelector('[data-legend-ask] [data-compass-assist]')
    expect(btn, 'the ask row renders under the readout rows').not.toBeNull()
    expect(btn.textContent).toBe('Ask Compass about this')
    const hint = btn.getAttribute('data-page-hint')
    expect(hint.length).toBeLessThanOrEqual(PAGE_HINT_MAX)
    expect(hint).toBe('TF for ENPH vs SPY: rating 94 IBD-style; RS line above its 21 EMA; checks 3 of 4')
    // the ask row follows the readout rows
    const rows = menu.querySelector('[data-readout-rows]')
    expect(rows.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // pressing it starts the conversation and closes the menu
    await click(btn)
    expect(menuEl()).toBeNull()
  })

  it('without a VoiceProvider the button renders nothing and the row collapses', async () => {
    voice.mounted = false
    const { container } = await mount([{ instanceId: 'tf-1', defId: TOUR_ID, inputs: {}, hidden: false }])
    const menu = await openMenu(container, 'tf-1')
    expect(menu.querySelector('[data-compass-assist]')).toBeNull()
    const row = menu.querySelector('[data-legend-ask]')
    expect(row === null || row.childElementCount === 0).toBe(true)
  })
})

describe('3 · keyboard focus stays in the popover (spec §12.2 keyboard check)', () => {
  const thief = () => document.querySelector('[data-focus-thief]')
  // Enter or Space on a button fires its click; focus the button first, as Tab does.
  const press = async (el) => { el.focus(); await click(el) }

  it('a tour step keeps focus on Next (Back on Back), and the last card hands it to Done', async () => {
    const { container, apiRef, liveOf } = await mount([], {}, { thief: true })
    await addFromLibrary(apiRef, TOUR_ID)
    await chipOf(container, liveOf, TOUR_ID)
    await waitTour()
    await press(tourEl().querySelector('[data-tour-next]'))
    expect(count()).toBe('2 of 3')
    expect(document.activeElement, 'Next keeps focus, not the chart region').toBe(tourEl().querySelector('[data-tour-next]'))
    expect(document.activeElement).not.toBe(thief())
    await press(tourEl().querySelector('[data-tour-next]'))
    expect(count()).toBe('3 of 3')
    expect(document.activeElement, 'the last card: Done').toBe(tourEl().querySelector('[data-tour-done]'))
    await press(tourEl().querySelector('[data-tour-back]'))
    expect(count()).toBe('2 of 3')
    expect(document.activeElement, 'Back stays on Back while there is one').toBe(tourEl().querySelector('[data-tour-back]'))
    await press(tourEl().querySelector('[data-tour-back]'))
    expect(count()).toBe('1 of 3')
    expect(document.activeElement, 'card 1 has no Back: Next').toBe(tourEl().querySelector('[data-tour-next]'))
  })

  // The chip's focusable control: the `[data-instance-id]` node, or the row button around it.
  const chipButton = (el) => (el.matches('[role="button"][tabindex]') ? el : el.closest('[role="button"][tabindex]'))

  it('the tour opens with focus on Next, its primary action, not on Skip tour', async () => {
    const { container, apiRef, liveOf } = await mount([], {}, { thief: true })
    await addFromLibrary(apiRef, TOUR_ID)
    await chipOf(container, liveOf, TOUR_ID)
    await waitTour()
    await vi.waitFor(() => expect(document.activeElement, 'focus on Next').toBe(tourEl().querySelector('[data-tour-next]')))
    expect(document.activeElement).not.toBe(tourEl().querySelector('[data-tour-skip]'))
  })

  it('Done hands focus back to the RS chip that hosts the menu, not the chart region', async () => {
    const { container, apiRef, liveOf } = await mount([], {}, { thief: true })
    await addFromLibrary(apiRef, TOUR_ID)
    const chip = chipButton(await chipOf(container, liveOf, TOUR_ID))
    expect(chip, 'the chip is a focusable button').toBeTruthy()
    await waitTour()
    await press(tourEl().querySelector('[data-tour-next]'))
    await press(tourEl().querySelector('[data-tour-next]'))
    await press(tourEl().querySelector('[data-tour-done]'))
    expect(tourEl()).toBeNull()
    await vi.waitFor(() => expect(document.activeElement, 'focus on the chip').toBe(chipButton(container.querySelector(`[data-instance-id="${liveOf(TOUR_ID)[0].instanceId}"]`))))
    expect(document.activeElement).not.toBe(thief())
  })

  it('Skip tour hands focus back to the RS chip too', async () => {
    const { container, apiRef, liveOf } = await mount([], {}, { thief: true })
    await addFromLibrary(apiRef, TOUR_ID)
    await chipOf(container, liveOf, TOUR_ID)
    await waitTour()
    await press(tourEl().querySelector('[data-tour-skip]'))
    expect(tourEl()).toBeNull()
    await vi.waitFor(() => expect(document.activeElement, 'focus on the chip').toBe(chipButton(container.querySelector(`[data-instance-id="${liveOf(TOUR_ID)[0].instanceId}"]`))))
    expect(document.activeElement).not.toBe(thief())
    expect(document.activeElement).not.toBe(document.body)
  })

  it('a readout row opens its card with focus on the back row, and back returns focus to that row', async () => {
    const { container } = await mount([{ instanceId: 'tf-1', defId: TOUR_ID, inputs: {}, hidden: false }], {}, { thief: true })
    const menu = await openMenu(container, 'tf-1')
    await press(menu.querySelector('button[data-readout-row="checks"]'))
    let back
    await vi.waitFor(() => {
      back = document.querySelector('[data-legend-card="checks"] [data-legend-back]')
      expect(back).not.toBeNull()
    })
    expect(document.activeElement, 'the card opens on its back row').toBe(back)
    await press(back)
    let row
    await vi.waitFor(() => {
      row = menuEl() && menuEl().querySelector('button[data-readout-row="checks"]')
      expect(row).toBeTruthy()
    })
    expect(document.activeElement, 'back to the menu: focus on the row that opened the card').toBe(row)
    expect(document.activeElement).not.toBe(thief())
  })

  it('no RS legend control suppresses the focus ring (no `outline: none` focus rule)', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const css = readFileSync(resolve(here, 'StockChart.module.css'), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
    const controls = ['legMenuRowBtn', 'legRowAction', 'legCardBack', 'legCardNumBtn', 'legCardLearn', 'legCardLesson',
      'legPresetRow', 'legAboutGlossary', 'legTourSkip', 'legTourBack', 'legTourNext']
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1], body: m[2] }))
    for (const c of controls) {
      const focus = rules.filter((r) => new RegExp('[.]' + c + ':focus-visible(?![A-Za-z-])').test(r.sel))
      expect(focus.length, `${c} has a :focus-visible rule`).toBeGreaterThan(0)
      expect(focus.some((r) => /outline:\s*none/.test(r.body)), `${c}: no outline: none`).toBe(false)
    }
    // they leave the app's ring alone: tokens.css draws it on every :focus-visible
    const tokens = readFileSync(resolve(here, '../styles/tokens.css'), 'utf8').replace(/\r\n/g, '\n')
    expect(tokens).toMatch(/\n:focus-visible \{\s*outline: 2px solid var\(--ut-gold\);/)
    for (const c of ['legMenuRowBtn', 'legRowAction', 'legCardBack', 'legCardNumBtn', 'legPresetRow']) {
      const inside = rules.filter((r) => new RegExp('[.]' + c + ':focus-visible(?![A-Za-z-])').test(r.sel) && /outline-offset:\s*-2px/.test(r.body))
      expect(inside.length, `${c}: the ring sits inside (the popover scrolls and clips an outset ring)`).toBeGreaterThan(0)
    }
  })
})
