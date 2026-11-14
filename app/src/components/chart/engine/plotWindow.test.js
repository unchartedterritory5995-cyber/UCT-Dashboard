import { afterEach, describe, expect, it } from 'vitest'
import {
  PLOT_WINDOW_MARGIN_BARS, PLOT_WINDOW_MIN_BARS, PLOT_WINDOW_MIN_SAVED, PLOT_WINDOW_OFF_KEY, PLOT_WINDOW_SCREENS,
  PLOT_WINDOW_STEP, plotWindowDisabled, plotWindowRows, plotWindowStart, plotWindowTooNarrow, windowedPoints,
} from './plotWindow.js'

// Measured on production 2026-11-13: one flip onto an 11,762-bar daily chart spent about
// 205 ms in `setData` and about 165 ms turning every row of every line series into a
// render item, to draw 200 bars. An indicator's series is handed a recent window instead.
// What this file holds the arithmetic to: the window is never narrower than what a member
// can reach without the chart noticing, a short chart is never windowed, a new bar does
// not move the start, and "no window" is the same array, not a copy.

afterEach(() => { try { localStorage.removeItem(PLOT_WINDOW_OFF_KEY) } catch { /* */ } })

describe('how many rows the window holds', () => {
  it('is the floor for a normal zoom and four screens for a wide one', () => {
    expect(plotWindowRows(208)).toBe(PLOT_WINDOW_MIN_BARS)
    expect(plotWindowRows(PLOT_WINDOW_MIN_BARS / PLOT_WINDOW_SCREENS)).toBe(PLOT_WINDOW_MIN_BARS)
    expect(plotWindowRows(900)).toBe(900 * PLOT_WINDOW_SCREENS)
    expect(plotWindowRows(900.4)).toBe(Math.ceil(900.4 * PLOT_WINDOW_SCREENS))
  })
  it('reads an unknown zoom as the floor, never as nothing', () => {
    for (const v of [undefined, null, NaN, -5, 0, Infinity]) expect(plotWindowRows(v)).toBe(PLOT_WINDOW_MIN_BARS)
  })
})

describe('where the window starts', () => {
  it('draws everything on a chart with too few rows to save', () => {
    expect(plotWindowStart(600, 2000)).toBe(0)
    expect(plotWindowStart(2000, 2000)).toBe(0)
    expect(plotWindowStart(2000 + PLOT_WINDOW_MIN_SAVED - 1, 2000)).toBe(0)
  })
  it('starts on a step at or before the row the window asks for', () => {
    expect(plotWindowStart(2000 + PLOT_WINDOW_MIN_SAVED, 2000)).toBe(1000)
    expect(plotWindowStart(11762, 2000)).toBe(9500)                  // 9,762 rounded DOWN to a step: 2,262 rows drawn
    expect(plotWindowStart(11762, 4000)).toBe(7500)
    for (const n of [3000, 5000, 7422, 10248, 11762]) {
      const s = plotWindowStart(n, 2000)
      expect(s % PLOT_WINDOW_STEP).toBe(0)
      expect(n - s).toBeGreaterThanOrEqual(2000)                     // never narrower than asked
      expect(n - s).toBeLessThan(2000 + PLOT_WINDOW_STEP)
    }
  })
  it('does not move when a bar is appended, until a whole step has gone by', () => {
    const at = plotWindowStart(11762, 2000)
    for (let n = 11762; n < 12000; n++) expect(plotWindowStart(n, 2000)).toBe(at)
    expect(plotWindowStart(12000, 2000)).toBe(at + PLOT_WINDOW_STEP)
  })
  it('draws everything when it is asked something it cannot answer', () => {
    for (const [n, r] of [[0, 2000], [-1, 2000], [NaN, 2000], [5000, 0], [5000, NaN], [undefined, undefined]]) {
      expect(plotWindowStart(n, r)).toBe(0)
    }
  })
})

describe('when the view is too close to the window start', () => {
  const start = 9500
  it('is not, on the chart as it opens (200 bars at the right edge of 11,762)', () => {
    expect(plotWindowTooNarrow({ start, fromIndex: 11562, toIndex: 11770 })).toBe(false)
  })
  it('is, once the left edge is within one screen of the start', () => {
    expect(plotWindowTooNarrow({ start, fromIndex: 9500 + 208, toIndex: 9500 + 416 })).toBe(true)
    expect(plotWindowTooNarrow({ start, fromIndex: 9400, toIndex: 9600 })).toBe(true)
    expect(plotWindowTooNarrow({ start, fromIndex: 0, toIndex: 11762 })).toBe(true)                // fit content
  })
  it('keeps at least the margin on a zoomed-in chart, where a screen is a few bars', () => {
    expect(plotWindowTooNarrow({ start, fromIndex: start + PLOT_WINDOW_MARGIN_BARS + 1, toIndex: start + PLOT_WINDOW_MARGIN_BARS + 21 })).toBe(false)
    expect(plotWindowTooNarrow({ start, fromIndex: start + PLOT_WINDOW_MARGIN_BARS - 1, toIndex: start + PLOT_WINDOW_MARGIN_BARS + 19 })).toBe(true)
  })
  it('uses one whole screen as the margin on a zoomed-out chart', () => {
    expect(plotWindowTooNarrow({ start, fromIndex: start + 1001, toIndex: start + 2001 })).toBe(false)   // screen 1,000: edge 1,001 right of start
    expect(plotWindowTooNarrow({ start, fromIndex: start + 999, toIndex: start + 1999 })).toBe(true)
  })
  it('is, by pixel alone: the start is within one plot width of the left edge', () => {
    expect(plotWindowTooNarrow({ start, startX: -400, plotWidth: 900 })).toBe(true)
    expect(plotWindowTooNarrow({ start, startX: 120, plotWidth: 900 })).toBe(true)
    expect(plotWindowTooNarrow({ start, startX: -900, plotWidth: 900 })).toBe(false)
    expect(plotWindowTooNarrow({ start, startX: -5000, plotWidth: 900 })).toBe(false)
  })
  it('either reading is enough, and an index that is fine does not veto a pixel that is not', () => {
    expect(plotWindowTooNarrow({ start, fromIndex: 11562, toIndex: 11770, startX: 10, plotWidth: 900 })).toBe(true)
  })
  it('never asks for everything when everything is already drawn, or when nothing can be read', () => {
    expect(plotWindowTooNarrow({ start: 0, fromIndex: 0, toIndex: 100 })).toBe(false)
    expect(plotWindowTooNarrow({ start })).toBe(false)
    expect(plotWindowTooNarrow({ start, fromIndex: NaN, startX: null, plotWidth: 0 })).toBe(false)
    expect(plotWindowTooNarrow()).toBe(false)
  })
})

describe('the points handed to the renderer', () => {
  const days = Array.from({ length: 40 }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`).slice(0, 31)
  const byDay = days.map((time, i) => (i % 7 === 0 ? { time } : { time, value: i }))
  const bySec = Array.from({ length: 50 }, (_, i) => ({ time: 1_700_000_000 + i * 300, value: i }))

  it('are the same array when there is no window', () => {
    expect(windowedPoints(byDay, null)).toBe(byDay)
    expect(windowedPoints(byDay, undefined)).toBe(byDay)
    expect(windowedPoints([], '2026-01-05')).toEqual([])
    expect(windowedPoints(null, '2026-01-05')).toBe(null)
  })
  it('start at the first point at or after the window start, whitespace included', () => {
    const out = windowedPoints(byDay, '2026-01-15')
    expect(out[0]).toBe(byDay[14])
    expect(out).toEqual(byDay.slice(14))
    expect(out[out.length - 1]).toBe(byDay[byDay.length - 1])        // the newest point is always there
    const secs = windowedPoints(bySec, 1_700_000_000 + 20 * 300)
    expect(secs).toEqual(bySec.slice(20))
  })
  it('cut at the next point when the start falls between two', () => {
    expect(windowedPoints(bySec, 1_700_000_000 + 20 * 300 + 1)).toEqual(bySec.slice(21))
  })
  it('are the same array when the start is at or before the first point', () => {
    expect(windowedPoints(byDay, '2026-01-01')).toBe(byDay)
    expect(windowedPoints(byDay, '2025-06-30')).toBe(byDay)
  })
  it('are the same SLICE when asked again, and a new one for another start', () => {
    const a = windowedPoints(bySec, bySec[10].time)
    expect(windowedPoints(bySec, bySec[10].time)).toBe(a)
    const b = windowedPoints(bySec, bySec[11].time)
    expect(b).not.toBe(a)
    expect(b.length).toBe(a.length - 1)
  })
  it('order business-day objects', () => {
    const pts = [{ time: { year: 2025, month: 12, day: 31 }, value: 1 }, { time: { year: 2026, month: 1, day: 2 }, value: 2 },
      { time: { year: 2026, month: 1, day: 5 }, value: 3 }]
    expect(windowedPoints(pts, { year: 2026, month: 1, day: 2 })).toEqual(pts.slice(1))
    expect(windowedPoints(pts, { year: 2026, month: 1, day: 3 })).toEqual(pts.slice(2))
  })
  it('draw every row when the times cannot be ordered against the start', () => {
    expect(windowedPoints(byDay, 1_700_000_000)).toBe(byDay)         // a number against date strings
    expect(windowedPoints(bySec, '2026-01-15')).toBe(bySec)
    expect(windowedPoints([{ value: 1 }, { value: 2 }], 5)).toEqual([{ value: 1 }, { value: 2 }])
  })
})

describe('the switch', () => {
  it('is off unless this browser set it to 1', () => {
    expect(plotWindowDisabled()).toBe(false)
    localStorage.setItem(PLOT_WINDOW_OFF_KEY, '0')
    expect(plotWindowDisabled()).toBe(false)
    localStorage.setItem(PLOT_WINDOW_OFF_KEY, '1')
    expect(plotWindowDisabled()).toBe(true)
  })
})
