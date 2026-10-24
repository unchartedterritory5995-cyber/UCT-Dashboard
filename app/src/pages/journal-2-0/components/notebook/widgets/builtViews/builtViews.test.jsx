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
import { fmtValue, countText, compactValue, tableModelOf } from './builtModel'
import { W, TAP, textW, FLIP_PX, SETTLE_MS, SEEN_MS, TRAIL_MAX } from './svg'

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
const CSS = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/widgets/builtViews/builtViews.module.css'), 'utf8')
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

  it('R-25 canary: a SHARED bar or heat view draws no account name, and the drill still asks by the real one', () => {
    const CANARY = 'CANARY-ACCT-Roth'
    const bar = { view: 'bar', labelKind: 'account', measures: MONEY, value: { v1: 1, n1: 2, n: 2 }, rows: [
      { label: CANARY, v1: 10, n1: 1, s1: '', n: 1 }, { label: 'Main', v1: 20, n1: 1, s1: '', n: 1 }] }
    const heat = { view: 'heat', labelKind: 'account', measures: MONEY, value: { v1: 1, n1: 2, n: 2 }, cells: [
      { label: CANARY, v1: 10, n1: 1, s1: '' }, { label: 'Main', v1: -20, n1: 1, s1: '' }] }
    for (const p of [bar, heat]) {
      const shared = render(<BuiltWidgetEmbed attrs={attrsOf({ ...p, share: true })} />)
      expect(shared.container.innerHTML, p.view).not.toContain(CANARY)       // text, titles and aria-labels
      expect(shared.container.textContent, p.view).toContain('Account 1')
      shared.unmount()
      const own = render(<BuiltWidgetEmbed attrs={attrsOf({ ...p, share: false })} />)
      expect(own.container.innerHTML, p.view).toContain(CANARY)
      own.unmount()
    }
    const model = tableModelOf({ ...BASE, ...bar, share: true })
    expect(model.rows.map((r) => r.label)).toEqual(['Account 1', 'Account 2'])
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
