// app/src/components/StockChart.rsReadout.test.jsx
//
// ─── UCT Relative Strength · the readout SURFACES (Phase 2a, unit 2a-10) ────
//
// Unit 2a-09 built the rows (`readoutSchema.readoutRows`) and taught
// `readout.legendChips` to stamp them on a chip through an `opts.scalarsOf`
// reader. This is the half a member can see, on the REAL StockChart with
// lightweight-charts stubbed:
//
//   1. THE WIRE — StockChart binds `serverCompute.scalarsFor` to the chart's
//      own (sym, tf) and hands it to every `legendChips` call, so a chip whose
//      definition declares `readout[]` carries `chip.readout` once the server's
//      envelope has landed (`primeServerColumns` + `notifyColumnsLanded`, the
//      seam the lane itself uses).
//   2. THE MENU — a chip's popover prints those rows as label/value lines under
//      the header, above the verbs; a muted fallback is dimmed, never hidden.
//   3. THE CARD — a row with a `card` is a button; it opens the three-line About
//      page IN PLACE of the menu body (same popover), with a 44 px back row that
//      returns to the rows, a "Watch the lesson" link for the row's own lesson
//      and the definition's `meta.learn` lessons, every href from the ONE Desk
//      video builder (`lib/deskVideoHref.learnHref`).
//   4. THE CONTROL — RSI, which declares no `readout[]`: its chip is unchanged
//      in every field a surface reads, and its menu renders no rows at all.
//
// ⛔ The fixture is a definition installed through `installUserDefinitions`, the
// one door a chart resolves a non-shipped definition through — `nativeRegistry`
// is not edited here (unit 2a-14 writes the real `readout[]` and `meta.learn`
// on `rsLine`). It computes on the native lane (`fn: 'rsi'`) so no server
// request and no worker is involved; `scalarsFor` is lane-agnostic and reads
// whatever envelope is cached under the definition's id.
//
// ⚠️ NO BROWSER RENDER HERE. jsdom lays nothing out; what is asserted is the DOM
// the popover produces and the stylesheet's declaration for the back row.
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
const { learnHref, RS_LEARN_VIDEOS } = await import('../lib/deskVideoHref')

// ── The fixture definition ───────────────────────────────────────────────────
const DEF_ID = 'u_rs_readout_2a10'
const SYM = 'ENPH'
const TF = 'D'
const LEARN = Object.freeze([
  { key: 'rsLine', label: 'Manrav on the RS line' },
  { key: 'fourChecks', label: 'The four RS checks' },
  // a key the Learn map does not know: the schema accepts it, the surface renders no link
  { key: 'noSuchLesson', label: 'unresolvable' },
])
const CARD = Object.freeze({
  what: 'What the RS line is measured against.',
  origin: 'IBD draws RS against the S&P 500; the sector ETF isolates the stock from its group.',
  evidence: 'Persistence over 6 to 12 months; no published hit rate for the dot.',
  // 2b-09: the evidence line reads the payload when it carries a sentence here
  evidenceSource: 'scalar:evidence.sentence.benchmark',
  learn: 'beforePrice',
})
/** `rs_evidence_pull.HONESTY_SENTENCE` and the measured sentence `sentence_for` builds
 *  over the 2b-01 fixture (`tests/test_rs_evidence_pull.py`), both verbatim. */
const HONESTY = 'No published hit rate exists for this signal and UCT has not measured one yet.'
// The server's sentence (rs_evidence_pull.sentence_for): since owner decision N6
// (2026-11-07) the hit rate states its base, the next session's open.
const MEASURED = '1,284 RS new highs before price on 240 sessions, 2025-11-05 to 2026-11-04, daily bars: 58.3% beat SPY from the next session\'s open to the close 63 sessions later (about 3 months; median +2.1%), against 50.2% for all bars. Universe as held, survivorship not yet corrected.'
const FIXTURE = Object.freeze({
  schemaVersion: 1, id: DEF_ID, version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  // `legendParams: ['benchmark']` as rsLine declares it: the chip reads `RSF(SPY)`, the
  // pane `Readout Fixture · SPY`, and the server's resolved benchmark REPLACES it.
  meta: { name: 'Readout Fixture', shortName: 'RSF', category: 'Momentum', repaint: 'non-repainting', learn: LEARN, legendParams: ['benchmark'] },
  placement: { target: 'pane', scale: { min: 0, max: 100 } },
  inputs: [
    { key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 },
    { key: 'benchmark', type: 'enum', label: 'Benchmark', default: 'SPY', options: [['SPY', 'S&P 500'], ['SECTOR', 'Sector ETF']] },
  ],
  plots: [{ key: 'rsi', label: 'RSF', style: 'line', color: 'token:info', width: 1, legend: { decimals: 1 } }],
  events: [],
  readout: [
    { key: 'benchmark', label: 'Benchmark', source: 'scalar:benchmark.resolved', format: 'text', chip: true, card: CARD,
      note: 'scalar:benchmark.note' },
    { key: 'rating', label: 'Rating', source: 'scalar:rating.ibd', format: 'int', fallback: 'not yet rated' },
    { key: 'phase', label: 'RS line', source: 'scalar:legend.above', format: 'bool', words: ['above its average', 'below its average'] },
  ],
})
// The v2 envelope's scalars: the sector ETF resolved, no rating yet, above the average.
const PAYLOAD = Object.freeze({
  benchmark: { requested: 'SPY', resolved: 'XLK', label: 'Technology (XLK)', fallback: null, bars: 330 },
  legend: { pctFromMa: 1.84, maSlope: 1, above: true },
})

const bars = Array.from({ length: 80 }, (_, i) => {
  const t = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10)
  return { t, o: 100, h: 101, l: 99, c: 100 + (i % 5), v: 1000 + i }
})
// ⛔ identity-stable: `settingsOverride` is a memo dep.
const SETTINGS = mergeChartSettings({
  indicatorInstances: [
    { instanceId: 'rsf-1', defId: DEF_ID, inputs: {}, hidden: false },
    { instanceId: 'rsi-1', defId: 'rsi', inputs: { period: 14 }, hidden: false },
  ],
})
const CHART_PROPS = { sym: SYM, tf: TF, barsOverride: bars, settingsOverride: SETTINGS, alwaysShowLegend: true, height: 400 }

/** Seed the envelope exactly as the lane keys it: the RESOLVED inputs, server keys only. */
function primeFixture(payload = PAYLOAD) {
  const def = registry.getDefinition(DEF_ID)
  const inputs = pickServerInputs(def, registry.resolveInputs(def, {}))
  primeServerColumns(DEF_ID, SYM, TF, inputs, { columns: {}, payload })
  return serverColumnsKey(DEF_ID, SYM, TF, inputs)
}

const chipEl = (container, instanceId) => container.querySelector(`[data-instance-id="${instanceId}"]`)
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
const rowsOf = (menu) => [...menu.querySelectorAll('[data-readout-row]')].map((el) => ({
  key: el.getAttribute('data-readout-row'),
  text: el.textContent,
  muted: el.getAttribute('data-muted'),
  tag: el.tagName,
  card: el.hasAttribute('data-readout-card'),
}))
const mount = (routed = true) => render(routed
  ? <MemoryRouter><StockChart {...CHART_PROPS} /></MemoryRouter>
  : <StockChart {...CHART_PROPS} />)

const realClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'clientHeight')
beforeEach(() => {
  cleanup()
  clearServerColumns()
  Object.defineProperty(Element.prototype, 'clientHeight', { configurable: true, get: () => 400 })
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })))
  const r = registry.installUserDefinitions([FIXTURE])
  expect(r.errors, 'the fixture installs').toEqual([])
  expect(r.installed).toHaveLength(1)
})
afterEach(() => {
  cleanup()
  registry.uninstallUserDefinition(DEF_ID)
  clearServerColumns()
  Object.defineProperty(Element.prototype, 'clientHeight', realClientHeight)
  vi.unstubAllGlobals()
})

describe('the menu prints the readout rows once the envelope lands', () => {
  it('no envelope → no rows; prime + notify → label/value rows above the verbs, the muted fallback dimmed and present', async () => {
    const { container } = mount()
    // 1. BEFORE the envelope: the chip is there, the menu has no readout section at all.
    let menu = await openMenu(container, 'rsf-1')
    expect(menu.querySelector('[data-readout-rows]')).toBeNull()
    expect(menu.querySelector('[role="menuitem"]'), 'the verbs render without an envelope').not.toBeNull()
    await closeMenu()

    // 2. The envelope lands the way the lane says so: prime, then notify.
    const key = primeFixture()
    await act(async () => { notifyColumnsLanded(key) })

    // 3. The chips re-derive and the menu prints the rows.
    await vi.waitFor(async () => {
      menu = await openMenu(container, 'rsf-1')
      if (!menu.querySelector('[data-readout-rows]')) { await closeMenu(); throw new Error('rows not yet derived') }
    }, { timeout: 8000, interval: 150 })
    const rows = rowsOf(menu)
    expect(rows.map((r) => [r.key, r.text])).toEqual([
      ['benchmark', 'BenchmarkXLK'],
      ['rating', 'Ratingnot yet rated'],
      ['phase', 'RS lineabove its average'],
    ])
    // the muted fallback is DIMMED, never hidden
    expect(rows.find((r) => r.key === 'rating')).toMatchObject({ muted: 'true', tag: 'DIV', card: false })
    expect(rows.find((r) => r.key === 'benchmark')).toMatchObject({ muted: 'false', tag: 'BUTTON', card: true })
    expect(rows.find((r) => r.key === 'phase')).toMatchObject({ muted: 'false', tag: 'DIV', card: false })
    // above the existing menu items — the rows precede the first verb in document order
    const firstItem = menu.querySelector('[role="menuitem"]')
    expect(firstItem, 'the verbs are still there').not.toBeNull()
    const section = menu.querySelector('[data-readout-rows]')
    expect(section.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // and the header still carries the chip's name
    expect(menu.textContent).toContain('RSF')
    // no emoji anywhere on this surface
    expect(menu.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
    await closeMenu()
  })
})

describe('the row note and the Display-in page (visual round, 2026-11-07)', () => {
  it('a note prints as a muted second line inside its row, and only when the payload carries one', async () => {
    const { container } = mount()
    const key = primeFixture({ ...PAYLOAD, benchmark: { ...PAYLOAD.benchmark, note: 'No XLK bar for Nov 5 yet' } })
    await act(async () => { notifyColumnsLanded(key) })
    let menu
    await vi.waitFor(async () => {
      menu = await openMenu(container, 'rsf-1')
      if (!menu.querySelector('[data-readout-rows]')) { await closeMenu(); throw new Error('rows not yet derived') }
    }, { timeout: 8000, interval: 150 })
    const row = menu.querySelector('[data-readout-row="benchmark"]')
    const note = row.querySelector('[data-readout-note]')
    expect(note, 'the note sits inside its own row').not.toBeNull()
    expect(note.textContent).toBe('No XLK bar for Nov 5 yet')
    // the value itself stays in the normal ink; only the note is quiet
    expect(row.getAttribute('data-muted')).toBe('false')
    // control: the rows without a declared note carry none
    expect(menu.querySelectorAll('[data-readout-note]')).toHaveLength(1)
    await closeMenu()
  })

  it('the Display-in page of a readout chip carries the cap marker and a plain chip page does not', async () => {
    const { container } = mount()
    const open = async (id) => {
      const menu = await openMenu(container, id)
      const item = [...menu.querySelectorAll('[role="menuitem"]')].find((el) => /Display in/.test(el.textContent))
      expect(item, `${id}: a Display in row`).toBeTruthy()
      await act(async () => { fireEvent.click(item) })
      await vi.waitFor(() => expect(menuEl().textContent).toMatch(/Own pane|New pane|Price pane|pane/i))
      return menuEl()
    }
    let page = await open('rsf-1')
    expect(page.querySelector('[data-readout-mark]'), 'the readout chip marks its Display-in page').not.toBeNull()
    await closeMenu()
    page = await open('rsi-1')
    expect(page.querySelector('[data-readout-mark]'), 'RSI is untouched').toBeNull()
    await closeMenu()
  })
})

describe('the About card', () => {
  it('a card row opens the three-line page in place of the menu body, links the lesson, lists meta.learn, and the back row returns', async () => {
    primeFixture()
    const { container } = mount()
    let menu
    await vi.waitFor(async () => {
      menu = await openMenu(container, 'rsf-1')
      if (!menu.querySelector('[data-readout-card]')) { await closeMenu(); throw new Error('rows not yet derived') }
    }, { timeout: 8000, interval: 150 })

    // open the card
    await act(async () => { fireEvent.click(menu.querySelector('[data-readout-row="benchmark"]')) })
    await vi.waitFor(() => expect(menuEl()?.querySelector('[data-legend-card="benchmark"]')).not.toBeNull())
    const popover = menuEl()
    const card = popover.querySelector('[data-legend-card="benchmark"]')
    // IN PLACE of the menu body: the same popover, no verbs, no readout rows
    expect(popover.querySelector('[role="menuitem"]')).toBeNull()
    expect(popover.querySelector('[data-readout-rows]')).toBeNull()
    expect(document.querySelectorAll('[data-guide="chart.chipMenu"]')).toHaveLength(1)
    // the back row at the top carries the row's LABEL only (visual round A1: the
    // composed values are too long for one line beside a title)
    const back = card.querySelector('[data-legend-back]')
    expect(back.tagName).toBe('BUTTON')
    expect(back.textContent).toBe('Benchmark')
    expect(back.textContent).not.toContain('XLK')
    expect(card.firstElementChild).toBe(back)
    // the three lines
    expect(card.querySelector('[data-card-line="what"]').textContent).toContain(CARD.what)
    expect(card.querySelector('[data-card-line="origin"]').textContent).toContain(CARD.origin)
    expect(card.querySelector('[data-card-line="evidence"]').textContent).toContain(CARD.evidence)
    // the row's own lesson: a react-router <Link> (an <a> inside the MemoryRouter) whose href
    // is exactly what the ONE Desk video builder answers, with the video's label
    const learn = card.querySelector('a[data-learn="beforePrice"]')
    expect(learn).not.toBeNull()
    expect(learn.getAttribute('href')).toBe(learnHref('beforePrice'))
    expect(learnHref('beforePrice')).toBe('/desk?section=videos&v=_0ZvKLYznLo&t=1814')
    expect(learn.textContent).toContain('Watch the lesson')
    expect(learn.textContent).toContain(RS_LEARN_VIDEOS.beforePrice.label)
    expect(learn.getAttribute('target'), 'same tab — the Desk is an in-app route').toBeNull()
    // the definition's lessons, each through the same builder; the unknown key renders nothing
    const lessons = [...card.querySelectorAll('[data-legend-lessons] a[data-learn]')]
    expect(lessons.map((a) => [a.getAttribute('data-learn'), a.getAttribute('href'), a.textContent])).toEqual([
      ['rsLine', learnHref('rsLine'), 'Manrav on the RS line'],
      ['fourChecks', learnHref('fourChecks'), 'The four RS checks'],
    ])
    expect(card.querySelector('[data-learn="noSuchLesson"]')).toBeNull()
    expect(card.textContent).not.toMatch(/\p{Extended_Pictographic}/u)

    // back: the rows are back, the card is gone, same popover
    await act(async () => { fireEvent.click(back) })
    await vi.waitFor(() => expect(menuEl()?.querySelector('[data-readout-rows]')).not.toBeNull())
    expect(menuEl().querySelector('[data-legend-card]')).toBeNull()
    expect(menuEl().querySelector('[role="menuitem"]')).not.toBeNull()
    await closeMenu()
  })

  it('without a card, evidence and lesson are optional: a card with only what/origin renders two lines and no Learn link', async () => {
    const def = registry.getDefinition(DEF_ID)
    // re-install with a bare card: what + origin only, no learn, no meta.learn
    registry.uninstallUserDefinition(DEF_ID)
    const bare = {
      ...FIXTURE,
      meta: { ...FIXTURE.meta, learn: undefined },
      readout: [{ ...FIXTURE.readout[0], card: { what: 'w', origin: 'o' } }],
    }
    delete bare.meta.learn
    expect(registry.installUserDefinitions([bare]).errors).toEqual([])
    expect(def).not.toBeNull()
    primeFixture()
    const { container } = mount()
    let menu
    await vi.waitFor(async () => {
      menu = await openMenu(container, 'rsf-1')
      if (!menu.querySelector('[data-readout-card]')) { await closeMenu(); throw new Error('rows not yet derived') }
    }, { timeout: 8000, interval: 150 })
    await act(async () => { fireEvent.click(menu.querySelector('[data-readout-row="benchmark"]')) })
    await vi.waitFor(() => expect(menuEl()?.querySelector('[data-legend-card="benchmark"]')).not.toBeNull())
    const card = menuEl().querySelector('[data-legend-card="benchmark"]')
    expect(card.querySelector('[data-card-line="evidence"]')).toBeNull()
    expect(card.querySelector('a[data-learn]')).toBeNull()
    expect(card.querySelector('[data-legend-lessons]')).toBeNull()
    await closeMenu()
  })

  it('on a mount with NO router (popups, the Model Book) the lesson is a plain same-tab anchor with the same href', async () => {
    primeFixture()
    const { container } = mount(false)
    let menu
    await vi.waitFor(async () => {
      menu = await openMenu(container, 'rsf-1')
      if (!menu.querySelector('[data-readout-card]')) { await closeMenu(); throw new Error('rows not yet derived') }
    }, { timeout: 8000, interval: 150 })
    await act(async () => { fireEvent.click(menu.querySelector('[data-readout-row="benchmark"]')) })
    await vi.waitFor(() => expect(menuEl()?.querySelector('[data-legend-card="benchmark"]')).not.toBeNull())
    const learn = menuEl().querySelector('a[data-learn="beforePrice"]')
    expect(learn.getAttribute('href')).toBe(learnHref('beforePrice'))
    expect(learn.getAttribute('target')).toBeNull()
    await closeMenu()
  })

  it('the About page (About <name>) lists the definition\'s lessons too', async () => {
    primeFixture()
    const { container } = mount()
    const menu = await openMenu(container, 'rsf-1')
    const about = [...menu.querySelectorAll('[role="menuitem"]')].find((b) => /^About /.test(b.textContent))
    expect(about, 'the About row').toBeTruthy()
    await act(async () => { fireEvent.click(about) })
    await vi.waitFor(() => expect(document.querySelector('[data-legend-lessons]')).not.toBeNull())
    const links = [...document.querySelectorAll('[data-legend-lessons] a[data-learn]')]
    expect(links.map((a) => [a.getAttribute('data-learn'), a.getAttribute('href')])).toEqual([
      ['rsLine', learnHref('rsLine')],
      ['fourChecks', learnHref('fourChecks')],
    ])
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }) })
  })
})

describe('the evidence line (unit 2b-09) — read from the payload, verbatim', () => {
  const openCard = async (container) => {
    let menu
    await vi.waitFor(async () => {
      menu = await openMenu(container, 'rsf-1')
      if (!menu.querySelector('[data-readout-card]')) { await closeMenu(); throw new Error('rows not yet derived') }
    }, { timeout: 8000, interval: 150 })
    await act(async () => { fireEvent.click(menu.querySelector('[data-readout-row="benchmark"]')) })
    await vi.waitFor(() => expect(menuEl()?.querySelector('[data-legend-card="benchmark"]')).not.toBeNull())
    return menuEl().querySelector('[data-legend-card="benchmark"]')
  }
  const evidenceLine = (card) => card.querySelector('[data-card-line="evidence"] span:last-child').textContent

  it('the payload carries the measured sentence → the card prints it VERBATIM, and not the static line', async () => {
    primeFixture({ ...PAYLOAD, evidence: { asof: '2026-11-04', horizon: 63, source: 'artifact', baseline: null,
      signals: { benchmark: { n: 1284, hit_rate_pct: 58.3 } }, sentence: { benchmark: MEASURED } } })
    const { container } = mount()
    const card = await openCard(container)
    expect(evidenceLine(card)).toBe(MEASURED)
    expect(card.textContent).not.toContain(CARD.evidence)
    expect(card.querySelector('[data-card-line="evidence"]').textContent).toContain('What the evidence says')
    // the other two lines are untouched
    expect(card.querySelector('[data-card-line="what"]').textContent).toContain(CARD.what)
    expect(card.querySelector('[data-card-line="origin"]').textContent).toContain(CARD.origin)
    await closeMenu()
  })

  it('no artifact has landed → the provider sends the honesty sentence and the card prints that', async () => {
    primeFixture({ ...PAYLOAD, evidence: { asof: null, horizon: 63, source: 'none', baseline: null,
      signals: { benchmark: null }, sentence: { benchmark: HONESTY } } })
    const { container } = mount()
    const card = await openCard(container)
    expect(evidenceLine(card)).toBe(HONESTY)
    expect(card.textContent).not.toContain(CARD.evidence)
    await closeMenu()
  })

  it('an envelope with no evidence block at all → the static line stands (the pre-2b-03 envelope, byte for byte)', async () => {
    primeFixture(PAYLOAD)
    const { container } = mount()
    const card = await openCard(container)
    expect(evidenceLine(card)).toBe(CARD.evidence)
    await closeMenu()
  })

  it('a card whose source resolves to nothing and that declares no static line renders no evidence line', async () => {
    registry.uninstallUserDefinition(DEF_ID)
    const bare = { ...FIXTURE, readout: [{ ...FIXTURE.readout[0], card: { what: 'w', origin: 'o', evidenceSource: 'scalar:evidence.sentence.benchmark' } }] }
    expect(registry.installUserDefinitions([bare]).errors).toEqual([])
    primeFixture({ ...PAYLOAD, evidence: { sentence: { benchmark: null } } })
    const { container } = mount()
    const card = await openCard(container)
    expect(card.querySelector('[data-card-line="evidence"]')).toBeNull()
    expect(card.querySelector('[data-card-line="what"]')).not.toBeNull()
    await closeMenu()
  })
})

describe('the control — a definition with no readout[] is untouched', () => {
  it('RSI: the menu renders no readout section, byte for byte the header it always had', async () => {
    primeFixture()
    const { container } = mount()
    const menu = await openMenu(container, 'rsi-1')
    expect(menu.querySelector('[data-readout-rows]')).toBeNull()
    expect(menu.querySelector('[data-readout-row]')).toBeNull()
    expect(menu.querySelector('[data-legend-lessons]')).toBeNull()
    expect(menu.querySelector('[role="menuitem"]')).not.toBeNull()
    await closeMenu()
  })

  it('⭐ the rail: RSI chips are identical with and without the wiring in every field a surface reads; the reader adds only `readout: []` and `suffix: \'\'`', () => {
    primeFixture()
    const rsi = registry.getDefinition('rsi')
    const plot = (rsi.plots || []).find((p) => p && p.legend && p.legend.hide !== true)
    expect(plot, 'rsi has a legend plot').toBeTruthy()
    const b = { instanceId: 'rsi-1', defId: 'rsi', plotKey: plot.key, series: { __id: 'rsi' }, lastValue: 55.5 }
    const inst = { instanceId: 'rsi-1', defId: 'rsi', inputs: { period: 14 }, hidden: false }
    const scalarsOf = (def, inputs) => scalarsFor(def, inputs, { sym: SYM, tf: TF })
    const bare = legendChips([b], null, registry, [inst])
    const wired = legendChips([b], null, registry, [inst], { scalarsOf })
    expect(bare).toHaveLength(1)
    const withoutReadout = (c) => { const o = { ...c }; delete o.readout; delete o.suffix; return o }
    expect(wired.map(withoutReadout)).toEqual(bare)
    for (const c of wired) { expect(c.readout).toEqual([]); expect(c.suffix).toBe('') }
    for (const c of bare) { expect(c).not.toHaveProperty('readout'); expect(c).not.toHaveProperty('suffix') }
    expect(paneReadoutLabel(wired[0], rsi, null)).toBe(paneReadoutLabel(bare[0], rsi, null))
    // and the fixture, through the same reader, carries its rows — the lookup really is keyed
    const fx = registry.getDefinition(DEF_ID)
    const fb = { instanceId: 'rsf-1', defId: DEF_ID, plotKey: 'rsi', series: { __id: 'rsf' }, lastValue: 51 }
    const fi = { instanceId: 'rsf-1', defId: DEF_ID, inputs: {}, hidden: false }
    const chip = legendChips([fb], null, registry, [fi], { scalarsOf })[0]
    expect(chip.readout.map((r) => r.key)).toEqual(['benchmark', 'rating', 'phase'])
    // a resolved row carries no `card` — the surface joins it by key from `def.readout` (see StockChart)
    expect(chip.readout[0]).toEqual({ key: 'benchmark', label: 'Benchmark', value: 'XLK', text: 'XLK', muted: false })
    expect(chip.label, 'the strip says what was asked for').toBe('RSF(SPY)')
    expect(chip.suffix).toBe(' · XLK')
    expect(paneReadoutLabel(chip, fx, null)).toBe('Readout Fixture · XLK')
    // another timeframe has no landed envelope: no rows, and the requested benchmark stands
    const other = legendChips([fb], null, registry, [fi], { scalarsOf: (d, i) => scalarsFor(d, i, { sym: SYM, tf: 'W' }) })[0]
    expect(other.readout).toEqual([])
    expect(other.suffix).toBe(' · SPY')
  })
})

describe('the wires, read from the source and the stylesheet', () => {
  // vitest runs from `app/`, as every sibling source rail in this directory assumes
  const src = readFileSync(join(process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
  const css = readFileSync(join(process.cwd(), 'src/components/StockChart.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  it('every `legendChips` call in StockChart passes the one reader, bound to scalarsFor over the chart\'s own sym and tf', () => {
    const calls = src.match(/\blegendChips\(/g) || []
    expect(calls).toHaveLength(2)
    // each call ends in the reader (the first argument is `…binder.bindings()`, so the
    // match must cross a paren pair)
    expect(src.match(/\blegendChips\([\s\S]*?readoutChipOpts\)/g) || []).toHaveLength(2)
    expect(src).toContain("scalarsOf: (def, inputs) => scalarsFor(def, inputs, { sym: symRef.current, tf: resolvedTfRef.current })")
    expect(src).toContain("import { scalarsFor } from './chart/engine/serverCompute'")
  })

  it('2b-09: the About card reads its evidence through the SAME reader the rows came from, over the resolved inputs', () => {
    expect(src).toContain("import { cardEvidenceText } from './chart/engine/readoutSchema'")
    expect(src).toContain('readoutChipOpts.scalarsOf(def, resolvedInputsOf(def, (inst && inst.inputs) || {}))')
    expect(src).toContain('<LegendMenuCard row={cardRow} def={def} scalars={cardScalars} onBack=')
    expect(src).toContain('const evidenceText = cardEvidenceText(row, scalars)')
    // the card never reads `card.evidence` directly any more — one resolver, one rule
    expect(src).not.toMatch(/typeof card\.evidence === 'string' && card\.evidence \?/)
  })

  it('`serverColumnsGeneration` joins the off-cursor refresh effect\'s deps, so chips re-derive when the envelope lands', () => {
    expect(src).toContain('}, [effAlwaysShow, chartReady, ohlcData, overlayData, cs.indicatorInstances, serverColumnsGeneration])')
    expect(src).toContain('const serverColumnsGeneration = useServerColumns()')
  })

  it('the Learn link is a react-router <Link> inside a router and never outside one', () => {
    expect(src).toContain("import { Link, useInRouterContext } from 'react-router-dom'")
    expect(src).toMatch(/const routed = useInRouterContext\(\)\s*\n\s*if \(routed\) return <Link to=\{href\}/)
    expect(src).not.toMatch(/target=["']_blank["'][^\n]*data-learn/)
  })

  it('the back row and both link rows declare the 44 px tap floor; Instrument Sans only; gold on the Learn link', () => {
    const rule = (name) => { const m = new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css); expect(m, name).toBeTruthy(); return m[1] }
    expect(rule('legCardBack')).toMatch(/min-height:\s*var\(--tap-min\)/)
    expect(rule('legCardLearn')).toMatch(/min-height:\s*var\(--tap-min\)/)
    // visual round A1: lesson rows are 28 px on desktop and the 44 px floor on touch
    expect(rule('legCardLesson')).toMatch(/min-height:\s*28px/)
    const touch = css.slice(css.indexOf('@media (max-width: 1024px)', css.indexOf('.legPresetPage')))
    expect(touch).toMatch(/\.legCardLesson\s*\{\s*min-height:\s*var\(--tap-min\)/)
    expect(rule('legCardLearn')).toMatch(/color:\s*var\(--ut-gold/)
    const block = css.slice(css.indexOf('.legMenuRows'))
    const fonts = block.match(/font(?:-family)?:[^;]*;/g) || []
    expect(fonts.length).toBeGreaterThan(0)
    for (const f of fonts) if (!/font:\s*inherit/.test(f)) expect(f).toMatch(/Instrument Sans/)
  })
})
