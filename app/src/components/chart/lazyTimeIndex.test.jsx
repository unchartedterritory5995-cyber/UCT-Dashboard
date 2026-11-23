// @vitest-environment jsdom
/* The drawing overlay's time -> bar-index lookup is built on its first lookup (lazyTimeIndex.js).
 *
 * Two claims, each with its own failing mutant:
 *   1. SAME ANSWERS. For every time a bar holds, and for times no bar holds, `get` returns what the eager
 *      `new Map(bars.map((b, i) => [b.t, i]))` returned (the last index wins a repeated time).
 *   2. NOT IN THE RENDER. Mounting the overlay on a chart with no drawings, and handing it a new symbol's
 *      bars, reads no bar's time for the index. (jsdom lays nothing out, so the canvas never redraws: any
 *      read of an early bar's `t` here is the index being built in the render.)
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import { lazyTimeIndex } from './lazyTimeIndex'
import ChartDrawingOverlay from './ChartDrawingOverlay'

/** The lookup the overlay kept until 2026-11-21, verbatim. */
function eagerIndex(bars) {
  const map = new Map()
  bars?.forEach((b, i) => map.set(b.t, i))
  return map
}

const dayBars = (n) => Array.from({ length: n }, (_, i) => {
  const d = new Date(Date.UTC(2024, 0, 1 + i))
  return { t: d.toISOString().slice(0, 10), o: 10 + i, h: 12 + i, l: 9 + i, c: 11 + i, v: 100 + i }
})
const minuteBars = (n) => Array.from({ length: n }, (_, i) => ({ t: 1795188600 + i * 3600, o: 1, h: 2, l: 0, c: 1, v: 5 }))

describe('lazyTimeIndex: the same answers as the eager Map', () => {
  it.each([
    ['daily (string times)', dayBars(300)],
    ['intraday (epoch times)', minuteBars(300)],
    ['a repeated time (the last index wins)', [{ t: 5 }, { t: 7 }, { t: 5 }, { t: 9 }, { t: 7 }]],
    ['one bar', [{ t: '2026-01-02' }]],
    ['no bars', []],
  ])('%s', (_label, bars) => {
    const eager = eagerIndex(bars)
    const lazy = lazyTimeIndex(bars)
    for (const b of bars) expect(lazy.get(b.t)).toBe(eager.get(b.t))
    // times no bar holds, of both shapes and of the wrong shape
    for (const miss of ['1999-01-01', '2024-01-01T00:00:00', 0, -1, 1795188601, null, undefined, NaN]) {
      expect(lazy.get(miss)).toBe(eager.get(miss))
    }
  })

  it('null and undefined bars answer undefined, as an empty Map did', () => {
    expect(lazyTimeIndex(null).get('2026-01-02')).toBeUndefined()
    expect(lazyTimeIndex(undefined).get(5)).toBeUndefined()
  })

  it('reads no bar until the first lookup, then every bar exactly once however many lookups follow', () => {
    let reads = 0
    const bars = dayBars(50).map((b) => ({ ...b, get t() { reads += 1; return b.t } }))
    const idx = lazyTimeIndex(bars)
    expect(reads).toBe(0)
    expect(idx.get('2024-01-03')).toBe(2)
    expect(reads).toBe(50)
    idx.get('2024-01-04'); idx.get('nope'); idx.get('2024-01-03')
    expect(reads).toBe(50)
  })
})

// ── the overlay itself ──────────────────────────────────────────────────────
function fakeRefs() {
  const pane = { getHeight: () => 400, getHTMLElement: () => null }
  const chart = {
    panes: () => [pane],
    timeScale: () => ({
      height: () => 30, coordinateToLogical: () => 1, logicalToCoordinate: () => 100, timeToCoordinate: () => 100,
      getVisibleLogicalRange: () => ({ from: 0, to: 2 }),
      subscribeVisibleLogicalRangeChange: () => {}, unsubscribeVisibleLogicalRangeChange: () => {},
    }),
    options: () => ({ layout: { background: { color: '#0f0f0f' } } }),
    priceScale: () => ({ width: () => 56 }),
  }
  const series = {
    priceScale: () => ({ width: () => 56, options: () => ({ scaleMargins: { top: 0.1, bottom: 0.22 } }) }),
    priceToCoordinate: (p) => 400 - p * 10, coordinateToPrice: (y) => (400 - y) / 10, getPane: () => pane,
  }
  const chartRef = createRef(); chartRef.current = chart
  const seriesRef = createRef(); seriesRef.current = series
  return { chartRef, seriesRef }
}

/** Bars whose `t` counts its reads per bar. */
function countedBars(n) {
  const reads = new Array(n).fill(0)
  const bars = dayBars(n).map((b, i) => ({ ...b, get t() { reads[i] += 1; return b.t } }))
  return { bars, reads }
}

const NOOP = () => {}
const props = (refs, bars) => ({
  ...refs, bars,
  activeTool: null, setActiveTool: NOOP, color: '#c9a84c', lineWidth: 1,
  drawings: [], addDrawing: () => 'id', updateDrawing: NOOP, removeDrawing: NOOP,
  selectedId: null, setSelectedId: NOOP,
})

describe('ChartDrawingOverlay: the time index is not built in the render', () => {
  afterEach(cleanup)

  it('a mount and a symbol switch with no drawings read none of the early bars', () => {
    const refs = fakeRefs()
    // 600 bars: anything that samples "recent spacing" reads the tail, never the first hundred.
    const a = countedBars(600)
    const b = countedBars(600)
    const { rerender, unmount } = render(<ChartDrawingOverlay {...props(refs, a.bars)} />)
    expect(a.reads.slice(0, 100).every((n) => n === 0)).toBe(true)
    rerender(<ChartDrawingOverlay {...props(refs, b.bars)} />)   // the next symbol's bars
    expect(b.reads.slice(0, 100).every((n) => n === 0)).toBe(true)
    expect(a.reads.slice(0, 100).every((n) => n === 0)).toBe(true)
    unmount()
  })
})
