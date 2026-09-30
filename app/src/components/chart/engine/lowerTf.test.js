// app/src/components/chart/engine/lowerTf.test.js
//
// ─── C27 — the lower-timeframe rules, one at a time (`lowerTf.js`) ────────────
//
// Synthetic bars at known New York instants, so every rule is read against a
// case built to break exactly it. The vendor replay (TradingView's own bars) is
// `__tests__/vendorHarness/vendorHarness.c27LowerTf.test.js`.

import { describe, it, expect } from 'vitest'
import {
  LOWER_TF_REFUSAL as R, LOWER_TF_WITNESS, LOWER_TF_SOURCE, lowerTfWitnessed, lowerTfRefusal,
  isLowerTfRequest, intrabarSeries, intrabarGroups, intrabarArrays, readLowerTf, lowerTfFetchPlan,
  BARS_ROUTE_MAX,
} from './lowerTf.js'
import { parseFormula } from './ast/parse.js'
import { tradingViewCloseMinute } from '../../../lib/marketClock/tradingViewSession.js'

// New York wall clock → unix seconds, for a date whose UTC offset we state.
const ny = (y, m, d, hh, mm, offsetH) => Date.UTC(y, m - 1, d, hh + offsetH, mm) / 1000
const EDT = 4
const EST = 5

/** One store bar per `stepMin` from `fromMin` to `toMin` (New York minutes), with
 *  close = a running counter so every bar is distinguishable. */
function storeDay(y, m, d, off, stepMin, fromMin, toMin, start = 0) {
  const out = []
  let k = start
  for (let t = fromMin; t < toMin; t += stepMin) {
    k += 1
    out.push({ t: ny(y, m, d, Math.floor(t / 60), t % 60, off), o: k, h: k + 0.5, l: k - 0.5, c: k, v: 10 })
  }
  return out
}
const daily = (iso) => ({ t: Number(iso.replace(/-/g, '')), o: 1, h: 1, l: 1, c: 1, v: 1 })

describe('C27 — which requests are lower-timeframe, and why nothing is served yet', () => {
  it('a minute code on a D/W/M chart is a lower-timeframe request; D/W/M codes are not', () => {
    expect(isLowerTfRequest('15', 'D')).toBe(true)
    expect(isLowerTfRequest('60', 'W')).toBe(true)
    expect(isLowerTfRequest('240', 'D')).toBe(true)
    expect(isLowerTfRequest('W', 'D')).toBe(false)
    expect(isLowerTfRequest('D', 'W')).toBe(false)
    expect(isLowerTfRequest('15', '60')).toBe(true)
    expect(isLowerTfRequest('60', '15')).toBe(false)
  })

  it('⛔ the witness table has two unwitnessed rows, so every served shape is refused BY NAME', () => {
    expect(LOWER_TF_WITNESS.requestValue).toBe(null)
    expect(LOWER_TF_WITNESS.requestSession).toBe(null)
    expect(lowerTfWitnessed()).toBe(false)
    const r = lowerTfRefusal({ code: '60', base: 'D' })
    expect(r.code).toBe(R.UNWITNESSED)
    expect(r.why).toContain('lower-tf:unwitnessed')
    expect(r.why).toContain('vw-lower-tf.pine')
    // control: the SAME request with every row witnessed is served (null)
    const all = Object.fromEntries(Object.keys(LOWER_TF_WITNESS).map((k) => [k, 'capture']))
    expect(lowerTfWitnessed(all)).toBe(true)
    expect(lowerTfRefusal({ code: '60', base: 'D' }, all)).toBe(null)
  })

  it('the shape refusals come first and each names its own reason, witnessed or not', () => {
    const all = Object.fromEntries(Object.keys(LOWER_TF_WITNESS).map((k) => [k, 'capture']))
    expect(lowerTfRefusal({ code: '15', base: 'D', array: true }, all).code).toBe(R.INTRABAR_ARRAY)
    expect(lowerTfRefusal({ code: '15', base: 'D', other: 'SPY' }, all).code).toBe(R.OTHER_SYMBOL)
    expect(lowerTfRefusal({ code: '15', base: 'D', lookahead: true }, all).code).toBe(R.LOOKAHEAD)
    expect(lowerTfRefusal({ code: '15', base: '60' }, all).code).toBe(R.INTRADAY_CHART)
    expect(lowerTfRefusal({ code: '240', base: 'D' }, all).code).toBe(R.NOT_SERVED)
    expect(lowerTfRefusal({ code: '3', base: 'D' }, all).code).toBe(R.NOT_SERVED)
  })

  it('⭐ the store timeframe each code is built from — 60 from 15, because the store\'s 60 is clock-aligned', () => {
    expect(LOWER_TF_SOURCE['60']).toBe('15')
    for (const c of ['1', '5', '15', '30']) expect(LOWER_TF_SOURCE[c]).toBe(c)
    expect(LOWER_TF_SOURCE['240']).toBeUndefined()
  })
})

describe('C27 — the intraday series TradingView reads', () => {
  it('⭐ keeps only the regular session and buckets 60 minutes from 09:30 (the last bucket 30 minutes)', () => {
    // extended hours 04:00–20:00 in 15-minute bars
    const bars = storeDay(2026, 9, 21, EDT, 15, 4 * 60, 20 * 60)
    const s = intrabarSeries(bars, '60', '15')
    const opens = s.bars.map((b) => { const d = new Date(b.t * 1000); return `${d.getUTCHours() - EDT}:${String(d.getUTCMinutes()).padStart(2, '0')}` })
    expect(opens).toEqual(['9:30', '10:30', '11:30', '12:30', '13:30', '14:30', '15:30'])
    expect(s.sessions.get(20260921).complete).toBe(true)
    // the 15:30 bucket holds TWO fifteen-minute bars; 09:30 holds four
    const first = s.bars[0]
    const last = s.bars[6]
    const src = bars.filter((b) => { const d = new Date(b.t * 1000); const m = (d.getUTCHours() - EDT) * 60 + d.getUTCMinutes(); return m >= 570 && m < 960 })
    expect(first.o).toBe(src[0].o)
    expect(first.c).toBe(src[3].c)
    expect(first.v).toBe(40)
    expect(last.o).toBe(src[src.length - 2].o)
    expect(last.c).toBe(src[src.length - 1].c)
    expect(last.v).toBe(20)
    expect(s.damage).toEqual([])
  })

  it('⭐ built from bars ALREADY at the code (TradingView\'s own 60m): the cut final bucket is one slot', () => {
    const bars = [570, 630, 690, 750, 810, 870, 930].map((m, i) => (
      { t: ny(2026, 9, 21, Math.floor(m / 60), m % 60, EDT), o: i, h: i, l: i, c: i, v: 1 }))
    const s = intrabarSeries(bars, '60', '60')
    expect(s.bars).toHaveLength(7)
    expect(s.sessions.get(20260921).complete).toBe(true)
    expect(intrabarSeries(bars.slice(0, 6), '60', '60').sessions.get(20260921).complete).toBe(false)
  })

  it('⭐ a half-day TradingView applies closes at 13:00 — four hourly buckets, complete', () => {
    expect(tradingViewCloseMinute(20251128)).toBe(780) // the precondition, from the one calendar
    const bars = storeDay(2025, 11, 28, EST, 15, 9 * 60 + 30, 13 * 60)
    const s = intrabarSeries(bars, '60', '15')
    expect(s.bars).toHaveLength(4)
    expect(s.sessions.get(20251128).complete).toBe(true)
  })

  it('⛔ a missing source slot makes its bucket absent, the session incomplete, and a gap recorded', () => {
    const bars = storeDay(2026, 9, 21, EDT, 15, 570, 960).concat(storeDay(2026, 9, 22, EDT, 15, 570, 960, 100))
    const cut = bars.filter((b) => b.t !== ny(2026, 9, 21, 11, 45, EDT)) // one slot of the 11:30 bucket
    const s = intrabarSeries(cut, '60', '15')
    expect(s.sessions.get(20260921).complete).toBe(false)
    expect(s.sessions.get(20260922).complete).toBe(true)
    expect(s.bars).toHaveLength(13) // 6 + 7
    expect(s.damage).toEqual([2]) // the 11:30 bucket would have sat at index 2
  })

  it('⛔ a store day missing entirely between two supplied days is a gap, not an absence', () => {
    const mon = storeDay(2026, 9, 21, EDT, 15, 570, 960)
    const wed = storeDay(2026, 9, 23, EDT, 15, 570, 960, 200)
    const s = intrabarSeries(mon.concat(wed), '60', '15')
    expect(s.sessions.get(20260922).complete).toBe(false)
    expect(s.damage).toEqual([7, 7, 7, 7, 7, 7, 7])
  })

  it('⛔ a source bar off the 09:30 grid leaves its day incomplete (never split, never guessed)', () => {
    const bars = storeDay(2026, 9, 21, EDT, 15, 570, 960)
    bars.push({ t: ny(2026, 9, 21, 10, 7, EDT), o: 1, h: 1, l: 1, c: 1, v: 1 })
    const s = intrabarSeries(bars, '60', '15')
    expect(s.sessions.get(20260921).complete).toBe(false)
  })

  it('a code the source cannot build is an error, not a guess', () => {
    expect(() => intrabarSeries([], '60', '45')).toThrow(/cannot be built/)
  })
})

describe('C27 — which intrabars sit inside each chart bar, and when a chart bar is KNOWN', () => {
  const week = [21, 22, 23, 24, 25].flatMap((d, i) => storeDay(2026, 9, d, EDT, 15, 570, 960, i * 100))

  it('⭐ a D chart bar holds its own session\'s buckets in order; the last is what `request.security` reads', () => {
    const s = intrabarSeries(week, '60', '15')
    const chart = ['2026-09-21', '2026-09-22', '2026-09-23'].map(daily)
    const g = intrabarGroups(chart, s, 'D', 0)
    expect(g[0]).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(g[2]).toEqual([14, 15, 16, 17, 18, 19, 20])
  })

  it('⛔ a chart bar whose session is not in the supply is UNKNOWN, never partial', () => {
    const s = intrabarSeries(week.filter((b) => b.t >= ny(2026, 9, 23, 11, 0, EDT)), '60', '15')
    const chart = ['2026-09-22', '2026-09-23', '2026-09-24'].map(daily)
    const g = intrabarGroups(chart, s, 'D', 0)
    expect(g[0]).toBe(null) // before the supply
    expect(g[1]).toBe(null) // the supply starts mid-session
    expect(g[2]).not.toBe(null)
  })

  it('⛔ a gap within the expression\'s reach makes later chart bars unknown; beyond it they are known', () => {
    const cut = week.filter((b) => b.t !== ny(2026, 9, 22, 15, 45, EDT)) // the last bucket of Tue
    const s = intrabarSeries(cut, '60', '15')
    const chart = ['2026-09-22', '2026-09-23', '2026-09-24'].map(daily)
    // reach 3 intrabars: Wed's last bucket reads back 3 hours, never reaching Tue
    const g3 = intrabarGroups(chart, s, 'D', 3)
    expect(g3[0]).toBe(null)
    expect(g3[1]).not.toBe(null)
    // reach 8: Wed's last intrabar (index 19) reads back past the gap at 13
    const g8 = intrabarGroups(chart, s, 'D', 8)
    expect(g8[1]).toBe(null)
    expect(g8[2]).not.toBe(null)
  })

  it('a W chart bar holds every session of its week', () => {
    const s = intrabarSeries(week, '60', '15')
    const g = intrabarGroups([daily('2026-09-25')], s, 'W', 0)
    expect(g[0]).toHaveLength(35)
    const partial = intrabarSeries(week.filter((b) => b.t < ny(2026, 9, 25, 9, 0, EDT)), '60', '15')
    expect(intrabarGroups([daily('2026-09-25')], partial, 'W', 0)[0]).toBe(null)
  })

  it('an intraday chart is not a D/W/M chart', () => {
    expect(() => intrabarGroups([], { sessions: new Map(), damage: [] }, '60', 0)).toThrow()
  })
})

describe('C27 — reading a lower timeframe through the real interpreter', () => {
  const week = [21, 22, 23].flatMap((d, i) => storeDay(2026, 9, d, EDT, 15, 570, 960, i * 100))
  const chart = ['2026-09-21', '2026-09-22', '2026-09-23'].map(daily)

  it('⭐ (a) the chart bar reads the LAST intrabar\'s value of the expression', () => {
    const r = readLowerTf({ tree: parseFormula('close').ast, code: '60', chartTf: 'D', chartBars: chart, storeBars: week })
    // Mon's last 15m close is 26, Tue's 126, Wed's 226 (26 slots a day)
    expect(Array.from(r.column)).toEqual([26, 126, 226])
    expect(Array.from(r.unknown)).toEqual([0, 0, 0])
  })

  it('⭐ (b) the intrabar ARRAY holds every bucket\'s value, in order', () => {
    const r = readLowerTf({ tree: parseFormula('close').ast, code: '60', chartTf: 'D', chartBars: chart, storeBars: week })
    expect(r.arrays[0]).toEqual([4, 8, 12, 16, 20, 24, 26])
    expect(intrabarArrays([null, [1]], [5, 7])).toEqual([null, [7]])
  })

  it('⭐ the expression is evaluated on the intraday series (its own history), not on the chart\'s', () => {
    const r = readLowerTf({ tree: parseFormula('close - close[1]').ast, code: '60', chartTf: 'D', chartBars: chart, storeBars: week })
    // Tue's last bucket (close 126) minus the one before it (124): an intrabar difference
    expect(r.column[1]).toBe(2)
  })

  it('⛔ an unknown chart bar is NaN AND flagged unknown — the caller withholds, never reads `na`', () => {
    const r = readLowerTf({ tree: parseFormula('close').ast, code: '60', chartTf: 'D',
      chartBars: [daily('2026-09-18'), ...chart], storeBars: week })
    expect(Number.isNaN(r.column[0])).toBe(true)
    expect(r.unknown[0]).toBe(1)
    expect(r.arrays[0]).toBe(null)
  })
})

describe('C27 — what the product would fetch', () => {
  it('the store timeframe and a depth covering the chart bars and the reach, extended hours counted', () => {
    const p = lowerTfFetchPlan('60', 10, 20)
    expect(p.tf).toBe('15')
    expect(p.bars).toBeGreaterThanOrEqual((10 + 1) * 26)
    expect(p.capped).toBe(false)
    const big = lowerTfFetchPlan('1', 5000, 0)
    expect(big.bars).toBe(BARS_ROUTE_MAX)
    expect(big.capped).toBe(true)
    expect(lowerTfFetchPlan('240', 10, 0)).toBe(null)
  })
})
