// app/src/components/chart/engine/lowerTf.test.js
//
// ─── C27 / C41 — the lower-timeframe rules, one at a time (`lowerTf.js`) ──────
//
// Synthetic bars at known New York instants, so every rule is read against a
// case built to break exactly it. The vendor replay (TradingView's own bars) is
// `__tests__/vendorHarness/vendorHarness.c27LowerTf.test.js`.

import { describe, it, expect } from 'vitest'
import {
  LOWER_TF_REFUSAL as R, LOWER_TF_WITNESS, LOWER_TF_CODE_WITNESS, LOWER_TF_CHART_WITNESS, LOWER_TF_SOURCE,
  lowerTfWitnessed, lowerTfRefusal,
  isLowerTfRequest, intrabarSeries, intrabarGroups, intrabarArrays, readLowerTf, lowerTfFetchPlan,
  BARS_ROUTE_MAX, lowerTfCodesOf, lowerTfWindowsOf, lowerTfWindowsNeeded, resolveLowerTf, lowerTfSignature,
} from './lowerTf.js'
import { parseFormula } from './ast/parse.js'
import { interpret, lowerTfMask } from './ast/interpret.js'
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

describe('C27 / C41 — which requests are lower-timeframe, which are served, and why the rest are not', () => {
  it('a minute code on a D/W/M chart is a lower-timeframe request; D/W/M codes are not', () => {
    expect(isLowerTfRequest('15', 'D')).toBe(true)
    expect(isLowerTfRequest('60', 'W')).toBe(true)
    expect(isLowerTfRequest('240', 'D')).toBe(true)
    expect(isLowerTfRequest('W', 'D')).toBe(false)
    expect(isLowerTfRequest('D', 'W')).toBe(false)
    expect(isLowerTfRequest('15', '60')).toBe(true)
    expect(isLowerTfRequest('60', '15')).toBe(false)
  })

  it('⭐ C41 — every rule names its capture, so the witnessed shapes are SERVED (null)', () => {
    for (const [rule, capture] of Object.entries(LOWER_TF_WITNESS)) {
      expect(capture, rule).toMatch(/^vw-/)
    }
    expect(LOWER_TF_WITNESS.requestValue).toContain('vw-lower-tf-spy-1d-2026-09-30')
    expect(LOWER_TF_WITNESS.requestSession).toContain('vw-lower-tf-rddt-1d-2026-09-30')
    expect(lowerTfWitnessed()).toBe(true)
    for (const code of ['5', '15', '60', '240']) {
      expect(lowerTfRefusal({ code, base: 'D' }), code).toBe(null)
      expect(lowerTfRefusal({ code, base: 'W' }), code).toBe(null)
    }
  })

  it('⛔ a rule with no capture refuses EVERY served shape by name (the gate can fire)', () => {
    const gap = { ...LOWER_TF_WITNESS, requestValue: null }
    expect(lowerTfWitnessed(gap)).toBe(false)
    const r = lowerTfRefusal({ code: '60', base: 'D' }, gap)
    expect(r.code).toBe(R.UNWITNESSED)
    expect(r.why).toContain('lower-tf:unwitnessed')
    expect(r.why).toContain('vw-lower-tf.pine')
    expect(lowerTfRefusal({ code: '60', base: 'D' }, { ...LOWER_TF_WITNESS, requestSession: '' }).code)
      .toBe(R.UNWITNESSED)
  })

  it('⛔ a code or a chart period no capture shows stays `lower-tf:unwitnessed`', () => {
    // the store could build 1 and 30, but no committed capture reads them below a chart
    expect(LOWER_TF_CODE_WITNESS['1']).toBe(null)
    expect(LOWER_TF_CODE_WITNESS['30']).toBe(null)
    expect(lowerTfRefusal({ code: '1', base: 'D' }).code).toBe(R.UNWITNESSED)
    expect(lowerTfRefusal({ code: '30', base: 'D' }).code).toBe(R.UNWITNESSED)
    // a monthly chart: no capture
    expect(LOWER_TF_CHART_WITNESS.M).toBe(null)
    expect(lowerTfRefusal({ code: '60', base: 'M' }).code).toBe(R.UNWITNESSED)
    // every code the store builds has a witness row (a capture or null) — none is implied
    expect(Object.keys(LOWER_TF_CODE_WITNESS).sort()).toEqual(Object.keys(LOWER_TF_SOURCE).sort())
  })

  it('the shape refusals come first and each names its own reason, witnessed or not', () => {
    expect(lowerTfRefusal({ code: '15', base: 'D', array: true }).code).toBe(R.INTRABAR_ARRAY)
    expect(lowerTfRefusal({ code: '15', base: 'D', session: 'ticker.modify' }).code).toBe(R.SESSION)
    expect(lowerTfRefusal({ code: '15', base: 'D', other: 'SPY' }).code).toBe(R.OTHER_SYMBOL)
    expect(lowerTfRefusal({ code: '15', base: 'D', lookahead: true }).code).toBe(R.LOOKAHEAD)
    expect(lowerTfRefusal({ code: '15', base: 'D', screen: true }).code).toBe(R.SCREEN)
    expect(lowerTfRefusal({ code: '15', base: '60' }).code).toBe(R.INTRADAY_CHART)
    expect(lowerTfRefusal({ code: '3', base: 'D' }).code).toBe(R.NOT_SERVED)
    expect(lowerTfRefusal({ code: '480', base: 'D' }).code).toBe(R.NOT_SERVED)
    // each sentence carries its own code, so a surface can name it without matching prose
    for (const args of [{ array: true }, { session: 'ticker.new' }, { other: 'SPY' }, { lookahead: true }, { screen: true }]) {
      const r = lowerTfRefusal({ code: '60', base: 'D', ...args })
      expect(r.why.startsWith(`${r.code}: `), r.code).toBe(true)
    }
  })

  it('⭐ the store timeframe each code is built from — 60 and 240 from 15: the store\'s own 60 is clock-aligned', () => {
    expect(LOWER_TF_SOURCE['60']).toBe('15')
    expect(LOWER_TF_SOURCE['240']).toBe('15')
    for (const c of ['1', '5', '15', '30']) expect(LOWER_TF_SOURCE[c]).toBe(c)
    expect(LOWER_TF_SOURCE['3']).toBeUndefined()
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

  it('⭐ C41 — 240 minutes buckets at 09:30 and 13:30 (the second cut at the close); a half-day has one', () => {
    const s = intrabarSeries(storeDay(2026, 9, 21, EDT, 15, 4 * 60, 20 * 60), '240', '15')
    const opens = s.bars.map((b) => { const d = new Date(b.t * 1000); return (d.getUTCHours() - EDT) * 60 + d.getUTCMinutes() })
    expect(opens).toEqual([570, 810])
    expect(s.bars[0].v).toBe(160) // sixteen 15-minute slots
    expect(s.bars[1].v).toBe(100) // ten: 13:30–16:00
    expect(s.sessions.get(20260921).complete).toBe(true)
    const half = intrabarSeries(storeDay(2025, 11, 28, EST, 15, 570, 780), '240', '15')
    expect(half.bars).toHaveLength(1)
    expect(half.sessions.get(20251128).complete).toBe(true)
  })

  it('⛔ C41 — a reach that runs off the FRONT of the supply is unknown, not a warm-up `na`', () => {
    const s = intrabarSeries(week, '60', '15')
    const chart = ['2026-09-21', '2026-09-22'].map(daily)
    // Monday's last intrabar is index 6: an expression reaching 7 intrabars back reads before
    // our history begins (TradingView's own series starts earlier), so Monday is unknown
    expect(intrabarGroups(chart, s, 'D', 7)[0]).toBe(null)
    expect(intrabarGroups(chart, s, 'D', 6)[0]).not.toBe(null)
    expect(intrabarGroups(chart, s, 'D', 7)[1]).not.toBe(null)
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

describe('C27 / C41 — what the product fetches', () => {
  it('the store timeframe and a depth covering the chart bars and the reach, extended hours counted', () => {
    const p = lowerTfFetchPlan('60', 10, 20)
    expect(p.tf).toBe('15')
    expect(p.bars).toBeGreaterThanOrEqual((10 + 1) * 26)
    expect(p.capped).toBe(false)
    const big = lowerTfFetchPlan('1', 5000, 0)
    expect(big.bars).toBe(BARS_ROUTE_MAX)
    expect(big.capped).toBe(true)
    expect(lowerTfFetchPlan('240', 10, 0).tf).toBe('15')
    expect(lowerTfFetchPlan('3', 10, 0)).toBe(null)
    // ⛔ the cap is the route's, never raised
    expect(BARS_ROUTE_MAX).toBe(60000)
  })

  const defOf = (lowerTf) => ({ id: 'u_x', meta: { recurrenceOrigin: 'pine', ...(lowerTf ? { lowerTf } : {}) } })

  it('⭐ the codes are the member door\'s stamp; one window per STORE timeframe, the deepest plan', () => {
    expect(lowerTfCodesOf(defOf(['240', '15', '60', '15']))).toEqual(['15', '60', '240'])
    expect(lowerTfCodesOf(defOf())).toEqual([])
    expect(lowerTfCodesOf(null)).toEqual([])
    const w = lowerTfWindowsOf(defOf(['15', '60', '240']), 'D', 100)
    expect(w).toHaveLength(1) // 15, 60 and 240 are all built from the store's 15
    expect(w[0].tf).toBe('15')
    expect(w[0].bars).toBeLessThanOrEqual(BARS_ROUTE_MAX)
    expect(lowerTfWindowsOf(defOf(['5', '60']), 'D', 100).map((x) => x.tf)).toEqual(['5', '15'])
    // a deep chart is capped at the route's limit, never above it
    expect(lowerTfWindowsOf(defOf(['60']), 'D', 5000)[0].bars).toBe(BARS_ROUTE_MAX)
    expect(lowerTfWindowsOf(defOf(['60']), 'W', 5000)[0].bars).toBe(BARS_ROUTE_MAX)
  })

  it('⛔ NOTHING is fetched for a document that reads no lower timeframe, or on a chart that serves none', () => {
    expect(lowerTfWindowsOf(defOf(), 'D', 5000)).toEqual([])
    expect(lowerTfWindowsOf(defOf([]), 'D', 5000)).toEqual([])
    expect(lowerTfWindowsOf(defOf(['60']), '60', 5000)).toEqual([]) // an intraday chart
    expect(lowerTfWindowsOf(defOf(['60']), 'M', 5000)).toEqual([])  // a monthly chart: unwitnessed
    const defs = { a: defOf(), b: defOf(['60']) }
    const look = (id) => defs[id]
    expect(lowerTfWindowsNeeded([{ defId: 'a' }], look, 'D', 300)).toEqual([])
    expect(lowerTfWindowsNeeded([], look, 'D', 300)).toEqual([])
    expect(lowerTfWindowsNeeded(null, look, 'D', 300)).toEqual([])
    expect(lowerTfWindowsNeeded([{ defId: 'a' }, { defId: 'b' }], look, 'D', 300).map((x) => x.tf)).toEqual(['15'])
    // a hidden instance draws nothing, so it fetches nothing
    expect(lowerTfWindowsNeeded([{ defId: 'b', hidden: true }], look, 'D', 300)).toEqual([])
  })
})

describe('C41 — what one binding is handed (`resolveLowerTf`) and what `interpret` does with it', () => {
  const week = [21, 22, 23].flatMap((d, i) => storeDay(2026, 9, d, EDT, 15, 4 * 60, 20 * 60, i * 100))
  const chart = ['2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23'].map(daily)
  const def = { id: 'u_x', meta: { recurrenceOrigin: 'pine', lowerTf: ['60', '240'] } }
  const have = new Map([['15', { bars: week, status: 'available' }]])
  const ltf = (formula, code) => ({ type: 'ltf', value: code, args: [parseFormula(formula).ast] })
  // extended hours come first in a store day: 04:00–20:00 is 64 slots, the regular
  // session's are the 23rd..48th, so its LAST 15-minute close is 48 (+100 a day)
  const lastClose = (dayIndex) => dayIndex * 100 + 48

  it('⭐ a D chart is served every witnessed code, from the one store window they are built from', () => {
    const r = resolveLowerTf(def, { tf: 'D', lowerTf: have })
    expect(r.served).toEqual(['60', '240'])
    expect(r.refused).toEqual([])
    expect(Object.keys(r.supply).sort()).toEqual(['240', '60'])
    expect(r.supply['60'].bars).toHaveLength(21)
    expect(r.supply['240'].bars).toHaveLength(6)
    // the same store bars resolve to the SAME supply object: a paint that changes nothing rebuilds nothing
    expect(resolveLowerTf(def, { tf: 'D', lowerTf: have }).supply['60']).toBe(r.supply['60'])
  })

  it('⛔ a document that reads no lower timeframe resolves to null (nothing is built)', () => {
    expect(resolveLowerTf({ id: 'u_y', meta: { recurrenceOrigin: 'pine' } }, { tf: 'D', lowerTf: have })).toBe(null)
  })

  it('⛔ each binding that cannot be served is refused BY NAME and supplied nothing', () => {
    const codeOf = (ctx) => resolveLowerTf(def, ctx).refused.map((x) => x.refusal)
    expect(codeOf({ tf: 'D', lowerTf: have, framed: true })).toEqual([R.FRAMED, R.FRAMED])
    expect(codeOf({ tf: '60', lowerTf: have })).toEqual([R.INTRADAY_CHART, R.INTRADAY_CHART])
    expect(codeOf({ tf: 'M', lowerTf: have })).toEqual([R.UNWITNESSED, R.UNWITNESSED])
    expect(codeOf({ tf: 'D', lowerTf: null })).toEqual([R.NO_BARS, R.NO_BARS])
    expect(codeOf({ tf: 'D', lowerTf: new Map([['15', { bars: [], status: 'loading' }]]) })).toEqual([R.NO_BARS, R.NO_BARS])
    expect(resolveLowerTf(def, { tf: 'D', lowerTf: new Map([['15', { bars: [], status: 'denied' }]]) }).refused[0].reason)
      .toContain('denied')
    for (const ctx of [{ tf: 'D', framed: true, lowerTf: have }, { tf: '60', lowerTf: have }, { tf: 'D' }]) {
      expect(resolveLowerTf(def, ctx).supply).toEqual({})
    }
  })

  it('⭐ `interpret` reads the supplied `ltf`: each chart bar its LAST regular-session intrabar', () => {
    const { supply } = resolveLowerTf(def, { tf: 'D', lowerTf: have })
    const col = interpret(ltf('close', '60'), chart, {}, undefined, undefined, { tf: 'D', lowerTf: supply })
    expect(Number.isNaN(col[0])).toBe(true) // 09-18: before the supply — withheld
    expect(Array.from(col.slice(1))).toEqual([lastClose(0), lastClose(1), lastClose(2)])
    const c240 = interpret(ltf('close', '240'), chart, {}, undefined, undefined, { tf: 'D', lowerTf: supply })
    expect(Array.from(c240.slice(1))).toEqual([lastClose(0), lastClose(1), lastClose(2)])
    // the child runs on the intraday series: an intrabar difference, not a daily one
    const d = interpret(ltf('close - close[1]', '60'), chart, {}, undefined, undefined, { tf: 'D', lowerTf: supply })
    expect(d[2]).toBe(2)
  })

  it('⛔ an UNSUPPLIED `ltf` is not computable on every bar — never the chart\'s own bars under its name', () => {
    const tree = ltf('close', '60')
    for (const opts of [{ tf: 'D' }, { tf: 'D', lowerTf: {} }, { tf: 'D', lowerTf: { 15: {} } }, undefined]) {
      const col = interpret(tree, chart, {}, undefined, undefined, opts)
      expect(Array.from(col).every((v) => Number.isNaN(v))).toBe(true)
      expect(Array.from(lowerTfMask(tree, chart, opts))).toEqual([1, 1, 1, 1])
    }
  })

  it('⛔ a bar the supply does not cover is WITHHELD downstream — `nz` never turns it into 0', () => {
    const { supply } = resolveLowerTf(def, { tf: 'D', lowerTf: have })
    const opts = { tf: 'D', lowerTf: supply }
    const nz = { type: 'call', name: 'nz', args: [ltf('close', '60'), { type: 'num', value: 0 }] }
    const col = interpret(nz, chart, {}, undefined, undefined, opts)
    expect(Number.isNaN(col[0])).toBe(true) // NOT 0
    expect(col[1]).toBe(lastClose(0))
    expect(Array.from(lowerTfMask(nz, chart, opts))).toEqual([1, 0, 0, 0])
    // a chart-side offset reads the unknown bar one bar later: withheld there too
    const lag = { type: 'offset', value: 1, args: [ltf('close', '60')] }
    expect(Array.from(lowerTfMask(lag, chart, opts))).toEqual([1, 1, 0, 0])
    // control: a tree with no `ltf` has no mask at all
    expect(lowerTfMask(parseFormula('close').ast, chart, opts)).toBe(null)
  })

  it('⛔ `ltf` stands alone: under another request, or holding one, it is refused', () => {
    const { supply } = resolveLowerTf(def, { tf: 'D', lowerTf: have })
    const opts = { tf: 'D', lowerTf: supply }
    const under = { type: 'tf', value: 'W', args: [ltf('close', '60')] }
    expect(() => interpret(under, chart, {}, undefined, undefined, opts)).toThrow(/lower-timeframe read/)
    const holding = { type: 'ltf', value: '60', args: [{ type: 'tf', value: 'W', args: [parseFormula('close').ast] }] }
    expect(() => interpret(holding, chart, {}, undefined, undefined, opts)).toThrow(/lower-timeframe read/)
    expect(() => interpret({ type: 'ltf', value: 'W', args: [parseFormula('close').ast] }, chart, {}, undefined,
      undefined, opts)).toThrow(/whole number of minutes/)
  })

  it('the compute signature moves when a window lands, and is empty for a document that reads none', () => {
    expect(lowerTfSignature({ meta: {} }, have)).toBe('')
    const loading = lowerTfSignature(def, new Map([['15', { bars: [], status: 'loading' }]]))
    const landed = lowerTfSignature(def, have)
    expect(loading).not.toBe(landed)
    expect(lowerTfSignature(def, null)).not.toBe(landed)
    expect(lowerTfSignature(def, have)).toBe(landed)
  })
})
