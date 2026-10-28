// Wave 8 (Task 8.14 + fix round 1): the seven chart views of a placed built widget, drawn from params alone.
// Asserted by RENDERED TEXT and by the SVG drawn (sizes in real pixels, shapes, order), never by component state.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Profiler } from 'react'
import { render, screen, within, fireEvent, act } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import BuiltWidgetEmbed from '../BuiltWidgetEmbed'
import BarView, { VALUE_MAX, VALUE_SLACK, valueLines, lineWidth } from './BarView'
import HeatView, { TEXT_MIN_CELL, MAX_CELL, SNAP_SLOP, cellLines } from './HeatView'
import LineView, { nearestIndex, readoutPlace } from './LineView'
import ScatterView from './ScatterView'
import CompareView, { changeText } from './CompareView'
import ProgressView from './ProgressView'
import { widgetEmbedNode } from '../../../../lib/notebookWidgets'
import { fmtValue, countText, compactValue, tableModelOf, quadrantOf, shareText } from './builtModel'
import { W, TAP, textW, FLIP_PX, SETTLE_MS, SEEN_MS, TRAIL_MAX } from './svg'
import NumberView from './NumberView'
import TableAlt from './TableAlt'
import W10 from './__fixtures__/w10Payloads.json'
import { MemoryRouter, useLocation } from 'react-router-dom'
import DrillPanel, { optionHref, drillNoteHref } from './DrillPanel'

const ASOF = '2026-10-24T14:00:00Z'
const M = (label, fmt, unit = 'trades', kind = 'sum') => ({ label, unit, kind, fmt })
const BASE = {
  asOf: ASOF, source: 'manual', sourceKey: 'closed_trades', title: 'My widget', defId: 'd-1', defRev: 1,
  def: { v: 1, source: 'closed_trades', display: { target: 1000 } }, rangeLabel: 'Last 90 days', count: 47,
  sourceDetail: 'Your closed trades in the Journal.', share: false,
}
const MONEY = [M('Net P&L', 'money')]
const RATE = M('Win rate', 'pct', 'decisive', 'rate')
const ROWS = [
  { label: 'Flag', label2: null, v1: 1500, n1: 20, s1: '', n: 20, flagged: false },
  { label: 'Pullback', label2: null, v1: -200, n1: 4, s1: '', n: 4, flagged: false },
  { label: 'VCP', label2: null, v1: null, n1: 0, s1: '', n: 0, flagged: false },
]
const SEVEN = {
  compare: { view: 'compare', measures: MONEY, value: { v1: 1300, n1: 24, s1: '', n: 24 },
    compare: { v1: 800, n1: 20, s1: '', n: 20 }, compareLabel: 'Aug 26 to Sep 24, 2026' },
  bar: { view: 'bar', measures: MONEY, value: { v1: 1300, n1: 24, n: 24 }, rows: ROWS },
  line: { view: 'line', measures: MONEY, value: { v1: 50, n1: 5, n: 5 }, series: [
    { label: '2026-08', v1: 100, n1: 3, s1: '', n: 3 }, { label: '2026-09', v1: null, n1: 0, s1: '', n: 0 },
    { label: '2026-10', v1: -50, n1: 2, s1: '', n: 2 }] },
  scatter: { view: 'scatter', measures: [M('R', 'r'), M('Net P&L', 'money')], value: { v1: 1, n1: 2, n: 2 }, points: [
    { x: 1.5, y: 300, d: '2026-10-02', r: 'win' }, { x: -1, y: -12345.67, d: '2026-10-03', r: 'loss' },
    { x: 0, y: 0, d: '2026-10-05', r: 'be' }, { x: null, y: 40, d: '2026-10-04', r: 'be' }] },
  heat: { view: 'heat', measures: MONEY, value: { v1: 1, n1: 3, n: 3 }, cells: [
    { label: '2026-10-20', v1: 400, n1: 2, s1: '' }, { label: '2026-10-21', v1: -150, n1: 1, s1: '' },
    { label: '2026-10-22', v1: null, n1: 0, s1: '' }] },
  list: { view: 'list', measures: MONEY, value: { v1: 1, n1: 2, n: 2 }, rows: [
    { label: 'AAPL', label2: '2026-10-02', v1: 300, n1: 1, s1: '', n: 1, flagged: false },
    { label: 'TSLA', label2: '2026-10-01', v1: -90, n1: 1, s1: '', n: 1, flagged: true }] },
  progress: { view: 'progress', measures: MONEY, value: { v1: 250, n1: 9, s1: '', n: 9 } },
}
const attrsOf = (p) => widgetEmbedNode('builtWidget', { ...BASE, ...p }).attrs
const P = (p) => ({ ...BASE, ...p })
// CRLF -> LF: `ruleBody` and the 11 px rail match multi-line selectors with `\n`, and a Windows checkout
// (core.autocrlf=true) has CRLF on disk, so an unnormalised read finds no such rule there while CI's LF checkout does.
const CSS = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/widgets/builtViews/builtViews.module.css'), 'utf8')
  .replace(/\r\n/g, '\n')
const ruleBody = (sel) => {
  const m = new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(CSS)
  return m ? m[2] : ''
}
const pxOf = (sel) => Number((/font-size:\s*(\d+)px/.exec(ruleBody(sel)) || [])[1])
/** A year of weekday cells (53 weeks). */
const yearCells = () => {
  const cells = []
  const start = Date.UTC(2025, 9, 27)
  for (let i = 0; i < 365; i += 1) {
    const d = new Date(start + i * 86400000)
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue
    cells.push({ label: d.toISOString().slice(0, 10), v1: i % 3 === 0 ? -10 : 25, n1: 1, s1: '' })
  }
  return cells
}
/** n weeks of weekday cells. */
const weeks = (n) => yearCells().slice(0, n * 5)
/** Make the touch tier match (every matchMedia query answers true, so useIsTouch is true). */
const asTouch = () => vi.stubGlobal('matchMedia', (q) => ({
  matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
}))

let fetchSpy
beforeEach(() => { fetchSpy = vi.fn(); vi.stubGlobal('fetch', fetchSpy) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('built widget views', () => {
  it('renders_from_params_without_fetch (each of the seven new views)', () => {
    const ids = { compare: 'built-compare-view', bar: 'built-bar-view', line: 'built-line-view',
      scatter: 'built-scatter-view', heat: 'built-heat-view', list: 'built-list-view', progress: 'built-progress-view' }
    for (const [view, p] of Object.entries(SEVEN)) {
      const { unmount } = render(<BuiltWidgetEmbed attrs={attrsOf(p)} editable onUpdateParams={() => true} />)
      expect(screen.getByTestId(ids[view]), view).toBeInTheDocument()
      expect(screen.queryByTestId('built-table-view'), view).toBeNull()        // no table fallback any more
      unmount()
    }
    expect(fetchSpy).toHaveBeenCalledTimes(0)
  })

  it('each view draws its own numbers', () => {
    const one = (view) => render(<BuiltWidgetEmbed attrs={attrsOf(SEVEN[view])} />)
    let r = one('compare')
    expect(screen.getByText('+$1,300.00')).toBeInTheDocument()
    expect(screen.getByText('vs Aug 26 to Sep 24, 2026')).toBeInTheDocument()
    expect(screen.getByText('+$800.00')).toBeInTheDocument()
    expect(screen.getByText('Change +$500.00')).toBeInTheDocument()
    r.unmount()
    r = one('bar')
    const bar = screen.getByTestId('built-bar-view')
    expect(within(bar).getByText('Flag')).toBeInTheDocument()
    expect(within(bar).getByText('+$1,500.00')).toBeInTheDocument()
    expect(bar.querySelectorAll('rect[class*="barNeg"]').length).toBe(1)    // the loss grows left, in its colour
    r.unmount()
    r = one('line')
    const line = screen.getByTestId('built-line-view')
    expect(line.querySelectorAll('polyline').length).toBe(2)                 // the unknown month BREAKS the line
    expect(screen.getByText('No data for 2026-09.')).toBeInTheDocument()
    r.unmount()
    r = one('scatter')
    expect(screen.getByTestId('built-scatter-view').querySelectorAll('[data-result]').length).toBe(3)
    expect(screen.getByText(/1 trade has no data for one of the two values and is not plotted/)).toBeInTheDocument()
    r.unmount()
    r = one('list')
    const list = screen.getByTestId('built-list-view')
    expect(within(within(list).getByText('TSLA').closest('li')).getByText('Flagged')).toBeInTheDocument()
    expect(within(list).getByText('-$90.00')).toBeInTheDocument()
    r.unmount()
    r = one('progress')
    expect(screen.getByText('+$250.00')).toBeInTheDocument()
    expect(screen.getByText('of +$1,000.00')).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
    r.unmount()
  })

  // ── R-31: real pixels ─────────────────────────────────────────────────────────────────────────────────────

  it('R-31: with nothing to measure (jsdom) a chart is laid out at W, in real pixels (viewBox width = width)', () => {
    for (const [V, p, id] of [[BarView, SEVEN.bar, 'built-bar-view'], [LineView, SEVEN.line, 'built-line-view'],
      [ScatterView, SEVEN.scatter, 'built-scatter-view']]) {
      const { unmount } = render(<V params={P(p)} />)
      const svg = screen.getByTestId(id)
      expect(svg.getAttribute('width'), id).toBe(String(W))
      expect(svg.getAttribute('viewBox').split(' ')[2], id).toBe(String(W))   // scale 1: 12 px text is 12 px
      unmount()
    }
  })

  it('R-31: the MEASURED width is the layout width, read from clientWidth and then the observer\'s contentRect', () => {
    // a rect that disagrees, to prove the rect is NOT what is read (it can be transformed; the content box is not)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 999, height: 200, left: 0, top: 0 })
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(340)
    let fire = null
    vi.stubGlobal('ResizeObserver', class { constructor(cb) { fire = cb } observe() {} disconnect() {} })
    render(<BarView params={P(SEVEN.bar)} />)
    const svg = screen.getByTestId('built-bar-view')
    expect(svg.getAttribute('width')).toBe('340')
    expect(svg.getAttribute('viewBox').split(' ')[2]).toBe('340')
    cw.mockRestore()
    act(() => fire([{ contentRect: { width: 420 } }]))                          // it keeps watching the box
    expect(screen.getByTestId('built-bar-view').getAttribute('width')).toBe('420')
  })

  it('H14: a scrollbar flip (two widths 16 px apart, alternating) settles in 3 renders or fewer', () => {
    let fire = null
    vi.stubGlobal('ResizeObserver', class { constructor(cb) { fire = cb } observe() {} disconnect() {} })
    let commits = 0
    render(<Profiler id="heat" onRender={() => { commits += 1 }}>
      <HeatView params={P({ view: 'heat', measures: MONEY, value: {}, cells: yearCells() })} />
    </Profiler>)
    const before = commits
    for (let i = 0; i < 12; i += 1) act(() => fire([{ contentRect: { width: i % 2 ? 584 : 600 } }]))
    expect(16).toBeLessThanOrEqual(FLIP_PX)
    expect(commits - before).toBeLessThanOrEqual(3)
    // control: a real resize (more than FLIP_PX) is still followed
    const settled = commits
    act(() => fire([{ contentRect: { width: 400 } }]))
    expect(commits).toBeGreaterThan(settled)
    // the heat map's own (horizontal) scroller reserves no gutter: it changes height, never the width it is laid out at
    expect(/scrollbar-gutter/.test(ruleBody('.chartBox'))).toBe(false)
  })

  // ── I-1: the hysteresis keeps the narrower width, forgets after 1 s, and re-reads once the storm stops ──────
  const flipRig = () => {
    let fire = null
    vi.stubGlobal('ResizeObserver', class { constructor(cb) { fire = cb } observe() {} disconnect() {} })
    let real = 0
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => real)
    const r = render(<BarView params={P(SEVEN.bar)} />)
    const at = () => Number(screen.getByTestId('built-bar-view').getAttribute('width'))
    const ev = (w) => act(() => fire([{ contentRect: { width: w } }]))
    return { r, at, ev, setReal: (w) => { real = w }, cw }
  }

  it('H14: a loop the gutter did not remove stops re-measuring after TRAIL_MAX trailing reads', () => {
    // Every trailing read finds the box wide again (the scrollbar went), the wide chart brings it back, and so on.
    vi.useFakeTimers()
    try {
      const { at, ev, setReal } = flipRig()
      setReal(600)
      ev(600)
      const widths = []
      for (let i = 0; i < 20; i += 1) {
        ev(583)                                                     // the scrollbar appears: narrower wins
        ev(600)                                                     // it goes again: an ignored widen
        act(() => { vi.advanceTimersByTime(SEEN_MS + SETTLE_MS) })   // the trailing read (until the cap)
        widths.push(at())
      }
      expect(widths.filter((w) => w === 600).length).toBeLessThanOrEqual(TRAIL_MAX)
      expect(widths.slice(-5)).toEqual([583, 583, 583, 583, 583])
      // a small REAL change (not a flip) resets the pairs: the old pair may re-measure again
      ev(590)
      expect(at()).toBe(590)
      ev(583)
      expect(at()).toBe(583)
      ev(600)                                                       // a widen in the old pair, after the reset
      act(() => { vi.advanceTimersByTime(SEEN_MS + SETTLE_MS) })
      expect(at()).toBe(600)                                        // the trailing read landed again
      // control: a real change outside the pair resets it, so a later drag still lands on the box's width
      setReal(420)
      ev(420)
      expect(at()).toBe(420)
    } finally { vi.useRealTimers() }
  })

  it('the 583 \u2192 600 \u2192 583 scrollbar sequence ends at 583 (the narrower width fits either way)', () => {
    // Discriminating: 600 is NEW when it arrives (taken), so the last 583 is a flip back to a width seen; only a
    // rule where the narrower width wins ends at 583. A rule that ignores every flip-back ends at 600.
    vi.useFakeTimers()
    try {
      const { at, ev, setReal } = flipRig()
      ev(583)
      expect(at()).toBe(583)
      ev(600)
      expect(at()).toBe(600)
      ev(583)
      expect(at()).toBe(583)
      setReal(583)
      act(() => { vi.advanceTimersByTime(SEEN_MS + SETTLE_MS) })
      expect(at()).toBe(583)
    } finally { vi.useRealTimers() }
  })

  it('after a flip storm stops, the width is the box\u2019s REAL clientWidth (one trailing read)', () => {
    vi.useFakeTimers()
    try {
      const { at, ev, setReal } = flipRig()
      for (let i = 0; i < 9; i += 1) ev(i % 2 ? 584 : 600)                 // ends on 600: a widen, ignored
      expect(at()).toBe(584)
      setReal(600)                                                           // the scrollbar went for good
      act(() => { vi.advanceTimersByTime(SETTLE_MS - 50) })
      expect(at()).toBe(584)                                                 // not before the window closes
      act(() => { vi.advanceTimersByTime(100) })
      expect(at()).toBe(600)
      // at most one trailing read per pair per SEEN_MS: the same pair flipping again waits for that window
      ev(584); ev(600)
      setReal(600)
      act(() => { vi.advanceTimersByTime(SETTLE_MS + 100) })
      expect(at()).toBe(584)                                                 // 950 ms after the first read
      act(() => { vi.advanceTimersByTime(SEEN_MS) })
      expect(at()).toBe(600)                                                 // the window opened: the truth
    } finally { vi.useRealTimers() }
  })

  it('a real drag (narrow, widen, narrow, widen inside 1 s) always ends at the box\u2019s clientWidth', () => {
    vi.useFakeTimers()
    try {
      const { at, ev, setReal, cw } = flipRig()
      ev(600); ev(584); ev(600)                                              // t=0: the widen is ignored
      setReal(600)
      act(() => { vi.advanceTimersByTime(SETTLE_MS + 50) })                  // t=450: the trailing read
      expect(at()).toBe(600)
      act(() => { vi.advanceTimersByTime(50) })                              // t=500, still inside 1 s
      ev(584)                                                                // narrow: taken
      expect(at()).toBe(584)
      ev(600)                                                                // widen in the SPENT pair: ignored...
      expect(at()).toBe(584)
      const reads = cw.mock.calls.length
      act(() => { vi.advanceTimersByTime(SEEN_MS * 3) })
      expect(at()).toBe(600)                                                 // ...but the box is read again
      expect(cw.mock.calls.length - reads).toBe(1)                           // once, not a storm
    } finally { vi.useRealTimers() }
  })

  it('a width seen more than 1 s ago is not a flip: the widen is taken', () => {
    vi.useFakeTimers()
    try {
      const { at, ev } = flipRig()
      ev(600); ev(584)
      act(() => { vi.advanceTimersByTime(SEEN_MS + 50) })
      ev(600)
      expect(at()).toBe(600)
    } finally { vi.useRealTimers() }
  })

  it('a view that mounts EMPTY and later gets rows still measures its box (a callback ref)', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(340)
    const r = render(<LineView params={P({ ...SEVEN.line, series: [] })} />)
    expect(screen.queryByTestId('built-line-view')).toBeNull()
    r.rerender(<LineView params={P(SEVEN.line)} />)
    expect(screen.getByTestId('built-line-view').getAttribute('width')).toBe('340')
  })

  it('R-31: an injected narrow width (340) keeps text at its CSS size and labels inside their column', () => {
    const long = { ...SEVEN.bar, rows: [{ label: 'A very long setup name that will not fit at all', v1: 10, n1: 1, s1: '', n: 1 }] }
    render(<BarView params={P(long)} width={340} />)
    const svg = screen.getByTestId('built-bar-view')
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 340 /)
    const label = svg.querySelector('text[class*="label"]')
    expect(label.textContent.endsWith('…')).toBe(true)
    // the clipped label fits the space left of its anchor at 12 px
    expect(textW(label.textContent, 12)).toBeLessThanOrEqual(Number(label.getAttribute('x')))
    // the floors the CSS sets, at every width (a viewBox at scale 1 renders them as written)
    expect(pxOf('.tick')).toBeGreaterThanOrEqual(11)
    expect(pxOf('.tick')).toBeLessThanOrEqual(12)
    expect(/font-size:\s*12px/.test(ruleBody('.label,\n.value,\n.valueDim,\n.tick'))).toBe(true)
    expect(pxOf('.heatText')).toBeGreaterThanOrEqual(10)
  })

  // ── heat map ─────────────────────────────────────────────────────────────────────────────────────────────

  it('heat: a short range is a small map, not stretched past its natural grid, and cells stay at 56 px or less', () => {
    render(<HeatView params={P(SEVEN.heat)} width={1200} />)
    const svg = screen.getByTestId('built-heat-view')
    const cell = Number(svg.getAttribute('data-cell-size'))
    expect(cell).toBe(MAX_CELL)
    expect(Number(svg.getAttribute('width'))).toBeLessThan(300)                // one week, not 1200 px of colour
    expect(svg.getAttribute('width')).not.toBe('100%')
    expect(Number(svg.querySelector('[data-heat-value="pos"] rect').getAttribute('width'))).toBe(MAX_CELL)
  })

  it('heat: the 32 px text rule is decided on the RENDERED cell size', () => {
    const p = P({ view: 'heat', measures: MONEY, value: { v1: 1, n1: 1, n: 1 }, cells: weeks(20) })
    const narrow = render(<HeatView params={p} width={340} />)
    let svg = narrow.getByTestId('built-heat-view')
    expect(Number(svg.getAttribute('data-cell-size'))).toBeLessThan(TEXT_MIN_CELL)
    expect(svg.querySelector('[data-heat-value="pos"] text').textContent).toBe('+')
    expect(svg.querySelector('[data-heat-value="neg"] text').textContent).toBe('\u2212')
    narrow.unmount()
    const wide = render(<HeatView params={p} width={1400} />)
    svg = wide.getByTestId('built-heat-view')
    expect(Number(svg.getAttribute('data-cell-size'))).toBeGreaterThanOrEqual(TEXT_MIN_CELL)
    expect(svg.querySelector('[data-heat-value="pos"] text').textContent).toBe('+25')
  })

  it('heat: a year scrolls at the 14 px floor rather than shrinking text below 10 px', () => {
    render(<HeatView params={P({ view: 'heat', measures: MONEY, value: { v1: 1, n1: 1, n: 1 }, cells: yearCells() })} width={340} />)
    const svg = screen.getByTestId('built-heat-view')
    expect(Number(svg.getAttribute('data-cell-size'))).toBe(14)
    expect(Number(svg.getAttribute('width'))).toBeGreaterThan(340)            // the box scrolls (chartBox overflow-x)
    expect(/overflow-x:\s*auto/.test(ruleBody('.chartBox'))).toBe(true)
  })

  it('heat_cell_has_text_label_and_pattern_for_negative, its text on an opaque backing above the hatch', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf(SEVEN.heat)} />)
    const heat = screen.getByTestId('built-heat-view')
    const pattern = heat.querySelector('pattern')
    expect(pattern).not.toBeNull()
    const neg = heat.querySelector('[data-heat-value="neg"]')
    const pos = heat.querySelector('[data-heat-value="pos"]')
    expect(neg.querySelector('text').textContent).toBe('-150')
    expect(pos.querySelector('text').textContent).toBe('+400')
    const kids = [...neg.children]
    const hatchAt = kids.findIndex((k) => k.getAttribute('fill') === `url(#${pattern.id})`)
    const backAt = kids.findIndex((k) => k.hasAttribute('data-heat-back'))
    const textAt = kids.findIndex((k) => k.tagName.toLowerCase() === 'text')
    expect(hatchAt).toBeGreaterThan(-1)
    expect(backAt).toBeGreaterThan(hatchAt)                                    // the backing covers the hatch...
    expect(textAt).toBeGreaterThan(backAt)                                     // ...and the text sits on the backing
    expect([...pos.querySelectorAll('rect')].some((r) => (r.getAttribute('fill') || '').startsWith('url('))).toBe(false)
    expect(neg.getAttribute('aria-label')).toBe('2026-10-21: -$150.00')
    // contrast: the backing is the page surface and the text the page ink (both themed tokens), never the fill
    expect(/fill:\s*var\(--bg-surface\)/.test(ruleBody('.heatTextBack'))).toBe(true)
    expect(/fill:\s*var\(--text-bright\)/.test(ruleBody('.heatText'))).toBe(true)
    // every cell has a ring for focus and hover, drawn last
    for (const g of heat.querySelectorAll('[data-heat-value]')) {
      expect(g.lastElementChild.hasAttribute('data-ring')).toBe(true)
    }
  })

  it('heat: a hidden cell says Not enough (with its count), an unknown one no data; aria says by day or by month', () => {
    const cells = [{ label: '2026-10-20', v1: null, n1: 3, s1: 'hide' }, { label: '2026-10-21', v1: null, n1: 0, s1: '' }]
    const r = render(<HeatView params={P({ view: 'heat', measures: [RATE], value: { v1: 1, n1: 1, n: 1 }, cells })} width={600} />)
    const svg = r.getByTestId('built-heat-view')
    expect(svg.getAttribute('aria-label')).toBe('Win rate by day')
    const hidden = svg.querySelector('[data-heat-value="hidden"] text')
    expect([...hidden.querySelectorAll('tspan')].map((t) => t.textContent)).toEqual(['Not', 'enough', '(3)'])
    expect(svg.textContent).not.toContain('n/a')
    expect([...svg.querySelector('[data-heat-value="none"] text').querySelectorAll('tspan')].map((t) => t.textContent))
      .toEqual(['no', 'data'])
    r.unmount()
    render(<HeatView params={P({ view: 'heat', measures: MONEY, value: { v1: 1, n1: 1, n: 1 },
      cells: [{ label: '2026-09', v1: 5, n1: 1, s1: '' }, { label: '2026-10', v1: -5, n1: 1, s1: '' }] })} />)
    expect(screen.getByTestId('built-heat-view').getAttribute('aria-label')).toBe('Net P&L by month')
  })

  it('heat with more than one measure shades the first, says so, and Show as table keeps them all', () => {
    const cells = [{ label: '2026-10-20', v1: 400, n1: 2, s1: '', v2: 0.5, n2: 2, s2: '' }]
    render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'heat', measures: [MONEY[0], RATE], value: { v1: 1, n1: 1, n: 1 }, cells })} />)
    expect(screen.getByTestId('built-heat-showing').textContent).toBe('Showing Net P&L. Show as table for the rest.')
    fireEvent.click(screen.getByRole('button', { name: 'Show as table' }))
    const alt = screen.getByTestId('built-table-alt')
    expect([...alt.querySelectorAll('thead th')].map((t) => t.textContent)).toEqual(['Period', 'Net P&L', 'Win rate', 'Win rate (n)'])
    expect([...alt.querySelectorAll('tbody td')].map((t) => t.textContent)).toEqual(['2026-10-20', '+$400.00', '50.0%', '2 decisive trades'])
  })

  // ── scatter, line, small samples, counts, extra measures ────────────────────────────────────────────────

  it('scatter tells the result by SHAPE (filled, ring, dash), and the legend draws the shapes', () => {
    render(<ScatterView params={P(SEVEN.scatter)} />)
    const svg = screen.getByTestId('built-scatter-view')
    expect(svg.querySelector('[data-result="win"] [data-shape]').getAttribute('data-shape')).toBe('dot')
    expect(svg.querySelector('[data-result="loss"] [data-shape]').getAttribute('data-shape')).toBe('ring')
    expect(svg.querySelector('[data-result="be"] [data-shape]').getAttribute('data-shape')).toBe('dash')
    expect(/fill:\s*none/.test(ruleBody('.ring'))).toBe(true)                  // hollow
    const legend = screen.getByTestId('built-scatter-legend')
    expect([...legend.querySelectorAll('[data-shape]')].map((n) => n.getAttribute('data-shape'))).toEqual(['dot', 'ring', 'dash'])
    expect(legend.textContent).toBe('WinLossBreakeven')
  })

  it('scatter leaves room on the left for its widest money tick', () => {
    render(<ScatterView params={P(SEVEN.scatter)} />)
    const svg = screen.getByTestId('built-scatter-view')
    const min = svg.querySelector('[data-axis="min"]')
    expect(min.textContent).toBe('-$12,345.67')
    // a right-anchored tick ending at x needs x >= its width
    expect(Number(min.getAttribute('x'))).toBeGreaterThanOrEqual(textW(min.textContent, 11))
  })

  it('line: points carry a tooltip and every value in their name, and the y axis shows its min and max', () => {
    render(<LineView params={P(SEVEN.line)} />)
    const svg = screen.getByTestId('built-line-view')
    expect(svg.querySelector('[data-axis="max"]').textContent).toBe('+$100.00')
    expect(svg.querySelector('[data-axis="min"]').textContent).toBe('-$50.00')
    const marks = svg.querySelectorAll('g[aria-label]')
    expect(marks[0].getAttribute('aria-label')).toBe('2026-08: +$100.00')
    expect(marks[0].querySelector('title').textContent).toBe('2026-08: +$100.00')
  })

  it('small_badge_under_20, visible in Line and Heat too (not only in aria)', () => {
    const rows = [{ label: 'Flag', v1: 0.6, n1: 12, s1: 'small', n: 12 }]
    const r = render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'bar', measures: [RATE], value: { v1: 0.6, n1: 12, s1: 'small', n: 12 }, rows })} />)
    const bar = screen.getByTestId('built-bar-view')
    expect(within(bar).getByText('60.0%')).toBeInTheDocument()
    expect(within(bar).getByText('small sample')).toBeInTheDocument()
    r.unmount()
    const l = render(<LineView params={P({ view: 'line', measures: [RATE], value: {}, series: [
      { label: '2026-09', v1: 0.6, n1: 12, s1: 'small' }, { label: '2026-10', v1: 0.5, n1: 30, s1: '' }] })} />)
    const smallLine = l.getByTestId('built-line-small')
    expect(within(smallLine).getByText('small sample')).toBeInTheDocument()
    expect(smallLine.textContent).toContain('2026-09')
    expect(smallLine.textContent).not.toContain('2026-10')
    expect(l.getByTestId('built-line-view').querySelectorAll('circle[data-small]').length).toBe(1)
    l.unmount()
    const h = render(<HeatView params={P({ view: 'heat', measures: [RATE], value: {}, cells: [
      { label: '2026-10-20', v1: 0.6, n1: 12, s1: 'small' }, { label: '2026-10-21', v1: 0.5, n1: 30, s1: '' }] })} />)
    expect(within(h.getByTestId('built-heat-small')).getByText('small sample')).toBeInTheDocument()
    expect(h.getByTestId('built-heat-small').textContent).toContain('2026-10-20')
    expect(h.getByTestId('built-heat-view').querySelectorAll('[data-small]').length).toBe(1)
    h.unmount()
    render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'compare', measures: [RATE], value: { v1: 0.6, n1: 12, s1: 'small', n: 12 }, compare: null })} />)
    expect(screen.getByText('small sample')).toBeInTheDocument()
    expect(screen.getByText('from 12 decisive trades')).toBeInTheDocument()
  })

  it('per-row counts for an average or rate: in the bar tooltip and name, the table N column, line and heat names', () => {
    const rows = [{ label: 'Flag', v1: 0.6, n1: 12, s1: 'small', n: 12 }, { label: 'VCP', v1: 0.4, n1: 25, s1: '', n: 25 }]
    const r = render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'bar', measures: [RATE, MONEY[0]], value: {},
      rows: rows.map((x) => ({ ...x, v2: 10, n2: x.n1, s2: '' })) })} />)
    const flag = r.getByTestId('built-bar-view').querySelector('g[aria-label^="Flag"]')
    expect(flag.getAttribute('aria-label')).toBe('Flag: Win rate 60.0%, small sample, from 12 decisive trades; Net P&L +$10.00')
    expect(flag.querySelector('title').textContent).toBe(flag.getAttribute('aria-label'))
    fireEvent.click(r.getByRole('button', { name: 'Show as table' }))
    const alt = r.getByTestId('built-table-alt')
    expect([...alt.querySelectorAll('thead th')].map((t) => t.textContent)).toEqual(['Group', 'Win rate', 'Win rate (n)', 'Net P&L'])
    expect([...alt.querySelectorAll('tbody tr')][1].textContent).toContain('25 decisive trades')
    r.unmount()
    // a day unit counts days
    const d = render(<LineView params={P({ view: 'line', measures: [M('Average day', 'money', 'days', 'average')], value: {},
      series: [{ label: '2026-10', v1: 50, n1: 9, s1: '' }] })} />)
    expect(d.getByTestId('built-line-view').querySelector('g[aria-label]').getAttribute('aria-label'))
      .toBe('2026-10: +$50.00, from 9 days')
    d.unmount()
    render(<HeatView params={P({ view: 'heat', measures: [RATE], value: {}, cells: [{ label: '2026-10-20', v1: 0.5, n1: 30, s1: '' }] })} />)
    expect(screen.getByTestId('built-heat-view').querySelector('[data-heat-value]').getAttribute('aria-label'))
      .toBe('2026-10-20: 50.0%, from 30 decisive trades')
  })

  it('bar draws up to three measures as grouped bars with a legend', () => {
    const rows = [{ label: 'Flag', v1: 100, n1: 2, s1: '', v2: 0.5, n2: 2, s2: '', v3: -1, n3: 2, s3: '' }]
    render(<BarView params={P({ view: 'bar', measures: [MONEY[0], RATE, M('Total R', 'r')], value: {}, rows })} />)
    const svg = screen.getByTestId('built-bar-view')
    expect([1, 2, 3].map((k) => svg.querySelectorAll(`rect[data-measure="${k}"]`).length)).toEqual([1, 1, 1])
    expect(screen.getByTestId('built-bar-legend').textContent)
      .toBe('Bars top to bottom: 1 Net P&L · 2 Win rate · 3 Total R. Each measure is on its own scale.')
    expect(within(svg).getByText('-1.0R')).toBeInTheDocument()
    // the measure's number is dimmed again (a tick tspan), not part of the value's own text
    const prefix = within(svg).getByText('-1.0R').querySelector('[data-prefix]')
    expect(prefix.textContent).toBe('3 ')
    expect(prefix.getAttribute('class')).toMatch(/tick/)
  })

  it('line draws up to three series with distinct dash patterns and a legend (never colour alone)', () => {
    const series = [{ label: '2026-09', v1: 1, n1: 1, s1: '', v2: 2, n2: 1, s2: '' }, { label: '2026-10', v1: 3, n1: 1, s1: '', v2: 1, n2: 1, s2: '' }]
    render(<LineView params={P({ view: 'line', measures: [MONEY[0], M('Total R', 'r')], value: {}, series })} />)
    const lines = [...screen.getByTestId('built-line-view').querySelectorAll('polyline')]
    const dashes = new Set(lines.map((l) => l.getAttribute('stroke-dasharray') || 'solid'))
    expect(dashes.size).toBe(2)
    const legend = screen.getByTestId('built-line-legend')
    expect(legend.textContent).toContain('Net P&L')
    expect(legend.textContent).toContain('Total R')
    expect(new Set([...legend.querySelectorAll('line')].map((l) => l.getAttribute('stroke-dasharray') || 'solid')).size).toBe(2)
  })

  // ── touch targets ───────────────────────────────────────────────────────────────────────────────────────

  it('on touch every SVG hit area is 44 px or more (bar rows, line bands, scatter points, heat cells)', () => {
    asTouch()
    const b = render(<BarView params={P(SEVEN.bar)} onDrill={() => {}} />)
    for (const h of b.getByTestId('built-bar-view').querySelectorAll('[data-hit]')) expect(Number(h.getAttribute('height'))).toBeGreaterThanOrEqual(TAP)
    b.unmount()
    const l = render(<LineView params={P({ ...SEVEN.line, series: Array.from({ length: 40 }, (_, i) => ({ label: `d${i}`, v1: i, n1: 1, s1: '' })) })} onDrill={() => {}} width={340} />)
    for (const h of l.getByTestId('built-line-view').querySelectorAll('[data-hit]')) expect(Number(h.getAttribute('width'))).toBeGreaterThanOrEqual(TAP)
    l.unmount()
    const sc = render(<ScatterView params={P(SEVEN.scatter)} onDrill={() => {}} />)
    for (const h of sc.getByTestId('built-scatter-view').querySelectorAll('[data-hit]')) expect(Number(h.getAttribute('r')) * 2).toBeGreaterThanOrEqual(TAP)
    sc.unmount()
    const hm = render(<HeatView params={P({ view: 'heat', measures: MONEY, value: {}, cells: yearCells() })} onDrill={() => {}} width={340} />)
    expect(Number(hm.getByTestId('built-heat-view').getAttribute('data-cell-size'))).toBeGreaterThanOrEqual(TAP)
  })

  it('a drillable table row is 44 px tall on touch: its cells carry the height (a row ignores min-height)', () => {
    const touch = /@media \(max-width: 1024px\) \{([\s\S]*)\}\s*$/.exec(CSS)?.[1] || ''
    expect(/\.drillRow > td\s*\{\s*height:\s*var\(--tap-min\);/.test(touch)).toBe(true)
    // and the list rows and figures keep their min-height floor there
    expect(/\.listRow,[\s\S]*\.metricBody,[\s\S]*min-height:\s*var\(--tap-min\)/.test(touch)).toBe(true)
  })

  // ── compare, progress, cells ────────────────────────────────────────────────────────────────────────────

  it('compare: no change against a capped profit factor; a rate changes in points; bars keep their thickness', () => {
    expect(changeText(5, 3, 'pf')).toBe('')
    expect(changeText(4, 5, 'pf')).toBe('')
    expect(changeText(2.5, 2, 'pf')).toBe('+0.50')
    expect(changeText(0.55, 0.5, 'pct')).toBe('+5.0 pts')
    expect(changeText(0.45, 0.5, 'pct')).toBe('-5.0 pts')
    render(<CompareView params={P({ view: 'compare', measures: [M('Profit factor', 'pf', 'trades', 'rate')],
      value: { v1: 5, n1: 30, s1: '', n: 30 }, compare: { v1: 2, n1: 30, s1: '', n: 30 }, compareLabel: 'Sep' })} />)
    expect(screen.getByText('5+')).toBeInTheDocument()
    expect(screen.queryByText(/^Change/)).toBeNull()
    const bars = screen.getByTestId('built-compare-view').querySelector('svg')
    expect(bars.getAttribute('height')).toBe('24')
    expect(bars.getAttribute('preserveAspectRatio')).toBe('none')
  })

  it('R-32: while shared, Progress shows a percentage of target and never the target number', () => {
    const p = P({ view: 'progress', share: true, def: { display: { target: 987654 } }, measures: MONEY,
      value: { v1: 493827, n1: 9, s1: '', n: 9 } })
    const r = render(<ProgressView params={p} />)
    expect(r.container.innerHTML).not.toMatch(/987,?654/)
    expect(screen.getByText('50% of target')).toBeInTheDocument()
    r.unmount()
    // control: private, the member sees their own target
    render(<ProgressView params={{ ...p, share: false }} />)
    expect(screen.getByText('of +$987,654.00')).toBeInTheDocument()
  })

  it('hide_cell_shows_not_enough_with_count (trades, and days for a day unit)', () => {
    const rows = [{ label: 'Flag', v1: null, n1: 3, s1: 'hide', n: 3 }, { label: 'VCP', v1: 5, n1: 30, s1: '', n: 30 }]
    const r = render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'bar', measures: [RATE], value: { v1: 0.5, n1: 33, n: 33 }, rows })} />)
    expect(screen.getByText('Not enough trades yet (3)')).toBeInTheDocument()
    expect(screen.getByTestId('built-bar-view').querySelectorAll('rect[class*="bar"]').length).toBe(1)  // no bar for it
    r.unmount()
    render(<BuiltWidgetEmbed attrs={attrsOf({ sourceKey: 'trading_days', view: 'number',
      measures: [M('Average day', 'money', 'days', 'average')], value: { v1: null, n1: 2, s1: 'hide', n: 2 } })} />)
    expect(screen.getByText('Not enough days yet (2)')).toBeInTheDocument()
  })

  it('coverage_sentence_and_add_stops_link', () => {
    const coverage = [{ have: 9, total: 47, hint: 'Add stops to see R for more trades' }]
    const r = render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'number', measures: [M('Expectancy (R)', 'r', 'trades', 'average')],
      value: { v1: 0.4, n1: 9, s1: 'small', n: 47 }, coverage })} />)
    expect(screen.getByText(/from 9 of 47 trades \(38 have no stop\)/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add stops to see R for more trades' })).toHaveAttribute('href', '/journal/trades?seg=closed')
    r.unmount()
    render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'bar', measures: [M('Expectancy (R)', 'r', 'trades', 'average')],
      value: { v1: 0.4, n1: 9, n: 47 }, coverage, rows: [{ label: 'Flag', v1: 0.4, n1: 9, s1: '', n: 20 }] })} />)
    const note = screen.getByTestId('built-coverage')
    expect(note.textContent).toContain('Expectancy (R): from 9 of 47 trades (38 have no stop)')
    expect(within(note).getByRole('link', { name: 'Add stops to see R for more trades' })).toBeInTheDocument()
    expect(countText({ n1: 47 }, 1, M('Net P&L', 'money'), [{ have: 47, total: 47, hint: null }]))
      .toEqual({ text: 'from 47 trades', hint: null })
  })

  it('pf_cap_shows_5_plus', () => {
    render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'bar', measures: [M('Profit factor', 'pf', 'trades', 'rate')],
      value: { v1: 5, n1: 30, n: 30 }, rows: [{ label: 'Flag', v1: 5, n1: 25, s1: '', n: 25 },
        { label: 'VCP', v1: 1.4, n1: 25, s1: '', n: 25 }] })} />)
    const bar = screen.getByTestId('built-bar-view')
    expect(within(bar).getByText('5+')).toBeInTheDocument()
    expect(within(bar).getByText('1.40')).toBeInTheDocument()
    expect(fmtValue(5, 'pf')).toBe('5+')
    expect(fmtValue(4.99, 'pf')).toBe('4.99')
    expect(fmtValue(5, 'ratio')).toBe('5.00')
    expect(compactValue(5, 'pf')).toBe('5+')
  })

  it('compactValue never says +0 for a value that is not zero', () => {
    expect(compactValue(0.3, 'money')).toBe('+0.30')
    expect(compactValue(-0.04, 'money')).toBe('-0.04')
    expect(compactValue(0.6, 'money')).toBe('+1')
    expect(compactValue(0.02, 'r')).toBe('+0.02R')
    expect(compactValue(0, 'money')).toBe('0')
    for (const v of [0.001, 0.2, 0.49, -0.3]) expect(compactValue(v, 'money')).not.toMatch(/^[+-]?0$/)
  })

  it('nan_shows_no_data_never_zero', () => {
    const r = render(<BuiltWidgetEmbed attrs={attrsOf(SEVEN.bar)} />)
    const bar = screen.getByTestId('built-bar-view')
    expect(within(within(bar).getByText('VCP').closest('g')).getByText('no data')).toBeInTheDocument()
    expect(bar.textContent).not.toContain('$0.00')
    r.unmount()
    const r2 = render(<BuiltWidgetEmbed attrs={attrsOf({ view: 'compare', measures: MONEY,
      value: { v1: NaN, n1: 0, n: 0 }, compare: { v1: Infinity, n1: 0, n: 0 } })} />)
    expect(screen.getAllByText('no data').length).toBe(2)
    expect(r2.container.textContent).not.toContain('$0.00')
    expect(screen.queryByText(/Change/)).toBeNull()
    r2.unmount()
    render(<BuiltWidgetEmbed attrs={attrsOf(SEVEN.heat)} />)
    const unknown = screen.getByTestId('built-heat-view').querySelector('[data-heat-value="none"]')
    expect(unknown.getAttribute('aria-label')).toBe('2026-10-22: no data')
  })

  it('bar: "Flagged" sits on its own line under the label, never running into the bars', () => {
    render(<BarView params={P({ ...SEVEN.bar, rows: [{ ...ROWS[0], flagged: true }] })} />)
    const svg = screen.getByTestId('built-bar-view')
    const label = svg.querySelector('text[class*="label"]')
    const flagged = within(svg).getByText('Flagged')
    expect(flagged.tagName.toLowerCase()).toBe('text')
    expect(flagged.getAttribute('x')).toBe(label.getAttribute('x'))           // the label column's right edge
    expect(Number(flagged.getAttribute('y'))).toBeGreaterThan(Number(label.getAttribute('y')))
  })

  it('W10.7 walk fix: a SHARED view draws the labels it is given (the server numbers them); the drill asks by them', () => {
    // No client relabel table any more: a public page hands this view the server's reduced params ("Account 1"),
    // and the member's own page hands it their own names, shared or not.
    const CANARY = 'CANARY-ACCT-Roth'
    const bar = { view: 'bar', labelKind: 'account', measures: MONEY, value: { v1: 1, n1: 2, n: 2 }, rows: [
      { label: CANARY, v1: 10, n1: 1, s1: '', n: 1 }, { label: 'Main', v1: 20, n1: 1, s1: '', n: 1 }] }
    const heat = { view: 'heat', labelKind: 'account', measures: MONEY, value: { v1: 1, n1: 2, n: 2 }, cells: [
      { label: CANARY, v1: 10, n1: 1, s1: '' }, { label: 'Main', v1: -20, n1: 1, s1: '' }] }
    for (const p of [bar, heat]) {
      const shared = render(<BuiltWidgetEmbed attrs={attrsOf({ ...p, share: true })} />)
      expect(shared.container.innerHTML, p.view).toContain(CANARY)
      expect(shared.container.textContent, p.view).not.toContain('Account 1')
      shared.unmount()
    }
    const model = tableModelOf({ ...BASE, ...bar, share: true })
    expect(model.rows.map((r) => r.label)).toEqual([CANARY, 'Main'])
    expect(model.rows.map((r) => r.drill)).toEqual([{ label: CANARY }, { label: 'Main' }])
  })
  // ── fix round 2 ─────────────────────────────────────────────────────────────────────────────────────────

  it('line is FITTED to its width at any length (never scrolls) and a tap anywhere answers the nearest period', () => {
    const drills = []
    const series = Array.from({ length: 60 }, (_, i) => ({ label: `p${i}`, v1: i, n1: 1, s1: '' }))
    asTouch()
    render(<LineView params={P({ ...SEVEN.line, series })} width={340} onDrill={(cell, what, el) => drills.push({ cell, el })} />)
    const svg = screen.getByTestId('built-line-view')
    expect(svg.getAttribute('width')).toBe('340')
    expect(svg.getAttribute('viewBox').split(' ')[2]).toBe('340')
    expect(svg.closest('div').className).toMatch(/chartFit/)
    expect(/overflow:\s*hidden/.test(ruleBody('.chartFit'))).toBe(true)
    const overlay = svg.querySelector('[data-overlay]')
    expect(Number(overlay.getAttribute('height'))).toBeGreaterThanOrEqual(TAP)
    // the period nearest the tap answers, and the drill comes back to its keyboard mark
    const xs = [...svg.querySelectorAll('[data-period]')].map((g) => Number(g.querySelector('circle').getAttribute('cx')))
    fireEvent.click(overlay, { clientX: xs[41] + 1 })                        // touch: the first tap selects
    expect(drills).toEqual([])
    fireEvent.click(overlay, { clientX: xs[41] + 1 })                        // the second, same period, drills
    expect(drills[0].cell).toEqual({ label: 'p41' })
    expect(drills[0].el.getAttribute('data-period')).toBe('41')
    expect(nearestIndex([0, 10, 20], 14)).toBe(1)
    // the keyboard still walks the periods
    expect(svg.querySelectorAll('[data-built-cell]').length).toBe(60)
  })

  it('line legend items show each series\u2019 low to high', () => {
    const series = [{ label: 'a', v1: -50, n1: 1, s1: '', v2: 0.5, n2: 1, s2: '' }, { label: 'b', v1: 100, n1: 1, s1: '', v2: 1.5, n2: 1, s2: '' }]
    render(<LineView params={P({ view: 'line', measures: [MONEY[0], M('Total R', 'r')], value: {}, series })} />)
    const legend = screen.getByTestId('built-line-legend')
    expect(legend.querySelector('[data-legend="1"]').textContent).toBe('Net P&L (-$50.00 to +$100.00)')
    expect(legend.querySelector('[data-legend="2"]').textContent).toBe('Total R (+0.5R to +1.5R)')
  })

  it('a scrolling heat map opens at its NEWEST end, and goes back there when the data changes', () => {
    asTouch()
    const set = vi.fn()
    const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(2400)
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(340)
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', { configurable: true, get() { return 0 }, set })
    try {
      const p = P({ view: 'heat', measures: MONEY, value: {}, cells: yearCells() })
      const r = render(<HeatView params={p} />)
      expect(set).toHaveBeenLastCalledWith(2400 - 340)
      set.mockClear()
      r.rerender(<HeatView params={{ ...p, cells: yearCells().slice(5) }} />)
      expect(set).toHaveBeenCalledWith(2400 - 340)
    } finally {
      delete HTMLElement.prototype.scrollLeft
      sw.mockRestore()
      cw.mockRestore()
    }
  })

  it('bar at 340 px: every value line (hidden sentence and badge included) fits inside the box', () => {
    const rows = [
      { label: 'Flag', v1: null, n1: 3, s1: 'hide', n: 3 },
      { label: 'Pullback', v1: 0.61, n1: 12, s1: 'small', n: 12 },
      { label: 'VCP', v1: 0.5, n1: 30, s1: '', n: 30 },
    ]
    render(<BarView params={P({ view: 'bar', measures: [RATE], value: {}, rows })} width={340} />)
    const svg = screen.getByTestId('built-bar-view')
    expect(svg.hasAttribute('data-value-wrap')).toBe(true)                     // one line each would take > 40%
    const lines = [...svg.querySelectorAll('[data-value-line]')]
    expect(lines.length).toBeGreaterThan(3)
    for (const l of lines) {
      const own = [...l.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')
      const badge = l.querySelector('[data-badge]')
      const w = textW(own, Number(l.getAttribute('data-px'))) + (badge ? 6 + textW(badge.textContent, 11) : 0)
      expect(Number(l.getAttribute('x')) + w, own).toBeLessThanOrEqual(340)
    }
    expect(lines.map((l) => l.textContent)).toEqual(['Not enough', 'trades yet (3)', '61.0%', 'small sample', '50.0%'])
    // the label column keeps its share: the value column takes no more than VALUE_MAX of the width
    const valueX = Number(lines[0].getAttribute('x'))
    expect(340 - valueX).toBeLessThanOrEqual(340 * VALUE_MAX)
    // control: at 600 px the badge sits beside its value, one line each
    const wide = render(<BarView params={P({ view: 'bar', measures: [RATE], value: {}, rows })} width={600} />)
    expect(wide.getAllByTestId('built-bar-view')[1].hasAttribute('data-value-wrap')).toBe(false)
  })

  it('the small text is 11 px or larger: flag text, the SVG badge and the HTML badge', () => {
    // every rule naming the two SVG classes together (a fill rule and a size rule): the size is 11 px
    const bodies = [...CSS.matchAll(/(?:^|\n)\.flagText,\n\.badgeText\s*\{([^}]*)\}/g)].map((m) => m[1])
    const sizes = bodies.map((b) => Number((/font-size:\s*(\d+)px/.exec(b) || [])[1])).filter(Boolean)
    expect(sizes).toEqual([11])
    expect(Number((/font-size:\s*(\d+)px/.exec(ruleBody('.badge')) || [])[1])).toBeGreaterThanOrEqual(11)
  })

  it('heat shows a value only when it fits (cell - 4): a 6-char value in a 34 px cell shows its sign, inside the cell', () => {
    expect(compactValue(12500, 'money')).toBe('+12.5k')
    expect(cellLines({ value: 12500 }, 34, 'money')).toEqual(['+'])
    expect(cellLines({ value: 400 }, 34, 'money')).toEqual(['+400'])
    // a single week drawn at 58 px is one 34 px column
    render(<HeatView params={P({ view: 'heat', measures: MONEY, value: {}, cells: [
      { label: '2026-10-20', v1: 12500, n1: 1, s1: '' }, { label: '2026-10-21', v1: 400, n1: 1, s1: '' },
      { label: '2026-10-22', v1: null, n1: 3, s1: 'hide' }] })} width={58} />)
    const svg = screen.getByTestId('built-heat-view')
    expect(Number(svg.getAttribute('data-cell-size'))).toBe(34)
    const texts = [...svg.querySelectorAll('[data-heat-value] text')].map((t) => t.textContent)
    expect(texts).toEqual(['+', '+400'])                                     // "Not / enough" does not fit 34 px
    for (const back of svg.querySelectorAll('[data-heat-back]')) {
      expect(Number(back.getAttribute('width'))).toBeLessThanOrEqual(34)
      expect(Number(back.getAttribute('height'))).toBeLessThanOrEqual(34)
    }
  })

  it('compactValue never shows -0.00, and 999.5 to 999.99 is 1.0k', () => {
    expect(compactValue(-0.001, 'money')).toBe('>-0.01')
    expect(compactValue(0.001, 'money')).toBe('+<0.01')
    expect(compactValue(-0.004, 'r')).toBe('>-0.01R')
    expect(compactValue(999.5, 'money')).toBe('+1.0k')
    expect(compactValue(999.99, 'money')).toBe('+1.0k')
    expect(compactValue(999.4, 'money')).toBe('+999')
    expect(compactValue(999960, 'money')).toBe('+1.0m')
    expect(compactValue(-0.001, 'pct')).toBe('>-1%')
    for (const v of [-0.001, -0.0049, -0.00001]) expect(compactValue(v, 'money')).not.toMatch(/-0\.00/)
  })
  // ── fix round 3 ─────────────────────────────────────────────────────────────────────────────────────────

  it('line readout: an HTML tooltip, one wrapped line per measure, clamped inside the box (mouse hover)', () => {
    const series = [{ label: '2026-09', v1: 100, n1: 3, s1: '', v2: 0.5, n2: 3, s2: '' }, { label: '2026-10', v1: -50, n1: 2, s1: '', v2: 0.4, n2: 2, s2: '' }]
    render(<LineView params={P({ view: 'line', measures: [MONEY[0], RATE], value: {}, series })} width={340} onDrill={() => {}} />)
    const svg = screen.getByTestId('built-line-view')
    const overlay = svg.querySelector('[data-overlay]')
    const xs = [...svg.querySelectorAll('[data-period]')].map((g) => Number(g.querySelector('circle').getAttribute('cx')))
    fireEvent.pointerMove(overlay, { clientX: xs[1], pointerType: 'mouse' })
    const tip = screen.getByTestId('built-line-readout')
    expect(tip.tagName.toLowerCase()).toBe('div')
    expect([...tip.children].map((d) => d.textContent)).toEqual(['2026-10', 'Net P&L: -$50.00', 'Win rate: 40.0%, from 2 decisive trades'])
    expect(svg.querySelector('[data-testid="built-line-guide"]')).not.toBeNull()
    // clamped: at the last point the readout's right edge stays inside the 340 px box, and it never starts left of
    // the axis (the ticks are there)
    const padL = Number(svg.querySelector('line[class*="axis"]').getAttribute('x1'))
    const left = parseFloat(tip.style.left)
    const est = Math.max(...[...tip.children].map((d) => textW(d.textContent, 12))) + 18
    expect(left).toBeGreaterThanOrEqual(padL)
    expect(left + Math.min(340 - padL, est)).toBeLessThanOrEqual(340)
    expect(tip.style.maxWidth).toBe(`${340 - padL}px`)
    expect(/white-space:\s*normal/.test(ruleBody('.readout'))).toBe(true)
    fireEvent.pointerLeave(overlay)
    expect(screen.queryByTestId('built-line-readout')).toBeNull()
  })

  it('line: a mouse click drills at once; a touch tap selects first; a read-only copy only reads, with no pointer cursor', () => {
    const drills = []
    const r = render(<LineView params={P(SEVEN.line)} onDrill={(cell) => drills.push(cell)} />)
    let overlay = screen.getByTestId('built-line-view').querySelector('[data-overlay]')
    expect(overlay.getAttribute('class')).toMatch(/overlayDrill/)
    fireEvent.pointerDown(overlay, { pointerType: 'mouse' })
    fireEvent.click(overlay, { clientX: 0 })
    expect(drills).toEqual([{ label: '2026-08' }])
    // a touch pointer (on a desktop-sized screen): select, then drill on the same period
    fireEvent.pointerDown(overlay, { pointerType: 'touch' })
    fireEvent.click(overlay, { clientX: 9999 })
    expect(drills.length).toBe(1)
    expect(screen.getByTestId('built-line-readout').firstChild.textContent).toBe('2026-10')
    fireEvent.pointerDown(overlay, { pointerType: 'touch' })
    fireEvent.click(overlay, { clientX: 9999 })
    expect(drills).toEqual([{ label: '2026-08' }, { label: '2026-10' }])
    r.unmount()
    // read-only: a tap shows the readout and drills nothing; no pointer cursor
    render(<LineView params={P(SEVEN.line)} />)
    overlay = screen.getByTestId('built-line-view').querySelector('[data-overlay]')
    expect(overlay.getAttribute('class')).not.toMatch(/overlayDrill/)
    fireEvent.click(overlay, { clientX: 9999 })
    expect(screen.getByTestId('built-line-readout').firstChild.textContent).toBe('2026-10')
    expect(/cursor:\s*pointer/.test(ruleBody('.overlayDrill'))).toBe(true)
    expect(/cursor/.test(ruleBody('.overlay'))).toBe(false)
  })

  it('heat snaps to the newest end when the DATA changes, never on a pure width change after the member scrolled', () => {
    asTouch()
    const set = vi.fn()
    const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(2400)
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(340)
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', { configurable: true, get() { return 0 }, set })
    try {
      const p = P({ view: 'heat', measures: MONEY, value: {}, cells: yearCells() })
      const r = render(<HeatView params={p} width={340} />)
      expect(set).toHaveBeenCalledTimes(1)
      const box = screen.getByTestId('built-heat-view').parentElement
      fireEvent.scroll(box)                                                  // ours (the snap)
      fireEvent.scroll(box)                                                  // the member's
      set.mockClear()
      r.rerender(<HeatView params={p} width={360} />)                        // the box changed width only
      expect(set).not.toHaveBeenCalled()
      r.rerender(<HeatView params={{ ...p, cells: yearCells().slice(5) }} width={360} />)
      expect(set).toHaveBeenCalledWith(2400 - 340)
    } finally {
      delete HTMLElement.prototype.scrollLeft
      sw.mockRestore()
      cw.mockRestore()
    }
  })

  it('bar: the value column carries 8 px of slack beyond its widest measured line', () => {
    const rows = [{ label: 'Flag', v1: 123456.78, n1: 1, s1: '', n: 1 }]
    render(<BarView params={P({ view: 'bar', measures: MONEY, value: {}, rows })} width={600} />)
    const svg = screen.getByTestId('built-bar-view')
    const line = svg.querySelector('[data-value-line]')
    const w = lineWidth(valueLines({ text: '+$123,456.78' }, '', false)[0])
    expect(VALUE_SLACK).toBe(8)
    expect(600 - Number(line.getAttribute('x')) - w).toBeGreaterThanOrEqual(8 + 6)            // the slack, plus the column's own pad
  })

  /** Every rule naming .flagText, .badgeText or .badge, with the font size it sets in px (font-size or the font:
   *  shorthand; px, rem or em at a 16 px base). Rules that set no size are listed with px null. */
  const smallTextRules = (css) => {
    const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    const named = rules.filter(([, sel]) => /\.(flagText|badgeText|badge)(?![\w-])/.test(sel))
    const toPx = (n, unit) => Number(n) * (unit === 'px' ? 1 : 16)
    return named.map(([, sel, body]) => {
      const sizes = []
      for (const [, n, unit] of body.matchAll(/font-size:\s*(\d*\.?\d+)(px|rem|em)\b/g)) sizes.push(toPx(n, unit))
      for (const [, value] of body.matchAll(/(?:^|[;\s])font:\s*([^;]+)/g)) {
        const m = /(?:^|\s)(\d*\.?\d+)(px|rem|em)(?=\s*(?:\/|\s|$))/.exec(value)
        if (m) sizes.push(toPx(m[1], m[2]))
      }
      return { sel: sel.trim(), px: sizes.length ? Math.min(...sizes) : null }
    })
  }
  const underEleven = (css) => smallTextRules(css).filter((r) => r.px !== null && r.px < 11).map((r) => r.sel)

  it('no rule anywhere sets .flagText, .badgeText or .badge under 11 px (font-size or font:, px, rem or em)', () => {
    const found = smallTextRules(CSS)
    expect(found.length).toBeGreaterThan(0)
    expect(found.some((r) => r.px === 11)).toBe(true)                         // it reads the real rules' sizes
    expect(underEleven(CSS)).toEqual([])
    // controls, through the SAME loop: each one breaks the rule a different way, and each is caught
    expect(underEleven('.badgeText { font-size: 9px; }')).toEqual(['.badgeText'])
    expect(underEleven('.badge {\n  font: 600 10px/1.2 sans-serif;\n}')).toEqual(['.badge'])
    expect(underEleven('.flagText { font-size: 0.6rem; }')).toEqual(['.flagText'])
    expect(underEleven('@media (max-width: 640px) {\n  .flagText,\n.badgeText { font: 0.5em sans-serif }\n}'))
      .toEqual(['.flagText,\n.badgeText'])
    // and the sizes that are fine stay fine (11 px, 0.75rem = 12 px), and another class is never read
    expect(underEleven('.badge { font-size: 11px } .flagText { font: 500 0.75rem/1 x } .tick { font-size: 9px }')).toEqual([])
  })

  // ── fix round 4 ─────────────────────────────────────────────────────────────────────────────────────────

  it('the Line box and the heat scroller set touch-action: manipulation, so two taps never zoom on iOS', () => {
    for (const sel of ['.chartFit', '.chartBox']) expect(/touch-action:\s*manipulation\s*;/.test(ruleBody(sel)), sel).toBe(true)
    expect(/display:\s*block\s*;/.test(ruleBody('.chartFit'))).toBe(true)  // touch-action needs a block box
    const l = render(<LineView params={P(SEVEN.line)} onDrill={() => {}} />)
    const fit = l.getByTestId('built-line-view').parentElement
    expect(fit.tagName).toBe('DIV')
    expect(fit.className).toMatch(/chartFit/)
    l.unmount()
    render(<HeatView params={P(SEVEN.heat)} onDrill={() => {}} />)
    const box = screen.getByTestId('built-heat-view').parentElement
    expect(box.tagName).toBe('DIV')
    expect(box.className).toMatch(/chartBox/)
  })

  it('line: a mouse click leaves no readout behind once the pointer leaves', () => {
    const drills = []
    render(<LineView params={P(SEVEN.line)} onDrill={(cell) => drills.push(cell)} />)
    const overlay = screen.getByTestId('built-line-view').querySelector('[data-overlay]')
    fireEvent.pointerMove(overlay, { clientX: 9999, pointerType: 'mouse' })
    fireEvent.pointerDown(overlay, { pointerType: 'mouse' })
    fireEvent.click(overlay, { clientX: 9999 })
    expect(drills).toEqual([{ label: '2026-10' }])
    expect(screen.getByTestId('built-line-readout').firstChild.textContent).toBe('2026-10')   // the hover
    fireEvent.pointerLeave(overlay, { pointerType: 'mouse' })
    expect(screen.queryByTestId('built-line-readout')).toBeNull()
    expect(screen.queryByTestId('built-line-guide')).toBeNull()
    // a tap selection goes with a mouse that leaves (a touch screen with a mouse attached)
    fireEvent.pointerDown(overlay, { pointerType: 'touch' })
    fireEvent.click(overlay, { clientX: 0 })
    expect(screen.getByTestId('built-line-readout').firstChild.textContent).toBe('2026-08')
    fireEvent.pointerLeave(overlay, { pointerType: 'mouse' })
    expect(screen.queryByTestId('built-line-readout')).toBeNull()
  })

  it('line: a mouse or a pen drills on ONE click even on the touch tier (a narrow desktop window)', () => {
    asTouch()
    const drills = []
    render(<LineView params={P(SEVEN.line)} onDrill={(cell) => drills.push(cell)} />)
    const overlay = screen.getByTestId('built-line-view').querySelector('[data-overlay]')
    fireEvent.pointerDown(overlay, { pointerType: 'mouse' })
    fireEvent.click(overlay, { clientX: 9999 })
    expect(drills).toEqual([{ label: '2026-10' }])
    fireEvent.pointerDown(overlay, { pointerType: 'pen' })
    fireEvent.click(overlay, { clientX: 0 })
    expect(drills).toEqual([{ label: '2026-10' }, { label: '2026-08' }])
    // control: a finger on the same tier still selects first
    fireEvent.pointerDown(overlay, { pointerType: 'touch' })
    fireEvent.click(overlay, { clientX: 9999 })
    expect(drills.length).toBe(2)
    expect(screen.getByTestId('built-line-readout').firstChild.textContent).toBe('2026-10')
  })

  it('line: keyboard focus on a period shows its readout, and blur clears it; focus after a pointer does not', () => {
    render(<LineView params={P(SEVEN.line)} onDrill={() => {}} />)
    const marks = screen.getByTestId('built-line-view').querySelectorAll('[data-built-cell]')
    fireEvent.keyDown(document.body, { key: 'Tab' })
    act(() => marks[2].focus())
    expect(screen.getByTestId('built-line-readout').firstChild.textContent).toBe('2026-10')
    expect(screen.getByTestId('built-line-guide')).toBeInTheDocument()
    fireEvent.keyDown(marks[2], { key: 'ArrowLeft' })                       // the roving group moves focus
    expect(document.activeElement).toBe(marks[1])
    expect(screen.getByTestId('built-line-readout').firstChild.textContent).toBe('2026-09')
    act(() => marks[1].blur())
    expect(screen.queryByTestId('built-line-readout')).toBeNull()
    // focus put back on a mark after a mouse click (a drill panel's Close) shows no readout
    fireEvent.mouseDown(document.body)
    act(() => marks[0].focus())
    expect(document.activeElement).toBe(marks[0])
    expect(screen.queryByTestId('built-line-readout')).toBeNull()
  })

  it('line readout sits clear of its point and of the ticks: over the top edge, or the bottom when the point is high', () => {
    const series = [{ label: 'a', v1: 100, n1: 1, s1: '' }, { label: 'b', v1: -100, n1: 1, s1: '' }, { label: 'c', v1: 0, n1: 1, s1: '' }]
    render(<LineView params={P({ view: 'line', measures: MONEY, value: {}, series })} width={600} onDrill={() => {}} />)
    const svg = screen.getByTestId('built-line-view')
    const overlay = svg.querySelector('[data-overlay]')
    const padL = Number(svg.querySelector('line[class*="axis"]').getAttribute('x1'))
    const maxTick = svg.querySelector('[data-axis="max"]')
    const dots = [...svg.querySelectorAll('[data-period] circle')].map((c) => ({ x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')) }))
    const H = Number(svg.getAttribute('height'))
    const boxOf = (tip) => {
      const lines = tip.children.length
      const w = Math.min(600 - padL, Math.ceil(Math.max(...[...tip.children].map((d) => textW(d.textContent, 12)))) + 18)
      const h = Math.ceil(lines * 12 * 1.35) + 10
      const left = parseFloat(tip.style.left)
      const top = tip.style.top ? parseFloat(tip.style.top) : H - parseFloat(tip.style.bottom) - h
      return { left, right: left + w, top, bottom: top + h }
    }
    const covers = (b, d) => d.x + 3.5 > b.left && d.x - 3.5 < b.right && d.y + 3.5 > b.top && d.y - 3.5 < b.bottom
    const want = { 0: 'bottom', 1: 'top', 2: 'top' }                        // the max point is in the top third
    for (const i of [0, 1, 2]) {
      fireEvent.pointerMove(overlay, { clientX: dots[i].x, pointerType: 'mouse' })
      const tip = screen.getByTestId('built-line-readout')
      expect(tip.getAttribute('data-place'), `period ${i}`).toBe(want[i])
      const b = boxOf(tip)
      expect(covers(b, dots[i]), `period ${i} point`).toBe(false)
      expect(b.left).toBeGreaterThanOrEqual(padL)                            // the max and min ticks end at padL - 4
      expect(Number(maxTick.getAttribute('x'))).toBeLessThan(padL)
      expect(tip.style.maxWidth).toBe(`${600 - padL}px`)
    }
    expect(dots[0].y).toBeLessThan(26 + (H - 52) / 3)                         // it really is in the top third
    // a period with points at the top AND the bottom: the readout goes beside it
    const beside = readoutPlace({ ys: [26, 164], h: 60, x: 200, w: 120, width: 600, padL: 50 })
    expect(beside).toEqual({ v: 'top', left: 200 + 3.5 + 4 })
    const left = readoutPlace({ ys: [26, 164], h: 60, x: 560, w: 120, width: 600, padL: 50 })
    expect(left.left + 120).toBeLessThanOrEqual(560 - 3.5)
    expect(readoutPlace({ ys: [], h: 40, x: 10, w: 100, width: 600, padL: 50 }).left).toBe(50)
  })

  it('I-1: a readout too wide to sit beside its point goes in the largest clear gap and covers none of its points', () => {
    const ys = [30, 160]
    const h = 75
    const at = readoutPlace({ ys, h, x: 170, w: 280, width: 340, padL: 50 })
    expect(at.v).toBe('at')
    for (const y of ys) {
      const clear = y + 3.5 <= at.top || y - 3.5 >= at.top + h
      expect(clear).toBe(true)
    }
    expect(at.top).toBeGreaterThanOrEqual(2)
    expect(at.top + h).toBeLessThanOrEqual(190 - 2)
  })

  it('heat counts itself at its newest end within SNAP_SLOP (a rounded scroll position), and never snaps for it', () => {
    asTouch()
    const set = vi.fn()
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(2400)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(340)
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', { configurable: true, get() { return 2060 - 1.5 }, set })
    try {
      expect(SNAP_SLOP).toBeGreaterThan(1)
      render(<HeatView params={P({ view: 'heat', measures: MONEY, value: {}, cells: yearCells() })} width={340} />)
      expect(set).not.toHaveBeenCalled()
    } finally { delete HTMLElement.prototype.scrollLeft }
  })

  it('heat: a snap that fires no scroll event is ours for one frame only, so the member\u2019s next scroll counts', () => {
    asTouch()
    const frames = []
    vi.stubGlobal('requestAnimationFrame', (fn) => { frames.push(fn); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    const set = vi.fn()                                                      // the browser moved nothing: no event
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(2400)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(340)
    Object.defineProperty(HTMLElement.prototype, 'scrollLeft', { configurable: true, get() { return 0 }, set })
    try {
      const p = P({ view: 'heat', measures: MONEY, value: {}, cells: yearCells() })
      const r = render(<HeatView params={p} width={340} />)
      expect(set).toHaveBeenCalledTimes(1)
      expect(frames.length).toBe(1)
      act(() => { frames.splice(0).forEach((fn) => fn(0)) })                 // the next frame
      fireEvent.scroll(screen.getByTestId('built-heat-view').parentElement)  // the member's own scroll
      set.mockClear()
      r.rerender(<HeatView params={p} width={360} />)                        // a pure width change
      expect(set).not.toHaveBeenCalled()                                     // their position is theirs
    } finally { delete HTMLElement.prototype.scrollLeft }
  })

  it('compactValue: +<0.01 for a tiny gain, a b unit, and 0R for an exact zero', () => {
    expect(compactValue(0.001, 'money')).toBe('+<0.01')
    expect(compactValue(2.5e9, 'money')).toBe('+2.5b')
    expect(compactValue(-999.96e6, 'money')).toBe('-1.0b')
    expect(compactValue(0, 'r')).toBe('0R')
    expect(compactValue(-0.004, 'r')).toBe('>-0.01R')
  })
})

// ── Wave 10 (Task 10.18): the engine's new keys in the views ─────────────────────────────────────────────────────
// Fixtures are REAL payloads from widget_engine/payload.py (nbw-p2-be HEAD 2f1d7ce45c, seeded scratch DB), in
// __fixtures__/w10Payloads.json. Server sentences are asserted verbatim from those payloads, never retyped.

/** The keys wave 10 adds to a payload (W10-R7: none is allowlisted publicly). */
const W10_TOP = ['drawdown', 'target', 'targetLabel', 'stop', 'quadrants', 'probe']
const W10_ROW = ['d1', 'd2', 'd3', 'dd1']
/** The payload a wave 9 plan (or a public page) gets: the same numbers, none of the new keys. */
const withoutW10 = (p) => {
  const out = { ...p }
  for (const k of W10_TOP) delete out[k]
  if (Array.isArray(out.series)) {
    out.series = out.series.map((r) => {
      const c = { ...r }
      for (const k of W10_ROW) delete c[k]
      return c
    })
  }
  return out
}
const VIEW_OF = { number: NumberView, progress: ProgressView, line: LineView, scatter: ScatterView, compare: CompareView, bar: BarView }
/** React's useId values depend on how many ids were made before, so a page's ids are normalised. */
const htmlOf = (node) => node.innerHTML
  .replace(/_r_[0-9a-z]+_|«r[0-9a-z]+»|:r[0-9a-z]+:/g, 'ID')
  .replace(/built-(hatch|dd)-[A-Za-z0-9_-]+/g, 'built-$1-ID')
/** One payload drawn three ways: its own view, Show as table, and the whole placed widget. */
const renderAll = (p) => {
  const V = VIEW_OF[p.view]
  const out = {}
  let r = render(<V params={p} />)
  out.view = htmlOf(r.container)
  r.unmount()
  r = render(<TableAlt params={p} />)
  out.table = htmlOf(r.container)
  r.unmount()
  r = render(<BuiltWidgetEmbed attrs={widgetEmbedNode('builtWidget', p).attrs} />)
  out.embed = htmlOf(r.container)
  r.unmount()
  return out
}

describe('wave 10 keys in the built views (Task 10.18)', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T15:00:00Z')) })
  afterEach(() => { vi.useRealTimers() })

  it('line_drawdown_band_pattern_and_legend', () => {
    const p = W10.line_cumulative
    render(<LineView params={p} />)
    const svg = screen.getByTestId('built-line-view')
    // the band is HATCHED: a <pattern> of lines, and every band fills with it (never a flat colour alone)
    const pat = svg.querySelector('pattern[data-dd-pattern]')
    expect(pat).not.toBeNull()
    expect(pat.querySelector('line')).not.toBeNull()
    const bands = [...svg.querySelectorAll('[data-dd-band]')]
    expect(bands.length).toBe(1)                                             // one unbroken run of days
    for (const b of bands) expect(b.getAttribute('fill')).toBe(`url(#${pat.id})`)
    // the y axis reaches the running high the band hangs from (here the series' own high, +$470.00)
    expect(svg.querySelector('[data-axis="max"]').textContent).toBe('+$470.00')
    // the text legend says what the hatch is, and draws the same pattern
    const legend = screen.getByTestId('built-line-dd-legend')
    expect(legend.textContent).toBe('Drawdown')
    expect(legend.querySelector('rect').getAttribute('fill')).toBe(`url(#${pat.id})`)
    // no band and no legend without the drawdown key (the wave 8 line)
    const r = render(<LineView params={withoutW10(p)} />)
    expect(r.container.querySelector('[data-dd-band]')).toBeNull()
    expect(r.container.querySelector('[data-testid="built-line-dd-legend"]')).toBeNull()
    r.unmount()
    // a gap in the series breaks the band as it breaks the line: never a band across a missing day
    const gap = { ...p, series: p.series.map((row, i) => (i === 4 ? { ...row, v1: null, d1: null, dd1: null } : row)) }
    const g = render(<LineView params={gap} />)
    const gb = [...g.container.querySelectorAll('[data-dd-band]')]
    expect(gb.length).toBe(2)
    for (const b of gb) {
      expect(b.getAttribute('points').split(' ').every((xy) => xy.split(',').every((n) => Number.isFinite(Number(n))))).toBe(true)
    }
    g.unmount()
    // a range that only falls: the running high is the range's start (the server's floor of 0), above every total,
    // and the axis reaches it so the band is drawn inside the plot
    const fall = { ...p, series: [
      { ...p.series[0], label: '2026-03-02', v1: -100, d1: -100, dd1: -100 },
      { ...p.series[1], label: '2026-03-03', v1: -300, d1: -200, dd1: -300 }] }
    const f = render(<LineView params={fall} />)
    expect(f.container.querySelector('[data-axis="max"]').textContent).toBe(fmtValue(0, 'money'))
    expect(f.container.querySelectorAll('[data-dd-band]').length).toBe(1)
  })

  it('line_readout_total_and_day', () => {
    const p = W10.line_cumulative
    render(<LineView params={p} onDrill={() => {}} />)
    const svg = screen.getByTestId('built-line-view')
    const overlay = svg.querySelector('[data-overlay]')
    const xs = [...svg.querySelectorAll('[data-period]')].map((g) => Number(g.querySelector('circle').getAttribute('cx')))
    fireEvent.pointerMove(overlay, { clientX: xs[2], pointerType: 'mouse' })
    const tip = screen.getByTestId('built-line-readout')
    // 2026-03-04: a running total of -$50.00 after a -$250.00 day
    expect([...tip.children].map((d) => d.textContent)).toEqual(['2026-03-04', '-$50.00 total · -$250.00 that day'])
    // the period's own name (aria and tooltip) says the same
    const mark = svg.querySelector('[data-period="2"]')
    expect(mark.getAttribute('aria-label')).toBe('2026-03-04: -$50.00 total · -$250.00 that day')
    expect(mark.querySelector('title').textContent).toBe('2026-03-04: -$50.00 total · -$250.00 that day')
    // a day with no amount of its own says so, never "+$0.00 that day"
    const gap = { ...p, series: p.series.map((row, i) => (i === 3 ? { ...row, d1: null } : row)) }
    const r = render(<LineView params={gap} />)
    expect(r.container.querySelector('[data-period="3"]').getAttribute('aria-label'))
      .toBe('2026-03-05: +$70.00 total · no data that day')
  })

  it('number_drawdown_span_sentence', () => {
    // the server's span sentence, verbatim, on one line under the max drawdown figure
    for (const name of ['number_drawdown_recovered', 'number_drawdown_start', 'number_drawdown_none']) {
      const p = W10[name]
      const r = render(<NumberView params={p} />)
      const line = r.container.querySelector('[data-testid="built-number-drawdown"]')
      expect(line, name).not.toBeNull()
      expect(line.textContent, name).toBe(p.drawdown.line)
      r.unmount()
    }
    expect(W10.number_drawdown_start.drawdown.line).toBe('From the start of this range to Mar 3; recovered Mar 4.')
    // with two measures it sits under the max drawdown figure, not the other one
    const r = render(<NumberView params={W10.number_drawdown_open} />)
    const metrics = r.container.querySelectorAll('[class*="_metric_"]')
    expect(metrics.length).toBe(2)
    expect(within(metrics[0]).getByTestId('built-number-drawdown').textContent).toBe('From Mar 2 to Mar 4; recovered Mar 6.')
    expect(within(metrics[1]).queryByTestId('built-number-drawdown')).toBeNull()
    r.unmount()
    // no key (wave 10 off, or an empty range): no line, and nothing in its place
    for (const name of ['number_drawdown_w10_off', 'number_drawdown_empty']) {
      expect(W10[name].drawdown, name).toBeUndefined()
      const q = render(<NumberView params={W10[name]} />)
      expect(q.container.querySelector('[data-testid="built-number-drawdown"]'), name).toBeNull()
      q.unmount()
    }
  })

  it('progress_goal_label_and_missing_notice', () => {
    // a goal: "Weekly goal: $1,000.00" and the share of it
    let r = render(<ProgressView params={W10.progress_goal} onDrill={() => {}} />)
    const view = screen.getByTestId('built-progress-view')
    expect(within(view).getByText('Weekly goal: $1,000.00')).toBeInTheDocument()
    expect(within(view).getByText('30%')).toBeInTheDocument()
    expect(view.querySelector('rect[class*="barPos"]').getAttribute('width')).toBe(String(0.3 * 600))
    expect(view.querySelector('[data-built-cell]').getAttribute('aria-label')).toBe('Net P&L: +$300.00 Weekly goal: $1,000.00, 30%')
    r.unmount()
    // no goal: the server's notice in place of the bar (no bar, no 0%)
    const miss = W10.progress_goal_missing
    expect(miss.target).toBeNull()
    r = render(<ProgressView params={miss} />)
    const mv = screen.getByTestId('built-progress-view')
    expect(within(mv).getByText('Yearly goal')).toBeInTheDocument()
    expect(within(mv).getByTestId('built-progress-notice').textContent).toBe(miss.notice)
    expect(mv.querySelector('svg')).toBeNull()
    expect(mv.textContent).not.toMatch(/\b0%/)
    r.unmount()
    // the placed widget says the notice ONCE (in the view, not again under it)
    r = render(<BuiltWidgetEmbed attrs={{ ...widgetEmbedNode('builtWidget', miss).attrs, params: miss }} editable onUpdateParams={() => true} />)
    expect(screen.getAllByText(miss.notice).length).toBe(1)
    expect(screen.getByTestId('built-progress-notice')).toBeInTheDocument()
    // Show as table: the notice goes back under the table, still once
    fireEvent.click(screen.getByRole('button', { name: /show as table/i }))
    expect(screen.queryByTestId('built-progress-notice')).toBeNull()
    expect(screen.getAllByText(miss.notice).length).toBe(1)
    r.unmount()
    // the sample book: no goal was read and no notice sent, so the wave 8 view (never a claim the goal is missing)
    const sample = W10.progress_goal_sample
    expect(sample.notice).toBeNull()
    r = render(<ProgressView params={sample} />)
    const sv = screen.getByTestId('built-progress-view')
    expect(within(sv).queryByTestId('built-progress-notice')).toBeNull()
    expect(within(sv).getByText('No target saved with this widget.')).toBeInTheDocument()
  })

  it('stop_after_line', () => {
    for (const name of ['stop_under', 'stop_hit', 'stop_none']) {
      const p = W10[name]
      const r = render(<NumberView params={p} />)
      expect(r.container.querySelector('[data-testid="built-number-stop"]').textContent, name).toBe(p.stop.line)
      r.unmount()
    }
    expect(W10.stop_hit.stop.line).toBe('3 of your 3 losses in a row. Your rule says stop here.')
    // an empty range: stop is null and the widget's empty sentence speaks; the view draws no line
    expect(W10.stop_empty.stop).toBeNull()
    const r = render(<NumberView params={W10.stop_empty} />)
    expect(r.container.querySelector('[data-testid="built-number-stop"]')).toBeNull()
  })

  it('scatter_quadrant_captions_and_guides', () => {
    const p = W10.scatter_excursion
    render(<ScatterView params={p} />)
    const svg = screen.getByTestId('built-scatter-view')
    // 1R guides on both axes
    const gx = svg.querySelector('[data-guide="x1r"]')
    const gy = svg.querySelector('[data-guide="y1r"]')
    expect(gx.getAttribute('x1')).toBe(gx.getAttribute('x2'))                // vertical, at MAE = 1R
    expect(gy.getAttribute('y1')).toBe(gy.getAttribute('y2'))                // horizontal, at MFE = 1R
    const vx = Number(gx.getAttribute('x1'))
    const hy = Number(gy.getAttribute('y1'))
    // the captions sit in their quadrants: "gave it back" top left, "stopped too tight" bottom right
    const back = svg.querySelector('[data-quadrant="gave"]')
    const tight = svg.querySelector('[data-quadrant="tight"]')
    expect(back.textContent).toBe('gave it back')
    expect(tight.textContent).toBe('stopped too tight')
    expect(Number(back.getAttribute('x')) + textW(back.textContent, 11)).toBeLessThan(vx)
    expect(Number(back.getAttribute('y'))).toBeLessThan(hy)
    expect(Number(tight.getAttribute('x')) - textW(tight.textContent, 11)).toBeGreaterThan(vx)
    expect(Number(tight.getAttribute('y'))).toBeGreaterThan(hy)
    // 2.5R for and 0.4R against is top left of both guides; 1.2R against and 0.3R for is bottom right
    const pos = (d) => {
      const c = svg.querySelector(`[data-day="${d}"] [data-hit]`)
      return { x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')) }
    }
    expect(pos('2026-03-02').x).toBeLessThan(vx)
    expect(pos('2026-03-02').y).toBeLessThan(hy)
    expect(pos('2026-03-03').x).toBeGreaterThan(vx)
    expect(pos('2026-03-03').y).toBeGreaterThan(hy)
    expect(pos('2026-03-06').x).toBeCloseTo(vx, 5)                            // exactly 1R lies ON the guides
    expect(pos('2026-03-06').y).toBeCloseTo(hy, 5)
    // the boundaries: "at least 1R" includes 1R itself on both axes
    expect([quadrantOf(0.99, 1), quadrantOf(1, 0.99), quadrantOf(1, 1), quadrantOf(0.99, 0.99), quadrantOf(null, 2)])
      .toEqual(['gave', 'tight', null, null, null])
    // result shapes as wave 8
    expect(svg.querySelector('[data-day="2026-03-02"] [data-shape]').getAttribute('data-shape')).toBe('dot')
    expect(svg.querySelector('[data-day="2026-03-03"] [data-shape]').getAttribute('data-shape')).toBe('ring')
    expect(svg.querySelector('[data-day="2026-03-05"] [data-shape]').getAttribute('data-shape')).toBe('dash')
    // the guides say what they are, in words, under the chart
    expect(screen.getByTestId('built-scatter-quadrants').textContent).toBe('Dashed lines mark 1R on each axis.')
    // R-31: at a 340 px phone width a caption is drawn only inside its own quadrant; one that does not fit there
    // (here the bottom right: the 1R guide sits at x 256 of 340, and the caption needs 112 px) is said in words
    // under the chart instead, never drawn across the guide or past the edge
    const r = render(<ScatterView params={p} width={340} />)
    const s2 = r.container.querySelector('[data-testid="built-scatter-view"]')
    const v2 = Number(s2.querySelector('[data-guide="x1r"]').getAttribute('x1'))
    const b2 = s2.querySelector('[data-quadrant="gave"]')
    expect(Number(b2.getAttribute('x')) + textW(b2.textContent, 11)).toBeLessThan(v2)
    expect(s2.querySelector('[data-quadrant="tight"]')).toBeNull()
    expect(within(r.container).getByTestId('built-scatter-quadrants').textContent)
      .toBe('Dashed lines mark 1R on each axis. Bottom right: stopped too tight.')
    // and wide enough, the right-hand caption fits and is drawn inside the plot
    const t1 = svg.querySelector('[data-quadrant="tight"]')
    expect(Number(t1.getAttribute('x'))).toBeLessThanOrEqual(W)
    r.unmount()
    // no quadrants key: no guides, no captions (the wave 8 scatter)
    const q = render(<ScatterView params={withoutW10(p)} />)
    expect(q.container.querySelector('[data-guide]')).toBeNull()
    expect(q.container.querySelector('[data-quadrant]')).toBeNull()
    expect(q.container.querySelector('[data-testid="built-scatter-quadrants"]')).toBeNull()
  })

  it('table_alt_has_new_columns', () => {
    const cols = (p) => {
      const r = render(<TableAlt params={p} />)
      const t = r.container.querySelector('table')
      const head = [...t.querySelectorAll('th')].map((th) => th.textContent)
      const rows = [...t.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent))
      r.unmount()
      return { head, rows }
    }
    // a running total: the day's own amount and the drop from the high, for every period
    let t = cols(W10.line_cumulative)
    expect(t.head).toEqual(['Period', 'Net P&L, running total', 'Net P&L, that day', 'Drawdown'])
    expect(t.rows[0]).toEqual(['2026-03-02', '+$300.00', '+$300.00', 'At the high'])
    expect(t.rows[2]).toEqual(['2026-03-04', '-$50.00', '-$250.00', '-$350.00'])
    // the drawdown's days and the stop-after line, as the server wrote them
    t = cols(W10.number_drawdown_recovered)
    expect(t.head).toEqual(['Group', 'Max drawdown', 'Drawdown dates'])
    expect(t.rows[0]).toEqual(['All', '-$120.00', W10.number_drawdown_recovered.drawdown.line])
    t = cols(W10.stop_under)
    expect(t.head).toEqual(['Group', 'Current streak', 'Stop after'])
    expect(t.rows[0][2]).toBe('2 of your 3 losses in a row')
    // a goal: its label and amount, and the share of it; with no goal set, no data (the server's notice is said
    // once, under the table)
    t = cols(W10.progress_goal)
    expect(t.head).toEqual(['Group', 'Net P&L', 'Weekly goal', 'Of goal'])
    expect(t.rows[0]).toEqual(['All', '+$300.00', '$1,000.00', '30%'])
    t = cols(W10.progress_goal_missing)
    expect(t.head).toEqual(['Group', 'Net P&L', 'Yearly goal', 'Of goal'])
    expect(t.rows[0]).toEqual(['All', '+$300.00', 'no data', 'no data'])
    // the quadrant each trade falls in (exactly 1R on both is in neither captioned quadrant)
    t = cols(W10.scatter_excursion)
    expect(t.head).toEqual(['Day', 'MAE', 'MFE', 'Result', 'Quadrant'])
    expect(t.rows.map((row) => row[4])).toEqual(['gave it back', 'stopped too tight', '', '', ''])
    // no new keys: the wave 8 columns, exactly
    expect(cols(withoutW10(W10.line_cumulative)).head).toEqual(['Period', 'Net P&L'])
    expect(cols(withoutW10(W10.scatter_excursion)).head).toEqual(['Day', 'MAE', 'MFE', 'Result'])
    expect(cols(withoutW10(W10.progress_goal)).head).toEqual(['Group', 'Net P&L'])
    expect(cols(withoutW10(W10.stop_under)).head).toEqual(['Group', 'Current streak'])
  })

  it('formula_formats_money_pct_r', () => {
    // a formula measure row is {key, label, unit, kind, fmt}: formatted by its fmt with the existing formatters
    const a = W10.formula_money_pct_count
    expect(a.measures.map((m) => m.fmt)).toEqual(['money', 'pct', 'count'])
    const shown = (p) => {
      const r = render(<NumberView params={p} />)
      const out = [...r.container.querySelectorAll('[class*="metricValue"]')].map((n) => n.firstChild.textContent)
      r.unmount()
      return out
    }
    expect(shown(a)).toEqual(['+$32.00', '6.4%', '2'])                        // pct multiplies by 100
    const b = W10.formula_r_rate
    expect(b.measures.map((m) => m.fmt)).toEqual(['r', 'pct'])
    expect(shown(b)).toEqual(['+3.2R', '40.0%'])
    expect(fmtValue(3.2, 'r')).toBe('+3.2R')
    // the scatter's R axes read in R
    const r = render(<ScatterView params={W10.scatter_excursion} />)
    expect(r.container.querySelector('[data-axis="max"]').textContent).toBe(fmtValue(2.5, 'r'))
  })

  // ── fix round 1 ─────────────────────────────────────────────────────────────────────────────────────────

  it('compare_drawdown_span_sentence (I-1, W10-R11): the dates under the current-period figure, verbatim', () => {
    const p = W10.compare_drawdown
    expect(p.view).toBe('compare')
    const r = render(<CompareView params={p} onDrill={() => {}} />)
    const metrics = r.container.querySelectorAll('[class*="_metric_"]')
    expect(metrics.length).toBe(2)
    expect(within(metrics[0]).getByTestId('built-number-drawdown').textContent).toBe(p.drawdown.line)
    expect(p.drawdown.line).toBe('From Mar 2 to Mar 4; not recovered yet.')
    expect(within(metrics[1]).queryByTestId('built-number-drawdown')).toBeNull()
    // it sits after the comparison, under the current figure, never inside the drill mark's own name
    const mark = metrics[0].querySelector('[data-built-cell]')
    expect(mark.contains(within(metrics[0]).getByTestId('built-number-drawdown'))).toBe(false)
    r.unmount()
    // without the key (wave 10 off) nothing is drawn; shared, the keys are never read (the public rail covers it)
    const q = render(<CompareView params={withoutW10(p)} />)
    expect(q.container.querySelector('[data-testid="built-number-drawdown"]')).toBeNull()
    q.unmount()
    const sh = render(<CompareView params={{ ...p, share: true }} />)
    expect(sh.container.querySelector('[data-testid="built-number-drawdown"]')).toBeNull()
  })

  it('stop_after_line on every view (m2), in the server\'s words, and in its danger ink at the rule (m4, k = N)', () => {
    const toneOfNote = (el) => /_dn_/.test(el.className)
    // number and compare: under the current_streak figure
    let r = render(<CompareView params={W10.compare_stop} />)
    let note = r.container.querySelector('[data-testid="built-number-stop"]')
    expect(note.textContent).toBe(W10.compare_stop.stop.line)
    expect(W10.compare_stop.stop).toEqual({ after: 2, losses: 2, line: '2 of your 2 losses in a row. Your rule says stop here.' })
    expect(toneOfNote(note)).toBe(true)                                      // k = N: at the rule
    r.unmount()
    for (const [name, at] of [['stop_hit', true], ['stop_under', false], ['stop_none', false]]) {
      r = render(<NumberView params={W10[name]} />)
      expect(toneOfNote(r.container.querySelector('[data-testid="built-number-stop"]')), name).toBe(at)
      r.unmount()
    }
    // any other view (here a bar by setup): the placed widget says it once, under the body
    const bar = W10.bar_stop
    expect(bar.view).toBe('bar')
    r = render(<BuiltWidgetEmbed attrs={{ ...widgetEmbedNode('builtWidget', bar).attrs, params: bar }} editable onUpdateParams={() => true} />)
    expect(screen.getAllByText(bar.stop.line).length).toBe(1)
    expect(screen.getByTestId('built-stop-note').textContent).toBe('2 of your 3 losses in a row')
    expect(toneOfNote(screen.getByTestId('built-stop-note'))).toBe(false)    // 2 of 3: under the rule
    // Show as table: a bar's table has no stop column, so the line stays under it, once
    fireEvent.click(screen.getByRole('button', { name: /show as table/i }))
    expect(screen.getAllByText(bar.stop.line).length).toBe(1)
    r.unmount()
    // a compare view draws it itself, so the placed widget does not repeat it; its table carries it as a column
    const cmp = W10.compare_stop
    r = render(<BuiltWidgetEmbed attrs={{ ...widgetEmbedNode('builtWidget', cmp).attrs, params: cmp }} editable onUpdateParams={() => true} />)
    expect(screen.getAllByText(cmp.stop.line).length).toBe(1)
    expect(screen.queryByTestId('built-stop-note')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /show as table/i }))
    expect(screen.getAllByText(cmp.stop.line).length).toBe(1)
    expect(screen.queryByTestId('built-stop-note')).toBeNull()
    r.unmount()
    // shared: nothing (W10-R7)
    r = render(<BuiltWidgetEmbed attrs={{ ...widgetEmbedNode('builtWidget', bar).attrs, params: { ...bar, share: true } }} />)
    expect(screen.queryByText(bar.stop.line)).toBeNull()
  })

  it('a nonzero share of a goal never reads 0% (m5)', () => {
    expect(shareText(3, 1000)).toBe('<1%')
    expect(shareText(-3, 1000)).toBe('>-1%')
    expect(shareText(0, 1000)).toBe('0%')                                   // a true zero is a zero
    expect(shareText(5, 1000)).toBe('1%')
    expect(shareText(null, 1000)).toBe('')
    const p = { ...W10.progress_goal, value: { ...W10.progress_goal.value, v1: 3 } }
    render(<ProgressView params={p} />)
    expect(within(screen.getByTestId('built-progress-view')).getByText('<1%')).toBeInTheDocument()
  })

  it('public_payload_without_keys_unchanged', () => {
    // The wave 8 rendering of every fixture with the new keys removed (snapshot taken before any 10.18 code) is
    // what a public page draws, WITH the keys present too: a shared body never reads them (W10-R7).
    for (const [name, full] of Object.entries(W10)) {
      const plain = withoutW10(full)
      const wave8 = renderAll({ ...plain, share: true })
      expect(wave8, name).toMatchSnapshot(name)
      expect(renderAll({ ...full, share: true }), `${name}: shared, keys present`).toEqual(wave8)
      // a private wave 9 payload (no keys) is the wave 8 view as well
      expect(renderAll({ ...plain, share: false }), `${name}: private, no keys`).toMatchSnapshot(`${name} private`)
    }
  })
})

describe('drilled options strategies and notes (Task 10.17)', () => {
  // be drill._option_row / _note_row: the shapes the server answers for the two wave 10 sources.
  const OPTION_ROWS = [
    { day: '2026-10-20', label: 'SPY', label2: 'Iron condor', net: 120, r: 0.5, result: 'Win', open: false, strategyId: 'opt-1' },
    { day: '2026-10-21', label: 'AAPL', label2: 'Long call', net: null, r: null, result: null, open: true, strategyId: 'opt-2' },
  ]
  const NOTE_ROWS = [{ day: '2026-10-22', label: 'Why I sized down', noteId: 'note-1' }, { day: '2026-10-23', label: '', noteId: 'note-2' }]
  const drillAnswer = (rows) => fetchSpy.mockImplementation(() => Promise.resolve({
    ok: true, status: 200, json: async () => ({ rows, more: 0, count: rows.length, live: false, note: null }),
  }))
  const openDrill = async (sourceKey, ui = (x) => x) => {
    const onClose = vi.fn()
    const r = render(ui(<DrillPanel params={P({ sourceKey, view: 'list' })} cell={{}} what="this" opener={null} onClose={onClose} />))
    await act(async () => {})
    return { ...r, onClose }
  }
  /** Where the app router is, for the in-router cases. */
  function Where() { const loc = useLocation(); return <p data-testid="where">{`${loc.pathname}${loc.search}`}</p> }
  const inRouter = (el) => (
    <MemoryRouter initialEntries={['/journal/notebook?note=here']}>{el}<Where /></MemoryRouter>
  )

  it('drill_options_row_opens_options_drawer', async () => {
    drillAnswer(OPTION_ROWS)
    const { onClose } = await openDrill('options_strategies', inRouter)
    const rows = screen.getByTestId('built-drill-rows')
    // The underlying heads the row; the strategy, day, net, R and result follow; an open one shows none of its numbers.
    const first = within(rows).getAllByRole('listitem')[0]
    expect(first.textContent).toContain('Iron condor')
    expect(first.textContent).toContain('2026-10-20')
    expect(within(rows).getAllByRole('listitem')[1].textContent).not.toMatch(/no data|\$0/)
    // Each strategy links to the existing options drawer (R-30), its own id, never the trade page.
    const link = within(rows).getByRole('link', { name: 'SPY' })
    expect(link).toHaveAttribute('href', optionHref('opt-1'))
    expect(optionHref('opt-1')).toBe('/journal?j2tab=journal&openTrade=opt-1')
    expect(within(rows).queryAllByRole('link').map((a) => a.getAttribute('href'))).not.toContain('/journal-2-0/trade/opt-1')
    // A plain click moves the app's own router there and closes the panel.
    fireEvent.click(link)
    expect(screen.getByTestId('where').textContent).toBe('/journal?j2tab=journal&openTrade=opt-1')
    expect(onClose).toHaveBeenCalledWith(false)
  })

  it('an_open_strategy_row_is_plain_text_and_a_closed_one_links (W10-R65)', async () => {
    // the server's `open` decides, never the missing numbers: a closed row with no figures still links
    drillAnswer([...OPTION_ROWS,
      { day: '2026-10-22', label: 'QQQ', label2: 'Short put', net: null, r: null, result: null, open: false, strategyId: 'opt-3' }])
    await openDrill('options_strategies', inRouter)
    const rows = screen.getByTestId('built-drill-rows')
    const items = within(rows).getAllByRole('listitem')
    // open: the underlying as text, no link anywhere in its row
    expect(within(items[1]).queryByRole('link')).toBeNull()
    expect(within(items[1]).getByText('AAPL')).toBeInTheDocument()
    // closed: a link to the drawer
    expect(within(items[0]).getByRole('link', { name: 'SPY' })).toHaveAttribute('href', optionHref('opt-1'))
    expect(within(items[2]).getByRole('link', { name: 'QQQ' })).toHaveAttribute('href', optionHref('opt-3'))
    expect(within(rows).queryAllByRole('link').map((a) => a.getAttribute('href'))).not.toContain(optionHref('opt-2'))
  })

  it('drill_note_row_opens_note', async () => {
    drillAnswer(NOTE_ROWS)
    const { onClose, unmount } = await openDrill('notes', inRouter)
    const rows = screen.getByTestId('built-drill-rows')
    const link = within(rows).getByRole('link', { name: 'Why I sized down' })
    // The note editor's own note link (toolEditorLib.noteHref, its one owner), by the note's id.
    expect(link).toHaveAttribute('href', drillNoteHref('note-1'))
    expect(drillNoteHref('note-1')).toBe('/journal/notebook?note=note-1')
    // An untitled note still reads as a note, never as its id.
    expect(within(rows).getByRole('link', { name: 'Untitled note' })).toHaveAttribute('href', drillNoteHref('note-2'))
    expect(rows.textContent).not.toContain('note-2')
    fireEvent.click(link)
    expect(screen.getByTestId('where').textContent).toBe('/journal/notebook?note=note-1')
    expect(onClose).toHaveBeenCalledWith(false)
    unmount()

    // Drawn outside the app's router (the note editor's own root): the editor's in-place note navigation.
    drillAnswer(NOTE_ROWS)
    const pushed = vi.spyOn(window.history, 'pushState')
    const popped = vi.fn()
    window.addEventListener('popstate', popped)
    await openDrill('notes')
    fireEvent.click(screen.getByRole('link', { name: 'Why I sized down' }))
    expect(pushed).toHaveBeenCalledWith(expect.anything(), '', drillNoteHref('note-1'))
    expect(popped).toHaveBeenCalledTimes(1)
    window.removeEventListener('popstate', popped)
  })

  it('a modified click on a drilled note is the browser’s (a new tab), never an in-place move', async () => {
    drillAnswer(NOTE_ROWS)
    await openDrill('notes', inRouter)
    const link = screen.getByRole('link', { name: 'Why I sized down' })
    fireEvent.click(link, { ctrlKey: true })
    expect(screen.getByTestId('where').textContent).toBe('/journal/notebook?note=here')
  })
})
