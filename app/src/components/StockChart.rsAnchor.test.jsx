// app/src/components/StockChart.rsAnchor.test.jsx
//
// ─── UCT RS Phase 3, unit 3-09 — the readout actions on the REAL StockChart ──
//
// Engineering map 2026-11-08 §2 "3-09" and decision D6. A readout row's
// `action` (3-07) is rendered here, and only here, and only when this chart can
// honour it:
//   1. "Pick a date on the chart" (`pickDate`): the server declares the input and
//      the chart is daily. Pressing it closes the menu and arms a one-shot pick;
//      the next click on a bar (the library's click, which a touch tap also
//      raises) is written ONCE as that bar's ET session date through
//      `setInstanceInput`. Escape, a symbol change or a timeframe change cancels
//      it; a click on a news or Desk badge is not a pick; a click with no bar
//      under it leaves it armed.
//   2. "Use the default anchor" (`resetInput`): the server declares the input;
//      it writes the blank default.
//   3. "Open the rotation map" (`openRotation`): only on a host with a Compare
//      panel (`canOpenCompare`), never the phone shell; it dispatches
//      `uct:compare-open` with `{tab: 'rotation', sym, group: 'theme'}`.
//   4. The chip menu's Preset page lists `visiblePresets(def, declared)`.
//
// Harness: `StockChart.rsVA2.test.jsx`'s (lightweight-charts stubbed), with the
// library's click handlers captured so a test can click a bar the way the
// library would. The fixture computes on the native lane (`fn: 'rsi'`) so its
// chip draws without server columns, as every RS StockChart suite does; the
// server gate is still read for it, because its readout declares actions.
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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
// The Preset page's one reader, spied so a test can say what the live row admits.
vi.mock('./chart/indicatorRegistry', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, visiblePresets: vi.fn(actual.visiblePresets) }
})

// Import AFTER the mocks are registered.
const { default: StockChart } = await import('./StockChart')
const { mergeChartSettings } = await import('./chart/chartDefaults')
const registry = await import('./chart/engine/nativeRegistry')
const { findInstance } = await import('./chart/engine/instanceControls')
const indicatorRegistry = await import('./chart/indicatorRegistry')
const {
  primeServerColumns, clearServerColumns, notifyColumnsLanded, serverColumnsKey, pickServerInputs,
  primeServerDefinitions, clearServerDefinitions,
} = await import('./chart/engine/serverCompute')

const DEF_ID = 'u_rs_anchor_309'
const INST = 'rsa-1'
const SYM = 'ENPH'
const CARD = Object.freeze({ what: 'What it is.', origin: 'Where it comes from.' })
const FIXTURE = Object.freeze({
  schemaVersion: 1, id: DEF_ID, version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: {
    name: 'Anchor Fixture', shortName: 'AF', category: 'Momentum', repaint: 'non-repainting', legendParams: ['benchmark'],
    presets: [
      { id: 'classic', label: 'Classic', origin: 'fixture', inputs: { period: 14 } },
      { id: 'fast', label: 'Fast', origin: 'fixture', inputs: { period: 7 } },
    ],
  },
  placement: { target: 'pane', scale: { min: 0, max: 100 } },
  inputs: [
    { key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 },
    { key: 'benchmark', type: 'enum', label: 'Benchmark', default: 'SPY', options: [['SPY', 'S&P 500'], ['SECTOR', 'Sector ETF']] },
    { key: 'anchorDate', type: 'string', label: 'Anchor date', default: '', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  ],
  plots: [{ key: 'rsi', label: 'AF', style: 'line', color: 'token:info', width: 1, legend: { decimals: 1 } }],
  events: [],
  readout: [
    { key: 'benchmark', label: 'Benchmark', source: 'scalar:benchmark.resolved', format: 'text', chip: true },
    { key: 'rotation', label: 'Rotation', source: 'scalar:rotation.summary', format: 'text', card: CARD,
      action: { kind: 'openRotation' } },
    { key: 'checks', label: 'Checks', source: 'scalar:checks.summary', format: 'text', card: CARD },
    { key: 'checkAnchor', label: 'Since anchor', source: 'scalar:checks.anchor.line', format: 'text', detailOf: 'checks',
      action: { kind: 'pickDate', input: 'anchorDate' } },
    { key: 'checkAnchorPicked', label: 'Picked date', source: 'input:anchorDate', format: 'text', detailOf: 'checks',
      when: 'input:anchorDate', action: { kind: 'resetInput', input: 'anchorDate' } },
  ],
})
const PAYLOAD = Object.freeze({
  benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500 (SPY)', fallback: null, bars: 330 },
  rotation: { summary: 'Leading, 6 weeks' },
  checks: { summary: '3 of 4 pass', anchor: { line: '+4.2% against +1.1% since the anchor' } },
})
const bars = Array.from({ length: 80 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 + i }
})

/** The live row's declaration: the anchor input declared, or not. */
const definitionsBody = (declared) => ({
  schemaVersion: 1,
  definitions: declared ? [{
    schemaVersion: 1, id: DEF_ID, version: 1, compute: { kind: 'server', fn: 'anchorFixture', rev: 1 },
    inputs: [{ key: 'period', type: 'int', default: 14 }, { key: 'anchorDate', type: 'string', default: '' }],
    columns: ['rsi'],
  }] : [],
})

const settingsFor = (inputs) => mergeChartSettings({
  indicatorInstances: [{ instanceId: INST, defId: DEF_ID, inputs, hidden: false }],
})
function primeFixture(inputs, tf, sym = SYM) {
  const def = registry.getDefinition(DEF_ID)
  const keyInputs = pickServerInputs(def, registry.resolveInputs(def, inputs))
  primeServerColumns(DEF_ID, sym, tf, keyInputs, { columns: {}, payload: PAYLOAD })
  return serverColumnsKey(DEF_ID, sym, tf, keyInputs)
}

const chipEl = (container) => container.querySelector(`[data-instance-id="${INST}"]`)
const menuEl = () => document.querySelector('[data-guide="chart.chipMenu"]')
const hintEl = () => document.querySelector('[data-rs-pick-hint]')
const fireClick = (param) => { for (const h of [...clickHandlers]) h(param) }
const click = async (el) => { await act(async () => { fireEvent.click(el) }) }

/** Open the chip menu once its readout rows have been derived. On the phone shell
 *  a readout chip's TAP opens it (decision C5); elsewhere the right-click. */
async function openMenu(container, { tap = false } = {}) {
  let menu
  await vi.waitFor(async () => {
    await vi.waitFor(() => expect(chipEl(container)).not.toBeNull(), { timeout: 8000 })
    await act(async () => { if (tap) fireEvent.click(chipEl(container)); else fireEvent.contextMenu(chipEl(container)) })
    await vi.waitFor(() => expect(menuEl()).not.toBeNull())
    menu = menuEl()
    if (!menu.querySelector('[data-readout-rows]')) {
      await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
      throw new Error('rows not yet derived')
    }
  }, { timeout: 8000, interval: 150 })
  return menu
}
/** The Checks card, opened from the menu. */
async function openChecks(container, opts) {
  const menu = await openMenu(container, opts)
  await click(menu.querySelector('[data-readout-row="checks"]'))
  await vi.waitFor(() => expect(document.querySelector('[data-legend-card="checks"]')).not.toBeNull())
  return document.querySelector('[data-legend-card="checks"]')
}

// ⛔ `settingsOverride` is a memo dependency: built once per mount, never per render.
async function mountWith(inputs = {}, { tf = 'D', declared = true, extra = {} } = {}) {
  primeServerDefinitions(definitionsBody(declared))
  const settings = settingsFor(inputs)
  const persisted = []
  const props = { sym: SYM, tf, barsOverride: bars, settingsOverride: settings, alwaysShowLegend: true, height: 400,
    onSettingsPersist: (next) => persisted.push(next), ...extra }
  const out = render(<MemoryRouter><StockChart {...props} /></MemoryRouter>)
  const key = primeFixture(inputs, tf)
  await act(async () => { notifyColumnsLanded(key) })
  const rerenderWith = (patch) => out.rerender(<MemoryRouter><StockChart {...props} {...patch} /></MemoryRouter>)
  /** Every anchorDate the chart persisted, in order. */
  const anchorWrites = () => persisted
    .map((cs) => findInstance(cs, INST))
    .filter((i) => i && i.inputs && Object.prototype.hasOwnProperty.call(i.inputs, 'anchorDate')
      && i.inputs.anchorDate !== inputs.anchorDate)
    .map((i) => i.inputs.anchorDate)
  return { ...out, persisted, anchorWrites, rerenderWith }
}

/** Arm the pick from the Checks card; returns once the hint shows. */
async function armPick(container, opts) {
  const card = await openChecks(container, opts)
  const btn = card.querySelector('[data-readout-action="pickDate"]')
  expect(btn, 'the pick button renders').not.toBeNull()
  expect(btn.textContent).toBe('Pick a date on the chart')
  await click(btn)
  await vi.waitFor(() => expect(hintEl()).not.toBeNull())
  // pressing it closed the menu
  await vi.waitFor(() => expect(menuEl()).toBeNull())
}

const realClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
beforeEach(() => {
  cleanup()
  clickHandlers = []
  clearServerColumns()
  clearServerDefinitions()
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 400 })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  const r = registry.installUserDefinitions([FIXTURE])
  expect(r.errors, 'the fixture installs').toEqual([])
})
afterEach(() => {
  cleanup()
  registry.uninstallUserDefinition(DEF_ID)
  clearServerColumns()
  clearServerDefinitions()
  indicatorRegistry.visiblePresets.mockClear()
  Object.defineProperty(Element.prototype, 'clientHeight', realClientHeight)
  vi.unstubAllGlobals()
})

describe('1 · pick a date on the chart', () => {
  it('the button arms a one-shot pick; the next bar click writes its date ONCE and leaves the mode', async () => {
    const { container, anchorWrites } = await mountWith({})
    await armPick(container)
    expect(hintEl().textContent).toContain('Click a bar to anchor the check. Esc cancels.')
    // a click past the newest candle (no bar under it) is not a pick: still armed
    await act(async () => { fireClick({ time: undefined, point: { x: 590, y: 100 } }) })
    expect(hintEl(), 'still armed').not.toBeNull()
    expect(anchorWrites()).toEqual([])
    await act(async () => { fireClick({ time: '2026-02-10', point: { x: 200, y: 100 } }) })
    expect(anchorWrites()).toEqual(['2026-02-10'])
    expect(hintEl(), 'the mode is gone').toBeNull()
    // the next click is an ordinary click again
    await act(async () => { fireClick({ time: '2026-02-12', point: { x: 220, y: 100 } }) })
    expect(anchorWrites()).toEqual(['2026-02-10'])
  })

  it('a business-day object reads as the same ET session date', async () => {
    const { container, anchorWrites } = await mountWith({})
    await armPick(container)
    await act(async () => { fireClick({ time: { year: 2026, month: 3, day: 2 }, point: { x: 200, y: 100 } }) })
    expect(anchorWrites()).toEqual(['2026-03-02'])
  })

  it('Escape cancels: the hint goes, and the next click writes nothing', async () => {
    const { container, anchorWrites } = await mountWith({})
    await armPick(container)
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(hintEl()).toBeNull()
    await act(async () => { fireClick({ time: '2026-02-10', point: { x: 200, y: 100 } }) })
    expect(anchorWrites()).toEqual([])
  })

  it('the hint\'s Cancel button cancels too (the touch twin of Escape)', async () => {
    const { container, anchorWrites } = await mountWith({})
    await armPick(container)
    await click(document.querySelector('[data-rs-pick-cancel]'))
    expect(hintEl()).toBeNull()
    await act(async () => { fireClick({ time: '2026-02-10', point: { x: 200, y: 100 } }) })
    expect(anchorWrites()).toEqual([])
  })

  it('a symbol change cancels it, and going back to the symbol does not re-arm it', async () => {
    const { container, anchorWrites, rerenderWith } = await mountWith({})
    await armPick(container)
    await act(async () => { rerenderWith({ sym: 'AAPL' }) })
    expect(hintEl()).toBeNull()
    await act(async () => { fireClick({ time: '2026-02-10', point: { x: 200, y: 100 } }) })
    await act(async () => { rerenderWith({ sym: SYM }) })
    expect(hintEl(), 'not re-armed on the way back').toBeNull()
    await act(async () => { fireClick({ time: '2026-02-11', point: { x: 200, y: 100 } }) })
    expect(anchorWrites()).toEqual([])
  })

  it('a timeframe change cancels it', async () => {
    const { container, anchorWrites, rerenderWith } = await mountWith({})
    await armPick(container)
    await act(async () => { rerenderWith({ tf: 'W' }) })
    expect(hintEl()).toBeNull()
    await act(async () => { rerenderWith({ tf: 'D' }) })
    expect(hintEl()).toBeNull()
    await act(async () => { fireClick({ time: '2026-02-10', point: { x: 200, y: 100 } }) })
    expect(anchorWrites()).toEqual([])
  })

  it('a click on a news or Desk badge is not a pick; the candle click after it is', async () => {
    const { container, anchorWrites } = await mountWith({})
    await armPick(container)
    await act(async () => { fireClick({ time: '2026-02-10', point: { x: 200, y: 20 }, hoveredObjectId: 'news-1770700000' }) })
    await act(async () => { fireClick({ time: '2026-02-10', point: { x: 200, y: 20 }, hoveredObjectId: 'desk-2026-02-10' }) })
    expect(anchorWrites()).toEqual([])
    expect(hintEl(), 'still armed after the badge clicks').not.toBeNull()
    await act(async () => { fireClick({ time: '2026-02-11', point: { x: 210, y: 100 } }) })
    expect(anchorWrites()).toEqual(['2026-02-11'])
  })

  it('unmounting with a pick armed leaves no click subscriber behind', async () => {
    const { container, unmount } = await mountWith({})
    const before = clickHandlers.length
    await armPick(container)
    expect(clickHandlers.length, 'the pick subscribed one handler').toBe(before + 1)
    unmount()
    expect(clickHandlers).toEqual([])
  })

  it('on the phone shell a TAP is the pick (the library\'s click fires on touch)', async () => {
    const realMatchMedia = window.matchMedia
    window.matchMedia = (q) => ({ matches: q === '(max-width: 640px)', media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } })
    try {
      const { container, anchorWrites } = await mountWith({}, { extra: { onLegendStudyTap: () => {} } })
      await armPick(container, { tap: true })
      // no keyboard on a phone: the hint says Tap and offers Cancel, not Escape
      expect(hintEl().textContent).toContain('Tap a bar to anchor the check.')
      expect(hintEl().textContent).not.toContain('Esc')
      expect(document.querySelector('[data-rs-pick-cancel]')).not.toBeNull()
      await act(async () => { fireClick({ time: '2026-02-17', point: { x: 120, y: 140 } }) })
      expect(anchorWrites()).toEqual(['2026-02-17'])
      expect(hintEl()).toBeNull()
    } finally {
      window.matchMedia = realMatchMedia
    }
  })

  it('hidden when the live row does not declare the input', async () => {
    const { container } = await mountWith({}, { declared: false })
    const card = await openChecks(container)
    expect(card.querySelector('[data-card-number="checkAnchor"]'), 'the row itself still prints').not.toBeNull()
    expect(card.querySelector('[data-readout-action]')).toBeNull()
  })

  it('hidden on a non-daily chart (the checks are daily, D6)', async () => {
    const { container } = await mountWith({ anchorDate: '2026-02-10' }, { tf: 'W' })
    const card = await openChecks(container)
    expect(card.querySelector('[data-card-number="checkAnchor"]')).not.toBeNull()
    expect(card.querySelector('[data-readout-action="pickDate"]')).toBeNull()
    // the reset still offers itself: the stored date can always go back to the default
    expect(card.querySelector('[data-readout-action="resetInput"]')).not.toBeNull()
  })
})

describe('2 · use the default anchor', () => {
  it('a picked date prints its row with the reset; pressing it writes the blank default and closes the menu', async () => {
    const { container, anchorWrites } = await mountWith({ anchorDate: '2026-02-10' })
    const card = await openChecks(container)
    expect(card.querySelector('[data-card-number="checkAnchorPicked"]').textContent).toContain('2026-02-10')
    const btn = card.querySelector('[data-readout-action="resetInput"]')
    expect(btn).not.toBeNull()
    expect(btn.textContent).toBe('Use the default anchor')
    expect(btn.getAttribute('data-readout-action-row')).toBe('checkAnchorPicked')
    await click(btn)
    expect(anchorWrites()).toEqual([''])
    await vi.waitFor(() => expect(menuEl()).toBeNull())
    expect(hintEl(), 'a reset arms nothing').toBeNull()
  })

  it('hidden when the live row does not declare the input', async () => {
    const { container } = await mountWith({ anchorDate: '2026-02-10' }, { declared: false })
    const card = await openChecks(container)
    expect(card.querySelector('[data-card-number="checkAnchorPicked"]')).not.toBeNull()
    expect(card.querySelector('[data-readout-action]')).toBeNull()
  })
})

describe('3 · open the rotation map', () => {
  it('on a host with a Compare panel: rendered under the row, and it dispatches uct:compare-open', async () => {
    const seen = []
    const onOpen = (e) => seen.push(e.detail)
    window.addEventListener('uct:compare-open', onOpen)
    try {
      const { container } = await mountWith({}, { extra: { canOpenCompare: true } })
      const menu = await openMenu(container)
      const btn = menu.querySelector('[data-readout-action="openRotation"]')
      expect(btn).not.toBeNull()
      expect(btn.textContent).toBe('Open the rotation map')
      // a sibling of the row, never inside the row's card button
      expect(btn.closest('[data-readout-row]')).toBeNull()
      await click(btn)
      expect(seen).toEqual([{ tab: 'rotation', sym: SYM, group: 'theme' }])
      await vi.waitFor(() => expect(menuEl()).toBeNull())
    } finally {
      window.removeEventListener('uct:compare-open', onOpen)
    }
  })

  it('absent on a host with no Compare panel (the default: Terminal, popup chart)', async () => {
    const { container } = await mountWith({})
    const menu = await openMenu(container)
    expect(menu.querySelector('[data-readout-row="rotation"]')).not.toBeNull()
    expect(menu.querySelector('[data-readout-action="openRotation"]')).toBeNull()
  })

  it('absent on the phone shell, even when a host says it has a panel', async () => {
    const realMatchMedia = window.matchMedia
    window.matchMedia = (q) => ({ matches: q === '(max-width: 640px)', media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } })
    try {
      const { container } = await mountWith({}, { extra: { canOpenCompare: true, onLegendStudyTap: () => {} } })
      const menu = await openMenu(container, { tap: true })
      expect(menu.querySelector('[data-readout-row="rotation"]')).not.toBeNull()
      expect(menu.querySelector('[data-readout-action="openRotation"]')).toBeNull()
    } finally {
      window.matchMedia = realMatchMedia
    }
  })
})

describe('4 · the Preset page lists visiblePresets', () => {
  it('lists what the live row admits, and asks with the live declaration', async () => {
    const real = indicatorRegistry.visiblePresets.getMockImplementation()
    // The live row admits "Fast" only once it declares `anchorDate`.
    indicatorRegistry.visiblePresets.mockImplementation((def, declared) => {
      const all = real(def, declared)
      if (!def || def.id !== DEF_ID) return all
      const ok = !!declared && declared.inputs.includes('anchorDate')
      return all.filter((p) => p.id !== 'fast' || ok)
    })
    try {
      const { container, unmount } = await mountWith({}, { declared: false })
      let menu = await openMenu(container)
      await click(menu.querySelector('[data-menu-id="preset"]'))
      await vi.waitFor(() => expect(document.querySelector('[data-legend-preset-page]')).not.toBeNull())
      const ids = () => [...document.querySelectorAll('[data-legend-preset-page] [data-preset-row]')]
        .map((r) => r.getAttribute('data-preset-row'))
      expect(ids()).toEqual(['classic', 'custom'])
      await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
      unmount()

      const second = await mountWith({}, { declared: true })
      menu = await openMenu(second.container)
      await click(menu.querySelector('[data-menu-id="preset"]'))
      await vi.waitFor(() => expect(document.querySelector('[data-legend-preset-page]')).not.toBeNull())
      expect(ids()).toEqual(['classic', 'fast', 'custom'])
      const calls = indicatorRegistry.visiblePresets.mock.calls.filter(([d]) => d && d.id === DEF_ID)
      expect(calls.some(([, d]) => d && d.inputs.includes('anchorDate')), 'asked with the live declaration').toBe(true)
    } finally {
      indicatorRegistry.visiblePresets.mockImplementation(real)
    }
  })
})
