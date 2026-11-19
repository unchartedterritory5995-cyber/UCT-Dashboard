// RATES, the pure half: the route's answer as the panel draws it, the words, and the two pictures'
// geometry. Rails:
//   * every state of the route (ok, computing, unavailable with its reason, a failed build, a body
//     that is not this route's) is told apart; a missing number stays null, never 0;
//   * a yield, a change in basis points and a spread each read the way a trader says them;
//   * each spread sentence says above or below, positive or inverted, and for how many trading
//     days ("at least" when the run reaches the edge of what was read);
//   * steeper is the spread rising, flatter is it falling, whichever side of zero it is on;
//   * a picture never bridges a missing day or maturity, and the spread picture always holds zero.
import { describe, it, expect } from 'vitest'
import {
  HORIZONS, RATES_CODE, RATES_URL, SOURCE, bpText, curveGeometry, curveWords, dayText, daysBetween, etDayOf, pathThrough,
  pointsText, ratesRead, runText, spreadGeometry, spreadHistoryWords, spreadSentence, spreadTrendSentence, unavailableWords,
  yieldText,
} from './ratesModel'

const H = (d1, w1, m1, m3, y1) => ({ d1, w1, m1, m3, y1 })
const mat = (key, label, months, y, was, chg) => ({ key, label, months, yield: y, was, change_bp: chg })
const MATS = [
  mat('3m', '3-month', 3, 4.3, H(4.3, 4.31, 4.35, 4.4, 4.6), H(0, -1, -5, -10, -30)),
  mat('2y', '2-year', 24, 3.7, H(3.7, 3.7, 3.7, 4.4, 4.4), H(0, 0, 0, -70, -70)),
  mat('10y', '10-year', 120, 4.12, H(4.1, 4.05, 4.3, 4.1, 3.62), H(2, 7, -18, 2, 50)),
  mat('30y', '30-year', 360, 4.7, H(4.7, 4.7, null, 4.7, 4.9), H(0, 0, null, 0, -20)),
]
const SPREADS = [
  { key: '10y2y', label: '10-year minus 2-year', long: '10y', short: '2y', value: 0.42, state: 'positive', inverted: false,
    days_in_state: 64, since: '2026-08-20', days_at_least: false, was: H(0.4, 0.35, 0.6, -0.3, -0.78), change_bp: H(2, 7, -18, 72, 120) },
  { key: '10y3m', label: '10-year minus 3-month', long: '10y', short: '3m', value: -0.18, state: 'inverted', inverted: true,
    days_in_state: 1317, since: '2021-11-01', days_at_least: true, was: H(-0.2, -0.26, -0.05, -0.3, -0.98), change_bp: H(2, 8, -13, 12, 80) },
]
const HISTORY = {
  from: '2026-11-11', to: '2026-11-17', points: 5, years: 5,
  dates: ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17'],
  y2y: [3.7, 3.7, 3.7, 3.7, 3.7], y10y: [4.1, 4.1, 4.1, 4.1, 4.12], y30y: [4.7, 4.7, 4.7, 4.7, 4.7],
  s10y2y: [-0.3, null, 0.1, 0.4, 0.42], s10y3m: [-0.2, -0.2, -0.2, -0.2, -0.18],
}
const answer = (over = {}) => ({
  status: 'ok', as_of: '2026-11-17', ref_dates: H('2026-11-16', '2026-11-10', '2026-10-16', '2026-08-17', '2025-11-17'),
  maturities: MATS, spreads: SPREADS, history: HISTORY, rows: 1317, read_at: '2026-11-17T23:20:04+00:00',
  basis: 'end_of_day', units: { yield: 'percent', change: 'basis points', spread: 'percentage points' }, source: SOURCE, check: null, ...over,
})

describe('RATES model: the route answer', () => {
  it('names its code, its route and its source', () => {
    expect(RATES_CODE).toBe('RATES')
    expect(RATES_URL).toBe('/api/research/treasury-yields')
    expect(SOURCE).toBe('US Treasury daily par yield curve')
    expect(Object.keys(HORIZONS)).toEqual(['d1', 'w1', 'm1', 'm3', 'y1'])
  })

  it('tells every state apart, and a body that is not this route is a failed read', () => {
    for (const bad of [null, undefined, 'x', [], {}, { status: 'ok' }, { status: 'error' }, answer({ as_of: 'yesterday' }),
      answer({ maturities: [] }), answer({ maturities: MATS.map((m) => ({ ...m, yield: null })) }), answer({ status: 'failed' })]) {
      expect(ratesRead(bad)).toEqual({ state: 'failed' })
    }
    expect(ratesRead({ status: 'computing' })).toEqual({ state: 'computing' })
    expect(ratesRead({ status: 'unavailable', reason: 'refused', http_status: 403 })).toEqual({ state: 'unavailable', reason: 'refused', httpStatus: 403 })
    expect(ratesRead({ status: 'unavailable' })).toEqual({ state: 'unavailable', reason: null, httpStatus: null })
  })

  it('reads the maturities, the spreads and the history; a missing number stays null', () => {
    const v = ratesRead(answer())
    expect(v.state).toBe('ok')
    expect(v.asOf).toBe('2026-11-17')
    expect(v.refDates).toEqual(H('2026-11-16', '2026-11-10', '2026-10-16', '2026-08-17', '2025-11-17'))
    expect(v.readAt).toBe('2026-11-17T23:20:04+00:00')
    expect(v.check).toBeNull()
    expect(v.maturities.map((m) => m.key)).toEqual(['3m', '2y', '10y', '30y'])
    expect(v.maturities[2]).toEqual({ key: '10y', label: '10-year', months: 120, yield: 4.12, was: H(4.1, 4.05, 4.3, 4.1, 3.62), changeBp: H(2, 7, -18, 2, 50) })
    expect(v.maturities[3].changeBp.m1).toBeNull()
    expect(v.maturities[3].was.m1).toBeNull()
    expect(v.spreads[0]).toEqual({
      key: '10y2y', label: '10-year minus 2-year', long: '10-year', short: '2-year', value: 0.42, state: 'positive', days: 64,
      since: '2026-08-20', atLeast: false, was: H(0.4, 0.35, 0.6, -0.3, -0.78), changeBp: H(2, 7, -18, 72, 120),
    })
    expect(v.spreads[1].state).toBe('inverted')
    expect(v.spreads[1].atLeast).toBe(true)
    expect(v.history.dates).toHaveLength(5)
    expect(v.history.s10y2y).toEqual([-0.3, null, 0.1, 0.4, 0.42])
    expect(v.history.years).toBe(5)
  })

  it('never turns a missing or malformed number into 0', () => {
    const v = ratesRead(answer({
      maturities: [{ key: '1m', label: '1-month', months: 1, yield: null }, { key: '2y', yield: '3.7', change_bp: { d1: '2' } }, MATS[2], 'junk', { yield: 4 }],
      spreads: [{ key: '10y2y', long: '10y', short: '2y', value: null, state: 'positive', days_in_state: 3, since: 'soon' }, { value: 1 }],
      ref_dates: { d1: 'x' }, history: { dates: ['2026-11-17', 'bad'], y10y: [4.12], s10y2y: [0.42, '0.4'] }, check: { state: 'unavailable', reason: 'refused', http_status: 403, at: 'x' },
    }))
    expect(v.state).toBe('ok')
    expect(v.maturities.map((m) => [m.key, m.yield])).toEqual([['1m', null], ['2y', null], ['10y', 4.12]])
    expect(v.maturities[1].label).toBe('2y')
    expect(Object.values(v.maturities[1].changeBp)).toEqual([null, null, null, null, null])
    // a spread with no figure has no state and no run, whatever else was sent
    expect(v.spreads).toHaveLength(1)
    expect(v.spreads[0]).toMatchObject({ value: null, state: null, days: null, since: null, long: '10-year', short: '2y' })
    expect(v.refDates).toEqual(H(null, null, null, null, null))
    expect(v.history.dates).toEqual(['2026-11-17', null])
    expect(v.history.y10y).toEqual([null, null])            // a column of another length is not lined up by guess
    expect(v.history.s10y2y).toEqual([0.42, null])
    expect(v.check).toEqual({ state: 'unavailable', reason: 'refused', httpStatus: 403 })
  })
})

describe('RATES model: words', () => {
  it('a yield, a change and a spread read the way they are quoted', () => {
    expect(yieldText(4.12)).toBe('4.12%')
    expect(yieldText(4.1)).toBe('4.10%')
    expect(yieldText(0)).toBe('0.00%')
    expect(yieldText(-0.05)).toBe('-0.05%')
    expect(yieldText(null)).toBe('No figure')
    expect(bpText(7)).toBe('+7')
    expect(bpText(-18)).toBe('-18')
    expect(bpText(0)).toBe('0')
    expect(bpText(-0.04)).toBe('0')
    expect(bpText(2.5)).toBe('+2.5')
    expect(bpText(-12.26)).toBe('-12.3')
    expect(bpText(null)).toBe('n/a')
    expect(bpText(undefined)).toBe('n/a')
    expect(pointsText(0.42)).toBe('+0.42')
    expect(pointsText(-0.18)).toBe('-0.18')
    expect(pointsText(0)).toBe('0.00')
    expect(pointsText(null)).toBe('No figure')
  })

  it('a spread sentence says above or below, positive or inverted, and for how long', () => {
    const [s2, s3] = ratesRead(answer()).spreads
    expect(spreadSentence(s2)).toBe('The 10-year is 0.42 points above the 2-year: the curve is positive, for 64 trading days (since Aug 20, 2026).')
    expect(spreadSentence(s3)).toBe(
      'The 10-year is 0.18 points below the 3-month: the curve is inverted, for at least 1,317 trading days (as far back as this screen reads, Nov 1, 2021).',
    )
    expect(spreadSentence({ ...s2, value: 1, days: 1, since: '2026-11-17' })).toBe('The 10-year is 1.00 point above the 2-year: the curve is positive, for 1 trading day (since Nov 17, 2026).')
    expect(spreadSentence({ ...s2, value: 0, state: 'flat', days: 2, since: '2026-11-16' })).toBe('The 10-year and the 2-year yield the same: the curve is flat, for 2 trading days (since Nov 16, 2026).')
    expect(spreadSentence({ ...s2, days: null, since: null })).toBe('The 10-year is 0.42 points above the 2-year: the curve is positive.')
    expect(spreadSentence({ ...s2, value: null, state: null }, '2026-11-17')).toBe('The 10-year against the 2-year: no figure for Nov 17, 2026, because one of the two yields is missing.')
    expect(runText({ days: null })).toBe('')
    expect(runText({ days: 1, atLeast: true })).toBe('for at least 1 trading day')
  })

  it('steeper is the spread rising and flatter is it falling, on either side of zero', () => {
    const [s2, s3] = ratesRead(answer()).spreads
    expect(spreadTrendSentence(s2)).toBe('It is 7 bp steeper than a week ago and 18 bp flatter than a month ago.')
    expect(spreadTrendSentence(s3)).toBe('It is 8 bp steeper than a week ago and 13 bp flatter than a month ago.')
    expect(spreadTrendSentence({ changeBp: H(1, 0, 2.5, null, null) })).toBe('It is unchanged from a week ago and 2.5 bp steeper than a month ago.')
    expect(spreadTrendSentence({ changeBp: H(1, null, -4, null, null) })).toBe('It is 4 bp flatter than a month ago.')
    expect(spreadTrendSentence({ changeBp: H(1, null, null, 3, 3) })).toBe('')
    expect(spreadTrendSentence(null)).toBe('')
  })

  it('an unavailable answer says which kind, and a date is words, never a parsed time', () => {
    expect(unavailableWords('refused', 403)).toBe("Treasury yields are not available right now: the Treasury's website refused the server's request (it answered 403).")
    expect(unavailableWords('refused', 302)).toBe("Treasury yields are not available right now: the Treasury's website refused the server's request (it answered 302).")
    expect(unavailableWords(null, null)).toBe("Treasury yields are not available right now: the Treasury's website refused the server's request.")
    expect(unavailableWords('shape', 200)).toBe("Treasury yields are not available right now: the Treasury's website answered, but not with figures this screen can read.")
    expect(dayText('2026-11-17')).toBe('Nov 17, 2026')
    expect(dayText('2026-01-01', { short: true })).toBe('Jan 1')
    expect(dayText('soon')).toBe('')
    expect(dayText(null)).toBe('')
    expect(daysBetween('2026-11-17', '2026-11-18')).toBe(1)
    expect(daysBetween('2026-11-17', null)).toBeNull()
    expect(etDayOf('2026-11-18T03:30:00+00:00')).toBe('2026-11-17')      // still the 17th in New York
    expect(etDayOf('nope')).toBeNull()
  })
})

describe('RATES model: the two pictures', () => {
  it('a line breaks at a missing point and is never bridged', () => {
    expect(pathThrough([{ x: 0, y: 1 }, { x: 10, y: 2.04 }, null, { x: 30, y: 3 }, { x: 40, y: 4 }])).toBe('M0 1 L10 2 M30 3 L40 4')
    expect(pathThrough([null, null])).toBe('')
  })

  it('the curve spaces the maturities evenly and draws today, a month ago and a year ago on one scale', () => {
    const view = ratesRead(answer())
    const geo = curveGeometry(view, { w: 300, h: 100, padX: 0, padY: 0 })
    expect(geo.ticks).toEqual([{ key: '3m', label: '3M', x: 0 }, { key: '2y', label: '2Y', x: 100 }, { key: '10y', label: '10Y', x: 200 }, { key: '30y', label: '30Y', x: 300 }])
    expect([geo.min, geo.max]).toEqual([3.62, 4.9])                      // the lowest and highest yield of the three curves
    expect(geo.series.map((s) => [s.key, s.count])).toEqual([['now', 4], ['m1', 3], ['y1', 4]])
    const now = geo.series[0]
    expect(now.points.map((p) => p.v)).toEqual([4.3, 3.7, 4.12, 4.7])
    expect(now.points[3].y).toBeLessThan(now.points[1].y)               // a higher yield is drawn higher up
    expect(now.path.startsWith('M0 ')).toBe(true)
    expect(now.path.split('L')).toHaveLength(4)
    // a month ago has no 30-year figure: three points, the line simply ends at the 10-year
    expect(geo.series[1].points[3]).toBeNull()
    expect(geo.series[1].path.split('L')).toHaveLength(3)
    expect(curveGeometry({ maturities: [view.maturities[0]] })).toBeNull()
    expect(curveGeometry(null)).toBeNull()
    expect(curveWords(view)).toBe(
      'Treasury yields by maturity on Nov 17, 2026: 3-month 4.30%, 2-year 3.70%, 10-year 4.12%, 30-year 4.70%. '
      + 'Drawn against the curve a month ago and a year ago; the table holds the same numbers.',
    )
  })

  it('the spread picture always holds zero, breaks at a missing day, and names its low, high and last', () => {
    const view = ratesRead(answer())
    const geo = spreadGeometry(view.history, 's10y2y', { w: 400, h: 100, padX: 0, padY: 0 })
    expect([geo.min, geo.max, geo.days]).toEqual([-0.3, 0.42, 4])
    expect(geo.path.match(/M/g)).toHaveLength(2)                        // Nov 12 has no figure: two pieces
    expect(geo.path.startsWith('M0 100')).toBe(true)                    // the low is at the bottom
    expect(geo.path.endsWith('L400 0')).toBe(true)                      // the high is the last day, at the top right
    expect(geo.zeroY).toBeCloseTo(58.3, 1)
    expect(geo.low).toEqual({ date: '2026-11-11', v: -0.3 })
    expect(geo.high).toEqual({ date: '2026-11-17', v: 0.42 })
    expect(geo.first.date).toBe('2026-11-11')
    expect(geo.last).toEqual({ date: '2026-11-17', v: 0.42 })
    expect(spreadHistoryWords(geo, '10-year minus 2-year')).toBe(
      '10-year minus 2-year, daily, Nov 11, 2026 to Nov 17, 2026: low -0.30 on Nov 11, 2026, high +0.42 on Nov 17, 2026, now +0.42. '
      + 'In percentage points; below zero is inverted.',
    )
    // a spread that never crossed zero still shows where zero is
    const inv = spreadGeometry(view.history, 's10y3m', { w: 400, h: 100, padX: 0, padY: 0 })
    expect([inv.min, inv.max, inv.zeroY]).toEqual([-0.2, 0, 0])
    expect(spreadGeometry({ dates: ['2026-11-17'], s10y2y: [0.4] })).toBeNull()
    expect(spreadGeometry(null)).toBeNull()
    expect(spreadHistoryWords(null, 'x')).toBe('')
  })
})
