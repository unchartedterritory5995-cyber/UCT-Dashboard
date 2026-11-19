// newestSeriesBar against a REAL lightweight-charts series (jsdom, stubbed 2D context): after every
// kind of data change it must say exactly what the old full copy said (`series.data()`'s last row),
// and it must never call data() unless `count` is read.
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts'
import { newestSeriesBar, newestRealLogicalIndex } from './newestSeriesBar'

beforeAll(() => {
  const ctx = new Proxy({}, {
    get: (_t, k) => {
      if (k === 'canvas') return { width: 800, height: 400 }
      if (k === 'measureText') return () => ({ width: 30, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} })
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) })
      return () => {}
    },
    set: () => true,
  })
  HTMLCanvasElement.prototype.getContext = () => ctx
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { get() { return 800 }, configurable: true })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get() { return 400 }, configurable: true })
})

const T = 1794000000
const oldWay = (s) => {
  const d = s.data()
  const last = d.length ? d[d.length - 1] : null
  if (!last) return null
  return { time: last.time ?? null, close: Number.isFinite(last.close) ? last.close : (Number.isFinite(last.value) ? last.value : null), count: d.length }
}
const same = (s) => {
  const nb = newestSeriesBar(s)
  const ow = oldWay(s)
  if (ow === null) return expect(nb).toBe(null)
  expect({ time: nb.time, close: nb.close, count: nb.count }).toEqual(ow)
}

describe('newestSeriesBar', () => {
  it('equals the last row of the whole series after every kind of change, candles and lines', () => {
    const chart = createChart(document.createElement('div'), { width: 800, height: 400 })
    const candles = chart.addSeries(CandlestickSeries)
    const line = chart.addSeries(LineSeries)
    for (const s of [candles, line]) same(s)                              // empty
    const bars = Array.from({ length: 500 }, (_, i) => ({ time: T + 60 * i, open: 10 + i, high: 12 + i, low: 9 + i, close: 11 + i }))
    candles.setData(bars)
    line.setData(bars.map((b) => ({ time: b.time, value: b.close })))
    same(candles); same(line)
    expect(newestSeriesBar(candles)).toMatchObject({ time: T + 60 * 499, close: 510 })
    candles.update({ time: T + 60 * 499, open: 1, high: 3, low: 0.5, close: 2 })        // the developing bar moves
    line.update({ time: T + 60 * 499, value: 2 })
    same(candles); same(line)
    candles.update({ time: T + 60 * 500, open: 2, high: 4, low: 1, close: 3.5 })        // a new bar opens
    line.update({ time: T + 60 * 500, value: 3.5 })
    same(candles); same(line)
    expect(newestSeriesBar(candles)).toMatchObject({ time: T + 60 * 500, close: 3.5 })
    candles.update({ time: T + 60 * 250, open: 7, high: 8, low: 6, close: 7.5 }, true)  // an older bar replaced in place
    same(candles)
    // whitespace at the end (a padded right edge) is not a bar: both say the last real one
    candles.setData([...bars, { time: T + 60 * 500 }, { time: T + 60 * 501 }])
    same(candles)
    expect(newestSeriesBar(candles)).toMatchObject({ time: T + 60 * 499, close: 510 })
    candles.setData([])
    same(candles)
    expect(newestSeriesBar(candles)).toBe(null)
    chart.remove()
  })

  it('never copies the series unless count is read', () => {
    const chart = createChart(document.createElement('div'), { width: 800, height: 400 })
    const s = chart.addSeries(CandlestickSeries)
    s.setData([{ time: T, open: 1, high: 2, low: 0.5, close: 1.5 }, { time: T + 60, open: 1.5, high: 2, low: 1, close: 1.8 }])
    const spy = vi.spyOn(s, 'data')
    const nb = newestSeriesBar(s)
    expect(nb).toMatchObject({ time: T + 60, close: 1.8 })
    expect(spy).not.toHaveBeenCalled()
    expect(nb.count).toBe(2)
    expect(spy).toHaveBeenCalledTimes(1)
    chart.remove()
  })

  it('answers null for no series, or a series that cannot answer', () => {
    expect(newestSeriesBar(null)).toBe(null)
    expect(newestSeriesBar({})).toBe(null)
    expect(newestSeriesBar({ dataByIndex: () => null })).toBe(null)
    const broken = newestSeriesBar({ dataByIndex: () => ({ time: 5, value: 2 }), data: () => { throw new Error('gone') } })
    expect(broken).toMatchObject({ time: 5, close: 2 })
    expect(broken.count).toBe(null)
  })
})

describe('newestRealLogicalIndex: one lookup, never a copy', () => {
  const chartOf = (map) => ({ timeScale: () => ({ timeToIndex: (t) => (t in map ? map[t] : null) }) })
  const seriesOf = (last) => {
    const s = { copies: 0, data() { s.copies++; return [] }, dataByIndex: (i, dir) => (i === Number.MAX_SAFE_INTEGER && dir === -1 ? last : null) }
    return s
  }
  it("the newest row's logical index, with no data() copy", () => {
    const s = seriesOf({ time: 500, open: 1, high: 2, low: 1, close: 2 })
    expect(newestRealLogicalIndex(chartOf({ 500: 41 }), s)).toBe(41)
    expect(s.copies).toBe(0)
  })
  it('null (the caller falls back) for an empty series, a whitespace row, or a time scale that cannot answer', () => {
    expect(newestRealLogicalIndex(chartOf({}), seriesOf(null))).toBe(null)
    expect(newestRealLogicalIndex(chartOf({ 500: 41 }), seriesOf({ time: 500 }))).toBe(null)
    expect(newestRealLogicalIndex(chartOf({}), seriesOf({ time: 500, value: 3 }))).toBe(null)
    expect(newestRealLogicalIndex(null, seriesOf({ time: 500, value: 3 }))).toBe(null)
  })
})
