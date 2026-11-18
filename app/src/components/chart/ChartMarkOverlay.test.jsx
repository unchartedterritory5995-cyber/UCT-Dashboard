// The drill chart's marks as HTML labels (StockChart `markerLook`; the owner, 2026-11-17: "the arrow and the text/font
// could look much better and be a lot more of a cool production"). A fake chart stands in for lightweight-charts: bar i
// sits at x = 10 + 12 i, price p at y = 400 - 2 p, a steep uptrend (bar i: high 100 + 2 i, low 95 + 2 i), so a label
// centred under a bar would sit on the lower candles to its left.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import ChartMarkOverlay from './ChartMarkOverlay'
import { MARK_SIZES, estimatePillWidth, markItems } from './chartMarkLayout'

const N = 40
const TIMES = Array.from({ length: N }, (_, i) => new Date(Date.UTC(2025, 2, 3 + i)).toISOString().slice(0, 10))
const BARS = TIMES.map((time, i) => ({ time, open: 97 + 2 * i, high: 100 + 2 * i, low: 95 + 2 * i, close: 98 + 2 * i }))

function fakeChart() {
  const st = { shift: 0, onRange: null }
  const xOf = (i) => 10 + 12 * i + st.shift
  const timeScale = {
    timeToCoordinate: (t) => { const i = TIMES.indexOf(t); return i < 0 ? null : xOf(i) },
    coordinateToLogical: (x) => (x - 10 - st.shift) / 12,
    width: () => 600,
    getVisibleLogicalRange: () => ({ from: 0, to: N - 1 }),
    subscribeVisibleLogicalRangeChange: (fn) => { st.onRange = fn },
    unsubscribeVisibleLogicalRangeChange: () => { st.onRange = null },
  }
  const chart = { timeScale: () => timeScale, chartElement: () => null }
  const series = {
    priceToCoordinate: (p) => 400 - 2 * p,
    dataByIndex: (i) => BARS[i] || null,
    getPane: () => ({ getHeight: () => 300 }),
    data: () => BARS,
    subscribeDataChanged: () => {}, unsubscribeDataChanged: () => {},
  }
  return { chartRef: { current: chart }, seriesRef: { current: series }, st, xOf }
}

const px = (v) => Number(String(v).replace('px', ''))
const at = (container, text) => container.querySelector(`[data-testid="chart-mark"][data-text="${text}"]`)

afterEach(() => cleanup())

describe('markItems', () => {
  it('upper-cases the word, keeps the side and sign, and keys repeats apart', () => {
    const items = markItems([
      { time: TIMES[3], position: 'belowBar', color: '#dcbb5e', text: 'bought', glyph: 'up' },
      { time: TIMES[3], position: 'belowBar', color: '#dcbb5e', text: 'bought', glyph: 'up' },
      { time: TIMES[5], position: 'aboveBar', color: '#2faf68', text: '3R', glyph: 'nonsense' },
      { time: TIMES[6], position: 'belowBar', color: '#ffffff', text: '' },
      { time: null, text: 'NO TIME' },
    ])
    expect(items.map((i) => [i.text, i.side, i.glyph, i.dot])).toEqual([
      ['BOUGHT', 'below', 'up', false], ['BOUGHT', 'below', 'up', false], ['3R', 'above', null, false], ['', 'below', null, true],
    ])
    expect(new Set(items.map((i) => i.key)).size).toBe(4)
  })
})

describe('ChartMarkOverlay', () => {
  it('draws each mark as a pill with its word and sign, its pointer on the bar, the pill clear of every candle', () => {
    const f = fakeChart()
    const markers = [{ time: TIMES[20], position: 'belowBar', color: '#dcbb5e', text: 'DECISION DAY', glyph: 'diamond' }]
    const { container } = render(<ChartMarkOverlay chartRef={f.chartRef} seriesRef={f.seriesRef} markers={markers} look="wide" />)
    const pill = at(container, 'DECISION DAY')
    expect(pill).toBeTruthy()
    expect(pill.textContent).toBe('DECISION DAY')
    expect(pill.querySelector('svg')).toBeTruthy()                      // the diamond ahead of the word
    expect(pill.style.visibility).toBe('visible')
    const caret = container.querySelector('svg[class*="caret"]')
    const W = MARK_SIZES.wide
    const low = 400 - 2 * BARS[20].low
    // the pointer: centred on the bar, its tip just under the low
    expect(px(caret.style.left) + W.caretW / 2).toBeCloseTo(f.xOf(20) + 0.5, 0)
    expect(px(caret.style.top)).toBe(Math.round(low + W.gap))
    // the pill: under the pointer, and below the low of every candle under its width
    const top = px(pill.style.top), left = px(pill.style.left)
    expect(top).toBeGreaterThanOrEqual(low + W.gap + W.caretH)
    const width = pill.offsetWidth || estimatePillWidth('DECISION DAY', 'wide', true)   // jsdom lays nothing out
    for (let i = 0; i < N; i++) {
      if (f.xOf(i) < left || f.xOf(i) > left + width) continue
      expect(400 - 2 * BARS[i].low).toBeLessThan(top)
    }
    // the stem runs from the pointer to the pill
    const stem = container.querySelector('span[class*="stem"]')
    expect(px(stem.style.top)).toBe(Math.round(low + W.gap + W.caretH))
    expect(px(stem.style.top) + px(stem.style.height)).toBe(top)
  })

  it('a top mark sits over the high with its pointer pointing down', () => {
    const f = fakeChart()
    const markers = [{ time: TIMES[10], position: 'aboveBar', color: '#2faf68', text: '3R', glyph: 'check' }]
    const { container } = render(<ChartMarkOverlay chartRef={f.chartRef} seriesRef={f.seriesRef} markers={markers} />)
    const pill = at(container, '3R')
    const caret = container.querySelector('svg[class*="caret"]')
    const high = 400 - 2 * BARS[10].high
    expect(caret.dataset.side).toBe('above')
    expect(px(caret.style.top) + MARK_SIZES.wide.caretH).toBe(Math.round(high - MARK_SIZES.wide.gap))
    expect(px(pill.style.top) + MARK_SIZES.wide.h).toBeLessThanOrEqual(high - MARK_SIZES.wide.gap - MARK_SIZES.wide.caretH)
  })

  it('a phone gets the phone size (11 px type)', () => {
    const f = fakeChart()
    const markers = [{ time: TIMES[5], position: 'belowBar', color: '#dcbb5e', text: 'BOUGHT', glyph: 'up' }]
    const { container } = render(<ChartMarkOverlay chartRef={f.chartRef} seriesRef={f.seriesRef} markers={markers} look="phone" />)
    const layer = container.querySelector('[data-testid="chart-marks"]')
    expect(layer.dataset.size).toBe('phone')
    expect(layer.style.getPropertyValue('--mk-font')).toBe('11px')
    expect(layer.style.getPropertyValue('--mk-h')).toBe(`${MARK_SIZES.phone.h}px`)
    const wide = render(<ChartMarkOverlay chartRef={f.chartRef} seriesRef={f.seriesRef} markers={markers} look="wide" />)
    expect(wide.container.querySelector('[data-testid="chart-marks"]').style.getPropertyValue('--mk-font')).toBe('12px')
  })

  it('a mark whose bar is not on the chart stays hidden and has not landed; the others land once', () => {
    const f = fakeChart()
    const markers = [
      { time: TIMES[8], position: 'belowBar', color: '#dcbb5e', text: 'BOUGHT', glyph: 'up' },
      { time: '2031-01-01', position: 'belowBar', color: '#ef5350', text: 'STOPPED', glyph: 'cross' },
    ]
    const { container } = render(<ChartMarkOverlay chartRef={f.chartRef} seriesRef={f.seriesRef} markers={markers} />)
    expect(at(container, 'BOUGHT').style.visibility).toBe('visible')
    expect(at(container, 'BOUGHT').dataset.on).toBe('1')            // the one ease-in
    expect(at(container, 'STOPPED').style.visibility).toBe('hidden')
    expect(at(container, 'STOPPED').dataset.on).toBeUndefined()
  })

  it('two marks on neighbouring bars on one side stack apart instead of printing over each other', () => {
    const f = fakeChart()
    const markers = [
      { time: TIMES[20], position: 'belowBar', color: '#dcbb5e', text: 'BOUGHT', glyph: 'up' },
      { time: TIMES[21], position: 'belowBar', color: '#ef5350', text: 'STOPPED', glyph: 'cross' },
    ]
    const { container } = render(<ChartMarkOverlay chartRef={f.chartRef} seriesRef={f.seriesRef} markers={markers} />)
    const a = at(container, 'BOUGHT'), b = at(container, 'STOPPED')
    expect(px(b.style.top)).toBeGreaterThanOrEqual(px(a.style.top) + MARK_SIZES.wide.h)
  })

  it('a mark with no word is a dot, with no pointer or stem', () => {
    const f = fakeChart()
    const markers = [{ time: TIMES[4], position: 'belowBar', color: 'rgba(255, 255, 255, 0.55)', text: '', shape: 'circle' }]
    const { container } = render(<ChartMarkOverlay chartRef={f.chartRef} seriesRef={f.seriesRef} markers={markers} />)
    const dot = container.querySelector('[data-testid="chart-mark"]')
    expect(dot.dataset.kind).toBe('dot')
    expect(dot.className).toMatch(/dot/)
    expect(container.querySelector('svg[class*="caret"]')).toBeNull()
    expect(container.querySelector('span[class*="stem"]')).toBeNull()
    expect(px(dot.style.top)).toBe(Math.round(400 - 2 * BARS[4].low + MARK_SIZES.wide.gap))
  })

  it('follows the chart when it pans: the visible-range change moves every piece with its bar', () => {
    const f = fakeChart()
    const markers = [{ time: TIMES[12], position: 'belowBar', color: '#dcbb5e', text: 'BOUGHT', glyph: 'up' }]
    const { container } = render(<ChartMarkOverlay chartRef={f.chartRef} seriesRef={f.seriesRef} markers={markers} />)
    const caret = container.querySelector('svg[class*="caret"]')
    const before = px(caret.style.left)
    expect(typeof f.st.onRange).toBe('function')
    f.st.shift = -60
    act(() => f.st.onRange())
    expect(px(caret.style.left)).toBe(before - 60)
    // panned off the plot: hidden
    f.st.shift = -1000
    act(() => f.st.onRange())
    expect(at(container, 'BOUGHT').style.visibility).toBe('hidden')
  })
})
