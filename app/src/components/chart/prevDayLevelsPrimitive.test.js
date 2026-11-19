import { describe, it, expect } from 'vitest'
import { computePrevDayLevels, buildPrevDayLines, createPrevDayLevelsPrimitive } from './prevDayLevelsPrimitive'

// Build intraday bars for a given ET day index at 5-min spacing.
function day(dayIdx, ohlc) {
  const t0 = dayIdx * 86400 + 9.5 * 3600 // 9:30
  return ohlc.map((b, i) => ({ t: t0 + i * 300, o: b[0], h: b[1], l: b[2], c: b[3] }))
}

describe('computePrevDayLevels', () => {
  it('returns null for daily/weekly (string bar times)', () => {
    const bars = [{ t: '2026-08-04', h: 1, l: 1, c: 1 }, { t: '2026-08-05', h: 1, l: 1, c: 1 }]
    expect(computePrevDayLevels(bars)).toBe(null)
  })

  it('finds the prior session H/L/C and their anchor candle times', () => {
    // prev day (idx 100): high 105 at the 2nd candle, low 98 at the 4th, close 101 at the last.
    const prev = day(100, [[100, 102, 99, 101], [102, 105, 101, 104], [104, 104, 100, 102], [102, 103, 98, 100], [100, 101, 99, 101]])
    const cur = day(101, [[101, 106, 100, 103], [103, 107, 102, 104]])
    const bars = [...prev, ...cur]
    const lv = computePrevDayLevels(bars)
    expect(lv.high.price).toBe(105)
    expect(lv.high.startTime).toBe(prev[1].t)
    expect(lv.low.price).toBe(98)
    expect(lv.low.startTime).toBe(prev[3].t)
    expect(lv.close.price).toBe(101)         // last candle of the prev day
    expect(lv.close.startTime).toBe(prev[4].t)
    expect(lv.endTime).toBe(cur[cur.length - 1].t)
  })

  it('returns null when there is no prior session loaded', () => {
    const only = day(101, [[101, 106, 100, 103], [103, 107, 102, 104]])
    expect(computePrevDayLevels(only)).toBe(null)
  })

  it('handles lightweight-charts {time,high,low,close} format', () => {
    const prev = day(100, [[100, 110, 90, 105]]).map(b => ({ time: b.t, high: b.h, low: b.l, close: b.c }))
    const cur = day(101, [[105, 106, 104, 105]]).map(b => ({ time: b.t, high: b.h, low: b.l, close: b.c }))
    const lv = computePrevDayLevels([...prev, ...cur])
    expect(lv.high.price).toBe(110)
    expect(lv.low.price).toBe(90)
    expect(lv.close.price).toBe(105)
  })
})

describe('buildPrevDayLines', () => {
  const levels = { high: { price: 105, startTime: 10 }, low: { price: 98, startTime: 20 }, close: { price: 101, startTime: 30 }, endTime: 40 }
  it('emits only enabled lines with their per-line style', () => {
    const cfg = {
      high: { enabled: true, color: '#3cb868', style: 'dashed', width: 1 },
      low: { enabled: false, color: '#e74c3c', style: 'dashed', width: 1 },
      close: { enabled: true, color: '#9aa0a6', style: 'dotted', width: 2 },
    }
    const lines = buildPrevDayLines(levels, cfg)
    expect(lines.map(l => l.key)).toEqual(['high', 'close'])
    expect(lines[0]).toMatchObject({ price: 105, style: 'dashed', color: '#3cb868' })
    expect(lines[1]).toMatchObject({ price: 101, style: 'dotted', width: 2 })
  })
  it('returns [] for null levels/cfg', () => {
    expect(buildPrevDayLines(null, {})).toEqual([])
    expect(buildPrevDayLines(levels, null)).toEqual([])
  })
})

describe('the primitive draws to the newest candle without copying the series', () => {
  // A series whose data() would copy every row: the draw must find the newest one by index instead
  // (2026-11-19: a whole-series copy on every repaint of a 50,000-bar hourly chart).
  function world({ newest = 1_800_000_600, endTime = 1_800_000_000 } = {}) {
    const strokes = []
    let copies = 0
    const series = {
      data: () => { copies++; return [] },
      dataByIndex: (i, dir) => (i === Number.MAX_SAFE_INTEGER && dir === -1 ? { time: newest, close: 1 } : null),
      priceToCoordinate: (p) => p,
    }
    const chart = { timeScale: () => ({ timeToCoordinate: (t) => (t - 1_800_000_000) / 10 }) }
    const ctx = { save() {}, restore() {}, beginPath() {}, setLineDash() {}, stroke() {},
      moveTo(x, y) { strokes.push({ from: x, y }) }, lineTo(x) { strokes[strokes.length - 1].to = x } }
    const p = createPrevDayLevelsPrimitive()
    p.primitive.attached({ chart, series, requestUpdate: () => {} })
    p.setLines([{ key: 'pdh', price: 50, startTime: 1_800_000_100, color: '#fff', style: 'solid', width: 1 }], endTime)
    const draw = () => p.primitive.paneViews()[0].renderer().draw({ useMediaCoordinateSpace: (fn) => fn({ context: ctx, mediaSize: { width: 999 } }) })
    return { draw, strokes, copies: () => copies }
  }

  it('the line runs from its anchor candle to the NEWEST candle (past the static end), with no data() copy', () => {
    const w = world()
    for (let i = 0; i < 5; i++) w.draw()
    expect(w.strokes[0]).toEqual({ from: 10, y: 50.5, to: 60 })   // newest bar at x=60, not endTime's x=0
    expect(w.copies()).toBe(0)
  })
})
