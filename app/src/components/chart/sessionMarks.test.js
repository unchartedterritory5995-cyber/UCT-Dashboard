// Session breaks + Pre-market high & low (Chart Settings, owner 11-15): the pure computations, on SYNTHETIC bars.
// Bars are built from real instants through barTime.toChartTime (the chart's own ET conversion), so the DST cases
// exercise exactly the times lightweight-charts receives.
import { describe, it, expect } from 'vitest'
import { toChartTime } from './barTime'
import { etWallToEpochMs } from '../../lib/marketClock/etTime'
import { isTradingDay, isHalfDay } from '../../lib/marketClock/sessionCalendar'
import {
  sessionBreakTimes, preMarketRange, preMarketPriceLines, sessionBreakColor, createSessionBreaksPrimitive,
  PRE_MARKET_START_MIN,
} from './sessionMarks'

// A synthetic bar at ET wall clock `ymd hh:mm`, in chart time. Prices are made up.
const bar = (ymd, hh, mm, high = 10, low = 9) => {
  const [y, m, d] = ymd.split('-').map(Number)
  const unix = etWallToEpochMs(y, m, d, hh, mm) / 1000
  return { time: toChartTime(unix), open: low, high, low, close: high }
}
const etHm = (chartT) => { const d = new Date(chartT * 1000); return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}` }
// A day of 30-minute bars from `fromH:fromM` to before `toH:toM` (ET).
const day = (ymd, [fh, fm], [th, tm], px = () => [10, 9]) => {
  const out = []
  for (let m = fh * 60 + fm; m < th * 60 + tm; m += 30) {
    const [h, l] = px(m)
    out.push(bar(ymd, Math.floor(m / 60), m % 60, h, l))
  }
  return out
}

describe('sessionBreakTimes', () => {
  it('one break at the first bar of each new day, none for the first loaded day', () => {
    const bars = [...day('2026-07-13', [9, 30], [16, 0]), ...day('2026-07-14', [9, 30], [16, 0]), ...day('2026-07-15', [9, 30], [16, 0])]
    expect(sessionBreakTimes(bars).map(etHm)).toEqual(['2026-07-14 09:30', '2026-07-15 09:30'])
  })
  it('with extended hours the break sits at the session start (the 04:00 bar), TradingView-style', () => {
    const bars = [...day('2026-07-13', [4, 0], [20, 0]), ...day('2026-07-14', [4, 0], [20, 0])]
    expect(sessionBreakTimes(bars).map(etHm)).toEqual(['2026-07-14 04:00'])
  })
  it('DST spring-forward (Sun 2026-03-08) and fall-back (Sun 2026-11-01): the break stays on the ET open', () => {
    const spring = [...day('2026-03-06', [9, 30], [16, 0]), ...day('2026-03-09', [9, 30], [16, 0]), ...day('2026-03-10', [9, 30], [16, 0])]
    expect(sessionBreakTimes(spring).map(etHm)).toEqual(['2026-03-09 09:30', '2026-03-10 09:30'])
    const fall = [...day('2026-10-30', [9, 30], [16, 0]), ...day('2026-11-02', [9, 30], [16, 0])]
    expect(sessionBreakTimes(fall).map(etHm)).toEqual(['2026-11-02 09:30'])
    // the instants really differ by an hour of UTC across the change; the chart times do not
    const a = bar('2026-03-06', 9, 30), b = bar('2026-03-09', 9, 30)
    expect((b.time - a.time) % 86400).toBe(0)
  })
  it('a holiday (Thanksgiving 2026-11-26) has no bars, so one break after it; a half-day (11-27) still gets its break', () => {
    expect(isTradingDay('2026-11-26')).toBe(false)
    expect(isHalfDay('2026-11-27')).toBe(true)
    const bars = [...day('2026-11-25', [9, 30], [16, 0]), ...day('2026-11-27', [9, 30], [13, 0]), ...day('2026-11-30', [9, 30], [16, 0])]
    expect(sessionBreakTimes(bars).map(etHm)).toEqual(['2026-11-27 09:30', '2026-11-30 09:30'])
  })
  it('daily / weekly bars (string times), one bar, junk: nothing', () => {
    expect(sessionBreakTimes([{ time: '2026-07-13' }, { time: '2026-07-14' }])).toEqual([])
    expect(sessionBreakTimes([bar('2026-07-13', 9, 30)])).toEqual([])
    expect(sessionBreakTimes(null)).toEqual([])
    expect(sessionBreakTimes([])).toEqual([])
  })
})

describe('preMarketRange', () => {
  // pre-market bars carry their own synthetic prices so the range is checkable: high peaks at 07:00, low at 08:30
  const pmPx = (m) => (m < 570 ? [m === 420 ? 15 : 12, m === 510 ? 7 : 11] : [20, 1])
  it("the LATEST session's 04:00–09:30 high and low, ignoring regular-hours and earlier days", () => {
    const bars = [...day('2026-07-13', [4, 0], [20, 0], () => [99, 0.5]), ...day('2026-07-14', [4, 0], [16, 0], pmPx)]
    const r = preMarketRange(bars)
    expect(r).toMatchObject({ high: 15, low: 7 })
    expect(etHm(r.highTime)).toBe('2026-07-14 07:00')
    expect(etHm(r.lowTime)).toBe('2026-07-14 08:30')
  })
  it('the window is [04:00, 09:30): the 09:30 bar is regular session', () => {
    expect(PRE_MARKET_START_MIN).toBe(240)
    const bars = [bar('2026-07-14', 9, 0, 12, 11), bar('2026-07-14', 9, 30, 50, 2), bar('2026-07-14', 3, 30, 60, 1)]
    bars.sort((a, b) => a.time - b.time)
    expect(preMarketRange(bars)).toMatchObject({ high: 12, low: 11 })
  })
  it('in progress before the open: the developing pre-market range', () => {
    const bars = [...day('2026-07-13', [9, 30], [16, 0]), ...day('2026-07-14', [4, 0], [8, 0], pmPx)]
    expect(preMarketRange(bars)).toMatchObject({ high: 15, low: 11 })
  })
  it('no pre-market bars loaded (regular hours only): null', () => {
    expect(preMarketRange([...day('2026-07-13', [9, 30], [16, 0]), ...day('2026-07-14', [9, 30], [16, 0])])).toBe(null)
  })
  it("yesterday had pre-market but today's loaded bars do not: null (never yesterday's range)", () => {
    expect(preMarketRange([...day('2026-07-13', [4, 0], [20, 0]), ...day('2026-07-14', [9, 30], [16, 0])])).toBe(null)
  })
  it('DST change days: the pre-market window is still 04:00–09:30 ET', () => {
    for (const ymd of ['2026-03-09', '2026-11-02']) {
      const bars = [bar(ymd, 3, 30, 99, 0.1), bar(ymd, 4, 0, 12, 10), bar(ymd, 9, 0, 13, 11), bar(ymd, 9, 30, 99, 0.1)]
      expect(preMarketRange(bars), ymd).toMatchObject({ high: 13, low: 10 })
    }
  })
  it('a half-day (2026-11-27): the usual pre-market', () => {
    const bars = day('2026-11-27', [4, 0], [13, 0], pmPx)
    expect(preMarketRange(bars)).toMatchObject({ high: 15, low: 7 })
  })
  it('daily bars, empty, junk: null', () => {
    expect(preMarketRange([{ time: '2026-07-14', high: 1, low: 0 }])).toBe(null)
    expect(preMarketRange([])).toBe(null)
    expect(preMarketRange(undefined)).toBe(null)
  })
  it('raw-format bars (t/h/l) read too', () => {
    const b = bar('2026-07-14', 5, 0, 12, 10)
    expect(preMarketRange([{ t: b.time, h: 12, l: 10 }])).toMatchObject({ high: 12, low: 10 })
  })
})

describe('preMarketPriceLines', () => {
  it('two dashed lines, labelled on the scale; none without a range', () => {
    const lines = preMarketPriceLines({ high: 12, low: 10 }, '#706b5e')
    expect(lines.map((l) => [l.title, l.price])).toEqual([['PM high', 12], ['PM low', 10]])
    for (const l of lines) expect(l).toMatchObject({ color: '#706b5e', lineStyle: 2, lineWidth: 1, axisLabelVisible: true })
    expect(preMarketPriceLines(null, '#fff')).toEqual([])
  })
})

describe('sessionBreakColor', () => {
  it('the given (text) colour at a fixed 0.35 strength; a transparent one falls back to the next', () => {
    expect(sessionBreakColor('#93939a')).toBe('rgba(147,147,154,0.35)')
    expect(sessionBreakColor('rgba(10,20,30,0.9)')).toBe('rgba(10,20,30,0.35)')
    expect(sessionBreakColor('transparent', 'rgba(20,35,55,0.22)')).toBe('rgba(20,35,55,0.35)')
    expect(sessionBreakColor(undefined, undefined)).toBe('rgba(128,128,128,0.35)')
  })
})

describe('createSessionBreaksPrimitive', () => {
  it('repaints only when the times or colour change', () => {
    const ctl = createSessionBreaksPrimitive()
    let n = 0
    ctl.primitive.attached({ chart: {}, requestUpdate: () => { n += 1 } })
    ctl.set([1, 2], 'rgba(1,1,1,0.3)'); expect(n).toBe(1)
    ctl.set([1, 2], 'rgba(1,1,1,0.3)'); expect(n).toBe(1)
    ctl.set([1, 2, 3], 'rgba(1,1,1,0.3)'); expect(n).toBe(2)
    ctl.set([], 'rgba(1,1,1,0.3)'); expect(n).toBe(3)
  })
  it('draws one dashed vertical stroke per on-screen time, and nothing when empty', () => {
    const ctl = createSessionBreaksPrimitive()
    const chart = { timeScale: () => ({ timeToCoordinate: (t) => (t === 99 ? null : t * 10), options: () => ({ barSpacing: 6 }) }) }
    ctl.primitive.attached({ chart, requestUpdate: () => {} })
    const calls = []
    const ctx = new Proxy({}, { get: (_, k) => (typeof k === 'string' && k !== 'then' ? (...a) => calls.push([k, ...a]) : undefined), set: (_, k, v) => { calls.push(['set', k, v]); return true } })
    const target = { useBitmapCoordinateSpace: (fn) => fn({ context: ctx, bitmapSize: { width: 1000, height: 400 }, horizontalPixelRatio: 1, verticalPixelRatio: 1 }) }
    const draw = () => ctl.primitive.paneViews()[0].renderer().draw(target)
    draw(); expect(calls).toEqual([])
    ctl.set([10, 20, 99], 'rgba(1,1,1,0.3)')
    draw()
    expect(calls.filter((c) => c[0] === 'moveTo').map((c) => c[1])).toEqual([97.5, 197.5])  // half a bar left of the bar
    expect(calls.some((c) => c[0] === 'setLineDash')).toBe(true)
    expect(calls.find((c) => c[0] === 'set' && c[1] === 'strokeStyle')[2]).toBe('rgba(1,1,1,0.3)')
  })
  it("uses the time scale's logical grid for the half slot when it has one", () => {
    const ctl = createSessionBreaksPrimitive()
    const chart = { timeScale: () => ({ timeToCoordinate: (t) => t * 10, coordinateToLogical: (x) => x / 10, logicalToCoordinate: (l) => l * 10 }) }
    ctl.primitive.attached({ chart, requestUpdate: () => {} })
    const xs = []
    const ctx = new Proxy({}, { get: (_, k) => (k === 'moveTo' ? (x) => xs.push(x) : () => {}), set: () => true })
    ctl.set([10], 'rgba(1,1,1,0.3)')
    ctl.primitive.paneViews()[0].renderer().draw({ useBitmapCoordinateSpace: (fn) => fn({ context: ctx, bitmapSize: { width: 1000, height: 400 }, horizontalPixelRatio: 1, verticalPixelRatio: 1 }) })
    expect(xs).toEqual([95.5])
  })
  it('never asks the time scale for a FRACTIONAL logical index (LWC answers 0 → every line at the left edge)', () => {
    // Owner test 11-16: the real time scale returned 0 for logicalToCoordinate(lg - 0.5), drawing all 145
    // breaks on top of each other at x = 0. A scale that does the same must still place the line mid-slot.
    const ctl = createSessionBreaksPrimitive()
    const chart = { timeScale: () => ({ timeToCoordinate: (t) => t * 10, coordinateToLogical: (x) => x / 10,
      logicalToCoordinate: (l) => (Number.isInteger(l) ? l * 10 : 0) }) }
    ctl.primitive.attached({ chart, requestUpdate: () => {} })
    const xs = []
    const ctx = new Proxy({}, { get: (_, k) => (k === 'moveTo' ? (x) => xs.push(x) : () => {}), set: () => true })
    ctl.set([10, 30], 'rgba(1,1,1,0.3)')
    ctl.primitive.paneViews()[0].renderer().draw({ useBitmapCoordinateSpace: (fn) => fn({ context: ctx, bitmapSize: { width: 1000, height: 400 }, horizontalPixelRatio: 1, verticalPixelRatio: 1 }) })
    expect(xs).toEqual([95.5, 295.5])
  })
})

describe('the session breaks draw only the days on screen (2026-11-18)', () => {
  it('a deep history costs a frame only its visible breaks, and the visible ones all draw', () => {
    const DAY = 86400
    const times = Array.from({ length: 6000 }, (_, i) => (i + 1) * DAY)
    const visible = { from: 5990 * DAY + 100, to: 5995 * DAY + 100 }
    let coords = 0
    const ts = {
      getVisibleRange: () => visible,
      timeToCoordinate: (t) => { coords++; return (t - visible.from) / 100 },
      coordinateToLogical: () => null,
      options: () => ({ barSpacing: 6 }),
    }
    const ctl = createSessionBreaksPrimitive()
    ctl.primitive.attached({ chart: { timeScale: () => ts }, requestUpdate: () => {} })
    ctl.set(times, 'rgba(1,1,1,0.3)')
    const lines = []
    const ctx = { save() {}, restore() {}, setLineDash() {}, beginPath() {}, stroke() {}, moveTo: (x) => lines.push(x), lineTo() {} }
    ctl.primitive.paneViews()[0].renderer().draw({
      useBitmapCoordinateSpace: (fn) => fn({ context: ctx, bitmapSize: { width: 100000, height: 600 }, horizontalPixelRatio: 1, verticalPixelRatio: 1 }),
    })
    expect(coords).toBeLessThanOrEqual(6)
    expect(lines.length).toBe(5)                                           // days 5991..5995
  })
})
