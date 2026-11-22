// Next earnings date marker (Chart Settings → Markers, owner 11-16): the pure date → bar-slot mapping and the chip
// primitive, on SYNTHETIC bars and SYNTHETIC report dates. Intraday bars are built from real ET instants through
// barTime.toChartTime, exactly the times lightweight-charts receives.
import { describe, it, expect } from 'vitest'
import { toChartTime } from './barTime'
import { etWallToEpochMs } from '../../lib/marketClock/etTime'
import { isTradingDay, isHalfDay } from '../../lib/marketClock/sessionCalendar'
import {
  nextEarningsAnchor, pickNextEarnings, nextEarningsLabel, normEarningsSession, tradingDaysBetween,
  tradingDayOnOrAfter, barsInDay, reportSlot, createNextEarningsPrimitive, NEXT_EARNINGS_GREY, nextEarningsMark,
  earningsBadgeRows,
} from './nextEarningsMark'
import fs from 'node:fs'
import path from 'node:path'

const ib = (ymd, hh, mm) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return { time: toChartTime(etWallToEpochMs(y, m, d, hh, mm) / 1000), open: 1, high: 2, low: 0.5, close: 1.5 }
}
const day5m = (ymd, [fh, fm], [th, tm]) => {
  const out = []
  for (let m = fh * 60 + fm; m < th * 60 + tm; m += 5) out.push(ib(ymd, Math.floor(m / 60), m % 60))
  return out
}
const db = (...days) => days.map((d) => ({ time: d, open: 1, high: 2, low: 0.5, close: 1.5 }))
const E = (date, session = null) => ({ date, session })

describe('calendar preconditions (2026)', () => {
  it('Thanksgiving is closed, the day after is a half-day', () => {
    expect(isTradingDay('2026-11-26')).toBe(false)
    expect(isHalfDay('2026-11-27')).toBe(true)
    expect(isTradingDay('2026-11-28')).toBe(false)   // Saturday
  })
})

describe('trading-day helpers', () => {
  it('counts trading days after `from` up to and including `to`, skipping weekends and holidays', () => {
    expect(tradingDaysBetween('2026-11-20', '2026-11-24')).toBe(2)          // Mon, Tue
    expect(tradingDaysBetween('2026-11-20', '2026-11-30')).toBe(5)          // 23 24 25 (26 closed) 27 30
    expect(tradingDaysBetween('2026-11-20', '2026-11-20')).toBe(0)
    expect(tradingDayOnOrAfter('2026-11-28')).toBe('2026-11-30')            // Sat → Mon
    expect(tradingDayOnOrAfter('2026-11-26')).toBe('2026-11-27')            // holiday → the half-day
  })
  it('bars per day: regular, half-day, extended', () => {
    expect(barsInDay('2026-11-25', 5, false)).toBe(78)
    expect(barsInDay('2026-11-27', 5, false)).toBe(42)                       // closes 13:00
    expect(barsInDay('2026-11-25', 5, true)).toBe(192)
    expect(barsInDay('2026-11-25', 60, false)).toBe(7)
    expect(reportSlot('2026-11-25', 'bmo', 5, false)).toBe(0)
    expect(reportSlot('2026-11-25', null, 5, false)).toBe(0)
    expect(reportSlot('2026-11-25', 'amc', 5, false)).toBe(77)
    expect(reportSlot('2026-11-25', 'amc', 5, true)).toBe(144)               // the 16:00 post-market bar
  })
})

describe('nextEarningsAnchor — daily', () => {
  const bars = db('2026-11-18', '2026-11-19', '2026-11-20')
  it('a future weekday: trading days ahead', () => {
    expect(nextEarningsAnchor(bars, 'D', E('2026-11-24'))).toEqual({ ahead: 2 })
  })
  it('across a holiday and a half-day', () => {
    expect(nextEarningsAnchor(bars, 'D', E('2026-11-30'))).toEqual({ ahead: 5 })
    expect(nextEarningsAnchor(bars, 'D', E('2026-11-27'))).toEqual({ ahead: 4 })
  })
  it('a weekend / holiday date lands on the next session', () => {
    expect(nextEarningsAnchor(bars, 'D', E('2026-11-28'))).toEqual({ ahead: 5 })
    expect(nextEarningsAnchor(bars, 'D', E('2026-11-26'))).toEqual({ ahead: 4 })
  })
  it('reports on the last loaded day: at that bar', () => {
    expect(nextEarningsAnchor(bars, 'D', E('2026-11-20'))).toEqual({ time: '2026-11-20' })
  })
  it('a past date, a missing date, junk, no bars: nothing', () => {
    expect(nextEarningsAnchor(bars, 'D', E('2026-11-19'))).toBe(null)
    expect(nextEarningsAnchor(bars, 'D', null)).toBe(null)
    expect(nextEarningsAnchor(bars, 'D', E(''))).toBe(null)
    expect(nextEarningsAnchor(bars, 'D', E('soon'))).toBe(null)
    expect(nextEarningsAnchor([], 'D', E('2026-11-24'))).toBe(null)
    expect(nextEarningsAnchor(null, 'D', E('2026-11-24'))).toBe(null)
  })
  it('years out: nothing', () => {
    expect(nextEarningsAnchor(bars, 'D', E('2030-01-15'))).toBe(null)
  })
})

describe('nextEarningsAnchor — weekly / monthly (the bucket containing the date)', () => {
  it('weekly', () => {
    const w = db('2026-11-13', '2026-11-20')
    expect(nextEarningsAnchor(w, 'W', E('2026-12-03'))).toEqual({ ahead: 2 })
    expect(nextEarningsAnchor(w, 'W', E('2026-11-18'))).toEqual({ time: '2026-11-20' })
    expect(nextEarningsAnchor(w, 'W', E('2026-11-12'))).toBe(null)
  })
  it('monthly', () => {
    const m = db('2026-10-01', '2026-11-01')
    expect(nextEarningsAnchor(m, 'M', E('2027-01-28'))).toEqual({ ahead: 2 })
    expect(nextEarningsAnchor(m, 'M', E('2026-11-30'))).toEqual({ time: '2026-11-01' })
    expect(nextEarningsAnchor(m, 'M', E('2026-10-30'))).toBe(null)
  })
})

describe('nextEarningsAnchor — intraday (5m)', () => {
  const rth = [...day5m('2026-11-24', [9, 30], [16, 0]), ...day5m('2026-11-25', [9, 30], [16, 0])]
  it('before the open, across a holiday + half-day: the next session’s first bar', () => {
    // 0 left today · 11-26 closed · 11-27 half-day 42 bars · 11-30 slot 0
    expect(nextEarningsAnchor(rth, '5', E('2026-11-30', 'bmo'))).toEqual({ ahead: 43 })
    expect(nextEarningsAnchor(rth, '5', E('2026-11-30'))).toEqual({ ahead: 43 })     // timing unknown → open
  })
  it('after the close: the last regular bar (or the first post-market bar with extended hours)', () => {
    expect(nextEarningsAnchor(rth, '5', E('2026-11-30', 'amc'))).toEqual({ ahead: 42 + 77 + 1 })
    const ext = [...day5m('2026-11-25', [4, 0], [16, 0])]                          // last bar 15:55, extended on
    // 48 left today (16:00–19:55) · 11-27 192 · 11-30 slot 144 (16:00)
    expect(nextEarningsAnchor(ext, '5', E('2026-11-30', 'amc'), { extended: true })).toEqual({ ahead: 48 + 192 + 144 + 1 })
  })
  it('reports later today: bars ahead inside the session', () => {
    const am = day5m('2026-11-25', [9, 30], [10, 5])                              // last bar 10:00 (slot 6)
    expect(nextEarningsAnchor(am, '5', E('2026-11-25', 'amc'))).toEqual({ ahead: 71 })
  })
  it('reported this morning: at the loaded session’s first bar (never the previous day’s)', () => {
    const a = nextEarningsAnchor(rth, '5', E('2026-11-25', 'bmo'))
    expect(a).toEqual({ time: ib('2026-11-25', 9, 30).time })
    const b = nextEarningsAnchor(rth, '5', E('2026-11-25', 'amc'))
    expect(b).toEqual({ time: ib('2026-11-25', 15, 55).time })
  })
  it('a past date: nothing', () => {
    expect(nextEarningsAnchor(rth, '5', E('2026-11-24'))).toBe(null)
  })
})

describe('pickNextEarnings / label / session', () => {
  it('the earliest estimate row on or after the day; reported rows ignored', () => {
    const rows = [
      { date: '2026-08-01', beat: true },
      { date: '2027-02-10', estimate: true },
      { date: '2026-11-30', estimate: true, session: 'AMC' },
      { date: '2026-11-01', estimate: true },
      { date: 'bad', estimate: true },
    ]
    expect(pickNextEarnings(rows, '2026-11-20')).toEqual({ date: '2026-11-30', session: 'amc' })
    expect(pickNextEarnings(rows, '2027-03-01')).toBe(null)
    expect(pickNextEarnings(null)).toBe(null)
    expect(pickNextEarnings([{ date: '2026-11-30', beat: null }])).toBe(null)
  })
  it('session spellings', () => {
    expect(normEarningsSession('bmo')).toBe('bmo')
    expect(normEarningsSession('Before market open')).toBe('bmo')
    expect(normEarningsSession('amc')).toBe('amc')
    expect(normEarningsSession('after close')).toBe('amc')
    expect(normEarningsSession('dmh')).toBe(null)
    expect(normEarningsSession(undefined)).toBe(null)
  })
  it('the tooltip', () => {
    expect(nextEarningsLabel(E('2026-11-30', 'amc'))).toBe('Next earnings · Nov 30, 2026 (after close)')
    expect(nextEarningsLabel(E('2027-02-03', 'bmo'))).toBe('Next earnings · Feb 3, 2027 (before open)')
    expect(nextEarningsLabel(E('2027-02-03'))).toBe('Next earnings · Feb 3, 2027')
    expect(nextEarningsLabel(null)).toBe('')
  })
})

describe('nextEarningsMark — rows → chip', () => {
  const bars = db('2026-11-18', '2026-11-19', '2026-11-20')
  it('the earliest upcoming row that is not behind the last bar; reported rows never count', () => {
    const rows = [{ date: '2026-11-19', estimate: true }, { date: '2026-11-24', estimate: true, session: 'bmo' }, { date: '2026-11-21', beat: true }]
    expect(nextEarningsMark(bars, 'D', rows)).toEqual({ anchor: { ahead: 2 }, lastTime: '2026-11-20', label: 'Next earnings · Nov 24, 2026 (before open)' })
  })
  it('weekly: an estimate earlier in the last bar’s week still lands on that bar', () => {
    expect(nextEarningsMark(db('2026-11-13', '2026-11-20'), 'W', [{ date: '2026-11-17', estimate: true }]).anchor).toEqual({ time: '2026-11-20' })
  })
  it('no upcoming row / no bars / junk: null', () => {
    expect(nextEarningsMark(bars, 'D', [{ date: '2026-08-01', beat: true }])).toBe(null)
    expect(nextEarningsMark(bars, 'D', [{ date: '2026-11-10', estimate: true }])).toBe(null)
    expect(nextEarningsMark([], 'D', [{ date: '2026-11-24', estimate: true }])).toBe(null)
    expect(nextEarningsMark(bars, 'D', null)).toBe(null)
  })
})

describe('createNextEarningsPrimitive', () => {
  const ts = { timeToCoordinate: (t) => (typeof t === 'number' ? t * 10 : null), coordinateToLogical: (x) => x / 10, logicalToCoordinate: (l) => l * 10 }
  const setup = () => {
    const ctl = createNextEarningsPrimitive()
    let n = 0
    ctl.primitive.attached({ chart: { timeScale: () => ts }, requestUpdate: () => { n += 1 } })
    const calls = []
    const ctx = {
      save() {}, restore() {}, beginPath() {}, fill() { calls.push(['fill', this.fillStyle]) }, stroke() { calls.push(['stroke', this.strokeStyle]) },
      measureText: () => ({ width: 6 }),
      roundRect: (x, y, w, h) => calls.push(['roundRect', x, y, w, h]),
      rect: (x, y, w, h) => calls.push(['rect', x, y, w, h]),
      fillText: (s, x, y) => calls.push(['fillText', s, x, y]),
    }
    const draw = () => { calls.length = 0; ctl.primitive.paneViews()[0].renderer().draw({ useMediaCoordinateSpace: (fn) => fn({ context: ctx, mediaSize: { width: 1000, height: 400 } }) }) }
    return { ctl, calls, draw, count: () => n }
  }
  it('draws nothing with no anchor', () => {
    const { draw, calls } = setup()
    draw()
    expect(calls).toEqual([])
  })
  it('a future slot: last bar’s logical index + bars ahead, a muted grey outlined "E" at the bottom row', () => {
    const { ctl, draw, calls } = setup()
    ctl.set({ anchor: { ahead: 3 }, lastTime: 50, label: 'Next earnings · Nov 30, 2026' })
    draw()
    const t = calls.find((c) => c[0] === 'fillText')
    expect(t[1]).toBe('E')
    expect(t[2]).toBeCloseTo(530.5, 5)                // centred on logical 53 → x 530
    const rr = calls.find((c) => c[0] === 'roundRect')
    expect(rr[2] + rr[4]).toBeCloseTo(400 - 6 + 0.5, 5) // bottom of the price pane
    expect(calls.find((c) => c[0] === 'fill')[1]).toMatch(/^rgba\(147,147,154/)
    expect(calls.find((c) => c[0] === 'stroke')[1]).toMatch(/^rgba\(147,147,154/)
    expect(NEXT_EARNINGS_GREY).toBe('#93939a')
    expect(ctl.hitTest(530, 385)).toBe('Next earnings · Nov 30, 2026')
    expect(ctl.hitTest(300, 385)).toBe(null)
  })
  it('on a loaded bar: at that bar’s time', () => {
    const { ctl, draw, calls } = setup()
    ctl.set({ anchor: { time: 40 }, lastTime: 50, label: 'x' })
    draw()
    expect(calls.find((c) => c[0] === 'fillText')[2]).toBeCloseTo(400.5, 5)
  })
  it('further right than the pane: pinned to the right edge; left of the pane: not drawn', () => {
    const { ctl, draw, calls } = setup()
    ctl.set({ anchor: { ahead: 500 }, lastTime: 50, label: 'x' })
    draw()
    const rr = calls.find((c) => c[0] === 'roundRect')
    expect(rr[1] + rr[3]).toBeLessThanOrEqual(1000 - 4 + 1)
    ctl.set({ anchor: { time: -20 }, lastTime: 50, label: 'x' })
    draw()
    expect(calls).toEqual([])
    expect(ctl.hitTest(0, 385)).toBe(null)
  })
  it('repaints only on change', () => {
    const { ctl, count } = setup()
    ctl.set({ anchor: { ahead: 3 }, lastTime: 50, label: 'a' }); expect(count()).toBe(1)
    ctl.set({ anchor: { ahead: 3 }, lastTime: 50, label: 'a' }); expect(count()).toBe(1)
    ctl.set({ anchor: { ahead: 4 }, lastTime: 50, label: 'a' }); expect(count()).toBe(2)
    ctl.set(null); expect(count()).toBe(3)
    ctl.set(null); expect(count()).toBe(3)
  })
})

describe('the Next earnings "E" replaces the old upcoming (estimate) earnings badge (owner 11-16)', () => {
  const rows = [
    { date: '2026-08-01', beat: true },
    { date: '2026-05-01', beat: false },
    { date: '2026-11-19', estimate: true },
  ]
  it('E ON → the badge rows drop the estimate row; reported beat / miss rows stay', () => {
    const out = earningsBadgeRows(rows, true)
    expect(out.map((e) => e.date)).toEqual(['2026-08-01', '2026-05-01'])
    expect(out.some((e) => e.estimate)).toBe(false)
  })
  it('E OFF → the badge rows are unchanged (the grey estimate badge draws as before)', () => {
    expect(earningsBadgeRows(rows, false)).toBe(rows)
  })
  it('non-array payload → no rows', () => {
    expect(earningsBadgeRows(null, true)).toEqual([])
    expect(earningsBadgeRows(undefined, false)).toEqual([])
  })
  it('E ON with Earnings ON still gets a chip on every timeframe (the rows the E reads keep the estimate)', () => {
    expect(nextEarningsMark(db('2026-11-13', '2026-11-16'), 'D', rows)).not.toBeNull()
  })
  it('StockChart feeds the badges through earningsBadgeRows and no longer suppresses the E on daily-like charts', () => {
    const src = fs.readFileSync(path.resolve(globalThis.process.cwd(), 'src/components/StockChart.jsx'), 'utf8')
    expect(src).toMatch(/for \(const e of earningsBadgeRows\(markersData\.earnings, _nextEarnOn\)\)/)
    expect(src).not.toMatch(/_neDup/)
    expect(src).toMatch(/if \(nextEarnRows\) _neSet = nextEarningsMark\(/)
  })
})
