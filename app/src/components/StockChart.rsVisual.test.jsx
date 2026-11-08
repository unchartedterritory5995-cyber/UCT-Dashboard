// app/src/components/StockChart.rsVisual.test.jsx
//
// ─── UCT RS Phase 2a VISUAL ROUND, unit VA3 · the legend surface ────────────
//
// Spec `phase2a-visual-spec.md` items A1 (client half), A5a, A6 (chip-menu
// half), A8 (client half) and A9, on the REAL StockChart with
// lightweight-charts stubbed (the `StockChart.rsReadout` harness):
//
//   A1  the chip menu lists GLANCE rows only; a row declaring `detailOf`
//       (shared contract, stamped on the resolved row by VA2 — simulated here
//       by wrapping `readoutSchema.readoutRows`) renders in its glance row's card
//       as a "numbers" block above the three lines; a number with its own card
//       opens it and back returns to the parent card; one popover width, 296 px,
//       for the menu, the card, Display in and Preset; the type scale, the grid
//       and the inks read from the stylesheet.
//   A6  a `Preset ▸` row after Display in names the current preset; its page
//       lists the presets with the current one checked; pressing one writes the
//       preset through `applyPresetInputs` and closes the popover.
//   A9  the chip, the menu header and the phone chip read `<short> · <benchmark>`.
//   A5a the readout chip is never folded behind `+N` — generalised by decision
//       C4 (2026-11-07) to every chip drawn outside the price pane; B8 dropped
//       its forced line break; C5 makes a readout chip's phone tap open the menu.
//   CONTROL RSI and MACD render the same chip, the same 204 px menu, the same
//       header and the same rows as before.
//
// ⚠️ jsdom lays nothing out: widths are the popover's declared inline width,
// sizes are the stylesheet's declarations, never measured boxes.
/* global process */
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
// ⭐ THE SHARED CONTRACT'S `detailOf`, AS VA2 WILL STAMP IT. On this base the
// field is not yet a legal readout entry (`defSchema` fails closed on unknown
// fields), so the resolver is wrapped to add it to the RESOLVED rows of the
// fixture alone — exactly the shape "VA2 adds `detailOf` to each resolved row".
const DETAIL_OF = Object.freeze({ ratingAsOf: 'rating', barsAgo: 'rsHigh', beforePrice: 'rsHigh', redDay: 'rsHigh' })
vi.mock('./chart/engine/readoutSchema', async (importOriginal) => {
  const m = await importOriginal()
  return {
    ...m,
    readoutRows: (def, scalars, ctx) => {
      const rows = m.readoutRows(def, scalars, ctx)
      if (!def || def.id !== 'u_rs_visual_va3') return rows
      return rows.map((r) => (DETAIL_OF[r.key] ? { ...r, detailOf: DETAIL_OF[r.key] } : r))
    },
  }
})

const { default: StockChart } = await import('./StockChart')
const { mergeChartSettings } = await import('./chart/chartDefaults')
const registry = await import('./chart/engine/nativeRegistry')
const { primeServerColumns, clearServerColumns, notifyColumnsLanded, serverColumnsKey, pickServerInputs } =
  await import('./chart/engine/serverCompute')
const { default: chipStyles } = await import('./chart/legend/IndicatorChip.module.css')

// ── The fixture: a readout definition with presets, detail rows and a nested card
const DEF_ID = 'u_rs_visual_va3'
const SYM = 'ENPH'
const TF = 'D'
const card = (what) => ({ what, origin: `${what} origin.` })
const FIXTURE = Object.freeze({
  schemaVersion: 1, id: DEF_ID, version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: {
    name: 'Visual Fixture', shortName: 'VFX', category: 'Momentum', repaint: 'non-repainting',
    legendParams: ['benchmark'],
    presets: [
      { id: 'classic', label: "Classic (O'Neil)", origin: 'IBD, MarketSurge', inputs: { period: 14 } },
      { id: 'fast', label: 'Fast (UCT)', origin: 'UCT workshops', inputs: { period: 7 } },
    ],
  },
  placement: { target: 'pane', scale: { min: 0, max: 100 } },
  inputs: [
    { key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 },
    { key: 'benchmark', type: 'enum', label: 'Benchmark', default: 'SPY', options: [['SPY', 'S&P 500'], ['SECTOR', 'Sector ETF']] },
  ],
  plots: [{ key: 'rsi', label: 'VFX', style: 'line', color: 'token:info', width: 1, legend: { decimals: 1 } }],
  events: [],
  readout: [
    { key: 'benchmark', label: 'Benchmark', source: 'scalar:benchmark.resolved', format: 'text', chip: true, card: card('Benchmark') },
    { key: 'rating', label: 'Rating', source: 'scalar:rating.summary', format: 'text', fallback: 'not yet rated', card: card('Rating') },
    { key: 'ratingAsOf', label: 'Rated as of', source: 'scalar:rating.asof', format: 'text' },
    { key: 'rsHigh', label: 'Last RS high', source: 'scalar:lastRsHigh.summary', format: 'text', card: card('Last RS high') },
    { key: 'barsAgo', label: 'Bars ago', source: 'scalar:lastRsHigh.barsAgo', format: 'int' },
    { key: 'beforePrice', label: 'Before price', source: 'scalar:lastRsHigh.beforePrice', format: 'bool', words: ['yes', 'no'], card: card('Before price') },
    { key: 'redDay', label: 'On a red day', source: 'scalar:lastRsHigh.redDay', format: 'bool', words: ['yes', 'no'], card: card('Red day') },
    { key: 'sensitivity', label: 'Agreement', source: 'scalar:sensitivity.summary', format: 'text' },
  ],
})
const PAYLOAD = Object.freeze({
  benchmark: { requested: 'SPY', resolved: 'XLK', label: 'Technology (XLK)', fallback: null, bars: 330 },
  rating: { summary: '94 · fast 91', asof: 'Nov 5 close' },
  lastRsHigh: { summary: '1 bar ago · before price · red day', barsAgo: 1, beforePrice: true, redDay: true },
  sensitivity: { summary: 'split: SPY rising, RSP falling, XLK rising' },
  legend: { lastValue: 0.47, asOf: 20261104 },
})

const bars = Array.from({ length: 80 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 + i }
})
const settingsWith = (extra = []) => mergeChartSettings({
  indicatorInstances: [
    { instanceId: 'vfx-1', defId: DEF_ID, inputs: {}, hidden: false },
    { instanceId: 'rsi-1', defId: 'rsi', inputs: { period: 14 }, hidden: false },
    { instanceId: 'macd-1', defId: 'macd', inputs: {}, hidden: false },
    ...extra,
  ],
})
const SETTINGS = settingsWith()

function primeFixture(payload = PAYLOAD) {
  const def = registry.getDefinition(DEF_ID)
  const inputs = pickServerInputs(def, registry.resolveInputs(def, {}))
  primeServerColumns(DEF_ID, SYM, TF, inputs, { columns: {}, payload })
  return serverColumnsKey(DEF_ID, SYM, TF, inputs)
}

const chipEl = (container, instanceId) =>
  container.querySelector(`[data-instance-id="${instanceId}"][role="button"]`)
  || container.querySelector(`[data-instance-id="${instanceId}"]`)
const menuEl = () => document.querySelector('[data-guide="chart.chipMenu"]')
const openMenu = async (container, instanceId) => {
  await vi.waitFor(() => expect(chipEl(container, instanceId), `chip ${instanceId}`).not.toBeNull(), { timeout: 8000 })
  await act(async () => { fireEvent.contextMenu(chipEl(container, instanceId)) })
  await vi.waitFor(() => expect(menuEl(), 'the chip popover').not.toBeNull())
  return menuEl()
}
const closeMenu = async () => {
  await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
  await vi.waitFor(() => expect(menuEl()).toBeNull())
}
const openWithRows = async (container) => {
  let menu
  await vi.waitFor(async () => {
    menu = await openMenu(container, 'vfx-1')
    if (!menu.querySelector('[data-readout-rows]')) { await closeMenu(); throw new Error('rows not yet derived') }
  }, { timeout: 8000, interval: 150 })
  return menu
}
const click = async (el) => { await act(async () => { fireEvent.click(el) }) }
const mount = (settings = SETTINGS, extra = {}) => render(
  <MemoryRouter><StockChart sym={SYM} tf={TF} barsOverride={bars} settingsOverride={settings}
    alwaysShowLegend height={400} {...extra} /></MemoryRouter>)

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

describe('A1 · the menu: glance rows only, one width, the readout header', () => {
  it('lists the glance rows in declaration order; the detail rows are not in the menu', async () => {
    primeFixture()
    const { container } = mount()
    const menu = await openWithRows(container)
    const rows = [...menu.querySelectorAll('[data-readout-rows] [data-readout-row]')]
    expect(rows.map((r) => r.getAttribute('data-readout-row'))).toEqual(['benchmark', 'rating', 'rsHigh', 'sensitivity'])
    for (const k of Object.keys(DETAIL_OF)) {
      expect(menu.querySelector(`[data-readout-row="${k}"]`), `${k} is a detail row`).toBeNull()
    }
    // the long value is one cell, its label another — nothing is cut in the DOM
    const sens = menu.querySelector('[data-readout-row="sensitivity"]')
    expect(sens.children[0].textContent).toBe('Agreement')
    expect(sens.children[1].textContent).toBe('split: SPY rising, RSP falling, XLK rising')
    // no value begins with its own label's first word; no "1 bars"
    for (const r of rows) {
      const label = r.children[0].textContent
      const value = r.children[1].textContent
      expect(value.toLowerCase().startsWith(label.split(' ')[0].toLowerCase()), `${label}: ${value}`).toBe(false)
    }
    expect(menu.textContent).not.toMatch(/\b1 bars\b/)
    await closeMenu()
  })

  it('the popover is 296 px; the header reads `VFX · XLK` and names the preset and the destination', async () => {
    primeFixture()
    const { container } = mount()
    const menu = await openWithRows(container)
    expect(menu.style.width).toBe('296px')
    const head = menu.querySelector('[data-legend-head="readout"]')
    expect(head, 'the readout header modifier').not.toBeNull()
    expect(head.querySelector('[data-legend-name]').textContent).toBe('VFX · XLK')
    expect(menu.textContent).not.toMatch(/VFX\(/)
    expect(head.querySelector('[data-legend-sub]').textContent).toMatch(/^Classic \(O'Neil\) · /)
    expect(head.querySelector('[data-legend-sub]').textContent).not.toContain('Visual Fixture')
    await closeMenu()
  })

  it('without `detailOf` anywhere the menu renders every row, as today (backward compatible)', async () => {
    // a definition whose rows nobody groups: the fixture under another id
    registry.uninstallUserDefinition(DEF_ID)
    const plain = { ...FIXTURE, id: 'u_rs_visual_plain' }
    expect(registry.installUserDefinitions([plain]).errors).toEqual([])
    const def = registry.getDefinition(plain.id)
    const inputs = pickServerInputs(def, registry.resolveInputs(def, {}))
    primeServerColumns(plain.id, SYM, TF, inputs, { columns: {}, payload: PAYLOAD })
    const settings = mergeChartSettings({ indicatorInstances: [{ instanceId: 'vfx-1', defId: plain.id, inputs: {}, hidden: false }] })
    const { container } = mount(settings)
    const menu = await openWithRows(container)
    expect([...menu.querySelectorAll('[data-readout-row]')].map((r) => r.getAttribute('data-readout-row')))
      .toEqual(FIXTURE.readout.map((e) => e.key))
    await closeMenu()
    registry.uninstallUserDefinition(plain.id)
  })
})

describe('A1 · the card: back row label only, the numbers block above the three lines, nested cards', () => {
  it('Last RS high opens with `‹ Last RS high`, then its numbers; Before price opens its own card and back returns', async () => {
    primeFixture()
    const { container } = mount()
    const menu = await openWithRows(container)
    await click(menu.querySelector('[data-readout-row="rsHigh"]'))
    await vi.waitFor(() => expect(menuEl().querySelector('[data-legend-card="rsHigh"]')).not.toBeNull())
    let pop = menuEl()
    expect(pop.style.width, 'the card page is the same width as the menu').toBe('296px')
    let cardEl = pop.querySelector('[data-legend-card="rsHigh"]')
    expect(cardEl.querySelector('[data-legend-back]').textContent).toBe('Last RS high')
    const nums = cardEl.querySelector('[data-card-numbers]')
    expect(nums, 'the numbers block').not.toBeNull()
    expect([...nums.querySelectorAll('[data-card-number]')].map((n) => [n.getAttribute('data-card-number'), n.textContent]))
      .toEqual([['barsAgo', 'Bars ago1'], ['beforePrice', 'Before priceyes'], ['redDay', 'On a red dayyes']])
    // ABOVE the three lines
    const what = cardEl.querySelector('[data-card-line="what"]')
    expect(nums.compareDocumentPosition(what) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // a number with its own card is a button; a plain number is not
    expect(nums.querySelector('[data-card-number="barsAgo"]').tagName).toBe('DIV')
    expect(nums.querySelector('[data-card-number="beforePrice"]').tagName).toBe('BUTTON')
    // open the nested card
    await click(nums.querySelector('[data-card-number="beforePrice"]'))
    await vi.waitFor(() => expect(menuEl().querySelector('[data-legend-card="beforePrice"]')).not.toBeNull())
    pop = menuEl()
    expect(pop.querySelector('[data-legend-card="beforePrice"] [data-legend-back]').textContent).toBe('Before price')
    // back → the Last RS high card; back again → the menu
    await click(pop.querySelector('[data-legend-back]'))
    await vi.waitFor(() => expect(menuEl().querySelector('[data-legend-card="rsHigh"]')).not.toBeNull())
    await click(menuEl().querySelector('[data-legend-back]'))
    await vi.waitFor(() => expect(menuEl().querySelector('[data-readout-rows]')).not.toBeNull())
    expect(document.querySelectorAll('[data-guide="chart.chipMenu"]')).toHaveLength(1)
    await closeMenu()
  })

  it('the Rating card carries its detail row; the Benchmark card has none and renders no numbers block', async () => {
    primeFixture()
    const { container } = mount()
    let menu = await openWithRows(container)
    await click(menu.querySelector('[data-readout-row="rating"]'))
    await vi.waitFor(() => expect(menuEl().querySelector('[data-legend-card="rating"]')).not.toBeNull())
    expect(menuEl().querySelector('[data-card-number="ratingAsOf"]').textContent).toBe('Rated as ofNov 5 close')
    await click(menuEl().querySelector('[data-legend-back]'))
    await vi.waitFor(() => expect(menuEl().querySelector('[data-readout-rows]')).not.toBeNull())
    menu = menuEl()
    await click(menu.querySelector('[data-readout-row="benchmark"]'))
    await vi.waitFor(() => expect(menuEl().querySelector('[data-legend-card="benchmark"]')).not.toBeNull())
    expect(menuEl().querySelector('[data-card-numbers]')).toBeNull()
    await closeMenu()
  })
})

describe('A6 · Preset ▸ in the chip menu', () => {
  const verbs = (menu) => [...menu.querySelectorAll('[role="menuitem"]')]

  it('the row sits right after Display in and names the current preset; its page lists both presets, Classic checked, Custom a state', async () => {
    primeFixture()
    const { container } = mount()
    const menu = await openWithRows(container)
    const ids = verbs(menu).map((b) => b.getAttribute('data-menu-id'))
    expect(ids.slice(0, 3)).toEqual(['hidden', 'move', 'preset'])
    const row = menu.querySelector('[data-menu-id="preset"]')
    expect(row.querySelector('[data-preset-current]').textContent).toBe("Classic (O'Neil)")
    await click(row)
    await vi.waitFor(() => expect(menuEl().querySelector('[data-legend-preset-page]')).not.toBeNull())
    const page = menuEl()
    expect(page.style.width).toBe('296px')
    expect(page.querySelector('[data-legend-back]').textContent).toBe('Preset')
    const rows = [...page.querySelectorAll('[data-preset-row]')]
    expect(rows.map((r) => [r.getAttribute('data-preset-row'), r.getAttribute('data-checked')]))
      .toEqual([['classic', 'true'], ['fast', 'false'], ['custom', 'false']])
    expect(rows[0].textContent).toBe("Classic (O'Neil)IBD, MarketSurge")
    expect(rows[2].tagName).toBe('DIV')
    expect(rows[2].getAttribute('aria-disabled')).toBe('true')
    await closeMenu()
  })

  it('pressing a preset writes it through applyPresetInputs and closes the popover', async () => {
    primeFixture()
    const persist = vi.fn()
    const { container } = mount(SETTINGS, { onSettingsPersist: persist })
    const menu = await openWithRows(container)
    await click(menu.querySelector('[data-menu-id="preset"]'))
    await vi.waitFor(() => expect(menuEl().querySelector('[data-preset-row="fast"]')).not.toBeNull())
    await click(menuEl().querySelector('[data-preset-row="fast"]'))
    await vi.waitFor(() => expect(menuEl()).toBeNull())
    expect(persist).toHaveBeenCalledTimes(1)
    const next = persist.mock.calls[0][0]
    const inst = next.indicatorInstances.find((i) => i.instanceId === 'vfx-1')
    expect(inst.inputs.period).toBe(7)
    // the other instances are untouched
    expect(next.indicatorInstances.find((i) => i.instanceId === 'rsi-1').inputs).toEqual({ period: 14 })
  })
})

// ⭐ Decision C4 (2026-11-07) generalised A5a by PLACEMENT: every chip drawn
// outside the price pane is a text chip and is never folded; the fold counts the
// price-pane chips only. Decision B8 removed A5a's forced line break.
const movingAverages = (n) => Array.from({ length: n }, (_, i) => (
  { instanceId: `ma-${i}`, defId: 'movingAverage', inputs: { period: 10 + i }, hidden: false }))
const chipsOf = (container) => [...container.querySelectorAll(`.${chipStyles.chip}[data-instance-id]`)]

describe('A5a + C4 · on the phone shell a chip drawn outside the price pane is text and never folded behind +N', () => {
  // C4's surface (review, 2026-11-07): the phone chart shell (it passes
  // `onLegendStudyTap`) at phone width, the one place pane labels are hidden.
  let realMatchMedia
  beforeEach(() => {
    realMatchMedia = window.matchMedia
    window.matchMedia = (q) => ({ matches: q === '(max-width: 640px)', media: q, onchange: null,
      addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false } })
  })
  afterEach(() => { window.matchMedia = realMatchMedia })
  const SHELL = { onLegendStudyTap: () => {} }

  it('with five price-pane averages the fold takes one average; the readout, RSI and MACD chips stay text', async () => {
    primeFixture()
    const { container } = mount(settingsWith(movingAverages(5)), SHELL)
    await vi.waitFor(() => expect(container.querySelector(`.${chipStyles.chipMore}`)).not.toBeNull(), { timeout: 8000 })
    const chips = chipsOf(container)
    const byId = (id) => chips.filter((c) => c.getAttribute('data-instance-id') === id)
    const vfx = byId('vfx-1')[0]
    expect(vfx, 'the readout chip renders').toBeTruthy()
    expect(vfx.textContent).toMatch(/^VFX · (SPY|XLK)/)
    // every pane chip — the readout one, RSI, and BOTH of MACD's plots — is text and shown
    const paneChips = [...byId('vfx-1'), ...byId('rsi-1'), ...byId('macd-1')]
    expect(paneChips.length, 'vfx + rsi + macd line + signal').toBe(4)
    for (const c of paneChips) {
      expect(c.className, c.textContent).toContain(chipStyles.chipText)
      expect(c.className, c.textContent).not.toContain(chipStyles.chipFolded)
    }
    // the averages are on Price (ours plus the chart's default ones): dots, and
    // the only chips the fold may take
    const mas = chips.filter((c) => /^ma-/.test(c.getAttribute('data-instance-id')))
    expect(mas).toHaveLength(5)
    const priceChips = chips.filter((c) => !paneChips.includes(c))
    for (const c of priceChips) expect(c.className, c.textContent).not.toContain(chipStyles.chipText)
    const folded = chips.filter((c) => c.className.includes(chipStyles.chipFolded))
    expect(folded.every((c) => priceChips.includes(c)), 'a pane chip was folded').toBe(true)
    // the fold keeps the first four PRICE chips, whatever the pane chips number
    expect(folded.length).toBe(priceChips.length - 4)
    expect(priceChips.slice(0, 4).some((c) => folded.includes(c))).toBe(false)
    expect(container.querySelector(`.${chipStyles.chipMore}`).textContent).toBe(`+${folded.length}`)
    // B8: one row — no forced line break before the text chips
    expect(container.querySelector('[class*="chipBreak"]'), 'A5a line break is gone').toBeNull()
  })

  it('⛔ the control: an RSI moved onto Price is a dot again — placement decides, not the definition', async () => {
    primeFixture()
    const { container } = mount(settingsWith([{ instanceId: 'rsi-p', defId: 'rsi', inputs: { period: 9 }, hidden: false, placement: { target: 'price' } }]), SHELL)
    // the inline chip, not the phone-width vertical legend row that shares its id
    const chipOf = (id) => [...container.querySelectorAll(`[data-instance-id="${id}"]`)]
      .find((e) => e.className.includes(chipStyles.chip)) || null
    const onPrice = await vi.waitFor(() => { const c = chipOf('rsi-p'); expect(c).not.toBeNull(); return c }, { timeout: 8000 })
    const inPane = chipOf('rsi-1')
    expect(inPane.className).toContain(chipStyles.chipText)
    expect(onPrice.className).not.toContain(chipStyles.chipText)
  })

  it('with nothing in a pane of its own, no chip is text and the fold is what it was', async () => {
    const settings = mergeChartSettings({ indicatorInstances: movingAverages(6) })
    const { container } = mount(settings)
    await vi.waitFor(() => expect(container.querySelector(`.${chipStyles.chipMore}`)).not.toBeNull(), { timeout: 8000 })
    const chips = chipsOf(container)
    expect(chips.length, 'six of ours, plus the chart default averages').toBeGreaterThanOrEqual(6)
    expect(chips.filter((c) => c.className.includes(chipStyles.chipText))).toHaveLength(0)
    const folded = chips.filter((c) => c.className.includes(chipStyles.chipFolded))
    expect(folded).toHaveLength(chips.length - 4)
    expect(chips.slice(4)).toEqual(folded)
    expect(container.querySelector(`.${chipStyles.chipMore}`).textContent).toBe(`+${chips.length - 4}`)
  })
})

describe('C5 · on the phone shell a readout chip tap opens the menu sheet; other chips keep tap -> editor', () => {
  it('the readout chip: a tap opens the chip menu (the long-press sheet) and never the editor', async () => {
    primeFixture()
    const onLegendStudyTap = vi.fn()
    const { container } = mount(SETTINGS, { onLegendStudyTap })
    const chip = await vi.waitFor(() => { const c = chipEl(container, 'vfx-1'); expect(c).not.toBeNull(); return c }, { timeout: 8000 })
    // the menu-trigger semantics come with it
    expect(chip.getAttribute('role')).toBe('button')
    expect(chip.getAttribute('aria-haspopup')).toBe('menu')
    await act(async () => { fireEvent.click(chip) })
    await vi.waitFor(() => expect(menuEl(), 'the chip menu').not.toBeNull())
    expect(onLegendStudyTap).not.toHaveBeenCalled()
    // ⭐ Edit is one row away, and it lands on the SAME editor a tap used to open
    await click(menuEl().querySelector('[data-menu-id="settings"]'))
    expect(onLegendStudyTap).toHaveBeenCalledTimes(1)
    expect(onLegendStudyTap.mock.calls[0][0]).toEqual({ kind: 'study', defId: DEF_ID, instanceId: 'vfx-1' })
    await vi.waitFor(() => expect(menuEl()).toBeNull())
  })

  it('⛔ the control: an RSI chip tap still opens its study editor, and no menu', async () => {
    primeFixture()
    const onLegendStudyTap = vi.fn()
    const { container } = mount(SETTINGS, { onLegendStudyTap })
    const chip = await vi.waitFor(() => { const c = container.querySelector('[data-instance-id="rsi-1"]'); expect(c).not.toBeNull(); return c }, { timeout: 8000 })
    expect(chip.getAttribute('aria-haspopup')).toBeNull()
    await act(async () => { fireEvent.click(chip) })
    expect(onLegendStudyTap).toHaveBeenCalledTimes(1)
    expect(onLegendStudyTap.mock.calls[0][0]).toEqual({ kind: 'study', defId: 'rsi', instanceId: 'rsi-1' })
    expect(menuEl()).toBeNull()
  })

  it('without the phone shell (no onLegendStudyTap) every chip body opens the menu, as before', async () => {
    primeFixture()
    const { container } = mount()
    const chip = await vi.waitFor(() => { const c = chipEl(container, 'rsi-1'); expect(c).not.toBeNull(); return c }, { timeout: 8000 })
    expect(chip.getAttribute('aria-haspopup')).toBe('menu')
    await act(async () => { fireEvent.click(chip) })
    await vi.waitFor(() => expect(menuEl()).not.toBeNull())
    await closeMenu()
  })
})

describe('⛔ the control — RSI and MACD are untouched', () => {
  for (const id of ['rsi-1', 'macd-1']) {
    it(`${id}: 204 px popover, the base header, no readout rows, no Preset row, the shipped verbs`, async () => {
      primeFixture()
      const { container } = mount()
      const chip = await vi.waitFor(() => { const c = chipEl(container, id); expect(c).not.toBeNull(); return c }, { timeout: 8000 })
      // Off the phone shell a pane chip stays the shipped dot chip (C4's text
      // chip is phone-shell only, review 2026-11-07), and never takes the
      // readout's short name or its ` · ` grammar.
      expect(chip.className).not.toContain(chipStyles.chipText)
      expect(chip.textContent).not.toContain(' · ')
      expect(chip.querySelector('[data-stale-value]')).toBeNull()
      const menu = await openMenu(container, id)
      expect(menu.style.width).toBe('204px')
      expect(menu.querySelector('[data-legend-head="readout"]')).toBeNull()
      expect(menu.querySelector('[data-readout-rows]')).toBeNull()
      expect(menu.querySelector('[data-menu-id="preset"]')).toBeNull()
      expect([...menu.querySelectorAll('[role="menuitem"]')].map((b) => b.getAttribute('data-menu-id')))
        .toEqual(['hidden', 'move', 'settings', 'info-value', 'duplicate', 'custom-copy', 'alerts', 'about', 'remove'])
      expect(chip.getAttribute('aria-label')).toBe(`${menu.querySelector('[data-legend-name]').textContent} options`)
      await closeMenu()
    })
  }
})

describe('the stylesheet — one type scale, one grid, the host inks', () => {
  const css = readFileSync(join(process.cwd(), 'src/components/StockChart.module.css'), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '')
  const base = css.replace(/@media[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
  const rule = (src, sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`).exec(src)
    expect(m, sel).toBeTruthy()
    return m[1]
  }
  const phone = (() => {
    const at = css.indexOf('@media (max-width: 640px)', css.indexOf('.legPresetPage'))
    return css.slice(at)
  })()

  it('every row label and value is 12 px on desktop, and the card-row button declares its OWN font (not inherit)', () => {
    expect(rule(base, '.legMenuRow')).toMatch(/font:\s*500 12px\/16px 'Instrument Sans'/)
    expect(rule(base, '.legMenuRowBtn')).toMatch(/font:\s*500 12px\/16px 'Instrument Sans'/)
    expect(rule(base, '.legMenuRowBtn')).not.toMatch(/font:\s*inherit/)
    for (const sel of ['.legMenuRowLabel', '.legMenuRowVal']) expect(rule(base, sel)).not.toMatch(/font-size/)
    expect(rule(base, '.legMenuRowVal')).toMatch(/font-weight:\s*600/)
    expect(rule(base, '.legMenuRowLabel')).toMatch(/font-weight:\s*500/)
  })

  it('light theme: every ink the readout surface uses measures ≥ 4.5:1 against the host\'s --bg-elevated', () => {
    // the SHIPPED token values, read from tokens.css — never retyped here
    const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8').replace(/\r\n/g, '\n')
    const light = tokens.slice(tokens.indexOf('[data-theme="light"] {'))
    const block = light.slice(0, light.indexOf('\n}'))
    const tok = (name) => {
      const m = new RegExp(`\\n\\s*${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(block)
      expect(m, `${name} in the light theme`).toBeTruthy()
      return m[1]
    }
    const lum = (hex) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
    const bg = tok('--bg-elevated')
    for (const ink of ['--text-bright', '--text', '--text-muted', '--ut-gold']) {
      expect(ratio(tok(ink), bg), `${ink} on --bg-elevated`).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('14 px on the phone, the 112 / 16 grid, three value lines', () => {
    const r = rule(phone, '.legMenuRow,\n  .legMenuRowBtn')
    expect(r).toMatch(/font-size:\s*14px/)
    expect(r).toMatch(/grid-template-columns:\s*112px minmax\(0, 1fr\) 16px/)
    expect(phone).toMatch(/\.legMenuRowVal\s*\{\s*-webkit-line-clamp:\s*3/)
  })

  it('the 88 / 1fr / 12 grid; the label never truncates; the value wraps, left-aligned, at most two lines', () => {
    const row = rule(base, '.legMenuRow')
    expect(row).toMatch(/display:\s*grid/)
    expect(row).toMatch(/grid-template-columns:\s*88px minmax\(0, 1fr\) 12px/)
    expect(row).toMatch(/column-gap:\s*8px/)
    expect(row).toMatch(/min-height:\s*24px/)
    const label = rule(base, '.legMenuRowLabel')
    expect(label).not.toMatch(/text-overflow|overflow:\s*hidden/)
    const val = rule(base, '.legMenuRowVal')
    expect(val).toMatch(/text-align:\s*left/)
    expect(val).toMatch(/white-space:\s*normal/)
    expect(val).toMatch(/overflow-wrap:\s*anywhere/)
    expect(val).toMatch(/-webkit-line-clamp:\s*2/)
    expect(rule(base, '.legCardNum')).toMatch(/grid-template-columns:\s*104px minmax\(0, 1fr\) 12px/)
    expect(rule(base, '.legCardNumVal')).toMatch(/-webkit-line-clamp:\s*3/)
  })

  it('header line 2 is 11 px / 500 and the card key 11 px / 600 uppercase 0.04em', () => {
    const sub = rule(base, '.legMenuHeadRs .legMenuSub')
    expect(sub).toMatch(/font-size:\s*11px/)
    expect(sub).toMatch(/font-weight:\s*500/)
    const key = rule(base, '.legCardKey')
    expect(key).toMatch(/font-size:\s*11px/)
    expect(key).toMatch(/letter-spacing:\s*0\.04em/)
    expect(key).toMatch(/text-transform:\s*uppercase/)
  })

  it('⛔ no `--menu-*` and no literal #f8f7f3 in the readout rows, the cards or the preset page; inks are host tokens', () => {
    const owned = (base.match(/[^{}]*\{[^}]*\}/g) || [])
      .filter((r) => /\.(legMenuRow|legMenuRows|legMenuHeadRs|legCard|legPreset|legVerb|legTour|legAsk)/.test(r.split('{')[0]))
    expect(owned.length).toBeGreaterThan(20)
    for (const r of owned) {
      expect(r, r.split('{')[0].trim()).not.toMatch(/--menu-/)
      expect(r, r.split('{')[0].trim()).not.toMatch(/#f8f7f3/i)
      expect(r).not.toMatch(/--text-primary|--text-dim/)
    }
    expect(rule(base, '.legMenuRowVal')).toMatch(/color:\s*var\(--text-bright\)/)
    expect(rule(base, '.legMenuRowLabel')).toMatch(/color:\s*var\(--text-muted\)/)
    expect(rule(base, '.legCardText')).toMatch(/color:\s*var\(--text\)/)
    expect(rule(base, '.legMenuRowBtn:hover,\n.legMenuRowBtn:focus-visible')).toMatch(/var\(--bg-hover\)/)
    // gold: the one look-here element on a card, and the lesson hover — nothing else
    const gold = owned.filter((r) => /--ut-gold/.test(r)).map((r) => r.split('{')[0].trim())
    expect(gold).toEqual(['.legCardLearn', '.legCardLesson:hover,\n.legCardLesson:focus-visible'])
    // the preset check is the bright ink, never gold
    expect(rule(base, '.legPresetCheck')).toMatch(/color:\s*var\(--text-bright\)/)
  })

  it('one popover width capped to the viewport, scrolling inside, scoped to readout content', () => {
    // every RS page: menu (header), card, Preset, Display in (its marker, VA3) and the
    // first-add Tour page (4-05)
    const cap = rule(base, ':global([data-guide="chart.chipMenu"]):has(.legMenuHeadRs, .legCard, .legPresetPage, .legReadoutMark, .legTour)')
    expect(cap).toMatch(/max-width:\s*calc\(100vw - 16px\)/)
    expect(cap).toMatch(/max-height:\s*calc\(100vh - 16px\)/)
    expect(cap).toMatch(/overflow-y:\s*auto/)
    expect(rule(base, '.legReadoutMark')).toMatch(/display:\s*none/)
  })

  it('a row note is a muted second line in the value column, one step smaller', () => {
    const note = rule(base, '.legMenuRowNote')
    expect(note).toMatch(/grid-column:\s*2/)
    expect(note).toMatch(/grid-row:\s*2/)
    expect(note).toMatch(/color:\s*var\(--text-muted\)/)
    expect(note).toMatch(/11px/)
  })

  it('lesson rows 28 px on desktop and the tap floor on touch; card rows meet it on touch', () => {
    expect(rule(base, '.legCardLesson')).toMatch(/min-height:\s*28px/)
    const touch = css.slice(css.indexOf('@media (max-width: 1024px)', css.indexOf('.legPresetPage')))
    for (const sel of ['legCardLesson', 'legPresetRow', 'legMenuRowBtn', 'legCardNumBtn']) {
      expect(touch).toMatch(new RegExp(`\\.${sel}\\s*\\{\\s*min-height:\\s*var\\(--tap-min\\)`))
    }
  })
})

describe('the wires, read from the source', () => {
  const src = readFileSync(join(process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
  it('the preset applies through applyPresetInputs and the chart\'s one writer', () => {
    expect(src).toContain('const next = applyPresetInputs(cs, instanceId, def, preset, engineRegistry)')
    expect(src).toMatch(/onPreset: \(id, presetId\) => \{ close\(\); handleChipPreset\(id, presetId\) \}/)
    expect(src).toContain('detectPreset(menuPresets, resolvedInputsOf(def, inst.inputs || {}), { instance: inst, def, cs })')
  })
  it('A8: the pane label falls back to the muted last value for a readout definition', () => {
    expect(src).toMatch(/value=\{chipValueText\(c\) \|\| \(\(\) => \{/)
    // ⭐ 3-14: the same muted span; a server note (`fallback.note`, a pane that drew
    // nothing) also takes `paneValueNote` (it wraps) and `data-empty-note`.
    expect(src).toContain('<span className={s.fallback.note ? `${styles.paneValueStale} ${styles.paneValueNote}` : styles.paneValueStale}')
    expect(src).toContain(`data-stale-value="" {...(s.fallback.note ? { 'data-empty-note': '' } : null)}>{s.fallback.text}</span>`)
  })
})
